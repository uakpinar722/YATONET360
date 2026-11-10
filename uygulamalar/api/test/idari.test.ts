import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', idr: 'İdari İşler Sorumlusu', tid: 'Ticari İşler Direktörü', gmy: 'Genel Müdür Yardımcısı', cg: 'CEO', mfm: 'Muhasebe ve Finans Müdürü', ide: 'İç Denetçi', idm: 'İç Denetim Müdürü', tod: 'Teknik ve Operasyon Direktörü', imd: 'İdari İşler Müdürü', bim: 'Bilgi İşlem Müdürü', hud: 'Hukuk ve Uyum Direktörü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test71', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('idari talep (YG-1619, YG-1683)', () => {
  const ac = async (k: string) => { const r = await o.ist('POST', '/api/idari-talep', await o.gir(k), { konu: 'Yazıcı', gerekce: 'Arıza' }); expect(r.statusCode, r.body).toBe(200); return r.json().kimlik as string; };
  const kart = async (tur: string, t: string) => (await o.kart(tur, t)).kimlik as string;
  const durum = async (t: string) => (await o.sup.query(`SELECT durum FROM idari_talep WHERE kimlik = $1`, [t])).rows[0].durum as string;
  it('ihtiyaç onayı son makamdan sonra İdari İşlere düşer; sipariş tutara göre TİD, GMY, CEO zincirinden geçer', async () => {
    const t = await ac('ds'); expect(await durum(t)).toBe('İhtiyaç Onayında');
    const idr = await o.gir('idr'); const imd = await o.gir('imd'); expect((await o.ist('POST', `/api/idari-talep/${t}/siparis`, imd, { kart: 1, teslimPlan: '2099-01-01' })).statusCode).toBe(409);
    expect((await o.karar(await kart('İdari Talep', t), 'opm', 'Onayla')).statusCode).toBe(200); expect(await durum(t)).toBe('İdari İşlerde');
    expect((await o.kart('İdari Talep Hazırlığı', t)).durum).toBe('Bekliyor');
    expect((await o.kart('İdari Talep Hazırlığı', t)).son_zaman).toBeTruthy(); // 8 saat kayda alma
    const td = (await o.ist('POST', '/api/idari-tedarikci', idr, { ad: 'Ofis Tedarik', iban: 'TR000000000000000000000001' })).json().kimlik as string;
    expect((await o.kart('Tedarikçi Banka Hesabı Teyidi', td)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/idari-talep/${t}/satin-alma`, idr, { teknikSart: 'Lazer yazıcı', miktar: 1, kartlar: [] })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/idari-talep/${t}/satin-alma`, idr, { teknikSart: 'Lazer yazıcı', miktar: 1, kartlar: [{ tedarikci: td, tutar: 7000, gecerlilik: '2099-01-01' }, { tedarikci: td, tutar: 7200, gecerlilik: '2020-01-01' }] })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/idari-talep/${t}/siparis`, idr, { kart: 1, teslimPlan: '2099-01-01' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/idari-talep/${t}/siparis`, imd, { kart: 2, teslimPlan: '2099-01-01' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/idari-talep/${t}/siparis`, imd, { kart: 1, teslimPlan: '2099-01-01' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT talep_no, siparis_no FROM idari_talep WHERE kimlik = $1`, [t])).rows[0]).toEqual({ talep_no: expect.stringMatching(/^LGM-ID-\d{4}-\d{4}$/), siparis_no: expect.stringMatching(/^LGM-ID-\d{4}-\d{4}-SP01$/) }); // YG-1618
    const k = await kart('İdari Sipariş', t); expect((await o.karar(k, 'tid', 'Onaya Gönder')).statusCode).toBe(200); expect(await durum(t)).toBe('Sipariş Onayında');
    expect((await o.karar(k, 'gmy', 'Onayla')).statusCode).toBe(200); expect(await durum(t)).toBe('Sipariş Onaylandı');
  });
  it('müdürün talebinde son makam Direktör; İç Denetçide İç Denetim Müdürü', async () => {
    const m = await ac('opm'); expect((await o.karar(await kart('İdari Talep', m), 'tod', 'Onayla')).statusCode).toBe(200); expect(await durum(m)).toBe('İdari İşlerde');
    const d = await ac('ide'); expect((await o.karar(await kart('İdari Talep', d), 'idm', 'Onayla')).statusCode).toBe(200); expect(await durum(d)).toBe('İdari İşlerde');
  });
});

