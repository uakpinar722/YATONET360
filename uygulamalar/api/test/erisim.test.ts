import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { denemeHesaplari, kurVeritabani } from '../araclar/kurulum.js';
import { COOKIE_ADI, ortamOku } from '../src/ayarlar.js';
import { onayMakami } from '../src/erisim.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { DenemeKutusu } from '../src/sms.js';
import { sunucuKur } from '../src/sunucu.js';

const VT = 'yatonet360_test5'; const PAROLA = 'Sinama-Parolasi-2026!';
const CEO = 'ceo@deneme.yatonet.local', SIS = 'sistem@deneme.yatonet.local', DEN = 'denetci@deneme.yatonet.local', YAT = 'yatsahibi@deneme.yatonet.local', BIM = 'bimuduru@deneme.yatonet.local';
let s: FastifyInstance; let sup: pg.Client; let db: pg.Pool; const sms = new DenemeKutusu(null);
const H = { 'x-yatonet': '1' };
const cerez = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const ist = (m: 'GET' | 'POST', url: string, c: string, payload?: object) => s.inject({ method: m, url, headers: H, cookies: { [COOKIE_ADI]: c }, payload });
const K: Record<string, string> = {};
let RD = '', RS = '';
const gelecek = '2030-01-15';

async function gir(ep: string) {
  await sup.query(`UPDATE kullanici_hesabi SET totp_gizli_sifreli = NULL, totp_son_adim = 0 WHERE e_posta = $1`, [ep]);
  const g = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: ep, parola: PAROLA } });
  const c = cerez(g);
  if (g.json().yontem === 'sms') { await ist('POST', '/api/kimlik/sms', c); return cerez(await ist('POST', '/api/kimlik/dogrula', c, { kod: sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0] })); }
  const q = await ist('GET', '/api/kimlik/kurulum', c);
  return cerez(await ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
}
const talep = async (c: string, kullanici = K[DEN]!, rol = RD) => ist('POST', '/api/erisim/talep', c, { kullanici, rol, gerekce: 'Destek görevi', kapsam: 'Bilgi İşlem Destek', sureSonu: gelecek });
const kartBul = async (id: string) => (await sup.query(`SELECT is_karti_ref k FROM erisim_talebi WHERE kimlik = $1`, [id])).rows[0].k as string;

beforeAll(async () => {
  const e = ortamOku();
  const a = new pg.Client({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'postgres' });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${VT} WITH (FORCE)`); await a.end();
  sup = await kurVeritabani(VT, { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: false });
  await denemeHesaplari(sup, null);
  await sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $1, izin_adimi_zamani = now()`, [await parolaOzetle(PAROLA)]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) SELECT kimlik, 'Çalışan', CASE WHEN kullanici_grubu = 'LGM İç Rolü' THEN 'KVKK-05' ELSE 'KVKK-01' END, 'R00', 'Türkçe', 'Web' FROM kullanici_hesabi`);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) SELECT kimlik, 'R00', 'Türkçe' FROM kullanici_hesabi`);
  for (const ep of [CEO, SIS, DEN, YAT, BIM]) K[ep] = (await sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rows[0].kimlik;
  RD = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Bilgi İşlem Destek Sorumlusu'`)).rows[0].kimlik;
  RS = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Sistem Yöneticisi'`)).rows[0].kimlik;
  db = new pg.Pool({ host: 'localhost', user: 'yatonet_uygulama', password: e.YATONET_DB_PAROLA, database: VT });
  s = await sunucuKur({ db, sms, eposta: new DenemeKutusu(null), anahtar: 'bb'.repeat(32), guvenliCerez: false, webAdresi: 'http://x' });
});
afterAll(async () => { await s.close(); await db.end(); await sup.end(); });

