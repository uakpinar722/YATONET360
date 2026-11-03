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
export function cihazGecerli(c: { kalibrasyon_tarihi: Date | string; aralik_ay: number; kabul: boolean }, simdi = new Date()): boolean {
  if (!c.kabul) return false;
  const b = new Date(c.kalibrasyon_tarihi); b.setMonth(b.getMonth() + c.aralik_ay);
  return b >= simdi;
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
export async function kaliteSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
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

kapanisKaydet('Kalite Planı', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE kalite_plani SET durum = 'Onaylı' WHERE kimlik = $1`, [k.nesne_kimligi]);
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
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sinif?: string; ozet?: string; gereklilikler?: { gereklilik?: string; dogrulama?: string }[] };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    if (!(await rolVar(o.kullanici, TEKNIK))) return y.code(403).send({ hata: 'Kalite planını teknik birim hazırlar.' });
    if (!SERBEST_ROLLERI[g.sinif ?? ''] || !g.ozet?.trim()) return y.code(400).send({ hata: 'Kabul sınıfı ve özet zorunludur.' });
    const satir = g.gereklilikler ?? [];
    if (!satir.length || satir.some((x) => !x.gereklilik?.trim() || !x.dogrulama?.trim())) return y.code(400).send({ hata: 'Her gereklilik en az bir doğrulamaya bağlanır.' });
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const surum = (await c.query(`SELECT coalesce(max(surum), 0) + 1 n FROM kalite_plani WHERE dosya_ref = $1`, [id])).rows[0].n;
      const p = (await c.query(`INSERT INTO kalite_plani (dosya_ref, surum, kabul_sinifi, ozet, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, surum, g.sinif, g.ozet!.trim(), o.kullanici])).rows[0];
      for (const x of satir) await c.query(`INSERT INTO gereklilik_satiri (plan_ref, gereklilik, dogrulama) VALUES ($1,$2,$3)`, [p.kimlik, x.gereklilik!.trim(), x.dogrulama!.trim()]);
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
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { isEmri?: string; kaynak?: string; yer?: string; olcut?: string; durum?: string; belge?: string; sinif?: string; emniyet?: boolean; yaygin?: boolean; hasarOnemi?: string; yeniHasar?: boolean };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    if (!g.kaynak || !g.yer?.trim() || !g.olcut?.trim() || !g.durum?.trim()) return y.code(400).send({ hata: 'Tespit kaynağı, yer, dayanak ölçüt ve gerçek durum zorunludur.' });
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
      const r = (await c.query(`INSERT INTO uygunsuzluk (uygunsuzluk_no, dosya_ref, is_emri_ref, tespit_kaynagi, yer_nitelik, dayanak_olcut, gercek_durum, kanit_belge_ref, sinif, yaygin_isareti, emniyet_isareti, hedef_zamani, is_durduruldu, sorumlu_firma_ref, firma_yeni_hasar, acan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING kimlik`, [no, id, e?.kimlik ?? null, g.kaynak, g.yer!.trim(), g.olcut!.trim(), g.durum!.trim(), g.belge, g.sinif, Boolean(g.yaygin), Boolean(g.emniyet), ncrHedefi(g.sinif!), dur && Boolean(e), e?.kurulus_ref ?? null, Boolean(g.yeniHasar), o.kullanici])).rows[0];
      if (dur && e && ['Aktif', 'Başlangıç Kontrolünde'].includes(e.statu)) await c.query(`UPDATE is_emri SET statu = 'Durduruldu', durdurma_nedeni = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, `Uygunsuzluk ${no}`]);
      const alici = [d.dosya_sorumlusu_ref, ...await rolSahipleri(c, await rolId(c, dur ? KM : KK))].filter(Boolean);
      await bildir(c, { olay: `ncr:${r.kimlik}`, kullanicilar: alici, baslik: `${no} · ${g.sinif} Uygunsuzluk`, oncelik: dur ? 'Kritik' : 'Normal' });
      if (e) { const fk = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [e.kurulus_ref])).rows.map((x) => x.kullanici_ref as string); await bildir(c, { olay: `ncr-firma:${r.kimlik}`, kullanicilar: fk, baslik: `${no} · Uygunsuzluk Yanıtınız Bekleniyor`, oncelik: dur ? 'Kritik' : 'Normal' }); }
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
    if (!['Olduğu Gibi Kabul', 'Düzeltme', 'Yeniden İşleme', 'Ayırma/Karantina', 'İade/Değişim', 'Ret/Hurda'].includes(g.karar ?? '')) return y.code(400).send({ hata: 'Kararı seçiniz.' });
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
    if (!['Etkili', 'Etkisiz'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Sonucu seçiniz.' });
    if (!g.kanit || !UUID.test(g.kanit)) return y.code(400).send({ hata: 'Tamamlanma kanıtı zorunludur.' });
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
      if (n.is_durduruldu && n.is_emri_ref) await c.query(`UPDATE is_emri SET statu = 'Aktif', durdurma_nedeni = NULL, guncelleme_zamani = now() WHERE kimlik = $1 AND statu = 'Durduruldu' AND durdurma_nedeni = $2`, [n.is_emri_ref, `Uygunsuzluk ${n.uygunsuzluk_no}`]);
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
    return islem(async (c) => {
      const no = await altNumara(c, e.is_emri_no, 'KP');
      const r = (await c.query(`INSERT INTO kontrol_noktasi (kontrol_noktasi_no, is_emri_ref, kalem, nokta_turu, kontrol_ozelligi, kabul_olcutu, planlanan_zaman, eksper_klas, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [no, id, g.kalem ?? null, g.tur, g.ozellik!.trim(), g.olcut!.trim(), g.zaman, Boolean(g.eksperKlas), o.kullanici])).rows[0];
      return { kimlik: r.kimlik, no };
    });
  });
  s.post('/kontrol-noktasi/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; katilim?: string; kanit?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT n.*, e.dosya_ref, e.kabul_sinifi FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref WHERE n.kimlik = $1`, [id])).rows[0];
    if (!k || !(await erisim(k.dosya_ref, o.kullanici))) return yok(y);
    if (!['Uygun', 'Koşullu uygun', 'Düzeltme gerekli', 'Reddedildi'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Sonucu seçiniz.' });
    if (!g.kanit || !UUID.test(g.kanit)) return y.code(400).send({ hata: 'Kanıt zorunludur.' });
    if (k.serbest_birakma_zamani) return y.code(409).send({ hata: 'Kontrol noktası serbest bırakılmıştır.' });
    const p = (await b.db.query(`SELECT kabul_sinifi FROM kalite_plani WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY surum DESC LIMIT 1`, [k.dosya_ref])).rows[0];
    const gereken = SERBEST_ROLLERI[k.kabul_sinifi ?? p?.kabul_sinifi ?? 'D']!;
    const benimRol = (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2)`, [o.kullanici, gereken])).rows.map((r) => r.rol_adi as string);
    if (!benimRol.length) return y.code(403).send({ hata: `Bu noktayı ${gereken.join(' ve ')} serbest bırakır.` });
    if (g.sonuc !== 'Uygun' && g.sonuc !== 'Koşullu uygun') { await b.db.query(`UPDATE kontrol_noktasi SET sonuc = $2, kanit_belge_ref = $3, katilim_durumu = $4 WHERE kimlik = $1`, [id, g.sonuc, g.kanit, g.katilim ?? null]); return { sonuc: g.sonuc, serbest: false, uygunsuzlukGerekli: true }; }
    const onay = [...new Set([...(k.onaylar as string[]), ...benimRol])];
    const tam = gereken.every((r) => onay.includes(r));
    await b.db.query(`UPDATE kontrol_noktasi SET sonuc = $2, kanit_belge_ref = $3, katilim_durumu = $4, onaylar = $5, serbest_birakma_zamani = CASE WHEN $6::boolean THEN now() END WHERE kimlik = $1`, [id, g.sonuc, g.kanit, g.katilim ?? null, JSON.stringify(onay), tam]);
    return { sonuc: g.sonuc, serbest: tam, bekleyen: gereken.filter((r) => !onay.includes(r)) };
  });

  s.post('/olcum-cihazi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ad?: string; seri?: string; tarih?: string; aralik?: number; kabul?: boolean };
    if (!(await rolVar(o.kullanici, [...TEKNIK, KK, KM]))) return y.code(403).send({ hata: 'Bu işlem teknik ve kalite birimlerine aittir.' });
    if (!g.ad?.trim() || !g.seri?.trim() || !g.tarih) return y.code(400).send({ hata: 'Ad, seri no ve kalibrasyon tarihi zorunludur.' });
    return { kimlik: (await b.db.query(`INSERT INTO olcum_cihazi (ad, seri_no, kalibrasyon_tarihi, aralik_ay, kabul, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [g.ad.trim(), g.seri.trim(), g.tarih, g.aralik ?? 12, g.kabul !== false, o.kullanici])).rows[0].kimlik };
  });
  // YG-286, YG-396, YG-397: ölçüt test açılırken kilitlenir; cihaz kalibrasyonu; yeniden test yeni numara; hazırlayan, kontrol eden ve karar veren ayrı.
  s.post('/dosya/:id/test', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { grup?: string; amac?: string; yontem?: string; olcut?: string; durdurma?: string; cihazlar?: string[]; onceki?: string };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    if (!['Gövde ve Yapısal', 'Makine ve Tahrik', 'Elektrik/Elektronik', 'Tesisat ve Yardımcı', 'Seyir ve Haberleşme', 'İç Mekân ve Donanım', 'Arayüz / Bütünleşik'].includes(g.grup ?? '')) return y.code(400).send({ hata: 'Test grubunu seçiniz.' });
    if (!g.amac?.trim() || !g.yontem?.trim() || !g.olcut?.trim() || !g.durdurma?.trim()) return y.code(400).send({ hata: 'Amaç, yöntem, kabul ölçütü ve durdurma koşulu zorunludur.' });
    if (/^\s*(normal|iyi|uygun|çalışıyor)\s*\.?\s*$/i.test(g.olcut)) return y.code(400).send({ hata: 'Kabul ölçütünü ölçülebilir biçimde yazmanızı rica ederiz.' });
    const cihaz = g.cihazlar ?? [];
    for (const c of (await b.db.query(`SELECT ad, kalibrasyon_tarihi, aralik_ay, kabul FROM olcum_cihazi WHERE kimlik = ANY($1::uuid[])`, [cihaz])).rows) if (!cihazGecerli(c)) return y.code(409).send({ hata: `${c.ad} kalibrasyonu geçersizdir; testte geçerli bir cihaz seçmenizi rica ederiz.` });
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const no = await altNumara(c, d.dosya_no, 'TS');
      const r = (await c.query(`INSERT INTO test_kaydi (test_no, dosya_ref, onceki_test_ref, test_grubu, amac_kapsam, yontem, kabul_olcutu, durdurma_kosulu, cihazlar, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`, [no, id, g.onceki ?? null, g.grup, g.amac!.trim(), g.yontem!.trim(), g.olcut!.trim(), g.durdurma!.trim(), cihaz, o.kullanici])).rows[0];
      return { kimlik: r.kimlik, testNo: no };
    });
  });
  s.post('/test/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; gerekce?: string; hamVeri?: string; gozlem?: string; durdurma?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT * FROM test_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!t || !(await erisim(t.dosya_ref, o.kullanici))) return yok(y);
    if (t.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Sonucu testi hazırlayan girer.' });
    if (t.durum !== 'Planlandı') return y.code(409).send({ hata: 'Sonuç girilmiştir; yeniden test yeni numara alır.' });
    if (!['Başarılı', 'Koşullu', 'Başarısız', 'Geçersiz', 'Engellendi'].includes(g.sonuc ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Sonuç ve gerekçe zorunludur.' });
    if (!g.hamVeri || !UUID.test(g.hamVeri)) return y.code(400).send({ hata: 'Ham veri zorunludur.' });
    await b.db.query(`UPDATE test_kaydi SET sonuc = $2, sonuc_gerekcesi = $3, ham_veri_ref = $4, gozlemler = $5, durdurma_olayi = $6, durum = 'Kontrolde' WHERE kimlik = $1`, [id, g.sonuc, g.gerekce.trim(), g.hamVeri, g.gozlem ?? null, g.durdurma ?? null]);
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
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { bitis?: string; kalemler?: { tanim?: string; etki?: string; hedef?: string }[] };
    if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT kimlik, dosya_ref, statu FROM is_emri WHERE kimlik = $1`, [id])).rows[0];
    if (!e || !(await erisim(e.dosya_ref, o.kullanici))) return yok(y);
    if (!(await rolVar(o.kullanici, ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)']))) return y.code(403).send({ hata: 'Teknik kabulü Teknik Uzman verir.' });
    if (e.statu !== 'Tamamlandı') return y.code(409).send({ hata: 'Firma işi tamamlandı bildirmemiştir.' });
    const eng = await kabulEngeli(b.db, e, 'Koşullu Kabul');
    if (eng) return y.code(409).send({ hata: eng });
    const kl = g.kalemler ?? [];
    if (!kl.length || kl.some((x) => !x.tanim?.trim() || !x.etki?.trim() || !x.hedef)) return y.code(400).send({ hata: 'Her açık iş tanım, etki ve hedef tarih taşır.' });
    if (!g.bitis || (new Date(`${g.bitis}T23:59:59+03:00`).getTime() - Date.now()) / 86_400_000 > 31) return y.code(400).send({ hata: 'Koşul bitişi en geç 30 gündür.' });
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO kabul_kaydi (dosya_ref, is_emri_ref, kabul_turu, kosul_bitis, kaydeden_ref) VALUES ($1,$2,'Koşullu Kabul',$3,$4) RETURNING kimlik`, [e.dosya_ref, id, g.bitis, o.kullanici])).rows[0];
      for (const x of kl) await c.query(`INSERT INTO acik_is_kalemi (kabul_ref, is_emri_ref, tanim, etki, hedef_tarih) VALUES ($1,$2,$3,$4,$5)`, [r.kimlik, id, x.tanim!.trim(), x.etki!.trim(), x.hedef]);
      await c.query(`UPDATE is_emri SET teknik_kabul_sonucu = 'Koşullu Kabul', teknik_kabul_eden_ref = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, o.kullanici]);
      return { kimlik: r.kimlik };
    });
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
  s.post('/dosya/:id/nihai-kabul', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!(await erisim(id, o.kullanici))) return yok(y);
    if (!(await rolVar(o.kullanici, ['Teknik Yönetici', 'Teknik Müdür', KM]))) return y.code(403).send({ hata: 'Nihai kabulü Teknik Yönetici veya Kalite Müdürü kaydeder.' });
    if ((await b.db.query(`SELECT 1 FROM uygunsuzluk WHERE dosya_ref = $1 AND statu NOT IN ('Kapalı', 'Geçersiz') LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Nihai kabul için açık uygunsuzluğun kapanması bekleniyor.' });
    const eng = await kabulEngeli(b.db, { kimlik: '00000000-0000-0000-0000-000000000000', dosya_ref: id }, 'Kabul');
    if (eng) return y.code(409).send({ hata: eng });
    if ((await b.db.query(`SELECT 1 FROM acik_is_kalemi p JOIN kabul_kaydi a ON a.kimlik = p.kabul_ref WHERE a.dosya_ref = $1 AND p.kapanis_zamani IS NULL LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Açık iş kalemi vardır.' });
    const gr = (await b.db.query(`SELECT test_grubu, bool_or(sonuc = 'Başarılı') basari FROM test_kaydi WHERE dosya_ref = $1 AND durum = 'Tamamlandı' GROUP BY test_grubu`, [id])).rows;
    if (gr.length >= 2 && !gr.some((x) => x.test_grubu === 'Arayüz / Bütünleşik' && x.basari)) return y.code(409).send({ hata: 'Nihai kabul için Bütünleşik test bekleniyor.' });
    const r = (await b.db.query(`INSERT INTO kabul_kaydi (dosya_ref, kabul_turu, garanti_baslangic, kaydeden_ref) VALUES ($1,'Nihai Kabul',(now() AT TIME ZONE 'Europe/Istanbul')::date,$2) RETURNING garanti_baslangic::text`, [id, o.kullanici])).rows[0];
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
      planlar: await q(`SELECT kimlik, surum, kabul_sinifi, ozet, durum FROM kalite_plani WHERE dosya_ref = $1 ORDER BY surum DESC`),
      gereklilikler: await q(`SELECT g.kimlik, g.gereklilik, g.dogrulama, g.durum FROM gereklilik_satiri g JOIN kalite_plani p ON p.kimlik = g.plan_ref WHERE p.dosya_ref = $1 AND p.durum = 'Onaylı'`),
      uygunsuzluklar: await q(`SELECT kimlik, uygunsuzluk_no, sinif, emniyet_isareti, gercek_durum, tasarruf_karari, hedef_zamani, statu, firma_yaniti FROM uygunsuzluk WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`),
      kontrolNoktalari: await q(`SELECT n.kimlik, n.kontrol_noktasi_no, n.nokta_turu, n.kontrol_ozelligi, n.planlanan_zaman, n.sonuc, n.serbest_birakma_zamani FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref WHERE e.dosya_ref = $1 ORDER BY n.planlanan_zaman`),
      testler: await q(`SELECT kimlik, test_no, test_grubu, kabul_olcutu, sonuc, durum FROM test_kaydi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`),
      acikIsler: await q(`SELECT p.kimlik, p.tanim, p.hedef_tarih::text, p.kapanis_zamani FROM acik_is_kalemi p JOIN kabul_kaydi a ON a.kimlik = p.kabul_ref WHERE a.dosya_ref = $1`),
    };
  });
}
