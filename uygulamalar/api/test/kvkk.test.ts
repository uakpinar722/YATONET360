import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ihlalAc, imhaListesiUret, imhaYenidenUygula, kvkkIsle } from '../src/kvkk.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', hud: 'Hukuk ve Uyum Direktörü', huu: 'Hukuk ve Uyum Uzmanı', bim: 'Bilgi İşlem Müdürü', gmy: 'Genel Müdür Yardımcısı' };
let o: Ortam;
const belge = async (d: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'K','Gizli','Dosya',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`B-${Math.random()}`, d, o.K.ds])).rows[0].kimlik as string;

beforeAll(async () => { o = await ortamKur('yatonet360_test48', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('veri ihlali (YG-529, YG-1201–1204)', () => {
  it('her kullanıcı bildirir; kritik kart ve SMS; görünürlük sınırlı', async () => {
    const r = await o.ist('POST', '/api/veri-ihlali', await o.gir('ds'), { ozet: 'Yanlış alıcı', olayTuru: 'Yanlış alıcıya e-posta' }); expect(r.statusCode, r.body).toBe(200); expect(r.json().olayNo).toMatch(/^OLY-\d{4}-\d{4}$/);
    expect((await o.ist('POST', '/api/veri-ihlali', await o.gir('ds'), { ozet: '' })).statusCode).toBe(400);
    expect((await o.kart('Veri İhlali Şüphesi', r.json().kimlik)).oncelik).toBe('Kritik');
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1 AND kullanici_ref = ANY($2::text[])`, [`veri-ihlali:${r.json().kimlik}`, [o.K.bim, o.K.hud]])).rowCount).toBe(2);
    expect((await o.ist('GET', '/api/veri-ihlali', await o.gir('ds'))).statusCode).toBe(403);
    expect((await o.ist('GET', '/api/veri-ihlali', await o.gir('bim'))).statusCode).toBe(200);
  });
  it('üst yönetim, sürümlü bulgu, 72 saat gerekçesi, kanıtsız kapanış yok', async () => {
    const eski = new Date(Date.now() - 80 * 3_600_000); const v = await ihlalAc(o.db, { ozet: 'S', olayTuru: 'Teknik güvenlik olayı', ogrenme: eski, farkEden: o.K.ds! }); const u = `/api/veri-ihlali/${v.kimlik}`; const hud = await o.gir('hud');
    expect((await o.ist('POST', `${u}/degerlendir`, await o.gir('bim'), {})).statusCode).toBe(403);
    expect((await o.ist('POST', `${u}/degerlendir`, hud, {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1 AND kullanici_ref = $2`, [`veri-ihlali-ust:${v.kimlik}`, o.K.gmy])).rowCount).toBe(1);
    expect((await o.ist('POST', `${u}/bulgu`, await o.gir('bim'), { kisiSayisi: 3, tedbirler: 'Erişim kapatıldı' })).json().surum).toBe(1);
    expect((await o.ist('POST', `${u}/bulgu`, hud, { kisiSayisi: 5 })).json().surum).toBe(2);
    expect((await o.sup.query(`SELECT etkilenen_kisi_sayisi, sinirlama_tedbirleri FROM veri_ihlali WHERE kimlik = $1`, [v.kimlik])).rows[0]).toEqual({ etkilenen_kisi_sayisi: 5, sinirlama_tedbirleri: 'Erişim kapatıldı' });
    expect((await o.ist('POST', `${u}/kurul-bildirimi`, hud, { zaman: new Date().toISOString() })).json().hata).toContain('gecikme gerekçesi');
    expect(await kvkkIsle(o.db)).toBeGreaterThan(0);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1`, [`ihlal-kurul:${v.kimlik}:asildi`])).rowCount).toBeGreaterThan(0);
    expect((await o.ist('POST', `${u}/kapat`, hud, { kokNeden: 'K', kanit: crypto.randomUUID() })).statusCode).toBe(400);
    const d = await o.dosyaAc({}, {}); const kn = await belge(d.kimlik);
    expect((await o.ist('POST', `${u}/kapat`, hud, { kokNeden: 'K', kanit: kn })).json().hata).toContain('Bildirim kararı');
    expect((await o.ist('POST', `${u}/kurul-bildirimi`, hud, { zaman: new Date().toISOString(), gecikme: 'Kapsam belirsizdi' })).statusCode).toBe(200);
    expect((await o.ist('POST', `${u}/kapat`, hud, { kokNeden: 'K', kanit: kn })).statusCode).toBe(200);
    expect((await o.ist('POST', `${u}/bulgu`, hud, { kisiSayisi: 9 })).statusCode).toBe(409);
  });
});

describe('ilgili kişi başvurusu (YG-1218–1220)', () => {
  it('30 gün, doğrulama, arama, hazırlayan-onaylayan ayrımı, kanıtlı yanıt', async () => {
    const u = await o.gir('huu'); const P = { ad: 'Başvuran B', iletisim: 'b@x.local', kanal: 'KEP', yanitKanali: 'KEP', talepler: ['Düzeltme isteme'], alinma: '2026-11-01' };
    expect((await o.ist('POST', '/api/kvkk-basvuru', await o.gir('ds'), P)).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/kvkk-basvuru', u, { ...P, kanal: 'Telefon' })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/kvkk-basvuru', u, P); expect(r.statusCode, r.body).toBe(200); expect(r.json().sonYanit).toBe('2026-12-01'); const a = `/api/kvkk-basvuru/${r.json().kimlik}`;
    expect((await o.ist('POST', `${a}/arama`, u, { terim: 'Başvuran' })).json().hata).toContain('kimliği');
    expect((await o.ist('POST', `${a}/karar`, u, { karar: 'Kabul', gerekce: 'G' })).json().hata).toContain('Kimlik');
    await o.ist('POST', `${a}/dogrula`, u, {});
    expect((await o.ist('POST', `${a}/karar`, u, { karar: 'Kabul', gerekce: 'G' })).json().hata).toContain('arama');
    const ar = await o.ist('POST', `${a}/arama`, u, { terim: 'Dosya', elleKontrol: ['Arşiv', 'Dış Hizmetler'] }); expect(ar.statusCode, ar.body).toBe(200); expect(ar.json().sonuc).toHaveProperty('Mesaj Geçmişi');
    expect((await o.ist('POST', `${a}/yanit`, u, { tarih: '2026-11-10', kanit: crypto.randomUUID() })).json().hata).toContain('onaylı karar');
    expect((await o.ist('POST', `${a}/karar`, u, { karar: 'Kabul', gerekce: 'Uygun' })).json().durum).toBe('Onayda');
    const k = await o.kart('KVKK Başvuru Kararı', r.json().kimlik); expect((await o.karar(k.kimlik, 'hud', 'Onayla')).statusCode).toBe(200);
    const d = await o.dosyaAc({}, {}); expect((await o.ist('POST', `${a}/yanit`, u, { tarih: '2026-11-10', kanit: await belge(d.kimlik) })).statusCode).toBe(200);
  });
  it('son yanıt yaklaşınca uyarı', async () => {
    const u = await o.gir('huu'); const bug = new Date(Date.now() - 25 * 86_400_000).toISOString().slice(0, 10);
    const r = await o.ist('POST', '/api/kvkk-basvuru', u, { ad: 'C', iletisim: 'c', kanal: 'KEP', yanitKanali: 'KEP', talepler: ['Düzeltme isteme'], alinma: bug });
    await kvkkIsle(o.db);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE olay_anahtari = $1`, [`basvuru-son:${r.json().kimlik}`])).rowCount).toBeGreaterThan(0);
  });
});

