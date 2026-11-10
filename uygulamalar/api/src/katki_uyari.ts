import type { Pool, PoolClient } from 'pg';
import { birKez } from './bildirim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { dosyaButcesi } from './risk_rezervi.js';

type Db = Pool | PoolClient;
const ONAY = `('Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü')`;
/** YG-782: bitiş tahminindeki brüt katkı, onaylı tekliflerin kartela katkısının 5 puan altına düşerse erken uyarı. */
export const KATKI_ESIK_PUAN = 5;
const v = (x: number) => String(x).replace('.', ',');

export async function katkiDurumu(db: Db, dosya: string) {
  const gelir = Number((await db.query(`SELECT coalesce(sum(k.tutar_eur), 0) t FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref WHERE f.dosya_ref = $1 AND k.onay_durumu = 'Onaylandı' AND f.statu = 'Karar' AND f.karar IN ${ONAY}`, [dosya])).rows[0].t);
  const v = await dosyaButcesi(db, dosya);
  if (!(gelir > 0) || !(v.guncelButce > 0)) return null;
  const planli = (gelir - v.guncelButce) / gelir * 100;
  const maliyet = Math.max(v.bitisTahmini, v.guncelButce); // taahhüde girmemiş kalem bütçesiyle sayılır
  const tahmin = (gelir - maliyet) / gelir * 100;
  return { gelir, planli: Math.round(planli * 10) / 10, tahmin: Math.round(tahmin * 10) / 10, dusus: Math.round((planli - tahmin) * 10) / 10 };
}

export async function katkiUyariKontrol(db: Db, dosya: string, dosyaNo: string): Promise<boolean> {
  const k = await katkiDurumu(db, dosya);
  if (!k || k.dusus < KATKI_ESIK_PUAN || !(await birKez(db, 'katki_uyari', dosya))) return false;
  await kartAc(db, { tur: 'Bütçe Erken Uyarısı', kategori: 'gorev', baslik: `${dosyaNo} · Brüt Katkı Erken Uyarısı`, ozet: `Bitiş tahminindeki brüt katkı %${v(k.tahmin)}; kartela katkısı %${v(k.planli)} (${v(k.dusus)} puan düşüş).`, oncelik: 'Yüksek', sahipRol: await rolId(db, 'Teknik ve Operasyon Direktörü'), nesneTuru: 'Dosya', nesneKimligi: dosya });
  return true;
}

export async function katkiIzle(db: Pool): Promise<number> {
  let n = 0;
  for (const d of (await db.query(`SELECT DISTINCT d.kimlik, d.dosya_no FROM dosya d JOIN fiyat_teklifi f ON f.dosya_ref = d.kimlik WHERE d.statu NOT IN ('Kapalı', 'Teknik Kapalı') AND f.statu = 'Karar' AND f.karar IN ${ONAY}`)).rows) if (await katkiUyariKontrol(db, d.kimlik, d.dosya_no)) n++;
  return n;
}
