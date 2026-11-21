import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { birKez } from './bildirim.js';
import { istekBaglami } from './denetim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

/** Gecikme eşiği: son başarılı bitişten bu yana periyodun üç katı geçtiyse iş gecikmiş sayılır. */
const GECIKME_KAT = 3;

/**
 * YG-1316: zamanlanmış iş grubu tekil çalışır; önceki tur bitmeden yeni tur başlamaz, çakışma kaydedilir. Her tur başlangıç, bitiş,
 * süre ve hata bilgisiyle zamanlanmis_is_durumu tablosuna yazılır; bir işin hatası gruptaki diğer işleri durdurmaz.
 */
export function isZamanlayici(db: Pool, hataYaz: (m: string) => void) {
  const calisiyor = new Set<string>();
  const tur = async (ad: string, etki: string, ms: number, isler: () => Promise<unknown>[]) => {
    if (calisiyor.has(ad)) {
      await db.query(`UPDATE zamanlanmis_is_durumu SET cakisma_sayisi = cakisma_sayisi + 1, son_cakisma = now(), guncelleme_zamani = now() WHERE ad = $1`, [ad]).catch(() => {});
      return 'Çakışma' as const;
    }
    calisiyor.add(ad); const bas = Date.now(); const iliski = `is:${randomUUID()}`; // YG-1146: her tur kendi ilişki kimliğiyle izlenir
    try {
      await db.query(`INSERT INTO zamanlanmis_is_durumu (ad, etki, periyot_sn, son_baslangic, iliski_kimligi) VALUES ($1,$2,$3,now(),$4) ON CONFLICT (ad) DO UPDATE SET etki = EXCLUDED.etki, periyot_sn = EXCLUDED.periyot_sn, son_baslangic = now(), iliski_kimligi = EXCLUDED.iliski_kimligi, guncelleme_zamani = now()`, [ad, etki, Math.round(ms / 1000), iliski]);
      const hatalar = (await istekBaglami.run({ iliski }, () => Promise.allSettled(isler()))).flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
      hatalar.forEach(hataYaz);
      await db.query(`UPDATE zamanlanmis_is_durumu SET son_bitis = now(), son_sure_ms = $2, son_hata = $3, hata_sayisi = hata_sayisi + $4, guncelleme_zamani = now() WHERE ad = $1`, [ad, Date.now() - bas, hatalar[0] ?? null, hatalar.length ? 1 : 0]);
      return 'Tamamlandı' as const;
    } catch (h) { hataYaz((h as Error).message); return 'Hata' as const; } finally { calisiyor.delete(ad); }
  };
  return {
    tur,
    zamanla: (ad: string, etki: string, ms: number, isler: () => Promise<unknown>[]) => setInterval(() => { void tur(ad, etki, ms, isler); }, ms),
  };
}

/**
 * YG-1000: 90 gün kullanılmayan (dış hesap kuralıyla aynı süre) veya bağlı entegrasyonu kapalı ya da askıda olan hizmet hesabı askıya alınır;
 * hesap girişe kapanır, oturumları sonlanır ve sahibi role görev açılır.
 */
export async function hizmetHesabiIsle(db: Pool, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(`UPDATE hizmet_hesabi_envanteri v SET durum = 'Askıda', askiya_alma_nedeni = CASE WHEN e.durum IN ('Askıda', 'Kapalı') THEN 'Çağıran entegrasyon ' || lower(e.durum) ELSE '90 gündür kullanılmadı' END
    FROM hizmet_hesabi_envanteri x LEFT JOIN entegrasyon_tanimi e ON e.kimlik = x.entegrasyon_ref
    WHERE v.kullanici_ref = x.kullanici_ref AND v.durum = 'Aktif' AND (e.durum IN ('Askıda', 'Kapalı') OR coalesce(x.son_kullanim, x.olusturma_zamani) < $1::timestamptz - interval '90 days')
    RETURNING v.kullanici_ref, v.sahip_rol_ref, v.askiya_alma_nedeni`, [simdi]);
  for (const r of rows) {
    await db.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Askıda' WHERE kimlik = $1 AND hesap_durumu = 'Aktif'`, [r.kullanici_ref]);
    await db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [r.kullanici_ref]);
    await kartAc(db, { tur: 'Hizmet Hesabı Askıya Alındı', kategori: 'gorev', baslik: `Hizmet Hesabı Askıda · ${r.kullanici_ref}`, ozet: `${r.askiya_alma_nedeni}. Hesap gerekli değilse kapanış yöntemiyle kapatınız; gerekliyse çağıran sistemi doğrulayıp yeniden etkinleştiriniz.`, sahipRol: r.sahip_rol_ref, nesneTuru: 'Hizmet Hesabı', nesneKimligi: r.kullanici_ref });
  }
  return rows.length;
}