describe('saklama, hukuki koruma, imha (YG-608, YG-1222, YG-1223, YG-1228, YG-1230–1232)', () => {
  const kapaliDosya = async (t = '2020-01-01') => { const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET statu = 'Kapalı', kapanma_nedeni = 'Tamamlandı', kapanis_zamani = $2 WHERE kimlik = $1`, [d.kimlik, t]); return d; };
  it('süresi dolan listeye girer; korunan ve açık garantili girmez; birim ve onay ayrı; imha uygulanır; geri yüklenen tekrar imha edilir', async () => {
    const d = await kapaliDosya(); const kor = await kapaliDosya(); const yeni = await kapaliDosya(new Date().toISOString()); const bl = await belge(d.kimlik);
    await o.sup.query(`INSERT INTO hukuki_koruma (gerekce_turu, kapsam_konu, dosya_ref, karar_sahibi_ref, gozden_gecirme_tarihi) VALUES ('Uyuşmazlık','D',$1,$2,'2099-01-01')`, [kor.kimlik, o.K.hud]);
    const fk = (await o.sup.query(`INSERT INTO acik_riza (ilgili_kisi_ref, riza_turu, kanal, kaynak, metin_surumu, durum) VALUES ($1,'Ticari elektronik ileti onayı','SMS','Profil','R00','Geri Alındı') RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    expect(await imhaListesiUret(o.db, new Date('2026-03-15T10:00:00Z'))).toBeNull();
    const l = await imhaListesiUret(o.db, new Date('2027-01-15T10:00:00Z')); expect(l).toBeTruthy();
    expect(await imhaListesiUret(o.db, new Date('2027-01-16T10:00:00Z'))).toBeNull();
    const G = (await o.ist('GET', '/api/imha-listesi', await o.gir('huu'))).json().find((x: { kimlik: string }) => x.kimlik === l); const ids = G.kalemler.map((k: { ozet: string }) => k.ozet);
    expect(ids).toContain(d.dosyaNo); expect(ids).not.toContain(kor.dosyaNo); expect(ids).not.toContain(yeni.dosyaNo); expect(G.kalemler.some((k: { grup_kod: string }) => k.grup_kod === 'RIZA')).toBe(true);
    expect((await o.kart('İmha Listesi', l!)).oncelik).toBeTruthy();
    const huu = await o.gir('huu'); const hd = G.kalemler.find((k: { grup_kod: string }) => k.grup_kod === 'RIZA');
    expect((await o.ist('POST', `/api/imha-kalemi/${hd.kimlik}/cikar`, huu, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/imha-kalemi/${hd.kimlik}/cikar`, huu, { gerekce: 'Devam eden talep' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/imha-listesi/${l}/birime-gonder`, await o.gir('ds'), {})).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/imha-listesi/${l}/birime-gonder`, huu, {})).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/imha-listesi/${l}/birim-onay`, await o.gir('ds'), {})).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/imha-listesi/${l}/birim-onay`, await o.gir('opm'), {})).statusCode).toBe(200);
    const on = await o.kart('İmha Onayı', l!); const ok = await o.karar(on.kimlik, 'hud', 'Onayla'); expect(ok.statusCode, ok.body).toBe(200);
    expect((await o.sup.query(`SELECT kisi_adi_soyadi, telefon FROM dosya_tarafi WHERE dosya_ref = $1 LIMIT 1`, [d.kimlik])).rows[0]).toEqual({ kisi_adi_soyadi: 'İmha Edildi', telefon: null });
    expect((await o.sup.query(`SELECT imha_zamani FROM belge WHERE kimlik = $1`, [bl])).rows[0].imha_zamani).not.toBeNull();
    expect((await o.sup.query(`SELECT imha_zamani FROM acik_riza WHERE kimlik = $1`, [fk])).rows[0].imha_zamani).toBeNull();
    const t = await o.ist('GET', `/api/imha-listesi/${l}/tutanak`, huu); expect(t.statusCode, t.body).toBe(200); expect(t.json().gruplar[0].adet).toBeGreaterThan(0);
    // Yedekten dönüş benzetimi
    await o.sup.query(`UPDATE dosya SET imha_zamani = NULL WHERE kimlik = $1`, [d.kimlik]); await o.sup.query(`UPDATE dosya_tarafi SET kisi_adi_soyadi = 'Eski Ad' WHERE dosya_ref = $1`, [d.kimlik]);
    expect(await imhaYenidenUygula(o.db)).toBe(1);
    expect((await o.sup.query(`SELECT kisi_adi_soyadi FROM dosya_tarafi WHERE dosya_ref = $1 LIMIT 1`, [d.kimlik])).rows[0].kisi_adi_soyadi).toBe('İmha Edildi');
  });
  it('hukuki koruma yalnız Hukuk ve Uyum Direktörü; süresiz olmaz; kaldırılabilir', async () => {
    const d = await kapaliDosya('2024-01-01');
    expect((await o.ist('POST', '/api/hukuki-koruma', await o.gir('huu'), { gerekce: 'Denetim', konu: 'K', dosya: d.kimlik, gozden: '2027-01-01' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/hukuki-koruma', await o.gir('hud'), { gerekce: 'Denetim', konu: 'K', dosya: d.kimlik })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/hukuki-koruma', await o.gir('hud'), { gerekce: 'Denetim', konu: 'K', dosya: d.kimlik, gozden: '2027-01-01' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', `/api/hukuki-koruma/${r.json().kimlik}/kaldir`, await o.gir('hud'), {})).statusCode).toBe(200);
  });
  it('sicilde ilişki bitişi çıkarılınca işlenir', async () => {
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, ag_statusu, olusturan_ref) VALUES ('S-KV','F','Çözüm Ortağı','Aktif',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    await o.sup.query(`UPDATE kurulus SET ag_statusu = 'Çıkarıldı' WHERE kimlik = $1`, [f]);
    expect((await o.sup.query(`SELECT iliski_bitis FROM kurulus WHERE kimlik = $1`, [f])).rows[0].iliski_bitis).not.toBeNull();
  });
  it('kapanış hesabı damgalanır', async () => {
    await o.sup.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Kapalı' WHERE kimlik = $1`, [o.K.tu]);
    expect((await o.sup.query(`SELECT kapanma_zamani FROM kullanici_hesabi WHERE kimlik = $1`, [o.K.tu])).rows[0].kapanma_zamani).not.toBeNull();
    await o.sup.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Aktif' WHERE kimlik = $1`, [o.K.tu]);
  });
});

