import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alacakIsle, avansHesapla, firmaOdemePlani, hakedisKesintisi, ibanGecerli, izinGunu, masrafOdenecek, teslimEngeli, yillikHak } from '../src/ticari.js';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { ana, ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', mfm: 'Muhasebe ve Finans Müdürü', mfy: 'Muhasebe ve Finans Müdür Yardımcısı', fmy: 'Firma Yönetimi Müdür Yardımcısı', tid: 'Ticari İşler Direktörü', gmy: 'Genel Müdür Yardımcısı', fym: 'Firma Yönetimi Müdürü', sc: 'Sicil Sorumlusu', ik: 'İnsan Kaynakları Sorumlusu', my: 'Muhasebe ve Finans Yöneticisi' };
let o: Ortam; let firma: string; let firmaC: string;
const IBAN_OK = 'TR330006100519786457841326';

const teklifVer = async (d: { kimlik: string; dosyaNo: string }, muhatap: string, tutar = 1000, statu = 'Karar', karar = 'Tam Onay') => {
  const kdv = Math.round(tutar * 20) / 100; const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,$3,20,$4,$5,$6,$7,$8,$6,$9) RETURNING kimlik`, [`${d.dosyaNo}-TK${Math.floor(Math.random() * 90 + 10)}`, d.kimlik, muhatap, statu, karar, tutar, kdv, tutar + kdv, o.K.ts])).rows[0];
  await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur, onay_durumu) VALUES ($1,1,'K','Onarım','İşçilik',1,'saat',$2,$2,'Onaylandı')`, [t.kimlik, tutar]);
  return t.kimlik as string;
};
const onayVer = async (tur: string, id: string, ...kim: string[]) => { const k = await o.kart(tur, id); for (let n = 0; n < kim.length; n++) { const r = await o.karar(k.kimlik, kim[n]!, n === kim.length - 1 ? 'Onayla' : 'Onaya Gönder'); expect(r.statusCode, r.body).toBe(200); } };
const dosya = async (m = 'Bireysel Müşteri') => { await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE bitis_zamani IS NULL`); const d = await o.dosyaAc(m === 'Sigorta Şirketi' ? { sigortaci: 'SG', hasarNo: 'H1' } : {}, { musteriTuru: m }); await o.ekipKur(d.kimlik); return d; };

beforeAll(async () => {
  o = await ortamKur('yatonet360_test16', KADRO);
  firma = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: 'Hakediş Firma', rol: 'Çözüm Ortağı' })).json().kimlik;
  await o.ist('POST', `/api/firma/${firma}/statu`, await o.gir('fym'), { asama: 'Onaylı', ag: 'Aktif', gerekce: 'G' });
  const fk = (await o.sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = 'firma@deneme.yatonet.local'`)).rows[0].kimlik;
  await o.ist('POST', `/api/firma/${firma}/kullanici`, await o.gir('fym'), { kullanici: fk });
  const c = ana.ckr(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: 'firma@deneme.yatonet.local', parola: 'Sinama-Parolasi-2026!' } }));
  const q = await o.ist('GET', '/api/kimlik/kurulum', c);
  firmaC = ana.ckr(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
}, 120_000);
afterAll(async () => { await o.kapat(); });

