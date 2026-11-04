import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü' };
let o: Ortam; const AD = 'Ek Sigorta'; const ONAY = 'onay@eksigorta.local'; const TEM = 'temsilci@eksigorta.local';
const kaydet = async (x: object = {}) => o.ist('POST', '/api/sigorta-ek2', await o.gir('mpm'), { sigortaci: AD, adresler: [{ eposta: ONAY, ad: 'Onay Kişisi', onay: true, limit: 1000 }, { eposta: TEM, ad: 'Temsilci', temsilci: true }], ...x });
const dosya = async (sigortaci = AD) => { const d = await o.dosyaAc({ sigortaci, hasarNo: 'H1' }, { musteriTuru: 'Sigorta Şirketi' }); await o.ekipKur(d.kimlik); return d; };
const teklif = async (d: { kimlik: string; dosyaNo: string }, tut = 500) => {
  const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Sigorta Şirketi',20,'Gönderildi',$3,0,$3,$3,$4) RETURNING kimlik`, [`${d.dosyaNo}-TK01`, d.kimlik, tut, o.K.ts])).rows[0].kimlik as string;
  await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur) VALUES ($1,1,'Kalem','Onarım','İşçilik',1,'adet',$2,$2)`, [t, tut]);
  return t;
};
const belge = async (d: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($3,'Onay','Gizli','Dosya',$1,'Sistem',current_date,$2) RETURNING kimlik`, [d, o.K.ds, `Onay E-postası ${Math.random()}`])).rows[0].kimlik as string;
const karar = async (t: string, d: string, gonderen?: string) => o.ist('POST', `/api/teklif/${t}/sigorta-karar`, await o.gir('ds'), { karar: 'Tam Onay', kanal: 'Sözleşmede Tanımlı Kurumsal E-posta', yetkili: 'Y', belge: await belge(d), gonderen });

