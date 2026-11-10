// ANV-1, YG-367: ana veri TSV'lerini yükler. Varsayılan deneme: sayar ve geri alır. Kalıcı yükleme için --uygula.
// Kullanım: tsx araclar/ana_veri_aktar.ts <dizin> [--uygula]  (dizinde firmalar.tsv ve noktalar.tsv; ana_veri_tsv.py üretir)
// YG-1289, YG-1290: her çalışma doğrulanır ve göç çalışması olarak kaydedilir; gerçek göç iki mutabık deneme olmadan yapılmaz.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { ortamOku } from '../src/ayarlar.js';
import { anaVeriYukle, bolgeYukle, type Satir } from '../src/ana_veri.js';
import { gercekGocEngeli, gocDogrula, gocKaydet, kaynakOzeti } from '../src/goc.js';

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
  const pc = c as unknown as pg.PoolClient; const firmalar = oku(join(dizin, 'firmalar.tsv')); const noktalar = oku(join(dizin, 'noktalar.tsv'));
  const ozet = kaynakOzeti(['firmalar.tsv', 'noktalar.tsv', 'bolgeler.tsv', 'iller.tsv'].map((f) => readFileSync(join(dizin, f), 'utf8')));
  if (uygula) { const e = await gercekGocEngeli(pc, ozet); if (e) throw new Error(e); }
  const s = await anaVeriYukle(pc, { firmalar, noktalar });
  const bl = await bolgeYukle(c as unknown as pg.PoolClient, { bolgeler: oku(join(dizin, 'bolgeler.tsv')), iller: oku(join(dizin, 'iller.tsv')) }); console.log(JSON.stringify(bl));
  const d = await gocDogrula(pc, { firmalar, noktalar }); console.log(JSON.stringify(d.sayi), d.mutabik ? 'MUTABIK' : 'FARK VAR');
  if (uygula) { await gocKaydet(pc, { tur: 'Gerçek', ozet, sonuc: d }); await c.query('COMMIT'); }
  else { await c.query('ROLLBACK'); await gocKaydet(pc, { tur: 'Deneme', ozet, sonuc: d }); }
  console.log(uygula ? 'YÜKLENDİ' : 'DENEME (kaydedilmedi)', JSON.stringify(s));
} catch (h) { await c.query('ROLLBACK'); throw h; } finally { await c.end(); }
