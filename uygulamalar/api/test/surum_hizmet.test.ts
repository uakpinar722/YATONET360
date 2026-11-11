import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disHizmetIsle } from '../src/surum_hizmet.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { bim: 'Bilgi İşlem Müdürü', sy: 'Sistem Yöneticisi', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test90', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

const OZ = 'a'.repeat(64);
const BIL = { uygulama: '1.4.0', veritabani: '0154', yapilandirma: 'c1', rapor: 'r1', entegrasyon: 'e1', sablon: 's1', altyapi: 'pg17' };

describe('sürüm, test ve üretim izleme (YG-1125, YG-1134, YG-1137, YG-1138, YG-1139)', () => {
  it('test seti asgari senaryolar geçmeden ve açık yüksek hata varken test edildi olmaz; üretim paketi test paketiyle aynı olmalı', async () => {
    const sy = await o.gir('sy'); const bim = await o.gir('bim');
    expect((await o.ist('POST', '/api/yayin-seti', await o.gir('ds'), { surum: 'R1', ortam: 'Test', paketOzeti: OZ, bilesenler: BIL })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/yayin-seti', sy, { surum: 'R1', ortam: 'Test', paketOzeti: OZ, bilesenler: { ...BIL, sablon: '' } })).statusCode).toBe(400);
    const bilet = (await o.sup.query(`INSERT INTO degisiklik_bileti (bilet_no, konu, gerekce, hazirlayan_ref) VALUES ('DB-T1','Konu','Gerekçe',$1) RETURNING kimlik`, [o.K.sy])).rows[0].kimlik;
    const t = (await o.ist('POST', '/api/yayin-seti', sy, { surum: 'R1', ortam: 'Test', paketOzeti: OZ, bilesenler: BIL, degisiklikler: [bilet] })).json().kimlik as string;
    const sen: Record<string, string> = {};
    for (const tur of ['Mutlu Yol', 'Ret', 'Yetkisiz Kullanıcı', 'Geri Alma']) {
      const r = await o.ist('POST', '/api/test-senaryosu', sy, { yayin: t, tur, risk: 'Orta', gereksinim: 'YG-1', onKosul: 'Ö', veri: 'V', rol: 'R', adimlar: 'A', beklenen: 'B' }); expect(r.statusCode, r.body).toBe(200); sen[tur] = r.json().kimlik;
    }
    expect((await o.ist('POST', '/api/test-senaryosu', sy, { yayin: t, tur: 'Ret', risk: 'Orta', gereksinim: 'YG-1' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/yayin-seti/${t}/test-edildi`, sy)).json().eksik).toHaveLength(4);
    for (const k of Object.values(sen)) await o.ist('POST', `/api/test-senaryosu/${k}/kosu`, sy, { sonuc: 'Geçti', kanit: 'Ekran görüntüsü' });
    const h = (await o.ist('POST', '/api/test-hatasi', sy, { senaryo: sen.Ret, onem: 'Yüksek', tekrar: 'Her Seferinde', gereksinim: 'YG-1', kanit: 'Günlük', sorumlu: o.K.bim, hedefSurum: 'R1' })).json().kimlik as string;
    expect((await o.ist('POST', `/api/yayin-seti/${t}/test-edildi`, sy)).json().eksik).toEqual([expect.stringMatching(/^TH-\d{5} açık$/)]);
    expect((await o.ist('POST', `/api/test-hatasi/${h}/duzeltildi`, sy, { not: 'Düzeltildi' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/test-hatasi/${h}/duzeltildi`, bim, { not: 'Düzeltildi' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/test-hatasi/${h}/kapat`, sy)).statusCode).toBe(409); // yeniden test yok
    await o.ist('POST', `/api/test-senaryosu/${sen.Ret}/kosu`, bim, { sonuc: 'Geçti', kanit: 'Geliştirici' });
    expect((await o.ist('POST', `/api/test-hatasi/${h}/kapat`, sy)).statusCode).toBe(409); // sorumlunun koşusu yetmez
    await o.ist('POST', `/api/test-senaryosu/${sen.Ret}/kosu`, sy, { sonuc: 'Geçti', kanit: 'Yeniden test' });
    expect((await o.ist('POST', `/api/test-hatasi/${h}/kapat`, sy)).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/yayin-seti/${t}/test-edildi`, sy)).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/yayin-seti', sy, { surum: 'R1', ortam: 'Üretim', paketOzeti: 'b'.repeat(64), bilesenler: BIL, testEdilen: t })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/yayin-seti', sy, { surum: 'R1', ortam: 'Üretim', paketOzeti: OZ, bilesenler: { ...BIL, rapor: 'r2' }, testEdilen: t })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/yayin-seti', sy, { surum: 'R1', ortam: 'Üretim', paketOzeti: OZ, bilesenler: BIL, testEdilen: t })).statusCode).toBe(400); // YG-066 kararı yok
    const u = (await o.ist('POST', '/api/yayin-seti', sy, { surum: 'R1', ortam: 'Üretim', paketOzeti: OZ, bilesenler: BIL, degisiklikler: [bilet], testEdilen: t, acikDosyaKarari: 'Yalnız yeni dosyalara uygulanır', acikDosyaGerekcesi: 'Açık dosyalarda süre hesabı değişmesin' })).json().kimlik as string;
    expect((await o.ist('POST', `/api/yayin-seti/${u}/uretime-al`, sy)).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/yayin-seti/${u}/uretime-al`, bim)).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/yayin-seti/izle?bilet=DB-T1', sy)).json().map((x: { ortam: string }) => x.ortam)).toEqual(['Test', 'Üretim']);
    expect((await o.kart('Üretim Sonrası İzleme', u)).durum).toBe('Bekliyor');
    const p = (await o.ist('POST', `/api/yayin-seti/${u}/izleme`, sy, { alan: 'Bildirim', sonuc: 'Beklenmeyen', aciklama: 'Bildirim gitmedi' })).json().problem as string;
    expect((await o.sup.query(`SELECT kaynak FROM problem_kaydi WHERE kimlik = $1`, [p])).rows[0].kaynak).toBe('Üretim Sonrası İzleme');
    for (const alan of ['İş Akışı', 'Yetki', 'Rapor', 'Entegrasyon']) await o.ist('POST', `/api/yayin-seti/${u}/izleme`, sy, { alan, sonuc: 'Beklendiği Gibi', aciklama: 'Örnek akış' });
    expect((await o.kart('Üretim Sonrası İzleme', u)).durum).toBe('Tamamlandı');
  });
});

describe('dış hizmet hesabı, olay bazlı erişim ve çıkış (YG-1002, YG-1304, YG-1305)', () => {
  it('isimli hesap çok faktörlü ve dar yetkili açılır; erişim süreli ve olaya bağlı; çıkış listesi tamamlanınca her şey kapanır', async () => {
    const sy = await o.gir('sy'); const bim = await o.gir('bim');
    const tem = { hesapAdi: 'destek.ali', saglayici: 'Sağlayıcı A', kisi: 'Destek Uzmanı', kapsam: ['Günlük okuma'], cokFaktorlu: true, destekYontemi: 'Onaylı Uzak Erişim Aracı', altSaglayicilar: ['Barındırma B'], sozlesmeBitis: '2026-01-01' };
    expect((await o.ist('POST', '/api/hizmet-hesabi', sy, { ...tem, cokFaktorlu: false })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/hizmet-hesabi', sy, { ...tem, kapsam: ['Tüm sistem'] })).statusCode).toBe(400);
    const hr = await o.ist('POST', '/api/hizmet-hesabi', sy, tem); expect(hr.statusCode, hr.body).toBe(200); const h = hr.json().kimlik as string;
    expect((await o.ist('POST', `/api/hizmet-hesabi/${h}/onay`, bim)).statusCode).toBe(200);
    const pr = (await o.sup.query(`INSERT INTO problem_kaydi (problem_no, kaynak, baslik, aciklama, sorumlu_ref, hedef_tarih, acan_ref) VALUES ('PRB-T-1','Eğilim','B','A',$1,current_date,$1) RETURNING kimlik`, [o.K.sy])).rows[0].kimlik;
    const z = (s: number) => new Date(Date.now() + s * 3_600_000).toISOString();
    expect((await o.ist('POST', '/api/dis-erisim', sy, { hesap: h, olayTuru: 'Problem', olay: pr, gerekce: 'İnceleme', veri: 'Üretim Verisi', baslangic: z(0), bitis: z(4) })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/dis-erisim', sy, { hesap: h, olayTuru: 'Problem', olay: pr, gerekce: 'İnceleme', veri: 'Maskeli Veri', baslangic: z(0), bitis: z(100) })).statusCode).toBe(400);
    const e = (await o.ist('POST', '/api/dis-erisim', sy, { hesap: h, olayTuru: 'Problem', olay: pr, gerekce: 'İnceleme', veri: 'Maskeli Veri', baslangic: z(0), bitis: z(4) })).json().kimlik as string;
    expect((await o.ist('POST', `/api/dis-erisim/${e}/karar`, bim, { onay: true })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/hizmet-hesabi/${h}/olcum`, sy, { baslangic: z(-2), bitis: z(-1), etkilenenIs: 'Dosya açılışı', kullanici: 4, dosya: 2 })).statusCode).toBe(200);
    expect(await disHizmetIsle(o.db)).toBeGreaterThanOrEqual(1);
    expect((await o.kart('Dış Hizmet Çıkışı', h)).durum).toBe('Bekliyor');
    expect(await disHizmetIsle(o.db, new Date(Date.now() + 5 * 3_600_000))).toBeGreaterThanOrEqual(1);
    expect((await o.sup.query(`SELECT durum FROM dis_erisim_izni WHERE kimlik = $1`, [e])).rows[0].durum).toBe('Bitti');
    const { CIKIS_MADDELERI } = await import('../src/surum_hizmet.js');
    let son: string[] = [];
    for (const m of CIKIS_MADDELERI) son = (await o.ist('POST', `/api/hizmet-hesabi/${h}/cikis`, sy, { madde: m, kanit: 'Kayıt' })).json().eksik;
    expect(son).toEqual([]);
    expect((await o.sup.query(`SELECT durum FROM hizmet_hesabi WHERE kimlik = $1`, [h])).rows[0].durum).toBe('Kapalı');
    expect((await o.kart('Dış Hizmet Çıkışı', h)).durum).toBe('Tamamlandı');
  });
});
