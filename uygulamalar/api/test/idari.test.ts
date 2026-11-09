import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', idr: 'İdari İşler Sorumlusu', tid: 'Ticari İşler Direktörü', gmy: 'Genel Müdür Yardımcısı', cg: 'CEO', mfm: 'Muhasebe ve Finans Müdürü', ide: 'İç Denetçi', idm: 'İç Denetim Müdürü', tod: 'Teknik ve Operasyon Direktörü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test71', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('idari talep (YG-1619, YG-1683)', () => {
  const ac = async (k: string) => { const r = await o.ist('POST', '/api/idari-talep', await o.gir(k), { konu: 'Yazıcı', gerekce: 'Arıza' }); expect(r.statusCode, r.body).toBe(200); return r.json().kimlik as string; };
  const kart = async (tur: string, t: string) => (await o.kart(tur, t)).kimlik as string;
  const durum = async (t: string) => (await o.sup.query(`SELECT durum FROM idari_talep WHERE kimlik = $1`, [t])).rows[0].durum as string;
  it('ihtiyaç onayı son makamdan sonra İdari İşlere düşer; sipariş tutara göre TİD, GMY, CEO zincirinden geçer', async () => {
    const t = await ac('ds'); expect(await durum(t)).toBe('İhtiyaç Onayında');
    const idr = await o.gir('idr'); expect((await o.ist('POST', `/api/idari-talep/${t}/siparis`, idr, { tedarikci: 'X', tutar: 100 })).statusCode).toBe(409);
    expect((await o.karar(await kart('İdari Talep', t), 'opm', 'Onayla')).statusCode).toBe(200); expect(await durum(t)).toBe('İdari İşlerde');
    expect((await o.kart('İdari Talep Hazırlığı', t)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/idari-talep/${t}/siparis`, await o.gir('ds'), { tedarikci: 'X', tutar: 100 })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/idari-talep/${t}/siparis`, idr, { tedarikci: 'X', tutar: 7000 })).statusCode).toBe(200);
    const k = await kart('İdari Sipariş', t); expect((await o.karar(k, 'tid', 'Onaya Gönder')).statusCode).toBe(200); expect(await durum(t)).toBe('Sipariş Onayında');
    expect((await o.karar(k, 'gmy', 'Onayla')).statusCode).toBe(200); expect(await durum(t)).toBe('Sipariş Onaylandı');
  });
  it('müdürün talebinde son makam Direktör; İç Denetçide İç Denetim Müdürü', async () => {
    const m = await ac('opm'); expect((await o.karar(await kart('İdari Talep', m), 'tod', 'Onayla')).statusCode).toBe(200); expect(await durum(m)).toBe('İdari İşlerde');
    const d = await ac('ide'); expect((await o.karar(await kart('İdari Talep', d), 'idm', 'Onayla')).statusCode).toBe(200); expect(await durum(d)).toBe('İdari İşlerde');
  });
});

describe('CEO masraf raporu (YG-1677)', () => {
  it('yalnız yetkililer görür; CEO fişi silinemez; çeyrek görevi bir kez', async () => {
    const f = (await o.sup.query(`INSERT INTO personel_masraf_fisi (personel_ref, masraf_turu, fis_tarihi, tutar_tl, kur, tutar_eur, odenecek_eur, miktar, belge_ozeti) VALUES ($1,'Yemek','2026-11-02',400,40,10,10,1,'C1') RETURNING kimlik`, [o.K.cg])).rows[0].kimlik;
    expect((await o.ist('GET', '/api/masraf/ceo-raporu?yil=2026&ceyrek=4', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('GET', '/api/masraf/ceo-raporu?yil=2026&ceyrek=4', await o.gir('mfm'))).json().toplam).toBe(10);
    await expect(o.sup.query(`DELETE FROM personel_masraf_fisi WHERE kimlik = $1`, [f])).rejects.toThrow(/silinemez/);
    const { ceoMasrafRaporIsle } = await import('../src/idari_talep.js'); const S = new Date('2027-01-05T09:00:00Z');
    expect(await ceoMasrafRaporIsle(o.db, S)).toBe(true); expect(await ceoMasrafRaporIsle(o.db, S)).toBe(false);
  });
});
