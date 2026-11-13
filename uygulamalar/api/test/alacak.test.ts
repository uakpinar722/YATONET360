import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acikAlacak, alacakYolu, gecikmeFaizi, isAcmaEngeli, krediDurumu, krediUyarilari, sozlesmeEngeli } from '../src/alacak.js';
import { COOKIE_ADI } from '../src/ayarlar.js';
import { uyusmazlikTanim } from '../src/belge_uret.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { sonMakam } from '../src/teklif.js';
import { alacakIsle, teslimEngeli } from '../src/ticari.js';
import { ana, ortamKur, PAROLA, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', my: 'Muhasebe ve Finans Yöneticisi', mfm: 'Muhasebe ve Finans Müdürü', tid: 'Ticari İşler Direktörü', gmy: 'Genel Müdür Yardımcısı', hud: 'Hukuk ve Uyum Direktörü', sc: 'Sicil Sorumlusu' };
let o: Ortam; let say = 0;
const kurumsal = async (eklenen = 0) => {
  const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref <> $1 AND bitis_zamani IS NULL`, [d.kimlik]);
  await o.sup.query(`UPDATE dosya SET musteri_turu = 'Kurumsal Müşteri' WHERE kimlik = $1`, [d.kimlik]);
  const t = (await o.sup.query(`SELECT y.yat_sahibi_ref r, x.taraf_no FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref JOIN taraf x ON x.kimlik = y.yat_sahibi_ref WHERE d.kimlik = $1`, [d.kimlik])).rows[0];
  if (eklenen) await teklif(d, eklenen);
  return { d, taraf: t.r as string, no: t.taraf_no as string };
};
const teklif = async (d: { kimlik: string; dosyaNo: string }, tutar: number, muhatap = 'Kurumsal Müşteri') => (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, hazirlayan_ref) VALUES ($1,$2,$3,20,'Karar','Tam Onay',$4,0,$4,$5) RETURNING kimlik`, [`${d.dosyaNo}-T${++say}`, d.kimlik, muhatap, tutar, o.K.ts])).rows[0].kimlik as string;
const fatura = async (d: { kimlik: string; dosyaNo: string }, g: { toplam?: number; tarih?: string; vade?: string; muhatap?: string } = {}) => (await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, fatura_no, fatura_tarihi, kur, kur_tarihi, vade, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,0,$5,'Faturalandı',$6,$7,40,$7,$8,$9) RETURNING kimlik`, [`PF-${d.dosyaNo}-${++say}`, d.kimlik, await teklif(d, g.toplam ?? 1000, g.muhatap ?? 'Kurumsal Müşteri'), g.muhatap ?? 'Kurumsal Müşteri', g.toplam ?? 1000, `MF-${d.dosyaNo}-${say}`, g.tarih ?? new Date().toISOString().slice(0, 10), g.vade ?? '2099-01-01', o.K.ts])).rows[0].kimlik as string;
const ceoGir = async () => {
  const ck = (r: any) => r.cookies.find((c: any) => c.name === COOKIE_ADI)?.value as string;
  const c = ck(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: 'ceo@deneme.yatonet.local', parola: PAROLA } }));
  const k = await o.ist('GET', '/api/kimlik/kurulum', c);
  return ck(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(k.json().gizli, suankiAdim()) }));
};

beforeAll(async () => { o = await ortamKur('yatonet360_test38', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('hukuk kararı (YG-820, YG-912, YG-914)', () => {
  it('zincir HUD, GMY, CEO; GMY nihai karar veremez; yalnız CEO onaylar', async () => {
    const { d } = await kurumsal(); const u = `/api/dosya/${d.kimlik}/hukuk-karari`;
    expect((await o.ist('POST', u, await o.gir('ts'), { tur: 'Dava', oneri: 'Ö' })).statusCode).toBe(403);
    expect((await o.ist('POST', u, await o.gir('mfm'), { tur: 'Nafaka', oneri: 'Ö' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, await o.gir('mfm'), { tur: 'Alacak Silme', oneri: 'Tahsil imkânı yok', tutar: 500 }); expect(r.statusCode, r.body).toBe(200);
    const k = await o.kart('Hukuk Kararı', r.json().kimlik); expect(k.zincir).toHaveLength(3);
    expect((await o.karar(k.kimlik, 'gmy', 'Onayla')).statusCode).toBe(403);
    expect((await o.karar(k.kimlik, 'hud', 'Onaya Gönder', 'Görüş')).statusCode).toBe(200);
    expect((await o.karar(k.kimlik, 'gmy', 'Onaya Gönder', 'Görüş')).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/is/${k.kimlik}/karar`, await ceoGir(), { karar: 'Onayla' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM hukuk_karari WHERE kimlik = $1`, [r.json().kimlik])).rows[0].durum).toBe('Onaylandı');
  });
  it('60. günde sistem önerisi açılır; muhataba göre yol', async () => {
    expect(alacakYolu('Bireysel Müşteri', 100)).toContain('Tüketici Hakem Heyeti');
    expect(alacakYolu('Bireysel Müşteri', 1000, { kur: 50, kurTarihi: '01.12.2026', sinirTl: 186000 })).toContain('altında: Tüketici Hakem Heyeti'); // YG-913
    expect(alacakYolu('Bireysel Müşteri', 10000, { kur: 50, kurTarihi: '01.12.2026', sinirTl: 186000 })).toContain('üstünde: zorunlu arabuluculuk');
    expect(alacakYolu('Sigorta Şirketi', 100)).toContain('arabuluculuk'); expect(alacakYolu('Sigorta Şirketi', 100)).not.toContain('Hakem');
    const { d } = await kurumsal(); const f = await fatura(d, { toplam: 900, vade: '2026-01-01' });
    await alacakIsle(o.db, new Date('2026-03-15T12:00:00Z'));
    const h = (await o.sup.query(`SELECT kimlik, tutar_eur, oneri FROM hukuk_karari WHERE fatura_ref = $1 AND tur = 'Alacak Yolu'`, [f])).rows[0]; expect(h.tutar_eur).toBe('900.00'); expect(h.oneri).toContain('icra');
    expect((await o.kart('Hukuk Kararı', h.kimlik)).zincir).toHaveLength(3);
  });
});

describe('kredi limiti (YG-909, YG-1488)', () => {
  it('%80 uyarı; aşımda ON, PH, EK engeli; GMY onayıyla açılır; bireyselde limit yok', async () => {
    const { d, taraf } = await kurumsal(15000); expect(await acikAlacak(o.db, taraf)).toBe(15000);
    expect((await krediDurumu(o.db, d.kimlik))).toMatchObject({ limit: 20000, oran: 75, uyari: false, asim: false });
    await fatura(d, { toplam: 2000 }); expect((await krediDurumu(o.db, d.kimlik))).toMatchObject({ oran: 85, uyari: true, asim: false });
    expect(await krediUyarilari(o.db)).toBeGreaterThanOrEqual(1); expect(await krediUyarilari(o.db)).toBe(0);
    expect(await isAcmaEngeli(o.db, d.kimlik, 'ON')).toBeNull();
    await teklif(d, 3001);
    expect((await krediDurumu(o.db, d.kimlik))).toMatchObject({ asim: true, buyuk: true });
    for (const t of ['ON', 'PH', 'EK']) expect(await isAcmaEngeli(o.db, d.kimlik, t)).toContain('kredi limitini');
    expect(await isAcmaEngeli(o.db, d.kimlik, 'KN')).toBeNull();
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/is-acma-onayi`, await o.gir('ds'), { tur: 'Kredi Limiti', gerekce: 'Stratejik' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/is-acma-onayi`, await o.gir('ds'), { tur: 'Kredi Limiti', gerekce: 'X' })).statusCode).toBe(409);
    const k = await o.kart('İş Açma Onayı', r.json().kimlik); expect((await o.karar(k.kimlik, 'gmy', 'Onayla')).statusCode).toBe(200);
    expect(await isAcmaEngeli(o.db, d.kimlik, 'ON')).toBeNull();
    const b = await o.dosyaAc({}, {}); expect(await krediDurumu(o.db, b.kimlik)).toBeNull();
  });
});

describe('konkordato (YG-1490)', () => {
  it('acil ve sigorta muaf; diğerine GMY onayı ve peşin tahsilat', async () => {
    const { d, no } = await kurumsal(1000);
    expect((await o.ist('POST', '/api/taraf-risk-olayi', await o.gir('ds'), { tarafNo: no, olay: 'Konkordato' })).statusCode).toBe(403);
    const r = await o.ist('POST', '/api/taraf-risk-olayi', await o.gir('hud'), { tarafNo: no, olay: 'Konkordato' }); expect(r.statusCode, r.body).toBe(200);
    expect(await isAcmaEngeli(o.db, d.kimlik, 'AC')).toBeNull();
    expect(await isAcmaEngeli(o.db, d.kimlik, 'KN')).toContain('Konkordato');
    const a = await o.ist('POST', `/api/dosya/${d.kimlik}/is-acma-onayi`, await o.gir('ds'), { tur: 'Konkordato', gerekce: 'G' }); const k = await o.kart('İş Açma Onayı', a.json().kimlik); await o.karar(k.kimlik, 'gmy', 'Onayla');
    expect(await isAcmaEngeli(o.db, d.kimlik, 'KN')).toContain('peşin');
    const f = await fatura(d, { toplam: 1000 }); await o.sup.query(`INSERT INTO tahsilat (fatura_ref, dosya_ref, tutar_eur, tarih, kanal, giren_ref) VALUES ($1,$2,1000,current_date,'Havale',$3)`, [f, d.kimlik, o.K.ts]);
    expect(await isAcmaEngeli(o.db, d.kimlik, 'KN')).toBeNull();
  });
});

describe('gecikme faizi (YG-872)', () => {
  it('tür müşteriye göre; sigortada yok; oran yoksa hesap yok; yalnız Müdür girer', async () => {
    const s = new Date('2026-12-31T00:00:00Z'); const F = { vade: '2026-12-01', kalan: 1000 };
    expect(await gecikmeFaizi(o.db, F, 'Sigorta Şirketi', s)).toBeNull();
    expect(await gecikmeFaizi(o.db, F, 'Bireysel Müşteri', s)).toMatchObject({ gun: 30, tur: 'Kanuni Faiz', faiz: null });
    expect((await o.ist('POST', '/api/faiz-orani', await o.gir('ts'), { tur: 'Kanuni Faiz', oran: 24, yururluk: '2026-01-01', dayanak: 'D' })).statusCode).toBe(403);
    expect((await o.ist('POST', '/api/faiz-orani', await o.gir('mfm'), { tur: 'Kanuni Faiz', oran: 24, yururluk: '2026-01-01', dayanak: 'Resmî Gazete' })).statusCode).toBe(200);
    expect(await gecikmeFaizi(o.db, F, 'Bireysel Müşteri', s)).toMatchObject({ oran: 24, faiz: 19.73 });
    expect((await gecikmeFaizi(o.db, F, 'Kurumsal Müşteri', s))?.tur).toBe('Ticari Temerrüt Faizi');
  });
});

describe('fatura itirazı (YG-887)', () => {
  it('8 gün; açık tutarı aşamaz; TİD yanıtlar; teslimde itiraz edilen kısım aranmaz', async () => {
    const { d } = await kurumsal(); const f = await fatura(d, { toplam: 1000, vade: '2026-01-01' }); const ds = await o.gir('ds'); const u = `/api/fatura/${f}/itiraz`;
    expect((await o.ist('POST', u, ds, { kalem: 'K', gerekce: 'G' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { kalem: 'K', gerekce: 'G', tutar: 1000.01 })).statusCode).toBe(409);
    expect(await teslimEngeli(o.db, d.kimlik)).toContain('1.000,00');
    const r = await o.ist('POST', u, ds, { kalem: 'İşçilik', gerekce: 'Fazla', tutar: 400 }); expect(r.statusCode, r.body).toBe(200);
    expect(await teslimEngeli(o.db, d.kimlik)).toContain('600,00');
    expect((await o.ist('POST', `/api/fatura-itirazi/${r.json().kimlik}/yanit`, ds, { karar: 'Kabul', yanit: 'Y' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/fatura-itirazi/${r.json().kimlik}/yanit`, await o.gir('tid'), { karar: 'Ret', yanit: 'Uygun' })).statusCode).toBe(200);
    expect(await teslimEngeli(o.db, d.kimlik)).toContain('1.000,00');
    const s = await o.dosyaAc({}, {}); await o.ekipKur(s.kimlik); const fs = await fatura(s, { toplam: 500, muhatap: 'Sigorta Şirketi', tarih: '2026-01-01' });
    expect((await o.ist('POST', `/api/fatura/${fs}/itiraz`, await o.gir('ds'), { kalem: 'K', gerekce: 'G', tutar: 10 })).json().hata).toContain('Sekiz günlük');
  });
});

