import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { kurVeritabani, denemeHesaplari } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { base32, coz, suankiAdim, totpDogrula, totpKodu } from '../src/kripto.js';
import { beklemeDakikasi, kimlikNormalle } from '../src/kimlik.js';
import { parolaKuraliHatasi, parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';

const VT = 'yatonet360_test';
const ANAHTAR = 'ab'.repeat(32);
const PAROLA = 'Sinama-Parolasi-2026!';
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool; const sms = new DenemeKutusu(null);

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [await parolaOzetle(PAROLA)]);
  // Bu dosya kimlik ve yetkiyi sınar; ilk giriş adımları ilk_giris.test.ts içindedir.
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  s = await sunucuKur({ db, sms, anahtar: ANAHTAR, guvenliCerez: false });
});
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });
beforeEach(async () => {
  await sup.query(`UPDATE kullanici_hesabi SET basarisiz_giris_sayisi = 0, kilit_bitis_zamani = NULL, hesap_durumu = 'Aktif', totp_son_adim = 0, totp_gizli_sifreli = NULL`);
  await sup.query(`UPDATE oturum SET bitis_zamani = now() WHERE bitis_zamani IS NULL`);
  sms.gidenler.length = 0;
});

const H = { 'x-yatonet': '1' };
const CEO = 'ceo@deneme.yatonet.local', SISTEM = 'sistem@deneme.yatonet.local', DENETCI = 'denetci@deneme.yatonet.local', YAT = 'yatsahibi@deneme.yatonet.local';
const cerez = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const giris = (k: string, p = PAROLA) => s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: k, parola: p } });
const ist = (m: 'GET' | 'POST', url: string, c: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: { [COOKIE_ADI]: c }, payload });

/** Doğrulama uygulaması hesabıyla tam giriş; tam oturum çerezini döndürür. */
async function tamGiris(k: string) {
  const g = await giris(k); const c = cerez(g);
  const q = await ist('GET', '/api/kimlik/kurulum', c);
  const kod = totpKodu(q.json().gizli, suankiAdim());
  const d = await ist('POST', '/api/kimlik/dogrula', c, { kod });
  expect(d.statusCode).toBe(200);
  return cerez(d);
}
const smsKodu = () => sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0];

describe('kurallar', () => {
  it('YG-1155 bekleme süreleri', () => {
    expect([1, 4].map(beklemeDakikasi)).toEqual([null, null]);
    expect([5, 10, 15, 20].map(beklemeDakikasi)).toEqual([15, 30, 60, 120]);
    expect(beklemeDakikasi(100)).toBe(1440);
  });
  it('YG-1152 parola kuralı', () => {
    expect(parolaKuraliHatasi('kisa')).toMatch(/12/);
    expect(parolaKuraliHatasi('passwordpassword')).toBeTruthy();
    expect(parolaKuraliHatasi(PAROLA)).toBeNull();
  });
  it('RFC 6238 test vektörü', () => {
    const g = base32(Buffer.from('12345678901234567890'));
    expect(totpKodu(g, Math.floor(59 / 30))).toBe('287082');
    expect(totpKodu(g, Math.floor(1111111109 / 30))).toBe('081804');
  });
  it('kullanılmış doğrulama adımı tekrar kabul edilmez', () => {
    const g = base32(Buffer.from('12345678901234567890')); const a = suankiAdim();
    expect(totpDogrula(g, totpKodu(g, a), a)).toBeNull();
    expect(totpDogrula(g, totpKodu(g, a), a - 2)).toBe(a);
  });
  it('kimlik biçimleri', () => {
    expect(kimlikNormalle('0555 000 00 04')).toEqual({ telefon: '+905550000004' });
    expect(kimlikNormalle('A@B.COM')).toEqual({ eposta: 'a@b.com' });
    expect(kimlikNormalle('rastgele')).toEqual({});
  });
});

