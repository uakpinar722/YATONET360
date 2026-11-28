import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kartAc } from '../src/is_motoru.js';
import { MESLEKI, onaySureIsle, sureAdimi } from '../src/onay_sure.js';
import { raporEngeli, raporSonZamani } from '../src/rapor.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tmy: 'Teknik Müdür Yardımcısı', tm: 'Teknik Müdür', mfm: 'Muhasebe ve Finans Müdürü', tid: 'Ticari İşler Direktörü', gmy: 'Genel Müdür Yardımcısı', ic: 'İç Denetçi' };
let o: Ortam;
const rol = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
const kart = async (x: { tur?: string; oncelik?: string; zincir: string[]; simdi?: Date }) => { const z = []; for (const r of x.zincir) z.push(await rol(r)); return kartAc(o.db, { tur: x.tur ?? 'Deneme', baslik: `K${Math.random()}`, oncelik: x.oncelik ?? 'Normal', hazirlayan: o.K.ds, zincir: z, simdi: x.simdi }); };
const yas = (id: string, dk: number) => o.sup.query(`UPDATE is_karti SET kademe_zamani = now() - make_interval(mins => $2) WHERE kimlik = $1`, [id, dk]);
const satir = async (id: string) => (await o.sup.query(`SELECT kademe, zincir, durum FROM is_karti WHERE kimlik = $1`, [id])).rows[0];
const R = { kapsam: 'K', incelenen: 'İ', saha: 'S', yontem: 'Y', bulgular: 'B', acikSorular: 'A', analiz: 'N', oneriler: 'Ö', uzmanlik: 'U', ekInceleme: 'Hayır', beyanUyum: 'Uyumlu' };