describe('parasal kurallar', () => {
  it('avans (YG-906): sigorta eşiği, bireysel %50, kritik sigorta ve kurumsal yok', () => {
    expect(avansHesapla('Sigorta Şirketi', 20000, false)).toBe(0);
    expect(avansHesapla('Sigorta Şirketi', 20000.01, false)).toBe(10000.01);
    expect(avansHesapla('Bireysel Müşteri', 1000, false)).toBe(500);
    expect(avansHesapla('Bireysel Müşteri', 1000, true)).toBe(500);
    expect(avansHesapla('Kurumsal Müşteri', 1000, false)).toBe(500);
    expect(avansHesapla('Kurumsal Müşteri', 1000, true)).toBe(0);
    expect(avansHesapla('Sigorta Şirketi', 50000, true)).toBe(0);
  });
  it('hakediş kesintisi (YG-838): 10.000 eşik dahil değil', () => {
    expect(hakedisKesintisi(1000, 10000)).toBe(0); expect(hakedisKesintisi(1000, 10000.01)).toBe(50); expect(hakedisKesintisi(1000, 20000, 10000, 5, true)).toBe(0);
  });
  it('firma ödeme planı (YG-843): tahsilat + 45; en geç 120', () => {
    const k = new Date('2026-01-01T00:00:00Z');
    expect(firmaOdemePlani(new Date('2026-01-10T00:00:00Z'), k)).toEqual({ tarih: new Date('2026-02-24T00:00:00Z'), tahsilataBagli: true });
    expect(firmaOdemePlani(new Date('2026-04-20T00:00:00Z'), k).tahsilataBagli).toBe(false);
    expect(firmaOdemePlani(null, k).tarih).toEqual(new Date('2026-05-01T00:00:00Z'));
  });
  it('masraf limiti (YG-921): aşan kısım ödenmez', () => {
    const l = { km: 0.2, yemek: 25, konaklama: 90 };
    expect(masrafOdenecek('Yemek', 40, 1, l)).toBe(25); expect(masrafOdenecek('Konaklama', 80, 1, l)).toBe(80); expect(masrafOdenecek('Km', 50, 100, l)).toBe(20); expect(masrafOdenecek('Diğer', 40, 1, l)).toBe(40);
  });
  it('izin (YG-948): gün hesabı ve kıdem', () => {
    expect(izinGunu('2026-11-09', '2026-11-13')).toBe(5);
    expect(izinGunu('2026-11-07', '2026-11-08')).toBe(0);
    expect(izinGunu('2026-11-09', '2026-11-13', new Set(['2026-11-10']))).toBe(4);
    expect([yillikHak(0), yillikHak(1), yillikHak(5), yillikHak(15)]).toEqual([0, 14, 20, 26]);
  });
  it('IBAN mod 97', () => {
    expect(ibanGecerli(IBAN_OK)).toBe(true); expect(ibanGecerli('TR330006100519786457841327')).toBe(false); expect(ibanGecerli('DE89370400440532013000')).toBe(false);
  });
});

