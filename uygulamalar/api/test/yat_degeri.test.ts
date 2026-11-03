import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ekonomikEsik, ekonomikIzle, ekPoliceDurumu, ortakKarar, yatDegeriEngeli } from '../src/yat_degeri.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', oy2: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', to: 'Teknik ve Operasyon Direktörü', huk: 'Hukuk ve Uyum Direktörü', tid: 'Ticari İşler Direktörü', ic: 'İç Denetçi' };
let o: Ortam;
// ekipKur test kolaylığı için değeri kesin kaydeder; burada kaydı geri alıp gerçek akışı sınarız.
const dosya = async () => { await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE bitis_zamani IS NULL`); const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); await o.sup.query(`DELETE FROM dosya_yat_degeri WHERE dosya_ref = $1`, [d.kimlik]); return d; };
const gorus = async (id: string, k: string, deger: number) => o.ist('POST', `/api/dosya/${id}/yat-degeri`, await o.gir(k), { deger, dayanak: 'Piyasa bilgisi' });
const limit = (x: number | null) => (x === null ? o.sup.query(`DELETE FROM sistem_parametresi WHERE kod = 'police_olay_basi_limit_eur'`) : o.sup.query(`INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('police_olay_basi_limit_eur',$1,'L') ON CONFLICT (kod) DO UPDATE SET deger = $1`, [x]));

beforeAll(async () => { o = await ortamKur('yatonet360_test18', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('kurallar', () => {
  it('ortak karar, ek poliçe, ekonomik eşik sınırları', () => {
    expect(ortakKarar(100, null).durum).toBe('Bekliyor'); expect(ortakKarar(100, 100)).toEqual({ durum: 'Kesin', deger: 100 }); expect(ortakKarar(100, 100.01).durum).toBe('Uyuşmazlık');
    expect(ekPoliceDurumu(100, 100)).toBe('Gerekli değil'); expect(ekPoliceDurumu(100.01, 100)).toBe('Gerekli – bekleniyor'); expect(ekPoliceDurumu(1, null)).toBe('Gerekli – bekleniyor');
    expect([ekonomikEsik(59.99, 100), ekonomikEsik(60, 100), ekonomikEsik(70, 100), ekonomikEsik(79.99, 100), ekonomikEsik(80, 100)]).toEqual([null, 60, 70, 70, 80]);
  });
});
describe('ortak karar (K-240)', () => {
  it('yalnız atanmış iki rol; tek görüş kapıyı açmaz; aynı değerde kesinleşir; uyuşmazlıkta kapı kapalı, Direktöre kart', async () => {
    await limit(1_000_000); const d = await dosya();
    expect((await gorus(d.kimlik, 'tu', 100)).statusCode).toBe(403);
    expect((await gorus(d.kimlik, 'oy2', 100)).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yat-degeri`, await o.gir('oy'), { deger: 100 })).statusCode).toBe(400);
    expect((await gorus(d.kimlik, 'oy', 500000)).json().durum).toBe('Bekliyor');
    expect(await yatDegeriEngeli(o.db, d.kimlik)).toContain('ortak kararıyla');
    expect((await gorus(d.kimlik, 'ty', 600000)).json().durum).toBe('Uyuşmazlık');
    expect(await yatDegeriEngeli(o.db, d.kimlik, 'ON')).toContain('ortak kararıyla');
    expect(await o.kart('Yat Değeri Uyuşmazlığı', d.kimlik)).toBeDefined();
    expect((await gorus(d.kimlik, 'ty', 500000)).json()).toEqual({ durum: 'Kesin', ekPolice: 'Gerekli değil' });
    expect(await yatDegeriEngeli(o.db, d.kimlik, 'ON')).toBeNull();
    expect((await gorus(d.kimlik, 'oy', 510000)).json().durum).toBe('Uyuşmazlık');
    expect(await yatDegeriEngeli(o.db, d.kimlik, 'ON')).toContain('ortak kararıyla');
  });
  it('görünürlük: ekip dışı rol ve Teknik Uzman görmez; yetkili üst rol görür; firma çıktılarına girmez', async () => {
    const d = await dosya(); await gorus(d.kimlik, 'oy', 500000);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/yat-degeri`, await o.gir('tu'))).statusCode).toBe(404);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/yat-degeri`, await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/yat-degeri`, await o.gir('ic'))).statusCode).toBe(404);
    const r = await o.ist('GET', `/api/dosya/${d.kimlik}/yat-degeri`, await o.gir('to'));
    expect(r.statusCode, r.body).toBe(200); expect(r.json().gorusler).toHaveLength(1);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}`, await o.gir('ds'))).body).not.toContain('500000');
  });
  it('iki rol aynı kişideyse karar verilemez', async () => {
    const d = await dosya(); await o.sup.query(`UPDATE dosya_ekibi_atamasi SET kullanici_ref = $2 WHERE dosya_ref = $1 AND rol = 'Teknik Yönetici'`, [d.kimlik, o.K.oy]);
    expect((await gorus(d.kimlik, 'oy', 100)).statusCode).toBe(409);
  });
  it('acil iş ve hasar dışı dosya kapıya takılmaz', async () => {
    const d = await dosya();
    expect(await yatDegeriEngeli(o.db, d.kimlik, 'AC')).toBeNull();
    await o.sup.query(`UPDATE dosya SET hizmet_turu = 'Planlı bakım' WHERE kimlik = $1`, [d.kimlik]);
    expect(await yatDegeriEngeli(o.db, d.kimlik, 'ON')).toBeNull();
  });
});
describe('ek poliçe (YG-126, YG-336)', () => {
  it('limit üstünde teklif serbest, iş emri kapalı; Hukuk belgeyle açar; limit tanımsızsa güvenli tarafta', async () => {
    await limit(100000); const d = await dosya(); await gorus(d.kimlik, 'oy', 100000.01);
    expect((await gorus(d.kimlik, 'ty', 100000.01)).json()).toEqual({ durum: 'Kesin', ekPolice: 'Gerekli – bekleniyor' });
    expect(await yatDegeriEngeli(o.db, d.kimlik)).toBeNull();
    expect(await yatDegeriEngeli(o.db, d.kimlik, 'ON')).toContain('ek poliçe');
    expect(await yatDegeriEngeli(o.db, d.kimlik, 'AC')).toBeNull();
    const belge = await o.belge(d.kimlik, 'ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ek-police`, await o.gir('oy'), { belge })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ek-police`, await o.gir('huk'), {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ek-police`, await o.gir('huk'), { belge })).json().ekPolice).toBe('Sağlandı');
    expect(await yatDegeriEngeli(o.db, d.kimlik, 'ON')).toBeNull();
    await limit(null); const e = await dosya(); await gorus(e.kimlik, 'oy', 10);
    expect((await gorus(e.kimlik, 'ty', 10)).json().ekPolice).toBe('Gerekli – bekleniyor');
    await limit(1_000_000);
  });
});
describe('ekonomik onarım (YG-1458)', () => {
  const izle = async (id: string, tutar: number) => { const c = await o.db.connect(); try { await ekonomikIzle(c, id, tutar); } finally { c.release(); } };
  const say = async (tur: string, id: string) => (await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = $1 AND nesne_kimligi = $2`, [tur, id])).rows[0].n as number;
  it('eşikler sırayla ve birer kez; %80 yat sahibine onaylı metin, oran ve değer yazılmaz', async () => {
    const d = await dosya(); await gorus(d.kimlik, 'oy', 1000); await gorus(d.kimlik, 'ty', 1000);
    await izle(d.kimlik, 599); expect(await say('Ekonomik Onarım Uyarısı', d.kimlik)).toBe(0);
    await izle(d.kimlik, 600); await izle(d.kimlik, 600); expect(await say('Ekonomik Onarım Uyarısı', d.kimlik)).toBe(1); expect(await say('Ekonomik Onarım Değerlendirmesi', d.kimlik)).toBe(0);
    await izle(d.kimlik, 700); expect(await say('Ekonomik Onarım Değerlendirmesi', d.kimlik)).toBe(1); expect(await say('Ekonomik Onarılamazlık', d.kimlik)).toBe(0);
    await izle(d.kimlik, 800); await izle(d.kimlik, 900); expect(await say('Ekonomik Onarılamazlık', d.kimlik)).toBe(1);
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1`, [`ekonomik:${d.kimlik}`])).rows;
    expect(m.length).toBeGreaterThan(0); expect(m[0].metin).toContain('birlikte karar'); expect(m[0].metin).not.toMatch(/1\.000|%|800/);
  });
  it('kesinleşmemiş dosyada uyarı üretmez', async () => {
    const d = await dosya(); await izle(d.kimlik, 1_000_000); expect(await say('Ekonomik Onarım Uyarısı', d.kimlik)).toBe(0);
  });
});
