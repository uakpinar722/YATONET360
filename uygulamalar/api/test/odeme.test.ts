import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', my: 'Muhasebe ve Finans Yöneticisi', mfy: 'Muhasebe ve Finans Müdür Yardımcısı', mfm: 'Muhasebe ve Finans Müdürü', tid: 'Ticari İşler Direktörü', gmy: 'Genel Müdür Yardımcısı' };
let o: Ortam; let firma: string; let n = 0;
const IBAN = 'TR330006100519786457841326';

/** Dosya, kabul edilmiş iş emri, faturalı müşteri kaydı ve doğrulanmış hakediş. */
const kur = async (g: { net?: number; tahsilat?: number; toplam?: number } = {}) => {
  n++;
  const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
  await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref <> $1 AND bitis_zamani IS NULL`, [d.kimlik]);
  const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, teknik_kabul_sonucu, teknik_kabul_eden_ref, hazirlayan_ref, firma_bedeli_eur) VALUES ($1,'ON',$2,$3,'M','K','Tamamlandı','Kabul',$4,$5,100000) RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, firma, o.K.tu, o.K.ds])).rows[0].kimlik as string;
  const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,'Karar',$3) RETURNING kimlik`, [`${d.dosyaNo}-FT${n}`, d.kimlik, o.K.ts])).rows[0].kimlik;
  const top = g.toplam ?? 2000;
  await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, tahsil_edilen_eur, durum, fatura_no, fatura_tarihi, kur, kur_tarihi, vade, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',$4,0,$4,$5,'Kısmi Tahsil',$6,'2026-11-02',40.5,'2026-10-30','2026-11-02',$7)`, [`PF-${d.dosyaNo}`, d.kimlik, t, top, g.tahsilat ?? 0, `MF-${d.dosyaNo}`, o.K.ts]);
  const net = g.net ?? 1000;
  const h = (await o.sup.query(`INSERT INTO hakedis (hakedis_no, is_emri_ref, dosya_ref, sira_no, bu_donem_brut, kumulatif, kesinti, net, statu, firma_fatura_no, firma_fatura_tarihi, firma_fatura_kuru, giren_ref, dogrulayan_ref) VALUES ($1,$2,$3,1,$4,$4,0,$4,'Doğrulandı',$5,'2026-11-02',40.5,$6,$6) RETURNING kimlik`, [`${d.dosyaNo}-HK01`, e, d.kimlik, net, `FF-${d.dosyaNo}`, o.K.ds])).rows[0].kimlik as string;
  return { d, e, h };
};
const talimatYap = async (h: string) => o.ist('POST', `/api/hakedis/${h}/odeme-talimati`, await o.gir('ts'));
const onayla = async (id: string) => { const k = await o.kart('Firma Ödeme Talimatı', id); await o.karar(k.kimlik, 'mfm', 'Onaya Gönder'); await o.karar(k.kimlik, 'tid', 'Onayla'); };
const vadeGecir = (id: string) => o.sup.query(`UPDATE odeme_talimati SET olusturma_zamani = now() - interval '121 days' WHERE kimlik = $1`, [id]);
const listele = async (id: string) => { const l = await o.ist('POST', '/api/odeme-listesi', await o.gir('ts'), { talimatlar: [id] }); expect(l.statusCode, l.body).toBe(200); const k = await o.kart('Ödeme Listesi', l.json().kimlik); await o.karar(k.kimlik, 'mfy', 'Onaya Gönder'); await o.karar(k.kimlik, 'tid', 'Onayla'); return l.json().kimlik as string; };
const durum = async (h: string) => (await o.sup.query(`SELECT statu FROM hakedis WHERE kimlik = $1`, [h])).rows[0].statu;
const belge = async (d: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'K','Gizli','Dosya',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`B-${Math.random()}`, d, o.K.ds])).rows[0].kimlik as string;

