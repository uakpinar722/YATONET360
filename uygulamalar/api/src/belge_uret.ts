import { Readable } from 'node:stream';
import type { Pool, PoolClient } from 'pg';
import { dogrulamaKodu } from './belge.js';
import { bildir, disGonder } from './bildirim.js';
import { Depo } from './depo.js';
import { kartAc } from './is_motoru.js';
import type { Baglam } from './kimlik.js';
import { gunAy, metinGetir, tutar, type Dil } from './metin.js';
import { pdfUret, type BelgeTanim, type Bolum } from './pdf.js';
import { altNumara } from './sure.js';

type Db = Pool | PoolClient;
export type UretimTuru = 'Fiyat Teklifi' | 'Teknik Rapor' | 'Onay Belgesi' | 'Proforma' | 'Ödeme Talebi' | 'İş Emri' | 'Teslim Tutanağı' | 'Ödeme Sorumluluğu' | 'Uyuşmazlık Paketi' | 'Mutabakat Raporu' | 'Kurtarma Sözleşmesi';
interface Gonderim { olay: string; eposta: string; konu: string; metin: string; acil?: boolean; sigortaTeyitli?: boolean; ekle?: UretimTuru[] }

/** YG-469, YG-558: PDF kuyruğa yazılır; işlem üretim hatasından etkilenmez. Hata Dosya Sorumlusuna bildirilir. */
export async function belgeUret(c: Db, g: { tur: UretimTuru; nesne: string; dosya: string; gonder?: Gonderim }): Promise<void> {
  await c.query(`INSERT INTO belge_uretim (tur, nesne, dosya_ref, gonder) VALUES ($1,$2,$3,$4) ON CONFLICT (tur, nesne) DO UPDATE SET gonder = CASE WHEN belge_uretim.durum = 'Bekliyor' THEN coalesce(EXCLUDED.gonder, belge_uretim.gonder) ELSE EXCLUDED.gonder END, durum = 'Bekliyor', deneme = 0`, [g.tur, g.nesne, g.dosya, g.gonder ? JSON.stringify(g.gonder) : null]);
}

const E = {
  tr: { musteri: 'Müşteri ve Dosya', yat: 'Yat Bilgileri', olay: 'Olay', kalem: 'Teklif Kalemleri', kosul: 'Koşullar', iletisim: 'İletişim Kişileri', ekip: 'Atanan Ekip', kapsam: 'Görev ve Kapsam', yontem: 'Yöntem ve Ölçüt', bulgu: 'Bulgular', foto: 'Fotoğraf Kanıtları', deger: 'Değerlendirme', oneri: 'Öneri ve Seçenekler', acik: 'Açık Sorular', sinir: 'Uzmanlık Sınırı', konu: 'Onay Konusu', beyan: 'Beyan', kayit: 'Onay Kaydı', dosyaYat: 'Dosya ve Yat', talep: 'Talep Kalemleri',
    must: 'Müşteri', sahip: 'Yat Sahibi', surumS: 'Belge Sürümü', onceki: 'Önceki Ödemeler ve Mahsup (EUR)', odenecek: 'Ödenecek Tutar (EUR)', hasar: 'Hasar Dosya No', odeme: 'Ödeme Sorumlusu', dosyaNo: 'Dosya No', yatAdi: 'Yat Adı', marka: 'Marka / Model', tur: 'Tekne Türü', boy: 'Boy', govde: 'Gövde Malzemesi', yil: 'İmal Yılı', bayrak: 'Bayrak', adres: 'Yatın Bulunduğu Adres', ozet: 'Olay Özeti', tarih: 'Tarih', yer: 'Olay Yeri', sira: '#', kod: 'Kod', aciklama: 'Açıklama', nitelik: 'Nitelik', bedel: 'Bedel Türü', miktar: 'Miktar', fiyat: 'Birim Fiyat (EUR)', tutar: 'Tutar (EUR)', ara: 'Ara Toplam', indirim: 'İndirim', kdv: 'KDV', genel: 'Genel Toplam (EUR)', gecerlilik: 'Geçerlilik', odemeKosul: 'Ödeme', gorev: 'Görev', ad: 'Ad Soyad', tel: 'Telefon', eposta: 'E-posta', soru: 'İncelenen', kosulS: 'Koşul', yontemS: 'Yöntem', bolge: 'Bölge', gozlem: 'Gözlem ve Ölçüm', etiket: 'Etiket', onem: 'Önem', gorsel: 'Görsel', konumS: 'Konum', turS: 'Onay Türü', belgeS: 'Onaylanan Belge', onaylayan: 'Onaylayan', yontemO: 'Yöntem', kodO: 'Kod', zaman: 'Tarih-Saat', smsY: 'SMS ile gönderilen bağlantı ve tek kullanımlık kod', talepT: 'Ödeme Talebi Türü', son: 'Son Ödeme Tarihi', dayanak: 'Dayanak', proforma: 'Bu belge proforma niteliğindedir ve fatura yerine geçmez.',
    Teklif: 'Fiyat Teklifi', Rapor: 'Teknik Rapor', Onay: 'Yat Sahibi Onay Belgesi', Odeme: 'Ödeme Talebi (Proforma)' },
  en: { musteri: 'Customer and File', yat: 'Yacht Details', olay: 'Incident', kalem: 'Quotation Items', kosul: 'Terms', iletisim: 'Contacts', ekip: 'Assigned Team', kapsam: 'Scope of Inspection', yontem: 'Method and Criteria', bulgu: 'Findings', foto: 'Photographic Evidence', deger: 'Assessment', oneri: 'Recommendation and Options', acik: 'Open Questions', sinir: 'Limits of Expertise', konu: 'Subject of Approval', beyan: 'Statement', kayit: 'Approval Record', dosyaYat: 'File and Yacht', talep: 'Requested Items',
    must: 'Customer', sahip: 'Yacht Owner', surumS: 'Document Version', onceki: 'Previous Payments and Set-off (EUR)', odenecek: 'Amount Payable (EUR)', hasar: 'Claim File No', odeme: 'Payer', dosyaNo: 'File No', yatAdi: 'Yacht Name', marka: 'Make / Model', tur: 'Yacht Type', boy: 'Length', govde: 'Hull Material', yil: 'Year Built', bayrak: 'Flag', adres: 'Location of Yacht', ozet: 'Incident Summary', tarih: 'Date', yer: 'Place of Incident', sira: '#', kod: 'Code', aciklama: 'Description', nitelik: 'Nature', bedel: 'Cost Type', miktar: 'Quantity', fiyat: 'Unit Price (EUR)', tutar: 'Amount (EUR)', ara: 'Subtotal', indirim: 'Discount', kdv: 'VAT', genel: 'Grand Total (EUR)', gecerlilik: 'Validity', odemeKosul: 'Payment', gorev: 'Role', ad: 'Name', tel: 'Telephone', eposta: 'E-mail', soru: 'Inspected', kosulS: 'Conditions', yontemS: 'Method', bolge: 'Zone', gozlem: 'Observation and Measurement', etiket: 'Label', onem: 'Severity', gorsel: 'Image', konumS: 'Location', turS: 'Approval Type', belgeS: 'Approved Document', onaylayan: 'Approved By', yontemO: 'Method', kodO: 'Code', zaman: 'Date-Time', smsY: 'Link sent by SMS and one-time code', talepT: 'Payment Request Type', son: 'Payment Due Date', dayanak: 'Basis', proforma: 'This document is a pro forma and is not an invoice.',
    Teklif: 'Price Quotation', Rapor: 'Technical Report', Onay: 'Yacht Owner Approval Document', Odeme: 'Payment Request (Proforma)' },
};
const oran = (x: unknown) => String(Number(x)).replace('.', ',');
const anSaat = (z: Date | string) => `${gunAy(z)} ${new Date(z).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}`;
const para = (x: unknown, d: Dil) => (x === null || x === undefined ? '—' : tutar(Number(x), d));
const ROL_EN: Record<string, string> = { 'Dosya Sorumlusu': 'File Manager', 'Operasyon Yöneticisi': 'Operations Manager', 'Teknik Uzman': 'Technical Expert', 'Teknik Yönetici': 'Technical Manager', 'Saha Sorumlusu': 'Site Supervisor' };

