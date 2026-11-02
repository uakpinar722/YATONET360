import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, KURAL, ortamOku } from '../src/ayarlar.js';
import { parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';

const VT = 'yatonet360_test3';
const PAROLA = 'Sinama-Parolasi-2026!', YENI = 'Yepyeni bir uzun parola 2026';
const YAT = 'yatsahibi@deneme.yatonet.local', CEO = 'ceo@deneme.yatonet.local';
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool;
const sms = new DenemeKutusu(null), posta = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const cerez = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c?: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: c ? { [COOKIE_ADI]: c } : {}, payload });
const belirtec = () => posta.gidenler.at(-1)!.metin.match(/#parola=([\w-]+)/)![1]!;

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  await sup.query(`UPDATE kullanici_hesabi SET izin_adimi_zamani = now()`);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  s = await sunucuKur({ db, sms, eposta: posta, anahtar: 'ef'.repeat(32), guvenliCerez: false, webAdresi: 'http://x' });
});
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });
beforeEach(async () => {
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, basarisiz_giris_sayisi = 0, kilit_bitis_zamani = NULL`, [await parolaOzetle(PAROLA)]);
  await sup.query(`UPDATE parola_sifirlama SET olusturma_zamani = now() - interval '1 hour'`);
  posta.gidenler.length = 0; sms.gidenler.length = 0;
});
/** Yat sahibi SMS ile tam giriş. */
async function yatGiris(parola = PAROLA) {
  const c = cerez(await ist('POST', '/api/kimlik/giris', undefined, { kimlik: YAT, parola }));
  await ist('POST', '/api/kimlik/sms', c);
  return cerez(await ist('POST', '/api/kimlik/dogrula', c, { kod: sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0] }));
}

describe('parola yenileme (YG-1156)', () => {
  it('bilinen ve bilinmeyen hesap aynı yanıtı alır', async () => {
    const a = await ist('POST', '/api/kimlik/parola-talep', undefined, { kimlik: YAT });
    const b = await ist('POST', '/api/kimlik/parola-talep', undefined, { kimlik: 'yok@deneme.yatonet.local' });
    expect(a.json()).toEqual(b.json()); expect(posta.gidenler).toHaveLength(1);
  });
  it('belirteç açık saklanmaz; yenilenince eski parola çalışmaz, bildirim gider', async () => {
    await ist('POST', '/api/kimlik/parola-talep', undefined, { kimlik: YAT });
    const t = belirtec();
    expect((await sup.query(`SELECT count(*)::int n FROM parola_sifirlama WHERE belirtec_ozeti = $1`, [t])).rows[0].n).toBe(0);
    expect((await ist('POST', '/api/kimlik/parola-yenile', undefined, { belirtec: t, parola: YENI })).statusCode).toBe(200);
    expect(posta.gidenler.at(-1)!.metin).toMatch(/değiştirilmiştir/);
    expect((await ist('POST', '/api/kimlik/giris', undefined, { kimlik: YAT, parola: PAROLA })).statusCode).toBe(401);
    expect((await ist('POST', '/api/kimlik/giris', undefined, { kimlik: YAT, parola: YENI })).statusCode).toBe(200);
  });
  it('yeni parola ikinci faktörü atlatmaz', async () => {
    await ist('POST', '/api/kimlik/parola-talep', undefined, { kimlik: YAT });
    await ist('POST', '/api/kimlik/parola-yenile', undefined, { belirtec: belirtec(), parola: YENI });
    const c = cerez(await ist('POST', '/api/kimlik/giris', undefined, { kimlik: YAT, parola: YENI }));
    expect((await ist('GET', '/api/ben', c)).statusCode).toBe(401);
  });
  it('bağlantı tek kullanımlık ve süreli', async () => {
    await ist('POST', '/api/kimlik/parola-talep', undefined, { kimlik: YAT }); const t = belirtec();
    await ist('POST', '/api/kimlik/parola-yenile', undefined, { belirtec: t, parola: YENI });
    expect((await ist('POST', '/api/kimlik/parola-yenile', undefined, { belirtec: t, parola: YENI + '2' })).statusCode).toBe(410);
    await sup.query(`UPDATE parola_sifirlama SET olusturma_zamani = now() - interval '1 hour'`);
    await ist('POST', '/api/kimlik/parola-talep', undefined, { kimlik: YAT }); const t2 = belirtec();
    await sup.query(`UPDATE parola_sifirlama SET son_gecerlilik = now() - interval '1 minute'`);
    expect((await ist('POST', '/api/kimlik/parola-yenile', undefined, { belirtec: t2, parola: YENI })).statusCode).toBe(410);
  });
  it('kısa parola reddedilir, bağlantı boşa gitmez', async () => {
    await ist('POST', '/api/kimlik/parola-talep', undefined, { kimlik: YAT }); const t = belirtec();
    expect((await ist('POST', '/api/kimlik/parola-yenile', undefined, { belirtec: t, parola: 'kisa' })).statusCode).toBe(400);
    expect((await ist('POST', '/api/kimlik/parola-yenile', undefined, { belirtec: t, parola: YENI })).statusCode).toBe(200);
  });
  it('açık oturumlar kapanır; tekrar talep bir dakika beklenir', async () => {
    const c = await yatGiris();
    await ist('POST', '/api/kimlik/parola-talep', undefined, { kimlik: YAT });
    await ist('POST', '/api/kimlik/parola-talep', undefined, { kimlik: YAT });
    expect(posta.gidenler).toHaveLength(1);
    await ist('POST', '/api/kimlik/parola-yenile', undefined, { belirtec: belirtec(), parola: YENI });
    expect((await ist('GET', '/api/ben', c)).statusCode).toBe(401);
  });
  it('askıdaki hesaba bağlantı gitmez', async () => {
    await sup.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Askıda' WHERE e_posta = $1`, [CEO]);
    await ist('POST', '/api/kimlik/parola-talep', undefined, { kimlik: CEO });
    expect(posta.gidenler).toHaveLength(0);
    await sup.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Aktif' WHERE e_posta = $1`, [CEO]);
  });
});

