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
    expect(r.cizim_no).toBe(`${d.dosyaNo}-ÇZ01`);
    expect((await o.ist('POST', `/api/teknik-cizim/${r.kimlik}/onaya-gonder`, tu, {})).json().gonderilecek).toBe('Teknik Yönetici');
    expect((await o.kart('Teknik Çizim', r.kimlik)).durum).toBe('Bekliyor');
    await o.sup.query(`UPDATE teknik_cizim SET durum = 'Onaylı', onay_zamani = now() WHERE kimlik = $1`, [r.kimlik]);
    expect((await o.ist('POST', `/api/teknik-cizim/${r.kimlik}/revizyon`, tu, { aciklama: 'Ölçü eklendi' })).json().revizyon).toBe(1);
    const t = JSON.stringify((await cizimTanim(o.db, r.kimlik, null))!.t);
    for (const s of ['Çizim Anteti', d.dosyaNo, `${d.dosyaNo}-ÇZ01`, 'Teknik Uzman', 'Ölçeksiz', 'Revizyon Tablosu', 'İlk yayım', 'Ölçü eklendi', 'Genel Notlar', 'Rev.1']) expect(t).toContain(s);
    expect(t).not.toMatch(/YATONET 360|sistem notu|sistemde/i);
    const p = await o.ist('GET', `/api/teknik-cizim/${r.kimlik}/pdf`, tu); expect(p.statusCode).toBe(200);
    // YG1442-GECERSIZ: eski revizyon GEÇERSİZ damgalı, tablosu o revizyona kadar; antette onay kodu alanı
    const e0 = (await cizimTanim(o.db, r.kimlik, null, 0))!; expect(e0.t.damga).toBe('GEÇERSİZ · Yerine Rev.1 geçerlidir'); expect(e0.dosyaAdi).toContain('_GECERSIZ');
    expect(JSON.stringify(e0.t)).not.toContain('Ölçü eklendi'); expect(t).toContain('Onay Kodu');
    expect((await cizimTanim(o.db, r.kimlik, null))!.t.damga).toBeUndefined(); expect(await cizimTanim(o.db, r.kimlik, null, 5)).toBeNull();
    expect((await o.ist('GET', `/api/teknik-cizim/${r.kimlik}/pdf?rev=0`, tu)).statusCode).toBe(200);
  });
});

