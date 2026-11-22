import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sicilBelgeSureIsle, sicilKaliteAylik } from '../src/firma_ek.js';
import { kaliteKontrolIsle } from '../src/veri_kalitesi.js';
import { dosyaKapanisIsleri, geciciOnarimIsle, gorevSinifi, gorevlendirmeKontrolu, hizaEngeli, kurtarmaBelgeEngeli, muadilEngeli, takyidatTasimaEngeli } from '../src/firma_ek.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü', hud: 'Hukuk ve Uyum Direktörü', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)' };
let o: Ortam; let say = 0;
const firma = async (asama = 'Onaylı') => (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ($1,'F','Çözüm Ortağı',$2,'Aktif',$3) RETURNING kimlik`, [`S-E${++say}`, asama, o.K.ds])).rows[0].kimlik as string;
const dosya = async () => { const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref <> $1 AND bitis_zamani IS NULL`, [d.kimlik]); return d; };
const belge = async (d: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'K','Gizli','Dosya',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`B-${Math.random()}`, d, o.K.ds])).rows[0].kimlik as string;

beforeAll(async () => { o = await ortamKur('yatonet360_test43', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('görevlendirme kontrolü (YG-304, YG-306, YG-307, YG-332)', () => {
  it('görev sınıfı', () => {
    expect(gorevSinifi({ tutar: 2000 })).toEqual({ sinif: 'G1', asgari: 'Y1' }); expect(gorevSinifi({ tutar: 2000.01 }).sinif).toBe('G2'); expect(gorevSinifi({ tutar: 10000.01 }).sinif).toBe('G3'); expect(gorevSinifi({ tutar: 100, cokBrans: true }).sinif).toBe('G3'); expect(gorevSinifi({ tutar: 50000.01 }).sinif).toBe('G4'); expect(gorevSinifi({ tutar: 100, kritik: true }).asgari).toBe('Y4');
  });
  it('yetkinlik, garanti, çıkar engeli; kapasite ve sigorta uyarısı', async () => {
    const f = await firma(); const d = await dosya();
    await o.sup.query(`INSERT INTO brans_yetkinligi (kurulus_ref, ana_brans, bolge, yetkinlik_seviyesi) VALUES ($1,'MAKINE-01','B','Y2')`, [f]);
    expect((await gorevlendirmeKontrolu(o.db, { firma: f, dosya: d.kimlik, brans: 'MAKINE-01', tutar: 5000 })).sonuc).toBe('Koşullu Kabul');
    const r = await gorevlendirmeKontrolu(o.db, { firma: f, dosya: d.kimlik, brans: 'MAKINE-01', tutar: 20000 }); expect(r.sonuc).toBe('Ret'); expect(r.engeller[0]).toContain('Y3');
    { const sc = await o.gir('fym'); // YG-309
      expect((await o.ist('POST', `/api/firma/${f}/kapasite`, sc, { brans: 'MAKINE-01', sinif: 'G9', adet: 1 })).statusCode).toBe(400);
      expect((await o.ist('POST', `/api/firma/${f}/kapasite`, sc, { brans: 'MAKINE-01', sinif: 'G2', adet: 1 })).statusCode).toBe(200);
      await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref, ana_brans, gorev_sinifi) VALUES ($1,'ON',$2,$3,'M','K','Aktif',$4,'MAKINE-01','G2')`, [`K-${Date.now()}`, d.kimlik, f, o.K.ds]);
      expect((await gorevlendirmeKontrolu(o.db, { firma: f, dosya: d.kimlik, brans: 'MAKINE-01', tutar: 5000 })).engeller.join(' ')).toContain('G2 kapasitesi doludur'); // YG303-KAPASITE: dolu kapasite engeldir
      expect((await o.ist('GET', `/api/firma/${f}/kapasite`, sc)).json()[0]).toMatchObject({ ana_brans: 'MAKINE-01', gorev_sinifi: 'G2', es_zamanli_is: 1, aktif: 1 });
      await o.sup.query(`DELETE FROM is_emri WHERE kurulus_ref = $1 AND ana_brans = 'MAKINE-01'`, [f]); }
    await o.sup.query(`INSERT INTO sicil_belgesi (kurulus_ref, tur, gecerlilik_bitis) VALUES ($1,'Mesleki Sorumluluk Sigortası','2099-01-01')`, [f]);
    await o.sup.query(`INSERT INTO firma_personeli (kurulus_ref, ad_soyad, gorev, giren_ref) VALUES ($1,'Usta','Usta',$2)`, [f, o.K.ds]); // YG-304: personelsiz firma uyarı alır
    expect((await gorevlendirmeKontrolu(o.db, { firma: f, dosya: d.kimlik, tutar: 100 })).sonuc).toBe('Kabul');
    await o.sup.query(`INSERT INTO firma_ekipmani (kurulus_ref, ad, seri_no, kalibrasyon_bitis, kaydeden_ref) VALUES ($1,'Tork Anahtarı','TA-1','2020-01-01',$2)`, [f, o.K.ds]); // YG-304
    const ke = await gorevlendirmeKontrolu(o.db, { firma: f, dosya: d.kimlik, tutar: 100 }); expect(ke.sonuc).toBe('Koşullu Kabul'); expect(ke.uyarilar.join(' ')).toContain('Tork Anahtarı (TA-1)');
    await o.sup.query(`DELETE FROM firma_ekipmani WHERE kurulus_ref = $1`, [f]);
    await o.sup.query(`UPDATE dosya SET garantili_ekipman = true, garantili_ekipman_marka = 'Volvo', garanti_bitis = '2099-01-01' WHERE kimlik = $1`, [d.kimlik]);
    expect((await gorevlendirmeKontrolu(o.db, { firma: f, dosya: d.kimlik })).engeller[0]).toContain('yetkili servise');
    expect((await o.ist('POST', `/api/firma/${f}/sicil-ek`, await o.gir('ds'), { marka: 'Volvo' })).statusCode).toBe(404);
    const taraf = (await o.sup.query(`SELECT x.taraf_no FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref JOIN taraf x ON x.kimlik = y.yat_sahibi_ref WHERE d.kimlik = $1`, [d.kimlik])).rows[0].taraf_no;
    expect((await o.ist('POST', `/api/firma/${f}/sicil-ek`, await o.gir('sc'), { marka: 'volvo', kapasite: 1 })).statusCode).toBe(200);
    expect((await gorevlendirmeKontrolu(o.db, { firma: f, dosya: d.kimlik })).sonuc).toBe('Kabul');
    await o.ist('POST', `/api/firma/${f}/sicil-ek`, await o.gir('sc'), { cikarTaraf: taraf, cikarNot: 'Ortak' });
    expect((await gorevlendirmeKontrolu(o.db, { firma: f, dosya: d.kimlik })).engeller[0]).toContain('çıkar');
  });
});

describe('kurtarma ve kaptan (YG-337, YG-338)', () => {
  it('belge yoksa kurtarma görevlendirilmez', async () => {
    const f = await firma(); expect(await kurtarmaBelgeEngeli(o.db, f, 'Dalgıçlık')).toContain('Türk Bayrağı');
    await o.sup.query(`INSERT INTO sicil_belgesi (kurulus_ref, tur) VALUES ($1,'Türk Bayrağı Belgesi')`, [f]); expect(await kurtarmaBelgeEngeli(o.db, f, 'Dalgıçlık')).toContain('Dalış');
    await o.sup.query(`INSERT INTO sicil_belgesi (kurulus_ref, tur) VALUES ($1,'Dalış Belgesi')`, [f]); expect(await kurtarmaBelgeEngeli(o.db, f, 'Dalgıçlık')).toBeNull(); expect(await kurtarmaBelgeEngeli(o.db, f, 'Çekme / Refakat')).toContain('Römorkörcülük');
  });
  it('belgesi veya poliçesi dolan kaptan görevlendirilemez', async () => {
    const f = await firma(); const d = await dosya(); const sc = await o.gir('sc'); const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/firma/${f}/kaptan`, sc, { ad: 'K' })).statusCode).toBe(400);
    const a = (await o.ist('POST', `/api/firma/${f}/kaptan`, sc, { ad: 'K1', belge: 'B', belgeBitis: '2020-01-01', police: 'P', policeBitis: '2099-01-01' })).json().kimlik;
    const b = (await o.ist('POST', `/api/firma/${f}/kaptan`, sc, { ad: 'K2', belge: 'B', belgeBitis: '2099-01-01', police: 'P', policeBitis: '2020-01-01' })).json().kimlik;
    const c = (await o.ist('POST', `/api/firma/${f}/kaptan`, sc, { ad: 'K3', belge: 'B', belgeBitis: '2099-01-01', police: 'P', policeBitis: '2099-01-01' })).json().kimlik;
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kaptan-gorevlendirme`, ds, { kaptan: a })).json().hata).toContain('yeterlilik');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kaptan-gorevlendirme`, ds, { kaptan: b })).json().hata).toContain('poliçe');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kaptan-gorevlendirme`, ds, { kaptan: c })).json().hata).toContain('Lojistik'); // YG-097
    await o.sup.query(`INSERT INTO brans_yetkinligi (kurulus_ref, ana_brans, kapsama, yetkinlik_seviyesi, durum) VALUES ($1,'LOJISTIK-01','Ulusal','Y2','Aktif')`, [f]);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kaptan-gorevlendirme`, ds, { kaptan: c })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT brans, hizmet_rolu FROM kaptan_gorevlendirme WHERE kaptan_ref = $1`, [c])).rows[0]).toMatchObject({ brans: 'LOJISTIK-01', hizmet_rolu: 'Kaptan' });
  });
});

describe('saha kapıları (YG-409, YG-143, YG-142, YG-141)', () => {
  it('hiza olmadan deniz denemesi yok; yelkende aranmaz', async () => {
    const d = await dosya(); const ds = await o.gir('ds'); await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'h@h.local' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]);
    expect(await hizaEngeli(o.db, d.kimlik)).toContain('hizası');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/onay-iste`, ds, { ony: 'ONY-09', zaman: '2026-12-01T10:00:00Z' })).json().hata).toContain('hizası');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/hiza-kontrolu`, ds, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/hiza-kontrolu`, ds, { belge: await belge(d.kimlik) })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/onay-iste`, ds, { ony: 'ONY-09', zaman: '2026-12-01T10:00:00Z' })).statusCode).toBe(200);
  });
  it('kapasite, yeni hasar görevi, tedbirli yat HUD onayı', async () => {
    const d = await dosya(); const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/kaldirma-tasima`;
    expect((await o.ist('POST', u, ds, { tur: 'Kaldırma', ekipman: 'Travel', kapasite: 10, agirlik: 12 })).json().hata).toContain('kapasitesi');
    expect((await o.ist('POST', u, ds, { tur: 'Kaldırma', ekipman: 'Travel', kapasite: 15, agirlik: 12, yeniHasar: true })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { tur: 'Kaldırma', ekipman: 'Travel', kapasite: 15, agirlik: 12, yeniHasar: true, hasarAciklama: 'Kayış izi' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Uygunsuzluk Kaydı Aç' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
    expect((await o.ist('POST', u, ds, { tur: 'Kara Taşıması', ekipman: 'Römork', kapasite: 20, agirlik: 12 })).json().hata).toContain('güzergâh'); // YG-376
    expect((await o.ist('POST', u, ds, { tur: 'Denize İndirme', ekipman: 'Travel', kapasite: 15, agirlik: 12 })).json().hata).toContain('su alma');
    expect((await o.ist('POST', u, ds, { tur: 'Denize İndirme', ekipman: 'Travel', kapasite: 15, agirlik: 12, suAlma: 'Su Alma Var' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT oncelik FROM is_karti WHERE tur = 'Su Alma Tedbiri' AND nesne_kimligi = $1`, [d.kimlik])).rows[0].oncelik).toBe('Kritik');
    await o.sup.query(`UPDATE yat SET takyidat = '{Haciz}' WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
    expect(await takyidatTasimaEngeli(o.db, d.kimlik)).toContain('Hukuk');
    expect((await o.ist('POST', u, ds, { tur: 'Tesis Değişikliği', ekipman: 'Römork' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/tasima-onayi`, ds, { gerekce: 'Fırtına' })).statusCode).toBe(200);
    const k = await o.kart('Taşıma Onayı', d.kimlik); await o.karar(k.kimlik, 'hud', 'Onayla');
    expect((await o.ist('POST', u, ds, { tur: 'Tesis Değişikliği', ekipman: 'Römork' })).statusCode).toBe(200);
  });
  it('geçici onarım 30 gün, 2 uzatma, toplam 60; su almada her gün kontrol', async () => {
    const d = await dosya(); const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/gecici-onarim`; const P = { islem: 'Yama', uygulama: '2026-11-01', kullanim: 'Limanda', suAlma: true };
    expect((await o.ist('POST', u, ds, { ...P, son: '2026-12-02' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, ds, { ...P, son: '2026-12-01' }); expect(r.statusCode, r.body).toBe(200); const uz = `/api/gecici-onarim/${r.json().kimlik}/uzat`;
    expect((await o.ist('POST', uz, ds, { son: '2026-12-10' })).statusCode).toBe(403); const ty = await o.gir('ty');
    expect((await o.ist('POST', uz, ty, { son: '2027-01-01' })).json().hata).toContain('60');
    expect((await o.ist('POST', uz, ty, { son: '2026-12-10' })).statusCode).toBe(200); expect((await o.ist('POST', uz, ty, { son: '2026-12-20' })).statusCode).toBe(200);
    expect((await o.ist('POST', uz, ty, { son: '2026-12-21' })).json().hata).toContain('2 uzatma');
    expect(await geciciOnarimIsle(o.db, new Date('2026-11-02T10:00:00Z'))).toBeGreaterThan(0);
    expect(await geciciOnarimIsle(o.db, new Date('2026-12-25T10:00:00Z'))).toBeGreaterThan(0);
  });
});

describe('firma portalı ve kapanış (YG-411, YG-423, YG-867, YG-1660, YG-416)', () => {
  it('muadil liste ve ONY-07 kapısı', async () => {
    const d = await dosya(); expect(await muadilEngeli(o.db, d.kimlik, 'A1', 'B1', 'Pompa')).toContain('listede');
    expect((await o.ist('POST', '/api/onayli-parca', await o.gir('ds'), { orijinal: 'A1', muadil: 'B1', dayanak: 'Klas Onayı' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/onayli-parca', await o.gir('tm'), { orijinal: 'A1', muadil: 'B1', dayanak: 'Bilgim' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/onayli-parca', await o.gir('tm'), { orijinal: 'A1', muadil: 'B1', dayanak: 'Klas Onayı' })).statusCode).toBe(200);
    expect(await muadilEngeli(o.db, d.kimlik, 'A1', 'B1', 'Pompa')).toContain('müşteri onayı');
  });
  it('kalıcı askı üç görüşten geçer', async () => {
    const f = await firma(); expect((await o.ist('POST', `/api/firma/${f}/kalici-aski-onerisi`, await o.gir('sc'), { gerekce: 'G' })).statusCode).toBe(403);
    const r = await o.ist('POST', `/api/firma/${f}/kalici-aski-onerisi`, await o.gir('fym'), { gerekce: 'Tekrarlı' }); expect(r.statusCode).toBe(200);
    const k = await o.kart('Kalıcı Askı Önerisi', f); expect(k.zincir).toHaveLength(3); // YG-1426
    await o.karar(k.kimlik, 'tm', 'Onaya Gönder', 'Görüş'); await o.karar(k.kimlik, 'opm', 'Onaya Gönder', 'Görüş');
    expect((await o.karar(k.kimlik, 'btd', 'Onayla')).statusCode).toBe(409);
    const h = await o.kart('Kalıcı Askı Hukuk Görüşü', f); expect((await o.karar(h.kimlik, 'hud', 'Onayla', 'Uygun')).statusCode).toBe(200);
    expect((await o.karar(k.kimlik, 'btd', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT ag_statusu FROM kurulus WHERE kimlik = $1`, [f])).rows[0].ag_statusu).toBe('Askıda');
  });
  it('yurt dışı yerel firma talebi: Operasyon Müdürü açar, iki onay birbirini beklemez (YG-1660)', async () => {
    const u = '/api/firma/yurt-disi-talep';
    expect((await o.ist('POST', u, await o.gir('fym'), { ulke: 'Yunanistan', sehir: 'Rodos', brans: 'Makine', gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('opm'), { ulke: 'Yunanistan' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, await o.gir('opm'), { ulke: 'Yunanistan', sehir: 'Rodos', brans: 'Makine', gerekce: 'Bölgede firma yok' }); expect(r.statusCode, r.body).toBe(200);
    const durum = async () => (await o.sup.query(`SELECT durum FROM yurt_disi_firma_talebi WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum;
    await o.karar((await o.kart('Yurt Dışı Firma Hukuk Onayı', r.json().kimlik)).kimlik, 'hud', 'Onayla'); expect(await durum()).toBe('Onayda');
    await o.karar((await o.kart('Yurt Dışı Firma Onayı', r.json().kimlik)).kimlik, 'fym', 'Onayla'); expect(await durum()).toBe('Onaylandı');
    const r2 = (await o.ist('POST', u, await o.gir('opm'), { ulke: 'Hırvatistan', sehir: 'Split', brans: 'Boya', gerekce: 'G' })).json().kimlik;
    await o.karar((await o.kart('Yurt Dışı Firma Onayı', r2)).kimlik, 'fym', 'Reddet', 'Uygun değil');
    expect((await o.sup.query(`SELECT durum FROM yurt_disi_firma_talebi WHERE kimlik = $1`, [r2])).rows[0].durum).toBe('Reddedildi');
  });
  it('geçici askıda her açık iş için ayrı karar; öneri öndeğer, farklı kararda gerekçe (YG-1660)', async () => {
    const d = await dosya(); const f = await firma();
    const ie = async (no: string, statu: string) => (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K',$4,$5) RETURNING kimlik`, [`${d.dosyaNo}-${no}`, d.kimlik, f, statu, o.K.ds])).rows[0].kimlik as string;
    const aktif = await ie('ON01', 'Aktif'); const bekl = await ie('ON02', 'Kabul Bekliyor'); await ie('ON03', 'Tamamlandı');
    const r = await o.ist('POST', `/api/firma/${f}/statu`, await o.gir('fym'), { ag: 'Geçici Askıda', gerekce: 'Belge süresi doldu' }); expect(r.statusCode, r.body).toBe(200);
    const k = (await o.sup.query(`SELECT kimlik, is_emri_ref, oneri FROM aski_is_karari WHERE kurulus_ref = $1 ORDER BY oneri`, [f])).rows;
    expect(k.map((x) => x.oneri)).toEqual(['Devir', 'Ek Gözetim']);
    expect((await o.ist('GET', '/api/aski/acik-isler', await o.gir('fym'))).json().filter((x: { kimlik: string }) => k.some((z) => z.kimlik === x.kimlik))).toHaveLength(2); // T-YG1654
    expect((await o.ist('GET', '/api/aski/acik-isler', await o.gir('ds'))).statusCode).toBe(404);
    const ak = k.find((x) => x.is_emri_ref === aktif)!.kimlik; const bk = k.find((x) => x.is_emri_ref === bekl)!.kimlik;
    expect((await o.ist('POST', `/api/aski-karari/${ak}`, await o.gir('ds'), { karar: 'Güvenli Durdurma' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/aski-karari/${ak}`, await o.gir('ds'), { karar: 'Güvenli Durdurma', gerekce: 'Emniyet' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [aktif])).rows[0].statu).toBe('Durduruldu');
    expect((await o.ist('POST', `/api/aski-karari/${bk}`, await o.gir('ds'), {})).json().karar).toBe('Devir');
    expect((await o.kart('Firma Değiştir', bekl)).baslik).toContain('Devir');
  });
  it('kapanışta konum kapanır, garanti izleme açılır', async () => {
    const d = await dosya();
    await dosyaKapanisIsleri(o.db, d.kimlik); expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Garanti İzleme' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(0); // KS-1: tanımsız garantide izleme yok
    await o.sup.query(`UPDATE dosya SET garanti_tanimli = true, garanti_suresi_ay = 12, garanti_kapsami = 'İşçilik' WHERE kimlik = $1`, [d.kimlik]);
    await dosyaKapanisIsleri(o.db, d.kimlik);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Garanti İzleme' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
    await dosyaKapanisIsleri(o.db, d.kimlik); expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Garanti İzleme' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
  });
});

describe('iadede geri dönülecek aşama (YG-153)', () => {
  it('son makam önceki kademeye iade eder', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ($1,'İade Firma','Çözüm Ortağı','Onaylı','Aktif',$2) RETURNING kimlik`, [`SC-I${Date.now()}`, o.K.ds])).rows[0].kimlik;
    expect((await o.ist('POST', `/api/firma/${f}/kalici-aski-onerisi`, await o.gir('fym'), { gerekce: 'G' })).statusCode).toBe(200);
    const k = await o.kart('Kalıcı Askı Önerisi', f);
    await o.karar(k.kimlik, 'tm', 'Onaya Gönder', 'Görüş'); await o.karar(k.kimlik, 'opm', 'Onaya Gönder', 'Görüş');
    expect((await o.ist('POST', `/api/is/${k.kimlik}/karar`, await o.gir('btd'), { karar: 'Gerekçeyle İade Et', gerekce: 'Operasyon görüşünü netleştiriniz', donulecekKademe: 1 })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, kademe FROM is_karti WHERE kimlik = $1`, [k.kimlik])).rows[0]).toMatchObject({ durum: 'Bekliyor', kademe: 1 });
  });
});

describe('ağ statüsü geçişleri (YG-357, YG-359)', () => {
  it('Pasif yalnız Aktif firmadan nedenle; yaptırımdan yükseltme kanıt ister; basamak atlanabilir', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ($1,$2,'Çözüm Ortağı','Onaylı','Aktif',$3) RETURNING kimlik`, [`S-AG${Date.now()}`, `Ağ Firma ${Date.now()}`, o.K.ds])).rows[0].kimlik;
    const c = await o.gir('fym'); const u = `/api/firma/${f}/statu`;
    expect((await o.ist('POST', u, c, { ag: 'Pasif', gerekce: 'G' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, c, { ag: 'Pasif', pasifNedeni: 'Firma Talebi', gerekce: 'Talep' })).statusCode).toBe(200);
    expect((await o.ist('POST', u, c, { ag: 'Aktif', gerekce: 'Döndü' })).statusCode).toBe(200);
    await o.sup.query(`UPDATE kurulus SET ag_statusu = 'Askıda' WHERE kimlik = $1`, [f]);
    expect((await o.ist('POST', u, c, { ag: 'Pasif', pasifNedeni: 'Hareketsizlik', gerekce: 'G' })).statusCode).toBe(409);
    expect((await o.ist('POST', u, c, { ag: 'Aktif', gerekce: 'İyileşti' })).json().hata).toContain('iyileştirme kanıtı');
    const bl = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, olusturan_ref) VALUES ('DÖF Kapanış', 'Diğer', 'Kurumsal', 'Kuruluş', $1, 'Sistem', $2) RETURNING kimlik`, [f, o.K.ds])).rows[0].kimlik;
    expect((await o.ist('POST', u, c, { ag: 'Aktif', kanit: bl, gerekce: 'İyileşti' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT ag_statusu, son_iyilestirme_kaniti_ref FROM kurulus WHERE kimlik = $1`, [f])).rows[0]).toEqual({ ag_statusu: 'Aktif', son_iyilestirme_kaniti_ref: bl });
    expect((await o.sup.query(`SELECT son_statu_karar_zamani > now() - interval '1 minute' t, sonraki_gozden_gecirme_tarihi FROM kurulus WHERE kimlik = $1`, [f])).rows[0]).toEqual({ t: true, sonraki_gozden_gecirme_tarihi: null }); // YG-1816
    await o.sup.query(`UPDATE kurulus SET kabul_karar_zamani = now() - interval '2 years' WHERE kimlik = $1`, [f]); // YG-357
    const { sahaSureIsle } = await import('../src/saha_kayit.js'); await sahaSureIsle(o.db); await sahaSureIsle(o.db);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Pasif Önerisi' AND nesne_kimligi = $1`, [f])).rows[0].n).toBe(1);
  });
});

describe('firma belge süresi izleme (YG-342, YG-420)', () => {
  it('30 gün kala ve süre dolunca bildirim; açık işte etki görevi; iş emri durumu firmaya (T-YG342-BELGE)', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'Belge Firma','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-BS${Date.now()}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO sicil_belgesi (kurulus_ref, tur, gecerlilik_bitis, kontrol_eden_ref) VALUES ($1,'Faaliyet Belgesi', current_date + 10, $2), ($1,'İmza Sirküleri', current_date - 2, $2)`, [f, o.K.sc]);
    const d = await dosya();
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Y','K','Aktif',$4)`, [`${d.dosyaNo}-ON77`, d.kimlik, f, o.K.ds]);
    expect(await sicilBelgeSureIsle(o.db)).toBeGreaterThanOrEqual(2);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari LIKE 'sicil-belge-%'`, [o.K.sc])).rows[0].n).toBeGreaterThanOrEqual(2);
    expect((await o.sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Belge Süresi Etki Değerlendirmesi' AND nesne_kimligi = $1`, [f])).rows[0].n).toBe(1);
    const n2 = await sicilBelgeSureIsle(o.db); expect(n2).toBe(0);
  });
});
describe('Süresi dolmuş zorunlu belge (YG-1648)', () => {
  it('aktif firmada süresi dolmuş ve yenisi olmayan belge Sicil Sorumlusuna listelenir (T-YG1648)', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref, ag_statusu, kayit_asamasi) VALUES ($1,'Belgesi Dolan Tersane','Çözüm Ortağı',$2,'Aktif','Onaylı') RETURNING kimlik`, [`S-BD${Date.now()}`, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO sicil_belgesi (kurulus_ref, tur, gecerlilik_bitis) VALUES ($1,'SGK Borcu Yoktur Yazısı','2020-01-01'),($1,'Mesleki Sorumluluk Sigortası','2020-01-01'),($1,'Mesleki Sorumluluk Sigortası','2099-01-01')`, [f]);
    const l = (await o.ist('GET', '/api/sicil/suresi-dolmus-belgeler', await o.gir('sc'))).json().filter((x: { firma: string }) => x.firma === f);
    expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ tur: 'SGK Borcu Yoktur Yazısı', engelleyici: true });
    expect((await o.ist('GET', '/api/sicil/suresi-dolmus-belgeler', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('T-YG1650: ön inceleme 15 iş günü, kanıta bağlı puan, görev ayrılığı; öneri Müdür Yardımcısı ve Müdür onayıyla uygulanır', async () => {
    await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref, atama_durumu, baslangic_tarihi) SELECT $1, kimlik, 'Aktif', current_date - 1 FROM rol WHERE rol_adi = 'Firma Yönetimi Yöneticisi'`, [o.K.oy]);
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref, kayit_asamasi) VALUES ($1,'Başvuru Tersanesi','Çözüm Ortağı',$2,'Başvuru') RETURNING kimlik`, [`S-KO${Date.now()}`, o.K.ds])).rows[0].kimlik;
    const sc = await o.gir('sc'); const fy = await o.gir('oy');
    // Dağıtım Bekleyen Başvurular: Firma Yönetimi Yöneticisi Sicil Sorumlusuna atar; ön incelemeye atanan gönderir.
    const ks = (await o.ist('GET', '/api/firma/kabul-sistemi', fy)).json();
    expect(ks.dagitim.some((x: { kimlik: string }) => x.kimlik === f)).toBe(true); expect(ks.gostergeler).toHaveLength(12);
    expect((await o.ist('GET', '/api/firma/kabul-sistemi', sc)).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/firma/${f}/sicil-ata`, fy, { kullanici: o.K.ds })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/firma/${f}/sicil-ata`, fy, { kullanici: o.K.sc })).statusCode).toBe(200);
    expect((await o.kart('Başvuru Belge Kontrolü', f)).sahip_kullanici_ref).toBe(o.K.sc);
    expect((await o.ist('POST', `/api/firma/${f}/sicil-ata`, fy, { kullanici: o.K.sc })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/firma/${f}/on-incelemeye-gonder`, await o.gir('ds'), {})).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/firma/${f}/on-incelemeye-gonder`, sc, {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT kayit_asamasi FROM kurulus WHERE kimlik = $1`, [f])).rows[0].kayit_asamasi).toBe('İncelemede');
    expect((await o.kart('Başvuru Ön İnceleme', f)).son_zaman).toBeTruthy();
    expect((await o.ist('POST', `/api/firma/${f}/on-incelemeye-gonder`, sc, {})).statusCode).toBe(409);
    const fym = await o.gir('oy'); const U = `/api/firma/${f}/karar-onerisi`;
    expect((await o.ist('POST', U, fym, { oneri: 'Onaylı', gerekce: 'G', kapsama: 'Bölge' })).statusCode).toBe(400);
    expect((await o.ist('POST', U, fym, { oneri: 'Onaylı', gerekce: 'G', kapsama: 'Bölge', puanlar: [{ baslik: 'Teknik Yetkinlik', puan: 4, kanit: 'Saha incelemesi' }, { baslik: 'Tesis', puan: 3, kanit: 'saha incelemesi' }] })).statusCode).toBe(409);
    expect((await o.ist('POST', U, fym, { oneri: 'Koşullu Onaylı', gerekce: 'G', kapsama: 'Bölge', puanlar: [{ baslik: 'Teknik Yetkinlik', puan: 4, kanit: 'K1' }] })).json().hata).toContain('Hukuk ve Uyum');
    const r = await o.ist('POST', U, fym, { oneri: 'Onaylı', gerekce: 'Belgeler tam', kapsama: 'Bölge', puanlar: [{ baslik: 'Teknik Yetkinlik', puan: 4, kanit: 'Saha incelemesi' }, { baslik: 'Tesis', puan: 3, kanit: 'Tesis fotoğrafları' }] });
    expect(r.statusCode, r.body).toBe(200);
    const k = await o.kart('Firma Karar Önerisi', r.json().kimlik);
    expect(k.zincir).toEqual([(await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Firma Yönetimi Müdür Yardımcısı'`)).rows[0].kimlik, (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Firma Yönetimi Müdürü'`)).rows[0].kimlik]);
    expect((await o.ist('POST', U, fym, { oneri: 'Onaylı', gerekce: 'G', kapsama: 'Bölge', puanlar: [{ baslik: 'A', puan: 4, kanit: 'B' }] })).statusCode).toBe(409);
    expect((await o.sup.query(`SELECT durum FROM is_karti WHERE tur = 'Başvuru Belge Kontrolü' AND nesne_kimligi = $1`, [f])).rows[0].durum).toBe('Tamamlandı');
    // Yıllık iyileştirme önerisi: Ocak görevi üzerinden Müdür Yardımcısı → Müdür onayına.
    expect((await o.ist('POST', '/api/firma/kabul-iyilestirme', fym, { oneri: 'X' })).statusCode).toBe(409);
    await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, sahip_rol_ref, nesne_turu, nesne_kimligi) SELECT 'Kabul Sistemi Yıllık Gözden Geçirme', 'gorev', 'T', kimlik, 'Kabul Sistemi', '2025' FROM rol WHERE rol_adi = 'Firma Yönetimi Yöneticisi'`);
    expect((await o.ist('POST', '/api/firma/kabul-iyilestirme', fym, { oneri: 'Ön inceleme kontrol listesi sadeleştirilsin' })).json().gonderilecek).toBe('Firma Yönetimi Müdür Yardımcısı');
    expect((await o.kart('Kabul Sistemi İyileştirme Önerisi', '2025')).zincir).toHaveLength(2);
    // YG-1651: aylık kabul göstergeleri paketi Müdür Yardımcısı → Müdür.
    await o.sup.query(`UPDATE is_karti SET durum = 'Tamamlandı' WHERE tur = 'Aylık Kabul Göstergeleri' AND durum = 'Bekliyor'`);
    expect((await o.ist('POST', '/api/firma/kabul-gostergeleri/onaya-gonder', fym, { degerlendirme: 'X' })).statusCode).toBe(409);
    const ay = new Date().toISOString().slice(0, 7);
    await o.sup.query(`INSERT INTO is_karti (tur, kategori, baslik, sahip_rol_ref, nesne_turu, nesne_kimligi) SELECT 'Aylık Kabul Göstergeleri', 'gorev', 'T', kimlik, 'Kabul Sistemi', $1 FROM rol WHERE rol_adi = 'Firma Yönetimi Yöneticisi'`, [ay]);
    expect((await o.ist('GET', '/api/firma/kabul-sistemi', fym)).json().aylik.ay).toBe(ay);
    expect((await o.ist('POST', '/api/firma/kabul-gostergeleri/onaya-gonder', fym, { degerlendirme: 'Süreler hedefte' })).json().gonderilecek).toBe('Firma Yönetimi Müdür Yardımcısı');
    expect((await o.kart('Aylık Kabul Göstergeleri Paketi', ay)).ozet).toContain('Başvuru:');
    await o.sup.query(`UPDATE rol_atamasi SET atama_durumu = 'Kapalı' WHERE kullanici_ref = $1 AND rol_ref = (SELECT kimlik FROM rol WHERE rol_adi = 'Firma Yönetimi Yöneticisi')`, [o.K.oy]);
  });
  it('T-YG1648-C1: herkese açık başvuru sihirbazı sicil numarasıyla Başvuru açar, dağıtıma düşer; aynı VKN yeni kayıt açmaz', async () => {
    const sec = (await o.ist('GET', '/api/iletisim/cozum-ortagi-basvurusu', undefined)).json(); expect(sec.branslar.length).toBeGreaterThan(0);
    const vkn = String(Date.now()).slice(-10); const tc = (await import('../src/yat.js')).vergiNoGecerli;
    let v = vkn; for (let d = 0; !tc(v) && d < 10; d++) v = vkn.slice(0, 9) + d; expect(tc(v)).toBe(true);
    const B = { rol: 'Çözüm Ortağı', unvan: `Sihirbaz Tersanesi ${v}`, vergiNo: v, vergiDairesi: 'Bodrum', il: 'Muğla', ilce: 'Bodrum', adres: 'Liman Cd. 1', konumTuru: sec.konumTurleri[0], yetkili: 'Firma Yetkilisi', eposta: 'c1@deneme.local', telefon: '0252 000 00 01', anaBrans: sec.branslar[0], bolgeler: 'Bodrum, Marmaris' };
    expect((await o.ist('POST', '/api/iletisim/cozum-ortagi-basvurusu', undefined, { ...B, vergiDairesi: '' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/iletisim/cozum-ortagi-basvurusu', undefined, B)).statusCode).toBe(200);
    const k = (await o.sup.query(`SELECT kimlik, sicil_no, kayit_asamasi, beyan_teyidi, atanan_sicil_ref, hizmet_bolgeleri FROM kurulus WHERE vergi_no = $1`, [v])).rows;
    expect(k).toHaveLength(1); expect(k[0]).toMatchObject({ kayit_asamasi: 'Başvuru', beyan_teyidi: 'Teyit Bekliyor', atanan_sicil_ref: null, hizmet_bolgeleri: ['Bodrum', 'Marmaris'] }); expect(k[0].sicil_no).toMatch(/^LGM-SC-\d{5}$/);
    expect((await o.sup.query(`SELECT durum FROM brans_yetkinligi WHERE kurulus_ref = $1`, [k[0].kimlik])).rows[0].durum).toBe('Doğrulama Bekliyor');
    expect((await o.ist('POST', '/api/iletisim/cozum-ortagi-basvurusu', undefined, { ...B, unvan: 'Başka Unvan' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM kurulus WHERE vergi_no = $1`, [v])).rows[0].n).toBe(1);
  });
  it('T-YG1654: dönem kartı, üç dönem kademeli düşüş önerisi; denetim planı erteleme ve çıkar çatışması', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref, ag_statusu, kayit_asamasi, risk_derecesi) VALUES ($1,'Düşen Tersane','Çözüm Ortağı',$2,'Aktif','Onaylı','Yakın İzleme') RETURNING kimlik`, [`S-DK${Date.now()}`, o.K.ds])).rows[0].kimlik;
    const ps = (await o.sup.query(`SELECT max(surum) s FROM karne_parametresi`)).rows[0].s;
    for (const [d, p] of [['2026-03-31', 80], ['2026-06-30', 70], ['2026-09-30', 60]] as const) await o.sup.query(`INSERT INTO performans_donem_puani (kurulus_ref, donem_sonu, kapanan_dosya_sayisi, agirlikli_ortalama, donem_puani, yetersiz_veri, risk_derecesi_onerisi, parametre_surum) VALUES ($1,$2,5,$3,$3,false,'Standart',$4)`, [f, d, p, ps]);
    const fym = await o.gir('fym');
    const k = (await o.ist('GET', '/api/firma/donem-kartlari', fym)).json().kartlar.find((x: { kimlik: string }) => x.kimlik === f);
    expect(k).toMatchObject({ kademeli_dusus: true, donem_sonu: '2026-09-30' });
    expect((await o.ist('GET', '/api/firma/donem-kartlari', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/firma/${f}/kademeli-dusus-onerisi`, fym, { oneri: 'Erken Denetim', gerekce: 'G' })).statusCode).toBe(404); // Müdür önerir değil, karar verir
    expect((await o.ist('POST', `/api/firma/${f}/denetim-plani`, fym, { tur: 'Saha ve Tesis', tarih: '2026-12-10', denetci: o.K.tm, riskGerekcesi: 'Yakın İzleme', cikarYok: true })).statusCode).toBe(404);
    await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref, atama_durumu, baslangic_tarihi) SELECT $1, kimlik, 'Aktif', current_date - 1 FROM rol WHERE rol_adi = 'Firma Yönetimi Müdür Yardımcısı'`, [o.K.tu]);
    const my = await o.gir('tu');
    expect((await o.ist('POST', `/api/firma/${f}/kademeli-dusus-onerisi`, my, { oneri: 'Erken Denetim', gerekce: 'Üç dönem düşüş' })).json().gonderilecek).toBe('Firma Yönetimi Müdürü');
    expect((await o.ist('POST', `/api/firma/${f}/kademeli-dusus-onerisi`, my, { oneri: 'Erken Denetim', gerekce: 'x' })).statusCode).toBe(409);
    const v = (await o.ist('GET', '/api/firma-denetim-plani', my)).json(); expect(v.riskli.some((x: { kimlik: string }) => x.kimlik === f)).toBe(true);
    const U = `/api/firma/${f}/denetim-plani`; const B = { tur: 'Saha ve Tesis', tarih: '2026-12-10', denetci: o.K.tm, riskGerekcesi: 'Yakın İzleme' };
    expect((await o.ist('POST', U, my, B)).statusCode).toBe(409);
    expect((await o.ist('POST', U, my, { ...B, denetci: o.K.ds, cikarYok: true })).statusCode).toBe(409); // başvuruyu açan denetçi olamaz
    const d = (await o.ist('POST', U, my, { ...B, cikarYok: true })).json().kimlik;
    expect((await o.ist('POST', `/api/firma-denetim/${d}/ertele`, my, { gerekce: 'Hava', yeniTarih: '2026-12-01' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/firma-denetim/${d}/ertele`, my, { gerekce: 'Hava', yeniTarih: '2026-12-20' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/firma-denetim/${d}/sonuc`, my, { sonuc: 'Uygun' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/firma-denetim/${d}/sonuc`, await o.gir('tm'), { sonuc: 'Uygun' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, erteleme_sayisi, planlanan_tarih::text t FROM firma_denetim_plani WHERE kimlik = $1`, [d])).rows[0]).toEqual({ durum: 'Tamamlandı', erteleme_sayisi: 1, t: '2026-12-20' });
    // Üç aylık karne özeti ve yıllık denetim programı Firma Yönetimi Müdürü onayına gider; programda İç Denetim çakışması bildirilir.
    await o.sup.query(`UPDATE is_karti SET durum = 'Tamamlandı' WHERE tur IN ('Üç Aylık Karne Özeti', 'Yıllık Firma Denetim Programı') AND durum = 'Bekliyor'`);
    expect((await o.ist('POST', '/api/firma/karne-ozeti', my, { donem: '2026-09-30' })).statusCode).toBe(400);
    const kz = (await o.ist('POST', '/api/firma/karne-ozeti', my, { donem: '2026-09-30', degerlendirme: 'Düşüş eğilimi izlenecek' })).json();
    expect(kz.gonderilecek).toBe('Firma Yönetimi Müdürü'); expect(kz.ozet.firma).toBeGreaterThan(0);
    expect((await o.ist('POST', '/api/firma/karne-ozeti', my, { donem: '2026-09-30', degerlendirme: 'x' })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/firma-denetim-programi', fym, { yil: 2026, aciklama: 'P' })).statusCode).toBe(404);
    const pr = (await o.ist('POST', '/api/firma-denetim-programi', my, { yil: 2026, aciklama: 'Risk esaslı program' })).json();
    expect(pr.gonderilecek).toBe('Firma Yönetimi Müdürü'); expect(Array.isArray(pr.cakisma)).toBe(true);
    expect((await o.ist('POST', '/api/firma-denetim-programi', my, { yil: 2026, aciklama: 'Tekrar' })).statusCode).toBe(409);
    // YG-1655: Dönem Kartlarını Kaydet — yalnız Müdür Yardımcısı, dönem başına bir kez.
    expect((await o.ist('POST', '/api/firma/donem-kartlari/kaydet', fym, { donem: '2026-09-30' })).statusCode).toBe(404);
    const dk = await o.ist('POST', '/api/firma/donem-kartlari/kaydet', my, { donem: '2026-09-30' });
    if (dk.statusCode === 200) { expect(dk.json().kademeliDusus).toBeGreaterThan(0); expect((await o.ist('POST', '/api/firma/donem-kartlari/kaydet', my, { donem: '2026-09-30' })).statusCode).toBe(409); } else expect(dk.statusCode).toBe(409);
    // İlk dönem izlemesi: dönem puanı oluşmamış yeni aktif firma listelenir.
    const yeni = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref, ag_statusu, kayit_asamasi, kabul_karar_zamani) VALUES ($1,'Yeni Tersane','Çözüm Ortağı',$2,'Aktif','Onaylı', now() - interval '20 days') RETURNING kimlik`, [`S-YN${Date.now()}`, o.K.ds])).rows[0].kimlik;
    expect((await o.ist('GET', '/api/firma/donem-kartlari', fym)).json().ilkDonem.some((x: { kimlik: string; gun: number }) => x.kimlik === yeni && x.gun >= 19 && x.gun <= 21)).toBe(true);
    await o.sup.query(`UPDATE rol_atamasi SET atama_durumu = 'Kapalı' WHERE kullanici_ref = $1 AND rol_ref = (SELECT kimlik FROM rol WHERE rol_adi = 'Firma Yönetimi Müdür Yardımcısı')`, [o.K.tu]);
  });
  it('T-YG1648-KALITE: aylık sicil veri kalitesi, yıldönümü paketi silsileyle onaya gider', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref, ag_statusu, kayit_asamasi, vergi_no, kabul_karar_zamani, guncelleme_zamani) VALUES ($1,'Yıldönümü Tersanesi','Çözüm Ortağı',$2,'Aktif','Onaylı','12AB','2024-03-10T10:00:00Z', now() - interval '400 days') RETURNING kimlik`, [`S-YD${Date.now()}`, o.K.ds])).rows[0].kimlik;
    await kaliteKontrolIsle(o.db);
    const h = (await o.sup.query(`SELECT kural_kod FROM veri_hatasi WHERE kayit_kimligi = $1 AND durum = 'Açık' ORDER BY kural_kod`, [f])).rows.map((x) => x.kural_kod);
    expect(h).toEqual(expect.arrayContaining(['VK-10', 'VK-11', 'VK-12']));
    expect(await sicilKaliteAylik(o.db, new Date('2027-03-01T08:00:00Z'))).toBeGreaterThanOrEqual(2);
    expect((await o.sup.query(`SELECT ozet FROM is_karti WHERE tur = 'Sicil Veri Kalitesi' AND nesne_kimligi = '2027-03'`)).rows[0].ozet).toContain('Doğruluk');
    expect(await o.kart('Kayıt Yıldönümü Gözden Geçirme', f)).toBeTruthy();
    const sc = await o.gir('sc');
    const v = (await o.ist('GET', '/api/sicil/kalite', sc)).json();
    expect(v.yildonumu.some((x: { firma: string }) => x.firma === f)).toBe(true); expect(v.guncellenmeyen.some((x: { kimlik: string }) => x.kimlik === f)).toBe(true);
    expect((await o.ist('POST', `/api/sicil/yildonumu/${f}/onaya-gonder`, sc, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/sicil/yildonumu/${f}/onaya-gonder`, sc, { degerlendirme: 'Belgeler güncel.' })).json().gonderilecek).toBe('Firma Yönetimi Yöneticisi');
    const k = await o.kart('Kayıt Yıldönümü Paketi', f);
    expect(k.zincir[0]).toBe((await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Firma Yönetimi Yöneticisi'`)).rows[0].kimlik);
    expect((await o.ist('POST', `/api/sicil/yildonumu/${f}/onaya-gonder`, sc, { degerlendirme: 'x' })).statusCode).toBe(409);
    expect((await o.ist('GET', '/api/sicil/kalite', await o.gir('ds'))).statusCode).toBe(404);
  });
});

