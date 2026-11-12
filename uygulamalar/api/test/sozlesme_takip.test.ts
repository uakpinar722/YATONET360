import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sahipOnerisi, sozlesmeYenilemeIsle } from '../src/sozlesme_takip.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { hud: 'Hukuk ve Uyum Direktörü', mp: 'Müşteri ve Paydaş İlişkileri Müdürü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test117', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('sözleşme takip (YG-614)', () => {
  it('sahip türden önerilir; zorunlu alanlar; imzalı nüsha ve imza türü olmadan yürürlüğe girmez; otomatik yenileme ve sona erme', async () => {
    expect(await sahipOnerisi(o.db, 'Sigorta Şirketi')).toBe('Müşteri ve Paydaş İlişkileri Müdürü');
    const mp = await o.gir('mp');
    const G = { tur: 'Sigorta Şirketi', tarafAdi: 'Deneme Sigorta A.Ş.', yururluk: '2025-01-01', bitis: '2025-12-31', otomatikYenileme: true, yenilemeAy: 12, fesihGun: 60, kanal: 'kep@deneme.local', yetkililer: 'Hasar Müdürü (onay)' };
    expect((await o.ist('POST', '/api/sozlesme-takip', await o.gir('ds'), G)).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/sozlesme-takip', mp, { ...G, fesihGun: undefined })).json().hata).toMatch(/fesih bildirim/);
    expect((await o.ist('POST', '/api/sozlesme-takip', mp, { ...G, kanal: '' })).statusCode).toBe(400);
    const r = (await o.ist('POST', '/api/sozlesme-takip', mp, G)).json(); expect(r.sahipRol).toBe('Müşteri ve Paydaş İlişkileri Müdürü');
    expect((await o.sup.query(`SELECT fesih_bildirim_son::text f, durum FROM sozlesme_kaydi WHERE kimlik = $1`, [r.kimlik])).rows[0]).toEqual({ f: '2025-11-01', durum: 'Taslak' });
    const nusha = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('İmzalı','Sözleşme','Kuruluş',gen_random_uuid()::text,'Sistem',current_date,$1) RETURNING kimlik`, [o.K.mp])).rows[0].kimlik;
    expect((await o.ist('POST', `/api/sozlesme-takip/${r.kimlik}/yururluk`, mp, { belge: nusha })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/sozlesme-takip/${r.kimlik}/yururluk`, mp, { belge: nusha, imzaTuru: 'Güvenli Elektronik İmza' })).json().durum).toBe('Yürürlükte');
    expect(await sozlesmeYenilemeIsle(o.db, new Date('2026-01-05T09:00:00Z'))).toBeGreaterThan(0);
    expect((await o.sup.query(`SELECT bitis::text b, kendiliginden_yenilendi k, durum FROM sozlesme_kaydi WHERE kimlik = $1`, [r.kimlik])).rows[0]).toEqual({ b: '2026-12-31', k: true, durum: 'Yürürlükte' });
    expect((await o.ist('POST', `/api/sozlesme-takip/${r.kimlik}/karar`, mp, { karar: 'Fesih', gerekce: 'Yeniden yapılandırma' })).statusCode).toBe(200);
    await sozlesmeYenilemeIsle(o.db, new Date('2027-01-05T09:00:00Z'));
    expect((await o.sup.query(`SELECT durum FROM sozlesme_kaydi WHERE kimlik = $1`, [r.kimlik])).rows[0].durum).toBe('Sona Erdi');
    expect((await o.ist('GET', '/api/sozlesme-takip', await o.gir('hud'))).json().kayitlar.length).toBeGreaterThan(0);
  });
});
