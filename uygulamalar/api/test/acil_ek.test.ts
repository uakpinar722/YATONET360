import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { nobetCagriIsle } from '../src/acil_ek.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { ana, ortamKur, PAROLA, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', omy: 'Operasyon Müdür Yardımcısı', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', tod: 'Teknik ve Operasyon Direktörü', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', gmy: 'Genel Müdür Yardımcısı', sc: 'Sicil Sorumlusu', bid: 'Bilgi İşlem Destek Sorumlusu', bim: 'Bilgi İşlem Müdürü', hud: 'Hukuk ve Uyum Direktörü' };
let o: Ortam;
const ck = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
const giris = async (ep: string) => { const c = ck(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: ep, parola: PAROLA } })); const g = (await o.ist('GET', '/api/kimlik/kurulum', c)).json().gizli as string; return { c: ck(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(g, suankiAdim()) })), g }; };

beforeAll(async () => { o = await ortamKur('yatonet360_test39', KADRO); await o.sup.query(`INSERT INTO sirket_bilgisi VALUES ('destek_hatti','0000')`); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('nöbet çağrısı (YG-243)', () => {
  it('15 dakikada dönülmezse sırayla üst katmana çıkar; dönülünce durur', async () => {
    const ds = await o.gir('ds');
    expect((await o.ist('POST', '/api/nobet/cagri', ds, { hat: 'Yanlış', arayan: 'A', ozet: 'Ö' })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/nobet/cagri', ds, { hat: 'Operasyon', arayan: 'Kaptan', telefon: '05', ozet: 'Su alıyor' }); expect(r.statusCode, r.body).toBe(200);
    expect(await nobetCagriIsle(o.db)).toBe(0);
    const rol = async () => (await o.sup.query(`SELECT sorumlu_rol, kademe FROM nobet_cagrisi WHERE kimlik = $1`, [r.json().kimlik])).rows[0];
    let t = Date.now() + 16 * 60_000; await nobetCagriIsle(o.db, new Date(t)); expect((await rol()).sorumlu_rol).toBe('Operasyon Yöneticisi');
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE 'Yanıtsız Nöbet%'`, [o.K.oy])).rowCount).toBe(1);
    t += 16 * 60_000; await nobetCagriIsle(o.db, new Date(t)); expect((await rol()).sorumlu_rol).toBe('Operasyon Müdür Yardımcısı');
    t += 16 * 60_000; await nobetCagriIsle(o.db, new Date(t)); expect((await rol()).sorumlu_rol).toBe('Operasyon Müdürü');
    expect((await o.ist('GET', '/api/nobet/cagrilar', ds)).json()).toHaveLength(1);
    expect((await o.ist('POST', `/api/nobet/cagri/${r.json().kimlik}/donus`, ds, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/nobet/cagri/${r.json().kimlik}/donus`, ds, { not: 'Arandı' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/nobet/cagri/${r.json().kimlik}/donus`, ds, { not: 'Arandı' })).statusCode).toBe(409);
    expect(await nobetCagriIsle(o.db, new Date(t + 3_600_000))).toBe(0);
  });
});

describe('olay komutası (YG-261)', () => {
  it('BT kesintisinde Cilt II tablosundaki roller bilgilenir', async () => {
    const r = await o.ist('POST', '/api/olay-komutasi', await o.gir('ds'), { tur: 'BT Kesintisi veya Veri İhlali', ozet: 'Sunucu kapalı' }); expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ ilkMudahale: 'Bilgi İşlem Destek Sorumlusu', olayYoneticisi: ['Bilgi İşlem Müdürü', 'Hukuk ve Uyum Direktörü'] });
    for (const k of [o.K.bid, o.K.bim, o.K.hud, o.K.gmy]) expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari LIKE $2`, [k, `olay:${r.json().kimlik}%`])).rowCount).toBe(1);
    expect((await o.ist('POST', '/api/olay-komutasi', await o.gir('ds'), { tur: 'Yok', ozet: 'X' })).statusCode).toBe(400);
  });
});

describe('temas ve BLD-56 (YG-1481, YG-1506, YG-277)', () => {
  it('muhatap listesi; refakatli girişte mesaj ve görev', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'sahip@acil.local' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]); const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/acil/${d.kimlik}/temas`, ds, { tur: 'Polis', ozet: 'X' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/acil/${d.kimlik}/temas`, ds, { tur: 'Sahil Güvenlik', ozet: 'Bildirildi' })).statusCode).toBe(200);
    const r = await o.ist('POST', `/api/acil/${d.kimlik}/temas`, ds, { tur: 'Refakatli Giriş', ozet: 'Marina görevlisiyle' }); expect(r.statusCode, r.body).toBe(200);
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld56:${r.json().kimlik}%`])).rows[0].metin as string; expect(m).toContain('0000'); expect(m).not.toContain('[');
    expect((await o.ist('GET', `/api/acil/${d.kimlik}/temas`, ds)).json()).toHaveLength(2);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Refakatli Giriş Araması' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
  });
});

describe('olağanüstü dönem (YG-1459, YG-1489, YG-265)', () => {
  it('öneri Operasyon Müdürü; GMY görüş sonrası CEO ulaşılamazsa GMY ilan eder; kapanış; aciliyet sırası', async () => {
    expect((await o.ist('POST', '/api/olaganustu/oneri', await o.gir('ds'), { bolge: 'Muğla', olay: 'Fırtına' })).statusCode).toBe(403);
    const r = await o.ist('POST', '/api/olaganustu/oneri', await o.gir('opm'), { bolge: 'Muğla', olay: 'Fırtına' }); expect(r.statusCode, r.body).toBe(200);
    const k = await o.kart('Olağanüstü Dönem İlanı', r.json().kimlik); expect(k.zincir).toHaveLength(2);
    expect((await o.karar(k.kimlik, 'gmy', 'Onaya Gönder')).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/olaganustu/oneri/${r.json().kimlik}/gmy-ilan`, await o.gir('gmy'), {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/olaganustu/oneri/${r.json().kimlik}/gmy-ilan`, await o.gir('ds'), { gerekce: 'G' })).statusCode).toBe(404);
    const il = await o.ist('POST', `/api/olaganustu/oneri/${r.json().kimlik}/gmy-ilan`, await o.gir('gmy'), { gerekce: 'CEO aranıyor, ulaşılamadı' }); expect(il.statusCode, il.body).toBe(200);
    expect((await o.sup.query(`SELECT bolge FROM olaganustu_donem WHERE bitis IS NULL`)).rows[0].bolge).toBe('Muğla');
    expect((await o.ist('POST', '/api/olaganustu/oneri', await o.gir('opm'), { bolge: 'B', olay: 'O' })).statusCode).toBe(409);
    const a = await o.dosyaAc({}, {}); const b = await o.dosyaAc({}, {}); await o.ekipKur(a.kimlik); await o.ekipKur(b.kimlik);
    await o.sup.query(`INSERT INTO acil_mudahale (dosya_ref, olay_turu, tehlike, talimat_veren_ref) VALUES ($1,'Sürüklenme veya Bağlama Tehlikesi','T',$2),($3,'Can Güvenliği','T',$2)`, [a.kimlik, o.K.ds, b.kimlik]);
    const s = (await o.ist('GET', '/api/olaganustu/sira', await o.gir('ds'))).json() as { dosya_no: string; sira: number }[];
    expect(s[0]!.dosya_no).toBe(b.dosyaNo); expect(s.findIndex((x) => x.dosya_no === a.dosyaNo)).toBeLessThan(s.findIndex((x) => x.sira === 6));
    expect((await o.ist('POST', '/api/olaganustu/bitir', await o.gir('ds'), {})).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/olaganustu/bitir', await o.gir('opm'), {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM olaganustu_donem WHERE bitis IS NULL`)).rowCount).toBe(0);
  });
});

