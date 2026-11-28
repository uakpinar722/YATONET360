import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aydinlatmaKodu } from '../src/adimlar.js';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { ana, ortamKur, PAROLA, type Ortam } from './yardimci.js';

const KADRO = { btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', opm: 'Operasyon Müdürü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
const disHesap = async (ad: string, grup: string, rol: string) => {
  const ep = `${ad}@deneme.yatonet.local`;
  const r = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani, portal_rehberi_beyani) SELECT 'Müşteri/Kurum',$1,$2,$3,$3,parola_ozeti,'Doğrulama uygulaması (6 haneli kod)',now(),now() FROM kullanici_hesabi WHERE kimlik = $4 RETURNING kimlik`, [grup, ad, ep, o.K.ds])).rows[0];
  await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [r.kimlik, rol]);
  await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Müşteri',$2,'R00','Türkçe','Web')`, [r.kimlik, aydinlatmaKodu(grup)]);
  await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [r.kimlik]);
  const c = ana.ckr(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: ep, parola: PAROLA } }));
  const q = await o.ist('GET', '/api/kimlik/kurulum', c);
  return ana.ckr(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
};

beforeAll(async () => { o = await ortamKur('yatonet360_test_yardim', KADRO); });
afterAll(async () => { await o.kapat(); });

