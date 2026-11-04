import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kapsam6502, kosulEngeli, mutabakatIsle, otomatikKabulKontrolu, sigortaBildirimEngeli, yurtDisiAvans } from '../src/onay_ek.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', mfm: 'Muhasebe ve Finans Müdürü', tid: 'Ticari İşler Direktörü', gmy: 'Genel Müdür Yardımcısı', hud: 'Hukuk ve Uyum Direktörü' };
let o: Ortam; let say = 0;
const dosya = async () => { const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref <> $1 AND bitis_zamani IS NULL`, [d.kimlik]); return d; };
const sigortali = async (ad = 'Sigorta A') => { const d = await dosya(); await o.sup.query(`UPDATE dosya SET dosya_niteligi = 'Sigorta bağlantılı', musteri_turu = 'Sigorta Şirketi' WHERE kimlik = $1`, [d.kimlik]); await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi, olusturan_ref) VALUES ($1,$2,$3) ON CONFLICT (dosya_ref) DO UPDATE SET sigortaci_adi = EXCLUDED.sigortaci_adi`, [d.kimlik, ad, o.K.ds]); return d; };
const teklif = async (d: { kimlik: string; dosyaNo: string }, g: { muhatap?: string; karar?: string; statu?: string; kalem?: [string, number, string][] } = {}) => {
  const kl = g.kalem ?? [['Malzeme', 1000, 'Onaylandı']]; const top = kl.reduce((a, k) => a + k[1], 0);
  const c = (await o.sup.query(`INSERT INTO kapsam_cetveli (dosya_ref, surum, durum, hazirlayan_ref) VALUES ($1,$2,'Onaylı',$3) RETURNING kimlik`, [d.kimlik, ++say, o.K.tu])).rows[0].kimlik;
  const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, cetvel_ref, teklif_muhatabi, kdv_orani, statu, karar, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, hazirlayan_ref) VALUES ($1,$2,$3,$4,20,$5,$6,$7,0,$7,$8) RETURNING kimlik`, [`${d.dosyaNo}-T${say}`, d.kimlik, c, g.muhatap ?? 'Sigorta Şirketi', g.statu ?? 'Karar', g.karar ?? 'Kısmi Onay', top, o.K.ts])).rows[0].kimlik as string;
  let n = 0; for (const [bt, tu, du] of kl) await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur, onay_durumu) VALUES ($1,$2,'K','Onarım',$3,1,'adet',$4,$4,$5)`, [t, ++n, bt, tu, du]);
  return t;
};
const belge = async (d: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'K','Gizli','Dosya',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`B-${Math.random()}`, d, o.K.ds])).rows[0].kimlik as string;

