import { join } from 'node:path';
import { Depo } from './depo.js';
import { izYaz } from './denetim.js';
import type { Pool, PoolClient } from 'pg';
import type { Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';

type Db = Pool | PoolClient;
const TZ_FARK_DK = 180; // Türkiye UTC+3, yaz saati uygulanmaz.
const AZAMI_DENEME = 3;
/** YG-1309: kalıcı hata geçersiz veya engelli hedeftir; diğerleri sağlayıcı veya bağlantı hatasıdır. */
export const kokNeden = (kalici: boolean) => (kalici ? 'Geçersiz veya engelli hedef' : 'Sağlayıcı veya bağlantı hatası');
const SONRAKI_DAKIKA = [1, 5, 30];

function yerel(d: Date) { return new Date(d.getTime() + TZ_FARK_DK * 60_000); }

/** Pazartesi–Cuma 09:00–18:00, Cumartesi 09:00–15:00 (çalışma saatleri). Resmî tatil takvimi eklenince daralır. */
export function mesaiIcinde(d: Date): boolean {
  const y = yerel(d); const g = y.getUTCDay(); const dk = y.getUTCHours() * 60 + y.getUTCMinutes();
  if (g === 0) return false;
  if (g === 6) return dk >= 540 && dk < 900;
  return dk >= 540 && dk < 1080;
}

/** YG-521: mesai dışı toplu gönderim sonraki iş günü 09:00. */
export function sonrakiMesai(d: Date): Date {
  if (mesaiIcinde(d)) return d;
  const y = yerel(d);
  const dk = y.getUTCHours() * 60 + y.getUTCMinutes();
  const gun = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate(), 9, 0));
  if (dk >= 540) gun.setUTCDate(gun.getUTCDate() + 1); // bugünün mesaisi bitti
  while (gun.getUTCDay() === 0) gun.setUTCDate(gun.getUTCDate() + 1);
  return new Date(gun.getTime() - TZ_FARK_DK * 60_000);
}

/** YG-521: ertelenen iletinin planı resmî tatile (tam gün) düşerse bir sonraki iş gününün mesai başlangıcına kayar. */
export async function sonrakiIsMesaisi(db: Db, d: Date): Promise<Date> {
  let p = sonrakiMesai(d);
  const tatil = new Set((await db.query(`SELECT to_char(tarih, 'YYYY-MM-DD') t FROM resmi_tatil WHERE NOT yarim_gun AND tarih >= $1::date - 1 AND tarih <= $1::date + 15`, [p.toISOString().slice(0, 10)])).rows.map((r) => r.t as string));
  for (let n = 0; n < 15 && tatil.has(yerel(p).toISOString().slice(0, 10)); n++) {
    const y = yerel(p); const ertesi = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate() + 1, 0, 0) - TZ_FARK_DK * 60_000);
    p = sonrakiMesai(ertesi);
  }
  return p;
}

export interface Bildirimi {
  olay: string; kullanicilar: string[]; baslik: string; ozet?: string | null; oncelik?: string; isRef?: string | null;
  /** Dış kanal. Sistem içi bildirim her zaman yazılır. */
  eposta?: boolean; sms?: boolean; acil?: boolean;
}

/**
 * YG-507, YG-509, YG-510: sistem içi bildirim anında; e-posta ve SMS kuyruğa. Aynı olay aynı kişiye iki kez gitmez.
 * YG-521: mesai dışında SMS yalnız Kritik veya acil işaretli olayda anında çıkar; diğerleri sonraki iş günü 09:00.
 */
/** YG-510: sessiz saat aralığındaki plan aralık sonuna kayar (TSİ, UTC+3; gece yarısını aşan aralık desteklenir). */
export function sessizSonu(plan: Date, bas: string, bit: string): Date {
  const dk = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const yerel = new Date(plan.getTime() + 3 * 3_600_000); const m = yerel.getUTCHours() * 60 + yerel.getUTCMinutes();
  const b0 = dk(bas), b1 = dk(bit); const icinde = b0 <= b1 ? m >= b0 && m < b1 : m >= b0 || m < b1;
  if (!icinde) return plan;
  const gun = Date.UTC(yerel.getUTCFullYear(), yerel.getUTCMonth(), yerel.getUTCDate()) + (b0 > b1 && m >= b0 ? 86_400_000 : 0);
  return new Date(gun + b1 * 60_000 - 3 * 3_600_000);
}

