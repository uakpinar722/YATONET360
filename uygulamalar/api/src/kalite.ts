import { izYaz } from './denetim.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { kapanisKapisi } from './saha.js';
import { altNumara } from './sure.js';
import { UUID } from './yat.js';
import { gunAy } from './metin.js';
import { pdfUret, type Bolum } from './pdf.js';

type Db = Pool | PoolClient;
const KK = 'Kalite Uzmanı (Kalite Kontrolör)';
const KM = 'Kalite Müdürü';

/** YG-283: A sınıfı işte Minör olamaz; emniyeti etkiliyorsa Kritik; hasar önemi Kritik/Yüksek işte en az Majör. */
export function sinifEngeli(sinif: string, kabulSinifi: string | null, hasarOnemi: string | null, emniyet: boolean): string | null {
  if (emniyet && sinif !== 'Kritik') return 'Emniyeti etkileyen uygunsuzluk Kritik sınıfındadır.';
  if (kabulSinifi === 'A' && sinif === 'Minör') return 'A sınıfı işte uygunsuzluk Minör dışında bir sınıfla kaydedilir.';
  if ((hasarOnemi === 'Kritik' || hasarOnemi === 'Yüksek') && (sinif === 'Minör' || sinif === 'Gözlem')) return 'Hasar önemi Kritik veya Yüksek olan işte uygunsuzluk en az Majördür.';
  return null;
}

/** YG-284, YG-395: Minör 120 saat düzeltme, Majör 48 saat düzeltici plan; Kritik ve Emniyette iş derhal durur. */
export function ncrHedefi(sinif: string, simdi = new Date()): Date | null {
  const s = sinif === 'Minör' ? 120 : sinif === 'Majör' ? 48 : null;
  return s === null ? null : new Date(simdi.getTime() + s * 3_600_000);
}

/** YG-389: serbest bırakma onayı kabul sınıfına göre. */
export const SERBEST_ROLLERI: Record<string, string[]> = { A: ['Teknik Yönetici', KM], B: ['Teknik Uzman', KK], C: [KK], D: ['Teknik Uzman'] };

/** YG-402: geçerlilik bitişi işlem tarihi + aralık; kabul kararı Hayır ise cihaz kullanılamaz. */
export function cihazGecerli(c: { kalibrasyon_tarihi: Date | string; aralik_ay: number; kabul: boolean; durum?: string; kritik?: boolean; ara_dogrulama_tarihi?: Date | string | null }, simdi = new Date()): boolean {
  if (!c.kabul || c.durum === 'Karantina') return false;
  const b = new Date(c.kalibrasyon_tarihi); b.setMonth(b.getMonth() + c.aralik_ay);
  if (b < simdi) return false;
  // YG-402: kritik cihazda son kalibrasyondan ya da son ara doğrulamadan itibaren 6 ayda bir ara doğrulama gerekir.
  if (c.kritik) { const a = new Date(c.ara_dogrulama_tarihi ?? c.kalibrasyon_tarihi); a.setMonth(a.getMonth() + 6); if (a < simdi) return false; }
  return true;
}

/** YG-373: kapalı alan ve sıcak işte oksijen %19,5–23,5; yanıcı gaz alt patlama sınırının %10'unun altında. */
export function gazUygun(oksijen: number, yanici: number): boolean { return oksijen >= 19.5 && oksijen <= 23.5 && yanici < 10; }

/** YG-288: onarım, ek iş, garanti ve planlı hizmet işinde onaylı plan olmadan iş sahaya serbest bırakılmaz. Keşif ve acil iş plandan önce başlar (V-51). */
export async function planEngeli(db: Db, dosya: string, tur: string): Promise<string | null> {
  if (tur === 'KN' || tur === 'AC') return null;
  return (await db.query(`SELECT 1 FROM kalite_plani WHERE dosya_ref = $1 AND durum = 'Onaylı' LIMIT 1`, [dosya])).rowCount ? null : 'İşe özgü kalite planı onaylanmadan iş sahaya serbest bırakılamaz.';
}

/** YG-391: açık Emniyet işaretli uygunsuzluk sonraki işi ve teslimi durdurur. */
export async function emniyetEngeli(db: Db, dosya: string): Promise<string | null> {
  return (await db.query(`SELECT 1 FROM uygunsuzluk WHERE dosya_ref = $1 AND emniyet_isareti AND statu NOT IN ('Kapalı', 'Geçersiz') LIMIT 1`, [dosya])).rowCount ? 'Açık Emniyet işaretli uygunsuzluk vardır.' : null;
}

/** YG-371, YG-383: ilerleme öncesi kapılar: bekletme noktası serbest bırakılmış, gerekiyorsa geçerli çalışma izni yüklenmiş olmalı. */
export async function ilerlemeEngeli(db: Db, e: { kimlik: string; dosya_ref: string; calisma_izni_gerekli: boolean }, kalem: string | null): Promise<string | null> {
  const em = await emniyetEngeli(db, e.dosya_ref);
  if (em) return em;
  if ((await db.query(`SELECT 1 FROM kontrol_noktasi WHERE is_emri_ref = $1 AND nokta_turu = 'Bekletme' AND serbest_birakma_zamani IS NULL AND ($2::text IS NULL OR kalem IS NULL OR kalem = $2) LIMIT 1`, [e.kimlik, kalem])).rowCount) return 'Bekletme noktası serbest bırakılmadan sonraki adım açılmaz.';
  if (e.calisma_izni_gerekli && !(await db.query(`SELECT 1 FROM calisma_izni_belgesi WHERE is_emri_ref = $1 AND baslangic <= now() AND bitis > now() AND kapanis_zamani IS NULL LIMIT 1`, [e.kimlik])).rowCount) return 'Güvenliğiniz için geçerli çalışma izni belgesi bekleniyor; süresi dolan izni yenilemenizi rica ederiz.';
  return null;
}

/** YG-281, YG-287, YG-289: kabul kapısı. Açık Kritik, başarısız son test veya kanıtsız gereklilikte kabul yok; koşullu kabul yalnız Minör açıkta. */
export async function kabulEngeli(db: Db, e: { kimlik: string; dosya_ref: string }, sonuc: string): Promise<string | null> {
  if (sonuc === 'Ret') return null;
  const acik = (await db.query(`SELECT sinif, emniyet_isareti FROM uygunsuzluk WHERE (is_emri_ref = $1 OR (is_emri_ref IS NULL AND dosya_ref = $2)) AND statu NOT IN ('Kapalı', 'Geçersiz')`, [e.kimlik, e.dosya_ref])).rows;
  if (acik.some((n) => n.sinif === 'Kritik' || n.emniyet_isareti)) return 'Kabul için açık Kritik uygunsuzluğun kapanması bekleniyor.';
  if (acik.some((n) => n.sinif === 'Majör')) return 'Koşullu kabul yalnız Minör açık işler için verilir; Majör uygunsuzluk açıktır.';
  if (sonuc === 'Kabul' && acik.some((n) => n.sinif === 'Minör')) return 'Açık Minör uygunsuzluk varken yalnız koşullu kabul verilir.';
  // Yenilenmemiş son testler bakılır; yeniden test başarılıysa önceki başarısız kayıt kalır ama kapıyı tutmaz.
  if ((await db.query(`SELECT 1 FROM test_kaydi t WHERE t.dosya_ref = $1 AND (t.sonuc = 'Başarısız' OR t.durum <> 'Tamamlandı') AND NOT EXISTS (SELECT 1 FROM test_kaydi n WHERE n.onceki_test_ref = t.kimlik) LIMIT 1`, [e.dosya_ref])).rowCount) return 'Kabul için Başarısız veya tamamlanmamış testin sonuçlanması bekleniyor.';
  if (sonuc === 'Kabul' && (await db.query(`SELECT 1 FROM gereklilik_satiri g JOIN kalite_plani p ON p.kimlik = g.plan_ref WHERE p.dosya_ref = $1 AND p.durum = 'Onaylı' AND g.durum = 'Açık' LIMIT 1`, [e.dosya_ref])).rowCount) return 'Teknik kabul için kanıta bağlanmamış gerekliliğin tamamlanması bekleniyor.';
  return null;
}

/** YG-287, YG-290, YG-395: süre işleyici. */
/** YG-1689: her Pazartesi (İstanbul) haftalık uygunsuzluk süre raporu görevi; açık, süresi geçen, 48 saat içinde dolacak ve sınıf dağılımı özetlenir. Haftada bir kez. */
export async function uygunsuzlukHaftalikRapor(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); if (ist.getUTCDay() !== 1) return false;
  const { birKez } = await import('./bildirim.js'); const { haftaAnahtari } = await import('./uyum_tarama.js');
  if (!(await birKez(db, 'uygunsuzluk_haftalik', haftaAnahtari(simdi)))) return false;
  const s = (await db.query(`SELECT count(*)::int acik, count(*) FILTER (WHERE hedef_zamani < $1)::int gecen, count(*) FILTER (WHERE hedef_zamani BETWEEN $1 AND $1::timestamptz + interval '48 hours')::int yaklasan,
      count(*) FILTER (WHERE sinif = 'Kritik')::int kritik, count(*) FILTER (WHERE sinif = 'Majör')::int major, count(*) FILTER (WHERE sinif = 'Minör')::int minor
    FROM uygunsuzluk WHERE statu NOT IN ('Kapalı', 'Geçersiz')`, [simdi])).rows[0];
  const kmy = await rolId(db, 'Kalite Müdür Yardımcısı'); const sahip = (await rolSahipleri(db, kmy)).length ? kmy : await rolId(db, KM);
  const son = new Date(simdi.getTime() + 8 * 3_600_000);
  await kartAc(db, { tur: 'Haftalık Uygunsuzluk Süre Raporu', kategori: 'gorev', baslik: `${haftaAnahtari(simdi)} · Haftalık Uygunsuzluk Süre Raporu`, ozet: `Açık ${s.acik} (Kritik ${s.kritik}, Majör ${s.major}, Minör ${s.minor}) · Süresi geçen ${s.gecen} · 48 saat içinde dolacak ${s.yaklasan}. Süresi geçenlerde sorumlularla görüşüp gerekirse Kalite Müdürüne iletiniz.`, oncelik: s.gecen ? 'Yüksek' : 'Normal', sahipRol: sahip, sonZaman: son, nesneTuru: 'Uygunsuzluk Haftası', nesneKimligi: haftaAnahtari(simdi) });
  return true;
}

