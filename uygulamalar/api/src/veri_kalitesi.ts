import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
type Kural = { kod: string; ad: string; amac: string; kume: string; kaynak: string; boyut: string; etki: string; sahip: string; sql: string };
/** YG-1254: kalite kuralları tek yerde (bu katalog) tanımlıdır; modüller kuralı kopyalamaz, sonucu buradan okur. Her SQL "kayit" ve "aciklama" döndürür. */
export const KURALLAR: Kural[] = [
  { kod: 'VK-01', ad: 'Aktif dosyada ana teknik branş eksik', amac: 'Teknik Uzman ataması ve iş emri için branş gerekir', kume: 'DOSYA', kaynak: 'dosya', boyut: 'Tamlık', etki: 'Teslim', sahip: 'Operasyon Müdürü', sql: `SELECT kimlik::text kayit, dosya_no aciklama FROM dosya WHERE statu = 'Aktif' AND ana_teknik_brans IS NULL` },
  { kod: 'VK-02', ad: 'Aktif dosyada tahmini teslim tarihi eksik', amac: 'Müşteriye teslim tarihi bildirimi', kume: 'DOSYA', kaynak: 'dosya', boyut: 'Tamlık', etki: 'Müşteri', sahip: 'Operasyon Müdürü', sql: `SELECT kimlik::text kayit, dosya_no aciklama FROM dosya WHERE statu = 'Aktif' AND tahmini_teslim_tarihi IS NULL AND acilis_tarihi < now() - interval '7 days'` },
  { kod: 'VK-03', ad: 'Kapalı dosyada açık iş emri', amac: 'Kapanış ile iş emri durumunun tutarlılığı', kume: 'DOSYA', kaynak: 'dosya, is_emri', boyut: 'Tutarlılık', etki: 'Ödeme', sahip: 'Operasyon Müdürü', sql: `SELECT e.kimlik::text kayit, d.dosya_no || ' · ' || e.is_emri_no aciklama FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE d.statu = 'Kapalı' AND e.statu IN ('Aktif', 'Kabul Bekliyor', 'Başlangıç Kontrolünde') AND NOT EXISTS (SELECT 1 FROM is_emri n WHERE n.is_emri_no = e.is_emri_no AND n.surum > e.surum)` },
  { kod: 'VK-04', ad: 'Aynı adla birden çok yat (mükerrer aday)', amac: 'Yat geçmişinin tek kayıtta toplanması', kume: 'YAT', kaynak: 'yat', boyut: 'Tekillik', etki: 'Müşteri', sahip: 'Operasyon Müdürü', sql: `SELECT min(kimlik::text) kayit, yat_adi || ' (' || count(*) || ' kayıt)' aciklama FROM yat GROUP BY lower(yat_adi), yat_adi HAVING count(*) > 1` },
  { kod: 'VK-05', ad: 'Firma IBAN kaydı teyitsiz (karantinada)', amac: 'Ödemenin doğru hesaba yapılması', kume: 'FIRMA', kaynak: 'banka_hesabi', boyut: 'Doğruluk', etki: 'Ödeme', sahip: 'Firma Yönetimi Müdürü', sql: `SELECT b.kimlik::text kayit, k.ticari_unvan aciklama FROM banka_hesabi b JOIN kurulus k ON k.kimlik = b.kurulus_ref WHERE b.durum = 'Karantina' AND b.olusturma_zamani < now() - interval '3 days'` },
  { kod: 'VK-06', ad: 'Taraf telefonu biçim dışı', amac: 'SMS ve arama ile ulaşılabilirlik', kume: 'TARAF', kaynak: 'taraf', boyut: 'Geçerlilik', etki: 'Müşteri', sahip: 'Müşteri ve Paydaş İlişkileri Müdürü', sql: `SELECT kimlik::text kayit, coalesce(telefon, '') aciklama FROM taraf WHERE telefon IS NOT NULL AND telefon !~ '^\\+?[0-9 ]{10,16}$'` },
  { kod: 'VK-07', ad: 'İletişim bilgisi doğrulama yaşı aşıldı', amac: 'VY-01: yılda bir yeniden doğrulama', kume: 'TARAF', kaynak: 'iletisim_bilgisi', boyut: 'Güncellik', etki: 'Müşteri', sahip: 'Müşteri ve Paydaş İlişkileri Müdürü', sql: `SELECT i.kimlik::text kayit, i.tur || ' · ' || i.deger aciklama FROM iletisim_bilgisi i WHERE i.gecerli AND i.dogrulama_zamani < now() - make_interval(days => (SELECT azami_gun FROM veri_yasi_kurali WHERE kod = 'VY-01'))` },
  { kod: 'VK-08', ad: 'Tahsil edildi görünen faturada eksik tahsilat', amac: 'Fatura durumu ile tahsilat tutarının tutarlılığı', kume: 'FATURA', kaynak: 'musteri_faturasi', boyut: 'Tutarlılık', etki: 'Ödeme', sahip: 'Muhasebe ve Finans Müdürü', sql: `SELECT kimlik::text kayit, coalesce(fatura_no, proforma_no) aciklama FROM musteri_faturasi WHERE durum = 'Tahsil Edildi' AND tahsil_edilen_eur + 0.01 < toplam_eur` },
  { kod: 'VK-09', ad: 'Tesis kapasite teyidi eski', amac: 'VY-02: kapasite teyidinin güncelliği', kume: 'FIRMA', kaynak: 'firma_tesisi', boyut: 'Güncellik', etki: 'Teslim', sahip: 'Firma Yönetimi Müdürü', sql: `SELECT t.kimlik::text kayit, t.ad aciklama FROM firma_tesisi t JOIN kurulus k ON k.kimlik = t.kurulus_ref WHERE k.ag_statusu = 'Aktif' AND t.kapasite_teyit_tarihi < current_date - (SELECT azami_gun FROM veri_yasi_kurali WHERE kod = 'VY-02')` },
  // YG-1648 (A36): aylık sicil veri kalitesi; düzeltme sorumlusu Sicil Sorumlusu (FIRMA kümesi).
  { kod: 'VK-10', ad: 'Onaylı firmada zorunlu sicil alanı eksik', amac: 'Sicil tamlığı: VKN, adres, il, Firma Yetkilisi ve kurumsal e-posta', kume: 'FIRMA', kaynak: 'kurulus', boyut: 'Tamlık', etki: 'Ödeme', sahip: 'Firma Yönetimi Müdürü', sql: `SELECT kimlik::text kayit, ticari_unvan || ' · eksik: ' || concat_ws(', ', CASE WHEN vergi_no IS NULL THEN 'VKN' END, CASE WHEN coalesce(adres, '') = '' THEN 'Adres' END, CASE WHEN il IS NULL THEN 'İl' END, CASE WHEN coalesce(yetkili_kisi, '') = '' THEN 'Firma Yetkilisi' END, CASE WHEN kurumsal_eposta IS NULL THEN 'Kurumsal E-posta' END) aciklama FROM kurulus WHERE kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı') AND (vergi_no IS NULL OR coalesce(adres, '') = '' OR il IS NULL OR coalesce(yetkili_kisi, '') = '' OR kurumsal_eposta IS NULL)` },
  { kod: 'VK-11', ad: 'Firma vergi kimlik numarası biçim dışı', amac: 'Sicil doğruluğu: VKN 10, TCKN 11 hane', kume: 'FIRMA', kaynak: 'kurulus', boyut: 'Doğruluk', etki: 'Ödeme', sahip: 'Firma Yönetimi Müdürü', sql: `SELECT kimlik::text kayit, ticari_unvan || ' · ' || vergi_no aciklama FROM kurulus WHERE vergi_no IS NOT NULL AND vergi_no !~ '^[0-9]{10,11}$' AND kayit_asamasi <> 'Reddedildi'` },
  { kod: 'VK-12', ad: 'Firma sicil kaydı 12 aydır güncellenmedi', amac: 'VY-03: sicil bilgilerinin güncelliği', kume: 'FIRMA', kaynak: 'kurulus', boyut: 'Güncellik', etki: 'Teslim', sahip: 'Firma Yönetimi Müdürü', sql: `SELECT kimlik::text kayit, ticari_unvan aciklama FROM kurulus WHERE kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı') AND guncelleme_zamani < now() - make_interval(days => (SELECT azami_gun FROM veri_yasi_kurali WHERE kod = 'VY-03'))` },
  { kod: 'VK-13', ad: 'Aynı unvanla birden çok firma (mükerrer aday)', amac: 'Sicil tekilliği; silme yok, eşleştirme önerisi', kume: 'FIRMA', kaynak: 'kurulus', boyut: 'Tekillik', etki: 'Ödeme', sahip: 'Firma Yönetimi Müdürü', sql: `SELECT min(kimlik::text) kayit, min(ticari_unvan) || ' (' || count(*) || ' kayıt)' aciklama FROM kurulus WHERE kayit_asamasi <> 'Reddedildi' AND coalesce(mukerrer_karari, 'Karar bekliyor') = 'Karar bekliyor' GROUP BY lower(trim(ticari_unvan)) HAVING count(*) > 1` },
  // YG-1251: tamlık birlikte değerlendirilir (taraf/yat bağı, onay, tarih, kanıt); başka dosyaya ait ek dosya kanıt yerine geçmez.
  { kod: 'VK-14', ad: 'Aktif dosyada yat sahibi tarafı yok', amac: 'Taraf ve yat bağının tamlığı', kume: 'DOSYA', kaynak: 'dosya, dosya_tarafi', boyut: 'Tamlık', etki: 'Müşteri', sahip: 'Operasyon Müdürü', sql: `SELECT d.kimlik::text kayit, d.dosya_no aciklama FROM dosya d WHERE d.statu = 'Aktif' AND NOT EXISTS (SELECT 1 FROM dosya_tarafi t WHERE t.dosya_ref = d.kimlik AND t.aktif AND t.taraf_rolu = 'Yat Sahibi')` },
  { kod: 'VK-15', ad: 'Karar verilmiş teklifte karar zamanı yok', amac: 'Onay kaydının tarihle birlikte tamlığı', kume: 'DOSYA', kaynak: 'fiyat_teklifi', boyut: 'Tamlık', etki: 'Ödeme', sahip: 'Operasyon Müdürü', sql: `SELECT t.kimlik::text kayit, t.teklif_no aciklama FROM fiyat_teklifi t WHERE t.statu = 'Karar' AND (t.karar IS NULL OR t.karar_zamani IS NULL)` },
  { kod: 'VK-16', ad: 'Ölçüm zamanı ileri tarihte', amac: 'Ölçüm tarihinin doğruluğu', kume: 'DOSYA', kaynak: 'olcum_kaydi', boyut: 'Doğruluk', etki: 'Teslim', sahip: 'Operasyon Müdürü', sql: `SELECT o.kimlik::text kayit, d.dosya_no || ' · ' || o.olcum_no aciklama FROM olcum_kaydi o JOIN dosya d ON d.kimlik = o.dosya_ref WHERE o.olcum_zamani > now() + interval '1 hour'` },
  { kod: 'VK-17', ad: 'Kanıt belgesi başka dosyaya ait (ilgisiz ek)', amac: 'Görsel kanıt ve kontrol noktası kanıtı ilgili dosya veya iş emrine bağlı olmalı', kume: 'DOSYA', kaynak: 'gorsel_kanit, kontrol_noktasi, belge', boyut: 'Tutarlılık', etki: 'Teslim', sahip: 'Operasyon Müdürü', sql: `SELECT g.kimlik::text kayit, d.dosya_no || ' · ' || coalesce(g.gorsel_no, 'Görsel') aciklama FROM gorsel_kanit g JOIN dosya d ON d.kimlik = g.dosya_ref JOIN belge b ON b.kimlik = g.belge_ref WHERE NOT (b.bag_turu = 'Dosya' AND b.bag_kimligi = g.dosya_ref::text)
      UNION ALL SELECT n.kimlik::text, d.dosya_no || ' · ' || n.kontrol_noktasi_no FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref JOIN belge_surum s ON s.kimlik = n.kanit_surum_ref JOIN belge b ON b.kimlik = s.belge_ref WHERE NOT ((b.bag_turu = 'Dosya' AND b.bag_kimligi = e.dosya_ref::text) OR (b.bag_turu = 'İş Emri' AND b.bag_kimligi = e.kimlik::text))` },
  { kod: 'VK-18', ad: 'Kişisel veri tablosunda bilgi sınıfı yok veya Kamuya Açık serbest', amac: 'YG-1177: kişisel veri taşıyan kayıt varsayılan Gizli, hiçbir zaman Kamuya Açık değil', kume: 'TARAF', kaynak: 'şema', boyut: 'Geçerlilik', etki: 'Güvenlik', sahip: 'Operasyon Müdürü', sql: `SELECT t kayit, t aciklama FROM bilgi_sinifi_kisisel_eksik() t` },
];
/** YG-1255: öncelik karar etkisinden; ödeme ve güvenlik yüksek, teslim ve müşteri orta. */
export const oncelik = (etki: string) => (['Ödeme', 'Güvenlik'].includes(etki) ? 'Yüksek' : ['Teslim', 'Müşteri'].includes(etki) ? 'Orta' : 'Düşük');

