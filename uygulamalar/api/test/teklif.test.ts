import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { kalemHesapla, kutuAyikla_test, toplamlar } from './teklif_yardim.js';
import { caymaEngeli, parasalZincir, teklifSureIsle } from '../src/teklif.js';
import { firmaUygunlugu } from '../src/firma.js';
import { ana, ortamKur, type Ortam } from './yardimci.js';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { belgeKuyruguIsle } from '../src/belge_uret.js';
import { Depo } from '../src/depo.js';
import { pdfKapat } from '../src/pdf.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', tid: 'Ticari İşler Direktörü', gmy: 'Genel Müdür Yardımcısı', fym: 'Firma Yönetimi Müdürü', sc: 'Sicil Sorumlusu', mfm: 'Muhasebe ve Finans Müdürü', bceo: 'CEO' };
let o: Ortam; let firma: string; let firmaC: string; let firmaGizli: string; let ceo: string;
const FIRMA_EP = 'firma@deneme.yatonet.local';

async function firmaGir() {
  const g = await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: FIRMA_EP, parola: 'Sinama-Parolasi-2026!' } });
  const c = ana.ckr(g); const q = await o.ist('GET', '/api/kimlik/kurulum', c); firmaGizli = q.json().gizli;
  return ana.ckr(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(firmaGizli, suankiAdim()) }));
}
async function ceoGir() {
  const g = await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: 'ceo@deneme.yatonet.local', parola: 'Sinama-Parolasi-2026!' } });
  const c = ana.ckr(g); const q = await o.ist('GET', '/api/kimlik/kurulum', c);
  return ana.ckr(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
}
const KARTELA = 'KESIF-01.01.03-01'; // maliyet 51,00; bant 56,36–76,25
const cetvel = async (id: string, satirlar: object[] = [{ aciklama: 'İnceleme', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 10, birim: 'saat', kartela: KARTELA }]) => {
  const r = await o.ist('POST', `/api/dosya/${id}/cetvel`, await o.gir('tu'), { satirlar: satirlar.map((x) => ({ olcut: 'Ölçüt', ...x })) }); // YG-137
  expect(r.statusCode, r.body).toBe(200);
  const k = await o.kart('Kapsam Cetveli', r.json().kimlik);
  expect((await o.karar(k.kimlik, 'ty', 'Onayla')).statusCode).toBe(200);
  expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Fiyat Teklifi Hazırla' AND nesne_kimligi = $1`, [r.json().kimlik])).rows[0].n).toBeLessThanOrEqual(1); // YG-1599 (T-YG1599)
  return r.json().kimlik as string;
};
const kesifIsEmri = async (id: string, gonder = true) => {
  await o.sup.query(`UPDATE onay_talebi SET durum = 'Onaylandı' WHERE dosya_ref = $1`, [id]);
  await o.sup.query(`INSERT INTO onay_talebi (dosya_ref, ony_kod, baslik, metin, dugme, alici_ad, telefon, belirtec_ozeti, durum, son_gecerlilik) VALUES ($1,'ONY-01','k','m','d','a','+905550002222',$2,'Onaylandı',now())`, [id, `x${Math.random()}`]);
  const r0 = await o.ist('POST', `/api/dosya/${id}/is-emri`, await o.gir('oy'), { tur: 'KN', firma, yer: 'Marmaris', kapsam: 'Keşif' }); expect(r0.json().hata).toContain('Mali limit'); // YG323-KN
  expect((await o.ist('POST', `/api/dosya/${id}/is-emri`, await o.gir('oy'), { tur: 'AC', firma, yer: 'Marmaris', kapsam: 'Pervane değişimi' })).json().hata).toContain('esas onarım'); // YG253-ACIL
  await o.sup.query(`UPDATE dosya SET yurt_disi = true WHERE kimlik = $1`, [id]); // YG-1486: yurt dışında keşfi LGM Teknik Uzmanı yapar
  expect((await o.ist('POST', `/api/dosya/${id}/is-emri`, await o.gir('oy'), { tur: 'KN', firma, yer: 'Marmaris', kapsam: 'Keşif', bedel: 0 })).json().hata).toContain('LGM Teknik Uzmanınca');
  await o.sup.query(`UPDATE dosya SET yurt_disi = false WHERE kimlik = $1`, [id]);
  const r = await o.ist('POST', `/api/dosya/${id}/is-emri`, await o.gir('oy'), { tur: 'KN', firma, yer: 'Marmaris', kapsam: 'Keşif', bedel: 0 });
  expect(r.statusCode, r.body).toBe(200);
  expect((await o.sup.query(`SELECT yeni_limit_eur FROM is_emri_limit_gecmisi WHERE is_emri_ref = $1`, [r.json().kimlik])).rows).toEqual([{ yeni_limit_eur: '0.00' }]);
  if (gonder) { const g = await o.ist('POST', `/api/is-emri/${r.json().kimlik}/firmaya-gonder`, await o.gir('ds'), {}); expect(g.statusCode, g.body).toBe(200); }
  return r.json();
};
const firmaFiyat = async (id: string, birim: number) => {
  const kap = (await o.ist('GET', `/api/firma-portal/dosya/${id}/kapsam`, firmaC)).json();
  const r = await o.ist('POST', `/api/firma-portal/dosya/${id}/fiyat`, firmaC, { kalemler: kap.map((k: any) => ({ satir: k.kimlik, fiyat: birim })) });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().kimlik as string;
};
const hazir = async (e: Record<string, unknown> = {}, ac: Record<string, unknown> = {}, satirlar?: object[]) => { const d = await o.dosyaAc(e, ac); await o.ekipKur(d.kimlik); await o.ist('POST', `/api/dosya/${d.kimlik}/yat-bilgisi`, await o.gir('ds'), { tahrik: 'Dizel' }); await o.sup.query(`UPDATE yat SET gecici_kayit = false WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]); await kesifIsEmri(d.kimlik); await cetvel(d.kimlik, satirlar); return d; };
const teklifAc = async (d: { kimlik: string }, birim = 51, e: object = {}) => {
  const ff = await firmaFiyat(d.kimlik, birim);
  const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teklif`, await o.gir('ts'), { firmaTeklifi: ff, ...e });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};
const onayla = async (id: string) => {
  const r = await o.ist('POST', `/api/teklif/${id}/onaya-gonder`, await o.gir('ts'));
  expect(r.statusCode, r.body).toBe(200);
  const k = await o.kart('Fiyat Teklifi', id);
  const son = r.json().sonMakam as string;
  if (k.zincir.length > 1) expect((await o.karar(k.kimlik, 'mfm', 'Onaya Gönder')).statusCode).toBe(200);
  const kim = son === 'Ticari İşler Direktörü' ? 'tid' : son === 'Genel Müdür Yardımcısı' ? 'gmy' : null;
  const sonuc = kim ? await o.karar(k.kimlik, kim, 'Onayla') : await o.ist('POST', `/api/is/${k.kimlik}/karar`, ceo, { karar: 'Onayla' });
  expect(sonuc.statusCode, sonuc.body).toBe(200);
  { const ds = (await o.sup.query(`SELECT d.dosya_sorumlusu_ref r FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [id])).rows[0].r; // YG-1601 (T-YG1601)
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Müşteriye Gönder' AND nesne_kimligi = $1`, [id])).rows[0].n).toBe(ds ? 1 : 0); }
  return son;
};

