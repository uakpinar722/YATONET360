import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cihazGecerli, gazUygun, kabulEngeli, kaliteSureIsle, ncrHedefi, sinifEngeli } from '../src/kalite.js';
import { eslestir } from '../src/tedarik.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', kk: 'Kalite Uzmanı (Kalite Kontrolör)', km: 'Kalite Müdürü', ts: 'Tedarik Sorumlusu', tym: 'Tedarik Yönetimi Müdürü', to: 'Teknik ve Operasyon Direktörü', tid: 'Ticari İşler Direktörü', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü' };
let o: Ortam; let firma: string; let tedarikci: string;
const ileri = (g: number) => new Date(Date.now() + 180 * 60_000 + g * 86_400_000).toISOString().slice(0, 10);
const dosya = async () => { await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE bitis_zamani IS NULL`); const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); for (const [k, r] of [['kk', 'Kalite Kontrolör'], ['ts', 'Tedarik Sorumlusu']]) await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,$3,$4)`, [d.kimlik, o.K[k!], r, o.K.oy]); return d; };
const isEmri = async (d: { kimlik: string; dosyaNo: string }, statu = 'Aktif', tur = 'ON') => (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, statu, hazirlayan_ref) VALUES ($1,$2,$3,$4,'Y','K',1000,$5,$6) RETURNING kimlik`, [`${d.dosyaNo}-${tur}${Math.floor(Math.random() * 90 + 10)}`, tur, d.kimlik, firma, statu, o.K.oy])).rows[0].kimlik as string;
const ncr = async (d: { kimlik: string }, x: object, kim = 'kk') => o.ist('POST', `/api/dosya/${d.kimlik}/uygunsuzluk`, await o.gir(kim), { kaynak: 'Ara kontrol', yer: 'Y', olcut: `Ö${Math.random()}`, durum: 'Fark', belge: await o.belge(d.kimlik, 'ds'), ...x });

beforeAll(async () => {
  o = await ortamKur('yatonet360_test17', KADRO);
  const fir = async (u: string, r: string) => { const id = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: u, rol: r })).json().kimlik; await o.ist('POST', `/api/firma/${id}/statu`, await o.gir('fym'), { asama: 'Onaylı', ag: 'Aktif', gerekce: 'G' }); return id as string; };
  firma = await fir('Kalite Firma', 'Çözüm Ortağı'); tedarikci = await fir('Parça AŞ', 'Tedarikçi');
}, 120_000);
afterAll(async () => { await o.kapat(); });

describe('metin güvencesi', () => {
  it('dışa giden hiçbir metinde teminat yok (SGT-1)', async () => {
    const { rows } = await o.sup.query(`SELECT kod, metin FROM sablon_metni`);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.filter((r) => /teminat|cover terms|coverage/i.test(r.metin)).map((r) => r.kod)).toEqual([]);
    expect(readFileSync('../../veri/deger_listeleri.tsv', 'utf8')).not.toMatch(/teminat koşulları|cover terms/);
    expect(readFileSync('src/onay.ts', 'utf8')).not.toMatch(/teminat/i);
  });
});
describe('kurallar', () => {
  it('sınıf kuralı (YG-283)', () => {
    expect(sinifEngeli('Majör', null, null, true)).toContain('Kritik'); expect(sinifEngeli('Kritik', 'A', null, true)).toBeNull();
    expect(sinifEngeli('Minör', 'A', null, false)).toContain('A sınıfı'); expect(sinifEngeli('Minör', 'B', 'Yüksek', false)).toContain('Majör'); expect(sinifEngeli('Minör', 'B', 'Düşük', false)).toBeNull();
  });
  it('süreler, cihaz, gaz', () => {
    const t = new Date('2026-01-01T00:00:00Z');
    expect(ncrHedefi('Minör', t)!.toISOString()).toBe('2026-01-06T00:00:00.000Z'); expect(ncrHedefi('Majör', t)!.toISOString()).toBe('2026-01-03T00:00:00.000Z'); expect(ncrHedefi('Kritik', t)).toBeNull();
    expect(cihazGecerli({ kalibrasyon_tarihi: '2025-01-01', aralik_ay: 12, kabul: true }, new Date('2025-12-31'))).toBe(true);
    expect(cihazGecerli({ kalibrasyon_tarihi: '2025-01-01', aralik_ay: 12, kabul: true }, new Date('2026-01-02'))).toBe(false);
    expect(cihazGecerli({ kalibrasyon_tarihi: '2025-01-01', aralik_ay: 12, kabul: false }, new Date('2025-02-01'))).toBe(false);
    expect([gazUygun(19.5, 9.9), gazUygun(23.5, 0), gazUygun(19.4, 0), gazUygun(23.6, 0), gazUygun(20, 10)]).toEqual([true, true, false, false, false]);
  });
  it('üçlü eşleştirme', () => {
    expect(eslestir(10, 10, 100, 100).sonuc).toBe('Eşleşti'); expect(eslestir(10, 9, 100, 90).sonuc).toBe('Miktar Farkı'); expect(eslestir(10, 11, 100, 110).sonuc).toBe('Fazla Teslim'); expect(eslestir(10, 10, 100, 100.01)).toEqual({ sonuc: 'Fiyat Farkı', miktarFarki: 0, fiyatFarki: 0.01 });
  });
});
describe('kalite planı (YG-288)', () => {
  it('plansız onarım başlamaz; keşif başlar; A sınıfı Teknik Müdür onaylar', async () => {
    const d = await dosya(); const on = await isEmri(d, 'Başlangıç Kontrolünde'); const kn = await isEmri(d, 'Başlangıç Kontrolünde', 'KN'); const tu = await o.gir('tu');
    expect((await o.ist('POST', `/api/is-emri/${on}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı', 'Absorban ve Bariyer Mevcut'] })).json().hata).toContain('kalite planı');
    expect((await o.ist('POST', `/api/is-emri/${on}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı'] })).json().eksikler).toEqual(['Absorban ve Bariyer Mevcut']); // YG-370
    expect((await o.ist('POST', `/api/is-emri/${kn}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı'] })).statusCode).toBe(200);
    const G = [{ gereklilik: 'Sızdırmazlık', dogrulama: 'Basınç testi' }];
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, await o.gir('ds'), { sinif: 'A', ozet: 'Ö', gereklilikler: G })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'A', ozet: 'Ö', gereklilikler: [{ gereklilik: 'X' }] })).statusCode).toBe(400);
    const p = await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'A', ozet: 'Ö', gereklilikler: G });
    expect(p.statusCode, p.body).toBe(200);
    const k = await o.kart('Kalite Planı', p.json().kimlik);
    expect((await o.karar(k.kimlik, 'ty', 'Onayla')).statusCode).not.toBe(200);
    expect((await o.karar(k.kimlik, 'tm', 'Onayla')).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/is-emri/${on}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı', 'Absorban ve Bariyer Mevcut'] })).json().hata).toContain('toplantısı');
    await o.sup.query(`INSERT INTO baslangic_toplantisi (is_emri_ref, tarih, katilimcilar, konusulanlar, kaydeden_ref) VALUES ($1,current_date,'K','K',$2)`, [on, o.K.ds]);
    expect((await o.ist('POST', `/api/is-emri/${on}/baslangic`, tu, { sonuc: 'Başlanabilir', onKosul: ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı', 'Absorban ve Bariyer Mevcut'] })).statusCode).toBe(200);
    expect((await ncr(d, { sinif: 'Minör' })).json().hata).toContain('A sınıfı');
  });
});
describe('uygunsuzluk (YG-283, YG-284, YG-285, YG-392)', () => {
  it('Kritik işi durdurur, Olduğu Gibi Kabul yok, son karar Kalite Müdürü; kök neden ve kanıtla kapanır; emniyet işaretliyse işi Teknik Müdür başlatır', async () => {
    const d = await dosya(); const e = await isEmri(d);
    const r = await ncr(d, { sinif: 'Kritik', emniyet: true, isEmri: e });
    expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ uygunsuzlukNo: `${d.dosyaNo}-NCR01`, isDurduruldu: true });
    const id = r.json().kimlik;
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [e])).rows[0].statu).toBe('Durduruldu');
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/tasarruf`, await o.gir('kk'), { karar: 'Düzeltme' })).statusCode).toBe(403);
    const km = await o.gir('km');
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/tasarruf`, km, { karar: 'Olduğu Gibi Kabul' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/tasarruf`, km, { karar: 'Düzeltme', bedel: 'İş Birliği Firması' })).statusCode).toBe(200);
    const kanit = await o.belge(d.kimlik, 'ds');
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/kapat`, km, { sonuc: 'Uygun', kanit })).json().hata).toContain('Kök neden');
    const KN = { problem: 'P', dogrudan: 'D', katki: 'K', bariyer: 'B', kokNeden: 'Dikkatsizlik', tekrar: 'Düşük' };
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/kok-neden`, km, KN)).statusCode).toBe(400);
    const kn = await o.ist('POST', `/api/uygunsuzluk/${id}/kok-neden`, km, { ...KN, kokNeden: 'Prosedür eksikliği' });
    expect(kn.statusCode, kn.body).toBe(200);
    const f = await o.ist('POST', `/api/kok-neden/${kn.json().kimlik}/faaliyet`, km, { tur: 'Düzeltici faaliyet', aciklama: 'A', sorumlu: o.K.tu, hedef: ileri(5), gosterge: 'G', izleme: 30 });
    expect(f.statusCode, f.body).toBe(200);
    const fid = f.json().kimlik;
    expect((await o.ist('POST', `/api/faaliyet/${fid}/etkinlik`, km, { sonuc: 'Etkisiz', kanit })).json().statu).toBe('Açık');
    expect((await o.ist('POST', `/api/faaliyet/${fid}/etkinlik`, km, { sonuc: 'Etkili', kanit })).json().statu).toBe('Kapalı');
    const tespit = (await o.sup.query(`SELECT kanit_belge_ref k FROM uygunsuzluk WHERE kimlik = $1`, [id])).rows[0].k;
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/kapat`, km, { sonuc: 'Uygun', kanit: tespit })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/uygunsuzluk/${id}/kapat`, km, { sonuc: 'Uygun', kanit })).json().statu).toBe('Kapalı');
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [e])).rows[0].statu).toBe('Durduruldu');
    expect((await o.ist('POST', `/api/is-emri/${e}/yeniden-baslat`, await o.gir('tm'), { gerekce: 'Ölçüm temiz' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT statu, durdurma_nedeni FROM is_emri WHERE kimlik = $1`, [e])).rows[0]).toEqual({ statu: 'Aktif', durdurma_nedeni: null });
  });
  it('firma yeni hasarında ihbar ve mahsup zorunlu; Minör kök nedensiz Kalite Kontrolörce kapanır; süre aşımı tek kart açar', async () => {
    const d = await dosya(); const kk = await o.gir('kk');
    const n = (await ncr(d, { sinif: 'Minör', yeniHasar: true })).json().kimlik;
    expect((await o.ist('POST', `/api/uygunsuzluk/${n}/tasarruf`, kk, { karar: 'Düzeltme' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/uygunsuzluk/${n}/tasarruf`, kk, { karar: 'Düzeltme', ihbar: '2026-11-03', mahsup: 'M1' })).statusCode).toBe(200);
    await o.sup.query(`UPDATE uygunsuzluk SET hedef_zamani = now() - interval '1 hour' WHERE kimlik = $1`, [n]);
    await kaliteSureIsle(o.db); await kaliteSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Uygunsuzluk Süre Aşımı' AND nesne_kimligi = $1`, [n])).rows[0].n).toBe(1);
    expect((await o.ist('POST', `/api/uygunsuzluk/${n}/kapat`, kk, { sonuc: 'Uygun', kanit: await o.belge(d.kimlik, 'ds') })).json().statu).toBe('Kapalı');
  });
});
describe('test (YG-286, YG-396, YG-397)', () => {
  it('öznel ölçüt yok, kalibrasyonsuz cihaz yok, üç ayrı kişi, yeniden test yeni numara; başarısızı başarılı yenileme kapıyı açar', async () => {
    const d = await dosya(); const tu = await o.gir('tu'); const T = { grup: 'Makine ve Tahrik', amac: 'A', yontem: 'Y', olcut: '≤ 80 °C', durdurma: 'Alarm' }; const u = `/api/dosya/${d.kimlik}/test`;
    expect((await o.ist('POST', u, tu, { ...T, olcut: 'normal' })).statusCode).toBe(400);
    const c = (await o.ist('POST', '/api/olcum-cihazi', tu, { ad: 'Termometre', seri: `S${Math.random()}`, tarih: '2020-01-01' })).json().kimlik;
    expect((await o.ist('POST', u, tu, { ...T, cihazlar: [c] })).json().hata).toContain('kalibrasyonu');
    const t = await o.ist('POST', u, tu, T);
    expect(t.statusCode, t.body).toBe(200); expect(t.json().testNo).toBe(`${d.dosyaNo}-TS01`);
    const id = t.json().kimlik; const ham = await o.belge(d.kimlik, 'ds');
    const bitir = async (x: string, sonuc: string) => { expect((await o.ist('POST', `/api/test/${x}/sonuc`, tu, { sonuc, gerekce: 'G', hamVeri: ham })).statusCode).toBe(200); expect((await o.ist('POST', `/api/test/${x}/kontrol`, await o.gir('ty'))).statusCode).toBe(200); return o.ist('POST', `/api/test/${x}/karar`, await o.gir('tm')); };
    expect((await o.ist('POST', `/api/test/${id}/sonuc`, await o.gir('ty'), { sonuc: 'Başarısız', gerekce: 'G', hamVeri: ham })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/test/${id}/sonuc`, tu, { sonuc: 'Başarısız', gerekce: 'G' })).statusCode).toBe(400);
    expect((await bitir(id, 'Başarısız')).json().sonuc).toBe('Başarısız');
    expect((await o.ist('POST', `/api/test/${id}/sonuc`, tu, { sonuc: 'Başarılı', gerekce: 'G', hamVeri: ham })).statusCode).toBe(409);
    const E = { kimlik: '00000000-0000-0000-0000-000000000000', dosya_ref: d.kimlik };
    expect(await kabulEngeli(o.db, E, 'Kabul')).toContain('Başarısız');
    const t2 = (await o.ist('POST', u, tu, { ...T, onceki: id })).json();
    expect(t2.testNo).toBe(`${d.dosyaNo}-TS02`);
    expect(await kabulEngeli(o.db, E, 'Kabul')).toContain('tamamlanmamış');
    await bitir(t2.kimlik, 'Başarılı');
    expect(await kabulEngeli(o.db, E, 'Kabul')).toBeNull();
    const a = await o.ist('POST', `/api/test/${t2.kimlik}/kontrol`, tu); expect(a.statusCode).toBe(409);
  });
  it('dış uzman / muayene raporu sonucu test sonucuna eşlenir (YG-398)', async () => {
    const d = await dosya(); const tu = await o.gir('tu'); const T = { grup: 'Makine ve Tahrik', amac: 'A', yontem: 'Y', olcut: '≤ 80 °C', durdurma: 'Alarm' }; const ham = await o.belge(d.kimlik, 'ds');
    const dx = (await o.ist('POST', `/api/dosya/${d.kimlik}/test`, tu, T)).json().kimlik;
    expect((await o.ist('POST', `/api/test/${dx}/sonuc`, tu, { disRapor: 'Uygun Değil', sonuc: 'Başarılı', gerekce: 'G', hamVeri: ham })).json().hata).toContain('Başarısız');
    expect((await o.ist('POST', `/api/test/${dx}/sonuc`, tu, { disRapor: 'Uygun Değil', gerekce: 'G', hamVeri: ham })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT sonuc, dis_rapor_sonucu FROM test_kaydi WHERE kimlik = $1`, [dx])).rows[0]).toEqual({ sonuc: 'Başarısız', dis_rapor_sonucu: 'Uygun Değil' });
  });
  it('hazırlayan kontrol edemez, kontrol eden karar veremez', async () => {
    const d = await dosya(); const tu = await o.gir('tu'); const id = (await o.ist('POST', `/api/dosya/${d.kimlik}/test`, tu, { grup: 'Makine ve Tahrik', amac: 'A', yontem: 'Y', olcut: '5 bar', durdurma: 'D' })).json().kimlik;
    await o.ist('POST', `/api/test/${id}/sonuc`, tu, { sonuc: 'Başarılı', gerekce: 'G', hamVeri: await o.belge(d.kimlik, 'ds') });
    expect((await o.ist('POST', `/api/test/${id}/kontrol`, tu)).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/test/${id}/kontrol`, await o.gir('ty'))).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/test/${id}/karar`, await o.gir('ty'))).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/test/${id}/karar`, await o.gir('tm'))).statusCode).toBe(200);
  });
});
describe('kabul (YG-281, YG-287, YG-289, YG-400, YG-401)', () => {
  it('açık Majör koşullu kabulü, açık Minör tam kabulü durdurur; koşullu kabul 30 gün, bir uzatma, süre dolunca Beklemede', async () => {
    const d = await dosya(); const e = await isEmri(d, 'Tamamlandı'); const tu = await o.gir('tu'); const km = await o.gir('km'); const u = `/api/is-emri/${e}/kosullu-kabul`;
    const P = { bitis: ileri(30), kalemler: [{ tanim: 'T', etki: 'E', hedef: ileri(10), bedel: 0 }] };
    const mj = (await ncr(d, { sinif: 'Majör', isEmri: e })).json().kimlik;
    expect((await o.ist('POST', u, tu, P)).json().hata).toContain('Majör');
    await o.sup.query(`UPDATE uygunsuzluk SET statu = 'Kapalı' WHERE kimlik = $1`, [mj]);
    await ncr(d, { sinif: 'Minör', isEmri: e });
    expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Kabul' })).json().hata).toContain('Minör');
    expect((await o.ist('POST', u, tu, { ...P, bitis: ileri(32) })).statusCode).toBe(400);
    const k = await o.ist('POST', u, tu, P);
    expect(k.statusCode, k.body).toBe(200);
    expect((await o.ist('POST', `/api/kabul/${k.json().kimlik}/uzat`, tu)).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/kabul/${k.json().kimlik}/uzat`, km)).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/kabul/${k.json().kimlik}/uzat`, km)).statusCode).toBe(409);
    await o.sup.query(`UPDATE kabul_kaydi SET kosul_bitis = current_date - 1 WHERE kimlik = $1`, [k.json().kimlik]);
    await kaliteSureIsle(o.db); await kaliteSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM beklemede_isareti WHERE dosya_ref = $1 AND neden = 'Koşullu Kabul Süresi Doldu'`, [d.kimlik])).rows[0].n).toBe(1);
    expect((await o.sup.query(`SELECT gecikti FROM acik_is_kalemi WHERE kabul_ref = $1`, [k.json().kimlik])).rows[0].gecikti).toBe(true);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/nihai-kabul`, await o.gir('ty'))).statusCode).toBe(409);
  });
  it('nihai kabul: bütünleşik test şartı, garanti başlangıcı', async () => {
    const d = await dosya(); const ty = await o.gir('ty');
    const ek = (g: string) => o.sup.query(`INSERT INTO test_kaydi (test_no, dosya_ref, test_grubu, amac_kapsam, yontem, kabul_olcutu, durdurma_kosulu, sonuc, durum, hazirlayan_ref) VALUES ($1,$2,$3,'A','Y','Ö','D','Başarılı','Tamamlandı',$4)`, [`${d.dosyaNo}-TX${Math.random()}`, d.kimlik, g, o.K.tu]);
    await ek('Makine ve Tahrik'); await ek('Elektrik/Elektronik');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/nihai-kabul`, ty)).json().hata).toContain('Bütünleşik');
    await ek('Arayüz / Bütünleşik');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/nihai-kabul`, ty);
    expect(r.statusCode, r.body).toBe(200); expect(r.json().garantiBaslangic).toBe(ileri(0));
  });
  it('kanıtsız gereklilik tam kabulü durdurur', async () => {
    const d = await dosya(); const e = await isEmri(d, 'Tamamlandı'); const tu = await o.gir('tu');
    const p = (await o.ist('POST', `/api/dosya/${d.kimlik}/kalite-plani`, tu, { sinif: 'C', ozet: 'Ö', gereklilikler: [{ gereklilik: 'G', dogrulama: 'D' }] })).json().kimlik;
    await o.karar((await o.kart('Kalite Planı', p)).kimlik, 'ty', 'Onayla');
    expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Kabul' })).json().hata).toContain('gerekliliğin');
    const g = (await o.sup.query(`SELECT kimlik FROM gereklilik_satiri WHERE plan_ref = $1`, [p])).rows[0].kimlik;
    expect((await o.ist('POST', `/api/gereklilik/${g}/kanit`, tu, { belge: await o.belge(d.kimlik, 'ds'), durum: 'Karşılandı' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Bekletmede' })).statusCode).toBe(400); // YG-649 gerekçe
    expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Bekletmede', gerekce: 'Parça bekleniyor' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/is-emri/${e}/kapat`, tu, {})).statusCode).not.toBe(200);
    expect((await o.ist('POST', `/api/is-emri/${e}/teknik-kabul`, tu, { sonuc: 'Kabul' })).statusCode).toBe(200);
  });
});
describe('kontrol noktası (YG-383, YG-389)', () => {
  it('davet süresi, A sınıfında iki onay', async () => {
    const d = await dosya(); const e = await isEmri(d); await o.sup.query(`UPDATE is_emri SET kabul_sinifi = 'A' WHERE kimlik = $1`, [e]); const tu = await o.gir('tu'); const u = `/api/is-emri/${e}/kontrol-noktasi`;
    const K = { tur: 'Bekletme', ozellik: 'Ö', olcut: '5 bar', zaman: new Date(Date.now() + 30 * 3_600_000).toISOString() };
    expect((await o.ist('POST', u, tu, { ...K, eksperKlas: true })).json().hata).toContain('48');
    expect((await o.ist('POST', u, tu, { ...K, olcut: 'Uygun görüldü' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, tu, K);
    expect(r.statusCode, r.body).toBe(200); expect(r.json().no).toMatch(/-KP01$/);
    const id = r.json().kimlik; const kanit = await o.belge(d.kimlik, 'ds'); const su = `/api/kontrol-noktasi/${id}/sonuc`;
    expect((await o.ist('POST', su, tu, { sonuc: 'Uygun', kanit })).statusCode).toBe(403);
    expect((await o.ist('POST', su, await o.gir('ty'), { sonuc: 'Uygun', kanit })).json()).toMatchObject({ serbest: false, bekleyen: ['Kalite Müdürü'] });
    expect((await o.ist('POST', su, await o.gir('km'), { sonuc: 'Uygun', kanit })).json().serbest).toBe(true);
  });
});
describe('tedarik (YG-823, YG-404, YG-1589)', () => {
  const S = () => ({ tedarikci, teklifRef: 'T1', kullanim: 'Ana makine', teslimTarihi: ileri(10), teslimYeri: 'Depo', olcut: 'Ö', gerekce: 'G', kalemler: [{ tanim: 'Pompa', parcaNo: 'P1', miktar: 2, birim: 'adet', bedel: 100 }] });
  it('avans alınmadan sipariş yok; zincir; lotsuz giriş yok; fazla teslim yok; eşleştirme mükerrer değil', async () => {
    const d = await dosya();
    const c = await o.gir('ts'); const u = `/api/dosya/${d.kimlik}/siparis`;
    expect((await o.ist('POST', u, await o.gir('ds'), S())).statusCode).toBe(403);
    await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,'Karar','Tam Onay',1000,200,1200,1000,$3)`, [`${d.dosyaNo}-TK01`, d.kimlik, o.K.ds]);
    expect((await o.ist('POST', u, c, S())).json().hata).toContain('Parça bedeli');
    await o.sup.query(`INSERT INTO odeme_talebi (dosya_ref, tur, tutar_eur, muhatap, son_tarih, durum, hazirlayan_ref) VALUES ($1,'Parça',240,'Yat Sahibi',current_date,'Ödendi',$2)`, [d.kimlik, o.K.ds]);
    const r = await o.ist('POST', u, c, S());
    expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ kdvHaric: 200, toplam: 240 });
    const id = r.json().kimlik; const k = await o.kart('Tedarik Siparişi', id);
    expect(k.zincir).toHaveLength(3);
    const G = { satir: 1, miktar: 2, lot: 'L1', irsaliye: 'İ1', bekletmeYeri: firma };
    expect((await o.ist('POST', `/api/siparis/${id}/giris`, c, G)).statusCode).toBe(409);
    await o.karar(k.kimlik, 'tym', 'Onaya Gönder'); await o.karar(k.kimlik, 'to', 'Onaya Gönder'); expect((await o.karar(k.kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM belge_uretim WHERE tur = 'Tedarik Siparişi' AND nesne = $1`, [id])).rowCount).toBe(1); // YG-1514
    expect((await o.ist('POST', `/api/siparis/${id}/giris`, c, { ...G, lot: '' })).json().hata).toContain('lot');
    expect((await o.ist('POST', `/api/siparis/${id}/giris`, c, { ...G, miktar: 3 })).json().hata).toContain('Fazla');
    const g = await o.ist('POST', `/api/siparis/${id}/giris`, c, G);
    expect(g.statusCode, g.body).toBe(200); expect(g.json().gonderilen).toBe('Teknik Uzman');
    expect((await o.ist('POST', `/api/malzeme-giris/${g.json().kimlik}/karar`, c, { karar: 'Kabul' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/malzeme-giris/${g.json().kimlik}/karar`, await o.gir('tu'), { karar: 'Kabul' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT statu FROM tedarik_siparisi WHERE kimlik = $1`, [id])).rows[0].statu).toBe('Teslim Alındı');
    expect((await o.ist('POST', `/api/siparis/${id}/eslestirme`, c, { no: 'F1', tarih: ileri(0), tutar: 200 })).json().sonuc).toBe('Eşleşti');
    expect((await o.ist('POST', `/api/siparis/${id}/eslestirme`, c, { no: 'F1', tarih: ileri(0), tutar: 200 })).statusCode).toBe(409);
  });
});

