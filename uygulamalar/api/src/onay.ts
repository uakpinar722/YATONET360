import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { bildir, birKez, disGonder } from './bildirim.js';
import { belgeUret } from './belge_uret.js';
import { izYaz } from './denetim.js';
import { ozet, rastgeleBelirtec } from './kripto.js';
import type { Baglam } from './kimlik.js';
import { doldur, gunAy, metinGetir, type Dil } from './metin.js';

type Db = Pool | PoolClient;
const KOD_DK = 5; const YENI_KOD_SN = 60; const AZAMI_DENEME = 5;
const KOD_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** YG-470, Cilt VIII ¶282: onaylı sabit metin; değiştirilmez. */
const SIGORTA_HATIRLATMA: Record<Dil, string> = {
  tr: 'Yatınız için geçerli bir tekne sigortası poliçeniz varsa, onarımın başlayacağını sigorta şirketinize veya acentenize bildirmenizi önemle hatırlatırız.',
  en: 'If your yacht is covered by a valid hull insurance policy, we kindly remind you to notify your insurer or agent that repairs are about to begin.',
};

export interface OnayGirdisi {
  dosya?: string | null; ony: string; dil?: Dil; alanlar: Record<string, string>; baslikAlanlari?: Record<string, string>; kutular?: { ad: string; zorunlu?: boolean }[]; formTuru?: string; tutar?: number | null;
  belgeSurum?: string | null; belgeAdi?: string; taraf?: string | null; kullanici?: string | null; aliciAd: string; telefon?: string | null; eposta?: string | null;
  nesneTuru?: string; nesneKimligi?: string; hazirlayan?: string | null; gun?: number; sigortaHatirlat?: boolean; webAdresi: string; konu?: string;
}

/** Modül kendi onayının sonucunu aynı işlemde kendi kaydına işler. */
export type OnaySonuc = (c: PoolClient, t: Record<string, any>, karar: 'Onaylandı' | 'Reddedildi', kayit: { kimlik: string; zaman: Date; form: any; kutular: Record<string, boolean> }) => Promise<void>;
const SONUC = new Map<string, OnaySonuc>();
export function onaySonucKaydet(ony: string, f: OnaySonuc) { SONUC.set(ony, f); }
/** Form doğrulaması: beyan gibi veri alan ekranlar. Hata metni döner. */
const FORM = new Map<string, (db: Db, t: Record<string, any>, f: any) => Promise<string | null>>();
export function onayFormKaydet(tur: string, f: (db: Db, t: Record<string, any>, f: any) => Promise<string | null>) { FORM.set(tur, f); }

function onayKodu() {
  const b = randomBytes(8); let s = '';
  for (let i = 0; i < 8; i++) s += (i === 4 ? '-' : '') + KOD_ABC[b[i]! % KOD_ABC.length];
  return s;
}

/** YG-1507, YG-468: onaylı metindeki "Kutu n: ☐ ..." satırları ayrı işaretsiz kutu olur; ana metinden çıkar. */
export function kutuAyikla(metin: string): { metin: string; kutular: string[] } {
  const kutular: string[] = [];
  const y = metin.replace(/\s*Kutu(?: \d)?: ☐ ([^☐]+?)(?=\s*Kutu(?: \d)?: ☐|$)/g, (_t, k: string) => { kutular.push(k.trim()); return ''; });
  return { metin: y.trim(), kutular };
}

