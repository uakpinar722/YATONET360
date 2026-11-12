import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { belgeKuyruguIsle, belgeUret, gizlilikIsareti, teklifTanim } from '../src/belge_uret.js';
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