describe('ödeme talebi ve fatura (YG-884, YG-885, YG-906)', () => {
  it('avans hesaplanır, MF Müdürü + limit makamı, onayda BLD-26', async () => {
    const d = await dosya(); const t = await teklifVer(d, 'Yat Sahibi'); const u = `/api/teklif/${t}/odeme-talebi`;
    expect((await o.ist('POST', u, await o.gir('ds'), { tur: 'Avans', sonTarih: '2026-12-01' })).statusCode).toBe(403);
    const r = await o.ist('POST', u, await o.gir('ts'), { tur: 'Avans', sonTarih: '2026-12-01' });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().tutar).toBe(600);
    await onayVer('Ödeme Talebi', r.json().kimlik, 'mfm', 'tid');
    expect((await o.sup.query(`SELECT durum FROM odeme_talebi WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('Gönderildi');
    expect((await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`bld26:${r.json().kimlik}`])).rows[0].metin).toContain('Avans');
  });
  it('sigortada eşik altı avans alınmaz; cayma süresinde erken ifa yoksa avans yok', async () => {
    const d = await dosya('Sigorta Şirketi'); const t = await teklifVer(d, 'Sigorta Şirketi');
    expect((await o.ist('POST', `/api/teklif/${t}/odeme-talebi`, await o.gir('ts'), { tur: 'Avans', sonTarih: '2026-12-01' })).json().hata).toContain('avans alınmaz');
    const b = await dosya(); const tb = await teklifVer(b, 'Yat Sahibi');
    await o.sup.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis, erken_ifa_onayi) VALUES ($1,$2,now(),now(),now() + interval '14 days',false)`, [tb, b.kimlik]);
    expect((await o.ist('POST', `/api/teklif/${tb}/odeme-talebi`, await o.gir('ts'), { tur: 'Avans', sonTarih: '2026-12-01' })).json().hata).toContain('cayma');
  });
  it('tam akış: proforma, onay, muhasebe, fatura bilgisi, kısmi ve tam tahsilat; LGM numara üretmez', async () => {
    const d = await dosya('Sigorta Şirketi'); const t = await teklifVer(d, 'Sigorta Şirketi', 1000); const c = await o.gir('ts');
    const p = await o.ist('POST', `/api/teklif/${t}/proforma`, c);
    expect(p.statusCode, p.body).toBe(200);
    expect(p.json()).toMatchObject({ kdvHaric: 1000, kdv: 200, toplam: 1200 }); expect(p.json().proformaNo).toBe(`${d.dosyaNo}-OT01`);
    expect((await o.ist('POST', `/api/teklif/${t}/proforma`, c)).statusCode).toBe(409);
    const id = p.json().kimlik;
    expect((await o.ist('POST', `/api/fatura/${id}/muhasebeye`, c)).statusCode).toBe(409);
    await onayVer('Proforma', id, 'mfm', 'tid');
    expect((await o.sup.query(`SELECT fatura_no FROM musteri_faturasi WHERE kimlik = $1`, [id])).rows[0].fatura_no).toBeNull();
    expect((await o.ist('POST', `/api/fatura/${id}/muhasebeye`, c)).statusCode).toBe(200);
    const B = { no: 'ABC2026000000001', tarih: '2026-11-10', kur: 40.1234, kurTarihi: '2026-11-09' };
    expect((await o.ist('POST', `/api/fatura/${id}/bilgi`, await o.gir('ds'), B)).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/fatura/${id}/bilgi`, c, { ...B, kurTarihi: '2026-11-10' })).statusCode).toBe(400);
    const f = await o.ist('POST', `/api/fatura/${id}/bilgi`, c, B);
    expect(f.json()).toEqual({ toplamTl: 48148.08, vade: '2026-12-10' });
    const th = (x: object) => o.ist('POST', '/api/tahsilat', c, { fatura: id, tarih: '2026-11-20', kanal: 'Havale', ...x });
    expect((await th({ tutar: 100, kanal: 'Çek' })).statusCode).toBe(400);
    expect((await th({ tutar: 1300 })).statusCode).toBe(409);
    expect((await th({ tutar: 700 })).json()).toEqual({ durum: 'Kısmi Tahsil', kalan: 500 });
    expect((await th({ tutar: 500 })).json()).toEqual({ durum: 'Tahsil Edildi', kalan: 0 });
    expect((await o.ist('POST', '/api/tahsilat', c, { fatura: id, tarih: '2026-11-20', kanal: 'POS', tutar: 20000.01 })).statusCode).toBe(400);
  });
  it('hasar numarası yoksa sigortaya proforma kesilmez', async () => {
    const d = await dosya('Sigorta Şirketi'); await o.sup.query(`UPDATE dosya_sigorta_kaydi SET sigorta_hasar_dosya_no = NULL WHERE dosya_ref = $1`, [d.kimlik]);
    const t = await teklifVer(d, 'Sigorta Şirketi');
    expect((await o.ist('POST', `/api/teklif/${t}/proforma`, await o.gir('ts'))).json().hata).toContain('Hasar dosya');
  });
  it('alacak takip: 1, 15, 30 ve 60. gün basamakları; sigorta ihtarsız; vefatta askı', async () => {
    const d = await dosya(); const f = (await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, vade, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',100,20,120,'Faturalandı',current_date - 61,$4) RETURNING kimlik`, [`${d.dosyaNo}-PF09`, d.kimlik, await teklifVer(d, 'Yat Sahibi'), o.K.ts])).rows[0];
    await alacakIsle(o.db); await alacakIsle(o.db);
    expect((await o.sup.query(`SELECT basamak, sorumlu_rol FROM alacak_takip_adimi WHERE fatura_ref = $1 ORDER BY kimlik`, [f.kimlik])).rows.map((r) => [r.basamak, r.sorumlu_rol])).toEqual([['24 Saat', KADRO.ts], ['15 Gün', 'Ticari İşler Direktörü'], ['30 Gün', 'Genel Müdür Yardımcısı'], ['60 Gün', 'CEO']]);
    const v = await dosya(); await o.sup.query(`UPDATE dosya SET vefat_isareti = true WHERE kimlik = $1`, [v.kimlik]);
    const fv = (await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, vade, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',100,20,120,'Faturalandı',current_date - 20,$4) RETURNING kimlik`, [`${v.dosyaNo}-PF09`, v.kimlik, await teklifVer(v, 'Yat Sahibi'), o.K.ts])).rows[0];
    await alacakIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM alacak_takip_adimi WHERE fatura_ref = $1`, [fv.kimlik])).rows[0].n).toBe(0);
    expect(await o.kart('Vefat Alacak Askısı', fv.kimlik)).toBeDefined();
  });
});

describe('teslim kilidi (YG-087, YG-910, YG-216)', () => {
  it('bireyselde bakiye teslimi durdurur; sigortada vade engellemez; GMY istisnası açar; ONY-27 gider', async () => {
    const d = await dosya(); const t = await teklifVer(d, 'Yat Sahibi');
    await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, vade, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',100,20,120,'Faturalandı',current_date,$4)`, [`${d.dosyaNo}-OT01`, d.kimlik, t, o.K.ts]);
    expect(await teslimEngeli(o.db, d.kimlik)).toContain('120,00 EUR');
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/teslim-durumu`, await o.gir('ds'))).json().engel).toContain('Ödeme bekleniyor');
    await o.sup.query(`UPDATE dosya SET asama = 'Teslim' WHERE kimlik = $1`, [d.kimlik]);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim`, await o.gir('ds'))).statusCode).toBe(409);
    await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-istisnasi`, await o.gir('ds'), { gerekce: 'Özel durum' });
    await o.karar((await o.kart('Teslim İstisnası', d.kimlik)).kimlik, 'gmy', 'Onayla');
    expect(await teslimEngeli(o.db, d.kimlik)).toBeNull();
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teslim`, await o.gir('ds'));
    expect(r.statusCode, r.body).toBe(200);
    const e = (await o.sup.query(`SELECT baslik, metin, kutular FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-27'`, [d.kimlik])).rows[0];
    expect(e.baslik).toContain(d.dosyaNo); expect(e.metin).not.toContain('Kutu'); expect(e.kutular[0].ad).toContain('teslim aldım'); expect(e.kutular[0].ad).not.toContain('[');
    const s = await dosya('Sigorta Şirketi'); const ts = await teklifVer(s, 'Sigorta Şirketi');
    await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, vade, hazirlayan_ref) VALUES ($1,$2,$3,'Sigorta Şirketi',100,20,120,'Faturalandı',current_date,$4)`, [`${s.dosyaNo}-PF01`, s.kimlik, ts, o.K.ts]);
    expect(await teslimEngeli(o.db, s.kimlik)).toBeNull();
  });
  it('hacizli yat değerlendirme olmadan teslim edilemez', async () => {
    const d = await dosya(); await o.sup.query(`UPDATE yat SET takyidat = '{Haciz}' WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    expect(await teslimEngeli(o.db, d.kimlik)).toContain('Hukuk');
  });
  it('kapalıya geçişte tahsilat ve firma ödemesi aranır (YG-067)', async () => {
    const d = await dosya(); const t = await teklifVer(d, 'Yat Sahibi'); const c = await o.gir('ds');
    await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, vade, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',100,20,120,'Faturalandı',current_date,$4)`, [`${d.dosyaNo}-OT01`, d.kimlik, t, o.K.ts]);
    await o.sup.query(`UPDATE dosya SET statu = 'Teknik Kapalı' WHERE kimlik = $1`, [d.kimlik]);
    const e = await o.ist('POST', `/api/dosya/${d.kimlik}/kapanis`, c, { cikis: 'Kapalı', neden: 'Müşteri Vazgeçti', yetkiKapsam: true, uygulama: true, testKabul: true, acikKonu: true, garanti: true, arsiv: true, yazismaBeyani: true });
    expect(e.statusCode).toBe(409); expect(e.json().eksikler).toContain('Tahsilat Bekliyor');
  });
});

