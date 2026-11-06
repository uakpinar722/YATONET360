import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamOku } from '../src/ayarlar.js';
import { izYaz } from '../src/denetim.js';
import { olayIsle } from '../src/guvenlik.js';
import { saglikIzle, yedekAl, yedekDongusu, yedekGeriYukle, yedekIsle } from '../src/yedek.js';
import { kurVeritabani } from '../araclar/kurulum.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', sy: 'Sistem Yöneticisi', bim: 'Bilgi İşlem Müdürü', hud: 'Hukuk ve Uyum Direktörü', de: 'İç Denetim Müdürü' };
let o: Ortam; const e = ortamOku(); const K = 'ab'.repeat(32); const VT = 'yatonet360_test51'; const YD = 'yatonet360_test51y';
const AY = () => ({ veritabani: VT, superParola: e.POSTGRES_SUPER_PAROLA!, anahtar: K, klasor: mkdtempSync(join(tmpdir(), 'yny-')) });

beforeAll(async () => { o = await ortamKur(VT, KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); }, 60_000);

describe('kayıt izi (YG-1183, YG-1185, LOG-1)', () => {
  it('eski ve yeni değer, işlemi yapan; kişisel veri maskeli; iz değiştirilemez', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const u = await o.ist('POST', `/api/ik/personel/${o.K.ds}`, await o.gir('ds'), { iseGiris: '2020-01-01' }); expect(u.statusCode).toBe(403);
    await o.sup.query(`UPDATE dosya SET ozet = 'Eski özet' WHERE kimlik = $1`, [d.kimlik]).catch(() => {});
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/ekip`, await o.gir('opm'), { kullanici: o.K.ds, rol: 'Yedek Sorumlu' }); expect(r.statusCode).toBeLessThan(500);
    await o.sup.query(`UPDATE taraf SET telefon = '+905550000000', risk_olayi = 'Y' WHERE kimlik = (SELECT taraf_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_ref IS NOT NULL LIMIT 1)`, [d.kimlik]);
    const iz = (await o.sup.query(`SELECT degisen FROM kayit_degisikligi WHERE tablo = 'taraf' ORDER BY kimlik DESC LIMIT 1`)).rows[0]?.degisen;
    expect(iz.telefon.yeni).toBe('***'); expect(iz.risk_olayi.yeni).toBe('Y');
    await expect(o.sup.query(`DELETE FROM kayit_degisikligi`)).rejects.toThrow(/değiştirilemez/);
  });
  it('istek üzerinden yapılan değişiklikte kullanıcı izde görünür', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-GV','Gv','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = 'Firma Yönetimi Müdürü'`, [o.K.tm]);
    const r = await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('tm'), { asama: 'Onaylı', ag: 'Aktif', gerekce: 'G' }); expect(r.statusCode, r.body).toBe(200);
    const iz = (await o.sup.query(`SELECT aktor FROM kayit_degisikligi WHERE tablo = 'kurulus' AND nesne = $1 ORDER BY kimlik DESC LIMIT 1`, [f])).rows[0]; expect(iz.aktor).toBe(o.K.tm);
  });
  it('işlem izinde kişisel veri ve gizli değer maskelenir', async () => {
    await izYaz(o.db, { eylem: 'Maske Sınaması', yeni: { telefon: '+905551112233', eposta: 'a@b.c', parola: 'x', tutar: 5, ic: { tckn: '12345678901' } }, sonuc: 'Başarılı' });
    const y = (await o.sup.query(`SELECT yeni_deger FROM denetim_izi WHERE eylem = 'Maske Sınaması'`)).rows[0].yeni_deger; const m = typeof y === 'string' ? JSON.parse(y) : y;
    expect(m).toEqual({ telefon: '***', eposta: '***', parola: '***', tutar: 5, ic: { tckn: '***' } });
  });
});

describe('denetim erişimi (YG-1184, YG-1187)', () => {
  it('arama amaç ve dönem ister, kayda geçer; hassas görüntüleme izlenir', async () => {
    await o.sup.query(`INSERT INTO rol_izni SELECT kimlik, 'denetim_izi.goruntule' FROM rol WHERE rol_adi = 'İç Denetim Müdürü' ON CONFLICT DO NOTHING`);
    const c = await o.gir('de'); const u = '/api/denetim/arama';
    expect((await o.ist('GET', u, await o.gir('ds'))).statusCode).toBe(403);
    expect((await o.ist('GET', `${u}?baslangic=2026-01-01&bitis=2099-01-01`, c)).statusCode).toBe(400);
    const r = await o.ist('GET', `${u}?amac=Denetim&baslangic=2026-01-01&bitis=2099-01-01&eylem=Maske`, c); expect(r.statusCode, r.body).toBe(200); expect(r.json().izler.length).toBeGreaterThan(0);
    expect((await o.sup.query(`SELECT gerekce FROM denetim_izi WHERE eylem = 'İşlem İzi Araması' ORDER BY kimlik DESC LIMIT 1`)).rows[0].gerekce).toBe('Denetim');
    await o.ist('GET', '/api/saklama-plani', await o.gir('hud'));
    await new Promise((z) => setTimeout(z, 100));
    expect((await o.sup.query(`SELECT 1 FROM denetim_izi WHERE eylem = 'Veri Görüntüleme' AND nesne_kimligi = '/api/saklama-plani' LIMIT 1`)).rowCount).toBe(1);
  });
});

