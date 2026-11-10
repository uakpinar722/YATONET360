import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usulsuzlukTara } from '../src/usulsuzluk.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', idm: 'İç Denetim Müdürü', sy: 'Sistem Yöneticisi' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test87', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('gerçek geri yükleme (YG-564, YG-015)', () => {
  it('Sistem Yöneticisi kaydeder; LGM duyurusu ve yeniden giriş görevleri açılır', async () => {
    const d = await o.dosyaAc(); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const yd = (await o.sup.query(`INSERT INTO yedek_kaydi (tur, bitis, durum) VALUES ('Gece Tam', now() - interval '3 hours', 'Başarılı') RETURNING kimlik`)).rows[0].kimlik as string;
    expect((await o.ist('POST', '/api/geri-yukleme/kayit', await o.gir('oy'), { yedek: yd, aciklama: 'Disk arızası' })).statusCode).toBe(404);
    const sy = await o.gir('sy'); expect((await o.ist('POST', '/api/geri-yukleme/kayit', sy, { yedek: yd })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/geri-yukleme/kayit', sy, { yedek: yd, aciklama: 'Disk arızası' }); expect(r.statusCode, r.body).toBe(200); expect(r.json().gorev).toBeGreaterThanOrEqual(2);
    expect((await o.sup.query(`SELECT zorunlu, kapsam FROM duyuru WHERE baslik LIKE 'Sistem Geri Yüklendi%'`)).rows).toEqual([{ zorunlu: true, kapsam: 'LGM' }]);
    expect(Number((await o.sup.query(`SELECT count(*) n FROM is_karti WHERE tur = 'Geri Yükleme Sonrası Yeniden Giriş' AND sahip_kullanici_ref = $1`, [o.K.ds])).rows[0].n)).toBeGreaterThanOrEqual(1);
  });
});

describe('iç usulsüzlük uyarıları (YG-768)', () => {
  it('personel–firma eşleşmesi ve limit altı tutarlar İç Denetim Müdürüne bir kez düşer', async () => {
    const d = await o.dosyaAc();
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-US1','Eşleşme Firma','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    for (let i = 1; i <= 5; i++) await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Y','K','Aktif',$4)`, [`${d.dosyaNo}-ON0${i}`, d.kimlik, f, o.K.oy]);
    for (let i = 0; i < 3; i++) await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, hazirlayan_ref, zincir, tutar_eur) VALUES ('Fiyat Teklifi','onay','T',$1,ARRAY[(SELECT kimlik FROM rol WHERE rol_adi = 'CEO')],$2)`, [o.K.ds, 4800 + i * 50]);
    const simdi = new Date(Date.now() + 60_000);
    expect(await usulsuzlukTara(o.db, simdi)).toBe(2); expect(await usulsuzlukTara(o.db, simdi)).toBe(0);
    const l = (await o.sup.query(`SELECT baslik, sahip_rol_ref FROM is_karti WHERE tur = 'İç Usulsüzlük Uyarısı' ORDER BY baslik`)).rows;
    expect(l.map((x) => x.baslik.split(':')[0])).toEqual(['Onay Limitinin Hemen Altında Tutarlar', 'Personel–Firma Eşleşmesi']);
    expect(new Set(l.map((x) => x.sahip_rol_ref)).size).toBe(1);
  });
});
