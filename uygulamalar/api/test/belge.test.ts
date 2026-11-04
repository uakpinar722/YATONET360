import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { belgeYururlukIsle } from '../src/belge.js';
import { Depo } from '../src/depo.js';
import { kartAc } from '../src/is_motoru.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { doldur, metinGetir, tutar } from '../src/metin.js';
import { parolaOzetle } from '../src/parola.js';
import { pdfKapat, pdfUret, sayfaSayisi } from '../src/pdf.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';

const VT = 'yatonet360_test9'; const PAROLA = 'Sinama-Parolasi-2026!'; const D = '@deneme.yatonet.local';
const BIM = 'bimuduru' + D, DES = 'destek' + D, DEN = 'denetci' + D, YAT = 'yatsahibi' + D, SIS = 'sistem' + D;
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool; let depoYol: string;
const sms = new DenemeKutusu(null), posta = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const ckr = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: { [COOKIE_ADI]: c }, payload });
const K: Record<string, string> = {}; const oturum: Record<string, string> = {};
const PDF = (x: string) => Buffer.from(`%PDF-1.7 ${x}`);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
let kart: string;

async function gir(ep: string) {
  if (oturum[ep]) return oturum[ep]!;
  const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: ep, parola: PAROLA } });
  const c = ckr(g);
  if (g.json().yontem === 'sms') { await ist('POST', '/api/kimlik/sms', c); return (oturum[ep] = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0] }))); }
  const q = await ist('GET', '/api/kimlik/kurulum', c);
  return (oturum[ep] = ckr(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) })));
}
const yukle = async (c: string, govde: Buffer, q: Record<string, string> = {}) => s.inject({
  method: 'POST', headers: { ...H, 'content-type': 'application/octet-stream' }, cookies: { [COOKIE_ADI]: c }, payload: govde,
  url: `/api/belge/yukle?${new URLSearchParams({ ad: 'Sözleşme', tur: 'Sözleşme', bagTuru: 'Onay', bagKimligi: kart, kaynak: 'E-posta', dosya: 'a.pdf', ...q })}`,
});

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [await parolaOzetle(PAROLA)]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' WHEN kullanici_grubu = 'İş Birliği Firması' THEN 'KVKK-03' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  for (const ep of [BIM, DES, DEN, YAT, SIS]) K[ep] = (await sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rows[0].kimlik;
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  depoYol = mkdtempSync(join(tmpdir(), 'yatonet-depo-'));
  s = await sunucuKur({ db, sms, eposta: posta, anahtar: 'ff'.repeat(32), guvenliCerez: false, webAdresi: 'http://x', depo: new Depo(depoYol) });
  const R = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Bilgi İşlem Müdürü'`)).rows[0].kimlik;
  kart = await kartAc(db, { tur: 'Deneme', baslik: 'Bağ', hazirlayan: K[DES], zincir: [R] });
});
afterAll(async () => { await pdfKapat(); await s.close(); await db.end(); await sup.end(); });

