import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guvenlikTara, onemHesapla } from '../src/guvenlik_izleme.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', btm: 'Bilgi İşlem Müdürü', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', bmy: 'Bilgi İşlem Müdür Yardımcısı', bds: 'Bilgi İşlem Destek Sorumlusu', oy: 'Operasyon Yöneticisi' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test76', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const iz = async (eylem: string, n: number, aktor: string, zaman: Date) => { for (let k = 0; k < n; k++) await o.db.query(`INSERT INTO denetim_izi (aktor_ref, olay_zamani, eylem, sonuc, kaynak_adres) VALUES ($1,$2,$3,'Başarılı','10.0.0.9')`, [aktor, zaman, eylem]); };

describe('güvenlik alarmı (YG-1191–1194)', () => {
  it('eşik aşılınca tek alarm; ayrıcalıkta önem yükselir; istisnadaki kural çalışmaz', async () => {
    expect(onemHesapla('Yüksek', true)).toBe('Kritik'); expect(onemHesapla('Kritik', true)).toBe('Kritik'); expect(onemHesapla('Orta', false)).toBe('Orta');
    const S = new Date(Date.now() - 60_000);
    await iz('Belge İndirildi', 49, o.K.ds!, S); expect(await guvenlikTara(o.db, new Date())).toBe(0);
    await iz('Belge İndirildi', 1, o.K.ds!, S); expect(await guvenlikTara(o.db, new Date())).toBe(1); expect(await guvenlikTara(o.db, new Date())).toBe(0);
    const a = (await o.sup.query(`SELECT kimlik, kural_kod, onem, etkilenen FROM guvenlik_alarmi`)).rows[0]; expect(a).toMatchObject({ kural_kod: 'TOPLU_INDIRME', onem: 'Yüksek', etkilenen: o.K.ds });
    expect((await o.kart('Güvenlik Alarmı', a.kimlik)).durum).toBe('Bekliyor');
    const btm = await o.gir('btm'); expect((await o.ist('GET', '/api/guvenlik', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/guvenlik/alarm/${a.kimlik}/adim`, btm, { adim: 'Kapanış' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/guvenlik/alarm/${a.kimlik}/adim`, btm, { adim: 'Kabul' })).statusCode).toBe(200);
    const bmy = await o.gir('bmy'); const T = { tur: 'Oturum Sonlandırma', hedef: o.K.ds, gerekce: 'Şüpheli' }; expect((await o.ist('POST', `/api/guvenlik/alarm/${a.kimlik}/tedbir`, bmy, T)).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/guvenlik/alarm/${a.kimlik}/tedbir`, btm, { ...T, tur: 'Erişim Askıya Alma', hedef: o.K.btm })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/guvenlik/alarm/${a.kimlik}/tedbir`, btm, T)).json()).toEqual({ uygulandi: true });
    expect((await o.sup.query(`SELECT count(*)::int n FROM oturum WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [o.K.ds])).rows[0].n).toBe(0);
    expect((await o.ist('POST', `/api/guvenlik/alarm/${a.kimlik}/adim`, btm, { adim: 'Kapanış', not: 'Doğrulandı' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT kabul_zamani IS NOT NULL k, sinirlama_zamani IS NOT NULL s, kapanis_zamani IS NOT NULL z FROM guvenlik_alarmi WHERE kimlik = $1`, [a.kimlik])).rows[0]).toEqual({ k: true, s: true, z: true });
    const U = '/api/guvenlik/kural/YETKISIZ_ERISIM'; expect((await o.ist('POST', U, btm, { esik: 99 })).statusCode).toBe(400); expect((await o.ist('POST', U, btm, { istisnaBitis: '2020-01-01', gerekce: 'G' })).statusCode).toBe(400);
    expect((await o.ist('POST', U, btm, { istisnaBitis: new Date(Date.now() + 86_400_000).toISOString(), gerekce: 'Bakım penceresi' })).statusCode).toBe(200);
    await iz('Yetkisiz Erişim Denemesi', 30, o.K.ds!, S); expect(await guvenlikTara(o.db, new Date())).toBe(0);
    expect((await o.ist('GET', '/api/guvenlik', btm)).json().kurallar.find((k: { kod: string }) => k.kod === 'YETKISIZ_ERISIM').istisna_gerekce).toBe('Bakım penceresi');
  });
});

describe('acil erişim ve destek kaydı (YG-1190, YG-1188)', () => {
  it('Müdür onaylar; kendi talebini Direktör onaylar; kişisel veride veri sahibi onayı; kapanışta bağımsız inceleme ve sır yenileme', async () => {
    const bds = await o.gir('bds'); const btm = await o.gir('btm'); const btd = await o.gir('btd'); const bmy = await o.gir('bmy');
    const a = (await o.ist('POST', '/api/guvenlik/kir-cam', bds, { kapsam: 'Veritabanı', gerekce: 'Arıza', kisiselVeri: true })).json().kimlik as string;
    expect((await o.ist('POST', `/api/guvenlik/kir-cam/${a}/onay`, btd, { veriSahibiOnayi: 'X' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/guvenlik/kir-cam/${a}/onay`, btm, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/guvenlik/kir-cam/${a}/onay`, btm, { veriSahibiOnayi: 'Hukuk onayı' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/guvenlik/kir-cam/${a}/kapat`, btm, { sirYenilendi: true, inceleme: 'N' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/guvenlik/kir-cam/${a}/kapat`, bds, { sirYenilendi: true, inceleme: 'N' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/guvenlik/kir-cam/${a}/kapat`, bmy, { inceleme: 'N' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/guvenlik/kir-cam/${a}/kapat`, bmy, { sirYenilendi: true, inceleme: 'Uygun' })).statusCode).toBe(200);
    const k = (await o.ist('POST', '/api/guvenlik/kir-cam', btm, { kapsam: 'Sunucu', gerekce: 'Arıza' })).json().kimlik as string;
    expect((await o.ist('POST', `/api/guvenlik/kir-cam/${k}/onay`, btm, {})).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/guvenlik/kir-cam/${k}/onay`, btd, {})).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/guvenlik/destek-erisim', await o.gir('oy'), { tur: 'Ekran Paylaşımı', kullanici: o.K.ds, kapsam: 'K' })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/guvenlik/destek-erisim', bds, { tur: 'Ekran Paylaşımı', kullanici: o.K.ds, kapsam: 'Hata inceleme' })).statusCode).toBe(200);
  });
});
