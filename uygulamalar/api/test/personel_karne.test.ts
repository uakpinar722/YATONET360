import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gostergePuani, karneKapanisGorevi, nihaiPuan } from '../src/personel_karne.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', tod: 'Teknik ve Operasyon Direktörü', gmy: 'Genel Müdür Yardımcısı', cg: 'CEO', iks: 'İnsan Kaynakları Sorumlusu', idm: 'İç Denetim Müdürü', rkd: 'Risk ve Kalite Direktörü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test73', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const D = '2026-10';

describe('kişisel karne (YG-960–968)', () => {
  it('katalog: her rolün ağırlık toplamı 100; hedefe ulaşan tam puan alır; %80 sistem, %20 yönetici', async () => {
    const r = (await o.sup.query(`SELECT rol_adi, sum(agirlik)::float t FROM karne_gosterge GROUP BY 1`)).rows; expect(r.length).toBe(48); expect(r.every((x) => Math.abs(x.t - 100) < 0.01)).toBe(true);
    expect(gostergePuani(95, '≥ %95')).toBe(100); expect(gostergePuani(47.5, '≥ %95')).toBe(50); expect(gostergePuani(60, '%100')).toBe(60);
    expect(nihaiPuan(50, 100)).toBe(60); expect(nihaiPuan(50, null)).toBe(50); expect(nihaiPuan(null, 90)).toBeNull();
  });
  it('onay süresi kayıtlardan ölçülür; ölçülemeyen gösterge puana girmez', async () => {
    const gr = (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Genel Müdür Yardımcısı'`)).rows[0].kimlik;
    for (const dk of [10, 600]) {
      const k = (await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, oncelik, zincir, olusturma_zamani) VALUES ('Deneme','onay','D','Normal',ARRAY[$1::text],'2026-10-05T09:00:00Z') RETURNING kimlik`, [gr])).rows[0].kimlik;
      await o.sup.query(`INSERT INTO is_karti_adim (is_ref, kademe, karar, yapan_ref, rol_ref, zaman) VALUES ($1,0,'Onayla',$2,$3,'2026-10-05T09:00:00Z'::timestamptz + make_interval(mins => $4))`, [k, o.K.gmy, gr, dk]);
    }
    const r = (await o.ist('GET', `/api/personel-karne?donem=${D}`, await o.gir('gmy'))).json();
    const s = r.satirlar.find((x: { gosterge: string }) => x.gosterge === 'Onay süresi uyumu'); expect(s).toMatchObject({ pay: 1, payda: 2, deger: 50, puan: 52.63 }); expect(r.sistem).toBe(52.63);
    expect(r.satirlar.filter((x: { puan: unknown }) => x.puan === null).length).toBeGreaterThan(0);
  });
  it('kendisi ve yönetici zinciri görür, başkası göremez; İç Denetim Müdürünün üst makamı CEO', async () => {
    expect((await o.ist('GET', `/api/personel-karne?kullanici=${o.K.ds}&donem=${D}`, await o.gir('opm'))).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/personel-karne?kullanici=${o.K.ds}&donem=${D}`, await o.gir('gmy'))).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/personel-karne?kullanici=${o.K.ds}&donem=${D}`, await o.gir('iks'))).statusCode).toBe(404);
    expect((await o.ist('GET', `/api/personel-karne?kullanici=${o.K.idm}&donem=${D}`, await o.gir('rkd'))).statusCode).toBe(404);
    expect((await o.ist('GET', `/api/personel-karne?kullanici=${o.K.idm}&donem=${D}`, await o.gir('cg'))).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/personel-karne/bagli', await o.gir('opm'))).json().map((x: { kimlik: string }) => x.kimlik)).toContain(o.K.ds);
  });
  it('yönetici puanı üst makamda; dönemi İK kapatır; itirazı yalnız sahibi yapar, üst makam karar verir', async () => {
    const G = { kullanici: o.K.gmy, donem: D, puan: 100, gerekce: 'İyi' }; const cg = await o.gir('cg'); const gmy = await o.gir('gmy');
    expect((await o.ist('POST', '/api/personel-karne/yonetici-puani', await o.gir('opm'), G)).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/personel-karne/yonetici-puani', cg, { ...G, puan: 101 })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/personel-karne/yonetici-puani', cg, G)).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/personel-karne/itiraz', gmy, { donem: D, konu: 'K' })).statusCode).toBe(409);
    const iks = await o.gir('iks');
    expect((await o.ist('POST', '/api/personel-karne/donem-kapat', cg, { donem: D })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/personel-karne/donem-kapat', iks, { donem: '2099-01' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/personel-karne/donem-kapat', iks, { donem: D })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/personel-karne/donem-kapat', iks, { donem: D })).statusCode).toBe(409);
    const k = (await o.ist('GET', `/api/personel-karne?donem=${D}`, gmy)).json(); expect(k).toMatchObject({ durum: 'Kapalı', sistem: 52.63, yonetici: 100, nihai: 62.1 });
    expect((await o.ist('POST', '/api/personel-karne/yonetici-puani', cg, G)).statusCode).toBe(409);
    const t = (await o.ist('POST', '/api/personel-karne/itiraz', gmy, { donem: D, konu: 'Hatalı veri' })).json().kimlik as string;
    expect((await o.ist('POST', '/api/personel-karne/itiraz', gmy, { donem: D, konu: 'İkinci' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/personel-karne/itiraz/${t}/karar`, gmy, { karar: 'Kabul', gerekce: 'X' })).statusCode).toBe(404);
    expect((await o.ist('GET', '/api/personel-karne/itiraz-bekleyen', cg)).json().map((x: { kimlik: string }) => x.kimlik)).toContain(t);
    expect((await o.ist('POST', `/api/personel-karne/itiraz/${t}/karar`, cg, { karar: 'Kabul' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/personel-karne/itiraz/${t}/karar`, cg, { karar: 'Kısmi Kabul', gerekce: 'Veri düzeltildi' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, onceki_puan::float p FROM personel_karne_itiraz WHERE kimlik = $1`, [t])).rows[0]).toEqual({ durum: 'Kısmi Kabul', p: 62.1 });
    expect((await o.kart('Personel Karne İtirazı', t)).durum).toBe('Tamamlandı');
  });
  it('dönem kapanış görevi ayda bir; ağırlık değişikliği toplamı 100 ise CEO onayıyla yürürlüğe girer', async () => {
    const S = new Date('2026-11-02T09:00:00Z'); expect(await karneKapanisGorevi(o.db, S)).toBe(true); expect(await karneKapanisGorevi(o.db, S)).toBe(false);
    const gs = (await o.sup.query(`SELECT kimlik, agirlik::float a FROM karne_gosterge WHERE rol_adi = 'Dosya Sorumlusu' ORDER BY sira`)).rows; expect(gs[0].a).toBe(30);
    const d = gs.map((x, n) => ({ kimlik: x.kimlik, agirlik: n === 0 ? x.a - 5 : n === 1 ? x.a + 5 : x.a })); const opm = await o.gir('opm'); const u = '/api/personel-karne/agirlik';
    expect((await o.ist('POST', u, await o.gir('iks'), { rol: 'Dosya Sorumlusu', degerler: d, gerekce: 'G' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, opm, { rol: 'Dosya Sorumlusu', degerler: d.slice(1), gerekce: 'G' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, opm, { rol: 'Dosya Sorumlusu', degerler: d, gerekce: 'G' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT agirlik::float a FROM karne_gosterge WHERE kimlik = $1`, [gs[0].kimlik])).rows[0].a).toBe(30);
    expect((await o.karar((await o.kart('Karne Ağırlık Değişikliği', r.json().kimlik)).kimlik, 'cg', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT agirlik::float a FROM karne_gosterge WHERE kimlik = $1`, [gs[0].kimlik])).rows[0].a).toBe(25);
  });
});
