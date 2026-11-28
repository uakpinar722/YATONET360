import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { denemeZinciri } from '../src/akademi.js';
import { rolId } from '../src/ihbar.js';
import { karneMakami } from '../src/personel_karne.js';
import { ortamKur, type Ortam } from './yardimci.js';

// YG-1692: Kalite Müdürü Risk ve Kalite Direktörüne vekâlet ederken İç Denetim Müdürünün izin kararı idari silsileyle "Vekâleten" Kalite Müdürüne düşer;
// iç denetim kayıtları ve raporları ne Direktöre ne vekiline açılır; İç Denetim Müdürünün karnesi ve deneme süresi kararı CEO'dadır.
const KADRO = { vidm: 'İç Denetim Müdürü', vkm: 'Kalite Müdürü', vrkd: 'Risk ve Kalite Direktörü', vceo: 'CEO' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test_kalite_vekalet', KADRO); });
afterAll(async () => { await o.kapat(); });

describe('Kalite Müdürünün Direktör vekâleti (YG-1692)', () => {
  it('İç Denetim Müdürünün izni vekile Vekâleten düşer; iç denetim kayıtları vekile ve Direktöre kapalıdır', async () => {
    const rkd = await rolId(o.sup as never, 'Risk ve Kalite Direktörü');
    await o.sup.query(`INSERT INTO vekalet (kimlik, asil_ref, vekil_ref, rol_ref, vekalet_nedeni, kapsam, baslangic_tarihi, bitis_tarihi, atayan_ref) VALUES ('VKL-2026-9692',$1,$2,$3,'İzin','Açık işler',current_date,current_date + 5,$1)`, [o.K.vrkd, o.K.vkm, rkd]);
    const g = new Date(Date.now() + 21 * 86_400_000); while ([0, 6].includes(g.getDay())) g.setDate(g.getDate() + 1);
    const t = g.toISOString().slice(0, 10);
    const r = await o.ist('POST', '/api/izin', await o.gir('vidm'), { tur: 'Mazeret', baslangic: t, bitis: t }); expect(r.statusCode, r.body).toBe(200);
    const k = await o.kart('İzin Talebi', r.json().kimlik);
    expect(k.zincir).toEqual([rkd]); // idari silsile: İç Denetim Müdürlüğü → Risk ve Kalite Direktörü
    const kr = await o.karar(k.kimlik, 'vkm', 'Onayla'); expect(kr.statusCode, kr.body).toBe(200);
    expect((await o.sup.query(`SELECT vekaleten FROM is_karti_adim WHERE is_ref = $1 AND yapan_ref = $2`, [k.kimlik, o.K.vkm])).rows[0].vekaleten).toBe(true);
    for (const x of ['vkm', 'vrkd']) expect((await o.ist('GET', '/api/ic-denetim', await o.gir(x))).statusCode).toBe(404);
    expect((await o.ist('GET', '/api/ic-denetim', await o.gir('vceo'))).statusCode).toBe(200);
  });
  it('İç Denetim Müdürünün karnesi ve deneme süresi kararı CEO\'dadır', async () => {
    const idm = await rolId(o.sup as never, 'İç Denetim Müdürü'); const ceo = await rolId(o.sup as never, 'CEO');
    expect(await denemeZinciri(o.db, idm)).toEqual([ceo]);
    expect(await karneMakami(o.db, { ad: 'İç Denetim Müdürü', kimlik: idm })).toBe(ceo);
  });
});
