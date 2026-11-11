import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { raporCalistir } from './rapor_katalogu.js';

type Db = Pool | PoolClient;
const GORUR = ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü', 'Muhasebe ve Finans Müdürü', 'Strateji ve Kurumsal Gelişim Direktörü'];
const DENETIM = ['İç Denetim Müdürü', 'İç Denetçi'];
const ONAY = ['Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü'];
/** YG-1462: ilk müşteri payı %30, ilk üç müşteri payı %60 üzerinde sarı uyarı. YG-779: dönüşüm hedefi %70, üç aylık ortalama %60 altında erken uyarı. YG-781: hedef 10, uyarı 15 iş günü. */
export const ESIK = { ilk1: 30, ilk3: 60, donusumHedef: 70, donusumUyari: 60, maliHedef: 10, maliUyari: 15, orneklem: 0.1, kayipAy: 12 };
const R1 = (x: number) => Math.round(x * 10) / 10;
const ayBas = (donem: string, kaydir = 0) => { const d = new Date(`${donem}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + kaydir); return d.toISOString().slice(0, 10); };
const kisiler = async (db: Db, roller: string[]) => { const k: string[] = []; for (const r of roller) { const id = (await db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [r])).rows[0]?.kimlik; if (id) k.push(...await rolSahipleri(db, id)); } return [...new Set(k)]; };

/** YG-1472 iş günü kuralı: Pazar ve resmî tatil sayılmaz, arife yarım gün. a ile b arasındaki iş günü sayısı. */
export async function isGunuSayisi(db: Db, a: Date, b: Date): Promise<number> {
  const r = (await db.query(`SELECT to_char(tarih, 'YYYY-MM-DD') t, yarim_gun FROM resmi_tatil`)).rows;
  const tatil = new Set(r.filter((x) => !x.yarim_gun).map((x) => x.t as string)); const arife = new Set(r.filter((x) => x.yarim_gun).map((x) => x.t as string));
  const x = new Date(a.getTime()); let n = 0;
  while (true) { x.setUTCDate(x.getUTCDate() + 1); if (x > b) break; const y = new Date(x.getTime() + 180 * 60_000); const t = y.toISOString().slice(0, 10); if (y.getUTCDay() !== 0 && !tatil.has(t)) n += arife.has(t) ? 0.5 : 1; }
  return n;
}

/** Teknik kapanış (onaylı kapanış kontrolü, çıkış Teknik Kapalı) ile mali kapanış (dosya Kapalı) arası. */
async function maliKapanis(db: Db, bas: string, son: string, simdi = new Date()) {
  const l = (await db.query(`SELECT d.kimlik, d.dosya_no, d.statu, k.kapanis_zamani teknik, d.kapanis_zamani mali FROM dosya d JOIN LATERAL (SELECT kapanis_zamani FROM kapanis_kontrolu k WHERE k.dosya_ref = d.kimlik AND k.cikis_statusu = 'Teknik Kapalı' AND k.durum = 'Onaylandı' AND k.kapanis_zamani IS NOT NULL ORDER BY k.kapanis_zamani LIMIT 1) k ON true
    WHERE (d.kapanis_zamani >= $1 AND d.kapanis_zamani < $2) OR d.statu = 'Teknik Kapalı'`, [bas, son])).rows;
  const out = []; for (const r of l) out.push({ dosyaNo: r.dosya_no, kimlik: r.kimlik, acik: r.statu !== 'Kapalı', isGunu: await isGunuSayisi(db, new Date(r.teknik), r.mali ? new Date(r.mali) : simdi) });
  return out;
}

async function donusum(db: Db, bas: string, son: string) {
  const r = (await db.query(`SELECT count(*) FILTER (WHERE statu = 'Karar' AND karar = ANY($3)) onay, count(*) n FROM fiyat_teklifi f WHERE f.karar_zamani >= $1 AND f.karar_zamani < $2 AND (f.statu = 'Karar' OR f.statu IN ('Reddedildi', 'Süresi Doldu')) AND f.gonderim_zamani IS NOT NULL`, [bas, son, ONAY])).rows[0];
  return { gonderilen: Number(r.n), onaylanan: Number(r.onay), oran: Number(r.n) ? R1((100 * Number(r.onay)) / Number(r.n)) : null };
}

/** YG-764, 769, 770, 779, 781, 1462, 1536: aylık yönetim raporu ekleri. */
export async function yonetimEkleri(db: Db, donem: string) {
  const bas = ayBas(donem), son = ayBas(donem, 1), yil = ayBas(donem, -11);
  const ciro = (await db.query(`SELECT muhatap, sum(kdv_haric_eur)::float8 t FROM musteri_faturasi WHERE durum IN ('Faturalandı', 'Kısmi Tahsil', 'Tahsil Edildi') AND fatura_tarihi >= $1 AND fatura_tarihi < $2 GROUP BY 1 ORDER BY 2 DESC`, [yil, son])).rows;
  const top = ciro.reduce((a, x) => a + x.t, 0);
  const pay = (n: number) => (top ? R1((100 * ciro.slice(0, n).reduce((a, x) => a + x.t, 0)) / top) : 0);
  const yogunlasma = { donem: `${yil.slice(0, 7)} – ${donem}`, toplamEur: Math.round(top * 100) / 100, ilk1: pay(1), ilk3: pay(3), ilkMusteriler: ciro.slice(0, 3).map((x) => ({ muhatap: x.muhatap, pay: top ? R1((100 * x.t) / top) : 0 })), uyari: [] as string[] };
  if (yogunlasma.ilk1 > ESIK.ilk1) yogunlasma.uyari.push(`İlk müşterinin payı %${yogunlasma.ilk1} (eşik %${ESIK.ilk1})`);
  if (yogunlasma.ilk3 > ESIK.ilk3) yogunlasma.uyari.push(`İlk üç müşterinin payı %${yogunlasma.ilk3} (eşik %${ESIK.ilk3})`);
  // YG-769: son dosyası kapanalı 12 aydan uzun olan ve yeni dosyası olmayan yatlar.
  const kayip = (await db.query(`SELECT y.yat_adi, max(d.kapanis_zamani)::date::text son_kapanis, count(d.kimlik)::int dosya FROM yat y JOIN dosya d ON d.yat_ref = y.kimlik GROUP BY y.kimlik, y.yat_adi
    HAVING bool_and(d.statu = 'Kapalı') AND max(d.kapanis_zamani) < $1::date - make_interval(months => $2) ORDER BY max(d.kapanis_zamani) DESC LIMIT 100`, [son, ESIK.kayipAy])).rows;
  // YG-770: dönemde kademe atlamaları.
  const kademe = (await db.query(`SELECT k.baslik, k.tur, h.ad_soyad yapan, a.gerekce, a.zaman FROM is_karti_adim a JOIN is_karti k ON k.kimlik = a.is_ref JOIN kullanici_hesabi h ON h.kimlik = a.yapan_ref WHERE a.karar = 'Kademe Atla' AND a.zaman >= $1 AND a.zaman < $2 ORDER BY a.zaman`, [bas, son])).rows;
  const d0 = await donusum(db, bas, son); const d3 = await donusum(db, ayBas(donem, -2), son);
  const teklif = { ...d0, ucAylik: d3.oran, hedef: ESIK.donusumHedef, uyari: d3.oran !== null && d3.oran < ESIK.donusumUyari };
  const mk = await maliKapanis(db, bas, son);
  const kapanan = mk.filter((x) => !x.acik);
  const mali = { ortalamaIsGunu: kapanan.length ? R1(kapanan.reduce((a, x) => a + x.isGunu, 0) / kapanan.length) : null, hedef: ESIK.maliHedef, asan: mk.filter((x) => x.isGunu > ESIK.maliUyari).map((x) => ({ dosyaNo: x.dosyaNo, isGunu: x.isGunu, acik: x.acik })) };
  // YG-1536: marka/model bazında dosya, hizmet türü ve branş dağılımı; "Diğer" girişleri ayrı.
  const mm = (await db.query(`SELECT coalesce(m.marka, y.marka_diger, 'Belirtilmemiş') marka, coalesce(m.model, y.model_diger, '') model, (y.marka_model_ref IS NULL AND y.marka_diger IS NOT NULL) diger, y.diger_onay_durumu, count(d.kimlik)::int dosya
    FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref WHERE d.acilis_tarihi < $1 GROUP BY 1, 2, 3, 4 ORDER BY dosya DESC LIMIT 200`, [son])).rows;
  const turSay = (await db.query(`SELECT coalesce(m.marka, y.marka_diger, 'Belirtilmemiş') marka, coalesce(m.model, y.model_diger, '') model, coalesce(d.hizmet_turu, '—') tur, coalesce(d.ana_teknik_brans, '—') brans, count(*)::int n FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref WHERE d.acilis_tarihi < $1 GROUP BY 1, 2, 3, 4`, [son])).rows;
  const markaModel = mm.map((x) => ({ marka: x.marka, model: x.model, dosya: x.dosya, diger: x.diger, onayBekliyor: x.diger && x.diger_onay_durumu !== 'Onaylandı',
    hizmetTurleri: turSay.filter((t) => t.marka === x.marka && t.model === x.model).reduce<Record<string, number>>((a, t) => ({ ...a, [t.tur]: (a[t.tur] ?? 0) + t.n }), {}),
    branslar: turSay.filter((t) => t.marka === x.marka && t.model === x.model).reduce<Record<string, number>>((a, t) => ({ ...a, [t.brans]: (a[t.brans] ?? 0) + t.n }), {}) }));
  return { donem, yogunlasma, kayip, kademe, teklif, mali, markaModel: { onayli: markaModel.filter((x) => !x.onayBekliyor), onayBekleyen: markaModel.filter((x) => x.onayBekliyor) } };
}

/** YG-808: kapanan dosyaların %10'u (en az 1) iç denetim örneklemine rastgele seçilir. */
export async function orneklemSec(db: Pool, donem: string): Promise<number> {
  if (!(await birKez(db, 'ic-denetim-orneklem', donem))) return 0;
  const l = (await db.query(`SELECT kimlik, dosya_no FROM dosya WHERE statu = 'Kapalı' AND kapanis_zamani >= $1 AND kapanis_zamani < $2 ORDER BY random()`, [ayBas(donem), ayBas(donem, 1)])).rows;
  if (!l.length) return 0;
  const sec = l.slice(0, Math.max(1, Math.ceil(l.length * ESIK.orneklem)));
  for (const d of sec) await db.query(`INSERT INTO ic_denetim_orneklemi (donem, dosya_ref, havuz) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [donem, d.kimlik, l.length]);
  await kartAc(db, { tur: 'İç Denetim Örneklemi', kategori: 'gorev', baslik: `${donem} · İç Denetim Örneklemi (${sec.length}/${l.length} dosya)`, ozet: sec.map((d) => d.dosya_no).join(', '), sahipRol: await rolId(db, 'İç Denetim Müdürü'), nesneTuru: 'Örneklem', nesneKimligi: donem });
  return sec.length;
}

