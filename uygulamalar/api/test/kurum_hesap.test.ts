import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', tid: 'Ticari İşler Direktörü', ds: 'Dosya Sorumlusu', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü', mfm: 'Muhasebe ve Finans Müdürü', mfy: 'Muhasebe ve Finans Müdür Yardımcısı', fmy: 'Firma Yönetimi Müdür Yardımcısı', hd: 'Hukuk ve Uyum Direktörü', tu: 'Teknik Uzman', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', ty: 'Teknik Yönetici', tm: 'Teknik Müdür' };
const P = 'Sinama-Parolasi-2026!'; const H = { 'x-yatonet': '1' };
let o: Ortam; let fir: string; let ted: string; let firC: string; let firK: string; let ikiC: string; let ikiK: string; let tedC: string;
const disGir = async (ad: string, grup: string, rol: string, kurulus: string) => {
  const oz = await parolaOzetle(P); const ep = `${ad}@deneme.yatonet.local`;
  const k = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani) VALUES ('Dış Kullanıcı',$1,$2,$3,$3,$4,'Doğrulama uygulaması (6 haneli kod)',now()) RETURNING kimlik`, [grup, ad, ep, oz])).rows[0].kimlik as string;
  await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [k, rol]);
  await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Çalışan',$2,'R00','Türkçe','Web')`, [k, grup === 'İş Birliği Firması' ? 'KVKK-03' : 'KVKK-04']);
  await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [k]);
  await o.sup.query(`INSERT INTO kurulus_kullanici VALUES ($1,$2)`, [kurulus, k]);
  const ck = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
  const c = ck(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: ep, parola: P } }));
  const g = (await o.ist('GET', '/api/kimlik/kurulum', c)).json().gizli as string;
  return { c: ck(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(g, suankiAdim()) })), k };
};
const kuruluş = async (u: string, r: string) => (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: u, rol: r })).json().kimlik as string;

beforeAll(async () => {
  o = await ortamKur('yatonet360_test27', KADRO);
  fir = await kuruluş('Kurum Firma', 'Çözüm Ortağı'); ted = await kuruluş('Kurum Tedarik', 'Tedarikçi');
  const a = await disGir('kf1', 'İş Birliği Firması', 'Firma Yetkilisi', fir); firC = a.c; firK = a.k;
  const b = await disGir('kf2', 'İş Birliği Firması', 'Firma Yetkilisi', fir); ikiC = b.c; ikiK = b.k;
  tedC = (await disGir('kt1', 'Tedarikçi', 'Tedarikçi Kullanıcısı', ted)).c;
}, 120_000);
afterAll(async () => { await o.kapat(); });

