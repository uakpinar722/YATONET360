import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { acilIsle, acilSinir, ilkIsGunu12, nobetci } from '../src/acil.js';
import { aydinlatmaKodu } from '../src/adimlar.js';
import { sigortaSureIsle } from '../src/sigorta.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { ana, ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', omy: 'Operasyon Müdür Yardımcısı', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', tod: 'Teknik ve Operasyon Direktörü', gmy: 'Genel Müdür Yardımcısı', fym: 'Firma Yönetimi Müdürü', sc: 'Sicil Sorumlusu', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', tid: 'Ticari İşler Direktörü' };
let o: Ortam; let f1: string; let f2: string; let firmaC: string; let sigortaC: string; let baskaSigortaC: string;
const PAROLA = 'Sinama-Parolasi-2026!';
const disGir = async (ep: string) => {
  const c = ana.ckr(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: ep, parola: PAROLA } }));
  const q = await o.ist('GET', '/api/kimlik/kurulum', c);
  return ana.ckr(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
};
const disHesap = async (ad: string, grup: string, rol: string) => {
  const ep = `${ad}@deneme.yatonet.local`;
  const r = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani) VALUES ('Müşteri/Kurum',$1,$2,$3,$3,$4,'Doğrulama uygulaması (6 haneli kod)',now()) RETURNING kimlik`, [grup, ad, ep, await parolaOzetle(PAROLA)])).rows[0];
  await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [r.kimlik, rol]);
  await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Müşteri',$2,'R00','Türkçe','Web')`, [r.kimlik, aydinlatmaKodu(grup)]);
  await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [r.kimlik]);
  return { kimlik: r.kimlik as string, ep };
};
const firmaKur = async (unvan: string, sira: number) => {
  const f = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan, rol: 'Çözüm Ortağı' })).json().kimlik as string;
  await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('fym'), { asama: 'Onaylı', ag: 'Aktif', gerekce: 'G' });
  await o.sup.query(`UPDATE kurulus SET acil_hizmet_verir = true, acil_arama_sirasi = $2 WHERE kimlik = $1`, [f, sira]);
  return f;
};
const CAGRI = { telefon: '+905550007777', yatAdi: 'Acil Yat', konum: 'Göcek', olay: 'Su alıyor', olayTuru: 'Su Alma veya Batma' };
const cagri = async (x: object = {}) => { const r = await o.ist('POST', '/api/acil/cagri', await o.gir('ds'), { ...CAGRI, ...x }); expect(r.statusCode, r.body).toBe(200); return r.json(); };
const firmaCagriId = async () => (await o.ist('GET', '/api/firma-portal/acil-cagrilar', firmaC)).json()[0].kimlik as string;

beforeAll(async () => {
  o = await ortamKur('yatonet360_test15', KADRO);
  f1 = await firmaKur('Birinci Servis', 1); f2 = await firmaKur('İkinci Servis', 2);
  const fk = (await o.sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = 'firma@deneme.yatonet.local'`)).rows[0].kimlik;
  await o.ist('POST', `/api/firma/${f1}/kullanici`, await o.gir('fym'), { kullanici: fk });
  firmaC = await disGir('firma@deneme.yatonet.local');
  const s1 = await disHesap('sigorta1', 'Sigorta Şirketi / Eksper', 'Sigorta Şirketi Kullanıcısı'); const s2 = await disHesap('sigorta2', 'Sigorta Şirketi / Eksper', 'Sigorta Şirketi Kullanıcısı');
  await o.sup.query(`INSERT INTO sigorta_kullanici VALUES ($1,'Deneme Sigorta'), ($2,'Başka Sigorta')`, [s1.kimlik, s2.kimlik]);
  sigortaC = await disGir(s1.ep); baskaSigortaC = await disGir(s2.ep);
}, 120_000);
afterAll(async () => { await o.kapat(); });
beforeEach(async () => { await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE bitis_zamani IS NULL`); await o.sup.query(`UPDATE acil_gorev_cagrisi SET durum = 'İptal' WHERE durum = 'Gönderildi'`); await o.sup.query(`UPDATE kurulus SET acil_musaitlik = true`); });

