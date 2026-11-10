import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

const SOR = 'İdari İşler Sorumlusu'; const MUD = 'İdari İşler Müdürü'; const TID = 'Ticari İşler Direktörü';
const gunEkle = (d: Date, n: number) => new Date(+d + n * 86_400_000);
const bugun = () => new Date().toISOString().slice(0, 10);

kapanisKaydet('Ofis Sözleşmesi Önerisi', async (c, k, karar) => {
  const s = (await c.query(`SELECT durum FROM ofis_sozlesmesi WHERE kimlik = $1::uuid`, [k.nesne_kimligi])).rows[0]; if (!s) return;
  if (karar === 'Onayla') await c.query(`UPDATE ofis_sozlesmesi SET durum = $2 WHERE kimlik = $1::uuid`, [k.nesne_kimligi, s.durum === 'Yenileme Önerildi' ? 'Yenilendi' : 'Feshedildi']);
  else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') await c.query(`UPDATE ofis_sozlesmesi SET durum = 'Yürürlükte' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
kapanisKaydet('İdari Bütçe', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE idari_butce SET durum = 'Onaylandı' WHERE yil = $1::int AND durum = 'TİD Onayında'`, [k.nesne_kimligi]);
  else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') await c.query(`UPDATE idari_butce SET durum = 'İade Edildi' WHERE yil = $1::int AND durum = 'TİD Onayında'`, [k.nesne_kimligi]);
});

/**
 * YG-1617, YG-1620 uyarıları: sipariş teslim tarihi geçti (Sorumlu), 7 günü geçen teslim (Müdür), ayrılan personelin zimmet iadesi,
 * arızalı kritik cihazda 8 saatte yedek atanmaması, sözleşme bitişine 90/45/15 gün, üç aylık varlık sayımı.
 */
export async function idariUyariIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const sor = await rolId(db, SOR); const mud = await rolId(db, MUD);
  const kart = async (anahtar: string, rol: string, baslik: string, ozet: string, son?: Date) => { if (!(await birKez(db, 'idari-uyari', anahtar))) return; await kartAc(db, { tur: 'İdari Uyarı', kategori: 'gorev', baslik, ozet, oncelik: 'Yüksek', sahipRol: rol, sonZaman: son, nesneTuru: 'İdari Uyarı', nesneKimligi: anahtar }); n++; };
  for (const t of (await db.query(`SELECT kimlik, siparis_no, konu, teslim_plan FROM idari_talep WHERE durum = 'Sipariş Onaylandı' AND teslim_plan < $1::date`, [simdi])).rows) {
    await kart(`teslim:${t.kimlik}`, sor, `${t.siparis_no} · Teslim Tarihi Geçti`, t.konu);
    if (+new Date(t.teslim_plan) + 7 * 86_400_000 < +simdi) await kart(`teslim7:${t.kimlik}`, mud, `${t.siparis_no} · Teslim 7 Günü Geçti`, t.konu);
  }
  for (const z of (await db.query(`SELECT v.kimlik, v.varlik_no, v.ad, h.ad_soyad FROM personel_zimmet z JOIN varlik v ON v.kimlik = z.varlik_ref JOIN kullanici_hesabi h ON h.kimlik = z.personel_ref WHERE z.iade_zamani IS NULL AND (h.hesap_durumu <> 'Aktif' OR EXISTS (SELECT 1 FROM personel_ayrilisi a WHERE a.personel_ref = z.personel_ref))`)).rows)
    await kart(`iade:${z.kimlik}`, sor, `${z.varlik_no} · Ayrılan Personelin Zimmet İadesi`, `${z.ad} · ${z.ad_soyad}`);
  for (const v of (await db.query(`SELECT kimlik, varlik_no, ad, kritik_cihaz FROM varlik WHERE durum = 'Arızalı' AND kritik_cihaz IS NOT NULL AND yedek_ref IS NULL AND ariza_zamani < $1::timestamptz - interval '8 hours'`, [simdi])).rows)
    await kart(`yedek:${v.kimlik}`, mud, `${v.varlik_no} · ${v.kritik_cihaz} İçin Yedek Cihaz Atanmadı`, `${v.ad} arızası 8 saati geçti.`);
  for (const s of (await db.query(`SELECT kimlik, sozlesme_no, karsi_taraf, konu, bitis FROM ofis_sozlesmesi WHERE durum = 'Yürürlükte'`)).rows) {
    const kalan = Math.ceil((+new Date(s.bitis) - +simdi) / 86_400_000);
    for (const e of [15, 45, 90]) if (kalan <= e && kalan > 0) { await kart(`sozlesme:${s.kimlik}:${e}`, mud, `${s.sozlesme_no} · Bitişe ${e} Gün`, `${s.karsi_taraf} · ${s.konu}; yenileme veya fesih önerisini hazırlayınız.`); break; }
  }
  const c = `${simdi.getUTCFullYear()}-Q${Math.floor(simdi.getUTCMonth() / 3) + 1}`;
  if ((await db.query(`SELECT 1 FROM varlik LIMIT 1`)).rowCount) await kart(`sayim:${c}`, sor, `${c} Varlık ve Sarf Sayımı`, 'Üç aylık demirbaş, cihaz ve sarf malzeme sayımını kaydediniz.', gunEkle(simdi, 14));
  return n;
}

export function idariEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  // A30 / A31 özet verisi.
  s.get('/idari-ana', oturumlu, async (i, y) => {
    const k = i.oturum!.kullanici; const sor = await rolVar(k, [SOR]); const mud = await rolVar(k, [MUD]); if (!sor && !mud) return yok(y);
    const q = async (sql: string, p: unknown[] = []) => (await b.db.query(sql, p)).rows;
    return {
      rol: mud ? 'Müdür' : 'Sorumlu',
      yeniTalepler: await q(`SELECT t.kimlik, t.talep_no, t.konu, t.kategori, c.son_zaman FROM idari_talep t LEFT JOIN is_karti c ON c.tur = 'İdari Talep Hazırlığı' AND c.nesne_kimligi = t.kimlik::text AND c.durum = 'Bekliyor' WHERE t.durum = 'İdari İşlerde' ORDER BY c.son_zaman NULLS LAST`),
      iadeEdilenler: await q(`SELECT kimlik, talep_no, konu FROM idari_talep WHERE durum = 'İade Edildi' ORDER BY olusturma_zamani DESC LIMIT 20`),
      mudurde: await q(`SELECT t.kimlik, t.talep_no, t.konu, t.kategori, t.teknik_sart, t.miktar, t.bt_sartname, h.ad_soyad hazirlayan, (SELECT json_agg(json_build_object('sira', f.sira, 'tedarikci', d.ad, 'tutar', f.tutar_eur, 'gecerlilik', f.gecerlilik) ORDER BY f.sira) FROM idari_fiyat_karti f JOIN idari_tedarikci d ON d.kimlik = f.tedarikci_ref WHERE f.talep_ref = t.kimlik) kartlar FROM idari_talep t LEFT JOIN kullanici_hesabi h ON h.kimlik = t.hazirlayan_ref WHERE t.durum = 'Müdürde'`),
      siparisler: await q(`SELECT t.kimlik, t.siparis_no, t.konu, t.durum, t.siparis_tutar_eur, t.teslim_plan::text, t.irsaliye_no, t.fatura_no, t.eslesme, d.ad tedarikci FROM idari_talep t LEFT JOIN idari_tedarikci d ON d.kimlik = t.tedarikci_ref WHERE t.siparis_no IS NOT NULL ORDER BY t.olusturma_zamani DESC LIMIT 50`),
      tedarikciler: await q(`SELECT kimlik, ad, vergi_no, iletisim, iban, iban_onayli, durum FROM idari_tedarikci ORDER BY ad`),
      varliklar: await q(`SELECT v.kimlik, v.varlik_no, v.tur, v.ad, v.durum, v.kritik_cihaz, v.ariza_zamani, y.varlik_no yedek, h.ad_soyad zimmetli FROM varlik v LEFT JOIN varlik y ON y.kimlik = v.yedek_ref LEFT JOIN personel_zimmet z ON z.varlik_ref = v.kimlik AND z.iade_zamani IS NULL LEFT JOIN kullanici_hesabi h ON h.kimlik = z.personel_ref ORDER BY v.varlik_no`),
      sarf: await q(`SELECT kimlik, ad, birim, miktar, kritik_seviye, miktar <= kritik_seviye kritik FROM sarf_malzeme ORDER BY ad`),
      sozlesmeler: mud ? await q(`SELECT kimlik, sozlesme_no, karsi_taraf, konu, baslangic::text, bitis::text, yillik_tutar_eur, durum, (bitis - current_date) kalan FROM ofis_sozlesmesi ORDER BY bitis`) : [],
      butce: mud ? await q(`SELECT kimlik, yil, kalem, tutar_eur, durum FROM idari_butce ORDER BY yil DESC, kalem`) : [],
      uyarilar: await q(`SELECT c.kimlik, c.baslik, c.ozet, c.son_zaman FROM is_karti c WHERE c.tur = 'İdari Uyarı' AND c.durum = 'Bekliyor' AND c.sahip_rol_ref = $1 ORDER BY c.olusturma_zamani DESC`, [await rolId(b.db, mud ? MUD : SOR)]),
    };
  });

  // YG-1617: satın alma talebi teknik şart, miktar ve en az bir fiyat kartıyla Müdüre gider; siparişe dönüştürme Müdürdedir.
  s.post('/idari-talep/:id/satin-alma', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kategori?: string; teknikSart?: string; miktar?: number; kartlar?: { tedarikci?: string; tutar?: number; gecerlilik?: string }[] };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [SOR]))) return yok(y);
    const t = (await b.db.query(`SELECT talep_no, konu, durum FROM idari_talep WHERE kimlik = $1`, [id])).rows[0]; if (!t) return yok(y);
    if (t.durum !== 'İdari İşlerde') return y.code(409).send({ hata: 'Talep satın alma aşamasında değildir.' });
    const kartlar = Array.isArray(g.kartlar) ? g.kartlar : [];
    if (!g.teknikSart?.trim() || !(Number(g.miktar) > 0) || !kartlar.length) return y.code(400).send({ hata: 'Teknik şart, miktar ve en az bir fiyat kartı zorunludur.' });
    for (const k of kartlar) if (!k.tedarikci || !UUID.test(k.tedarikci) || !(Number(k.tutar) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(k.gecerlilik ?? '')) return y.code(400).send({ hata: 'Her fiyat kartında tedarikçi, tutar ve geçerlilik tarihi zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`DELETE FROM idari_fiyat_karti WHERE talep_ref = $1`, [id]);
      for (const [n, k] of kartlar.entries()) await c.query(`INSERT INTO idari_fiyat_karti (talep_ref, sira, tedarikci_ref, tutar_eur, gecerlilik) VALUES ($1,$2,$3,$4,$5)`, [id, n + 1, k.tedarikci, Number(k.tutar), k.gecerlilik]);
      await c.query(`UPDATE idari_talep SET durum = 'Müdürde', kategori = $2, teknik_sart = $3, miktar = $4, hazirlayan_ref = $5, satin_alma_zamani = now() WHERE kimlik = $1`, [id, g.kategori === 'Bilgi Teknolojisi' ? 'Bilgi Teknolojisi' : 'Genel', g.teknikSart.trim(), Number(g.miktar), o.kullanici]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'İdari Talep Hazırlığı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      await kartAc(c, { tur: 'İdari Sipariş Hazırlama', kategori: 'gorev', baslik: `${t.talep_no} · ${t.konu}`, ozet: `${kartlar.length} fiyat kartı`, sahipRol: await rolId(c, MUD), nesneTuru: 'İdari Talep', nesneKimligi: id });
      if (g.kategori === 'Bilgi Teknolojisi') await kartAc(c, { tur: 'BT Teknik Şartnamesi', kategori: 'gorev', baslik: `${t.talep_no} · Teknik Şartname`, ozet: g.teknikSart.trim().slice(0, 200), sahipRol: await rolId(c, 'Bilgi İşlem Müdürü'), nesneTuru: 'İdari Talep', nesneKimligi: id });
      await c.query('COMMIT');
      return { durum: 'Müdürde' };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
  s.post('/idari-talep/:id/bt-sartname', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sartname?: string };
    if (!UUID.test(id) || !(await rolVar(i.oturum!.kullanici, ['Bilgi İşlem Müdürü']))) return yok(y);
    if (!g.sartname?.trim()) return y.code(400).send({ hata: 'Şartnameyi yazınız.' });
    await b.db.query(`UPDATE idari_talep SET bt_sartname = $2 WHERE kimlik = $1`, [id, g.sartname.trim()]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'BT Teknik Şartnamesi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    return { tamam: true };
  });
  s.post('/idari-talep/:id/mudur-iade', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gerekce?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [MUD]))) return yok(y);
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    const r = await b.db.query(`UPDATE idari_talep SET durum = 'İdari İşlerde' WHERE kimlik = $1 AND durum = 'Müdürde' RETURNING talep_no, konu`, [id]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Talep Müdürde değildir.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'İdari Sipariş Hazırlama' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await kartAc(b.db, { tur: 'İdari Talep Hazırlığı', kategori: 'gorev', baslik: `${r.rows[0].talep_no} · İade: ${r.rows[0].konu}`, ozet: g.gerekce.trim().slice(0, 200), sahipRol: await rolId(b.db, SOR), nesneTuru: 'İdari Talep', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İdari Talep İadesi', nesneTuru: 'İdari Talep', nesneKimligi: id, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // Teslim: irsaliye ve fatura siparişle eşleştirilir.
  s.post('/idari-talep/:id/teslim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { irsaliye?: string; fatura?: string; faturaTutar?: number };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [SOR]))) return yok(y);
    const t = (await b.db.query(`SELECT durum, siparis_tutar_eur FROM idari_talep WHERE kimlik = $1`, [id])).rows[0]; if (!t) return yok(y);
    if (t.durum !== 'Sipariş Onaylandı') return y.code(409).send({ hata: 'Onaylı sipariş değildir.' });
    if (!g.irsaliye?.trim() || !g.fatura?.trim() || !(Number(g.faturaTutar) > 0)) return y.code(400).send({ hata: 'İrsaliye no, fatura no ve fatura tutarı zorunludur.' });
    const es = Math.abs(Number(g.faturaTutar) - Number(t.siparis_tutar_eur)) < 0.005 ? 'Eşleşti' : 'Fark Var';
    await b.db.query(`UPDATE idari_talep SET durum = 'Teslim Alındı', teslim_zamani = now(), irsaliye_no = $2, fatura_no = $3, fatura_tutar_eur = $4, eslesme = $5 WHERE kimlik = $1`, [id, g.irsaliye.trim(), g.fatura.trim(), Number(g.faturaTutar), es]);
    if (es === 'Fark Var') await bildir(b.db, { olay: `idari-fark:${id}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, MUD)), baslik: 'İdari Sipariş Fatura Farkı', ozet: `Sipariş ${t.siparis_tutar_eur} EUR, fatura ${Number(g.faturaTutar)} EUR`, oncelik: 'Yüksek' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'İdari Uyarı' AND nesne_kimligi LIKE $1 AND durum = 'Bekliyor'`, [`teslim%:${id}`]);
    return { eslesme: es };
  });
  // İdari tedarikçi listesi; IBAN değişikliği Muhasebe ve Finans onayına gider.
  s.post('/idari-tedarikci', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, [SOR, MUD]))) return yok(y);
    const g = (i.body ?? {}) as { kimlik?: string; ad?: string; vergiNo?: string; iletisim?: string; iban?: string };
    if (!g.ad?.trim()) return y.code(400).send({ hata: 'Tedarikçi adı zorunludur.' });
    const iban = g.iban?.replace(/\s/g, '').toUpperCase() || null; if (iban && !/^TR\d{24}$/.test(iban)) return y.code(400).send({ hata: 'IBAN TR ile başlayan 26 karakter olmalıdır.' });
    const eski = g.kimlik && UUID.test(g.kimlik) ? (await b.db.query(`SELECT iban FROM idari_tedarikci WHERE kimlik = $1`, [g.kimlik])).rows[0] : null;
    const k = eski ? (await b.db.query(`UPDATE idari_tedarikci SET ad = $2, vergi_no = $3, iletisim = $4, iban = $5, iban_onayli = CASE WHEN $5 IS DISTINCT FROM iban THEN false ELSE iban_onayli END WHERE kimlik = $1 RETURNING kimlik`, [g.kimlik, g.ad.trim(), g.vergiNo?.trim() || null, g.iletisim?.trim() || null, iban])).rows[0].kimlik
      : (await b.db.query(`INSERT INTO idari_tedarikci (ad, vergi_no, iletisim, iban, giren_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.ad.trim(), g.vergiNo?.trim() || null, g.iletisim?.trim() || null, iban, o.kullanici])).rows[0].kimlik;
    if (iban && (!eski || eski.iban !== iban)) await kartAc(b.db, { tur: 'Tedarikçi Banka Hesabı Teyidi', kategori: 'gorev', baslik: `${g.ad.trim()} · Banka Hesabı ${eski ? 'Değişikliği' : 'Kaydı'}`, ozet: 'Hesabı tedarikçiden bağımsız kanalla teyit edip onaylayınız.', oncelik: 'Yüksek', sahipRol: await rolId(b.db, 'Muhasebe ve Finans Müdürü'), nesneTuru: 'İdari Tedarikçi', nesneKimligi: k });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İdari Tedarikçi', nesneTuru: 'İdari Tedarikçi', nesneKimligi: k, eski: eski ? { iban: eski.iban } : null, yeni: { iban }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: k };
  });
  s.post('/idari-tedarikci/:id/iban-onay', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolVar(i.oturum!.kullanici, ['Muhasebe ve Finans Müdürü']))) return yok(y);
    await b.db.query(`UPDATE idari_tedarikci SET iban_onayli = true WHERE kimlik = $1`, [id]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Tedarikçi Banka Hesabı Teyidi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    return { tamam: true };
  });
  // Kayıp cihaz: 1 saat içinde Bilgi İşlem Müdürü ve Hukuk ve Uyum Direktörüne veri ihlali değerlendirmesi düşer.
  s.post('/varlik/:id/kayip', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { aciklama?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [SOR, MUD]))) return yok(y);
    if (!g.aciklama?.trim()) return y.code(400).send({ hata: 'Kayıp açıklaması zorunludur.' });
    const v = (await b.db.query(`UPDATE varlik SET durum = 'Kayıp' WHERE kimlik = $1 AND durum <> 'Kayıp' RETURNING varlik_no, tur, ad`, [id])).rows[0]; if (!v) return y.code(409).send({ hata: 'Varlık bulunamadı veya kayıp işaretli.' });
    await b.db.query(`UPDATE personel_zimmet SET iade_zamani = now(), iade_alan_ref = $2 WHERE varlik_ref = $1 AND iade_zamani IS NULL`, [id, o.kullanici]);
    if (v.tur === 'Cihaz') for (const r of ['Bilgi İşlem Müdürü', 'Hukuk ve Uyum Direktörü']) await kartAc(b.db, { tur: 'Kayıp Cihaz Veri İhlali Bildirimi', kategori: 'gorev', baslik: `${v.varlik_no} · Kayıp Cihaz: ${v.ad}`, ozet: g.aciklama.trim().slice(0, 200), oncelik: 'Kritik', sahipRol: await rolId(b.db, r), sonZaman: new Date(Date.now() + 3_600_000), nesneTuru: 'Varlık', nesneKimligi: `${id}:${r}` });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Varlık Kayıp', nesneTuru: 'Varlık', nesneKimligi: id, gerekce: g.aciklama.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true, ihlalBildirimi: v.tur === 'Cihaz' };
  });
  s.post('/varlik/:id/ariza', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kritik?: string; yedek?: string; giderildi?: boolean };
    if (!UUID.test(id) || !(await rolVar(i.oturum!.kullanici, [SOR, MUD]))) return yok(y);
    if (g.giderildi) { await b.db.query(`UPDATE varlik SET durum = CASE WHEN EXISTS (SELECT 1 FROM personel_zimmet z WHERE z.varlik_ref = varlik.kimlik AND z.iade_zamani IS NULL) THEN 'Zimmette' ELSE 'Depoda' END, ariza_zamani = NULL, yedek_ref = NULL WHERE kimlik = $1`, [id]); return { tamam: true }; }
    if (g.yedek && !UUID.test(g.yedek)) return y.code(400).send({ hata: 'Yedek cihazı seçiniz.' });
    await b.db.query(`UPDATE varlik SET durum = 'Arızalı', ariza_zamani = coalesce(ariza_zamani, now()), kritik_cihaz = coalesce($2, kritik_cihaz), yedek_ref = coalesce($3, yedek_ref) WHERE kimlik = $1`, [id, g.kritik === 'Nöbet Telefonu' || g.kritik === 'İhbar Dizüstü' ? g.kritik : null, g.yedek ?? null]);
    return { tamam: true };
  });
  s.post('/varlik/sayim', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, [SOR]))) return yok(y);
    const g = (i.body ?? {}) as { donem?: string; varliklar?: { kimlik: string; sonuc: string }[]; sarf?: { kimlik: string; miktar: number }[] };
    if (!/^\d{4}-Q[1-4]$/.test(g.donem ?? '')) return y.code(400).send({ hata: 'Dönemi seçiniz.' });
    for (const v of g.varliklar ?? []) if (UUID.test(v.kimlik) && ['Bulundu', 'Bulunamadı', 'Hasarlı'].includes(v.sonuc)) await b.db.query(`INSERT INTO varlik_sayim (donem, varlik_ref, sonuc, sayan_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (donem, varlik_ref) DO UPDATE SET sonuc = EXCLUDED.sonuc, sayan_ref = EXCLUDED.sayan_ref, zaman = now()`, [g.donem, v.kimlik, v.sonuc, o.kullanici]);
    for (const m of g.sarf ?? []) { if (!UUID.test(m.kimlik) || !(Number(m.miktar) >= 0)) continue; const r = (await b.db.query(`SELECT miktar FROM sarf_malzeme WHERE kimlik = $1`, [m.kimlik])).rows[0]; if (!r) continue; const fark = Number(m.miktar) - Number(r.miktar); if (fark) { await b.db.query(`UPDATE sarf_malzeme SET miktar = $2 WHERE kimlik = $1`, [m.kimlik, Number(m.miktar)]); await b.db.query(`INSERT INTO sarf_hareket (malzeme_ref, tur, miktar, aciklama, yapan_ref) VALUES ($1,'Sayım Düzeltmesi',$2,$3,$4)`, [m.kimlik, fark, g.donem, o.kullanici]); } }
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'İdari Uyarı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [`sayim:${g.donem}`]);
    const kayip = Number((await b.db.query(`SELECT count(*) n FROM varlik_sayim WHERE donem = $1 AND sonuc = 'Bulunamadı'`, [g.donem])).rows[0].n);
    if (kayip) await bildir(b.db, { olay: `sayim-fark:${g.donem}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, MUD)), baslik: `${g.donem} Sayımında Bulunamayan Varlık: ${kayip}`, oncelik: 'Yüksek' });
    return { tamam: true, bulunamayan: kayip };
  });
  s.post('/sarf', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, [SOR, MUD]))) return yok(y);
    const g = (i.body ?? {}) as { ad?: string; birim?: string; kritik?: number; kimlik?: string; tur?: string; miktar?: number; aciklama?: string };
    if (g.kimlik) {
      if (!UUID.test(g.kimlik) || (g.tur !== 'Giriş' && g.tur !== 'Çıkış') || !(Number(g.miktar) > 0)) return y.code(400).send({ hata: 'Hareket türü ve pozitif miktar zorunludur.' });
      const d = g.tur === 'Giriş' ? Number(g.miktar) : -Number(g.miktar);
      const r = await b.db.query(`UPDATE sarf_malzeme SET miktar = miktar + $2 WHERE kimlik = $1 AND miktar + $2 >= 0 RETURNING ad, miktar, kritik_seviye`, [g.kimlik, d]);
      if (!r.rowCount) return y.code(409).send({ hata: 'Stok yetersiz.' });
      await b.db.query(`INSERT INTO sarf_hareket (malzeme_ref, tur, miktar, aciklama, yapan_ref) VALUES ($1,$2,$3,$4,$5)`, [g.kimlik, g.tur, d, g.aciklama?.trim() || null, o.kullanici]);
      return { miktar: Number(r.rows[0].miktar), kritik: Number(r.rows[0].miktar) <= Number(r.rows[0].kritik_seviye) };
    }
    if (!g.ad?.trim() || !g.birim?.trim()) return y.code(400).send({ hata: 'Ad ve birim zorunludur.' });
    return { kimlik: (await b.db.query(`INSERT INTO sarf_malzeme (ad, birim, kritik_seviye) VALUES ($1,$2,$3) RETURNING kimlik`, [g.ad.trim(), g.birim.trim(), Number(g.kritik) || 0])).rows[0].kimlik };
  });
  // YG-1620: ofis hizmet sözleşmeleri LGM-SZ-NNNN; yenileme veya fesih önerisi TİD'e gider.
  s.post('/ofis-sozlesmesi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, [MUD]))) return yok(y);
    const g = (i.body ?? {}) as { karsiTaraf?: string; konu?: string; baslangic?: string; bitis?: string; tutar?: number };
    if (!g.karsiTaraf?.trim() || !g.konu?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(g.baslangic ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(g.bitis ?? '') || g.bitis! <= g.baslangic!) return y.code(400).send({ hata: 'Karşı taraf, konu, başlangıç ve bitiş zorunludur.' });
    const no = `LGM-SZ-${String(await sayac(b.db, 'ofis_sozlesmesi')).padStart(4, '0')}`;
    const k = (await b.db.query(`INSERT INTO ofis_sozlesmesi (sozlesme_no, karsi_taraf, konu, baslangic, bitis, yillik_tutar_eur, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [no, g.karsiTaraf.trim(), g.konu.trim(), g.baslangic, g.bitis, Number(g.tutar) || null, o.kullanici])).rows[0].kimlik;
    return { kimlik: k, no };
  });
  s.post('/ofis-sozlesmesi/:id/oneri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { oneri?: string; gerekce?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [MUD]))) return yok(y);
    if ((g.oneri !== 'Yenileme' && g.oneri !== 'Fesih') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Öneri ve gerekçe zorunludur.' });
    const s2 = (await b.db.query(`UPDATE ofis_sozlesmesi SET durum = $2, oneri_gerekcesi = $3 WHERE kimlik = $1 AND durum = 'Yürürlükte' RETURNING sozlesme_no, karsi_taraf`, [id, g.oneri === 'Yenileme' ? 'Yenileme Önerildi' : 'Fesih Önerildi', g.gerekce.trim()])).rows[0];
    if (!s2) return y.code(409).send({ hata: 'Sözleşme yürürlükte değildir.' });
    await kartAc(b.db, { tur: 'Ofis Sözleşmesi Önerisi', baslik: `${s2.sozlesme_no} · ${g.oneri} Önerisi: ${s2.karsi_taraf}`, ozet: g.gerekce.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(b.db, TID)], nesneTuru: 'Ofis Sözleşmesi', nesneKimligi: id });
    return { tamam: true };
  });
  s.post('/idari-butce', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, [MUD]))) return yok(y);
    const g = (i.body ?? {}) as { yil?: number; kalemler?: { kalem: string; tutar: number }[]; gonder?: boolean };
    const yil = Number(g.yil); if (!(yil >= 2026)) return y.code(400).send({ hata: 'Yılı giriniz.' });
    for (const k of g.kalemler ?? []) { if (!k.kalem?.trim() || !(Number(k.tutar) >= 0)) return y.code(400).send({ hata: 'Kalem ve tutar zorunludur.' }); await b.db.query(`INSERT INTO idari_butce (yil, kalem, tutar_eur, giren_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (yil, kalem) DO UPDATE SET tutar_eur = EXCLUDED.tutar_eur, durum = CASE WHEN idari_butce.durum = 'Onaylandı' THEN 'Onaylandı' ELSE 'Taslak' END`, [yil, k.kalem.trim(), Number(k.tutar), o.kullanici]); }
    if (g.gonder) {
      const t = (await b.db.query(`UPDATE idari_butce SET durum = 'TİD Onayında' WHERE yil = $1 AND durum IN ('Taslak', 'İade Edildi') RETURNING tutar_eur`, [yil])).rows;
      if (!t.length) return y.code(409).send({ hata: 'Gönderilecek bütçe kalemi yoktur.' });
      await kartAc(b.db, { tur: 'İdari Bütçe', baslik: `${yil} İdari Bütçe`, ozet: `${t.length} kalem · ${t.reduce((a, x) => a + Number(x.tutar_eur), 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} EUR`, hazirlayan: o.kullanici, zincir: [await rolId(b.db, TID)], nesneTuru: 'İdari Bütçe', nesneKimligi: String(yil) });
    }
    return { tamam: true };
  });
}