describe('saklama grubu (YG-1222)', () => {
  it('fatura belgesi 10 yıl ve yıl sonundan, rapor 5 yıl', async () => {
    const { saklamaGrubu } = await import('../src/kvkk.js');
    expect(saklamaGrubu('Proforma')).toBe('MAL-10'); expect(saklamaGrubu('Fiyat Teklifi')).toBe('TIC-10'); expect(saklamaGrubu('Kurtarma Sözleşmesi')).toBe('SOZ-10'); expect(saklamaGrubu('Teknik Rapor')).toBe('OPS-5');
    const d = await o.dosyaAc({}, {}); await o.sup.query(`UPDATE dosya SET kapanis_zamani = '2020-06-01', statu = 'Kapalı', kapanma_nedeni = 'Tamamlandı' WHERE kimlik = $1`, [d.kimlik]);
    const b = async (tur: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,$2,'Gizli','Dosya',$3,'Sistem',current_date,$4) RETURNING kimlik`, [`${tur}-${d.kimlik}`, tur, d.kimlik, Object.values(o.K)[0]])).rows[0].kimlik as string;
    const pr = await b('Proforma'); const ra = await b('Teknik Rapor'); await kvkkIsle(o.db);
    const g = async (id: string) => (await o.sup.query(`SELECT saklama_grubu, saklama_bitis::text s FROM belge WHERE kimlik = $1`, [id])).rows[0];
    expect((await g(pr)).saklama_grubu).toBe('MAL-10'); expect((await g(pr)).s).toContain('2030-12-3');
    expect((await g(ra)).saklama_grubu).toBe('OPS-5'); expect((await g(ra)).s).toContain('2025-0');
  });
});