describe('erişim talebi uçtan uca', () => {
  it('talep → birim Müdürü onayı → Sistem Yöneticisi 24 saatte uygular → yetki doğrulanır', async () => {
    const ceo = await gir(CEO), bim = await gir(BIM), sis = await gir(SIS), den = await gir(DEN);
    const t = await talep(ceo);
    expect(t.statusCode).toBe(200);
    const id = t.json().kimlik as string;
    expect(id).toMatch(/^ERS-\d{4}-0001$/);
    const bb = (await ist('GET', '/api/bugun', bim)).json();
    const kart = bb.onay.find((k: any) => k.tur === 'Erişim Talebi');
    expect(kart.ozet).toContain('Bilgi İşlem Destek Sorumlusu');
    // Onaylanmadan uygulanamaz
    expect((await ist('POST', `/api/erisim/${id}/uygula`, sis)).statusCode).toBe(409);
    expect((await ist('POST', `/api/is/${kart.kimlik}/karar`, bim, { karar: 'Onayla' })).statusCode).toBe(200);
    const sb = (await ist('GET', '/api/bugun', sis)).json();
    const is = sb.islem.find((k: any) => k.tur === 'Erişim Talebi Uygulama');
    expect(is.baslik).toContain(id);
    const saat = (new Date(is.son_zaman).getTime() - Date.now()) / 3_600_000;
    expect(saat).toBeGreaterThan(23); expect(saat).toBeLessThanOrEqual(24);
    expect((await ist('GET', '/api/erisim/uygulanacak', sis)).json().map((x: any) => x.kimlik)).toContain(id);
    const u = await ist('POST', `/api/erisim/${id}/uygula`, sis);
    expect(u.json().izinDogrulandi).toBe(true);
    const r = (await sup.query(`SELECT bitis_tarihi::text b, atayan_ref a, onaylayan_ref o, izin_dogrulandi d FROM rol_atamasi WHERE erisim_talebi_ref = $1`, [id])).rows[0];
    expect(r).toEqual({ b: gelecek, a: K[SIS], o: K[BIM], d: true });
    expect((await ist('GET', '/api/ben', den)).statusCode).toBe(401); // açık oturum yetki değişiminde düşer
    const yeni = await s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: DEN, parola: PAROLA } });
    expect(yeni.statusCode).toBe(200);
    expect((await ist('POST', `/api/erisim/${id}/uygula`, sis)).statusCode).toBe(409);
    expect((await ist('GET', '/api/bugun', sis)).json().islem.map((k: any) => k.tur)).not.toContain('Erişim Talebi Uygulama');
    const b = (await ist('GET', '/api/bildirimler', ceo)).json();
    expect(b[0].baslik).toContain(id);
    expect((await ist('GET', '/api/erisim/taleplerim', ceo)).json()[0].talep_asamasi).toBe('Bildirim');
  });
  it('red ve iade talebin aşamasına işlenir; reddedilen uygulanamaz', async () => {
    const ceo = await gir(CEO), bim = await gir(BIM), sis = await gir(SIS);
    const id = (await talep(ceo)).json().kimlik;
    const k = await kartBul(id);
    await ist('POST', `/api/is/${k}/karar`, bim, { karar: 'Gerekçeyle İade Et', gerekce: 'Kapsam eksik' });
    expect((await sup.query(`SELECT talep_asamasi a FROM erisim_talebi WHERE kimlik = $1`, [id])).rows[0].a).toBe('İade Edildi');
    await ist('POST', `/api/is/${k}/karar`, ceo, { karar: 'Yeniden Gönder' });
    await ist('POST', `/api/is/${k}/karar`, bim, { karar: 'Reddet', gerekce: 'Gerek yok' });
    expect((await sup.query(`SELECT talep_asamasi a FROM erisim_talebi WHERE kimlik = $1`, [id])).rows[0].a).toBe('Reddedildi');
    expect((await ist('POST', `/api/erisim/${id}/uygula`, sis)).statusCode).toBe(409);
  });
});

