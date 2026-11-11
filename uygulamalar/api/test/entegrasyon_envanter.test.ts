import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envanterIsle, topluDogrula } from '../src/entegrasyon_envanter.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', sy: 'Sistem Yöneticisi', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test102', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const ozet = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('entegrasyon envanteri (YG-1297, 1298, 1300, 1315, 1317)', () => {
  it('temel bağlantılar envanterde; veri sözleşmesi satırı eksiksiz olmalı; doğrulanmayan üretim bağlantısı incelemeye alınır', async () => {
    const btd = await o.gir('btd');
    const v = (await o.ist('GET', '/api/entegrasyon-envanteri', btd)).json();
    for (const ad of ['Muhasebe Hizmeti (e-Fatura, e-Arşiv)', 'E-posta', 'SMS', 'WhatsApp', 'KEP ve e-İmza', 'İYS (İleti Yönetim Sistemi)', 'Banka', 'TCMB Döviz Kuru', 'Harita']) expect(v.baglantilar.some((x: { ad: string }) => x.ad === ad)).toBe(true);
    const tcmb = v.baglantilar.find((x: { ad: string }) => x.ad === 'TCMB Döviz Kuru').kimlik;
    expect((await o.ist('POST', `/api/entegrasyon-envanteri/${tcmb}`, btd, { veriSozlesmesi: [{ kaynakAlan: 'ForexSelling' }] })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/entegrasyon-envanteri/${tcmb}`, btd, { surum: 'v1', veriSozlesmesi: [{ kaynakAlan: 'ForexSelling', hedefAlan: 'kur', guncellenme: 'Her iş günü 15:30' }] })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT veri_sozlesmesi->0->>'donusum' d FROM entegrasyon_tanimi WHERE kimlik = $1`, [tcmb])).rows[0].d).toBe('Yok');
    await o.sup.query(`UPDATE entegrasyon_tanimi SET durum = 'Üretimde' WHERE kimlik = $1`, [tcmb]);
    expect(await envanterIsle(o.db)).toBeGreaterThanOrEqual(1);
    expect((await o.kart('Entegrasyon İncelemesi', tcmb)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/entegrasyon-envanteri/${tcmb}/dogrula`, btd, { gerekce: 'Muhasebe kur için kullanıyor' })).json().durum).toBe('Üretimde');
    expect((await o.ist('GET', '/api/entegrasyon-envanteri', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('toplu aktarım: bütünlük, sayı ve şema uyuşmazlığında karantina; kısmi kabulde reddedilenler ayrı', async () => {
    const icerik = JSON.stringify([{ dis_kimlik: 'A' }, { dis_kimlik: 'A' }, { tutar: 5 }]);
    expect(topluDogrula({ beyanSayi: 3, beyanOzet: '0'.repeat(64), semaSurumu: 'v1', beklenenSema: 'v1', icerik }).sonuc).toBe('Karantina');
    expect(topluDogrula({ beyanSayi: 2, beyanOzet: ozet(icerik), semaSurumu: 'v1', beklenenSema: 'v1', icerik }).neden).toMatch(/Kayıt sayısı/);
    expect(topluDogrula({ beyanSayi: 3, beyanOzet: ozet(icerik), semaSurumu: 'v2', beklenenSema: 'v1', icerik }).neden).toMatch(/Şema/);
    const d = topluDogrula({ beyanSayi: 3, beyanOzet: ozet(icerik), semaSurumu: 'v1', beklenenSema: 'v1', icerik });
    expect(d).toMatchObject({ sonuc: 'Kısmi Kabul', kabul: 1 }); expect(d.red.map((r) => r.neden)).toEqual(['Tekrarlanan dış kimlik', 'Dış kimlik yok']);
    const banka = (await o.sup.query(`SELECT kimlik FROM entegrasyon_tanimi WHERE ad = 'Banka'`)).rows[0].kimlik;
    const r = (await o.ist('POST', `/api/entegrasyon-envanteri/${banka}/toplu-aktarim`, await o.gir('sy'), { donem: '2026-11', kaynak: 'Banka ekstresi', beyanSayi: 3, beyanOzet: ozet(icerik), semaSurumu: 'v1', icerik })).json();
    expect(r.sonuc).toBe('Kısmi Kabul');
  });
});
