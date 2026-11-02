import type { FastifyInstance } from 'fastify';
import { COOKIE_ADI, KURAL } from './ayarlar.js';
import { aydinlatmaKodu, dilKodu, disKullanici, eksikAdimlar, izinAdimiVar, rizaBicimi, sonSurum } from './adimlar.js';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { ozet, rastgeleBelirtec } from './kripto.js';
import { parolaKuraliHatasi, parolaOzetle } from './parola.js';

const DAVET_GUN = 7; // G2-1
const AMACLAR = ['Bakım ve sezon hatırlatmaları', 'Hizmet ve kampanya tanıtımları'];
const KANALLAR = ['SMS', 'E-posta', 'Telefon', 'WhatsApp'];
const OZEL_GUN = ['Özel gün – Doğum günü paylaşımı', 'Özel gün – Evlilik yıl dönümü paylaşımı', 'Özel gün – İşe giriş yıl dönümü paylaşımı'];

const GECERSIZ = 'Bu davet bağlantısı geçersiz veya süresi dolmuştur; davet gönderen birimden yenilemesini isteyiniz.';

export interface DavetGirdisi { adSoyad: string; eposta: string; telefon?: string; grup: string; rol: string; yontem?: string; olusturan?: string }

/** Hesap ve 7 gün geçerli davet açar. Belirtecin yalnız özeti saklanır; bağlantı bir kez üretilir. */
export async function davetOlustur(db: { query: Baglam['db']['query'] }, d: DavetGirdisi) {
  const belirtec = rastgeleBelirtec();
  const yontem = d.yontem ?? 'Doğrulama uygulaması (6 haneli kod)';
  const { rows } = await db.query(
    `INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, dogrulama_yontemi)
     VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING kimlik`,
    [d.grup === 'LGM İç Rolü' ? 'İç Kullanıcı' : 'Müşteri/Kurum', d.grup, d.adSoyad, d.eposta, d.telefon ?? null, yontem]);
  const kimlik = rows[0].kimlik as string;
  const r = await db.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [kimlik, d.rol]);
  if (!r.rowCount) throw new Error(`Rol bulunamadı: ${d.rol}`);
  await db.query(`INSERT INTO davet (kullanici_ref, belirtec_ozeti, son_gecerlilik, olusturan) VALUES ($1,$2, now() + make_interval(days => $3), $4)`, [kimlik, ozet(belirtec), DAVET_GUN, d.olusturan ?? null]);
  return { kimlik, belirtec };
}

