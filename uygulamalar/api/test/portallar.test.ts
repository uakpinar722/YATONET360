import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Tedarik Sorumlusu', tym: 'Tedarik Yönetimi Müdürü', to: 'Teknik ve Operasyon Direktörü', tid: 'Ticari İşler Direktörü', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü' };
const P = 'Sinama-Parolasi-2026!'; const H = { 'x-yatonet': '1' };
let o: Ortam; let tesis: string; let tesis2: string; let ted: string; let tesisC: string; let tesis2C: string; let tedC: string; let tedGizli: string; let d: { kimlik: string; dosyaNo: string };
const disGir = async (ad: string, grup: string, rol: string, kurulus: string) => {
  const oz = await parolaOzetle(P); const ep = `${ad}@deneme.yatonet.local`;
  const k = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani) VALUES ('Dış Kullanıcı',$1,$2,$3,$3,$4,'Doğrulama uygulaması (6 haneli kod)',now()) RETURNING kimlik`, [grup, ad, ep, oz])).rows[0].kimlik;
  await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [k, rol]);
  await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Çalışan','KVKK-04','R00','Türkçe','Web')`, [k]);
  await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [k]);
  await o.ist('POST', `/api/firma/${kurulus}/kullanici`, await o.gir('fym'), { kullanici: k });
  const ck = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
  const c = ck(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: H, payload: { kimlik: ep, parola: P } }));
  const g = (await o.ist('GET', '/api/kimlik/kurulum', c)).json().gizli as string;
  return { c: ck(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(g, suankiAdim()) })), gizli: g, k };
};
const yukle = async (kurulus: string, c: string) => { const r = await o.s.inject({ method: 'POST', url: `/api/belge/yukle?ad=K${Math.random()}.pdf&tur=${encodeURIComponent('Kuruluş Belgesi')}&bagTuru=${encodeURIComponent('Kuruluş')}&bagKimligi=${kurulus}&kaynak=Elden&dosya=k.pdf`, headers: { ...H, 'content-type': 'application/octet-stream' }, cookies: { [COOKIE_ADI]: c }, payload: Buffer.from(`%PDF-1.4 ${Math.random()}`) }); expect(r.statusCode, r.body).toBe(200); return r.json().belge as string; };

beforeAll(async () => {
  o = await ortamKur('yatonet360_test20', KADRO);
  const fir = async (u: string, r: string) => { const id = (await o.ist('POST', '/api/firma', await o.gir('sc'), { unvan: u, rol: r })).json().kimlik; await o.ist('POST', `/api/firma/${id}/statu`, await o.gir('fym'), { asama: 'Onaylı', ag: 'Aktif', gerekce: 'G' }); return id as string; };
  tesis = await fir('Marina A', 'Tesis'); tesis2 = await fir('Marina B', 'Tesis'); ted = await fir('Parça AŞ', 'Tedarikçi');
  tesisC = (await disGir('tesis1', 'Tesis Yetkilisi (Marina, Tersane, Çekek Sahası)', 'Tesis Yetkilisi', tesis)).c;
  tesis2C = (await disGir('tesis2', 'Tesis Yetkilisi (Marina, Tersane, Çekek Sahası)', 'Tesis Yetkilisi', tesis2)).c;
  const t = await disGir('ted1', 'Tedarikçi', 'Tedarikçi Kullanıcısı', ted); tedC = t.c; tedGizli = t.gizli;
  d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
  await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Tedarik Sorumlusu',$3)`, [d.kimlik, o.K.ts, o.K.oy]);
}, 180_000);
afterAll(async () => { await o.kapat(); });

