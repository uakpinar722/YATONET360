import type { PoolClient } from 'pg';

type Db = { query: PoolClient['query'] };

/** İki koordinat arasındaki kuş uçuşu uzaklık (km). */
export const mesafeKm = (a: [number, number], b: [number, number]) => { const r = Math.PI / 180; const x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };

/** Yatın konumu: dosya konumunun eşleştiği bağlama noktasının koordinatı (yoksa null). */
export async function yatKonumu(db: Db, dosya: string): Promise<[number, number] | null> {
  const n = (await db.query(`SELECT n.enlem::float e, n.boylam::float b FROM dosya d JOIN baglama_noktasi n ON n.enlem IS NOT NULL AND d.konum IS NOT NULL AND (lower(d.konum) LIKE '%' || lower(n.ad) || '%' OR lower(n.ad) LIKE '%' || lower(d.konum) || '%') WHERE d.kimlik = $1 ORDER BY length(n.ad) DESC LIMIT 1`, [dosya])).rows[0];
  return n ? [n.e, n.b] : null;
}

/** Firmanın konumu: kayıtlı bağlama noktası, yoksa ilk aktif tesisinin koordinatı. */
export async function firmaKonumu(db: Db, firma: string): Promise<[number, number] | null> {
  const r = (await db.query(`SELECT coalesce(n.enlem, t.enlem)::float e, coalesce(n.boylam, t.boylam)::float b FROM kurulus u LEFT JOIN baglama_noktasi n ON n.kimlik = u.baglama_noktasi_ref
    LEFT JOIN LATERAL (SELECT enlem, boylam FROM firma_tesisi WHERE kurulus_ref = u.kimlik AND aktif AND enlem IS NOT NULL ORDER BY sira LIMIT 1) t ON true WHERE u.kimlik = $1`, [firma])).rows[0];
  return r && r.e != null && r.b != null ? [r.e, r.b] : null;
}
