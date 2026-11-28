import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { belgeBagiKaydet } from './belge.js';
import { izYaz } from './denetim.js';
import { Depo } from './depo.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { kullaniciRolleri } from './yetki.js';
import { UUID } from './yat.js';

/**
 * YG-1502, YG-1503, YG-1581 (V-1150): Yardım sayfasında ve Akademide eğitim videosu, rol videosu, sıkça sorulan sorular ve kılavuzlar.
 * Çözüm Ortağı kullanıcılarına portal eğitim videosu, her LGM rolüne rol videosu, yat sahibine genel video; sigorta şirketi kullanıcılarına video yoktur.
 * İzlemek zorunlu değildir. İçeriği Bilgi Teknolojileri ve Firma Yönetimi Direktörlüğü günceller; sıkça sorulan soruları Operasyon Müdürü de ekler.
 */
type Db = Pool | PoolClient;
export const TURLER = ['Video', 'Sıkça Sorulan Soru', 'Kılavuz'];
const YONETICI = ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Bilgi İşlem Müdürü', 'Bilgi İşlem Müdür Yardımcısı'];
const SSS_EKLEYEN = 'Operasyon Müdürü';
const GENEL_HEDEF = ['Tüm Kullanıcılar', 'LGM Personeli', 'Çözüm Ortağı', 'Yat Sahibi'];
const GRUP_HEDEFI: Record<string, string> = { 'İş Birliği Firması': 'Çözüm Ortağı', 'Bireysel Müşteri (Yat Sahibi/Yetkilisi)': 'Yat Sahibi', 'Kurumsal Müşteri': 'Yat Sahibi' };
const SIGORTA_GRUBU = 'Sigorta Şirketi / Eksper';
const ICERIK_TURU: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', pdf: 'application/pdf' };

async function roller(db: Db, k: string) { return (await kullaniciRolleri(db as Pool, k)).map((r) => r.rol_adi); }
async function yetkim(db: Db, k: string): Promise<'Tam' | 'SSS' | null> {
  const r = await roller(db, k);
  return r.some((x) => YONETICI.includes(x)) ? 'Tam' : r.includes(SSS_EKLEYEN) ? 'SSS' : null;
}
/** Kullanıcının göreceği hedef kitleler: herkes, grubu ve (LGM personelinde) rolleri. */
async function hedeflerim(db: Db, k: string, grup: string): Promise<string[]> {
  const h = ['Tüm Kullanıcılar'];
  if (grup === 'LGM İç Rolü') h.push('LGM Personeli', ...(await roller(db, k)));
  else if (GRUP_HEDEFI[grup]) h.push(GRUP_HEDEFI[grup]!);
  return h;
}
async function gorunurMu(db: Db, k: string, grup: string, id: string): Promise<boolean> {
  const r = (await db.query(`SELECT tur, hedef, durum FROM yardim_icerigi WHERE kimlik = $1`, [id])).rows[0];
  if (!r) return false;
  if (await yetkim(db, k)) return true;
  if (r.durum !== 'Aktif' || (r.tur === 'Video' && grup === SIGORTA_GRUBU)) return false;
  return (await hedeflerim(db, k, grup)).includes(r.hedef);
}

// Dosyayı (video veya kılavuz PDF) yalnız içerik yöneticisi yükler; Yardım İçeriği kaydına bağlanır.
belgeBagiKaydet('Yardım İçeriği', async (db, k, id) => {
  if (!UUID.test(id) || !(await db.query(`SELECT 1 FROM yardim_icerigi WHERE kimlik = $1`, [id])).rowCount) return 'yok';
  return (await yetkim(db, k)) === 'Tam' ? 'tamam' : 'yetkisiz';
});

