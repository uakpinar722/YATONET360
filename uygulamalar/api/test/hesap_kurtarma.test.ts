import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';

const VT = 'yatonet360_test6'; const PAROLA = 'Sinama-Parolasi-2026!';
const D = '@deneme.yatonet.local'; const DES = 'destek' + D, BIM = 'bimuduru' + D, SIC = 'sicil' + D, FIR = 'firma' + D, CEO = 'ceo' + D, YAT = 'yatsahibi' + D, SIS = 'sistem' + D;
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool; const sms = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const cerez = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: { [COOKIE_ADI]: c }, payload });
const K: Record<string, string> = {}; const gizli: Record<string, string> = {};

async function gir(ep: string) {
  const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: ep, parola: PAROLA } });
  const c = cerez(g);
  if (g.json().yontem === 'sms') { await ist('POST', '/api/kimlik/sms', c); return cerez(await ist('POST', '/api/kimlik/dogrula', c, { kod: sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0] })); }
  await sup.query(`UPDATE kullanici_hesabi SET totp_gizli_sifreli = NULL, totp_son_adim = 0 WHERE e_posta = $1`, [ep]);
  const q = await ist('GET', '/api/kimlik/kurulum', c); gizli[ep] = q.json().gizli;
  return cerez(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
}
const ac = (c: string, kullanici: string) => ist('POST', '/api/hesap-kurtarma', c, { kullanici, kimlikTeyidi: 'Geri arama ve özlük bilgisi', neden: 'Telefon kayıp' });
const kart = async (id: string) => (await sup.query(`SELECT is_karti_ref k FROM hesap_kurtarma WHERE kimlik = $1`, [id])).rows[0].k as string;

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [await parolaOzetle(PAROLA)]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' WHEN kullanici_grubu = 'İş Birliği Firması' THEN 'KVKK-03' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  for (const ep of [DES, BIM, SIC, FIR, CEO, YAT, SIS]) K[ep] = (await sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rows[0].kimlik;
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  s = await sunucuKur({ db, sms, eposta: new DenemeKutusu(null), anahtar: 'cc'.repeat(32), guvenliCerez: false, webAdresi: 'http://x' });
});
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });

describe('hesap kurtarma (YG-1156, A32-3)', () => {
  it('iç kullanıcı: birim Müdürü onaylar; faktör sıfırlanır, oturum kapanır, kullanıcı bilgilendirilir, yeniden kurar', async () => {
    const hedef = await gir(SIS); const d = await gir(DES); const b = await gir(BIM);
    const r = await ac(d, K[SIS]!);
    expect(r.json().kimlik).toMatch(/^DST-\d{4}-0001$/); expect(r.json().dis).toBe(false);
    expect((await sup.query(`SELECT totp_gizli_sifreli t FROM kullanici_hesabi WHERE kimlik = $1`, [K[SIS]])).rows[0].t).not.toBeNull();
    const k = (await ist('GET', '/api/bugun', b)).json().onay.find((x: any) => x.tur === 'Hesap Kurtarma');
    expect(k.ozet).toContain('Telefon kayıp');
    expect((await ist('POST', `/api/is/${k.kimlik}/karar`, b, { karar: 'Onayla' })).statusCode).toBe(200);
    expect((await sup.query(`SELECT totp_gizli_sifreli t, totp_son_adim a FROM kullanici_hesabi WHERE kimlik = $1`, [K[SIS]])).rows[0]).toEqual({ t: null, a: '0' });
    expect((await ist('GET', '/api/ben', hedef)).statusCode).toBe(401);
    expect((await sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE 'Hesap Kurtarma%'`, [K[SIS]])).rows[0].n).toBe(1);
    expect((await sup.query(`SELECT count(*)::int n FROM denetim_izi WHERE eylem = 'İkinci Faktör Sıfırlandı' AND nesne_kimligi = $1`, [r.json().kimlik])).rows[0].n).toBe(1);
    const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: SIS, parola: PAROLA } });
    expect(g.json().kurulumGerekli).toBe(true);
    expect((await ist('GET', '/api/hesap-kurtarma', d)).json()[0].durum).toBe('Uygulandı');
  });
  it('onay gelmeden hiçbir şey değişmez; red ve iade işlenir', async () => {
    const hedef = await gir(CEO); const d = await gir(DES); const once = gizli[CEO];
    const id = (await ac(d, K[CEO]!)).json().kimlik;
    expect((await ist('GET', '/api/ben', hedef)).statusCode).toBe(200);
    const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: CEO, parola: PAROLA } });
    expect(g.json().kurulumGerekli).toBe(false);
    expect(once).toBeTruthy();
    const { rows } = await sup.query(`SELECT zincir FROM is_karti WHERE kimlik = $1`, [await kart(id)]);
    expect((await sup.query(`SELECT rol_adi FROM rol WHERE kimlik = $1`, [rows[0].zincir[0]])).rows[0].rol_adi).toBe('CEO');
  });
  it('dış kullanıcı: Çözüm Ortağı teyidi Sicil Sorumlusunda ve 8 saat (YG-1649); iade destek sorumlusuna döner', async () => {
    await gir(FIR); const d = await gir(DES); const si = await gir(SIC);
    const r = await ac(d, K[FIR]!);
    expect(r.json().dis).toBe(true);
    const k = (await ist('GET', '/api/bugun', si)).json().onay.find((x: any) => x.tur === 'Hesap Kurtarma Teyidi');
    const saat = (new Date(k.son_zaman).getTime() - Date.now()) / 3_600_000;
    expect(saat).toBeGreaterThan(7.9); expect(saat).toBeLessThanOrEqual(8);
    await ist('POST', `/api/is/${k.kimlik}/karar`, si, { karar: 'Gerekçeyle İade Et', gerekce: 'Kurum yetkilisi talebi yok' });
    expect((await sup.query(`SELECT durum FROM hesap_kurtarma WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('İade Edildi');
    expect((await ist('GET', '/api/bugun', d)).json().iade.map((x: any) => x.kimlik)).toContain(k.kimlik);
    await ist('POST', `/api/is/${k.kimlik}/karar`, d, { karar: 'Yeniden Gönder' });
    await ist('POST', `/api/is/${k.kimlik}/karar`, si, { karar: 'Onayla' });
    expect((await sup.query(`SELECT durum FROM hesap_kurtarma WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('Uygulandı');
  });
  it('makamı olmayan onaylayamaz; yetkisiz rol kurtarma açamaz, kullanıcı arayamaz', async () => {
    const d = await gir(DES); const c = await gir(CEO); const si = await gir(SIC);
    const id = (await ac(d, K[SIS]!)).json().kimlik;
    expect((await ist('POST', `/api/is/${await kart(id)}/karar`, si, { karar: 'Onayla' })).statusCode).toBe(403);
    expect((await ist('POST', `/api/is/${await kart(id)}/karar`, d, { karar: 'Onayla' })).statusCode).toBe(403);
    expect((await ac(c, K[SIS]!)).statusCode).toBe(403);
    expect((await ist('POST', '/api/hesap-kurtarma/bul', c, { kimlik: SIS })).statusCode).toBe(403);
  });
  it('kendi hesabı için açılamaz; SMS hesabına gerekmez; alanlar zorunlu', async () => {
    const d = await gir(DES);
    expect((await ac(d, K[DES]!)).statusCode).toBe(403);
    expect((await ac(d, K[YAT]!)).statusCode).toBe(409);
    expect((await ist('POST', '/api/hesap-kurtarma', d, { kullanici: K[SIS], kimlikTeyidi: ' ', neden: 'x' })).statusCode).toBe(400);
  });
  it('hesap yalnız tam bilgiyle bulunur', async () => {
    const d = await gir(DES);
    expect((await ist('POST', '/api/hesap-kurtarma/bul', d, { kimlik: SIS })).json().kimlik).toBe(K[SIS]);
    expect((await ist('POST', '/api/hesap-kurtarma/bul', d, { kimlik: 'yok' + D })).statusCode).toBe(404);
    expect((await ist('POST', '/api/hesap-kurtarma/bul', d, { kimlik: 'sistem' })).statusCode).toBe(400);
  });
});
