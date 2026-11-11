import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ilerlemeOzetiIsle, karadaHatirlatIsle } from '../src/hatirlatma_ek.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', tu: 'Teknik Uzman' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test110', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('ilerleme özeti kartı ve yat karada hatırlatması (YG-1640, 555, 1453)', () => {
  it('Yüksek öncelikte Pazartesi kart açılır, Salı açılmaz; aynı gün ikinci kez açılmaz; son zaman 12:00', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET statu = 'Aktif', oncelik = 'Yüksek', dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    expect(await ilerlemeOzetiIsle(o.db, new Date('2026-11-17T06:00:00Z'))).toBe(0); // Salı
    expect(await ilerlemeOzetiIsle(o.db, new Date('2026-11-16T06:00:00Z'))).toBeGreaterThanOrEqual(1); // Pazartesi
    expect(await ilerlemeOzetiIsle(o.db, new Date('2026-11-16T07:00:00Z'))).toBe(0);
    const k = await o.kart('İlerleme Özetini Gönder', d.kimlik);
    expect(new Date(k.son_zaman).toISOString()).toBe('2026-11-16T09:00:00.000Z');
  });
  it('yat karada işaretlenince çekilemeyen açılar Teknik Uzmana bir kez hatırlatılır', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET statu = 'Aktif', dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Teknik Uzman',$3)`, [d.kimlik, o.K.tu, o.K.ds]);
    await o.sup.query(`INSERT INTO gorsel_kanit (dosya_ref, ceken_ref, asama, cekim_kalemi, cekilemedi_nedeni) VALUES ($1,$2,'Keşif','Karina altı','Yat suda')`, [d.kimlik, o.K.tu]);
    expect(await karadaHatirlatIsle(o.db)).toBe(0);
    const r = (await o.ist('POST', `/api/dosya/${d.kimlik}/yat-karada`, await o.gir('ds'))).json();
    expect(r).toMatchObject({ hatirlatma: 1, cekilemeyen: 1 });
    expect(await karadaHatirlatIsle(o.db)).toBe(0);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE '%çekilemeyen açılar%'`, [o.K.tu])).rows[0].n).toBe(1);
  });
});