describe('kurallar (YG-256, YG-1473)', () => {
  it('×1,3; 2.000,00 ön uyarı, 2.500,00 sınır; can ve çevrede sınır yok', () => {
    expect(acilSinir(1000, 1.3, 2000, 2500, false)).toEqual({ yansiyan: 1300, durum: 'Sınır Altında' });
    expect(acilSinir(1538.46, 1.3, 2000, 2500, false).durum).toBe('Ön Uyarı');
    expect(acilSinir(1538.45, 1.3, 2000, 2500, false).durum).toBe('Sınır Altında');
    expect(acilSinir(1923.08, 1.3, 2000, 2500, false).durum).toBe('Onay Bekliyor');
    expect(acilSinir(1923.07, 1.3, 2000, 2500, false).durum).toBe('Ön Uyarı');
    expect(acilSinir(99999, 1.3, 2000, 2500, true).durum).toBe('Sınırsız');
  });
  it('ilk iş günü 12:00: cumartesi akşamı pazartesi, sabah aynı gün', () => {
    expect(ilkIsGunu12(new Date('2026-11-07T17:00:00Z')).toISOString()).toBe('2026-11-09T09:00:00.000Z'); // Cumartesi 20:00
    expect(ilkIsGunu12(new Date('2026-11-09T05:00:00Z')).toISOString()).toBe('2026-11-09T09:00:00.000Z'); // Pazartesi 08:00
    expect(ilkIsGunu12(new Date('2026-11-09T16:00:00Z')).toISOString()).toBe('2026-11-10T09:00:00.000Z'); // Pazartesi 19:00
  });
});