describe('kurtarma (YG-210, YG-276, YG-486, YG-1515)', () => {
  let d: { kimlik: string; dosyaNo: string }; let firma: string; let frm: { c: string; g: string }; let tod: { c: string; g: string };
  const YENI = async () => {
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/kurtarma`, await o.gir('ds'), { hizmet: 'Dalgıçlık', saglayici: firma, acil: false }); expect(r.statusCode, r.body).toBe(200); return r.json().kimlik as string;
  };
  beforeAll(async () => {
    d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'kurtarma@acil.local', telefon = '05000000000' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]);
    firma = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-K','Kurtarma Firma','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    for (const b of ['Türk Bayrağı Belgesi', 'Römorkörcülük Faaliyet İzni', 'Dalış Belgesi']) await o.sup.query(`INSERT INTO sicil_belgesi (kurulus_ref, tur) VALUES ($1,$2)`, [firma, b]);
    const oz = await parolaOzetle(PAROLA);
    const fk = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani) VALUES ('Dış','İş Birliği Firması','F','frm.kurtarma','frm@kurtarma.local',$1,'Doğrulama uygulaması (6 haneli kod)',now()) RETURNING kimlik`, [oz])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO kurulus_kullanici (kurulus_ref, kullanici_ref) VALUES ($1,$2)`, [firma, fk]);
    await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Çalışan','KVKK-03','R00','Türkçe','Web')`, [fk]);
    await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [fk]);
    frm = await giris('frm@kurtarma.local');
    const te = (await o.sup.query(`SELECT e_posta FROM kullanici_hesabi WHERE kimlik = $1`, [o.K.tod])).rows[0].e_posta; tod = await giris(te);
  });
  it('acil olmayanda üçlü onay olmadan, dalışta belge olmadan başlamaz; yat sahibi onayı ONY-30', async () => {
    const k = await YENI();
    const u = `/api/kurtarma/${k}/baslat`; const ds = await o.gir('ds');
    expect((await o.ist('POST', u, ds, {})).json().hata).toContain('Üç tarafın');
    const on = (await o.sup.query(`SELECT t.ony_kod, t.tutar_eur FROM kurtarma_operasyonu k JOIN onay_talebi t ON t.kimlik = k.onay_talebi_ref WHERE k.kimlik = $1`, [k])).rows[0]; expect(on.ony_kod).toBe('ONY-30'); expect(on.tutar_eur).toBeNull();
    expect((await o.ist('POST', `/api/firma-portal/kurtarma/${k}/onay`, frm.c, { kod: '000000' })).statusCode).toBe(401);
    expect((await o.ist('POST', `/api/firma-portal/kurtarma/${k}/onay`, ds, { kod: '000000' })).statusCode).toBe(404);
    await o.sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 0 WHERE e_posta = 'frm@kurtarma.local'`);
    expect((await o.ist('POST', `/api/firma-portal/kurtarma/${k}/onay`, frm.c, { kod: totpKodu(frm.g, suankiAdim()) })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/kurtarma/${k}/koordinator-onay`, ds, { kod: '000000' })).statusCode).toBe(403);
    await o.sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 0 WHERE kimlik = $1`, [o.K.tod]);
    expect((await o.ist('POST', `/api/kurtarma/${k}/koordinator-onay`, tod.c, { kod: totpKodu(tod.g, suankiAdim()) })).statusCode).toBe(200);
    expect((await o.ist('POST', u, ds, {})).json().hata).toContain('Üç tarafın');
    await o.sup.query(`UPDATE kurtarma_operasyonu SET yat_sahibi_onay_zamani = now() WHERE kimlik = $1`, [k]);
    expect((await o.ist('POST', u, ds, {})).json().hata).toContain('Liman izni');
    const bl = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('Dalış','K','Gizli','Dosya',$1,'Sistem',current_date,$2) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    expect((await o.ist('POST', u, ds, { limanIzni: bl, dalisPlani: bl, enerjiIzolasyonu: bl })).statusCode).toBe(200);
  });
  it('acilde iş onay beklemez; yine de dalış belgesi aranır', async () => {
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/kurtarma`, await o.gir('ds'), { hizmet: 'Çekme / Refakat', saglayici: firma, acil: true }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', `/api/kurtarma/${r.json().kimlik}/baslat`, await o.gir('ds'), {})).statusCode).toBe(200);
    const r2 = await o.ist('POST', `/api/dosya/${d.kimlik}/kurtarma`, await o.gir('ds'), { hizmet: 'Dalgıçlık', saglayici: firma, acil: true });
    expect((await o.ist('POST', `/api/kurtarma/${r2.json().kimlik}/baslat`, await o.gir('ds'), {})).json().hata).toContain('Liman izni');
  });
});