describe('görev ayrılığı (YG-1008)', () => {
  it('Sistem Yöneticisi kendi hesabına yetki tanımlayamaz', async () => {
    const ceo = await gir(CEO), bim = await gir(BIM), sis = await gir(SIS);
    const id = (await talep(ceo, K[SIS]!)).json().kimlik;
    await ist('POST', `/api/is/${await kartBul(id)}/karar`, bim, { karar: 'Onayla' });
    const u = await ist('POST', `/api/erisim/${id}/uygula`, sis);
    expect(u.statusCode).toBe(403); expect(u.json().hata).toMatch(/Kendi hesabınıza/);
  });
  it('talebi açan Sistem Yöneticisi uygulayamaz', async () => {
    const bim = await gir(BIM), sis = await gir(SIS);
    const id = (await talep(sis)).json().kimlik;
    await ist('POST', `/api/is/${await kartBul(id)}/karar`, bim, { karar: 'Onayla' });
    expect((await ist('POST', `/api/erisim/${id}/uygula`, sis)).statusCode).toBe(403);
  });
  it('talep eden kendi talebini onaylayamaz', async () => {
    const bim = await gir(BIM);
    const id = (await talep(bim)).json().kimlik;
    expect((await ist('POST', `/api/is/${await kartBul(id)}/karar`, bim, { karar: 'Onayla' })).statusCode).toBe(403);
  });
  it('yetkisiz uygulayamaz ve listeyi göremez', async () => {
    const ceo = await gir(CEO);
    expect((await ist('GET', '/api/erisim/uygulanacak', ceo)).statusCode).toBe(403);
    expect((await ist('POST', '/api/erisim/ERS-2026-0001/uygula', ceo)).statusCode).toBe(403);
  });
});

describe('form kuralları (YG-1005, YG-1040)', () => {
  it('eksik alan, geçmiş tarih ve katalog dışı rol reddedilir', async () => {
    const ceo = await gir(CEO);
    const f = (b: object) => ist('POST', '/api/erisim/talep', ceo, b);
    const tam = { kullanici: K[DEN], rol: RD, gerekce: 'g', kapsam: 'k', sureSonu: gelecek };
    expect((await f({ ...tam, gerekce: '  ' })).statusCode).toBe(400);
    expect((await f({ ...tam, kapsam: '' })).statusCode).toBe(400);
    expect((await f({ ...tam, sureSonu: '2020-01-01' })).statusCode).toBe(400);
    expect((await f({ ...tam, rol: 'ROL-999' })).statusCode).toBe(400);
    expect((await f({ ...tam, kullanici: K[YAT] })).statusCode).toBe(400);
    const dis = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Firma Yetkilisi'`)).rows[0].kimlik;
    expect((await f({ ...tam, rol: dis })).statusCode).toBe(400);
  });
  it('dış kullanıcı talep açamaz, seçenekleri göremez', async () => {
    const y = await gir(YAT);
    expect((await ist('GET', '/api/erisim/secenekler', y)).statusCode).toBe(403);
    expect((await talep(y)).statusCode).toBe(403);
  });
  it('numara yıl içinde sıralı artar', async () => {
    const ceo = await gir(CEO);
    const a = (await talep(ceo)).json().kimlik as string, b = (await talep(ceo)).json().kimlik as string;
    expect(Number(b.slice(-4))).toBe(Number(a.slice(-4)) + 1);
  });
});

describe('onay makamı', () => {
  const rol = async (ad: string) => (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
  const adi = async (id: string) => (await sup.query(`SELECT rol_adi FROM rol WHERE kimlik = $1`, [id])).rows[0].rol_adi as string;
  it.each([
    ['Sistem Yöneticisi', 'Bilgi İşlem Müdürü'],
    ['Teknik Uzman', 'Teknik Müdür'],
    ['Hukuk ve Uyum Uzmanı', 'Hukuk ve Uyum Direktörü'],
    ['Bilgi İşlem Müdürü', 'Genel Müdür Yardımcısı'],
    ['Teknik ve Operasyon Direktörü', 'CEO'],
    ['Genel Müdür Yardımcısı', 'CEO'],
  ])('%s → %s', async (r, m) => { expect(await adi(await onayMakami(db, await rol(r)))).toBe(m); });
});