describe('haciz ve tarama (YG-915, YG-916)', () => {
  it('ihbar carisi bloke eder; cevapla kalkar; görevi kapanır', async () => {
    const fr = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-H','Hacizli','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const P = { no: 'H1', teblig: new Date().toISOString(), cevapSon: '2099-01-01' };
    expect((await o.ist('POST', `/api/firma/${fr}/haciz-ihbari`, await o.gir('tid'), P)).statusCode).toBe(403);
    const r = await o.ist('POST', `/api/firma/${fr}/haciz-ihbari`, await o.gir('hud'), P); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT cari_bloke FROM kurulus WHERE kimlik = $1`, [fr])).rows[0].cari_bloke).toBe(true);
    const r2 = await o.ist('POST', `/api/firma/${fr}/haciz-ihbari`, await o.gir('hud'), { ...P, no: 'H2' });
    await o.ist('POST', `/api/haciz-ihbari/${r.json().kimlik}/cevap`, await o.gir('hud'), { cevap: 'Borç yok', blokeKaldir: true });
    expect((await o.sup.query(`SELECT cari_bloke FROM kurulus WHERE kimlik = $1`, [fr])).rows[0].cari_bloke).toBe(true);
    await o.ist('POST', `/api/haciz-ihbari/${r2.json().kimlik}/cevap`, await o.gir('hud'), { cevap: 'Borç yok', blokeKaldir: true });
    expect((await o.sup.query(`SELECT cari_bloke FROM kurulus WHERE kimlik = $1`, [fr])).rows[0].cari_bloke).toBe(false);
    expect((await o.sup.query(`SELECT durum FROM is_karti WHERE tur = 'Haciz İhbarı Cevabı' AND nesne_kimligi = $1`, [r.json().kimlik])).rows[0].durum).toBe('Tamamlandı');
  });
  it('tarama sonucu yazılır; üçüncü kişi tahsilatı onaysız girilmez, onay tek kullanımlık', async () => {
    const { d, no } = await kurumsal(); const hud = await o.gir('hud');
    expect((await o.ist('POST', '/api/taraf-tarama', hud, { tarafNo: no, sonuc: 'Şüpheli' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/taraf-tarama', hud, { tarafNo: no, sonuc: 'İnceleme' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT tarama_sonucu FROM taraf WHERE taraf_no = $1`, [no])).rows[0].tarama_sonucu).toBe('İnceleme');
    const ts = await o.gir('ts'); const f = await fatura(d, { toplam: 1000 });
    const u = await o.ist('POST', `/api/dosya/${d.kimlik}/ucuncu-kisi-odeme`, ts, { ad: 'Başka Şirket', tutar: 100, gerekce: 'Grup şirketi' }); expect(u.statusCode, u.body).toBe(200);
    const T = { fatura: f, tutar: 100, tarih: '2026-11-04', kanal: 'Havale', ucuncuKisi: u.json().kimlik };
    expect((await o.ist('POST', '/api/tahsilat', ts, T)).json().hata).toContain('onay bekleniyor');
    const k = await o.kart('Üçüncü Kişi Ödemesi', u.json().kimlik); await o.karar(k.kimlik, 'hud', 'Onaya Gönder'); await o.karar(k.kimlik, 'tid', 'Onayla');
    expect((await o.ist('POST', '/api/tahsilat', ts, T)).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/tahsilat', ts, T)).json().hata).toContain('onay bekleniyor');
  });
});

