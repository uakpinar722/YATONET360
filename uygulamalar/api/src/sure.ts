import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;
const TZ = 180 * 60_000; // Türkiye UTC+3, yaz saati uygulanmaz.
const yerel = (d: Date) => new Date(d.getTime() + TZ);
const gunAnahtari = (y: Date) => y.toISOString().slice(0, 10);

export const SURE_SAAT: Record<string, Partial<Record<string, number>>> = {
  // YG-040, YG-144
  'İlk Yanıt': { Kritik: 0.5, Yüksek: 2, Normal: 4, Planlı: 8 },
  // YG-041
  'Teknik Uzman Ataması': { Kritik: 1, Yüksek: 4, Normal: 24, Planlı: 48 },
  // YG-044: Kritikte keşif randevusu süresi yoktur.
  'Randevu İletişimi': { Yüksek: 24, Normal: 72, Planlı: 120 },
  // YG-042: Kritikte keşif süresi yoktur; acil tedbir için sahaya ulaşma 4 saat.
  Keşif: { Yüksek: 48, Normal: 72, Planlı: 120 },
  'Sahaya Ulaşma': { Kritik: 4 },
  // YG-043
  Teklif: { Yüksek: 48, Normal: 72, Planlı: 120 },
};

/** YG-042: saha merkezine 150 km'den uzak noktada en az 4 saat; 250 km'den sonra başlayan her 100 km için ayrıca 1,5 saat. */
export function mesafeEki(km: number | null | undefined): number {
  if (!km || km <= 150) return 0;
  return 4 + (km > 250 ? Math.ceil((km - 250) / 100) * 1.5 : 0);
}

/**
 * YG-1607: saatle izlenen sürenin son anı pazar, resmî tatil veya 22:00–08:00 arasına düşerse ilk çalışma günü 12:00'a kayar.
 * Acil evredeki Kritik süreler 7/24 işler, kaymaz.
 */
export function bitisKaydir(bitis: Date, oncelik: string, tatiller: Set<string> = new Set(), arifeler: Set<string> = new Set()): { bitis: Date; not: string | null } {
  if (oncelik === 'Kritik') return { bitis, not: null };
  const y = yerel(bitis); const saat = y.getUTCHours();
  const calisma = (g: Date) => g.getUTCDay() !== 0 && !tatiller.has(gunAnahtari(g));
  // YG-1472: arife yarım gündür; öğleden sonraya düşen bitiş ilk çalışma günü 12:00'a kayar.
  if (calisma(y) && saat >= 8 && saat < (arifeler.has(gunAnahtari(y)) ? 12 : 22)) return { bitis, not: null };
  const arifeOgle = calisma(y) && arifeler.has(gunAnahtari(y)) && saat >= 12 && saat < 22;
  const g = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate(), 12));
  // Gece yarısından önceki geç saat ertesi güne, sabahın erken saati aynı güne kayar.
  if (saat >= 22 || arifeOgle) g.setUTCDate(g.getUTCDate() + 1);
  while (!calisma(g)) g.setUTCDate(g.getUTCDate() + 1);
  const ad = (d: Date) => d.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'UTC' });
  return { bitis: new Date(g.getTime() - TZ), not: `Kaydırıldı: ${ad(y)} → ${ad(g)} 12:00` };
}

export async function tatilGunleri(db: Db, arife = false): Promise<Set<string>> {
  return new Set((await db.query(`SELECT to_char(tarih, 'YYYY-MM-DD') t FROM resmi_tatil WHERE yarim_gun = $1`, [arife])).rows.map((r) => r.t as string));
}

/** Sayacı başlatır; aynı tür ikinci kez başlamaz. Önceliğe göre süre tanımı yoksa sayaç açılmaz. */
export async function sureBaslat(db: Db, g: { tur: string; oncelik: string; baslangic: Date; dosya?: string; talep?: string; km?: number | null }): Promise<void> {
  const saat = SURE_SAAT[g.tur]?.[g.oncelik];
  if (saat === undefined) return;
  const ham = new Date(g.baslangic.getTime() + (saat + (g.tur === 'Keşif' || g.tur === 'Sahaya Ulaşma' ? mesafeEki(g.km) : 0)) * 3_600_000);
  const { bitis, not } = bitisKaydir(ham, g.oncelik, await tatilGunleri(db), await tatilGunleri(db, true));
  await db.query(`INSERT INTO dosya_sure (dosya_ref, talep_ref, tur, baslangic, bitis, kaydirma_notu) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [g.dosya ?? null, g.talep ?? null, g.tur, g.baslangic, bitis, not]);
}

export async function sureBitir(db: Db, g: { tur: string; dosya?: string; talep?: string }, zaman = new Date()): Promise<void> {
  await db.query(`UPDATE dosya_sure SET tamamlanma = $1 WHERE tur = $2 AND tamamlanma IS NULL AND (dosya_ref = $3 OR talep_ref = $4)`, [zaman, g.tur, g.dosya ?? null, g.talep ?? null]);
}

/** YG-046, YG-1491: sayaç durduran Beklemede süresi kadar bitiş ileri gider. */
export const DURAK_SN = `coalesce((SELECT sum(extract(epoch FROM (coalesce(k.kaldirilma_zamani, now()) - greatest(k.olusturma_zamani, s.baslangic)))) FROM beklemede_isareti k WHERE k.dosya_ref = s.dosya_ref AND k.sayac_durur), 0)`;

/** Renk: kalan süre toplam sürenin dörtte birine inince sarı, aşınca kırmızı. */
export function sureRengi(baslangic: Date, bitis: Date, simdi = new Date()): 'yeşil' | 'sarı' | 'kırmızı' {
  const kalan = bitis.getTime() - simdi.getTime();
  if (kalan < 0) return 'kırmızı';
  return kalan <= (bitis.getTime() - baslangic.getTime()) / 4 ? 'sarı' : 'yeşil';
}

/** YG-006: LGM-YYYY-AA-NNNN; işlemle birlikte geri alınır, bu yüzden boşluk kalmaz. İptal edilen numara yeniden kullanılmaz. */
export async function talepNumarasi(c: PoolClient, simdi = new Date()): Promise<string> {
  const y = yerel(simdi); const ay = `${y.getUTCFullYear()}-${String(y.getUTCMonth() + 1).padStart(2, '0')}`;
  return `LGM-${ay}-${String(await sayac(c, `dosya:${ay}`)).padStart(4, '0')}`;
}

export async function sayac(c: Db, anahtar: string): Promise<number> {
  return (await c.query(`INSERT INTO numara_sayaci VALUES ($1, 1) ON CONFLICT (anahtar) DO UPDATE SET son = numara_sayaci.son + 1 RETURNING son`, [anahtar])).rows[0].son;
}

/** YG-008: dosyaya bağlı kayıt numarası (ör. LGM-2026-10-0001-TK01). */
export async function altNumara(c: Db, dosyaNo: string, ek: string, hane = 2): Promise<string> {
  return `${dosyaNo}-${ek}${String(await sayac(c, `${dosyaNo}:${ek}`)).padStart(hane, '0')}`;
}
