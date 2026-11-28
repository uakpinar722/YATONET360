import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aydinlatmaKodu } from '../src/adimlar.js';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { ana, ortamKur, PAROLA, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', ty: 'Teknik Yönetici' };
const EP = 'eksper1@deneme.yatonet.local';
let o: Ortam;
const eksperGir = async () => {
  const c = ana.ckr(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: EP, parola: PAROLA } }));
  const q = await o.ist('GET', '/api/kimlik/kurulum', c);
  return ana.ckr(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
};

beforeAll(async () => { o = await ortamKur('yatonet360_test_eksper', KADRO); });
afterAll(async () => { await o.kapat(); });

describe('bağımsız Sigorta Eksperi (YG-1570)', () => {
  it('Dosya Sorumlusu ekler; eksper davetleri, parça randevusu, ekspertiz raporu ve sınırsız teklif onayı kendi ekranında', async () => {
    const d = await o.dosyaAc(); const ds = await o.gir('ds');
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const u = `/api/dosya/${d.kimlik}/eksper`;
    expect((await o.ist('POST', u, await o.gir('opm'), { ad: 'Deneme Eksper', eposta: EP })).statusCode).toBe(404);
    expect((await o.ist('POST', u, ds, { ad: 'Deneme Eksper' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ad: 'Başka', eposta: 'ds@deneme.yatonet.local' })).statusCode).toBe(409); // iç hesap eksper yapılamaz
    const r = await o.ist('POST', u, ds, { ad: 'Deneme Eksper', eposta: EP, unvan: 'Deneme Ekspertiz' }); expect(r.statusCode, r.body).toBe(200); expect(r.json().davet).toBe(true);
    expect((await o.ist('POST', u, ds, { ad: 'Deneme Eksper', eposta: EP })).statusCode).toBe(409);
    expect((await o.sup.query(`SELECT kullanici_grubu FROM kullanici_hesabi WHERE e_posta = $1`, [EP])).rows[0].kullanici_grubu).toBe('Sigorta Şirketi / Eksper');
    // Davetle açılan hesabın ilk girişi tamamlanmış sayılır (parola, aydınlatma, kullanım koşulları).
    const h = (await o.sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = (SELECT parola_ozeti FROM kullanici_hesabi WHERE kimlik = $2), izin_adimi_zamani = now() WHERE e_posta = $1 RETURNING kimlik`, [EP, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Müşteri',$2,'R00','Türkçe','Web')`, [h, aydinlatmaKodu('Sigorta Şirketi / Eksper')]);
    await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [h]);
    await o.sup.query(`UPDATE davet SET kullanildi = now() WHERE kullanici_ref = $1`, [h]).catch(() => {});
    const e = await eksperGir();
    const a0 = (await o.ist('GET', '/api/eksper/ana', e)).json(); expect(a0).toMatchObject({ eksper: true, unvan: 'Deneme Ekspertiz', davetler: [], parcalar: [] });
    expect((await o.ist('GET', '/api/eksper/ana', ds)).json()).toEqual({});
    expect((await o.ist('GET', '/api/sigorta/ana', e)).json().dosyalar.map((x: { kimlik: string }) => x.kimlik)).toContain(d.kimlik);

    // Tanıklık daveti: eksper/klas işaretli noktada eksper yanıt verir; Dosya Sorumlusu bilgilendirilir.
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-EK','EK','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const ie = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K','Aktif',$4) RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.ds])).rows[0].kimlik;
    const kn = (await o.sup.query(`INSERT INTO kontrol_noktasi (kontrol_noktasi_no, is_emri_ref, nokta_turu, kontrol_ozelligi, kabul_olcutu, planlanan_zaman, eksper_klas, olusturan_ref) VALUES ($1,$2,'Tanıklık','Basınç testi','Kaçak yok', now() + interval '3 days', true, $3) RETURNING kimlik`, [`${d.dosyaNo}-KP01`, ie, o.K.ty])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO kontrol_noktasi (kontrol_noktasi_no, is_emri_ref, nokta_turu, kontrol_ozelligi, kabul_olcutu, planlanan_zaman, eksper_klas, olusturan_ref) VALUES ($1,$2,'Tanıklık','İç kontrol','Uygun', now() + interval '3 days', false, $3)`, [`${d.dosyaNo}-KP02`, ie, o.K.ty]);
    const a1 = (await o.ist('GET', '/api/eksper/ana', e)).json(); expect(a1.davetler.map((x: { no: string }) => x.no)).toEqual([`${d.dosyaNo}-KP01`]);
    expect((await o.ist('POST', `/api/eksper/davet/${kn}/yanit`, e, { yanit: 'Belki' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/eksper/davet/${kn}/yanit`, e, { yanit: 'Katılacağım' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/eksper/davet/${kn}/yanit`, e, { yanit: 'Katılmayacağım' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/eksper/ana', e)).json().davetler[0].yanit).toBe('Katılmayacağım');
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE '%Sigorta Eksperi: Katılmayacağım'`, [o.K.ds])).rows[0].n).toBe(1);
    expect((await o.ist('POST', `/api/eksper/davet/${kn}/yanit`, ds, { yanit: 'Katılacağım' })).statusCode).toBe(404);

    // Parça incelemesi: bekletme süresi içinde randevu talebi Dosya Sorumlusuna görev olarak düşer; planlanınca görev kapanır.
    const ru = `/api/eksper/dosya/${d.kimlik}/randevu`; const ileri = (g: number) => new Date(Date.now() + g * 86_400_000).toISOString();
    expect((await o.ist('POST', ru, e, { zaman: ileri(2) })).statusCode).toBe(409);
    await o.sup.query(`INSERT INTO sokulen_parca (dosya_ref, parca_adi, secim, son_tarih, giren_ref) VALUES ($1,'Şaft','Sigorta Eksperi İncelemesi İçin Bekletme', current_date + 30, $2), ($1,'Pervane','Sigorta Eksperi İncelemesi İçin Bekletme', current_date + 30, $2)`, [d.kimlik, o.K.ds]);
    expect((await o.ist('GET', '/api/eksper/ana', e)).json().parcalar[0]).toMatchObject({ dosya: d.kimlik, parca: 2 });
    expect((await o.ist('POST', ru, e, { zaman: ileri(40) })).statusCode).toBe(400);
    const rv = await o.ist('POST', ru, e, { zaman: ileri(5), not: 'Sabah uygun' }); expect(rv.statusCode, rv.body).toBe(200);
    expect((await o.ist('POST', ru, e, { zaman: ileri(6) })).statusCode).toBe(409);
    expect((await o.kart('Eksper İnceleme Randevusu', d.kimlik)).sahip_kullanici_ref).toBe(o.K.ds);
    const dv = (await o.ist('GET', u, ds)).json(); expect(dv.eksperler[0]).toMatchObject({ ad: 'Deneme Eksper', unvan: 'Deneme Ekspertiz' }); expect(dv.yanitlar[0].yanit).toBe('Katılmayacağım');
    expect((await o.ist('POST', `/api/eksper-randevu/${rv.json().kimlik}/planla`, ds, { zaman: ileri(5) })).statusCode).toBe(200);
    expect((await o.kart('Eksper İnceleme Randevusu', d.kimlik)).durum).toBe('Tamamlandı');
    expect((await o.ist('GET', '/api/eksper/ana', e)).json().parcalar[0].randevu.durum).toBe('Planlandı');

    // Ekspertiz raporu: eksper yalnız bu türde ve yalnız görevli olduğu dosyaya yükler.
    const yukle = (tur: string, dosya: string) => o.s.inject({ method: 'POST', url: `/api/belge/yukle?ad=${encodeURIComponent('Ekspertiz Raporu')}&tur=${encodeURIComponent(tur)}&bagTuru=Dosya&bagKimligi=${dosya}&kaynak=Sistem&dosya=r.pdf`, headers: { ...ana.H, 'content-type': 'application/octet-stream' }, cookies: { [COOKIE_ADI]: e }, payload: Buffer.from(`%PDF-1.4 ${Math.random()}`) });
    expect((await yukle('Dosya Belgesi', d.kimlik)).statusCode).toBe(403);
    const d2 = await o.dosyaAc(); expect((await yukle('Ekspertiz Raporu', d2.kimlik)).statusCode).toBe(403);
    const yr = await yukle('Ekspertiz Raporu', d.kimlik); expect(yr.statusCode, yr.body).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE '%Ekspertiz Raporu Yüklendi'`, [o.K.ds])).rows[0].n).toBe(1);

    // Teklif onayı: eksperde görevlendirmedeki yazılı yetki sınırı aranmaz.
    await o.sup.query(`INSERT INTO sigorta_gorevlendirme (talep_ref, sigortaci_adi, hasar_no, yetki_siniri_eur, kaydeden_ref) SELECT talep_ref, 'Deneme Sigorta', 'H-1', 1, $2 FROM dosya WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, ara_toplam_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref, sigorta_karar_son) VALUES ($1,$2,'Sigorta Şirketi',20,'Gönderildi',150,180,150,$3,now() + interval '5 days') RETURNING kimlik`, [`${d.dosyaNo}-FT01`, d.kimlik, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur) VALUES ($1,1,'Boya','Onarım','İşçilik',1,'saat',115.38,150,150)`, [t]);
    const k = await o.ist('POST', `/api/sigorta/teklif/${t}/karar`, e, { siralar: [1] }); expect(k.statusCode, k.body).toBe(200); expect(k.json().karar).toBe('Tam Onay');
  });
});
