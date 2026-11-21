import { COOKIE_ADI } from '../src/ayarlar.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { araOdemeHesapla, caymaIsle, caymaSureIsle, kurtarmaTanim, teslimBakiyesi } from '../src/kalan.js';
import { teslimEngeli } from '../src/ticari.js';
import { isGunuSonu } from '../src/teklif.js';
import { ortamKur, type Ortam } from './yardimci.js';
import { ozet as hashOzet } from '../src/kripto.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', tid: 'Ticari İşler Direktörü', mfm: 'Muhasebe ve Finans Müdürü', hud: 'Hukuk ve Uyum Direktörü', sc: 'Sicil Sorumlusu', iks: 'İnsan Kaynakları Sorumlusu', sy: 'Sistem Yöneticisi', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü', ikm: 'İnsan Kaynakları Müdürü', gmy: 'Genel Müdür Yardımcısı', huu: 'Hukuk ve Uyum Uzmanı', tod: 'Teknik ve Operasyon Direktörü', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', bim: 'Bilgi İşlem Müdürü', ss: 'Saha Sorumlusu', ceo1: 'CEO' };
let o: Ortam; let n = 0;
beforeAll(async () => { o = await ortamKur('yatonet360_test54', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('avans ve ara ödeme (YG-906)', () => {
  it('dilim formülü: dilim − avans × dilim / toplam', () => {
    expect(araOdemeHesapla({ toplam: 15000, avans: 0, ilerleme: 50, onceki: 0 })).toBe(0);
    expect(araOdemeHesapla({ toplam: 60000, avans: 30000, ilerleme: 40, onceki: 0 })).toBe(10000);
    expect(araOdemeHesapla({ toplam: 60000, avans: 30000, ilerleme: 70, onceki: 10000 })).toBe(10000);
    expect(araOdemeHesapla({ toplam: 60000, avans: 30000, ilerleme: 30, onceki: 0 })).toBe(0);
    expect(teslimBakiyesi(10000, 5000)).toBe(5000);
  });
});

describe('iş günü (YG-1472)', () => {
  it('Cumartesi iş günü, Pazar değil', async () => {
    const r = await isGunuSonu(o.db, new Date('2027-02-05T09:00:00Z'), 2); expect(r.toISOString().slice(0, 10)).toBe('2027-02-08');
    // TAT-1: 8 Mart 2027 arife (yarım gün), 9–11 Mart Ramazan Bayramı
    expect((await isGunuSonu(o.db, new Date('2027-03-05T09:00:00Z'), 2)).toISOString().slice(0, 10)).toBe('2027-03-12');
  });
});

describe('teslim (YG-087)', () => {
  it('kurumsalda yalnız vadesi gelen tutar engeller', async () => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET musteri_turu = 'Kurumsal Müşteri' WHERE kimlik = $1`, [d.kimlik]);
    const f = (await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, vade, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',100,20,120,'Faturalandı','2099-01-01',$3) RETURNING kimlik`, [`PF-${++n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
    expect(await teslimEngeli(o.db, d.kimlik)).toBeNull();
    await o.sup.query(`UPDATE musteri_faturasi SET vade = '2020-01-01' WHERE kimlik = $1`, [f]);
    expect(await teslimEngeli(o.db, d.kimlik)).toContain('Ödeme bekleniyor');
  });
});

describe('kurtarma sözleşmesi (YG-590, YG-620, YG-694)', () => {
  it('fiyat yok, LGM ayrıca iletir, koordinatör imzası', async () => {
    const d = await o.dosyaAc({}, {}); const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-KR','Sağlayıcı A','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const k = (await o.sup.query(`INSERT INTO kurtarma_operasyonu (dosya_ref, hizmet_turu, saglayici_ref, hazirlayan_ref) VALUES ($1,'Kurtarma',$2,$3) RETURNING kimlik`, [d.kimlik, f, o.K.ds])).rows[0].kimlik;
    const v = await kurtarmaTanim(o.db, k, 'ABC'); const m = JSON.stringify(v.t);
    expect(m).toContain('Sağlayıcı A'); expect(m).toContain('LGM tarafından ayrıca iletilir'); expect(m).toContain('Hizmetin Koordinasyonu'); expect(m).not.toMatch(/\d[\d.,]* EUR/);
  });
});

describe('cayma (YG-1450, YG-1493)', () => {
  it('iade: Ticari Sorumlu hesaplar, TİD onaylar, MFM öder; süre uyarısı', async () => {
    const d = await o.dosyaAc({}, {});
    const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, hazirlayan_ref) VALUES ($1,$2,'Onarım','Yat Sahibi',20,$3) RETURNING kimlik`, [`T-${++n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
    const k = (await o.sup.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis) VALUES ($1,$2,now(),now(),now() + interval '14 days') RETURNING kimlik`, [t, d.kimlik])).rows[0].kimlik;
    expect(await caymaIsle(o.db, k, 'YATONET 360')).toBe(true); expect(await caymaIsle(o.db, k, 'YATONET 360')).toBe(false);
    expect((await o.kart('Cayma İade Hesabı', k)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/cayma/${k}/iade-hesabi`, await o.gir('ds'), { tutar: 10 })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/cayma/${k}/iade-hesabi`, await o.gir('ts'), { tutar: 100 })).json().durum).toBe('Onayda');
    const c = await o.kart('Cayma İadesi', k); expect((await o.karar(c.kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/cayma/${k}/iade-odendi`, await o.gir('ts'), {})).statusCode).toBe(403);
    await o.sup.query(`UPDATE on_bilgilendirme_cayma_kaydi SET iade_son_tarihi = current_date + 1 WHERE kimlik = $1`, [k]); expect(await caymaSureIsle(o.db)).toBeGreaterThan(0);
    expect((await o.ist('POST', `/api/cayma/${k}/iade-odendi`, await o.gir('mfm'), {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT iade_durumu FROM on_bilgilendirme_cayma_kaydi WHERE kimlik = $1`, [k])).rows[0].iade_durumu).toBe('Ödendi');
  });
});

describe('yat sahibi cayma düğmesi (YG-1450)', () => {
  it('yalnız yat sahibi açar; ONY-18 onayı cayma ve iade görevi doğurur', async () => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya_tarafi SET kullanici_ref = $2 WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik, o.K.iks]);
    await o.sup.query(`UPDATE kullanici_hesabi SET kullanici_grubu = 'Kurumsal Müşteri', izin_adimi_zamani = now() WHERE kimlik = $1`, [o.K.iks]);
    await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Çalışan','KVKK-04','R00','Türkçe','Web')`, [o.K.iks]);
    await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [o.K.iks]);
    const c = await o.gir('iks'); const u = `/api/portal/dosya/${d.kimlik}/cayma`;
    expect((await o.ist('POST', u, await o.gir('ds'), {})).statusCode).toBe(404);
    expect((await o.ist('POST', u, c, {})).statusCode).toBe(409);
    const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, hazirlayan_ref) VALUES ($1,$2,'Onarım','Yat Sahibi',20,$3) RETURNING kimlik`, [`T-${++n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
    const k = (await o.sup.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis) VALUES ($1,$2,now(),now(),now() + interval '14 days') RETURNING kimlik`, [t, d.kimlik])).rows[0].kimlik;
    expect((await o.ist('GET', `/api/portal/dosya/${d.kimlik}`, c)).json().cayma).toBe(true);
    { const ir = await o.ist('GET', `/api/portal/dosya/${d.kimlik}/ilerleme-raporu`, c); expect(ir.statusCode).toBe(200); expect(ir.headers['content-type']).toContain('application/pdf'); } // T-YG460
    expect((await o.ist('GET', `/api/portal/dosya/${d.kimlik}/ilerleme-raporu`, await o.gir('ds'))).statusCode).not.toBe(200);
    const r = await o.ist('POST', u, c, {}); expect(r.statusCode, r.body).toBe(200);
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`onay-bag:${r.json().kimlik}`])).rows[0].metin; const bel = m.match(/#onay=([\w-]+)/)[1];
    await o.ist('POST', `/api/onay/${bel}/kod`, undefined, { kanal: 'SMS' }); const kod = o.sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0];
    const kr = await o.ist('POST', `/api/onay/${bel}/karar`, undefined, { kod, kutular: {} }); expect(kr.statusCode, kr.body).toBe(200);
    expect((await o.sup.query(`SELECT iade_durumu FROM on_bilgilendirme_cayma_kaydi WHERE kimlik = $1`, [k])).rows[0].iade_durumu).toBe('Hesap Bekliyor');
    expect((await o.ist('GET', `/api/portal/dosya/${d.kimlik}`, c)).json().cayma).toBe(false);
    expect((await o.ist('POST', u, c, {})).statusCode).toBe(409);
  });
});

describe('vefat, ön kayıt, izin belgesi (YG-1521, YG-344, YG-952)', () => {
  it('temsilci kaydı askıyı kaldırır', async () => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET vefat_isareti = true WHERE kimlik = $1`, [d.kimlik]);
    const bl = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('M','K','Gizli','Dosya',$1,'Sistem',current_date,$2) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/vefat-temsilci`, await o.gir('ds'), { temsilci: 'T', belge: bl })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/vefat-temsilci`, await o.gir('hud'), { temsilci: 'T', belge: bl })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT vefat_isareti, vefat_temsilci FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0]).toEqual({ vefat_isareti: false, vefat_temsilci: 'T' });
  });
  it('MERSİS 16 hane; alanlar kaydedilir', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-ON','F','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik; const c = await o.gir('sc');
    expect((await o.ist('POST', `/api/firma/${f}/on-kayit`, c, { mersis: '123' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/firma/${f}/on-kayit`, c, { mersis: '1234567890123456', calisan: 12, bolgeler: ['Muğla'] })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT calisan_sayisi, hizmet_bolgeleri FROM kurulus WHERE kimlik = $1`, [f])).rows[0]).toEqual({ calisan_sayisi: 12, hizmet_bolgeleri: ['Muğla'] });
    expect((await o.ist('POST', `/api/firma/${f}/on-kayit`, c, { konumTuru: 'Plaj' })).statusCode).toBe(400); // YG-347
    expect((await o.ist('POST', `/api/firma/${f}/on-kayit`, c, { konumTuru: 'Bağlama Noktası' })).json().hata).toContain('bağlama noktasını');
    const bn = (await o.sup.query(`INSERT INTO baglama_noktasi (nokta_no, tur, ad) VALUES ((SELECT coalesce(max(nokta_no), 0) + 1 FROM baglama_noktasi), 'Marina', 'Deneme Marina') RETURNING kimlik`)).rows[0].kimlik;
    expect((await o.ist('POST', `/api/firma/${f}/on-kayit`, c, { konumTuru: 'Bağlama Noktası', baglamaNoktasi: bn })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT konum_turu, baglama_noktasi_ref FROM kurulus WHERE kimlik = $1`, [f])).rows[0]).toEqual({ konum_turu: 'Bağlama Noktası', baglama_noktasi_ref: bn });
  });
});

describe('merkezi belge maskesi, eğitim kapısı, geç cayma kaydı, portal itirazı (YG-1074, YG-1174, YG-1623, YG-944, YG-1493, YG-887)', () => {
  it('müşteri belgesinde firma adı, firma belgesinde hasar no, dış belgede lehtar durur', async () => {
    const { belgeMaskeEngeli } = await import('../src/yetki_ek.js');
    const d = await o.dosyaAc({}, {}); const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-MK','Gizli Firma Ltd','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, hazirlayan_ref) VALUES ($1,'KN',$2,$3,'Y','K',$4)`, [`${d.dosyaNo}-KN01`, d.kimlik, f, o.K.ds]);
    expect(await belgeMaskeEngeli(o.db, 'Fiyat Teklifi', d.kimlik, 'temiz metin')).toBeNull();
    expect(await belgeMaskeEngeli(o.db, 'Fiyat Teklifi', d.kimlik, 'Gizli Firma Ltd kalemi')).toContain('Firma kimliği');
    expect(await belgeMaskeEngeli(o.db, 'İş Emri', d.kimlik, 'Gizli Firma Ltd kalemi')).toBeNull();
    await o.sup.query(`UPDATE yat SET lehtar_adi = 'Lehtar Banka' WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    expect(await belgeMaskeEngeli(o.db, 'Proforma', d.kimlik, 'Lehtar Banka A.Ş.')).toContain('lehtar');
    expect(await belgeMaskeEngeli(o.db, 'Kurtarma Sözleşmesi', d.kimlik, 'Lehtar Banka Gizli Firma Ltd')).toBeNull();
  });
  it('kartı olan personelde geçerli İSG eğitimi yoksa görev verilmez', async () => {
    const { personelBelgeEngeli } = await import('../src/ik.js');
    expect(await personelBelgeEngeli(o.db, o.K.tu!)).toBeNull();
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) VALUES ($1,'2026-01-01',$2)`, [o.K.tu, o.K.ds]);
    expect(await personelBelgeEngeli(o.db, o.K.tu!)).toContain('İSG');
    await o.sup.query(`INSERT INTO egitim_kaydi (personel_ref, tur, ad, tamamlanma_tarihi, kaydeden_ref) VALUES ($1,'İSG','Temel','2026-01-01',$2)`, [o.K.tu, o.K.ds]);
    expect(await personelBelgeEngeli(o.db, o.K.tu!)).toBeNull();
  });
  it('8 saatten geç kayıt bildirilir, zamanında kayıt bildirilmez', async () => {
    const { caymaGecKayit } = await import('../src/kalan.js');
    const d = await o.dosyaAc({}, {}); const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, hazirlayan_ref) VALUES ($1,$2,'Onarım','Yat Sahibi',20,$3) RETURNING kimlik`, [`T-${++n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
    const k = (await o.sup.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis) VALUES ($1,$2,now(),now(),now() + interval '14 days') RETURNING kimlik`, [t, d.kimlik])).rows[0].kimlik;
    expect(await caymaGecKayit(o.db, k, new Date(Date.now() - 3_600_000).toISOString())).toBe(false);
    expect(await caymaGecKayit(o.db, k, new Date(Date.now() - 9 * 3_600_000).toISOString())).toBe(true);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1 AND kullanici_ref = $2`, [`cayma-gec:${k}`, o.K.tid])).rowCount).toBe(1);
  });
  it('yat sahibi kendi faturasına itiraz eder, başkası edemez', async () => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya_tarafi SET kullanici_ref = $2 WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik, o.K.iks]);
    const f = (await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, fatura_no, fatura_tarihi, dosya_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, hazirlayan_ref) VALUES ($1,$2,current_date,$3,'Yat Sahibi',100,20,120,'Faturalandı',$4) RETURNING kimlik`, [`PF-${++n}`, `F-${n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
    const g = { kalem: 'İşçilik', tutar: 20, gerekce: 'Fazla' };
    expect((await o.ist('POST', `/api/fatura/${f}/itiraz`, await o.gir('sc'), g)).statusCode).toBe(404);
    const r = await o.ist('POST', `/api/fatura/${f}/itiraz`, await o.gir('iks'), g); expect(r.statusCode, r.body).toBe(200);
  });
});

describe('ön bilgilendirme PDF (YG-618, YG-619)', () => {
  it('Ek-1, Ek-2, Ek-3 ve taraflar; boş alan işareti kalmaz; PDF üretilir', async () => {
    const { onBilgiTanim } = await import('../src/kalan.js'); const { pdfUret } = await import('../src/pdf.js');
    const d = await o.dosyaAc({}, {}); const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, hazirlayan_ref) VALUES ($1,$2,'Onarım','Yat Sahibi',20,$3) RETURNING kimlik`, [`T-${++n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
    const v = await onBilgiTanim(o.db, t, 'ABC'); const m = JSON.stringify(v.t);
    for (const x of ['Ek-1. Cayma Formu', 'Ek-2.', 'Ek-3.', `T-${n} / 1`, d.dosyaNo]) expect(m).toContain(x);
    expect(m).not.toContain('[●]');
    expect((await pdfUret(v.t)).length).toBeGreaterThan(5000);
    expect(v.t.onay).toBeUndefined(); // YG-1514: onaydan önce kutu yok
    const ot = (await o.sup.query(`INSERT INTO onay_talebi (dosya_ref, ony_kod, baslik, metin, dugme, alici_ad, telefon, belirtec_ozeti, durum, son_gecerlilik, nesne_turu, nesne_kimligi) VALUES ($1,'ONY-23','k','m','d','a','+905550002222',$2,'Onaylandı',now(),'Fiyat Teklifi',$3) RETURNING kimlik`, [d.kimlik, `ob${n}`, t])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO yatonet_onay_kaydi (onay_talebi_ref, karar, metin_ozeti, kanal, onay_kodu, onay_zamani, onaylayan_ad) VALUES ($1,'Onaylandı',repeat('a',64),'SMS Kodu','OK-123456',now(),'Sahip')`, [ot]);
    expect((await onBilgiTanim(o.db, t, 'ABC')).t.onay).toMatchObject({ rol: 'Yat Sahibi', kanal: 'YATONET 360', kod: 'OK-123456' });
  });
});

describe('dosyaya bağlı toplantı (T-YG579-DOSYA)', () => {
  it('dosyaya bağlı toplantıyı o dosyanın Dosya Sorumlusu planlar; dosya no ile bağlanır', async () => {
    const d = await o.dosyaAc(); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const B = { kod: 'TPL-07', konu: 'Başlangıç', baslangic: new Date(Date.now() + 48 * 3_600_000).toISOString(), sureDk: 30, katilimcilar: [{ kullanici: o.K.opm }], dosyaNo: d.dosyaNo };
    const r = await o.ist('POST', '/api/toplanti', await o.gir('ds'), B); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT dosya_ref FROM toplanti WHERE kimlik = $1`, [r.json().kimlik])).rows[0].dosya_ref).toBe(d.kimlik);
    expect((await o.ist('POST', '/api/toplanti', await o.gir('opm'), B)).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/toplanti', await o.gir('ds'), { ...B, dosyaNo: 'YOK-0000' })).statusCode).toBe(400);
  });
});

describe('talebin özgün kaydı (YG-002)', () => {
  it('özgün bildirim ve alınma anı değiştirilemez', async () => {
    const d = await o.dosyaAc(); const tr = (await o.sup.query(`SELECT talep_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].talep_ref;
    await expect(o.sup.query(`UPDATE talep SET ozgun_bildirim = 'değişti' WHERE kimlik = $1 AND ozgun_bildirim IS NOT NULL`, [tr]).then((r) => { if (!r.rowCount) throw new Error('özgün boş'); })).rejects.toThrow();
    await expect(o.sup.query(`UPDATE talep SET bildirim_alinma_zamani = bildirim_alinma_zamani - interval '1 hour' WHERE kimlik = $1`, [tr])).rejects.toThrow('özgün');
  });
});

describe('ön bilgilendirme gösterim anı (YG-467)', () => {
  it('ONY-23 gösterilmeden onaylanamaz; ilk görüntüleme anı kaydedilir', async () => {
    const d = await o.dosyaAc(); const bel = `ony23-gosterim-${Date.now()}-abcdefgh`;
    const ot = (await o.sup.query(`INSERT INTO onay_talebi (dosya_ref, ony_kod, baslik, metin, dugme, alici_ad, telefon, belirtec_ozeti, durum, son_gecerlilik) VALUES ($1,'ONY-23','k','m','d','a','+905550002299',$2,'Bekliyor',now() + interval '1 day') RETURNING kimlik`, [d.kimlik, hashOzet(bel)])).rows[0].kimlik;
    expect((await o.ist('POST', `/api/onay/${bel}/karar`, undefined, { kod: '000000', kutular: {} })).statusCode).toBe(409);
    expect((await o.ist('GET', `/api/onay/${bel}`)).statusCode).toBe(200);
    const z1 = (await o.sup.query(`SELECT gosterim_zamani z FROM onay_talebi WHERE kimlik = $1`, [ot])).rows[0].z; expect(z1).not.toBeNull();
    await o.ist('GET', `/api/onay/${bel}`);
    expect((await o.sup.query(`SELECT gosterim_zamani z FROM onay_talebi WHERE kimlik = $1`, [ot])).rows[0].z).toEqual(z1);
  });
});

describe('firma fiyatı yansıması ve teslim yetkisi (YG-189, YG-1086)', () => {
  it('taslakta yeniden hesaplar, gönderilmişte yeni sürüm görevi açar, eski fiyat kalır', async () => {
    const { firmaFiyatYansit, kalemHesapla, parametre } = await import('../src/teklif.js');
    const d = await o.dosyaAc({}, {}); const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'FF','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-FF${++n}`, o.K.ds])).rows[0].kimlik;
    const ce = (await o.sup.query(`INSERT INTO kapsam_cetveli (dosya_ref, surum, durum, hazirlayan_ref) VALUES ($1,1,'Onaylı',$2) RETURNING kimlik`, [d.kimlik, o.K.tu])).rows[0].kimlik;
    const sa = (await o.sup.query(`INSERT INTO kapsam_satiri (cetvel_ref, satir_kodu, aciklama, isin_niteligi, bedel_turu, miktar, birim) VALUES ($1,'S1','İşçilik','Onarım','Sabit',2,'Adet') RETURNING kimlik`, [ce])).rows[0].kimlik;
    const ft = (await o.sup.query(`INSERT INTO firma_fiyat_teklifi (teklif_no, dosya_ref, kurulus_ref, gecerlilik, giren_ref) VALUES ($1,$2,$3,'2099-01-01',$4) RETURNING kimlik`, [`FT-${n}`, d.kimlik, f, o.K.ds])).rows[0].kimlik;
    const ka = (await o.sup.query(`INSERT INTO firma_fiyat_kalemi (teklif_ref, satir_ref, birim_fiyat_eur) VALUES ($1,$2,100) RETURNING kimlik`, [ft, sa])).rows[0].kimlik;
    const tk = async (statu: string) => { const x = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, hazirlayan_ref, statu) VALUES ($1,$2,'Onarım','Yat Sahibi',20,$3,$4) RETURNING kimlik`, [`T-${++n}`, d.kimlik, o.K.ts, statu])).rows[0].kimlik; await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, firma_kalem_ref, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur) VALUES ($1,1,'İşçilik','Onarım','Sabit',2,'Adet',$2,100,100,200)`, [x, ka]); return x as string; };
    const taslak = await tk('Taslak'); const giden = await tk('Gönderildi');
    await o.sup.query(`UPDATE firma_fiyat_kalemi SET eski_fiyat_eur = birim_fiyat_eur, birim_fiyat_eur = 150 WHERE kimlik = $1`, [ka]);
    expect(await firmaFiyatYansit(o.db, ka)).toBe(2);
    const h = kalemHesapla(150, 2, await parametre(o.db, 'fiyat_katsayisi'), await parametre(o.db, 'bant_orani'), null);
    const k1 = (await o.sup.query(`SELECT tutar_eur, birim_maliyet_eur FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [taslak])).rows[0]; expect(Number(k1.tutar_eur)).toBe(h.tutar); expect(Number(k1.birim_maliyet_eur)).toBe(150);
    expect(Number((await o.sup.query(`SELECT ara_toplam_eur a FROM fiyat_teklifi WHERE kimlik = $1`, [taslak])).rows[0].a)).toBe(h.tutar);
    expect(Number((await o.sup.query(`SELECT tutar_eur t FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [giden])).rows[0].t)).toBe(200);
    expect((await o.kart('Teklif Revizyonu', giden)).durum).toBe('Bekliyor');
    expect(Number((await o.sup.query(`SELECT eski_fiyat_eur e FROM firma_fiyat_kalemi WHERE kimlik = $1`, [ka])).rows[0].e)).toBe(100);
  });
  it('yetkisi doğrulanmamış dosyada teslim durur, doğrulanınca açılır', async () => {
    const { teslimYetkiEngeli } = await import('../src/teslim_ek.js');
    const d = await o.dosyaAc({}, {}); const u = `UPDATE talep SET ihbar_yetki_durumu = $2 WHERE kimlik = (SELECT talep_ref FROM dosya WHERE kimlik = $1)`;
    await o.sup.query(u, [d.kimlik, 'Doğrulandı']); expect(await teslimYetkiEngeli(o.db, d.kimlik)).toBeNull();
    await o.sup.query(u, [d.kimlik, 'Beklemede']); expect(await teslimYetkiEngeli(o.db, d.kimlik)).toContain('Yetki');
  });
});

