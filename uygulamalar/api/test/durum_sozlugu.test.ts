import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { bim: 'Bilgi İşlem Müdürü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test91', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('birleşik durum sözlüğü (YG-1365)', () => {
  it('durumlar kısıtlardan okunur; yetkili tanımlar; aynı ad başka türde farklı anlam alamaz; geçişler aynı türden olmalı', async () => {
    const ds = await o.gir('ds'); const bim = await o.gir('bim');
    const v = (await o.ist('GET', '/api/durum-sozlugu', ds)).json();
    expect(v.yetkili).toBe(false);
    const prb = v.turler.find((t: { kayit_turu: string }) => t.kayit_turu === 'problem_kaydi');
    expect(prb.durumlar).toEqual(['Açık', 'Kapalı']);
    const tem = { kayitTuru: 'problem_kaydi', durum: 'Açık', isAnlami: 'Kök neden çalışması sürüyor', girisKosulu: 'Kayıt açıldı', cikisKosulu: 'Kök neden ve kalıcı çözüm', yetkiliRol: 'Bilgi İşlem Müdürü', izinliGecisler: ['Kapalı'] };
    expect((await o.ist('POST', '/api/durum-sozlugu', ds, tem)).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/durum-sozlugu', bim, { ...tem, izinliGecisler: ['Yok'] })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/durum-sozlugu', bim, { ...tem, yetkiliRol: 'Uydurma Rol' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/durum-sozlugu', bim, tem)).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/durum-sozlugu', bim, { ...tem, kayitTuru: 'test_hatasi', izinliGecisler: ['Düzeltildi'], isAnlami: 'Hata giderilmedi' })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/durum-sozlugu', bim, { ...tem, kayitTuru: 'test_hatasi', izinliGecisler: ['Düzeltildi'] })).statusCode).toBe(200);
    const s = (await o.ist('GET', '/api/durum-sozlugu', ds)).json();
    expect(s.ozet.tanimli).toBe(2); expect(s.cakisma).toEqual([]);
  });
});
