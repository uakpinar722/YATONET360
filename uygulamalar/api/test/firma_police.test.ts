import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { policeGozdenGecirIsle } from '../src/firma_police.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', gmy: 'Genel Müdür Yardımcısı' };
let o: Ortam; let say = 0;
beforeAll(async () => { o = await ortamKur('yatonet360_test72', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const firma = async (asama = 'Onaylı') => (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ($1,$2,'Çözüm Ortağı',$3,'Aktif',$4) RETURNING kimlik`, [`S-P${++say}`, `F${say}`, asama, o.K.ds])).rows[0].kimlik as string;

describe('firma poliçe listesi (YG-1471)', () => {
  it('eksik, süresi dolan, düşük ve uygun ayrılır; tavsiye durumu değiştirmez; yalnız yetkililer görür', async () => {
    const [eksik, dolan, dusuk, uygun, aday] = [await firma(), await firma(), await firma(), await firma(), await firma('Aday')];
    const sc = await o.gir('sc'); const u = (id: string) => `/api/firma/${id}/belge`; const B = { tur: 'Sorumluluk Sigortası' };
    expect((await o.ist('POST', u(uygun), sc, { ...B, policeLimit: -1 })).statusCode).toBe(400);
    expect((await o.ist('POST', u(dolan), sc, { ...B, bitis: '2020-01-01', policeLimit: 2000000, gozetim: true })).statusCode).toBe(200);
    expect((await o.ist('POST', u(dusuk), sc, { ...B, bitis: '2099-01-01', policeLimit: 10, gozetim: true })).statusCode).toBe(200);
    expect((await o.ist('POST', u(uygun), sc, { ...B, bitis: '2099-01-01', policeLimit: 2000000 })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/firma/police-listesi', await o.gir('ds'))).statusCode).toBe(404);
    const l = (await o.ist('GET', '/api/firma/police-listesi', await o.gir('fym'))).json() as { kimlik: string; durum: string; tavsiye: boolean }[];
    const bul = (k: string) => l.find((x) => x.kimlik === k);
    expect(bul(eksik)?.durum).toBe('Eksik'); expect(bul(dolan)?.durum).toBe('Süresi Dolmuş'); expect(bul(dusuk)).toMatchObject({ durum: 'Düşük', tavsiye: false }); expect(bul(uygun)).toMatchObject({ durum: 'Uygun', tavsiye: true }); expect(bul(aday)).toBeUndefined();
  });
  it('çeyrekte bir görev açılır; silsile Müdür, Direktör, GMY; 10 iş günü süresi vardır', async () => {
    const S = new Date('2027-01-04T09:00:00Z');
    expect(await policeGozdenGecirIsle(o.db, S)).toBe(true); expect(await policeGozdenGecirIsle(o.db, S)).toBe(false);
    const k = (await o.sup.query(`SELECT son_zaman, kademe, (SELECT array_agg(r.rol_adi ORDER BY z.n) FROM unnest(c.zincir) WITH ORDINALITY z(id, n) JOIN rol r ON r.kimlik = z.id) roller FROM is_karti c WHERE tur = 'Firma Poliçe Gözden Geçirme' AND nesne_kimligi = '2027-1'`)).rows[0];
    expect(k.roller).toEqual(['Firma Yönetimi Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Genel Müdür Yardımcısı']); expect(new Date(k.son_zaman).getTime()).toBeGreaterThan(S.getTime());
  });
});
