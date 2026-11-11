import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;
const GORUR = ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü', 'Strateji ve Kurumsal Gelişim Direktörü', 'Teknik ve Operasyon Direktörü', 'Operasyon Müdürü', 'Teknik Müdür', 'Kalite Müdürü', 'Risk ve Kalite Direktörü', 'Firma Yönetimi Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Bilgi İşlem Müdürü', 'Muhasebe ve Finans Müdürü'];
/** Firma ve kişi düzeyinde ayrıntıyı görebilen roller; diğerlerinde küçük gruplar gizlenir (YG-756). */
const AYRINTI = ['CEO', 'Genel Müdür Yardımcısı', 'Teknik ve Operasyon Direktörü', 'Operasyon Müdürü', 'Firma Yönetimi Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
/** YG-756: bu sayının altındaki gruplarda değer gösterilmez; toplamdan tekil kayıt çıkarılamaz. YG-746: altındaki firma sıralanmaz. */
export const ASGARI_GRUP = 3;
const R1 = (x: number) => Math.round(x * 10) / 10;

/** Sıralı dizide yüzdelik (doğrusal ara değer). */
export function yuzdelik(l: number[], p: number): number | null {
  if (!l.length) return null; const s = [...l].sort((a, b) => a - b); const k = (s.length - 1) * p; const a = Math.floor(k), b = Math.ceil(k);
  return R1(s[a]! + (s[b]! - s[a]!) * (k - a));
}
const ozet = (l: number[]) => ({ adet: l.length, medyan: yuzdelik(l, 0.5), p90: yuzdelik(l, 0.9), ortalama: l.length ? R1(l.reduce((a, x) => a + x, 0) / l.length) : null });

/** YG-747: kapanan dosyada toplam geçen süre ve yetkili duraklamalar (sayacı durduran Beklemede işaretleri) düşülmüş net çalışma süresi, gün. */
export async function cevrimSureleri(db: Db, bas: string, son: string) {
  return (await db.query(`SELECT d.kimlik, d.dosya_no, d.hizmet_turu, coalesce(d.ana_teknik_brans, '—') brans, d.oncelik,
      (SELECT k.kurulus_ref FROM is_emri k WHERE k.dosya_ref = d.kimlik AND k.statu NOT IN ('İptal', 'Yerine Geçti') ORDER BY k.olusturma_zamani LIMIT 1) firma,
      extract(epoch FROM d.kapanis_zamani - d.acilis_tarihi) / 86400 toplam,
      coalesce((SELECT sum(extract(epoch FROM least(coalesce(b.kaldirilma_zamani, d.kapanis_zamani), d.kapanis_zamani) - b.olusturma_zamani)) / 86400 FROM beklemede_isareti b WHERE b.dosya_ref = d.kimlik AND b.sayac_durur), 0) durak
    FROM dosya d WHERE d.statu = 'Kapalı' AND d.kapanis_zamani >= $1 AND d.kapanis_zamani < $2`, [bas, son])).rows
    .map((r) => ({ kimlik: r.kimlik as string, dosyaNo: r.dosya_no as string, hizmet: r.hizmet_turu as string, brans: r.brans as string, oncelik: r.oncelik as string, firma: r.firma as string | null, toplam: R1(Number(r.toplam)), net: R1(Math.max(0, Number(r.toplam) - Number(r.durak))) }));
}

/** YG-741, YG-756: kırılım; küçük gruplar ayrıntı yetkisi olmayanlarda gizlenir. */
function kirilim<T extends Record<string, unknown>>(l: T[], anahtar: keyof T, deger: (x: T) => number, ayrinti: boolean) {
  const m = new Map<string, number[]>(); for (const x of l) { const k = String(x[anahtar] ?? '—'); m.set(k, [...(m.get(k) ?? []), deger(x)]); }
  return [...m].map(([k, v]) => (ayrinti || v.length >= ASGARI_GRUP ? { grup: k, ...ozet(v) } : { grup: k, adet: v.length, medyan: null, p90: null, ortalama: null, gizli: true })).sort((a, b) => b.adet - a.adet);
}

/**
 * YG-746: firma karşılaştırması iş karışımına göre normalize edilir: her dosyanın net süresi aynı branş ve öncelikteki dosyaların medyanına bölünür;
 * firmanın endeksi bu oranların medyanıdır (1 = beklenen). En az üç dosyası olmayan firma sıralanmaz, tek dosyaya bakılarak hüküm kurulmaz.
 */
function firmaEndeksi(l: Awaited<ReturnType<typeof cevrimSureleri>>) {
  const grupMed = new Map<string, number>();
  for (const k of new Set(l.map((x) => `${x.brans}|${x.oncelik}`))) grupMed.set(k, yuzdelik(l.filter((x) => `${x.brans}|${x.oncelik}` === k).map((x) => x.net), 0.5) ?? 0);
  const f = new Map<string, number[]>();
  for (const x of l) { if (!x.firma) continue; const m = grupMed.get(`${x.brans}|${x.oncelik}`)!; if (m > 0) f.set(x.firma, [...(f.get(x.firma) ?? []), x.net / m]); }
  return [...f].map(([firma, v]) => ({ firma, dosya: v.length, endeks: v.length >= ASGARI_GRUP ? yuzdelik(v, 0.5) : null, durum: v.length >= ASGARI_GRUP ? 'Karşılaştırılabilir' : 'Yetersiz veri' }));
}

/** YG-748: eğilim serisi ve kırılma noktaları (yeni sürüm, rapor tanımı, kartela sürümü, yeni firma). */
async function egilim(db: Db, aylar: string[]) {
  const seri = [];
  for (const a of aylar) {
    const bas = `${a}-01`; const s = new Date(`${bas}T00:00:00Z`); s.setUTCMonth(s.getUTCMonth() + 1); const son = s.toISOString().slice(0, 10);
    const l = await cevrimSureleri(db, bas, son);
    seri.push({ ay: a, acilan: Number((await db.query(`SELECT count(*) n FROM dosya WHERE acilis_tarihi >= $1 AND acilis_tarihi < $2`, [bas, son])).rows[0].n), kapanan: l.length, netMedyan: yuzdelik(l.map((x) => x.net), 0.5) });
  }
  const ilk = `${aylar[0]}-01`;
  const kirilma = (await db.query(`SELECT to_char(z, 'YYYY-MM') ay, aciklama FROM (
      SELECT uretim_zamani z, 'Yeni sürüm üretime alındı: ' || surum aciklama FROM yayin_seti WHERE durum = 'Üretimde' AND uretim_zamani >= $1
      UNION ALL SELECT yururluk::timestamptz, 'Ölçüm tanımı değişti: ' || kod || ' sürüm ' || surum FROM rapor_tanimi WHERE surum > 1 AND durum <> 'Planlandı' AND yururluk >= $1
      UNION ALL SELECT yururluk::timestamptz, 'Kartela sürümü yürürlüğe girdi: ' || surum FROM kartela_surumu WHERE yururluk >= $1 AND durum <> 'Taslak'
      UNION ALL SELECT min(e.olusturma_zamani), 'Yeni Çözüm Ortağı iş almaya başladı' FROM is_emri e GROUP BY e.kurulus_ref HAVING min(e.olusturma_zamani) >= $1
    ) x ORDER BY z`, [ilk])).rows;
  return { seri, kirilma };
}

/** YG-750: maliyet ve süre sapması; ilk teklif, onaylı değişiklikler, fiilî fatura ve ilk tahminle fiilî teslim. */
async function sapma(db: Db, bas: string, son: string) {
  return (await db.query(`SELECT d.dosya_no,
      (SELECT f.genel_toplam_eur FROM fiyat_teklifi f WHERE f.dosya_ref = d.kimlik AND f.teklif_turu = 'Fiyat Teklifi' AND f.gonderim_zamani IS NOT NULL ORDER BY f.gonderim_zamani LIMIT 1) ilk_plan,
      (SELECT coalesce(sum(p.bedel_farki_eur), 0) FROM degisiklik_protokolu p WHERE p.dosya_ref = d.kimlik AND p.durum = 'Onaylandı') onayli_degisiklik,
      (SELECT string_agg(p.tur || ': ' || left(p.onerilen, 60), '; ') FROM degisiklik_protokolu p WHERE p.dosya_ref = d.kimlik AND p.durum = 'Onaylandı') degisiklik_nedeni,
      (SELECT coalesce(sum(p.ek_sure_gun), 0) FROM degisiklik_protokolu p WHERE p.dosya_ref = d.kimlik AND p.durum = 'Onaylandı') onayli_ek_gun,
      (SELECT sum(m.kdv_haric_eur) FROM musteri_faturasi m WHERE m.dosya_ref = d.kimlik AND m.durum IN ('Faturalandı', 'Kısmi Tahsil', 'Tahsil Edildi')) fiili,
      d.ilk_tahmini_teslim_tarihi::text ilk_teslim, d.teslim_tarihi::text fiili_teslim,
      (SELECT string_agg(DISTINCT b.neden, '; ') FROM beklemede_isareti b WHERE b.dosya_ref = d.kimlik) beklenmeyen
    FROM dosya d WHERE d.statu = 'Kapalı' AND d.kapanis_zamani >= $1 AND d.kapanis_zamani < $2 ORDER BY d.dosya_no`, [bas, son])).rows.map((r) => {
    const ilk = r.ilk_plan === null ? null : Number(r.ilk_plan); const deg = Number(r.onayli_degisiklik); const fi = r.fiili === null ? null : Number(r.fiili);
    const gun = r.ilk_teslim && r.fiili_teslim ? Math.round((+new Date(r.fiili_teslim) - +new Date(r.ilk_teslim)) / 86_400_000) : null;
    return { dosyaNo: r.dosya_no, ilkPlan: ilk, onayliDegisiklik: deg, degisiklikNedeni: r.degisiklik_nedeni, fiili: fi, aciklanamayan: ilk !== null && fi !== null ? Math.round((fi - ilk - deg) * 100) / 100 : null, sureSapmasiGun: gun, onayliEkGun: Number(r.onayli_ek_gun), beklenmeyenKosul: r.beklenmeyen };
  });
}

/** YG-745: veri profilleme; doluluk, farklı değer, tarih aralığı, biçim hatası, mükerrer aday ve ilişki kopukluğu. */
const PROFIL: Record<string, { mukerrer?: string; bicim?: Record<string, string>; iliski?: [string, string][] }> = {
  dosya: { iliski: [['yat_ref', 'yat'], ['dosya_sorumlusu_ref', 'kullanici_hesabi']] },
  yat: { mukerrer: `lower(yat_adi)` },
  kurulus: { mukerrer: `lower(ticari_unvan)` },
  taraf: { bicim: { telefon: '^\\+?[0-9 ]{10,15}$', eposta: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' } },
  musteri_faturasi: { iliski: [['dosya_ref', 'dosya']] },
};
export async function veriProfili(db: Db, tablo: string) {
  const p = PROFIL[tablo]; if (!p) return null;
  const kol = (await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [tablo])).rows as { column_name: string; data_type: string }[];
  const n = Number((await db.query(`SELECT count(*) n FROM ${tablo}`)).rows[0].n);
  const alanlar = [];
  for (const c of kol) {
    const q = `"${c.column_name.replace(/"/g, '')}"`; const tarih = /date|timestamp/.test(c.data_type);
    const r = (await db.query(`SELECT count(${q}) dolu, count(DISTINCT ${q}) farkli${tarih ? `, min(${q})::text en_kucuk, max(${q})::text en_buyuk` : ''} FROM ${tablo}`)).rows[0];
    const bicimHata = p.bicim?.[c.column_name] ? Number((await db.query(`SELECT count(*) n FROM ${tablo} WHERE ${q} IS NOT NULL AND ${q}::text !~ $1`, [p.bicim[c.column_name]])).rows[0].n) : null;
    alanlar.push({ alan: c.column_name, doluluk: n ? R1((100 * Number(r.dolu)) / n) : null, farkli: Number(r.farkli), enKucuk: r.en_kucuk ?? null, enBuyuk: r.en_buyuk ?? null, bicimHata });
  }
  const mukerrer = p.mukerrer ? Number((await db.query(`SELECT count(*) n FROM (SELECT ${p.mukerrer} FROM ${tablo} GROUP BY 1 HAVING count(*) > 1) x`)).rows[0].n) : null;
  const kopuk = []; for (const [k, h] of p.iliski ?? []) kopuk.push({ alan: k, hedef: h, kopuk: Number((await db.query(`SELECT count(*) n FROM ${tablo} t WHERE t.${k} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${h} x WHERE x.kimlik::text = t.${k}::text)`)).rows[0].n) });
  return { tablo, kayit: n, alanlar, mukerrerAday: mukerrer, iliskiKopuklugu: kopuk };
}

export function analizYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, l: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, l])).rowCount);
  s.get('/analiz', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, GORUR))) return yok(y);
    const ayrinti = await rolde(o.kullanici, AYRINTI);
    const q = (i.query ?? {}) as { bas?: string; son?: string };
    const t = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
    const son = t(q.son) ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10); const bas = t(q.bas) ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const l = await cevrimSureleri(b.db, bas, son);
    const aylar = Array.from({ length: 12 }, (_, k) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 11 + k); return d.toISOString().slice(0, 7); });
    const firmalar = firmaEndeksi(l); const ad = new Map((await b.db.query(`SELECT kimlik, ticari_unvan FROM kurulus WHERE kimlik = ANY($1)`, [firmalar.map((f) => f.firma)])).rows.map((r) => [r.kimlik, r.ticari_unvan]));
    return {
      filtre: { bas, son, kapsam: 'Kapanan dosyalar (kapanış tarihi)' }, uretim: new Date().toISOString(), asgariGrup: ASGARI_GRUP,
      cevrim: { toplam: ozet(l.map((x) => x.toplam)), net: ozet(l.map((x) => x.net)) },
      kirilim: { hizmet: kirilim(l, 'hizmet', (x) => x.net, ayrinti), brans: kirilim(l, 'brans', (x) => x.net, ayrinti), oncelik: kirilim(l, 'oncelik', (x) => x.net, ayrinti) },
      firma: ayrinti ? firmalar.map((f) => ({ ...f, firma: ad.get(f.firma) ?? '—' })).sort((a, c) => (a.endeks ?? 99) - (c.endeks ?? 99)) : null,
      egilim: await egilim(b.db, aylar), sapma: await sapma(b.db, bas, son),
    };
  });
  s.get('/veri-profili/:tablo', oturumlu, async (i, y) => {
    if (!(await rolde(i.oturum!.kullanici, ['Bilgi İşlem Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Strateji ve Kurumsal Gelişim Direktörü', 'Risk ve Kalite Direktörü', 'CEO', 'Genel Müdür Yardımcısı']))) return yok(y);
    const r = await veriProfili(b.db, (i.params as { tablo: string }).tablo); return r ?? yok(y);
  });
}
