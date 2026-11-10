import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test89', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('kritik bulgu bildirimi (YG-545)', () => {
  it('Kritik bulgu ekibe hemen bildirilir; alıcı ve bilgi kayda geçer; karar Dosya Sorumlusundan', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const tu = await o.gir('tu');
    const G = { konum: 'Sancak kıç omuzluk, su hattı altı', aciklama: 'Gövdede çatlak, su alıyor', etiket: 'Hasar', bilgiTuru: 'Doğrulanmış olgu', onem: 'Kritik', yonlendirme: 'Teklif', sorumlu: o.K.ds, hedefTarih: '2099-01-01' };
    const lst = async (k: string) => (await o.sup.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = $1 ORDER BY sira LIMIT 1`, [k])).rows[0].deger as string;
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/bulgu`, tu, { ...G, etiket: await lst('LST_BULGU_ETIKETI'), bilgiTuru: await lst('LST_BILGI_TURU'), yonlendirme: await lst('LST_BULGU_YONLENDIRME') }); expect(r.statusCode, r.body).toBe(200);
    const b = r.json().kimlik as string; const n = (await o.sup.query(`SELECT alicilar, bilgi FROM kritik_bulgu_bildirimi WHERE bulgu_ref = $1`, [b])).rows[0];
    expect(n.alicilar.sort()).toEqual([o.K.ds, o.K.oy, o.K.ty].sort()); expect(n.bilgi).toContain('çatlak');
    expect((await o.kart('Kritik Bulgu Kararı', b)).sahip_kullanici_ref).toBe(o.K.ds);
    expect((await o.ist('POST', `/api/bulgu/${b}/kritik-karar`, tu, { karar: 'K' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/bulgu/${b}/kritik-karar`, await o.gir('ds'), { karar: 'Yat derhal karaya alınacak' })).statusCode).toBe(200);
    expect((await o.kart('Kritik Bulgu Kararı', b)).durum).toBe('Tamamlandı');
  });
});

describe('FR-OPS-003 İlk Kapsam (YG-1069)', () => {
  it('Dosya Sorumlusu doldurur; Teknik Uzman tamamlar ve onaylar; iki branşta koordinatör zorunlu; yeni kayıt yeni sürüm', async () => {
    const d = (await o.dosyaAc()).kimlik as string; await o.ekipKur(d); const u = `/api/dosya/${d}/ilk-kapsam`;
    const ds = await o.gir('ds'); const tu = await o.gir('tu');
    const G = { varlikSistem: 'Sancak şaft hattı', faaliyet: 'Teşhis', teknikBrans: ['TAHRIK-01'], beklenenCikti: 'Kök neden görüşü', kabulOlcutu: 'Titreşim ölçümü sınırda', hariclar: 'Motor revizyonu hariç' };
    expect((await o.ist('POST', u, tu, G)).statusCode).toBe(404);
    expect((await o.ist('POST', u, ds, { ...G, faaliyet: 'Bakım' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ...G, teknikBrans: ['TAHRIK-01', 'MAKINE-01'] })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ...G, kabulOlcutu: '' })).statusCode).toBe(400);
    const r = (await o.ist('POST', u, ds, G)).json(); expect(r).toMatchObject({ surum: 1, kontrolGorevi: true });
    expect((await o.kart('İlk Kapsam Kontrolü', d)).sahip_kullanici_ref).toBe(o.K.tu);
    const k = `${u}/1/kontrol`;
    expect((await o.ist('POST', k, ds, { karar: 'Onayla' })).statusCode).toBe(404);
    expect((await o.ist('POST', k, tu, { karar: 'İade' })).statusCode).toBe(400);
    expect((await o.ist('POST', k, tu, { karar: 'Onayla', varsayimlar: 'Yat karada' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, varsayimlar, kontrol_eden_ref FROM ilk_kapsam WHERE dosya_ref = $1 AND surum = 1`, [d])).rows[0]).toEqual({ durum: 'Onaylı', varsayimlar: 'Yat karada', kontrol_eden_ref: o.K.tu });
    expect((await o.kart('İlk Kapsam Kontrolü', d)).durum).toBe('Tamamlandı');
    expect((await o.ist('POST', u, ds, { ...G, teknikBrans: ['TAHRIK-01', 'MAKINE-01'], koordinator: o.K.tu })).json().surum).toBe(2);
    expect((await o.sup.query(`SELECT array_agg(durum ORDER BY surum) d FROM ilk_kapsam WHERE dosya_ref = $1`, [d])).rows[0].d).toEqual(['Yerine Geçti', 'Kontrolde']);
    expect((await o.ist('GET', u, ds)).json().surumler.length).toBe(2);
  });
});
