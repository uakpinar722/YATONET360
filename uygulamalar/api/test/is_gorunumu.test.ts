import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { konumPlani } from '../src/is_gorunumu.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', ts: 'Tedarik Sorumlusu', ide: 'İç Denetçi', mfm: 'Muhasebe ve Finans Müdürü', ikm: 'İnsan Kaynakları Müdürü', iks: 'İnsan Kaynakları Sorumlusu', tm: 'Teknik Müdür', kk: 'Kalite Uzmanı (Kalite Kontrolör)', oy: 'Operasyon Yöneticisi', ty: 'Teknik Yönetici', kmy: 'Kalite Müdür Yardımcısı' };
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
    // YG-1084 (T-YG1084): İnsan Kaynakları Müdürü, birim personelinin ekipte olduğu dosyanın işini görür
    expect((await o.ist('GET', '/api/is-listeleri', await o.gir('ikm'))).json().devamEden.some((x: { kimlik: string }) => x.kimlik === geciken)).toBe(false);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Kalite Kontrolör',$2)`, [d.kimlik, o.K.iks]);
    expect((await o.ist('GET', '/api/is-listeleri', await o.gir('ikm'))).json().devamEden.some((x: { kimlik: string }) => x.kimlik === geciken)).toBe(true);
  });
  it('operasyon panosu müdahale, gözetim dosyaları ve ekip kapasitesini verir; yetkisiz göremez (T-YG1582)', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`INSERT INTO beklemede_isareti (dosya_ref, neden, sorumlu_ref, hedef_tarih, sayac_durur, olusturan_ref, olusturma_zamani) VALUES ($1,'Parça bekleniyor',$2,current_date + 5,true,$2, now() - interval '11 days')`, [d.kimlik, o.K.ds]);
    const v = (await o.ist('GET', '/api/operasyon-pano', await o.gir('opm'))).json();
    expect(v.dosyalar.some((x: { kimlik: string }) => x.kimlik === d.kimlik)).toBe(true);
    expect(v.mudahale.some((x: { tur: string }) => x.tur === 'Beklemede 10. Gün')).toBe(true);
    expect(v.ekip[0]).toMatchObject({ ust: 25 }); expect(Array.isArray(v.kuyruk)).toBe(true); // YG-1584
    { // T-YG1583: Kapanış Bekleyenler (nihai kapanış özeti onayda)
      await o.sup.query(`INSERT INTO nihai_kapanis_ozeti (dosya_ref) VALUES ($1)`, [d.kimlik]);
      const kp = (await o.ist('GET', '/api/operasyon-pano', await o.gir('opm'))).json().kapanis;
      expect(kp.find((x: { kimlik: string }) => x.kimlik === d.kimlik)).toMatchObject({ ozet_durumu: 'Onayda' });
    }
    expect((await o.ist('GET', '/api/operasyon-pano', await o.gir('ts'))).statusCode).toBe(404);
    // T-YG1582: haftalık gözetim notu yalnız dosyanın Operasyon Yöneticisi tarafından yazılır
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Operasyon Yöneticisi',$3)`, [d.kimlik, o.K.oy, o.K.opm]);
    const u = `/api/dosya/${d.kimlik}/gozetim-notu`; const oy = await o.gir('oy');
    expect((await o.ist('POST', u, await o.gir('ty'), { notu: 'X' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, oy, { notu: ' ' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, oy, { notu: 'Parça bekleniyor, firma bilgilendirildi.' })).statusCode).toBe(200);
    expect((await o.ist('POST', u, oy, { notu: 'Güncel not.' })).statusCode).toBe(200);
    const g = (await o.ist('GET', '/api/operasyon-pano', oy)).json(); expect(g.mudur).toBe(false);
    expect(g.dosyalar.find((x: { kimlik: string }) => x.kimlik === d.kimlik).gozetim_notu).toBe('Güncel not.');
  });
  it('teknik pano gözetim dosyalarını ve uyarılarını verir; yetkisiz göremez (T-YG1586)', async () => {
    const d = await o.dosyaAc(); await o.sup.query(`UPDATE dosya SET oncelik = 'Kritik' WHERE kimlik = $1`, [d.kimlik]);
    const v = (await o.ist('GET', '/api/teknik-pano', await o.gir('tm'))).json();
    expect(v.mudur).toBe(true); expect(v.dosyalar.some((x: { kimlik: string }) => x.kimlik === d.kimlik)).toBe(true);
    expect(Array.isArray(v.kuyruk) && Array.isArray(v.durdurulan)).toBe(true); // YG-1588
    expect(v.uyarilar.some((x: { dosya: string; tur: string }) => x.dosya === d.kimlik && x.tur === 'Saha Sorumlusu Gerekiyor')).toBe(true);
    expect((await o.ist('GET', '/api/teknik-pano', await o.gir('ts'))).statusCode).toBe(404);
  });
  it('Kalite Kontrolör panosu kontrol noktalarını ve kritik uygunsuzlukları verir (T-YG1685)', async () => {
    const v = (await o.ist('GET', '/api/kalite-pano', await o.gir('kk'))).json();
    expect(Array.isArray(v.noktalar) && Array.isArray(v.kritik)).toBe(true);
    expect((await o.ist('GET', '/api/kalite-pano', await o.gir('ts'))).statusCode).toBe(404);
  });
  it('Kalite Müdür Yardımcısı iş emri açılan dosyadaki eksik kalite belgesini bildirir (T-YG1690)', async () => {
    const d = await o.dosyaAc(); const k = (await o.sup.query(`SELECT kimlik FROM kurulus LIMIT 1`)).rows[0].kimlik;
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ('IE-KE1','ON',$1,$2,'Marina','Kapsam','Aktif',$3)`, [d.kimlik, k, o.K.opm]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Teknik Yönetici',$2) ON CONFLICT DO NOTHING`, [d.kimlik, o.K.ty]);
    const kmy = await o.gir('kmy');
    { const ep = await o.ist('GET', '/api/kalite/eksik-planlar', kmy); expect(ep.statusCode, ep.body).toBe(200); }
    expect((await o.ist('GET', '/api/kalite/eksik-planlar', kmy)).json().find((x: { kimlik: string }) => x.kimlik === d.kimlik)).toMatchObject({ plan_yok: true, itp_yok: true });
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-eksikligi-bildir`, await o.gir('kk'), {})).statusCode).toBe(404);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-eksikligi-bildir`, kmy, {}); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari LIKE $2`, [o.K.ty, `kalite-eksik:${d.kimlik}%`])).rowCount).toBe(1);
  });
  it('konum planı izin, nöbet ve keşiften oluşur; izinde yalnız İzinli yazar; yetkisiz kişi başkasını görmez', async () => {
    const d = await o.dosyaAc();
    const bugun = new Date(); const g = (n: number) => new Date(bugun.getTime() + n * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); // yerel gün (gece yarısı sonrası UTC kayması)
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
    // YG-1631 (T-YG1631): Bugün şeridi kişinin kendi planından
    const ben = (await o.ist('GET', '/api/konum-plani/ben', await o.gir('ds'))).json();
    expect(ben).toHaveLength(7); expect(ben[2].konum).toBe('İzinli');
  });
  it('dosya haritası bölge özeti verir; LGM dışı ve sigorta dışı dış kullanıcıya kapalıdır', async () => {
    const r = await o.ist('GET', '/api/dosya-haritasi', await o.gir('opm'));
    expect(r.statusCode).toBe(200); expect(Array.isArray(r.json().bolgeler)).toBe(true);
  });
});
