import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cihazKontrolGorevi, destekAylikIstatistik } from '../src/destek.js';
import { teyitMakami } from '../src/hesap_kurtarma.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { dsr: 'Bilgi İşlem Destek Sorumlusu', bim: 'Bilgi İşlem Müdürü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test123', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('Destek raporları (YG-1641)', () => {
  it('aylık destek istatistiği ve üç aylık cihaz kontrolü görevleri dönem başına bir kez (T-YG1641)', async () => {
    await o.sup.query(`INSERT INTO destek_talebi (talep_no, acan_ref, tur, belirti, seviye, yanit_son, cozum_son, yanit_zamani, cozum_zamani, durum, olusturma_zamani) VALUES ('DST-T-1',$1,'Hata','Ekran açılmıyor','D2','2030-03-10T12:00:00+03','2030-03-11T12:00:00+03','2030-03-10T10:00:00+03','2030-03-10T15:00:00+03','Çözüldü','2030-03-10T09:00:00+03')`, [o.K.ds]);
    expect(await destekAylikIstatistik(o.db, new Date('2030-04-01T06:00:00Z'))).toBe(true); expect(await destekAylikIstatistik(o.db, new Date('2030-04-02T06:00:00Z'))).toBe(false);
    const k = await o.kart('Aylık Destek İstatistiği', '2030-03'); expect(k.ozet).toContain('Açılan 1 (D1 0, D2 1'); expect(k.ozet).toContain('Yanıt süresi uyumu %100');
    await o.sup.query(`INSERT INTO varlik (varlik_no, tur, ad, durum, kaydeden_ref) VALUES ('LGM-VR-99001','Cihaz','Dizüstü','Zimmette',$1)`, [o.K.bim]);
    expect(await cihazKontrolGorevi(o.db, new Date('2030-05-05T06:00:00Z'))).toBe(false);
    expect(await cihazKontrolGorevi(o.db, new Date('2030-04-05T06:00:00Z'))).toBe(true); expect(await cihazKontrolGorevi(o.db, new Date('2030-04-20T06:00:00Z'))).toBe(false);
    expect((await o.kart('Üç Aylık Cihaz Kontrolü', '2030-Q2')).ozet).toContain('LGM-VR-99001');
  });
  it('kurumsal kullanıcının hesap kurtarma teyidi Müdür Yardımcısında, o yokken Müdürde (T-YG1699)', async () => {
    const rid = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik;
    const my = await rid('Müşteri ve Paydaş İlişkileri Müdür Yardımcısı');
    const var_ = (await o.sup.query(`SELECT 1 FROM rol_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.rol_ref = $1 AND a.atama_durumu = 'Aktif' AND h.hesap_durumu = 'Aktif'`, [my])).rowCount;
    expect((await teyitMakami(o.db, o.K.ds!, 'Kurumsal Müşteri'))!.rol).toBe(var_ ? my : await rid('Müşteri ve Paydaş İlişkileri Müdürü'));
  });
});
