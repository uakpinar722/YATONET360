import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { birKez, bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';
import { izinGerekli } from './yetki.js';

type Db = Pool | PoolClient;
type P = Record<string, number>;
const R2 = (x: number) => Math.round(x * 100) / 100;
const sinirla = (x: number) => Math.max(0, Math.min(100, x));
const SIRA: Record<string, string> = { Kritik: 'kritik', Yüksek: 'yuksek', Normal: 'normal', Planlı: 'planli' };

export interface Girdi {
  oncelik: string; kabul: string | null; ilkSeferdeKabul: boolean; majoer: number; minoer: number; basarisizTest: number; garanti: number;
  planlananGun: number | null; firmaGecikmeGun: number; teshisiBelirsiz: boolean;
  butce: number | null; ekIs: number; fatura: number | null; onaysizEkIs: boolean;
  yanitUyum: number | null; raporZamaninda: number | null; oncedenBildirim: number | null;
  isg: number; prosedur: number; denetimMajoer: number; denetimMinoer: number; eksikBelge: number; emniyetOlayi: boolean;
}

/** YG-789, Ek I §7.5: beş boyut kayıtlardan 0–100; ölçülemeyen boyut sıfır sayılmaz (YG-743), ağırlığı ölçülenlere dağılır. */
export function dosyaPuani(g: Girdi, p: P) {
  const bas = g.kabul === 'Kabul' ? p.kabul! : g.kabul === 'Koşullu Kabul' ? p.kosullu_kabul! : g.kabul === 'Ret' ? p.ret! : null;
  const kalite = bas === null ? null : sinirla(bas - (g.ilkSeferdeKabul ? 0 : p.ilk_sefer!) - g.majoer * p.majoer! - g.minoer * p.minoer! - g.basarisizTest * p.basarisiz_test! - g.garanti * p.garanti!);
  let sure: number | null = null;
  if (g.planlananGun && g.planlananGun > 0) {
    const oran = (g.firmaGecikmeGun / g.planlananGun) * 100;
    const tol = (p[`tol_${SIRA[g.oncelik] ?? 'normal'}`] ?? 0) + (g.teshisiBelirsiz ? p.tol_belirsiz! : 0);
    sure = sinirla(100 - Math.max(0, oran - tol) * p.sure_asim!);
  }
  let maliyet: number | null = null;
  if (g.onaysizEkIs) maliyet = 0;
  else if (g.butce && g.butce > 0 && g.fatura !== null) {
    const sapma = ((g.fatura - g.butce - g.ekIs) / g.butce) * 100;
    const m1 = p.maliyet_1!; const m2 = p.maliyet_2!; const mp = p.maliyet_1_puan!;
    maliyet = sapma <= 0 ? 100 : sapma <= m1 ? 100 - (sapma / m1) * (100 - mp) : sapma <= m2 ? mp - ((sapma - m1) / (m2 - m1)) * mp : 0;
  }
  const ile: [number | null, number][] = [[g.yanitUyum, 50], [g.raporZamaninda, 30], [g.oncedenBildirim, 20]];
  const olc = ile.filter(([v]) => v !== null) as [number, number][];
  const iletisim = olc.length ? olc.reduce((a, [v, w]) => a + v * w, 0) / olc.reduce((a, [, w]) => a + w, 0) : null;
  const uyum = g.emniyetOlayi ? 0 : sinirla(100 - g.isg * p.isg! - g.prosedur * p.prosedur! - g.denetimMajoer * p.denetim_majoer! - g.denetimMinoer * p.denetim_minoer! - g.eksikBelge * p.eksik_belge!);
  const parcalar: [number | null, number][] = [[kalite, 0.35], [uyum, 0.2], [sure, 0.2], [maliyet, 0.15], [iletisim, 0.1]];
  const olculen = parcalar.filter(([v]) => v !== null) as [number, number][];
  const toplam = olculen.reduce((a, [, w]) => a + w, 0);
  const dosya = olculen.reduce((a, [v, w]) => a + v * w, 0) / toplam;
  const y = (x: number | null) => (x === null ? null : R2(x));
  return { kalite: y(kalite), sure: y(sure), maliyet: y(maliyet), iletisim: y(iletisim), uyum: y(uyum), dosya: R2(dosya) };
}

/** YG-794: öneri; açık Emniyet işaretli uygunsuzluk varken Tercihli önerilmez. Yetersiz veride Standart. */
export function riskOnerisi(puan: number | null, acikEmniyet: boolean, p: P): string {
  if (puan === null) return 'Standart';
  const o = puan >= p.esik_tercihli! ? 'Tercihli' : puan >= p.esik_standart! ? 'Standart' : 'Yakın İzleme';
  return o === 'Tercihli' && acikEmniyet ? 'Standart' : o;
}

const parametre = async (db: Db, surum?: number) => (await db.query(`SELECT surum, deger FROM karne_parametresi WHERE ${surum ? 'surum = $1' : `durum = 'Yürürlükte' AND yururluk_baslangic <= (now() AT TIME ZONE 'Europe/Istanbul')::date ORDER BY surum DESC LIMIT 1`}`, surum ? [surum] : [])).rows[0] as { surum: number; deger: P };

/** Girdiler kayıtlardan toplanır: kabul, uygunsuzluk, test, garanti, zaman, bedel, hakediş. Müşteri, hava, saha ve üretici beklemeleri gecikmeye yazılmaz. */
async function girdiTopla(db: Db, id: string, p: P): Promise<{ g: Girdi; e: Record<string, any> }> {
  const e = (await db.query(`SELECT e.*, d.oncelik, k.kayit_rolu FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref JOIN kurulus k ON k.kimlik = e.kurulus_ref WHERE e.kimlik = $1`, [id])).rows[0];
  const say = async (q: string, ...v: unknown[]) => Number((await db.query(q, v)).rows[0].n);
  const uyg = (sinif: string) => say(`SELECT count(*) n FROM uygunsuzluk WHERE sinif = $1 AND (is_emri_ref = $2 OR (dosya_ref = $3 AND sorumlu_firma_ref = $4))`, sinif, id, e.dosya_ref, e.kurulus_ref);
  const kapanis = e.kapanis_zamani ?? new Date();
  const garanti = await say(`SELECT count(*) n FROM garanti_sikayet WHERE dosya_ref = $1 AND karar = 'Garanti' AND bildirim_zamani <= $2::timestamptz + interval '12 months'`, e.dosya_ref, kapanis);
  const bekleme = async (a: Date, b: Date) => Number((await db.query(`SELECT coalesce(sum(GREATEST(0, EXTRACT(EPOCH FROM (LEAST(coalesce(kaldirilma_zamani, $2), $2) - GREATEST(olusturma_zamani, $1))) / 86400)), 0) n FROM beklemede_isareti WHERE dosya_ref = $3 AND olusturma_zamani < $2`, [a, b, e.dosya_ref])).rows[0].n);
  let planlananGun: number | null = null; let firmaGecikmeGun = 0;
  if (e.baslangic_tarihi && e.hedef_bitis_tarihi) {
    const bas = new Date(e.baslangic_tarihi); const hed = new Date(e.hedef_bitis_tarihi); const bit = e.firma_tamamlama_zamani ? new Date(e.firma_tamamlama_zamani) : kapanis;
    planlananGun = Math.max(0, (hed.getTime() - bas.getTime()) / 86_400_000);
    const gec = (bit.getTime() - hed.getTime() - 86_400_000) / 86_400_000; // hedef günün sonuna kadar gecikme sayılmaz
    if (gec > 0) firmaGecikmeGun = Math.max(0, Math.ceil(gec) - (await bekleme(bas, bit)));
  }
  const hak = (await db.query(`SELECT sum(bu_donem_brut) t FROM hakedis WHERE is_emri_ref = $1 AND statu <> 'Reddedildi'`, [id])).rows[0].t;
  const ek = Number((await db.query(`SELECT coalesce(sum(firma_bedeli_eur), 0) t FROM is_emri WHERE ana_is_emri_ref = $1 AND statu NOT IN ('İptal', 'Yerine Geçti', 'Taslak')`, [id])).rows[0].t);
  const saat = Number(p[`yanit_${SIRA[e.oncelik] ?? 'normal'}`] ?? 24);
  const yanit = e.yayim_zamani && e.firma_kabul_zamani ? ((new Date(e.firma_kabul_zamani).getTime() - new Date(e.yayim_zamani).getTime()) / 3_600_000 <= saat ? 100 : 0) : null;
  const g: Girdi = {
    oncelik: e.oncelik, kabul: e.teknik_kabul_sonucu ?? null, ilkSeferdeKabul: Number(e.teknik_ret_sayisi) === 0, majoer: await uyg('Majör'), minoer: await uyg('Minör'),
    basarisizTest: await say(`SELECT count(*) n FROM test_kaydi WHERE dosya_ref = $1 AND sonuc = 'Başarısız'`, e.dosya_ref), garanti,
    planlananGun, firmaGecikmeGun, teshisiBelirsiz: false,
    butce: e.firma_bedeli_eur === null ? null : Number(e.firma_bedeli_eur), ekIs: ek, fatura: hak === null ? null : Number(hak), onaysizEkIs: false,
    yanitUyum: yanit, raporZamaninda: null, oncedenBildirim: null,
    isg: 0, prosedur: 0, denetimMajoer: 0, denetimMinoer: 0,
    eksikBelge: await say(`SELECT count(*) n FROM sicil_belgesi WHERE kurulus_ref = $1 AND gecerlilik_bitis < $2::timestamptz`, e.kurulus_ref, kapanis),
    emniyetOlayi: (await say(`SELECT count(*) n FROM uygunsuzluk WHERE emniyet_isareti AND (is_emri_ref = $1 OR (dosya_ref = $2 AND sorumlu_firma_ref = $3))`, id, e.dosya_ref, e.kurulus_ref)) > 0,
  };
  return { g, e };
}

/** YG-789, YG-350: her kapanan iş emri için bir kayıt; yalnız Çözüm Ortağı. Yeniden hesapta önceki değer geçmişe yazılır, parametre sürümü değişmez. */
export async function performansOlayIsle(db: Db, isEmri: string, neden?: string): Promise<void> {
  const once = (await db.query(`SELECT * FROM performans_olay_kaydi WHERE is_emri_ref = $1`, [isEmri])).rows[0];
  const pr = await parametre(db, once?.parametre_surum);
  const { g, e } = await girdiTopla(db, isEmri, pr.deger);
  if (e.kayit_rolu !== 'Çözüm Ortağı' || e.statu !== 'Kapalı') return;
  const k = dosyaPuani(g, pr.deger);
  if (once) {
    await db.query(`INSERT INTO performans_olay_gecmisi (olay_ref, onceki, neden) VALUES ($1,$2,$3)`, [once.kimlik, JSON.stringify(once), neden ?? 'Yeniden hesap']);
    await db.query(`UPDATE performans_olay_kaydi SET girdi = $2, kalite_puani = $3, sure_puani = $4, maliyet_puani = $5, iletisim_puani = $6, uyum_puani = $7, dosya_puani = $8, guncelleme_zamani = now() WHERE kimlik = $1`, [once.kimlik, JSON.stringify(g), k.kalite, k.sure, k.maliyet, k.iletisim, k.uyum, k.dosya]);
  } else await db.query(`INSERT INTO performans_olay_kaydi (is_emri_ref, kurulus_ref, dosya_ref, oncelik, parametre_surum, girdi, kalite_puani, sure_puani, maliyet_puani, iletisim_puani, uyum_puani, dosya_puani, kapanis_zamani) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [isEmri, e.kurulus_ref, e.dosya_ref, e.oncelik, pr.surum, JSON.stringify(g), k.kalite, k.sure, k.maliyet, k.iletisim, k.uyum, k.dosya, e.kapanis_zamani ?? new Date()]);
  await donemHesapla(db, e.kurulus_ref);
}

/** YG-352, Ek I §7.5: firma garanti çağrısı kapanıştan sonra gelse de 12 ay içinde kalite puanına işlenir. */
export async function garantiKarneIsle(db: Db, dosya: string): Promise<void> {
  for (const r of (await db.query(`SELECT is_emri_ref FROM performans_olay_kaydi WHERE dosya_ref = $1`, [dosya])).rows) await performansOlayIsle(db, r.is_emri_ref, 'Garanti çağrısı');
}

/** YG-790–794: son 12 ay kayan dönem; kapanmış dosya 3'ten azsa Yetersiz veri. Kesinti kayıt tarihinden 12 ay geçerli. */
export async function donemHesapla(db: Db, kurulus: string, simdi = new Date()): Promise<void> {
  const pr = await parametre(db); const p = pr.deger;
  const y = (await db.query(`SELECT oncelik, dosya_ref, kalite_puani, sure_puani, maliyet_puani, iletisim_puani, uyum_puani, dosya_puani FROM performans_olay_kaydi WHERE kurulus_ref = $1 AND kapanis_zamani > $2::timestamptz - interval '12 months' AND kapanis_zamani <= $2`, [kurulus, simdi])).rows;
  const agr = (o: string) => Number(p[`agirlik_${SIRA[o] ?? 'normal'}`] ?? 1);
  const ort = (a: string) => { const l = y.filter((r) => r[a] !== null); const t = l.reduce((s, r) => s + agr(r.oncelik), 0); return t ? R2(l.reduce((s, r) => s + Number(r[a]) * agr(r.oncelik), 0) / t) : null; };
  const dosyaSay = new Set(y.map((r) => r.dosya_ref)).size;
  const ag = ort('dosya_puani');
  const u = (await db.query(`SELECT count(*) FILTER (WHERE sinif = 'Kritik')::int kritik, count(*) FILTER (WHERE emniyet_isareti)::int emniyet, count(*) FILTER (WHERE emniyet_isareti AND statu NOT IN ('Kapalı', 'Geçersiz'))::int acik FROM uygunsuzluk WHERE sorumlu_firma_ref = $1 AND olusturma_zamani > $2::timestamptz - interval '12 months'`, [kurulus, simdi])).rows[0];
  const kesinti = u.kritik * p.kesinti_kritik! + u.emniyet * p.kesinti_emniyet!;
  const yetersiz = dosyaSay < p.asgari_dosya!;
  const puan = yetersiz || ag === null ? null : Math.max(0, R2(ag - kesinti));
  const son = new Date(simdi.getFullYear(), simdi.getMonth() + 1, 0);
  const sonStr = `${son.getFullYear()}-${String(son.getMonth() + 1).padStart(2, '0')}-${String(son.getDate()).padStart(2, '0')}`;
  await db.query(`INSERT INTO performans_donem_puani (kurulus_ref, donem_sonu, kapanan_dosya_sayisi, agirlikli_ortalama, uygunsuzluk_kesintisi, donem_puani, yetersiz_veri, kalite_ortalamasi, sure_ortalamasi, maliyet_ortalamasi, iletisim_ortalamasi, uyum_ortalamasi, acik_emniyet_uygunsuzlugu, risk_derecesi_onerisi, parametre_surum) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (kurulus_ref, donem_sonu) DO UPDATE SET kapanan_dosya_sayisi = EXCLUDED.kapanan_dosya_sayisi, agirlikli_ortalama = EXCLUDED.agirlikli_ortalama, uygunsuzluk_kesintisi = EXCLUDED.uygunsuzluk_kesintisi, donem_puani = EXCLUDED.donem_puani, yetersiz_veri = EXCLUDED.yetersiz_veri, kalite_ortalamasi = EXCLUDED.kalite_ortalamasi, sure_ortalamasi = EXCLUDED.sure_ortalamasi, maliyet_ortalamasi = EXCLUDED.maliyet_ortalamasi, iletisim_ortalamasi = EXCLUDED.iletisim_ortalamasi, uyum_ortalamasi = EXCLUDED.uyum_ortalamasi, acik_emniyet_uygunsuzlugu = EXCLUDED.acik_emniyet_uygunsuzlugu, risk_derecesi_onerisi = EXCLUDED.risk_derecesi_onerisi, parametre_surum = EXCLUDED.parametre_surum, guncelleme_zamani = now()`,
    [kurulus, sonStr, dosyaSay, ag, kesinti, puan, yetersiz, ort('kalite_puani'), ort('sure_puani'), ort('maliyet_puani'), ort('iletisim_puani'), ort('uyum_puani'), u.acik > 0, riskOnerisi(puan, u.acik > 0, p), pr.surum]);
}

/** YG-790: her ay yeniden hesap. Pasif firmaya yeni dosya düşmediği için pencere uzatılmaz (YG-792). */
export async function karneAylikIsle(db: Pool, simdi = new Date()): Promise<number> {
  const ay = `${simdi.getFullYear()}-${simdi.getMonth() + 1}`;
  if (!(await birKez(db, 'Firma Karnesi Aylık', ay))) return 0;
  const { rows } = await db.query(`SELECT kimlik FROM kurulus WHERE kayit_rolu = 'Çözüm Ortağı' AND ag_statusu <> 'Pasif'`);
  for (const r of rows) await donemHesapla(db, r.kimlik, simdi);
  return rows.length;
}

// K-193: karne itirazı 10 iş günü; kararı Firma Yönetimi Müdürü verir. Kabulde kayıtlardan yeniden hesaplanır, önceki puan silinmez.
kapanisKaydet('Karne İtirazı', async (c, k, karar) => {
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return;
  const t = (await c.query(`SELECT i.*, o.is_emri_ref FROM firma_karne_itirazi i JOIN performans_olay_kaydi o ON o.kimlik = i.olay_ref WHERE i.kimlik = $1 AND i.durum = 'İncelemede'`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  await c.query(`UPDATE firma_karne_itirazi SET durum = $2, karar_zamani = now() WHERE kimlik = $1`, [t.kimlik, karar === 'Onayla' ? 'Kabul Edildi' : 'Reddedildi']);
  if (karar === 'Onayla') await performansOlayIsle(c, t.is_emri_ref, 'Karne itirazı kabul edildi');
  await bildir(c, { olay: `karne-itiraz:${t.kimlik}`, kullanicilar: [t.itiraz_eden_ref], baslik: 'Karne İtirazı', ozet: karar === 'Onayla' ? 'İtirazınız kabul edildi; puan kayıtlardan yeniden hesaplandı.' : 'İtirazınız kabul edilmedi.' });
});

// YG-795: T&O Direktörü önerir, GMY görüşü, CEO onayı; ileriye dönük, ertesi gün yürürlüğe girer.
kapanisKaydet('Karne Parametresi', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') await c.query(`UPDATE karne_parametresi SET durum = 'Yürürlükte', onaylayan_ref = $2, yururluk_baslangic = (now() AT TIME ZONE 'Europe/Istanbul')::date + 1 WHERE surum = $1 AND durum = 'Onayda'`, [Number(k.nesne_kimligi), yapan]);
  else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') await c.query(`UPDATE karne_parametresi SET durum = 'Reddedildi' WHERE surum = $1 AND durum = 'Onayda'`, [Number(k.nesne_kimligi)]);
});

export function karneYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const firmam = async (k: string) => (await b.db.query(`SELECT x.kurulus_ref FROM kurulus_kullanici x JOIN kurulus u ON u.kimlik = x.kurulus_ref WHERE x.kullanici_ref = $1 AND u.kayit_rolu = 'Çözüm Ortağı' LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;
  const sonDonem = async (k: string) => (await b.db.query(`SELECT * FROM performans_donem_puani WHERE kurulus_ref = $1 ORDER BY donem_sonu DESC LIMIT 1`, [k])).rows[0] ?? null;
  const olaylar = async (k: string) => (await b.db.query(`SELECT o.kimlik, e.is_emri_no, o.oncelik, o.kalite_puani, o.sure_puani, o.maliyet_puani, o.iletisim_puani, o.uyum_puani, o.dosya_puani, o.kapanis_zamani, (SELECT i.durum FROM firma_karne_itirazi i WHERE i.olay_ref = o.kimlik ORDER BY i.olusturma_zamani DESC LIMIT 1) AS itiraz FROM performans_olay_kaydi o JOIN is_emri e ON e.kimlik = o.is_emri_ref WHERE o.kurulus_ref = $1 ORDER BY o.kapanis_zamani DESC LIMIT 50`, [k])).rows;

  // YG-351: firma kendi puanını ve boyut dökümünü görür; risk derecesi önerisini görmez.
  s.get('/firma-portal/karne', oturumlu, async (i, y) => {
    const f = await firmam(i.oturum!.kullanici);
    if (!f) return yok(y);
    const d = await sonDonem(f);
    return { donem: d && { donem_sonu: d.donem_sonu, kapanan_dosya_sayisi: d.kapanan_dosya_sayisi, donem_puani: d.donem_puani, yetersiz_veri: d.yetersiz_veri, uygunsuzluk_kesintisi: d.uygunsuzluk_kesintisi, kalite: d.kalite_ortalamasi, sure: d.sure_ortalamasi, maliyet: d.maliyet_ortalamasi, iletisim: d.iletisim_ortalamasi, uyum: d.uyum_ortalamasi }, olaylar: await olaylar(f) };
  });

  // K-193, YG-425: puan itirazı; geçmiş silinmez.
  s.post('/firma-portal/karne/:id/itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const konu = ((i.body ?? {}) as { konu?: string }).konu?.trim();
    const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    const ol = (await b.db.query(`SELECT o.kimlik, e.is_emri_no FROM performans_olay_kaydi o JOIN is_emri e ON e.kimlik = o.is_emri_ref WHERE o.kimlik = $1 AND o.kurulus_ref = $2`, [id, f])).rows[0];
    if (!ol) return yok(y);
    if (!konu) return y.code(400).send({ hata: 'İtiraz konusunu yazmanızı rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM firma_karne_itirazi WHERE olay_ref = $1 AND durum = 'İncelemede'`, [id])).rowCount) return y.code(409).send({ hata: 'Bu puan için incelemede olan itiraz bulunmaktadır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = (await c.query(`INSERT INTO firma_karne_itirazi (olay_ref, kurulus_ref, konu, itiraz_eden_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [id, f, konu, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Karne İtirazı', baslik: `${ol.is_emri_no} · Karne İtirazı`, ozet: konu.slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Firma Yönetimi Müdürü')], sonZaman: await (await import('./teklif.js')).isGunuSonu(c, new Date(), 10), nesneTuru: 'Karne İtirazı', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Karne İtirazı', nesneTuru: 'Performans Kaydı', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
      await c.query('COMMIT');
      return { durum: 'İncelemede' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-794: öneri yalnız yetkili LGM rolüne; nihai risk derecesi Firma Statü Kararı ile verilir.
  s.get('/firma/:id/karne', { preHandler: izinGerekli(b, 'firma.kayit') }, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    return { donem: await sonDonem(id), olaylar: await olaylar(id) };
  });

  const toDirektor = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = 'Teknik ve Operasyon Direktörü' LIMIT 1`, [k])).rowCount);
  s.get('/karne-parametre', oturumlu, async (i, y) => {
    if (!(await toDirektor(i.oturum!.kullanici))) return yok(y);
    return { yururlukte: await parametre(b.db), onayda: (await b.db.query(`SELECT surum, deger FROM karne_parametresi WHERE durum = 'Onayda' ORDER BY surum DESC LIMIT 1`)).rows[0] ?? null };
  });
  s.post('/karne-parametre', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { deger?: Record<string, unknown>; gerekce?: string };
    if (!(await toDirektor(o.kullanici))) return y.code(403).send({ hata: 'Parametre değişikliğini Teknik ve Operasyon Direktörü önerir.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe yazmanızı rica ederiz.' });
    const mevcut = (await parametre(b.db)).deger;
    if (!g.deger || Object.keys(mevcut).some((k) => typeof g.deger![k] !== 'number' || !Number.isFinite(g.deger![k] as number) || (g.deger![k] as number) < 0) || Object.keys(g.deger).some((k) => !(k in mevcut))) return y.code(400).send({ hata: 'Tüm parametreleri sıfır veya üzeri sayı olarak girmenizi rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM karne_parametresi WHERE durum = 'Onayda'`)).rowCount) return y.code(409).send({ hata: 'Onayda bekleyen parametre önerisi bulunmaktadır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const n = Number((await c.query(`SELECT coalesce(max(surum), 0) + 1 n FROM karne_parametresi`)).rows[0].n);
      await c.query(`INSERT INTO karne_parametresi (surum, deger, yururluk_baslangic, durum, gerekce, oneren_ref) VALUES ($1,$2,(now() AT TIME ZONE 'Europe/Istanbul')::date + 1,'Onayda',$3,$4)`, [n, JSON.stringify(g.deger), g.gerekce.trim(), o.kullanici]);
      await kartAc(c, { tur: 'Karne Parametresi', baslik: `Karne Parametresi Sürüm ${n}`, ozet: g.gerekce.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Genel Müdür Yardımcısı'), await rolId(c, 'CEO')], nesneTuru: 'Karne Parametresi', nesneKimligi: String(n) });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Karne Parametresi Önerisi', nesneTuru: 'Karne Parametresi', nesneKimligi: String(n), yeni: g.deger, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { surum: n, durum: 'Onayda' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
