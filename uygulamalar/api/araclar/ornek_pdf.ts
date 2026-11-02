// Şablon motorunun görsel denetimi için örnek PDF üretir. Yalnız sentetik veri kullanılır.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { doldur, tutar } from '../src/metin.js';
import { pdfKapat, pdfUret, sayfaSayisi, type Bolum } from '../src/pdf.js';

const hedef = process.argv[2] ?? '.';
const NO = 'LGM-2026-10-0042-SO01';
const k = (no: number, kod: string, ac: string, nit: string, x: number) => [no, kod, ac, nit, tutar(x)];
const kalemler: Bolum = {
  baslik: 'Onaylanan Kalemler', tur: 'tablo',
  sutunlar: [{ ad: '#', hiza: 'ort' }, { ad: 'Kod' }, { ad: 'Açıklama' }, { ad: 'İşin Niteliği', hiza: 'ort' }, { ad: 'Tutar (EUR)', hiza: 'sag' }],
  satirlar: [k(1, 'TAHRIK-01.03.02-01', 'Sancak pervanesinin sökülmesi, kanat düzeltmesi ve balansı', 'Onarım', 1850), k(2, 'TAHRIK-01.02.04-02', 'Sancak şaft kovanı ve kesik yatağın yenisiyle değişimi', 'Yenileme', 2640), k(3, 'MASRAF-01.01', 'Karaya alma, denize indirme ve 6 gün kara park', 'Onarım', 1380)],
  toplamlar: [{ et: 'Ara Toplam', deger: tutar(5870) }, { et: 'KDV %20', deger: tutar(1174) }, { et: 'Onaylanan Toplam (EUR)', deger: tutar(7044), ana: true }],
};
const kisa: Bolum[] = [
  { baslik: 'Dosya ve Yat', tur: 'alanlar', alanlar: [{ et: 'Sigorta Şirketi', deger: 'Örnek Sigorta A.Ş.' }, { et: 'Hasar Dosya No', deger: 'HS-2026-118734' }, { et: 'Poliçe No', deger: null }, { et: 'Yat Adı', deger: 'M/Y ÖRNEK' }, { et: 'Marka / Model', deger: 'Örnek Marka · Örnek 60 Fly' }] },
  kalemler,
  { baslik: 'Risk Değerlendirmesi', tur: 'tablo', sutunlar: [{ ad: 'Soru' }, { ad: 'Yanıt', hiza: 'ort' }], satirlar: [['Can güvenliği riski var mı?', { m: 'Hayır', renk: 'yesil' }], ['Su alma sürüyor mu?', { m: 'Bilinmiyor', renk: 'sari' }], ['Çevre kirliliği var mı?', { m: 'Kısmen', renk: 'turuncu' }], ['Güvenle seyir engellendi mi?', { m: 'Evet', renk: 'kirmizi' }]] },
];
const metinler = {
  m1: doldur('Sayın [Kurum], [tarih] tarihli talebiniz ve [Dosya No] numaralı dosya kapsamında hazırlanan [belge adı] bilginize sunulur.', { Kurum: 'Hasar Yetkilisi', tarih: '05.11.2026', 'Dosya No': 'LGM-2026-10-0042', 'belge adı': 'Sigorta Onay Belgesi' }),
  m9: 'LİMİT GLOBAL MARINE’ı tercih ettiğiniz için teşekkür ederiz.',
};
const a = await pdfUret({ ad: 'Sigorta Onay Belgesi', kod: 'FR-TIC-009', no: NO, dosyaNo: 'LGM-2026-10-0042', tarih: '05.11.2026', surum: 'Rev.1', dil: 'tr', isaret: 'Gizli', matbuBas: [metinler.m1], bolumler: kisa, matbuSon: [metinler.m9], onay: { rol: 'Hasar Yetkilisi', zaman: '05.11.2026 09:42', kanal: 'YATONET 360 Onay Ekranı', kod: '7KQ4-M2XD' } });
writeFileSync(join(hedef, 'ornek_kisa.pdf'), a);
const uzun: Bolum[] = Array.from({ length: 9 }, (_, i) => ({ baslik: `Örnek Bölüm ${i + 1}`, tur: 'tablo' as const, sutunlar: [{ ad: '#', hiza: 'ort' as const }, { ad: 'Açıklama' }, { ad: 'Tutar (EUR)', hiza: 'sag' as const }], satirlar: Array.from({ length: 28 }, (_x, j) => [j + 1, `Örnek satır ${j + 1}`, tutar(1000 + j)]) }));
const b = await pdfUret({ ad: 'Teknik Rapor', kod: 'RP-RAP-002', no: 'LGM-2026-10-0042-TR01', dosyaNo: 'LGM-2026-10-0042', tarih: '05.11.2026', surum: 'Rev.0', dil: 'tr', yat: 'M/Y ÖRNEK', rapor: true, bolumler: uzun });
writeFileSync(join(hedef, 'ornek_uzun.pdf'), b);
const c = await pdfUret({ ad: 'Proforma', no: NO, tarih: '05.11.2026', surum: 'Rev.0', dil: 'en', bolumler: [{ baslik: 'Items', tur: 'tablo', sutunlar: [{ ad: 'Item' }, { ad: 'Amount (EUR)', hiza: 'sag' }], satirlar: [['Sample', tutar(4000000, 'en')]] }] });
writeFileSync(join(hedef, 'ornek_en.pdf'), c);
console.log(sayfaSayisi(a), sayfaSayisi(b), sayfaSayisi(c));
await pdfKapat();