describe('firma adayları, tarama alanı, kapanış (YG-304, YG-916, YG-416)', () => {
  it('kapsamadan süzer, çıkar çatışması Ret; yetkisiz göremez', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya SET konum = 'Marmaris Muğla' WHERE kimlik = $1`, [d.kimlik]);
    const fk = async (ad: string, kapsama: string, bolge: string | null) => { const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ($1,$2,'Çözüm Ortağı','Onaylı','Aktif',$3) RETURNING kimlik`, [`S-A${++n}`, ad, o.K.ds])).rows[0].kimlik as string; await o.sup.query(`INSERT INTO brans_yetkinligi (kurulus_ref, ana_brans, kapsama, bolge) VALUES ($1,'BranşX',$2,$3)`, [f, kapsama, bolge]); return f; };
    await fk('Bodrum Firma', 'Bölge', 'Bodrum'); const m = await fk('Muğla Firma', 'Bölge', 'Muğla'); await fk('Ulusal Firma', 'Ulusal', null);
    const c = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/firma-adaylari?brans=${encodeURIComponent('BranşX')}`;
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/firma-adaylari`, c)).statusCode).toBe(400);
    const a = (await o.ist('GET', u, c)).json() as { ticari_unvan: string; sonuc: string }[]; expect(a.map((x) => x.ticari_unvan)).toEqual(['Muğla Firma']); // YG-1539 varsayılan Bölge
    const au = (await o.ist('GET', `${u}&katman=Ulusal`, c)).json() as { ticari_unvan: string; bolgeDisi: boolean }[]; expect(au.map((x) => x.ticari_unvan)).toEqual(['Muğla Firma', 'Ulusal Firma']); expect(au[1]!.bolgeDisi).toBe(true);
    const ta = (await o.sup.query(`INSERT INTO taraf (taraf_no, kisi_turu, musteri_turu, unvan_ad_soyad, taraf_rolleri, olusturan_ref) VALUES ($1,'Gerçek kişi','Bireysel Müşteri','Sahip','{Yat Sahibi}',$2) RETURNING kimlik`, [`TR-A${++n}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`UPDATE yat SET yat_sahibi_ref = $2 WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik, ta]);
    await o.sup.query(`INSERT INTO cikar_beyani (kurulus_ref, taraf_ref, aciklama, kaydeden_ref) VALUES ($1,$2,'X',$3)`, [m, ta, o.K.ds]);
    const a2 = (await o.ist('GET', u, c)).json() as { ticari_unvan: string; sonuc: string }[]; expect(a2.at(-1)).toMatchObject({ ticari_unvan: 'Muğla Firma', sonuc: 'Ret' }); expect((await o.ist('GET', `${u}&yalnizUygun=1`, c)).json()).toHaveLength(0);
    expect((await o.ist('GET', u, await o.gir('sc'))).statusCode).toBe(404);
  });
  it('tarama sonucu yetkisiz role görünmez; açık sipariş kapanışı durdurur', async () => {
    const { alanSuz } = await import('../src/alan.js'); const { kapanisEksikleri } = await import('../src/saha.js');
    const kr = new Map((await o.sup.query(`SELECT alan, davranis, yasak_gruplar, yalniz_roller FROM alan_erisim_kurali`)).rows.map((r) => [r.alan as string, r]));
    expect(alanSuz({ tarama_sonucu: 'Temiz' }, kr, { grup: 'LGM İç Rolü', roller: ['Dosya Sorumlusu'] })).toEqual({});
    expect(alanSuz({ tarama_sonucu: 'Temiz' }, kr, { grup: 'LGM İç Rolü', roller: ['Ticari İşler Direktörü'] })).toEqual({ tarama_sonucu: 'Temiz' });
    const d = await o.dosyaAc({}, {}); const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'TD','Tedarikçi',$2) RETURNING kimlik`, [`S-T${++n}`, o.K.ds])).rows[0].kimlik;
    expect(await kapanisEksikleri(o.db, { kimlik: d.kimlik }, null)).not.toContain('Açık Tedarik Siparişi');
    await o.sup.query(`INSERT INTO tedarik_siparisi (siparis_no, dosya_ref, kurulus_ref, tedarikci_teklif_ref, nihai_kullanim_yeri, kdv_haric_eur, kdv_eur, toplam_eur, teslim_tarihi, teslim_yeri, kabul_olcutu, secim_gerekcesi, hazirlayan_ref, statu) VALUES ($1,$2,$3,'T','Y',1,0,1,'2099-01-01','Y','K','G',$4,'Verildi')`, [`SP-${n}`, d.kimlik, f, o.K.ds]);
    expect(await kapanisEksikleri(o.db, { kimlik: d.kimlik }, null)).toContain('Açık Tedarik Siparişi');
    // YG-869: 48 saatte kabul etmeyen tedarikçi için siparişi verene görev (bir kez)
    await o.sup.query(`UPDATE tedarik_siparisi SET statu = 'Verildi', verilme_zamani = now() - interval '49 hours', hazirlayan_ref = $2 WHERE dosya_ref = $1`, [d.kimlik, o.K.ds]);
    const { tedarikSureIsle } = await import('../src/tedarik.js'); await tedarikSureIsle(o.db); await tedarikSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti k JOIN tedarik_siparisi s ON s.kimlik::text = k.nesne_kimligi WHERE k.tur = 'Tedarikçi Sipariş Kabulü Gecikti' AND s.dosya_ref = $1`, [d.kimlik])).rows[0].n).toBe(1);
  });
});

describe('yasal ayıp raporu ve onay kaydı (YG-1078, YG-161)', () => {
  it('Direktör görür, Müdür ve Dosya Sorumlusu göremez', async () => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`INSERT INTO garanti_sikayet (kayit_no, dosya_ref, kayit_turu, kanal, bildirim_zamani, oncelik, olusturan_ref) VALUES ($1,$2,'{Yasal Ayıp}','Telefon',now(),'Normal',$3)`, [`GS-${++n}`, d.kimlik, o.K.ds]);
    expect((await o.ist('GET', '/api/rapor/yasal-ayip', await o.gir('mfm'))).statusCode).toBe(404);
    expect((await o.ist('GET', '/api/rapor/yasal-ayip', await o.gir('ds'))).statusCode).toBe(404);
    const r = await o.ist('GET', '/api/rapor/yasal-ayip', await o.gir('tid')); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().ayip.map((x: { kayit_no: string }) => x.kayit_no)).toContain(`GS-${n}`);
  });
  it('onay kaydı sıfat ve tutarı tutar', async () => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya_tarafi SET kullanici_ref = $2 WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik, o.K.iks]);
    const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, hazirlayan_ref) VALUES ($1,$2,'Onarım','Yat Sahibi',20,$3) RETURNING kimlik`, [`T-${++n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis) VALUES ($1,$2,now(),now(),now() + interval '14 days')`, [t, d.kimlik]);
    const r = await o.ist('POST', `/api/portal/dosya/${d.kimlik}/cayma`, await o.gir('iks'), {}); expect(r.statusCode, r.body).toBe(200); const on = r.json().kimlik;
    await o.sup.query(`UPDATE onay_talebi SET tutar_eur = 123 WHERE kimlik = $1`, [on]);
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`onay-bag:${on}`])).rows[0].metin; const bel = m.match(/#onay=([\w-]+)/)[1];
    await o.ist('POST', `/api/onay/${bel}/kod`, undefined, { kanal: 'SMS' }); const kod = o.sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0];
    expect((await o.ist('POST', `/api/onay/${bel}/karar`, undefined, { kod, kutular: {} })).statusCode).toBe(200);
    const k = (await o.sup.query(`SELECT temsil_sifati, tutar_eur FROM yatonet_onay_kaydi WHERE onay_talebi_ref = $1`, [on])).rows[0]; expect(k.temsil_sifati).toBe('Yat Sahibi'); expect(Number(k.tutar_eur)).toBe(123);
  });
});

describe('yetkili atama (YG-1070, ONY-14)', () => {
  it('yalnız gösterilen yat sahibi atar; kaptanda limit yoksa sıfır, ödeme yetkisi yok; onayla geçerli olur', async () => {
    const tel = '+905551112233'; await o.sup.query(`UPDATE kullanici_hesabi SET cep_telefonu = $2 WHERE kimlik = $1`, [o.K.iks, tel]);
    await o.sup.query(`INSERT INTO yat_yetkilisi_kaydi (kullanici_ref, rol, sahip_ad, sahip_telefon) VALUES ($1,'Yatın Kaptanı','Sahip',$2)`, [o.K.sc, tel]);
    const u = `/api/portal/yetkili/${o.K.sc}/atama`; const g = { yatlar: ['Mavi'], islemler: ['ONY-23'], bitis: '2099-01-01', odeme: true };
    expect((await o.ist('POST', u, await o.gir('ds'), g)).statusCode).toBe(404);
    const c = await o.gir('iks');
    expect((await o.ist('GET', '/api/portal/yetkililerim', c)).json()).toHaveLength(1);
    expect((await o.ist('POST', u, c, { ...g, yatlar: [] })).statusCode).toBe(400);
    const r = await o.ist('POST', u, c, g); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT belge_durumu FROM yat_yetkilisi_kaydi WHERE kullanici_ref = $1`, [o.K.sc])).rows[0].belge_durumu).toBe('Bekleniyor');
    const on = r.json().kimlik; const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`onay-bag:${on}`])).rows[0].metin; const bel = m.match(/#onay=([\w-]+)/)[1];
    await o.ist('POST', `/api/onay/${bel}/kod`, undefined, { kanal: 'SMS' }); const kod = o.sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0];
    const kr = await o.ist('POST', `/api/onay/${bel}/karar`, undefined, { kod, kutular: {} }); expect(kr.statusCode, kr.body).toBe(200);
    const k = (await o.sup.query(`SELECT belge_durumu, ust_limit_eur, odeme_yetkisi, yatlar, atama_taslak FROM yat_yetkilisi_kaydi WHERE kullanici_ref = $1`, [o.K.sc])).rows[0];
    expect(k).toMatchObject({ belge_durumu: 'Geçerli', odeme_yetkisi: false, yatlar: ['Mavi'], atama_taslak: null }); expect(Number(k.ust_limit_eur)).toBe(0);
    await o.sup.query(`INSERT INTO yat_yetkilisi_kaydi (kullanici_ref, rol, sahip_ad, sahip_telefon) VALUES ($1,'Yat Sahibinin Yetkili Temsilcisi','Sahip',$2)`, [o.K.tu, tel]);
    const r2 = await o.ist('POST', `/api/portal/yetkili/${o.K.tu}/atama`, c, { ...g, limit: 500, bilgi: true }); expect(r2.statusCode, r2.body).toBe(200);
    expect((await o.sup.query(`SELECT atama_taslak a FROM yat_yetkilisi_kaydi WHERE kullanici_ref = $1`, [o.K.tu])).rows[0].a).toMatchObject({ limit: 500, odeme: true, bilgi: true });
    expect((await o.ist('POST', `/api/portal/yetkili/${o.K.tu}/atama`, c, { yatlar: ['Mavi'], islemler: ['ONY-23'], bitis: '2099-01-01' })).statusCode).toBe(400);
  });
});

describe('SMS kesintisi (ALT-5, YG-1952)', () => {
  it('yurt içi numarada SMS gitmezse kod e-postayla istenir, onay tamamlanır, kesinti bildirilir', async () => {
    const d = await o.dosyaAc({}, {}); const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, hazirlayan_ref) VALUES ($1,$2,'Onarım','Yat Sahibi',20,$3) RETURNING kimlik`, [`T-${++n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis) VALUES ($1,$2,now(),now(),now() + interval '14 days')`, [t, d.kimlik]);
    await o.sup.query(`UPDATE dosya_tarafi SET kullanici_ref = $2, telefon = '+905550001122', eposta = 'sahip@deneme.local' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik, o.K.iks]);
    await o.sup.query(`UPDATE kullanici_hesabi SET cep_telefonu = '+905550001122', e_posta = 'sahip@deneme.local' WHERE kimlik = $1`, [o.K.iks]);
    const r = await o.ist('POST', `/api/portal/dosya/${d.kimlik}/cayma`, await o.gir('iks'), {}); expect(r.statusCode, r.body).toBe(200); const on = r.json().kimlik;
    const bel = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`onay-bag:${on}`])).rows[0].metin.match(/#onay=([\w-]+)/)[1];
    expect((await o.ist('GET', `/api/onay/${bel}`)).json().epostaKodu).toBe(false);
    expect((await o.ist('POST', `/api/onay/${bel}/kod`, undefined, { kanal: 'E-posta' })).statusCode).toBe(403);
    const asil = o.sms.gonder; o.sms.gonder = async () => { throw new Error('sağlayıcı kapalı'); };
    try { const h = await o.ist('POST', `/api/onay/${bel}/kod`, undefined, { kanal: 'SMS' }); expect(h.statusCode).toBe(503); expect(h.json().hata).toContain('e-postayla'); } finally { o.sms.gonder = asil; }
    expect((await o.ist('GET', `/api/onay/${bel}`)).json().epostaKodu).toBe(true);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari LIKE 'sms-kesinti:%' AND kullanici_ref = $1`, [o.K.sy])).rowCount).toBe(1);
    expect((await o.ist('POST', `/api/onay/${bel}/kod`, undefined, { kanal: 'E-posta' })).statusCode).toBe(200);
    const kod = o.posta.gidenler.at(-1)!.metin.match(/\d{6}/)![0];
    const kr = await o.ist('POST', `/api/onay/${bel}/karar`, undefined, { kod, kutular: {} }); expect(kr.statusCode, kr.body).toBe(200);
    expect((await o.sup.query(`SELECT kanal FROM yatonet_onay_kaydi WHERE onay_talebi_ref = $1`, [on])).rows[0].kanal).toBe('E-posta Kodu');
  });
});

describe('giriş kodu kesintide (V-258)', () => {
  it('SMS hata verirse kayıtlı e-postaya gider; e-posta yoksa destek hattına yönlendirir; yeni kayıt da yönlendirir', async () => {
    const hs = async (tel: string, ep: string | null) => { await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, dogrulama_yontemi, hesap_durumu) VALUES ('Müşteri/Kurum','Bireysel Müşteri (Yat Sahibi/Yetkilisi)','S',$1,$2,$1,'SMS kodu','Aktif')`, [tel, ep]); };
    await hs('+905550002201', 'g1@deneme.local'); await hs('+905550002202', null);
    const asil = o.sms.gonder; o.sms.gonder = async () => { throw new Error('kapalı'); };
    try {
      const a = await o.ist('POST', '/api/kimlik/telefon', undefined, { telefon: '+905550002201' }); expect(a.statusCode, a.body).toBe(200); expect(a.json().kanal).toBe('E-posta');
      expect(o.posta.gidenler.at(-1)!.telefon).toBe('g1@deneme.local'); expect(o.posta.gidenler.at(-1)!.metin).toMatch(/\d{6}/);
      const b = await o.ist('POST', '/api/kimlik/telefon', undefined, { telefon: '+905550002202' }); expect(b.statusCode).toBe(503); expect(b.json().hata).toContain('Destek Hattı');
      const c = await o.ist('POST', '/api/kayit/kod', undefined, { telefon: '+905550002203' }); expect(c.statusCode).toBe(503);
    } finally { o.sms.gonder = asil; }
    const d = await o.ist('POST', '/api/kimlik/telefon', undefined, { telefon: '+905550002201' }); expect(d.json().kanal).toBe('SMS');
  });
});

describe('kurumsal Ek-2 (D-135, YG-1070, Çerçeve m.26.4)', () => {
  const onayla = async (on: string, karar?: string) => {
    const bel = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`onay-bag:${on}`])).rows[0].metin.match(/#onay=([\w-]+)/)[1];
    await o.ist('POST', `/api/onay/${bel}/kod`, undefined, { kanal: 'SMS' }); const kod = o.sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0];
    const r = await o.ist('POST', `/api/onay/${bel}/karar`, undefined, { kod, kutular: {}, karar }); expect(r.statusCode, r.body).toBe(200);
  };
  it('MPM kaydeder, temsilci SMS koduyla onaylayınca yürürlüğe girer; reddederse önceki kalır; kaptan yetkisizse satır boş', async () => {
    const { ek2Tanim } = await import('../src/kalan.js'); const { pdfUret } = await import('../src/pdf.js');
    const tr = (await o.sup.query(`INSERT INTO taraf (taraf_no, kisi_turu, musteri_turu, unvan_ad_soyad, taraf_rolleri, olusturan_ref) VALUES ($1,'Tüzel kişi','Kurumsal Müşteri','Filo A.Ş.','{Yat Sahibi}',$2) RETURNING kimlik`, [`TR-E${++n}`, o.K.ds])).rows[0].kimlik;
    const k = (await o.sup.query(`INSERT INTO kurumsal_kurum (taraf_ref, unvan, ek2_onay_siniri, kaydeden_ref) VALUES ($1,'Filo A.Ş.',100,$2) RETURNING kimlik`, [tr, o.K.ds])).rows[0].kimlik; const u = `/api/kurumsal-kurum/${k}/ek2`;
    const g = { satirlar: { muhatap: { ad: 'Muhatap Kişi', iletisim: 'm@filo.local' }, fiyat: { ad: 'Fiyat Kişi', limit: 25000 }, kaptan: { ad: 'Kaptan Kişi', limit: 0 } }, yatlar: ['Mavi'], bilgi: ['Sörveyör'] };
    expect((await o.ist('POST', u, await o.gir('ds'), g)).statusCode).toBe(403);
    const c = await o.gir('mpm'); expect((await o.ist('POST', u, c, { satirlar: {} })).statusCode).toBe(400); expect((await o.ist('POST', u, c, { ...g, bilgi: ['X'] })).statusCode).toBe(400);
    expect((await o.ist('POST', u, c, g)).statusCode).toBe(409); // temsilci yok
    await o.sup.query(`UPDATE kullanici_hesabi SET cep_telefonu = '+905550003301' WHERE kimlik = $1`, [o.K.tm]);
    await o.sup.query(`INSERT INTO kurumsal_kullanici (kullanici_ref, kurum_ref, rol, onay_siniri, yetkili, ekleyen_ref) VALUES ($1,$2,'Onaylayan',100,true,$3)`, [o.K.tm, k, o.K.ds]);
    const r1 = await o.ist('POST', u, c, g); expect(r1.json()).toMatchObject({ surum: 1, durum: 'Onay Bekliyor' });
    expect((await o.ist('POST', u, c, g)).statusCode).toBe(409); // bekleyen var
    expect(await ek2Tanim(o.db, k, 'tr')).toBeNull(); expect(Number((await o.sup.query(`SELECT ek2_onay_siniri s FROM kurumsal_kurum WHERE kimlik = $1`, [k])).rows[0].s)).toBe(100);
    const on1 = (await o.sup.query(`SELECT onay_ref r FROM kurumsal_ek2 WHERE kurum_ref = $1 AND surum = 1`, [k])).rows[0].r; await onayla(on1);
    expect(Number((await o.sup.query(`SELECT ek2_onay_siniri s FROM kurumsal_kurum WHERE kimlik = $1`, [k])).rows[0].s)).toBe(25000);
    const v = await ek2Tanim(o.db, k, 'tr'); const m = JSON.stringify(v!.t); expect(m).toContain('Muhatap Kişi'); expect(m).toContain('25.000,00 EUR'); expect(m).not.toContain('Kaptan Kişi'); expect(m).not.toContain('[●]'); expect(m).not.toContain('Fatura / Rapor'); expect(m).toContain('noter');
    expect(m).toContain('ticari@limitglobalmarine.com.tr'); expect(m).toContain('Hizmet Sağlayıcı Muhatabı'); expect(v!.t.bolumler[0]).toMatchObject({ satirlar: expect.arrayContaining([expect.arrayContaining(['Yatın Kaptanı / Yat Yetkilisi', '', '', ''])]) });
    expect((await o.ist('POST', u, c, { ...g, satirlar: { ...g.satirlar, fiyat: { ad: 'Fiyat Kişi', limit: 90000 }, kaptan: { ad: 'Kaptan Kişi', limit: 500 } } })).json().surum).toBe(2);
    const on2 = (await o.sup.query(`SELECT onay_ref r FROM kurumsal_ek2 WHERE kurum_ref = $1 AND surum = 2`, [k])).rows[0].r; await onayla(on2, 'Reddet');
    expect(Number((await o.sup.query(`SELECT ek2_onay_siniri s FROM kurumsal_kurum WHERE kimlik = $1`, [k])).rows[0].s)).toBe(25000); expect(JSON.stringify((await ek2Tanim(o.db, k, 'en'))!.t)).not.toContain('Kaptan Kişi');
    expect((await pdfUret(v!.t)).length).toBeGreaterThan(5000);
    const pdf = await o.ist('GET', `${u}.pdf?dil=en`, c); expect(pdf.statusCode).toBe(200); expect(pdf.headers['content-type']).toContain('pdf');
    expect((await o.ist('GET', `${u}.pdf`, await o.gir('ds'))).statusCode).toBe(404);
  }, 120_000);
  it('limit aşımı ONY-17 metniyle uyarır ve onayı yeterli limitli kişiye geçirir; yoksa üzerinde kalır', async () => {
    const { limitYonlendir } = await import('../src/kalan.js');
    const tr = (await o.sup.query(`INSERT INTO taraf (taraf_no, kisi_turu, musteri_turu, unvan_ad_soyad, taraf_rolleri, olusturan_ref) VALUES ($1,'Tüzel kişi','Kurumsal Müşteri','Filo B',$2,$3) RETURNING kimlik`.replace("$2,$3", "'{Yat Sahibi}',$2"), [`TR-E${++n}`, o.K.ds])).rows[0].kimlik;
    const k = (await o.sup.query(`INSERT INTO kurumsal_kurum (taraf_ref, unvan, ek2_onay_siniri, kaydeden_ref) VALUES ($1,'Filo B',50000,$2) RETURNING kimlik`, [tr, o.K.ds])).rows[0].kimlik;
    const ek = (kl: string, s: number) => o.sup.query(`INSERT INTO kurumsal_kullanici (kullanici_ref, kurum_ref, rol, onay_siniri, ekleyen_ref) VALUES ($1,$2,'Onaylayan',$3,$4)`, [kl, k, s, o.K.ds]);
    await ek(o.K.ty!, 1000); await ek(o.K.opm!, 40000);
    const d = await o.dosyaAc({}, {});
    const on = (await o.sup.query(`INSERT INTO onay_talebi (dosya_ref, ony_kod, baslik, metin, dugme, alici_ad, alici_kullanici_ref, telefon, belirtec_ozeti, son_gecerlilik, tutar_eur) VALUES ($1,'ONY-23','k','m','d','A',$2,'+905550003302',$3,now() + interval '1 day',5000) RETURNING kimlik`, [d.kimlik, o.K.ty, `oz-${n}`])).rows[0].kimlik;
    const m = await limitYonlendir(o.db, on, o.K.ty!, 5000); expect(m).toContain('5.000,00'); expect(m).toContain('1.000,00'); expect(m).toContain('iletilmiştir');
    expect((await o.sup.query(`SELECT alici_kullanici_ref a FROM onay_talebi WHERE kimlik = $1`, [on])).rows[0].a).toBe(o.K.opm);
    const m2 = await limitYonlendir(o.db, on, o.K.opm!, 45000); expect(m2).not.toContain('iletilmiştir');
    expect((await o.sup.query(`SELECT alici_kullanici_ref a FROM onay_talebi WHERE kimlik = $1`, [on])).rows[0].a).toBe(o.K.opm);
  });
});

describe('karşı taraf bildirimi ve vize (Çerçeve m.13.1, D-025)', () => {
  it('karşı taraf yazılırsa 12 saatlik görev açılır, yazılmazsa açılmaz', async () => {
    const r = await o.ist('POST', '/api/veri-ihlali', await o.gir('ds'), { olayTuru: 'Kayıp çıktı', ozet: 'Çıktı kayboldu', karsiTaraf: 'Firma X' }); expect(r.statusCode, r.body).toBe(200);
    const k = await o.kart('Karşı Tarafa İhlal Bildirimi', r.json().kimlik); expect(k.durum).toBe('Bekliyor');
    const sn = (await o.sup.query(`SELECT extract(epoch FROM son_zaman - now()) s FROM is_karti WHERE kimlik = $1`, [k.kimlik])).rows[0].s; expect(Number(sn)).toBeGreaterThan(11.9 * 3600); expect(Number(sn)).toBeLessThanOrEqual(12 * 3600);
    const r2 = await o.ist('POST', '/api/veri-ihlali', await o.gir('ds'), { olayTuru: 'Kayıp çıktı', ozet: 'İkinci' });
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Karşı Tarafa İhlal Bildirimi' AND nesne_kimligi = $1`, [r2.json().kimlik])).rowCount).toBe(0);
  });
  it('yurt dışı dosyada yalnız geçerli vize ve pasaportlu kişi önerilir; süresi yaklaşan İK’ya bildirilir', async () => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET yurt_disi = true WHERE kimlik = $1`, [d.kimlik]); await o.ekipKur(d.kimlik);
    const u = `/api/dosya/${d.kimlik}/ekip-oneri?rol=${encodeURIComponent('Teknik Uzman')}`; const c = await o.gir('opm');
    const ilk = await o.ist('GET', u, c); expect(ilk.statusCode, ilk.body).toBe(200); expect(ilk.json()).toEqual([]);
    const ku = o.K.tu!; const gec = new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10);
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) VALUES ($1,'2026-01-01',$2) ON CONFLICT (kullanici_ref) DO NOTHING`, [ku, o.K.ds]);
    await o.sup.query(`UPDATE personel_karti SET vize_bitis = '2020-01-01', pasaport_bitis = '2099-01-01' WHERE kullanici_ref = $1`, [ku]);
    expect((await o.ist('GET', u, c)).json().map((x: { kimlik: string }) => x.kimlik)).not.toContain(ku);
    await o.sup.query(`UPDATE personel_karti SET vize_bitis = $2 WHERE kullanici_ref = $1`, [ku, gec]);
    expect((await o.ist('GET', u, c)).json().map((x: { kimlik: string }) => x.kimlik)).toContain(ku);
    const { sureUyariIsle } = await import('../src/uyum.js'); await sureUyariIsle(o.db);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1 AND kullanici_ref = $2`, [`personel_belge:${ku}:Vize:30`, o.K.ikm])).rowCount).toBe(1);
  });
});

describe('hasar paylaşım kapısı, yetki süresi, garanti masrafı (YG-1171, YG-1086, YG-1418)', () => {
  it('dosya tarafı dışına onaysız paylaşım durur; onaylı talep veya taraf geçer', async () => {
    const { hasarPaylasimEngeli } = await import('../src/yetki_ek.js');
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'sahip1@d.local' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]);
    expect(await hasarPaylasimEngeli(o.db, 'Dosya', d.kimlik, 'yabanci@d.local')).toContain('bekleniyor');
    expect(await hasarPaylasimEngeli(o.db, 'Dosya', d.kimlik, 'SAHIP1@d.local')).toBeNull();
    expect(await hasarPaylasimEngeli(o.db, 'Firma', d.kimlik, 'yabanci@d.local')).toBeNull();
    await o.sup.query(`INSERT INTO hasar_paylasim_talebi (dosya_ref, alici, kapsam, talep_eden_ref, durum) VALUES ($1,'yabanci@d.local','K',$2,'Onaylandı')`, [d.kimlik, o.K.ds]);
    expect(await hasarPaylasimEngeli(o.db, 'Dosya', d.kimlik, 'yabanci@d.local')).toBeNull();
  });
  it('yetki kaydı süresi dolan yat sahibinde teslim durur, yenisi varsa geçer', async () => {
    const { teslimYetkiEngeli } = await import('../src/teslim_ek.js');
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE talep SET ihbar_yetki_durumu = 'Doğrulandı' WHERE kimlik = (SELECT talep_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    const ta = (await o.sup.query(`SELECT kimlik FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' LIMIT 1`, [d.kimlik])).rows[0].kimlik;
    const yk = (bit: string) => o.sup.query(`INSERT INTO yetki_kaydi (dosya_ref, dosya_tarafi_ref, yetki_dayanagi_turu, belge_duzenleyen, belge_tarihi, gecerlilik_baslangici, gecerlilik_bitisi, yetkili_islemler, dogrulayan_ref, dogrulama_kaniti, olusturan_ref) VALUES ($1,$2,'Vekâletname','Noter','2020-01-01','2020-01-01',$3,'{Teslim}',$4,'Belge',$4)`, [d.kimlik, ta, bit, o.K.ds]);
    expect(await teslimYetkiEngeli(o.db, d.kimlik)).toBeNull();
    await yk('2020-12-31'); expect(await teslimYetkiEngeli(o.db, d.kimlik)).toContain('süresi dolmuştur');
    await yk('2099-12-31'); expect(await teslimYetkiEngeli(o.db, d.kimlik)).toBeNull();
  });
  it('garanti kararlı dosyada yan masraf kalemi eklenmez', async () => {
    const d = await o.dosyaAc({}, {}); const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, hazirlayan_ref) VALUES ($1,$2,'Onarım','Yat Sahibi',20,$3) RETURNING kimlik`, [`T-${++n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
    const u = `/api/teklif/${t}/masraf-kalemi`; const c = await o.gir('ts'); const g = { aciklama: 'Çekek', nitelik: 'Onarım', tutar: 100 };
    expect((await o.ist('POST', u, c, g)).json().hata).toContain('belgesini'); // garanti yokken belge sorulur
    await o.sup.query(`INSERT INTO garanti_sikayet (kayit_no, dosya_ref, kayit_turu, kanal, bildirim_zamani, oncelik, karar, olusturan_ref) VALUES ($1,$2,'{Garanti bildirimi}','Telefon',now(),'Normal','Garanti',$3)`, [`GS-${++n}`, d.kimlik, o.K.ds]);
    const r = await o.ist('POST', u, c, g); expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('mahsup');
  });
});

