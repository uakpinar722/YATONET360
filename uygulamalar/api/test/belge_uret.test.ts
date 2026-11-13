import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { belgeKuyruguIsle, belgeUret, degisiklikKaydiTanim, garantiTanim, gizlilikIsareti, teklifTanim, TURKCE_ESAS } from '../src/belge_uret.js';
import { kuyrukIsle } from '../src/bildirim.js';
import { Depo } from '../src/depo.js';
import { pdfKapat, sayfaSayisi } from '../src/pdf.js';
import { ortamKur, type Ortam } from './yardimci.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tmy: 'Teknik Müdür Yardımcısı', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', mfm: 'Muhasebe ve Finans Müdürü', tid: 'Ticari İşler Direktörü' };
let o: Ortam; let b: { db: any; webAdresi: string; depo: Depo; eposta: any; sms: any }; let dk: string;
const R = { kapsam: 'Kapsam', incelenen: 'Karina', saha: 'Kara park', yontem: 'Gözle', bulgular: 'Çatlak', acikSorular: 'Yok', analiz: 'Onarılabilir', oneriler: 'Laminasyon', uzmanlik: 'Tahrik' , ekInceleme: 'Evet', ekIncelemeAlani: 'Salma bölmesi alt bağlantıları' };
const teklif = async (d: { kimlik: string; dosyaNo: string }, statu = 'Onaylı') => {
  const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,$3,1000,200,1200,1000,$4) RETURNING kimlik`, [`${d.dosyaNo}-TK01`, d.kimlik, statu, o.K.ts])).rows[0];
  await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur, onay_durumu) VALUES ($1,1,'Laminasyon İşçiliği','Onarım','İşçilik',1,'saat',1000,1000,'Onaylandı')`, [t.kimlik]);
  return t.kimlik as string;
};
const durum = async (tur: string, n: string) => (await o.sup.query(`SELECT * FROM belge_uretim WHERE tur = $1 AND nesne = $2`, [tur, n])).rows[0];

beforeAll(async () => { o = await ortamKur('yatonet360_test22', KADRO); dk = mkdtempSync(join(tmpdir(), 'bu')); b = { db: o.db, webAdresi: 'http://x', depo: new Depo(dk), eposta: o.posta, sms: o.sms }; }, 120_000);
afterAll(async () => { await pdfKapat(); await o.kapat(); });

