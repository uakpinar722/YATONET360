import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const BTM = 'Bilgi İşlem Müdürü'; const BIMY = 'Bilgi İşlem Müdür Yardımcısı'; const PAKET = 'Erişim İnceleme Paketi'; const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'; const KART = 'Erişim İncelemesi';
const BIRIM_MUDUR = ['Operasyon Müdürü', 'Teknik Müdür', 'Tedarik Yönetimi Müdürü', 'Muhasebe ve Finans Müdürü', 'İnsan Kaynakları Müdürü', 'İdari İşler Müdürü'];
const YONETICI = [BTM, BTD, 'İnsan Kaynakları Müdürü'];
const KARARLAR = ['Koru', 'Daralt', 'Süre Uzat', 'Askıya Al', 'Kapat'];
const KALEM = `SELECT a.kimlik atama, a.kullanici_ref, a.rol_ref FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND h.hesap_durumu = 'Aktif'`;

async function incelemeAc(db: Db, baslik: string, makam: string, kapsam: string, donem: string, sql: string, prm: unknown[], simdi: Date, paket = false) {
  const atamalar = (await db.query(sql, prm)).rows; if (!atamalar.length) return;
  const son = await isGunuSonu(db, simdi, 10);
  const i = (await db.query(`INSERT INTO erisim_inceleme (donem, kapsam, rol_ref, son_zaman, paket) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [donem, kapsam, makam, son, paket])).rows[0].kimlik;
  for (const a of atamalar) await db.query(`INSERT INTO erisim_inceleme_kalemi (inceleme_ref, atama_ref, kullanici_ref, rol_ref) VALUES ($1,$2,$3,$4)`, [i, a.atama, a.kullanici_ref, a.rol_ref]);
  await kartAc(db, { tur: KART, kategori: 'gorev', baslik: `${donem} · ${baslik}`, ozet: `${atamalar.length} erişim`, sahipRol: makam, sonZaman: son, nesneTuru: 'Erişim İncelemesi', nesneKimligi: i });
}

/** YG-1046, YG-1639: ayrıcalıklı hesaplar 3 ayda bir, diğerleri 6 ayda bir; birim müdürleri kendi birimini inceler. */
export async function erisimIncelemeAc(db: Pool, simdi = new Date()): Promise<void> {
  const y = simdi.getUTCFullYear(); const c = Math.floor(simdi.getUTCMonth() / 3) + 1; const btm = await rolId(db, BTM);
  // YG-1645 (A34): Müdür Yardımcısı görevdeyse paketi o hazırlar ve Bilgi İşlem Müdürü onayına gönderir; yoksa Müdür doğrudan karar verir.
  const bimy = await rolId(db, BIMY); const paket = (await rolSahipleri(db, bimy)).length > 0;
  if (await birKez(db, 'erisim_inceleme_ayricalikli', `${y}-Q${c}`)) await incelemeAc(db, paket ? 'Üç Aylık Ayrıcalıklı Hesap Erişim İnceleme Paketi' : 'Ayrıcalıklı Hesap İncelemesi', paket ? bimy : btm, 'Ayrıcalıklı', `${y}-Q${c}`, `${KALEM} AND r.ayricalikli_rol`, [], simdi, paket);
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
    await kaldirmaDogrula(c, k.atama_ref);
  }
}

/**
 * YG-1048: kaldırılan rolün erişim vermeye devam etmediği doğrulanır: atama etkin değil, aynı role vekâlet yolu yok, yalnız bu rolden gelen
 * izinler kişide kalmamış, açık oturum yok. Ayrıcalıklı rolde uygulama dışı sistemlerin (veritabanı, sunucu, uzak bağlantı) kapatılması görevle istenir.
 * Sonuç inceleme kalemine yazılır; aykırılıkta Bilgi İşlem Müdürüne görev açılır.
 */
export async function kaldirmaDogrula(c: Db, atama: string) {
  const a = (await c.query(`SELECT a.kullanici_ref, a.rol_ref, a.atama_durumu, r.rol_adi, r.ayricalikli_rol FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kimlik = $1`, [atama])).rows[0];
  if (!a) return null;
  const rolEtkin = a.atama_durumu === 'Aktif';
  const vekalet = Boolean((await c.query(`SELECT 1 FROM vekalet WHERE vekil_ref = $1 AND rol_ref = $2 AND durum = 'Aktif' AND bitis_tarihi >= current_date`, [a.kullanici_ref, a.rol_ref])).rowCount);
  const kalan = (await c.query(`SELECT z.izin FROM rol_izni z WHERE z.rol_ref = $2 AND EXISTS (SELECT 1 FROM rol_izni y JOIN rol_atamasi x ON x.rol_ref = y.rol_ref WHERE x.kullanici_ref = $1 AND x.atama_durumu = 'Aktif' AND x.rol_ref <> $2 AND y.izin = z.izin) IS FALSE
      AND EXISTS (SELECT 1 FROM rol_izni y JOIN rol_atamasi x ON x.rol_ref = y.rol_ref WHERE x.kullanici_ref = $1 AND x.atama_durumu = 'Aktif' AND y.izin = z.izin)`, [a.kullanici_ref, a.rol_ref])).rows.map((r) => r.izin as string);
  const oturum = Number((await c.query(`SELECT count(*) n FROM oturum WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [a.kullanici_ref])).rows[0].n);
  const sonuc = { rolEtkin, vekaletYolu: vekalet, kalanIzin: kalan, acikOturum: oturum, ayriSistemKontrolu: Boolean(a.ayricalikli_rol), zaman: new Date().toISOString() };
  await c.query(`UPDATE erisim_inceleme_kalemi SET kaldirma_dogrulama = $2 WHERE atama_ref = $1`, [atama, JSON.stringify(sonuc)]);
  const bim = (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Bilgi İşlem Müdürü'`)).rows[0]?.kimlik;
  if (rolEtkin || vekalet || kalan.length || oturum) await kartAc(c, { tur: 'Rol Kaldırma Doğrulaması', kategori: 'islem', baslik: `Erişim Sürüyor · ${a.rol_adi}`, ozet: [rolEtkin && 'rol ataması etkin', vekalet && 'aynı role vekâlet sürüyor', kalan.length && `kalan izin: ${kalan.join(', ')}`, oturum && `${oturum} açık oturum`].filter(Boolean).join(' · '), oncelik: 'Yüksek', sahipRol: bim, nesneTuru: 'Rol Ataması', nesneKimligi: atama });
  if (a.ayricalikli_rol) await kartAc(c, { tur: 'Ayrı Sistem Erişimi Kontrolü', kategori: 'islem', baslik: `Ayrı Sistem Erişimini Kapat · ${a.rol_adi}`, ozet: 'Ayrıcalıklı rol kaldırıldı. Veritabanı, sunucu, uzak bağlantı ve acil erişim sırlarının kapatıldığını doğrulayınız.', oncelik: 'Yüksek', sahipRol: bim, nesneTuru: 'Rol Ataması', nesneKimligi: atama });
  return sonuc;
}
async function kapanisKontrol(c: Db, inceleme: string) {
  if (Number((await c.query(`SELECT count(*) n FROM erisim_inceleme_kalemi WHERE inceleme_ref = $1 AND karar IS NULL`, [inceleme])).rows[0].n)) return;
  await c.query(`UPDATE erisim_inceleme SET durum = 'Tamamlandı' WHERE kimlik = $1`, [inceleme]);
  await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [KART, inceleme]);
}

