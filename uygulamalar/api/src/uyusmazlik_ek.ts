import type { Pool, PoolClient } from 'pg';
import type { Bolum } from './pdf.js';

type Db = Pool | PoolClient;
const zaman = (s: unknown) => (s ? new Date(String(s)).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' }) : '-');

/**
 * YG-107: uyuşmazlık paketinde onayın kanıtı (onaylayan, kanal, zaman, metin özeti), dosyaya giden SMS ve e-posta metinleri
 * ve dosya belgelerinin bütünlük özeti (SHA-256) paketin içinde yer alır; belgenin aslının pakettekiyle aynı olduğu bu özetle doğrulanır.
 */
export async function uyusmazlikEkBolumleri(db: Db, dosya: string): Promise<Bolum[]> {
  const q = (s: string, p: unknown[] = [dosya]) => db.query(s, p).then((r) => r.rows);
  const onay = await q(`SELECT t.ony_kod, k.karar, k.onaylayan_ad, k.kanal, k.onay_zamani, k.metin_ozeti FROM yatonet_onay_kaydi k JOIN onay_talebi t ON t.kimlik = k.onay_talebi_ref WHERE t.dosya_ref = $1 ORDER BY k.onay_zamani`);
  const kimlikler = (await q(`SELECT $1::text AS k UNION SELECT talep_ref::text FROM dosya WHERE kimlik = $1::uuid AND talep_ref IS NOT NULL
    UNION SELECT kimlik::text FROM fiyat_teklifi WHERE dosya_ref = $1::uuid UNION SELECT kimlik::text FROM onay_talebi WHERE dosya_ref = $1::uuid UNION SELECT kimlik::text FROM teslim_kaydi WHERE dosya_ref = $1::uuid UNION SELECT kimlik::text FROM musteri_faturasi WHERE dosya_ref = $1::uuid`)).map((r) => r.k as string);
  const ileti = await q(`SELECT kanal, hedef, konu, metin, durum, gonderim_zamani, olusturma_zamani FROM gonderim WHERE olay_anahtari ~ $1 ORDER BY olusturma_zamani LIMIT 300`, [`(${kimlikler.join('|')})`]);
  const belge = await q(`SELECT e.ad, s.surum_no, s.ozet_sha256 FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik WHERE e.bag_turu = 'Dosya' AND e.bag_kimligi = $1::text ORDER BY e.belge_tarihi, s.surum_no`);
  return [
    { baslik: 'Onay Kanıtları', tur: 'tablo', sutunlar: [{ ad: 'Onay' }, { ad: 'Karar' }, { ad: 'Onaylayan' }, { ad: 'Kanal' }, { ad: 'Zaman' }, { ad: 'Metin Özeti (SHA-256)' }], satirlar: onay.map((x) => [x.ony_kod, x.karar, x.onaylayan_ad, x.kanal, zaman(x.onay_zamani), String(x.metin_ozeti).slice(0, 16)]) },
    { baslik: 'Gönderilen İletiler', tur: 'tablo', sutunlar: [{ ad: 'Kanal' }, { ad: 'Alıcı' }, { ad: 'Konu ve Metin' }, { ad: 'Durum' }, { ad: 'Zaman' }], satirlar: ileti.map((x) => [x.kanal, x.hedef, `${x.konu}: ${String(x.metin).slice(0, 500)}`, x.durum, zaman(x.gonderim_zamani ?? x.olusturma_zamani)]) },
    { baslik: 'Belge Bütünlük Özetleri', tur: 'tablo', sutunlar: [{ ad: 'Belge' }, { ad: 'Sürüm', hiza: 'ort' }, { ad: 'SHA-256' }], satirlar: belge.map((x) => [x.ad, x.surum_no, x.ozet_sha256]) },
  ];
}
