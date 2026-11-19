import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isgAylikRapor } from '../src/isg_ek.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { isg: 'İSG Sorumlusu', ikm: 'İnsan Kaynakları Müdürü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test122', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('İSG kayıtları (YG-1670)', () => {
  it('sağlık gözetiminde yalnız tarih ve sonuç; uygun değilse İK Müdürü bilgilenir; OSGB yazışması (T-YG1670)', async () => {
    const isg = await o.gir('isg');
    expect((await o.ist('POST', '/api/isg/saglik-gozetimi', await o.gir('ds'), { personel: o.K.ds, tarih: '2026-11-01', sonuc: 'Çalışmaya Uygun' })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/isg/saglik-gozetimi', isg, { personel: o.K.ds, tarih: '2026-11-01', sonuc: 'Hipertansiyon' })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/isg/saglik-gozetimi', isg, { personel: o.K.ds, tarih: '2026-11-01', sonuc: 'Çalışmaya Uygun Değil', sonraki: '2027-05-01' });
    expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [o.K.ikm, `saglik-uygun-degil:${r.json().kimlik}`])).rowCount).toBe(1);
    const ik = (await o.ist('GET', '/api/isg/kayitlar', await o.gir('ikm'))).json();
    expect(ik.isg).toBe(false); expect(ik.personel).toEqual([]); expect(ik.gozetim[0]).toMatchObject({ sonuc: 'Çalışmaya Uygun Değil' });
    expect((await o.ist('POST', '/api/isg/osgb', isg, { yon: "OSGB'den Gelen", konu: 'Risk değerlendirmesi revizyonu', tarih: '2026-11-10' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/isg/kayitlar', isg)).json().osgb).toHaveLength(1);
    expect((await o.ist('GET', '/api/isg/kayitlar', await o.gir('ds'))).statusCode).toBe(404);
    // aylık İSG göstergeleri: Kasım dönemi, Aralık başında bir kez
    expect(await isgAylikRapor(o.db, new Date('2026-12-01T06:00:00Z'))).toBe(true); expect(await isgAylikRapor(o.db, new Date('2026-12-02T06:00:00Z'))).toBe(false);
    expect((await o.kart('Aylık İSG Göstergeleri', '2026-11')).ozet).toContain('uygun değil 1');
  });
});
