import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Baglam } from './kimlik.js';

/** AK-1a: hassas alanlar alan_erisim_kurali tablosunda; her API yanıtı çıkışta buradan geçer, gizlenen alan rapor veya aramada da açılmaz. */
export interface AlanKurali { alan: string; davranis: 'Gizle' | 'Maskele'; yasak_gruplar: string[]; yalniz_roller: string[] }
type Baglami = { grup: string; roller: string[] };

let onbellek: { zaman: number; kurallar: Map<string, AlanKurali>; db: Pool } | null = null;
export const alanKuraliYenile = () => { onbellek = null; };
async function kurallar(db: Pool) {
  if (onbellek && onbellek.db === db && Date.now() - onbellek.zaman < 60_000) return onbellek.kurallar;
  const m = new Map<string, AlanKurali>(); for (const r of (await db.query(`SELECT alan, davranis, yasak_gruplar, yalniz_roller FROM alan_erisim_kurali`)).rows) m.set(r.alan, r);
  onbellek = { zaman: Date.now(), kurallar: m, db }; return m;
}
const maskele = (v: unknown) => { const s = String(v ?? ''); return s.includes('*') || s.length < 4 ? s : `${'*'.repeat(s.length - 2)}${s.slice(-2)}`; };
/** Kural kişiyi kısıtlıyor mu? Yasak grupta olmak veya gerekli rolün olmaması. */
const kisitli = (k: AlanKurali, b: Baglami) => k.yasak_gruplar.some((g) => b.grup.startsWith(g)) || (k.yalniz_roller.length > 0 && !k.yalniz_roller.some((r) => b.roller.includes(r))) || (k.alan === 'tckn');

export function alanSuz(d: unknown, m: Map<string, AlanKurali>, b: Baglami, derinlik = 0): unknown {
  if (derinlik > 12 || d === null || typeof d !== 'object' || d instanceof Date || Buffer.isBuffer(d)) return d;
  if (Array.isArray(d)) return d.map((x) => alanSuz(x, m, b, derinlik + 1));
  if (typeof (d as { pipe?: unknown }).pipe === 'function') return d;
  const c: Record<string, unknown> = {};
  for (const [a, v] of Object.entries(d as object)) {
    const k = m.get(a);
    if (k && kisitli(k, b)) { if (k.davranis === 'Gizle') continue; c[a] = v === null ? null : maskele(v); continue; }
    c[a] = alanSuz(v, m, b, derinlik + 1);
  }
  return c;
}

export function alanYollari(s: FastifyInstance, b: Baglam) {
  s.addHook('preSerialization', async (i, _y, g) => {
    const o = i.oturum; if (!o || g === null || typeof g !== 'object') return g;
    const roller = (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [o.kullanici])).rows.map((r) => r.rol_adi as string);
    return alanSuz(g, await kurallar(b.db), { grup: o.grup, roller });
  });
  s.get('/alan-erisim', async (i, y) => {
    if (i.oturum?.grup !== 'LGM İç Rolü') return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    return (await b.db.query(`SELECT alan, davranis, aciklama FROM alan_erisim_kurali ORDER BY alan`)).rows;
  });
}