describe('e-posta harf kuralı (Türkçe I)', () => {
  it('I harfli adres ı olmaz; büyük küçük farkı tek hesap sayılır; paylaşım doğru adrese kaydedilir', async () => {
    await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, dogrulama_yontemi) VALUES ('Müşteri/Kurum','Bireysel Müşteri (Yat Sahibi/Yetkilisi)','A','iks.1','KISI@deneme.local','+905550004401','SMS kodu')`);
    await expect(o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, dogrulama_yontemi) VALUES ('Müşteri/Kurum','Bireysel Müşteri (Yat Sahibi/Yetkilisi)','B','iks.2','kisi@deneme.local','+905550004402','SMS kodu')`)).rejects.toThrow();
    const { disMetinEngeli } = await import('../src/yetki_ek.js');
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kurumsal_eposta, olusturan_ref) VALUES ($1,'Firma Il','Çözüm Ortağı','BILGI@firma.local',$2) RETURNING kimlik`, [`S-I${++n}`, o.K.ds])).rows[0].kimlik; expect(f).toBeTruthy();
    const d = await o.dosyaAc({}, {}); await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi, sigorta_hasar_dosya_no, olusturan_ref) VALUES ($1,'SgX','HASAR-1234',$2)`, [d.kimlik, o.K.ds]);
    expect(await disMetinEngeli(o.db, { eposta: 'bilgi@firma.local', metin: 'HASAR-1234', konu: 'k' })).toContain('Sigorta bilgisi');
  });
});

describe('temsilciye teslim ve kümülatif değişiklik (YG-414, YG-410)', () => {
  it('yetki kaydı yoksa temsilciye onaysız teslim durur; varsa geçer', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const bl = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'Fotoğraf','Gizli','Dosya',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`F-${d.kimlik}`, d.kimlik, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO teslim_kaydi (dosya_ref, teslim_eden_ref, hatirlatma_zamani) VALUES ($1,$2,now())`, [d.kimlik, o.K.ds]);
    const u = `/api/dosya/${d.kimlik}/teslim-onaysiz`; const g = { aliciTuru: 'Yetkili Temsilci', alici: 'T Kişi', belge: bl }; const c = await o.gir('ds');
    const r = await o.ist('POST', u, c, g); expect(r.statusCode, r.body).toBe(409); expect(r.json().hata).toContain('yetki kaydı');
    const ta = (await o.sup.query(`SELECT kimlik FROM dosya_tarafi WHERE dosya_ref = $1 LIMIT 1`, [d.kimlik])).rows[0].kimlik;
    await o.sup.query(`UPDATE dosya_tarafi SET kisi_adi_soyadi = 'Başka Kişi' WHERE kimlik = $1`, [ta]);
    await o.sup.query(`INSERT INTO yetki_kaydi (dosya_ref, dosya_tarafi_ref, yetki_dayanagi_turu, belge_duzenleyen, belge_tarihi, gecerlilik_baslangici, gecerlilik_bitisi, yetkili_islemler, dogrulayan_ref, dogrulama_kaniti, olusturan_ref) VALUES ($1,$2,'Vekâletname','Noter','2020-01-01','2020-01-01','2099-01-01','{Teslim}',$3,'Belge',$3)`, [d.kimlik, ta, o.K.ds]);
    expect((await o.ist('POST', u, c, g)).statusCode).toBe(409); // kayıt başkasına ait
    await o.sup.query(`UPDATE dosya_tarafi SET kisi_adi_soyadi = 'T Kişi' WHERE kimlik = $1`, [ta]);
    const r2 = await o.ist('POST', u, c, { ...g, alici: 't kişi' }); expect(r2.statusCode, r2.body).toBe(200);
  });
  it('değişiklik listesi yalnız onaylıları kümülatif toplar', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const e = (no: string, f: number, dr: string) => o.sup.query(`INSERT INTO degisiklik_protokolu (degisiklik_no, dosya_ref, tur, mevcut, onerilen, bedel_farki_eur, kanal, durum, hazirlayan_ref) VALUES ($1,$2,'İlave İş','A','B',$3,'YATONET 360',$4,$5)`, [`${d.dosyaNo}-${no}`, d.kimlik, f, dr, o.K.ds]);
    await e('D1', 100, 'Onaylandı'); await new Promise((r) => setTimeout(r, 5)); await e('D2', 50, 'Reddedildi'); await new Promise((r) => setTimeout(r, 5)); await e('D3', 25, 'Onaylandı');
    const l = (await o.ist('GET', `/api/dosya/${d.kimlik}/degisiklikler`, await o.gir('ds'))).json() as { kumulatif_eur: string }[];
    expect(l.map((x) => Number(x.kumulatif_eur))).toEqual([100, 100, 125]);
  });
});

describe('rıza metni ve arama kapsamı (YG-1205, YG-1210, YG-1220)', () => {
  it('KVKK-02 iki dilde yüklü; aydınlatma metni dil seçimiyle gelir', async () => {
    const r = (await o.sup.query(`SELECT dil FROM hukuki_metin WHERE kod = 'KVKK-02' ORDER BY dil`)).rows.map((x) => x.dil); expect(r).toEqual(['en', 'tr']);
    const c = await o.gir('ds');
    const en = await o.ist('GET', '/api/ilk-giris/metin/riza?dil=en', c); expect(en.statusCode, en.body).toBe(200); expect(en.json().dil).toBe('en'); expect(en.json().govde.join(' ')).toContain('Explicit Consent');
    expect((await o.ist('GET', '/api/ilk-giris/metin/aydinlatma?dil=tr', c)).json().dil).toBe('tr');
  });
});

describe('keşif mahsubu satırı ve klas hatırlatması (YG-864, YG-334)', () => {
  it('proforma mahsup satırını ayrı gösterir, mahsup yoksa göstermez', async () => {
    const { odemeTanim } = await import('../src/belge_uret.js');
    const d = await o.dosyaAc({}, {}); const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, kesif_mahsubu_eur, hazirlayan_ref) VALUES ($1,$2,'Onarım','Yat Sahibi',20,150,$3) RETURNING kimlik`, [`T-${++n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, onay_durumu) VALUES ($1,1,'İşçilik','Onarım','İşçilik',1,'Adet',500,1000,1000,'Onaylandı')`, [t]);
    const f = (await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',850,170,1020,$4) RETURNING kimlik`, [`PF-${++n}`, d.kimlik, t, o.K.ts])).rows[0].kimlik;
    const m = JSON.stringify((await odemeTanim(o.db, 'Proforma', f, 'KOD', 'http://x')).t); expect(m).toContain('Keşif Ücreti Mahsubu'); expect(m).toContain('− 150,00');
    await o.sup.query(`UPDATE fiyat_teklifi SET kesif_mahsubu_eur = 0 WHERE kimlik = $1`, [t]);
    expect(JSON.stringify((await odemeTanim(o.db, 'Proforma', f, 'KOD', 'http://x')).t)).not.toContain('Keşif Ücreti Mahsubu');
  });
  it('klas bildirimi başlangıçtan 48 saat önce biter', async () => {
    const { klasBildirimSonu } = await import('../src/firma_ek.js');
    expect(klasBildirimSonu('2027-03-10T12:00:00Z')?.toISOString()).toBe('2027-03-08T12:00:00.000Z'); expect(klasBildirimSonu(null)).toBeUndefined();
  });
});

describe('teklifte KDV hesabı (KDV-1)', () => {
  const kur = async (muhatap: string, musteriTuru = 'Bireysel Müşteri') => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET musteri_turu = $2 WHERE kimlik = $1`, [d.kimlik, musteriTuru]);
    const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, ara_toplam_eur, hazirlayan_ref) VALUES ($1,$2,'Onarım',$3,20,1000,$4) RETURNING kimlik`, [`T-${++n}`, d.kimlik, muhatap, o.K.ts])).rows[0].kimlik as string;
    for (const [i, b, x] of [[1, 'İşçilik', 600], [2, 'Malzeme', 400]] as [number, string, number][]) await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur) VALUES ($1,$2,'K','Onarım',$3,1,'Adet',$4,$4,$4)`, [t, i, b, x]);
    return { d, t };
  };
  const oku = async (t: string) => { const r = (await o.sup.query(`SELECT kdv_tutari_eur k, tevkifat_eur v, genel_toplam_eur g FROM fiyat_teklifi WHERE kimlik = $1`, [t])).rows[0]; return [Number(r.k), Number(r.v), Number(r.g)]; };
  it('standart, istisna ve tevkifat doğru hesaplanır; istisnada KDV yalnız malzemeden', async () => {
    const { teklifKdvUygula } = await import('../src/teklif.js');
    const a = await kur('Yat Sahibi'); expect(await teklifKdvUygula(o.db, a.t)).toBe(1200); expect(await oku(a.t)).toEqual([200, 0, 1200]);
    const b = await kur('Yat Sahibi');
    const bk = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('İ','K','Gizli','Dosya',$1,'Sistem',current_date,$2) RETURNING kimlik`, [b.d.kimlik, o.K.ds])).rows[0].kimlik;
    const tr = (await o.sup.query(`INSERT INTO taraf (taraf_no, kisi_turu, musteri_turu, unvan_ad_soyad, taraf_rolleri, olusturan_ref, kdv_istisna_belge_ref, kdv_istisna_bitis) VALUES ($1,'Gerçek kişi','Bireysel Müşteri','İ','{Yat Sahibi}',$2,$3,'2099-01-01') RETURNING kimlik`, [`TR-K${++n}`, o.K.ds, bk])).rows[0].kimlik;
    await o.sup.query(`UPDATE yat SET yat_sahibi_ref = $2 WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [b.d.kimlik, tr]);
    expect(await teklifKdvUygula(o.db, b.t)).toBe(1080); expect(await oku(b.t)).toEqual([80, 0, 1080]);
    const c = await kur('Sigorta Şirketi', 'Sigorta Şirketi');
    await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi, olusturan_ref) VALUES ($1,'Tevkif Sigorta',$2)`, [c.d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO sigorta_vergi_profili (sigortaci_adi, kdv_uygulamasi, tevkifat_pay, tevkifat_payda, yururluk, dayanak_belge_ref, kaydeden_ref) VALUES ('Tevkif Sigorta','KDV tevkifatlı',9,10,'2020-01-01',$1,$2)`, [bk, o.K.ds]);
    expect(await teklifKdvUygula(o.db, c.t)).toBe(1020); expect(await oku(c.t)).toEqual([200, 180, 1020]);
  });
});

describe('sağlayıcı matrisi, parametreler, dışa aktarım, kalıcı hata (YG-1299, YG-826, YG-1078, YG-1310)', () => {
  it('matris: yurt dışında m.9 ve maskeleme zorunlu; sözleşme yoksa görev açılır', async () => {
    const c = await o.gir('hud'); const g = { baglanti: 'WhatsApp', saglayici: 'Meta', veriYeri: 'Yurt Dışı', erisim: 'API' };
    expect((await o.ist('POST', '/api/saglayici-matrisi', await o.gir('ds'), g)).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/saglayici-matrisi', c, g)).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/saglayici-matrisi', c, { ...g, ulke: 'İrlanda', m9: 'Standart sözleşme', maskeleme: 'Kod ve fiyat gönderilmez' })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/saglayici-matrisi', c, { ...g, ulke: 'İrlanda', m9: 'Standart sözleşme', maskeleme: 'Kod ve fiyat gönderilmez', kurulBildirim: '2026-11-10' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.kart('KVKK Veri İşleyen Sözleşmesi', r.json().kimlik)).durum).toBe('Bekliyor');
    expect((await o.ist('GET', '/api/saglayici-matrisi', c)).json().length).toBeGreaterThan(0);
  });
  it('parametre: gerekçe zorunlu, geçmiş tutulur, fiyat katsayısı görünmez ve değişmez', async () => {
    const c = await o.gir('tid');
    const l = (await o.ist('GET', '/api/parametreler', c)).json() as { kod: string }[]; expect(l.some((x) => x.kod === 'kdv_orani')).toBe(true); expect(l.some((x) => x.kod === 'fiyat_katsayisi')).toBe(false);
    expect((await o.ist('POST', '/api/parametre/fiyat_katsayisi', c, { deger: 2, gerekce: 'x' })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/parametre/masraf_yemek_eur', c, { deger: 30 })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/parametre/masraf_yemek_eur', await o.gir('gmy'), { deger: 30, gerekce: 'Tarife' })).statusCode).toBe(403); // YG-853
    const pr = await o.ist('POST', '/api/parametre/masraf_yemek_eur', c, { deger: 30, gerekce: 'Tarife' }); expect(pr.json().durum).toBe('Onaya Gönderildi');
    expect((await o.ist('POST', '/api/parametre/masraf_yemek_eur', c, { deger: 31, gerekce: 'X' })).statusCode).toBe(409);
    expect((await o.sup.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'masraf_yemek_eur'`)).rows[0].deger).toBe('25');
    const pk = await o.kart('Parametre Değişikliği', pr.json().oneri);
    expect((await o.karar(pk.kimlik, 'gmy', 'Onaya Gönder', 'Uygun')).statusCode).toBe(200);
    expect((await o.karar(pk.kimlik, 'ceo1', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT eski, yeni FROM parametre_gecmisi WHERE kod = 'masraf_yemek_eur'`)).rows.map((x) => [Number(x.eski), Number(x.yeni)])).toEqual([[25, 30]]);
    expect((await o.ist('GET', '/api/parametreler', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/parametre/rapor_sure_saat_normal', c, { deger: 70, gerekce: 'X' })).statusCode).toBe(403); // YG-1039
    expect((await o.ist('POST', '/api/parametre/rapor_sure_saat_normal', await o.gir('tod'), { deger: 70, gerekce: 'Sezon yoğunluğu' })).json().durum).toBe('Onaya Gönderildi');
  });
  it('yasal ayıp CSV yalnız Direktör ve üstüne', async () => {
    expect((await o.ist('GET', '/api/rapor/yasal-ayip.csv', await o.gir('mfm'))).statusCode).toBe(404);
    const r = await o.ist('GET', '/api/rapor/yasal-ayip.csv', await o.gir('tid')); expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toContain('text/csv'); expect(r.body).toContain('Dosya No');
  });
  it('kalıcı gönderim hatası yeniden denenmez, geçici hata yeniden denenir', async () => {
    const { kuyrukIsle } = await import('../src/bildirim.js');
    await o.sup.query(`INSERT INTO gonderim (olay_anahtari, kanal, hedef, konu, metin, plan_zamani) VALUES ('kh:1','SMS','+905550009901','K','M',now() - interval '1 minute'), ('kh:2','SMS','+905550009902','K','M',now() - interval '1 minute')`);
    const asil = o.sms.gonder; o.sms.gonder = async (tel: string) => { throw Object.assign(new Error(tel.endsWith('01') ? 'Geçersiz numara' : 'Zaman aşımı'), {}); };
    try { await kuyrukIsle({ db: o.db, sms: o.sms, eposta: o.posta } as never); } finally { o.sms.gonder = asil; }
    const r = (await o.sup.query(`SELECT olay_anahtari, durum, deneme FROM gonderim WHERE olay_anahtari IN ('kh:1','kh:2') ORDER BY olay_anahtari`)).rows;
    expect(r[0]).toMatchObject({ durum: 'Başarısız', deneme: 1 }); expect(r[1]).toMatchObject({ durum: 'Bekliyor', deneme: 1 });
  });
});

describe('garanti çekek mahsubu (YG-1418)', () => {
  it('5.000 EUR üstü garanti kapsam kararı Teknik Müdür onayıyla yazılır (T-YG1416-TM)', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const gs = (await o.sup.query(`INSERT INTO garanti_sikayet (kayit_no, dosya_ref, kayit_turu, kanal, bildirim_zamani, oncelik, olusturan_ref) VALUES ($1,$2,'{Garanti bildirimi}','Telefon',now(),'Normal',$3) RETURNING kimlik`, [`GS-T${++n}`, d.kimlik, o.K.ds])).rows[0].kimlik;
    const r = await o.ist('POST', `/api/garanti-sikayet/${gs}/karar`, await o.gir('ty'), { karar: 'Ücretli İş', maliyet: 6000, gerekce: 'Kullanım hatası', nedenArastirmasi: 'Yanlış kullanım' });
    expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ durum: 'Onay Bekleniyor', makam: 'Teknik Müdür' });
    expect((await o.sup.query(`SELECT karar FROM garanti_sikayet WHERE kimlik = $1`, [gs])).rows[0].karar).toBeNull();
    const k = await o.kart('Garanti Kapsam Onayı', gs);
    expect((await o.karar(k.kimlik, 'tm', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT karar, duzeltme_maliyeti::float m FROM garanti_sikayet WHERE kimlik = $1`, [gs])).rows[0]).toEqual({ karar: 'Ücretli İş', m: 6000 });
    await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref = $1`, [d.kimlik]); // kapasite diğer testleri etkilemesin
  });
  it('çerçeve sözleşmesi olmayan sicilli sigorta şirketinde işaret, görev ve GMY bildirimi (T-YG1552-CERCEVE)', async () => {
    const { cerceveKontrol } = await import('../src/dosya.js');
    const d = await o.dosyaAc({}, {});
    await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Çerçevesiz Sigorta AŞ','Çözüm Ortağı',$2)`, [`S-CS${++n}`, o.K.ds]);
    if (!(await o.sup.query(`UPDATE dosya_sigorta_kaydi SET sigortaci_adi = 'ÇERÇEVESİZ SİGORTA AŞ' WHERE dosya_ref = $1`, [d.kimlik])).rowCount) await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi, olusturan_ref) VALUES ($1,'ÇERÇEVESİZ SİGORTA AŞ',$2)`, [d.kimlik, o.K.ds]);
    await cerceveKontrol(o.db, d.kimlik, d.dosyaNo);
    expect((await o.sup.query(`SELECT cerceve_sozlesme_yok FROM dosya_sigorta_kaydi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].cerceve_sozlesme_yok).toBe(true);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Sigorta Çerçeve Sözleşmesi' AND nesne_kimligi = $1`, [d.kimlik])).rows[0].n).toBe(1);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [o.K.gmy, `cerceve-yok:${d.kimlik}`])).rows[0].n).toBe(1);
  });
  it('garanti kararında LGM\'nin ödediği çekek firma hakedişine mahsup önerisi olur; yat sahibine kalem açılmaz', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Firma GM','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-GM${++n}`, o.K.ds])).rows[0].kimlik;
    const te = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Tesis GM','Tesis',$2) RETURNING kimlik`, [`S-TG${++n}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Y','K',$4)`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.ds]);
    const tt = (await o.sup.query(`INSERT INTO tesis_talebi (dosya_ref, kurulus_ref, tur, hedef_tarih, olusturan_ref) VALUES ($1,$2,'Çekek Randevusu',current_date,$3) RETURNING kimlik`, [d.kimlik, te, o.K.ds])).rows[0].kimlik;
    const bl = await o.belge(d.kimlik, 'ds');
    await o.sup.query(`INSERT INTO tesis_faturasi (kurulus_ref, talep_ref, fatura_no, tarih, kalem, tutar_eur, belge_ref, giren_ref) VALUES ($1,$2,'TF-1',current_date,'Çekek',400,$3,$4)`, [te, tt, bl, o.K.ds]);
    const gs = (await o.sup.query(`INSERT INTO garanti_sikayet (kayit_no, dosya_ref, kayit_turu, kanal, bildirim_zamani, oncelik, olusturan_ref) VALUES ($1,$2,'{Garanti bildirimi}','Telefon',now(),'Normal',$3) RETURNING kimlik`, [`GS-${++n}`, d.kimlik, o.K.ds])).rows[0].kimlik;
    const r = await o.ist('POST', `/api/garanti-sikayet/${gs}/karar`, await o.gir('ty'), { karar: 'Garanti', gerekce: 'Garanti kapsamında', nedenArastirmasi: 'Conta yorgunluğu' }); expect(r.statusCode, r.body).toBe(200);
    const m = (await o.sup.query(`SELECT kimlik, kurulus_ref, tutar_eur, statu FROM hakedis_mahsubu WHERE dosya_ref = $1`, [d.kimlik])).rows;
    expect(m).toHaveLength(1); expect(m[0]).toMatchObject({ kurulus_ref: f, statu: 'Onayda' }); expect(Number(m[0].tutar_eur)).toBe(400);
    expect((await o.kart('Hakediş Mahsubu', m[0].kimlik)).durum).toBe('Bekliyor');
    await o.ist('POST', `/api/garanti-sikayet/${gs}/karar`, await o.gir('ty'), { karar: 'Garanti', gerekce: 'Tekrar' });
    expect((await o.sup.query(`SELECT count(*) n FROM hakedis_mahsubu WHERE dosya_ref = $1`, [d.kimlik])).rows[0].n).toBe('1');
    { // T-YG1685-DOGRULAMA: garanti kararı Kalite Kontrolör yeniden doğrulama görevini açar; sonuç garanti kaydına bağlanır
      expect(await o.kart('Garanti Yeniden Doğrulama', gs)).toBeDefined();
      expect((await o.ist('POST', `/api/garanti-sikayet/${gs}/yeniden-dogrulama`, await o.gir('ds'), { sonuc: 'Doğrulandı' })).statusCode).toBe(403);
      await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Kalite Kontrolör',$2)`, [d.kimlik, o.K.ty]);
      expect((await o.ist('POST', `/api/garanti-sikayet/${gs}/yeniden-dogrulama`, await o.gir('ty'), { sonuc: 'Doğrulandı' })).statusCode).toBe(200);
      expect((await o.sup.query(`SELECT yeniden_dogrulama_sonucu s FROM garanti_sikayet WHERE kimlik = $1`, [gs])).rows[0].s).toBe('Doğrulandı');
    }
  });
});

describe('onaysız alt yüklenici (YG-411)', () => {
  it('onaylı talepte olmayan ad engellenir; sahada tespit görev açar', async () => {
    const { altYukleniciEngeli } = await import('../src/kalan.js');
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Firma AY','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-AY${++n}`, o.K.ds])).rows[0].kimlik;
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Y','K',$4) RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO alt_yuklenici_talebi (is_emri_ref, alt_yuklenici, kapsam, durum, talep_eden_ref) VALUES ($1,'İzmir Boya Ltd','Boya','Onaylandı',$2), ($1,'Bekleyen Ltd','Kaynak','Onayda',$2)`, [e, o.K.ds]);
    expect(await altYukleniciEngeli(o.db, e, ['izmir  boya ltd'])).toBeNull();
    expect(await altYukleniciEngeli(o.db, e, ['İzmir Boya Ltd', 'Bekleyen Ltd'])).toContain('Bekleyen Ltd');
    const u = `/api/is-emri/${e}/alt-yuklenici-tespit`;
    expect((await o.ist('POST', u, await o.gir('ds'), { ad: 'İzmir Boya Ltd' })).json()).toEqual({ onayli: true });
    expect((await o.ist('POST', u, await o.gir('ds'), { ad: 'Habersiz Usta' })).json()).toEqual({ onayli: false });
    expect((await o.kart('Onaysız Alt Yüklenici', e)).durum).toBe('Bekliyor');
  });
});

