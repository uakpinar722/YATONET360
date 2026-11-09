import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bulguIstisnaIsle } from '../src/problem.js';
import { kullaniciIzinleri } from '../src/yetki.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', hd: 'Hukuk ve Uyum Direktörü', btm: 'Bilgi İşlem Müdürü', idm: 'İç Denetim Müdürü', iks: 'İnsan Kaynakları Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test77', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('veri sözlüğü ve envanter (YG-1243, YG-1179)', () => {
  it('sözlük aranır; envanteri Hukuk görür ve tamamlar', async () => {
    const ds = await o.gir('ds'); const r = (await o.ist('GET', `/api/veri-sozlugu?q=${encodeURIComponent('Talep Sahibi Telefonu')}`, ds)).json(); expect(r.toplam).toBeGreaterThan(0); expect(r.satirlar[0]).toMatchObject({ kisisel: 'Evet', sahip: 'Dosya Sorumlusu' });
    expect((await o.ist('GET', '/api/veri-sozlugu?q=a', ds)).statusCode).toBe(400); expect((await o.ist('GET', '/api/veri-envanteri', ds)).statusCode).toBe(404);
    const hd = await o.gir('hd'); const l = (await o.ist('GET', '/api/veri-envanteri', hd)).json() as { varlik: string; alanSayisi: number; tamam: boolean }[]; expect(l.length).toBeGreaterThan(10); const v = l.find((x) => x.alanSayisi > 0)!;
    const G = { varlik: v.varlik, ilgiliKisi: 'Müşteri', kategori: 'İletişim', amac: 'Hizmet', hukuki: 'Sözleşme', alici: 'Sigorta', tedbir: 'Şifreleme' };
    expect((await o.ist('POST', '/api/veri-envanteri', hd, { ...G, amac: '' })).statusCode).toBe(400); expect((await o.ist('POST', '/api/veri-envanteri', hd, { ...G, varlik: 'Yok' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/veri-envanteri', hd, G)).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/veri-envanteri', hd)).json().find((x: { varlik: string }) => x.varlik === v.varlik)).toMatchObject({ tamam: true, hukuki: 'Sözleşme' });
  });
});

describe('problem ve denetim bulgusu (YG-1286, YG-1293)', () => {
  const H = '2099-01-01';
  it('problem kaynağı sınırlıdır, sorumluya görev düşer, kök nedenle kapanır', async () => {
    const btm = await o.gir('btm'); const G = { kaynak: 'Tekrarlayan Olay', baslik: 'Kesinti', aciklama: 'A', sorumlu: o.K.btm, hedef: H };
    expect((await o.ist('POST', '/api/problem-kaydi', await o.gir('ds'), G)).statusCode).toBe(404); expect((await o.ist('POST', '/api/problem-kaydi', btm, { ...G, kaynak: 'X' })).statusCode).toBe(400);
    const k = (await o.ist('POST', '/api/problem-kaydi', btm, G)).json().kimlik as string; expect((await o.kart('Problem Kaydı', k)).sahip_kullanici_ref).toBe(o.K.btm);
    expect((await o.ist('POST', `/api/problem-kaydi/${k}/kapat`, btm, { kokNeden: 'K' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/problem-kaydi/${k}/kapat`, btm, { kokNeden: 'K', cozum: 'C' })).statusCode).toBe(200); expect((await o.ist('POST', `/api/problem-kaydi/${k}/kapat`, btm, { kokNeden: 'K', cozum: 'C' })).statusCode).toBe(409);
  });
  it('kapanış bağımsız doğrulama ister; aynı kök neden ilişkilenir; süresi dolan istisna yenilenmez', async () => {
    const btm = await o.gir('btm'); const idm = await o.gir('idm'); const G = { kosul: 'K', olcut: 'O', kanit: 'K', neden: 'N', kapsam: 'K', kokNeden: 'Yama eksik', sorumlu: o.K.btm, hedef: H };
    expect((await o.ist('POST', '/api/sistem-bulgusu', idm, { ...G, olcut: '' })).statusCode).toBe(400);
    const a = (await o.ist('POST', '/api/sistem-bulgusu', idm, G)).json().kimlik as string; const c = (await o.ist('POST', '/api/sistem-bulgusu', idm, G)).json().kimlik as string;
    expect((await o.ist('GET', '/api/problem-kayitlari', idm)).json().bulgular.find((x: { kimlik: string }) => x.kimlik === a).iliskili).toBe(1);
    expect((await o.ist('POST', `/api/sistem-bulgusu/${a}/kapat`, btm, { dogrulama: 'D' })).statusCode).toBe(403); expect((await o.ist('POST', `/api/sistem-bulgusu/${a}/kapat`, idm, {})).statusCode).toBe(400); expect((await o.ist('POST', `/api/sistem-bulgusu/${a}/kapat`, idm, { dogrulama: 'Test' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/sistem-bulgusu/${c}/istisna`, idm, { bitis: '2020-01-01', kalanRisk: 'R' })).statusCode).toBe(400); expect((await o.ist('POST', `/api/sistem-bulgusu/${c}/istisna`, idm, { bitis: H, kalanRisk: 'R' })).statusCode).toBe(200);
    expect(await bulguIstisnaIsle(o.db, new Date('2098-01-01'))).toBe(0); expect(await bulguIstisnaIsle(o.db, new Date('2099-06-01'))).toBe(1);
    expect((await o.sup.query(`SELECT durum FROM sistem_bulgusu WHERE kimlik = $1`, [c])).rows[0].durum).toBe('Açık');
  });
});

describe('zorunlu eğitim kapısı (YG-942)', () => {
  it('ayrıcalıklı rolün izni, o role atanmış zorunlu ders beyan edilene kadar açılmaz', async () => {
    const r = (await o.sup.query(`SELECT r.kimlik, (SELECT count(*) FROM rol_izni z WHERE z.rol_ref = r.kimlik)::int n FROM rol r WHERE r.rol_adi = 'Sistem Yöneticisi'`)).rows[0]; expect(r.n).toBeGreaterThan(0);
    await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref, baslangic_tarihi, atama_durumu) VALUES ($1,$2,current_date,'Aktif')`, [o.K.iks, r.kimlik]);
    const once = (await kullaniciIzinleri(o.db, o.K.iks!)).length;
    const d = (await o.sup.query(`INSERT INTO akademi_ders (ad, tur, icerik, roller, olusturan_ref) VALUES ('Güvenlik','Zorunlu','M',ARRAY['Sistem Yöneticisi'],$1) RETURNING kimlik`, [o.K.iks])).rows[0].kimlik;
    expect((await kullaniciIzinleri(o.db, o.K.iks!)).length).toBeLessThan(once);
    await o.sup.query(`INSERT INTO akademi_beyan (ders_ref, surum, personel_ref) VALUES ($1,1,$2)`, [d, o.K.iks]);
    expect((await kullaniciIzinleri(o.db, o.K.iks!)).length).toBe(once);
  });
});
