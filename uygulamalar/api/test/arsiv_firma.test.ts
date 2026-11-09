import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imhaDonemi } from '../src/arsiv_firma.js';
import { imhaListesiUret } from '../src/kvkk.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', ds2: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', gmy: 'Genel Müdür Yardımcısı' };
let o: Ortam; let say = 0;
beforeAll(async () => { o = await ortamKur('yatonet360_test78', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const firma = async (asama: string) => (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ($1,$2,'Çözüm Ortağı',$3,$4,$5) RETURNING kimlik`, [`S-A${++say}`, `F${say}`, asama, asama === 'Aday' ? 'Pasif' : 'Aktif', o.K.ds])).rows[0].kimlik as string;

describe('arşiv devri (YG-1235, YG-1236)', () => {
  it('yalnız Kapalı dosya; olağan listeden çıkar; arşiv listesinde erişimi olan görür; imha dönemi hesaplanır', async () => {
    expect(imhaDonemi(new Date('2031-01-10'))).toBe('2031 Ocak'); expect(imhaDonemi(new Date('2031-03-10'))).toBe('2031 Temmuz'); expect(imhaDonemi(new Date('2031-09-10'))).toBe('2032 Ocak');
    const d = (await o.dosyaAc({}, {})).kimlik as string; await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d, o.K.ds]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d, o.K.ds, o.K.opm]);
    const ds = await o.gir('ds'); const u = `/api/dosya/${d}/arsivle`; const var_ = async (c: string, q: string) => (await o.ist('GET', `/api/dosya${q}`, c)).json().some((x: { kimlik: string }) => x.kimlik === d);
    expect((await o.ist('POST', u, ds, {})).statusCode).toBe(409);
    await o.sup.query(`UPDATE dosya SET statu = 'Kapalı', kapanma_nedeni = 'Tamamlandı', kapanis_zamani = '2026-03-01', teslim_tarihi = '2026-02-01' WHERE kimlik = $1`, [d]);
    expect((await o.ist('POST', u, await o.gir('ds2'), {})).statusCode).toBe(404); expect(await var_(ds, '')).toBe(true);
    expect((await o.ist('POST', u, ds, {})).statusCode).toBe(200); expect((await o.ist('POST', u, ds, {})).statusCode).toBe(409);
    expect(await var_(ds, '')).toBe(false); expect(await var_(ds, '?arsiv=1')).toBe(true); expect(await var_(await o.gir('ds2'), '?arsiv=1')).toBe(false);
    expect((await o.sup.query(`SELECT saklama_grubu, imha_donemi, garanti_bitis::text g FROM dosya_arsiv_devri WHERE dosya_ref = $1`, [d])).rows[0]).toEqual({ saklama_grubu: 'OPS-5', imha_donemi: '2031 Temmuz', g: '2027-02-01' });
  });
});

describe('aday firma ve poliçe limiti (YG-1229, YG-343)', () => {
  it('ilk temasta aydınlatma; temas edilen aday 1 yıl sonra imha listesine girer, temas edilmemiş kalır', async () => {
    const a = await firma('Aday'); const h = await firma('Aday'); const b = await firma('Onaylı'); const sc = await o.gir('sc'); const u = (x: string) => `/api/firma/${x}/aday-temas`;
    expect((await o.ist('POST', u(a), sc, {})).statusCode).toBe(400); expect((await o.ist('POST', u(a), sc, { aydinlatma: true })).statusCode).toBe(200); expect((await o.ist('POST', u(a), sc, {})).statusCode).toBe(200); expect((await o.ist('POST', u(b), sc, { aydinlatma: true })).statusCode).toBe(409);
    await o.sup.query(`UPDATE kurulus SET son_temas_tarihi = '2025-01-01' WHERE kimlik = $1`, [a]);
    const l = await imhaListesiUret(o.db, new Date('2026-07-02T09:00:00Z')); expect(l).toBeTruthy();
    const k = (await o.sup.query(`SELECT nesne_kimligi FROM imha_kalemi WHERE liste_ref = $1 AND nesne_turu = 'Kuruluş'`, [l])).rows.map((r) => r.nesne_kimligi); expect(k).toContain(a); expect(k).not.toContain(h);
  });
  it('branş asgari limiti poliçe listesinde esas alınır', async () => {
    const f = await firma('Onaylı'); await o.sup.query(`INSERT INTO brans_yetkinligi (kurulus_ref, ana_brans, kapsama, bolge) VALUES ($1,'Elektrik','Bölge','X')`, [f]).catch(async () => { throw new Error('brans'); });
    const sc = await o.gir('sc'); await o.ist('POST', `/api/firma/${f}/belge`, sc, { tur: 'Gözetimdeki Yat Sigortası', bitis: '2099-01-01', policeLimit: 1500000, gozetim: true });
    const fym = await o.gir('fym'); const dur = async () => (await o.ist('GET', '/api/firma/police-listesi', fym)).json().find((x: { kimlik: string }) => x.kimlik === f).durum;
    expect(await dur()).toBe('Uygun');
    expect((await o.ist('POST', '/api/firma/police-brans-limit', sc, { brans: 'Elektrik', limit: 2000000 })).statusCode).toBe(404); expect((await o.ist('POST', '/api/firma/police-brans-limit', fym, { brans: '', limit: 1 })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/firma/police-brans-limit', fym, { brans: 'Elektrik', limit: 2000000 })).statusCode).toBe(200); expect(await dur()).toBe('Düşük');
  });
});