beforeAll(async () => {
  o = await ortamKur('yatonet360_test14', KADRO);
  // Sigorta şirketi portal kullanıcısı: e-posta yoksa teklif portaldan görülür (YG-443).
  await o.sup.query(`INSERT INTO sigorta_kullanici VALUES ($1,'SG')`, [o.K.sc]);
  firmaC = await firmaGir(); ceo = await ceoGir();
  const f = await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: 'Deneme Tersane A.Ş.', rol: 'Çözüm Ortağı' });
  firma = f.json().kimlik;
  const fy = await o.gir('fym');
  expect((await o.ist('POST', `/api/firma/${firma}/statu`, fy, { asama: 'Onaylı', ag: 'Aktif', gerekce: 'Erken' })).statusCode).toBe(409); // T-YG361-INCELEME
  await o.ist('POST', `/api/firma/${firma}/statu`, fy, { asama: 'İncelemede', gerekce: 'Belge doğrulaması' }); await o.ist('POST', `/api/firma/${firma}/statu`, fy, { asama: 'Onaylı', ag: 'Aktif', risk: 'Standart', gerekce: 'Belgeler tamam' });
  const k = (await o.sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, [FIRMA_EP])).rows[0].kimlik;
  expect((await o.ist('POST', `/api/firma/${firma}/kullanici`, fy, { kullanici: k })).statusCode).toBe(200);
}, 120_000);
afterAll(async () => { await pdfKapat(); await o.kapat(); });
beforeEach(async () => { await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE bitis_zamani IS NULL`); });

describe('fiyat kuralı (YG-185, YG-187, YG-1709)', () => {
  it('satış = firma × 1,3; yuvarlama yok, iki hane; kartela maliyetinde bant içinde', () => {
    expect(kalemHesapla(51, 10, 1.3, 0.15, 51)).toEqual({ birimSatis: 66.3, tutar: 663, bantDisi: false, bant: { alt: 56.36, ust: 76.25 } });
  });
  it('bant sınırı: alt ve üst dahil, dışı işaretlenir; kartela dışı kontrol dışında', () => {
    expect(kalemHesapla(43.36, 1, 1.3, 0.15, 51).bantDisi).toBe(false); // 56,37
    expect(kalemHesapla(43.3, 1, 1.3, 0.15, 51).bantDisi).toBe(true); // 56,29
    expect(kalemHesapla(58.65, 1, 1.3, 0.15, 51).bantDisi).toBe(false); // 76,25
    expect(kalemHesapla(58.7, 1, 1.3, 0.15, 51).bantDisi).toBe(true); // 76,31
    expect(kalemHesapla(999, 1, 1.3, 0.15, null)).toMatchObject({ bantDisi: false, bant: null });
  });
  it('toplamlar: ara − indirim − keşif mahsubu + KDV; opsiyon ayrı', () => {
    expect(toplamlar([{ tutar_eur: 1000, opsiyon: false }, { tutar_eur: 200, opsiyon: true }], 5, 100, 20)).toEqual({ ara: 1000, ops: 200, ind: 50, matrah: 850, kdv: 170, genel: 1020 });
    expect(toplamlar([{ tutar_eur: '0.10', opsiyon: false }, { tutar_eur: '0.20', opsiyon: false }], null, 0, 20).ara).toBe(0.3);
  });
  it('onaylı metindeki kutular ayıklanır', () => {
    const r = kutuAyikla_test('Metin. Kutu 1: ☐ Okudum. Kutu 2: ☐ Başlasın.');
    expect(r).toEqual({ metin: 'Metin.', kutular: ['Okudum.', 'Başlasın.'] });
  });
});

describe('kartela ve cetvel (YG-195, YG-198, YG-1706)', () => {
  it('kartela 1.510 kalem, 131 grup (KS-131, YG-1704); arama fiyat vermez', async () => {
    expect((await o.sup.query(`SELECT count(*)::int n FROM kartela_kalemi`)).rows[0].n).toBe(1510);
    expect((await o.sup.query(`SELECT count(*)::int n FROM kartela_birlikte_yazilmaz`)).rows[0].n).toBe(132); // YG-1703: KS-132
    const r = (await o.ist('GET', '/api/kartela/ara?q=KESIF-01.01', firmaC)).json();
    expect(r.length).toBeGreaterThan(0); expect(r[0].maliyet_eur).toBeUndefined();
  });
  it('cetveli Teknik Uzman hazırlar; nitelik, bedel, miktar zorunlu; Yat Sahibi Talebi kısıtı teklif muhatabında', async () => {
    const d = await o.dosyaAc({ sigortaci: 'SG', hasarNo: 'H1' }, { musteriTuru: 'Sigorta Şirketi' }); await o.ekipKur(d.kimlik); const tu = await o.gir('tu');
    const c = (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/cetvel`, tu, { satirlar: [{ aciklama: 'A', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat', olcut: 'Ö', ...x }] });
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/cetvel`, await o.gir('ds'), { satirlar: [{}] })).statusCode).toBe(403);
    expect((await c({ nitelik: 'Yanlış' })).statusCode).toBe(400);
    expect((await c({ bedel: 'Yanlış' })).statusCode).toBe(400);
    expect((await c({ miktar: 0 })).statusCode).toBe(400);
        expect((await c({ kartela: 'YOK-01' })).statusCode).toBe(400);
    expect((await c({})).statusCode).toBe(200);
  });
});

describe('teklif hazırlama (YG-185, YG-1599)', () => {
  it('yalnız Ticari Sorumlu; cetvel onaysız veya firma fiyatı eksikse olmaz; satış fiyatı kuraldan; maliyet yetkisiz rolden gizli', async () => {
    const d = await hazir();
    const ff = await firmaFiyat(d.kimlik, 51);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teklif`, await o.gir('ds'), { firmaTeklifi: ff })).statusCode).toBe(403);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teklif`, await o.gir('ts'), { firmaTeklifi: ff });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ teklifNo: `${d.dosyaNo}-TK01`, araToplam: 663, bantDisi: 0 });
    expect(r.json().genelToplam).toBe(795.6);
    const k = (await o.ist('GET', `/api/teklif/${r.json().kimlik}`, await o.gir('ts'))).json().kalemler[0];
    expect([Number(k.birim_maliyet_eur), Number(k.birim_satis_fiyati_eur)]).toEqual([51, 66.3]);
    const g = (await o.ist('GET', `/api/teklif/${r.json().kimlik}`, await o.gir('ds'))).json().kalemler[0];
    expect(g.birim_maliyet_eur).toBeUndefined();
  });
  it('firma teklifi süresi dolmadan Ticari Sorumluya uyarı; seçilmeyen teklif süresi geçince düşer (YG-1540)', async () => {
    const d = await hazir(); const ff = await firmaFiyat(d.kimlik, 51); const ff2 = await firmaFiyat(d.kimlik, 52);
    await o.sup.query(`UPDATE dosya SET ticari_sorumlu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ts]);
    await o.sup.query(`UPDATE firma_fiyat_teklifi SET gecerlilik = current_date + 2 WHERE kimlik = $1`, [ff]);
    await o.sup.query(`UPDATE firma_fiyat_teklifi SET gecerlilik = current_date - 1 WHERE kimlik = $1`, [ff2]);
    await teklifSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE 'Firma Teklifi Süresi Doluyor%' AND ozet LIKE $2`, [o.K.ts, `${d.dosyaNo}%`])).rows[0].n).toBe(1);
    await teklifSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE 'Firma Teklifi Süresi Doluyor%' AND ozet LIKE $2`, [o.K.ts, `${d.dosyaNo}%`])).rows[0].n).toBe(1);
    expect((await o.sup.query(`SELECT durum FROM firma_fiyat_teklifi WHERE kimlik = $1`, [ff2])).rows[0].durum).toBe('Süresi Doldu');
    expect((await o.sup.query(`SELECT durum FROM firma_fiyat_teklifi WHERE kimlik = $1`, [ff])).rows[0].durum).toBe('Gönderildi');
  });
  it('onay bekleyen değişiklik kaydı varken yeni kapsam sürümü hazırlanamaz; cetvel -MT01 numaralı (T-YG195-CETVEL)', async () => {
    const d = await hazir();
    await o.sup.query(`INSERT INTO degisiklik_protokolu (degisiklik_no, dosya_ref, tur, mevcut, onerilen, kanal, durum, hazirlayan_ref) VALUES ($1,$2,'Değişiklik','M','Ö','YATONET 360','Onay Bekliyor',$3)`, [`${d.dosyaNo}-DG99`, d.kimlik, o.K.ds]);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/cetvel`, await o.gir('tu'), { satirlar: [{ aciklama: 'İnceleme', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 5, birim: 'saat', kartela: KARTELA, olcut: 'Ölçüt' }] });
    expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('değişiklik kaydı');
    await o.sup.query(`UPDATE degisiklik_protokolu SET durum = 'Onaylandı' WHERE dosya_ref = $1`, [d.kimlik]);
    const gg = await o.ist('POST', `/api/dosya/${d.kimlik}/cetvel`, await o.gir('tu'), { satirlar: [{ aciklama: 'Genel gider payı', nitelik: 'Onarım', bedel: 'Masraf', miktar: 1, birim: 'adet', kartela: KARTELA, olcut: 'Ölçüt' }] });
    expect(gg.statusCode).toBe(400); expect(gg.json().hata).toContain('Genel gider'); // YG-182
    const bb = await o.ist('POST', `/api/dosya/${d.kimlik}/cetvel`, await o.gir('tu'), { satirlar: [{ aciklama: 'Boya', nitelik: 'Onarım', bedel: 'Malzeme', miktar: 1, birim: 'kutu', kartela: KARTELA, olcut: 'Ölçüt' }] });
    expect(bb.statusCode).toBe(400); expect(bb.json().hata).toContain('ortak ölçü birimi'); // T-YG1257-BIRIM (KS-2)
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/cetvel`, await o.gir('tu'), { satirlar: [{ aciklama: 'Boya', nitelik: 'Onarım', bedel: 'Malzeme', miktar: 1, birim: 'adet', kartela: KARTELA, olcut: 'Ölçüt', tur: 'Hayali' }] })).statusCode).toBe(400); // T-YG196-TUR
    expect((await o.ist('GET', '/api/olcu-birimleri', await o.gir('tu'))).json().map((x: { deger: string }) => x.deger)).toEqual(expect.arrayContaining(['m² × kat', 'tekne', 'nokta']));
    await cetvel(d.kimlik);
    expect((await o.sup.query(`SELECT DISTINCT cetvel_no FROM kapsam_cetveli WHERE dosya_ref = $1`, [d.kimlik])).rows).toEqual([{ cetvel_no: `${d.dosyaNo}-MT01` }]); // YG-008
  });
  it('keşifle birlikte Keşiften Teklife sayacı açılır; teklif süresi parametreden (T-YG043-SURE)', async () => {
    const { sureBaslat } = await import('../src/sure.js');
    const d = await hazir(); const bas = new Date('2031-03-05T07:00:00Z');
    await o.sup.query(`DELETE FROM dosya_sure WHERE dosya_ref = $1 AND tur IN ('Keşif', 'Keşiften Teklife', 'Teklif')`, [d.kimlik]);
    await sureBaslat(o.db, { tur: 'Keşif', oncelik: 'Normal', baslangic: bas, dosya: d.kimlik });
    const kt = (await o.sup.query(`SELECT baslangic FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Keşiften Teklife'`, [d.kimlik])).rows[0];
    expect(new Date(kt.baslangic).toISOString()).toBe(bas.toISOString());
    await o.sup.query(`UPDATE sistem_parametresi SET deger = 10 WHERE kod = 'teklif_saat_normal'`);
    await sureBaslat(o.db, { tur: 'Teklif', oncelik: 'Normal', baslangic: bas, dosya: d.kimlik });
    const tk = (await o.sup.query(`SELECT bitis FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Teklif'`, [d.kimlik])).rows[0];
    expect(new Date(tk.bitis).getTime() - bas.getTime()).toBe(10 * 3_600_000);
    await o.sup.query(`UPDATE sistem_parametresi SET deger = 72 WHERE kod = 'teklif_saat_normal'`);
  });
  it('Ara Kademesiz Dönemde GMY makamı CEO olur; yalnız CEO açar (T-YG176-AKD)', async () => {
    const rid = async (r: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [r])).rows[0].kimlik;
    expect((await o.ist('POST', '/api/ara-kademesiz-donem', await o.gir('gmy'), { acik: true, gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/ara-kademesiz-donem', await o.gir('bceo'), { acik: true, gerekce: 'GMY izinde' })).json().acik).toBe(true);
    expect((await parasalZincir(o.db, [], 'Genel Müdür Yardımcısı')).at(-1)).toBe(await rid('CEO'));
    expect((await parasalZincir(o.db, [], 'Ticari İşler Direktörü')).at(-1)).toBe(await rid('Ticari İşler Direktörü'));
    await o.ist('POST', '/api/ara-kademesiz-donem', await o.gir('bceo'), { acik: false, gerekce: 'Döndü' });
    expect((await parasalZincir(o.db, [], 'Genel Müdür Yardımcısı')).at(-1)).toBe(await rid('Genel Müdür Yardımcısı'));
  });
  it('45 gün yanıtsız teklifte Müşteri Vazgeçti – Yanıt Alınamadı kapanış görevi; 90 günden sonra yeniden açılmaz (T-YG151-YANITSIZ)', async () => {
    const d = await hazir();
    await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, statu, gonderim_zamani, gecerlilik_bitis_tarihi, hazirlayan_ref) VALUES ($1,$2,'Onarım','Yat Sahibi',20,'Süresi Doldu',now() - interval '46 days',current_date - 31,$3)`, [`${d.dosyaNo}-TK91`, d.kimlik, o.K.ts]);
    await teklifSureIsle(o.db); await teklifSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Dosya Kapanışı' AND nesne_kimligi = $1 AND baslik LIKE '%Yanıt Alınamadı'`, [d.kimlik])).rows[0].n).toBe(1);
    await o.sup.query(`UPDATE dosya SET statu = 'Kapalı', kapanma_nedeni = 'Müşteri Vazgeçti – Yanıt Alınamadı', kapanis_zamani = now() - interval '91 days' WHERE kimlik = $1`, [d.kimlik]);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/yeniden-ac`, await o.gir('ds'), { tur: 'Yeni Bilgi', gerekce: 'Müşteri döndü' });
    expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('90 gün');
  });
  it('firma fiyatı eksik kalemde teklif açılmaz', async () => {
    const d = await hazir({}, {}, [{ aciklama: 'A', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat' }, { aciklama: 'B', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat' }]);
    const kap = (await o.ist('GET', `/api/firma-portal/dosya/${d.kimlik}/kapsam`, firmaC)).json();
    const ff = (await o.ist('POST', `/api/firma-portal/dosya/${d.kimlik}/fiyat`, firmaC, { kalemler: [{ satir: kap[0].kimlik, fiyat: 10 }] })).json().kimlik;
    // YG-1599 (T-YG1599c): firma fiyatı gelişi Ticari Sorumlunun teklif görevine işlenir
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Fiyat Teklifi Hazırla' AND ozet LIKE '%Firma fiyatı geldi%' AND nesne_kimligi = (SELECT kimlik::text FROM kapsam_cetveli WHERE dosya_ref = $1 AND durum = 'Onaylı' LIMIT 1)`, [d.kimlik])).rows[0].n).toBeGreaterThan(0);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teklif`, await o.gir('ts'), { firmaTeklifi: ff });
    expect(r.statusCode).toBe(409); expect(r.json().eksik).toEqual(['S002']);
  });
  it('bant dışı kalem TİD onayı olmadan onaya gönderilemez', async () => {
    const d = await hazir(); const t = await teklifAc(d, 100); const c = await o.gir('ts');
    expect(t.bantDisi).toBe(1);
    expect((await o.ist('GET', `/api/teklif/${t.kimlik}`, c)).json().kalemler[0]).toMatchObject({ bant_alt_eur: '56.36', bant_ust_eur: '76.25' }); // YG-233
    // YG-234: firma teklifindeki maliyet aralık dışı olduğu için LGM listesinde işaretlidir; aralık içindeki teklif işaretsizdir.
    const fl = (await o.ist('GET', `/api/dosya/${d.kimlik}/teklifler`, c)).json().firma;
    expect(fl[0].aralik_disi).toBe(1);
    await firmaFiyat(d.kimlik, 51); expect((await o.ist('GET', `/api/dosya/${d.kimlik}/teklifler`, c)).json().firma[0].aralik_disi).toBe(0);
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/onaya-gonder`, c)).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/bant-onayi`, c, {})).statusCode).toBe(400);
    await o.ist('POST', `/api/teklif/${t.kimlik}/bant-onayi`, c, { gerekce: 'Özel durum' });
    await o.karar((await o.kart('Bant Dışı Onayı', t.kimlik)).kimlik, 'tid', 'Onayla');
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/onaya-gonder`, c)).statusCode).toBe(200);
  });
  it('geçici yat kaydıyla ve hasar numarası olmadan gönderilemez', async () => {
    const d = await hazir(); await o.sup.query(`UPDATE yat SET gecici_kayit = true WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    const t = await teklifAc(d); const c = await o.gir('ts');
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/onaya-gonder`, c)).json().hata).toContain('Geçici');
    const s = await hazir({ sigortaci: 'SG', hasarNo: 'H-1' }, { musteriTuru: 'Sigorta Şirketi' }); const ts = await teklifAc(s);
    await o.sup.query(`UPDATE dosya_sigorta_kaydi SET sigorta_hasar_dosya_no = NULL WHERE dosya_ref = $1`, [s.kimlik]);
    expect((await o.ist('POST', `/api/teklif/${ts.kimlik}/onaya-gonder`, c)).json().hata).toContain('hasar dosya numarası');
  });
});

describe('parasal son makam (YG-173, YG-230)', () => {
  const miktarli = (tutarEur: number): object[] => [{ aciklama: 'K', nitelik: 'Onarım', bedel: 'İşçilik', miktar: Math.round(tutarEur * 100) / 100, birim: 'saat' }];
  const kurEur = async (eur: number) => { const d = await hazir({}, {}, miktarli(eur)); const t = await teklifAc(d, 1 / 1.3); return { d, t }; };
  // 1 birim satış = (1/1.3 → 0,77) × 1,3 = 1,00
  it.each([[5000, 'Ticari İşler Direktörü'], [5000.01, 'Genel Müdür Yardımcısı'], [10000, 'Genel Müdür Yardımcısı'], [10000.01, 'CEO']])('%f EUR → %s', async (eur, makam) => {
    const { t } = await kurEur(eur as number);
    const r = await o.ist('POST', `/api/teklif/${t.kimlik}/onaya-gonder`, await o.gir('ts'));
    expect(r.json().sonMakam).toBe(makam);
  }, 60_000);
  it('aynı dosyadaki teklifler toplanır; parçalama son makamı değiştirmez', async () => {
    const d = await hazir({}, {}, miktarli(4000));
    const a = await teklifAc(d, 1 / 1.3);
    expect((await o.ist('POST', `/api/teklif/${a.kimlik}/onaya-gonder`, await o.gir('ts'))).json().sonMakam).toBe('Ticari İşler Direktörü');
    await cetvel(d.kimlik, miktarli(4000));
    const b = await teklifAc(d, 1 / 1.3, { ekTeklif: a.kimlik });
    expect((await o.ist('POST', `/api/teklif/${b.kimlik}/onaya-gonder`, await o.gir('ts'))).json()).toMatchObject({ sonMakam: 'Genel Müdür Yardımcısı', kumulatif: 8000 });
  }, 60_000);
  it('ara kademeler silsileden geçer, hazırlayan onaylayamaz, ara kademe son onay veremez', async () => {
    const d = await hazir(); const t = await teklifAc(d);
    await o.ist('POST', `/api/teklif/${t.kimlik}/onaya-gonder`, await o.gir('ts'));
    const k = await o.kart('Fiyat Teklifi', t.kimlik);
    expect(k.zincir).toHaveLength(2);
    expect((await o.karar(k.kimlik, 'ts', 'Onayla')).statusCode).toBe(403);
    expect((await o.karar(k.kimlik, 'mfm', 'Onayla')).statusCode).toBe(400);
    expect((await o.karar(k.kimlik, 'mfm', 'Onaya Gönder')).statusCode).toBe(200);
    expect((await o.karar(k.kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT statu, son_onay_makami FROM fiyat_teklifi WHERE kimlik = $1`, [t.kimlik])).rows[0]).toEqual({ statu: 'Onaylı', son_onay_makami: 'Ticari İşler Direktörü' });
  });
});

describe('indirim (YG-174)', () => {
  it('yalnız GMY ve CEO; %1–10 tam sayı; %5 üzeri CEO; toplamı düşürür', async () => {
    const d = await hazir(); const t = await teklifAc(d); const u = `/api/teklif/${t.kimlik}/indirim`; const g = await o.gir('gmy');
    expect((await o.ist('POST', u, await o.gir('tid'), { oran: 5, gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, g, { oran: 11, gerekce: 'G' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, g, { oran: 2.5, gerekce: 'G' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, g, { oran: 6, gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, g, { oran: 5 })).statusCode).toBe(400);
    expect((await o.ist('POST', u, g, { oran: 5, gerekce: 'Sadakat' })).json()).toEqual({ indirim: 33.15, genelToplam: 755.82 });
    expect((await o.ist('POST', u, ceo, { oran: 10, gerekce: 'Sadakat' })).json().indirim).toBe(66.3);
  });
  it('Ticari Sorumlu indirim talebi açar; %5 üzeri GMY görüşüyle CEO onayında uygulanır (T-YG174-TALEP)', async () => {
    const d = await hazir(); const t = await teklifAc(d); const u = `/api/teklif/${t.kimlik}/indirim-talebi`;
    expect((await o.ist('POST', u, await o.gir('gmy'), { oran: 7, gerekce: 'G' })).statusCode).toBe(403);
    const r = await o.ist('POST', u, await o.gir('ts'), { oran: 7, gerekce: 'Uzun süreli müşteri' }); expect(r.statusCode, r.body).toBe(200); expect(r.json().makam).toBe('CEO');
    expect((await o.ist('POST', u, await o.gir('ts'), { oran: 3, gerekce: 'G' })).statusCode).toBe(409);
    const k = await o.kart('İndirim Talebi', t.kimlik);
    expect((await o.karar(k.kimlik, 'gmy', 'Onaya Gönder', 'Uygun')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT indirim_orani FROM fiyat_teklifi WHERE kimlik = $1`, [t.kimlik])).rows[0].indirim_orani).toBeNull();
    expect((await o.karar(k.kimlik, 'bceo', 'Onayla')).statusCode).toBe(200);
    expect(Number((await o.sup.query(`SELECT indirim_orani FROM fiyat_teklifi WHERE kimlik = $1`, [t.kimlik])).rows[0].indirim_orani)).toBe(7);
  });
});

