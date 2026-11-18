import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kartelaEksperRaporuIsle, proformaSureIsle, riskUyariIsle } from '../src/ticari.js';
import { eurCevir, faturaKuru, kurGetir, tcmbKurIsle } from '../src/doviz.js';
import { isGununeKaydir, odemeTakvimiUyariIsle, onerilenVadeler } from '../src/odeme_takvimi.js';
import { aritmetikKontrol, cetvelDegistiEngeli, parasalZincir } from '../src/teklif.js';
import { rolId } from '../src/ihbar.js';
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
    // YG-1025: Muhasebe Hizmeti proformayı görür; PDF olmadan fatura bilgisi giremez.
    const mh = (await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = 'Muhasebe Hizmeti' RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const dsc = await o.gir('ds');
    expect(((await o.ist('GET', '/api/muhasebe/proformalar', dsc)).json() as { kimlik: string }[]).some((x) => x.kimlik === id)).toBe(true);
    expect((await o.ist('POST', `/api/fatura/${id}/bilgi`, dsc, B)).json().hata).toContain('PDF');
    await o.sup.query(`UPDATE rol_atamasi SET atama_durumu = 'Kapalı' WHERE kimlik = $1`, [mh]);
    const f = await o.ist('POST', `/api/fatura/${id}/bilgi`, c, B);
    expect(f.json()).toEqual({ toplamTl: 48148.08, vade: '2026-12-10' });
    const th = (x: object) => o.ist('POST', '/api/tahsilat', c, { fatura: id, tarih: '2026-11-20', kanal: 'Havale', ...x });
    expect((await th({ tutar: 100, kanal: 'Çek' })).statusCode).toBe(400);
    expect((await th({ tutar: 1300 })).statusCode).toBe(409);
    expect((await th({ tutar: 700 })).json()).toEqual({ durum: 'Kısmi Tahsil', kalan: 500 });
    // YG-1608 (T-YG1608): vadesi geçen fatura tahsilat izlemesinde; yetkisiz rol göremez
    await o.sup.query(`UPDATE musteri_faturasi SET vade = current_date - 3 WHERE kimlik = $1`, [id]);
    expect((await o.ist('GET', '/api/tahsilat-izleme', c)).json().find((x: { kimlik: string }) => x.kimlik === id)).toMatchObject({ kalan: 500, gecikme: 3 });
    expect((await o.ist('GET', '/api/tahsilat-izleme', await o.gir('ds'))).statusCode).toBe(404);
    await o.sup.query(`UPDATE musteri_faturasi SET vade = '2026-12-10' WHERE kimlik = $1`, [id]);
    // YG-904 (T-YG904): eksik kalan kısım için görev açılır
    expect((await o.sup.query(`SELECT ozet FROM is_karti WHERE tur = 'Eksik Tahsilatı İste' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id])).rows[0]?.ozet).toContain('500,00 EUR');
    expect((await th({ tutar: 500 })).json()).toEqual({ durum: 'Tahsil Edildi', kalan: 0 });
    expect((await o.ist('POST', '/api/tahsilat', c, { fatura: id, tarih: '2026-11-20', kanal: 'POS', tutar: 20000.01 })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/tahsilat', c, { fatura: id, tarih: '2026-11-20', kanal: 'POS', tutar: 100 })).statusCode).toBe(409); // T-YG1460-POS: banka seçimine kadar kapalı
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

describe('proforma ve fatura 48 saat izlemesi (YG-885)', () => {
  it('nihai kabulden 48 saat sonra proforma yoksa Ticari Sorumluya bir kez bildirim (T-YG885-48)', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`INSERT INTO kabul_kaydi (dosya_ref, kabul_turu, kaydeden_ref, olusturma_zamani) VALUES ($1,'Nihai Kabul',$2, now() - interval '49 hours')`, [d.kimlik, o.K.ty]);
    expect(await proformaSureIsle(o.db)).toBeGreaterThanOrEqual(1); await proformaSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [o.K.ts, `proforma-48:${d.kimlik}`])).rows[0].n).toBe(1);
  });
  it('muhasebeye iletilen proformada 48 saatte fatura no yoksa Ticari Sorumluya görev (T-YG546)', async () => {
    const d = await dosya(); const t = await teklifVer(d, 'Yat Sahibi', 1000, 'Taslak', null as never);
    const f = (await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, muhasebe_iletim_zamani, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',1000,200,1200,'Muhasebeye İletildi', now() - interval '49 hours', $4) RETURNING kimlik`, [`PF-546-${Date.now()}`, d.kimlik, t, o.K.ts])).rows[0].kimlik;
    await proformaSureIsle(o.db);
    expect(await o.kart('Fatura No Bekleniyor', f)).toBeDefined();
  });
});

