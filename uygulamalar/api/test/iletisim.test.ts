import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { bildir, kuyrukIsle, mesaiIcinde, onayHatirlat, sonrakiMesai } from '../src/bildirim.js';
import { kartAc } from '../src/is_motoru.js';
import type { Baglam } from '../src/kimlik.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';

const VT = 'yatonet360_test8'; const PAROLA = 'Sinama-Parolasi-2026!'; const D = '@deneme.yatonet.local';
const CEO = 'ceo' + D, BIM = 'bimuduru' + D, DES = 'destek' + D, SIS = 'sistem' + D, YAT = 'yatsahibi' + D, FIR = 'firma' + D;
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool; let bag: Baglam;
const sms = new DenemeKutusu(null), posta = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const ckr = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: { [COOKIE_ADI]: c }, payload });
const K: Record<string, string> = {}; const oturum: Record<string, string> = {};
// 03.11.2026 Salı 14:00 TSİ = 11:00 UTC
const SALI = new Date('2026-11-03T11:00:00Z'), GECE = new Date('2026-11-03T20:00:00Z');

async function gir(ep: string) {
  if (oturum[ep]) return oturum[ep]!;
  const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: ep, parola: PAROLA } });
  const c = ckr(g);
  if (g.json().yontem === 'sms') { await ist('POST', '/api/kimlik/sms', c); return (oturum[ep] = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0] }))); }
  const q = await ist('GET', '/api/kimlik/kurulum', c);
  return (oturum[ep] = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) })));
}

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [await parolaOzetle(PAROLA)]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' WHEN kullanici_grubu = 'İş Birliği Firması' THEN 'KVKK-03' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  for (const ep of [CEO, BIM, DES, SIS, YAT, FIR]) K[ep] = (await sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rows[0].kimlik;
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  bag = { db, sms, eposta: posta, anahtar: 'ee'.repeat(32), guvenliCerez: false, webAdresi: 'http://x' };
  s = await sunucuKur(bag);
});
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });
beforeEach(async () => { posta.gidenler.length = 0; await sup.query(`UPDATE gonderim SET durum = 'Gönderildi' WHERE durum = 'Bekliyor'`); });

describe('mesai kuralı (YG-521)', () => {
  it('mesai sınırları', () => {
    expect(mesaiIcinde(SALI)).toBe(true); expect(mesaiIcinde(GECE)).toBe(false);
    expect(mesaiIcinde(new Date('2026-11-07T10:00:00Z'))).toBe(true);  // Cumartesi 13:00
    expect(mesaiIcinde(new Date('2026-11-07T13:00:00Z'))).toBe(false); // Cumartesi 16:00
    expect(mesaiIcinde(new Date('2026-11-08T09:00:00Z'))).toBe(false); // Pazar
  });
  it('sonraki iş günü 09:00', () => {
    expect(sonrakiMesai(GECE).toISOString()).toBe('2026-11-04T06:00:00.000Z');
    expect(sonrakiMesai(new Date('2026-11-03T03:00:00Z')).toISOString()).toBe('2026-11-03T06:00:00.000Z'); // sabah 06:00 → aynı gün
    expect(sonrakiMesai(new Date('2026-11-07T14:00:00Z')).toISOString()).toBe('2026-11-09T06:00:00.000Z'); // Cumartesi akşam → Pazartesi
    expect(sonrakiMesai(SALI)).toBe(SALI);
  });
});

