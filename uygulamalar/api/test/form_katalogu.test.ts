import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formSecilebilir, gorevFormlari, type Blok } from '../src/form_katalogu.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { tod: 'Teknik ve Operasyon Direktörü', ds: 'Dosya Sorumlusu', km: 'Kalite Müdürü', rkd: 'Risk ve Kalite Direktörü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test112', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const TANIM = JSON.parse(readFileSync(new URL('../../../veri/sablon/rol_gorev_tanimlari.json', import.meta.url), 'utf-8')) as Record<string, Blok[]>;
const kodlar = async (rol: string) => {
  const b = await gorevFormlari(o.db, rol, TANIM[rol] ?? []);
  const i = b.findIndex((x) => x.t === 'b' && x.m === 'Kullandığı formlar ve kayıtlar'); const s = b.findIndex((x, j) => j > i && x.t === 'b');
  return b.slice(i + 1, s < 0 ? undefined : s).map((x) => x.m);
};

describe('belge kataloğu (YG-601, YG-632, YG-633, YG-1513)', () => {
  it('Ek II kataloğu yüklü; iptal kodu yeniden verilmez; taslak seçilemez; kayıt silinemez', async () => {
    expect(Number((await o.sup.query(`SELECT count(*) n FROM form_katalogu`)).rows[0].n)).toBe(130);
    expect((await o.sup.query(`SELECT durum FROM form_katalogu WHERE kod = 'FR-TIC-001'`)).rows[0].durum).toBe('İptal');
    const tod = await o.gir('tod'); const ds = await o.gir('ds');
    expect((await o.ist('POST', '/api/form-katalogu', ds, { kod: 'FR-OPS-099', ad: 'X', sinif: 'İç', bicim: 'Ekran adımı' })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/form-katalogu', tod, { kod: 'FR-TIC-001', ad: 'Yeni', sinif: 'İç', bicim: 'Ekran adımı' })).json().hata).toMatch(/yeniden verilemez/);
    expect((await o.ist('POST', '/api/form-katalogu', tod, { kod: 'FR-OPS-099', ad: 'Deneme Formu', sinif: 'İç', bicim: 'Ekran adımı', dolduran: 'Dosya Sorumlusu' })).statusCode).toBe(200);
    expect(await formSecilebilir(o.db, 'FR-OPS-099')).toBe(false);
    const secim = async () => ((await o.ist('GET', '/api/form-katalogu?secim=1', ds)).json().kalemler as { kod: string }[]).map((x) => x.kod);
    expect(await secim()).not.toContain('FR-OPS-099'); expect(await secim()).not.toContain('FR-TIC-001');
    expect((await o.ist('POST', '/api/form-katalogu/FR-OPS-099/durum', tod, { durum: 'Yürürlükte' })).statusCode).toBe(200);
    expect(await secim()).toContain('FR-OPS-099');
    expect((await o.ist('POST', '/api/form-katalogu/FR-OPS-099/durum', tod, { durum: 'Yeni Sürüm', gerekce: 'Alan eklendi' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, surum FROM form_katalogu WHERE kod = 'FR-OPS-099'`)).rows[0]).toMatchObject({ durum: 'Taslak', surum: 2 });
    expect((await o.ist('POST', '/api/form-katalogu/FR-OPS-099/durum', tod, { durum: 'İptal' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/form-katalogu/FR-OPS-099/durum', tod, { durum: 'İptal', gerekce: 'Deneme bitti' })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/form-katalogu/FR-OPS-099/durum', tod, { durum: 'Yürürlükte' })).statusCode).toBe(409);
    await expect(o.sup.query(`UPDATE form_katalogu SET durum = 'Yürürlükte' WHERE kod = 'FR-OPS-099'`)).rejects.toThrow(/İptal/);
    await expect(o.sup.query(`DELETE FROM form_katalogu WHERE kod = 'FR-OPS-099'`)).rejects.toThrow(/silinemez/);
    expect((await o.ist('POST', '/api/form-katalogu', tod, { kod: 'FR-OPS-099', ad: 'Tekrar', sinif: 'İç', bicim: 'Ekran adımı' })).statusCode).toBe(409);
  });

  it('alanlar sözlükten gelir; görev tanımı form listesi katalogdan üretilir', async () => {
    const ds = await o.gir('ds');
    const a = (await o.ist('GET', '/api/form-katalogu/FR-OPS-009/alanlar', ds)).json();
    expect(a.alanlar.length).toBeGreaterThan(0); expect(a.dolduran).toBeTruthy();
    const d = await kodlar('Dosya Sorumlusu');
    for (const k of ['FR-OPS-017', 'FR-OPS-018', 'FR-HUK-003', 'FR-KLT-016']) expect(d.some((x) => x.startsWith(k))).toBe(true);
    expect(d.some((x) => x.startsWith('FR-OPS-002') || x.startsWith('FR-UYG-002'))).toBe(false);
    expect((await kodlar('Teknik Uzman')).some((x) => x.startsWith('FR-OPS-019'))).toBe(true);
    expect((await kodlar('Teknik Uzman')).some((x) => x.startsWith('KL-TEK-015'))).toBe(true);
    const om = await kodlar('Operasyon Müdürü'); for (const k of ['FR-OPS-018', 'FR-OPS-019']) expect(om.some((x) => x.startsWith(k))).toBe(true);
    expect((await kodlar('Müşteri ve Paydaş İlişkileri Müdürü')).find((x) => x.startsWith('FR-KLT-016'))).toMatch(/onaylar/);
  });
  it('Ek II Değişiklik Talebi Risk ve Kalite Direktörü onayıyla yeni sürüm açar; aylık kalite göstergeleri (T-YG1691)', async () => {
    const kod = (await o.sup.query(`SELECT kod, surum FROM form_katalogu WHERE durum = 'Yürürlükte' AND kod LIKE 'FR-KLT-%' ORDER BY kod LIMIT 1`)).rows[0];
    expect((await o.ist('POST', `/api/form-katalogu/${kod.kod}/degisiklik-talebi`, await o.gir('ds'), { degisiklik: 'X', gerekce: 'Y' })).statusCode).toBe(404);
    const r = await o.ist('POST', `/api/form-katalogu/${kod.kod}/degisiklik-talebi`, await o.gir('km'), { degisiklik: 'Ölçüm alanı eklenmesi', gerekce: 'Saha geri bildirimi' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.karar((await o.kart('Ek II Değişiklik Talebi', r.json().kimlik)).kimlik, 'rkd', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, surum FROM form_katalogu WHERE kod = $1`, [kod.kod])).rows[0]).toEqual({ durum: 'Taslak', surum: kod.surum + 1 });
    const { aylikKaliteGostergeleri } = await import('../src/kalite_disiplin.js');
    expect(await aylikKaliteGostergeleri(o.db, new Date('2031-09-01T09:00:00+03:00'))).toBe(true); expect((await o.kart('Aylık Kalite Göstergeleri', '2031-08')).zincir).toHaveLength(2);
  });
});
