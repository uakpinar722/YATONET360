import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kaliteKontrolIsle, KURALLAR, oncelik } from '../src/veri_kalitesi.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { bim: 'Bilgi İşlem Müdürü', opm: 'Operasyon Müdürü', ds: 'Dosya Sorumlusu', ide: 'İç Denetçi' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test103', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('veri kalitesi (YG-1249, 1252, 1254, 1255)', () => {
  it('kurallar tek katalogda; ihlal açılır, düzeltilince giderilir; öncelik etkiden; istisnayı veri sahibi verir; kural sürümlenir', async () => {
    expect(new Set(KURALLAR.map((k) => k.kod)).size).toBe(KURALLAR.length);
    expect(oncelik('Ödeme')).toBe('Yüksek'); expect(oncelik('Teslim')).toBe('Orta'); expect(oncelik('Diğer')).toBe('Düşük');
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET statu = 'Aktif', ana_teknik_brans = NULL WHERE kimlik = $1`, [d.kimlik]);
    await kaliteKontrolIsle(o.db);
    const h = (await o.sup.query(`SELECT kimlik, oncelik, durum FROM veri_hatasi WHERE kural_kod = 'VK-01' AND kayit_kimligi = $1`, [d.kimlik])).rows[0];
    expect(h).toMatchObject({ oncelik: 'Orta', durum: 'Açık' });
    const v = (await o.ist('GET', '/api/veri-kalitesi', await o.gir('opm'))).json();
    expect(v.kumeler.map((k: { kod: string }) => k.kod)).toEqual(['DOSYA', 'FATURA', 'FIRMA', 'TARAF', 'YAT']);
    expect(v.sahipOldugu).toContain('DOSYA');
    expect((await o.ist('POST', `/api/veri-hatasi/${h.kimlik}/istisna`, await o.gir('bim'), { gerekce: 'x' })).statusCode).toBe(404);
    await o.sup.query(`UPDATE dosya SET ana_teknik_brans = 'Gövde' WHERE kimlik = $1`, [d.kimlik]);
    await kaliteKontrolIsle(o.db);
    expect((await o.sup.query(`SELECT durum FROM veri_hatasi WHERE kimlik = $1`, [h.kimlik])).rows[0].durum).toBe('Giderildi');
    expect((await o.ist('POST', '/api/kalite-kurali/VK-01', await o.gir('bim'), { esik: 5 })).json().surum).toBe(2);
    expect((await o.ist('GET', '/api/veri-kalitesi', await o.gir('ide'))).statusCode).toBe(404);
  });
  it('tamlık birlikte: yat sahibi bağı, karar zamanı ve başka dosyaya ait kanıt (YG1251-TAMLIK)', async () => {
    const d = await o.dosyaAc(); const d2 = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET statu = 'Aktif' WHERE kimlik = $1`, [d.kimlik]);
    await o.sup.query(`UPDATE dosya_tarafi SET aktif = false WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]);
    const bel = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bag_turu, bag_kimligi, kaynak_kanali) VALUES ('f.jpg', 'Fotoğraf', 'Dosya', $1, 'Sistem') RETURNING kimlik`, [d2.kimlik])).rows[0].kimlik;
    const g = (await o.sup.query(`INSERT INTO gorsel_kanit (gorsel_no, dosya_ref, belge_ref, ceken_ref, asama, cekim_kalemi) VALUES ($1,$2,$3,$4,'Keşif','Genel – Baş') RETURNING kimlik`, [`${d.dosyaNo}-G9001`, d.kimlik, bel, o.K.ds])).rows[0].kimlik;
    await kaliteKontrolIsle(o.db);
    const ac = async (kod: string, k: string) => (await o.sup.query(`SELECT 1 FROM veri_hatasi WHERE kural_kod = $1 AND kayit_kimligi = $2 AND durum = 'Açık'`, [kod, k])).rowCount;
    expect(await ac('VK-14', d.kimlik)).toBe(1); expect(await ac('VK-17', g)).toBe(1);
  });
});
