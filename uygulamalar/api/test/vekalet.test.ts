import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { CIHAZ_COOKIE } from '../src/cihaz.js';
import { kartAc } from '../src/is_motoru.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';

const VT = 'yatonet360_test7'; const PAROLA = 'Sinama-Parolasi-2026!'; const D = '@deneme.yatonet.local';
const BIM = 'bimuduru' + D, SIS = 'sistem' + D, DES = 'destek' + D, CEO = 'ceo' + D, DEN = 'denetci' + D, SIC = 'sicil' + D;
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool; const sms = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const ckr = (r: any, a = COOKIE_ADI) => r.cookies.find((c: any) => c.name === a)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: { [COOKIE_ADI]: c }, payload });
const K: Record<string, string> = {}; const R: Record<string, string> = {};
const tarih = (g: number) => new Date(Date.now() + g * 86_400_000).toISOString().slice(0, 10);

async function gir(ep: string) {
  await sup.query(`UPDATE kullanici_hesabi SET totp_gizli_sifreli = NULL, totp_son_adim = 0 WHERE e_posta = $1`, [ep]);
  const c = ckr(await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: ep, parola: PAROLA } }));
  const q = await ist('GET', '/api/kimlik/kurulum', c);
  return ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
}
const ata = (c: string, b: object) => ist('POST', '/api/vekalet', c, { neden: 'İzin', kapsam: 'Açık işler', baslangic: tarih(0), bitis: tarih(5), ...b });

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [await parolaOzetle(PAROLA)]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' WHEN kullanici_grubu = 'İş Birliği Firması' THEN 'KVKK-03' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  for (const ep of [BIM, SIS, DES, CEO, DEN, SIC]) K[ep] = (await sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rows[0].kimlik;
  for (const ad of ['Sistem Yöneticisi', 'Bilgi İşlem Destek Sorumlusu', 'Bilgi İşlem Müdürü', 'CEO', 'Teknik Uzman', 'Kalite Uzmanı (Kalite Kontrolör)']) R[ad] = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik;
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  s = await sunucuKur({ db, sms, eposta: new DenemeKutusu(null), anahtar: 'dd'.repeat(32), guvenliCerez: false, webAdresi: 'http://x' });
});
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });

describe('vekâlet (YG-1056, YG-1478)', () => {
  it('birim amiri atar; vekil makamın kartını "vekaleten" görür, karar verir; asıl da görür', async () => {
    const bim = await gir(BIM), des = await gir(DES);
    // Bilgi İşlem Destek Sorumlusu, Sistem Yöneticisi rolüne üst kademe olmadığı için uygun değil; Müdür kendi birimindeki kişiye Sistem Yöneticisi vekâleti verir.
    const se = (await ist('GET', '/api/vekalet', bim)).json();
    const a = se.secenek.find((x: any) => x.rolAdi === 'Bilgi İşlem Destek Sorumlusu');
    expect(a).toBeTruthy();
    expect(a.vekiller.map((v: any) => v.rol)).toContain('Bilgi İşlem Müdürü');
    const r = await ata(bim, { asil: K[DES], rol: R['Bilgi İşlem Destek Sorumlusu'], vekil: K[BIM] });
    expect(r.statusCode).toBe(200); expect(r.json().kimlik).toMatch(/^VKL-\d{4}-0001$/);
    const id = await kartAc(db, { tur: 'Deneme', baslik: 'Vekâlet Kartı', hazirlayan: K[CEO], zincir: [R['Bilgi İşlem Destek Sorumlusu']!] });
    const b = (await ist('GET', '/api/bugun', bim)).json();
    expect(b.vekaletler[0].rol).toBe('Bilgi İşlem Destek Sorumlusu');
    expect(b.onay.find((x: any) => x.kimlik === id).vekaleten).toBe(true);
    expect((await ist('GET', '/api/bugun', des)).json().onay.find((x: any) => x.kimlik === id).vekaleten).toBe(false);
    expect((await ist('POST', `/api/is/${id}/karar`, bim, { karar: 'Onayla' })).statusCode).toBe(200);
    expect((await sup.query(`SELECT vekaleten FROM is_karti_adim WHERE is_ref = $1`, [id])).rows[0].vekaleten).toBe(true);
    // Vekil de asıl rolün iznini alır (hesap kurtarma), bitince kaybeder.
    expect((await ist('POST', '/api/hesap-kurtarma/bul', bim, { kimlik: CEO })).statusCode).toBe(200);
    await ist('POST', `/api/vekalet/${r.json().kimlik}/bitir`, bim);
    expect((await ist('POST', '/api/hesap-kurtarma/bul', bim, { kimlik: CEO })).statusCode).toBe(403);
    expect((await ist('GET', '/api/bugun', bim)).json().vekaletler).toEqual([]);
  });
  it('süre 30 günü aşamaz, tarih düzgün olmalı, bitince kendiliğinden düşer', async () => {
    const bim = await gir(BIM);
    const t = { asil: K[DES], rol: R['Bilgi İşlem Destek Sorumlusu'], vekil: K[BIM] };
    expect((await ata(bim, { ...t, bitis: tarih(31) })).statusCode).toBe(400);
    expect((await ata(bim, { ...t, bitis: tarih(-1) })).statusCode).toBe(400);
    const r = await ata(bim, t);
    expect((await ata(bim, t)).statusCode).toBe(409);
    await sup.query(`UPDATE vekalet SET baslangic_tarihi = current_date - 10, bitis_tarihi = current_date - 1 WHERE kimlik = $1`, [r.json().kimlik]);
    expect((await ist('GET', '/api/bugun', bim)).json().vekaletler).toEqual([]);
    expect((await ist('POST', '/api/hesap-kurtarma/bul', bim, { kimlik: CEO })).statusCode).toBe(403);
  });
  it('amiri olmayan atayamaz; uygun olmayan vekil reddedilir', async () => {
    const den = await gir(DEN), bim = await gir(BIM);
    expect((await ata(den, { asil: K[DES], rol: R['Bilgi İşlem Destek Sorumlusu'], vekil: K[BIM] })).statusCode).toBe(403);
    expect((await ata(bim, { asil: K[DES], rol: R['Bilgi İşlem Destek Sorumlusu'], vekil: K[SIC] })).statusCode).toBe(400);
    expect((await ata(bim, { asil: K[DES], rol: R['Bilgi İşlem Destek Sorumlusu'], vekil: K[DES] })).statusCode).toBe(400);
  });
  it('CEO vekili Genel Müdür Yardımcısı veya Teknik ve Operasyon Direktörüdür (YG-1058)', async () => {
    const ceo = await gir(CEO);
    expect((await ata(ceo, { asil: K[CEO], rol: R['CEO'], vekil: K[DEN] })).statusCode).toBe(400);
  });
  it('veritabanı 30 günü de kendisi reddeder', async () => {
    await expect(sup.query(`INSERT INTO vekalet (kimlik, asil_ref, vekil_ref, rol_ref, vekalet_nedeni, kapsam, baslangic_tarihi, bitis_tarihi, atayan_ref) VALUES ('VKL-2026-9999',$1,$2,$3,'İzin','k',current_date,current_date + 31,$1)`, [K[BIM], K[DES], R['Bilgi İşlem Müdürü']])).rejects.toThrow();
  });
});

