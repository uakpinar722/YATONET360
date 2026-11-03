import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { donemHesapla, dosyaPuani, garantiKarneIsle, performansOlayIsle, riskOnerisi, type Girdi } from '../src/karne.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { ana, ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü', tod: 'Teknik ve Operasyon Direktörü', gmy: 'Genel Müdür Yardımcısı' };
const P = { kabul: 100, kosullu_kabul: 70, ret: 0, ilk_sefer: 10, majoer: 15, minoer: 5, basarisiz_test: 10, garanti: 20, tol_kritik: 20, tol_yuksek: 15, tol_normal: 10, tol_planli: 5, tol_belirsiz: 5, sure_asim: 2, maliyet_1: 5, maliyet_1_puan: 70, maliyet_2: 15, isg: 25, prosedur: 15, denetim_majoer: 15, denetim_minoer: 5, eksik_belge: 10, esik_tercihli: 85, esik_standart: 70 };
const G: Girdi = { oncelik: 'Normal', kabul: 'Kabul', ilkSeferdeKabul: true, majoer: 0, minoer: 1, basarisizTest: 0, garanti: 0, planlananGun: 10, firmaGecikmeGun: 2, teshisiBelirsiz: false, butce: 1000, ekIs: 0, fatura: 1020, onaysizEkIs: false, yanitUyum: 95, raporZamaninda: 95, oncedenBildirim: 95, isg: 0, prosedur: 0, denetimMajoer: 0, denetimMinoer: 0, eksikBelge: 1, emniyetOlayi: false };

describe('dosya puanı (Ek I §7.5)', () => {
  it('Ek I örneği: 95, 80, 88, 95, 90 → 89,95', () => {
    expect(dosyaPuani(G, P)).toEqual({ kalite: 95, sure: 80, maliyet: 88, iletisim: 95, uyum: 90, dosya: 89.95 });
  });
  it('kabul, kesinti ve taban', () => {
    expect(dosyaPuani({ ...G, kabul: 'Koşullu Kabul', minoer: 0 }, P).kalite).toBe(70);
    expect(dosyaPuani({ ...G, kabul: 'Ret' }, P).kalite).toBe(0);
    expect(dosyaPuani({ ...G, minoer: 0, ilkSeferdeKabul: false, majoer: 1, basarisizTest: 1, garanti: 1 }, P).kalite).toBe(45);
  });
  it('süre: tolerans içinde 100; teşhisi belirsizde +%5; Kritik %20', () => {
    expect(dosyaPuani({ ...G, firmaGecikmeGun: 1 }, P).sure).toBe(100);
    expect(dosyaPuani({ ...G, teshisiBelirsiz: true }, P).sure).toBe(90);
    expect(dosyaPuani({ ...G, oncelik: 'Kritik' }, P).sure).toBe(100);
  });
  it('maliyet: doğrusal bantlar, ek iş düşülür, onaysız ek iş 0', () => {
    const m = (f: number, x: Partial<Girdi> = {}) => dosyaPuani({ ...G, fatura: f, ...x }, P).maliyet;
    expect([m(1000), m(1050), m(1100), m(1150), m(1200)]).toEqual([100, 70, 35, 0, 0]);
    expect(m(1100, { ekIs: 100 })).toBe(100); expect(m(900, { onaysizEkIs: true })).toBe(0);
  });
  it('emniyet olayı Uyum boyutunu 0 yapar; ölçülemeyen boyut sıfır sayılmaz, ağırlığı dağılır', () => {
    expect(dosyaPuani({ ...G, emniyetOlayi: true }, P).uyum).toBe(0);
    const r = dosyaPuani({ ...G, minoer: 0, butce: null, fatura: null, planlananGun: null, yanitUyum: null, raporZamaninda: null, oncedenBildirim: null, eksikBelge: 0 }, P);
    expect(r).toMatchObject({ kalite: 100, uyum: 100, sure: null, maliyet: null, iletisim: null, dosya: 100 });
  });
  it('risk önerisi: eşikler, açık emniyet, yetersiz veri', () => {
    expect([riskOnerisi(85, false, P), riskOnerisi(84.99, false, P), riskOnerisi(70, false, P), riskOnerisi(69.99, false, P), riskOnerisi(90, true, P), riskOnerisi(null, false, P)]).toEqual(['Tercihli', 'Standart', 'Standart', 'Yakın İzleme', 'Standart', 'Standart']);
  });
});

