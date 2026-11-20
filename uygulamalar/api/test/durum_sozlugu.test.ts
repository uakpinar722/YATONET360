import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { bim: 'Bilgi İşlem Müdürü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test91', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('birleşik durum sözlüğü (YG-1365)', () => {
  it('tüm durumlar tanımlı gelir; ortak ad tek anlamlı; yetkili günceller; farklı anlam ve yanlış geçiş reddedilir', async () => {
    const ds = await o.gir('ds'); const bim = await o.gir('bim');
    const v = (await o.ist('GET', '/api/durum-sozlugu', ds)).json();
    expect(v.yetkili).toBe(false);
    expect(v.ozet.tanimli).toBe(v.ozet.durum); expect(v.cakisma).toEqual([]);
    const prb = v.turler.find((t: { kayit_turu: string }) => t.kayit_turu === 'problem_kaydi');
    expect(prb.durumlar).toEqual(['Açık', 'Kapalı']);
    const acik = prb.tanimlar.find((x: { durum: string }) => x.durum === 'Açık').tanim;
    expect(acik.is_anlami).toBeTruthy();
    const tem = { kayitTuru: 'problem_kaydi', durum: 'Açık', isAnlami: acik.is_anlami, girisKosulu: 'Kayıt açıldı', cikisKosulu: 'Kök neden ve kalıcı çözüm', yetkiliRol: 'Bilgi İşlem Müdürü', izinliGecisler: ['Kapalı'] };
    expect((await o.ist('POST', '/api/durum-sozlugu', ds, tem)).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/durum-sozlugu', bim, { ...tem, izinliGecisler: ['Yok'] })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/durum-sozlugu', bim, { ...tem, yetkiliRol: 'Uydurma Rol' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/durum-sozlugu', bim, { ...tem, isAnlami: 'Başka bir anlam' })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/durum-sozlugu', bim, tem)).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/durum-sozlugu', bim, { ...tem, yetkiliRol: 'Sistem' })).statusCode).toBe(200);
  });
  it('T-YG060: sözlükte izinli olmayan geçiş ihlal olarak kaydedilir ve listelenir; izinli geçiş kaydedilmez', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu) VALUES ($1, 'Geçiş Denemesi', 'Çözüm Ortağı') RETURNING kimlik`, [`S-GD${Date.now()}`])).rows[0].kimlik;
    const d = (await o.sup.query(`INSERT INTO firma_denetim_plani (kurulus_ref, tur, planlanan_tarih, denetci_ref, risk_gerekcesi, planlayan_ref) VALUES ($1, 'Takip', current_date, $2, 'R', $3) RETURNING kimlik`, [f, o.K.ds, o.K.bim])).rows[0].kimlik;
    const n = async () => (await o.sup.query(`SELECT count(*)::int n FROM durum_gecis_ihlali WHERE kayit_kimligi = $1`, [d])).rows[0].n;
    await o.sup.query(`UPDATE firma_denetim_plani SET durum = 'Tamamlandı' WHERE kimlik = $1`, [d]); expect(await n()).toBe(0);
    await o.sup.query(`UPDATE firma_denetim_plani SET durum = 'Planlandı' WHERE kimlik = $1`, [d]); expect(await n()).toBe(1);
    const v = (await o.ist('GET', '/api/durum-sozlugu', await o.gir('ds'))).json();
    expect(v.ihlaller.some((x: { kayit_turu: string; eski: string; yeni: string }) => x.kayit_turu === 'firma_denetim_plani' && x.eski === 'Tamamlandı' && x.yeni === 'Planlandı')).toBe(true);
  });
});
