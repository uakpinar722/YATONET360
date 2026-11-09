import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { kalemHesapla, kutuAyikla_test, toplamlar } from './teklif_yardim.js';
import { caymaEngeli, teklifSureIsle } from '../src/teklif.js';
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
  const r = await o.ist('POST', `/api/dosya/${id}/cetvel`, await o.gir('tu'), { satirlar });
  expect(r.statusCode, r.body).toBe(200);
  const k = await o.kart('Kapsam Cetveli', r.json().kimlik);
  expect((await o.karar(k.kimlik, 'ty', 'Onayla')).statusCode).toBe(200);
  return r.json().kimlik as string;
};
const kesifIsEmri = async (id: string, gonder = true) => {
  await o.sup.query(`UPDATE onay_talebi SET durum = 'Onaylandı' WHERE dosya_ref = $1`, [id]);
  await o.sup.query(`INSERT INTO onay_talebi (dosya_ref, ony_kod, baslik, metin, dugme, alici_ad, telefon, belirtec_ozeti, durum, son_gecerlilik) VALUES ($1,'ONY-01','k','m','d','a','+905550002222',$2,'Onaylandı',now())`, [id, `x${Math.random()}`]);
  const r = await o.ist('POST', `/api/dosya/${id}/is-emri`, await o.gir('oy'), { tur: 'KN', firma, yer: 'Marmaris', kapsam: 'Keşif' });
  expect(r.statusCode, r.body).toBe(200);
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
  await o.ist('POST', `/api/firma/${firma}/statu`, fy, { asama: 'Onaylı', ag: 'Aktif', risk: 'Standart', gerekce: 'Belgeler tamam' });
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
  it('kartela 1.510 kalem, 130 grup; arama fiyat vermez', async () => {
    expect((await o.sup.query(`SELECT count(*)::int n FROM kartela_kalemi`)).rows[0].n).toBe(1510);
    expect((await o.sup.query(`SELECT count(*)::int n FROM kartela_birlikte_yazilmaz`)).rows[0].n).toBe(130);
    const r = (await o.ist('GET', '/api/kartela/ara?q=KESIF-01.01', firmaC)).json();
    expect(r.length).toBeGreaterThan(0); expect(r[0].maliyet_eur).toBeUndefined();
  });
  it('cetveli Teknik Uzman hazırlar; nitelik, bedel, miktar zorunlu; Yat Sahibi Talebi kısıtı teklif muhatabında', async () => {
    const d = await o.dosyaAc({ sigortaci: 'SG', hasarNo: 'H1' }, { musteriTuru: 'Sigorta Şirketi' }); await o.ekipKur(d.kimlik); const tu = await o.gir('tu');
    const c = (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/cetvel`, tu, { satirlar: [{ aciklama: 'A', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat', ...x }] });
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
  it('firma fiyatı eksik kalemde teklif açılmaz', async () => {
    const d = await hazir({}, {}, [{ aciklama: 'A', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat' }, { aciklama: 'B', nitelik: 'Onarım', bedel: 'İşçilik', miktar: 1, birim: 'saat' }]);
    const kap = (await o.ist('GET', `/api/firma-portal/dosya/${d.kimlik}/kapsam`, firmaC)).json();
    const ff = (await o.ist('POST', `/api/firma-portal/dosya/${d.kimlik}/fiyat`, firmaC, { kalemler: [{ satir: kap[0].kimlik, fiyat: 10 }] })).json().kimlik;
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teklif`, await o.gir('ts'), { firmaTeklifi: ff });
    expect(r.statusCode).toBe(409); expect(r.json().eksik).toEqual(['S002']);
  });
  it('bant dışı kalem TİD onayı olmadan onaya gönderilemez', async () => {
    const d = await hazir(); const t = await teklifAc(d, 100); const c = await o.gir('ts');
    expect(t.bantDisi).toBe(1);
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
    const s = await hazir({ sigortaci: 'SG' }, { musteriTuru: 'Sigorta Şirketi' }); const ts = await teklifAc(s);
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
    const ie = (x: object = {}) => o.gir('oy').then((k) => o.ist('POST', `/api/dosya/${g.d.kimlik}/is-emri`, k, { tur: 'ON', firma, yer: 'M', kapsam: 'K', teklif: g.t.kimlik, bedel: 510, ...x }));
    const eng = await ie();
    expect(eng.statusCode).toBe(409); expect(eng.json().hata).toContain('yasal bekleme');
    expect(await caymaEngeli(o.db, g.d.kimlik, new Date(Date.now() + 15 * 86_400_000))).toBeNull();
    await o.sup.query(`UPDATE on_bilgilendirme_cayma_kaydi SET cayma_bitis = now() - interval '1 minute' WHERE teklif_ref = $1`, [g.t.kimlik]);
    expect((await ie()).statusCode).toBe(200);
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
    const t = await teklifAc(d, 100); await onayla(t.kimlik);
    const u = `/api/teklif/${t.kimlik}/gonder`;
    const r = await o.ist('POST', u, await o.gir('ts')); expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('e-posta adresi bekleniyor');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/sigorta-eposta`, await o.gir('ty'), { eposta: 'x@y.local' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/sigorta-eposta`, await o.gir('ds'), { eposta: 'gecersiz' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/sigorta-eposta`, await o.gir('ds'), { eposta: 'hasar@adressiz.local' })).statusCode).toBe(200);
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
  });
  it('yat sahibinden onay istenmez, BLD-37 eş zamanlı gider; telefon kanalı geçersiz', async () => {
    const { d, t } = await gonder();
    expect((await o.sup.query(`SELECT 1 FROM onay_talebi WHERE nesne_kimligi = $1`, [t.kimlik])).rowCount).toBe(0);
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari = $1`, [`bld37:${t.kimlik}`])).rowCount).toBeGreaterThan(0);
    const c = await o.gir('ds');
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, c, { karar: 'Tam Onay', kanal: 'Telefon', yetkili: 'Y' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, c, { karar: 'Tam Onay', kanal: 'KEP', yetkili: 'Y' })).statusCode).toBe(400);
    void d;
  });
  it('tam onay dosyayı Uygulama aşamasına alır, BLD-38 gider', async () => {
    const { d, t } = await gonder();
    const r = await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Tam Onay', kanal: 'KEP', belge: await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`), yetkili: 'Y' });
    expect(r.json()).toMatchObject({ durum: 'Tam Onay', onaylananTutar: 260 });
    expect((await o.sup.query(`SELECT asama FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].asama).toBe('Uygulama');
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari = $1`, [`bld38:${t.kimlik}`])).rowCount).toBeGreaterThan(0);
  });
  it('kısmi onayda kalem silinmez, işaretlenir; iş emrine yalnız onaylılar geçer; onaylanmayanlar için görev açılır', async () => {
    const { d, t } = await gonder();
    expect((await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Kısmi Onay', kanal: 'KEP', belge: await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`), yetkili: 'Y' })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Kısmi Onay', kanal: 'KEP', belge: await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`), yetkili: 'Y', onaylananSiralar: [1] });
    expect(r.json().onaylananTutar).toBe(130);
    expect((await o.sup.query(`SELECT onay_durumu FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [t.kimlik])).rows.map((x) => x.onay_durumu)).toEqual(['Onaylandı', 'Onaylanmadı']);
    expect(await o.kart('Fiyat Teklifi Hazırla', t.kimlik)).toBeDefined();
    const ie = await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('oy'), { tur: 'ON', firma, yer: 'M', kapsam: 'K', teklif: t.kimlik, bedel: 100 });
    expect(ie.statusCode, ie.body).toBe(200);
    expect((await o.sup.query(`SELECT aciklama FROM is_emri_kalemi WHERE is_emri_ref = $1`, [ie.json().kimlik])).rows.map((x) => x.aciklama)).toEqual(['A']);
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
    const r = await o.ist('POST', u, c, { aciklama: 'Travel lift', tutar: 500, belge });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().araToplam).toBe(Number(once) + 500);
    const k = (await o.sup.query(`SELECT bedel_turu, birim_satis_fiyati_eur, tutar_eur, kartela_kodu FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND sira_no = $2`, [t.kimlik, r.json().sira])).rows[0];
    expect(k).toEqual({ bedel_turu: 'Masraf', birim_satis_fiyati_eur: '500.00', tutar_eur: '500.00', kartela_kodu: null });
    await onayla(t.kimlik);
    expect((await o.ist('POST', u, c, { aciklama: 'Ek', tutar: 10, belge })).statusCode).toBe(409);
  });
});

