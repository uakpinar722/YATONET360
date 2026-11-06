import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { konumTemizle, retBaglantisi } from '../src/mobil.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', kk: 'Kalite Uzmanı (Kalite Kontrolör)', mp: 'Müşteri ve Paydaş İlişkileri Müdürü', hud: 'Hukuk ve Uyum Direktörü' };
let o: Ortam;
const dosya = async () => { const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); return d; };
beforeAll(async () => { o = await ortamKur('yatonet360_test47', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('mobil cihaz (YG-498)', () => {
  it('kayıt, devir, oturum kapanışı, kayıp ve veri ihlali', async () => {
    const c = await o.gir('ds'); const r = await o.ist('POST', '/api/mobil/cihaz', c, { platform: 'Android', belirtec: 'BLR-1' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', '/api/mobil/cihaz', c, { platform: 'Windows', belirtec: 'X' })).statusCode).toBe(400);
    const c2 = await o.gir('oy'); await o.ist('POST', '/api/mobil/cihaz', c2, { platform: 'Android', belirtec: 'BLR-1' });
    expect((await o.sup.query(`SELECT kullanici_ref FROM mobil_cihaz WHERE bildirim_belirteci = 'BLR-1'`)).rows[0].kullanici_ref).toBe(o.K.oy);
    await o.ist('POST', '/api/kimlik/cikis', c2, {});
    expect((await o.sup.query(`SELECT durum FROM mobil_cihaz WHERE bildirim_belirteci = 'BLR-1'`)).rows[0].durum).toBe('İptal');
    const k = (await o.ist('POST', '/api/mobil/cihaz', c, { platform: 'iOS', belirtec: 'BLR-2' })).json().kimlik;
    expect((await o.ist('POST', `/api/mobil/cihaz/${k}/kayip`, await o.gir('tu'), {})).statusCode).toBe(404);
    const ky = await o.ist('POST', `/api/mobil/cihaz/${k}/kayip`, c, {}); expect(ky.statusCode, ky.body).toBe(200);
    expect((await o.kart('Veri İhlali Şüphesi', ky.json().olay)).oncelik).toBe('Kritik');
  });
});

describe('çevrimdışı eşitleme (YG-494)', () => {
  const G = (d: string, kim: string) => o.belge(d, kim).then((belge) => ({ kaynak: 'Ara kontrol', yer: 'Y', olcut: `Ö${Math.random()}`, durum: 'Fark', sinif: 'Gözlem', belge }));
  it('uygular, tekrarı yinelemez, çakışmada sunucu esas, izinsiz yol yok', async () => {
    const d = await dosya(); const c = await o.gir('kk'); await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Kalite Kontrolör',$3)`, [d.kimlik, o.K.kk, o.K.opm]);
    const u = `/dosya/${d.kimlik}/uygunsuzluk`; const G1 = await G(d.kimlik, 'ds'); const id = crypto.randomUUID(); const once = (await o.sup.query(`SELECT count(*)::int n FROM uygunsuzluk WHERE dosya_ref = $1`, [d.kimlik])).rows[0].n;
    const r = await o.ist('POST', '/api/mobil/esitle', c, { kayitlar: [{ kimlik: id, yol: u, govde: G1 }] }); expect(r.statusCode, r.body).toBe(200); expect(r.json().sonuc[0].durum, r.body).toBe('Uygulandı');
    const r2 = await o.ist('POST', '/api/mobil/esitle', c, { kayitlar: [{ kimlik: id, yol: u, govde: G1 }] }); expect(r2.json().sonuc[0].durum).toBe('Uygulandı');
    expect((await o.sup.query(`SELECT count(*)::int n FROM uygunsuzluk WHERE dosya_ref = $1`, [d.kimlik])).rows[0].n).toBe(once + 1);
    const c3 = await o.ist('POST', '/api/mobil/esitle', c, { kayitlar: [{ kimlik: crypto.randomUUID(), yol: u, govde: await G(d.kimlik, 'ds'), temelZaman: '2020-01-01T00:00:00Z' }] }); expect(c3.json().sonuc[0].durum).toBe('Çakışma'); expect(c3.json().sonuc[0].hata).toContain('üzerine yazılmadı');
    expect((await o.sup.query(`SELECT count(*)::int n FROM uygunsuzluk WHERE dosya_ref = $1`, [d.kimlik])).rows[0].n).toBe(once + 1);
    const c4 = await o.ist('POST', '/api/mobil/esitle', c, { kayitlar: [{ kimlik: crypto.randomUUID(), yol: u, govde: {} }] }); expect(c4.json().sonuc[0].durum).toBe('Reddedildi');
    expect((await o.ist('POST', '/api/mobil/esitle', c, { kayitlar: [{ kimlik: crypto.randomUUID(), yol: '/hesabim/kapatma-talebi', govde: { onay: true } }] })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/mobil/esitle', await o.gir('tu'), { kayitlar: [{ kimlik: id, yol: u, govde: G1 }] })).statusCode).toBe(404);
  });
});

describe('konum izni (YG-500)', () => {
  it('aydınlatmasız izin yok, izinsiz konum yok, bir yıl sonra silinir', async () => {
    const d = await dosya(); const c = await o.gir('ds'); const P = { dosya: d.kimlik, enlem: 36.8, boylam: 28.2 };
    expect((await o.ist('POST', '/api/mobil/saha-konum', c, P)).json().hata).toContain('izni');
    expect((await o.ist('POST', '/api/mobil/izin', c, { tur: 'Konum' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/mobil/izin', c, { tur: 'Konum', aydinlatmaGosterildi: true })).statusCode).toBe(200);
    await o.sup.query(`INSERT INTO saha_konum_kaydi (kullanici_ref, dosya_ref, enlem, boylam) VALUES ($1,$2,1,1)`, [o.K.ds, d.kimlik]); // mesai kuralı guvenlik.test.ts içinde
    await o.sup.query(`INSERT INTO saha_konum_kaydi (kullanici_ref, dosya_ref, enlem, boylam, zaman) VALUES ($1,$2,1,1, now() - interval '366 days')`, [o.K.ds, d.kimlik]);
    expect(await konumTemizle(o.db)).toBe(1);
    expect((await o.sup.query(`SELECT count(*)::int n FROM saha_konum_kaydi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].n).toBe(1);
    await o.ist('POST', '/api/mobil/izin', c, { tur: 'Konum', ver: false });
    expect((await o.ist('POST', '/api/mobil/saha-konum', c, P)).statusCode).toBe(409);
  });
});

const smsKod = () => o.sms.gidenler.at(-1)!.metin.match(/\d{6}/)![0];
const kayitOl = async (telefon: string, ek: object = {}) => { await o.ist('POST', '/api/kayit/kod', undefined, { telefon }); return o.ist('POST', '/api/kayit/tamamla', undefined, { telefon, kod: smsKod(), ad: 'Kaptan K', ...ek }); };
const cerez = (r: { cookies: { name: string; value: string }[] }) => r.cookies[0]!.value;
const hazirla = async (r: { cookies: { name: string; value: string }[] }) => {
  const c = cerez(r); const kimlik = (await o.ist('GET', '/api/ben', c)).json().kimlik;
  await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1, 'Müşteri', 'KVKK-01', 'R00', 'Türkçe', 'Web')`, [kimlik]);
  await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [kimlik]);
  await o.sup.query(`UPDATE kullanici_hesabi SET izin_adimi_zamani = now() WHERE kimlik = $1`, [kimlik]);
  return c;
};

describe('ret bağlantısı (YG-484), hesap kapatma (YG-492), Yat Yetkilisi (YG-1561, YG-1566)', () => {
  it('imzalı bağlantı izni geri alır, sahte imza reddedilir', async () => {
    await o.sup.query(`INSERT INTO acik_riza (ilgili_kisi_ref, riza_turu, kanal, kaynak, metin_surumu) VALUES ($1,'Ticari elektronik ileti onayı','SMS','Profil','R00')`, [o.K.ds]);
    expect((await o.s.inject({ method: 'GET', url: `/api/iletisim/ret?k=${o.K.ds}&m=SMS&i=sahte` })).statusCode).toBe(400);
    const r = await o.s.inject({ method: 'GET', url: retBaglantisi('', 'ab'.repeat(32), o.K.ds!, 'SMS') }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT durum, gonderim_engeli FROM acik_riza WHERE ilgili_kisi_ref = $1 AND kanal = 'SMS'`, [o.K.ds])).rows[0]).toEqual({ durum: 'Geri Alındı', gonderim_engeli: true });
    expect((await o.s.inject({ method: 'POST', url: '/api/iletisim/iys-ret', headers: { 'x-yatonet': '1' }, payload: { kisi: o.K.ds, kanal: 'SMS' } })).statusCode).toBe(403);
  });
  it('LGM personeli kapatamaz; müşteri kapatır, oturum biter, cihaz iptal olur', async () => {
    expect((await o.ist('POST', '/api/hesabim/kapatma-talebi', await o.gir('ds'), { onay: true })).statusCode).toBe(409);
    const k = await kayitOl('+905551110001'); expect(k.statusCode, k.body).toBe(200); const c = await hazirla(k);
    await o.ist('POST', '/api/mobil/cihaz', c, { platform: 'iOS', belirtec: 'BLR-KAP' });
    expect((await o.ist('POST', '/api/hesabim/kapatma-talebi', c, {})).statusCode).toBe(400);
    const kp = await o.ist('POST', '/api/hesabim/kapatma-talebi', c, { onay: true }); expect(kp.json().durum, kp.body).toBe('Kapatıldı');
    expect((await o.sup.query(`SELECT durum FROM mobil_cihaz WHERE bildirim_belirteci = 'BLR-KAP'`)).rows[0].durum).toBe('İptal');
    expect((await o.ist('GET', '/api/portal/ana', c)).statusCode).toBe(401);
  });
  it('Yat Yetkilisi kaydı: rol ve sahip zorunlu; belge isteğe bağlı; kontrol sonrası yetkiler görünür', async () => {
    expect((await kayitOl('+905551110002', { yetkili: { rol: 'Yatın Kaptanı' } })).statusCode).toBe(400);
    const k = await kayitOl('+905551110003', { yetkili: { rol: 'Yatın Kaptanı', sahipAd: 'Sahip S', sahipTelefon: '+905551110099' } }); expect(k.statusCode, k.body).toBe(200); const c = await hazirla(k);
    const a = (await o.ist('GET', '/api/portal/ana', c)).json(); expect(a.yetkili).toMatchObject({ rol: 'Yatın Kaptanı', sahip_ad: 'Sahip S', belge_durumu: 'Bekleniyor' });
    expect((await o.sup.query(`SELECT sahip_bilgilendirme_zamani FROM yat_yetkilisi_kaydi WHERE sahip_ad = 'Sahip S'`)).rows[0].sahip_bilgilendirme_zamani).not.toBeNull();
    const giden = o.sms.gidenler.at(-1)!; expect(giden.telefon).toBe('+905551110099'); expect(giden.metin).toContain('Kaptan K, Yatın Kaptanı sıfatıyla'); expect(giden.metin).toContain('LGM sizden kod istemez');
    expect((await kayitOl('+905551110004', { yetkili: { rol: 'Yatın Kaptanı', sahipAd: 'Owner O', sahipTelefon: '+447700900123' } })).statusCode).toBe(200);
    const yab = o.sms.gidenler.at(-1)!; expect(yab.telefon).toBe('+447700900123'); expect(yab.metin).toContain('Kaptan K has opened a YATONET 360 account to act on your behalf as Captain of the Yacht');
    expect((await o.ist('POST', '/api/yetkilerim/belge', c, { belge: crypto.randomUUID() })).statusCode).toBe(400);
    const kid = (await o.sup.query(`SELECT kullanici_ref FROM yat_yetkilisi_kaydi WHERE sahip_ad = 'Sahip S'`)).rows[0].kullanici_ref;
    const be = (await o.sup.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ('Vekâletname','Yetki','Gizli','Yat Yetkilisi',$1,'Sistem',current_date,$1) RETURNING kimlik`, [kid])).rows[0].kimlik;
    expect((await o.ist('POST', '/api/yetkilerim/belge', c, { belge: be })).json().durum).toBe('Kontrolde');
    expect((await o.ist('POST', `/api/yat-yetkilisi/${kid}/dogrula`, await o.gir('ds'), { islemler: ['ONY-23'], bitis: '2099-01-01' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/yat-yetkilisi/${kid}/dogrula`, await o.gir('mp'), { islemler: ['ONY-23'], limit: 5000, bitis: '2099-01-01' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/yetkilerim', c)).json()).toMatchObject({ belge_durumu: 'Geçerli', ust_limit_eur: '5000.00' });
    // YG-1031: sigorta brokeri de aynı denetimle kaydolur; belgesi doğrulanmadan onay listesi boştur.
    const br = await kayitOl('+905551110005', { yetkili: { rol: 'Sigorta Brokeri', sahipAd: 'Sahip B', sahipTelefon: '+905551110098' } }); expect(br.statusCode, br.body).toBe(200);
    expect(o.sms.gidenler.at(-1)!.metin).toContain('Sigorta Brokeri sıfatıyla');
    const { yetkiliOnaylari } = await import('../src/yetki_ek.js'); const bid = (await o.sup.query(`SELECT kullanici_ref FROM yat_yetkilisi_kaydi WHERE sahip_ad = 'Sahip B'`)).rows[0].kullanici_ref;
    expect(await yetkiliOnaylari(o.db, bid)).toEqual([]);
  });
});
