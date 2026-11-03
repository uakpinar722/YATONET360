import { ekonomikIzle, yatDegeriEngeli } from './yat_degeri.js';
import { gonderimIsleyici, sigortayaHazirla } from './sigorta_gonderim.js';
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
import { metinGetir, tutar } from './metin.js';
import { kutuAyikla, onaySonucKaydet, onayTalebiAc } from './onay.js';
import { muvafakatKilidi } from './portal.js';
import { altNumara } from './sure.js';
import { UUID } from './yat.js';
import { bildir, disGonder } from './bildirim.js';

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
  const tatil = new Set((await db.query(`SELECT to_char(tarih, 'YYYY-MM-DD') t FROM resmi_tatil`)).rows.map((r) => r.t as string));
  const x = new Date(d.getTime()); let k = 0;
  while (k < gun) { x.setUTCDate(x.getUTCDate() + 1); const y = new Date(x.getTime() + 180 * 60_000); const g = y.getUTCDay(); if (g !== 0 && g !== 6 && !tatil.has(y.toISOString().slice(0, 10))) k++; }
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
  let i = sira.indexOf(son); let makam = son;
  while (i >= 0 && i < sira.length - 1 && !(await dolu(makam))) makam = sira[++i]!;
  z.push(await rolId(db, makam));
  return z;
}

/** YG-173: dosyadaki etkin (reddedilmemiş) tekliflerin KDV hariç toplamı. Ek teklif ve kısmi teklif de eklenir. */
export async function dosyaTaahhudu(db: Db, dosya: string, haric?: string): Promise<number> {
  return Number((await db.query(`SELECT coalesce(sum(onay_limit_tutari_eur), 0) t FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu IN ('İç Onayda', 'Onaylı', 'Gönderildi', 'Karar') AND coalesce(karar, '') NOT IN ('Ret', 'Süresi Doldu', 'Geri Çekildi') AND kimlik IS DISTINCT FROM $2`, [dosya, haric ?? null])).rows[0].t);
}

export interface KalemHesap { birimSatis: number; tutar: number; bantDisi: boolean; bant: { alt: number; ust: number } | null }

/** YG-185, YG-187, YG-232, YG-1709: satış fiyatı firma fiyatından kural ile yazılır, elle değişmez, yuvarlanmaz (2 hane). Bant yalnız kartelalı kalemde. */
export function kalemHesapla(firmaBirim: number, miktar: number, katsayi: number, bantOrani: number, kartelaMaliyet: number | null): KalemHesap {
  const birimSatis = R2(firmaBirim * katsayi);
  const bant = kartelaMaliyet === null ? null : { alt: R2(kartelaMaliyet * katsayi * (1 - bantOrani)), ust: R2(kartelaMaliyet * katsayi * (1 + bantOrani)) };
  return { birimSatis, tutar: R2(birimSatis * miktar), bantDisi: bant !== null && (birimSatis < bant.alt || birimSatis > bant.ust), bant };
}

/** YG-190: ara toplam, opsiyon, indirim, KDV ve genel toplam sistemce; KDV indirimli matrahtan. */
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

kapanisKaydet('Kapsam Cetveli', async (c, k, karar, yapan) => {
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE kapsam_cetveli SET durum = 'Yerine Geçti' WHERE dosya_ref = (SELECT dosya_ref FROM kapsam_cetveli WHERE kimlik = $1) AND durum = 'Onaylı'`, [k.nesne_kimligi]);
  await c.query(`UPDATE kapsam_cetveli SET durum = 'Onaylı', onaylayan_ref = $2, onay_zamani = now() WHERE kimlik = $1`, [k.nesne_kimligi, yapan]);
});

kapanisKaydet('Fiyat Teklifi', async (c, k, karar, yapan) => {
  const t = (await c.query(`SELECT kimlik, teklif_no, dosya_ref, hazirlayan_ref FROM fiyat_teklifi WHERE kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Onayla') {
    await c.query(`UPDATE fiyat_teklifi SET statu = 'Onaylı', son_onay_makami = (SELECT rol_adi FROM rol WHERE kimlik = (SELECT zincir[cardinality(zincir)] FROM is_karti WHERE tur = 'Fiyat Teklifi' AND nesne_kimligi = $1::text ORDER BY olusturma_zamani DESC LIMIT 1)), guncelleme_zamani = now() WHERE kimlik = $1::uuid`, [t.kimlik]);
    await izYaz(c, { aktor: yapan, eylem: 'Fiyat Teklifi İç Onay', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, sonuc: 'Başarılı' });
  } else if (karar === 'Reddet') await c.query(`UPDATE fiyat_teklifi SET statu = 'Reddedildi', guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
  else if (karar === 'Gerekçeyle İade Et') await c.query(`UPDATE fiyat_teklifi SET statu = 'Taslak', kilitli = false, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
});

