import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { beklemedeIsle, sureIsle } from '../src/dosya.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { bitisKaydir, mesafeEki, sureRengi } from '../src/sure.js';
import { sunucuKur } from '../src/sunucu.js';
import { tcknGecerli, vergiNoGecerli } from '../src/yat.js';

const VT = 'yatonet360_test11'; const PAROLA = 'Sinama-Parolasi-2026!'; const D = '@deneme.yatonet.local';
const KADRO: Record<string, string> = {
  ds: 'Dosya Sorumlusu', ds2: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', omy: 'Operasyon Müdür Yardımcısı', opm: 'Operasyon Müdürü',
  tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tmy: 'Teknik Müdür Yardımcısı', tm: 'Teknik Müdür', tod: 'Teknik ve Operasyon Direktörü', saha: 'Saha Sorumlusu',
};
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool;
const sms = new DenemeKutusu(null), posta = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const ckr = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: { [COOKIE_ADI]: c }, payload });
const K: Record<string, string> = {}; const oturum: Record<string, string> = {};

async function gir(k: string) {
  if (oturum[k]) return oturum[k]!;
  const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: k + D, parola: PAROLA } });
  const c = ckr(g);
  const q = await ist('GET', '/api/kimlik/kurulum', c);
  return (oturum[k] = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) })));
}
const SORU_SU = 'Su alma veya batma riski var mı?'; const SORU_KOZ = 'Kozmetik hasar, bakım veya sezon dışı iş mi?'; const SORU_ILER = 'Hasar ilerleyebilir mi (sintine pompası sürekli çalışıyor, güverteden su giriyor)?';
let sayac = 0;
const ihbarGovde = (e: object = {}) => ({
  kanal: 'Telefon', sahibiAdi: 'Deneme Kaptan', sahibiTuru: 'Yatın Kaptanı', telefon: '+905550001111', konum: 'Marmaris', yatDurumu: 'Bağlı', ihtiyac: 'Pervane hasarı',
  yat: { adi: `Deneme Yat ${++sayac}`, markaDiger: 'Marka', modelDiger: 'Model', boy: 14, govde: 'Fiber', tur: 'Motor Yat' }, yatSahibi: { ad: 'Deneme Sahip', telefon: '+905550002222', eposta: 'sahip@deneme.yatonet.local' }, cevaplar: {}, ...e,
});
const ihbar = async (e: object = {}, k = 'ds') => { const r = await ist('POST', '/api/ihbar', await gir(k), ihbarGovde(e)); expect(r.statusCode, r.body).toBe(200); return r.json(); };
const dosyaAc = async (e: object = {}, ac: object = {}) => {
  const t = await ihbar({ yetkiDurumu: 'Doğrulandı', ...e });
  const c = await gir('ds');
  expect((await ist('POST', `/api/ihbar/${t.kimlik}/mukerrerlik`, c, { sonuc: 'Mükerrer değil' })).statusCode).toBe(200);
  const r = await ist('POST', `/api/ihbar/${t.kimlik}/acilis`, c, { karar: 'Kabul', ozet: 'Açılış', musteriTuru: 'Bireysel Müşteri', ...ac });
  expect(r.statusCode, r.body).toBe(200);
  return { ...r.json(), talep: t };
};
const ata = async (id: string, kim: string, rol: string, yapan: string, e: object = {}) => ist('POST', `/api/dosya/${id}/ekip`, await gir(yapan), { kullanici: K[kim], rol, ...e });
const ekipKur = async (id: string) => {
  for (const [kim, rol, yapan] of [['ds', 'Dosya Sorumlusu', 'opm'], ['oy', 'Operasyon Yöneticisi', 'opm'], ['tu', 'Teknik Uzman', 'tm'], ['ty', 'Teknik Yönetici', 'tm']] as const) {
    const r = await ata(id, kim, rol, yapan); expect(r.statusCode, r.body).toBe(200);
  }
};
const belgeYukle = async (id: string, k = 'ds') => {
  const r = await s.inject({ method: 'POST', url: `/api/belge/yukle?ad=${encodeURIComponent('Kanıt ' + Math.random())}&tur=${encodeURIComponent('Yazışma')}&bagTuru=Dosya&bagKimligi=${id}&kaynak=${encodeURIComponent('E-posta')}&dosya=k.pdf`, headers: { ...H, 'content-type': 'application/octet-stream' }, cookies: { [COOKIE_ADI]: await gir(k) }, payload: Buffer.from('%PDF-1.4 sinama') });
  expect(r.statusCode, r.body).toBe(200); return r.json().belge as string;
};
const kart = async (tur: string, nesne: string) => (await sup.query(`SELECT * FROM is_karti WHERE tur = $1 AND nesne_kimligi = $2 ORDER BY olusturma_zamani DESC LIMIT 1`, [tur, nesne])).rows[0];
const karar = async (id: string, k: string, kr: string, gerekce?: string) => ist('POST', `/api/is/${id}/karar`, await gir(k), { karar: kr, gerekce });

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  const oz = await parolaOzetle(PAROLA);
  for (const [k, rol] of Object.entries(KADRO)) {
    const { rows } = await sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, parola_ozeti, dogrulama_yontemi) VALUES ('İç Kullanıcı','LGM İç Rolü',$1,$2,$2,$3,$4,'Doğrulama uygulaması (6 haneli kod)') RETURNING kimlik`, [`Deneme ${rol} ${k}`, k + D, `+90555100${String(Object.keys(K).length).padStart(4, '0')}`, oz]);
    K[k] = rows[0].kimlik;
    await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [K[k], rol]);
  }
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [oz]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' WHEN kullanici_grubu = 'İş Birliği Firması' THEN 'KVKK-03' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  K.sistem = (await sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, ['destek' + D])).rows[0].kimlik;
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  s = await sunucuKur({ db, sms, eposta: posta, anahtar: 'ab'.repeat(32), guvenliCerez: false, webAdresi: 'http://x' });
}, 120_000);
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });
beforeEach(() => { posta.gidenler.length = 0; });

describe('süre hesabı (YG-042, YG-1607)', () => {
  it('pazar, gece ve tatil bitişi ilk çalışma günü 12:00 olur; Kritik kaymaz', () => {
    const paz = new Date('2026-11-08T10:00:00Z'); // Pazar 13:00
    const r = bitisKaydir(paz, 'Normal');
    expect(r.bitis.toISOString()).toBe('2026-11-09T09:00:00.000Z'); expect(r.not).toContain('Pazartesi');
    expect(bitisKaydir(paz, 'Kritik').bitis).toEqual(paz);
    expect(bitisKaydir(new Date('2026-11-09T20:00:00Z'), 'Yüksek').bitis.toISOString()).toBe('2026-11-10T09:00:00.000Z'); // 23:00 → ertesi gün 12:00
    expect(bitisKaydir(new Date('2026-11-10T02:00:00Z'), 'Yüksek').bitis.toISOString()).toBe('2026-11-10T09:00:00.000Z'); // 05:00 → aynı gün 12:00
    expect(bitisKaydir(new Date('2026-11-10T10:00:00Z'), 'Normal', new Set(['2026-11-10'])).bitis.toISOString()).toBe('2026-11-11T09:00:00.000Z');
    const ar = new Set(['2026-11-10']); // arife: 11:00 geçerli, 15:00 ertesi gün 12:00'a kayar
    expect(bitisKaydir(new Date('2026-11-10T08:00:00Z'), 'Normal', new Set(), ar).not).toBeNull();
    expect(bitisKaydir(new Date('2026-11-10T12:00:00Z'), 'Normal', new Set(), ar).bitis.toISOString()).toBe('2026-11-11T09:00:00.000Z');
  });
  it('mesafe eki: 150 km altı yok, üstü 4 saat, 250 km sonrası her 100 km 1,5 saat', () => {
    expect([mesafeEki(100), mesafeEki(200), mesafeEki(250), mesafeEki(251), mesafeEki(400)]).toEqual([0, 4, 4, 5.5, 7]);
  });
  it('renk: son dörtte birde sarı, aşınca kırmızı', () => {
    const a = new Date('2026-11-10T00:00:00Z'), z = new Date('2026-11-10T04:00:00Z');
    expect([sureRengi(a, z, new Date('2026-11-10T01:00:00Z')), sureRengi(a, z, new Date('2026-11-10T03:30:00Z')), sureRengi(a, z, new Date('2026-11-10T05:00:00Z'))]).toEqual(['yeşil', 'sarı', 'kırmızı']);
  });
});

describe('kimlik doğrulamaları (YG-926)', () => {
  it('TCKN ve vergi numarası algoritmaları', () => {
    expect(tcknGecerli('10000000146')).toBe(true); expect(tcknGecerli('10000000147')).toBe(false); expect(tcknGecerli('01234567890')).toBe(false);
    expect(vergiNoGecerli('1234567890')).toBe(true); expect(vergiNoGecerli('1234567891')).toBe(false); expect(vergiNoGecerli('12345')).toBe(false);
  });
  it('taraf: mükerrer kimlik reddedilir, TCKN maskeli döner', async () => {
    const c = await gir('ds');
    const a = await ist('POST', '/api/taraf', c, { kisiTuru: 'Gerçek kişi', ad: 'Maskeli Kişi', tckn: '10000000146' });
    expect(a.statusCode, a.body).toBe(200); expect(a.json().taraf_no).toMatch(/^TR-\d{6}$/);
    expect((await ist('POST', '/api/taraf', c, { kisiTuru: 'Gerçek kişi', ad: 'Başka', tckn: '10000000146' })).statusCode).toBe(409);
    expect((await ist('POST', '/api/taraf', c, { kisiTuru: 'Gerçek kişi', ad: 'Hatalı', tckn: '10000000147' })).statusCode).toBe(400);
    expect((await ist('GET', '/api/taraf/ara?q=Maskeli', c)).json()[0].tckn).toBe('10*******46');
  });
});

describe('marka-model (YG-1527, YG-1529)', () => {
  it('ana veri yüklüdür, aranır; model seçilince boy ve gövde "teyit bekliyor" ile gelir', async () => {
    expect((await sup.query(`SELECT count(*)::int n FROM yat_marka_model`)).rows[0].n).toBe(15384);
    const c = await gir('ds');
    expect((await ist('GET', '/api/yat/marka?q=3D', c)).json().some((m: any) => m.marka === '3D Tender')).toBe(true);
    const m = (await ist('GET', `/api/yat/model?marka=${encodeURIComponent('3D Tender')}&q=DREAM%207`, c)).json()[0];
    expect(m.boy_m).toBe(7.47); expect(m.govde_malzemesi).toBe('Fiber');
    const t = await ihbar({ yat: { adi: 'Katalog Yat', markaModelId: m.kimlik } });
    const y = (await sup.query(`SELECT y.* FROM yat y JOIN talep t ON t.yat_ref = y.kimlik WHERE t.kimlik = $1`, [t.kimlik])).rows[0];
    expect([Number(y.tam_boy_m), y.govde_malzemesi, y.katalog_teyit, y.boy_kaynagi, y.gecici_kayit]).toEqual([7.47, 'Fiber', 'Katalogdan – teyit bekliyor', 'Ana veri (katalog)', true]);
  });
  it('marka seçilmeden veya "Diğer" yazılmadan kayıt olmaz', async () => {
    expect((await ist('POST', '/api/ihbar', await gir('ds'), ihbarGovde({ yat: { adi: 'Markasız' } }))).statusCode).toBe(400);
  });
});

describe('ihbar kaydı (YG-006, YG-020, YG-033)', () => {
  it('yalnız yetkili rol kaydeder', async () => {
    expect((await ist('POST', '/api/ihbar', await gir('tu'), ihbarGovde())).statusCode).toBe(403);
  });
  it('numara LGM-YYYY-AA-NNNN biçiminde boşluksuz artar; reddedilen kayıt numara tüketmez', async () => {
    const a = await ihbar();
    expect(a.talepNo).toMatch(/^LGM-\d{4}-\d{2}-\d{4}$/);
    expect((await ist('POST', '/api/ihbar', await gir('ds'), ihbarGovde({ konum: '' }))).statusCode).toBe(400);
    const b = await ihbar();
    expect(Number(b.talepNo.slice(-4))).toBe(Number(a.talepNo.slice(-4)) + 1);
  });
  it('"Diğer" açıklamasız, iletişimsiz ve geleceğe tarihli kayıt reddedilir', async () => {
    const c = await gir('ds');
    expect((await ist('POST', '/api/ihbar', c, ihbarGovde({ sahibiTuru: 'Diğer' }))).statusCode).toBe(400);
    expect((await ist('POST', '/api/ihbar', c, ihbarGovde({ telefon: '' }))).statusCode).toBe(400);
    expect((await ist('POST', '/api/ihbar', c, ihbarGovde({ bildirimZamani: new Date(Date.now() + 3_600_000).toISOString() }))).statusCode).toBe(400);
  });
  it('öneri: evet olan en üst sınıf; bilinmiyor üst sayılır; yanıtsız hayırdır', async () => {
    const c = await gir('ds'); const on = async (x: object) => (await ist('POST', '/api/ihbar/oncelik-oner', c, { cevaplar: x })).json().onerilen;
    expect(await on({})).toBe('Normal');
    expect(await on({ [SORU_KOZ]: 'Evet' })).toBe('Planlı');
    expect(await on({ [SORU_ILER]: 'Evet', [SORU_KOZ]: 'Evet' })).toBe('Yüksek');
    expect(await on({ [SORU_SU]: 'Bilinmiyor' })).toBe('Kritik');
    expect(await on({ [SORU_SU]: 'Hayır' })).toBe('Normal');
  });
  it('önerinin altına inilemez, üstüne çıkılabilir', async () => {
    const c = await gir('ds');
    expect((await ist('POST', '/api/ihbar', c, ihbarGovde({ cevaplar: { [SORU_ILER]: 'Evet' }, oncelik: 'Normal' }))).statusCode).toBe(400);
    expect((await ist('POST', '/api/ihbar', c, ihbarGovde({ oncelik: 'Yüksek' }))).json().oncelik).toBe('Yüksek');
  });
  it('Kritik: Operasyon Yöneticisine teyit kartı, Operasyon Müdürüne acil bildirim, ilk yanıt 30 dakika', async () => {
    const t = await ihbar({ acil: true });
    expect(t.oncelik).toBe('Kritik');
    const k = await kart('Kritik Öncelik Teyidi', t.kimlik);
    expect(k.zincir).toHaveLength(1);
    expect((await sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE 'Acil İhbar%'`, [K.opm])).rowCount).toBeGreaterThan(0);
    const u = (await sup.query(`SELECT baslangic, bitis FROM dosya_sure WHERE talep_ref = $1 AND tur = 'İlk Yanıt'`, [t.kimlik])).rows[0];
    expect((+u.bitis - +u.baslangic) / 60_000).toBe(30);
  });
  it('yat sahibine BLD-35 kuyruğa yazılır; marina bildirir ve sahip iletişimi yoksa görev açılır', async () => {
    const t = await ihbar({ sahibiTuru: 'Marina / Tesis', yetkiDurumu: 'Bilgi Amaçlı' });
    const g = (await sup.query(`SELECT kanal, hedef, metin FROM gonderim WHERE olay_anahtari = $1 ORDER BY kanal`, [`bld35:${t.kimlik}`])).rows;
    expect(g.map((x) => x.hedef).sort()).toEqual(['+905550002222', 'sahip@deneme.yatonet.local']);
    expect(g[0].metin).toContain(t.talepNo);
    const t2 = await ihbar({ sahibiTuru: 'Marina / Tesis', yetkiDurumu: 'Bilgi Amaçlı', yatSahibi: undefined });
    expect(await kart('Eksik Bilgi', t2.kimlik)).toBeDefined();
  });
  it('İngilizce yazışmada BLD-35 İngilizce gider', async () => {
    const t = await ihbar({ dil: 'İngilizce' });
    const g = (await sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`bld35:${t.kimlik}`])).rows[0];
    expect(g.metin).toContain('We are sorry'); expect(g.metin).not.toContain('[');
  });
  it('ilk yanıt bir kez kaydedilir ve sayaç kapanır', async () => {
    const t = await ihbar(); const c = await gir('ds');
    expect((await ist('POST', `/api/ihbar/${t.kimlik}/ilk-yanit`, c)).statusCode).toBe(200);
    expect((await ist('POST', `/api/ihbar/${t.kimlik}/ilk-yanit`, c)).statusCode).toBe(409);
    expect((await sup.query(`SELECT tamamlanma FROM dosya_sure WHERE talep_ref = $1`, [t.kimlik])).rows[0].tamamlanma).not.toBeNull();
  });
});

