// YG-1537: katalog kayıtları TSV'sini (katalog_tsv.py üretir) okuyup ana veri modeline bağlanmamış kayıtları aday modellerle teyit listesine alır.
// Kullanım: tsx araclar/katalog_ad_farki.ts <katalog_kayitlari.tsv>
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { ortamOku } from '../src/ayarlar.js';
import { adFarkiYukle } from '../src/katalog_ad_farki.js';

const dosya = process.argv[2]; if (!dosya) throw new Error('TSV dosyasını belirtiniz.');
const [, ...sat] = readFileSync(dosya, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const kayitlar = sat.map(([s, n, a]) => ({ seri: Number(s), no: Number(n), ad: a! }));
const e = ortamOku();
const c = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'yatonet360' });
await c.connect();
try { console.log(JSON.stringify(await adFarkiYukle(c as unknown as pg.PoolClient, kayitlar))); } finally { await c.end(); }
