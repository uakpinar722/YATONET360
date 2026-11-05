import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disMetinEngeli, teknikKabulAyrimi, yetkiIsle, yetkiliOnaylari, yetkiliyeDevret } from '../src/yetki_ek.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', tod: 'Teknik ve Operasyon Direktörü', hud: 'Hukuk ve Uyum Direktörü', huu: 'Hukuk ve Uyum Uzmanı', bim: 'Bilgi İşlem Müdürü', sy: 'Sistem Yöneticisi', mp: 'Müşteri ve Paydaş İlişkileri Müdürü', gmy: 'Genel Müdür Yardımcısı', ikm: 'İnsan Kaynakları Müdürü' };
let o: Ortam; let n = 0;
const firma = async (ad: string, rol = 'Çözüm Ortağı') => (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, olusturan_ref) VALUES ($1,$2,$3,'Onaylı','Aktif',$4) RETURNING kimlik`, [`S-Y${++n}`, ad, rol, o.K.ds])).rows[0].kimlik as string;
const belge = async (d: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'K','Gizli','Dosya',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`B-${Math.random()}`, d, o.K.ds])).rows[0].kimlik as string;

beforeAll(async () => { o = await ortamKur('yatonet360_test50', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('görev ayrılığı (YG-1036, YG-1037)', () => {
  it('teklifi onaylayan ve kaliteyi doğrulayan teknik kabul veremez', async () => {
    const d = await o.dosyaAc({}, {}); const f = await firma('Ayrım Firması');
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, hazirlayan_ref) VALUES ($1,'KN',$2,$3,'Y','K',$4) RETURNING kimlik`, [`IE-${++n}`, d.kimlik, f, o.K.ds])).rows[0].kimlik;
    const ie = { kimlik: e, dosya_ref: d.kimlik };
    expect(await teknikKabulAyrimi(o.db, ie, o.K.tu!)).toBeNull();
    await o.sup.query(`INSERT INTO kontrol_noktasi (kontrol_noktasi_no, is_emri_ref, nokta_turu, kontrol_ozelligi, kabul_olcutu, planlanan_zaman, dogrulayanlar, olusturan_ref) VALUES ($1,$2,'Gözetim','Ö','K',now(),ARRAY[$3],$4)`, [`KN-${++n}`, e, o.K.tu, o.K.ds]);
    expect(await teknikKabulAyrimi(o.db, ie, o.K.tu!)).toContain('kalite');
  });
});

