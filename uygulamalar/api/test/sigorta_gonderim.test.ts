import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disGonder } from '../src/bildirim.js';
import { sigortayaHazirla } from '../src/sigorta_gonderim.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ic: 'İç Denetçi' };
let o: Ortam; const EP = 'hasar@sigorta.deneme.local';
const dosya = async () => { await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE bitis_zamani IS NULL`); const d = await o.dosyaAc({ sigortaci: 'SG', hasarNo: 'H1' }, { musteriTuru: 'Sigorta Şirketi' }); await o.ekipKur(d.kimlik); const t = (await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, eposta) VALUES ($1,'Sigorta Şirketi','SG',$2) RETURNING kimlik`, [d.kimlik, EP])).rows[0]; await o.sup.query(`UPDATE dosya_sigorta_kaydi SET sigorta_taraf_ref = $2 WHERE dosya_ref = $1`, [d.kimlik, t.kimlik]); return d; };
const hazir = async (id: string, nesne = `N${Math.random()}`, sorumlu?: string) => sigortayaHazirla(o.db, { dosya: id, tur: 'BLD-45', nesne, alici: EP, konu: 'Konu', metin: 'Metin', sorumlu });
const teyit = async (id: string, adim: number, k = 'ds') => o.ist('POST', `/api/sigorta-gonderim/${id}/teyit`, await o.gir(k), { adim });
const giden = async (id: string) => (await o.sup.query(`SELECT count(*)::int n FROM gonderim WHERE olay_anahtari = $1`, [`sigorta:${id}`])).rows[0].n as number;

beforeAll(async () => { o = await ortamKur('yatonet360_test19', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('ikili teyit (K-241)', () => {
  it('hazırlık ve birinci teyit göndermez; ikinci teyit gönderir, tek sefer', async () => {
    const d = await dosya(); const id = await hazir(d.kimlik);
    expect(await giden(id)).toBe(0);
    expect(await o.kart('Sigortaya Gönderim Teyidi', id)).toBeDefined();
    expect((await teyit(id, 2)).json().hata).toContain('birinci teyit');
    const a = await teyit(id, 1);
    expect(a.json()).toMatchObject({ durum: 'Birinci Teyit', alici: EP, metin: 'Metin' });
    expect(await giden(id)).toBe(0);
    expect((await teyit(id, 2)).json().durum).toBe('Gönderildi');
    expect(await giden(id)).toBe(1);
    expect((await teyit(id, 2)).statusCode).toBe(409);
    expect((await o.kart('Sigortaya Gönderim Teyidi', id)).durum).toBe('Tamamlandı');
  });
  it('yetkisiz kişi teyit edemez; atanmış gönderenden başkası veremez; aynı nesne ikinci kayıt açmaz', async () => {
    const d = await dosya(); const n = `T${Math.random()}`; const id = await hazir(d.kimlik, n, o.K.tu);
    expect(await hazir(d.kimlik, n, o.K.tu)).toBe(id);
    expect((await teyit(id, 1, 'ds')).statusCode).toBe(404);
    expect((await teyit(id, 1, 'tu')).statusCode).toBe(200);
    expect((await teyit(id, 2, 'ic')).statusCode).toBe(404);
    expect((await teyit(id, 2, 'tu')).statusCode).toBe(200);
  });
  it('otomatik iletide yedek sorumlu birinci teyidi verse ikinciyi Dosya Sorumlusu veremez', async () => {
    const d = await dosya(); await o.sup.query(`UPDATE dosya SET yedek_sorumlu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.oy]); const id = await hazir(d.kimlik);
    expect((await teyit(id, 1, 'oy')).statusCode).toBe(200);
    expect((await teyit(id, 2, 'ds')).statusCode).toBe(403);
    expect((await teyit(id, 2, 'oy')).statusCode).toBe(200);
  });
  it('iki teyit arası bekleme; iptal gerekçeli, göndermez', async () => {
    const d = await dosya(); const id = await hazir(d.kimlik);
    await o.sup.query(`UPDATE sistem_parametresi SET deger = 2 WHERE kod = 'sigorta_teyit_bekleme_sn'`);
    await teyit(id, 1);
    expect((await teyit(id, 2)).statusCode).toBe(409);
    await o.sup.query(`UPDATE sistem_parametresi SET deger = 0 WHERE kod = 'sigorta_teyit_bekleme_sn'`);
    expect((await o.ist('POST', `/api/sigorta-gonderim/${id}/iptal`, await o.gir('ds'), {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/sigorta-gonderim/${id}/iptal`, await o.gir('ds'), { gerekce: 'Yanlış' })).json().durum).toBe('İptal');
    expect((await teyit(id, 2)).statusCode).toBe(409);
    expect(await giden(id)).toBe(0);
  });
  it('liste yalnız yetkiliye gelir', async () => {
    const d = await dosya(); await hazir(d.kimlik);
    expect(((await o.ist('GET', `/api/sigorta-gonderim?dosya=${d.kimlik}`, await o.gir('ds'))).json() as { tur: string }[]).filter((x) => x.tur !== 'BLD-68')).toHaveLength(1); /* BLD-68 dosya açılış bildirimi ayrıca listelenir (YG-1445) */
    expect((await o.ist('GET', `/api/sigorta-gonderim?dosya=${d.kimlik}`, await o.gir('ic'))).json()).toHaveLength(0);
  });
});
describe('kaçak gönderim engeli', () => {
  it('sigorta adresine doğrudan gönderim hata verir', async () => {
    await dosya();
    await expect(disGonder(o.db, { olay: `k${Math.random()}`, eposta: EP.toUpperCase(), konu: 'K', metin: 'M' })).rejects.toThrow('ikili teyit');
    expect(await disGonder(o.db, { olay: `k${Math.random()}`, eposta: 'baska@deneme.local', konu: 'K', metin: 'M' })).toBe(true);
  });
  it('sigorta adresine belge paylaşımı bağlantıyı ikinci teyitten sonra üretir', async () => {
    const d = await dosya(); const b = await o.belge(d.kimlik, 'ds'); const c = await o.gir('ds');
    const r = await o.ist('POST', `/api/belge/${b}/surum/1/paylas`, c, { alici: EP });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().baglanti).toBeUndefined();
    const id = r.json().gonderim as string;
    expect((await o.sup.query(`SELECT count(*)::int n FROM paylasim_baglantisi WHERE lower(alici_eposta) = $1`, [EP])).rows[0].n).toBe(0);
    await teyit(id, 1);
    const son = await teyit(id, 2);
    expect(son.json().baglanti).toContain('#paylasim=');
    expect((await o.ist('POST', `/api/belge/${b}/surum/1/paylas`, c, { alici: 'baska@deneme.local' })).statusCode).toBe(409); // YG-1171
    await o.sup.query(`INSERT INTO hasar_paylasim_talebi (dosya_ref, alici, kapsam, talep_eden_ref, durum) SELECT bag_kimligi::uuid, 'baska@deneme.local', 'K', olusturan_ref, 'Onaylandı' FROM belge WHERE kimlik = $1`, [b]);
    expect((await o.ist('POST', `/api/belge/${b}/surum/1/paylas`, c, { alici: 'baska@deneme.local' })).json().baglanti).toContain('#paylasim=');
  });
  it('kaynak kodda BLD-71, 45, 72 doğrudan disGonder ile gönderilmez', () => {
    for (const f of readdirSync('src')) { const t = readFileSync(`src/${f}`, 'utf8'); expect(/disGonder\([^\n]*(bld71|bld45|bld72)/.test(t), f).toBe(false); }
  });
});
