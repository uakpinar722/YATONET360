import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { oy: 'Operasyon Yöneticisi' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test104', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('firma uygunluk listesi', () => {
  it('200 firmadan sonra eklenen firma da seçilebilir; çıkarılmış firma listede yok', async () => {
    await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) SELECT 'S-U' || n, 'A Firma ' || lpad(n::text, 3, '0'), 'Çözüm Ortağı', 'Onaylı', 'Aktif', $1 FROM generate_series(1, 210) n`, [o.K.oy]);
    await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ('S-UZ','Zz Son Firma','Çözüm Ortağı','Onaylı','Aktif',$1), ('S-UC','Zz Çıkarılan','Çözüm Ortağı','Onaylı','Çıkarıldı',$1)`, [o.K.oy]);
    const l = (await o.ist('GET', '/api/firma/uygunluk', await o.gir('oy'))).json() as { ticari_unvan: string; engel: string | null }[];
    expect(l.find((f) => f.ticari_unvan === 'Zz Son Firma')).toMatchObject({ engel: null });
    expect(l.some((f) => f.ticari_unvan === 'Zz Çıkarılan')).toBe(false);
  }, 120_000);
});
