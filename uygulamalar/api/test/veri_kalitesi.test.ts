import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kaliteKontrolIsle, KURALLAR, oncelik } from '../src/veri_kalitesi.js';
import { gostergeleriHesapla, guvenDuzeyi } from '../src/gosterge.js';
import { isZamanlayici, zamanlanmisIsDenetimi } from '../src/zamanlayici.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { bim: 'Bilgi İşlem Müdürü', opm: 'Operasyon Müdürü', ds: 'Dosya Sorumlusu', ide: 'İç Denetçi' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test103', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('veri kalitesi (YG-1249, 1252, 1254, 1255)', () => {
  it('kurallar tek katalogda; ihlal açılır, düzeltilince giderilir; öncelik etkiden; istisnayı veri sahibi verir; kural sürümlenir', async () => {
    expect(new Set(KURALLAR.map((k) => k.kod)).size).toBe(KURALLAR.length);
    expect(oncelik('Ödeme')).toBe('Yüksek'); expect(oncelik('Teslim')).toBe('Orta'); expect(oncelik('Diğer')).toBe('Düşük');
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET statu = 'Aktif', ana_teknik_brans = NULL WHERE kimlik = $1`, [d.kimlik]);
    await kaliteKontrolIsle(o.db);
    const h = (await o.sup.query(`SELECT kimlik, oncelik, durum FROM veri_hatasi WHERE kural_kod = 'VK-01' AND kayit_kimligi = $1`, [d.kimlik])).rows[0];
    expect(h).toMatchObject({ oncelik: 'Orta', durum: 'Açık' });
    const v = (await o.ist('GET', '/api/veri-kalitesi', await o.gir('opm'))).json();
    expect(v.kumeler.map((k: { kod: string }) => k.kod)).toEqual(['DOSYA', 'FATURA', 'FIRMA', 'TARAF', 'YAT']);
    expect(v.sahipOldugu).toContain('DOSYA');
    expect((await o.ist('POST', `/api/veri-hatasi/${h.kimlik}/istisna`, await o.gir('bim'), { gerekce: 'x' })).statusCode).toBe(404);
    await o.sup.query(`UPDATE dosya SET ana_teknik_brans = 'Gövde' WHERE kimlik = $1`, [d.kimlik]);
    await kaliteKontrolIsle(o.db);
    expect((await o.sup.query(`SELECT durum FROM veri_hatasi WHERE kimlik = $1`, [h.kimlik])).rows[0].durum).toBe('Giderildi');
    expect((await o.ist('POST', '/api/kalite-kurali/VK-01', await o.gir('bim'), { esik: 5 })).json().surum).toBe(2);
    expect((await o.ist('GET', '/api/veri-kalitesi', await o.gir('ide'))).statusCode).toBe(404);
  });
  it('zamanlanmış iş tekil çalışır; çakışma ve gecikme kaydedilir, uyarı etkilenen çıktıları yazar (YG1316-ZAMAN)', async () => {
    const z = isZamanlayici(o.db, () => {}); let bitir: () => void = () => {};
    const uzun = z.tur('Deneme İşi', 'deneme raporu', 60_000, () => [new Promise<void>((r) => { bitir = r; })]);
    expect(await z.tur('Deneme İşi', 'deneme raporu', 60_000, () => [Promise.resolve()])).toBe('Çakışma');
    bitir(); expect(await uzun).toBe('Tamamlandı');
    expect(await z.tur('Hatalı İş', 'hatalı çıktı', 60_000, () => [Promise.reject(new Error('bozuk')), Promise.resolve()])).toBe('Tamamlandı');
    const d = (await o.sup.query(`SELECT ad, cakisma_sayisi, son_hata FROM zamanlanmis_is_durumu ORDER BY ad`)).rows;
    expect(d).toEqual([{ ad: 'Deneme İşi', cakisma_sayisi: 1, son_hata: null }, { ad: 'Hatalı İş', cakisma_sayisi: 0, son_hata: 'bozuk' }]);
    await o.sup.query(`UPDATE zamanlanmis_is_durumu SET son_baslangic = now() - interval '1 hour', son_bitis = now() - interval '1 hour', son_cakisma = NULL WHERE ad = 'Hatalı İş'`);
    expect(await zamanlanmisIsDenetimi(o.db)).toBe(2);
    expect((await o.sup.query(`SELECT ozet FROM is_karti WHERE tur = 'Zamanlanmış İş Uyarısı' AND nesne_kimligi = 'Hatalı İş'`)).rows[0].ozet).toContain('hatalı çıktı');
    expect(await zamanlanmisIsDenetimi(o.db)).toBe(0);
    const l = (await o.ist('GET', '/api/zamanlanmis-isler', await o.gir('bim'))).json(); expect(l.find((x: { ad: string }) => x.ad === 'Hatalı İş').gecikti).toBe(true);
    expect((await o.ist('GET', '/api/zamanlanmis-isler', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('göstergede güven düzeyi: veri yok sıfır sayılmaz, yetersiz örneklemde renk verilmez (YG743-GUVEN)', async () => {
    expect(guvenDuzeyi(null, 0, '%', false)).toBe('Veri yok'); expect(guvenDuzeyi(50, 2, '%', false)).toBe('Yetersiz veri');
    expect(guvenDuzeyi(2, 2, 'adet', false)).toBe('Yeterli'); expect(guvenDuzeyi(80, 10, '%', true)).toBe('Kalite eşiği aşıldı');
    const l = await gostergeleriHesapla(o.db, () => true);
    expect(l.length).toBeGreaterThan(20);
    for (const g of l) { expect(g.guven).toBeTruthy(); if (g.deger === null) expect(g.guven).toBe('Veri yok'); if (g.guven === 'Yetersiz veri') expect(g.renk).toBeNull(); }
    expect(l.find((g) => g.kod === 'G-9.6-4')!.orneklem).not.toBeUndefined();
  });
  it('kişisel veri taşıyan her tabloda bilgi sınıfı var, Kamuya Açık olamaz (YG1177-SINIF)', async () => {
    expect((await o.sup.query(`SELECT * FROM bilgi_sinifi_kisisel_eksik()`)).rows).toEqual([]);
    expect((await o.sup.query(`SELECT count(*)::int n FROM kisisel_veri_tablolari()`)).rows[0].n).toBeGreaterThan(20);
    expect((await o.sup.query(`SELECT bilgi_sinifi FROM kullanici_hesabi WHERE kimlik = $1`, [o.K.ds])).rows[0].bilgi_sinifi).toBe('Gizli');
    await expect(o.sup.query(`UPDATE taraf SET bilgi_sinifi = 'Kamuya Açık' WHERE kimlik = (SELECT kimlik FROM taraf LIMIT 1)`)).rejects.toThrow();
  });
  it('taraf ve kullanıcı iletişim bilgisi değişince eski değer kanıt olarak kalır (YG518-ANA)', async () => {
    const ds = await o.gir('ds');
    await o.sup.query(`UPDATE kullanici_hesabi SET cep_telefonu = '+905551112233' WHERE kimlik = $1`, [o.K.ds]);
    await o.sup.query(`UPDATE kullanici_hesabi SET cep_telefonu = '+905551112244' WHERE kimlik = $1`, [o.K.ds]);
    const p = (await o.ist('GET', '/api/profil', ds)).json();
    expect(p.iletisimGecmisi.some((x: { deger: string }) => x.deger === '+905551112233')).toBe(true);
    expect((await o.sup.query(`SELECT count(*)::int n FROM ana_iletisim_gecmisi WHERE kayit_turu = 'Kullanıcı' AND kayit_ref = $1 AND tur = 'Telefon' AND bildirim_hedefi`, [o.K.ds])).rows[0].n).toBe(1);
    const t = (await o.sup.query(`SELECT kimlik, taraf_no FROM taraf LIMIT 1`)).rows[0];
    await o.sup.query(`UPDATE taraf SET eposta = 'eski@ornek.com' WHERE kimlik = $1`, [t.kimlik]);
    await o.sup.query(`UPDATE taraf SET eposta = 'yeni@ornek.com' WHERE kimlik = $1`, [t.kimlik]);
    const g = (await o.ist('GET', `/api/taraf/${t.taraf_no}/iletisim-gecmisi`, await o.gir('opm'))).json();
    expect(g.find((x: { deger: string }) => x.deger === 'yeni@ornek.com').bildirim_hedefi).toBe(true);
    expect(g.find((x: { deger: string }) => x.deger === 'eski@ornek.com').gecerli).toBe(false);
  });
  it('tamlık birlikte: yat sahibi bağı, karar zamanı ve başka dosyaya ait kanıt (YG1251-TAMLIK)', async () => {
    const d = await o.dosyaAc(); const d2 = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET statu = 'Aktif' WHERE kimlik = $1`, [d.kimlik]);
    await o.sup.query(`UPDATE dosya_tarafi SET aktif = false WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]);
    const bel = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bag_turu, bag_kimligi, kaynak_kanali) VALUES ('f.jpg', 'Fotoğraf', 'Dosya', $1, 'Sistem') RETURNING kimlik`, [d2.kimlik])).rows[0].kimlik;
    const g = (await o.sup.query(`INSERT INTO gorsel_kanit (gorsel_no, dosya_ref, belge_ref, ceken_ref, asama, cekim_kalemi) VALUES ($1,$2,$3,$4,'Keşif','Genel – Baş') RETURNING kimlik`, [`${d.dosyaNo}-G9001`, d.kimlik, bel, o.K.ds])).rows[0].kimlik;
    await kaliteKontrolIsle(o.db);
    const ac = async (kod: string, k: string) => (await o.sup.query(`SELECT 1 FROM veri_hatasi WHERE kural_kod = $1 AND kayit_kimligi = $2 AND durum = 'Açık'`, [kod, k])).rowCount;
    expect(await ac('VK-14', d.kimlik)).toBe(1); expect(await ac('VK-17', g)).toBe(1);
  });
});
