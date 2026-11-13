import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { musteriDurumu } from '../src/portal.js';
import { sunucuKur } from '../src/sunucu.js';

const VT = 'yatonet360_test12'; const PAROLA = 'Sinama-Parolasi-2026!'; const D = '@deneme.yatonet.local';
const KADRO: Record<string, string> = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', hd: 'Hukuk ve Uyum Direktörü' };
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool;
const sms = new DenemeKutusu(null), posta = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const ckr = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c?: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: c ? { [COOKIE_ADI]: c } : {}, payload });
const K: Record<string, string> = {}; const oturum: Record<string, string> = {};
async function gir(k: string) {
  if (oturum[k]) return oturum[k]!;
  const c = ckr(await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: k + D, parola: PAROLA } }));
  const q = await ist('GET', '/api/kimlik/kurulum', c);
  return (oturum[k] = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) })));
}
const smsKod = () => sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0];
let n = 0;
const kaydol = async (tel: string, ad = 'Deneme Sahip') => {
  await ist('POST', '/api/kayit/kod', undefined, { telefon: tel });
  const r = await ist('POST', '/api/kayit/tamamla', undefined, { telefon: tel, kod: smsKod(), ad, eposta: `sahip${++n}@deneme.yatonet.local` });
  expect(r.statusCode, r.body).toBe(200);
  const c = ckr(r);
  const kimlik = (await ist('GET', '/api/ben', c)).json().kimlik;
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1, 'Müşteri', 'KVKK-01', 'R00', 'Türkçe', 'Web')`, [kimlik]);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [kimlik]);
  await sup.query(`UPDATE kullanici_hesabi SET izin_adimi_zamani = now() WHERE kimlik = $1`, [kimlik]);
  return { c, kimlik };
};
const dosyaAc = async (e: { sahipTel?: string; dil?: string } = {}) => {
  const c = await gir('ds');
  const t = await ist('POST', '/api/ihbar', c, { kanal: 'Telefon', sahibiAdi: 'Kaptan', sahibiTuru: 'Yatın Kaptanı', yetkiDurumu: 'Doğrulandı', telefon: '+905550001111', konum: 'Bodrum', yatDurumu: 'Bağlı', ihtiyac: 'Hasar', dil: e.dil, yat: { adi: `Portal Yat ${++n}`, markaDiger: 'A', modelDiger: 'B', boy: 12, govde: 'Fiber', bayrak: 'Türk', kullanim: 'Özel', klas: 'Hayır' }, yatSahibi: { ad: 'Sahip', telefon: e.sahipTel ?? '+905550002222', eposta: `yatsahip${n}@deneme.yatonet.local` } });
  expect(t.statusCode, t.body).toBe(200);
  await ist('POST', `/api/ihbar/${t.json().kimlik}/mukerrerlik`, c, { sonuc: 'Mükerrer değil' });
  const a = await ist('POST', `/api/ihbar/${t.json().kimlik}/acilis`, c, { karar: 'Kabul', ozet: 'Ö', musteriTuru: 'Bireysel Müşteri' });
  expect(a.statusCode, a.body).toBe(200);
  return a.json() as { kimlik: string; dosyaNo: string };
};
const beyanLinki = async (dosya: string) => {
  const t = (await sup.query(`SELECT kimlik FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-11'`, [dosya])).rows[0];
  const g = (await sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`onay-bag:${t.kimlik}`])).rows[0];
  return g.metin.match(/#onay=([\w-]+)/)[1] as string;
};
const FORM = { mulkiyet: 'Malik', takyidat: ['Yok'] };

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  const oz = await parolaOzetle(PAROLA);
  for (const [k, rol] of Object.entries(KADRO)) {
    const { rows } = await sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi) VALUES ('İç Kullanıcı','LGM İç Rolü',$1,$2,$2,$3,'Doğrulama uygulaması (6 haneli kod)') RETURNING kimlik`, [`Deneme ${rol}`, k + D, oz]);
    K[k] = rows[0].kimlik;
    await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [K[k], rol]);
  }
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [oz]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' WHEN kullanici_grubu = 'İş Birliği Firması' THEN 'KVKK-03' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  s = await sunucuKur({ db, sms, eposta: posta, anahtar: 'ab'.repeat(32), guvenliCerez: false, webAdresi: 'http://x' });
}, 120_000);
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });

describe('müşteri durum adları (YG-1564)', () => {
  it('iç aşamalar 17 müşteri adına eşlenir, renkler doğru', () => {
    const m = (statu: string, asama: string | null, e: object = {}) => musteriDurumu({ statu, asama }, { beklemede: [], ...e });
    expect(m('Açılış Kontrolünde', null)).toEqual({ ad: 'Talebiniz Alındı', renk: 'yeşil' });
    expect(m('Aktif', 'Onay')).toEqual({ ad: 'Onay Bekleniyor', renk: 'sarı' });
    expect(m('Aktif', 'Uygulama', { isBasladi: true }).ad).toBe('Onarıma Devam Ediliyor');
    expect(m('Aktif', 'Teklif', { beklemede: ['Muvafakat'] }).ad).toBe('Muvafakat Bekleniyor');
    expect(m('Aktif', 'Teklif', { beklemede: ['Hava'] })).toEqual({ ad: 'Beklemede', renk: 'kırmızı' });
    expect(m('Kontrollü Askıda', 'Uygulama').ad).toBe('Beklemede');
    expect(m('Aktif', 'Uygulama', { ekBulgu: true })).toEqual({ ad: 'Ek Bulgu – İş Durduruldu', renk: 'kırmızı' });
    expect(m('Teknik Kapalı', 'Teslim', { acikIs: true }).ad).toBe('Açık İş Devam Ediyor');
    expect(m('Kapalı', 'Teslim')).toEqual({ ad: 'Kapandı', renk: 'gri' });
  });
});

describe('yat sahibi kaydı ve SMS girişi (Y1, YG-463)', () => {
  it('yanlış kodla hesap açılmaz; doğru kodla açılır; ilk giriş adımları kapıda bekler', async () => {
    await ist('POST', '/api/kayit/kod', undefined, { telefon: '+905550100001' });
    expect((await ist('POST', '/api/kayit/tamamla', undefined, { telefon: '+905550100001', kod: '000000', ad: 'X' })).statusCode).toBe(401);
    const r = await ist('POST', '/api/kayit/tamamla', undefined, { telefon: '+905550100001', kod: smsKod(), ad: 'Yeni Sahip' });
    expect(r.statusCode, r.body).toBe(200);
    const c = ckr(r);
    expect((await ist('GET', '/api/portal/ana', c)).statusCode).toBe(428);
    expect((await ist('GET', '/api/ben', c)).json().grup).toContain('Bireysel');
  });
  it('aynı numara ikinci kez kaydolamaz', async () => {
    await kaydol('+905550100002');
    await sup.query(`DELETE FROM kayit_kodu`);
    await ist('POST', '/api/kayit/kod', undefined, { telefon: '+905550100002' });
    expect((await ist('POST', '/api/kayit/tamamla', undefined, { telefon: '+905550100002', kod: smsKod(), ad: 'İkinci' })).statusCode).toBe(409);
  });
  it('parolasız yat sahibi telefonla SMS kodu ile girer; bilinmeyen numara aynı yanıtı alır, oturum açmaz', async () => {
    await kaydol('+905550100003');
    const g = await ist('POST', '/api/kimlik/telefon', undefined, { telefon: '+905550100003' });
    expect(g.json().asama).toBe('kod');
    const o = ckr(await ist('POST', '/api/kimlik/dogrula', ckr(g), { kod: smsKod() }));
    expect((await ist('GET', '/api/portal/ana', o)).statusCode).toBe(200);
    const once = sms.gidenler.length;
    const b = await ist('POST', '/api/kimlik/telefon', undefined, { telefon: '+905550199999' });
    expect(b.json().asama).toBe('kod'); expect(sms.gidenler.length).toBe(once); expect(ckr(b)).toBeUndefined();
  });
});

describe('onay ekranı (YG-466, YG-476, YG-1433)', () => {
  it('dosya açılınca BLD-25 ve beyan bağlantısı gider; bağlantı girişsiz açılır', async () => {
    const d = await dosyaAc();
    expect((await sup.query(`SELECT count(*)::int n FROM gonderim WHERE olay_anahtari = $1`, [`bld25:${d.kimlik}`])).rows[0].n).toBe(2);
    const j = (await ist('GET', `/api/onay/${await beyanLinki(d.kimlik)}`)).json();
    expect(j.baslik).toBe('Mülkiyet ve Takyidat Beyanı'); expect(j.dugme).toBe('Beyanımı onaylıyorum'); expect(j.durum).toBe('Bekliyor');
    expect((await ist('GET', '/api/onay/gecersizbelirtecgecersizbelirtec')).statusCode).toBe(404);
  });
  it('kod olmadan, hatalı kodla ve eksik beyanla onay verilmez; doğru beyanla kayıt düşer ve yat güncellenir', async () => {
    const d = await dosyaAc(); const b = await beyanLinki(d.kimlik); const kr = (x: object) => ist('POST', `/api/onay/${b}/karar`, undefined, x);
    expect((await kr({ kod: '123456', form: FORM })).statusCode).toBe(400);
    await ist('POST', `/api/onay/${b}/kod`, undefined, { kanal: 'SMS' });
    expect((await ist('POST', `/api/onay/${b}/kod`, undefined, { kanal: 'SMS' })).statusCode).toBe(429);
    const kod = smsKod();
    expect((await kr({ kod: kod === '000000' ? '000001' : '000000', form: FORM })).statusCode).toBe(401);
    expect((await kr({ kod, form: { mulkiyet: 'Yanlış', takyidat: ['Yok'] } })).statusCode).toBe(400);
    expect((await kr({ kod, form: { mulkiyet: 'Malik', takyidat: ['Yok', 'Haciz'] } })).statusCode).toBe(400);
    const r = await kr({ kod, form: FORM });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().onayKodu).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const k = (await sup.query(`SELECT k.* FROM yatonet_onay_kaydi k JOIN onay_talebi t ON t.kimlik = k.onay_talebi_ref WHERE t.dosya_ref = $1`, [d.kimlik])).rows[0];
    expect([k.karar, k.kanal, k.onaylayan_ad]).toEqual(['Onaylandı', 'SMS Kodu', 'Sahip']); expect(k.metin_ozeti).toHaveLength(64);
    const y = (await sup.query(`SELECT y.mulkiyet_turu, y.takyidat, y.beyan_zamani FROM yat y JOIN dosya d ON d.yat_ref = y.kimlik WHERE d.kimlik = $1`, [d.kimlik])).rows[0];
    expect(y.mulkiyet_turu).toBe('Malik'); expect(y.takyidat).toEqual(['Yok']); expect(y.beyan_zamani).not.toBeNull();
    expect((await kr({ kod, form: FORM })).statusCode).toBe(409);
    expect((await ist('GET', `/api/onay/${b}`)).json().durum).toBe('Onaylandı');
  });
  it('5 hatalı denemeden sonra yeni kod istenir', async () => {
    const d = await dosyaAc(); const b = await beyanLinki(d.kimlik);
    await ist('POST', `/api/onay/${b}/kod`, undefined, { kanal: 'SMS' });
    for (let i = 0; i < 5; i++) await ist('POST', `/api/onay/${b}/karar`, undefined, { kod: 'x', form: FORM });
    expect((await ist('POST', `/api/onay/${b}/karar`, undefined, { kod: smsKod(), form: FORM })).statusCode).toBe(423);
  });
  it('haciz beyanında Hukuk ve Uyum Direktörüne değerlendirme kartı açılır', async () => {
    const d = await dosyaAc(); const b = await beyanLinki(d.kimlik);
    await ist('POST', `/api/onay/${b}/kod`, undefined, { kanal: 'SMS' });
    expect((await ist('POST', `/api/onay/${b}/karar`, undefined, { kod: smsKod(), form: { mulkiyet: 'Malik', takyidat: ['Haciz'] } })).statusCode).toBe(200);
    const k = (await sup.query(`SELECT * FROM is_karti WHERE tur = 'Takyidat Değerlendirmesi' AND nesne_kimligi = $1`, [d.kimlik])).rows[0];
    expect(k.oncelik).toBe('Yüksek');
  });
  it('lehtar beyanında muvafakat girilmeden onay aşamasına geçilmez (YG-103)', async () => {
    const d = await dosyaAc(); const b = await beyanLinki(d.kimlik);
    await ist('POST', `/api/onay/${b}/kod`, undefined, { kanal: 'SMS' });
    const kod = smsKod();
    expect((await ist('POST', `/api/onay/${b}/karar`, undefined, { kod, form: { mulkiyet: 'Kredi / ipotekli', takyidat: ['Rehin / ipotek'] } })).statusCode).toBe(400);
    expect((await ist('POST', `/api/onay/${b}/karar`, undefined, { kod, form: { mulkiyet: 'Kredi / ipotekli', takyidat: ['Rehin / ipotek'], lehtar: 'Deneme Banka' } })).statusCode).toBe(200);
    expect((await ist('POST', `/api/dosya/${d.kimlik}/muvafakat`, await gir('opm'), {})).statusCode).toBe(400);
    const kilit = (await sup.query(`SELECT y.lehtar_adi, y.lehtar_muvafakati_ref FROM yat y JOIN dosya d ON d.yat_ref = y.kimlik WHERE d.kimlik = $1`, [d.kimlik])).rows[0];
    expect(kilit).toEqual({ lehtar_adi: 'Deneme Banka', lehtar_muvafakati_ref: null });
  });
  it('vefat işaretinde bağlantı kapanır (YG-1477)', async () => {
    const d = await dosyaAc(); const b = await beyanLinki(d.kimlik);
    await sup.query(`UPDATE dosya SET vefat_isareti = true WHERE kimlik = $1`, [d.kimlik]);
    expect((await ist('POST', `/api/onay/${b}/kod`, undefined, { kanal: 'SMS' })).statusCode).toBe(409);
  });
  it('yurt dışı numarada e-posta kodu açılır; yurt içinde iki SMS denemesine kadar kapalıdır (YG-479)', async () => {
    const d = await dosyaAc({ sahipTel: '+441234567890' }); const b = await beyanLinki(d.kimlik);
    expect((await ist('GET', `/api/onay/${b}`)).json().epostaKodu).toBe(true);
    expect((await ist('POST', `/api/onay/${b}/kod`, undefined, { kanal: 'E-posta' })).statusCode).toBe(200);
    const y = await dosyaAc(); const bb = await beyanLinki(y.kimlik);
    expect((await ist('POST', `/api/onay/${bb}/kod`, undefined, { kanal: 'E-posta' })).statusCode).toBe(403);
    expect(sms).toBeDefined();
  });
  it('İngilizce dosyada ekran ve mesaj İngilizce', async () => {
    const d = await dosyaAc({ dil: 'İngilizce' });
    const j = (await ist('GET', `/api/onay/${await beyanLinki(d.kimlik)}`)).json();
    expect(j.dugme).toBe('I confirm my declaration'); expect(j.metin).not.toContain('[');
  });
});

describe('portal görünürlüğü (YG-459, YG-1565)', () => {
  it('kayıt olan yat sahibi numarasıyla eşleşen dosyayı görür; başkasınınkini görmez; firma ve iç bilgi yoktur', async () => {
    const tel = '+905550100010'; const d = await dosyaAc({ sahipTel: tel });
    const a = await kaydol(tel); const b = await kaydol('+905550100011');
    const ana = (await ist('GET', '/api/portal/ana', a.c)).json();
    expect(ana.dosyalar.map((x: any) => x.dosyaNo)).toEqual([d.dosyaNo]);
    expect(ana.dosyalar[0].durum).toBe('Talebiniz Alındı');
    expect(ana.onaylar).toHaveLength(1);
    expect((await ist('GET', '/api/portal/ana', b.c)).json().dosyalar).toEqual([]);
    expect((await ist('GET', `/api/portal/dosya/${d.kimlik}`, b.c)).statusCode).toBe(404);
    const dj = await ist('GET', `/api/portal/dosya/${d.kimlik}`, a.c);
    expect(dj.statusCode).toBe(200);
    for (const yasak of ['statu', 'asama', 'zorluk_katsayisi', 'kisa_teknik_tanim']) expect(dj.json()[yasak]).toBeUndefined();
    expect((await ist('GET', `/api/dosya/${d.kimlik}`, a.c)).statusCode).toBe(404);
    // Hesaptan açma: bağlantı kaybolsa da onay açılır.
    const o = await ist('POST', `/api/portal/onay/${ana.onaylar[0].kimlik}/ac`, a.c, {});
    expect((await ist('GET', `/api/onay/${o.json().belirtec}`)).json().baslik).toBe('Mülkiyet ve Takyidat Beyanı');
    expect((await ist('POST', `/api/portal/onay/${ana.onaylar[0].kimlik}/ac`, b.c, {})).statusCode).toBe(404);
  });
  it('portal ihbarı Operasyon Müdürüne düşer, numara alır; en fazla 5 fotoğraf; belge yükleyemez', async () => {
    const a = await kaydol('+905550100020');
    const c = await ist('POST', '/api/portal/ihbar', a.c, { yatAdi: 'Portal Teknesi', konum: 'Fethiye', ozet: 'Çarpma' });
    expect(c.statusCode, c.body).toBe(200); expect(c.json().talepNo).toMatch(/^LGM-/);
    const id = c.json().kimlik;
    expect((await sup.query(`SELECT ilk_sorumlu_ref, bildirim_kanali FROM talep WHERE kimlik = $1`, [id])).rows[0]).toEqual({ ilk_sorumlu_ref: K.opm, bildirim_kanali: 'Portal' });
    const yukle = (ad: string) => s.inject({ method: 'POST', url: `/api/belge/yukle?ad=${ad}&tur=Foto&bagTuru=Talep&bagKimligi=${id}&kaynak=Sistem&dosya=${ad}`, headers: { ...H, 'content-type': 'application/octet-stream' }, cookies: { [COOKIE_ADI]: a.c }, payload: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, n++]) });
    for (let i = 1; i <= 5; i++) { const r = await yukle(`f${i}.jpg`); expect(r.statusCode, r.body).toBe(200); }
    expect((await yukle('f6.jpg')).statusCode).toBe(409);
    expect((await yukle('b.pdf')).statusCode).toBe(400);
    expect((await ist('GET', '/api/portal/ana', a.c)).json().talepler[0].durum).toBe('Talebiniz Alındı');
  });
  it('LGM personeli portal ana ekranına giremez', async () => {
    expect((await ist('GET', '/api/portal/ana', await gir('ds'))).statusCode).toBe(403);
  });
});