describe('ekipman ve takvim (YG-533, YG-1472)', () => {
  it('ekipman: uyarı 30 günde, süresi geçen kullanılamaz; yetkisiz göremez', async () => {
    const { sureUyariIsle } = await import('../src/uyum.js');
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Firma EK','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-EK${++n}`, o.K.ds])).rows[0].kimlik;
    const c = await o.gir('sc'); const u = `/api/firma/${f}/ekipman`; const gun = (x: number) => new Date(Date.now() + x * 86_400_000).toISOString().slice(0, 10);
    expect((await o.ist('POST', u, await o.gir('ds'), { ad: 'Vinç', seri: 'V1', bakim: gun(30) })).statusCode).toBe(404);
    expect((await o.ist('POST', u, c, { ad: 'Vinç', seri: 'V1' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, c, { ad: 'Vinç', seri: 'V1', bakim: gun(30) })).statusCode).toBe(200);
    expect((await o.ist('POST', u, c, { ad: 'Kaynak', seri: 'K1', kalibrasyon: gun(-1) })).statusCode).toBe(200);
    await sureUyariIsle(o.db);
    const l = (await o.ist('GET', u, c)).json() as { seri_no: string; kullanilabilir: boolean }[];
    expect(l.find((x) => x.seri_no === 'V1')!.kullanilabilir).toBe(true); expect(l.find((x) => x.seri_no === 'K1')!.kullanilabilir).toBe(false);
    expect(Number((await o.sup.query(`SELECT count(*) n FROM zamanlanmis_is WHERE ad = 'firma_ekipman'`)).rows[0].n)).toBe(1);
  });
  it('takvim: arife yarım gün, tatil sayılmaz; yalnız CEO/GMY girer', async () => {
    const { isGunuSonu } = await import('../src/teklif.js');
    expect((await o.ist('POST', '/api/takvim', await o.gir('tid'), { tarih: '2031-01-06', ad: 'X' })).statusCode).toBe(404);
    const c = await o.gir('gmy');
    const bas = new Date('2031-01-06T06:00:00Z'); // Pazartesi
    const once = await isGunuSonu(o.db, bas, 2);
    expect((await o.ist('POST', '/api/takvim', c, { tarih: '2031-01-07', ad: 'Deneme Tatili' })).statusCode).toBe(200);
    expect((await isGunuSonu(o.db, bas, 2)).getTime() - once.getTime()).toBe(86_400_000);
    expect((await o.ist('POST', '/api/takvim', c, { tarih: '2031-01-07', ad: 'Deneme Arifesi', arife: true })).statusCode).toBe(200);
    expect((await isGunuSonu(o.db, bas, 2)).getTime() - once.getTime()).toBe(86_400_000); // 0,5 + 1 + 0,5 eşiği üçüncü güne kaydırır
    await o.ist('POST', '/api/takvim', c, { tarih: '2031-01-07', sil: true });
    expect((await isGunuSonu(o.db, bas, 2)).getTime()).toBe(once.getTime());
  });
});

describe('saklama başlangıcı (YG-1223)', () => {
  it('dış kullanıcı hesabı taraf olduğu son dosyanın kapanmasından 5 yıl geçmeden imha listesine girmez', async () => {
    const { imhaListesiUret } = await import('../src/kvkk.js');
    const h = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, dogrulama_yontemi, hesap_durumu, kapanma_zamani) VALUES ('Müşteri/Kurum','Sigorta Şirketi / Eksper','Broker K','brk.${++n}','brk${n}@d.local','+90554${String(n).padStart(7, '0')}','SMS kodu','Kapalı',now() - interval '7 years') RETURNING kimlik`)).rows[0].kimlik;
    const d = await o.dosyaAc({}, {});
    await o.sup.query(`UPDATE dosya SET statu = 'Kapalı', kapanma_nedeni = 'Tamamlandı', kapanis_zamani = now() - interval '2 years' WHERE kimlik = $1`, [d.kimlik]);
    await o.sup.query(`UPDATE dosya_tarafi SET kullanici_ref = $2 WHERE kimlik = (SELECT kimlik FROM dosya_tarafi WHERE dosya_ref = $1 LIMIT 1)`, [d.kimlik, h]);
    await o.sup.query(`DELETE FROM zamanlanmis_is WHERE ad = 'imha_listesi'`);
    const l = await imhaListesiUret(o.db, new Date('2027-01-15T09:00:00Z'));
    expect(l).not.toBeNull();
    expect((await o.sup.query(`SELECT 1 FROM imha_kalemi WHERE liste_ref = $1 AND nesne_kimligi = $2`, [l, h])).rowCount).toBe(0);
    await o.sup.query(`UPDATE dosya SET kapanis_zamani = now() - interval '6 years' WHERE kimlik = $1`, [d.kimlik]);
    await o.sup.query(`DELETE FROM zamanlanmis_is WHERE ad = 'imha_listesi'`);
    const l2 = await imhaListesiUret(o.db, new Date('2027-07-15T09:00:00Z'));
    expect((await o.sup.query(`SELECT 1 FROM imha_kalemi WHERE liste_ref = $1 AND nesne_kimligi = $2`, [l2, h])).rowCount).toBe(1);
  });
});

describe('kurumsal belge süreleri (YG-532)', () => {
  it('LGM poliçesi 45 günde, acente yetkisi 30 günde uyarır; yenilenen eski belge uyarmaz', async () => {
    const { sureUyariIsle } = await import('../src/uyum.js');
    const gun = (x: number) => new Date(Date.now() + x * 86_400_000).toISOString().slice(0, 10); const c = await o.gir('hud');
    expect((await o.ist('POST', '/api/kurum-belgesi', await o.gir('ds'), { tur: 'İmza Sirküleri', ad: 'X', bitis: gun(10) })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/kurum-belgesi', c, { tur: 'Poliçe', ad: 'X', bitis: gun(10) })).statusCode).toBe(400);
    const p = (await o.ist('POST', '/api/kurum-belgesi', c, { tur: 'LGM Sigorta Poliçesi', ad: 'Mesleki Sorumluluk', karsiTaraf: 'Sigortacı A', bitis: gun(40) })).json().kimlik;
    const a = (await o.ist('POST', '/api/kurum-belgesi', c, { tur: 'Acente Yetki Belgesi', ad: 'Acente B', bitis: gun(25) })).json().kimlik;
    const e = (await o.ist('POST', '/api/kurum-belgesi', c, { tur: 'İmza Sirküleri', ad: 'Eski Sirküler', bitis: gun(10) })).json().kimlik;
    await o.ist('POST', '/api/kurum-belgesi', c, { tur: 'İmza Sirküleri', ad: 'Yeni Sirküler', bitis: gun(700), yenilenen: e });
    await sureUyariIsle(o.db);
    const z = (await o.sup.query(`SELECT anahtar FROM zamanlanmis_is WHERE ad = 'kurum_belgesi'`)).rows.map((r) => r.anahtar);
    expect(z).toEqual(expect.arrayContaining([`${p}:45`, `${a}:30`])); expect(z.some((x) => x.startsWith(e))).toBe(false);
  });
});

describe('tür bazlı belge erişimi (YG-609, YG-1075)', () => {
  it('firma müşteri ve fiyat belgesini, müşteri iş emrini, dış kullanıcı Kurumsal sınıfı göremez', async () => {
    const { disTurEngeli } = await import('../src/belge.js');
    const g = (belge_turu: string, bilgi_sinifi = 'Gizli') => ({ belge_turu, bilgi_sinifi });
    expect(disTurEngeli('İş Birliği Firması', g('Fiyat Teklifi'))).toBe(true); expect(disTurEngeli('İş Birliği Firması', g('Teknik Rapor'))).toBe(true);
    expect(disTurEngeli('İş Birliği Firması', g('İş Emri'))).toBe(false); expect(disTurEngeli('Tedarikçi', g('Proforma'))).toBe(true);
    expect(disTurEngeli('Bireysel Müşteri (Yat Sahibi/Yetkilisi)', g('İş Emri'))).toBe(true); expect(disTurEngeli('Bireysel Müşteri (Yat Sahibi/Yetkilisi)', g('Fiyat Teklifi'))).toBe(false);
    expect(disTurEngeli('Sigorta Şirketi / Eksper', g('Uyuşmazlık Paketi'))).toBe(true); expect(disTurEngeli('Sigorta Şirketi / Eksper', g('Fotoğraf', 'Kurumsal'))).toBe(true);
    expect(disTurEngeli('LGM İç Rolü', g('Uyuşmazlık Paketi', 'Kurumsal'))).toBe(false);
  });
});

describe('kritik pozisyon vekilleri (YG-1058)', () => {
  it('Direktöre tablodaki vekil atanır; Hukuk ve Uyum vekili yalnız hazırlık yapar, onay GMY\'ye düşer', async () => {
    const { kartAc } = await import('../src/is_motoru.js'); const { rolId } = await import('../src/ihbar.js');
    const g = await o.gir('gmy'); const gun = (x: number) => new Date(Date.now() + x * 86_400_000).toISOString().slice(0, 10);
    const rol = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
    const ata = (asil: string, r: string, vekil: string) => o.ist('POST', '/api/vekalet', g, { asil, rol: r, vekil, neden: 'İzin', kapsam: 'Açık işler', baslangic: gun(0), bitis: gun(5) });
    expect((await ata(o.K.tod!, await rol('Teknik ve Operasyon Direktörü'), o.K.hud!)).statusCode).toBe(400); // tabloda değil
    const r = await ata(o.K.hud!, await rol('Hukuk ve Uyum Direktörü'), o.K.huu!); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT yalniz_hazirlik FROM vekalet WHERE kimlik = $1`, [r.json().kimlik])).rows[0].yalniz_hazirlik).toBe(true);
    const k = await kartAc(o.db, { tur: 'Hukuk Onayı Deneme', baslik: 'Deneme', hazirlayan: o.K.ds, zincir: [await rolId(o.db, 'Hukuk ve Uyum Direktörü')] });
    expect((await o.karar(k, 'huu', 'Onayla')).statusCode).not.toBe(200);
    const s2 = await o.karar(k, 'gmy', 'Onayla'); expect(s2.statusCode, s2.body).toBe(200);
    await o.sup.query(`UPDATE vekalet SET durum = 'Kapalı' WHERE kimlik = $1`, [r.json().kimlik]);
    // YG-1660: BT ve Firma Yönetimi Direktörüne GMY ancak Bilgi İşlem Müdürü de yokken vekâlet eder.
    const btd = await rol('Bilgi Teknolojileri ve Firma Yönetimi Direktörü');
    expect((await ata(o.K.btd!, btd, o.K.gmy!)).statusCode).toBe(400);
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, personel_durumu, guncelleyen_ref) VALUES ($1, '2026-01-01', 'İzinli', $1) ON CONFLICT (kullanici_ref) DO UPDATE SET personel_durumu = 'İzinli'`, [o.K.bim]);
    const v = await ata(o.K.btd!, btd, o.K.gmy!); expect(v.statusCode, v.body).toBe(200);
    await o.sup.query(`UPDATE vekalet SET durum = 'Kapalı' WHERE kimlik = $1`, [v.json().kimlik]); await o.sup.query(`UPDATE personel_karti SET personel_durumu = 'Görevde' WHERE kullanici_ref = $1`, [o.K.bim]);
  });
});

describe('günlük ve yönetim hesabı (YG-1001)', () => {
  it('ayrıcalıklı rol yalnız yönetim hesabına, yönetim hesabına yalnız ayrıcalıklı rol', async () => {
    const { hesapAyrimEngeli } = await import('../src/erisim.js');
    const r = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
    const yon = (await o.sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE ayricalikli_mi LIMIT 1`)).rows[0].kimlik as string;
    expect(await hesapAyrimEngeli(o.db, o.K.sy!, await r('Sistem Yöneticisi'))).toContain('günlük iş hesabına');
    expect(await hesapAyrimEngeli(o.db, yon, await r('Dosya Sorumlusu'))).toContain('Yönetim hesabına');
    expect(await hesapAyrimEngeli(o.db, yon, await r('Sistem Yöneticisi'))).toBeNull();
    expect(await hesapAyrimEngeli(o.db, o.K.ds!, await r('Teknik Uzman'))).toBeNull();
  });
});

describe('atama kapanış kontrolü (YG-312)', () => {
  it('devredilen kişinin paylaşım bağlantısı kapanır; indirdiği belge için görev açılır', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const bl = await o.belge(d.kimlik, 'ds');
    const sr = (await o.sup.query(`SELECT kimlik FROM belge_surum WHERE belge_ref = $1 LIMIT 1`, [bl])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO paylasim_baglantisi (surum_ref, belirtec_ozeti, alici_eposta, son_gecerlilik, olusturan_ref) VALUES ($1,$2,'a@b.local',now() + interval '2 days',$3)`, [sr, `oz-${d.kimlik}`, o.K.ds]);
    await o.ist('GET', `/api/belge/${bl}/surum/1/indir`, await o.gir('ds'));
    await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, dogrulama_yontemi) VALUES ('İç Kullanıcı','LGM İç Rolü','Yeni DS',$1,$1,'SMS kodu') RETURNING kimlik`, [`yds${d.kimlik.slice(0, 6)}@d.local`]).then(async (r) => {
      await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = 'Dosya Sorumlusu'`, [r.rows[0].kimlik]);
      const a = await o.ist('POST', `/api/dosya/${d.kimlik}/ekip`, await o.gir('opm'), { kullanici: r.rows[0].kimlik, rol: 'Dosya Sorumlusu', devirNotu: 'Devir' }); expect(a.statusCode, a.body).toBe(200);
    });
    expect((await o.sup.query(`SELECT iptal_zamani FROM paylasim_baglantisi WHERE belirtec_ozeti = $1`, [`oz-${d.kimlik}`])).rows[0].iptal_zamani).not.toBeNull();
    expect((await o.kart('Atama Kapanış Kontrolü', d.kimlik)).sahip_kullanici_ref).toBe(o.K.ds);
  });
});

describe('vekilin dosya erişimi (YG-1056)', () => {
  it('vekil vekâlet süresince asılın dosyasına erişir, bitince erişim kapanır', async () => {
    const { dosyaErisimi } = await import('../src/dosya.js');
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    expect(await dosyaErisimi(o.db, o.K.iks!, d.kimlik)).toBe(false);
    const rol = (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Dosya Sorumlusu'`)).rows[0].kimlik;
    const id = `VKL-2026-${String(9000 + (++n)).padStart(4, '0')}`;
    await o.sup.query(`INSERT INTO vekalet (kimlik, asil_ref, vekil_ref, rol_ref, vekalet_nedeni, kapsam, baslangic_tarihi, bitis_tarihi, atayan_ref) VALUES ($1,$2,$3,$4,'İzin','Açık işler',current_date,current_date + 3,$5)`, [id, o.K.ds, o.K.iks, rol, o.K.opm]);
    expect(await dosyaErisimi(o.db, o.K.iks!, d.kimlik)).toBe(true);
    await o.sup.query(`UPDATE vekalet SET durum = 'Kapalı' WHERE kimlik = $1`, [id]);
    expect(await dosyaErisimi(o.db, o.K.iks!, d.kimlik)).toBe(false);
  });
});

describe('tam ziya teslimi (YG-079)', () => {
  it('iş yapılmış dosyada teslim kaydı olmadan tam ziya kapanışı olmaz; teslimi yalnız Dosya Sorumlusu kaydeder', async () => {
    const { kapanisEksikleri } = await import('../src/saha.js');
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    expect(await kapanisEksikleri(o.db, { kimlik: d.kimlik }, 'Tam Ziya')).not.toContain('Tam Ziya Teslimi Bekliyor');
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'TZ','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-TZ${Date.now()}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K',$4)`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.ds]);
    expect(await kapanisEksikleri(o.db, { kimlik: d.kimlik }, 'Hükmi Tam Ziya')).toContain('Tam Ziya Teslimi Bekliyor');
    const u = `/api/dosya/${d.kimlik}/tam-ziya-teslim`;
    expect((await o.ist('POST', u, await o.gir('oy'), { teslimAlan: 'Yat Sahibi: A' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('ds'), {})).statusCode).toBe(400);
    expect((await o.ist('POST', u, await o.gir('ds'), { teslimAlan: 'Yat Sahibi: A' })).statusCode).toBe(200);
    expect((await o.ist('POST', u, await o.gir('ds'), { teslimAlan: 'Yat Sahibi: A' })).statusCode).toBe(409);
    expect(await kapanisEksikleri(o.db, { kimlik: d.kimlik }, 'Hükmi Tam Ziya')).not.toContain('Tam Ziya Teslimi Bekliyor');
  });
});

describe('firma kapsama raporu (YG-1660)', () => {
  it('aktif firması olmayan branş-bölge boş görünür; aday raporu ayrı; ayda bir bildirilir; yetkisiz role kapalı', async () => {
    const { firmaKapsamaRaporu, kapsamaRaporIsle } = await import('../src/firma_ek.js');
    const ek = async (asama: string, brans: string) => { const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ($1,'KF','Çözüm Ortağı',$2,'Aktif',$3) RETURNING kimlik`, [`S-KR${Date.now()}${Math.random()}`, asama, o.K.ds])).rows[0].kimlik; await o.sup.query(`INSERT INTO brans_yetkinligi (kurulus_ref, ana_brans, bolge) VALUES ($1,$2,'Ege')`, [f, brans]); };
    await ek('Onaylı', 'Kapsama Boya'); await ek('Aday', 'Kapsama Elektrik');
    const r = await firmaKapsamaRaporu(o.db);
    expect(r.find((x) => x.ana_brans === 'Kapsama Boya')!.firma).toBe(1); expect(r.find((x) => x.ana_brans === 'Kapsama Elektrik')!.firma).toBe(0);
    expect((await firmaKapsamaRaporu(o.db, true)).find((x) => x.ana_brans === 'Kapsama Elektrik')!.firma).toBe(1);
    const z = new Date('2031-03-01T08:00:00Z'); expect(await kapsamaRaporIsle(o.db, z)).toBe(2); expect(await kapsamaRaporIsle(o.db, z)).toBe(0);
    expect((await o.sup.query(`SELECT ozet FROM bildirim WHERE olay_anahtari = 'kapsama-raporu:2031-03' LIMIT 1`)).rows[0].ozet).toContain('Kapsama Elektrik (Ege)');
    expect((await o.ist('GET', '/api/rapor/firma-kapsama', await o.gir('gmy'))).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/rapor/firma-kapsama?aday=1', await o.gir('ds'))).statusCode).toBe(404);
  });
});

describe('firma işi bıraktı (YG-1660)', () => {
  it('iş emri kapanır, Dosya Sorumlusuna görev, Muhasebe ve Finans Müdürüne rücu bilgisi gider', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'FB','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-FB${Date.now()}`, o.K.ds])).rows[0].kimlik;
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K','Aktif',$4) RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO hakedis (hakedis_no, is_emri_ref, dosya_ref, sira_no, bu_donem_brut, kumulatif, kesinti, net, statu, giren_ref) VALUES ($1,$2,$3,1,1000,1000,50,950,'Doğrulandı',$4)`, [`${d.dosyaNo}-HK01`, e, d.kimlik, o.K.ds]);
    const u = `/api/is-emri/${e}/firma-birakti`;
    expect((await o.ist('POST', u, await o.gir('oy'), { gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('ds'), {})).statusCode).toBe(400);
    const r = await o.ist('POST', u, await o.gir('ds'), { gerekce: 'Firma sahadan çekildi' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [e])).rows[0].statu).toBe('İptal');
    expect((await o.kart('Firma Değiştir', e)).baslik).toContain('İşi Bıraktı');
    const b = (await o.sup.query(`SELECT b.ozet FROM bildirim b WHERE b.olay_anahtari = $1 AND b.kullanici_ref = $2`, [`firma-birakti:${e}`, o.K.mfm])).rows[0];
    expect(b.ozet).toContain('1.000,00 EUR'); expect(b.ozet).toContain('kesinti 50,00 EUR');
    expect((await o.ist('POST', u, await o.gir('ds'), { gerekce: 'Tekrar' })).statusCode).toBe(409);
  });
});

describe('bekleme ve muhafaza (YG-895)', () => {
  it('teklif iletildiği günden serbest süresiz günlük kalem; teklif sonuçlanınca durur; yalnız Dosya Sorumlusu girer', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const tesis = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu) VALUES ($1, 'Deneme Marina', 'Tesis') RETURNING kimlik`, [`S-BM${Date.now()}`])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO tesis_talebi (dosya_ref, kurulus_ref, tur, hedef_tarih, olusturan_ref) VALUES ($1,$2,'Çekek Randevusu', current_date, $3)`, [d.kimlik, tesis, o.K.ds]);
    const U = `/api/dosya/${d.kimlik}/bekleme-muhafaza`;
    expect((await o.ist('POST', U, await o.gir('ds'), { tesis, gunlukEur: 40 })).statusCode).toBe(409);
    const f = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, hazirlayan_ref, statu, gonderim_zamani) VALUES ($1,$2,'Yat Sahibi',20,$3,'Gönderildi', now() - interval '9 days') RETURNING kimlik`, [`T-BM${Date.now()}`, d.kimlik, o.K.ds])).rows[0].kimlik;
    expect((await o.ist('POST', U, await o.gir('oy'), { tesis, gunlukEur: 40 })).statusCode).toBe(403);
    expect((await o.ist('POST', U, await o.gir('ds'), { tesis, gunlukEur: 40 })).statusCode).toBe(200);
    const v = (await o.ist('GET', U, await o.gir('ds'))).json().kayitlar[0];
    expect(v.gun).toBe(10); expect(Number(v.toplam)).toBe(400); expect(v.haftalar.reduce((a: number, h: { gun: number }) => a + h.gun, 0)).toBe(10);
    await o.sup.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = 'Onaylandı', karar_zamani = now() WHERE kimlik = $1`, [f]);
    // BM-1 (portal notu) ve BM-2 (haftalık özet) onaylı metinleri.
    const bm = await import('../src/bekleme_muhafaza.js');
    expect(await bm.beklemeNotu(o.db, d.kimlik)).toMatch(/günlük 40,00 EUR.*10 gün, 400,00 EUR/);
    const pzt = new Date(); pzt.setUTCDate(pzt.getUTCDate() - ((pzt.getUTCDay() + 6) % 7)); pzt.setUTCHours(8, 0, 0, 0);
    await bm.beklemeMuhafazaIsle(o.db, pzt, 'http://x'); await bm.beklemeMuhafazaIsle(o.db, pzt, 'http://x');
    const gi = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE 'bm2:%' AND metin LIKE $1`, [`%${(await o.sup.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].dosya_no}%`])).rows;
    expect(gi.length).toBeGreaterThan(0); expect(gi[0].metin).toMatch(/bu hafta [1-7] gün, [0-9.]+,00 EUR; toplamda [0-9]+ gün/);
    const v2 = (await o.ist('GET', U, await o.gir('ds'))).json().kayitlar[0];
    expect(v2.bitis).toBeTruthy(); expect(v2.gun).toBe(10); // karar günü dahil, sonrası işlenmez
    await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref = $1 AND bitis_zamani IS NULL`, [d.kimlik]); // ekip kapasitesini sonraki testlere bırak
  });
});

describe('onaylı ilerleme fotoğrafı (YG-458)', () => {
  it('teknik ekip onaylar; yat sahibi yalnız onaylıyı görür, dosya adı gizli; kaldırılınca kapanır', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    await o.sup.query(`UPDATE dosya_tarafi SET kullanici_ref = $2 WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik, o.K.iks]);
    await o.sup.query(`UPDATE kullanici_hesabi SET kullanici_grubu = 'Kurumsal Müşteri', izin_adimi_zamani = now() WHERE kimlik = $1`, [o.K.iks]);
    await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT $1,'Çalışan','KVKK-04','R00','Türkçe','Web' WHERE NOT EXISTS (SELECT 1 FROM aydinlatma_kaydi WHERE ilgili_kisi_ref = $1 AND aydinlatma_metni = 'KVKK-04')`, [o.K.iks]);
    await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT $1,'R00','Türkçe' WHERE NOT EXISTS (SELECT 1 FROM kullanim_kosullari_kabulu WHERE kullanici_ref = $1)`, [o.K.iks]);
    const foto = await o.belge(d.kimlik, 'ds', 'Firma X Saha Foto', 'jpg'); const pdf = await o.belge(d.kimlik, 'ds', 'Rapor', 'pdf');
    const u = `/api/dosya/${d.kimlik}/ilerleme-fotografi`;
    expect((await o.ist('POST', u, await o.gir('oy'), { belge: foto, aciklama: 'Laminasyon tamamlandı' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('tu'), { belge: pdf, aciklama: 'R' })).statusCode).toBe(400);
    // YG-1170: teyit veya alan kapatma olmadan yayımlanmaz.
    expect((await o.ist('POST', u, await o.gir('tu'), { belge: foto, aciklama: 'Laminasyon tamamlandı' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, await o.gir('tu'), { belge: foto, aciklama: 'Laminasyon tamamlandı', teyit: true }); expect(r.statusCode, r.body).toBe(200);
    const c = await o.gir('iks');
    const pr = await o.ist('GET', `/api/portal/dosya/${d.kimlik}`, c); expect(pr.statusCode, pr.body).toBe(200); const p = pr.json();
    expect(p.fotograflar.map((x: { aciklama: string }) => x.aciklama)).toEqual(['Laminasyon tamamlandı']);
    const ind = await o.ist('GET', `/api/portal/fotograf/${r.json().kimlik}`, c); expect(ind.statusCode).toBe(200);
    expect(ind.headers['content-disposition']).not.toContain('Firma'); expect(ind.headers['content-disposition']).toMatch(/ilerleme-.*\.jpg/);
    expect((await o.ist('GET', `/api/portal/fotograf/${r.json().kimlik}`, await o.gir('mpm'))).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/ilerleme-fotografi/${r.json().kimlik}/kaldir`, await o.gir('ds'), {})).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/portal/fotograf/${r.json().kimlik}`, c)).statusCode).toBe(404);
    expect((await o.ist('GET', `/api/portal/dosya/${d.kimlik}`, c)).json().fotograflar).toEqual([]);
    // YG-462: video kanıtı da yayımlanır; indirilen adda firma adı yoktur.
    const vid = await o.belge(d.kimlik, 'ds', 'Firma X Deniz Denemesi', 'mp4');
    expect((await o.ist('POST', u, await o.gir('ds'), { belge: vid, aciklama: 'Deniz denemesi', maske: [{ x: 0, y: 0, w: 0.5, h: 0.5 }] })).statusCode).toBe(400);
    const rv = await o.ist('POST', u, await o.gir('ds'), { belge: vid, aciklama: 'Deniz denemesi', teyit: true }); expect(rv.statusCode, rv.body).toBe(200);
    const iv = await o.ist('GET', `/api/portal/fotograf/${rv.json().kimlik}`, c); expect(iv.headers['content-disposition']).toMatch(/ilerleme-.*\.mp4/);
    // YG-462: PDF kanıtı teyitle yayımlanır.
    const rp = await o.ist('POST', u, await o.gir('ds'), { belge: pdf, aciklama: 'Test raporu', teyit: true }); expect(rp.statusCode, rp.body).toBe(200);
    expect((await o.ist('GET', `/api/portal/fotograf/${rp.json().kimlik}`, c)).headers['content-disposition']).toMatch(/ilerleme-.*\.pdf/);
    // YG-1170: fotoğrafta kapatılan alan siyah boyanır; yat sahibine yalnız kapatılmış PNG kopya gider.
    const png = await o.belge(d.kimlik, 'ds', 'Firma X Logo', 'png');
    expect((await o.ist('POST', u, await o.gir('ds'), { belge: png, aciklama: 'Boya', maske: [{ x: 0.5, y: 0.5, w: 0.9, h: 0.9 }] })).statusCode).toBe(400);
    const rm = await o.ist('POST', u, await o.gir('ds'), { belge: png, aciklama: 'Boya', maske: [{ x: 0, y: 0, w: 1, h: 0.5 }] }); expect(rm.statusCode, rm.body).toBe(200);
    const im = await o.ist('GET', `/api/portal/fotograf/${rm.json().kimlik}`, c); expect(im.statusCode).toBe(200); expect(im.headers['content-disposition']).toMatch(/ilerleme-.*\.png/);
    expect(im.rawPayload.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});

describe('WhatsApp otomatik ileti süzgeci (MSJ-3)', () => {
  it('tutar ve doğrulama kodu ayıklanır; dosya numarası kalır', async () => {
    const { whatsappMetni } = await import('../src/bildirim.js');
    expect(whatsappMetni('Acil İlk Tedbir: LGM-2026-11-0001')).toBe('Acil İlk Tedbir: LGM-2026-11-0001');
    expect(whatsappMetni('Teklif 1.234,56 EUR onayınızda')).toBe('Teklif onayınızda');
    expect(whatsappMetni('Kodunuz 482913')).toBe('Kodunuz');
    expect(whatsappMetni('Ödeme TL 500 bekleniyor')).toBe('Ödeme bekleniyor');
  });
});

describe('ikinci kanal teyidi ve benzer alan adı (YG-1272)', () => {
  it('benzer alan adı yakalanır; aynı veya genel posta alan adı yakalanmaz', async () => {
    const { benzerAlanAdi } = await import('../src/teyit.js');
    const T = ['limitglobalmarine.com.tr', 'denizsigorta.com.tr'];
    expect(benzerAlanAdi('a@limitglobalrnarine.com.tr', T)).toBe('limitglobalmarine.com.tr');
    expect(benzerAlanAdi('a@limitglobalmarine.com', T)).toBe('limitglobalmarine.com.tr');
    expect(benzerAlanAdi('a@denizsigortaa.com.tr', T)).toBe('denizsigorta.com.tr');
    expect(benzerAlanAdi('a@denizsigorta.com.tr', T)).toBeNull();
    expect(benzerAlanAdi('a@gmail.com', [...T, 'gmail.com'])).toBeNull();
    expect(benzerAlanAdi('a@baskafirma.com', T)).toBeNull();
  });
  it('dış talep teyit bekler; teyit yalnız kayıtlı numarayla ve kaydedenden başkasınca; benzer alan güvenlik kaydı açar', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const tel = (await o.sup.query(`SELECT telefon FROM dosya_tarafi WHERE dosya_ref = $1 AND telefon IS NOT NULL LIMIT 1`, [d.kimlik])).rows[0].telefon as string;
    const u = `/api/dosya/${d.kimlik}/dis-talep`;
    expect((await o.ist('POST', u, await o.gir('oy'), { tur: 'Kapsam', kanal: 'E-posta' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, await o.gir('oy'), { tur: 'Teslim', kanal: 'E-posta', gonderen: 'kaptan@limitglobalrnarine.com.tr', ozet: 'Yatı başka marinaya teslim ediniz' }); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().uyari).toContain('benziyor');
    expect((await o.sup.query(`SELECT 1 FROM olay_kaydi WHERE olay_turu = 'Bilgi Güvenliği Göstergesi' AND dosya_ref = $1`, [d.kimlik])).rowCount).toBe(1);
    expect((await o.kart('İkinci Kanal Teyidi', r.json().kimlik)).baslik).toContain('Teslim');
    const t = `/api/dis-talep/${r.json().kimlik}/teyit`;
    expect((await o.ist('POST', t, await o.gir('oy'), { telefon: tel, sonuc: 'Teyit Edilmedi', not: 'N' })).statusCode).toBe(409);
    expect((await o.ist('POST', t, await o.gir('ds'), { telefon: '+905000000001', sonuc: 'Teyit Edilmedi', not: 'N' })).json().hata).toContain('kayıtlı');
    expect((await o.ist('POST', t, await o.gir('ds'), { telefon: tel, sonuc: 'Teyit Edilmedi', not: 'Yat sahibi böyle bir talep göndermediğini söyledi' })).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/dis-talepler`, await o.gir('ds'))).json()[0].durum).toBe('Teyit Edilmedi');
  });
});

