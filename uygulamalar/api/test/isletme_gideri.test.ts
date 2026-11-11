import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tavanDegerlendirmeIsle } from '../src/isletme_gideri.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', bim: 'Bilgi İşlem Müdürü', cg: 'CEO' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test107', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('YATONET 360 işletme gideri tavanı (YG-930)', () => {
  it('tavan içi kayıt; tavanı aşanı yalnız Direktör gerekçeyle girer, CEO onaylar; 3 ay sonra değerlendirme görevi bir kez', async () => {
    const bim = await o.gir('bim'); const btd = await o.gir('btd');
    expect((await o.ist('POST', '/api/yatonet-gideri', bim, { ay: '2026-12', kalem: 'Sunucu', saglayici: 'Sağlayıcı A', tutar: 1200 })).json().durum).toBe('Kayıtlı');
    expect((await o.ist('POST', '/api/yatonet-gideri', bim, { ay: '2026-12', kalem: 'SMS', saglayici: 'Sağlayıcı B', tutar: 500 })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/yatonet-gideri', btd, { ay: '2026-12', kalem: 'SMS', saglayici: 'Sağlayıcı B', tutar: 500 })).statusCode).toBe(400);
    const k = (await o.ist('POST', '/api/yatonet-gideri', btd, { ay: '2026-12', kalem: 'SMS', saglayici: 'Sağlayıcı B', tutar: 500, gerekce: 'Açılış ayı yoğunluğu' })).json();
    expect(k.durum).toBe('Onayda');
    expect((await o.karar((await o.kart('YATONET Tavan Üstü Gider', k.kimlik)).kimlik, 'cg', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM yatonet_gideri WHERE kimlik = $1`, [k.kimlik])).rows[0].durum).toBe('Onaylandı');
    expect(await tavanDegerlendirmeIsle(o.db)).toBe(0);
    await o.sup.query(`UPDATE yatonet_gideri SET zaman = now() - interval '100 days'`);
    expect(await tavanDegerlendirmeIsle(o.db)).toBe(1); expect(await tavanDegerlendirmeIsle(o.db)).toBe(0);
  });
});