/** YG-1316: gecikmiş, takılmış veya çakışan iş için Sistem Yöneticisine saatte en çok bir uyarı; etkilenen çıktılar uyarıda yazılır. */
export async function zamanlanmisIsDenetimi(db: Pool, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(`SELECT ad, etki, periyot_sn, son_baslangic, son_bitis, son_cakisma,
      (son_bitis IS NULL OR son_bitis < $1::timestamptz - make_interval(secs => periyot_sn * $2)) AND son_baslangic < $1::timestamptz - make_interval(secs => periyot_sn * $2) gecikti,
      son_cakisma > $1::timestamptz - interval '1 hour' cakisti
    FROM zamanlanmis_is_durumu`, [simdi, GECIKME_KAT]);
  const saat = simdi.toISOString().slice(0, 13); let n = 0;
  for (const r of rows) {
    if (!r.gecikti && !r.cakisti) continue;
    const neden = r.gecikti ? 'gecikti veya tamamlanamadı' : 'önceki tur bitmeden yeniden tetiklendi (çakışma)';
    if (!(await birKez(db, 'zamanlanmis-is', `${r.ad}:${saat}`))) continue;
    await kartAc(db, { tur: 'Zamanlanmış İş Uyarısı', kategori: 'islem', baslik: `${r.ad} · ${r.gecikti ? 'Gecikme' : 'Çakışma'}`, ozet: `"${r.ad}" zamanlanmış işi ${neden}. Etkilenen çıktılar: ${r.etki}. Bu çıktılar iş yeniden tamamlanana kadar güncel olmayabilir; nedenini incelemenizi rica ederiz.`, oncelik: 'Yüksek', sahipRol: await rolId(db, 'Sistem Yöneticisi'), nesneTuru: 'Zamanlanmış İş', nesneKimligi: r.ad });
    n++;
  }
  return n;
}

const KOK = ['Geçersiz veya engelli hedef', 'Sağlayıcı veya bağlantı hatası', 'Yanlış iletişim bilgisi', 'Diğer'];
const BI = ['Bilgi İşlem Müdürü', 'Bilgi İşlem Destek Sorumlusu', 'Sistem Yöneticisi'];

