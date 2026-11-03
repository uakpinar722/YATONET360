import { join } from 'node:path';
import { Depo } from './depo.js';
import type { Pool, PoolClient } from 'pg';
import type { Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';

type Db = Pool | PoolClient;
const TZ_FARK_DK = 180; // Türkiye UTC+3, yaz saati uygulanmaz.
const AZAMI_DENEME = 3;
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

export interface Bildirimi {
  olay: string; kullanicilar: string[]; baslik: string; ozet?: string | null; oncelik?: string; isRef?: string | null;
  /** Dış kanal. Sistem içi bildirim her zaman yazılır. */
  eposta?: boolean; sms?: boolean; acil?: boolean;
}

/**
 * YG-507, YG-509, YG-510: sistem içi bildirim anında; e-posta ve SMS kuyruğa. Aynı olay aynı kişiye iki kez gitmez.
 * YG-521: mesai dışında SMS yalnız Kritik veya acil işaretli olayda anında çıkar; diğerleri sonraki iş günü 09:00.
 */
export async function bildir(db: Db, b: Bildirimi, simdi = new Date()): Promise<void> {
  const kritik = b.oncelik === 'Kritik' || Boolean(b.acil);
  for (const k of new Set(b.kullanicilar)) {
    const yeni = await db.query(
      `INSERT INTO bildirim (kullanici_ref, baslik, ozet, is_ref, olay_anahtari) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (kullanici_ref, olay_anahtari) WHERE olay_anahtari IS NOT NULL DO NOTHING RETURNING kimlik`,
      [k, b.baslik, b.ozet ?? null, b.isRef ?? null, b.olay]);
    if (!yeni.rowCount || (!b.eposta && !b.sms)) continue;
    const h = (await db.query(`SELECT e_posta, cep_telefonu, hesap_durumu, kullanici_grubu, bildirim_kanali FROM kullanici_hesabi WHERE kimlik = $1`, [k])).rows[0];
    if (!h || h.hesap_durumu !== 'Aktif') continue;
    const plan = kritik ? simdi : sonrakiMesai(simdi);
    const metin = b.ozet ? `${b.baslik}: ${b.ozet}` : b.baslik;
    // YG-519: dış kullanıcı seçtiği kanaldan alır. WhatsApp bağlanana kadar e-posta yedek kanaldır.
    const dis = h.kullanici_grubu !== 'LGM İç Rolü';
    const ana = dis ? h.bildirim_kanali : 'E-posta';
    if (b.eposta && ana === 'E-posta' && h.e_posta) await kuyruk(db, b.olay, k, 'E-posta', h.e_posta, b.baslik, metin, b.oncelik, plan);
    if (((b.eposta && ana === 'SMS') || b.sms) && h.cep_telefonu) await kuyruk(db, b.olay, k, 'SMS', h.cep_telefonu, b.baslik, metin, b.oncelik, plan);
    if (b.eposta && ana === 'WhatsApp') {
      if (h.cep_telefonu) await kuyruk(db, b.olay, k, 'WhatsApp', h.cep_telefonu, b.baslik, b.baslik, b.oncelik, plan);
      else if (h.e_posta) await kuyruk(db, b.olay, k, 'E-posta', h.e_posta, b.baslik, metin, b.oncelik, plan);
    }
  }
}

async function kuyruk(db: Db, olay: string, k: string | null, kanal: string, hedef: string, konu: string, metin: string, oncelik: string | undefined, plan: Date) {
  await db.query(
    `INSERT INTO gonderim (olay_anahtari, kullanici_ref, kanal, hedef, konu, metin, oncelik, plan_zamani) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (olay_anahtari, kanal, hedef) DO NOTHING`,
    [olay, k, kanal, hedef, konu, metin, oncelik ?? 'Normal', plan]);
}

/** Portal hesabı olmayan alıcı (yat sahibi, kaptan, sigorta): kayıttaki iletişim bilgisine kuyruktan gider. Aynı olay aynı adrese iki kez gitmez. */
export async function disGonder(db: Db, g: { olay: string; telefon?: string | null; eposta?: string | null; konu: string; metin: string; oncelik?: string; acil?: boolean; sigortaTeyitli?: boolean; ekler?: string[] }, simdi = new Date()): Promise<boolean> {
  // K-241: sigorta adresine ileti yalnız ikili teyitten geçer; unutulan bir modül burada durur.
  if (g.eposta && !g.sigortaTeyitli && (await db.query(`SELECT 1 FROM dosya_sigorta_kaydi s JOIN dosya_tarafi t ON t.kimlik = s.sigorta_taraf_ref WHERE lower(t.eposta COLLATE "C") = lower($1::text COLLATE "C") LIMIT 1`, [g.eposta])).rowCount) throw new Error('Sigorta şirketine gönderim ikili teyit gerektirir.');
  const plan = g.oncelik === 'Kritik' || g.acil ? simdi : sonrakiMesai(simdi);
  if (g.telefon) await kuyruk(db, g.olay, null, 'SMS', g.telefon, g.konu, g.metin, g.oncelik, plan);
  if (g.eposta) await kuyruk(db, g.olay, null, 'E-posta', g.eposta, g.konu, g.metin, g.oncelik, plan);
  if (g.eposta && g.ekler?.length) await db.query(`UPDATE gonderim SET ek_surumler = $3 WHERE olay_anahtari = $1 AND hedef = $2 AND kanal = 'E-posta'`, [g.olay, g.eposta, g.ekler]);
  return Boolean(g.telefon || g.eposta);
}

/** YG-523: aynı dönem iki kez işlenmez. */
export async function birKez(db: Db, ad: string, anahtar: string): Promise<boolean> {
  return Boolean((await db.query(`INSERT INTO zamanlanmis_is (ad, anahtar) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING ad`, [ad, anahtar])).rowCount);
}

/**
 * Kuyruğu işler. YG-513: başarısız gönderim yeniden denenir; denemeler bitince alternatif kanal açılır, o da yoksa kişiye sistem içi görünür kalır.
 * WhatsApp ve dış servisler bağlanana kadar deneme kutusu çalışır; test ortamı gerçek kişiye gönderemez (YG-524).
 */
export async function kuyrukIsle(b: Baglam, simdi = new Date(), limit = 50): Promise<number> {
  const c = await b.db.connect(); let n = 0;
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT * FROM gonderim WHERE durum = 'Bekliyor' AND plan_zamani <= $1 ORDER BY plan_zamani LIMIT $2 FOR UPDATE SKIP LOCKED`, [simdi, limit]);
    for (const g of rows) {
      try {
        if (g.kanal === 'E-posta') {
          const ek = g.ek_surumler?.length ? (await c.query(`SELECT dosya_adi, depo_anahtari FROM belge_surum WHERE kimlik = ANY($1)`, [g.ek_surumler])).rows.map((r) => ({ ad: r.dosya_adi as string, yol: join((b.depo ?? new Depo()).kok, r.depo_anahtari as string) })) : undefined;
          await b.eposta.gonder(g.hedef, g.metin, ek);
        }
        else await b.sms.gonder(g.hedef, g.metin); // WhatsApp sağlayıcısı bağlanana kadar deneme kutusu
        await c.query(`UPDATE gonderim SET durum = 'Gönderildi', gonderim_zamani = $2, deneme = deneme + 1 WHERE kimlik = $1`, [g.kimlik, simdi]);
        n++;
      } catch (e) {
        const d = g.deneme + 1;
        if (d >= AZAMI_DENEME) {
          await c.query(`UPDATE gonderim SET durum = 'Başarısız', deneme = $2, son_hata = $3 WHERE kimlik = $1`, [g.kimlik, d, (e as Error).message.slice(0, 200)]);
          const h = g.kullanici_ref ? (await c.query(`SELECT e_posta, cep_telefonu FROM kullanici_hesabi WHERE kimlik = $1`, [g.kullanici_ref])).rows[0] : null;
          const alt = g.kanal === 'E-posta' ? (h?.cep_telefonu ? ['SMS', h.cep_telefonu] : null) : (h?.e_posta ? ['E-posta', h.e_posta] : null);
          if (alt) await kuyruk(c, g.olay_anahtari + ':alternatif', g.kullanici_ref, alt[0], alt[1], g.konu, g.metin, g.oncelik, simdi);
          else if (g.kullanici_ref) await c.query(`INSERT INTO bildirim (kullanici_ref, baslik, ozet) VALUES ($1,$2,$3)`, [g.kullanici_ref, 'İletişim Bilginizi Kontrol Ediniz', `"${g.konu}" bildirimi ulaştırılamadı.`]);
        } else await c.query(`UPDATE gonderim SET deneme = $2, son_hata = $3, plan_zamani = $4 WHERE kimlik = $1`, [g.kimlik, d, (e as Error).message.slice(0, 200), new Date(simdi.getTime() + SONRAKI_DAKIKA[d - 1]! * 60_000)]);
      }
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return n;
}

/**
 * YG-527: süre dolunca onaylayana hatırlatma ve bir üst kademeye bilgi; sürenin iki katında üst kademeye SMS.
 * YG-1635 sayaçları bu tarihlere dayanır. Olağanüstü Olay Dönemi'nde süreler askıda olduğundan çalışmaz (YG-1629).
 */
export async function onayHatirlat(db: Pool, simdi = new Date()): Promise<number> {
  if ((await db.query(`SELECT 1 FROM olaganustu_donem WHERE bitis IS NULL LIMIT 1`)).rowCount) return 0;
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
