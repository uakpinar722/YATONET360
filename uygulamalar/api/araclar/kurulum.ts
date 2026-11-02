// Geliştirme ortamını kurar: gizli değerler, veritabanı, göçler, başlangıç verisi, deneme hesapları. Tekrar çalıştırılabilir.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import pg from 'pg';
import { ENV_YOLU, KOK, ortamOku } from '../src/ayarlar.js';
import { parolaOzetle } from '../src/parola.js';

export const AYRICALIKLI = new Set(['Sistem Yöneticisi']);

function kademeBul(ad: string) {
  if (['CEO', 'CEO Asistanı', 'Genel Müdür Yardımcısı'].includes(ad)) return ad;
  for (const [son, k] of [['Direktörü', 'Direktör'], ['Müdür Yardımcısı', 'Müdür Yardımcısı'], ['Müdürü', 'Müdür'], ['Müdür', 'Müdür'], ['Yöneticisi', 'Yönetici'], ['Yönetici', 'Yönetici']] as const) {
    if (ad === 'Sistem Yöneticisi') return 'Sistem Yöneticisi';
    if (ad.endsWith(son)) return k;
  }
  const ozel: Record<string, string> = { 'Dosya Sorumlusu': 'Dosya Sorumlusu', 'Saha Sorumlusu': 'Saha Sorumlusu', 'Tedarik Sorumlusu': 'Tedarik Sorumlusu', 'Sicil Sorumlusu': 'Sicil Sorumlusu', 'Bilgi İşlem Destek Sorumlusu': 'Destek Sorumlusu', 'İç Denetçi': 'Denetçi', 'Teknik Uzman': 'Uzman', 'Kalite Uzmanı (Kalite Kontrolör)': 'Kalite Uzmanı', 'İSG Uzmanı': 'İSG Sorumlusu', 'Hukuk ve Uyum Uzmanı': 'Hukuk ve Uyum Uzmanı' };
  return ozel[ad] ?? 'Sorumlu';
}

const DIS_ROLLER: [string, string, string][] = [ // YG-1030, YG-1025
  ['Firma Yetkilisi', 'Dış Kullanıcı', 'İş Birliği Firması'],
  ['Müşteri Portal Kullanıcısı', 'Dış Kullanıcı', 'Bireysel Müşteri (Yat Sahibi/Yetkilisi)'],
  ['Kurumsal Müşteri Kullanıcısı', 'Dış Kullanıcı', 'Kurumsal Müşteri'],
  ['Sigorta Şirketi Kullanıcısı', 'Dış Kullanıcı', 'Sigorta Şirketi / Eksper'],
  ['Broker, Acente, Yat Brokeri, Kaptan', 'Dış Kullanıcı', 'Broker, Acente, Yat Brokeri, Kaptan'],
  ['Tesis Yetkilisi', 'Dış Kullanıcı', 'Tesis Yetkilisi (Marina, Tersane, Çekek Sahası)'],
  ['Tedarikçi Kullanıcısı', 'Dış Kullanıcı', 'Tedarikçi'],
  ['Muhasebe Hizmeti', 'Dış Kullanıcı', 'Muhasebe Hizmeti'],
];

// Yetki matrisinin başlangıcı. İzinler modüller yazıldıkça eklenir (YG-996).
const IZINLER: [string, string][] = [
  ['Sistem Yöneticisi', 'rol_katalogu.goruntule'], ['Bilgi İşlem Müdürü', 'rol_katalogu.goruntule'], ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'rol_katalogu.goruntule'],
  ['Sistem Yöneticisi', 'erisim.uygula'], // A33-2
  ['Bilgi İşlem Destek Sorumlusu', 'hesap_kurtarma.ac'], // A32-3
  ['İç Denetçi', 'denetim_izi.goruntule'], ['İç Denetim Müdürü', 'denetim_izi.goruntule'], ['Bilgi İşlem Müdürü', 'denetim_izi.goruntule'],
];

