import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isGunuSayisi, orneklemSec, yonetimEkIsle } from '../src/yonetim_ek.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { cg: 'CEO', gmy: 'Genel Müdür Yardımcısı', tid: 'Ticari İşler Direktörü', idm: 'İç Denetim Müdürü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test93', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('yönetim raporu ekleri (YG-764, 769, 770, 779, 781, 808, 1462, 1536)', () => {
  it('iş günü sayısı Pazarı saymaz', async () => {
    expect(await isGunuSayisi(o.db, new Date('2026-11-06T09:00:00Z'), new Date('2026-11-09T09:00:00Z'))).toBe(2); // Cuma→Pazartesi: Cumartesi + Pazartesi
  });
  it('yoğunlaşma payları, kademe atlama, marka/model ve yetki', async () => {
    const d = await o.dosyaAc();
    for (const [m, t] of [['A Sigorta', 700], ['B Sigorta', 200], ['C', 50], ['D', 50]] as const)
      await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, fatura_tarihi, hazirlayan_ref) VALUES ($1,$2,$3,$4,0,$4,'Faturalandı','2026-10-15',$5)`, [`PF-${m}`, d.kimlik, m, t, o.K.ds]).catch(async (e) => { throw e; });
    const r = (await o.ist('GET', '/api/yonetim-ekleri?donem=2026-11', await o.gir('tid'))).json();
    expect(r.yogunlasma).toMatchObject({ ilk1: 70, ilk3: 95 });
    expect(r.yogunlasma.uyari).toHaveLength(2);
    expect(r.markaModel.onayli.length + r.markaModel.onayBekleyen.length).toBeGreaterThan(0);
    expect((await o.ist('GET', '/api/yonetim-ekleri', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('kapanan dosyaların %10 örneklemi bir kez seçilir ve İç Denetim Müdürüne görev olur', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET statu = 'Kapalı', kapanma_nedeni = 'İş tamamlandı', kapanis_zamani = '2026-09-10' WHERE kimlik = $1`, [d.kimlik]);
    expect(await orneklemSec(o.db, '2026-09')).toBe(1);
    expect(await orneklemSec(o.db, '2026-09')).toBe(0);
    expect((await o.ist('GET', '/api/ic-denetim/orneklem', await o.gir('idm'))).json().some((x: { kimlik: string }) => x.kimlik === d.kimlik)).toBe(true);
    expect((await o.kart('İç Denetim Örneklemi', '2026-09')).durum).toBe('Bekliyor');
    expect(await yonetimEkIsle(o.db, new Date('2026-11-02T08:00:00Z'))).toBeGreaterThanOrEqual(1);
  });
});