async function katalog(db: Db) {
  for (const k of KURALLAR) await db.query(`INSERT INTO kalite_kurali (kod, surum, ad, amac, kume_ref, kaynak, kontrol_zamani, boyut, etki, sahip_rol) SELECT $1,1,$2,$3,$4,$5,'Günlük',$6,$7,$8 WHERE NOT EXISTS (SELECT 1 FROM kalite_kurali WHERE kod = $1)`, [k.kod, k.ad, k.amac, k.kume, k.kaynak, k.boyut, k.etki, k.sahip]);
}

/** Günlük kontrol: ihlal açılır veya son görülme güncellenir; artık görülmeyen hata giderilir; eşik aşılınca düzeltme sorumlusuna bildirim. */
export async function kaliteKontrolIsle(db: Pool, simdi = new Date()): Promise<number> {
  await katalog(db); let n = 0;
  for (const k of KURALLAR) {
    const t = (await db.query(`SELECT * FROM kalite_kurali WHERE kod = $1 AND durum = 'Yürürlükte'`, [k.kod])).rows[0];
    const bulunan = (await db.query(k.sql)).rows as { kayit: string; aciklama: string }[];
    for (const r of bulunan) {
      await db.query(`INSERT INTO veri_hatasi (kural_kod, kayit_kimligi, aciklama, boyut, etki, oncelik) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kural_kod, kayit_kimligi) WHERE durum <> 'Giderildi' DO UPDATE SET son_gorulme = now(), aciklama = EXCLUDED.aciklama`, [k.kod, r.kayit, r.aciklama, t.boyut, t.etki, oncelik(t.etki)]);
      n++;
    }
    await db.query(`UPDATE veri_hatasi SET durum = 'Giderildi', giderilme = now() WHERE kural_kod = $1 AND durum = 'Açık' AND NOT (kayit_kimligi = ANY($2::text[]))`, [k.kod, bulunan.map((r) => r.kayit)]);
    const acik = Number((await db.query(`SELECT count(*) n FROM veri_hatasi WHERE kural_kod = $1 AND durum = 'Açık'`, [k.kod])).rows[0].n);
    if (acik > t.esik) {
      const ks = (await db.query(`SELECT duzeltme_sorumlusu FROM veri_kumesi WHERE kod = $1`, [t.kume_ref])).rows[0]?.duzeltme_sorumlusu;
      const rol = ks ? (await db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ks])).rows[0]?.kimlik : null;
      if (rol) await bildir(db, { olay: `veri-kalite:${k.kod}:${simdi.toISOString().slice(0, 10)}`, kullanicilar: await rolSahipleri(db, rol), baslik: `Veri Kalitesi · ${t.ad}: ${acik} kayıt`, ozet: `${t.boyut} · Etki: ${t.etki} · Öncelik: ${oncelik(t.etki)}`, oncelik: oncelik(t.etki) === 'Yüksek' ? 'Yüksek' : 'Normal' }, simdi);
    }
  }
  return n;
}