beforeAll(async () => { o = await ortamKur('yatonet360_test40', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('sigorta (YG-450, YG-449, YG-062, YG-454)', () => {
  it('hasar no sonradan girilir', async () => {
    const d = await sigortali(); const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/hasar-no`, ds, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/hasar-no`, ds, { no: 'H-77' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT sigorta_hasar_dosya_no n FROM dosya_sigorta_kaydi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].n).toBe('H-77');
  });
  it('LGM kullanıcısı YATONET 360 kanalıyla belgesiz sigorta onayı giremez', async () => {
    const d = await sigortali(); const t = await teklif(d, { statu: 'Gönderildi', karar: undefined });
    const r = await o.ist('POST', `/api/teklif/${t}/sigorta-karar`, await o.gir('ds'), { karar: 'Tam Onay', kanal: 'YATONET 360', yetkili: 'Y' }); expect(r.statusCode).toBe(400); expect(r.json().hata).toContain('yazılı');
  });
  it('süre dolumuyla kabul geri alınır; iş emri varsa alınmaz; kontrol görevi açılır', async () => {
    const d = await sigortali(); const t = await teklif(d, { karar: 'Tam Onay' }); const u = `/api/teklif/${t}/otomatik-kabul-geri`;
    expect((await o.ist('POST', u, await o.gir('tid'), { gerekce: 'G' })).json().hata).toContain('süre dolumuyla');
    await o.sup.query(`INSERT INTO sigorta_onayi (dosya_ref, teklif_ref, karar, onaylanan_tutar_eur, onay_kanali, onay_tarihi, onaylayan_yetkili, kaydi_yapan_ref) VALUES ($1,$2,'Tam Onay',1000,'Çerçeve Sözleşme Süresi',now(),'S',$3)`, [d.kimlik, t, o.K.ts]);
    await otomatikKabulKontrolu(o.db, { kimlik: t, teklif_no: 'T', dosya_ref: d.kimlik }, o.K.ds!);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Otomatik Kabul Kontrolü' AND nesne_kimligi = $1`, [t])).rowCount).toBe(1);
    expect((await o.ist('POST', u, await o.gir('ds'), { gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('tid'), { gerekce: 'Yanlış tarih' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT statu, karar FROM fiyat_teklifi WHERE kimlik = $1`, [t])).rows[0]).toEqual({ statu: 'Gönderildi', karar: null });
  });
  it('çelişen bulgu sigortaya bildirilmeden kapı kapalı', async () => {
    const d = await sigortali(); expect(await sigortaBildirimEngeli(o.db, d.kimlik)).toBeNull();
    const bu = (await o.sup.query(`INSERT INTO bulgu (bulgu_no, dosya_ref, konum_referansi, aciklama, bulgu_etiketi, bilgi_turu, hasar_onem_derecesi, yonlendirme, yonlendirme_sorumlu_ref, yonlendirme_hedef_tarihi, beyanla_celisen, olusturan_ref) VALUES ($1,$2,'K','A','Hasar','İlk Gözlem','Kritik','Onarım',$3,'2099-01-01',true,$3) RETURNING kimlik`, [`B-${d.dosyaNo}`, d.kimlik, o.K.tu])).rows[0].kimlik;
    expect(await sigortaBildirimEngeli(o.db, d.kimlik)).toContain('bildirim');
    expect((await o.ist('POST', `/api/bulgu/${bu}/sigorta-bildirimi`, await o.gir('ds'), {})).statusCode).toBe(200);
    expect(await sigortaBildirimEngeli(o.db, d.kimlik)).toBeNull();
  });
});

describe('ret ve onaylanmayan kalemler (YG-150, YG-206)', () => {
  it('kısmi onayda yalnız onaylanmayan kalemlerden yat sahibine teklif; ikinci kez açılmaz', async () => {
    const d = await sigortali(); const t = await teklif(d, { kalem: [['Malzeme', 700, 'Onaylandı'], ['İşçilik', 300, 'Onaylanmadı']] }); const ts = await o.gir('ts');
    expect((await o.ist('POST', `/api/teklif/${t}/onaylanmayan-teklif`, await o.gir('ds'))).statusCode).toBe(403);
    const r = await o.ist('POST', `/api/teklif/${t}/onaylanmayan-teklif`, ts); expect(r.statusCode, r.body).toBe(200); expect(r.json().tutar).toBe(300);
    expect((await o.sup.query(`SELECT teklif_muhatabi, genel_toplam_eur FROM fiyat_teklifi WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ teklif_muhatabi: 'Yat Sahibi', genel_toplam_eur: '360.00' });
    expect((await o.sup.query(`SELECT count(*)::int n FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t])).rows[0].n).toBe(2);
    expect((await o.ist('POST', `/api/teklif/${t}/onaylanmayan-teklif`, ts)).statusCode).toBe(409);
  });
  it('sigorta reddinde üç seçenek', async () => {
    const d = await sigortali(); const t = await teklif(d, { karar: 'Ret', kalem: [['Malzeme', 100, 'Onaylanmadı']] }); const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/teklif/${t}/ret-secenegi`, ds, { secim: 'Bilmem' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/teklif/${t}/ret-secenegi`, ds, { secim: 'Kapanış' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Dosya Kapanışı' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
  });
});

describe('koşullu onay (YG-157)', () => {
  it('açık koşul iş emrini durdurur; kanıtla kapanır; GMY risk kabulü istisna', async () => {
    const d = await dosya(); const t = await teklif(d, { muhatap: 'Yat Sahibi', karar: 'Koşullu Onay' }); const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/teklif/${t}/kosul`, ds, { eylem: 'E' })).statusCode).toBe(400);
    const P = { eylem: 'Klas onayı', sorumlu: o.K.ds, son: '2099-01-01', gerceklesmezse: 'İş başlamaz' };
    const a = await o.ist('POST', `/api/teklif/${t}/kosul`, ds, P); expect(a.statusCode, a.body).toBe(200);
    expect(await kosulEngeli(o.db, d.kimlik, 'ON')).toContain('Koşullu'); expect(await kosulEngeli(o.db, d.kimlik, 'KN')).toBeNull();
    expect((await o.ist('POST', `/api/teklif-kosulu/${a.json().kimlik}/kapat`, ds, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/teklif-kosulu/${a.json().kimlik}/kapat`, ds, { belge: await belge(d.kimlik) })).statusCode).toBe(200);
    expect(await kosulEngeli(o.db, d.kimlik, 'ON')).toBeNull();
    const b = await o.ist('POST', `/api/teklif/${t}/kosul`, ds, P);
    expect((await o.ist('POST', `/api/teklif-kosulu/${b.json().kimlik}/risk-kabulu`, ds, { gerekce: 'Acil' })).statusCode).toBe(200);
    const k = await o.kart('Koşul Risk Kabulü', b.json().kimlik); expect((await o.karar(k.kimlik, 'gmy', 'Onayla')).statusCode).toBe(200);
    expect(await kosulEngeli(o.db, d.kimlik, 'ON')).toBeNull();
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/kosullar`, ds)).json()).toHaveLength(2);
  });
});

describe('kesin teslim, protokol, yurt dışı, 6502', () => {
  it('YG-215: kesin tarih GMY onayına gider', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kesin-teslim`, ds, { tarih: '2099-01-01' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kesin-teslim`, ds, { tarih: '2099-01-01', gecikmeBedeli: 100 })).statusCode).toBe(200);
    const k = await o.kart('Kesin Teslim Tarihi', d.kimlik); await o.karar(k.kimlik, 'gmy', 'Onayla');
    expect((await o.sup.query(`SELECT kesin_teslim_durumu FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].kesin_teslim_durumu).toBe('Onaylandı');
  });
  it('YG-225: e-imzada belge zorunlu; sigorta alındı tarihli; YATONET kanalı ONY-05 açar', async () => {
    const d = await dosya(); const ds = await o.gir('ds'); await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'd@p.local' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]); const u = `/api/dosya/${d.kimlik}/degisiklik`; const P = { tur: 'İlave İş', mevcut: 'M', onerilen: 'Ö', bedelFarki: 200, yeniToplam: 1200 };
    expect((await o.ist('POST', u, ds, { ...P, kanal: 'E-imza' })).json().hata).toContain('İmzalı');
    expect((await o.ist('POST', u, ds, { ...P, kanal: 'YATONET 360', sigortaOnayi: 'Alındı' })).json().hata).toContain('tarihini');
    const e = await o.ist('POST', u, ds, { ...P, kanal: 'E-imza', belge: await belge(d.kimlik) }); expect(e.statusCode).toBe(200);
    const r = await o.ist('POST', u, ds, { ...P, kanal: 'YATONET 360', sigortaOnayi: 'Alındı', sigortaTarih: '2026-11-01' }); expect(r.statusCode, r.body).toBe(200);
    const on = (await o.sup.query(`SELECT t.ony_kod, t.metin FROM degisiklik_protokolu p JOIN onay_talebi t ON t.kimlik = p.onay_talebi_ref WHERE p.kimlik = $1`, [r.json().kimlik])).rows[0]; expect(on.ony_kod).toBe('ONY-05'); expect(on.metin).toContain('1.200,00');
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/degisiklikler`, ds)).json().map((x: { durum: string }) => x.durum)).toEqual(['Onaylandı', 'Onay Bekliyor']);
  });
  it('YG-1461: işaret Hukuk görevi açar; avans masraf + kalanın yarısı', async () => {
    const d = await dosya(); const r = await o.ist('POST', `/api/dosya/${d.kimlik}/yurt-disi`, await o.gir('ds'), {}); expect(r.json().uyari).toContain('Genel Müdür');
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Yurt Dışı İzin Kontrolü' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
    const t = await teklif(d, { muhatap: 'Yat Sahibi', kalem: [['Masraf', 200, 'Onaylandı'], ['İşçilik', 800, 'Onaylandı']] }); expect(await yurtDisiAvans(o.db, t, 1000, 50)).toBe(600);
  });
  it('YG-027: 6502 yalnız ticari olmayan gerçek kişi', () => {
    expect(kapsam6502('Bireysel Müşteri', 'Gerçek kişi', 'Özel')).toBe(true);
    expect(kapsam6502('Bireysel Müşteri', 'Tüzel kişi', 'Özel')).toBe(false);
    expect(kapsam6502('Bireysel Müşteri', 'Gerçek kişi', 'Ticari')).toBe(false);
    expect(kapsam6502('Kurumsal Müşteri', 'Gerçek kişi', 'Özel')).toBe(false);
  });
});

describe('mutabakat (YG-456)', () => {
  it('ay sonu kesimi, tek rapor; itiraz edilmeyen mutabık', async () => {
    const d = await sigortali('Mutabık Sigorta'); const t = await teklif(d, { karar: 'Tam Onay' });
    const f = (await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, fatura_no, fatura_tarihi, kur, kur_tarihi, vade, hazirlayan_ref) VALUES ($1,$2,$3,'Sigorta Şirketi',1000,0,1000,'Faturalandı',$4,'2026-10-10',40,'2026-10-09','2026-11-10',$5) RETURNING kimlik`, [`P-${d.dosyaNo}`, d.kimlik, t, `F-${d.dosyaNo}`, o.K.ts])).rows[0].kimlik;
    const s = new Date('2026-11-02T08:00:00Z'); expect(await mutabakatIsle(o.db, s)).toBeGreaterThanOrEqual(1); await mutabakatIsle(o.db, s);
    const r = (await o.sup.query(`SELECT kimlik, kesim_tarihi::text, donem FROM sigorta_mutabakat_raporu WHERE sigortaci_adi = 'Mutabık Sigorta'`)).rows; expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ kesim_tarihi: '2026-10-31', donem: '2026-10' });
    const sat = (await o.sup.query(`SELECT kimlik, acik_bakiye FROM sigorta_mutabakat_satiri WHERE fatura_ref = $1`, [f])).rows[0]; expect(sat.acik_bakiye).toBe('1000.00');
    const tid = await o.gir('tid');
    expect((await o.ist('POST', `/api/mutabakat/${r[0].kimlik}/gonder`, await o.gir('ds'))).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/mutabakat/${r[0].kimlik}/gonder`, tid)).statusCode).toBe(200);
    await o.sup.query(`UPDATE sigorta_mutabakat_raporu SET itiraz_son = '2026-01-01' WHERE kimlik = $1`, [r[0].kimlik]);
    await mutabakatIsle(o.db, new Date('2026-11-25T08:00:00Z'));
    expect((await o.sup.query(`SELECT mutabik FROM sigorta_mutabakat_satiri WHERE kimlik = $1`, [sat.kimlik])).rows[0].mutabik).toBe(true);
  });
});

describe('kod ve onay kaydı (YG-222, YG-161)', () => {
  it('eşik üstü son onayda kod istenir; adımda kanal kalır', async () => {
    const d = await dosya(); await o.sup.query(`UPDATE sistem_parametresi SET deger = 5000 WHERE kod = 'onay_kod_esik_eur'`);
    try {
      const a = (await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, zincir, kademe, tutar_eur, hazirlayan_ref, nesne_turu, nesne_kimligi) SELECT 'Deneme','onay','D',ARRAY[kimlik],0,5000.01,$1,'Dosya',$2 FROM rol WHERE rol_adi = 'Genel Müdür Yardımcısı' RETURNING kimlik`, [o.K.ts, d.kimlik])).rows[0].kimlik;
      const r = await o.karar(a, 'gmy', 'Onayla'); expect(r.statusCode).toBe(401); expect(r.json().kodGerekli).toBe(true);
    } finally { await o.sup.query(`UPDATE sistem_parametresi SET deger = NULL WHERE kod = 'onay_kod_esik_eur'`); }
  });
});
