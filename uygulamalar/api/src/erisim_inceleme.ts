import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const BTM = 'Bilgi İşlem Müdürü'; const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'; const KART = 'Erişim İncelemesi';
const BIRIM_MUDUR = ['Operasyon Müdürü', 'Teknik Müdür', 'Tedarik Yönetimi Müdürü', 'Muhasebe ve Finans Müdürü', 'İnsan Kaynakları Müdürü', 'İdari İşler Müdürü'];
const YONETICI = [BTM, BTD, 'İnsan Kaynakları Müdürü'];
const KARARLAR = ['Koru', 'Daralt', 'Süre Uzat', 'Askıya Al', 'Kapat'];
const KALEM = `SELECT a.kimlik atama, a.kullanici_ref, a.rol_ref FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND h.hesap_durumu = 'Aktif'`;

async function incelemeAc(db: Db, baslik: string, makam: string, kapsam: string, donem: string, sql: string, prm: unknown[], simdi: Date) {
  const atamalar = (await db.query(sql, prm)).rows; if (!atamalar.length) return;
  const son = await isGunuSonu(db, simdi, 10);
  const i = (await db.query(`INSERT INTO erisim_inceleme (donem, kapsam, rol_ref, son_zaman) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [donem, kapsam, makam, son])).rows[0].kimlik;
  for (const a of atamalar) await db.query(`INSERT INTO erisim_inceleme_kalemi (inceleme_ref, atama_ref, kullanici_ref, rol_ref) VALUES ($1,$2,$3,$4)`, [i, a.atama, a.kullanici_ref, a.rol_ref]);
  await kartAc(db, { tur: KART, kategori: 'gorev', baslik: `${donem} · ${baslik}`, ozet: `${atamalar.length} erişim`, sahipRol: makam, sonZaman: son, nesneTuru: 'Erişim İncelemesi', nesneKimligi: i });
}

/** YG-1046, YG-1639: ayrıcalıklı hesaplar 3 ayda bir, diğerleri 6 ayda bir; birim müdürleri kendi birimini inceler. */
export async function erisimIncelemeAc(db: Pool, simdi = new Date()): Promise<void> {
  const y = simdi.getUTCFullYear(); const c = Math.floor(simdi.getUTCMonth() / 3) + 1; const btm = await rolId(db, BTM);
  if (await birKez(db, 'erisim_inceleme_ayricalikli', `${y}-Q${c}`)) await incelemeAc(db, 'Ayrıcalıklı Hesap İncelemesi', btm, 'Ayrıcalıklı', `${y}-Q${c}`, `${KALEM} AND r.ayricalikli_rol`, [], simdi);
  const donem = `${y}-H${simdi.getUTCMonth() < 6 ? 1 : 2}`;
  if (!(await birKez(db, 'erisim_inceleme', donem))) return;
  const birimler: string[] = [];
  for (const m of BIRIM_MUDUR) {
    const r = (await db.query(`SELECT kimlik, rol_sahibi_birim b FROM rol WHERE rol_adi = $1`, [m])).rows[0]; if (!r) continue;
    birimler.push(r.b); await incelemeAc(db, `${m} Erişim İncelemesi`, r.kimlik, 'İç', donem, `${KALEM} AND NOT r.ayricalikli_rol AND r.rol_sahibi_birim = $1`, [r.b], simdi);
  }
  await incelemeAc(db, 'Diğer Birimler, Dış Kullanıcı ve Hizmet Hesapları', btm, 'Dış ve Diğer', donem, `${KALEM} AND NOT r.ayricalikli_rol AND NOT r.rol_sahibi_birim = ANY($1::text[])`, [birimler], simdi);
}

async function kararUygula(c: Db, k: { atama_ref: string; kullanici_ref: string }, karar: string, yeniBitis: string | null) {
  if (karar === 'Süre Uzat') await c.query(`UPDATE rol_atamasi SET bitis_tarihi = $2 WHERE kimlik = $1`, [k.atama_ref, yeniBitis]);
  if (karar === 'Askıya Al' || karar === 'Kapat') {
    await c.query(`UPDATE rol_atamasi SET atama_durumu = $2 WHERE kimlik = $1`, [k.atama_ref, karar === 'Kapat' ? 'Kapalı' : 'Askıda']);
    await c.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Yetki değişikliği' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [k.kullanici_ref]); // YG-1048
  }
}
async function kapanisKontrol(c: Db, inceleme: string) {
  if (Number((await c.query(`SELECT count(*) n FROM erisim_inceleme_kalemi WHERE inceleme_ref = $1 AND karar IS NULL`, [inceleme])).rows[0].n)) return;
  await c.query(`UPDATE erisim_inceleme SET durum = 'Tamamlandı' WHERE kimlik = $1`, [inceleme]);
  await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [KART, inceleme]);
}

/** YG-1047: süresinde yanıtlanmayan inceleme Direktöre yükselir; 14 gün daha yanıt gelmezse güvenli varsayılan Askıya Al uygulanır. */
export async function erisimEskalasyon(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const btd = await rolId(db, BTD);
  for (const r of (await db.query(`SELECT kimlik, donem, eskalasyon_zamani FROM erisim_inceleme WHERE durum = 'Açık' AND son_zaman < $1`, [simdi])).rows) {
    if (!r.eskalasyon_zamani) { await db.query(`UPDATE erisim_inceleme SET eskalasyon_zamani = $2 WHERE kimlik = $1`, [r.kimlik, simdi]); await bildir(db, { olay: `erisim-esk:${r.kimlik}`, kullanicilar: await rolSahipleri(db, btd), baslik: `${r.donem} Erişim İncelemesi Süresinde Yanıtlanmadı`, oncelik: 'Yüksek' }, simdi); n++; continue; }
    if (simdi.getTime() - new Date(r.eskalasyon_zamani).getTime() < 14 * 86_400_000) continue;
    for (const k of (await db.query(`SELECT * FROM erisim_inceleme_kalemi WHERE inceleme_ref = $1 AND karar IS NULL`, [r.kimlik])).rows) { await kararUygula(db, k, 'Askıya Al', null); await db.query(`UPDATE erisim_inceleme_kalemi SET karar = 'Askıya Al', gerekce = 'Süresinde yanıtlanmadı; güvenli varsayılan.', uygulandi = true, karar_zamani = now() WHERE kimlik = $1`, [k.kimlik]); n++; }
    await kapanisKontrol(db, r.kimlik);
  }
  return n;
}

/** YG-1049: kullanılmayan dış hesap 90. günde askıya alınır, 180. günde kapatılır. */
export async function disHesapPasifIsle(db: Pool, simdi = new Date()): Promise<number> {
  const K = `kullanici_grubu NOT IN ('LGM İç Rolü', 'Sistem/Hizmet Hesabı') AND coalesce(son_giris_zamani, olusturma_zamani) <`;
  const a = await db.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Kapalı', kapanma_zamani = $1 WHERE hesap_durumu <> 'Kapalı' AND ${K} $1::timestamptz - interval '180 days' RETURNING kimlik`, [simdi]);
  const b = await db.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Askıda' WHERE hesap_durumu = 'Aktif' AND ${K} $1::timestamptz - interval '90 days' RETURNING kimlik`, [simdi]);
  const l = [...a.rows, ...b.rows].map((r) => r.kimlik as string);
  if (l.length) await db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = ANY($1::text[]) AND bitis_zamani IS NULL`, [l]);
  return l.length;
}

export function erisimIncelemeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkiliMi = async (k: string, l: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, l])).rowCount);

  // YG-1045: rol açıklaması, görev, son giriş ve önceki karar görünür.
  s.get('/erisim-inceleme', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const acik = (await b.db.query(`SELECT kimlik, donem, kapsam, rol_ref, son_zaman FROM erisim_inceleme WHERE durum = 'Açık' ORDER BY olusturma_zamani`)).rows;
    const r = [];
    for (const x of acik) {
      if (!(await rolSahipleri(b.db, x.rol_ref)).includes(o.kullanici)) continue;
      const kalemler = (await b.db.query(`SELECT k.kimlik, h.ad_soyad, h.son_giris_zamani, r.rol_adi, r.kademe, r.ayricalikli_rol, k.karar, (SELECT p.karar FROM erisim_inceleme_kalemi p WHERE p.atama_ref = k.atama_ref AND p.karar IS NOT NULL AND p.kimlik <> k.kimlik ORDER BY p.karar_zamani DESC LIMIT 1) onceki FROM erisim_inceleme_kalemi k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref JOIN rol r ON r.kimlik = k.rol_ref WHERE k.inceleme_ref = $1 ORDER BY h.ad_soyad`, [x.kimlik])).rows;
      r.push({ kimlik: x.kimlik, donem: x.donem, kapsam: x.kapsam, son: x.son_zaman, kalemler });
    }
    return r;
  });
  s.post('/erisim-inceleme/kalem/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; gerekce?: string; yeniBitis?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT k.*, e.rol_ref makam, e.kimlik inceleme FROM erisim_inceleme_kalemi k JOIN erisim_inceleme e ON e.kimlik = k.inceleme_ref WHERE k.kimlik = $1 AND e.durum = 'Açık'`, [id])).rows[0];
    if (!k || !(await rolSahipleri(b.db, k.makam)).includes(o.kullanici)) return yok(y);
    if (k.kullanici_ref === o.kullanici) return y.code(403).send({ hata: 'Kendi erişiminiz için karar veremezsiniz.' });
    if (!KARARLAR.includes(g.karar ?? '') || (g.karar !== 'Koru' && !g.gerekce?.trim()) || (g.karar === 'Süre Uzat' && !/^\d{4}-\d{2}-\d{2}$/.test(g.yeniBitis ?? ''))) return y.code(400).send({ hata: 'Karar geçersizdir; Koru dışında gerekçe, süre uzatmada yeni bitiş zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const daralt = g.karar === 'Daralt';
      const u = await c.query(`UPDATE erisim_inceleme_kalemi SET karar = $2, gerekce = $3, karar_ref = $4, karar_zamani = now(), uygulandi = $5 WHERE kimlik = $1 AND karar IS NULL`, [id, g.karar, g.gerekce?.trim() || null, o.kullanici, !daralt]);
      if (!u.rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu kalem için karar verilmiştir.' }); }
      await kararUygula(c, k, g.karar!, g.yeniBitis ?? null);
      if (daralt) await kartAc(c, { tur: 'Erişim Daraltma', kategori: 'islem', baslik: 'Erişim Daraltma Uygulaması', ozet: g.gerekce!.trim().slice(0, 200), sahipRol: await rolId(c, 'Sistem Yöneticisi'), nesneTuru: 'Erişim Kalemi', nesneKimligi: id });
      else if (g.karar !== 'Koru') await bildir(c, { olay: `erisim-uygulandi:${id}`, kullanicilar: [o.kullanici], baslik: `Uygulandı: Erişim Kararı (${g.karar})` }); // YG-1644
      await kapanisKontrol(c, k.inceleme);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Erişim İnceleme Kararı', nesneTuru: 'Erişim Kalemi', nesneKimligi: id, yeni: { karar: g.karar }, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
  // YG-1644: daraltma Sistem Yöneticisince uygulanır, kararı verene "Uygulandı" gider.
  s.post('/erisim-inceleme/kalem/:id/uygulandi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await yetkiliMi(o.kullanici, ['Sistem Yöneticisi']))) return yok(y);
    const r = (await b.db.query(`UPDATE erisim_inceleme_kalemi SET uygulandi = true WHERE kimlik = $1 AND karar = 'Daralt' AND NOT uygulandi RETURNING karar_ref`, [id])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Uygulanacak daraltma bulunmamaktadır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Erişim Daraltma' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await bildir(b.db, { olay: `erisim-uygulandi:${id}`, kullanicilar: [r.karar_ref], baslik: 'Uygulandı: Erişim Kararı (Daralt)' });
    return { tamam: true };
  });

  // YG-1051: askıya alma ve kapatma ayrı işlemler; yüksek riskte yetkili yönetici derhâl askıya alır.
  for (const [yol, durum, eylem] of [['askiya-al', 'Askıda', 'Hesap Askıya Alındı'], ['kapat', 'Kapalı', 'Hesap Kapatıldı'], ['ac', 'Aktif', 'Hesap Açıldı']] as const) {
    s.post(`/guvenlik/hesap/:id/${yol}`, oturumlu, async (i, y) => {
      const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gerekce?: string };
      if (!(await yetkiliMi(o.kullanici, YONETICI))) return yok(y);
      if (id === o.kullanici) return y.code(403).send({ hata: 'Kendi hesabınız için işlem yapamazsınız.' });
      if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
      const u = await b.db.query(`UPDATE kullanici_hesabi SET hesap_durumu = $2, kapanma_zamani = CASE WHEN $2 = 'Kapalı' THEN now() ELSE kapanma_zamani END WHERE kimlik = $1 AND hesap_durumu <> 'Kapalı' RETURNING kimlik`, [id, durum]);
      if (!u.rowCount) return y.code(409).send({ hata: 'Kapalı hesap değiştirilemez veya hesap bulunamadı.' });
      if (durum !== 'Aktif') await b.db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [id]);
      await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem, nesneTuru: 'Kullanıcı', nesneKimligi: id, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { tamam: true };
    });
  }
}