describe('kurum kullanıcıları (YG-1004, YG-425)', () => {
  it('kurum yalnız kendi bilgi ve kullanıcılarını görür; LGM personeline açık değildir', async () => {
    const r = (await o.ist('GET', '/api/kurum/hesap', firC)).json();
    expect(r.kurum.ticari_unvan).toBe('Kurum Firma'); expect(r.kullanicilar.map((x: { e_posta: string }) => x.e_posta).sort()).toEqual(['kf1@deneme.yatonet.local', 'kf2@deneme.yatonet.local']);
    expect(JSON.stringify((await o.ist('GET', '/api/kurum/hesap', tedC)).json())).not.toContain('kf1@');
    expect((await o.ist('GET', '/api/kurum/hesap', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('talep LGM teyidine gider, hesap teyitten önce açılmaz; onayda davet e-postayla gider ve kuruma bağlanır', async () => {
    const ep = 'yeni@firma.local';
    expect((await o.ist('POST', '/api/kurum/kullanici', firC, { ad: 'Y', eposta: 'gecersiz' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/kurum/kullanici', firC, { ad: 'Yeni Kişi', eposta: 'kf1@deneme.yatonet.local' })).statusCode).toBe(409);
    const r = await o.ist('POST', '/api/kurum/kullanici', firC, { ad: 'Yeni Kişi', eposta: ep }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', '/api/kurum/kullanici', firC, { ad: 'Yeni Kişi', eposta: ep.toUpperCase() })).statusCode).toBe(409);
    expect((await o.sup.query(`SELECT 1 FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rowCount).toBe(0);
    const k = await o.kart('Kurum Kullanıcı Teyidi', r.json().talep);
    expect((await o.karar(k.kimlik, 'sc', 'Onayla')).statusCode).toBe(200);
    const h = (await o.sup.query(`SELECT h.kimlik, h.kullanici_grubu FROM kullanici_hesabi h JOIN kurulus_kullanici x ON x.kullanici_ref = h.kimlik WHERE h.e_posta = $1 AND x.kurulus_ref = $2`, [ep, fir])).rows[0];
    expect(h.kullanici_grubu).toBe('İş Birliği Firması');
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1`, [`kurum-davet:${r.json().talep}`])).rows[0].metin as string;
    expect(m).toContain('Kurum Firma'); expect(m).toMatch(/\/#davet=/);
    expect((await o.sup.query(`SELECT r.rol_adi FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1`, [h.kimlik])).rows[0].rol_adi).toBe('Firma Yetkilisi');
  });
  it('red hesap açmaz; talep sahibine bildirim gider', async () => {
    const r = await o.ist('POST', '/api/kurum/kullanici', firC, { ad: 'Red Kişi', eposta: 'red@firma.local' });
    const k = await o.kart('Kurum Kullanıcı Teyidi', r.json().talep); await o.karar(k.kimlik, 'sc', 'Reddet', 'Kimlik teyit edilemedi');
    expect((await o.sup.query(`SELECT durum FROM kurum_kullanici_talebi WHERE kimlik = $1`, [r.json().talep])).rows[0].durum).toBe('Reddedildi');
    expect((await o.sup.query(`SELECT 1 FROM kullanici_hesabi WHERE e_posta = 'red@firma.local'`)).rowCount).toBe(0);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [firK, `kurum-kullanici:${r.json().talep}`])).rowCount).toBe(1);
  });
  it('kapatma oturumu hemen bitirir, Sicile 24 saatlik görev açar; kendi hesabı ve başka kurum kapatılamaz', async () => {
    expect((await o.ist('POST', `/api/kurum/kullanici/${firK}/kapat`, firC, { gerekce: 'G' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/kurum/kullanici/${ikiK}/kapat`, tedC, { gerekce: 'G' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/kurum/kullanici/${ikiK}/kapat`, firC, {})).statusCode).toBe(400);
    expect((await o.ist('GET', '/api/kurum/hesap', ikiC)).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/kurum/kullanici/${ikiK}/kapat`, firC, { gerekce: 'Ayrıldı' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/kurum/hesap', ikiC)).statusCode).toBe(401);
    expect((await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: 'kf2@deneme.yatonet.local', parola: P } })).statusCode).not.toBe(200);
    expect(await o.kart('Çalışan Ayrıldı Bildirimi', ikiK)).toBeDefined();
    expect((await o.ist('POST', `/api/kurum/kullanici/${ikiK}/kapat`, firC, { gerekce: 'Tekrar' })).statusCode).toBe(409);
  });
});

describe('firma bilgi, banka, itiraz, cari (YG-425, YG-422, K-178)', () => {
  const IB = 'TR33 0006 1005 1978 6457 8413 26';
  it('bilgi değişikliği Sicil teyidiyle işlenir, reddedilince işlenmez; önceki değer saklanır', async () => {
    expect((await o.ist('POST', '/api/kurum/bilgi-degisikligi', firC, { alan: 'vergi_no', yeni: '1' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/kurum/bilgi-degisikligi', firC, { alan: 'kurumsal_eposta', yeni: 'gecersiz' })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/kurum/bilgi-degisikligi', firC, { alan: 'il', yeni: 'Muğla' }); expect(r.statusCode, r.body).toBe(200);
    const il = async () => (await o.sup.query(`SELECT il FROM kurulus WHERE kimlik = $1`, [fir])).rows[0].il;
    expect(await il()).not.toBe('Muğla');
    await o.karar((await o.kart('Kurum Bilgi Değişikliği', r.json().talep)).kimlik, 'sc', 'Onayla'); expect(await il()).toBe('Muğla');
    const r2 = await o.ist('POST', '/api/kurum/bilgi-degisikligi', firC, { alan: 'il', yeni: 'İzmir' });
    await o.karar((await o.kart('Kurum Bilgi Değişikliği', r2.json().talep)).kimlik, 'sc', 'Reddet', 'Belge yok'); expect(await il()).toBe('Muğla');
    expect((await o.sup.query(`SELECT eski_deger FROM kurum_bilgi_talebi WHERE kimlik = $1`, [r2.json().talep])).rows[0].eski_deger).toBe('Muğla');
  });
  it('IBAN karantinada başlar, firmaya maskeli görünür, teyit olmadan geçerli olmaz', async () => {
    expect((await o.ist('POST', '/api/kurum/banka', firC, { iban: 'TR00' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/kurum/banka', firC, { iban: IB })).json().durum).toBe('Karantina');
    expect((await o.ist('POST', '/api/kurum/banka', firC, { iban: IB })).statusCode).toBe(409);
    const v = (await o.ist('GET', '/api/kurum/hesap', firC)).json(); expect(v.bankalar[0].durum).toBe('Karantina'); expect(v.bankalar[0].iban).toBe('TR33 •••• 1326');
    expect((await o.ist('GET', '/api/banka-hesabi/bekleyen', await o.gir('mfm'))).statusCode).toBe(403);
    const be = (await o.ist('GET', '/api/banka-hesabi/bekleyen', await o.gir('mfy'))).json(); const h = be.find((x: { ticari_unvan: string }) => x.ticari_unvan === 'Kurum Firma');
    const kart = await o.kart('Banka Hesabı Onayı', h.kimlik);
    const durum = async () => (await o.sup.query(`SELECT durum FROM banka_hesabi WHERE kimlik = $1`, [h.kimlik])).rows[0].durum;
    expect((await o.karar(kart.kimlik, 'fym', 'Onayla')).statusCode).not.toBe(200);
    expect((await o.karar(kart.kimlik, 'fmy', 'Onaya Gönder')).statusCode).toBe(200);
    expect((await o.karar(kart.kimlik, 'fym', 'Onaya Gönder')).statusCode).toBe(200);
    const once = await o.karar(kart.kimlik, 'mfm', 'Onayla'); expect(once.statusCode).toBe(409); expect(once.json().hata).toContain('geri arama');
    expect(await durum()).toBe('Karantina');
    expect((await o.ist('POST', `/api/banka-hesabi/${h.kimlik}/teyit`, await o.gir('mfy'), { kanal: 'e-posta' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/banka-hesabi/${h.kimlik}/teyit`, await o.gir('mfm'), { kanal: 'Geri arama' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/banka-hesabi/${h.kimlik}/teyit`, await o.gir('mfy'), { kanal: 'Sicildeki numaradan geri arama' })).json().durum).toBe('Karantina');
    expect(await durum()).toBe('Karantina');
    expect((await o.kart('Banka Geri Arama Teyidi', h.kimlik)).durum).toBe('Tamamlandı');
    expect((await o.karar(kart.kimlik, 'mfm', 'Onayla')).statusCode).toBe(200); expect(await durum()).toBe('Geçerli');
    expect((await o.sup.query(`SELECT onaylayan_ref, teyit_eden_ref FROM banka_hesabi WHERE kimlik = $1`, [h.kimlik])).rows[0]).toMatchObject({ onaylayan_ref: o.K.mfm, teyit_eden_ref: o.K.mfy });
    // Yeni hesap önceki hesabı silmez, onayda yerine geçer; red yeni hesabı iptal eder.
    const ik = 'TR200006100519786457849999'; expect((await o.ist('POST', '/api/kurum/banka', firC, { iban: ik })).statusCode).toBe(200);
    const yeni = (await o.sup.query(`SELECT kimlik FROM banka_hesabi WHERE iban = $1 AND kurulus_ref = $2`, [ik, fir])).rows[0].kimlik; const ky = await o.kart('Banka Hesabı Onayı', yeni);
    await o.karar(ky.kimlik, 'fmy', 'Gerekçeyle İade Et', 'Belge yok');
    expect((await o.sup.query(`SELECT durum FROM banka_hesabi WHERE kurulus_ref = $1 ORDER BY olusturma_zamani`, [fir])).rows.map((x) => x.durum)).toEqual(['Geçerli', 'İptal']);
  });
  it('itiraz yalnız ret/koşullu kararda, 15 gün içinde, bir kez; Direktör kabul edince yeniden incelemeye döner', async () => {
    const f2 = await kuruluş('İtiraz Firma', 'Çözüm Ortağı'); const c = (await disGir('if1', 'İş Birliği Firması', 'Firma Yetkilisi', f2)).c;
    expect((await o.ist('POST', '/api/kurum/kabul-itiraz', c, { gerekce: 'G' })).statusCode).toBe(409);
    const st = () => o.gir('fym').then((c2) => o.ist('POST', `/api/firma/${f2}/statu`, c2, { asama: 'Reddedildi', gerekce: 'Eksik' }));
    const y1 = await st(); expect(y1.statusCode).toBe(409); expect(y1.json().hata).toContain('Hukuk ve Uyum');
    expect((await o.ist('POST', `/api/firma/${f2}/hukuk-gorusu`, await o.gir('fym'), { oneri: 'Onaylı' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/firma/${f2}/hukuk-gorusu`, await o.gir('fym'), { oneri: 'Reddedildi' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/firma/${f2}/hukuk-gorusu`, await o.gir('fym'), { oneri: 'Reddedildi' })).statusCode).toBe(409);
    expect((await st()).statusCode).toBe(409);
    const hg = (await o.sup.query(`SELECT kimlik FROM firma_hukuk_gorusu WHERE kurulus_ref = $1`, [f2])).rows[0].kimlik;
    await o.karar((await o.kart('Firma Hukuk Görüşü', hg)).kimlik, 'hd', 'Reddet', 'Sözleşme uygun değil');
    expect((await o.sup.query(`SELECT gorus FROM firma_hukuk_gorusu WHERE kimlik = $1`, [hg])).rows[0].gorus).toBe('Uygun Görülmedi');
    expect((await st()).statusCode).toBe(200); // görüş bağlayıcı değildir
    expect((await st()).statusCode).toBe(409); // her karar için yeni görüş
    expect((await o.ist('POST', '/api/kurum/kabul-itiraz', c, {})).statusCode).toBe(400);
    expect((await o.ist('GET', '/api/kurum/hesap', c)).json().itirazEdilebilir).toBe(true);
    await o.sup.query(`UPDATE kurulus SET kabul_karar_zamani = now() - interval '16 days' WHERE kimlik = $1`, [f2]);
    expect((await o.ist('POST', '/api/kurum/kabul-itiraz', c, { gerekce: 'G' })).json().hata).toContain('15.');
    await o.sup.query(`UPDATE kurulus SET kabul_karar_zamani = now() - interval '14 days' WHERE kimlik = $1`, [f2]);
    expect((await o.ist('POST', '/api/kurum/kabul-itiraz', c, { gerekce: 'Belgeler tamam' })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/kurum/kabul-itiraz', c, { gerekce: 'Yine' })).statusCode).toBe(409);
    const id = (await o.sup.query(`SELECT kimlik FROM kurum_kabul_itirazi WHERE kurulus_ref = $1`, [f2])).rows[0].kimlik;
    expect(await o.kart('Firma Kabul İtirazı', id)).toBeDefined();
    const r = (await o.sup.query(`SELECT r.rol_adi FROM is_karti k JOIN rol r ON r.kimlik = k.zincir[1] WHERE k.tur = 'Firma Kabul İtirazı' AND k.nesne_kimligi = $1`, [id])).rows[0]; expect(r.rol_adi).toBe('Bilgi Teknolojileri ve Firma Yönetimi Direktörü');
    expect((await o.sup.query(`SELECT kayit_asamasi FROM kurulus WHERE kimlik = $1`, [f2])).rows[0].kayit_asamasi).toBe('Reddedildi');
    await o.karar((await o.kart('Firma Kabul İtirazı', id)).kimlik, 'btd', 'Onayla');
    expect((await o.sup.query(`SELECT kayit_asamasi FROM kurulus WHERE kimlik = $1`, [f2])).rows[0].kayit_asamasi).toBe('İncelemede');
  });
  it('cari ekstre firmaya kendi hakedişini verir, müşteri adı ve maliyet dışı bilgi yazmaz; başka kuruma kapalı', async () => {
    const d = await o.dosyaAc();
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K',1000,$4) RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, fir, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO hakedis (hakedis_no, is_emri_ref, dosya_ref, sira_no, bu_donem_brut, kumulatif, kesinti, net, statu, giren_ref) VALUES ($1,$2,$3,1,1000,1000,50,950,'Doğrulandı',$4)`, [`${d.dosyaNo}-HK01`, e, d.kimlik, firK]);
    const r = await o.ist('GET', '/api/firma-portal/cari', firC); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().satirlar[0]).toMatchObject({ hakedis_no: `${d.dosyaNo}-HK01`, statu: 'Doğrulandı' }); expect(r.json().acikNet).toBe(950);
    expect(r.body).not.toContain('Sahip');
    expect((await o.ist('GET', '/api/firma-portal/cari', tedC)).json().satirlar).toHaveLength(0);
    expect((await o.ist('GET', '/api/firma-portal/cari', await o.gir('ds'))).statusCode).toBe(404);
  });
});

describe('parça tedarik süresi (YG-202)', () => {
  it('kabul edilen teslimlerden ortalama gün; yetkisiz ve kısa aramaya kapalı', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
    const s = (await o.sup.query(`INSERT INTO tedarik_siparisi (siparis_no, dosya_ref, kurulus_ref, tedarikci_teklif_ref, nihai_kullanim_yeri, kdv_haric_eur, kdv_eur, toplam_eur, teslim_tarihi, teslim_yeri, kabul_olcutu, secim_gerekcesi, statu, hazirlayan_ref, olusturma_zamani) VALUES ($1,$2,$3,'T','Y',100,20,120,'2026-12-01','M','K','G','Verildi',$4, now() - interval '10 days') RETURNING kimlik`, [`SP-S${Date.now()}`, d.kimlik, ted, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO tedarik_siparisi_kalemi (siparis_ref, satir_no, urun_tanimi, uretici_parca_no, miktar, birim, birim_bedel_eur, toplam_eur) VALUES ($1,1,'Şaft Kovanı','PN-777',1,'adet',100,100)`, [s]);
    await o.sup.query(`INSERT INTO malzeme_giris_kabulu (kayit_no, siparis_ref, satir_no, miktar, lot_no, irsaliye_no, bekletme_yeri_ref, bekletme_baslangic, kontrol_eden_ref, hazirlayan_ref, kabul_karari) VALUES ($1,$2,1,1,'L','I',$3, now() - interval '4 days',$4,$4,'Kabul')`, [`MG-${Date.now()}`, s, ted, o.K.ds]);
    const u = `/api/dosya/${d.kimlik}/tedarik-suresi`;
    expect((await o.ist('GET', `${u}?parca=P`, await o.gir('ds'))).statusCode).toBe(400);
    const r = await o.ist('GET', `${u}?parca=PN-777`, await o.gir('ds')); expect(r.statusCode, r.body).toBe(200);
    expect(r.json()[0]).toMatchObject({ parcaNo: 'PN-777', adet: 1, gun: 6 });
    expect((await o.ist('GET', `${u}?parca=YOK-1`, await o.gir('ds'))).json()).toHaveLength(0);
    expect((await o.ist('GET', `${u}?parca=PN-777`, firC)).statusCode).toBe(404);
  });
});

describe('tedarikçi ödeme durumu (YG-298, YG-845)', () => {
  const fatura = async (no: string, sonuc: string | null) => {
    const be = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'Fatura','Gizli','Kuruluş',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`F ${no}`, ted, o.K.ds])).rows[0].kimlik;
    const d = await o.dosyaAc();
    const s = (await o.sup.query(`INSERT INTO tedarik_siparisi (siparis_no, dosya_ref, kurulus_ref, tedarikci_teklif_ref, nihai_kullanim_yeri, kdv_haric_eur, kdv_eur, toplam_eur, teslim_tarihi, teslim_yeri, kabul_olcutu, secim_gerekcesi, statu, hazirlayan_ref) VALUES ($1,$2,$3,'T1','Y',100,20,120,'2026-12-01','Marmaris','K','G','Verildi',$4) RETURNING kimlik`, [`SP-${no}`, d.kimlik, ted, o.K.ds])).rows[0].kimlik;
    const f = (await o.sup.query(`INSERT INTO tedarikci_faturasi (siparis_ref, kurulus_ref, fatura_no, tarih, tutar_eur, belge_ref, giren_ref) VALUES ($1,$2,$3,'2026-11-01',100,$4,$5) RETURNING kimlik`, [s, ted, no, be, o.K.ds])).rows[0].kimlik as string;
    if (sonuc) await o.sup.query(`INSERT INTO uclu_eslestirme (siparis_ref, kurulus_ref, fatura_no, fatura_tarihi, fatura_tutari, miktar_farki, fiyat_farki, sonuc, kontrol_eden_ref) VALUES ($1,$2,$3,'2026-11-01',100,0,0,$4,$5)`, [s, ted, no, sonuc, o.K.ds]);
    return f;
  };
  const durum = async (no: string) => (await o.ist('GET', '/api/tedarikci-portal/ana', tedC)).json().faturalar.find((x: { fatura_no: string }) => x.fatura_no === no);
  it('durum eşleşmeye göre gösterilir, vade 60 gündür; ödeme yalnız muhasebede ve eşleşmeden, teyitli hesap varken', async () => {
    const a = await fatura('F1', null); const c = await fatura('F2', 'Fiyat Farkı'); const e = await fatura('F3', 'Eşleşti');
    expect((await durum('F1')).odeme_durumu).toBe('Kontrol Bekleniyor'); expect((await durum('F2')).odeme_durumu).toBe('Fark İnceleniyor');
    expect(await durum('F3')).toMatchObject({ odeme_durumu: 'Ödeme Planlandı', vade: '2026-12-31' });
    const m = await o.gir('mfm'); const u = (x: string) => `/api/tedarikci-odemeleri/${x}/odendi`;
    expect((await o.ist('GET', '/api/tedarikci-odemeleri', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', u(e), tedC, {})).statusCode).toBe(404);
    expect((await o.ist('POST', u(a), m, {})).statusCode).toBe(409); expect((await o.ist('POST', u(c), m, {})).statusCode).toBe(409);
    const h = await o.ist('POST', u(e), m, {}); expect(h.statusCode).toBe(409); expect(h.json().hata).toContain('banka hesabı');
    await o.sup.query(`INSERT INTO banka_hesabi (kurulus_ref, iban, durum, giren_ref) VALUES ($1,'TR330006100519786457841326','Geçerli',$2)`, [ted, o.K.ds]);
    expect((await o.ist('GET', '/api/tedarikci-odemeleri', m)).json().map((x: { fatura_no: string }) => x.fatura_no)).toContain('F3');
    expect((await o.ist('POST', u(e), m, {})).json().hata).toContain('Ödeme Listesi'); // YG-830
    const ts = await o.gir('ts'); const l = await o.ist('POST', '/api/odeme-listesi', ts, { faturalar: [e] }); expect(l.statusCode, l.body).toBe(200);
    const k = await o.kart('Ödeme Listesi', l.json().kimlik); await o.karar(k.kimlik, 'mfy', 'Onaya Gönder'); await o.karar(k.kimlik, 'tid', 'Onayla');
    expect((await o.ist('POST', u(e), ts, {})).json().hata).toContain('hazırlayan');
    expect((await o.ist('POST', u(e), m, {})).statusCode).toBe(200);
    expect((await durum('F3')).odeme_durumu).toBe('Ödendi');
    expect((await o.ist('POST', u(e), m, {})).statusCode).toBe(409);
  });
});
