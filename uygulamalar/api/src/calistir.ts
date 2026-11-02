import pg from 'pg';
import { ortamOku } from './ayarlar.js';
import { DenemeKutusu, denemeEpostaKutusu } from './sms.js';
import { sunucuKur } from './sunucu.js';

const e = ortamOku();
const db = new pg.Pool({ host: 'localhost', port: 5432, user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: 'yatonet360' });
const s = await sunucuKur({ db, sms: new DenemeKutusu(), eposta: denemeEpostaKutusu(), anahtar: e.YATONET_SIFRELEME_ANAHTARI!, guvenliCerez: e.YATONET_ORTAM === 'uretim', webAdresi: 'http://127.0.0.1:5173' });
await s.listen({ host: '127.0.0.1', port: 3001 });
