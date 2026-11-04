import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { kartAc } from '../src/is_motoru.js';
import { parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';

const VT = 'yatonet360_test4'; const PAROLA = 'Sinama-Parolasi-2026!';
const CEO = 'ceo@deneme.yatonet.local', SIS = 'sistem@deneme.yatonet.local', DEN = 'denetci@deneme.yatonet.local', YAT = 'yatsahibi@deneme.yatonet.local';
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool; const sms = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const cerez = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: { [COOKIE_ADI]: c }, payload });
const oturum: Record<string, string> = {};
const K: Record<string, string> = {}; const R: Record<string, string> = {};

async function gir(ep: string) {
  if (oturum[ep]) return oturum[ep]!;
  const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: ep, parola: PAROLA } });
  const c = cerez(g);
  if (g.json().yontem === 'sms') {
    await ist('POST', '/api/kimlik/sms', c);
    return (oturum[ep] = cerez(await ist('POST', '/api/kimlik/dogrula', c, { kod: sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0] })));
  }
  const q = await ist('GET', '/api/kimlik/kurulum', c);
  return (oturum[ep] = cerez(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) })));
}
const bugun = async (ep: string) => (await ist('GET', '/api/bugun', await gir(ep))).json();
const karar = async (ep: string, id: string, k: string, gerekce?: string) => ist('POST', `/api/is/${id}/karar`, await gir(ep), { karar: k, gerekce });

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [await parolaOzetle(PAROLA)]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  for (const [ep] of [[CEO], [SIS], [DEN], [YAT]]) K[ep!] = (await sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rows[0].kimlik;
  for (const ad of ['CEO', 'İç Denetçi', 'Sistem Yöneticisi']) R[ad] = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik;
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  s = await sunucuKur({ db, sms, eposta: new DenemeKutusu(null), anahtar: 'aa'.repeat(32), guvenliCerez: false, webAdresi: 'http://x' });
});
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });
beforeEach(async () => { await sup.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE kapanma_zamani IS NULL`); });

const iki = () => kartAc(db, { tur: 'Deneme', baslik: 'İki Kademe', hazirlayan: K[SIS], zincir: [R['İç Denetçi']!, R['CEO']!] });

describe('onay zinciri (YG-1637)', () => {
  it('kart sıradaki makama düşer; ara kademede Onaya Gönder, son makamda Onayla', async () => {
    const id = await iki();
    expect((await bugun(DEN)).onay.map((x: any) => x.kimlik)).toContain(id);
    expect((await bugun(CEO)).onay.map((x: any) => x.kimlik)).not.toContain(id);
    expect((await bugun(DEN)).onay.find((x: any) => x.kimlik === id).sonraki_rol).toBe('CEO');
    expect((await karar(DEN, id, 'Onayla')).statusCode).toBe(400);
    expect((await karar(DEN, id, 'Onaya Gönder')).json()).toEqual({ durum: 'Bekliyor', kademe: 1 });
    expect((await bugun(DEN)).onay.map((x: any) => x.kimlik)).not.toContain(id);
    expect((await karar(CEO, id, 'Onaya Gönder')).statusCode).toBe(400);
    expect((await karar(CEO, id, 'Onayla')).json().durum).toBe('Onaylandı');
    expect((await bugun(SIS)).gonderilmis.map((x: any) => x.kimlik)).not.toContain(id);
  });
  it('hazırlayan "[Makam] Kontrolünde" ve kademeyi görür (YG-1636)', async () => {
    const id = await iki();
    const g = (await bugun(SIS)).gonderilmis.find((x: any) => x.kimlik === id);
    expect(g).toMatchObject({ makam: 'İç Denetçi', kademe: 0, kademe_sayisi: 2 });
  });
  it('makamı olmayan karar veremez', async () => {
    const id = await iki();
    expect((await karar(CEO, id, 'Gerekçeyle İade Et', 'x')).statusCode).toBe(403);
    expect((await karar(YAT, id, 'Onaya Gönder')).statusCode).toBe(403);
  });
  it('hazırlayan kendi kaydını onaylayamaz, listede de görmez (YG-1034)', async () => {
    const id = await kartAc(db, { tur: 'Deneme', baslik: 'Kendi', hazirlayan: K[CEO], zincir: [R['CEO']!] });
    expect((await bugun(CEO)).onay.map((x: any) => x.kimlik)).not.toContain(id);
    expect((await karar(CEO, id, 'Onayla')).statusCode).toBe(403);
  });
  it('iki rol taşıyan kişi aynı kaydı iki kez onaylayamaz (YG-990)', async () => {
    await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) VALUES ($1,$2)`, [K[DEN], R['CEO']]);
    const id = await iki();
    await karar(DEN, id, 'Onaya Gönder');
    expect((await bugun(DEN)).onay.map((x: any) => x.kimlik)).not.toContain(id);
    expect((await karar(DEN, id, 'Onayla')).statusCode).toBe(403);
    await sup.query(`DELETE FROM rol_atamasi WHERE kullanici_ref = $1 AND rol_ref = $2`, [K[DEN], R['CEO']]);
  });
  it('iade gerekçesi zorunlu; iade hazırlayana döner, yeniden gönderilebilir, önceki karar veren yine karar verir', async () => {
    const id = await iki();
    expect((await karar(DEN, id, 'Gerekçeyle İade Et', '  ')).statusCode).toBe(400);
    expect((await karar(DEN, id, 'Gerekçeyle İade Et', 'Eksik bilgi')).json().durum).toBe('İade Edildi');
    const b1 = await bugun(SIS);
    expect(b1.iade.find((x: any) => x.kimlik === id).gerekce).toBe('Eksik bilgi');
    expect((await karar(DEN, id, 'Onaya Gönder')).statusCode).toBe(409);
    expect((await karar(CEO, id, 'Yeniden Gönder')).statusCode).toBe(403);
    expect((await karar(SIS, id, 'Yeniden Gönder')).json()).toEqual({ durum: 'Bekliyor', kademe: 0 });
    expect((await bugun(DEN)).onay.map((x: any) => x.kimlik)).toContain(id);
    expect((await karar(DEN, id, 'Onaya Gönder')).statusCode).toBe(200);
  });
  it('kapanan kartta karar verilemez; geçmiş silinmez, izlenir', async () => {
    const id = await kartAc(db, { tur: 'Deneme', baslik: 'Tek', hazirlayan: K[SIS], zincir: [R['CEO']!] });
    await karar(CEO, id, 'Reddet', 'Uygun değil');
    expect((await karar(CEO, id, 'Onayla')).statusCode).toBe(409);
    const a = await sup.query(`SELECT karar, gerekce, yapan_ref FROM is_karti_adim WHERE is_ref = $1`, [id]);
    expect(a.rows).toEqual([{ karar: 'Reddet', gerekce: 'Uygun değil', yapan_ref: K[CEO] }]);
    expect((await sup.query(`SELECT count(*)::int n FROM denetim_izi WHERE nesne_kimligi = $1 AND eylem = 'İş Kartı: Reddet'`, [id])).rows[0].n).toBe(1);
    await expect(db.query(`DELETE FROM is_karti_adim`)).rejects.toThrow();
  });
  it('red gerekçesi zorunlu', async () => {
    const id = await kartAc(db, { tur: 'Deneme', baslik: 'Tek', hazirlayan: K[SIS], zincir: [R['CEO']!] });
    expect((await karar(CEO, id, 'Reddet')).statusCode).toBe(400);
  });
  it('sıradaki makama ve hazırlayana bildirim gider', async () => {
    await sup.query(`UPDATE bildirim SET okunma_zamani = now() WHERE okunma_zamani IS NULL`);
    const id = await iki();
    expect((await bugun(DEN)).okunmamisBildirim).toBe(1);
    await karar(DEN, id, 'Onaya Gönder');
    expect((await bugun(CEO)).okunmamisBildirim).toBe(1);
    await karar(CEO, id, 'Onayla');
    const l = (await ist('GET', '/api/bildirimler', await gir(SIS))).json();
    expect(l[0].baslik).toMatch(/^Onaylandı/);
    await ist('POST', '/api/bildirimler/okundu', await gir(SIS));
    expect((await bugun(SIS)).okunmamisBildirim).toBe(0);
  });
});

