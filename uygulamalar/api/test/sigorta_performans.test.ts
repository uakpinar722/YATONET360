import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onayliPerformans, sigortaPerformansIsle } from '../src/sigorta_performans.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { my: 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü', skg: 'Strateji ve Kurumsal Gelişim Direktörü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test97', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('sigortacı aylık performans raporu (YG-767)', () => {
  it('ay başında açılır; veri 3. iş günü, rapor 5. iş günü 12:00; Müdür hazırlar, Direktör onaylar; onaylı rapor mutabakat belgesine girer', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi) VALUES ($1,'Deneme Sigorta') ON CONFLICT (dosya_ref) DO UPDATE SET sigortaci_adi = 'Deneme Sigorta'`, [d.kimlik]);
    expect(await sigortaPerformansIsle(o.db, new Date('2026-12-01T06:00:00Z'))).toBeGreaterThanOrEqual(1);
    const r = (await o.sup.query(`SELECT kimlik, veri_son, hazir_son FROM sigorta_performans_raporu WHERE sigortaci_adi = 'Deneme Sigorta' AND donem = '2026-11'`)).rows[0];
    expect(new Date(r.veri_son).getUTCHours()).toBe(9); expect(+new Date(r.hazir_son)).toBeGreaterThan(+new Date(r.veri_son));
    expect((await o.kart('Sigorta Performans Verisi', r.kimlik)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/sigorta-performans/${r.kimlik}/veri`, await o.gir('mpm'))).statusCode).toBe(404);
    const v = (await o.ist('POST', `/api/sigorta-performans/${r.kimlik}/veri`, await o.gir('my'))).json().veri;
    expect(v).toMatchObject({ dosyaSayisi: expect.any(Number), sikayet: 0 });
    expect((await o.ist('POST', `/api/sigorta-performans/${r.kimlik}/onaya`, await o.gir('mpm'), { not: 'Süre uyumu iyi' })).statusCode).toBe(200);
    const k = (await o.kart('Sigorta Performans Onayı', r.kimlik)).kimlik;
    expect((await o.karar(k, 'skg', 'Onayla')).statusCode).toBe(200);
    expect(await onayliPerformans(o.db, 'Deneme Sigorta', '2026-11')).toMatchObject({ mudur_notu: 'Süre uyumu iyi' });
    expect(await sigortaPerformansIsle(o.db, new Date('2026-12-02T06:00:00Z'))).toBe(0);
  });
});
