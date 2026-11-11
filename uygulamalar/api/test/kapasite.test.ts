import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { opm: 'Operasyon Müdürü', ds: 'Dosya Sorumlusu', ide: 'İç Denetçi' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test100', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('kapasite analizi (YG-749)', () => {
  it('personel yükü izinle azaltılmış kullanılabilir kapasiteye göre; firma doluluğu; yetkisiz göremez', async () => {
    const bugun = new Date().toISOString().slice(0, 10);
    await o.sup.query(`INSERT INTO izin_talebi (personel_ref, izin_turu, baslangic, bitis, gun, durum) VALUES ($1,'Yıllık',$2::date,$2::date + 6,7,'Onaylandı')`, [o.K.ds, bugun]);
    const rr = await o.ist('GET', '/api/kapasite', await o.gir('opm')); expect(rr.statusCode, rr.body).toBe(200); const v = rr.json();
    const ds = v.personel.find((p: { kimlik: string; rol: string }) => p.kimlik === o.K.ds && p.rol === 'Dosya Sorumlusu');
    expect(ds).toMatchObject({ esik: 25, izinGunu: 7, kullanilabilir: 12.5 });
    expect(Array.isArray(v.firmalar)).toBe(true);
    expect((await o.ist('GET', '/api/kapasite', await o.gir('ide'))).statusCode).toBe(404);
  });
});
