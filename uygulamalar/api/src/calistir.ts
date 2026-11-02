import pg from 'pg';
import { ortamOku } from './ayarlar.js';
import { belgeYururlukIsle } from './belge.js';
import { kuyrukIsle, onayHatirlat } from './bildirim.js';
import { DenemeKutusu, denemeEpostaKutusu } from './sms.js';
import { sunucuKur } from './sunucu.js';

const e = ortamOku();
const db = new pg.Pool({ host: 'localhost', port: 5432, user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: 'yatonet360' });
const s = await sunucuKur({ db, sms: new DenemeKutusu(), eposta: denemeEpostaKutusu(), anahtar: e.YATONET_SIFRELEME_ANAHTARI!, guvenliCerez: e.YATONET_ORTAM === 'uretim', webAdresi: 'http://127.0.0.1:5173' });
await s.listen({ host: '127.0.0.1', port: 3001 });
// YG-523: zamanlanmış işler; hata bir sonraki turu durdurmaz.
const baglam = { db, sms: new DenemeKutusu(), eposta: denemeEpostaKutusu(), anahtar: e.YATONET_SIFRELEME_ANAHTARI!, guvenliCerez: false, webAdresi: 'http://127.0.0.1:5173' };
setInterval(() => { kuyrukIsle(baglam).catch((h) => s.log.error(h.message)); }, 30_000);
setInterval(() => { onayHatirlat(db).catch((h) => s.log.error(h.message)); }, 300_000);
setInterval(() => { belgeYururlukIsle(db).catch((h) => s.log.error(h.message)); }, 3_600_000);
