import { ekonomikIzle, ekonomikKilitEngeli, yatDegeriEngeli } from './yat_degeri.js';
import { gonderimIsleyici, sigortayaHazirla } from './sigorta_gonderim.js';
import { ek2Engeli, KURUMSAL_EPOSTA } from './sigorta_ek2.js';
import { raporEngeli } from './rapor.js';
import { belgeUret } from './belge_uret.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi, kapiKaydet, statuYaz } from './dosya.js';
import { dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { doldur, metinGetir, tutar } from './metin.js';
import { kutuAyikla, onaySonucKaydet, onayTalebiAc } from './onay.js';
import { muvafakatKilidi } from './portal.js';
import { altNumara, sureBitir } from './sure.js';
import { UUID } from './yat.js';
import { BILGI_HATA, bilgiBelgesiMi } from './belge_kural.js';
import { sigortaBildirimEngeli, yurtDisiMi } from './onay_ek.js';
import { bildir, birKez, disGonder } from './bildirim.js';

type Db = Pool | PoolClient;
/** İkili kayan nokta hatasından arınmış kuruş yuvarlaması: 56,355 → 56,36 (kartela bandıyla aynı). */
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
export const NITELIK = ['Onarım', 'Yenileme (Değişim)', 'Bakım', 'Keşif ve Test', 'Geçici / Acil Önlem', 'Yat Sahibi Talebi'];
export const BEDEL = ['Malzeme', 'İşçilik', 'Nakliye', 'Masraf', 'Kurtarma', 'Çekme / Refakat', 'Dalgıçlık', 'Ulaşım', 'Konaklama', 'Harcırah', 'Gümrük ve İzin Giderleri'];
const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
/** YG-165: parasal silsile; ara kademeler sırayla geçer, son makam tutara göre belirlenir. */
const ARA = ['Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdür Yardımcısı', 'Muhasebe ve Finans Müdürü'];

/** İş günü ekler; hafta sonu ve resmî tatil sayılmaz. */
export async function isGunuSonu(db: Db, d: Date, gun: number): Promise<Date> {
  // YG-1472: Pazartesi–Cumartesi iş günü; Pazar ve resmî tatil sayılmaz; arife yarım gün sayılır.
  const r = (await db.query(`SELECT to_char(tarih, 'YYYY-MM-DD') t, yarim_gun FROM resmi_tatil`)).rows;
  const tatil = new Set(r.filter((x) => !x.yarim_gun).map((x) => x.t as string)); const arife = new Set(r.filter((x) => x.yarim_gun).map((x) => x.t as string));
  const x = new Date(d.getTime()); let k = 0;
  while (k < gun) { x.setUTCDate(x.getUTCDate() + 1); const y = new Date(x.getTime() + 180 * 60_000); const g = y.getUTCDay(); const t = y.toISOString().slice(0, 10); if (g !== 0 && !tatil.has(t)) k += arife.has(t) ? 0.5 : 1; }
  return x;
}

export const parametre = async (db: Db, kod: string) => Number((await db.query(`SELECT deger FROM sistem_parametresi WHERE kod = $1`, [kod])).rows[0].deger);
export const yururlukSurumu = async (db: Db) => (await db.query(`SELECT surum FROM kartela_surumu ORDER BY durum = 'Yürürlükte' DESC, surum DESC LIMIT 1`)).rows[0]?.surum as string | undefined;

/** YG-173, YG-230: son onay makamı KDV hariç EUR tutara göre; aynı dosyadaki taahhütler toplamıyla (parçalama engeli). */
export async function sonMakam(db: Db, tutarEur: number): Promise<string> {
  if (tutarEur <= await parametre(db, 'limit_tid_eur')) return 'Ticari İşler Direktörü';
  if (tutarEur <= await parametre(db, 'limit_gmy_eur')) return 'Genel Müdür Yardımcısı';
  return 'CEO';
}

/** YG-165, YG-168, YG-176: sahibi olmayan kademe atlanır; son makam boşsa bir üst makam verir (YG-176: ara kademe olmayan dönemde CEO). */
export async function parasalZincir(db: Db, ara: string[], son: string, gorus: string[] = []): Promise<string[]> {
  const sira = ['Ticari İşler Direktörü', 'Genel Müdür Yardımcısı', 'CEO'];
  const dolu = async (r: string) => (await rolSahipleri(db, await rolId(db, r))).length > 0;
  const z: string[] = [];
  for (const r of [...ara, ...gorus]) if (r !== son && await dolu(r)) z.push(await rolId(db, r));
  // YG-176 (KS-8): Ara Kademesiz Dönem açıkken GMY makamına düşen (5.000 EUR üstü) onay doğrudan CEO'ya gider.
  const kademesiz = Number((await db.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'ara_kademesiz_donem'`)).rows[0]?.deger ?? 0) === 1;
  if (son === 'Genel Müdür Yardımcısı' && kademesiz) son = 'CEO';
  let i = sira.indexOf(son); let makam = son;
  while (i >= 0 && i < sira.length - 1 && !(await dolu(makam))) makam = sira[++i]!;
  // YG-165: son makama kadar aradaki üst kademeler sırayla geçer: ticari zincirde Ticari İşler Direktörü, her zincirde GMY (Ara Kademesiz Dönemde geçmez).
  if (!kademesiz && i > 0) {
    const ticari = ara.some((r) => r.startsWith('Muhasebe ve Finans'));
    for (const r of sira.slice(0, i)) { if (r === 'Ticari İşler Direktörü' && !ticari) continue; const id = await rolId(db, r); if (await dolu(r) && !z.includes(id)) z.push(id); }
  }
  z.push(await rolId(db, makam));
  return z;
}

/** YG-173: dosyadaki etkin (reddedilmemiş) tekliflerin KDV hariç toplamı. Ek teklif ve kısmi teklif de eklenir. */
export async function dosyaTaahhudu(db: Db, dosya: string, haric?: string): Promise<number> {
  return Number((await db.query(`SELECT coalesce(sum(onay_limit_tutari_eur), 0) t FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu IN ('İç Onayda', 'Onaylı', 'Gönderildi', 'Karar') AND coalesce(karar, '') NOT IN ('Ret', 'Süresi Doldu', 'Geri Çekildi') AND kimlik IS DISTINCT FROM $2`, [dosya, haric ?? null])).rows[0].t);
}

export interface KalemHesap { birimSatis: number; tutar: number; bantDisi: boolean; bant: { alt: number; ust: number } | null }

/** YG-185, YG-187, YG-232, YG-1709: satış fiyatı firma fiyatından kural ile yazılır, elle değişmez, yuvarlanmaz (2 hane). Bant yalnız kartelalı kalemde. */
/** YG-1707, GMO Y12-02 Madde 3: 50 m altı yatta tutar (L² x B x D)/2 + sabit ile orantılıdır; K, t ve kur kartela tutarının içindedir. Oran, onaylı kartela tutarını referans yatta aynen verir. */
export const GMO_KALEMLERI = ['STABILITE-01.05.01-01', 'YENILEME-01.03.01-01', 'ATIK-01.04.01-02'];
export const gmoCarpan = (l: number, gn: number, d: number, sabit = 10000) => (l * l * gn * d) / 2 + sabit;
export async function gmoMaliyet(db: Db, dosya: string, kartela: number): Promise<number> {
  const y = (await db.query(`SELECT y.tam_boy_m, y.genislik_m, y.derinlik_m FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (!y?.tam_boy_m || !y.genislik_m || !y.derinlik_m) throw Object.assign(new Error('GMO tarifeli kalem için yatın tam boy, kalıp genişliği ve kalıp derinliği bekleniyor.'), { statusCode: 409 });
  if (Number(y.tam_boy_m) >= await parametre(db, 'gmo_azami_boy')) throw Object.assign(new Error('50 m ve üzeri yatta GMO tarifeli kalem hesaplanmaz; fiyat elle değerlendirilir.'), { statusCode: 409 });
  const s = await parametre(db, 'gmo_sabit');
  return R2((kartela * gmoCarpan(Number(y.tam_boy_m), Number(y.genislik_m), Number(y.derinlik_m), s)) / gmoCarpan(await parametre(db, 'gmo_ref_boy'), await parametre(db, 'gmo_ref_genislik'), await parametre(db, 'gmo_ref_derinlik'), s));
}

export function kalemHesapla(firmaBirim: number, miktar: number, katsayi: number, bantOrani: number, kartelaMaliyet: number | null): KalemHesap {
  const birimSatis = R2(firmaBirim * katsayi);
  const bant = kartelaMaliyet === null ? null : { alt: R2(kartelaMaliyet * katsayi * (1 - bantOrani)), ust: R2(kartelaMaliyet * katsayi * (1 + bantOrani)) };
  return { birimSatis, tutar: R2(birimSatis * miktar), bantDisi: bant !== null && (birimSatis < bant.alt || birimSatis > bant.ust), bant };
}

/** YG-234: firma teklifindeki birim maliyet, kartelalı kalemde kartela maliyetinin bant aralığı dışındaysa işaretlenir; kartelasız kalem dışarıda kalır. */
export async function firmaAralikIsaretle(c: Db, teklif: string): Promise<number> {
  const [bant, sur] = [await parametre(c, 'bant_orani'), await yururlukSurumu(c)];
  let n = 0;
  for (const k of (await c.query(`SELECT x.kimlik, x.birim_fiyat_eur, s.kartela_kodu, t.dosya_ref, m.maliyet_eur FROM firma_fiyat_kalemi x JOIN firma_fiyat_teklifi t ON t.kimlik = x.teklif_ref JOIN kapsam_satiri s ON s.kimlik = x.satir_ref LEFT JOIN kartela_kalemi m ON m.kod = s.kartela_kodu AND m.surum = $2 WHERE x.teklif_ref = $1`, [teklif, sur])).rows) {
    let disi = false;
    if (k.maliyet_eur !== null) {
      const mal = GMO_KALEMLERI.includes(k.kartela_kodu) ? await gmoMaliyet(c, k.dosya_ref, Number(k.maliyet_eur)) : Number(k.maliyet_eur);
      const f = Number(k.birim_fiyat_eur); disi = f < R2(mal * (1 - bant)) || f > R2(mal * (1 + bant));
    }
    if (disi) n++;
    await c.query(`UPDATE firma_fiyat_kalemi SET aralik_disi = $2 WHERE kimlik = $1`, [k.kimlik, disi]);
  }
  return n;
}

/** YG-174: onaylanan indirim talebi teklife uygulanır (taslak ve kilitsiz tekliflerde); ret veya iadede talep düşer. */
kapanisKaydet('İndirim Talebi', async (c, k, karar, yapan) => {
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return;
  const t = (await c.query(`SELECT kimlik, statu, indirim_talep_orani, indirim_talep_gerekcesi, kesif_mahsubu_eur, kdv_orani FROM fiyat_teklifi WHERE kimlik = $1::uuid`, [k.nesne_kimligi])).rows[0];
  if (!t?.indirim_talep_orani) return;
  if (karar === 'Onayla' && t.statu === 'Taslak') {
    const kalem = (await c.query(`SELECT tutar_eur, opsiyon FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik])).rows;
    const top = toplamlar(kalem, Number(t.indirim_talep_orani), Number(t.kesif_mahsubu_eur ?? 0), Number(t.kdv_orani));
    await c.query(`UPDATE fiyat_teklifi SET indirim_orani = $2, indirim_gerekcesi = $3, indirim_tutari_eur = $4, kdv_tutari_eur = $5, genel_toplam_eur = $6, onay_limit_tutari_eur = $7, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik, t.indirim_talep_orani, t.indirim_talep_gerekcesi, top.ind, top.kdv, top.genel, top.matrah]);
    await teklifKdvUygula(c, t.kimlik);
    void yapan;
  }
  await c.query(`UPDATE fiyat_teklifi SET indirim_talep_orani = NULL, indirim_talep_gerekcesi = NULL, indirim_talep_eden_ref = NULL WHERE kimlik = $1`, [t.kimlik]);
});

/** YG-190: ara toplam, opsiyon, indirim, KDV ve genel toplam sistemce; KDV indirimli matrahtan. */
/** YG-189: düzeltilen firma fiyatı taslak teklife sistemce yansır; gönderilmiş teklifte yeni sürüm görevi açılır, eski değer kayıtta kalır. */
export async function firmaFiyatYansit(c: Db, firmaKalem: string): Promise<number> {
  const fiyat = Number((await c.query(`SELECT birim_fiyat_eur FROM firma_fiyat_kalemi WHERE kimlik = $1`, [firmaKalem])).rows[0].birim_fiyat_eur);
  const [kat0, bant] = [await parametre(c, 'fiyat_katsayisi'), await parametre(c, 'bant_orani')];
  await firmaAralikIsaretle(c, (await c.query(`SELECT teklif_ref FROM firma_fiyat_kalemi WHERE kimlik = $1`, [firmaKalem])).rows[0].teklif_ref);
  let n = 0;
  for (const f of (await c.query(`SELECT DISTINCT f.kimlik, f.statu, f.teklif_no, f.hazirlayan_ref, f.indirim_orani, f.kesif_mahsubu_eur, f.kdv_orani, f.dosya_ref FROM fiyat_teklifi f JOIN fiyat_teklifi_kalemi k ON k.teklif_ref = f.kimlik WHERE k.firma_kalem_ref = $1 AND f.statu <> 'Yerine Geçti'`, [firmaKalem])).rows) {
    if (f.statu !== 'Taslak') { await kartAc(c, { tur: 'Teklif Revizyonu', kategori: 'islem', baslik: `${f.teklif_no} · Yeni Teklif Sürümü Bekleniyor`, ozet: 'Firma fiyatı düzeltildi; müşteriye gönderilmiş teklifte düzeltme yeni sürümle yapılır.', oncelik: 'Yüksek', sahipKullanici: f.hazirlayan_ref, nesneTuru: 'Teklif', nesneKimligi: f.kimlik }); n++; continue; }
    const kat = kat0 * await (await import('./bolge_katsayisi.js')).bolgeKatsayisi(c, f.dosya_ref); // YG-856
    for (const k of (await c.query(`SELECT x.kimlik, x.miktar, m.maliyet_eur FROM fiyat_teklifi_kalemi x LEFT JOIN kartela_kalemi m ON m.kod = x.kartela_kodu AND m.surum = x.kartela_surumu WHERE x.teklif_ref = $1 AND x.firma_kalem_ref = $2`, [f.kimlik, firmaKalem])).rows) {
      const h = kalemHesapla(fiyat, Number(k.miktar), kat, bant, k.maliyet_eur === null ? null : Number(k.maliyet_eur));
      await c.query(`UPDATE fiyat_teklifi_kalemi SET birim_maliyet_eur = $2, birim_satis_fiyati_eur = $3, tutar_eur = $4, bant_disi = $5, bant_alt_eur = $6, bant_ust_eur = $7 WHERE kimlik = $1`, [k.kimlik, fiyat, h.birimSatis, h.tutar, h.bantDisi, h.bant?.alt ?? null, h.bant?.ust ?? null]); // YG-233
    }
    const top = toplamlar((await c.query(`SELECT tutar_eur, opsiyon FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [f.kimlik])).rows, f.indirim_orani === null ? null : Number(f.indirim_orani), Number(f.kesif_mahsubu_eur ?? 0), Number(f.kdv_orani));
    await c.query(`UPDATE fiyat_teklifi SET ara_toplam_eur = $2, kdv_tutari_eur = $3, genel_toplam_eur = $4, onay_limit_tutari_eur = $5 WHERE kimlik = $1`, [f.kimlik, top.ara, top.kdv, top.genel, top.matrah]);
    await teklifKdvUygula(c, f.kimlik);
    n++;
  }
  return n;
}

/** KDV-1, YG-878: teklifin KDV'si proformayla aynı kuralla: istisnada yalnız parça ve malzeme, tevkifat tahsil edilecekten düşer. */
export async function teklifKdvUygula(c: Db, teklif: string): Promise<number> {
  const f = (await c.query(`SELECT dosya_ref, teklif_muhatabi, ara_toplam_eur, indirim_tutari_eur, kesif_mahsubu_eur, kdv_orani FROM fiyat_teklifi WHERE kimlik = $1`, [teklif])).rows[0];
  const ara = Number(f.ara_toplam_eur); const ind = Number(f.indirim_tutari_eur ?? 0); const matrah = R2(ara - ind - Number(f.kesif_mahsubu_eur ?? 0));
  const malz = Number((await c.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND NOT opsiyon AND bedel_turu = 'Malzeme'`, [teklif])).rows[0].t);
  const malzNet = ara > 0 ? R2(malz - (malz * ind) / ara) : 0;
  const { kdvBelirle, kdvHesapla } = await import('./vergi.js');
  const h = kdvHesapla(matrah, malzNet, Number(f.kdv_orani), await kdvBelirle(c, f.dosya_ref, f.teklif_muhatabi));
  await c.query(`UPDATE fiyat_teklifi SET kdv_tutari_eur = $2, tevkifat_eur = $3, genel_toplam_eur = $4 WHERE kimlik = $1`, [teklif, h.kdv, h.tevkifat, h.toplam]);
  return h.toplam;
}

/** YG-190: yayın öncesi aritmetik kontrol; ilk tutarsızlığı döndürür (kuruş farkı yok sayılmaz). */
export async function aritmetikKontrol(db: Db, teklif: string): Promise<string | null> {
  const f = (await db.query(`SELECT ara_toplam_eur, indirim_tutari_eur, kesif_mahsubu_eur, kdv_tutari_eur, tevkifat_eur, genel_toplam_eur FROM fiyat_teklifi WHERE kimlik = $1`, [teklif])).rows[0];
  if (!f) return 'Teklif bulunamadı.';
  const kl = (await db.query(`SELECT sira_no, miktar, birim_satis_fiyati_eur, tutar_eur, opsiyon FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [teklif])).rows;
  for (const k of kl) if (k.birim_satis_fiyati_eur !== null && R2(Number(k.miktar) * Number(k.birim_satis_fiyati_eur)) !== R2(Number(k.tutar_eur))) return `Aritmetik kontrol: ${k.sira_no}. kalemde miktar × birim fiyat tutara eşit değildir.`;
  const ara = R2(kl.filter((k) => !k.opsiyon).reduce((a, k) => a + Number(k.tutar_eur), 0));
  if (ara !== R2(Number(f.ara_toplam_eur))) return 'Aritmetik kontrol: ara toplam kalemlerin toplamına eşit değildir.';
  const genel = R2(ara - Number(f.indirim_tutari_eur ?? 0) - Number(f.kesif_mahsubu_eur ?? 0) + Number(f.kdv_tutari_eur ?? 0) - Number(f.tevkifat_eur ?? 0));
  if (f.genel_toplam_eur !== null && genel !== R2(Number(f.genel_toplam_eur))) return 'Aritmetik kontrol: genel toplam (ara toplam − indirim − keşif mahsubu + KDV − tevkifat) tutmamaktadır.';
  return null;
}

/** YG-156: teklif cetvele dayanıyorsa cetvel hâlâ dosyanın onaylı (yürürlükteki) sürümü olmalıdır. */
export async function cetvelDegistiEngeli(db: Db, teklif: string): Promise<string | null> {
  const r = (await db.query(`SELECT c.durum, c.surum FROM fiyat_teklifi f JOIN kapsam_cetveli c ON c.kimlik = f.cetvel_ref WHERE f.kimlik = $1`, [teklif])).rows[0];
  return r && r.durum !== 'Onaylı' ? `Teklifin dayandığı kapsam cetveli (Rev.${r.surum}) yeni sürümle değişmiştir; önceki onay geçerli değildir. Teklifi güncel cetvelden revize ediniz.` : null;
}

export function toplamlar(kalemler: { tutar_eur: number | string; opsiyon: boolean }[], indirimOrani: number | null, kesifMahsubu: number, kdvOrani: number) {
  const ara = R2(kalemler.filter((k) => !k.opsiyon).reduce((a, k) => a + Number(k.tutar_eur), 0));
  const ops = R2(kalemler.filter((k) => k.opsiyon).reduce((a, k) => a + Number(k.tutar_eur), 0));
  const ind = R2(ara * (indirimOrani ?? 0) / 100);
  const matrah = R2(ara - ind - kesifMahsubu);
  const kdv = R2(matrah * kdvOrani / 100);
  return { ara, ops, ind, matrah, kdv, genel: R2(matrah + kdv) };
}

/** YG-1703…YG-1706: birlikte yazılmaz gruplarında sarı uyarı; işlem durmaz. */
export async function kartelaUyarilari(db: Db, kodlar: string[]) {
  const { rows } = await db.query(`SELECT grup, kodlar, notu FROM kartela_birlikte_yazilmaz WHERE (SELECT count(*) FROM unnest(kodlar) k WHERE k = ANY($1)) >= 2 ORDER BY grup`, [kodlar]);
  return rows.map((r) => ({ grup: r.grup as string, not: r.notu as string }));
}

// YG-1468: ek olarak geçici yat kaydıyla teklif yayımlanmaz (YG-214). YG-078: en az bir onaylı kapsam gerekir.
kapiKaydet('Onay', async (db, d) => ((await db.query(`SELECT 1 FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu IN ('Gönderildi', 'Karar', 'Onaylı') LIMIT 1`, [d.kimlik])).rowCount ? null : 'Onay aşamasına geçmek için fiyat teklifi iç onaydan geçmelidir.'));

/** YG-1081: taslak kartela sürümü CEO onayıyla yürürlüğe girer; aynı anda tek Yürürlükte sürüm kalır, önceki Arşiv olur. */
kapanisKaydet('Kartela Sürümü', async (c, k, karar) => {
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE kartela_surumu SET durum = 'Arşiv' WHERE durum = 'Yürürlükte'`);
  await c.query(`UPDATE kartela_surumu SET durum = 'Yürürlükte', yururluk = (now() AT TIME ZONE 'Europe/Istanbul')::date WHERE surum = $1 AND durum = 'Taslak'`, [k.nesne_kimligi]);
});

kapanisKaydet('Kapsam Cetveli', async (c, k, karar, yapan) => {
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE kapsam_cetveli SET durum = 'Yerine Geçti' WHERE dosya_ref = (SELECT dosya_ref FROM kapsam_cetveli WHERE kimlik = $1) AND durum = 'Onaylı'`, [k.nesne_kimligi]);
  await c.query(`UPDATE kapsam_cetveli SET durum = 'Onaylı', onaylayan_ref = $2, onay_zamani = now() WHERE kimlik = $1`, [k.nesne_kimligi, yapan]);
  // YG-1599: onaylı cetvelle teklif hazırlığı kendiliğinden başlar (dosyada hazırlanan teklif yoksa); görev dosyanın Ticari Sorumlusuna, yoksa role.
  const d = (await c.query(`SELECT d.kimlik, d.dosya_no, d.ticari_sorumlu_ref, x.surum FROM kapsam_cetveli x JOIN dosya d ON d.kimlik = x.dosya_ref WHERE x.kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (d && !(await c.query(`SELECT 1 FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu IN ('Taslak', 'İç Onayda') LIMIT 1`, [d.kimlik])).rowCount
    && !(await c.query(`SELECT 1 FROM is_karti WHERE tur = 'Fiyat Teklifi Hazırla' AND nesne_kimligi = $1 AND durum = 'Bekliyor' LIMIT 1`, [String(k.nesne_kimligi)])).rowCount) {
    const { kartAc } = await import('./is_motoru.js');
    await kartAc(c, { tur: 'Fiyat Teklifi Hazırla', kategori: 'islem', baslik: `${d.dosya_no} · Fiyat Teklifi Hazırla`, ozet: `Kapsam cetveli Rev.${d.surum} onaylandı.`, ...(d.ticari_sorumlu_ref ? { sahipKullanici: d.ticari_sorumlu_ref } : { sahipRol: await rolId(c, TICARI) }), nesneTuru: 'Kapsam Cetveli', nesneKimligi: String(k.nesne_kimligi) });
  }
});

kapanisKaydet('Fiyat Teklifi', async (c, k, karar, yapan) => {
  const t = (await c.query(`SELECT kimlik, teklif_no, dosya_ref, hazirlayan_ref FROM fiyat_teklifi WHERE kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Onayla') {
    await c.query(`UPDATE fiyat_teklifi SET statu = 'Onaylı', son_onay_makami = (SELECT rol_adi FROM rol WHERE kimlik = (SELECT zincir[cardinality(zincir)] FROM is_karti WHERE tur = 'Fiyat Teklifi' AND nesne_kimligi = $1::text ORDER BY olusturma_zamani DESC LIMIT 1)), guncelleme_zamani = now() WHERE kimlik = $1::uuid`, [t.kimlik]);
    await izYaz(c, { aktor: yapan, eylem: 'Fiyat Teklifi İç Onay', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, sonuc: 'Başarılı' });
    // YG-1601: onay tamamlanınca gönderim Dosya Sorumlusundan; teklif gönderilince görev kapanır (0314).
    const ds = (await c.query(`SELECT d.dosya_sorumlusu_ref, d.dosya_no FROM dosya d WHERE d.kimlik = $1`, [t.dosya_ref])).rows[0];
    if (ds?.dosya_sorumlusu_ref) { const { kartAc } = await import('./is_motoru.js'); await kartAc(c, { tur: 'Müşteriye Gönder', kategori: 'gorev', baslik: `${t.teklif_no} · Müşteriye Gönder`, ozet: `${ds.dosya_no} · Teklif iç onayı tamamlandı; müşteriye gönderiniz.`, sahipKullanici: ds.dosya_sorumlusu_ref, nesneTuru: 'Teklif', nesneKimligi: t.kimlik }); }
  } else if (karar === 'Reddet') await c.query(`UPDATE fiyat_teklifi SET statu = 'Reddedildi', guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
  else if (karar === 'Gerekçeyle İade Et') await c.query(`UPDATE fiyat_teklifi SET statu = 'Taslak', kilitli = false, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
});

/** YG-187: bant dışı kalem TİD'in gerekçeli onayı olmadan gönderilemez. */
kapanisKaydet('Bant Dışı Onayı', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') await c.query(`UPDATE fiyat_teklifi SET bant_disi_onay_ref = $2, bant_disi_gerekce = $3 WHERE kimlik = $1`, [k.nesne_kimligi, yapan, k.ozet]);
});

const SIFIRLA_YAT = (d: { dosya_no: string }) => ({ 'Dosya No': d.dosya_no, 'File No': d.dosya_no });

// YG-466: tek ekranda teklif, ön bilgilendirme ve sözleşme. YG-152, YG-468: cayma süresi; ikinci kutu erken ifa, varsayılanı Hayır.
/** YG-150, K-172: yat sahibi reddi kesindir; dosya Müşteri Vazgeçti nedeniyle kapanışa gider. */
async function vazgecmeGorevi(c: Db, f: { dosya_ref: string; dosya_no: string }) {
  const ds = (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [f.dosya_ref])).rows[0]?.r;
  if (ds) await kartAc(c, { tur: 'Dosya Kapanışı', kategori: 'islem', baslik: `${f.dosya_no} · Müşteri Vazgeçti`, ozet: 'Yat sahibi teklifi reddetti; dosyayı Müşteri Vazgeçti nedeniyle kapatınız.', sahipKullanici: ds, nesneTuru: 'Dosya', nesneKimligi: f.dosya_ref });
}

/** YG-208: kurumsal müşteri teklifi onaylanınca sözleşme kaydı onaylı tekliften kurulur; ayrı ıslak/e-imza aranmaz (yalnız özel hükümde). */
export async function kurumsalSozlesmeKur(c: Db, teklif: string, kanal: string, kaydeden: string): Promise<void> {
  const f = (await c.query(`SELECT f.kimlik, f.teklif_muhatabi, y.yat_sahibi_ref FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE f.kimlik = $1`, [teklif])).rows[0];
  if (!f || f.teklif_muhatabi !== 'Kurumsal Müşteri' || !f.yat_sahibi_ref) return;
  await c.query(`INSERT INTO sozlesme_kaydi (taraf_ref, sozlesme_turu, sozlesme_sahibi_rolu, yururluk, durum, kurumsal_kanal, teklif_ref, kaydeden_ref) VALUES ($1,'Yat Onarım','Operasyon Müdürü',(now() AT TIME ZONE 'Europe/Istanbul')::date,'Yürürlükte',$2,$3,$4) ON CONFLICT (teklif_ref) WHERE teklif_ref IS NOT NULL DO NOTHING`, [f.yat_sahibi_ref, kanal, teklif, kaydeden]);
}

/** ONY-23 kararı; YATONET 360 onayı ve YG-220 ıslak imzalı belge aynı sonucu doğurur. */
async function yatSahibiTeklifKarari(c: Db, teklif: string, onay: boolean, g: { zaman: Date; erken: boolean; gosterim: Date; yapan: string | null; kanal: 'YATONET 360' | 'Islak İmza' }) {
  const ft = (await c.query(`SELECT f.*, d.statu AS d_statu, d.asama, d.dosya_no, d.musteri_turu, d.yazisma_dili FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [teklif])).rows[0];
  if (!onay) { await c.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = 'Ret', karar_zamani = $2 WHERE kimlik = $1`, [ft.kimlik, g.zaman]); await vazgecmeGorevi(c, ft); return; }
  await c.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = 'Tam Onay', karar_zamani = $2 WHERE kimlik = $1`, [ft.kimlik, g.zaman]);
  await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = 'Onaylandı' WHERE teklif_ref = $1 AND NOT opsiyon`, [ft.kimlik]);
  await kurumsalSozlesmeKur(c, ft.kimlik, g.kanal === 'Islak İmza' ? 'Islak İmzalı Teklif' : 'YATONET 360 Onayı', ft.hazirlayan_ref); // YG-208
  if (ft.d_statu === 'Aktif' && ft.asama !== 'Uygulama') await statuYaz(c, { kimlik: ft.dosya_ref, statu: 'Aktif', asama: ft.asama }, { statu: 'Aktif', asama: 'Uygulama' }, g.kanal === 'Islak İmza' ? 'Fiyat teklifi yat sahibince ıslak imzayla onaylandı' : 'Fiyat teklifi yat sahibince onaylandı', g.yapan, 'Operasyon Yöneticisi');
  const gun = await parametre(c, 'cayma_gun');
  const bitis = new Date(g.zaman.getTime() + gun * 86_400_000);
  if (ft.musteri_turu === 'Bireysel Müşteri') await c.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis, erken_ifa_onayi) VALUES ($1,$2,$6,$3,$4,$5) ON CONFLICT (teklif_ref) DO NOTHING`, [ft.kimlik, ft.dosya_ref, g.zaman, bitis, g.erken, g.gosterim]); // YG-467: ön bilgilendirme anı = gösterim anı
}

for (const ony of ['ONY-23', 'ONY-25']) onaySonucKaydet(ony, async (c, t, karar, k) => { // ONY-25: ek teklif aynı sonuçla işlenir
  if (!t.nesne_kimligi) return;
  const erken = Object.entries(k.kutular).some(([ad, v]) => v && /Cayma süresi içinde/i.test(ad));
  await yatSahibiTeklifKarari(c, t.nesne_kimligi, karar === 'Onaylandı', { zaman: k.zaman, erken, gosterim: t.gosterim_zamani ?? k.zaman, yapan: t.alici_kullanici_ref, kanal: 'YATONET 360' });
});

// YG-205, BLD-41: sigortanın onaylamadığı kalemler için yat sahibi onayı.
onaySonucKaydet('ONY-26', async (c, t, karar, k) => {
  if (!t.nesne_kimligi) return;
  if (karar !== 'Onaylandı') await vazgecmeGorevi(c, (await c.query(`SELECT f.dosya_ref, d.dosya_no FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [t.nesne_kimligi])).rows[0]);
  await c.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = $2, karar_zamani = $3 WHERE kimlik = $1`, [t.nesne_kimligi, karar === 'Onaylandı' ? 'Tam Onay' : 'Ret', k.zaman]);
  if (karar === 'Onaylandı') await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = 'Onaylandı' WHERE teklif_ref = $1`, [t.nesne_kimligi]);
});

/** YG-152: cayma süresi içinde erken ifa onayı yoksa iş emri verilemez. Kritik/acil müdahale ayrı onayla işler. */
export async function caymaEngeli(db: Db, dosya: string, simdi = new Date()): Promise<string | null> {
  const r = (await db.query(`SELECT cayma_bitis, erken_ifa_onayi, cayma_zamani FROM on_bilgilendirme_cayma_kaydi WHERE dosya_ref = $1 ORDER BY sozlesme_zamani DESC LIMIT 1`, [dosya])).rows[0];
  if (!r) return null;
  if (r.cayma_zamani) return 'Yat sahibi cayma hakkını kullanmıştır.';
  if (!r.erken_ifa_onayi && new Date(r.cayma_bitis) > simdi) return 'İş emri için yasal bekleme süresinin dolması veya erken başlama onayı bekleniyor.';
  return null;
}

/** YG-151, YG-191: geçerliliği dolan gönderilmiş teklif Süresi Doldu olur; kendiliğinden yenilenmez. BLD-42: 45 gün yanıtsızda bireysel dosya kapanış görevi. */
export async function teklifSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  // YG-151: gönderimden 45 gün geçmiş, yanıt alınamamış (Gönderildi / Süresi Doldu) teklifin dosyası Müşteri Vazgeçti – Yanıt Alınamadı kapanışına gider; daha yeni teklif veya karar varsa gitmez.
  for (const f of (await db.query(`SELECT f.kimlik, f.dosya_ref, d.dosya_no, d.dosya_sorumlusu_ref ds FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref
      WHERE f.statu IN ('Gönderildi', 'Süresi Doldu') AND f.gonderim_zamani <= $1::timestamptz - interval '45 days' AND d.statu NOT IN ('Kapalı', 'Teknik Kapalı') AND d.dosya_sorumlusu_ref IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM fiyat_teklifi x WHERE x.dosya_ref = f.dosya_ref AND x.kimlik <> f.kimlik AND (x.olusturma_zamani > f.gonderim_zamani OR x.statu = 'Karar')) LIMIT 200`, [simdi])).rows) {
    if (await birKez(db, 'teklif-yanitsiz-45', f.kimlik)) await kartAc(db, { tur: 'Dosya Kapanışı', kategori: 'islem', baslik: `${f.dosya_no} · Müşteri Vazgeçti – Yanıt Alınamadı`, ozet: 'Teklife 45 gündür yanıt alınamadı; dosyayı Müşteri Vazgeçti – Yanıt Alınamadı nedeniyle kapatınız. Dosya 90 gün içinde yeniden açılabilir.', sahipKullanici: f.ds, nesneTuru: 'Dosya', nesneKimligi: f.dosya_ref });
  }
  // YG-1540: firma teklifinin bitişine 3 gün veya daha az kaldığında LGM teklifi onaylanmamışsa Ticari Sorumluya bir kez uyarı gider.
  const bugun = `($1::timestamptz AT TIME ZONE 'Europe/Istanbul')::date`;
  for (const f of (await db.query(`SELECT f.kimlik, f.teklif_no, to_char(f.gecerlilik, 'DD.MM.YYYY') bitis, d.dosya_no, d.ticari_sorumlu_ref FROM firma_fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref
      WHERE f.durum IN ('Gönderildi', 'Seçildi') AND f.gecerlilik BETWEEN ${bugun} AND ${bugun} + 3 AND d.ticari_sorumlu_ref IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM fiyat_teklifi t WHERE t.dosya_ref = f.dosya_ref AND t.statu IN ('Onaylı', 'Gönderildi', 'Karar')) LIMIT 200`, [simdi])).rows) {
    if (await birKez(db, 'firma-teklif-sure', f.kimlik)) await bildir(db, { olay: `firma-teklif-sure:${f.kimlik}`, kullanicilar: [f.ticari_sorumlu_ref], baslik: `Firma Teklifi Süresi Doluyor: ${f.teklif_no}`, ozet: `${f.dosya_no} · Firma teklifi ${f.bitis} tarihinde sona erer; LGM Fiyat Teklifi henüz onaylanmadı.` }, simdi);
  }
  // YG-1540: LGM teklifine seçilmemiş firma teklifi süresi geçince düşer; seçilen teklif iş emri / sipariş yayımlanıncaya kadar bağlayıcıdır.
  await db.query(`UPDATE firma_fiyat_teklifi SET durum = 'Süresi Doldu' WHERE durum = 'Gönderildi' AND gecerlilik < ${bugun}`, [simdi]);
  // YG-212, BLD-51: yat sahibine geçerlilik dolmadan 24 saat önce tek hatırlatma. Sigortaya hatırlatma BLD-72 ile ayrıdır.
  const yak = (await db.query(`SELECT f.kimlik, f.teklif_turu, f.gecerlilik_bitis_tarihi::text b, d.dosya_no, d.yazisma_dili, t.telefon, t.eposta FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE f.statu = 'Gönderildi' AND NOT f.gecerlilik_hatirlatma AND f.teklif_muhatabi <> 'Sigorta Şirketi' AND NOT d.vefat_isareti AND f.gecerlilik_bitis_tarihi = ($1::timestamptz AT TIME ZONE 'Europe/Istanbul')::date`, [simdi])).rows;
  for (const h of yak) {
    const bitis = `${h.b.split('-').reverse().join('.')} 23:59`; const dil = dilKod(h.yazisma_dili);
    await yatTarafinaYaz(db, { olay: `bld51:${h.kimlik}`, kod: 'BLD-51', dil, konu: `${h.dosya_no} Teklif Hatırlatması`, telefon: h.telefon, eposta: h.eposta, alanlar: { 'Dosya No': h.dosya_no, 'File No': h.dosya_no, 'Fiyat Teklifi / Ek Fiyat Teklifi': h.teklif_turu, 'Price Quotation / Additional Price Quotation': h.teklif_turu, 'tarih saat': bitis, 'date time': bitis, 'bağlantı': webAdresiTeklif, link: webAdresiTeklif } });
    await db.query(`UPDATE fiyat_teklifi SET gecerlilik_hatirlatma = true WHERE kimlik = $1`, [h.kimlik]);
  }
  const { rows } = await db.query(`UPDATE fiyat_teklifi SET statu = 'Süresi Doldu', karar = 'Süresi Doldu', karar_zamani = $1 WHERE statu = 'Gönderildi' AND gecerlilik_bitis_tarihi < ($1::timestamptz AT TIME ZONE 'Europe/Istanbul')::date RETURNING kimlik, dosya_ref, teklif_no, teklif_turu, teklif_muhatabi, hazirlayan_ref`, [simdi]);
  for (const t of rows) {
    await bildir(db, { olay: `teklif-sure:${t.kimlik}`, kullanicilar: [t.hazirlayan_ref], baslik: `Teklif Süresi Doldu: ${t.teklif_no}`, eposta: true }, simdi);
    if (t.teklif_turu !== 'Ek Fiyat Teklifi') continue;
    // YG-212, BLD-52: yanıtsız ek teklif düşer, Açık İş ve kısa bildirim oluşur.
    const d = (await db.query(`SELECT dosya_no, yazisma_dili, dosya_sorumlusu_ref, vefat_isareti FROM dosya WHERE kimlik = $1`, [t.dosya_ref])).rows[0];
    await db.query(`INSERT INTO acik_konu (konu_no, dosya_ref, baslik, aciklama, sahip_ref, hedef_tarih, olusturan_ref) VALUES ($1,$2,'Ek İş Yapılmadı',$3,$4,($5::timestamptz AT TIME ZONE 'Europe/Istanbul')::date + 7,$4)`, [await altNumara(db, d.dosya_no, 'AK'), t.dosya_ref, t.teklif_no, d.dosya_sorumlusu_ref, simdi]);
    const sah = t.teklif_muhatabi === 'Sigorta Şirketi' || d.vefat_isareti ? undefined : (await db.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [t.dosya_ref])).rows[0];
    if (sah) await yatTarafinaYaz(db, { olay: `bld52:${t.kimlik}`, kod: 'BLD-52', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Açık İş`, telefon: sah.telefon, eposta: sah.eposta, alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no } });
  }
  return rows.length;
}

const bld71 = (c: Db, t: { dosya_no: string }, sg: { sigorta_hasar_dosya_no?: string | null } | undefined, son: Date) => metinGetir(c, 'BLD-71', 'tr', { 'Dosya No': t.dosya_no, 'Hasar Dosya No': sg?.sigorta_hasar_dosya_no ?? '', 'Teknik Raporu ve Fiyat Teklifi': 'Fiyat Teklifi', 'son tarih': son.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }) });
let webAdresiTeklif = '';
// K-241: ikinci teyitte teklif gönderilir, sigorta karar süresi (YG-444) ve geçerlilik başlar; yat sahibine BLD-37 eş zamanlı (YG-191).
gonderimIsleyici('Yeniden Değerlendirme', async (c, r) => {
  const y = (await c.query(`UPDATE yeniden_degerlendirme SET durum = 'Gönderildi', gonderim_zamani = now() WHERE kimlik = $1 RETURNING talep_eden_ref, dosya_ref`, [r.nesne_kimligi])).rows[0];
  const son = await isGunuSonu(c, new Date(), await parametre(c, 'sigorta_karar_is_gunu'));
  await kartAc(c, { tur: 'Yeniden Değerlendirme Yanıtı', kategori: 'gorev', baslik: r.konu, ozet: 'Sigorta şirketinin yazılı yanıtı bekleniyor.', sahipKullanici: y.talep_eden_ref, sonZaman: son, nesneTuru: 'Yeniden Değerlendirme', nesneKimligi: r.nesne_kimligi });
  return { metin: r.metin ?? undefined };
});