beforeAll(async () => {
  o = await ortamKur('yatonet360_test36', KADRO);
  firma = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-OD','Ödeme Firma','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
  await o.sup.query(`INSERT INTO banka_hesabi (kurulus_ref, iban, durum, giren_ref) VALUES ($1,$2,'Geçerli',$3)`, [firma, IBAN, o.K.ds]);
  await o.sup.query(`INSERT INTO sicil_belgesi (kurulus_ref, tur, gecerlilik_bitis, kontrol_eden_ref) VALUES ($1,'SGK Borcu Yoktur Yazısı','2099-01-01',$2)`, [firma, o.K.ds]);
}, 120_000);
afterAll(async () => { await o.kapat(); });

describe('ödeme listesi (YG-830)', () => {
  it('hazırlayan, onaylayan, ödeyen ayrı; liste ve plan olmadan kayıt yok; ödenince hakediş kapanır', async () => {
    const { h } = await kur(); const r = await talimatYap(h); expect(r.statusCode, r.body).toBe(200); const id = r.json().kimlik; await onayla(id);
    const my = await o.gir('my'); const u = `/api/firma-odemeleri/${id}/odendi`;
    expect((await o.ist('POST', u, my, { referans: 'R1' })).json().hata).toContain('Ödeme Listesi');
    expect((await o.ist('POST', '/api/odeme-listesi', await o.gir('ts'), { talimatlar: [id] })).json().hata).toContain('planı tarihi');
    await vadeGecir(id); const l = await listele(id);
    expect((await o.sup.query(`SELECT liste_no FROM odeme_listesi WHERE kimlik = $1`, [l])).rows[0].liste_no).toMatch(/^LGM-OD-\d{5}$/);
    expect((await o.ist('POST', u, await o.gir('ts'), { referans: 'R1' })).json().hata).toContain('hazırlayan');
    expect((await o.ist('POST', u, my, {})).statusCode).toBe(400);
    const od = await o.ist('POST', u, my, { referans: `R-${id}` }); expect(od.statusCode, od.body).toBe(200);
    expect(await durum(h)).toBe('Ödendi');
    expect((await o.sup.query(`SELECT durum FROM odeme_listesi WHERE kimlik = $1`, [l])).rows[0].durum).toBe('Tamamlandı');
  });
  it('aynı firma ve tutarda ödeme varsa inceleme sonucu yazılmadan liste açılmaz', async () => {
    const a = await kur({ net: 777 }); const b = await kur({ net: 777 });
    const ia = (await talimatYap(a.h)).json().kimlik; const ib = (await talimatYap(b.h)).json().kimlik; await onayla(ia); await onayla(ib); await vadeGecir(ia); await vadeGecir(ib);
    const r = await o.ist('POST', '/api/odeme-listesi', await o.gir('ts'), { talimatlar: [ia, ib] }); expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('Mükerrerlik');
    expect((await o.ist('POST', '/api/odeme-listesi', await o.gir('ts'), { talimatlar: [ia, ib], mukerrerlikCozumu: 'Ayrı işler' })).statusCode).toBe(200);
  });
});

describe('acil istisna (YG-833)', () => {
  it('5.000,00 EUR üstü olmaz; GMY ve Müdür onayıyla liste ve plan beklemez', async () => {
    const b = await kur({ net: 5000.01 }); const bid = (await talimatYap(b.h)).json().kimlik; await onayla(bid);
    expect((await o.ist('POST', `/api/odeme-talimati/${bid}/acil`, await o.gir('ts'), { gerekce: 'G' })).json().hata).toContain('5.000,00');
    const { h } = await kur({ net: 5000 }); const id = (await talimatYap(h)).json().kimlik; await onayla(id); const ts = await o.gir('ts');
    expect((await o.ist('POST', `/api/odeme-talimati/${id}/acil`, ts, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/odeme-talimati/${id}/acil`, ts, { gerekce: 'Firma işi bırakıyor' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/firma-odemeleri/${id}/odendi`, await o.gir('my'), { referans: 'A0' })).json().hata).toContain('Ödeme Listesi');
    const k = await o.kart('Acil Ödeme İstisnası', id); await o.karar(k.kimlik, 'gmy', 'Onaya Gönder'); await o.karar(k.kimlik, 'mfm', 'Onayla');
    const r = await o.ist('POST', `/api/firma-odemeleri/${id}/odendi`, await o.gir('my'), { referans: `A-${id}` }); expect(r.statusCode, r.body).toBe(200); expect(await durum(h)).toBe('Ödendi');
  });
});