describe('uzun terminli parça (YG-868)', () => {
  it('teslim süresi 14 günü aşan sipariş uzun terminli işaretlenir ve GMY onayından geçer', async () => {
    const d = await dosya(); const c = await o.gir('ts'); const u = `/api/dosya/${d.kimlik}/siparis`;
    await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,'Karar','Tam Onay',1000,200,1200,1000,$3)`, [`${d.dosyaNo}-TK01`, d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO odeme_talebi (dosya_ref, tur, tutar_eur, muhatap, son_tarih, durum, hazirlayan_ref) VALUES ($1,'Parça',600,'Yat Sahibi',current_date,'Ödendi',$2)`, [d.kimlik, o.K.ds]);
    const S = (g: number) => ({ tedarikci, teklifRef: 'T1', kullanim: 'Ana makine', teslimTarihi: ileri(g), teslimYeri: 'Depo', olcut: 'Ö', gerekce: 'G', kalemler: [{ tanim: 'Pompa', parcaNo: `P${g}`, miktar: 1, birim: 'adet', bedel: 100 }] });
    const kisa = await o.ist('POST', u, c, S(10)); expect(kisa.statusCode, kisa.body).toBe(200); expect(kisa.json().uzunTerminli).toBe(false);
    const uzun = await o.ist('POST', u, c, S(20)); expect(uzun.statusCode, uzun.body).toBe(200); expect(uzun.json().uzunTerminli).toBe(true);
    const gmy = (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Genel Müdür Yardımcısı'`)).rows[0].kimlik;
    expect((await o.kart('Tedarik Siparişi', uzun.json().kimlik)).zincir).toContain(gmy);
    expect((await o.kart('Tedarik Siparişi', kisa.json().kimlik)).zincir).not.toContain(gmy);
    expect((await o.sup.query(`SELECT uzun_terminli FROM tedarik_siparisi WHERE kimlik = $1`, [uzun.json().kimlik])).rows[0].uzun_terminli).toBe(true);
  });
});