describe('acil müsaitlik (YG-273) ve firma yanıtı (YG-1483)', () => {
  it('sicil sıra verir, firma müsaitlik ve yanıt süresi bildirir', async () => {
    const f = (await o.sup.query(`SELECT kurulus_ref FROM kurulus_kullanici LIMIT 1`)).rows[0]?.kurulus_ref ?? (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-M','M','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    expect((await o.ist('POST', `/api/firma/${f}/acil-bilgi`, await o.gir('ds'), { hizmetVerir: true, aramaSirasi: 1 })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/firma/${f}/acil-bilgi`, await o.gir('sc'), { hizmetVerir: true, aramaSirasi: 2 })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT acil_hizmet_verir, acil_arama_sirasi FROM kurulus WHERE kimlik = $1`, [f])).rows[0]).toEqual({ acil_hizmet_verir: true, acil_arama_sirasi: 2 });
  });
  it('süresinde kabul edilmeyen iş emrinde Dosya Sorumlusuna Firma Değiştir görevi', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-Y','Y','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, yanit_son, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K','Kabul Bekliyor',now() - interval '1 minute',$4) RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, f, o.K.ds])).rows[0].kimlik;
    await nobetCagriIsle(o.db);
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Firma Değiştir' AND nesne_kimligi = $1`, [e])).rowCount).toBe(1);
  });
});

