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

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', sy: 'Sistem Yöneticisi', bim: 'Bilgi İşlem Müdürü', bimy: 'Bilgi İşlem Müdür Yardımcısı', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', hud: 'Hukuk ve Uyum Direktörü', de: 'İç Denetim Müdürü' };
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
    const r = await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('tm'), { asama: 'İncelemede', gerekce: 'Belge doğrulaması' }); await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('tm'), { asama: 'Onaylı', ag: 'Aktif', gerekce: 'G' }); expect(r.statusCode, r.body).toBe(200);
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
    const c = await o.gir('sy'); const P = { tur: 'Örnek Kayıt', kurtarma: 60, kayip: 60, kayitTutarli: true, belge: true, yetki: true, iliski: true, butunluk: true, entegrasyon: true, ornekAkis: true };
    expect((await o.ist('POST', '/api/geri-yukleme-testi', await o.gir('ds'), P)).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/geri-yukleme-testi', c, P)).json().sonuc).toBe('Başarılı');
    expect((await o.ist('POST', '/api/geri-yukleme-testi', c, { ...P, kayip: 300 })).json().sonuc).toBe('Başarısız');
    expect((await o.ist('POST', '/api/geri-yukleme-testi', c, { ...P, kayip: 300, surecSinifi: 'Önemli' })).json().sonuc).toBe('Başarılı'); // YG1279-HEDEF: Önemli sınıfta 24 saat
    expect((await o.ist('POST', '/api/geri-yukleme-testi', c, { ...P, ornekAkis: false })).json().sonuc).toBe('Başarısız');
    expect((await o.ist('GET', '/api/yedekler', c)).json().yedekler.length).toBeGreaterThan(0);
  });
});

