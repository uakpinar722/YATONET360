import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kapanisKodu, kapanisSonrasiIsle, tekneCekim } from '../src/kapanis_ek.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', kk: 'Kalite Uzmanı (Kalite Kontrolör)', kk2: 'Kalite Uzmanı (Kalite Kontrolör)', km: 'Kalite Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test74', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

const kapat = async (cikis = 'Teknik Kapalı', neden: string | null = null) => {
  const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET statu = $2, kapanma_nedeni = $3 WHERE kimlik = $1`, [d.kimlik, cikis, neden]);
  const bo = (await o.sup.query(`SELECT column_name c FROM information_schema.columns WHERE table_name = 'kapanis_kontrolu' AND is_nullable = 'NO' AND column_default IS NULL AND data_type = 'boolean'`)).rows.map((r) => r.c as string);
  await o.sup.query(`INSERT INTO kapanis_kontrolu (dosya_ref, hazirlayan_ref, cikis_statusu, kapanma_nedeni, durum, kapanis_zamani${bo.map((b) => `, ${b}`).join('')}) VALUES ($1,$2,$3,$4,'Onaylandı',now()${bo.map(() => ', true').join('')})`, [d.kimlik, o.K.ds, cikis, neden]);
  return d.kimlik as string;
};

describe('kapanış bildirimi (YG-1475, K-208)', () => {
  it('kod seçimi: hasar, planlı, özel kapanış, vefat', () => {
    const G = { cikis: 'Teknik Kapalı', neden: null, vefat: false, sigortali: false, oncelik: 'Normal' };
    expect(kapanisKodu(G)).toBe('BLD-16'); expect(kapanisKodu({ ...G, oncelik: 'Planlı' })).toBe('BLD-16P'); expect(kapanisKodu({ ...G, oncelik: 'Planlı', sigortali: true })).toBe('BLD-16');
    expect(kapanisKodu({ ...G, cikis: 'Kapalı', neden: 'Hükmi Tam Ziya (onarım ekonomik değil)' })).toBe('BLD-43'); expect(kapanisKodu({ ...G, cikis: 'Kapalı', neden: 'Tam Ziya (yat fiziken yok)' })).toBe('BLD-44');
    expect(kapanisKodu({ ...G, cikis: 'Kapalı', neden: 'Tamamlandı' })).toBeNull(); expect(kapanisKodu({ ...G, vefat: true })).toBeNull();
    expect(tekneCekim('Yelkenli Yat').yi).toBe('yelkenlinizi'); expect(tekneCekim('Gulet').yi).toBe('teknenizi');
  });
  it('her kapanışta bir kez gider; metin onaylı şablondan dolar', async () => {
    const a = await kapat(); const b = await kapat('Kapalı', 'Tam Ziya (yat fiziken yok)');
    const l = await kapanisSonrasiIsle(o.db, 'http://x'); expect(l).toContainEqual({ dosya: a, kod: 'BLD-16' }); expect(l).toContainEqual({ dosya: b, kod: 'BLD-44' });
    expect((await kapanisSonrasiIsle(o.db, 'http://x')).length).toBe(0);
  });
});

describe('dosya performans değerlendirmesi (YG-785, YG-786)', () => {
  it('atanan Kalite Kontrolör değerlendirir, Kalite Müdürü onaylar; iade edilince düzeltilir', async () => {
    const d = await kapat(); await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Kalite Kontrolör',$3)`, [d, o.K.kk, o.K.opm]);
    await kapanisSonrasiIsle(o.db, 'http://x'); expect((await o.kart('Dosya Performans Değerlendirmesi', d)).sahip_kullanici_ref).toBe(o.K.kk);
    const u = `/api/dosya/${d}/performans`; const G = { sapma: 'Yok', bulgular: 'Bulgu yok', etki: 'Yok' }; const kk = await o.gir('kk');
    expect((await o.ist('POST', u, await o.gir('kk2'), G)).statusCode).toBe(404);
    expect((await o.ist('POST', u, kk, { sapma: 'X' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, kk, G)).statusCode).toBe(200); expect((await o.ist('POST', u, kk, G)).statusCode).toBe(409);
    expect((await o.kart('Dosya Performans Değerlendirmesi', d)).durum).toBe('Tamamlandı');
    expect((await o.karar((await o.kart('Dosya Performans Onayı', d)).kimlik, 'km', 'Gerekçeyle İade Et', 'Eksik')).statusCode).toBe(200);
    expect((await o.ist('POST', u, kk, { ...G, sapma: 'Düzeltildi' })).statusCode).toBe(200);
    const son = (await o.sup.query(`SELECT kimlik FROM is_karti WHERE tur = 'Dosya Performans Onayı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [d])).rows[0].kimlik;
    expect((await o.karar(son, 'km', 'Onayla')).statusCode).toBe(200);
    const v = (await o.ist('GET', u, kk)).json(); expect(v.kayit).toMatchObject({ durum: 'Onaylandı', sapma_nedeni: 'Düzeltildi' }); expect(v.ilkSeferde).toEqual({ n: 0, k: 0 });
    expect((await o.ist('GET', '/api/personel-karne?donem=' + new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7), kk)).json().satirlar.find((x: { gosterge: string }) => x.gosterge === 'FR-KLT-011 tamamlama')).toMatchObject({ pay: 1, payda: 1 });
  });
});