describe('nöbet (YG-244, YG-246, YG-1517)', () => {
  const v = (k: string, kat: string) => ({ katman: kat, kullanici: o.K[k], baslangic: '2020-01-01T00:00:00Z', bitis: '2099-01-01T00:00:00Z' });
  it('yetki; 10 gün kuralı; onayla yürürlüğe girer, çizelgeden nöbetçi okunur, ay başına tek yürürlükte', async () => {
    const c = await o.gir('omy');
    expect((await o.ist('POST', '/api/nobet/cizelge', await o.gir('ds'), { donem: '2099-01', vardiyalar: [v('ds', 'Dosya Sorumlusu')] })).statusCode).toBe(403);
    const buAy = new Date().toISOString().slice(0, 7);
    expect((await o.ist('POST', '/api/nobet/cizelge', c, { donem: buAy, vardiyalar: [v('ds', 'Dosya Sorumlusu')] })).statusCode).toBe(409);
    const r = await o.ist('POST', '/api/nobet/cizelge', c, { donem: buAy, degisiklik: true, vardiyalar: [v('ds', 'Dosya Sorumlusu'), v('tu', 'Teknik Uzman'), v('oy', 'Yönetici')] });
    expect(r.statusCode, r.body).toBe(200);
    expect(await nobetci(o.db, 'Dosya Sorumlusu')).toBeNull();
    await o.karar((await o.kart('Nöbet Çizelgesi', r.json().kimlik)).kimlik, 'opm', 'Onayla');
    expect(await nobetci(o.db, 'Dosya Sorumlusu')).toBe(o.K.ds);
    expect(await nobetci(o.db, 'Teknik Uzman')).toBe(o.K.tu);
    const r2 = await o.ist('POST', '/api/nobet/cizelge', c, { donem: buAy, degisiklik: true, vardiyalar: [v('ds', 'Dosya Sorumlusu'), v('tu', 'Teknik Uzman'), v('oy', 'Yönetici')] });
    await o.karar((await o.kart('Nöbet Çizelgesi', r2.json().kimlik)).kimlik, 'opm', 'Onayla');
    expect((await o.sup.query(`SELECT count(*)::int n FROM nobet_cizelgesi WHERE donem = $1 AND durum = 'Yürürlükte'`, [buAy])).rows[0].n).toBe(1);
  });
  it('devir kontrol listesi eksiksiz olmalı; devralan onaylar', async () => {
    const c = await o.gir('ds');
    expect((await o.ist('POST', '/api/nobet/devir', c, { devralan: o.K.oy, liste: ['Telefon, şarj ve batarya'] })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/nobet/devir', c, { devralan: o.K.oy, liste: ['Telefon, şarj ve batarya', 'SIM PIN ve ekran kilidi', 'WhatsApp Business ve kurumsal e-posta oturumu', 'YATONET oturumu'] });
    expect((await o.ist('POST', `/api/nobet/devir/${r.json().kimlik}/onayla`, c)).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/nobet/devir/${r.json().kimlik}/onayla`, await o.gir('oy'))).statusCode).toBe(200);
  });
});

describe('acil çağrı (YG-253, YG-255, YG-263, YG-266)', () => {
  it('kısa kayıtla dosya açılır, Kritik, tedbir bildirimi silsilesiz gider, sıradaki sağlayıcıya çağrı düşer', async () => {
    const r = await cagri();
    expect(r.cagri).toBe(`${r.dosyaNo}-ÇA01`); expect(r.uyari112).toContain('112');
    const d = (await o.sup.query(`SELECT statu, asama, oncelik, acil_gecici_acilis, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [r.kimlik])).rows[0];
    expect(d).toMatchObject({ statu: 'Aktif', oncelik: 'Kritik', acil_gecici_acilis: true, dosya_sorumlusu_ref: o.K.ds });
    for (const k of ['opm', 'tm', 'tod', 'gmy']) expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND baslik = $2`, [o.K[k], `Acil İlk Tedbir: ${r.dosyaNo}`])).rowCount).toBe(1);
    expect((await o.sup.query(`SELECT kurulus_ref FROM acil_gorev_cagrisi WHERE dosya_ref = $1`, [r.kimlik])).rows[0].kurulus_ref).toBe(f1);
    expect((await o.sup.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Teknik Uzman' AND kullanici_ref = $2`, [r.kimlik, o.K.tu])).rowCount).toBe(1);
  });
  it('tür ve zorunlu alan; firma ekranı fiyatsız, müşterisiz', async () => {
    expect((await o.ist('POST', '/api/acil/cagri', await o.gir('ds'), { ...CAGRI, olayTuru: 'Yanlış' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/acil/cagri', await o.gir('ds'), { ...CAGRI, konum: '' })).statusCode).toBe(400);
    await cagri();
    const l = (await o.ist('GET', '/api/firma-portal/acil-cagrilar', firmaC)).json()[0];
    expect(Object.keys(l).sort()).toEqual(['cagri_no', 'durum', 'kimlik', 'konum', 'olay_turu', 'son_zaman', 'tehlike', 'yat_tipi']);
  });
  it('30 dakikada yanıt yoksa Yanıtsız, sıradakine; hepsi tükenince Kaynak Bulunamadı', async () => {
    const r = await cagri();
    await o.sup.query(`UPDATE acil_gorev_cagrisi SET son_zaman = now() - interval '1 minute' WHERE dosya_ref = $1`, [r.kimlik]);
    await acilIsle(o.db);
    const c = (await o.sup.query(`SELECT kurulus_ref, durum FROM acil_gorev_cagrisi WHERE dosya_ref = $1 ORDER BY gonderim`, [r.kimlik])).rows;
    expect(c.map((x) => x.durum)).toEqual(['Yanıtsız', 'Gönderildi']); expect(c[1].kurulus_ref).toBe(f2);
    await o.sup.query(`UPDATE acil_gorev_cagrisi SET son_zaman = now() - interval '1 minute' WHERE dosya_ref = $1 AND durum = 'Gönderildi'`, [r.kimlik]);
    await acilIsle(o.db);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND baslik = $2`, [o.K.opm, `Kaynak Bulunamadı: ${r.dosyaNo}`])).rowCount).toBe(1);
  });
  it('müsait değil yanıtı sıradakine geçirir; müsait olmayan atlanır', async () => {
    await cagri();
    const y = await o.ist('POST', `/api/firma-portal/acil-cagri/${await firmaCagriId()}/yanit`, firmaC, { yanit: 'Müsait Değil' });
    expect(y.json().durum).toBe('Müsait Değil'); expect(y.json().siradaki).toContain('ÇA02');
    await o.sup.query(`UPDATE kurulus SET acil_musaitlik = false WHERE kimlik = $1`, [f1]);
    const r = await cagri();
    expect((await o.sup.query(`SELECT kurulus_ref FROM acil_gorev_cagrisi WHERE dosya_ref = $1`, [r.kimlik])).rows[0].kurulus_ref).toBe(f2);
  });
  it('kabul AC iş emri açar, tutar sayılır; 2.000 uyarı, 2.500 ONY-29; 30 dakikada GMY', async () => {
    const r = await cagri({ yatAdi: 'Tutar Yat' });
    await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, telefon, olusturan_ref) VALUES ($1,'Yat Sahibi','Sahip','+905550003333',$2)`, [r.kimlik, o.K.ds]);
    const y = await o.ist('POST', `/api/firma-portal/acil-cagri/${await firmaCagriId()}/yanit`, firmaC, { yanit: 'Kabul', tahmini: 1000 });
    expect(y.statusCode, y.body).toBe(200);
    expect(y.json()).toMatchObject({ durum: 'Kabul', isEmriNo: `${r.dosyaNo}-AC01`, yansiyan: 1300, sinirDurumu: 'Sınır Altında' });
    const u = `/api/firma-portal/is-emri/${y.json().isEmri}/acil-tutar`;
    expect((await o.ist('POST', u, firmaC, { tahmini: 1600 })).json().sinirDurumu).toBe('Ön Uyarı');
    expect((await o.ist('POST', u, firmaC, { tahmini: 2000 })).json()).toEqual({ yansiyan: 2600, sinirDurumu: 'Onay Bekliyor' });
    const t = (await o.sup.query(`SELECT metin FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-29'`, [r.kimlik])).rows[0];
    expect(t.metin).toContain('2.600,00'); expect(t.metin).toContain('Tutar Yat');
    expect((await o.ist('POST', u, firmaC, { tahmini: 2100 })).json().sinirDurumu).toBe('Onay Bekliyor');
    expect((await o.sup.query(`SELECT count(*)::int n FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-29'`, [r.kimlik])).rows[0].n).toBe(1);
    await o.sup.query(`UPDATE acil_mudahale SET sinir_onay_son = now() - interval '1 minute' WHERE dosya_ref = $1`, [r.kimlik]);
    await acilIsle(o.db);
    const k = await o.kart('Acil Tutar Onayı', r.kimlik);
    expect((await o.karar(k.kimlik, 'gmy', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT sinir_durumu FROM acil_mudahale WHERE dosya_ref = $1`, [r.kimlik])).rows[0].sinir_durumu).toBe('Onaylandı');
  });
  it('can ve çevrede sınır yok; sigortalıda aşım onayı istenmez', async () => {
    const r = await cagri({ olayTuru: 'Can Güvenliği' });
    const y = await o.ist('POST', `/api/firma-portal/acil-cagri/${await firmaCagriId()}/yanit`, firmaC, { yanit: 'Kabul', tahmini: 50000 });
    expect(y.json().sinirDurumu).toBe('Sınırsız');
    expect((await o.sup.query(`SELECT 1 FROM onay_talebi WHERE dosya_ref = $1`, [r.kimlik])).rowCount).toBe(0);
    await o.sup.query(`UPDATE acil_gorev_cagrisi SET durum = 'İptal' WHERE durum = 'Gönderildi'`);
    const s = await cagri({ musteriTuru: 'Sigorta Şirketi', sigortaci: 'Deneme Sigorta' });
    const y2 = await o.ist('POST', `/api/firma-portal/acil-cagri/${await firmaCagriId()}/yanit`, firmaC, { yanit: 'Kabul', tahmini: 50000 });
    expect(y2.statusCode, y2.body).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-29'`, [s.kimlik])).rowCount).toBe(0);
  });
  it('sigortalı dosyada kapanış BLD-74 taslağı açar; tutar ve firma adı yok; teyitsiz gitmez (YG-445)', async () => {
    const s = await cagri({ musteriTuru: 'Sigorta Şirketi', sigortaci: 'Deneme Sigorta' });
    expect((await o.ist('POST', `/api/acil/${s.kimlik}/kapat`, await o.gir('ds'), { sonuc: 'Sızıntı kesildi', risk: 'Kontrol altında' })).statusCode).toBe(200);
    const g = (await o.sup.query(`SELECT metin, durum FROM sigorta_gonderim WHERE tur = 'BLD-74' AND nesne_kimligi = $1`, [s.kimlik])).rows[0];
    expect(g.durum).toBe('Teyit Bekliyor'); expect(g.metin).toContain('Deneme Sigorta'); expect(g.metin).toContain('Sızıntı kesildi'); expect(g.metin).not.toMatch(/\d[\d.,]* EUR/); expect(g.metin).not.toContain('[');
  });
  it('elle kabul sıralı aramayı durdurur; kapanış BLD-55 gönderir, tutar yazmaz', async () => {
    const r = await cagri(); const c = await o.gir('ds');
    await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, telefon, olusturan_ref) VALUES ($1,'Yat Sahibi','Sahip','+905550003333',$2)`, [r.kimlik, o.K.ds]);
    expect((await o.ist('POST', `/api/acil/${r.kimlik}/elle-kabul`, c, { firma: f2 })).statusCode).toBe(400);
    const e = await o.ist('POST', `/api/acil/${r.kimlik}/elle-kabul`, c, { firma: f2, kanal: 'Telefon', kisi: 'Usta', talimat: 'Pompa', tahmini: 500 });
    expect(e.statusCode, e.body).toBe(200); expect(e.json().isEmriNo).toBe(`${r.dosyaNo}-AC01`);
    expect((await o.sup.query(`SELECT count(*)::int n FROM acil_gorev_cagrisi WHERE dosya_ref = $1 AND durum = 'Gönderildi'`, [r.kimlik])).rows[0].n).toBe(0);
    expect((await o.ist('POST', `/api/acil/${r.kimlik}/kapat`, c, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/acil/${r.kimlik}/kapat`, c, { sonuc: 'Sızıntı kesildi', risk: 'Kontrol altında' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`bld55:${r.kimlik}`])).rows[0].metin).not.toContain('EUR');
    expect((await o.ist('POST', `/api/acil/${r.kimlik}/kapat`, c, { sonuc: 'x', risk: 'y' })).statusCode).toBe(409);
  });
  it('emniyet durdurması işi durdurur, tüm makamlara gider; yeniden başlatma yalnız Teknik Müdür', async () => {
    const r = await cagri(); const c = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${r.kimlik}/is-durdur`, c, { neden: 'Gaz kaçağı' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT calisma_durduruldu d FROM dosya WHERE kimlik = $1`, [r.kimlik])).rows[0].d).toBe(true);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE 'Emniyet Olayı%'`, [o.K.tod])).rowCount).toBeGreaterThan(0);
    expect((await o.ist('POST', `/api/dosya/${r.kimlik}/is-baslat`, c, { gerekce: 'x' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${r.kimlik}/is-baslat`, await o.gir('tm'), {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${r.kimlik}/is-baslat`, await o.gir('tm'), { gerekce: 'Ölçüm temiz' })).statusCode).toBe(200);
  });
  it('portal acil düğmesi Diğer için açıklama ister, 112 uyarısı döner; LGM kullanamaz', async () => {
    expect((await o.ist('POST', '/api/portal/acil', await o.gir('ds'), { tur: 'Yangın' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/portal/acil', firmaC, { tur: 'Diğer', yatAdi: 'Y', konum: 'K' })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/portal/acil', firmaC, { tur: 'Yangın', yatAdi: 'Y', konum: 'K' });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().uyari112).toContain('112');
    // YG-259: nöbetçinin açmasını beklemeden Kritik dosya açılır, acil müdahale kaydı ve ihbar eden yat sahibi tarafı oluşur.
    const d = (await o.sup.query(`SELECT d.kimlik, d.oncelik, d.statu, d.asama FROM dosya d JOIN talep t ON t.dosya_ref = d.kimlik WHERE t.kimlik = $1`, [r.json().talep])).rows[0];
    expect(d).toMatchObject({ oncelik: 'Kritik', statu: 'Aktif', asama: 'Keşif' });
    expect((await o.sup.query(`SELECT olay_turu FROM acil_mudahale WHERE dosya_ref = $1`, [d.kimlik])).rows[0].olay_turu).toBe('Yangın');
    // Müşteri grubunda olmayan ihbar eden yat sahibi olarak bağlanmaz.
    expect((await o.sup.query(`SELECT taraf_rolu, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND talep_sahibi_mi`, [d.kimlik])).rows[0]).toMatchObject({ taraf_rolu: 'Kaptan', kullanici_ref: null });
  });
});

describe('sigorta portalı (YG-438, YG-1568, YG-444)', () => {
  const dosyaVeTeklif = async (ad = 'Deneme Sigorta') => {
    const d = await o.dosyaAc({ sigortaci: ad, hasarNo: `H-${Math.random()}`, sahibiTuru: 'Sigorta Şirketi', eposta: 'sg@deneme.yatonet.local' }, { musteriTuru: 'Sigorta Şirketi' });
    await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE yat SET gecici_kayit = false WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, ara_toplam_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref, sigorta_karar_son) VALUES ($1,$2,'Sigorta Şirketi',20,'Gönderildi',300,360,300,$3,now() + interval '5 days') RETURNING kimlik`, [`${d.dosyaNo}-TK01`, d.kimlik, o.K.ts])).rows[0];
    for (const [n, a] of [[1, 'A'], [2, 'B']] as const) await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur) VALUES ($1,$2,$3,'Onarım','İşçilik',1,'saat',115.38,150,150)`, [t.kimlik, n, a]);
    return { d, t: t.kimlik as string };
  };
  it('garanti portalda yalnız durum; geçerli garanti kararından sonraki teklif sigortaya faturalanmaz (YG-1421)', async () => {
    const { d } = await dosyaVeTeklif(); const no = `GS-${Date.now()}`;
    const g = (await o.sup.query(`INSERT INTO garanti_sikayet (kayit_no, dosya_ref, kayit_turu, kanal, bildirim_zamani, oncelik, karar, statu, yanit_zamani, karar_gerekcesi, olusturan_ref) VALUES ($1,$2,'{Garanti bildirimi}','Telefon',now(),'Normal','Garanti','Uygulamada',now() - interval '1 day','Gizli Gerekçe',$3) RETURNING kimlik`, [no, d.kimlik, o.K.ds])).rows[0].kimlik;
    const ana = async () => { const r = await o.ist('GET', '/api/sigorta/ana', sigortaC); return { b: r.body, k: r.json().dosyalar.find((x: any) => x.dosyaNo === d.dosyaNo) }; };
    const a1 = await ana(); expect(a1.k.garanti).toBe('İnceleme Açıldı'); expect(a1.b).not.toContain(no); expect(a1.b).not.toContain('Gizli Gerekçe');
    const { garantiFaturaEngeli } = await import('../src/garanti_sigorta.js'); const E = (m: string, z: string) => garantiFaturaEngeli(o.db, { dosya_ref: d.kimlik, teklif_muhatabi: m, olusturma_zamani: z });
    const sonra = new Date().toISOString(); const once = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(await E('Sigorta Şirketi', sonra)).toContain('faturalanmaz'); expect(await E('Yat Sahibi', sonra)).toBeNull(); expect(await E('Sigorta Şirketi', once)).toBeNull();
    await o.sup.query(`UPDATE garanti_sikayet SET statu = 'Kapalı' WHERE kimlik = $1`, [g]);
    expect((await ana()).k.garanti).toBe('İnceleme Kapandı'); expect(await E('Sigorta Şirketi', sonra)).toBeNull();
  });
  it('yalnız kendi dosyası; firma ve maliyet görünmez; hasar no ayrı', async () => {
    const { d, t } = await dosyaVeTeklif();
    const a = (await o.ist('GET', '/api/sigorta/ana', sigortaC)).json();
    const k = a.dosyalar.find((x: any) => x.dosyaNo === d.dosyaNo);
    expect(k.hasarNo).toMatch(/^H-/); expect(a.bekleyen.some((x: any) => x.kimlik === t)).toBe(true);
    expect((await o.ist('GET', '/api/sigorta/ana', baskaSigortaC)).json().dosyalar.find((x: any) => x.dosyaNo === d.dosyaNo)).toBeUndefined();
    expect((await o.ist('GET', `/api/sigorta/teklif/${t}`, baskaSigortaC)).statusCode).toBe(404);
    const j = (await o.ist('GET', `/api/sigorta/teklif/${t}`, sigortaC)).json();
    expect(j.kalemler[0].birim_maliyet_eur).toBeUndefined(); expect(j.kalemler[0].isin_niteligi).toBe('Onarım');
    // YG-1076: dosyada çalışan firmanın unvanı ve iş emri numarası sigorta portalına çıkmaz.
    const fu = `Gizli Onarım Firması ${Date.now()}`; const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,$2,'Çözüm Ortağı',$3) RETURNING kimlik`, [`S-GZ${Date.now()}`, fu, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K','Aktif',$4)`, [`${d.dosyaNo}-ON09`, d.kimlik, f, o.K.ds]);
    for (const u of ['/api/sigorta/ana', `/api/sigorta/teklif/${t}`]) { const b = (await o.ist('GET', u, sigortaC)).body; expect(b).not.toContain(fu); expect(b).not.toContain('-ON09'); }
    expect((await o.ist('GET', '/api/sigorta/ana', await o.gir('ds'))).statusCode).toBe(403);
  });
  it('seçilen kalemler onaylanır, seçilmeyen onaylanmaz; sürüm uyuşmazlığı reddedilir; ikinci karar olmaz', async () => {
    const { t } = await dosyaVeTeklif();
    expect((await o.ist('POST', `/api/sigorta/teklif/${t}/karar`, sigortaC, { siralar: [] })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/sigorta/teklif/${t}/karar`, sigortaC, { siralar: [1], surum: 9 })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/sigorta/teklif/${t}/karar`, baskaSigortaC, { siralar: [1] })).statusCode).toBe(404);
    const r = await o.ist('POST', `/api/sigorta/teklif/${t}/karar`, sigortaC, { siralar: [1], surum: 1 });
    expect(r.json()).toEqual({ karar: 'Kısmi Onay', tutar: 150, onaylanmayan: 1 });
    expect((await o.ist('POST', `/api/sigorta/teklif/${t}/karar`, sigortaC, { siralar: [2] })).statusCode).toBe(409);
  });
  it('süre dolmadan 24 saat kala tek hatırlatma; dolunca kalemler karşılanacak sayılır, onay kaydı ayrı; çerçevesizde süre işlemez', async () => {
    const { d, t } = await dosyaVeTeklif();
    await o.sup.query(`UPDATE fiyat_teklifi SET sigorta_karar_son = now() + interval '10 hours' WHERE kimlik = $1`, [t]);
    await sigortaSureIsle(o.db); await sigortaSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM sigorta_gonderim WHERE tur = 'BLD-72' AND nesne_kimligi = $1 AND durum = 'Teyit Bekliyor'`, [t])).rows[0].n).toBe(1);
    await o.sup.query(`UPDATE fiyat_teklifi SET sigorta_karar_son = now() - interval '1 minute' WHERE kimlik = $1`, [t]);
    await sigortaSureIsle(o.db);
    // SGT-1: kalemler sigortaca karşılanacak sayılır (YG-444) ama karar sigorta onayı olarak kaydedilmez (YG-162, YG-1494).
    expect((await o.sup.query(`SELECT karar FROM fiyat_teklifi WHERE kimlik = $1`, [t])).rows[0].karar).toBe('Süre Dolumu Kabulü');
    expect((await o.sup.query(`SELECT count(*)::int n FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu <> 'Onaylandı'`, [t])).rows[0].n).toBe(0);
    expect((await o.sup.query(`SELECT karar FROM sigorta_onayi WHERE teklif_ref = $1`, [t])).rows[0].karar).toBe('Süre Dolumu Kabulü');
    expect((await o.sup.query(`SELECT onay_kanali FROM sigorta_onayi WHERE teklif_ref = $1`, [t])).rows[0].onay_kanali).toBe('Çerçeve Sözleşme Süresi');
    void d;
    const b = await dosyaVeTeklif();
    await o.sup.query(`UPDATE dosya_sigorta_kaydi SET cerceve_sozlesme_yok = true WHERE dosya_ref = $1`, [b.d.kimlik]);
    await o.sup.query(`UPDATE fiyat_teklifi SET sigorta_karar_son = now() - interval '1 minute' WHERE kimlik = $1`, [b.t]);
    await sigortaSureIsle(o.db);
    expect((await o.sup.query(`SELECT statu FROM fiyat_teklifi WHERE kimlik = $1`, [b.t])).rows[0].statu).toBe('Gönderildi');
  });
  it('görevlendirmede hasar no zorunlu; yalnız sigorta kullanıcısı', async () => {
    expect((await o.ist('POST', '/api/sigorta/gorevlendirme', sigortaC, { yatAdi: 'Y', konum: 'K', ozet: 'O' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/sigorta/gorevlendirme', await o.gir('ds'), { hasarNo: 'H', yatAdi: 'Y', konum: 'K', ozet: 'O' })).statusCode).toBe(403);
    const r = await o.ist('POST', '/api/sigorta/gorevlendirme', sigortaC, { hasarNo: 'HS-1', yatAdi: 'Y', konum: 'K', ozet: 'O' });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().talepNo).toMatch(/^LGM-/);
  });
});