export async function kaliteSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  if (await uygunsuzlukHaftalikRapor(db, simdi)) n++;
  for (const u of (await db.query(`SELECT u.kimlik, u.uygunsuzluk_no, u.sinif FROM uygunsuzluk u WHERE u.hedef_zamani < $1 AND u.statu NOT IN ('Kapalı', 'Geçersiz') AND NOT EXISTS (SELECT 1 FROM is_karti k WHERE k.tur = 'Uygunsuzluk Süre Aşımı' AND k.nesne_kimligi = u.kimlik::text)`, [simdi])).rows) {
    await kartAc(db, { tur: 'Uygunsuzluk Süre Aşımı', kategori: 'islem', baslik: `${u.uygunsuzluk_no} · Süre Aşımı`, ozet: u.sinif, oncelik: 'Yüksek', sahipRol: await rolId(db, KM), nesneTuru: 'Uygunsuzluk', nesneKimligi: u.kimlik }); n++;
  }
  const bugun = new Date(simdi.getTime() + 180 * 60_000).toISOString().slice(0, 10);
  for (const k of (await db.query(`SELECT a.kimlik, a.dosya_ref, d.dosya_sorumlusu_ref FROM kabul_kaydi a JOIN dosya d ON d.kimlik = a.dosya_ref WHERE a.kabul_turu = 'Koşullu Kabul' AND a.kosul_bitis < $1::date AND EXISTS (SELECT 1 FROM acik_is_kalemi p WHERE p.kabul_ref = a.kimlik AND p.kapanis_zamani IS NULL) AND NOT EXISTS (SELECT 1 FROM beklemede_isareti b WHERE b.dosya_ref = a.dosya_ref AND b.neden = 'Koşullu Kabul Süresi Doldu' AND b.kaldirilma_zamani IS NULL)`, [bugun])).rows) {
    await db.query(`INSERT INTO beklemede_isareti (dosya_ref, neden, sorumlu_ref, hedef_tarih, durum_mesaji, sayac_durur, olusturan_ref) VALUES ($1,'Koşullu Kabul Süresi Doldu',$2,$3,'Açık işler bekleniyor',false,$2)`, [k.dosya_ref, k.dosya_sorumlusu_ref, bugun]);
    await db.query(`UPDATE acik_is_kalemi SET gecikti = true WHERE kabul_ref = $1 AND kapanis_zamani IS NULL`, [k.kimlik]); n++;
  }
  return n;
}

// YG-1692: Kalite Müdürü uzatma talebini onaylarsa koşul süresi bir kez 15 gün uzar.
kapanisKaydet('Koşullu Kabul Uzatma', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE kabul_kaydi SET kosul_bitis = kosul_bitis + 15, uzatildi = true WHERE kimlik = $1 AND kabul_turu = 'Koşullu Kabul' AND NOT uzatildi`, [k.nesne_kimligi]);
});

kapanisKaydet('Kalite Planı', async (c, k, karar) => {
  if (karar === 'Onayla') {
    const p = (await c.query(`UPDATE kalite_plani p SET durum = 'Onaylı' FROM dosya d WHERE p.kimlik = $1 AND d.kimlik = p.dosya_ref RETURNING p.dosya_ref, p.kabul_sinifi, d.dosya_no, d.oncelik`, [k.nesne_kimligi])).rows[0];
    // YG-1485: kabul sınıflı planda Kalite Kontrolör atanmamışsa Kalite Müdürüne atama görevi açılır.
    // YG-1687: görev Kalite Yöneticisine (atanmamışsa Kalite Müdürüne); 24 saat, Kritik dosyada 8 saat ve Kritik öncelik.
    if (p && !(await c.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Kalite Kontrolör' AND bitis_zamani IS NULL`, [p.dosya_ref])).rowCount) {
      const ky = await rolId(c, 'Kalite Yöneticisi'); const kritik = p.oncelik === 'Kritik';
      await kartAc(c, { tur: 'Kalite Kontrolör Ataması', kategori: 'islem', baslik: `${p.dosya_no} · Kalite Kontrolör Ata`, ozet: `${p.kabul_sinifi} sınıfı kalite planı onaylandı`, oncelik: kritik ? 'Kritik' : 'Yüksek', sonZaman: new Date(Date.now() + (kritik ? 8 : 24) * 3_600_000), sahipRol: (await rolSahipleri(c, ky)).length ? ky : await rolId(c, KM), nesneTuru: 'Dosya', nesneKimligi: p.dosya_ref });
    }
  }
  else if (karar === 'Reddet') await c.query(`UPDATE kalite_plani SET durum = 'Reddedildi' WHERE kimlik = $1`, [k.nesne_kimligi]);
});

kapanisKapisi(async (db, d) => ((await db.query(`SELECT 1 FROM uygunsuzluk WHERE dosya_ref = $1 AND statu NOT IN ('Kapalı', 'Geçersiz') LIMIT 1`, [d.kimlik])).rowCount ? 'Açık Uygunsuzluk' : null));

