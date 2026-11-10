import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { acilisKancasi } from './dosya.js';
import { onayMakami, rolSahipleri } from './makam.js';

type Db = Pool | PoolClient;
const SIRA: Record<string, number> = { 'Yönetici': 1, 'Müdür Yardımcısı': 2, 'Müdür': 3, 'Direktör': 4 };

/** YG-1555: rolün üstündeki dolu kademeler (Yönetici, Müdür Yardımcısı, Müdür, bağlı Direktör); boş kademe atlanır. */
export async function silsileUstleri(db: Db, rol: string, dahil = false): Promise<string[]> {
  const r = (await db.query(`SELECT rol_sahibi_birim, kademe FROM rol WHERE kimlik = $1`, [rol])).rows[0]; if (!r) return [];
  const sira = SIRA[r.kademe] ?? 0; const roller: string[] = dahil ? [rol] : [];
  for (const x of (await db.query(`SELECT kimlik, kademe FROM rol WHERE rol_sahibi_birim = $1 AND kimlik <> $2 AND rol_durumu = 'Aktif' AND kademe = ANY($3)`, [r.rol_sahibi_birim, rol, ['Yönetici', 'Müdür Yardımcısı', 'Müdür']])).rows)
    if (SIRA[x.kademe]! > sira) roller.push(x.kimlik);
  if (sira < 4) {
    const mudur = r.kademe === 'Müdür' ? rol : (await db.query(`SELECT kimlik FROM rol WHERE rol_sahibi_birim = $1 AND kademe = 'Müdür' LIMIT 1`, [r.rol_sahibi_birim])).rows[0]?.kimlik;
    const d = mudur ? await onayMakami(db, mudur).catch(() => null) : null;
    if (d && d !== rol) roller.push(d);
  }
  const kisiler = new Set<string>();
  for (const x of roller) for (const k of await rolSahipleri(db, x)) kisiler.add(k);
  return [...kisiler];
}

/** Bilgi bildirimidir, onay adımı değildir. */
export async function silsileBildir(db: Db, rol: string, g: { olay: string; baslik: string; ozet?: string | null; oncelik?: string }, haric: string[] = []): Promise<number> {
  const k = (await silsileUstleri(db, rol)).filter((x) => !haric.includes(x));
  if (k.length) await bildir(db, { olay: g.olay, kullanicilar: k, baslik: g.baslik, ozet: g.ozet ?? null, oncelik: g.oncelik });
  return k.length;
}

// YG-1555: yeni dosyada Normal ve Planlı öncelikte Operasyon Yöneticisi ve Teknik Yöneticiye; Kritik ve Yüksekte iki silsilenin tamamına bilgi.
acilisKancasi(async (c, dosya, _web, yapan) => {
  const d = (await c.query(`SELECT dosya_no, oncelik, kisa_teknik_tanim FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]; if (!d) return;
  const rol = async (ad: string) => (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0]?.kimlik as string | undefined;
  const oy = await rol('Operasyon Yöneticisi'); const ty = await rol('Teknik Yönetici');
  const kisiler = new Set<string>();
  for (const r of [oy, ty]) if (r) {
    for (const k of await rolSahipleri(c, r)) kisiler.add(k);
    if (d.oncelik === 'Kritik' || d.oncelik === 'Yüksek') for (const k of await silsileUstleri(c, r)) kisiler.add(k);
  }
  kisiler.delete(yapan);
  if (kisiler.size) await bildir(c, { olay: `yeni-dosya-bilgi:${dosya}`, kullanicilar: [...kisiler], baslik: `Yeni Dosya: ${d.dosya_no}`, ozet: d.kisa_teknik_tanim ? String(d.kisa_teknik_tanim).slice(0, 120) : null, oncelik: d.oncelik });
});
