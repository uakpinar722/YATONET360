import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { davetOlustur } from '../src/ilk_giris.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';

const VT = 'yatonet360_test2';
const PAROLA = 'Davetli-Parolasi-2026!';
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool; const sms = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const cerez = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c?: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: c ? { [COOKIE_ADI]: c } : {}, payload });

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  s = await sunucuKur({ db, sms, eposta: new DenemeKutusu(null), webAdresi: 'http://x', anahtar: 'cd'.repeat(32), guvenliCerez: false });
});
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });

let n = 0;
const yeni = (grup: string, rol: string, ek: object = {}) => davetOlustur(db, { adSoyad: 'Deneme Kişi', eposta: `k${++n}@deneme.yatonet.local`, grup, rol, ...ek });
/** Davet bağlantısından tam oturuma. */
async function davetle(belirtec: string, dil = 'tr') {
  const p = await ist('POST', '/api/ilk-giris/parola', undefined, { belirtec, parola: PAROLA, dil });
  expect(p.statusCode).toBe(200);
  const c = cerez(p);
  const q = await ist('GET', '/api/kimlik/kurulum', c);
  const d = await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) });
  expect(d.statusCode).toBe(200);
  return cerez(d);
}

describe('davet (G2-1)', () => {
  it('bağlantı geçerliyken bilgi verir, belirteç veritabanında açık tutulmaz', async () => {
    const { belirtec } = await yeni('LGM İç Rolü', 'Dosya Sorumlusu');
    expect((await ist('POST', '/api/ilk-giris/davet', undefined, { belirtec })).json()).toMatchObject({ lgm: true, gun: 7 });
    const { rows } = await sup.query(`SELECT count(*)::int n FROM davet WHERE belirtec_ozeti = $1`, [belirtec]);
    expect(rows[0].n).toBe(0);
  });
  it('geçersiz bağlantı reddedilir', async () => {
    expect((await ist('POST', '/api/ilk-giris/davet', undefined, { belirtec: 'yok' })).statusCode).toBe(410);
  });
  it('süresi dolan bağlantı çalışmaz', async () => {
    const { belirtec, kimlik } = await yeni('LGM İç Rolü', 'Dosya Sorumlusu');
    await sup.query(`UPDATE davet SET son_gecerlilik = now() - interval '1 minute' WHERE kullanici_ref = $1`, [kimlik]);
    expect((await ist('POST', '/api/ilk-giris/parola', undefined, { belirtec, parola: PAROLA })).statusCode).toBe(410);
  });
  it('bağlantı bir kez kullanılır', async () => {
    const { belirtec } = await yeni('LGM İç Rolü', 'Dosya Sorumlusu');
    expect((await ist('POST', '/api/ilk-giris/parola', undefined, { belirtec, parola: PAROLA })).statusCode).toBe(200);
    expect((await ist('POST', '/api/ilk-giris/parola', undefined, { belirtec, parola: PAROLA })).statusCode).toBe(410);
  });
  it('kısa veya sızdırılmış parola kabul edilmez, bağlantı boşa gitmez (G2-2)', async () => {
    const { belirtec } = await yeni('LGM İç Rolü', 'Dosya Sorumlusu');
    expect((await ist('POST', '/api/ilk-giris/parola', undefined, { belirtec, parola: 'kisa' })).statusCode).toBe(400);
    expect((await ist('POST', '/api/ilk-giris/parola', undefined, { belirtec, parola: 'passwordpassword' })).statusCode).toBe(400);
    expect((await ist('POST', '/api/ilk-giris/davet', undefined, { belirtec })).statusCode).toBe(200);
  });
  it('parola belirlenmemiş hesapla giriş yapılamaz', async () => {
    await yeni('LGM İç Rolü', 'Dosya Sorumlusu');
    expect((await ist('POST', '/api/kimlik/giris', undefined, { kimlik: `k${n}@deneme.yatonet.local`, parola: PAROLA })).statusCode).toBe(401);
  });
});