describe('kısmi başarı: gönderim parçaları (YG-1145)', () => {
  it('dosyanın gönderimleri tamamlandı, bekliyor ve başarısız olarak ayrı görünür; hedef maskeli', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    for (const [n, du] of [[1, 'Gönderildi'], [2, 'Bekliyor'], [3, 'Başarısız']] as const) await o.sup.query(`INSERT INTO gonderim (olay_anahtari, kanal, hedef, konu, metin, durum) VALUES ($1,'E-posta',$2,'Konu','M',$3)`, [`deneme:${d.kimlik}:${n}`, `kisi${n}@ornek.local`, du]);
    const r = await o.ist('GET', `/api/dosya/${d.kimlik}/gonderimler`, await o.gir('ds')); expect(r.statusCode, r.body).toBe(200);
    const oz = r.json().ozet; expect(oz.basarisiz).toBe(1); expect(oz.bekliyor).toBeGreaterThanOrEqual(1); expect(oz.tamamlandi).toBeGreaterThanOrEqual(1);
    expect(r.json().satirlar.filter((x: { konu: string }) => x.konu === 'Konu').map((x: { parca: string }) => x.parca)).toEqual(expect.arrayContaining(['Bekliyor', 'Başarısız', 'Tamamlandı']));
    expect(r.body).not.toContain('kisi2@'); expect(r.body).toContain('k***@ornek.local');
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/gonderimler`, await o.gir('sy'))).statusCode).toBe(404);
  });
});

describe('belgede maliyet sızıntısı (YG-1158, YG-992)', () => {
  it('firma bedeli müşteri belgesinde geçerse belge durur; benzer sayı ve firma belgesi etkilenmez', async () => {
    const { belgeMaskeEngeli } = await import('../src/yetki_ek.js');
    const d = await o.dosyaAc({}, {});
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'MF','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-MF${Date.now()}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K',1234.5,$4)`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.ds]);
    expect(await belgeMaskeEngeli(o.db, 'Fiyat Teklifi', d.kimlik, 'Toplam 1.234,50 EUR')).toContain('maliyeti');
    expect(await belgeMaskeEngeli(o.db, 'Proforma', d.kimlik, 'Total 1,234.50 EUR')).toContain('maliyeti');
    expect(await belgeMaskeEngeli(o.db, 'Fiyat Teklifi', d.kimlik, 'Toplam 11.234,50 EUR')).toBeNull();
    expect(await belgeMaskeEngeli(o.db, 'İş Emri', d.kimlik, 'Bedel 1.234,50 EUR')).toBeNull();
  });
});

describe('firma belgesi müşteriye kapalı (YG-1074)', () => {
  it('iş emrine bağlı firma raporunu yat sahibi indiremez, dosya ekibi indirir', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    await o.sup.query(`UPDATE dosya_tarafi SET kullanici_ref = $2 WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik, o.K.iks]);
    await o.sup.query(`UPDATE kullanici_hesabi SET kullanici_grubu = 'Kurumsal Müşteri', izin_adimi_zamani = now() WHERE kimlik = $1`, [o.K.iks]);
    await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT $1,'Çalışan','KVKK-04','R00','Türkçe','Web' WHERE NOT EXISTS (SELECT 1 FROM aydinlatma_kaydi WHERE ilgili_kisi_ref = $1 AND aydinlatma_metni = 'KVKK-04')`, [o.K.iks]);
    await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT $1,'R00','Türkçe' WHERE NOT EXISTS (SELECT 1 FROM kullanim_kosullari_kabulu WHERE kullanici_ref = $1)`, [o.K.iks]);
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'FR','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-FR${Date.now()}`, o.K.ds])).rows[0].kimlik;
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, hazirlayan_ref) VALUES ($1,'KN',$2,$3,'M','K',$4) RETURNING kimlik`, [`${d.dosyaNo}-KN01`, d.kimlik, f, o.K.ds])).rows[0].kimlik;
    const bl = await o.belge(d.kimlik, 'ds'); await o.sup.query(`UPDATE belge SET bag_turu = 'İş Emri', bag_kimligi = $2, ad = 'Firma Keşif Raporu' WHERE kimlik = $1`, [bl, e]);
    await o.sup.query(`UPDATE belge_surum SET durum = 'Yürürlükte' WHERE belge_ref = $1`, [bl]);
    expect((await o.ist('GET', `/api/belge/${bl}/surum/1/indir`, await o.gir('iks'))).statusCode).toBe(404);
    expect((await o.ist('GET', `/api/portal/dosya/${d.kimlik}`, await o.gir('iks'))).body).not.toContain('Firma Keşif Raporu');
    expect((await o.ist('GET', `/api/belge/${bl}/surum/1/indir`, await o.gir('ds'))).statusCode).toBe(200);
  });
});

describe('e-posta ekinde hasar paylaşım kapısı (YG-1171)', () => {
  it('dosya belgesi eki dosya tarafına gider, yabancı alıcıda durur; onaylı paylaşım talebiyle gider', async () => {
    const { disGonder } = await import('../src/bildirim.js');
    const d = await o.dosyaAc({ eposta: 'sahip-ek@ornek.local' }, {}); await o.ekipKur(d.kimlik);
    const bl = await o.belge(d.kimlik, 'ds'); const s = (await o.sup.query(`SELECT kimlik FROM belge_surum WHERE belge_ref = $1`, [bl])).rows[0].kimlik;
    const taraf = (await o.sup.query(`SELECT eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND eposta IS NOT NULL LIMIT 1`, [d.kimlik])).rows[0].eposta as string;
    expect(await disGonder(o.db, { olay: `ek1:${d.kimlik}`, eposta: taraf, konu: 'K', metin: 'M', ekler: [s] })).toBe(true);
    expect(await disGonder(o.db, { olay: `ek2:${d.kimlik}`, eposta: 'yabanci@baska.local', konu: 'K', metin: 'M', ekler: [s] })).toBe(false);
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari = $1`, [`ek2:${d.kimlik}`])).rowCount).toBe(0);
    await o.sup.query(`INSERT INTO hasar_paylasim_talebi (dosya_ref, alici, kapsam, talep_eden_ref, durum) VALUES ($1,'yabanci@baska.local','Eksper incelemesi',$2,'Onaylandı')`, [d.kimlik, o.K.ds]);
    expect(await disGonder(o.db, { olay: `ek3:${d.kimlik}`, eposta: 'yabanci@baska.local', konu: 'K', metin: 'M', ekler: [s] })).toBe(true);
  });
});

describe('denetim izi: dosya okuma ve entegrasyon çağrısı (YG-1184)', () => {
  it('dosya ayrıntısı görüntülemesi ve dış gönderim çağrısı denetim izine yazılır', async () => {
    const { kuyrukIsle } = await import('../src/bildirim.js');
    const d = await o.dosyaAc({}, {});
    await o.ist('GET', `/api/dosya/${d.kimlik}`, await o.gir('mpm'));
    expect((await o.sup.query(`SELECT 1 FROM denetim_izi WHERE eylem = 'Veri Görüntüleme' AND nesne_kimligi = $1`, [`/api/dosya/${d.kimlik}`])).rowCount).toBe(1);
    const g = (await o.sup.query(`INSERT INTO gonderim (olay_anahtari, kanal, hedef, konu, metin) VALUES ($1,'E-posta','iz@ornek.local','K','M') RETURNING kimlik`, [`iz:${d.kimlik}`])).rows[0].kimlik;
    await kuyrukIsle({ db: o.db, webAdresi: 'http://x', eposta: o.posta, sms: o.sms } as never, new Date(Date.now() + 86_400_000), 10_000);
    expect((await o.sup.query(`SELECT sonuc FROM denetim_izi WHERE eylem = 'Entegrasyon Çağrısı' AND nesne_kimligi = $1`, [g])).rows[0]?.sonuc).toBe('Başarılı');
  });
});

describe('firma rapor ve fiyat sayacı (YG-1483)', () => {
  it('son zamana 4 saat kala firmaya hatırlatma, aşılınca Dosya Sorumlusuna görev; rapor ve fiyat gelince durur', async () => {
    const { firmaRaporSureIsle } = await import('../src/firma_rapor_sure.js');
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'RS','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-RS${Date.now()}`, o.K.ds])).rows[0].kimlik;
    const kabul = new Date('2031-01-06T08:00:00Z');
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, firma_kabul_zamani, hazirlayan_ref) VALUES ($1,'KN',$2,$3,'M','K','Aktif',$4,$5) RETURNING kimlik`, [`${d.dosyaNo}-KN01`, d.kimlik, f, kabul, o.K.ds])).rows[0].kimlik;
    const { raporSonZamani } = await import('../src/rapor.js'); const oncelik = (await o.sup.query(`SELECT oncelik FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].oncelik;
    const son = (await raporSonZamani(o.db, oncelik, kabul)).getTime();
    await firmaRaporSureIsle(o.db, new Date(son - 3 * 3_600_000));
    await firmaRaporSureIsle(o.db, new Date(son + 60_000));
    expect((await o.kart('Firma Raporu Gecikti', e)).baslik).toContain('Firma Teknik Raporu ve Firma Fiyat Teklifi');
    await firmaRaporSureIsle(o.db, new Date(son + 120_000));
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Firma Raporu Gecikti' AND nesne_kimligi = $1`, [e])).rows[0].n).toBe(1);
  });
});

describe('uyuşmazlık paketi ek bölümleri (YG-107)', () => {
  it('dosyaya giden ileti metni ve belge bütünlük özeti pakette yer alır', async () => {
    const { uyusmazlikEkBolumleri } = await import('../src/uyusmazlik_ek.js');
    const d = await o.dosyaAc({}, {});
    await o.sup.query(`INSERT INTO gonderim (olay_anahtari, kanal, hedef, konu, metin, durum) VALUES ($1,'SMS','05001112233','Bilgi','Yatınız teslime hazırdır','Gönderildi')`, [`uy:${d.kimlik}`]);
    const bl = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('Yazışma','Yazışma','Gizli','Dosya',$1,'Sistem',current_date,$2) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO belge_surum (belge_ref, surum_no, dosya_adi, uzanti, boyut, ozet_sha256, depo_anahtari, tarama_kaynagi, yukleyen_ref) VALUES ($1,1,'y.pdf','pdf',1,'abc123ozet','x/y','Sistem',$2)`, [bl, o.K.ds]);
    const b = await uyusmazlikEkBolumleri(o.db, d.kimlik) as { baslik: string; satirlar?: unknown[][] }[];
    expect(b.find((x) => x.baslik === 'Gönderilen İletiler')!.satirlar!.some((r) => String(r[2]).includes('teslime hazırdır'))).toBe(true);
    const oz = (await o.sup.query(`SELECT ozet_sha256 FROM belge_surum WHERE belge_ref = $1`, [bl])).rows[0].ozet_sha256;
    expect(b.find((x) => x.baslik === 'Belge Bütünlük Özetleri')!.satirlar!.some((r) => r[2] === oz)).toBe(true);
  });
});

describe('e-postası olmayan alıcıya iletim (YG-207, YG-239)', () => {
  it('onay sonucu SMS ile hesap bağlantısıyla gider; hesabı yoksa Dosya Sorumlusuna kalıcı saklayıcı görevi açılır', async () => {
    const { epostasizIletim } = await import('../src/onay_iletim.js');
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const on = crypto.randomUUID(); const c = await o.db.connect();
    try { await epostasizIletim(c, { kimlik: on, telefon: '+905001112244', alici_kullanici_ref: null, dosya_ref: d.kimlik, belge_adi: 'Fiyat Teklifi' }, 'Onayınız kaydedildi.', 'http://ornek'); } finally { c.release(); }
    expect((await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 AND kanal = 'SMS'`, [`onay-sonuc:${on}`])).rows[0].metin).toContain('http://ornek');
    expect((await o.sup.query(`SELECT 1 FROM belge_uretim WHERE tur = 'Onay Belgesi' AND nesne = $1`, [on])).rowCount).toBe(1);
    expect((await o.kart('Kalıcı Saklayıcıyla İletim', on)).baslik).toContain('Kalıcı Saklayıcıyla İletim');
  });
});

describe('sökülen parça süresi (YG-077)', () => {
  it('son güne 7 gün kala hatırlatma; talimatsız süre dolunca İade seçilir ve görev açılır', async () => {
    const { sokulenParcaIsle } = await import('../src/sokulen_parca.js');
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const p = (await o.sup.query(`INSERT INTO sokulen_parca (dosya_ref, parca_adi, son_tarih, giren_ref) VALUES ($1,'Pervane','2031-02-10',$2) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    await sokulenParcaIsle(o.db, new Date('2031-02-05T09:00:00Z'));
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1 AND kullanici_ref = $2`, [`sokulen-parca-once:${p}`, o.K.ds])).rowCount).toBe(1);
    await sokulenParcaIsle(o.db, new Date('2031-02-12T09:00:00Z'));
    expect((await o.sup.query(`SELECT secim FROM sokulen_parca WHERE kimlik = $1`, [p])).rows[0].secim).toBe('İade');
    expect((await o.kart('Talimatsız Parça İadesi', p)).baslik).toContain('Yatla İade');
  });
});

describe('olay kaydı numarası (YG-010)', () => {
  it('olay kaydı LGM-OL önekli sıra numarası alır', async () => {
    const { benzerAlanKontrolu } = await import('../src/teyit.js');
    await benzerAlanKontrolu(o.db, 'x@limitglobalrnarine.com.tr', o.K.ds!, null);
    const n = (await o.sup.query(`SELECT olay_no FROM olay_kaydi ORDER BY olusturma_zamani DESC LIMIT 1`)).rows[0].olay_no as string;
    expect(n).toMatch(/^LGM-OL-\d{5}$/);
  });
});

describe('destek talebi (YG-1409–1412, YG-1504)', () => {
  it('seviye etkiden; D1 dışı son an gece veya pazara düşerse ilk çalışma günü 12:00', async () => {
    const { destekSeviyesi, destekSonAn } = await import('../src/destek.js');
    const t = { tur: 'Hata', etkilenen: 1, sistemKullanilamiyor: false, kritikSurec: false, guvenlik: false, veriButunlugu: false, musteriMali: false };
    expect(destekSeviyesi({ ...t, guvenlik: true })).toBe('D1'); expect(destekSeviyesi({ ...t, etkilenen: 12 })).toBe('D2');
    expect(destekSeviyesi(t)).toBe('D3'); expect(destekSeviyesi({ ...t, tur: 'Öneri' })).toBe('D4');
    const cuma21 = new Date('2031-01-10T18:00:00Z'); // Cuma 21:00 TSİ
    expect(destekSonAn(cuma21, 2, 'D2', new Set()).toISOString()).toBe('2031-01-11T09:00:00.000Z'); // 23:00 → Cumartesi 12:00 TSİ
    expect(destekSonAn(cuma21, 2, 'D1', new Set()).toISOString()).toBe('2031-01-10T20:00:00.000Z');
    const cmt21 = new Date('2031-01-11T18:00:00Z');
    expect(destekSonAn(cmt21, 2, 'D3', new Set()).toISOString()).toBe('2031-01-13T09:00:00.000Z'); // Pazar atlanır → Pazartesi 12:00
  });
  it('talep açılır, BT görevi düşer; çözüm dört unsursuz kaydedilmez; kullanıcı doğrulamadan kapanmaz; kapalı talep yeniden açılmaz', async () => {
    const r = await o.ist('POST', '/api/destek', await o.gir('ds'), { tur: 'Hata', belirti: 'Teklif ekranı açılmıyor', etkilenen: 3 }); expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ seviye: 'D3' }); expect(r.json().talepNo).toMatch(/^DST-\d{4}-\d{4}$/);
    const id = r.json().kimlik as string;
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Destek Talebi' AND nesne_kimligi = $1 AND sahip_rol_ref IS NOT NULL`, [id])).rowCount).toBe(1);
    const bt = await o.gir('btd');
    // T-YG1645: üst kademeye gerekçeyle bir kez gönderilir; çözümde görev kapanır
    const uk = `/api/destek/${id}/ust-kademe`;
    expect((await o.ist('POST', uk, bt, {})).statusCode).toBe(400);
    expect((await o.ist('POST', uk, bt, { gerekce: 'Veritabanı yetkisi gerekiyor' })).statusCode).toBe(200);
    expect((await o.ist('POST', uk, bt, { gerekce: 'Tekrar' })).statusCode).toBe(409);
    expect((await o.kart('Destek Eskalasyonu', id)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/destek/${id}/cozum`, bt, { yapilan: 'Düzeltildi' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/destek/${id}/cozum`, await o.gir('mpm'), { yapilan: 'a', degisen: 'b', dogrulama: 'c', sonuc: 'd' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/destek/${id}/cozum`, bt, { yapilan: 'Sorgu düzeltildi', degisen: 'teklif.ts', dogrulama: 'Ekran denendi', sonuc: 'Ekran açılıyor' })).statusCode).toBe(200);
    expect((await o.kart('Destek Eskalasyonu', id)).durum).toBe('Tamamlandı');
    expect((await o.sup.query(`SELECT durum FROM destek_talebi WHERE kimlik = $1`, [id])).rows[0].durum).toBe('Çözüldü');
    expect((await o.ist('POST', `/api/destek/${id}/kapat`, bt, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/destek/${id}/dogrula`, await o.gir('ds'), { sonuc: 'Çözüldü' })).json().durum).toBe('Kapalı');
    expect((await o.ist('POST', `/api/destek/${id}/mesaj`, await o.gir('ds'), { metin: 'Tekrar oldu' })).statusCode).toBe(409);
    const y2 = await o.ist('POST', '/api/destek', await o.gir('ds'), { tur: 'Hata', belirti: 'Yine açılmıyor', ilgili: id }); expect(y2.statusCode).toBe(200);
    expect((await o.ist('GET', `/api/destek/${y2.json().kimlik}`, await o.gir('ds'))).json().ilgili.map((x: { talep_no: string }) => x.talep_no)).toContain(r.json().talepNo);
  });
});

describe('destek talebi dosya bağlamı ve ekran görüntüsü (YG-1504)', () => {
  it('dosya ekranından açılan talep Dosya Sorumlusuna düşer; ekran görüntüsü yalnız talebe bağlı belgeden eklenir', async () => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const r = await o.ist('POST', '/api/destek', await o.gir('mpm'), { tur: 'Soru', belirti: 'Teslim tarihi nerede görünür', dosya: d.kimlik }); expect(r.statusCode, r.body).toBe(200);
    const id = r.json().kimlik as string;
    expect((await o.sup.query(`SELECT atanan_ref, dosya_ref FROM destek_talebi WHERE kimlik = $1`, [id])).rows[0]).toMatchObject({ atanan_ref: o.K.ds, dosya_ref: d.kimlik });
    expect((await o.sup.query(`SELECT sahip_kullanici_ref FROM is_karti WHERE tur = 'Destek Talebi' AND nesne_kimligi = $1`, [id])).rows[0].sahip_kullanici_ref).toBe(o.K.ds);
    const yabanci = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('Başka','Foto','Gizli','Dosya',$1,'Sistem',current_date,$2) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    expect((await o.ist('POST', `/api/destek/${id}/ekran-goruntusu`, await o.gir('mpm'), { belge: yabanci })).statusCode).toBe(400);
    const eg = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('Ekran','Foto','Gizli','Destek Talebi',$1,'Sistem',current_date,$2) RETURNING kimlik`, [id, o.K.mpm])).rows[0].kimlik;
    expect((await o.ist('POST', `/api/destek/${id}/ekran-goruntusu`, await o.gir('mpm'), { belge: eg })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/destek/${id}/ekran-goruntusu`, await o.gir('ds'), { belge: eg })).statusCode).toBe(404);
  });
});

describe('yatın onarım geçmişi (YG-095)', () => {
  it('aynı yatın önceki dosyaları ve onaylı raporları görünür; rapor yalnız bu geçmişe atıf yapar', async () => {
    const a = await o.dosyaAc({}, {}); const yat = (await o.sup.query(`SELECT yat_ref FROM dosya WHERE kimlik = $1`, [a.kimlik])).rows[0].yat_ref;
    const b = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET yat_ref = $2 WHERE kimlik = $1`, [b.kimlik, yat]);
    const r = (await o.sup.query(`INSERT INTO teknik_rapor (rapor_no, rapor_turu, dosya_ref, kapsam, incelenen_alan, saha_kosullari, yontem_olcut, bulgular, acik_sorular, analiz_risk, oneriler, uzmanlik_siniri, rapor_dili, hazirlayan_ref, durum) VALUES ($1,'İlk Rapor',$2,'k','i','s','y','b','a','r','o','u','Türkçe',$3,'Onaylı') RETURNING kimlik`, [`${a.dosyaNo}-TR01`, a.kimlik, o.K.ds])).rows[0].kimlik;
    const g = await o.ist('GET', `/api/dosya/${b.kimlik}/yat-gecmisi`, await o.gir('mpm')); expect(g.statusCode, g.body).toBe(200);
    const s = g.json().find((x: { dosya_no: string }) => x.dosya_no === a.dosyaNo); expect(s.raporlar[0].raporNo).toBe(`${a.dosyaNo}-TR01`);
    expect((await o.ist('GET', `/api/dosya/${b.kimlik}/yat-gecmisi`, await o.gir('sy'))).statusCode).toBe(404);
    void r;
  });
});

describe('kilometre taşı (YG-072)', () => {
  it('baz tarih değişmez ve silinmez; aşımda üç açıklama zorunlu; açıklamasız aşım DS görevi açar', async () => {
    const d = await o.dosyaAc({}, {});
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, o.K.ds, o.K.opm]);
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kilometre`, ds, { ad: 'Kızak' })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/kilometre`, ds, { ad: 'Kızağa Çekme', baz: '2026-11-01' }); expect(r.statusCode, r.body).toBe(200);
    const k = r.json().kimlik;
    expect((await o.ist('POST', `/api/kilometre/${k}`, ds, { guncel: '2026-11-20' })).json().hata).toContain('zorunludur');
    expect((await o.ist('POST', `/api/kilometre/${k}`, ds, { guncel: '2026-11-20', neden: 'Hava', eylem: 'Ek vardiya', etki: 'Boya 3 gün kayar' })).statusCode).toBe(200);
    await expect(o.sup.query(`UPDATE kilometre_tasi SET baz_tarih = '2026-12-01' WHERE kimlik = $1`, [k])).rejects.toThrow(/Baz tarih/);
    await expect(o.sup.query(`DELETE FROM kilometre_tasi WHERE kimlik = $1`, [k])).rejects.toThrow(/silinemez/);
    const r2 = (await o.ist('POST', `/api/dosya/${d.kimlik}/kilometre`, ds, { ad: 'Teslim', baz: '2026-11-02' })).json().kimlik;
    const { kilometreIsle } = await import('../src/kilometre.js');
    await kilometreIsle(o.db, new Date('2026-11-05T09:00:00Z'));
    expect((await o.kart('Kilometre Taşı Gecikmesi', r2)).baslik).toContain('Teslim');
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE nesne_kimligi = $1`, [k])).rows[0].n).toBe(0);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/kilometre`, await o.gir('sy'))).statusCode).toBe(404);
  });
});

describe('kışlık hazırlık sorumlusu (YG-110)', () => {
  it('kış dönemi hesabı; kışa sarkan dosyada görev bir kez açılır; personel ya da taraf atanır, görev kapanır', async () => {
    const { kistaMi, kislikIsle } = await import('../src/kislik.js');
    expect([kistaMi(12, 11, 3), kistaMi(2, 11, 3), kistaMi(6, 11, 3), kistaMi(4, 11, 3)]).toEqual([true, true, false, false]);
    const d = await o.dosyaAc({}, {});
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, o.K.ds, o.K.opm]);
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2, musteri_hedef_tarihi = NULL WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    await kislikIsle(o.db, new Date('2026-07-10T09:00:00Z'));
    expect(await o.kart('Kışlık Hazırlık Sorumlusu', d.kimlik)).toBeUndefined();
    await o.sup.query(`UPDATE dosya SET musteri_hedef_tarihi = '2026-12-15' WHERE kimlik = $1`, [d.kimlik]);
    await kislikIsle(o.db, new Date('2026-07-10T09:00:00Z')); await kislikIsle(o.db, new Date('2026-07-11T09:00:00Z'));
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Kışlık Hazırlık Sorumlusu' AND nesne_kimligi = $1`, [d.kimlik])).rows[0].n).toBe(1);
    const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kislik`, ds, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kislik`, ds, { kullanici: o.K.tm })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/kislik`, ds, { kullanici: o.K.ds }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.kart('Kışlık Hazırlık Sorumlusu', d.kimlik)).durum).toBe('Tamamlandı');
    const g = (await o.ist('GET', `/api/dosya/${d.kimlik}/kislik`, ds)).json(); expect(g.sorumlu).toBeTruthy();
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kislik`, await o.gir('sy'), { kullanici: o.K.ds })).statusCode).toBe(404);
  });
});