describe('Yardım içeriği: video, sıkça sorulan soru, kılavuz (YG-1502, YG-1503, YG-1581)', () => {
  it('Direktörlük ekler; hedef kitleye göre görünür; sigortaya video yok; arama ve video oynatma', async () => {
    const btd = await o.gir('btd'); const opm = await o.gir('opm'); const ds = await o.gir('ds');
    const ekle = (c: string, x: object) => o.ist('POST', '/api/yardim-icerigi', c, { dil: 'Türkçe', ...x });
    expect((await ekle(ds, { tur: 'Sıkça Sorulan Soru', baslik: 'S', metin: 'Y', hedef: 'Tüm Kullanıcılar' })).statusCode).toBe(404);
    expect((await ekle(opm, { tur: 'Video', baslik: 'V', hedef: 'Çözüm Ortağı' })).statusCode).toBe(403);
    expect((await ekle(opm, { tur: 'Sıkça Sorulan Soru', baslik: 'Şifremi unuttum', hedef: 'Tüm Kullanıcılar' })).statusCode).toBe(400);
    const sss = await ekle(opm, { tur: 'Sıkça Sorulan Soru', baslik: 'Şifremi unuttum, ne yapmalıyım?', metin: 'Giriş ekranında Şifremi Unuttum bağlantısını kullanınız.', hedef: 'Tüm Kullanıcılar' }); expect(sss.statusCode, sss.body).toBe(200);
    expect((await ekle(btd, { tur: 'Video', baslik: 'Herkese', hedef: 'Tüm Kullanıcılar' })).statusCode).toBe(400);
    expect((await ekle(btd, { tur: 'Kılavuz', baslik: 'K', hedef: 'Olmayan Rol' })).statusCode).toBe(400);
    const co = (await ekle(btd, { tur: 'Video', baslik: 'Portal Eğitimi', hedef: 'Çözüm Ortağı' })).json().kimlik;
    const rv = (await ekle(btd, { tur: 'Video', baslik: 'Dosya Sorumlusu Rol Videosu', hedef: 'Dosya Sorumlusu' })).json().kimlik;
    await ekle(btd, { tur: 'Kılavuz', baslik: 'Dosya Sorumlusu Kısa Kılavuzu', metin: 'İhbardan teslime adımlar', hedef: 'Dosya Sorumlusu' });
    await ekle(btd, { tur: 'Sıkça Sorulan Soru', baslik: 'Hakediş ne zaman ödenir?', metin: 'Sözleşmedeki süreye göre.', hedef: 'Çözüm Ortağı' });

    // Video dosyası yüklenmeden kullanıcıya listelenmez; yalnız içerik yöneticisi yükler.
    const yukle = async (c: string, id: string) => o.s.inject({ method: 'POST', url: `/api/belge/yukle?ad=v.mp4&tur=${encodeURIComponent('Yardım İçeriği')}&bagTuru=${encodeURIComponent('Yardım İçeriği')}&bagKimligi=${id}&kaynak=Sistem&sinif=${encodeURIComponent('Kamuya Açık')}&dosya=v.mp4`, headers: { ...ana.H, 'content-type': 'application/octet-stream' }, cookies: { [COOKIE_ADI]: c }, payload: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftypmp42${Math.random()}`)]) });
    expect((await yukle(ds, rv)).statusCode).toBe(403);
    expect((await o.ist('GET', '/api/yardim', ds)).json().icerik.map((x: { baslik: string }) => x.baslik)).toEqual(['Şifremi unuttum, ne yapmalıyım?', 'Dosya Sorumlusu Kısa Kılavuzu']);
    const y1 = await yukle(btd, rv); expect(y1.statusCode, y1.body).toBe(200); expect((await yukle(btd, co)).statusCode).toBe(200);
    const dsl = (await o.ist('GET', '/api/yardim', ds)).json(); expect(dsl.yonetici).toBeNull(); expect(dsl.hedefler).toEqual([]);
    expect(dsl.icerik.map((x: { baslik: string }) => x.baslik)).toEqual(['Dosya Sorumlusu Rol Videosu', 'Şifremi unuttum, ne yapmalıyım?', 'Dosya Sorumlusu Kısa Kılavuzu']);
    expect((await o.ist('GET', '/api/yardim?tur=Video', ds)).json().icerik).toHaveLength(1);
    const v = await o.ist('GET', `/api/yardim-icerigi/${rv}/dosya`, ds); expect(v.statusCode).toBe(200); expect(v.headers['content-type']).toBe('video/mp4');
    expect((await o.ist('GET', `/api/yardim-icerigi/${co}/dosya`, ds)).statusCode).toBe(404); // başka hedef kitle

    // Çözüm Ortağı kendi videosunu ve sorularını görür; sigorta kullanıcısı video görmez; yat sahibi yalnız genel içeriği.
    const firma = await disHesap('firma1', 'İş Birliği Firması', 'Firma Yetkilisi');
    expect((await o.ist('GET', '/api/yardim', firma)).json().icerik.map((x: { baslik: string }) => x.baslik)).toEqual(['Portal Eğitimi', 'Hakediş ne zaman ödenir?', 'Şifremi unuttum, ne yapmalıyım?']);
    expect((await o.ist('GET', `/api/yardim-icerigi/${co}/dosya`, firma)).statusCode).toBe(200);
    await ekle(btd, { tur: 'Video', baslik: 'Yat Sahibi Genel Video', hedef: 'Yat Sahibi' });
    const sig = await disHesap('sigorta1', 'Sigorta Şirketi / Eksper', 'Sigorta Şirketi Kullanıcısı');
    expect((await o.ist('GET', '/api/yardim', sig)).json().icerik.every((x: { tur: string }) => x.tur !== 'Video')).toBe(true);
    const sahip = await disHesap('sahip1', 'Bireysel Müşteri (Yat Sahibi/Yetkilisi)', 'Müşteri Portal Kullanıcısı');
    expect((await o.ist('GET', '/api/yardim', sahip)).json().icerik.map((x: { baslik: string }) => x.baslik)).toEqual(['Şifremi unuttum, ne yapmalıyım?']); // video yüklenmedi

    // Arama başlık ve metinde; yayından kaldırılan içerik görünmez, yöneticide kalır.
    expect((await o.ist('GET', `/api/yardim?q=${encodeURIComponent('sifremi')}`, ds)).json().icerik).toHaveLength(1);
    expect((await o.ist('GET', `/api/yardim?q=${encodeURIComponent('teslime')}`, ds)).json().icerik).toHaveLength(1);
    expect((await o.ist('POST', `/api/yardim-icerigi/${sss.json().kimlik}`, opm, { durum: 'Pasif' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/yardim-icerigi/${rv}`, opm, { durum: 'Pasif' })).statusCode).toBe(404); // video Direktörlükte
    expect((await o.ist('GET', '/api/yardim', ds)).json().icerik).toHaveLength(2);
    const yon = (await o.ist('GET', '/api/yardim', btd)).json(); expect(yon.yonetici).toBe('Tam'); expect(yon.icerik).toHaveLength(6); expect(yon.hedefler).toContain('Dosya Sorumlusu');
  });
});