gonderimIsleyici('Fiyat Teklifi', async (c, r) => {
  const t = (await c.query(`SELECT f.kimlik, f.statu, f.dosya_ref, d.dosya_no, d.yazisma_dili FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1 FOR UPDATE OF f`, [r.nesne_kimligi])).rows[0];
  if (t.statu !== 'Onaylı') throw Object.assign(new Error('Teklif gönderilebilir durumda değildir.'), { statusCode: 409 });
  const son = await isGunuSonu(c, new Date(), await parametre(c, 'sigorta_karar_is_gunu'));
  const bit = (await c.query(`UPDATE fiyat_teklifi SET statu = 'Gönderildi', gonderim_zamani = now(), sigorta_karar_son = $3, gecerlilik_bitis_tarihi = (now() AT TIME ZONE 'Europe/Istanbul')::date + $2::int, guncelleme_zamani = now() WHERE kimlik = $1 RETURNING gecerlilik_bitis_tarihi::text b`, [t.kimlik, await parametre(c, 'teklif_gecerlilik_gun'), son])).rows[0].b;
  await sureBitir(c, { tur: 'Teklif', dosya: t.dosya_ref }); // YG-199 await sureBitir(c, { tur: 'Keşiften Teklife', dosya: t.dosya_ref }); // YG-043
  const sg = (await c.query(`SELECT sigorta_hasar_dosya_no FROM dosya_sigorta_kaydi WHERE dosya_ref = $1`, [t.dosya_ref])).rows[0];
  const sahip = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [t.dosya_ref])).rows[0];
  if (sahip) await yatTarafinaYaz(c, { olay: `bld37:${t.kimlik}`, kod: 'BLD-37', dil: dilKod(t.yazisma_dili), konu: `${t.dosya_no} Bilgilendirme`, telefon: sahip.telefon, eposta: sahip.eposta, alanlar: { ...SIFIRLA_YAT(t), 'bağlantı': webAdresiTeklif, link: webAdresiTeklif } });
  // BLD-71 PDF ekiyle gider (varsa onaylı Teknik Rapor da); ikili teyit geçilmiştir (K-241).
  const metin = await bld71(c, t, sg, son);
  if (r.alici) await belgeUret(c, { tur: 'Fiyat Teklifi', nesne: t.kimlik, dosya: t.dosya_ref, gonder: { olay: `sigorta:${r.kimlik}`, eposta: r.alici, konu: r.konu, metin, acil: true, sigortaTeyitli: true, ekle: ['Teknik Rapor'] } });
  else await belgeUret(c, { tur: 'Fiyat Teklifi', nesne: t.kimlik, dosya: t.dosya_ref });
  return { metin, ekli: true, sonuc: { gecerlilik: bit } };
});

