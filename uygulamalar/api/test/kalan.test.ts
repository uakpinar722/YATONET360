import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { araOdemeHesapla, caymaIsle, caymaSureIsle, kurtarmaTanim, teslimBakiyesi } from '../src/kalan.js';
import { teslimEngeli } from '../src/ticari.js';
import { isGunuSonu } from '../src/teklif.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', tid: 'Ticari İşler Direktörü', mfm: 'Muhasebe ve Finans Müdürü', hud: 'Hukuk ve Uyum Direktörü', sc: 'Sicil Sorumlusu', iks: 'İnsan Kaynakları Sorumlusu', sy: 'Sistem Yöneticisi', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü', ikm: 'İnsan Kaynakları Müdürü', gmy: 'Genel Müdür Yardımcısı', huu: 'Hukuk ve Uyum Uzmanı', tod: 'Teknik ve Operasyon Direktörü' };
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
    const a = (await o.ist('GET', u, c)).json() as { ticari_unvan: string; sonuc: string }[]; expect(a.map((x) => x.ticari_unvan).sort()).toEqual(['Muğla Firma', 'Ulusal Firma']);
    const ta = (await o.sup.query(`INSERT INTO taraf (taraf_no, kisi_turu, musteri_turu, unvan_ad_soyad, taraf_rolleri, olusturan_ref) VALUES ($1,'Gerçek kişi','Bireysel Müşteri','Sahip','{Yat Sahibi}',$2) RETURNING kimlik`, [`TR-A${++n}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`UPDATE yat SET yat_sahibi_ref = $2 WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik, ta]);
    await o.sup.query(`INSERT INTO cikar_beyani (kurulus_ref, taraf_ref, aciklama, kaydeden_ref) VALUES ($1,$2,'X',$3)`, [m, ta, o.K.ds]);
    const a2 = (await o.ist('GET', u, c)).json() as { ticari_unvan: string; sonuc: string }[]; expect(a2.at(-1)).toMatchObject({ ticari_unvan: 'Muğla Firma', sonuc: 'Ret' });
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
    expect((await o.ist('POST', '/api/parametre/masraf_yemek_eur', c, { deger: 30, gerekce: 'Tarife' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT eski, yeni FROM parametre_gecmisi WHERE kod = 'masraf_yemek_eur'`)).rows.map((x) => [Number(x.eski), Number(x.yeni)])).toEqual([[25, 30]]);
    expect((await o.ist('GET', '/api/parametreler', await o.gir('ds'))).statusCode).toBe(404);
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
  it('garanti kararında LGM\'nin ödediği çekek firma hakedişine mahsup önerisi olur; yat sahibine kalem açılmaz', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Firma GM','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-GM${++n}`, o.K.ds])).rows[0].kimlik;
    const te = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Tesis GM','Tesis',$2) RETURNING kimlik`, [`S-TG${++n}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Y','K',$4)`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.ds]);
    const tt = (await o.sup.query(`INSERT INTO tesis_talebi (dosya_ref, kurulus_ref, tur, hedef_tarih, olusturan_ref) VALUES ($1,$2,'Çekek Randevusu',current_date,$3) RETURNING kimlik`, [d.kimlik, te, o.K.ds])).rows[0].kimlik;
    const bl = await o.belge(d.kimlik, 'ds');
    await o.sup.query(`INSERT INTO tesis_faturasi (kurulus_ref, talep_ref, fatura_no, tarih, kalem, tutar_eur, belge_ref, giren_ref) VALUES ($1,$2,'TF-1',current_date,'Çekek',400,$3,$4)`, [te, tt, bl, o.K.ds]);
    const gs = (await o.sup.query(`INSERT INTO garanti_sikayet (kayit_no, dosya_ref, kayit_turu, kanal, bildirim_zamani, oncelik, olusturan_ref) VALUES ($1,$2,'{Garanti bildirimi}','Telefon',now(),'Normal',$3) RETURNING kimlik`, [`GS-${++n}`, d.kimlik, o.K.ds])).rows[0].kimlik;
    const r = await o.ist('POST', `/api/garanti-sikayet/${gs}/karar`, await o.gir('ty'), { karar: 'Garanti', gerekce: 'Garanti kapsamında' }); expect(r.statusCode, r.body).toBe(200);
    const m = (await o.sup.query(`SELECT kimlik, kurulus_ref, tutar_eur, statu FROM hakedis_mahsubu WHERE dosya_ref = $1`, [d.kimlik])).rows;
    expect(m).toHaveLength(1); expect(m[0]).toMatchObject({ kurulus_ref: f, statu: 'Onayda' }); expect(Number(m[0].tutar_eur)).toBe(400);
    expect((await o.kart('Hakediş Mahsubu', m[0].kimlik)).durum).toBe('Bekliyor');
    await o.ist('POST', `/api/garanti-sikayet/${gs}/karar`, await o.gir('ty'), { karar: 'Garanti', gerekce: 'Tekrar' });
    expect((await o.sup.query(`SELECT count(*) n FROM hakedis_mahsubu WHERE dosya_ref = $1`, [d.kimlik])).rows[0].n).toBe('1');
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