describe('Bugün (YG-1635)', () => {
  it('Süre Uyarıları en yakın 5 iş, yakın olan önde', async () => {
    for (const h of [50, 3, 200, 1, 90, 400, 30]) await kartAc(db, { tur: 'Deneme', baslik: `S${h}`, sahipKullanici: K[CEO], sonZaman: new Date(Date.now() + h * 3_600_000) });
    const b = await bugun(CEO);
    expect(b.sureUyarilari.map((x: any) => x.baslik)).toEqual(['S1', 'S3', 'S30', 'S50', 'S90']);
  });
  it('işlem kartı yalnız sahibinde; rol sahibi de görür; Tamamlandı kapanır', async () => {
    const a = await kartAc(db, { tur: 'Deneme', baslik: 'K', sahipKullanici: K[CEO] });
    const r = await kartAc(db, { tur: 'Deneme', baslik: 'R', sahipRol: R['İç Denetçi']! });
    expect((await bugun(CEO)).islem.map((x: any) => x.kimlik)).toContain(a);
    expect((await bugun(DEN)).islem.map((x: any) => x.kimlik)).toEqual([r]);
    expect((await karar(DEN, a, 'Tamamlandı')).statusCode).toBe(403);
    expect((await karar(CEO, a, 'Tamamlandı')).json().durum).toBe('Tamamlandı');
  });
  it('Olağanüstü Olay Dönemi görünür, bitince kalkar (YG-1629)', async () => {
    expect((await bugun(CEO)).olaganustu).toBeNull();
    await sup.query(`INSERT INTO olaganustu_donem DEFAULT VALUES`);
    expect((await bugun(YAT)).olaganustu).not.toBeNull();
    await sup.query(`UPDATE olaganustu_donem SET bitis = now()`);
    expect((await bugun(CEO)).olaganustu).toBeNull();
  });
  it('zorunlu duyuru Okudum ile düşer ve kaydedilir; dış kullanıcı LGM duyurusunu görmez (YG-1632)', async () => {
    const z = await sup.query(`INSERT INTO duyuru (baslik, zorunlu, kapsam) VALUES ('Z', true, 'Tümü') RETURNING kimlik`);
    const l = await sup.query(`INSERT INTO duyuru (baslik, kapsam) VALUES ('L', 'LGM') RETURNING kimlik`);
    expect((await bugun(YAT)).duyurular.map((d: any) => d.baslik)).not.toContain('L');
    expect((await ist('POST', `/api/duyuru/${l.rows[0].kimlik}/okudum`, await gir(YAT))).statusCode).toBe(404);
    expect((await bugun(CEO)).duyurular.map((d: any) => d.baslik)).toEqual(expect.arrayContaining(['Z', 'L']));
    await ist('POST', `/api/duyuru/${z.rows[0].kimlik}/okudum`, await gir(CEO));
    expect((await bugun(CEO)).duyurular.map((d: any) => d.baslik)).not.toContain('Z');
    expect((await sup.query(`SELECT count(*)::int n FROM duyuru_okuma WHERE duyuru_ref = $1`, [z.rows[0].kimlik])).rows[0].n).toBe(1);
  });
});