/** YG-187: bant dışı kalem TİD'in gerekçeli onayı olmadan gönderilemez. */
kapanisKaydet('Bant Dışı Onayı', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') await c.query(`UPDATE fiyat_teklifi SET bant_disi_onay_ref = $2, bant_disi_gerekce = $3 WHERE kimlik = $1`, [k.nesne_kimligi, yapan, k.ozet]);
});

const SIFIRLA_YAT = (d: { dosya_no: string }) => ({ 'Dosya No': d.dosya_no, 'File No': d.dosya_no });

// YG-466: tek ekranda teklif, ön bilgilendirme ve sözleşme. YG-152, YG-468: cayma süresi; ikinci kutu erken ifa, varsayılanı Hayır.
onaySonucKaydet('ONY-23', async (c, t, karar, k) => {
  if (!t.nesne_kimligi) return;
  const ft = (await c.query(`SELECT f.*, d.statu AS d_statu, d.asama, d.dosya_no, d.musteri_turu, d.yazisma_dili FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [t.nesne_kimligi])).rows[0];
  if (karar !== 'Onaylandı') { await c.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = 'Ret', karar_zamani = $2 WHERE kimlik = $1`, [ft.kimlik, k.zaman]); return; }
  await c.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = 'Tam Onay', karar_zamani = $2 WHERE kimlik = $1`, [ft.kimlik, k.zaman]);
  await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = 'Onaylandı' WHERE teklif_ref = $1 AND NOT opsiyon`, [ft.kimlik]);
  if (ft.d_statu === 'Aktif' && ft.asama !== 'Uygulama') await statuYaz(c, { kimlik: ft.dosya_ref, statu: 'Aktif', asama: ft.asama }, { statu: 'Aktif', asama: 'Uygulama' }, 'Fiyat teklifi yat sahibince onaylandı', t.alici_kullanici_ref, 'Operasyon Yöneticisi');
  const gun = await parametre(c, 'cayma_gun');
  const bitis = new Date(k.zaman.getTime() + gun * 86_400_000);
  const erken = Object.entries(k.kutular).some(([ad, v]) => v && /Cayma süresi içinde/i.test(ad));
  if (ft.musteri_turu === 'Bireysel Müşteri') await c.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis, erken_ifa_onayi) VALUES ($1,$2,$3,$3,$4,$5) ON CONFLICT (teklif_ref) DO NOTHING`, [ft.kimlik, ft.dosya_ref, k.zaman, bitis, erken]);
});

// YG-205, BLD-41: sigortanın onaylamadığı kalemler için yat sahibi onayı.
onaySonucKaydet('ONY-26', async (c, t, karar, k) => {
  if (!t.nesne_kimligi) return;
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
gonderimIsleyici('Fiyat Teklifi', async (c, r) => {
  const t = (await c.query(`SELECT f.kimlik, f.statu, f.dosya_ref, d.dosya_no, d.yazisma_dili FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1 FOR UPDATE OF f`, [r.nesne_kimligi])).rows[0];
  if (t.statu !== 'Onaylı') throw Object.assign(new Error('Teklif gönderilebilir durumda değildir.'), { statusCode: 409 });
  const son = await isGunuSonu(c, new Date(), await parametre(c, 'sigorta_karar_is_gunu'));
  const bit = (await c.query(`UPDATE fiyat_teklifi SET statu = 'Gönderildi', gonderim_zamani = now(), sigorta_karar_son = $3, gecerlilik_bitis_tarihi = (now() AT TIME ZONE 'Europe/Istanbul')::date + $2::int, guncelleme_zamani = now() WHERE kimlik = $1 RETURNING gecerlilik_bitis_tarihi::text b`, [t.kimlik, await parametre(c, 'teklif_gecerlilik_gun'), son])).rows[0].b;
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
  s.get('/kartela/ara', oturumlu, async (i) => {
    const q = String((i.query as { q?: string }).q ?? '').trim();
    if (q.length < 2) return [];
    const sur = await yururlukSurumu(b.db);
    return (await b.db.query(`SELECT kod, ana_brans, tali_brans, islem, birim FROM kartela_kalemi WHERE surum = $1 AND (kod ILIKE $2 || '%' OR islem ILIKE '%' || $2 || '%') ORDER BY kod LIMIT 30`, [sur, q])).rows;
  });

  // YG-195, YG-198: cetveli Teknik Uzman hazırlar, Teknik Yönetici onaylar; bedel türü ve nitelik satırda seçilir.
  s.post('/dosya/:id/cetvel', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { satirlar?: { kod?: string; kartela?: string; aciklama?: string; nitelik?: string; bedel?: string; miktar?: number; birim?: string; bolge?: string; kabul?: string; gecici?: boolean }[]; dahilHaric?: string; varsayimlar?: string };
    const d = await dosyam(id, o.kullanici);
    if (!d) return yok(y);
    const ekip = (await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)') AND bitis_zamani IS NULL`, [id, o.kullanici])).rowCount;
    if (!ekip) return y.code(403).send({ hata: 'Kapsam ve metraj cetvelini Teknik Uzman hazırlar.' });
    if (!g.satirlar?.length) return y.code(400).send({ hata: 'En az bir satır giriniz.' });
    const sur = await yururlukSurumu(b.db);
    for (const [n, x] of g.satirlar.entries()) {
      if (!x.aciklama?.trim() || !(Number(x.miktar) > 0) || !x.birim?.trim()) return y.code(400).send({ hata: `${n + 1}. satırda açıklama, miktar ve birim zorunludur.` });
      if (!NITELIK.includes(x.nitelik ?? '')) return y.code(400).send({ hata: `${n + 1}. satırda işin niteliğini seçiniz.` });
      if (!BEDEL.includes(x.bedel ?? '')) return y.code(400).send({ hata: `${n + 1}. satırda bedel türünü seçiniz.` });
      if (x.nitelik === 'Yat Sahibi Talebi' && d.musteri_turu === 'Sigorta Şirketi') return y.code(400).send({ hata: 'Yat Sahibi Talebi niteliği yalnız yat sahibine hitaben teklifte seçilir.' });
      if (x.kartela && !(await b.db.query(`SELECT 1 FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [x.kartela, sur])).rowCount) return y.code(400).send({ hata: `${n + 1}. satırdaki kartela kodu bulunamadı: ${x.kartela}` });
    }
    return islem(async (c) => {
      const surum = (await c.query(`SELECT coalesce(max(surum), 0) + 1 n FROM kapsam_cetveli WHERE dosya_ref = $1`, [id])).rows[0].n;
      const t = (await c.query(`INSERT INTO kapsam_cetveli (dosya_ref, surum, durum, hazirlayan_ref, dahil_haric, varsayimlar) VALUES ($1,$2,'Onayda',$3,$4,$5) RETURNING kimlik`, [id, surum, o.kullanici, g.dahilHaric ?? null, g.varsayimlar ?? null])).rows[0];
      for (const [n, x] of g.satirlar!.entries()) await c.query(`INSERT INTO kapsam_satiri (cetvel_ref, satir_kodu, bolge_kodu, kartela_kodu, kartela_disi, aciklama, isin_niteligi, bedel_turu, miktar, birim, kabul_sinifi, gecici_onarim) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [t.kimlik, x.kod?.trim() || `S${String(n + 1).padStart(3, '0')}`, x.bolge ?? null, x.kartela ?? null, !x.kartela, x.aciklama!.trim(), x.nitelik, x.bedel, x.miktar, x.birim!.trim(), x.kabul ?? null, Boolean(x.gecici)]);
      await kartAc(c, { tur: 'Kapsam Cetveli', baslik: `${d.dosya_no} · Kapsam ve Metraj Cetveli Rev.${surum}`, ozet: `${g.satirlar!.length} satır`, hazirlayan: o.kullanici, zincir: [await rolId(c, 'Teknik Yönetici')], nesneTuru: 'Kapsam Cetveli', nesneKimligi: t.kimlik });
      return { kimlik: t.kimlik, surum };
    });
  });

  // YG-1599: teklif cetvelden ve firma fiyatlarından oluşur. YG-178: LGM teklifi tek belge.
  s.post('/dosya/:id/teklif', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { firmaTeklifi?: string; muhatap?: string; dil?: string; odemeVadesi?: string; faturaBilgisi?: string; ekTeklif?: string };
    const d = await dosyam(id, o.kullanici);
    if (!d) return yok(y);
    if (!(await roller(o.kullanici)).includes(TICARI)) return y.code(403).send({ hata: 'Müşteri teklifini Ticari Sorumlu hazırlar.' });
    if (d.statu !== 'Aktif') return y.code(409).send({ hata: 'Teklif yalnız Aktif dosyada hazırlanır.' });
    const muhatap = g.muhatap ?? (d.musteri_turu === 'Sigorta Şirketi' ? 'Sigorta Şirketi' : d.musteri_turu === 'Kurumsal Müşteri' ? 'Kurumsal Müşteri' : 'Yat Sahibi');
    if (!['Sigorta Şirketi', 'Yat Sahibi', 'Kurumsal Müşteri'].includes(muhatap)) return y.code(400).send({ hata: 'Muhatap geçersiz.' });
    const cetvel = (await b.db.query(`SELECT kimlik FROM kapsam_cetveli WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY surum DESC LIMIT 1`, [id])).rows[0];
    if (!cetvel) return y.code(409).send({ hata: 'Teklif için Onaylı kapsam cetveli bekleniyor.' });
    if (!g.firmaTeklifi || !UUID.test(g.firmaTeklifi)) return y.code(400).send({ hata: 'Firma fiyat teklifini seçiniz.' });
    const ft = (await b.db.query(`SELECT * FROM firma_fiyat_teklifi WHERE kimlik = $1 AND dosya_ref = $2 AND durum IN ('Gönderildi', 'Seçildi')`, [g.firmaTeklifi, id])).rows[0];
    if (!ft) return y.code(404).send({ hata: 'Firma teklifi bulunamadı.' });
    if (new Date(ft.gecerlilik) < new Date(new Date().toISOString().slice(0, 10))) return y.code(409).send({ hata: 'Firma teklifinin geçerliliği dolmuştur.' });
    const satirlar = (await b.db.query(`SELECT s.*, f.kimlik AS firma_kalem, f.birim_fiyat_eur FROM kapsam_satiri s LEFT JOIN firma_fiyat_kalemi f ON f.satir_ref = s.kimlik AND f.teklif_ref = $2 WHERE s.cetvel_ref = $1 ORDER BY s.satir_kodu`, [cetvel.kimlik, g.firmaTeklifi])).rows;
    const eksik = satirlar.filter((r) => r.firma_kalem === null);
    if (eksik.length) return y.code(409).send({ hata: `Firma fiyatı bekleyen kalem var: ${eksik.map((r) => r.satir_kodu).join(', ')}.`, eksik: eksik.map((r) => r.satir_kodu) });
    return islem(async (c) => {
      const [kat, bant, kdvO] = [await parametre(c, 'fiyat_katsayisi'), await parametre(c, 'bant_orani'), await parametre(c, 'kdv_orani')];
      const sur = await yururlukSurumu(c);
      const no = await altNumara(c, d.dosya_no, 'TK');
      const t = (await c.query(`INSERT INTO fiyat_teklifi (teklif_no, teklif_turu, ana_teklif_ref, dosya_ref, cetvel_ref, teklif_muhatabi, teklif_dili, kdv_orani, odeme_vadesi, fatura_bilgisi, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`,
        [no, g.ekTeklif ? 'Ek Fiyat Teklifi' : 'Fiyat Teklifi', g.ekTeklif || null, id, cetvel.kimlik, muhatap, d.yazisma_dili, kdvO, g.odemeVadesi ?? null, g.faturaBilgisi ?? null, o.kullanici])).rows[0];
      let n = 0; const hesap: { tutar_eur: number; opsiyon: boolean }[] = []; const kodlar: string[] = []; let bantDisi = 0;
      for (const r of satirlar) {
        const k = r.kartela_kodu ? (await c.query(`SELECT maliyet_eur FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [r.kartela_kodu, sur])).rows[0] : null;
        const h = kalemHesapla(Number(r.birim_fiyat_eur), Number(r.miktar), kat, bant, k ? Number(k.maliyet_eur) : null);
        if (h.bantDisi) bantDisi++;
        if (r.kartela_kodu) kodlar.push(r.kartela_kodu);
        hesap.push({ tutar_eur: h.tutar, opsiyon: false });
        await c.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, satir_ref, kartela_kodu, kartela_surumu, kartela_disi, aciklama, isin_niteligi, bedel_turu, miktar, birim, firma_kalem_ref, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, bant_disi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [t.kimlik, ++n, r.kimlik, r.kartela_kodu, r.kartela_kodu ? sur : null, r.kartela_disi, r.aciklama, r.isin_niteligi, r.bedel_turu, r.miktar, r.birim, r.firma_kalem, r.birim_fiyat_eur, h.birimSatis, h.tutar, h.bantDisi]);
      }
      const top = toplamlar(hesap, null, 0, kdvO);
      await c.query(`UPDATE fiyat_teklifi SET ara_toplam_eur = $2, kdv_tutari_eur = $3, genel_toplam_eur = $4, onay_limit_tutari_eur = $5 WHERE kimlik = $1`, [t.kimlik, top.ara, top.kdv, top.genel, top.matrah]);
      await c.query(`UPDATE firma_fiyat_teklifi SET durum = 'Seçildi' WHERE kimlik = $1`, [g.firmaTeklifi]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Fiyat Teklifi Hazırlandı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { no, toplam: top.ara }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: t.kimlik, teklifNo: no, araToplam: top.ara, genelToplam: top.genel, bantDisi, uyarilar: await kartelaUyarilari(c, kodlar) };
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
    return { ...t, kalemler: kalemler.map((k) => (maliyetGorur ? k : { ...k, birim_maliyet_eur: undefined, firma_kalem_ref: undefined })), uyarilar: await kartelaUyarilari(b.db, kalemler.map((k) => k.kartela_kodu).filter(Boolean)) };
  });

  s.get('/dosya/:id/teklifler', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const d = await dosyam(id, o.kullanici);
    if (!d) return yok(y);
    const cetveller = (await b.db.query(`SELECT c.kimlik, c.surum, c.durum, (SELECT count(*)::int FROM kapsam_satiri s WHERE s.cetvel_ref = c.kimlik) AS satir FROM kapsam_cetveli c WHERE c.dosya_ref = $1 ORDER BY c.surum DESC`, [id])).rows;
    const teklifler = (await b.db.query(`SELECT kimlik, teklif_no, surum_no, teklif_turu, statu, karar, ara_toplam_eur, genel_toplam_eur, gecerlilik_bitis_tarihi::text, teklif_muhatabi FROM fiyat_teklifi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`, [id])).rows;
    const firma = (await b.db.query(`SELECT f.kimlik, f.teklif_no, f.durum, f.toplam_eur, f.gecerlilik::text FROM firma_fiyat_teklifi f WHERE f.dosya_ref = $1 ORDER BY f.olusturma_zamani DESC`, [id])).rows;
    const isEmirleri = (await b.db.query(`SELECT e.kimlik, e.is_emri_no, e.is_emri_turu, e.statu, e.firma_yaniti, e.ana_is_emri_ref, u.ticari_unvan AS firma FROM is_emri e JOIN kurulus u ON u.kimlik = e.kurulus_ref WHERE e.dosya_ref = $1 ORDER BY e.olusturma_zamani`, [id])).rows;
    return { cetveller, teklifler, firma, isEmirleri };
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
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teklif İndirimi', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { oran: g.oran, tutar: top.ind }, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { indirim: top.ind, genelToplam: top.genel };
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
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { aciklama?: string; nitelik?: string; tutar?: number; belge?: string };
    if (!t) return yok(y);
    if (t.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Masraf kalemini teklifi hazırlayan ekler.' });
    if (t.statu !== 'Taslak') return y.code(409).send({ hata: 'Masraf kalemi taslak teklife eklenir.' });
    if (!g.aciklama?.trim() || !(Number(g.tutar) > 0)) return y.code(400).send({ hata: 'Açıklama ve tutarı yazmanızı rica ederiz.' });
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Tesis teklifi veya tarife belgesini eklemenizi rica ederiz.' });
    return islem(async (c) => {
      const tutarE = R2(Number(g.tutar));
      const sira = (await c.query(`SELECT coalesce(max(sira_no), 0) + 1 n FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik])).rows[0].n;
      await c.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, bant_disi) VALUES ($1,$2,$3,$4,'Masraf',1,'adet',$5,$5,$5,false)`, [t.kimlik, sira, g.aciklama!.trim(), g.nitelik ?? 'Onarım', tutarE]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teklife Masraf Eklendi', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { aciklama: g.aciklama, tutar: tutarE, belge: g.belge }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      const kl = (await c.query(`SELECT tutar_eur, opsiyon FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik])).rows;
      const top = toplamlar(kl, t.indirim_orani === null ? null : Number(t.indirim_orani), Number(t.kesif_mahsubu_eur), Number(t.kdv_orani));
      await c.query(`UPDATE fiyat_teklifi SET ara_toplam_eur = $2, indirim_tutari_eur = $3, kdv_tutari_eur = $4, genel_toplam_eur = $5, onay_limit_tutari_eur = $6, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik, top.ara, top.ind, top.kdv, top.genel, top.matrah]);
      return { sira, araToplam: top.ara, genelToplam: top.genel };
    });
  });

  // YG-212: ek teklif önceki onaylı toplam, bu ek ve yeni toplamı gösterir.
  s.get('/teklif/:id/ek-ozet', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici);
    if (!t) return yok(y);
    const once = Number((await b.db.query(`SELECT coalesce(sum(genel_toplam_eur), 0) n FROM fiyat_teklifi WHERE dosya_ref = $1 AND kimlik <> $2 AND statu = 'Karar' AND karar IN ('Tam Onay', 'Kısmi Onay', 'Koşullu Onay')`, [t.dosya_ref, t.kimlik])).rows[0].n);
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
    if ((await b.db.query(`SELECT 1 FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND bant_disi LIMIT 1`, [t.kimlik])).rowCount && !t.bant_disi_onay_ref) return y.code(409).send({ hata: 'Bant dışı kalem için Ticari İşler Direktörünün gerekçeli onayı gereklidir.' });
    if ((await b.db.query(`SELECT 1 FROM yat WHERE kimlik = $1 AND gecici_kayit`, [t.yat_ref])).rowCount) return y.code(409).send({ hata: 'Teklif için önce Geçici yat kaydını doğrulamanızı rica ederiz.' });
    if (t.teklif_muhatabi === 'Sigorta Şirketi') {
      const sg = (await b.db.query(`SELECT sigorta_hasar_dosya_no, cerceve_sozlesme_yok FROM dosya_sigorta_kaydi WHERE dosya_ref = $1`, [t.dosya_ref])).rows[0];
      if (!sg?.sigorta_hasar_dosya_no) return y.code(409).send({ hata: 'Gönderim için Sigorta hasar dosya numarası bekleniyor.' }); // YG-101
      if (sg.cerceve_sozlesme_yok && (!t.odeme_vadesi || !t.fatura_bilgisi)) return y.code(409).send({ hata: 'Çerçeve sözleşmesi olmayan dosyada ödeme vadesi ve fatura bilgisi zorunludur.' }); // YG-1552
    }
    const kum = (await dosyaTaahhudu(b.db, t.dosya_ref, t.kimlik)) + Number(t.onay_limit_tutari_eur);
    const son = await sonMakam(b.db, kum);
    return islem(async (c) => {
      const zincir = await parasalZincir(c, ARA, son);
      await c.query(`UPDATE fiyat_teklifi SET statu = 'İç Onayda', kilitli = true, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
      await ekonomikIzle(c, t.dosya_ref, kum);
      await kartAc(c, { tur: 'Fiyat Teklifi', oncelik: t.oncelik, baslik: `${t.teklif_no} · Fiyat Teklifi Onayı`, ozet: `${tutar(Number(t.onay_limit_tutari_eur))} EUR (KDV hariç)`, hazirlayan: o.kullanici, zincir, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teklif Onaya Gönderildi', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { kumulatif: kum, sonMakam: son }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { sonMakam: son, kumulatif: kum };
    });
  });

  // YG-191: geçerlilik 15 gün, gönderimden başlar. Sigortalıda BLD-71 + BLD-37; bireyselde ONY-23 (YG-466), muvafakat kilidi (YG-103).
  s.post('/teklif/:id/gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici);
    if (!t) return yok(y);
    if (t.statu !== 'Onaylı') return y.code(409).send({ hata: 'Teklif iç onaydan geçmemiştir.' });
    if (t.vefat_isareti) return y.code(409).send({ hata: 'Vefat işaretli dosyada teklif gönderimi bekletilmektedir.' });
    const yde = await yatDegeriEngeli(b.db, t.dosya_ref); if (yde) return y.code(409).send({ hata: yde });
    const dil = dilKod(t.yazisma_dili);
    if (t.teklif_muhatabi !== 'Sigorta Şirketi' && await muvafakatKilidi(b.db, t.dosya_ref)) return y.code(409).send({ hata: 'Teklif onayı için Lehtar muvafakati bekleniyor.' });
    const gun = await parametre(b.db, 'teklif_gecerlilik_gun');
    // K-241: sigortaya giden teklif ikinci teyide kadar gönderilmiş sayılmaz; portala düşmez, süre başlamaz.
    if (t.teklif_muhatabi === 'Sigorta Şirketi') return islem(async (c) => {
      const sg = (await c.query(`SELECT s.sigorta_hasar_dosya_no, p.eposta FROM dosya_sigorta_kaydi s LEFT JOIN dosya_tarafi p ON p.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1`, [t.dosya_ref])).rows[0];
      const son = await isGunuSonu(c, new Date(), await parametre(c, 'sigorta_karar_is_gunu'));
      const gonderim = await sigortayaHazirla(c, { dosya: t.dosya_ref, tur: 'Fiyat Teklifi', nesne: t.kimlik, alici: sg?.eposta ?? null, konu: `${t.dosya_no} Teklif`, metin: await bld71(c, t, sg, son), acil: true, sorumlu: o.kullanici });
      return { durum: 'Teyit Bekliyor', gonderim };
    });
    return islem(async (c) => {
      const bit = (await c.query(`UPDATE fiyat_teklifi SET statu = 'Gönderildi', gonderim_zamani = now(), gecerlilik_bitis_tarihi = (now() AT TIME ZONE 'Europe/Istanbul')::date + $2::int, guncelleme_zamani = now() WHERE kimlik = $1 RETURNING gecerlilik_bitis_tarihi::text b`, [t.kimlik, gun])).rows[0].b;
      const sahip = (await c.query(`SELECT kimlik, kisi_adi_soyadi, telefon, eposta, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [t.dosya_ref])).rows[0];
      const alan = { ...SIFIRLA_YAT(t), 'bağlantı': b.webAdresi, link: b.webAdresi };
      if (!sahip) throw Object.assign(new Error('Yat sahibinin iletişim bilgisi kayıtlı değildir.'), { statusCode: 409 });
      const s0 = (await c.query(`SELECT metin FROM sablon_metni WHERE kod = 'ONY-23' AND dil = $1 AND durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`, [dil])).rows[0];
      const { kutular } = kutuAyikla(s0.metin);
      const toplam = tutar(Number(t.genel_toplam_eur), dil);
      const bag = { ...alan, 'Teklif No / Sürüm': `${t.teklif_no} Rev.${t.surum_no}`, 'Quotation No / Version': `${t.teklif_no} Rev.${t.surum_no}`, tutar: toplam, amount: toplam };
      await belgeUret(c, { tur: 'Fiyat Teklifi', nesne: t.kimlik, dosya: t.dosya_ref });
      await onayTalebiAc(c, { dosya: t.dosya_ref, ony: 'ONY-23', dil, alanlar: bag, baslikAlanlari: SIFIRLA_YAT(t), kutular: kutular.map((k, n) => ({ ad: k, zorunlu: n === 0 })), tutar: Number(t.genel_toplam_eur), taraf: sahip.kimlik, kullanici: sahip.kullanici_ref, aliciAd: sahip.kisi_adi_soyadi, telefon: sahip.telefon, eposta: sahip.eposta, belgeAdi: `Fiyat Teklifi ${t.teklif_no}`, hazirlayan: o.kullanici, sigortaHatirlat: t.teklif_muhatabi === 'Yat Sahibi' || t.teklif_muhatabi === 'Kurumsal Müşteri', webAdresi: b.webAdresi, gun, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
      return { durum: 'Gönderildi', gecerlilik: bit };
    });
  });

  // YG-205, YG-219, YG-1464: sigorta kararı; kanal yalnız tanımlı kanallar. Kısmi onayda kalem silinmez, işaretlenir; onaylanmayanlardan yat sahibine ayrı teklif. Sonuç BLD-38 / BLD-39.
  s.post('/teklif/:id/sigorta-karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici);
    const g = (i.body ?? {}) as { karar?: string; kanal?: string; yetkili?: string; belge?: string; onaylananSiralar?: number[] };
    if (!t) return yok(y);
    if (t.teklif_muhatabi !== 'Sigorta Şirketi' || t.statu !== 'Gönderildi') return y.code(409).send({ hata: 'Sigorta kararı gönderilmiş tekliflere girilir.' });
    if (!['Tam Onay', 'Kısmi Onay', 'Ret', 'Revizyon İstendi'].includes(g.karar ?? '')) return y.code(400).send({ hata: 'Kararı seçiniz.' });
    if (!['YATONET 360', 'KEP', 'E-imza', 'Sözleşmede Tanımlı Kurumsal E-posta'].includes(g.kanal ?? '')) return y.code(400).send({ hata: 'Telefon ve WhatsApp onay kanalı sayılmaz; tanımlı kanalı seçiniz.' }); // YG-218, YG-221
    if (!g.yetkili?.trim()) return y.code(400).send({ hata: 'Onaylayan yetkiliyi yazınız.' });
    if (g.kanal !== 'YATONET 360' && !g.belge) return y.code(400).send({ hata: 'Onay belgesini dosyaya yükleyip seçiniz.' });
    if (g.karar === 'Kısmi Onay' && !g.onaylananSiralar?.length) return y.code(400).send({ hata: 'Onaylanan kalemleri seçiniz.' });
    const dil = dilKod(t.yazisma_dili);
    return islem(async (c) => {
      const kalemler = (await c.query(`SELECT * FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [t.kimlik])).rows;
      const onayli = g.karar === 'Tam Onay' ? kalemler.map((k) => k.sira_no as number) : g.karar === 'Kısmi Onay' ? g.onaylananSiralar! : [];
      for (const k of kalemler) await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = $2 WHERE kimlik = $1`, [k.kimlik, onayli.includes(k.sira_no) ? 'Onaylandı' : 'Onaylanmadı']);
      const tutarOnay = R2(kalemler.filter((k) => onayli.includes(k.sira_no)).reduce((a, k) => a + Number(k.tutar_eur), 0));
      await c.query(`INSERT INTO sigorta_onayi (dosya_ref, teklif_ref, karar, onaylanan_tutar_eur, onay_kanali, onay_tarihi, onay_belgesi_ref, onaylayan_yetkili, kaydi_yapan_ref) VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8)`, [t.dosya_ref, t.kimlik, g.karar, tutarOnay, g.kanal, g.belge ?? null, g.yetkili!.trim(), o.kullanici]);
      await c.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = $2, karar_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik, g.karar]);
      if (g.karar === 'Tam Onay' || g.karar === 'Kısmi Onay') {
        if (t.dosya_statu === 'Aktif' && t.dosya_asama !== 'Uygulama') await statuYaz(c, { kimlik: t.dosya_ref, statu: 'Aktif', asama: t.dosya_asama }, { statu: 'Aktif', asama: 'Uygulama' }, `Sigorta kararı: ${g.karar}`, o.kullanici, 'Operasyon Yöneticisi');
      }
      const sahip = (await c.query(`SELECT kimlik, kisi_adi_soyadi, telefon, eposta, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [t.dosya_ref])).rows[0];
      const alan = { ...SIFIRLA_YAT(t), 'bağlantı': b.webAdresi, link: b.webAdresi };
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

  // YG-193: revizyon yeni sürüm, önceki Yerine Geçti; toplam değişmesi tek başına gerekçe değildir.
  s.post('/teklif/:id/revizyon', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const { neden } = (i.body ?? {}) as { neden?: string };
    if (!t) return yok(y);
    if (t.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Revizyonu teklifi hazırlayan açar.' });
    if (!neden?.trim() || /^(tutar|toplam)/i.test(neden.trim())) return y.code(400).send({ hata: 'Revizyon nedeni zorunludur; yalnız toplam tutar değişikliği gerekçe sayılmaz.' });
    if (t.statu === 'Yerine Geçti') return y.code(409).send({ hata: 'Bu sürüm yerine geçmiştir.' });
    return islem(async (c) => {
      const yeni = (await c.query(`INSERT INTO fiyat_teklifi (teklif_no, surum_no, onceki_surum_ref, teklif_turu, ana_teklif_ref, dosya_ref, cetvel_ref, revizyon_nedeni, teklif_muhatabi, teklif_dili, ara_toplam_eur, opsiyon_toplami_eur, kdv_orani, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, odeme_vadesi, fatura_bilgisi, hazirlayan_ref) SELECT teklif_no, surum_no + 1, kimlik, teklif_turu, ana_teklif_ref, dosya_ref, cetvel_ref, $2, teklif_muhatabi, teklif_dili, ara_toplam_eur, opsiyon_toplami_eur, kdv_orani, kdv_tutari_eur, ara_toplam_eur * (1 + kdv_orani / 100), ara_toplam_eur, odeme_vadesi, fatura_bilgisi, hazirlayan_ref FROM fiyat_teklifi WHERE kimlik = $1 RETURNING kimlik, surum_no`, [t.kimlik, neden.trim()])).rows[0];
      await c.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, satir_ref, kartela_kodu, kartela_surumu, kartela_disi, aciklama, isin_niteligi, bedel_turu, miktar, birim, firma_kalem_ref, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, bant_disi, opsiyon) SELECT $2, sira_no, satir_ref, kartela_kodu, kartela_surumu, kartela_disi, aciklama, isin_niteligi, bedel_turu, miktar, birim, firma_kalem_ref, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, bant_disi, opsiyon FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik, yeni.kimlik]);
      await c.query(`UPDATE fiyat_teklifi SET statu = 'Yerine Geçti', guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
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
    await b.db.query(`UPDATE on_bilgilendirme_cayma_kaydi SET cayma_zamani = now(), iade_son_tarihi = (now() AT TIME ZONE 'Europe/Istanbul')::date + $2::int WHERE kimlik = $1`, [k.kimlik, gun]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Cayma Kaydı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

}