export function veriKalitesiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);
  const YON = ['Bilgi İşlem Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'CEO', 'Genel Müdür Yardımcısı'];
  s.get('/veri-kalitesi', oturumlu, async (i, y) => {
    const r = await roller(i.oturum!.kullanici);
    const kumeler = (await b.db.query(`SELECT * FROM veri_kumesi ORDER BY kod`)).rows;
    if (!r.some((x) => YON.includes(x) || kumeler.some((k) => k.sahip_rol === x || k.duzeltme_sorumlusu === x))) return yok(y);
    await katalog(b.db);
    return {
      kumeler, yasKurallari: (await b.db.query(`SELECT * FROM veri_yasi_kurali ORDER BY kod`)).rows,
      kurallar: (await b.db.query(`SELECT k.*, k.yururluk::text, (SELECT count(*)::int FROM veri_hatasi h WHERE h.kural_kod = k.kod AND h.durum = 'Açık') acik FROM kalite_kurali k WHERE k.durum = 'Yürürlükte' ORDER BY k.kod`)).rows,
      hatalar: (await b.db.query(`SELECT h.kimlik, h.kural_kod, k.ad, h.kayit_kimligi, h.aciklama, h.boyut, h.etki, h.oncelik, h.ilk_gorulme, h.son_gorulme FROM veri_hatasi h JOIN kalite_kurali k ON k.kod = h.kural_kod AND k.durum = 'Yürürlükte' WHERE h.durum = 'Açık' ORDER BY CASE h.oncelik WHEN 'Yüksek' THEN 0 WHEN 'Orta' THEN 1 ELSE 2 END, h.ilk_gorulme LIMIT 300`)).rows,
      yonetir: r.some((x) => YON.includes(x)), sahipOldugu: kumeler.filter((k) => r.includes(k.sahip_rol)).map((k) => k.kod),
    };
  });
  // Kuralın eşik, istisna ve sahibi yeni sürümle değişir; eski sürüm saklanır (YG-1254).
  s.post('/kalite-kurali/:kod', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string }; if (!(await roller(o.kullanici)).some((x) => YON.includes(x))) return yok(y);
    const g = (i.body ?? {}) as { esik?: number; istisna?: string; sahipRol?: string; kontrolZamani?: string };
    const e = (await b.db.query(`SELECT * FROM kalite_kurali WHERE kod = $1 AND durum = 'Yürürlükte'`, [kod])).rows[0]; if (!e) return yok(y);
    if (g.esik !== undefined && (!Number.isInteger(g.esik) || g.esik < 0)) return y.code(400).send({ hata: 'Eşik sıfır veya pozitif tam sayı olmalıdır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE kalite_kurali SET durum = 'Yerine Geçti' WHERE kod = $1 AND durum = 'Yürürlükte'`, [kod]);
      await c.query(`INSERT INTO kalite_kurali (kod, surum, ad, amac, kume_ref, kaynak, kontrol_zamani, boyut, etki, esik, istisna, sahip_rol, guncelleyen_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [kod, e.surum + 1, e.ad, e.amac, e.kume_ref, e.kaynak, g.kontrolZamani?.trim() || e.kontrol_zamani, e.boyut, e.etki, g.esik ?? e.esik, g.istisna === undefined ? e.istisna : g.istisna.trim() || null, g.sahipRol?.trim() || e.sahip_rol, o.kullanici]);
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kalite Kuralı Sürümü', nesneTuru: 'Kalite Kuralı', nesneKimligi: `${kod}:${e.surum + 1}`, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { surum: e.surum + 1 };
  });
  s.post('/veri-hatasi/:id/istisna', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id)) return yok(y);
    const g = (i.body ?? {}) as { gerekce?: string }; if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'İstisna gerekçesi zorunludur.' });
    const r = await roller(o.kullanici);
    const h = (await b.db.query(`SELECT k.kume_ref, v.sahip_rol FROM veri_hatasi h JOIN kalite_kurali k ON k.kod = h.kural_kod AND k.durum = 'Yürürlükte' JOIN veri_kumesi v ON v.kod = k.kume_ref WHERE h.kimlik = $1 AND h.durum = 'Açık'`, [id])).rows[0];
    if (!h || !r.includes(h.sahip_rol)) return yok(y); // istisnayı yalnız veri kümesi sahibi verir
    await b.db.query(`UPDATE veri_hatasi SET durum = 'İstisna', istisna_gerekcesi = $2 WHERE kimlik = $1`, [id, g.gerekce.trim()]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Veri Hatası İstisnası', nesneTuru: 'Veri Hatası', nesneKimligi: id, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