describe('mükerrerlik ve açılış kararı (YG-007, YG-023, YG-030, YG-100)', () => {
  it('kontrol tamamlanmadan dosya açılmaz; beyanla Kabul edilmez, Koşullu Açılış izinli ve yasak ister', async () => {
    const t = await ihbar(); const c = await gir('ds'); const ac = (x: object) => ist('POST', `/api/ihbar/${t.kimlik}/acilis`, c, { ozet: 'Ö', musteriTuru: 'Bireysel Müşteri', ...x });
    expect((await ac({ karar: 'Kabul' })).statusCode).toBe(409);
    await ist('POST', `/api/ihbar/${t.kimlik}/mukerrerlik`, c, { sonuc: 'Mükerrer değil' });
    expect((await ac({ karar: 'Kabul' })).statusCode).toBe(409);
    expect((await ac({ karar: 'Koşullu Açılış' })).statusCode).toBe(400);
    const r = await ac({ karar: 'Koşullu Açılış', kosullar: 'Yalnız keşif' });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().dosyaNo).toBe(t.talepNo); // YG-006: numara aynen sürer.
    expect((await ac({ karar: 'Koşullu Açılış', kosullar: 'x' })).statusCode).toBe(409);
  });
  it('yetki doğrulanınca Kabul açılır; dosya, sigorta ve taraflar kurulur', async () => {
    const t = await ihbar({ sigortaci: 'Deneme Sigorta', hasarNo: 'H-1' }); const c = await gir('ds');
    expect((await ist('POST', `/api/ihbar/${t.kimlik}/yetki`, c, { durum: 'Doğrulandı' })).statusCode).toBe(400);
    expect((await ist('POST', `/api/ihbar/${t.kimlik}/yetki`, c, { durum: 'Doğrulandı', dayanak: 'Ruhsat' })).statusCode).toBe(200);
    await ist('POST', `/api/ihbar/${t.kimlik}/mukerrerlik`, c, { sonuc: 'Mükerrer değil' });
    const r = await ist('POST', `/api/ihbar/${t.kimlik}/acilis`, c, { karar: 'Kabul', ozet: 'Ö', musteriTuru: 'Sigorta Şirketi' });
    expect(r.statusCode, r.body).toBe(200);
    const d = (await sup.query(`SELECT * FROM dosya WHERE kimlik = $1`, [r.json().kimlik])).rows[0];
    expect([d.statu, d.asama, d.dosya_niteligi, d.odeme_sorumlusu]).toEqual(['Açılış Kontrolünde', null, 'Sigorta bağlantılı', ['Sigorta']]);
    expect((await sup.query(`SELECT sigorta_hasar_dosya_no FROM dosya_sigorta_kaydi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].sigorta_hasar_dosya_no).toBe('H-1');
    expect((await sup.query(`SELECT taraf_rolu FROM dosya_tarafi WHERE dosya_ref = $1 ORDER BY talep_sahibi_mi DESC`, [d.kimlik])).rows.map((x) => x.taraf_rolu)).toEqual(['Kaptan', 'Yat Sahibi']);
    expect(await kart('Dosya Ekibi Ataması', d.kimlik)).toBeDefined(); expect(await kart('Teknik Ekip Ataması', d.kimlik)).toBeDefined();
  });
  it('ikinci ihbar ilk dosyaya bağlanır, numarası saklanır, ihbar edene ilk dosya numarası bildirilir', async () => {
    const a = await dosyaAc(); const t = await ihbar(); const c = await gir('ds');
    expect((await ist('GET', `/api/ihbar/${t.kimlik}`, c)).statusCode).toBe(200);
    const r = await ist('POST', `/api/ihbar/${t.kimlik}/mukerrerlik`, c, { sonuc: 'Mevcut dosyaya bağlandı', dosya: a.kimlik });
    expect(r.json().dosyaNo).toBe(a.dosyaNo);
    expect((await sup.query(`SELECT statu FROM talep WHERE kimlik = $1`, [t.kimlik])).rows[0].statu).toBe('Birleştirildi');
    expect((await sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`birlesti:${t.kimlik}`])).rows[0].metin).toContain(a.dosyaNo);
    expect((await ist('POST', `/api/ihbar/${t.kimlik}/acilis`, c, { karar: 'Kabul', ozet: 'Ö', musteriTuru: 'Bireysel Müşteri' })).statusCode).toBe(409);
  });
  it('aynı yatta açık dosya aday olarak görünür; ayrı olay gerekçe ister', async () => {
    const a = await dosyaAc({ yat: { adi: 'Mükerrer Yat', markaDiger: 'M', modelDiger: 'M', boy: 10, govde: 'Fiber', govdeNo: 'GOV-1' } });
    const t = await ihbar({ yat: { adi: 'Mükerrer Yat', govdeNo: 'GOV-1', markaDiger: 'M', modelDiger: 'M' } }); const c = await gir('ds');
    const j = (await ist('GET', `/api/ihbar/${t.kimlik}`, c)).json();
    expect(j.adaylar.map((x: any) => x.dosya_no)).toContain(a.dosyaNo);
    expect(j.adaylar[0].neden).toBe('Aynı Yat');
    expect((await ist('POST', `/api/ihbar/${t.kimlik}/mukerrerlik`, c, { sonuc: 'Ayrı olay (gerekçeli)' })).statusCode).toBe(400);
  });
  it('Ret ve Yönlendirme gerekçe ister, numarayı Kapsam Dışı saklar', async () => {
    const t = await ihbar(); const c = await gir('ds'); const ac = (x: object) => ist('POST', `/api/ihbar/${t.kimlik}/acilis`, c, { ozet: 'Ö', ...x });
    expect((await ac({ karar: 'Ret' })).statusCode).toBe(400);
    expect((await ac({ karar: 'Ret', gerekce: 'Kapsam dışı' })).statusCode).toBe(200);
    expect((await sup.query(`SELECT statu FROM talep WHERE kimlik = $1`, [t.kimlik])).rows[0].statu).toBe('Kapsam Dışı / Yönlendirme');
  });
  it('yabancı sigortacı muhatap seçilemez', async () => {
    const t = await ihbar({ sahibiTuru: 'Yabancı Sigortacı / Sörveyör', yetkiDurumu: 'Doğrulandı', sigortaci: 'Foreign' }); const c = await gir('ds');
    await ist('POST', `/api/ihbar/${t.kimlik}/mukerrerlik`, c, { sonuc: 'Mükerrer değil' });
    expect((await ist('POST', `/api/ihbar/${t.kimlik}/acilis`, c, { karar: 'Kabul', ozet: 'Ö', musteriTuru: 'Sigorta Şirketi' })).statusCode).toBe(400);
  });
  it('acil geçici açılış: yalnız Kritik, gerekçe ve tarih zorunlu, yetki beklemez', async () => {
    const t = await ihbar({ acil: true }); const c = await gir('ds'); const ac = (x: object) => ist('POST', `/api/ihbar/${t.kimlik}/acilis`, c, { karar: 'Kabul', ozet: 'Ö', musteriTuru: 'Bireysel Müşteri', ...x });
    await ist('POST', `/api/ihbar/${t.kimlik}/mukerrerlik`, c, { sonuc: 'Mükerrer değil' });
    expect((await ac({ acilGecici: true })).statusCode).toBe(400);
    const r = await ac({ acilGecici: true, eksikGerekce: 'Telefonla alındı', tamamlamaTarih: '2026-12-01' });
    expect(r.statusCode, r.body).toBe(200);
    expect((await sup.query(`SELECT tur FROM dosya_sure WHERE dosya_ref = $1 ORDER BY tur`, [r.json().kimlik])).rows.map((x) => x.tur)).toEqual(['Sahaya Ulaşma', 'Teknik Uzman Ataması']);
  });
});

describe('dosya ekibi (YG-047, YG-048, YG-146, YG-1530)', () => {
  it('yetki: DS, Yedek ve OY Operasyon Müdürü; teknik roller Teknik Müdür atar; yanlış rol kişi seçilemez', async () => {
    const d = await dosyaAc();
    expect((await ata(d.kimlik, 'ds', 'Dosya Sorumlusu', 'tm')).statusCode).toBe(403);
    expect((await ata(d.kimlik, 'tu', 'Teknik Uzman', 'opm')).statusCode).toBe(403);
    expect((await ata(d.kimlik, 'tu', 'Dosya Sorumlusu', 'opm')).statusCode).toBe(400);
    expect((await ist('GET', `/api/dosya/${d.kimlik}`, await gir('saha'))).statusCode).toBe(404);
  });
  it('dört rol atanınca dosya Aktif + Keşif olur, atama kartları kapanır, ekip görür', async () => {
    const d = await dosyaAc();
    await ekipKur(d.kimlik);
    const j = (await ist('GET', `/api/dosya/${d.kimlik}`, await gir('tu'))).json();
    expect([j.statu, j.asama]).toEqual(['Aktif', 'Keşif']);
    expect(j.ekip).toHaveLength(4);
    expect(j.gecmis.at(-1).yeni_statu).toBe('Aktif');
    expect((await kart('Dosya Ekibi Ataması', d.kimlik)).durum).toBe('Tamamlandı');
    expect((await kart('Teknik Ekip Ataması', d.kimlik)).durum).toBe('Tamamlandı');
    expect((await sup.query(`SELECT tamamlanma FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Teknik Uzman Ataması'`, [d.kimlik])).rows[0].tamamlanma).not.toBeNull();
    expect((await sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND baslik = $2`, [K.tu, `Dosyaya Atandınız: ${d.dosyaNo}`])).rowCount).toBe(1);
  });
  it('devir notu olmadan yeni sorumluya geçilmez; önceki atama silinmez; yedek DS ile aynı olamaz', async () => {
    const d = await dosyaAc(); await ekipKur(d.kimlik);
    expect((await ata(d.kimlik, 'ds2', 'Dosya Sorumlusu', 'opm')).statusCode).toBe(400);
    expect((await ata(d.kimlik, 'ds', 'Yedek Sorumlu', 'opm')).statusCode).toBe(400);
    expect((await ata(d.kimlik, 'ds2', 'Dosya Sorumlusu', 'opm', { devirNotu: 'İzin' })).statusCode).toBe(200);
    const r = (await sup.query(`SELECT kullanici_ref, bitis_zamani, devir_notu FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Dosya Sorumlusu' ORDER BY atama_zamani`, [d.kimlik])).rows;
    expect(r).toHaveLength(2); expect(r[0].devir_notu).toBe('İzin'); expect(r[1].bitis_zamani).toBeNull();
    expect((await sup.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].r).toBe(K.ds2);
  });
  it('boy ve gövde bilinmeyen Normal dosyada Teknik Uzman atanmaz; tamamlanınca kart açılır; Yüksekte ön şart yok', async () => {
    const yat = { adi: 'Eksik Yat', markaDiger: 'X', modelDiger: 'Y' };
    const d = await dosyaAc({ yat });
    expect((await ata(d.kimlik, 'tu', 'Teknik Uzman', 'tm')).statusCode).toBe(409);
    expect(await kart('Teknik Ekip Ataması', d.kimlik)).toBeUndefined();
    await ata(d.kimlik, 'ds', 'Dosya Sorumlusu', 'opm');
    const c = await gir('ds');
    expect((await ist('POST', `/api/dosya/${d.kimlik}/yat-bilgisi`, c, { boy: 12 })).statusCode).toBe(400);
    expect((await ist('POST', `/api/dosya/${d.kimlik}/yat-bilgisi`, c, { boy: 12, govde: 'Ahşap', kaynak: 'Ruhsat' })).statusCode).toBe(200);
    expect(await kart('Teknik Ekip Ataması', d.kimlik)).toBeDefined();
    expect((await ata(d.kimlik, 'tu', 'Teknik Uzman', 'tm')).statusCode).toBe(200);
    const y = await dosyaAc({ yat: { adi: 'Eksik Yüksek', markaDiger: 'X', modelDiger: 'Y' }, oncelik: 'Yüksek' });
    expect((await ata(y.kimlik, 'tu', 'Teknik Uzman', 'tm')).statusCode).toBe(200);
  });
  it('kapasite: %80 uyarı, %100 atama reddi; Saha Sorumlusu en fazla 3', async () => {
    const a = await dosyaAc(); const b = await dosyaAc(); const c = await dosyaAc(); const e = await dosyaAc();
    expect((await ata(a.kimlik, 'saha', 'Saha Sorumlusu', 'tm')).statusCode).toBe(200);
    expect((await ata(b.kimlik, 'saha', 'Saha Sorumlusu', 'tm')).statusCode).toBe(200);
    const u = await ata(c.kimlik, 'saha', 'Saha Sorumlusu', 'tm');
    expect(u.json().uyari).toContain('%100');
    expect((await ata(e.kimlik, 'saha', 'Saha Sorumlusu', 'tm')).statusCode).toBe(409);
    const o = (await ist('GET', `/api/dosya/${e.kimlik}/ekip-oneri?rol=${encodeURIComponent('Saha Sorumlusu')}`, await gir('tm'))).json();
    expect(o[0].oran).toBe(100);
  });
});

describe('öncelik (YG-036, YG-1595)', () => {
  const hazir = async (e: object = {}) => { const d = await dosyaAc(e); await ekipKur(d.kimlik); return d; };
  it('DS yükseltir; ekip dışı yapamaz', async () => {
    const d = await hazir();
    expect((await ist('POST', `/api/dosya/${d.kimlik}/oncelik`, await gir('tm'), { oncelik: 'Yüksek' })).statusCode).toBe(403);
    expect((await ist('POST', `/api/dosya/${d.kimlik}/oncelik`, await gir('ds'), { oncelik: 'Yüksek' })).json().durum).toBe('Yükseltildi');
  });
  it('düşürme gerekçe ister, OY ve TY birlikte onaylar; karara kadar öncelik kalır', async () => {
    const d = await hazir({ oncelik: 'Yüksek' }); const c = await gir('ds');
    expect((await ist('POST', `/api/dosya/${d.kimlik}/oncelik`, c, { oncelik: 'Normal' })).statusCode).toBe(400);
    expect((await ist('POST', `/api/dosya/${d.kimlik}/oncelik`, c, { oncelik: 'Normal', gerekce: 'Tehlike geçti' })).json().durum).toBe('Onaya Gönderildi');
    expect((await ist('POST', `/api/dosya/${d.kimlik}/oncelik`, c, { oncelik: 'Normal', gerekce: 'Tekrar' })).statusCode).toBe(409);
    const t = (await sup.query(`SELECT kimlik FROM oncelik_talebi WHERE dosya_ref = $1`, [d.kimlik])).rows[0];
    const k = await kart('Öncelik Düşürme', t.kimlik);
    expect((await karar(k.kimlik, 'oy', 'Onaya Gönder')).statusCode).toBe(200);
    expect((await sup.query(`SELECT oncelik FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].oncelik).toBe('Yüksek');
    expect((await karar(k.kimlik, 'ty', 'Onayla')).statusCode).toBe(200);
    expect((await sup.query(`SELECT oncelik FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].oncelik).toBe('Normal');
  });
  it('görüş ayrılığında sırayla üst kademeye gider; son kademede ret kapatır', async () => {
    const d = await hazir({ oncelik: 'Yüksek' });
    await ist('POST', `/api/dosya/${d.kimlik}/oncelik`, await gir('ds'), { oncelik: 'Planlı', gerekce: 'G' });
    const t = (await sup.query(`SELECT kimlik FROM oncelik_talebi WHERE dosya_ref = $1`, [d.kimlik])).rows[0];
    await karar((await kart('Öncelik Düşürme', t.kimlik)).kimlik, 'oy', 'Onaya Gönder');
    await karar((await kart('Öncelik Düşürme', t.kimlik)).kimlik, 'ty', 'Reddet', 'Hayır');
    const omy = await sup.query(`SELECT * FROM is_karti WHERE tur = 'Öncelik Düşürme' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [t.kimlik]);
    expect(omy.rowCount).toBe(1); expect((await sup.query(`SELECT kademe FROM oncelik_talebi WHERE kimlik = $1`, [t.kimlik])).rows[0].kademe).toBe(1);
    // İlk makam da iade ederek karşı çıkabilir.
    expect((await karar(omy.rows[0].kimlik, 'omy', 'Gerekçeyle İade Et', 'Hayır')).statusCode).toBe(200);
    const son3 = await sup.query(`SELECT * FROM is_karti WHERE tur = 'Öncelik Düşürme' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [t.kimlik]);
    await karar(son3.rows[0].kimlik, 'opm', 'Onaya Gönder'); await karar(son3.rows[0].kimlik, 'tm', 'Reddet', 'Hayır');
    const tod = await sup.query(`SELECT * FROM is_karti WHERE tur = 'Öncelik Düşürme' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [t.kimlik]);
    expect(tod.rows[0].zincir).toHaveLength(1);
    await karar(tod.rows[0].kimlik, 'tod', 'Reddet', 'Hayır');
    expect((await sup.query(`SELECT durum FROM oncelik_talebi WHERE kimlik = $1`, [t.kimlik])).rows[0].durum).toBe('Reddedildi');
    expect((await sup.query(`SELECT oncelik FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].oncelik).toBe('Yüksek');
  });
  it('Risk Kontrol Altına Alındı Kritiği Yükseğe indirir, sahaya ulaşma sayacını kapatır', async () => {
    const t = await hazir({ acil: true });
    expect((await ist('POST', `/api/dosya/${t.kimlik}/risk-kontrol`, await gir('tu'))).statusCode).toBe(403);
    expect((await ist('POST', `/api/dosya/${t.kimlik}/risk-kontrol`, await gir('ds'))).json().oncelik).toBe('Yüksek');
    expect((await sup.query(`SELECT tamamlanma FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Sahaya Ulaşma'`, [t.kimlik])).rows[0].tamamlanma).not.toBeNull();
    expect((await ist('POST', `/api/dosya/${t.kimlik}/risk-kontrol`, await gir('ds'))).statusCode).toBe(409);
  });
});

describe('aşama kapıları (YG-065, YG-1468)', () => {
  it('yalnız sıradaki aşama; teklif öncesi marka, boy, gövde ve tahrik zorunlu', async () => {
    const d = await dosyaAc(); await ekipKur(d.kimlik); const c = await gir('ds');
    expect((await ist('POST', `/api/dosya/${d.kimlik}/asama`, c, { asama: 'Onay', gerekce: 'x' })).statusCode).toBe(400);
    const r = await ist('POST', `/api/dosya/${d.kimlik}/asama`, c, { asama: 'Teklif', gerekce: 'x' });
    expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('tahrik');
    await ist('POST', `/api/dosya/${d.kimlik}/yat-bilgisi`, c, { tahrik: 'Çift dizel' });
    await sup.query(`INSERT INTO kesif (dosya_ref, amac_kapsam, planlanan_baslangic, planlanan_bitis, sorumlu_ref, durum, olusturan_ref) VALUES ($1,'Sınama',now(),now() + interval '1 hour',$2,'Tamamlandı',$2)`, [d.kimlik, K.tu]);
    expect((await ist('POST', `/api/dosya/${d.kimlik}/asama`, c, { asama: 'Teklif', gerekce: 'Keşif bitti' })).statusCode).toBe(200);
  });
});

describe('Beklemede (YG-068, YG-069, YG-070, YG-1491)', () => {
  const hazir = async () => { const d = await dosyaAc(); await ekipKur(d.kimlik); return d; };
  const bek = async (id: string, e: object = {}) => ist('POST', `/api/dosya/${id}/beklemede`, await gir('ds'), { neden: 'Hava', sorumlu: K.ds, hedefTarih: '2099-01-01', kanitBelge: await belgeYukle(id), ...e });
  it('neden, sorumlu, hedef ve kanıt olmadan açılmaz; sözlük dışı neden yok; statü korunur', async () => {
    const d = await hazir();
    expect((await bek(d.kimlik, { neden: 'Keyfî' })).statusCode).toBe(400);
    expect((await bek(d.kimlik, { hedefTarih: '2020-01-01' })).statusCode).toBe(400);
    expect((await bek(d.kimlik, { kanitBelge: null })).statusCode).toBe(400);
    expect((await bek(d.kimlik, { sorumlu: K.saha })).statusCode).toBe(400);
    const r = await bek(d.kimlik);
    expect(r.statusCode, r.body).toBe(200); expect(r.json().sayacDurur).toBe(true);
    expect((await sup.query(`SELECT statu, asama FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0]).toEqual({ statu: 'Aktif', asama: 'Keşif' });
    expect((await bek(d.kimlik)).statusCode).toBe(409);
  });
  it('sayaç: Bilgi işler, Parça yalnız tedarikçi kaynaklıysa durur', async () => {
    const d = await hazir();
    expect((await bek(d.kimlik, { neden: 'Bilgi' })).json().sayacDurur).toBe(false);
    expect((await bek(d.kimlik, { neden: 'Parça' })).json().sayacDurur).toBe(false);
    await sup.query(`UPDATE beklemede_isareti SET kaldirilma_zamani = now() WHERE dosya_ref = $1 AND neden = 'Parça'`, [d.kimlik]);
    expect((await bek(d.kimlik, { neden: 'Parça', tedarikciKaynakli: true })).json().sayacDurur).toBe(true);
  });
  it('sayaç durduran işaret bitişi ileri taşır', async () => {
    const d = await hazir(); await bek(d.kimlik);
    await sup.query(`UPDATE beklemede_isareti SET olusturma_zamani = now() - interval '5 hours' WHERE dosya_ref = $1`, [d.kimlik]);
    await sup.query(`UPDATE dosya_sure SET baslangic = now() - interval '10 hours' WHERE dosya_ref = $1 AND tur = 'Randevu İletişimi'`, [d.kimlik]);
    const once = (await sup.query(`SELECT bitis FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Randevu İletişimi'`, [d.kimlik])).rows[0].bitis;
    const j = (await ist('GET', `/api/dosya/${d.kimlik}`, await gir('ds'))).json();
    const sn = (+new Date(j.sureler.find((x: any) => x.tur === 'Randevu İletişimi').bitis) - +once) / 1000;
    expect(sn).toBeGreaterThan(5 * 3600 - 60); expect(sn).toBeLessThan(5 * 3600 + 60);
  });
  it('10. gün yükseltme, 45. gün karar kartı; otomatik kapanmaz; karar kaydedilir', async () => {
    const d = await hazir(); const r = await bek(d.kimlik);
    await sup.query(`UPDATE beklemede_isareti SET olusturma_zamani = now() - interval '11 days' WHERE kimlik = $1`, [r.json().kimlik]);
    await beklemedeIsle(db);
    expect((await sup.query(`SELECT eskalasyon_zamani FROM beklemede_isareti WHERE kimlik = $1`, [r.json().kimlik])).rows[0].eskalasyon_zamani).not.toBeNull();
    expect((await sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND baslik = $2`, [K.opm, `Beklemede 10. Gün: ${d.dosyaNo}`])).rowCount).toBe(1);
    await sup.query(`UPDATE beklemede_isareti SET olusturma_zamani = now() - interval '46 days' WHERE kimlik = $1`, [r.json().kimlik]);
    await beklemedeIsle(db); await beklemedeIsle(db);
    expect((await sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Beklemede 45. Gün Kararı' AND nesne_kimligi = $1`, [r.json().kimlik])).rows[0].n).toBe(1);
    expect((await sup.query(`SELECT statu FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].statu).toBe('Aktif');
    expect((await ist('POST', `/api/beklemede/${r.json().kimlik}/karar`, await gir('ds'), { karar: 'Devam' })).statusCode).toBe(403);
    expect((await ist('POST', `/api/beklemede/${r.json().kimlik}/karar`, await gir('opm'), { karar: 'Kontrollü Askıda' })).statusCode).toBe(200);
    expect((await sup.query(`SELECT statu FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].statu).toBe('Kontrollü Askıda');
  });
  it('uzatma 15 gün; ilk üçü Operasyon Müdürü, 4. uzatma Direktör', async () => {
    const d = await hazir(); const id = (await bek(d.kimlik)).json().kimlik; const c = await gir('ds');
    expect((await ist('POST', `/api/beklemede/${id}/uzat`, c, {})).statusCode).toBe(400);
    expect((await ist('POST', `/api/beklemede/${id}/uzat`, c, { gerekce: 'Hava devam' })).statusCode).toBe(200);
    expect((await ist('POST', `/api/beklemede/${id}/uzat`, c, { gerekce: 'Yine' })).statusCode).toBe(409);
    expect((await karar((await kart('Beklemede Uzatma', id)).kimlik, 'opm', 'Onayla')).statusCode).toBe(200);
    const b = (await sup.query(`SELECT hedef_tarih::text h, uzatma_sayisi u FROM beklemede_isareti WHERE kimlik = $1`, [id])).rows[0];
    expect([b.h, b.u]).toEqual(['2099-01-16', 1]);
    await sup.query(`UPDATE beklemede_isareti SET uzatma_sayisi = 3 WHERE kimlik = $1`, [id]);
    await ist('POST', `/api/beklemede/${id}/uzat`, c, { gerekce: 'Dördüncü' });
    const k = await kart('Beklemede Uzatma', id);
    expect((await karar(k.kimlik, 'opm', 'Onayla')).statusCode).toBe(403);
    expect((await karar(k.kimlik, 'tod', 'Onayla')).statusCode).toBe(200);
  });
});

describe('süre aşımı ve açık konu (YG-040, YG-059)', () => {
  it('aşılan süre bir kez bildirilir', async () => {
    const t = await ihbar();
    await sup.query(`UPDATE dosya_sure SET bitis = now() - interval '1 minute' WHERE talep_ref = $1`, [t.kimlik]);
    await sureIsle(db); await sureIsle(db);
    expect((await sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND baslik = $2`, [K.opm, `Süre Aşıldı · İlk Yanıt: ${t.talepNo}`])).rows[0].n).toBe(1);
  });
  it('sahipsiz konu açılmaz; kanıt olmadan doğrulamaya geçmez; sahibi kendi konusunu kapatamaz', async () => {
    const d = await dosyaAc(); await ekipKur(d.kimlik); const c = await gir('ds');
    expect((await ist('POST', `/api/dosya/${d.kimlik}/konu`, c, { baslik: 'K', hedefTarih: '2026-12-01' })).statusCode).toBe(400);
    const r = await ist('POST', `/api/dosya/${d.kimlik}/konu`, c, { baslik: 'K', sahip: K.ds, hedefTarih: '2026-12-01' });
    expect(r.json().konu_no).toBe(`${d.dosyaNo}-AK01`);
    const id = r.json().kimlik;
    expect((await ist('POST', `/api/konu/${id}/durum`, c, { statu: 'Kapalı' })).statusCode).toBe(409);
    await ist('POST', `/api/konu/${id}/durum`, c, { statu: 'İşlemde' });
    expect((await ist('POST', `/api/konu/${id}/durum`, c, { statu: 'Doğrulamada' })).statusCode).toBe(400);
    await ist('POST', `/api/konu/${id}/durum`, c, { statu: 'Doğrulamada', kanit: 'Foto' });
    expect((await ist('POST', `/api/konu/${id}/durum`, c, { statu: 'Kapalı' })).statusCode).toBe(403);
    expect((await ist('POST', `/api/konu/${id}/durum`, await gir('tu'), { statu: 'Kapalı' })).statusCode).toBe(200);
  });
});

describe('arama ve erişim', () => {
  it('yalnız erişilebilir dosya döner; dosya.tum her şeyi görür', async () => {
    const d = await dosyaAc({ yat: { adi: 'Aranan Tekne', markaDiger: 'X', modelDiger: 'Y', boy: 10, govde: 'Fiber' } });
    expect((await ist('GET', '/api/ara?q=Aranan', await gir('saha'))).json().dosyalar).toEqual([]);
    expect((await ist('GET', '/api/ara?q=Aranan', await gir('opm'))).json().dosyalar[0].dosya_no).toBe(d.dosyaNo);
    expect((await ist('GET', '/api/dosya', await gir('saha'))).json().find((x: any) => x.dosya_no === d.dosyaNo)).toBeUndefined();
    expect((await ist('GET', '/api/dosya?kapsam=tum', await gir('opm'))).json().find((x: any) => x.dosya_no === d.dosyaNo)).toBeDefined();
  });
  it('dış kullanıcı dosya listesine giremez', async () => {
    const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: 'yatsahibi' + D, parola: PAROLA } });
    const c = ckr(g); await ist('POST', '/api/kimlik/sms', c);
    const o = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0] }));
    expect((await ist('GET', '/api/dosya', o)).statusCode).toBe(403);
    expect((await ist('GET', '/api/ihbar', o)).statusCode).toBe(403);
  });
});