describe('geçici/acil önlem iş emri (YG-1596)', () => {
  it('hasar ilerleyebilir Yüksek dosyada Teknik Uzman AC iş emrini keşfi beklemeden çıkarabilir (YG1596-AC)', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const tu = await o.gir('tu');
    await o.sup.query(`UPDATE dosya SET statu = 'Aktif', oncelik = 'Yüksek', hasar_ilerleyebilir = false WHERE kimlik = $1`, [d.kimlik]);
    const ac = () => o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, tu, { tur: 'AC', yer: 'Marina', kapsam: 'Sızıntı için geçici tıkama', firma: '00000000-0000-0000-0000-000000000000' });
    expect((await ac()).statusCode).toBe(403);
    await o.sup.query(`UPDATE dosya SET hasar_ilerleyebilir = true WHERE kimlik = $1`, [d.kimlik]);
    const r = await ac(); expect(r.statusCode, r.body).not.toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/is-emri`, tu, { tur: 'KN', yer: 'Marina', kapsam: 'Keşif', bedel: 0, firma: '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(403);
  });
});

describe('dosya bölgesi seçimi (YG-322)', () => {
  it('eşleşmeyen konumda Dosya Sorumlusu bölgeyi listeden seçer; seçilen bölge dosya bölgesi olur (YG322-BOLGE)', async () => {
    const { dosyaBolgesi } = await import('../src/firma.js');
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    expect(await dosyaBolgesi(o.db, d.kimlik)).toBeNull();
    const u = `/api/dosya/${d.kimlik}/bolge-sec`;
    expect((await o.ist('POST', u, await o.gir('tu'), { bolge: '3. Güney Ege' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('ds'), { bolge: 'Ege' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, await o.gir('ds'), { bolge: '3. Güney Ege' })).statusCode).toBe(200);
    expect(await dosyaBolgesi(o.db, d.kimlik)).toBe('3. Güney Ege');
  });
});

describe('belge önceliği (YG-617)', () => {
  it('bireysel müşteride tek iş, diğerlerinde çerçeve kuralı; çelişki Hukuk ve Uyum incelemesine gider', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`UPDATE dosya SET musteri_turu = 'Bireysel Müşteri' WHERE kimlik = $1`, [d.kimlik]);
    const b = (await belgeOnceligi(o.db, d.kimlik))!; expect(b.kural).toBe('Tek İş Sözleşmesi'); expect(b.musteri[0]!.belge).toBe('Yat Onarım Sözleşmesi');
    { // YG-615: iş emri sürümü ve değişiklik protokolü ayrı kayıt olarak görünür
      const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'BO Firma','Çözüm Ortağı',$2) RETURNING kimlik`, [`S-BO${Date.now()}`, o.K.ds])).rows[0].kimlik;
      await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K','Aktif',$4)`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.ds]);
      await o.sup.query(`INSERT INTO degisiklik_protokolu (degisiklik_no, dosya_ref, tur, mevcut, onerilen, kanal, hazirlayan_ref) VALUES ($1,$2,'İlave İş','A','B','YATONET 360',$3)`, [`${d.dosyaNo}-DP01`, d.kimlik, o.K.ds]);
      const x = (await belgeOnceligi(o.db, d.kimlik))!;
      expect(x.firma.find((k) => k.belge.startsWith('İş Emri'))!.kayitlar).toEqual([`${d.dosyaNo}-ON01 Rev.1`]);
      expect(x.musteri.find((k) => k.belge === 'Değişiklik Protokolü')!.kayitlar[0]).toMatch(/-DP01 · İlave İş · Onay Bekliyor/);
      expect(x.musteri.some((k) => k.belge.startsWith('Teklif Kabulü'))).toBe(true);
    }
    await o.sup.query(`UPDATE dosya SET musteri_turu = 'Sigorta Şirketi' WHERE kimlik = $1`, [d.kimlik]);
    const c = (await belgeOnceligi(o.db, d.kimlik))!; expect(c.kural).toBe('Çerçeve Sözleşme'); expect(c.musteri[2]!.islev).toMatch(/ana metni değiştirmez/); expect(c.celiski).toMatch(/otomatik tercih yapılmaz/);
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$2) ON CONFLICT DO NOTHING`, [d.kimlik, o.K.ds]);
    const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/belge-celiskisi`, ds, { belgeler: 'Teklif Rev.1 / Ek-2' })).statusCode).toBe(400);
    { // YG-1179: serbest metne TCKN, IBAN, kart numarası yazılmaz
      const { kisiselVeriTuru } = await import('../src/serbest_metin.js');
      expect(kisiselVeriTuru('Kimlik 10000000146 olarak alındı')).toBe('TC kimlik numarası'); expect(kisiselVeriTuru('Sipariş 10000000147')).toBeNull();
      expect(kisiselVeriTuru('Hesap TR33 0006 1005 1978 6457 8413 26')).toBe('IBAN'); expect(kisiselVeriTuru('Kart 4111 1111 1111 1111')).toBe('kart numarası'); expect(kisiselVeriTuru('Tel +90 555 123 45 67, 12 adet')).toBeNull();
      expect((await o.ist('POST', `/api/dosya/${d.kimlik}/belge-celiskisi`, ds, { belgeler: 'Ek-2', konu: 'Yetkili 10000000146 farklı' })).json().hata).toContain('TC kimlik numarası');
    }
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/belge-celiskisi`, ds, { belgeler: 'Teklif Rev.1 / Ek-2', konu: 'Onay sınırı farklı' })).statusCode).toBe(200);
    expect((await o.kart('Belge Çelişkisi İncelemesi', d.kimlik)).durum).toBe('Bekliyor');
  });
});
