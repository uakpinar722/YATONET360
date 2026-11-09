// ANV-1, YG-367: ana veri TSV'lerini yükler. Varsayılan deneme: sayar ve geri alır. Kalıcı yükleme için --uygula.
// Kullanım: tsx araclar/ana_veri_aktar.ts <dizin> [--uygula]  (dizinde firmalar.tsv ve noktalar.tsv; ana_veri_tsv.py üretir)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { ortamOku } from '../src/ayarlar.js';
import { anaVeriYukle, type Satir } from '../src/ana_veri.js';

const oku = (p: string): Satir[] => {
  const [bas, ...sat] = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  return sat.map((r) => Object.fromEntries(bas!.map((h, i) => [h, r[i]])));
};
const dizin = process.argv[2]; const uygula = process.argv.includes('--uygula');
if (!dizin) throw new Error('Dizin belirtiniz.');
const e = ortamOku();
const c = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'yatonet360' });
await c.connect();
try {
  await c.query('BEGIN');
  const s = await anaVeriYukle(c as unknown as pg.PoolClient, { firmalar: oku(join(dizin, 'firmalar.tsv')), noktalar: oku(join(dizin, 'noktalar.tsv')) });
  await c.query(uygula ? 'COMMIT' : 'ROLLBACK');
  console.log(uygula ? 'YÜKLENDİ' : 'DENEME (kaydedilmedi)', JSON.stringify(s));
} catch (h) { await c.query('ROLLBACK'); throw h; } finally { await c.end(); }
