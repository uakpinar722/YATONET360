import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { belgeBagiKaydet } from './belge.js';
import { belgeUret } from './belge_uret.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy, tutar } from './metin.js';
import { altNumara } from './sure.js';
import { parasalZincir, parametre, sonMakam } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const MFM = 'Muhasebe ve Finans Müdürü'; const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
const AYRI_TURLER = ['Acil Tedbir', 'Keşif Söküm-Montaj', 'Bekleme ve Muhafaza'];
const TALEP_TURU: Record<string, string> = { 'Acil Tedbir': 'Acil Tedbir Bedeli', 'Keşif Söküm-Montaj': 'Ara Ödeme', 'Bekleme ve Muhafaza': 'Ara Ödeme' };

const mfmMi = async (db: Db, k: string) => Boolean((await db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2 LIMIT 1`, [k, MFM])).rowCount);
// Dayanak belgeyi yalnız Muhasebe ve Finans Müdürü yükler ve görür; bağ kimliği sigorta şirketi adı veya taraf numarasıdır.
belgeBagiKaydet('Vergi Dayanağı', async (db, k) => (await mfmMi(db, k) ? 'tamam' : 'yetkisiz'));

export interface KdvSonucu { durum: 'Standart KDV' | 'KDV tevkifatlı' | 'KDV istisnası'; tevkifat: { pay: number; payda: number } | null }

/** YG-878, YG-879, YG-881: KDV durumu kullanıcıdan alınmaz. Sigortaya kesilen faturada istisna yoktur; profil yoksa Standart KDV; istisna yazısı yoksa veya süresi geçtiyse Standart KDV. */
export async function kdvBelirle(db: Db, dosya: string, muhatap: string, tarih = new Date()): Promise<KdvSonucu> {
  const gun = tarih.toISOString().slice(0, 10);
  if (muhatap === 'Sigorta Şirketi') {
    const p = (await db.query(`SELECT p.kdv_uygulamasi, p.tevkifat_pay, p.tevkifat_payda FROM dosya_sigorta_kaydi s JOIN sigorta_vergi_profili p ON p.sigortaci_adi = s.sigortaci_adi WHERE s.dosya_ref = $1 AND p.yururluk <= $2::date ORDER BY p.yururluk DESC LIMIT 1`, [dosya, gun])).rows[0];
    return p?.kdv_uygulamasi === 'KDV tevkifatlı' ? { durum: 'KDV tevkifatlı', tevkifat: { pay: p.tevkifat_pay, payda: p.tevkifat_payda } } : { durum: 'Standart KDV', tevkifat: null };
  }
  const t = (await db.query(`SELECT t.kdv_istisna_belge_ref, t.kdv_istisna_bitis FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref JOIN taraf t ON t.kimlik = y.yat_sahibi_ref WHERE d.kimlik = $1 AND t.kdv_istisna_belge_ref IS NOT NULL AND t.kdv_istisna_bitis >= $2::date`, [dosya, gun])).rows[0];
  return t ? { durum: 'KDV istisnası', tevkifat: null } : { durum: 'Standart KDV', tevkifat: null };
}

/** İstisnada KDV yalnız parça ve malzemeden hesaplanır (YG-881); tevkifat KDV'den ayrılır, tahsil edilecek tutardan düşer. */
export function kdvHesapla(matrah: number, malzemeMatrahi: number, oran: number, s: KdvSonucu) {
  const taban = s.durum === 'KDV istisnası' ? R2(Math.min(malzemeMatrahi, matrah)) : matrah;
  const kdv = R2((taban * oran) / 100);
  const tevkifat = s.tevkifat ? R2((kdv * s.tevkifat.pay) / s.tevkifat.payda) : 0;
  return { taban, kdv, tevkifat, toplam: R2(matrah + kdv - tevkifat) };
}

export function vergiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, rol: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2 LIMIT 1`, [k, rol])).rowCount);
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };

  // YG-879: profil o şirketin faturalarına kendiliğinden uygulanır; değişiklik yalnız yürürlük tarihinden sonrakilere; eski profil silinmez.
  s.get('/sigorta-vergi-profili', oturumlu, async (i, y) => {
    if (!(await mfmMi(b.db, i.oturum!.kullanici))) return yok(y);
    return (await b.db.query(`SELECT sigortaci_adi, kdv_uygulamasi, tevkifat_pay, tevkifat_payda, yururluk::text FROM sigorta_vergi_profili ORDER BY sigortaci_adi, yururluk DESC`)).rows;
  });
  s.post('/sigorta-vergi-profili', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { sigortaci?: string; uygulama?: string; pay?: number; payda?: number; yururluk?: string; belge?: string };
    if (!(await mfmMi(b.db, o.kullanici))) return y.code(403).send({ hata: 'Vergi profilini Muhasebe ve Finans Müdürü kaydeder.' });
    if (!g.sigortaci?.trim() || !g.yururluk || !['Standart KDV', 'KDV tevkifatlı'].includes(g.uygulama ?? '')) return y.code(400).send({ hata: 'Sigorta şirketi, KDV uygulaması ve yürürlük tarihini girmenizi rica ederiz.' });
    if (g.uygulama === 'KDV tevkifatlı' && !(Number(g.pay) > 0 && Number(g.payda) > 0 && Number(g.pay) <= Number(g.payda))) return y.code(400).send({ hata: 'Tevkifat oranını pay ve payda olarak girmenizi rica ederiz.' });
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Mali müşavir görüşü veya özelge olmadan profil kaydedilmez.' });
    const v = g.uygulama === 'KDV tevkifatlı';
    const r = await b.db.query(`INSERT INTO sigorta_vergi_profili (sigortaci_adi, kdv_uygulamasi, tevkifat_pay, tevkifat_payda, yururluk, dayanak_belge_ref, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (sigortaci_adi, yururluk) DO NOTHING RETURNING kimlik`, [g.sigortaci.trim(), g.uygulama, v ? g.pay : null, v ? g.payda : null, g.yururluk, g.belge, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu yürürlük tarihiyle profil kayıtlıdır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Vergi Profili', nesneTuru: 'Sigorta Vergi Profili', nesneKimligi: r.rows[0].kimlik, yeni: { sigortaci: g.sigortaci, uygulama: g.uygulama, yururluk: g.yururluk }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.rows[0].kimlik };
  });

  // YG-881: istisna yazısı ve bitiş tarihi; süre dolunca kdvBelirle istisnayı uygulamaz.
  s.post('/taraf-kdv-istisna', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tarafNo?: string; belge?: string; bitis?: string };
    if (!(await mfmMi(b.db, o.kullanici))) return y.code(403).send({ hata: 'İstisna yazısını Muhasebe ve Finans Müdürü kaydeder.' });
    if (!g.tarafNo?.trim() || !g.bitis || !g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Taraf no, istisna yazısı ve geçerlilik bitişini girmenizi rica ederiz.' });
    const r = await b.db.query(`UPDATE taraf SET kdv_istisna_belge_ref = $2, kdv_istisna_bitis = $3 WHERE taraf_no = $1 RETURNING kimlik`, [g.tarafNo.trim(), g.belge, g.bitis]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Bu numarada taraf kaydı bulunamadı.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'KDV İstisna Yazısı', nesneTuru: 'Taraf', nesneKimligi: r.rows[0].kimlik, yeni: { bitis: g.bitis }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-864, YG-1487: sigortasız dosyada keşif ücreti Ödeme Talebi; bölge dışında ulaşım ve konaklama gerçek tutarla eklenir.
  s.post('/dosya/:id/kesif-ucreti', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { bolgeDisi?: number; sonTarih?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await rolVar(o.kullanici, TICARI))) return y.code(403).send({ hata: 'Keşif Ücreti talebini Ticari Sorumlu hazırlar.' });
    const d = (await b.db.query(`SELECT dosya_no, dosya_niteligi FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (d.dosya_niteligi === 'Sigorta bağlantılı') return y.code(409).send({ hata: 'Sigortanın yaptırdığı keşif sigorta şirketine faturalanır.' });
    if (!g.sonTarih) return y.code(400).send({ hata: 'Son ödeme tarihini girmenizi rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM odeme_talebi WHERE dosya_ref = $1 AND tur = 'Keşif Ücreti' AND durum <> 'Reddedildi' LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Bu dosyada Keşif Ücreti talebi bulunmaktadır.' });
    const tut = R2(await parametre(b.db, 'kesif_ucreti_eur') + (Number(g.bolgeDisi) > 0 ? Number(g.bolgeDisi) : 0));
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO odeme_talebi (dosya_ref, tur, tutar_eur, muhatap, son_tarih, hazirlayan_ref) VALUES ($1,'Keşif Ücreti',$2,'Yat Sahibi',$3,$4) RETURNING kimlik`, [id, tut, g.sonTarih, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Ödeme Talebi', baslik: `${d.dosya_no} · Keşif Ücreti`, ozet: `${tutar(tut)} EUR`, hazirlayan: o.kullanici, zincir: await parasalZincir(c, [MFM], await sonMakam(c, tut)), nesneTuru: 'Ödeme Talebi', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, tutar: tut };
    });
  });

  // YG-865: sigortanın yaptırdığı keşfin bedeli, teklif reddedilse de proformayla sigortaya faturalanır; tutar Ek-1 mutabakatındandır.
  s.post('/dosya/:id/kesif-faturasi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tutar?: number };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await rolVar(o.kullanici, TICARI))) return y.code(403).send({ hata: 'Proformayı Ticari Sorumlu hazırlar.' });
    const d = (await b.db.query(`SELECT d.dosya_no, d.dosya_niteligi, s.sigorta_hasar_dosya_no FROM dosya d LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE d.kimlik = $1`, [id])).rows[0];
    if (d.dosya_niteligi !== 'Sigorta bağlantılı') return y.code(409).send({ hata: 'Bu dosya sigorta bağlantılı değildir.' });
    if (!d.sigorta_hasar_dosya_no) return y.code(409).send({ hata: 'Sigortaya fatura için Hasar dosya numarası bekleniyor.' });
    if (!(Number(g.tutar) > 0)) return y.code(400).send({ hata: 'Keşif bedelini girmenizi rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM musteri_faturasi WHERE dosya_ref = $1 AND aciklama = 'Keşif Bedeli' AND durum <> 'Reddedildi'`, [id])).rowCount) return y.code(409).send({ hata: 'Bu dosyada keşif bedeli proforması bulunmaktadır.' });
    const oran = await parametre(b.db, 'kdv_orani'); const s0 = await kdvBelirle(b.db, id, 'Sigorta Şirketi'); const h = kdvHesapla(Number(g.tutar), 0, oran, s0);
    return islem(async (c) => {
      const no = await altNumara(c, d.dosya_no, 'OT');
      const r = (await c.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, kdv_durumu, kdv_orani, kdv_matrahi_eur, tevkifat_orani, tevkifat_eur, aciklama, hazirlayan_ref) VALUES ($1,$2,'Sigorta Şirketi',$3,$4,$5,$6,$7,$8,$9,$10,'Keşif Bedeli',$11) RETURNING kimlik`, [no, id, g.tutar, h.kdv, h.toplam, s0.durum, oran, h.taban, s0.tevkifat ? `${s0.tevkifat.pay}/${s0.tevkifat.payda}` : null, h.tevkifat, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Proforma', baslik: `${no} · Keşif Bedeli Proforması`, ozet: `${tutar(Number(g.tutar))} EUR (KDV hariç)`, hazirlayan: o.kullanici, zincir: await parasalZincir(c, [MFM], await sonMakam(c, Number(g.tutar))), nesneTuru: 'Fatura', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, proformaNo: no };
    });
  });

  // YG-894, YG-896: acil tedbir, keşif söküm-montaj ve bekleme bedelleri ayrı tutulur; sigorta ödemezse yat sahibine kendiliğinden aktarılır (BLD-30, FR-TIC-013).
  s.post('/dosya/:id/ayri-kalem', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; aciklama?: string; tutar?: number };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!AYRI_TURLER.includes(g.tur ?? '') || !g.aciklama?.trim() || !(Number(g.tutar) > 0)) return y.code(400).send({ hata: 'Tür, açıklama ve tutarı girmenizi rica ederiz.' });
    const r = await b.db.query(`INSERT INTO odeme_sorumlulugu_kalemi (dosya_ref, tur, aciklama, tutar_eur, giren_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, g.tur, g.aciklama.trim(), g.tutar, o.kullanici]);
    return { kimlik: r.rows[0].kimlik };
  });
  s.post('/ayri-kalem/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; sonTarih?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT k.*, d.dosya_no, d.yazisma_dili, d.vefat_isareti FROM odeme_sorumlulugu_kalemi k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (!(await rolVar(o.kullanici, 'Dosya Sorumlusu'))) return y.code(403).send({ hata: 'Sigorta kararını Dosya Sorumlusu girer.' });
    if (k.durum !== 'Sigorta Kararı Bekleniyor') return y.code(409).send({ hata: 'Bu kalem sonuçlanmıştır.' });
    if (g.karar === 'Sigorta Öder') { await b.db.query(`UPDATE odeme_sorumlulugu_kalemi SET durum = 'Sigorta Öder' WHERE kimlik = $1`, [id]); return { durum: 'Sigorta Öder' }; }
    if (g.karar !== 'Sigorta Ödemez') return y.code(400).send({ hata: 'Sigorta kararını seçmenizi rica ederiz.' });
    if (!g.sonTarih) return y.code(400).send({ hata: 'Son ödeme tarihini girmenizi rica ederiz.' });
    return islem(async (c) => {
      const t = (await c.query(`INSERT INTO odeme_talebi (dosya_ref, tur, tutar_eur, muhatap, son_tarih, durum, hazirlayan_ref) VALUES ($1,$2,$3,'Yat Sahibi',$4,'Gönderildi',$5) RETURNING kimlik`, [k.dosya_ref, TALEP_TURU[k.tur], k.tutar_eur, g.sonTarih, o.kullanici])).rows[0];
      await c.query(`UPDATE odeme_sorumlulugu_kalemi SET durum = 'Yat Sahibine Aktarıldı', odeme_talebi_ref = $2 WHERE kimlik = $1`, [id, t.kimlik]);
      await belgeUret(c, { tur: 'Ödeme Sorumluluğu', nesne: t.kimlik, dosya: k.dosya_ref });
      const yt = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [k.dosya_ref])).rows[0];
      if (yt && !k.vefat_isareti) await yatTarafinaYaz(c, { olay: `bld30:${t.kimlik}`, kod: 'BLD-30', dil: dilKod(k.yazisma_dili), konu: `${k.dosya_no} Ödeme Sorumluluğu Bildirimi`, telefon: yt.telefon, eposta: yt.eposta, alanlar: { 'Dosya No': k.dosya_no, 'File No': k.dosya_no, 'bağlantı': b.webAdresi, link: b.webAdresi } });
      if (k.vefat_isareti) await kartAc(c, { tur: 'Vefat Alacak Askısı', kategori: 'islem', baslik: `${k.dosya_no} · Ödeme Sorumluluğu Askıda`, sahipRol: await rolId(c, 'Hukuk ve Uyum Direktörü'), nesneTuru: 'Dosya', nesneKimligi: k.dosya_ref });
      return { durum: 'Yat Sahibine Aktarıldı', odemeTalebi: t.kimlik, sonTarih: gunAy(g.sonTarih!) };
    });
  });
}
