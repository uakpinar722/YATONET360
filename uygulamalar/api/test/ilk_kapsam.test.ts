import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test89', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('FR-OPS-003 İlk Kapsam (YG-1069)', () => {
  it('Dosya Sorumlusu doldurur; Teknik Uzman tamamlar ve onaylar; iki branşta koordinatör zorunlu; yeni kayıt yeni sürüm', async () => {
    const d = (await o.dosyaAc()).kimlik as string; await o.ekipKur(d); const u = `/api/dosya/${d}/ilk-kapsam`;
    const ds = await o.gir('ds'); const tu = await o.gir('tu');
    const G = { varlikSistem: 'Sancak şaft hattı', faaliyet: 'Teşhis', teknikBrans: ['TAHRIK-01'], beklenenCikti: 'Kök neden görüşü', kabulOlcutu: 'Titreşim ölçümü sınırda', hariclar: 'Motor revizyonu hariç' };
    expect((await o.ist('POST', u, tu, G)).statusCode).toBe(404);
    expect((await o.ist('POST', u, ds, { ...G, faaliyet: 'Bakım' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ...G, teknikBrans: ['TAHRIK-01', 'MAKINE-01'] })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ...G, kabulOlcutu: '' })).statusCode).toBe(400);
    const r = (await o.ist('POST', u, ds, G)).json(); expect(r).toMatchObject({ surum: 1, kontrolGorevi: true });
    expect((await o.kart('İlk Kapsam Kontrolü', d)).sahip_kullanici_ref).toBe(o.K.tu);
    const k = `${u}/1/kontrol`;
    expect((await o.ist('POST', k, ds, { karar: 'Onayla' })).statusCode).toBe(404);
    expect((await o.ist('POST', k, tu, { karar: 'İade' })).statusCode).toBe(400);
    expect((await o.ist('POST', k, tu, { karar: 'Onayla', varsayimlar: 'Yat karada' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, varsayimlar, kontrol_eden_ref FROM ilk_kapsam WHERE dosya_ref = $1 AND surum = 1`, [d])).rows[0]).toEqual({ durum: 'Onaylı', varsayimlar: 'Yat karada', kontrol_eden_ref: o.K.tu });
    expect((await o.kart('İlk Kapsam Kontrolü', d)).durum).toBe('Tamamlandı');
    expect((await o.ist('POST', u, ds, { ...G, teknikBrans: ['TAHRIK-01', 'MAKINE-01'], koordinator: o.K.tu })).json().surum).toBe(2);
    expect((await o.sup.query(`SELECT array_agg(durum ORDER BY surum) d FROM ilk_kapsam WHERE dosya_ref = $1`, [d])).rows[0].d).toEqual(['Yerine Geçti', 'Kontrolde']);
    expect((await o.ist('GET', u, ds)).json().surumler.length).toBe(2);
  });
});
