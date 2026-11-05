import type { FastifyInstance } from 'fastify';
import { KURAL } from './ayarlar.js';
import { rizaBicimi } from './adimlar.js';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { kimlikNormalle } from './kimlik.js';
import { ozet, rastgeleBelirtec } from './kripto.js';
import { metinGetir } from './metin.js';
import { randomInt } from 'node:crypto';
import { parolaDogrula, parolaKuraliHatasi, parolaOzetle } from './parola.js';

const AMACLAR = ['Bakım ve sezon hatırlatmaları', 'Hizmet ve kampanya tanıtımları'];
const KANALLAR = ['SMS', 'E-posta', 'Telefon', 'WhatsApp'];
const OZEL_GUN = ['Özel gün – Doğum günü paylaşımı', 'Özel gün – Evlilik yıl dönümü paylaşımı', 'Özel gün – İşe giriş yıl dönümü paylaşımı'];
const GENEL = 'Kayıtlı bir hesap varsa parola yenileme bağlantısı gönderilmiştir.';

/** Listede olan seçenek anahtarı: "tür|amaç|kanal". Liste sunucudadır; istemci başka rıza türü üretemez. */
function secenekler(grup: string): { tur: string; amac: string | null; kanal: string | null }[] {
  if (rizaBicimi(grup) === 'ozel_gun') return OZEL_GUN.map((tur) => ({ tur, amac: null, kanal: null }));
  return [
    ...AMACLAR.map((amac) => ({ tur: 'Pazarlama açık rızası', amac, kanal: null })),
    ...KANALLAR.map((kanal) => ({ tur: 'Ticari elektronik ileti onayı', amac: null, kanal })),
  ];
}

