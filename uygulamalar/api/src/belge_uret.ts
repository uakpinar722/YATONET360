import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { dogrulamaKodu } from './belge.js';
import { bildir, disGonder } from './bildirim.js';
import { Depo } from './depo.js';
import { kartAc } from './is_motoru.js';
import type { Baglam } from './kimlik.js';
import { gunAy, metinGetir, tutar, type Dil } from './metin.js';
import { pdfUret, type BelgeTanim, type Bolum, type Renk } from './pdf.js';
import { altNumara } from './sure.js';

type Db = Pool | PoolClient;
export type UretimTuru = 'Garanti Şikâyet Yanıtı' | 'İhbar Alındı' | 'Tedarik Siparişi' | 'Değişiklik Kaydı' | 'Garanti Belgesi' | 'Fiyat Teklifi' | 'Teknik Rapor' | 'Onay Belgesi' | 'Proforma' | 'Ödeme Talebi' | 'İş Emri' | 'Teslim Tutanağı' | 'Ödeme Sorumluluğu' | 'Uyuşmazlık Paketi' | 'Mutabakat Raporu' | 'Kurtarma Sözleşmesi' | 'Ön Bilgilendirme Formu' | 'Yöntem Bilgi Nüshası' | 'Nihai Kapanış Özeti' | 'Ön Değerlendirme Raporu' | 'Kurtarma Sonuç Tutanağı' | 'Hasar İhbar ve İlk Kayıt' | 'Sigorta Onay Belgesi';
interface Gonderim { olay: string; eposta: string; konu: string; metin: string; acil?: boolean; sigortaTeyitli?: boolean; ekle?: UretimTuru[] }

/** YG-469, YG-558: PDF kuyruğa yazılır; işlem üretim hatasından etkilenmez. Hata Dosya Sorumlusuna bildirilir. */
export async function belgeUret(c: Db, g: { tur: UretimTuru; nesne: string; dosya: string; gonder?: Gonderim }): Promise<void> {
  await c.query(`INSERT INTO belge_uretim (tur, nesne, dosya_ref, gonder) VALUES ($1,$2,$3,$4) ON CONFLICT (tur, nesne) DO UPDATE SET gonder = CASE WHEN belge_uretim.durum = 'Bekliyor' THEN coalesce(EXCLUDED.gonder, belge_uretim.gonder) ELSE EXCLUDED.gonder END, durum = 'Bekliyor', deneme = 0`, [g.tur, g.nesne, g.dosya, g.gonder ? JSON.stringify(g.gonder) : null]);
}

/** YG-683: paket birimli kalemde miktar yerine Maktuen yazılır. */
export const miktarYaz = (k: { miktar: unknown; birim: string }, dil: Dil) => (/^paket$/i.test(k.birim) ? (dil === 'en' ? 'Lump sum' : 'Maktuen') : `${tutar(Number(k.miktar), dil)} ${k.birim}`);

/** YG-878: teklifte KDV durumu kullanıcıdan alınmaz, taraf kaydından gelir. */
async function kdvDurumMetni(db: Db, dosya: string, muhatap: string, dil: Dil): Promise<string> {
  const s = await (await import('./vergi.js')).kdvBelirle(db, dosya, muhatap);
  const en: Record<string, string> = { 'Standart KDV': 'Standard VAT', 'KDV tevkifatlı': 'VAT withholding applies', 'KDV istisnası': 'VAT exemption applies' };
  return dil === 'en' ? en[s.durum]! : s.durum;
}

const E = {
  tr: { musteri: 'Müşteri ve Dosya', yat: 'Yat Bilgileri', olay: 'Olay', kalem: 'Teklif Kalemleri', kosul: 'Koşullar', iletisim: 'İletişim Kişileri', ekip: 'Atanan Ekip', kapsam: 'Görev ve Kapsam', yontem: 'Yöntem ve Ölçüt', bulgu: 'Bulgular', foto: 'Fotoğraf Kanıtları', deger: 'Değerlendirme', oneri: 'Öneri ve Seçenekler', acik: 'Açık Sorular', sinir: 'Uzmanlık Sınırı', konu: 'Onay Konusu', beyan: 'Beyan', kayit: 'Onay Kaydı', dosyaYat: 'Dosya ve Yat', talep: 'Talep Kalemleri',
    kdvDurum: 'KDV Durumu', tevkifatS: 'KDV Tevkifatı', kesifM: 'Keşif Ücreti Mahsubu', must: 'Müşteri', sahip: 'Yat Sahibi', surumS: 'Belge Sürümü', onceki: 'Önceki Ödemeler ve Mahsup (EUR)', odenecek: 'Ödenecek Tutar (EUR)', hasar: 'Hasar Dosya No', odeme: 'Ödeme Sorumlusu', dosyaNo: 'Dosya No', yatAdi: 'Yat Adı', marka: 'Marka / Model', tur: 'Tekne Türü', boy: 'Boy', govde: 'Gövde Malzemesi', yil: 'İmal Yılı', bayrak: 'Bayrak', adres: 'Yatın Bulunduğu Adres', ozet: 'Olay Özeti', tarih: 'Tarih', yer: 'Olay Yeri', sira: '#', kod: 'Kod', aciklama: 'Açıklama', nitelik: 'Nitelik', bedel: 'Bedel Türü', miktar: 'Miktar', fiyat: 'Birim Fiyat (EUR)', tutar: 'Tutar (EUR)', ara: 'Ara Toplam', indirim: 'İndirim', kdv: 'KDV', genel: 'Genel Toplam (EUR)', gecerlilik: 'Geçerlilik', odemeKosul: 'Ödeme', gorev: 'Görev', ad: 'Ad Soyad', tel: 'Telefon', eposta: 'E-posta', soru: 'İncelenen', kosulS: 'Koşul', yontemS: 'Yöntem', bolge: 'Bölge', gozlem: 'Gözlem ve Ölçüm', etiket: 'Etiket', onem: 'Önem', gorsel: 'Görsel', konumS: 'Konum', turS: 'Onay Türü', belgeS: 'Onaylanan Belge', onaylayan: 'Onaylayan', yontemO: 'Yöntem', kodO: 'Kod', zaman: 'Tarih-Saat', smsY: 'SMS ile gönderilen bağlantı ve tek kullanımlık kod', talepT: 'Ödeme Talebi Türü', son: 'Son Ödeme Tarihi', dayanak: 'Dayanak', proforma: 'Bu belge proforma niteliğindedir ve fatura yerine geçmez.',
    Teklif: 'Fiyat Teklifi', Rapor: 'Teknik Rapor', Onay: 'Yat Sahibi Onay Belgesi', Odeme: 'Ödeme Talebi (Proforma)' },
  en: { musteri: 'Customer and File', yat: 'Yacht Details', olay: 'Incident', kalem: 'Quotation Items', kosul: 'Terms', iletisim: 'Contacts', ekip: 'Assigned Team', kapsam: 'Scope of Inspection', yontem: 'Method and Criteria', bulgu: 'Findings', foto: 'Photographic Evidence', deger: 'Assessment', oneri: 'Recommendation and Options', acik: 'Open Questions', sinir: 'Limits of Expertise', konu: 'Subject of Approval', beyan: 'Statement', kayit: 'Approval Record', dosyaYat: 'File and Yacht', talep: 'Requested Items',
    kdvDurum: 'VAT Status', tevkifatS: 'VAT Withholding', kesifM: 'Survey Fee Set-off', must: 'Customer', sahip: 'Yacht Owner', surumS: 'Document Version', onceki: 'Previous Payments and Set-off (EUR)', odenecek: 'Amount Payable (EUR)', hasar: 'Claim File No', odeme: 'Payer', dosyaNo: 'File No', yatAdi: 'Yacht Name', marka: 'Make / Model', tur: 'Yacht Type', boy: 'Length', govde: 'Hull Material', yil: 'Year Built', bayrak: 'Flag', adres: 'Location of Yacht', ozet: 'Incident Summary', tarih: 'Date', yer: 'Place of Incident', sira: '#', kod: 'Code', aciklama: 'Description', nitelik: 'Nature', bedel: 'Cost Type', miktar: 'Quantity', fiyat: 'Unit Price (EUR)', tutar: 'Amount (EUR)', ara: 'Subtotal', indirim: 'Discount', kdv: 'VAT', genel: 'Grand Total (EUR)', gecerlilik: 'Validity', odemeKosul: 'Payment', gorev: 'Role', ad: 'Name', tel: 'Telephone', eposta: 'E-mail', soru: 'Inspected', kosulS: 'Conditions', yontemS: 'Method', bolge: 'Zone', gozlem: 'Observation and Measurement', etiket: 'Label', onem: 'Severity', gorsel: 'Image', konumS: 'Location', turS: 'Approval Type', belgeS: 'Approved Document', onaylayan: 'Approved By', yontemO: 'Method', kodO: 'Code', zaman: 'Date-Time', smsY: 'Link sent by SMS and one-time code', talepT: 'Payment Request Type', son: 'Payment Due Date', dayanak: 'Basis', proforma: 'This document is a pro forma and is not an invoice.',
    Teklif: 'Price Quotation', Rapor: 'Technical Report', Onay: 'Yacht Owner Approval Document', Odeme: 'Payment Request (Proforma)' },
};
const oran = (x: unknown) => String(Number(x)).replace('.', ',');
const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const anSaat = (z: Date | string) => `${gunAy(z)} ${new Date(z).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}`;
const para = (x: unknown, d: Dil) => (x === null || x === undefined ? '---' : tutar(Number(x), d));
const ROL_EN: Record<string, string> = { 'Dosya Sorumlusu': 'File Manager', 'Operasyon Yöneticisi': 'Operations Manager', 'Teknik Uzman': 'Technical Expert', 'Teknik Yönetici': 'Technical Manager', 'Saha Sorumlusu': 'Site Supervisor' };

