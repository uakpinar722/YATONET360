import { otomatikKabulKontrolu } from './onay_ek.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, disGonder } from './bildirim.js';
import { sigortaAdresiBekleniyor, sigortayaHazirla } from './sigorta_gonderim.js';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { statuYaz } from './dosya.js';
import { ihbarAlindiGonder, ihbarKaydet, rolId } from './ihbar.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { metinGetir } from './metin.js';
import { musteriDurumu } from './portal.js';
import { UUID } from './yat.js';
import { Depo } from './depo.js';
import { GMO_KALEMLERI, parametre, yururlukSurumu } from './teklif.js';

/** YG-1564: sigorta ve eksper Muvafakat, Yasal Bekleme ve Ödeme Bekleniyor durumlarını Beklemede görür. */
const GIZLI_DURUM = ['Muvafakat Bekleniyor', 'Yasal Bekleme Süresinde', 'Ödeme Bekleniyor'];
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;

async function kararUygula(c: PoolClient, t: Record<string, any>, onaylananSira: number[], kanal: string, yetkili: string, kaydeden: string, simdi: Date, sureDolumu = false) {
  const kalemler = (await c.query(`SELECT * FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [t.kimlik])).rows;
  for (const k of kalemler) await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = $2 WHERE kimlik = $1`, [k.kimlik, onaylananSira.includes(k.sira_no) ? 'Onaylandı' : 'Onaylanmadı']);
  const tutar = R2(kalemler.filter((k) => onaylananSira.includes(k.sira_no)).reduce((a, k) => a + Number(k.tutar_eur), 0));
  const tam = onaylananSira.length === kalemler.length; const karar = sureDolumu ? 'Süre Dolumu Kabulü' : tam ? 'Tam Onay' : onaylananSira.length ? 'Kısmi Onay' : 'Ret';
  await c.query(`INSERT INTO sigorta_onayi (dosya_ref, teklif_ref, karar, onaylanan_tutar_eur, onay_kanali, onay_tarihi, onaylayan_yetkili, kaydi_yapan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [t.dosya_ref, t.kimlik, karar, tutar, kanal, simdi, yetkili, kaydeden]);
  await c.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = $2, karar_zamani = $3, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kimlik, karar, simdi]);
  if (karar === 'Tam Onay' || karar === 'Kısmi Onay') await (await import('./belge_uret.js')).sigortaOnayBelgesiUret(c, t.kimlik); // YG-1569
  // YG-455: portal kısmi onayında onaylanmayan kalemler için yat sahibine ayrı teklif görevi kendiliğinden açılır (yazılı onay girişindeki gibi).
  if (karar === 'Kısmi Onay' && t.hazirlayan_ref) { const { kartAc } = await import('./is_motoru.js'); const dn = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [t.dosya_ref])).rows[0]?.dosya_no;
    await kartAc(c, { tur: 'Fiyat Teklifi Hazırla', baslik: `${dn} · Sigortaca Onaylanmayan Kalemler İçin Teklif`, ozet: `${kalemler.length - onaylananSira.length} kalem`, kategori: 'islem', sahipKullanici: t.hazirlayan_ref, nesneTuru: 'Teklif', nesneKimligi: t.kimlik }); }
  if (karar !== 'Ret' && t.d_statu === 'Aktif' && t.asama !== 'Uygulama') await statuYaz(c, { kimlik: t.dosya_ref, statu: 'Aktif', asama: t.asama }, { statu: 'Aktif', asama: 'Uygulama' }, `Sigorta kararı: ${karar}`, kaydeden, 'Operasyon Yöneticisi');
  return { karar, tutar, onaylanmayan: kalemler.length - onaylananSira.length };
}

/**
 * YG-444, YG-1568: sigortaya iletilen teklifte 5 iş günü içinde işlem yoksa kalemler onaylanmış sayılır; 24 saat önce tek hatırlatma (BLD-72).
 * Çerçeve sözleşmesiz dosyada sözleşme hükmü bulunmadığından süre işlemez, Dosya Sorumlusuna görev kalır.
 */
export async function sigortaSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const { rows } = await db.query(`SELECT f.*, d.dosya_no, d.statu AS d_statu, d.asama, d.dosya_sorumlusu_ref, s.cerceve_sozlesme_yok, s.sigortaci_adi, p.eposta FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik LEFT JOIN dosya_tarafi p ON p.kimlik = s.sigorta_taraf_ref WHERE f.statu = 'Gönderildi' AND f.teklif_muhatabi = 'Sigorta Şirketi' AND f.sigorta_karar_son IS NOT NULL`);
  const { isGunuSonu } = await import('./teklif.js'); const { kartAc } = await import('./is_motoru.js'); const { birKez } = await import('./bildirim.js');
  for (const t of rows) {
    const son = new Date(t.sigorta_karar_son);
    // YG-447: ek iş teklifinde 1. iş günü sonunda hatırlatma (BLD-72, tek), 3. iş günü sonunda Dosya Sorumlusuna telefon takip görevi.
    const ek = t.teklif_turu === 'Ek Fiyat Teklifi' && t.gonderim_zamani && son > simdi;
    if (ek && t.dosya_sorumlusu_ref && simdi >= (await isGunuSonu(db, new Date(t.gonderim_zamani), 3)) && (await birKez(db, 'ek-is-telefon', t.kimlik))) {
      await kartAc(db, { tur: 'Sigorta Telefon Takibi', kategori: 'gorev', baslik: `${t.dosya_no} · Ek İş Onayı İçin Sigortayı Telefonla Arayınız`, ozet: `${t.teklif_no} üç iş günüdür yanıt bekliyor; görüşme sonucunu dosyaya kaydediniz.`, oncelik: 'Yüksek', sahipKullanici: t.dosya_sorumlusu_ref, sonZaman: son, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
      n++;
    }
    const ekHatirlat = ek && simdi >= (await isGunuSonu(db, new Date(t.gonderim_zamani), 1));
    if (!t.sigorta_hatirlatma && son > simdi && (ekHatirlat || son.getTime() - simdi.getTime() <= 24 * 3_600_000)) {
      const m = await metinGetir(db, 'BLD-72', 'tr', { 'Dosya No': t.dosya_no, 'Fiyat Teklifi / Ek Fiyat Teklifi / Acil Tedbir Fiyat Teklifi': t.teklif_turu, Kurum: t.sigortaci_adi ?? '', 'son tarih saat': son.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' }) });
      if (t.eposta) await sigortayaHazirla(db, { dosya: t.dosya_ref, tur: 'BLD-72', nesne: t.kimlik, alici: t.eposta, konu: `${t.dosya_no} Hatırlatma`, metin: m, acil: true, sonZaman: son }); // K-241
      else await sigortaAdresiBekleniyor(db, t.dosya_ref);
      await db.query(`UPDATE fiyat_teklifi SET sigorta_hatirlatma = true WHERE kimlik = $1`, [t.kimlik]);
      n++;
    } else if (son <= simdi && !t.cerceve_sozlesme_yok) {
      const c = await db.connect();
      try {
        await c.query('BEGIN');
        const hepsi = (await c.query(`SELECT sira_no FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [t.kimlik])).rows.map((r) => r.sira_no as number);
        await kararUygula(c, t, hepsi, 'Çerçeve Sözleşme Süresi', 'Süre dolumu (5 iş günü)', t.hazirlayan_ref, simdi, true); // SGT-1
        await otomatikKabulKontrolu(c, { kimlik: t.kimlik, teklif_no: t.teklif_no, dosya_ref: t.dosya_ref }, t.dosya_sorumlusu_ref); // YG-062
        // YG-1505 (D-038): sigortaya "süre dolmuş" denmez; onarım planlamasına başlandığı BLD-73 ile bildirilir.
        const m73 = await metinGetir(c, 'BLD-73', 'tr', { Kurum: t.sigortaci_adi ?? '', 'Dosya No': t.dosya_no });
        if (t.eposta) await sigortayaHazirla(c, { dosya: t.dosya_ref, tur: 'BLD-73', nesne: t.kimlik, alici: t.eposta, konu: `${t.dosya_no} Onarım Planlaması`, metin: m73 }); else await sigortaAdresiBekleniyor(c, t.dosya_ref);
        if (t.dosya_sorumlusu_ref) await bildir(c, { olay: `sigorta-sure:${t.kimlik}`, kullanicilar: [t.dosya_sorumlusu_ref], baslik: `Süre Doldu, Kalemler Sigortaca Karşılanacak Sayıldı: ${t.teklif_no}`, ozet: 'Bu bir sigorta onayı değildir; çerçeve sözleşme gereği itiraz edilmeyen kalemler karşılanacak sayılır.', eposta: true }, simdi);
        await izYaz(c, { eylem: 'Sigorta Süre Dolumu Kabulü', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, sonuc: 'Başarılı' });
        await c.query('COMMIT'); n++;
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    }
  }
  return n;
}

