import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eskalasyonTuru } from '../src/destek.js';
import { altOrtamIsle } from '../src/sureklilik_ortam.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { sy: 'Sistem Yöneticisi', bim: 'Bilgi İşlem Müdürü', opm: 'Operasyon Müdürü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test105', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const gun = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const OL = { kurtarmaDk: 240, veriKaybiDk: 60, iletisimDk: 30, normallesmeSaat: 24 };
const TUM = { kurtarmaDk: 200, veriKaybiDk: 30, rolKatilimi: true, iletisimDk: 20, belgeErisimi: true, yetki: true, entegrasyon: true, alternatifKayit: true, normallesmeSaat: 10 };

describe('süreklilik testi, alt ortam verisi, eskalasyon (YG-1287, 1119, 1280, 538)', () => {
  it('ölçütler önceden tanımlanır; sapma sorumlu ve hedefle açılır; yeniden sınamada kapanır', async () => {
    const sy = await o.gir('sy');
    expect((await o.ist('POST', '/api/sureklilik-testi', sy, { ad: 'Tatbikat', senaryo: 'Sunucu kaybı', planTarihi: gun(0), olcutler: { kurtarmaDk: 240 } })).statusCode).toBe(400);
    const t = (await o.ist('POST', '/api/sureklilik-testi', sy, { ad: 'Tatbikat', senaryo: 'Sunucu kaybı', planTarihi: gun(0), olcutler: OL })).json().kimlik;
    expect((await o.ist('POST', `/api/sureklilik-testi/${t}/sonuc`, sy, { sonuclar: { ...TUM, kurtarmaDk: 300 } })).statusCode).toBe(400); // hedef tarih yok
    expect((await o.ist('POST', `/api/sureklilik-testi/${t}/sonuc`, sy, { sonuclar: { ...TUM, kurtarmaDk: 300 }, sorumlu: o.K.sy, hedefTarih: gun(7) })).json().sapma).toEqual(['kurtarmaDk']);
    const t2 = (await o.ist('POST', '/api/sureklilik-testi', sy, { ad: 'Yeniden', senaryo: 'Sunucu kaybı', planTarihi: gun(0), olcutler: OL, yenidenSinanan: t })).json().kimlik;
    expect((await o.ist('POST', `/api/sureklilik-testi/${t2}/sonuc`, sy, { sonuclar: TUM })).json().sapma).toEqual([]);
    expect((await o.sup.query(`SELECT durum FROM sureklilik_sapmasi WHERE test_ref = $1`, [t])).rows[0].durum).toBe('Kapalı');
  });
  it('alt ortam kopyası geri döndürülemez maskeleme, kapalı dış bağlantı ve 30 gün sınırıyla; iki ayrı onay; süre bitince imha görevi', async () => {
    const sy = await o.gir('sy');
    const tem = { ortam: 'Test', amac: 'Hata yeniden üretimi', veriKapsami: 'Son 10 dosya', veriSahibiRol: 'Operasyon Müdürü', maskelemeYontemi: 'Ad, telefon ve e-posta karıştırma', geriDondurulemez: true, disBaglantiKapali: true, erisimBitis: gun(5) };
    expect((await o.ist('POST', '/api/alt-ortam-kopyasi', sy, { ...tem, geriDondurulemez: false })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/alt-ortam-kopyasi', sy, { ...tem, erisimBitis: gun(45) })).statusCode).toBe(400);
    const k = (await o.ist('POST', '/api/alt-ortam-kopyasi', sy, tem)).json().kimlik;
    expect((await o.ist('POST', `/api/alt-ortam-kopyasi/${k}/karar`, await o.gir('opm'), { onay: true })).json().durum).toBe('Onayda');
    expect((await o.ist('POST', `/api/alt-ortam-kopyasi/${k}/karar`, await o.gir('bim'), { onay: true })).json().durum).toBe('Aktif');
    await o.sup.query(`UPDATE alt_ortam_kopyasi SET erisim_bitis = current_date - 1 WHERE kimlik = $1`, [k]);
    expect(await altOrtamIsle(o.db)).toBe(1);
    expect((await o.ist('POST', `/api/alt-ortam-kopyasi/${k}/imha`, sy, { kanit: 'Veri tabanı silindi, disk sıfırlandı' })).statusCode).toBe(200);
  });
  it('eskalasyon türü güvenlik, tedarikçi, süreç ve teknik ayrılır; D1 çözüm aşımında yönetim eklenir', () => {
    expect(eskalasyonTuru({ guvenlik: true, kritik_surec: false, hizmet: null, seviye: 'D1' }, 'yanit')).toEqual(['Güvenlik']);
    expect(eskalasyonTuru({ guvenlik: false, kritik_surec: false, hizmet: 'SMS sağlayıcı', seviye: 'D2' }, 'cozum')).toEqual(['Tedarikçi']);
    expect(eskalasyonTuru({ guvenlik: false, kritik_surec: true, hizmet: null, seviye: 'D1' }, 'cozum')).toEqual(['Süreç', 'Yönetim']);
    expect(eskalasyonTuru({ guvenlik: false, kritik_surec: false, hizmet: null, seviye: 'D3' }, 'yanit')).toEqual(['Teknik']);
  });
});