describe('konum (YG-1658)', () => {
  it('sahibi gönderir; izin yoksa kayıtlı konum; nöbetçi görür ve durdurur', async () => {
    const p = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani) VALUES ('Dış','Kurumsal Müşteri','P','p.konum','p@konum.local',$1,'Doğrulama uygulaması (6 haneli kod)',now()) RETURNING kimlik`, [await parolaOzetle(PAROLA)])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Çalışan','KVKK-04','R00','Türkçe','Web')`, [p]);
    await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [p]);
    const c = (await giris('p@konum.local')).c;
    const r = await o.ist('POST', '/api/portal/acil', c, { tur: 'Yangın', yatAdi: 'Y', konum: 'Göcek' }); expect(r.statusCode, r.body).toBe(200); const t = r.json().talep as string; expect(t).toBeTruthy();
    expect((await o.ist('POST', `/api/portal/acil/${t}/konum`, await o.gir('ds'), { enlem: 36, boylam: 28 })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/portal/acil/${t}/konum`, c, { enlem: 95, boylam: 28 })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/portal/acil/${t}/konum`, c, { enlem: 36.75, boylam: 28.9 })).statusCode).toBe(200);
    const l = (await o.ist('GET', '/api/acil-konum', await o.gir('ds'))).json(); expect(l.find((x: any) => x.talep_ref === t)).toMatchObject({ enlem: '36.750000', kaynak: 'Cihaz' });
    expect((await o.ist('POST', `/api/portal/acil/${t}/konum`, c, {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT metin FROM konum_kaydi WHERE talep_ref = $1 AND kaynak = 'Kayıtlı Konum'`, [t])).rows[0].metin).toBe('Göcek');
    await o.ist('POST', `/api/acil-konum/${t}/durdur`, await o.gir('ds'), {});
    expect((await o.ist('POST', `/api/portal/acil/${t}/konum`, c, { enlem: 36, boylam: 28 })).json().durdu).toBe(true);
    expect((await o.ist('GET', '/api/acil-konum', await o.gir('ds'))).json().some((x: any) => x.talep_ref === t)).toBe(false);
  });
});
