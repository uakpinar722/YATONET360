import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silsileUstleri } from '../src/silsile.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', omy: 'Operasyon Müdür Yardımcısı', opm: 'Operasyon Müdürü', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', tod: 'Teknik ve Operasyon Direktörü', tu: 'Teknik Uzman' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test86', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const rol = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
const bilgi = async (dosyaNo: string) => (await o.sup.query(`SELECT kullanici_ref FROM bildirim WHERE baslik = $1`, [`Yeni Dosya: ${dosyaNo}`])).rows.map((r) => r.kullanici_ref as string).sort();

describe('sigorta şirketi tam unvanı (YG-1557)', () => {
  it('31 şirket; kısa ad ve AŞ yazımı tam unvana çevrilir; listede olmayan ad kalır; MERSİS teyidiyle güncellenir', async () => {
    const ds = await o.gir('ds'); const l = (await o.ist('GET', '/api/sigorta-sirketleri', ds)).json(); expect(l.length).toBe(31);
    const d = await o.dosyaAc();
    const u = async (ad: string) => (await o.sup.query(`UPDATE dosya_sigorta_kaydi SET sigortaci_adi = $2 WHERE dosya_ref = $1 RETURNING sigortaci_adi`, [d.kimlik, ad])).rows[0]?.sigortaci_adi ?? (await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi, olusturan_ref) VALUES ($1,$2,$3) RETURNING sigortaci_adi`, [d.kimlik, ad, o.K.ds])).rows[0].sigortaci_adi;
    expect(await u('Anadolu Sigorta')).toBe('Anadolu Anonim Türk Sigorta Şirketi'); expect(await u('allianz sigorta aş')).toBe('Allianz Sigorta A.Ş.'); expect(await u('Doga Sigorta AŞ')).toBe('Doğa Sigorta A.Ş.'); expect(await u('Yabancı Sigorta Ltd')).toBe('Yabancı Sigorta Ltd');
    expect((await o.ist('POST', '/api/sigorta-sirketi', ds, { tsbKodu: '1004' })).statusCode).toBe(404);
  });
});

describe('silsile bilgisi (YG-1555)', () => {
  it('rolün üstündeki dolu kademeler; boş kademe atlanır', async () => {
    expect((await silsileUstleri(o.db, await rol('Dosya Sorumlusu'))).sort()).toEqual([o.K.oy, o.K.omy, o.K.opm, o.K.tod].sort());
    expect((await silsileUstleri(o.db, await rol('Teknik Yönetici'))).sort()).toEqual([o.K.tm, o.K.tod].sort());
  });
  it('yeni dosyada Normal öncelikte yalnız Yöneticilere, Yüksekte iki silsilenin tamamına bilgi', async () => {
    const n = await o.dosyaAc(); expect(await bilgi(n.dosyaNo)).toEqual([o.K.oy, o.K.ty].sort());
    const y = await o.dosyaAc({ oncelik: 'Yüksek' }); expect(await bilgi(y.dosyaNo)).toEqual([o.K.oy, o.K.ty, o.K.omy, o.K.opm, o.K.tm, o.K.tod].sort());
  });
});