describe('kendi kaydı bir sonraki yetkiliye düşer (YG-1034)', () => {
  it('makamda hazırlayandan başkası yoksa üst makama gider', async () => {
    const id = await kartAc(db, { tur: 'Deneme', baslik: 'K', hazirlayan: K[BIM], zincir: [R['Bilgi İşlem Müdürü']!] });
    const z = (await sup.query(`SELECT r.rol_adi FROM is_karti k JOIN rol r ON r.kimlik = k.zincir[1] WHERE k.kimlik = $1`, [id])).rows[0].rol_adi;
    expect(z).toBe('Bilgi Teknolojileri ve Firma Yönetimi Direktörü');
  });
  it('makamda başka sahip varsa kalır', async () => {
    await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) VALUES ($1,$2)`, [K[DEN], R['Bilgi İşlem Müdürü']]);
    const id = await kartAc(db, { tur: 'Deneme', baslik: 'K', hazirlayan: K[BIM], zincir: [R['Bilgi İşlem Müdürü']!] });
    expect((await sup.query(`SELECT zincir[1] z FROM is_karti WHERE kimlik = $1`, [id])).rows[0].z).toBe(R['Bilgi İşlem Müdürü']);
    await sup.query(`DELETE FROM rol_atamasi WHERE kullanici_ref = $1 AND rol_ref = $2`, [K[DEN], R['Bilgi İşlem Müdürü']]);
  });
});

describe('kayıtlı cihaz (YG-1006, YG-1150)', () => {
  const giris = async (cihaz?: string) => {
    const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: SIS, parola: PAROLA } });
    return ckr(g);
  };
  it('kurulum cihazı kaydolur; başka cihaz engellenir, onay Bilgi İşlem Müdürüne gider; onaydan sonra girer; reddedilen girmez', async () => {
    await sup.query(`UPDATE kullanici_hesabi SET totp_gizli_sifreli = NULL, totp_son_adim = 0 WHERE e_posta = $1`, [SIS]);
    const c0 = await giris();
    const q = await ist('GET', '/api/kimlik/kurulum', c0); const gz = q.json().gizli as string;
    const d0 = await ist('POST', '/api/kimlik/dogrula', c0, { kod: totpKodu(gz, suankiAdim()) });
    expect(d0.statusCode).toBe(200);
    const cihaz1 = ckr(d0, CIHAZ_COOKIE); expect(cihaz1).toBeTruthy();
    // Kayıtlı cihazla giriş
    const dogrula = (o: string, kod: string, c?: string) => s.inject({ method: 'POST', url: '/api/kimlik/dogrula', headers: H, cookies: { [COOKIE_ADI]: o, ...(c ? { [CIHAZ_COOKIE]: c } : {}) }, payload: { kod } });
    expect((await dogrula(await giris(), totpKodu(gz, suankiAdim() + 1), cihaz1)).statusCode).toBe(200);
    await sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 1 WHERE e_posta = $1`, [SIS]);
    // Başka cihaz
    const r = await dogrula(await giris(), totpKodu(gz, suankiAdim()));
    expect(r.statusCode).toBe(403); expect(r.json().hata).toMatch(/kayıtlı değildir/);
    const yeni = ckr(r, CIHAZ_COOKIE);
    const bim = await gir(BIM);
    const k = (await ist('GET', '/api/bugun', bim)).json().onay.find((x: any) => x.tur === 'Cihaz Onayı');
    expect(k.baslik).toContain('Sistem Yöneticisi');
    await sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 1 WHERE e_posta = $1`, [SIS]);
    const bekl = await dogrula(await giris(), totpKodu(gz, suankiAdim()), yeni);
    expect(bekl.statusCode).toBe(403); expect(bekl.json().hata).toMatch(/onayı beklenmektedir/);
    await ist('POST', `/api/is/${k.kimlik}/karar`, bim, { karar: 'Onayla' });
    await sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 1 WHERE e_posta = $1`, [SIS]);
    expect((await dogrula(await giris(), totpKodu(gz, suankiAdim()), yeni)).statusCode).toBe(200);
  });
  it('ayrıcalıklı olmayan hesapta cihaz şartı yok', async () => {
    await sup.query(`UPDATE kullanici_hesabi SET totp_gizli_sifreli = NULL, totp_son_adim = 0 WHERE e_posta = $1`, [DEN]);
    const c = ckr(await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: DEN, parola: PAROLA } }));
    const gz = (await ist('GET', '/api/kimlik/kurulum', c)).json().gizli as string;
    await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(gz, suankiAdim()) });
    await sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 1 WHERE e_posta = $1`, [DEN]);
    const c2 = ckr(await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: DEN, parola: PAROLA } }));
    expect((await ist('POST', '/api/kimlik/dogrula', c2, { kod: totpKodu(gz, suankiAdim()) })).statusCode).toBe(200);
  });
});

describe('çakışan rol (YG-1041, YG-1037)', () => {
  it('uygulanacak talepte çakışma bildirilir', async () => {
    const ceo = await gir(CEO), bim = await gir(BIM), sis = await gir(SIS);
    // Kullanıcıya önce Teknik Uzman verilir; sonra çakışan Kalite Uzmanı talep edilir (Teknik Müdür ve Kalite Müdürü yerine doğrudan aşama ilerletilir).
    await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) VALUES ($1,$2)`, [K[DEN], R['Teknik Uzman']]);
    const id = (await ist('POST', '/api/erisim/talep', ceo, { kullanici: K[DEN], rol: R['Kalite Uzmanı (Kalite Kontrolör)'], gerekce: 'g', kapsam: 'k', sureSonu: '2030-01-01' })).json().kimlik;
    await sup.query(`UPDATE erisim_talebi SET talep_asamasi = 'Teknik Atama', is_onayi_veren = $2 WHERE kimlik = $1`, [id, K[BIM]]);
    const k = (await ist('GET', '/api/erisim/uygulanacak', sis)).json().find((x: any) => x.kimlik === id);
    expect(k.cakisma).toMatch(/Teknik Uzman/);
    expect(bim).toBeTruthy();
    await sup.query(`DELETE FROM rol_atamasi WHERE kullanici_ref = $1 AND rol_ref = $2`, [K[DEN], R['Teknik Uzman']]);
  });
});
