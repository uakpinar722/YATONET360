import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ilaveIsYetkiEngeli, teslimIsle, yabanciBayrakEngeli } from '../src/teslim_ek.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)' };
let o: Ortam;
const dosya = async () => { const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref <> $1 AND bitis_zamani IS NULL`, [d.kimlik]); await o.sup.query(`UPDATE dosya_tarafi SET eposta = 'sahip@teslim.local', telefon = '05000000001' WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]); return d; };
const belge = async (d: string) => (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'K','Gizli','Dosya',$2,'Sistem',current_date,$3) RETURNING kimlik`, [`B-${Math.random()}`, d, o.K.ds])).rows[0].kimlik as string;

beforeAll(async () => { o = await ortamKur('yatonet360_test42', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('onay ekranları (YG-471, YG-474, YG-472, YG-1500)', () => {
  it('altı varyant onaylı metinle açılır; eksik alan reddedilir', async () => {
    const d = await dosya(); const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/onay-iste`;
    await o.sup.query(`UPDATE dosya SET hiza_kontrol_zamani = now() WHERE kimlik = $1`, [d.kimlik]);
    expect((await o.ist('POST', u, ds, { ony: 'ONY-99' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ony: 'ONY-07' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ony: 'ONY-08', parca: 'P' })).statusCode).toBe(400);
    for (const g of [{ ony: 'ONY-03' }, { ony: 'ONY-06', teklifNo: 'T-1', yapilmayanIs: 'Şaft yatağı yenileme', teknikEtki: 'Titreşim', kullanimSiniri: '1.500 dev/dk üstü kullanılmamalı', onerilenKontrol: '50 saat sonra kontrol' }, { ony: 'ONY-07', parca: 'Pompa' }, { ony: 'ONY-08', parca: 'Şaft', tutar: 1234.5 }, { ony: 'ONY-09', zaman: '2026-12-01T10:00:00Z' }, { ony: 'ONY-10', kayitNo: 'GK-1' }]) { const r = await o.ist('POST', u, ds, g); expect(r.statusCode, r.body).toBe(200); const m = (await o.sup.query(`SELECT metin FROM onay_talebi WHERE kimlik = $1`, [r.json().kimlik])).rows[0].metin as string; expect(m).not.toMatch(/\[[^\]]+\]/); }
    expect((await o.sup.query(`SELECT metin FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-08'`, [d.kimlik])).rows[0].metin).toContain('1.234,50');
    expect((await o.ist('POST', u, ds, { ony: 'ONY-06', teklifNo: 'T-2' })).statusCode).toBe(400); // YG-726
    expect((await o.sup.query(`SELECT kullanim_siniri FROM ek_is_reddi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].kullanim_siniri).toBe('1.500 dev/dk üstü kullanılmamalı');
  });
  it('ONY-28 yalnız sigortasız dosyada', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    const r = await o.ist('POST', `/api/acil/${d.kimlik}/ilk-tedbir-talebi`, ds, {}); expect(r.statusCode, r.body).toBe(200);
    await o.sup.query(`UPDATE dosya SET dosya_niteligi = 'Sigorta bağlantılı' WHERE kimlik = $1`, [d.kimlik]);
    expect((await o.ist('POST', `/api/acil/${d.kimlik}/ilk-tedbir-talebi`, ds, {})).statusCode).toBe(409);
  });
});

describe('kapılar (YG-473, YG-099)', () => {
  it('yetkisi doğrulanmamış ihbarda ilave iş açılmaz', async () => {
    const d = await dosya(); expect(await ilaveIsYetkiEngeli(o.db, d.kimlik, 'ON')).toBeNull();
    const t = (await o.sup.query(`SELECT talep_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].talep_ref;
    await o.sup.query(`UPDATE talep SET ihbar_yetki_durumu = 'Bilgi Amaçlı' WHERE kimlik = $1`, [t]);
    expect(await ilaveIsYetkiEngeli(o.db, d.kimlik, 'EK')).toContain('Yetki belgesi');
    await o.sup.query(`UPDATE talep SET ihbar_yetki_durumu = 'Doğrulandı' WHERE kimlik = $1`, [t]);
    expect(await ilaveIsYetkiEngeli(o.db, d.kimlik, 'EK')).toBeNull();
  });
  it('yabancı bayrakta süresi dolmuş belge ve kalış aşımı', async () => {
    const d = await dosya(); const yt = (await o.sup.query(`SELECT yat_ref FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].yat_ref;
    await o.sup.query(`UPDATE yat SET bayrak = 'Malta', yabanci_yat_belge_gecerlilik = '2020-01-01', turkiye_kalis_bitis = '2099-01-01' WHERE kimlik = $1`, [yt]);
    expect(await yabanciBayrakEngeli(o.db, d.kimlik)).toContain('süresi dolmuş');
    await o.sup.query(`UPDATE yat SET yabanci_yat_belge_gecerlilik = '2099-01-01', turkiye_kalis_bitis = '2030-01-01' WHERE kimlik = $1`, [yt]);
    await o.sup.query(`UPDATE dosya_tarafi SET aktif = false WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi'`, [d.kimlik]); // YG-1446: iletişimsiz yat sahibinde engel kalır
    expect(await yabanciBayrakEngeli(o.db, d.kimlik, '2031-01-01')).toContain('kalış');
    await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, telefon, olusturan_ref) VALUES ($1,'Yat Sahibi','Sahip','+905550003333',$2)`, [d.kimlik, o.K.ds]); // YG-1446 BLD-53
    expect(await yabanciBayrakEngeli(o.db, d.kimlik, '2031-01-01')).toBeNull();
    const m53 = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1`, [`bld53:${d.kimlik}:2031-01-01%`])).rows;
    expect(m53.length).toBeGreaterThan(0); expect(m53[0].metin).toContain('01.01.2031'); expect(m53[0].metin).toContain('01.01.2030');
    expect(await yabanciBayrakEngeli(o.db, d.kimlik, '2031-01-01')).toBeNull();
    expect((await o.sup.query(`SELECT count(*)::int n FROM gonderim WHERE olay_anahtari LIKE $1`, [`bld53:${d.kimlik}:2031-01-01%`])).rows[0].n).toBe(m53.length); // ikinci kez gitmez
    expect(await yabanciBayrakEngeli(o.db, d.kimlik, '2029-01-01')).toBeNull();
    await o.sup.query(`UPDATE yat SET bayrak = 'Türkiye', yabanci_yat_belge_gecerlilik = '2020-01-01' WHERE kimlik = $1`, [yt]);
    expect(await yabanciBayrakEngeli(o.db, d.kimlik)).toBeNull();
  });
});