describe('A8 Tesis (YG-297, YG-1575, YG-417, YG-554)', () => {
  it('talep, BLD-23, yanıt, takvim; gizlilik; başka tesis göremez; teslim onayı BLD-24', async () => {
    const c = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/tesis-talebi`; const T = { tesis, tur: 'Çekek Randevusu', hedef: '2026-12-01' };
    expect((await o.ist('POST', u, await o.gir('tu'), T)).statusCode).toBe(403);
    expect((await o.ist('POST', u, c, { ...T, tesis: ted })).statusCode).toBe(400);
    const r = await o.ist('POST', u, c, T); expect(r.statusCode, r.body).toBe(200);
    const a = await o.ist('GET', '/api/tesis-portal/ana', tesisC);
    expect(a.statusCode, a.body).toBe(200); expect(a.json().bekleyen).toHaveLength(1);
    for (const y of ['firma_bedeli', 'genel_toplam', 'dosya_no', 'kisa_teknik']) expect(a.body).not.toContain(y);
    expect((await o.ist('GET', '/api/tesis-portal/ana', tesis2C)).json().bekleyen).toHaveLength(0);
    expect((await o.ist('POST', `/api/tesis-portal/talep/${r.json().kimlik}/yanit`, tesis2C, { izin: true, izinNo: 'X' })).json().hata).toBeDefined();
    expect((await o.ist('POST', `/api/tesis-portal/talep/${r.json().kimlik}/yanit`, tesisC, { izin: true })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/tesis-portal/talep/${r.json().kimlik}/yanit`, tesisC, { izin: true, izinNo: 'M-1' })).json().durum).toBe('Onaylı');
    const b = (await o.ist('GET', '/api/tesis-portal/ana', tesisC)).json();
    expect(b.takvim[0]).toMatchObject({ tesis_izin_no: 'M-1' }); expect(b.yatlar[0].teslim).toBeNull();
    const m = (await o.sup.query(`SELECT ozet FROM bildirim WHERE olay_anahtari = $1 LIMIT 1`, [`bld23:${d.kimlik}:${tesis}`])).rows[0].ozet; expect(m).toContain('teslim edilmemesi'); expect(m).not.toContain('[');
    expect((await o.ist('POST', `/api/tesis-portal/dosya/${d.kimlik}/teslim-talebi`, tesis2C)).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/tesis-portal/dosya/${d.kimlik}/teslim-talebi`, tesisC)).statusCode).toBe(200);
    const be = await yukle(tesis, tesisC);
    expect((await o.ist('POST', '/api/tesis-portal/fatura', tesisC, { talep: r.json().kimlik, no: 'F1', tarih: '2026-12-02', kalem: 'Bekleme ve Muhafaza', tutar: 100, belge: be })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/tesis-portal/fatura', tesisC, { talep: r.json().kimlik, no: 'F1', tarih: '2026-12-02', kalem: 'Bekleme ve Muhafaza', gun: 3, tutar: 100, belge: be })).statusCode).toBe(200);
    { const k = (await o.sup.query(`SELECT son_zaman FROM is_karti WHERE tur = 'Tesis Faturası Kontrolü' ORDER BY olusturma_zamani DESC LIMIT 1`)).rows[0]; expect(Math.round((new Date(k.son_zaman).getTime() - Date.now()) / 86_400_000)).toBe(8); } // YG-887
    expect((await o.ist('POST', '/api/tesis-portal/fatura', tesisC, { talep: r.json().kimlik, no: 'F1', tarih: '2026-12-02', kalem: 'Çekek', tutar: 100, belge: be })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/tesis-portal/kayit', tesisC, { tur: 'Tarife', baslik: 'T', belge: be })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/tedarikci-portal/ana', tesisC)).statusCode).toBe(404);
    const dg = await o.db.connect();
    try { await dg.query(`INSERT INTO teslim_kaydi (dosya_ref, teslim_eden_ref, durum) VALUES ($1,$2,'Teslim Edildi')`, [d.kimlik, o.K.ds]); const { tesisSerbestBirak } = await import('../src/portallar.js'); await tesisSerbestBirak(dg, d.kimlik, 'Sahip'); } finally { dg.release(); }
    const s = (await o.ist('GET', '/api/tesis-portal/ana', tesisC)).json().yatlar[0]; expect(s.teslim).toBe('Teslim Edildi'); expect(s.serbest_birakma_kodu).toMatch(/^\d{6}$/);
    expect((await o.sup.query(`SELECT ozet FROM bildirim WHERE olay_anahtari = $1 LIMIT 1`, [`bld24:${d.kimlik}`])).rows[0].ozet).toContain(s.serbest_birakma_kodu);
  });
});
describe('A9 Tedarikçi (YG-298, YG-1088, YG-1577)', () => {
  it('teklif talebi, yanıt, 30 gün; sipariş kod ile kabul; giriş kabulden sonra; sevk, fatura; müşteri görünmez', async () => {
    const ts = await o.gir('ts');
    const t = await o.ist('POST', `/api/dosya/${d.kimlik}/teklif-talebi`, ts, { tedarikci: ted, sonZaman: new Date(Date.now() + 86_400_000).toISOString(), kalemler: [{ tanim: 'Pompa', parcaNo: 'P1', miktar: 2, birim: 'adet' }] });
    expect(t.statusCode, t.body).toBe(200);
    const a = await o.ist('GET', '/api/tedarikci-portal/ana', tedC);
    expect(a.statusCode, a.body).toBe(200); expect(a.body).not.toContain('Sahip'); expect(a.body).not.toContain('Yat ');
    const k = a.json().talepler[0].kalemler[0].kimlik;
    expect((await o.ist('POST', `/api/tedarikci-portal/talep/${t.json().kimlik}/yanit`, tedC, { kalemler: [] })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/tedarikci-portal/talep/${t.json().kimlik}/yanit`, tedC, { kalemler: [{ kimlik: k, fiyat: 100, sure: 5 }] })).json().gecerlilik).toBeDefined();
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/teklif-talepleri`, ts)).json()[0].kalemler[0].teslim_suresi_gun).toBe(5);
    const s = await o.ist('POST', `/api/dosya/${d.kimlik}/siparis`, ts, { tedarikci: ted, teklifRef: t.json().talepNo, kullanim: 'K', teslimTarihi: '2027-01-10', teslimYeri: 'Y', olcut: 'Ö', gerekce: 'G', kalemler: [{ tanim: 'Pompa', parcaNo: 'P1', miktar: 2, birim: 'adet', bedel: 100 }] });
    expect(s.statusCode, s.body).toBe(200);
    const sid = s.json().kimlik; const kr = await o.kart('Tedarik Siparişi', sid);
    expect((await o.ist('GET', '/api/tedarikci-portal/ana', tedC)).json().siparisler).toHaveLength(0);
    await o.karar(kr.kimlik, 'tym', 'Onaya Gönder'); await o.karar(kr.kimlik, 'to', 'Onaya Gönder'); await o.karar(kr.kimlik, 'tid', 'Onayla');
    const G = { satir: 1, miktar: 2, lot: 'L1', irsaliye: 'İ1', bekletmeYeri: tesis };
    expect((await o.ist('POST', `/api/siparis/${sid}/giris`, ts, G)).json().hata).toContain('kabul');
    const be = await yukle(ted, tedC);
    expect((await o.ist('POST', `/api/tedarikci-portal/siparis/${sid}/sevk`, tedC, { tarih: '2026-12-01', irsaliye: 'İ', tasiyici: 'T', lot: 'L', belge: be })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/tedarikci-portal/siparis/${sid}/yanit`, tedC, { kabul: true, kod: '000000', teslim: '2027-01-05' })).statusCode).toBe(401);
    expect((await o.ist('POST', `/api/tedarikci-portal/siparis/${sid}/yanit`, tedC, { kabul: false })).statusCode).toBe(400);
    await o.sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 0 WHERE e_posta = 'ted1@deneme.yatonet.local'`);
    expect((await o.ist('POST', `/api/tedarikci-portal/siparis/${sid}/yanit`, tedC, { kabul: true, kod: totpKodu(tedGizli, suankiAdim()), teslim: '2027-01-05' })).json().yanit).toBe('Kabul');
    expect((await o.ist('POST', `/api/tedarikci-portal/siparis/${sid}/sevk`, tedC, { tarih: '2026-12-01', irsaliye: 'İ', tasiyici: 'T', lot: 'L', belge: be })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/tedarikci-portal/siparis/${sid}/fatura`, tedC, { no: 'F1', tarih: '2026-12-05', tutar: 200, belge: be })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/siparis/${sid}/giris`, ts, G)).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/tedarikci-portal/talep/${t.json().kimlik}/yanit`, tesisC, {})).statusCode).toBe(404);
  });
});