describe('profil ve izinler (YG-1211, YG-1390)', () => {
  it('izin verilir, geri alınır, kayıt silinmez', async () => {
    const c = await yatGiris();
    const iz = { tur: 'Ticari elektronik ileti onayı', kanal: 'WhatsApp' };
    expect((await ist('POST', '/api/profil/izin', c, { ...iz, ver: true })).statusCode).toBe(200);
    await ist('POST', '/api/profil/izin', c, { ...iz, ver: true });
    const secili = () => ist('GET', '/api/profil', c).then((r) => r.json().izinler.find((x: any) => x.kanal === 'WhatsApp').verildi);
    expect(await secili()).toBe(true);
    await ist('POST', '/api/profil/izin', c, { ...iz, ver: false });
    expect(await secili()).toBe(false);
    const { rows } = await sup.query(`SELECT durum, geri_alma_kanali, gonderim_engeli FROM acik_riza WHERE kanal = 'WhatsApp'`);
    expect(rows).toEqual([{ durum: 'Geri Alındı', geri_alma_kanali: 'YATONET 360 profili', gonderim_engeli: true }]);
  });
  it('listede olmayan izin ve başka grubun izni reddedilir', async () => {
    const c = await yatGiris();
    expect((await ist('POST', '/api/profil/izin', c, { tur: 'Uydurma', ver: true })).statusCode).toBe(400);
    expect((await ist('POST', '/api/profil/izin', c, { tur: 'Özel gün – Doğum günü paylaşımı', ver: true })).statusCode).toBe(400);
  });
  it('dil değişir; geçersiz dil reddedilir', async () => {
    const c = await yatGiris();
    expect((await ist('POST', '/api/profil/dil', c, { dil: 'de' })).statusCode).toBe(400);
    await ist('POST', '/api/profil/dil', c, { dil: 'en' });
    expect((await ist('GET', '/api/ben', c)).json().dil).toBe('en');
    await ist('POST', '/api/profil/dil', c, { dil: 'tr' });
  });
  it('oturumsuz profil kapalı', async () => { expect((await ist('GET', '/api/profil')).statusCode).toBe(401); });
});

describe('adres bazlı sınır (YG-1157)', () => {
  it('eşik aşılınca aynı adresten giriş denemesi kesilir, başka hesap da denenemez', async () => {
    for (let i = 0; i < KURAL.adresDenemeSiniri; i++) await ist('POST', '/api/kimlik/giris', undefined, { kimlik: `yok${i}@deneme.yatonet.local`, parola: 'yanlis-parola-1234' });
    const r = await ist('POST', '/api/kimlik/giris', undefined, { kimlik: CEO, parola: PAROLA });
    expect(r.statusCode).toBe(429);
    expect((await sup.query(`SELECT count(*)::int n FROM denetim_izi WHERE eylem = 'Adres Bazlı Deneme Sınırı'`)).rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
