import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { performansOlayIsle } from '../src/karne.js';
import { sahaSureIsle } from '../src/saha_kayit.js';
import { parolaOzetle } from '../src/parola.js';
import { ana, ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü', kk: 'Kalite Uzmanı (Kalite Kontrolör)', ik: 'İnsan Kaynakları Sorumlusu' };
let o: Ortam; let f: string; let fC: string; let fK: string; let f2C: string;
const disGir = async (ad: string, kurulus: string) => {
  const oz = await parolaOzetle('Sinama-Parolasi-2026!'); const ep = `${ad}@deneme.yatonet.local`;
  const k = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani, portal_rehberi_beyani) VALUES ('Dış Kullanıcı','İş Birliği Firması',$1,$2,$2,$3,'Doğrulama uygulaması (6 haneli kod)',now(),now()) RETURNING kimlik`, [ad, ep, oz])).rows[0].kimlik as string;
  await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = 'Firma Yetkilisi'`, [k]);
  await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Çalışan','KVKK-03','R00','Türkçe','Web')`, [k]);
  await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [k]);
  await o.sup.query(`INSERT INTO kurulus_kullanici VALUES ($1,$2)`, [kurulus, k]);
  const ck = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
  const c = ck(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: ep, parola: 'Sinama-Parolasi-2026!' } }));
  const g = (await o.ist('GET', '/api/kimlik/kurulum', c)).json().gizli as string;
  return { c: ck(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(g, suankiAdim()) })), k };
};
const isEmri = async (statu = 'Aktif', ek: Record<string, unknown> = {}) => {
  await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE bitis_zamani IS NULL`); // kapasite sınırı sınanmıyor
  const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
  await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Kalite Kontrolör',$3)`, [d.kimlik, o.K.kk, o.K.ds]);
  const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, baslangic_tarihi, hedef_bitis_tarihi, statu, hazirlayan_ref, teknik_kabul_sonucu, yayim_zamani, firma_kabul_zamani) VALUES ($1,'ON',$2,$3,'M','K',1000,now() - interval '10 days',now() - interval '2 days',$4,$5,$6,now() - interval '11 days',now() - interval '11 days') RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, f, statu, o.K.ds, ek.kabul ?? null])).rows[0].kimlik as string;
  return { d, e };
};
let sayac = 0;
const belge = async (e: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'Fotoğraf','Gizli','İş Emri',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`B${++sayac}`, e, o.K.ds])).rows[0].kimlik as string;

beforeAll(async () => {
  o = await ortamKur('yatonet360_test32', KADRO);
  f = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: 'Saha Firma', rol: 'Çözüm Ortağı' })).json().kimlik;
  const f2 = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: 'Başka Firma', rol: 'Çözüm Ortağı' })).json().kimlik;
  const a = await disGir('sf1', f); fC = a.c; fK = a.k; f2C = (await disGir('sf2', f2)).c;
}, 120_000);
afterAll(async () => { await o.kapat(); });