/** YG-1645: paket onaylanınca öneriler karar olarak uygulanır; iade veya retle paket Müdür Yardımcısına döner. */
kapanisKaydet(PAKET, async (c, k, karar, yapan) => {
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return;
  const e = (await c.query(`SELECT kimlik, donem, rol_ref FROM erisim_inceleme WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi])).rows[0]; if (!e) return;
  if (karar !== 'Onayla') {
    await c.query(`UPDATE erisim_inceleme SET durum = 'Açık' WHERE kimlik = $1`, [e.kimlik]);
    await kartAc(c, { tur: KART, kategori: 'gorev', baslik: `${e.donem} · ${PAKET} · İade Edildi`, ozet: 'Bilgi İşlem Müdürü paketi geri gönderdi; önerileri gözden geçirip yeniden gönderiniz.', sahipRol: e.rol_ref, nesneTuru: 'Erişim İncelemesi', nesneKimligi: e.kimlik });
    return;
  }
  for (const x of (await c.query(`SELECT * FROM erisim_inceleme_kalemi WHERE inceleme_ref = $1 AND karar IS NULL`, [e.kimlik])).rows) {
    const daralt = x.oneri === 'Daralt';
    await c.query(`UPDATE erisim_inceleme_kalemi SET karar = oneri, gerekce = oneri_gerekce, karar_ref = $2, karar_zamani = now(), uygulandi = $3 WHERE kimlik = $1`, [x.kimlik, yapan, !daralt]);
    await kararUygula(c, x, x.oneri, x.oneri_bitis ? new Date(x.oneri_bitis).toISOString().slice(0, 10) : null);
    if (daralt) await kartAc(c, { tur: 'Erişim Daraltma', kategori: 'islem', baslik: 'Erişim Daraltma Uygulaması', ozet: String(x.oneri_gerekce ?? '').slice(0, 200), sahipRol: await rolId(c, 'Sistem Yöneticisi'), nesneTuru: 'Erişim Kalemi', nesneKimligi: x.kimlik });
  }
  await kapanisKontrol(c, e.kimlik);
});

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
  for (const r of a.rows) await (await import('./hesap_devri.js')).hesapKapanisDevri(db, r.kimlik as string); // YG-1054: kapanan dış hesabın görev ve belge sorumluluğu
  return l.length;
}

export function erisimIncelemeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkiliMi = async (k: string, l: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, l])).rowCount);

  // YG-1045: rol açıklaması, görev, son giriş ve önceki karar görünür.
  s.get('/erisim-inceleme', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const acik = (await b.db.query(`SELECT kimlik, donem, kapsam, rol_ref, son_zaman, paket FROM erisim_inceleme WHERE durum = 'Açık' ORDER BY olusturma_zamani`)).rows;
    const r = [];
    for (const x of acik) {
      if (!(await rolSahipleri(b.db, x.rol_ref)).includes(o.kullanici)) continue;
      const kalemler = (await b.db.query(`SELECT k.kimlik, h.ad_soyad, h.son_giris_zamani, r.rol_adi, r.kademe, r.ayricalikli_rol, k.karar, k.oneri, k.oneri_gerekce, (SELECT string_agg(z.izin, ', ' ORDER BY z.izin) FROM rol_izni z WHERE z.rol_ref = k.rol_ref) izinler, (SELECT p.karar FROM erisim_inceleme_kalemi p WHERE p.atama_ref = k.atama_ref AND p.karar IS NOT NULL AND p.kimlik <> k.kimlik ORDER BY p.karar_zamani DESC LIMIT 1) onceki FROM erisim_inceleme_kalemi k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref JOIN rol r ON r.kimlik = k.rol_ref WHERE k.inceleme_ref = $1 ORDER BY h.ad_soyad`, [x.kimlik])).rows;
      r.push({ kimlik: x.kimlik, donem: x.donem, kapsam: x.kapsam, son: x.son_zaman, paket: x.paket, kalemler });
    }
    return r;
  });
  s.post('/erisim-inceleme/kalem/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; gerekce?: string; yeniBitis?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT k.*, e.rol_ref makam, e.kimlik inceleme, e.paket FROM erisim_inceleme_kalemi k JOIN erisim_inceleme e ON e.kimlik = k.inceleme_ref WHERE k.kimlik = $1 AND e.durum = 'Açık'`, [id])).rows[0];
    if (!k || !(await rolSahipleri(b.db, k.makam)).includes(o.kullanici)) return yok(y);
    if (k.kullanici_ref === o.kullanici) return y.code(403).send({ hata: 'Kendi erişiminizle ilgili kararın başka bir yetkili tarafından verilmesini rica ederiz.' });
    if (!KARARLAR.includes(g.karar ?? '') || (g.karar !== 'Koru' && !g.gerekce?.trim()) || (g.karar === 'Süre Uzat' && !/^\d{4}-\d{2}-\d{2}$/.test(g.yeniBitis ?? ''))) return y.code(400).send({ hata: 'Karar geçersizdir; Koru dışında gerekçe, süre uzatmada yeni bitiş zorunludur.' });
    // YG-1645: pakette Müdür Yardımcısı öneri yazar; karar Bilgi İşlem Müdürü onayıyla uygulanır.
    if (k.paket) {
      await b.db.query(`UPDATE erisim_inceleme_kalemi SET oneri = $2, oneri_gerekce = $3, oneri_bitis = $4 WHERE kimlik = $1`, [id, g.karar, g.gerekce?.trim() || null, g.karar === 'Süre Uzat' ? g.yeniBitis : null]);
      return { oneri: true };
    }
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
  s.post('/erisim-inceleme/:id/onaya-gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT * FROM erisim_inceleme WHERE kimlik = $1 AND paket AND durum = 'Açık'`, [id])).rows[0];
    if (!e || !(await rolSahipleri(b.db, e.rol_ref)).includes(o.kullanici)) return yok(y);
    const l = (await b.db.query(`SELECT kullanici_ref, oneri FROM erisim_inceleme_kalemi WHERE inceleme_ref = $1 AND karar IS NULL`, [id])).rows;
    if (l.some((x) => !x.oneri)) return y.code(409).send({ hata: 'Paketteki tüm kalemlere öneri yazınız.' });
    const ist = l.filter((x) => x.oneri !== 'Koru').length;
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE erisim_inceleme SET durum = 'Onayda', hazirlayan_ref = $2 WHERE kimlik = $1`, [id, o.kullanici]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [KART, id]);
      // Paketteki kişi kendi erişimini onaylayamaz (ayrik): makam bir üste çıkar.
      await kartAc(c, { tur: PAKET, baslik: `${e.donem} · ${PAKET}`, ozet: `${l.length} ayrıcalıklı erişim · ${ist} istisna`, hazirlayan: o.kullanici, ayrik: l.map((x) => x.kullanici_ref as string), zincir: [await rolId(c, BTM)], nesneTuru: 'Erişim İncelemesi', nesneKimligi: id });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Erişim İnceleme Paketi Onaya Gönderildi', nesneTuru: 'Erişim İncelemesi', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    return { durum: 'Onayda', makam: BTM };
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
      if (id === o.kullanici) return y.code(403).send({ hata: 'Kendi hesabınızla ilgili işlemin başka bir yetkili tarafından yapılmasını rica ederiz.' });
      if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
      const u = await b.db.query(`UPDATE kullanici_hesabi SET hesap_durumu = $2, kapanma_zamani = CASE WHEN $2 = 'Kapalı' THEN now() ELSE kapanma_zamani END WHERE kimlik = $1 AND hesap_durumu <> 'Kapalı' RETURNING kimlik`, [id, durum]);
      if (!u.rowCount) return y.code(409).send({ hata: 'Hesap kapalıdır veya bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
      if (durum !== 'Aktif') await b.db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [id]);
      await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem, nesneTuru: 'Kullanıcı', nesneKimligi: id, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { tamam: true };
    });
  }
}
