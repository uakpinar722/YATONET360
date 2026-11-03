import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü', mfm: 'Muhasebe ve Finans Müdürü', tu: 'Teknik Uzman' };
const P = 'Sinama-Parolasi-2026!'; const H = { 'x-yatonet': '1' };
let o: Ortam; let fir: string; let ted: string; let firC: string; let firK: string; let ikiC: string; let ikiK: string; let tedC: string;
const disGir = async (ad: string, grup: string, rol: string, kurulus: string) => {
  const oz = await parolaOzetle(P); const ep = `${ad}@deneme.yatonet.local`;
  const k = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani) VALUES ('Dış Kullanıcı',$1,$2,$3,$3,$4,'Doğrulama uygulaması (6 haneli kod)',now()) RETURNING kimlik`, [grup, ad, ep, oz])).rows[0].kimlik as string;
  await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [k, rol]);
  await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Çalışan',$2,'R00','Türkçe','Web')`, [k, grup === 'İş Birliği Firması' ? 'KVKK-03' : 'KVKK-04']);
  await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [k]);
  await o.sup.query(`INSERT INTO kurulus_kullanici VALUES ($1,$2)`, [kurulus, k]);
  const ck = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
  const c = ck(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: ep, parola: P } }));
  const g = (await o.ist('GET', '/api/kimlik/kurulum', c)).json().gizli as string;
  return { c: ck(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(g, suankiAdim()) })), k };
};
const kuruluş = async (u: string, r: string) => (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: u, rol: r })).json().kimlik as string;

beforeAll(async () => {
  o = await ortamKur('yatonet360_test27', KADRO);
  fir = await kuruluş('Kurum Firma', 'Çözüm Ortağı'); ted = await kuruluş('Kurum Tedarik', 'Tedarikçi');
  const a = await disGir('kf1', 'İş Birliği Firması', 'Firma Yetkilisi', fir); firC = a.c; firK = a.k;
  const b = await disGir('kf2', 'İş Birliği Firması', 'Firma Yetkilisi', fir); ikiC = b.c; ikiK = b.k;
  tedC = (await disGir('kt1', 'Tedarikçi', 'Tedarikçi Kullanıcısı', ted)).c;
}, 120_000);
afterAll(async () => { await o.kapat(); });

