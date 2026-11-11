// YG-776: Master Plan takip listesinin ilk aktarımı. Var olan kart değiştirilmez; sonraki güncellemeler YATONET 360 içinden yapılır.
// Kullanım: tsx araclar/master_plan_aktar.ts <kartlar.tsv>  (başlık: islem_no, faz, is_akisi, yapilacak, muhatap, on_kosul, hedef_tarih, siklik, beklenen_cikti, kapanis_kaniti, kabul_makami, baglanti, eski_kart_no)
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { ortamOku } from '../src/ayarlar.js';
import { masterPlanAktar } from '../src/master_plan.js';

const [bas, ...sat] = readFileSync(process.argv[2]!, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const satirlar = sat.map((r) => Object.fromEntries(bas!.map((h, i) => [h, r[i] ?? ''])));
const e = ortamOku();
const db = new pg.Pool({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'yatonet360' });
console.log(`${await masterPlanAktar(db, satirlar)} kart eklendi (${satirlar.length} satır okundu).`);
await db.end();
