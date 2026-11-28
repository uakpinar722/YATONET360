import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, disGonder } from './bildirim.js';
import { izYaz } from './denetim.js';
import { davetOlustur } from './ilk_giris.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/**
 * YG-1570 (V-1148): Sigorta Eksperi sigorta şirketinin personeli değil, bağımsız gerçek/tüzel kişidir; ayrı hesapla yalnız görevlendirildiği
 * dosyaları (birden fazla sigorta şirketi olabilir) görür. Tanıklık davetine Katılacağım/Katılmayacağım yanıtı verir, eksper incelemesi için
 * bekletilen parçalarda (30 gün) inceleme randevusu talep eder, isteğe bağlı ekspertiz raporunu yükler ve teklifi onaylar.
 * Eksperin onayında LGM ayrı yazılı yetki veya sınır aramaz (sigorta.ts).
 */
type Db = Pool | PoolClient;
export const EKSPER_GRUBU = 'Sigorta Şirketi / Eksper';
const EKSPER_ROLU = 'Sigorta Şirketi Kullanıcısı';
const PARCA_SECIMI = 'Sigorta Eksperi İncelemesi İçin Bekletme';
const RANDEVU_KARTI = 'Eksper İnceleme Randevusu';
const YANITLAR = ['Katılacağım', 'Katılmayacağım'];
const tarihSaat = (x: Date | string) => new Date(x).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });

/** Kullanıcı dosyada etkin Sigorta Eksperi tarafı mı. */
export async function eksperDosyasi(db: Db, kullanici: string, dosya: string): Promise<boolean> {
  if (!UUID.test(dosya)) return false;
  return Boolean((await db.query(`SELECT 1 FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Eksper' AND kullanici_ref = $2 AND aktif`, [dosya, kullanici])).rowCount);
}

/** Dosyanın etkin eksper hesapları (tanıklık daveti bildirimi için). */
export async function dosyaEksperleri(db: Db, dosya: string): Promise<string[]> {
  return (await db.query(`SELECT DISTINCT kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Eksper' AND aktif AND kullanici_ref IS NOT NULL`, [dosya])).rows.map((r) => r.kullanici_ref as string);
}

