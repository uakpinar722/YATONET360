import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ilaveIsYetkiEngeli, teslimIsle, yabanciBayrakEngeli } from '../src/teslim_ek.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)' };
let o: Ortam;
const dosya = async () => { const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref <> $1 AND bitis_zamani IS NULL`, [d.kimlik]); await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'sahip@teslim.local', telefon = '05000000001' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]); return d; };
const belge = async (d: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'K','Gizli','Dosya',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`B-${Math.random()}`, d, o.K.ds])).rows[0].kimlik as string;

beforeAll(async () => { o = await ortamKur('yatonet360_test42', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('onay ekranları (YG-471, YG-474, YG-472, YG-1500)', () => {
  it('altı varyant onaylı metinle açılır; eksik alan reddedilir', async () => {
    const d = await dosya(); const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/onay-iste`;
    await o.sup.query(`UPDATE dosya SET hiza_kontrol_zamani = now() WHERE kimlik = $1`, [d.kimlik]);
    expect((await o.ist('POST', u, ds, { ony: 'ONY-99' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ony: 'ONY-07' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ony: 'ONY-08', parca: 'P' })).statusCode).toBe(400);
    for (const g of [{ ony: 'ONY-03' }, { ony: 'ONY-06', teklifNo: 'T-1' }, { ony: 'ONY-07', parca: 'Pompa' }, { ony: 'ONY-08', parca: 'Şaft', tutar: 1234.5 }, { ony: 'ONY-09', zaman: '2026-12-01T10:00:00Z' }, { ony: 'ONY-10', kayitNo: 'GK-1' }]) { const r = await o.ist('POST', u, ds, g); expect(r.statusCode, r.body).toBe(200); const m = (await o.sup.query(`SELECT metin FROM onay_talebi WHERE kimlik = $1`, [r.json().kimlik])).rows[0].metin as string; expect(m).not.toMatch(/\[[^\]]+\]/); }
    expect((await o.sup.query(`SELECT metin FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-08'`, [d.kimlik])).rows[0].metin).toContain('1.234,50');
  });
  it('ONY-28 yalnız sigortasız dosyada', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    const r = await o.ist('POST', `/api/acil/${d.kimlik}/ilk-tedbir-talebi`, ds, {}); expect(r.statusCode, r.body).toBe(200);
    await o.sup.query(`UPDATE dosya SET dosya_niteligi = 'Sigorta bağlantılı' WHERE kimlik = $1`, [d.kimlik]);
    expect((await o.ist('POST', `/api/acil/${d.kimlik}/ilk-tedbir-talebi`, ds, {})).statusCode).toBe(409);
  });
});