describe('güvence kesintisi iadesi (YG-838)', () => {
  it('son hakedişten 12 ay sonra Ticari Sorumluya iade görevi bir kez (T-YG838-IADE)', async () => {
    const d = await o.dosyaAc();
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Güvence Firma','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-GV${Date.now()}`, o.K.ds])).rows[0].kimlik;
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Y','K','Kapalı',$4) RETURNING kimlik`, [`${d.dosyaNo}-ON66`, d.kimlik, f, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO hakedis (hakedis_no, is_emri_ref, dosya_ref, sira_no, bu_donem_brut, kumulatif, kesinti, net, statu, giren_ref, olusturma_zamani) VALUES ($1,$2,$3,1,12000,12000,600,11400,'Ödendi',$4, now() - interval '13 months')`, [`${d.dosyaNo}-HK66`, e, d.kimlik, o.K.ds]);
    await riskUyariIsle(o.db); await riskUyariIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Güvence Kesintisi İadesi' AND nesne_kimligi = $1`, [e])).rows[0].n).toBe(1);
  });
});

describe('kartela eksper raporu (YG-773)', () => {
  it('ayda bir kez TİD bildirimi (T-YG773)', async () => {
    const t0 = new Date('2031-05-03T08:00:00Z');
    expect(await kartelaEksperRaporuIsle(o.db, t0)).toBe(1); expect(await kartelaEksperRaporuIsle(o.db, t0)).toBe(0);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = 'kartela-eksper:2031-04'`, [o.K.tid])).rows[0].n).toBe(1);
  });
});

describe('teklif aritmetik kontrolü ve cetvel değişimi (YG-190, YG-156)', () => {
  it('kalem, ara toplam ve genel toplam tutarsızlığı yakalanır; cetveli değişen teklif engellenir (T-YG190)', async () => {
    const d = await dosya(); const t = await teklifVer(d, 'Yat Sahibi', 1000, 'Taslak', null as never);
    expect(await aritmetikKontrol(o.db, t)).toBeNull();
    await o.sup.query(`UPDATE fiyat_teklifi_kalemi SET tutar_eur = 999 WHERE teklif_ref = $1`, [t]);
    expect(await aritmetikKontrol(o.db, t)).toContain('1. kalemde');
    await o.sup.query(`UPDATE fiyat_teklifi_kalemi SET tutar_eur = 1000 WHERE teklif_ref = $1`, [t]);
    await o.sup.query(`UPDATE fiyat_teklifi SET genel_toplam_eur = 1199.99 WHERE kimlik = $1`, [t]);
    expect(await aritmetikKontrol(o.db, t)).toContain('genel toplam');
    const cv = (await o.sup.query(`INSERT INTO kapsam_cetveli (dosya_ref, surum, durum, hazirlayan_ref) VALUES ($1, 1, 'Yerine Geçti', $2) RETURNING kimlik`, [d.kimlik, o.K.tu])).rows[0].kimlik;
    await o.sup.query(`UPDATE fiyat_teklifi SET cetvel_ref = $2 WHERE kimlik = $1`, [t, cv]);
    expect(await cetvelDegistiEngeli(o.db, t)).toContain('Rev.1');
    await o.sup.query(`UPDATE kapsam_cetveli SET durum = 'Onaylı' WHERE kimlik = $1`, [cv]);
    expect(await cetvelDegistiEngeli(o.db, t)).toBeNull();
  });
});

describe('parasal zincir üst kademeleri (YG-165)', () => {
  it('son makam GMY/CEO iken TİD (ticari) ve GMY ara kademe olarak girer; ticari olmayan zincire TİD girmez (T-YG165)', async () => {
    const r = async (x: string) => rolId(o.db, x);
    const tid = await r('Ticari İşler Direktörü'); const gmy = await r('Genel Müdür Yardımcısı'); const mfm = await r('Muhasebe ve Finans Müdürü');
    expect(await parasalZincir(o.db, ['Muhasebe ve Finans Müdürü'], 'Ticari İşler Direktörü')).toEqual([mfm, tid]);
    expect(await parasalZincir(o.db, ['Muhasebe ve Finans Müdürü'], 'Genel Müdür Yardımcısı')).toEqual([mfm, tid, gmy]);
    const z = await parasalZincir(o.db, ['Muhasebe ve Finans Müdürü'], 'CEO');
    expect(z.slice(0, 3)).toEqual([mfm, tid, gmy]); expect(z).toHaveLength(4);
    expect(await parasalZincir(o.db, ['Operasyon Müdürü'], 'Genel Müdür Yardımcısı')).not.toContain(tid);
  });
});

describe('ödeme takvimi (YG-918)', () => {
  it('vade önerisi, tatil kaydırması, elle kalem, 72 saat uyarısı tek kez, ödendi (T-YG918)', async () => {
    expect(await onerilenVadeler(o.db, new Date('2026-11-17T09:00:00+03:00'))).toEqual({ masraf: '2026-11-21', maas: '2026-12-01' });
    expect(await isGununeKaydir(o.db, '2026-11-22')).toBe('2026-11-23');
    const ts = await o.gir('ts');
    expect((await o.ist('POST', '/api/odeme-takvimi/kalem', await o.gir('ds'), { tur: 'SGK', aciklama: 'Prim', vade: '2026-11-22' })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/odeme-takvimi/kalem', ts, { tur: 'Kira', aciklama: 'K', vade: '2026-11-22' })).statusCode).toBe(400);
    const k = (await o.ist('POST', '/api/odeme-takvimi/kalem', ts, { tur: 'SGK', aciklama: 'Ekim primi', tutarTl: 1500, vade: '2026-11-22' })).json();
    expect(k.vade).toBe('2026-11-23');
    const t0 = new Date('2026-11-21T10:00:00+03:00');
    expect(await odemeTakvimiUyariIsle(o.db, t0)).toBeGreaterThan(0); await odemeTakvimiUyariIsle(o.db, t0);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [o.K.ts, `odeme-vade-72:SGK:${k.kimlik}`])).rows[0].n).toBe(1);
    expect((await o.ist('GET', '/api/odeme-takvimi', ts)).json().satirlar.some((s: { kimlik?: string }) => s.kimlik === k.kimlik)).toBe(true);
    expect((await o.ist('POST', `/api/odeme-takvimi/kalem/${k.kimlik}/odendi`, ts)).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/odeme-takvimi', ts)).json().satirlar.some((s: { kimlik?: string }) => s.kimlik === k.kimlik)).toBe(false);
  });
});

describe('doğan görev (YG-1465)', () => {
  it('şablon gönderimiyle Dosya Sorumlusuna ilk yanıt süreli görev açılır, aynı gönderimde tekrar açılmaz (T-YG1465)', async () => {
    const { doganGorevAc } = await import('../src/ihbar.js');
    const d = await dosya();
    await o.sup.query(`UPDATE sablon_metni SET dogan_gorev = 'Dosya Sorumlusu – en kısa sürede (üst sınır: öncelik ilk yanıt süresi) arama' WHERE kod = 'BLD-08' AND dil = 'tr'`);
    const t0 = new Date('2026-11-18T10:00:00+03:00');
    expect(await doganGorevAc(o.db, 'BLD-08', d.dosyaNo, 'deneme-1465', t0)).toBe(1);
    expect(await doganGorevAc(o.db, 'BLD-08', d.dosyaNo, 'deneme-1465', t0)).toBe(0);
    const k = await o.kart('Doğan Görev', d.kimlik);
    expect(k.ozet).toBe('en kısa sürede arama'); expect(k.sahip_kullanici_ref).toBe(o.K.ds);
    const oncelik = (await o.sup.query(`SELECT oncelik FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].oncelik as string;
    expect(new Date(k.son_zaman).getTime() - t0.getTime()).toBe(({ Kritik: 0.5, Yüksek: 2, Normal: 4, Planlı: 8 } as Record<string, number>)[oncelik]! * 3_600_000);
    expect(await doganGorevAc(o.db, 'BLD-01', d.dosyaNo, 'deneme-1465b', t0)).toBe(0);
    await o.sup.query(`UPDATE sablon_metni SET dogan_gorev = 'Dosya Sorumlusu – yanıt gelince en kısa sürede randevuyu kesinleştirmek' WHERE kod = 'BLD-08' AND dil = 'tr'`);
    expect(await doganGorevAc(o.db, 'BLD-08', d.dosyaNo, 'deneme-1465c', t0)).toBe(1);
    expect((await o.kart('Doğan Görev', d.kimlik)).son_zaman).toBeNull();
  });
});