describe('bildirim kuyruğu (YG-507…YG-513)', () => {
  it('aynı olay iki kez gitmez; sistem içi anında, e-posta kuyruktan', async () => {
    await bildir(db, { olay: 'o1', kullanicilar: [K[CEO]!, K[CEO]!], baslik: 'B', eposta: true }, SALI);
    await bildir(db, { olay: 'o1', kullanicilar: [K[CEO]!], baslik: 'B', eposta: true }, SALI);
    expect((await sup.query(`SELECT count(*)::int n FROM bildirim WHERE olay_anahtari = 'o1'`)).rows[0].n).toBe(1);
    expect(posta.gidenler).toHaveLength(0);
    expect(await kuyrukIsle(bag, SALI)).toBeGreaterThanOrEqual(1);
    expect(posta.gidenler).toHaveLength(1);
    expect(await kuyrukIsle(bag, SALI)).toBe(0);
    expect((await sup.query(`SELECT durum FROM gonderim WHERE olay_anahtari = 'o1'`)).rows[0].durum).toBe('Gönderildi');
  });
  it('mesai dışında olağan bildirim bekler, Kritik hemen çıkar', async () => {
    await bildir(db, { olay: 'gece-normal', kullanicilar: [K[CEO]!], baslik: 'N', eposta: true }, GECE);
    await bildir(db, { olay: 'gece-kritik', kullanicilar: [K[CEO]!], baslik: 'K', oncelik: 'Kritik', eposta: true }, GECE);
    await kuyrukIsle(bag, GECE);
    expect(posta.gidenler.map((g) => g.metin)).toEqual(['K']);
    await kuyrukIsle(bag, new Date('2026-11-04T06:00:01Z'));
    expect(posta.gidenler.map((g) => g.metin)).toEqual(['K', 'N']);
  });
  it('başarısız gönderim üç kez denenir, sonra alternatif kanala geçer (YG-513)', async () => {
    const bozuk = { gonder: async () => { throw new Error('servis kapalı'); } };
    const b2: Baglam = { ...bag, eposta: bozuk, sms };
    const once = sms.gidenler.length;
    await bildir(db, { olay: 'hata1', kullanicilar: [K[BIM]!], baslik: 'H', eposta: true }, SALI);
    let t = SALI;
    for (let i = 0; i < 3; i++) { await kuyrukIsle(b2, t); t = new Date(t.getTime() + 40 * 60_000); }
    const g = (await sup.query(`SELECT durum, deneme, son_hata FROM gonderim WHERE olay_anahtari = 'hata1'`)).rows[0];
    expect(g).toEqual({ durum: 'Başarısız', deneme: 3, son_hata: 'servis kapalı' });
    await kuyrukIsle(b2, t);
    expect(sms.gidenler.length).toBe(once + 1);
  });
  it('dış kullanıcı seçtiği kanaldan alır; LGM personeli seçemez (YG-519)', async () => {
    const y = await gir(YAT);
    expect((await ist('POST', '/api/profil/kanal', y, { kanal: 'Güvercin' })).statusCode).toBe(400);
    expect((await ist('POST', '/api/profil/kanal', y, { kanal: 'SMS' })).statusCode).toBe(200);
    expect((await ist('GET', '/api/profil', y)).json().kanal).toBe('SMS');
    await bildir(db, { olay: 'kanal1', kullanicilar: [K[YAT]!], baslik: 'K', eposta: true }, SALI);
    expect((await sup.query(`SELECT kanal FROM gonderim WHERE olay_anahtari = 'kanal1'`)).rows[0].kanal).toBe('SMS');
    expect((await ist('POST', '/api/profil/kanal', await gir(CEO), { kanal: 'SMS' })).statusCode).toBe(403);
  });
  it('askıdaki kişiye dış kanaldan gitmez', async () => {
    await sup.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Askıda' WHERE kimlik = $1`, [K[FIR]]);
    await bildir(db, { olay: 'ask1', kullanicilar: [K[FIR]!], baslik: 'A', eposta: true }, SALI);
    expect((await sup.query(`SELECT count(*)::int n FROM gonderim WHERE olay_anahtari = 'ask1'`)).rows[0].n).toBe(0);
    await sup.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Aktif' WHERE kimlik = $1`, [K[FIR]]);
  });
  it('onay kartı makama e-postayla da bildirilir (YG-527)', async () => {
    const R = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Bilgi İşlem Müdürü'`)).rows[0].kimlik;
    const id = await kartAc(db, { tur: 'Deneme', baslik: 'E', hazirlayan: K[SIS], zincir: [R] });
    expect((await sup.query(`SELECT kullanici_ref, kanal FROM gonderim WHERE olay_anahtari = $1`, [`kart-ac:${id}`])).rows[0]).toEqual({ kullanici_ref: K[BIM], kanal: 'E-posta' });
  });
});