export async function bildir(db: Db, b: Bildirimi, simdi = new Date()): Promise<void> {
  const kritik = b.oncelik === 'Kritik' || Boolean(b.acil);
  for (const k of new Set(b.kullanicilar)) {
    const yeni = await db.query(
      `INSERT INTO bildirim (kullanici_ref, baslik, ozet, is_ref, olay_anahtari) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (kullanici_ref, olay_anahtari) WHERE olay_anahtari IS NOT NULL DO NOTHING RETURNING kimlik`,
      [k, b.baslik, b.ozet ?? null, b.isRef ?? null, b.olay]);
    if (!yeni.rowCount || (!b.eposta && !b.sms)) continue;
    const h = (await db.query(`SELECT e_posta, cep_telefonu, hesap_durumu, kullanici_grubu, bildirim_kanali FROM kullanici_hesabi WHERE kimlik = $1`, [k])).rows[0];
    if (!h || h.hesap_durumu !== 'Aktif') continue;
    let plan = kritik ? simdi : await sonrakiIsMesaisi(db, simdi); // YG-521: resmî tatil atlanır
    const metin = b.ozet ? `${b.baslik}: ${b.ozet}` : b.baslik;
    // YG-510: kullanıcının rollerindeki bildirim kuralı (en kısıtlayıcısı); Kritik bildirim etkilenmez.
    const kr = kritik ? null : (await db.query(`SELECT max(k.tekrar_dakika) tekrar, bool_or(k.birlestir) birlestir, min(to_char(k.sessiz_baslangic, 'HH24:MI')) bas, max(to_char(k.sessiz_bitis, 'HH24:MI')) bit
      FROM bildirim_kurali k JOIN rol_atamasi a ON a.rol_ref = k.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows[0];
    if (kr?.tekrar && (await db.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND baslik = $2 AND olay_anahtari IS DISTINCT FROM $3 AND zaman > $4::timestamptz - make_interval(mins => $5)`, [k, b.baslik, b.olay, simdi, kr.tekrar])).rowCount) continue;
    if (kr?.bas && kr?.bit) plan = sessizSonu(plan, kr.bas, kr.bit);
    const ekle = async (kanal: string, hedef: string, konu: string, m: string) => {
      if (kr?.birlestir && (await db.query(`UPDATE gonderim SET metin = metin || E'\n' || $4, konu = CASE WHEN konu LIKE '%(toplu)' THEN konu ELSE konu || ' (toplu)' END WHERE kimlik = (SELECT kimlik FROM gonderim WHERE kullanici_ref = $1 AND kanal = $2 AND hedef = $3 AND durum = 'Bekliyor' AND oncelik <> 'Kritik' ORDER BY plan_zamani LIMIT 1)`, [k, kanal, hedef, m])).rowCount) return;
      await kuyruk(db, b.olay, k, kanal, hedef, konu, m, b.oncelik, plan);
    };
    // YG-519: dış kullanıcı seçtiği kanaldan alır. WhatsApp bağlanana kadar e-posta yedek kanaldır.
    const dis = h.kullanici_grubu !== 'LGM İç Rolü';
    const ana = dis ? h.bildirim_kanali : 'E-posta';
    if (b.eposta && ana === 'E-posta' && h.e_posta) await ekle('E-posta', h.e_posta, b.baslik, metin);
    if (((b.eposta && ana === 'SMS') || b.sms) && h.cep_telefonu) await ekle('SMS', h.cep_telefonu, b.baslik, metin);
    if (b.eposta && ana === 'WhatsApp') {
      if (h.cep_telefonu) await ekle('WhatsApp', h.cep_telefonu, b.baslik, whatsappMetni(b.baslik));
      else if (h.e_posta) await ekle('E-posta', h.e_posta, b.baslik, metin);
    }
  }
}

/** YG-513: sistem içi bildirim okununca aynı olaya ait gönderilmiş dış iletiler (alternatif kanal dahil) Okundu olarak işlenir. */
export async function gonderimOkundu(db: Db, kullanici: string): Promise<void> {
  await db.query(`UPDATE gonderim g SET durum = 'Okundu' FROM bildirim b WHERE b.kullanici_ref = $1 AND b.okunma_zamani IS NOT NULL AND b.olay_anahtari IS NOT NULL AND g.kullanici_ref = $1
    AND g.olay_anahtari IN (b.olay_anahtari, b.olay_anahtari || ':alternatif') AND g.durum IN ('Gönderildi', 'Teslim Edildi')`, [kullanici]);
}