export async function kurVeritabani(ad: string, ayar: { superParola: string; uygulamaParola: string; denemeHesap: boolean }) {
  const bag = (database: string) => new pg.Client({ host: 'localhost', port: 5432, user: 'postgres', password: ayar.superParola, database });
  const a = bag('postgres'); await a.connect();
  const rol = await a.query(`SELECT 1 FROM pg_roles WHERE rolname = 'yatonet_uygulama'`);
  const parola = `'${ayar.uygulamaParola.replace(/'/g, "''")}'`;
  await a.query(rol.rowCount ? `ALTER ROLE yatonet_uygulama LOGIN PASSWORD ${parola}` : `CREATE ROLE yatonet_uygulama LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${parola}`);
  if (!(await a.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [ad])).rowCount) await a.query(`CREATE DATABASE "${ad}"`);
  await a.end();
  const c = bag(ad); await c.connect();
  await c.query(`CREATE TABLE IF NOT EXISTS sema_gocu (dosya text PRIMARY KEY, uygulama_zamani timestamptz NOT NULL DEFAULT now())`);
  const klasor = join(KOK, 'veritabani', 'gocler');
  for (const f of readdirSync(klasor).filter((x) => x.endsWith('.sql')).sort()) {
    if ((await c.query(`SELECT 1 FROM sema_gocu WHERE dosya = $1`, [f])).rowCount) continue;
    await c.query('BEGIN');
    try { await c.query(readFileSync(join(klasor, f), 'utf8')); await c.query(`INSERT INTO sema_gocu (dosya) VALUES ($1)`, [f]); await c.query('COMMIT'); console.log('göç uygulandı:', f); }
    catch (e) { await c.query('ROLLBACK'); throw e; }
  }
  // Değer listeleri (YG-1124)
  const dl = readFileSync(join(KOK, 'veri', 'deger_listeleri.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
  await c.query('BEGIN');
  for (const d of dl) await c.query(`INSERT INTO deger_listesi VALUES ($1,$2,$3,$4,$5) ON CONFLICT (liste_kodu, deger) DO UPDATE SET aciklama = EXCLUDED.aciklama, kaynak = EXCLUDED.kaynak, sira = EXCLUDED.sira`, [d[0], d[1], d[2] || null, d[3] || null, Number(d[4])]);
  // Roller
  const ic = readFileSync(join(KOK, 'veri', 'roller.tsv'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t') as [string, string]);
  let n = 0;
  for (const [adi, birim] of ic) await c.query(`INSERT INTO rol (kimlik, rol_adi, rol_sahibi_birim, kademe, kullanici_gruplari, ayricalikli_rol) VALUES ($1,$2,$3,$4,'LGM İç Rolü',$5) ON CONFLICT (rol_adi) DO UPDATE SET rol_sahibi_birim = EXCLUDED.rol_sahibi_birim, kademe = EXCLUDED.kademe`, [`ROL-${String(++n).padStart(3, '0')}`, adi, birim, kademeBul(adi), AYRICALIKLI.has(adi)]);
  for (const [adi, birim, grup] of DIS_ROLLER) await c.query(`INSERT INTO rol (kimlik, rol_adi, rol_sahibi_birim, kademe, kullanici_gruplari) VALUES ($1,$2,$3,'Dış Kullanıcı',$4) ON CONFLICT (rol_adi) DO NOTHING`, [`ROL-${String(++n).padStart(3, '0')}`, adi, birim, grup]);
  for (const [adi, izin] of IZINLER) await c.query(`INSERT INTO rol_izni SELECT kimlik, $2 FROM rol WHERE rol_adi = $1 ON CONFLICT DO NOTHING`, [adi, izin]);
  // Hukuki metinler (R\KVKK onaylı belgelerden aktarılır)
  const mk = join(KOK, 'veri', 'metinler');
  for (const f of readdirSync(mk).filter((x) => x.endsWith('.json'))) {
    const m = JSON.parse(readFileSync(join(mk, f), 'utf8'));
    await c.query(`INSERT INTO hukuki_metin (kod, dil, surum, baslik, govde) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (kod, dil, surum) DO UPDATE SET baslik = EXCLUDED.baslik, govde = EXCLUDED.govde`, [m.kod, m.dil, m.surum, m.baslik, JSON.stringify(m.govde)]);
  }
  await c.query('COMMIT');
  console.log(`${dl.length} değer, ${n} rol yüklendi`);
  return c;
}

/** YG-1118: yalnız sentetik deneme hesapları. Gerçek kişi verisi kullanılmaz. */
const DENEME: [string, string, string, string, string, string, boolean][] = [
  ['Deneme CEO', 'ceo@deneme.yatonet.local', '+905550000001', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'CEO', false],
  ['Deneme Sistem Yöneticisi', 'sistem@deneme.yatonet.local', '+905550000002', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'Sistem Yöneticisi', true],
  ['Deneme İç Denetçi', 'denetci@deneme.yatonet.local', '+905550000003', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'İç Denetçi', false],
  ['Deneme Bilgi İşlem Müdürü', 'bimuduru@deneme.yatonet.local', '+905550000005', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'Bilgi İşlem Müdürü', false],
  ['Deneme Destek Sorumlusu', 'destek@deneme.yatonet.local', '+905550000006', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'Bilgi İşlem Destek Sorumlusu', false],
  ['Deneme Sicil Sorumlusu', 'sicil@deneme.yatonet.local', '+905550000007', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'Sicil Sorumlusu', false],
  ['Deneme Firma Yetkilisi', 'firma@deneme.yatonet.local', '+905550000008', 'İş Birliği Firması', 'Doğrulama uygulaması (6 haneli kod)', 'Firma Yetkilisi', false],
  ['Deneme Yat Sahibi', 'yatsahibi@deneme.yatonet.local', '+905550000004', 'Bireysel Müşteri (Yat Sahibi/Yetkilisi)', 'SMS kodu', 'Müşteri Portal Kullanıcısı', false],
];

export async function denemeHesaplari(c: pg.Client, dosya: string | null) {
  const satirlar: string[] = [];
  for (const [ad, ep, tel, grup, yontem, rol, ayr] of DENEME) {
    if ((await c.query(`SELECT 1 FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rowCount) continue;
    const parola = 'Deneme-' + randomBytes(9).toString('base64url');
    const { rows } = await c.query(
      `INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, parola_ozeti, dogrulama_yontemi, ayricalikli_mi)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8) RETURNING kimlik`,
      [grup === 'LGM İç Rolü' ? 'İç Kullanıcı' : 'Müşteri/Kurum', grup, ad, ep, tel, await parolaOzetle(parola), yontem, ayr]);
    await c.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [rows[0].kimlik, rol]);
    satirlar.push(`${rol}\t${ep}\t${parola}`);
  }
  if (dosya && satirlar.length) { appendFileSync(dosya, satirlar.join('\n') + '\n', 'utf8'); console.log('deneme hesapları yazıldı:', dosya); }
  return satirlar;
}

if (process.argv[1]?.endsWith('kurulum.ts')) {
  const e = ortamOku();
  const ekle = (k: string, v: string) => { if (!e[k]) { appendFileSync(ENV_YOLU, `${k}=${v}\n`, 'ascii'); e[k] = v; } };
  if (!existsSync(ENV_YOLU)) writeFileSync(ENV_YOLU, '');
  ekle('YATONET_DB_PAROLA', randomBytes(24).toString('base64url'));
  ekle('YATONET_SIFRELEME_ANAHTARI', randomBytes(32).toString('hex'));
  ekle('YATONET_ORTAM', 'gelistirme');
  const c = await kurVeritabani('yatonet360', { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: true });
  await denemeHesaplari(c, join(KOK, '.araclar', 'deneme_hesaplari.txt'));
  await c.end();
}
