import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cihazGecerli, gazUygun, kabulEngeli, kaliteSureIsle, ncrHedefi, sinifEngeli, uygunsuzlukHaftalikRapor } from '../src/kalite.js';
import { eslestir } from '../src/tedarik.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', kk: 'Kalite Uzmanı (Kalite Kontrolör)', kk2: 'Kalite Uzmanı (Kalite Kontrolör)', ky: 'Kalite Yöneticisi', kmy: 'Kalite Müdür Yardımcısı', rkd: 'Risk ve Kalite Direktörü', km: 'Kalite Müdürü', ts: 'Tedarik Sorumlusu', tym: 'Tedarik Yönetimi Müdürü', to: 'Teknik ve Operasyon Direktörü', tid: 'Ticari İşler Direktörü', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü' };
let o: Ortam; let firma: string; let tedarikci: string;
const ileri = (g: number) => new Date(Date.now() + 180 * 60_000 + g * 86_400_000).toISOString().slice(0, 10);
const dosya = async () => { await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE bitis_zamani IS NULL`); const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); for (const [k, r] of [['kk', 'Kalite Kontrolör'], ['ts', 'Tedarik Sorumlusu']]) await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,$3,$4)`, [d.kimlik, o.K[k!], r, o.K.oy]); return d; };
const isEmri = async (d: { kimlik: string; dosyaNo: string }, statu = 'Aktif', tur = 'ON') => (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, statu, hazirlayan_ref) VALUES ($1,$2,$3,$4,'Y','K',1000,$5,$6) RETURNING kimlik`, [`${d.dosyaNo}-${tur}${Math.floor(Math.random() * 90 + 10)}`, tur, d.kimlik, firma, statu, o.K.oy])).rows[0].kimlik as string;
const ncr = async (d: { kimlik: string }, x: object, kim = 'kk') => o.ist('POST', `/api/dosya/${d.kimlik}/uygunsuzluk`, await o.gir(kim), { kaynak: 'Ara kontrol', yer: 'Y', olcut: `Ö${Math.random()}`, durum: 'Fark', belge: await o.belge(d.kimlik, 'ds'), ...x });

beforeAll(async () => {
  o = await ortamKur('yatonet360_test17', KADRO);
  const fir = async (u: string, r: string) => { const id = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: u, rol: r })).json().kimlik; await o.ist('POST', `/api/firma/${id}/statu`, await o.gir('fym'), { asama: 'İncelemede', gerekce: 'Belge doğrulaması' }); await o.ist('POST', `/api/firma/${id}/statu`, await o.gir('fym'), { asama: 'Onaylı', ag: 'Aktif', gerekce: 'G' }); return id as string; };
  firma = await fir('Kalite Firma', 'Çözüm Ortağı'); tedarikci = await fir('Parça AŞ', 'Tedarikçi');
}, 120_000);
afterAll(async () => { await o.kapat(); });

describe('metin güvencesi', () => {
  it('dışa giden hiçbir metinde teminat yok (SGT-1)', async () => {
    const { rows } = await o.sup.query(`SELECT kod, metin FROM sablon_metni`);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.filter((r) => /teminat|cover terms|coverage/i.test(r.metin)).map((r) => r.kod)).toEqual([]);
    expect(readFileSync('../../veri/deger_listeleri.tsv', 'utf8')).not.toMatch(/teminat koşulları|cover terms/);
    expect(readFileSync('src/onay.ts', 'utf8')).not.toMatch(/teminat/i);
  });
});
describe('kurallar', () => {
  it('sınıf kuralı (YG-283)', () => {
    expect(sinifEngeli('Majör', null, null, true)).toContain('Kritik'); expect(sinifEngeli('Kritik', 'A', null, true)).toBeNull();
    expect(sinifEngeli('Minör', 'A', null, false)).toContain('A sınıfı'); expect(sinifEngeli('Minör', 'B', 'Yüksek', false)).toContain('Majör'); expect(sinifEngeli('Minör', 'B', 'Düşük', false)).toBeNull();
  });
  it('süreler, cihaz, gaz', () => {
    const t = new Date('2026-01-01T00:00:00Z');
    expect(ncrHedefi('Minör', t)!.toISOString()).toBe('2026-01-06T00:00:00.000Z'); expect(ncrHedefi('Majör', t)!.toISOString()).toBe('2026-01-03T00:00:00.000Z'); expect(ncrHedefi('Kritik', t)).toBeNull();
    expect(cihazGecerli({ kalibrasyon_tarihi: '2025-01-01', aralik_ay: 12, kabul: true }, new Date('2025-12-31'))).toBe(true);
    expect(cihazGecerli({ kalibrasyon_tarihi: '2025-01-01', aralik_ay: 12, kabul: true }, new Date('2026-01-02'))).toBe(false);
    expect(cihazGecerli({ kalibrasyon_tarihi: '2025-01-01', aralik_ay: 12, kabul: false }, new Date('2025-02-01'))).toBe(false);
    expect([gazUygun(19.5, 9.9), gazUygun(23.5, 0), gazUygun(19.4, 0), gazUygun(23.6, 0), gazUygun(20, 10)]).toEqual([true, true, false, false, false]);
  });
  it('üçlü eşleştirme', () => {
    expect(eslestir(10, 10, 100, 100).sonuc).toBe('Eşleşti'); expect(eslestir(10, 9, 100, 90).sonuc).toBe('Miktar Farkı'); expect(eslestir(10, 11, 100, 110).sonuc).toBe('Fazla Teslim'); expect(eslestir(10, 10, 100, 100.01)).toEqual({ sonuc: 'Fiyat Farkı', miktarFarki: 0, fiyatFarki: 0.01 });
  });
});
describe('kalite planı (YG-288)', () => {
  it('plansız onarım başlamaz; keşif başlar; A sınıfı Teknik Müdür onaylar', async () => {
    const d = await dosya(); const on = await isEmri(d, 'Başlangıç Kontrolünde'); const kn = await isEmri(d, 'Başlangıç Kontrolünde', 'KN'); const tu = await o.gir('tu');
    expect((await o.ist('POST', `/api/is-emri/${on}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı', 'Absorban ve Bariyer Mevcut'] })).json().hata).toContain('kalite planı');
    expect((await o.ist('POST', `/api/is-emri/${on}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı'] })).json().eksikler).toEqual(['Absorban ve Bariyer Mevcut']); // YG-370
    { // T-YG402-BASLANGIC: kalibrasyonu geçmiş kullanılabilir ekipman başlamayı engeller; kullanım dışı işaretlenince engel kalkar
      const ek = (await o.sup.query(`INSERT INTO firma_ekipmani (kurulus_ref, ad, seri_no, kalibrasyon_bitis, kaydeden_ref) VALUES ($1,'Kalınlık Ölçer',$2,current_date - 1,$3) RETURNING kimlik`, [firma, `KO-${Date.now()}`, o.K.ds])).rows[0].kimlik;
      expect((await o.ist('POST', `/api/is-emri/${kn}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı'] })).json().eksikler.join(' ')).toContain('Ekipman Kalibrasyonu (Kalınlık Ölçer');
      await o.sup.query(`UPDATE firma_ekipmani SET kullanilabilir = false WHERE kimlik = $1`, [ek]);
    }
    expect((await o.ist('POST', `/api/is-emri/${kn}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı'] })).statusCode).toBe(200);
    const G = [{ gereklilik: 'Sızdırmazlık', dogrulama: 'Basınç testi' }];
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, await o.gir('ds'), { sinif: 'A', ozet: 'Ö', risk: 'Orta', teknikKaynak: 'ISO 12215', gereklilikler: G })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'A', ozet: 'Ö', gereklilikler: [{ gereklilik: 'X' }] })).statusCode).toBe(400);
    const p = await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'A', ozet: 'Ö', risk: 'Orta', teknikKaynak: 'ISO 12215', gereklilikler: G });
    expect(p.statusCode, p.body).toBe(200); expect(p.json().surum).toBe(0); // YG-648: Rev.0
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'A', ozet: 'Ö', teknikKaynak: 'K', gereklilikler: G })).json().hata).toMatch(/Risk seviyesini/);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'A', ozet: 'Ö', risk: 'Orta', teknikKaynak: 'K', gereklilikler: G })).json().hata).toMatch(/revizyon gerekçesini/);
    expect((await o.sup.query(`SELECT sorumluluklar FROM kalite_plani WHERE kimlik = $1`, [p.json().kimlik])).rows[0].sorumluluklar).toContain('Onay: Teknik Müdür');
    const k = await o.kart('Kalite Planı', p.json().kimlik);
    expect((await o.karar(k.kimlik, 'ty', 'Onayla')).statusCode).not.toBe(200);
    expect((await o.karar(k.kimlik, 'tm', 'Onayla')).statusCode).toBe(200);
    expect((await o.kart('Kalite Kontrolör Ataması', d.kimlik))).toBeUndefined(); // YG-1485: dosyada Kalite Kontrolör atanmış
    expect((await o.ist('POST', `/api/is-emri/${on}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı', 'Absorban ve Bariyer Mevcut'] })).json().hata).toContain('toplantısı');
    await o.sup.query(`INSERT INTO baslangic_toplantisi (is_emri_ref, tarih, katilimcilar, konusulanlar, kaydeden_ref) VALUES ($1,current_date,'K','K',$2)`, [on, o.K.ds]);
    expect((await o.ist('POST', `/api/is-emri/${on}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı', 'Absorban ve Bariyer Mevcut'] })).statusCode).toBe(200);
    expect((await ncr(d, { sinif: 'Minör' })).json().hata).toContain('A sınıfı');
  });
});
describe('uygunsuzluk (YG-283, YG-284, YG-285, YG-392)', () => {
  it('kontrolörsüz dosyada atama görevi Kalite Yöneticisi/Müdürüne 24 saat süreli açılır, atamayla kapanır (T-YG1687)', async () => {
    const d = await dosya(); const tu = await o.gir('tu'); const G = [{ gereklilik: 'Sızdırmazlık', dogrulama: 'Basınç testi' }];
    await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref = $1 AND rol = 'Kalite Kontrolör'`, [d.kimlik]);
    const p = await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'B', ozet: 'Ö', risk: 'Orta', teknikKaynak: 'ISO 12215', gereklilikler: G }); expect(p.statusCode, p.body).toBe(200);
    const kp = await o.kart('Kalite Planı', p.json().kimlik); for (const k of ['ty', 'tm']) { if ((await o.kart('Kalite Planı', p.json().kimlik)).durum !== 'Bekliyor') break; await o.karar(kp.kimlik, k, (await o.sup.query(`SELECT kademe = cardinality(zincir) - 1 son FROM is_karti WHERE kimlik = $1`, [kp.kimlik])).rows[0].son ? 'Onayla' : 'Onaya Gönder'); }
    const ka = await o.kart('Kalite Kontrolör Ataması', d.kimlik); expect(ka.durum).toBe('Bekliyor');
    expect(Math.round((new Date(ka.son_zaman).getTime() - Date.now()) / 3_600_000)).toBeLessThanOrEqual(24);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ekip`, await o.gir('km'), { rol: 'Kalite Kontrolör', kullanici: o.K.kk })).statusCode).toBe(200);
    expect((await o.kart('Kalite Kontrolör Ataması', d.kimlik)).durum).toBe('Tamamlandı');
    // T-YG1687-YEDEK: yedek kontrolör asıl kontrolörden farklı
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ekip`, await o.gir('km'), { rol: 'Yedek Kalite Kontrolör', kullanici: o.K.kk })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ekip`, await o.gir('km'), { rol: 'Yedek Kalite Kontrolör', kullanici: o.K.kk2 })).statusCode).toBe(200);
  });
  it('kapsamlı kök neden kararı, olay izleme, yönetim gözden geçirmesi (T-YG1693)', async () => {
    const d = await dosya(); const e = await isEmri(d);
    const n = (await ncr(d, { sinif: 'Kritik', emniyet: true, isEmri: e })).json().kimlik as string;
    expect((await o.ist('POST', `/api/uygunsuzluk/${n}/kapsamli-kok-neden`, await o.gir('km'), { sistemEtkisi: ['Yöntem'] })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/uygunsuzluk/${n}/kapsamli-kok-neden`, await o.gir('km'), { sistemEtkisi: ['Yöntem', 'Eğitim'], oneri: 'Kaynak prosedürü ve eğitim', birim: 'Teknik Müdürlük', hedef: '2031-03-01' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.karar((await o.kart('Kapsamlı Kök Neden Kararı', r.json().kimlik)).kimlik, 'rkd', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM kapsamli_kok_neden WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('Karar Verildi');
    const iz = (await o.ist('GET', '/api/kalite/olay-izleme', await o.gir('rkd'))).json(); expect(iz.uygunsuzluk.some((x: any) => x.kimlik === n)).toBe(true);
    expect((await o.ist('GET', '/api/kalite/olay-izleme', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/kalite/yonetim-gozden-gecirme', await o.gir('rkd'), { yil: 2031, girdiler: 'Göstergeler', kararlar: 'Eğitim planı', eylemler: 'Q1 eğitim' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/kalite/yonetim-gozden-gecirme', await o.gir('km'))).json()[0].yil).toBe(2031);
  });
  it('Kritik uygunsuzlukta Direktör Kararı Kaydet ve İncelendi Olarak Kaydet (T-YG1694)', async () => {
    const d = await dosya(); const e = await isEmri(d);
    const r = await ncr(d, { sinif: 'Kritik', emniyet: true, isEmri: e }); expect(r.statusCode, r.body).toBe(200); const n = r.json().kimlik as string;
    expect((await o.ist('POST', `/api/uygunsuzluk/${n}/direktor-karar`, await o.gir('km'), { birim: 'Teknik Müdürlük', hedef: '2031-01-10' })).statusCode).toBe(404);
    const rk = await o.gir('rkd');
    expect((await o.ist('POST', `/api/uygunsuzluk/${n}/direktor-karar`, rk, { birim: 'Teknik Müdürlük' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/uygunsuzluk/${n}/direktor-karar`, rk, { birim: 'Teknik Müdürlük', hedef: '2031-01-10', not: 'Kaynak prosedürü yenilenecek' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/kalite/kritik-uygunsuzluklar', rk)).json().find((x: any) => x.kimlik === n).direktor_hedef).toBe('2031-01-10');
    const { kartAc } = await import('../src/is_motoru.js');
    const kid = await kartAc(o.db, { tur: 'Aylık İSG Göstergeleri', kategori: 'gorev', baslik: 'Deneme · Aylık İSG Göstergeleri', sahipRol: (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Kalite Müdür Yardımcısı'`)).rows[0].kimlik });
    expect((await o.ist('POST', `/api/is/${kid}/karar`, await o.gir('kmy'), { karar: 'İncelendi' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM is_karti WHERE kimlik = $1`, [kid])).rows[0].durum).toBe('Tamamlandı');
  });
  it('kayıt disiplini: eksik kontrol kayıtları, Düzeltme İste ve aylık Kalite Kontrolör Raporu (T-YG1687-DISIPLIN)', async () => {
    const { eksikKontrolKayitlari, kaliteKontrolorAylikRapor } = await import('../src/kalite_disiplin.js');
    const d = await dosya(); const e = await isEmri(d);
    const kn = (await o.sup.query(`INSERT INTO kontrol_noktasi (kontrol_noktasi_no, is_emri_ref, nokta_turu, kontrol_ozelligi, kabul_olcutu, planlanan_zaman, olusturan_ref) VALUES ($1,$2,'Gözetim','Kaynak dikişi','Görsel kusursuz', now() - interval '3 days', $3) RETURNING kimlik`, [`${d.dosyaNo}-KPX1`, e, o.K.tu])).rows[0].kimlik;
    expect(await eksikKontrolKayitlari(o.db, new Date('2031-03-03T09:00:00+03:00'))).toBe(true);
    expect(await eksikKontrolKayitlari(o.db, new Date('2031-03-03T10:00:00+03:00'))).toBe(false);
    const ky = await o.gir('ky'); const l = (await o.ist('GET', '/api/kalite/eksik-kontrol-kayitlari', ky)).json();
    expect(l.some((x: any) => x.kimlik === kn && x.kontrolor === o.K.kk)).toBe(true);
    expect((await o.ist('GET', '/api/kalite/eksik-kontrol-kayitlari', await o.gir('kk'))).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/kalite/eksik-kontrol-kaydi/${kn}/duzeltme-iste`, ky, {})).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/kalite/eksik-kontrol-kaydi/${kn}/duzeltme-iste`, ky, {})).statusCode).toBe(409);
    expect((await o.kart('Kontrol Kaydı Düzeltme', kn)).sahip_kullanici_ref).toBe(o.K.kk);
    expect(await kaliteKontrolorAylikRapor(o.db, new Date('2031-04-01T09:00:00+03:00'))).toBe(true);
    const r = await o.kart('Kalite Kontrolör Raporu', '2031-03'); expect(r.kategori).toBe('onay');
    const { sahaGeriBildirimiYillik } = await import('../src/kalite_disiplin.js'); // T-YG1687-SAHA
    expect(await sahaGeriBildirimiYillik(o.db, new Date('2031-02-10T09:00:00+03:00'))).toBe(false);
    expect(await sahaGeriBildirimiYillik(o.db, new Date('2031-01-05T09:00:00+03:00'))).toBe(true);
    expect((await o.kart('Saha Geri Bildirimi', '2030')).zincir).toHaveLength(2);
    { const { kaliteVeriDogrulamaAylik, kritikCihazAraDogrulamaTakvimi } = await import('../src/kalite_disiplin.js'); // T-YG1689
      expect(await kaliteVeriDogrulamaAylik(o.db, new Date('2031-07-01T09:00:00+03:00'))).toBe(true); expect(await o.kart('Kalite Verisi Doğrulama', '2031-06')).toBeDefined();
      expect(await kritikCihazAraDogrulamaTakvimi(o.db, new Date('2031-08-01T09:00:00+03:00'))).toBe(false); expect(await kritikCihazAraDogrulamaTakvimi(o.db, new Date('2031-07-02T09:00:00+03:00'))).toBe(true);
      expect((await o.kart('Kritik Cihaz Ara Doğrulama Takvimi', '2031-Q3')).zincir).toHaveLength(2);
      expect((await o.ist('GET', '/api/kalite/veri-dogrulama', await o.gir('kmy'))).statusCode).toBe(200); }
    const { teknikOrneklemAylik } = await import('../src/kalite_disiplin.js'); expect(await teknikOrneklemAylik(o.db, new Date('2031-06-01T09:00:00+03:00'))).toBe(true); expect(await o.kart('Aylık Örneklem Öz Kontrolü', '2031-05')).toBeDefined(); // T-YG1587
  });
  it('Kritik işi durdurur, Olduğu Gibi Kabul yok, son karar Kalite Müdürü; kök neden ve kanıtla kapanır; emniyet işaretliyse işi Teknik Müdür başlatır', async () => {
    const d = await dosya(); const e = await isEmri(d);
    const r = await ncr(d, { sinif: 'Kritik', emniyet: true, isEmri: e });
    expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ uygunsuzlukNo: `${d.dosyaNo}-NCR01`, isDurduruldu: true });
    const id = r.json().kimlik;
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [e])).rows[0].statu).toBe('Durduruldu');
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/tasarruf`, await o.gir('kk'), { karar: 'Düzeltme' })).statusCode).toBe(403);
    const km = await o.gir('km');
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/tasarruf`, km, { karar: 'Olduğu Gibi Kabul' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/tasarruf`, km, { karar: 'Düzeltme', bedel: 'İş Birliği Firması' })).statusCode).toBe(200);
    const kanit = await o.belge(d.kimlik, 'ds');
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/kapat`, km, { sonuc: 'Uygun', kanit })).json().hata).toContain('Kök neden');
    const KN = { problem: 'P', dogrudan: 'D', katki: 'K', bariyer: 'B', kokNeden: 'Dikkatsizlik', tekrar: 'Düşük' };
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/kok-neden`, km, KN)).statusCode).toBe(400);
    const kn = await o.ist('POST', `/api/uygunsuzluk/${id}/kok-neden`, km, { ...KN, kokNeden: 'Prosedür eksikliği' });
    expect(kn.statusCode, kn.body).toBe(200);
    const f = await o.ist('POST', `/api/kok-neden/${kn.json().kimlik}/faaliyet`, km, { tur: 'Düzeltici faaliyet', aciklama: 'A', sorumlu: o.K.tu, hedef: ileri(5), gosterge: 'G', izleme: 30 });
    expect(f.statusCode, f.body).toBe(200);
    const fid = f.json().kimlik;
    expect((await o.ist('POST', `/api/faaliyet/${fid}/etkinlik`, km, { sonuc: 'Etkisiz', kanit })).json().statu).toBe('Açık');
    expect((await o.ist('POST', `/api/faaliyet/${fid}/etkinlik`, km, { sonuc: 'Etkili', kanit })).json().statu).toBe('Kapalı');
    const tespit = (await o.sup.query(`SELECT kanit_belge_ref k FROM uygunsuzluk WHERE kimlik = $1`, [id])).rows[0].k;
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/kapat`, km, { sonuc: 'Uygun', kanit: tespit })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/kapat`, km, { sonuc: 'Uygun', kanit })).json().statu).toBe('Kapalı');
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [e])).rows[0].statu).toBe('Durduruldu');
    expect((await o.ist('POST', `/api/is-emri/${e}/yeniden-baslat`, await o.gir('tm'), { gerekce: 'Ölçüm temiz' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT statu, durdurma_nedeni FROM is_emri WHERE kimlik = $1`, [e])).rows[0]).toEqual({ statu: 'Aktif', durdurma_nedeni: null });
  });
  it('firma yeni hasarında ihbar ve mahsup zorunlu; Minör kök nedensiz Kalite Kontrolörce kapanır; süre aşımı tek kart açar', async () => {
    const d = await dosya(); const kk = await o.gir('kk');
    const n = (await ncr(d, { sinif: 'Minör', yeniHasar: true })).json().kimlik;
    expect((await o.ist('POST', `/api/uygunsuzluk/${n}/tasarruf`, kk, { karar: 'Düzeltme' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/uygunsuzluk/${n}/tasarruf`, kk, { karar: 'Düzeltme', ihbar: '2026-11-03', mahsup: 'M1' })).statusCode).toBe(200);
    { // T-YG1688: görevde Kalite Uzmanı yokken Kalite Yöneticisi bağımsızlık teyidiyle Vekâleten karar verir
      const n2 = (await ncr(d, { sinif: 'Minör' })).json().kimlik; const ky = await o.gir('ky');
      expect((await o.ist('POST', `/api/uygunsuzluk/${n2}/tasarruf`, ky, { karar: 'Düzeltme' })).statusCode).toBe(404);
      const kkRol = (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Kalite Uzmanı (Kalite Kontrolör)'`)).rows[0].kimlik;
      const askiya = (await o.sup.query(`UPDATE rol_atamasi SET atama_durumu = 'Askıda' WHERE rol_ref = $1 AND atama_durumu = 'Aktif' RETURNING kimlik`, [kkRol])).rows.map((x) => x.kimlik);
      try {
        expect((await o.ist('POST', `/api/uygunsuzluk/${n2}/tasarruf`, ky, { karar: 'Düzeltme' })).json().hata).toContain('bağımsızlık teyidi');
        const r = await o.ist('POST', `/api/uygunsuzluk/${n2}/tasarruf`, ky, { karar: 'Düzeltme', bagimsizlikTeyidi: true }); expect(r.statusCode, r.body).toBe(200); expect(r.json().vekaleten).toBe(true);
        expect((await o.sup.query(`SELECT tasarruf_vekaleten FROM uygunsuzluk WHERE kimlik = $1`, [n2])).rows[0].tasarruf_vekaleten).toBe(true);
      } finally { await o.sup.query(`UPDATE rol_atamasi SET atama_durumu = 'Aktif' WHERE kimlik = ANY($1::uuid[])`, [askiya]); }
    }
    await o.sup.query(`UPDATE uygunsuzluk SET hedef_zamani = now() - interval '1 hour' WHERE kimlik = $1`, [n]);
    expect(Array.isArray((await o.ist('GET', '/api/kalite/kritik-uygunsuzluklar', await o.gir('km'))).json())).toBe(true); expect((await o.ist('GET', '/api/kalite/kritik-uygunsuzluklar', await o.gir('ds'))).statusCode).toBe(404); // T-YG1693
    await kaliteSureIsle(o.db); await kaliteSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Uygunsuzluk Süre Aşımı' AND nesne_kimligi = $1`, [n])).rows[0].n).toBe(1);
    { // T-YG1689: haftalık uygunsuzluk süre raporu Pazartesi, haftada bir
      expect(await uygunsuzlukHaftalikRapor(o.db, new Date('2030-01-08T06:00:00Z'))).toBe(false); // Salı
      expect(await uygunsuzlukHaftalikRapor(o.db, new Date('2030-01-07T06:00:00Z'))).toBe(true); expect(await uygunsuzlukHaftalikRapor(o.db, new Date('2030-01-07T09:00:00Z'))).toBe(false);
      expect((await o.sup.query(`SELECT ozet FROM is_karti WHERE tur = 'Haftalık Uygunsuzluk Süre Raporu' ORDER BY olusturma_zamani DESC LIMIT 1`)).rows[0].ozet).toMatch(/Süresi geçen \d+/);
    }
    expect((await o.ist('POST', `/api/uygunsuzluk/${n}/kapat`, kk, { sonuc: 'Uygun', kanit: await o.belge(d.kimlik, 'ds') })).json().statu).toBe('Kapalı');
  });
});
describe('test (YG-286, YG-396, YG-397)', () => {
  it('öznel ölçüt yok, kalibrasyonsuz cihaz yok, üç ayrı kişi, yeniden test yeni numara; başarısızı başarılı yenileme kapıyı açar', async () => {
    const d = await dosya(); const tu = await o.gir('kk'); /* YG-1485: test kaydını Kalite Kontrolör girer */ const T = { grup: 'Makine ve Tahrik', amac: 'A', yontem: 'Y', olcut: '≤ 80 °C', durdurma: 'Alarm' }; const u = `/api/dosya/${d.kimlik}/test`;
    expect((await o.ist('POST', u, tu, { ...T, olcut: 'normal' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/olcum-cihazi', await o.gir('tu'), { ad: 'Termometre', seri: `S${Math.random()}`, tarih: '2020-01-01' })).statusCode).toBe(400); // T-YG402-TURKAK
    const c = (await o.ist('POST', '/api/olcum-cihazi', await o.gir('tu'), { ad: 'Termometre', seri: `S${Math.random()}`, tarih: '2020-01-01', turkak: true })).json().kimlik;
    expect((await o.ist('POST', u, tu, { ...T, cihazlar: [c] })).json().hata).toContain('kalibrasyonu');
    { const env = (await o.ist('GET', '/api/olcum-cihazi', await o.gir('km'))).json(); expect(env.find((x: { kimlik: string }) => x.kimlik === c)).toMatchObject({ gecerlilik_sonu: '2021-01-01' }); expect(env.find((x: { kimlik: string }) => x.kimlik === c).kalan_gun).toBeLessThan(0); } // T-YG1691
    expect((await o.ist('GET', '/api/olcum-cihazi', await o.gir('ds'))).statusCode).toBe(404);
    const t = await o.ist('POST', u, tu, T);
    expect(t.statusCode, t.body).toBe(200); expect(t.json().testNo).toBe(`${d.dosyaNo}-TS01`);
    const id = t.json().kimlik; const ham = await o.belge(d.kimlik, 'ds');
    const bitir = async (x: string, sonuc: string) => { expect((await o.ist('POST', `/api/test/${x}/sonuc`, tu, { sonuc, gerekce: 'G', hamVeri: ham, ek: { denemeProfili: 'Liman çıkışı, 30 dk, %75 yük', isletimKisiti: 'Yok' } })).statusCode).toBe(200); expect((await o.ist('POST', `/api/test/${x}/kontrol`, await o.gir('ty'))).statusCode).toBe(200); return o.ist('POST', `/api/test/${x}/karar`, await o.gir('tm')); };
    expect((await o.ist('POST', `/api/test/${id}/sonuc`, await o.gir('ty'), { sonuc: 'Başarısız', gerekce: 'G', hamVeri: ham })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/test/${id}/sonuc`, tu, { sonuc: 'Başarısız', gerekce: 'G' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/test/${id}/sonuc`, tu, { sonuc: 'Başarısız', gerekce: 'G', hamVeri: ham, ek: { denemeProfili: 'P' } })).json().hata).toContain('İşletim Kısıtı'); // YG-286 FR-KLT-007
    expect((await bitir(id, 'Başarısız')).json().sonuc).toBe('Başarısız');
    { const pd = await o.ist('GET', `/api/test/${id}/pdf`, tu); expect(pd.statusCode).toBe(200); expect(pd.headers['content-type']).toContain('pdf'); } // YG-1451
    expect((await o.ist('POST', `/api/test/${id}/sonuc`, tu, { sonuc: 'Başarılı', gerekce: 'G', hamVeri: ham })).statusCode).toBe(409);
    const E = { kimlik: '00000000-0000-0000-0000-000000000000', dosya_ref: d.kimlik };
    expect(await kabulEngeli(o.db, E, 'Kabul')).toContain('Başarısız');
    const t2 = (await o.ist('POST', u, tu, { ...T, onceki: id })).json();
    expect(t2.testNo).toBe(`${d.dosyaNo}-TS02`);
    expect(await kabulEngeli(o.db, E, 'Kabul')).toContain('tamamlanmamış');
    await bitir(t2.kimlik, 'Başarılı');
    expect(await kabulEngeli(o.db, E, 'Kabul')).toBeNull();
    const a = await o.ist('POST', `/api/test/${t2.kimlik}/kontrol`, tu); expect(a.statusCode).toBe(409);
  });
  it('dış uzman / muayene raporu sonucu test sonucuna eşlenir (YG-398)', async () => {
    const d = await dosya(); const tu = await o.gir('kk'); /* YG-1485: test kaydını Kalite Kontrolör girer */ const T = { grup: 'Makine ve Tahrik', amac: 'A', yontem: 'Y', olcut: '≤ 80 °C', durdurma: 'Alarm' }; const ham = await o.belge(d.kimlik, 'ds');
    const dx = (await o.ist('POST', `/api/dosya/${d.kimlik}/test`, tu, T)).json().kimlik;
    expect((await o.ist('POST', `/api/test/${dx}/sonuc`, tu, { disRapor: 'Uygun Değil', sonuc: 'Başarılı', gerekce: 'G', hamVeri: ham })).json().hata).toContain('Başarısız');
    expect((await o.ist('POST', `/api/test/${dx}/sonuc`, tu, { disRapor: 'Uygun Değil', gerekce: 'G', hamVeri: ham, ek: { denemeProfili: 'Liman çıkışı, 30 dk, %75 yük', isletimKisiti: 'Yok' } })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT sonuc, dis_rapor_sonucu FROM test_kaydi WHERE kimlik = $1`, [dx])).rows[0]).toEqual({ sonuc: 'Başarısız', dis_rapor_sonucu: 'Uygun Değil' });
  });
  it('hazırlayan kontrol edemez, kontrol eden karar veremez', async () => {
    const d = await dosya(); const tu = await o.gir('kk'); /* YG-1485: test kaydını Kalite Kontrolör girer */ const id = (await o.ist('POST', `/api/dosya/${d.kimlik}/test`, tu, { grup: 'Makine ve Tahrik', amac: 'A', yontem: 'Y', olcut: '5 bar', durdurma: 'D' })).json().kimlik;
    await o.ist('POST', `/api/test/${id}/sonuc`, tu, { sonuc: 'Başarılı', gerekce: 'G', hamVeri: await o.belge(d.kimlik, 'ds'), ek: { denemeProfili: 'Liman çıkışı, 30 dk, %75 yük', isletimKisiti: 'Yok' } });
    expect((await o.ist('POST', `/api/test/${id}/kontrol`, tu)).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/test/${id}/kontrol`, await o.gir('ty'))).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/test/${id}/karar`, await o.gir('ty'))).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/test/${id}/karar`, await o.gir('tm'))).statusCode).toBe(200);
  });
});
describe('kabul (YG-281, YG-287, YG-289, YG-400, YG-401)', () => {
  it('açık Majör koşullu kabulü, açık Minör tam kabulü durdurur; koşullu kabul 30 gün, bir uzatma, süre dolunca Beklemede', async () => {
    const d = await dosya(); const e = await isEmri(d, 'Tamamlandı'); const tu = await o.gir('tu'); const km = await o.gir('km'); const u = `/api/is-emri/${e}/kosullu-kabul`;
    const P = { bitis: ileri(30), kalemler: [{ tanim: 'T', etki: 'E', hedef: ileri(10), bedel: 0, sorumlu: 'Firma' }], etkiler: { mali: 'Yok', garanti: 'Kalem garantisi düzeltmeden başlar', guvenlik: 'Yok', musteri: 'Kullanıma engel değil' } };
    const mj = (await ncr(d, { sinif: 'Majör', isEmri: e })).json().kimlik;
    expect((await o.ist('POST', u, tu, P)).json().hata).toContain('Majör');
    await o.sup.query(`UPDATE uygunsuzluk SET statu = 'Kapalı' WHERE kimlik = $1`, [mj]);
    await ncr(d, { sinif: 'Minör', isEmri: e });
    expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Kabul' })).json().hata).toContain('Minör');
    expect((await o.ist('POST', u, tu, { ...P, bitis: ileri(32) })).statusCode).toBe(400);
    expect((await o.ist('POST', u, tu, { ...P, etkiler: { mali: 'Yok' } })).json().hata).toContain('güvenlik'); // YG-415
    const k = await o.ist('POST', u, tu, P);
    expect(k.statusCode, k.body).toBe(200);
    expect((await o.kart('Koşullu Kabul Etki Onayı', k.json().kimlik)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/kabul/${k.json().kimlik}/uzat`, tu)).statusCode).toBe(403);
    // YG-1692 (T-YG1692): Dosya Sorumlusu gerekçeyle talep eder, Kalite Müdürü onaylar; ikinci uzatma yok
    const ku = `/api/kabul/${k.json().kimlik}/uzatma-talebi`;
    expect((await o.ist('POST', ku, tu, { gerekce: 'Parça gecikti' })).statusCode).toBe(403);
    expect((await o.ist('POST', ku, await o.gir('ds'), { gerekce: '' })).statusCode).toBe(400);
    const kt = await o.ist('POST', ku, await o.gir('ds'), { gerekce: 'Parça gecikti' }); expect(kt.statusCode, kt.body).toBe(200);
    expect((await o.ist('POST', ku, await o.gir('ds'), { gerekce: 'Tekrar' })).statusCode).toBe(409);
    const once = (await o.sup.query(`SELECT kosul_bitis FROM kabul_kaydi WHERE kimlik = $1`, [k.json().kimlik])).rows[0].kosul_bitis;
    expect((await o.ist('POST', `/api/is/${kt.json().kimlik}/karar`, km, { karar: 'Onayla' })).statusCode).toBe(200);
    const sonra = (await o.sup.query(`SELECT kosul_bitis, uzatildi FROM kabul_kaydi WHERE kimlik = $1`, [k.json().kimlik])).rows[0];
    expect((new Date(sonra.kosul_bitis).getTime() - new Date(once).getTime()) / 86_400_000).toBe(15); expect(sonra.uzatildi).toBe(true);
    expect((await o.ist('POST', `/api/kabul/${k.json().kimlik}/uzat`, km)).statusCode).toBe(409);
    await o.sup.query(`UPDATE kabul_kaydi SET kosul_bitis = current_date - 1 WHERE kimlik = $1`, [k.json().kimlik]);
    await kaliteSureIsle(o.db); await kaliteSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM beklemede_isareti WHERE dosya_ref = $1 AND neden = 'Koşullu Kabul Süresi Doldu'`, [d.kimlik])).rows[0].n).toBe(1);
    expect((await o.sup.query(`SELECT gecikti FROM acik_is_kalemi WHERE kabul_ref = $1`, [k.json().kimlik])).rows[0].gecikti).toBe(true);
    const ai = (await o.sup.query(`SELECT kimlik FROM acik_is_kalemi WHERE kabul_ref = $1`, [k.json().kimlik])).rows[0].kimlik as string; // YG-1446 BLD-15
    expect((await o.ist('POST', `/api/acik-is/${ai}/kapat`, await o.gir('ds'), { kanit: await o.belge(d.kimlik, 'ds') })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld15:${ai}%`])).rows[0]?.metin).toContain('tamamlanmıştır');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/nihai-kabul`, await o.gir('ty'))).statusCode).toBe(409);
  });
  it('nihai kabul: bütünleşik test şartı, garanti başlangıcı', async () => {
    const d = await dosya(); const ty = await o.gir('ty');
    const ek = (g: string) => o.sup.query(`INSERT INTO test_kaydi (test_no, dosya_ref, test_grubu, amac_kapsam, yontem, kabul_olcutu, durdurma_kosulu, sonuc, durum, hazirlayan_ref) VALUES ($1,$2,$3,'A','Y','Ö','D','Başarılı','Tamamlandı',$4)`, [`${d.dosyaNo}-TX${Math.random()}`, d.kimlik, g, o.K.tu]);
    await ek('Makine ve Tahrik'); await ek('Elektrik/Elektronik');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/nihai-kabul`, ty)).json().hata).toContain('Bütünleşik');
    await ek('Arayüz / Bütünleşik');
    // T-YG082-GARANTI (KS-1): karar yalnız Dosya Sorumlusundan; tanımlıysa başlangıç yazılır.
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/garanti`, ty, { tanimli: true, sureAy: 12, kapsam: 'İşçilik' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/garanti`, await o.gir('ds'), { tanimli: true, sureAy: 12 })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/garanti`, await o.gir('ds'), { tanimli: true, sureAy: 12, kapsam: 'İşçilik' })).statusCode).toBe(200);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/nihai-kabul`, ty);
    expect(r.statusCode, r.body).toBe(200); expect(r.json().garantiBaslangic).toBe(ileri(0));
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/garanti`, await o.gir('ds'), { tanimli: false })).statusCode).toBe(409);
  });
  it('garanti kararı verilmeden nihai kabulde garanti oluşmaz (T-YG870-YOK)', async () => {
    const d = await dosya(); const ty = await o.gir('ty');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/nihai-kabul`, ty);
    expect(r.statusCode, r.body).toBe(200); expect(r.json().garantiBaslangic).toBeNull();
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Garanti Kararı' AND nesne_kimligi = $1`, [d.kimlik])).rows[0].n).toBe(1);
  });
  it('kanıtsız gereklilik tam kabulü durdurur', async () => {
    const d = await dosya(); const e = await isEmri(d, 'Tamamlandı'); const tu = await o.gir('tu');
    const p = (await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'C', ozet: 'Ö', risk: 'Orta', teknikKaynak: 'ISO 12215', gereklilikler: [{ gereklilik: 'G', dogrulama: 'D' }] })).json().kimlik;
    await o.karar((await o.kart('Kalite Planı', p)).kimlik, 'ty', 'Onayla');
    expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Kabul' })).json().hata).toContain('gerekliliğin');
    const g = (await o.sup.query(`SELECT kimlik FROM gereklilik_satiri WHERE plan_ref = $1`, [p])).rows[0].kimlik;
    expect((await o.ist('POST', `/api/gereklilik/${g}/kanit`, tu, { belge: await o.belge(d.kimlik, 'ds'), durum: 'Karşılandı' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Bekletmede' })).statusCode).toBe(400); // YG-649 gerekçe
    expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Bekletmede', gerekce: 'Parça bekleniyor' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/is-emri/${e}/kapat`, tu, {})).statusCode).not.toBe(200);
    expect((await o.sup.query(`SELECT neden FROM beklemede_isareti WHERE kayit_referansi = $1 AND kaldirilma_zamani IS NULL`, [e])).rows[0]?.neden).toBe('Kabul Bekletmede'); // YG-399
    { // YG-082: garanti tanımlı dosyada kaynak zorunlu; garanti paketin kabul gününde başlar
      const dr = (await o.sup.query(`SELECT dosya_ref FROM is_emri WHERE kimlik = $1`, [e])).rows[0].dosya_ref;
      await o.sup.query(`UPDATE dosya SET garanti_tanimli = true, garanti_suresi_ay = 12, garanti_kapsami = 'İşçilik ve malzeme' WHERE kimlik = $1`, [dr]);
      expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Kabul' })).json().hata).toContain('Garanti kaynağını');
    }
    expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Kabul', garantiKaynagi: 'İşçilik' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT garanti_kaynagi, garanti_baslangic IS NOT NULL b FROM kabul_kaydi WHERE is_emri_ref = $1 AND kabul_turu = 'Teknik Kabul'`, [e])).rows[0]).toEqual({ garanti_kaynagi: 'İşçilik', b: true });
  });
});
describe('kontrol noktası (YG-383, YG-389)', () => {
  it('davet süresi, A sınıfında iki onay', async () => {
    const d = await dosya(); const e = await isEmri(d); await o.sup.query(`UPDATE is_emri SET kabul_sinifi = 'A' WHERE kimlik = $1`, [e]); const tu = await o.gir('tu'); const u = `/api/is-emri/${e}/kontrol-noktasi`;
    const K = { tur: 'Bekletme', ozellik: 'Ö', olcut: '5 bar', zaman: new Date(Date.now() + 30 * 3_600_000).toISOString(), davetliler: 'Firma ekip lideri' };
    expect((await o.ist('POST', u, tu, { ...K, davetliler: '' })).json().hata).toContain('Davet edilen'); // YG-329
    expect((await o.ist('POST', u, tu, { ...K, eksperKlas: true })).json().hata).toContain('48');
    expect((await o.ist('POST', u, tu, { ...K, olcut: 'Uygun görüldü' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, tu, K);
    expect(r.statusCode, r.body).toBe(200); expect(r.json().no).toMatch(/-KP01$/);
    expect((await o.sup.query(`SELECT davet_edilenler, davet_kanali FROM kontrol_noktasi WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ davet_edilenler: 'Firma ekip lideri', davet_kanali: ['YATONET 360 bildirimi', 'SMS', 'E-posta'] });
    const id = r.json().kimlik; const kanit = await o.belge(d.kimlik, 'ds'); const su = `/api/kontrol-noktasi/${id}/sonuc`;
    expect((await o.ist('POST', su, tu, { sonuc: 'Uygun', kanit })).statusCode).toBe(403);
    expect((await o.ist('POST', su, await o.gir('ty'), { sonuc: 'Uygun', kanit })).json()).toMatchObject({ serbest: false, bekleyen: ['Kalite Müdürü'] });
    expect((await o.ist('POST', su, await o.gir('km'), { sonuc: 'Uygun', kanit })).json().serbest).toBe(true);
    { // T-YG383-NCR: olumsuz sonuçta uygunsuzluk kendiliğinden açılır, ikinci olumsuz sonuçta yenisi açılmaz
      const r2 = await o.ist('POST', u, tu, K); const su2 = `/api/kontrol-noktasi/${r2.json().kimlik}/sonuc`;
      expect((await o.ist('POST', su2, await o.gir('ty'), { sonuc: 'Reddedildi', kanit })).statusCode).toBe(200);
      expect((await o.ist('POST', su2, await o.gir('ty'), { sonuc: 'Düzeltme gerekli', kanit })).statusCode).toBe(200);
      const n = (await o.sup.query(`SELECT u.sinif, u.tespit_kaynagi FROM kontrol_noktasi k JOIN uygunsuzluk u ON u.kimlik = k.uygunsuzluk_ref WHERE k.kimlik = $1`, [r2.json().kimlik])).rows;
      expect(n).toEqual([{ sinif: 'Majör', tespit_kaynagi: 'Ara kontrol' }]);
    }
  });
});
describe('tedarik (YG-823, YG-404, YG-1589)', () => {
  const S = () => ({ tedarikci, teklifRef: 'T1', kullanim: 'Ana makine', teslimTarihi: ileri(10), teslimYeri: 'Depo', olcut: 'Ö', gerekce: 'G', kritikSinif: 'K3', belgeSartlari: 'Üretici sertifikası ve uygunluk belgesi; girişte seri no ve görsel kontrol', kalemler: [{ tanim: 'Pompa', parcaNo: 'P1', miktar: 2, birim: 'adet', bedel: 100 }] });
  it('avans alınmadan sipariş yok; zincir; lotsuz giriş yok; fazla teslim yok; eşleştirme mükerrer değil', async () => {
    const d = await dosya();
    const c = await o.gir('ts'); const u = `/api/dosya/${d.kimlik}/siparis`;
    expect((await o.ist('POST', u, await o.gir('ds'), S())).statusCode).toBe(403);
    await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,'Karar','Tam Onay',1000,200,1200,1000,$3)`, [`${d.dosyaNo}-TK01`, d.kimlik, o.K.ds]);
    expect((await o.ist('POST', u, c, S())).json().hata).toContain('Parça bedeli');
    await o.sup.query(`INSERT INTO odeme_talebi (dosya_ref, tur, tutar_eur, muhatap, son_tarih, durum, hazirlayan_ref) VALUES ($1,'Parça',240,'Yat Sahibi',current_date,'Ödendi',$2)`, [d.kimlik, o.K.ds]);
    const r = await o.ist('POST', u, c, S());
    expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ kdvHaric: 200, toplam: 240 });
    const id = r.json().kimlik; const k = await o.kart('Tedarik Siparişi', id);
    expect(k.zincir).toHaveLength(3);
    { // T-YG1592: sipariş onay kartında beş sistem kontrolü ve son onay makamı
      const sk = (await o.ist('GET', `/api/is/${k.kimlik}/siparis-kontrolleri`, await o.gir('tym'))).json();
      expect(sk.kontroller.map((x: { ad: string }) => x.ad)).toEqual(['Aynı Şartla Karşılaştırma', 'Seçim Gerekçesi', 'Onaylı Kaynak', 'Eşik Altına Bölünmeme', 'Görev Ayrılığı', 'K3/K4 Belge ve Giriş Kontrolü Şartı']);
      expect(sk.kontroller[5].sonuc).toBe(true); expect(sk.kritikSinif).toBe('K3'); // T-YG1593-K3
      const gs = (await o.ist('GET', '/api/tedarik/mudurluk-gostergeleri', await o.gir('tym'))).json(); expect(gs.map((x: any) => x.ad)).toContain('Kritik kalem izlenebilirliği (K3–K4)'); // T-YG1593-GOSTERGE
      expect((await o.ist('GET', '/api/tedarik/mudurluk-gostergeleri', await o.gir('ds'))).statusCode).toBe(404);
      { // T-YG1594-KAYNAK: K4 tek kaynak bağımlılığı, ikinci kaynak planı, muadil gözden geçirme görevi; YG-784 tedarikçi karnesi
        await o.sup.query(`UPDATE tedarik_siparisi SET kritik_sinif = 'K4' WHERE kimlik = $1`, [id]);
        const pn = (await o.sup.query(`SELECT uretici_parca_no FROM tedarik_siparisi_kalemi WHERE siparis_ref = $1 ORDER BY satir_no LIMIT 1`, [id])).rows[0].uretici_parca_no;
        const tym = await o.gir('tym');
        expect((await o.ist('GET', '/api/tedarik/kaynak-risk', await o.gir('ds'))).statusCode).toBe(404);
        const kr = (await o.ist('GET', '/api/tedarik/kaynak-risk', tym)).json();
        expect(kr.tekKaynak.map((x: any) => x.parca)).toContain(pn); expect(kr.muadil.sonraki).toMatch(/-(03|09)$/); expect(Array.isArray(kr.tedarikciler)).toBe(true);
        expect((await o.ist('POST', '/api/tedarik/kaynak-risk/plan', tym, { parca: pn })).statusCode).toBe(400);
        expect((await o.ist('POST', '/api/tedarik/kaynak-risk/plan', tym, { parca: pn, plan: 'İkinci yetkili distribütör teklifi alınacak' })).statusCode).toBe(200);
        expect((await o.ist('GET', '/api/tedarik/kaynak-risk', tym)).json().tekKaynak.find((x: any) => x.parca === pn).plan).toContain('distribütör');
        const { muadilGozdenGecirmeGorevi, tedarikciKarnesi } = await import('../src/tedarik_gosterge.js');
        expect(await muadilGozdenGecirmeGorevi(o.db, new Date('2032-05-02T09:00:00+03:00'))).toBe(false);
        expect(await muadilGozdenGecirmeGorevi(o.db, new Date('2032-09-01T09:00:00+03:00'))).toBe(true); expect(await muadilGozdenGecirmeGorevi(o.db, new Date('2032-09-05T09:00:00+03:00'))).toBe(false);
        expect(await o.kart('Muadil Liste Gözden Geçirmesi', '2032-09')).toBeTruthy();
        const kn = await tedarikciKarnesi(o.db, new Date('2099-01-01T00:00:00Z')); expect(kn.every((x) => x.siparis < 3 ? x.puan === null : typeof x.puan === 'number')).toBe(true);
      }
      const { tedarikciAylikPerformans } = await import('../src/tedarik_gosterge.js');
      expect(await tedarikciAylikPerformans(o.db, new Date('2031-05-02T09:00:00+03:00'))).toBe(true); expect(await tedarikciAylikPerformans(o.db, new Date('2031-05-03T09:00:00+03:00'))).toBe(false);
      { // YG-1594: aylık yönetim raporu ayda bir; Tedarik Yönetimi Müdürü → Teknik ve Operasyon Direktörü
        const { tedarikAylikYonetimRaporu } = await import('../src/tedarik_gosterge.js');
        expect(await tedarikAylikYonetimRaporu(o.db, new Date('2031-05-02T09:00:00+03:00'))).toBe(true); expect(await tedarikAylikYonetimRaporu(o.db, new Date('2031-05-20T09:00:00+03:00'))).toBe(false);
        const yk = (await o.sup.query(`SELECT ozet, zincir FROM is_karti WHERE tur = 'Tedarik Aylık Yönetim Raporu' AND nesne_kimligi = '2031-04'`)).rows[0];
        expect(yk.ozet).toContain('Zamanında teslim oranı'); expect(yk.zincir).toHaveLength(2);
      }
      expect(sk.kontroller.find((x: { ad: string }) => x.ad === 'Onaylı Kaynak').sonuc).toBe(true); expect(sk.sonMakam).toBeTruthy();
      expect((await o.ist('GET', `/api/is/${k.kimlik}/siparis-kontrolleri`, await o.gir('ds'))).statusCode).toBe(404);
    }
    const G = { satir: 1, miktar: 2, lot: 'L1', irsaliye: 'İ1', bekletmeYeri: firma };
    expect((await o.ist('POST', `/api/siparis/${id}/giris`, c, G)).statusCode).toBe(409);
    await o.karar(k.kimlik, 'tym', 'Onaya Gönder'); await o.karar(k.kimlik, 'to', 'Onaya Gönder'); expect((await o.karar(k.kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM belge_uretim WHERE tur = 'Tedarik Siparişi' AND nesne = $1`, [id])).rowCount).toBe(1); // YG-1514
    expect((await o.ist('POST', `/api/siparis/${id}/giris`, c, { ...G, lot: '' })).json().hata).toContain('lot');
    expect((await o.ist('POST', `/api/siparis/${id}/giris`, c, { ...G, miktar: 3 })).json().hata).toContain('Fazla');
    const g = await o.ist('POST', `/api/siparis/${id}/giris`, c, G);
    expect(g.statusCode, g.body).toBe(200); expect(g.json().gonderilen).toBe('Teknik Uzman');
    expect((await o.ist('POST', `/api/malzeme-giris/${g.json().kimlik}/karar`, c, { karar: 'Kabul' })).statusCode).toBe(403);
    // YG-1593 (T-YG1593): karantina 10 günlük karar görevi açar; karantinadan nihai kararla görev kapanır
    expect((await o.ist('POST', `/api/malzeme-giris/${g.json().kimlik}/karar`, await o.gir('tu'), { karar: 'Karantina' })).statusCode).toBe(200);
    expect((await o.kart('Karantina Kararı', g.json().kimlik)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/malzeme-giris/${g.json().kimlik}/karar`, await o.gir('tu'), { karar: 'Karantina' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/malzeme-giris/${g.json().kimlik}/karar`, await o.gir('tu'), { karar: 'Kabul' })).statusCode).toBe(200);
    expect((await o.kart('Karantina Kararı', g.json().kimlik)).durum).toBe('Tamamlandı');
    expect((await o.sup.query(`SELECT statu FROM tedarik_siparisi WHERE kimlik = $1`, [id])).rows[0].statu).toBe('Teslim Alındı');
    { const kb = await o.belge(d.kimlik, 'ds'); const nu = await o.ist('POST', `/api/dosya/${d.kimlik}/uygunsuzluk`, await o.gir('tu'), { giris: g.json().kimlik, kaynak: 'Malzeme Girişi', yer: 'Depo', olcut: 'Sertifika', durum: 'Sertifika eksik', belge: kb, sinif: 'Minör' }); // YG-298
      expect(nu.statusCode, nu.body).toBe(200); expect((await o.sup.query(`SELECT sorumlu_firma_ref FROM uygunsuzluk WHERE kimlik = $1`, [nu.json().kimlik])).rows[0].sorumlu_firma_ref).toBe(tedarikci); }
    expect((await o.ist('POST', `/api/siparis/${id}/eslestirme`, c, { no: 'F1', tarih: ileri(0), tutar: 200 })).json().sonuc).toBe('Eşleşti');
    expect((await o.ist('POST', `/api/siparis/${id}/eslestirme`, c, { no: 'F1', tarih: ileri(0), tutar: 200 })).statusCode).toBe(409);
  });
});

describe('uzun terminli parça (YG-868)', () => {
  it('teslim süresi 14 günü aşan sipariş uzun terminli işaretlenir ve GMY onayından geçer', async () => {
    const d = await dosya(); const c = await o.gir('ts'); const u = `/api/dosya/${d.kimlik}/siparis`;
    await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,'Karar','Tam Onay',1000,200,1200,1000,$3)`, [`${d.dosyaNo}-TK01`, d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO odeme_talebi (dosya_ref, tur, tutar_eur, muhatap, son_tarih, durum, hazirlayan_ref) VALUES ($1,'Parça',600,'Yat Sahibi',current_date,'Ödendi',$2)`, [d.kimlik, o.K.ds]);
    const S = (g: number) => ({ tedarikci, teklifRef: 'T1', kullanim: 'Ana makine', teslimTarihi: ileri(g), teslimYeri: 'Depo', olcut: 'Ö', gerekce: 'G', kalemler: [{ tanim: 'Pompa', parcaNo: `P${g}`, miktar: 1, birim: 'adet', bedel: 100 }] });
    const kisa = await o.ist('POST', u, c, S(10)); expect(kisa.statusCode, kisa.body).toBe(200); expect(kisa.json().uzunTerminli).toBe(false);
    const uzun = await o.ist('POST', u, c, S(20)); expect(uzun.statusCode, uzun.body).toBe(200); expect(uzun.json().uzunTerminli).toBe(true);
    const gmy = (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Genel Müdür Yardımcısı'`)).rows[0].kimlik;
    expect((await o.kart('Tedarik Siparişi', uzun.json().kimlik)).zincir).toContain(gmy);
    expect((await o.kart('Tedarik Siparişi', kisa.json().kimlik)).zincir).not.toContain(gmy);
    expect((await o.sup.query(`SELECT uzun_terminli FROM tedarik_siparisi WHERE kimlik = $1`, [uzun.json().kimlik])).rows[0].uzun_terminli).toBe(true);
  });
});

describe('iş emri izlenebilirliği (YG-384, YG-004; PKT-1 iş paketi = iş emri)', () => {
  it('test iş emrine bağlanır, başka dosyanın iş emri kabul edilmez; başarısız test yalnız kendi iş emrinin kabulünü tutar', async () => {
    const d2 = await dosya(); const d = await dosya(); const kk = await o.gir('kk');
    const e1 = await isEmri(d); const e2 = await isEmri(d); const yabanci = await isEmri(d2);
    const T = { grup: 'Makine ve Tahrik', amac: 'A', yontem: 'Y', olcut: '5 bar', durdurma: 'D' };
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/test`, kk, { ...T, isEmri: yabanci })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/test`, kk, { ...T, isEmri: e1 }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT is_emri_ref FROM test_kaydi WHERE kimlik = $1`, [r.json().kimlik])).rows[0].is_emri_ref).toBe(e1);
    expect(await kabulEngeli(o.db, { kimlik: e1, dosya_ref: d.kimlik }, 'Kabul')).toContain('test'); // tamamlanmamış test kendi iş emrini tutar
    const e2Engel = await kabulEngeli(o.db, { kimlik: e2, dosya_ref: d.kimlik }, 'Kabul'); expect(e2Engel ?? '').not.toMatch(/test/i);
    const iz = await o.ist('GET', `/api/is-emri/${e1}/izlenebilirlik`, await o.gir('ds')); expect(iz.statusCode, iz.body).toBe(200);
    expect(iz.json().testler).toHaveLength(1);
  });
});

describe('iş emri Beklemede işareti (YG-068; PKT-1)', () => {
  it('işaret iş emrine konur; dosya sayacı durmaz, dosya statüsü korunur, aynı neden iş emri başına bir kez; başka dosyanın iş emri kabul edilmez', async () => {
    const d2 = await dosya(); const d = await dosya(); const ds = await o.gir('ds'); const e = await isEmri(d); const yabanci = await isEmri(d2);
    const B = async (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/beklemede`, ds, { neden: 'Hava', sorumlu: o.K.ds, hedefTarih: '2099-01-01', kanitBelge: await o.belge(d.kimlik, 'ds'), ...x });
    expect((await B({ isEmri: yabanci })).statusCode).toBe(400);
    const r = await B({ isEmri: e }); expect(r.statusCode, r.body).toBe(200); expect(r.json().sayacDurur).toBe(false);
    expect((await o.sup.query(`SELECT kayit_turu, kayit_referansi FROM beklemede_isareti WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ kayit_turu: 'İş Emri', kayit_referansi: e });
    expect((await B({ isEmri: e })).statusCode).toBe(409);
    expect((await B({})).statusCode).toBe(200); // dosya düzeyindeki işaret ayrıdır
  });
});

describe('kabul sınıfı asgarisi (YG-281)', () => {
  it('Kritik risk veya taşıyıcı yapı işi A, Yüksek risk en az B ister', async () => {
    const { asgariKabulSinifi } = await import('../src/kalite.js');
    const sahte = (br: string[], on: string[]) => ({ query: (async (sql: string) => ({ rows: sql.includes('kartela_kodu') ? br.map((b) => ({ b })) : on.map((o) => ({ o })) })) as never });
    expect((await asgariKabulSinifi(sahte(['KOMPOZIT-01'], []), 'x', 'Düşük')).sinif).toBe('A');
    expect((await asgariKabulSinifi(sahte(['BOYA-01'], ['Yüksek']), 'x', 'Düşük')).sinif).toBe('B');
    expect((await asgariKabulSinifi(sahte([], ['Kritik']), 'x', null)).sinif).toBe('A');
    expect((await asgariKabulSinifi(sahte([], ['Orta']), 'x', 'Orta')).sinif).toBeNull();
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); const tu = await o.gir('tu');
    const G = [{ gereklilik: 'Laminasyon', dogrulama: 'Görsel' }];
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'B', ozet: 'Ö', risk: 'Kritik', teknikKaynak: 'ISO 12215', gereklilikler: G });
    expect(r.statusCode).toBe(400); expect(r.json().hata).toContain('en az A');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'C', ozet: 'Ö', risk: 'Yüksek', teknikKaynak: 'ISO 12215', gereklilikler: G })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'B', ozet: 'Ö', risk: 'Yüksek', teknikKaynak: 'ISO 12215', gereklilikler: G })).statusCode).toBe(200);
  });
});