describe('ulaşım planı (YG-1486)', () => {
  it('yurt dışı dosyada randevu sayacı ulaşım planı tarihinden kurulur', async () => {
    const d = await dosya(); const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/ulasim-plani`;
    await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    expect((await o.ist('POST', u, ds, { zaman: '2030-01-10T09:00:00Z' })).statusCode).toBe(409);
    await o.sup.query(`UPDATE dosya SET yurt_disi = true WHERE kimlik = $1`, [d.kimlik]);
    expect((await o.ist('POST', u, ds, { zaman: 'yarın' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, ds, { zaman: '2030-01-10T09:00:00Z' }); expect(r.statusCode, r.body).toBe(200);
    const s = (await o.sup.query(`SELECT baslangic FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Randevu İletişimi' AND tamamlanma IS NULL`, [d.kimlik])).rows;
    expect(s.length).toBe(1); expect(new Date(s[0].baslangic).toISOString()).toBe('2030-01-10T09:00:00.000Z');
    await o.sup.query(`UPDATE dosya SET yurt_disi = false WHERE kimlik = $1`, [d.kimlik]);
  });
});

describe('teslim (YG-481, YG-1435, YG-1498, YG-088)', () => {
  it('hazır bildirimi 7 gün; süre geçince BLD-14 ve barınma görevi', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    const th = (await o.ist('POST', `/api/dosya/${d.kimlik}/teslime-hazir`, ds, {})).json(); expect(th.hata).toContain('yetkili alıcı'); // YG-415
    expect([th.islem, th.hedef]).toEqual(['Alıcıyı Doğrula', 'ta-a']); // YG-1386
    const al = (await o.ist('GET', `/api/dosya/${d.kimlik}/teslim-alicilari`, ds)).json() as { kimlik: string; taraf_rolu: string }[];
    const sh = al.find((x) => x.taraf_rolu === 'Yat Sahibi')!; expect(sh).toBeTruthy();
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-alici-dogrula`, ds, { alici: sh.kimlik, yontem: 'Uydurma' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-alici-dogrula`, ds, { alici: sh.kimlik, yontem: 'Kimlik Belgesi' })).statusCode).toBe(200);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teslime-hazir`, ds, {}); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslime-hazir`, ds, {})).statusCode).toBe(409);
    await teslimIsle(o.db, new Date(Date.now() + 8 * 86_400_000));
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Barınma Gideri' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari LIKE $1`, [`bld14:${d.kimlik}%`])).rowCount).toBeGreaterThan(0);
    // YG-550: 30. gün ihtar görevi ve risk geçişi, 90. gün tevdi veya satış değerlendirmesi
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Teslim Alınmayan Yat İhtarı' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(0);
    await teslimIsle(o.db, new Date(Date.now() + 31 * 86_400_000));
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Teslim Alınmayan Yat İhtarı' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
    expect((await o.sup.query(`SELECT teslim_risk_gecis_zamani FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].teslim_risk_gecis_zamani).not.toBeNull();
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Tevdi veya Satış Değerlendirmesi' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(0);
    await teslimIsle(o.db, new Date(Date.now() + 91 * 86_400_000)); await teslimIsle(o.db, new Date(Date.now() + 92 * 86_400_000));
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur IN ('Tevdi veya Satış Değerlendirmesi', 'Teslim Alınmayan Yat İhtarı') AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(2);
  });
  it('tek hatırlatma, sonra onaysız teslim; fotoğraf zorunlu', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    await o.sup.query(`INSERT INTO teslim_kaydi (dosya_ref, teslim_eden_ref) VALUES ($1,$2)`, [d.kimlik, o.K.ds]);
    const P = { aliciTuru: 'Marina veya Tersane', alici: 'Marina Görevlisi' };
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-onaysiz`, ds, { ...P, belge: await belge(d.kimlik) })).json().hata).toContain('hatırlatma');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-hatirlat`, ds, {})).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-hatirlat`, ds, {})).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-onaysiz`, ds, P)).json().hata).toContain('fotoğraf');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-onaysiz`, ds, { ...P, belge: await belge(d.kimlik) }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT durum, alici_turu FROM teslim_kaydi WHERE dosya_ref = $1`, [d.kimlik])).rows[0]).toEqual({ durum: 'Teslim Edildi - Onay Verilmedi', alici_turu: 'Marina veya Tersane' });
    expect((await o.sup.query(`SELECT 1 FROM gonderim WHERE olay_anahtari LIKE 'bld49:%'`)).rowCount).toBeGreaterThan(0);
  });
  it('Dosya Sorumlusu İlerleme Özetini gönderir; metinde firma ve fiyat yok (T-YG555-OZET)', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ilerleme-ozeti`, ds, {})).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/ilerleme-ozeti`, ds, { sonrakiAdim: 'Gövde boyası' }); expect(r.statusCode, r.body).toBe(200);
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld93:${d.kimlik}%`])).rows[0]?.metin as string;
    expect(m).toContain('Gövde boyası'); expect(m).not.toContain('EUR'); expect(m).not.toContain('[');
    // YG-555: RP-RAP-006 PDF eki dosya belgesi olarak saklanır ve e-postaya eklenir; yabancı görsel seçilemez
    const ek = (await o.sup.query(`SELECT s.dosya_adi, e.belge_turu, e.bag_kimligi FROM belge_surum s JOIN belge e ON e.kimlik = s.belge_ref WHERE s.kimlik = $1`, [r.json().belgeSurumu])).rows[0];
    expect(ek).toMatchObject({ belge_turu: 'Müşteri İlerleme Özeti', bag_kimligi: d.kimlik }); expect(ek.dosya_adi).toMatch(/RAP006/);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ilerleme-ozeti`, ds, { sonrakiAdim: 'X', gorseller: ['YOK-G0001'] })).statusCode).toBe(400);
  });
  it('Dosya Sorumlusu belge talebi ve ulaşılamama bildirimi gönderir (T-YG551)', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/belge-talebi`, ds, { belgeler: [] })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/belge-talebi`, await o.gir('ty'), { belgeler: ['Ruhsat'] })).statusCode).not.toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/belge-talebi`, ds, { belgeler: ['Ruhsat', ' Poliçe '] })).statusCode).toBe(200);
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld17:${d.kimlik}%`])).rows[0]?.metin as string;
    expect(m).toContain('Ruhsat, Poliçe'); expect(m).not.toContain('['); expect(m).toContain('operasyon@limitglobalmarine.com.tr');
    { const e = await o.ist('POST', `/api/dosya/${d.kimlik}/belge-talebi`, ds, { eksikler: true }); expect(e.statusCode, e.body).toBe(200); // YG-1439: sistem listesindeki eksik zorunlu belgeler
      const me = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld17e:${d.kimlik}%`])).rows[0]?.metin as string;
      expect(me).toContain('Ruhsat / Tonilato veya Tescil Belgesi'); expect(me).not.toContain('['); }
    await o.sup.query(`UPDATE kullanici_hesabi SET cep_telefonu = coalesce(cep_telefonu, '+905550001551') WHERE kimlik = $1`, [o.K.ds]);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/belge-talebi`, ds, { ulasilamadi: true })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM gonderim WHERE olay_anahtari LIKE $1`, [`bld18:${d.kimlik}%`])).rows[0].n).toBeGreaterThan(0);
  });
  it('ıslak imzalı taranmış tutanakla teslim onaylı sayılır (T-YG1433-ISLAK)', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    await o.sup.query(`INSERT INTO teslim_kaydi (dosya_ref, teslim_eden_ref) VALUES ($1,$2)`, [d.kimlik, o.K.ds]);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-islak-imza`, ds, { aliciTuru: 'Yat Sahibi', alici: 'Sahip' })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/teslim-islak-imza`, ds, { aliciTuru: 'Yat Sahibi', alici: 'Sahip', belge: await belge(d.kimlik) }); expect(r.statusCode, r.body).toBe(200);
    const k = (await o.sup.query(`SELECT durum, islak_imzali_belge_ref IS NOT NULL b FROM teslim_kaydi WHERE dosya_ref = $1`, [d.kimlik])).rows[0];
    expect(k).toEqual({ durum: 'Teslim Edildi', b: true });
  });
  it('yasal bekleme bitince BLD-50 ve görev; erken ifada yok', async () => {
    const d = await dosya(); const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,'Karar','Tam Onay',$3) RETURNING kimlik`, [`${d.dosyaNo}-T`, d.kimlik, o.K.ts])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO on_bilgilendirme_cayma_kaydi (teklif_ref, dosya_ref, on_bilgilendirme_zamani, sozlesme_zamani, cayma_bitis, erken_ifa_onayi) VALUES ($1,$2,now() - interval '20 days',now() - interval '20 days',now() - interval '1 day',false)`, [t, d.kimlik]);
    await teslimIsle(o.db);
    const m = (await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`bld50:${t}%`])).rows[0].metin as string; expect(m).toContain('Yasal bekleme'); expect(m.toLowerCase()).not.toContain('cayma');
    expect((await o.sup.query(`SELECT 1 FROM is_karti WHERE tur = 'Çalışmayı Başlat' AND nesne_kimligi = $1`, [d.kimlik])).rowCount).toBe(1);
  });
  it('yat kabul tutanağı alanları ve fotoğraf zorunlu; kapanış hesabı', async () => {
    const d = await dosya(); const ds = await o.gir('ds'); const P = { teslimAlan: 'LGM', envanter: 'E', anahtarlar: 'A', sayaclar: 'S', yakit: '%50' };
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yat-kabul`, ds, { ...P, envanter: '' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yat-kabul`, ds, P)).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yat-kabul`, ds, { ...P, belge: await belge(d.kimlik) })).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/kapanis-hesabi`, ds)).json()).toMatchObject({ acikAlacak: 0, firmaBorcu: 0 });
  });
  it('tutanak: görevli firmada firma zorunlu; şifre yazılmaz; kayıt değişmez, ek kayıtla düzeltilir (YG-089)', async () => {
    const d = await dosya(); const ds = await o.gir('ds'); const P = { teslimAlan: 'LGM', envanter: 'E', anahtarlar: 'A', sayaclar: 'S', yakit: '%50', belge: await belge(d.kimlik) };
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yat-kabul`, ds, { ...P, teslimAlan: 'Görevli Firma' })).json().hata).toContain('görevli firmayı');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yat-kabul`, ds, { ...P, anahtarlar: 'Kapı şifre: 4471' })).json().hata).toContain('hassas');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/yat-kabul`, ds, P); expect(r.statusCode, r.body).toBe(200); const k = r.json().kimlik;
    await expect(o.sup.query(`UPDATE yat_kabul_tutanagi SET yakit_seviyesi = '%60' WHERE kimlik = $1`, [k])).rejects.toThrow(/değiştirilemez/);
    expect((await o.ist('POST', `/api/tutanak/yat-kabul/${k}/ek`, ds, { metin: 'PIN 1234' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/tutanak/yat-kabul/${k}/ek`, ds, { metin: 'Yakıt seviyesi %60 olarak düzeltildi' })).statusCode).toBe(200);
    const l = (await o.ist('GET', `/api/tutanak/yat-kabul/${k}/ek`, ds)).json(); expect(l).toHaveLength(1); expect(l[0].metin).toContain('%60');
  });
});