async function dosyaBilgi(db: Db, id: string, hazirlik: string) {
  const d = (await db.query(`SELECT d.dosya_no, d.konum, d.kisa_teknik_tanim, d.olay_tarihi, d.bildirim_tarihi, d.musteri_turu, d.yazisma_dili, d.dosya_niteligi, y.yat_adi, y.tur AS yat_turu, y.tam_boy_m, y.govde_malzemesi, y.uretim_yili, y.bayrak, coalesce(m.marka, y.marka_diger) AS marka, coalesce(m.model, y.model_diger) AS model, s.sigortaci_adi, s.sigorta_hasar_dosya_no FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE d.kimlik = $1`, [id])).rows[0];
  const sahip = (await db.query(`SELECT kisi_adi_soyadi FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [id])).rows[0]?.kisi_adi_soyadi as string | undefined;
  const ekip = (await db.query(`SELECT a.rol, a.atama_zamani, h.kimlik AS kullanici, h.ad_soyad, h.cep_telefonu, h.e_posta FROM dosya_ekibi_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.dosya_ref = $1 AND a.bitis_zamani IS NULL AND a.rol IN ('Dosya Sorumlusu', 'Operasyon Yöneticisi', 'Teknik Uzman', 'Teknik Yönetici', 'Saha Sorumlusu')`, [id])).rows;
  void hazirlik;
  return { d, sahip, ekip, dil: (d.yazisma_dili === 'İngilizce' ? 'en' : 'tr') as Dil };
}

function ortak(b: Awaited<ReturnType<typeof dosyaBilgi>>): Bolum[] {
  const { d, sahip, dil } = b; const e = E[dil]; const sg = d.musteri_turu === 'Sigorta Şirketi';
  const boy = d.tam_boy_m ? `${tutar(Number(d.tam_boy_m), dil)} m` : null;
  return [
    { baslik: e.musteri, tur: 'alanlar', alanlar: [{ et: e.must, deger: sg ? d.sigortaci_adi : sahip }, { et: e.dosyaNo, deger: d.dosya_no }, { et: e.hasar, deger: d.sigorta_hasar_dosya_no }, { et: e.odeme, deger: d.musteri_turu }] },
    { baslik: e.yat, tur: 'alanlar', alanlar: [{ et: e.yatAdi, deger: d.yat_adi }, { et: e.marka, deger: [d.marka, d.model].filter(Boolean).join(' · ') }, { et: e.tur, deger: d.yat_turu }, { et: e.boy, deger: boy }, { et: e.govde, deger: d.govde_malzemesi }, { et: e.yil, deger: d.uretim_yili }, { et: e.bayrak, deger: d.bayrak }, { et: e.adres, deger: d.konum, genis: true }] },
    { baslik: e.olay, tur: 'alanlar', alanlar: [{ et: e.tarih, deger: d.olay_tarihi ? gunAy(d.olay_tarihi) : null }, { et: e.ozet, deger: d.kisa_teknik_tanim, genis: true }] },
  ];
}
const ekipBolumu = (b: Awaited<ReturnType<typeof dosyaBilgi>>): Bolum => { const e = E[b.dil]; return { baslik: e.iletisim, tur: 'tablo', sutunlar: [{ ad: e.gorev }, { ad: e.ad }, { ad: e.tel }, { ad: e.eposta }], satirlar: b.ekip.filter((x) => x.rol === 'Dosya Sorumlusu' || x.rol === 'Teknik Uzman').map((x) => [b.dil === 'en' ? ROL_EN[x.rol] ?? x.rol : x.rol, x.ad_soyad, x.cep_telefonu, x.e_posta]) }; };
const atananEkip = (b: Awaited<ReturnType<typeof dosyaBilgi>>): Bolum => { const e = E[b.dil]; return { baslik: e.ekip, tur: 'tablo', sutunlar: [{ ad: e.gorev }, { ad: e.ad }, { ad: e.zaman }], satirlar: b.ekip.map((x) => [b.dil === 'en' ? ROL_EN[x.rol] ?? x.rol : x.rol, x.ad_soyad, anSaat(x.atama_zamani)]) }; };
const hitap = (b: Awaited<ReturnType<typeof dosyaBilgi>>, belge: string) => { const { d, sahip, dil } = b; const kim = d.musteri_turu === 'Sigorta Şirketi' ? d.sigortaci_adi : sahip; const t = gunAy(d.bildirim_tarihi); return dil === 'en' ? `Dear ${kim ?? 'Sir/Madam'}, the ${belge} prepared under your request dated ${t} and file no. ${d.dosya_no} is submitted for your information.` : `Sayın ${kim ?? 'Yetkili'}${d.musteri_turu === 'Sigorta Şirketi' ? ' Yetkilisi' : ''}, ${t} tarihli talebiniz ve ${d.dosya_no} numaralı dosya kapsamında hazırlanan ${belge} bilginize sunulur.`; };
const sozlesme = (d: { musteri_turu: string }, dil: Dil) => (d.musteri_turu === 'Sigorta Şirketi' ? (dil === 'en' ? 'This document is subject to, and shall be read together with, the Insurance Company Framework Service Agreement and Insurance Assignment between the parties.' : 'Bu belge, taraflar arasındaki Sigorta Şirketi Çerçeve Hizmet Sözleşmesi ve Sigorta Görevlendirmesi hükümlerine tabidir ve onunla birlikte değerlendirilir.') : (dil === 'en' ? 'This document is subject to, and shall be read together with, the Yacht Repair and Technical Services Agreement between the parties.' : 'Bu belge, taraflar arasındaki Yat Onarım ve Teknik Hizmet Sözleşmesi hükümlerine tabidir ve onunla birlikte değerlendirilir.'));
const gizli = (dil: Dil) => (dil === 'en' ? 'This document has been prepared solely for the proceedings of the named file. Except where required by law, its contents may not be shared with third parties without the written consent of LİMİT GLOBAL MARINE.' : 'Bu belge, yalnız adı geçen dosyanın işlemleri için hazırlanmıştır. İçeriği, yasal zorunluluklar dışında LİMİT GLOBAL MARINE’ın yazılı onayı olmadan üçüncü kişilerle paylaşılamaz.');
const dogrula = (dil: Dil, kod: string, web: string) => (dil === 'en' ? `This document was generated and electronically approved on YATONET 360 and does not require a wet signature. Its authenticity can be verified at ${web}/dogrula with code ${kod}.` : `Bu belge YATONET 360 tarafından üretilmiş ve elektronik olarak onaylanmıştır; ıslak imza gerektirmez. Doğruluğunu ${kod} ile ${web}/dogrula üzerinden doğrulayabilirsiniz.`);
const tesekkur = (dil: Dil) => (dil === 'en' ? 'Thank you for choosing LİMİT GLOBAL MARINE.' : 'LİMİT GLOBAL MARINE’ı tercih ettiğiniz için teşekkür ederiz.');

export async function teklifTanim(db: Db, id: string, kod: string, web: string): Promise<{ t: BelgeTanim; dosyaAdi: string; sinif: string }> {
  const f = (await db.query(`SELECT * FROM fiyat_teklifi WHERE kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, f.dosya_ref, f.hazirlayan_ref); const dil = b.dil; const e = E[dil];
  const kl = (await db.query(`SELECT sira_no, kartela_kodu, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [id])).rows;
  const kapanis = (await db.query(`SELECT r.rol_adi, a.zaman FROM is_karti k JOIN is_karti_adim a ON a.is_ref = k.kimlik LEFT JOIN rol r ON r.kimlik = a.rol_ref WHERE k.tur = 'Fiyat Teklifi' AND k.nesne_kimligi = $1 AND a.karar IN ('Onayla', 'Kademe Atla') ORDER BY a.kimlik DESC LIMIT 1`, [id])).rows[0];
  const top = [{ et: e.ara, deger: para(f.ara_toplam_eur, dil) }];
  if (Number(f.indirim_tutari_eur) > 0) top.push({ et: `${e.indirim} %${oran(f.indirim_orani)}`, deger: `-${para(f.indirim_tutari_eur, dil)}` });
  top.push({ et: `${e.kdv} %${oran(f.kdv_orani)}`, deger: para(f.kdv_tutari_eur, dil) });
  const bolumler: Bolum[] = [
    ...ortak(b),
    { baslik: e.kalem, tur: 'tablo', sutunlar: [{ ad: e.sira, hiza: 'ort' }, { ad: e.kod }, { ad: e.aciklama }, { ad: e.nitelik }, { ad: e.bedel }, { ad: e.miktar, hiza: 'sag' }, { ad: e.fiyat, hiza: 'sag' }, { ad: e.tutar, hiza: 'sag' }], satirlar: kl.map((k) => [k.sira_no, k.kartela_kodu, k.aciklama, k.isin_niteligi, k.bedel_turu, `${tutar(Number(k.miktar), dil)} ${k.birim}`, para(k.birim_satis_fiyati_eur, dil), para(k.tutar_eur, dil)]), toplamlar: [...top, { et: e.genel, deger: para(f.genel_toplam_eur, dil), ana: true } as { et: string; deger: string; ana?: boolean }] },
    { baslik: e.kosul, tur: 'alanlar', alanlar: [{ et: e.gecerlilik, deger: f.gecerlilik_bitis_tarihi ? gunAy(f.gecerlilik_bitis_tarihi) : null }, { et: e.odemeKosul, deger: f.odeme_vadesi }] },
    ekipBolumu(b),
    atananEkip(b),
  ];
  return {
    dosyaAdi: `${f.teklif_no}.pdf`, sinif: 'Gizli',
    t: { ad: e.Teklif, kod: 'FR-TIC-008', no: f.teklif_no, dosyaNo: b.d.dosya_no, tarih: gunAy(f.gonderim_zamani ?? new Date()), surum: `Rev.${f.surum_no}`, dil, yat: b.d.yat_adi,
      matbuBas: [hitap(b, e.Teklif)], bolumler,
      matbuSon: [dil === 'en' ? 'This quotation is valid for 15 days from its date of issue. Amounts are in EUR; VAT is shown separately; invoices are issued in TRY at the CBRT foreign exchange selling rate of the business day preceding the invoice date. The invoice is final; no exchange difference invoice is issued. Work not included in this quotation is performed only upon separate approval.' : 'Bu teklif, düzenlendiği tarihten itibaren 15 gün geçerlidir. Tutarlar EUR cinsindendir; KDV ayrıca gösterilmiştir; fatura, fatura tarihinden önceki iş gününe ait TCMB döviz satış kuruyla TL olarak düzenlenir. Fatura nihaidir; kur farkı faturası düzenlenmez. Teklifte yer almayan işler ancak ayrıca onaylanırsa yapılır.', sozlesme(b.d, dil), gizli(dil), dogrula(dil, kod, web), tesekkur(dil)],
      onay: kapanis ? { rol: kapanis.rol_adi ?? '', zaman: anSaat(kapanis.zaman), kanal: 'YATONET 360', kod } : undefined },
  };
}

async function raporTanim(db: Db, id: string, kod: string, web: string) {
  const r = (await db.query(`SELECT * FROM teknik_rapor WHERE kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, r.dosya_ref, r.hazirlayan_ref); const dil = b.dil; const e = E[dil];
  const bl = (await db.query(`SELECT bulgu_no, konum_referansi, bolge_kodu, aciklama, bulgu_etiketi, hasar_onem_derecesi FROM bulgu WHERE dosya_ref = $1 ORDER BY bulgu_no`, [r.dosya_ref])).rows;
  const gr = (await db.query(`SELECT gorsel_no, cekim_kalemi, cekim_zamani, konum FROM gorsel_kanit WHERE dosya_ref = $1 AND belge_ref IS NOT NULL ORDER BY gorsel_no`, [r.dosya_ref])).rows;
  const kapanis = (await db.query(`SELECT r.rol_adi, a.zaman FROM is_karti k JOIN is_karti_adim a ON a.is_ref = k.kimlik LEFT JOIN rol r ON r.kimlik = a.rol_ref WHERE k.tur = 'Teknik Rapor' AND k.nesne_kimligi = $1 AND a.karar = 'Onayla' ORDER BY a.kimlik DESC LIMIT 1`, [id])).rows[0];
  const bolumler: Bolum[] = [...ortak(b),
    { baslik: e.kapsam, tur: 'alanlar', alanlar: [{ et: e.soru, deger: r.kapsam, genis: true }, { et: e.kosulS, deger: r.saha_kosullari, genis: true }, { et: e.konumS, deger: r.incelenen_alan, genis: true }] },
    { baslik: e.yontem, tur: 'metin', metin: r.yontem_olcut },
    { baslik: e.bulgu, tur: 'metin', metin: r.bulgular },
  ];
  if (bl.length) bolumler.push({ baslik: `${e.bulgu} (${e.bolge})`, tur: 'tablo', sutunlar: [{ ad: e.bolge }, { ad: e.gozlem }, { ad: e.konumS }, { ad: e.etiket }, { ad: e.onem }], satirlar: bl.map((x) => [x.bolge_kodu ?? x.bulgu_no, x.aciklama, x.konum_referansi, x.bulgu_etiketi, x.hasar_onem_derecesi]) });
  bolumler.push({ baslik: e.deger, tur: 'metin', metin: r.analiz_risk }, { baslik: e.oneri, tur: 'metin', metin: r.oneriler }, { baslik: e.acik, tur: 'metin', metin: r.acik_sorular }, { baslik: e.sinir, tur: 'metin', metin: r.uzmanlik_siniri }, ekipBolumu(b), atananEkip(b));
  if (gr.length) bolumler.push({ baslik: e.foto, tur: 'tablo', sutunlar: [{ ad: e.gorsel }, { ad: e.aciklama }, { ad: e.zaman }, { ad: e.konumS }], satirlar: gr.map((x) => [x.gorsel_no, x.cekim_kalemi, x.cekim_zamani ? gunAy(x.cekim_zamani) : null, x.konum]) });
  return {
    dosyaAdi: `${r.rapor_no}.pdf`, sinif: 'Kritik',
    t: { ad: e.Rapor, kod: 'RP-RAP-002', no: r.rapor_no, dosyaNo: b.d.dosya_no, tarih: gunAy(new Date()), surum: `Rev.${r.surum}`, dil, yat: b.d.yat_adi, rapor: true, matbuBas: [hitap(b, e.Rapor), dil === 'en' ? 'This report is based on the on-site inspection, measurements and records made on the stated date and under the stated conditions. No opinion is given on parts that were not dismantled, accessible or inspected. The report may be revised if new information or findings arise.' : 'Bu rapor, belirtilen tarihte ve koşullarda yerinde yapılan inceleme, ölçüm ve kayıtlara dayanır. Söküm yapılmayan, erişilemeyen veya incelenmeyen bölümler için görüş verilmemiştir. Yeni bilgi veya bulgu ortaya çıkarsa rapor revize edilebilir.'], bolumler, matbuSon: [sozlesme(b.d, dil), gizli(dil), dogrula(dil, kod, web), tesekkur(dil)], onay: kapanis ? { rol: kapanis.rol_adi ?? '', zaman: anSaat(kapanis.zaman), kanal: 'YATONET 360', kod } : undefined } as BelgeTanim,
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
  return { dosyaAdi: `${no}.pdf`, sinif: 'Gizli', t: { ad: e.Onay, kod: 'FR-OPS-017', no, dosyaNo: t.dosya_no, tarih: gunAy(t.onay_zamani), surum: 'Rev.1', dil, yat: b.d.yat_adi, matbuBas: dil === 'en' ? ['SUBJECT: YOUR APPROVAL HAS BEEN RECEIVED', 'Your approval has been received on the YATONET 360 approval screen and recorded with the details below. This certificate has been sent to your registered e-mail address together with a PDF copy of the document you approved.'] : ['KONU: ONAYINIZ ALINMIŞTIR', 'Değerli onayınız YATONET 360 onay ekranında alınmış ve aşağıdaki bilgilerle kayda geçirilmiştir. Bu belge, onayladığınız belgenin PDF örneğiyle birlikte kayıtlı e-posta adresinize gönderilmiştir.'], bolumler, matbuSon: [sozlesme({ musteri_turu: 'Bireysel' }, dil), dogrula(dil, kod, web), tesekkur(dil)] } as BelgeTanim };
}

async function odemeTanim(db: Db, tur: 'Proforma' | 'Ödeme Talebi', id: string, kod: string, web: string) {
  const f = tur === 'Proforma' ? (await db.query(`SELECT m.proforma_no AS no, m.dosya_ref, m.teklif_ref, m.kdv_haric_eur, m.kdv_eur, m.toplam_eur, m.vade, 'Nihai' AS talep_turu, t.teklif_no, t.kdv_orani FROM musteri_faturasi m LEFT JOIN fiyat_teklifi t ON t.kimlik = m.teklif_ref WHERE m.kimlik = $1`, [id])).rows[0]
    : (await db.query(`SELECT NULL AS no, o.dosya_ref, o.teklif_ref, o.tutar_eur AS toplam_eur, o.son_tarih AS vade, o.tur AS talep_turu, t.teklif_no, t.kdv_orani FROM odeme_talebi o LEFT JOIN fiyat_teklifi t ON t.kimlik = o.teklif_ref WHERE o.kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, f.dosya_ref, ''); const dil = b.dil; const e = E[dil];
  const onceki = tur === 'Proforma' ? Number((await db.query(`SELECT coalesce(sum(tutar_eur), 0) n FROM tahsilat WHERE dosya_ref = $1`, [f.dosya_ref])).rows[0].n) : 0;
  const kapanis = tur === 'Proforma' ? (await db.query(`SELECT r.rol_adi, a.zaman FROM is_karti k JOIN is_karti_adim a ON a.is_ref = k.kimlik LEFT JOIN rol r ON r.kimlik = a.rol_ref WHERE k.tur = 'Proforma' AND k.nesne_kimligi = $1 AND a.karar = 'Onayla' ORDER BY a.kimlik DESC LIMIT 1`, [id])).rows[0] : undefined;
  const no = f.no ?? await altNumara(db, b.d.dosya_no, 'OT');
  const kl = tur === 'Proforma' ? (await db.query(`SELECT sira_no, kartela_kodu, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu = 'Onaylandı' ORDER BY sira_no`, [f.teklif_ref])).rows : [];
  const bolumler: Bolum[] = [
    { baslik: e.musteri, tur: 'alanlar', alanlar: [{ et: e.must, deger: b.d.musteri_turu === 'Sigorta Şirketi' ? b.d.sigortaci_adi : b.sahip }, { et: e.talepT, deger: f.talep_turu }, { et: e.dosyaNo, deger: b.d.dosya_no }, { et: e.yatAdi, deger: b.d.yat_adi }, { et: e.dayanak, deger: f.teklif_no }, { et: e.son, deger: f.vade ? gunAy(f.vade) : null }] },
  ];
  if (kl.length) bolumler.push({ baslik: e.talep, tur: 'tablo', sutunlar: [{ ad: e.sira, hiza: 'ort' }, { ad: e.kod }, { ad: e.aciklama }, { ad: e.bedel }, { ad: e.miktar, hiza: 'sag' }, { ad: e.fiyat, hiza: 'sag' }, { ad: e.tutar, hiza: 'sag' }], satirlar: kl.map((k) => [k.sira_no, k.kartela_kodu, k.aciklama, k.bedel_turu, `${tutar(Number(k.miktar), dil)} ${k.birim}`, para(k.birim_satis_fiyati_eur, dil), para(k.tutar_eur, dil)]), toplamlar: [{ et: e.ara, deger: para(f.kdv_haric_eur, dil) }, { et: `${e.kdv} %${oran(f.kdv_orani)}`, deger: para(f.kdv_eur, dil) }, { et: e.genel, deger: para(f.toplam_eur, dil) }, { et: e.onceki, deger: para(onceki, dil) }, { et: e.odenecek, deger: para(Number(f.toplam_eur) - onceki, dil), ana: true }] });
  else bolumler.push({ baslik: e.talep, tur: 'alanlar', alanlar: [{ et: e.aciklama, deger: f.talep_turu }, { et: e.genel, deger: para(f.toplam_eur, dil) }] });
  bolumler.push(ekipBolumu({ ...b, ekip: b.ekip.filter((x) => x.rol === 'Dosya Sorumlusu') }));
  return { dosyaAdi: `${no}.pdf`, sinif: 'Kritik', t: { ad: e.Odeme, kod: 'FR-TIC-010', no, dosyaNo: b.d.dosya_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil, yat: b.d.yat_adi, matbuBas: [hitap(b, e.Odeme), ...(f.talep_turu === 'Nihai' ? [dil === 'en' ? `The final payment request for the work completed and accepted with your approval under file no. ${b.d.dosya_no} is set out below for your information. This document is a pro forma and is not an invoice.` : `${b.d.dosya_no} numaralı dosyanızda tamamlanan ve onayınızla kabul edilen işlere ilişkin nihai ödeme talebi aşağıda bilgilerinize sunulmuştur. Bu belge proforma niteliğindedir ve fatura yerine geçmez.`] : [e.proforma])], bolumler, matbuSon: [dil === 'en' ? 'Amounts are in EUR; VAT is shown separately. This document is a pro forma and does not replace an invoice; your invoice will be sent separately by our Accounting Department in TRY at the CBRT foreign exchange selling rate of the business day preceding the invoice date.' : 'Tutarlar EUR cinsindendir; KDV ayrıca gösterilmiştir. Bu belge proforma niteliğindedir, fatura yerine geçmez; faturanız Muhasebe Birimimizce, fatura tarihinden önceki iş gününe ait TCMB döviz satış kuruyla TL olarak ayrıca iletilecektir.', dogrula(dil, kod, web), tesekkur(dil)], onay: kapanis ? { rol: kapanis.rol_adi ?? '', zaman: anSaat(kapanis.zaman), kanal: 'YATONET 360', kod } : undefined } as BelgeTanim };
}

/** YG-896, FR-TIC-013: kalem, tutar ve son tarih; gerekçe yorumu yok, gövde onaylı BLD-30 metnidir. */
async function sorumlulukTanim(db: Db, id: string, kod: string, web: string) {
  const v = await odemeTanim(db, 'Ödeme Talebi', id, kod, web);
  const kl = (await db.query(`SELECT tur, aciklama, tutar_eur FROM odeme_sorumlulugu_kalemi WHERE odeme_talebi_ref = $1`, [id])).rows;
  const dil = v.t.dil as Dil; const en = dil === 'en';
  const govde = await metinGetir(db, 'BLD-30', dil, { 'Dosya No': v.t.dosyaNo as string, 'File No': v.t.dosyaNo as string, 'bağlantı': web, link: web });
  return { ...v, t: { ...v.t, ad: en ? 'Payment Responsibility Notice' : 'Ödeme Sorumluluğu Bildirimi', kod: 'FR-TIC-013', matbuBas: [govde], bolumler: [{ baslik: en ? 'Items' : 'Kalemler', tur: 'tablo', sutunlar: [{ ad: en ? 'Item' : 'Kalem' }, { ad: en ? 'Description' : 'Açıklama' }, { ad: en ? 'Amount (EUR)' : 'Tutar (EUR)', hiza: 'sag' }], satirlar: kl.map((k) => [k.tur, k.aciklama, tutar(Number(k.tutar_eur), dil)]) } as Bolum, ...(v.t.bolumler as Bolum[])] } };
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
  const no = await altNumara(db, u.dosya_no, 'UP');
  return { dosyaAdi: `${no}.pdf`, sinif: 'Kritik', t: { ad: 'Uyuşmazlık Dışa Aktarım Paketi', kod: 'FR-KLT-012', no, dosyaNo: u.dosya_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil: 'tr' as Dil, yat: u.yat_adi, icKayit: true, bolumler, kodEk: kod } };
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
  const no = `MT-${r.donem}-${String(r.sigortaci_adi).slice(0, 12).replace(/\s/g, '')}`;
  return { dosyaAdi: `${no}.pdf`, sinif: 'Gizli', t: { ad: 'Aylık Sigorta Mutabakat Raporu', kod: 'RP-TIC-MUT', no, tarih: gunAy(new Date()), surum: 'Rev.1', dil: 'tr' as Dil, bolumler } };
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
  if (kl.length) bolumler.push({ baslik: 'İş Paketleri', tur: 'tablo', sutunlar: [{ ad: 'Paket', hiza: 'ort' }, { ad: 'Kapsam' }, { ad: 'Miktar', hiza: 'sag' }], satirlar: kl.map((k, n) => [n + 1, k.aciklama, `${tutar(Number(k.miktar), dil)} ${k.birim}`]) });
  const dayanak = e.is_emri_turu === 'AC' ? 'Firmanın onaylı acil hizmet tarifesi (İB Çerçeve Sözleşmesi Ek-1)  ·  iş emri fiyat içermez' : e.teklif_ref ? 'Onaylı Firma Fiyat Teklifi FR-TIC-012  ·  iş emri fiyat içermez' : 'İş emri fiyat içermez';
  bolumler.push({ baslik: 'Bedel Dayanağı', tur: 'alanlar', alanlar: [{ et: 'Bedel Dayanağı', deger: dayanak, genis: true }] });
  if (['ON', 'EK', 'GR'].includes(e.is_emri_turu)) bolumler.push({ baslik: 'Saha Kuralları', tur: 'alanlar', alanlar: [{ et: 'Yatın Kullanımı', deger: 'Yatı yalnız yatın kaptanı kullanır', genis: true }, { et: 'Kayıt', deger: 'İlerleme ve fotoğraflar her gün YATONET 360’a', genis: true }, { et: 'Atık', deger: 'Ayrıştırılır, teslim belgesi yüklenir', genis: true }, { et: 'İSG', deger: 'Çalışma izni ve kişisel koruyucu donanım zorunlu', genis: true }, { et: 'İletişim', deger: 'Müşteri ve sigorta ile yalnız LGM üzerinden', genis: true }, { et: 'Çalışma Saatleri', deger: 'Tesisin çalışma saatlerine ve kurallarına uyulur', genis: true }] });
  const satir = (g: string, ad: unknown, tel: unknown, ep: unknown) => [g, ad as string, tel as string, ep as string];
  bolumler.push(
    { baslik: E.tr.iletisim, tur: 'tablo', sutunlar: [{ ad: 'Görev' }, { ad: 'Ad Soyad' }, { ad: 'Telefon' }, { ad: 'E-posta' }], satirlar: [
      ...b.ekip.filter((x) => x.rol === 'Dosya Sorumlusu' || x.rol === 'Saha Sorumlusu').map((x) => satir(`LGM ${x.rol}`, x.ad_soyad, x.cep_telefonu, x.e_posta)),
      ...taraflar.map((x) => satir(x.taraf_rolu === 'Kaptan' ? 'Yatın Kaptanı' : 'Tesis Yetkilisi', x.kisi_adi_soyadi, x.telefon, x.eposta)),
      ...(yetkili ? [satir('Firma Yetkilisi', yetkili.ad_soyad, yetkili.cep_telefonu, yetkili.e_posta)] : []),
    ] },
    atananEkip(bt),
    ...(e.kesin_teslim_durumu === 'Onaylandı' ? [{ baslik: 'Kesin Teslim', tur: 'alanlar' as const, alanlar: [{ et: 'Kesin Teslim Tarihi', deger: gunAy(e.kesin_teslim_tarihi) }, { et: 'Gecikme Bedeli (EUR)', deger: tutar(Number(e.gecikme_bedeli_eur)) }] }] : []), // YG-215
    { baslik: 'Onay ve Kabul', tur: 'alanlar', alanlar: [{ et: 'LGM Onayı', deger: lgm ? `${lgm.rol_adi}  ·  YATONET 360  ·  ${anSaat(lgm.zaman)}` : null, genis: true }, { et: 'Firma Kabulü', deger: e.firma_yaniti === 'Kabul' ? `Firma Yetkilisi  ·  YATONET 360 portalında “Kabul ediyorum”  ·  ${anSaat(e.firma_kabul_zamani)}  ·  imza alınmaz` : 'Bekleniyor', genis: true }] },
  );
  return {
    dosyaAdi: `${e.is_emri_no}.pdf`, sinif: 'Kritik',
    t: { ad: 'İş Emri', kod: 'FR-OPS-008', no: e.is_emri_no, dosyaNo: b.d.dosya_no, tarih: gunAy(e.yayim_zamani ?? new Date()), surum: `Rev.${e.surum}`, dil, yat: b.d.yat_adi, bolumler,
      matbuSon: [gizli(dil), 'Bu iş emri kapsamındaki işler; İş Birliği Firması Çerçeve Sözleşmesi, iş güvenliği kuralları, kalite ve kayıt yükümlülükleri ile gizlilik hükümlerine uygun olarak yürütülür. Kapsam dışı işler YATONET 360 onayı olmadan yapılmaz.', dogrula(dil, kod, web), 'İş birliğiniz için teşekkür ederiz.'],
      onay: e.firma_yaniti === 'Kabul' ? { rol: 'Firma Yetkilisi', zaman: anSaat(e.firma_kabul_zamani), kanal: 'YATONET 360', kod } : undefined } as BelgeTanim,
  };
}

async function tutanakTanim(db: Db, id: string, kod: string, web: string) {
  const k = (await db.query(`SELECT * FROM teslim_kaydi WHERE kimlik = $1`, [id])).rows[0];
  const b = await dosyaBilgi(db, k.dosya_ref, ''); const dil = b.dil; const en = dil === 'en'; const e = E[dil];
  const no = await altNumara(db, b.d.dosya_no, 'TT');
  const teslim = k.teslim_zamani ?? new Date();
  const bitis = new Date(teslim); bitis.setFullYear(bitis.getFullYear() + 1);
  const isler = (await db.query(`SELECT m.aciklama, (SELECT kabul_turu FROM kabul_kaydi x WHERE x.is_emri_ref = i.kimlik ORDER BY x.olusturma_zamani DESC LIMIT 1) AS kabul FROM is_emri_kalemi m JOIN is_emri i ON i.kimlik = m.is_emri_ref WHERE i.dosya_ref = $1 AND i.is_emri_turu IN ('ON', 'EK', 'GR', 'AC') AND i.statu NOT IN ('İptal', 'Yerine Geçti', 'Taslak') ORDER BY i.is_emri_no, m.aciklama`, [k.dosya_ref])).rows;
  const testler = (await db.query(`SELECT test_grubu, sonuc, sonuc_gerekcesi FROM test_kaydi WHERE dosya_ref = $1 AND sonuc IS NOT NULL ORDER BY test_no`, [k.dosya_ref])).rows;
  const kabul = (await db.query(`SELECT kimlik, kabul_turu FROM kabul_kaydi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 1`, [k.dosya_ref])).rows[0];
  const acik = (await db.query(`SELECT a.tanim, a.hedef_tarih FROM acik_is_kalemi a JOIN kabul_kaydi x ON x.kimlik = a.kabul_ref WHERE x.dosya_ref = $1 AND a.kapanis_zamani IS NULL ORDER BY a.hedef_tarih`, [k.dosya_ref])).rows;
  const onay = (await db.query(`SELECT r.onay_kodu, r.onay_zamani, r.onaylayan_ad FROM onay_talebi o JOIN yatonet_onay_kaydi r ON r.onay_talebi_ref = o.kimlik WHERE o.dosya_ref = $1 AND o.ony_kod = 'ONY-27' AND r.karar = 'Onaylandı' ORDER BY r.onay_zamani DESC LIMIT 1`, [k.dosya_ref])).rows[0];
  const eden = b.ekip.find((x) => x.kullanici === k.teslim_eden_ref)?.rol as string | undefined;
  const taraflar = (await db.query(`SELECT taraf_rolu, kisi_adi_soyadi, telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif AND taraf_rolu IN ('Yat Sahibi', 'Kaptan')`, [k.dosya_ref])).rows;
  const T = en ? { h: 'Handover', tur: 'Type', turD: 'Handover to Owner', eden: 'Handed Over By', alan: 'Received By', sonuc: 'Acceptance Result', devir: 'Time of Transfer of Custody', is: 'Completed Work', paket: 'Package', test: 'Test and Acceptance Result', ozet: 'Summary of Test Results', tt: 'Test', ts: 'Result', not: 'Note', gar: 'Warranty Information', kalem: 'Item', bas: 'Warranty Start', bit: 'Warranty End', gn: 'Restarts for 12 months if corrected', kab: 'Acceptance', ktur: 'Acceptance Type', acik: 'Open Item', var: 'Yes', yok: 'None', sor: 'Completion Date', ad: 'Handover Record', ko: 'Received By', kap: 'Yat', sah: 'Yacht Owner', kpt: 'Yacht Captain' }
    : { h: 'Teslim', tur: 'Tür', turD: 'Teslim Etme', eden: 'Teslim Eden', alan: 'Teslim Alan', sonuc: 'Kabul Sonucu', devir: 'Sorumluluk Devri Saati', is: 'Tamamlanan İşler', paket: 'Paket', test: 'Test ve Kabul Sonucu', ozet: 'Test Sonuçları Özeti', tt: 'Test', ts: 'Sonuç', not: 'Not', gar: 'Garanti Bilgisi', kalem: 'Kalem', bas: 'Garanti Başlangıcı', bit: 'Garanti Bitişi', gn: 'Düzeltilirse yeniden 12 ay', kab: 'Kabul', ktur: 'Kabul Türü', acik: 'Açık İş', var: 'Var', yok: 'Yok', sor: 'Tamamlama Tarihi', ad: 'Teslim Tutanağı', ko: 'Teslim Alan', kap: 'Yat', sah: 'Yat Sahibi', kpt: 'Yatın Kaptanı' };
  const [, ortY] = ortak(b);
  const bolumler: Bolum[] = [
    { baslik: T.h, tur: 'alanlar', alanlar: [{ et: T.tur, deger: T.turD }, { et: T.eden, deger: eden ? `LGM ${en ? ROL_EN[eden] ?? eden : eden}` : 'LGM' }, { et: T.alan, deger: k.teslim_alan }, { et: e.must, deger: b.d.musteri_turu === 'Sigorta Şirketi' ? b.d.sigortaci_adi : b.sahip }, { et: e.hasar, deger: b.d.sigorta_hasar_dosya_no }, { et: T.sonuc, deger: kabul?.kabul_turu }, { et: T.devir, deger: anSaat(teslim) }] },
    ortY!,
  ];
  if (isler.length) {
    bolumler.push({ baslik: T.is, tur: 'tablo', sutunlar: [{ ad: T.paket, hiza: 'ort' }, { ad: e.aciklama }, { ad: T.test }], satirlar: isler.map((x, n) => [n + 1, x.aciklama, x.kabul]) });
    bolumler.push({ baslik: T.gar, tur: 'tablo', sutunlar: [{ ad: T.paket, hiza: 'ort' }, { ad: T.kalem }, { ad: T.bas }, { ad: T.bit }, { ad: T.not }], satirlar: isler.map((x, n) => [n + 1, x.aciklama, gunAy(teslim), gunAy(bitis), T.gn]) });
  }
  if (testler.length) bolumler.push({ baslik: T.ozet, tur: 'tablo', sutunlar: [{ ad: T.tt }, { ad: T.ts }, { ad: T.not }], satirlar: testler.map((x) => [x.test_grubu, x.sonuc, x.sonuc_gerekcesi]) });
  bolumler.push({ baslik: T.kab, tur: 'alanlar', alanlar: [{ et: T.ktur, deger: kabul?.kabul_turu }, { et: T.acik, deger: acik.length ? `${T.var}  ·  ${acik.length}` : T.yok }] });
  if (acik.length) bolumler.push({ baslik: T.acik, tur: 'tablo', sutunlar: [{ ad: T.acik }, { ad: T.sor }], satirlar: acik.map((x) => [x.tanim, gunAy(x.hedef_tarih)]) });
  bolumler.push(
    { baslik: e.iletisim, tur: 'tablo', sutunlar: [{ ad: e.gorev }, { ad: e.ad }, { ad: e.tel }, { ad: e.eposta }], satirlar: [
      ...taraflar.map((x) => [x.taraf_rolu === 'Kaptan' ? T.kpt : T.sah, x.kisi_adi_soyadi, x.telefon, x.eposta]),
      ...b.ekip.filter((x) => x.rol === 'Dosya Sorumlusu').map((x) => [`LGM ${en ? 'File Manager' : x.rol}`, x.ad_soyad, x.cep_telefonu, x.e_posta]),
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

/** Kuyruktaki belgeleri üretir, dosyaya resmî sürüm olarak bağlar, ekiyle gönderir. Hata üç denemeden sonra Dosya Sorumlusuna düşer. */
export async function belgeKuyruguIsle(b: Baglam, limit = 10): Promise<number> {
  const depo = b.depo ?? new Depo(); let n = 0;
  const { rows } = await b.db.query(`SELECT * FROM belge_uretim WHERE durum = 'Bekliyor' ORDER BY olusturma_zamani LIMIT $1`, [limit]);
  for (const u of rows) {
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const kod = dogrulamaKodu();
      const v = u.tur === 'Fiyat Teklifi' ? await teklifTanim(c, u.nesne, kod, b.webAdresi) : u.tur === 'Teknik Rapor' ? await raporTanim(c, u.nesne, kod, b.webAdresi) : u.tur === 'Onay Belgesi' ? await onayTanim(c, u.nesne, kod, b.webAdresi) : u.tur === 'İş Emri' ? await isEmriTanim(c, u.nesne, kod, b.webAdresi) : u.tur === 'Teslim Tutanağı' ? await tutanakTanim(c, u.nesne, kod, b.webAdresi) : u.tur === 'Ödeme Sorumluluğu' ? await sorumlulukTanim(c, u.nesne, kod, b.webAdresi) : u.tur === 'Uyuşmazlık Paketi' ? await uyusmazlikTanim(c, u.nesne, kod) : u.tur === 'Mutabakat Raporu' ? await mutabakatTanim(c, u.nesne) : u.tur === 'Kurtarma Sözleşmesi' ? await (await import('./kalan.js')).kurtarmaTanim(c, u.nesne, kod) : await odemeTanim(c, u.tur, u.nesne, kod, b.webAdresi);
      const pdf = await pdfUret(v.t);
      const al = await depo.al(Readable.from(pdf), pdf.length + 1);
      const anahtar = depo.yerlestir(al.yol, al.ozet);
      const sahip = (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [u.dosya_ref])).rows[0].r;
      const ad = `${v.t.ad} ${v.t.no}`;
      const eski = (await c.query(`SELECT kimlik, (SELECT max(surum_no) FROM belge_surum s WHERE s.belge_ref = e.kimlik) n FROM belge e WHERE bag_turu = 'Dosya' AND bag_kimligi = $1 AND ad = $2`, [u.dosya_ref, ad])).rows[0];
      const be = eski?.kimlik ?? (await c.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,$2,$3,'Dosya',$4,'Sistem',(now() AT TIME ZONE 'Europe/Istanbul')::date,$5) RETURNING kimlik`, [ad, u.tur, v.sinif, u.dosya_ref, sahip])).rows[0].kimlik;
      const sur = Number(eski?.n ?? 0) + 1;
      if (eski) await c.query(`UPDATE belge_surum SET durum = 'Yerine Geçti' WHERE belge_ref = $1 AND durum = 'Yürürlükte'`, [be]);
      const s = (await c.query(`INSERT INTO belge_surum (belge_ref, surum_no, dosya_adi, uzanti, boyut, ozet_sha256, depo_anahtari, tarama_kaynagi, degisiklik_gerekcesi, yukleyen_ref, durum, dogrulama_kodu, onay_zamani) VALUES ($1,$2,$3,'pdf',$4,$5,$6,'Sistem',$7,$8,'Yürürlükte',$9,now()) RETURNING kimlik`, [be, sur, v.dosyaAdi, al.boyut, al.ozet, anahtar, sur > 1 ? 'Yeniden üretildi' : null, sahip, kod])).rows[0];
      await c.query(`UPDATE belge_uretim SET durum = 'Üretildi', belge_ref = $2, surum_ref = $3, son_hata = NULL WHERE kimlik = $1`, [u.kimlik, be, s.kimlik]);
      if (u.gonder) {
        const g = u.gonder as Gonderim; const ek: string[] = [s.kimlik];
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
