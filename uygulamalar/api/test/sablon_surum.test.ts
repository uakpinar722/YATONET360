import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sonrakiSurum } from '../src/sablon_surum.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', gmy: 'Genel Müdür Yardımcısı', ust: 'CEO', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test116', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('metin kütüphanesi sürüm ve onay (YG-600)', () => {
  it('her metin sahip ve onay dayanağı taşır; anlamı etkileyen değişiklik yeni sürümle GMY onayına gider, CEO bilgilenir, onayda eski sürüm Yerine Geçti olur', async () => {
    const k = (await o.sup.query(`SELECT kod, dil, surum, metin FROM sablon_metni WHERE kod = 'BLD-01' AND dil = 'tr' AND durum = 'Yürürlükte'`)).rows[0];
    expect(k).toBeTruthy();
    expect(Number((await o.sup.query(`SELECT count(*) n FROM sablon_metni WHERE sahip_rol IS NULL OR onay_dayanagi IS NULL`)).rows[0].n)).toBe(0);
    const btd = await o.gir('btd');
    expect((await o.ist('POST', '/api/sablon-metni/BLD-01/tr', await o.gir('ds'), { metin: 'X', gerekce: 'G' })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/sablon-metni/BLD-01/tr', btd, { metin: k.metin, gerekce: 'G' })).statusCode).toBe(409);
    const r = (await o.ist('POST', '/api/sablon-metni/BLD-01/tr', btd, { metin: `${k.metin} Ek cümle.`, gerekce: 'Planlama bilgisi eklendi' })).json();
    expect(r).toEqual({ surum: sonrakiSurum(k.surum), durum: 'Onayda' }); expect(sonrakiSurum('R00')).toBe('R01');
    expect((await o.ist('POST', '/api/sablon-metni/BLD-01/tr', btd, { metin: 'Başka', gerekce: 'G' })).statusCode).toBe(409);
    const kart = await o.kart('Şablon Metni Onayı', `BLD-01|tr|${sonrakiSurum(k.surum)}`);
    expect((await o.ist('POST', `/api/is/${kart.kimlik}/karar`, await o.gir('gmy'), { karar: 'Onayla' })).statusCode).toBe(200);
    expect(Number((await o.sup.query(`SELECT count(*) n FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE 'Metin Değişikliği%'`, [o.K.ust])).rows[0].n)).toBeGreaterThan(0);
    const l = (await o.sup.query(`SELECT surum, durum FROM sablon_metni WHERE kod = 'BLD-01' AND dil = 'tr' ORDER BY surum`)).rows.map((x) => x.durum);
    expect(l.slice(-2)).toEqual(['Yerine Geçti', 'Yürürlükte']);
    const d = (await o.ist('POST', '/api/sablon-metni/BLD-01/tr', btd, { metin: `${k.metin} Ek cümle!`, gerekce: 'Noktalama', anlamEtkiler: false })).json();
    expect(d.durum).toBe('Yürürlükte');
    expect((await o.sup.query(`SELECT count(*) n FROM sablon_metni WHERE kod = 'BLD-01' AND dil = 'tr' AND durum = 'Yürürlükte'`)).rows[0].n).toBe('1');
  });
});
