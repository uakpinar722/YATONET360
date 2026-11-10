import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usulsuzlukTara } from '../src/usulsuzluk.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', idm: 'İç Denetim Müdürü', sy: 'Sistem Yöneticisi', tid: 'Ticari İşler Direktörü', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', hud: 'Hukuk ve Uyum Direktörü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test87', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('entegrasyon tanımı ve askı (YG-1296, YG-1306)', () => {
  it('onaysız üretime açılmaz; askı gerekçeli; ölçütle yeniden açılır', async () => {
    const { entegrasyonAcik } = await import('../src/entegrasyon.js'); const sy = await o.gir('sy');
    const G = { ad: 'e-Arşiv Fatura', gonderen: 'YATONET 360', alan: 'Muhasebe Yazılımı', kayitSahibi: 'Muhasebe ve Finans Müdürü', tetikleyici: 'Proforma onayı', siklik: 'Anlık', bilgiSinifi: 'Gizli', hataSorumlusu: 'Bilgi İşlem Müdürü', hizmetBeklentisi: '15 dakika', amac: 'Fatura düzenleme' };
    expect((await o.ist('POST', '/api/entegrasyon', await o.gir('ds'), G)).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/entegrasyon', sy, { ...G, amac: '' })).statusCode).toBe(400);
    const e = (await o.ist('POST', '/api/entegrasyon', sy, G)).json().kimlik as string; expect(await entegrasyonAcik(o.db, 'e-Arşiv Fatura')).toBe(false);
    const k = (await o.kart('Entegrasyon Üretime Açma Onayı', e)).kimlik; expect((await o.karar(k, 'btd', 'Onaya Gönder')).statusCode).toBe(200); expect((await o.karar(k, 'hud', 'Onayla')).statusCode).toBe(200);
    expect(await entegrasyonAcik(o.db, 'e-Arşiv Fatura')).toBe(true);
    const A = { neden: 'Güvenlik Olayı', aciklama: 'Anahtar sızıntısı şüphesi', etkilenen: 'Fatura gönderimi', geciciYontem: 'Elle yükleme', kullaniciBildirimi: 'Muhasebe bilgilendirildi', olcut: 'Anahtar yenilendi' };
    expect((await o.ist('POST', `/api/entegrasyon/${e}/askiya-al`, sy, { ...A, olcut: '' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/entegrasyon/${e}/askiya-al`, sy, A)).statusCode).toBe(200); expect(await entegrasyonAcik(o.db, 'e-Arşiv Fatura')).toBe(false);
    expect((await o.ist('POST', `/api/entegrasyon/${e}/yeniden-ac`, sy, { olcutKarsilandi: true, gerekce: 'G' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/entegrasyon/${e}/yeniden-ac`, await o.gir('btd'), { olcutKarsilandi: true, gerekce: 'Anahtar yenilendi, test edildi' })).statusCode).toBe(200);
    expect(await entegrasyonAcik(o.db, 'e-Arşiv Fatura')).toBe(true);
    const { entegrasyonSonucu, uzlastir } = await import('../src/entegrasyon_uzlastirma.js'); // YG-1311, YG-1312
    await entegrasyonSonucu(o.db, { entegrasyon: e, disKimlik: 'F-1', beklenen: 'Fatura no dosyaya yazılır', sonucRef: 'F-1' });
    const q = await entegrasyonSonucu(o.db, { entegrasyon: e, disKimlik: 'F-2', beklenen: 'Fatura no dosyaya yazılır' });
    await entegrasyonSonucu(o.db, { entegrasyon: e, disKimlik: 'F-1', beklenen: 'Fatura no dosyaya yazılır', sonucRef: 'F-1' });
    expect(Number((await o.sup.query(`SELECT count(*) n FROM entegrasyon_kaydi WHERE entegrasyon_ref = $1 AND durum = 'Karantina'`, [e])).rows[0].n)).toBe(2);
    expect((await o.kart('Entegrasyon Uzlaştırma', q)).sahip_rol_ref).toBeTruthy();
    expect((await o.ist('POST', `/api/entegrasyon/kayit/${q}/uzlastir`, sy, { karar: 'Sistem Kaydı Doğru' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/entegrasyon/kayit/${q}/uzlastir`, sy, { karar: 'Elle Düzeltildi', gerekce: 'Fatura muhasebeden teyit edildi', sonucRef: 'F-2' })).statusCode).toBe(200);
    await o.sup.query(`UPDATE entegrasyon_kaydi SET donem = '2026-11', kritik_deger = 100 WHERE entegrasyon_ref = $1 AND durum <> 'Karantina'`, [e]);
    const u = await uzlastir(o.db, { entegrasyon: e, donem: '2026-11', karsi: [{ disKimlik: 'F-1', deger: 100, durum: 'Kesildi' }, { disKimlik: 'F-3', deger: 50, durum: 'Kesildi' }], yapan: o.K.sy! });
    expect(u.farklar.map((f) => f.tur).sort()).toEqual(['Dönem Toplamı', 'Kimlik', 'Kimlik']);
    expect(Number((await o.sup.query(`SELECT count(*) n FROM is_karti WHERE tur = 'Entegrasyon Farkı' AND durum = 'Bekliyor'`)).rows[0].n)).toBe(3);
  });
});

describe('kurumsal aylık filo ve cari hesap raporu (YG-765)', () => {
  it('ay başında kesilir, TİD onayıyla BLD-31 gider, itiraz süresi izlenir', async () => {
    const tr = (await o.sup.query(`INSERT INTO taraf (taraf_no, kisi_turu, musteri_turu, unvan_ad_soyad, taraf_rolleri, olusturan_ref) VALUES ('TR-KR1','Tüzel kişi','Kurumsal Müşteri','Filo Kurum A.Ş.','{Yat Sahibi}',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const k = (await o.sup.query(`INSERT INTO kurumsal_kurum (taraf_ref, unvan, ek2_onay_siniri, kaydeden_ref) VALUES ($1,'Filo Kurum A.Ş.',100,$2) RETURNING kimlik`, [tr, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO kurumsal_kullanici (kullanici_ref, kurum_ref, rol, onay_siniri, yetkili, ekleyen_ref) VALUES ($1,$2,'Onaylayan',100,true,$3)`, [o.K.idm, k, o.K.ds]);
    const { kurumsalRaporIsle } = await import('../src/kurumsal_rapor.js');
    expect(await kurumsalRaporIsle(o.db, new Date('2026-12-01T08:00:00'))).toBeGreaterThanOrEqual(1);
    const r = (await o.sup.query(`SELECT kimlik, durum, son_gonderim FROM kurumsal_rapor WHERE kurum_ref = $1 AND donem = '2026-11'`, [k])).rows[0]; expect(r.durum).toBe('TİD Onayında');
    expect((await o.karar((await o.kart('Kurumsal Aylık Rapor Onayı', r.kimlik)).kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM gonderim WHERE olay_anahtari LIKE $1`, [`bld31:${r.kimlik}:%`])).rows[0].n).toBeGreaterThanOrEqual(1);
    const km = await o.gir('idm'); const f = (await o.ist('GET', '/api/kurumsal/filo', km)).json(); expect(f.raporlar[0].durum).toBe('Gönderildi');
    expect((await o.ist('GET', '/api/kurumsal/filo', await o.gir('oy'))).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/kurumsal/rapor/${r.kimlik}/itiraz`, km, { itiraz: 'Fatura F1 tutarı' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/kurumsal/rapor/${r.kimlik}/itiraz`, km, { itiraz: 'Tekrar' })).statusCode).toBe(409);
  });
});

describe('yönetim panosu (YG-758, YG-759)', () => {
  it('Müdür kendi birimini, Direktör bağlı birimlerini görür; personel göremez', async () => {
    await o.dosyaAc();
    expect((await o.ist('GET', '/api/yonetim-panosu', await o.gir('ds'))).statusCode).toBe(404);
    const op = (await o.ist('GET', '/api/yonetim-panosu', await o.gir('opm'))).json(); expect(op.kapsam).toEqual(['Operasyon Müdürlüğü']);
    expect(op.gostergeler.find((x: { kod: string }) => x.kod === 'acik').deger).toBeGreaterThan(0); expect(op.gostergeler.some((x: { kod: string }) => x.kod === 'tahsilat')).toBe(false);
    const ti = (await o.ist('GET', '/api/yonetim-panosu', await o.gir('tid'))).json(); expect(ti.gostergeler.map((x: { kod: string }) => x.kod)).toEqual(['tahsilat']);
  });
});

describe('RP-TIC-002 aylık yönetim raporu (YG-761)', () => {
  it('faturalanmamış iş, tahsil edilmemiş fatura ve firmaya ödenmemiş bakiye', async () => {
    const d = await o.dosyaAc();
    const tk = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, karar_zamani, ara_toplam_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,'Karar','Tam Onay','2026-10-05',1000,1200,1000,$3) RETURNING kimlik`, [`${d.dosyaNo}-TK01`, d.kimlik, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, onay_durumu) VALUES ($1,1,'A','Onarım','İşçilik',1,'saat',700,1000,1000,'Onaylandı')`, [tk]);
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-YR1','Rapor Firma','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const ie = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref, olusturma_zamani) VALUES ($1,'ON',$2,$3,'Y','K','Aktif',$4,'2026-10-06') RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.oy])).rows[0].kimlik;
    const fa = (await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, fatura_no, fatura_tarihi, vade, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',400,80,480,'Kısmi Tahsil','F-YR1','2026-10-10','2026-10-20',$4) RETURNING kimlik`, [`${d.dosyaNo}-PF01`, d.kimlik, tk, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO tahsilat (fatura_ref, dosya_ref, tutar_eur, tarih, kanal, giren_ref) VALUES ($1,$2,180,'2026-10-15','Havale',$3)`, [fa, d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO hakedis (hakedis_no, is_emri_ref, dosya_ref, sira_no, bu_donem_brut, kumulatif, net, statu, giren_ref, olusturma_zamani) VALUES ($1,$2,$3,1,300,300,250,'Doğrulandı',$4,'2026-10-12')`, [`${d.dosyaNo}-HK01`, ie, d.kimlik, o.K.oy]);
    expect((await o.ist('GET', '/api/yonetim-raporu?donem=2026-10', await o.gir('ds'))).statusCode).toBe(404);
    const r = (await o.ist('GET', '/api/yonetim-raporu?donem=2026-10', await o.gir('tid'))).json();
    expect(r.toplam).toEqual({ wip: 600, tahsil: 300, firma: 250 });
    expect(r.tahsil[0].gecikme).toBe(11);
    const { nakitTahmini, sigortaciKarlilik } = await import('../src/nakit_karlilik.js'); // YG-762
    const h = await nakitTahmini(o.db, new Date('2026-11-10T09:00:00Z')); expect(h.length).toBe(13);
    expect(h[0]).toMatchObject({ baslangic: '2026-11-09', giris: 480 }); expect(h[2]!.cikis).toBe(250); expect(h[12]!.kumulatif).toBe(230);
    await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi, olusturan_ref) VALUES ($1,'Anadolu Sigorta',$2)`, [d.kimlik, o.K.ds]);
    expect(await sigortaciKarlilik(o.db, new Date('2026-11-10T09:00:00Z'))).toEqual([{ sigortaci_adi: 'Anadolu Anonim Türk Sigorta Şirketi', dosya: 1, satis: '1000.00', maliyet: '700.00', katki: '300.00', oran: '30.0' }]);
  });
});

describe('gerçek geri yükleme (YG-564, YG-015)', () => {
  it('Sistem Yöneticisi kaydeder; LGM duyurusu ve yeniden giriş görevleri açılır', async () => {
    const d = await o.dosyaAc(); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const yd = (await o.sup.query(`INSERT INTO yedek_kaydi (tur, bitis, durum) VALUES ('Gece Tam', now() - interval '3 hours', 'Başarılı') RETURNING kimlik`)).rows[0].kimlik as string;
    expect((await o.ist('POST', '/api/geri-yukleme/kayit', await o.gir('oy'), { yedek: yd, aciklama: 'Disk arızası' })).statusCode).toBe(404);
    const sy = await o.gir('sy'); expect((await o.ist('POST', '/api/geri-yukleme/kayit', sy, { yedek: yd })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/geri-yukleme/kayit', sy, { yedek: yd, aciklama: 'Disk arızası' }); expect(r.statusCode, r.body).toBe(200); expect(r.json().gorev).toBeGreaterThanOrEqual(2);
    expect((await o.sup.query(`SELECT zorunlu, kapsam FROM duyuru WHERE baslik LIKE 'Sistem Geri Yüklendi%'`)).rows).toEqual([{ zorunlu: true, kapsam: 'LGM' }]);
    expect(Number((await o.sup.query(`SELECT count(*) n FROM is_karti WHERE tur = 'Geri Yükleme Sonrası Yeniden Giriş' AND sahip_kullanici_ref = $1`, [o.K.ds])).rows[0].n)).toBeGreaterThanOrEqual(1);
  });
});

describe('iç usulsüzlük uyarıları (YG-768)', () => {
  it('personel–firma eşleşmesi ve limit altı tutarlar İç Denetim Müdürüne bir kez düşer', async () => {
    const d = await o.dosyaAc();
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-US1','Eşleşme Firma','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    for (let i = 1; i <= 5; i++) await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Y','K','Aktif',$4)`, [`${d.dosyaNo}-ON0${i}`, d.kimlik, f, o.K.oy]);
    for (let i = 0; i < 3; i++) await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, hazirlayan_ref, zincir, tutar_eur) VALUES ('Fiyat Teklifi','onay','T',$1,ARRAY[(SELECT kimlik FROM rol WHERE rol_adi = 'CEO')],$2)`, [o.K.ds, 4800 + i * 50]);
    const simdi = new Date(Date.now() + 60_000);
    expect(await usulsuzlukTara(o.db, simdi)).toBe(2); expect(await usulsuzlukTara(o.db, simdi)).toBe(0);
    const l = (await o.sup.query(`SELECT baslik, sahip_rol_ref FROM is_karti WHERE tur = 'İç Usulsüzlük Uyarısı' ORDER BY baslik`)).rows;
    expect(l.map((x) => x.baslik.split(':')[0])).toEqual(['Onay Limitinin Hemen Altında Tutarlar', 'Personel–Firma Eşleşmesi']);
    expect(new Set(l.map((x) => x.sahip_rol_ref)).size).toBe(1);
  });
});
