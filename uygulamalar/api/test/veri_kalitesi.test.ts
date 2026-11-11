import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kaliteKontrolIsle, KURALLAR, oncelik } from '../src/veri_kalitesi.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { bim: 'Bilgi İşlem Müdürü', opm: 'Operasyon Müdürü', ds: 'Dosya Sorumlusu', ide: 'İç Denetçi' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test103', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('veri kalitesi (YG-1249, 1252, 1254, 1255)', () => {
  it('kurallar tek katalogda; ihlal açılır, düzeltilince giderilir; öncelik etkiden; istisnayı veri sahibi verir; kural sürümlenir', async () => {
    expect(new Set(KURALLAR.map((k) => k.kod)).size).toBe(KURALLAR.length);
    expect(oncelik('Ödeme')).toBe('Yüksek'); expect(oncelik('Teslim')).toBe('Orta'); expect(oncelik('Diğer')).toBe('Düşük');
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET statu = 'Aktif', ana_teknik_brans = NULL WHERE kimlik = $1`, [d.kimlik]);
    await kaliteKontrolIsle(o.db);
    const h = (await o.sup.query(`SELECT kimlik, oncelik, durum FROM veri_hatasi WHERE kural_kod = 'VK-01' AND kayit_kimligi = $1`, [d.kimlik])).rows[0];
    expect(h).toMatchObject({ oncelik: 'Orta', durum: 'Açık' });
    const v = (await o.ist('GET', '/api/veri-kalitesi', await o.gir('opm'))).json();
    expect(v.kumeler.map((k: { kod: string }) => k.kod)).toEqual(['DOSYA', 'FATURA', 'FIRMA', 'TARAF', 'YAT']);
    expect(v.sahipOldugu).toContain('DOSYA');
    expect((await o.ist('POST', `/api/veri-hatasi/${h.kimlik}/istisna`, await o.gir('bim'), { gerekce: 'x' })).statusCode).toBe(404);
    await o.sup.query(`UPDATE dosya SET ana_teknik_brans = 'Gövde' WHERE kimlik = $1`, [d.kimlik]);
    await kaliteKontrolIsle(o.db);
    expect((await o.sup.query(`SELECT durum FROM veri_hatasi WHERE kimlik = $1`, [h.kimlik])).rows[0].durum).toBe('Giderildi');
    expect((await o.ist('POST', '/api/kalite-kurali/VK-01', await o.gir('bim'), { esik: 5 })).json().surum).toBe(2);
    expect((await o.ist('GET', '/api/veri-kalitesi', await o.gir('ide'))).statusCode).toBe(404);
  });
});