/** Aylık: örneklem, kademe atlama raporu, dönüşüm ve yoğunlaşma uyarıları. Günlük: mali kapanış 15 iş günü uyarısı. */
export async function yonetimEkIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const donem = new Date(Date.UTC(simdi.getFullYear(), simdi.getMonth() - 1, 1)).toISOString().slice(0, 7);
  n += await orneklemSec(db, donem);
  if (await birKez(db, 'yonetim-ek', donem)) {
    const r = await yonetimEkleri(db, donem);
    await bildir(db, { olay: `kademe-atlama:${donem}`, kullanicilar: await kisiler(db, ['Genel Müdür Yardımcısı', 'CEO']), baslik: `${donem} · Kademe Atlama Raporu: ${r.kademe.length} kayıt`, ozet: r.kademe.slice(0, 5).map((k) => `${k.baslik} (${k.yapan})`).join('; ') || 'Dönemde kademe atlaması yok.' }, simdi);
    if (r.teklif.uyari) await bildir(db, { olay: `donusum:${donem}`, kullanicilar: await kisiler(db, ['Ticari İşler Direktörü', 'Genel Müdür Yardımcısı']), baslik: `Teklif Dönüşümü Erken Uyarı: üç aylık ortalama %${r.teklif.ucAylik}`, ozet: `Hedef en az %${ESIK.donusumHedef}; uyarı eşiği %${ESIK.donusumUyari}.`, oncelik: 'Yüksek' }, simdi);
    if (r.yogunlasma.uyari.length) await bildir(db, { olay: `yogunlasma:${donem}`, kullanicilar: await kisiler(db, ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü']), baslik: 'Müşteri Yoğunlaşması Uyarısı', ozet: r.yogunlasma.uyari.join('; ') }, simdi);
    n++;
  }
  for (const x of (await maliKapanis(db, '1900-01-01', '1900-01-01', simdi)).filter((x) => x.acik && x.isGunu > ESIK.maliUyari)) {
    if (!(await birKez(db, 'mali-kapanis-15', x.kimlik))) continue;
    await bildir(db, { olay: `mali-kapanis:${x.kimlik}`, kullanicilar: await kisiler(db, ['Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü']), baslik: `${x.dosyaNo} · Mali Kapanış ${ESIK.maliUyari} İş Gününü Aştı`, ozet: `Teknik kapanıştan bu yana ${x.isGunu} iş günü.`, oncelik: 'Yüksek' }, simdi); n++;
  }
  return n;
}

export function yonetimEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, l: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, l])).rowCount);
  const donemAl = (q: unknown) => { const d = (q as { donem?: string })?.donem; const n = new Date(); return d && /^\d{4}-(0[1-9]|1[0-2])$/.test(d) ? d : new Date(Date.UTC(n.getFullYear(), n.getMonth() - 1, 1)).toISOString().slice(0, 7); };
  s.get('/yonetim-ekleri', oturumlu, async (i, y) => (await rolde(i.oturum!.kullanici, GORUR)) ? raporCalistir(b.db, 'RP-YON-EK', { donem: donemAl(i.query) }, () => yonetimEkleri(b.db, donemAl(i.query))) : yok(y));
  s.get('/ic-denetim/orneklem', oturumlu, async (i, y) => {
    if (!(await rolde(i.oturum!.kullanici, DENETIM))) return yok(y);
    return (await b.db.query(`SELECT o.donem, d.kimlik, d.dosya_no, o.havuz, d.kapanis_zamani FROM ic_denetim_orneklemi o JOIN dosya d ON d.kimlik = o.dosya_ref ORDER BY o.donem DESC, d.dosya_no LIMIT 300`)).rows;
  });
}
