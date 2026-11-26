import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { belgeBagiKaydet } from './belge.js';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { ONCELIK_SIRA, dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { DURAK_SN, altNumara, sureBaslat, sureBitir, sureRengi } from './sure.js';
import { surumCakismasi } from './surum.js';
import { UUID, maskeTckn } from './yat.js';
import { izinGerekli, kullaniciIzinleri } from './yetki.js';

type Db = Pool | PoolClient;
const AKTIF_STATU = ['Açılış Kontrolünde', 'Aktif', 'Kontrollü Askıda'];
const ASAMALAR = ['Keşif', 'Teklif', 'Onay', 'Uygulama', 'Kontrol', 'Teslim'];

/** Atanacak ekip rolü → kişinin taşıması gereken rol ve atama izni (YG-047, YG-048, YG-050). */
const EKIP: Record<string, { rol: string; izin: string; tekil: boolean }> = {
  'Dosya Sorumlusu': { rol: 'Dosya Sorumlusu', izin: 'dosya.ata.operasyon', tekil: true },
  'Yedek Sorumlu': { rol: 'Dosya Sorumlusu', izin: 'dosya.ata.operasyon', tekil: true },
  'Operasyon Yöneticisi': { rol: 'Operasyon Yöneticisi', izin: 'dosya.ata.operasyon', tekil: true },
  'Teknik Uzman': { rol: 'Teknik Uzman', izin: 'dosya.ata.teknik', tekil: false },
  'Sorumlu Teknik Uzman (Koordinatör)': { rol: 'Teknik Uzman', izin: 'dosya.ata.teknik', tekil: true },
  'Teknik Yönetici': { rol: 'Teknik Yönetici', izin: 'dosya.ata.teknik', tekil: true },
  'Saha Sorumlusu': { rol: 'Saha Sorumlusu', izin: 'dosya.ata.teknik', tekil: true },
  'Kalite Kontrolör': { rol: 'Kalite Uzmanı (Kalite Kontrolör)', izin: 'dosya.ata.kalite', tekil: true },
  'Yedek Kalite Kontrolör': { rol: 'Kalite Uzmanı (Kalite Kontrolör)', izin: 'dosya.ata.kalite', tekil: true }, // YG-1687
  'Tedarik Sorumlusu': { rol: 'Tedarik Sorumlusu', izin: 'dosya.ata.tedarik', tekil: true },
};
/** YG-146, YG-958: kapasite eşikleri; Saha Sorumlusunda dosya sayısı, diğerlerinde zorluk katsayıları toplamı. */
export const KAPASITE: Record<string, number> = { 'Dosya Sorumlusu': 25, 'Teknik Uzman': 15, 'Sorumlu Teknik Uzman (Koordinatör)': 15, 'Saha Sorumlusu': 3 };
const KAPASITE_GRUP: Record<string, string[]> = { 'Dosya Sorumlusu': ['Dosya Sorumlusu'], 'Teknik Uzman': ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)'], 'Sorumlu Teknik Uzman (Koordinatör)': ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)'], 'Saha Sorumlusu': ['Saha Sorumlusu'] };

export async function kapasiteYuku(db: Db, kullanici: string, rol: string): Promise<number> {
  const grup = KAPASITE_GRUP[rol]; if (!grup) return 0;
  const { rows } = await db.query(
    rol === 'Saha Sorumlusu'
      ? `SELECT count(DISTINCT d.kimlik)::numeric y FROM dosya_ekibi_atamasi a JOIN dosya d ON d.kimlik = a.dosya_ref WHERE a.kullanici_ref = $1 AND a.rol = ANY($2) AND a.bitis_zamani IS NULL AND d.statu = ANY($3)`
      : `SELECT coalesce(sum(z.k), 0) y FROM (SELECT DISTINCT d.kimlik, d.zorluk_katsayisi k FROM dosya_ekibi_atamasi a JOIN dosya d ON d.kimlik = a.dosya_ref WHERE a.kullanici_ref = $1 AND a.rol = ANY($2) AND a.bitis_zamani IS NULL AND d.statu = ANY($3)) z`, [kullanici, grup, AKTIF_STATU]);
  return Number(rows[0].y);
}

/** Dosya ekibi ve dosya.tum izni dosyayı görür (LST_ERISIM_SEVIYESI: bilmesi gereken ilkesi). */
export async function dosyaErisimi(db: Db, kullanici: string, id: string): Promise<boolean> {
  if ((await kullaniciIzinleri(db as Pool, kullanici)).includes('dosya.tum')) return true;
  // YG-995: onaylı, süresi dolmamış dosya bazlı ek erişim.
  if ((await db.query(`SELECT 1 FROM dosya_ek_yetki WHERE dosya_ref::text = $1 AND kullanici_ref = $2 AND durum = 'Aktif' AND bitis > now()`, [id, kullanici])).rowCount) return true;
  // YG-1056: vekil, vekâlet süresince asılın atandığı dosyalara erişir; vekâlet bitince erişim kendiliğinden kapanır.
  return Boolean((await db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL AND (kullanici_ref = $2 OR kullanici_ref IN (SELECT v.asil_ref FROM vekalet v WHERE v.vekil_ref = $2 AND v.durum = 'Aktif' AND v.baslangic_tarihi <= current_date AND v.bitis_tarihi >= current_date)) LIMIT 1`, [id, kullanici])).rowCount);
}

belgeBagiKaydet('Dosya', async (db, k, id) => {
  if (!UUID.test(id) || !(await db.query(`SELECT 1 FROM dosya WHERE kimlik = $1`, [id])).rowCount) return 'yok';
  return (await dosyaErisimi(db, k, id)) ? 'tamam' : 'yetkisiz';
});

export async function statuYaz(c: Db, d: { kimlik: string; statu: string; asama: string | null }, yeni: { statu: string; asama: string | null }, gerekce: string, yapan: string | null, sonrakiRol?: string) {
  await c.query(`UPDATE dosya SET statu = $2, asama = $3, guncelleme_zamani = now() WHERE kimlik = $1`, [d.kimlik, yeni.statu, yeni.asama]);
  if (yeni.statu === 'Kapalı' && d.statu !== 'Kapalı') await (await import('./firma_ek.js')).dosyaKapanisIsleri(c, d.kimlik); // YG-312, YG-416
  await c.query(`INSERT INTO dosya_statu_gecmisi (dosya_ref, onceki_statu, onceki_asama, yeni_statu, yeni_asama, gerekce, sonraki_sorumlu_rol, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [d.kimlik, d.statu, d.asama, yeni.statu, yeni.asama, gerekce, sonrakiRol ?? null, yapan]);
}

const kartKapat = (c: Db, tur: string, nesne: string) => c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [tur, nesne]);

/** YG-047, YG-048, YG-049: Dosya Sorumlusu, Operasyon Yöneticisi, Teknik Uzman ve Teknik Yönetici atanınca dosya Aktif olur ve keşif aşamasına geçer. */
async function aktifeGecir(c: PoolClient, id: string, yapan: string) {
  const d = (await c.query(`SELECT kimlik, statu, asama, oncelik, dosya_no, hasar_ilerleyebilir, yurt_disi, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0];
  if (d.statu !== 'Açılış Kontrolünde') return;
  const ekip = new Set((await c.query(`SELECT rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL`, [id])).rows.map((r) => r.rol as string));
  if (!['Dosya Sorumlusu', 'Operasyon Yöneticisi', 'Teknik Yönetici'].every((r) => ekip.has(r)) || !(ekip.has('Teknik Uzman') || ekip.has('Sorumlu Teknik Uzman (Koordinatör)'))) return;
  await statuYaz(c, d, { statu: 'Aktif', asama: 'Keşif' }, 'Dosya ekibi tamamlandı', yapan, 'Dosya Sorumlusu');
  // YG-1486: yurt dışında randevu sayacı ulaşım planı tarihinden başlar; Dosya Sorumlusuna plan görevi açılır.
  if (!d.yurt_disi) await sureBaslat(c, { tur: 'Randevu İletişimi', oncelik: d.oncelik, baslangic: new Date(), dosya: id });
  else if (d.dosya_sorumlusu_ref) await kartAc(c, { tur: 'Ulaşım Planı', kategori: 'gorev', baslik: `${d.dosya_no} · Ulaşım Planı`, ozet: 'Yurt dışı dosyada randevu sayacı ulaşım planı tarihinden başlar; planı giriniz.', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: id });
  if (d.oncelik !== 'Kritik') await (await import('./kesif_talebi.js')).kesifTalebiHazirla(c, id, d.dosya_no); // YG-1597
  else await (await import('./acil_degerlendirme.js')).acilDegerlendirmeGorevi(c, id, d.dosya_no); // YG-1483
  // YG-1596: hasar ilerleyebilir işaretli Yüksek dosyada Teknik Uzman ilk yanıtta görüntülü değerlendirme yapar.
  if (d.hasar_ilerleyebilir && d.oncelik === 'Yüksek') {
    const tu = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol IN ('Teknik Uzman','Sorumlu Teknik Uzman (Koordinatör)') AND bitis_zamani IS NULL LIMIT 1`, [id])).rows[0];
    await kartAc(c, { tur: 'Görüntülü Değerlendirme', kategori: 'gorev', baslik: `${d.dosya_no} · Görüntülü Değerlendirme`, ozet: 'Hasar ilerleyebilir; keşfi beklemeden değerlendiriniz.', oncelik: 'Yüksek', sahipKullanici: tu.kullanici_ref, nesneTuru: 'Dosya', nesneKimligi: id });
  }
}

/** YG-1530: Kritik ve Yüksek dışında boy ve gövde malzemesi dolmadan Teknik Uzman atanmaz. */
async function boyGovdeEksik(db: Db, id: string): Promise<boolean> {
  const r = (await db.query(`SELECT d.oncelik, y.tam_boy_m, y.govde_malzemesi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [id])).rows[0];
  if (['Kritik', 'Yüksek'].includes(r.oncelik)) return false;
  return r.tam_boy_m === null || !r.govde_malzemesi || r.govde_malzemesi === 'Bilinmiyor';
}

/** YG-050: Saha Sorumlusunu zorunlu kılan durumlar; boş liste zorunluluk yok demektir. Teknik Müdürlük talebi ayrı akıştadır (saha-sorumlusu-talebi). */
export async function sahaSorumlusuGerekceleri(db: Db, dosya: string): Promise<string[]> {
  const d = (await db.query(`SELECT oncelik FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]; if (!d) return [];
  const e = (await db.query(`SELECT count(DISTINCT kurulus_ref)::int firma, coalesce(sum(firma_bedeli_eur), 0)::float bedel, string_agg(coalesce(kapsam, ''), ' ') kapsam FROM is_emri WHERE dosya_ref = $1 AND is_emri_turu IN ('AC', 'ON', 'EK', 'GR') AND statu NOT IN ('Taslak', 'İptal', 'Yerine Geçti', 'Kapalı')`, [dosya])).rows[0];
  const l: string[] = [];
  if (d.oncelik === 'Kritik') l.push('Kritik Öncelik');
  if (e.firma >= 2) l.push('Aynı Sahada Birden Fazla Firma');
  if (/karaya al|çekek|cekek/i.test(e.kapsam ?? '')) l.push('Karaya Alma veya Çekek');
  if (e.bedel > 5000) l.push('5.000,00 EUR Üzerinde İş');
  if ((await import('./uyum.js')).isEmriUyumOlaylari(e.kapsam ?? '').length) l.push('Yüksek Riskli Çalışma');
  return l;
}

/** YG-050: zorunlu durumda Saha Sorumlusu yoksa Teknik Müdüre (yokluğunda vekiline) gerekçeli atama görevi bir kez açılır. */
export async function sahaSorumlusuIhtiyacIsle(db: Pool): Promise<number> {
  let n = 0;
  for (const d of (await db.query(`SELECT d.kimlik, d.dosya_no, d.oncelik FROM dosya d WHERE d.statu NOT IN ('Kapalı', 'Teknik Kapalı') AND NOT EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.rol = 'Saha Sorumlusu' AND a.bitis_zamani IS NULL)
      AND EXISTS (SELECT 1 FROM is_emri e WHERE e.dosya_ref = d.kimlik AND e.statu NOT IN ('Taslak', 'İptal', 'Yerine Geçti', 'Kapalı'))`)).rows) {
    const g = await sahaSorumlusuGerekceleri(db, d.kimlik); if (!g.length) continue;
    if (!(await birKez(db, 'saha_sorumlusu_ihtiyac', d.kimlik))) continue;
    const { kartAc } = await import('./is_motoru.js');
    await kartAc(db, { tur: 'Saha Sorumlusu Ataması', kategori: 'gorev', baslik: `${d.dosya_no} · Saha Sorumlusunu Ata`, ozet: `Zorunlu: ${g.join(', ')}`, oncelik: d.oncelik, sahipRol: await rolId(db, 'Teknik Müdür'), nesneTuru: 'Dosya', nesneKimligi: d.kimlik }); n++;
  }
  return n;
}

/** YG-064: dosya ekranındaki yapılacaklar; sıradaki işlem, sorumlu ve eksik kayıtlar. Tamamlandıkça sonraki adım kendiliğinden açılır. */
/** YG-1757: dosya açılışında yat sahibinin cep telefonuyla parolasız portal hesabı açılır (giriş telefon + SMS kodu); numarada yat sahibi hesabı varsa yalnız bağlanır. */
export async function yatSahibiHesabi(c: PoolClient, dosya: string): Promise<string | null> {
  const t = (await c.query(`SELECT x.kimlik, x.taraf_ref, x.kisi_adi_soyadi, x.telefon, x.eposta, x.kullanici_ref, d.yazisma_dili FROM dosya_tarafi x JOIN dosya d ON d.kimlik = x.dosya_ref WHERE x.dosya_ref = $1 AND x.taraf_rolu = 'Yat Sahibi' AND x.aktif AND x.telefon IS NOT NULL ORDER BY x.olusturma_zamani LIMIT 1`, [dosya])).rows[0];
  if (!t || t.kullanici_ref) return t?.kullanici_ref ?? null;
  const { kimlikNormalle } = await import('./kimlik.js'); const { GRUP_YAT } = await import('./portal.js');
  const tel = kimlikNormalle(t.telefon).telefon; if (!tel) return null;
  const var_ = (await c.query(`SELECT kimlik, kullanici_grubu FROM kullanici_hesabi WHERE cep_telefonu = $1`, [tel])).rows[0];
  if (var_ && var_.kullanici_grubu !== GRUP_YAT) return null;
  let h = var_?.kimlik as string | undefined;
  if (!h) {
    const ep = t.eposta && !(await c.query(`SELECT 1 FROM kullanici_hesabi WHERE lower(e_posta COLLATE "C") = lower($1 COLLATE "C")`, [t.eposta])).rowCount ? t.eposta : null;
    h = (await c.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, dogrulama_yontemi, tercih_dili) VALUES ('Müşteri/Kurum',$1,$2,$3,$4,$3,'SMS kodu',$5) RETURNING kimlik`,
      [GRUP_YAT, (t.kisi_adi_soyadi ?? 'Yat Sahibi').trim(), tel, ep, t.yazisma_dili === 'İngilizce' ? 'İngilizce' : 'Türkçe'])).rows[0].kimlik as string;
    await c.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) VALUES ($1,$2)`, [h, await rolId(c, 'Müşteri Portal Kullanıcısı')]);
    await izYaz(c, { eylem: 'Yat Sahibi Hesabı Açıldı (Dosya Açılışı)', nesneTuru: 'Kullanıcı', nesneKimligi: h, sonuc: 'Başarılı' });
  }
  await c.query(`UPDATE dosya_tarafi SET kullanici_ref = $2 WHERE kimlik = $1`, [t.kimlik, h]);
  if (t.taraf_ref) await c.query(`UPDATE taraf SET kullanici_ref = $2 WHERE kimlik = $1 AND kullanici_ref IS NULL`, [t.taraf_ref, h]);
  return h;
}