describe('gizlilik (YG-1167, YG-1623)', () => {
  it('firma adı müşteriye, sigorta bilgisi firmaya gitmez; marina serbest', async () => {
    await firma('Gizli Tersane Ltd');
    expect(await disMetinEngeli(o.db, { telefon: '+905550000099', metin: 'İşiniz Gizli Tersane Ltd tarafından yapılacak', konu: 'K' })).toContain('Firma kimliği');
    expect(await disMetinEngeli(o.db, { telefon: '+905550000099', metin: 'İşiniz başlıyor', konu: 'K' })).toBeNull();
    const d = await o.dosyaAc({}, {}); const t = (await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kurulus_unvani, kisi_adi_soyadi) VALUES ($1,'Sigorta Şirketi','Mavi Sigorta AŞ','Yetkili') RETURNING kimlik`, [d.kimlik])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigorta_taraf_ref, sigorta_hasar_dosya_no) VALUES ($1,$2,'HSR-778899') ON CONFLICT (dosya_ref) DO UPDATE SET sigorta_taraf_ref = EXCLUDED.sigorta_taraf_ref, sigorta_hasar_dosya_no = EXCLUDED.sigorta_hasar_dosya_no`, [d.kimlik, t]);
    await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kurumsal_eposta, olusturan_ref) VALUES ('S-FE','Firma E','Çözüm Ortağı','firma@e.local',$1), ('S-TE','Marina Tesis','Tesis','marina@e.local',$1)`, [o.K.ds]);
    expect(await disMetinEngeli(o.db, { eposta: 'firma@e.local', metin: 'Hasar no HSR-778899', konu: 'K' })).toContain('Sigorta');
    expect(await disMetinEngeli(o.db, { eposta: 'firma@e.local', metin: 'Mavi Sigorta AŞ işi', konu: 'K' })).toContain('Sigorta');
    expect(await disMetinEngeli(o.db, { eposta: 'firma@e.local', metin: 'İş emriniz hazır', konu: 'K' })).toBeNull();
    expect(await disMetinEngeli(o.db, { eposta: 'marina@e.local', metin: 'Gizli Tersane Ltd gelecek', konu: 'K' })).toBeNull();
  });
  it('firma kimliği açıklaması mahkeme talebi ve Hukuk ve Uyum Direktörü onayıyla', async () => {
    const d = await o.dosyaAc({}, {}); const f = await firma('Açıklanan Firma'); const P = { firma: f, makam: 'Mahkeme', dayanak: 'Esas 2026/1', belge: await belge(d.kimlik), duzey: 'Unvan' }; const u = `/api/dosya/${d.kimlik}/firma-kimlik-aciklama`;
    expect((await o.ist('POST', u, await o.gir('ds'), P)).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('huu'), { ...P, makam: 'Müşteri' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, await o.gir('huu'), P); expect(r.statusCode, r.body).toBe(200);
    const k = await o.kart('Firma Kimliği Açıklama', r.json().kimlik); expect((await o.karar(k.kimlik, 'hud', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, onaylayan_ref FROM firma_kimlik_aciklama WHERE kimlik = $1`, [r.json().kimlik])).rows[0]).toEqual({ durum: 'Onaylandı', onaylayan_ref: o.K.hud });
  });
  it('firma ve tedarikçi araması: dosya, iş emri, yat; hasar numarası sonuç değil', async () => {
    const d = await o.dosyaAc({}, {}); const f = await firma('Arayan Firma');
    await o.sup.query(`INSERT INTO kurulus_kullanici VALUES ($1,$2)`, [f, o.K.oy]);
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, hazirlayan_ref) VALUES ($1,'KN',$2,$3,'Y','K',$4)`, [`IE-A${++n}`, d.kimlik, f, o.K.ds]);
    const r = await o.ist('GET', `/api/firma-portal/ara?q=${d.dosyaNo}`, await o.gir('oy')); expect(r.statusCode, r.body).toBe(200); expect(r.json()).toHaveLength(1); expect(Object.keys(r.json()[0])).not.toContain('sigorta_hasar_dosya_no');
    expect((await o.ist('GET', '/api/firma-portal/ara?q=HSR-778899', await o.gir('oy'))).json()).toHaveLength(0);
    expect((await o.ist('GET', '/api/firma-portal/ara?q=X1', await o.gir('tu'))).statusCode).toBe(404);
  });
});

describe('Kritik erişim, bilet, hasar paylaşımı (YG-1160, YG-1001, YG-1171)', () => {
  it('Kritik belgeyi yalnız yükleyen ve listelenen kişi görür', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); const bl = await belge(d.kimlik); await o.sup.query(`UPDATE belge SET bilgi_sinifi = 'Kritik' WHERE kimlik = $1`, [bl]);
    expect((await o.ist('POST', `/api/belge/${bl}/erisim-grubu`, await o.gir('tu'), { kullanici: o.K.tu })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/belge/${bl}/erisim-grubu`, await o.gir('ds'), { kullanici: o.K.tu })).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/belge/${bl}/erisim-grubu`, await o.gir('ds'))).json().map((x: { kimlik: string }) => x.kimlik)).toContain(o.K.tu);
  });
  it('müdahale bileti: BİM onayı, kişisel veride veri sahibi, kanıtsız kapanmaz', async () => {
    const sy = await o.gir('sy');
    expect((await o.ist('POST', '/api/degisiklik-bileti', await o.gir('ds'), { konu: 'K', gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/degisiklik-bileti', sy, { konu: 'K', gerekce: 'G', kisiselVeri: true })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/degisiklik-bileti', sy, { konu: 'K', gerekce: 'G', kisiselVeri: true, veriSahibiRol: 'İnsan Kaynakları Müdürü' }); expect(r.statusCode, r.body).toBe(200); expect(r.json().biletNo).toMatch(/^DGS-/);
    const k = await o.kart('Değişiklik Bileti', r.json().kimlik); expect(k.zincir).toHaveLength(2);
    await o.karar(k.kimlik, 'bim', 'Onaya Gönder'); await o.karar(k.kimlik, 'ikm', 'Onayla');
    const u = `/api/degisiklik-bileti/${r.json().kimlik}/kapat`; const d = await o.dosyaAc({}, {});
    expect((await o.ist('POST', u, sy, {})).statusCode).toBe(400);
    expect((await o.ist('POST', u, sy, { oncesi: await belge(d.kimlik), sonrasi: await belge(d.kimlik) })).statusCode).toBe(200);
  });
  it('hasar bilgisi paylaşımı hiyerarşik; çift onay seçilirse iki kademe', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); const ds = await o.gir('ds');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/hasar-paylasim`, ds, { alici: 'Eksper', kapsam: 'Fotoğraf', cift: true }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.kart('Hasar Bilgisi Paylaşımı', r.json().kimlik)).zincir).toHaveLength(2);
  });
});