let o: Ortam; let f: string; let fC: string; let fK: string;
const yeniEmri = async (oncelik: string | null = null, x: Partial<{ bedel: number; kabul: string }> = {}) => {
  const d = await o.dosyaAc(); if (oncelik) await o.sup.query(`UPDATE dosya SET oncelik = $2 WHERE kimlik = $1`, [d.kimlik, oncelik]);
  const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, baslangic_tarihi, hedef_bitis_tarihi, statu, teknik_kabul_sonucu, yayim_zamani, firma_kabul_zamani, firma_tamamlama_zamani, kapanis_zamani, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K',$4,now() - interval '10 days',now(),'Kapalı',$5,now() - interval '11 days',now() - interval '11 days',now(),now(),$6) RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, f, x.bedel ?? 1000, x.kabul ?? 'Kabul', o.K.ds])).rows[0].kimlik as string;
  await o.sup.query(`INSERT INTO hakedis (hakedis_no, is_emri_ref, dosya_ref, sira_no, bu_donem_brut, kumulatif, kesinti, net, statu, giren_ref) VALUES ($1,$2,$3,1,$4,$4,0,$4,'Doğrulandı',$5)`, [`${d.dosyaNo}-HK01`, e, d.kimlik, x.bedel ?? 1000, fK]);
  return { d, e };
};
const ceoGir = async () => {
  const g = await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: 'ceo@deneme.yatonet.local', parola: 'Sinama-Parolasi-2026!' } });
  const c = ana.ckr(g); const q = await o.ist('GET', '/api/kimlik/kurulum', c);
  return ana.ckr(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
};

beforeAll(async () => {
  o = await ortamKur('yatonet360_test31', KADRO);
  f = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: 'Karne Firma', rol: 'Çözüm Ortağı' })).json().kimlik;
  const oz = await parolaOzetle('Sinama-Parolasi-2026!'); const ep = 'kn1@deneme.yatonet.local';
  fK = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani) VALUES ('Dış Kullanıcı','İş Birliği Firması','kn1',$1,$1,$2,'Doğrulama uygulaması (6 haneli kod)',now()) RETURNING kimlik`, [ep, oz])).rows[0].kimlik;
  await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = 'Firma Yetkilisi'`, [fK]);
  await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Çalışan','KVKK-03','R00','Türkçe','Web')`, [fK]);
  await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [fK]);
  await o.sup.query(`INSERT INTO kurulus_kullanici VALUES ($1,$2)`, [f, fK]);
  const ck = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
  const c = ck(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: ep, parola: 'Sinama-Parolasi-2026!' } }));
  const g = (await o.ist('GET', '/api/kimlik/kurulum', c)).json().gizli as string;
  fC = ck(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(g, suankiAdim()) }));
}, 120_000);
afterAll(async () => { await o.kapat(); });

