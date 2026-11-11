import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { tu: 'Teknik Uzman', tm: 'Teknik Yönetici', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test106', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('işlem araması (YG-1372)', () => {
  it('eş anlamlı terimle bulunur; eş anlamlıyı yalnız teknik veya ticari yönetim ekler', async () => {
    let sur = (await o.sup.query(`SELECT surum FROM kartela_surumu WHERE durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`)).rows[0]?.surum as string | undefined;
    if (!sur) { sur = 'T-ARA'; await o.sup.query(`INSERT INTO kartela_surumu (surum, durum, yururluk) VALUES ($1,'Yürürlükte',current_date)`, [sur]); }
    await o.sup.query(`INSERT INTO kartela_kalemi (kod, surum, ana_brans, alt_brans, tali_brans, islem, birim, maliyet_eur) VALUES ('ARA-01.01.01-I01',$1,'ŞAFT','Yatak','Kesik','Cutless yatak değişimi','adet',100) ON CONFLICT DO NOTHING`, [sur]);
    const tu = await o.gir('tu');
    const r = (await o.ist('GET', `/api/kartela/ara?q=${encodeURIComponent('kesik yatak')}`, tu)).json();
    expect(r.some((x: { kod: string }) => x.kod === 'ARA-01.01.01-I01')).toBe(true);
    expect((await o.ist('POST', '/api/kartela/es-anlam', await o.gir('ds'), { terim: 'şaft', karsilik: 'shaft' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/kartela/es-anlam', await o.gir('tm'), { terim: 'yatak', karsilik: 'bearing' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/kartela/ara?q=bearing', tu)).json().some((x: { kod: string }) => x.kod === 'ARA-01.01.01-I01')).toBe(true);
  });
});
