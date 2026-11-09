import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disHesapPasifIsle, erisimEskalasyon, erisimIncelemeAc } from '../src/erisim_inceleme.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', ds2: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', btm: 'Bilgi İşlem Müdürü', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', gmy: 'Genel Müdür Yardımcısı', cg: 'CEO', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü', ide: 'İç Denetçi', idm: 'İç Denetim Müdürü', rkd: 'Risk ve Kalite Direktörü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test82', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('erişim incelemesi (YG-1044–1047, YG-1639, YG-1644)', () => {
  it('altı ayda bir birim müdürüne düşer; karar uygulanır; kendi kaydına karar verilemez; yanıtsız kalan yükselir ve askıya alınır', async () => {
    const S = new Date('2026-07-02T09:00:00Z'); await erisimIncelemeAc(o.db, S); const op = await o.gir('opm');
    const l = (await o.ist('GET', '/api/erisim-inceleme', op)).json() as { kimlik: string; kalemler: { kimlik: string; ad_soyad: string; rol_adi: string }[] }[]; expect(l.length).toBe(1);
    const k = l[0]!.kalemler.filter((x) => x.rol_adi === 'Dosya Sorumlusu'); expect(k.length).toBe(2); const kendi = l[0]!.kalemler.find((x) => x.rol_adi === 'Operasyon Müdürü')!;
    const u = (x: string) => `/api/erisim-inceleme/kalem/${x}`;
    expect((await o.ist('POST', u(k[0]!.kimlik), await o.gir('btm'), { karar: 'Koru' })).statusCode).toBe(404);
    expect((await o.ist('POST', u(kendi.kimlik), op, { karar: 'Koru' })).statusCode).toBe(403);
    expect((await o.ist('POST', u(k[0]!.kimlik), op, { karar: 'Askıya Al' })).statusCode).toBe(400);
    expect((await o.ist('POST', u(k[0]!.kimlik), op, { karar: 'Askıya Al', gerekce: 'Görev değişti' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT atama_durumu d FROM rol_atamasi a JOIN erisim_inceleme_kalemi k ON k.atama_ref = a.kimlik WHERE k.kimlik = $1`, [k[0]!.kimlik])).rows[0].d).toBe('Askıda');
    await o.sup.query(`UPDATE erisim_inceleme_kalemi SET karar = 'Koru', karar_zamani = now() WHERE kimlik = $1`, [kendi.kimlik]); await o.sup.query(`UPDATE erisim_inceleme SET durum = 'Tamamlandı' WHERE kimlik <> $1`, [l[0]!.kimlik]);
    const e1 = new Date('2026-08-10T09:00:00Z'); expect(await erisimEskalasyon(o.db, e1)).toBeGreaterThan(0);
    const sonra = (await o.sup.query(`SELECT count(*)::int n FROM erisim_inceleme_kalemi k WHERE k.karar IS NULL AND k.inceleme_ref = (SELECT inceleme_ref FROM erisim_inceleme_kalemi WHERE kimlik = $1)`, [k[1]!.kimlik])).rows[0].n; expect(sonra).toBeGreaterThan(0);
    await erisimEskalasyon(o.db, new Date('2026-09-01T09:00:00Z'));
    expect((await o.sup.query(`SELECT karar, gerekce FROM erisim_inceleme_kalemi WHERE kimlik = $1`, [k[1]!.kimlik])).rows[0]).toMatchObject({ karar: 'Askıya Al' });
    await o.sup.query(`UPDATE rol_atamasi SET atama_durumu = 'Aktif' WHERE atama_durumu = 'Askıda'`);
  });
  it('dış hesap 90 günde askıya, 180 günde kapanır; askıya alma ayrı ve gerekçeli işlemdir', async () => {
    const yeni = async (ad: string, gun: number) => (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani, son_giris_zamani) VALUES ('Dış','İş Birliği Firması',$1,$2,$3,'x','Doğrulama uygulaması (6 haneli kod)',now(),now() - make_interval(days => $4)) RETURNING kimlik`, [ad, `${ad}@p.local`, `${ad}@p.local`, gun])).rows[0].kimlik as string;
    const a = await yeni('dis100', 100); const c = await yeni('dis200', 200); const t = await yeni('dis10', 10);
    await disHesapPasifIsle(o.db); const d = async (k: string) => (await o.sup.query(`SELECT hesap_durumu d FROM kullanici_hesabi WHERE kimlik = $1`, [k])).rows[0].d;
    expect(await d(a)).toBe('Askıda'); expect(await d(c)).toBe('Kapalı'); expect(await d(t)).toBe('Aktif');
    const btm = await o.gir('btm'); const U = `/api/guvenlik/hesap/${t}/askiya-al`; expect((await o.ist('POST', U, await o.gir('opm'), { gerekce: 'G' })).statusCode).toBe(404); expect((await o.ist('POST', U, btm, {})).statusCode).toBe(400); expect((await o.ist('POST', U, btm, { gerekce: 'Şüphe' })).statusCode).toBe(200); expect(await d(t)).toBe('Askıda');
    expect((await o.ist('POST', `/api/guvenlik/hesap/${c}/ac`, btm, { gerekce: 'G' })).statusCode).toBe(409);
  });
});