describe('ilk giriş adımları (KVKK-10)', () => {
  it('LGM personeli: koşul adımı yok, KVKK-05 ve izinler', async () => {
    const c = await davetle((await yeni('LGM İç Rolü', 'Sistem Yöneticisi')).belirtec);
    const ben = (await ist('GET', '/api/ben', c)).json();
    expect(ben.eksik).toEqual(['aydinlatma', 'izinler']);
    expect((await ist('GET', '/api/ilk-giris/metin/aydinlatma', c)).json().kod).toBe('KVKK-05');
    expect((await ist('POST', '/api/ilk-giris/kosullar', c)).statusCode).toBe(409);
  });
  it('adımlar bitmeden diğer yollar kapalı', async () => {
    const c = await davetle((await yeni('LGM İç Rolü', 'Sistem Yöneticisi')).belirtec);
    const r = await ist('GET', '/api/yetki/roller', c);
    expect(r.statusCode).toBe(428); expect(r.json().eksik).toContain('aydinlatma');
    await ist('POST', '/api/ilk-giris/aydinlatma', c);
    await ist('POST', '/api/ilk-giris/izinler', c, {});
    expect((await ist('GET', '/api/yetki/roller', c)).statusCode).toBe(200);
  });
  it('kurumsal kullanıcı: PRT-01 ve KVKK-04, rıza istenmez', async () => {
    const c = await davetle((await yeni('Sigorta Şirketi / Eksper', 'Sigorta Şirketi Kullanıcısı')).belirtec, 'en');
    expect((await ist('GET', '/api/ben', c)).json().eksik).toEqual(['kosullar', 'aydinlatma']);
    const m = (await ist('GET', '/api/ilk-giris/metin/aydinlatma', c)).json();
    expect(m.kod).toBe('KVKK-04'); expect(m.dil).toBe('en');
    expect((await ist('POST', '/api/ilk-giris/izinler', c, {})).statusCode).toBe(409);
    await ist('POST', '/api/ilk-giris/kosullar', c);
    expect((await ist('POST', '/api/ilk-giris/aydinlatma', c)).json().eksik).toEqual([]);
    const { rows } = await sup.query(`SELECT prt_surumu, dil FROM kullanim_kosullari_kabulu ORDER BY kabul_zamani DESC LIMIT 1`);
    expect(rows[0]).toEqual({ prt_surumu: 'R00', dil: 'İngilizce' });
  });
  it('Çözüm Ortağı KVKK-03; İngilizcesi yoksa Türkçe gösterilir', async () => {
    const c = await davetle((await yeni('İş Birliği Firması', 'Firma Yetkilisi')).belirtec, 'en');
    const m = (await ist('GET', '/api/ilk-giris/metin/aydinlatma', c)).json();
    expect(m.kod).toBe('KVKK-03'); expect(m.dil).toBe('tr');
  });
  it('rıza verilmeden de hesap kullanılır (YG-1207)', async () => {
    const c = await davetle((await yeni('Bireysel Müşteri (Yat Sahibi/Yetkilisi)', 'Müşteri Portal Kullanıcısı')).belirtec);
    await ist('POST', '/api/ilk-giris/kosullar', c); await ist('POST', '/api/ilk-giris/aydinlatma', c);
    expect((await ist('POST', '/api/ilk-giris/izinler', c, {})).json().eksik).toEqual([]);
    const { rows } = await sup.query(`SELECT count(*)::int n FROM acik_riza r JOIN kullanici_hesabi k ON k.kimlik = r.ilgili_kisi_ref WHERE k.e_posta = $1`, [`k${n}@deneme.yatonet.local`]);
    expect(rows[0].n).toBe(0);
  });
  it('rıza amaç ve kanal bazında ayrı kaydedilir, listede olmayan değer alınmaz (YG-1208, YG-1210)', async () => {
    const c = await davetle((await yeni('Bireysel Müşteri (Yat Sahibi/Yetkilisi)', 'Müşteri Portal Kullanıcısı')).belirtec);
    await ist('POST', '/api/ilk-giris/izinler', c, { amaclar: ['Bakım ve sezon hatırlatmaları', 'uydurma'], kanallar: ['SMS', 'Telefon', 'güvercin'] });
    const { rows } = await sup.query(`SELECT riza_turu, amac, kanal, durum, kaynak, metin_surumu FROM acik_riza r JOIN kullanici_hesabi k ON k.kimlik = r.ilgili_kisi_ref WHERE k.e_posta = $1 ORDER BY riza_turu, kanal`, [`k${n}@deneme.yatonet.local`]);
    expect(rows.map((r) => r.amac ?? r.kanal)).toEqual(['Bakım ve sezon hatırlatmaları', 'SMS', 'Telefon']);
    expect(rows[0]).toMatchObject({ durum: 'Verildi', kaynak: 'İlk Giriş Ekranı', metin_surumu: 'R00' });
  });
  it('amaç seçilmeden kanal onayı kaydedilmez', async () => {
    const c = await davetle((await yeni('Bireysel Müşteri (Yat Sahibi/Yetkilisi)', 'Müşteri Portal Kullanıcısı')).belirtec);
    await ist('POST', '/api/ilk-giris/izinler', c, { kanallar: ['SMS'] });
    const { rows } = await sup.query(`SELECT count(*)::int n FROM acik_riza r JOIN kullanici_hesabi k ON k.kimlik = r.ilgili_kisi_ref WHERE k.e_posta = $1`, [`k${n}@deneme.yatonet.local`]);
    expect(rows[0].n).toBe(0);
  });
  it('Çözüm Ortağı portal rehberi beyanı olmadan işlem yapamaz; sigorta kullanıcısından istenmez (YG-1396)', async () => {
    const c = await davetle((await yeni('İş Birliği Firması', 'Firma Yetkilisi')).belirtec);
    expect((await ist('GET', '/api/ben', c)).json().eksik).toEqual(['kosullar', 'aydinlatma', 'rehber']);
    await ist('POST', '/api/ilk-giris/kosullar', c); await ist('POST', '/api/ilk-giris/aydinlatma', c);
    expect((await ist('GET', '/api/yetki/roller', c)).statusCode).toBe(428);
    expect((await ist('POST', '/api/ilk-giris/rehber', c, {})).statusCode).toBe(400);
    expect((await ist('POST', '/api/ilk-giris/rehber', c, { okudum: true })).json().eksik).toEqual([]);
    const s = await davetle((await yeni('Sigorta Şirketi / Eksper', 'Sigorta Şirketi Kullanıcısı')).belirtec);
    expect((await ist('POST', '/api/ilk-giris/rehber', s, { okudum: true })).statusCode).toBe(409);
  });
  it('yeni metin sürümünde adım yeniden açılır (KVKK-10 Bölüm 5)', async () => {
    const c = await davetle((await yeni('Sigorta Şirketi / Eksper', 'Sigorta Şirketi Kullanıcısı')).belirtec);
    await ist('POST', '/api/ilk-giris/kosullar', c); await ist('POST', '/api/ilk-giris/aydinlatma', c);
    expect((await ist('GET', '/api/ben', c)).json().eksik).toEqual([]);
    await sup.query(`INSERT INTO hukuki_metin (kod, dil, surum, baslik, govde) SELECT kod, dil, 'R01', baslik, govde FROM hukuki_metin WHERE kod = 'PRT-01' AND surum = 'R00'`);
    expect((await ist('GET', '/api/ben', c)).json().eksik).toEqual(['kosullar']);
    await sup.query(`DELETE FROM hukuki_metin WHERE kod = 'PRT-01' AND surum = 'R01'`);
  });
  it('başka grubun metni ve izinsiz metin istenemez', async () => {
    const c = await davetle((await yeni('LGM İç Rolü', 'Dosya Sorumlusu')).belirtec);
    expect((await ist('GET', '/api/ilk-giris/metin/KVKK-01', c)).statusCode).toBe(404);
    expect((await ist('GET', '/api/ilk-giris/metin/aydinlatma')).statusCode).toBe(401);
  });
  it('metinler Word belgelerinden yüklü', async () => {
    const { rows } = await sup.query(`SELECT kod, dil FROM hukuki_metin ORDER BY kod, dil`);
    expect(rows.length).toBe(10);
    const g = (await sup.query(`SELECT govde FROM hukuki_metin WHERE kod = 'KVKK-05' AND dil = 'tr'`)).rows[0].govde;
    expect(g.length).toBeGreaterThan(50);
  });
});
