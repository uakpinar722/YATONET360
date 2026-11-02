import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { randomInt } from 'node:crypto';
import QRCode from 'qrcode';
import { eksikAdimlar } from './adimlar.js';
import { COOKIE_ADI, KURAL } from './ayarlar.js';
import { izYaz } from './denetim.js';
import { coz, ozet, rastgeleBelirtec, sifrele, totpDogrula, totpGizliUret } from './kripto.js';
import { parolaDogrula, parolaKuraliHatasi, parolaOzetle, sahteDogrula } from './parola.js';
import type { EpostaGonderici, SmsGonderici } from './sms.js';

export interface Baglam { db: Pool; sms: SmsGonderici; eposta: EpostaGonderici; anahtar: string; guvenliCerez: boolean; webAdresi: string }

const UYGULAMA = 'Doğrulama uygulaması (6 haneli kod)';
const HATALI = 'E-posta/telefon veya parola hatalı. 5 hatalı denemede hesap 15 dakika bekletilir.';
const KOD_HATALI = 'Doğrulama kodu hatalı veya süresi dolmuş.';

export interface OturumBilgi {
  oturum: string; kullanici: string; asama: string; ayricalikli: boolean; adSoyad: string | null; grup: string; adres: string;
}

declare module 'fastify' { interface FastifyRequest { oturum?: OturumBilgi } }

/** YG-1155: 5 hatada 15 dakika; her ek 5 hatada iki katı, en çok 24 saat. */
export function beklemeDakikasi(hataSayisi: number): number | null {
  if (hataSayisi === 0 || hataSayisi % KURAL.beklemeDenemeSayisi !== 0) return null;
  const kat = hataSayisi / KURAL.beklemeDenemeSayisi - 1;
  return Math.min(KURAL.ilkBeklemeDk * 2 ** kat, KURAL.azamiBeklemeDk);
}

/** Bireysel müşteri her zaman SMS kullanır. Kurumsal kullanıcı uygulamayı kullanamazsa SMS isteyebilir. LGM personeli ve ayrıcalıklı hesap isteyemez (YG-1006, YG-1150). */
export function smsAcikMi(h: { kullanici_grubu: string; ayricalikli_mi: boolean }) {
  return !h.ayricalikli_mi && h.kullanici_grubu !== 'LGM İç Rolü' && h.kullanici_grubu !== 'Sistem/Hizmet Hesabı';
}

export function kimlikNormalle(k: string): { eposta?: string; telefon?: string } {
  const s = (k ?? '').trim();
  if (s.includes('@')) return { eposta: s.toLocaleLowerCase('en-US') };
  const r = s.replace(/[\s()-]/g, '');
  if (/^0\d{10}$/.test(r)) return { telefon: '+90' + r.slice(1) };
  if (/^\+\d{8,15}$/.test(r)) return { telefon: r };
  return {};
}

function cerezYaz(y: FastifyReply, b: Baglam, belirtec: string) {
  y.setCookie(COOKIE_ADI, belirtec, { path: '/', httpOnly: true, sameSite: 'strict', secure: b.guvenliCerez });
}