describe('günlük kayıt (YG-1574, YG-381)', () => {
  it('zorunlu alan olmadan gün kapanmaz; taslak kaydedilir; kapanınca değişmez; başka firmaya kapalı; görsel ikinci kez kullanılmaz', async () => {
    const { e } = await isEmri(); const u = `/api/firma-portal/is-emri/${e}/gunluk`; const b1 = await belge(e);
    expect((await o.ist('POST', u, f2C, { faaliyet: 'F' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, fC, { faaliyet: 'Söküm', kapat: true })).statusCode).toBe(400);
    expect((await o.ist('POST', u, fC, { faaliyet: 'Söküm' })).json().durum).toBe('Açık');
    expect((await o.ist('GET', '/api/firma-portal/gunluk', fC)).json().acik.some((x: { is_emri: string }) => x.is_emri === e)).toBe(true);
    const tam = { faaliyet: 'Söküm', fotograflar: [b1], sonrakiPlan: 'Montaj', sorumlu: 'Usta', engel: 'Parça gecikti' };
    expect((await o.ist('POST', u, fC, { ...tam, kapat: true })).json().durum).toBe('Kapatıldı');
    expect((await o.ist('POST', u, fC, tam)).statusCode).toBe(409);
    expect((await o.ist('GET', '/api/firma-portal/gunluk', fC)).json().acik.some((x: { is_emri: string }) => x.is_emri === e)).toBe(false);
    const ik = await isEmri();
    const u2 = `/api/firma-portal/is-emri/${ik.e}/gunluk`;
    expect((await o.ist('POST', u2, fC, { faaliyet: 'F', fotograflar: [b1] })).statusCode).toBe(400); // başka iş emrinin belgesi
    await o.sup.query(`UPDATE firma_gunluk_kaydi SET tarih = current_date - 1 WHERE is_emri_ref = $1`, [e]);
    expect((await o.ist('POST', u, fC, { faaliyet: 'F', fotograflar: [b1] })).statusCode).toBe(409); // aynı görsel ikinci gün
    const y = await isEmri('Kapalı');
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${y.e}/gunluk`, fC, { faaliyet: 'F' })).statusCode).toBe(409);
  });
});

describe('parça girişi ve teslim talebi (YG-1430, YG-417)', () => {
  it('lot ve belge zorunlu; kabulü firma veremez, LGM yetkili rolü verir; bir kez', async () => {
    const { e } = await isEmri(); const u = `/api/firma-portal/is-emri/${e}/parca`; const be = await belge(e); const g = { urun: 'Kovan', parcaNo: 'PN', miktar: 1, birim: 'adet', lot: 'L1', belge: be };
    expect((await o.ist('POST', u, fC, { ...g, lot: '' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, fC, { ...g, belge: undefined })).statusCode).toBe(400);
    const r = await o.ist('POST', u, fC, g); expect(r.statusCode, r.body).toBe(200);
    const k = `/api/parca-girisi/${r.json().kimlik}/karar`;
    expect((await o.ist('POST', k, fC, { karar: 'Kabul' })).statusCode).toBe(404);
    expect((await o.ist('POST', k, await o.gir('ds'), { karar: 'Kabul' })).statusCode).toBe(403);
    expect((await o.ist('POST', k, await o.gir('kk'), { karar: 'Yok' })).statusCode).toBe(400);
    expect((await o.ist('POST', k, await o.gir('kk'), { karar: 'Karantina' })).statusCode).toBe(200);
    expect((await o.ist('POST', k, await o.gir('kk'), { karar: 'Kabul' })).statusCode).toBe(409);
    expect((await o.ist('GET', u, fC)).json()[0].kabul_karari).toBe('Karantina');
    expect((await o.kart('Parça Girişi Kontrolü', r.json().kimlik)).durum).toBe('Tamamlandı');
  });
  it('teslim talebi Dosya Sorumlusuna gider, ikinci kez açılmaz; firma engel nedenini görmez', async () => {
    const { d, e } = await isEmri(); const u = `/api/firma-portal/is-emri/${e}/teslim-talebi`;
    expect((await o.ist('POST', u, fC, {})).statusCode).toBe(200); expect((await o.ist('POST', u, fC, {})).statusCode).toBe(409);
    expect(await o.kart('Teslim Talebi', d.kimlik)).toBeDefined();
    expect((await o.ist('GET', `/api/firma-portal/is-emri/${e}/teslim-durumu`, fC)).json()).toEqual({ teslimOnayi: false });
  });
});

describe('düzeltme, yeniden başlatma, toplantı, eskalasyon (YG-380, YG-262, YG-580, YG-417, YG-350)', () => {
  it('sapma kanıtla ve girenden başkası tarafından kapanır; kayıt silinmez; özet firma bazında', async () => {
    const { e } = await isEmri(); const r = await o.ist('POST', `/api/is-emri/${e}/sapma`, await o.gir('tu'), { tur: 'Kalite', aciklama: 'A', karar: 'Düzeltme', hedef: '2026-12-01' }); const u = `/api/sapma/${r.json().kimlik}/kapat`;
    const b1 = await belge(e);
    expect((await o.ist('POST', u, await o.gir('tu'), { belge: b1 })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('ds'), {})).statusCode).toBe(400);
    expect((await o.ist('POST', u, await o.gir('ds'), { belge: b1 })).statusCode).toBe(200);
    expect((await o.ist('POST', u, await o.gir('ds'), { belge: b1 })).statusCode).toBe(409);
    expect((await o.kart('Sapma Kaydı', r.json().kimlik)).durum).toBe('Tamamlandı');
    const oz = (await o.ist('GET', `/api/firma/${f}/sapma-ozeti`, await o.gir('fym'))).json(); expect(oz.find((x: { tur: string }) => x.tur === 'Kalite')).toMatchObject({ adet: 1, acik: 0 });
    expect((await o.ist('GET', `/api/firma/${f}/sapma-ozeti`, await o.gir('ds'))).statusCode).toBe(404);
  });
  it('durdurulan işi yalnız Teknik Müdür başlatır; işi durduran açık uygunsuzluk varken başlamaz; firma durdurması ekibe bildirilir', async () => {
    const { d, e } = await isEmri(); const u = `/api/is-emri/${e}/yeniden-baslat`;
    expect((await o.ist('POST', u, await o.gir('tm'), { gerekce: 'G' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e}/durdur`, fC, { neden: 'Kapsam dışı' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari LIKE $2`, [o.K.tu, `is-emri-durdu:${e}%`])).rowCount).toBe(1);
    expect((await o.ist('POST', u, await o.gir('tu'), { gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('tm'), {})).statusCode).toBe(400);
    const be = await belge(e); const n = (await o.sup.query(`INSERT INTO uygunsuzluk (uygunsuzluk_no, dosya_ref, is_emri_ref, tespit_kaynagi, yer_nitelik, dayanak_olcut, gercek_durum, kanit_belge_ref, sinif, is_durduruldu, acan_ref) VALUES ($1,$2,$3,'K','Y','D','G',$4,'Majör',true,$5) RETURNING kimlik`, [`NCR-R${Date.now()}`, d.kimlik, e, be, o.K.ds])).rows[0].kimlik;
    expect((await o.ist('POST', u, await o.gir('tm'), { gerekce: 'G' })).json().hata).toContain('uygunsuzluk');
    await o.sup.query(`UPDATE uygunsuzluk SET statu = 'Kapalı' WHERE kimlik = $1`, [n]);
    expect((await o.ist('POST', u, await o.gir('tm'), { gerekce: 'Ölçüm temiz' })).json().statu).toBe('Aktif');
  });
  it('güvenlik sapmasında İşi Durdur emniyet alıcılarına gider', async () => {
    const { e } = await isEmri();
    expect((await o.ist('POST', `/api/is-emri/${e}/sapma`, await o.gir('tu'), { tur: 'Güvenlik', aciklama: 'Gaz', karar: 'İşi Durdur' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari LIKE $2`, [o.K.tm, `is-emri-durdu:${e}%`])).rowCount).toBe(1);
  });
  it('TPL-07 kaydı olmadan onarım başlamaz; keşif ve acil muaf; yalnız Dosya Sorumlusu kaydeder; firma görür; bir kez', async () => {
    const { e } = await isEmri('Başlangıç Kontrolünde'); const u = `/api/is-emri/${e}/baslangic-toplantisi`;
    const { baslangicToplantiEngeli } = await import('../src/saha_kayit.js');
    expect(await baslangicToplantiEngeli(o.db, e, 'KN')).toBeNull(); expect(await baslangicToplantiEngeli(o.db, e, 'AC')).toBeNull(); expect(await baslangicToplantiEngeli(o.db, e, 'ON')).toContain('toplantısı');
    const g = { tarih: '2026-11-04', katilimcilar: 'Saha Sorumlusu, Firma Yetkilisi', konusulanlar: 'İSG', kisaForm: true };
    expect((await o.ist('POST', u, await o.gir('tu'), g)).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('ds'), { ...g, katilimcilar: '' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, await o.gir('ds'), g)).statusCode).toBe(200);
    expect((await o.ist('POST', u, await o.gir('ds'), g)).statusCode).toBe(409);
    expect(await baslangicToplantiEngeli(o.db, e, 'ON')).toBeNull();
    expect((await o.ist('GET', `/api/firma-portal/is-emri/${e}/baslangic-toplantisi`, fC)).json()).toMatchObject({ kisa_form: true, konusulanlar: 'İSG' });
    expect((await o.ist('GET', `/api/firma-portal/is-emri/${e}/baslangic-toplantisi`, f2C)).statusCode).toBe(404);
  });
  it('teslim talebi 24 saatte Operasyon Müdürüne yükselir, bir kez; yeniden değerlendirme görevi Koşullu 3, onaylı 12 ayda', async () => {
    const { d, e } = await isEmri(); await o.ist('POST', `/api/firma-portal/is-emri/${e}/teslim-talebi`, fC, {});
    await o.sup.query(`UPDATE is_karti SET olusturma_zamani = now() - interval '25 hours' WHERE tur = 'Teslim Talebi' AND nesne_kimligi = $1`, [d.kimlik]);
    await sahaSureIsle(o.db); await sahaSureIsle(o.db);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Teslim Uyuşmazlığı' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
    const k = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: 'Koşullu Firma', rol: 'Çözüm Ortağı' })).json().kimlik;
    await o.sup.query(`UPDATE kurulus SET kayit_asamasi = 'Koşullu Onaylı', ag_statusu = 'Aktif', kabul_karar_zamani = now() - interval '4 months' WHERE kimlik = $1`, [k]);
    const a = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: 'Yeni Firma', rol: 'Çözüm Ortağı' })).json().kimlik;
    await o.sup.query(`UPDATE kurulus SET kayit_asamasi = 'Onaylı', ag_statusu = 'Aktif', kabul_karar_zamani = now() - interval '4 months' WHERE kimlik = $1`, [a]);
    await sahaSureIsle(o.db); await sahaSureIsle(o.db);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Firma Yeniden Değerlendirme' AND nesne_kimligi = $1`, [k])).rowCount).toBe(1);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Firma Yeniden Değerlendirme' AND nesne_kimligi = $1`, [a])).rowCount).toBe(0);
    await o.ist('POST', `/api/firma/${k}/statu`, await o.gir('fym'), { risk: 'Standart', gerekce: 'Değerlendirildi' });
    expect((await o.sup.query(`SELECT sonraki_gozden_gecirme_tarihi t FROM kurulus WHERE kimlik = $1`, [k])).rows[0].t).toBeNull();
  });
});

describe('sapma, denetim ve karne (YG-379, YG-786, Ek I §7.5)', () => {
  const olay = async (e: string) => (await o.sup.query(`SELECT * FROM performans_olay_kaydi WHERE is_emri_ref = $1`, [e])).rows[0];
  it('yetki ve zorunlu alan; İşi Durdur iş emrini durdurur, görev açılır', async () => {
    const { e } = await isEmri(); const u = `/api/is-emri/${e}/sapma`; const g = { tur: 'Yöntem', aciklama: 'İzinsiz sıcak iş', karar: 'İşi Durdur' };
    expect((await o.ist('POST', u, await o.gir('ds'), g)).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('tu'), { ...g, tur: 'Yok' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, fC, g)).statusCode).toBe(404);
    const r = await o.ist('POST', u, await o.gir('tu'), g); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [e])).rows[0].statu).toBe('Durduruldu');
    expect(await o.kart('Sapma Kaydı', r.json().kimlik)).toBeDefined();
  });
  it('kapanmış iş emrinde İSG −25, prosedür −15, denetim −15/−5, onaysız ek iş maliyeti 0 yapar; önceki puan geçmişte kalır', async () => {
    const { e } = await isEmri('Kapalı', { kabul: 'Kabul' }); await o.sup.query(`INSERT INTO hakedis (hakedis_no, is_emri_ref, dosya_ref, sira_no, bu_donem_brut, kumulatif, kesinti, net, statu, giren_ref) SELECT $1, kimlik, dosya_ref, 1, 1000, 1000, 0, 1000, 'Doğrulandı', $2 FROM is_emri WHERE kimlik = $3`, [`HK-${e}`, fK, e]);
    await performansOlayIsle(o.db, e);
    const once = await olay(e); expect(once.uyum_puani).toBe('100.00'); expect(once.maliyet_puani).toBe('100.00');
    const c = await o.gir('tu'); const u = `/api/is-emri/${e}/sapma`;
    expect((await o.ist('POST', u, c, { tur: 'Yöntem', aciklama: 'İzin', karar: 'Düzeltme' })).statusCode).toBe(400);
    const H = '2026-12-01';
    await o.ist('POST', u, c, { tur: 'Güvenlik', aciklama: 'KKD yok', karar: 'Düzeltme', isgIhlali: true, hedef: H });
    await o.ist('POST', u, c, { tur: 'Yöntem', aciklama: 'İzin', karar: 'Düzeltme', hedef: H });
    await o.ist('POST', u, c, { tur: 'Kapsam', aciklama: 'Bu firma kaynaklı değil', karar: 'Düzeltme', firmaKaynakli: false, hedef: H });
    const kk = await o.gir('kk'); const d = `/api/is-emri/${e}/denetim-bulgusu`;
    expect((await o.ist('POST', d, await o.gir('tu'), { sinif: 'Majör', aciklama: 'A', belge: await belge(e) })).statusCode).toBe(403);
    expect((await o.ist('POST', d, kk, { sinif: 'Majör', aciklama: 'A' })).statusCode).toBe(400);
    expect((await o.ist('POST', d, kk, { sinif: 'Majör', aciklama: 'A', belge: await belge(e) })).statusCode).toBe(200);
    expect((await o.ist('POST', d, kk, { sinif: 'Minör', aciklama: 'B', belge: await belge(e) })).statusCode).toBe(200);
    expect((await olay(e)).uyum_puani).toBe('40.00'); // 100 − 25 (İSG) − 15 (prosedür) − 15 (Majör) − 5 (Minör); firma kaynaklı olmayan sayılmaz
    await o.ist('POST', u, c, { tur: 'Maliyet', aciklama: 'Onaysız', karar: 'Değişiklik Talebi', onaysizEkIs: true });
    expect((await olay(e)).maliyet_puani).toBe('0.00');
    expect((await o.sup.query(`SELECT count(*)::int n FROM performans_olay_gecmisi WHERE olay_ref = $1`, [once.kimlik])).rows[0].n).toBe(6);
    const v = (await o.ist('GET', `/api/is-emri/${e}/saha-kayitlari`, await o.gir('tu'))).json(); expect(v.sapmalar).toHaveLength(4); expect(v.bulgular).toHaveLength(2);
    expect((await o.ist('GET', `/api/is-emri/${e}/saha-kayitlari`, fC)).statusCode).toBe(404);
  });
  it('teşhisi belirsiz +%5 tolerans; önceden bildirim: gecikmede engel yazılmışsa 100, yoksa 0, gecikme yoksa ölçülmez', async () => {
    const a = await isEmri('Kapalı', { kabul: 'Kabul' }); await o.sup.query(`UPDATE is_emri SET firma_tamamlama_zamani = now() WHERE kimlik = $1`, [a.e]);
    await performansOlayIsle(o.db, a.e);
    const g = (await olay(a.e)).girdi; expect(g.firmaGecikmeGun).toBeGreaterThan(0); expect(g.oncedenBildirim).toBe(0);
    const s0 = Number((await olay(a.e)).sure_puani);
    expect((await o.ist('POST', `/api/is-emri/${a.e}/teshisi-belirsiz`, await o.gir('ds'), { deger: true })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/is-emri/${a.e}/teshisi-belirsiz`, await o.gir('tu'), { deger: true })).statusCode).toBe(200);
    expect(Number((await olay(a.e)).sure_puani)).toBe(Math.min(100, s0 + 10));
    const b = await isEmri('Kapalı', { kabul: 'Kabul' }); await o.sup.query(`UPDATE is_emri SET firma_tamamlama_zamani = now() WHERE kimlik = $1`, [b.e]);
    await o.sup.query(`INSERT INTO firma_gunluk_kaydi (is_emri_ref, kurulus_ref, tarih, faaliyet, engel, durum, giren_ref) VALUES ($1,$2,current_date - 5,'F','Parça gecikti','Kapatıldı',$3)`, [b.e, f, fK]);
    await performansOlayIsle(o.db, b.e); expect((await olay(b.e)).girdi.oncedenBildirim).toBe(100);
  });
});

