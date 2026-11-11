import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cevrimSureleri, veriProfili, yuzdelik } from '../src/analiz.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { cg: 'CEO', tid: 'Ticari İşler Direktörü', ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test95', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('süre ve sapma analizi, veri profilleme (YG-741, 745–748, 750, 756)', () => {
  it('yüzdelik doğru hesaplanır', () => {
    expect(yuzdelik([1, 2, 3, 4], 0.5)).toBe(2.5); expect(yuzdelik([10], 0.9)).toBe(10); expect(yuzdelik([], 0.5)).toBeNull();
  });
  it('net süre sayacı durduran beklemeyi düşer; toplam süre içerir', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET acilis_tarihi = '2026-10-01', statu = 'Kapalı', kapanma_nedeni = 'Bitti', kapanis_zamani = '2026-10-21' WHERE kimlik = $1`, [d.kimlik]);
    await o.sup.query(`INSERT INTO beklemede_isareti (dosya_ref, neden, sorumlu_ref, hedef_tarih, sayac_durur, olusturma_zamani, kaldirilma_zamani, olusturan_ref) VALUES ($1,'Parça bekleniyor',$2,'2026-10-10',true,'2026-10-05','2026-10-10',$2)`, [d.kimlik, o.K.ds]);
    const l = await cevrimSureleri(o.db, '2026-10-01', '2026-11-01');
    expect(l.find((x) => x.kimlik === d.kimlik)).toMatchObject({ toplam: 20, net: 15 });
  });
  it('ayrıntı yetkisi olmayan küçük grubu göremez; firma sıralaması yalnız ayrıntı rolünde', async () => {
    const tid = (await o.ist('GET', '/api/analiz?bas=2026-10-01&son=2026-11-01', await o.gir('tid'))).json();
    expect(tid.firma).toBeNull(); expect(tid.kirilim.oncelik.every((x: { adet: number; gizli?: boolean }) => x.adet >= 3 || x.gizli)).toBe(true);
    const opm = (await o.ist('GET', '/api/analiz?bas=2026-10-01&son=2026-11-01', await o.gir('opm'))).json();
    expect(Array.isArray(opm.firma)).toBe(true); expect(opm.egilim.seri).toHaveLength(12);
    expect((await o.ist('GET', '/api/analiz', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('veri profili doluluk ve biçim hatası verir', async () => {
    const p = await veriProfili(o.db, 'taraf');
    expect(p!.alanlar.find((a) => a.alan === 'telefon')!.bicimHata).not.toBeNull();
    expect(await veriProfili(o.db, 'kullanici_hesabi')).toBeNull();
    expect((await o.ist('GET', '/api/veri-profili/dosya', await o.gir('cg'))).json().kayit).toBeGreaterThan(0);
  });
});