describe('bireysel onay ve cayma (YG-152, YG-466, YG-468)', () => {
  const gonder = async () => {
    const d = await hazir(); const t = await teklifAc(d); await onayla(t.kimlik);
    const r = await o.ist('POST', `/api/teklif/${t.kimlik}/gonder`, await o.gir('ts'));
    expect(r.statusCode, r.body).toBe(200);
    const on = (await o.sup.query(`SELECT kimlik FROM onay_talebi WHERE nesne_kimligi = $1 AND ony_kod = 'ONY-23'`, [t.kimlik])).rows[0];
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`onay-bag:${on.kimlik}`])).rows[0].metin;
    return { d, t, r: r.json(), belirtec: m.match(/#onay=([\w-]+)/)[1] as string };
  };
  const kararVer = async (bel: string, kutular: Record<string, boolean>) => {
    await o.ist('POST', `/api/onay/${bel}/kod`, undefined, { kanal: 'SMS' });
    const kod = o.sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0];
    return o.ist('POST', `/api/onay/${bel}/karar`, undefined, { kod, kutular });
  };
  it('ek fiyat teklifi ONY-25 ile gider; önceki ve yeni toplam yazılır; onayı ana teklif gibi işlenir', async () => {
    const g = await gonder(); const k0 = (await o.ist('GET', `/api/onay/${g.belirtec}`)).json().kutular?.[0]; const a0 = k0?.ad ?? k0;
    { const kr = await kararVer(g.belirtec, { [a0]: true }); expect(kr.statusCode, kr.body).toBe(200); }
    await cetvel(g.d.kimlik);
    const e = await teklifAc(g.d, 51, { ekTeklif: g.t.kimlik }); await onayla(e.kimlik);
    const r = await o.ist('POST', `/api/teklif/${e.kimlik}/gonder`, await o.gir('ts')); expect(r.statusCode, r.body).toBe(200);
    const on = (await o.sup.query(`SELECT kimlik, metin FROM onay_talebi WHERE nesne_kimligi = $1 AND ony_kod = 'ONY-25'`, [e.kimlik])).rows[0];
    expect(on.metin).toContain('önceki onaylı toplam'); expect(on.metin).not.toContain('[');
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`onay-bag:${on.kimlik}`])).rows[0].metin; const bel = m.match(/#onay=([\w-]+)/)![1]!;
    const ek = (await o.ist('GET', `/api/onay/${bel}`)).json(); const ilk = ek.kutular?.[0]?.ad ?? ek.kutular?.[0];
    expect(String(ilk)).not.toContain('[');
    expect((await kararVer(bel, { [ilk]: true })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT karar FROM fiyat_teklifi WHERE kimlik = $1`, [e.kimlik])).rows[0].karar).toBe('Tam Onay');
  });
  it('geçerlilik 15 gün; ekran iki kutu, biri zorunlu, ikisi de işaretsiz; tutar KDV dahil; hatırlatma var', async () => {
    const g = await gonder();
    const bek = new Date(Date.now() + 180 * 60_000 + 15 * 86_400_000).toISOString().slice(0, 10);
    expect(g.r.gecerlilik).toBe(bek);
    const e = (await o.ist('GET', `/api/onay/${g.belirtec}`)).json();
    expect(e.kutular).toHaveLength(2); expect(e.kutular[0].zorunlu).toBe(true); expect(e.kutular[1].zorunlu).toBe(false);
    expect(e.metin).toContain('795,60 EUR KDV dahil'); expect(e.metin).not.toContain('Kutu 1'); expect(e.metin).toContain('tekne sigortası');
    expect(e.baslik).toBe(`${g.d.dosyaNo} · Fiyat Teklifi ve Sözleşme Onayı`);
  });
  it('kutu işaretlenmeden onay olmaz; erken ifa yoksa cayma süresince iş emri engellenir; süre bitince açılır', async () => {
    const g = await gonder(); const e = (await o.ist('GET', `/api/onay/${g.belirtec}`)).json();
    expect((await kararVer(g.belirtec, {})).statusCode).toBe(400);
    await o.sup.query(`UPDATE onay_talebi SET kod_gonderim = NULL WHERE dosya_ref = $1`, [g.d.kimlik]);
    const r = await kararVer(g.belirtec, { [e.kutular[0].ad]: true });
    expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT asama FROM dosya WHERE kimlik = $1`, [g.d.kimlik])).rows[0].asama).toBe('Uygulama');
    const c = (await o.sup.query(`SELECT erken_ifa_onayi, cayma_bitis, sozlesme_zamani FROM on_bilgilendirme_cayma_kaydi WHERE teklif_ref = $1`, [g.t.kimlik])).rows[0];
    expect(c.erken_ifa_onayi).toBe(false); expect((+c.cayma_bitis - +c.sozlesme_zamani) / 86_400_000).toBe(14);
    const ie = (x: object = {}) => o.gir('oy').then((k) => o.ist('POST', `/api/dosya/${g.d.kimlik}/is-emri`, k, { tur: 'ON', teknikSonuc: 'S', firma, yer: 'M', kapsam: 'K', teklif: g.t.kimlik, bedel: 510, ...x }));
    const eng = await ie();
    expect(eng.statusCode).toBe(409); expect(eng.json().hata).toContain('yasal bekleme');
    expect(await caymaEngeli(o.db, g.d.kimlik, new Date(Date.now() + 15 * 86_400_000))).toBeNull();
    await o.sup.query(`UPDATE on_bilgilendirme_cayma_kaydi SET cayma_bitis = now() - interval '1 minute' WHERE teklif_ref = $1`, [g.t.kimlik]);
    expect((await ie()).statusCode).toBe(200);
  });
  it('teknik pay ve ölçülemeyen değer ayrı; seçilmeyen alternatif iş emrinde görünür (YG196-PAY)', async () => {
    const tu = await o.gir('tu'); const d0 = await o.dosyaAc(); await o.ekipKur(d0.kimlik);
    expect((await o.ist('POST', `/api/dosya/${d0.kimlik}/cetvel`, tu, { satirlar: [{ aciklama: 'A', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat', olcut: 'Ö', teknikPay: -1 }] })).statusCode).toBe(400);
    const d = await hazir({}, {}, [{ aciklama: 'İnceleme', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 10, birim: 'saat', kartela: KARTELA, teknikPay: 1.5, olculemez: true }, { aciklama: 'Alternatif İnceleme', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 2, birim: 'saat', kartela: KARTELA, tur: 'Alternatif' }]);
    const t = await teklifAc(d); await onayla(t.kimlik);
    expect((await o.sup.query(`SELECT olculemez, opsiyon FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [t.kimlik])).rows).toEqual([{ olculemez: true, opsiyon: false }, { olculemez: false, opsiyon: true }]);
    expect((await o.sup.query(`SELECT f.ara_toplam_eur = k.tutar_eur esit FROM fiyat_teklifi f JOIN fiyat_teklifi_kalemi k ON k.teklif_ref = f.kimlik AND k.sira_no = 1 WHERE f.kimlik = $1`, [t.kimlik])).rows[0].esit).toBe(true); // YG196-ARA: alternatif ana toplama girmez
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/gonder`, await o.gir('ts'))).statusCode).toBe(200);
    const on = (await o.sup.query(`SELECT kimlik FROM onay_talebi WHERE nesne_kimligi = $1 AND ony_kod = 'ONY-23'`, [t.kimlik])).rows[0];
    const bel = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`onay-bag:${on.kimlik}`])).rows[0].metin.match(/#onay=([\w-]+)/)[1];
    const e = (await o.ist('GET', `/api/onay/${bel}`)).json();
    expect((await kararVer(bel, { [e.kutular[0].ad]: true, [e.kutular[1].ad]: true })).statusCode).toBe(200);
    const ie = await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('oy'), { tur: 'ON', teknikSonuc: 'S', firma, yer: 'M', kapsam: 'K', teklif: t.kimlik, bedel: 510 }); expect(ie.statusCode, ie.body).toBe(200);
    expect((await o.sup.query(`SELECT secilmeyen_kalemler FROM is_emri WHERE kimlik = $1`, [ie.json().kimlik])).rows[0].secilmeyen_kalemler).toBe('2. Alternatif İnceleme (Alternatif)');
    expect((await o.sup.query(`SELECT aciklama, teknik_pay::float tp, olculemez FROM is_emri_kalemi WHERE is_emri_ref = $1`, [ie.json().kimlik])).rows).toEqual([{ aciklama: 'İnceleme', tp: 1.5, olculemez: true }]);
    const { miktarYaz } = await import('../src/belge_uret.js');
    expect(miktarYaz({ miktar: 10, birim: 'saat', olculemez: true, teknik_pay: 1.5 }, 'tr')).toBe('10,00 saat (tahmini) + teknik pay 1,50');
  });
  it('erken ifa kutusu işaretliyse iş emri açılır; cayma kaydedilince engellenir', async () => {
    const g = await gonder(); const e = (await o.ist('GET', `/api/onay/${g.belirtec}`)).json();
    expect((await kararVer(g.belirtec, { [e.kutular[0].ad]: true, [e.kutular[1].ad]: true })).statusCode).toBe(200);
    expect(await caymaEngeli(o.db, g.d.kimlik)).toBeNull();
    expect((await o.ist('POST', `/api/teklif/${g.t.kimlik}/cayma`, await o.gir('ds'))).statusCode).toBe(200);
    expect(await caymaEngeli(o.db, g.d.kimlik)).toContain('cayma');
  });
  it('lehtar muvafakati yoksa gönderilemez; süre dolunca Süresi Doldu olur', async () => {
    const d = await hazir(); await o.sup.query(`UPDATE yat SET lehtar_adi = 'Banka' WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    const t = await teklifAc(d); await onayla(t.kimlik);
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/gonder`, await o.gir('ts'))).json().hata).toContain('muvafakati');
    const g = await gonder();
    await o.sup.query(`UPDATE fiyat_teklifi SET gecerlilik_bitis_tarihi = current_date - 1 WHERE kimlik = $1`, [g.t.kimlik]);
    expect(await teklifSureIsle(o.db)).toBeGreaterThan(0);
    expect((await o.sup.query(`SELECT statu FROM fiyat_teklifi WHERE kimlik = $1`, [g.t.kimlik])).rows[0].statu).toBe('Süresi Doldu');
  });
  it('revizyon yeni sürüm açar, önceki Yerine Geçti, bekleyen onay düşer', async () => {
    const g = await gonder(); const c = await o.gir('ts');
    expect((await o.ist('POST', `/api/teklif/${g.t.kimlik}/revizyon`, c, { neden: 'Tutar değişti' })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/teklif/${g.t.kimlik}/revizyon`, c, { neden: 'Kapsam değişti' });
    expect(r.json().surum).toBe(2);
    expect((await o.sup.query(`SELECT statu FROM fiyat_teklifi WHERE kimlik = $1`, [g.t.kimlik])).rows[0].statu).toBe('Yerine Geçti');
    expect((await o.ist('GET', `/api/onay/${g.belirtec}`)).json().durum).toBe('İptal');
  });
});

describe('sigorta kararı (YG-205, YG-218, YG-1464)', () => {
  const gonder = async (eposta?: string) => {
    const d = await hazir({ sigortaci: 'SG', hasarNo: 'H1', yetkiDurumu: 'Doğrulandı' }, { musteriTuru: 'Sigorta Şirketi' }, [{ aciklama: 'A', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat' }, { aciklama: 'B', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat' }]);
    const t = await teklifAc(d, 100); await onayla(t.kimlik);
    const gn = await o.ist('POST', `/api/teklif/${t.kimlik}/gonder`, await o.gir('ts')); expect(gn.json().durum, gn.body).toBe('Teyit Bekliyor');
    if (eposta) await o.sup.query(`UPDATE sigorta_gonderim SET alici = $2 WHERE kimlik = $1`, [gn.json().gonderim, eposta]);
    expect((await o.sup.query(`SELECT statu FROM fiyat_teklifi WHERE kimlik = $1`, [t.kimlik])).rows[0].statu).toBe('Onaylı');
    await o.ist('POST', `/api/sigorta-gonderim/${gn.json().gonderim}/teyit`, await o.gir('ts'), { adim: 1 });
    expect((await o.ist('POST', `/api/sigorta-gonderim/${gn.json().gonderim}/teyit`, await o.gir('ts'), { adim: 2 })).json().durum).toBe('Gönderildi');
    return { d, t, gn: gn.json().gonderim as string };
  };
  it('e-posta da portal kullanıcısı da yoksa teklif hazırlanmaz; Dosya Sorumlusu adresi girer; teyit ekranı ekleri ve önizlemeyi gösterir', async () => {
    const d = await hazir({ sigortaci: 'Adressiz Sigorta', hasarNo: 'H9', yetkiDurumu: 'Doğrulandı' }, { musteriTuru: 'Sigorta Şirketi' }, [{ aciklama: 'A', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat' }]);
    { const ff = await firmaFiyat(d.kimlik, 100); const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teklif`, await o.gir('ts'), { firmaTeklifi: ff }); expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('e-posta adresi bekleniyor'); } // YG-1729: hazırlamada engel
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/sigorta-eposta`, await o.gir('ty'), { eposta: 'x@y.local' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/sigorta-eposta`, await o.gir('ds'), { eposta: 'gecersiz' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/sigorta-eposta`, await o.gir('ds'), { eposta: 'hasar@adressiz.local' })).statusCode).toBe(200);
    const t = await teklifAc(d, 100); await onayla(t.kimlik);
    const u = `/api/teklif/${t.kimlik}/gonder`;
    const gn = await o.ist('POST', u, await o.gir('ts')); expect(gn.json().durum, gn.body).toBe('Teyit Bekliyor');
    const id = gn.json().gonderim as string;
    expect((await o.sup.query(`SELECT alici FROM sigorta_gonderim WHERE kimlik = $1`, [id])).rows[0].alici).toBe('hasar@adressiz.local');
    const on = await o.ist('GET', `/api/sigorta-gonderim/${id}/onizleme`, await o.gir('ts')); expect(on.statusCode, on.body.slice(0, 200)).toBe(200); expect(on.headers['content-type']).toContain('pdf');
    const l = (await o.ist('GET', `/api/sigorta-gonderim?dosya=${d.kimlik}`, await o.gir('ts'))).json(); expect(l[0].ekler[0]).toContain('Fiyat Teklifi'); expect(l[0].onizleme).toBe(true);
    await o.ist('POST', `/api/sigorta-gonderim/${id}/teyit`, await o.gir('ts'), { adim: 1 });
    await o.ist('POST', `/api/dosya/${d.kimlik}/sigorta-eposta`, await o.gir('ds'), { eposta: 'yeni@adressiz.local' });
    const s = (await o.sup.query(`SELECT alici, durum FROM sigorta_gonderim WHERE kimlik = $1`, [id])).rows[0]; expect(s).toMatchObject({ alici: 'yeni@adressiz.local', durum: 'Teyit Bekliyor' });
  });
  it('ikinci teyitten sonra BLD-71 teklif PDF ekiyle kuyruğa girer; PDF üretilmeden gitmez', async () => {
    const { t, gn } = await gonder('hasar@sigorta.deneme.local'); const olay = `sigorta:${gn}`;
    const satir = () => o.sup.query(`SELECT cardinality(ek_surumler) n FROM gonderim WHERE olay_anahtari = $1`, [olay]);
    expect((await satir()).rowCount).toBe(0);
    await belgeKuyruguIsle({ db: o.db, webAdresi: 'http://x', depo: new Depo(mkdtempSync(join(tmpdir(), 'bt'))), eposta: o.posta, sms: o.sms } as never, 200);
    expect((await o.sup.query(`SELECT durum, son_hata FROM belge_uretim WHERE tur = 'Fiyat Teklifi' AND nesne = $1`, [t.kimlik])).rows[0]).toMatchObject({ durum: 'Üretildi', son_hata: null });
    expect((await satir()).rows[0].n).toBeGreaterThanOrEqual(1);
  }, 120_000); // kuyrukta önceki testlerin PDF'leri de üretilir
  it('yat sahibinden onay istenmez, BLD-37 eş zamanlı gider; telefon kanalı geçersiz', async () => {
    const { d, t } = await gonder();
    expect((await o.sup.query(`SELECT 1 FROM onay_talebi WHERE nesne_kimligi = $1`, [t.kimlik])).rowCount).toBe(0);
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari = $1`, [`bld37:${t.kimlik}`])).rowCount).toBeGreaterThan(0);
    const c = await o.gir('ds');
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, c, { karar: 'Tam Onay', kanal: 'Telefon', yetkili: 'Y' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, c, { karar: 'Tam Onay', kanal: 'KEP', yetkili: 'Y' })).statusCode).toBe(400);
    void d;
  });
  it('cetvel onayında Fiyat Teklifi Hazırla görevi açılır (T-YG1599b)', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const cv = await cetvel(d.kimlik);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Fiyat Teklifi Hazırla' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [cv])).rows[0].n).toBe(1);
  });
  it('tam onay dosyayı Uygulama aşamasına alır, BLD-38 gider', async () => {
    const { d, t } = await gonder();
    // YG-455 (T-YG455): geliş zamanından 8 saat sonra kayıtta gecikme gerekçesi zorunlu
    const ob = await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`); const gelis = new Date(Date.now() - 10 * 3_600_000).toISOString();
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Tam Onay', kanal: 'KEP', belge: ob, yetkili: 'Y', gelis })).statusCode).toBe(409);
    const r = await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Tam Onay', kanal: 'KEP', belge: ob, yetkili: 'Y', gelis, gecikmeGerekcesi: 'Resmî tatil' });
    expect(r.json()).toMatchObject({ durum: 'Tam Onay', onaylananTutar: 260 });
    expect((await o.sup.query(`SELECT kayit_gecikme_gerekcesi g, gelis_zamani IS NOT NULL z FROM sigorta_onayi WHERE teklif_ref = $1`, [t.kimlik])).rows[0]).toEqual({ g: 'Resmî tatil', z: true });
    expect((await o.sup.query(`SELECT asama FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].asama).toBe('Uygulama');
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari = $1`, [`bld38:${t.kimlik}`])).rowCount).toBeGreaterThan(0);
  });
  it('karar sözlükten; Sınırlı Yetki teklifi bekletir; Koşullu Onay şart doğrulanınca Uygulama ve BLD-38 (YG-154)', async () => {
    const { d, t } = await gonder(); const c = await o.gir('ds'); const u = `/api/teklif/${t.kimlik}/sigorta-karar`;
    const ob = await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`);
    expect((await o.ist('POST', u, c, { karar: 'Beklemede', kanal: 'KEP', belge: ob, yetkili: 'Y' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, c, { karar: 'Sınırlı Yetki', kanal: 'KEP', belge: ob, yetkili: 'Y', onaylananSiralar: [1] })).statusCode).toBe(400);
    const s = await o.ist('POST', u, c, { karar: 'Sınırlı Yetki', kanal: 'KEP', belge: ob, yetkili: 'Y', onaylananSiralar: [1], sart: 'Yalnız su tahliyesi ve örtü' }); expect(s.statusCode, s.body).toBe(200);
    expect(s.json()).toMatchObject({ durum: 'Sınırlı Yetki', onaylananTutar: 130 });
    expect((await o.sup.query(`SELECT statu FROM fiyat_teklifi WHERE kimlik = $1`, [t.kimlik])).rows[0].statu).toBe('Gönderildi');
    expect((await o.sup.query(`SELECT asama FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].asama).not.toBe('Uygulama');
    expect(await o.kart('Sınırlı Yetki', t.kimlik)).toBeDefined();
    expect((await o.ist('POST', u, c, { karar: 'Koşullu Onay', kanal: 'KEP', belge: ob, yetkili: 'Y' })).statusCode).toBe(400);
    const k = await o.ist('POST', u, c, { karar: 'Koşullu Onay', kanal: 'KEP', belge: ob, yetkili: 'Y', sart: 'Eksper ikinci keşfi' }); expect(k.statusCode, k.body).toBe(200);
    expect((await o.sup.query(`SELECT asama FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].asama).not.toBe('Uygulama');
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari = $1`, [`bld38:${t.kimlik}`])).rowCount).toBe(0);
    expect(await o.kart('Koşullu Onay Şartı', t.kimlik)).toBeDefined();
    expect((await o.sup.query(`SELECT eski_statu, yeni_statu, karar FROM teklif_statu_gecmisi WHERE teklif_ref = $1 ORDER BY kimlik DESC LIMIT 1`, [t.kimlik])).rows[0]).toEqual({ eski_statu: 'Gönderildi', yeni_statu: 'Karar', karar: 'Koşullu Onay' }); // YG-227
    expect((await o.ist('GET', `/api/teklif/${t.kimlik}/eksper-karsilastirma`, c)).json().kosullar.map((x: { karar: string }) => x.karar)).toEqual(['Sınırlı Yetki', 'Koşullu Onay']);
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/sart-dogrula`, await o.gir('oy'), { belge: ob })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/sart-dogrula`, c, {})).statusCode).toBe(400);
    const v = await o.ist('POST', `/api/teklif/${t.kimlik}/sart-dogrula`, c, { belge: await o.belge(d.kimlik, 'ds', `Şart ${Math.random()}`) }); expect(v.statusCode, v.body).toBe(200);
    expect((await o.sup.query(`SELECT asama FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].asama).toBe('Uygulama');
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari = $1`, [`bld38:${t.kimlik}`])).rowCount).toBeGreaterThan(0);
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/sart-dogrula`, c, { belge: ob })).statusCode).toBe(409);
    // YG-160: sigorta kararları Bedel Kabulü onay kaydı olarak listelenir; tür süzgeci sözlük dışını reddeder.
    const ok = await o.ist('GET', `/api/dosya/${d.kimlik}/onay-kayitlari?tur=${encodeURIComponent('Bedel Kabulü')}`, c); expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().kayitlar.map((x: { sonuc: string }) => x.sonuc).sort()).toEqual(['Koşullu Onay', 'Sınırlı Yetki']);
    expect(ok.json().turler).toEqual(['Talimat', 'Teknik Onay', 'Bedel Kabulü', 'Değişiklik Onayı', 'Teslim Kabulü']);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/onay-kayitlari`, c)).json().kayitlar.some((x: { tur: string }) => x.tur === 'Teknik Onay')).toBe(true);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/onay-kayitlari?tur=Beklemede`, c)).statusCode).toBe(400);
  });
  it('kısmi onayda kalem silinmez, işaretlenir; iş emrine yalnız onaylılar geçer; onaylanmayanlar için görev açılır', async () => {
    const { d, t } = await gonder();
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Kısmi Onay', kanal: 'KEP', belge: await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`), yetkili: 'Y' })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Kısmi Onay', kanal: 'KEP', belge: await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`), yetkili: 'Y', onaylananSiralar: [1] });
    expect(r.json().onaylananTutar).toBe(130);
    expect((await o.sup.query(`SELECT onay_durumu FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [t.kimlik])).rows.map((x) => x.onay_durumu)).toEqual(['Onaylandı', 'Onaylanmadı']);
    expect(await o.kart('Fiyat Teklifi Hazırla', t.kimlik)).toBeDefined();
    { // YG-324: geçerlilikten sonra verilmiş onayla iş emri açılmaz
      const eski = (await o.sup.query(`SELECT karar_zamani FROM fiyat_teklifi WHERE kimlik = $1`, [t.kimlik])).rows[0].karar_zamani;
      await o.sup.query(`UPDATE fiyat_teklifi SET karar_zamani = gecerlilik_bitis_tarihi + interval '2 days' WHERE kimlik = $1`, [t.kimlik]);
      const r0 = await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('oy'), { tur: 'ON', teknikSonuc: 'S', firma, yer: 'M', kapsam: 'K', teklif: t.kimlik, bedel: 100 });
      expect(r0.statusCode).toBe(409); expect(r0.json().hata).toContain('Süre Dolumu Kabulü');
      await o.sup.query(`UPDATE fiyat_teklifi SET karar_zamani = $2 WHERE kimlik = $1`, [t.kimlik, eski]);
    }
    const ie = await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('oy'), { tur: 'ON', teknikSonuc: 'S', firma, yer: 'M', kapsam: 'K', teklif: t.kimlik, bedel: 100 });
    expect(ie.statusCode, ie.body).toBe(200);
    expect((await o.sup.query(`SELECT aciklama FROM is_emri_kalemi WHERE is_emri_ref = $1`, [ie.json().kimlik])).rows.map((x) => x.aciklama)).toEqual(['A']);
    const so = (await o.sup.query(`SELECT u.kimlik, s.kimlik AS s FROM belge_uretim u JOIN sigorta_onayi s ON s.kimlik = u.nesne::uuid WHERE u.tur = 'Sigorta Onay Belgesi' AND s.teklif_ref = $1`, [t.kimlik])).rows; expect(so.length).toBe(1); // YG-1569
    const { sigortaOnayTanim } = await import('../src/belge_uret.js'); const v = await sigortaOnayTanim(o.db, so[0].s, 'KOD1', 'http://x'); const j = JSON.stringify(v.t);
    expect(v.t.no).toMatch(/-SO\d{2}$/); expect(j).toContain('Onaylanan Kalemler'); expect(j).toContain('Onaylanmayan Kalemler'); expect(j).not.toMatch(/teminat/i);
  });
});