describe('onay hatırlatma (YG-527)', () => {
  const kart = async () => {
    const R = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Bilgi İşlem Müdürü'`)).rows[0].kimlik;
    const id = await kartAc(db, { tur: 'Deneme', baslik: 'Süreli', hazirlayan: K[SIS], zincir: [R], sonZaman: new Date(Date.now() - 3_600_000) });
    await sup.query(`UPDATE is_karti SET olusturma_zamani = now() - interval '2 hours' WHERE kimlik = $1`, [id]);
    return id;
  };
  it('süre dolunca bir kez hatırlatır; iki katında üst kademeye SMS; tekrar üretmez', async () => {
    const id = await kart();
    await onayHatirlat(db);
    await onayHatirlat(db);
    expect((await sup.query(`SELECT count(*)::int n FROM bildirim WHERE olay_anahtari = $1`, [`onay-sure:${id}:0`])).rows[0].n).toBe(1);
    expect((await sup.query(`SELECT count(*)::int n FROM gonderim WHERE olay_anahtari = $1`, [`onay-iki-kat:${id}:0`])).rows[0].n).toBe(0);
    await sup.query(`UPDATE is_karti SET olusturma_zamani = now() - interval '10 hours', son_zaman = now() - interval '5 hours' WHERE kimlik = $1`, [id]);
    await onayHatirlat(db);
    // Üst makam (BT Direktörü) deneme kadrosunda yok: bildirim açılmaz, hata da üretmez.
    expect((await sup.query(`SELECT count(*)::int n FROM zamanlanmis_is WHERE ad = 'onay_suresi_iki_kat' AND anahtar = $1`, [`${id}:0`])).rows[0].n).toBe(1);
  });
  it('Olağanüstü Olay Döneminde süre işlemez (YG-1629)', async () => {
    const id = await kart();
    await sup.query(`INSERT INTO olaganustu_donem DEFAULT VALUES`);
    await onayHatirlat(db);
    expect((await sup.query(`SELECT count(*)::int n FROM bildirim WHERE olay_anahtari = $1`, [`onay-sure:${id}:0`])).rows[0].n).toBe(0);
    await sup.query(`UPDATE olaganustu_donem SET bitis = now() WHERE bitis IS NULL`);
  });
});

