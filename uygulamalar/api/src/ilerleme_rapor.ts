import type { Pool, PoolClient } from 'pg';
import { gunAy } from './metin.js';
import { pdfUret, type Bolum } from './pdf.js';

type Db = Pool | PoolClient;

/** YG-460: RP-RAP-001 İlerleme Raporu; dosya ilerlemesi, iş emri durumları ve doğrulanmış ilerleme kayıtları. Firma adı ve maliyet yazılmaz (YG-1167). */
export async function ilerlemeRaporuPdf(db: Db, dosya: string): Promise<{ pdf: Buffer; dosyaAdi: string } | null> {
  const d = (await db.query(`SELECT d.dosya_no, d.asama, d.statu, d.ilerleme_yuzdesi, d.tahmini_teslim_tarihi, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (!d) return null;
  const isler = (await db.query(`SELECT is_emri_no, is_emri_turu, statu FROM is_emri WHERE dosya_ref = $1 AND statu NOT IN ('İptal', 'Yerine Geçti') ORDER BY olusturma_zamani`, [dosya])).rows;
  const kayitlar = (await db.query(`SELECT i.zaman, e.is_emri_no, i.aciklama FROM is_emri_ilerleme i JOIN is_emri e ON e.kimlik = i.is_emri_ref WHERE e.dosya_ref = $1 AND i.dogrulandi ORDER BY i.zaman DESC LIMIT 30`, [dosya])).rows;
  const TUR: Record<string, string> = { KN: 'Keşif', ON: 'Onarım', AC: 'Acil Tedbir' };
  const bolumler: Bolum[] = [
    { baslik: 'Dosya', tur: 'alanlar', alanlar: [{ et: 'Dosya No', deger: d.dosya_no }, { et: 'Yat', deger: d.yat_adi }, { et: 'Aşama', deger: d.asama ?? d.statu }, { et: 'Genel İlerleme', deger: `%${Math.round(Number(d.ilerleme_yuzdesi ?? 0))}` }, { et: 'Tahmini Teslim', deger: d.tahmini_teslim_tarihi ? gunAy(d.tahmini_teslim_tarihi) : '---' }] },
    { baslik: 'İş Emirleri', tur: 'tablo', sutunlar: [{ ad: 'İş Emri No' }, { ad: 'Tür' }, { ad: 'Durum' }], satirlar: isler.length ? isler.map((x) => [x.is_emri_no, TUR[x.is_emri_turu] ?? x.is_emri_turu, x.statu]) : [['---', '---', '---']] },
    { baslik: 'Doğrulanmış İlerleme Kayıtları', tur: 'tablo', sutunlar: [{ ad: 'Tarih' }, { ad: 'İş Emri No' }, { ad: 'Açıklama' }], satirlar: kayitlar.length ? kayitlar.map((x) => [gunAy(x.zaman), x.is_emri_no, x.aciklama]) : [['---', '---', 'Doğrulanmış ilerleme kaydı bulunmamaktadır.']] },
  ];
  const no = `${d.dosya_no}-IR`;
  const pdf = await pdfUret({ ad: 'İlerleme Raporu', kod: 'RP-RAP-001', no, dosyaNo: d.dosya_no, yat: d.yat_adi, tarih: gunAy(new Date()), surum: 'Rev.0', dil: 'tr', rapor: true, bolumler });
  return { pdf, dosyaAdi: `${no}.pdf` };
}
