import { otomatikKabulKontrolu } from './onay_ek.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, disGonder } from './bildirim.js';
import { sigortaAdresiBekleniyor, sigortayaHazirla } from './sigorta_gonderim.js';
import { izYaz } from './denetim.js';
import { statuYaz } from './dosya.js';
import { ihbarAlindiGonder, ihbarKaydet, rolId } from './ihbar.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { metinGetir } from './metin.js';
import { musteriDurumu } from './portal.js';
import { UUID } from './yat.js';

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
  for (const t of rows) {
    const son = new Date(t.sigorta_karar_son);
    if (!t.sigorta_hatirlatma && son.getTime() - simdi.getTime() <= 24 * 3_600_000 && son > simdi) {
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
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Dosya bulunamadı.' });
  const sirketim = async (k: string) => (await b.db.query(`SELECT sigortaci_adi FROM sigorta_kullanici WHERE kullanici_ref = $1`, [k])).rows[0]?.sigortaci_adi as string | undefined;
  const dosyaKosul = `(lower(s.sigortaci_adi) = lower($1) OR EXISTS (SELECT 1 FROM dosya_tarafi e WHERE e.dosya_ref = d.kimlik AND e.taraf_rolu = 'Eksper' AND e.kullanici_ref = $2 AND e.aktif))`;
  const durum = async (d: Record<string, any>) => {
    const bek = (await b.db.query(`SELECT neden FROM beklemede_isareti WHERE dosya_ref = $1 AND kaldirilma_zamani IS NULL`, [d.kimlik])).rows.map((r) => r.neden as string);
    const m = musteriDurumu(d as never, { beklemede: bek });
    return GIZLI_DURUM.includes(m.ad) ? { ad: 'Beklemede', renk: 'kırmızı' } : m;
  };

  // YG-438, YG-1571: yalnız taraf olunan dosyalar; hasar dosya no ve LGM no ayrı. Firma adı hiçbir yerde görünmez (YG-296).
  s.get('/sigorta/ana', oturumlu, async (i, y) => {
    const o = i.oturum!; const sir = await sirketim(o.kullanici);
    if (!sir && !o.grup.startsWith('Sigorta')) return y.code(403).send({ hata: 'Bu sayfa sigorta kullanıcılarına açıktır.' });
    const { rows } = await b.db.query(`SELECT d.kimlik, d.dosya_no, d.statu, d.asama, y.yat_adi, s.sigorta_hasar_dosya_no FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE ${dosyaKosul} ORDER BY d.acilis_tarihi DESC LIMIT 200`, [sir ?? '', o.kullanici]);
    const grn = await (await import('./garanti_sigorta.js')).garantiDurumlari(b.db, rows.map((r) => r.kimlik as string)); // YG-1421
    const dosyalar = []; for (const r of rows) { const m = await durum(r); dosyalar.push({ kimlik: r.kimlik, dosyaNo: r.dosya_no, hasarNo: r.sigorta_hasar_dosya_no, yat: r.yat_adi, durum: m.ad, renk: m.renk, garanti: grn.get(r.kimlik) ?? null }); }
    const bekleyen = (await b.db.query(`SELECT f.kimlik, f.teklif_no, f.surum_no, f.teklif_turu, f.ara_toplam_eur, f.genel_toplam_eur, f.sigorta_karar_son, d.dosya_no FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE f.statu = 'Gönderildi' AND f.teklif_muhatabi = 'Sigorta Şirketi' AND ${dosyaKosul} ORDER BY f.sigorta_karar_son NULLS LAST`, [sir ?? '', o.kullanici])).rows;
    return { dosyalar, bekleyen };
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
      const h = (await c.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
      const r = await kararUygula(c, t, g.siralar, 'YATONET 360', h.ad_soyad, o.kullanici, new Date());
      if (t.dosya_sorumlusu_ref) await bildir(c, { olay: `sigorta-karar:${id}`, kullanicilar: [t.dosya_sorumlusu_ref, t.hazirlayan_ref], baslik: `Sigorta Kararı: ${t.teklif_no}`, ozet: r.karar, eposta: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Portal Kararı', nesneTuru: 'Teklif', nesneKimligi: id, yeni: r, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-446, YG-448: Sigorta Görevlendirmesi; hasar dosya no zorunlu, poliçe isteğe bağlı. İhbar dosya numarasıyla izlenir, ayrıca yazı gitmez.
  s.post('/sigorta/gorevlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const sir = await sirketim(o.kullanici); const g = (i.body ?? {}) as { hasarNo?: string; policeNo?: string; yatAdi?: string; konum?: string; ozet?: string; sahipAd?: string; sahipTel?: string; yetkili?: string; hizmet?: string };
    if (!sir) return y.code(403).send({ hata: 'Bu işlem sigorta şirketi kullanıcılarına açıktır.' });
    if (!g.hasarNo?.trim()) return y.code(400).send({ hata: 'Hasar dosya numarası zorunludur.' });
    if (!g.yatAdi?.trim() || !g.konum?.trim() || !g.ozet?.trim()) return y.code(400).send({ hata: 'Yat, konum ve olay özeti zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const ilk = (await rolSahipleri(c, await rolId(c, 'Operasyon Müdürü')))[0] ?? o.kullanici;
      const h = (await c.query(`SELECT ad_soyad, cep_telefonu, e_posta FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
      const r = await ihbarKaydet(c, { kanal: 'Portal', sahibiAdi: h.ad_soyad, sahibiTuru: 'Sigorta Şirketi', yetkiDurumu: 'Doğrulandı', telefon: h.cep_telefonu ?? undefined, eposta: h.e_posta ?? undefined, konum: g.konum, yatDurumu: 'Sigorta bildirimi', ihtiyac: g.ozet, yat: { adi: g.yatAdi, markaDiger: '', modelDiger: '' }, sigortaci: sir, policeNo: g.policeNo, hasarNo: g.hasarNo.trim(), yatSahibi: g.sahipAd ? { ad: g.sahipAd, telefon: g.sahipTel } : undefined, cevaplar: {} }, o.kullanici, { ilkSorumlu: ilk });
      if ('hata' in r) { await c.query('ROLLBACK'); return y.code(400).send({ hata: r.hata }); }
      await ihbarAlindiGonder(c, r.kimlik, b.webAdresi);
      await c.query('COMMIT');
      return { talepNo: r.talepNo };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

}