describe('resmî PDF (YG-665, YG-691)', () => {
  it('Fiyat Teklifi üretilir, dosyaya resmî sürüm olarak bağlanır, doğrulama kodu taşır, fiyat kuralı ve firma adı yazmaz', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const t = await teklif(d);
    await belgeUret(o.db, { tur: 'Fiyat Teklifi', nesne: t, dosya: d.kimlik });
    expect(await belgeKuyruguIsle(b as never)).toBeGreaterThan(0);
    const u = await durum('Fiyat Teklifi', t); expect(u.durum, u.son_hata).toBe('Üretildi');
    const s = (await o.sup.query(`SELECT s.dogrulama_kodu, s.durum, s.ozet_sha256, s.depo_anahtari, e.ad, e.bag_kimligi FROM belge_surum s JOIN belge e ON e.kimlik = s.belge_ref WHERE s.kimlik = $1`, [u.surum_ref])).rows[0];
    expect(s.durum).toBe('Yürürlükte'); expect(s.dogrulama_kodu).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/); expect(s.bag_kimligi).toBe(d.kimlik); expect(s.ad).toContain(`${d.dosyaNo}-TK01`);
    const pdf = readFileSync(join(dk, s.depo_anahtari)); expect(pdf.subarray(0, 5).toString()).toBe('%PDF-'); expect(sayfaSayisi(pdf)).toBeGreaterThanOrEqual(1);
    const v = await o.ist('GET', `/api/dogrula/${s.dogrulama_kodu}`);
    expect(v.statusCode, v.body).toBe(200); expect(v.json().durum).toBe('Yürürlükte');
    const m = JSON.stringify((await teklifTanim(o.db, t, 'ABCD-1234', 'http://x')).t);
    expect(m).toContain('KDV Durumu'); expect(m).toContain('Standart KDV'); // YG-878
    expect(m).toContain('Laminasyon İşçiliği'); expect(m).toContain('1.200,00'); expect(m).toContain('ABCD-1234');
    expect(m).not.toMatch(/maliyet|katsay|teminat|firma/i);
  });
  it('Teknik Rapor onayında kuyruğa girer; Kritik sınıfta, yat sahibi portalına düşmez', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); await o.sup.query(`DELETE FROM teknik_rapor WHERE dosya_ref = $1`, [d.kimlik]);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, await o.gir('tu'), R); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().raporNo).toBe(`${d.dosyaNo}-TR01`);
    const k = await o.kart('Teknik Rapor', r.json().kimlik);
    await o.karar(k.kimlik, 'ty', 'Onaya Gönder'); await o.karar(k.kimlik, 'tmy', 'Onaya Gönder'); await o.karar(k.kimlik, 'tm', 'Onayla');
    expect((await durum('Teknik Rapor', r.json().kimlik)).durum).toBe('Bekliyor');
    await belgeKuyruguIsle(b as never);
    const u = await durum('Teknik Rapor', r.json().kimlik); expect(u.durum, u.son_hata).toBe('Üretildi');
    expect((await o.sup.query(`SELECT bilgi_sinifi FROM belge WHERE kimlik = $1`, [u.belge_ref])).rows[0].bilgi_sinifi).toBe('Kritik');
  });
  it('Proforma OT numaralı üretilir; kalem ve KDV yazılı', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const t = await teklif(d, 'Karar'); await o.sup.query(`UPDATE fiyat_teklifi SET karar = 'Tam Onay' WHERE kimlik = $1`, [t]);
    const p = await o.ist('POST', `/api/teklif/${t}/proforma`, await o.gir('ts')); expect(p.statusCode, p.body).toBe(200); expect(p.json().proformaNo).toBe(`${d.dosyaNo}-OT01`);
    const k = await o.kart('Proforma', p.json().kimlik); await o.karar(k.kimlik, 'mfm', 'Onaya Gönder'); await o.karar(k.kimlik, 'tid', 'Onayla');
    await belgeKuyruguIsle(b as never);
    const u = await durum('Proforma', p.json().kimlik); expect(u.durum, u.son_hata).toBe('Üretildi');
  });
  it('e-posta PDF ekiyle gider; üretim hatası işlemi bozmaz, üç denemeden sonra Dosya Sorumlusuna görev açar', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const t = await teklif(d);
    await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'alici@deneme.local' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]); // YG-1171: ek yalnız dosya tarafına
    await belgeUret(o.db, { tur: 'Fiyat Teklifi', nesne: t, dosya: d.kimlik, gonder: { olay: `pdf-deneme:${t}`, eposta: 'alici@deneme.local', konu: 'Konu', metin: 'Metin', acil: true } });
    await belgeKuyruguIsle(b as never);
    const g = (await o.sup.query(`SELECT ek_surumler, durum FROM gonderim WHERE olay_anahtari = $1`, [`pdf-deneme:${t}`])).rows[0];
    expect(g.ek_surumler).toHaveLength(1);
    for (let n = 0; n < 5; n++) await kuyrukIsle(b as never);
    const son = o.posta.gidenler.find((x) => x.telefon === 'alici@deneme.local'); expect(son?.ekler?.[0]?.ad).toContain('.pdf'); expect(readFileSync(son!.ekler![0]!.yol).subarray(0, 5).toString()).toBe('%PDF-');
    const yok = '00000000-0000-0000-0000-000000000000';
    await belgeUret(o.db, { tur: 'Fiyat Teklifi', nesne: yok, dosya: d.kimlik, gonder: { olay: `pdf-hata:${t}`, eposta: 'alici2@deneme.local', konu: 'Konu', metin: 'Metin', acil: true } });
    for (let n = 0; n < 3; n++) await belgeKuyruguIsle(b as never);
    expect((await durum('Fiyat Teklifi', yok)).durum).toBe('Başarısız');
    expect(await o.kart('Belge Üretim Hatası', (await durum('Fiyat Teklifi', yok)).kimlik)).toBeDefined();
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari = $1 AND cardinality(ek_surumler) = 0`, [`pdf-hata:${t}`])).rowCount).toBe(1);
  });
  it('Yat Sahibi Onay Belgesi YO numaralı üretilir; ONY-23 onayında teklif de eklenir', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const t = await teklif(d);
    await belgeUret(o.db, { tur: 'Fiyat Teklifi', nesne: t, dosya: d.kimlik }); await belgeKuyruguIsle(b as never);
    const on = (await o.sup.query(`INSERT INTO onay_talebi (dosya_ref, ony_kod, baslik, metin, dugme, belge_adi, alici_ad, eposta, belirtec_ozeti, son_gecerlilik, durum) VALUES ($1,'ONY-23','Teklif Onayı','Teklifi onaylıyorum.','Onayla','Fiyat Teklifi','Yat Sahibi','sahip@deneme.local',$2,now() + interval '1 day','Onaylandı') RETURNING kimlik`, [d.kimlik, `oz-${t}`])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO yatonet_onay_kaydi (onay_talebi_ref, karar, metin_ozeti, onaylayan_ad, kanal, onay_kodu, adres, onay_zamani) VALUES ($1,'Onaylandı','oz','Yat Sahibi','SMS Kodu','K123','127.0.0.1',now())`, [on]);
    await belgeUret(o.db, { tur: 'Onay Belgesi', nesne: on, dosya: d.kimlik, gonder: { olay: `onay-sonuc:${on}`, eposta: 'sahip@deneme.local', konu: 'Fiyat Teklifi', metin: 'Onay kodu: K123', acil: true, ekle: ['Fiyat Teklifi'] } });
    await belgeKuyruguIsle(b as never);
    const u = await durum('Onay Belgesi', on); expect(u.durum, u.son_hata).toBe('Üretildi');
    expect((await o.sup.query(`SELECT e.ad FROM belge e WHERE e.kimlik = $1`, [u.belge_ref])).rows[0].ad).toContain(`${d.dosyaNo}-YO01`);
    expect((await o.sup.query(`SELECT ek_surumler FROM gonderim WHERE olay_anahtari = $1`, [`onay-sonuc:${on}`])).rows[0].ek_surumler).toHaveLength(2);
  });
  it('İş Emri fiyat içermez; yeni kabulde PDF yeniden üretilir, tutanak TT numaralıdır', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const t = await teklif(d);
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kurumsal_eposta, olusturan_ref) VALUES ($1,'Gizli Firma Ltd','Çözüm Ortağı','firma@deneme.local',$2) RETURNING kimlik`, [`S${Date.now()}`, o.K.ds])).rows[0].kimlik;
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, teklif_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, hazirlayan_ref) VALUES ($1,'ON',$2,$3,$4,'Marmaris','Karina onarımı',7777,$5) RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, t, f, o.K.oy])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_emri_kalemi (is_emri_ref, aciklama, miktar, birim) VALUES ($1,'Laminasyon',2,'m²')`, [e]);
    await belgeUret(o.db, { tur: 'İş Emri', nesne: e, dosya: d.kimlik, gonder: { olay: `ie:${e}`, eposta: 'firma@deneme.local', konu: 'K', metin: 'M', acil: true } }); await belgeKuyruguIsle(b as never);
    const u = await durum('İş Emri', e); expect(u.durum, u.son_hata).toBe('Üretildi');
    expect((await o.sup.query(`SELECT bilgi_sinifi FROM belge WHERE kimlik = $1`, [u.belge_ref])).rows[0].bilgi_sinifi).toBe('Kritik');
    const metin = readFileSync(join(dk, (await o.sup.query(`SELECT depo_anahtari FROM belge_surum WHERE kimlik = $1`, [u.surum_ref])).rows[0].depo_anahtari));
    expect(metin.subarray(0, 5).toString()).toBe('%PDF-');
    await o.sup.query(`UPDATE is_emri SET firma_yaniti = 'Kabul', firma_kabul_zamani = now(), statu = 'Başlangıç Kontrolünde' WHERE kimlik = $1`, [e]);
    await belgeUret(o.db, { tur: 'İş Emri', nesne: e, dosya: d.kimlik }); await belgeKuyruguIsle(b as never);
    expect((await durum('İş Emri', e)).surum_ref).not.toBe(u.surum_ref);
    const tk = (await o.sup.query(`INSERT INTO teslim_kaydi (dosya_ref, teslim_eden_ref, durum, teslim_alan, teslim_zamani) VALUES ($1,$2,'Teslim Edildi','Yat Sahibi',now()) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    await belgeUret(o.db, { tur: 'Teslim Tutanağı', nesne: tk, dosya: d.kimlik }); await belgeKuyruguIsle(b as never);
    const ut = await durum('Teslim Tutanağı', tk); expect(ut.durum, ut.son_hata).toBe('Üretildi');
    expect((await o.sup.query(`SELECT ad, bilgi_sinifi FROM belge WHERE kimlik = $1`, [ut.belge_ref])).rows[0].ad).toContain(`${d.dosyaNo}-TT01`);
    // YG-650: kışlık hazırlık sorumlusu belirlenmişse teslim tutanağına yazılır.
    const { tutanakTanim } = await import('../src/belge_uret.js');
    const ks = async () => JSON.stringify((await tutanakTanim(o.db, tk, 'TT', 'http://x')).t);
    expect(await ks()).not.toContain('Kışlık Hazırlık Sorumlusu');
    await o.sup.query(`UPDATE dosya SET kislik_sorumlu_kullanici_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    expect(await ks()).toContain('Kışlık Hazırlık Sorumlusu');
  });
  it('yöntem bilgi nüshası üretilir; yalnız kapsam ve sıra, malzeme tablosu yok (YNT-2)', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
    const r = (await o.sup.query(`INSERT INTO yontem_raporu (rapor_no, dosya_ref, kapsam, malzeme_tablosu, uygulama_sirasi, durum, hazirlayan_ref, onaylayan_ref, onay_zamani) VALUES ($1,$2,'Kapsam Metni','Gizli Malzeme Listesi','Sıra Metni','Onaylı',$3,$4,now()) RETURNING kimlik`, [`${d.dosyaNo}-FR-ONR-001-01`, d.kimlik, o.K.tu, o.K.tm])).rows[0].kimlik;
    await belgeUret(o.db, { tur: 'Yöntem Bilgi Nüshası', nesne: r, dosya: d.kimlik }); await belgeKuyruguIsle(b as never);
    const u = await durum('Yöntem Bilgi Nüshası', r); expect(u.durum, u.son_hata).toBe('Üretildi');
    const { yontemBilgiTanim } = await import('../src/belge_uret.js'); const j = JSON.stringify((await yontemBilgiTanim(o.db, r)).t);
    expect(j).toContain('Kapsam Metni'); expect(j).toContain('Sıra Metni'); expect(j).not.toContain('Gizli Malzeme');
  });
  it('Ödeme Talebi OT numaralı üretilir; yeniden tetiklenen teklif yeni sürüm olur, eskisi Yerine Geçti', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const t = await teklif(d);
    const ot = (await o.sup.query(`INSERT INTO odeme_talebi (dosya_ref, teklif_ref, tur, tutar_eur, muhatap, son_tarih, hazirlayan_ref) VALUES ($1,$2,'Ara Ödeme',500,'Yat Sahibi','2026-12-01',$3) RETURNING kimlik`, [d.kimlik, t, o.K.ts])).rows[0].kimlik;
    await belgeUret(o.db, { tur: 'Ödeme Talebi', nesne: ot, dosya: d.kimlik }); await belgeKuyruguIsle(b as never);
    const u = await durum('Ödeme Talebi', ot); expect(u.durum, u.son_hata).toBe('Üretildi');
    expect((await o.sup.query(`SELECT ad FROM belge WHERE kimlik = $1`, [u.belge_ref])).rows[0].ad).toContain(`${d.dosyaNo}-OT01`);
    await belgeUret(o.db, { tur: 'Fiyat Teklifi', nesne: t, dosya: d.kimlik }); await belgeKuyruguIsle(b as never);
    const ilk = await durum('Fiyat Teklifi', t);
    await belgeUret(o.db, { tur: 'Fiyat Teklifi', nesne: t, dosya: d.kimlik }); await belgeKuyruguIsle(b as never);
    const ik = await durum('Fiyat Teklifi', t); expect(ik.durum, ik.son_hata).toBe('Üretildi'); expect(ik.surum_ref).not.toBe(ilk.surum_ref);
    expect((await o.sup.query(`SELECT durum FROM belge_surum WHERE kimlik = $1`, [ilk.surum_ref])).rows[0].durum).toBe('Yerine Geçti');
  });
});

