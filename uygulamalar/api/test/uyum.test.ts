import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isEmriUyumOlaylari, sureUyariIsle, uyumEngeli, uyumIsle, uyumOlay } from '../src/uyum.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', hud: 'Hukuk ve Uyum Direktörü', mfm: 'Muhasebe ve Finans Müdürü', tid: 'Ticari İşler Direktörü', sc: 'Sicil Sorumlusu', sy: 'Sistem Yöneticisi', gmy: 'Genel Müdür Yardımcısı', kmd: 'Kalite Müdürü' };
let o: Ortam;
const belge = async (d: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'K','Gizli','Dosya',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`B-${Math.random()}`, d, o.K.ds])).rows[0].kimlik as string;
const ileri = (g: number) => new Date(Date.now() + g * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => { o = await ortamKur('yatonet360_test53', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('uyum kuralları (YG-1545–1548)', () => {
  it('matris yüklü; altı engelleyici', async () => {
    expect(Number((await o.sup.query(`SELECT count(*) n FROM uyum_kurali`)).rows[0].n)).toBe(62);
    expect((await o.sup.query(`SELECT mum_no FROM uyum_kurali WHERE engelleyici ORDER BY mum_no`)).rows.map((r) => r.mum_no)).toEqual(['MUM-031', 'MUM-034', 'MUM-043', 'MUM-047', 'MUM-048', 'MUM-054']);
  });
  it('dalışta kanıt yoksa iş durur, acil beklemez; kanıt ve doğrulama sonrası açılır; kanıtsız kapanmaz', async () => {
    const d = await o.dosyaAc({}, {}); expect(isEmriUyumOlaylari('Sualtı kontrol')).toEqual(['is_emri_dalis']); expect(isEmriUyumOlaylari('Laminasyon')).toEqual([]);
    expect(await uyumEngeli(o.db, 'is_emri_dalis', 'Dosya', d.kimlik, true)).toBeNull();
    expect(await uyumEngeli(o.db, 'is_emri_dalis', 'Dosya', d.kimlik)).toContain('kanıt bekleniyor');
    const g = (await o.sup.query(`SELECT kimlik, sorumlu_rol, dogrulayan_rol FROM uyum_gorevi WHERE nesne = $1 AND mum_no = 'MUM-054'`, [d.kimlik])).rows[0]; expect(g.sorumlu_rol).toBe('Operasyon Müdürü');
    const c = await o.gir('opm');
    expect((await o.ist('POST', `/api/uyum-gorevi/${g.kimlik}/dogrula`, c, {})).json().hata).toMatch(/Kanıt yüklenmeden|Doğrulamayı/);
    expect((await o.ist('POST', `/api/uyum-gorevi/${g.kimlik}/kanit`, await o.gir('ds'), { belge: await belge(d.kimlik) })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/uyum-gorevi/${g.kimlik}/kanit`, c, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/uyum-gorevi/${g.kimlik}/kanit`, c, { belge: await belge(d.kimlik), bitis: '2099-01-01' })).statusCode).toBe(200);
    await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2 ON CONFLICT DO NOTHING`, [o.K.gmy, g.dogrulayan_rol]).catch(() => {});
    expect((await o.ist('POST', `/api/uyum-gorevi/${g.kimlik}/dogrula`, await o.gir('gmy'), {})).json().durum).toBe('Kapalı');
    await o.sup.query(`UPDATE uyum_gorevi SET durum = 'Kapalı' WHERE nesne = $1`, [d.kimlik]);
    expect(await uyumEngeli(o.db, 'is_emri_dalis', 'Dosya', d.kimlik)).toBeNull();
    await o.sup.query(`UPDATE uyum_gorevi SET kanit_bitis = '2020-01-01' WHERE nesne = $1`, [d.kimlik]);
    expect(await uyumEngeli(o.db, 'is_emri_dalis', 'Dosya', d.kimlik)).toContain('kanıt bekleniyor');
  });
  it('iş emri rotası dalışta durur', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ('S-UY','F','Çözüm Ortağı','Onaylı','Aktif',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, await o.gir('oy'), { tur: 'KN', firma: f, yer: 'Y', kapsam: 'Dalış ile sualtı kontrol' }); expect(r.statusCode, r.body).toBe(409); expect(r.json().hata).toContain('kanıt bekleniyor');
  });
  it('olay görev açar, tekrar açmaz; süre geçince yöneticiye ve GMY’ye gider', async () => {
    const d = await o.dosyaAc({}, {}); expect(await uyumOlay(o.db, 'personel_kaydi', 'Personel', d.kimlik)).toBeGreaterThan(0); expect(await uyumOlay(o.db, 'personel_kaydi', 'Personel', d.kimlik)).toBe(0);
    const g = (await o.sup.query(`SELECT kimlik, sorumlu_rol FROM uyum_gorevi WHERE nesne = $1 LIMIT 1`, [d.kimlik])).rows[0]; expect(g.sorumlu_rol).toBe('Muhasebe ve Finans Müdürü');
    await o.sup.query(`UPDATE uyum_gorevi SET son_tarih = current_date - 2 WHERE kimlik = $1`, [g.kimlik]);
    await uyumIsle(o.db);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1 AND kullanici_ref = $2`, [`uyum-gecti:${g.kimlik}`, o.K.gmy])).rowCount).toBe(1);
  });
  it('takvimden görev: muhtasar her ay, oda aidatı haziranda, VERBİS ocakta (YG-1549)', async () => {
    await uyumIsle(o.db, new Date('2027-06-05T10:00:00Z'));
    const a = (await o.sup.query(`SELECT ad FROM uyum_gorevi WHERE nesne = '2027-06'`)).rows.map((r) => r.ad); expect(a).toContain('Aylık muhtasar beyanname'); expect(a).toContain('Oda aidatı');
    await uyumIsle(o.db, new Date('2027-01-05T10:00:00Z')); expect((await o.sup.query(`SELECT ad FROM uyum_gorevi WHERE nesne = '2027-01'`)).rows.map((r) => r.ad)).toContain('VERBİS eşik kontrolü');
  });
});

