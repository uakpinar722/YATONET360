import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ihbarHafta, ihbarTazminati, kidemTazminati, netDakika, personelDurumIsle } from '../src/ik.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', ds2: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', iks: 'İnsan Kaynakları Sorumlusu', ikm: 'İnsan Kaynakları Müdürü', isg: 'İSG Sorumlusu', gmy: 'Genel Müdür Yardımcısı', hud: 'Hukuk ve Uyum Direktörü', tid: 'Ticari İşler Direktörü' };
let o: Ortam;
const kart = async (k: string, ek: object = {}) => { const r = await o.ist('POST', `/api/ik/personel/${o.K[k]}`, await o.gir('iks'), { iseGiris: '2020-01-01', ...ek }); expect(r.statusCode, r.body).toBe(200); };
const gecmis = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString().slice(0, 10);
const ileri = (g: number) => new Date(Date.now() + g * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => { o = await ortamKur('yatonet360_test45', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('hesaplar (YG-977, YG-978)', () => {
  it('ihbar süresi kıdeme göre', () => {
    expect(ihbarHafta('2026-01-01', '2026-06-30')).toBe(2); expect(ihbarHafta('2026-01-01', '2026-07-01')).toBe(4); expect(ihbarHafta('2025-01-01', '2026-07-01')).toBe(6); expect(ihbarHafta('2023-01-01', '2026-01-01')).toBe(6); expect(ihbarHafta('2023-01-01', '2026-01-02')).toBe(8);
  });
  it('kıdem: tavan, artık gün, bir yıl ve istifa', () => {
    expect(kidemTazminati({ giris: '2020-01-01', son: '2023-01-01', brutAylik: 30000, tavan: 50000, tur: 'İşveren Feshi' })).toBe(90000);
    expect(kidemTazminati({ giris: '2020-01-01', son: '2023-01-01', brutAylik: 60000, tavan: 50000, tur: 'Emeklilik' })).toBe(150000);
    expect(kidemTazminati({ giris: '2022-01-01', son: '2023-07-02', brutAylik: 36500, tavan: 50000, tur: 'İşveren Feshi' })).toBe(R(36500 * (1 + 182 / 365)));
    expect(kidemTazminati({ giris: '2022-06-01', son: '2023-01-01', brutAylik: 30000, tavan: 50000, tur: 'İşveren Feshi' })).toBe(0);
    expect(kidemTazminati({ giris: '2020-01-01', son: '2023-01-01', brutAylik: 30000, tavan: 50000, tur: 'İstifa' })).toBe(0);
  });
  it('ihbar tazminatı: eksik gün, ödeyen, mutabakat', () => {
    const G = { giris: '2020-01-01', bildirim: '2026-01-01', son: '2026-01-29', brutAylik: 30000 };
    expect(ihbarTazminati({ ...G, tur: 'İşveren Feshi', mutabakat: false })).toEqual({ hafta: 8, eksikGun: 28, tutar: 28000, odeyen: 'LGM' });
    expect(ihbarTazminati({ ...G, tur: 'İstifa', mutabakat: false }).odeyen).toBe('Çalışan');
    expect(ihbarTazminati({ ...G, tur: 'İstifa', mutabakat: true }).tutar).toBe(0);
    expect(ihbarTazminati({ ...G, tur: 'Haklı Fesih (25/II)', mutabakat: false }).tutar).toBe(0);
  });
  it('ara dinlenme düşülür', () => {
    expect(netDakika('09:00', '18:00')).toBe(480); expect(netDakika('09:00', '12:00')).toBe(165); expect(netDakika('09:00', '14:00')).toBe(270); expect(netDakika(null, null, 90)).toBe(90);
  });
});
const R = (x: number) => Math.round(x * 100) / 100;

describe('eğitim, ekip engeli ve İSG (YG-941, YG-944)', () => {
  it('çok tehlikelide 16 saat, 1 yıl; süresi dolan belge atamayı engeller', async () => {
    const iks = await o.gir('iks');
    expect((await o.ist('POST', '/api/ik/egitim', iks, { personel: o.K.ds2, tur: 'İSG', ad: 'Temel İSG', saat: 8, tamamlanma: '2026-01-01' })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/ik/egitim', iks, { personel: o.K.ds2, tur: 'Tesis Oryantasyonu', ad: 'Oryantasyon', tamamlanma: '2026-01-01' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/ik/egitim', iks, { personel: o.K.ds2, tur: 'İSG', ad: 'Temel İSG', saat: 16, tamamlanma: '2026-01-01' })).json().gecerlilikSonu).toBe('2027-01-01');
    const d = await o.dosyaAc({}, {});
    await o.ist('POST', '/api/ik/egitim', iks, { personel: o.K.ds2, tur: 'Mesleki Belge', ad: 'Dalış', tamamlanma: '2020-01-01', gecerlilik: '2020-12-31' });
    const e = await o.ata(d.kimlik, 'ds2', 'Dosya Sorumlusu', 'opm'); expect(e.statusCode).toBe(409); expect(e.json().hata).toContain('Dalış');
    await o.ist('POST', '/api/ik/egitim', iks, { personel: o.K.ds2, tur: 'Mesleki Belge', ad: 'Dalış', tamamlanma: '2026-01-01', gecerlilik: '2099-01-01' });
    const r = await o.ata(d.kimlik, 'ds2', 'Dosya Sorumlusu', 'opm'); expect(r.statusCode, r.body).toBe(200);
  });
});

describe('izin kuralları ve durum (YG-949, YG-953, YG-1479)', () => {
  const izin = async (k: string, b: string, s: string, ek: object = {}) => o.ist('POST', '/api/izin', await o.gir(k), { tur: 'Yıllık', baslangic: b, bitis: s, ...ek });
  it('bölünmüş izin: talep, 60 gün, üç bölüm, 10 gün', async () => {
    await o.sup.query(`INSERT INTO izin_bakiyesi (personel_ref, yil, hak) VALUES ($1,2027,20)`, [o.K.tu]);
    await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE kullanici_ref = $1`, [o.K.tu]);
    expect((await izin('tu', '2027-02-01', '2027-02-03')).json().hata).toContain('Bölünmüş');
    expect((await izin('tu', '2027-02-01', '2027-02-03', { bolunmus: true })).statusCode).toBe(200);
    expect((await izin('tu', '2027-02-08', '2027-02-10', { bolunmus: true })).json().hata).toContain('60 takvim');
    expect((await izin('tu', '2027-05-03', '2027-05-05', { bolunmus: true })).statusCode).toBe(200);
    expect((await izin('tu', '2027-09-06', '2027-09-08', { bolunmus: true })).json().hata).toContain('en az 10 gün');
    expect((await izin('tu', '2027-09-06', '2027-09-17', { bolunmus: true })).statusCode).toBe(200);
    expect((await izin('tu', '2027-12-06', '2027-12-06', { bolunmus: true })).json().hata).toContain('üç bölüm');
  });
  it('onaylı izin puantaja işlenir; dosya ve görev vekile geçer, dönüşte geri gelir', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await kart('ds');
    await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref <> $1 AND kullanici_ref = $2`, [d.kimlik, o.K.ds]);
    const ka = (await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, sahip_kullanici_ref) VALUES ('Deneme','gorev','Deneme',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const b = ileri(3); const izinId = (await o.sup.query(`INSERT INTO izin_talebi (personel_ref, izin_turu, baslangic, bitis, gun, vekil_ref, durum) VALUES ($1,'Mazeret',$2,$3,1,$4,'Onaylandı') RETURNING kimlik`, [o.K.ds, b, b, o.K.ds2])).rows[0].kimlik;
    await personelDurumIsle(o.db, new Date(`${b}T10:00:00Z`));
    expect((await o.sup.query(`SELECT personel_durumu FROM personel_karti WHERE kullanici_ref = $1`, [o.K.ds])).rows[0].personel_durumu).toBe('İzinli');
    expect((await o.sup.query(`SELECT dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].dosya_sorumlusu_ref).toBe(o.K.ds2);
    expect((await o.sup.query(`SELECT sahip_kullanici_ref FROM is_karti WHERE kimlik = $1`, [ka])).rows[0].sahip_kullanici_ref).toBe(o.K.ds2);
    await personelDurumIsle(o.db, new Date(new Date(`${b}T10:00:00Z`).getTime() + 2 * 86_400_000));
    expect((await o.sup.query(`SELECT personel_durumu FROM personel_karti WHERE kullanici_ref = $1`, [o.K.ds])).rows[0].personel_durumu).toBe('Görevde');
    expect((await o.sup.query(`SELECT dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].dosya_sorumlusu_ref).toBe(o.K.ds);
    expect((await o.sup.query(`SELECT sahip_kullanici_ref FROM is_karti WHERE kimlik = $1`, [ka])).rows[0].sahip_kullanici_ref).toBe(o.K.ds);
    expect(izinId).toBeTruthy();
  });
});

describe('puantaj (YG-953, YG-957, YG-1492)', () => {
  it('çıkış girişten sonra; 45 saat üstü Ek-3; 270 saat; izin günü kilitli; bordro', async () => {
    await kart('oy', { brut: 45000 }); const oy = await o.gir('oy'); const iks = await o.gir('iks'); const P = (t: string, ek = {}) => ({ tarih: t, gunTuru: 'Çalışma', giris: '08:00', cikis: '18:00', ...ek });
    expect((await o.ist('POST', '/api/puantaj', oy, P('2027-03-01', { cikis: '07:00' }))).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/puantaj', oy, P('2027-03-01', { cikis: '23:00' }))).json().hata).toContain('11 saati');
    for (const t of ['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05']) expect((await o.ist('POST', '/api/puantaj', oy, P(t))).json().fazlaDakika).toBe(0);
    expect((await o.ist('POST', '/api/puantaj', oy, { tarih: '2027-03-06', gunTuru: 'Çalışma', nobetFiili: 60 })).json().hata).toContain('Ek-3');
    // YG-1489: Olağanüstü Olay Döneminde Ek-3 eksikliği fazla çalışmayı durdurmaz, uyarı döner.
    const od = (await o.sup.query(`INSERT INTO olaganustu_donem (sebep) VALUES ('Deneme') RETURNING kimlik`)).rows[0].kimlik;
    const ou = (await o.ist('POST', '/api/puantaj', oy, { tarih: '2027-03-06', gunTuru: 'Çalışma', nobetFiili: 60 })).json();
    expect(ou.fazlaDakika).toBe(60); expect(ou.uyari).toContain('Olağanüstü');
    await o.sup.query(`UPDATE olaganustu_donem SET bitis = now() WHERE kimlik = $1`, [od]);
    await kart('oy', { brut: 45000, ek3Yil: 2027 });
    expect((await o.ist('POST', '/api/puantaj', oy, { tarih: '2027-03-06', gunTuru: 'Çalışma', nobetFiili: 60 })).json().fazlaDakika).toBe(60);
    const oz = (await o.ist('GET', '/api/puantaj/ozet?ay=2027-03', iks)).json().find((x: { kimlik: string }) => x.kimlik === o.K.oy);
    expect(oz.fazla).toBe(60); expect(oz.fazlaUcretTl).toBe(R((60 / 60) * (45000 / 225) * 1.5));
    await o.sup.query(`INSERT INTO puantaj_kaydi (personel_ref, tarih, gun_turu, fazla_dakika) VALUES ($1,'2027-01-05','Çalışma',16000)`, [o.K.oy]);
    await o.sup.query(`UPDATE puantaj_kaydi SET fazla_dakika = 16190 WHERE personel_ref = $1 AND tarih = '2027-01-05'`, [o.K.oy]);
    for (const x of ['2027-04-05', '2027-04-06', '2027-04-07', '2027-04-08', '2027-04-09']) expect((await o.ist('POST', '/api/puantaj', oy, P(x))).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/puantaj', oy, P('2027-04-10'))).json().hata).toContain('270');
    expect((await o.ist('POST', '/api/puantaj/bordro', iks, { ay: '2027-03' })).json().adet).toBeGreaterThan(0);
    expect((await o.ist('POST', '/api/puantaj', oy, P('2027-03-01'))).json().hata).toContain('Bordroya');
    expect((await o.ist('GET', '/api/puantaj/ozet?ay=2027-03', oy)).statusCode).toBe(403);
  });
});

describe('disiplin (YG-954)', () => {
  it('savunmasız karar yok; süre, kesinti, fesih CEO, itiraz GMY', async () => {
    const iks = await o.gir('iks'); const ikm = await o.gir('ikm'); const p = await o.gir('tu');
    expect((await o.ist('POST', '/api/disiplin', iks, { personel: o.K.tu, olayTarihi: '2026-11-01', konu: 'K', kademe: 'Yazılı Uyarı', savunmaSon: gecmis(0) })).statusCode).toBe(409);
    const k = await o.ist('POST', '/api/disiplin', iks, { personel: o.K.tu, olayTarihi: '2026-11-01', konu: 'Geç kayıt', kademe: 'Ücret Kesme', savunmaSon: ileri(10) }); expect(k.statusCode, k.body).toBe(200); const id = k.json().kimlik;
    expect((await o.ist('POST', `/api/disiplin/${id}/karar`, ikm, { karar: 'Kesinti', gundelik: 1 })).json().hata).toContain('Savunma');
    expect((await o.ist('POST', `/api/disiplin/${id}/savunma`, await o.gir('oy'), { metin: 'X' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/disiplin/${id}/savunma`, p, { metin: 'Gerekçem' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/disiplin/${id}/karar`, iks, { karar: 'Kesinti', gundelik: 1 })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/disiplin/${id}/karar`, ikm, { karar: 'Kesinti', gundelik: 3 })).json().hata).toContain('gündeliği');
    expect((await o.ist('POST', `/api/disiplin/${id}/karar`, ikm, { karar: 'Kesinti', gundelik: 2 })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/disiplin/${id}/itiraz`, p, { metin: 'İtiraz' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/disiplin/${id}/itiraz-karar`, ikm, { sonuc: 'Ret' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/disiplin/${id}/itiraz-karar`, await o.gir('gmy'), { sonuc: 'Ret' })).statusCode).toBe(200);
    const f = (await o.ist('POST', '/api/disiplin', iks, { personel: o.K.tu, olayTarihi: '2026-11-01', konu: 'F', kademe: 'Fesih', savunmaSon: ileri(10) })).json().kimlik;
    await o.ist('POST', `/api/disiplin/${f}/savunma`, p, { metin: 'S' });
    expect((await o.ist('POST', `/api/disiplin/${f}/karar`, ikm, { karar: 'F' })).json().hata).toContain('CEO');
    const sz = await o.ist('POST', '/api/disiplin', await o.gir('oy'), { personel: o.K.tu, olayTarihi: '2026-11-01', konu: 'S', kademe: 'Sözlü Uyarı' }); expect(sz.statusCode).toBe(403);
    expect((await o.ist('GET', '/api/disiplin', p)).statusCode).toBe(403);
  });
});

describe('ayrılış (YG-975, YG-979, YG-933)', () => {
  it('devir, beyan, onay, tazminat kapısı; son gün hesap kapanır, kalan amire düşer', async () => {
    const iks = await o.gir('iks'); const ikm = await o.gir('ikm');
    await o.sup.query(`INSERT INTO egitim_kaydi (personel_ref, tur, ad, tamamlanma_tarihi, kaydeden_ref) SELECT kimlik, 'İSG', 'Temel', '2026-01-01', kimlik FROM kullanici_hesabi`);
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await kart('ds2', { brut: 30000 });
    await o.sup.query(`UPDATE personel_karti SET ise_giris_tarihi = '2020-01-01' WHERE kullanici_ref = $1`, [o.K.ds2]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Yedek Sorumlu',$3)`, [d.kimlik, o.K.ds2, o.K.opm]);
    const r = await o.ist('POST', '/api/ayrilis', iks, { personel: o.K.ds2, tur: 'İstifa', bildirim: gecmis(5), son: ileri(50) }); expect(r.statusCode, r.body).toBe(200); const id = r.json().kimlik;
    expect((await o.sup.query(`SELECT personel_durumu FROM personel_karti WHERE kullanici_ref = $1`, [o.K.ds2])).rows[0].personel_durumu).toBe('Ayrılıyor');
    const v = (await o.ist('GET', `/api/ayrilis/${id}`, iks)).json(); expect(v.devir.some((x: { tur: string }) => x.tur === 'Dosya')).toBe(true); expect(v.devir.some((x: { tur: string }) => x.tur === 'Rol')).toBe(true); expect(v.uyari).toContain('tavanı');
    expect((await o.ist('POST', `/api/ayrilis/${id}/tazminat`, iks, {})).json().hata).toContain('Devir');
    const dv = v.devir[0];
    expect((await o.ist('POST', `/api/ayrilis-devir/${dv.kimlik}`, await o.gir('oy'), { devralan: o.K.ds })).statusCode).toBe(403);
    for (const x of v.devir) expect((await o.ist('POST', `/api/ayrilis-devir/${x.kimlik}`, await o.gir('opm'), { devralan: o.K.ds })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/ayrilis/${id}/tazminat`, iks, {})).json().hata).toContain('Cihaz');
    const p = await o.gir('ds2');
    expect((await o.ist('POST', `/api/ayrilis/${id}/cihaz-onay`, await o.gir('opm'), {})).statusCode).toBe(409);
    await o.ist('POST', `/api/ayrilis/${id}/beyan`, p, { cihaz: 'Telefon ve bilgisayar teslim edildi.', gizlilik: true });
    expect((await o.ist('POST', `/api/ayrilis/${id}/cihaz-onay`, await o.gir('opm'), {})).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/ayrilis/${id}/tazminat`, iks, {})).json().hata).toContain('dilekçesi');
    await o.sup.query(`UPDATE personel_ayrilisi SET dilekce_belge = (SELECT kimlik FROM belge LIMIT 1), tur = 'Emeklilik' WHERE kimlik = $1`, [id]);
    expect((await o.ist('POST', `/api/ayrilis/${id}/tazminat`, iks, {})).json().hata).toContain('tavanı');
    expect((await o.ist('POST', '/api/ik/parametre', iks, { kod: 'kidem_tavani_tl', deger: 50000 })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/ik/parametre', ikm, { kod: 'kidem_tavani_tl', deger: 50000 })).statusCode).toBe(200);
    const t = await o.ist('POST', `/api/ayrilis/${id}/tazminat`, iks, {}); expect(t.statusCode, t.body).toBe(200); expect(t.json().kidem).toBeGreaterThan(0);
    const k = await o.kart('Ayrılış Tazminatı', id); expect((await o.karar(k.kimlik, 'gmy', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT odeme_durumu FROM personel_ayrilisi WHERE kimlik = $1`, [id])).rows[0].odeme_durumu).toBe('Ödemeye Hazır');
    await o.sup.query(`UPDATE personel_ayrilisi SET son_is_gunu = $2 WHERE kimlik = $1`, [id, gecmis(1)]);
    await personelDurumIsle(o.db);
    expect((await o.sup.query(`SELECT hesap_durumu FROM kullanici_hesabi WHERE kimlik = $1`, [o.K.ds2])).rows[0].hesap_durumu).toBe('Kapalı');
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'SGK İşten Ayrılış Bildirgesi' AND nesne_kimligi = $1`, [id])).rowCount).toBe(1);
  });
});

describe('iş kazası ve yurt dışı (YG-981, YG-1669, YG-1492, YG-972)', () => {
  it('LGM: zorunlu alan, İSG gönderir, İK kapatır; sağlık verisi Kritik', async () => {
    const ol = (await o.ist('POST', '/api/olay-komutasi', await o.gir('oy'), { tur: 'İş Kazası', ozet: 'Düşme' })).json().kimlik; const u = `/api/olay/${ol}/is-kazasi`; const oy = await o.gir('oy');
    expect((await o.ist('POST', u, oy, { isveren: 'LGM' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, oy, { isveren: 'LGM', saglikKolluk: '112', sigortaci: 'Yapıldı', saglikVerisi: true }); expect(r.statusCode, r.body).toBe(200); expect(r.json().bilgiSinifi).toBe('Kritik');
    expect((await o.ist('POST', `/api/is-kazasi/${ol}/bilgi-gonder`, oy, {})).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/is-kazasi/${ol}/bilgi-gonder`, await o.gir('isg'), {})).statusCode).toBe(200);
    expect((await o.kart('İş Kazası SGK Bildirimi', ol)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/is-kazasi/${ol}/sgk`, await o.gir('iks'), { tarih: '2026-11-04' })).statusCode).toBe(200);
    expect((await o.kart('İş Kazası SGK Bildirimi', ol)).durum).toBe('Tamamlandı');
  });
  it('Çözüm Ortağı: sayaç kartı ve Belge İste', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-IK','F','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const oy = await o.gir('oy'); const ol = (await o.ist('POST', '/api/olay-komutasi', oy, { tur: 'İş Kazası', ozet: 'Kesik' })).json().kimlik;
    expect((await o.ist('POST', `/api/olay/${ol}/is-kazasi`, oy, { isveren: 'Çözüm Ortağı', saglikKolluk: 'Yok', sigortaci: 'Yok' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/olay/${ol}/is-kazasi`, oy, { isveren: 'Çözüm Ortağı', kurulus: f, saglikKolluk: 'Yok', sigortaci: 'Yok' })).statusCode).toBe(200);
    expect((await o.kart('Bildirim Belgesi Bekleniyor', ol)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/is-kazasi/${ol}/belge-iste`, await o.gir('isg'), {})).statusCode).toBe(200);
    await o.sup.query(`UPDATE is_kazasi SET son_zaman = now() - interval '1 day' WHERE olay_ref = $1`, [ol]);
    expect(await personelDurumIsle(o.db)).toBeGreaterThan(0);
  });
  it('harcırah TİD tutarından; onay birim amiri ve GMY', async () => {
    const oy = await o.gir('oy'); const G = { ulke: 'Yunanistan', baslangic: '2027-05-01', bitis: '2027-05-03' };
    expect((await o.ist('POST', '/api/yurtdisi-gorev', oy, G)).json().hata).toContain('harcırah');
    expect((await o.ist('POST', '/api/ik/parametre', oy, { kod: 'harcirah_gunluk_eur', deger: 50 })).statusCode).toBe(403);
    await o.ist('POST', '/api/ik/parametre', await o.gir('tid'), { kod: 'harcirah_gunluk_eur', deger: 50 });
    const r = await o.ist('POST', '/api/yurtdisi-gorev', oy, G); expect(r.json()).toMatchObject({ gun: 3, harcirah: 150 });
    const k = await o.kart('Yurt Dışı Görevlendirme', r.json().kimlik); expect(k.zincir).toHaveLength(2);
    await o.karar(k.kimlik, 'opm', 'Onaya Gönder'); await o.karar(k.kimlik, 'gmy', 'Onayla');
    expect((await o.sup.query(`SELECT durum FROM yurtdisi_gorev WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('Onaylandı');
  });
  it('28 ve 48 çalışanda Hukuk ve Uyum ile GMY uyarılır, tekrar etmez', async () => {
    await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi) SELECT h.hesap_turu, h.kullanici_grubu, 'E' || g, 'esik' || g || '@x.local', 'esik' || g || '@x.local', h.parola_ozeti, h.dogrulama_yontemi FROM kullanici_hesabi h, generate_series(1, 60) g WHERE h.kimlik = $1`, [o.K.oy]);
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) SELECT kimlik, '2026-01-01', kimlik FROM kullanici_hesabi WHERE kullanici_adi LIKE 'esik%' AND kimlik NOT IN (SELECT kullanici_ref FROM personel_karti) ORDER BY kullanici_adi LIMIT 20`);
    await personelDurumIsle(o.db);
    const n = async (e: number, k: string | undefined) => (await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1 AND kullanici_ref = $2`, [`calisan-esigi:${e}`, k])).rowCount;
    expect(await n(28, o.K.hud)).toBe(0);
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) SELECT kimlik, '2026-01-01', kimlik FROM kullanici_hesabi WHERE kullanici_adi LIKE 'esik%' AND kimlik NOT IN (SELECT kullanici_ref FROM personel_karti) ORDER BY kullanici_adi LIMIT 15`);
    await personelDurumIsle(o.db);
    expect(await n(28, o.K.hud)).toBe(1); expect(await n(28, o.K.gmy)).toBe(1); expect(await n(48, o.K.hud)).toBe(0);
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) SELECT kimlik, '2026-01-01', kimlik FROM kullanici_hesabi WHERE kullanici_adi LIKE 'esik%' AND kimlik NOT IN (SELECT kullanici_ref FROM personel_karti)`);
    await personelDurumIsle(o.db); await personelDurumIsle(o.db);
    expect(await n(48, o.K.gmy)).toBe(1);
  });
  it('yurt dışı görevlendirmede durum değişir; izindeki kişiye dosya rolü verilmez (YG-1479)', async () => {
    const b = ileri(20); const s = ileri(22);
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) VALUES ($1,'2026-01-01',$1) ON CONFLICT DO NOTHING`, [o.K.tu]);
    await o.sup.query(`INSERT INTO yurtdisi_gorev (personel_ref, ulke, baslangic, bitis, gun, gunluk_eur, harcirah_eur, durum) VALUES ($1,'Yunanistan',$2,$3,3,100,300,'Onaylandı')`, [o.K.tu, b, s]);
    const dur = async () => (await o.sup.query(`SELECT personel_durumu FROM personel_karti WHERE kullanici_ref = $1`, [o.K.tu])).rows[0].personel_durumu;
    await personelDurumIsle(o.db, new Date(`${b}T10:00:00Z`)); expect(await dur()).toBe('Görevlendirmede');
    await personelDurumIsle(o.db, new Date(new Date(`${s}T10:00:00Z`).getTime() + 86_400_000)); expect(await dur()).toBe('Görevde');
    await o.sup.query(`UPDATE personel_karti SET personel_durumu = 'Raporlu' WHERE kullanici_ref = $1`, [o.K.tu]);
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET boy_m = 12, govde_malzemesi = 'CTP' WHERE kimlik = $1`, [d.kimlik]).catch(() => {});
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/ekip`, await o.gir('tm'), { kullanici: o.K.tu, rol: 'Teknik Uzman' });
    expect(r.statusCode, r.body).toBe(409); expect(r.json().hata).toContain('Raporlu');
    await o.sup.query(`UPDATE personel_karti SET personel_durumu = 'Görevde' WHERE kullanici_ref = $1`, [o.K.tu]);
  });
});

describe('tazminat neti (YG-978)', () => {
  it('kıdemden yalnız damga düşer; ihbarda gelir vergisi bordroya bırakılır; oran girilmemişse net yok', async () => {
    const { tazminatNet } = await import('../src/ik_net.js');
    expect(tazminatNet({ kidemBrut: 100000, ihbarBrut: 20000, damgaBinde: null })).toBeNull();
    const n = tazminatNet({ kidemBrut: 100000, ihbarBrut: 20000, damgaBinde: 7.59 })!;
    expect(n.kidem).toEqual({ brut: 100000, damga: 759, net: 99241 });
    expect(n.ihbar).toMatchObject({ damga: 151.8, gelirVergisi: 'Bordroda hesaplanır', netDamgaSonrasi: 19848.2 });
  });
});
