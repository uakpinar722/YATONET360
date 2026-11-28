import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rolId } from '../src/ihbar.js';
import { ortamKur, type Ortam } from './yardimci.js';

// YG-1583, YG-1587: Müdür Yardımcısının Atama sayfası yalnız vekâlette görünür; YATONET önerisi ve yük ile, kabul adımı olmadan atanır.
const KADRO = { ds: 'Dosya Sorumlusu', ds2: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', omy: 'Operasyon Müdür Yardımcısı', tm: 'Teknik Müdür', tmy: 'Teknik Müdür Yardımcısı', tu: 'Teknik Uzman', ty: 'Teknik Yönetici' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test_atama_sayfasi', KADRO); });
afterAll(async () => { await o.kapat(); });

const vekalet = async (no: string, asil: string, vekil: string, rol: string) => o.sup.query(`INSERT INTO vekalet (kimlik, asil_ref, vekil_ref, rol_ref, vekalet_nedeni, kapsam, baslangic_tarihi, bitis_tarihi, atayan_ref) VALUES ($1,$2,$3,$4,'İzin','Açık işler',current_date,current_date + 3,$2)`, [no, o.K[asil], o.K[vekil], await rolId(o.sup as never, rol)]);

describe('Atama sayfası (YG-1583, YG-1587)', () => {
  it('vekâlet yokken Müdür Yardımcısına atama kuyruğu gösterilmez', async () => {
    expect((await o.ist('GET', '/api/atama-sayfasi', await o.gir('omy'))).json()).toEqual({});
    expect((await o.ist('GET', '/api/operasyon-pano', await o.gir('omy'))).json().kuyruk).toBeUndefined();
    expect((await o.ist('GET', '/api/teknik-pano', await o.gir('tmy'))).json().kuyruk).toBeUndefined();
    expect((await o.ist('GET', '/api/operasyon-pano', await o.gir('opm'))).json().kuyruk).toBeDefined(); // asıl Müdür panoda görür
  });
  it('Operasyon Müdürü vekâletinde Dosya Sorumlusu önerisiyle atanır; Teknik Müdür vekâletinde teknik roller', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref = $1`, [d.kimlik]);
    await o.sup.query(`UPDATE dosya SET statu = 'Açılış Kontrolünde', dosya_sorumlusu_ref = NULL WHERE kimlik = $1`, [d.kimlik]);
    await vekalet('VKL-2026-9583', 'opm', 'omy', 'Operasyon Müdürü');
    const omy = await o.gir('omy');
    const v = (await o.ist('GET', '/api/atama-sayfasi', omy)).json();
    expect(v.teknik).toBeUndefined();
    const k = v.operasyon.kuyruk.find((x: { kimlik: string }) => x.kimlik === d.kimlik);
    expect(k.eksik).toEqual(['Dosya Sorumlusu']);
    expect(v.operasyon.ekip['Dosya Sorumlusu'].map((x: { ust: number }) => x.ust)).toEqual([25, 25]);
    const oneri = k.oneri['Dosya Sorumlusu']; expect([o.K.ds, o.K.ds2]).toContain(oneri);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/ekip`, omy, { kullanici: oneri, rol: 'Dosya Sorumlusu', talimat: 'Yat sahibini bugün arayınız.' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT ozet FROM bildirim WHERE kullanici_ref = $1 AND baslik = $2`, [oneri, `Dosyaya Atandınız: ${d.dosyaNo}`])).rows[0].ozet).toBe('Dosya Sorumlusu · Talimat: Yat sahibini bugün arayınız.');
    expect((await o.ist('GET', '/api/atama-sayfasi', omy)).json().operasyon.kuyruk.some((x: { kimlik: string }) => x.kimlik === d.kimlik)).toBe(false);
    await vekalet('VKL-2026-9587', 'tm', 'tmy', 'Teknik Müdür');
    const t = (await o.ist('GET', '/api/atama-sayfasi', await o.gir('tmy'))).json();
    expect(t.operasyon).toBeUndefined();
    const tk = t.teknik.kuyruk.find((x: { kimlik: string }) => x.kimlik === d.kimlik);
    expect(tk.eksik).toEqual(['Teknik Uzman', 'Teknik Yönetici']);
    expect(tk.oneri).toEqual({ 'Teknik Uzman': o.K.tu, 'Teknik Yönetici': o.K.ty });
    expect(Object.keys(t.teknik.ekip)).toEqual(['Teknik Uzman', 'Teknik Yönetici', 'Saha Sorumlusu']);
  });
});
