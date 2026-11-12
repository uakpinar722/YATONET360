import { belgeBagiKaydet } from './belge.js';
import { dosyaErisimi } from './dosya.js';
import { UUID } from './yat.js';

/** YG-606: belge yat, taraf ve ödeme kaydına da bağlanabilir; erişim, kaydın bağlı olduğu dosyalardan birine erişimle verilir. */
const herhangiDosya = async (db: Parameters<typeof dosyaErisimi>[0], k: string, dosyalar: string[]) => { for (const d of dosyalar) if (await dosyaErisimi(db, k, d)) return true; return false; };

belgeBagiKaydet('Yat', async (db, k, id) => {
  if (!UUID.test(id) || !(await db.query(`SELECT 1 FROM yat WHERE kimlik = $1`, [id])).rowCount) return 'yok';
  return (await herhangiDosya(db, k, (await db.query(`SELECT kimlik FROM dosya WHERE yat_ref = $1`, [id])).rows.map((r) => r.kimlik))) ? 'tamam' : 'yetkisiz';
});
belgeBagiKaydet('Taraf', async (db, k, id) => {
  if (!UUID.test(id) || !(await db.query(`SELECT 1 FROM taraf WHERE kimlik = $1`, [id])).rowCount) return 'yok';
  return (await herhangiDosya(db, k, (await db.query(`SELECT DISTINCT dosya_ref FROM dosya_tarafi WHERE taraf_ref = $1`, [id])).rows.map((r) => r.dosya_ref))) ? 'tamam' : 'yetkisiz';
});
belgeBagiKaydet('Ödeme', async (db, k, id) => {
  if (!UUID.test(id)) return 'yok';
  const o = (await db.query(`SELECT dosya_ref FROM odeme_talebi WHERE kimlik = $1`, [id])).rows[0]; if (!o) return 'yok';
  return (await dosyaErisimi(db, k, o.dosya_ref)) ? 'tamam' : 'yetkisiz';
});
