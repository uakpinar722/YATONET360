import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kartAc } from '../src/is_motoru.js';
import { rolId } from '../src/ihbar.js';
import { ortamKur, type Ortam } from './yardimci.js';

// YG-990: aynı kişi birden çok rol taşısa da hazırlama ve onay ayrılığı korunur.
const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', id: 'İç Denetim Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test_ayrilik', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('görev ayrılığı (YG-990)', () => {
  it('iki rol taşıyan kişi kendi hazırladığı işi onaylayamaz; diğer sahip onaylar', async () => {
    await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = 'Operasyon Müdürü'`, [o.K.ds]);
    const k = await kartAc(o.db, { tur: 'Deneme Onayı', baslik: 'Deneme', hazirlayan: o.K.ds, zincir: [await rolId(o.db, 'Operasyon Müdürü')] });
    const r = await o.karar(k, 'ds', 'Onayla'); expect(r.statusCode, r.body).not.toBe(200);
    const r2 = await o.karar(k, 'opm', 'Onayla'); expect(r2.statusCode, r2.body).toBe(200);
  });
  it('dönemsel gözetim: çok rollü kişi raporda; ayda bir görev; yetkisiz rapor göremez', async () => {
    const { gorevAyriligiIsle, gorevAyriligiRaporu } = await import('../src/kalan.js');
    const r = await gorevAyriligiRaporu(o.db); expect(r.cokluRol.some((x: { roller: string[] }) => x.roller.includes('Operasyon Müdürü') && x.roller.includes('Dosya Sorumlusu'))).toBe(true);
    expect(await gorevAyriligiIsle(o.db, new Date('2027-01-15T10:00:00Z'))).toBe(1); expect(await gorevAyriligiIsle(o.db, new Date('2027-01-20T10:00:00Z'))).toBe(0);
    expect((await o.ist('GET', '/api/rapor/gorev-ayriligi', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('GET', '/api/rapor/gorev-ayriligi', await o.gir('id'))).json().cokluRol.length).toBeGreaterThan(0);
  });
});