describe('tesis bedeli Masraf kalemi (MSR-1, KRT-10)', () => {
  it('tesis bedeli kalemi kartelada yok; Masraf belgeyle gerçek tutarından eklenir, katsayı uygulanmaz; yalnız taslakta ve hazırlayandan', async () => {
    expect((await o.sup.query(`SELECT count(*)::int n FROM kartela_kalemi WHERE kod = 'LOJISTIK-01.01.04-01'`)).rows[0].n).toBe(0);
    expect((await o.sup.query(`SELECT birim, maliyet_eur FROM kartela_kalemi WHERE kod = 'KESIF-01.04.03-03'`)).rows[0]).toEqual({ birim: 'saat', maliyet_eur: '45.00' });
    const d = await hazir(); const t = await teklifAc(d); const u = `/api/teklif/${t.kimlik}/masraf-kalemi`; const c = await o.gir('ts'); const belge = await o.belge(d.kimlik, 'ds');
    const once = (await o.sup.query(`SELECT ara_toplam_eur a FROM fiyat_teklifi WHERE kimlik = $1`, [t.kimlik])).rows[0].a;
    expect((await o.ist('POST', u, await o.gir('ds'), { aciklama: 'Travel lift', tutar: 500, belge })).statusCode).toBe(403);
    expect((await o.ist('POST', u, c, { aciklama: 'Travel lift', tutar: 500 })).statusCode).toBe(400);
    expect((await o.ist('POST', u, c, { aciklama: 'Travel lift', tutar: 500, belge })).json().hata).toMatch(/niteliğini/); // YG-179
    expect((await o.ist('POST', u, c, { aciklama: 'Uzman yolculuğu', nitelik: 'Onarım', tutar: 120, belge, seyahat: { km: 620, arac: 'Karayolu' } })).json().hata).toContain('Uçak (Ekonomi)'); // YG-237
    expect((await o.ist('POST', u, c, { aciklama: 'Uzman yolculuğu', nitelik: 'Onarım', tutar: 80, belge, seyahat: { km: 300, arac: 'Uçak (Ekonomi)' } })).json().hata).toContain('Karayolu');
    const r = await o.ist('POST', u, c, { aciklama: 'Travel lift', nitelik: 'Bakım', tutar: 500, belge });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().araToplam).toBe(Number(once) + 500);
    const k = (await o.sup.query(`SELECT bedel_turu, birim_satis_fiyati_eur, tutar_eur, kartela_kodu FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND sira_no = $2`, [t.kimlik, r.json().sira])).rows[0];
    expect(k).toEqual({ bedel_turu: 'Masraf', birim_satis_fiyati_eur: '500.00', tutar_eur: '500.00', kartela_kodu: null });
    await onayla(t.kimlik);
    expect((await o.ist('POST', u, c, { aciklama: 'Ek', tutar: 10, belge })).statusCode).toBe(409);
  });
});