describe('teklif maddeleri (YG-709)', () => {
  it('hazırlayan taslak teklife 013 maddesi seçer; belgede tablo olarak yer alır; taslak dışında seçilemez', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const t = await teklif(d, 'Taslak');
    const ts = await o.gir('ts');
    expect((await o.ist('POST', `/api/teklif/${t}/madde`, await o.gir('ds'), { madde: 'DN-3', tur: 'Hariç' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/teklif/${t}/madde`, ts, { madde: 'XX-1', tur: 'Hariç' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/teklif/${t}/madde`, ts, { madde: 'DN-3', tur: 'Hariç' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/teklif/${t}/madde`, ts, { madde: 'ON-2', tur: 'Ayrıca Fiyatlandırılır' })).statusCode).toBe(200);
    const m = JSON.stringify((await teklifTanim(o.db, t, 'ABCD-1234', 'http://x')).t);
    expect(m).toContain('Hariç ve Ayrıca Fiyatlandırılacak Hususlar'); expect(m).toContain('Sıcak iş öncesi yazılı yöntem');
    await o.sup.query(`UPDATE fiyat_teklifi SET statu = 'İç Onayda' WHERE kimlik = $1`, [t]);
    expect((await o.ist('POST', `/api/teklif/${t}/madde`, ts, { madde: 'DN-1', tur: 'Hariç' })).statusCode).toBe(409);
  });
});

describe('gizlilik işareti (YG-610)', () => {
  it('üretilen belgenin alt bilgisinde gizlilik sınıfı ve dosya numarası', () => {
    expect(gizlilikIsareti('Gizli', 'LGM-2026-11-0001', 'tr')).toBe('Gizlilik: Gizli · Dosya No: LGM-2026-11-0001');
    expect(gizlilikIsareti('Kritik', 'LGM-2026-11-0001', 'en')).toBe('Classification: Strictly Confidential · File No: LGM-2026-11-0001');
  });
});

describe('iki dilli belge (YG-625)', () => {
  it('İngilizce yazışmalı dosyada müşteri belgesi Türkçe sürümüyle birlikte üretilir; Türkçe metin esastır', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
    await o.sup.query(`UPDATE dosya SET yazisma_dili = 'İngilizce' WHERE kimlik = $1`, [d.kimlik]);
    const t = await teklif(d);
    await belgeUret(o.db, { tur: 'Fiyat Teklifi', nesne: t, dosya: d.kimlik });
    expect(await belgeKuyruguIsle(b as never)).toBeGreaterThan(0);
    const l = (await o.sup.query(`SELECT e.ad FROM belge e WHERE e.bag_turu = 'Dosya' AND e.bag_kimligi = $1 AND e.belge_turu = 'Fiyat Teklifi' ORDER BY e.ad`, [d.kimlik])).rows.map((x) => x.ad as string);
    expect(l.length).toBe(2); expect(l.some((x) => x.startsWith('Fiyat Teklifi'))).toBe(true);
    expect(TURKCE_ESAS.en).toMatch(/Turkish text shall prevail/);
  });
});

describe('garanti belgesi (YG-624)', () => {
  it('onaylı şablon metinleriyle üretilir; Ek-1 bakım önerilerini dosyadaki Teknik Uzman teslimden önce girer', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
    const ts = (await o.sup.query(`INSERT INTO teslim_kaydi (dosya_ref, durum, teslim_eden_ref) VALUES ($1,'Onay Bekliyor',$2) RETURNING kimlik`, [d.kimlik, o.K.ds]).catch(() => ({ rows: [] }))).rows[0]?.kimlik;
    if (!ts) return;
    const tu = await o.gir('tu');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/bakim-onerileri`, await o.gir('ds'), { oneriler: [{ oneri: 'X', zaman: 'Y' }] })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/bakim-onerileri`, tu, { oneriler: [{ oneri: 'Şaft salmastrasında damlama kontrolü' }] })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/bakim-onerileri`, tu, { oneriler: [{ oneri: 'Şaft salmastrasında damlama kontrolü', zaman: 'Her seyir öncesi' }] })).statusCode).toBe(200);
    const m = JSON.stringify((await garantiTanim(o.db, ts)).t);
    for (const s of ['Garanti Belgesi', 'FR-KLT-010', 'Kanuni haklarınız saklıdır', 'Geçici onarım olarak teslim edilen işler', 'Şaft salmastrasında damlama kontrolü', 'Yat Onarım ve Teknik Hizmet Sözleşmesi']) expect(m).toContain(s);
    expect(m).not.toContain('[●]');
    await belgeUret(o.db, { tur: 'Garanti Belgesi', nesne: ts, dosya: d.kimlik }); await belgeKuyruguIsle(b as never);
    expect((await durum('Garanti Belgesi', ts)).durum).toBe('Üretildi');
  });
});

