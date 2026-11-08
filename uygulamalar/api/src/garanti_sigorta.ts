import type { PoolClient } from 'pg';
import type { Baglam } from './kimlik.js';

type Db = PoolClient | Baglam['db'];

/** YG-1421: sigorta portalında garanti yalnız durum olarak görünür; karar, kök neden, firma ve maliyet gösterilmez. */
export async function garantiDurumlari(db: Db, dosyalar: string[]): Promise<Map<string, 'İnceleme Açıldı' | 'İnceleme Kapandı'>> {
  const m = new Map<string, 'İnceleme Açıldı' | 'İnceleme Kapandı'>();
  if (!dosyalar.length) return m;
  const { rows } = await db.query(`SELECT dosya_ref, bool_or(statu <> 'Kapalı') acik FROM garanti_sikayet WHERE dosya_ref = ANY($1::uuid[]) AND 'Garanti bildirimi' = ANY(kayit_turu) GROUP BY dosya_ref`, [dosyalar]);
  for (const r of rows) m.set(r.dosya_ref as string, r.acik ? 'İnceleme Açıldı' : 'İnceleme Kapandı');
  return m;
}

/** YG-1421: geçerli garanti kararından sonra hazırlanan teklif, garanti kapanana dek sigorta şirketine faturalanmaz. */
export async function garantiFaturaEngeli(db: Db, t: { dosya_ref: string; teklif_muhatabi: string; olusturma_zamani: Date | string }): Promise<string | null> {
  if (t.teklif_muhatabi !== 'Sigorta Şirketi') return null;
  const g = await db.query(`SELECT 1 FROM garanti_sikayet WHERE dosya_ref = $1 AND karar = 'Garanti' AND statu <> 'Kapalı' AND coalesce(yanit_zamani, olusturma_zamani) <= $2::timestamptz LIMIT 1`, [t.dosya_ref, t.olusturma_zamani]);
  return g.rowCount ? 'Garanti işi sigorta şirketine faturalanmaz.' : null;
}