describe('görsel kanıtın iş kalemi bağı (YG-381)', () => {
  it('fotoğraf teklif kalemine bağlanır; aynı görsel başka kalemde kanıt olamaz (YG381-KALEM)', async () => {
    const d = await hazir(); const t = await teklifAc(d); const c = await o.gir('ds');
    const k1 = (await o.sup.query(`SELECT kimlik FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no LIMIT 1`, [t.kimlik])).rows[0].kimlik;
    const k2 = (await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi SELECT (jsonb_populate_record(NULL::fiyat_teklifi_kalemi, to_jsonb(k) || jsonb_build_object('kimlik', gen_random_uuid(), 'sira_no', k.sira_no + 100))).* FROM fiyat_teklifi_kalemi k WHERE kimlik = $1 RETURNING kimlik`, [k1])).rows[0].kimlik;
    const liste = (await o.ist('GET', `/api/dosya/${d.kimlik}/is-kalemleri`, c)).json(); expect(liste.map((x: { kimlik: string }) => x.kimlik)).toEqual(expect.arrayContaining([k1, k2]));
    const bel = await o.belge(d.kimlik, 'ds', `Foto ${Math.random()}`);
    const g = (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/gorsel`, c, { asama: 'Keşif', kalem: 'Genel – Baş', belge: bel, ...x });
    expect((await g({ isKalemi: '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(400);
    const r = await g({ isKalemi: k1 }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT is_kalemi_ref FROM gorsel_kanit WHERE gorsel_no = $1`, [r.json().gorselNo])).rows[0].is_kalemi_ref).toBe(k1);
    expect((await g({ isKalemi: k1 })).statusCode).toBe(200);
    expect((await g({ isKalemi: k2 })).json().hata).toMatch(/başka bir iş kaleminin/);
  });
});

describe('iş emri ve firma portalı (YG-291, YG-294, YG-314, YG-325, YG-386)', () => {
  const onarim = async (bedel = 510) => {
    const d = await hazir({ sigortaci: 'SG', hasarNo: 'H1' }, { musteriTuru: 'Sigorta Şirketi' }); const t = await teklifAc(d); await onayla(t.kimlik);
    const gn = (await o.ist('POST', `/api/teklif/${t.kimlik}/gonder`, await o.gir('ts'))).json().gonderim;
    await o.ist('POST', `/api/sigorta-gonderim/${gn}/teyit`, await o.gir('ts'), { adim: 1 }); await o.ist('POST', `/api/sigorta-gonderim/${gn}/teyit`, await o.gir('ts'), { adim: 2 });
    await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Tam Onay', kanal: 'KEP', belge: await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`), yetkili: 'Y' });
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('oy'), { tur: 'ON', teknikSonuc: 'S', firma, yer: 'Marmaris', kapsam: 'Onarım', teklif: t.kimlik, bedel, tehlikeliAtik: true, atikSorumlusu: 'Firma Çevre Sorumlusu' });
    expect(r.statusCode, r.body).toBe(200);
    const k = await o.kart('İş Emri', r.json().kimlik);
    if (k.zincir.length > 1) await o.karar(k.kimlik, 'opm', 'Onaya Gönder');
    expect((await o.karar(k.kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    return { d, t, e: r.json() };
  };
  it('atık sorumlusu kaydolur; aynı branşta geçmişin en az yarısında tehlikeli atık varsa öneri gelir (YG330-ATIK)', async () => {
    const { d, e } = await onarim(); const br = `Atık ${Math.random()}`;
    await o.sup.query(`UPDATE is_emri SET ana_brans = $2 WHERE kimlik = $1`, [e.kimlik, br]);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/atik-onerisi?brans=${encodeURIComponent(br)}`, await o.gir('oy'))).json()).toEqual({ oneri: true, toplam: 1, tehlikeli: 1 });
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/atik-onerisi?brans=Yok`, await o.gir('oy'))).json().oneri).toBe(false);
    expect((await o.sup.query(`SELECT atik_sorumlusu FROM is_emri WHERE kimlik = $1`, [e.kimlik])).rows[0].atik_sorumlusu).toBe('Firma Çevre Sorumlusu');
  });
  it('EK iş emri zarf sapmasına bağlanınca görev kapanır ve sapma listeden düşer (YG-407)', async () => {
    const { d, t, e } = await onarim();
    const bg = (await o.sup.query(`INSERT INTO bulgu (bulgu_no, dosya_ref, konum_referansi, aciklama, bulgu_etiketi, bilgi_turu, hasar_onem_derecesi, yonlendirme, yonlendirme_sorumlu_ref, yonlendirme_hedef_tarihi, olusturan_ref) VALUES ($1,$2,'S1','Gizli','E','B','Orta','Y',$3,current_date,$3) RETURNING kimlik`, [`${d.dosyaNo}-B09`, d.kimlik, o.K.tu])).rows[0].kimlik;
    const s = (await o.sup.query(`INSERT INTO sapma_kaydi (is_emri_ref, dosya_ref, tur, aciklama, karar, giren_ref, zarf_genisledi, bulgu_ref) VALUES ($1,$2,'Kapsam','Z','Değişiklik Talebi',$3,true,$4) RETURNING kimlik`, [e.kimlik, d.kimlik, o.K.tu, bg])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, ozet, sahip_kullanici_ref, nesne_turu, nesne_kimligi) VALUES ('Ek İş İş Emri Gerekli','gorev','b','o',$1,'Sapma',$2)`, [o.K.oy, s]);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/teklifler`, await o.gir('ds'))).json().zarfSapmalari).toHaveLength(1);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('oy'), { tur: 'EK', teknikSonuc: 'S', ana: e.kimlik, firma, yer: 'M', kapsam: 'Ek', teklif: t.kimlik, bedel: 10, sapma: s }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT ek_is_emri_ref r FROM sapma_kaydi WHERE kimlik = $1`, [s])).rows[0].r).toBe(r.json().kimlik);
    expect((await o.kart('Ek İş İş Emri Gerekli', s)).durum).toBe('Tamamlandı');
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/teklifler`, await o.gir('ds'))).json().zarfSapmalari).toHaveLength(0);
  });
  it('numara ve tür; yetki; onaysız teklif, firma uygunsuzluğu ve mali limit boş iş emri reddedilir', async () => {
    const d = await hazir(); const t = await teklifAc(d); const oy = await o.gir('oy');
    expect((await o.sup.query(`SELECT is_emri_no FROM is_emri WHERE dosya_ref = $1`, [d.kimlik])).rows[0].is_emri_no).toBe(`${d.dosyaNo}-KN01`);
    const p = (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, oy, { tur: 'ON', teknikSonuc: 'S', firma, yer: 'M', kapsam: 'K', teklif: t.kimlik, bedel: 10, ...x });
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('ds'), { tur: 'ON' })).statusCode).toBe(403);
    expect((await p({ baslangic: '2026-12-10', bitis: '2026-12-01' })).json().hata).toContain('başlangıç tarihinden sonra'); // YG-1253
    expect((await p({})).json().hata).toContain('Onaylanmış teklif');
    expect((await p({ tur: 'EK' })).json().hata).toContain('ana iş emrine');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('ty'), { tur: 'KN' })).statusCode).toBe(403);
  });
  it('askıdaki veya belgesi dolmuş firma seçilemez', async () => {
    const f = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: `Başka ${Math.random()}`, rol: 'Çözüm Ortağı' })).json().kimlik;
    expect(await firmaUygunlugu(o.db, f)).toContain('onaylı değildir');
    await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('fym'), { asama: 'İncelemede', gerekce: 'Belge doğrulaması' }); await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('fym'), { asama: 'Onaylı', ag: 'Aktif', gerekce: 'G' });
    expect(await firmaUygunlugu(o.db, f)).toBeNull();
    await o.ist('POST', `/api/firma/${f}/belge`, await o.gir('sc'), { tur: 'Vergi Levhası', bitis: '2020-01-01' });
    expect(await firmaUygunlugu(o.db, f)).toContain('Vergi Levhası');
    expect(await firmaUygunlugu(o.db, firma, 'Olmayan Branş')).toContain('branşta');
    // YG-303 (T-YG303): Bölge kapsamlı yetki başka bölgedeki dosyaya geçmez; Ulusal kapsam geçer
    await o.sup.query(`INSERT INTO brans_yetkinligi (kurulus_ref, ana_brans, kapsama, bolge, yetkinlik_seviyesi) VALUES ($1,'Bölge Deneme','Bölge','Ege','Y2')`, [f]);
    await o.ist('POST', `/api/firma/${f}/belge`, await o.gir('sc'), { tur: 'Vergi Levhası', bitis: '2030-01-01' }); await o.sup.query(`DELETE FROM sicil_belgesi WHERE kurulus_ref = $1 AND gecerlilik_bitis < current_date`, [f]);
    expect(await firmaUygunlugu(o.db, f, 'Bölge Deneme', 'Ege')).toBeNull();
    expect(await firmaUygunlugu(o.db, f, 'Bölge Deneme', 'Marmara')).toContain('Marmara');
    await o.sup.query(`UPDATE brans_yetkinligi SET kapsama = 'Ulusal' WHERE kurulus_ref = $1 AND ana_brans = 'Bölge Deneme'`, [f]);
    expect(await firmaUygunlugu(o.db, f, 'Bölge Deneme', 'Marmara')).toBeNull();
    // Komşu Bölge Tablosu (T-KMS): Komşu kapsam kendi ve komşu bölgede geçer, komşu olmayanda geçmez
    await o.sup.query(`UPDATE brans_yetkinligi SET kapsama = 'Komşu', bolge = '3. Güney Ege' WHERE kurulus_ref = $1 AND ana_brans = 'Bölge Deneme'`, [f]);
    expect(await firmaUygunlugu(o.db, f, 'Bölge Deneme', '4. Batı Akdeniz')).toBeNull();
    expect(await firmaUygunlugu(o.db, f, 'Bölge Deneme', '2. Kuzey Ege')).toBeNull();
    expect(await firmaUygunlugu(o.db, f, 'Bölge Deneme', '6. Doğu Akdeniz')).toContain('6. Doğu Akdeniz');
    expect((await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('fym'), { ag: 'Çıkarıldı', gerekce: 'G' })).statusCode).toBe(403);
    { // T-YG360: Sicil Sorumlusu önerisi Firma Yönetimi Müdürüne görev; karar öneriyi kapatır
      expect((await o.ist('POST', `/api/firma/${f}/statu-onerisi`, await o.gir('sc'), { risk: 'Yakın İzleme' })).statusCode).toBe(400);
      const r = await o.ist('POST', `/api/firma/${f}/statu-onerisi`, await o.gir('sc'), { risk: 'Yakın İzleme', gerekce: 'Karne düşüşü' }); expect(r.statusCode, r.body).toBe(200);
      expect((await o.ist('POST', `/api/firma/${f}/statu-onerisi`, await o.gir('sc'), { risk: 'Yakın İzleme', gerekce: 'Karne düşüşü' })).statusCode).toBe(409);
      expect((await o.kart('Firma Statü Önerisi', f)).durum).toBe('Bekliyor');
      expect((await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('fym'), { risk: 'Yakın İzleme', gerekce: 'Öneri uygun' })).statusCode).toBe(200);
      expect((await o.sup.query(`SELECT durum FROM is_karti WHERE tur = 'Firma Statü Önerisi' AND nesne_kimligi = $1`, [f])).rows[0].durum).toBe('Tamamlandı');
    }
  });
  it('firma kullanıcısının işlevi işlemi sınırlar; kurumda en az bir Yönetici kalır (YG994-ISLEV)', async () => {
    const { firmaIslevi } = await import('../src/firma_islev.js');
    expect([firmaIslevi('/api/firma-portal/dosya/x/fiyat'), firmaIslevi('/api/firma-portal/is-emri/x/ilerleme'), firmaIslevi('/api/firma-portal/uygunsuzluk/x/yanit'), firmaIslevi('/api/firma-portal/personel'), firmaIslevi('/api/dosya/x')]).toEqual(['Teklif ve Mali', 'Saha', 'Kalite', 'Yönetici', null]);
    const k = (await o.sup.query(`SELECT kullanici_ref FROM kurulus_kullanici x JOIN kullanici_hesabi h ON h.kimlik = x.kullanici_ref WHERE h.e_posta = $1`, [FIRMA_EP])).rows[0].kullanici_ref;
    expect((await o.ist('POST', `/api/firma-portal/kullanici/${k}/islev`, firmaC, { islevler: ['Saha'] })).statusCode).toBe(409); // tek Yönetici kendini düşüremez
    await o.sup.query(`UPDATE kurulus_kullanici SET islevler = ARRAY['Saha'] WHERE kullanici_ref = $1`, [k]);
    const r = await o.ist('POST', '/api/firma-portal/dosya/00000000-0000-4000-8000-000000000000/fiyat', firmaC, { kalemler: [] });
    expect(r.statusCode).toBe(403); expect(r.json().hata).toContain('Teklif ve Mali');
    await o.sup.query(`UPDATE kurulus_kullanici SET islevler = ARRAY['Teklif ve Mali', 'Saha', 'Kalite', 'Yönetici'] WHERE kullanici_ref = $1`, [k]);
    expect((await o.ist('GET', '/api/firma-portal/kullanicilar', firmaC)).json().kullanicilar.length).toBeGreaterThan(0);
    { // ONY-22: ilk girişte rehber; okununca gösterilmez
      await o.sup.query(`UPDATE kurulus_kullanici SET rehber_okuma_zamani = NULL WHERE kullanici_ref = $1`, [k]);
      const a1 = (await o.ist('GET', '/api/firma-portal/ana', firmaC)).json(); expect(a1.rehber?.metin).toContain('YATONET 360');
      expect((await o.ist('POST', '/api/firma-portal/rehber-okundu', firmaC, {})).statusCode).toBe(200);
      expect((await o.ist('GET', '/api/firma-portal/ana', firmaC)).json().rehber).toBeNull();
    }
  });
  it('tam akış: onay, yayın, firma görünümünde müşteri yok, kod ile kabul, başlangıç, ilerleme, teknik kabul, kapanış', async () => {
    const { d, e } = await onarim();
    const j = (await o.ist('GET', `/api/firma-portal/is-emri/${e.kimlik}`, firmaC)).json();
    expect(j.statu).toBe('Kabul Bekliyor'); expect(Number(j.bedel)).toBe(510); expect(j.kalemler).toHaveLength(1);
    expect(j.kalemler[0].kabul_olcutu).toBe('Ölçüt'); expect(j.teknikSonuc).toBe('S'); expect(j.sorumluRol).toBeTruthy(); // YG-320 expect(Array.isArray(j.guvenlik)).toBe(true); // YG-311
    const metin = JSON.stringify(j);
    expect(metin).not.toContain('Sahip'); expect(metin).not.toContain('SG'); expect(metin).not.toMatch(/(?<![0-9a-f])795(?![0-9a-f])/); expect(metin).not.toMatch(/(?<![0-9a-f])663(?![0-9a-f])/); // tutar; rastgele kimlik içindeki rakamlar sayılmaz
    // Kabul kodsuz olmaz; yanıt başlangıcı açar.
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/yanit`, firmaC, { yanit: 'Kabul' })).statusCode).toBe(401);
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/ilerleme`, firmaC, {})).statusCode).toBe(409);
    await o.sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 0 WHERE e_posta = $1`, [FIRMA_EP]);
    const ky = await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/yanit`, firmaC, { yanit: 'Kabul', kod: totpKodu(firmaGizli, suankiAdim()) });
    expect(ky.statusCode, ky.body).toBe(200); expect(ky.json().statu).toBe('Başlangıç Kontrolünde');
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari LIKE $1`, [`bld01:${(await o.sup.query(`SELECT teklif_ref FROM is_emri WHERE kimlik = $1`, [e.kimlik])).rows[0].teklif_ref}%`])).rowCount).toBe(0); // YG-1446: sigortalı teklifte BLD-01 gitmez
    { const { bld01Gonder } = await import('../src/firma.js'); const c = await o.db.connect(); // YG-1446: yat sahibi teklifinde BLD-01
      try {
        expect(await bld01Gonder(c, e.kimlik, 'https://x')).toBe(false);
        await o.sup.query(`UPDATE fiyat_teklifi SET teklif_muhatabi = 'Yat Sahibi' WHERE kimlik = (SELECT teklif_ref FROM is_emri WHERE kimlik = $1)`, [e.kimlik]);
        await o.sup.query(`UPDATE is_emri SET baslangic_tarihi = '2026-12-07' WHERE kimlik = $1`, [e.kimlik]);
        const yt = (await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, telefon, olusturan_ref) VALUES ($1,'Yat Sahibi','Sahip','+905550003333',$2) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
        expect(await bld01Gonder(c, e.kimlik, 'https://x')).toBe(true);
        expect((await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld01:${(await o.sup.query(`SELECT teklif_ref FROM is_emri WHERE kimlik = $1`, [e.kimlik])).rows[0].teklif_ref}%`])).rows[0]?.metin).toContain('07.12.2026');
        await o.sup.query(`UPDATE fiyat_teklifi SET teklif_muhatabi = 'Sigorta Şirketi' WHERE kimlik = (SELECT teklif_ref FROM is_emri WHERE kimlik = $1)`, [e.kimlik]);
        await o.sup.query(`UPDATE dosya_tarafi SET aktif = false WHERE kimlik = $1`, [yt]);
      } finally { c.release(); } }
    expect((await o.ist('POST', `/api/is-emri/${e.kimlik}/baslangic`, await o.gir('ds'), { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı', 'Absorban ve Bariyer Mevcut'] })).statusCode).toBe(403);
    await o.sup.query(`INSERT INTO kalite_plani (dosya_ref, surum, kabul_sinifi, ozet, durum, hazirlayan_ref) VALUES ($1,1,'C','Ö','Onaylı',$2)`, [d.kimlik, o.K.tu]);
    expect((await o.ist('GET', `/api/is-emri/${e.kimlik}/ilerlemeler`, await o.gir('tu'))).json()).toEqual([]);
    await o.sup.query(`INSERT INTO baslangic_toplantisi (is_emri_ref, tarih, katilimcilar, konusulanlar, kaydeden_ref) VALUES ($1,current_date,'K','K',$2)`, [e.kimlik, o.K.ds]);
    const bs = await o.ist('POST', `/api/is-emri/${e.kimlik}/baslangic`, await o.gir('tu'), { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı', 'Absorban ve Bariyer Mevcut'] });
    expect(bs.statusCode, bs.body).toBe(200);
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`bld02:${e.kimlik}`])).rows[0].metin;
    expect(m).toContain('itibarıyla başlanmıştır'); expect(m).not.toContain('[');
    const bel = await o.belge(d.kimlik, 'ds');
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/ilerleme`, firmaC, { kalem: 'İnceleme', miktar: 5 })).statusCode).toBe(400);
    const il = await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/ilerleme`, firmaC, { kalem: 'İnceleme', miktar: 5, belge: bel });
    { // T-YG1574-BEKLEYEN: kapatılmamış dünkü günlük kayıt İşleminizi Bekleyenler'de
      await o.sup.query(`INSERT INTO firma_gunluk_kaydi (is_emri_ref, kurulus_ref, tarih, durum, giren_ref) SELECT kimlik, kurulus_ref, (now() AT TIME ZONE 'Europe/Istanbul')::date - 1, 'Açık', $2 FROM is_emri WHERE kimlik = $1 ON CONFLICT DO NOTHING`, [e.kimlik, o.K.ds]);
      const bk = await o.ist('GET', '/api/firma-portal/bekleyenler', firmaC); expect(bk.statusCode, bk.body).toBe(200);
      expect(bk.json().some((x: any) => x.tur === 'Kapatılmamış Günlük Kayıt' && x.isEmri === e.kimlik)).toBe(true);
      expect((await o.ist('GET', '/api/firma-portal/bekleyenler', await o.gir('ds'))).statusCode).toBe(403);
    }
    expect((await o.ist('POST', `/api/is-emri/${e.kimlik}/ilerleme/${il.json().kimlik}/dogrula`, await o.gir('tu'))).json().ilerleme).toBe(50);
    await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/tamamlandi`, firmaC);
    expect((await o.sup.query(`SELECT teknik_kabul_sonucu FROM is_emri WHERE kimlik = $1`, [e.kimlik])).rows[0].teknik_kabul_sonucu).toBeNull();
    expect((await o.ist('POST', `/api/is-emri/${e.kimlik}/kapat`, await o.gir('ds'), {})).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/is-emri/${e.kimlik}/teknik-kabul`, await o.gir('tu'), { sonuc: 'Kabul' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/is-emri/${e.kimlik}/kapat`, await o.gir('ds'), {})).json().hata).toContain('atık');
    expect((await o.ist('POST', `/api/is-emri/${e.kimlik}/kapat`, await o.gir('ds'), { atikBelgesi: bel })).json().statu).toBe('Kapalı');
    const ka = (await o.sup.query(`SELECT dosya_puani, kapanis_zamani FROM performans_olay_kaydi WHERE is_emri_ref = $1`, [e.kimlik])).rows; expect(ka).toHaveLength(1); expect(ka[0].kapanis_zamani).not.toBeNull(); // YG-350: kapanışta karne kaydı
  }, 60_000);
  it('firma başka firmanın iş emrini göremez; firma Ret verirse DS görevi; çekince gerekçe ister', async () => {
    const { e } = await onarim();
    const ikinci = await o.sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = 'yatsahibi@deneme.yatonet.local'`); void ikinci;
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/yanit`, firmaC, { yanit: 'Ret' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/yanit`, firmaC, { yanit: 'Ret', aciklama: 'Kapasite yok' })).json().statu).toBe('İptal');
    expect((await o.kart('Firma Değiştir', e.kimlik)).sahip_kullanici_ref).toBe(o.K.ds);
    expect((await o.ist('GET', `/api/firma-portal/is-emri/00000000-0000-0000-0000-000000000000`, firmaC)).statusCode).toBe(404);
    expect((await o.ist('GET', `/api/firma-portal/ana`, await o.gir('ds'))).statusCode).toBe(403);
  }, 60_000);
});
void COOKIE_ADI;

