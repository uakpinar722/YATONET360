import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { raporCalistir, raporKatalogIsle } from '../src/rapor_katalogu.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { cg: 'CEO', gmy: 'Genel Müdür Yardımcısı', tid: 'Ticari İşler Direktörü', ds: 'Dosya Sorumlusu', mfm: 'Muhasebe ve Finans Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test94', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

const bugun = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
describe('rapor ve gösterge kataloğu (YG-734–740, 742, 744, 751–754, 757)', () => {
  it('göstergeler tanımlı gelir; son başarılı çalışma görünür; yalnız yetkili görür', async () => {
    await raporCalistir(o.db, 'RP-TIC-002', { donem: '2026-10' }, async () => [1, 2], (x) => x.length);
    const v = (await o.ist('GET', '/api/rapor-katalogu', await o.gir('tid'))).json();
    expect(v.tanimlar.some((t: { kod: string; tur: string }) => t.kod === 'G-9.5-1' && t.tur === 'Gösterge')).toBe(true);
    expect(v.tanimlar.find((t: { kod: string }) => t.kod === 'RP-TIC-002').son_basarili.satir).toBe(2);
    expect(v.duzenler).toBe(false);
    expect((await o.ist('GET', '/api/rapor-katalogu', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('yeni sürüm test kanıtı ve karşılaştırma etkisi ister; ileri tarihli sürüm planlanır ve günü gelince yürürlüğe girer; aynı ad başka kodda kullanılamaz', async () => {
    const cg = await o.gir('cg');
    const tem = { kod: 'RP-TIC-002', ad: 'Aylık Yönetim Raporu', tur: 'Rapor', sahipRol: 'Ticari İşler Direktörü', amac: 'A', kaynak: 'K', pay: 'P', birim: 'EUR', zamanBoyutu: 'Fatura', siklik: 'Aylık', hassasiyet: 'Hassas', testKaniti: 'Örnek 3 dosya', yururluk: '2099-01-01' };
    expect((await o.ist('POST', '/api/rapor-tanimi', cg, tem)).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/rapor-tanimi', cg, { ...tem, degisiklikNotu: 'Kesim değişti', karsilastirmaEtkisi: 'Önceki aylarla doğrudan karşılaştırılamaz' })).json()).toEqual({ surum: 2, durum: 'Planlandı' });
    expect((await o.ist('POST', '/api/rapor-tanimi', cg, { ...tem, kod: 'RP-YENI', yururluk: bugun() })).statusCode).toBe(409);
    await o.sup.query(`UPDATE rapor_tanimi SET yururluk = current_date WHERE kod = 'RP-TIC-002' AND surum = 2`);
    expect(await raporKatalogIsle(o.db)).toBeGreaterThanOrEqual(1);
    expect((await o.sup.query(`SELECT surum FROM rapor_tanimi WHERE kod = 'RP-TIC-002' AND durum = 'Yürürlükte'`)).rows[0].surum).toBe(2);
  });
  it('hassas rapor yalnız yönetim rolüne dağıtılır; geri çağırma dağıtım listesine bildirilir; hesabı kapanan alıcı listeden çıkar', async () => {
    const cg = await o.gir('cg');
    expect((await o.ist('POST', '/api/rapor-dagitim', cg, { kod: 'RP-TIC-002', kullanici: o.K.ds, amac: 'Bilgi', bitis: '2099-01-01' })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/rapor-dagitim', cg, { kod: 'RP-TIC-002', kullanici: o.K.mfm, amac: 'Tahsilat izleme', bitis: '2099-01-01' })).statusCode).toBe(200);
    const y = (await o.ist('POST', '/api/rapor-yayini', await o.gir('tid'), { kod: 'RP-TIC-002', donem: '2026-10' })).json().kimlik as string;
    expect((await o.ist('POST', `/api/rapor-yayini/${y}/geri-cagir`, cg, { gerekce: 'Kur hatası' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/rapor-yayini/${y}/geri-cagir`, cg, { gerekce: 'Kur hatası', etkilenenKararlar: 'Ekim tahsilat önceliği' })).json().bildirilen).toBe(1);
    await o.sup.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Kapalı' WHERE kimlik = $1`, [o.K.mfm]);
    await raporKatalogIsle(o.db);
    expect((await o.sup.query(`SELECT durum FROM rapor_dagitim WHERE kullanici_ref = $1`, [o.K.mfm])).rows[0].durum).toBe('Çıkarıldı');
  });
  it('gösterge hedefi değişikliği geçmişe yazılır', async () => {
    await o.ist('POST', '/api/gosterge/hedef', await o.gir('gmy'), { kod: 'G-9.5-1', hedef: 4, gerekce: 'İlk hedef' });
    await o.ist('POST', '/api/gosterge/hedef', await o.gir('gmy'), { kod: 'G-9.5-1', hedef: 6, gerekce: 'Gevşetildi' });
    expect((await o.sup.query(`SELECT count(*)::int n FROM gosterge_hedefi_gecmisi WHERE kod = 'G-9.5-1'`)).rows[0].n).toBe(2);
  });
});
