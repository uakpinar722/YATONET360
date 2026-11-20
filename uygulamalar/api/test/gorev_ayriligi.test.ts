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
  it('YG-313: aynı kişi iki kademede onay verdiyse kayda sonradan bağımsız inceleme görevi açılır; ikinci kez açılmaz', async () => {
    const { gorevAyriligiTelafi } = await import('../src/kalan.js');
    const k = (await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, hazirlayan_ref, zincir) SELECT 'Deneme Onayı', 'onay', 'Telafi Denemesi', $1, ARRAY[kimlik, kimlik] FROM rol WHERE rol_adi = 'Operasyon Müdürü' RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    for (const kd of [0, 1]) await o.sup.query(`INSERT INTO is_karti_adim (is_ref, kademe, karar, yapan_ref) VALUES ($1, $2, 'Onayla', $3)`, [k, kd, o.K.opm]);
    expect(await gorevAyriligiTelafi(o.db, '2027-02')).toBeGreaterThan(0);
    const t = (await o.sup.query(`SELECT c.sahip_rol_ref, r.rol_adi FROM is_karti c JOIN rol r ON r.kimlik = c.sahip_rol_ref WHERE c.tur = 'Görev Ayrılığı Telafi İncelemesi' AND c.nesne_kimligi = $1`, [k])).rows;
    expect(t).toHaveLength(1); expect(t[0].rol_adi).toBe('İç Denetim Müdürü');
    await gorevAyriligiTelafi(o.db, '2027-03');
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Görev Ayrılığı Telafi İncelemesi' AND nesne_kimligi = $1`, [k])).rows[0].n).toBe(1);
  });
});