describe('duyuru (YG-560, YG-561)', () => {
  const yeni = (c: string, b: object) => ist('POST', '/api/duyuru', c, { baslik: 'D', kapsam: 'LGM', ...b });
  it('Müdür LGM içi duyuruyu doğrudan yayımlar; alt kademe yayımlayamaz; dış kullanıcı hiç', async () => {
    expect((await yeni(await gir(BIM), { baslik: 'İç' })).json().durum).toBe('Yayında');
    expect((await yeni(await gir(DES), {})).statusCode).toBe(403);
    expect((await yeni(await gir(YAT), {})).statusCode).toBe(403);
  });
  it('dış kapsamlı duyuru üst kademe onayına gider, onaylanmadan görünmez', async () => {
    const b = await gir(BIM);
    const d = await yeni(b, { baslik: 'Dış Duyuru', kapsam: 'Dış' });
    expect(d.json().durum).toBe('Onay Bekliyor');
    const y = await gir(YAT);
    expect((await ist('GET', '/api/bugun', y)).json().duyurular.map((x: any) => x.baslik)).not.toContain('Dış Duyuru');
    const kart = (await sup.query(`SELECT is_karti_ref k FROM duyuru WHERE kimlik = $1`, [d.json().kimlik])).rows[0].k;
    const zincir = (await sup.query(`SELECT r.rol_adi FROM is_karti k JOIN rol r ON r.kimlik = k.zincir[1] WHERE k.kimlik = $1`, [kart])).rows[0].rol_adi;
    expect(zincir).toBe('Bilgi Teknolojileri ve Firma Yönetimi Direktörü');
    // Makama geçici sahip verilir
    const rid = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [zincir])).rows[0].kimlik;
    await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) VALUES ($1,$2)`, [K[SIS], rid]);
    await ist('POST', `/api/is/${kart}/karar`, await gir(SIS), { karar: 'Onayla' });
    await sup.query(`DELETE FROM rol_atamasi WHERE kullanici_ref = $1 AND rol_ref = $2`, [K[SIS], rid]);
    expect((await ist('GET', '/api/bugun', y)).json().duyurular.map((x: any) => x.baslik)).toContain('Dış Duyuru');
  });
  it('CEO duyurusu her kapsamda onaysızdır', async () => {
    expect((await yeni(await gir(CEO), { kapsam: 'Tümü' })).json().durum).toBe('Yayında');
  });
  it('okunma oranı üretilir', async () => {
    const b = await gir(BIM);
    const id = (await yeni(b, { baslik: 'Zorunlu Rapor', zorunlu: true })).json().kimlik;
    await ist('POST', `/api/duyuru/${id}/okudum`, await gir(CEO));
    const r = (await ist('GET', '/api/duyuru/yayimlarim', b)).json().find((x: any) => x.kimlik === id);
    expect(r.okuyan).toBe(1); expect(r.hedef).toBeGreaterThan(1);
  });
  it('eksik başlık ve geçersiz kapsam reddedilir', async () => {
    const b = await gir(BIM);
    expect((await yeni(b, { baslik: ' ' })).statusCode).toBe(400);
    expect((await yeni(b, { kapsam: 'Herkes' })).statusCode).toBe(400);
  });
});

describe('iç mesaj (YG-1663)', () => {
  it('gönderilir, sayaç artar, okununca düşer', async () => {
    const c = await gir(CEO), b = await gir(BIM);
    await ist('POST', '/api/mesaj/ic/okundu', b, { karsi: K[CEO] });
    expect((await ist('POST', '/api/mesaj/ic', c, { alici: K[BIM], metin: 'Merhaba' })).statusCode).toBe(200);
    expect((await ist('GET', '/api/bugun', b)).json().okunmamisMesaj).toBe(1);
    const l = (await ist('GET', '/api/mesaj/ic', b)).json();
    expect(l[0]).toMatchObject({ metin: 'Merhaba', benden: false, karsi: K[CEO] });
    await ist('POST', '/api/mesaj/ic/okundu', b, { karsi: K[CEO] });
    expect((await ist('GET', '/api/bugun', b)).json().okunmamisMesaj).toBe(0);
  });
  it('dış kullanıcı iç mesaja giremez, dış kullanıcıya yazılamaz, boş mesaj yok', async () => {
    const y = await gir(YAT), c = await gir(CEO);
    expect((await ist('GET', '/api/mesaj/ic', y)).statusCode).toBe(403);
    expect((await ist('POST', '/api/mesaj/ic', y, { alici: K[CEO], metin: 'x' })).statusCode).toBe(403);
    expect((await ist('POST', '/api/mesaj/ic', c, { alici: K[YAT], metin: 'x' })).statusCode).toBe(400);
    expect((await ist('POST', '/api/mesaj/ic', c, { alici: K[BIM], metin: ' ' })).statusCode).toBe(400);
    expect((await ist('POST', '/api/mesaj/ic', c, { alici: K[CEO], metin: 'x' })).statusCode).toBe(400);
  });
  it('başkasının yazışması görünmez; mesaj silinemez, düzeltilemez', async () => {
    const c = await gir(CEO), d = await gir(DES);
    await ist('POST', '/api/mesaj/ic', c, { alici: K[BIM], metin: 'Gizli' });
    expect((await ist('GET', '/api/mesaj/ic', d)).json().map((m: any) => m.metin)).not.toContain('Gizli');
    await expect(db.query(`DELETE FROM ic_mesaj`)).rejects.toThrow();
    await expect(db.query(`UPDATE ic_mesaj SET metin = 'x'`)).rejects.toThrow();
  });
});
