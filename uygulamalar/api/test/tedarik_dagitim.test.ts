import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dagitimaAc } from '../src/tedarik_dagitim.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', tu: 'Teknik Uzman', tyo: 'Tedarik Yöneticisi', tso: 'Tedarik Sorumlusu', tmy: 'Tedarik Müdür Yardımcısı' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test120', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('Talep Dağıtımı (YG-1592, YG-1593)', () => {
  it('onaylı malzeme talebi Tedarik Yöneticisine süreli görev açar; atama ve iade (T-YG1592)', async () => {
    const d = await o.dosyaAc(); await o.sup.query(`UPDATE dosya SET oncelik = 'Kritik' WHERE kimlik = $1`, [d.kimlik]);
    const yeni = async (n: string) => (await o.sup.query(`INSERT INTO form_kaydi (kayit_no, form_kodu, form_surumu, dosya_ref, hazirlayan_ref, durum, onay_zamani) VALUES ($1,'FR-MLZ-001',1,$2,$3,'Onaylı',now()) RETURNING kimlik`, [`${d.dosyaNo}-MT${n}`, d.kimlik, o.K.tu])).rows[0].kimlik as string;
    const f1 = await yeni('01'); const f2 = await yeni('02');
    const t0 = new Date(); await dagitimaAc(o.db, f1, t0); await dagitimaAc(o.db, f1, t0);
    const k = (await o.sup.query(`SELECT count(*)::int n, max(son_zaman) s FROM is_karti WHERE tur = 'Talep Dağıtımı' AND nesne_kimligi = $1`, [f1])).rows[0];
    expect(k.n).toBe(1); expect(Math.round((new Date(k.s).getTime() - t0.getTime()) / 3_600_000)).toBe(2);
    const v = (await o.ist('GET', '/api/tedarik-pano', await o.gir('tyo'))).json();
    expect(v.bekleyen.map((x: { kimlik: string }) => x.kimlik)).toEqual(expect.arrayContaining([f1, f2]));
    expect((await o.ist('GET', '/api/tedarik-pano', await o.gir('tmy'))).json().dagitir).toBe(false);
    expect((await o.ist('POST', `/api/tedarik/dagitim/${f1}`, await o.gir('tmy'), { sorumlu: o.K.tso })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/tedarik/dagitim/${f1}`, await o.gir('tyo'), { sorumlu: o.K.tso })).statusCode).toBe(200);
    expect(await o.kart('Malzeme Talebi', f1)).toBeDefined();
    expect((await o.ist('POST', `/api/tedarik/dagitim/${f2}`, await o.gir('tyo'), { iadeGerekcesi: 'Teknik şart eksik' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, iade_nedeni FROM form_kaydi WHERE kimlik = $1`, [f2])).rows[0]).toEqual({ durum: 'Açık', iade_nedeni: 'Teknik şart eksik' });
    expect((await o.ist('GET', '/api/tedarik-pano', await o.gir('ds'))).statusCode).toBe(404);
  });
});