export function ilkGirisYollari(s: FastifyInstance, b: Baglam) {
  const serbest = { preHandler: tamOturumGerekli(b, true) };

  async function davetBul(belirtec: unknown) {
    if (typeof belirtec !== 'string' || !belirtec) return null;
    const { rows } = await b.db.query(
      `SELECT d.kimlik AS davet, k.kimlik, k.ad_soyad, k.kullanici_grubu, k.hesap_durumu FROM davet d JOIN kullanici_hesabi k ON k.kimlik = d.kullanici_ref
        WHERE d.belirtec_ozeti = $1 AND d.kullanilma_zamani IS NULL AND d.son_gecerlilik > now()`, [ozet(belirtec)]);
    return rows[0]?.hesap_durumu === 'Aktif' ? rows[0] : null;
  }

  s.post('/ilk-giris/davet', async (i, y) => {
    const d = await davetBul((i.body as { belirtec?: string } | null)?.belirtec);
    if (!d) return y.code(410).send({ hata: GECERSIZ });
    return { adSoyad: d.ad_soyad, lgm: d.kullanici_grubu === 'LGM İç Rolü', gun: DAVET_GUN };
  });

  // G2-1, G2-2: dil ve parola. Bağlantı burada tüketilir, ardından doğrulama uygulaması kurulumuna geçilir.
  s.post('/ilk-giris/parola', async (i, y) => {
    const { belirtec, parola, dil } = (i.body ?? {}) as { belirtec?: string; parola?: string; dil?: string };
    const d = await davetBul(belirtec);
    if (!d) return y.code(410).send({ hata: GECERSIZ });
    const kural = parolaKuraliHatasi(parola ?? '');
    if (kural) return y.code(400).send({ hata: kural });
    const yeni = rastgeleBelirtec();
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = await c.query(`UPDATE davet SET kullanilma_zamani = now() WHERE kimlik = $1 AND kullanilma_zamani IS NULL`, [d.davet]);
      if (!t.rowCount) throw Object.assign(new Error('davet kullanıldı'), { statusCode: 410 });
      await c.query(`UPDATE kullanici_hesabi SET parola_ozeti = $2, tercih_dili = $3, guncelleme_zamani = now(), surum = surum + 1 WHERE kimlik = $1`, [d.kimlik, await parolaOzetle(parola!), dil === 'en' ? 'İngilizce' : 'Türkçe']);
      await c.query(`INSERT INTO oturum (kullanici_ref, belirtec_ozeti, asama, azami_bitis_zamani, kaynak_adres) VALUES ($1,$2,'Kod Bekliyor', now() + make_interval(mins => $3), $4)`, [d.kimlik, ozet(yeni), KURAL.kodAsamasiDk, i.ip.slice(0, 100)]);
      await izYaz(c, { aktor: d.kimlik, eylem: 'Davetle Parola Belirlendi', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    y.setCookie(COOKIE_ADI, yeni, { path: '/', httpOnly: true, sameSite: 'strict', secure: b.guvenliCerez });
    return { asama: 'kod', dis: disKullanici(d.kullanici_grubu) };
  });

  // Tam metin aynı ekranda açılır (KVKK-10). Kullanıcının kendi grubuna ait olmayan metin verilmez.
  s.get('/ilk-giris/metin/:tur', serbest, async (i, y) => {
    const { tur } = i.params as { tur: string };
    const h = await grubuAl(i.oturum!.kullanici);
    const kod = tur === 'kosullar' ? 'PRT-01' : tur === 'aydinlatma' ? aydinlatmaKodu(h.kullanici_grubu) : null;
    if (!kod) return y.code(404).send({ hata: 'Metin bulunamadı.' });
    const surum = await sonSurum(b.db, kod); const dil = dilKodu(h.tercih_dili);
    const { rows } = await b.db.query(`SELECT kod, dil, surum, govde FROM hukuki_metin WHERE kod = $1 AND surum = $2 ORDER BY (dil = $3) DESC LIMIT 1`, [kod, surum, dil]);
    return rows[0];
  });

  async function grubuAl(kullanici: string) {
    const { rows } = await b.db.query(`SELECT kullanici_grubu, tercih_dili FROM kullanici_hesabi WHERE kimlik = $1`, [kullanici]);
    return rows[0];
  }

  s.post('/ilk-giris/kosullar', serbest, async (i, y) => {
    const o = i.oturum!; const h = await grubuAl(o.kullanici);
    if (!disKullanici(h.kullanici_grubu)) return y.code(409).send({ hata: 'Bu adım hesabınız için gerekli değildir.' });
    const surum = await sonSurum(b.db, 'PRT-01');
    await b.db.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,$2,$3)`, [o.kullanici, surum, h.tercih_dili]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kullanım Koşulları Kabul Edildi', nesneKimligi: `PRT-01 ${surum}`, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { eksik: await eksikAdimlar(b.db, o.kullanici) };
  });

  s.post('/ilk-giris/aydinlatma', serbest, async (i) => {
    const o = i.oturum!; const h = await grubuAl(o.kullanici);
    const kod = aydinlatmaKodu(h.kullanici_grubu); const surum = await sonSurum(b.db, kod);
    const grup = h.kullanici_grubu === 'LGM İç Rolü' ? 'Çalışan' : h.kullanici_grubu.startsWith('Bireysel') ? 'Müşteri' : 'İş ortağı (İş Birliği Firması, sigorta brokeri, sigorta acentesi)';
    await b.db.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,$2,$3,$4,$5,'Web')`, [o.kullanici, grup, kod, surum, h.tercih_dili]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Aydınlatma Bilgilendim', nesneKimligi: `${kod} ${surum}`, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { eksik: await eksikAdimlar(b.db, o.kullanici) };
  });

  /** Rıza isteğe bağlıdır; boş seçim de geçerlidir ve hizmeti etkilemez (YG-1207, KVKK-10). */
  s.post('/ilk-giris/izinler', serbest, async (i, y) => {
    const o = i.oturum!; const h = await grubuAl(o.kullanici);
    if (!izinAdimiVar(h.kullanici_grubu)) return y.code(409).send({ hata: 'Kurumsal kullanıcıdan açık rıza istenmez.' });
    const g = (i.body ?? {}) as { amaclar?: string[]; kanallar?: string[]; ozelGunler?: string[] };
    const kayitlar: [string, string | null, string | null][] = [];
    if (rizaBicimi(h.kullanici_grubu) === 'pazarlama') {
      const amaclar = (g.amaclar ?? []).filter((a) => AMACLAR.includes(a));
      const kanallar = (g.kanallar ?? []).filter((k) => KANALLAR.includes(k));
      for (const a of amaclar) kayitlar.push(['Pazarlama açık rızası', a, null]);
      if (amaclar.length) for (const k of kanallar) kayitlar.push(['Ticari elektronik ileti onayı', null, k]);
    } else {
      for (const t of (g.ozelGunler ?? []).filter((x) => OZEL_GUN.includes(x))) kayitlar.push([t, null, null]);
    }
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      for (const [tur, amac, kanal] of kayitlar) await c.query(`INSERT INTO acik_riza (ilgili_kisi_ref, riza_turu, amac, kanal, kaynak, metin_surumu) VALUES ($1,$2,$3,$4,'İlk Giriş Ekranı','R00')`, [o.kullanici, tur, amac, kanal]);
      await c.query(`UPDATE kullanici_hesabi SET izin_adimi_zamani = now() WHERE kimlik = $1`, [o.kullanici]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İsteğe Bağlı İzinler', yeni: { adet: kayitlar.length }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    return { eksik: await eksikAdimlar(b.db, o.kullanici) };
  });
}
