import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sigortaSureIsle } from '../src/sigorta.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { ana, ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', gmy: 'Genel Müdür Yardımcısı' };
let o: Ortam; const EP = 'hasar@yd.deneme.local';
const dosya = async (eposta: string | null = EP) => {
  const d = await o.dosyaAc({ sigortaci: 'YD Sigorta', hasarNo: 'H7' }, { musteriTuru: 'Sigorta Şirketi' }); await o.ekipKur(d.kimlik);
  if (eposta) await o.ist('POST', `/api/dosya/${d.kimlik}/sigorta-eposta`, await o.gir('ds'), { eposta });
  return d;
};
const teklif = async (d: { kimlik: string; dosyaNo: string }, karar = 'Kısmi Onay') => {
  const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Sigorta Şirketi',20,'Karar',$3,300,60,360,300,$4) RETURNING kimlik`, [`${d.dosyaNo}-TK01`, d.kimlik, karar, o.K.ts])).rows[0].kimlik as string;
  for (const [n, a, tut, dr] of [[1, 'Pervane', 100, 'Onaylandı'], [2, 'Şaft', 200, 'Onaylanmadı']] as const) await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur, onay_durumu) VALUES ($1,$2,$3,'Onarım','İşçilik',1,'adet',$4,$4,$5)`, [t, n, a, tut, dr]);
  return t;
};
const belge = async (d: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('Eksper Raporu','Eksper Raporu','Gizli','Dosya',$1,'Sistem',current_date,$2) RETURNING kimlik`, [d, o.K.ds])).rows[0].kimlik as string;
const teyit = async (g: string) => { await o.ist('POST', `/api/sigorta-gonderim/${g}/teyit`, await o.gir('ds'), { adim: 1 }); return o.ist('POST', `/api/sigorta-gonderim/${g}/teyit`, await o.gir('ds'), { adim: 2 }); };

