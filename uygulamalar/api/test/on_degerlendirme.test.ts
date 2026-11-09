import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RISKLER } from '../src/on_degerlendirme.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', ds2: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test80', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('RP-OPS-001 Ön Değerlendirme Raporu (YG-651)', () => {
  it('yalnız Dosya Sorumlusu; alanlar ve risk taraması zorunlu; yeni kayıt yeni sürüm; iç rapor tanımı renkli risk içerir', async () => {
    const d = (await o.dosyaAc({}, {})).kimlik as string; await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d, o.K.ds]);
    const ds = await o.gir('ds'); const u = `/api/dosya/${d}/on-degerlendirme`;
    const G: Record<string, unknown> = { sonBilgi: '2026-11-01', kaynaklar: 'K', yeterlilik: 'Kısmen Yeterli', yeterlilikGerekcesi: 'G', uzmanliklar: 'U', sonuc: 'S', yontem: 'Keşif', oncelikTeyidi: 'Normal', kapsam: 'K', kronoloji: 'K', olgular: 'O', beyanlar: 'B', sonrakiAdim: 'A', acikKonular: 'A', risk: Object.fromEntries(RISKLER.map((r, n) => [r, n === 0 ? 'Evet' : 'Hayır'])) };
    expect((await o.ist('POST', u, await o.gir('ds2'), G)).statusCode).toBe(404);
    expect((await o.ist('POST', u, ds, { ...G, sonuc: '' })).statusCode).toBe(400); expect((await o.ist('POST', u, ds, { ...G, risk: {} })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, G)).json().surum).toBe(1); expect((await o.ist('POST', u, ds, { ...G, sonuc: 'Yeni bilgi' })).json().surum).toBe(2);
    const rows = (await o.sup.query(`SELECT kimlik, surum, veriler->>'sonuc' s FROM on_degerlendirme WHERE dosya_ref = $1 ORDER BY surum`, [d])).rows; expect(rows.map((x) => x.s)).toEqual(['S', 'Yeni bilgi']);
    expect((await o.sup.query(`SELECT count(*)::int n FROM belge_uretim WHERE tur = 'Ön Değerlendirme Raporu' AND dosya_ref = $1`, [d])).rows[0].n).toBe(2);
    const { onDegerlendirmeTanim } = await import('../src/belge_uret.js'); const v = await onDegerlendirmeTanim(o.db, rows[0].kimlik);
    expect(v.t).toMatchObject({ kod: 'RP-OPS-001', icKayit: true, surum: 'Rev.1' });
    const tablo = v.t.bolumler.find((b) => b.tur === 'tablo' && b.satirlar.some((s) => typeof s[1] === 'object')); expect(tablo).toBeDefined();
  });
});
