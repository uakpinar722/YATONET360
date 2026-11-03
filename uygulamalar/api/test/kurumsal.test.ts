import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { onayEngeli } from '../src/kurumsal.js';
import { parolaOzetle } from '../src/parola.js';
import { ana, ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü' };
const PR = 'Sinama-Parolasi-2026!';
let o: Ortam; let tarafNo: string; let taraf: string; let kurum: string; let yC: string; let yK: string;
const gir = async (ep: string) => {
  const oz = await parolaOzetle(PR);
  const k = (await o.sup.query(`UPDATE kullanici_hesabi SET parola_ozeti = $2, izin_adimi_zamani = now() WHERE e_posta = $1 RETURNING kimlik`, [ep, oz])).rows[0].kimlik as string;
  await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Çalışan','KVKK-04','R00','Türkçe','Web')`, [k]);
  await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [k]);
  const ck = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
  const c = ck(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: ep, parola: PR } }));
  const g = (await o.ist('GET', '/api/kimlik/kurulum', c)).json().gizli as string;
  return { c: ck(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(g, suankiAdim()) })), k };
};

beforeAll(async () => {
  o = await ortamKur('yatonet360_test34', KADRO);
  tarafNo = `T-KUR-${Date.now()}`;
  taraf = (await o.sup.query(`INSERT INTO taraf (taraf_no, kisi_turu, musteri_turu, unvan_ad_soyad, taraf_rolleri, olusturan_ref) VALUES ($1,'Tüzel kişi','Kurumsal Müşteri','Deniz Filo A.Ş.','{Yat Sahibi}',$2) RETURNING kimlik`, [tarafNo, o.K.ds])).rows[0].kimlik;
}, 120_000);
afterAll(async () => { await o.kapat(); });

