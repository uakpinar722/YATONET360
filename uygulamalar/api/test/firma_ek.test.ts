import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    await o.sup.query(`INSERT INTO sicil_belgesi (kurulus_ref, tur, gecerlilik_bitis) VALUES ($1,'Mesleki Sorumluluk Sigortası','2099-01-01')`, [f]);
    expect((await gorevlendirmeKontrolu(o.db, { firma: f, dosya: d.kimlik, tutar: 100 })).sonuc).toBe('Kabul');
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
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kaptan-gorevlendirme`, ds, { kaptan: c })).statusCode).toBe(200);
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
    expect((await o.ist('POST', u, ds, { tur: 'Kaldırma', ekipman: 'Travel', kapasite: 15, agirlik: 12, yeniHasar: true })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Uygunsuzluk Kaydı Aç' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
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
    const k = await o.kart('Kalıcı Askı Önerisi', f); expect(k.zincir).toHaveLength(4);
    await o.karar(k.kimlik, 'tm', 'Onaya Gönder', 'Görüş'); await o.karar(k.kimlik, 'hud', 'Onaya Gönder', 'Görüş'); await o.karar(k.kimlik, 'opm', 'Onaya Gönder', 'Görüş');
    expect((await o.karar(k.kimlik, 'btd', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT ag_statusu FROM kurulus WHERE kimlik = $1`, [f])).rows[0].ag_statusu).toBe('Askıda');
  });
  it('kapanışta konum kapanır, garanti izleme açılır', async () => {
    const d = await dosya(); await dosyaKapanisIsleri(o.db, d.kimlik);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Garanti İzleme' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
    await dosyaKapanisIsleri(o.db, d.kimlik); expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Garanti İzleme' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
  });
});
