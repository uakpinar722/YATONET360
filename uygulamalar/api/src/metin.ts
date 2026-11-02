import type { Pool, PoolClient } from 'pg';

export type Dil = 'tr' | 'en';

/** YG-680, YG-681: 4.000.000,00 (Türkçe), 4,000,000.00 (İngilizce). Para birimi çağıran tarafta sütun başlığına ya da sona yazılır. */
export function tutar(x: number, dil: Dil = 'tr'): string {
  return x.toLocaleString(dil === 'en' ? 'en-US' : 'tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function gunAy(d: Date | string): string {
  const t = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' }).format(t);
}

/** Köşeli alanları doldurur. Eksik alan sessizce boş bırakılmaz; yanlış belge üretilmesin diye hata verir. */
export function doldur(metin: string, alanlar: Record<string, string>): string {
  const sonuc = metin.replace(/\[([^\]]+)\]/g, (t, ad: string) => {
    if (alanlar[ad] === undefined) throw new Error(`Şablon alanı eksik: ${t}`);
    return alanlar[ad]!;
  });
  return sonuc;
}

/** YG-626: sabit metin onaylı kütüphaneden gelir; en güncel yürürlükteki sürüm kullanılır. */
export async function metinGetir(db: Pool | PoolClient, kod: string, dil: Dil, alanlar: Record<string, string> = {}): Promise<string> {
  const { rows } = await db.query(`SELECT metin FROM sablon_metni WHERE kod = $1 AND dil = $2 AND durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`, [kod, dil]);
  if (!rows[0]) throw new Error(`Onaylı metin bulunamadı: ${kod} (${dil})`);
  return doldur(rows[0].metin, alanlar);
}