describe('kartela maliyet girişi ve sürüm (YG-1081, YG-859)', () => {
  it('yalnız TİD ve CEO görür ve girer; pozitif maliyet, tarih ve kaynak zorunlu; CEO onayıyla tek yürürlük', async () => {
    expect((await o.ist('GET', '/api/kartela/maliyet', await o.gir('ts'))).statusCode).toBe(404);
    const c = await o.gir('tid');
    const eski = (await o.ist('GET', '/api/kartela/maliyet', c)).json().surum as string;
    const etk = (await o.sup.query(`SELECT kod FROM kartela_kalemi WHERE surum = $1 LIMIT 1`, [eski])).rows[0].kod as string; await o.sup.query(`UPDATE kartela_kalemi SET resmi_onay_gerekebilir = true WHERE kod = $1`, [etk]);
    { // YG-856: Tedarik/Teknik önerir, TİD onaylar; taslak yoksa bekler, taslak açılınca işlenir
      const fo = '/api/kartela/fiyat-onerisi'; const mevcut = Number((await o.sup.query(`SELECT maliyet_eur FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [etk, eski])).rows[0].maliyet_eur); const P = { kod: etk, maliyet: mevcut, tarih: '2026-11-10', kaynak: 'Tedarikçi teklifi', gerekce: 'Fiyat artışı' };
      expect((await o.ist('POST', fo, await o.gir('ts'), P)).statusCode).toBe(403);
      expect((await o.ist('POST', fo, await o.gir('tu'), { ...P, kaynak: '' })).statusCode).toBe(400);
      const fr = await o.ist('POST', fo, await o.gir('tu'), P); expect(fr.statusCode, fr.body).toBe(200);
      expect((await o.karar((await o.kart('Kartela Fiyat Önerisi', fr.json().kimlik)).kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
      expect((await o.sup.query(`SELECT durum FROM kartela_fiyat_onerisi WHERE kimlik = $1`, [fr.json().kimlik])).rows[0].durum).toBe('Taslak Bekliyor'); }
    const r = await o.ist('POST', '/api/kartela/taslak', c, {}); expect(r.statusCode, r.body).toBe(200); const sur = r.json().surum as string;
    expect((await o.sup.query(`SELECT kaynak_norm FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [etk, sur])).rows[0].kaynak_norm).toBe('Tedarikçi teklifi'); // YG-856
    expect((await o.sup.query(`SELECT resmi_onay_gerekebilir e FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [etk, sur])).rows[0].e).toBe(true); await o.sup.query(`UPDATE kartela_kalemi SET resmi_onay_gerekebilir = false WHERE kod = $1`, [etk]); // YG-1441: etiket yeni sürüme taşınır
    expect((await o.ist('POST', '/api/kartela/taslak', c, {})).statusCode).toBe(409);
    const k = (await o.sup.query(`SELECT kod, maliyet_eur FROM kartela_kalemi WHERE surum = $1 AND maliyet_eur > 0 LIMIT 1`, [sur])).rows[0];
    const u = '/api/kartela/taslak/maliyet';
    expect((await o.ist('POST', u, c, { kod: k.kod, maliyet: 0, tarih: '2026-11-06', kaynak: 'Firma teklifi' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, c, { kod: k.kod, maliyet: Number(k.maliyet_eur) })).statusCode).toBe(400);
    expect((await o.ist('POST', u, await o.gir('ts'), { kod: k.kod, maliyet: 1, tarih: '2026-11-06', kaynak: 'X' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, c, { kod: k.kod, maliyet: Number(k.maliyet_eur), tarih: '2026-11-06', kaynak: 'Firma teklifi ortalaması' })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/kartela/taslak/onaya-gonder', c, {})).json().hata).toContain('eksiktir');
    { // YG-856: Excel'den toplu güncelleme; hatalı satır varsa hiçbiri işlenmez
      const tu = '/api/kartela/taslak/maliyet-toplu';
      const h = await o.ist('POST', tu, c, { metin: `Kod\tMaliyet\tTarih\tKaynak\n${k.kod}\t1.234,56\t06.11.2026\tToplu kaynak\nYOK-KOD\t5\t2026-11-06\tX` });
      expect(h.statusCode).toBe(400); expect(h.json().hatalar[0]).toContain('Satır 3');
      expect(Number((await o.sup.query(`SELECT maliyet_eur FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [k.kod, sur])).rows[0].maliyet_eur)).toBe(Number(k.maliyet_eur));
      expect((await o.ist('POST', tu, await o.gir('ts'), { metin: `${k.kod}\t1\t2026-11-06\tX` })).statusCode).toBe(404);
      const r2 = await o.ist('POST', tu, c, { metin: `${k.kod}\t1.234,56\t06.11.2026\tToplu kaynak` }); expect(r2.statusCode, r2.body).toBe(200); expect(r2.json().islenen).toBe(1);
      expect((await o.sup.query(`SELECT maliyet_eur::text m, kaynak_norm FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [k.kod, sur])).rows[0]).toEqual({ m: '1234.56', kaynak_norm: 'Toplu kaynak' });
    }
    // T-YG661: kalem taslaktan gerekçeyle kaldırılır; yürürlükteki sürüm değişmez
    const kl = (await o.sup.query(`SELECT kod FROM kartela_kalemi WHERE surum = $1 AND kod <> $2 ORDER BY kod DESC LIMIT 1`, [sur, k.kod])).rows[0].kod;
    expect((await o.ist('POST', '/api/kartela/taslak/kaldir', c, { kod: kl })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/kartela/taslak/kaldir', c, { kod: kl, gerekce: 'Uygulamadan kalktı' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [kl, sur])).rows[0].n).toBe(0);
    expect((await o.sup.query(`SELECT count(*)::int n FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [kl, eski])).rows[0].n).toBe(1);
    await o.sup.query(`UPDATE kartela_kalemi SET maliyet_tarihi = '2026-11-06', kaynak_norm = 'Deneme', maliyet_eur = greatest(maliyet_eur, 1) WHERE surum = $1 AND kod <> $2`, [sur, k.kod]);
    const g = await o.ist('POST', '/api/kartela/taslak/onaya-gonder', c, {}); expect(g.statusCode, g.body).toBe(200);
    expect((await o.karar(g.json().kart, 'gmy', 'Onaya Gönder')).statusCode).toBe(200); // YG-541
    expect((await o.karar(g.json().kart, 'bceo', 'Onayla')).statusCode).toBe(200);
    const d = (await o.sup.query(`SELECT surum, durum FROM kartela_surumu WHERE surum = ANY($1)`, [[eski, sur]])).rows;
    expect(Object.fromEntries(d.map((x) => [x.surum, x.durum]))).toEqual({ [eski]: 'Arşiv', [sur]: 'Yürürlükte' });
    expect((await o.sup.query(`SELECT count(*)::int n FROM kartela_surumu WHERE durum = 'Yürürlükte'`)).rows[0].n).toBe(1);
  });
});

describe('bildirilen onarım süresi (YG-1457)', () => {
  it('teklife firmanın tahmini süresinin %20 fazlası yukarı yuvarlanarak yazılır; firma raporu değişmez', async () => {
    const d = await hazir();
    const e = (await o.sup.query(`SELECT kimlik, kurulus_ref FROM is_emri WHERE dosya_ref = $1 LIMIT 1`, [d.kimlik])).rows[0];
    await o.sup.query(`INSERT INTO firma_teknik_raporu (rapor_no, dosya_ref, is_emri_ref, kurulus_ref, inceleme_tarihi, bulgular, onerilen_islemler, tahmini_sure_gun, firma_degerlendirmesi, giren_ref) VALUES ($1,$2,$3,$4,current_date,'b','o',7,'f',$5)`, [`${d.dosyaNo}-FR01`, d.kimlik, e.kimlik, e.kurulus_ref, o.K.ds]);
    const t = await teklifAc(d);
    expect((await o.sup.query(`SELECT bildirilen_sure_gun FROM fiyat_teklifi WHERE kimlik = $1`, [t.kimlik])).rows[0].bildirilen_sure_gun).toBe(9); // 7 × 1,2 = 8,4 → 9
    expect((await o.sup.query(`SELECT tahmini_sure_gun FROM firma_teknik_raporu WHERE dosya_ref = $1`, [d.kimlik])).rows[0].tahmini_sure_gun).toBe(7);
    const { teklifTanim } = await import('../src/belge_uret.js'); const pdf = JSON.stringify((await teklifTanim(o.db, t.kimlik, 'K', 'http://x')).t);
    expect(pdf).toContain('Tahmini Onarım Süresi'); expect(pdf).toContain('9 iş günü (yat onarım yerine ulaştıktan'); expect(pdf).not.toContain('Tahmini Teslim Tarihi'); // SRE-2
    // Revizyonda süre korunur.
    await o.sup.query(`UPDATE fiyat_teklifi SET hazirlayan_ref = $2 WHERE kimlik = $1`, [t.kimlik, o.K.ts]);
    const rv = await o.ist('POST', `/api/teklif/${t.kimlik}/revizyon`, await o.gir('ts'), { neden: 'Kapsam düzeltmesi' }); expect(rv.statusCode, rv.body).toBe(200);
    expect((await o.sup.query(`SELECT bildirilen_sure_gun FROM fiyat_teklifi WHERE kimlik = $1`, [rv.json().kimlik])).rows[0].bildirilen_sure_gun).toBe(9);
  });
});

describe('resmî / klas onayı etiketi (YG-1441)', () => {
  it('klaslı yatta etiketli işlem TU görevi açar; TU işaretler; Gerekli satır rapor tablosuna düşer; etiketi yalnız TM koyar', async () => {
    const d = await hazir();
    await o.sup.query(`UPDATE yat SET klas_durumu = 'Evet' WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    const kod = (await o.sup.query(`SELECT s.kartela_kodu FROM kapsam_satiri s JOIN kapsam_cetveli c ON c.kimlik = s.cetvel_ref WHERE c.dosya_ref = $1 AND s.kartela_kodu IS NOT NULL LIMIT 1`, [d.kimlik])).rows[0].kartela_kodu;
    expect((await o.ist('POST', `/api/kartela/${kod}/resmi-onay`, await o.gir('tu'), { etiket: true })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/kartela/${kod}/resmi-onay`, await o.gir('tm'), { etiket: true })).statusCode).toBe(200);
    try {
      const t = await teklifAc(d);
      expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Resmî / Klas Onayı Değerlendirmesi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [t.kimlik])).rows[0].n).toBe(1);
      const tu = await o.gir('tu'); const l = (await o.ist('GET', `/api/dosya/${d.kimlik}/resmi-onay`, tu)).json(); expect(l.length).toBeGreaterThan(0);
      expect((await o.ist('POST', `/api/teklif-kalemi/${l[0].kimlik}/resmi-onay`, tu, { karar: 'Belki' })).statusCode).toBe(400);
      expect((await o.ist('POST', `/api/teklif-kalemi/${l[0].kimlik}/resmi-onay`, await o.gir('ts'), { karar: 'Gerekli' })).statusCode).toBe(404);
      for (const [n, x] of l.entries()) expect((await o.ist('POST', `/api/teklif-kalemi/${x.kimlik}/resmi-onay`, tu, { karar: n === 0 ? 'Gerekli' : 'Gerekmez' })).statusCode).toBe(200);
      expect((await o.sup.query(`SELECT durum FROM is_karti WHERE tur = 'Resmî / Klas Onayı Değerlendirmesi' AND nesne_kimligi = $1`, [t.kimlik])).rows[0].durum).toBe('Tamamlandı');
      const { resmiOnayGerekenler } = await import('../src/resmi_onay.js');
      expect((await resmiOnayGerekenler(o.db, d.kimlik)).map((x) => x.kod)).toEqual([l[0].kartela_kodu]);
    } finally { await o.sup.query(`UPDATE kartela_kalemi SET resmi_onay_gerekebilir = false WHERE kod = $1`, [kod]); }
  });
});