describe('uyuşmazlık (YG-107)', () => {
  it('yalnız HUD; savunma görevi; paket kayıtları listeler', async () => {
    const { d } = await kurumsal(); await fatura(d, { toplam: 700 });
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/uyusmazlik`, await o.gir('ds'), { merci: 'M' })).statusCode).toBe(403);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/uyusmazlik`, await o.gir('hud'), { merci: 'Tüketici Hakem Heyeti', esasNo: '2026/1', savunmaSon: '2099-01-01' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.kart('Savunma Süresi', r.json().kimlik)).baslik).toContain('Savunma');
    expect((await o.ist('POST', `/api/uyusmazlik/${r.json().kimlik}/paket`, await o.gir('hud'), {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM belge_uretim WHERE tur = 'Uyuşmazlık Paketi' AND nesne = $1`, [r.json().kimlik])).rowCount).toBe(1);
    const t = await uyusmazlikTanim(o.db, r.json().kimlik, 'K'); expect('kod' in t.t).toBe(false); // Ek II'de kodlu araç değil (V-450) expect(JSON.stringify(t.t.bolumler)).toContain('700,00'); expect(JSON.stringify(t.t.bolumler)).toContain('2026/1');
  });
});

describe('sözleşme kapısı (YG-923)', () => {
  it('imzalı nüsha ve birlikte imza olmadan yürürlüğe girmez; süresi geçince engel döner', async () => {
    await o.sup.query(`UPDATE sistem_parametresi SET deger = 1 WHERE kod = 'sozlesme_kapisi'`);
    try {
      const fr = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-S','Sözleşmeli','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
      expect(await sozlesmeEngeli(o.db, fr)).toContain('imzalı nüsha');
      const sc = await o.gir('sc');
      expect((await o.ist('POST', `/api/firma/${fr}/sozlesme`, await o.gir('ds'), { tur: 'Tedarik', yururluk: '2026-01-01' })).statusCode).toBe(403);
      expect((await o.ist('POST', `/api/firma/${fr}/sozlesme`, sc, { tur: 'Yok', yururluk: '2026-01-01' })).statusCode).toBe(400);
      const s = await o.ist('POST', `/api/firma/${fr}/sozlesme`, sc, { tur: 'İş Birliği Firması Çerçeve Sözleşmesi', yururluk: '2026-01-01' }); expect(s.statusCode, s.body).toBe(200);
      const bl = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('Nüsha','K','Gizli','Kuruluş',$1,'Sistem',current_date,$2) RETURNING kimlik`, [fr, o.K.sc])).rows[0].kimlik;
      expect((await o.ist('POST', `/api/sozlesme/${s.json().kimlik}/yururluk`, sc, { birlikteImza: true })).statusCode).toBe(400);
      expect((await o.ist('POST', `/api/sozlesme/${s.json().kimlik}/yururluk`, sc, { belge: bl })).json().hata).toContain('Birlikte imza');
      expect(await sozlesmeEngeli(o.db, fr)).not.toBeNull();
      expect((await o.ist('POST', `/api/sozlesme/${s.json().kimlik}/yururluk`, sc, { belge: bl, birlikteImza: true })).statusCode).toBe(200);
      expect(await sozlesmeEngeli(o.db, fr)).toBeNull();
      await o.sup.query(`UPDATE sozlesme_kaydi SET bitis = '2026-02-01' WHERE kimlik = $1`, [s.json().kimlik]);
      expect(await sozlesmeEngeli(o.db, fr)).not.toBeNull();
    } finally { await o.sup.query(`UPDATE sistem_parametresi SET deger = 0 WHERE kod = 'sozlesme_kapisi'`); }
  });
});

