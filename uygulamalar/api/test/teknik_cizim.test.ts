import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { belgeOnceligi } from '../src/belge_onceligi.js';
import { cizimTanim } from '../src/teknik_cizim.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test115', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('teknik çizim anteti (YG-679)', () => {
  it('Teknik Uzman çizer, Teknik Yönetici onaylar; antette dosya, çizim no, roller, ölçek, tarih; revizyon tabloya eklenir; sistem notu yok', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
    const tu = await o.gir('tu');
    const pdf = await o.belge(d.kimlik, 'tu', 'Kroki PDF', 'pdf');
    const jpg = await o.belge(d.kimlik, 'tu', 'Kroki görsel', 'jpg');
    const G = { ad: 'Kıç Ayna Hasar Krokisi', olcek: 'Ölçeksiz', notlar: 'Ölçüler mm’dir.' };
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-cizim`, await o.gir('ds'), { ...G, belge: jpg })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-cizim`, tu, { ...G, belge: pdf })).statusCode).toBe(400);
    const r = (await o.ist('POST', `/api/dosya/${d.kimlik}/teknik-cizim`, tu, { ...G, belge: jpg })).json();
    expect(r.cizim_no).toBe(`${d.dosyaNo}-CZ01`);
    expect((await o.ist('POST', `/api/teknik-cizim/${r.kimlik}/onaya-gonder`, tu, {})).json().gonderilecek).toBe('Teknik Yönetici');
    expect((await o.kart('Teknik Çizim', r.kimlik)).durum).toBe('Bekliyor');
    await o.sup.query(`UPDATE teknik_cizim SET durum = 'Onaylı', onay_zamani = now() WHERE kimlik = $1`, [r.kimlik]);
    expect((await o.ist('POST', `/api/teknik-cizim/${r.kimlik}/revizyon`, tu, { aciklama: 'Ölçü eklendi' })).json().revizyon).toBe(1);
    const t = JSON.stringify((await cizimTanim(o.db, r.kimlik, null))!.t);
    for (const s of ['Çizim Anteti', d.dosyaNo, `${d.dosyaNo}-CZ01`, 'Teknik Uzman', 'Ölçeksiz', 'Revizyon Tablosu', 'İlk yayım', 'Ölçü eklendi', 'Genel Notlar', 'Rev.1']) expect(t).toContain(s);
    expect(t).not.toMatch(/YATONET 360|sistem notu|sistemde/i);
    const p = await o.ist('GET', `/api/teknik-cizim/${r.kimlik}/pdf`, tu); expect(p.statusCode).toBe(200);
  });
});

describe('belge önceliği (YG-617)', () => {
  it('bireysel müşteride tek iş, diğerlerinde çerçeve kuralı; çelişki Hukuk ve Uyum incelemesine gider', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET musteri_turu = 'Bireysel Müşteri' WHERE kimlik = $1`, [d.kimlik]);
    const b = (await belgeOnceligi(o.db, d.kimlik))!; expect(b.kural).toBe('Tek İş Sözleşmesi'); expect(b.musteri[0]!.belge).toBe('Yat Onarım Sözleşmesi');
    await o.sup.query(`UPDATE dosya SET musteri_turu = 'Sigorta Şirketi' WHERE kimlik = $1`, [d.kimlik]);
    const c = (await belgeOnceligi(o.db, d.kimlik))!; expect(c.kural).toBe('Çerçeve Sözleşme'); expect(c.musteri[2]!.islev).toMatch(/ana metni değiştirmez/); expect(c.celiski).toMatch(/otomatik tercih yapılmaz/);
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$2) ON CONFLICT DO NOTHING`, [d.kimlik, o.K.ds]);
    const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/belge-celiskisi`, ds, { belgeler: 'Teklif Rev.1 / Ek-2' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/belge-celiskisi`, ds, { belgeler: 'Teklif Rev.1 / Ek-2', konu: 'Onay sınırı farklı' })).statusCode).toBe(200);
    expect((await o.kart('Belge Çelişkisi İncelemesi', d.kimlik)).durum).toBe('Bekliyor');
  });
});