describe('Kullanıcılarım (YG-1563)', () => {
  it('kurumu yalnız A53 tanımlar; yetkiliye davet metni gider', async () => {
    const g = { tarafNo, ek2Siniri: 5000, yetkiliAd: 'Yetkili', yetkiliEposta: 'yetkili@filo.local' };
    expect((await o.ist('POST', '/api/kurumsal-kurum', await o.gir('ds'), g)).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/kurumsal-kurum', await o.gir('mpm'), { ...g, tarafNo: 'YOK' })).statusCode).toBe(404);
    const r = await o.ist('POST', '/api/kurumsal-kurum', await o.gir('mpm'), g); expect(r.statusCode, r.body).toBe(200); kurum = r.json().kimlik;
    expect((await o.ist('POST', '/api/kurumsal-kurum', await o.gir('mpm'), g)).statusCode).toBe(409);
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE hedef = 'yetkili@filo.local'`)).rows[0].metin as string; expect(m).toContain('Deniz Filo A.Ş. adına YATONET 360 hesabınız açılmıştır');
    const a = await gir('yetkili@filo.local'); yC = a.c; yK = a.k;
  });
  it('yetkili kullanıcı ekler, onay adımı yok, A53 bilgi alır; sınır Ek-2 üstü olamaz; yetkisiz ekleyemez', async () => {
    const u = '/api/kurumsal/kullanici';
    expect((await o.ist('POST', u, yC, { ad: 'A', eposta: 'a@filo.local', rol: 'Yönetici' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, yC, { ad: 'A', eposta: 'a@filo.local', rol: 'Onaylayan' })).statusCode).toBe(400);
    const as = await o.ist('POST', u, yC, { ad: 'A', eposta: 'a@filo.local', rol: 'Onaylayan', sinir: 5000.01 }); expect(as.statusCode).toBe(400); expect(as.json().hata).toContain('Ek-2');
    const r = await o.ist('POST', u, yC, { ad: 'Onaylayan Kişi', eposta: 'onay@filo.local', rol: 'Onaylayan', sinir: 1000 }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [o.K.mpm, `kurumsal-kullanici:${r.json().kimlik}`])).rowCount).toBe(1);
    expect((await o.ist('POST', u, yC, { ad: 'İzleyici Kişi', eposta: 'izle@filo.local', rol: 'İzleyici' })).statusCode).toBe(200);
    const v = (await o.ist('GET', '/api/kurumsal/kullanicilar', yC)).json(); expect(v.kullanicilar).toHaveLength(3); expect(v.ek2Siniri).toBe('5000.00');
    const iz = await gir('izle@filo.local');
    expect((await o.ist('POST', u, iz.c, { ad: 'B', eposta: 'b@filo.local', rol: 'İzleyici' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/portal/ihbar', iz.c, { yatAdi: 'Y', konum: 'K', ozet: 'O' })).statusCode).toBe(403);
    expect((await o.ist('GET', '/api/kurumsal/kullanicilar', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('onay yalnız Onaylayan, kendi ve Ek-2 sınırı içinde', async () => {
    const k = async (e: string) => (await o.sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = $1`, [e])).rows[0].kimlik as string;
    expect(await onayEngeli(o.db, await k('izle@filo.local'), 10)).toContain('Onay yetkiniz');
    expect(await onayEngeli(o.db, await k('onay@filo.local'), 1000)).toBeNull();
    expect(await onayEngeli(o.db, await k('onay@filo.local'), 1000.01)).toContain('sınırınızın');
    await o.sup.query(`UPDATE kurumsal_kurum SET ek2_onay_siniri = 500 WHERE kimlik = $1`, [kurum]);
    expect(await onayEngeli(o.db, await k('onay@filo.local'), 600)).toContain('sınırınızın');
    await o.sup.query(`UPDATE kurumsal_kurum SET ek2_onay_siniri = 5000 WHERE kimlik = $1`, [kurum]);
    expect(await onayEngeli(o.db, o.K.ds!, 10)).toBeNull();
  });
  it('kurum kullanıcısı kurumun yatındaki dosyayı görür, başka kurum görmez; hesap kapatma', async () => {
    const d = await o.dosyaAc(); await o.sup.query(`UPDATE yat SET yat_sahibi_ref = $2 WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik, taraf]);
    const iz = (await o.sup.query(`SELECT kimlik FROM kullanici_hesabi WHERE e_posta = 'izle@filo.local'`)).rows[0].kimlik;
    expect((await o.ist('GET', `/api/portal/dosya/${d.kimlik}`, yC)).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/portal/ana', yC)).json().dosyalar.some((x: { kimlik: string }) => x.kimlik === d.kimlik)).toBe(true);
    expect((await o.ist('POST', `/api/kurumsal/kullanici/${yK}/kapat`, yC, { gerekce: 'G' })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/kurumsal/kullanici/${iz}/kapat`, yC, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/kurumsal/kullanici/${iz}/kapat`, yC, { gerekce: 'Ayrıldı' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT hesap_durumu FROM kullanici_hesabi WHERE kimlik = $1`, [iz])).rows[0].hesap_durumu).toBe('Kapalı');
  });
});

describe('toplu yeniden başlatma (YG-262)', () => {
  it('işi durduran açık uygunsuzluk varken dosya bazında da başlamaz', async () => {
    const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik);
    const k = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ($1,'F','Çözüm Ortağı',$2) RETURNING kimlik`, [`S${Date.now()}`, o.K.ds])).rows[0].kimlik;
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'M','K','Durduruldu',$4) RETURNING kimlik`, [`${d.dosyaNo}-ON01`, d.kimlik, k, o.K.ds])).rows[0].kimlik;
    const be = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('K','K','Gizli','Dosya',$1,'Sistem',current_date,$2) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    const n = (await o.sup.query(`INSERT INTO uygunsuzluk (uygunsuzluk_no, dosya_ref, is_emri_ref, tespit_kaynagi, yer_nitelik, dayanak_olcut, gercek_durum, kanit_belge_ref, sinif, is_durduruldu, acan_ref) VALUES ($1,$2,$3,'K','Y','D','G',$4,'Majör',true,$5) RETURNING kimlik`, [`NCR-T${Date.now()}`, d.kimlik, e, be, o.K.ds])).rows[0].kimlik;
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/is-baslat`, await o.gir('tm'), { gerekce: 'Temiz' }); expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('uygunsuzluk');
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [e])).rows[0].statu).toBe('Durduruldu');
    await o.sup.query(`UPDATE uygunsuzluk SET statu = 'Kapalı' WHERE kimlik = $1`, [n]);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/is-baslat`, await o.gir('tm'), { gerekce: 'Temiz' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [e])).rows[0].statu).toBe('Aktif');
  });
});