export function yardimYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const serbest = { preHandler: tamOturumGerekli(b, true) }; // Portal rehberi adımında (ilk giriş) video izlenebilir.
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const depo = b.depo ?? new Depo();
  const dosyaSql = `(SELECT json_build_object('uzanti', s.uzanti, 'surum', s.surum_no) FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik WHERE e.bag_turu = 'Yardım İçeriği' AND e.bag_kimligi = y.kimlik::text AND e.imha_zamani IS NULL AND s.durum NOT IN ('Karantina', 'İptal', 'Yerine Geçti') ORDER BY s.yukleme_zamani DESC LIMIT 1)`;

  // Yardım ve Akademi içeriği: kullanıcının hedef kitlesine göre; arama başlık ve metinde. Yönetici tümünü (Pasif dahil) görür.
  s.get('/yardim', serbest, async (i) => {
    const o = i.oturum!; const g = i.query as { q?: string; tur?: string };
    const yt = await yetkim(b.db, o.kullanici);
    const q = String(g.q ?? '').trim(); const tur = TURLER.includes(g.tur ?? '') ? g.tur! : null;
    const hedef = yt ? null : await hedeflerim(b.db, o.kullanici, o.grup);
    const { rows } = await b.db.query(`SELECT y.kimlik, y.tur, y.baslik, y.metin, y.dil, y.hedef, y.sira, y.durum, ${dosyaSql} dosya FROM yardim_icerigi y
      WHERE ($1::text[] IS NULL OR (y.hedef = ANY($1) AND y.durum = 'Aktif')) AND ($2::text IS NULL OR y.tur = $2) AND (NOT $3 OR y.tur <> 'Video')
        AND ($4 = '' OR tr_norm(y.baslik) LIKE '%' || tr_norm($4) || '%' OR tr_norm(coalesce(y.metin, '')) LIKE '%' || tr_norm($4) || '%')
      ORDER BY array_position(ARRAY['Video', 'Sıkça Sorulan Soru', 'Kılavuz'], y.tur), y.sira, y.baslik`, [hedef, tur, o.grup === SIGORTA_GRUBU, q]);
    // Videosu yüklenmemiş video kaydı kullanıcıya listelenmez.
    const icerik = yt ? rows : rows.filter((r) => r.tur !== 'Video' || r.dosya);
    return { yonetici: yt, hedefler: yt ? [...GENEL_HEDEF, ...(await b.db.query(`SELECT rol_adi FROM rol WHERE kullanici_gruplari ILIKE '%LGM İç Rolü%' AND rol_durumu = 'Aktif' ORDER BY rol_adi`)).rows.map((r) => r.rol_adi as string)] : [], icerik };
  });

  s.post('/yardim-icerigi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; baslik?: string; metin?: string; dil?: string; hedef?: string; sira?: number };
    const yt = await yetkim(b.db, o.kullanici);
    if (!yt) return yok(y);
    if (!TURLER.includes(g.tur ?? '')) return y.code(400).send({ hata: 'İçerik türünü seçiniz.' });
    if (yt === 'SSS' && g.tur !== 'Sıkça Sorulan Soru') return y.code(403).send({ hata: 'Video ve kılavuzu Bilgi Teknolojileri ve Firma Yönetimi Direktörlüğü ekler.' });
    if (!g.baslik?.trim()) return y.code(400).send({ hata: g.tur === 'Sıkça Sorulan Soru' ? 'Soruyu yazınız.' : 'Başlığı yazınız.' });
    if (g.tur === 'Sıkça Sorulan Soru' && !g.metin?.trim()) return y.code(400).send({ hata: 'Yanıtı yazınız.' });
    if (!['Türkçe', 'İngilizce'].includes(g.dil ?? 'Türkçe')) return y.code(400).send({ hata: 'Dili seçiniz.' });
    const hedef = g.hedef?.trim() ?? '';
    const rolVar = Boolean((await b.db.query(`SELECT 1 FROM rol WHERE rol_adi = $1 AND kullanici_gruplari ILIKE '%LGM İç Rolü%'`, [hedef])).rowCount);
    if (!GENEL_HEDEF.includes(hedef) && !rolVar) return y.code(400).send({ hata: 'Hedef kitleyi listeden seçiniz.' });
    if (g.tur === 'Video' && ['Tüm Kullanıcılar', 'LGM Personeli'].includes(hedef)) return y.code(400).send({ hata: 'Video Çözüm Ortağı, yat sahibi veya bir LGM rolü için eklenir; sigorta şirketi kullanıcılarına video gösterilmez.' });
    const r = (await b.db.query(`INSERT INTO yardim_icerigi (tur, baslik, metin, dil, hedef, sira, ekleyen_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`,
      [g.tur, g.baslik.trim(), g.metin?.trim() || null, g.dil ?? 'Türkçe', hedef, Number.isInteger(g.sira) ? g.sira : 100, o.kullanici])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yardım İçeriği Eklendi', nesneTuru: 'Yardım İçeriği', nesneKimligi: r.kimlik, yeni: { tur: g.tur, hedef }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });

  // Başlık, metin, sıra veya yayın durumu güncellenir; kayıt silinmez, Pasif olur.
  s.post('/yardim-icerigi/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { baslik?: string; metin?: string; sira?: number; durum?: string };
    const yt = await yetkim(b.db, o.kullanici);
    if (!UUID.test(id) || !yt) return yok(y);
    const r = (await b.db.query(`SELECT tur, baslik, metin, sira, durum FROM yardim_icerigi WHERE kimlik = $1`, [id])).rows[0];
    if (!r || (yt === 'SSS' && r.tur !== 'Sıkça Sorulan Soru')) return yok(y);
    if (g.durum && !['Aktif', 'Pasif'].includes(g.durum)) return y.code(400).send({ hata: 'Durumu seçiniz.' });
    if (g.baslik !== undefined && !g.baslik.trim()) return y.code(400).send({ hata: 'Başlığı yazınız.' });
    const yeni = { baslik: g.baslik?.trim() ?? r.baslik, metin: g.metin !== undefined ? g.metin.trim() || null : r.metin, sira: Number.isInteger(g.sira) ? g.sira : r.sira, durum: g.durum ?? r.durum };
    if (r.tur === 'Sıkça Sorulan Soru' && !yeni.metin) return y.code(400).send({ hata: 'Yanıtı yazınız.' });
    await b.db.query(`UPDATE yardim_icerigi SET baslik = $2, metin = $3, sira = $4, durum = $5, guncelleyen_ref = $6, guncelleme_zamani = now() WHERE kimlik = $1`, [id, yeni.baslik, yeni.metin, yeni.sira, yeni.durum, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yardım İçeriği Güncellendi', nesneTuru: 'Yardım İçeriği', nesneKimligi: id, eski: { durum: r.durum }, yeni: { durum: yeni.durum }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return yeni;
  });

  // Video veya kılavuz dosyası tarayıcıda oynatılır/açılır (indirme zorunlu değil).
  s.get('/yardim-icerigi/:id/dosya', serbest, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await gorunurMu(b.db, o.kullanici, o.grup, id))) return yok(y);
    const r = (await b.db.query(`SELECT s.uzanti, s.depo_anahtari FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik WHERE e.bag_turu = 'Yardım İçeriği' AND e.bag_kimligi = $1 AND e.imha_zamani IS NULL AND s.durum NOT IN ('Karantina', 'İptal', 'Yerine Geçti') ORDER BY s.yukleme_zamani DESC LIMIT 1`, [id])).rows[0];
    if (!r) return yok(y);
    return y.header('content-type', ICERIK_TURU[r.uzanti] ?? 'application/octet-stream').header('content-disposition', 'inline').header('x-content-type-options', 'nosniff').send(depo.bagla(r.depo_anahtari));
  });
}