describe('boş parametre (YG-826)', () => {
  it('değer tanımlı değilse işlem üst onaya gider', async () => {
    expect(await sonMakam(o.db, 100)).toBe('Ticari İşler Direktörü');
    await o.sup.query(`UPDATE sistem_parametresi SET deger = NULL WHERE kod = 'limit_tid_eur'`);
    try { expect(await sonMakam(o.db, 100)).toBe('Genel Müdür Yardımcısı'); } finally { await o.sup.query(`UPDATE sistem_parametresi SET deger = 5000 WHERE kod = 'limit_tid_eur'`); }
  });
});

describe('sigorta toplu ödemesi (YG-902)', () => {
  it('toplam dağılıma eşit olmalı; yalnız o sigortacının faturası; tek işlemde dağıtılır; mükerrer banka referansı reddedilir; hata hepsini geri alır', async () => {
    const SG = `Toplu SG ${Date.now()}`; const ac = async (s: string) => o.dosyaAc({ sigortaci: s, hasarNo: `H-${Math.random()}` }, { musteriTuru: 'Sigorta Şirketi' });
    const a = await ac(SG); const b = await ac(SG); const x = await ac('Başka SG');
    const ka = await fatura(a, { toplam: 1000, muhatap: 'Sigorta Şirketi' }) as unknown as string; const kb = await fatura(b, { toplam: 500, muhatap: 'Sigorta Şirketi' }) as unknown as string; const kx = await fatura(x, { toplam: 300, muhatap: 'Sigorta Şirketi' }) as unknown as string;
    const ts = await o.gir('ts'); const u = '/api/sigorta-toplu-odeme'; const T = { sigortaci: SG, tarih: '2026-11-09', referans: `R-${Date.now()}`, bildirim: 'DB-1' };
    expect((await o.ist('POST', u, await o.gir('ds'), { ...T, toplam: 1, dagilim: [] })).statusCode).toBe(404);
    expect((await o.ist('POST', u, ts, { ...T, toplam: 1500, dagilim: [{ fatura: ka, tutar: 1000 }] })).json().hata).toContain('eşit');
    expect((await o.ist('POST', u, ts, { ...T, toplam: 1300, dagilim: [{ fatura: ka, tutar: 1000 }, { fatura: kx, tutar: 300 }] })).json().hata).toContain('ait değildir');
    expect((await o.sup.query(`SELECT tahsil_edilen_eur t FROM musteri_faturasi WHERE kimlik = $1`, [ka])).rows[0].t).toBe('0.00');
    expect((await o.ist('POST', u, ts, { ...T, toplam: 1600, dagilim: [{ fatura: ka, tutar: 1100 }, { fatura: kb, tutar: 500 }] })).statusCode).toBe(409);
    expect((await o.sup.query(`SELECT count(*)::int n FROM sigorta_toplu_odeme WHERE banka_referansi = $1`, [T.referans])).rows[0].n).toBe(0);
    const r = await o.ist('POST', u, ts, { ...T, toplam: 1200, dagilim: [{ fatura: ka, tutar: 1000 }, { fatura: kb, tutar: 200 }] }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM musteri_faturasi WHERE kimlik = $1`, [ka])).rows[0].durum).toBe('Tahsil Edildi');
    expect((await o.sup.query(`SELECT durum, tahsil_edilen_eur t FROM musteri_faturasi WHERE kimlik = $1`, [kb])).rows[0]).toEqual({ durum: 'Kısmi Tahsil', t: '200.00' });
    expect((await o.sup.query(`SELECT count(*)::int n, count(DISTINCT dosya_ref)::int d FROM tahsilat WHERE toplu_odeme_ref = $1`, [r.json().kimlik])).rows[0]).toEqual({ n: 2, d: 2 });
    expect((await o.ist('POST', u, ts, { ...T, toplam: 100, dagilim: [{ fatura: kb, tutar: 100 }] })).json().hata).toContain('banka referansı');
    expect((await o.ist('GET', `${u}?sigortaci=${encodeURIComponent(SG)}`, ts)).json().faturalar.map((z: { kimlik: string }) => z.kimlik)).toEqual([kb]);
  });
});
