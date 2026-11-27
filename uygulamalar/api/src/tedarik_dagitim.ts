import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const TY = 'Tedarik Yöneticisi'; const TS = 'Tedarik Sorumlusu';
const TMY = 'Tedarik Müdür Yardımcısı'; const TYM = 'Tedarik Yönetimi Müdürü';
const GORUR = [TY, TMY, TYM];

/** YG-1592: onaylanan Teknik Malzeme Talebi (FR-MLZ-001) Tedarik Yöneticisine dağıtım görevi açar; süre 8 saat, Kritik dosyada (acil tedbir) 2 saat. */
export async function dagitimaAc(c: Db, form: string, simdi = new Date()) {
  const f = (await c.query(`SELECT f.kimlik, f.kayit_no, d.oncelik FROM form_kaydi f LEFT JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1 AND f.form_kodu = 'FR-MLZ-001'`, [form])).rows[0];
  if (!f || (await c.query(`SELECT 1 FROM is_karti WHERE tur = 'Talep Dağıtımı' AND nesne_kimligi = $1`, [form])).rowCount) return;
  const saat = f.oncelik === 'Kritik' ? 2 : 8;
  await kartAc(c, { tur: 'Talep Dağıtımı', kategori: 'gorev', baslik: `${f.kayit_no} · Malzeme Talebini Dağıt`, ozet: 'Talebi bir Tedarik Sorumlusuna atayınız; teknik şartı eksikse gerekçeyle iade ediniz.', oncelik: f.oncelik === 'Kritik' ? 'Kritik' : 'Yüksek', sahipRol: await rolId(c, TY), sonZaman: new Date(simdi.getTime() + saat * 3_600_000), nesneTuru: 'Form Kaydı', nesneKimligi: form });
}