describe('mahsup, açık iş, avans, oran, kur', () => {
  it('YG-840, YG-353: belgesiz mahsup yok; onaylı mahsup ödemeden düşer; kalanı sonraki ödemeye geçer; ret iade eder', async () => {
    const { d, h } = await kur({ net: 300 }); const u = `/api/dosya/${d.kimlik}/mahsup`; const P = { kurulus: firma, tur: 'Başka Firmaya Verilen Zarar', tutar: 500, aciklama: 'Boya zararı' };
    const ts = await o.gir('ts');
    expect((await o.ist('POST', u, ts, P)).json().hata).toContain('Devir fotoğrafı');
    expect((await o.ist('POST', u, await o.gir('ds'), { ...P, belge: await belge(d.kimlik) })).statusCode).toBe(403);
    const m = await o.ist('POST', u, ts, { ...P, belge: await belge(d.kimlik) }); expect(m.statusCode, m.body).toBe(200);
    const k = await o.kart('Hakediş Mahsubu', m.json().kimlik); await o.karar(k.kimlik, 'mfm', 'Onaya Gönder'); await o.karar(k.kimlik, 'tid', 'Onayla');
    // Bedelin tamamı mahsupla kapanır: bankaya gidecek tutar kalmaz.
    const r = await talimatYap(h); expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ mahsup: 300, tutar: 0 }); expect(await durum(h)).toBe('Ödendi');
    expect((await o.sup.query(`SELECT kalan_eur FROM hakedis_mahsubu WHERE kimlik = $1`, [m.json().kimlik])).rows[0].kalan_eur).toBe('200.00');
    const b = await kur({ net: 1000 }); const rb = await talimatYap(b.h); expect(rb.json()).toMatchObject({ mahsup: 200, tutar: 800 });
    const kb = await o.kart('Firma Ödeme Talimatı', rb.json().kimlik); await o.karar(kb.kimlik, 'mfm', 'Onaya Gönder'); expect((await o.karar(kb.kimlik, 'tid', 'Reddet', 'Tutar hatalı')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT kalan_eur FROM hakedis_mahsubu WHERE kimlik = $1`, [m.json().kimlik])).rows[0].kalan_eur).toBe('200.00');
    await o.sup.query(`UPDATE hakedis_mahsubu SET kalan_eur = 0 WHERE kimlik = $1`, [m.json().kimlik]);
  });
  it('V-186: itirazlı mahsup durur; ret sürdürür, kabul iptal eder ve düşüleni iade görevine çevirir', async () => {
    await o.sup.query(`UPDATE hakedis_mahsubu SET kalan_eur = 0 WHERE kurulus_ref = $1`, [firma]);
    const { d, h } = await kur({ net: 100 }); const ts = await o.gir('ts'); const tid = await o.gir('tid');
    const m = await o.ist('POST', `/api/dosya/${d.kimlik}/mahsup`, ts, { kurulus: firma, tur: 'Kusur Cezası', tutar: 300, aciklama: 'Kusur', belge: await belge(d.kimlik) }); expect(m.statusCode, m.body).toBe(200); const id = m.json().kimlik;
    const k = await o.kart('Hakediş Mahsubu', id); await o.karar(k.kimlik, 'mfm', 'Onaya Gönder'); await o.karar(k.kimlik, 'tid', 'Onayla');
    await o.sup.query(`UPDATE hakedis_mahsubu SET firma_itiraz = 'Kusur yok', firma_itiraz_zamani = now() WHERE kimlik = $1`, [id]);
    expect((await talimatYap(h)).json()).toMatchObject({ mahsup: 0, tutar: 100 });
    expect((await o.ist('POST', `/api/mahsup/${id}/itiraz-karar`, ts, { karar: 'Ret', gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/mahsup/${id}/itiraz-karar`, tid, { karar: 'Ret' })).statusCode).toBe(400);
    expect((await o.ist('GET', '/api/mahsup-itirazlar', tid)).json().some((x: { kimlik: string }) => x.kimlik === id)).toBe(true);
    expect((await o.ist('POST', `/api/mahsup/${id}/itiraz-karar`, tid, { karar: 'Ret', gerekce: 'Kanıt var' })).json().durum).toBe('Ret');
    const b2 = await kur({ net: 100 }); expect((await talimatYap(b2.h)).json()).toMatchObject({ mahsup: 100, tutar: 0 });
    await o.sup.query(`UPDATE hakedis_mahsubu SET firma_itiraz = 'Yeni', itiraz_sonucu = NULL WHERE kimlik = $1`, [id]);
    const r = await o.ist('POST', `/api/mahsup/${id}/itiraz-karar`, tid, { karar: 'Kabul', gerekce: 'Haklı' }); expect(r.json()).toEqual({ durum: 'Kabul', iade: 100 });
    expect((await o.sup.query(`SELECT statu, kalan_eur FROM hakedis_mahsubu WHERE kimlik = $1`, [id])).rows[0]).toEqual({ statu: 'Reddedildi', kalan_eur: '0.00' });
    expect((await o.kart('Mahsup İadesi', id)).ozet).toContain('100,00 EUR');
    expect((await o.ist('POST', `/api/mahsup/${id}/itiraz-karar`, tid, { karar: 'Kabul', gerekce: 'X' })).statusCode).toBe(409);
  });
  it('YG-841: açık iş bedeli ödemeden ayrı tutulur, kapanınca kalan için talimat açılır', async () => {
    const { d, e, h } = await kur(); const kb = (await o.sup.query(`INSERT INTO kabul_kaydi (dosya_ref, is_emri_ref, kabul_turu, kosul_bitis, kaydeden_ref) VALUES ($1,$2,'Koşullu Kabul','2099-01-01',$3) RETURNING kimlik`, [d.kimlik, e, o.K.tu])).rows[0].kimlik;
    const a = (await o.sup.query(`INSERT INTO acik_is_kalemi (kabul_ref, is_emri_ref, tanim, etki, hedef_tarih, bedel_eur) VALUES ($1,$2,'T','E','2099-01-01',400) RETURNING kimlik`, [kb, e])).rows[0].kimlik;
    const r = await talimatYap(h); expect(r.json()).toMatchObject({ tutulan: 400, tutar: 600 }); const id = r.json().kimlik; await onayla(id); await vadeGecir(id); await listele(id);
    expect((await o.ist('POST', `/api/firma-odemeleri/${id}/odendi`, await o.gir('my'), { referans: `T-${id}` })).statusCode).toBe(200);
    expect(await durum(h)).toBe('Doğrulandı');
    expect((await talimatYap(h)).statusCode).toBe(409);
    await o.sup.query(`UPDATE acik_is_kalemi SET kapanis_zamani = now() WHERE kimlik = $1`, [a]);
    const r2 = await talimatYap(h); expect(r2.json()).toMatchObject({ tutulan: 0, tutar: 400 });
  });
  it('YG-842: avans tahsilatı aşamaz; yalnız Ticari Sorumlu; ödenince sonraki hakedişten düşer', async () => {
    const { d, e } = await kur(); const ts = await o.gir('ts'); const u = `/api/is-emri/${e}/malzeme-avansi`;
    expect((await o.ist('POST', u, ts, { tutar: 100, gerekce: 'G' })).json().hata).toContain('tahsil edilen');
    await o.sup.query(`INSERT INTO tahsilat (fatura_ref, dosya_ref, tutar_eur, tarih, kanal, giren_ref) SELECT kimlik, $1, 150, current_date, 'Havale', $2 FROM musteri_faturasi WHERE dosya_ref = $1`, [d.kimlik, o.K.ts]);
    expect((await o.ist('POST', u, await o.gir('ds'), { tutar: 100, gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, ts, { tutar: 150.01, gerekce: 'G' })).statusCode).toBe(409);
    const a = await o.ist('POST', u, ts, { tutar: 100, gerekce: 'Pompa' }); expect(a.statusCode, a.body).toBe(200);
    const k = await o.kart('Malzeme Avansı', a.json().kimlik); await o.karar(k.kimlik, 'tid', 'Onayla');
    const t = (await o.sup.query(`SELECT kimlik FROM odeme_talimati WHERE avans_ref = $1`, [a.json().kimlik])).rows[0].kimlik; await listele(t);
    expect((await o.ist('POST', `/api/firma-odemeleri/${t}/odendi`, await o.gir('my'), { referans: `V-${t}` })).statusCode).toBe(200);
    const b = await kur({ net: 1000 }); expect((await talimatYap(b.h)).json()).toMatchObject({ mahsup: 100, tutar: 900 });
  });
  it('YG-843: kısmi tahsilatta talimat tahsilat oranında', async () => {
    const { d, h } = await kur({ net: 1000, toplam: 2000 }); await o.sup.query(`INSERT INTO tahsilat (fatura_ref, dosya_ref, tutar_eur, tarih, kanal, giren_ref) SELECT kimlik, $1, 500, current_date - 50, 'Havale', $2 FROM musteri_faturasi WHERE dosya_ref = $1`, [d.kimlik, o.K.ts]);
    const r = await talimatYap(h); expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ tutar: 250, tahsilataBagli: true });
  });
  it('YG-846: firma faturası tarih veya kuru tutmazsa talimat reddedilir', async () => {
    const { h } = await kur(); await o.sup.query(`UPDATE hakedis SET firma_fatura_kuru = 40.6 WHERE kimlik = $1`, [h]);
    expect((await talimatYap(h)).json().hata).toContain('aynı değildir');
    await o.sup.query(`UPDATE hakedis SET firma_fatura_kuru = NULL WHERE kimlik = $1`, [h]);
    expect((await talimatYap(h)).json().hata).toContain('tarih ve kuru');
  });
});