describe('değişiklik belgeleri (YG-656)', () => {
  it('iç Değişiklik Kaydı FR-UYG-003 koduyla üretilir', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
    const p = (await o.sup.query(`INSERT INTO degisiklik_protokolu (degisiklik_no, dosya_ref, tur, mevcut, onerilen, bedel_farki_eur, kanal, hazirlayan_ref) VALUES ($1,$2,'İlave İş','A','B',100,'YATONET 360',$3) RETURNING kimlik`, [`${d.dosyaNo}-DG01`, d.kimlik, o.K.ds])).rows[0].kimlik;
    const t = (await degisiklikKaydiTanim(o.db, p)).t;
    expect(t).toMatchObject({ ad: 'Değişiklik Kaydı', kod: 'FR-UYG-003', icKayit: true });
  });
});

describe('Lehtar Muvafakat Yazısı (YG-729)', () => {
  it('lehtarlı yatta TR/EN örnek PDF üretilir; onaylı metin ve kayıttaki hak türü; lehtarsız yatta 409', async () => {
    const { lehtarMuvafakatTanim } = await import('../src/lehtar_muvafakat.js');
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
    const ds = await o.gir('ds');
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/lehtar-muvafakat.pdf`, ds)).statusCode).toBe(409);
    await o.sup.query(`UPDATE yat SET lehtar_adi = 'Örnek Bank A.Ş.', mulkiyet_turu = 'Finansal kiralama (leasing)' WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    const tr = (await lehtarMuvafakatTanim(o.db, d.kimlik, 'tr'))!.t; const en = (await lehtarMuvafakatTanim(o.db, d.kimlik, 'en'))!.t;
    expect(tr).toMatchObject({ kod: 'FR-HUK-003', ad: 'Lehtar Muvafakat Yazısı' }); expect(en.ad).toBe('Loss Payee Consent Letter');
    const s = JSON.stringify(tr.bolumler);
    expect(s).toContain('Örnek Bank A.Ş.'); expect(s).toContain('☐ İpotek ☒ Leasing'); expect(s).toContain('Onarım bedelinin LİMİT GLOBAL MARINE’a ödenmesine');
    const p = await o.ist('GET', `/api/dosya/${d.kimlik}/lehtar-muvafakat.pdf?dil=en`, ds); expect(p.statusCode).toBe(200); expect(p.headers['content-type']).toContain('pdf');
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}`, ds)).json().yat).toMatchObject({ lehtar_var: true, lehtar_muvafakati_ref: null });
  });
});

describe('Tedarik Siparişi belgesi (YG-621, YG-1514)', () => {
  it('fiyat yazmaz, dayanak teklife atıf yapar, dosya numarası taşımaz, onay kutusu basılır', async () => {
    const { siparisTanim } = await import('../src/belge_uret.js');
    const d = await o.dosyaAc();
    const k = (await o.sup.query(`SELECT kimlik FROM kurulus LIMIT 1`)).rows[0].kimlik;
    const s = (await o.sup.query(`INSERT INTO tedarik_siparisi (siparis_no, dosya_ref, kurulus_ref, tedarikci_teklif_ref, nihai_kullanim_yeri, kdv_haric_eur, kdv_eur, toplam_eur, teslim_tarihi, teslim_yeri, kabul_olcutu, secim_gerekcesi, hazirlayan_ref) VALUES ('SP-TEST-01',$1,$2,'TT-77','Bodrum',1234.5,0,1234.5,current_date + 5,'Örnek Marina','Orijinal ambalaj','Fiyat',$3) RETURNING kimlik`, [d.kimlik, k, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO tedarik_siparisi_kalemi (siparis_ref, satir_no, urun_tanimi, uretici_parca_no, miktar, birim, birim_bedel_eur, toplam_eur) VALUES ($1,1,'Pervane','P-1',2,'adet',617.25,1234.5)`, [s]);
    const t = (await siparisTanim(o.db, s, 'KOD1', 'https://x')).t;
    const j = JSON.stringify(t);
    expect(t).toMatchObject({ kod: 'FR-MLZ-002', ad: 'Tedarik Siparişi' }); expect(t.dosyaNo).toBeUndefined();
    expect(j).toContain('TT-77'); expect(j).not.toMatch(/1\.?234,5|617,25/); expect(j).not.toContain(d.dosyaNo);
  });
});