describe('firma karnesi (YG-351, YG-789–795)', () => {
  it('3 dosyaya kadar Yetersiz veri ve Standart; firma risk önerisini görmez, LGM görür', async () => {
    const a = await yeniEmri('Kritik'); await performansOlayIsle(o.db, a.e);
    const v = (await o.ist('GET', '/api/firma-portal/karne', fC)).json();
    expect(v.donem).toMatchObject({ yetersiz_veri: true, donem_puani: null, kapanan_dosya_sayisi: 1 }); expect(JSON.stringify(v)).not.toMatch(/risk|Tercihli|Standart/);
    expect(v.olaylar[0].dosya_puani).toBe('100.00');
    const l = (await o.ist('GET', `/api/firma/${f}/karne`, await o.gir('sc'))).json(); expect(l.donem.risk_derecesi_onerisi).toBe('Standart');
    expect((await o.ist('GET', `/api/firma/${f}/karne`, await o.gir('ds'))).statusCode).toBe(403);
    expect((await o.ist('GET', '/api/firma-portal/karne', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('öncelik ağırlıklı ortalama; Kritik ve Emniyet kesintisi; açık emniyette Tercihli önerilmez', async () => {
    const b = await yeniEmri('Normal', { kabul: 'Koşullu Kabul' }); await performansOlayIsle(o.db, b.e);
    const c = await yeniEmri('Planlı'); await performansOlayIsle(o.db, c.e);
    const d = (await o.ist('GET', `/api/firma/${f}/karne`, await o.gir('sc'))).json().donem;
    expect(d.yetersiz_veri).toBe(false); expect(d.kapanan_dosya_sayisi).toBe(3);
    const nor = Number((await o.sup.query(`SELECT dosya_puani FROM performans_olay_kaydi WHERE is_emri_ref = $1`, [b.e])).rows[0].dosya_puani);
    const bek = Math.round(((100 * 2 + nor * 1 + 100 * 0.8) / 3.8) * 100) / 100;
    expect(Number(d.donem_puani)).toBeCloseTo(bek, 1); expect(d.risk_derecesi_onerisi).toBe('Tercihli');
    const be = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('K','K','Gizli','Dosya',$1,'Sistem',current_date,$2) RETURNING kimlik`, [c.d.kimlik, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO uygunsuzluk (uygunsuzluk_no, dosya_ref, is_emri_ref, tespit_kaynagi, yer_nitelik, dayanak_olcut, gercek_durum, kanit_belge_ref, sinif, emniyet_isareti, sorumlu_firma_ref, acan_ref) VALUES ($1,$2,$3,'K','Y','D','G',$4,'Kritik',true,$5,$6)`, [`NCR-${Date.now()}`, c.d.kimlik, c.e, be, f, o.K.ds]);
    await donemHesapla(o.db, f);
    const d2 = (await o.ist('GET', `/api/firma/${f}/karne`, await o.gir('sc'))).json().donem;
    expect(Number(d2.uygunsuzluk_kesintisi)).toBe(15); expect(Number(d2.donem_puani)).toBeCloseTo(bek - 15, 1); expect(d2.acik_emniyet_uygunsuzlugu).toBe(true); expect(d2.risk_derecesi_onerisi).not.toBe('Tercihli');
  });
  it('garanti kararı kapanıştan sonra da işlenir, önceki puan geçmişte kalır', async () => {
    const a = await yeniEmri(); await performansOlayIsle(o.db, a.e);
    await o.sup.query(`INSERT INTO garanti_sikayet (kayit_no, dosya_ref, kayit_turu, kanal, bildirim_zamani, oncelik, karar, olusturan_ref) VALUES ($1,$2,ARRAY['Garanti bildirimi'],'Telefon',now(),'Normal','Garanti',$3)`, [`GK-${Date.now()}`, a.d.kimlik, o.K.ds]);
    await garantiKarneIsle(o.db, a.d.kimlik);
    const r = (await o.sup.query(`SELECT kimlik, kalite_puani FROM performans_olay_kaydi WHERE is_emri_ref = $1`, [a.e])).rows[0]; expect(r.kalite_puani).toBe('80.00');
    expect((await o.sup.query(`SELECT neden FROM performans_olay_gecmisi WHERE olay_ref = $1`, [r.kimlik])).rows[0].neden).toBe('Garanti çağrısı');
  });
  it('itiraz bir kez, FYM kararıyla, başka firmaya kapalı', async () => {
    const a = await yeniEmri(); await performansOlayIsle(o.db, a.e);
    const id = (await o.sup.query(`SELECT kimlik FROM performans_olay_kaydi WHERE is_emri_ref = $1`, [a.e])).rows[0].kimlik; const u = `/api/firma-portal/karne/${id}/itiraz`;
    expect((await o.ist('POST', u, fC, {})).statusCode).toBe(400);
    expect((await o.ist('POST', u, await o.gir('ds'), { konu: 'K' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, fC, { konu: 'Gecikme benden değil' })).statusCode).toBe(200);
    expect((await o.ist('POST', u, fC, { konu: 'Yine' })).statusCode).toBe(409);
    const t = (await o.sup.query(`SELECT kimlik FROM firma_karne_itirazi WHERE olay_ref = $1`, [id])).rows[0].kimlik; const k = await o.kart('Karne İtirazı', t);
    expect((await o.karar(k.kimlik, 'fym', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM firma_karne_itirazi WHERE kimlik = $1`, [t])).rows[0].durum).toBe('Kabul Edildi');
    expect((await o.sup.query(`SELECT neden FROM performans_olay_gecmisi WHERE olay_ref = $1`, [id])).rows[0].neden).toContain('itirazı');
  });
  it('parametre: T&O önerir, GMY ve CEO onaylar, ertesi gün yürürlüğe girer; eski kayıt sürümünü korur', async () => {
    const m = (await o.ist('GET', '/api/karne-parametre', await o.gir('tod'))).json(); expect(m.yururlukte.surum).toBe(1);
    expect((await o.ist('GET', '/api/karne-parametre', await o.gir('ds'))).statusCode).toBe(404);
    const yeni = { ...m.yururlukte.deger, minoer: 7 };
    expect((await o.ist('POST', '/api/karne-parametre', await o.gir('ds'), { deger: yeni, gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/karne-parametre', await o.gir('tod'), { deger: { ...yeni, minoer: -1 }, gerekce: 'G' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/karne-parametre', await o.gir('tod'), { deger: { ...yeni, sahte: 1 }, gerekce: 'G' })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/karne-parametre', await o.gir('tod'), { deger: yeni, gerekce: 'Deneyim' }); expect(r.json().surum, r.body).toBe(2);
    expect((await o.ist('POST', '/api/karne-parametre', await o.gir('tod'), { deger: yeni, gerekce: 'Yine' })).statusCode).toBe(409);
    const k = await o.kart('Karne Parametresi', '2'); await o.karar(k.kimlik, 'gmy', 'Onaya Gönder');
    expect((await o.sup.query(`SELECT durum FROM karne_parametresi WHERE surum = 2`)).rows[0].durum).toBe('Onayda');
    const cc = await ceoGir(); expect((await o.ist('POST', `/api/is/${k.kimlik}/karar`, cc, { karar: 'Onayla' })).statusCode).toBe(200);
    const s = (await o.sup.query(`SELECT durum, yururluk_baslangic > current_date AS ileri FROM karne_parametresi WHERE surum = 2`)).rows[0]; expect(s).toMatchObject({ durum: 'Yürürlükte', ileri: true });
    expect((await o.ist('GET', '/api/karne-parametre', await o.gir('tod'))).json().yururlukte.surum).toBe(1);
  });
});