describe('hakediş ve firma ödemesi (YG-829, YG-834, YG-836, YG-838, YG-928)', () => {
  // YG-837: hakediş aylık verildiği için iş emri bir ay önce başlamış sayılır.
  const isEmri = async (bedel: number, baslangic = "current_date - 40") => {
    const d = await dosya();
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, statu, teknik_kabul_sonucu, hazirlayan_ref, baslangic_tarihi) VALUES ($1,'ON',$2,$3,'Y','K',$4,'Aktif','Kabul',$5,${baslangic}) RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, firma, bedel, o.K.oy])).rows[0];
    return { d, e: e.kimlik as string };
  };
  it('kanıt zorunlu ve tek; kümülatif bedeli aşamaz; kesinti 10.000 üstünde', async () => {
    const { d, e } = await isEmri(12000); const u = `/api/firma-portal/is-emri/${e}/hakedis`;
    const yukle = async () => { const r = await o.s.inject({ method: 'POST', url: `/api/belge/yukle?ad=K${Math.random()}.pdf&tur=${encodeURIComponent('İş Emri Kanıtı')}&bagTuru=${encodeURIComponent('İş Emri')}&bagKimligi=${e}&kaynak=Elden&dosya=k.pdf`, headers: { ...ana.H, 'content-type': 'application/octet-stream' }, cookies: { [COOKIE_ADI]: firmaC }, payload: Buffer.from(`%PDF-1.4 ${Math.random()}`) }); expect(r.statusCode, r.body).toBe(200); return r.json().belge as string; };
    const b1 = await yukle(); const b2 = await yukle();
    expect((await o.ist('POST', u, firmaC, { brut: 100 })).statusCode).toBe(400);
    const r = await o.ist('POST', u, firmaC, { brut: 1000, belge: b1 });
    expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ hakedisNo: `${d.dosyaNo}-HK01`, kesinti: 50, net: 950 });
    expect((await o.ist('POST', u, firmaC, { brut: 100, belge: b1 })).json().hata).toContain('Aynı kanıt');
    expect((await o.ist('POST', u, firmaC, { brut: 11000.01, belge: b2 })).json().hata).toContain('aşıyor');
  });
  it('hakediş aylık ya da 20.000 EUR dilimle; bedeli tamamlayan son hakediş beklemez (YG-837)', async () => {
    const { d, e } = await isEmri(30000, 'current_date'); const u = `/api/firma-portal/is-emri/${e}/hakedis`;
    const bl = async () => o.belge(d.kimlik, 'ds');
    expect((await o.ist('POST', u, firmaC, { brut: 5000, belge: await bl() })).json().hata).toContain('dilimlerle');
    expect((await o.ist('POST', u, firmaC, { brut: 20000, belge: await bl() })).statusCode).toBe(200);
    expect((await o.ist('POST', u, firmaC, { brut: 5000, belge: await bl() })).json().hata).toContain('dilimlerle');
    expect((await o.ist('POST', u, firmaC, { brut: 10000, belge: await bl() })).statusCode).toBe(200);
  });
  it('doğrulama: Saha yoksa DS; talimat kapıları: fatura, IBAN, SGK; ikili onay; plan 120 gün', async () => {
    const { d, e } = await isEmri(5000); const b1 = await o.belge(d.kimlik, 'ds');
    const h = (await o.ist('POST', `/api/firma-portal/is-emri/${e}/hakedis`, firmaC, { brut: 1000, belge: b1, faturaNo: `F-${Math.random()}` })).json().kimlik;
    const ts = await o.gir('ts');
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('doğrulanmamıştır');
    expect((await o.ist('POST', `/api/hakedis/${h}/dogrula`, await o.gir('tu'))).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/hakedis/${h}/dogrula`, await o.gir('ds'))).json().statu).toBe('Doğrulandı');
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('IBAN');
    const sc = await o.gir('sc');
    expect((await o.ist('POST', `/api/firma/${firma}/iban`, sc, { iban: 'TR000000000000000000000000' })).statusCode).toBe(400);
    const ib = (await o.ist('POST', `/api/firma/${firma}/iban`, sc, { iban: IBAN_OK })).json().kimlik;
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('IBAN');
    expect((await o.ist('POST', `/api/banka-hesabi/${ib}/teyit`, await o.gir('mfy'), { kanal: 'e-posta' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/banka-hesabi/${ib}/teyit`, await o.gir('mfy'), { kanal: 'Sicildeki numaradan geri arama' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('IBAN'); // geri arama tek başına geçerli kılmaz
    const ibk = await o.kart('Banka Hesabı Onayı', ib); await o.karar(ibk.kimlik, 'fmy', 'Onaya Gönder'); await o.karar(ibk.kimlik, 'fym', 'Onaya Gönder'); await o.karar(ibk.kimlik, 'mfm', 'Onayla');
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('SGK');
    await o.ist('POST', `/api/firma/${firma}/belge`, sc, { tur: 'SGK Borcu Yoktur Yazısı', bitis: '2099-01-01' });
    // YG-846: firma faturası Esas Müşteri Faturası ile aynı tarih ve kurda
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('tarih ve kuru');
    const fu = `/api/firma-portal/hakedis/${h}/fatura`; const fn = `F-${Math.random()}`;
    expect((await o.ist('POST', fu, firmaC, { no: fn })).statusCode).toBe(400);
    expect((await o.ist('POST', fu, firmaC, { no: fn, tarih: '2026-11-02', kur: 40.6 })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('Esas Müşteri');
    await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, fatura_no, fatura_tarihi, kur, kur_tarihi, vade, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',1000,0,1000,'Faturalandı',$4,'2026-11-02',40.5,'2026-10-30','2026-11-02',$5)`, [`PF-${d.dosyaNo}`, d.kimlik, await teklifVer(d, 'Yat Sahibi'), `MF-${d.dosyaNo}`, o.K.ts]);
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('aynı değildir');
    expect((await o.ist('POST', fu, firmaC, { no: fn, tarih: '2026-11-02', kur: 40.5 })).statusCode).toBe(200);
    const r = await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts);
    expect(r.statusCode, r.body).toBe(200); expect(r.json().tahsilataBagli).toBe(false);
    const k = await o.kart('Firma Ödeme Talimatı', r.json().kimlik);
    expect(k.zincir).toHaveLength(2);
    expect((await o.karar(k.kimlik, 'mfm', 'Onaya Gönder')).statusCode).toBe(200);
    expect((await o.karar(k.kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM odeme_talimati WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('Onaylandı');
    // Ödeme kaydı odeme.test.ts: V-131, YG-830
    const u = `/api/firma-odemeleri/${r.json().kimlik}/odendi`; const my = await o.gir('my');
    expect((await o.ist('POST', u, await o.gir('ds'), { referans: 'B1' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, ts, { referans: 'B1' })).json().hata).toContain('hazırlayan');
    expect((await o.ist('POST', u, await o.gir('mfm'), { referans: 'B1' })).json().hata).toContain('hazırlayan');
    expect((await o.ist('GET', '/api/firma-odemeleri', my)).json().some((x: { kimlik: string }) => x.kimlik === r.json().kimlik)).toBe(true);
  });
});

describe('izin ve masraf (YG-920, YG-921, YG-948, YG-951)', () => {
  it('bakiye tanımsız ve yetersiz reddedilir; açık dosyada vekil zorunlu; onayda bakiye düşer', async () => {
    await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE kullanici_ref = $1`, [o.K.ik]);
    const c = await o.gir('ik'); const I = { tur: 'Yıllık', baslangic: '2027-03-01', bitis: '2027-03-05' };
    expect((await o.ist('POST', '/api/izin', c, I)).statusCode).toBe(409);
    await o.sup.query(`INSERT INTO izin_bakiyesi VALUES ($1, 2027, 14, 12)`, [o.K.ik]);
    expect((await o.ist('POST', '/api/izin', c, I)).json().hata).toContain('kalan 2');
    await o.sup.query(`UPDATE izin_bakiyesi SET kullanilan = 0, hak = 20 WHERE personel_ref = $1`, [o.K.ik]);
    const r = await o.ist('POST', '/api/izin', c, { ...I, bolunmus: true });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().gun).toBe(5);
    const k = await o.kart('İzin Talebi', r.json().kimlik);
    expect(k.ozet).toBe('5 gün');
    const ikm = (await o.sup.query(`SELECT 1 FROM rol WHERE rol_adi = 'İnsan Kaynakları Müdürü'`)).rowCount; expect(ikm).toBe(1);
    expect((await o.sup.query(`SELECT durum FROM izin_talebi WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('Birim Amirinde');
    expect(k.zincir[0]).not.toBe((await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'İnsan Kaynakları Sorumlusu'`)).rows[0].kimlik); // KT-1
    expect((await o.sup.query(`SELECT kullanilan FROM izin_bakiyesi WHERE personel_ref = $1`, [o.K.ik])).rows[0].kullanilan).toBe(0);
    const d = await dosya();
    await o.sup.query(`UPDATE dosya_ekibi_atamasi SET kullanici_ref = $2 WHERE dosya_ref = $1 AND rol = 'Dosya Sorumlusu'`, [d.kimlik, o.K.ik]);
    expect((await o.ist('POST', '/api/izin', c, { tur: 'Mazeret', baslangic: '2027-04-05', bitis: '2027-04-05' })).json().hata).toContain('vekil');
  });
  it('masraf: limit, 30 gün, belgesiz ve mükerrer', async () => {
    const c = await o.gir('ds'); const bug = new Date().toISOString().slice(0, 10); const M = { tur: 'Yemek', tarih: bug, tutarTl: 2000, kur: 40, belgeOzeti: 'F1' };
    expect((await o.ist('POST', '/api/masraf', c, { ...M, belgeOzeti: '' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/masraf', c, { ...M, tarih: '2020-01-01' })).statusCode).toBe(409);
    const r = await o.ist('POST', '/api/masraf', c, M);
    expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ odenecek: 25, kesilen: 25 });
    expect((await o.ist('POST', '/api/masraf', c, M)).statusCode).toBe(409);
  });
});

describe('Ticari Sorumlu ataması (YG-1600)', () => {
  it('yalnız Yönetici görür; yalnız Ticari Sorumlu atanır; görev kapanır, yeniden açılmaz', async () => {
    const d = await dosya(); const K = 'Ticari Sorumlu Ataması';
    const { ticariAtamaAc } = await import('../src/ticari_atama.js');
    const ac = async () => { const c = await o.db.connect(); try { await ticariAtamaAc(c, d.kimlik); } finally { c.release(); } };
    await ac(); await ac();
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = $1 AND nesne_kimligi = $2`, [K, d.kimlik])).rows[0].n).toBe(1);
    expect((await o.ist('GET', '/api/ticari-atama', await o.gir('ts'))).statusCode).toBe(404);
    const my = await o.gir('my'); const v = (await o.ist('GET', '/api/ticari-atama', my)).json();
    expect(v.bekleyenler.some((x: { kimlik: string }) => x.kimlik === d.kimlik)).toBe(true); expect(v.adaylar.some((x: { kimlik: string }) => x.kimlik === o.K.ts)).toBe(true);
    const u = `/api/dosya/${d.kimlik}/ticari-sorumlu`;
    expect((await o.ist('POST', u, await o.gir('ts'), { kullanici: o.K.ts })).statusCode).toBe(404);
    expect((await o.ist('POST', u, my, { kullanici: o.K.tu })).statusCode).toBe(400);
    const r = await o.ist('POST', u, my, { kullanici: o.K.ts }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.kart(K, d.kimlik)).durum).toBe('Tamamlandı');
    expect((await o.sup.query(`SELECT ticari_sorumlu_ref r FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].r).toBe(o.K.ts);
    expect((await o.ist('GET', '/api/ticari-atama', my)).json().bekleyenler.some((x: { kimlik: string }) => x.kimlik === d.kimlik)).toBe(false);
    await ac(); expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = $1 AND nesne_kimligi = $2`, [K, d.kimlik])).rows[0].n).toBe(1);
  });
});
