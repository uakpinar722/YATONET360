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
export function doldur(metin: string, alanlar: Record<string, string | string[]>): string {
  // Aynı alan metinde birden çok geçiyorsa (BLD-02: [tarih] iki kez) dizi sırayla yazılır.
  const sayac = new Map<string, number>();
  return metin.replace(/\[([^\]]+)\]/g, (t, ad: string) => {
    const v = alanlar[ad];
    if (v === undefined) throw new Error(`Şablon alanı eksik: ${t}`);
    if (typeof v === 'string') return v;
    const n = sayac.get(ad) ?? 0; sayac.set(ad, n + 1);
    return v[Math.min(n, v.length - 1)]!;
  });
}

/** YG-626: sabit metin onaylı kütüphaneden gelir; en güncel yürürlükteki sürüm kullanılır. */
export async function metinGetir(db: Pool | PoolClient, kod: string, dil: Dil, alanlar: Record<string, string | string[]> = {}): Promise<string> {
  const { rows } = await db.query(`SELECT metin FROM sablon_metni WHERE kod = $1 AND dil = $2 AND durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`, [kod, dil]);
  if (!rows[0]) throw new Error(`Onaylı metin bulunamadı: ${kod} (${dil})`);
  return doldur(rows[0].metin, alanlar);
}