describe('iş emri ve firma portalı (YG-291, YG-294, YG-314, YG-325, YG-386)', () => {
  const onarim = async (bedel = 510) => {
    const d = await hazir({ sigortaci: 'SG', hasarNo: 'H1' }, { musteriTuru: 'Sigorta Şirketi' }); const t = await teklifAc(d); await onayla(t.kimlik);
    const gn = (await o.ist('POST', `/api/teklif/${t.kimlik}/gonder`, await o.gir('ts'))).json().gonderim;
    await o.ist('POST', `/api/sigorta-gonderim/${gn}/teyit`, await o.gir('ts'), { adim: 1 }); await o.ist('POST', `/api/sigorta-gonderim/${gn}/teyit`, await o.gir('ts'), { adim: 2 });
    await o.ist('POST', `/api/teklif/${t.kimlik}/sigorta-karar`, await o.gir('ds'), { karar: 'Tam Onay', kanal: 'KEP', belge: await o.belge(d.kimlik, 'ds', `Onay ${Math.random()}`), yetkili: 'Y' });
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('oy'), { tur: 'ON', firma, yer: 'Marmaris', kapsam: 'Onarım', teklif: t.kimlik, bedel, tehlikeliAtik: true });
    expect(r.statusCode, r.body).toBe(200);
    const k = await o.kart('İş Emri', r.json().kimlik);
    if (k.zincir.length > 1) await o.karar(k.kimlik, 'opm', 'Onaya Gönder');
    expect((await o.karar(k.kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    return { d, t, e: r.json() };
  };
  it('numara ve tür; yetki; onaysız teklif, firma uygunsuzluğu ve mali limit boş iş emri reddedilir', async () => {
    const d = await hazir(); const t = await teklifAc(d); const oy = await o.gir('oy');
    expect((await o.sup.query(`SELECT is_emri_no FROM is_emri WHERE dosya_ref = $1`, [d.kimlik])).rows[0].is_emri_no).toBe(`${d.dosyaNo}-KN01`);
    const p = (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, oy, { tur: 'ON', firma, yer: 'M', kapsam: 'K', teklif: t.kimlik, bedel: 10, ...x });
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('ds'), { tur: 'ON' })).statusCode).toBe(403);
    expect((await p({})).json().hata).toContain('Onaylanmış teklif');
    expect((await p({ tur: 'EK' })).json().hata).toContain('ana iş emrine');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('ty'), { tur: 'KN' })).statusCode).toBe(403);
  });
  it('askıdaki veya belgesi dolmuş firma seçilemez', async () => {
    const f = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: `Başka ${Math.random()}`, rol: 'Çözüm Ortağı' })).json().kimlik;
    expect(await firmaUygunlugu(o.db, f)).toContain('onaylı değildir');
    await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('fym'), { asama: 'Onaylı', ag: 'Aktif', gerekce: 'G' });
    expect(await firmaUygunlugu(o.db, f)).toBeNull();
    await o.ist('POST', `/api/firma/${f}/belge`, await o.gir('sc'), { tur: 'Vergi Levhası', bitis: '2020-01-01' });
    expect(await firmaUygunlugu(o.db, f)).toContain('Vergi Levhası');
    expect(await firmaUygunlugu(o.db, firma, 'Olmayan Branş')).toContain('branşta');
    expect((await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('fym'), { ag: 'Çıkarıldı', gerekce: 'G' })).statusCode).toBe(403);
  });
  it('tam akış: onay, yayın, firma görünümünde müşteri yok, kod ile kabul, başlangıç, ilerleme, teknik kabul, kapanış', async () => {
    const { d, e } = await onarim();
    const j = (await o.ist('GET', `/api/firma-portal/is-emri/${e.kimlik}`, firmaC)).json();
    expect(j.statu).toBe('Kabul Bekliyor'); expect(Number(j.bedel)).toBe(510); expect(j.kalemler).toHaveLength(1);
    const metin = JSON.stringify(j);
    expect(metin).not.toContain('Sahip'); expect(metin).not.toContain('SG'); expect(metin).not.toMatch(/(?<![0-9a-f])795(?![0-9a-f])/); expect(metin).not.toMatch(/(?<![0-9a-f])663(?![0-9a-f])/); // tutar; rastgele kimlik içindeki rakamlar sayılmaz
    // Kabul kodsuz olmaz; yanıt başlangıcı açar.
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/yanit`, firmaC, { yanit: 'Kabul' })).statusCode).toBe(401);
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/ilerleme`, firmaC, {})).statusCode).toBe(409);
    await o.sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 0 WHERE e_posta = $1`, [FIRMA_EP]);
    const ky = await o.ist('POST', `/api/firma-portal/is-emri/${e.kimlik}/yanit`, firmaC, { yanit: 'Kabul', kod: totpKodu(firmaGizli, suankiAdim()) });
    expect(ky.statusCode, ky.body).toBe(200); expect(ky.json().statu).toBe('Başlangıç Kontrolünde');
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
    const r = await o.ist('POST', '/api/kartela/taslak', c, {}); expect(r.statusCode, r.body).toBe(200); const sur = r.json().surum as string;
    expect((await o.sup.query(`SELECT resmi_onay_gerekebilir e FROM kartela_kalemi WHERE kod = $1 AND surum = $2`, [etk, sur])).rows[0].e).toBe(true); await o.sup.query(`UPDATE kartela_kalemi SET resmi_onay_gerekebilir = false WHERE kod = $1`, [etk]); // YG-1441: etiket yeni sürüme taşınır
    expect((await o.ist('POST', '/api/kartela/taslak', c, {})).statusCode).toBe(409);
    const k = (await o.sup.query(`SELECT kod, maliyet_eur FROM kartela_kalemi WHERE surum = $1 AND maliyet_eur > 0 LIMIT 1`, [sur])).rows[0];
    const u = '/api/kartela/taslak/maliyet';
    expect((await o.ist('POST', u, c, { kod: k.kod, maliyet: 0, tarih: '2026-11-06', kaynak: 'Firma teklifi' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, c, { kod: k.kod, maliyet: Number(k.maliyet_eur) })).statusCode).toBe(400);
    expect((await o.ist('POST', u, await o.gir('ts'), { kod: k.kod, maliyet: 1, tarih: '2026-11-06', kaynak: 'X' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, c, { kod: k.kod, maliyet: Number(k.maliyet_eur), tarih: '2026-11-06', kaynak: 'Firma teklifi ortalaması' })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/kartela/taslak/onaya-gonder', c, {})).json().hata).toContain('eksiktir');
    await o.sup.query(`UPDATE kartela_kalemi SET maliyet_tarihi = '2026-11-06', kaynak_norm = 'Deneme', maliyet_eur = greatest(maliyet_eur, 1) WHERE surum = $1 AND kod <> $2`, [sur, k.kod]);
    const g = await o.ist('POST', '/api/kartela/taslak/onaya-gonder', c, {}); expect(g.statusCode, g.body).toBe(200);
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
    const r = await o.ist('POST', `/api/firma-portal/is-emri/${e}/teknik-rapor`, firmaC, { ...R, resmiOnay: true }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT resmi_onay_gerekir FROM firma_teknik_raporu WHERE is_emri_ref = $1`, [e])).rows[0].resmi_onay_gerekir).toBe(true);
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
      const on = () => o.gir('oy').then((k) => o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, k, { tur: 'ON', firma, yer: 'M', kapsam: 'K', teklif: t.kimlik, bedel: 100 }));
      expect((await on()).json().hata).toContain('Onarım Yöntem Raporu');
      const u = `/api/dosya/${d.kimlik}/yontem-raporu`; const R = { kapsam: 'K', malzeme: 'Reçine', sira: '1', muadil: ['Pompa Contası'], sinirlar: [{ tur: 'Kompozit Laminasyon ve Kür', sicaklikMin: 15, nemMax: 75 }] };
      expect((await o.ist('POST', u, await o.gir('ds'), R)).statusCode).toBe(403);
      const tu = await o.gir('tu'); expect((await o.ist('POST', u, tu, { ...R, sira: '' })).statusCode).toBe(400);
      expect((await o.ist('POST', u, tu, { ...R, sinirlar: [{ tur: 'X', sicaklikMin: 1 }] })).statusCode).toBe(400);
      const r = await o.ist('POST', u, tu, R); expect(r.statusCode, r.body).toBe(200); expect(r.json().raporNo).toBe(`${d.dosyaNo}-FR-ONR-001-01`);
      expect((await o.ist('POST', u, tu, R)).statusCode).toBe(409);
      expect((await on()).json().hata).toContain('Onarım Yöntem Raporu');
      await o.karar((await o.kart('Onarım Yöntem Raporu', r.json().kimlik)).kimlik, 'tm', 'Onayla');
      expect((await o.sup.query(`SELECT durum, onaylayan_ref FROM yontem_raporu WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ durum: 'Onaylı', onaylayan_ref: o.K.tm });
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
