import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sicilBelgeSureIsle } from '../src/firma_ek.js';
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
      expect((await gorevlendirmeKontrolu(o.db, { firma: f, dosya: d.kimlik, brans: 'MAKINE-01', tutar: 5000 })).uyarilar.join(' ')).toContain('G2 kapasitesi doludur');
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
});