describe('ertelenen kalemler ve daraltılmış kapanış (YG-076)', () => {
  it('ertelenen kalemler ana dosyaya bağlı Planlı talep açar', async () => {
    const d = await o.dosyaAc({}, {});
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, o.K.ds, o.K.opm]);
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ertelenen`, ds, { kalemler: [], hedef: '2027-04-01' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ertelenen`, ds, { kalemler: ['Teak yenileme'] })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/ertelenen`, ds, { kalemler: ['Teak yenileme', 'Antifouling'], hedef: '2027-04-01' }); expect(r.statusCode, r.body).toBe(200);
    const t = (await o.sup.query(`SELECT oncelik, onceki_dosya_ref, ihtiyac_tanimi FROM talep WHERE kimlik = $1`, [r.json().talep])).rows[0];
    expect(t.oncelik).toBe('Planlı'); expect(t.onceki_dosya_ref).toBe(d.kimlik); expect(t.ihtiyac_tanimi).toContain('Antifouling');
    expect((await o.kart('Planlı Alt Dosya', r.json().talep)).baslik).toContain(d.dosyaNo);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/alt-talepler`, ds)).json()).toHaveLength(1);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ertelenen`, await o.gir('sy'), { kalemler: ['x'], hedef: '2027-04-01' })).statusCode).toBe(404);
  });
});

describe('ON iş emri yokken kapanış listesi daralır (YG-076)', () => {
  it('ON yoksa uygulama, kabul ve garanti işareti istenmez; ON varsa istenir', async () => {
    const d = await o.dosyaAc({}, {});
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, o.K.ds, o.K.opm]);
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2, statu = 'Aktif' WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const ds = await o.gir('ds'); const g = { cikis: 'Teknik Kapalı', yetkiKapsam: false, uygulama: false, testKabul: false, acikKonu: true, garanti: false, arsiv: true, yazismaBeyani: true };
    const r1 = (await o.ist('POST', `/api/dosya/${d.kimlik}/kapanis`, ds, g)).json();
    expect(r1.eksikler).toContain('Kapanış Bekliyor'); expect(r1.eksikler).not.toContain('Teknik Eksik'); expect(r1.eksikler).not.toContain('Kabul Bekliyor'); expect(r1.eksikler).not.toContain('Garanti Bağı Eksik');
    const k = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Daraltma Firma','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-DR${Date.now()}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Y','K',100,'Aktif',$4)`, [`${d.dosyaNo}-ON01`, d.kimlik, k, o.K.oy]);
    const r2 = (await o.ist('POST', `/api/dosya/${d.kimlik}/kapanis`, ds, g)).json();
    expect(r2.eksikler).toEqual(expect.arrayContaining(['Teknik Eksik', 'Kabul Bekliyor', 'Garanti Bağı Eksik']));
  });
});

describe('iç bütçe ve risk rezervi (YG-862, YG-863, YG-780)', () => {
  const kur = async () => {
    const d = await o.dosyaAc({}, {});
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, o.K.ds, o.K.opm]);
    const tk = async (no: string, statu: string, karar: string | null, m: number, zaman: string) => { const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, karar_zamani, ara_toplam_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,$3,$4,$5,1,1,1,$6) RETURNING kimlik`, [`${d.dosyaNo}-${no}`, d.kimlik, statu, karar, karar ? zaman : null, o.K.ts])).rows[0].kimlik; await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, onay_durumu) VALUES ($1,1,'A','Onarım','İşçilik',1,'saat',$2,$2,$2,$3)`, [t, m, karar ? 'Onaylandı' : 'Bekliyor']); return t; };
    await tk('T1', 'Yerine Geçti', 'Tam Onay', 900, '2026-11-01'); await tk('T2', 'Karar', 'Tam Onay', 1000, '2026-11-02'); await tk('T3', 'Gönderildi', null, 300, '2026-11-03');
    return d;
  };
  it('bütçe bileşenleri ayrı; rezerv yalnız maliyet görene; talep OPM ve Direktör onayıyla; %80 uyarısı bir kez; aşım reddedilir', async () => {
    const { dosyaButcesi } = await import('../src/risk_rezervi.js');
    const d = await kur(); const v = await dosyaButcesi(o.db, d.kimlik);
    expect(v).toMatchObject({ temelCizgi: 900, guncelButce: 1000, bekleyenDegisiklik: 300, rezervOrani: 0.05, rezerv: 50, rezervKalan: 50 });
    const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/risk-rezervi`;
    const g = (await o.ist('GET', u, ds)).json(); expect(g.butce).toBeNull(); expect(g.talepAcabilir).toBe(true);
    expect((await o.ist('GET', u, await o.gir('ts'))).json().butce.rezerv).toBe(50);
    expect((await o.ist('POST', u, await o.gir('ts'), { tur: 'Kullanım', tutar: 10, gerekce: 'G' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, ds, { tur: 'Kullanım', tutar: 10 })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { tur: 'Kullanım', tutar: 51, gerekce: 'G' })).statusCode).toBe(409);
    const r = await o.ist('POST', u, ds, { tur: 'Kullanım', tutar: 45, gerekce: 'Gizli hasar' }); expect(r.statusCode, r.body).toBe(200);
    const k = (await o.kart('Risk Rezervi Talebi', r.json().kimlik)).kimlik;
    expect((await o.karar(k, 'opm', 'Onaya Gönder')).statusCode).toBe(200); expect((await dosyaButcesi(o.db, d.kimlik)).rezervKullanilan).toBe(0);
    expect((await o.karar(k, 'tod', 'Onayla')).statusCode).toBe(200);
    expect((await dosyaButcesi(o.db, d.kimlik))).toMatchObject({ rezervKullanilan: 45, rezervKalan: 5 });
    expect((await o.kart('Bütçe Erken Uyarısı', d.kimlik)).baslik).toContain('Risk Rezervi');
    const { butceUyariKontrol } = await import('../src/risk_rezervi.js'); await butceUyariKontrol(o.db, d.kimlik, d.dosyaNo);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Bütçe Erken Uyarısı' AND nesne_kimligi = $1`, [d.kimlik])).rows[0].n).toBe(1);
  });
  it('onay anında kalan rezerv yeniden denetlenir; aşan talep onaylanamaz', async () => {
    const d = await kur(); const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/risk-rezervi`;
    const al = async () => (await o.kart('Risk Rezervi Talebi', (await o.ist('POST', u, ds, { tur: 'Kullanım', tutar: 30, gerekce: 'G' })).json().kimlik)).kimlik;
    const a = await al(); const b = await al();
    for (const k of [a, b]) expect((await o.karar(k, 'opm', 'Onaya Gönder')).statusCode).toBe(200);
    expect((await o.karar(a, 'tod', 'Onayla')).statusCode).toBe(200);
    const r = await o.karar(b, 'tod', 'Onayla'); expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('rezervi aşmaktadır');
    expect((await o.sup.query(`SELECT durum FROM is_karti WHERE kimlik = $1`, [b])).rows[0].durum).toBe('Bekliyor');
  });
  it('oran değişikliği Direktör onayıyla işler; bütçe %10 aşımı uyarır', async () => {
    const { dosyaButcesi, butceUyariKontrol } = await import('../src/risk_rezervi.js');
    const d = await kur(); const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/risk-rezervi`;
    expect((await o.ist('POST', u, ds, { tur: 'Oran Değişikliği', oran: 1.5, gerekce: 'G' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, ds, { tur: 'Oran Değişikliği', oran: 0.1, gerekce: 'Yüksek risk' }); expect(r.statusCode, r.body).toBe(200);
    const k = (await o.kart('Risk Rezervi Talebi', r.json().kimlik)).kimlik; expect((await o.karar(k, 'opm', 'Onaya Gönder')).statusCode).toBe(200); expect((await o.karar(k, 'tod', 'Onayla')).statusCode).toBe(200);
    expect((await dosyaButcesi(o.db, d.kimlik))).toMatchObject({ rezervOrani: 0.1, rezerv: 100 });
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Bütçe Firma','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-BT${Date.now()}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Y','K',1200,'Aktif',$4)`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.oy ?? o.K.ds]);
    expect((await dosyaButcesi(o.db, d.kimlik))).toMatchObject({ acikTaahhut: 1200, bitisTahmini: 1200 });
    await butceUyariKontrol(o.db, d.kimlik, d.dosyaNo);
    expect((await o.kart('Bütçe Erken Uyarısı', d.kimlik)).baslik).toContain('Bütçe Aşımı');
    const { katkiDurumu, katkiUyariKontrol } = await import('../src/katki_uyari.js'); // YG-782
    expect(await katkiDurumu(o.db, d.kimlik)).toMatchObject({ planli: 0, tahmin: -20, dusus: 20 });
    expect(await katkiUyariKontrol(o.db, d.kimlik, d.dosyaNo)).toBe(true); expect(await katkiUyariKontrol(o.db, d.kimlik, d.dosyaNo)).toBe(false);
  });
});

describe('teslim süresi değerlendirmesi (SRE-1)', () => {
  const S = new Date('2026-11-09T09:00:00Z'); // Pazartesi
  const kur = async (tarih: string) => {
    const d = await o.dosyaAc({}, {});
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, o.K.ds, o.K.opm]);
    await o.sup.query(`UPDATE dosya SET statu = 'Aktif', dosya_sorumlusu_ref = $2, tahmini_teslim_tarihi = $3, ilk_tahmini_teslim_tarihi = $3 WHERE kimlik = $1`, [d.kimlik, o.K.ds, tarih]);
    return d;
  };
  it('ilk onarım iş emri başlayınca tarih gerçek başlangıçtan kurulur; ikinci kez değişmez; keşifte kurulmaz', async () => {
    const { teslimTarihiKur } = await import('../src/teslim_sure.js');
    const d = await o.dosyaAc({}, {});
    const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, ara_toplam_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref, bildirilen_sure_gun) VALUES ($1,$2,'Yat Sahibi',20,'Karar',1,1,1,$3,9) RETURNING kimlik`, [`${d.dosyaNo}-TX`, d.kimlik, o.K.ts])).rows[0].kimlik;
    expect(await teslimTarihiKur(o.db, { is_emri_turu: 'KN', dosya_ref: d.kimlik, teklif_ref: t }, S)).toBeNull();
    expect(await teslimTarihiKur(o.db, { is_emri_turu: 'ON', dosya_ref: d.kimlik, teklif_ref: t }, S)).toBe('2026-11-19');
    expect(await teslimTarihiKur(o.db, { is_emri_turu: 'ON', dosya_ref: d.kimlik, teklif_ref: t }, new Date('2026-12-01T09:00:00Z'))).toBe('2026-11-19');
    expect((await o.sup.query(`SELECT ilk_tahmini_teslim_tarihi::text i FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].i).toBe('2026-11-19');
  });
  it('tarih sigortaya BLD-02 ile bir kez bildirilir; sigortasız dosyada gönderim açılmaz (SRE-2)', async () => {
    const { sigortayaTarihBildir } = await import('../src/teslim_sure.js');
    const d = await o.dosyaAc({ sigortaci: 'SG', hasarNo: `H-${Math.random()}` }, { musteriTuru: 'Sigorta Şirketi' }); const y = await o.dosyaAc({}, {});
    const c = await o.db.connect();
    try { for (const k of [d.kimlik, d.kimlik, y.kimlik]) await sigortayaTarihBildir(c, k, '2026-11-19', S, 'http://x', o.K.ds!); } finally { c.release(); }
    const l = (await o.sup.query(`SELECT metin FROM sigorta_gonderim WHERE tur = 'BLD-02' AND dosya_ref = ANY($1::uuid[])`, [[d.kimlik, y.kimlik]])).rows;
    expect(l).toHaveLength(1); expect(l[0].metin).toContain('19.11.2026');
  });
  it('iş günü takvimi Cumartesi sayar, Pazarı atlar', async () => {
    const { kalanIsGunu, gunMetni } = await import('../src/teslim_sure.js'); const { isGunuSonu } = await import('../src/teklif.js');
    expect(gunMetni(await isGunuSonu(o.db, S, 9))).toBe('2026-11-19'); expect(await kalanIsGunu(o.db, S, '2026-11-19')).toBe(9); expect(await kalanIsGunu(o.db, S, '2026-11-08')).toBe(0);
  });
  it('5 iş günü kala görev bir kez; 3 iş günü kala Operasyon Müdürüne uyarı; uzak tarihte görev yok', async () => {
    const { teslimSureIsle } = await import('../src/teslim_sure.js');
    const uzak = await kur('2026-11-30'); const bes = await kur('2026-11-14'); const uc = await kur('2026-11-12');
    await teslimSureIsle(o.db, S); await teslimSureIsle(o.db, S);
    expect(await o.kart('Teslim Süresi Değerlendirmesi', uzak.kimlik)).toBeUndefined();
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Teslim Süresi Değerlendirmesi' AND nesne_kimligi = $1`, [bes.kimlik])).rows[0].n).toBe(1);
    expect(await o.kart('Teslim Süresi Değerlendirmesi Gecikti', bes.kimlik)).toBeUndefined();
    expect((await o.kart('Teslim Süresi Değerlendirmesi Gecikti', uc.kimlik)).durum).toBe('Bekliyor');
  });
  it('uzamada gerekçe ve ek gün zorunlu; yeni tarih takvimden; BLD-03 gider; aynı tarih iki kez değerlendirilmez; yeni tarih yeniden izlenir', async () => {
    const { teslimSureIsle } = await import('../src/teslim_sure.js');
    const d = await kur('2026-12-05'); const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/teslim-sure`;
    await o.sup.query(`UPDATE dosya_tarafi SET aktif = true, telefon = '+905550001111' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]);
    expect((await o.ist('POST', u, await o.gir('sy'), { sonuc: 'Uzama Yok' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, ds, { sonuc: 'Uzama Var', ekGun: 3 })).statusCode).toBe(400);
    const r = await o.ist('POST', u, ds, { sonuc: 'Uzama Var', ekGun: 3, gerekce: 'parça tedarikindeki gecikme' }); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().yeniTarih).toBe('2026-12-09'); // Cmt 05.12 + Pzt, Sal, Çar
    expect((await o.sup.query(`SELECT tahmini_teslim_tarihi::text t, ilk_tahmini_teslim_tarihi::text i FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0]).toEqual({ t: '2026-12-09', i: '2026-12-05' });
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE 'bld03:%' AND metin LIKE '%parça tedarikindeki%' ORDER BY olusturma_zamani DESC LIMIT 1`)).rows[0]?.metin as string;
    expect(m).toContain('05.12.2026'); expect(m).toContain('09.12.2026');
    expect((await o.ist('POST', u, ds, { sonuc: 'Uzama Yok' })).statusCode).toBe(200); // yeni tarih değerlendirildi
    expect((await o.ist('POST', u, ds, { sonuc: 'Uzama Yok' })).statusCode).toBe(409);
    const d2 = await kur('2026-11-12'); await teslimSureIsle(o.db, S);
    const g = await o.ist('POST', `/api/dosya/${d2.kimlik}/teslim-sure`, ds, { sonuc: 'Uzama Yok' }); expect(g.statusCode, g.body).toBe(200);
    expect((await o.kart('Teslim Süresi Değerlendirmesi', d2.kimlik)).durum).toBe('Tamamlandı');
  });
});

describe('bağlama noktası ve tesis önerisi (YG-113, YG-114, YG-115, YG-333)', () => {
  const tesisKur = async (ad: string, x: object) => {
    const sc = await o.gir('sc'); const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, ag_statusu, olusturan_ref) VALUES ($1,$2,'Tesis','Aktif',$3) RETURNING kimlik`, [`S-BN${Math.random()}`, ad, o.K.ds])).rows[0].kimlik;
    const r = await o.ist('POST', `/api/firma/${f}/tesis`, sc, { ad, il: 'Muğla' }); expect(r.statusCode, r.body).toBe(200);
    const b = await o.ist('POST', `/api/firma-tesis/${r.json().kimlik}/bilgi`, sc, { kural: 'Serbest', ...x }); expect(b.statusCode, b.body).toBe(200); return r.json().kimlik as string;
  };
  it('alan doğrulaması; yalnız sicil rolü girer; 12 ay geçen kural teyidi yılda bir görev açar', async () => {
    const { tesisTeyitIsle } = await import('../src/baglama_noktasi.js');
    const t = await tesisKur(`Teyit ${Math.random()}`, { kuralTeyit: '2025-01-01' }); const sc = await o.gir('sc'); const u = `/api/firma-tesis/${t}/bilgi`;
    expect((await o.ist('POST', u, await o.gir('ds'), { kural: 'Serbest' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, sc, { kural: 'Kayıt Şartlı' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, sc, { kural: 'Serbest', tesisTuru: 'Plaj' })).statusCode).toBe(400); // YG-112
    expect((await o.ist('POST', u, sc, { kural: 'Serbest', tesisTuru: 'Çekek Sahası', kuralTeyit: '2025-01-01' })).statusCode).toBe(200);
    expect((await o.ist('GET', u, sc)).json().tesis_turu).toBe('Çekek Sahası');
    expect((await o.ist('POST', u, sc, { kural: 'Ücretli' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, sc, { kural: 'X' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, sc, { kural: 'Serbest', kuralTeyit: '2025-01-01', enlem: 36.8, boylam: 28.2 })).statusCode).toBe(200);
    await tesisTeyitIsle(o.db, new Date('2026-11-09T09:00:00Z')); await tesisTeyitIsle(o.db, new Date('2026-11-10T09:00:00Z'));
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Tesis Kural Teyidi' AND nesne_kimligi = $1`, [t])).rows[0].n).toBe(1);
  });
  it('öneri tonaj ve boya uyar, yasak tesis çıkmaz, en yakından sıralanır', async () => {
    const { mesafeKm } = await import('../src/baglama_noktasi.js'); expect(mesafeKm({ enlem: 36.85, boylam: 28.27 }, { enlem: 37.03, boylam: 27.43 })).toBeGreaterThan(70);
    const d = await o.dosyaAc({}, {}); await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, o.K.ds, o.K.opm]);
    await o.sup.query(`UPDATE yat SET tonaj = 40, tam_boy_m = 20 WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    const ek = Math.random(); const ad = (x: string) => `${x} ${ek}`;
    await tesisKur(ad('Uzak'), { travelLift: 100, azamiBoy: 30, enlem: 37.03, boylam: 27.43 }); await tesisKur(ad('Yakın'), { vinc: 50, azamiBoy: 25, enlem: 36.85, boylam: 28.27 });
    await tesisKur(ad('Küçük Lift'), { travelLift: 30, azamiBoy: 25, enlem: 36.85, boylam: 28.27 }); await tesisKur(ad('Kısa'), { travelLift: 100, azamiBoy: 15, enlem: 36.85, boylam: 28.27 }); await tesisKur(ad('Yasak'), { kural: 'Yasak', travelLift: 100, azamiBoy: 30, enlem: 36.85, boylam: 28.27 });
    const r = (await o.ist('GET', `/api/dosya/${d.kimlik}/onerilen-tesisler?enlem=36.85&boylam=28.27`, await o.gir('ds'))).json();
    expect(r.tesisler.map((x: { ad: string }) => x.ad).filter((x: string) => x.endsWith(String(ek)))).toEqual([ad('Yakın'), ad('Uzak')]); expect(r.tesisler[0].enlem).toBeUndefined();
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/onerilen-tesisler`, await o.gir('sy'))).statusCode).toBe(404);
  });
});

describe('ana veri aktarımı (ANV-1, YG-367)', () => {
  it('adaylar pasif girer, paydaş alınmaz, yeniden çalıştırmak çoğaltmaz; listelerde aday görünmez; mükerrer karar sicilde; nokta tesise bağlanır', async () => {
    const { anaVeriYukle } = await import('../src/ana_veri.js'); const x = Math.floor(Math.random() * 1e8) + 1e6; const ad = (s: string) => `${s} ${x}`;
    const F = [{ 'Sıra': String(x), 'Firma Adı': ad('Aday Bir'), 'Adres': 'A', 'Konum İl': 'Muğla', 'Konum İlçe': 'Bodrum', 'Telefon': '0533', 'Web': 'Resmî web sitesi bulunamadı', 'Mükerrer Grubu': `G${x}`, 'Kayıt Rolü': 'İB Firması adayı' }, { 'Sıra': String(x + 1), 'Firma Adı': ad('Aday İki'), 'Mükerrer Grubu': `G${x}`, 'Kayıt Rolü': 'İB Firması adayı' }, { 'Sıra': String(x + 2), 'Firma Adı': ad('Okul'), 'Kayıt Rolü': 'Paydaş (eğitim kurumu)' }];
    const N = [{ 'Nokta No': String(x), 'Tür': 'Marina ve yat limanı', 'İl': `İl${x}`, 'İlçe': 'B', 'Tesis / Nitelik': ad('Marina'), 'Olası Mükerrer Grubu': `N${x}`, 'Mükerrer Kararı': 'Karar bekliyor' }, { 'Nokta No': String(x + 1), 'Tür': 'Marina ve yat limanı', 'İl': `İl${x}`, 'Tesis / Nitelik': ad('Marina 2'), 'Olası Mükerrer Grubu': `N${x}`, 'Mükerrer Kararı': 'Karar bekliyor' }];
    const yukle = async () => { const c = await o.db.connect(); try { await c.query('BEGIN'); const r = await anaVeriYukle(c, { firmalar: F, noktalar: N }); await c.query('COMMIT'); return r; } finally { c.release(); } };
    expect(await yukle()).toEqual({ firma: 2, atlanan: 0, paydas: 1, nokta: 2, mukerrerFirma: 2, mukerrerNokta: 2 });
    expect(await yukle()).toMatchObject({ firma: 0, atlanan: 2, nokta: 0 });
    const f = (await o.sup.query(`SELECT kimlik, kayit_asamasi, ag_statusu, web, sicil_no FROM kurulus WHERE ticari_unvan = $1`, [ad('Aday Bir')])).rows[0];
    expect(f).toMatchObject({ kayit_asamasi: 'Aday', ag_statusu: 'Pasif', web: null }); expect(f.sicil_no).toMatch(/^LGM-SC-/);
    const sc = await o.gir('sc'); const adlar = (r: { json: () => { ticari_unvan: string }[] }) => r.json().map((z) => z.ticari_unvan);
    expect(adlar(await o.ist('GET', '/api/firma/sicil', sc))).not.toContain(ad('Aday Bir')); expect(adlar(await o.ist('GET', '/api/firma/sicil?aday=1', sc))).toContain(ad('Aday Bir'));
    { const un = `Arşiv Firma ${Date.now()}`; await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ($1,$2,'Çözüm Ortağı','Onaylı','Çıkarıldı',$3)`, [`S-AR${Date.now()}`, un, o.K.ds]); // YG-356
      const ar = (await o.ist('GET', '/api/firma/sicil?arsiv=1', sc)).json() as { ticari_unvan: string; ag_statusu: string | null; kayit_asamasi: string }[];
      expect(ar.map((x) => x.ticari_unvan)).toContain(un); expect(ar.every((x) => ['Çıkarıldı', 'Pasif'].includes(String(x.ag_statusu)) || x.kayit_asamasi === 'Reddedildi')).toBe(true); }
    expect(adlar(await o.ist('GET', '/api/firma/uygunluk', await o.gir('ds')))).not.toContain(ad('Aday Bir'));
    const u = '/api/ana-veri/mukerrer'; expect((await o.ist('GET', u, await o.gir('ds'))).statusCode).toBe(404);
    const v = (await o.ist('GET', u, sc)).json(); const a = v.firmalar.find((z: { ad: string }) => z.ad === ad('Aday Bir')); const b = v.firmalar.find((z: { ad: string }) => z.ad === ad('Aday İki'));
    expect((await o.ist('POST', u, sc, { tur: 'firma', kimlik: a.kimlik, karar: 'Birleştirildi' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, sc, { tur: 'firma', kimlik: a.kimlik, karar: 'Birleştirildi', ana: b.kimlik })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT mukerrer_karari k, ana_kayit_ref r FROM kurulus WHERE kimlik = $1`, [a.kimlik])).rows[0]).toEqual({ k: 'Birleştirildi', r: b.kimlik });
    const n = (await o.ist('GET', `/api/baglama-noktalari?il=${encodeURIComponent(`İl${x}`)}`, await o.gir('ds'))).json(); expect(n).toHaveLength(2);
    expect((await o.ist('POST', `/api/baglama-noktasi/${n[0].kimlik}/tesis`, sc, { tesis: a.kimlik })).statusCode).toBe(400);
  });
});