export function teklifYollari(s: FastifyInstance, b: Baglam) {
  webAdresiTeklif = b.webAdresi;
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const dosyam = async (id: string, k: string) => (UUID.test(id) && await dosyaErisimi(b.db, k, id) ? (await b.db.query(`SELECT * FROM dosya WHERE kimlik = $1`, [id])).rows[0] : undefined);
  const roller = async (k: string) => (await b.db.query(`SELECT r.rol_adi FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);

  // YG-293: arama; firma portalı fiyatsız kullanır, LGM de satış fiyatını buradan görmez.
  s.post('/kartela/es-anlam', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await roller(o.kullanici)).some((r) => ['Teknik Müdür', 'Teknik ve Operasyon Direktörü', 'Ticari İşler Direktörü', 'Teknik Yönetici'].includes(r))) return y.code(403).send({ hata: 'Eş anlamlıyı Teknik Müdürlük veya Ticari İşler ekler.' });
    const g = (i.body ?? {}) as { terim?: string; karsilik?: string };
    if (!g.terim?.trim() || !g.karsilik?.trim() || g.terim.trim().toLocaleLowerCase('tr') === g.karsilik.trim().toLocaleLowerCase('tr')) return y.code(400).send({ hata: 'Terim ve farklı bir karşılık giriniz.' });
    await b.db.query(`INSERT INTO islem_es_anlami (terim, karsilik, ekleyen_ref) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [g.terim.trim().toLocaleLowerCase('tr'), g.karsilik.trim().toLocaleLowerCase('tr'), o.kullanici]);
    return { tamam: true };
  });
  // YG-1257 (KS-2): ortak ölçü birimi listesi (kartela, metraj, Fiyat Teklifi).
  s.get('/olcu-birimleri', { preHandler: tamOturumGerekli(b) }, async (i, y) => i.oturum!.grup !== 'LGM İç Rolü' ? y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' }) : (await b.db.query(`SELECT deger, aciklama FROM deger_listesi WHERE liste_kodu = 'LST_OLCU_BIRIMI' ORDER BY sira, deger`)).rows);
  s.get('/kartela/ara', oturumlu, async (i) => {
    const q = String((i.query as { q?: string }).q ?? '').trim();
    if (q.length < 2) return [];
    const sur = await yururlukSurumu(b.db);
    // YG-1371: ana/alt branş kutuları isteğe bağlı süzgeçtir.
    const { ana, alt } = i.query as { ana?: string; alt?: string };
    // YG-1372: eş anlamlı terimler her iki yönde aranır; kullanıcının tekliflerinde sık seçtiği işlemler önce gelir.
    const terimler = [q, ...(await b.db.query(`SELECT karsilik t FROM islem_es_anlami WHERE tr_norm(terim) = tr_norm($1) UNION SELECT terim FROM islem_es_anlami WHERE tr_norm(karsilik) = tr_norm($1)
      UNION SELECT karsilik FROM islem_es_anlami WHERE tr_norm($1) LIKE '%' || tr_norm(terim) || '%' UNION SELECT terim FROM islem_es_anlami WHERE tr_norm($1) LIKE '%' || tr_norm(karsilik) || '%'`, [q])).rows.map((r) => r.t as string)];
    return (await b.db.query(`SELECT k.kod, k.ana_brans, k.alt_brans, k.tali_brans, k.islem, k.birim, coalesce(s.n, 0)::int sik FROM kartela_kalemi k
        LEFT JOIN (SELECT x.kartela_kodu, count(*) n FROM fiyat_teklifi_kalemi x JOIN fiyat_teklifi f ON f.kimlik = x.teklif_ref WHERE f.hazirlayan_ref = $3 AND x.kartela_kodu IS NOT NULL GROUP BY 1) s ON s.kartela_kodu = k.kod
      WHERE k.surum = $1 AND (k.kod ILIKE $2 || '%' OR EXISTS (SELECT 1 FROM unnest($4::text[]) t WHERE tr_norm(k.islem) LIKE '%' || tr_norm(t) || '%'))
        AND ($6::text IS NULL OR k.ana_brans = $6) AND ($7::text IS NULL OR k.alt_brans = $7)
      ORDER BY coalesce(s.n, 0) DESC, k.kod LIMIT $5`, [sur, q, i.oturum!.kullanici, terimler, await parametre(b.db, 'arama_oneri_azami'), ana?.trim() || null, alt?.trim() || null])).rows; // PRM-1: öneri en çok 10
  });
  s.get('/kartela/branslar', oturumlu, async (i, y) => i.oturum!.grup !== 'LGM İç Rolü' ? y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' }) : (await b.db.query(`SELECT DISTINCT ana_brans, alt_brans FROM kartela_kalemi WHERE surum = $1 ORDER BY 1, 2`, [await yururlukSurumu(b.db)])).rows);

  // YG-1081, YG-859: kartela maliyeti yalnız Ticari İşler Direktörü ve CEO tarafından görülür ve taslak sürümde girilir.
  const kartelaYetkili = async (k: string) => (await roller(k)).some((r) => ['Ticari İşler Direktörü', 'CEO'].includes(r));
  const taslak = async () => (await b.db.query(`SELECT surum FROM kartela_surumu WHERE durum = 'Taslak' ORDER BY surum DESC LIMIT 1`)).rows[0]?.surum as string | undefined;
  s.get('/kartela/maliyet', oturumlu, async (i, y) => {
    if (!(await kartelaYetkili(i.oturum!.kullanici))) return yok(y);
    const q = String((i.query as { q?: string }).q ?? '').trim(); const sur = (await taslak()) ?? await yururlukSurumu(b.db);
    return { surum: sur, taslak: Boolean(await taslak()), kalemler: (await b.db.query(`SELECT kod, islem, birim, maliyet_eur, maliyet_tarihi::text, kaynak_norm FROM kartela_kalemi WHERE surum = $1 AND ($2 = '' OR kod ILIKE $2 || '%' OR tr_norm(islem) LIKE '%' || tr_norm($2) || '%') ORDER BY kod LIMIT 50`, [sur, q])).rows };
  });
  s.post('/kartela/taslak', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (!(await kartelaYetkili(o.kullanici))) return yok(y);
    if (await taslak()) return y.code(409).send({ hata: 'Açık taslak sürüm vardır.' });
    const kaynak = await yururlukSurumu(b.db); if (!kaynak) return y.code(409).send({ hata: 'Yürürlükte kartela sürümü yoktur.' });
    const yil = new Date().getFullYear(); const n = Number((await b.db.query(`SELECT coalesce(max(split_part(surum, '.', 2)::int), 0) n FROM kartela_surumu WHERE surum ~ ('^' || $1 || '[.][0-9]+$')`, [String(yil)])).rows[0].n) + 1;
    const sur = `${yil}.${n}`;
    return islem(async (c) => {
      await c.query(`INSERT INTO kartela_surumu (surum, durum, hazirlayan_ref) VALUES ($1,'Taslak',$2)`, [sur, o.kullanici]);
      await c.query(`INSERT INTO kartela_kalemi (kod, surum, ana_brans, alt_brans, tali_brans, islem, birim, maliyet_eur, maliyet_tarihi, kaynak_norm, resmi_onay_gerekebilir, iscilik_normu_saat, fire_orani, norm_kaynagi) SELECT kod, $1, ana_brans, alt_brans, tali_brans, islem, birim, maliyet_eur, maliyet_tarihi, kaynak_norm, resmi_onay_gerekebilir, iscilik_normu_saat, fire_orani, norm_kaynagi FROM kartela_kalemi WHERE surum = $2`, [sur, kaynak]);
      await kartelaOnerileriniIsle(c, sur); // YG-856
      return { surum: sur };
    });
  });
  // YG-856: fiyat güncellemesini Tedarik veya Teknik birim önerir (mevcut maliyet gösterilmez, YG-1081); Ticari İşler Direktörü onaylar.
  s.post('/kartela/fiyat-onerisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kod?: string; maliyet?: number; tarih?: string; kaynak?: string; gerekce?: string };
    if (!(await roller(o.kullanici)).some((r) => ['Tedarik Yönetimi Müdürü', 'Tedarik Müdür Yardımcısı', 'Tedarik Yöneticisi', 'Tedarik Sorumlusu', 'Teknik Müdür', 'Teknik Müdür Yardımcısı', 'Teknik Yönetici', 'Teknik Uzman'].includes(r))) return y.code(403).send({ hata: 'Kartela fiyat güncellemesini Tedarik veya Teknik birim önerir.' });
    if (!g.kod || !(Number(g.maliyet) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih ?? '') || !g.kaynak?.trim() || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Kalem kodu, pozitif maliyet, maliyet tarihi, kaynak ve gerekçe zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [g.kod, await yururlukSurumu(b.db)])).rowCount) return y.code(404).send({ hata: 'Kalem yürürlükteki kartelada bulunamadı.' });
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO kartela_fiyat_onerisi (kod, maliyet_eur, maliyet_tarihi, kaynak, gerekce, oneren_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [g.kod, Number(g.maliyet), g.tarih, g.kaynak!.trim(), g.gerekce!.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Kartela Fiyat Önerisi', baslik: `Kartela Fiyat Önerisi · ${g.kod}`, ozet: `${g.gerekce!.trim()} · Kaynak: ${g.kaynak!.trim()}`, hazirlayan: o.kullanici, zincir: [await rolId(c, 'Ticari İşler Direktörü')], nesneTuru: 'Kartela Fiyat Önerisi', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, durum: 'Onayda' };
    });
  });

  s.post('/kartela/taslak/maliyet', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kod?: string; maliyet?: number; tarih?: string; kaynak?: string };
    if (!(await kartelaYetkili(o.kullanici))) return yok(y);
    const sur = await taslak(); if (!sur) return y.code(409).send({ hata: 'Önce taslak sürüm açınız.' });
    if (!g.kod || !(Number(g.maliyet) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih ?? '') || !g.kaynak?.trim()) return y.code(400).send({ hata: 'Pozitif maliyet, maliyet tarihi ve kaynak norm zorunludur.' });
    const r = await b.db.query(`UPDATE kartela_kalemi SET maliyet_eur = $3, maliyet_tarihi = $4, kaynak_norm = $5 WHERE kod = $1 AND surum = $2 RETURNING kod`, [g.kod, sur, Number(g.maliyet), g.tarih, g.kaynak.trim()]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Kalem taslak sürümde bulunamadı.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kartela Maliyeti', nesneTuru: 'Kartela', nesneKimligi: `${g.kod}@${sur}`, yeni: { maliyet: Number(g.maliyet), tarih: g.tarih, kaynak: g.kaynak.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // YG-856: Excel'den toplu güncelleme; sütunlar Kod, Maliyet (EUR), Maliyet Tarihi, Kaynak Norm. Hatalı satır varsa hiçbiri işlenmez.
  s.post('/kartela/taslak/maliyet-toplu', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { metin?: string };
    if (!(await kartelaYetkili(o.kullanici))) return yok(y);
    const sur = await taslak(); if (!sur) return y.code(409).send({ hata: 'Önce taslak sürüm açınız.' });
    const satirlar = String(g.metin ?? '').split(/\r?\n/).map((l, n) => ({ n: n + 1, h: l.split('\t').map((x) => x.trim()) })).filter((x) => x.h.some(Boolean) && !/^kod$/i.test(x.h[0] ?? ''));
    if (!satirlar.length) return y.code(400).send({ hata: 'Excel\'den Kod, Maliyet, Maliyet Tarihi ve Kaynak Norm sütunlarını yapıştırınız.' });
    if (satirlar.length > 2000) return y.code(400).send({ hata: 'Bir seferde en çok 2.000 satır işlenir.' });
    const mevcut = new Set((await b.db.query(`SELECT kod FROM kartela_kalemi WHERE surum = $1 AND kod = ANY($2)`, [sur, satirlar.map((x) => x.h[0])])).rows.map((r) => r.kod as string));
    const hatalar: string[] = []; const kayit: { kod: string; maliyet: number; tarih: string; kaynak: string }[] = [];
    for (const { n, h } of satirlar) {
      const [kod = '', m = '', t = '', kaynak = ''] = h;
      const maliyet = Number(/,/.test(m) ? m.replace(/\./g, '').replace(',', '.') : m);
      const tm = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t); const tarih = tm ? `${tm[3]}-${tm[2]}-${tm[1]}` : t;
      if (!mevcut.has(kod)) hatalar.push(`Satır ${n}: ${kod || 'kod boş'} taslak sürümde bulunamadı.`);
      else if (!(maliyet > 0)) hatalar.push(`Satır ${n}: maliyet pozitif olmalıdır.`);
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih) || Number.isNaN(Date.parse(tarih))) hatalar.push(`Satır ${n}: maliyet tarihi geçersizdir.`);
      else if (!kaynak) hatalar.push(`Satır ${n}: kaynak norm zorunludur.`);
      else kayit.push({ kod, maliyet: Math.round(maliyet * 100) / 100, tarih, kaynak });
    }
    if (hatalar.length) return y.code(400).send({ hata: `${hatalar.length} satır hatalı; hiçbir satır işlenmedi. ${hatalar.slice(0, 10).join(' ')}`, hatalar: hatalar.slice(0, 50) });
    return islem(async (c) => {
      await c.query(`UPDATE kartela_kalemi k SET maliyet_eur = t.m, maliyet_tarihi = t.d, kaynak_norm = t.s FROM unnest($2::text[], $3::numeric[], $4::date[], $5::text[]) t(a, m, d, s) WHERE k.kod = t.a AND k.surum = $1`, [sur, kayit.map((x) => x.kod), kayit.map((x) => x.maliyet), kayit.map((x) => x.tarih), kayit.map((x) => x.kaynak)]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kartela Maliyeti (Toplu)', nesneTuru: 'Kartela', nesneKimligi: sur, yeni: { satir: kayit.length, kodlar: kayit.slice(0, 200).map((x) => x.kod) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { islenen: kayit.length };
    });
  });
  // YG-661: kalemi kullanımdan kaldırma yalnız taslak sürümde, gerekçeyle; CEO sürümü onaylayınca yürürlükten çıkar.
  s.post('/kartela/taslak/kaldir', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kod?: string; gerekce?: string };
    if (!(await kartelaYetkili(o.kullanici))) return yok(y);
    const sur = await taslak(); if (!sur) return y.code(409).send({ hata: 'Önce taslak sürüm açınız.' });
    if (!g.kod || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Kalem kodu ve kaldırma gerekçesi zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Kartela Sürümü' AND nesne_kimligi = $1 AND kapanma_zamani IS NULL`, [sur])).rowCount) return y.code(409).send({ hata: 'Sürüm onaydadır.' });
    const r = await b.db.query(`DELETE FROM kartela_kalemi WHERE kod = $1 AND surum = $2 RETURNING islem`, [g.kod, sur]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Kalem taslak sürümde bulunamadı.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kartela Kalemi Kaldırıldı', nesneTuru: 'Kartela', nesneKimligi: `${g.kod}@${sur}`, eski: { islem: r.rows[0].islem }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/kartela/taslak/onaya-gonder', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (!(await kartelaYetkili(o.kullanici))) return yok(y);
    const sur = await taslak(); if (!sur) return y.code(409).send({ hata: 'Taslak sürüm yoktur.' });
    const eksik = Number((await b.db.query(`SELECT count(*) n FROM kartela_kalemi WHERE surum = $1 AND (maliyet_eur <= 0 OR maliyet_tarihi IS NULL OR kaynak_norm IS NULL)`, [sur])).rows[0].n);
    if (eksik) return y.code(409).send({ hata: `${eksik} kalemde pozitif maliyet, maliyet tarihi veya kaynak norm eksiktir.` });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Kartela Sürümü' AND nesne_kimligi = $1 AND kapanma_zamani IS NULL`, [sur])).rowCount) return y.code(409).send({ hata: 'Sürüm onaydadır.' });
    const k = await kartAc(b.db, { tur: 'Kartela Sürümü', baslik: `Kartela ${sur} · Yürürlüğe Alma`, ozet: 'Onayla önceki sürüm arşive düşer.', hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Genel Müdür Yardımcısı'), await rolId(b.db, 'CEO')] /* YG-541: rutin konular CEO'ya GMY üzerinden */, nesneTuru: 'Kartela Sürümü', nesneKimligi: sur });
    return { kart: k };
  });

  // YG-195, YG-198: cetveli Teknik Uzman hazırlar, Teknik Yönetici onaylar; bedel türü ve nitelik satırda seçilir.
  s.post('/dosya/:id/cetvel', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { satirlar?: { kod?: string; kartela?: string; aciklama?: string; nitelik?: string; bedel?: string; miktar?: number; birim?: string; bolge?: string; kabul?: string; olcut?: string; gecici?: boolean; tur?: string; teknikPay?: number; olculemez?: boolean }[]; dahilHaric?: string; varsayimlar?: string };
    const d = await dosyam(id, o.kullanici);
    if (!d) return yok(y);
    const ekip = (await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)') AND bitis_zamani IS NULL`, [id, o.kullanici])).rowCount;
    if (!ekip) return y.code(403).send({ hata: 'Kapsam ve metraj cetvelini Teknik Uzman hazırlar.' });
    // YG-195: onay bekleyen değişiklik kaydı sonuçlanmadan yeni kapsam sürümü onaya sunulamaz.
    if ((await b.db.query(`SELECT 1 FROM degisiklik_protokolu WHERE dosya_ref = $1 AND durum = 'Onay Bekliyor' LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Yeni kapsam sürümü için önce onay bekleyen değişiklik kaydının sonuçlanmasını rica ederiz.' });
    if (!g.satirlar?.length) return y.code(400).send({ hata: 'En az bir satır giriniz.' });
    // YG-182: genel gider ve risk payı ayrı satır olarak yazılmaz; birim fiyatlara dahildir.
    if (g.satirlar.some((x) => /genel\s*gider|risk\s*pay/i.test(`${x.aciklama ?? ''} ${x.kod ?? ''}`))) return y.code(400).send({ hata: 'Genel gider ve risk payı ayrı satır olarak yazılmaz; birim fiyatlara dahildir.' });
    if (g.satirlar.some((x) => x.tur !== undefined && !['Ana Kapsam', 'Opsiyon', 'Koşullu', 'Alternatif'].includes(x.tur))) return y.code(400).send({ hata: 'Satır türünü seçiniz: Ana Kapsam, Opsiyon, Koşullu veya Alternatif.' }); // YG-196
    const sur = await yururlukSurumu(b.db);
    // YG-1257, YG-1708 (KS-2): cetvel birimi ortak ölçü birimi listesinden olmalıdır; büyük-küçük harf farkı listedeki yazıma çevrilir.
    const birimler = (await b.db.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = 'LST_OLCU_BIRIMI'`)).rows.map((r) => r.deger as string);
    for (const [n, x] of g.satirlar.entries()) {
      if (birimler.length && x.birim?.trim() && !/ekip\s*[-·x×]?\s*saat/i.test(x.birim)) { const bu = birimler.find((v) => v.toLocaleLowerCase('tr') === x.birim!.trim().toLocaleLowerCase('tr')); if (!bu) return y.code(400).send({ hata: `${n + 1}. satırdaki birim ortak ölçü birimi listesinde yoktur: ${x.birim}. Listeden seçiniz.` }); x.birim = bu; }
    }
    for (const [n, x] of g.satirlar.entries()) {
      if (!x.aciklama?.trim() || !(Number(x.miktar) > 0) || !x.birim?.trim()) return y.code(400).send({ hata: `${n + 1}. satırda açıklama, miktar ve birim zorunludur.` });
      if (/ekip\s*[-·x×]?\s*saat/i.test(x.birim)) return y.code(400).send({ hata: `${n + 1}. satırda ekip-saat birimi kullanılmaz; ekibin bir saatini saat birimiyle yazınız.` }); // YG-1708
      if (!NITELIK.includes(x.nitelik ?? '')) return y.code(400).send({ hata: `${n + 1}. satırda işin niteliğini seçiniz.` });
      if (!x.olcut?.trim()) return y.code(400).send({ hata: `${n + 1}. satırda kabul ölçütünü yazınız; ölçütsüz iş fiyatlanmaz ve atanmaz.` }); // YG-137
      if (!BEDEL.includes(x.bedel ?? '')) return y.code(400).send({ hata: `${n + 1}. satırda bedel türünü seçiniz.` });
      if (x.teknikPay !== undefined && !(Number(x.teknikPay) >= 0)) return y.code(400).send({ hata: `${n + 1}. satırda teknik pay sıfır veya pozitif olmalıdır.` }); // YG-196
      if (x.kartela && !(await b.db.query(`SELECT 1 FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [x.kartela, sur])).rowCount) return y.code(400).send({ hata: `${n + 1}. satırdaki kartela kodu bulunamadı: ${x.kartela}` });
    }
    return islem(async (c) => {
      const surum = (await c.query(`SELECT coalesce(max(surum), 0) + 1 n FROM kapsam_cetveli WHERE dosya_ref = $1`, [id])).rows[0].n;
      // YG-139: cetvelde yazılmadıysa onaylı İlk Kapsamın hariçleri ve varsayımları teklifin Kapsam Dışı ve Varsayımlar bölümüne aktarılır.
      const ik = (await c.query(`SELECT hariclar, varsayimlar FROM ilk_kapsam WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY surum DESC LIMIT 1`, [id])).rows[0];
      const t = (await c.query(`INSERT INTO kapsam_cetveli (dosya_ref, surum, durum, hazirlayan_ref, dahil_haric, varsayimlar) VALUES ($1,$2,'Onayda',$3,$4,$5) RETURNING kimlik`, [id, surum, o.kullanici, g.dahilHaric?.trim() || ik?.hariclar || null, g.varsayimlar?.trim() || ik?.varsayimlar || null])).rows[0];
      for (const [n, x] of g.satirlar!.entries()) await c.query(`INSERT INTO kapsam_satiri (cetvel_ref, satir_kodu, bolge_kodu, kartela_kodu, kartela_disi, aciklama, isin_niteligi, bedel_turu, miktar, birim, kabul_sinifi, gecici_onarim, kabul_olcutu, satir_turu, teknik_pay, olculemez) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [t.kimlik, x.kod?.trim() || `S${String(n + 1).padStart(3, '0')}`, x.bolge ?? null, x.kartela ?? null, !x.kartela, x.aciklama!.trim(), x.nitelik, x.bedel, x.miktar, x.birim!.trim(), x.kabul ?? null, Boolean(x.gecici), x.olcut!.trim(), x.tur ?? 'Ana Kapsam', Number(x.teknikPay) || 0, x.olculemez === true]);
      await kartAc(c, { tur: 'Kapsam Cetveli', baslik: `${d.dosya_no}-MT01 · Kapsam ve Metraj Cetveli Rev.${surum}`, ozet: `${g.satirlar!.length} satır`, hazirlayan: o.kullanici, zincir: [await rolId(c, 'Teknik Yönetici')], nesneTuru: 'Kapsam Cetveli', nesneKimligi: t.kimlik });
      return { kimlik: t.kimlik, surum };
    });
  });

  // YG-1599: teklif cetvelden ve firma fiyatlarından oluşur. YG-178: LGM teklifi tek belge.
  s.post('/dosya/:id/teklif', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { firmaTeklifi?: string; muhatap?: string; dil?: string; odemeVadesi?: string; faturaBilgisi?: string; ekTeklif?: string; acilTedbir?: boolean };
    const d = await dosyam(id, o.kullanici);
    if (!d) return yok(y);
    const kilit = await ekonomikKilitEngeli(b.db, id); if (kilit) return y.code(409).send({ hata: kilit });
    if (!(await roller(o.kullanici)).includes(TICARI)) return y.code(403).send({ hata: 'Müşteri teklifini Ticari Sorumlu hazırlar.' });
    if (d.statu !== 'Aktif') return y.code(409).send({ hata: 'Teklif yalnız Aktif dosyada hazırlanır.' });
    const muhatap = g.muhatap ?? (d.odeme_yat_sahibine_zamani ? 'Yat Sahibi' : d.musteri_turu === 'Sigorta Şirketi' ? 'Sigorta Şirketi' : d.musteri_turu === 'Kurumsal Müşteri' ? 'Kurumsal Müşteri' : 'Yat Sahibi'); // YG-892
    if (!['Sigorta Şirketi', 'Yat Sahibi', 'Kurumsal Müşteri'].includes(muhatap)) return y.code(400).send({ hata: 'Muhatap geçersiz.' });
    const cetvel = (await b.db.query(`SELECT kimlik FROM kapsam_cetveli WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY surum DESC LIMIT 1`, [id])).rows[0];
    if (!cetvel) return y.code(409).send({ hata: 'Teklif için Onaylı kapsam cetveli bekleniyor.', islem: 'Kapsam Cetveline Git', hedef: 'kapsam-cetveli' }); // YG-1386
    if (!g.firmaTeklifi || !UUID.test(g.firmaTeklifi)) return y.code(400).send({ hata: 'Firma fiyat teklifini seçiniz.' });
    const ft = (await b.db.query(`SELECT * FROM firma_fiyat_teklifi WHERE kimlik = $1 AND dosya_ref = $2 AND durum IN ('Gönderildi', 'Seçildi')`, [g.firmaTeklifi, id])).rows[0];
    if (!ft) return y.code(404).send({ hata: 'Firma teklifi bulunamadı.' });
    if (new Date(ft.gecerlilik) < new Date(new Date().toISOString().slice(0, 10))) return y.code(409).send({ hata: 'Firma teklifinin geçerliliği dolmuştur.' });
    const satirlar = (await b.db.query(`SELECT s.*, f.kimlik AS firma_kalem, f.birim_fiyat_eur FROM kapsam_satiri s LEFT JOIN firma_fiyat_kalemi f ON f.satir_ref = s.kimlik AND f.teklif_ref = $2 WHERE s.cetvel_ref = $1 ORDER BY s.satir_kodu`, [cetvel.kimlik, g.firmaTeklifi])).rows;
    // YG-180: Yat Sahibi Talebi yalnız yat sahibine hitaben teklifte; sigortalı dosyada yat sahibine ayrı teklif açılabilir.
    if (muhatap !== 'Yat Sahibi' && satirlar.some((r) => r.isin_niteligi === 'Yat Sahibi Talebi')) return y.code(400).send({ hata: 'Yat Sahibi Talebi niteliği yalnız yat sahibine hitaben teklifte seçilir.' });
    // YG-1729: sigorta şirketinin e-posta adresi de portal kullanıcısı da yoksa sigortaya teklif hazırlanmaz.
    if (muhatap === 'Sigorta Şirketi') { const sg = (await b.db.query(`SELECT s.sigortaci_adi, p.eposta FROM dosya_sigorta_kaydi s LEFT JOIN dosya_tarafi p ON p.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1`, [id])).rows[0];
      if (!sg?.eposta && !(await b.db.query(`SELECT 1 FROM sigorta_kullanici WHERE lower(sigortaci_adi) = lower($1) LIMIT 1`, [sg?.sigortaci_adi ?? ''])).rowCount) return y.code(409).send({ hata: 'Sigorta şirketinin e-posta adresi bekleniyor; Dosya Sorumlusu dosya ayrıntısından girdikten sonra teklif hazırlanır.' }); }
    // YG-890: sigortanın onayladığı (veya süre dolumuyla karşılanacak sayılan) satır, aynı cetvelden yat sahibine veya kurumsal müşteriye açılan teklife yazılamaz.
    if (muhatap !== 'Sigorta Şirketi') {
      const sgOnayli = new Set((await b.db.query(`SELECT k.satir_ref FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref WHERE f.dosya_ref = $1 AND f.teklif_muhatabi = 'Sigorta Şirketi' AND f.statu NOT IN ('Yerine Geçti', 'İptal') AND k.onay_durumu = 'Onaylandı' AND k.satir_ref IS NOT NULL`, [id])).rows.map((r) => r.satir_ref as string));
      const cakisan = satirlar.filter((r) => sgOnayli.has(r.kimlik));
      if (cakisan.length) return y.code(409).send({ hata: `Sigorta şirketinin onayladığı kalem bu teklife yazılamaz: ${cakisan.map((r) => r.satir_kodu).join(', ')}. Yalnız onaylanmayan kalemlerle teklif açınız.`, cakisan: cakisan.map((r) => r.satir_kodu) });
    }
    // YG-1427, K-178: tedarikçiye bağlı satırda geçerli en düşük tedarikçi fiyatı firma fiyatı gibi kartela kuralıyla teklife geçer.
    const tdf = new Map((await b.db.query(`SELECT DISTINCT ON (x.satir_ref) x.satir_ref, x.kimlik, x.birim_fiyat_eur FROM tedarikci_teklif_kalemi x JOIN tedarikci_teklif_talebi t ON t.kimlik = x.talep_ref WHERE t.dosya_ref = $1 AND x.satir_ref IS NOT NULL AND x.birim_fiyat_eur IS NOT NULL AND t.durum = 'Yanıtlandı' AND t.gecerlilik >= (now() AT TIME ZONE 'Europe/Istanbul')::date ORDER BY x.satir_ref, x.birim_fiyat_eur`, [id])).rows.map((r) => [r.satir_ref as string, r]));
    const tdb = new Set((await b.db.query(`SELECT x.satir_ref FROM tedarikci_teklif_kalemi x JOIN tedarikci_teklif_talebi t ON t.kimlik = x.talep_ref WHERE t.dosya_ref = $1 AND x.satir_ref IS NOT NULL AND t.durum = 'Yanıt Bekliyor' AND t.son_zaman > now()`, [id])).rows.map((r) => r.satir_ref as string));
    for (const r of satirlar) { const td = tdf.get(r.kimlik); if (td) { r.firma_kalem = null; r.tedarikci_kalem = td.kimlik; r.birim_fiyat_eur = td.birim_fiyat_eur; } }
    const tdBekleyen = satirlar.filter((r) => !r.tedarikci_kalem && tdb.has(r.kimlik));
    if (tdBekleyen.length) return y.code(409).send({ hata: `Tedarikçi fiyatı bekleyen kalem var: ${tdBekleyen.map((r) => r.satir_kodu).join(', ')}.`, eksik: tdBekleyen.map((r) => r.satir_kodu) });
    const eksik = satirlar.filter((r) => r.firma_kalem === null && !r.tedarikci_kalem);
    if (eksik.length) return y.code(409).send({ hata: `Firma fiyatı bekleyen kalem var: ${eksik.map((r) => r.satir_kodu).join(', ')}.`, eksik: eksik.map((r) => r.satir_kodu) });
    return islem(async (c) => {
      const [kat0, bant, kdvO] = [await parametre(c, 'fiyat_katsayisi'), await parametre(c, 'bant_orani'), await parametre(c, 'kdv_orani')];
      const kat = kat0 * await (await import('./bolge_katsayisi.js')).bolgeKatsayisi(c, id); // YG-856, KS-11
      const sur = await yururlukSurumu(c);
      const no = await altNumara(c, d.dosya_no, 'TK');
      const t = (await c.query(`INSERT INTO fiyat_teklifi (teklif_no, teklif_turu, ana_teklif_ref, dosya_ref, cetvel_ref, teklif_muhatabi, teklif_dili, kdv_orani, odeme_vadesi, fatura_bilgisi, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`,
        [no, g.acilTedbir ? 'Acil Tedbir Fiyat Teklifi' : g.ekTeklif ? 'Ek Fiyat Teklifi' : 'Fiyat Teklifi', g.ekTeklif || null, id, cetvel.kimlik, muhatap, d.yazisma_dili, kdvO, g.odemeVadesi ?? null, g.faturaBilgisi ?? null, o.kullanici])).rows[0];
      // YG-1457: bildirilen onarım süresi firmanın tahmini süresinin tampon kadar fazlasıdır (yukarı yuvarlanır); firma iş emrinde kendi süresi kalır.
      const fs = (await c.query(`SELECT tahmini_sure_gun FROM firma_teknik_raporu WHERE dosya_ref = $1 AND tahmini_sure_gun IS NOT NULL ORDER BY firma_onayi DESC LIMIT 1`, [id])).rows[0]?.tahmini_sure_gun;
      if (fs) await c.query(`UPDATE fiyat_teklifi SET bildirilen_sure_gun = $2 WHERE kimlik = $1`, [t.kimlik, Math.ceil(Number(fs) * (1 + await parametre(c, 'onarim_sure_tamponu')) - 1e-9)]);
      // YG-864: ödenen Keşif Ücreti ilk teklife ayrı mahsup satırıyla düşülür; iskonto limitine sayılmaz.
      if (muhatap !== 'Sigorta Şirketi' && !g.ekTeklif) await c.query(`UPDATE fiyat_teklifi SET kesif_mahsubu_eur = (SELECT coalesce(sum(tutar_eur), 0) FROM odeme_talebi WHERE dosya_ref = $2 AND tur = 'Keşif Ücreti' AND durum = 'Ödendi') WHERE kimlik = $1 AND NOT EXISTS (SELECT 1 FROM fiyat_teklifi x WHERE x.dosya_ref = $2 AND x.kimlik <> $1 AND x.kesif_mahsubu_eur > 0 AND x.statu <> 'İptal')`, [t.kimlik, id]);
      let n = 0; const hesap: { tutar_eur: number; opsiyon: boolean }[] = []; const kodlar: string[] = []; let bantDisi = 0;
      for (const r of satirlar) {
        const k = r.kartela_kodu ? (await c.query(`SELECT maliyet_eur FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [r.kartela_kodu, sur])).rows[0] : null;
        // YG-1707: GMO tarifeli kalemin maliyeti yatın boyutlarından hesaplanır.
        const kMaliyet = k && GMO_KALEMLERI.includes(r.kartela_kodu) ? await gmoMaliyet(c, id, Number(k.maliyet_eur)) : k ? Number(k.maliyet_eur) : null;
        const h = kalemHesapla(Number(r.birim_fiyat_eur), Number(r.miktar), kat, bant, kMaliyet);
        if (h.bantDisi) bantDisi++;
        const bantAU = h.bant; // YG-233
        if (r.kartela_kodu) kodlar.push(r.kartela_kodu);
        hesap.push({ tutar_eur: h.tutar, opsiyon: (r.satir_turu ?? 'Ana Kapsam') !== 'Ana Kapsam' }); // YG-196: opsiyon, koşullu ve alternatif ana toplama girmez
        await c.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, satir_ref, kartela_kodu, kartela_surumu, kartela_disi, aciklama, isin_niteligi, bedel_turu, miktar, birim, firma_kalem_ref, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, bant_disi, tedarikci_kalem_ref, opsiyon, olculemez) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [t.kimlik, ++n, r.kimlik, r.kartela_kodu, r.kartela_kodu ? sur : null, r.kartela_disi, r.aciklama, r.isin_niteligi, r.bedel_turu, r.miktar, r.birim, r.firma_kalem, r.birim_fiyat_eur, h.birimSatis, h.tutar, h.bantDisi, r.tedarikci_kalem ?? null, (r.satir_turu ?? 'Ana Kapsam') !== 'Ana Kapsam', r.olculemez === true]); // YG-196: ana dışı satır opsiyon
        if (bantAU) await c.query(`UPDATE fiyat_teklifi_kalemi SET bant_alt_eur = $2, bant_ust_eur = $3 WHERE teklif_ref = $1 AND sira_no = $4`, [t.kimlik, bantAU.alt, bantAU.ust, n]);
      }
      const top = toplamlar(hesap, null, 0, kdvO);
      await c.query(`UPDATE fiyat_teklifi SET ara_toplam_eur = $2, kdv_tutari_eur = $3, genel_toplam_eur = $4, onay_limit_tutari_eur = $5 WHERE kimlik = $1`, [t.kimlik, top.ara, top.kdv, top.genel, top.matrah]);
      await (await import('./resmi_onay.js')).resmiOnayKontrol(c, t.kimlik); // YG-1441
      const genelT = await teklifKdvUygula(c, t.kimlik);
      await c.query(`UPDATE firma_fiyat_teklifi SET durum = 'Seçildi' WHERE kimlik = $1`, [g.firmaTeklifi]);
      // YG-420: aynı dosyada gönderilmiş diğer firma teklifleri Seçilmedi olur; firmalar sonucu portaldan bildirimle öğrenir.
      { const fk = async (k: string) => (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [k])).rows.map((x) => x.kullanici_ref as string);
        const sec = (await c.query(`SELECT teklif_no, kurulus_ref FROM firma_fiyat_teklifi WHERE kimlik = $1`, [g.firmaTeklifi])).rows[0];
        if (sec) await bildir(c, { olay: `firma-teklif-sonuc:${g.firmaTeklifi}`, kullanicilar: await fk(sec.kurulus_ref), baslik: `${sec.teklif_no} · Teklif Sonucu: Seçildi` });
        for (const x of (await c.query(`UPDATE firma_fiyat_teklifi SET durum = 'Seçilmedi' WHERE dosya_ref = (SELECT dosya_ref FROM firma_fiyat_teklifi WHERE kimlik = $1) AND kimlik <> $1 AND durum = 'Gönderildi' RETURNING kimlik, teklif_no, kurulus_ref`, [g.firmaTeklifi])).rows)
          await bildir(c, { olay: `firma-teklif-sonuc:${x.kimlik}`, kullanicilar: await fk(x.kurulus_ref), baslik: `${x.teklif_no} · Teklif Sonucu: Seçilmedi` }); }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Fiyat Teklifi Hazırlandı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { no, toplam: top.ara }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: t.kimlik, teklifNo: no, araToplam: top.ara, genelToplam: genelT, bantDisi, uyarilar: await kartelaUyarilari(c, kodlar) };
    });
  });

  const teklifGetir = async (id: string, k: string) => {
    if (!UUID.test(id)) return undefined;
    const t = (await b.db.query(`SELECT f.*, d.dosya_no, d.oncelik, d.musteri_turu, d.yazisma_dili, d.vefat_isareti, d.statu AS dosya_statu, d.asama AS dosya_asama, d.yat_ref FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [id])).rows[0];
    return t && await dosyaErisimi(b.db, k, t.dosya_ref) ? t : undefined;
  };

  // LGM içi: firma maliyeti yalnız yetkili rollere (YG-296 dışa yansımaz).
  s.get('/teklif/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici);
    if (!t) return yok(y);
    const kalemler = (await b.db.query(`SELECT * FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [t.kimlik])).rows;
    const r = await roller(o.kullanici);
    const maliyetGorur = r.some((x) => [TICARI, 'Ticari İşler Direktörü', 'Genel Müdür Yardımcısı', 'CEO', 'Muhasebe ve Finans Müdürü', 'Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdür Yardımcısı'].includes(x));
    return { ...t, kalemler: kalemler.map((k) => (maliyetGorur ? k : { ...k, birim_maliyet_eur: undefined, firma_kalem_ref: undefined, tedarikci_kalem_ref: undefined })), uyarilar: await kartelaUyarilari(b.db, kalemler.map((k) => k.kartela_kodu).filter(Boolean)) };
  });

  s.get('/dosya/:id/teklifler', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const d = await dosyam(id, o.kullanici);
    if (!d) return yok(y);
    const cetveller = (await b.db.query(`SELECT c.kimlik, c.surum, c.durum, (SELECT count(*)::int FROM kapsam_satiri s WHERE s.cetvel_ref = c.kimlik) AS satir FROM kapsam_cetveli c WHERE c.dosya_ref = $1 ORDER BY c.surum DESC`, [id])).rows;
    const teklifler = (await b.db.query(`SELECT kimlik, teklif_no, surum_no, (SELECT a.teklif_no FROM fiyat_teklifi a WHERE a.kimlik = fiyat_teklifi.ana_teklif_ref) AS ana_teklif_no, teklif_turu, statu, karar, ara_toplam_eur, genel_toplam_eur, gecerlilik_bitis_tarihi::text, teklif_muhatabi, odeme_farki_ayri, bant_disi_onay_ref IS NOT NULL AS bant_onayli, EXISTS (SELECT 1 FROM fiyat_teklifi_kalemi x WHERE x.teklif_ref = fiyat_teklifi.kimlik AND x.bant_disi) AS bant_disi FROM fiyat_teklifi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`, [id])).rows;
    const firma = (await b.db.query(`SELECT f.kimlik, f.teklif_no, f.durum, f.toplam_eur, f.gecerlilik::text, (SELECT count(*)::int FROM firma_fiyat_kalemi x WHERE x.teklif_ref = f.kimlik AND x.aralik_disi) AS aralik_disi FROM firma_fiyat_teklifi f WHERE f.dosya_ref = $1 ORDER BY f.olusturma_zamani DESC`, [id])).rows;
    const isEmirleri = (await b.db.query(`SELECT e.kimlik, e.is_emri_no, e.is_emri_turu, e.statu, CASE WHEN e.statu = 'Taslak' THEN 'Taslak' WHEN e.statu IN ('İç Onayda', 'Kabul Bekliyor', 'Çekinceli') THEN 'Onay Bekliyor' WHEN e.statu = 'Başlangıç Kontrolünde' THEN 'Hazır' WHEN e.statu IN ('Aktif', 'Durduruldu') THEN 'Uygulamada' WHEN e.statu = 'Tamamlandı' AND e.teknik_kabul_sonucu IS NULL THEN 'Kontrol Bekliyor' WHEN e.statu = 'Tamamlandı' THEN 'Kabul' WHEN e.statu = 'Kapalı' THEN 'Kapalı' END AS paket_statusu, e.firma_yaniti, e.ana_is_emri_ref, u.ticari_unvan AS firma, e.firma_bedeli_eur::float mali_limit, (SELECT f.teklif_muhatabi FROM fiyat_teklifi f WHERE f.kimlik = e.teklif_ref) namina /* YG-889 */, (SELECT count(*)::int FROM is_emri_limit_gecmisi l WHERE l.is_emri_ref = e.kimlik) limit_surumu /* YG-323 */, (SELECT json_build_object('kimlik', a.kimlik, 'oneri', a.oneri) FROM aski_is_karari a WHERE a.is_emri_ref = e.kimlik AND a.karar IS NULL) AS aski FROM is_emri e JOIN kurulus u ON u.kimlik = e.kurulus_ref WHERE e.dosya_ref = $1 ORDER BY e.olusturma_zamani`, [id])).rows;
    const zarfSapmalari = (await b.db.query(`SELECT s.kimlik, s.aciklama, e.is_emri_no FROM sapma_kaydi s JOIN is_emri e ON e.kimlik = s.is_emri_ref WHERE s.dosya_ref = $1 AND s.zarf_genisledi AND s.ek_is_emri_ref IS NULL ORDER BY s.olusturma_zamani`, [id])).rows; // YG-407
    return { cetveller, teklifler, firma, isEmirleri, zarfSapmalari, ekonomikKilit: !(await ekonomikKilitEngeli(b.db, id) === null) };
  });

  // YG-174: Ticari Sorumlu gerekçeli indirim talebi açar; talep tutardan bağımsız GMY'ye çıkar, %5 üzeri GMY görüşüyle CEO'ya gider.
  s.post('/teklif/:id/indirim-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { oran?: number; gerekce?: string };
    if (!t) return yok(y);
    if (t.kilitli || t.statu !== 'Taslak') return y.code(409).send({ hata: 'İndirim talebi taslak teklifte açılır.' });
    if (!(await roller(o.kullanici)).includes('Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)')) return y.code(403).send({ hata: 'İndirim talebini Ticari Sorumlu açar.' });
    if (!Number.isInteger(g.oran) || g.oran! < 1 || g.oran! > 10) return y.code(400).send({ hata: 'İndirim oranı %1–%10 arasında tam sayı olmalıdır.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'İndirim gerekçesi zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'İndirim Talebi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [t.kimlik])).rowCount) return y.code(409).send({ hata: 'Bu teklif için onay bekleyen indirim talebi vardır.' });
    await b.db.query(`UPDATE fiyat_teklifi SET indirim_talep_orani = $2, indirim_talep_gerekcesi = $3, indirim_talep_eden_ref = $4 WHERE kimlik = $1`, [t.kimlik, g.oran, g.gerekce.trim(), o.kullanici]);
    const zincir = [await rolId(b.db, 'Genel Müdür Yardımcısı'), ...(g.oran! > 5 ? [await rolId(b.db, 'CEO')] : [])];
    await kartAc(b.db, { tur: 'İndirim Talebi', baslik: `${t.teklif_no} · %${g.oran} İndirim Talebi`, ozet: g.gerekce.trim(), hazirlayan: o.kullanici, zincir, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
    return { durum: 'Onaya Gönderildi', makam: g.oran! > 5 ? 'CEO' : 'Genel Müdür Yardımcısı' };
  });
  // YG-174: indirim yalnız GMY ve CEO ekranında; %1–%10 tam sayı; tutara bakmadan GMY'ye çıkar, %5 üstü GMY görüşüyle CEO.
  s.post('/teklif/:id/indirim', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { oran?: number; gerekce?: string };
    if (!t) return yok(y);
    if (t.kilitli) return y.code(409).send({ hata: 'Teklif kilitlidir.' });
    const r = await roller(o.kullanici);
    if (!r.includes('Genel Müdür Yardımcısı') && !r.includes('CEO')) return y.code(403).send({ hata: 'İndirimi yalnız Genel Müdür Yardımcısı ve CEO uygular.' });
    if (!Number.isInteger(g.oran) || g.oran! < 1 || g.oran! > 10) return y.code(400).send({ hata: 'İndirim oranı %1–%10 arasında tam sayı olmalıdır.' });
    if (g.oran! > 5 && !r.includes('CEO')) return y.code(403).send({ hata: '%5 üzeri indirim Genel Müdür Yardımcısı görüşüyle CEO onayındadır.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'İndirim gerekçesi zorunludur.' });
    const kalem = (await b.db.query(`SELECT tutar_eur, opsiyon FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik])).rows;
    const top = toplamlar(kalem, g.oran!, Number(t.kesif_mahsubu_eur), Number(t.kdv_orani));
    await b.db.query(`UPDATE fiyat_teklifi SET indirim_orani = $2, indirim_gerekcesi = $3, indirim_tutari_eur = $4, kdv_tutari_eur = $5, genel_toplam_eur = $6, onay_limit_tutari_eur = $7, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik, g.oran, g.gerekce.trim(), top.ind, top.kdv, top.genel, top.matrah]);
    const genelT = await teklifKdvUygula(b.db, t.kimlik);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teklif İndirimi', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { oran: g.oran, tutar: top.ind }, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { indirim: top.ind, genelToplam: genelT };
  });

  // YG-187: bant dışı kalem varsa önce TİD'in gerekçeli onayı.
  s.post('/teklif/:id/bant-onayi', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const { gerekce } = (i.body ?? {}) as { gerekce?: string };
    if (!t) return yok(y);
    if (t.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Talebi teklifi hazırlayan açar.' });
    if (!gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND bant_disi LIMIT 1`, [t.kimlik])).rowCount) return y.code(409).send({ hata: 'Bant dışı kalem yoktur.' });
    await kartAc(b.db, { tur: 'Bant Dışı Onayı', baslik: `${t.teklif_no} · Bant Dışı Kalem Onayı`, ozet: gerekce.trim(), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Ticari İşler Direktörü')], nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
    return { durum: 'Onaya Gönderildi' };
  });

  // MSR-1, YG-182, YG-183, YG-331: tesisin kendi tarifesiyle fiyatladığı bedel kartelada yoktur; teklife belgesiyle, gerçek tutarıyla Masraf kalemi olarak yazılır. Fiyat kuralı uygulanmaz.
  s.post('/teklif/:id/masraf-kalemi', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { aciklama?: string; nitelik?: string; tutar?: number; belge?: string; seyahat?: { km?: number; arac?: string } };
    if (!t) return yok(y);
    if (t.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Masraf kalemini teklifi hazırlayan ekler.' });
    if (t.statu !== 'Taslak') return y.code(409).send({ hata: 'Masraf kalemi taslak teklife eklenir.' });
    const kilit = await ekonomikKilitEngeli(b.db, t.dosya_ref); if (kilit) return y.code(409).send({ hata: kilit });
    if (!g.aciklama?.trim() || !(Number(g.tutar) > 0)) return y.code(400).send({ hata: 'Açıklama ve tutarı yazmanızı rica ederiz.' });
    // YG-1418: geçerli garantide yan masraf yat sahibine yazılmaz.
    if ((await b.db.query(`SELECT 1 FROM garanti_sikayet WHERE dosya_ref = $1 AND karar = 'Garanti' LIMIT 1`, [t.dosya_ref])).rowCount) return y.code(409).send({ hata: 'Geçerli garantide bu masraf yat sahibine yazılmaz; firma hakedişinden mahsup edilir.' });
    // YG-237: seyahat gerçek tutarla Masraf olur; tek yön 500 km üzeri uçak (ekonomi), 500 km ve altı karayolu.
    let seyahatEki = '';
    if (g.seyahat) {
      const km = Number(g.seyahat.km);
      if (!(km > 0)) return y.code(400).send({ hata: 'Seyahat mesafesini (km) yazınız.' });
      const kural = km > 500 ? 'Uçak (Ekonomi)' : 'Karayolu';
      if (g.seyahat.arac !== kural) return y.code(400).send({ hata: `${km.toLocaleString('tr-TR')} km yolculukta ulaşım ${kural} ile yapılır.` });
      seyahatEki = ` (Seyahat: ${kural}, ${km.toLocaleString('tr-TR')} km)`;
    }
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: g.seyahat ? 'Bilet veya yol gideri belgesini eklemenizi rica ederiz.' : 'Tesis teklifi veya tarife belgesini eklemenizi rica ederiz.' });
    // YG-179, YG-1770: işin niteliği listeden zorunlu (varsayılan yazılmaz); belge bu dosyaya yüklenmiş olmalıdır.
    if (!NITELIK.includes(g.nitelik ?? '')) return y.code(400).send({ hata: `İşin niteliğini seçiniz: ${NITELIK.join(', ')}.` });
    if (!(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2::text`, [g.belge, t.dosya_ref])).rowCount) return y.code(400).send({ hata: 'Belge bu dosyaya yüklenmiş olmalıdır.' });
    return islem(async (c) => {
      const tutarE = R2(Number(g.tutar));
      const sira = (await c.query(`SELECT coalesce(max(sira_no), 0) + 1 n FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik])).rows[0].n;
      await c.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, bant_disi) VALUES ($1,$2,$3,$4,'Masraf',1,'adet',$5,$5,$5,false)`, [t.kimlik, sira, g.aciklama!.trim() + seyahatEki, g.nitelik, tutarE]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teklife Masraf Eklendi', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { aciklama: g.aciklama, tutar: tutarE, belge: g.belge }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      const kl = (await c.query(`SELECT tutar_eur, opsiyon FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik])).rows;
      const top = toplamlar(kl, t.indirim_orani === null ? null : Number(t.indirim_orani), Number(t.kesif_mahsubu_eur), Number(t.kdv_orani));
      await c.query(`UPDATE fiyat_teklifi SET ara_toplam_eur = $2, indirim_tutari_eur = $3, kdv_tutari_eur = $4, genel_toplam_eur = $5, onay_limit_tutari_eur = $6, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik, top.ara, top.ind, top.kdv, top.genel, top.matrah]);
      const genelT = await teklifKdvUygula(c, t.kimlik);
      return { sira, araToplam: top.ara, genelToplam: genelT };
    });
  });

  // YG-212: ek teklif önceki onaylı toplam, bu ek ve yeni toplamı gösterir.
  s.get('/teklif/:id/ek-ozet', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici);
    if (!t) return yok(y);
    const once = Number((await b.db.query(`SELECT coalesce(sum(genel_toplam_eur), 0) n FROM fiyat_teklifi WHERE dosya_ref = $1 AND kimlik <> $2 AND statu = 'Karar' AND karar IN ('Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü')`, [t.dosya_ref, t.kimlik])).rows[0].n);
    const bu = Number(t.genel_toplam_eur);
    return { oncekiOnayli: once, buEk: bu, yeniToplam: Math.round((once + bu) * 100) / 100 };
  });

  // YG-194, YG-1552, YG-214: kontroller tamamlanmadan onaya gönderilmez; son makam KDV hariç kümülatif toplama göre (YG-173).
  s.post('/teklif/:id/onaya-gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici);
    if (!t) return yok(y);
    if (t.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Onaya teklifi hazırlayan gönderir.' });
    if (t.teklif_turu !== 'Acil Tedbir Fiyat Teklifi') { const re = await raporEngeli(b.db, t.dosya_ref); if (re) return y.code(409).send({ hata: re }); }
    if (t.statu !== 'Taslak') return y.code(409).send({ hata: 'Teklif taslak değildir.' });
    { const ist = (await b.db.query(`SELECT yurt_disi_istisna FROM dosya WHERE kimlik = $1`, [t.dosya_ref])).rows[0]?.yurt_disi_istisna; // YG-028
      if (ist === 'Bekliyor') return y.code(409).send({ hata: 'Türkiye dışındaki yat talebi CEO istisna onayı beklemektedir.' });
      if (ist === 'Reddedildi') return y.code(409).send({ hata: 'Türkiye dışındaki yat talebi için CEO istisna onayı verilmemiştir.' });
      // YG-1697 (A51-S6): yurt dışı dosyada Hukuk ve Uyumun uygunluk kontrolü "Uygun" olmadan teklif gönderilmez.
      if ((await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND yurt_disi`, [t.dosya_ref])).rowCount && (await b.db.query(`SELECT sonuc FROM yurt_disi_uygunluk WHERE dosya_ref = $1`, [t.dosya_ref])).rows[0]?.sonuc !== 'Uygun') return y.code(409).send({ hata: 'Yurt dışı dosyada Hukuk ve Uyum Yurt Dışı Uygunluk Kontrolü sonucu bekleniyor.' }); }
    { const sb = await sigortaBildirimEngeli(b.db, t.dosya_ref); if (sb) return y.code(409).send({ hata: sb }); } // YG-454
    if ((await b.db.query(`SELECT 1 FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND bant_disi LIMIT 1`, [t.kimlik])).rowCount && !t.bant_disi_onay_ref) return y.code(409).send({ hata: 'Bant dışı kalem için Ticari İşler Direktörünün gerekçeli onayı gereklidir.' });
    if ((await b.db.query(`SELECT 1 FROM yat WHERE kimlik = $1 AND gecici_kayit`, [t.yat_ref])).rowCount) return y.code(409).send({ hata: 'Teklif için önce Geçici yat kaydını doğrulamanızı rica ederiz.' });
    { const ak = await aritmetikKontrol(b.db, t.kimlik); if (ak) return y.code(409).send({ hata: ak }); } // YG-190
    { const ce = await cetvelDegistiEngeli(b.db, t.kimlik); if (ce) return y.code(409).send({ hata: ce }); } // YG-156
    if (t.teklif_muhatabi === 'Sigorta Şirketi') {
      const sg = (await b.db.query(`SELECT sigorta_hasar_dosya_no, cerceve_sozlesme_yok FROM dosya_sigorta_kaydi WHERE dosya_ref = $1`, [t.dosya_ref])).rows[0];
      if (!sg?.sigorta_hasar_dosya_no) return y.code(409).send({ hata: 'Gönderim için Sigorta hasar dosya numarası bekleniyor.', islem: 'Hasar Dosya No Gir', hedef: 'de-hn' }); // YG-101
      if (sg.cerceve_sozlesme_yok && (!t.odeme_vadesi || !t.fatura_bilgisi)) return y.code(409).send({ hata: 'Çerçeve sözleşmesi olmayan dosyada ödeme vadesi ve fatura bilgisi zorunludur.' }); // YG-1552
    }
    const kum = (await dosyaTaahhudu(b.db, t.dosya_ref, t.kimlik)) + Number(t.onay_limit_tutari_eur);
    const son = await yurtDisiMi(b.db, t.dosya_ref) && (await sonMakam(b.db, kum)) === 'Ticari İşler Direktörü' ? 'Genel Müdür Yardımcısı' : await sonMakam(b.db, kum); // YG-1461
    return islem(async (c) => {
      const zincir = await parasalZincir(c, ARA, son);
      await c.query(`UPDATE fiyat_teklifi SET statu = 'İç Onayda', kilitli = true, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
      await ekonomikIzle(c, t.dosya_ref, kum);
      await kartAc(c, { tur: 'Fiyat Teklifi', oncelik: t.oncelik, baslik: `${t.teklif_no} · Fiyat Teklifi Onayı`, ozet: `${tutar(Number(t.onay_limit_tutari_eur))} EUR (KDV hariç)`, hazirlayan: o.kullanici, zincir, tutar: kum, belgeSurumu: `${t.teklif_no} Rev.${t.surum_no}`, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teklif Onaya Gönderildi', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { kumulatif: kum, sonMakam: son }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { sonMakam: son, kumulatif: kum };
    });
  });

  // YG-191: geçerlilik 15 gün, gönderimden başlar. Sigortalıda BLD-71 + BLD-37; bireyselde ONY-23 (YG-466), muvafakat kilidi (YG-103).
  s.post('/teklif/:id/gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici);
    if (!t) return yok(y);
    if (t.statu !== 'Onaylı') return y.code(409).send({ hata: 'Teklif iç onaydan geçmemiştir.' });
    { const ce = await cetvelDegistiEngeli(b.db, t.kimlik); if (ce) return y.code(409).send({ hata: ce }); } // YG-156
    if (t.vefat_isareti) return y.code(409).send({ hata: 'Vefat işaretli dosyada teklif gönderimi bekletilmektedir.' });
    const yde = await yatDegeriEngeli(b.db, t.dosya_ref); if (yde) return y.code(409).send({ hata: yde });
    const dil = dilKod(t.yazisma_dili);
    if (t.teklif_muhatabi !== 'Sigorta Şirketi' && await muvafakatKilidi(b.db, t.dosya_ref)) return y.code(409).send({ hata: 'Teklif onayı için Lehtar muvafakati bekleniyor.', islem: 'Muvafakat Belgesini Seç', hedef: 'lm-b' });
    const gun = await parametre(b.db, 'teklif_gecerlilik_gun');
    // K-241: sigortaya giden teklif ikinci teyide kadar gönderilmiş sayılmaz; portala düşmez, süre başlamaz.
    if (t.teklif_muhatabi === 'Sigorta Şirketi') return islem(async (c) => {
      const sg = (await c.query(`SELECT s.sigorta_hasar_dosya_no, s.sigortaci_adi, p.eposta FROM dosya_sigorta_kaydi s LEFT JOIN dosya_tarafi p ON p.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1`, [t.dosya_ref])).rows[0];
      // YG-443: sigorta şirketi portal kullanmak zorunda değildir; e-posta da portal kullanıcısı da yoksa teklif kimseye ulaşmaz.
      if (!sg?.eposta && !(await c.query(`SELECT 1 FROM sigorta_kullanici WHERE lower(sigortaci_adi) = lower($1) LIMIT 1`, [sg?.sigortaci_adi ?? ''])).rowCount) throw Object.assign(new Error('Sigorta şirketinin e-posta adresi bekleniyor; dosya ayrıntısından girilmesini rica ederiz.'), { statusCode: 409 });
      const son = await isGunuSonu(c, new Date(), await parametre(c, 'sigorta_karar_is_gunu'));
      const gonderim = await sigortayaHazirla(c, { dosya: t.dosya_ref, tur: 'Fiyat Teklifi', nesne: t.kimlik, alici: sg?.eposta ?? null, konu: `${t.dosya_no} Teklif`, metin: await bld71(c, t, sg, son), acil: true, sorumlu: o.kullanici });
      return { durum: 'Teyit Bekliyor', gonderim };
    });
    // YG-204: yeniden değerlendirme sürerken aynı kalemler yat sahibine ayrıca sunulmaz; aynı iş iki kez onaylanmasın.
    if ((await b.db.query(`SELECT 1 FROM yeniden_degerlendirme WHERE dosya_ref = $1 AND durum = 'Gönderildi' LIMIT 1`, [t.dosya_ref])).rowCount) return y.code(409).send({ hata: 'Sigorta şirketinin yeniden değerlendirme yanıtı bekleniyor.' });
    return islem(async (c) => {
      const bit = (await c.query(`UPDATE fiyat_teklifi SET statu = 'Gönderildi', gonderim_zamani = now(), gecerlilik_bitis_tarihi = (now() AT TIME ZONE 'Europe/Istanbul')::date + $2::int, guncelleme_zamani = now() WHERE kimlik = $1 RETURNING gecerlilik_bitis_tarihi::text b`, [t.kimlik, gun])).rows[0].b;
      await sureBitir(c, { tur: 'Teklif', dosya: t.dosya_ref }); // YG-199 await sureBitir(c, { tur: 'Keşiften Teklife', dosya: t.dosya_ref }); // YG-043
      const sahip = (await c.query(`SELECT kimlik, kisi_adi_soyadi, telefon, eposta, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [t.dosya_ref])).rows[0];
      const alan = { ...SIFIRLA_YAT(t), 'bağlantı': b.webAdresi, link: b.webAdresi };
      if (!sahip) throw Object.assign(new Error('Yat sahibinin iletişim bilgisi kayıtlı değildir.'), { statusCode: 409 });
      // YG-206: sigortaca onaylanmayan kalemlerin teklifi ONY-26 ile onaylanır.
      const anaSigorta = t.ana_teklif_ref ? (await c.query(`SELECT teklif_muhatabi FROM fiyat_teklifi WHERE kimlik = $1`, [t.ana_teklif_ref])).rows[0]?.teklif_muhatabi === 'Sigorta Şirketi' : false;
      const ekTeklif = !anaSigorta && Boolean(t.ana_teklif_ref) && t.teklif_turu === 'Ek Fiyat Teklifi'; // D-042, D-062: ek teklif ONY-25
      const onyKod = anaSigorta ? 'ONY-26' : ekTeklif ? 'ONY-25' : 'ONY-23';
      if (t.musteri_turu === 'Bireysel Müşteri') await belgeUret(c, { tur: 'Ön Bilgilendirme Formu', nesne: t.kimlik, dosya: t.dosya_ref }); // YG-618, YG-619
      const s0 = (await c.query(`SELECT metin FROM sablon_metni WHERE kod = $2 AND dil = $1 AND durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`, [dil, onyKod])).rows[0];
      const { kutular } = kutuAyikla(s0.metin);
      const toplam = tutar(Number(t.genel_toplam_eur), dil);
      const bag: Record<string, string> = { ...alan, 'Teklif No / Sürüm': `${t.teklif_no} Rev.${t.surum_no}`, 'Quotation No / Version': `${t.teklif_no} Rev.${t.surum_no}`, tutar: toplam, amount: toplam };
      if (ekTeklif) { // önceki onaylı toplam: dosyada kararı onaylı tekliflerin KDV dahil toplamı
        const once = Number((await c.query(`SELECT coalesce(sum(genel_toplam_eur), 0) n FROM fiyat_teklifi WHERE dosya_ref = $1 AND kimlik <> $2 AND statu = 'Karar' AND karar IN ('Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü')`, [t.dosya_ref, t.kimlik])).rows[0].n);
        const on = tutar(once, dil); const yeni = tutar(once + Number(t.genel_toplam_eur), dil);
        Object.assign(bag, { 'ek tutar': toplam, 'additional amount': toplam, 'önceki toplam': on, 'previous total': on, 'yeni toplam': yeni, 'new total': yeni });
      }
      await belgeUret(c, { tur: 'Fiyat Teklifi', nesne: t.kimlik, dosya: t.dosya_ref });
      await onayTalebiAc(c, { dosya: t.dosya_ref, ony: onyKod, dil, alanlar: bag, baslikAlanlari: SIFIRLA_YAT(t), kutular: kutular.map((k, n) => ({ ad: doldur(k, bag), zorunlu: n === 0 })), tutar: Number(t.genel_toplam_eur), taraf: sahip.kimlik, kullanici: sahip.kullanici_ref, aliciAd: sahip.kisi_adi_soyadi, telefon: sahip.telefon, eposta: sahip.eposta, belgeAdi: `Fiyat Teklifi ${t.teklif_no}`, hazirlayan: o.kullanici, sigortaHatirlat: t.teklif_muhatabi === 'Yat Sahibi' || t.teklif_muhatabi === 'Kurumsal Müşteri', webAdresi: b.webAdresi, gun, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
      return { durum: 'Gönderildi', gecerlilik: bit };
    });
  });

  // YG-205, YG-219, YG-1464: sigorta kararı; kanal yalnız tanımlı kanallar. Kısmi onayda kalem silinmez, işaretlenir; onaylanmayanlardan yat sahibine ayrı teklif. Sonuç BLD-38 / BLD-39.
  s.post('/teklif/:id/sigorta-karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici);
    const g = (i.body ?? {}) as { karar?: string; kanal?: string; yetkili?: string; belge?: string; gonderen?: string; onaylananSiralar?: number[]; gelis?: string; gecikmeGerekcesi?: string; sart?: string };
    if (!t) return yok(y);
    if (t.teklif_muhatabi !== 'Sigorta Şirketi' || t.statu !== 'Gönderildi') return y.code(409).send({ hata: 'Sigorta kararı gönderilmiş tekliflere girilir.' });
    // YG-154: karar seçenekleri LST_ONAY_KARARI sözlüğündendir; Beklemede karar değil işarettir.
    if (!(await b.db.query(`SELECT 1 FROM deger_listesi WHERE liste_kodu = 'LST_ONAY_KARARI' AND deger = $1`, [g.karar ?? ''])).rowCount) return y.code(400).send({ hata: 'Kararı seçmenizi rica ederiz.' });
    if (['Koşullu Onay', 'Sınırlı Yetki'].includes(g.karar!) && !g.sart?.trim()) return y.code(400).send({ hata: g.karar === 'Koşullu Onay' ? 'Onayın şartını yazınız.' : 'İzin verilen ön veya koruyucu işlemi yazınız.' });
    if (g.karar === 'Sınırlı Yetki' && !g.onaylananSiralar?.length) return y.code(400).send({ hata: 'İzin verilen kalemleri seçiniz.' });
    // YG-455: yazılı onay geliş zamanından itibaren 8 saat içinde kaydedilir; aşımda gecikme gerekçesi zorunludur.
    const gelis = g.gelis ? new Date(g.gelis) : null;
    if (gelis && (Number.isNaN(gelis.getTime()) || gelis.getTime() > Date.now() + 60_000)) return y.code(400).send({ hata: 'Onayın geliş zamanı geçersizdir.' });
    if (gelis && Date.now() - gelis.getTime() > 8 * 3_600_000 && !g.gecikmeGerekcesi?.trim()) return y.code(409).send({ hata: 'Onay geldikten sonra 8 saat geçmiştir; kayıt gecikmesinin gerekçesini yazmanızı rica ederiz.' });
    if (!['YATONET 360', 'KEP', 'E-imza', 'Sözleşmede Tanımlı Kurumsal E-posta'].includes(g.kanal ?? '')) return y.code(400).send({ hata: 'Telefon ve WhatsApp onay kanalı sayılmaz; tanımlı kanalı seçiniz.' }); // YG-218, YG-221
    if (g.kanal === 'YATONET 360') return y.code(400).send({ hata: 'YATONET 360 onayını sigorta kullanıcısı portaldan verir; burada yazılı onay belgesi girilir.' }); // YG-449
    if (!g.yetkili?.trim()) return y.code(400).send({ hata: 'Onaylayan yetkiliyi yazınız.' });
    if (!g.belge) return y.code(400).send({ hata: 'Onay belgesini dosyaya yükleyip seçiniz.' });
    if (g.karar === 'Kısmi Onay' && !g.onaylananSiralar?.length) return y.code(400).send({ hata: 'Onaylanan kalemleri seçiniz.' });
    const dil = dilKod(t.yazisma_dili);
    if (g.karar === 'Sınırlı Yetki') return islem(async (c) => {
      // YG-154: Sınırlı Yetki esas onarımı başlatmaz; teklif onay beklemeye devam eder, yalnız seçilen ön/koruyucu işlem kalemleri yürütülebilir.
      const siralar = (await c.query(`SELECT sira_no FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND sira_no = ANY($2::int[])`, [t.kimlik, g.onaylananSiralar])).rows.map((r) => r.sira_no as number);
      if (siralar.length !== new Set(g.onaylananSiralar).size) throw Object.assign(new Error('Kalem bulunamadı.'), { statusCode: 400 });
      const tut = R2((await c.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND sira_no = ANY($2::int[])`, [t.kimlik, siralar])).rows[0].t);
      await c.query(`INSERT INTO sigorta_onayi (dosya_ref, teklif_ref, karar, onaylanan_tutar_eur, onay_kanali, onay_tarihi, onay_belgesi_ref, gonderen_eposta, onaylayan_yetkili, kaydi_yapan_ref, sart, izinli_siralar) VALUES ($1,$2,'Sınırlı Yetki',$3,$4,now(),$5,$6,$7,$8,$9,$10)`, [t.dosya_ref, t.kimlik, tut, g.kanal, g.belge, g.gonderen?.trim() || null, g.yetkili!.trim(), o.kullanici, g.sart!.trim(), siralar]);
      const ds = (await c.query(`SELECT dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [t.dosya_ref])).rows[0]?.dosya_sorumlusu_ref ?? t.hazirlayan_ref;
      await kartAc(c, { tur: 'Sınırlı Yetki', kategori: 'gorev', baslik: `${t.dosya_no} · Sigorta Sınırlı Yetki: Yalnız Ön/Koruyucu İşlem`, ozet: `${g.sart!.trim()} · Kalemler: ${siralar.join(', ')} · Esas onarım için sigorta kararı beklenir`.slice(0, 400), oncelik: 'Yüksek', sahipKullanici: ds, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Kararı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { karar: 'Sınırlı Yetki', kalemler: siralar, tutar: tut }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { durum: 'Sınırlı Yetki', onaylananTutar: tut, ekTeklif: null };
    });
    return islem(async (c) => {
      const kalemler = (await c.query(`SELECT * FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [t.kimlik])).rows;
      const onayli = g.karar === 'Tam Onay' || g.karar === 'Koşullu Onay' ? kalemler.map((k) => k.sira_no as number) : g.karar === 'Kısmi Onay' ? g.onaylananSiralar! : [];
      for (const k of kalemler) await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = $2 WHERE kimlik = $1`, [k.kimlik, onayli.includes(k.sira_no) ? 'Onaylandı' : 'Onaylanmadı']);
      const tutarOnay = R2(kalemler.filter((k) => onayli.includes(k.sira_no)).reduce((a, k) => a + Number(k.tutar_eur), 0));
      if (g.kanal === KURUMSAL_EPOSTA) { const h = await ek2Engeli(c, t.dosya_ref, g.gonderen, tutarOnay, o.kullanici); if (h) throw Object.assign(new Error(h), { statusCode: g.gonderen ? 409 : 400 }); } // YG-219
      await c.query(`INSERT INTO sigorta_onayi (dosya_ref, teklif_ref, karar, onaylanan_tutar_eur, onay_kanali, onay_tarihi, onay_belgesi_ref, gonderen_eposta, onaylayan_yetkili, kaydi_yapan_ref, sart) VALUES ($1,$2,$3,$4,$5,now(),$6,$9,$7,$8,$10)`, [t.dosya_ref, t.kimlik, g.karar, tutarOnay, g.kanal, g.belge ?? null, g.yetkili!.trim(), o.kullanici, g.gonderen?.trim() || null, g.karar === 'Koşullu Onay' ? g.sart!.trim() : null]);
      if (gelis) await c.query(`UPDATE sigorta_onayi SET gelis_zamani = $2, kayit_gecikme_gerekcesi = $3 WHERE kimlik = (SELECT kimlik FROM sigorta_onayi WHERE teklif_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 1)`, [t.kimlik, gelis, g.gecikmeGerekcesi?.trim() || null]); // YG-455
      await c.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = $2, karar_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik, g.karar]);
      if (g.karar === 'Tam Onay' || g.karar === 'Kısmi Onay') await (await import('./belge_uret.js')).sigortaOnayBelgesiUret(c, t.kimlik); // YG-1569
      if (g.karar === 'Tam Onay' || g.karar === 'Kısmi Onay') {
        if (t.dosya_statu === 'Aktif' && t.dosya_asama !== 'Uygulama') await statuYaz(c, { kimlik: t.dosya_ref, statu: 'Aktif', asama: t.dosya_asama }, { statu: 'Aktif', asama: 'Uygulama' }, `Sigorta kararı: ${g.karar}`, o.kullanici, 'Operasyon Yöneticisi');
      }
      const sahip = (await c.query(`SELECT kimlik, kisi_adi_soyadi, telefon, eposta, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [t.dosya_ref])).rows[0];
      const alan = { ...SIFIRLA_YAT(t), 'bağlantı': b.webAdresi, link: b.webAdresi };
      // YG-154: Koşullu Onayda uygulama şart doğrulanınca başlar.
      if (g.karar === 'Koşullu Onay') {
        const ds = (await c.query(`SELECT dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [t.dosya_ref])).rows[0]?.dosya_sorumlusu_ref ?? t.hazirlayan_ref;
        await kartAc(c, { tur: 'Koşullu Onay Şartı', kategori: 'gorev', baslik: `${t.dosya_no} · Sigorta Koşullu Onayı: Şartı Doğrulayınız`, ozet: g.sart!.trim().slice(0, 400), oncelik: 'Yüksek', sahipKullanici: ds, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
      }
      if (sahip && g.karar === 'Tam Onay') await yatTarafinaYaz(c, { olay: `bld38:${t.kimlik}`, kod: 'BLD-38', dil, konu: `${t.dosya_no} Bilgilendirme`, telefon: sahip.telefon, eposta: sahip.eposta, alanlar: alan });
      let ekTeklif: string | null = null;
      if (sahip && g.karar === 'Kısmi Onay') {
        await yatTarafinaYaz(c, { olay: `bld39:${t.kimlik}`, kod: 'BLD-39', dil, konu: `${t.dosya_no} Bilgilendirme`, telefon: sahip.telefon, eposta: sahip.eposta, alanlar: alan });
        await kartAc(c, { tur: 'Fiyat Teklifi Hazırla', baslik: `${t.dosya_no} · Sigortaca Onaylanmayan Kalemler İçin Teklif`, ozet: `${kalemler.length - onayli.length} kalem`, kategori: 'islem', sahipKullanici: t.hazirlayan_ref, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
        ekTeklif = 'gerekli';
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Kararı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { karar: g.karar, tutar: tutarOnay }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { durum: g.karar, onaylananTutar: tutarOnay, ekTeklif };
    });
  });

  // YG-154: Koşullu Onayın şartını Dosya Sorumlusu kanıtla doğrular; dosya Uygulama aşamasına geçer ve yat sahibi tam onay bildirimini (BLD-38) alır.
  // YG-220: yat sahibinin sistem erişimi yoksa karar ıslak imzalı taranmış teklifle kaydedilir; telefonla verilen onay seçeneği yoktur.
  s.post('/teklif/:id/islak-imza', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { karar?: string; belge?: string; gerekce?: string; imzaTarihi?: string; erkenIfa?: boolean };
    if (!t) return yok(y);
    if (!(await dsMi(t.dosya_ref, o.kullanici))) return y.code(403).send({ hata: 'Islak imzalı kararı Dosya Sorumlusu kaydeder.' });
    if (t.statu !== 'Gönderildi' || t.teklif_muhatabi === 'Sigorta Şirketi') return y.code(409).send({ hata: 'Yat sahibine gönderilmiş ve karar bekleyen teklif bulunmamaktadır.' });
    const on = (await b.db.query(`SELECT kimlik, gosterim_zamani FROM onay_talebi WHERE ony_kod = 'ONY-23' AND nesne_kimligi = $1::text AND durum = 'Bekliyor' ORDER BY olusturma_zamani DESC LIMIT 1`, [t.kimlik])).rows[0];
    if (!on) return y.code(409).send({ hata: 'Bekleyen yat sahibi onay talebi bulunmamaktadır.' });
    if (!['Onaylandı', 'Reddedildi'].includes(g.karar ?? '')) return y.code(400).send({ hata: 'Kararı seçmenizi rica ederiz.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Yat sahibinin sisteme erişememe nedenini yazınız.' });
    const zaman = g.imzaTarihi ? new Date(g.imzaTarihi) : null;
    if (!zaman || Number.isNaN(zaman.getTime()) || zaman > new Date() || zaman < new Date(t.gonderim_zamani ?? 0)) return y.code(400).send({ hata: 'İmza tarihini girmenizi rica ederiz; tarih teklifin gönderiminden sonra ve bugün veya geçmiş bir tarih olmalıdır.' });
    if (!(await dosyaBelgesi(g.belge, t.dosya_ref))) return y.code(400).send({ hata: 'Islak imzalı taranmış teklifi dosyaya yükleyip seçiniz.' });
    if (await bilgiBelgesiMi(b.db, g.belge!)) return y.code(409).send({ hata: BILGI_HATA });
    return islem(async (c) => {
      await c.query(`UPDATE onay_talebi SET durum = 'İptal' WHERE kimlik = $1`, [on.kimlik]);
      await c.query(`UPDATE fiyat_teklifi SET onay_kanali = 'Islak İmza', islak_imza_belge_ref = $2, islak_imza_gerekcesi = $3, islak_imza_kaydeden_ref = $4 WHERE kimlik = $1`, [t.kimlik, g.belge, g.gerekce!.trim(), o.kullanici]);
      await yatSahibiTeklifKarari(c, t.kimlik, g.karar === 'Onaylandı', { zaman, erken: g.erkenIfa === true, gosterim: on.gosterim_zamani ?? zaman, yapan: o.kullanici, kanal: 'Islak İmza' });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teklif Kararı – Islak İmza', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { karar: g.karar, belge: g.belge, gerekce: g.gerekce, imzaTarihi: g.imzaTarihi, erkenIfa: g.erkenIfa === true }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { tamam: true };
    });
  });

  s.post('/teklif/:id/sart-dogrula', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { belge?: string };
    if (!t) return yok(y);
    if (!(await dsMi(t.dosya_ref, o.kullanici))) return y.code(403).send({ hata: 'Şartı Dosya Sorumlusu doğrular.' });
    const so = (await b.db.query(`SELECT kimlik FROM sigorta_onayi WHERE teklif_ref = $1 AND karar = 'Koşullu Onay' AND sart_dogrulama_zamani IS NULL ORDER BY olusturma_zamani DESC LIMIT 1`, [t.kimlik])).rows[0];
    if (t.statu !== 'Karar' || t.karar !== 'Koşullu Onay' || !so) return y.code(409).send({ hata: 'Doğrulanacak koşullu onay yoktur.' });
    if (!(await dosyaBelgesi(g.belge, t.dosya_ref))) return y.code(400).send({ hata: 'Şartın sağlandığını gösteren belgeyi dosyaya yükleyip seçiniz.' });
    return islem(async (c) => {
      await c.query(`UPDATE sigorta_onayi SET sart_dogrulama_zamani = now(), sart_dogrulayan_ref = $2, sart_dogrulama_belgesi_ref = $3 WHERE kimlik = $1`, [so.kimlik, o.kullanici, g.belge]);
      if (t.dosya_statu === 'Aktif' && t.dosya_asama !== 'Uygulama') await statuYaz(c, { kimlik: t.dosya_ref, statu: 'Aktif', asama: t.dosya_asama }, { statu: 'Aktif', asama: 'Uygulama' }, 'Sigorta koşullu onayının şartı doğrulandı', o.kullanici, 'Operasyon Yöneticisi');
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Koşullu Onay Şartı' AND nesne_kimligi = $1 AND durum NOT IN ('Tamamlandı', 'İptal')`, [t.kimlik]);
      const sahip = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [t.dosya_ref])).rows[0];
      if (sahip) await yatTarafinaYaz(c, { olay: `bld38:${t.kimlik}`, kod: 'BLD-38', dil: dilKod(t.yazisma_dili), konu: `${t.dosya_no} Bilgilendirme`, telefon: sahip.telefon, eposta: sahip.eposta, alanlar: { ...SIFIRLA_YAT(t), 'bağlantı': b.webAdresi, link: b.webAdresi } });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Koşullu Onay Şartı Doğrulandı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { belge: g.belge }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { tamam: true };
    });
  });

  const dsMi = async (dosya: string, k: string) => { const d = (await b.db.query(`SELECT dosya_sorumlusu_ref, yedek_sorumlu_ref FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]; return d?.dosya_sorumlusu_ref === k || d?.yedek_sorumlu_ref === k; };
  const dosyaBelgesi = async (belge: string | undefined, dosya: string) => Boolean(belge && UUID.test(belge) && (await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi::text = $2`, [belge, dosya])).rowCount);
  const karsilastirma = async (t: { kimlik: string }) => {
    const { rows } = await b.db.query(`SELECT k.sira_no, k.aciklama, k.tutar_eur, k.onay_durumu, e.eksper_tutar_eur, e.eksper_notu, (SELECT y.durum FROM yeniden_degerlendirme_kalemi m JOIN yeniden_degerlendirme y ON y.kimlik = m.talep_ref WHERE m.kalem_ref = k.kimlik ORDER BY y.olusturma_zamani DESC LIMIT 1) AS yd FROM fiyat_teklifi_kalemi k LEFT JOIN eksper_karsilastirma e ON e.kalem_ref = k.kimlik WHERE k.teklif_ref = $1 ORDER BY k.sira_no`, [t.kimlik]);
    const satirlar = rows.map((r) => { const ek = r.eksper_tutar_eur === null ? null : Number(r.eksper_tutar_eur); const te = Number(r.tutar_eur); return { sira: r.sira_no as number, aciklama: r.aciklama as string, teklif: te, eksper: ek, fark: ek === null ? null : R2(te - ek), not: r.eksper_notu as string | null, onay: r.onay_durumu as string | null, yd: r.yd as string | null }; });
    const girilen = satirlar.filter((x) => x.eksper !== null);
    const talep = (await b.db.query(`SELECT y.kimlik, y.durum FROM yeniden_degerlendirme y WHERE y.teklif_ref = $1 AND y.durum = 'Gönderildi' ORDER BY y.olusturma_zamani DESC LIMIT 1`, [t.kimlik])).rows[0] ?? null;
    const kosullar = (await b.db.query(`SELECT karar, sart, izinli_siralar, onay_tarihi, sart_dogrulama_zamani FROM sigorta_onayi WHERE teklif_ref = $1 AND karar IN ('Koşullu Onay', 'Sınırlı Yetki') ORDER BY olusturma_zamani`, [t.kimlik])).rows; // YG-154
    return { satirlar, toplam: { teklif: R2(satirlar.reduce((a, x) => a + x.teklif, 0)), eksper: R2(girilen.reduce((a, x) => a + x.eksper!, 0)), fark: R2(girilen.reduce((a, x) => a + x.fark!, 0)), girilen: girilen.length }, talep, kosullar };
  };
  // YG-203: eksper raporu dosyaya yüklenir, tutarları Dosya Sorumlusu kalem kalem girer; maliyet görünmez.
  s.get('/teklif/:id/eksper-karsilastirma', oturumlu, async (i, y) => {
    const t = await teklifGetir((i.params as { id: string }).id, i.oturum!.kullanici);
    if (!t) return yok(y);
    return karsilastirma(t);
  });
  s.post('/teklif/:id/eksper-karsilastirma', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { belge?: string; satirlar?: { sira?: number; tutar?: number; not?: string }[] };
    if (!t) return yok(y);
    if (!(await dsMi(t.dosya_ref, o.kullanici))) return y.code(403).send({ hata: 'Eksper raporu tutarlarını Dosya Sorumlusu girer.' });
    if (!(await dosyaBelgesi(g.belge, t.dosya_ref))) return y.code(400).send({ hata: 'Eksper raporunu dosyaya yüklemenizi rica ederiz.' });
    if (!g.satirlar?.length || g.satirlar.some((x) => typeof x.tutar !== 'number' || !(x.tutar >= 0))) return y.code(400).send({ hata: 'Eksper tutarını girmenizi rica ederiz.' });
    return islem(async (c) => {
      const kl = (await c.query(`SELECT kimlik, sira_no FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik])).rows;
      for (const x of g.satirlar!) {
        const k = kl.find((r) => r.sira_no === x.sira);
        if (!k) throw Object.assign(new Error('Kalem bulunamadı.'), { statusCode: 400 });
        await c.query(`INSERT INTO eksper_karsilastirma (kalem_ref, teklif_ref, eksper_tutar_eur, eksper_notu, belge_ref, giren_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kalem_ref) DO UPDATE SET eksper_tutar_eur = EXCLUDED.eksper_tutar_eur, eksper_notu = EXCLUDED.eksper_notu, belge_ref = EXCLUDED.belge_ref, giren_ref = EXCLUDED.giren_ref, zaman = now()`, [k.kimlik, t.kimlik, x.tutar, x.not?.trim() || null, g.belge, o.kullanici]);
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Eksper Karşılaştırması', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { tamam: true };
    });
  });
  // YG-204: teknik gerekçesi olan onaylanmayan kalem için bir kez; K-241 ikili teyidiyle gider. Dışa giden metne teminat yazılmaz.
  s.post('/teklif/:id/yeniden-degerlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { siralar?: number[]; gerekce?: string };
    if (!t) return yok(y);
    if (!(await dsMi(t.dosya_ref, o.kullanici))) return y.code(403).send({ hata: 'Yeniden değerlendirmeyi Dosya Sorumlusu ister.' });
    if (t.teklif_muhatabi !== 'Sigorta Şirketi' || t.statu !== 'Karar' || !['Kısmi Onay', 'Ret'].includes(t.karar)) return y.code(409).send({ hata: 'Yeniden değerlendirme, kısmi onaylanan veya reddedilen sigorta tekliflerinde istenir.' });
    const gerekce = g.gerekce?.trim();
    if (!gerekce || !g.siralar?.length) return y.code(400).send({ hata: 'Kalemleri seçmenizi ve teknik gerekçeyi yazmanızı rica ederiz.' });
    if (/teminat|muafiyet|sigorta kapsam|poliçe kapsam/i.test(gerekce)) return y.code(400).send({ hata: 'Gerekçenin yalnız teknik bilgi içermesini rica ederiz.' });
    return islem(async (c) => {
      const kl = (await c.query(`SELECT kimlik, sira_no, aciklama, onay_durumu FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND sira_no = ANY($2::int[]) ORDER BY sira_no`, [t.kimlik, g.siralar])).rows;
      if (kl.length !== g.siralar!.length || kl.some((k) => k.onay_durumu !== 'Onaylanmadı')) throw Object.assign(new Error('Yalnız onaylanmayan kalemler için istenir.'), { statusCode: 400 });
      const once = await c.query(`SELECT 1 FROM yeniden_degerlendirme_kalemi m JOIN yeniden_degerlendirme r ON r.kimlik = m.talep_ref WHERE m.kalem_ref = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM sigorta_gonderim s WHERE s.tur = 'Yeniden Değerlendirme' AND s.nesne_kimligi = r.kimlik::text AND s.durum = 'İptal') LIMIT 1`, [kl.map((k) => k.kimlik)]);
      if (once.rowCount) throw Object.assign(new Error('Bu kalem için yeniden değerlendirme daha önce istenmiştir; bir kez istenir.'), { statusCode: 409 });
      const sg = (await c.query(`SELECT s.sigorta_hasar_dosya_no, p.eposta FROM dosya_sigorta_kaydi s LEFT JOIN dosya_tarafi p ON p.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1`, [t.dosya_ref])).rows[0];
      if (!sg?.eposta) throw Object.assign(new Error('Sigorta şirketinin e-posta adresi bekleniyor; dosya ayrıntısından girilmesini rica ederiz.'), { statusCode: 409 });
      const r = (await c.query(`INSERT INTO yeniden_degerlendirme (teklif_ref, dosya_ref, gerekce, talep_eden_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [t.kimlik, t.dosya_ref, gerekce, o.kullanici])).rows[0];
      for (const k of kl) await c.query(`INSERT INTO yeniden_degerlendirme_kalemi (talep_ref, kalem_ref) VALUES ($1,$2)`, [r.kimlik, k.kimlik]);
      const liste = kl.map((k) => `${k.sira_no}. ${k.aciklama}`).join('; ');
      const metin = dilKod(t.yazisma_dili) === 'en'
        ? `LİMİT GLOBAL MARINE: Regarding Price Quotation ${t.teklif_no} under file no. ${t.dosya_no} (claim no. ${sg.sigorta_hasar_dosya_no ?? '---'}), we kindly request your written re-evaluation of the items below, which were not approved, in light of the technical grounds stated.\nItems: ${liste}\nTechnical Grounds: ${gerekce}`
        : `LİMİT GLOBAL MARINE: ${t.dosya_no} numaralı dosyaya (hasar dosya no: ${sg.sigorta_hasar_dosya_no ?? '---'}) ilişkin ${t.teklif_no} numaralı Fiyat Teklifinde onaylanmayan aşağıdaki kalemleri, belirtilen teknik gerekçe doğrultusunda yazılı olarak yeniden değerlendirmenizi rica ederiz.\nKalemler: ${liste}\nTeknik Gerekçe: ${gerekce}`;
      const gonderim = await sigortayaHazirla(c, { dosya: t.dosya_ref, tur: 'Yeniden Değerlendirme', nesne: r.kimlik, alici: sg.eposta, konu: `${t.dosya_no} Yeniden Değerlendirme`, metin, acil: true, sorumlu: o.kullanici });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yeniden Değerlendirme Hazırlandı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { durum: 'Teyit Bekliyor', talep: r.kimlik, gonderim };
    });
  });
  s.post('/yeniden-degerlendirme/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { onaylananSiralar?: number[]; kanal?: string; yetkili?: string; belge?: string; gonderen?: string };
    if (!UUID.test(id)) return yok(y);
    const r0 = (await b.db.query(`SELECT teklif_ref FROM yeniden_degerlendirme WHERE kimlik = $1`, [id])).rows[0];
    const t = r0 && await teklifGetir(r0.teklif_ref, o.kullanici);
    if (!t) return yok(y);
    if (!(await dsMi(t.dosya_ref, o.kullanici))) return y.code(403).send({ hata: 'Sonucu Dosya Sorumlusu girer.' });
    if (!['YATONET 360', 'KEP', 'E-imza', 'Sözleşmede Tanımlı Kurumsal E-posta'].includes(g.kanal ?? '')) return y.code(400).send({ hata: 'Telefon ve WhatsApp onay kanalı sayılmaz; tanımlı kanalı seçmenizi rica ederiz.' }); // YG-218, YG-221
    if (!g.yetkili?.trim()) return y.code(400).send({ hata: 'Onaylayan yetkiliyi yazmanızı rica ederiz.' });
    if (g.kanal !== 'YATONET 360' && !(await dosyaBelgesi(g.belge, t.dosya_ref))) return y.code(400).send({ hata: 'Yanıt belgesini dosyaya yüklemenizi rica ederiz.' });
    return islem(async (c) => {
      const r = (await c.query(`SELECT * FROM yeniden_degerlendirme WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      if (r.durum !== 'Gönderildi') throw Object.assign(new Error('Bu talep sonuç beklemiyor.'), { statusCode: 409 });
      const istenen = (await c.query(`SELECT k.kimlik, k.sira_no FROM yeniden_degerlendirme_kalemi m JOIN fiyat_teklifi_kalemi k ON k.kimlik = m.kalem_ref WHERE m.talep_ref = $1`, [id])).rows;
      const on = g.onaylananSiralar ?? [];
      if (on.some((s) => !istenen.some((k) => k.sira_no === s))) throw Object.assign(new Error('Yalnız talepteki kalemler seçilebilir.'), { statusCode: 400 });
      for (const k of istenen) {
        const ok = on.includes(k.sira_no); const sonuc = ok ? 'Onaylandı' : 'Onaylanmadı';
        await c.query(`UPDATE yeniden_degerlendirme_kalemi SET sonuc = $3 WHERE talep_ref = $1 AND kalem_ref = $2`, [id, k.kimlik, sonuc]);
        await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = $2 WHERE kimlik = $1`, [k.kimlik, sonuc]);
      }
      const hepsi = (await c.query(`SELECT onay_durumu, tutar_eur FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik])).rows;
      const onayli = hepsi.filter((k) => k.onay_durumu === 'Onaylandı');
      const karar = onayli.length === hepsi.length ? 'Tam Onay' : onayli.length ? 'Kısmi Onay' : 'Ret';
      const tutarOnay = R2(onayli.reduce((a, k) => a + Number(k.tutar_eur), 0));
      if (g.kanal === KURUMSAL_EPOSTA) { const h = await ek2Engeli(c, t.dosya_ref, g.gonderen, tutarOnay, o.kullanici); if (h) throw Object.assign(new Error(h), { statusCode: g.gonderen ? 409 : 400 }); } // YG-219
      await c.query(`INSERT INTO sigorta_onayi (dosya_ref, teklif_ref, karar, onaylanan_tutar_eur, onay_kanali, onay_tarihi, onay_belgesi_ref, gonderen_eposta, onaylayan_yetkili, kaydi_yapan_ref) VALUES ($1,$2,$3,$4,$5,now(),$6,$9,$7,$8)`, [t.dosya_ref, t.kimlik, karar, tutarOnay, g.kanal, g.belge ?? null, g.yetkili!.trim(), o.kullanici, g.gonderen?.trim() || null]);
      await c.query(`UPDATE fiyat_teklifi SET karar = $2, karar_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik, karar]);
      if (karar === 'Tam Onay' || karar === 'Kısmi Onay') await (await import('./belge_uret.js')).sigortaOnayBelgesiUret(c, t.kimlik); // YG-1569
      await c.query(`UPDATE yeniden_degerlendirme SET durum = 'Sonuçlandı', sonuc_zamani = now(), sonuc_kanali = $2, sonuc_yetkili = $3, sonuc_belge_ref = $4 WHERE kimlik = $1`, [id, g.kanal, g.yetkili!.trim(), g.belge ?? null]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Yeniden Değerlendirme Yanıtı' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı'`, [id]);
      if (karar !== 'Ret' && t.dosya_statu === 'Aktif' && t.dosya_asama !== 'Uygulama') await statuYaz(c, { kimlik: t.dosya_ref, statu: 'Aktif', asama: t.dosya_asama }, { statu: 'Aktif', asama: 'Uygulama' }, `Yeniden değerlendirme: ${karar}`, o.kullanici, 'Operasyon Yöneticisi');
      const sahip = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [t.dosya_ref])).rows[0];
      if (sahip && karar === 'Tam Onay') await yatTarafinaYaz(c, { olay: `bld38:${t.kimlik}`, kod: 'BLD-38', dil: dilKod(t.yazisma_dili), konu: `${t.dosya_no} Bilgilendirme`, telefon: sahip.telefon, eposta: sahip.eposta, alanlar: { ...SIFIRLA_YAT(t), 'bağlantı': b.webAdresi, link: b.webAdresi } });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yeniden Değerlendirme Sonucu', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { karar, tutar: tutarOnay }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { karar, onaylananTutar: tutarOnay };
    });
  });

  // YG-193: revizyon yeni sürüm, önceki Yerine Geçti; toplam değişmesi tek başına gerekçe değildir.
  s.post('/teklif/:id/revizyon', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const { neden } = (i.body ?? {}) as { neden?: string };
    if (!t) return yok(y);
    if (t.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Revizyonu teklifi hazırlayan açar.' });
    if (!neden?.trim() || /^(tutar|toplam)/i.test(neden.trim())) return y.code(400).send({ hata: 'Revizyon nedeni zorunludur; toplam tutar değişikliğinin nedenini de açıklamanızı rica ederiz.' });
    if (t.statu === 'Yerine Geçti') return y.code(409).send({ hata: 'Bu sürüm yerine geçmiştir.' });
    return islem(async (c) => {
      const yeni = (await c.query(`INSERT INTO fiyat_teklifi (teklif_no, surum_no, onceki_surum_ref, teklif_turu, ana_teklif_ref, dosya_ref, cetvel_ref, revizyon_nedeni, teklif_muhatabi, teklif_dili, ara_toplam_eur, opsiyon_toplami_eur, kdv_orani, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, odeme_vadesi, fatura_bilgisi, hazirlayan_ref, bildirilen_sure_gun) SELECT teklif_no, surum_no + 1, kimlik, teklif_turu, ana_teklif_ref, dosya_ref, cetvel_ref, $2, teklif_muhatabi, teklif_dili, ara_toplam_eur, opsiyon_toplami_eur, kdv_orani, kdv_tutari_eur, ara_toplam_eur * (1 + kdv_orani / 100), ara_toplam_eur, odeme_vadesi, fatura_bilgisi, hazirlayan_ref, bildirilen_sure_gun FROM fiyat_teklifi WHERE kimlik = $1 RETURNING kimlik, surum_no`, [t.kimlik, neden.trim()])).rows[0];
      await c.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, satir_ref, kartela_kodu, kartela_surumu, kartela_disi, aciklama, isin_niteligi, bedel_turu, miktar, birim, firma_kalem_ref, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, bant_disi, opsiyon, tedarikci_kalem_ref) SELECT $2, sira_no, satir_ref, kartela_kodu, kartela_surumu, kartela_disi, aciklama, isin_niteligi, bedel_turu, miktar, birim, firma_kalem_ref, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, bant_disi, opsiyon, tedarikci_kalem_ref FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik, yeni.kimlik]);
      await c.query(`UPDATE fiyat_teklifi_kalemi n SET bant_alt_eur = e.bant_alt_eur, bant_ust_eur = e.bant_ust_eur FROM fiyat_teklifi_kalemi e WHERE n.teklif_ref = $1 AND e.teklif_ref = $2 AND e.sira_no = n.sira_no`, [yeni.kimlik, t.kimlik]); // YG-233
      await c.query(`UPDATE fiyat_teklifi SET statu = 'Yerine Geçti', guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
      await c.query(`INSERT INTO teklif_maddesi (teklif_ref, madde, tur, giren_ref) SELECT $1, madde, tur, giren_ref FROM teklif_maddesi WHERE teklif_ref = $2`, [yeni.kimlik, t.kimlik]); // YG-709
      await (await import('./resmi_onay.js')).resmiOnayKontrol(c, yeni.kimlik); // YG-1441
      await c.query(`UPDATE is_karti SET durum = 'Geçersiz', kapanma_zamani = now() WHERE tur = 'Fiyat Teklifi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [t.kimlik]);
      await c.query(`UPDATE onay_talebi SET durum = 'İptal' WHERE nesne_kimligi = $1 AND durum = 'Bekliyor'`, [t.kimlik]); // YG-156: içerik değişince önceki onay düşer.
      return { kimlik: yeni.kimlik, surum: yeni.surum_no };
    });
  });

  // YG-1450, YG-152: bireysel müşteri cayma; iade 14 gün içinde (BLD-47 Ticari modülünde).
  s.post('/teklif/:id/cayma', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici);
    if (!t) return yok(y);
    const k = (await b.db.query(`SELECT * FROM on_bilgilendirme_cayma_kaydi WHERE teklif_ref = $1`, [t.kimlik])).rows[0];
    if (!k) return y.code(409).send({ hata: 'Bu teklifte cayma kaydı yoktur.' });
    if (new Date(k.cayma_bitis) < new Date()) return y.code(409).send({ hata: 'Cayma süresi dolmuştur.' });
    if (k.cayma_zamani) return y.code(409).send({ hata: 'Cayma daha önce kaydedilmiştir.' });
    const gun = await parametre(b.db, 'cayma_gun');
    void gun; { const ka = await import('./kalan.js'); await ka.caymaIsle(b.db, k.kimlik, 'Dosya Sorumlusu Kaydı'); await ka.caymaGecKayit(b.db, k.kimlik, ((i.body ?? {}) as { beyanZamani?: string }).beyanZamani); } // YG-1493: WhatsApp beyanı dahil
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Cayma Kaydı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

}

/** YG-856: onaylanan kartela fiyat önerisi taslak sürüme yazılır; taslak yoksa bekler. */
async function kartelaOnerileriniIsle(c: Db, sur: string) {
  for (const o of (await c.query(`SELECT * FROM kartela_fiyat_onerisi WHERE durum = 'Taslak Bekliyor' ORDER BY olusturma_zamani`)).rows) {
    await c.query(`UPDATE kartela_kalemi SET maliyet_eur = $3, maliyet_tarihi = $4, kaynak_norm = $5 WHERE kod = $1 AND surum = $2`, [o.kod, sur, o.maliyet_eur, o.maliyet_tarihi, o.kaynak]);
    await c.query(`UPDATE kartela_fiyat_onerisi SET durum = 'Taslağa İşlendi', islenen_surum = $2 WHERE kimlik = $1`, [o.kimlik, sur]);
  }
}

kapanisKaydet('Kartela Fiyat Önerisi', async (c, k, karar) => {
  const o = (await c.query(`SELECT kimlik FROM kartela_fiyat_onerisi WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi])).rows[0];
  if (!o) return;
  if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') { await c.query(`UPDATE kartela_fiyat_onerisi SET durum = 'Reddedildi' WHERE kimlik = $1`, [o.kimlik]); return; }
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE kartela_fiyat_onerisi SET durum = 'Taslak Bekliyor' WHERE kimlik = $1`, [o.kimlik]);
  const sur = (await c.query(`SELECT surum FROM kartela_surumu WHERE durum = 'Taslak' ORDER BY surum DESC LIMIT 1`)).rows[0]?.surum as string | undefined;
  if (sur) await kartelaOnerileriniIsle(c, sur);
});