async function oturumKapat(b: Baglam, oturum: string, neden: string) {
  await b.db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = $2 WHERE kimlik = $1 AND bitis_zamani IS NULL`, [oturum, neden]);
}

/** Oturumu okur, hareketsizlik ve azami süreyi her istekte sunucuda uygular (YG-1113, YG-1153). */
async function oturumCoz(b: Baglam, i: FastifyRequest): Promise<OturumBilgi | null> {
  const belirtec = i.cookies[COOKIE_ADI];
  if (!belirtec) return null;
  const { rows } = await b.db.query(
    `SELECT o.kimlik, o.kullanici_ref, o.asama, o.son_islem_zamani, o.azami_bitis_zamani, k.ayricalikli_mi, k.ad_soyad, k.kullanici_grubu, k.hesap_durumu, k.erisim_bitis
       FROM oturum o JOIN kullanici_hesabi k ON k.kimlik = o.kullanici_ref
      WHERE o.belirtec_ozeti = $1 AND o.bitis_zamani IS NULL`, [ozet(belirtec)]);
  const o = rows[0];
  if (!o) return null;
  const simdi = Date.now();
  const hareketsiz = (o.ayricalikli_mi ? KURAL.ayricalikliHareketsizlikDk : KURAL.hareketsizlikDk) * 60_000;
  let neden: string | null = null;
  if (simdi > new Date(o.azami_bitis_zamani).getTime()) neden = 'Azami süre';
  else if (simdi - new Date(o.son_islem_zamani).getTime() > hareketsiz) neden = 'Hareketsizlik';
  else if (o.hesap_durumu !== 'Aktif') neden = 'Güvenlik sınırlaması';
  if (neden) {
    await oturumKapat(b, o.kimlik, neden);
    await izYaz(b.db, { aktor: o.kullanici_ref, oturum: o.kimlik, eylem: 'Oturum Kapandı', sonuc: 'Başarılı', gerekce: neden, adres: i.ip, iliski: i.id });
    return null;
  }
  await b.db.query(`UPDATE oturum SET son_islem_zamani = now() WHERE kimlik = $1`, [o.kimlik]);
  return { oturum: o.kimlik, kullanici: o.kullanici_ref, asama: o.asama, ayricalikli: o.ayricalikli_mi, adSoyad: o.ad_soyad, grup: o.kullanici_grubu, adres: i.ip };
}

/** adimSerbest: ilk giriş adımları tamamlanmadan da açık olan yollar. Diğer yollar koşullar ve aydınlatma bitmeden çalışmaz (YG-1205, YG-1217). */
export function tamOturumGerekli(b: Baglam, adimSerbest = false) {
  return async (i: FastifyRequest, y: FastifyReply) => {
    const o = await oturumCoz(b, i);
    if (!o || o.asama !== 'Tamam') return y.code(401).send({ hata: 'Oturumunuz sona ermiştir; yeniden giriş yapınız.' });
    i.oturum = o;
    if (!adimSerbest) {
      const eksik = await eksikAdimlar(b.db, o.kullanici);
      if (eksik.length) return y.code(428).send({ hata: 'Devam etmeden önce ilk giriş adımlarını tamamlayınız.', eksik });
    }
  };
}

/** Hatalı deneme sayısını artırır; eşikte bekletir. Parola ve kod hataları aynı sayaçtadır (YG-1155). */
async function hataIsle(b: Baglam, kullanici: string, eylem: string, i: FastifyRequest) {
  const { rows } = await b.db.query(`UPDATE kullanici_hesabi SET basarisiz_giris_sayisi = basarisiz_giris_sayisi + 1 WHERE kimlik = $1 RETURNING basarisiz_giris_sayisi`, [kullanici]);
  const dk = beklemeDakikasi(rows[0].basarisiz_giris_sayisi);
  if (dk) await b.db.query(`UPDATE kullanici_hesabi SET kilit_bitis_zamani = now() + make_interval(mins => $2) WHERE kimlik = $1`, [kullanici, dk]);
  await izYaz(b.db, { aktor: kullanici, eylem, sonuc: 'Başarısız', adres: i.ip, iliski: i.id, gerekce: dk ? `${dk} dakika bekletildi` : undefined });
}

function kalanMetni(bitis: Date) {
  const dk = Math.ceil((bitis.getTime() - Date.now()) / 60_000);
  const saat = bitis.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
  return `Hesabınız ${dk} dakika bekletilmektedir; saat ${saat} sonrasında yeniden deneyiniz.`;
}

export function kimlikYollari(s: FastifyInstance, b: Baglam) {
  s.post('/kimlik/giris', async (i, y) => {
    const { kimlik, parola } = (i.body ?? {}) as { kimlik?: string; parola?: string };
    if (!kimlik || !parola) return y.code(400).send({ hata: 'Lütfen iki alanı da doldurunuz.' });
    // YG-1157: aynı adresten hızlı deneme. Tek hesabı kilitlemeden yayılan denemeleri de keser.
    const hiz = await b.db.query(
      `SELECT count(*)::int n FROM denetim_izi WHERE kaynak_adres = $1 AND sonuc = 'Başarısız' AND eylem IN ('Giriş Denemesi', 'Doğrulama Kodu Denemesi') AND olay_zamani > now() - make_interval(mins => $2)`, [i.ip, KURAL.adresDenemePenceresiDk]);
    if (hiz.rows[0].n >= KURAL.adresDenemeSiniri) {
      await izYaz(b.db, { eylem: 'Adres Bazlı Deneme Sınırı', sonuc: 'Başarısız', adres: i.ip, iliski: i.id });
      return y.code(429).send({ hata: 'Çok fazla deneme yapıldı; birkaç dakika sonra yeniden deneyiniz.' });
    }
    const n = kimlikNormalle(kimlik);
    const { rows } = n.eposta || n.telefon
      ? await b.db.query(`SELECT * FROM kullanici_hesabi WHERE ${n.eposta ? 'lower(e_posta) = $1' : 'cep_telefonu = $1'}`, [n.eposta ?? n.telefon])
      : { rows: [] as any[] };
    const h = rows[0];
    if (!h || !h.parola_ozeti) {
      await sahteDogrula(parola);
      await izYaz(b.db, { eylem: 'Giriş Denemesi', sonuc: 'Başarısız', gerekce: 'Bilinmeyen hesap', adres: i.ip, iliski: i.id });
      return y.code(401).send({ hata: HATALI });
    }
    if (h.kilit_bitis_zamani && new Date(h.kilit_bitis_zamani) > new Date()) {
      await sahteDogrula(parola);
      return y.code(423).send({ hata: kalanMetni(new Date(h.kilit_bitis_zamani)) });
    }
    if (!(await parolaDogrula(h.parola_ozeti, parola))) {
      await hataIsle(b, h.kimlik, 'Giriş Denemesi', i);
      return y.code(401).send({ hata: HATALI });
    }
    // Hesap durumu yalnız doğru paroladan sonra söylenir; başkası hesabın durumunu öğrenemez.
    const bugun = new Date().toISOString().slice(0, 10);
    const bitti = h.erisim_bitis && String(h.erisim_bitis instanceof Date ? h.erisim_bitis.toISOString().slice(0, 10) : h.erisim_bitis) < bugun;
    if (h.hesap_durumu !== 'Aktif' || bitti) {
      await izYaz(b.db, { aktor: h.kimlik, eylem: 'Giriş Denemesi', sonuc: 'Başarısız', gerekce: `Hesap ${h.hesap_durumu}`, adres: i.ip, iliski: i.id });
      return y.code(403).send({ hata: h.hesap_durumu === 'Askıda' ? 'Hesabınız askıya alınmıştır; açılması için destek hattına başvurunuz.' : 'Hesabınız kapalıdır; destek hattına başvurunuz.' });
    }
    const belirtec = rastgeleBelirtec();
    await b.db.query(
      `INSERT INTO oturum (kullanici_ref, belirtec_ozeti, asama, azami_bitis_zamani, kaynak_adres)
       VALUES ($1, $2, 'Kod Bekliyor', now() + make_interval(mins => $3), $4)`, [h.kimlik, ozet(belirtec), KURAL.kodAsamasiDk, i.ip.slice(0, 100)]);
    cerezYaz(y, b, belirtec);
    return {
      asama: 'kod',
      yontem: h.dogrulama_yontemi === UYGULAMA ? 'uygulama' : 'sms',
      kurulumGerekli: h.dogrulama_yontemi === UYGULAMA && !h.totp_gizli_sifreli,
      smsAcik: smsAcikMi(h),
    };
  });

  async function kodAsamasi(i: FastifyRequest, y: FastifyReply) {
    const o = await oturumCoz(b, i);
    if (!o || o.asama !== 'Kod Bekliyor') { y.code(401).send({ hata: 'Giriş süresi doldu; yeniden giriş yapınız.' }); return null; }
    const { rows } = await b.db.query(`SELECT * FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici]);
    return { o, h: rows[0] };
  }

  // Doğrulama uygulaması ilk kurulumu. Kurulu hesapta çalışmaz: faktör değişimi hesap kurtarma sürecindedir (YG-1156).
  s.get('/kimlik/kurulum', async (i, y) => {
    const a = await kodAsamasi(i, y); if (!a) return;
    if (a.h.dogrulama_yontemi !== UYGULAMA || (a.h.totp_gizli_sifreli && a.h.totp_son_adim > 0)) return y.code(409).send({ hata: 'Doğrulama uygulaması zaten kuruludur.' });
    const gizli = a.h.totp_gizli_sifreli ? coz(a.h.totp_gizli_sifreli, b.anahtar) : totpGizliUret();
    if (!a.h.totp_gizli_sifreli) await b.db.query(`UPDATE kullanici_hesabi SET totp_gizli_sifreli = $2 WHERE kimlik = $1`, [a.h.kimlik, sifrele(gizli, b.anahtar)]);
    const adres = `otpauth://totp/YATONET%20360:${encodeURIComponent(a.h.kullanici_adi)}?secret=${gizli}&issuer=YATONET%20360&digits=6&period=30`;
    return { qr: await QRCode.toDataURL(adres, { margin: 1, width: 220 }), gizli };
  });

  s.post('/kimlik/sms', async (i, y) => {
    const a = await kodAsamasi(i, y); if (!a) return;
    if (!smsAcikMi(a.h) || !a.h.cep_telefonu) return y.code(403).send({ hata: 'Bu hesap için SMS kodu kullanılamaz; doğrulama uygulamanızdaki kodu giriniz.' });
    const son = await b.db.query(`SELECT 1 FROM sms_kodu WHERE oturum_ref = $1 AND gonderim_zamani > now() - make_interval(secs => $2)`, [a.o.oturum, KURAL.smsYenidenGonderimSn]);
    if (son.rowCount) return y.code(429).send({ hata: 'Yeni kod için bir dakika bekleyiniz.' });
    const kod = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await b.db.query(`INSERT INTO sms_kodu (oturum_ref, kod_ozeti, son_gecerlilik) VALUES ($1, $2, now() + make_interval(mins => $3))`, [a.o.oturum, ozet(a.o.oturum + kod), KURAL.smsKodGecerlilikDk]);
    await b.sms.gonder(a.h.cep_telefonu, `YATONET 360 doğrulama kodunuz: ${kod}. LGM kod sormaz; kodu kimseyle paylaşmayınız.`);
    await izYaz(b.db, { aktor: a.h.kimlik, oturum: a.o.oturum, eylem: 'SMS Kodu Gönderildi', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { gonderildi: true };
  });

  s.post('/kimlik/dogrula', async (i, y) => {
    const a = await kodAsamasi(i, y); if (!a) return;
    const kod = String(((i.body ?? {}) as { kod?: string }).kod ?? '');
    if (a.h.kilit_bitis_zamani && new Date(a.h.kilit_bitis_zamani) > new Date()) return y.code(423).send({ hata: kalanMetni(new Date(a.h.kilit_bitis_zamani)) });
    let gecerli = false;
    if (/^\d{6}$/.test(kod)) {
      const sms = await b.db.query(
        `UPDATE sms_kodu SET kullanildi = true WHERE oturum_ref = $1 AND kod_ozeti = $2 AND kullanildi = false AND son_gecerlilik > now() RETURNING kimlik`, [a.o.oturum, ozet(a.o.oturum + kod)]);
      gecerli = Boolean(sms.rowCount);
      if (!gecerli && a.h.totp_gizli_sifreli) {
        const adim = totpDogrula(coz(a.h.totp_gizli_sifreli, b.anahtar), kod, Number(a.h.totp_son_adim));
        if (adim) { await b.db.query(`UPDATE kullanici_hesabi SET totp_son_adim = $2 WHERE kimlik = $1`, [a.h.kimlik, adim]); gecerli = true; }
      }
    }
    if (!gecerli) {
      await hataIsle(b, a.h.kimlik, 'Doğrulama Kodu Denemesi', i);
      return y.code(401).send({ hata: KOD_HATALI });
    }
    // YG-1154: oturum belirteci yetki değişiminde yenilenir.
    const belirtec = rastgeleBelirtec();
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE oturum SET belirtec_ozeti = $2, asama = 'Tamam', azami_bitis_zamani = now() + make_interval(hours => $3), son_islem_zamani = now(), yeniden_dogrulama_zamani = now() WHERE kimlik = $1`, [a.o.oturum, ozet(belirtec), KURAL.azamiOturumSaat]);
      await c.query(`UPDATE kullanici_hesabi SET basarisiz_giris_sayisi = 0, kilit_bitis_zamani = NULL, son_giris_zamani = now() WHERE kimlik = $1`, [a.h.kimlik]);
      await izYaz(c, { aktor: a.h.kimlik, oturum: a.o.oturum, eylem: 'Giriş', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    cerezYaz(y, b, belirtec);
    return { asama: 'tamam' };
  });

  s.post('/kimlik/cikis', { preHandler: tamOturumGerekli(b, true) }, async (i, y) => {
    await oturumKapat(b, i.oturum!.oturum, 'Çıkış');
    await izYaz(b.db, { aktor: i.oturum!.kullanici, oturum: i.oturum!.oturum, eylem: 'Çıkış', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    y.clearCookie(COOKIE_ADI, { path: '/' });
    return { tamam: true };
  });

  s.post('/kimlik/parola', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const { eski, yeni } = (i.body ?? {}) as { eski?: string; yeni?: string };
    const o = i.oturum!;
    const { rows } = await b.db.query(`SELECT parola_ozeti FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici]);
    if (!eski || !(await parolaDogrula(rows[0].parola_ozeti, eski))) {
      await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Parola Değişikliği', sonuc: 'Başarısız', adres: i.ip, iliski: i.id });
      return y.code(400).send({ hata: 'Mevcut parola hatalıdır.' });
    }
    const kural = parolaKuraliHatasi(yeni ?? '');
    if (kural) return y.code(400).send({ hata: kural });
    await b.db.query(`UPDATE kullanici_hesabi SET parola_ozeti = $2, guncelleme_zamani = now(), surum = surum + 1 WHERE kimlik = $1`, [o.kullanici, await parolaOzetle(yeni!)]);
    await b.db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND kimlik <> $2 AND bitis_zamani IS NULL`, [o.kullanici, o.oturum]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Parola Değişikliği', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