describe('firma raporunda resmî / klas onayı sorusu (YG-1441)', () => {
  it('klaslı yatta firma evet/hayır yanıtlamadan rapor gönderemez', async () => {
    const d = await hazir();
    await o.sup.query(`UPDATE yat SET klas_durumu = 'Evet' WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    const e = (await o.sup.query(`SELECT kimlik FROM is_emri WHERE dosya_ref = $1 AND is_emri_turu = 'KN' LIMIT 1`, [d.kimlik])).rows[0].kimlik;
    await o.sup.query(`DELETE FROM firma_teknik_raporu WHERE is_emri_ref = $1`, [e]);
    const R = { tarih: '2026-11-05', bulgular: 'b', oneriler: 'o', sure: 3, degerlendirme: 'f' };
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e}/teknik-rapor`, firmaC, R)).json().hata).toContain('resmî / klas onayı');
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e}/teknik-rapor`, firmaC, { ...R, resmiOnay: true, miktarlar: [{ kalem: 'Jelkot', miktar: 0, birim: 'm²' }] })).statusCode).toBe(400); // YG-427
    const r = await o.ist('POST', `/api/firma-portal/is-emri/${e}/teknik-rapor`, firmaC, { ...R, resmiOnay: true, miktarlar: [{ kalem: 'Jelkot onarımı', miktar: '2,5', birim: 'm²' }] }); expect(r.statusCode, r.body).toBe(200);
    const tr = (await o.ist('GET', `/api/dosya/${d.kimlik}/teknik-rapor`, await o.gir('ds'))).json(); expect(tr.oneri.oneriler).toContain('Jelkot onarımı: 2,5 m²'); expect(Array.isArray(tr.oneri.fotograflar)).toBe(true); // YG-427
    expect((await o.sup.query(`SELECT resmi_onay_gerekir FROM firma_teknik_raporu WHERE is_emri_ref = $1`, [e])).rows[0].resmi_onay_gerekir).toBe(true);
  });
});

describe('sigorta onaylı kalem yat sahibine yazılmaz (YG-890)', () => {
  it('aynı cetvelden yat sahibi teklifi onaylı satırla açılmaz', async () => {
    const d = await hazir(); const t = await teklifAc(d, 51);
    await o.sup.query(`UPDATE fiyat_teklifi SET teklif_muhatabi = 'Sigorta Şirketi', statu = 'Karar' WHERE kimlik = $1`, [t.kimlik]);
    await o.sup.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = 'Onaylandı' WHERE teklif_ref = $1`, [t.kimlik]);
    const ff = await firmaFiyat(d.kimlik, 51);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teklif`, await o.gir('ts'), { firmaTeklifi: ff, muhatap: 'Yat Sahibi' });
    expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('Sigorta şirketinin onayladığı kalem');
  });
});

describe('birlikte yazılmaz kuralları (YG-1704, YG-1705)', () => {
  it('KS-31 ve KS-131 uyarısı döner', async () => {
    const { kartelaUyarilari } = await import('../src/teklif.js');
    expect((await kartelaUyarilari(o.db, ['YANGIN-01.01.02-04', 'YANGIN-01.01.03-01'])).map((u) => u.grup)).toContain('KS-31');
    expect((await kartelaUyarilari(o.db, ['KESIF-01.03.03-01', 'HASAR-01.04.01-01'])).map((u) => u.grup)).toEqual(['KS-131']);
  });
});

describe('kurumsal sözleşme kaydı (YG-208)', () => {
  it('onaylı kurumsal tekliften sözleşme kaydı bir kez açılır', async () => {
    const d = await hazir(); const t = await teklifAc(d, 51);
    await o.sup.query(`UPDATE fiyat_teklifi SET teklif_muhatabi = 'Kurumsal Müşteri' WHERE kimlik = $1`, [t.kimlik]);
    const { kurumsalSozlesmeKur } = await import('../src/teklif.js');
    await kurumsalSozlesmeKur(o.db, t.kimlik, 'YATONET 360 Onayı', o.K.ts!); await kurumsalSozlesmeKur(o.db, t.kimlik, 'YATONET 360 Onayı', o.K.ts!);
    const s = (await o.sup.query(`SELECT sozlesme_turu, durum, kurumsal_kanal FROM sozlesme_kaydi WHERE teklif_ref = $1`, [t.kimlik])).rows;
    expect(s).toEqual([{ sozlesme_turu: 'Yat Onarım', durum: 'Yürürlükte', kurumsal_kanal: 'YATONET 360 Onayı' }]);
  });
});

describe('teklif hedef süresi (YG-199)', () => {
  it('firma raporu ve firma fiyatı girilince başlar, öncelik saatine göre biter', async () => {
    const d = await hazir();
    const e = (await o.sup.query(`SELECT kimlik FROM is_emri WHERE dosya_ref = $1 AND is_emri_turu = 'KN' LIMIT 1`, [d.kimlik])).rows[0].kimlik;
    await o.sup.query(`DELETE FROM firma_teknik_raporu WHERE is_emri_ref = $1`, [e]); await o.sup.query(`DELETE FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Teklif'`, [d.kimlik]);
    await firmaFiyat(d.kimlik, 51);
    expect((await o.sup.query(`SELECT 1 FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Teklif'`, [d.kimlik])).rowCount).toBe(0);
    const r = await o.ist('POST', `/api/firma-portal/is-emri/${e}/teknik-rapor`, firmaC, { tarih: '2026-11-05', bulgular: 'b', oneriler: 'o', sure: 3, degerlendirme: 'f', resmiOnay: false }); expect(r.statusCode, r.body).toBe(200);
    const s = (await o.sup.query(`SELECT baslangic_olayi FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Teklif'`, [d.kimlik])).rows[0];
    expect(s.baslangic_olayi).toContain('Firma Fiyat Teklifi');
    const tr = (await o.ist('GET', `/api/dosya/${d.kimlik}/teknik-rapor`, await o.gir('ds'))).json(); // YG-427
    expect(tr.oneri.oneriler).toContain('Tahmini Süre: 3 gün'); expect(tr.oneri.incelenen).toMatch(/^Yat: /);
  });
});

describe('Ticari Sorumlu ataması (YG-1600)', () => {
  it('keşif iş emriyle görev açılır', async () => {
    const d = await hazir(); expect((await o.kart('Ticari Sorumlu Ataması', d.kimlik)).durum).toBe('Bekliyor');
  });
});

describe('keşif talebi ve Firmaya Gönder (YG-1597, YG-042, KSF-1)', () => {
  it('hazır talep görevi açılır; KN firmaya gitmez; yalnız Dosya Sorumlusu gönderir; keşif süresi gönderimle başlar', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.ist('POST', `/api/dosya/${d.kimlik}/yat-bilgisi`, await o.gir('ds'), { tahrik: 'Dizel' }); await o.sup.query(`UPDATE yat SET gecici_kayit = false WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    expect((await o.kart('Keşif Talebi Hazır', d.kimlik)).durum).toBe('Bekliyor');
    const on = (await o.ist('GET', `/api/dosya/${d.kimlik}/kesif-talebi`, await o.gir('oy'))).json(); expect(on).toHaveProperty('kapsam');
    const r = await kesifIsEmri(d.kimlik, false);
    expect((await o.kart('Keşif Talebi Hazır', d.kimlik)).durum).toBe('Tamamlandı');
    expect((await o.sup.query(`SELECT statu, yayim_zamani FROM is_emri WHERE kimlik = $1`, [r.kimlik])).rows[0]).toEqual({ statu: 'Taslak', yayim_zamani: null });
    expect((await o.kart('Firmaya Gönder', r.kimlik)).durum).toBe('Bekliyor');
    await o.sup.query(`INSERT INTO dosya_sure (dosya_ref, tur, baslangic, bitis) VALUES ($1,'Keşif',now() - interval '30 days',now() - interval '27 days') ON CONFLICT DO NOTHING`, [d.kimlik]);
    const u = `/api/is-emri/${r.kimlik}/firmaya-gonder`;
    expect((await o.ist('POST', u, await o.gir('oy'), {})).statusCode).toBe(403);
    const g = await o.ist('POST', u, await o.gir('ds'), {}); expect(g.statusCode, g.body).toBe(200);
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [r.kimlik])).rows[0].statu).toBe('Kabul Bekliyor');
    expect((await o.sup.query(`SELECT ozet FROM bildirim WHERE olay_anahtari = $1 LIMIT 1`, [`is-emri:${r.kimlik}`])).rows[0].ozet).toMatch(/^LİMİT GLOBAL MARINE: .+ iş emri tarafınıza iletilmiştir\. .+ Kabul son zamanı: .+ Teknik Rapor ve Fiyat Teklifi süresi: kabulden itibaren \d+ saat\.$/); // YG-1518
    expect((await o.kart('Firmaya Gönder', r.kimlik)).durum).toBe('Tamamlandı');
    const s = (await o.sup.query(`SELECT baslangic, bitis FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Keşif'`, [d.kimlik])).rows[0];
    expect(Date.now() - new Date(s.baslangic).getTime()).toBeLessThan(60_000); expect(new Date(s.bitis).getTime()).toBeGreaterThan(Date.now());
    expect((await o.ist('POST', u, await o.gir('ds'), {})).statusCode).toBe(409);
  });
});

describe('Onarım Yöntem Raporu (YG-1454, YNT-1)', () => {
  it('branş kuralı sözcük başına bakar', async () => {
    const { yontemGerekli } = await import('../src/yontem_raporu.js');
    expect(['Kompozit, cam elyafı ve karbon', 'Ahşap gövde ve yapısal işler', 'Metal imalat, kaynak ve makine atölyesi', 'X; Çelik gövde ve çelik üstyapı'].every(yontemGerekli)).toBe(true);
    expect(['Tersane lojistiği ve geçici saha altyapısı', 'Ana makine ve tahrik motorları', ''].some(yontemGerekli)).toBe(false);
  });
  it('rapor Teknik Müdür onaylamadan kompozit ON açılmaz; muadilde yat sahibi onayı aranır; sınırlar aktarılır; firma görür', async () => {
    const d = await hazir({ sigortaci: 'SG', hasarNo: 'H1' }, { musteriTuru: 'Sigorta Şirketi' }); const t = await teklifAc(d); await onayla(t.kimlik);
    const gn = (await o.ist('POST', `/api/teklif/${t.kimlik}/gonder`, await o.gir('ts'))).json().gonderim;
    await o.ist('POST', `/api/sigorta-gonderim/${gn}/teyit`, await o.gir('ts'), { adim: 1 }); await o.ist('POST', `/api/sigorta-gonderim/${gn}/teyit`, await o.gir('ts'), { adim: 2 });
    await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Tam Onay', kanal: 'KEP', belge: await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`), yetkili: 'Y' });
    const kod = (await o.sup.query(`SELECT kartela_kodu k, kartela_surumu s FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND kartela_kodu IS NOT NULL LIMIT 1`, [t.kimlik])).rows[0];
    const eski = (await o.sup.query(`SELECT ana_brans FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [kod.k, kod.s])).rows[0].ana_brans;
    await o.sup.query(`UPDATE kartela_kalemi SET ana_brans = 'Kompozit, cam elyafı ve karbon' WHERE kod = $1 AND surum = $2`, [kod.k, kod.s]);
    try {
      const on = () => o.gir('oy').then((k) => o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, k, { tur: 'ON', teknikSonuc: 'S', firma, yer: 'M', kapsam: 'K', teklif: t.kimlik, bedel: 100 }));
      expect((await on()).json().hata).toContain('Onarım Yöntem Raporu');
      const u = `/api/dosya/${d.kimlik}/yontem-raporu`; const vf = await o.belge(d.kimlik, 'tu', 'Reçine Veri Föyü'); const R = { kapsam: 'K', malzeme: 'Reçine', sira: '1', muadil: ['Pompa Contası'], sinirlar: [{ tur: 'Kompozit Laminasyon ve Kür', sicaklikMin: 15, nemMax: 75 }], veriFoyleri: [{ malzeme: 'Reçine', bolge: 'Kıç', belge: vf }] };
      expect((await o.ist('POST', u, await o.gir('ds'), R)).statusCode).toBe(403);
      const tu = await o.gir('tu'); expect((await o.ist('POST', u, tu, { ...R, sira: '' })).statusCode).toBe(400);
      expect((await o.ist('POST', u, tu, { ...R, veriFoyleri: [] })).json().hata).toContain('veri föyü'); // YG-133
      expect((await o.ist('POST', u, tu, { ...R, sinirlar: [{ tur: 'X', sicaklikMin: 1 }] })).statusCode).toBe(400);
      const r = await o.ist('POST', u, tu, R); expect(r.statusCode, r.body).toBe(200); expect(r.json().raporNo).toBe(`${d.dosyaNo}-FR-ONR-001-01`);
      expect((await o.ist('POST', u, tu, R)).statusCode).toBe(409);
      expect((await on()).json().hata).toContain('Onarım Yöntem Raporu');
      await o.karar((await o.kart('Onarım Yöntem Raporu', r.json().kimlik)).kimlik, 'tm', 'Onayla');
      expect((await o.sup.query(`SELECT durum, onaylayan_ref FROM yontem_raporu WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ durum: 'Onaylı', onaylayan_ref: o.K.tm });
      expect((await o.sup.query(`SELECT count(*)::int n FROM belge_uretim WHERE tur = 'Yöntem Bilgi Nüshası' AND nesne = $1`, [r.json().kimlik])).rows[0].n).toBe(1); // YNT-2
      expect((await on()).json().hata).toContain('Muadil parça');
      await o.sup.query(`INSERT INTO onay_talebi (dosya_ref, ony_kod, baslik, metin, dugme, alici_ad, telefon, belirtec_ozeti, durum, son_gecerlilik) VALUES ($1,'ONY-07','k','Pompa Contası için','d','a','+905550002222',$2,'Onaylandı',now())`, [d.kimlik, `y${Math.random()}`]);
      const ie = await on(); expect(ie.statusCode, ie.body).toBe(200);
      const sn = (await o.sup.query(`SELECT sicaklik_min, nem_max, dayanak FROM proses_siniri WHERE is_emri_ref = $1`, [ie.json().kimlik])).rows[0];
      expect(Number(sn.sicaklik_min)).toBe(15); expect(sn.dayanak).toContain('FR-ONR-001-01');
      await o.karar((await o.kart('İş Emri', ie.json().kimlik)).kimlik, 'tid', 'Onayla').catch(() => {});
      await o.sup.query(`UPDATE is_emri SET statu = 'Kabul Bekliyor' WHERE kimlik = $1`, [ie.json().kimlik]);
      const fr = await o.ist('GET', `/api/firma-portal/is-emri/${ie.json().kimlik}/yontem-raporu`, firmaC); expect(fr.statusCode, fr.body).toBe(200); expect(fr.json().malzeme_tablosu).toBe('Reçine'); expect(fr.json().muadil_parcalar).toBeUndefined();
    } finally { await o.sup.query(`UPDATE kartela_kalemi SET ana_brans = $3 WHERE kod = $1 AND surum = $2`, [kod.k, kod.s, eski]); }
  });
});