export async function yapilacaklar(db: Db, d: { kimlik: string; statu: string; asama: string | null; oncelik: string; dosya_niteligi: string }) {
  const l: { is: string; sorumlu: string; engel?: boolean; hedef?: string | null; form?: { hedef: string; rol?: string } }[] = [];
  const ekip = new Set((await db.query(`SELECT rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL`, [d.kimlik])).rows.map((r) => r.rol as string));
  if (d.statu === 'Açılış Kontrolünde') {
    if (!ekip.has('Dosya Sorumlusu')) l.push({ is: 'Dosya Sorumlusunu Ata', sorumlu: 'Operasyon Müdürü', engel: true });
    if (!ekip.has('Operasyon Yöneticisi')) l.push({ is: 'Operasyon Yöneticisini Ata', sorumlu: 'Operasyon Müdürü', engel: true });
    if (!ekip.has('Teknik Uzman') && !ekip.has('Sorumlu Teknik Uzman (Koordinatör)')) l.push({ is: (await boyGovdeEksik(db, d.kimlik)) ? 'Boy ve Gövde Malzemesini Tamamla' : 'Teknik Uzmanı Ata', sorumlu: (await boyGovdeEksik(db, d.kimlik)) ? 'Dosya Sorumlusu' : 'Teknik Müdür', engel: true });
    if (!ekip.has('Teknik Yönetici')) l.push({ is: 'Teknik Yöneticiyi Ata', sorumlu: 'Teknik Müdür', engel: true });
  }
  // YG-050: zorunlu durumda Saha Sorumlusu uyarısı.
  if (!ekip.has('Saha Sorumlusu')) { const sg = await sahaSorumlusuGerekceleri(db, d.kimlik); if (sg.length) l.push({ is: `Saha Sorumlusunu Ata (Zorunlu: ${sg.join(', ')})`, sorumlu: 'Teknik Müdür' }); }
  if (d.dosya_niteligi === 'Sigorta bağlantılı' && !(await db.query(`SELECT 1 FROM dosya_sigorta_kaydi WHERE dosya_ref = $1 AND sigorta_hasar_dosya_no IS NOT NULL`, [d.kimlik])).rowCount) l.push({ is: 'Sigorta Hasar Dosya Numarasını Gir (Teklif Gönderilmeden Önce)', sorumlu: 'Dosya Sorumlusu' });
  // YG-1360: her yapılacak işin hedefi dosyanın en yakın açık süresidir; dosyaya bağlı bekleyen görev kartları sorumlu ve hedef zamanla eklenir.
  const hedef = (await db.query(`SELECT min(bitis) b FROM dosya_sure WHERE dosya_ref = $1 AND tamamlanma IS NULL`, [d.kimlik])).rows[0]?.b ?? null;
  for (const x of l) x.hedef ??= hedef ? new Date(hedef).toISOString() : null;
  // YG-1360: ekip atama işinde form (Atanacak Rol) ve rol bilinir; ekran bir adım tamamlanınca sıradakini açar.
  const ATA: Record<string, string> = { 'Dosya Sorumlusunu Ata': 'Dosya Sorumlusu', 'Operasyon Yöneticisini Ata': 'Operasyon Yöneticisi', 'Teknik Uzmanı Ata': 'Teknik Uzman', 'Teknik Yöneticiyi Ata': 'Teknik Yönetici' };
  for (const x of l) { const r = ATA[x.is] ?? (x.is.startsWith('Saha Sorumlusunu Ata') ? 'Saha Sorumlusu' : undefined); if (r) x.form = { hedef: 'e-r', rol: r }; else if (x.is.startsWith('Sigorta Hasar Dosya Numarasını Gir')) x.form = { hedef: 'de-hn' }; }
  const kartlar = (await db.query(`SELECT k.baslik, k.son_zaman, coalesce(h.ad_soyad, r.rol_adi, '—') sorumlu FROM is_karti k LEFT JOIN kullanici_hesabi h ON h.kimlik = k.sahip_kullanici_ref LEFT JOIN rol r ON r.kimlik = k.sahip_rol_ref WHERE k.kategori = 'gorev' AND k.durum = 'Bekliyor' AND k.nesne_turu = 'Dosya' AND k.nesne_kimligi = $1 ORDER BY k.son_zaman NULLS LAST LIMIT 10`, [d.kimlik])).rows;
  for (const k of kartlar) l.push({ is: k.baslik, sorumlu: k.sorumlu, hedef: k.son_zaman ? new Date(k.son_zaman).toISOString() : null });
  return l;
}

/** YG-065, YG-1468: aşama kapıları. Teklif öncesi marka, boy, gövde malzemesi ve tahrik zorunludur. Modüller kendi kapısını ekler. */
type Kapi = (db: Db, d: { kimlik: string; yat_ref: string; oncelik: string }) => Promise<string | null>;
const KAPILAR = new Map<string, Kapi[]>();
export function kapiKaydet(asama: string, f: Kapi) { KAPILAR.set(asama, [...(KAPILAR.get(asama) ?? []), f]); }
/** Teklif için gerekli yat bilgilerinden eksik olanlar. */
export async function yatEksikleri(db: Db, yat: string): Promise<string[]> {
  const y = (await db.query(`SELECT marka_model_ref, marka_diger, tam_boy_m, govde_malzemesi, tahrik_turu FROM yat WHERE kimlik = $1`, [yat])).rows[0];
  if (!y) return [];
  return [!(y.marka_model_ref || y.marka_diger) && 'marka', y.tam_boy_m === null && 'boy', (!y.govde_malzemesi || y.govde_malzemesi === 'Bilinmiyor') && 'gövde malzemesi', !y.tahrik_turu && 'tahrik'].filter(Boolean) as string[];
}
/** YG-158: yetkisiz kaynaktan (Yat Sahibi veya geçerli yetki kaydı olan taraf dışından) gelen talimat ve karar doğrulanmadan hiçbir aşama kapısı geçilmez. */
for (const a of ASAMALAR.slice(1)) kapiKaydet(a, async (db, d) => {
  const n = (await db.query(`SELECT count(*)::int n FROM talimat_kaydi WHERE dosya_ref = $1 AND tur IN ('Talimat', 'Karar') AND NOT kaynak_yetkili AND kaynak_sonucu IS NULL`, [d.kimlik])).rows[0].n;
  return n ? `Yetkisiz kaynaktan gelen ${n} talimat/karar kaydı doğrulanmamıştır; Talimat ve Karar Kayıtlarından doğrulayınız veya dikkate almayınız.` : null;
});
kapiKaydet('Teklif', async (db, d) => {
  const eksik = await yatEksikleri(db, d.yat_ref);
  return eksik.length ? `Teklife geçmek için yat bilgisi eksik: ${eksik.join(', ')}.` : null;
});
// YG-065: Uygulamaya onaylanmış teklif, Kontrole tamamlanmış iş emirleri, Teslime tamamlanmış kontrol listeleri olmadan geçilmez. Acil ilk tedbir (acil müdahale) bu kapıları beklemez.
kapiKaydet('Uygulama', async (db, d) => ((await db.query(`SELECT 1 FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu = 'Karar' AND karar IS NOT NULL AND karar <> 'Ret' LIMIT 1`, [d.kimlik])).rowCount ? null : 'Uygulamaya geçmek için onaylanmış bir fiyat teklifi gerekir.'));
kapiKaydet('Kontrol', async (db, d) => {
  const r = (await db.query(`SELECT count(*) FILTER (WHERE statu NOT IN ('Taslak', 'İptal', 'Yerine Geçti'))::int n, count(*) FILTER (WHERE statu IN ('İç Onayda', 'Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif', 'Çekinceli', 'Durduruldu'))::int acik FROM is_emri WHERE dosya_ref = $1`, [d.kimlik])).rows[0];
  return !r.n ? 'Kontrole geçmek için yayımlanmış bir iş emri gerekir.' : r.acik ? `Kontrole geçmek için ${r.acik} iş emrinin tamamlanması gerekir.` : null;
});
kapiKaydet('Teslim', async (db, d) => {
  const n = (await db.query(`SELECT count(*)::int n FROM kontrol_listesi_kaydi WHERE dosya_ref = $1 AND statu = 'Taslak'`, [d.kimlik])).rows[0].n;
  return n ? `Teslime geçmek için ${n} kontrol listesinin tamamlanması gerekir.` : null;
});