describe('giriş', () => {
  it('parola tek başına oturum açmaz', async () => {
    const g = await giris(CEO);
    expect(g.json()).toMatchObject({ asama: 'kod', yontem: 'uygulama', kurulumGerekli: true, smsAcik: false });
    expect((await ist('GET', '/api/ben', cerez(g))).statusCode).toBe(401);
  });
  it('bilinmeyen hesap ve yanlış parola aynı yanıtı alır', async () => {
    const a = await giris('yok@deneme.yatonet.local'); const b = await giris(CEO, 'yanlis-parola-12345');
    expect(a.statusCode).toBe(401); expect(b.statusCode).toBe(401); expect(a.json().hata).toBe(b.json().hata);
  });
  it('doğrulama sonrası belirteç yenilenir, eskisi geçersiz olur (YG-1154)', async () => {
    const g = await giris(CEO); const eski = cerez(g);
    const q = await ist('GET', '/api/kimlik/kurulum', eski);
    const d = await ist('POST', '/api/kimlik/dogrula', eski, { kod: totpKodu(q.json().gizli, suankiAdim()) });
    const yeni = cerez(d);
    expect(yeni).not.toBe(eski);
    expect((await ist('GET', '/api/ben', eski)).statusCode).toBe(401);
    expect((await ist('GET', '/api/ben', yeni)).json().roller[0].rol_adi).toBe('CEO');
  });
  it('doğrulama uygulaması gizli değeri şifreli saklanır', async () => {
    const g = await giris(CEO); const q = await ist('GET', '/api/kimlik/kurulum', cerez(g));
    const { rows } = await sup.query(`SELECT totp_gizli_sifreli t FROM kullanici_hesabi WHERE e_posta = $1`, [CEO]);
    expect(rows[0].t).not.toContain(q.json().gizli);
    expect(coz(rows[0].t, ANAHTAR)).toBe(q.json().gizli);
  });
  it('kurulu hesapta kurulum ekranı yeniden açılmaz (YG-1156)', async () => {
    await tamGiris(CEO);
    const g = await giris(CEO);
    expect((await ist('GET', '/api/kimlik/kurulum', cerez(g))).statusCode).toBe(409);
  });
  it('5 hatada bekletilir; doğru parola da kabul edilmez (YG-1155)', async () => {
    for (let i = 0; i < 5; i++) await giris(DENETCI, 'yanlis-parola-12345');
    const g = await giris(DENETCI);
    expect(g.statusCode).toBe(423); expect(g.json().hata).toMatch(/dakika/);
  });
  it('kod hataları da aynı sayaca girer', async () => {
    const c = cerez(await giris(DENETCI));
    await ist('GET', '/api/kimlik/kurulum', c);
    for (let i = 0; i < 5; i++) await ist('POST', '/api/kimlik/dogrula', c, { kod: '000000' });
    expect((await giris(DENETCI)).statusCode).toBe(423);
  });
  it('askıdaki hesap giremez, durum yalnız doğru parolada söylenir (YG-1049)', async () => {
    await sup.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Askıda' WHERE e_posta = $1`, [DENETCI]);
    expect((await giris(DENETCI, 'yanlis-parola-12345')).statusCode).toBe(401);
    const g = await giris(DENETCI); expect(g.statusCode).toBe(403); expect(g.json().hata).toMatch(/askı/);
  });
  it('askıya alınan hesabın açık oturumu düşer (YG-1050)', async () => {
    const c = await tamGiris(DENETCI);
    await sup.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Askıda' WHERE e_posta = $1`, [DENETCI]);
    expect((await ist('GET', '/api/ben', c)).statusCode).toBe(401);
  });
  it('telefonla giriş ve yat sahibinde SMS kodu (YG-1150)', async () => {
    const g = await giris('0555 000 00 04'); const c = cerez(g);
    expect(g.json()).toMatchObject({ yontem: 'sms', smsAcik: true });
    expect((await ist('POST', '/api/kimlik/sms', c)).statusCode).toBe(200);
    expect(sms.gidenler).toHaveLength(1);
    expect((await ist('POST', '/api/kimlik/sms', c)).statusCode).toBe(429);
    const d = await ist('POST', '/api/kimlik/dogrula', c, { kod: smsKodu() });
    expect(d.statusCode).toBe(200);
    expect((await ist('GET', '/api/ben', cerez(d))).json().grup).toMatch(/Bireysel/);
  });
  it('SMS kodu tek kullanımlık ve süreli', async () => {
    const c = cerez(await giris(YAT)); await ist('POST', '/api/kimlik/sms', c);
    await sup.query(`UPDATE sms_kodu SET son_gecerlilik = now() - interval '1 second'`);
    expect((await ist('POST', '/api/kimlik/dogrula', c, { kod: smsKodu() })).statusCode).toBe(401);
  });
  it('LGM personeli ve ayrıcalıklı hesap SMS kodu isteyemez (YG-1006)', async () => {
    for (const k of [CEO, SISTEM]) expect((await ist('POST', '/api/kimlik/sms', cerez(await giris(k)))).statusCode).toBe(403);
    expect(sms.gidenler).toHaveLength(0);
  });
  it('üst bilgisiz durum değiştiren istek reddedilir', async () => {
    const r = await s.inject({ method: 'POST', url: '/api/kimlik/giris', payload: { kimlik: CEO, parola: PAROLA } });
    expect(r.statusCode).toBe(403);
  });
});