export function tedarikDagitimYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);

  // YG-1592, YG-1593: Dağıtım Bekleyen Talepler (öncelik → kalan süre → geliş) ve Ekip Uyarıları (48 saati aşan tedarikçi kabulü, geciken teslim).
  s.get('/tedarik-pano', oturumlu, async (i, y) => {
    const r = await roller(i.oturum!.kullanici); if (!r.some((x) => GORUR.includes(x))) return yok(y);
    const bekleyen = (await b.db.query(`SELECT f.kimlik, f.kayit_no, d.dosya_no, coalesce(d.oncelik, 'Normal') oncelik, f.onay_zamani, k.son_zaman, (SELECT t.cikar_beyani FROM tedarik_dagitim t WHERE t.form_ref = f.kimlik) cikar FROM form_kaydi f LEFT JOIN dosya d ON d.kimlik = f.dosya_ref
        LEFT JOIN is_karti k ON k.tur = 'Talep Dağıtımı' AND k.nesne_kimligi = f.kimlik::text AND k.durum = 'Bekliyor'
      WHERE f.form_kodu = 'FR-MLZ-001' AND f.durum = 'Onaylı' AND NOT EXISTS (SELECT 1 FROM tedarik_dagitim t WHERE t.form_ref = f.kimlik AND t.cikar_beyani IS NULL)
      ORDER BY CASE d.oncelik WHEN 'Kritik' THEN 0 WHEN 'Yüksek' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, k.son_zaman NULLS LAST, f.onay_zamani LIMIT 100`)).rows;
    const uyarilar = [
      ...(await b.db.query(`SELECT siparis_no, 'Tedarikçi Kabulü 48 Saati Aştı' tur FROM tedarik_siparisi WHERE statu = 'Verildi' AND tedarikci_kabul IS NULL AND verilme_zamani < now() - interval '48 hours'`)).rows,
      ...(await b.db.query(`SELECT siparis_no, 'Geciken Teslim' tur FROM tedarik_siparisi WHERE statu IN ('Verildi', 'Kısmi Teslim') AND coalesce(tedarikci_teslim_tarihi, teslim_tarihi) < current_date`)).rows,
      ...(await b.db.query(`SELECT s.siparis_no, 'Karantina Kararı 10 Günü Aştı' tur FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE m.kabul_karari = 'Karantina' AND m.onay_zamani < now() - interval '10 days'`)).rows, // YG-1593
    ];
    const sorumlular = (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND x.rol_adi = $1 AND h.hesap_durumu = 'Aktif' ORDER BY h.ad_soyad`, [TS])).rows;
    // YG-1594: açık şüpheli ürün kartları Tedarik Yönetimi Müdürü ve Müdür Yardımcısına "Kullanımı Durdur ve Karantinaya Al" ile gösterilir.
    const supheli = !r.some((x) => [TYM, TMY].includes(x)) ? [] : (await b.db.query(`SELECT k.nesne_kimligi kimlik, k.baslik, k.ozet, k.olusturma_zamani FROM is_karti k WHERE k.tur = 'Şüpheli Ürün' AND k.durum = 'Bekliyor' ORDER BY k.olusturma_zamani LIMIT 50`)).rows;
    return { bekleyen, uyarilar, sorumlular, dagitir: r.includes(TY), supheli };
  });
  // YG-1593: geri çağırma taraması; üretici parça no, ürün tanımı veya lot ile etkilenen giriş kayıtları, siparişler ve dosyalar (en az 3 karakter).
  s.get('/tedarik/geri-cagirma', oturumlu, async (i, y) => {
    if (!(await roller(i.oturum!.kullanici)).some((x) => [TYM, TMY].includes(x))) return yok(y);
    const q = (i.query ?? {}) as { parca?: string; urun?: string; lot?: string };
    const parca = (q.parca ?? '').trim(); const urun = (q.urun ?? '').trim(); const lot = (q.lot ?? '').trim();
    if (![parca, urun, lot].some((x) => x.length >= 3)) return y.code(400).send({ hata: 'Üretici parça no, ürün tanımı veya lot numarasından en az birini (en az 3 karakter) yazınız.' });
    const kacis = (x: string) => `%${x.replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
    return (await b.db.query(`SELECT m.kimlik, m.kayit_no, m.lot_no, m.kabul_karari, m.miktar, k.urun_tanimi, k.uretici_parca_no, s.siparis_no, s.statu siparis_durumu, d.dosya_no, d.statu dosya_durumu, ku.ticari_unvan tedarikci
        FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref JOIN tedarik_siparisi_kalemi k ON k.siparis_ref = m.siparis_ref AND k.satir_no = m.satir_no JOIN dosya d ON d.kimlik = s.dosya_ref JOIN kurulus ku ON ku.kimlik = s.kurulus_ref
       WHERE ($1 = '' OR k.uretici_parca_no ILIKE $4) AND ($2 = '' OR k.urun_tanimi ILIKE $5) AND ($3 = '' OR m.lot_no ILIKE $6)
       ORDER BY m.olusturma_zamani DESC LIMIT 200`, [parca, urun, lot, kacis(parca), kacis(urun), kacis(lot)])).rows;
  });
  // YG-1594: kabul edilmiş üründe şüphe (sahte, hasarlı, geri çağrılmış olabilir) dosyaya erişimi olan LGM personelince gerekçeyle bildirilir; Tedarik Yönetimi Müdürüne Kritik kart açılır.
  s.post('/malzeme-giris/:id/supheli', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const gerekce = String(((i.body ?? {}) as { gerekce?: string }).gerekce ?? '').trim();
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü') return yok(y);
    const m = (await b.db.query(`SELECT m.kabul_karari, m.lot_no, m.kayit_no, s.siparis_no, s.dosya_ref FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE m.kimlik = $1`, [id])).rows[0];
    if (!m || !(await (await import('./dosya.js')).dosyaErisimi(b.db, o.kullanici, m.dosya_ref))) return yok(y);
    if (!['Kabul', 'Koşullu Kabul'].includes(m.kabul_karari)) return y.code(409).send({ hata: 'Şüpheli ürün bildirimi kabul edilmiş üründe yapılır; kontrol bekleyen üründe karantina kararı veriniz.' });
    if (!gerekce) return y.code(400).send({ hata: 'Şüphenin nedenini yazmanızı rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Şüpheli Ürün' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id])).rowCount) return y.code(409).send({ hata: 'Bu ürün için açık şüpheli ürün bildirimi vardır.' });
    const tym = await rolId(b.db, TYM); const hedef = (await rolSahipleri(b.db, tym)).length ? tym : await rolId(b.db, TMY);
    await kartAc(b.db, { tur: 'Şüpheli Ürün', kategori: 'islem', oncelik: 'Kritik', baslik: `${m.siparis_no} · Lot ${m.lot_no} · Şüpheli Ürün`, ozet: gerekce.slice(0, 300), sahipRol: hedef, nesneTuru: 'Malzeme Giriş', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Şüpheli Ürün Bildirildi', nesneTuru: 'Malzeme Giriş', nesneKimligi: id, gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // Tedarik Yönetimi Müdürü (veya Müdür Yardımcısı) kullanımı durdurur: kayıt karantinaya alınır, teslim alınan miktar geri düşülür, 10 günlük karantina kararı görevi açılır, dosya ekibine bildirim gider.
  s.post('/malzeme-giris/:id/kullanimi-durdur', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await roller(o.kullanici)).some((x) => [TYM, TMY].includes(x))) return yok(y);
    const m = (await b.db.query(`SELECT m.*, s.siparis_no, s.dosya_ref, s.statu FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE m.kimlik = $1`, [id])).rows[0];
    if (!m) return yok(y);
    if (!['Kabul', 'Koşullu Kabul'].includes(m.kabul_karari)) return y.code(409).send({ hata: 'Ürün kabul edilmiş durumda değildir.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE malzeme_giris_kabulu SET kabul_karari = 'Karantina', onay_zamani = now() WHERE kimlik = $1`, [id]);
      await c.query(`UPDATE tedarik_siparisi_kalemi SET teslim_alinan = greatest(teslim_alinan - $3, 0) WHERE siparis_ref = $1 AND satir_no = $2`, [m.siparis_ref, m.satir_no, m.miktar]);
      if (m.statu === 'Teslim Alındı') await c.query(`UPDATE tedarik_siparisi SET statu = 'Kısmi Teslim' WHERE kimlik = $1`, [m.siparis_ref]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Şüpheli Ürün' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      await kartAc(c, { tur: 'Karantina Kararı', kategori: 'gorev', baslik: `${m.siparis_no} · Karantinadaki Ürün Kararı`, ozet: 'Kullanımı durdurulan ürün için 10 gün içinde kabul, ret veya iade kararı veriniz.', oncelik: 'Yüksek', sahipRol: await rolId(c, TMY), sonZaman: new Date(Date.now() + 10 * 86_400_000), nesneTuru: 'Malzeme Giriş', nesneKimligi: id });
      const ekip = (await c.query(`SELECT DISTINCT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL`, [m.dosya_ref])).rows.map((x) => x.kullanici_ref as string);
      if (ekip.length) await bildir(c, { olay: `supheli-durdur:${id}`, kullanicilar: ekip, baslik: `${m.siparis_no} · Lot ${m.lot_no} · Kullanım Durduruldu`, ozet: 'Ürün karantinaya alınmıştır; kullanmayınız.', acil: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kullanım Durduruldu ve Karantinaya Alındı', nesneTuru: 'Malzeme Giriş', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    return { durum: 'Karantina' };
  });
  // YG-1590: Tedarik Sorumlusunun kendi talepleri, siparişleri ve uyarıları.
  s.get('/tedarik-sorumlusu-pano', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await roller(o.kullanici)).includes(TS)) return yok(y);
    const talepler = (await b.db.query(`SELECT f.kimlik, f.kayit_no, d.dosya_no, coalesce(d.oncelik, 'Normal') oncelik, t.zaman FROM tedarik_dagitim t JOIN form_kaydi f ON f.kimlik = t.form_ref LEFT JOIN dosya d ON d.kimlik = f.dosya_ref
      WHERE t.sorumlu_ref = $1 AND EXISTS (SELECT 1 FROM is_karti k WHERE k.tur = 'Malzeme Talebi' AND k.nesne_kimligi = f.kimlik::text AND k.durum = 'Bekliyor') ORDER BY t.zaman`, [o.kullanici])).rows;
    const siparisler = (await b.db.query(`SELECT s.kimlik, s.siparis_no, s.statu, s.tedarikci_kabul, s.teslim_tarihi::text, s.dosya_ref, s.hazirlayan_ref = $1 AS benim, (SELECT x.rol_adi FROM is_karti k JOIN rol x ON x.kimlik = k.zincir[k.kademe + 1] WHERE k.tur = 'Tedarik Siparişi' AND k.nesne_kimligi = s.kimlik::text AND k.durum = 'Bekliyor' LIMIT 1) makam
      FROM tedarik_siparisi s WHERE s.hazirlayan_ref = $1 AND s.statu NOT IN ('Kapalı', 'İptal') ORDER BY s.olusturma_zamani DESC LIMIT 50`, [o.kullanici])).rows;
    const uyarilar = [
      ...(await b.db.query(`SELECT s.siparis_no, 'Karantinada Ürün' tur FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE m.kabul_karari = 'Karantina' AND s.hazirlayan_ref = $1`, [o.kullanici])).rows,
      ...(await b.db.query(`SELECT siparis_no, 'Tedarikçi Kabulü 48 Saati Aştı' tur FROM tedarik_siparisi WHERE hazirlayan_ref = $1 AND statu = 'Verildi' AND tedarikci_kabul IS NULL AND verilme_zamani < now() - interval '48 hours'`, [o.kullanici])).rows,
      ...(await b.db.query(`SELECT siparis_no, 'Teslim Gecikmesi (Dosya Sorumlusu ve Teknik Uzmana bilgi veriniz)' tur FROM tedarik_siparisi WHERE hazirlayan_ref = $1 AND statu IN ('Verildi', 'Kısmi Teslim') AND coalesce(tedarikci_teslim_tarihi, teslim_tarihi) < current_date`, [o.kullanici])).rows,
      // YG-1590: tedarikçi banka hesabı değişikliği (ödeme durdurulur, bağımsız kanaldan doğrulama), sevkte eksik sertifika, raf ömrü 30 günden az kalan giriş.
      ...(await b.db.query(`SELECT DISTINCT s.siparis_no, 'Tedarikçi Banka Hesabı Değişikliği: ödeme durduruldu, bağımsız kanaldan doğrulayınız' tur FROM tedarik_siparisi s JOIN banka_hesabi h ON h.kurulus_ref = s.kurulus_ref AND h.durum = 'Karantina' WHERE s.hazirlayan_ref = $1 AND s.statu NOT IN ('Kapalı', 'İptal')`, [o.kullanici])).rows,
      ...(await b.db.query(`SELECT s.siparis_no, 'Sevkte Sertifika Eksik (irsaliye ' || v.irsaliye_no || ')' tur FROM tedarik_sevki v JOIN tedarik_siparisi s ON s.kimlik = v.siparis_ref WHERE s.hazirlayan_ref = $1 AND v.sertifika_ref IS NULL AND s.statu NOT IN ('Kapalı', 'İptal')`, [o.kullanici])).rows,
      ...(await b.db.query(`SELECT s.siparis_no, 'Raf Ömrü Doluyor (lot ' || m.lot_no || ', son kullanma ' || to_char(m.son_kullanma, 'DD.MM.YYYY') || ')' tur FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE s.hazirlayan_ref = $1 AND m.son_kullanma <= current_date + 30 AND coalesce(m.kabul_karari, '') NOT IN ('Ret', 'İade Edildi') AND s.statu NOT IN ('Kapalı', 'İptal')`, [o.kullanici])).rows,
    ];
    return { talepler, siparisler, uyarilar };
  });
  // YG-1592: atanan Tedarik Sorumlusu çıkar çatışmasını gerekçeyle bildirir; görevi kapanır, Tedarik Yöneticisine yeniden atama görevi açılır.
  s.post('/tedarik/dagitim/:id/cikar-catismasi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const aciklama = String(((i.body ?? {}) as { aciklama?: string }).aciklama ?? '').trim();
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT t.form_ref, f.kayit_no, d.oncelik FROM tedarik_dagitim t JOIN form_kaydi f ON f.kimlik = t.form_ref LEFT JOIN dosya d ON d.kimlik = f.dosya_ref WHERE t.form_ref = $1 AND t.sorumlu_ref = $2 AND t.cikar_beyani IS NULL`, [id, o.kullanici])).rows[0];
    if (!t) return yok(y);
    if (!aciklama) return y.code(400).send({ hata: 'Çıkar çatışmasını kısaca açıklamanızı rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM tedarik_siparisi s JOIN form_kaydi f ON f.dosya_ref = s.dosya_ref WHERE f.kimlik = $1 AND s.hazirlayan_ref = $2 AND s.statu <> 'İptal'`, [id, o.kullanici])).rowCount) return y.code(409).send({ hata: 'Bu dosyada hazırladığınız sipariş vardır; çıkar çatışmasını birim amirinize bildiriniz.' });
    await b.db.query(`UPDATE tedarik_dagitim SET cikar_beyani = $2, beyan_zamani = now() WHERE form_ref = $1`, [id, aciklama]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Malzeme Talebi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    const saat = t.oncelik === 'Kritik' ? 2 : 8;
    await kartAc(b.db, { tur: 'Talep Dağıtımı', kategori: 'gorev', baslik: `${t.kayit_no} · Malzeme Talebini Yeniden Dağıt`, ozet: 'Atanan Tedarik Sorumlusu çıkar çatışması bildirdi; talebi başka bir Tedarik Sorumlusuna atayınız.', oncelik: t.oncelik === 'Kritik' ? 'Kritik' : 'Yüksek', sahipRol: await rolId(b.db, TY), sonZaman: new Date(Date.now() + saat * 3_600_000), nesneTuru: 'Form Kaydı', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Çıkar Çatışması Bildirildi', nesneTuru: 'Form Kaydı', nesneKimligi: id, gerekce: aciklama, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/tedarik/dagitim/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sorumlu?: string; iadeGerekcesi?: string };
    if (!UUID.test(id) || !(await roller(o.kullanici)).includes(TY)) return yok(y);
    const f = (await b.db.query(`SELECT kimlik, kayit_no, hazirlayan_ref FROM form_kaydi WHERE kimlik = $1 AND form_kodu = 'FR-MLZ-001' AND durum = 'Onaylı' AND NOT EXISTS (SELECT 1 FROM tedarik_dagitim t WHERE t.form_ref = form_kaydi.kimlik AND t.cikar_beyani IS NULL)`, [id])).rows[0];
    if (!f) return yok(y);
    const kapat = () => b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Talep Dağıtımı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    if (g.iadeGerekcesi !== undefined) {
      if (!g.iadeGerekcesi.trim()) return y.code(400).send({ hata: 'İade gerekçesini yazınız.' });
      await b.db.query(`UPDATE form_kaydi SET durum = 'Açık', iade_nedeni = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, g.iadeGerekcesi.trim()]);
      await kapat();
      await bildir(b.db, { olay: `mlz-iade:${id}:${Date.now()}`, kullanicilar: [f.hazirlayan_ref], baslik: `${f.kayit_no} · Malzeme Talebi İade Edildi`, ozet: g.iadeGerekcesi.trim() });
      await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Malzeme Talebi İade', nesneTuru: 'Form Kaydı', nesneKimligi: id, gerekce: g.iadeGerekcesi.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { durum: 'İade Edildi' };
    }
    if (!g.sorumlu || !(await rolSahipleri(b.db, await rolId(b.db, TS))).includes(g.sorumlu)) return y.code(400).send({ hata: 'Tedarik Sorumlusunu seçiniz.' });
    // YG-1592: çıkar çatışması bildiren sorumluya talep yeniden atanamaz.
    if ((await b.db.query(`SELECT 1 FROM tedarik_dagitim WHERE form_ref = $1 AND sorumlu_ref = $2 AND cikar_beyani IS NOT NULL`, [id, g.sorumlu])).rowCount) return y.code(409).send({ hata: 'Bu Tedarik Sorumlusu talep için çıkar çatışması bildirmiştir; başka birini seçiniz.' });
    await b.db.query(`INSERT INTO tedarik_dagitim (form_ref, sorumlu_ref, atayan_ref) VALUES ($1,$2,$3) ON CONFLICT (form_ref) DO UPDATE SET onceki_sorumlu_ref = tedarik_dagitim.sorumlu_ref, sorumlu_ref = EXCLUDED.sorumlu_ref, atayan_ref = EXCLUDED.atayan_ref, zaman = now(), cikar_beyani = NULL, beyan_zamani = NULL`, [id, g.sorumlu, o.kullanici]);
    await kapat();
    await kartAc(b.db, { tur: 'Malzeme Talebi', kategori: 'gorev', baslik: `${f.kayit_no} · Malzeme Talebi`, ozet: 'Teklif toplayıp sipariş hazırlayınız.', sahipKullanici: g.sorumlu, nesneTuru: 'Form Kaydı', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Malzeme Talebi Dağıtıldı', nesneTuru: 'Form Kaydı', nesneKimligi: id, yeni: { sorumlu: g.sorumlu }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Dağıtıldı' };
  });
}