/** YG-625: belgenin Türkçe sürümü üretilirken dosya dili geçici olarak Türkçe alınır. */
const dilZorla = new AsyncLocalStorage<Dil>();
async function dosyaBilgi(db: Db, id: string, hazirlik: string) {
  const d = (await db.query(`SELECT d.dosya_no, d.konum, d.kisa_teknik_tanim, d.olay_tarihi, d.bildirim_tarihi, d.musteri_turu, d.yazisma_dili, d.dosya_niteligi, y.yat_adi, y.tur AS yat_turu, y.tam_boy_m, y.govde_malzemesi, y.uretim_yili, y.bayrak, coalesce(m.marka, y.marka_diger) AS marka, coalesce(m.model, y.model_diger) AS model, s.sigortaci_adi, s.sigorta_hasar_dosya_no FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE d.kimlik = $1`, [id])).rows[0];
  const sahip = (await db.query(`SELECT kisi_adi_soyadi FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [id])).rows[0]?.kisi_adi_soyadi as string | undefined;
  const ekip = (await db.query(`SELECT a.rol, a.atama_zamani, h.kimlik AS kullanici, h.ad_soyad, h.cep_telefonu, h.e_posta FROM dosya_ekibi_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.dosya_ref = $1 AND a.bitis_zamani IS NULL AND a.rol IN ('Dosya Sorumlusu', 'Operasyon Yöneticisi', 'Teknik Uzman', 'Teknik Yönetici', 'Saha Sorumlusu')
    ORDER BY array_position(ARRAY['Dosya Sorumlusu', 'Operasyon Yöneticisi', 'Teknik Uzman', 'Saha Sorumlusu', 'Teknik Yönetici'], a.rol), a.atama_zamani`, [id])).rows; // YG-688
  void hazirlik;
  return { d, sahip, ekip, dil: dilZorla.getStore() ?? ((d.yazisma_dili === 'İngilizce' ? 'en' : 'tr') as Dil) };
}

/** YG-717: adres satırının adı belge türüne göre (varsayılan Yatın Bulunduğu Adres). */
const ADRES = { inceleme: { tr: 'İnceleme Adresi', en: 'Inspection Address' }, teslim: { tr: 'Teslim Adresi', en: 'Delivery Address' } } as const;
function ortak(b: Awaited<ReturnType<typeof dosyaBilgi>>, adresEt?: string): Bolum[] {
  const { d, sahip, dil } = b; const e = E[dil]; const sg = d.musteri_turu === 'Sigorta Şirketi';
  const boy = d.tam_boy_m ? `${tutar(Number(d.tam_boy_m), dil)} m` : null;
  return [
    { baslik: e.musteri, tur: 'alanlar', alanlar: [{ et: e.must, deger: sg ? d.sigortaci_adi : sahip }, { et: e.dosyaNo, deger: d.dosya_no }, { et: e.hasar, deger: d.sigorta_hasar_dosya_no }, { et: e.odeme, deger: d.musteri_turu }] },
    { baslik: e.yat, tur: 'alanlar', alanlar: [{ et: e.yatAdi, deger: d.yat_adi }, { et: e.marka, deger: [d.marka, d.model].filter(Boolean).join(' · ') }, { et: e.tur, deger: d.yat_turu }, { et: e.boy, deger: boy }, { et: e.govde, deger: d.govde_malzemesi }, { et: e.yil, deger: d.uretim_yili }, { et: e.bayrak, deger: d.bayrak }, { et: adresEt ?? e.adres, deger: d.konum, genis: true }] },
    { baslik: e.olay, tur: 'alanlar', alanlar: [{ et: e.tarih, deger: d.olay_tarihi ? gunAy(d.olay_tarihi) : null }, { et: e.ozet, deger: d.kisa_teknik_tanim, genis: true }] },
  ];
}
const ekipBolumu = (b: Awaited<ReturnType<typeof dosyaBilgi>>): Bolum => { const e = E[b.dil]; return { baslik: e.iletisim, tur: 'tablo', sutunlar: [{ ad: e.gorev }, { ad: e.tel }, { ad: e.eposta }], satirlar: b.ekip.filter((x) => x.rol === 'Dosya Sorumlusu' || x.rol === 'Teknik Uzman').map((x) => [b.dil === 'en' ? ROL_EN[x.rol] ?? x.rol : x.rol, x.cep_telefonu, x.e_posta]) }; }; // YG-689
const atananEkip = (b: Awaited<ReturnType<typeof dosyaBilgi>>): Bolum => { const e = E[b.dil]; return { baslik: e.ekip, tur: 'tablo', sutunlar: [{ ad: e.gorev }, { ad: e.zaman }], satirlar: b.ekip.map((x) => [b.dil === 'en' ? ROL_EN[x.rol] ?? x.rol : x.rol, anSaat(x.atama_zamani)]) }; }; // YG-689
const hitap = (b: Awaited<ReturnType<typeof dosyaBilgi>>, belge: string) => { const { d, sahip, dil } = b; const kim = d.musteri_turu === 'Sigorta Şirketi' ? d.sigortaci_adi : sahip; const t = gunAy(d.bildirim_tarihi); return dil === 'en' ? `Dear ${kim ?? 'Sir/Madam'}, the ${belge} prepared under your request dated ${t} and file no. ${d.dosya_no} is submitted for your information.` : `Sayın ${kim ?? 'Yetkili'}${d.musteri_turu === 'Sigorta Şirketi' ? ' Yetkilisi' : ''}, ${t} tarihli talebiniz ve ${d.dosya_no} numaralı dosya kapsamında hazırlanan ${belge} bilginize sunulur.`; };
const sozlesme = (d: { musteri_turu: string }, dil: Dil) => (d.musteri_turu === 'Sigorta Şirketi' ? (dil === 'en' ? 'This document is subject to, and shall be read together with, the Insurance Company Framework Service Agreement and Insurance Assignment between the parties.' : 'Bu belge, taraflar arasındaki Sigorta Şirketi Çerçeve Hizmet Sözleşmesi ve Sigorta Görevlendirmesi hükümlerine tabidir ve onunla birlikte değerlendirilir.') : (dil === 'en' ? 'This document is subject to, and shall be read together with, the Yacht Repair and Technical Services Agreement between the parties.' : 'Bu belge, taraflar arasındaki Yat Onarım ve Teknik Hizmet Sözleşmesi hükümlerine tabidir ve onunla birlikte değerlendirilir.'));
const gizli = (dil: Dil) => (dil === 'en' ? 'This document has been prepared solely for the proceedings of the named file. Except where required by law, its contents may not be shared with third parties without the written consent of LİMİT GLOBAL MARINE.' : 'Bu belge, yalnız adı geçen dosyanın işlemleri için hazırlanmıştır. İçeriği, yasal zorunluluklar dışında LİMİT GLOBAL MARINE’ın yazılı onayı olmadan üçüncü kişilerle paylaşılamaz.');
const dogrula = (dil: Dil, kod: string, web: string) => (dil === 'en' ? `This document was generated and electronically approved on YATONET 360 and does not require a wet signature. Its authenticity can be verified at ${web}/dogrula with code ${kod}.` : `Bu belge YATONET 360 tarafından üretilmiş ve elektronik olarak onaylanmıştır; ıslak imza gerektirmez. Doğruluğunu ${kod} ile ${web}/dogrula üzerinden doğrulayabilirsiniz.`);
const tesekkur = (dil: Dil) => (dil === 'en' ? 'Thank you for choosing LİMİT GLOBAL MARINE.' : 'LİMİT GLOBAL MARINE’ı tercih ettiğiniz için teşekkür ederiz.');

/** SRE-1, SRE-2: teklifte yalnız iş günü yazılır, tarih onay sonrası bildirilir; avans alınmayan işte avans ifadesi yazılmaz. */
async function teslimSatiri(db: Db, f: Record<string, any>, d: Record<string, any>, dil: Dil) {
  if (!f.bildirilen_sure_gun) return [];
  const { parametre } = await import('./teklif.js'); const { avansHesapla } = await import('./ticari.js');
  const avans = avansHesapla(d.musteri_turu, Number(f.genel_toplam_eur), d.oncelik === 'Kritik', await parametre(db, 'avans_orani'), await parametre(db, 'sigorta_avans_esik_eur')) > 0;
  return dil === 'en'
    ? [{ et: 'Estimated Repair Time', deger: `${f.bildirilen_sure_gun} working days (starting once the yacht is at the repair location and approval${avans ? ' and advance payment are' : ' is'} complete)` }]
    : [{ et: 'Tahmini Onarım Süresi', deger: `${f.bildirilen_sure_gun} iş günü (yat onarım yerine ulaştıktan ve onay${avans ? ' ile avans' : ''} tamamlandıktan sonra işlemeye başlar)` }];
}

export async function teklifTanim(db: Db, id: string, kod: string, web: string): Promise<{ t: BelgeTanim; dosyaAdi: string; sinif: string }> {
  const f = (await db.query(`SELECT * FROM fiyat_teklifi WHERE kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, f.dosya_ref, f.hazirlayan_ref); const dil = b.dil; const e = E[dil];
  const kl = (await db.query(`SELECT sira_no, kartela_kodu, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [id])).rows;
  const kapanis = (await db.query(`SELECT r.rol_adi, a.zaman FROM is_karti k JOIN is_karti_adim a ON a.is_ref = k.kimlik LEFT JOIN rol r ON r.kimlik = a.rol_ref WHERE k.tur = 'Fiyat Teklifi' AND k.nesne_kimligi = $1 AND a.karar IN ('Onayla', 'Kademe Atla') ORDER BY a.kimlik DESC LIMIT 1`, [id])).rows[0];
  const top = [{ et: e.ara, deger: para(f.ara_toplam_eur, dil) }];
  if (Number(f.indirim_tutari_eur) > 0) top.push({ et: `${e.indirim} %${oran(f.indirim_orani)}`, deger: `-${para(f.indirim_tutari_eur, dil)}` });
  top.push({ et: `${e.kdv} %${oran(f.kdv_orani)}`, deger: para(f.kdv_tutari_eur, dil) });
  if (Number(f.tevkifat_eur) > 0) top.push({ et: e.tevkifatS, deger: `-${para(f.tevkifat_eur, dil)}` }); // KDV-1
  const bolumler: Bolum[] = [
    ...ortak(b),
    { baslik: e.kalem, tur: 'tablo', sutunlar: [{ ad: e.sira, hiza: 'ort' }, { ad: e.kod }, { ad: e.aciklama }, { ad: e.nitelik }, { ad: e.bedel }, { ad: e.miktar, hiza: 'sag' }, { ad: e.fiyat, hiza: 'sag' }, { ad: e.tutar, hiza: 'sag' }], satirlar: kl.map((k) => [k.sira_no, k.kartela_kodu, k.aciklama, k.isin_niteligi, k.bedel_turu, miktarYaz(k, dil), para(k.birim_satis_fiyati_eur, dil), para(k.tutar_eur, dil)]), toplamlar: [...top, { et: e.genel, deger: para(f.genel_toplam_eur, dil), ana: true } as { et: string; deger: string; ana?: boolean }] },
    { baslik: e.kosul, tur: 'alanlar', alanlar: [{ et: e.gecerlilik, deger: f.gecerlilik_bitis_tarihi ? gunAy(f.gecerlilik_bitis_tarihi) : null }, { et: e.odemeKosul, deger: f.odeme_vadesi }, ...(await teslimSatiri(db, f, b.d, dil)), { et: e.kdvDurum, deger: await kdvDurumMetni(db, f.dosya_ref, f.teklif_muhatabi, dil) }] },
    ekipBolumu(b),
    atananEkip(b),
  ];
  // YG-709: seçilen 013 maddeleri (Türkçe ve İngilizce metin).
  const mad = await (await import('./teklif_madde.js')).teklifMaddeleri(db, f.kimlik, dil);
  if (mad.length) bolumler.splice(2, 0, { baslik: dil === 'en' ? 'Exclusions and Separately Priced Items' : 'Hariç ve Ayrıca Fiyatlandırılacak Hususlar', tur: 'tablo', sutunlar: [{ ad: dil === 'en' ? 'Status' : 'Durum' }, { ad: dil === 'en' ? 'Item' : 'Husus' }], satirlar: mad.map((x) => [x.tur, x.metin]) });
  if (f.ana_teklif_ref) { const ana = (await db.query(`SELECT teklif_no FROM fiyat_teklifi WHERE kimlik = $1`, [f.ana_teklif_ref])).rows[0]?.teklif_no; bolumler.unshift({ baslik: dil === 'en' ? 'Related Document' : 'Bağlı Olduğu Belge', tur: 'alanlar', alanlar: [{ et: dil === 'en' ? 'Quotation No' : 'Teklif No', deger: ana }] }); } // YG-658
  return {
    dosyaAdi: `${f.teklif_no}.pdf`, sinif: 'Gizli',
    t: { ad: e.Teklif, kod: 'FR-TIC-008', no: f.teklif_no, dosyaNo: b.d.dosya_no, tarih: gunAy(f.gonderim_zamani ?? new Date()), surum: `Rev.${f.surum_no}`, dil, yat: b.d.yat_adi,
      matbuBas: [hitap(b, e.Teklif)], bolumler,
      matbuSon: [dil === 'en' ? 'This quotation is valid for 15 days from its date of issue. Amounts are in EUR; VAT is shown separately; invoices are issued in TRY at the CBRT foreign exchange selling rate of the business day preceding the invoice date. The invoice is final; no exchange difference invoice is issued. Work not included in this quotation is performed only upon separate approval.' : 'Bu teklif, düzenlendiği tarihten itibaren 15 gün geçerlidir. Tutarlar EUR cinsindendir; KDV ayrıca gösterilmiştir; fatura, fatura tarihinden önceki iş gününe ait TCMB döviz satış kuruyla TL olarak düzenlenir. Fatura nihaidir; kur farkı faturası düzenlenmez. Teklifte yer almayan işler ancak ayrıca onaylanırsa yapılır.', sozlesme(b.d, dil), gizli(dil), dogrula(dil, kod, web), tesekkur(dil)],
      onay: kapanis ? { rol: kapanis.rol_adi ?? '', zaman: anSaat(kapanis.zaman), kanal: 'YATONET 360', kod } : undefined },
  };
}

let aktifDepo: Depo | undefined;
/** YG-713: dosya fotoğrafları; hassas işaretli görsel ve yürürlükte olmayan sürüm basılmaz (YG-1165). */
async function fotoOgeleri(db: Db, dosya: string, dil: Dil, ilkSekil: number, azami = 24) {
  const r = (await db.query(`SELECT g.gorsel_no, g.cekim_kalemi, g.cekim_zamani, g.konum, s.depo_anahtari, lower(s.uzanti) uzanti FROM gorsel_kanit g JOIN belge e ON e.kimlik = g.belge_ref
    JOIN LATERAL (SELECT depo_anahtari, uzanti FROM belge_surum WHERE belge_ref = e.kimlik AND durum = 'Yürürlükte' ORDER BY surum_no DESC LIMIT 1) s ON true
    WHERE g.dosya_ref = $1 AND NOT coalesce(e.hassas_icerik, false) AND lower(s.uzanti) IN ('jpg', 'jpeg', 'png') ORDER BY g.gorsel_no LIMIT $2`, [dosya, azami])).rows;
  const depo = aktifDepo ?? new Depo(); const ogeler: { src: string | null; altyazi: string }[] = [];
  for (const [n, x] of r.entries()) {
    let src: string | null = null;
    try { const p: Buffer[] = []; for await (const y of depo.bagla(x.depo_anahtari)) p.push(y as Buffer); src = `data:image/${x.uzanti === 'png' ? 'png' : 'jpeg'};base64,${Buffer.concat(p).toString('base64')}`; } catch { src = null; }
    ogeler.push({ src, altyazi: [`${dil === 'en' ? 'Figure' : 'Şekil'} ${ilkSekil + n} — ${x.gorsel_no}`, x.cekim_kalemi, x.cekim_zamani ? anSaat(x.cekim_zamani) : null, x.konum].filter(Boolean).join(' · ') });
  }
  return ogeler;
}

export const raporFotoOgeleri = (db: Db, dosya: string, dil: Dil, ilk: number) => fotoOgeleri(db, dosya, dil, ilk);
export const raporKaynaklari = (db: Db, dosya: string, dil: Dil, bildirim: string | null) => kaynakBolumleri(db, dosya, dil, bildirim);
/** YG-678: bilgi kaynağı dipnotu (ölçüm / belge / beyan). */
async function kaynakBolumleri(db: Db, dosya: string, dil: Dil, bildirim: Date | string | null): Promise<Bolum[]> {
  const en = dil === 'en';
  const ol = (await db.query(`SELECT o.olcum_no, o.olcum_noktasi, o.olculen_buyukluk, o.birim, o.ozet_deger, o.nominal_deger, o.tolerans, o.sinir_disi, o.gecerlilik, o.cihaz, o.kalibrasyon_durumu, o.yontem, o.olcum_zamani FROM olcum_kaydi o
    WHERE o.dosya_ref = $1 AND o.gecerlilik <> 'Geçersiz' AND NOT EXISTS (SELECT 1 FROM olcum_kaydi n WHERE n.onceki_ref = o.kimlik) ORDER BY o.olcum_no`, [dosya])).rows;
  const dip: string[] = [];
  const no = (s: string) => { dip.push(s); return `[${dip.length}]`; };
  const B: Bolum[] = [];
  if (ol.length) B.push({ baslik: en ? 'Measurements' : 'Ölçümler', tur: 'tablo', sutunlar: [{ ad: en ? 'Point' : 'Nokta' }, { ad: en ? 'Quantity' : 'Büyüklük' }, { ad: en ? 'Value' : 'Değer', hiza: 'sag' }, { ad: en ? 'Nominal / Tolerance' : 'Nominal / Tolerans' }, { ad: en ? 'Result' : 'Sonuç' }, { ad: en ? 'Source' : 'Kaynak', hiza: 'ort' }],
    satirlar: ol.map((x) => [x.olcum_noktasi, x.olculen_buyukluk, [x.ozet_deger, x.birim].filter(Boolean).join(' '), [x.nominal_deger, x.tolerans].filter(Boolean).join(' / ') || null,
      x.sinir_disi ? { m: en ? 'Out of limit' : 'Sınır dışı', renk: 'kirmizi' as Renk } : (en ? 'Within limit' : 'Sınır içinde'),
      no(`${en ? 'Measurement' : 'Ölçüm'} ${x.olcum_no} · ${[x.yontem, x.cihaz, `${en ? 'calibration' : 'kalibrasyon'}: ${x.kalibrasyon_durumu}`, x.gecerlilik === 'Sınırlı' ? (en ? 'for information only' : 'bilgi amaçlı') : null, anSaat(x.olcum_zamani)].filter(Boolean).join(' · ')}`)]) });
  no(en ? `Statement · incident date and summary as declared in the damage notification${bildirim ? ` of ${gunAy(bildirim)}` : ''}` : `Beyan · olay tarihi ve özeti${bildirim ? ` ${gunAy(bildirim)} tarihli` : ''} hasar ihbarındaki beyana dayanır`);
  no(en ? 'Document · yacht particulars from the yacht documents recorded on YATONET 360' : 'Belge · yat bilgileri YATONET 360’ta kayıtlı yat belgelerinden alınmıştır');
  B.push({ baslik: en ? 'Notes on Sources' : 'Kaynak Dipnotları', tur: 'tablo', numarasiz: true, sutunlar: [{ ad: 'No', hiza: 'ort' }, { ad: en ? 'Source' : 'Kaynak' }], satirlar: dip.map((s, n) => [`[${n + 1}]`, s]) });
  return B;
}

async function raporTanim(db: Db, id: string, kod: string, web: string) {
  const r = (await db.query(`SELECT * FROM teknik_rapor WHERE kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, r.dosya_ref, r.hazirlayan_ref); const dil = b.dil; const e = E[dil];
  const bl = (await db.query(`SELECT bulgu_no, konum_referansi, bolge_kodu, aciklama, bulgu_etiketi, hasar_onem_derecesi FROM bulgu WHERE dosya_ref = $1 ORDER BY bulgu_no`, [r.dosya_ref])).rows;
  const gr = (await db.query(`SELECT gorsel_no, cekim_kalemi, cekim_zamani, konum FROM gorsel_kanit WHERE dosya_ref = $1 AND belge_ref IS NOT NULL ORDER BY gorsel_no`, [r.dosya_ref])).rows;
  const kapanis = (await db.query(`SELECT r.rol_adi, a.zaman FROM is_karti k JOIN is_karti_adim a ON a.is_ref = k.kimlik LEFT JOIN rol r ON r.kimlik = a.rol_ref WHERE k.tur = 'Teknik Rapor' AND k.nesne_kimligi = $1 AND a.karar = 'Onayla' ORDER BY a.kimlik DESC LIMIT 1`, [id])).rows[0];
  const bolumler: Bolum[] = [...ortak(b, ADRES.inceleme[dil]),
    { baslik: e.kapsam, tur: 'alanlar', alanlar: [{ et: e.soru, deger: r.kapsam, genis: true }, { et: e.kosulS, deger: r.saha_kosullari, genis: true }, { et: e.konumS, deger: r.incelenen_alan, genis: true }] },
    { baslik: e.yontem, tur: 'metin', metin: r.yontem_olcut },
    { baslik: e.bulgu, tur: 'metin', metin: r.bulgular },
  ];
  // YG-708: önceden mevcut hasar yeni hasardan ayrı yazılır.
  const ONCE = ['Aşınma', 'Bakım ihtiyacı', 'Önceki onarım izi'];
  const blgGrup: [string, typeof bl][] = [[dil === 'en' ? 'New Damage' : 'Yeni Hasar', bl.filter((x) => x.bulgu_etiketi === 'Hasar')], [dil === 'en' ? 'Pre-existing Condition' : 'Önceden Mevcut Hasar', bl.filter((x) => ONCE.includes(x.bulgu_etiketi))], [dil === 'en' ? 'Relation to Incident Unclear' : 'Olayla İlgisi Belirsiz', bl.filter((x) => x.bulgu_etiketi !== 'Hasar' && !ONCE.includes(x.bulgu_etiketi))]];
  for (const [ad, s] of blgGrup) if (s.length) bolumler.push({ baslik: `${e.bulgu} · ${ad} (${e.bolge})`, tur: 'tablo', sutunlar: [{ ad: e.bolge }, { ad: e.gozlem }, { ad: e.konumS }, { ad: e.etiket }, { ad: e.onem }], satirlar: s.map((x) => [x.bolge_kodu ?? x.bulgu_no, x.aciklama, x.konum_referansi, x.bulgu_etiketi, x.hasar_onem_derecesi]) });
  // YG-1441: TU'nun Gerekli işaretlediği teklif satırları.
  const ro = await (await import('./resmi_onay.js')).resmiOnayGerekenler(db, r.dosya_ref);
  if (ro.length) bolumler.push({ baslik: dil === 'en' ? 'Works Requiring Statutory / Class Approval' : 'Resmî / Klas Onayı Gereken İşler', tur: 'tablo', sutunlar: [{ ad: dil === 'en' ? 'Code' : 'Kod' }, { ad: e.aciklama }], satirlar: ro.map((x) => [x.kod, x.aciklama]) });
  // YG-714: bulguların önem derecesine göre renkli risk değerlendirmesi ve ek inceleme sorusu.
  const ONEM: Record<string, Renk> = { Kritik: 'kirmizi', Yüksek: 'turuncu', Orta: 'sari', Düşük: 'yesil', Gözlem: 'yesil' };
  if (bl.length) bolumler.push({ baslik: dil === 'en' ? 'Risk Assessment' : 'Risk Değerlendirmesi', tur: 'tablo', sutunlar: [{ ad: e.bolge }, { ad: e.gozlem }, { ad: e.onem, hiza: 'ort' }], satirlar: bl.map((x) => [x.bolge_kodu, x.aciklama, { m: x.hasar_onem_derecesi, renk: ONEM[x.hasar_onem_derecesi] ?? 'sari' }]) });
  // YG-712, YG-711: beyan–bulgu uyumu; gözlenen teknik işaretler beyanla uyuşmasa da olduğu gibi yazılır.
  if (r.beyan_bulgu_uyumu) bolumler.push({ baslik: dil === 'en' ? 'Consistency of Statement and Findings' : 'Beyan ve Bulgu Uyumu', tur: 'alanlar', alanlar: [{ et: dil === 'en' ? 'Consistency' : 'Uyum', deger: r.beyan_bulgu_uyumu }, { et: dil === 'en' ? 'Explanation' : 'Açıklama', deger: r.uyum_aciklamasi, genis: true }] });
  if (r.ek_inceleme_gerekir !== null) bolumler.push({ baslik: dil === 'en' ? 'Further Inspection' : 'Ek İnceleme', tur: 'alanlar', alanlar: [{ et: dil === 'en' ? 'Is there an area requiring further inspection?' : 'Ek inceleme gerektiren alan var mı?', deger: r.ek_inceleme_gerekir ? (dil === 'en' ? 'Yes' : 'Evet') : (dil === 'en' ? 'No' : 'Hayır') }, ...(r.ek_inceleme_gerekir ? [{ et: dil === 'en' ? 'Area' : 'Alan', deger: r.ek_inceleme_alani, genis: true }] : [])] });
  bolumler.push({ baslik: e.deger, tur: 'metin', metin: r.analiz_risk }, { baslik: e.oneri, tur: 'metin', metin: r.oneriler }, { baslik: e.acik, tur: 'metin', metin: r.acik_sorular }, { baslik: e.sinir, tur: 'metin', metin: r.uzmanlik_siniri }, ekipBolumu(b), atananEkip(b));
  void gr;
  bolumler.push(...await kaynakBolumleri(db, r.dosya_ref, dil, b.d.bildirim_tarihi)); // YG-678
  const fo = await fotoOgeleri(db, r.dosya_ref, dil, 1); // YG-713
  if (fo.length) bolumler.push({ baslik: dil === 'en' ? 'Photographic Evidence' : 'Fotoğraf Kanıtları', tur: 'fotolar', ogeler: fo });
  // YG-612: raporun dayandığı kayıt sürümleri.
  const ky = (await db.query(`SELECT (SELECT count(*)::int FROM kesif WHERE dosya_ref = $1) kesif, (SELECT max(surum)::int FROM kapsam_cetveli WHERE dosya_ref = $1) cetvel, (SELECT max(kesif_tarihi) FROM kesif WHERE dosya_ref = $1) "kesifT"`, [r.dosya_ref])).rows[0];
  bolumler.push({ baslik: dil === 'en' ? 'Records Used' : 'Kullanılan Kayıtlar', tur: 'alanlar', alanlar: [{ et: dil === 'en' ? 'File No' : 'Dosya No', deger: b.d.dosya_no }, { et: dil === 'en' ? 'Report Version' : 'Rapor Sürümü', deger: `Rev.${r.surum}` }, { et: dil === 'en' ? 'Surveys' : 'Keşif Kaydı', deger: String(ky.kesif) }, { et: dil === 'en' ? 'Scope Schedule Version' : 'Kapsam Cetveli Sürümü', deger: ky.cetvel ? `Rev.${ky.cetvel}` : null }, { et: dil === 'en' ? 'Findings' : 'Bulgu Sayısı', deger: String(bl.length) }, { et: dil === 'en' ? 'Visual Evidence' : 'Görsel Kanıt Sayısı', deger: String(gr.length) }] });
  return {
    dosyaAdi: `${r.rapor_no}.pdf`, sinif: 'Kritik',
    t: { bandEk: [{ et: dil === 'en' ? 'Inspection Date' : 'İnceleme Tarihi', deger: ky.kesifT ? gunAy(ky.kesifT) : '---' }, { et: dil === 'en' ? 'Report Type' : 'Rapor Türü', deger: r.rapor_turu ?? '---' }], ad: e.Rapor, kod: 'RP-RAP-002', no: r.rapor_no, dosyaNo: b.d.dosya_no, tarih: gunAy(new Date()), surum: `Rev.${r.surum}`, dil, yat: b.d.yat_adi, rapor: true, matbuBas: [hitap(b, e.Rapor), dil === 'en' ? 'This report is based on the on-site inspection, measurements and records made on the stated date and under the stated conditions. No opinion is given on parts that were not dismantled, accessible or inspected. The report may be revised if new information or findings arise.' : 'Bu rapor, belirtilen tarihte ve koşullarda yerinde yapılan inceleme, ölçüm ve kayıtlara dayanır. Söküm yapılmayan, erişilemeyen veya incelenmeyen bölümler için görüş verilmemiştir. Yeni bilgi veya bulgu ortaya çıkarsa rapor revize edilebilir.'], bolumler, matbuSon: [sozlesme(b.d, dil), gizli(dil), dogrula(dil, kod, web), tesekkur(dil)], onay: kapanis ? { rol: kapanis.rol_adi ?? '', zaman: anSaat(kapanis.zaman), kanal: 'YATONET 360', kod } : undefined } as BelgeTanim,
  };
}

async function onayTanim(db: Db, id: string, kod: string, web: string) {
  const t = (await db.query(`SELECT o.*, k.onay_kodu, k.onay_zamani, k.onaylayan_ad, d.dosya_no, (SELECT surum_no FROM belge_surum s WHERE s.kimlik = o.belge_surum_ref) AS belge_surum_no FROM onay_talebi o JOIN yatonet_onay_kaydi k ON k.onay_talebi_ref = o.kimlik JOIN dosya d ON d.kimlik = o.dosya_ref WHERE o.kimlik = $1 ORDER BY k.onay_zamani DESC LIMIT 1`, [id])).rows[0];
  const b = await dosyaBilgi(db, t.dosya_ref, t.hazirlayan_ref); const dil = t.dil as Dil; const e = E[dil];
  const no = await altNumara(db, t.dosya_no, 'YO');
  const bolumler: Bolum[] = [
    { baslik: e.dosyaYat, tur: 'alanlar', alanlar: [{ et: e.dosyaNo, deger: t.dosya_no }, { et: e.yatAdi, deger: b.d.yat_adi }, { et: e.marka, deger: [b.d.marka, b.d.model].filter(Boolean).join(' · ') }, { et: e.sahip, deger: b.sahip }, { et: e.bayrak, deger: b.d.bayrak }, { et: e.hasar, deger: b.d.sigorta_hasar_dosya_no }] },
    { baslik: e.konu, tur: 'alanlar', alanlar: [{ et: e.turS, deger: t.baslik }, { et: e.belgeS, deger: t.belge_adi }, { et: e.surumS, deger: t.belge_surum_no ? `Rev.${t.belge_surum_no}` : null }] },
    { baslik: e.beyan, tur: 'metin', metin: t.metin },
    { baslik: e.kayit, tur: 'alanlar', alanlar: [{ et: e.onaylayan, deger: `${t.onaylayan_ad} · ${e.sahip}` }, { et: e.yontemO, deger: e.smsY }, { et: e.kodO, deger: t.onay_kodu }, { et: e.zaman, deger: anSaat(t.onay_zamani) }] },
    ekipBolumu({ ...b, dil, ekip: b.ekip.filter((x) => x.rol === 'Dosya Sorumlusu') }),
  ];
  // YG-726: Ek İş Reddi ve Kullanım Sınırı Bildirimi; yat sahibi okudum onayını SMS koduyla verir.
  const er = t.ony_kod === 'ONY-06' ? (await db.query(`SELECT * FROM ek_is_reddi WHERE onay_talebi_ref = $1`, [id])).rows[0] : null;
  if (er) bolumler.splice(3, 0, { baslik: dil === 'en' ? 'Additional Work Rejection and Usage Limitation Notice' : 'Ek İş Reddi ve Kullanım Sınırı Bildirimi', tur: 'alanlar', alanlar: [
    { et: dil === 'en' ? 'Quotation' : 'Teklif', deger: er.teklif_no }, { et: dil === 'en' ? 'Work Not Carried Out' : 'Yapılmayan İş', deger: er.yapilmayan_is, genis: true }, { et: dil === 'en' ? 'Possible Technical Effect' : 'Olası Teknik Etki', deger: er.teknik_etki, genis: true },
    { et: dil === 'en' ? 'Usage Limitation' : 'Kullanım Sınırı', deger: er.kullanim_siniri, genis: true }, { et: dil === 'en' ? 'Recommended Check' : 'Önerilen Kontrol', deger: er.onerilen_kontrol, genis: true }] });
  return { dosyaAdi: `${no}.pdf`, sinif: 'Gizli', t: { ad: e.Onay, kod: 'FR-OPS-017', no, dosyaNo: t.dosya_no, tarih: gunAy(t.onay_zamani), surum: 'Rev.1', dil, yat: b.d.yat_adi, matbuBas: dil === 'en' ? ['SUBJECT: YOUR APPROVAL HAS BEEN RECEIVED', 'Your approval has been received on the YATONET 360 approval screen and recorded with the details below. This certificate has been sent to your registered e-mail address together with a PDF copy of the document you approved.'] : ['KONU: ONAYINIZ ALINMIŞTIR', 'Değerli onayınız YATONET 360 onay ekranında alınmış ve aşağıdaki bilgilerle kayda geçirilmiştir. Bu belge, onayladığınız belgenin PDF örneğiyle birlikte kayıtlı e-posta adresinize gönderilmiştir.'], bolumler, matbuSon: [sozlesme({ musteri_turu: 'Bireysel' }, dil), dogrula(dil, kod, web), tesekkur(dil)] } as BelgeTanim };
}

export async function odemeTanim(db: Db, tur: 'Proforma' | 'Ödeme Talebi', id: string, kod: string, web: string) {
  const f = tur === 'Proforma' ? (await db.query(`SELECT m.proforma_no AS no, m.dosya_ref, m.teklif_ref, m.kdv_haric_eur, m.kdv_eur, m.toplam_eur, m.vade, m.kur, to_char(m.kur_tarihi, 'DD.MM.YYYY') kur_t, 'Nihai' AS talep_turu, t.teklif_no, t.kdv_orani, t.kesif_mahsubu_eur, t.indirim_orani FROM musteri_faturasi m LEFT JOIN fiyat_teklifi t ON t.kimlik = m.teklif_ref WHERE m.kimlik = $1`, [id])).rows[0]
    : (await db.query(`SELECT NULL AS no, o.dosya_ref, o.teklif_ref, o.tutar_eur AS toplam_eur, o.son_tarih AS vade, o.tur AS talep_turu, t.teklif_no, t.kdv_orani FROM odeme_talebi o LEFT JOIN fiyat_teklifi t ON t.kimlik = o.teklif_ref WHERE o.kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, f.dosya_ref, ''); const dil = b.dil; const e = E[dil];
  const onceki = tur === 'Proforma' ? Number((await db.query(`SELECT coalesce(sum(tutar_eur), 0) n FROM tahsilat WHERE dosya_ref = $1`, [f.dosya_ref])).rows[0].n) : 0;
  const kapanis = tur === 'Proforma' ? (await db.query(`SELECT r.rol_adi, a.zaman FROM is_karti k JOIN is_karti_adim a ON a.is_ref = k.kimlik LEFT JOIN rol r ON r.kimlik = a.rol_ref WHERE k.tur = 'Proforma' AND k.nesne_kimligi = $1 AND a.karar = 'Onayla' ORDER BY a.kimlik DESC LIMIT 1`, [id])).rows[0] : undefined;
  const no = f.no ?? await altNumara(db, b.d.dosya_no, 'OT');
  const kl = tur === 'Proforma' ? (await db.query(`SELECT sira_no, kartela_kodu, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu = 'Onaylandı' ORDER BY sira_no`, [f.teklif_ref])).rows : [];
  const bolumler: Bolum[] = [
    { baslik: e.musteri, tur: 'alanlar', alanlar: [{ et: e.must, deger: b.d.musteri_turu === 'Sigorta Şirketi' ? b.d.sigortaci_adi : b.sahip }, { et: e.talepT, deger: f.talep_turu }, { et: e.dosyaNo, deger: b.d.dosya_no }, { et: e.yatAdi, deger: b.d.yat_adi }, { et: e.marka, deger: [b.d.marka, b.d.model].filter(Boolean).join(' · ') }, { et: e.dayanak, deger: f.teklif_no }, { et: e.son, deger: f.vade ? gunAy(f.vade) : null }] },
  ];
  // YG-1602: kalem yapısı teklifle aynı; indirim yalnız uygulandıysa (onaylı kalem toplamı − keşif mahsubu − matrah); TL karşılığı fatura kuru girilmişse.
  const brut = kl.reduce((a, k) => a + Number(k.tutar_eur), 0); const ind = Math.round((brut - Number(f.kesif_mahsubu_eur ?? 0) - Number(f.kdv_haric_eur)) * 100) / 100;
  const indVar = Number(f.indirim_orani) > 0 && ind > 0;
  const tl = f.kur ? [{ et: dil === 'en' ? `TRY Equivalent (rate ${f.kur_t}: ${String(Number(f.kur)).replace('.', ',')})` : `TL Karşılığı (${f.kur_t} kuru: ${String(Number(f.kur)).replace('.', ',')})`, deger: `${tutar(Math.round(Number(f.toplam_eur) * Number(f.kur) * 100) / 100, dil).replace(' EUR', '')} TL` }] : [];
  if (kl.length) bolumler.push({ baslik: e.talep, tur: 'tablo', sutunlar: [{ ad: e.sira, hiza: 'ort' }, { ad: e.kod }, { ad: e.aciklama }, { ad: e.nitelik }, { ad: e.bedel }, { ad: e.miktar, hiza: 'sag' }, { ad: e.fiyat, hiza: 'sag' }, { ad: e.tutar, hiza: 'sag' }], satirlar: kl.map((k) => [k.sira_no, k.kartela_kodu, k.aciklama, k.isin_niteligi, k.bedel_turu, miktarYaz(k, dil), para(k.birim_satis_fiyati_eur, dil), para(k.tutar_eur, dil)]), toplamlar: [...(indVar ? [{ et: e.ara, deger: para(brut, dil) }, { et: `${e.indirim} %${oran(f.indirim_orani)}`, deger: `-${para(ind, dil)}` }] : []), ...(Number(f.kesif_mahsubu_eur) > 0 ? [{ et: e.kesifM, deger: `− ${para(f.kesif_mahsubu_eur, dil)}` }] : []), ...(indVar ? [] : [{ et: e.ara, deger: para(f.kdv_haric_eur, dil) }]), { et: `${e.kdv} %${oran(f.kdv_orani)}`, deger: para(f.kdv_eur, dil) }, { et: e.genel, deger: para(f.toplam_eur, dil) }, { et: e.onceki, deger: para(onceki, dil) }, { et: e.odenecek, deger: para(Number(f.toplam_eur) - onceki, dil), ana: true }, ...tl] });
  else bolumler.push({ baslik: e.talep, tur: 'alanlar', alanlar: [{ et: e.aciklama, deger: f.talep_turu }, { et: e.genel, deger: para(f.toplam_eur, dil) }] });
  bolumler.push(ekipBolumu({ ...b, ekip: b.ekip.filter((x) => x.rol === 'Dosya Sorumlusu') }));
  return { dosyaAdi: `${no}.pdf`, sinif: 'Kritik', t: { ad: e.Odeme, kod: 'FR-TIC-010', no, dosyaNo: b.d.dosya_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil, yat: b.d.yat_adi, matbuBas: [hitap(b, e.Odeme), ...(f.talep_turu === 'Nihai' ? [dil === 'en' ? `The final payment request for the work completed and accepted with your approval under file no. ${b.d.dosya_no} is set out below for your information. This document is a pro forma and is not an invoice.` : `${b.d.dosya_no} numaralı dosyanızda tamamlanan ve onayınızla kabul edilen işlere ilişkin nihai ödeme talebi aşağıda bilgilerinize sunulmuştur. Bu belge proforma niteliğindedir ve fatura yerine geçmez.`] : [e.proforma])], bolumler, matbuSon: [dil === 'en' ? 'Amounts are in EUR; VAT is shown separately. This document is a pro forma and does not replace an invoice; your invoice will be sent separately by our Accounting Department in TRY at the CBRT foreign exchange selling rate of the business day preceding the invoice date.' : 'Tutarlar EUR cinsindendir; KDV ayrıca gösterilmiştir. Bu belge proforma niteliğindedir, fatura yerine geçmez; faturanız Muhasebe Birimimizce, fatura tarihinden önceki iş gününe ait TCMB döviz satış kuruyla TL olarak ayrıca iletilecektir.', dogrula(dil, kod, web), tesekkur(dil)], onay: kapanis ? { rol: kapanis.rol_adi ?? '', zaman: anSaat(kapanis.zaman), kanal: 'YATONET 360', kod } : undefined } as BelgeTanim };
}

/** YG-896, FR-TIC-013: kalem, tutar ve son tarih; gerekçe yorumu yok, gövde onaylı BLD-30 metnidir. */
export async function sorumlulukTanim(db: Db, id: string, kod: string, web: string) {
  const v = await odemeTanim(db, 'Ödeme Talebi', id, kod, web);
  const kl = (await db.query(`SELECT tur, aciklama, tutar_eur FROM odeme_sorumlulugu_kalemi WHERE odeme_talebi_ref = $1`, [id])).rows;
  const dil = v.t.dil as Dil; const en = dil === 'en';
  const govde = await metinGetir(db, 'BLD-30', dil, { 'Dosya No': v.t.dosyaNo as string, 'File No': v.t.dosyaNo as string, 'bağlantı': web, link: web });
  // YG-896: TL tutar, dosyada muhasebeden gelmiş son fatura kuruyla (K-193: önceki iş günü TCMB satış); kur yoksa TL sütunu basılmaz, tutar uydurulmaz.
  const kr = (await db.query(`SELECT f.kur, to_char(f.kur_tarihi, 'DD.MM.YYYY') t FROM musteri_faturasi f JOIN odeme_talebi o ON o.dosya_ref = f.dosya_ref WHERE o.kimlik = $1 AND f.kur IS NOT NULL ORDER BY f.kur_tarihi DESC LIMIT 1`, [id])).rows[0];
  const sut = [{ ad: en ? 'Item' : 'Kalem' }, { ad: en ? 'Description' : 'Açıklama' }, { ad: en ? 'Amount (EUR)' : 'Tutar (EUR)', hiza: 'sag' }, ...(kr ? [{ ad: en ? `Amount (TRY, rate ${kr.t})` : `Tutar (TL, ${kr.t} kuru)`, hiza: 'sag' }] : [])];
  return { ...v, t: { ...v.t, ad: en ? 'Payment Responsibility Notice' : 'Ödeme Sorumluluğu Bildirimi', kod: 'FR-TIC-013', matbuBas: [govde], bolumler: [{ baslik: en ? 'Items' : 'Kalemler', tur: 'tablo', sutunlar: sut, satirlar: kl.map((k) => [k.tur, k.aciklama, tutar(Number(k.tutar_eur), dil), ...(kr ? [tutar(Math.round(Number(k.tutar_eur) * Number(kr.kur) * 100) / 100, dil)] : [])]) } as Bolum, ...(v.t.bolumler as Bolum[])] } };
}

/** YG-107, FR-KLT-012: dosyanın onay, SMS, teslim, fatura ve yazışma kayıtları tek belgede. Belge asılları bu paketin içine gömülmez, dosyada kalır. */
export async function uyusmazlikTanim(db: Db, id: string, kod: string) {
  const u = (await db.query(`SELECT u.*, d.dosya_no, y.yat_adi FROM uyusmazlik_kaydi u JOIN dosya d ON d.kimlik = u.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE u.kimlik = $1`, [id])).rows[0];
  const q = (s: string) => db.query(s, [u.dosya_ref]).then((r) => r.rows);
  const onay = await q(`SELECT ony_kod, durum, tutar_eur, olusturma_zamani FROM onay_talebi WHERE dosya_ref = $1 ORDER BY olusturma_zamani`);
  const teslim = await q(`SELECT durum, olusturma_zamani FROM teslim_kaydi WHERE dosya_ref = $1 ORDER BY olusturma_zamani`);
  const fatura = await q(`SELECT proforma_no, fatura_no, durum, toplam_eur, tahsil_edilen_eur FROM musteri_faturasi WHERE dosya_ref = $1 ORDER BY olusturma_zamani`);
  const belge = await q(`SELECT ad, belge_turu, belge_tarihi FROM belge WHERE bag_turu = 'Dosya' AND bag_kimligi = $1::text ORDER BY belge_tarihi`);
  const sat = (s: unknown) => (s === null || s === undefined ? '-' : s instanceof Date ? gunAy(s) : String(s));
  const bolumler: Bolum[] = [
    { baslik: 'Uyuşmazlık', tur: 'alanlar', alanlar: [{ et: 'Merci', deger: u.merci }, { et: 'Esas No', deger: u.esas_no }, { et: 'Savunma Son Günü', deger: u.savunma_son ? gunAy(u.savunma_son) : null }, { et: 'Karar', deger: u.karar }] },
    { baslik: 'Onay Kayıtları', tur: 'tablo', sutunlar: [{ ad: 'Onay' }, { ad: 'Durum' }, { ad: 'Tutar (EUR)', hiza: 'sag' }, { ad: 'Tarih' }], satirlar: onay.map((x) => [x.ony_kod, x.durum, x.tutar_eur === null ? '-' : tutar(Number(x.tutar_eur)), sat(x.olusturma_zamani)]) },
    { baslik: 'Teslim Kayıtları', tur: 'tablo', sutunlar: [{ ad: 'Durum' }, { ad: 'Tarih' }], satirlar: teslim.map((x) => [x.durum, sat(x.olusturma_zamani)]) },
    { baslik: 'Faturalar', tur: 'tablo', sutunlar: [{ ad: 'Proforma' }, { ad: 'Fatura' }, { ad: 'Durum' }, { ad: 'Toplam (EUR)', hiza: 'sag' }, { ad: 'Tahsil (EUR)', hiza: 'sag' }], satirlar: fatura.map((x) => [x.proforma_no, sat(x.fatura_no), x.durum, tutar(Number(x.toplam_eur)), tutar(Number(x.tahsil_edilen_eur))]) },
    { baslik: 'Dosyadaki Belgeler', tur: 'tablo', sutunlar: [{ ad: 'Belge' }, { ad: 'Tür' }, { ad: 'Tarih' }], satirlar: belge.map((x) => [x.ad, x.belge_turu, sat(x.belge_tarihi)]) },
  ];
  bolumler.push(...await (await import('./uyusmazlik_ek.js')).uyusmazlikEkBolumleri(db, u.dosya_ref)); // YG-107
  const no = await altNumara(db, u.dosya_no, 'UP');
  return { dosyaAdi: `${no}.pdf`, sinif: 'Kritik', t: { ad: 'Uyuşmazlık Dışa Aktarım Paketi', no, dosyaNo: u.dosya_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil: 'tr' as Dil, yat: u.yat_adi, icKayit: true, bolumler, kodEk: kod } };
}

/** YG-456: sigorta şirketi başına aylık mutabakat raporu. */
export async function mutabakatTanim(db: Db, id: string) {
  const r = (await db.query(`SELECT * FROM sigorta_mutabakat_raporu WHERE kimlik = $1`, [id])).rows[0];
  const s = (await db.query(`SELECT d.dosya_no, x.sigorta_hasar_dosya_no, f.fatura_no, f.fatura_tarihi, m.onayli_tutar, m.odenen_tutar, m.acik_bakiye FROM sigorta_mutabakat_satiri m JOIN dosya d ON d.kimlik = m.dosya_ref JOIN musteri_faturasi f ON f.kimlik = m.fatura_ref LEFT JOIN dosya_sigorta_kaydi x ON x.dosya_ref = d.kimlik WHERE m.rapor_ref = $1 ORDER BY d.dosya_no`, [id])).rows;
  const top = s.reduce((a, x) => a + Number(x.acik_bakiye), 0);
  const bolumler: Bolum[] = [
    { baslik: 'Rapor', tur: 'alanlar', alanlar: [{ et: 'Sigorta Şirketi', deger: r.sigortaci_adi }, { et: 'Dönem', deger: r.donem }, { et: 'Kesim Tarihi', deger: gunAy(r.kesim_tarihi) }, { et: 'İtiraz Son Tarihi', deger: r.itiraz_son ? gunAy(r.itiraz_son) : null }, { et: 'Toplam Açık Bakiye (EUR)', deger: tutar(top) }] },
    { baslik: 'Mutabakat Satırları', tur: 'tablo', sutunlar: [{ ad: 'Dosya No' }, { ad: 'Hasar Dosya No' }, { ad: 'Fatura No' }, { ad: 'Fatura Tarihi' }, { ad: 'Onaylı (EUR)', hiza: 'sag' }, { ad: 'Ödenen (EUR)', hiza: 'sag' }, { ad: 'Açık (EUR)', hiza: 'sag' }], satirlar: s.map((x) => [x.dosya_no, x.sigorta_hasar_dosya_no, x.fatura_no, gunAy(x.fatura_tarihi), tutar(Number(x.onayli_tutar)), tutar(Number(x.odenen_tutar)), tutar(Number(x.acik_bakiye))]) },
  ];
  // YG-767: onaylı aylık performans raporu RP-TIC-001 ile birlikte, aynı belgede gönderilir.
  const pf = await (await import('./sigorta_performans.js')).onayliPerformans(db, r.sigortaci_adi, r.donem);
  if (pf?.veri) bolumler.push({ baslik: 'Aylık Performans', tur: 'alanlar', alanlar: [{ et: 'Dosya Sayısı', deger: String(pf.veri.dosyaSayisi) }, { et: 'Kapanan Dosya', deger: String(pf.veri.kapananDosya) }, { et: 'Ortalama Dosya Süresi (gün)', deger: pf.veri.ortalamaDosyaSuresiGun === null ? '---' : String(pf.veri.ortalamaDosyaSuresiGun).replace('.', ',') }, { et: 'Süre Uyumu', deger: pf.veri.sureUyumuYuzde === null ? '---' : `%${String(pf.veri.sureUyumuYuzde).replace('.', ',')}` }, { et: 'Şikâyetler', deger: String(pf.veri.sikayet) }] });
  const no = `MT-${r.donem}-${String(r.sigortaci_adi).slice(0, 12).replace(/\s/g, '')}`;
  return { dosyaAdi: `${no}.pdf`, sinif: 'Gizli', t: { ad: 'Sigorta Mutabakatı', kod: 'RP-TIC-001', no, tarih: gunAy(new Date()), surum: 'Rev.1', dil: 'tr' as Dil, bolumler } };
}

/** YNT-2, K-192: yat sahibine bilgi nüshası; yalnız kapsam ve uygulama sırası, firma, fiyat, malzeme tablosu ve proses sınırı yok. */
export async function yontemBilgiTanim(db: Db, id: string) {
  const r = (await db.query(`SELECT * FROM yontem_raporu WHERE kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, r.dosya_ref, r.hazirlayan_ref); const en = b.dil === 'en';
  const t: BelgeTanim = { ad: en ? 'Repair Method Report - Information Copy' : 'Onarım Yöntem Raporu - Bilgi Nüshası', kod: 'FR-ONR-001', no: r.rapor_no, dosyaNo: b.d.dosya_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil: b.dil, yat: b.d.yat_adi, bolumler: [...ortak(b), { baslik: en ? 'Scope' : 'Kapsam', tur: 'metin', metin: r.kapsam }, { baslik: en ? 'Application Sequence' : 'Uygulama Sırası', tur: 'metin', metin: r.uygulama_sirasi }] };
  return { dosyaAdi: `${r.rapor_no}-Bilgi.pdf`, sinif: 'Gizli', t };
}

async function isEmriTanim(db: Db, id: string, kod: string, web: string) {
  const e = (await db.query(`SELECT e.*, k.ticari_unvan, d.oncelik, d.kesin_teslim_tarihi, d.gecikme_bedeli_eur, d.kesin_teslim_durumu, f.teklif_no, f.surum_no AS teklif_surum FROM is_emri e JOIN kurulus k ON k.kimlik = e.kurulus_ref JOIN dosya d ON d.kimlik = e.dosya_ref LEFT JOIN fiyat_teklifi f ON f.kimlik = e.teklif_ref WHERE e.kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, e.dosya_ref, ''); const dil: Dil = 'tr'; const bt = { ...b, dil };
  const kl = (await db.query(`SELECT aciklama, miktar, birim FROM is_emri_kalemi WHERE is_emri_ref = $1 ORDER BY aciklama`, [id])).rows;
  const rapor = (await db.query(`SELECT rapor_no FROM teknik_rapor WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY surum DESC LIMIT 1`, [e.dosya_ref])).rows[0]?.rapor_no as string | undefined;
  const lgm = (await db.query(`SELECT r.rol_adi, a.zaman FROM is_karti k JOIN is_karti_adim a ON a.is_ref = k.kimlik LEFT JOIN rol r ON r.kimlik = a.rol_ref WHERE k.tur = 'İş Emri' AND k.nesne_kimligi = $1 AND a.karar = 'Onayla' ORDER BY a.kimlik DESC LIMIT 1`, [id])).rows[0];
  const yetkili = (await db.query(`SELECT h.ad_soyad, h.cep_telefonu, h.e_posta FROM is_emri x JOIN kullanici_hesabi h ON h.kimlik = x.firma_kabul_eden_ref WHERE x.kimlik = $1`, [id])).rows[0];
  const taraflar = (await db.query(`SELECT taraf_rolu, kisi_adi_soyadi, telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif AND taraf_rolu IN ('Kaptan', 'Marina / Tesis İrtibat Kişisi')`, [e.dosya_ref])).rows;
  const TURLER: Record<string, string> = { KN: 'Keşif (KN)', AC: 'Acil (AC)', ON: 'Onarım (ON)', EK: 'Ek İş (EK)', GR: 'Garanti (GR)', PH: 'Parça Hizmeti (PH)' };
  const [ortM, ortY, ortO] = ortak(bt);
  const bolumler: Bolum[] = [
    { baslik: 'Görevlendirme', tur: 'alanlar', alanlar: [{ et: 'İş Emri Türü', deger: TURLER[e.is_emri_turu] ?? e.is_emri_turu }, { et: 'İş Birliği Firması', deger: e.ticari_unvan }, { et: 'Öncelik', deger: e.oncelik }, { et: 'Dayanak', deger: [rapor, e.teklif_no && `${e.teklif_no} (Rev.${e.teklif_surum})`].filter(Boolean).join(' · ') }, { et: 'Başlangıç', deger: e.baslangic_tarihi ? gunAy(e.baslangic_tarihi) : null }, { et: 'Teslim', deger: e.hedef_bitis_tarihi ? gunAy(e.hedef_bitis_tarihi) : null }] },
    { ...ortY!, alanlar: [...(ortY as Extract<Bolum, { tur: 'alanlar' }>).alanlar.slice(0, -1), { et: 'Çalışma Adresi', deger: e.uygulama_yeri, genis: true }] } as Bolum,
    ortO!,
    { baslik: 'Kapsam', tur: 'metin', metin: e.kapsam },
  ];
  void ortM;
  if (kl.length) bolumler.push({ baslik: 'İş Paketleri', tur: 'tablo', sutunlar: [{ ad: 'Paket', hiza: 'ort' }, { ad: 'Kapsam' }, { ad: 'Miktar', hiza: 'sag' }], satirlar: kl.map((k, n) => [n + 1, k.aciklama, miktarYaz(k, dil)]) });
  const dayanak = e.is_emri_turu === 'AC' ? 'Firmanın onaylı acil hizmet tarifesi (İB Çerçeve Sözleşmesi Ek-1)  ·  iş emri fiyat içermez' : e.teklif_ref ? 'Onaylı Firma Fiyat Teklifi FR-TIC-012  ·  iş emri fiyat içermez' : 'İş emri fiyat içermez';
  bolumler.push({ baslik: 'Bedel Dayanağı', tur: 'alanlar', alanlar: [{ et: 'Bedel Dayanağı', deger: dayanak, genis: true }] });
  if (['ON', 'EK', 'GR'].includes(e.is_emri_turu)) bolumler.push({ baslik: 'Saha Kuralları', tur: 'alanlar', alanlar: [{ et: 'Yatın Kullanımı', deger: 'Yatı yalnız yatın kaptanı kullanır', genis: true }, { et: 'Kayıt', deger: 'İlerleme ve fotoğraflar her gün YATONET 360’a', genis: true }, { et: 'Atık', deger: 'Ayrıştırılır, teslim belgesi yüklenir', genis: true }, { et: 'İSG', deger: 'Çalışma izni ve kişisel koruyucu donanım zorunlu', genis: true }, { et: 'İletişim', deger: 'Müşteri ve sigorta ile yalnız LGM üzerinden', genis: true }, { et: 'Çalışma Saatleri', deger: 'Tesisin çalışma saatlerine ve kurallarına uyulur', genis: true }] });
  const satir = (g: string, ad: unknown, tel: unknown, ep: unknown) => [g, ad as string, tel as string, ep as string];
  bolumler.push(
    { baslik: E.tr.iletisim, tur: 'tablo', sutunlar: [{ ad: 'Görev' }, { ad: 'Ad Soyad' }, { ad: 'Telefon' }, { ad: 'E-posta' }], satirlar: [
      ...b.ekip.filter((x) => x.rol === 'Dosya Sorumlusu' || x.rol === 'Saha Sorumlusu').map((x) => satir(`LGM ${x.rol}`, null, x.cep_telefonu, x.e_posta)), // YG-689
      ...taraflar.map((x) => satir(x.taraf_rolu === 'Kaptan' ? 'Yatın Kaptanı' : 'Tesis Yetkilisi', x.kisi_adi_soyadi, x.telefon, x.eposta)),
      ...(yetkili ? [satir('Firma Yetkilisi', yetkili.ad_soyad, yetkili.cep_telefonu, yetkili.e_posta)] : []),
    ] },
    atananEkip(bt),
    ...(e.kesin_teslim_durumu === 'Onaylandı' ? [{ baslik: 'Kesin Teslim', tur: 'alanlar' as const, alanlar: [{ et: 'Kesin Teslim Tarihi', deger: gunAy(e.kesin_teslim_tarihi) }, { et: 'Gecikme Bedeli (EUR)', deger: tutar(Number(e.gecikme_bedeli_eur)) }] }] : []), // YG-215
    { baslik: 'Onay ve Kabul', tur: 'alanlar', alanlar: [{ et: 'LGM Onayı', deger: lgm ? `${lgm.rol_adi}  ·  YATONET 360  ·  ${anSaat(lgm.zaman)}` : null, genis: true }, { et: 'Firma Kabulü', deger: e.firma_yaniti === 'Kabul' ? `Firma Yetkilisi  ·  YATONET 360 portalında “Kabul ediyorum”  ·  ${anSaat(e.firma_kabul_zamani)}  ·  imza alınmaz` : 'Bekleniyor', genis: true }] },
  );
  if (e.ana_is_emri_ref) { const ana = (await db.query(`SELECT is_emri_no FROM is_emri WHERE kimlik = $1`, [e.ana_is_emri_ref])).rows[0]?.is_emri_no; bolumler.unshift({ baslik: 'Bağlı Olduğu İş Emri', tur: 'alanlar', alanlar: [{ et: 'İş Emri No', deger: ana }] }); } // YG-658
  return {
    dosyaAdi: `${e.is_emri_no}.pdf`, sinif: 'Kritik',
    t: { ad: e.is_emri_turu === 'EK' ? 'Ek İş Emri' : 'İş Emri', kod: 'FR-OPS-008', no: e.is_emri_no, /* YG-656 */ dosyaNo: b.d.dosya_no, tarih: gunAy(e.yayim_zamani ?? new Date()), surum: `Rev.${e.surum}`, dil, yat: b.d.yat_adi, bolumler,
      matbuSon: [gizli(dil), 'Bu iş emri kapsamındaki işler; İş Birliği Firması Çerçeve Sözleşmesi, iş güvenliği kuralları, kalite ve kayıt yükümlülükleri ile gizlilik hükümlerine uygun olarak yürütülür. Kapsam dışı işler YATONET 360 onayı olmadan yapılmaz.', dogrula(dil, kod, web), 'İş birliğiniz için teşekkür ederiz.'],
      onay: e.firma_yaniti === 'Kabul' ? { rol: 'Firma Yetkilisi', zaman: anSaat(e.firma_kabul_zamani), kanal: 'YATONET 360', kod } : undefined } as BelgeTanim,
  };
}

export async function tutanakTanim(db: Db, id: string, kod: string, web: string) {
  const k = (await db.query(`SELECT * FROM teslim_kaydi WHERE kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, k.dosya_ref, ''); const dil = b.dil; const en = dil === 'en'; const e = E[dil];
  const no = await altNumara(db, b.d.dosya_no, 'TT');
  const teslim = k.teslim_zamani ?? new Date();
  const bitis = new Date(teslim); bitis.setFullYear(bitis.getFullYear() + 1);
  const isler = (await db.query(`SELECT m.aciklama, (SELECT kabul_turu FROM kabul_kaydi x WHERE x.is_emri_ref = i.kimlik ORDER BY x.olusturma_zamani DESC LIMIT 1) AS kabul FROM is_emri_kalemi m JOIN is_emri i ON i.kimlik = m.is_emri_ref WHERE i.dosya_ref = $1 AND i.is_emri_turu IN ('ON', 'EK', 'GR', 'AC') AND i.statu NOT IN ('İptal', 'Yerine Geçti', 'Taslak') ORDER BY i.is_emri_no, m.aciklama`, [k.dosya_ref])).rows;
  const testler = (await db.query(`SELECT test_grubu, sonuc, sonuc_gerekcesi FROM test_kaydi WHERE dosya_ref = $1 AND sonuc IS NOT NULL ORDER BY test_no`, [k.dosya_ref])).rows;
  const kabul = (await db.query(`SELECT kimlik, kabul_turu, olusturma_zamani FROM kabul_kaydi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 1`, [k.dosya_ref])).rows[0];
  const acik = (await db.query(`SELECT a.tanim, a.hedef_tarih FROM acik_is_kalemi a JOIN kabul_kaydi x ON x.kimlik = a.kabul_ref WHERE x.dosya_ref = $1 AND a.kapanis_zamani IS NULL ORDER BY a.hedef_tarih`, [k.dosya_ref])).rows;
  const red = (await db.query(`SELECT r.yapilmayan_is, r.kullanim_siniri FROM ek_is_reddi r JOIN onay_talebi o ON o.kimlik = r.onay_talebi_ref WHERE r.dosya_ref = $1 AND o.durum = 'Onaylandı' ORDER BY r.olusturma_zamani`, [k.dosya_ref])).rows;
  const onay = (await db.query(`SELECT r.onay_kodu, r.onay_zamani, r.onaylayan_ad FROM onay_talebi o JOIN yatonet_onay_kaydi r ON r.onay_talebi_ref = o.kimlik WHERE o.dosya_ref = $1 AND o.ony_kod = 'ONY-27' AND r.karar = 'Onaylandı' ORDER BY r.onay_zamani DESC LIMIT 1`, [k.dosya_ref])).rows[0];
  const eden = b.ekip.find((x) => x.kullanici === k.teslim_eden_ref)?.rol as string | undefined;
  const taraflar = (await db.query(`SELECT taraf_rolu, kisi_adi_soyadi, telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif AND taraf_rolu IN ('Yat Sahibi', 'Kaptan')`, [k.dosya_ref])).rows;
  const T = en ? { h: 'Handover', tur: 'Type', turD: 'Handover to Owner', eden: 'Handed Over By', alan: 'Received By', sonuc: 'Acceptance Result', devir: 'Time of Transfer of Custody', is: 'Completed Work', paket: 'Package', test: 'Test and Acceptance Result', ozet: 'Summary of Test Results', tt: 'Test', ts: 'Result', not: 'Note', gar: 'Warranty Information', kalem: 'Item', bas: 'Warranty Start', bit: 'Warranty End', gn: 'Restarts for 12 months if corrected', kab: 'Acceptance', ktur: 'Acceptance Type', acik: 'Open Item', var: 'Yes', yok: 'None', sor: 'Completion Date', ad: 'Yacht Handover Record', ko: 'Received By', kap: 'Yat', sah: 'Yacht Owner', kpt: 'Yacht Captain' }
    : { h: 'Teslim', tur: 'Tür', turD: 'Teslim Etme', eden: 'Teslim Eden', alan: 'Teslim Alan', sonuc: 'Kabul Sonucu', devir: 'Sorumluluk Devri Saati', is: 'Tamamlanan İşler', paket: 'Paket', test: 'Test ve Kabul Sonucu', ozet: 'Test Sonuçları Özeti', tt: 'Test', ts: 'Sonuç', not: 'Not', gar: 'Garanti Bilgisi', kalem: 'Kalem', bas: 'Garanti Başlangıcı', bit: 'Garanti Bitişi', gn: 'Düzeltilirse yeniden 12 ay', kab: 'Kabul', ktur: 'Kabul Türü', acik: 'Açık İş', var: 'Var', yok: 'Yok', sor: 'Tamamlama Tarihi', ad: 'Yat Teslim Tutanağı', ko: 'Teslim Alan', kap: 'Yat', sah: 'Yat Sahibi', kpt: 'Yatın Kaptanı' };
  const [, ortY] = ortak(b, ADRES.teslim[en ? 'en' : 'tr']);
  const bolumler: Bolum[] = [
    { baslik: T.h, tur: 'alanlar', alanlar: [{ et: T.tur, deger: T.turD }, { et: T.eden, deger: eden ? `LGM ${en ? ROL_EN[eden] ?? eden : eden}` : 'LGM' }, { et: T.alan, deger: k.teslim_alan }, { et: e.must, deger: b.d.musteri_turu === 'Sigorta Şirketi' ? b.d.sigortaci_adi : b.sahip }, { et: e.hasar, deger: b.d.sigorta_hasar_dosya_no }, { et: T.sonuc, deger: kabul?.kabul_turu }, { et: T.devir, deger: anSaat(teslim) }] },
    ortY!,
  ];
  if (isler.length) {
    bolumler.push({ baslik: T.is, tur: 'tablo', sutunlar: [{ ad: T.paket, hiza: 'ort' }, { ad: e.aciklama }, { ad: T.test }], satirlar: isler.map((x, n) => [n + 1, x.aciklama, x.kabul]) });
    bolumler.push({ baslik: T.gar, tur: 'tablo', sutunlar: [{ ad: T.paket, hiza: 'ort' }, { ad: T.kalem }, { ad: T.bas }, { ad: T.bit }, { ad: T.not }], satirlar: isler.map((x, n) => [n + 1, x.aciklama, gunAy(teslim), gunAy(bitis), T.gn]) });
  }
  if (testler.length) bolumler.push({ baslik: T.ozet, tur: 'tablo', sutunlar: [{ ad: T.tt }, { ad: T.ts }, { ad: T.not }], satirlar: testler.map((x) => [x.test_grubu, x.sonuc, x.sonuc_gerekcesi]) });
  // YG-650: kışa sarkan dosyada kışlık hazırlık sorumlusu teslim tutanağına yazılır.
  const ks = (await db.query(`SELECT coalesce(h.ad_soyad, t.kisi_adi_soyadi || ' (' || t.taraf_rolu || ')') ad FROM dosya d LEFT JOIN kullanici_hesabi h ON h.kimlik = d.kislik_sorumlu_kullanici_ref LEFT JOIN dosya_tarafi t ON t.kimlik = d.kislik_sorumlu_taraf_ref WHERE d.kimlik = $1`, [k.dosya_ref])).rows[0]?.ad as string | null;
  // YG-724: kabul bölümü kısa satırlı renkli durum tablosu; Koşullu Kabul turuncu, açık iş ve eksik sarı, yok yeşil.
  const yok = { m: T.yok, renk: 'yesil' as Renk };
  bolumler.push({ baslik: T.kab, tur: 'tablo', sutunlar: [{ ad: en ? 'Item' : 'Konu' }, { ad: en ? 'Status' : 'Durum', hiza: 'ort' }], satirlar: [
    [en ? 'Acceptance Record' : 'Kabul Kaydı', kabul ? `FR-KLT-009 · ${anSaat(kabul.olusturma_zamani)}` : null], /* YG-647 */
    [T.ktur, kabul ? { m: kabul.kabul_turu, renk: /Koşullu/.test(kabul.kabul_turu) ? 'turuncu' : 'yesil' } : null],
    [T.acik, acik.length + red.length ? { m: `${T.var}  ·  ${acik.length + red.length}`, renk: 'sari' } : yok],
    [en ? 'Missing Against Inventory' : 'Envantere Göre Eksik', k.envanter_eksik ? { m: k.envanter_eksik, renk: 'sari' } : yok],
    [en ? 'Recipient’s Reservation' : 'Teslim Alanın Çekincesi', k.cekince ? { m: k.cekince, renk: 'turuncu' } : yok],
    ...(ks ? [[en ? 'Winterisation Responsible' : 'Kışlık Hazırlık Sorumlusu', ks]] : []),
  ] });
  // YG-726: yat sahibinin reddettiği ek işler (ONY-06 onaylı) Açık İşler tablosunda kullanım sınırıyla yer alır.
  const acikSat = [...acik.map((x) => [x.tanim, en ? 'LGM File Manager' : 'LGM Dosya Sorumlusu', gunAy(x.hedef_tarih)]), ...red.map((x) => [`${en ? 'Additional work not carried out' : 'Yapılmayan ek iş'}: ${x.yapilmayan_is} · ${en ? 'Usage limitation' : 'Kullanım sınırı'}: ${x.kullanim_siniri}`, en ? 'Yacht Owner' : 'Yat Sahibi', null])];
  if (acikSat.length) bolumler.push({ baslik: T.acik, tur: 'tablo', sutunlar: [{ ad: T.acik }, { ad: en ? 'Responsible' : 'Sorumlu' }, { ad: T.sor }], satirlar: acikSat }); // YG-725
  bolumler.push(
    { baslik: e.iletisim, tur: 'tablo', sutunlar: [{ ad: e.gorev }, { ad: e.ad }, { ad: e.tel }, { ad: e.eposta }], satirlar: [
      ...taraflar.map((x) => [x.taraf_rolu === 'Kaptan' ? T.kpt : T.sah, x.kisi_adi_soyadi, x.telefon, x.eposta]),
      ...b.ekip.filter((x) => x.rol === 'Dosya Sorumlusu').map((x) => [`LGM ${en ? 'File Manager' : x.rol}`, null, x.cep_telefonu, x.e_posta]), // YG-689
    ] },
    atananEkip(b),
  );
  const yatTuru = (b.d.yat_turu as string | null) ?? '';
  const turTr = / Yat$/.test(yatTuru) ? `${yatTuru.toLocaleLowerCase('tr-TR')}ınızı`.replace(/yatınızı$/, 'yatınızı') : 'yatınızı';
  const kapanis = en
    ? `${acik.length ? 'The open item will be completed by the stated date and you will be informed separately. ' : ''}Once again, we are sorry for the incident and wish you many healthy and happy days enjoying your yacht.`
    : `${acik.length ? 'Açık kalan iş belirtilen tarihe kadar tamamlanacak ve size ayrıca bilgi verilecektir. ' : ''}Tekrar geçmiş olsun dileklerimizi iletir, ${turTr} sağlıklı ve mutlu günlerde, keyifle kullanmanızı dileriz.`;
  return {
    dosyaAdi: `${no}.pdf`, sinif: 'Gizli',
    t: { ad: T.ad, kod: 'FR-OPS-010', no, dosyaNo: b.d.dosya_no, tarih: gunAy(teslim), surum: 'Rev.1', dil, yat: b.d.yat_adi, bolumler,
      matbuSon: [en ? 'The warranty starts on the handover date and runs for 12 months. For an item corrected within the warranty period, the period restarts for 12 months from the date the correction is completed; the new end date is recorded in YATONET 360 and notified to you.' : 'Garanti süresi teslim tarihinde başlar ve 12 aydır. Garanti süresi içinde düzeltilen kalemde süre, düzeltmenin tamamlandığı tarihten itibaren yeniden 12 ay olarak işler; yeni bitiş tarihi YATONET 360’ta kaydedilir ve size bildirilir.', kapanis, sozlesme({ musteri_turu: 'Bireysel' }, dil), dogrula(dil, kod, web), tesekkur(dil)],
      onay: onay ? { rol: T.ko, zaman: anSaat(onay.onay_zamani), kanal: 'YATONET 360', kod: onay.onay_kodu } : undefined } as BelgeTanim,
  };
}

/** YG-624: FR-KLT-010 Garanti Belgesi; metinler onaylı şablondan (ŞABLONLAR\FR-KLT-010, TR/EN). Teslim tutanağının ekidir, ayrıca onay gerektirmez. */
let garantiMetni: Record<Dil, Record<string, any>> | undefined;
export async function garantiTanim(db: Db, id: string) {
  garantiMetni ??= JSON.parse(readFileSync(join(KOK, 'veri', 'sablon', 'garanti_belgesi.json'), 'utf8'));
  const k = (await db.query(`SELECT * FROM teslim_kaydi WHERE kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, k.dosya_ref, ''); const dil = b.dil; const G = garantiMetni![dil]!;
  const no = await altNumara(db, b.d.dosya_no, 'TP');
  const teslim = k.teslim_zamani ?? new Date(); const bitis = new Date(teslim); bitis.setFullYear(bitis.getFullYear() + 1);
  const tt = (await db.query(`SELECT e.ad FROM belge_uretim u JOIN belge e ON e.kimlik = u.belge_ref WHERE u.tur = 'Teslim Tutanağı' AND u.nesne = $1 ORDER BY u.olusturma_zamani DESC LIMIT 1`, [id])).rows[0]?.ad as string | undefined;
  const tutanakNo = tt ? tt.split(' ').pop()! : '---';
  const isler = (await db.query(`SELECT m.aciklama FROM is_emri_kalemi m JOIN is_emri i ON i.kimlik = m.is_emri_ref WHERE i.dosya_ref = $1 AND i.is_emri_turu IN ('ON', 'EK', 'GR', 'AC') AND i.statu NOT IN ('İptal', 'Yerine Geçti', 'Taslak') ORDER BY i.is_emri_no, m.aciklama`, [k.dosya_ref])).rows;
  const onay = (await db.query(`SELECT r.onay_kodu, r.onay_zamani FROM onay_talebi o JOIN yatonet_onay_kaydi r ON r.onay_talebi_ref = o.kimlik WHERE o.dosya_ref = $1 AND o.ony_kod = 'ONY-27' AND r.karar = 'Onaylandı' ORDER BY r.onay_zamani DESC LIMIT 1`, [k.dosya_ref])).rows[0];
  const planli = (await db.query(`SELECT oncelik = 'Planlı' p FROM dosya WHERE kimlik = $1`, [k.dosya_ref])).rows[0]?.p;
  const oneriler = ((k.bakim_onerileri ?? []) as { oneri: string; zaman: string }[]);
  // YG-697: yetkili servisin kimliği yalnız üretici garantisi süren ekipmanda (yetkili servis zorunlu) garanti belgesinde gösterilir.
  const ys = (await db.query(`SELECT d.garantili_ekipman_marka marka, string_agg(DISTINCT f.ticari_unvan, ', ') unvan FROM dosya d JOIN is_emri i ON i.dosya_ref = d.kimlik AND i.statu NOT IN ('İptal', 'Yerine Geçti', 'Taslak') JOIN kurulus f ON f.kimlik = i.kurulus_ref
    JOIN yetkili_servis s ON s.kurulus_ref = f.kimlik AND lower(s.marka) = lower(d.garantili_ekipman_marka) WHERE d.kimlik = $1 AND d.garantili_ekipman AND d.garanti_bitis >= $2::date GROUP BY d.garantili_ekipman_marka`, [k.dosya_ref, teslim])).rows[0];
  const bolumler: Bolum[] = [
    { baslik: G.b1, tur: 'alanlar', alanlar: [{ et: G.yat, deger: b.d.yat_adi }, { et: G.sahip, deger: b.sahip }, { et: G.tutanak, deger: `FR-OPS-010 · ${tutanakNo}` }, { et: G.devir, deger: anSaat(teslim) }, { et: G.sonuc, deger: k.karar },
      ...(ys ? [{ et: dil === 'en' ? 'Manufacturer’s Authorised Service' : 'Üretici Yetkili Servisi', deger: `${ys.unvan} (${ys.marka})` }] : [])] },
    { baslik: G.b2, tur: 'tablo', sutunlar: [{ ad: G.paket, hiza: 'ort' }, { ad: G.kalem }, { ad: G.sure }, { ad: G.bas }, { ad: G.bit }], satirlar: isler.map((x, n) => [n + 1, x.aciklama, G.ay, gunAy(teslim), gunAy(bitis)]) },
    { baslik: G.b2, tur: 'metin', numarasiz: true, metin: G.kural },
    { baslik: G.b3, tur: 'tablo', sutunlar: [{ ad: G.no, hiza: 'ort' }, { ad: G.dis }], satirlar: (G.haller as string[]).map((h, n) => [n + 1, h]) },
    { baslik: G.b4, tur: 'alanlar', alanlar: [{ et: G.kanal, deger: G.kanalD }, { et: G.basvuru, deger: G.basvuruD, genis: true }] },
    { baslik: G.ekler, tur: 'tablo', sutunlar: [{ ad: G.ek }, { ad: G.baslik }, { ad: G.icerik }], satirlar: G.ekListe as string[][] },
    { baslik: G.ek1, tur: 'tablo', numarasiz: true, sutunlar: [{ ad: G.no, hiza: 'ort' }, { ad: G.oneri }, { ad: G.zaman }], satirlar: oneriler.length ? oneriler.map((x, n) => [n + 1, x.oneri, x.zaman]) : [[1, null, null]] },
  ];
  return {
    dosyaAdi: `${no}.pdf`, sinif: 'Gizli',
    t: { ad: G.ad, kod: 'FR-KLT-010', no, dosyaNo: b.d.dosya_no, tarih: gunAy(teslim), surum: 'Rev.1', dil, yat: b.d.yat_adi, bolumler,
      matbuBas: [`${G.konu}. ${String(G.giris).replace('{tarih}', gunAy(teslim)).replace('{tutanak}', tutanakNo)}`],
      matbuSon: [...(planli ? [] : [G.nezaket]), G.tabi],
      onay: onay ? { rol: dil === 'en' ? 'Yacht Owner' : 'Yat Sahibi', zaman: anSaat(onay.onay_zamani), kanal: 'YATONET 360', kod: onay.onay_kodu } : undefined } as BelgeTanim,
  };
}
/** YG-722: FR-OPS-016 İhbar Alındı Bilgilendirmesi; metinler onaylı şablondan (ŞABLONLAR\FR-OPS-016, TR/EN). Şablon sigortalı hasar dosyası içindir.
 *  Dosya Sorumlusunun adı yazılmaz (YG-689); 7/24 Destek Hattı, web ve KVKK bağlantısı satırları şirket iletişim bilgileri belli olunca eklenecek. */
let ihbarMetni: Record<Dil, Record<string, any>> | undefined;
export async function ihbarAlindiTanim(db: Db, dosya: string) {
  ihbarMetni ??= JSON.parse(readFileSync(join(KOK, 'veri', 'sablon', 'ihbar_alindi.json'), 'utf8'));
  const b = await dosyaBilgi(db, dosya, ''); const dil = b.dil; const M = ihbarMetni![dil]!; const d = b.d;
  const bildirim = gunAy(d.bildirim_tarihi);
  const yt = (M.yatTur as Record<string, string>)[d.yat_turu ?? ''] ?? M.yatTur[''];
  const ds = b.ekip.find((x) => x.rol === 'Dosya Sorumlusu');
  // V-481: planlı hizmet/bakım varyantı (geçmiş olsun yok) ve sigortasız hasar varyantı (3. adım onayınıza sunulur).
  const x = (await db.query(`SELECT oncelik, hizmet_turu, musteri_turu, musteri_hedef_tarihi FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  const P = x.oncelik === 'Planlı' || x.hizmet_turu !== 'Hasar onarımı' ? M.planli : null;
  const adimlar = (P ? P.adimlar : (M.adimlar as string[][]).map(([a, h], n) => [n === 2 && x.musteri_turu !== 'Sigorta Şirketi' ? M.adim3Sigortasiz : a, h])) as string[][];
  const bolumler: Bolum[] = [
    P ? { baslik: P.b1, tur: 'alanlar', alanlar: [{ et: M.yat, deger: d.yat_adi }, { et: M.marka, deger: d.marka }, { et: M.model, deger: d.model }, { et: P.hizmet, deger: x.hizmet_turu }, { et: P.hedefT, deger: x.musteri_hedef_tarihi ? gunAy(x.musteri_hedef_tarihi) : null }] }
      : { baslik: M.b1, tur: 'alanlar', alanlar: [{ et: M.yat, deger: d.yat_adi }, { et: M.marka, deger: d.marka }, { et: M.model, deger: d.model }, { et: M.olayT, deger: d.olay_tarihi ? gunAy(d.olay_tarihi) : null }, { et: M.olayTur, deger: null }, { et: M.hasarNo, deger: d.sigorta_hasar_dosya_no }] },
    { baslik: M.b2, tur: 'tablo', sutunlar: [{ ad: M.adim, hiza: 'ort' }, { ad: M.aciklama }, { ad: M.hedef }], satirlar: adimlar.map(([a, h], n) => [n + 1, a, h]) },
    { baslik: M.b3, tur: 'tablo', sutunlar: [{ ad: M.gorev }, { ad: M.tel }, { ad: M.eposta }], satirlar: [[M.ds, ds?.cep_telefonu, ds?.e_posta]] },
    { baslik: M.b3, tur: 'metin', numarasiz: true, metin: M.ekBilgi },
  ];
  return {
    dosyaAdi: `${d.dosya_no}-IHBAR-ALINDI${dil === 'en' ? '-EN' : ''}.pdf`, sinif: 'Gizli',
    t: { ad: P ? P.ad : M.ad, kod: 'FR-OPS-016', no: d.dosya_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil, yat: d.yat_adi, bandEk: [{ et: M.bildirim, deger: bildirim }], bolumler,
      matbuBas: P ? [String(P.hitap).replace('{bildirim}', bildirim).replace('{dosya}', d.dosya_no), `${P.konu} ${String(P.konuD).replace('{bildirim}', bildirim)}`]
        : [String(M.hitap).replace('{bildirim}', bildirim).replace('{dosya}', d.dosya_no), String(M.gecmis).replace('{yat}', yt), `${M.konu} ${String(M.konuD).replace('{bildirim}', bildirim)}`],
      matbuSon: [M.tesekkur] } as BelgeTanim,
  };
}

/** YG-621, YG-1514: FR-MLZ-002 Tedarik Siparişi; tutar yazılmaz, kabul edilen tedarikçi teklifine atıf yapılır; dosya kimliği tedarikçiye görünmez (YG-298); imza bloğu yerine YATONET 360 Onay Kaydı. */
export async function siparisTanim(db: Db, id: string, kod: string, web: string) {
  const s = (await db.query(`SELECT s.*, k.ticari_unvan FROM tedarik_siparisi s JOIN kurulus k ON k.kimlik = s.kurulus_ref WHERE s.kimlik = $1`, [id])).rows[0];
  const kl = (await db.query(`SELECT satir_no, urun_tanimi, uretici_parca_no, miktar, birim FROM tedarik_siparisi_kalemi WHERE siparis_ref = $1 ORDER BY satir_no`, [id])).rows;
  const lgm = (await db.query(`SELECT r.rol_adi, a.zaman FROM is_karti k JOIN is_karti_adim a ON a.is_ref = k.kimlik LEFT JOIN rol r ON r.kimlik = a.rol_ref WHERE k.tur = 'Tedarik Siparişi' AND k.nesne_kimligi = $1 AND a.karar = 'Onayla' ORDER BY a.zaman DESC LIMIT 1`, [id])).rows[0];
  const dil: Dil = dilZorla.getStore() ?? (s.dil === 'İngilizce' ? 'en' : 'tr'); const en = dil === 'en';
  const L = en ? { ad: 'Purchase Order', sip: 'Order', ted: 'Supplier', day: 'Reference Quotation', kis: 'Partial Delivery', izin: 'Permitted', izinYok: 'Not permitted', ter: 'Lead Time', uzun: 'Long lead time', kal: 'Items', sira: 'No', urun: 'Product Description', parca: 'Manufacturer Part No', mik: 'Quantity', bir: 'Unit', tes: 'Delivery', tt: 'Delivery Date', ty: 'Delivery Address', nk: 'End-Use Location', olc: 'Acceptance Criteria', bd: 'Price Basis', bdD: `Accepted supplier quotation ${s.tedarikci_teklif_ref}  ·  this order contains no prices` }
    : { ad: 'Tedarik Siparişi', sip: 'Sipariş', ted: 'Tedarikçi', day: 'Dayanak Teklif', kis: 'Kısmi Teslim', izin: 'İzinli', izinYok: 'İzinli değil', ter: 'Termin', uzun: 'Uzun terminli', kal: 'Kalemler', sira: 'Sıra', urun: 'Ürün Tanımı', parca: 'Üretici Parça No', mik: 'Miktar', bir: 'Birim', tes: 'Teslim', tt: 'Teslim Tarihi', ty: 'Teslim Yeri', nk: 'Nihai Kullanım Yeri', olc: 'Kabul Ölçütü', bd: 'Bedel Dayanağı', bdD: `Kabul edilen tedarikçi teklifi ${s.tedarikci_teklif_ref}  ·  sipariş fiyat içermez` };
  const bolumler: Bolum[] = [
    { baslik: L.sip, tur: 'alanlar', alanlar: [{ et: L.ted, deger: s.ticari_unvan }, { et: L.day, deger: s.tedarikci_teklif_ref }, { et: L.kis, deger: s.kismi_teslim_izni ? L.izin : L.izinYok }, { et: L.ter, deger: s.uzun_terminli ? L.uzun : null }] },
    { baslik: L.kal, tur: 'tablo', sutunlar: [{ ad: L.sira, hiza: 'ort' }, { ad: L.urun }, { ad: L.parca }, { ad: L.mik, hiza: 'sag' }, { ad: L.bir, hiza: 'ort' }],
      satirlar: kl.map((x) => [x.satir_no, x.urun_tanimi, x.uretici_parca_no, en ? String(Number(x.miktar)) : String(Number(x.miktar)).replace('.', ','), x.birim]) },
    { baslik: L.tes, tur: 'alanlar', alanlar: [{ et: L.tt, deger: gunAy(s.teslim_tarihi) }, { et: L.ty, deger: s.teslim_yeri, genis: true }, { et: L.nk, deger: s.nihai_kullanim_yeri, genis: true }] },
    { baslik: L.olc, tur: 'metin', metin: s.kabul_olcutu },
    { baslik: L.bd, tur: 'alanlar', alanlar: [{ et: L.bd, deger: L.bdD, genis: true }] },
  ];
  return {
    dosyaAdi: `${s.siparis_no}${en ? '-EN' : ''}.pdf`, sinif: 'Gizli',
    t: { ad: L.ad, kod: 'FR-MLZ-002', no: s.siparis_no, tarih: gunAy(lgm?.zaman ?? s.olusturma_zamani), surum: `Rev.${s.surum_no}`, dil, bolumler,
      matbuSon: [gizli(dil), dogrula(dil, kod, web)],
      onay: lgm ? { rol: en ? ROL_EN[lgm.rol_adi] ?? lgm.rol_adi : lgm.rol_adi, zaman: anSaat(lgm.zaman), kanal: 'YATONET 360', kod } : undefined } as BelgeTanim,
  };
}

/** YG-656: FR-UYG-003 Değişiklik Kaydı iç belgedir; yat sahibi/sigortaya ONY-05 Değişiklik Onayı, firmaya Ek İş Emri gider. */
export async function degisiklikKaydiTanim(db: Db, id: string) {
  const p = (await db.query(`SELECT p.*, h.ad_soyad hazirlayan, (SELECT f.teklif_no || ' Rev.' || f.surum_no FROM fiyat_teklifi f WHERE f.dosya_ref = p.dosya_ref AND f.statu = 'Onaylı' AND f.teklif_muhatabi <> 'Firma' ORDER BY f.olusturma_zamani DESC LIMIT 1) dayanak FROM degisiklik_protokolu p LEFT JOIN kullanici_hesabi h ON h.kimlik = p.hazirlayan_ref WHERE p.kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, p.dosya_ref, '');
  const bolumler: Bolum[] = [
    { baslik: 'Değişiklik', tur: 'alanlar', alanlar: [{ et: 'Değişiklik No', deger: p.degisiklik_no }, { et: 'Dayanak Teklif', deger: p.dayanak }, { et: 'Tür', deger: p.tur }, { et: 'Durum', deger: p.durum }, { et: 'Onay Kanalı', deger: p.kanal }, { et: 'Sigorta Onayı', deger: p.sigorta_onayi }] },
    { baslik: 'Mevcut Kapsam', tur: 'metin', metin: p.mevcut },
    { baslik: 'Önerilen Kapsam', tur: 'metin', metin: p.onerilen },
    { baslik: 'Etki', tur: 'alanlar', alanlar: [{ et: 'Bedel Farkı (EUR)', deger: tutar(Number(p.bedel_farki_eur), 'tr') }, { et: 'Yeni Toplam (EUR)', deger: p.yeni_toplam_eur === null ? null : tutar(Number(p.yeni_toplam_eur), 'tr') }, { et: 'Ek Süre', deger: `${p.ek_sure_gun} gün` }] },
  ];
  return { dosyaAdi: `${p.degisiklik_no}.pdf`, sinif: 'Gizli', t: { ad: 'Değişiklik Kaydı', kod: 'FR-UYG-003', no: p.degisiklik_no, dosyaNo: b.d.dosya_no, tarih: gunAy(p.olusturma_zamani), surum: 'Rev.1', dil: 'tr' as Dil, yat: b.d.yat_adi, icKayit: true, bolumler } as BelgeTanim };
}

/** YG-715: FR-OPS-009 iç kayıt; dışarıya gönderilmez. */
export async function hasarIhbarTanim(db: Db, dosya: string) {
  const t = (await db.query(`SELECT t.* FROM talep t JOIN dosya d ON d.talep_ref = t.kimlik WHERE d.kimlik = $1`, [dosya])).rows[0];
  const b = await dosyaBilgi(db, dosya, '');
  const bolumler: Bolum[] = [...ortak(b), { baslik: 'İhbar Bilgileri', tur: 'alanlar', alanlar: [{ et: 'Kanal', deger: t.bildirim_kanali }, { et: 'Talep Sahibi', deger: t.talep_sahibi_adi }, { et: 'Talep Sahibi Türü', deger: t.talep_sahibi_turu }, { et: 'Telefon', deger: t.talep_sahibi_telefon }, { et: 'E-Posta', deger: t.talep_sahibi_eposta }, { et: 'Yetki Durumu', deger: t.ihbar_yetki_durumu }, { et: 'Olay Tarihi', deger: t.olay_tarihi ? gunAy(t.olay_tarihi) : null }, { et: 'Olay Yeri', deger: t.olay_yeri }, { et: 'Yatın Mevcut Konumu', deger: t.yat_mevcut_konumu }, { et: 'Yatın Durumu', deger: t.yat_mevcut_durumu }, { et: 'Öncelik', deger: t.oncelik }, { et: 'İhtiyaç', deger: t.ihtiyac_tanimi, genis: true }] }, { baslik: 'Özgün Bildirim', tur: 'metin', metin: t.ozgun_bildirim ?? '---' }];
  // YG-684: risk/acil durum soruları renkli yanıtla (Hayır yeşil, Bilinmiyor sarı, Kısmen turuncu, Evet kırmızı; sorular evet = risk).
  const RR: Record<string, Renk> = { Hayır: 'yesil', Bilinmiyor: 'sari', Kısmen: 'turuncu', Evet: 'kirmizi' };
  const oc = Object.entries((t.oncelik_cevaplari ?? {}) as Record<string, string>);
  if (oc.length) bolumler.push({ baslik: 'Acil Durum ve Risk Soruları', tur: 'tablo', sutunlar: [{ ad: 'Soru' }, { ad: 'Yanıt', hiza: 'ort' }], satirlar: oc.map(([s, c]) => [s, RR[c] ? { m: c, renk: RR[c]! } : c]) });
  // YG-719, YG-671: iletişim kişileri sütun çizgili tabloda dört rolle; kayıt yoksa satır "---" ile kalır; eksper "Sigorta Eksperi" adıyla.
  const tr = (await db.query(`SELECT taraf_rolu, kisi_adi_soyadi, telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif AND taraf_rolu IN ('Yat Sahibi', 'Kaptan', 'Sigorta Şirketi', 'Eksper') ORDER BY olusturma_zamani`, [dosya])).rows;
  const ROLLER: [string, string][] = [['Yat Sahibi', 'Yat Sahibi'], ['Kaptan', 'Yatın Kaptanı'], ['Sigorta Şirketi', 'Sigorta Hasar Yetkilisi'], ['Eksper', 'Sigorta Eksperi']];
  bolumler.push({ baslik: 'İletişim Kişileri', tur: 'tablo', sutunlar: [{ ad: 'Görev' }, { ad: 'Ad Soyad' }, { ad: 'Telefon' }, { ad: 'E-Posta' }],
    satirlar: ROLLER.map(([r, ad]) => { const x = tr.find((y) => y.taraf_rolu === r); return [ad, x?.kisi_adi_soyadi, x?.telefon, x?.eposta]; }) });
  return { dosyaAdi: `${t.talep_no}-IHBAR.pdf`, sinif: 'Gizli', t: { ad: 'Hasar İhbarı ve İlk Kayıt', kod: 'FR-OPS-009', no: t.talep_no, dosyaNo: b.d.dosya_no, tarih: gunAy(t.olusturma_zamani), surum: 'Rev.1', dil: 'tr' as Dil, yat: b.d.yat_adi, icKayit: true, bandEk: [{ et: 'Bildirim Zamanı', deger: anSaat(t.bildirim_alinma_zamani) }, { et: 'Kayıt Zamanı', deger: anSaat(t.kayda_gecis_zamani ?? t.olusturma_zamani) }], bolumler } as BelgeTanim };
}

/** YG-644: FR-OPS-013; sözleşme Ek-2'deki 27 satır aynı sırayla. */
export async function kurtarmaSonucTanim(db: Db, id: string) {
  const k = (await db.query(`SELECT o.dosya_ref, s.veriler, s.kontrol_zamani FROM kurtarma_operasyonu o JOIN kurtarma_sonuc s ON s.operasyon_ref = o.kimlik WHERE o.kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, k.dosya_ref, ''); const no = await altNumara(db, b.d.dosya_no, 'KS');
  const v = k.veriler as Record<string, string>;
  return { dosyaAdi: `${no}.pdf`, sinif: 'Gizli', t: { ad: 'Kurtarma, Çekme ve Dalış Operasyon Sonuç Tutanağı', kod: 'FR-OPS-013', no, dosyaNo: b.d.dosya_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil: 'tr' as Dil, yat: b.d.yat_adi, bolumler: [{ baslik: 'Operasyon Sonuç, Olay ve Teslim Kaydı', tur: 'tablo', sutunlar: [{ ad: 'Alan' }, { ad: 'Bilgi / Kayıt' }], satirlar: Object.entries(v).map(([a, d]) => [a, d]) }] as Bolum[], onay: k.kontrol_zamani ? { rol: 'Dosya Sorumlusu', zaman: anSaat(k.kontrol_zamani), kanal: 'YATONET 360' } : undefined } as BelgeTanim };
}

/** YG-651: RP-OPS-001 iç rapor; risk taraması renklidir (YG-684). */
export async function onDegerlendirmeTanim(db: Db, id: string) {
  const r = (await db.query(`SELECT * FROM on_degerlendirme WHERE kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, r.dosya_ref, ''); const v = r.veriler as Record<string, string>; const RENK: Record<string, Renk> = { Hayır: 'yesil', Bilinmiyor: 'sari', Kısmen: 'turuncu', Evet: 'kirmizi' };
  const no = `${b.d.dosya_no}-OD${String(r.surum).padStart(2, '0')}`;
  const M = (baslik: string, metin: string | undefined): Bolum[] => (metin ? [{ baslik, tur: 'metin', metin }] : []);
  const bolumler: Bolum[] = [...ortak(b), atananEkip(b), ...M('Görevlendirme Kapsamı ve Karar Sınırı', v.kapsam), ...M('Olay Özeti ve Kronoloji', v.kronoloji), ...M('İncelenen Kaynaklar', v.kaynaklar), ...M('Doğrulanmış Olgular', v.olgular), ...M('Beyanlar, Gözlemler ve Varsayımlar', v.beyanlar),
    { baslik: 'Risk Taraması', tur: 'tablo', sutunlar: [{ ad: 'Risk' }, { ad: 'Durum', hiza: 'ort' }], satirlar: Object.entries(r.risk as Record<string, string>).map(([k, d]) => [k, { m: d, renk: RENK[d]! }]) },
    { baslik: 'Bilgi Yeterliliği', tur: 'alanlar', alanlar: [{ et: 'Esas Alınan Son Bilgi Tarihi', deger: gunAy(v.sonBilgi!) }, { et: 'Bilgi Yeterliliği', deger: v.yeterlilik }, { et: 'Gerekli Uzmanlıklar', deger: v.uzmanliklar }, { et: 'Gerekçe ve Eksik Listesi', deger: v.yeterlilikGerekcesi, genis: true }] },
    { baslik: 'Ön Değerlendirme Sonucu', tur: 'alanlar', alanlar: [{ et: 'Sonuç', deger: v.sonuc, genis: true }, { et: 'Yöntem Kararı', deger: v.yontem }, { et: 'Öncelik Teyidi', deger: v.oncelikTeyidi }, { et: 'Etkilenen Sistemler', deger: v.etkilenen }, { et: 'Yöntem Gerekçesi', deger: v.yontemGerekcesi, genis: true }] },
    ...M('Sonraki Adım', v.sonrakiAdim), ...M('Açık Konular', v.acikKonular)];
  return { dosyaAdi: `${no}.pdf`, sinif: 'Gizli', t: { ad: 'Ön Değerlendirme Raporu', kod: 'RP-OPS-001', no, dosyaNo: b.d.dosya_no, tarih: gunAy(r.olusturma_zamani), surum: `Rev.${r.surum}`, dil: 'tr' as Dil, yat: b.d.yat_adi, icKayit: true, rapor: true, bolumler } as BelgeTanim };
}

/** YG-1541: RP-RAP-004 Nihai Kapanış Özeti; kayıtlardan üretilir, Çözüm Ortağı kimliği taşımaz. */
export async function kapanisOzetiTanim(db: Db, dosya: string) {
  const b = await dosyaBilgi(db, dosya, ''); const dil = b.dil; const en = dil === 'en';
  const o = (await db.query(`SELECT onay_zamani FROM nihai_kapanis_ozeti WHERE dosya_ref = $1 AND durum = 'Onaylandı'`, [dosya])).rows[0];
  const k = (await db.query(`SELECT cikis_statusu, kapanma_nedeni, kapanis_zamani FROM kapanis_kontrolu WHERE dosya_ref = $1 AND durum = 'Onaylandı' ORDER BY kapanis_zamani DESC LIMIT 1`, [dosya])).rows[0];
  const no = await altNumara(db, b.d.dosya_no, 'NK');
  const isler = (await db.query(`SELECT m.aciklama, (SELECT kabul_turu FROM kabul_kaydi x WHERE x.is_emri_ref = i.kimlik ORDER BY x.olusturma_zamani DESC LIMIT 1) AS kabul FROM is_emri_kalemi m JOIN is_emri i ON i.kimlik = m.is_emri_ref WHERE i.dosya_ref = $1 ORDER BY m.aciklama`, [dosya])).rows;
  const testler = (await db.query(`SELECT test_grubu, sonuc FROM test_kaydi WHERE dosya_ref = $1 AND sonuc IS NOT NULL ORDER BY test_no`, [dosya])).rows;
  const acik = (await db.query(`SELECT a.tanim, a.hedef_tarih FROM acik_is_kalemi a JOIN kabul_kaydi x ON x.kimlik = a.kabul_ref WHERE x.dosya_ref = $1 AND a.kapanis_zamani IS NULL ORDER BY a.hedef_tarih`, [dosya])).rows;
  const T = en ? { ad: 'Final Closing Summary', kap: 'Closing Control', st: 'Closing Status', ned: 'Closing Reason', zam: 'Closing Date', haz: 'Prepared By', kon: 'Checked By', uyg: 'Implementation', is: 'Work Item', kab: 'Acceptance', dog: 'Verification', tg: 'Test', sn: 'Result', acik: 'Open Obligations', hed: 'Target Date', r1: 'File Manager', r2: 'Operations Officer', r3: 'Deputy Operations Manager' } : { ad: 'Nihai Kapanış Özeti', kap: 'Kapanış Kontrolü', st: 'Kapanış Statüsü', ned: 'Kapanma Nedeni', zam: 'Kapanış Tarihi', haz: 'Hazırlayan', kon: 'Kontrol Eden', uyg: 'Uygulama', is: 'İş Kalemi', kab: 'Kabul', dog: 'Doğrulama', tg: 'Test', sn: 'Sonuç', acik: 'Açık Yükümlülük', hed: 'Hedef Tarih', r1: 'Dosya Sorumlusu', r2: 'Operasyon Yöneticisi', r3: 'Operasyon Müdür Yardımcısı' };
  const bolumler: Bolum[] = [...ortak(b), { baslik: T.kap, tur: 'alanlar', alanlar: [{ et: T.st, deger: k?.cikis_statusu }, { et: T.ned, deger: k?.kapanma_nedeni }, { et: T.zam, deger: k?.kapanis_zamani ? gunAy(k.kapanis_zamani) : null }, { et: T.haz, deger: T.r1 }, { et: T.kon, deger: T.r2 }] }];
  if (isler.length) bolumler.push({ baslik: T.uyg, tur: 'tablo', sutunlar: [{ ad: T.is }, { ad: T.kab }], satirlar: isler.map((x) => [x.aciklama, x.kabul]) });
  if (testler.length) bolumler.push({ baslik: T.dog, tur: 'tablo', sutunlar: [{ ad: T.tg }, { ad: T.sn }], satirlar: testler.map((x) => [x.test_grubu, x.sonuc]) });
  if (acik.length) bolumler.push({ baslik: T.acik, tur: 'tablo', sutunlar: [{ ad: T.acik }, { ad: T.hed }], satirlar: acik.map((x) => [x.tanim, gunAy(x.hedef_tarih)]) });
  return { dosyaAdi: `${no}.pdf`, sinif: 'Gizli', t: { ad: T.ad, kod: 'RP-RAP-004', no, dosyaNo: b.d.dosya_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil, yat: b.d.yat_adi, bolumler, onay: o ? { rol: T.r3, zaman: anSaat(o.onay_zamani), kanal: 'YATONET 360' } : undefined } as BelgeTanim };
}

/** YG-1569, K-237: FR-TIC-009 dış nüshası Sigorta Onay Belgesi; onaylanan ve onaylanmayan kalemler teklif sıra numarasıyla ayrı tablolarda. */
export async function sigortaOnayTanim(db: Db, id: string, kod: string, web: string) {
  const s = (await db.query(`SELECT s.*, f.teklif_no, f.surum_no, f.kdv_orani, f.genel_toplam_eur, f.dosya_ref FROM sigorta_onayi s JOIN fiyat_teklifi f ON f.kimlik = s.teklif_ref WHERE s.kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, s.dosya_ref, ''); const dil = b.dil; const en = dil === 'en'; const e = E[dil];
  const kl = (await db.query(`SELECT sira_no, kartela_kodu, aciklama, isin_niteligi, tutar_eur, onay_durumu FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [s.teklif_ref])).rows;
  const no = await altNumara(db, b.d.dosya_no, 'SO'); const oran = Number(s.kdv_orani);
  const R = (x: number) => Math.round(x * 100) / 100;
  const T = en ? { ad: 'Insurance Approval', bilgi: 'Information', ozet: 'Summary', belge: 'Approved Document', toplam: 'Quotation Total (VAT Incl.)', on: 'Approved (VAT Incl.)', onm: 'Not Approved (VAT Incl.)', onT: 'Approved Items', onmT: 'Items Not Approved', onTop: 'Approved Total (EUR)', onmTop: 'Not Approved Total (EUR)', kayit: 'Approval Record', kim: 'Approved By', yon: 'Method', zam: 'Date-Time', sur: 'Approved Document Version', say: 'Selected Items', ft: 'Quotation' } : { ad: 'Sigorta Onayı', bilgi: 'Bilgilendirme', ozet: 'Özet', belge: 'Onaylanan Belge', toplam: 'Teklif Toplamı (KDV Dahil)', on: 'Onaylanan (KDV Dahil)', onm: 'Onaylanmayan (KDV Dahil)', onT: 'Onaylanan Kalemler', onmT: 'Onaylanmayan Kalemler', onTop: 'Onaylanan Toplam (EUR)', onmTop: 'Onaylanmayan Toplam (EUR)', kayit: 'Onay Kaydı', kim: 'Onaylayan', yon: 'Yöntem', zam: 'Tarih-Saat', sur: 'Onaylanan Belge Sürümü', say: 'Seçilen Kalem Sayısı', ft: 'Fiyat Teklifi' };
  const ytn = s.onay_kanali === 'YATONET 360';
  const bilgi = en
    ? `Your approval of Quotation No. ${s.teklif_no} has been ${ytn ? 'received on the YATONET 360 approval screen' : `received via ${s.onay_kanali}`} and recorded with the details below. Approved and non-approved items are shown separately.`
    : `${s.teklif_no} numaralı Fiyat Teklifine ilişkin onayınız ${ytn ? 'YATONET 360 onay ekranında alınmış' : `${s.onay_kanali} ile alınmış`} ve aşağıdaki bilgilerle kayda geçirilmiştir. Onaylanan ve onaylanmayan kalemler ayrı ayrı gösterilmiştir.`;
  const grup = (ok: boolean) => kl.filter((k) => (k.onay_durumu === 'Onaylandı') === ok);
  const top = (l: typeof kl) => { const ara = R(l.reduce((a, k) => a + Number(k.tutar_eur), 0)); const kdv = R(ara * oran / 100); return { ara, kdv, genel: R(ara + kdv) }; };
  const tablo = (baslik: string, l: typeof kl, son: string): Bolum => { const t = top(l); return { baslik, tur: 'tablo', sutunlar: [{ ad: e.sira, hiza: 'ort' }, { ad: e.kod }, { ad: e.aciklama }, { ad: e.nitelik }, { ad: e.tutar, hiza: 'sag' }], satirlar: l.map((k) => [k.sira_no, k.kartela_kodu, k.aciklama, k.isin_niteligi, para(k.tutar_eur, dil)]), toplamlar: [{ et: e.ara, deger: para(t.ara, dil) }, { et: `${e.kdv} %${oran}`, deger: para(t.kdv, dil) }, { et: son, deger: para(t.genel, dil), ana: true }] }; };
  const on = grup(true); const onm = grup(false); const a = top(on); const m = top(onm);
  const bolumler: Bolum[] = [
    { baslik: T.bilgi, tur: 'metin', metin: bilgi },
    ...ortak(b).slice(0, 2),
    { baslik: T.ozet, tur: 'alanlar', alanlar: [{ et: T.belge, deger: `${T.ft} · ${s.teklif_no} · Rev.${s.surum_no}`, genis: true }, { et: T.toplam, deger: `${para(R(a.genel + m.genel), dil)} EUR` }, { et: T.on, deger: `${para(a.genel, dil)} EUR` }, { et: T.onm, deger: `${para(m.genel, dil)} EUR` }] },
  ];
  // YG-639: LGM'ye ödenecek tutar (sigortanın onayladığı) ve yat sahibine ayrı sipariş olarak sunulan kalemler ayrıca yazılır.
  bolumler.push({ baslik: en ? 'Payment Breakdown' : 'Ödeme Dağılımı', tur: 'alanlar', alanlar: [{ et: en ? 'Payable to LGM by the Insurer (VAT Incl.)' : 'Sigortaca LGM’ye Ödenecek Tutar (KDV Dahil)', deger: `${para(a.genel, dil)} EUR` }, { et: en ? 'Claim File No' : 'Hasar Dosya No', deger: b.d.sigorta_hasar_dosya_no },
    { et: en ? 'Offered to the Yacht Owner as a Separate Order' : 'Yat Sahibine Ayrı Sipariş Olarak Sunulan', deger: onm.length ? `${onm.length} ${en ? 'item(s)' : 'kalem'} · ${para(m.genel, dil)} EUR` : (en ? 'None' : 'Yok') }] });
  if (on.length) bolumler.push(tablo(T.onT, on, T.onTop));
  if (onm.length) bolumler.push(tablo(T.onmT, onm, T.onmTop));
  bolumler.push({ baslik: T.kayit, tur: 'alanlar', alanlar: [{ et: T.kim, deger: [s.onaylayan_yetkili, b.d.sigortaci_adi].filter(Boolean).join(' · ') }, { et: T.yon, deger: ytn ? (en ? 'YATONET 360 approval screen · two-factor authenticated session' : 'YATONET 360 onay ekranı · iki aşamalı doğrulamalı oturum') : s.onay_kanali }, { et: T.zam, deger: anSaat(s.onay_tarihi) }, { et: T.sur, deger: `${s.teklif_no} · Rev.${s.surum_no}` }, { et: T.say, deger: `${on.length} / ${kl.length}` }] }, ekipBolumu(b));
  return { dosyaAdi: `${no}.pdf`, sinif: 'Gizli', t: { ad: T.ad, kod: 'FR-TIC-009', no, dosyaNo: b.d.dosya_no, tarih: gunAy(s.onay_tarihi), surum: 'Rev.1', dil, yat: b.d.yat_adi, bolumler, matbuSon: [dogrula(dil, kod, web)] } as BelgeTanim };
}

/** Tam veya kısmi sigorta onayından hemen sonra belge kuyruğa girer. */
export async function sigortaOnayBelgesiUret(c: Db, teklif: string): Promise<void> {
  const s = (await c.query(`SELECT kimlik, dosya_ref FROM sigorta_onayi WHERE teklif_ref = $1 AND karar IN ('Tam Onay', 'Kısmi Onay') ORDER BY onay_tarihi DESC LIMIT 1`, [teklif])).rows[0];
  if (s) await belgeUret(c, { tur: 'Sigorta Onay Belgesi', nesne: s.kimlik, dosya: s.dosya_ref });
}

/** CEO 09.11: kaşe basılan belgeler; sözleşmeler ve karşı tarafın beyan/onay belgeleri dışarıda. */
/** YG-610: üretilen belgenin alt bilgisinde gizlilik sınıfı ve dosya referansı. */
export function gizlilikIsareti(sinif: string, dosyaNo: string | undefined, dil: Dil): string {
  const EN: Record<string, string> = { Gizli: 'Confidential', Kritik: 'Strictly Confidential', Kurumsal: 'Internal', Genel: 'Public' };
  return dil === 'en' ? `Classification: ${EN[sinif] ?? sinif}${dosyaNo ? ` · File No: ${dosyaNo}` : ''}` : `Gizlilik: ${sinif}${dosyaNo ? ` · Dosya No: ${dosyaNo}` : ''}`;
}
const KASELI = ['Garanti Belgesi', 'Fiyat Teklifi', 'Teknik Rapor', 'Proforma', 'Ödeme Talebi', 'İş Emri', 'Teslim Tutanağı', 'Mutabakat Raporu', 'Yöntem Bilgi Nüshası', 'Nihai Kapanış Özeti', 'Kurtarma Sonuç Tutanağı'];

/** Kuyruktaki belgeleri üretir, dosyaya resmî sürüm olarak bağlar, ekiyle gönderir. Hata üç denemeden sonra Dosya Sorumlusuna düşer. */
/** Kuyruk kaydının belge tanımı. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tanimYap(c: PoolClient, u: any, kod: string, web: string) {
  return u.tur === 'Garanti Şikâyet Yanıtı' ? await (await import('./garanti_yanit.js')).garantiYanitTanim(c, u.nesne) : u.tur === 'İhbar Alındı' ? await ihbarAlindiTanim(c, u.nesne) : u.tur === 'Tedarik Siparişi' ? await siparisTanim(c, u.nesne, kod, web) : u.tur === 'Değişiklik Kaydı' ? await degisiklikKaydiTanim(c, u.nesne) : u.tur === 'Garanti Belgesi' ? await garantiTanim(c, u.nesne) : u.tur === 'Sigorta Onay Belgesi' ? await sigortaOnayTanim(c, u.nesne, kod, web) : u.tur === 'Hasar İhbar ve İlk Kayıt' ? await hasarIhbarTanim(c, u.nesne) : u.tur === 'Kurtarma Sonuç Tutanağı' ? await kurtarmaSonucTanim(c, u.nesne) : u.tur === 'Ön Değerlendirme Raporu' ? await onDegerlendirmeTanim(c, u.nesne) : u.tur === 'Nihai Kapanış Özeti' ? await kapanisOzetiTanim(c, u.nesne) : u.tur === 'Yöntem Bilgi Nüshası' ? await yontemBilgiTanim(c, u.nesne) : u.tur === 'Fiyat Teklifi' ? await teklifTanim(c, u.nesne, kod, web) : u.tur === 'Teknik Rapor' ? await raporTanim(c, u.nesne, kod, web) : u.tur === 'Onay Belgesi' ? await onayTanim(c, u.nesne, kod, web) : u.tur === 'İş Emri' ? await isEmriTanim(c, u.nesne, kod, web) : u.tur === 'Teslim Tutanağı' ? await tutanakTanim(c, u.nesne, kod, web) : u.tur === 'Ödeme Sorumluluğu' ? await sorumlulukTanim(c, u.nesne, kod, web) : u.tur === 'Uyuşmazlık Paketi' ? await uyusmazlikTanim(c, u.nesne, kod) : u.tur === 'Mutabakat Raporu' ? await mutabakatTanim(c, u.nesne) : u.tur === 'Kurtarma Sözleşmesi' ? await (await import('./kalan.js')).kurtarmaTanim(c, u.nesne, kod) : u.tur === 'Ön Bilgilendirme Formu' ? await (await import('./kalan.js')).onBilgiTanim(c, u.nesne, kod) : await odemeTanim(c, u.tur, u.nesne, kod, web);
}
/** YG-625: iki dilli üretilen müşteri belgeleri ve "Türkçe metin esastır" satırı (kurtarma sözleşmesi 11.4'ün belgeye uyarlaması). */
const IKI_DILLI = ['Tedarik Siparişi', 'İhbar Alındı', 'Garanti Belgesi', 'Fiyat Teklifi', 'Teknik Rapor', 'Teslim Tutanağı', 'Onay Belgesi', 'Ödeme Sorumluluğu', 'Nihai Kapanış Özeti', 'Proforma', 'Ödeme Talebi', 'Kurtarma Sonuç Tutanağı', 'Ön Bilgilendirme Formu'];
export const TURKCE_ESAS = { tr: 'Bu belgenin İngilizce sürümü bilgi amaçlıdır; metinler arasında farklılık olması hâlinde Türkçe metin esas alınır.', en: 'The English version of this document is for information only; in case of any discrepancy between the texts, the Turkish text shall prevail.' };
/** Belgeyi üretir, dosyaya resmî sürüm olarak bağlar. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uretKaydet(c: PoolClient, depo: Depo, u: any, v: { t: BelgeTanim | any; dosyaAdi: string; sinif: string }, kod: string, turkceEk: boolean) {
  const tt = v.t as BelgeTanim;
  if (IKI_DILLI.includes(u.tur) && (tt.dil === 'en' || turkceEk)) tt.matbuSon = [...(tt.matbuSon ?? []), TURKCE_ESAS[tt.dil]];
    { const me = await (await import('./yetki_ek.js')).belgeMaskeEngeli(c, u.tur, u.dosya_ref, JSON.stringify(v.t)); if (me) throw new Error(me); }
    { const tt = v.t as BelgeTanim; tt.isaret ??= gizlilikIsareti(v.sinif, tt.dosyaNo, tt.dil); } // YG-610
    const pdf = await pdfUret(KASELI.includes(u.tur) ? { ...v.t, kase: true } : v.t);
    const al = await depo.al(Readable.from(pdf), pdf.length + 1);
    const anahtar = depo.yerlestir(al.yol, al.ozet);
    const sahip = (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [u.dosya_ref])).rows[0].r;
    const ad = `${v.t.ad} ${v.t.no}`;
    const eski = (await c.query(`SELECT kimlik, (SELECT max(surum_no) FROM belge_surum s WHERE s.belge_ref = e.kimlik) n FROM belge e WHERE bag_turu = 'Dosya' AND bag_kimligi = $1 AND ad = $2`, [u.dosya_ref, ad])).rows[0];
    const be = eski?.kimlik ?? (await c.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,$2,$3,'Dosya',$4,'Sistem',(now() AT TIME ZONE 'Europe/Istanbul')::date,$5) RETURNING kimlik`, [ad, u.tur, v.sinif, u.dosya_ref, sahip])).rows[0].kimlik;
    const sur = Number(eski?.n ?? 0) + 1;
    if (eski) await c.query(`UPDATE belge_surum SET durum = 'Yerine Geçti' WHERE belge_ref = $1 AND durum = 'Yürürlükte'`, [be]);
    const s = (await c.query(`INSERT INTO belge_surum (belge_ref, surum_no, dosya_adi, uzanti, boyut, ozet_sha256, depo_anahtari, tarama_kaynagi, degisiklik_gerekcesi, yukleyen_ref, durum, dogrulama_kodu, onay_zamani) VALUES ($1,$2,$3,'pdf',$4,$5,$6,'Sistem',$7,$8,'Yürürlükte',$9,now()) RETURNING kimlik`, [be, sur, v.dosyaAdi, al.boyut, al.ozet, anahtar, sur > 1 ? 'Yeniden üretildi' : null, sahip, kod])).rows[0];
  return { kimlik: s.kimlik as string, belge: be as string };
}

export async function belgeKuyruguIsle(b: Baglam, limit = 10): Promise<number> {
  const depo = b.depo ?? new Depo(); let n = 0; aktifDepo = depo;
  const { rows } = await b.db.query(`SELECT * FROM belge_uretim WHERE durum = 'Bekliyor' ORDER BY olusturma_zamani LIMIT $1`, [limit]);
  for (const u of rows) {
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const kod = dogrulamaKodu();
      const v = await tanimYap(c, u, kod, b.webAdresi);
      const s = await uretKaydet(c, depo, u, v, kod, false);
      // YG-625: yabancı yat sahibine giden belgenin Türkçe sürümü de üretilir ve birlikte gönderilir; Türkçe metin esastır.
      let trSurum: string | null = null;
      if ((v.t as BelgeTanim).dil === 'en' && IKI_DILLI.includes(u.tur)) { const kod2 = dogrulamaKodu(); const vt = await dilZorla.run('tr', () => tanimYap(c, u, kod2, b.webAdresi)); trSurum = (await uretKaydet(c, depo, u, vt, kod2, true)).kimlik; }
      await c.query(`UPDATE belge_uretim SET durum = 'Üretildi', belge_ref = $2, surum_ref = $3, son_hata = NULL WHERE kimlik = $1`, [u.kimlik, s.belge, s.kimlik]);
      if (u.gonder) {
        const g = u.gonder as Gonderim; const ek: string[] = trSurum ? [s.kimlik, trSurum] : [s.kimlik];
        for (const t of g.ekle ?? []) { const x = (await c.query(`SELECT surum_ref FROM belge_uretim WHERE dosya_ref = $1 AND tur = $2 AND durum = 'Üretildi' ORDER BY olusturma_zamani DESC LIMIT 1`, [u.dosya_ref, t])).rows[0]; if (x?.surum_ref) ek.push(x.surum_ref); }
        if (u.tur === 'Onay Belgesi') { const x = (await c.query(`SELECT belge_surum_ref r FROM onay_talebi WHERE kimlik = $1`, [u.nesne])).rows[0]?.r; if (x && !ek.includes(x)) ek.push(x); }
        await disGonder(c, { olay: g.olay, eposta: g.eposta, konu: g.konu, metin: g.metin, acil: g.acil, sigortaTeyitli: g.sigortaTeyitli, ekler: ek });
      }
      await c.query('COMMIT'); n++;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      const d = u.deneme + 1; const durum = d >= 3 ? 'Başarısız' : 'Bekliyor'; const hata = (e as Error).message.slice(0, 200);
      await b.db.query(`UPDATE belge_uretim SET deneme = $2, durum = $3, son_hata = $4 WHERE kimlik = $1`, [u.kimlik, d, durum, hata]);
      if (durum === 'Başarısız') {
        const ds = (await b.db.query(`SELECT dosya_no, dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [u.dosya_ref])).rows[0];
        const g = u.gonder as Gonderim | null; const eksiz = g && !g.sigortaTeyitli;
        if (eksiz) await disGonder(b.db, { olay: g.olay, eposta: g.eposta, konu: g.konu, metin: g.metin, acil: g.acil });
        if (ds.r) {
          await kartAc(b.db, { tur: 'Belge Üretim Hatası', kategori: 'islem', baslik: `${ds.dosya_no} · ${u.tur} Üretilemedi`, ozet: g?.sigortaTeyitli ? 'Belge üretilemedi; sigorta şirketine iletilmedi. Bilgi İşlem ile görüşmenizi rica ederiz.' : eksiz ? 'Belge üretilemedi; ileti PDF eki olmadan gönderildi. Bilgi İşlem ile görüşmenizi rica ederiz.' : 'Belge üretilemedi; Bilgi İşlem ile görüşmenizi rica ederiz.', oncelik: 'Yüksek', sahipKullanici: ds.r, nesneTuru: 'Belge Üretim', nesneKimligi: u.kimlik });
          await bildir(b.db, { olay: `belge-hata:${u.kimlik}`, kullanicilar: [ds.r], baslik: `${ds.dosya_no} · ${u.tur} Üretilemedi`, oncelik: 'Yüksek' });
        }
      }
    } finally { c.release(); }
  }
  return n;
}