describe('yurt dışı garanti (YG-1422)', () => {
  it('yurt dışında keşif süresi işlemez; yerinde müdahale ayrı teklif görevi açar; yalnız garantide seçilir', async () => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, o.K.ds, o.K.opm]);
    const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/garanti-sikayet`; const G = { turler: ['Garanti bildirimi'], kanal: 'Telefon', oncelik: 'Normal', belirti: 'Sızıntı' };
    expect((await o.ist('POST', u, ds, { turler: ['Şikâyet'], kanal: 'Telefon', oncelik: 'Normal', konu: 'K', yerinde: true })).statusCode).toBe(400);
    const a = await o.ist('POST', u, ds, { ...G, yurtDisi: true, yerinde: true }); expect(a.statusCode, a.body).toBe(200);
    const k = (await o.sup.query(`SELECT kimlik, kesif_son, yurt_disi, yerinde_mudahale FROM garanti_sikayet WHERE dosya_ref = $1`, [d.kimlik])).rows[0]; expect(k).toMatchObject({ kesif_son: null, yurt_disi: true, yerinde_mudahale: true });
    expect((await o.kart('Fiyat Teklifi Hazırla', k.kimlik)).baslik).toContain('Yurt Dışı');
    const b = await o.ist('POST', u, ds, G); expect(b.statusCode, b.body).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM garanti_sikayet WHERE dosya_ref = $1 AND kesif_son IS NOT NULL`, [d.kimlik])).rows[0].n).toBe(1);
  });
});

describe('imzalı nüshalar (YG-589)', () => {
  it('imzalı ön bilgilendirme teklife bağlanır; kâğıt cayma formu caymayı işler', async () => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2, musteri_turu = 'Bireysel Müşteri' WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, hazirlayan_ref) VALUES ($1,$2,'Onarım','Yat Sahibi',20,$3) RETURNING kimlik`, [`T-IM-${Date.now()}`, d.kimlik, o.K.ds])).rows[0].kimlik;
    const bel = async () => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('İmzalı ' || gen_random_uuid(),'Sözleşme','Dosya',$1,'Sistem',current_date,$2) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik as string;
    const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/teklif/${t}/imzali-on-bilgi`, ds, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/teklif/${t}/imzali-on-bilgi`, ds, { belge: await bel() })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/cayma-formu`, ds, { belge: await bel() })).statusCode).toBe(409);
    await o.sup.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis) VALUES ($1,$2,now(),now(),now() + interval '14 days')`, [t, d.kimlik]);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/cayma-formu`, ds, { belge: await bel() })).json().cayma).toBe(true);
    expect((await o.sup.query(`SELECT kanal, iade_durumu FROM on_bilgilendirme_cayma_kaydi WHERE teklif_ref = $1`, [t])).rows[0]).toEqual({ kanal: 'Islak İmzalı Form', iade_durumu: 'Hesap Bekliyor' });
  });
});

describe('geçici marka-model onayı (YG-093)', () => {
  it('Diğer girişi Teknik Müdür onayıyla listeye eklenir ve yat bağlanır', async () => {
    const md = `Marka${Date.now()}`;
    const d = await o.dosyaAc({ yat: { adi: `Y${md}`, markaDiger: md, modelDiger: 'M1', boy: 14, govde: 'Fiber', tur: 'Motor Yat', bayrak: 'Türk', kullanim: 'Özel', klas: 'Hayır' } });
    const k = (await o.sup.query(`SELECT kimlik FROM is_karti WHERE tur = 'Marka Model Onayı' AND ozet = $1`, [`${md} / M1`])).rows[0];
    expect(k).toBeTruthy();
    expect((await o.karar(k.kimlik, 'tm', 'Onaya Gönder', 'Teknik bilgiler uygun')).statusCode).toBe(200); // YG-1528: Teknik Müdür görüşü
    expect((await o.karar(k.kimlik, 'btd', 'Onayla')).statusCode).toBe(200);
    const y = (await o.sup.query(`SELECT y.diger_onay_durumu, m.model FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref WHERE d.kimlik = $1`, [d.kimlik])).rows[0];
    expect(y).toMatchObject({ diger_onay_durumu: 'Onaylandı', model: 'M1' });
    expect((await o.sup.query(`SELECT durum FROM yat_marka_model WHERE lower(marka) = lower($1)`, [md])).rows[0].durum).toBe('Fotoğraf ve teknik eksik'); // YG-1525
  });
});