/** MSJ-3: otomatik WhatsApp iletisinde doğrulama kodu ve fiyat yer almaz; tutar ve kod biçimli sayı ayıklanır. Serbest yazışma bu süzgeçten geçmez. */
export function whatsappMetni(m: string): string {
  return m.replace(/\d[\d.]*(,\d+)?\s*(EUR|TL|€|₺)/gi, '').replace(/(EUR|TL|€|₺)\s*\d[\d.,]*/gi, '').replace(/(?<![\w-])\d{6}(?![\w-])/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([:·,.])/g, '$1').trim();
}

/** YG-1446: SMS en çok 300 karakterdir; aşan metinde ilk cümle ve bağlantı gider, tam metin e-postada kalır. */
export function smsMetni(m: string, sinir = 300): string {
  if (m.length <= sinir) return m;
  const bag = m.match(/https?:\/\/\S+/)?.[0] ?? '';
  const ilk = (m.replace(bag, '').trim().split(/(?<=[.!?])\s/)[0] ?? '').trim();
  const yer = sinir - (bag ? bag.length + 1 : 0);
  return [ilk.length > yer ? `${ilk.slice(0, yer - 1).trimEnd()}…` : ilk, bag].filter(Boolean).join(' ');
}

async function kuyruk(db: Db, olay: string, k: string | null, kanal: string, hedef: string, konu: string, metin: string, oncelik: string | undefined, plan: Date) {
  await db.query(
    `INSERT INTO gonderim (olay_anahtari, kullanici_ref, kanal, hedef, konu, metin, oncelik, plan_zamani) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (olay_anahtari, kanal, hedef) DO NOTHING`,
    [olay, k, kanal, hedef, konu, metin, oncelik ?? 'Normal', plan]);
}

/** Portal hesabı olmayan alıcı (yat sahibi, kaptan, sigorta): kayıttaki iletişim bilgisine kuyruktan gider. Aynı olay aynı adrese iki kez gitmez. */
export async function disGonder(db: Db, g: { olay: string; telefon?: string | null; eposta?: string | null; konu: string; metin: string; oncelik?: string; acil?: boolean; sigortaTeyitli?: boolean; ekler?: string[] }, simdi = new Date()): Promise<boolean> {
  if ((await import('./egitim.js')).egitimOrtami()) return true; // YG-1398: eğitim ortamında dış ileti teknik olarak üretilmez
  // K-241: sigorta adresine ileti yalnız ikili teyitten geçer; unutulan bir modül burada durur.
  if (g.eposta && !g.sigortaTeyitli && (await db.query(`SELECT 1 FROM dosya_sigorta_kaydi s JOIN dosya_tarafi t ON t.kimlik = s.sigorta_taraf_ref WHERE lower(t.eposta COLLATE "C") = lower($1::text COLLATE "C") LIMIT 1`, [g.eposta])).rowCount) throw new Error('Sigorta şirketine gönderim ikili teyit gerektirir.');
  if (g.ekler?.length) { const h = await (await import('./gorsel_gizlilik.js')).hassasEkEngeli(db, g.ekler); if (h) { await bildirGizlilikDurdurma(db, g.olay, h); return false; } } // YG-1165
  const gizlilik = await (await import('./yetki_ek.js')).disMetinEngeli(db, g); // YG-1167, YG-1623
  if (gizlilik) { await bildirGizlilikDurdurma(db, g.olay, gizlilik); return false; }
  // YG-1171: dosya belgesi eki, dosya tarafı olmayan alıcıya yalnız onaylı hasar paylaşım talebiyle gider (sigorta gönderimi ikili teyitten geçer).
  if (g.eposta && g.ekler?.length && !g.sigortaTeyitli) {
    const { hasarPaylasimEngeli } = await import('./yetki_ek.js');
    for (const r of (await db.query(`SELECT DISTINCT e.bag_kimligi FROM belge_surum s JOIN belge e ON e.kimlik = s.belge_ref WHERE s.kimlik = ANY($1::uuid[]) AND e.bag_turu = 'Dosya'`, [g.ekler])).rows) {
      const h = await hasarPaylasimEngeli(db, 'Dosya', r.bag_kimligi, g.eposta);
      if (h) { await bildirGizlilikDurdurma(db, g.olay, h); return false; }
    }
  }
  const plan = g.oncelik === 'Kritik' || g.acil ? simdi : await sonrakiIsMesaisi(db, simdi); // YG-521
  if (g.telefon) await kuyruk(db, g.olay, null, 'SMS', g.telefon, g.konu, g.metin, g.oncelik, plan);
  if (g.eposta) await kuyruk(db, g.olay, null, 'E-posta', g.eposta, g.konu, g.metin, g.oncelik, plan);
  if (g.eposta && g.ekler?.length) await db.query(`UPDATE gonderim SET ek_surumler = $3 WHERE olay_anahtari = $1 AND hedef = $2 AND kanal = 'E-posta'`, [g.olay, g.eposta, g.ekler]);
  return Boolean(g.telefon || g.eposta);
}