describe('CEO masraf raporu (YG-1677)', () => {
  it('yalnız yetkililer görür; CEO fişi silinemez; çeyrek görevi bir kez', async () => {
    const f = (await o.sup.query(`INSERT INTO personel_masraf_fisi (personel_ref, masraf_turu, fis_tarihi, tutar_tl, kur, tutar_eur, odenecek_eur, miktar, belge_ozeti) VALUES ($1,'Yemek','2026-11-02',400,40,10,10,1,'C1') RETURNING kimlik`, [o.K.cg])).rows[0].kimlik;
    expect((await o.ist('GET', '/api/masraf/ceo-raporu?yil=2026&ceyrek=4', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('GET', '/api/masraf/ceo-raporu?yil=2026&ceyrek=4', await o.gir('mfm'))).json().toplam).toBe(10);
    await expect(o.sup.query(`DELETE FROM personel_masraf_fisi WHERE kimlik = $1`, [f])).rejects.toThrow(/silinemez/);
    const { ceoMasrafRaporIsle } = await import('../src/idari_talep.js'); const S = new Date('2027-01-05T09:00:00Z');
    expect(await ceoMasrafRaporIsle(o.db, S)).toBe(true); expect(await ceoMasrafRaporIsle(o.db, S)).toBe(false);
  });
});

describe('personel ek kayıtları (YG-974, YG-956, YG-947)', () => {
  it('zimmet personel beyanıyla oluşur, iadeyi idari işler alır', async () => {
    const ds = await o.gir('ds'); expect((await o.ist('POST', '/api/zimmet', ds, { ekipman: '' })).statusCode).toBe(400);
    const z = (await o.ist('POST', '/api/zimmet', ds, { ekipman: 'Telefon', seri: 'S1', tarih: '2026-11-01' })).json().kimlik as string;
    expect((await o.ist('POST', `/api/zimmet/${z}/iade`, ds, {})).statusCode).toBe(404);
    const idr = await o.gir('idr'); expect((await o.ist('GET', '/api/personel-ek', idr)).json().acikZimmetler.some((x: { kimlik: string }) => x.kimlik === z)).toBe(true);
    expect((await o.ist('POST', `/api/zimmet/${z}/iade`, idr, {})).statusCode).toBe(200); expect((await o.ist('POST', `/api/zimmet/${z}/iade`, idr, {})).statusCode).toBe(409);
  });
  it('nöbet düzenini yalnız birim amiri belirler; aynı nöbete ikinci kayıt olmaz', async () => {
    const G = { personel: o.K.ds, nobetTarihi: '2026-11-01', duzen: 'Geç Başlama', uygulamaTarihi: '2026-11-02' };
    expect((await o.ist('POST', '/api/nobet-serbest-zaman', await o.gir('idr'), G)).statusCode).toBe(404);
    const op = await o.gir('opm'); expect((await o.ist('POST', '/api/nobet-serbest-zaman', op, { ...G, uygulamaTarihi: '2026-11-01' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/nobet-serbest-zaman', op, G)).statusCode).toBe(200); expect((await o.ist('POST', '/api/nobet-serbest-zaman', op, G)).statusCode).toBe(409);
  });
  it('rıza geri alınınca evlilik tarihi silinir', async () => {
    const ds = await o.gir('ds'); expect((await o.ist('POST', '/api/personel-ozel-gun', ds, { riza: true })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/personel-ozel-gun', ds, { riza: true, evlilikTarihi: '2020-06-01' })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/personel-ozel-gun', ds, { riza: false })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT evlilik_tarihi, paylasim_rizasi FROM personel_ozel_gun WHERE personel_ref = $1`, [o.K.ds])).rows[0]).toEqual({ evlilik_tarihi: null, paylasim_rizasi: false });
  });
});

describe('varlık ve zimmet hareketi (YG-1618 varlık)', () => {
  it('LGM-VR numarası; teslim ve iade hareket olarak; aynı anda tek kişi', async () => {
    const idr = await o.gir('idr');
    expect((await o.ist('POST', '/api/varlik', await o.gir('ds'), { tur: 'Cihaz', ad: 'Tablet' })).statusCode).toBe(404);
    const v = (await o.ist('POST', '/api/varlik', idr, { tur: 'Cihaz', ad: 'Tablet', seri: 'SN1' })).json(); expect(v.no).toMatch(/^LGM-VR-\d{5}$/);
    expect((await o.ist('POST', `/api/varlik/${v.kimlik}/teslim`, idr, { personel: o.K.ds })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/varlik/${v.kimlik}/teslim`, idr, { personel: o.K.opm })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/varlik/${v.kimlik}/iade`, idr, {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT array_agg(tur ORDER BY kimlik) t FROM varlik_hareketi WHERE varlik_ref = $1`, [v.kimlik])).rows[0].t).toEqual(['Teslim', 'İade']);
    expect((await o.sup.query(`SELECT iade_zamani IS NOT NULL i FROM personel_zimmet WHERE varlik_ref = $1`, [v.kimlik])).rows[0].i).toBe(true);
  });
});

describe('İdari İşler ana ekranları A30 ve A31 (YG-1617, YG-1620)', () => {
  it('teslim eşleşmesi, kayıp cihaz ihlal bildirimi, sayım, sarf, sözleşme 90/45/15, bütçe ve uyarılar', async () => {
    const { idariUyariIsle } = await import('../src/idari_ek.js'); const idr = await o.gir('idr'); const imd = await o.gir('imd');
    expect((await o.ist('GET', '/api/idari-ana', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('GET', '/api/idari-ana', imd)).json().rol).toBe('Müdür');
    const t = (await o.sup.query(`SELECT kimlik FROM idari_talep WHERE durum = 'Sipariş Onaylandı' LIMIT 1`)).rows[0]?.kimlik as string;
    await o.sup.query(`UPDATE idari_talep SET teslim_plan = current_date - 10 WHERE kimlik = $1`, [t]);
    expect(await idariUyariIsle(o.db)).toBeGreaterThanOrEqual(2);
    expect((await o.ist('POST', `/api/idari-talep/${t}/teslim`, idr, { irsaliye: 'İ1', fatura: 'F1', faturaTutar: 7100 })).json().eslesme).toBe('Fark Var');
    const v = (await o.ist('POST', '/api/varlik', idr, { tur: 'Cihaz', ad: 'Nöbet telefonu' })).json();
    expect((await o.ist('POST', `/api/varlik/${v.kimlik}/kayip`, idr, { aciklama: 'Sahada kayboldu' })).json().ihlalBildirimi).toBe(true);
    expect(Number((await o.sup.query(`SELECT count(*) n FROM is_karti WHERE tur = 'Kayıp Cihaz Veri İhlali Bildirimi' AND nesne_kimligi LIKE $1`, [`${v.kimlik}:%`])).rows[0].n)).toBe(2);
    const v2 = (await o.ist('POST', '/api/varlik', idr, { tur: 'Cihaz', ad: 'İhbar dizüstü' })).json();
    await o.ist('POST', `/api/varlik/${v2.kimlik}/ariza`, idr, { kritik: 'İhbar Dizüstü' }); await o.sup.query(`UPDATE varlik SET ariza_zamani = now() - interval '9 hours' WHERE kimlik = $1`, [v2.kimlik]);
    await idariUyariIsle(o.db); expect(await o.kart('İdari Uyarı', `yedek:${v2.kimlik}`)).toBeDefined();
    const sm = (await o.ist('POST', '/api/sarf', idr, { ad: 'A4 Kağıt', birim: 'paket', kritik: 5 })).json().kimlik;
    expect((await o.ist('POST', '/api/sarf', idr, { kimlik: sm, tur: 'Çıkış', miktar: 1 })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/sarf', idr, { kimlik: sm, tur: 'Giriş', miktar: 4 })).json()).toEqual({ miktar: 4, kritik: true });
    expect((await o.ist('POST', '/api/varlik/sayim', idr, { donem: '2026-Q4', varliklar: [{ kimlik: v2.kimlik, sonuc: 'Bulunamadı' }], sarf: [{ kimlik: sm, miktar: 3 }] })).json().bulunamayan).toBe(1);
    const sz = (await o.ist('POST', '/api/ofis-sozlesmesi', imd, { karsiTaraf: 'Temizlik Hizmeti', konu: 'Ofis temizliği', baslangic: '2026-01-01', bitis: new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10) })).json(); expect(sz.no).toMatch(/^LGM-SZ-[0-9]{4}$/);
    await idariUyariIsle(o.db); expect((await o.kart('İdari Uyarı', `sozlesme:${sz.kimlik}:45`)).durum).toBe('Bekliyor');
    expect((await o.ist('POST', `/api/ofis-sozlesmesi/${sz.kimlik}/oneri`, imd, { oneri: 'Yenileme', gerekce: 'Hizmet yeterli' })).statusCode).toBe(200);
    expect((await o.karar((await o.kart('Ofis Sözleşmesi Önerisi', sz.kimlik)).kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/idari-butce', imd, { yil: 2027, kalemler: [{ kalem: 'Kira', tutar: 24000 }], gonder: true })).statusCode).toBe(200);
    expect((await o.karar((await o.kart('İdari Bütçe', '2027')).kimlik, 'tid', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM idari_butce WHERE yil = 2027`)).rows[0].durum).toBe('Onaylandı');
  });
});