describe('tedarikçi parça fiyatı (YG-1427, K-178)', () => {
  const S = [{ aciklama: 'İşçilik', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 2, birim: 'saat' }, { aciklama: 'Pompa', nitelik: 'Onarım', bedel: 'Malzeme', miktar: 3, birim: 'adet', kartela: KARTELA }];
  it('bağlı satırı firma görmez; yanıt beklerken teklif açılmaz; geçerli en düşük fiyat kartela kuralıyla geçer; bant dışı işaretlenir', async () => {
    const d = await hazir({}, {}, S);
    const st = (await o.sup.query(`SELECT s.kimlik FROM kapsam_satiri s JOIN kapsam_cetveli c ON c.kimlik = s.cetvel_ref WHERE c.dosya_ref = $1 AND s.aciklama = 'Pompa'`, [d.kimlik])).rows[0].kimlik;
    const ted = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Parça Tedarik','Tedarikçi',$2) RETURNING kimlik`, [`S-TD${Date.now()}`, o.K.ds])).rows[0].kimlik;
    const talep = async (no: string, durum: string, fiyat: number | null, gec = 'current_date + 30', son = "now() + interval '1 day'") => { const t = (await o.sup.query(`INSERT INTO tedarikci_teklif_talebi (talep_no, dosya_ref, kurulus_ref, son_zaman, durum, gecerlilik, olusturan_ref) VALUES ($1,$2,$3,${son},$4,${gec},$5) RETURNING kimlik`, [`${no}${Math.random()}`, d.kimlik, ted, durum, o.K.ds])).rows[0].kimlik; return (await o.sup.query(`INSERT INTO tedarikci_teklif_kalemi (talep_ref, urun_tanimi, miktar, birim, birim_fiyat_eur, satir_ref) VALUES ($1,'Pompa',3,'adet',$2,$3) RETURNING kimlik`, [t, fiyat, st])).rows[0].kimlik as string; };
    await talep('B', 'Yanıt Bekliyor', null);
    const kap = (await o.ist('GET', `/api/firma-portal/dosya/${d.kimlik}/kapsam`, firmaC)).json(); expect(kap.map((x: { aciklama: string }) => x.aciklama)).toEqual(['İşçilik']);
    const ff = await firmaFiyat(d.kimlik, 51);
    const ts = await o.gir('ts'); const u = `/api/dosya/${d.kimlik}/teklif`;
    expect((await o.ist('POST', u, ts, { firmaTeklifi: ff })).json().hata).toContain('Tedarikçi fiyatı bekleyen');
    await o.sup.query(`UPDATE tedarikci_teklif_talebi SET durum = 'Süresi Doldu' WHERE dosya_ref = $1`, [d.kimlik]);
    expect((await o.ist('POST', u, ts, { firmaTeklifi: ff })).json().hata).toContain('Firma fiyatı bekleyen');
    await talep('E', 'Yanıtlandı', 1, 'current_date - 1'); // süresi geçmiş ve en ucuz: sayılmaz
    await talep('P', 'Yanıtlandı', 1000); const uc = await talep('U', 'Yanıtlandı', 800);
    const r = await o.ist('POST', u, ts, { firmaTeklifi: ff }); expect(r.statusCode, r.body).toBe(200);
    const k = (await o.sup.query(`SELECT birim_maliyet_eur, birim_satis_fiyati_eur, tedarikci_kalem_ref, firma_kalem_ref, bant_disi FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND aciklama = 'Pompa'`, [r.json().kimlik])).rows[0];
    const kat = Number((await o.sup.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'fiyat_katsayisi'`)).rows[0].deger);
    expect(Number(k.birim_maliyet_eur)).toBe(800); expect(Number(k.birim_satis_fiyati_eur)).toBeCloseTo(800 * kat, 2); expect(k.tedarikci_kalem_ref).toBe(uc); expect(k.firma_kalem_ref).toBeNull(); expect(k.bant_disi).toBe(true);
    const rv = await o.ist('POST', `/api/teklif/${r.json().kimlik}/revizyon`, ts, { neden: 'Kapsam düzeltmesi' }); expect(rv.statusCode, rv.body).toBe(200);
    expect((await o.sup.query(`SELECT tedarikci_kalem_ref r FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND aciklama = 'Pompa'`, [rv.json().kimlik])).rows[0].r).toBe(uc);
  });
});

describe('sigorta ödeme farkı (YG-891, SGF-1)', () => {
  const S = [{ aciklama: 'A', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat' }, { aciklama: 'B', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat' }, { aciklama: 'C', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat' }];
  const kur = async () => {
    const d = await hazir({ sigortaci: 'SG', hasarNo: `H${Math.random()}` }, { musteriTuru: 'Sigorta Şirketi' }, S); const t = await teklifAc(d); await onayla(t.kimlik);
    const gn = (await o.ist('POST', `/api/teklif/${t.kimlik}/gonder`, await o.gir('ts'))).json().gonderim;
    await o.ist('POST', `/api/sigorta-gonderim/${gn}/teyit`, await o.gir('ts'), { adim: 1 }); await o.ist('POST', `/api/sigorta-gonderim/${gn}/teyit`, await o.gir('ts'), { adim: 2 });
    const k = await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Tam Onay', kanal: 'KEP', belge: await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`), yetkili: 'Y' }); expect(k.statusCode, k.body).toBe(200);
    const kl = (await o.sup.query(`SELECT sira_no, tutar_eur FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [t.kimlik])).rows; return { d, t, top: kl.reduce((a, x) => a + Number(x.tutar_eur), 0), bir: Number(kl[0].tutar_eur) };
  };
  it('fark varken iş emri açılmaz; kalem kapsamdan çıkar, ayrı teklife gider; kalan bakiye ayrı kalem olur', async () => {
    const { d, t, top, bir } = await kur(); const ds = await o.gir('ds'); const u = `/api/teklif/${t.kimlik}/sigorta-odenecek`;
    expect((await o.ist('POST', u, await o.gir('ts'), { tutar: 1 })).statusCode).toBe(404);
    expect((await o.ist('POST', u, ds, { tutar: top + 1 })).statusCode).toBe(400);
    const fark = bir * 2 + 10; const r = await o.ist('POST', u, ds, { tutar: top - fark }); expect(r.statusCode, r.body).toBe(200); expect(r.json().fark).toBeCloseTo(fark, 2);
    expect((await o.ist('POST', u, ds, { tutar: 1 })).statusCode).toBe(409);
    expect((await o.kart('Sigorta Ödeme Farkı', t.kimlik)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('oy'), { tur: 'ON', teknikSonuc: 'S', firma, yer: 'M', kapsam: 'K', teklif: t.kimlik, bedel: 10 })).json().hata).toContain('fark kararı');
    const f = `/api/teklif/${t.kimlik}/odeme-farki`;
    expect((await o.ist('POST', f, ds, { neden: 'Diğer', kapsamdan: [1], ayri: [1] })).statusCode).toBe(400);
    expect((await o.ist('POST', f, ds, { neden: 'Diğer', kapsamdan: [1, 2, 3] })).json().hata).toContain('aşmaktadır');
    expect((await o.ist('POST', f, ds, { neden: 'Muafiyet', ayri: [1] })).statusCode).toBe(400);
    const k = await o.ist('POST', f, ds, { neden: 'Diğer', kapsamdan: [1], ayri: [2] }); expect(k.statusCode, k.body).toBe(200); expect(k.json().kalan).toBeCloseTo(10, 2);
    expect((await o.kart('Sigorta Ödeme Farkı', t.kimlik)).durum).toBe('Tamamlandı');
    const a = await o.ist('POST', `/api/teklif/${t.kimlik}/onaylanmayan-teklif`, await o.gir('ts'), {}); expect(a.statusCode, a.body).toBe(200);
    const kl = (await o.sup.query(`SELECT aciklama, tutar_eur FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [a.json().kimlik])).rows;
    expect(kl.map((x) => x.aciklama)).toEqual(['B', 'Onarım Bedeli Bakiyesi']); expect(Number(kl[1].tutar_eur)).toBeCloseTo(10, 2);
    expect(JSON.stringify(kl)).not.toMatch(/muafiyet|sigorta/i);
  });
  it('muafiyet farkı yat sahibine yansımaz, kapsam değişmez, ayrı teklif açılmaz; tam ödemede fark kaydı açılmaz', async () => {
    const { t, top } = await kur(); const ds = await o.gir('ds');
    await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-odenecek`, ds, { tutar: top - 5 });
    const r = await o.ist('POST', `/api/teklif/${t.kimlik}/odeme-farki`, ds, { neden: 'Muafiyet' }); expect(r.statusCode, r.body).toBe(200); expect(r.json()).toEqual({ kalan: 0, ayriTeklif: false });
    expect((await o.sup.query(`SELECT count(*)::int n FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu = 'Onaylanmadı'`, [t.kimlik])).rows[0].n).toBe(0);
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/onaylanmayan-teklif`, await o.gir('ts'), {})).statusCode).toBe(409);
    const y = await kur(); const q = await o.ist('POST', `/api/teklif/${y.t.kimlik}/sigorta-odenecek`, ds, { tutar: y.top }); expect(q.json().fark).toBe(0);
    expect(await o.kart('Sigorta Ödeme Farkı', y.t.kimlik)).toBeUndefined();
  });
});

describe('paket statüsü (PKT-1, YG-385)', () => {
  it('iş emri statüsü yedi paket statüsüne eşlenir', async () => {
    const d = await hazir(); const e = (await o.sup.query(`SELECT kimlik FROM is_emri WHERE dosya_ref = $1 LIMIT 1`, [d.kimlik])).rows[0].kimlik; const ds = await o.gir('ds');
    const bak = async (statu: string, kabul: string | null = null) => { await o.sup.query(`UPDATE is_emri SET statu = $2, teknik_kabul_sonucu = $3 WHERE kimlik = $1`, [e, statu, kabul]); return (await o.ist('GET', `/api/dosya/${d.kimlik}/teklifler`, ds)).json().isEmirleri[0].paket_statusu; };
    for (const [s, k, p] of [['Taslak', null, 'Taslak'], ['İç Onayda', null, 'Onay Bekliyor'], ['Kabul Bekliyor', null, 'Onay Bekliyor'], ['Başlangıç Kontrolünde', null, 'Hazır'], ['Aktif', null, 'Uygulamada'], ['Durduruldu', null, 'Uygulamada'], ['Tamamlandı', null, 'Kontrol Bekliyor'], ['Tamamlandı', 'Kabul', 'Kabul'], ['Kapalı', 'Kabul', 'Kapalı'], ['İptal', null, null]] as const) expect(await bak(s, k)).toBe(p);
  });
});

describe('bölge katsayısı (YG-856, KS-11)', () => {
  it('8 bölge 1,00; değişiklik GMY ve CEO onayıyla uygulanır; bölgesiz dosyada 1', async () => { // T-YG856-BOLGE
    const { bolgeKatsayisi } = await import('../src/bolge_katsayisi.js');
    const l = (await o.sup.query(`SELECT bolge, katsayi FROM bolge_katsayisi ORDER BY bolge`)).rows; expect(l).toHaveLength(8); expect(l.every((x) => Number(x.katsayi) === 1)).toBe(true);
    const d = await o.dosyaAc(); expect(await bolgeKatsayisi(o.db, d.kimlik)).toBe(1);
    const tid = await o.gir('tid');
    expect((await o.ist('POST', '/api/bolge-katsayisi/talep', await o.gir('ds'), { bolge: '5. Antalya', katsayi: 1.1, gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/bolge-katsayisi/talep', tid, { bolge: '5. Antalya', katsayi: 1, gerekce: 'G' })).statusCode).toBe(409);
    const r = await o.ist('POST', '/api/bolge-katsayisi/talep', tid, { bolge: '5. Antalya', katsayi: '1,10', gerekce: 'Ulaşım maliyeti' }); expect(r.statusCode, r.body).toBe(200);
    const k = await o.kart('Bölge Katsayısı Değişikliği', r.json().kimlik); expect(k.zincir).toHaveLength(2);
    await o.karar(k.kimlik, 'gmy', 'Onaya Gönder'); await o.karar(k.kimlik, 'bceo', 'Onayla');
    expect(Number((await o.sup.query(`SELECT katsayi FROM bolge_katsayisi WHERE bolge = '5. Antalya'`)).rows[0].katsayi)).toBe(1.1);
    await o.sup.query(`UPDATE bolge_katsayisi SET katsayi = 1 WHERE bolge = '5. Antalya'`);
    expect(Number((await o.sup.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'kabul_itirazi_karar_suresi_gun'`)).rows[0].deger)).toBe(15); // YG-1662
  });
});

describe('katalog ad farkı teyidi (YG-1537)', () => {
  it('bağlanmamış katalog kaydı aday modelle listeye girer; teyitte katalog seri/no modele bağlanır ve durum güncellenir', async () => {
    const { adFarkiYukle, benzerlik } = await import('../src/katalog_ad_farki.js');
    expect(benzerlik('70', '70 OPEN')).toBeGreaterThan(0.3);
    const x = `ADF${Date.now()}`;
    const m = (await o.sup.query(`INSERT INTO yat_marka_model (marka_kodu, marka, model, durum, fotograf, teknik_veri) VALUES ('MRK-9999', $1, '70 Open', 'Katalog kaydı yok', 'Var', 'Yok') RETURNING kimlik`, [x])).rows[0].kimlik;
    const r = await adFarkiYukle(o.db, [{ seri: 99, no: 7001, ad: `${x} ${x} 70` }]); expect(r.eklenen).toBe(1);
    const sc = await o.gir('sc');
    const l = (await o.ist('GET', '/api/ana-veri/ad-farki', sc)).json(); const s = l.find((z: any) => z.katalog_no === 7001);
    expect(s.adaylar[0].model).toBe(m);
    expect((await o.ist('GET', '/api/ana-veri/ad-farki', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/ana-veri/ad-farki/99/7001', sc, { model: m })).statusCode).toBe(400);
    const t = await o.ist('POST', '/api/ana-veri/ad-farki/99/7001', sc, { model: m, not: 'Yazım farkı; aynı model' }); expect(t.statusCode, t.body).toBe(200);
    expect((await o.sup.query(`SELECT katalog_seri, katalog_no, durum FROM yat_marka_model WHERE kimlik = $1`, [m])).rows[0]).toEqual({ katalog_seri: 99, katalog_no: '07001', durum: 'Teknik eksik' });
    expect((await o.ist('POST', '/api/ana-veri/ad-farki/99/7001', sc, { eslesmeYok: true, not: 'X' })).statusCode).toBe(409);
  });
});

describe('sigorta onay tutarı kontrolü (YG-1608, TZ-6)', () => {
  it('teklif ve onaylanan kalem toplamına uymayan onay Ticari Sorumluya düşer; iade gerekçesiz olmaz, kayıt bir kez kontrol edilir', async () => {
    const ts = await o.gir('ts');
    const s = (await o.sup.query(`SELECT s.kimlik, s.onaylanan_tutar_eur FROM sigorta_onayi s WHERE s.karar = 'Tam Onay' LIMIT 1`)).rows[0]; expect(s).toBeDefined();
    const ilk = (await o.ist('GET', '/api/ticari/kontrol-bekleyenler', ts)).json(); expect(ilk.yetkili).toBe(true);
    expect(ilk.kayitlar.some((x: { kimlik: string }) => x.kimlik === s.kimlik)).toBe(false); // sistemin hesapladığı tutar uyumludur
    await o.sup.query(`UPDATE sigorta_onayi SET onaylanan_tutar_eur = onaylanan_tutar_eur + 7 WHERE kimlik = $1`, [s.kimlik]);
    expect((await o.ist('GET', '/api/ticari/kontrol-bekleyenler', ts)).json().kayitlar.some((x: { kimlik: string }) => x.kimlik === s.kimlik)).toBe(true);
    expect((await o.ist('POST', `/api/sigorta-onayi/${s.kimlik}/tutar-kontrol`, await o.gir('ds'), { karar: 'Doğrulandı' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/sigorta-onayi/${s.kimlik}/tutar-kontrol`, ts, { karar: 'Gerekçeyle İade Et' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/sigorta-onayi/${s.kimlik}/tutar-kontrol`, ts, { karar: 'Gerekçeyle İade Et', gerekce: 'Onay e-postasındaki tutar farklı' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/sigorta-onayi/${s.kimlik}/tutar-kontrol`, ts, { karar: 'Doğrulandı' })).statusCode).toBe(409);
    await o.sup.query(`UPDATE sigorta_onayi SET onaylanan_tutar_eur = $2 WHERE kimlik = $1`, [s.kimlik, s.onaylanan_tutar_eur]);
  });
});