/** Kaçak ileti gitmez; Hukuk ve Uyum görür. */
async function bildirGizlilikDurdurma(db: Db, olay: string, neden: string) {
  const r = (await db.query(`SELECT a.kullanici_ref FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE x.rol_adi = 'Hukuk ve Uyum Direktörü' AND a.atama_durumu = 'Aktif'`)).rows.map((x) => x.kullanici_ref as string);
  if (r.length) await bildir(db, { olay: `gizlilik:${olay}`, kullanicilar: r, baslik: '⚠ Dış İleti Durduruldu', ozet: neden, oncelik: 'Yüksek' });
}

/** YG-523: aynı dönem iki kez işlenmez. */
/** ALT-5, YG-1952: tek sağlayıcı kesilince ilgili BT rollerine saatte bir Kritik bildirim. */
export async function smsKesintisiBildir(db: Db): Promise<void> {
  const saat = new Date().toISOString().slice(0, 13);
  if (!(await birKez(db, 'sms_kesinti', saat))) return;
  await bildir(db, { olay: `sms-kesinti:${saat}`, kullanicilar: (await db.query(`SELECT a.kullanici_ref FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.atama_durumu = 'Aktif' AND x.rol_adi IN ('Sistem Yöneticisi', 'Bilgi İşlem Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü')`)).rows.map((r) => r.kullanici_ref as string), baslik: '⚠ SMS Gönderilemiyor', ozet: 'SMS sağlayıcısı hata veriyor; kodlar e-postayla gönderiliyor.', oncelik: 'Kritik', eposta: true });
}

/** V-258: giriş kodu SMS'le gider; SMS hata verirse kayıtlı e-postaya gider. İkisi de yoksa null. */
export async function girisKoduGonder(b: Pick<Baglam, 'db' | 'sms' | 'eposta'>, telefon: string, eposta: string | null | undefined, metin: string): Promise<'SMS' | 'E-posta' | null> {
  try { await b.sms.gonder(telefon, metin); return 'SMS'; } catch {
    await smsKesintisiBildir(b.db);
    if (!eposta) return null;
    await b.eposta.gonder(eposta, metin); return 'E-posta';
  }
}

export async function birKez(db: Db, ad: string, anahtar: string): Promise<boolean> {
  return Boolean((await db.query(`INSERT INTO zamanlanmis_is (ad, anahtar) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING ad`, [ad, anahtar])).rowCount);
}

/**
 * Kuyruğu işler. YG-513: başarısız gönderim yeniden denenir; denemeler bitince alternatif kanal açılır, o da yoksa kişiye sistem içi görünür kalır.
 * WhatsApp ve dış servisler bağlanana kadar deneme kutusu çalışır; test ortamı gerçek kişiye gönderemez (YG-524).
 */