export function eksperYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const dsMi = async (d: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya x WHERE x.kimlik = $1 AND (x.dosya_sorumlusu_ref = $2 OR EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = x.kimlik AND a.kullanici_ref = $2 AND a.rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu') AND a.bitis_zamani IS NULL))`, [d, k])).rowCount);
  const eksperKosulu = `EXISTS (SELECT 1 FROM dosya_tarafi e WHERE e.dosya_ref = d.kimlik AND e.taraf_rolu = 'Eksper' AND e.kullanici_ref = $1 AND e.aktif)`;

  // Dosya Sorumlusu dosyaya eksperi ekler; hesabı yoksa eksper grubunda hesap ve 7 gün geçerli davet açılır, varsa mevcut hesap bağlanır.
  s.post('/dosya/:id/eksper', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; eposta?: string; telefon?: string; unvan?: string };
    if (!UUID.test(id) || !(await dsMi(id, o.kullanici))) return yok(y);
    const eposta = g.eposta?.trim();
    if (!g.ad?.trim() || !eposta || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(eposta)) return y.code(400).send({ hata: 'Eksperin adı soyadı ve geçerli e-posta adresi zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      if ((await c.query(`SELECT 1 FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Eksper' AND aktif AND lower(eposta) = lower($2)`, [id, eposta])).rowCount) return dur(409, 'Bu eksper dosyada kayıtlıdır.');
      const h = (await c.query(`SELECT kimlik, kullanici_grubu, hesap_durumu FROM kullanici_hesabi WHERE lower(e_posta COLLATE "C") = lower($1::text COLLATE "C") LIMIT 1`, [eposta])).rows[0];
      if (h && h.kullanici_grubu !== EKSPER_GRUBU) return dur(409, 'Bu e-posta adresi başka türde bir hesaba aittir; eksperin kendi e-posta adresini giriniz.');
      let kullanici = h?.kimlik as string | undefined; let davet = false;
      if (!kullanici) {
        const r = await davetOlustur(c, { adSoyad: g.ad.trim(), eposta, telefon: g.telefon?.trim() || undefined, grup: EKSPER_GRUBU, rol: EKSPER_ROLU, olusturan: o.kullanici });
        kullanici = r.kimlik; davet = true;
        await disGonder(c, { olay: `eksper-davet:${kullanici}`, eposta, konu: 'YATONET 360 Hesabınız', metin: `LİMİT GLOBAL MARINE: Sigorta Eksperi olarak YATONET 360 hesabınız açılmıştır. İlk girişinizi 7 gün içinde aşağıdaki bağlantıdan yapmanızı rica ederiz. ${b.webAdresi}/#davet=${r.belirtec}`, acil: true });
      }
      const t = (await c.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kurulus_unvani, kisi_adi_soyadi, telefon, eposta, kullanici_ref, olusturan_ref) VALUES ($1,'Eksper',$2,$3,$4,$5,$6,$7) RETURNING kimlik`,
        [id, g.unvan?.trim() || null, g.ad.trim(), g.telefon?.trim() || null, eposta, kullanici, o.kullanici])).rows[0];
      if (!davet) await bildir(c, { olay: `eksper-gorev:${t.kimlik}`, kullanicilar: [kullanici], baslik: `${d.dosya_no} · Yeni Dosya Görevlendirmesi`, ozet: 'Dosya Sigorta Eksperi ekranınıza eklenmiştir.', eposta: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Eksperi Eklendi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { eposta, davet }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: t.kimlik, davet };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // Dosya Sorumlusu dosyadaki eksperleri ve randevu taleplerini görür.
  s.get('/dosya/:id/eksper', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dsMi(id, i.oturum!.kullanici))) return yok(y);
    const eksperler = (await b.db.query(`SELECT t.kimlik, t.kisi_adi_soyadi ad, t.kurulus_unvani unvan, t.eposta, h.hesap_durumu FROM dosya_tarafi t LEFT JOIN kullanici_hesabi h ON h.kimlik = t.kullanici_ref WHERE t.dosya_ref = $1 AND t.taraf_rolu = 'Eksper' AND t.aktif ORDER BY t.olusturma_zamani`, [id])).rows;
    const randevular = (await b.db.query(`SELECT r.kimlik, h.ad_soyad eksper, r.istenen_zaman, r.not_metni, r.durum, r.planlanan_zaman FROM eksper_inceleme_randevusu r JOIN kullanici_hesabi h ON h.kimlik = r.kullanici_ref WHERE r.dosya_ref = $1 ORDER BY r.olusturma_zamani DESC`, [id])).rows;
    const yanitlar = (await b.db.query(`SELECT n.kontrol_noktasi_no, n.planlanan_zaman, h.ad_soyad eksper, r.yanit, r.zaman FROM eksper_davet_yaniti r JOIN kontrol_noktasi n ON n.kimlik = r.kontrol_noktasi_ref JOIN is_emri e ON e.kimlik = n.is_emri_ref JOIN kullanici_hesabi h ON h.kimlik = r.kullanici_ref WHERE e.dosya_ref = $1 ORDER BY n.planlanan_zaman`, [id])).rows;
    return { eksperler, randevular, yanitlar };
  });

  // Eksper ana ekranı: profil, yanıt bekleyen davetler ve parça incelemeleri. Dosyalar ve onay bekleyen teklifler /sigorta/ana'dan gelir.
  s.get('/eksper/ana', oturumlu, async (i) => {
    const o = i.oturum!;
    if (o.grup !== EKSPER_GRUBU) return {}; // eksper değil: boş yanıt
    if ((await b.db.query(`SELECT 1 FROM sigorta_kullanici WHERE kullanici_ref = $1`, [o.kullanici])).rowCount) return {}; // eksper değil: boş yanıt
    const sirketler = (await b.db.query(`SELECT DISTINCT s.sigortaci_adi FROM dosya d JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE ${eksperKosulu} AND s.sigortaci_adi IS NOT NULL ORDER BY 1`, [o.kullanici])).rows.map((r) => r.sigortaci_adi as string);
    const unvan = (await b.db.query(`SELECT kurulus_unvani FROM dosya_tarafi WHERE kullanici_ref = $1 AND taraf_rolu = 'Eksper' AND kurulus_unvani IS NOT NULL ORDER BY olusturma_zamani DESC LIMIT 1`, [o.kullanici])).rows[0]?.kurulus_unvani ?? null;
    const davetler = (await b.db.query(`SELECT n.kimlik, n.kontrol_noktasi_no no, n.nokta_turu, n.kontrol_ozelligi, n.planlanan_zaman, d.dosya_no, d.konum, s.sigorta_hasar_dosya_no hasar_no, r.yanit
      FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik
      LEFT JOIN eksper_davet_yaniti r ON r.kontrol_noktasi_ref = n.kimlik AND r.kullanici_ref = $1
      WHERE n.eksper_klas AND n.nokta_turu IN ('Bekletme', 'Tanıklık') AND n.serbest_birakma_zamani IS NULL AND n.planlanan_zaman > now() AND ${eksperKosulu} ORDER BY n.planlanan_zaman`, [o.kullanici])).rows;
    const parcalar = (await b.db.query(`SELECT d.kimlik dosya, d.dosya_no, d.konum, s.sigorta_hasar_dosya_no hasar_no, count(*)::int parca, max(p.son_tarih)::text son_tarih,
        (SELECT json_build_object('durum', r.durum, 'istenen', r.istenen_zaman, 'planlanan', r.planlanan_zaman) FROM eksper_inceleme_randevusu r WHERE r.dosya_ref = d.kimlik AND r.kullanici_ref = $1 ORDER BY r.olusturma_zamani DESC LIMIT 1) randevu
      FROM sokulen_parca p JOIN dosya d ON d.kimlik = p.dosya_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik
      WHERE p.secim = $2 AND p.son_tarih >= (now() AT TIME ZONE 'Europe/Istanbul')::date AND ${eksperKosulu} GROUP BY d.kimlik, d.dosya_no, d.konum, s.sigorta_hasar_dosya_no ORDER BY max(p.son_tarih)`, [o.kullanici, PARCA_SECIMI])).rows;
    return { eksper: true, unvan, sirketler, davetler, parcalar };
  });

  // Tanıklık/bekletme davetine katılım yanıtı; planlanan zamana kadar değiştirilebilir. Dosya Sorumlusu ve daveti açan bilgilendirilir.
  s.post('/eksper/davet/:id/yanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { yanit } = (i.body ?? {}) as { yanit?: string };
    if (!UUID.test(id) || o.grup !== EKSPER_GRUBU) return yok(y);
    if (!YANITLAR.includes(yanit ?? '')) return y.code(400).send({ hata: 'Katılım durumunuzu seçiniz.' });
    const n = (await b.db.query(`SELECT n.kontrol_noktasi_no, n.nokta_turu, n.planlanan_zaman, n.olusturan_ref, n.eksper_klas, n.serbest_birakma_zamani, e.dosya_ref, d.dosya_no, d.dosya_sorumlusu_ref FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref WHERE n.kimlik = $1`, [id])).rows[0];
    if (!n || !n.eksper_klas || !['Bekletme', 'Tanıklık'].includes(n.nokta_turu) || !(await eksperDosyasi(b.db, o.kullanici, n.dosya_ref))) return yok(y);
    if (n.serbest_birakma_zamani || new Date(n.planlanan_zaman) <= new Date()) return y.code(409).send({ hata: 'Davet zamanı geçmiştir; yanıt kaydedilemez.' });
    await b.db.query(`INSERT INTO eksper_davet_yaniti (kontrol_noktasi_ref, kullanici_ref, yanit) VALUES ($1,$2,$3) ON CONFLICT (kontrol_noktasi_ref, kullanici_ref) DO UPDATE SET yanit = EXCLUDED.yanit, zaman = now()`, [id, o.kullanici, yanit]);
    const ad = (await b.db.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0]?.ad_soyad ?? 'Sigorta Eksperi';
    await bildir(b.db, { olay: `eksper-yanit:${id}:${o.kullanici}:${yanit}`, kullanicilar: [n.dosya_sorumlusu_ref, n.olusturan_ref].filter(Boolean), baslik: `${n.dosya_no} · ${n.kontrol_noktasi_no} · Sigorta Eksperi: ${yanit}`, ozet: `${ad} · ${n.nokta_turu} Noktası · ${tarihSaat(n.planlanan_zaman)}`, eposta: true });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Eksper Davet Yanıtı', nesneTuru: 'Kontrol Noktası', nesneKimligi: id, yeni: { yanit }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Sigorta Portalı' });
    return { yanit };
  });

  // Bekletilen parçalar için inceleme randevusu talebi; istenen zaman bekletme süresi içinde olmalıdır. Dosya Sorumlusuna görev düşer.
  s.post('/eksper/dosya/:id/randevu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { zaman?: string; not?: string };
    if (!UUID.test(id) || o.grup !== EKSPER_GRUBU || !(await eksperDosyasi(b.db, o.kullanici, id))) return yok(y);
    const zaman = g.zaman ? new Date(g.zaman) : null;
    if (!zaman || Number.isNaN(zaman.getTime()) || zaman <= new Date()) return y.code(400).send({ hata: 'İleri bir tarih ve saat seçiniz.' });
    const p = (await b.db.query(`SELECT count(*)::int n, max(son_tarih)::text son FROM sokulen_parca WHERE dosya_ref = $1 AND secim = $2 AND son_tarih >= (now() AT TIME ZONE 'Europe/Istanbul')::date`, [id, PARCA_SECIMI])).rows[0];
    if (!p.n) return y.code(409).send({ hata: 'Bu dosyada incelemeniz için bekletilen parça bulunmamaktadır.' });
    const gun = new Date(zaman.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
    if (gun > p.son) return y.code(400).send({ hata: `Randevu, parçaların bekletme süresi içinde (en geç ${p.son.split('-').reverse().join('.')}) olmalıdır.` });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = (await c.query(`INSERT INTO eksper_inceleme_randevusu (dosya_ref, kullanici_ref, istenen_zaman, not_metni) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING kimlik`, [id, o.kullanici, zaman, g.not?.trim() || null])).rows[0];
      if (!r) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu dosya için yanıt bekleyen randevu talebiniz bulunmaktadır.' }); }
      const d = (await c.query(`SELECT d.dosya_no, d.dosya_sorumlusu_ref, h.ad_soyad FROM dosya d, kullanici_hesabi h WHERE d.kimlik = $1 AND h.kimlik = $2`, [id, o.kullanici])).rows[0];
      if (d.dosya_sorumlusu_ref) await kartAc(c, { tur: RANDEVU_KARTI, kategori: 'gorev', baslik: `${d.dosya_no} · Sigorta Eksperi Parça İncelemesi Randevusu`, ozet: `${d.ad_soyad} · İstenen: ${tarihSaat(zaman)} · ${p.n} parça${g.not?.trim() ? ` · ${g.not.trim()}` : ''}`.slice(0, 1000), oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, sonZaman: zaman, nesneTuru: 'Dosya', nesneKimligi: id });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Eksper İnceleme Randevusu Talebi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { zaman }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Sigorta Portalı' });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, gonderilecek: 'Dosya Sorumlusu' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // Dosya Sorumlusu randevu zamanını kaydeder; eksper bilgilendirilir, görev kapanır.
  s.post('/eksper-randevu/:id/planla', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { zaman?: string };
    if (!UUID.test(id)) return yok(y);
    const r = (await b.db.query(`SELECT r.*, d.dosya_no FROM eksper_inceleme_randevusu r JOIN dosya d ON d.kimlik = r.dosya_ref WHERE r.kimlik = $1`, [id])).rows[0];
    if (!r || !(await dsMi(r.dosya_ref, o.kullanici))) return yok(y);
    if (r.durum !== 'Talep Edildi') return y.code(409).send({ hata: 'Randevu planlanmıştır.' });
    const zaman = g.zaman ? new Date(g.zaman) : null;
    if (!zaman || Number.isNaN(zaman.getTime()) || zaman <= new Date()) return y.code(400).send({ hata: 'İleri bir tarih ve saat seçiniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE eksper_inceleme_randevusu SET durum = 'Planlandı', planlanan_zaman = $2, planlayan_ref = $3 WHERE kimlik = $1`, [id, zaman, o.kullanici]);
      if (!(await c.query(`SELECT 1 FROM eksper_inceleme_randevusu WHERE dosya_ref = $1 AND durum = 'Talep Edildi'`, [r.dosya_ref])).rowCount)
        await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [RANDEVU_KARTI, r.dosya_ref]);
      await bildir(c, { olay: `eksper-randevu:${id}`, kullanicilar: [r.kullanici_ref], baslik: `${r.dosya_no} · Parça İncelemesi Randevunuz`, ozet: tarihSaat(zaman), eposta: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Eksper İnceleme Randevusu Planlandı', nesneTuru: 'Dosya', nesneKimligi: r.dosya_ref, yeni: { zaman }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { durum: 'Planlandı' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