describe('oturum süreleri (YG-1153)', () => {
  const geri = (dk: number, k: string) => sup.query(`UPDATE oturum o SET son_islem_zamani = now() - make_interval(mins => $1) FROM kullanici_hesabi h WHERE h.kimlik = o.kullanici_ref AND h.e_posta = $2 AND o.bitis_zamani IS NULL`, [dk, k]);
  it('olağan hesap 30 dakikada kapanır', async () => {
    const c = await tamGiris(CEO);
    await geri(29, CEO); expect((await ist('GET', '/api/ben', c)).statusCode).toBe(200);
    await geri(31, CEO); expect((await ist('GET', '/api/ben', c)).statusCode).toBe(401);
    const { rows } = await sup.query(`SELECT bitis_nedeni FROM oturum WHERE kullanici_ref = (SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1) ORDER BY olusturma_zamani DESC LIMIT 1`, [CEO]);
    expect(rows[0].bitis_nedeni).toBe('Hareketsizlik');
  });
  it('ayrıcalıklı hesap 15 dakikada kapanır', async () => {
    const c = await tamGiris(SISTEM); await geri(16, SISTEM);
    expect((await ist('GET', '/api/ben', c)).statusCode).toBe(401);
  });
  it('12 saat üst sınırı', async () => {
    const c = await tamGiris(CEO);
    await sup.query(`UPDATE oturum SET azami_bitis_zamani = now() - interval '1 minute' WHERE bitis_zamani IS NULL`);
    expect((await ist('GET', '/api/ben', c)).statusCode).toBe(401);
  });
  it('çıkış oturumu geçersiz kılar', async () => {
    const c = await tamGiris(CEO); await ist('POST', '/api/kimlik/cikis', c);
    expect((await ist('GET', '/api/ben', c)).statusCode).toBe(401);
  });
  it('parola değişiminde diğer oturumlar kapanır', async () => {
    const c1 = await tamGiris(CEO);
    const g = await giris(CEO); const q = await sup.query(`SELECT totp_gizli_sifreli t FROM kullanici_hesabi WHERE e_posta = $1`, [CEO]);
    await sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 0 WHERE e_posta = $1`, [CEO]);
    const d = await ist('POST', '/api/kimlik/dogrula', cerez(g), { kod: totpKodu(coz(q.rows[0].t, ANAHTAR), suankiAdim()) });
    const c2 = cerez(d);
    expect((await ist('POST', '/api/kimlik/parola', c2, { eski: PAROLA, yeni: 'kisa' })).statusCode).toBe(400);
    expect((await ist('POST', '/api/kimlik/parola', c2, { eski: PAROLA, yeni: PAROLA + 'X' })).statusCode).toBe(200);
    expect((await ist('GET', '/api/ben', c1)).statusCode).toBe(401);
    expect((await ist('GET', '/api/ben', c2)).statusCode).toBe(200);
    await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1 WHERE e_posta = $2`, [await parolaOzetle(PAROLA), CEO]);
  });
});

