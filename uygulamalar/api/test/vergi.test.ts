import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alacakIsle } from '../src/ticari.js';
import { isBasiAvansEngeli } from '../src/tedarik.js';
import { kdvBelirle, kdvHesapla } from '../src/vergi.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', mfm: 'Muhasebe ve Finans Müdürü', tid: 'Ticari İşler Direktörü', gmy: 'Genel Müdür Yardımcısı' };
let o: Ortam; let say = 0;
const belge = async (bag = 'Vergi Dayanağı', id = 'x') => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'K','Gizli',$2,$3,'Sistem',current_date,$4) RETURNING kimlik`, [`D-${Math.random()}`, bag, id, o.K.mfm])).rows[0].kimlik as string;
const teklif = async (d: { kimlik: string; dosyaNo: string }, muhatap: string, kalem: [string, number][]) => {
  say++; const top = kalem.reduce((a, k) => a + k[1], 0);
  const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, hazirlayan_ref) VALUES ($1,$2,$3,20,'Karar','Tam Onay',$4,$5,$6,$7) RETURNING kimlik`, [`${d.dosyaNo}-T${say}`, d.kimlik, muhatap, top, top * 0.2, top * 1.2, o.K.ts])).rows[0].kimlik as string;
  let n = 0; for (const [bt, tu] of kalem) await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur, onay_durumu) VALUES ($1,$2,'K','Onarım',$3,1,'adet',$4,$4,'Onaylandı')`, [t, ++n, bt, tu]);
  return t;
};
const sigortali = async (ad: string) => { const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya SET dosya_niteligi = 'Sigorta bağlantılı', musteri_turu = 'Sigorta Şirketi' WHERE kimlik = $1`, [d.kimlik]); await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi, sigorta_hasar_dosya_no, olusturan_ref) VALUES ($1,$2,'H-1',$3) ON CONFLICT (dosya_ref) DO UPDATE SET sigortaci_adi = EXCLUDED.sigortaci_adi, sigorta_hasar_dosya_no = 'H-1'`, [d.kimlik, ad, o.K.ds]); return d; };

beforeAll(async () => { o = await ortamKur('yatonet360_test37', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('KDV hesabı', () => {
  it('istisnada yalnız malzeme, tevkifatta KDV payı düşer', () => {
    expect(kdvHesapla(1000, 300, 20, { durum: 'KDV istisnası', tevkifat: null })).toEqual({ taban: 300, kdv: 60, tevkifat: 0, toplam: 1060 });
    expect(kdvHesapla(1000, 0, 20, { durum: 'KDV tevkifatlı', tevkifat: { pay: 7, payda: 10 } })).toEqual({ taban: 1000, kdv: 200, tevkifat: 140, toplam: 1060 });
    expect(kdvHesapla(1000, 300, 20, { durum: 'Standart KDV', tevkifat: null }).kdv).toBe(200);
  });
});

describe('vergi profili (YG-879)', () => {
  it('dayanaksız kaydedilmez; yalnız Müdür; yürürlükten önceki faturaya uygulanmaz', async () => {
    const P = { sigortaci: 'Vergi Sigorta', uygulama: 'KDV tevkifatlı', pay: 7, payda: 10, yururluk: '2026-06-01' }; const m = await o.gir('mfm');
    expect((await o.ist('POST', '/api/sigorta-vergi-profili', await o.gir('ts'), { ...P, belge: await belge() })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/sigorta-vergi-profili', m, P)).json().hata).toContain('özelge');
    expect((await o.ist('POST', '/api/sigorta-vergi-profili', m, { ...P, pay: undefined, belge: await belge() })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/sigorta-vergi-profili', m, { ...P, belge: await belge() })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/sigorta-vergi-profili', m, { ...P, belge: await belge() })).statusCode).toBe(409);
    const d = await sigortali('Vergi Sigorta');
    expect((await kdvBelirle(o.db, d.kimlik, 'Sigorta Şirketi', new Date('2026-05-31'))).durum).toBe('Standart KDV');
    expect(await kdvBelirle(o.db, d.kimlik, 'Sigorta Şirketi', new Date('2026-06-01'))).toEqual({ durum: 'KDV tevkifatlı', tevkifat: { pay: 7, payda: 10 } });
    // Sonraki profil eskisini silmez, yalnız kendi tarihinden sonra geçer.
    expect((await o.ist('POST', '/api/sigorta-vergi-profili', m, { sigortaci: 'Vergi Sigorta', uygulama: 'Standart KDV', yururluk: '2026-09-01', belge: await belge() })).statusCode).toBe(200);
    expect((await kdvBelirle(o.db, d.kimlik, 'Sigorta Şirketi', new Date('2026-08-31'))).durum).toBe('KDV tevkifatlı');
    expect((await kdvBelirle(o.db, d.kimlik, 'Sigorta Şirketi', new Date('2026-09-01'))).durum).toBe('Standart KDV');
    await o.ist('POST', '/api/sigorta-vergi-profili', m, { ...P, yururluk: '2026-10-01', belge: await belge() });
    const t = await teklif(d, 'Sigorta Şirketi', [['İşçilik', 1000]]);
    const r = await o.ist('POST', `/api/teklif/${t}/proforma`, await o.gir('ts')); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT kdv_durumu, tevkifat_orani, tevkifat_eur, toplam_eur FROM musteri_faturasi WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ kdv_durumu: 'KDV tevkifatlı', tevkifat_orani: '7/10', tevkifat_eur: '140.00', toplam_eur: '1060.00' });
  });
});

describe('KDV istisnası (YG-878, YG-881)', () => {
  it('yalnız hizmete; yazı süresi dolunca kalkar; KDV TL üzerinden (YG-874)', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const taraf = (await o.sup.query(`SELECT t.kimlik, t.taraf_no FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref JOIN taraf t ON t.kimlik = y.yat_sahibi_ref WHERE d.kimlik = $1`, [d.kimlik])).rows[0];
    const m = await o.gir('mfm');
    expect((await o.ist('POST', '/api/taraf-kdv-istisna', m, { tarafNo: taraf.taraf_no, belge: await belge() })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/taraf-kdv-istisna', m, { tarafNo: taraf.taraf_no, belge: await belge(), bitis: '2099-01-01' })).statusCode).toBe(200);
    const t = await teklif(d, 'Yat Sahibi', [['İşçilik', 700], ['Malzeme', 300]]); const ts = await o.gir('ts');
    const r = await o.ist('POST', `/api/teklif/${t}/proforma`, ts); expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ kdvHaric: 1000, kdv: 60, toplam: 1060 });
    await o.sup.query(`UPDATE musteri_faturasi SET durum = 'Muhasebeye İletildi' WHERE kimlik = $1`, [r.json().kimlik]);
    const fb = await o.ist('POST', `/api/fatura/${r.json().kimlik}/bilgi`, ts, { no: `F${Date.now()}`, tarih: '2026-11-03', kur: 40.1234, kurTarihi: '2026-11-02' }); expect(fb.statusCode, fb.body).toBe(200);
    // 300 EUR × 40,1234 = 12.037,02 TL; KDV %20 = 2.407,40 TL; matrah 40.123,40 TL
    expect((await o.sup.query(`SELECT kdv_tl, toplam_tl FROM musteri_faturasi WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ kdv_tl: '2407.40', toplam_tl: '42530.80' });
    await o.sup.query(`UPDATE taraf SET kdv_istisna_bitis = '2020-01-01' WHERE kimlik = $1`, [taraf.kimlik]);
    expect((await kdvBelirle(o.db, d.kimlik, 'Yat Sahibi')).durum).toBe('Standart KDV');
  });
});

