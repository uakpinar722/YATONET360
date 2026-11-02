// Geliştirme ortamı: ortak Bugün ekranını görmek için sentetik kartlar, duyuru ve Bilgi İşlem Müdürü deneme hesabı açar. Üretimde çalışmaz.
import pg from 'pg';
import { ortamOku } from '../src/ayarlar.js';
import { kartAc } from '../src/is_motoru.js';

const e = ortamOku();
if (e.YATONET_ORTAM === 'uretim') throw new Error('Üretimde çalışmaz');
const c = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'yatonet360' });
await c.connect();
const rol = async (ad: string) => (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
const kisi = async (ep: string) => (await c.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rows[0].kimlik as string;
const sys = await kisi('sistem@deneme.yatonet.local'); const ceo = await kisi('ceo@deneme.yatonet.local');
const saat = (n: number) => new Date(Date.now() + n * 3_600_000);
await kartAc(c as never, { tur: 'Deneme', baslik: 'Deneme Onay Talebi · İki Kademe', ozet: 'Sentetik kayıt: İç Denetçi kontrol eder, CEO son kararı verir.', hazirlayan: sys, zincir: [await rol('İç Denetçi'), await rol('CEO')], sonZaman: saat(30), oncelik: 'Yüksek' });
await kartAc(c as never, { tur: 'Deneme', baslik: 'Deneme Onay Talebi · Tek Kademe', ozet: 'Sentetik kayıt: CEO doğrudan karar verir.', hazirlayan: sys, zincir: [await rol('CEO')], sonZaman: saat(150) });
await kartAc(c as never, { tur: 'Deneme', baslik: 'Deneme İşlem Kartı', ozet: 'Sentetik kayıt: yapılınca "Tamamlandı" işaretlenir.', sahipKullanici: ceo, sonZaman: saat(4), oncelik: 'Kritik' });
await kartAc(c as never, { tur: 'Deneme', kategori: 'gorev', baslik: 'Deneme Periyodik Görev', ozet: 'Sentetik kayıt.', sahipKullanici: ceo });
await c.query(`INSERT INTO duyuru (baslik, govde, zorunlu, kapsam) VALUES ('Deneme Zorunlu Duyuru', 'Sentetik duyuru metni; okuduğunuzu işaretleyiniz.', true, 'Tümü'), ('Deneme Duyuru', 'Sentetik bilgilendirme.', false, 'LGM')`);
await c.end();
console.log('deneme kartları açıldı');