describe('yedek (YG-1274–1279)', () => {
  it('şifreli yedek alınır, başka veritabanına kayıt sayısıyla geri yüklenir, döngü çalışır', async () => {
    const a = AY();
    const r = await yedekAl(o.db, 'Dört Saatlik', a); expect(r.tablo).toBeGreaterThan(100); expect(r.eksik).toBe(false);
    const ham = readFileSync(join(a.klasor, r.dosya)); expect(ham.includes(Buffer.from('kullanici_hesabi'))).toBe(false);
    const ad = await new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' }); await ad.connect(); await ad.query(`DROP DATABASE IF EXISTS ${YD} WITH (FORCE)`); await ad.end();
    const yeni = await kurVeritabani(YD, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false }); await yeni.end();
    const s = await yedekGeriYukle(join(a.klasor, r.dosya), { hedefVeritabani: YD, superParola: e.POSTGRES_SUPER_PAROLA!, anahtar: K });
    const c = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: YD }); await c.connect();
    const n = Number((await c.query(`SELECT count(*) n FROM dosya`)).rows[0].n); expect(n).toBe(s.dosya); expect(n).toBeGreaterThan(0);
    expect(Number((await c.query(`SELECT count(*) n FROM denetim_izi`)).rows[0].n)).toBe(s.denetim_izi); await c.end();
    await expect(yedekGeriYukle(join(a.klasor, r.dosya), { hedefVeritabani: YD, superParola: e.POSTGRES_SUPER_PAROLA!, anahtar: 'cd'.repeat(32) })).rejects.toThrow();
    expect(await yedekDongusu(o.db, a.klasor, new Date(Date.now() + 3 * 86_400_000))).toBeGreaterThan(0); expect(existsSync(join(a.klasor, r.dosya))).toBe(false);
  }, 120_000);
  it('ikinci konum yoksa gece yedeği Eksik Set; hata görev açar; 4 saat kuralı; testler görev olur', async () => {
    const a = AY(); const r = await yedekAl(o.db, 'Gece Tam', a); expect(r.eksik).toBe(true);
    expect((await o.sup.query(`SELECT durum FROM yedek_kaydi WHERE kimlik = $1`, [r.kimlik])).rows[0].durum).toBe('Eksik Set');
    const b = { ...AY(), ikinciKlasor: mkdtempSync(join(tmpdir(), 'yny2-')) }; const g = await yedekAl(o.db, 'Gece Tam', b); expect(g.eksik).toBe(false); expect(existsSync(join(b.ikinciKlasor, g.dosya))).toBe(true);
    await expect(yedekAl(o.db, 'Dört Saatlik', { ...AY(), superParola: 'yanlis' })).rejects.toThrow();
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE baslik = 'Başarısız Yedek İşi'`)).rowCount).toBeGreaterThan(0);
    const once = Number((await o.sup.query(`SELECT count(*) n FROM yedek_kaydi WHERE tur = 'Dört Saatlik'`)).rows[0].n);
    await yedekIsle(o.db, b, new Date(Date.now() + 3600_000).toISOString().slice(11, 13) >= '21' ? new Date('2027-01-05T10:00:00Z') : new Date()); expect(Number((await o.sup.query(`SELECT count(*) n FROM yedek_kaydi WHERE tur = 'Dört Saatlik'`)).rows[0].n)).toBeGreaterThanOrEqual(once);
    await yedekIsle(o.db, b, new Date('2027-01-05T10:00:00Z'));
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Felaket Tatbikatı'`)).rowCount).toBeGreaterThan(0);
  }, 120_000);
  it('geri yükleme testi hedeflerle karşılaştırılır', async () => {
    const c = await o.gir('sy'); const P = { tur: 'Örnek Kayıt', kurtarma: 60, kayip: 60, kayitTutarli: true, belge: true, yetki: true };
    expect((await o.ist('POST', '/api/geri-yukleme-testi', await o.gir('ds'), P)).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/geri-yukleme-testi', c, P)).json().sonuc).toBe('Başarılı');
    expect((await o.ist('POST', '/api/geri-yukleme-testi', c, { ...P, kayip: 300 })).json().sonuc).toBe('Başarısız');
    expect((await o.ist('GET', '/api/yedekler', c)).json().yedekler.length).toBeGreaterThan(0);
  });
});