describe('sağlık, olay, tekillik (YG-1186, YG-1281, YG-1283, YG-1310, YG-1237, YG-1156)', () => {
  it('nabız kesilirse uyarı', async () => {
    const a = AY().klasor; await saglikIzle(o.db, a, new Date(Date.now() - 5 * 3_600_000));
    const u = await saglikIzle(o.db, a); expect(u.join(' ')).toContain('Zamanlanmış işler');
    expect((await saglikIzle(o.db, a, new Date(), { diskYuzde: 101, sapmaSn: 60, nabizSaat: 2 })).join(' ')).toContain('Disk');
    // YG-511 (T-YG511): kuyruk gecikmesi teknik uyarıdır
    await o.sup.query(`INSERT INTO gonderim (olay_anahtari, kanal, hedef, konu, metin, plan_zamani) VALUES ('t-511','E-posta','x@y.z','K','M', now() - interval '45 minutes')`);
    expect((await saglikIzle(o.db, a)).join(' ')).toContain('Gönderim kuyruğunda');
    await o.sup.query(`UPDATE gonderim SET durum = 'Gönderildi' WHERE olay_anahtari = 't-511'`);
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
    expect((await o.ist('POST', `${u}/kapat`, c, { ozet: 'Disk doldu; izleme eşiği düşürüldü', kanit: 'Disk doluluğu %40' })).statusCode).toBe(200);
    expect((await o.ist('POST', `${u}/kapat`, c, { ozet: 'Tekrar', kanit: 'Tekrar' })).statusCode).toBe(409);
  });
  it('aynı işlem anahtarı ikinci kez işlenmez', async () => {
    const c = await o.gir('sy'); const H = { 'x-yatonet': '1', 'x-islem-anahtari': 'tek-1' }; const P = { tur: 'Örnek Kayıt', kurtarma: 1, kayip: 1, kayitTutarli: true, belge: true, yetki: true, iliski: true, butunluk: true, entegrasyon: true, ornekAkis: true };
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
  it('tam geri yükleme testi sonucu BİMY, BİM ve Direktör onayıyla kabul edilir (YG-1278)', async () => {
    const r = await o.ist('POST', '/api/geri-yukleme-testi', await o.gir('sy'), { tur: 'Tam Sistem', kurtarma: 120, kayip: 30, kayitTutarli: true, belge: true, yetki: true, iliski: true, butunluk: true, entegrasyon: true, ornekAkis: true });
    expect(r.statusCode, r.body).toBe(200);
    const t = (await o.sup.query(`SELECT kimlik, kabul FROM geri_yukleme_testi WHERE tur = 'Tam Sistem' ORDER BY zaman DESC LIMIT 1`)).rows[0]; expect(t.kabul).toBe('Onay Bekliyor');
    const k = await o.kart('Geri Yükleme Testi Sonucu', t.kimlik);
    for (const [rol, kr] of [['bimy', 'Onaya Gönder'], ['bim', 'Onaya Gönder'], ['btd', 'Onayla']]) { const x = await o.karar(k.kimlik, rol!, kr!); expect(x.statusCode, x.body).toBe(200); }
    expect((await o.sup.query(`SELECT kabul FROM geri_yukleme_testi WHERE kimlik = $1`, [t.kimlik])).rows[0].kabul).toBe('Kabul Edildi');
  });
  it('yedek işlemi talebi BİM ve Direktör onayıyla yapılır (YG-1277)', async () => {
    const sy = await o.gir('sy'); const yd = (await o.sup.query(`INSERT INTO yedek_kaydi (tur, durum) VALUES ('Gece Tam','Başarılı') RETURNING kimlik`)).rows[0].kimlik; const u = `/api/yedek/${yd}/islem-talebi`;
    expect((await o.ist('POST', u, await o.gir('ds'), { islem: 'Silme', gerekce: 'X' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, sy, { islem: 'Silme' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, sy, { islem: 'Saklama Süresi Değişikliği', gerekce: 'Uzatma' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, sy, { islem: 'Silme', gerekce: 'Bozuk set' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', u, sy, { islem: 'Silme', gerekce: 'Tekrar' })).statusCode).toBe(409);
    const k = await o.kart('Yedek İşlem Talebi', r.json().kimlik);
    for (const [rol, kr] of [['bim', 'Onaya Gönder'], ['btd', 'Onayla']]) { const x = await o.karar(k.kimlik, rol!, kr!); expect(x.statusCode, x.body).toBe(200); }
    expect((await o.ist('GET', '/api/yedek/islem-talepleri', sy)).json().talepler.find((x: any) => x.kimlik === r.json().kimlik).durum).toBe('Onaylandı');
  });
  it('olay kaydı önem, adım, zaman çizelgesi, ana olay bağı ve kapanış kanıtı taşır (YG-1285)', async () => {
    const oy = await o.gir('oy'); const c = await o.gir('sy');
    const ana = (await o.ist('POST', '/api/olay-komutasi', oy, { tur: 'BT Kesintisi veya Veri İhlali', ozet: 'Portal erişilemiyor' })).json().kimlik;
    const yan = (await o.ist('POST', '/api/olay-komutasi', oy, { tur: 'BT Kesintisi veya Veri İhlali', ozet: 'Kullanıcı: giriş yapılamıyor' })).json().kimlik;
    expect((await o.ist('POST', `/api/olay/${ana}/guncelle`, c, { onem: 'Felaket' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/olay/${ana}/guncelle`, c, { onem: 'Yüksek', belirti: 'Zaman aşımı', isSonucu: 'Portal kullanılamıyor', hizmet: 'Portal' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/olay/${ana}/adim`, c, { tur: 'İletişim', metin: 'Kullanıcılara duyuru' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/olay/${yan}/bagla`, c, { anaOlay: ana })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/olay/${yan}/kapat`, c, { ozet: 'X', kanit: 'Y' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/olay/${ana}/kapat`, c, { ozet: 'Sertifika yenilendi' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/olay/${ana}/kapat`, c, { ozet: 'Sertifika yenilendi', kanit: 'Giriş denemesi başarılı' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM olay_kaydi WHERE kimlik = $1`, [yan])).rows[0].durum).toBe('Kapalı');
    const z = (await o.ist('GET', `/api/olay/${ana}/zaman-cizelgesi`, c)).json().map((x: { tur: string }) => x.tur);
    expect(z).toEqual(expect.arrayContaining(['Başlangıç', 'İletişim', 'Etki Güncellemesi', 'Bağlı Kayıt', 'Kapanış']));
  });
  it('başarısız yedek OLY olay kaydına bağlanır; örnek test sonucu BİMY ye gider (YG-1642, YG-1644)', async () => {
    const yk = (await o.sup.query(`INSERT INTO yedek_kaydi (tur, durum, hata) VALUES ('Dört Saatlik', 'Başarısız', 'Disk dolu') RETURNING kimlik`)).rows[0].kimlik;
    const sy = await o.gir('sy');
    expect((await o.ist('POST', `/api/yedek/${yk}/olay-bagla`, await o.gir('ds'), {})).statusCode).toBe(403);
    const r = await o.ist('POST', `/api/yedek/${yk}/olay-bagla`, sy, {}); expect(r.statusCode, r.body).toBe(200); expect(r.json().olayNo).toMatch(/^OLY-\d{4}-\d{4}$/);
    expect((await o.ist('POST', `/api/yedek/${yk}/olay-bagla`, sy, {})).statusCode).toBe(409);
    await o.ist('POST', '/api/geri-yukleme-testi', sy, { tur: 'Örnek Kayıt', kurtarma: 10, kayip: 0, kayitTutarli: true, belge: true, yetki: true, iliski: true, butunluk: true, entegrasyon: true, ornekAkis: true });
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE 'Örnek Geri Yükleme Testi%'`, [o.K.bimy])).rows[0].n).toBeGreaterThan(0);
  });
  it('Direktör vekili Bilgi İşlem Müdürünün kendi işi GMY onayına gider (YG-1647)', async () => {
    const { zinciriDuzelt } = await import('../src/makam.js'); const { rolId } = await import('../src/ihbar.js');
    const btd = await rolId(o.db, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'); const gmy = await rolId(o.db, 'Genel Müdür Yardımcısı');
    expect(await zinciriDuzelt(o.db, [btd], o.K.bim)).toEqual([btd]);
    await o.sup.query(`INSERT INTO vekalet (kimlik, asil_ref, vekil_ref, rol_ref, vekalet_nedeni, kapsam, baslangic_tarihi, bitis_tarihi, atayan_ref) VALUES ('VKL-2026-8647',$1,$2,$3,'İzin','Açık işler',current_date,current_date + 3,$1)`, [o.K.btd, o.K.bim, btd]);
    expect(await zinciriDuzelt(o.db, [btd], o.K.bim)).toEqual([gmy]);
    expect(await zinciriDuzelt(o.db, [btd], o.K.sy)).toEqual([btd]);
    await o.sup.query(`UPDATE vekalet SET durum = 'Kapalı', kapanis_zamani = now() WHERE kimlik = 'VKL-2026-8647'`);
  });
  it('sürüm notu Duyuru da yayımlanır; acil değişiklik Direktörün sonradan onayına gider (YG-1413)', async () => {
    const sy = await o.gir('sy'); const no = `9.${Date.now() % 100000}`;
    expect((await o.ist('POST', '/api/surum-notu', await o.gir('ds'), { surum: no, notlar: 'X' })).statusCode).toBe(403);
    const r = await o.ist('POST', '/api/surum-notu', sy, { surum: no, notlar: 'Giriş ekranı hızlandırıldı', acil: true }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', '/api/surum-notu', sy, { surum: no, notlar: 'Y' })).statusCode).toBe(409);
    expect((await o.sup.query(`SELECT durum, kapsam FROM duyuru WHERE kimlik = $1`, [r.json().duyuru])).rows[0]).toEqual({ durum: 'Yayında', kapsam: 'Tümü' });
    const k = await o.kart('Acil Platform Değişikliği', r.json().kimlik); expect((await o.karar(k.kimlik, 'btd', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT sonradan_onay FROM yazilim_surumu WHERE kimlik = $1`, [r.json().kimlik])).rows[0].sonradan_onay).toBe('Onaylandı');
  });
});

describe('yetki matrisi değişiklik süreci (YG-996)', () => {
  it('gerekçeli talep, rol makamı ve Direktör onayıyla matrise uygulanır; kaldırılan izin kayıtlı kalır', async () => {
    const sy = await o.gir('sy'); const T = { rol: 'Teknik Uzman', izin: 'firma.kayit', islem: 'Ekle', risk: 'Orta', gerekce: 'Sahada firma belgesi yükleme işlevi eklendi' };
    expect((await o.ist('POST', '/api/yetki-matrisi/talep', await o.gir('ds'), T)).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/yetki-matrisi/talep', sy, { ...T, gerekce: '' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/yetki-matrisi/talep', sy, { ...T, izin: 'yok.boyle' })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/yetki-matrisi/talep', sy, T); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', '/api/yetki-matrisi/talep', sy, T)).statusCode).toBe(409);
    const k = await o.kart('Yetki Matrisi Değişikliği', r.json().kimlik); expect(k.zincir).toHaveLength(2);
    expect((await o.karar(k.kimlik, 'tm', 'Onaya Gönder')).statusCode).toBe(200);
    expect((await o.karar(k.kimlik, 'btd', 'Onayla')).statusCode).toBe(200);
    const v = (await o.ist('GET', '/api/yetki-matrisi?rol=Teknik Uzman', await o.gir('btd'))).json(); expect(v.rolIzinleri).toContain('firma.kayit');
    const r2 = await o.ist('POST', '/api/yetki-matrisi/talep', sy, { ...T, islem: 'Kaldır', risk: 'Düşük', gerekce: 'İşlev kaldırıldı' }); expect(r2.statusCode, r2.body).toBe(200);
    const k2 = await o.kart('Yetki Matrisi Değişikliği', r2.json().kimlik); const a1 = await o.karar(k2.kimlik, 'tm', 'Onaya Gönder'); expect(a1.statusCode, a1.body).toBe(200); const a2 = await o.karar(k2.kimlik, 'btd', 'Onayla'); expect(a2.statusCode, a2.body).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM yetki_matrisi_talebi WHERE kimlik = $1`, [r2.json().kimlik])).rows[0].durum).toBe('Onaylandı');
    expect((await o.sup.query(`SELECT count(*)::int n FROM rol_izni_kaldirilan x JOIN rol r ON r.kimlik = x.rol_ref WHERE r.rol_adi = 'Teknik Uzman' AND x.izin = 'firma.kayit'`)).rows[0].n).toBe(1);
    expect((await o.ist('GET', '/api/yetki-matrisi?rol=Teknik Uzman', sy)).json().rolIzinleri).not.toContain('firma.kayit');
  });
});

describe('arayüz metni çeviri kütüphanesi (YG-1390, YG-1391)', () => {
  it('öneri hazırlayanda, onay Direktörde; hukuki metnin İngilizcesi yalnız CEO onayıyla; onaylanmayan karşılık sunulmaz', async () => {
    const sy = await o.gir('sy'); const btd = await o.gir('btd'); const ds = await o.gir('ds');
    expect((await o.ist('POST', '/api/arayuz-metni/oneri', ds, { tr: 'Deneme Etiketi', en: 'Test Label' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/arayuz-metni/oneri', sy, { tr: 'Deneme Etiketi', en: 'Test Label' })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/arayuz-metni/oneri', sy, { tr: 'Deneme Hukuki', en: 'Test Legal', hukuki: true })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/arayuz-metinleri', ds)).json().en['Deneme Etiketi']).toBeUndefined();
    expect((await o.ist('POST', '/api/arayuz-metni/onay', ds, { metinler: ['Deneme Etiketi'] })).statusCode).toBe(403);
    const r = await o.ist('POST', '/api/arayuz-metni/onay', btd, { metinler: ['Deneme Etiketi', 'Deneme Hukuki'] }); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().onaylanan).toBe(1); expect(r.json().uyari).toContain('CEO');
    const s = (await o.ist('GET', '/api/arayuz-metinleri', ds)).json().en; expect(s['Deneme Etiketi']).toBe('Test Label'); expect(s['Deneme Hukuki']).toBeUndefined();
    expect((await o.ist('POST', '/api/arayuz-metni/oneri', sy, { tr: 'Deneme Etiketi', en: 'Trial Label' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/arayuz-metinleri', ds)).json().en['Deneme Etiketi']).toBe('Test Label'); // yeni öneri onaylanana kadar eski onaylı karşılık
    expect((await o.sup.query(`SELECT count(*)::int n FROM arayuz_metni WHERE hukuki AND tr = 'Cayma Hakkımı Kullanmak İstiyorum'`)).rows[0].n).toBe(1);
  });
});

describe('mobil sürüm kontrolü (YG-490)', () => {
  it('sürüm bilgisi oturumsuz okunur; yalnız Sistem Yöneticisi girer; en düşük sürüm güncelden büyük olamaz', async () => {
    const { surumKarsilastir } = await import('../src/mobil.js');
    expect(surumKarsilastir('0.9.9', '0.10.0')).toBeLessThan(0); expect(surumKarsilastir('1.2.3', '1.2.3')).toBe(0);
    const r = await o.ist('GET', '/api/mobil/surum?platform=android'); expect(r.statusCode, r.body).toBe(200); expect(r.json().enAz).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await o.ist('GET', '/api/mobil/surum?platform=symbian')).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/mobil/surum', await o.gir('ds'), { platform: 'android', enAz: '0.1.0', guncel: '0.2.0' })).statusCode).toBe(403);
    const sy = await o.gir('sy');
    expect((await o.ist('POST', '/api/mobil/surum', sy, { platform: 'android', enAz: '0.3.0', guncel: '0.2.0' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/mobil/surum', sy, { platform: 'android', enAz: '0.1.0', guncel: '0.2.0' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/mobil/surum?platform=android')).json().guncel).toBe('0.2.0');
  });
});

describe('eğitim ortamı (YG-1398, YG-1399)', () => {
  it('ortam bilgisi oturumsuz okunur; eğitim ortamında dış ileti üretilmez', async () => {
    expect((await o.ist('GET', '/api/ortam')).json().ortam).not.toBe('egitim');
    const { disGonder } = await import('../src/bildirim.js'); const once = process.env.YATONET_ORTAM;
    process.env.YATONET_ORTAM = 'egitim';
    try {
      expect((await o.ist('GET', '/api/ortam')).json().ortam).toBe('egitim');
      const n0 = (await o.sup.query(`SELECT count(*)::int n FROM gonderim`)).rows[0].n;
      expect(await disGonder(o.db, { olay: `egitim-${Date.now()}`, telefon: '+905320000000', eposta: 'x@ornek.com', konu: 'K', metin: 'M' })).toBe(true);
      const n1 = (await o.sup.query(`SELECT count(*)::int n FROM gonderim`)).rows[0].n; expect(n1).toBe(n0);
    } finally { if (once === undefined) delete process.env.YATONET_ORTAM; else process.env.YATONET_ORTAM = once; }
  });
  it('senaryo puanlanır, engellenecek adımda sistem durdurur, sıfırlanır; üç başarı olmadan yeni personel ilk dosyaya atanamaz (YG-1399, YG-1400)', async () => {
    type Sc = { metin: string; dogru?: boolean; durdurur?: string }; type Ad = { secenekler: Sc[] };
    const c = await o.gir('sy'); const k = o.K.sy;
    const l = (await o.ist('GET', '/api/egitim/senaryolar', c)).json(); expect(l.kapi).toBe(3); expect(l.basarili).toBe(0);
    const sn = (await o.sup.query(`SELECT kod, adimlar FROM egitim_senaryosu WHERE aktif ORDER BY sira`)).rows as { kod: string; adimlar: Ad[] }[];
    expect(sn.length).toBeGreaterThanOrEqual(6); expect(l.senaryolar.map((x: { kod: string }) => x.kod)).toEqual(sn.map((x) => x.kod));
    const oyna = async (s: (typeof sn)[number], yanlis: boolean) => {
      const b = (await o.ist('POST', `/api/egitim/senaryo/${s.kod}/basla`, c, {})).json(); expect(b.adim.no).toBe(1); expect(JSON.stringify(b)).not.toMatch(/"dogru"|durdurur/);
      let r; for (const a of s.adimlar) { const n = a.secenekler.findIndex((x) => (yanlis ? Boolean(x.durdurur) : Boolean(x.dogru))); r = (await o.ist('POST', `/api/egitim/deneme/${b.deneme}/cevap`, c, { secim: n })).json(); }
      return r;
    };
    const y = await oyna(sn[0]!, true); expect(y.sonuc.durum).toBe('Kaldı'); expect(y.puan).toBe(0); expect(y.durdurma).toBe(sn[0]!.adimlar.length); expect(y.sistemMesaji).toBeTruthy();
    // Sıfırlama: süren deneme kapanır, yeni deneme ilk adımdan başlar.
    const b1 = (await o.ist('POST', `/api/egitim/senaryo/${sn[1]!.kod}/basla`, c, {})).json(); await o.ist('POST', `/api/egitim/deneme/${b1.deneme}/cevap`, c, { secim: 0 });
    expect((await o.ist('POST', `/api/egitim/deneme/${b1.deneme}/cevap`, c, { secim: 99 })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/egitim/senaryo/${sn[1]!.kod}/sifirla`, c, {})).statusCode).toBe(200);
    const b2 = (await o.ist('POST', `/api/egitim/senaryo/${sn[1]!.kod}/basla`, c, {})).json(); expect(b2.deneme).not.toBe(b1.deneme); expect(b2.adim.no).toBe(1); expect(b2.puan).toBe(0);
    expect((await o.ist('POST', `/api/egitim/deneme/${b1.deneme}/cevap`, c, { secim: 0 })).statusCode).toBe(404);
    // Başka kullanıcının denemesine erişilemez; dış kullanıcı uçları göremez.
    expect((await o.ist('POST', `/api/egitim/deneme/${b2.deneme}/cevap`, await o.gir('ds'), { secim: 0 })).statusCode).toBe(404);
    // Kapı: bugün işe giren ve hiç dosyada görev almamış kişi üç başarılı senaryo olmadan atanamaz.
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) VALUES ($1, current_date, $1) ON CONFLICT (kullanici_ref) DO UPDATE SET ise_giris_tarihi = current_date`, [k]);
    const { egitimKapisi } = await import('../src/egitim.js');
    expect(await egitimKapisi(o.db, k!)).toMatch(/3 eğitim senaryosunu.*tamamlanan: 0/);
    for (const s of sn.slice(2, 5)) expect((await oyna(s, false)).sonuc.durum).toBe('Geçti');
    expect((await o.ist('GET', '/api/egitim/senaryolar', c)).json().basarili).toBe(3);
    expect((await o.sup.query(`SELECT count(*)::int n FROM egitim_basarisi b JOIN kullanici_hesabi h ON lower(h.e_posta) = lower(b.eposta) WHERE h.kimlik = $1`, [k])).rows[0].n).toBe(3);
    expect(await egitimKapisi(o.db, k!)).toBeNull();
    // Canlı (üretim) ortamda senaryolar açılmaz.
    const once = process.env.YATONET_ORTAM; process.env.YATONET_ORTAM = 'uretim';
    try { expect((await o.ist('GET', '/api/egitim/senaryolar', c)).statusCode).toBe(404); } finally { if (once === undefined) delete process.env.YATONET_ORTAM; else process.env.YATONET_ORTAM = once; }
    await o.sup.query(`UPDATE personel_karti SET ise_giris_tarihi = '2020-01-01' WHERE kullanici_ref = $1`, [k]);
  });
});