beforeAll(async () => { o = await ortamKur('yatonet360_test25', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('Sigorta Ek-2 onay adresi (YG-219, YG-1522)', () => {
  it('listeyi yalnız Müşteri ve Paydaş İlişkileri Müdürü kaydeder; onay ve temsilci zorunlu', async () => {
    expect((await o.ist('POST', '/api/sigorta-ek2', await o.gir('ds'), { sigortaci: AD, adresler: [{ eposta: ONAY, ad: 'A', onay: true, temsilci: true }] })).statusCode).toBe(403);
    expect((await o.ist('GET', '/api/sigorta-ek2', await o.gir('ds'))).statusCode).toBe(404);
    expect((await kaydet({ adresler: [{ eposta: ONAY, ad: 'A', temsilci: true }] })).statusCode).toBe(400);
    expect((await kaydet({ adresler: [{ eposta: ONAY, ad: 'A', onay: true }] })).statusCode).toBe(400);
    expect((await kaydet({ adresler: [{ eposta: 'gecersiz', ad: 'A', onay: true, temsilci: true }] })).statusCode).toBe(400);
    const r = await kaydet(); expect(r.statusCode, r.body).toBe(200); expect(r.json().surum).toBe(1);
  });
  it('e-posta onayı yalnız Ek-2 onay adresinden; temsilci adresi, yabancı adres ve sınır aşımı kabul edilmez', async () => {
    const d = await dosya(); const t = await teklif(d);
    expect((await karar(t, d.kimlik)).statusCode).toBe(400);
    expect((await karar(t, d.kimlik, 'yabanci@x.local')).json().hata).toContain('Ek-2 onay listesinde');
    expect((await karar(t, d.kimlik, TEM)).json().hata).toContain('Ek-2 onay listesinde');
    const d2 = await dosya(); const t2 = await teklif(d2, 1000.01);
    expect((await karar(t2, d2.kimlik, ONAY)).json().hata).toContain('tek işlem sınırı');
    const ok = await karar(t, d.kimlik, ONAY.toUpperCase()); expect(ok.statusCode, ok.body).toBe(200);
    expect((await o.sup.query(`SELECT gonderen_eposta FROM sigorta_onayi WHERE teklif_ref = $1`, [t])).rows[0].gonderen_eposta).toBe(ONAY.toUpperCase());
  });
  it('kanal KEP ise Ek-2 aranmaz; Ek-2 yoksa e-posta kanalı kabul edilmez; süresi dolan yetki geçmez', async () => {
    const d = await dosya('Listesiz Sigorta'); const t = await teklif(d);
    expect((await karar(t, d.kimlik, ONAY)).json().hata).toContain('Ek-2 listesi kayıtlı değildir');
    expect((await o.ist('POST', `/api/teklif/${t}/sigorta-karar`, await o.gir('ds'), { karar: 'Tam Onay', kanal: 'KEP', belge: await o.belge(d.kimlik, 'ds', 'KEP Onayı'), yetkili: 'Y' })).statusCode).toBe(200);
    await o.sup.query(`UPDATE sigorta_ek2_adres SET gecerlilik_bitis = current_date - 1 WHERE eposta = $1`, [ONAY]);
    const d2 = await dosya(); const t2 = await teklif(d2);
    expect((await karar(t2, d2.kimlik, ONAY)).json().hata).toContain('süresi dolmuştur');
    await o.sup.query(`UPDATE sigorta_ek2_adres SET gecerlilik_bitis = NULL WHERE eposta = $1`, [ONAY]);
  });
  it('Ek-3 onay yetkilisi varsa Ek-2 adresi geçmez; kaldırılınca Ek-2 geçerli olur', async () => {
    const d = await dosya(); const t = await teklif(d); const u = `/api/dosya/${d.kimlik}/ek3-onay-yetkilisi`;
    expect((await o.ist('POST', u, await o.gir('ty'), { eposta: 'dosya@eksigorta.local' })).statusCode).toBe(404);
    expect((await o.ist('POST', u, await o.gir('ds'), { eposta: 'dosya@eksigorta.local' })).statusCode).toBe(200);
    expect((await karar(t, d.kimlik, ONAY)).json().hata).toContain('Ek-3');
    await o.ist('POST', u, await o.gir('ds'), {});
    expect((await karar(t, d.kimlik, ONAY)).statusCode).toBe(200);
  });
  it('değişiklik yalnız temsilcinin kayıtlı adresinden yeni sürüm olur; önceki sürüm korunur, eski adres geçmez', async () => {
    const yeni = { adresler: [{ eposta: 'yeni@eksigorta.local', ad: 'Yeni', onay: true }, { eposta: TEM, ad: 'Temsilci', temsilci: true }] };
    expect((await kaydet({ ...yeni, bildiren: TEM })).statusCode).toBe(400);
    expect((await kaydet({ ...yeni, bildiren: ONAY, referans: 'E-posta 03.11' })).statusCode).toBe(409);
    const r = await kaydet({ ...yeni, bildiren: TEM, referans: 'E-posta 03.11' }); expect(r.json().surum, r.body).toBe(2);
    const l = (await o.ist('GET', '/api/sigorta-ek2', await o.gir('mpm'))).json().filter((x: { sigortaci_adi: string }) => x.sigortaci_adi === AD);
    expect(l.map((x: { durum: string }) => x.durum)).toEqual(['Yürürlükte', 'Yerine Geçti']); expect(l[1].adresler).toHaveLength(2);
    const d = await dosya(); const t = await teklif(d);
    expect((await karar(t, d.kimlik, ONAY)).json().hata).toContain('Ek-2 onay listesinde');
    expect((await karar(t, d.kimlik, 'yeni@eksigorta.local')).statusCode).toBe(200);
  });
  it('yeniden değerlendirme sonucu da aynı denetimden geçer', async () => {
    const d = await dosya(); await o.ist('POST', `/api/dosya/${d.kimlik}/sigorta-eposta`, await o.gir('ds'), { eposta: 'hasar@eksigorta.local' });
    const t = await teklif(d); await o.sup.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = 'Ret' WHERE kimlik = $1`, [t]); await o.sup.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = 'Onaylanmadı' WHERE teklif_ref = $1`, [t]);
    const c = await o.gir('ds'); const r = await o.ist('POST', `/api/teklif/${t}/yeniden-degerlendirme`, c, { siralar: [1], gerekce: 'Ölçüm' }); expect(r.statusCode, r.body).toBe(200);
    await o.ist('POST', `/api/sigorta-gonderim/${r.json().gonderim}/teyit`, c, { adim: 1 }); await o.ist('POST', `/api/sigorta-gonderim/${r.json().gonderim}/teyit`, c, { adim: 2 });
    const s = `/api/yeniden-degerlendirme/${r.json().talep}/sonuc`; const g = { onaylananSiralar: [1], kanal: 'Sözleşmede Tanımlı Kurumsal E-posta', yetkili: 'Y', belge: await belge(d.kimlik) };
    expect((await o.ist('POST', s, c, { ...g, gonderen: 'yabanci@x.local' })).json().hata).toContain('Ek-2 onay listesinde');
    expect((await o.ist('POST', s, c, { ...g, gonderen: 'yeni@eksigorta.local' })).statusCode).toBe(200);
  });
});