describe('kurum kullanıcıları (YG-1004, YG-425)', () => {
  it('kurum yalnız kendi bilgi ve kullanıcılarını görür; LGM personeline açık değildir', async () => {
    const r = (await o.ist('GET', '/api/kurum/hesap', firC)).json();
    expect(r.kurum.ticari_unvan).toBe('Kurum Firma'); expect(r.kullanicilar.map((x: { e_posta: string }) => x.e_posta).sort()).toEqual(['kf1@deneme.yatonet.local', 'kf2@deneme.yatonet.local']);
    expect(JSON.stringify((await o.ist('GET', '/api/kurum/hesap', tedC)).json())).not.toContain('kf1@');
    expect((await o.ist('GET', '/api/kurum/hesap', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('talep LGM teyidine gider, hesap teyitten önce açılmaz; onayda davet e-postayla gider ve kuruma bağlanır', async () => {
    const ep = 'yeni@firma.local';
    expect((await o.ist('POST', '/api/kurum/kullanici', firC, { ad: 'Y', eposta: 'gecersiz' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/kurum/kullanici', firC, { ad: 'Yeni Kişi', eposta: 'kf1@deneme.yatonet.local' })).statusCode).toBe(409);
    const r = await o.ist('POST', '/api/kurum/kullanici', firC, { ad: 'Yeni Kişi', eposta: ep }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', '/api/kurum/kullanici', firC, { ad: 'Yeni Kişi', eposta: ep.toUpperCase() })).statusCode).toBe(409);
    expect((await o.sup.query(`SELECT 1 FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rowCount).toBe(0);
    const k = await o.kart('Kurum Kullanıcı Teyidi', r.json().talep);
    expect((await o.karar(k.kimlik, 'sc', 'Onayla')).statusCode).toBe(200);
    const h = (await o.sup.query(`SELECT h.kimlik, h.kullanici_grubu FROM kullanici_hesabi h JOIN kurulus_kullanici x ON x.kullanici_ref = h.kimlik WHERE h.e_posta = $1 AND x.kurulus_ref = $2`, [ep, fir])).rows[0];
    expect(h.kullanici_grubu).toBe('İş Birliği Firması');
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1`, [`kurum-davet:${r.json().talep}`])).rows[0].metin as string;
    expect(m).toContain('Kurum Firma'); expect(m).toMatch(/\/#davet=/);
    expect((await o.sup.query(`SELECT r.rol_adi FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1`, [h.kimlik])).rows[0].rol_adi).toBe('Firma Yetkilisi');
  });
  it('red hesap açmaz; talep sahibine bildirim gider', async () => {
    const r = await o.ist('POST', '/api/kurum/kullanici', firC, { ad: 'Red Kişi', eposta: 'red@firma.local' });
    const k = await o.kart('Kurum Kullanıcı Teyidi', r.json().talep); await o.karar(k.kimlik, 'sc', 'Reddet', 'Kimlik teyit edilemedi');
    expect((await o.sup.query(`SELECT durum FROM kurum_kullanici_talebi WHERE kimlik = $1`, [r.json().talep])).rows[0].durum).toBe('Reddedildi');
    expect((await o.sup.query(`SELECT 1 FROM kullanici_hesabi WHERE e_posta = 'red@firma.local'`)).rowCount).toBe(0);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [firK, `kurum-kullanici:${r.json().talep}`])).rowCount).toBe(1);
  });
  it('kapatma oturumu hemen bitirir, Sicile 24 saatlik görev açar; kendi hesabı ve başka kurum kapatılamaz', async () => {
    expect((await o.ist('POST', `/api/kurum/kullanici/${firK}/kapat`, firC, { gerekce: 'G' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/kurum/kullanici/${ikiK}/kapat`, tedC, { gerekce: 'G' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/kurum/kullanici/${ikiK}/kapat`, firC, {})).statusCode).toBe(400);
    expect((await o.ist('GET', '/api/kurum/hesap', ikiC)).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/kurum/kullanici/${ikiK}/kapat`, firC, { gerekce: 'Ayrıldı' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/kurum/hesap', ikiC)).statusCode).toBe(401);
    expect((await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: 'kf2@deneme.yatonet.local', parola: P } })).statusCode).not.toBe(200);
    expect(await o.kart('Çalışan Ayrıldı Bildirimi', ikiK)).toBeDefined();
    expect((await o.ist('POST', `/api/kurum/kullanici/${ikiK}/kapat`, firC, { gerekce: 'Tekrar' })).statusCode).toBe(409);
  });
});

describe('tedarikçi ödeme durumu (YG-298, YG-845)', () => {
  const fatura = async (no: string, sonuc: string | null) => {
    const be = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'Fatura','Gizli','Kuruluş',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`F ${no}`, ted, o.K.ds])).rows[0].kimlik;
    const d = await o.dosyaAc();
    const s = (await o.sup.query(`INSERT INTO tedarik_siparisi (siparis_no, dosya_ref, kurulus_ref, tedarikci_teklif_ref, nihai_kullanim_yeri, kdv_haric_eur, kdv_eur, toplam_eur, teslim_tarihi, teslim_yeri, kabul_olcutu, secim_gerekcesi, statu, hazirlayan_ref) VALUES ($1,$2,$3,'T1','Y',100,20,120,'2026-12-01','Marmaris','K','G','Verildi',$4) RETURNING kimlik`, [`SP-${no}`, d.kimlik, ted, o.K.ds])).rows[0].kimlik;
    const f = (await o.sup.query(`INSERT INTO tedarikci_faturasi (siparis_ref, kurulus_ref, fatura_no, tarih, tutar_eur, belge_ref, giren_ref) VALUES ($1,$2,$3,'2026-11-01',100,$4,$5) RETURNING kimlik`, [s, ted, no, be, o.K.ds])).rows[0].kimlik as string;
    if (sonuc) await o.sup.query(`INSERT INTO uclu_eslestirme (siparis_ref, kurulus_ref, fatura_no, fatura_tarihi, fatura_tutari, miktar_farki, fiyat_farki, sonuc, kontrol_eden_ref) VALUES ($1,$2,$3,'2026-11-01',100,0,0,$4,$5)`, [s, ted, no, sonuc, o.K.ds]);
    return f;
  };
  const durum = async (no: string) => (await o.ist('GET', '/api/tedarikci-portal/ana', tedC)).json().faturalar.find((x: { fatura_no: string }) => x.fatura_no === no);
  it('durum eşleşmeye göre gösterilir, vade 60 gündür; ödeme yalnız muhasebede ve eşleşmeden, teyitli hesap varken', async () => {
    const a = await fatura('F1', null); const c = await fatura('F2', 'Fiyat Farkı'); const e = await fatura('F3', 'Eşleşti');
    expect((await durum('F1')).odeme_durumu).toBe('Kontrol Bekleniyor'); expect((await durum('F2')).odeme_durumu).toBe('Fark İnceleniyor');
    expect(await durum('F3')).toMatchObject({ odeme_durumu: 'Ödeme Planlandı', vade: '2026-12-31' });
    const m = await o.gir('mfm'); const u = (x: string) => `/api/tedarikci-odemeleri/${x}/odendi`;
    expect((await o.ist('GET', '/api/tedarikci-odemeleri', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', u(e), tedC, {})).statusCode).toBe(404);
    expect((await o.ist('POST', u(a), m, {})).statusCode).toBe(409); expect((await o.ist('POST', u(c), m, {})).statusCode).toBe(409);
    const h = await o.ist('POST', u(e), m, {}); expect(h.statusCode).toBe(409); expect(h.json().hata).toContain('banka hesabı');
    await o.sup.query(`INSERT INTO banka_hesabi (kurulus_ref, iban, durum, giren_ref) VALUES ($1,'TR330006100519786457841326','Geçerli',$2)`, [ted, o.K.ds]);
    expect((await o.ist('GET', '/api/tedarikci-odemeleri', m)).json().map((x: { fatura_no: string }) => x.fatura_no)).toContain('F3');
    expect((await o.ist('POST', u(e), m, {})).statusCode).toBe(200);
    expect((await durum('F3')).odeme_durumu).toBe('Ödendi');
    expect((await o.ist('POST', u(e), m, {})).statusCode).toBe(409);
  });
});