describe('keşif ücreti (YG-864, YG-865, YG-1487)', () => {
  it('bireyselde tarife + bölge dışı; ödenmeden KN yok; teklife mahsup', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); const ts = await o.gir('ts');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kesif-ucreti`, await o.gir('ds'), { sonTarih: '2099-01-01' })).statusCode).toBe(403);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/kesif-ucreti`, ts, { sonTarih: '2099-01-01', bolgeDisi: 40 }); expect(r.statusCode, r.body).toBe(200); expect(r.json().tutar).toBe(190);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kesif-ucreti`, ts, { sonTarih: '2099-01-01' })).statusCode).toBe(409);
  });
  it('sigortalıda talep değil proforma; teklif olmadan da faturalanır; ikinci kez olmaz', async () => {
    const d = await sigortali('Keşif Sigorta'); const ts = await o.gir('ts');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kesif-ucreti`, ts, { sonTarih: '2099-01-01' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kesif-faturasi`, ts, {})).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/kesif-faturasi`, ts, { tutar: 500 }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT teklif_ref, toplam_eur, aciklama FROM musteri_faturasi WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ teklif_ref: null, toplam_eur: '600.00', aciklama: 'Keşif Bedeli' });
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kesif-faturasi`, ts, { tutar: 500 })).statusCode).toBe(409);
    const k = await o.kart('Proforma', r.json().kimlik); await o.karar(k.kimlik, 'mfm', 'Onaya Gönder');
    expect((await o.karar(k.kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
  });
});

describe('dış bildirimler ve avans (YG-421, YG-897, YG-908)', () => {
  it('fatura bilgisi firmaya BLD-80; tahsilat BLD-27; vade ertesi BLD-28; 30 günü aşan avans görevi', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'sahip@bld.local' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]);
    const firma = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'BLD Firma','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-B${Date.now()}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO kurulus_kullanici (kurulus_ref, kullanici_ref) VALUES ($1,$2)`, [firma, o.K.tu]);
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, firma_bedeli_eur, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K','Aktif',800,$4)`, [`${d.dosyaNo}-ON01`, d.kimlik, firma, o.K.ds]);
    const t = await teklif(d, 'Yat Sahibi', [['İşçilik', 1000]]); const ts = await o.gir('ts');
    const r = await o.ist('POST', `/api/teklif/${t}/proforma`, ts); await o.sup.query(`UPDATE musteri_faturasi SET durum = 'Muhasebeye İletildi' WHERE kimlik = $1`, [r.json().kimlik]);
    expect((await o.ist('POST', `/api/fatura/${r.json().kimlik}/bilgi`, ts, { no: `FB${Date.now()}`, tarih: '2026-11-03', kur: 40.5, kurTarihi: '2026-11-02' })).statusCode).toBe(200);
    const m80 = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld80:${r.json().kimlik}:%`])).rows[0].metin as string;
    expect(m80).toContain(`${d.dosyaNo}-ON01`); expect(m80).toContain('800,00'); expect(m80).not.toContain('[');
    expect((await o.ist('POST', '/api/tahsilat', ts, { fatura: r.json().kimlik, tutar: 100, tarih: '2026-11-03', kanal: 'Havale' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari LIKE $1`, [`bld27:${d.kimlik}:%`])).rowCount).toBeGreaterThan(0);
    await alacakIsle(o.db, new Date('2026-11-05T12:00:00Z'));
    const m28 = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld28:${r.json().kimlik}%`])).rows[0]?.metin as string; expect(m28).toContain(d.dosyaNo);
    const av = (await o.sup.query(`INSERT INTO odeme_talebi (dosya_ref, tur, tutar_eur, muhatap, son_tarih, durum, hazirlayan_ref, olusturma_zamani) VALUES ($1,'Avans',500,'Yat Sahibi','2026-11-05','Gönderildi',$2, now() - interval '31 days') RETURNING kimlik`, [d.kimlik, o.K.ts])).rows[0].kimlik;
    await alacakIsle(o.db); expect((await o.kart('Açık Avans', av)).baslik).toContain('30 Günü Aşan');
    expect(await isBasiAvansEngeli(o.db, d.kimlik)).toContain('İş başı avansı');
    await o.sup.query(`UPDATE odeme_talebi SET durum = 'Ödendi' WHERE kimlik = $1`, [av]);
    expect(await isBasiAvansEngeli(o.db, d.kimlik)).toBeNull();
  });
});

describe('ödeme sorumluluğu (YG-894, YG-896)', () => {
  it('sigorta ödemezse yat sahibine aktarılır, BLD-30 gider, PDF kuyruğa girer; sigorta öderse aktarılmaz', async () => {
    const d = await sigortali('Sorumluluk Sigorta'); const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/ayri-kalem`;
    expect((await o.ist('POST', u, ds, { tur: 'Boya', aciklama: 'A', tutar: 10 })).statusCode).toBe(400);
    const a = await o.ist('POST', u, ds, { tur: 'Bekleme ve Muhafaza', aciklama: 'Çekek bekleme', tutar: 300 }); expect(a.statusCode, a.body).toBe(200);
    const b = await o.ist('POST', u, ds, { tur: 'Acil Tedbir', aciklama: 'Pompa', tutar: 200 });
    expect((await o.ist('POST', `/api/ayri-kalem/${a.json().kimlik}/karar`, ds, { karar: 'Sigorta Ödemez' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/ayri-kalem/${a.json().kimlik}/karar`, await o.gir('ts'), { karar: 'Sigorta Öder' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/ayri-kalem/${b.json().kimlik}/karar`, ds, { karar: 'Sigorta Öder' })).json().durum).toBe('Sigorta Öder');
    const r = await o.ist('POST', `/api/ayri-kalem/${a.json().kimlik}/karar`, ds, { karar: 'Sigorta Ödemez', sonTarih: '2099-01-01' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT durum, muhatap, tutar_eur FROM odeme_talebi WHERE kimlik = $1`, [r.json().odemeTalebi])).rows[0]).toEqual({ durum: 'Gönderildi', muhatap: 'Yat Sahibi', tutar_eur: '300.00' });
    expect((await o.sup.query(`SELECT 1 FROM belge_uretim WHERE tur = 'Ödeme Sorumluluğu' AND nesne = $1`, [r.json().odemeTalebi])).rowCount).toBe(1);
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari LIKE $1`, [`bld30:${r.json().odemeTalebi}%`])).rowCount).toBeGreaterThan(0);
    expect((await o.ist('POST', `/api/ayri-kalem/${a.json().kimlik}/karar`, ds, { karar: 'Sigorta Öder' })).statusCode).toBe(409);
  });
});