const ceoGir = async () => {
  const g = await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: 'ceo@deneme.yatonet.local', parola: 'Sinama-Parolasi-2026!' } });
  const c = ana.ckr(g); const q = await o.ist('GET', '/api/kimlik/kurulum', c);
  return ana.ckr(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
};
beforeAll(async () => { o = await ortamKur('yatonet360_test24', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('eksper raporu karşılaştırması (YG-203)', () => {
  it('kalem kalem fark hesaplanır; belge zorunlu; yalnız Dosya Sorumlusu girer; maliyet dönmez', async () => {
    const d = await dosya(); const t = await teklif(d); const u = `/api/teklif/${t}/eksper-karsilastirma`; const be = await belge(d.kimlik);
    expect((await o.ist('POST', u, await o.gir('ds'), { satirlar: [{ sira: 2, tutar: 150 }] })).statusCode).toBe(400);
    expect((await o.ist('POST', u, await o.gir('ty'), { belge: be, satirlar: [{ sira: 2, tutar: 150 }] })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('ds'), { belge: be, satirlar: [{ sira: 9, tutar: 150 }] })).statusCode).toBe(400);
    expect((await o.ist('POST', u, await o.gir('ds'), { belge: be, satirlar: [{ sira: 2, tutar: -1 }] })).statusCode).toBe(400);
    const r = await o.ist('POST', u, await o.gir('ds'), { belge: be, satirlar: [{ sira: 1, tutar: 100 }, { sira: 2, tutar: 150, not: 'Eksik işçilik' }] }); expect(r.statusCode, r.body).toBe(200);
    const g = (await o.ist('GET', u, await o.gir('ty'))).json();
    expect(g.satirlar[1]).toMatchObject({ sira: 2, teklif: 200, eksper: 150, fark: 50, not: 'Eksik işçilik', onay: 'Onaylanmadı' });
    expect(g.toplam).toMatchObject({ teklif: 300, eksper: 250, fark: 50 }); expect(JSON.stringify(g)).not.toMatch(/maliyet/i);
  });
});

describe('yeniden değerlendirme (YG-204, K-241)', () => {
  const u = (t: string) => `/api/teklif/${t}/yeniden-degerlendirme`;
  it('yalnız onaylanmayan kalem, gerekçe zorunlu, teminat yazılmaz; ikinci teyitten önce gitmez; bir kez istenir', async () => {
    const d = await dosya(); const t = await teklif(d); const c = await o.gir('ds');
    expect((await o.ist('POST', u(t), c, { siralar: [2] })).statusCode).toBe(400);
    expect((await o.ist('POST', u(t), c, { siralar: [1], gerekce: 'Ölçüm' })).statusCode).toBe(400);
    expect((await o.ist('POST', u(t), c, { siralar: [2], gerekce: 'Poliçe teminatı içinde' })).statusCode).toBe(400);
    expect((await o.ist('POST', u(t), await o.gir('ty'), { siralar: [2], gerekce: 'Ölçüm' })).statusCode).toBe(403);
    const r = await o.ist('POST', u(t), c, { siralar: [2], gerekce: 'Salgı 0,11 mm ölçüldü' }); expect(r.statusCode, r.body).toBe(200); expect(r.json().durum).toBe('Teyit Bekliyor');
    const olay = `sigorta:${r.json().gonderim}`; const giden = async () => (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1`, [olay])).rows;
    expect(await giden()).toHaveLength(0);
    expect((await o.ist('POST', u(t), c, { siralar: [2], gerekce: 'Yine' })).statusCode).toBe(409);
    expect((await teyit(r.json().gonderim)).json().durum).toBe('Gönderildi');
    const m = (await giden())[0].metin as string; expect(m).toContain('Şaft'); expect(m).toContain('Salgı 0,11 mm'); expect(m).toContain(d.dosyaNo);
    expect(await o.kart('Yeniden Değerlendirme Yanıtı', r.json().talep)).toBeDefined();
  });
  it('iptal edilen talep hak tüketmez; adres yoksa istenmez', async () => {
    const yok = await dosya(null); const ty = await teklif(yok);
    const a = await o.ist('POST', u(ty), await o.gir('ds'), { siralar: [2], gerekce: 'Ölçüm' }); expect(a.statusCode).toBe(409); expect(a.json().hata).toContain('e-posta adresi bekleniyor');
    const d = await dosya(); const t = await teklif(d); const c = await o.gir('ds');
    const r = await o.ist('POST', u(t), c, { siralar: [2], gerekce: 'Ölçüm' });
    await o.ist('POST', `/api/sigorta-gonderim/${r.json().gonderim}/iptal`, c, { gerekce: 'Yanlış' });
    expect((await o.ist('POST', u(t), c, { siralar: [2], gerekce: 'Ölçüm 2' })).statusCode).toBe(200);
  });
  it('olumlu sonuç kalemi onaylar, kararı Tam Onay yapar; sonuç bir kez girilir; yazılı kanal zorunlu', async () => {
    const d = await dosya(); const t = await teklif(d); const c = await o.gir('ds');
    const r = await o.ist('POST', u(t), c, { siralar: [2], gerekce: 'Ölçüm' }); await teyit(r.json().gonderim);
    const s = `/api/yeniden-degerlendirme/${r.json().talep}/sonuc`;
    expect((await o.ist('POST', s, c, { onaylananSiralar: [2], kanal: 'Telefon', yetkili: 'Y' })).statusCode).toBe(400);
    expect((await o.ist('POST', s, c, { onaylananSiralar: [2], kanal: 'KEP', yetkili: 'Y' })).statusCode).toBe(400);
    const ok = await o.ist('POST', s, c, { onaylananSiralar: [2], kanal: 'KEP', yetkili: 'Y', belge: await belge(d.kimlik) }); expect(ok.statusCode, ok.body).toBe(200); expect(ok.json().karar).toBe('Tam Onay');
    expect((await o.sup.query(`SELECT onay_durumu FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND sira_no = 2`, [t])).rows[0].onay_durumu).toBe('Onaylandı');
    expect((await o.sup.query(`SELECT karar FROM fiyat_teklifi WHERE kimlik = $1`, [t])).rows[0].karar).toBe('Tam Onay');
    expect((await o.sup.query(`SELECT onaylanan_tutar_eur FROM sigorta_onayi WHERE teklif_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 1`, [t])).rows[0].onaylanan_tutar_eur).toBe('300.00');
    expect((await o.kart('Yeniden Değerlendirme Yanıtı', r.json().talep)).durum).toBe('Tamamlandı');
    expect((await o.ist('POST', s, c, { onaylananSiralar: [2], kanal: 'YATONET 360', yetkili: 'Y' })).statusCode).toBe(409);
  });
  it('olumsuz sonuçta kalem onaylanmamış kalır; yeniden istenemez', async () => {
    const d = await dosya(); const t = await teklif(d); const c = await o.gir('ds');
    const r = await o.ist('POST', u(t), c, { siralar: [2], gerekce: 'Ölçüm' }); await teyit(r.json().gonderim);
    const ok = await o.ist('POST', `/api/yeniden-degerlendirme/${r.json().talep}/sonuc`, c, { onaylananSiralar: [], kanal: 'YATONET 360', yetkili: 'Y' }); expect(ok.json().karar).toBe('Kısmi Onay');
    expect((await o.ist('POST', u(t), c, { siralar: [2], gerekce: 'Tekrar' })).statusCode).toBe(409);
  });
});

describe('iyi niyet kararı (YG-175)', () => {
  const kayit = async (d: string) => (await o.ist('POST', `/api/dosya/${d}/garanti-sikayet`, await o.gir('ds'), { turler: ['Garanti bildirimi'], kanal: 'Telefon', oncelik: 'Normal', belirti: 'B' })).json().kimlik as string;
  const fatura = async (d: { kimlik: string; dosyaNo: string }, tutar: number) => { const t = await teklif(d, 'Tam Onay'); await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, hazirlayan_ref) VALUES ($1,$2,$3,'Sigorta Şirketi',$4,0,$4,'Faturalandı',$5)`, [`${d.dosyaNo}-OT01`, d.kimlik, t, tutar, o.K.ts]); };
  const K = async (id: string, x: object) => o.ist('POST', `/api/garanti-sikayet/${id}/karar`, await o.gir('ty'), { gerekce: 'Jest', karar: 'İyi Niyet', ...x });
  const makam = async (id: string) => (await o.sup.query(`SELECT r.rol_adi FROM is_karti k JOIN rol r ON r.kimlik = k.zincir[1] WHERE k.tur = 'İyi Niyet Kararı' AND k.nesne_kimligi = $1`, [id])).rows[0]?.rol_adi;
  it('tutar zorunlu; %5 dahil GMY onayına gider, onaylanana kadar karar yazılmaz; onayda karar kesinleşir', async () => {
    const d = await dosya(); await fatura(d, 1000); const id = await kayit(d.kimlik);
    expect((await K(id, {})).statusCode).toBe(400);
    const r = await K(id, { maliyet: 50, kapat: true, kokNeden: true }); expect(r.statusCode, r.body).toBe(200); expect(r.json().durum).toBe('Onay Bekleniyor');
    expect(await makam(id)).toBe('Genel Müdür Yardımcısı');
    const once = (await o.sup.query(`SELECT karar, statu, iyi_niyet_orani FROM garanti_sikayet WHERE kimlik = $1`, [id])).rows[0];
    expect(once).toMatchObject({ karar: null, statu: 'İncelemede', iyi_niyet_orani: '5.00' });
    expect((await K(id, { maliyet: 50 })).statusCode).toBe(409);
    const kart = await o.kart('İyi Niyet Kararı', id); await o.karar(kart.kimlik, 'gmy', 'Onayla');
    expect((await o.sup.query(`SELECT karar, statu FROM garanti_sikayet WHERE kimlik = $1`, [id])).rows[0]).toMatchObject({ karar: 'İyi Niyet', statu: 'Karar' });
  });
  it('%5 üzeri, faturasız dosya ve 10.000,00 EUR üzeri CEO onayına gider; ret karar yazmaz', async () => {
    const d = await dosya(); await fatura(d, 1000); const id = await kayit(d.kimlik);
    await K(id, { maliyet: 50.01 }); expect(await makam(id)).toBe('CEO');
    const kart = await o.kart('İyi Niyet Kararı', id); const rk = await o.ist('POST', `/api/is/${kart.kimlik}/karar`, await ceoGir(), { karar: 'Reddet', gerekce: 'Uygun değil' }); expect(rk.statusCode, rk.body).toBe(200);
    expect((await o.sup.query(`SELECT karar, statu, iyi_niyet_orani FROM garanti_sikayet WHERE kimlik = $1`, [id])).rows[0]).toMatchObject({ karar: null, statu: 'Açık', iyi_niyet_orani: null });
    const d2 = await dosya(); const id2 = await kayit(d2.kimlik); await K(id2, { maliyet: 1 }); expect(await makam(id2)).toBe('CEO');
    const d3 = await dosya(); await fatura(d3, 1000000); const id3 = await kayit(d3.kimlik); const r3 = await o.ist('POST', `/api/garanti-sikayet/${id3}/karar`, await o.gir('tm'), { gerekce: 'Jest', karar: 'İyi Niyet', maliyet: 10000.01 }); expect(r3.statusCode, r3.body).toBe(200); expect(await makam(id3)).toBe('CEO');
  });
});

describe('sigorta adresi uyarısı', () => {
  it('BLD-72 adres yoksa atlanmaz, Dosya Sorumlusuna bir kez görev açılır; adres girilince görev kapanır', async () => {
    const d = await dosya(null);
    const t = await teklif(d); await o.sup.query(`UPDATE fiyat_teklifi SET statu = 'Gönderildi', karar = NULL, gonderim_zamani = now(), sigorta_karar_son = now() + interval '20 hours' WHERE kimlik = $1`, [t]);
    await sigortaSureIsle(o.db); await sigortaSureIsle(o.db);
    const k = await o.sup.query(`SELECT durum FROM is_karti WHERE tur = 'Sigorta Adresi Bekleniyor' AND nesne_kimligi = $1`, [d.kimlik]); expect(k.rowCount).toBe(1);
    await o.ist('POST', `/api/dosya/${d.kimlik}/sigorta-eposta`, await o.gir('ds'), { eposta: EP });
    expect((await o.sup.query(`SELECT durum FROM is_karti WHERE tur = 'Sigorta Adresi Bekleniyor' AND nesne_kimligi = $1`, [d.kimlik])).rows[0].durum).toBe('Tamamlandı');
  });
});