export function zamanlayiciYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  // YG-1146: kullanıcının bildirdiği ilişki kimliğiyle istek, değişiklik, gönderim, entegrasyon, görev ve arka plan işi birlikte izlenir.
  s.get('/iliski/:id', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!/^[A-Za-z0-9:-]{8,80}$/.test(id) || !(await bi(i.oturum!.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    const q = async (sql: string) => (await b.db.query(sql, [id])).rows;
    return {
      islemler: await q(`SELECT olay_zamani zaman, eylem, nesne_turu, nesne_kimligi, sonuc, gerekce FROM denetim_izi WHERE iliski_kimligi = $1 ORDER BY olay_zamani`),
      degisiklikler: await q(`SELECT zaman, tablo, nesne, islem FROM kayit_degisikligi WHERE iliski_kimligi = $1 ORDER BY kimlik`),
      gonderimler: await q(`SELECT olusturma_zamani zaman, kanal, konu, durum FROM gonderim WHERE iliski_kimligi = $1 ORDER BY olusturma_zamani`),
      entegrasyon: [...await q(`SELECT olusturma_zamani zaman, 'Entegrasyon Kaydı' tur FROM entegrasyon_kaydi WHERE iliski_kimligi = $1`), ...await q(`SELECT zaman, 'Toplu Aktarım' tur, sonuc FROM toplu_aktarim WHERE iliski_kimligi = $1`)],
      gorevler: await q(`SELECT olusturma_zamani zaman, tur, baslik, durum FROM is_karti WHERE iliski_kimligi = $1 ORDER BY olusturma_zamani`),
      arkaPlanIsi: await q(`SELECT ad, son_baslangic, son_bitis, son_hata FROM zamanlanmis_is_durumu WHERE iliski_kimligi = $1`),
    };
  });
  // YG-510: role göre bildirim kuralı; Sistem Yöneticisi ve Bilgi İşlem tanımlar, değişiklik izlenir.
  s.get('/bildirim-kurali', oturumlu, async (i, y) => {
    if (!(await bi(i.oturum!.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    return { roller: (await b.db.query(`SELECT rol_adi FROM rol ORDER BY rol_adi`)).rows.map((r) => r.rol_adi), kurallar: (await b.db.query(`SELECT r.rol_adi rol, k.tekrar_dakika, to_char(k.sessiz_baslangic, 'HH24:MI') sessiz_baslangic, to_char(k.sessiz_bitis, 'HH24:MI') sessiz_bitis, k.birlestir FROM bildirim_kurali k JOIN rol r ON r.kimlik = k.rol_ref ORDER BY r.rol_adi`)).rows };
  });
  s.post('/bildirim-kurali', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await bi(o.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    const g = (i.body ?? {}) as { rol?: string; tekrarDakika?: number | null; sessizBaslangic?: string | null; sessizBitis?: string | null; birlestir?: boolean };
    const rol = (await b.db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [g.rol ?? ''])).rows[0]?.kimlik;
    const saat = (x: unknown) => x === null || x === undefined || x === '' || (typeof x === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(x));
    if (!rol || !saat(g.sessizBaslangic) || !saat(g.sessizBitis) || Boolean(g.sessizBaslangic) !== Boolean(g.sessizBitis) || (g.tekrarDakika != null && !(Number.isInteger(g.tekrarDakika) && g.tekrarDakika > 0))) return y.code(400).send({ hata: 'Rol, tekrar süresi (dakika) ve sessiz saat aralığını (SS:DD) kontrol ediniz.' });
    const eski = (await b.db.query(`SELECT tekrar_dakika, sessiz_baslangic::text, sessiz_bitis::text, birlestir FROM bildirim_kurali WHERE rol_ref = $1`, [rol])).rows[0] ?? null;
    await b.db.query(`INSERT INTO bildirim_kurali (rol_ref, tekrar_dakika, sessiz_baslangic, sessiz_bitis, birlestir, guncelleyen_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (rol_ref) DO UPDATE SET tekrar_dakika = EXCLUDED.tekrar_dakika, sessiz_baslangic = EXCLUDED.sessiz_baslangic, sessiz_bitis = EXCLUDED.sessiz_bitis, birlestir = EXCLUDED.birlestir, guncelleyen_ref = EXCLUDED.guncelleyen_ref, guncelleme_zamani = now()`,
      [rol, g.tekrarDakika ?? null, g.sessizBaslangic || null, g.sessizBitis || null, Boolean(g.birlestir), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bildirim Kuralı Güncellendi', nesneTuru: 'Rol', nesneKimligi: rol, eski, yeni: { tekrar: g.tekrarDakika ?? null, sessiz: [g.sessizBaslangic ?? null, g.sessizBitis ?? null], birlestir: Boolean(g.birlestir) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // YG-536: türe göre eşikleri süreç sahibi yönetim tanımlar; değişiklik gerekçeyle izlenir.
  const yonetim = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi IN ('CEO', 'Genel Müdür Yardımcısı', 'Operasyon Müdürü')`, [k])).rowCount);
  s.get('/gorev-esigi', oturumlu, async (i, y) => {
    if (!(await yonetim(i.oturum!.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    return { turler: (await b.db.query(`SELECT DISTINCT tur FROM is_karti WHERE kategori IN ('onay', 'gorev') ORDER BY tur`)).rows.map((r) => r.tur), esikler: (await b.db.query(`SELECT tur, onay_sure_dk, uyari_once_dk, eskalasyon_saat, gerekce FROM gorev_turu_esigi ORDER BY tur`)).rows };
  });
  s.post('/gorev-esigi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await yonetim(o.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    const g = (i.body ?? {}) as { tur?: string; onaySureDk?: number | null; uyariOnceDk?: number | null; eskalasyonSaat?: number | null; gerekce?: string };
    const n = (x: unknown, alt: number) => x === null || x === undefined || (Number.isInteger(x) && (x as number) >= alt);
    if (!g.tur?.trim() || !g.gerekce?.trim() || !n(g.onaySureDk, 1) || !n(g.uyariOnceDk, 0) || !n(g.eskalasyonSaat, 1)) return y.code(400).send({ hata: 'Tür, gerekçe ve tam sayı eşikler zorunludur.' });
    if (g.onaySureDk != null && g.uyariOnceDk != null && g.uyariOnceDk >= g.onaySureDk) return y.code(400).send({ hata: 'Uyarı süresi onay süresinden kısa olmalıdır.' });
    const eski = (await b.db.query(`SELECT onay_sure_dk, uyari_once_dk, eskalasyon_saat FROM gorev_turu_esigi WHERE tur = $1`, [g.tur.trim()])).rows[0] ?? null;
    await b.db.query(`INSERT INTO gorev_turu_esigi (tur, onay_sure_dk, uyari_once_dk, eskalasyon_saat, gerekce, guncelleyen_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tur) DO UPDATE SET onay_sure_dk = EXCLUDED.onay_sure_dk, uyari_once_dk = EXCLUDED.uyari_once_dk, eskalasyon_saat = EXCLUDED.eskalasyon_saat, gerekce = EXCLUDED.gerekce, guncelleyen_ref = EXCLUDED.guncelleyen_ref, guncelleme_zamani = now()`,
      [g.tur.trim(), g.onaySureDk ?? null, g.uyariOnceDk ?? null, g.eskalasyonSaat ?? null, g.gerekce.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Görev Türü Eşiği Güncellendi', nesneTuru: 'Görev Türü', nesneKimligi: g.tur.trim(), eski, yeni: { onay: g.onaySureDk ?? null, uyari: g.uyariOnceDk ?? null, eskalasyon: g.eskalasyonSaat ?? null }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // YG-1000: hizmet hesabı envanteri; Bilgi İşlem kaydeder, envantere girmeyen hizmet hesabı veri kalitesi kontrolünde hata olur.
  s.get('/hizmet-hesabi-envanteri', oturumlu, async (i, y) => {
    if (!(await bi(i.oturum!.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    return {
      kayitlar: (await b.db.query(`SELECT v.kullanici_ref, k.ad_soyad, r.rol_adi sahip, v.amac, v.eristigi_veri, v.anahtar_turu, v.anahtar_bitis, v.kaynak_adres, v.calisma_zamani, v.kapanis_yontemi, e.ad entegrasyon, v.son_kullanim, v.durum, v.askiya_alma_nedeni
        FROM hizmet_hesabi_envanteri v JOIN kullanici_hesabi k ON k.kimlik = v.kullanici_ref JOIN rol r ON r.kimlik = v.sahip_rol_ref LEFT JOIN entegrasyon_tanimi e ON e.kimlik = v.entegrasyon_ref ORDER BY k.ad_soyad`)).rows,
      kayitsiz: (await b.db.query(`SELECT k.kimlik, k.ad_soyad FROM kullanici_hesabi k WHERE k.kullanici_grubu = 'Sistem/Hizmet Hesabı' AND k.hesap_durumu <> 'Kapalı' AND NOT EXISTS (SELECT 1 FROM hizmet_hesabi_envanteri v WHERE v.kullanici_ref = k.kimlik)`)).rows,
    };
  });
  s.post('/hizmet-hesabi-envanteri', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await bi(o.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    const g = (i.body ?? {}) as Record<string, string | undefined>;
    const z = ['hesap', 'sahipRol', 'amac', 'eristigiVeri', 'anahtarTuru', 'anahtarBitis', 'kaynakAdres', 'calismaZamani', 'kapanisYontemi'];
    if (z.some((k) => !g[k]?.trim()) || !['API Anahtarı', 'Sertifika'].includes(g.anahtarTuru!) || !/^\d{4}-\d{2}-\d{2}$/.test(g.anahtarBitis!)) return y.code(400).send({ hata: 'Hesap, sahip rol, amaç, eriştiği veri, anahtar türü ve bitişi, kaynak adres, çalışma zamanı ve kapanış yöntemi zorunludur.' });
    const rol = (await b.db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [g.sahipRol])).rows[0]?.kimlik;
    if (!rol) return y.code(400).send({ hata: 'Sahip rolü listeden seçiniz.' });
    try {
      await b.db.query(`INSERT INTO hizmet_hesabi_envanteri (kullanici_ref, sahip_rol_ref, amac, eristigi_veri, anahtar_turu, anahtar_bitis, kaynak_adres, calisma_zamani, kapanis_yontemi, entegrasyon_ref, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (kullanici_ref) DO UPDATE SET sahip_rol_ref = EXCLUDED.sahip_rol_ref, amac = EXCLUDED.amac, eristigi_veri = EXCLUDED.eristigi_veri, anahtar_turu = EXCLUDED.anahtar_turu, anahtar_bitis = EXCLUDED.anahtar_bitis, kaynak_adres = EXCLUDED.kaynak_adres, calisma_zamani = EXCLUDED.calisma_zamani, kapanis_yontemi = EXCLUDED.kapanis_yontemi, entegrasyon_ref = EXCLUDED.entegrasyon_ref`,
        [g.hesap, rol, g.amac!.trim(), g.eristigiVeri!.trim(), g.anahtarTuru, g.anahtarBitis, g.kaynakAdres!.trim(), g.calismaZamani!.trim(), g.kapanisYontemi!.trim(), g.entegrasyon && /^[0-9a-f-]{36}$/.test(g.entegrasyon) ? g.entegrasyon : null, o.kullanici]);
    } catch (h) { if (/Sistem\/Hizmet/.test((h as Error).message) || (h as { code?: string }).code === '23503') return y.code(400).send({ hata: 'Envantere yalnız Sistem/Hizmet Hesabı grubundaki hesap kaydedilir.' }); throw h; }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Hizmet Hesabı Envanteri', nesneTuru: 'Hizmet Hesabı', nesneKimligi: g.hesap, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  const bi = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[])`, [k, BI])).rowCount);
  // YG-1309: başarısız gönderimler görünür kuyrukta; dosyası, kök nedeni ve önceki yeniden çalıştırmalarıyla.
  s.get('/gonderim/basarisiz', oturumlu, async (i, y) => {
    if (!(await bi(i.oturum!.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    return { kokNedenler: KOK, satirlar: (await b.db.query(`SELECT g.kimlik, g.kanal, g.konu, g.hedef, g.deneme, g.son_hata, g.kok_neden, g.olusturma_zamani, d.dosya_no,
        (SELECT count(*)::int FROM gonderim_yeniden_calistirma r WHERE r.gonderim_ref = g.kimlik) yeniden
      FROM gonderim g LEFT JOIN dosya d ON d.kimlik = gonderim_dosyasi(g.olay_anahtari) WHERE g.durum = 'Başarısız' ORDER BY g.olusturma_zamani DESC LIMIT 200`)).rows };
  });
  // YG-1309: operatör hedefi düzeltip yeniden çalıştırır; eski ve yeni hedef, eski hata, kök neden ve gerekçe kaydedilir.
  s.post('/gonderim/:id/yeniden', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { hedef?: string; kokNeden?: string; gerekce?: string };
    if (!/^[0-9a-f-]{36}$/.test(id) || !(await bi(o.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    if (!g.gerekce?.trim() || !KOK.includes(g.kokNeden ?? '')) return y.code(400).send({ hata: 'Kök neden ve gerekçe zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const e = (await c.query(`SELECT kanal, hedef, son_hata FROM gonderim WHERE kimlik = $1 AND durum = 'Başarısız' FOR UPDATE`, [id])).rows[0];
      if (!e) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Yalnız başarısız gönderim yeniden çalıştırılır.' }); }
      const yeni = g.hedef?.trim() || e.hedef;
      if (e.kanal === 'E-posta' ? !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(yeni) : !/^\+?[0-9 ()-]{10,20}$/.test(yeni)) { await c.query('ROLLBACK'); return y.code(400).send({ hata: 'Hedef adresi veya numarası geçersiz.' }); }
      await c.query(`INSERT INTO gonderim_yeniden_calistirma (gonderim_ref, yapan_ref, eski_hedef, yeni_hedef, eski_hata, kok_neden, gerekce) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, o.kullanici, e.hedef, yeni, e.son_hata, g.kokNeden, g.gerekce.trim()]);
      await c.query(`UPDATE gonderim SET hedef = $2, kok_neden = $3, durum = 'Bekliyor', deneme = 0, son_hata = NULL, plan_zamani = now() WHERE kimlik = $1`, [id, yeni, g.kokNeden]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Gönderim Yeniden Çalıştırıldı', nesneTuru: 'Gönderim', nesneKimligi: id, eski: { hedef: e.hedef }, yeni: { hedef: yeni }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) {
      await c.query('ROLLBACK').catch(() => {});
      if ((h as { code?: string }).code === '23505') return y.code(409).send({ hata: 'Bu hedefe aynı ileti zaten kayıtlıdır.' });
      throw h;
    } finally { c.release(); }
  });
  s.get('/zamanlanmis-isler', oturumlu, async (i, y) => {
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi IN ('Sistem Yöneticisi', 'Bilgi İşlem Müdürü')`, [i.oturum!.kullanici])).rowCount) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    return (await b.db.query(`SELECT ad, etki, periyot_sn, son_baslangic, son_bitis, son_sure_ms, son_hata, hata_sayisi, cakisma_sayisi, son_cakisma,
        (son_bitis IS NULL OR son_bitis < now() - make_interval(secs => periyot_sn * $1)) AND son_baslangic < now() - make_interval(secs => periyot_sn * $1) gecikti
      FROM zamanlanmis_is_durumu ORDER BY ad`, [GECIKME_KAT])).rows;
  });
}