describe('ek test gerektiren sapma (YG-394)', () => {
  it('test sonucu girilmeden yalnız İşi Durdur kararı verilir; sonuç girilince diğer kararlar açılır', async () => {
    const { e } = await isEmri(); const tu = await o.gir('tu'); const u = `/api/is-emri/${e}/sapma`;
    const dosya = (await o.sup.query(`SELECT dosya_ref FROM is_emri WHERE kimlik = $1`, [e])).rows[0].dosya_ref;
    const t = (await o.sup.query(`INSERT INTO test_kaydi (test_no, dosya_ref, test_grubu, amac_kapsam, yontem, kabul_olcutu, durdurma_kosulu, hazirlayan_ref) VALUES ($1,$2,'Makine ve Tahrik','A','Y','≤ 80 °C','Alarm',$3) RETURNING kimlik`, [`TS-${Date.now()}`, dosya, o.K.tu])).rows[0].kimlik;
    const g = { tur: 'Yöntem', aciklama: 'Laminasyon sıcaklığı sınır dışı', karar: 'Düzeltme', hedef: '2026-12-01', ekTest: t };
    expect((await o.ist('POST', u, tu, { ...g, ekTest: '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, tu, g)).json().hata).toContain('Ek test sonucu');
    expect((await o.ist('POST', u, tu, { ...g, karar: 'İşi Durdur' })).statusCode).toBe(200);
    await o.sup.query(`UPDATE test_kaydi SET sonuc = 'Başarılı', sonuc_gerekcesi = 'G' WHERE kimlik = $1`, [t]);
    const r = await o.ist('POST', u, tu, g); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT ek_test_ref FROM sapma_kaydi WHERE kimlik = $1`, [r.json().kimlik])).rows[0].ek_test_ref).toBe(t);
  });
});

describe('proses kayıtları (YG-1455, YG-408, YG-282, PRS-1)', () => {
  const S = { tur: 'Kompozit Laminasyon ve Kür', zaman: '2026-11-09T10:00', sicaklik: 22, nem: 55, recine: 4.5, sertlestirici: 1.5, katlar: 'CSM 450 + WR 600', vakum: -0.8, vakumSure: 120, sorumlu: 'Firma Teknik Lideri' };
  it('sınırsız seans girilmez; sınır dışı değer kararı bekler ve yeni seansı kilitler; Durdur işi durdurur; Uygun Değil uygunsuzluk ister', async () => {
    const { d, e } = await isEmri(); const tu = await o.gir('tu'); const up = `/api/firma-portal/is-emri/${e}/proses`; const us = `/api/is-emri/${e}/proses-siniri`;
    expect((await o.ist('POST', up, fC, S)).statusCode).toBe(409);
    expect((await o.ist('POST', us, await o.gir('ds'), { tur: S.tur, sicaklikMin: 15, dayanak: 'x' })).statusCode).toBe(403);
    expect((await o.ist('POST', us, tu, { tur: S.tur, sicaklikMin: 15 })).statusCode).toBe(400);
    expect((await o.ist('POST', us, tu, { tur: S.tur, sicaklikMin: 30, sicaklikMax: 20, dayanak: 'Reçine TDS' })).statusCode).toBe(400);
    expect((await o.ist('POST', us, tu, { tur: S.tur, sicaklikMin: 15, sicaklikMax: 30, nemMax: 75, dayanak: 'Reçine TDS' })).statusCode).toBe(200);
    expect((await o.ist('POST', up, fC, { ...S, recine: undefined })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/firma-portal/is-emri/${e}/proses`, f2C, S)).statusCode).toBe(404);
    const a = await o.ist('POST', up, fC, S); expect(a.statusCode, a.body).toBe(200); expect(a.json()).toMatchObject({ seansNo: 1, sinirDisi: [] }); expect(a.json().kayitNo).toBe(`${d.dosyaNo}-FR-ONR-005-01`);
    expect((await o.ist('POST', us, tu, { tur: S.tur, sicaklikMin: 10, dayanak: 'y' })).statusCode).toBe(409);
    const ks = await o.ist('POST', `/api/proses-seansi/${a.json().kimlik}/sonuc`, await o.gir('ds'), { sonuc: 'Uygun' }); expect(ks.statusCode).toBe(403);
    expect((await o.ist('POST', `/api/proses-seansi/${a.json().kimlik}/sonuc`, tu, { sonuc: 'Uygun Değil' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/proses-seansi/${a.json().kimlik}/sonuc`, tu, { sonuc: 'Uygun' })).json().durum).toBe('Onaylı');
    expect((await o.sup.query(`SELECT onaylayan_ref, onay_zamani FROM proses_seansi WHERE kimlik = $1`, [a.json().kimlik])).rows[0].onaylayan_ref).toBe(o.K.tu);
    const b = await o.ist('POST', up, fC, { ...S, sicaklik: 12, nem: 80 }); expect(b.json().sinirDisi).toEqual(['Sıcaklık', 'Nem']);
    const bk = b.json().kimlik as string; expect((await o.kart('Proses Sınır Dışı Değer', bk)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', up, fC, S)).json().hata).toContain('kararı beklenmektedir');
    expect((await o.ist('POST', `/api/proses-seansi/${bk}/sonuc`, tu, { sonuc: 'Uygun' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/proses-seansi/${bk}/karar`, tu, { karar: 'Durdur' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/proses-seansi/${bk}/karar`, tu, { karar: 'Durdur', gerekce: 'Isıtma yetersiz' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [e])).rows[0].statu).toBe('Durduruldu');
    expect((await o.kart('Proses Sınır Dışı Değer', bk)).durum).toBe('Tamamlandı');
    expect((await o.ist('POST', up, fC, S)).statusCode).toBe(409);
    const n = (await o.sup.query(`INSERT INTO uygunsuzluk (uygunsuzluk_no, dosya_ref, is_emri_ref, tespit_kaynagi, yer_nitelik, dayanak_olcut, gercek_durum, kanit_belge_ref, sinif, acan_ref) VALUES ($1,$2,$3,'K','Y','D','G',$4,'Minör',$5) RETURNING kimlik`, [`NCR-P${Date.now()}`, d.kimlik, e, await belge(e), o.K.ds])).rows[0].kimlik;
    const r = await o.ist('POST', `/api/proses-seansi/${bk}/sonuc`, tu, { sonuc: 'Uygun Değil', uygunsuzluk: n }); expect(r.statusCode, r.body).toBe(200); expect(r.json().durum).toBe('Uygun Değil');
    await expect(o.sup.query(`UPDATE proses_seansi SET uygunsuzluk_ref = NULL WHERE kimlik = $1`, [bk])).rejects.toThrow();
  });
  it('Devam kararıyla yeni seans girilebilir; yapıştırmada malzeme zorunlu', async () => {
    const { e } = await isEmri(); const tu = await o.gir('tu'); const up = `/api/firma-portal/is-emri/${e}/proses`;
    await o.ist('POST', `/api/is-emri/${e}/proses-siniri`, tu, { tur: S.tur, sicaklikMin: 15, dayanak: 'TDS' });
    const b = (await o.ist('POST', up, fC, { ...S, sicaklik: 10 })).json().kimlik;
    expect((await o.ist('POST', `/api/proses-seansi/${b}/karar`, tu, { karar: 'Devam', gerekce: 'Isıtıcı devreye alındı' })).statusCode).toBe(200);
    expect((await o.ist('POST', up, fC, S)).statusCode).toBe(200);
    const Y = { tur: 'Yapıştırma, Sızdırmazlık ve Dolgu', zaman: S.zaman, sicaklik: 20, nem: 50, sorumlu: 'Usta' };
    await o.ist('POST', `/api/is-emri/${e}/proses-siniri`, tu, { tur: Y.tur, nemMax: 80, dayanak: 'TDS' });
    expect((await o.ist('POST', up, fC, Y)).statusCode).toBe(400);
    expect((await o.ist('POST', up, fC, { ...Y, malzeme: 'Poliüretan, Parti 123' })).json().kayitNo).toContain('FR-ONR-006');
  });
});

describe('onarım zarfı genişlemesi (YG-407)', () => {
  it('gizli hasar bulgusu olmadan kaydedilmez; Ek İş görevi açılır; EK iş emri bağlanınca kapanır', async () => {
    const { d, e } = await isEmri(); const tu = await o.gir('tu'); const u = `/api/is-emri/${e}/sapma`;
    const bg = (await o.sup.query(`INSERT INTO bulgu (bulgu_no, dosya_ref, konum_referansi, aciklama, bulgu_etiketi, bilgi_turu, hasar_onem_derecesi, yonlendirme, yonlendirme_sorumlu_ref, yonlendirme_hedef_tarihi, olusturan_ref) VALUES ($1,$2,'S1','Söküm sonrası gizli hasar','E','B','Orta','Y',$3,current_date,$3) RETURNING kimlik`, [`${d.dosyaNo}-B01`, d.kimlik, o.K.tu])).rows[0].kimlik;
    const G = { tur: 'Kapsam', aciklama: 'Zarf genişledi', karar: 'Değişiklik Talebi', zarfGenisledi: true };
    expect((await o.ist('POST', u, tu, G)).statusCode).toBe(400);
    expect((await o.ist('POST', u, tu, { ...G, tur: 'Süre', bulgu: bg })).statusCode).toBe(400);
    const r = await o.ist('POST', u, tu, { ...G, bulgu: bg }); expect(r.statusCode, r.body).toBe(200); const s = r.json().kimlik as string;
    expect((await o.kart('Ek İş İş Emri Gerekli', s)).durum).toBe('Bekliyor');
    expect((await o.sup.query(`SELECT bulgu_ref FROM sapma_kaydi WHERE kimlik = $1`, [s])).rows[0].bulgu_ref).toBe(bg);
  });
});

describe('menfaat talebi bildirimi (YG-412)', () => {
  it('firma kendi iş emrinden bildirir; görev Hukuk ve Uyum Direktörüne düşer; başkası listeyi göremez', async () => {
    const { e } = await isEmri(); const u = `/api/firma-portal/is-emri/${e}/menfaat-bildirimi`;
    expect((await o.ist('POST', u, f2C, { kaynak: 'Kaptan', aciklama: 'A' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, fC, { kaynak: 'Diğer', aciklama: 'A' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, fC, { kaynak: 'Kaptan', aciklama: 'Komisyon istendi' })).statusCode).toBe(200);
    const k = (await o.sup.query(`SELECT r.rol_adi FROM is_karti c JOIN menfaat_bildirimi m ON m.kimlik::text = c.nesne_kimligi JOIN rol r ON r.kimlik = c.sahip_rol_ref WHERE m.is_emri_ref = $1`, [e])).rows[0]; expect(k.rol_adi).toBe('Hukuk ve Uyum Direktörü');
    expect((await o.ist('GET', '/api/menfaat-bildirimleri', await o.gir('tu'))).statusCode).toBe(404);
  });
});

describe('kurtarma sonuç tutanağı (YG-644, YG-275)', () => {
  it('27 satır zorunlu; talimat Sapma satırına gelir; Dosya Sorumlusu kontrol eder, onayda belge kuyruğa girer', async () => {
    const { SATIRLAR } = await import('../src/kurtarma_sonuc.js'); expect(SATIRLAR.length).toBe(27);
    const f = (await o.sup.query(`SELECT kurulus_ref r FROM kurulus_kullanici WHERE kullanici_ref = $1`, [fK])).rows[0].r; const d = (await o.dosyaAc({}, {})).kimlik as string; await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d, o.K.ds]);
    const k = (await o.sup.query(`INSERT INTO kurtarma_operasyonu (dosya_ref, hizmet_turu, saglayici_ref, hazirlayan_ref) VALUES ($1,'Dalgıçlık',$2,$3) RETURNING kimlik`, [d, f, o.K.ds])).rows[0].kimlik as string;
    const u = `/api/firma-portal/kurtarma/${k}`; expect((await o.ist('GET', `${u}/sonuc`, f2C)).statusCode).toBe(404);
    const D = Object.fromEntries(SATIRLAR.map((x: string) => [x, 'Yok']));
    expect((await o.ist('POST', `${u}/sonuc`, fC, { degerler: D })).statusCode).toBe(409);
    await o.sup.query(`UPDATE kurtarma_operasyonu SET baslama_zamani = now() WHERE kimlik = $1`, [k]);
    expect((await o.ist('POST', `${u}/sonuc`, fC, { degerler: { ...D, [SATIRLAR[6]!]: '' } })).statusCode).toBe(400);
    expect((await o.ist('POST', `${u}/talimat`, fC, { metin: 'Liman emri' })).statusCode).toBe(200);
    expect((await o.ist('GET', `${u}/sonuc`, fC)).json().degerler[SATIRLAR[12]!]).toContain('Liman emri');
    expect((await o.ist('POST', `${u}/sonuc`, fC, { degerler: D })).statusCode).toBe(200); expect((await o.ist('POST', `${u}/sonuc`, fC, { degerler: D })).statusCode).toBe(409);
    const ds = await o.gir('ds'); const K = `/api/kurtarma/${k}/sonuc-kontrol`;
    expect((await o.ist('POST', K, ds, { karar: 'İade' })).statusCode).toBe(400); expect((await o.ist('POST', K, ds, { karar: 'İade', gerekce: 'Eksik' })).statusCode).toBe(200);
    expect((await o.ist('POST', `${u}/sonuc`, fC, { degerler: D })).statusCode).toBe(200); expect((await o.ist('POST', K, ds, { karar: 'Onayla' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM belge_uretim WHERE tur = 'Kurtarma Sonuç Tutanağı' AND nesne = $1`, [k])).rows[0].n).toBe(1);
    const { kurtarmaSonucTanim } = await import('../src/belge_uret.js'); const v = await kurtarmaSonucTanim(o.db, k); expect(v.t.kod).toBe('FR-OPS-013');
    const b0 = v.t.bolumler[0]!; expect(b0.tur === 'tablo' ? b0.satirlar.length : 0).toBe(27);
  });
});