describe('kapılar (YG-473, YG-099)', () => {
  it('yetkisi doğrulanmamış ihbarda ilave iş açılmaz', async () => {
    const d = await dosya(); expect(await ilaveIsYetkiEngeli(o.db, d.kimlik, 'ON')).toBeNull();
    const t = (await o.sup.query(`SELECT talep_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].talep_ref;
    await o.sup.query(`UPDATE talep SET ihbar_yetki_durumu = 'Bilgi Amaçlı' WHERE kimlik = $1`, [t]);
    expect(await ilaveIsYetkiEngeli(o.db, d.kimlik, 'EK')).toContain('Yetki belgesi');
    await o.sup.query(`UPDATE talep SET ihbar_yetki_durumu = 'Doğrulandı' WHERE kimlik = $1`, [t]);
    expect(await ilaveIsYetkiEngeli(o.db, d.kimlik, 'EK')).toBeNull();
  });
  it('yabancı bayrakta süresi dolmuş belge ve kalış aşımı', async () => {
    const d = await dosya(); const yt = (await o.sup.query(`SELECT yat_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].yat_ref;
    await o.sup.query(`UPDATE yat SET bayrak = 'Malta', yabanci_yat_belge_gecerlilik = '2020-01-01', turkiye_kalis_bitis = '2099-01-01' WHERE kimlik = $1`, [yt]);
    expect(await yabanciBayrakEngeli(o.db, d.kimlik)).toContain('süresi dolmuş');
    await o.sup.query(`UPDATE yat SET yabanci_yat_belge_gecerlilik = '2099-01-01', turkiye_kalis_bitis = '2030-01-01' WHERE kimlik = $1`, [yt]);
    expect(await yabanciBayrakEngeli(o.db, d.kimlik, '2031-01-01')).toContain('kalış');
    expect(await yabanciBayrakEngeli(o.db, d.kimlik, '2029-01-01')).toBeNull();
    await o.sup.query(`UPDATE yat SET bayrak = 'Türkiye', yabanci_yat_belge_gecerlilik = '2020-01-01' WHERE kimlik = $1`, [yt]);
    expect(await yabanciBayrakEngeli(o.db, d.kimlik)).toBeNull();
  });
});

describe('teslim (YG-481, YG-1435, YG-1498, YG-088)', () => {
  it('hazır bildirimi 7 gün; süre geçince BLD-14 ve barınma görevi', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teslime-hazir`, ds, {}); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslime-hazir`, ds, {})).statusCode).toBe(409);
    await teslimIsle(o.db, new Date(Date.now() + 8 * 86_400_000));
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Barınma Gideri' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari LIKE $1`, [`bld14:${d.kimlik}%`])).rowCount).toBeGreaterThan(0);
  });
  it('tek hatırlatma, sonra onaysız teslim; fotoğraf zorunlu', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    await o.sup.query(`INSERT INTO teslim_kaydi (dosya_ref, teslim_eden_ref) VALUES ($1,$2)`, [d.kimlik, o.K.ds]);
    const P = { aliciTuru: 'Marina veya Tersane', alici: 'Marina Görevlisi' };
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-onaysiz`, ds, { ...P, belge: await belge(d.kimlik) })).json().hata).toContain('hatırlatma');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-hatirlat`, ds, {})).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-hatirlat`, ds, {})).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-onaysiz`, ds, P)).json().hata).toContain('fotoğraf');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-onaysiz`, ds, { ...P, belge: await belge(d.kimlik) }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT durum, alici_turu FROM teslim_kaydi WHERE dosya_ref = $1`, [d.kimlik])).rows[0]).toEqual({ durum: 'Teslim Edildi - Onay Verilmedi', alici_turu: 'Marina veya Tersane' });
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari LIKE 'bld49:%'`)).rowCount).toBeGreaterThan(0);
  });
  it('yasal bekleme bitince BLD-50 ve görev; erken ifada yok', async () => {
    const d = await dosya(); const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,'Karar','Tam Onay',$3) RETURNING kimlik`, [`${d.dosyaNo}-T`, d.kimlik, o.K.ts])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis, erken_ifa_onayi) VALUES ($1,$2,now() - interval '20 days',now() - interval '20 days',now() - interval '1 day',false)`, [t, d.kimlik]);
    await teslimIsle(o.db);
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld50:${t}%`])).rows[0].metin as string; expect(m).toContain('Yasal bekleme'); expect(m.toLowerCase()).not.toContain('cayma');
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Çalışmayı Başlat' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
  });
  it('yat kabul tutanağı alanları ve fotoğraf zorunlu; kapanış hesabı', async () => {
    const d = await dosya(); const ds = await o.gir('ds'); const P = { teslimAlan: 'LGM', envanter: 'E', anahtarlar: 'A', sayaclar: 'S', yakit: '%50' };
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yat-kabul`, ds, { ...P, envanter: '' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yat-kabul`, ds, P)).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yat-kabul`, ds, { ...P, belge: await belge(d.kimlik) })).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/kapanis-hesabi`, ds)).json()).toMatchObject({ acikAlacak: 0, firmaBorcu: 0 });
  });
});

describe('sökülen parça (YG-482)', () => {
  it('liste, seçim, 30 gün; geçersiz seçim reddedilir', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/sokulen-parca`, ds, { ad: 'Pompa', konum: 'Makine' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', `/api/sokulen-parca/${r.json().kimlik}/secim`, ds, { secim: 'Sat' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/sokulen-parca/${r.json().kimlik}/secim`, ds, { secim: 'Sigorta Eksperi İncelemesi İçin Bekletme' })).statusCode).toBe(200);
    const l = (await o.ist('GET', `/api/dosya/${d.kimlik}/sokulen-parca`, ds)).json(); expect(l[0].secim).toContain('Eksper');
    expect((new Date(l[0].son_tarih).getTime() - Date.now()) / 86_400_000).toBeGreaterThan(28);
  });
});
