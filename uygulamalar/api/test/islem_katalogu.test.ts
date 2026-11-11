import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { katalogAktar, taliKod } from '../src/islem_katalogu.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { tod: 'Teknik ve Operasyon Direktörü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test109', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

const K = [
  { kod: 'TST-01.01.01-I01', duzey: 'İşlem', ad: 'Kontrol yapılır', ust_kod: 'TST-01.01.01' },
  { kod: 'TST-01', duzey: 'Ana Branş', ad: 'Test branşı', ust_kod: '' },
  { kod: 'TST-01.01', duzey: 'Alt Branş', ad: 'Alt', ust_kod: 'TST-01' },
  { kod: 'TST-01.01.01', duzey: 'Tali Branş', ad: 'Tali', ust_kod: 'TST-01.01' },
];
describe('branş ve işlem kodu kataloğu (YG-1385, 858, 660)', () => {
  it('aktarım düzey sırasıyla ve bir kez; biçim ve üst kod kısıtı; kod silinmez ve kaldırılan kod yeniden kullanılmaz', async () => {
    expect(await katalogAktar(o.db, K)).toBe(4); expect(await katalogAktar(o.db, K)).toBe(0);
    await expect(o.sup.query(`INSERT INTO brans_kodu (kod, duzey, ad, ust_kod) VALUES ('TST-1.1', 'Alt Branş', 'x', 'TST-01')`)).rejects.toThrow();
    await expect(o.sup.query(`DELETE FROM brans_kodu WHERE kod = 'TST-01.01.01-I01'`)).rejects.toThrow(/silinmez/);
    const tod = await o.gir('tod');
    expect((await o.ist('POST', '/api/brans-kodu', tod, { kod: 'TST-01.01.01-I02', duzey: 'İşlem', ad: 'Yeni işlem' })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/brans-kodu', tod, { kod: 'TST-01.01.01-2', duzey: 'İşlem', ad: 'Yanlış biçim' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/brans-kodu/TST-01.01.01/kaldir', tod, { gerekce: 'x' })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/brans-kodu/TST-01.01.01-I02/kaldir', tod, { gerekce: 'Mükerrer' })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/brans-kodu', tod, { kod: 'TST-01.01.01-I02', duzey: 'İşlem', ad: 'Tekrar' })).statusCode).toBe(409);
    await expect(o.sup.query(`UPDATE brans_kodu SET durum = 'Yürürlükte' WHERE kod = 'TST-01.01.01-I02'`)).rejects.toThrow(/yeniden/);
    expect((await o.ist('POST', '/api/brans-kodu', await o.gir('ds'), { kod: 'TST-01.02', duzey: 'Alt Branş', ad: 'x' })).statusCode).toBe(404);
  });
  it('kartela kalemi ortak tali branş üzerinden işlemlere bağlanır', async () => {
    expect(taliKod('TST-01.01.01-03')).toBe('TST-01.01.01');
    const r = (await o.ist('GET', `/api/kartela/${encodeURIComponent('TST-01.01.01-03')}/islemler`, await o.gir('ds'))).json();
    expect(r.tali.ana_ad).toBe('Test branşı'); expect(r.islemler.map((x: { kod: string }) => x.kod)).toContain('TST-01.01.01-I01');
    expect((await o.ist('GET', `/api/kartela/${encodeURIComponent('YOK-01.01.01-01')}/islemler`, await o.gir('ds'))).statusCode).toBe(404);
  });
});
