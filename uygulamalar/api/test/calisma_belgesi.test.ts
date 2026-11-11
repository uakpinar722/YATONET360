import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calismaBelgesiTanim, calismaSuresi } from '../src/calisma_belgesi.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ik: 'İnsan Kaynakları Müdürü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test113', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('çalışma belgesi (YG-934)', () => {
  it('süre giriş ve çıkış günü dahil hesaplanır', () => {
    expect(calismaSuresi(new Date('2025-01-01'), new Date('2026-03-31'))).toBe('1 yıl 3 ay');
    expect(calismaSuresi(new Date('2026-01-15'), new Date('2026-01-15'))).toBe('1 gün');
  });
  it('ayrılış tarihi kayıtlı personelde işin türü ve süresiyle üretilir; yalnız İK indirir', async () => {
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) VALUES ($1, '2025-01-01', $2) ON CONFLICT (kullanici_ref) DO UPDATE SET ise_giris_tarihi = EXCLUDED.ise_giris_tarihi`, [o.K.ds, o.K.ik]);
    expect(await calismaBelgesiTanim(o.db, o.K.ds!)).toBeNull();
    const ik = await o.gir('ik');
    expect((await o.ist('GET', `/api/personel/${o.K.ds}/calisma-belgesi.pdf`, ik)).statusCode).toBe(409);
    await o.sup.query(`UPDATE personel_karti SET ayrilis_tarihi = '2026-03-31' WHERE kullanici_ref = $1`, [o.K.ds]);
    const v = await calismaBelgesiTanim(o.db, o.K.ds!); const m = JSON.stringify(v!.t);
    expect(m).toContain('Dosya Sorumlusu'); expect(m).toContain('1 yıl 3 ay'); expect(m).toContain('4857 sayılı İş Kanunu m.28');
    expect((await o.ist('GET', `/api/personel/${o.K.ds}/calisma-belgesi.pdf`, await o.gir('ds'))).statusCode).toBe(404);
  });
});
