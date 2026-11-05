// Gerçek ortamda tek yedek alır ve sonucu yazar: npx tsx araclar/yedek_dene.ts
import { join } from 'node:path';
import pg from 'pg';
import { KOK, ortamOku } from '../src/ayarlar.js';
import { yedekAl } from '../src/yedek.js';

const e = ortamOku();
const db = new pg.Pool({ host: 'localhost', port: 5432, user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: 'yatonet360' });
const r = await yedekAl(db, 'Dört Saatlik', { veritabani: 'yatonet360', superParola: e.POSTGRES_SUPER_PAROLA!, anahtar: e.YATONET_SIFRELEME_ANAHTARI!, klasor: e.YATONET_YEDEK_KLASORU || join(KOK, '.yedek'), depoKok: e.YATONET_DEPO || join(KOK, '.veri', 'belgeler') });
console.log(JSON.stringify({ tablo: r.tablo, satir: r.satir, belge: r.belge, eksik: r.eksik }));
await db.end();
