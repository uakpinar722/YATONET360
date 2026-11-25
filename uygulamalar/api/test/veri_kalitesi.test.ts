import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kaliteKontrolIsle, KURALLAR, oncelik } from '../src/veri_kalitesi.js';
import { gostergeleriHesapla, guvenDuzeyi } from '../src/gosterge.js';
import { hizmetHesabiIsle } from '../src/zamanlayici.js';
import { sureAdimi, gorevSureIsle } from '../src/onay_sure.js';
import { bildir, sessizSonu } from '../src/bildirim.js';
import { isZamanlayici, zamanlanmisIsDenetimi } from '../src/zamanlayici.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { bim: 'Bilgi İşlem Müdürü', opm: 'Operasyon Müdürü', ds: 'Dosya Sorumlusu', ide: 'İç Denetçi', tu: 'Teknik Uzman', ys: 'Yat Sahibi (Deneme)', ys2: 'Yat Sahibi (Deneme)' };
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
    expect(v.kumeler.map((k: { kod: string }) => k.kod)).toEqual(['DOSYA', 'FATURA', 'FIRMA', 'TARAF', 'TEDARIKCI', 'YAT']);
    expect(v.sahipOldugu).toContain('DOSYA');
    expect((await o.ist('POST', `/api/veri-hatasi/${h.kimlik}/istisna`, await o.gir('bim'), { gerekce: 'x' })).statusCode).toBe(404);
    await o.sup.query(`UPDATE dosya SET ana_teknik_brans = 'Gövde' WHERE kimlik = $1`, [d.kimlik]);
    await kaliteKontrolIsle(o.db);
    expect((await o.sup.query(`SELECT durum FROM veri_hatasi WHERE kimlik = $1`, [h.kimlik])).rows[0].durum).toBe('Giderildi');
    expect((await o.ist('POST', '/api/kalite-kurali/VK-01', await o.gir('bim'), { esik: 5 })).json().surum).toBe(2);
    expect((await o.ist('GET', '/api/veri-kalitesi', await o.gir('ide'))).statusCode).toBe(404);
  });
  it('zamanlanmış iş tekil çalışır; çakışma ve gecikme kaydedilir, uyarı etkilenen çıktıları yazar (YG1316-ZAMAN)', async () => {
    const z = isZamanlayici(o.db, () => {}); let bitir: () => void = () => {}; let basladi = false;
    const uzun = z.tur('Deneme İşi', 'deneme raporu', 60_000, () => [new Promise<void>((r) => { bitir = r; basladi = true; })]);
    expect(await z.tur('Deneme İşi', 'deneme raporu', 60_000, () => [Promise.resolve()])).toBe('Çakışma');
    while (!basladi) await new Promise((r) => setTimeout(r, 10)); // iş kaydı yavaş yazılırsa bitir henüz atanmamış olabilir
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
  it('başarısız gönderim dosyaya ve kök nedene bağlanır; yeniden çalıştırma eski/yeni veri ve gerekçeyle kaydedilir (YG1309-YENIDEN)', async () => {
    const d = await o.dosyaAc(); const bim = await o.gir('bim');
    const g = (await o.sup.query(`INSERT INTO gonderim (olay_anahtari, kanal, hedef, konu, metin, durum, deneme, son_hata, kok_neden) VALUES ($1, 'E-posta', 'yanlis@ornek', 'Deneme', 'Metin', 'Başarısız', 3, 'Kalıcı hata: invalid recipient', 'Geçersiz veya engelli hedef') RETURNING kimlik`, [`teklif:${d.kimlik}`])).rows[0].kimlik;
    const l = (await o.ist('GET', '/api/gonderim/basarisiz', bim)).json();
    expect(l.satirlar.find((x: { kimlik: string }) => x.kimlik === g)).toMatchObject({ dosya_no: d.dosyaNo, kok_neden: 'Geçersiz veya engelli hedef' });
    expect((await o.ist('GET', '/api/gonderim/basarisiz', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/gonderim/${g}/yeniden`, bim, { hedef: 'dogru@ornek.com', kokNeden: 'Yanlış iletişim bilgisi' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/gonderim/${g}/yeniden`, bim, { hedef: 'dogru@ornek.com', kokNeden: 'Yanlış iletişim bilgisi', gerekce: 'Adres düzeltildi' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, hedef, deneme FROM gonderim WHERE kimlik = $1`, [g])).rows[0]).toEqual({ durum: 'Bekliyor', hedef: 'dogru@ornek.com', deneme: 0 });
    expect((await o.sup.query(`SELECT eski_hedef, yeni_hedef, eski_hata, gerekce FROM gonderim_yeniden_calistirma WHERE gonderim_ref = $1`, [g])).rows[0]).toEqual({ eski_hedef: 'yanlis@ornek', yeni_hedef: 'dogru@ornek.com', eski_hata: 'Kalıcı hata: invalid recipient', gerekce: 'Adres düzeltildi' });
    expect((await o.ist('POST', `/api/gonderim/${g}/yeniden`, bim, { kokNeden: 'Diğer', gerekce: 'Tekrar' })).statusCode).toBe(409);
  });
  it('ilişki kimliği istekten değişiklik izine, arka plan işinden göreve taşınır ve birlikte izlenir (YG1146-ILISKI)', async () => {
    await o.dosyaAc(); const t = (await o.sup.query(`SELECT taraf_no FROM taraf LIMIT 1`)).rows[0].taraf_no; const bim = await o.gir('bim');
    const r = await o.ist('POST', `/api/taraf/${t}/pasif`, await o.gir('opm'), { pasif: true, gerekce: 'İzleme denemesi' }); expect(r.statusCode).toBe(200);
    const il = r.headers['x-iliski-kimligi'] as string;
    const v = (await o.ist('GET', `/api/iliski/${il}`, bim)).json();
    expect(v.islemler.map((x: { eylem: string }) => x.eylem)).toContain('Taraf Pasife Alındı');
    expect(v.degisiklikler.some((x: { tablo: string }) => x.tablo === 'taraf')).toBe(true);
    await o.ist('POST', `/api/taraf/${t}/pasif`, await o.gir('opm'), { pasif: false });
    const z = isZamanlayici(o.db, () => {});
    await z.tur('İzleme İşi', 'deneme', 60_000, () => [import('../src/is_motoru.js').then((m) => m.kartAc(o.db, { tur: 'Deneme Görevi', kategori: 'islem', baslik: 'İzleme', sahipKullanici: o.K.bim }))]);
    const is = (await o.sup.query(`SELECT iliski_kimligi FROM zamanlanmis_is_durumu WHERE ad = 'İzleme İşi'`)).rows[0].iliski_kimligi;
    expect(is).toMatch(/^is:/);
    expect((await o.ist('GET', `/api/iliski/${is}`, bim)).json().gorevler.map((x: { baslik: string }) => x.baslik)).toEqual(['İzleme']);
    expect((await o.ist('GET', `/api/iliski/${il}`, await o.gir('ds'))).statusCode).toBe(404);
  });
  it('role göre bildirim kuralı: tekrar, sessiz saat ve birleştirme; Kritik etkilenmez (YG510-KURAL)', async () => {
    expect(sessizSonu(new Date('2026-11-22T20:00:00Z'), '22:00', '08:00').toISOString()).toBe('2026-11-23T05:00:00.000Z');
    expect(sessizSonu(new Date('2026-11-22T02:00:00Z'), '22:00', '08:00').toISOString()).toBe('2026-11-22T05:00:00.000Z');
    expect(sessizSonu(new Date('2026-11-22T10:00:00Z'), '22:00', '08:00').toISOString()).toBe('2026-11-22T10:00:00.000Z');
    const bim = await o.gir('bim');
    expect((await o.ist('POST', '/api/bildirim-kurali', bim, { rol: 'Dosya Sorumlusu', sessizBaslangic: '25:00', sessizBitis: '08:00' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/bildirim-kurali', bim, { rol: 'Dosya Sorumlusu', tekrarDakika: 60, birlestir: true })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/bildirim-kurali', bim)).json().kurallar).toContainEqual({ rol: 'Dosya Sorumlusu', tekrar_dakika: 60, sessiz_baslangic: null, sessiz_bitis: null, birlestir: true });
    const say = async () => (await o.sup.query(`SELECT count(*)::int n, string_agg(metin, '|') m FROM gonderim WHERE kullanici_ref = $1 AND olay_anahtari LIKE 'yg510:%'`, [o.K.ds])).rows[0];
    await o.sup.query(`UPDATE kullanici_hesabi SET e_posta = 'ds510@ornek.com' WHERE kimlik = $1`, [o.K.ds]);
    await bildir(o.db, { olay: 'yg510:1', kullanicilar: [o.K.ds!], baslik: 'Rapor Hazır', eposta: true });
    await bildir(o.db, { olay: 'yg510:2', kullanicilar: [o.K.ds!], baslik: 'Rapor Hazır', eposta: true });
    expect((await say()).n).toBe(1); // tekrar süresi içinde aynı başlık dış kanaldan yeniden gitmez
    await bildir(o.db, { olay: 'yg510:3', kullanicilar: [o.K.ds!], baslik: 'Teklif Onaylandı', eposta: true });
    const s = await say(); expect(s.n).toBe(1); expect(s.m).toContain('Teklif Onaylandı'); // bekleyen iletiye birleşti
    await bildir(o.db, { olay: 'yg510:4', kullanicilar: [o.K.ds!], baslik: 'Rapor Hazır', eposta: true, oncelik: 'Kritik' });
    expect((await say()).n).toBe(2);
    expect((await o.ist('GET', '/api/bildirim-kurali', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('bildirim dosyaya ve kullanıcının görevine bağlanır; gizlemek görevi kapatmaz (YG509-BAG)', async () => {
    const d = await o.dosyaAc(); const ds = await o.gir('ds');
    const kart = await (await import('../src/is_motoru.js')).kartAc(o.db, { tur: 'Deneme Görevi', kategori: 'gorev', baslik: 'Bağ', sahipKullanici: o.K.ds, nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
    await bildir(o.db, { olay: `bag-deneme:${d.kimlik}`, kullanicilar: [o.K.ds!], baslik: 'Bağ Denemesi' });
    const b = (await o.ist('GET', '/api/bildirimler', ds)).json().find((x: { baslik: string }) => x.baslik === 'Bağ Denemesi');
    expect(b).toMatchObject({ dosya_no: d.dosyaNo, is_ref: kart, gorev_durumu: 'Bekliyor' });
    expect((await o.ist('POST', `/api/bildirim/${b.kimlik}/gizle`, ds, {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM is_karti WHERE kimlik = $1`, [kart])).rows[0].durum).toBe('Bekliyor');
  });
  it('görev türüne göre onay süresi, uyarı ve eskalasyon eşiği (YG536-ESIK)', async () => {
    expect(sureAdimi('Normal', 100, 240, 150)).toBe('Uyarı'); expect(sureAdimi('Normal', 100, 240)).toBeNull();
    const opm = await o.gir('opm');
    expect((await o.ist('POST', '/api/gorev-esigi', opm, { tur: 'Deneme Görevi', onaySureDk: 30, uyariOnceDk: 40, gerekce: 'x' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/gorev-esigi', opm, { tur: 'Eşik Görevi', eskalasyonSaat: 2, gerekce: 'Hızlı iş' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/gorev-esigi', opm)).json().esikler).toContainEqual({ tur: 'Eşik Görevi', onay_sure_dk: null, uyari_once_dk: null, eskalasyon_saat: 2, gerekce: 'Hızlı iş' });
    expect((await o.ist('GET', '/api/gorev-esigi', await o.gir('ds'))).statusCode).toBe(404);
    const simdi = new Date();
    const kart = await (await import('../src/is_motoru.js')).kartAc(o.db, { tur: 'Eşik Görevi', kategori: 'gorev', baslik: 'Eşik', sahipKullanici: o.K.ds, sonZaman: new Date(simdi.getTime() - 3 * 3_600_000) });
    await gorevSureIsle(o.db, simdi);
    expect((await o.sup.query(`SELECT anahtar FROM zamanlanmis_is WHERE ad = 'gorev-sure-e' AND anahtar = $1`, [kart])).rowCount).toBe(1); // 24 saat yerine 2 saat
  });
  it('hizmet hesabı envanteri; etkileşimli giriş kapalı; kullanılmayan hesap askıya alınır (YG1000-HIZMET)', async () => {
    const { parolaOzetle } = await import('../src/parola.js');
    const h = (await o.sup.query(`INSERT INTO kullanici_hesabi (ad_soyad, e_posta, hesap_turu, kullanici_grubu, kullanici_adi, dogrulama_yontemi, parola_ozeti, hesap_durumu) VALUES ('Banka Entegrasyonu', 'banka.entegrasyon@ornek.com', 'Hizmet hesabı', 'Sistem/Hizmet Hesabı', 'banka.entegrasyon', 'SMS kodu', $1, 'Aktif') RETURNING kimlik`, [await parolaOzetle('Hizmet-Parolasi-2026!')])).rows[0].kimlik;
    expect((await o.ist('POST', '/api/kimlik/giris', undefined, { kimlik: 'banka.entegrasyon@ornek.com', parola: 'Hizmet-Parolasi-2026!' })).statusCode).toBe(401);
    const bim = await o.gir('bim');
    expect((await o.ist('GET', '/api/hizmet-hesabi-envanteri', bim)).json().kayitsiz.map((x: { kimlik: string }) => x.kimlik)).toContain(h);
    const G = { hesap: h, sahipRol: 'Bilgi İşlem Müdürü', amac: 'Banka hareketi alımı', eristigiVeri: 'Banka hareketleri', anahtarTuru: 'Sertifika', anahtarBitis: '2027-06-30', kaynakAdres: '10.0.0.5', calismaZamani: 'Saatlik', kapanisYontemi: 'Sertifika iptali ve hesap kapatma' };
    expect((await o.ist('POST', '/api/hizmet-hesabi-envanteri', bim, { ...G, amac: '' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/hizmet-hesabi-envanteri', bim, { ...G, hesap: o.K.ds })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/hizmet-hesabi-envanteri', bim, G)).statusCode).toBe(200);
    await o.sup.query(`UPDATE hizmet_hesabi_envanteri SET olusturma_zamani = now() - interval '100 days' WHERE kullanici_ref = $1`, [h]);
    expect(await hizmetHesabiIsle(o.db)).toBe(1);
    expect((await o.sup.query(`SELECT hesap_durumu FROM kullanici_hesabi WHERE kimlik = $1`, [h])).rows[0].hesap_durumu).toBe('Askıda');
    expect((await o.ist('GET', '/api/hizmet-hesabi-envanteri', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('kapanan hesabın görevi Dosya Sorumlusuna, belge sorumluluğu devredilir; oluşturan değişmez (YG1054-DEVIR)', async () => {
    const d = await o.dosyaAc(); const { hesapKapanisDevri } = await import('../src/hesap_devri.js');
    const ds = o.K.ds; await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, ds]);
    const kart = await (await import('../src/is_motoru.js')).kartAc(o.db, { tur: 'Deneme Görevi', kategori: 'gorev', baslik: 'Devir', sahipKullanici: o.K.bim, nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
    const bel = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('k.pdf', 'Diğer', 'Kritik', 'Dosya', $1, 'Sistem', current_date, $2) RETURNING kimlik`, [d.kimlik, o.K.bim])).rows[0].kimlik;
    expect(await hesapKapanisDevri(o.db, o.K.bim!)).toBeGreaterThanOrEqual(2);
    expect((await o.sup.query(`SELECT sahip_kullanici_ref FROM is_karti WHERE kimlik = $1`, [kart])).rows[0].sahip_kullanici_ref).toBe(ds);
    expect((await o.sup.query(`SELECT sorumlu_ref, olusturan_ref FROM belge WHERE kimlik = $1`, [bel])).rows[0]).toEqual({ sorumlu_ref: ds, olusturan_ref: o.K.bim });
    expect((await o.sup.query(`SELECT 1 FROM belge_erisim_grubu WHERE belge_ref = $1 AND kullanici_ref = $2`, [bel, ds])).rowCount).toBe(1);
    expect((await o.sup.query(`SELECT count(*)::int n FROM hesap_kapanis_devri WHERE kullanici_ref = $1`, [o.K.bim])).rows[0].n).toBeGreaterThanOrEqual(2);
  });
  it('yazım düzeltmesi beyanı denetlenir; başka dosyanın numarası dış alıcıya gitmez (YG512-METIN)', async () => {
    const { yazimDuzeltmesiMi } = await import('../src/sablon_surum.js');
    expect(yazimDuzeltmesiMi('Teklifiniz {tarih} tarihine kadar geçerlidir.', 'Teklifiniz {tarih} tarihine kadar geçerlidir')).toBe(true);
    expect(yazimDuzeltmesiMi('Teklifiniz 30 gün geçerlidir.', 'Teklifiniz 15 gün geçerlidir.')).toBe(false);
    expect(yazimDuzeltmesiMi('Ödeme peşin yapılır.', 'Ödeme teslimden sonra yapılır.')).toBe(false);
    const { disMetinEngeli } = await import('../src/yetki_ek.js');
    const d = await o.dosyaAc(); const d2 = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'baska.taraf@ornek.com' WHERE kimlik = (SELECT kimlik FROM dosya_tarafi WHERE dosya_ref = $1 LIMIT 1)`, [d2.kimlik]);
    expect(await disMetinEngeli(o.db, { eposta: 'baska.taraf@ornek.com', konu: 'Bilgi', metin: `${d.dosyaNo} durumu` })).toBe('Başka dosyaya ait bilgi bu alıcıya gönderilemez.');
    expect(await disMetinEngeli(o.db, { eposta: 'baska.taraf@ornek.com', konu: 'Bilgi', metin: `${d2.dosyaNo} durumu` })).toBeNull();
    expect(await disMetinEngeli(o.db, { eposta: 'yabanci@ornek.com', konu: 'Bilgi', metin: 'LGM-2099-01-0001 durumu' })).toBeNull();
  });
  it('modül sahipliği rolle; devirde sahiplik, görev, onay ve izin yeni role geçer (YG998-DEVIR)', async () => {
    const opm = await o.gir('opm');
    expect((await o.ist('POST', '/api/sahiplik/devir', opm, { eskiRol: 'Operasyon Müdürü', yeniRol: 'Dosya Sorumlusu', gerekce: 'x' })).statusCode).toBe(404);
    await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = 'Genel Müdür Yardımcısı'`, [o.K.bim]);
    const g = await o.gir('bim');
    expect((await o.ist('POST', '/api/sahiplik/modul', g, { modul: 'Veri Kalitesi', sahipRol: 'Operasyon Müdürü' })).statusCode).toBe(200);
    const rid = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik;
    const opmR = await rid('Operasyon Müdürü'); const kmR = await rid('Kalite Müdürü');
    const kart = await (await import('../src/is_motoru.js')).kartAc(o.db, { tur: 'Deneme Görevi', kategori: 'gorev', baslik: 'Rol Görevi', sahipRol: opmR });
    const r = await o.ist('POST', '/api/sahiplik/devir', g, { eskiRol: 'Operasyon Müdürü', yeniRol: 'Kalite Müdürü', gerekce: 'Görev değişikliği', izinler: true });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().sayilar).toMatchObject({ modul: 1, gorev: expect.any(Number) });
    expect((await o.sup.query(`SELECT sahip_rol_ref FROM is_karti WHERE kimlik = $1`, [kart])).rows[0].sahip_rol_ref).toBe(kmR);
    expect((await o.sup.query(`SELECT count(*)::int n FROM veri_kumesi WHERE sahip_rol = 'Operasyon Müdürü'`)).rows[0].n).toBe(0);
    expect((await o.ist('GET', '/api/sahiplik', g)).json().moduller).toContainEqual({ modul: 'Veri Kalitesi', sahip: 'Kalite Müdürü' });
    { const sf = (await o.ist('GET', '/api/sahiplik', g)).json().sifatlar; expect(sf.sistemSahibi).toBe('Bilgi İşlem Müdürü'); expect(sf.surecSahipleri[0]).toEqual({ surec: 'Dosya süreci', sahip: 'Operasyon Müdürü' }); expect(sf.nobetciler).toHaveLength(3); expect(sf.veriSahipleri).toContainEqual({ veri: 'Tedarikçi Sicili', sahip: 'Tedarik Yönetimi Müdürü' }); } // YG-1011, YG-1028, YG-1015
  });
  it('dosya durum özeti: açık iş, onayın kimde olduğu, bekleme nedeni, eksikler ve sonraki işlem (YG539-OZET)', async () => {
    const d = await o.dosyaAc(); const opm = await o.gir('opm');
    await o.sup.query(`INSERT INTO beklemede_isareti (dosya_ref, neden, sorumlu_ref, hedef_tarih, durum_mesaji, sayac_durur, olusturan_ref) VALUES ($1, 'Yat sahibi kararı', $2, current_date + 5, 'Karar bekleniyor', false, $2)`, [d.kimlik, o.K.opm]);
    const r = await o.ist('GET', `/api/dosya/${d.kimlik}/durum-ozeti`, opm); expect(r.statusCode, r.body).toBe(200);
    const v = r.json();
    expect(v.durma.some((x: string) => x.startsWith('Beklemede: Yat sahibi kararı'))).toBe(true);
    expect(Array.isArray(v.isler) && Array.isArray(v.onaylar) && Array.isArray(v.eksik)).toBe(true);
    if (v.isler.length) expect(v.sonraki).not.toBeNull();
    expect((await o.ist('GET', '/api/dosya/00000000-0000-4000-8000-000000000000/durum-ozeti', opm)).statusCode).toBe(404);
  });
  it('taraf görevleri dayanak ve sınırla; bir kişi birden çok görev taşır; talebi ileten kendiliğinden (YG1071-GOREV)', async () => {
    const d = await o.dosyaAc(); const opm = await o.gir('opm');
    const v = (await o.ist('GET', `/api/dosya/${d.kimlik}/taraf-gorevleri`, opm)).json();
    const t = v.taraflar[0].kimlik;
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/taraf-gorevi`, opm, { taraf: t, gorev: 'Ödeme Yapan' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/taraf-gorevi`, opm, { taraf: t, gorev: 'Ödeme Yapan', dayanak: 'Şirket yetki belgesi', sinir: '10.000,00 EUR' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/taraf-gorevi`, opm, { taraf: t, gorev: 'Yatı Teslim Alan', dayanak: 'Vekâletname' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/taraf-gorevi`, opm, { taraf: t, gorev: 'Ödeme Yapan', dayanak: 'x' })).statusCode).toBe(409);
    const k = (await o.ist('GET', `/api/dosya/${d.kimlik}/taraf-gorevleri`, opm)).json().kayitlar.map((x: { gorev: string }) => x.gorev);
    expect(k).toEqual(expect.arrayContaining(['Ödeme Yapan', 'Yatı Teslim Alan']));
  });
  it('dosya bazlı süreli ek erişim Operasyon Müdürü onayıyla açılır, süre bitince düşer (YG995-EKYETKI)', async () => {
    const d = await o.dosyaAc(); const ds = await o.gir('ds'); const { dosyaErisimi } = await import('../src/dosya.js');
    const u = (await o.sup.query(`INSERT INTO kullanici_hesabi (ad_soyad, e_posta, hesap_turu, kullanici_grubu, kullanici_adi, dogrulama_yontemi) VALUES ('Ek Yetki Deneme', 'ek.yetki@ornek.com', 'Personel', 'LGM İç Rolü', 'ek.yetki', 'SMS kodu') RETURNING kimlik`)).rows[0].kimlik as string;
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$2)`, [d.kimlik, o.K.ds]);
    expect(await dosyaErisimi(o.db, u, d.kimlik)).toBe(false);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ek-yetki`, ds, { kullanici: u, gerekce: 'Denetim örneklemi', bitis: '2000-01-01' })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/ek-yetki`, ds, { kullanici: u, gerekce: 'Denetim örneklemi', bitis: new Date(Date.now() + 86_400_000).toISOString() }); expect(r.statusCode, r.body).toBe(200);
    expect(await dosyaErisimi(o.db, u, d.kimlik)).toBe(false); // onaylanmadan açılmaz
    const kart = await o.kart('Dosya Ek Erişim Onayı', r.json().kimlik);
    expect((await o.ist('POST', `/api/is/${kart.kimlik}/karar`, await o.gir('opm'), { karar: 'Onayla' })).statusCode).toBe(200);
    expect(await dosyaErisimi(o.db, u, d.kimlik)).toBe(true);
    await o.sup.query(`UPDATE dosya_ek_yetki SET olusturma_zamani = now() - interval '2 days', bitis = now() - interval '1 minute' WHERE kimlik = $1`, [r.json().kimlik]);
    expect(await dosyaErisimi(o.db, u, d.kimlik)).toBe(false);
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
    { // YG-106: Müşteri Ana Kaydı
      const a = await o.ist('GET', `/api/taraf/${t.taraf_no}/ana-kayit`, await o.gir('opm')); expect(a.statusCode, a.body).toBe(200);
      const v = a.json(); expect(v.kimlik.taraf_no).toBe(t.taraf_no); expect(v.kimlik.eposta).toBe('yeni@ornek.com'); expect(v.kimlik.kimlik).toBeUndefined();
      expect(typeof v.acikAlacakEur).toBe('number'); for (const k of ['faturalar', 'sozlesmeler', 'yetkiBelgeleri', 'yetkililer', 'yatlar', 'dosyalar']) expect(Array.isArray(v[k])).toBe(true);
      expect((await o.ist('GET', '/api/taraf/YOK-000/ana-kayit', await o.gir('opm'))).statusCode).toBe(404);
      { // YG-106: Yat Kullanım Takvimi
        const yat = (await o.sup.query(`SELECT kimlik FROM yat LIMIT 1`)).rows[0].kimlik; const opm = await o.gir('opm'); const u = `/api/yat/${yat}/kullanim-donemi`;
        expect((await o.ist('POST', u, opm, { tur: 'Tatil', baslangic: '2027-06-01', bitis: '2027-06-30' })).statusCode).toBe(400);
        expect((await o.ist('POST', u, opm, { tur: 'Kullanım', baslangic: '2027-06-30', bitis: '2027-06-01' })).statusCode).toBe(400);
        expect((await o.ist('POST', u, opm, { tur: 'Kiralama', baslangic: '2027-06-01', bitis: '2027-06-30', konum: 'Göcek' })).statusCode).toBe(200);
        const tk = (await o.ist('GET', `/api/yat/${yat}/kullanim-takvimi`, opm)).json(); expect(tk.donemler.some((x: any) => x.tur === 'Kiralama' && x.konum === 'Göcek')).toBe(true);
        expect(Array.isArray(tk.sistem)).toBe(true); expect(Array.isArray(tk.uyarilar)).toBe(true);
      }
    }
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
  it('5 günü aşan görev süresi son gün 12:00 biter, pazara düşerse pazartesi 12:00 olur; 5 güne kadar süre saatle kalır (YG1607-GUN)', async () => {
    const { gunSuresiBitis } = await import('../src/sure.js');
    const bas = new Date('2026-11-16T07:00:00Z'); // pazartesi 10:00
    expect(gunSuresiBitis(new Date('2026-11-23T07:00:00Z'), bas, 'Normal').bitis.toISOString()).toBe('2026-11-23T09:00:00.000Z'); // 7 gün: pazartesi 12:00
    const p = gunSuresiBitis(new Date('2026-11-22T07:00:00Z'), bas, 'Normal'); // 6 gün: pazar
    expect(p.bitis.toISOString()).toBe('2026-11-23T09:00:00.000Z'); expect(p.not).toContain('Pazartesi 12:00');
    expect(gunSuresiBitis(new Date('2026-11-19T07:00:00Z'), bas, 'Normal').bitis.toISOString()).toBe('2026-11-19T07:00:00.000Z'); // 3 gün: saatle
    expect(gunSuresiBitis(new Date('2026-11-22T07:00:00Z'), bas, 'Kritik').bitis.toISOString()).toBe('2026-11-22T07:00:00.000Z');
    const { kartAc } = await import('../src/is_motoru.js');
    const k = await kartAc(o.db, { tur: 'Süre Deneme', kategori: 'gorev', baslik: 'Süre Deneme', sahipRol: (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Kalite Müdürü'`)).rows[0].kimlik, sonZaman: new Date('2026-11-22T07:00:00Z'), simdi: bas });
    expect((await o.sup.query(`SELECT son_zaman, sure_notu FROM is_karti WHERE kimlik = $1`, [k])).rows[0].sure_notu).toContain('Kaydırıldı');
    await o.sup.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE kimlik = $1`, [k]);
  });
  it('durum geçişi önceki geçişten bu yana tamamlanan görevleri ve eklenen belgeleri kaydeder (YG061-KOSUL)', async () => {
    const d = await o.dosyaAc();
    const { kartAc } = await import('../src/is_motoru.js');
    const k = await kartAc(o.db, { tur: 'Ön Koşul Deneme', kategori: 'gorev', baslik: 'Ön Koşul Deneme', sahipKullanici: o.K.ds, nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
    await o.sup.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE kimlik = $1`, [k]);
    await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('Koşul Belgesi', 'Diğer', 'Kurumsal', 'Dosya', $1, 'Sistem', current_date, $2)`, [d.kimlik, o.K.ds]);
    const { statuYaz } = await import('../src/dosya.js');
    const s = (await o.sup.query(`SELECT kimlik, statu, asama FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0];
    await statuYaz(o.db, s, { statu: s.statu, asama: s.asama }, 'Koşul deneme', o.K.ds!);
    const g = (await o.ist('GET', `/api/dosya/${d.kimlik}`, await o.gir('ide'))).json().gecmis.at(-1); // İç Denetçi tüm dosyaları görür
    expect(g.tamamlanan_kosullar).toContain('Ön Koşul Deneme'); expect(g.belgeler).toContain('Koşul Belgesi');
  });
  it('arama yolları süzgeç kaydındadır; süzgeçsiz arama yolu eklenemez; dosya araması erişimle süzülür (YG1162-ARAMA)', async () => {
    const { ARAMA_SUZGECI, aramaYoluMu } = await import('../src/arama_suzgeci.js');
    expect(Object.keys(ARAMA_SUZGECI).every((u) => aramaYoluMu(u))).toBe(true);
    const Fastify = (await import('fastify')).default; const f = Fastify(); (await import('../src/arama_suzgeci.js')).aramaSuzgeciKancasi(f);
    expect(() => f.get('/api/gizli/ara', async () => [])).toThrow(/süzgeci/);
    const d = await o.dosyaAc();
    const ara = async (k: string) => (await o.ist('GET', `/api/ara?q=${encodeURIComponent(d.dosyaNo)}`, await o.gir(k))).json().dosyalar.map((x: { kimlik: string }) => x.kimlik);
    expect(await ara('ide')).toContain(d.kimlik); // İç Denetçi tüm dosyalar
    expect(await ara('tu')).not.toContain(d.kimlik); // ekipte olmayan Teknik Uzman
  });
  it('görev kartı ortak statü, Beklemede ve Gecikmiş işaretiyle gelir; unvan–rol eşleşmesi tutulur (YG058-ROZET, YG1017-UNVAN)', async () => {
    const d = await o.dosyaAc(); const { kartAc } = await import('../src/is_motoru.js');
    const k = await kartAc(o.db, { tur: 'Rozet Deneme', kategori: 'gorev', baslik: 'Rozet Deneme', sahipKullanici: o.K.ds, nesneTuru: 'Dosya', nesneKimligi: d.kimlik, sonZaman: new Date(Date.now() - 3_600_000) });
    await o.sup.query(`INSERT INTO beklemede_isareti (dosya_ref, neden, sorumlu_ref, hedef_tarih, sayac_durur, olusturan_ref) VALUES ($1,'Onay bekleniyor',$2,current_date + 3,false,$2)`, [d.kimlik, o.K.ds]);
    const l = (await o.ist('GET', '/api/bugun', await o.gir('ds'))).json();
    const x = [...l.onay, ...l.islem, ...l.gorev].find((z: { kimlik: string }) => z.kimlik === k);
    expect(x).toMatchObject({ ortak_statu: 'Açık', beklemede: true, gecikmis: true });
    await o.sup.query(`UPDATE beklemede_isareti SET kaldirilma_zamani = now() WHERE dosya_ref = $1`, [d.kimlik]);
    await o.sup.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE kimlik = $1`, [k]);
    const u = (await o.ist('GET', '/api/unvan-rol', await o.gir('opm'))).json();
    expect(u.find((r: { rol_adi: string }) => r.rol_adi === 'Kalite Uzmanı (Kalite Kontrolör)').unvan).toBe('Kalite Kontrolör');
    expect(u.find((r: { rol_adi: string }) => r.rol_adi === 'Teknik Yönetici')).toMatchObject({ kademe: 'Yönetici', birim: 'Teknik Müdürlük' });
  });
  it('arka plan işi kimlik, süre, sonuç ve etkilenen kayıtla izlenir; başlatana bitince bildirim gider (YG1354-ISKAYDI)', async () => {
    const { arkaPlanIsi } = await import('../src/zamanlayici.js');
    const z = isZamanlayici(o.db, () => {});
    await z.tur('Deneme Etkili', 'Rapor', 60_000, () => [Promise.resolve(3), Promise.resolve([1, 2])]);
    await z.tur('Deneme Etkisiz', 'Rapor', 60_000, () => [Promise.resolve(0)]);
    const l = (await o.sup.query(`SELECT tur, sonuc, etkilenen_kayit, bitis IS NOT NULL bitti FROM arka_plan_isi WHERE tur LIKE 'Deneme Etki%'`)).rows;
    expect(l).toEqual([{ tur: 'Deneme Etkili', sonuc: 'Tamamlandı', etkilenen_kayit: 5, bitti: true }]);
    const r = await arkaPlanIsi(o.db, { tur: 'Toplu Deneme', baslatan: o.K.bim }, async () => 7);
    expect(r).toMatchObject({ sonuc: 'Tamamlandı', etkilenen: 7 });
    await expect(arkaPlanIsi(o.db, { tur: 'Hatalı Deneme', baslatan: o.K.bim }, async () => { throw new Error('Bozuk satır'); })).rejects.toThrow('Bozuk satır');
    expect((await o.sup.query(`SELECT baslik FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE 'İşlem Tamam%' ORDER BY zaman`, [o.K.bim])).rows.map((x) => x.baslik)).toEqual(['İşlem Tamamlandı: Toplu Deneme', 'İşlem Tamamlanamadı: Hatalı Deneme']);
    const a = (await o.ist('GET', '/api/arka-plan-isleri', await o.gir('bim'))).json();
    expect(a.find((x: { tur: string }) => x.tur === 'Hatalı Deneme')).toMatchObject({ sonuc: 'Hata', hata: 'Bozuk satır' });
    expect((await o.ist('GET', '/api/arka-plan-isleri', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('kural veya parametre değişikliği öz denetimi bekletir; çalışmadan sonra beklemez (YG1652-TETIK)', async () => {
    const { kuralDegisikligiBekliyor } = await import('../src/oz_denetim.js');
    await o.sup.query(`INSERT INTO oz_denetim_calismasi (calisma_no, tur) VALUES ('ODN-T-1', 'Zamanlanmış')`);
    await o.sup.query(`UPDATE oz_denetim_calismasi SET sonuc = 'Başarılı', bitis = now() WHERE calisma_no = 'ODN-T-1'`);
    expect(await kuralDegisikligiBekliyor(o.db)).toBe(false);
    await o.sup.query(`UPDATE sistem_parametresi SET deger = deger WHERE kod = 'arama_oneri_azami'`); // değer aynı: değişiklik sayılmaz
    expect(await kuralDegisikligiBekliyor(o.db)).toBe(false);
    const e = (await o.sup.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'arama_oneri_azami'`)).rows[0].deger;
    await o.sup.query(`UPDATE sistem_parametresi SET deger = '11' WHERE kod = 'arama_oneri_azami'`);
    expect(await kuralDegisikligiBekliyor(o.db)).toBe(true);
    await o.sup.query(`UPDATE sistem_parametresi SET deger = $1 WHERE kod = 'arama_oneri_azami'`, [e]);
    await o.sup.query(`INSERT INTO oz_denetim_calismasi (calisma_no, tur, sonuc, bitis) VALUES ('ODN-T-2', 'Kural Değişikliği', 'Başarılı', now())`);
    expect(await kuralDegisikligiBekliyor(o.db)).toBe(false);
  });
  it('ekran etiketlerinde her kelimenin baş harfi büyüktür (YG671-ETIKET)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs'); const { join } = await import('node:path');
    const kok = join(process.cwd(), '..', 'web', 'src'); const KUCUK = new Set(['ve', 'ile', 'veya', 'ya', 'da', 'de', 'için', 'ki', 'mi', 'mı', 'mu', 'mü', 'vb']);
    const hatali: string[] = [];
    for (const f of readdirSync(kok).filter((x) => x.endsWith('.tsx'))) for (const m of readFileSync(join(kok, f), 'utf8').matchAll(/<label[^>]*>([^<{]+)<\/label>/g)) {
      const s = m[1]!.replace(/\([^)]*\)/g, ' '); // parantez içi açıklama cümle düzeninde kalır
      if (s.split(/[\s/–]+/).map((w) => w.replace(/^[(),:;.?]+|[(),:;.?]+$/g, '')).some((w) => w && !KUCUK.has(w) && /^\p{Ll}/u.test(w))) hatali.push(`${f}: ${m[1]!.trim()}`);
    }
    expect(hatali).toEqual([]);
  });
  it('planlanan işlem zamanı geldi diye tamamlanmış sayılmaz (YG540-PLAN)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs'); const { join } = await import('node:path');
    const kok = join(process.cwd(), 'src'); const bulgu: string[] = [];
    for (const f of readdirSync(kok).filter((x) => x.endsWith('.ts'))) for (const m of readFileSync(join(kok, f), 'utf8').matchAll(/SET (?:durum|statu|sonuc) = '(?:Tamamlandı|Yapıldı|Gerçekleşti|Kapandı)'[^`]*?WHERE[^`]*?(?:<=? now\(\)|<=? current_date)/g)) bulgu.push(`${f}: ${m[0].slice(0, 80)}`);
    expect(bulgu).toEqual([]);
  });
  it('gerekçe ve açıklamada anlamsız metin reddedilir (YG1375-ANLAMSIZ)', async () => {
    const { anlamsizMetin } = await import('../src/anlamsiz_metin.js');
    for (const x of ['xxx', '...', '---', 'test', 'Deneme', 'aaaa', '?!']) expect(anlamsizMetin(x), x).toBe(true);
    for (const x of ['x', 'G', 'Ölçüm', 'Sızıntı kesildi', '3 gün']) expect(anlamsizMetin(x), x).toBe(false);
    const d = await o.dosyaAc(); const r = await o.ist('POST', `/api/dosya/${d.kimlik}/is-durdur`, await o.gir('ds'), { neden: 'Gaz', gerekce: 'xxx' });
    expect(r.json().hata).toContain('anlamlı');
  });
  it('giden ileti dosya numarasından dosyaya bağlanır ve dosya yazışmalarında görünür (YG1601-YAZISMA)', async () => {
    const d = await o.dosyaAc(); const { disGonder } = await import('../src/bildirim.js');
    await disGonder(o.db, { olay: 'tahsilat-hatirlatma:deneme', eposta: 'muhasebe@ornek-musteri.local', konu: `${d.dosyaNo} · Ödeme Hatırlatması`, metin: 'Ödeme bekleniyor.' });
    const l = (await o.ist('GET', `/api/dosya/${d.kimlik}/yazismalar`, await o.gir('ide'))).json();
    expect(l.map((x: { konu: string }) => x.konu)).toContain(`${d.dosyaNo} · Ödeme Hatırlatması`);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/yazismalar`, await o.gir('tu'))).statusCode).toBe(404);
  });
  it('dosya yazışması: dış taraf yalnız kendi başlığını görür, LGM rolle görünür; tehlike ifadesi Kritik; yanıt görevi; öncelik düşürme onaylı (YG1663-YAZISMA)', async () => {
    const d = await o.dosyaAc(); await o.ata(d.kimlik, 'ds', 'Dosya Sorumlusu', 'opm'); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2, oncelik = 'Normal' WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    await o.sup.query(`UPDATE kullanici_hesabi SET kullanici_grubu = 'Bireysel Müşteri (Yat Sahibi/Yetkilisi)' WHERE kimlik = ANY($1)`, [[o.K.ys, o.K.ys2]]);
    await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT unnest($1::text[]), 'Müşteri', 'KVKK-01', 'R00', 'Türkçe', 'Web'`, [[o.K.ys, o.K.ys2]]);
    await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, kullanici_ref, olusturan_ref) VALUES ($1,'Yetkili Temsilci','Temsilci A',$2,$4), ($1,'Kaptan','Kaptan B',$3,$4)`, [d.kimlik, o.K.ys, o.K.ys2, o.K.ds]);
    const ys = await o.gir('ys'), ys2 = await o.gir('ys2'), ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/yazisma`;
    const r1 = await o.ist("POST", u, ys, { metin: "Teslim tarihi nedir?" }); const m1 = r1.json(); expect(m1.oncelik, r1.body).toBe("Normal");
    expect((await o.kart('Mesaj Yanıtı', m1.kimlik)).sahip_kullanici_ref).toBe(o.K.ds);
    const m2 = await o.ist('POST', u, ys2, { metin: 'Yat su alıyor, acil!' }); expect(m2.json().oncelik).toBe('Kritik');
    expect((await o.ist('GET', u, ys)).json().mesajlar.map((x: { metin: string }) => x.metin)).toEqual(['Teslim tarihi nedir?']);
    expect((await o.ist('POST', u, await o.gir('tu'), { metin: 'x', taraf: o.K.ys })).statusCode).toBe(404);
    expect((await o.ist('POST', u, ds, { metin: 'x', taraf: o.K.tu })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { metin: 'Cuma teslim edilecektir.', taraf: o.K.ys })).statusCode).toBe(200);
    expect((await o.kart('Mesaj Yanıtı', m1.kimlik)).durum).toBe('Tamamlandı');
    const g = (await o.ist('GET', u, ys)).json().mesajlar; expect(g.at(-1).gonderen).toBe('Dosya Sorumlusu'); expect(JSON.stringify(g)).not.toContain('Yat su alıyor');
    const lg = (await o.ist('GET', u, ds)).json(); expect(lg.yanitBekleyen).toBe(1); expect(lg.taraflar.length).toBe((await o.sup.query(`SELECT count(*)::int n FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif AND kullanici_ref IS NOT NULL`, [d.kimlik])).rows[0].n); // YG-1757: açılışta yat sahibi hesabı da taraftır
    await o.ist('POST', u, ds, { metin: 'Fotoğraf iletebilir misiniz?', taraf: o.K.ys });
    const pa = await o.ist('GET', '/api/portal/ana', ys); // YG1565-ADIM
    expect(pa.json().dosyalar?.find((x: { kimlik: string }) => x.kimlik === d.kimlik)?.sonrakiAdim, pa.body).toContain('mesajınız');
    const pu = `/api/dosya-yazismasi/${m2.json().kimlik}/oncelik`;
    expect((await o.ist('POST', pu, ds, { oncelik: 'Normal' })).statusCode).toBe(400);
    expect((await o.ist('POST', pu, ds, { oncelik: 'Normal', gerekce: 'Yanlış alarm, teyit edildi' })).json().makam).toBe('Operasyon Müdürü');
    expect((await o.sup.query(`SELECT oncelik, bekleyen_oncelik FROM dosya_yazismasi WHERE kimlik = $1`, [m2.json().kimlik])).rows[0]).toEqual({ oncelik: 'Kritik', bekleyen_oncelik: 'Normal' });
    await expect(o.db.query(`DELETE FROM dosya_yazismasi WHERE kimlik = $1`, [m1.kimlik])).rejects.toThrow(); await expect(o.db.query(`UPDATE dosya_yazismasi SET metin = 'x' WHERE kimlik = $1`, [m1.kimlik])).rejects.toThrow();
  });
});

describe('YG-025 eksik alan tamamlama görevleri', () => {
  it('açılışta eksik her alan için sorumlu ve hedef tarihli ayrı görev açılır', async () => {
    const { dosyaEksikleri } = await import('../src/dosya.js');
    const d = await o.dosyaAc();
    const eksik = await dosyaEksikleri(o.db, d.kimlik);
    const k = (await o.sup.query(`SELECT baslik, son_zaman, sahip_kullanici_ref FROM is_karti WHERE tur = 'Eksik Dosya Bilgisi' AND nesne_kimligi = $1 ORDER BY baslik`, [d.kimlik])).rows;
    expect(k.length).toBe(eksik.length);
    for (const x of k) { expect(x.son_zaman).not.toBeNull(); expect(x.sahip_kullanici_ref).toBeTruthy(); }
    const yat = (await o.sup.query(`SELECT y.yat_sahibi_ref FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [d.kimlik])).rows[0].yat_sahibi_ref;
    if (yat) { await o.sup.query(`UPDATE taraf SET telefon = NULL WHERE kimlik = $1`, [yat]); expect(await dosyaEksikleri(o.db, d.kimlik)).toContain('Yat sahibi telefonu'); }
  });
});
