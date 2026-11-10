import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silsileUstleri } from '../src/silsile.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', omy: 'Operasyon Müdür Yardımcısı', opm: 'Operasyon Müdürü', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', tod: 'Teknik ve Operasyon Direktörü', tu: 'Teknik Uzman' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test86', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const rol = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
const bilgi = async (dosyaNo: string) => (await o.sup.query(`SELECT kullanici_ref FROM bildirim WHERE baslik = $1`, [`Yeni Dosya: ${dosyaNo}`])).rows.map((r) => r.kullanici_ref as string).sort();

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
