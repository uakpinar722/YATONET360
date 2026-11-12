import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { karantinaIsle } from '../src/belge_kural.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { bim: 'Bilgi İşlem Müdürü', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test118', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const yukle = async (k: string, dosya: string, q: string) => o.s.inject({ method: 'POST', url: `/api/belge/yukle?ad=${encodeURIComponent(q)}&bagTuru=Dosya&bagKimligi=${dosya}&kaynak=Sistem&dosya=a.pdf&${q}`, headers: { 'x-yatonet': '1', 'content-type': 'application/octet-stream' }, cookies: { [COOKIE_ADI]: await o.gir(k) }, payload: Buffer.from(`%PDF-1.4 ${Math.random()}`) });

describe('belge kuralları (YG-602, YG-603, YG-604, YG-605)', () => {
  it('tür kuralı zorunlu bilgi ister; zamanı ve kaynağı belli olmayan kanıt kabul edilmez; kural tanımlanabilir', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$2)`, [d.kimlik, o.K.ds]);
    expect((await yukle('ds', d.kimlik, 'tur=Teslim%20Kan%C4%B1t%C4%B1')).json().hata).toMatch(/Belge tarihi, Kaynak kişi/);
    expect((await yukle('ds', d.kimlik, 'tur=Teslim%20Kan%C4%B1t%C4%B1&belgeTarihi=2026-11-01&kaynakKisi=Yat%20sahibi')).statusCode).toBe(200);
    const btd = await o.gir('btd');
    expect((await o.ist('POST', '/api/belge-kurallari/tur', await o.gir('ds'), { tur: 'Ölçüm Çıktısı', zorunlu: ['belge_tarihi'] })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/belge-kurallari/tur', btd, { tur: 'Ölçüm Çıktısı', zorunlu: ['belge_tarihi'], disKapali: ['Yat Sahibi'] })).statusCode).toBe(200);
    expect((await yukle('ds', d.kimlik, 'tur=%C3%96l%C3%A7%C3%BCm%20%C3%87%C4%B1kt%C4%B1s%C4%B1')).statusCode).toBe(400);
  });
  it('sınır değişikliğini Bilgi İşlem Müdürü önerir, Direktör onaylar', async () => {
    const r = (await o.ist('POST', '/api/dosya-siniri/oneri', await o.gir('bim'), { grup: 'Çizim', uzantilar: ['dwg', 'dxf', '.step'], azamiMb: 300, gerekce: '3B model' })).json();
    expect(r.gonderilecek).toBe('Bilgi Teknolojileri ve Firma Yönetimi Direktörü');
    expect((await o.ist('POST', '/api/dosya-siniri/oneri', await o.gir('btd'), { grup: 'Video', uzantilar: ['mp4'], azamiMb: 1, gerekce: 'x' })).statusCode).toBe(404);
    const k = await o.kart('Dosya Sınırı Değişikliği', r.kimlik);
    expect((await o.ist('POST', `/api/is/${k.kimlik}/karar`, await o.gir('btd'), { karar: 'Onayla' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT uzantilar, azami_bayt FROM dosya_siniri WHERE grup = 'Çizim'`)).rows[0]).toEqual({ uzantilar: ['dwg', 'dxf', 'step'], azami_bayt: String(300 * 1_048_576) });
  });
  it('karantinadaki sürüm indirilemez; yeniden taramada temizse açılır', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$2) ON CONFLICT DO NOTHING`, [d.kimlik, o.K.ds]);
    const b = (await yukle('ds', d.kimlik, 'tur=Dosya%20Belgesi')).json().belge;
    await o.sup.query(`UPDATE belge_surum SET durum = 'Karantina' WHERE belge_ref = $1`, [b]);
    expect((await o.ist('GET', `/api/belge/${b}/surum/1/indir`, await o.gir('ds'))).statusCode).toBe(404);
    expect(await karantinaIsle({ db: o.db, tarayici: { ad: 'Deneme', temizMi: async () => true } })).toBe(1);
    expect((await o.sup.query(`SELECT durum FROM belge_surum WHERE belge_ref = $1`, [b])).rows[0].durum).toBe('Taslak');
  });
});
