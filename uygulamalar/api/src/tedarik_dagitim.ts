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
const GORUR = [TY, 'Tedarik Müdür Yardımcısı', 'Tedarik Yönetimi Müdürü'];

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
    const bekleyen = (await b.db.query(`SELECT f.kimlik, f.kayit_no, d.dosya_no, coalesce(d.oncelik, 'Normal') oncelik, f.onay_zamani, k.son_zaman FROM form_kaydi f LEFT JOIN dosya d ON d.kimlik = f.dosya_ref
        LEFT JOIN is_karti k ON k.tur = 'Talep Dağıtımı' AND k.nesne_kimligi = f.kimlik::text AND k.durum = 'Bekliyor'
      WHERE f.form_kodu = 'FR-MLZ-001' AND f.durum = 'Onaylı' AND NOT EXISTS (SELECT 1 FROM tedarik_dagitim t WHERE t.form_ref = f.kimlik)
      ORDER BY CASE d.oncelik WHEN 'Kritik' THEN 0 WHEN 'Yüksek' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, k.son_zaman NULLS LAST, f.onay_zamani LIMIT 100`)).rows;
    const uyarilar = [
      ...(await b.db.query(`SELECT siparis_no, 'Tedarikçi Kabulü 48 Saati Aştı' tur FROM tedarik_siparisi WHERE statu = 'Verildi' AND tedarikci_kabul IS NULL AND verilme_zamani < now() - interval '48 hours'`)).rows,
      ...(await b.db.query(`SELECT siparis_no, 'Geciken Teslim' tur FROM tedarik_siparisi WHERE statu IN ('Verildi', 'Kısmi Teslim') AND coalesce(tedarikci_teslim_tarihi, teslim_tarihi) < current_date`)).rows,
      ...(await b.db.query(`SELECT s.siparis_no, 'Karantina Kararı 10 Günü Aştı' tur FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE m.kabul_karari = 'Karantina' AND m.onay_zamani < now() - interval '10 days'`)).rows, // YG-1593
    ];
    const sorumlular = (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND x.rol_adi = $1 AND h.hesap_durumu = 'Aktif' ORDER BY h.ad_soyad`, [TS])).rows;
    return { bekleyen, uyarilar, sorumlular, dagitir: r.includes(TY) };
  });
  // YG-1590: Tedarik Sorumlusunun kendi talepleri, siparişleri ve uyarıları.
  s.get('/tedarik-sorumlusu-pano', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await roller(o.kullanici)).includes(TS)) return yok(y);
    const talepler = (await b.db.query(`SELECT f.kimlik, f.kayit_no, d.dosya_no, coalesce(d.oncelik, 'Normal') oncelik, t.zaman FROM tedarik_dagitim t JOIN form_kaydi f ON f.kimlik = t.form_ref LEFT JOIN dosya d ON d.kimlik = f.dosya_ref
      WHERE t.sorumlu_ref = $1 AND EXISTS (SELECT 1 FROM is_karti k WHERE k.tur = 'Malzeme Talebi' AND k.nesne_kimligi = f.kimlik::text AND k.durum = 'Bekliyor') ORDER BY t.zaman`, [o.kullanici])).rows;
    const siparisler = (await b.db.query(`SELECT s.kimlik, s.siparis_no, s.statu, s.tedarikci_kabul, s.teslim_tarihi::text, (SELECT x.rol_adi FROM is_karti k JOIN rol x ON x.kimlik = k.zincir[k.kademe + 1] WHERE k.tur = 'Tedarik Siparişi' AND k.nesne_kimligi = s.kimlik::text AND k.durum = 'Bekliyor' LIMIT 1) makam
      FROM tedarik_siparisi s WHERE s.hazirlayan_ref = $1 AND s.statu NOT IN ('Kapalı', 'İptal') ORDER BY s.olusturma_zamani DESC LIMIT 50`, [o.kullanici])).rows;
    const uyarilar = [
      ...(await b.db.query(`SELECT s.siparis_no, 'Karantinada Ürün' tur FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE m.kabul_karari = 'Karantina' AND s.hazirlayan_ref = $1`, [o.kullanici])).rows,
      ...(await b.db.query(`SELECT siparis_no, 'Tedarikçi Kabulü 48 Saati Aştı' tur FROM tedarik_siparisi WHERE hazirlayan_ref = $1 AND statu = 'Verildi' AND tedarikci_kabul IS NULL AND verilme_zamani < now() - interval '48 hours'`, [o.kullanici])).rows,
      ...(await b.db.query(`SELECT siparis_no, 'Teslim Gecikmesi (Dosya Sorumlusu ve Teknik Uzmana bilgi veriniz)' tur FROM tedarik_siparisi WHERE hazirlayan_ref = $1 AND statu IN ('Verildi', 'Kısmi Teslim') AND coalesce(tedarikci_teslim_tarihi, teslim_tarihi) < current_date`, [o.kullanici])).rows,
    ];
    return { talepler, siparisler, uyarilar };
  });
  s.post('/tedarik/dagitim/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sorumlu?: string; iadeGerekcesi?: string };
    if (!UUID.test(id) || !(await roller(o.kullanici)).includes(TY)) return yok(y);
    const f = (await b.db.query(`SELECT kimlik, kayit_no, hazirlayan_ref FROM form_kaydi WHERE kimlik = $1 AND form_kodu = 'FR-MLZ-001' AND durum = 'Onaylı' AND NOT EXISTS (SELECT 1 FROM tedarik_dagitim t WHERE t.form_ref = form_kaydi.kimlik)`, [id])).rows[0];
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
    await b.db.query(`INSERT INTO tedarik_dagitim (form_ref, sorumlu_ref, atayan_ref) VALUES ($1,$2,$3)`, [id, g.sorumlu, o.kullanici]);
    await kapat();
    await kartAc(b.db, { tur: 'Malzeme Talebi', kategori: 'gorev', baslik: `${f.kayit_no} · Malzeme Talebi`, ozet: 'Teklif toplayıp sipariş hazırlayınız.', sahipKullanici: g.sorumlu, nesneTuru: 'Form Kaydı', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Malzeme Talebi Dağıtıldı', nesneTuru: 'Form Kaydı', nesneKimligi: id, yeni: { sorumlu: g.sorumlu }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Dağıtıldı' };
  });
}