export async function kuyrukIsle(b: Baglam, simdi = new Date(), limit = 50): Promise<number> {
  const c = await b.db.connect(); let n = 0; const iz: Parameters<typeof izYaz>[1][] = [];
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT * FROM gonderim WHERE durum = 'Bekliyor' AND plan_zamani <= $1 ORDER BY plan_zamani LIMIT $2 FOR UPDATE SKIP LOCKED`, [simdi, limit]);
    for (const g of rows) {
      try {
        if (g.kanal === 'E-posta') {
          const ek = g.ek_surumler?.length ? (await c.query(`SELECT dosya_adi, depo_anahtari FROM belge_surum WHERE kimlik = ANY($1) AND depo_anahtari NOT LIKE 'kritik/%'`, [g.ek_surumler])).rows.map((r) => ({ ad: r.dosya_adi as string, yol: join((b.depo ?? new Depo()).kok, r.depo_anahtari as string) })) : undefined;
          await b.eposta.gonder(g.hedef, g.metin, ek);
        }
        else if (g.kanal === 'SMS') { // YG-1446
          await b.sms.gonder(g.hedef, smsMetni(g.metin));
          if (g.metin.length > 300 && g.kullanici_ref && !(await c.query(`SELECT 1 FROM gonderim WHERE olay_anahtari = $1 AND kanal = 'E-posta'`, [g.olay_anahtari])).rowCount) {
            const ep = (await c.query(`SELECT e_posta FROM kullanici_hesabi WHERE kimlik = $1`, [g.kullanici_ref])).rows[0]?.e_posta as string | undefined;
            if (ep) await kuyruk(c, g.olay_anahtari, g.kullanici_ref, 'E-posta', ep, g.konu, g.metin, g.oncelik, simdi);
          }
        }
        else await b.sms.gonder(g.hedef, g.metin); // WhatsApp sağlayıcısı bağlanana kadar deneme kutusu
        await c.query(`UPDATE gonderim SET durum = 'Gönderildi', gonderim_zamani = $2, deneme = deneme + 1 WHERE kimlik = $1`, [g.kimlik, simdi]);
        iz.push({ eylem: 'Entegrasyon Çağrısı', nesneTuru: 'Gönderim', nesneKimligi: g.kimlik, kanal: g.kanal, sonuc: 'Başarılı' }); // YG-1184
        n++;
      } catch (e) {
        // YG-1310: kalıcı hata (geçersiz numara veya adres, engelli alıcı) yeniden denenmez; geçici hata bekleme aralığıyla yeniden denenir.
        iz.push({ eylem: 'Entegrasyon Çağrısı', nesneTuru: 'Gönderim', nesneKimligi: g.kimlik, kanal: g.kanal, sonuc: 'Başarısız', gerekce: (e as Error).message.slice(0, 200) }); // YG-1184
        const kalici = (e as { kalici?: boolean }).kalici === true || /geçersiz|invalid|unknown (user|number|recipient)|blacklist|kara liste|engellen/i.test((e as Error).message);
        const d = kalici ? AZAMI_DENEME : g.deneme + 1;
        if (d >= AZAMI_DENEME) {
          await c.query(`UPDATE gonderim SET durum = 'Başarısız', deneme = $2, son_hata = $3, kok_neden = $4 WHERE kimlik = $1`, [g.kimlik, g.deneme + 1, `${kalici ? 'Kalıcı hata: ' : ''}${(e as Error).message}`.slice(0, 200), kokNeden(kalici)]);
          const h = g.kullanici_ref ? (await c.query(`SELECT e_posta, cep_telefonu FROM kullanici_hesabi WHERE kimlik = $1`, [g.kullanici_ref])).rows[0] : null;
          const alt = g.kanal === 'E-posta' ? (h?.cep_telefonu ? ['SMS', h.cep_telefonu] : null) : (h?.e_posta ? ['E-posta', h.e_posta] : null);
          if (alt) await kuyruk(c, g.olay_anahtari + ':alternatif', g.kullanici_ref, alt[0], alt[1], g.konu, g.metin, g.oncelik, simdi);
          else if (g.kullanici_ref) await c.query(`INSERT INTO bildirim (kullanici_ref, baslik, ozet) VALUES ($1,$2,$3)`, [g.kullanici_ref, 'İletişim Bilginizi Kontrol Ediniz', `"${g.konu}" bildirimi ulaştırılamadı.`]);
          // YG-513: Kritik iletinin teslim edilememesi görünür kalır: Bilgi İşlem Destek Sorumlusuna kanal doğrulama görevi, Bilgi İşlem Müdürüne eskalasyon.
          if (g.oncelik === 'Kritik') {
            const { kartAc } = await import('./is_motoru.js');
            const rol = (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Bilgi İşlem Destek Sorumlusu'`)).rows[0]?.kimlik as string | undefined;
            const alici = g.kullanici_ref ? (await c.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1`, [g.kullanici_ref])).rows[0]?.ad_soyad : null;
            const ozet = `${g.kanal} · ${alici ?? g.hedef} · "${g.konu}" · ${alt ? `${alt[0]} kanalından yeniden gönderiliyor` : 'alternatif kanal yok'}. Alıcının iletişim bilgisini doğrulayınız; gerekirse telefonla ulaşınız.`;
            if (rol) await kartAc(c, { tur: 'Kritik Bildirim Teslim Hatası', kategori: 'gorev', baslik: `Kritik Bildirim Ulaştırılamadı · ${g.konu}`.slice(0, 200), ozet, oncelik: 'Kritik', sahipRol: rol, nesneTuru: 'Gönderim', nesneKimligi: g.kimlik, simdi });
            const bimRol = (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Bilgi İşlem Müdürü'`)).rows[0]?.kimlik as string | undefined; const bim = bimRol ? await rolSahipleri(c, bimRol) : [];
            await bildir(c, { olay: `kritik-teslim-hatasi:${g.kimlik}`, kullanicilar: bim, baslik: `Eskalasyon: Kritik Bildirim Ulaştırılamadı · ${g.konu}`.slice(0, 200), ozet, oncelik: 'Kritik' }, simdi);
          }
        } else await c.query(`UPDATE gonderim SET deneme = $2, son_hata = $3, plan_zamani = $4 WHERE kimlik = $1`, [g.kimlik, d, (e as Error).message.slice(0, 200), new Date(simdi.getTime() + SONRAKI_DAKIKA[d - 1]! * 60_000)]);
      }
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  for (const k of iz) await izYaz(b.db, k).catch(() => {});
  return n;
}