export function hesabimYollari(s: FastifyInstance, b: Baglam) {
  // YG-1156. Yanıt her durumda aynıdır; hesabın varlığı anlaşılmaz.
  s.post('/kimlik/parola-talep', async (i) => {
    const n = kimlikNormalle(String(((i.body ?? {}) as { kimlik?: string }).kimlik ?? ''));
    const { rows } = n.eposta || n.telefon
      ? await b.db.query(`SELECT kimlik, e_posta, cep_telefonu, hesap_durumu FROM kullanici_hesabi WHERE ${n.eposta ? 'lower(e_posta) = $1' : 'cep_telefonu = $1'}`, [n.eposta ?? n.telefon])
      : { rows: [] as any[] };
    const h = rows[0];
    if (!h || h.hesap_durumu !== 'Aktif') return { mesaj: GENEL };
    const son = await b.db.query(`SELECT 1 FROM parola_sifirlama WHERE kullanici_ref = $1 AND olusturma_zamani > now() - make_interval(secs => $2)`, [h.kimlik, KURAL.smsYenidenGonderimSn]);
    if (son.rowCount) return { mesaj: GENEL };
    const belirtec = rastgeleBelirtec();
    await b.db.query(`INSERT INTO parola_sifirlama (kullanici_ref, belirtec_ozeti, son_gecerlilik) VALUES ($1,$2, now() + make_interval(mins => $3))`, [h.kimlik, ozet(belirtec), KURAL.parolaSifirlamaDk]);
    const baglanti = `${b.webAdresi}/#parola=${belirtec}`;
    const metin = `YATONET 360 parola yenileme bağlantınız (${KURAL.parolaSifirlamaDk} dakika geçerlidir): ${baglanti} Bu talebi siz yapmadıysanız dikkate almayınız. LGM parolanızı sormaz.`;
    if (h.e_posta) await b.eposta.gonder(h.e_posta, metin); else await b.sms.gonder(h.cep_telefonu, metin);
    await izYaz(b.db, { aktor: h.kimlik, eylem: 'Parola Yenileme Talebi', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { mesaj: GENEL };
  });

  // İkinci faktör değişmez; yeni parolayla girişte doğrulama kodu yine istenir.
  s.post('/kimlik/parola-yenile', async (i, y) => {
    const { belirtec, parola } = (i.body ?? {}) as { belirtec?: string; parola?: string };
    const kural = parolaKuraliHatasi(parola ?? '');
    if (kural) return y.code(400).send({ hata: kural });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = await c.query(
        `UPDATE parola_sifirlama SET kullanilma_zamani = now() WHERE belirtec_ozeti = $1 AND kullanilma_zamani IS NULL AND son_gecerlilik > now() RETURNING kullanici_ref`, [ozet(String(belirtec ?? ''))]);
      if (!t.rowCount) { await c.query('ROLLBACK'); return y.code(410).send({ hata: 'Bu bağlantı geçersiz veya süresi dolmuştur; yeniden talep ediniz.' }); }
      const k = t.rows[0].kullanici_ref as string;
      const h = await c.query(
        `UPDATE kullanici_hesabi SET parola_ozeti = $2, basarisiz_giris_sayisi = 0, kilit_bitis_zamani = NULL, guncelleme_zamani = now(), surum = surum + 1 WHERE kimlik = $1 RETURNING e_posta, cep_telefonu`, [k, await parolaOzetle(parola!)]);
      await c.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [k]);
      await izYaz(c, { aktor: k, eylem: 'Parola Yenilendi', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      const bildirim = 'YATONET 360 parolanız değiştirilmiştir. Bu işlemi siz yapmadıysanız destek hattına başvurunuz.';
      if (h.rows[0].e_posta) await b.eposta.gonder(h.rows[0].e_posta, bildirim); else await b.sms.gonder(h.rows[0].cep_telefonu, bildirim);
      return { tamam: true };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  const oturumlu = { preHandler: tamOturumGerekli(b) };

  s.get('/profil', oturumlu, async (i) => {
    const o = i.oturum!;
    const { rows } = await b.db.query(`SELECT ad_soyad, e_posta, cep_telefonu, tercih_dili, bildirim_kanali FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici]);
    const r = await b.db.query(`SELECT riza_turu, amac, kanal FROM acik_riza WHERE ilgili_kisi_ref = $1 AND durum = 'Verildi'`, [o.kullanici]);
    const izinVar = o.grup === 'LGM İç Rolü' || o.grup.startsWith('Bireysel');
    return {
      adSoyad: rows[0].ad_soyad, ePosta: rows[0].e_posta, telefon: rows[0].cep_telefonu, dil: rows[0].tercih_dili === 'İngilizce' ? 'en' : 'tr', kanal: rows[0].bildirim_kanali, dis: o.grup !== 'LGM İç Rolü',
      izinler: izinVar ? secenekler(o.grup).map((x) => ({ ...x, verildi: r.rows.some((v) => v.riza_turu === x.tur && v.amac === x.amac && v.kanal === x.kanal) })) : [],
    };
  });

  s.post('/profil/dil', oturumlu, async (i, y) => {
    const { dil } = (i.body ?? {}) as { dil?: string };
    if (dil !== 'tr' && dil !== 'en') return y.code(400).send({ hata: 'Geçersiz dil.' });
    await b.db.query(`UPDATE kullanici_hesabi SET tercih_dili = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [i.oturum!.kullanici, dil === 'en' ? 'İngilizce' : 'Türkçe']);
    return { tamam: true };
  });

  // YG-1211: tek adımda verilir veya geri alınır; önceki kayıt silinmez (YG-1210).
  // YG-1156, EP-M1: kod yeni adrese, uyarı eski adrese.
  s.post('/profil/eposta-talep', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { yeni?: string; parola?: string };
    if (!g.yeni || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.yeni)) return y.code(400).send({ hata: 'E-posta adresi geçersiz.' });
    const h = (await b.db.query(`SELECT e_posta, cep_telefonu, parola_ozeti FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
    if (h.parola_ozeti && !(await parolaDogrula(h.parola_ozeti, g.parola ?? ''))) { await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'E-posta Değişikliği Talebi', sonuc: 'Başarısız', adres: i.ip, iliski: i.id }); return y.code(403).send({ hata: 'Parola doğrulanamadı.' }); }
    if ((await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE lower(e_posta) = lower($1)`, [g.yeni])).rowCount) return y.code(409).send({ hata: 'Bu e-posta kullanılamaz.' });
    const kod = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await b.db.query(`INSERT INTO eposta_degisikligi (kullanici_ref, yeni_eposta, kod_ozeti, son_gecerlilik) VALUES ($1,$2,$3, now() + interval '15 minutes') ON CONFLICT (kullanici_ref) DO UPDATE SET yeni_eposta = EXCLUDED.yeni_eposta, kod_ozeti = EXCLUDED.kod_ozeti, son_gecerlilik = EXCLUDED.son_gecerlilik, deneme = 0`, [o.kullanici, g.yeni, ozet(`${o.kullanici}${kod}`)]);
    await b.eposta.gonder(g.yeni, await metinGetir(b.db, 'BLD-89', 'tr', { Kod: kod }));
    const uyari = await metinGetir(b.db, 'BLD-90', 'tr'); if (h.e_posta) await b.eposta.gonder(h.e_posta, uyari); else if (h.cep_telefonu) await b.sms.gonder(h.cep_telefonu, uyari);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'E-posta Değişikliği Talebi', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/profil/eposta-onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const kod = ((i.body ?? {}) as { kod?: string }).kod ?? '';
    const r = (await b.db.query(`SELECT yeni_eposta, kod_ozeti, deneme FROM eposta_degisikligi WHERE kullanici_ref = $1 AND son_gecerlilik > now()`, [o.kullanici])).rows[0];
    if (!r || r.deneme >= 5) return y.code(400).send({ hata: 'Kod hatalı veya süresi dolmuş.' });
    if (ozet(`${o.kullanici}${kod}`) !== r.kod_ozeti) { await b.db.query(`UPDATE eposta_degisikligi SET deneme = deneme + 1 WHERE kullanici_ref = $1`, [o.kullanici]); return y.code(400).send({ hata: 'Kod hatalı veya süresi dolmuş.' }); }
    await b.db.query(`UPDATE kullanici_hesabi SET e_posta = $2 WHERE kimlik = $1`, [o.kullanici, r.yeni_eposta]);
    await b.db.query(`DELETE FROM eposta_degisikligi WHERE kullanici_ref = $1`, [o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'E-posta Değiştirildi', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  s.post('/profil/izin', oturumlu, async (i, y) => {
    const o = i.oturum!;
    const { tur, amac, kanal, ver } = (i.body ?? {}) as { tur?: string; amac?: string | null; kanal?: string | null; ver?: boolean };
    const sec = secenekler(o.grup).find((x) => x.tur === tur && x.amac === (amac ?? null) && x.kanal === (kanal ?? null));
    if (!sec || !(o.grup === 'LGM İç Rolü' || o.grup.startsWith('Bireysel'))) return y.code(400).send({ hata: 'Geçersiz izin.' });
    const kos = `ilgili_kisi_ref = $1 AND riza_turu = $2 AND amac IS NOT DISTINCT FROM $3 AND kanal IS NOT DISTINCT FROM $4 AND durum = 'Verildi'`;
    const prm = [o.kullanici, sec.tur, sec.amac, sec.kanal];
    if (ver) {
      if (!(await b.db.query(`SELECT 1 FROM acik_riza WHERE ${kos}`, prm)).rowCount) {
        await b.db.query(`INSERT INTO acik_riza (ilgili_kisi_ref, riza_turu, amac, kanal, kaynak, metin_surumu, onay_adimi) VALUES ($1,$2,$3,$4,'Profil','R00','Profil')`, prm);
      }
    } else {
      await b.db.query(`UPDATE acik_riza SET durum = 'Geri Alındı', geri_alma_zamani = now(), geri_alma_kanali = 'YATONET 360 profili', gonderim_engeli = true WHERE ${kos}`, prm);
    }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: ver ? 'İzin Verildi' : 'İzin Geri Alındı', nesneKimligi: [sec.tur, sec.amac, sec.kanal].filter(Boolean).join(' · '), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