describe('görev ayrılığı (YG-827, YG-828)', () => {
  it('teknik kabulü veren talimatı onaylayamaz; rolün tek sahibiyse onay üst role çıkar', async () => {
    const { h, e } = await kur(); await o.sup.query(`UPDATE is_emri SET teknik_kabul_eden_ref = $2 WHERE kimlik = $1`, [e, o.K.mfm]);
    const id = (await talimatYap(h)).json().kimlik; const k = await o.kart('Firma Ödeme Talimatı', id);
    const ad = (await o.sup.query(`SELECT r.rol_adi FROM unnest($1::text[]) z JOIN rol r ON r.kimlik = z`, [k.zincir])).rows.map((x) => x.rol_adi as string);
    expect(ad).not.toContain('Muhasebe ve Finans Müdürü');
    const k2 = await kur(); await o.sup.query(`UPDATE is_emri SET teknik_kabul_eden_ref = $2 WHERE kimlik = $1`, [k2.e, o.K.tid]);
    const id2 = (await talimatYap(k2.h)).json().kimlik; const kk = await o.kart('Firma Ödeme Talimatı', id2);
    expect((await o.sup.query(`SELECT ayrik_kullanicilar a FROM is_karti WHERE kimlik = $1`, [kk.kimlik])).rows[0].a).toContain(o.K.tid);
  });
});