/**
 * YG-527: süre dolunca onaylayana hatırlatma ve bir üst kademeye bilgi; sürenin iki katında üst kademeye SMS.
 * YG-1635 sayaçları bu tarihlere dayanır. Olağanüstü Olay Dönemi'nde süreler askıda olduğundan çalışmaz (YG-1629).
 */
export async function onayHatirlat(db: Pool, simdi = new Date()): Promise<number> {
  if ((await db.query(`SELECT 1 FROM olaganustu_donem WHERE bitis IS NULL UNION ALL SELECT 1 FROM kesinti WHERE tur = 'Kesinti' AND durum = 'Açık' LIMIT 1`)).rowCount) return 0; // YG-1629; TZ-1: sistem kesintisinde süreler durur
  const { rows } = await db.query(
    `SELECT kimlik, baslik, ozet, oncelik, olusturma_zamani, son_zaman, zincir[kademe + 1] AS makam, kademe FROM is_karti WHERE durum = 'Bekliyor' AND kategori = 'onay' AND son_zaman IS NOT NULL AND son_zaman < $1`, [simdi]);
  let n = 0;
  for (const k of rows) {
    const sure = new Date(k.son_zaman).getTime() - new Date(k.olusturma_zamani).getTime();
    const sahipler = await rolSahipleri(db, k.makam);
    const ust = await rolSahipleri(db, await onayMakami(db, k.makam));
    if (await birKez(db, 'onay_suresi_doldu', `${k.kimlik}:${k.kademe}`)) {
      await bildir(db, { olay: `onay-sure:${k.kimlik}:${k.kademe}`, kullanicilar: sahipler, baslik: `Onay Süresi Doldu: ${k.baslik}`, ozet: k.ozet, isRef: k.kimlik, oncelik: k.oncelik, eposta: true }, simdi);
      await bildir(db, { olay: `onay-sure-ust:${k.kimlik}:${k.kademe}`, kullanicilar: ust, baslik: `Bekleyen Onay: ${k.baslik}`, ozet: k.ozet, isRef: k.kimlik, oncelik: k.oncelik, eposta: true }, simdi);
      n++;
    }
    if (sure > 0 && simdi.getTime() >= new Date(k.olusturma_zamani).getTime() + 2 * sure && await birKez(db, 'onay_suresi_iki_kat', `${k.kimlik}:${k.kademe}`)) {
      await bildir(db, { olay: `onay-iki-kat:${k.kimlik}:${k.kademe}`, kullanicilar: ust, baslik: `Bekleyen Onay Uyarısı: ${k.baslik}`, isRef: k.kimlik, oncelik: k.oncelik, sms: true }, simdi);
      n++;
    }
  }
  return n;
}
