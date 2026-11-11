import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { olcumYaz } from '../src/sistem_izleme.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { sy: 'Sistem Yöneticisi', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test99', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('sistem izleme (YG-778)', () => {
  it('istekler akış bazında ölçülür; kullanılabilirlik, kapasite, kuyruk ve terk edilen akış yalnız BT ve üst yönetime görünür', async () => {
    const sy = await o.gir('sy');
    await o.ist('GET', '/api/ben', sy); await o.ist('GET', '/api/dosya', sy);
    await olcumYaz(o.db);
    const v = (await o.ist('GET', '/api/sistem-izleme', sy)).json();
    expect(v.kullanilabilirlik.son24Saat.oran).toBeGreaterThan(0);
    expect(v.akislar.some((x: { akis: string }) => x.akis === 'Dosya')).toBe(true);
    expect(v.kapasite.vt_mb).toBeGreaterThan(0);
    for (const k of ['gonderim', 'belge_uretim', 'geciken_is']) expect(v.kuyruk).toHaveProperty(k);
    for (const k of ['suresi_dolan_davet', 'bekleyen_talep', 'eski_taslak_teklif', 'ilk_girisi_bitmeyen']) expect(v.terk).toHaveProperty(k);
    expect((await o.ist('GET', '/api/sistem-izleme', await o.gir('ds'))).statusCode).toBe(404);
  });
});