describe('süre uyarıları (YG-531–533)', () => {
  it('sözleşme, belge, kalibrasyon ve BT varlığı eşiklerde bir kez', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-SR','Süre Firma','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const s = (await o.sup.query(`INSERT INTO sozlesme_kaydi (kurulus_ref, sozlesme_turu, yururluk, bitis, fesih_bildirim_son, durum, kaydeden_ref) VALUES ($1,'Çerçeve','2026-01-01',$2,$3,'Yürürlükte',$4) RETURNING kimlik`, [f, ileri(40), ileri(10), o.K.ds])).rows[0].kimlik;
    const b = (await o.sup.query(`INSERT INTO sicil_belgesi (kurulus_ref, tur, gecerlilik_bitis) VALUES ($1,'SGK',$2) RETURNING kimlik`, [f, ileri(25)])).rows[0].kimlik;
    const c = (await o.sup.query(`INSERT INTO olcum_cihazi (ad, seri_no, kalibrasyon_tarihi, aralik_ay, kaydeden_ref) VALUES ('C','SN-1','2020-01-01',12,$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    expect((await o.ist('POST', '/api/bt-varligi', await o.gir('ds'), { ad: 'L', tur: 'Lisans', bitis: ileri(10) })).statusCode).toBe(403);
    const v = (await o.ist('POST', '/api/bt-varligi', await o.gir('sy'), { ad: 'Lisans A', tur: 'Lisans', bitis: ileri(10) })).json().kimlik;
    await sureUyariIsle(o.db);
    const var0 = async (a: string) => (await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1`, [a])).rowCount;
    expect(await var0(`sozlesme_bitis:${s}:45`)).toBeGreaterThan(0); expect(await var0(`sozlesme_fesih:${s}:15`)).toBeGreaterThan(0); expect(await var0(`sicil_belge:${b}:30`)).toBeGreaterThan(0); expect(await var0(`bt_varligi:${v}:30`)).toBeGreaterThan(0);
    expect((await o.sup.query(`SELECT kabul FROM olcum_cihazi WHERE kimlik = $1`, [c])).rows[0].kabul).toBe(false);
    const adet = Number((await o.sup.query(`SELECT count(*) n FROM bildirim`)).rows[0].n); await sureUyariIsle(o.db); expect(Number((await o.sup.query(`SELECT count(*) n FROM bildirim`)).rows[0].n)).toBe(adet);
  });
});