describe('tedarikçi fatura düzenleme metni (BLD-97, MTN-1)', () => {
  it('onaylı metin sipariş, tarih ve kurla eksiksiz dolar (T-YG1429)', async () => {
    const { metinGetir } = await import('../src/metin.js');
    const m = await metinGetir(o.db, 'BLD-97', 'tr', { 'Sipariş No': 'SP-1', tarih: '10.11.2026', 'kur tarihi': '09.11.2026', kur: '40,1234', tutar: '100,00', 'tutar TL': '4.012,34', 'bağlantı': 'http://x' });
    expect(m).toContain('SP-1 numaralı sipariş'); expect(m).toContain('4.012,34 TL'); expect(m).not.toContain('[');
  });
});

describe('tahsilat vadesi (YG-900)', () => {
  it('sigortada şirketin ödeme günü, en çok 30 gün; yoksa 30 gün; yat sahibinde fatura günü (T-YG900)', async () => {
    const { tahsilatVadeGunu } = await import('../src/ticari.js');
    const d = await dosya();
    await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi) VALUES ($1, 'Vade Sigorta A.Ş.') ON CONFLICT (dosya_ref) DO UPDATE SET sigortaci_adi = EXCLUDED.sigortaci_adi`, [d.kimlik]);
    expect(await tahsilatVadeGunu(o.db, d.kimlik, 'Sigorta Şirketi')).toBe(30);
    expect(await tahsilatVadeGunu(o.db, d.kimlik, 'Yat Sahibi')).toBe(0);
    const tid = await o.gir('tid');
    expect((await o.ist('POST', '/api/sozlesme-odeme-vadesi', tid, { sigortaci: 'Vade Sigorta A.Ş.', gun: 45, dayanak: 'Yazı' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/sozlesme-odeme-vadesi', await o.gir('ds'), { sigortaci: 'Vade Sigorta A.Ş.', gun: 20, dayanak: 'Yazı' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/sozlesme-odeme-vadesi', tid, { sigortaci: 'vade sigorta a.ş.', gun: 20, dayanak: 'Sigorta şirketi yazısı' })).statusCode).toBe(200);
    expect(await tahsilatVadeGunu(o.db, d.kimlik, 'Sigorta Şirketi')).toBe(20);
  });
});

describe('TCMB döviz kuru (YG-1356, YG-825, YG-955)', () => {
  it('yayın okunur, tekrar yazılmaz, elle giriş TCMB kaydını değiştirmez, çapraz çevrim (T-YG1356)', async () => {
    const xml = `<Tarih_Date Tarih="02.01.2026" Date="01/02/2026"><Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><ForexBuying>40.0000</ForexBuying><ForexSelling>40.5000</ForexSelling></Currency><Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR"><ForexBuying>45.0000</ForexBuying><ForexSelling>45.0000</ForexSelling></Currency></Tarih_Date>`;
    expect(await tcmbKurIsle(o.db, async () => xml)).toBe(2); expect(await tcmbKurIsle(o.db, async () => xml)).toBe(0);
    expect(await tcmbKurIsle(o.db, async () => { throw new Error('erişim yok'); })).toBe(0);
    expect((await kurGetir(o.db, 'EUR', '2026-01-05'))?.kur).toBe(45);
    expect(await eurCevir(o.db, 900, 'USD', '2026-01-02')).toBe(810);
    expect(await eurCevir(o.db, 900, 'GBP', '2026-01-02')).toBeNull();
    expect((await o.ist('POST', '/api/doviz-kuru', await o.gir('ds'), { tarih: '2026-01-02', pb: 'GBP', satis: 50 })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/doviz-kuru', await o.gir('ts'), { tarih: '2026-01-02', pb: 'EUR', satis: 50 })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/doviz-kuru', await o.gir('ts'), { tarih: '2026-01-02', pb: 'GBP', satis: 54 })).statusCode).toBe(200);
    expect(await eurCevir(o.db, 900, 'GBP', '2026-01-02')).toBe(1080);
    // YG-875 (T-YG875): fatura kuru önceki iş günü kaydından kopyalanır; farklı elle değer reddedilir; kayıt yoksa elle kabul edilir
    expect(await faturaKuru(o.db, '2026-01-05')).toEqual({ kur: 45, tarih: '2026-01-02', kaynak: 'TCMB' });
    expect(await faturaKuru(o.db, '2026-01-05', { kur: 46, tarih: '2026-01-02' })).toHaveProperty('hata');
    expect(await faturaKuru(o.db, '2026-03-05', { kur: 47.5, tarih: '2026-03-04' })).toEqual({ kur: 47.5, tarih: '2026-03-04', kaynak: 'Elle' });
    expect(await faturaKuru(o.db, '2026-03-05')).toHaveProperty('hata');
    expect((await o.ist('GET', '/api/doviz-kurlari', await o.gir('ds'))).json().map((x: { pb: string }) => x.pb)).toEqual(['EUR', 'USD', 'GBP']);
    // YG-236 (T-YG236): teklif gönderilince o günkü EUR satış kuru teklife yazılır
    const tk = await teklifVer(await dosya(), 'Yat Sahibi', 1000, 'Taslak', null as never);
    await o.sup.query(`UPDATE fiyat_teklifi SET statu = 'Gönderildi' WHERE kimlik = $1`, [tk]);
    expect(Number((await o.sup.query(`SELECT teklif_kuru FROM fiyat_teklifi WHERE kimlik = $1`, [tk])).rows[0].teklif_kuru)).toBeGreaterThan(0);
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
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('Vergi borcu'); // YG-341
    await o.ist('POST', `/api/firma/${firma}/belge`, sc, { tur: 'Vergi Borcu Yoktur Yazısı' });
    expect((await o.sup.query(`SELECT gecerlilik_bitis - current_date g FROM sicil_belgesi WHERE kurulus_ref = $1 AND tur = 'Vergi Borcu Yoktur Yazısı'`, [firma])).rows[0].g).toBe(730);
    // YG-846: firma faturası Esas Müşteri Faturası ile aynı tarih ve kurda
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('tarih ve kuru');
    const fu = `/api/firma-portal/hakedis/${h}/fatura`; const fn = `F-${Math.random()}`;
    expect((await o.ist('POST', fu, firmaC, { no: fn })).statusCode).toBe(400);
    expect((await o.ist('POST', fu, firmaC, { no: fn, tarih: '2026-11-02', kur: 40.6 })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('Esas Müşteri');
    await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, fatura_no, fatura_tarihi, kur, kur_tarihi, vade, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',1000,0,1000,'Faturalandı',$4,'2026-11-02',40.5,'2026-10-30','2026-11-02',$5)`, [`PF-${d.dosyaNo}`, d.kimlik, await teklifVer(d, 'Yat Sahibi'), `MF-${d.dosyaNo}`, o.K.ts]);
    expect((await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts)).json().hata).toContain('aynı değildir');
    expect((await o.ist('POST', fu, firmaC, { no: fn, tarih: '2026-11-02', kur: 40.5 })).statusCode).toBe(200);
    // YG-420 (T-YG420): Ticari Sorumlu faturayı gerekçeyle iade eder; firma yeniden girer.
    const iu = `/api/hakedis/${h}/fatura-iade`;
    expect((await o.ist('POST', iu, await o.gir('ds'), { gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', iu, ts, {})).statusCode).toBe(400);
    expect((await o.ist('POST', iu, ts, { gerekce: 'Unvan hatalı' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT firma_fatura_no, fatura_iade_gerekcesi FROM hakedis WHERE kimlik = $1`, [h])).rows[0]).toEqual({ firma_fatura_no: null, fatura_iade_gerekcesi: 'Unvan hatalı' });
    expect((await o.ist('POST', iu, ts, { gerekce: 'G' })).statusCode).toBe(409);
    expect((await o.ist('POST', fu, firmaC, { no: fn, tarih: '2026-11-02', kur: 40.5 })).statusCode).toBe(200);
    const r = await o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, ts);
    expect(r.statusCode, r.body).toBe(200); expect(r.json().tahsilataBagli).toBe(false);
    const k = await o.kart('Firma Ödeme Talimatı', r.json().kimlik);
    expect(k.zincir).toHaveLength(2);
    expect((await o.karar(k.kimlik, 'mfm', 'Onaya Gönder')).statusCode).toBe(200);
    expect((await o.karar(k.kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM odeme_talimati WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('Onaylandı');
    expect((await o.ist('POST', iu, ts, { gerekce: 'G' })).statusCode).toBe(409); // talimat açıldıktan sonra iade yok
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
    // YG-1057 (T-YG1057): 10 gün ve üzeri izinde rol vekâleti yoksa amir kararı durur
    { const { KAPANIS } = await import('../src/kapanis.js'); const iz = (await o.sup.query(`INSERT INTO izin_talebi (personel_ref, izin_turu, baslangic, bitis, gun, durum) VALUES ($1,'Yıllık','2027-06-01','2027-06-14',10,'Birim Amirinde') RETURNING kimlik`, [o.K.ik])).rows[0].kimlik;
      const cl = await o.db.connect(); try { await expect(KAPANIS.get('İzin Talebi')!(cl, { nesne_kimligi: iz, ozet: null }, 'Onaya Gönder', o.K.tid!)).rejects.toThrow('rol vekâleti'); } finally { cl.release(); }
      await o.sup.query(`DELETE FROM izin_talebi WHERE kimlik = $1`, [iz]); }
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
    // YG-921 (T-YG921): konaklama sınır aşımı gerekçeyle TİD onayına gider ve tamamı ödenecek olur; reddedilen belge yeniden girilir
    const ks = await o.ist('POST', '/api/masraf', c, { ...M, tur: 'Konaklama', tutarTl: 6000, belgeOzeti: 'F921', istisna: 'Bölgede uygun otel yok' });
    expect(ks.json()).toMatchObject({ odenecek: 150, kesilen: 0 });
    const kk = await o.kart('Masraf Fişi', ks.json().kimlik); const tidR = (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Ticari İşler Direktörü'`)).rows[0].kimlik;
    expect(kk.zincir).toContain(tidR);
    await o.sup.query(`UPDATE personel_masraf_fisi SET durum = 'Reddedildi' WHERE kimlik = $1`, [ks.json().kimlik]);
    expect((await o.ist('POST', '/api/masraf', c, { ...M, tur: 'Konaklama', tutarTl: 6000, belgeOzeti: 'F921' })).json()).toMatchObject({ odenecek: 90, kesilen: 60 });
    // YG-922: yakıt girilmez; km Saha Sorumlusu dışında ön onay ister
    expect((await o.ist('POST', '/api/masraf', c, { ...M, tur: 'Yakıt', belgeOzeti: 'F2' })).statusCode).toBe(400);
    const K = { ...M, tur: 'Km', miktar: 100, tutarTl: 400, belgeOzeti: 'F3' };
    expect((await o.ist('POST', '/api/masraf', c, K)).json().hata).toContain('özel araç');
    expect((await o.ist('POST', '/api/ozel-arac-onayi', c, { tarih: '2020-01-01', guzergah: 'Bodrum', gerekce: 'Keşif' })).statusCode).toBe(409);
    const oa = await o.ist('POST', '/api/ozel-arac-onayi', c, { tarih: bug, guzergah: 'Marmaris–Bodrum', gerekce: 'Keşif' }); expect(oa.statusCode, oa.body).toBe(200);
    expect((await o.kart('Özel Araç Kullanımı', oa.json().kimlik)).durum).toBe('Bekliyor');
    await o.sup.query(`UPDATE ozel_arac_onayi SET durum = 'Onaylandı' WHERE kimlik = $1`, [oa.json().kimlik]);
    expect((await o.ist('POST', '/api/masraf', c, K)).statusCode).toBe(200);
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

describe('fiş aslı (YG-1622)', () => {
  it('kâğıt fişte teslim izlenir, e-Fatura izlenmez; ödeme asılı beklemez; aylık hatırlatma bir kez', async () => {
    const c = await o.gir('ds'); const M = { tur: 'Yemek', tarih: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), tutarTl: 100, kur: 40, miktar: 1 };
    const k = (await o.ist('POST', '/api/masraf', c, { ...M, belgeOzeti: `K-${Math.random()}` })).json().kimlik as string;
    const e = (await o.ist('POST', '/api/masraf', c, { ...M, belgeOzeti: `E-${Math.random()}`, belgeTuru: 'e-Fatura' })).json().kimlik as string;
    expect((await o.ist('POST', '/api/masraf', c, { ...M, belgeOzeti: 'X', belgeTuru: 'Z' })).statusCode).toBe(400);
    const my = await o.gir('my'); expect((await o.ist('GET', '/api/masraf/asil-bekleyen', c)).statusCode).toBe(404);
    const l = (await o.ist('GET', '/api/masraf/asil-bekleyen', my)).json().map((x: { kimlik: string }) => x.kimlik); expect(l).toContain(k); expect(l).not.toContain(e);
    expect((await o.ist('POST', `/api/masraf/${e}/asil-teslim`, my, {})).statusCode).toBe(409);
    const { fisAsliHatirlat } = await import('../src/menfaat_masraf.js'); const ileri = new Date(Date.now() + 40 * 86_400_000);
    const n1 = await fisAsliHatirlat(o.db, ileri); const n2 = await fisAsliHatirlat(o.db, ileri); expect(n1).toBeGreaterThan(0); expect(n2).toBe(0);
    expect((await o.ist('POST', `/api/masraf/${k}/asil-teslim`, my, {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT asil_teslim_alan_ref r FROM personel_masraf_fisi WHERE kimlik = $1`, [k])).rows[0].r).toBe(o.K.my);
  });
  it('yıllık izin hakkı kıdemden hesaplanır (YG-948)', async () => {
    const { yillikIzinHakki } = await import('../src/ticari.js');
    expect(yillikIzinHakki('2026-01-10', '2026-12-01')).toBe(0); expect(yillikIzinHakki('2025-01-10', '2026-01-10')).toBe(14);
    expect(yillikIzinHakki('2020-01-10', '2026-01-10')).toBe(20); expect(yillikIzinHakki('2011-01-10', '2026-01-10')).toBe(26); expect(yillikIzinHakki('2021-01-10', '2026-01-10')).toBe(14);
  });
  it('tevkifatlı faturalar aylık listelenir ve KDV iade dökümü alınır (YG-882)', async () => {
    const u = '/api/muhasebe/tevkifatli?ay=2026-10';
    expect((await o.ist('GET', u, await o.gir('ds'))).statusCode).toBe(404);
    const c = await o.gir('mfm'); expect((await o.ist('GET', '/api/muhasebe/tevkifatli?ay=10-2026', c)).statusCode).toBe(400);
    const r = await o.ist('GET', u, c); expect(r.statusCode, r.body).toBe(200); expect(Array.isArray(r.json().faturalar)).toBe(true);
    const csv = await o.ist('GET', `${u}&bicim=csv`, c); expect(csv.statusCode).toBe(200); expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.body).toContain('Tevkifat (EUR)');
  });
  it('masraf karar sırası: ilk amir, belge kontrolü, son makam; Yöneticinin kendi fişini Müdür Yardımcısı kontrol eder (YG-1621)', async () => {
    const rid = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
    const M = { tur: 'Yemek', tarih: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), tutarTl: 100, kur: 40, miktar: 1 };
    const a = (await o.ist('POST', '/api/masraf', await o.gir('ds'), { ...M, belgeOzeti: `Z1-${Math.random()}` })).json().kimlik as string;
    expect((await o.kart('Masraf Fişi', a)).zincir).toEqual([await rid('Muhasebe ve Finans Yöneticisi'), await rid('Operasyon Müdürü')]);
    const b2 = (await o.ist('POST', '/api/masraf', await o.gir('my'), { ...M, belgeOzeti: `Z2-${Math.random()}` })).json().kimlik as string;
    expect((await o.kart('Masraf Fişi', b2)).zincir).toEqual([await rid('Muhasebe ve Finans Müdür Yardımcısı'), await rid('Muhasebe ve Finans Müdürü')]);
  });
  it('teklif performans verisi dönem bazında (YG-227)', async () => {
    expect((await o.ist('GET', '/api/teklif-performans?donem=2026-11', await o.gir('ds'))).statusCode).toBe(404);
    const r = await o.ist('GET', '/api/teklif-performans?donem=2026-11', await o.gir('tid')); expect(r.statusCode, r.body).toBe(200);
    expect(Object.keys(r.json())).toEqual(['donem', 'ozet', 'durumlar', 'kararlar', 'muhataplar']); expect(r.json().donem).toBe('2026-11');
  });
  it('sigorta ödemeyi yat sahibine yapacaksa dosya yat sahibine yönlenir (YG-892)', async () => {
    const d = await dosya(); const u = `/api/dosya/${d.kimlik}/odeme-yat-sahibine`;
    expect((await o.ist('POST', u, await o.gir('ds'), { dayanak: 'x' })).statusCode).toBe(403);
    const c = await o.gir('ts');
    expect((await o.ist('POST', u, c, {})).statusCode).toBe(400);
    await o.sup.query(`UPDATE dosya SET musteri_turu = 'Bireysel Müşteri', dosya_niteligi = 'Doğrudan hizmet' WHERE kimlik = $1`, [d.kimlik]);
    expect((await o.ist('POST', u, c, { dayanak: 'E-posta 16.11.2026' })).statusCode).toBe(409);
    await o.sup.query(`UPDATE dosya SET musteri_turu = 'Sigorta Şirketi' WHERE kimlik = $1`, [d.kimlik]);
    const r = await o.ist('POST', u, c, { dayanak: 'E-posta 16.11.2026' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT odeme_yat_sahibine_dayanak FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].odeme_yat_sahibine_dayanak).toBe('E-posta 16.11.2026');
    expect((await o.ist('POST', u, c, { dayanak: 'tekrar' })).statusCode).toBe(409);
  });
  it('Y seviyesi ölçütlerden önerilir, üstü verilmez (YG-308)', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu) VALUES ($1, 'Y Deneme', 'Çözüm Ortağı') RETURNING kimlik`, [`YS-${Date.now()}`])).rows[0].kimlik;
    const { yetkinlikOnerisi } = await import('../src/firma.js');
    expect((await yetkinlikOnerisi(o.db, f, 'Kompozit', { deneyim: 12, belgeli: true, uretici: true, muhendislik: true })).seviye).toBe('Y1');
    const c = await o.gir('fym'); const u = `/api/firma/${f}/brans`;
    const r = await o.ist('POST', u, c, { brans: 'Kompozit', deneyim: 12, seviye: 'Y3' });
    expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('Y1');
    const r2 = await o.ist('POST', u, c, { brans: 'Kompozit', deneyim: 12, kisit: 'Teak döşeme hariç' }); expect(r2.statusCode, r2.body).toBe(200); expect(r2.json().seviye).toBe('Y1');
  });
});