describe('etik bildirim (YG-585, YG-587, YG-1068)', () => {
  it('GMY görür ve yat sahibine bildirim kararını verir; sosyal medya MPİ Müdürüne gider', async () => {
    const ds = await o.gir('ds'); const n = (await o.ist('POST', '/api/etik-bildirim', ds, { kategori: 'Yönlendirme Komisyonu', aciklama: 'Kaptan komisyon istedi' })).json().no as string; expect(n).toMatch(/^ETK-/);
    expect((await o.ist('POST', '/api/etik-bildirim', ds, { kategori: 'X', aciklama: 'A' })).statusCode).toBe(400); expect((await o.ist('GET', '/api/etik-bildirim', ds)).statusCode).toBe(404);
    const gmy = await o.gir('gmy'); const e = (await o.ist('GET', '/api/etik-bildirim', gmy)).json().find((x: { bildirim_no: string }) => x.bildirim_no === n);
    expect((await o.ist('POST', `/api/etik-bildirim/${e.kimlik}/karar`, gmy, { sonuc: 'S' })).statusCode).toBe(400); expect((await o.ist('POST', `/api/etik-bildirim/${e.kimlik}/karar`, gmy, { sonuc: 'S', yatSahibi: 'Bildirilsin' })).statusCode).toBe(200);
    await o.ist('POST', '/api/etik-bildirim', ds, { kategori: 'Sosyal Medya', aciklama: 'Paylaşım' });
    expect((await o.ist('GET', '/api/etik-bildirim', await o.gir('mpm'))).json().some((x: { kategori: string }) => x.kategori === 'Sosyal Medya')).toBe(true);
    expect((await o.ist('GET', '/api/etik-bildirim', gmy)).json().some((x: { kategori: string }) => x.kategori === 'Sosyal Medya')).toBe(false);
  });
});

describe('iç denetim (YG-1673–1675, YG-1681, YG-1682)', () => {
  it('beyan zorunlu; zincir Müdür ve CEO; Müdür yürüttüyse doğrudan CEO; Risk Direktörü göremez', async () => {
    const ide = await o.gir('ide'); const G = { surec: 'Satın Alma', kapsam: 'K', cikarYok: true, sonOnIkiAyGorevYok: true };
    expect((await o.ist('POST', '/api/ic-denetim', ide, { ...G, cikarYok: false })).statusCode).toBe(400); expect((await o.ist('POST', '/api/ic-denetim', ide, { ...G, sonOnIkiAyGorevYok: false })).statusCode).toBe(409);
    const a = (await o.ist('POST', '/api/ic-denetim', ide, G)).json().kimlik as string;
    expect((await o.ist('POST', `/api/ic-denetim/${a}/bulgu`, ide, { sinif: 'X', tanim: 'T' })).statusCode).toBe(400); expect((await o.ist('POST', `/api/ic-denetim/${a}/bulgu`, ide, { sinif: 'Majör', tanim: 'T' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/ic-denetim/${a}/rapor`, ide, { ozet: 'Ö' })).statusCode).toBe(200);
    const z = async (k: string) => (await o.sup.query(`SELECT (SELECT array_agg(r.rol_adi ORDER BY u.n) FROM unnest(c.zincir) WITH ORDINALITY u(id, n) JOIN rol r ON r.kimlik = u.id) z FROM is_karti c WHERE tur = 'İç Denetim Raporu' AND nesne_kimligi = $1`, [k])).rows[0].z as string[];
    expect(await z(a)).toEqual(['İç Denetim Müdürü', 'CEO']);
    const idm = await o.gir('idm'); const b = (await o.ist('POST', '/api/ic-denetim', idm, G)).json().kimlik as string; expect((await o.ist('POST', `/api/ic-denetim/${b}/rapor`, idm, { ozet: 'Ö' })).statusCode).toBe(200); expect(await z(b)).toEqual(['CEO']);
    expect((await o.ist('GET', '/api/ic-denetim', await o.gir('rkd'))).statusCode).toBe(404); expect((await o.ist('GET', '/api/ic-denetim', await o.gir('gmy'))).statusCode).toBe(404);
    const k = (await o.kart('İç Denetim Raporu', a)).kimlik; expect((await o.karar(k, 'idm', 'Onaya Gönder')).statusCode).toBe(200); expect((await o.karar(k, 'cg', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM ic_denetim WHERE kimlik = $1`, [a])).rows[0].durum).toBe('Sonuçlandı');
  });
});