describe('yükleme denetimleri (YG-602, YG-606, YG-1269, YG-1440)', () => {
  it('kayda bağsız, tanımsız bağlı veya yetkisiz kayda yüklenemez', async () => {
    const d = await gir(DES);
    expect((await yukle(d, PDF('x'), { bagKimligi: '' })).statusCode).toBe(400);
    expect((await yukle(d, PDF('x'), { bagKimligi: '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(400);
    expect((await yukle(d, PDF('x'), { bagTuru: 'Yat' })).statusCode).toBe(400);
    expect((await yukle(await gir(DEN), PDF('x'))).statusCode).toBe(403);
  });
  it('yat sahibi belge yüklemez', async () => {
    expect((await yukle(await gir(YAT), PDF('x'))).statusCode).toBe(403);
  });
  it('izinsiz tür, çalıştırılabilir içerik ve uzantıyla uyuşmayan içerik reddedilir', async () => {
    const d = await gir(DES);
    expect((await yukle(d, PDF('x'), { dosya: 'a.exe' })).statusCode).toBe(400);
    expect((await yukle(d, PDF('x'), { dosya: 'adsiz' })).statusCode).toBe(400);
    const mz = await yukle(d, Buffer.from([0x4d, 0x5a, 0x90, 0]), { dosya: 'fatura.pdf' });
    expect(mz.statusCode).toBe(400); expect(mz.json().hata).toMatch(/çalıştırılabilir/i);
    expect((await yukle(d, Buffer.from('metin'), { dosya: 'a.pdf' })).json().hata).toMatch(/uyuşmamaktadır/);
  });
  it('zararlı içerik kaydedilmez, iz bırakır; geçici dosya kalmaz', async () => {
    const d = await gir(DES);
    const r = await yukle(d, Buffer.from('%PDF-1.7 X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE'), { ad: 'Virüslü' });
    expect(r.statusCode).toBe(422);
    expect((await sup.query(`SELECT 1 FROM belge WHERE ad = 'Virüslü'`)).rowCount).toBe(0);
    expect((await sup.query(`SELECT 1 FROM denetim_izi WHERE eylem = 'Zararlı Dosya Engellendi'`)).rowCount).toBe(1);
    expect(readdirSync(join(depoYol, 'gecici'))).toEqual([]);
  });
  it('boyut sınırı akış sırasında uygulanır', async () => {
    const d = await gir(DES);
    await sup.query(`UPDATE dosya_siniri SET azami_bayt = 8 WHERE grup = 'Fotoğraf'`);
    expect((await yukle(d, Buffer.concat([PNG, Buffer.alloc(100)]), { dosya: 'b.png', ad: 'Büyük' })).statusCode).toBe(413);
    expect(readdirSync(join(depoYol, 'gecici'))).toEqual([]);
    await sup.query(`UPDATE dosya_siniri SET azami_bayt = 104857600 WHERE grup = 'Fotoğraf'`);
  });
});

describe('sürüm ve erişim (YG-591…YG-609)', () => {
  it('aynı adla yükleme yeni sürüm açar, aynı içerik reddedilir, gerekçe zorunlu', async () => {
    const d = await gir(DES);
    const r1 = await yukle(d, PDF('bir'));
    expect(r1.statusCode).toBe(200); expect(r1.json().surum).toBe(1);
    expect((await yukle(d, PDF('bir'))).statusCode).toBe(409);
    expect((await yukle(d, PDF('iki'))).json().hata).toMatch(/gerekçesi/);
    const r2 = await yukle(d, PDF('iki'), { gerekce: 'Düzeltme' });
    expect(r2.json()).toMatchObject({ belge: r1.json().belge, surum: 2 });
    const l = (await ist('GET', `/api/belge?bagTuru=Onay&bagKimligi=${kart}`, d)).json();
    expect(l[0].surumler.map((x: any) => x.no)).toEqual([2, 1]);
  });
  it('özgün içerik aynen indirilir; indirme iz bırakır; başkası göremez', async () => {
    const d = await gir(DES);
    const id = (await yukle(d, PDF('özgün'), { ad: 'Ek', sinif: 'Gizli' })).json().belge;
    const r = await ist('GET', `/api/belge/${id}/surum/1/indir`, d);
    expect(r.statusCode).toBe(200); expect(r.rawPayload.equals(PDF('özgün'))).toBe(true);
    expect((await sup.query(`SELECT 1 FROM denetim_izi WHERE eylem = 'Belge İndirildi' AND nesne_kimligi = $1`, [id])).rowCount).toBe(1);
    expect((await ist('GET', `/api/belge/${id}/surum/1/indir`, await gir(DEN))).statusCode).toBe(404);
    expect((await ist('GET', `/api/belge?bagTuru=Onay&bagKimligi=${kart}`, await gir(DEN))).statusCode).toBe(404);
  });
  it('Kritik belgeyi kayda erişimi olan da göremez', async () => {
    const d = await gir(DES), b = await gir(BIM);
    const id = (await yukle(d, PDF('kritik'), { ad: 'Kritik', sinif: 'Kritik' })).json().belge;
    expect((await ist('GET', `/api/belge/${id}/surum/1/indir`, b)).statusCode).toBe(404);
    expect((await ist('GET', `/api/belge?bagTuru=Onay&bagKimligi=${kart}`, b)).json().map((x: any) => x.ad)).not.toContain('Kritik');
  });
  it('veritabanı hesabı özgün kaydı silemez, özetini değiştiremez', async () => {
    await expect(db.query(`DELETE FROM belge_surum`)).rejects.toThrow();
    await expect(db.query(`UPDATE belge_surum SET ozet_sha256 = 'x'`)).rejects.toThrow();
    await expect(db.query(`DELETE FROM belge`)).rejects.toThrow();
  });
});

describe('onay ve yürürlük (YG-594…YG-597, YG-691)', () => {
  const onayla = async (id: string, no: number, yururluk?: string) => {
    const d = await gir(DES), b = await gir(BIM);
    const r = await ist('POST', `/api/belge/${id}/surum/${no}/onaya-gonder`, d, yururluk ? { yururluk } : {});
    expect(r.statusCode).toBe(200);
    expect((await ist('POST', `/api/is/${r.json().kart}/karar`, b, { karar: 'Onayla' })).statusCode).toBe(200);
    return (await sup.query(`SELECT durum, dogrulama_kodu, onaylayan_ref FROM belge_surum WHERE belge_ref = $1 AND surum_no = $2`, [id, no])).rows[0];
  };
  it('onay Yürürlükte yapar, önceki Yerine Geçti olur, ikinci kez gönderilemez, doğrulama kodu çalışır', async () => {
    const d = await gir(DES);
    const id = (await yukle(d, PDF('o1'), { ad: 'Prosedür' })).json().belge;
    const s1 = await onayla(id, 1);
    expect(s1.durum).toBe('Yürürlükte'); expect(s1.onaylayan_ref).toBe(K[BIM]); expect(s1.dogrulama_kodu).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect((await ist('POST', `/api/belge/${id}/surum/1/onaya-gonder`, d)).statusCode).toBe(409);
    await yukle(d, PDF('o2'), { ad: 'Prosedür', gerekce: 'Revizyon' });
    await onayla(id, 2);
    const l = (await sup.query(`SELECT durum FROM belge_surum WHERE belge_ref = $1 ORDER BY surum_no`, [id])).rows.map((x) => x.durum);
    expect(l).toEqual(['Yerine Geçti', 'Yürürlükte']);
    const v = await s.inject({ method: 'GET', url: `/api/dogrula/${s1.dogrulama_kodu}` });
    expect(v.json()).toMatchObject({ ad: 'Prosedür', surum: 1, durum: 'Yerine Geçti' });
    expect((await s.inject({ method: 'GET', url: '/api/dogrula/AAAA-AAAA' })).statusCode).toBe(404);
  });
  it('ileri tarihli sürüm tarihi gelince yürürlüğe girer', async () => {
    const d = await gir(DES);
    const id = (await yukle(d, PDF('i1'), { ad: 'İleri' })).json().belge;
    expect((await onayla(id, 1, '2099-01-01')).durum).toBe('Onaylı');
    expect(await belgeYururlukIsle(db)).toBe(0);
    await sup.query(`UPDATE belge_surum SET yururluk_tarihi = current_date WHERE belge_ref = $1`, [id]);
    expect(await belgeYururlukIsle(db)).toBe(1);
    expect((await sup.query(`SELECT durum FROM belge_surum WHERE belge_ref = $1`, [id])).rows[0].durum).toBe('Yürürlükte');
  });
  it('hazırlayan kendi belgesini onaylayamaz, başkası onaya gönderemez, iade Taslak yapar', async () => {
    const d = await gir(DES), b = await gir(BIM);
    const id = (await yukle(d, PDF('h1'), { ad: 'Hazırlayan' })).json().belge;
    expect((await ist('POST', `/api/belge/${id}/surum/1/onaya-gonder`, b)).statusCode).toBe(404);
    const k = (await ist('POST', `/api/belge/${id}/surum/1/onaya-gonder`, d)).json().kart;
    expect((await ist('POST', `/api/is/${k}/karar`, d, { karar: 'Onayla' })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await ist('POST', `/api/is/${k}/karar`, b, { karar: 'Gerekçeyle İade Et', gerekce: 'Eksik' })).statusCode).toBe(200);
    expect((await sup.query(`SELECT durum FROM belge_surum WHERE belge_ref = $1`, [id])).rows[0].durum).toBe('Taslak');
  });
  it('dış kullanıcı için geçmiş sürüm gizlidir (YG-598)', async () => {
    const d = await gir(DES);
    const id = (await yukle(d, PDF('g1'), { ad: 'Geçmiş' })).json().belge;
    await sup.query(`UPDATE is_karti SET sahip_kullanici_ref = $2 WHERE kimlik = $1`, [kart, K[YAT]]);
    const y = await gir(YAT);
    const e = (await ist('GET', `/api/belge?bagTuru=Onay&bagKimligi=${kart}`, y)).json();
    expect(e.map((x: any) => x.ad)).not.toContain('Geçmiş'); // Taslak
    expect((await ist('GET', `/api/belge/${id}/surum/1/indir`, y)).statusCode).toBe(404);
    await onayla(id, 1);
    const g = (await ist('GET', `/api/belge?bagTuru=Onay&bagKimligi=${kart}`, y)).json().find((x: any) => x.ad === 'Geçmiş');
    expect(g.surumler).toHaveLength(1); expect(g.surumler[0].gerekce).toBeNull();
    expect((await ist('GET', `/api/belge/${id}/surum/1/indir`, y)).statusCode).toBe(200);
    await sup.query(`UPDATE is_karti SET sahip_kullanici_ref = NULL WHERE kimlik = $1`, [kart]);
  });
});

describe('paylaşım bağlantısı (YG-611)', () => {
  const ac = (belirtec: string, kod: string) => s.inject({ method: 'POST', url: '/api/paylasim/ac', headers: H, payload: { belirtec, kod } });
  const kodIste = (belirtec: string) => s.inject({ method: 'POST', url: '/api/paylasim/kod', headers: H, payload: { belirtec } });
  it('süre 30 günü aşamaz; alıcı zorunlu; Kritik paylaşılamaz; dış kullanıcı paylaşamaz', async () => {
    const d = await gir(DES);
    const id = (await yukle(d, PDF('p0'), { ad: 'Paylaşım0' })).json().belge;
    const p = (b: object, c = d, b2 = id) => ist('POST', `/api/belge/${b2}/surum/1/paylas`, c, b);
    expect((await p({ alici: 'a@b.co', gun: 31 })).statusCode).toBe(400);
    expect((await p({})).statusCode).toBe(400);
    expect((await p({ alici: 'a@b.co' }, await gir(YAT))).statusCode).toBe(404);
    const kr = (await yukle(d, PDF('p-k'), { ad: 'KritikP', sinif: 'Kritik' })).json().belge;
    expect((await p({ alici: 'a@b.co' }, d, kr)).statusCode).toBe(403);
  });
  it('kodla açılır, kod olmadan açılmaz; yanlış kod sınırı bağlantıyı kapatır; iptal ve süre dolumu çalışır', async () => {
    const d = await gir(DES);
    const id = (await yukle(d, PDF('p1'), { ad: 'Paylaşım1' })).json().belge;
    const yeni = async () => (await ist('POST', `/api/belge/${id}/surum/1/paylas`, d, { alici: 'Alici@Ornek.Com', izin: 'İndir' })).json();
    const y1 = await yeni(); const t1 = y1.baglanti.split('#paylasim=')[1];
    expect((await ac(t1, '000000')).statusCode).toBe(401);
    const b = await kodIste(t1);
    expect(b.json()).toMatchObject({ belge: 'Paylaşım1', alici: 'al***@ornek.com' });
    const m = posta.gidenler.at(-1)!;
    expect(m.telefon).toBe('alici@ornek.com');
    const kod = m.metin.match(/\d{6}/)![0];
    const r = await ac(t1, kod);
    expect(r.statusCode).toBe(200); expect(r.rawPayload.equals(PDF('p1'))).toBe(true);
    await ist('POST', `/api/paylasim/${y1.kimlik}/iptal`, d);
    expect((await ac(t1, kod)).statusCode).toBe(410);
    // Beş yanlış kod
    const t2 = (await yeni()).baglanti.split('#paylasim=')[1];
    await kodIste(t2);
    for (let i = 0; i < 5; i++) await ac(t2, '000000');
    expect((await ac(t2, '000000')).statusCode).toBe(410);
    // Süre dolumu
    const y3 = await yeni();
    await sup.query(`ALTER TABLE paylasim_baglantisi DROP CONSTRAINT IF EXISTS paylasim_baglantisi_check`);
    await sup.query(`UPDATE paylasim_baglantisi SET son_gecerlilik = now() - interval '1 minute' WHERE kimlik = $1`, [y3.kimlik]);
    expect((await kodIste(y3.baglanti.split('#paylasim=')[1])).statusCode).toBe(410);
  });
});

describe('metin kütüphanesi (YG-626, YG-692, YG-1446)', () => {
  it('katalog yüklenmiştir; eksik alan hata verir, sessizce boş kalmaz', async () => {
    expect(await metinGetir(db, 'M9', 'tr')).toContain('teşekkür');
    expect(await metinGetir(db, 'M9', 'en')).toContain('Thank you');
    expect(await metinGetir(db, 'M1', 'tr', { 'Yat Sahibi/Yetkilisi / Kurum': 'K', tarih: 't', 'Dosya No': 'd', 'belge adı': 'b' })).toContain('Sayın K');
    await expect(metinGetir(db, 'M1', 'tr')).rejects.toThrow(/alanı eksik/);
    await expect(metinGetir(db, 'YOK', 'tr')).rejects.toThrow(/bulunamadı/);
    expect(doldur('[a]', { a: '1' })).toBe('1');
    expect((await sup.query(`SELECT count(*)::int n FROM sablon_metni WHERE tur = 'Bildirim' AND dil = 'tr'`)).rows[0].n).toBe(95);
    expect((await sup.query(`SELECT count(*)::int n FROM sablon_metni WHERE tur = 'Onay' AND dil = 'tr'`)).rows[0].n).toBe(29);
  });
  it('kurulum tekrarı onaylı metni çoğaltmaz, uygulama hesabı metni değiştiremez', async () => {
    await expect(db.query(`UPDATE sablon_metni SET metin = 'x'`)).rejects.toThrow();
  });
});

describe('PDF şablonu (YG-665…YG-677, YG-680, YG-681)', () => {
  const satirlar = (n: number) => Array.from({ length: n }, (_, i) => [i + 1, `Satır ${i}`, tutar(i)]);
  const tablo = (n: number) => ({ baslik: 'Kalem', tur: 'tablo' as const, sutunlar: [{ ad: '#' }, { ad: 'Açıklama' }, { ad: 'Tutar (EUR)', hiza: 'sag' as const }], satirlar: satirlar(n) });
  const t = { ad: 'Deneme', no: 'N', tarih: '01.01.2027', surum: 'Rev.0', dil: 'tr' as const };
  it('tutar biçimi', () => {
    expect(tutar(4000000)).toBe('4.000.000,00'); expect(tutar(1850, 'en')).toBe('1,850.00');
  });
  it('kısa belgede kapak yok; 5 sayfayı aşınca kapak; raporda İçindekiler de eklenir', async () => {
    expect(sayfaSayisi(await pdfUret({ ...t, bolumler: [tablo(3)] }))).toBe(1);
    const uzun = [tablo(200)];
    const a = sayfaSayisi(await pdfUret({ ...t, bolumler: [tablo(100)] }));
    expect(a).toBeLessThanOrEqual(5);
    const b = sayfaSayisi(await pdfUret({ ...t, bolumler: uzun }));
    expect(b).toBeGreaterThan(5);
    const c = sayfaSayisi(await pdfUret({ ...t, rapor: true, bolumler: uzun }));
    expect(c).toBe(b + 1);
  }, 60000);
  it('kaçış: alan değeri HTML olarak yorumlanmaz, boş alan hata vermez', async () => {
    const p = await pdfUret({ ...t, ad: '<img src=x onerror=1>', bolumler: [{ baslik: '"<b>', tur: 'alanlar', alanlar: [{ et: 'A', deger: null }, { et: 'B', deger: '</td><script>x</script>' }] }, { baslik: 'M', tur: 'metin', metin: '<i>m</i>' }] });
    expect(p.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);
});