export function sigortaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
  const sirketim = async (k: string) => (await b.db.query(`SELECT sigortaci_adi FROM sigorta_kullanici WHERE kullanici_ref = $1`, [k])).rows[0]?.sigortaci_adi as string | undefined;
  const dosyaKosul = `(lower(s.sigortaci_adi) = lower($1) OR EXISTS (SELECT 1 FROM dosya_tarafi e WHERE e.dosya_ref = d.kimlik AND e.taraf_rolu = 'Eksper' AND e.kullanici_ref = $2 AND e.aktif))`;
  const durum = async (d: Record<string, any>) => {
    const bek = (await b.db.query(`SELECT neden FROM beklemede_isareti WHERE dosya_ref = $1 AND kaldirilma_zamani IS NULL`, [d.kimlik])).rows.map((r) => r.neden as string);
    const m = musteriDurumu(d as never, await (await import('./portal.js')).musteriGostergeleri(b.db, d.kimlik, bek)); // YG-1564
    return GIZLI_DURUM.includes(m.ad) ? { ad: 'Beklemede', renk: 'kırmızı' } : m;
  };

  // YG-438, YG-1571: yalnız taraf olunan dosyalar; hasar dosya no ve LGM no ayrı. Firma adı hiçbir yerde görünmez (YG-296).
  // YG-1374: sigorta/eksper kullanıcısı yalnız kendi dosyalarında dosya no, hasar dosya no ve yat adıyla arar.
  s.get('/sigorta/ara', oturumlu, async (i, y) => {
    const o = i.oturum!; const sir = await sirketim(o.kullanici); const q = String((i.query as { q?: string }).q ?? '').trim();
    if (!sir && !o.grup.startsWith('Sigorta')) return yok(y);
    if (q.length < 2) return [];
    return (await b.db.query(`SELECT d.kimlik, d.dosya_no, y.yat_adi, s.sigorta_hasar_dosya_no hasar_no FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE ${dosyaKosul} AND (tr_norm(d.dosya_no) LIKE '%' || tr_norm($3) || '%' OR tr_norm(y.yat_adi) LIKE '%' || tr_norm($3) || '%' OR tr_norm(s.sigorta_hasar_dosya_no) LIKE '%' || tr_norm($3) || '%') ORDER BY d.acilis_tarihi DESC LIMIT 30`, [sir ?? '', o.kullanici, q])).rows;
  });
  // YG-854: kartela sigorta şirketlerine menüdür; yürürlükteki sürümün birim fiyatı (maliyet x fiyat katsayısı) görünür, maliyet görünmez.
  s.get('/sigorta/kartela', oturumlu, async (i, y) => {
    const o = i.oturum!; const sir = await sirketim(o.kullanici);
    if (!sir && !o.grup.startsWith('Sigorta')) return y.code(403).send({ hata: 'Bu sayfa sigorta kullanıcılarına açıktır.' });
    const q = String((i.query as { q?: string }).q ?? '').trim(); if (q.length < 2) return { kalemler: [] };
    const sur = await yururlukSurumu(b.db); const kat = await parametre(b.db, 'fiyat_katsayisi');
    const rows = (await b.db.query(`SELECT k.kod, k.ana_brans, k.alt_brans, k.islem, k.birim, round(k.maliyet_eur * $3::numeric, 2)::text birim_fiyat_eur FROM kartela_kalemi k
      WHERE k.surum = $1 AND (k.kod ILIKE $2 || '%' OR tr_norm(k.islem) LIKE '%' || tr_norm($2) || '%' OR tr_norm(k.alt_brans) LIKE '%' || tr_norm($2) || '%') ORDER BY k.kod LIMIT 50`, [sur, q, kat])).rows;
    const yr = (await b.db.query(`SELECT yururluk::text FROM kartela_surumu WHERE surum = $1`, [sur])).rows[0]?.yururluk ?? null;
    return { surum: sur ?? null, yururluk: yr, kalemler: rows.map((r) => ({ ...r, yatBoyunaGore: GMO_KALEMLERI.includes(r.kod) })) };
  });
  s.get('/sigorta/ana', oturumlu, async (i, y) => {
    const o = i.oturum!; const sir = await sirketim(o.kullanici);
    if (!sir && !o.grup.startsWith('Sigorta')) return y.code(403).send({ hata: 'Bu sayfa sigorta kullanıcılarına açıktır.' });
    const { rows } = await b.db.query(`SELECT d.kimlik, d.dosya_no, d.statu, d.asama, d.tahmini_teslim_tarihi::text, d.ilerleme_yuzdesi, y.yat_adi, s.sigorta_hasar_dosya_no FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE ${dosyaKosul} ORDER BY d.acilis_tarihi DESC LIMIT 200`, [sir ?? '', o.kullanici]);
    const grn = await (await import('./garanti_sigorta.js')).garantiDurumlari(b.db, rows.map((r) => r.kimlik as string)); // YG-1421
    const dosyalar = []; for (const r of rows) { const m = await durum(r); dosyalar.push({ kimlik: r.kimlik, dosyaNo: r.dosya_no, hasarNo: r.sigorta_hasar_dosya_no, yat: r.yat_adi, durum: m.ad, renk: m.renk, garanti: grn.get(r.kimlik) ?? null, tahminiTeslim: r.tahmini_teslim_tarihi ?? null,
      // YG-460: onarım ilerlemesi ve Dosya Sorumlusunca portala açılmış ilerleme fotoğrafları (yat sahibiyle aynı yayım).
      raporlar: (await b.db.query(`SELECT u.kimlik, t.rapor_no, t.rapor_turu, u.olusturma_zamani FROM belge_uretim u JOIN teknik_rapor t ON t.kimlik::text = u.nesne WHERE u.dosya_ref = $1 AND u.tur = 'Teknik Rapor' AND u.durum = 'Üretildi' AND t.durum = 'Onaylı' ORDER BY u.olusturma_zamani`, [r.kimlik])).rows, // YG-440
      ilerleme: Number(r.ilerleme_yuzdesi ?? 0), fotograflar: (await b.db.query(`SELECT kimlik, aciklama, onay_zamani FROM portal_ilerleme_fotografi WHERE dosya_ref = $1 AND kaldirma_zamani IS NULL ORDER BY onay_zamani`, [r.kimlik])).rows }); }
    const bekleyen = (await b.db.query(`SELECT f.kimlik, f.teklif_no, f.surum_no, f.teklif_turu, f.ara_toplam_eur, f.genel_toplam_eur, f.sigorta_karar_son, d.dosya_no FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE f.statu = 'Gönderildi' AND f.teklif_muhatabi = 'Sigorta Şirketi' AND ${dosyaKosul} ORDER BY f.sigorta_karar_son NULLS LAST`, [sir ?? '', o.kullanici])).rows;
    // YG-017: sigorta şirketi adına beyan edilen ihbar dosya açılmadan da görünür; yalnız talep no, yat, hasar no ve "İhbar Alındı".
    const ihbarlar = sir ? (await b.db.query(`SELECT t.kimlik, t.talep_no, t.kayda_gecis_zamani, t.sigorta_hasar_dosya_no_beyan, y.yat_adi FROM talep t JOIN yat y ON y.kimlik = t.yat_ref WHERE t.dosya_ref IS NULL AND lower(t.sigortaci_beyan) = lower($1) AND t.statu NOT IN ('Birleştirildi', 'Kapsam Dışı / Yönlendirme') ORDER BY t.kayda_gecis_zamani DESC LIMIT 200`, [sir])).rows.map((t) => ({ kimlik: t.kimlik, talepNo: t.talep_no, yat: t.yat_adi, hasarNo: t.sigorta_hasar_dosya_no_beyan, durum: 'İhbar Alındı', zaman: t.kayda_gecis_zamani })) : [];
    return { dosyalar, bekleyen, ihbarlar };
  });

  // YG-440: onaylı teknik rapor PDF'i yalnız dosyası görünen sigorta kullanıcısına ve eksperine; indirme denetim izine yazılır.
  // YG-460: RP-RAP-001 İlerleme Raporu (PDF) sigorta şirketinin dosyası için.
  s.get('/sigorta/dosya/:id/ilerleme-raporu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const sir = await sirketim(o.kullanici);
    if (!UUID.test(id) || (!sir && !o.grup.startsWith('Sigorta'))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya d LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE d.kimlik = $3 AND ${dosyaKosul}`, [sir ?? '', o.kullanici, id])).rowCount) return yok(y);
    const r = await (await import('./ilerleme_rapor.js')).ilerlemeRaporuPdf(b.db, id); if (!r) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge İndirildi', nesneTuru: 'İlerleme Raporu', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Sigorta Portalı' });
    return y.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${r.dosyaAdi}"`).header('x-content-type-options', 'nosniff').send(r.pdf);
  });
  s.get('/sigorta/rapor/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const sir = await sirketim(o.kullanici);
    if (!UUID.test(id)) return yok(y);
    const r = (await b.db.query(`SELECT u.kimlik, t.rapor_no, v.depo_anahtari FROM belge_uretim u JOIN teknik_rapor t ON t.kimlik::text = u.nesne JOIN belge_surum v ON v.kimlik = u.surum_ref JOIN dosya d ON d.kimlik = u.dosya_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE u.kimlik = $3 AND u.tur = 'Teknik Rapor' AND u.durum = 'Üretildi' AND t.durum = 'Onaylı' AND ${dosyaKosul}`, [sir ?? '', o.kullanici, id])).rows[0];
    if (!r) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge İndirildi', nesneTuru: 'Teknik Rapor', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Sigorta Portalı' });
    return y.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${r.rapor_no}.pdf"`).header('x-content-type-options', 'nosniff').send((b.depo ?? new Depo()).bagla(r.depo_anahtari));
  });

  s.get('/sigorta/teklif/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const sir = await sirketim(o.kullanici);
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT f.kimlik, f.teklif_no, f.surum_no, f.teklif_turu, f.ara_toplam_eur, f.indirim_tutari_eur, f.kdv_tutari_eur, f.genel_toplam_eur, f.gecerlilik_bitis_tarihi::text, f.sigorta_karar_son, f.statu, f.karar, f.bildirilen_sure_gun, d.dosya_no FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE f.kimlik = $3 AND f.teklif_muhatabi = 'Sigorta Şirketi' AND ${dosyaKosul}`, [sir ?? '', o.kullanici, id])).rows[0];
    if (!t) return yok(y);
    // YG-296: maliyet ve firma bağı yoktur; yalnız satış tutarları.
    const kalemler = (await b.db.query(`SELECT sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur, onay_durumu FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 ORDER BY sira_no`, [id])).rows;
    return { ...t, kalemler };
  });

  // YG-438: dosyanın salt okunur ayrıntısı. Aşama tarihleri, sigortaya gönderilmiş teklifler (yalnız satış tutarı), onaylı raporlar ve ilerleme; firma adı ve maliyet yoktur (YG-296).
  s.get('/sigorta/dosya/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const sir = await sirketim(o.kullanici);
    if (!UUID.test(id) || (!sir && !o.grup.startsWith('Sigorta'))) return yok(y);
    const d = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.statu, d.asama, d.ilerleme_yuzdesi, coalesce(d.bildirim_tarihi, d.acilis_tarihi)::text ihbar, d.tahmini_teslim_tarihi::text tahmini_teslim, d.teslim_tarihi::text teslim, d.kapanis_zamani, y.yat_adi, s.sigorta_hasar_dosya_no, s.police_no FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE d.kimlik = $3 AND ${dosyaKosul}`, [sir ?? '', o.kullanici, id])).rows[0];
    if (!d) return yok(y);
    const m = await durum(d);
    const kesif = (await b.db.query(`SELECT min(kesif_tarihi)::text t FROM kesif WHERE dosya_ref = $1 AND durum = 'Tamamlandı'`, [id])).rows[0]?.t ?? null;
    const baslangic = (await b.db.query(`SELECT min(baslangic_tarihi)::text t FROM is_emri WHERE dosya_ref = $1 AND baslangic_tarihi IS NOT NULL`, [id])).rows[0]?.t ?? null;
    const teklifler = (await b.db.query(`SELECT kimlik, teklif_no, surum_no, teklif_turu, statu, karar, genel_toplam_eur, sigorta_karar_son FROM fiyat_teklifi WHERE dosya_ref = $1 AND teklif_muhatabi = 'Sigorta Şirketi' AND statu <> 'Taslak' ORDER BY teklif_no, surum_no`, [id])).rows;
    const raporlar = (await b.db.query(`SELECT u.kimlik, t.rapor_no, t.rapor_turu, u.olusturma_zamani FROM belge_uretim u JOIN teknik_rapor t ON t.kimlik::text = u.nesne WHERE u.dosya_ref = $1 AND u.tur = 'Teknik Rapor' AND u.durum = 'Üretildi' AND t.durum = 'Onaylı' ORDER BY u.olusturma_zamani`, [id])).rows;
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Dosya Görüntülendi', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Sigorta Portalı' });
    return { kimlik: d.kimlik, dosyaNo: d.dosya_no, hasarNo: d.sigorta_hasar_dosya_no, policeNo: d.police_no, yat: d.yat_adi, durum: m.ad, renk: m.renk, ilerleme: Number(d.ilerleme_yuzdesi ?? 0),
      asamalar: [['İhbar', d.ihbar], ['Keşif', kesif], ['Onarım Başlangıcı', baslangic], ['Tahmini Teslim', d.tahmini_teslim], ['Teslim', d.teslim]].map(([ad, tarih]) => ({ ad, tarih })), teklifler, raporlar };
  });

  // YG-1568: seçilen kalemler onaylanır; seçilmeyen onaylanmamış sayılır; ret düğmesi yok. Sürüme bağlıdır (YG-455).
  s.post('/sigorta/teklif/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { siralar?: number[]; surum?: number }; const sir = await sirketim(o.kullanici);
    if (!UUID.test(id)) return yok(y);
    if (!Array.isArray(g.siralar) || !g.siralar.length) return y.code(400).send({ hata: 'En az bir kalem seçiniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      const t = (await c.query(`SELECT f.*, d.statu AS d_statu, d.asama, d.dosya_sorumlusu_ref FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE f.kimlik = $3 AND f.teklif_muhatabi = 'Sigorta Şirketi' AND ${dosyaKosul} FOR UPDATE OF f`, [sir ?? '', o.kullanici, id])).rows[0];
      if (!t) return dur(404, 'Teklif bulunamadı.');
      if (t.statu !== 'Gönderildi') return dur(409, 'Bu teklif karara açık değildir.');
      if (g.surum !== undefined && g.surum !== t.surum_no) return dur(409, 'Teklifin yeni sürümü vardır; güncel sürümü onaylayınız.');
      { // YG-446: görevlendirmede yazılı yetki sınırı aşılıyorsa karar şirketin yazılı onayıyla girilir.
        const ys = (await c.query(`SELECT g.yetki_siniri_eur FROM sigorta_gorevlendirme g JOIN dosya d ON d.talep_ref = g.talep_ref WHERE d.kimlik = $1`, [t.dosya_ref])).rows[0]?.yetki_siniri_eur;
        const top = (await c.query(`SELECT coalesce(sum(tutar_eur), 0)::float n FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND sira_no = ANY($2)`, [t.kimlik, g.siralar])).rows[0].n;
        if (ys != null && top > Number(ys)) return dur(409, 'Onaylanan tutar görevlendirmedeki yetki sınırının üzerindedir; kararın şirketinizin yazılı onayıyla iletilmesini rica ederiz.'); }
      const h = (await c.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
      const r = await kararUygula(c, t, g.siralar, 'YATONET 360', h.ad_soyad, o.kullanici, new Date());
      if (t.dosya_sorumlusu_ref) await bildir(c, { olay: `sigorta-karar:${id}`, kullanicilar: [t.dosya_sorumlusu_ref, t.hazirlayan_ref], baslik: `Sigorta Kararı: ${t.teklif_no}`, ozet: r.karar, eposta: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Portal Kararı', nesneTuru: 'Teklif', nesneKimligi: id, yeni: r, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-446: talimat değişikliği portaldan Talimat ve Karar Kayıtlarına yetkili kaynak olarak düşer; Dosya Sorumlusu bilgilendirilir.
  s.post('/sigorta/dosya/:id/talimat-degisikligi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const sir = await sirketim(o.kullanici); const { metin } = (i.body ?? {}) as { metin?: string };
    if (!UUID.test(id) || !sir) return yok(y);
    const d = (await b.db.query(`SELECT d.dosya_no, d.dosya_sorumlusu_ref, s.sigorta_taraf_ref FROM dosya d LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE d.kimlik = $3 AND ${dosyaKosul}`, [sir, o.kullanici, id])).rows[0];
    if (!d) return yok(y);
    if (!metin?.trim()) return y.code(400).send({ hata: 'Talimat değişikliğini yazmanızı rica ederiz.' });
    const h = (await b.db.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
    const r = (await b.db.query(`INSERT INTO talimat_kaydi (dosya_ref, kanal, tur, gonderen, alinma_zamani, ozgun_metin, aktaran_notu, kaydeden_ref, kaynak_taraf_ref, kaynak_yetkili, aktarim_siniri_saat) VALUES ($1,'Diğer','Talimat',$2,now(),$3,'Sigorta portalı talimat değişikliği',$4,$5,true,0) RETURNING kimlik`, [id, `${h.ad_soyad} (${sir})`, metin.trim(), o.kullanici, d.sigorta_taraf_ref ?? null])).rows[0];
    if (d.dosya_sorumlusu_ref) await bildir(b.db, { olay: `sg-talimat:${r.kimlik}`, kullanicilar: [d.dosya_sorumlusu_ref], baslik: `${d.dosya_no} · Sigorta Talimat Değişikliği`, ozet: metin.trim().slice(0, 300), oncelik: 'Yüksek', eposta: true });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Talimat Değişikliği', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Sigorta Portalı' });
    return { kimlik: r.kimlik };
  });

  s.get('/sigorta/kullanicilarim', oturumlu, async (i, y) => { const sir = await sirketim(i.oturum!.kullanici); if (!sir) return yok(y);
    return { kullanicilar: (await b.db.query(`SELECT h.kimlik, h.ad_soyad FROM sigorta_kullanici s JOIN kullanici_hesabi h ON h.kimlik = s.kullanici_ref WHERE s.sigortaci_adi = $1 AND h.kimlik <> $2 AND h.hesap_durumu = 'Aktif' ORDER BY h.ad_soyad`, [sir, i.oturum!.kullanici])).rows }; });
  // YG-446: şirket kullanıcısı, aynı şirketteki bir kullanıcının hesabının kapatılmasını talep eder; Müşteri ve Paydaş İlişkileri Müdürü değerlendirir.
  s.post('/sigorta/kullanici-kapatma-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const sir = await sirketim(o.kullanici); const g = (i.body ?? {}) as { kullanici?: string; gerekce?: string };
    if (!sir) return yok(y);
    if (!g.kullanici || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Kullanıcıyı ve gerekçeyi yazmanızı rica ederiz.' });
    const k = (await b.db.query(`SELECT h.ad_soyad FROM sigorta_kullanici s JOIN kullanici_hesabi h ON h.kimlik = s.kullanici_ref WHERE s.kullanici_ref = $1 AND s.sigortaci_adi = $2`, [g.kullanici, sir])).rows[0];
    if (!k) return y.code(404).send({ hata: 'Kullanıcı şirketinizde bulunamadı.' });
    await kartAc(b.db, { tur: 'Sigorta Kullanıcısı Kapatma Talebi', kategori: 'islem', baslik: `${sir} · ${k.ad_soyad} Hesap Kapatma Talebi`, ozet: g.gerekce.trim().slice(0, 300), oncelik: 'Yüksek', sahipRol: await rolId(b.db, 'Müşteri ve Paydaş İlişkileri Müdürü'), nesneTuru: 'Kullanıcı', nesneKimligi: g.kullanici });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Kullanıcı Kapatma Talebi', nesneTuru: 'Kullanıcı', nesneKimligi: g.kullanici, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Sigorta Portalı' });
    return { tamam: true };
  });

  // YG-446, YG-448: Sigorta Görevlendirmesi; hasar dosya no zorunlu, poliçe isteğe bağlı. İhbar dosya numarasıyla izlenir, ayrıca yazı gitmez.
  s.post('/sigorta/gorevlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const sir = await sirketim(o.kullanici); const g = (i.body ?? {}) as { hasarNo?: string; policeNo?: string; yatAdi?: string; konum?: string; ozet?: string; sahipAd?: string; sahipTel?: string; yetkili?: string; hizmet?: string; yetkiSiniri?: number; onayKanali?: string };
    if (!sir) return y.code(403).send({ hata: 'Bu işlem sigorta şirketi kullanıcılarına açıktır.' });
    if (!g.hasarNo?.trim()) return y.code(400).send({ hata: 'Hasar dosya numarası zorunludur.' });
    if (!g.yatAdi?.trim() || !g.konum?.trim() || !g.ozet?.trim()) return y.code(400).send({ hata: 'Yat, konum ve olay özeti zorunludur.' });
    if (g.yetkiSiniri !== undefined && !(Number(g.yetkiSiniri) >= 0)) return y.code(400).send({ hata: 'Yetki sınırını EUR olarak girmenizi rica ederiz.' }); // YG-446
    if (g.onayKanali && !['YATONET 360', 'Sözleşmede Tanımlı Kurumsal E-posta'].includes(g.onayKanali)) return y.code(400).send({ hata: 'Onay kanalını listeden seçmenizi rica ederiz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const ilk = (await rolSahipleri(c, await rolId(c, 'Operasyon Müdürü')))[0] ?? o.kullanici;
      const h = (await c.query(`SELECT ad_soyad, cep_telefonu, e_posta FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
      const r = await ihbarKaydet(c, { kanal: 'Portal', sahibiAdi: h.ad_soyad, sahibiTuru: 'Sigorta Şirketi', yetkiDurumu: 'Doğrulandı', telefon: h.cep_telefonu ?? undefined, eposta: h.e_posta ?? undefined, konum: g.konum, yatDurumu: 'Sigorta bildirimi', ihtiyac: [g.ozet.trim(), g.hizmet?.trim() && `İstenen hizmet: ${g.hizmet.trim()}`, g.yetkili?.trim() && `Dosya yetkilisi: ${g.yetkili.trim()}`].filter(Boolean).join(' · '), yat: { adi: g.yatAdi, markaDiger: '', modelDiger: '' }, sigortaci: sir, policeNo: g.policeNo, hasarNo: g.hasarNo.trim(), yatSahibi: g.sahipAd ? { ad: g.sahipAd, telefon: g.sahipTel } : undefined, cevaplar: {} }, o.kullanici, { ilkSorumlu: ilk });
      if ('hata' in r) { await c.query('ROLLBACK'); return y.code(400).send({ hata: r.hata }); }
      await c.query(`INSERT INTO sigorta_gorevlendirme (talep_ref, sigortaci_adi, hasar_no, police_no, dosya_yetkilisi, yetki_siniri_eur, onay_kanali, istenen_hizmet, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [r.kimlik, sir, g.hasarNo.trim(), g.policeNo?.trim() || null, g.yetkili?.trim() || null, g.yetkiSiniri ?? null, g.onayKanali || 'YATONET 360', g.hizmet?.trim() || null, o.kullanici]); // YG-446
      await ihbarAlindiGonder(c, r.kimlik, b.webAdresi);
      await c.query('COMMIT');
      return { talepNo: r.talepNo };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

}
