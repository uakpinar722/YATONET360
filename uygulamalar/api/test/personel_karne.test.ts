import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gostergePuani, karneKapanisGorevi, maliBirlesik, nihaiPuan, puantajGorevi } from '../src/personel_karne.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', tod: 'Teknik ve Operasyon Direktörü', gmy: 'Genel Müdür Yardımcısı', cg: 'CEO', iks: 'İnsan Kaynakları Sorumlusu', idm: 'İç Denetim Müdürü', rkd: 'Risk ve Kalite Direktörü', tm: 'Teknik Müdür', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü', mpy: 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test73', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const D = '2026-10';

describe('kişisel karne (YG-960–968)', () => {
  it('katalog: her rolün ağırlık toplamı 100; hedefe ulaşan tam puan alır; %80 sistem, %20 yönetici', async () => {
    const r = (await o.sup.query(`SELECT rol_adi, sum(agirlik)::float t FROM karne_gosterge GROUP BY 1`)).rows; expect(r.length).toBe(48); expect(r.every((x) => Math.abs(x.t - 100) < 0.01)).toBe(true);
    expect(gostergePuani(95, '≥ %95')).toBe(100); expect(gostergePuani(47.5, '≥ %95')).toBe(50); expect(gostergePuani(60, '%100')).toBe(60);
    expect(nihaiPuan(50, 100)).toBe(60); expect(nihaiPuan(50, null)).toBe(50); expect(nihaiPuan(null, 90)).toBeNull();
  });
  it('onay süresi kayıtlardan ölçülür; ölçülemeyen gösterge puana girmez', async () => {
    const gr = (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Genel Müdür Yardımcısı'`)).rows[0].kimlik;
    for (const dk of [10, 600]) {
      const k = (await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, oncelik, zincir, olusturma_zamani) VALUES ('Deneme','onay','D','Normal',ARRAY[$1::text],'2026-10-05T09:00:00Z') RETURNING kimlik`, [gr])).rows[0].kimlik;
      await o.sup.query(`INSERT INTO is_karti_adim (is_ref, kademe, karar, yapan_ref, rol_ref, zaman) VALUES ($1,0,'Onayla',$2,$3,'2026-10-05T09:00:00Z'::timestamptz + make_interval(mins => $4))`, [k, o.K.gmy, gr, dk]);
    }
    const r = (await o.ist('GET', `/api/personel-karne?donem=${D}`, await o.gir('gmy'))).json();
    const s = r.satirlar.find((x: { gosterge: string }) => x.gosterge === 'Onay süresi uyumu'); expect(s).toMatchObject({ pay: 1, payda: 2, deger: 50, puan: 52.63 }); expect(r.sistem).toBe(52.63);
    expect(r.satirlar.filter((x: { puan: unknown }) => x.puan === null).length).toBeGreaterThan(0);
  });
  it('kendisi ve yönetici zinciri görür, başkası göremez; İç Denetim Müdürünün üst makamı CEO', async () => {
    expect((await o.ist('GET', `/api/personel-karne?kullanici=${o.K.ds}&donem=${D}`, await o.gir('opm'))).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/personel-karne?kullanici=${o.K.ds}&donem=${D}`, await o.gir('gmy'))).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/personel-karne?kullanici=${o.K.ds}&donem=${D}`, await o.gir('iks'))).statusCode).toBe(404);
    expect((await o.ist('GET', `/api/personel-karne?kullanici=${o.K.idm}&donem=${D}`, await o.gir('rkd'))).statusCode).toBe(404);
    expect((await o.ist('GET', `/api/personel-karne?kullanici=${o.K.idm}&donem=${D}`, await o.gir('cg'))).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/personel-karne/bagli', await o.gir('opm'))).json().map((x: { kimlik: string }) => x.kimlik)).toContain(o.K.ds);
  });
  it('yönetici puanı üst makamda; dönemi İK kapatır; itirazı yalnız sahibi yapar, üst makam karar verir', async () => {
    const G = { kullanici: o.K.gmy, donem: D, puan: 100, gerekce: 'İyi' }; const cg = await o.gir('cg'); const gmy = await o.gir('gmy');
    expect((await o.ist('POST', '/api/personel-karne/yonetici-puani', await o.gir('opm'), G)).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/personel-karne/yonetici-puani', cg, { ...G, puan: 101 })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/personel-karne/yonetici-puani', cg, G)).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/personel-karne/itiraz', gmy, { donem: D, konu: 'K' })).statusCode).toBe(409);
    const iks = await o.gir('iks');
    expect((await o.ist('POST', '/api/personel-karne/donem-kapat', cg, { donem: D })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/personel-karne/donem-kapat', iks, { donem: '2099-01' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/personel-karne/donem-kapat', iks, { donem: D })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/personel-karne/donem-kapat', iks, { donem: D })).statusCode).toBe(409);
    const k = (await o.ist('GET', `/api/personel-karne?donem=${D}`, gmy)).json(); expect(k).toMatchObject({ durum: 'Kapalı', sistem: 52.63, yonetici: 100, nihai: 62.1 });
    expect((await o.ist('POST', '/api/personel-karne/yonetici-puani', cg, G)).statusCode).toBe(409);
    const t = (await o.ist('POST', '/api/personel-karne/itiraz', gmy, { donem: D, konu: 'Hatalı veri' })).json().kimlik as string;
    expect((await o.ist('POST', '/api/personel-karne/itiraz', gmy, { donem: D, konu: 'İkinci' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/personel-karne/itiraz/${t}/karar`, gmy, { karar: 'Kabul', gerekce: 'X' })).statusCode).toBe(404);
    expect((await o.ist('GET', '/api/personel-karne/itiraz-bekleyen', cg)).json().map((x: { kimlik: string }) => x.kimlik)).toContain(t);
    expect((await o.ist('POST', `/api/personel-karne/itiraz/${t}/karar`, cg, { karar: 'Kabul' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/personel-karne/itiraz/${t}/karar`, cg, { karar: 'Kısmi Kabul', gerekce: 'Veri düzeltildi' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, onceki_puan::float p FROM personel_karne_itiraz WHERE kimlik = $1`, [t])).rows[0]).toEqual({ durum: 'Kısmi Kabul', p: 62.1 });
    expect((await o.kart('Personel Karne İtirazı', t)).durum).toBe('Tamamlandı');
  });
  it('dönem kapanış görevi ayda bir; ağırlık değişikliği toplamı 100 ise CEO onayıyla yürürlüğe girer', async () => {
    const S = new Date('2026-11-02T09:00:00Z'); expect(await karneKapanisGorevi(o.db, S)).toBe(true); expect(await karneKapanisGorevi(o.db, S)).toBe(false); expect(await puantajGorevi(o.db, S)).toBe(true); expect(await puantajGorevi(o.db, S)).toBe(false); /* T-YG1615 */
    const gs = (await o.sup.query(`SELECT kimlik, agirlik::float a FROM karne_gosterge WHERE rol_adi = 'Dosya Sorumlusu' ORDER BY sira`)).rows; expect(gs[0].a).toBe(30);
    const d = gs.map((x, n) => ({ kimlik: x.kimlik, agirlik: n === 0 ? x.a - 5 : n === 1 ? x.a + 5 : x.a })); const opm = await o.gir('opm'); const u = '/api/personel-karne/agirlik';
    expect((await o.ist('POST', u, await o.gir('iks'), { rol: 'Dosya Sorumlusu', degerler: d, gerekce: 'G' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, opm, { rol: 'Dosya Sorumlusu', degerler: d.slice(1), gerekce: 'G' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, opm, { rol: 'Dosya Sorumlusu', degerler: d, gerekce: 'G' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT agirlik::float a FROM karne_gosterge WHERE kimlik = $1`, [gs[0].kimlik])).rows[0].a).toBe(30);
    { const kk = (await o.kart('Karne Ağırlık Değişikliği', r.json().kimlik)).kimlik; expect((await o.karar(kk, 'gmy', 'Onaya Gönder')).statusCode).toBe(200); expect((await o.karar(kk, 'cg', 'Onayla')).statusCode).toBe(200); } // YG-541
    expect((await o.sup.query(`SELECT agirlik::float a FROM karne_gosterge WHERE kimlik = $1`, [gs[0].kimlik])).rows[0].a).toBe(25);
  });
});

describe('Dosya Sorumlusu göstergeleri ve zorluk katsayısı (YG-964, YG-965)', () => {
  const O = { oncelik: 'A', brans: 'B', kabulSinifi: 'C', tutarBandi: 'D', erisim: 'E', gizliHasar: 'F' };
  const dosya = async () => { const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]); return d.kimlik as string; };
  it('katsayıyı Teknik Müdür girer; ölçütler zorunlu; gerekçeyle yalnız bir kez revize edilir', async () => {
    const d = await dosya(); const tm = await o.gir('tm'); const u = `/api/dosya/${d}/zorluk`;
    // YG-1588: teklif onaylanınca Teknik Müdüre 8 saat süreli görev; dosya başına bir kez, katsayı girilince kapanır.
    await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, hazirlayan_ref, statu, gonderim_zamani, karar, karar_zamani) VALUES ($1,$2,'Yat Sahibi',20,$3,'Karar', now() - interval '1 hour', 'Tam Onay', now())`, [`T-ZK${Date.now()}`, d, o.K.ds]);
    const { zorlukGoreviIsle } = await import('../src/zorluk.js');
    expect(await zorlukGoreviIsle(o.db)).toBeGreaterThan(0); await zorlukGoreviIsle(o.db);
    const zk = (await o.sup.query(`SELECT durum, son_zaman FROM is_karti WHERE tur = 'Zorluk Katsayısı Girişi' AND nesne_kimligi = $1`, [d])).rows; expect(zk.length).toBe(1); expect(zk[0].durum).toBe('Bekliyor');
    expect((await o.ist('GET', '/api/teknik-pano', tm)).json().zorluk.some((x: { kimlik: string }) => x.kimlik === d)).toBe(true);
    expect((await o.ist('POST', u, await o.gir('ds'), { katsayi: 1.5, olcutler: O })).statusCode).toBe(404);
    expect((await o.ist('POST', u, tm, { katsayi: 2.5, olcutler: O })).statusCode).toBe(400);
    expect((await o.ist('POST', u, tm, { katsayi: 1.5, olcutler: { ...O, erisim: '' } })).statusCode).toBe(400);
    expect((await o.ist('POST', u, tm, { katsayi: 1.5, olcutler: O })).statusCode).toBe(200);
    expect((await o.ist('POST', u, tm, { katsayi: 1.6, olcutler: O })).statusCode).toBe(400);
    expect((await o.ist('POST', u, tm, { katsayi: 1.6, olcutler: O, gerekce: 'Gizli hasar çıktı' })).statusCode).toBe(200);
    expect((await o.ist('POST', u, tm, { katsayi: 1.7, olcutler: O, gerekce: 'Tekrar' })).statusCode).toBe(409);
    expect((await o.sup.query(`SELECT zorluk_katsayisi::float k, zorluk_revize_edildi r FROM dosya WHERE kimlik = $1`, [d])).rows[0]).toEqual({ k: 1.6, r: true });
    expect((await o.sup.query(`SELECT durum FROM is_karti WHERE tur = 'Zorluk Katsayısı Girişi' AND nesne_kimligi = $1`, [d])).rows[0].durum).toBe('Tamamlandı');
  });
  it('süre uyumu ve kayıt bütünlüğü zorluk katsayısıyla ağırlıklı ölçülür; kapsam notu görünür', async () => {
    const [a, b] = [await dosya(), await dosya()]; const tm = await o.gir('tm'); const D2 = '2026-09';
    expect((await o.ist('POST', `/api/dosya/${a}/zorluk`, tm, { katsayi: 2, olcutler: O })).statusCode).toBe(200);
    await o.sup.query(`INSERT INTO dosya_sure (dosya_ref, tur, baslangic, bitis, tamamlanma) VALUES ($1,'Keşif','2026-09-01T09:00:00Z','2026-09-02T09:00:00Z','2026-09-01T12:00:00Z'), ($2,'Keşif','2026-09-01T09:00:00Z','2026-09-02T09:00:00Z','2026-09-05T12:00:00Z')`, [a, b]);
    const r = (await o.ist('GET', `/api/personel-karne?donem=${D2}`, await o.gir('ds'))).json();
    const s = r.satirlar.find((x: { gosterge: string }) => x.gosterge === 'Süre uyumu'); expect(s).toMatchObject({ pay: 2, payda: 3, deger: 66.67, puan: 74.08 }); expect(s.kapsam).toContain('İlerleme raporu');
    expect(r.satirlar.find((x: { gosterge: string }) => x.gosterge === 'Kayıt bütünlüğü').puan).toBeNull(); expect(r.sistem).toBe(74.08);
  });
});

describe('memnuniyet anketi ve değerlendirme (YG-1470, YG-962, YG-971, YG-973)', () => {
  const kapat = async (saat: number, ek = '') => {
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET statu = 'Teknik Kapalı', musteri_turu = 'Bireysel Müşteri' ${ek} WHERE kimlik = $1`, [d.kimlik]);
    const bo = (await o.sup.query(`SELECT column_name c FROM information_schema.columns WHERE table_name = 'kapanis_kontrolu' AND is_nullable = 'NO' AND column_default IS NULL AND data_type = 'boolean'`)).rows.map((r) => r.c as string);
    await o.sup.query(`INSERT INTO kapanis_kontrolu (dosya_ref, hazirlayan_ref, cikis_statusu, durum, kapanis_zamani${bo.map((b) => `, ${b}`).join('')}) VALUES ($1,$2,'Teknik Kapalı','Onaylandı',now() - make_interval(hours => $3)${bo.map(() => ', true').join('')})`, [d.kimlik, o.K.ds, saat]);
    return d.kimlik as string;
  };
  it('48 saatten önce gitmez; vefatta gitmez; tek kullanımlık; 2 ve altında görev açılır', async () => {
    const { anketGonder } = await import('../src/memnuniyet.js');
    const erken = await kapat(10); const vefat = await kapat(60, ', vefat_isareti = true'); const d = await kapat(60);
    const l = await anketGonder(o.db, 'http://x'); const bul = (k: string) => l.find((x) => x.dosya === k);
    expect(bul(erken)).toBeUndefined(); expect(bul(vefat)).toBeUndefined(); expect(bul(d)).toBeDefined(); expect((await anketGonder(o.db, 'http://x')).find((x) => x.dosya === d)).toBeUndefined();
    const u = `/api/anket/${bul(d)!.belirtec}`; const a = await o.ist('GET', u, ''); expect(a.json()).toEqual({ dil: 'tr', yanitlandi: false });
    expect((await o.ist('GET', `/api/anket/${'0'.repeat(64)}`, '')).statusCode).toBe(404);
    expect((await o.ist('POST', u, '', { genel: 6, iletisim: 5, isKalitesi: 5 })).statusCode).toBe(400);
    expect((await o.ist('POST', u, '', { genel: 5, iletisim: 2, isKalitesi: 5, yorum: 'Geç döndünüz' })).statusCode).toBe(200);
    expect((await o.ist('POST', u, '', { genel: 5, iletisim: 5, isKalitesi: 5 })).statusCode).toBe(409);
    const k = (await o.sup.query(`SELECT kimlik, ortalama::float o FROM memnuniyet_anketi WHERE dosya_ref = $1`, [d])).rows[0]; expect(k.o).toBe(4);
    expect((await o.kart('Memnuniyet Görüşmesi', k.kimlik)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/anket-gorusme/${k.kimlik}`, await o.gir('ds'), { sonuc: 'X' })).statusCode).toBe(404);
    expect((await o.ist('GET', '/api/anket-gorusme', await o.gir('mpy'))).statusCode).toBe(200); /* T-YG1698 */
    expect((await o.ist('POST', `/api/anket-gorusme/${k.kimlik}`, await o.gir('mpm'), { sonuc: 'Arandı, çözüldü' })).statusCode).toBe(200);
    expect((await o.kart('Memnuniyet Görüşmesi', k.kimlik)).durum).toBe('Tamamlandı');
  });
  it('üç aylık ve yıllık değerlendirmeyi üst makam kaydeder; yıllıkta eğitim ihtiyacı zorunlu; görev tanımı rolünü gösterir', async () => {
    const opm = await o.gir('opm'); const u = '/api/personel-karne/degerlendirme'; const G = { kullanici: o.K.ds, gorusmeTarihi: '2026-11-01', notlar: 'Görüşüldü' };
    expect((await o.ist('POST', u, await o.gir('iks'), { ...G, tur: 'Üç Aylık', donem: '2026-Q4' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, opm, { ...G, tur: 'Yıllık', donem: '2026' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, opm, { ...G, tur: 'Üç Aylık', donem: '2026-Q4' })).statusCode).toBe(200);
    expect((await o.ist('POST', u, opm, { ...G, tur: 'Üç Aylık', donem: '2026-Q4' })).statusCode).toBe(409);
    expect((await o.ist('POST', u, opm, { ...G, tur: 'Yıllık', donem: '2026', egitim: 'Hasar raporu' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/personel-karne?donem=2026-11', await o.gir('ds'))).json().degerlendirmeler.length).toBe(2);
    const g = (await o.ist('GET', '/api/gorev-tanimim', await o.gir('ds'))).json(); expect(g[0].rol).toBe('Dosya Sorumlusu'); expect(g[0].bloklar.some((x: { m: string }) => x.m === 'Amaç')).toBe(true); expect(g[0].bloklar.some((x: { m: string }) => x.m === 'Karne göstergeleri')).toBe(false);
  });
});

describe('kurumsal muhatap ve mali sonuç (D-200)', () => {
  it('net marj ve tahsilat birleşir; biri yoksa diğeri esas alınır', () => { expect(maliBirlesik(100, 80)).toBe(90); expect(maliBirlesik(null, 80)).toBe(80); expect(maliBirlesik(70, null)).toBe(70); expect(maliBirlesik(null, null)).toBeNull(); });
  it('kurumsal dosyada anket Ek-2 muhatabına gider; yürürlükte Ek-2 yoksa gitmez', async () => {
    const { anketGonder, kurumsalMuhatap } = await import('../src/memnuniyet.js');
    const yeni = async () => { const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET statu = 'Teknik Kapalı', musteri_turu = 'Kurumsal Müşteri' WHERE kimlik = $1`, [d.kimlik]); const bo = (await o.sup.query(`SELECT column_name c FROM information_schema.columns WHERE table_name = 'kapanis_kontrolu' AND is_nullable = 'NO' AND column_default IS NULL AND data_type = 'boolean'`)).rows.map((r) => r.c as string); await o.sup.query(`INSERT INTO kapanis_kontrolu (dosya_ref, hazirlayan_ref, cikis_statusu, durum, kapanis_zamani${bo.map((b) => `, ${b}`).join('')}) VALUES ($1,$2,'Teknik Kapalı','Onaylandı',now() - interval '60 hours'${bo.map(() => ', true').join('')})`, [d.kimlik, o.K.ds]); return d.kimlik as string; };
    const a = await yeni(); expect((await anketGonder(o.db, 'http://x')).find((x) => x.dosya === a)).toBeUndefined();
    const ty = (await o.sup.query(`SELECT y.yat_sahibi_ref r FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [a])).rows[0].r;
    const k = (await o.sup.query(`INSERT INTO kurumsal_kurum (taraf_ref, unvan, ek2_onay_siniri, kaydeden_ref) VALUES ($1,'Kurum',1000,$2) RETURNING kimlik`, [ty, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO kurumsal_ek2 (kurum_ref, surum, satirlar, durum, kaydeden_ref) VALUES ($1,1,$2,'Yürürlükte',$3)`, [k, JSON.stringify({ muhatap: { ad: 'Muhatap Rolü', iletisim: 'Tel 0212, muhatap@kurum.local' } }), o.K.ds]);
    expect(await kurumsalMuhatap(o.db, a)).toBe('muhatap@kurum.local');
    expect((await anketGonder(o.db, 'http://x')).find((x) => x.dosya === a)).toBeDefined();
  });
});

describe('rol göstergeleri (Karne Gösterge Kataloğu)', () => {
  it('kayıtlı her gösterge katalogda var ve sorgusu çalışır; düşük hedef doğru puanlanır', async () => {
    const { EK_SORGU } = await import('../src/karne_olcumler.js');
    for (const [rol, m] of Object.entries(EK_SORGU)) for (const [g, q] of Object.entries(m)) {
      expect((await o.sup.query(`SELECT 1 FROM karne_gosterge WHERE rol_adi = $1 AND gosterge = $2`, [rol, g])).rowCount, `${rol} · ${g}`).toBe(1);
      await o.db.query(q.sql, [o.K.ds, '2026-10']);
    }
    expect(gostergePuani(2, '≤ %3')).toBe(100); expect(gostergePuani(6, '≤ %3')).toBe(50); expect(gostergePuani(0, '≤ %5')).toBe(100); expect(gostergePuani(90, '≥ %90 (başlangıç hedefi)')).toBe(100);
  });
  it('Bilgi İşlem destek göstergeleri talep kayıtlarından ölçülür (YG-960)', async () => {
    const E = (await import('../src/karne_olcumler.js')).EK_SORGU; const D = '2026-09';
    const ek = async (no: string, yanit: string, yanitSon: string, cozum: string, cozumSon: string, ilgili: string | null = null) => (await o.sup.query(`INSERT INTO destek_talebi (talep_no, acan_ref, tur, belirti, seviye, yanit_son, yanit_zamani, cozum_son, cozum_zamani, atanan_ref, cozen_ref, ilgili_ref, olusturma_zamani, durum) VALUES ($1,$2,'Hata','B','D2',$3,$4,$5,$6,$7,$7,$8,'2026-09-05T08:00:00Z','Kapalı') RETURNING kimlik`, [no, o.K.ds, yanitSon, yanit, cozumSon, cozum, o.K.ds, ilgili])).rows[0].kimlik as string;
    const t1 = await ek('KR-D1', '2026-09-05T08:10:00Z', '2026-09-05T08:30:00Z', '2026-09-05T09:00:00Z', '2026-09-05T10:00:00Z');
    await ek('KR-D2', '2026-09-05T09:00:00Z', '2026-09-05T08:30:00Z', '2026-09-06T12:00:00Z', '2026-09-05T10:00:00Z');
    await ek('KR-D3', '2026-09-05T08:10:00Z', '2026-09-05T08:30:00Z', '2026-09-05T09:30:00Z', '2026-09-05T10:00:00Z', t1);
    const r = async (rol: string, g: string) => { const x = (await o.db.query(E[rol]![g]!.sql, [o.K.ds, D])).rows[0]; return [Number(x.pay), Number(x.payda)]; };
    expect(await r('Bilgi İşlem Destek Sorumlusu', 'İlk yanıt süresi uyumu')).toEqual([2, 3]);
    expect(await r('Bilgi İşlem Destek Sorumlusu', 'Çözüm süresi uyumu')).toEqual([2, 3]);
    expect(await r('Bilgi İşlem Destek Sorumlusu', 'Yeniden açılma oranı')).toEqual([1, 3]);
    expect(await r('Bilgi İşlem Müdürü', 'Destek hizmet seviyesi uyumu')).toEqual([2, 3]);
  });
  it('iş günü ve puan ölçekli göstergeler (YG-960, V-1136)', async () => {
    expect((await o.db.query(`SELECT is_gunu_ekle('2026-11-27', 2)::text a, is_gunu_ekle('2026-10-27', 3)::text b`)).rows[0]).toEqual({ a: '2026-11-30', b: '2026-10-31' });
    const { olcekPuani } = await import('../src/personel_karne.js'); expect(olcekPuani(4.3, '≥ 4,3 / 5 (başlangıç hedefi)', 5)).toBe(100); expect(olcekPuani(3.44, '≥ 4,3 / 5', 5)).toBe(80);
    const E = (await import('../src/karne_olcumler.js')).EK_SORGU;
    const dz = await o.dosyaAc(); await o.sup.query(`INSERT INTO memnuniyet_anketi (dosya_ref, belirtec_ozet, dil, gonderim_zamani, cevap_zamani, genel, iletisim, is_kalitesi, ortalama) VALUES ($1,'x','Türkçe','2026-08-03T08:00:00Z','2026-08-04T08:00:00Z',4,4,5,4.33)`, [dz.kimlik]);
    const r = (await o.db.query(E['Müşteri ve Paydaş İlişkileri Müdürü']!['Müşteri memnuniyet puanı']!.sql, [o.K.ds, '2026-08'])).rows[0]; expect(Number(r.pay) / Number(r.payda)).toBeCloseTo(4.33);
  });
  it('tedarik seçim gerekçesi kayıttan ölçülür', async () => {
    const q = (await import('../src/karne_olcumler.js')).EK_SORGU['Tedarik Sorumlusu']!['Seçim gerekçesi tamlığı']!;
    const r = (await o.db.query(q.sql, [o.K.ds, '2026-10'])).rows[0]; expect(Number(r.payda)).toBe(0);
  });
});