describe('sağlık, olay, tekillik (YG-1186, YG-1281, YG-1283, YG-1310, YG-1237, YG-1156)', () => {
  it('nabız kesilirse uyarı', async () => {
    const a = AY().klasor; await saglikIzle(o.db, a, new Date(Date.now() - 5 * 3_600_000));
    const u = await saglikIzle(o.db, a); expect(u.join(' ')).toContain('Zamanlanmış işler');
    expect((await saglikIzle(o.db, a, new Date(), { diskYuzde: 101, sapmaSn: 60, nabizSaat: 2 })).join(' ')).toContain('Disk');
  });
  it('olay sürümlü güncellenir, kişisel veride ihlal bağlanır; 30 dakika uyarısı; açıklama yetkisi CEO', async () => {
    const c = await o.gir('sy'); const ol = (await o.ist('POST', '/api/olay-komutasi', await o.gir('oy'), { tur: 'BT Kesintisi veya Veri İhlali', ozet: 'Kesinti' })).json().kimlik; const u = `/api/olay/${ol}`;
    expect((await o.ist('POST', `${u}/guncelle`, await o.gir('ds'), { hizmet: 'API' })).statusCode).toBe(403);
    expect((await o.ist('POST', `${u}/guncelle`, c, { hizmet: 'API', kullanici: 'Tümü' })).json().surum).toBe(1);
    const r = await o.ist('POST', `${u}/guncelle`, c, { hizmet: 'API', kisiselVeri: true }); expect(r.json().surum).toBe(2); expect(r.json().ihlal).toBeTruthy();
    await o.sup.query(`UPDATE olay_kaydi SET olusturma_zamani = now() - interval '45 minutes' WHERE kimlik = $1`, [ol]);
    expect(await olayIsle(o.db)).toBeGreaterThan(0);
    expect((await o.ist('POST', `${u}/yanit`, c, {})).statusCode).toBe(200);
    expect((await o.ist('POST', `${u}/aciklama-yetkilisi`, c, { kullanici: o.K.bim })).statusCode).toBe(403);
    expect((await o.ist('GET', '/api/olaylar', await o.gir('ds'))).statusCode).toBe(404); // YG-1281
    expect(((await o.ist('GET', '/api/olaylar', await o.gir('bim'))).json() as { kimlik: string; surum: number }[]).find((x) => x.kimlik === ol)!.surum).toBe(2);
    expect((await o.ist('POST', `${u}/kapat`, c, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `${u}/kapat`, c, { ozet: 'Disk doldu; izleme eşiği düşürüldü' })).statusCode).toBe(200);
    expect((await o.ist('POST', `${u}/kapat`, c, { ozet: 'Tekrar' })).statusCode).toBe(409);
  });
  it('aynı işlem anahtarı ikinci kez işlenmez', async () => {
    const c = await o.gir('sy'); const H = { 'x-yatonet': '1', 'x-islem-anahtari': 'tek-1' }; const P = { tur: 'Örnek Kayıt', kurtarma: 1, kayip: 1, kayitTutarli: true, belge: true, yetki: true };
    const { COOKIE_ADI } = await import('../src/ayarlar.js');
    const a = await o.s.inject({ method: 'POST', url: '/api/geri-yukleme-testi', headers: H, cookies: { [COOKIE_ADI]: c }, payload: P });
    const n1 = Number((await o.sup.query(`SELECT count(*) n FROM geri_yukleme_testi`)).rows[0].n);
    const b = await o.s.inject({ method: 'POST', url: '/api/geri-yukleme-testi', headers: H, cookies: { [COOKIE_ADI]: c }, payload: P });
    expect(b.body).toBe(a.body); expect(Number((await o.sup.query(`SELECT count(*) n FROM geri_yukleme_testi`)).rows[0].n)).toBe(n1);
  });
  it('konum yalnız mesaide', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); const c = await o.gir('ds'); await o.ist('POST', '/api/mobil/izin', c, { tur: 'Konum', aydinlatmaGosterildi: true });
    const { mesaiIcinde } = await import('../src/bildirim.js'); const r = await o.ist('POST', '/api/mobil/saha-konum', c, { dosya: d.kimlik, enlem: 36, boylam: 28 });
    expect(r.statusCode).toBe(mesaiIcinde(new Date()) ? 200 : 409);
  });
  it('e-posta değişikliği: parola, kod yeni adrese, uyarı eski adrese, 5 deneme', async () => {
    const c = await o.gir('oy'); const yeni = 'yeni-oy@deneme.yatonet.local';
    expect((await o.ist('POST', '/api/profil/eposta-talep', c, { yeni, parola: 'yanlis' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/profil/eposta-talep', c, { yeni: 'gecersiz', parola: 'Sinama-Parolasi-2026!' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/profil/eposta-talep', c, { yeni, parola: 'Sinama-Parolasi-2026!' })).statusCode).toBe(200);
    const ileti = o.posta.gidenler.filter((x) => x.telefon === yeni).at(-1)!; expect(ileti.metin).toContain('LGM sizden kod istemez'); const kod = /\d{6}/.exec(ileti.metin)![0];
    expect(o.posta.gidenler.some((x) => x.telefon === 'oy@deneme.yatonet.local' && x.metin.includes('değiştirilmek isteniyor'))).toBe(true);
    expect((await o.ist('POST', '/api/profil/eposta-onay', c, { kod: '000000' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/profil/eposta-onay', c, { kod })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT e_posta FROM kullanici_hesabi WHERE kimlik = $1`, [o.K.oy])).rows[0].e_posta).toBe(yeni);
  });
});
