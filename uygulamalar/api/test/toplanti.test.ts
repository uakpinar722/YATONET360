import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';
import { periyodikIsle, toplantiHatirlat } from '../src/toplanti.js';

const VT = 'yatonet360_test10'; const PAROLA = 'Sinama-Parolasi-2026!'; const D = '@deneme.yatonet.local';
const CEO = 'ceo' + D, BIM = 'bimuduru' + D, DES = 'destek' + D, DEN = 'denetci' + D, YAT = 'yatsahibi' + D;
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool;
const sms = new DenemeKutusu(null), posta = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const ckr = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: { [COOKIE_ADI]: c }, payload });
const K: Record<string, string> = {}; const R: Record<string, string> = {}; const oturum: Record<string, string> = {};
const ileri = (saat: number) => new Date(Date.now() + saat * 3_600_000).toISOString();
const gunSonra = (g: number) => new Date(Date.now() + 180 * 60_000 + g * 86_400_000).toISOString().slice(0, 10);

async function gir(ep: string) {
  if (oturum[ep]) return oturum[ep]!;
  const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: ep, parola: PAROLA } });
  const c = ckr(g);
  if (g.json().yontem === 'sms') { await ist('POST', '/api/kimlik/sms', c); return (oturum[ep] = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0] }))); }
  const q = await ist('GET', '/api/kimlik/kurulum', c);
  return (oturum[ep] = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) })));
}
const ata = (ep: string, rol: string) => sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) VALUES ($1,$2)`, [K[ep], R[rol]]);
const al = (ep: string, rol: string) => sup.query(`DELETE FROM rol_atamasi WHERE kullanici_ref = $1 AND rol_ref = $2`, [K[ep], R[rol]]);
const planla = (c: string, b: object) => ist('POST', '/api/toplanti', c, { kod: 'TPL-10', konu: 'Olay', baslangic: ileri(48), sureDk: 30, ...b });

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [await parolaOzetle(PAROLA)]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' WHEN kullanici_grubu = 'İş Birliği Firması' THEN 'KVKK-03' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  for (const ep of [CEO, BIM, DES, DEN, YAT]) K[ep] = (await sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rows[0].kimlik;
  for (const r of (await sup.query(`SELECT kimlik, rol_adi FROM rol`)).rows) R[r.rol_adi] = r.kimlik;
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  s = await sunucuKur({ db, sms, eposta: posta, anahtar: 'ab'.repeat(32), guvenliCerez: false, webAdresi: 'http://x' });
});
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });
beforeEach(() => { posta.gidenler.length = 0; });

describe('katalog (Ek II §1.8)', () => {
  it('on iki toplantı (TPL-11/12 yıllık bütçe, CEO 06.11.2026), başkan ve düzenleyenleriyle yüklüdür', async () => {
    const { rows } = await sup.query(`SELECT kod, baskan_rol, duzenleyen_rol FROM toplanti_katalogu ORDER BY kod`);
    expect(rows).toHaveLength(12);
    expect(rows[1]).toEqual({ kod: 'TPL-02', baskan_rol: 'Teknik ve Operasyon Direktörü', duzenleyen_rol: 'Operasyon Müdürü' });
    expect(rows[2]).toEqual({ kod: 'TPL-03', baskan_rol: 'CEO', duzenleyen_rol: 'CEO Asistanı' });
    expect(rows[9]).toEqual({ kod: 'TPL-10', baskan_rol: null, duzenleyen_rol: null });
    expect(rows[11]).toEqual({ kod: 'TPL-12', baskan_rol: 'CEO', duzenleyen_rol: 'Muhasebe ve Finans Müdürü' });
  });
  it('katalogdaki tüm rol adları rol tablosunda vardır', async () => {
    const { rows } = await sup.query(`SELECT DISTINCT x FROM toplanti_katalogu, unnest(array_append(array_append(oto_roller, baskan_rol), duzenleyen_rol)) x WHERE x IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rol WHERE rol_adi = x)`);
    expect(rows).toEqual([]);
  });
});

describe('planlama yetkisi ve başkan (YG-579, YG-583)', () => {
  it('TPL-10 her LGM personeline açık, diğer toplantılar yalnız düzenleyen rolüne; dosyaya bağlı olanlar henüz seçilemez', async () => {
    const d = await gir(DES);
    expect((await ist('GET', '/api/toplanti/secenek', d)).json().turler.map((t: any) => t.kod)).toEqual(['TPL-10']);
    expect((await planla(d, { kod: 'TPL-02' })).statusCode).toBe(403);
    expect((await planla(d, { kod: 'TPL-06' })).statusCode).toBe(403);
    await ata(DES, 'Operasyon Müdürü');
    expect((await ist('GET', '/api/toplanti/secenek', d)).json().turler.map((t: any) => t.kod)).toEqual(['TPL-02', 'TPL-10']);
    await al(DES, 'Operasyon Müdürü');
  });
  it('dış kullanıcı giremez', async () => {
    const y = await gir(YAT);
    expect((await ist('GET', '/api/toplanti', y)).statusCode).toBe(403);
    expect((await planla(y, { katilimcilar: [{ kullanici: K[CEO] }] })).statusCode).toBe(403);
  });
  it('alan denetimleri', async () => {
    const d = await gir(DES);
    expect((await planla(d, {})).statusCode).toBe(400); // katılımcı yok
    const k = { katilimcilar: [{ kullanici: K[BIM] }] };
    expect((await planla(d, { ...k, konu: ' ' })).statusCode).toBe(400);
    expect((await planla(d, { ...k, baslangic: ileri(-5) })).statusCode).toBe(400);
    expect((await planla(d, { ...k, sureDk: 1 })).statusCode).toBe(400);
    expect((await planla(d, { katilimcilar: [{ kullanici: K[YAT] }] })).statusCode).toBe(400);
    expect((await planla(d, { katilimcilar: [{ kullanici: K[BIM], katilim: 'Belki' }] })).statusCode).toBe(400);
  });
  it('en üst kademedeki LGM katılımcısı başkan olur; düzenleyen üst kademe varken başkanlık edemez', async () => {
    const d = await gir(DES);
    const id = (await planla(d, { katilimcilar: [{ kullanici: K[BIM] }, { kullanici: K[CEO] }] })).json().kimlik;
    const t = (await ist('GET', `/api/toplanti/${id}`, d)).json();
    expect(t.baskan_ref).toBe(K[CEO]); expect(t.duzenleyen_ref).toBe(K[DES]); expect(t.baskanim).toBe(false); expect(t.duzenleyenim).toBe(true);
  });
  it('katalogda başkan rolü olan toplantıda rol sahibi başkandır, roller otomatik eklenir', async () => {
    await ata(DES, 'Operasyon Müdürü'); await ata(DEN, 'Teknik Müdür'); await ata(BIM, 'Teknik ve Operasyon Direktörü');
    const d = await gir(DES);
    const r = await planla(d, { kod: 'TPL-02', konu: 'Haftalık', katilimcilar: [{ kullanici: K[CEO], katilim: 'Yalnız Bilgi' }] });
    const t = (await ist('GET', `/api/toplanti/${r.json().kimlik}`, d)).json();
    expect(t.baskan_ref).toBe(K[BIM]);
    expect(t.katilimcilar.map((k: any) => k.kimlik).sort()).toEqual([K[BIM], K[DEN], K[DES], K[CEO]].sort());
    expect(t.katilimcilar.find((k: any) => k.kimlik === K[CEO]).katilim).toBe('Yalnız Bilgi');
    expect(t.gundem).toMatch(/Süresi Aşan Onay: \d+/);
    await al(DES, 'Operasyon Müdürü'); await al(DEN, 'Teknik Müdür'); await al(BIM, 'Teknik ve Operasyon Direktörü');
  });
  it('takvim çakışması bildirilir, engellemez', async () => {
    const d = await gir(DES); const z = ileri(100);
    await planla(d, { baslangic: z, katilimcilar: [{ kullanici: K[BIM] }] });
    const r = await planla(d, { baslangic: new Date(new Date(z).getTime() + 10 * 60_000).toISOString(), katilimcilar: [{ kullanici: K[BIM] }] });
    expect(r.statusCode).toBe(200);
    expect(r.json().cakisanlar).toContain('Deneme Bilgi İşlem Müdürü');
    const o = await ist('POST', '/api/toplanti/cakisma', d, { kisiler: [K[BIM]], baslangic: z, sureDk: 5 });
    expect(o.json().cakisanlar).toContain('Deneme Bilgi İşlem Müdürü');
    const b = await ist('POST', '/api/toplanti/cakisma', d, { kisiler: [K[BIM]], baslangic: ileri(500), sureDk: 5 });
    expect(b.json().cakisanlar).toEqual([]);
  });
  it('başkası toplantıyı göremez', async () => {
    const d = await gir(DES);
    const id = (await planla(d, { katilimcilar: [{ kullanici: K[BIM] }] })).json().kimlik;
    expect((await ist('GET', `/api/toplanti/${id}`, await gir(DEN))).statusCode).toBe(404);
    expect((await ist('GET', '/api/toplanti/abc', d)).statusCode).toBe(404);
  });
});

describe('davet ve hatırlatma (YG-581)', () => {
  it('davet anında bildirilir; 24 saat, 1 saat, 15 dakika eşikleri birer kez; mesai dışında bekletilmez', async () => {
    const d = await gir(DES);
    const bas = ileri(30);
    const id = (await planla(d, { baslangic: bas, katilimcilar: [{ kullanici: K[BIM] }, { kullanici: K[CEO], katilim: 'Yalnız Bilgi' }] })).json().kimlik;
    const g = await sup.query(`SELECT kanal, kullanici_ref, plan_zamani FROM gonderim WHERE olay_anahtari = $1`, [`tpl-davet:${id}`]);
    expect(g.rows.map((x) => x.kullanici_ref).sort()).toEqual([K[BIM], K[CEO]].sort());
    const t = new Date(bas).getTime(); const an = (dk: number) => new Date(t - dk * 60_000);
    const say = async (e: number) => (await sup.query(`SELECT count(*)::int n FROM bildirim WHERE olay_anahtari = $1 AND kullanici_ref = $2`, [`tpl-hat:${id}:${e}`, K[BIM]])).rows[0].n;
    await toplantiHatirlat(db, an(1500));
    expect(await say(1440)).toBe(0);
    // Gece 02:00 TSİ'ye denk gelen hatırlatma da hemen planlanır.
    const gece = new Date(an(1400).getTime());
    await toplantiHatirlat(db, gece); await toplantiHatirlat(db, gece);
    expect(await say(1440)).toBe(1);
    const p = (await sup.query(`SELECT plan_zamani FROM gonderim WHERE olay_anahtari = $1`, [`tpl-hat:${id}:1440`])).rows[0].plan_zamani;
    expect(new Date(p).getTime()).toBe(gece.getTime());
    await toplantiHatirlat(db, an(50)); expect(await say(60)).toBe(1);
    await toplantiHatirlat(db, an(10)); expect(await say(15)).toBe(1);
    // Yalnız Bilgi katılımcısına hatırlatma gitmez.
    expect((await sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1 AND kullanici_ref = $2`, [`tpl-hat:${id}:60`, K[CEO]])).rowCount).toBe(0);
  });
  it('iptal edilen toplantıya hatırlatma gitmez, katılımcıya iptal bildirilir; yalnız düzenleyen iptal eder', async () => {
    const d = await gir(DES);
    const id = (await planla(d, { baslangic: ileri(5), katilimcilar: [{ kullanici: K[BIM] }] })).json().kimlik;
    expect((await ist('POST', `/api/toplanti/${id}/iptal`, await gir(BIM))).statusCode).toBe(404);
    expect((await ist('POST', `/api/toplanti/${id}/iptal`, d)).statusCode).toBe(200);
    expect((await sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1`, [`tpl-iptal:${id}`])).rowCount).toBe(1);
    await toplantiHatirlat(db);
    expect((await sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari LIKE $1`, [`tpl-hat:${id}%`])).rowCount).toBe(0);
  });
  it('Kritik olay toplantısı daveti SMS ile de gider', async () => {
    const d = await gir(DES);
    const id = (await planla(d, { baslangic: ileri(0.1), kritik: true, katilimcilar: [{ kullanici: K[BIM] }] })).json().kimlik;
    expect((await sup.query(`SELECT kanal FROM gonderim WHERE olay_anahtari = $1 ORDER BY kanal`, [`tpl-davet:${id}`])).rows.map((x) => x.kanal)).toEqual(['E-posta', 'SMS']);
    expect((await planla(d, { kod: 'TPL-02', kritik: true })).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('karar ve tutanak (YG-576, YG-584)', () => {
  it('karar sorumlunun Bugün listesine görev olarak düşer; sorumlu katılımcı olmalı; kapanınca eklenemez; tutanağı başkan onaylar', async () => {
    const d = await gir(DES), b = await gir(BIM);
    const id = (await planla(d, { baslangic: ileri(0.01), katilimcilar: [{ kullanici: K[BIM] }] })).json().kimlik;
    const yaz = (c: string, x: object) => ist('POST', `/api/toplanti/${id}/karar`, c, { metin: 'Yapılacak', sorumlu: K[BIM], hedef: gunSonra(3), ...x });
    expect((await yaz(await gir(DEN), {})).statusCode).toBe(404);
    expect((await yaz(d, { sorumlu: K[DEN] })).statusCode).toBe(400);
    expect((await yaz(d, { hedef: 'yarın' })).statusCode).toBe(400);
    const r = await yaz(d, {});
    expect(r.statusCode).toBe(200);
    const g = (await ist('GET', '/api/bugun', b)).json();
    expect(JSON.stringify(g)).toContain('Toplantı Kararı');
    // Düzenleyen Destek, başkan Bilgi İşlem Müdürü: kapanış başkanda.
    expect((await ist('POST', `/api/toplanti/${id}/kapat`, b)).statusCode).toBe(400); // tutanak yok
    expect((await ist('POST', `/api/toplanti/${id}/tutanak`, d, { tutanak: ' ' })).statusCode).toBe(400);
    expect((await ist('POST', `/api/toplanti/${id}/tutanak`, d, { tutanak: 'Görüşüldü' })).statusCode).toBe(200);
    expect((await ist('POST', `/api/toplanti/${id}/kapat`, d)).statusCode).toBe(403);
    await sup.query(`UPDATE toplanti SET baslangic = now() + interval '1 hour' WHERE kimlik = $1`, [id]);
    expect((await ist('POST', `/api/toplanti/${id}/kapat`, b)).statusCode).toBe(400); // başlamadı
    await sup.query(`UPDATE toplanti SET baslangic = now() - interval '1 hour' WHERE kimlik = $1`, [id]);
    expect((await ist('POST', `/api/toplanti/${id}/kapat`, b)).statusCode).toBe(200);
    expect((await yaz(d, {})).statusCode).toBe(409);
    expect((await ist('POST', `/api/toplanti/${id}/kapat`, b)).statusCode).toBe(409);
    await expect(db.query(`DELETE FROM toplanti_karar`)).rejects.toThrow();
    await expect(db.query(`UPDATE toplanti_karar SET metin = 'x'`)).rejects.toThrow();
  });
});

describe('vekil (Ek II §1.8)', () => {
  const kur = async (bas: string) => {
    const d = await gir(DES);
    const id = (await planla(d, { baslangic: bas, katilimcilar: [{ kullanici: K[BIM] }] })).json().kimlik as string;
    return { d, id };
  };
  it('üst makam zamanında onaylarsa vekil katılımcı olur', async () => {
    const { d, id } = await kur(ileri(5));
    await ist('POST', `/api/toplanti/${id}/vekil`, d, { vekil: K[DES] }); // kendi: geçersiz
    const v = await ist('POST', `/api/toplanti/${id}/vekil`, d, { vekil: K[DEN] });
    expect(v.statusCode).toBe(200);
    expect((await ist('POST', `/api/toplanti/${id}/vekil`, d, { vekil: K[DEN] })).statusCode).toBe(409);
    expect((await ist('POST', `/api/is/${v.json().kart}/karar`, await gir(BIM), { karar: 'Onayla' })).statusCode).toBe(200);
    const t = (await ist('GET', `/api/toplanti/${id}`, d)).json();
    expect(t.katilimcilar.find((k: any) => k.kimlik === K[DES])).toMatchObject({ vekil_durumu: 'Onaylandı', vekil: 'Deneme İç Denetçi' });
    expect(t.katilimcilar.map((k: any) => k.kimlik)).toContain(K[DEN]);
  });
  it('1 saatten az kala talep alınmaz; süre geçtikten sonraki onay mazeretli sayılır', async () => {
    const a = await kur(ileri(0.5));
    expect((await ist('POST', `/api/toplanti/${a.id}/vekil`, a.d, { vekil: K[DEN] })).statusCode).toBe(400);
    const { d, id } = await kur(ileri(5));
    const v = (await ist('POST', `/api/toplanti/${id}/vekil`, d, { vekil: K[DEN] })).json();
    await sup.query(`UPDATE toplanti SET baslangic = now() + interval '30 minutes' WHERE kimlik = $1`, [id]);
    await ist('POST', `/api/is/${v.kart}/karar`, await gir(BIM), { karar: 'Onayla' });
    const t = (await ist('GET', `/api/toplanti/${id}`, d)).json();
    expect(t.katilimcilar.find((k: any) => k.kimlik === K[DES]).vekil_durumu).toBe('Mazeretli');
    expect(t.katilimcilar.map((k: any) => k.kimlik)).not.toContain(K[DEN]);
  });
  it('başkan vekil gösteremez', async () => {
    const { id } = await kur(ileri(5));
    expect((await ist('POST', `/api/toplanti/${id}/vekil`, await gir(BIM), { vekil: K[DEN] })).statusCode).toBe(409);
  });
});

describe('periyodik gözden geçirme (YG-534)', () => {
  const ekle = async (ad: string, g: number, rol = 'Bilgi İşlem Müdürü') => (await sup.query(`INSERT INTO periyodik_is (ad, sahip_rol_ref, periyot_ay, sonraki_tarih) VALUES ($1,$2,12,$3) RETURNING kimlik`, [ad, R[rol], gunSonra(g)])).rows[0].kimlik as string;
  const olay = (id: string, e: string, tarih: string) => `periyodik:${id}:${tarih}:${e}`;
  const var_ = async (o: string) => Boolean((await sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1`, [o])).rowCount);
  it('eşikler doğru sırayla çalışır, aynı eşik tekrar etmez', async () => {
    const id = await ekle('Erişim İncelemesi', 40); const t = gunSonra(40);
    const an = (k: number) => new Date(new Date(`${t}T09:00:00Z`).getTime() - k * 86_400_000);
    await periyodikIsle(db, an(31)); expect(await var_(olay(id, '30g', t))).toBe(false);
    await periyodikIsle(db, an(30)); await periyodikIsle(db, an(30)); expect(await var_(olay(id, '30g', t))).toBe(true);
    expect((await sup.query(`SELECT count(*)::int n FROM bildirim WHERE olay_anahtari = $1`, [olay(id, '30g', t)])).rows[0].n).toBe(1);
    const kart = async () => (await sup.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Periyodik Gözden Geçirme' AND nesne_kimligi = $1`, [id])).rows[0].n;
    await periyodikIsle(db, an(15)); expect(await kart()).toBe(0);
    await periyodikIsle(db, an(14)); await periyodikIsle(db, an(13)); expect(await kart()).toBe(1);
    await periyodikIsle(db, an(7)); expect(await var_(olay(id, '7g', t))).toBe(true);
    await periyodikIsle(db, an(1)); expect(await var_(olay(id, '1g', t))).toBe(true);
    // Geciken: Direktör ve GMY makamına sahip ver
    await ata(DEN, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'); await ata(DES, 'Genel Müdür Yardımcısı');
    await periyodikIsle(db, an(-2)); expect(await var_(olay(id, '72s', t))).toBe(false);
    await periyodikIsle(db, an(-3)); expect(await var_(olay(id, '72s', t))).toBe(true);
    await periyodikIsle(db, an(-9)); expect(await var_(olay(id, '10g', t))).toBe(false);
    await periyodikIsle(db, an(-10)); expect(await var_(olay(id, '10g', t))).toBe(true);
    expect((await sup.query(`SELECT kullanici_ref FROM bildirim WHERE olay_anahtari = $1`, [olay(id, '72s', t)])).rows[0].kullanici_ref).toBe(K[DEN]);
    await al(DEN, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'); await al(DES, 'Genel Müdür Yardımcısı');
  });
  it('görev tamamlanınca sonraki tarih kendiliğinden kurulur', async () => {
    const id = await ekle('Sözleşme Gözden Geçirme', 5); const t = gunSonra(5);
    await periyodikIsle(db);
    const b = await gir(BIM);
    const k = (await sup.query(`SELECT kimlik FROM is_karti WHERE nesne_kimligi = $1`, [id])).rows[0].kimlik;
    expect((await ist('POST', `/api/is/${k}/karar`, b, { karar: 'Tamamlandı' })).statusCode).toBe(200);
    const y = (await sup.query(`SELECT sonraki_tarih::text x FROM periyodik_is WHERE kimlik = $1`, [id])).rows[0].x;
    expect(Number(y.slice(0, 4))).toBe(Number(t.slice(0, 4)) + 1);
    expect(y.slice(5)).toBe(t.slice(5));
  });
});