export function kaliteYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2) LIMIT 1`, [k, r])).rowCount);
  const erisim = async (dosya: string, k: string) => UUID.test(dosya) && await dosyaErisimi(b.db, k, dosya);
  const TEKNIK = ['Teknik Uzman', 'Teknik Yönetici', 'Teknik Müdür', 'Sorumlu Teknik Uzman (Koordinatör)', 'Saha Sorumlusu'];
  const firmam = async (k: string) => (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;

  // YG-288, YG-289: plan Teknik Uzmandan; Teknik Yönetici, A sınıfında Teknik Müdür onaylar. Her gereklilik doğrulamaya bağlanır.
  s.post('/dosya/:id/kalite-plani', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sinif?: string; ozet?: string; risk?: string; teknikKaynak?: string; kaynaklar?: string; kontrolDuzeni?: string; kayitTeslim?: string; gerekce?: string; gereklilikler?: { gereklilik?: string; dogrulama?: string }[] };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    if (!(await rolVar(o.kullanici, TEKNIK))) return y.code(403).send({ hata: 'Kalite planını teknik birim hazırlar.' });
    if (!SERBEST_ROLLERI[g.sinif ?? ''] || !g.ozet?.trim()) return y.code(400).send({ hata: 'Kabul sınıfı ve özet zorunludur.' });
    // YG-648: kapsam (özet) ve risk seviyesi, teknik kaynak zorunlu; sorumluluklar sistemce yazılır; yeni sürüm gerekçe ister.
    if (!['Düşük', 'Orta', 'Yüksek', 'Kritik'].includes(g.risk ?? '')) return y.code(400).send({ hata: 'Risk seviyesini seçiniz: Düşük, Orta, Yüksek, Kritik.' });
    if (!g.teknikKaynak?.trim()) return y.code(400).send({ hata: 'Teknik kaynağı (standart, üretici kılavuzu, klas kuralı) yazınız.' });
    if ((await b.db.query(`SELECT 1 FROM kalite_plani WHERE dosya_ref = $1`, [id])).rowCount && !g.gerekce?.trim()) return y.code(400).send({ hata: 'Yeni sürüm için revizyon gerekçesini yazınız.' });
    const satir = g.gereklilikler ?? [];
    if (!satir.length || satir.some((x) => !x.gereklilik?.trim() || !x.dogrulama?.trim())) return y.code(400).send({ hata: 'Her gereklilik en az bir doğrulamaya bağlanır.' });
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const surum = (await c.query(`SELECT coalesce(max(surum), -1) + 1 n FROM kalite_plani WHERE dosya_ref = $1`, [id])).rows[0].n; // YG-648: Rev.0
      const onay = g.sinif === 'A' ? 'Teknik Müdür' : 'Teknik Yönetici';
      const sor = `Hazırlayan: Teknik Uzman · Onay: ${onay} · Uygulama: Çözüm Ortağı · Saha kontrolü: Saha Sorumlusu · Kanıt ve kayıt: Teknik Uzman`;
      const bos = (x?: string) => x?.trim() || null;
      const p = (await c.query(`INSERT INTO kalite_plani (dosya_ref, surum, kabul_sinifi, ozet, hazirlayan_ref, risk_seviyesi, teknik_kaynak, sorumluluklar, kaynaklar, kontrol_duzeni, kayit_teslim, degisiklik_gerekcesi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING kimlik`,
        [id, surum, g.sinif, g.ozet!.trim(), o.kullanici, g.risk, g.teknikKaynak!.trim(), sor, bos(g.kaynaklar), bos(g.kontrolDuzeni), bos(g.kayitTeslim), bos(g.gerekce)])).rows[0];
      for (const [n, x] of satir.entries()) await c.query(`INSERT INTO gereklilik_satiri (plan_ref, km_no, gereklilik, dogrulama) VALUES ($1,$2,$3,$4)`, [p.kimlik, `KM${String(n + 1).padStart(2, '0')}`, x.gereklilik!.trim(), x.dogrulama!.trim()]); // FR-KLT-015 KMnn
      await kartAc(c, { tur: 'Kalite Planı', baslik: `${d.dosya_no} · Kalite Planı Rev.${surum}`, ozet: `${g.sinif} Sınıfı`, hazirlayan: o.kullanici, zincir: [await rolId(c, g.sinif === 'A' ? 'Teknik Müdür' : 'Teknik Yönetici')], nesneTuru: 'Kalite Planı', nesneKimligi: p.kimlik });
      return { kimlik: p.kimlik, surum };
    });
  });
  s.post('/gereklilik/:id/kanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string; durum?: string };
    if (!UUID.test(id)) return yok(y);
    const r = (await b.db.query(`SELECT p.dosya_ref FROM gereklilik_satiri x JOIN kalite_plani p ON p.kimlik = x.plan_ref WHERE x.kimlik = $1`, [id])).rows[0];
    if (!r || !(await erisim(r.dosya_ref, o.kullanici))) return yok(y);
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Kanıt belgesi zorunludur.' });
    if (!['Koşullu', 'Karşılandı'].includes(g.durum ?? '')) return y.code(400).send({ hata: 'Durumu seçiniz.' });
    await b.db.query(`UPDATE gereklilik_satiri SET kanit_belge_ref = $2, durum = $3 WHERE kimlik = $1`, [id, g.belge, g.durum]);
    return { durum: g.durum };
  });

  // YG-283, YG-388, YG-390: uygunsuzluk açılır; Kritik veya Emniyette ilgili iş derhal durur.
  s.post('/dosya/:id/uygunsuzluk', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { giris?: string; isEmri?: string; kaynak?: string; yer?: string; olcut?: string; durum?: string; belge?: string; sinif?: string; emniyet?: boolean; yaygin?: boolean; hasarOnemi?: string; yeniHasar?: boolean };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    if (!g.kaynak || !g.yer?.trim() || !g.olcut?.trim() || !g.durum?.trim()) return y.code(400).send({ hata: 'Tespit kaynağı, yer, dayanak ölçüt ve gerçek durum zorunludur.' });
    // YG-298: malzeme giriş kabulünden açılan uygunsuzluğun sorumlusu siparişin tedarikçisidir; tedarikçi portalda görür ve yanıtlar.
    const gk = g.giris && UUID.test(g.giris) ? (await b.db.query(`SELECT m.kimlik, s.kurulus_ref FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE m.kimlik = $1 AND s.dosya_ref = $2`, [g.giris, id])).rows[0] : undefined;
    if (g.giris && !gk) return y.code(400).send({ hata: 'Malzeme giriş kaydı bu dosyada bulunamadı.' });
    const tedarikci = gk?.kurulus_ref as string | undefined;
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Kanıt zorunludur.' });
    if (!['Kritik', 'Majör', 'Minör', 'Gözlem'].includes(g.sinif ?? '')) return y.code(400).send({ hata: 'Sınıfı seçiniz.' });
    const e = g.isEmri && UUID.test(g.isEmri) ? (await b.db.query(`SELECT kimlik, kurulus_ref, statu FROM is_emri WHERE kimlik = $1 AND dosya_ref = $2`, [g.isEmri, id])).rows[0] : undefined;
    if (g.isEmri && !e) return y.code(400).send({ hata: 'İş emri bu dosyada değildir.' });
    const p = (await b.db.query(`SELECT kabul_sinifi FROM kalite_plani WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY surum DESC LIMIT 1`, [id])).rows[0];
    const eng = sinifEngeli(g.sinif!, p?.kabul_sinifi ?? null, g.hasarOnemi ?? null, Boolean(g.emniyet));
    if (eng) return y.code(400).send({ hata: eng });
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const no = await altNumara(c, d.dosya_no, 'NCR');
      const dur = g.sinif === 'Kritik' || Boolean(g.emniyet);
      const r = (await c.query(`INSERT INTO uygunsuzluk (uygunsuzluk_no, dosya_ref, is_emri_ref, tespit_kaynagi, yer_nitelik, dayanak_olcut, gercek_durum, kanit_belge_ref, sinif, yaygin_isareti, emniyet_isareti, hedef_zamani, is_durduruldu, sorumlu_firma_ref, firma_yeni_hasar, acan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING kimlik`, [no, id, e?.kimlik ?? null, g.kaynak, g.yer!.trim(), g.olcut!.trim(), g.durum!.trim(), g.belge, g.sinif, Boolean(g.yaygin), Boolean(g.emniyet), ncrHedefi(g.sinif!), dur && Boolean(e), e?.kurulus_ref ?? tedarikci ?? null, Boolean(g.yeniHasar), o.kullanici])).rows[0];
      if (gk) await c.query(`UPDATE malzeme_giris_kabulu SET uygunsuzluk_ref = $2 WHERE kimlik = $1`, [gk.kimlik, r.kimlik]); // YG-298
      // YG-801: kapanmış iş emrine (veya dosyadaki sorumlu firmaya) açılan uygunsuzluk firmanın performans puanını hemen günceller.
      { const sf = e?.kurulus_ref ?? null; const { performansOlayIsle } = await import('./karne.js');
        for (const x of (await c.query(`SELECT is_emri_ref FROM performans_olay_kaydi WHERE ($1::uuid IS NOT NULL AND is_emri_ref = $1) OR ($2::uuid IS NOT NULL AND dosya_ref = $3 AND kurulus_ref = $2)`, [e?.kimlik ?? null, sf, id])).rows) await performansOlayIsle(c, x.is_emri_ref, `Uygunsuzluk ${no}`); }
      if (dur && e && ['Aktif', 'Başlangıç Kontrolünde'].includes(e.statu)) await c.query(`UPDATE is_emri SET statu = 'Durduruldu', durdurma_nedeni = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, `Uygunsuzluk ${no}`]);
      // YG-528: Dosya Sorumlusu ve dosyanın Teknik Uzmanları (Kalite Uzmanı da); Kritik veya Emniyet işaretliyse Kalite Müdürü ve Teknik Müdür. Sistem içi + e-posta, Kritikte SMS.
      const tu = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Teknik Uzman' AND bitis_zamani IS NULL`, [id])).rows.map((x) => x.kullanici_ref as string);
      const alici = [d.dosya_sorumlusu_ref, ...tu, ...await rolSahipleri(c, await rolId(c, KK)), ...(dur ? [...await rolSahipleri(c, await rolId(c, KM)), ...await rolSahipleri(c, await rolId(c, 'Teknik Müdür'))] : [])].filter(Boolean);
      await bildir(c, { olay: `ncr:${r.kimlik}`, kullanicilar: alici, baslik: `${no} · ${g.sinif} Uygunsuzluk`, oncelik: dur ? 'Kritik' : 'Normal', eposta: true, sms: dur });
      if (e) { const fk = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [e.kurulus_ref])).rows.map((x) => x.kullanici_ref as string); await bildir(c, { olay: `ncr-firma:${r.kimlik}`, kullanicilar: fk, baslik: `${no} · Uygunsuzluk Yanıtınız Bekleniyor`, oncelik: dur ? 'Kritik' : 'Normal', eposta: true, sms: dur }); }
      return { kimlik: r.kimlik, uygunsuzlukNo: no, isDurduruldu: dur && Boolean(e) };
    });
  });

  const ncr = async (id: string, k: string) => {
    if (!UUID.test(id)) return undefined;
    const n = (await b.db.query(`SELECT * FROM uygunsuzluk WHERE kimlik = $1`, [id])).rows[0];
    return n && await dosyaErisimi(b.db, k, n.dosya_ref) ? n : undefined;
  };
  // YG-392, YG-388: tasarrufu Kalite Kontrolör verir; Kritik'te Olduğu Gibi Kabul engelli; son karar Kritik ve Emniyette Kalite Müdüründe.
  s.post('/uygunsuzluk/:id/tasarruf', oturumlu, async (i, y) => {
    const o = i.oturum!; const n = await ncr((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { karar?: string; bedel?: string; ihbar?: string; mahsup?: string };
    if (!n) return yok(y);
    const son = n.sinif === 'Kritik' || n.emniyet_isareti;
    if (!(await rolVar(o.kullanici, son ? [KM] : [KK, KM]))) return y.code(403).send({ hata: son ? 'Son karar Kalite Müdüründedir.' : 'Teknik tasarrufu Kalite Kontrolör verir.' });
    if (!['Olduğu Gibi Kabul', 'Düzeltme', 'Yeniden İşleme', 'Ayırma/Karantina', 'İade/Değişim', 'Ret/Hurda'].includes(g.karar ?? '')) return y.code(400).send({ hata: 'Kararı seçmenizi rica ederiz.' });
    if (g.karar === 'Olduğu Gibi Kabul' && n.sinif === 'Kritik') return y.code(409).send({ hata: 'Kritik sınıfta Olduğu Gibi Kabul dışında bir karar seçmenizi rica ederiz.' });
    if (n.firma_yeni_hasar && (!g.ihbar || !g.mahsup?.trim())) return y.code(400).send({ hata: 'Firma kaynaklı yeni hasarda sorumluluk ihbar tarihi ve mahsup referansı zorunludur.' });
    await b.db.query(`UPDATE uygunsuzluk SET tasarruf_karari = $2, tasarruf_onaylayan_ref = $3, bedel_sorumlusu = $4, sorumluluk_ihbar_tarihi = $5, mahsup_referansi = $6, statu = 'İşlemde' WHERE kimlik = $1`, [n.kimlik, g.karar, o.kullanici, g.bedel ?? null, g.ihbar ?? null, g.mahsup?.trim() ?? null]);
    return { statu: 'İşlemde' };
  });
  // YG-285: kişiye veya yalnız dikkatsizliğe dayalı kök neden kabul edilmez.
  s.post('/uygunsuzluk/:id/kok-neden', oturumlu, async (i, y) => {
    const o = i.oturum!; const n = await ncr((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as Record<string, string | undefined>;
    if (!n) return yok(y);
    if (['problem', 'dogrudan', 'katki', 'bariyer', 'kokNeden', 'tekrar'].some((a) => !g[a]?.trim())) return y.code(400).send({ hata: 'Kök neden analizinin tüm alanları zorunludur.' });
    if (/^\s*(dikkatsizlik|ihmal|personel hatası|kişi hatası)\s*\.?\s*$/i.test(g.kokNeden!)) return y.code(400).send({ hata: 'Kök nedeni kişi yerine süreç ve sistem etkenleriyle yazmanızı rica ederiz.' });
    const r = (await b.db.query(`INSERT INTO kok_neden_analizi (uygunsuzluk_ref, problem_tanimi, dogrudan_neden, katki_faktorleri, bariyer_analizi, kok_neden, tekrar_olasiligi, analist_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [n.kimlik, g.problem, g.dogrudan, g.katki, g.bariyer, g.kokNeden, g.tekrar, o.kullanici])).rows[0];
    await b.db.query(`UPDATE uygunsuzluk SET kok_neden_ref = $2 WHERE kimlik = $1`, [n.kimlik, r.kimlik]);
    return { kimlik: r.kimlik };
  });
  s.post('/kok-neden/:id/faaliyet', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; aciklama?: string; sorumlu?: string; hedef?: string; gosterge?: string; izleme?: number };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT u.dosya_ref, d.dosya_no FROM kok_neden_analizi a JOIN uygunsuzluk u ON u.kimlik = a.uygunsuzluk_ref JOIN dosya d ON d.kimlik = u.dosya_ref WHERE a.kimlik = $1`, [id])).rows[0];
    if (!k || !(await erisim(k.dosya_ref, o.kullanici))) return yok(y);
    if (!['Düzeltme', 'Düzeltici faaliyet', 'Önleyici faaliyet'].includes(g.tur ?? '') || !g.aciklama?.trim() || !g.sorumlu || !g.hedef || !g.gosterge?.trim() || !(Number(g.izleme) > 0)) return y.code(400).send({ hata: 'Tür, açıklama, sorumlu, hedef tarih, etkinlik göstergesi ve izleme süresi zorunludur.' });
    return islem(async (c) => {
      const no = await altNumara(c, k.dosya_no, 'DF');
      const r = (await c.query(`INSERT INTO duzeltici_faaliyet (eylem_no, kok_neden_ref, eylem_turu, aciklama, sorumlu_ref, hedef_tarih, etkinlik_gostergesi, izleme_gun) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [no, id, g.tur, g.aciklama!.trim(), g.sorumlu, g.hedef, g.gosterge!.trim(), g.izleme])).rows[0];
      return { kimlik: r.kimlik, eylemNo: no };
    });
  });
  // YG-285: Etkisiz ise faaliyet sistemce yeniden açılır.
  s.post('/faaliyet/:id/etkinlik', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; kanit?: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [KK, KM]))) return y.code(403).send({ hata: 'Etkinliği Kalite birimi doğrular.' });
    if (!['Etkili', 'Etkisiz'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Sonucu seçmenizi rica ederiz.' });
    if (!g.kanit || !UUID.test(g.kanit)) return y.code(400).send({ hata: 'Tamamlanma kanıtı zorunludur.' });
    if (g.sonuc === 'Etkisiz') { const u = (await b.db.query(`SELECT a.uygunsuzluk_ref FROM duzeltici_faaliyet f JOIN kok_neden_analizi a ON a.kimlik = f.kok_neden_ref WHERE f.kimlik = $1`, [id])).rows[0]?.uygunsuzluk_ref; if (u) await (await import('./risk_kalite.js')).kapsamliKokNedenGorevi(b.db, u, 'Düzeltici faaliyet etkisiz bulundu'); } // YG-1693
    const r = await b.db.query(`UPDATE duzeltici_faaliyet SET etkinlik_sonucu = $2, tamamlanma_kaniti_ref = $3, tamamlanma_tarihi = CASE WHEN $2::text = 'Etkili' THEN current_date END, statu = CASE WHEN $2::text = 'Etkili' THEN 'Kapalı' ELSE 'Açık' END, yeniden_acilma = yeniden_acilma + CASE WHEN $2::text = 'Etkisiz' THEN 1 ELSE 0 END WHERE kimlik = $1 RETURNING statu`, [id, g.sonuc, g.kanit]);
    if (!r.rowCount) return yok(y);
    return { statu: r.rows[0].statu };
  });
  // YG-284, YG-393: Kalite Kontrolör düzeltmeyi doğrular; yalnız imza veya fotoğrafla kapanmaz; Majör, Kritik, yaygın veya tekrarlayanda kök neden; kapanınca durdurulan iş yeniden açılır.
  s.post('/uygunsuzluk/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const n = await ncr((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { sonuc?: string; kanit?: string };
    if (!n) return yok(y);
    const son = n.sinif === 'Kritik' || n.emniyet_isareti;
    if (!(await rolVar(o.kullanici, son ? [KM] : [KK, KM]))) return y.code(403).send({ hata: son ? 'Kritik ve Emniyet işaretlide son karar Kalite Müdüründedir.' : 'Uygunsuzluğu Kalite Kontrolör kapatır.' });
    if (n.statu === 'Kapalı') return y.code(409).send({ hata: 'Uygunsuzluk kapalıdır.' });
    if (n.sinif !== 'Gözlem' && !n.tasarruf_karari) return y.code(409).send({ hata: 'Teknik tasarruf kararı verilmemiştir.' });
    if (!['Uygun', 'Koşullu uygun', 'Ek düzeltme', 'Ret'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Yeniden kontrol sonucunu seçiniz.' });
    if (g.sonuc !== 'Uygun') { await b.db.query(`UPDATE uygunsuzluk SET yeniden_kontrol_sonucu = $2, statu = 'İşlemde' WHERE kimlik = $1`, [n.kimlik, g.sonuc]); return { statu: 'İşlemde' }; }
    if (!g.kanit || !UUID.test(g.kanit)) return y.code(400).send({ hata: 'Kapanış kanıtı zorunludur.' });
    if (g.kanit === n.kanit_belge_ref) return y.code(400).send({ hata: 'Tespit kanıtı kapanış kanıtı sayılmaz.' });
    const tekrar = Boolean(n.sorumlu_firma_ref) && Boolean((await b.db.query(`SELECT 1 FROM uygunsuzluk WHERE sorumlu_firma_ref = $1 AND dayanak_olcut = $2 AND kimlik <> $3 LIMIT 1`, [n.sorumlu_firma_ref, n.dayanak_olcut, n.kimlik])).rowCount);
    if ((n.sinif === 'Kritik' || n.sinif === 'Majör' || n.yaygin_isareti || tekrar) && !n.kok_neden_ref) return y.code(409).send({ hata: 'Kapanış için Kök neden analizi bekleniyor.' });
    return islem(async (c) => {
      await c.query(`UPDATE uygunsuzluk SET yeniden_kontrol_sonucu = 'Uygun', kapanis_kaniti_ref = $2, kapanis_yetkilisi_ref = $3, statu = 'Kapalı', kapanis_zamani = now() WHERE kimlik = $1`, [n.kimlik, g.kanit, o.kullanici]);
      // YG-262: emniyet işaretli uygunsuzlukla duran işi yalnız Teknik Müdür yeniden başlatır.
      if (n.is_durduruldu && n.is_emri_ref && !n.emniyet_isareti) await c.query(`UPDATE is_emri SET statu = 'Aktif', durdurma_nedeni = NULL, guncelleme_zamani = now() WHERE kimlik = $1 AND statu = 'Durduruldu' AND durdurma_nedeni = $2`, [n.is_emri_ref, `Uygunsuzluk ${n.uygunsuzluk_no}`]);
      return { statu: 'Kapalı' };
    });
  });
  // YG-292, YG-388: firma yalnız kendi uygunsuzluğunu görür ve yanıtlar.
  s.get('/firma-portal/uygunsuzluklar', oturumlu, async (i) => {
    const f = await firmam(i.oturum!.kullanici);
    if (!f) return [];
    return (await b.db.query(`SELECT kimlik, uygunsuzluk_no, sinif, emniyet_isareti, yer_nitelik, dayanak_olcut, gercek_durum, hedef_zamani, statu, firma_yaniti FROM uygunsuzluk WHERE sorumlu_firma_ref = $1 ORDER BY olusturma_zamani DESC`, [f])).rows;
  });
  s.post('/firma-portal/uygunsuzluk/:id/yanit', oturumlu, async (i, y) => {
    const f = await firmam(i.oturum!.kullanici); const { id } = i.params as { id: string }; const { yanit } = (i.body ?? {}) as { yanit?: string };
    if (!f || !UUID.test(id)) return yok(y);
    if (!yanit?.trim()) return y.code(400).send({ hata: 'Yanıt zorunludur.' });
    const r = await b.db.query(`UPDATE uygunsuzluk SET firma_yaniti = $3, statu = CASE WHEN statu = 'Açık' THEN 'İşlemde' ELSE statu END WHERE kimlik = $1 AND sorumlu_firma_ref = $2 AND statu <> 'Kapalı'`, [id, f, yanit.trim()]);
    if (!r.rowCount) return yok(y);
    return { tamam: true };
  });

  // YG-315, YG-383, YG-389: kontrol noktası KPnn; davet en az 24 saat, eksper veya klas 48 saat, Kritik dosyada süre aranmaz.
  s.post('/is-emri/:id/kontrol-noktasi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; kalem?: string; ozellik?: string; olcut?: string; zaman?: string; eksperKlas?: boolean };
    if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT e.is_emri_no, e.dosya_ref, d.oncelik FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kimlik = $1`, [id])).rows[0];
    if (!e || !(await erisim(e.dosya_ref, o.kullanici))) return yok(y);
    if (!['Bekletme', 'Tanıklık', 'Belge İnceleme', 'Gözetim', 'Uygulayıcı Öz Kontrolü', 'Bağımsız Doğrulama'].includes(g.tur ?? '') || !g.ozellik?.trim() || !g.olcut?.trim() || !g.zaman) return y.code(400).send({ hata: 'Tür, kontrol özelliği, kabul ölçütü ve zaman zorunludur.' });
    if (/^\s*uygun görüldü\s*\.?\s*$/i.test(g.olcut)) return y.code(400).send({ hata: 'Ölçülebilir kabul ölçütü yazınız.' });
    const saat = (new Date(g.zaman).getTime() - Date.now()) / 3_600_000;
    if (e.oncelik !== 'Kritik' && ['Bekletme', 'Tanıklık'].includes(g.tur!) && saat < (g.eksperKlas ? 48 : 24)) return y.code(400).send({ hata: `Davet en az ${g.eksperKlas ? 48 : 24} saat önce yapılır.` });
    if (e.oncelik === 'Kritik' && ['Bekletme', 'Tanıklık'].includes(g.tur!) && saat < 2) return y.code(400).send({ hata: 'Kritik öncelikli dosyada davet en az 2 saat önce yapılır.' }); // YG-553
    return islem(async (c) => {
      const no = await altNumara(c, e.is_emri_no, 'KP');
      const r = (await c.query(`INSERT INTO kontrol_noktasi (kontrol_noktasi_no, is_emri_ref, kalem, nokta_turu, kontrol_ozelligi, kabul_olcutu, planlanan_zaman, eksper_klas, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [no, id, g.kalem ?? null, g.tur, g.ozellik!.trim(), g.olcut!.trim(), g.zaman, Boolean(g.eksperKlas), o.kullanici])).rows[0];
      // YG-553: tanıklık ve bekletme noktası daveti dosya ekibine ve firmaya sistem içi, SMS ve e-postayla gider.
      if (['Bekletme', 'Tanıklık'].includes(g.tur!)) {
        const al = [...(await c.query(`SELECT DISTINCT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL`, [e.dosya_ref])).rows.map((x) => x.kullanici_ref as string),
          ...(await c.query(`SELECT u.kullanici_ref FROM is_emri x JOIN kurulus_kullanici u ON u.kurulus_ref = x.kurulus_ref WHERE x.kimlik = $1`, [id])).rows.map((x) => x.kullanici_ref as string)].filter((x) => x !== o.kullanici);
        const zm = new Date(g.zaman!).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
        await bildir(c, { olay: `tanıklık-davet:${r.kimlik}`, kullanicilar: al, baslik: `${no} · ${g.tur} Noktası Daveti`, ozet: `${e.is_emri_no} · ${g.ozellik!.trim()} · ${zm}`, eposta: true, sms: true, oncelik: e.oncelik === 'Kritik' ? 'Kritik' : 'Yüksek' });
      }
      return { kimlik: r.kimlik, no };
    });
  });
  s.post('/kontrol-noktasi/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; katilim?: string; kanit?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT n.*, e.dosya_ref, e.kabul_sinifi FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref WHERE n.kimlik = $1`, [id])).rows[0];
    if (!k || !(await erisim(k.dosya_ref, o.kullanici))) return yok(y);
    if (!['Uygun', 'Koşullu uygun', 'Düzeltme gerekli', 'Reddedildi'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Sonucu seçmenizi rica ederiz.' });
    if (!g.kanit || !UUID.test(g.kanit)) return y.code(400).send({ hata: 'Kanıt zorunludur.' });
    if (k.serbest_birakma_zamani) return y.code(409).send({ hata: 'Kontrol noktası serbest bırakılmıştır.' });
    // YG-553: davetli katılmadıysa planlanan zamandan 2 saat sonra fotoğraf ve video kanıtıyla ilerlenir.
    if (g.katilim === 'Katılım Olmadı' && ['Bekletme', 'Tanıklık'].includes(k.nokta_turu) && Date.now() < new Date(k.planlanan_zaman).getTime() + 2 * 3_600_000) return y.code(409).send({ hata: 'Davetli katılmadığında planlanan zamandan 2 saat sonra fotoğraf ve video kanıtıyla ilerlenir.' });
    const p = (await b.db.query(`SELECT kabul_sinifi FROM kalite_plani WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY surum DESC LIMIT 1`, [k.dosya_ref])).rows[0];
    const gereken = SERBEST_ROLLERI[k.kabul_sinifi ?? p?.kabul_sinifi ?? 'D']!;
    const benimRol = (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2)`, [o.kullanici, gereken])).rows.map((r) => r.rol_adi as string);
    if (!benimRol.length) return y.code(403).send({ hata: `Bu noktayı ${gereken.join(' ve ')} serbest bırakır.` });
    if ((await b.db.query(`SELECT 1 FROM is_emri WHERE kimlik = $1 AND teknik_kabul_eden_ref = $2`, [k.is_emri_ref, o.kullanici])).rowCount) return y.code(403).send({ hata: 'Görev ayrılığı gereği teknik kabulü veren kalite kontrolünü doğrulayamaz.' }); // YG-1037
    // YG-382: kanıt dosyaya bağlı olmalı; incelenen yürürlükteki sürüm ve kullanılan ölçüt sonuçla birlikte kaydedilir.
    const ks = (await b.db.query(`SELECT s.kimlik FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik WHERE e.kimlik = $1 AND e.bag_turu IN ('Dosya', 'İş Emri') AND (e.bag_kimligi = $2::text OR e.bag_kimligi = $3::text) AND s.durum NOT IN ('İptal', 'Karantina', 'Yerine Geçti', 'Arşiv') ORDER BY s.surum_no DESC LIMIT 1`, [g.kanit, k.dosya_ref, k.is_emri_ref])).rows[0];
    if (!ks) return y.code(400).send({ hata: 'Kanıt bu dosyaya veya iş emrine yüklenmiş geçerli bir belge olmalıdır.' });
    await b.db.query(`UPDATE kontrol_noktasi SET kanit_surum_ref = $2, kullanilan_olcut = $3 WHERE kimlik = $1`, [id, ks.kimlik, k.kabul_olcutu]);
    await b.db.query(`UPDATE kontrol_noktasi SET dogrulayanlar = array_append(dogrulayanlar, $2) WHERE kimlik = $1 AND NOT ($2 = ANY(dogrulayanlar))`, [id, o.kullanici]);
    if (g.sonuc !== 'Uygun' && g.sonuc !== 'Koşullu uygun') {
      await b.db.query(`UPDATE kontrol_noktasi SET sonuc = $2, kanit_belge_ref = $3, katilim_durumu = $4 WHERE kimlik = $1`, [id, g.sonuc, g.kanit, g.katilim ?? null]);
      // YG-383: olumsuz sonuçta uygunsuzluk kendiliğinden açılır (Reddedildi Majör; Düzeltme gerekli Minör, A sınıfında Majör); Kalite Kontrolör tasarrufta değerlendirir.
      if (!k.uygunsuzluk_ref) await islem(async (c) => {
        const e = (await c.query(`SELECT e.kurulus_ref, d.dosya_no, d.dosya_sorumlusu_ref FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kimlik = $1`, [k.is_emri_ref])).rows[0];
        const sinif = g.sonuc === 'Reddedildi' || (k.kabul_sinifi ?? p?.kabul_sinifi) === 'A' ? 'Majör' : 'Minör';
        const no = await altNumara(c, e.dosya_no, 'NCR');
        const n = (await c.query(`INSERT INTO uygunsuzluk (uygunsuzluk_no, dosya_ref, is_emri_ref, tespit_kaynagi, yer_nitelik, dayanak_olcut, gercek_durum, kanit_belge_ref, sinif, hedef_zamani, sorumlu_firma_ref, acan_ref) VALUES ($1,$2,$3,'Ara kontrol',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`,
          [no, k.dosya_ref, k.is_emri_ref, `${k.kontrol_noktasi_no}${k.kalem ? ` · ${k.kalem}` : ''}`, k.kabul_olcutu, `Kontrol noktası sonucu: ${g.sonuc}`, g.kanit, sinif, ncrHedefi(sinif), e.kurulus_ref, o.kullanici])).rows[0];
        await c.query(`UPDATE kontrol_noktasi SET uygunsuzluk_ref = $2 WHERE kimlik = $1`, [id, n.kimlik]);
        await bildir(c, { olay: `ncr:${n.kimlik}`, kullanicilar: [e.dosya_sorumlusu_ref, ...await rolSahipleri(c, await rolId(c, KK))].filter(Boolean), baslik: `${no} · ${sinif} Uygunsuzluk`, oncelik: 'Normal' });
        const fk = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [e.kurulus_ref])).rows.map((x) => x.kullanici_ref as string);
        await bildir(c, { olay: `ncr-firma:${n.kimlik}`, kullanicilar: fk, baslik: `${no} · Uygunsuzluk Yanıtınız Bekleniyor`, oncelik: 'Normal' });
      }); return { sonuc: g.sonuc, serbest: false, uygunsuzlukGerekli: true }; }
    const onay = [...new Set([...(k.onaylar as string[]), ...benimRol])];
    const tam = gereken.every((r) => onay.includes(r));
    await b.db.query(`UPDATE kontrol_noktasi SET sonuc = $2, kanit_belge_ref = $3, katilim_durumu = $4, onaylar = $5, serbest_birakma_zamani = CASE WHEN $6::boolean THEN now() END WHERE kimlik = $1`, [id, g.sonuc, g.kanit, g.katilim ?? null, JSON.stringify(onay), tam]);
    return { sonuc: g.sonuc, serbest: tam, bekleyen: gereken.filter((r) => !onay.includes(r)) };
  });

  // YG-1451: RP-RAP-003 Test Kaydı standart akışta dışa gitmez; sigorta şirketi istediğinde LGM personeli PDF'i üretir.
  s.get('/test/:id/pdf', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü') return yok(y);
    const t = (await b.db.query(`SELECT t.*, d.dosya_no FROM test_kaydi t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1`, [id])).rows[0];
    if (!t || !(await erisim(t.dosya_ref, o.kullanici))) return yok(y);
    const cihaz = t.cihazlar?.length ? (await b.db.query(`SELECT ad, seri_no, kalibrasyon_tarihi FROM olcum_cihazi WHERE kimlik::text = ANY($1::text[])`, [t.cihazlar])).rows : [];
    const renk = t.sonuc === 'Başarılı' ? 'yesil' : t.sonuc ? 'kirmizi' : 'sari';
    const bolumler: Bolum[] = [
      { baslik: 'Test Bilgileri', tur: 'alanlar', alanlar: [{ et: 'Test No', deger: t.test_no }, { et: 'Test Grubu', deger: t.test_grubu }, { et: 'Amaç ve Kapsam', deger: t.amac_kapsam, genis: true }, { et: 'Yöntem', deger: t.yontem, genis: true }, { et: 'Kabul Ölçütü', deger: t.kabul_olcutu, genis: true }, { et: 'Durdurma Koşulu', deger: t.durdurma_kosulu, genis: true }] },
      ...(cihaz.length ? [{ baslik: 'Ölçüm Cihazları', tur: 'tablo' as const, sutunlar: [{ ad: 'Cihaz' }, { ad: 'Seri No', hiza: 'ort' as const }, { ad: 'Kalibrasyon', hiza: 'ort' as const }], satirlar: cihaz.map((c) => [c.ad, c.seri_no, c.kalibrasyon_tarihi ? gunAy(c.kalibrasyon_tarihi) : null]) }] : []),
      { baslik: 'Sonuç', tur: 'tablo', sutunlar: [{ ad: 'Sonuç', hiza: 'ort' }, { ad: 'Gerekçe' }, { ad: 'Gözlemler' }], satirlar: [[{ m: t.sonuc ?? 'Bekliyor', renk }, t.sonuc_gerekcesi, t.gozlemler ?? t.durdurma_olayi]] },
    ];
    const pdf = await pdfUret({ ad: 'Test Kaydı (Test Sonuç Raporu)', kod: 'RP-RAP-003', no: t.test_no, dosyaNo: t.dosya_no, tarih: gunAy(t.olusturma_zamani), surum: 'Rev.0', dil: 'tr', bolumler });
    return y.type('application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(t.test_no)}.pdf"`).send(pdf);
  });
  s.post('/olcum-cihazi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ad?: string; seri?: string; tarih?: string; aralik?: number; kabul?: boolean; kritik?: boolean; turkak?: boolean; kurulus?: string };
    if (!(await rolVar(o.kullanici, [...TEKNIK, KK, KM]))) return y.code(403).send({ hata: 'Bu işlem teknik ve kalite birimlerine aittir.' });
    if (!g.ad?.trim() || !g.seri?.trim() || !g.tarih) return y.code(400).send({ hata: 'Ad, seri no ve kalibrasyon tarihi zorunludur.' });
    if (g.turkak !== true) return y.code(400).send({ hata: 'LGM ölçüm cihazının kalibrasyonu TÜRKAK akreditasyonlu kuruluşça yapılmış olmalıdır.' }); // YG-402
    // YG-402: kalibrasyon kabul kararı Hayır ise cihaz kendiliğinden Karantinadadır.
    return { kimlik: (await b.db.query(`INSERT INTO olcum_cihazi (ad, seri_no, kalibrasyon_tarihi, aralik_ay, kabul, kaydeden_ref, kritik, turkak_akredite, kalibrasyon_kurulusu, durum) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9) RETURNING kimlik`, [g.ad.trim(), g.seri.trim(), g.tarih, g.aralik ?? 12, g.kabul !== false, o.kullanici, Boolean(g.kritik), g.kurulus?.trim() || null, g.kabul === false ? 'Karantina' : 'Kullanımda'])).rows[0].kimlik };
  });
  // YG-1691: kalibrasyon envanteri; geçerlilik sonu = kalibrasyon tarihi + aralık; süresi geçen, 60 gün içinde dolan ve karantinadaki cihaz ayrıca işaretlenir.
  s.get('/olcum-cihazi', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [...TEKNIK, KK, KM, 'Kalite Müdür Yardımcısı', 'Kalite Yöneticisi']))) return yok(y);
    return (await b.db.query(`SELECT kimlik, ad, seri_no, kalibrasyon_tarihi::text, aralik_ay, (kalibrasyon_tarihi + make_interval(months => aralik_ay))::date::text gecerlilik_sonu,
        ((kalibrasyon_tarihi + make_interval(months => aralik_ay))::date - current_date) kalan_gun, kritik, ara_dogrulama_tarihi::text, durum, kalibrasyon_kurulusu
      FROM olcum_cihazi ORDER BY (kalibrasyon_tarihi + make_interval(months => aralik_ay)), ad LIMIT 500`)).rows;
  });
  // YG-402: kritik cihazın ara doğrulaması kaydedilir.
  s.post('/olcum-cihazi/:id/ara-dogrulama', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!(await rolVar(o.kullanici, [...TEKNIK, KK, KM]))) return y.code(403).send({ hata: 'Bu işlem teknik ve kalite birimlerine aittir.' });
    if (!UUID.test(id)) return yok(y);
    const r = await b.db.query(`UPDATE olcum_cihazi SET ara_dogrulama_tarihi = current_date WHERE kimlik = $1 AND durum = 'Kullanımda' RETURNING kimlik`, [id]);
    return r.rowCount ? { tamam: true } : yok(y);
  });
  // YG-286, YG-396, YG-397: ölçüt test açılırken kilitlenir; cihaz kalibrasyonu; yeniden test yeni numara; hazırlayan, kontrol eden ve karar veren ayrı.
  s.post('/dosya/:id/test', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { grup?: string; amac?: string; yontem?: string; olcut?: string; durdurma?: string; cihazlar?: string[]; onceki?: string };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    // YG-1485: test kaydını dosyanın Kalite Kontrolörü girer; atanmamışsa Teknik Uzman girer, kontrol ve kararı Teknik Yönetici kademesi verir.
    { const ekip = (await b.db.query(`SELECT kullanici_ref, rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL AND rol IN ('Kalite Kontrolör', 'Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)')`, [id])).rows;
      const kk = ekip.filter((x) => x.rol === 'Kalite Kontrolör');
      // YG-1687: Kalite Kontrolör izinli veya raporluyken dosyanın yedek kontrolörü girer.
      if (kk.length && !kk.some((x) => x.kullanici_ref === o.kullanici) && (await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi a JOIN personel_karti p ON p.kullanici_ref = $2 WHERE a.dosya_ref = $1 AND a.rol = 'Yedek Kalite Kontrolör' AND a.bitis_zamani IS NULL AND a.kullanici_ref = $3 AND p.personel_durumu IN ('İzinli', 'Raporlu')`, [id, kk[0]!.kullanici_ref, o.kullanici])).rowCount) kk.push({ kullanici_ref: o.kullanici, rol: 'Kalite Kontrolör' });
      if (kk.length ? !kk.some((x) => x.kullanici_ref === o.kullanici) : !ekip.some((x) => x.kullanici_ref === o.kullanici)) return y.code(403).send({ hata: kk.length ? 'Test kaydını dosyanın Kalite Kontrolörü girer.' : 'Kalite Kontrolör atanmamış dosyada test kaydını Teknik Uzman girer.' }); }
    if (!['Gövde ve Yapısal', 'Makine ve Tahrik', 'Elektrik/Elektronik', 'Tesisat ve Yardımcı', 'Seyir ve Haberleşme', 'İç Mekân ve Donanım', 'Arayüz / Bütünleşik'].includes(g.grup ?? '')) return y.code(400).send({ hata: 'Test grubunu seçiniz.' });
    if (!g.amac?.trim() || !g.yontem?.trim() || !g.olcut?.trim() || !g.durdurma?.trim()) return y.code(400).send({ hata: 'Amaç, yöntem, kabul ölçütü ve durdurma koşulu zorunludur.' });
    if (/^\s*(normal|iyi|uygun|çalışıyor)\s*\.?\s*$/i.test(g.olcut)) return y.code(400).send({ hata: 'Kabul ölçütünü ölçülebilir biçimde yazmanızı rica ederiz.' });
    const cihaz = g.cihazlar ?? [];
    for (const c of (await b.db.query(`SELECT ad, kalibrasyon_tarihi, aralik_ay, kabul, durum, kritik, ara_dogrulama_tarihi FROM olcum_cihazi WHERE kimlik = ANY($1::uuid[])`, [cihaz])).rows) if (!cihazGecerli(c)) return y.code(409).send({ hata: `${c.ad} kalibrasyonu geçersizdir; testte geçerli bir cihaz seçmenizi rica ederiz.` });
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const no = await altNumara(c, d.dosya_no, 'TS');
      const r = (await c.query(`INSERT INTO test_kaydi (test_no, dosya_ref, onceki_test_ref, test_grubu, amac_kapsam, yontem, kabul_olcutu, durdurma_kosulu, cihazlar, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`, [no, id, g.onceki ?? null, g.grup, g.amac!.trim(), g.yontem!.trim(), g.olcut!.trim(), g.durdurma!.trim(), cihaz, o.kullanici])).rows[0];
      return { kimlik: r.kimlik, testNo: no };
    });
  });
  s.post('/test/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; gerekce?: string; hamVeri?: string; gozlem?: string; durdurma?: string; disRapor?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT * FROM test_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!t || !(await erisim(t.dosya_ref, o.kullanici))) return yok(y);
    if (t.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Sonucu testi hazırlayan girer.' });
    if (t.durum !== 'Planlandı') return y.code(409).send({ hata: 'Sonuç girilmiştir; yeniden test yeni numara alır.' });
    // YG-398: dış uzman / muayene raporu sonucu girilirse test sonucu ondan eşlenir; elle farklı sonuç girilemez.
    const ESLE: Record<string, string> = { Uygun: 'Başarılı', 'Uygun Değil': 'Başarısız', Belirlenemedi: 'Geçersiz' };
    if (g.disRapor !== undefined) { if (!ESLE[g.disRapor]) return y.code(400).send({ hata: 'Dış rapor sonucu geçersizdir.' }); if (g.sonuc && g.sonuc !== ESLE[g.disRapor]) return y.code(400).send({ hata: `Dış rapor sonucu "${g.disRapor}" test sonucunda "${ESLE[g.disRapor]}" olarak işlenir.` }); g.sonuc = ESLE[g.disRapor]; }
    if (!['Başarılı', 'Koşullu', 'Başarısız', 'Geçersiz', 'Engellendi'].includes(g.sonuc ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Sonuç ve gerekçe zorunludur.' });
    if (!g.hamVeri || !UUID.test(g.hamVeri)) return y.code(400).send({ hata: 'Ham veri zorunludur.' });
    await b.db.query(`UPDATE test_kaydi SET sonuc = $2, sonuc_gerekcesi = $3, ham_veri_ref = $4, gozlemler = $5, durdurma_olayi = $6, dis_rapor_sonucu = $7, durum = 'Kontrolde' WHERE kimlik = $1`, [id, g.sonuc, g.gerekce.trim(), g.hamVeri, g.gozlem ?? null, g.durdurma ?? null, g.disRapor ?? null]);
    return { durum: 'Kontrolde' };
  });
  s.post('/test/:id/kontrol', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT * FROM test_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!t || !(await erisim(t.dosya_ref, o.kullanici))) return yok(y);
    if (t.durum !== 'Kontrolde') return y.code(409).send({ hata: 'Test kontrol aşamasında değildir.' });
    if (o.kullanici === t.hazirlayan_ref) return y.code(403).send({ hata: 'Kontrolün hazırlayan dışında bir kişi tarafından yapılmasını rica ederiz.' });
    await b.db.query(`UPDATE test_kaydi SET kontrol_eden_ref = $2, durum = 'Kararda' WHERE kimlik = $1`, [id, o.kullanici]);
    return { durum: 'Kararda' };
  });
  s.post('/test/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT * FROM test_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!t || !(await erisim(t.dosya_ref, o.kullanici))) return yok(y);
    if (t.durum !== 'Kararda') return y.code(409).send({ hata: 'Test karar aşamasında değildir.' });
    if (o.kullanici === t.hazirlayan_ref || o.kullanici === t.kontrol_eden_ref) return y.code(403).send({ hata: 'Hazırlayan, kontrol eden ve karar veren ayrı kişilerdir.' });
    await b.db.query(`UPDATE test_kaydi SET karar_veren_ref = $2, durum = 'Tamamlandı' WHERE kimlik = $1`, [id, o.kullanici]);
    return { durum: 'Tamamlandı', sonuc: t.sonuc };
  });

  // YG-287, YG-290: koşullu kabul en geç 30 gün; Kalite Müdürü bir kez 15 gün uzatır; çekince açık iş kalemine bağlanır.
  s.post('/is-emri/:id/kosullu-kabul', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { bitis?: string; kalemler?: { tanim?: string; etki?: string; hedef?: string; bedel?: number; sorumlu?: string }[]; etkiler?: { mali?: string; garanti?: string; guvenlik?: string; musteri?: string } };
    if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT kimlik, dosya_ref, statu FROM is_emri WHERE kimlik = $1`, [id])).rows[0];
    if (!e || !(await erisim(e.dosya_ref, o.kullanici))) return yok(y);
    if (!(await rolVar(o.kullanici, ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)']))) return y.code(403).send({ hata: 'Teknik kabulü Teknik Uzman verir.' });
    if (e.statu !== 'Tamamlandı') return y.code(409).send({ hata: 'Firma işi tamamlandı bildirmemiştir.' });
    const eng = await kabulEngeli(b.db, e, 'Koşullu Kabul');
    if (eng) return y.code(409).send({ hata: eng });
    const kl = g.kalemler ?? [];
    if (!kl.length || kl.some((x) => !x.tanim?.trim() || !x.etki?.trim() || !x.hedef || !(Number(x.bedel) >= 0) || x.bedel === undefined)) return y.code(400).send({ hata: 'Her açık iş tanım, etki, hedef tarih ve bedel taşır.' }); // YG-841
    if (!g.bitis || (new Date(`${g.bitis}T23:59:59+03:00`).getTime() - Date.now()) / 86_400_000 > 31) return y.code(400).send({ hata: 'Koşul bitişi en geç 30 gündür.' });
    // YG-415: açık maddelerin mali, garanti, güvenlik ve müşteri etkisi ayrıca yazılır ("Yok" dahil) ve Teknik Müdür onayına gider.
    const et = g.etkiler ?? {};
    if (!et.mali?.trim() || !et.garanti?.trim() || !et.guvenlik?.trim() || !et.musteri?.trim()) return y.code(400).send({ hata: 'Açık işlerin mali, garanti, güvenlik ve müşteri etkisini yazınız (etki yoksa "Yok").' });
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO kabul_kaydi (dosya_ref, is_emri_ref, kabul_turu, kosul_bitis, kaydeden_ref, etki_degerlendirmesi, etki_onayi) VALUES ($1,$2,'Koşullu Kabul',$3,$4,$5,'Bekliyor') RETURNING kimlik`, [e.dosya_ref, id, g.bitis, o.kullanici, JSON.stringify({ mali: et.mali!.trim(), garanti: et.garanti!.trim(), guvenlik: et.guvenlik!.trim(), musteri: et.musteri!.trim() })])).rows[0];
      for (const x of kl) await c.query(`INSERT INTO acik_is_kalemi (kabul_ref, is_emri_ref, tanim, etki, hedef_tarih, bedel_eur, sorumlu) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [r.kimlik, id, x.tanim!.trim(), x.etki!.trim(), x.hedef, x.bedel, x.sorumlu?.trim() || 'Çözüm Ortağı (işi yapan firma)']);
      const no = (await c.query(`SELECT is_emri_no FROM is_emri WHERE kimlik = $1`, [id])).rows[0].is_emri_no;
      await kartAc(c, { tur: 'Koşullu Kabul Etki Onayı', baslik: `${no} · Koşullu Kabul Etki Onayı`, ozet: `Mali: ${et.mali!.trim()} · Garanti: ${et.garanti!.trim()} · Güvenlik: ${et.guvenlik!.trim()} · Müşteri: ${et.musteri!.trim()}`.slice(0, 400), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Teknik Müdür')], nesneTuru: 'Kabul', nesneKimligi: r.kimlik });
      // YG-289: onaylı plandaki açık veya koşullu gereklilik satırları koşul bitişine hedefli eksik iş olarak taşınır.
      for (const m of (await c.query(`SELECT g.km_no, g.gereklilik, g.durum FROM gereklilik_satiri g JOIN kalite_plani p ON p.kimlik = g.plan_ref WHERE p.dosya_ref = $1 AND p.durum = 'Onaylı' AND g.durum IN ('Açık', 'Koşullu')`, [e.dosya_ref])).rows)
        await c.query(`INSERT INTO acik_is_kalemi (kabul_ref, is_emri_ref, tanim, etki, hedef_tarih, bedel_eur) VALUES ($1,$2,$3,$4,$5,0)`, [r.kimlik, id, `${m.km_no ?? 'KM'} · ${m.gereklilik}`, `Gereklilik ${m.durum.toLocaleLowerCase('tr-TR')}; doğrulama kanıtı bekleniyor`, g.bitis]);
      await c.query(`UPDATE is_emri SET teknik_kabul_sonucu = 'Koşullu Kabul', teknik_kabul_eden_ref = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, o.kullanici]);
      return { kimlik: r.kimlik };
    });
  });
  s.get('/dosya/:id/kosullu-kabuller', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!(await erisim(id, i.oturum!.kullanici))) return yok(y);
    return (await b.db.query(`SELECT a.kimlik, e.is_emri_no, a.kosul_bitis::text kosul_bitis, a.uzatildi, (SELECT durum FROM is_karti WHERE tur = 'Koşullu Kabul Uzatma' AND nesne_kimligi = a.kimlik::text ORDER BY olusturma_zamani DESC LIMIT 1) talep
      FROM kabul_kaydi a LEFT JOIN is_emri e ON e.kimlik = a.is_emri_ref WHERE a.dosya_ref = $1 AND a.kabul_turu = 'Koşullu Kabul' ORDER BY a.kosul_bitis`, [id])).rows;
  });
  s.post('/kabul/:id/uzatma-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = String((i.body as { gerekce?: string } | undefined)?.gerekce ?? '').trim();
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT a.kimlik, a.uzatildi, d.dosya_no, d.dosya_sorumlusu_ref FROM kabul_kaydi a JOIN dosya d ON d.kimlik = a.dosya_ref WHERE a.kimlik = $1 AND a.kabul_turu = 'Koşullu Kabul'`, [id])).rows[0];
    if (!k) return yok(y);
    if (k.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Uzatmayı Dosya Sorumlusu talep eder.' });
    if (!g) return y.code(400).send({ hata: 'Uzatma gerekçesini yazmanızı rica ederiz.' });
    if (k.uzatildi) return y.code(409).send({ hata: 'Koşul süresi yalnız bir kez uzatılır.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Koşullu Kabul Uzatma' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id])).rowCount) return y.code(409).send({ hata: 'Bu kabul için bekleyen uzatma talebi bulunmaktadır.' });
    const kart = await kartAc(b.db, { tur: 'Koşullu Kabul Uzatma', baslik: `${k.dosya_no} · Koşullu Kabul Süre Uzatması (15 Gün)`, ozet: g.slice(0, 400), hazirlayan: o.kullanici, zincir: [await rolId(b.db, KM)], nesneTuru: 'Kabul', nesneKimligi: id });
    return { kimlik: kart };
  });
  s.post('/kabul/:id/uzat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [KM]))) return y.code(403).send({ hata: 'Uzatmayı Kalite Müdürü verir.' });
    const r = await b.db.query(`UPDATE kabul_kaydi SET kosul_bitis = kosul_bitis + 15, uzatildi = true WHERE kimlik = $1 AND kabul_turu = 'Koşullu Kabul' AND NOT uzatildi RETURNING kosul_bitis::text`, [id]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Koşul süresi yalnız bir kez uzatılır.' });
    return { kosulBitis: r.rows[0].kosul_bitis };
  });
  s.post('/acik-is/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { kanit } = (i.body ?? {}) as { kanit?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT a.dosya_ref FROM acik_is_kalemi p JOIN kabul_kaydi a ON a.kimlik = p.kabul_ref WHERE p.kimlik = $1`, [id])).rows[0];
    if (!k || !(await erisim(k.dosya_ref, o.kullanici))) return yok(y);
    if (!kanit || !UUID.test(kanit)) return y.code(400).send({ hata: 'Kapanış kanıtı zorunludur.' });
    await b.db.query(`UPDATE acik_is_kalemi SET kapanis_kaniti_ref = $2, kapanis_zamani = now() WHERE kimlik = $1`, [id, kanit]);
    return { tamam: true };
  });
  // YG-400, YG-401: birden çok sistem grubunda test varsa bütünleşik test olmadan nihai kabul yok; garanti Nihai Kabulle başlar.
  // YG-082, YG-870 (KS-1): garanti dosyada Dosya Sorumlusunun açık kararıyla tanımlanır; 12 ay yalnız önerilen değerdir.
  s.get('/dosya/:id/garanti', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    const d = (await b.db.query(`SELECT garanti_tanimli, garanti_suresi_ay, garanti_kapsami, garanti_karar_zamani, dosya_sorumlusu_ref = $2 AS ds FROM dosya WHERE kimlik = $1`, [id, o.kullanici])).rows[0];
    return { tanimli: d.garanti_tanimli, sureAy: d.garanti_suresi_ay, kapsam: d.garanti_kapsami, kararZamani: d.garanti_karar_zamani, onerilenAy: 12, duzenleyebilir: d.ds };
  });
  s.post('/dosya/:id/garanti', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tanimli?: boolean; sureAy?: number; kapsam?: string };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND dosya_sorumlusu_ref = $2`, [id, o.kullanici])).rowCount) return y.code(403).send({ hata: 'Garanti kararını dosyanın Dosya Sorumlusu verir.' });
    if (typeof g.tanimli !== 'boolean') return y.code(400).send({ hata: 'Garanti tanımlı olup olmadığını seçiniz.' });
    if (g.tanimli && (!Number.isInteger(Number(g.sureAy)) || Number(g.sureAy) < 1 || Number(g.sureAy) > 120 || !g.kapsam?.trim())) return y.code(400).send({ hata: 'Garanti süresini (ay) ve kapsamını yazınız.' });
    if ((await b.db.query(`SELECT 1 FROM kabul_kaydi WHERE dosya_ref = $1 AND kabul_turu = 'Nihai Kabul' LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Nihai kabulden sonra garanti kararı değiştirilemez.' });
    await b.db.query(`UPDATE dosya SET garanti_tanimli = $2, garanti_suresi_ay = $3, garanti_kapsami = $4, garanti_karar_veren_ref = $5, garanti_karar_zamani = now() WHERE kimlik = $1`, [id, g.tanimli, g.tanimli ? Number(g.sureAy) : null, g.tanimli ? g.kapsam!.trim() : null, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: g.tanimli ? 'Garanti Tanımlandı' : 'Garanti Tanımlanmadı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { sureAy: g.sureAy ?? null, kapsam: g.kapsam ?? null }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/dosya/:id/nihai-kabul', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    if (!(await rolVar(o.kullanici, ['Teknik Yönetici', 'Teknik Müdür', KM]))) return y.code(403).send({ hata: 'Nihai kabulü Teknik Yönetici veya Kalite Müdürü kaydeder.' });
    if ((await b.db.query(`SELECT 1 FROM uygunsuzluk WHERE dosya_ref = $1 AND statu NOT IN ('Kapalı', 'Geçersiz') LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Nihai kabul için açık uygunsuzluğun kapanması bekleniyor.' });
    const eng = await kabulEngeli(b.db, { kimlik: '00000000-0000-0000-0000-000000000000', dosya_ref: id }, 'Kabul');
    if (eng) return y.code(409).send({ hata: eng });
    if ((await b.db.query(`SELECT 1 FROM acik_is_kalemi p JOIN kabul_kaydi a ON a.kimlik = p.kabul_ref WHERE a.dosya_ref = $1 AND p.kapanis_zamani IS NULL LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Açık iş kalemi vardır.' });
    if ((await b.db.query(`SELECT 1 FROM kabul_kaydi WHERE dosya_ref = $1 AND kabul_turu = 'Koşullu Kabul' AND etki_onayi IS NOT NULL AND etki_onayi <> 'Onaylandı' LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Koşullu kabulün etki değerlendirmesi Teknik Müdür onayı bekliyor.' }); // YG-415
    const gr = (await b.db.query(`SELECT test_grubu, bool_or(sonuc = 'Başarılı') basari FROM test_kaydi WHERE dosya_ref = $1 AND durum = 'Tamamlandı' GROUP BY test_grubu`, [id])).rows;
    if (gr.length >= 2 && !gr.some((x) => x.test_grubu === 'Arayüz / Bütünleşik' && x.basari)) return y.code(409).send({ hata: 'Nihai kabul için Bütünleşik test bekleniyor.' });
    // YG-082, YG-870 (KS-1): garanti başlangıcı yalnız garanti tanımlı dosyada yazılır; karar verilmemişse Dosya Sorumlusuna görev açılır.
    const gk = (await b.db.query(`SELECT garanti_tanimli, dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    const r = (await b.db.query(`INSERT INTO kabul_kaydi (dosya_ref, kabul_turu, garanti_baslangic, kaydeden_ref) VALUES ($1,'Nihai Kabul',CASE WHEN $3 THEN (now() AT TIME ZONE 'Europe/Istanbul')::date END,$2) RETURNING garanti_baslangic::text`, [id, o.kullanici, gk.garanti_tanimli === true])).rows[0];
    if (gk.garanti_tanimli === null && gk.dosya_sorumlusu_ref) await kartAc(b.db, { tur: 'Garanti Kararı', kategori: 'islem', baslik: `${gk.dosya_no} · Garanti Kararı Verilmedi`, ozet: 'Dosyada garanti kararı verilmeden nihai kabul yapıldı; bu dosyada garanti oluşmamıştır.', sahipKullanici: gk.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: id });
    return { garantiBaslangic: r.garanti_baslangic };
  });

  // YG-371, YG-372, YG-373, YG-374, YG-375, YG-1432: izni firma tesisten alır, belgesini yükler; LGM düzenlemez, onaylamaz, yalnız görür. En fazla 12 saat geçerli.
  s.post('/is-emri/:id/izin-gerekli', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { gerekli } = (i.body ?? {}) as { gerekli?: boolean };
    if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT dosya_ref FROM is_emri WHERE kimlik = $1`, [id])).rows[0];
    if (!e || !(await erisim(e.dosya_ref, o.kullanici))) return yok(y);
    await b.db.query(`UPDATE is_emri SET calisma_izni_gerekli = $2 WHERE kimlik = $1`, [id, gerekli !== false]);
    return { tamam: true };
  });
  s.post('/firma-portal/is-emri/:id/calisma-izni', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await firmam(o.kullanici); const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; tesis?: string; no?: string; veren?: string; baslangic?: string; bitis?: string; belge?: string; oksijen?: number; yanici?: number };
    if (!f || !UUID.test(id)) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM is_emri WHERE kimlik = $1 AND kurulus_ref = $2`, [id, f])).rowCount) return yok(y);
    if (!g.tur?.trim() || !g.tesis?.trim() || !g.no?.trim() || !g.veren?.trim() || !g.baslangic || !g.bitis) return y.code(400).send({ hata: 'Tür, tesis, izin no, izni veren ve geçerlilik zorunludur.' });
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'İzin belgesi zorunludur.' });
    // YG-638: izin türü LST_CALISMA_IZNI_TURU listesinden; kayıtta listedeki biçimiyle tutulur.
    { const l = (await b.db.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = 'LST_CALISMA_IZNI_TURU'`)).rows.map((r) => r.deger as string); const tr = (x: string) => x.toLocaleLowerCase('tr-TR').trim();
      const eslesen = l.find((x) => tr(x) === tr(g.tur!) || tr(x).startsWith(tr(g.tur!))); if (!eslesen) return y.code(400).send({ hata: `İzin türünü listeden seçiniz: ${l.join(', ')}.` }); g.tur = eslesen; }
    const sure = (new Date(g.bitis).getTime() - new Date(g.baslangic).getTime()) / 3_600_000;
    if (sure <= 0 || sure > 12) return y.code(400).send({ hata: 'İzin başlangıçtan en fazla 12 saat geçerlidir.' });
    if (/sıcak|kapalı/i.test(g.tur) && !gazUygun(Number(g.oksijen), Number(g.yanici))) return y.code(400).send({ hata: 'Gaz ölçümü uygun aralıkta değildir: oksijen %19,5–23,5; yanıcı gaz alt patlama sınırının %10 altında.' });
    return { kimlik: (await b.db.query(`INSERT INTO calisma_izni_belgesi (is_emri_ref, izin_turu, tesis, izin_no, izni_veren, baslangic, bitis, belge_ref, oksijen_yuzde, yanici_gaz_yuzde, yukleyen_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`, [id, g.tur.trim(), g.tesis.trim(), g.no.trim(), g.veren.trim(), g.baslangic, g.bitis, g.belge, g.oksijen ?? null, g.yanici ?? null, o.kullanici])).rows[0].kimlik };
  });
  s.post('/firma-portal/calisma-izni/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await firmam(o.kullanici); const { id } = i.params as { id: string }; const { gozetimDk } = (i.body ?? {}) as { gozetimDk?: number };
    if (!f || !UUID.test(id)) return yok(y);
    const z = (await b.db.query(`SELECT z.izin_turu FROM calisma_izni_belgesi z JOIN is_emri e ON e.kimlik = z.is_emri_ref WHERE z.kimlik = $1 AND e.kurulus_ref = $2`, [id, f])).rows[0];
    if (!z) return yok(y);
    if (/sıcak/i.test(z.izin_turu) && !(Number(gozetimDk) >= 60)) return y.code(409).send({ hata: 'Güvenliğiniz için sıcak işte en az 60 dakika yangın gözetimi kaydını rica ederiz.' });
    await b.db.query(`UPDATE calisma_izni_belgesi SET yangin_gozetim_dk = $2, kapanis_zamani = now() WHERE kimlik = $1`, [id, gozetimDk ?? null]);
    return { tamam: true };
  });

  s.get('/dosya/:id/kalite', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    const q = (t: string) => b.db.query(t, [id]).then((r) => r.rows);
    return {
      planlar: await q(`SELECT kimlik, surum, kabul_sinifi, ozet, durum, risk_seviyesi, teknik_kaynak, sorumluluklar, kaynaklar, kontrol_duzeni, kayit_teslim, degisiklik_gerekcesi FROM kalite_plani WHERE dosya_ref = $1 ORDER BY surum DESC`),
      gereklilikler: await q(`SELECT g.kimlik, g.km_no, g.gereklilik, g.dogrulama, g.durum FROM gereklilik_satiri g JOIN kalite_plani p ON p.kimlik = g.plan_ref WHERE p.dosya_ref = $1 AND p.durum = 'Onaylı'`),
      uygunsuzluklar: await q(`SELECT kimlik, uygunsuzluk_no, sinif, emniyet_isareti, gercek_durum, tasarruf_karari, hedef_zamani, statu, firma_yaniti FROM uygunsuzluk WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`),
      kontrolNoktalari: await q(`SELECT n.kimlik, n.kontrol_noktasi_no, n.nokta_turu, n.kontrol_ozelligi, n.planlanan_zaman, n.sonuc, n.serbest_birakma_zamani FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref WHERE e.dosya_ref = $1 ORDER BY n.planlanan_zaman`),
      testler: await q(`SELECT kimlik, test_no, test_grubu, kabul_olcutu, sonuc, durum FROM test_kaydi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`),
      acikIsler: await q(`SELECT p.kimlik, p.tanim, p.hedef_tarih::text, p.kapanis_zamani FROM acik_is_kalemi p JOIN kabul_kaydi a ON a.kimlik = p.kabul_ref WHERE a.dosya_ref = $1`),
    };
  });
}

kapanisKaydet('Koşullu Kabul Etki Onayı', async (c, k, karar) => { // YG-415
  if (karar === 'Onayla' || karar === 'Reddet') await c.query(`UPDATE kabul_kaydi SET etki_onayi = $2 WHERE kimlik = $1::uuid`, [k.nesne_kimligi, karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi']);
});
