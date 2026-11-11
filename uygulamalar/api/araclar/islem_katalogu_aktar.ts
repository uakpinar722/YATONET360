// YG-1385, YG-858: LGM-2026-013 branş ve işlem kodlarının ilk aktarımı. Var olan kod değiştirilmez.
// Kullanım: py araclar/islem_katalogu_tsv.py <LGM-2026-013.docx> <kodlar.tsv>; tsx araclar/islem_katalogu_aktar.ts <kodlar.tsv>
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { ortamOku } from '../src/ayarlar.js';
import { katalogAktar } from '../src/islem_katalogu.js';

const [bas, ...sat] = readFileSync(process.argv[2]!, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const satirlar = sat.map((r) => Object.fromEntries(bas!.map((h, i) => [h, r[i] ?? '']))) as { kod: string; duzey: string; ad: string; ust_kod: string }[];
const e = ortamOku();
const db = new pg.Pool({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'yatonet360' });
console.log(`${await katalogAktar(db, satirlar)} kod eklendi (${satirlar.length} satır okundu).`);
await db.end();
