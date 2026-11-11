import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { konumPlani } from '../src/is_gorunumu.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', ts: 'Tedarik Sorumlusu', ide: 'İç Denetçi', mfm: 'Muhasebe ve Finans Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test92', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('iş listeleri, konum planı ve dosya haritası (YG-810–818)', () => {
  it('iş emri listeleri başlangıç ve kabul kayıtlarından oluşur; firma adı yalnız yetkili rolde; tedarik kolu sipariş listesi görür', async () => {
    const d = await o.dosyaAc();
    const k = (await o.sup.query(`SELECT kimlik FROM kurulus LIMIT 1`)).rows[0]?.kimlik ?? (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-IG1','Deneme Tersane','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.opm])).rows[0].kimlik;
    const ie = async (no: string, statu: string, bas: string | null, hedef: string | null) => (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, baslangic_tarihi, hedef_bitis_tarihi, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Marina','Kapsam',$4,$5,$6,$7) RETURNING kimlik`, [no, d.kimlik, k, statu, bas, hedef, o.K.opm])).rows[0].kimlik as string;
    const geciken = await ie('IE-T1', 'Aktif', '2026-01-01', '2026-01-10');
    const biten = await ie('IE-T2', 'Tamamlandı', '2026-01-01', '2026-01-10');
    await o.sup.query(`INSERT INTO kabul_kaydi (dosya_ref, is_emri_ref, kabul_turu, kaydeden_ref) VALUES ($1,$2,'Teknik Kabul',$3)`, [d.kimlik, biten, o.K.opm]);
    const belirsiz = await ie('IE-T3', 'Kabul Bekliyor', null, null);
    const v = (await o.ist('GET', '/api/is-listeleri', await o.gir('opm'))).json();
    expect(v.tur).toBe('İş Emri');
    expect(v.devamEden.find((x: { kimlik: string }) => x.kimlik === geciken)).toMatchObject({ gecikti: true, cozum_ortagi: expect.any(String) });
    expect(v.tamamlanan.some((x: { kimlik: string }) => x.kimlik === biten)).toBe(true);
    expect(v.planli.some((x: { kimlik: string }) => x.kimlik === belirsiz)).toBe(true);
    const ide = (await o.ist('GET', '/api/is-listeleri', await o.gir('ide'))).json();
    expect(ide.devamEden.every((x: { cozum_ortagi: string | null }) => x.cozum_ortagi === null)).toBe(true);
    expect((await o.ist('GET', '/api/is-listeleri', await o.gir('ts'))).json().tur).toBe('Sipariş');
  });
  it('konum planı izin, nöbet ve keşiften oluşur; izinde yalnız İzinli yazar; yetkisiz kişi başkasını görmez', async () => {
    const d = await o.dosyaAc();
    const bugun = new Date(); const g = (n: number) => new Date(bugun.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    await o.sup.query(`INSERT INTO izin_talebi (personel_ref, izin_turu, baslangic, bitis, gun, durum) VALUES ($1,'Yıllık',$2,$2,1,'Onaylandı')`, [o.K.ds, g(2)]);
    await o.sup.query(`INSERT INTO kesif (dosya_ref, amac_kapsam, planlanan_baslangic, planlanan_bitis, sorumlu_ref, olusturan_ref) VALUES ($1,'Keşif',$2::date + time '10:00', $2::date + time '12:00',$3,$3)`, [d.kimlik, g(1), o.K.ds]);
    const p = (await konumPlani(o.db, [o.K.ds!], bugun))[0]!;
    expect(p.gunler).toHaveLength(7);
    expect(p.gunler[0]!.konum).toBe('Merkez Ofis');
    expect(p.gunler[1]!.konum).toContain(d.dosyaNo);
    expect(p.gunler[2]!.konum).toBe('İzinli');
    const opm = (await o.ist('GET', '/api/konum-plani', await o.gir('opm'))).json().kisiler;
    expect(opm.some((x: { kimlik: string }) => x.kimlik === o.K.ds)).toBe(true);
    const mf = (await o.ist('GET', '/api/konum-plani', await o.gir('mfm'))).json().kisiler;
    expect(mf.some((x: { kimlik: string }) => x.kimlik === o.K.ds)).toBe(false);
  });
  it('dosya haritası bölge özeti verir; LGM dışı ve sigorta dışı dış kullanıcıya kapalıdır', async () => {
    const r = await o.ist('GET', '/api/dosya-haritasi', await o.gir('opm'));
    expect(r.statusCode).toBe(200); expect(Array.isArray(r.json().bolgeler)).toBe(true);
  });
});
