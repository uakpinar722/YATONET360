import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;
export const PARA_BIRIMLERI = ['EUR', 'USD', 'GBP'] as const;

/** YG-1356, YG-825, YG-955: verilen tarihte veya öncesindeki son TCMB döviz satış kuru (1 birim = x TL); kayıt yoksa null. */
export async function kurGetir(db: Db, pb: string, tarih: string | Date = new Date()): Promise<{ kur: number; tarih: string; kaynak: string } | null> {
  if (pb === 'TRY' || pb === 'TL') return { kur: 1, tarih: new Date(tarih).toISOString().slice(0, 10), kaynak: 'Sabit' };
  const r = (await db.query(`SELECT satis::float kur, to_char(tarih, 'YYYY-MM-DD') tarih, kaynak FROM doviz_kuru WHERE para_birimi = $1 AND tarih <= $2::date ORDER BY tarih DESC LIMIT 1`, [pb, tarih])).rows[0];
  return r ? { kur: Number(r.kur), tarih: r.tarih, kaynak: r.kaynak } : null;
}

/** YG-825: tutarı verilen tarihteki TCMB satış kurlarıyla (TL üzerinden çapraz) EUR'ya çevirir; kur yoksa null (tutar uydurulmaz). */
export async function eurCevir(db: Db, tutar: number, pb: string, tarih: string | Date = new Date()): Promise<number | null> {
  if (pb === 'EUR') return tutar;
  const k = await kurGetir(db, pb, tarih); const e = await kurGetir(db, 'EUR', tarih);
  if (!k || !e) return null;
  return Math.round((tutar * k.kur / e.kur) * 100) / 100;
}

/** TCMB günlük kur yayınını (today.xml) okur; yayın yoksa veya erişilemezse sessizce geçer, Muhasebe elle girer. */
export function tcmbAyristir(xml: string): { tarih: string; kurlar: { pb: string; alis: number | null; satis: number }[] } | null {
  const t = /Tarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml); if (!t) return null;
  const kurlar: { pb: string; alis: number | null; satis: number }[] = [];
  for (const pb of PARA_BIRIMLERI) {
    const blok = new RegExp(`<Currency[^>]*Kod="${pb}"[\\s\\S]*?</Currency>`).exec(xml)?.[0]; if (!blok) continue;
    const s = Number(/<ForexSelling>([\d.]+)<\/ForexSelling>/.exec(blok)?.[1]); const a = Number(/<ForexBuying>([\d.]+)<\/ForexBuying>/.exec(blok)?.[1]);
    if (s > 0) kurlar.push({ pb, alis: a > 0 ? a : null, satis: s });
  }
  return kurlar.length ? { tarih: `${t[3]}-${t[2]}-${t[1]}`, kurlar } : null;
}

export async function tcmbKurIsle(db: Pool, getir: () => Promise<string> = async () => (await fetch('https://www.tcmb.gov.tr/kurlar/today.xml', { signal: AbortSignal.timeout(15_000) })).text()): Promise<number> {
  let x: ReturnType<typeof tcmbAyristir>;
  try { x = tcmbAyristir(await getir()); } catch { return 0; }
  if (!x) return 0;
  let n = 0;
  for (const k of x.kurlar) n += (await db.query(`INSERT INTO doviz_kuru (tarih, para_birimi, alis, satis, kaynak) VALUES ($1,$2,$3,$4,'TCMB') ON CONFLICT (tarih, para_birimi) DO NOTHING`, [x.tarih, k.pb, k.alis, k.satis])).rowCount ?? 0;
  return n;
}

export function dovizYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  // YG-1356: ana sayfa kur şeridi (bilgi amaçlı); son yayın tarihi ile.
  s.get('/doviz-kurlari', oturumlu, async () => {
    const l = [];
    for (const pb of PARA_BIRIMLERI) { const k = await kurGetir(b.db, pb); if (k) l.push({ pb, ...k }); }
    return l;
  });
  // TCMB yayınına erişilemediğinde Muhasebe ve Finans rolü günün satış kurunu elle girer; TCMB kaydı varsa değiştirilemez.
  s.post('/doviz-kuru', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tarih?: string; pb?: string; satis?: number };
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi LIKE 'Muhasebe ve Finans%'`, [o.kullanici])).rowCount) return y.code(403).send({ hata: 'Kuru Muhasebe ve Finans rolü girer.' });
    if (!g.tarih || !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih) || !PARA_BIRIMLERI.includes(g.pb as never) || !(Number(g.satis) > 0)) return y.code(400).send({ hata: 'Tarih, para birimi ve satış kuru zorunludur.' });
    const r = await b.db.query(`INSERT INTO doviz_kuru (tarih, para_birimi, satis, kaynak, giren_ref) VALUES ($1,$2,$3,'Elle',$4) ON CONFLICT (tarih, para_birimi) DO UPDATE SET satis = EXCLUDED.satis, giren_ref = EXCLUDED.giren_ref, zaman = now() WHERE doviz_kuru.kaynak = 'Elle'`, [g.tarih, g.pb, Number(g.satis), o.kullanici]);
    return r.rowCount ? { tamam: true } : y.code(409).send({ hata: 'Bu tarih için TCMB kuru kayıtlıdır.' });
  });
}