describe('sökülen parça (YG-482)', () => {
  it('liste, seçim, 30 gün; geçersiz seçim reddedilir', async () => {
    const d = await dosya(); const ds = await o.gir('ds');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/sokulen-parca`, ds, { ad: 'Pompa', konum: 'Makine' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', `/api/sokulen-parca/${r.json().kimlik}/secim`, ds, { secim: 'Sat' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/sokulen-parca/${r.json().kimlik}/secim`, ds, { secim: 'Sigorta Eksperi İncelemesi İçin Bekletme' })).statusCode).toBe(200);
    const l = (await o.ist('GET', `/api/dosya/${d.kimlik}/sokulen-parca`, ds)).json(); expect(l[0].secim).toContain('Eksper');
    expect((new Date(l[0].son_tarih).getTime() - Date.now()) / 86_400_000).toBeGreaterThan(28);
  });
});

describe('sökülen parça sonucu (YG-730)', () => {
  it('fotoğrafsız kayıt yok; sigortalı dosyada imha sigorta onay belgesi ister', async () => {
    const d = await dosya();
    await o.sup.query(`UPDATE dosya SET dosya_niteligi = 'Sigorta bağlantılı' WHERE kimlik = $1`, [d.kimlik]);
    const ds = await o.gir('ds');
    const p = (await o.ist('POST', `/api/dosya/${d.kimlik}/sokulen-parca`, ds, { ad: 'Pervane' })).json().kimlik;
    await o.ist('POST', `/api/sokulen-parca/${p}/secim`, ds, { secim: 'Hurda-Bertaraf' });
    const foto = await belge(d.kimlik); const onay = await belge(d.kimlik);
    expect((await o.ist('POST', `/api/sokulen-parca/${p}/sonuc`, ds, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/sokulen-parca/${p}/sonuc`, ds, { foto })).statusCode).toBe(409);
    expect((await o.ist('POST', `/api/sokulen-parca/${p}/sonuc`, ds, { akibet: 'Uydurma', foto, sigortaOnay: onay })).statusCode).toBe(400); // YG-406
    expect((await o.ist('POST', `/api/sokulen-parca/${p}/sonuc`, ds, { akibet: 'Çevresel Bertaraf', foto, sigortaOnay: onay })).json().sonuc).toBe('Çevresel Bertaraf');
  });
});