/** YG-1440: süresi dolan yat belgesi yeniden istenir; yatın açık dosyalarının Dosya Sorumlusuna bir kez görev düşer. */
export async function belgeSuresiIsle(db: Pool, simdi = new Date()): Promise<number> {
  const bugun = new Date(simdi.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  const { rows } = await db.query(`SELECT b.kimlik, b.ad, b.bag_kimligi yat, b.gecerlilik_bitis::text bitis FROM belge b WHERE b.bag_turu = 'Yat' AND b.gecerlilik_bitis < $1::date AND b.yenileme_istendi IS NULL`, [bugun]);
  let n = 0;
  for (const b of rows) {
    const dosyalar = (await db.query(`SELECT kimlik, dosya_no, dosya_sorumlusu_ref FROM dosya WHERE yat_ref::text = $1 AND statu NOT IN ('Kapalı', 'İptal') AND dosya_sorumlusu_ref IS NOT NULL`, [b.yat])).rows;
    for (const d of dosyalar) { await kartAc(db, { tur: 'Süresi Dolan Yat Belgesi', kategori: 'gorev', baslik: `${d.dosya_no} · Süresi Dolan Belge: ${b.ad}`, ozet: `Geçerlilik bitişi ${b.bitis.split('-').reverse().join('.')}. Güncel belgeyi yat sahibinden veya yetkilisinden isteyerek yat kaydına yükleyiniz.`, sahipKullanici: d.dosya_sorumlusu_ref, sonZaman: new Date(simdi.getTime() + 3 * 86_400_000), nesneTuru: 'Dosya', nesneKimligi: d.kimlik }); n++; }
    await db.query(`UPDATE belge SET yenileme_istendi = $2 WHERE kimlik = $1`, [b.kimlik, simdi]);
  }
  return n;
}

/** Dosya açılışında çalışan modül kancaları (yat sahibi beyanı, uygulama bağlantısı). */
type AcilisKancasi = (c: PoolClient, dosya: string, web: string, yapan: string) => Promise<void>;
const ACILIS: AcilisKancasi[] = [];
export function acilisKancasi(f: AcilisKancasi) { ACILIS.push(f); }
// YG-1245: eksik yat bilgisi kaynaksız doldurulmaz; görünür kalır ve açılışı yapan Dosya Sorumlusuna görev olarak atanır.
acilisKancasi(async (c, dosya, _web, yapan) => {
  const d = (await c.query(`SELECT dosya_no, yat_ref FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]; if (!d) return;
  const eksik = await yatEksikleri(c, d.yat_ref); if (!eksik.length) return;
  if ((await c.query(`SELECT 1 FROM is_karti WHERE tur = 'Eksik Yat Bilgisi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [d.yat_ref])).rowCount) return;
  await kartAc(c, { tur: 'Eksik Yat Bilgisi', kategori: 'gorev', baslik: `${d.dosya_no} · Eksik Yat Bilgisi`, ozet: `Eksik: ${eksik.join(', ')}. Bilgiyi kaynağıyla (ruhsat, kaptan/yat sahibi beyanı, keşif) tamamlamanız rica olunur.`, sahipKullanici: yapan, sonZaman: new Date(Date.now() + 2 * 86_400_000), nesneTuru: 'Yat', nesneKimligi: d.yat_ref });
});

// YG-096: bayrak, ticari/özel kullanım ve klas durumu (klaslıysa klas kuruluşu) açılışta girilmemişse kaynaksız doldurulmaz; Dosya Sorumlusuna görev düşer.
acilisKancasi(async (c, dosya, _web, yapan) => {
  const d = (await c.query(`SELECT d.dosya_no, d.yat_ref, y.bayrak, y.kullanim_amaci, y.klas_durumu, y.klas_kurulusu FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0]; if (!d) return;
  const eksik = [!d.bayrak && 'bayrak', !d.kullanim_amaci && 'kullanım (ticari/özel)', !d.klas_durumu && 'klas durumu', d.klas_durumu === 'Evet' && !d.klas_kurulusu && 'klas kuruluşu'].filter(Boolean) as string[];
  if (!eksik.length || (await c.query(`SELECT 1 FROM is_karti WHERE tur = 'Eksik Klas ve Kullanım Bilgisi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [d.yat_ref])).rowCount) return;
  await kartAc(c, { tur: 'Eksik Klas ve Kullanım Bilgisi', kategori: 'gorev', baslik: `${d.dosya_no} · Eksik Klas ve Kullanım Bilgisi`, ozet: `Eksik: ${eksik.join(', ')}. Bilgiyi kaynağıyla (ruhsat, klas sertifikası, kaptan/yat sahibi beyanı) tamamlamanız rica olunur.`, sahipKullanici: yapan, sonZaman: new Date(Date.now() + 2 * 86_400_000), nesneTuru: 'Yat', nesneKimligi: d.yat_ref });
});

/** YG-025: dosyada ve yat sahibi kaydında eksik kalan alanlar (yat bilgileri YG-1245 ve YG-096 görevlerindedir). */
export async function dosyaEksikleri(db: Db, dosya: string): Promise<string[]> {
  const d = (await db.query(`SELECT d.olay_tarihi, t.kimlik taraf, t.telefon, t.eposta, t.vergi_no, t.tckn, t.kisi_turu FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN taraf t ON t.kimlik = y.yat_sahibi_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (!d) return [];
  return [!d.olay_tarihi && 'Olay tarihi', !d.taraf && 'Yat sahibi kaydı', d.taraf && !d.telefon && 'Yat sahibi telefonu', d.taraf && !d.eposta && 'Yat sahibi e-posta adresi',
    d.taraf && !d.vergi_no && !d.tckn && (d.kisi_turu === 'Tüzel kişi' ? 'Yat sahibi vergi numarası' : 'Yat sahibi TC kimlik veya vergi numarası')].filter(Boolean) as string[];
}
// YG-025: her eksik alan için sorumlu (açılışı yapan) ve hedef tarihli ayrı tamamlama görevi; acil geçici açılışta hedef, girilen tamamlama tarihidir.
acilisKancasi(async (c, dosya, _web, yapan) => {
  const d = (await c.query(`SELECT dosya_no, acil_gecici_acilis, eksik_alan_gerekcesi, tamamlama_hedef_tarihi::text hedef FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]; if (!d) return;
  const son = d.acil_gecici_acilis && d.hedef ? new Date(`${d.hedef}T18:00:00+03:00`) : new Date(Date.now() + 2 * 86_400_000);
  if (d.acil_gecici_acilis && d.eksik_alan_gerekcesi) await kartAc(c, { tur: 'Acil Açılış Eksikleri', kategori: 'gorev', oncelik: 'Yüksek', baslik: `${d.dosya_no} · Acil Açılış Eksiklerini Tamamla`, ozet: `Acil geçici açılış gerekçesi: ${d.eksik_alan_gerekcesi}`.slice(0, 300), sahipKullanici: yapan, sonZaman: son, nesneTuru: 'Dosya', nesneKimligi: dosya });
  for (const alan of await dosyaEksikleri(c, dosya)) {
    if ((await c.query(`SELECT 1 FROM is_karti WHERE tur = 'Eksik Dosya Bilgisi' AND nesne_kimligi = $1 AND baslik = $2 AND durum = 'Bekliyor'`, [dosya, `${d.dosya_no} · ${alan}`])).rowCount) continue;
    await kartAc(c, { tur: 'Eksik Dosya Bilgisi', kategori: 'gorev', baslik: `${d.dosya_no} · ${alan}`, ozet: `${alan} açılışta girilmedi; kaynağıyla tamamlamanız rica olunur.`, sahipKullanici: yapan, sonZaman: son, nesneTuru: 'Dosya', nesneKimligi: dosya });
  }
});

/** YG-036: görüş ayrılığında sırayla üst kademeye. Sahibi olmayan kademe atlanır. */
const DUSURME_KADEMELERI = [['Operasyon Yöneticisi', 'Teknik Yönetici'], ['Operasyon Müdür Yardımcısı', 'Teknik Müdür Yardımcısı'], ['Operasyon Müdürü', 'Teknik Müdür'], ['Teknik ve Operasyon Direktörü']];

async function dusurmeKarti(c: PoolClient, t: { kimlik: string; dosya_no: string; yeni_oncelik: string; gerekce: string; talep_eden_ref: string }, kademe: number): Promise<boolean> {
  for (let k = kademe; k < DUSURME_KADEMELERI.length; k++) {
    const roller = DUSURME_KADEMELERI[k]!;
    const zincir: string[] = [];
    for (const r of roller) { const id = await rolId(c, r); if ((await rolSahipleri(c, id)).length) zincir.push(id); }
    if (zincir.length < roller.length) continue;
    await c.query(`UPDATE oncelik_talebi SET kademe = $2 WHERE kimlik = $1`, [t.kimlik, k]);
    await kartAc(c, { tur: 'Öncelik Düşürme', baslik: `${t.dosya_no} · Öncelik Düşürme: ${t.yeni_oncelik}`, ozet: t.gerekce, hazirlayan: t.talep_eden_ref, zincir, nesneTuru: 'Öncelik Talebi', nesneKimligi: t.kimlik });
    return true;
  }
  return false;
}

kapanisKaydet('Öncelik Düşürme', async (c, k, karar, yapan) => {
  const t = (await c.query(`SELECT t.*, d.dosya_no, d.statu, d.asama FROM oncelik_talebi t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!t || t.durum !== 'Bekliyor') return;
  if (karar === 'Onayla') {
    await c.query(`UPDATE oncelik_talebi SET durum = 'Onaylandı', karar_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
    await c.query(`UPDATE dosya SET oncelik = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [t.dosya_ref, t.yeni_oncelik]);
    await izYaz(c, { aktor: yapan, eylem: 'Öncelik Düşürüldü', nesneTuru: 'Dosya', nesneKimligi: t.dosya_ref, eski: { oncelik: t.eski_oncelik }, yeni: { oncelik: t.yeni_oncelik }, gerekce: t.gerekce, sonuc: 'Başarılı' });
  } else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') {
    // İade motorda hazırlayana döner; burada görüş ayrılığıdır, üst kademeye taşınır.
    await c.query(`UPDATE is_karti SET durum = 'Reddedildi', kapanma_zamani = now() WHERE nesne_kimligi = $1 AND tur = 'Öncelik Düşürme' AND durum IN ('Bekliyor', 'İade Edildi')`, [t.kimlik]);
    if (!(await dusurmeKarti(c, t, t.kademe + 1))) await c.query(`UPDATE oncelik_talebi SET durum = 'Reddedildi', karar_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
  }
});

kapanisKaydet('Beklemede Uzatma', async (c, k, karar, yapan) => {
  if (karar !== 'Onayla') return;
  const r = await c.query(`UPDATE beklemede_isareti SET hedef_tarih = hedef_tarih + 15, uzatma_sayisi = uzatma_sayisi + 1, uzatma_gerekcesi = $2, uzatma_onaylayan_ref = $3, guncelleme_zamani = now() WHERE kimlik = $1 AND kaldirilma_zamani IS NULL RETURNING dosya_ref, hedef_tarih`, [k.nesne_kimligi, k.ozet, yapan]);
  if (r.rows[0]) await izYaz(c, { aktor: yapan, eylem: 'Beklemede Uzatıldı', nesneTuru: 'Dosya', nesneKimligi: r.rows[0].dosya_ref, gerekce: k.ozet ?? undefined, sonuc: 'Başarılı' });
});

/** YG-068, YG-069: 10. günde yükseltme; 45. günde Devam / Askı / Kapanış karar noktası. Otomatik kapanmaz. */
export async function beklemedeIsle(db: Pool, simdi = new Date()): Promise<number> {
  if ((await db.query(`SELECT 1 FROM olaganustu_donem WHERE bitis IS NULL UNION ALL SELECT 1 FROM kesinti WHERE tur = 'Kesinti' AND durum = 'Açık' LIMIT 1`)).rowCount) return 0; // YG-1629; TZ-1: sistem kesintisinde süreler durur
  let n = 0;
  const opm = await rolId(db, 'Operasyon Müdürü');
  const { rows } = await db.query(`SELECT b.kimlik, b.dosya_ref, b.neden, b.olusturma_zamani, b.eskalasyon_zamani, d.dosya_no FROM beklemede_isareti b JOIN dosya d ON d.kimlik = b.dosya_ref WHERE b.kaldirilma_zamani IS NULL AND b.gun45_karari IS NULL`);
  for (const r of rows) {
    const gun = (simdi.getTime() - new Date(r.olusturma_zamani).getTime()) / 86_400_000;
    if (gun >= 10 && !r.eskalasyon_zamani) {
      await db.query(`UPDATE beklemede_isareti SET eskalasyon_zamani = $2 WHERE kimlik = $1`, [r.kimlik, simdi]);
      await bildir(db, { olay: `beklemede-10:${r.kimlik}`, kullanicilar: await rolSahipleri(db, opm), baslik: `Beklemede 10. Gün: ${r.dosya_no}`, ozet: `Neden: ${r.neden}`, eposta: true }, simdi);
      n++;
    }
    if (gun >= 45 && await birKez(db, 'beklemede_45', r.kimlik)) {
      await kartAc(db, { tur: 'Beklemede 45. Gün Kararı', kategori: 'islem', baslik: `${r.dosya_no} · Beklemede 45. Gün Kararı`, ozet: `Neden: ${r.neden}. Devam, Kontrollü Askıda veya Kapanış kararı veriniz.`, sahipRol: opm, nesneTuru: 'Beklemede', nesneKimligi: r.kimlik });
      n++;
    }
  }
  return n;
}

/** YG-040, YG-041: süre aşımı sorumluya ve Operasyon Müdürüne bildirilir. */
export async function sureIsle(db: Pool, simdi = new Date()): Promise<number> {
  if ((await db.query(`SELECT 1 FROM olaganustu_donem WHERE bitis IS NULL UNION ALL SELECT 1 FROM kesinti WHERE tur = 'Kesinti' AND durum = 'Açık' LIMIT 1`)).rowCount) return 0; // YG-1629; TZ-1: sistem kesintisinde süreler durur
  const { rows } = await db.query(
    `SELECT s.kimlik, s.tur, coalesce(d.dosya_no, t.talep_no) AS no, coalesce(d.oncelik, t.oncelik) AS oncelik, d.dosya_sorumlusu_ref, t.ilk_sorumlu_ref FROM dosya_sure s LEFT JOIN dosya d ON d.kimlik = s.dosya_ref LEFT JOIN talep t ON t.kimlik = s.talep_ref
      WHERE s.tamamlanma IS NULL AND s.bitis + make_interval(secs => ${DURAK_SN}) < $1 AND coalesce(d.statu, 'Aktif') NOT IN ('Kapalı', 'Teknik Kapalı')`, [simdi]);
  let n = 0; const opm = await rolSahipleri(db, await rolId(db, 'Operasyon Müdürü'));
  for (const r of rows) {
    if (!(await birKez(db, 'sure_asimi', r.kimlik))) continue;
    await bildir(db, { olay: `sure-asim:${r.kimlik}`, kullanicilar: [...opm, r.dosya_sorumlusu_ref ?? r.ilk_sorumlu_ref].filter(Boolean), baslik: `Süre Aşıldı · ${r.tur}: ${r.no}`, oncelik: r.oncelik, eposta: true }, simdi);
    n++;
  }
  return n;
}

/**
 * YG-1552: sicilde kayıtlı sigorta şirketinin yürürlükte "Sigorta Şirketi" sözleşmesi yoksa dosya açılışı engellenmez; dosya sigorta kaydı
 * "çerçeve sözleşmesi yok" işaretlenir (teklifte ödeme vadesi ve fatura bilgisi zorunlu olur), Müşteri ve Paydaş İlişkileri Müdürüne görev açılır, GMY bilgilendirilir.
 */
export async function cerceveKontrol(c: Db, dosya: string, dosyaNo: string): Promise<void> {
  const s = (await c.query(`SELECT s.sigortaci_adi, u.kimlik kurulus, EXISTS (SELECT 1 FROM sozlesme_kaydi z WHERE z.kurulus_ref = u.kimlik AND z.sozlesme_turu = 'Sigorta Şirketi' AND z.durum = 'Yürürlükte' AND (z.bitis IS NULL OR z.bitis >= current_date)) sozlesme
      FROM dosya_sigorta_kaydi s LEFT JOIN LATERAL (SELECT kimlik FROM kurulus WHERE s.sigortaci_adi IS NOT NULL AND tr_norm(trim(ticari_unvan)) = tr_norm(trim(s.sigortaci_adi)) LIMIT 1) u ON true WHERE s.dosya_ref = $1`, [dosya])).rows[0];
  if (!s?.kurulus || s.sozlesme) return;
  await c.query(`UPDATE dosya_sigorta_kaydi SET cerceve_sozlesme_yok = true WHERE dosya_ref = $1`, [dosya]);
  const { kartAc } = await import('./is_motoru.js'); const { bildir } = await import('./bildirim.js'); const { rolSahipleri } = await import('./makam.js'); const { rolId } = await import('./ihbar.js');
  await kartAc(c, { tur: 'Sigorta Çerçeve Sözleşmesi', kategori: 'gorev', baslik: `${dosyaNo} · ${s.sigortaci_adi} · Çerçeve Sözleşmesi Yok`, ozet: 'Sigorta şirketiyle iletişime geçiniz; iş bu dosyada dosya bazlı Sigorta Görevlendirmesiyle yürür, çerçeve sözleşme otomatik gönderilmez.', sahipRol: await rolId(c, 'Müşteri ve Paydaş İlişkileri Müdürü'), nesneTuru: 'Dosya', nesneKimligi: dosya });
  await bildir(c, { olay: `cerceve-yok:${dosya}`, kullanicilar: await rolSahipleri(c, await rolId(c, 'Genel Müdür Yardımcısı')), baslik: `${dosyaNo} · Çerçeve Sözleşmesi Olmayan Sigorta Şirketi`, ozet: `${s.sigortaci_adi}: dosya açıldı; Müşteri ve Paydaş İlişkileri Müdürüne görev açıldı.` });
}

/** YG-059: hedef tarihi geçen açık konu ertesi gün sahibine ve Dosya Sorumlusuna, 3 gün sonra Operasyon Müdürüne birer kez bildirilir. */
export async function acikKonuGecikmeIsle(db: Pool, simdi = new Date()): Promise<number> {
  const bugun = new Date(simdi.getTime() + 180 * 60_000).toISOString().slice(0, 10); let n = 0;
  const { rows } = await db.query(`SELECT k.kimlik, k.konu_no, k.baslik, k.sahip_ref, to_char(k.hedef_tarih, 'YYYY-MM-DD') hedef, ($1::date - k.hedef_tarih) gun, d.dosya_no, d.dosya_sorumlusu_ref FROM acik_konu k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.statu IN ('Açık', 'İşlemde', 'Doğrulamada') AND k.hedef_tarih < $1::date`, [bugun]);
  const om = (await db.query(`SELECT a.kullanici_ref FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.atama_durumu = 'Aktif' AND x.rol_adi = 'Operasyon Müdürü'`)).rows.map((r) => r.kullanici_ref as string);
  for (const k of rows) {
    const ozet = `${k.dosya_no} · ${k.konu_no} · Hedef: ${k.hedef.split('-').reverse().join('.')} · ${k.gun} gün gecikme`;
    if (await birKez(db, 'konu-gecikme', `${k.kimlik}:${k.hedef}`)) { await bildir(db, { olay: `konu-gecikme:${k.kimlik}:${k.hedef}`, kullanicilar: [...new Set([k.sahip_ref, k.dosya_sorumlusu_ref].filter(Boolean))], baslik: `Gecikmiş Açık Konu: ${k.baslik}`, ozet, oncelik: 'Yüksek' }, simdi); n++; }
    if (Number(k.gun) >= 3 && om.length && await birKez(db, 'konu-gecikme-ust', `${k.kimlik}:${k.hedef}`)) { await bildir(db, { olay: `konu-gecikme-ust:${k.kimlik}:${k.hedef}`, kullanicilar: om, baslik: `Yükseltme · Gecikmiş Açık Konu: ${k.baslik}`, ozet, oncelik: 'Yüksek' }, simdi); n++; }
  }
  return n;
}

export function dosyaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const ihbarci = { preHandler: izinGerekli(b, 'ihbar.kaydet') };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Dosya bulunamadı veya erişim yetkiniz yok.' });
  const dosyaGetir = async (id: string, k: string) => (UUID.test(id) && await dosyaErisimi(b.db, k, id) ? (await b.db.query(`SELECT * FROM dosya WHERE kimlik = $1`, [id])).rows[0] : undefined);

  // YG-030: açılış kararı olmadan sahaya görev açılmaz. Kabul doğrulanmış yetki ister; Koşullu Açılışta izinli ve yasak işler yazılır.
  s.post('/ihbar/:id/acilis', ihbarci, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { garantiModel?: string; karar?: string; ozet?: string; kosullar?: string; yenidenTarih?: string; gerekce?: string; musteriTuru?: string; hizmetTuru?: string; acilGecici?: boolean; eksikGerekce?: string; tamamlamaTarih?: string; garantiliEkipman?: boolean; garantiMarka?: string; garantiBitis?: string; sigortaci?: string; hasarNo?: string; policeNo?: string; kapsam?: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'İhbar kaydı bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    if (!['Kabul', 'Koşullu Açılış', 'Bekletme', 'Yönlendirme', 'Ret'].includes(g.karar ?? '')) return y.code(400).send({ hata: 'Açılış kararını seçiniz.' });
    if (!g.ozet?.trim()) return y.code(400).send({ hata: 'Açılış özeti zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      const t = (await c.query(`SELECT * FROM talep WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      if (!t) return dur(404, 'İhbar bulunamadı.');
      if (t.dosya_ref || ['Birleştirildi', 'Kapsam Dışı / Yönlendirme'].includes(t.statu)) return dur(409, 'Bu ihbar sonuçlanmıştır.');
      if (g.karar === 'Koşullu Açılış' && !g.kosullar?.trim()) return dur(400, 'Koşullu açılışta izinli ve yasak işleri yazınız.');
      if (g.karar === 'Bekletme' && !g.yenidenTarih) return dur(400, 'Yeniden değerlendirme tarihini giriniz.');
      if ((g.karar === 'Yönlendirme' || g.karar === 'Ret') && !g.gerekce?.trim()) return dur(400, 'Gerekçe zorunludur.');
      const karar = (dosya: string | null) => c.query(`INSERT INTO dosya_acilis_karari (talep_ref, dosya_ref, acilis_ozeti, karar, kosullar_yasaklar, yeniden_degerlendirme, gerekce, karar_veren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, dosya, g.ozet!.trim(), g.karar, g.kosullar?.trim() || null, g.yenidenTarih || null, g.gerekce?.trim() || null, o.kullanici]);
      const iz = (eylem: string, dosya?: string) => izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem, nesneTuru: dosya ? 'Dosya' : 'Talep', nesneKimligi: dosya ?? id, yeni: { karar: g.karar }, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      if (g.karar === 'Bekletme') {
        await c.query(`UPDATE talep SET statu = 'Bekletme', guncelleme_zamani = now() WHERE kimlik = $1`, [id]);
        await karar(null); await iz('Açılış Kararı: Bekletme'); await c.query('COMMIT');
        return { durum: 'Bekletme' };
      }
      if (g.karar === 'Yönlendirme' || g.karar === 'Ret') {
        await c.query(`UPDATE talep SET statu = 'Kapsam Dışı / Yönlendirme', kapsam_disi_gerekcesi = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, g.gerekce!.trim()]); // YG-007: numara saklanır.
        await sureBitir(c, { tur: 'İlk Yanıt', talep: id });
        await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
        // YG-1505 (D-037): sigorta şirketinin görevlendirmesi reddedilirse BLD-70 teyitli e-postayla sigortaya hazırlanır.
        const st = g.karar === 'Ret' ? (await c.query(`SELECT talep_no, talep_sahibi_turu, talep_sahibi_adi, talep_sahibi_eposta, sigortaci_beyan, sigorta_hasar_dosya_no_beyan FROM talep WHERE kimlik = $1`, [id])).rows[0] : null;
        if (st && st.talep_sahibi_turu === 'Sigorta Şirketi') { const kurum = st.sigortaci_beyan ?? st.talep_sahibi_adi; const no = st.sigorta_hasar_dosya_no_beyan ?? '---';
          await (await import('./sigorta_gonderim.js')).sigortayaHazirla(c, { tur: 'BLD-70', nesne: id, alici: st.talep_sahibi_eposta ?? null, konu: `${st.talep_no} Görevlendirme Değerlendirmesi`, sorumlu: o.kullanici,
            metin: await (await import('./metin.js')).metinGetir(c, 'BLD-70', 'tr', { Kurum: kurum, Institution: kurum, 'Hasar Dosya No': no, 'Claim No': no }) }); }
        await karar(null); await iz(`Açılış Kararı: ${g.karar}`); await c.query('COMMIT');
        return { durum: 'Kapsam Dışı' };
      }
      if (!t.mukerrerlik_sonucu) return dur(409, 'Önce mükerrerlik kontrolünü tamamlayınız.'); // YG-023
      const kritik = t.oncelik === 'Kritik';
      const acil = Boolean(g.acilGecici);
      if (acil && !kritik) return dur(400, 'Acil geçici açılış yalnız Kritik öncelikte kullanılır.');
      if (acil && (!g.eksikGerekce?.trim() || !g.tamamlamaTarih)) return dur(400, 'Acil geçici açılışta eksik alan gerekçesi ve tamamlama tarihi zorunludur.'); // YG-025
      // YG-021, YG-029: yetki doğrulanmadan iş başlamaz. Koşullu açılış ve acil ilk tedbir (YG-065) bu sırayı beklemez.
      if (g.karar === 'Kabul' && t.ihbar_yetki_durumu !== 'Doğrulandı' && !acil) return dur(409, 'Yetki doğrulanmadan dosya kabul edilemez; yetkiyi doğrulayınız veya Koşullu Açılış seçiniz.');
      if (t.ihbar_yetki_durumu === 'Bilgi Amaçlı' && !acil) return dur(409, 'İhbar edenin işlem yetkisi yoktur; yat sahibi veya yetkilisine ulaşınız.');
      // YG-866: hizmet türü değer listesinden (LST_HIZMET_TURU) seçilir.
      if (g.hizmetTuru && !(await c.query(`SELECT 1 FROM deger_listesi WHERE liste_kodu = 'LST_HIZMET_TURU' AND deger = $1`, [g.hizmetTuru])).rowCount) return dur(400, 'Hizmet türünü listeden seçiniz.');
      const musteri = g.musteriTuru ?? '';
      if (!['Sigorta Şirketi', 'Kurumsal Müşteri', 'Bireysel Müşteri'].includes(musteri)) return dur(400, 'Müşteri türünü seçiniz.');
      // YG-100: yabancı sigortacı muhatap olamaz; dosya bireysel kurallarla yürür.
      if (musteri === 'Sigorta Şirketi' && t.talep_sahibi_turu === 'Yabancı Sigortacı / Sörveyör') return dur(400, 'Yabancı sigortacı muhatap olamaz; dosyanın muhatabı yat sahibi veya yetkilisidir.');
      const sigortali = musteri === 'Sigorta Şirketi';
      const sigortaAdi = g.sigortaci?.trim() || t.sigortaci_beyan;
      if (sigortali && !sigortaAdi) return dur(400, 'Sigorta şirketini giriniz.');
      // YG-029: kimlik kanıtı yetki doğrulamasının yazılı dayanağıdır (yukarıda); kapsam kanıtı (sigorta bağlantılı dosyada hasar dosya numarası) olmadan Kabul ile teknik dosya açılmaz. Koşullu Açılış ve acil ilk tedbir beklemez.
      if (g.karar === 'Kabul' && !acil) {
        if (sigortali && !(g.hasarNo?.trim() || t.sigorta_hasar_dosya_no_beyan)) return dur(409, 'Sigorta hasar dosya numarası olmadan sigorta bağlantılı dosya kabul edilemez; numarayı giriniz, Koşullu Açılış seçiniz veya talebi gerekçeyle reddediniz.');
      }
      if (t.oncelik === 'Kritik' && (await c.query(`SELECT 1 FROM is_karti WHERE tur = 'Kritik Öncelik Teyidi' AND nesne_kimligi = $1 AND durum = 'Reddedildi'`, [id])).rowCount) return dur(409, 'Kritik öncelik teyit edilmedi; önceliği güncelleyiniz.');
      const hasarIlerler = t.oncelik_cevaplari && Object.entries(t.oncelik_cevaplari as Record<string, string>).some(([k, v]) => k.startsWith('Hasar ilerleyebilir') && v === 'Evet');
      { const ps = (await c.query(`SELECT x.taraf_no, x.pasif_gerekcesi FROM yat y JOIN taraf x ON x.kimlik = y.yat_sahibi_ref WHERE y.kimlik = $1 AND x.pasif`, [t.yat_ref])).rows[0]; // YG-926
        if (ps) return dur(409, `Yat sahibi kaydı (${ps.taraf_no}) pasiftir; yeni dosya açılmaz. ${ps.pasif_gerekcesi ?? ''}`.trim()); }
      const d = (await c.query(
        `INSERT INTO dosya (dosya_no, talep_ref, yat_ref, bildirim_tarihi, olay_tarihi, konum, kisa_teknik_tanim, hizmet_turu, musteri_turu, dosya_niteligi, odeme_sorumlusu, oncelik, onerilen_oncelik, musteri_hedef_tarihi, acil_gecici_acilis, eksik_alan_gerekcesi, tamamlama_hedef_tarihi, garantili_ekipman, garantili_ekipman_marka, garanti_bitis, yazisma_dili, hasar_ilerleyebilir, olusturan_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING kimlik, dosya_no`,
        [t.talep_no, id, t.yat_ref, t.bildirim_alinma_zamani, t.olay_tarihi, t.yat_mevcut_konumu, t.ihtiyac_tanimi, g.hizmetTuru ?? 'Hasar onarımı', musteri, sigortali ? 'Sigorta bağlantılı' : 'Doğrudan hizmet', sigortali ? ['Sigorta'] : ['Yat sahibi'], t.oncelik, t.onerilen_oncelik, t.musteri_hedef_tarihi, acil, g.eksikGerekce?.trim() || null, g.tamamlamaTarih || null, g.garantiliEkipman ?? null, g.garantiMarka ?? null, g.garantiBitis || null, t.yazisma_dili, Boolean(hasarIlerler), o.kullanici])).rows[0];
      { const k6 = (await c.query(`SELECT x.kisi_turu, y.kullanim_amaci FROM yat y LEFT JOIN taraf x ON x.kimlik = y.yat_sahibi_ref WHERE y.kimlik = $1`, [t.yat_ref])).rows[0]; await c.query(`UPDATE dosya SET kapsam_6502 = $2 WHERE kimlik = $1`, [d.kimlik, (await import('./onay_ek.js')).kapsam6502(musteri, k6?.kisi_turu ?? null, k6?.kullanim_amaci ?? null)]); } // YG-027
      if (g.garantiModel?.trim()) await c.query(`UPDATE dosya SET garantili_ekipman_model = $2 WHERE kimlik = $1`, [d.kimlik, g.garantiModel.trim()]); // YG-109
      await c.query(`INSERT INTO dosya_statu_gecmisi (dosya_ref, yeni_statu, gerekce, sonraki_sorumlu_rol, olusturan_ref) VALUES ($1,'Açılış Kontrolünde',$2,'Operasyon Müdürü',$3)`, [d.kimlik, `Açılış kararı: ${g.karar}`, o.kullanici]);
      await c.query(`UPDATE talep SET statu = 'Dosyaya Dönüştü', dosya_ref = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, d.kimlik]);
      await karar(d.kimlik);
      // Talep sahibi ve yat sahibi ayrı kişi kayıtlarıdır; aynı kişi birden çok sıfatla ayrı kayıt olur (dosya_tarafi.taraf_rolu).
      const rol: Record<string, string> = { 'Sigorta Şirketi': 'Sigorta Şirketi', 'Sigorta Brokeri / Acentesi': 'Sigorta Brokeri', 'Yat Sahibi': 'Yat Sahibi', 'Yat Sahibinin Yetkili Temsilcisi': 'Yetkili Temsilci', 'Yatın Kaptanı': 'Kaptan', 'Yat Yönetim Şirketi / İşletmeci': 'Yat Yönetim Şirketi', 'Marina / Tesis': 'Marina / Tesis İrtibat Kişisi', 'Yabancı Sigortacı / Sörveyör': 'Yabancı Sigortacı', 'Diğer': 'Diğer' };
      const talepTarafi = (await c.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, sifat, telefon, eposta, talep_sahibi_mi, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,true,$7) RETURNING kimlik`, [d.kimlik, rol[t.talep_sahibi_turu], t.talep_sahibi_adi, t.talep_sahibi_sifat, t.talep_sahibi_telefon, t.talep_sahibi_eposta, o.kullanici])).rows[0];
      const sahip = (await c.query(`SELECT o.* FROM yat y JOIN taraf o ON o.kimlik = y.yat_sahibi_ref WHERE y.kimlik = $1`, [t.yat_ref])).rows[0];
      if (sahip && t.talep_sahibi_turu !== 'Yat Sahibi') await c.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_ref, taraf_rolu, kisi_adi_soyadi, telefon, eposta, kullanici_ref, olusturan_ref) VALUES ($1,$2,'Yat Sahibi',$3,$4,$5,$6,$7)`, [d.kimlik, sahip.kimlik, sahip.unvan_ad_soyad, sahip.telefon, sahip.eposta, sahip.kullanici_ref, o.kullanici]);
      if (sahip && t.talep_sahibi_turu === 'Yat Sahibi') await c.query(`UPDATE dosya_tarafi SET taraf_ref = $2, kullanici_ref = $3, telefon = coalesce(telefon, $4), eposta = coalesce(eposta, $5) WHERE kimlik = $1`, [talepTarafi.kimlik, sahip.kimlik, sahip.kullanici_ref, sahip.telefon, sahip.eposta]); // YG-106: FR-OPS-001 eksikleri ana kayıttan
      await yatSahibiHesabi(c, d.kimlik); // YG-1757
      if (sigortali) await c.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigorta_taraf_ref, sigortaci_adi, police_no, sigorta_hasar_dosya_no, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6)`, [d.kimlik, t.talep_sahibi_turu === 'Sigorta Şirketi' ? talepTarafi.kimlik : null, sigortaAdi, g.policeNo?.trim() || t.police_no_beyan, g.hasarNo?.trim() || t.sigorta_hasar_dosya_no_beyan, o.kullanici]);
      if (sigortali) await cerceveKontrol(c, d.kimlik, d.dosya_no); // YG-1552
      // TZ-9 BLD-69: sigorta görevlendirmesiyle gelen dosya eksik bilgiyle koşullu açılırsa eksikler sigorta şirketine e-postayla istenir.
      { const eb = ((i.body ?? {}) as { eksikBilgi?: string }).eksikBilgi?.trim();
        if (sigortali && g.karar === 'Koşullu Açılış' && eb && t.talep_sahibi_turu === 'Sigorta Şirketi') {
          const s = (await c.query(`SELECT s.sigortaci_adi, s.sigorta_hasar_dosya_no, x.eposta FROM dosya_sigorta_kaydi s LEFT JOIN dosya_tarafi x ON x.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1`, [d.kimlik])).rows[0];
          const sg = await import('./sigorta_gonderim.js'); const { metinGetir } = await import('./metin.js'); const k = s?.sigortaci_adi ?? ''; const hn = s?.sigorta_hasar_dosya_no ?? t.sigorta_hasar_dosya_no_beyan ?? '—';
          if (s?.eposta) await sg.sigortayaHazirla(c, { dosya: d.kimlik, tur: 'BLD-69', nesne: d.kimlik, alici: s.eposta, konu: `${d.dosya_no} Eksik Bilgi`, metin: await metinGetir(c, 'BLD-69', 'tr', { Kurum: k, Institution: k, 'Hasar Dosya No': hn, 'Claim File No': hn, 'Dosya No': d.dosya_no, 'File No': d.dosya_no, 'eksik bilgi/belge': eb, 'missing information/document': eb }) });
          else await sg.sigortaAdresiBekleniyor(c, d.kimlik);
        } }
      await (await import('./belge_uret.js')).belgeUret(c, { tur: 'Hasar İhbar ve İlk Kayıt', nesne: d.kimlik, dosya: d.kimlik }); // YG-715
      // YG-866: atık alımını tesis veya lisanslı firma yapar; LGM koordine eder ve faturalar.
      if (g.hizmetTuru === 'Yat atık alım hizmeti') await kartAc(c, { tur: 'Atık Alım Koordinasyonu', kategori: 'gorev', baslik: `${d.dosya_no} · Yat Atık Alım Hizmeti`, ozet: 'Atık alımını tesis veya lisanslı firmayla planlayınız; hizmet bedeli fiyat teklifiyle faturalanır.', oncelik: t.oncelik === 'Kritik' ? 'Kritik' : 'Normal', sahipRol: await rolId(c, 'Operasyon Müdürü'), nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
      // Açılışı yapan görevli yeni dosya sorumlusu olmaz; atamayı Operasyon Müdürü yapar (YG-047).
      await c.query(`UPDATE is_karti SET nesne_turu = 'Dosya', nesne_kimligi = $2 WHERE nesne_kimligi = $1 AND tur = 'Kritik Öncelik Teyidi'`, [id, d.kimlik]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE nesne_kimligi = $1 AND tur = 'İhbar Açılış Kontrolü' AND durum = 'Bekliyor'`, [id]);
      await kartAc(c, { tur: 'Dosya Ekibi Ataması', baslik: `${d.dosya_no} · Dosya Sorumlusu ve Operasyon Yöneticisi Ata`, ozet: t.ihtiyac_tanimi.slice(0, 200), oncelik: t.oncelik === 'Kritik' ? 'Kritik' : 'Normal', sahipRol: await rolId(c, 'Operasyon Müdürü'), kategori: 'islem', nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
      // YG-250: olağan ihbar yolundan mesai dışında açılan Kritik (acil) dosyaya nöbetçi Teknik Uzman atanır; Teknik Müdür ilk iş günü 12:00'ye kadar teyit eder.
      if (t.oncelik === 'Kritik' && !(await import('./bildirim.js')).mesaiIcinde(new Date())) {
        const ac = await import('./acil.js'); const nu = await ac.nobetci(c, 'Teknik Uzman', new Date());
        if (nu) {
          await c.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Teknik Uzman',$3)`, [d.kimlik, nu, o.kullanici]);
          await kartAc(c, { tur: 'Nöbetçi Uzman Teyidi', kategori: 'islem', baslik: `${d.dosya_no} · Nöbetçi Uzman Teyidi`, ozet: 'Onaylayınız veya değiştiriniz.', sahipRol: await rolId(c, 'Teknik Müdür'), nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
        }
      }
      const simdi = new Date();
      await sureBaslat(c, { tur: 'Teknik Uzman Ataması', oncelik: t.oncelik, baslangic: simdi, dosya: d.kimlik });
      if (t.oncelik === 'Kritik') await sureBaslat(c, { tur: 'Sahaya Ulaşma', oncelik: 'Kritik', baslangic: simdi, dosya: d.kimlik });
      // YG-1530: boy ve gövde dolmadan Teknik Uzman atanmaz; Dosya Sorumlusuna tamamlama görevi.
      if (await boyGovdeEksik(c, d.kimlik)) await kartAc(c, { tur: 'Eksik Bilgi', kategori: 'gorev', baslik: `${d.dosya_no} · Boy ve Gövde Malzemesini Tamamla`, ozet: 'Ruhsat fotoğrafından tamamlayınız; ruhsat yoksa kaptan veya yat sahibine telefonla sorunuz: "Tekne ahşap mı, fiber mi; yaklaşık kaç metre?"', sahipKullanici: t.ilk_sorumlu_ref, nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
      else await kartAc(c, { tur: 'Teknik Ekip Ataması', baslik: `${d.dosya_no} · Teknik Uzman ve Teknik Yönetici Ata`, ozet: t.ihtiyac_tanimi.slice(0, 200), oncelik: t.oncelik === 'Kritik' ? 'Kritik' : 'Normal', sahipRol: await rolId(c, 'Teknik Müdür'), kategori: 'islem', nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
      for (const f of ACILIS) await f(c, d.kimlik, b.webAdresi, o.kullanici);
      await iz(`Dosya Açıldı: ${g.karar}`, d.kimlik);
      await c.query('COMMIT');
      return { durum: 'Dosya Açıldı', kimlik: d.kimlik, dosyaNo: d.dosya_no };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.get('/dosya', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu sayfa LGM personeline açıktır.' });
    const { kapsam, arsiv, ara } = i.query as { kapsam?: string; arsiv?: string; ara?: string };
    const tum = kapsam === 'tum' && (await kullaniciIzinleri(b.db, o.kullanici)).includes('dosya.tum');
    return (await b.db.query(
      `SELECT d.kimlik, d.dosya_no, d.statu, d.asama, d.oncelik, d.konum, d.acilis_tarihi, y.yat_adi, h.ad_soyad AS dosya_sorumlusu, d.ilerleme_yuzdesi,
              (SELECT neden FROM beklemede_isareti k WHERE k.dosya_ref = d.kimlik AND k.kaldirilma_zamani IS NULL ORDER BY k.olusturma_zamani DESC LIMIT 1) AS beklemede,
              (SELECT min(s.bitis) FROM dosya_sure s WHERE s.dosya_ref = d.kimlik AND s.tamamlanma IS NULL) AS sonraki_son
         FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref
        WHERE d.birlestirilen_ana_dosya_ref IS NULL AND (d.arsiv_zamani IS NOT NULL) = $3 AND ($4::text IS NULL OR d.dosya_no ILIKE '%' || $4 || '%' OR y.yat_adi ILIKE '%' || $4 || '%') AND ($1 OR EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = $2 AND a.bitis_zamani IS NULL))
        ORDER BY d.statu = 'Kapalı', array_position(ARRAY['Kritik','Yüksek','Normal','Planlı'], d.oncelik), sonraki_son NULLS LAST, d.acilis_tarihi ASC LIMIT 300` /* YG-039: öncelik, sözleşme süre taahhüdü (en yakın süre), geliş sırası; müşteri kayırılmaz */, [tum, o.kullanici, arsiv === '1', ara?.trim() || null])).rows;
  });

  // YG-092, YG-515: rolün bitmesi kimliği silmez; ilişki bitiş tarihi ve gerekçesiyle kapanır, bitmiş ilişkiye bildirim gitmez (aktif = false).
  s.post('/dosya-tarafi/:id/bitir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { gerekce } = (i.body ?? {}) as { gerekce?: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    const t = (await b.db.query(`SELECT t.dosya_ref, t.taraf_rolu, d.dosya_sorumlusu_ref FROM dosya_tarafi t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1 AND t.aktif`, [id])).rows[0];
    if (!t || !(await dosyaErisimi(b.db, o.kullanici, t.dosya_ref))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    if (t.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Taraf ilişkisini Dosya Sorumlusu sonlandırır.' });
    if (!gerekce?.trim()) return y.code(400).send({ hata: 'Sonlandırma gerekçesini yazınız.' });
    if (t.taraf_rolu === 'Yat Sahibi' && !(await b.db.query(`SELECT 1 FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif AND kimlik <> $2`, [t.dosya_ref, id])).rowCount) return y.code(409).send({ hata: 'Dosyada etkin başka yat sahibi kaydı olmadan yat sahibi ilişkisi sonlandırılamaz.' });
    await b.db.query(`UPDATE dosya_tarafi SET aktif = false, bitis_zamani = now(), bitis_gerekcesi = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, gerekce.trim()]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Taraf İlişkisi Sonlandırıldı', nesneTuru: 'Dosya', nesneKimligi: t.dosya_ref, yeni: { rol: t.taraf_rolu }, gerekce: gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  s.get('/dosya/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const d = await dosyaGetir(id, o.kullanici);
    if (!d) return yok(y);
    const yat = (await b.db.query(`SELECT y.kimlik, y.yat_adi, y.tur, y.bayrak, y.kullanim_amaci, y.klas_durumu, y.klas_kurulusu, y.tabi_kod, y.sicil_limani, y.kayit_surumu::int, y.tam_boy_m, y.govde_malzemesi, y.tahrik_turu, y.uretim_yili, y.sicil_bilgisi, y.govde_no, y.gecici_kayit, y.katalog_teyit, y.turkiye_kalis_bitis, y.yabanci_yat_belgesi, y.yabanci_yat_belge_no, y.yabanci_yat_belge_gecerlilik::text, y.gecici_ithalat_bitis::text, y.kislama_yeri, y.mmsi, y.motor_adedi, y.motor_marka_model, y.motor_gucu_hp, y.takyidat, y.mulkiyet_turu, (y.lehtar_adi IS NOT NULL OR y.lehtar_ref IS NOT NULL) AS lehtar_var, y.lehtar_muvafakati_ref, y.lehtar_adi, coalesce(m.marka, y.marka_diger) AS marka, coalesce(m.model, y.model_diger) AS model FROM yat y LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref WHERE y.kimlik = $1`, [d.yat_ref])).rows[0];
    if (yat) yat.govde_eslemesi = (await import('./zorunlu_form.js')).GOVDE_ESLEME[yat.govde_malzemesi ?? ''] ?? null; // YG-1531
    const talep = (await b.db.query(`SELECT talep_no, bildirim_kanali, talep_sahibi_adi, talep_sahibi_turu, ihbar_yetki_durumu, yat_mevcut_durumu, olay_yeri, ilk_yanit_zamani, oncelik_cevaplari FROM talep WHERE kimlik = $1`, [d.talep_ref])).rows[0];
    const taraflar = (await b.db.query(`SELECT t.kimlik, t.taraf_rolu, t.kisi_adi_soyadi, t.telefon, t.eposta, t.talep_sahibi_mi, t.kimlik_dogrulama_durumu, t.baslangic_zamani, r.tckn, r.tarama_sonucu FROM dosya_tarafi t LEFT JOIN taraf r ON r.kimlik = t.taraf_ref WHERE t.dosya_ref = $1 AND t.aktif ORDER BY t.olusturma_zamani`, [id])).rows.map((r) => ({ ...r, tckn: maskeTckn(r.tckn) }));
    const sigorta = (await b.db.query(`SELECT sigortaci_adi, police_no, sigorta_hasar_dosya_no, dosya_yetkilisi, onay_siniri, taniklik_talebi, cerceve_sozlesme_yok, onay_yetkilisi_eposta, (SELECT p.eposta FROM dosya_tarafi p WHERE p.kimlik = sigorta_taraf_ref) AS eposta FROM dosya_sigorta_kaydi WHERE dosya_ref = $1`, [id])).rows[0] ?? null;
    const ekip = (await b.db.query(`SELECT a.kimlik, a.rol, a.atama_zamani, h.ad_soyad, h.kimlik AS kullanici FROM dosya_ekibi_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.dosya_ref = $1 AND a.bitis_zamani IS NULL ORDER BY a.atama_zamani`, [id])).rows;
    const gecmis = (await b.db.query(`SELECT g.onceki_statu, g.onceki_asama, g.yeni_statu, g.yeni_asama, g.gerekce, g.sonraki_sorumlu_rol, g.olusturma_zamani, h.ad_soyad AS yapan, g.tamamlanan_kosullar,
      (SELECT array_agg(e.ad ORDER BY e.olusturma_zamani) FROM belge e WHERE e.kimlik = ANY (g.belgeler)) belgeler FROM dosya_statu_gecmisi g LEFT JOIN kullanici_hesabi h ON h.kimlik = g.olusturan_ref WHERE g.dosya_ref = $1 ORDER BY g.kimlik`, [id])).rows;
    const bekleme = (await b.db.query(`SELECT k.kimlik, k.neden, k.hedef_tarih::text, k.sayac_durur, k.uzatma_sayisi, k.olusturma_zamani, k.kaldirilma_zamani, k.gun45_karari, h.ad_soyad AS sorumlu FROM beklemede_isareti k JOIN kullanici_hesabi h ON h.kimlik = k.sorumlu_ref WHERE k.dosya_ref = $1 ORDER BY k.olusturma_zamani DESC`, [id])).rows;
    const sureler = (await b.db.query(`SELECT s.tur, s.baslangic, s.bitis + make_interval(secs => ${DURAK_SN}) AS bitis, s.kaydirma_notu, s.tamamlanma, s.baslangic_olayi, s.sure_birimi FROM dosya_sure s WHERE s.dosya_ref = $1 OR s.talep_ref = $2 ORDER BY s.bitis`, [id, d.talep_ref])).rows.map((r) => ({ ...r, renk: r.tamamlanma ? null : sureRengi(new Date(r.baslangic), new Date(r.bitis)) }));
    { const { sozlesmeHedefi } = await import('./kalan.js'); for (const s of sureler as Record<string, unknown>[]) s.sozlesme = await sozlesmeHedefi(b.db, id, String(s.tur)); } // YG-147
    const konular = (await b.db.query(`SELECT k.kimlik, k.konu_no, k.baslik, k.statu, k.hedef_tarih::text, k.asama, k.kabul_olcutu, k.gerekli_belge, k.konu_turu, k.kayit_surumu::int surum, h.ad_soyad AS sahip, (k.statu NOT IN ('Kapalı','Geçersiz') AND k.hedef_tarih < current_date) AS gecikmis FROM acik_konu k JOIN kullanici_hesabi h ON h.kimlik = k.sahip_ref WHERE k.dosya_ref = $1 ORDER BY k.olusturma_zamani`, [id])).rows;
    const iliskiler = (await b.db.query(`SELECT i.tur, i.gerekce, CASE WHEN i.kaynak_ref = $1 THEN h.dosya_no ELSE k.dosya_no END AS dosya_no FROM dosya_iliskisi i JOIN dosya k ON k.kimlik = i.kaynak_ref JOIN dosya h ON h.kimlik = i.hedef_ref WHERE i.kaynak_ref = $1 OR i.hedef_ref = $1`, [id])).rows;
    const izinler = await kullaniciIzinleri(b.db, o.kullanici);
    // YG-105: müşteri (yat sahibi) kaydındaki risk olayı ve vefat işareti dosya ekranında gösterilir.
    const risk = (await b.db.query(`SELECT r.risk_olayi FROM dosya_tarafi t JOIN taraf r ON r.kimlik = t.taraf_ref WHERE t.dosya_ref = $1 AND t.aktif AND t.taraf_rolu = 'Yat Sahibi' AND r.risk_olayi IS NOT NULL LIMIT 1`, [id])).rows[0]?.risk_olayi ?? (d.vefat_isareti ? 'Vefat' : null);
    // YG-086: kanuni sorumluluk bitişi sistem alanıdır; yalnız Direktör ve üstü görür.
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND (r.rol_adi LIKE '%Direktörü' OR r.rol_adi IN ('CEO', 'Genel Müdür Yardımcısı')) LIMIT 1`, [o.kullanici])).rowCount) delete (d as Record<string, unknown>).kanuni_sorumluluk_bitis;
    // YG-378: fiziksel ilerleme ve finansal gerçekleşme ayrı; finansal = reddedilmemiş hakediş brütü ÷ iptal edilmemiş iş emri firma bedeli.
    const fg = (await b.db.query(`SELECT coalesce(sum(e.firma_bedeli_eur), 0)::float b, coalesce((SELECT sum(h.bu_donem_brut) FROM hakedis h WHERE h.dosya_ref = $1 AND h.statu <> 'Reddedildi'), 0)::float h FROM is_emri e WHERE e.dosya_ref = $1 AND e.statu NOT IN ('İptal', 'Yerine Geçti', 'Taslak')`, [id])).rows[0];
    const gerceklesme = { fiziksel: d.ilerleme_yuzdesi === null || d.ilerleme_yuzdesi === undefined ? null : Number(d.ilerleme_yuzdesi), finansal: fg.b > 0 ? Math.floor((fg.h / fg.b) * 10000) / 100 : null };
    return { ...d, gerceklesme, musteri_risk_olayi: risk, yat, talep, taraflar, sigorta, ekip, gecmis, bekleme, sureler, konular, iliskiler, yapilacaklar: await yapilacaklar(b.db, d), izinler: izinler.filter((x) => x.startsWith('dosya.') || x === 'yat.duzelt'), rollerim: ekip.filter((e) => e.kullanici === o.kullanici).map((e) => e.rol), bireysel6502: d.musteri_turu === 'Bireysel Müşteri' && !/ticari/i.test(yat.kullanim_amaci ?? '') };
  });

  // YG-047, YG-146, YG-1535: atama önerisi kapasiteye göre sıralanır; %100 kişi seçilemez.
  s.get('/dosya/:id/ekip-oneri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { rol } = i.query as { rol?: string };
    const d = await dosyaGetir(id, o.kullanici);
    if (!d) return yok(y);
    const t = EKIP[rol ?? ''];
    if (!t) return y.code(400).send({ hata: 'Rol geçersiz.' });
    const sahipler = await rolSahipleri(b.db, await rolId(b.db, t.rol));
    const satir = [];
    const sinir = KAPASITE[rol!];
    const yd = Boolean((await b.db.query(`SELECT yurt_disi FROM dosya WHERE kimlik = $1`, [id])).rows[0]?.yurt_disi);
    for (const k of sahipler) {
      if (yd && !(await (await import('./ik.js')).yurtDisiUygunMu(b.db, k))) continue; // D-025
      const h = (await b.db.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1`, [k])).rows[0];
      const yuk = await kapasiteYuku(b.db, k, rol!);
      satir.push({ kimlik: k, ad_soyad: h.ad_soyad, yuk, sinir: sinir ?? null, oran: sinir ? Math.round((yuk / sinir) * 100) : null });
    }
    return satir.sort((a, c) => (a.oran ?? 0) - (c.oran ?? 0) || a.ad_soyad.localeCompare(c.ad_soyad, 'tr'));
  });

  // YG-047: atama talimattır, kabul/ret adımı yoktur; önceki atama silinmez. Tekil rolde devir notu olmadan yeni sorumluya geçilmez.
  s.post('/dosya/:id/ekip', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kullanici?: string; rol?: string; devirNotu?: string };
    const t = EKIP[g.rol ?? ''];
    if (!t || !g.kullanici) return y.code(400).send({ hata: 'Kişi ve rol seçiniz.' });
    const izinler = await kullaniciIzinleri(b.db, o.kullanici);
    if (!izinler.includes(t.izin)) return y.code(403).send({ hata: 'Bu atamayı yapma yetkiniz bulunmamaktadır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      const d = UUID.test(id) ? (await c.query(`SELECT * FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0] : undefined;
      if (!d) return dur(404, 'Dosya bulunamadı.');
      if (['Kapalı'].includes(d.statu)) return dur(409, 'Kapalı dosyada atama yapılamaz.');
      if (!(await rolSahipleri(c, await rolId(c, t.rol))).includes(g.kullanici)) return dur(400, `Seçilen kişi ${t.rol} rolünde değildir.`);
      { const be = await (await import('./ik.js')).personelBelgeEngeli(c, g.kullanici); if (be) return dur(409, be); } // YG-941
      { const pd = (await c.query(`SELECT personel_durumu FROM personel_karti WHERE kullanici_ref = $1`, [g.kullanici])).rows[0]?.personel_durumu as string | undefined; // YG-1479: yoktaki kişiye yeni dosya rolü verilmez
        if (pd && ['İzinli', 'Raporlu', 'Ayrılıyor', 'Ayrıldı'].includes(pd)) return dur(409, `Seçilen kişi şu an ${pd}; vekilini veya başka birini seçiniz.`); }
      if (g.rol === 'Yedek Sorumlu' && d.dosya_sorumlusu_ref === g.kullanici) return dur(400, 'Yedek sorumlu Dosya Sorumlusundan farklı olmalıdır.');
      if (g.rol === 'Dosya Sorumlusu' && d.yedek_sorumlu_ref === g.kullanici) return dur(400, 'Dosya Sorumlusu yedek sorumluyla aynı olamaz.');
      if (g.rol === 'Yedek Kalite Kontrolör' || g.rol === 'Kalite Kontrolör') { // YG-1687: yedek kontrolör asıl kontrolörden farklıdır
        const diger = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = $2 AND bitis_zamani IS NULL`, [id, g.rol === 'Kalite Kontrolör' ? 'Yedek Kalite Kontrolör' : 'Kalite Kontrolör'])).rows[0]?.kullanici_ref;
        if (g.rol === 'Yedek Kalite Kontrolör' && !diger) return dur(409, 'Önce dosyanın Kalite Kontrolörünü atayınız.');
        if (diger === g.kullanici) return dur(400, 'Yedek Kalite Kontrolör asıl Kalite Kontrolörden farklı olmalıdır.');
      }
      if (g.rol === 'Teknik Uzman' || g.rol === 'Sorumlu Teknik Uzman (Koordinatör)') if (await boyGovdeEksik(c, id)) return dur(409, 'Boy ve gövde malzemesi dolmadan Teknik Uzman atanamaz. Eksik bilgiyi tamamlayınız.');
      const sinir = KAPASITE[g.rol!]; let uyari: string | null = null;
      if (sinir) {
        const yuk = await kapasiteYuku(c, g.kullanici, g.rol!);
        const ek = g.rol === 'Saha Sorumlusu' ? 1 : Number(d.zorluk_katsayisi);
        const ood = (await c.query(`SELECT 1 FROM olaganustu_donem WHERE bitis IS NULL LIMIT 1`)).rowCount; // YG-1489: dönemde kapasite kilidi uyarıya döner
        if (yuk + ek > sinir && !ood) return dur(409, 'Kişinin kapasitesi doludur; başka birini seçiniz.');
        if ((yuk + ek) / sinir >= 0.8) {
          uyari = `Kişinin kapasitesi %${Math.round(((yuk + ek) / sinir) * 100)} dolu.`;
          // YG-543: %80 eşiğine ulaşan kişi için Operasyon Müdürüne günde bir kez bildirim.
          if (await birKez(c, 'kapasite-80', `${g.kullanici}:${new Date().toISOString().slice(0, 10)}`)) {
            const ad = (await c.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1`, [g.kullanici])).rows[0]?.ad_soyad ?? '';
            await bildir(c, { olay: `kapasite-80:${g.kullanici}:${id}`, kullanicilar: await rolSahipleri(c, await rolId(c, 'Operasyon Müdürü')), baslik: `İş Yükü Uyarısı: ${ad}`, ozet: `${g.rol} rolünde ${uyari}` });
          }
        }
      }
      // YG-248: nöbetteki kişi sahaya gitmez; vardiyası süren kişi Saha Sorumlusu atanamaz (firmayı uzaktan görevlendirir).
      if (g.rol === 'Saha Sorumlusu' && (await c.query(`SELECT 1 FROM nobet_vardiyasi v JOIN nobet_cizelgesi z ON z.kimlik = v.cizelge_ref WHERE z.durum = 'Yürürlükte' AND v.kullanici_ref = $1 AND now() BETWEEN v.baslangic AND v.bitis`, [g.kullanici])).rowCount) return dur(409, 'Kişi şu an nöbettedir; nöbetçi sahaya gitmez, işi firmaya uzaktan görevlendirir.');
      if (t.tekil) {
        const eski = (await c.query(`SELECT kimlik, kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = $2 AND bitis_zamani IS NULL FOR UPDATE`, [id, g.rol])).rows[0];
        if (eski?.kullanici_ref === g.kullanici) return dur(409, 'Kişi bu rolde zaten atanmıştır.');
        if (eski && !g.devirNotu?.trim()) return dur(400, 'Devir notu olmadan yeni sorumluya geçilemez.');
        if (eski) { await c.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now(), devir_notu = $2 WHERE kimlik = $1`, [eski.kimlik, g.devirNotu!.trim()]); await atamaKapanisKontrolu(c, id, eski.kullanici_ref); } // YG-312
      } else if ((await c.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = $3 AND bitis_zamani IS NULL`, [id, g.kullanici, g.rol])).rowCount) return dur(409, 'Kişi bu rolde zaten atanmıştır.');
      await c.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,$3,$4)`, [id, g.kullanici, g.rol, o.kullanici]);
      if (g.rol === 'Kalite Kontrolör') await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Kalite Kontrolör Ataması' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]); // YG-1687
      if (g.rol === 'Operasyon Yöneticisi' || g.rol === 'Teknik Yönetici') { // K-240: yat değeri görevi atanan kişiye düşer; devredilenin görevi kapanır.
        await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Yat Değeri Görüşü' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı' AND sahip_kullanici_ref NOT IN (SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1::uuid AND bitis_zamani IS NULL)`, [id]);
        const dv = (await c.query(`SELECT dosya_no, hizmet_turu FROM dosya WHERE kimlik = $1`, [id])).rows[0];
        if (dv.hizmet_turu === 'Hasar onarımı') await kartAc(c, { tur: 'Yat Değeri Görüşü', kategori: 'islem', baslik: `${dv.dosya_no} · Yat Değeri Ortak Kararı`, sahipKullanici: g.kullanici, nesneTuru: 'Dosya', nesneKimligi: id });
      }
      if (g.rol === 'Dosya Sorumlusu') {
        await c.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [id, g.kullanici]);
        // YG-722, V-481: ilk Dosya Sorumlusu atanınca FR-OPS-016 yat sahibine gider (sigortalı/sigortasız hasar, planlı hizmet varyantı); devirde yeniden gönderilmez.
        const ia = (await c.query(`SELECT d.musteri_turu, d.oncelik, d.hizmet_turu, (SELECT eposta FROM dosya_tarafi WHERE dosya_ref = d.kimlik AND aktif AND taraf_rolu IN ('Yat Sahibi', 'Yetkili Temsilci') AND eposta IS NOT NULL ORDER BY taraf_rolu = 'Yat Sahibi' DESC LIMIT 1) eposta FROM dosya d WHERE d.kimlik = $1`, [id])).rows[0];
        // YG-1445: sigortalı dosyada BLD-68 "görevlendirmeniz alındı, dosya açıldı" sigortaya teyitli e-postayla gider (bir kez).
        if (ia.musteri_turu === 'Sigorta Şirketi') {
          const sg = (await c.query(`SELECT s.sigortaci_adi, s.sigorta_hasar_dosya_no, coalesce(s.onay_yetkilisi_eposta, p.eposta) eposta FROM dosya_sigorta_kaydi s LEFT JOIN dosya_tarafi p ON p.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1 LIMIT 1`, [id])).rows[0];
          const dl = (await c.query(`SELECT yazisma_dili FROM dosya WHERE kimlik = $1`, [id])).rows[0].yazisma_dili;
          if (sg) await (await import('./sigorta_gonderim.js')).sigortayaHazirla(c, { dosya: id, tur: 'BLD-68', nesne: id, alici: sg.eposta ?? null, konu: `${d.dosya_no} Görevlendirme Alındı`, sorumlu: g.kullanici,
            metin: await (await import('./metin.js')).metinGetir(c, 'BLD-68', dilKod(dl), { Kurum: sg.sigortaci_adi ?? '', Institution: sg.sigortaci_adi ?? '', 'Hasar Dosya No': sg.sigorta_hasar_dosya_no ?? '---', 'Claim No': sg.sigorta_hasar_dosya_no ?? '---', 'Dosya No': d.dosya_no, 'File No': d.dosya_no }) });
        }
        if (!(await c.query(`SELECT 1 FROM belge_uretim WHERE tur = 'İhbar Alındı' AND nesne = $1`, [id])).rowCount)
          await (await import('./belge_uret.js')).belgeUret(c, { tur: 'İhbar Alındı', nesne: id, dosya: id, gonder: ia.eposta ? { olay: `ihbar-alindi-pdf:${id}`, eposta: ia.eposta, konu: `${d.dosya_no} İhbar Alındı`, metin: `${d.dosya_no} İhbar Alındı` } : undefined });
      }
      if (g.rol === 'Yedek Sorumlu') await c.query(`UPDATE dosya SET yedek_sorumlu_ref = $2 WHERE kimlik = $1`, [id, g.kullanici]);
      if (g.rol === 'Saha Sorumlusu') await kartKapat(c, 'Saha Sorumlusu Ataması', id); // YG-051
      if (g.rol === 'Teknik Uzman' || g.rol === 'Sorumlu Teknik Uzman (Koordinatör)') await sureBitir(c, { tur: 'Teknik Uzman Ataması', dosya: id });
      const atananRoller = new Set((await c.query(`SELECT rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL`, [id])).rows.map((r) => r.rol as string));
      if (atananRoller.has('Dosya Sorumlusu') && atananRoller.has('Operasyon Yöneticisi')) await kartKapat(c, 'Dosya Ekibi Ataması', id);
      if ((atananRoller.has('Teknik Uzman') || atananRoller.has('Sorumlu Teknik Uzman (Koordinatör)')) && atananRoller.has('Teknik Yönetici')) await kartKapat(c, 'Teknik Ekip Ataması', id);
      await bildir(c, { olay: `dosya-atama:${id}:${g.rol}:${g.kullanici}`, kullanicilar: [g.kullanici], baslik: `Dosyaya Atandınız: ${d.dosya_no}`, ozet: g.rol, oncelik: d.oncelik, eposta: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Dosya Ekibi Ataması', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { rol: g.rol, kullanici: g.kullanici }, gerekce: g.devirNotu, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await aktifeGecir(c, id, o.kullanici);
      await c.query('COMMIT');
      return { tamam: true, uyari };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-1530: eksik bilgi tamamlanınca teknik atama kartı açılır.
  s.post('/dosya/:id/yat-bilgisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { boy?: number; govde?: string; tahrik?: string; kaynak?: string; teyit?: string; genislik?: number; derinlik?: number; surum?: number };
    const d = await dosyaGetir(id, o.kullanici);
    if (!d) return yok(y);
    if (await surumCakismasi(b.db, y, 'yat', d.yat_ref, g.surum)) return y; // YG-1382
    // YG-1707: kalıp genişliği ve derinliği GMO tarifeli kalemler için.
    if (g.genislik !== undefined || g.derinlik !== undefined) {
      if ((g.genislik !== undefined && !(g.genislik > 0)) || (g.derinlik !== undefined && !(g.derinlik > 0))) return y.code(400).send({ hata: 'Genişlik veya derinlik geçersiz.' });
      await b.db.query(`UPDATE yat SET genislik_m = coalesce($2, genislik_m), derinlik_m = coalesce($3, derinlik_m) WHERE kimlik = $1`, [d.yat_ref, g.genislik ?? null, g.derinlik ?? null]);
      if (g.boy === undefined && !g.govde && !g.tahrik && !g.teyit) return { tamam: true };
    }
    const eski = (await b.db.query(`SELECT tam_boy_m, govde_malzemesi, tahrik_turu, katalog_teyit FROM yat WHERE kimlik = $1`, [d.yat_ref])).rows[0];
    const kaynak = ['Ruhsat', 'Telefon (kaptan / yat sahibi)', 'Teknik Uzman keşfi'].includes(g.kaynak ?? '') ? g.kaynak! : null;
    if ((g.boy !== undefined || g.govde) && !kaynak) return y.code(400).send({ hata: 'Bilginin kaynağını seçiniz.' });
    if (g.boy !== undefined && !(g.boy > 0)) return y.code(400).send({ hata: 'Boy geçersiz.' });
    if (g.govde && !['Fiber', 'Ahşap', 'Çelik', 'Alüminyum', 'Bilinmiyor'].includes(g.govde)) return y.code(400).send({ hata: 'Gövde malzemesi geçersiz.' });
    // YG-1529: katalog değerini Teknik Uzman teyit eder veya düzeltir; düzeltme denetim izine yazılır.
    if (g.teyit && !['Teyit edildi', 'Düzeltildi'].includes(g.teyit)) return y.code(400).send({ hata: 'Teyit değeri geçersiz.' });
    await b.db.query(`UPDATE yat SET tam_boy_m = coalesce($2, tam_boy_m), boy_kaynagi = CASE WHEN $2::numeric IS NOT NULL THEN $5 ELSE boy_kaynagi END, govde_malzemesi = coalesce($3, govde_malzemesi), govde_kaynagi = CASE WHEN $3::text IS NOT NULL THEN $5 ELSE govde_kaynagi END, tahrik_turu = coalesce($4, tahrik_turu), katalog_teyit = coalesce($6, katalog_teyit), guncelleme_zamani = now() WHERE kimlik = $1`,
      [d.yat_ref, g.boy ?? null, g.govde ?? null, g.tahrik?.trim() || null, kaynak, g.teyit ?? null]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yat Bilgisi Tamamlandı', nesneTuru: 'Yat', nesneKimligi: d.yat_ref, eski, yeni: g, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    if (!(await boyGovdeEksik(b.db, id))) {
      await kartKapat(b.db, 'Eksik Bilgi', id);
      if (!(await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Teknik Ekip Ataması' AND nesne_kimligi = $1`, [id])).rowCount) await kartAc(b.db, { tur: 'Teknik Ekip Ataması', baslik: `${d.dosya_no} · Teknik Uzman ve Teknik Yönetici Ata`, ozet: d.kisa_teknik_tanim.slice(0, 200), sahipRol: await rolId(b.db, 'Teknik Müdür'), kategori: 'islem', nesneTuru: 'Dosya', nesneKimligi: id });
    }
    return { tamam: true };
  });

  // YG-061, YG-065, YG-067: aşama yalnız ileri ve kapı koşullarıyla değişir. Engel tek cümleyle gösterilir.
  s.post('/dosya/:id/asama', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { asama?: string; gerekce?: string };
    const d = await dosyaGetir(id, o.kullanici);
    if (!d) return yok(y);
    if (d.dosya_sorumlusu_ref !== o.kullanici && !(await kullaniciIzinleri(b.db, o.kullanici)).includes('dosya.statu')) return y.code(403).send({ hata: 'Aşamayı yalnız Dosya Sorumlusu değiştirir.' });
    if (d.statu !== 'Aktif') return y.code(409).send({ hata: 'Aşama yalnız Aktif dosyada değişir.' });
    const sonraki = ASAMALAR[ASAMALAR.indexOf(d.asama) + 1];
    if (!g.asama || g.asama !== sonraki) return y.code(400).send({ hata: `Sıradaki aşama ${sonraki ?? 'yok'}.` });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Açıklama zorunludur.' });
    for (const k of KAPILAR.get(g.asama) ?? []) {
      const h = await k(b.db, d); if (!h) continue;
      // YG-158: kapıdaki eksik kayıt Dosya Sorumlusuna görev olarak döner; aynı eksik için ikinci açık görev açılmaz.
      const sahip = d.dosya_sorumlusu_ref ?? o.kullanici;
      if (!(await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Aşama Kapısı Eksiği' AND nesne_kimligi = $1 AND ozet = $2 AND durum NOT IN ('Tamamlandı', 'İptal')`, [id, h])).rowCount)
        await kartAc(b.db, { tur: 'Aşama Kapısı Eksiği', kategori: 'gorev', baslik: `${d.dosya_no} · ${g.asama} Aşamasına Geçiş İçin Eksik`, ozet: h, oncelik: d.oncelik === 'Kritik' ? 'Kritik' : 'Normal', sahipKullanici: sahip, nesneTuru: 'Dosya', nesneKimligi: id });
      return y.code(409).send({ hata: h });
    }
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Aşama Kapısı Eksiği' AND nesne_kimligi = $1 AND durum NOT IN ('Tamamlandı', 'İptal')`, [id]); // YG-158
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await statuYaz(c, d, { statu: 'Aktif', asama: g.asama }, g.gerekce.trim(), o.kullanici, 'Dosya Sorumlusu');
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Dosya Aşaması', nesneTuru: 'Dosya', nesneKimligi: id, eski: { asama: d.asama }, yeni: { asama: g.asama }, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    return { tamam: true };
  });

  // YG-036: yükseltme serbest; Normal veya Planlı'ya düşürme gerekçeyle talep edilir, Operasyon Yöneticisi ve Teknik Yönetici birlikte onaylar.
  s.post('/dosya/:id/oncelik', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { oncelik?: string; gerekce?: string };
    const d = await dosyaGetir(id, o.kullanici);
    if (!d) return yok(y);
    if (!ONCELIK_SIRA.includes(g.oncelik ?? '') || g.oncelik === d.oncelik) return y.code(400).send({ hata: 'Önceliği listeden seçmenizi rica ederiz.' });
    if (['Teknik Kapalı', 'Kapalı'].includes(d.statu)) return y.code(409).send({ hata: 'Kapanan dosyada öncelik değişmez.' });
    const ekip = (await b.db.query(`SELECT rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL`, [id, o.kullanici])).rows.map((r) => r.rol as string);
    const DS = ekip.includes('Dosya Sorumlusu'); const TU = ekip.includes('Teknik Uzman') || ekip.includes('Sorumlu Teknik Uzman (Koordinatör)');
    const yukselt = ONCELIK_SIRA.indexOf(g.oncelik!) > ONCELIK_SIRA.indexOf(d.oncelik);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      if (yukselt) {
        if (!DS) return dur(403, 'Önceliği Dosya Sorumlusu yükseltir.');
        await c.query(`UPDATE dosya SET oncelik = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, g.oncelik]);
        await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Öncelik Yükseltildi', nesneTuru: 'Dosya', nesneKimligi: id, eski: { oncelik: d.oncelik }, yeni: { oncelik: g.oncelik }, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
        await c.query('COMMIT');
        return { durum: 'Yükseltildi' };
      }
      if (!DS && !TU) return dur(403, 'Düşürmeyi Dosya Sorumlusu veya Teknik Uzman talep eder.');
      if (!g.gerekce?.trim()) return dur(400, 'Düşürme gerekçesi zorunludur.');
      if (!['Normal', 'Planlı'].includes(g.oncelik!)) return dur(400, 'Kritik öncelik risk kontrol altına alınınca kendiliğinden Yüksek olur; düşürme Normal veya Planlı için talep edilir.');
      if ((await c.query(`SELECT 1 FROM oncelik_talebi WHERE dosya_ref = $1 AND durum = 'Bekliyor'`, [id])).rowCount) return dur(409, 'Bekleyen düşürme talebi vardır.');
      const t = (await c.query(`INSERT INTO oncelik_talebi (dosya_ref, eski_oncelik, yeni_oncelik, gerekce, talep_eden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [id, d.oncelik, g.oncelik, g.gerekce.trim(), o.kullanici])).rows[0];
      if (!(await dusurmeKarti(c, { ...t, dosya_no: d.dosya_no }, 0))) return dur(409, 'Onaylayacak makam bulunamadı.');
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Öncelik Düşürme Talebi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { oncelik: g.oncelik }, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { durum: 'Onaya Gönderildi' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-1486: yurt dışı dosyada Dosya Sorumlusu ulaşım planı tarihini girer; randevu sayacı bu tarihten kurulur.
  s.post('/dosya/:id/ulasim-plani', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { zaman?: string };
    const d = await dosyaGetir(id, o.kullanici);
    if (!d) return yok(y);
    if (d.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Bu kaydı Dosya Sorumlusu girer.' });
    if (!d.yurt_disi) return y.code(409).send({ hata: 'Ulaşım planı yurt dışı dosyada girilir.' });
    const z = g.zaman ? new Date(g.zaman) : null;
    if (!z || Number.isNaN(z.getTime())) return y.code(400).send({ hata: 'Ulaşım planı tarihini giriniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE dosya SET ulasim_plani_zamani = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, z]);
      await (await import('./sure.js')).sureKur(c, { tur: 'Randevu İletişimi', oncelik: d.oncelik, baslangic: z, dosya: id });
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Ulaşım Planı' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı'`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ulaşım Planı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { ulasim_plani_zamani: z.toISOString() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    return { zaman: z.toISOString() };
  });

  // YG-1595: Kritik yalnız acil evrede geçerlidir; risk kontrol altına alınınca kendiliğinden Yüksek olur, keşif Yüksek sürelerle yürür.
  s.post('/dosya/:id/risk-kontrol', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const d = await dosyaGetir(id, o.kullanici);
    if (!d) return yok(y);
    if (d.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Bu kaydı Dosya Sorumlusu girer.' });
    if (d.oncelik !== 'Kritik') return y.code(409).send({ hata: 'Dosya Kritik öncelikte değildir.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE dosya SET oncelik = 'Yüksek', risk_kontrol_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1`, [id]);
      await sureBitir(c, { tur: 'Sahaya Ulaşma', dosya: id });
      await sureBaslat(c, { tur: 'Randevu İletişimi', oncelik: 'Yüksek', baslangic: new Date(), dosya: id });
      const ekip = (await c.query(`SELECT DISTINCT kullanici_ref k FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL`, [id])).rows.map((r) => r.k as string);
      await bildir(c, { olay: `risk-kontrol:${id}`, kullanicilar: ekip.filter((x) => x !== o.kullanici), baslik: `Risk Kontrol Altına Alındı: ${d.dosya_no}`, ozet: 'Öncelik Yüksek oldu.', eposta: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Risk Kontrol Altına Alındı', nesneTuru: 'Dosya', nesneKimligi: id, eski: { oncelik: 'Kritik' }, yeni: { oncelik: 'Yüksek' }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    return { oncelik: 'Yüksek' };
  });

  // YG-068, YG-1491: Beklemede statü değildir; neden, sorumlu, hedef tarih ve kanıt olmadan konamaz. Dosya statüsü korunur.
  // YG-569, YG-570: dış kanaldan alınan talimat/karar özgün metin, tarih ve göndereniyle kaydedilir; kayıt değiştirilemez, aktaranın notu ayrı alandadır.
  s.get('/dosya/:id/talimatlar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const kayitlar = (await b.db.query(`SELECT t.kimlik, t.kanal, t.tur, t.gonderen, t.alinma_zamani, t.ozgun_metin, t.belge_ref, t.aktaran_notu, h.ad_soyad kaydeden, t.kayit_zamani, t.kaynak_yetkili, t.kaynak_sonucu, t.kaynak_notu, (SELECT x.taraf_rolu FROM dosya_tarafi x WHERE x.kimlik = t.kaynak_taraf_ref) kaynak_rolu FROM talimat_kaydi t JOIN kullanici_hesabi h ON h.kimlik = t.kaydeden_ref WHERE t.dosya_ref = $1 ORDER BY t.alinma_zamani DESC`, [id])).rows;
    // YG-158: kaynak seçimi için dosyanın aktif tarafları (sistem kimliği gösterilmez).
    if (i.query && (i.query as { taraflar?: string }).taraflar) return { kayitlar, taraflar: (await b.db.query(`SELECT kimlik, taraf_rolu, kisi_adi_soyadi FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif ORDER BY taraf_rolu`, [id])).rows };
    return kayitlar;
  });
  // YG-158: yetkisiz kaynaktan gelen talimat/kararı Dosya Sorumlusu yetkili taraftan teyit alarak doğrular ya da dikkate almaz; gerekçe zorunlu.
  s.post('/talimat/:id/kaynak', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; not?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT t.dosya_ref, t.kaynak_yetkili, t.kaynak_sonucu, d.dosya_sorumlusu_ref, d.yedek_sorumlu_ref FROM talimat_kaydi t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1`, [id])).rows[0];
    if (!t || !(await dosyaErisimi(b.db, o.kullanici, t.dosya_ref))) return yok(y);
    if (![t.dosya_sorumlusu_ref, t.yedek_sorumlu_ref].includes(o.kullanici)) return y.code(403).send({ hata: 'Kaynağı Dosya Sorumlusu doğrular.' });
    if (t.kaynak_yetkili || t.kaynak_sonucu) return y.code(409).send({ hata: 'Bu kaydın kaynağı için işlem gerekmez.' });
    if (!['Doğrulandı', 'Dikkate Alınmadı'].includes(g.sonuc ?? '') || !g.not?.trim()) return y.code(400).send({ hata: 'Sonucu seçip yetkili taraftan alınan teyidi veya gerekçeyi yazınız.' });
    await b.db.query(`UPDATE talimat_kaydi SET kaynak_sonucu = $2, kaynak_notu = $3, kaynak_dogrulayan_ref = $4, kaynak_dogrulama_zamani = now() WHERE kimlik = $1`, [id, g.sonuc, g.not.trim(), o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Yetkisiz Kaynak Talimatı' AND nesne_kimligi = $1 AND durum NOT IN ('Tamamlandı', 'İptal') AND NOT EXISTS (SELECT 1 FROM talimat_kaydi WHERE dosya_ref = $1::uuid AND tur IN ('Talimat', 'Karar') AND NOT kaynak_yetkili AND kaynak_sonucu IS NULL)`, [t.dosya_ref]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Talimat Kaynağı', nesneTuru: 'Dosya', nesneKimligi: t.dosya_ref, yeni: { talimat: id, sonuc: g.sonuc }, gerekce: g.not.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/dosya/:id/talimat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kanal?: string; tur?: string; gonderen?: string; zaman?: string; metin?: string; belge?: string; not?: string; kaynakTaraf?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    if (!['E-posta', 'Telefon', 'SMS', 'WhatsApp', 'WhatsApp Grubu', 'Yüz Yüze', 'Diğer'].includes(g.kanal ?? '') || !['Talimat', 'Karar', 'Bilgi'].includes(g.tur ?? 'Talimat')) return y.code(400).send({ hata: 'Kanalı ve kayıt türünü seçiniz.' });
    if (!g.gonderen?.trim() || !g.zaman || !g.metin?.trim()) return y.code(400).send({ hata: 'Gönderen, alınma zamanı ve özgün ileti metni zorunludur.' });
    if (new Date(g.zaman).getTime() > Date.now() + 60_000) return y.code(400).send({ hata: 'Alınma zamanı ileri bir tarih olamaz.' });
    if (g.belge && (!UUID.test(g.belge) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2`, [g.belge, id])).rowCount)) return y.code(400).send({ hata: 'Ekran görüntüsü veya ileti belgesi bu dosyaya yüklenmiş olmalıdır.' });
    // YG-158: kaynak Yat Sahibi ya da geçerli yetki kaydı olan taraf değilse kayıt yetkisiz kaynak sayılır.
    if (g.kaynakTaraf && (!UUID.test(g.kaynakTaraf) || !(await b.db.query(`SELECT 1 FROM dosya_tarafi WHERE kimlik = $1 AND dosya_ref = $2 AND aktif`, [g.kaynakTaraf, id])).rowCount)) return y.code(400).send({ hata: 'Gönderen taraf bu dosyada kayıtlı değildir.' });
    const yetkili = Boolean(g.kaynakTaraf && (await b.db.query(`SELECT 1 FROM dosya_tarafi x WHERE x.kimlik = $1 AND x.taraf_rolu = 'Yat Sahibi' UNION SELECT 1 FROM yetki_kaydi k WHERE k.dosya_tarafi_ref = $1 AND k.yetki_durumu = 'Geçerli' AND (k.gecerlilik_bitisi IS NULL OR k.gecerlilik_bitisi >= current_date) LIMIT 1`, [g.kaynakTaraf])).rowCount);
    const r = (await b.db.query(`INSERT INTO talimat_kaydi (dosya_ref, kanal, tur, gonderen, alinma_zamani, ozgun_metin, belge_ref, aktaran_notu, kaydeden_ref, kaynak_taraf_ref, kaynak_yetkili) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`, [id, g.kanal, g.tur ?? 'Talimat', g.gonderen.trim(), g.zaman, g.metin.trim(), g.belge || null, g.not?.trim() || null, o.kullanici, g.kaynakTaraf || null, yetkili || (g.tur ?? 'Talimat') === 'Bilgi'])).rows[0];
    if (!yetkili && (g.tur ?? 'Talimat') !== 'Bilgi') {
      const ds = (await b.db.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      if (ds?.dosya_sorumlusu_ref) await kartAc(b.db, { tur: 'Yetkisiz Kaynak Talimatı', kategori: 'gorev', baslik: `${ds.dosya_no} · Yetkisiz Kaynaktan ${g.tur ?? 'Talimat'}: Kaynağı Doğrulayınız`, ozet: `${g.gonderen.trim()} · ${g.kanal}`, oncelik: 'Yüksek', sahipKullanici: ds.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: id });
    }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Talimat Kaydı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { kanal: g.kanal, tur: g.tur ?? 'Talimat', gonderen: g.gonderen, kaynakYetkili: yetkili }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik, kaynakYetkili: yetkili };
  });
  s.post('/dosya/:id/beklemede', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { neden?: string; sorumlu?: string; hedefTarih?: string; kanitBelge?: string; mesaj?: string; tedarikciKaynakli?: boolean; isEmri?: string };
    const d = await dosyaGetir(id, o.kullanici);
    if (!d) return yok(y);
    if (['Kapalı'].includes(d.statu)) return y.code(409).send({ hata: 'Beklemede işareti açık dosyalarda kullanılır.' });
    const n = (await b.db.query(`SELECT aciklama FROM deger_listesi WHERE liste_kodu = 'LST_BEKLEME_NEDENI' AND deger = $1`, [g.neden ?? ''])).rows[0];
    if (!n) return y.code(400).send({ hata: 'Bekleme nedenini listeden seçiniz.' });
    if (!g.sorumlu || !(await dosyaErisimi(b.db, g.sorumlu, id))) return y.code(400).send({ hata: 'Sorumluyu dosya ekibinden seçiniz.' });
    const bugun = new Date().toISOString().slice(0, 10);
    if (!g.hedefTarih || g.hedefTarih <= bugun) return y.code(400).send({ hata: 'Hedef tarih bugünden sonra olmalıdır.' });
    if (!g.kanitBelge || !UUID.test(g.kanitBelge) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2`, [g.kanitBelge, id])).rowCount) return y.code(400).send({ hata: 'İşaret için önce kanıt belgesini dosyaya yüklemenizi rica ederiz.' });
    if (g.mesaj && /firma|çözüm ortağı/i.test(g.mesaj)) return y.code(400).send({ hata: 'Durum mesajında firma bilgisine yer vermemenizi rica ederiz.' });
    // YG-068 (PKT-1): işaret iş emrine (paket) de konabilir; dosya statüsü ve dosya sayaçları değişmez, yat tarafına ileti gitmez.
    if (g.isEmri && !(await (await import('./is_emri_bag.js')).isEmriGecerli(b.db, id, g.isEmri))) return y.code(400).send({ hata: 'İş emri bu dosyada bulunamadı veya geçerli değildir.' });
    const durur = g.isEmri ? false : n.aciklama.includes('sayaç işler') ? false : g.neden === 'Parça' ? Boolean(g.tedarikciKaynakli) : true;
    if ((await b.db.query(`SELECT 1 FROM beklemede_isareti WHERE dosya_ref = $1 AND neden = $2 AND kaldirilma_zamani IS NULL AND kayit_referansi IS NOT DISTINCT FROM $3`, [id, g.neden, g.isEmri || null])).rowCount) return y.code(409).send({ hata: 'Bu nedenle açık işaret vardır.' });
    // YG-046: süreyi durduran işaret yalnız Dosya Sorumlusu, dosyanın Operasyon Yöneticisi veya Operasyon Müdürünce konur.
    if (durur && !(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND dosya_sorumlusu_ref = $2 UNION ALL SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = 'Operasyon Yöneticisi' AND bitis_zamani IS NULL UNION ALL SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $2 AND a.atama_durumu = 'Aktif' AND r.rol_adi = 'Operasyon Müdürü' LIMIT 1`, [id, o.kullanici])).rowCount) return y.code(403).send({ hata: 'Süreyi durduran Beklemede işaretini Dosya Sorumlusu, Operasyon Yöneticisi veya Operasyon Müdürü koyar.' });
    const r = (await b.db.query(`INSERT INTO beklemede_isareti (dosya_ref, neden, sorumlu_ref, hedef_tarih, durum_mesaji, kanit_belge_ref, sayac_durur, olusturan_ref, kayit_turu, kayit_referansi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`, [id, g.neden, g.sorumlu, g.hedefTarih, g.mesaj?.trim() || null, g.kanitBelge, durur, o.kullanici, g.isEmri ? 'İş Emri' : 'Dosya', g.isEmri || null])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Beklemede İşareti', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { neden: g.neden, hedef: g.hedefTarih }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    // BLD-06: Müşteri kararı ve bilgi dışında yat tarafı bilgilendirilir. Vefat işaretinde otomatik ileti durur (YG-1477).
    if (!d.vefat_isareti && !g.isEmri) {
      const t = (await b.db.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [id])).rows[0];
      if (t) await yatTarafinaYaz(b.db, { olay: `bld06:${r.kimlik}`, kod: 'BLD-06', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Beklemede`, telefon: t.telefon, eposta: t.eposta, alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, neden: g.neden!.toLocaleLowerCase('tr'), reason: g.neden!, 'bağlantı': b.webAdresi, link: b.webAdresi } });
    }
    return { kimlik: r.kimlik, sayacDurur: durur };
  });

  const beklemedeGetir = async (id: string, k: string) => {
    if (!UUID.test(id)) return undefined;
    const r = (await b.db.query(`SELECT k.*, d.dosya_no, d.statu, d.asama FROM beklemede_isareti k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.kimlik = $1`, [id])).rows[0];
    return r && await dosyaErisimi(b.db, k, r.dosya_ref) ? r : undefined;
  };

  s.post('/beklemede/:id/kaldir', oturumlu, async (i, y) => {
    const o = i.oturum!; const r = await beklemedeGetir((i.params as { id: string }).id, o.kullanici);
    if (!r) return yok(y);
    if (r.kaldirilma_zamani) return y.code(409).send({ hata: 'İşaret kaldırılmıştır.' });
    await b.db.query(`UPDATE beklemede_isareti SET kaldirilma_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1`, [r.kimlik]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Beklemede Kaldırıldı', nesneTuru: 'Dosya', nesneKimligi: r.dosya_ref, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-070: her seferinde 15 gün; ilk üç uzatma Operasyon Müdürü, sonrası üst makam.
  s.post('/beklemede/:id/uzat', oturumlu, async (i, y) => {
    const o = i.oturum!; const r = await beklemedeGetir((i.params as { id: string }).id, o.kullanici); const { gerekce } = (i.body ?? {}) as { gerekce?: string };
    if (!r) return yok(y);
    if (r.kaldirilma_zamani) return y.code(409).send({ hata: 'İşaret kaldırılmıştır.' });
    if (!gerekce?.trim()) return y.code(400).send({ hata: 'Uzatma gerekçesi zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Beklemede Uzatma' AND nesne_kimligi = $1 AND durum IN ('Bekliyor', 'İade Edildi')`, [r.kimlik])).rowCount) return y.code(409).send({ hata: 'Bekleyen uzatma talebi vardır.' });
    const makam = await rolId(b.db, r.uzatma_sayisi < 3 ? 'Operasyon Müdürü' : 'Teknik ve Operasyon Direktörü');
    await kartAc(b.db, { tur: 'Beklemede Uzatma', baslik: `${r.dosya_no} · Beklemede 15 Gün Uzatma (${r.uzatma_sayisi + 1}. Uzatma)`, ozet: gerekce.trim(), hazirlayan: o.kullanici, zincir: [makam], nesneTuru: 'Beklemede', nesneKimligi: r.kimlik });
    return { durum: 'Onaya Gönderildi' };
  });

  // YG-069: 45. gün kararı. Kontrollü Askıda dosyayı askıya alır; Kapanış ilgili kapanış adımını açar, otomatik kapanmaz.
  s.post('/beklemede/:id/karar', { preHandler: izinGerekli(b, 'dosya.ata.operasyon') }, async (i, y) => {
    const o = i.oturum!; const r = await beklemedeGetir((i.params as { id: string }).id, o.kullanici); const { karar, kosul } = (i.body ?? {}) as { karar?: string; kosul?: string };
    if (!r) return yok(y);
    if (!['Devam', 'Kontrollü Askıda', 'Kapanış'].includes(karar ?? '')) return y.code(400).send({ hata: 'Kararı seçmenizi rica ederiz.' });
    if (karar === 'Kontrollü Askıda' && !kosul?.trim()) return y.code(400).send({ hata: 'Çalışmalara hangi koşulda yeniden başlanacağını yazınız.' }); // TZ-9 BLD-10
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE beklemede_isareti SET gun45_karari = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [r.kimlik, karar]);
      await kartKapat(c, 'Beklemede 45. Gün Kararı', r.kimlik);
      if (karar === 'Kontrollü Askıda' && r.statu === 'Aktif') await statuYaz(c, { kimlik: r.dosya_ref, statu: r.statu, asama: r.asama }, { statu: 'Kontrollü Askıda', asama: r.asama }, '45. gün kararı', o.kullanici, 'Operasyon Müdürü');
      if (karar === 'Kontrollü Askıda' && r.statu === 'Aktif') { // TZ-9: BLD-10 yat sahibine (vefat askısında otomatik ileti durur)
        const d = (await c.query(`SELECT dosya_no, yazisma_dili, vefat_isareti FROM dosya WHERE kimlik = $1`, [r.dosya_ref])).rows[0];
        const ts = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [r.dosya_ref])).rows[0];
        if (ts && !d.vefat_isareti) await yatTarafinaYaz(c, { olay: `bld10:${r.kimlik}`, kod: 'BLD-10', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Askı`, telefon: ts.telefon, eposta: ts.eposta, alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, neden: String(r.neden).toLocaleLowerCase('tr'), reason: String(r.neden), koşul: kosul!.trim(), condition: kosul!.trim(), 'bağlantı': b.webAdresi, link: b.webAdresi } });
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Beklemede 45. Gün Kararı', nesneTuru: 'Dosya', nesneKimligi: r.dosya_ref, yeni: { karar, kosul }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    return { tamam: true };
  });

  // YG-059: sahipsiz açılamaz, hedef tarih zorunlu; kapanış kanıt ve bağımsız yeniden kontrolle.
  s.post('/dosya/:id/konu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { baslik?: string; aciklama?: string; sahip?: string; hedefTarih?: string; kabulOlcutu?: string; gerekliBelge?: string; oncelik?: string };
    const d = await dosyaGetir(id, o.kullanici);
    if (!d) return yok(y);
    if (!g.baslik?.trim()) return y.code(400).send({ hata: 'Konu başlığı zorunludur.' });
    if (!g.kabulOlcutu?.trim()) return y.code(400).send({ hata: 'Kabul ölçütü zorunludur; görevin ne zaman tamamlanmış sayılacağını yazınız.' }); // YG-057
    if (!g.sahip || !(await dosyaErisimi(b.db, g.sahip, id))) return y.code(400).send({ hata: 'Açık konu için sahibi dosya ekibinden seçmenizi rica ederiz.' });
    if (!g.hedefTarih) return y.code(400).send({ hata: 'Hedef tarih zorunludur.' });
    // YG-031: belge ve eğitim işleri konu türüdür ve Planlı sınıfındadır.
    const konuTuru = (i.body as { konuTuru?: string }).konuTuru ?? 'İş';
    if (!['İş', 'Belge', 'Eğitim'].includes(konuTuru)) return y.code(400).send({ hata: 'Konu türü İş, Belge veya Eğitim olmalıdır.' });
    if (konuTuru !== 'İş') g.oncelik = 'Planlı';
    // YG-1361: dosya önceliğinden yüksek öncelik gerekçe ister; aynı kişi bir dosyada en çok 3 açık konuyu dosyanın üstünde işaretleyebilir.
    const SIRA: Record<string, number> = { Kritik: 3, Yüksek: 2, Normal: 1, Planlı: 0 };
    const ust = g.oncelik && SIRA[g.oncelik] !== undefined && SIRA[g.oncelik]! > (SIRA[d.oncelik] ?? 1);
    if (ust && !(i.body as { oncelikGerekcesi?: string }).oncelikGerekcesi?.trim()) return y.code(400).send({ hata: 'Dosya önceliğinden yüksek öncelik için gerekçe yazınız.' });
    if (ust && konuTuru === 'İş' && (await b.db.query(`SELECT count(*)::int n FROM acik_konu WHERE dosya_ref = $1 AND olusturan_ref = $2 AND statu NOT IN ('Kapalı', 'Geçersiz') AND CASE oncelik WHEN 'Kritik' THEN 3 WHEN 'Yüksek' THEN 2 WHEN 'Normal' THEN 1 ELSE 0 END > $3`, [id, o.kullanici, SIRA[d.oncelik] ?? 1])).rows[0].n >= 3) return y.code(409).send({ hata: 'Bu dosyada dosya önceliğinin üstünde işaretlediğiniz 3 açık konu bulunmaktadır; yeni konuyu dosya önceliğiyle açınız.' });
    if (ust) g.aciklama = [g.aciklama?.trim(), `Öncelik gerekçesi: ${(i.body as { oncelikGerekcesi: string }).oncelikGerekcesi.trim()}`].filter(Boolean).join(' · ');
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');

      // YG-057: görev açıldığı dosya aşamasına bağlanır; öncelik verilmezse dosyanın önceliğidir.
      const r = (await c.query(`INSERT INTO acik_konu (konu_no, dosya_ref, baslik, aciklama, sahip_ref, hedef_tarih, olusturan_ref, asama, oncelik, kabul_olcutu, gerekli_belge) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik, konu_no`, [await altNumara(c, d.dosya_no, 'AK'), id, g.baslik.trim(), g.aciklama?.trim() || null, g.sahip, g.hedefTarih, o.kullanici, d.asama ?? null, ['Kritik', 'Yüksek', 'Normal', 'Planlı'].includes(g.oncelik ?? '') ? g.oncelik : d.oncelik, g.kabulOlcutu.trim(), g.gerekliBelge?.trim() || null])).rows[0];
      await c.query(`UPDATE acik_konu SET konu_turu = $2 WHERE kimlik = $1`, [r.kimlik, konuTuru]); // YG-031
      await bildir(c, { olay: `konu:${r.kimlik}`, kullanicilar: [g.sahip].filter((x) => x !== o.kullanici), baslik: `Açık Konu: ${g.baslik.trim()}`, ozet: d.dosya_no, eposta: true });
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-059: hedef tarih yalnız Dosya Sorumlusunca gerekçeyle değiştirilir; eski ve yeni tarih iz kaydına yazılır, konu sahibine bildirilir.
  s.post('/konu/:id/hedef', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tarih?: string; gerekce?: string; surum?: number };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT k.*, d.dosya_sorumlusu_ref FROM acik_konu k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (k.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Hedef tarihi dosyanın Dosya Sorumlusu değiştirir.' });
    if (await surumCakismasi(b.db, y, 'acik_konu', id, g.surum)) return y; // YG-1382
    if (['Kapalı', 'Geçersiz'].includes(k.statu)) return y.code(409).send({ hata: 'Kapanmış konunun hedef tarihi değiştirilemez.' });
    if (!g.tarih || !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih) || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Yeni hedef tarih ve gerekçe zorunludur.' });
    const eski = (await b.db.query(`SELECT $1::date::text t`, [k.hedef_tarih])).rows[0].t as string;
    await b.db.query(`UPDATE acik_konu SET hedef_tarih = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, g.tarih]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Açık Konu Hedef Tarihi Değişti', nesneTuru: 'Dosya', nesneKimligi: k.dosya_ref, eski: { hedef: eski }, yeni: { hedef: g.tarih }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    if (k.sahip_ref !== o.kullanici) await bildir(b.db, { olay: `konu-hedef:${id}:${g.tarih}`, kullanicilar: [k.sahip_ref], baslik: `Hedef Tarih Değişti: ${k.baslik}`, ozet: `${eski.split('-').reverse().join('.')} → ${g.tarih.split('-').reverse().join('.')} · ${g.gerekce.trim()}` });
    return { tamam: true };
  });
  s.post('/konu/:id/durum', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { statu?: string; kanit?: string; gerekce?: string; surum?: number };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT * FROM acik_konu WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (await surumCakismasi(b.db, y, 'acik_konu', id, g.surum)) return y; // YG-1382
    const gecer: Record<string, string[]> = { 'Açık': ['İşlemde', 'Geçersiz'], 'İşlemde': ['Doğrulamada', 'Geçersiz'], 'Doğrulamada': ['Kapalı', 'İşlemde'], 'Kapalı': ['İşlemde'] };
    // YG-153: kapanmış konu ayrı geçişle ve gerekçeyle yeniden açılır; kapanış bilgisi silinmez, iz kaydında kalır.
    if (k.statu === 'Kapalı' && g.statu === 'İşlemde') {
      if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Yeniden açma gerekçesi zorunludur.' });
      await b.db.query(`UPDATE acik_konu SET statu = 'İşlemde', kapanis_zamani = NULL, guncelleme_zamani = now() WHERE kimlik = $1`, [id]);
      await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Açık Konu Yeniden Açıldı', nesneTuru: 'Dosya', nesneKimligi: k.dosya_ref, eski: { statu: 'Kapalı', kanit: k.kapanis_kaniti, dogrulayan: k.dogrulayan_ref }, yeni: { statu: 'İşlemde' }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      if (k.sahip_ref !== o.kullanici) await bildir(b.db, { olay: `konu-yeniden:${id}:${Date.now()}`, kullanicilar: [k.sahip_ref], baslik: `Açık Konu Yeniden Açıldı: ${k.baslik}`, ozet: g.gerekce.trim() });
      return { tamam: true };
    }
    if (!gecer[k.statu]?.includes(g.statu ?? '')) return y.code(409).send({ hata: 'Bu geçiş mevcut durumda uygun değildir.' });
    if (g.statu === 'Doğrulamada' && !g.kanit?.trim()) return y.code(400).send({ hata: 'Kapanış kanıtı zorunludur.' });
    if (g.statu === 'Kapalı' && k.sahip_ref === o.kullanici) return y.code(403).send({ hata: 'Kapanış bağımsız yeniden kontrolle yapılır; konunun başka bir kişi tarafından kapatılmasını rica ederiz.' });
    await b.db.query(`UPDATE acik_konu SET statu = $2, kapanis_kaniti = coalesce($3, kapanis_kaniti), dogrulayan_ref = CASE WHEN $2 = 'Kapalı' THEN $4 ELSE dogrulayan_ref END, kapanis_zamani = CASE WHEN $2 = 'Kapalı' THEN now() END, guncelleme_zamani = now() WHERE kimlik = $1`, [id, g.statu, g.kanit?.trim() || null, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Açık Konu Durumu', nesneTuru: 'Dosya', nesneKimligi: k.dosya_ref, eski: { statu: k.statu }, yeni: { statu: g.statu }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-1440: teknik personel (Teknik Uzman, Sorumlu Teknik Uzman, Teknik Yönetici, Teknik Müdür) dosya ve yat belgelerini inceler, Uygun / Eksik işaretler; yüklemez.
  const TEKNIK = ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Teknik Yönetici', 'Teknik Müdür'];
  s.get('/dosya/:id/belge-inceleme', oturumlu, async (i, y) => {
    const d = await dosyaGetir((i.params as { id: string }).id, i.oturum!.kullanici); if (!d) return yok(y);
    const teknik = Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[])`, [i.oturum!.kullanici, TEKNIK])).rowCount);
    const belgeler = (await b.db.query(`SELECT b.kimlik, b.ad, b.belge_turu, b.bag_turu, b.inceleme_sonucu, b.inceleme_notu, b.inceleme_zamani, b.gecerlilik_bitis::text gecerlilik_bitis FROM belge b WHERE (b.bag_turu = 'Dosya' AND b.bag_kimligi = $1::text) OR (b.bag_turu = 'Yat' AND b.bag_kimligi = $2::text) ORDER BY b.olusturma_zamani DESC LIMIT 100`, [d.kimlik, d.yat_ref])).rows;
    return { teknik, belgeler };
  });
  s.post('/dosya/:id/belge/:belge/inceleme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id, belge } = i.params as { id: string; belge: string }; const g = (i.body ?? {}) as { sonuc?: string; not?: string; gecerlilikBitis?: string };
    if (g.gecerlilikBitis && !/^\d{4}-\d{2}-\d{2}$/.test(g.gecerlilikBitis)) return y.code(400).send({ hata: 'Geçerlilik bitiş tarihini geçerli giriniz.' });
    const d = await dosyaGetir(id, o.kullanici); if (!d || !UUID.test(belge)) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[])`, [o.kullanici, TEKNIK])).rowCount) return y.code(403).send({ hata: 'Belge incelemesini teknik personel yapar.' });
    if (!['Uygun', 'Eksik'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Uygun veya Eksik seçiniz.' });
    if (g.sonuc === 'Eksik' && !g.not?.trim()) return y.code(400).send({ hata: 'Eksik olan hususu yazınız.' });
    const r = await b.db.query(`UPDATE belge SET inceleme_sonucu = $3, inceleme_notu = $4, inceleyen_ref = $5, inceleme_zamani = now(), gecerlilik_bitis = coalesce($7::date, gecerlilik_bitis), yenileme_istendi = CASE WHEN $7::date IS NOT NULL THEN NULL ELSE yenileme_istendi END WHERE kimlik = $1 AND ((bag_turu = 'Dosya' AND bag_kimligi = $2::text) OR (bag_turu = 'Yat' AND bag_kimligi = $6::text)) RETURNING ad`, [belge, d.kimlik, g.sonuc, g.not?.trim() || null, o.kullanici, d.yat_ref, g.gecerlilikBitis || null]);
    if (!r.rowCount) return yok(y);
    if (g.sonuc === 'Eksik' && d.dosya_sorumlusu_ref) await bildir(b.db, { olay: `belge-eksik:${belge}:${Date.now()}`, kullanicilar: [d.dosya_sorumlusu_ref], baslik: `${d.dosya_no} · Belge Eksik: ${r.rows[0].ad}`, ozet: g.not!.trim() });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge İncelemesi', nesneTuru: 'Belge', nesneKimligi: belge, yeni: { sonuc: g.sonuc }, gerekce: g.not?.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-024: eski numara aramada bulunur ve ana dosyaya yönlendirir. YG-1112 benzeri: yalnız erişilebilir dosya döner.
  s.get('/ara', oturumlu, async (i, y) => {
    const o = i.oturum!; const q = String((i.query as { q?: string }).q ?? '').trim();
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu sayfa LGM personeline açıktır.' });
    if (q.length < 2) return { dosyalar: [] };
    const { rows } = await b.db.query(
      `SELECT d.kimlik, d.dosya_no, d.statu, d.oncelik, y.yat_adi, a.kimlik AS ana_kimlik, a.dosya_no AS ana_no, s.sigorta_hasar_dosya_no FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya a ON a.kimlik = d.birlestirilen_ana_dosya_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik
        WHERE tr_norm(d.dosya_no) LIKE '%' || tr_norm($1) || '%' OR tr_norm(y.yat_adi) LIKE '%' || tr_norm($1) || '%' OR tr_norm(s.sigorta_hasar_dosya_no) LIKE '%' || tr_norm($1) || '%' OR EXISTS (SELECT 1 FROM dosya_tarafi t WHERE t.dosya_ref = d.kimlik AND tr_norm(t.kisi_adi_soyadi) LIKE '%' || tr_norm($1) || '%') ORDER BY d.acilis_tarihi DESC LIMIT 300`, [q]); // YG-1162: süzgeç sınırdan önce // PRM-1: erişim süzgecinden sonra arama_oneri_azami kadarı gösterilir; YG-1374: kişi adıyla da bulunur
    const izinli = [];
    for (const r of rows) if (await dosyaErisimi(b.db, o.kullanici, r.ana_kimlik ?? r.kimlik)) izinli.push(r);
    // YG-1374: firma sonuçları yalnız firma sicili yetkisi olana.
    const { kullaniciIzinleri } = await import('./yetki.js');
    const firmalar = (await kullaniciIzinleri(b.db, o.kullanici)).includes('firma.kayit') ? (await b.db.query(`SELECT kimlik, sicil_no, ticari_unvan, kayit_rolu, ag_statusu FROM kurulus WHERE tr_norm(ticari_unvan) LIKE '%' || tr_norm($1) || '%' OR sicil_no ILIKE $1 || '%' ORDER BY ticari_unvan LIMIT 20`, [q])).rows : [];
    const az = Number((await b.db.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'arama_oneri_azami'`)).rows[0]?.deger ?? 10); // PRM-1
    return { dosyalar: izinli.slice(0, az), firmalar: firmalar.slice(0, az) };
  });

}

/**
 * YG-312: atama sona erdiğinde kişinin bu dosyada başka atanması yoksa açtığı paylaşım bağlantıları kapanır;
 * dosya belgelerini indirmişse kopyaların silinmesi için kendisine kapanış kontrolü görevi açılır.
 */
export async function atamaKapanisKontrolu(c: Pool | PoolClient, dosya: string, kullanici: string): Promise<{ baglanti: number; indirme: number }> {
  if ((await c.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL`, [dosya, kullanici])).rowCount) return { baglanti: 0, indirme: 0 };
  const baglanti = (await c.query(`UPDATE paylasim_baglantisi p SET iptal_zamani = now() FROM belge_surum s JOIN belge e ON e.kimlik = s.belge_ref WHERE p.surum_ref = s.kimlik AND e.bag_turu = 'Dosya' AND e.bag_kimligi = $1::text AND p.olusturan_ref = $2 AND p.iptal_zamani IS NULL AND p.son_gecerlilik > now()`, [dosya, kullanici])).rowCount ?? 0;
  const indirme = Number((await c.query(`SELECT count(DISTINCT d.nesne_kimligi) n FROM denetim_izi d JOIN belge e ON e.kimlik::text = d.nesne_kimligi WHERE d.aktor_ref = $1 AND d.eylem = 'Belge İndirildi' AND e.bag_turu = 'Dosya' AND e.bag_kimligi = $2::text`, [kullanici, dosya])).rows[0].n);
  if (indirme > 0) {
    const no = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]?.dosya_no;
    await kartAc(c, { tur: 'Atama Kapanış Kontrolü', kategori: 'gorev', baslik: `${no} · Atama Kapanış Kontrolü`, ozet: `Bu dosyadan indirdiğiniz ${indirme} belgenin kopyalarını cihazlarınızdan ve paylaşılan klasörlerden silip görevi tamamlamanız rica olunur.`, sahipKullanici: kullanici, nesneTuru: 'Dosya', nesneKimligi: dosya });
  }
  return { baglanti, indirme };
}