beforeAll(async () => { o = await ortamKur('yatonet360_test21', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('onay süreleri (YG-172)', () => {
  it('adım sınırları', () => {
    expect([sureAdimi('Normal', 209, 240), sureAdimi('Normal', 210, 240), sureAdimi('Normal', 240, 240), sureAdimi('Normal', 299, 240), sureAdimi('Normal', 300, 240)]).toEqual([null, 'Uyarı', 'Süre Doldu', 'Süre Doldu', 'Üst Kademeye Geçti']);
    expect([sureAdimi('Kritik', 19, 30), sureAdimi('Kritik', 20, 30), sureAdimi('Kritik', 90, 30)]).toEqual([null, 'Uyarı', 'Üst Kademeye Geçti']);
  });
  it('ara kademede 1 saat aşımda sonrakine geçer, bir kez; son makamda üst makam eklenir; mesleki geçmez; CEO geçmez', async () => {
    const a = await kart({ zincir: ['Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü'] });
    await yas(a, 215); await onaySureIsle(o.db); expect((await satir(a)).kademe).toBe(0);
    await yas(a, 301); await onaySureIsle(o.db); await onaySureIsle(o.db);
    const s = await satir(a); expect(s.kademe).toBe(1); expect(s.zincir).toHaveLength(2);
    expect((await o.sup.query(`SELECT count(*)::int n FROM kart_sure_kaydi WHERE is_ref = $1`, [a])).rows[0].n).toBeGreaterThanOrEqual(3);
    // YG-536 (T-YG536): beklenen eylem yazılır; kart kapanınca kapanış sonucu düşer
    expect((await o.sup.query(`SELECT count(*)::int n FROM kart_sure_kaydi WHERE is_ref = $1 AND beklenen_eylem IS NULL`, [a])).rows[0].n).toBe(0);
    { const k2 = (await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, sahip_kullanici_ref) VALUES ('Deneme','gorev','Eskalasyon Deneme',$1) RETURNING kimlik`, [o.K[Object.keys(o.K)[0]!]])).rows[0].kimlik;
      await o.sup.query(`INSERT INTO kart_sure_kaydi (is_ref, kademe, adim, beklenen_eylem) VALUES ($1,0,'Uyarı','X')`, [k2]);
      await o.sup.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE kimlik = $1`, [k2]);
      expect((await o.sup.query(`SELECT kapanis_sonucu FROM kart_sure_kaydi WHERE is_ref = $1`, [k2])).rows[0].kapanis_sonucu).toBe('Tamamlandı'); }
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti_adim WHERE is_ref = $1 AND karar = 'Süre Aşımıyla Geçti'`, [a])).rows[0].n).toBe(1);
    await yas(a, 301); await onaySureIsle(o.db);
    const s2 = await satir(a); expect(s2.kademe).toBe(2); expect(s2.zincir).toHaveLength(3); expect(s2.zincir[2]).toBe(await rol('Genel Müdür Yardımcısı'));
    const m = await kart({ tur: [...MESLEKI][0], zincir: ['Teknik Yönetici', 'Teknik Müdür'] });
    await yas(m, 301); await onaySureIsle(o.db); expect((await satir(m)).kademe).toBe(0);
    const c = await kart({ zincir: ['CEO'] });
    await yas(c, 301); await onaySureIsle(o.db); const sc = await satir(c); expect(sc.kademe).toBe(0); expect(sc.zincir).toHaveLength(1);
  });
});
describe('kademe atlama ve geri çekme (YG-167, YG-169, YG-228)', () => {
  it('Direktör gerekçeyle doğrudan onaylar; ara rol ve hazırlayan atlayamaz; mesleki atlanamaz', async () => {
    const a = await kart({ zincir: ['Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü'] });
    expect((await o.karar(a, 'tid', 'Kademe Atla')).statusCode).toBe(400);
    expect((await o.karar(a, 'ic', 'Kademe Atla', 'G')).statusCode).toBe(403);
    expect((await o.karar(a, 'ds', 'Kademe Atla', 'G')).statusCode).toBe(403);
    const r = await o.karar(a, 'tid', 'Kademe Atla', 'Acil');
    expect(r.statusCode, r.body).toBe(200); expect(r.json().durum).toBe('Onaylandı');
    const m = await kart({ tur: 'Kapsam Cetveli', zincir: ['Teknik Yönetici', 'Ticari İşler Direktörü'] });
    expect((await o.karar(m, 'tid', 'Kademe Atla', 'G')).statusCode).toBe(403);
    const z = await kart({ zincir: ['Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü', 'CEO'] });
    const b = await o.karar(z, 'tid', 'Kademe Atla', 'G'); expect(b.json()).toMatchObject({ durum: 'Bekliyor', kademe: 2 });
    const g = await kart({ zincir: ['Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü'] });
    expect((await o.karar(g, 'gmy', 'Kademe Atla', 'G')).json().durum).toBe('Onaylandı');
  });
  it('iade edileni hazırlayan geri çeker', async () => {
    const a = await kart({ zincir: ['Muhasebe ve Finans Müdürü'] });
    expect((await o.karar(a, 'ds', 'Geri Çek')).statusCode).toBe(403);
    await o.karar(a, 'mfm', 'Gerekçeyle İade Et', 'Eksik');
    expect((await o.karar(a, 'tu', 'Geri Çek')).statusCode).toBe(403);
    expect((await o.karar(a, 'ds', 'Geri Çek')).json().durum).toBe('Geri Çekildi');
  });
  it('mesai dışı Kritikte doğrudan son makam; mesai içinde sıradan; mesleki değil', async () => {
    const G = new Date('2026-11-04T22:00:00+03:00'); const M = new Date('2026-11-04T10:00:00+03:00'); const Z = ['Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü'];
    expect((await satir(await kart({ oncelik: 'Kritik', zincir: Z, simdi: G }))).kademe).toBe(1);
    expect((await satir(await kart({ oncelik: 'Kritik', zincir: Z, simdi: M }))).kademe).toBe(0);
    expect((await satir(await kart({ oncelik: 'Normal', zincir: Z, simdi: G }))).kademe).toBe(0);
    expect((await satir(await kart({ tur: 'Teknik Rapor', oncelik: 'Kritik', zincir: ['Teknik Yönetici', 'Teknik Müdür'], simdi: G }))).kademe).toBe(0);
  });
});
describe('teknik rapor (YG-200, YG-280, YG-428, YG-1518)', () => {
  it('son zaman önceliğe göre; TY kontrolüyle teklif kapısı açılır; Teknik Müdür kontrolden önce onaylayamaz; düzeltme izlenir', async () => {
    expect((await raporSonZamani(o.db, 'Yüksek', new Date('2026-01-01T00:00:00Z'))).toISOString()).toBe('2026-01-03T00:00:00.000Z');
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); await o.sup.query(`DELETE FROM teknik_rapor WHERE dosya_ref = $1`, [d.kimlik]);
    expect(await raporEngeli(o.db, d.kimlik)).toContain('Teknik Rapor');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, await o.gir('ds'), R)).statusCode).toBe(403);
    const tu = await o.gir('tu');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, tu, { ...R, kapsam: '' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, tu, { ...R, ekInceleme: undefined })).json().hata).toMatch(/ek inceleme/i); // YG-714
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, tu, { ...R, ekInceleme: 'Evet' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, tu, { ...R, beyanUyum: undefined })).json().hata).toMatch(/Beyan–bulgu/); // YG-712
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, tu, { ...R, beyanUyum: 'Uyumsuz' })).json().hata).toMatch(/açıklamasını/);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, tu, R);
    expect(r.statusCode, r.body).toBe(200); expect(r.json().raporNo).toBe(`${d.dosyaNo}-TR01`);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, tu, R)).statusCode).toBe(409);
    expect(await raporEngeli(o.db, d.kimlik)).toContain('Teknik Rapor');
    const k = await o.kart('Teknik Rapor', r.json().kimlik);
    expect(k.zincir).toHaveLength(3);
    expect((await o.ist('GET', '/api/raporlarim', tu)).json().find((x: { kimlik: string }) => x.kimlik === r.json().kimlik).durum).toBe('Teknik Yönetici Kontrolünde'); // T-YG1585
    expect((await o.karar(k.kimlik, 'tm', 'Onayla')).statusCode).toBe(403);
    await o.karar(k.kimlik, 'ty', 'Onaya Gönder');
    expect(await raporEngeli(o.db, d.kimlik)).toBeNull();
    await o.karar(k.kimlik, 'tmy', 'Onaya Gönder');
    expect((await o.karar(k.kimlik, 'tm', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM teknik_rapor WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('Onaylı');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, tu, R)).json().hata).toContain('Onaylı rapor değiştirilmez'); // YG-711
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-rapor`, tu, { ...R, tur: 'Ek Teknik Rapor' })).json().raporNo).toBe(`${d.dosyaNo}-TR02`);
    const e = await o.dosyaAc(); await o.ekipKur(e.kimlik); await o.sup.query(`DELETE FROM teknik_rapor WHERE dosya_ref = $1`, [e.kimlik]);
    expect((await o.ist('POST', `/api/dosya/${e.kimlik}/teknik-rapor`, tu, { ...R, tur: 'Ek Teknik Rapor' })).statusCode).toBe(409);
    // YG-711: onaylı rapor değişmez; reddedilen raporun yerine yazılan rapor yeni sürümdür, nedeni listeden seçilir
    const r1 = (await o.ist('POST', `/api/dosya/${e.kimlik}/teknik-rapor`, tu, R)).json().kimlik; await o.sup.query(`UPDATE teknik_rapor SET durum = 'Reddedildi' WHERE kimlik = $1`, [r1]);
    expect((await o.ist('POST', `/api/dosya/${e.kimlik}/teknik-rapor`, tu, R)).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${e.kimlik}/teknik-rapor`, tu, { ...R, revizyonNedeni: 'Taraf talebi', revizyonAciklamasi: 'X' })).statusCode).toBe(400);
    const r2 = await o.ist('POST', `/api/dosya/${e.kimlik}/teknik-rapor`, tu, { ...R, revizyonNedeni: 'Yeni teknik bulgu', revizyonAciklamasi: 'Ek ölçüm' }); expect(r2.statusCode, r2.body).toBe(200);
    expect((await o.sup.query(`SELECT surum, onceki_surum_ref::text o FROM teknik_rapor WHERE kimlik = $1`, [r2.json().kimlik])).rows[0]).toEqual({ surum: 2, o: r1 });
    expect((await o.sup.query(`SELECT 1 FROM denetim_izi WHERE eylem = 'Teknik Rapor Revizyonu' AND nesne_kimligi = $1`, [r2.json().kimlik])).rowCount).toBe(1);
  });
});
describe('kart önerisi (YG-188)', () => {
  it('Teknik Uzman önerir, TİD onaylayınca kartelaya eklenir', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const K = { ana: 'Acil', alt: 'Acil arıza ve hasar müdahalesi', tali: 'Çağrı sınıflandırması ve sevk', islem: 'Yeni işlem', birim: 'adet', maliyet: 10, gerekce: 'G' };
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kart-onerisi`, await o.gir('ds'), K)).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kart-onerisi`, await o.gir('tu'), { ...K, tali: 'Olmayan' })).statusCode).toBe(400); // YG-857
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/kart-onerisi`, await o.gir('tu'), K);
    expect(r.statusCode, r.body).toBe(200);
    await o.karar((await o.kart('Kart Önerisi', r.json().kimlik)).kimlik, 'tid', 'Onayla');
    const v = (await o.sup.query(`SELECT kod, durum FROM kart_onerisi WHERE kimlik = $1`, [r.json().kimlik])).rows[0];
    expect(v.durum).toBe('Eklendi');
    expect((await o.sup.query(`SELECT islem FROM kartela_kalemi WHERE kod = $1`, [v.kod])).rows[0].islem).toBe('Yeni işlem');
    expect(v.kod).toMatch(/^ACIL-01\.01\.01-\d{2}$/); expect(v.kod).not.toBe('ACIL-01.01.01-01'); // YG-857
    await expect(o.sup.query(`UPDATE kartela_kalemi SET kod = 'X-01' WHERE kod = $1`, [v.kod])).rejects.toThrow(/değiştirilemez/);
  });
});
describe('karar ekranı kontrol listesi (YG-1389)', () => {
  it('risk bazlı kısa kontroller yalnız makama, ilgili maddelerle görünür', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const K = { ana: 'Acil', alt: 'Acil arıza ve hasar müdahalesi', tali: 'Çağrı sınıflandırması ve sevk', islem: 'Kontrol işlemi', birim: 'adet', maliyet: 10, gerekce: 'G' };
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/kart-onerisi`, await o.gir('tu'), K); expect(r.statusCode, r.body).toBe(200);
    const kart = (await o.kart('Kart Önerisi', r.json().kimlik)).kimlik;
    expect((await o.ist('GET', `/api/is/${kart}/karar-kontrolleri`, await o.gir('tu'))).statusCode).toBe(404);
    const al = async () => ((await o.ist('GET', `/api/is/${kart}/karar-kontrolleri`, await o.gir('tid'))).json().kontroller as { ad: string; sonuc: boolean }[]);
    const k1 = await al(); expect(k1.find((x) => x.ad === 'Görev Ayrılığı')?.sonuc).toBe(true); expect(k1.some((x) => x.ad === 'Açık Garanti veya Şikâyet')).toBe(false);
    await o.sup.query(`INSERT INTO garanti_sikayet (kayit_no, dosya_ref, kayit_turu, kanal, bildirim_zamani, oncelik, karar, statu, olusturan_ref) VALUES ($1,$2,'{Garanti bildirimi}','Telefon',now(),'Normal','Garanti','Uygulamada',$3)`, [`GS-KK${Date.now()}`, d.kimlik, o.K.ds]);
    await o.sup.query(`UPDATE is_karti SET son_zaman = now() - interval '1 hour' WHERE kimlik = $1`, [kart]);
    const k2 = await al(); expect(k2.find((x) => x.ad === 'Açık Garanti veya Şikâyet')?.sonuc).toBe(false); expect(k2.find((x) => x.ad === 'Hedef Süre')?.sonuc).toBe(false);
  });
});
