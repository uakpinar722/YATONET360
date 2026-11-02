// Deneme daveti: geliştirme ortamında sentetik hesap açar ve bağlantıyı .araclar\eposta_kutusu.txt dosyasına yazar. Yönetim ekranı sonraki dilimdedir.
// Kullanım: tsx araclar/davet.ts "Ad Soyad" eposta@deneme.yatonet.local "Rol Adı" "Kullanıcı Grubu" [+90555...]
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { KOK, ortamOku } from '../src/ayarlar.js';
import { davetOlustur } from '../src/ilk_giris.js';

const [ad, eposta, rol, grup, telefon] = process.argv.slice(2);
if (!ad || !eposta || !rol || !grup) throw new Error('Kullanım: "Ad Soyad" eposta "Rol Adı" "Kullanıcı Grubu" [telefon]');
if (!eposta.endsWith('@deneme.yatonet.local')) throw new Error('Geliştirme ortamında yalnız sentetik deneme adresi kullanılır (YG-1118).');
const e = ortamOku();
const c = new pg.Client({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: 'yatonet360' });
await c.connect();
const { belirtec } = await davetOlustur(c as never, { adSoyad: ad, eposta, rol, grup, telefon });
await c.end();
const baglanti = `http://127.0.0.1:5173/#davet=${belirtec}`;
appendFileSync(join(KOK, '.araclar', 'eposta_kutusu.txt'), `${new Date().toISOString()} ${eposta} ${baglanti}\n`);
console.log(baglanti);