describe('istenecek belge listesi (YG-1439)', () => {
  it('genel liste oluşur, ruhsat yüklenince Alındı olur', async () => {
    const d = await o.dosyaAc(); const c = await o.gir('opm');
    const r0 = await o.ist('GET', `/api/dosya/${d.kimlik}/belge-listesi`, c); expect(r0.statusCode, r0.body).toBe(200); const l = r0.json() as { belge: string; durum: string }[];
    expect(l.find((x) => x.belge.startsWith('Ruhsat'))?.durum).toBe('Eksik');
    expect(l.some((x) => /Poliçe|Transit/.test(x.belge))).toBe(false);
    await o.sup.query(`UPDATE belge SET ad = 'Ruhsat' WHERE kimlik = $1`, [await o.belge(d.kimlik, 'opm')]);
    const l2 = (await o.ist('GET', `/api/dosya/${d.kimlik}/belge-listesi`, c)).json() as { belge: string; durum: string }[];
    expect(l2.find((x) => x.belge.startsWith('Ruhsat'))?.durum).toBe('Alındı');
  });
  it('Saha Sorumlusu talebi Teknik Müdürde; ret T&O Direktörüne taşınır; geri çekme onayla ve devir notuyla (YG-051, YG-052)', async () => {
    const d = await o.dosyaAc({}, {}); const ds = await o.gir('opm');
    const T = (g: Record<string, unknown>) => o.ist('POST', `/api/dosya/${d.kimlik}/saha-sorumlusu-talebi`, ds, g);
    expect((await T({})).statusCode).toBe(400);
    { const r = await T({ gerekce: 'Yerinde koordinasyon gerekli' }); expect(r.statusCode, r.body).toBe(200); }
    expect((await T({ gerekce: 'X' })).statusCode).toBe(409);
    expect((await o.karar((await o.kart('Saha Sorumlusu Talebi', d.kimlik)).kimlik, 'tm', 'Reddet', 'Uygun personel yok')).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/saha-sorumlusu-talebi/direktor`, ds, { gerekce: 'Operasyon ısrarlı' })).statusCode).toBe(200);
    expect((await o.karar((await o.kart('Saha Sorumlusu Anlaşmazlığı', d.kimlik)).kimlik, 'tod', 'Onayla')).statusCode).toBe(200);
    expect((await o.kart('Saha Sorumlusu Ataması', d.kimlik)).durum).not.toBe('Tamamlandı');
    expect((await o.ata(d.kimlik, 'ss', 'Saha Sorumlusu', 'tm')).statusCode).toBe(200);
    expect((await o.kart('Saha Sorumlusu Ataması', d.kimlik)).durum).toBe('Tamamlandı');
    expect((await T({ tur: 'Geri Çekme', gerekce: '' })).json().hata).toContain('Devir notu');
    expect((await T({ tur: 'Geri Çekme', gerekce: 'Açık işler Teknik Uzmana devredildi' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Saha Sorumlusu' AND bitis_zamani IS NULL`, [d.kimlik])).rowCount).toBe(1);
    expect((await o.karar((await o.kart('Saha Sorumlusu Talebi', d.kimlik)).kimlik, 'tm', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT devir_notu FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Saha Sorumlusu'`, [d.kimlik])).rows[0].devir_notu).toBe('Açık işler Teknik Uzmana devredildi');
  });
  it('kapanış aşamaları ayrı koşullarla; dosya kapanışı garanti takibini kapatmaz (YG-073)', async () => {
    const d = await o.dosyaAc({}, {}); const c = await o.gir('opm');
    const l0 = (await o.ist('GET', `/api/dosya/${d.kimlik}/kapanis-asamalari`, c)).json() as { asama: string; durum: string; kosul: string }[];
    expect(l0.map((x) => x.asama)).toEqual(['Teslim', 'Teknik Kapanış', 'Mali Kapanış', 'Kurumsal Dosya Kapanışı', 'Garanti Takibi']);
    expect(l0.find((x) => x.asama === 'Garanti Takibi')?.durum).toBe('Başlamadı');
    await o.sup.query(`UPDATE dosya SET garanti_tanimli = true, garanti_suresi_ay = 12, garanti_kapsami = 'İşçilik', teslim_tarihi = current_date - 30, statu = 'Kapalı', kapanma_nedeni = 'Tamamlandı', kapanis_zamani = now() WHERE kimlik = $1`, [d.kimlik]);
    const l1 = (await o.ist('GET', `/api/dosya/${d.kimlik}/kapanis-asamalari`, c)).json() as { asama: string; durum: string }[];
    expect(l1.find((x) => x.asama === 'Mali Kapanış')?.durum).toBe('Tamamlandı');
    expect(l1.find((x) => x.asama === 'Garanti Takibi')?.durum).toBe('Sürüyor');
  });
  it('sigorta şirketinin yetkilendirdiği kişiye portal hesabı açılır (YG-453)', async () => {
    const u = '/api/sigorta-kullanici'; const ep = `eksper${Date.now()}@deneme.yatonet.local`;
    expect((await o.ist('POST', u, await o.gir('ds'), { tsbKodu: '1004', ad: 'E', eposta: ep, dayanak: 'Y' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, await o.gir('mpm'), { tsbKodu: '1004', ad: 'Eksper Bir', eposta: ep })).json().hata).toContain('yetkilendirme yazısı');
    const r = await o.ist('POST', u, await o.gir('mpm'), { tsbKodu: '1004', ad: 'Eksper Bir', eposta: ep, dayanak: '10.11.2026 / 123' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT sigortaci_adi FROM sigorta_kullanici WHERE kullanici_ref = $1`, [r.json().kimlik])).rows[0].sigortaci_adi).toBe('Allianz Sigorta A.Ş.');
    expect((await o.ist('POST', u, await o.gir('mpm'), { tsbKodu: '1004', ad: 'Eksper Bir', eposta: ep, dayanak: 'x' })).statusCode).toBe(409);
    expect((await o.ist('GET', '/api/sigorta-kullanicilar', await o.gir('ds'))).statusCode).toBe(404);
    const l = (await o.ist('GET', '/api/sigorta-kullanicilar', await o.gir('mpm'))).json() as { kimlik: string; hesap_durumu: string }[]; expect(l.some((x) => x.kimlik === r.json().kimlik)).toBe(true);
    const k = await o.ist('POST', `/api/dis-kullanici/${r.json().kimlik}/ayrilis-bildirimi`, await o.gir('mpm'), { tur: 'Ayrılış', kanal: 'E-posta', bildirimZamani: new Date().toISOString() }); expect(k.statusCode, k.body).toBe(200);
    expect((await o.sup.query(`SELECT hesap_durumu FROM kullanici_hesabi WHERE kimlik = $1`, [r.json().kimlik])).rows[0].hesap_durumu).toBe('Kapalı');
  });
  it('kurumsal müşteride Müşteri Talimatı kaydı ve BLD-67 (YG-437)', async () => {
    const d = await o.dosyaAc({}, {}); const ds = await o.gir('opm');
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.opm]);
    const u = `/api/dosya/${d.kimlik}/musteri-talimati`; const P = { kanal: 'E-posta', limit: 5000, hedef: '2026-12-20', metin: 'Pervane onarımı' };
    expect((await o.ist('POST', u, ds, P)).json().hata).toContain('kurumsal');
    await o.sup.query(`UPDATE dosya SET musteri_turu = 'Kurumsal Müşteri' WHERE kimlik = $1`, [d.kimlik]);
    expect((await o.ist('POST', u, ds, { ...P, limit: 0 })).statusCode).toBe(400);
    const r = await o.ist('POST', u, ds, P); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().talimatNo).toBe(`${d.dosyaNo}-MT01`);
  });
  it('veri düzeltme talebi kaynak ve etkilenenle; onayda önceki değer izde kalır (YG-1246)', async () => {
    const d = await o.dosyaAc({}, {}); const yat = (await o.sup.query(`SELECT yat_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].yat_ref;
    const u = '/api/veri-duzeltme-talebi'; const c = await o.gir('ds');
    expect((await o.ist('POST', u, c, { nesneTuru: 'Yat', nesne: yat, alan: 'kislama_yeri', dogruDeger: 'Göcek' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, c, { nesneTuru: 'Yat', nesne: yat, alan: 'kislama_yeri', dogruDeger: 'Göcek Marina', kaynak: 'Marina sözleşmesi', etkilenen: d.dosyaNo }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.karar((await o.kart('Veri Düzeltme Talebi', r.json().kimlik)).kimlik, 'opm', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT kislama_yeri FROM yat WHERE kimlik = $1`, [yat])).rows[0].kislama_yeri).toBe('Göcek Marina');
    expect((await o.sup.query(`SELECT 1 FROM denetim_izi WHERE eylem = 'Veri Düzeltme' AND nesne_kimligi = $1`, [yat])).rowCount).toBe(1);
  });
  it('kimlik doğrulama süreleri sistem parametresinden yüklenir (YG-1712, YG-1713)', async () => {
    const { KURAL, kuralYukle } = await import('../src/ayarlar.js');
    expect((await o.sup.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'kimlik_sms_kod_gecerlilik_dk'`)).rows[0].deger).toBe('5');
    await o.sup.query(`UPDATE sistem_parametresi SET deger = 7 WHERE kod = 'kimlik_sms_kod_gecerlilik_dk'`);
    await kuralYukle(o.db); expect(KURAL.smsKodGecerlilikDk).toBe(7);
    await o.sup.query(`UPDATE sistem_parametresi SET deger = 5 WHERE kod = 'kimlik_sms_kod_gecerlilik_dk'`); await kuralYukle(o.db); expect(KURAL.smsKodGecerlilikDk).toBe(5);
  });
  it('iade kaydı Ticari Sorumlu hazırlar, TİD onaylar, BLD-47 gider (YG-1499)', async () => {
    const d = await o.dosyaAc({}, {}); const u = `/api/dosya/${d.kimlik}/iade`; const P = { neden: 'Fazla Ödeme', tutar: 150, paraBirimi: 'EUR', tarih: '2026-11-16', odemeAraci: 'Banka havalesi' };
    expect((await o.ist('POST', u, await o.gir('opm'), P)).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('ts'), { ...P, odemeAraci: '' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, await o.gir('ts'), P); expect(r.statusCode, r.body).toBe(200);
    expect((await o.karar((await o.kart('İade Kaydı', r.json().kimlik)).kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM iade_kaydi WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('Onaylandı');
    expect((await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld47:${r.json().kimlik}%`])).rows[0].metin).toContain('150,00 EUR tutarındaki iade');
  });
  it('sözleşme taahhüt süresi sigortaya göre; yoksa Tanımsız; bireyselde gösterilmez; aşımda uyarı (YG-147)', async () => {
    const sg = `Süre Sigorta ${Date.now()}`; const u = '/api/sozlesme-hedef-suresi';
    expect((await o.ist('POST', u, await o.gir('ds'), { sigortaci: sg, tur: 'Keşif', oncelik: 'Normal', saat: 48 })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('mpm'), { tur: 'Keşif', oncelik: 'Normal', saat: 48 })).statusCode).toBe(400);
    expect((await o.ist('POST', u, await o.gir('mpm'), { sigortaci: sg, tur: 'Keşif', oncelik: 'Normal', saat: 48 })).statusCode).toBe(200);
    const { sozlesmeHedefi, sozlesmeSureIsle } = await import('../src/kalan.js');
    const d = await o.dosyaAc({}, {});
    await o.sup.query(`UPDATE dosya SET musteri_turu = 'Sigorta Şirketi', oncelik = 'Normal' WHERE kimlik = $1`, [d.kimlik]);
    await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi) VALUES ($1,$2)`, [d.kimlik, sg]);
    expect(await sozlesmeHedefi(o.db, d.kimlik, 'Keşif')).toBe('48 saat');
    expect(await sozlesmeHedefi(o.db, d.kimlik, 'Teklif')).toBe('Tanımsız');
    await o.sup.query(`INSERT INTO dosya_sure (dosya_ref, tur, baslangic, bitis) VALUES ($1,'Keşif',now() - interval '50 hours',now() + interval '22 hours') ON CONFLICT DO NOTHING`, [d.kimlik]);
    await o.sup.query(`UPDATE dosya_sure SET baslangic = now() - interval '50 hours', tamamlanma = NULL WHERE dosya_ref = $1 AND tur = 'Keşif'`, [d.kimlik]);
    await sozlesmeSureIsle(o.db); await sozlesmeSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(DISTINCT olay_anahtari)::int n FROM bildirim WHERE olay_anahtari LIKE 'sozlesme-sure:%' AND baslik LIKE $1`, [`%${d.dosyaNo}%`])).rows[0].n).toBe(1);
    await o.sup.query(`UPDATE dosya SET musteri_turu = 'Bireysel Müşteri' WHERE kimlik = $1`, [d.kimlik]);
    expect(await sozlesmeHedefi(o.db, d.kimlik, 'Keşif')).toBeNull();
  });
  it('toplantı kararı dosyaya ve göreve bağlanır, dosyada görünür (YG-1408)', async () => {
    const d = await o.dosyaAc({}, {}); const c = await o.gir('ds');
    const kod = (await o.ist('GET', '/api/toplanti/secenek', c)).json().turler[0].kod;
    const r = await o.ist('POST', '/api/toplanti', c, { kod, konu: 'Kapsam', baslangic: new Date(Date.now() + 86_400_000).toISOString(), katilimcilar: [{ kullanici: o.K.oy }], dosya: d.kimlik });
    expect(r.statusCode, r.body).toBe(200);
    const k = await o.ist('POST', `/api/toplanti/${r.json().kimlik}/karar`, c, { metin: 'Parça siparişi verilecek', sorumlu: o.K.oy, hedef: '2099-01-01' }); expect(k.statusCode, k.body).toBe(200);
    const lr = await o.ist('GET', `/api/dosya/${d.kimlik}/toplanti-kararlari`, await o.gir('opm')); expect(lr.statusCode, lr.body).toBe(200); const l = lr.json(); expect(l.length, JSON.stringify(k.json())).toBe(1); expect(l[0].metin).toBe('Parça siparişi verilecek'); expect(l[0].gorev_durumu).toBe('Bekliyor');
  });
  it('liste dışı sigorta şirketi ana veri görevi açar (YG-1558)', async () => {
    const c = await o.gir('ds');
    const r = await o.ist('POST', '/api/ihbar', c, { kanal: 'Telefon', sahibiAdi: 'Kaptan', sahibiTuru: 'Yatın Kaptanı', yetkiDurumu: 'Doğrulandı', telefon: '+905550001111', konum: 'Marmaris', yatDurumu: 'Bağlı', ihtiyac: 'Hasar', yat: { adi: `LD${Date.now()}`, markaDiger: 'M', modelDiger: 'N', boy: 14, govde: 'Fiber', tur: 'Motor Yat', bayrak: 'Türk', kullanim: 'Özel', klas: 'Hayır' }, yatSahibi: { ad: 'Sahip', telefon: '+905550002222', eposta: `ld${Date.now()}@deneme.yatonet.local` }, cevaplar: {}, sigortaci: 'Listede Olmayan Sigorta AŞ' });
    expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Ana Veri Güncelleme' AND nesne_kimligi = $1`, [r.json().kimlik])).rows[0].n).toBe(1);
  });
  it('Ticari Sorumlu dosyanın ticari özetini görür (YG-1024)', async () => {
    const d = await o.dosyaAc({}, {});
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/ticari-ozet`, await o.gir('tu'))).statusCode).toBe(404);
    const r = await o.ist('GET', `/api/dosya/${d.kimlik}/ticari-ozet`, await o.gir('ts')); expect(r.statusCode, r.body).toBe(200);
    expect(Object.keys(r.json())).toEqual(['teklifler', 'isEmirleri', 'hakedisler', 'faturalar', 'teknikRaporlar']);
  });
  it('eksik yat bilgisi görev olur, kaynakla tamamlanınca kapanır (YG-1245)', async () => {
    const d = await o.dosyaAc({}, {}); const yat = (await o.sup.query(`SELECT yat_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].yat_ref;
    const k = (await o.sup.query(`SELECT durum, ozet FROM is_karti WHERE tur = 'Eksik Yat Bilgisi' AND nesne_kimligi = $1`, [yat])).rows[0];
    expect(k.durum).toBe('Bekliyor'); expect(k.ozet).toContain('tahrik');
    const c = await o.gir('opm'); const u = `/api/yat/${yat}/duzelt`;
    expect((await o.ist('POST', u, c, { alanlar: { tahrik_turu: 'Şaft' }, gerekce: 'Kaptan söyledi' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, c, { alanlar: { tahrik_turu: 'Şaft' }, gerekce: 'Kaptan söyledi', kaynak: 'Telefon (kaptan / yat sahibi)' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM is_karti WHERE tur = 'Eksik Yat Bilgisi' AND nesne_kimligi = $1`, [yat])).rows[0].durum).toBe('Tamamlandı');
  });
  it('periyodik iş tanımı Direktörce girilir ve listelenir (YG-1357)', async () => {
    const ad = `Deneme Gözden Geçirme ${Date.now()}`; const P = { ad, sahipRol: 'Operasyon Müdürü', periyotAy: 6, sonrakiTarih: '2027-01-15' };
    expect((await o.ist('POST', '/api/periyodik-is', await o.gir('ds'), P)).statusCode).toBe(403);
    const c = await o.gir('btd'); expect((await o.ist('POST', '/api/periyodik-is', c, { ...P, periyotAy: 0 })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/periyodik-is', c, P); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', '/api/periyodik-is', c, P)).statusCode).toBe(409);
    const l = (await o.ist('GET', '/api/periyodik-isler', c)).json(); expect(l.tanimlar).toBe(true); expect(l.isler.some((x: { ad: string }) => x.ad === ad)).toBe(true);
    expect((await o.ist('POST', `/api/periyodik-is/${r.json().kimlik}/durum`, c, { aktif: false, gerekce: 'Deneme' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT aktif FROM periyodik_is WHERE kimlik = $1`, [r.json().kimlik])).rows[0].aktif).toBe(false);
    // YG-969: katalogdan yüklenen rol bazlı tanımlar kurulumla gelir; ilk tarih geçmişte kalmaz.
    expect((await o.sup.query(`SELECT count(*)::int n, bool_and(sonraki_tarih >= current_date) g FROM periyodik_is WHERE ad IN ('Haftalık Ödeme Planı', 'Sezon Kadro ve Kapasite Planı', 'Muadil Liste Gözden Geçirmesi')`)).rows[0]).toEqual({ n: 3, g: true });
    // YG-969: günlük iş günü gelince görev açar, Tamamlandı ile kapanınca ertesi güne geçer; olaya bağlı iş olayla açılır.
    const gun = (await o.ist('POST', '/api/periyodik-is', c, { ad: `Günlük ${Date.now()}`, sahipRol: 'Dosya Sorumlusu', periyotTuru: 'Günlük', sonrakiTarih: '2026-01-05' })).json().kimlik;
    const { periyodikIsle } = await import('../src/toplanti.js'); await periyodikIsle(o.db, new Date('2026-01-05T08:00:00Z'));
    const gk = (await o.sup.query(`SELECT kimlik FROM is_karti WHERE tur = 'Periyodik İş' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [gun])).rows[0].kimlik;
    expect((await o.karar(gk, 'ds', 'Tamamlandı')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT sonraki_tarih::text t FROM periyodik_is WHERE kimlik = $1`, [gun])).rows[0].t).toBe('2026-01-06');
    expect((await o.ist('POST', '/api/periyodik-is', c, { ad: 'Eksik Tarih', sahipRol: 'Dosya Sorumlusu', periyotTuru: 'Haftalık' })).statusCode).toBe(400);
    const ob = (await o.ist('POST', '/api/periyodik-is', c, { ad: `Olay ${Date.now()}`, sahipRol: 'Dosya Sorumlusu', periyotTuru: 'Olaya Bağlı' })).json().kimlik;
    expect((await o.ist('POST', `/api/periyodik-is/${ob}/olay`, await o.gir('ds'), { olay: 'Fırtına uyarısı' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Periyodik İş' AND nesne_kimligi = $1`, [ob])).rows[0].n).toBe(1);
  });
  it('veri düzeltme talebi taraf ve firma kaydında da açılır (YG-1246 taraf)', async () => {
    const d = await o.dosyaAc({}, {}); const yat = (await o.sup.query(`SELECT yat_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].yat_ref;
    const sahip = (await o.sup.query(`SELECT yat_sahibi_ref FROM yat WHERE kimlik = $1`, [yat])).rows[0].yat_sahibi_ref;
    const c = await o.gir('ds'); const u = '/api/veri-duzeltme-talebi'; const P = { nesneTuru: 'Taraf', yat, kaynak: 'Vergi levhası', etkilenen: d.kimlik };
    expect((await o.ist('GET', '/api/veri-duzeltme-alanlari', c)).json().Kuruluş).toContain('Ticari Unvan');
    expect((await o.ist('POST', u, c, { ...P, alan: 'Vergi No', dogruDeger: '123' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, c, { ...P, alan: 'Telefon', dogruDeger: '+90 555 000 00 00' }); expect(r.statusCode, r.body).toBe(200);
    const k = (await o.sup.query(`SELECT kimlik FROM is_karti WHERE tur = 'Veri Düzeltme Talebi' AND nesne_kimligi = $1`, [r.json().kimlik])).rows[0].kimlik;
    expect((await o.karar(k, 'opm', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT telefon FROM taraf WHERE kimlik = $1`, [sahip])).rows[0].telefon).toBe('+90 555 000 00 00');
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu) VALUES ($1, 'Düzeltme Deneme Firması', 'Çözüm Ortağı') RETURNING kimlik`, [`DZ-${Date.now()}`])).rows[0].kimlik;
    const r2 = await o.ist('POST', u, c, { nesneTuru: 'Kuruluş', nesne: f, alan: 'Web Adresi', dogruDeger: 'https://ornek.local', kaynak: 'Firma beyanı', etkilenen: '-' }); expect(r2.statusCode, r2.body).toBe(200);
    expect((await o.sup.query(`SELECT r.rol_adi FROM is_karti k JOIN rol r ON r.kimlik = k.zincir[1] WHERE k.tur = 'Veri Düzeltme Talebi' AND k.nesne_kimligi = $1`, [r2.json().kimlik])).rows[0].rol_adi).toBe('Firma Yönetimi Müdürü');
  });
  it('her alanın ekran gösterim durumu tanımlıdır, sistem alanları gösterilmez; banka hesabı veri sahibi MFM (YG-1173, YG-929)', async () => {
    const { alanlar, gosterimDenetimi } = await import('../src/veri_sozlugu.js');
    expect(gosterimDenetimi()).toEqual([]);
    expect(gosterimDenetimi([{ ...alanlar()[0]!, teknik: 'kimlik', ekran: 'Gösterilir' }])).toHaveLength(1);
    expect(alanlar().filter((a) => a.varlik === 'Banka Hesabı').every((a) => a.sahip === 'Muhasebe ve Finans Müdürü')).toBe(true);
    const r = await o.ist('GET', `/api/veri-sozlugu?q=kimlik&ekran=${encodeURIComponent('Gösterilmez')}`, await o.gir('ds')); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().satirlar.every((a: { ekran: string }) => a.ekran.startsWith('Gösterilmez'))).toBe(true);
  });
  it('kartela araması fiyatsız alan döndürür (YG-433)', async () => {
    const r = await o.ist('GET', '/api/kartela/ara?q=bo', await o.gir('ds')); expect(r.statusCode).toBe(200);
    for (const x of r.json() as Record<string, unknown>[]) expect(Object.keys(x).some((k) => /fiyat|eur|maliyet/i.test(k))).toBe(false);
  });
  it('geciken görev önce sorumluya, 24 saat sonra karar merciine gider; acil işaretleme sınırlı (YG-1361)', async () => {
    const { kartAc } = await import('../src/is_motoru.js'); const { gorevSureIsle } = await import('../src/onay_sure.js');
    const son = new Date(Date.now() - 3_600_000);
    const k = await kartAc(o.db, { tur: 'Deneme Görevi', kategori: 'gorev', baslik: `Gecikme Deneme ${Date.now()}`, sahipKullanici: o.K.ds, sonZaman: son });
    await gorevSureIsle(o.db, new Date());
    expect((await o.sup.query(`SELECT kullanici_ref FROM bildirim WHERE olay_anahtari = $1`, [`gorev-sure:${k}:u`])).rows.map((r) => r.kullanici_ref)).toEqual([o.K.ds]);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1`, [`gorev-sure:${k}:e`])).rowCount).toBe(0);
    await gorevSureIsle(o.db, new Date(Date.now() + 25 * 3_600_000));
    expect((await o.sup.query(`SELECT kullanici_ref FROM bildirim WHERE olay_anahtari = $1`, [`gorev-sure:${k}:e`])).rows.map((r) => r.kullanici_ref)).toContain(o.K.opm);
    const d = await o.dosyaAc({}, {}); const c = await o.gir('opm'); const u = `/api/dosya/${d.kimlik}/konu`;
    await o.sup.query(`UPDATE dosya SET oncelik = 'Normal' WHERE kimlik = $1`, [d.kimlik]);
    const P = { baslik: 'Acil', sahip: o.K.opm, hedefTarih: '2027-01-10', kabulOlcutu: 'Tamam', oncelik: 'Kritik' };
    expect((await o.ist('POST', u, c, P)).statusCode).toBe(400);
    for (let n = 0; n < 3; n++) expect((await o.ist('POST', u, c, { ...P, baslik: `Acil ${n}`, oncelikGerekcesi: 'Su alıyor' })).statusCode).toBe(200);
    expect((await o.ist('POST', u, c, { ...P, baslik: 'Acil 4', oncelikGerekcesi: 'Su alıyor' })).statusCode).toBe(409);
    expect((await o.ist('POST', u, c, { ...P, baslik: 'Normal', oncelik: 'Normal' })).statusCode).toBe(200);
  });
  it('ortak arama kişi adıyla dosya bulur (YG-1374)', async () => {
    const d = await o.dosyaAc({}, {}); const ad = `Aranan Kişi ${Date.now()}`;
    await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi) VALUES ($1, 'Kaptan', $2)`, [d.kimlik, ad]);
    const r = await o.ist('GET', `/api/ara?q=${encodeURIComponent(ad)}`, await o.gir('opm')); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().dosyalar.some((x: { kimlik: string }) => x.kimlik === d.kimlik)).toBe(true); expect(Array.isArray(r.json().firmalar)).toBe(true);
    expect((await o.ist('GET', '/api/sigorta/ara?q=LGM', await o.gir('opm'))).statusCode).toBe(404);
    const p = await o.ist('GET', '/api/portal/ara?q=LGM', await o.gir('opm')); expect(p.statusCode).toBe(200); expect(p.json()).toEqual([]);
  });
  it('kapanmış açık konu gerekçeyle yeniden açılır (YG-153)', async () => {
    const d = await o.dosyaAc({}, {}); const c = await o.gir('opm');
    const k = (await o.ist('POST', `/api/dosya/${d.kimlik}/konu`, c, { baslik: 'Yeniden açma', sahip: o.K.opm, hedefTarih: '2027-01-10', kabulOlcutu: 'Tamam' })).json().kimlik as string;
    await o.sup.query(`UPDATE acik_konu SET statu = 'Kapalı', kapanis_zamani = now(), kapanis_kaniti = 'Foto' WHERE kimlik = $1`, [k]);
    const u = `/api/konu/${k}/durum`;
    expect((await o.ist('POST', u, c, { statu: 'İşlemde' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, c, { statu: 'Açık', gerekce: 'x' })).statusCode).toBe(409);
    const r = await o.ist('POST', u, c, { statu: 'İşlemde', gerekce: 'Sızıntı tekrarladı' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT statu, kapanis_kaniti FROM acik_konu WHERE kimlik = $1`, [k])).rows[0]).toEqual({ statu: 'İşlemde', kapanis_kaniti: 'Foto' });
    expect((await o.sup.query(`SELECT gerekce FROM denetim_izi WHERE eylem = 'Açık Konu Yeniden Açıldı' ORDER BY kimlik DESC LIMIT 1`)).rows[0].gerekce).toBe('Sızıntı tekrarladı');
  });
  it('yapılacaklar listesinde hedef süre ve dosya görev kartları (YG-1360)', async () => {
    const d = await o.dosyaAc({}, {}); const { kartAc } = await import('../src/is_motoru.js');
    await kartAc(o.db, { tur: 'Deneme Görevi', kategori: 'gorev', baslik: 'Dosya Görevi Deneme', sahipKullanici: o.K.opm, sonZaman: new Date(Date.now() + 86_400_000), nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
    const v = (await o.ist('GET', `/api/dosya/${d.kimlik}`, await o.gir('opm'))).json();
    const g = v.yapilacaklar.find((x: { is: string }) => x.is === 'Dosya Görevi Deneme'); expect(g).toBeTruthy(); expect(g.hedef).toBeTruthy();
  });
  it('periyodik gözden geçirme kontrol listesi ve karar seçenekleri (YG-1363)', async () => {
    const c = await o.gir('btd'); const ad = `GG Deneme ${Date.now()}`;
    const id = (await o.ist('POST', '/api/periyodik-is', c, { ad, sahipRol: 'Operasyon Müdürü', periyotAy: 6, sonrakiTarih: '2027-01-15' })).json().kimlik as string;
    const K = (await o.ist('GET', '/api/periyodik-isler', c)).json().kontroller as string[]; const tam = Object.fromEntries(K.map((x) => [x, 'Evet']));
    const u = `/api/periyodik-is/${id}/sonuc`;
    expect((await o.ist('POST', u, await o.gir('ds'), { karar: 'Sürdür', kontroller: tam, aciklama: 'x' })).statusCode).toBe(403);
    const opm = await o.gir('opm');
    expect((await o.ist('POST', u, opm, { karar: 'Sürdür', kontroller: {}, aciklama: 'x' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, opm, { karar: 'Değiştir', kontroller: tam, aciklama: 'x' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, opm, { karar: 'Değiştir', kontroller: tam, aciklama: 'Yılda bire', yeniPeriyotAy: 12 }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT periyot_ay, sonraki_tarih::text t FROM periyodik_is WHERE kimlik = $1`, [id])).rows[0]).toEqual({ periyot_ay: 12, t: '2028-01-15' });
    expect((await o.ist('POST', u, opm, { karar: 'Askıya Al', kontroller: tam, aciklama: 'Gerek kalmadı' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT aktif FROM periyodik_is WHERE kimlik = $1`, [id])).rows[0].aktif).toBe(false);
  });
  it('teknik personel belgeyi Uygun/Eksik işaretler (YG-1440)', async () => {
    const d = await o.dosyaAc({}, {});
    const b = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bag_turu, bag_kimligi, olusturan_ref, kaynak_kanali) VALUES ('Ruhsat', 'Dosya Belgesi', 'Dosya', $1, $2, 'Elden') RETURNING kimlik`, [d.kimlik, o.K.opm])).rows[0].kimlik;
    const u = `/api/dosya/${d.kimlik}/belge/${b}/inceleme`;
    expect((await o.ist('POST', u, await o.gir('opm'), { sonuc: 'Uygun' })).statusCode).toBe(403);
    const tu = await o.gir('tm');
    expect((await o.ist('POST', u, tu, { sonuc: 'Eksik' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, tu, { sonuc: 'Eksik', not: 'Sayfa 2 yok' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT inceleme_sonucu FROM belge WHERE kimlik = $1`, [b])).rows[0].inceleme_sonucu).toBe('Eksik');
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/belge-inceleme`, tu)).json().teknik).toBe(true);
  });
  it('belge ve eğitim işi konu türüdür ve konu türü Planlı olur (YG-031)', async () => {
    const d = await o.dosyaAc({}, {}); const c = await o.gir('opm'); const u = `/api/dosya/${d.kimlik}/konu`; const P = { baslik: 'Eğitim', sahip: o.K.opm, hedefTarih: '2027-01-10', kabulOlcutu: 'Tamam' };
    expect((await o.ist('POST', u, c, { ...P, konuTuru: 'Toplantı' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, c, { ...P, konuTuru: 'Eğitim', oncelik: 'Kritik' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT konu_turu, oncelik FROM acik_konu WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ konu_turu: 'Eğitim', oncelik: 'Planlı' });
  });
  it('çok malikli yatta malikler ve yetkili malik (YG-478)', async () => {
    const d = await o.dosyaAc({}, {}); const c = await o.gir('opm'); const u = `/api/dosya/${d.kimlik}/malik`;
    const a = (await o.ist('POST', u, c, { ad: 'Malik A', pay: 60 })).json().kimlik as string;
    expect((await o.ist('POST', u, c, { ad: 'Malik B', pay: 50 })).statusCode).toBe(409);
    expect((await o.ist('POST', u, c, { ad: 'Malik B', pay: 40 })).statusCode).toBe(200);
    expect((await o.ist('POST', u, c, { ad: 'Foreign Owner', yurtDisi: true })).statusCode).toBe(400); // YG-479
    expect((await o.ist('POST', u, c, { ad: 'Foreign Owner', yurtDisi: true, tebligat: 'Netsel Marina, Marmaris' })).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/malikler`, c)).json().find((x: { ad: string }) => x.ad === 'Foreign Owner')).toMatchObject({ yurt_disi: true, tebligat_adresi_tr: 'Netsel Marina, Marmaris' });
    expect((await o.ist('POST', `${u}/${a}/yetkili`, c, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `${u}/${a}/yetkili`, c, { dayanak: 'Malikler beyanı 16.11.2026' })).statusCode).toBe(200);
    const l = (await o.ist('GET', `/api/dosya/${d.kimlik}/malikler`, c)).json() as { ad: string; yetkili: boolean }[];
    expect(l.filter((x) => x.yetkili).map((x) => x.ad)).toEqual(['Malik A']);
  });
  it('evlilik, doğum ve vefat haberi yalnız çalışanın talebiyle LGM içinde duyurulur (YG-946)', async () => {
    const c = await o.gir('ds'); const u = '/api/haber-duyurusu';
    expect((await o.ist('POST', u, c, { tur: 'Nişan' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, c, { tur: 'Doğum', aciklama: 'Kızımız dünyaya geldi.' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT kapsam, durum FROM duyuru WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ kapsam: 'LGM', durum: 'Yayında' });
    expect((await o.ist('POST', u, c, { tur: 'Doğum' })).statusCode).toBe(409);
  });
  it('İç Denetim Müdürünün makamları (YG-1678)', async () => {
    const rid = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
    const idm = await rid('İç Denetim Müdürü');
    const { karneMakami } = await import('../src/personel_karne.js'); const { denemeZinciri } = await import('../src/akademi.js'); const { onayMakami } = await import('../src/makam.js');
    expect(await karneMakami(o.db, { ad: 'İç Denetim Müdürü', kimlik: idm })).toBe(await rid('CEO'));
    expect(await denemeZinciri(o.db, idm)).toEqual([await rid('CEO')]);
    expect(await onayMakami(o.db, idm)).toBe(await rid('Risk ve Kalite Direktörü'));
  });
  it('rızalı evlilik yıl dönümü özel günlerde görünür, rızasız görünmez (YG-946)', async () => {
    const { ozelGunler } = await import('../src/ozel_gun.js'); const bugun = new Date();
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) VALUES ($1, '2020-01-01', $1) ON CONFLICT DO NOTHING`, [o.K.ds]);
    await o.sup.query(`INSERT INTO personel_ozel_gun (personel_ref, evlilik_tarihi, paylasim_rizasi) VALUES ($1, $2, true) ON CONFLICT (personel_ref) DO UPDATE SET evlilik_tarihi = $2, paylasim_rizasi = true`, [o.K.ds, `2015-${bugun.toISOString().slice(5, 10)}`]);
    expect((await ozelGunler(o.db, bugun)).some((x) => x.tur === 'Evlilik Yıl Dönümü')).toBe(true);
    await o.sup.query(`UPDATE personel_ozel_gun SET paylasim_rizasi = false, evlilik_tarihi = NULL WHERE personel_ref = $1`, [o.K.ds]);
    expect((await ozelGunler(o.db, bugun)).some((x) => x.tur === 'Evlilik Yıl Dönümü')).toBe(false);
  });
  it('yat satışında sahip devri; önceki sahip geçmişte, açık dosyaya görev (YG-091)', async () => {
    const d = await o.dosyaAc({}, {}); const yat = (await o.sup.query(`SELECT yat_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].yat_ref;
    const eski = (await o.sup.query(`SELECT yat_sahibi_ref FROM yat WHERE kimlik = $1`, [yat])).rows[0].yat_sahibi_ref;
    const yeni = (await o.sup.query(`INSERT INTO taraf (taraf_no, kisi_turu, unvan_ad_soyad) VALUES ($1, 'Gerçek kişi', 'Yeni Malik') RETURNING taraf_no`, [`TRF-D${Date.now()}`])).rows[0].taraf_no;
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.opm]);
    const c = await o.gir('opm'); const u = `/api/yat/${yat}/sahip-devri`;
    expect((await o.ist('POST', u, c, { tarafNo: yeni, devirTarihi: '2026-11-01' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, c, { tarafNo: yeni, devirTarihi: '2026-11-01', dayanak: 'Noter satış sözleşmesi' }); expect(r.statusCode, r.body).toBe(200); expect(r.json().acikDosya).toBeGreaterThanOrEqual(1);
    expect((await o.sup.query(`SELECT onceki_sahip_ref FROM yat_sahip_gecmisi WHERE yat_ref = $1`, [yat])).rows[0].onceki_sahip_ref).toBe(eski);
    expect((await o.kart('Yat Sahibi Değişti', d.kimlik)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', u, c, { tarafNo: yeni, devirTarihi: '2026-11-01', dayanak: 'x' })).statusCode).toBe(409);
  });
  it('firma ilçe teyidi kaynağıyla kaydedilir (YG-1261)', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, ilce) VALUES ($1, 'İlçe Deneme', 'Çözüm Ortağı', NULL) RETURNING kimlik`, [`IT-${Date.now()}`])).rows[0].kimlik;
    const c = await o.gir('sc'); const u = `/api/firma/${f}/sicil-ek`;
    expect((await o.ist('POST', u, c, { ilceTeyitKaynagi: 'Vergi levhası' })).statusCode).toBe(409);
    await o.sup.query(`UPDATE kurulus SET ilce = 'Marmaris' WHERE kimlik = $1`, [f]);
    expect((await o.ist('POST', u, c, { ilceTeyitKaynagi: 'Vergi levhası' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT ilce_teyit_kaynagi, ilce_teyit_eden_ref FROM kurulus WHERE kimlik = $1`, [f])).rows[0]).toEqual({ ilce_teyit_kaynagi: 'Vergi levhası', ilce_teyit_eden_ref: o.K.sc });
  });
  it('kaldırma ve taşıma tutanağı FR-OPS-012 indirilir (YG-376)', async () => {
    const d = await o.dosyaAc({}, {}); const c = await o.gir('opm');
    const k = (await o.sup.query(`INSERT INTO kaldirma_tasima (dosya_ref, tur, ekipman, kapasite_ton, yat_agirlik_ton, yeni_hasar, kaydeden_ref, guzergah) VALUES ($1, 'Kara Taşıması', 'Lowbed', 40, 12, false, $2, 'Marmaris → Bodrum') RETURNING kimlik`, [d.kimlik, o.K.opm])).rows[0].kimlik;
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/kaldirma-tasima`, c)).json().length).toBe(1);
    const r = await o.ist('GET', `/api/kaldirma-tasima/${k}/tutanak?bicim=docx`, c); expect(r.statusCode).toBe(200); expect(r.headers['content-disposition']).toContain('-KT-');
  });
  it('süresi dolan yat belgesi yeniden istenir (YG-1440)', async () => {
    const d = await o.dosyaAc({}, {}); const yat = (await o.sup.query(`SELECT yat_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].yat_ref;
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const b = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bag_turu, bag_kimligi, olusturan_ref, kaynak_kanali) VALUES ('Ruhsatname', 'Dosya Belgesi', 'Yat', $1, $2, 'Elden') RETURNING kimlik`, [yat, o.K.opm])).rows[0].kimlik;
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/belge/${b}/inceleme`, await o.gir('tm'), { sonuc: 'Uygun', gecerlilikBitis: '2026-01-31' })).statusCode).toBe(200);
    const { belgeSuresiIsle } = await import('../src/dosya.js');
    expect(await belgeSuresiIsle(o.db)).toBeGreaterThanOrEqual(1);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Süresi Dolan Yat Belgesi' AND nesne_kimligi = $1`, [d.kimlik])).rows[0].n).toBe(1);
    await belgeSuresiIsle(o.db); expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Süresi Dolan Yat Belgesi' AND nesne_kimligi = $1`, [d.kimlik])).rows[0].n).toBe(1);
  });
  it('ihbar kaydına LGM personeli ilk fotoğraf ekler (YG-017)', async () => {
    const t = (await o.sup.query(`SELECT kimlik FROM talep WHERE olusturan_ref IS DISTINCT FROM $1 ORDER BY kayda_gecis_zamani DESC LIMIT 1`, [o.K.opm])).rows[0];
    if (!t) return;
    const yukle = async (c: string, ad: string) => o.s.inject({ method: 'POST', url: `/api/belge/yukle?${new URLSearchParams({ ad, tur: 'Hasar Fotoğrafı', bagTuru: 'Talep', bagKimligi: t.kimlik, kaynak: 'WhatsApp', dosya: ad })}`, headers: { 'x-yatonet': '1', 'content-type': 'application/octet-stream' }, cookies: { [COOKIE_ADI]: c }, payload: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]) });
    const c = await o.gir('opm');
    expect((await yukle(c, 'belge.pdf')).statusCode).toBe(400);
    const r = await yukle(c, 'ilk.jpg'); expect([200, 201]).toContain(r.statusCode);
  });
  it('firma ana kayıt görünümü tüm ilişkileri döndürür (YG-346)', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu) VALUES ($1, 'Özet Deneme', 'Çözüm Ortağı') RETURNING kimlik`, [`OZ-${Date.now()}`])).rows[0].kimlik;
    expect((await o.ist('GET', `/api/firma/${f}/ozet`, await o.gir('ds'))).statusCode).toBe(404);
    const r = await o.ist('GET', `/api/firma/${f}/ozet`, await o.gir('sc')); expect(r.statusCode, r.body).toBe(200);
    expect(Object.keys(r.json())).toEqual(['kimlik', 'sozlesmeler', 'branslar', 'belgeler', 'tesisler', 'kapasite', 'sayilar']);
    expect(r.json().sayilar.toplam_is_emri).toBe(0);
  });
  it('sigorta kullanıcısı şirket kaydına bağlanır (YG-1758)', async () => {
    const h = (await o.sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE kullanici_grubu <> 'LGM İç Rolü' LIMIT 1`)).rows[0].kimlik;
    await o.sup.query(`INSERT INTO sigorta_kullanici (kullanici_ref, sigortaci_adi) VALUES ($1, 'Eski Ad Sigorta') ON CONFLICT (kullanici_ref) DO UPDATE SET sigortaci_adi = 'Eski Ad Sigorta', tsb_kodu = NULL`, [h]);
    const c = await o.gir('mpm'); const u = `/api/sigorta-kullanici/${h}/bagla`;
    expect((await o.ist('POST', u, await o.gir('ds'), { tsbKodu: '1004' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, c, { tsbKodu: '0000' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, c, { tsbKodu: '1004' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT tsb_kodu, sigortaci_adi FROM sigorta_kullanici WHERE kullanici_ref = $1`, [h])).rows[0]).toEqual({ tsb_kodu: '1004', sigortaci_adi: 'Allianz Sigorta A.Ş.' });
  });
  it('kesintide alternatif formla alınan ihbar form numarasıyla bir kez aktarılır (YG-278)', async () => {
    const c = await o.gir('ds'); const no = `AF-${Date.now()}`;
    const P = (x: Record<string, unknown>) => ({ kanal: 'Telefon', sahibiAdi: 'Kaptan', sahibiTuru: 'Yatın Kaptanı', yetkiDurumu: 'Doğrulandı', telefon: '+905550001111', konum: 'Marmaris', yatDurumu: 'Bağlı', ihtiyac: 'Hasar', yat: { adi: `AF${Date.now()}`, markaDiger: 'M', modelDiger: 'N', boy: 14, govde: 'Fiber', tur: 'Motor Yat', bayrak: 'Türk', kullanim: 'Özel', klas: 'Hayır' }, cevaplar: {}, ...x });
    expect((await o.ist('POST', '/api/ihbar', c, P({ alternatifFormNo: no }))).statusCode).toBe(400);
    const z = new Date(Date.now() - 5 * 3_600_000).toISOString();
    const r = await o.ist('POST', '/api/ihbar', c, P({ alternatifFormNo: no, bildirimZamani: z })); expect(r.statusCode, r.body).toBe(200);
    const t2 = (await o.sup.query(`SELECT alternatif_form_no, bildirim_alinma_zamani FROM talep WHERE kimlik = $1`, [r.json().kimlik])).rows[0];
    expect(t2.alternatif_form_no).toBe(no); expect(new Date(t2.bildirim_alinma_zamani).toISOString()).toBe(z);
    expect((await o.ist('POST', '/api/ihbar', c, P({ alternatifFormNo: no, bildirimZamani: z }))).statusCode).toBe(409);
  });
  it('mesai dışında dış kanaldan gelen ihbar nöbetçi Dosya Sorumlusuna (YG-240)', async () => {
    const pazar = new Date('2026-11-22T10:00:00Z'); const donem = '2026-11';
    await o.sup.query(`UPDATE nobet_cizelgesi SET durum = 'Yerine Geçti' WHERE donem = $1 AND durum = 'Yürürlükte'`, [donem]);
    const cz = (await o.sup.query(`INSERT INTO nobet_cizelgesi (donem, durum, hazirlayan_ref) VALUES ($1, 'Yürürlükte', $2) RETURNING kimlik`, [donem, o.K.opm])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO nobet_vardiyasi (cizelge_ref, katman, kullanici_ref, baslangic, bitis) VALUES ($1, 'Dosya Sorumlusu', $2, '2026-11-21T12:00:00Z', '2026-11-23T06:00:00Z')`, [cz, o.K.ds]);
    const { ihbarKaydet } = await import('../src/ihbar.js');
    const c = await o.db.connect();
    try {
      const g = { kanal: 'Portal', sahibiAdi: 'Sahip', sahibiTuru: 'Yat Sahibi', telefon: '+905550003333', konum: 'Bodrum', yatDurumu: 'Bağlı', ihtiyac: 'Hasar', yat: { adi: `NB${Date.now()}`, markaDiger: 'M', modelDiger: 'N' }, cevaplar: {} } as never;
      const r = await ihbarKaydet(c, g, o.K.opm!, { ilkSorumlu: o.K.oy! }, pazar) as { kimlik: string };
      expect((await o.sup.query(`SELECT sahip_kullanici_ref s FROM is_karti WHERE tur = 'İhbar Açılış Kontrolü' AND nesne_kimligi = $1`, [r.kimlik])).rows[0].s).toBe(o.K.ds);
      const r2 = await ihbarKaydet(c, g, o.K.opm!, { ilkSorumlu: o.K.oy! }, new Date('2026-11-23T08:00:00Z')) as { kimlik: string };
      expect((await o.sup.query(`SELECT sahip_kullanici_ref s FROM is_karti WHERE tur = 'İhbar Açılış Kontrolü' AND nesne_kimligi = $1`, [r2.kimlik])).rows[0].s).toBe(o.K.oy);
    } finally { c.release(); }
  });
});