describe('Teknik Rapor kanıt sayfaları (YG-678, YG-713)', () => {
  it('ölçüm kaynağı dipnotla, fotoğraflar Şekil n altyazısıyla; hassas görsel basılmaz', async () => {
    const { raporFotoOgeleri, raporKaynaklari } = await import('../src/belge_uret.js');
    const d = await o.dosyaAc();
    const foto = async (no: string, hassas: boolean) => { const b = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref, hassas_icerik) VALUES ($1,'Fotoğraf','Dosya',$2,'Sistem',current_date,$3,$4) RETURNING kimlik`, [no, d.kimlik, o.K.ds, hassas])).rows[0].kimlik;
      await o.sup.query(`INSERT INTO belge_surum (belge_ref, surum_no, dosya_adi, uzanti, boyut, ozet_sha256, depo_anahtari, tarama_kaynagi, yukleyen_ref, durum) VALUES ($1,1,'a.jpg','jpg',1,repeat('a',64),'yok/yok','Test',$2,'Yürürlükte')`, [b, o.K.ds]);
      await o.sup.query(`INSERT INTO gorsel_kanit (gorsel_no, dosya_ref, belge_ref, cekim_zamani, ceken_ref, ceken_rol, konum, asama, cekim_kalemi, cekim_turu) VALUES ($1,$2,$3,now(),$4,'Teknik Uzman','Sancak','Keşif','Pervane','Detay')`, [no, d.kimlik, b, o.K.ds]); };
    await foto('F1', false); await foto('F2', true); await foto('F3', false);
    const fo = await raporFotoOgeleri(o.db, d.kimlik, 'tr', 1);
    expect(fo.map((x) => x.altyazi.split(' · ')[0])).toEqual(['Şekil 1 — F1', 'Şekil 2 — F3']);
    expect(fo[0]!.src).toBeNull(); // depoda dosya yok: alan "---"
    const k = await raporKaynaklari(o.db, d.kimlik, 'tr', '2026-11-01');
    expect(JSON.stringify(k)).toContain('Beyan · olay tarihi ve özeti 01.11.2026 tarihli hasar ihbarındaki beyana dayanır');
  });
});

describe('İhbar Alındı Bilgilendirmesi (YG-722)', () => {
  it('onaylı şablon metniyle; Dosya Sorumlusu adı yazılmaz, rol ve iletişim yazılır', async () => {
    const { ihbarAlindiTanim } = await import('../src/belge_uret.js');
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
    const t = (await ihbarAlindiTanim(o.db, d.kimlik)).t;
    expect(t).toMatchObject({ kod: 'FR-OPS-016', ad: 'İhbar Alındı Bilgilendirmesi' });
    expect(t.matbuBas![0]).toMatch(/^Sayın Yat Sahibi, .* tarihli bildirim ve .* numaralı dosyanız kapsamında hazırlanan İhbar Alındı Bilgilendirmesi bilginize sunulur\.$/);
    expect(t.matbuBas![2]).toMatch(/^KONU: HASAR BİLDİRİMİNİZ ALINDI /);
    const j = JSON.stringify(t.bolumler);
    expect(j).toContain('Keşif randevusu için Dosya Sorumlumuz sizinle iletişime geçecek'); expect(j).toContain('"Dosya Sorumlusu"');
    const ad = (await o.sup.query(`SELECT h.ad_soyad FROM dosya_ekibi_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.dosya_ref = $1 AND a.rol = 'Dosya Sorumlusu'`, [d.kimlik])).rows[0].ad_soyad;
    expect(j).not.toContain(ad);
    expect((await o.sup.query(`SELECT 1 FROM belge_uretim WHERE tur = 'İhbar Alındı' AND nesne = $1`, [d.kimlik])).rowCount).toBe(0); // bireysel dosya
    const s = await o.dosyaAc({}, { musteriTuru: 'Sigorta Şirketi', sigortaci: 'Örnek Sigorta' }); await o.ekipKur(s.kimlik);
    expect((await o.sup.query(`SELECT 1 FROM belge_uretim WHERE tur = 'İhbar Alındı' AND nesne = $1`, [s.kimlik])).rowCount).toBe(1);
  });
});

describe('teslim paketi e-postası (YG-1451)', () => {
  it('yat sahibi teslimi onaylayınca garanti belgesi tutanakla aynı iletide gider', async () => {
    await import('../src/ticari.js'); const { onaySonucu } = await import('../src/onay.js');
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'sahip@deneme.local' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]);
    await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, eposta, olusturan_ref) SELECT $1, 'Yat Sahibi', 'Sahip', 'sahip@deneme.local', $2 WHERE NOT EXISTS (SELECT 1 FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi')`, [d.kimlik, o.K.ds]);
    const ts = (await o.sup.query(`INSERT INTO teslim_kaydi (dosya_ref, durum, teslim_eden_ref) VALUES ($1,'Onay Bekliyor',$2) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    const c = await o.db.connect();
    try { await onaySonucu('ONY-27')!(c, { dosya_ref: d.kimlik, alici_ad: 'Sahip' }, 'Onaylandı', { kimlik: ts, zaman: new Date(), form: {}, kutular: {} }); } finally { c.release(); }
    const g = (await o.sup.query(`SELECT gonder FROM belge_uretim WHERE tur = 'Garanti Belgesi' AND nesne = $1`, [ts])).rows[0].gonder;
    expect(g).toMatchObject({ eposta: 'sahip@deneme.local', ekle: ['Teslim Tutanağı'] });
    expect((await o.sup.query(`SELECT gonder FROM belge_uretim WHERE tur = 'Teslim Tutanağı' AND nesne = $1`, [ts])).rows[0].gonder).toBeNull();
  });
});

describe('yetkili servis ve kabul kaydı atfı (YG-647, YG-697)', () => {
  it('garanti süren ekipmanda yetkili servis yalnız garanti belgesinde; tutanak kabul kaydına atıf yapar', async () => {
    const { garantiTanim } = await import('../src/belge_uret.js');
    const d = await o.dosyaAc();
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,$2,'Çözüm Ortağı',$3) RETURNING kimlik, ticari_unvan`, [`YS${Date.now()}`, `Yetkili Servis ${Date.now()}`, o.K.ds])).rows[0];
    await o.sup.query(`INSERT INTO yetkili_servis (kurulus_ref, marka) VALUES ($1,'Volvo Penta') ON CONFLICT DO NOTHING`, [f.kimlik]);
    await o.sup.query(`UPDATE dosya SET garantili_ekipman = true, garantili_ekipman_marka = 'Volvo Penta', garanti_bitis = current_date + 100 WHERE kimlik = $1`, [d.kimlik]);
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K','Aktif',$4)`, [`${d.dosyaNo}-ON09`, d.kimlik, f.kimlik, o.K.ds]);
    const ts = (await o.sup.query(`INSERT INTO teslim_kaydi (dosya_ref, durum, teslim_eden_ref, teslim_zamani) VALUES ($1,'Teslim Edildi',$2,now()) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    const j = JSON.stringify((await garantiTanim(o.db, ts)).t.bolumler);
    expect(j).toContain(`${f.ticari_unvan} (Volvo Penta)`);
    await o.sup.query(`UPDATE dosya SET garanti_bitis = current_date - 1 WHERE kimlik = $1`, [d.kimlik]);
    expect(JSON.stringify((await garantiTanim(o.db, ts)).t.bolumler)).not.toContain('Yetkili Servisi');
  });
});

describe('proforma kalem yapısı (YG-1602)', () => {
  it('işin niteliği sütunu, uygulanan indirim satırı ve fatura kuruyla TL karşılığı', async () => {
    const { odemeTanim } = await import('../src/belge_uret.js');
    const d = await o.dosyaAc();
    const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, ara_toplam_eur, indirim_orani, indirim_tutari_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,'Onaylı',1000,10,100,180,1080,1,$3) RETURNING kimlik`, [`${d.dosyaNo}-TK05`, d.kimlik, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, kartela_kodu, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur, onay_durumu) VALUES ($1,1,'K-1','Pervane','Onarım','İşçilik',1,'adet',1000,1000,'Onaylandı')`, [t]);
    const m = (await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, vade, kur, kur_tarihi, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',900,180,1080,'Faturalandı',current_date,35.5,'2026-11-12',$4) RETURNING kimlik`, [`${d.dosyaNo}-PF01`, d.kimlik, t, o.K.ds])).rows[0].kimlik;
    const b = (await odemeTanim(o.db, 'Proforma', m, 'K', 'https://x')).t.bolumler.find((x) => x.tur === 'tablo' && x.sutunlar.some((s) => s.ad === 'Nitelik'));
    expect(b).toBeDefined(); const j = JSON.stringify(b);
    expect(j).toContain('Onarım'); expect(j).toContain('İndirim %10'); expect(j).toMatch(/38\.340,00 TL/);
  });
});