describe('yetki (YG-987, YG-992)', () => {
  it('izinsiz rol reddedilir ve deneme izlenir', async () => {
    const c = await tamGiris(CEO);
    expect((await ist('GET', '/api/yetki/roller', c)).statusCode).toBe(403);
    expect((await ist('GET', '/api/denetim/izler', c)).statusCode).toBe(403);
    const { rows } = await sup.query(`SELECT eylem FROM denetim_izi ORDER BY kimlik DESC LIMIT 1`);
    expect(rows[0].eylem).toBe('Yetkisiz Erişim Denemesi');
  });
  it('oturumsuz erişim reddedilir', async () => {
    expect((await s.inject({ url: '/api/yetki/roller' })).statusCode).toBe(401);
    expect((await s.inject({ url: '/api/denetim/izler' })).statusCode).toBe(401);
  });
  it('yetkili rol görür; görüntüleme de kayda geçer (YG-1187)', async () => {
    const c = await tamGiris(DENETCI);
    const r = await ist('GET', '/api/denetim/izler', c);
    expect(r.statusCode).toBe(200); expect(r.json()[0].eylem).toBe('İşlem İzi Görüntülendi');
    const roller = await ist('GET', '/api/yetki/roller', await tamGiris(SISTEM));
    expect(roller.json().length).toBe(56);
  });
  it('süresi biten rol ataması yetki vermez (YG-1008)', async () => {
    const c = await tamGiris(DENETCI);
    await sup.query(`UPDATE rol_atamasi a SET baslangic_tarihi = current_date - 10, bitis_tarihi = current_date - 1 FROM kullanici_hesabi h WHERE h.kimlik = a.kullanici_ref AND h.e_posta = $1`, [DENETCI]);
    expect((await ist('GET', '/api/denetim/izler', c)).statusCode).toBe(403);
    await sup.query(`UPDATE rol_atamasi a SET bitis_tarihi = NULL FROM kullanici_hesabi h WHERE h.kimlik = a.kullanici_ref AND h.e_posta = $1`, [DENETCI]);
  });
  it('atayan ile onaylayan aynı olamaz (YG-1008)', async () => {
    const { rows } = await sup.query(`SELECT kimlik FROM kullanici_hesabi LIMIT 1`);
    await expect(sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref, baslangic_tarihi, atayan_ref, onaylayan_ref) VALUES ($1, 'ROL-005', current_date, $1, $1)`, [rows[0].kimlik])).rejects.toThrow();
  });
});

describe('işlem izi (YG-1183, YG-1186)', () => {
  it('uygulama hesabı izi değiştiremez ve silemez', async () => {
    await giris('yok@deneme.yatonet.local');
    await expect(db.query(`UPDATE denetim_izi SET eylem = 'x'`)).rejects.toThrow();
    await expect(db.query(`DELETE FROM denetim_izi`)).rejects.toThrow();
    await expect(db.query(`TRUNCATE denetim_izi`)).rejects.toThrow();
  });
  it('tam yetkili hesap da tetikleyici nedeniyle değiştiremez', async () => {
    await expect(sup.query(`UPDATE denetim_izi SET eylem = 'x'`)).rejects.toThrow(/değiştirilemez/);
    await expect(sup.query(`DELETE FROM denetim_izi`)).rejects.toThrow(/değiştirilemez/);
  });
  it('kayıtlar zincirlidir', async () => {
    await giris('yok@deneme.yatonet.local'); await giris('yok2@deneme.yatonet.local');
    const { rows } = await sup.query(`SELECT onceki_butunluk, butunluk_degeri FROM denetim_izi ORDER BY kimlik DESC LIMIT 2`);
    expect(rows[0].onceki_butunluk).toBe(rows[1].butunluk_degeri);
    expect(rows[0].butunluk_degeri).toMatch(/^[0-9a-f]{64}$/);
  });
  it('iz kaydında parola ve kod bulunmaz (YG-1147)', async () => {
    const c = cerez(await giris(YAT)); await ist('POST', '/api/kimlik/sms', c); const kod = smsKodu();
    await ist('POST', '/api/kimlik/dogrula', c, { kod });
    const { rows } = await sup.query(`SELECT t::text AS m FROM denetim_izi t`);
    const hepsi = rows.map((r) => r.m).join('\n');
    expect(hepsi).not.toContain(PAROLA); expect(hepsi).not.toContain(kod);
  });
});

describe('başlangıç verisi (YG-1124)', () => {
  it('değer listeleri ve roller yüklü', async () => {
    expect((await sup.query(`SELECT count(*)::int n FROM deger_listesi`)).rows[0].n).toBe(2626);
    const o = (await sup.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = 'LST_OLCU_BIRIMI'`)).rows.map((r) => r.deger);
    expect(o).toContain('m² × kat');
    expect((await sup.query(`SELECT kademe FROM rol WHERE rol_adi = 'Teknik Yönetici'`)).rows[0].kademe).toBe('Yönetici');
    expect((await sup.query(`SELECT kademe FROM rol WHERE rol_adi = 'Sistem Yöneticisi'`)).rows[0].kademe).toBe('Sistem Yöneticisi');
    expect((await sup.query(`SELECT kademe FROM rol WHERE rol_adi = 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı'`)).rows[0].kademe).toBe('Müdür Yardımcısı');
  });
  it('Türkçe sıralama', async () => {
    const { rows } = await sup.query(`SELECT rol_adi FROM rol WHERE rol_adi IN ('İç Denetçi','Hukuk ve Uyum Uzmanı','Kalite Müdürü') ORDER BY rol_adi`);
    expect(rows.map((r) => r.rol_adi)).toEqual(['Hukuk ve Uyum Uzmanı', 'İç Denetçi', 'Kalite Müdürü']);
  });
});
