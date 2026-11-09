import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { denemeIsle } from '../src/akademi.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', tod: 'Teknik ve Operasyon Direktörü', gmy: 'Genel Müdür Yardımcısı', cg: 'CEO', iks: 'İnsan Kaynakları Sorumlusu', idm: 'İç Denetim Müdürü', hu: 'Hukuk ve Uyum Uzmanı', hd: 'Hukuk ve Uyum Direktörü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test75', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('Akademi (YG-937, YG-938, YG-943)', () => {
  it('dersi İK ekler; rolüne göre görünür; beyan imzasız; revizyonda yeniden beyan istenir', async () => {
    const iks = await o.gir('iks'); const ds = await o.gir('ds'); const G = { ad: 'KVKK', tur: 'Zorunlu', icerik: 'Metin', roller: ['Dosya Sorumlusu'] };
    expect((await o.ist('POST', '/api/akademi/ders', ds, G)).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/akademi/ders', iks, { ...G, tur: 'X' })).statusCode).toBe(400);
    const k = (await o.ist('POST', '/api/akademi/ders', iks, G)).json().kimlik as string;
    const dersi = async (c: string) => (await o.ist('GET', '/api/akademi', c)).json().dersler.find((x: { kimlik: string }) => x.kimlik === k);
    expect((await dersi(ds)).beyan).toBe(false); expect(await dersi(await o.gir('opm'))).toBeUndefined();
    expect((await o.ist('POST', `/api/akademi/ders/${k}/beyan`, await o.gir('opm'), {})).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/akademi/ders/${k}/beyan`, ds, {})).statusCode).toBe(200); expect((await o.ist('POST', `/api/akademi/ders/${k}/beyan`, ds, {})).statusCode).toBe(409);
    expect((await dersi(ds)).beyan).toBe(true);
    expect((await o.ist('POST', `/api/akademi/ders/${k}/revize`, iks, { icerik: 'Yeni' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/akademi/ders/${k}/revize`, iks, { icerik: 'Yeni', degisiklik: 'Süre değişti' })).json().surum).toBe(2);
    expect(await dersi(ds)).toMatchObject({ beyan: false, degisiklik_notu: 'Süre değişti', surum: 2 });
    const iz = (await o.ist('GET', '/api/akademi', iks)).json().izleme.find((x: { kimlik: string }) => x.kimlik === k); expect(iz).toMatchObject({ beyan: 0, hedef: 1 });
  });
});

describe('deneme süresi değerlendirmesi (YG-970)', () => {
  const rolAdlari = async (k: string) => (await o.sup.query(`SELECT array_agg(r.rol_adi ORDER BY z.n) a FROM deneme_degerlendirme d, unnest(d.zincir) WITH ORDINALITY z(id, n) JOIN rol r ON r.kimlik = z.id WHERE d.personel_ref = $1`, [k])).rows[0].a as string[];
  it('bitişten iki hafta önce ilk amire düşer; silsile role göre; hazırlayan son kararı vermez; GMY bilgilendirilir', async () => {
    const S = new Date('2026-11-09T09:00:00Z'); const giris = '2026-09-15';
    for (const k of ['ds', 'hu', 'idm', 'opm', 'hd']) await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) VALUES ($1,$2,$1)`, [o.K[k], giris]);
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) VALUES ($1,'2026-01-01',$1)`, [o.K.iks]);
    expect(await denemeIsle(o.db, S)).toBe(5); expect(await denemeIsle(o.db, S)).toBe(0);
    expect(await rolAdlari(o.K.ds!)).toEqual(['Operasyon Müdürü', 'Teknik ve Operasyon Direktörü']);
    expect(await rolAdlari(o.K.hu!)).toEqual(['Hukuk ve Uyum Direktörü', 'Genel Müdür Yardımcısı']);
    expect(await rolAdlari(o.K.opm!)).toEqual(['Teknik ve Operasyon Direktörü', 'Genel Müdür Yardımcısı']);
    expect(await rolAdlari(o.K.hd!)).toEqual(['Genel Müdür Yardımcısı', 'CEO']);
    expect(await rolAdlari(o.K.idm!)).toEqual(['CEO']);
    const opm = await o.gir('opm'); const u = `/api/deneme/${o.K.ds}/hazirla`;
    expect((await o.ist('POST', u, await o.gir('tod'), { oneri: 'Devam', notlar: 'N' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, opm, { oneri: 'X', notlar: 'N' })).statusCode).toBe(400);
    expect((await o.ist('GET', '/api/deneme/bekleyen', opm)).json().map((x: { personel: string }) => x.personel)).toContain(o.K.ds);
    expect((await o.ist('POST', u, opm, { oneri: 'Devam', notlar: 'Uygun' })).statusCode).toBe(200);
    expect((await o.kart('Deneme Süresi Değerlendirmesi', o.K.ds!)).durum).toBe('Tamamlandı');
    expect((await o.karar((await o.kart('Deneme Süresi Kararı', o.K.ds!)).kimlik, 'tod', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, oneri FROM deneme_degerlendirme WHERE personel_ref = $1`, [o.K.ds])).rows[0]).toEqual({ durum: 'Sonuçlandı', oneri: 'Devam' });
  });
});