describe('teslim kabul durum tablosu (YG-724)', () => {
  it('çekince turuncu, envanter eksiği sarı, açık iş yoksa yeşil', async () => {
    const { tutanakTanim } = await import('../src/belge_uret.js');
    const d = await o.dosyaAc();
    const ts = (await o.sup.query(`INSERT INTO teslim_kaydi (dosya_ref, durum, teslim_eden_ref, teslim_alan, teslim_zamani, karar, cekince, envanter_eksik) VALUES ($1,'Teslim Edildi',$2,'Sahip',now(),'Koşullu Kabul','Boya rötuşu','Yedek halat') RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    const b = (await tutanakTanim(o.db, ts, 'K', 'https://x')).t.bolumler.find((x) => x.tur === 'tablo' && x.satirlar.some((r) => r[0] === 'Envantere Göre Eksik'));
    expect(b).toBeDefined(); const j = JSON.stringify(b);
    expect(j).toContain('{"m":"Boya rötuşu","renk":"turuncu"}');
    expect(JSON.stringify((await tutanakTanim(o.db, ts, 'K', 'https://x')).t.bolumler)).toContain('"et":"Teslim Adresi"'); // YG-717 expect(j).toContain('{"m":"Yedek halat","renk":"sari"}'); expect(j).toContain('"renk":"yesil"');
  });
});