/** YG-465, YG-1448: onay bağlantısı e-posta ve SMS ile gider; aynı akış portal ve bağlantıda çalışır. YG-1477: vefat işaretinde onay bağlantısı açılmaz. */
export async function onayTalebiAc(c: Db, g: OnayGirdisi): Promise<{ kimlik: string; baglanti: string }> {
  if (g.dosya && (await c.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND vefat_isareti`, [g.dosya])).rowCount) throw Object.assign(new Error('Vefat işaretli dosyada onay bağlantısı gönderilmez.'), { statusCode: 409 });
  const dil = g.dil ?? 'tr';
  const s = (await c.query(`SELECT baslik, metin, dugme FROM sablon_metni WHERE kod = $1 AND dil = $2 AND durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`, [g.ony, dil])).rows[0];
  if (!s) throw new Error(`Onaylı metin bulunamadı: ${g.ony} (${dil})`);
  const belirtec = rastgeleBelirtec();
  const baslik = doldur(s.baslik ?? g.ony, g.baslikAlanlari ?? g.alanlar); const metin = doldur(kutuAyikla(s.metin).metin, g.alanlar);
  const { rows } = await c.query(
    `INSERT INTO onay_talebi (dosya_ref, ony_kod, baslik, metin, dugme, dil, kutular, form_turu, tutar_eur, belge_surum_ref, belge_adi, alici_taraf_ref, alici_kullanici_ref, alici_ad, telefon, eposta, belirtec_ozeti, son_gecerlilik, nesne_turu, nesne_kimligi, hazirlayan_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now() + make_interval(days => $18),$19,$20,$21) RETURNING kimlik`,
    [g.dosya ?? null, g.ony, baslik, metin + (g.sigortaHatirlat ? `\n\n${SIGORTA_HATIRLATMA[dil]}` : ''), s.dugme ?? (dil === 'tr' ? 'Onaylıyorum' : 'I approve'), dil, JSON.stringify(g.kutular ?? []), g.formTuru ?? null, g.tutar ?? null, g.belgeSurum ?? null, g.belgeAdi ?? baslik, g.taraf ?? null, g.kullanici ?? null, g.aliciAd, g.telefon ?? null, g.eposta ?? null, ozet(belirtec), g.gun ?? 30, g.nesneTuru ?? null, g.nesneKimligi ?? null, g.hazirlayan ?? null]);
  const id = rows[0].kimlik as string;
  const baglanti = `${g.webAdresi}/#onay=${belirtec}`;
  const dosyaNo = g.dosya ? (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [g.dosya])).rows[0]?.dosya_no ?? '' : '';
  const ad = g.belgeAdi ?? baslik;
  const ileti = await metinGetir(c, 'BLD-05', dil, { 'Dosya No': dosyaNo, 'File No': dosyaNo, 'belge adı': ad, 'document name': ad, 'bağlantı': baglanti, link: baglanti });
  await disGonder(c, { olay: `onay-bag:${id}`, telefon: g.telefon, eposta: g.eposta, konu: g.konu ?? ad, metin: ileti, acil: g.ony === 'ONY-28' || g.ony === 'ONY-29' });
  if (g.kullanici) await bildir(c, { olay: `onay-bag:${id}`, kullanicilar: [g.kullanici], baslik: `Onayınızı Bekliyor: ${ad}`, ozet: dosyaNo || null });
  return { kimlik: id, baglanti };
}

export function onayYollari(s: FastifyInstance, b: Baglam) {
  const bul = async (db: Db, belirtec: string) => {
    if (!/^[A-Za-z0-9_-]{20,}$/.test(belirtec)) return undefined;
    const t = (await db.query(`SELECT t.*, d.dosya_no, d.vefat_isareti FROM onay_talebi t LEFT JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.belirtec_ozeti = $1 OR t.portal_belirtec_ozeti = $1`, [ozet(belirtec)])).rows[0];
    return t;
  };
  const GECERSIZ = 'Bu onay bağlantısı geçersizdir.';
  const ekran = (t: Record<string, any>) => ({
    baslik: t.baslik, metin: t.metin, dugme: t.dugme, dil: t.dil, kutular: t.kutular, formTuru: t.form_turu, durum: t.durum, onyKod: t.ony_kod, belgeAdi: t.belge_adi, dosyaNo: t.dosya_no ?? null, sonGecerlilik: t.son_gecerlilik,
    // YG-479, K-168: SMS iki kez ulaşmazsa veya yurt dışı numarada e-posta kodu seçilebilir.
    epostaKodu: Boolean(t.eposta) && (t.sms_gonderim_sayisi >= 2 || Boolean(t.sms_hata_zamani) || !t.telefon || !String(t.telefon).startsWith('+90')),
    telefonSonu: t.telefon ? String(t.telefon).slice(-2) : null,
  });
  const gecerli = (t: Record<string, any>) => t.durum === 'Bekliyor' && new Date(t.son_gecerlilik) > new Date() && !t.vefat_isareti;

  // YG-1433: uygulama kurmadan bağlantı + kodla. Bağlantıyı açan yalnız kendisine gönderilen ekranı görür.
  s.get('/onay/:belirtec', async (i, y) => {
    const t = await bul(b.db, (i.params as { belirtec: string }).belirtec);
    if (!t) return y.code(404).send({ hata: GECERSIZ });
    if (t.durum === 'Bekliyor' && new Date(t.son_gecerlilik) <= new Date()) await b.db.query(`UPDATE onay_talebi SET durum = 'Süresi Doldu' WHERE kimlik = $1`, [t.kimlik]);
    return { ...ekran(t), durum: t.durum === 'Bekliyor' && !gecerli(t) ? 'Süresi Doldu' : t.durum };
  });

  s.post('/onay/:belirtec/kod', async (i, y) => {
    const t = await bul(b.db, (i.params as { belirtec: string }).belirtec); const { kanal } = (i.body ?? {}) as { kanal?: string };
    if (!t) return y.code(404).send({ hata: GECERSIZ });
    if (!gecerli(t)) return y.code(409).send({ hata: 'Bu onay artık açık değildir.' });
    if (t.kod_gonderim && Date.now() - new Date(t.kod_gonderim).getTime() < YENI_KOD_SN * 1000) return y.code(429).send({ hata: 'Yeni kod için bir dakika bekleyiniz.' });
    const eposta = kanal === 'E-posta';
    if (eposta && !ekran(t).epostaKodu) return y.code(403).send({ hata: 'E-posta kodu bu onay için açık değildir.' });
    if (!eposta && !t.telefon) return y.code(400).send({ hata: 'Kayıtlı telefon yok; Dosya Sorumlunuza başvurunuz.' });
    const kod = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const baglanti = `${b.webAdresi}/#onay=${(i.params as { belirtec: string }).belirtec}`;
    const metin = await metinGetir(b.db, 'ONY-20', t.dil, { kod, code: kod, 'bağlantı': baglanti, link: baglanti });
    if (eposta) await b.eposta.gonder(t.eposta, metin);
    else {
      try { await b.sms.gonder(t.telefon, metin); } catch (e) {
        // ALT-5, YG-1952: tek sağlayıcı kesilince kod e-postayla istenebilir; kesinti görünür olur.
        await b.db.query(`UPDATE onay_talebi SET sms_hata_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
        await izYaz(b.db, { eylem: 'Onay Kodu Gönderilemedi', nesneTuru: 'Onay Talebi', nesneKimligi: t.kimlik, sonuc: 'Başarısız', adres: i.ip, iliski: i.id });
        i.log.error({ hata: (e as Error).message }, 'SMS gönderilemedi');
        const saat = new Date().toISOString().slice(0, 13);
        if (await birKez(b.db, 'sms_kesinti', saat)) await bildir(b.db, { olay: `sms-kesinti:${saat}`, kullanicilar: (await b.db.query(`SELECT a.kullanici_ref FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.atama_durumu = 'Aktif' AND x.rol_adi IN ('Sistem Yöneticisi', 'Bilgi İşlem Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü')`)).rows.map((r) => r.kullanici_ref as string), baslik: '⚠ SMS Gönderilemiyor', ozet: 'SMS sağlayıcısı hata veriyor; onay kodları e-postayla istenebilir.', oncelik: 'Kritik', eposta: true });
        return y.code(503).send({ hata: t.eposta ? 'SMS şu anda gönderilemiyor. Kodu e-postayla istemenizi rica ederiz.' : 'SMS şu anda gönderilemiyor. Kayıtlı e-posta adresiniz bulunmadığından Dosya Sorumlunuza başvurmanızı rica ederiz.' });
      }
    }
    await b.db.query(`UPDATE onay_talebi SET kod_ozeti = $2, kod_son = now() + make_interval(mins => $3), kod_gonderim = now(), kod_deneme = 0, sms_gonderim_sayisi = sms_gonderim_sayisi + $4 WHERE kimlik = $1`, [t.kimlik, ozet(t.kimlik + kod), KOD_DK, eposta ? 0 : 1]);
    await izYaz(b.db, { eylem: 'Onay Kodu Gönderildi', nesneTuru: 'Onay Talebi', nesneKimligi: t.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { gonderildi: true, kanal: eposta ? 'E-posta' : 'SMS' };
  });

  // YG-466, YG-1507: tek düğme + kod. Zorunlu kutu işaretlenmeden onay verilmez. Onay belgenin bu sürümüne bağlanır.
  s.post('/onay/:belirtec/karar', async (i, y) => {
    const belirtec = (i.params as { belirtec: string }).belirtec;
    const g = (i.body ?? {}) as { karar?: string; kod?: string; kutular?: Record<string, boolean>; form?: any };
    const karar: 'Onaylandı' | 'Reddedildi' = g.karar === 'Reddet' ? 'Reddedildi' : 'Onaylandı';
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      const onk = await bul(c, belirtec);
      if (!onk) return dur(404, GECERSIZ);
      const t = (await c.query(`SELECT t.*, d.dosya_no, d.vefat_isareti FROM onay_talebi t LEFT JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1 FOR UPDATE OF t`, [onk.kimlik])).rows[0];
      if (!gecerli(t)) return dur(409, 'Bu onay artık açık değildir.');
      if (!t.kod_ozeti || new Date(t.kod_son) <= new Date()) return dur(400, 'Önce doğrulama kodu alınız.');
      if (t.kod_deneme >= AZAMI_DENEME) return dur(423, 'Çok fazla hatalı deneme; yeni kod alınız.');
      if (ozet(t.kimlik + String(g.kod ?? '')) !== t.kod_ozeti) {
        await c.query(`UPDATE onay_talebi SET kod_deneme = kod_deneme + 1 WHERE kimlik = $1`, [t.kimlik]);
        await izYaz(c, { eylem: 'Onay Kodu Denemesi', nesneTuru: 'Onay Talebi', nesneKimligi: t.kimlik, sonuc: 'Başarısız', adres: i.ip, iliski: i.id });
        await c.query('COMMIT');
        return y.code(401).send({ hata: 'Kod hatalıdır.' });
      }
      const kutular = g.kutular ?? {};
      if (karar === 'Onaylandı') for (const k of t.kutular as { ad: string; zorunlu?: boolean }[]) if (k.zorunlu && !kutular[k.ad]) return dur(400, `Lütfen işaretleyiniz: ${k.ad}`);
      if (t.form_turu && karar === 'Onaylandı') { const h = await FORM.get(t.form_turu)?.(c, t, g.form); if (h) return dur(400, h); }
      const zaman = new Date(); const kod = onayKodu();
      await c.query(`UPDATE onay_talebi SET durum = $2, karar_zamani = $3, kod_ozeti = NULL WHERE kimlik = $1`, [t.kimlik, karar, zaman]);
      const kayit = (await c.query(
        `INSERT INTO yatonet_onay_kaydi (onay_talebi_ref, karar, onaylanan_belge_surum_ref, metin_ozeti, kutu_cevaplari, form_verisi, onaylayan_ad, onaylayan_taraf_ref, onaylayan_kullanici_ref, kanal, onay_kodu, adres, onay_zamani) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING kimlik`,
        [t.kimlik, karar, t.belge_surum_ref, createHash('sha256').update(t.metin).digest('hex'), JSON.stringify(kutular), g.form === undefined ? null : JSON.stringify(g.form), t.alici_ad, t.alici_taraf_ref, t.alici_kullanici_ref, t.sms_gonderim_sayisi > 0 ? 'SMS Kodu' : 'E-posta Kodu', kod, i.ip.slice(0, 100), zaman])).rows[0];
      await SONUC.get(t.ony_kod)?.(c, t, karar, { kimlik: kayit.kimlik, zaman, form: g.form, kutular });
      // YG-466: onay sonrası kalıcı veri saklayıcıyla iletilir; iletim kuyrukta kayda geçer.
      if (karar === 'Onaylandı' && t.eposta) {
        const tarih = `${gunAy(zaman)} ${zaman.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}`;
        const m = await metinGetir(c, 'ONY-21', t.dil, { 'Belge adı': t.belge_adi, 'document name': t.belge_adi, 'Sürüm': 'Rev.1', version: 'Rev.1', 'tarih saat': tarih, 'date time': tarih });
        const gon = { olay: `onay-sonuc:${t.kimlik}`, eposta: t.eposta as string, konu: t.belge_adi as string, metin: `${m} Onay kodu: ${kod}`, acil: true };
        // YG-558: dosyaya bağlı onayda belge PDF olarak eklenir; kuyruk işlenince gider.
        if (t.dosya_ref) await belgeUret(c, { tur: 'Onay Belgesi', nesne: t.kimlik, dosya: t.dosya_ref, gonder: { ...gon, ekle: t.ony_kod === 'ONY-23' ? ['Fiyat Teklifi', 'Ön Bilgilendirme Formu'] : t.ony_kod === 'ONY-27' ? ['Teslim Tutanağı'] : undefined } });
        else await disGonder(c, gon);
      }
      // YG-161: kim, hangi sıfatla, hangi dayanakla, hangi tutarı onayladı.
      await c.query(`UPDATE yatonet_onay_kaydi SET tutar_eur = $2, temsil_sifati = (SELECT taraf_rolu FROM dosya_tarafi WHERE kimlik = $3), yetki_dayanagi = (SELECT y.yetki_dayanagi_turu FROM yetki_kaydi y WHERE y.dosya_tarafi_ref = $3 ORDER BY y.belge_tarihi DESC LIMIT 1) WHERE onay_talebi_ref = $1`, [t.kimlik, t.tutar_eur ?? null, t.alici_taraf_ref ?? null]);
      if (t.hazirlayan_ref) await bildir(c, { olay: `onay-karar:${t.kimlik}`, kullanicilar: [t.hazirlayan_ref], baslik: `${karar}: ${t.belge_adi}`, ozet: t.dosya_no, eposta: true });
      await izYaz(c, { eylem: `YATONET 360 Onayı: ${karar}`, aktor: t.alici_kullanici_ref, nesneTuru: 'Onay Talebi', nesneKimligi: t.kimlik, yeni: { ony: t.ony_kod, kod }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Bağlantı' });
      await c.query('COMMIT');
      return { durum: karar, onayKodu: kod };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