describe('Yat Yetkilisi onayı ve süre (YG-1031, YG-1070, YG-1086, YG-1566)', () => {
  const yetkili = async (ek: string[], limit: number | null, bitis: string) => {
    const k = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, cep_telefonu, dogrulama_yontemi) VALUES ('Müşteri/Kurum','Bireysel Müşteri (Yat Sahibi/Yetkilisi)','Kaptan Y',$1,$1,'SMS kodu') RETURNING kimlik`, [`+90555${String(1000000 + Math.floor(Math.random() * 8999999))}`])).rows[0].kimlik as string;
    await o.sup.query(`INSERT INTO yat_yetkilisi_kaydi (kullanici_ref, rol, sahip_ad, sahip_telefon, belge_durumu, islem_turleri, ust_limit_eur, bitis_tarihi) VALUES ($1,'Yatın Kaptanı','Sahip','+905559998877','Geçerli',$2,$3,$4)`, [k, ek, limit, bitis]); return k;
  };
  const onay = async (kod: string, tutar: number | null) => (await o.sup.query(`INSERT INTO onay_talebi (ony_kod, baslik, metin, dugme, telefon, tutar_eur, alici_ad, son_gecerlilik, belirtec_ozeti) VALUES ($1,'B','M','D','+905559998877',$2,'Sahip', now() + interval '1 day', md5(random()::text)) RETURNING kimlik`, [kod, tutar])).rows[0].kimlik as string;
  it('yalnız kapsam, limit ve süre içindeki onay; devirde asıl sahip saklanır; süre dolunca düşer', async () => {
    const k = await yetkili(['ONY-07'], 1000, '2099-01-01'); const a = await onay('ONY-07', 500); const b = await onay('ONY-07', 5000); const c = await onay('ONY-09', 10);
    const l = (await yetkiliOnaylari(o.db, k)).map((x) => x.kimlik); expect(l).toContain(a); expect(l).not.toContain(b); expect(l).not.toContain(c);
    expect(await yetkiliyeDevret(o.db, b, k)).toBe(false);
    expect(await yetkiliyeDevret(o.db, a, k)).toBe(true);
    expect((await o.sup.query(`SELECT adina_onay_sahibi, alici_kullanici_ref FROM onay_talebi WHERE kimlik = $1`, [a])).rows[0]).toEqual({ adina_onay_sahibi: 'Sahip', alici_kullanici_ref: k });
    const es = await yetkili(['ONY-07'], 1000, '2020-01-01'); expect(await yetkiliOnaylari(o.db, es)).toHaveLength(0);
    await yetkiIsle(o.db); expect((await o.sup.query(`SELECT belge_durumu FROM yat_yetkilisi_kaydi WHERE kullanici_ref = $1`, [es])).rows[0].belge_durumu).toBe('Bekleniyor');
  });
  it('genel yetki reddedilir; limit ve bitiş zorunlu', async () => {
    const k = await yetkili([], null, '2099-01-01'); await o.sup.query(`UPDATE yat_yetkilisi_kaydi SET belge_durumu = 'Kontrolde' WHERE kullanici_ref = $1`, [k]); const mp = await o.gir('mp'); const u = `/api/yat-yetkilisi/${k}/dogrula`;
    expect((await o.ist('POST', u, mp, { islemler: ['Genel'], limit: 10, bitis: '2099-01-01' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, mp, { islemler: ['ONY-07'], bitis: '2099-01-01' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, mp, { islemler: ['ONY-07'], limit: 10, bitis: '2099-01-01' })).statusCode).toBe(200);
  });
});

describe('dış kullanıcı sızıntı denetimi (YG-296, YG-993, YG-1076, YG-1159, YG-1174, YG-1623)', () => {
  it('yat sahibi ve sigorta uçları firma adı, hasar sırrı ve takyidat dönmez; dış kullanıcıya iç uçlar kapalı', async () => {
    const ad = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi) SELECT 'Müşteri/Kurum', 'Bireysel Müşteri (Yat Sahibi/Yetkilisi)', 'Dis', 'dis@x.local', 'dis@x.local', parola_ozeti, dogrulama_yontemi FROM kullanici_hesabi WHERE kimlik = $1 RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1, 'Müşteri', 'KVKK-01', 'R00', 'Türkçe', 'Web')`, [ad]);
    await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [ad]); await o.sup.query(`UPDATE kullanici_hesabi SET izin_adimi_zamani = now() WHERE kimlik = $1`, [ad]);
    const d = await o.dosyaAc({}, {}); const f = await firma('Sızıntı Testi Tersanesi');
    await o.sup.query(`UPDATE dosya_tarafi SET kullanici_ref = $2 WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik, ad]);
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, hazirlayan_ref) VALUES ($1,'KN',$2,$3,'Y','K',$4)`, [`IE-S${++n}`, d.kimlik, f, o.K.ds]);
    const giris = await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: { 'x-yatonet': '1' }, payload: { kimlik: 'dis@x.local', parola: 'Sinama-Parolasi-2026!' } });
    const c = giris.cookies[0]!.value; const q = await o.ist('GET', '/api/kimlik/kurulum', c);
    const { totpKodu, suankiAdim } = await import('../src/kripto.js'); const c2 = (await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) })).cookies[0]!.value;
    for (const u of ['/api/portal/ana', `/api/portal/dosya/${d.kimlik}`]) { const r = await o.ist('GET', u, c2); expect(r.statusCode, r.body).toBe(200); expect(r.body).not.toContain('Sızıntı Testi Tersanesi'); expect(r.body).not.toContain('takyidat'); }
    for (const u of ['/api/firma/uygunluk', '/api/imha-listesi', '/api/veri-ihlali', '/api/ik/personel', '/api/kaptanlar', '/api/mahsup-itirazlar', '/api/riza-kayitlari', '/api/puantaj/ozet?ay=2026-11']) expect((await o.ist('GET', u, c2)).statusCode, u).toBeGreaterThanOrEqual(403);
  });
});
