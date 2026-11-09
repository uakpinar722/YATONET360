import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

const BTM = 'Bilgi İşlem Müdürü'; const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü';
const GOREN = [BTM, BTD, 'Bilgi İşlem Müdür Yardımcısı', 'Sistem Yöneticisi', 'Bilgi İşlem Destek Sorumlusu']; const KARAR = [BTM, BTD];
const ONEM = ['Düşük', 'Orta', 'Yüksek', 'Kritik'];
/** YG-1192: ayrıcalıklı hesapta önem bir kademe yükselir. */
export const onemHesapla = (taban: string, ayricalikli: boolean) => ONEM[Math.min(ONEM.indexOf(taban) + (ayricalikli ? 1 : 0), ONEM.length - 1)]!;

type Bulgu = { etken: string; n: number; ayricalikli: boolean };
type Kural = { kod: string; ad: string; esik: string; pencere_dk: number; onem: string; beklenen_eylem: string };
const izSay = (eylem: string, sart: string, grup: string) => `SELECT ${grup} etken, count(*)::int n, bool_or(coalesce(h.ayricalikli_mi, false)) ayricalikli FROM denetim_izi z LEFT JOIN kullanici_hesabi h ON h.kimlik = z.aktor_ref WHERE z.eylem = '${eylem}' ${sart} AND z.olay_zamani > $1::timestamptz - make_interval(mins => $2) AND z.olay_zamani <= $1::timestamptz GROUP BY 1 HAVING count(*) >= $3 AND ${grup} IS NOT NULL`;
/** YG-1191: olağan dışı giriş, yetki artışı, toplu indirme, yapılandırma değişikliği ve entegrasyon tekrarları. */
const SORGU: Record<string, string> = {
  BASARISIZ_GIRIS: izSay('Giriş Denemesi', `AND z.sonuc = 'Başarısız'`, 'z.kaynak_adres'),
  KAYITSIZ_CIHAZ: izSay('Kayıtsız Cihazdan Giriş', '', 'z.aktor_ref'),
  YETKISIZ_ERISIM: izSay('Yetkisiz Erişim Denemesi', '', 'z.aktor_ref'),
  TOPLU_INDIRME: izSay('Belge İndirildi', '', 'z.aktor_ref'),
  YETKI_ARTISI: izSay('Rol Atandı', '', 'z.aktor_ref'),
  YAPILANDIRMA: izSay('Parametre Değişikliği', '', 'z.aktor_ref'),
  ENTEGRASYON_TEKRAR: `SELECT 'Gönderim' etken, count(*)::int n, false ayricalikli FROM gonderim g WHERE g.durum = 'Başarısız' AND g.plan_zamani > $1::timestamptz - make_interval(mins => $2) AND g.plan_zamani <= $1::timestamptz HAVING count(*) >= $3`,
};

/** Kural eşiği aşılınca alarm üretir; süreli istisnadaki kural çalışmaz, görünür kalır. Aynı pencerede aynı etken için tek alarm. */
export async function guvenlikTara(db: Pool, simdi = new Date()): Promise<number> {
  const kurallar = (await db.query(`SELECT * FROM guvenlik_kural WHERE istisna_bitis IS NULL OR istisna_bitis <= $1`, [simdi])).rows as Kural[];
  let n = 0;
  for (const k of kurallar) {
    const bulgular = (await db.query(SORGU[k.kod]!, [simdi, k.pencere_dk, k.esik])).rows as Bulgu[];
    const dilim = Math.floor(simdi.getTime() / (k.pencere_dk * 60_000));
    for (const b of bulgular) {
      const no = `GA-${simdi.getUTCFullYear()}-${String(await sayac(db, 'guvenlik_alarmi')).padStart(5, '0')}`; const onem = onemHesapla(k.onem, b.ayricalikli);
      const r = await db.query(`INSERT INTO guvenlik_alarmi (alarm_no, kural_kod, onem, etkilenen, olay_sayisi, beklenen_eylem, anahtar) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (anahtar) DO NOTHING RETURNING kimlik`, [no, k.kod, onem, b.etken, b.n, k.beklenen_eylem, `${k.kod}:${b.etken}:${dilim}`]);
      if (!r.rowCount) continue;
      await kartAc(db, { tur: 'Güvenlik Alarmı', kategori: 'gorev', baslik: `${no} · ${k.ad}`, ozet: k.beklenen_eylem, oncelik: onem === 'Kritik' ? 'Kritik' : onem === 'Yüksek' ? 'Yüksek' : 'Normal', sahipRol: await rolId(db, BTM), nesneTuru: 'Güvenlik Alarmı', nesneKimligi: r.rows[0].kimlik });
      n++;
    }
  }
  return n;
}

export function guvenlikIzlemeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);
  const var_ = async (k: string, l: string[]) => (await roller(k)).some((r) => l.includes(r));

  s.get('/guvenlik', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await var_(o.kullanici, GOREN))) return yok(y);
    return {
      karar: await var_(o.kullanici, KARAR),
      alarmlar: (await b.db.query(`SELECT a.kimlik, a.alarm_no, k.ad, a.onem, a.etkilenen, a.olay_sayisi, a.beklenen_eylem, a.durum, a.olusturma_zamani, a.kabul_zamani, a.inceleme_zamani, a.sinirlama_zamani, a.kapanis_zamani FROM guvenlik_alarmi a JOIN guvenlik_kural k ON k.kod = a.kural_kod ORDER BY a.durum = 'Kapalı', a.olusturma_zamani DESC LIMIT 200`)).rows,
      kurallar: (await b.db.query(`SELECT kod, ad, esik, pencere_dk, onem, istisna_bitis, istisna_gerekce FROM guvenlik_kural ORDER BY ad`)).rows,
      kirCam: (await b.db.query(`SELECT e.kimlik, e.kapsam, e.gerekce, e.durum, e.kisisel_veri, e.sir_yenilendi, h.ad_soyad FROM kir_cam_erisim e JOIN kullanici_hesabi h ON h.kimlik = e.kullanan_ref ORDER BY e.durum = 'Kapatıldı', e.olusturma_zamani DESC LIMIT 100`)).rows,
    };
  });

  // YG-1192: kabul, inceleme, sınırlama ve kapanış ayrı zamanlanır.
  const ADIM: Record<string, { alan: string; durum: string }> = { Kabul: { alan: 'kabul_zamani', durum: 'Kabul' }, İnceleme: { alan: 'inceleme_zamani', durum: 'İncelemede' }, Sınırlama: { alan: 'sinirlama_zamani', durum: 'Sınırlandı' }, Kapanış: { alan: 'kapanis_zamani', durum: 'Kapalı' } };
  s.post('/guvenlik/alarm/:id/adim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { adim?: string; not?: string };
    if (!UUID.test(id) || !(await var_(o.kullanici, GOREN))) return yok(y);
    const a = ADIM[g.adim ?? '']; if (!a || (g.adim === 'Kapanış' && !g.not?.trim())) return y.code(400).send({ hata: 'Adım geçersizdir; kapanışta not zorunludur.' });
    const r = await b.db.query(`UPDATE guvenlik_alarmi SET durum = $2, ${a.alan} = coalesce(${a.alan}, now()), kapanis_notu = coalesce($3, kapanis_notu) WHERE kimlik = $1 AND durum <> 'Kapalı' RETURNING kimlik`, [id, a.durum, g.not?.trim() || null]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Alarm kapanmıştır.' });
    if (g.adim === 'Kapanış') await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Güvenlik Alarmı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Güvenlik Alarmı ${g.adim}`, nesneTuru: 'Güvenlik Alarmı', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-1193: oturum sonlandırma ve erişim askısı uygulanır; altyapı tedbirleri karar kaydı olarak tutulur.
  const TEDBIR = ['Oturum Sonlandırma', 'Erişim Askıya Alma', 'Anahtar İptali', 'Bağlantı Sınırlama', 'Kayıt Dondurma'];
  s.post('/guvenlik/alarm/:id/tedbir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; hedef?: string; gerekce?: string };
    if (!UUID.test(id) || !(await var_(o.kullanici, KARAR))) return yok(y);
    if (!TEDBIR.includes(g.tur ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Tedbir türü ve gerekçe zorunludur.' });
    const hesapli = TEDBIR.indexOf(g.tur!) < 2;
    if (hesapli && (!g.hedef || g.hedef === o.kullanici || !(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1`, [g.hedef])).rowCount)) return y.code(400).send({ hata: 'Hedef kullanıcı geçersizdir.' });
    if (!(await b.db.query(`SELECT 1 FROM guvenlik_alarmi WHERE kimlik = $1`, [id])).rowCount) return yok(y);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      if (g.tur === 'Erişim Askıya Alma') await c.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Askıda' WHERE kimlik = $1`, [g.hedef]);
      if (hesapli) await c.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [g.hedef]);
      await c.query(`INSERT INTO guvenlik_tedbiri (alarm_ref, tur, hedef, gerekce, karar_veren_ref, uygulandi) VALUES ($1,$2,$3,$4,$5,$6)`, [id, g.tur, g.hedef ?? null, g.gerekce.trim(), o.kullanici, hesapli]);
      await c.query(`UPDATE guvenlik_alarmi SET durum = 'Sınırlandı', sinirlama_zamani = coalesce(sinirlama_zamani, now()) WHERE kimlik = $1 AND durum <> 'Kapalı'`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Güvenlik Tedbiri', nesneTuru: 'Güvenlik Alarmı', nesneKimligi: id, yeni: { tur: g.tur, hedef: g.hedef }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { uygulandi: hesapli };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  // YG-1194: eşik gevşetme ve istisna gerekçeli, süreli ve görünürdür; Direktör bilgilendirilir.
  s.post('/guvenlik/kural/:kod', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string }; const g = (i.body ?? {}) as { esik?: unknown; istisnaBitis?: string; gerekce?: string };
    if (!(await var_(o.kullanici, KARAR))) return yok(y);
    const k = (await b.db.query(`SELECT ad, esik FROM guvenlik_kural WHERE kod = $1`, [kod])).rows[0]; if (!k) return yok(y);
    const esik = g.esik === undefined ? null : Number(g.esik);
    if (!g.gerekce?.trim() || (esik === null && !g.istisnaBitis) || (esik !== null && !(esik >= 1)) || (g.istisnaBitis && !(new Date(g.istisnaBitis).getTime() > Date.now()))) return y.code(400).send({ hata: 'Gerekçe ile geçerli eşik veya gelecekte biten istisna zorunludur.' });
    await b.db.query(`UPDATE guvenlik_kural SET esik = coalesce($2, esik), istisna_bitis = coalesce($3, istisna_bitis), istisna_gerekce = CASE WHEN $3::timestamptz IS NOT NULL THEN $4 ELSE istisna_gerekce END WHERE kod = $1`, [kod, esik, g.istisnaBitis ?? null, g.gerekce.trim()]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Alarm Kuralı Değişikliği', nesneTuru: 'Güvenlik Kuralı', nesneKimligi: kod, eski: { esik: k.esik }, yeni: { esik, istisnaBitis: g.istisnaBitis }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    await bildir(b.db, { olay: `guvenlik-kural:${kod}:${Date.now()}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, BTD)), baslik: `Alarm Kuralı Değişti: ${k.ad}`, ozet: g.gerekce.trim().slice(0, 200) });
    return { tamam: true };
  });

  // YG-1190: onay makamı Bilgi İşlem Müdürü; Müdürün kendi erişimini Direktör onaylar; kişisel veride veri sahibi onayı aranır; kapanışta sır yenileme ve bağımsız inceleme zorunludur.
  s.post('/guvenlik/kir-cam', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kapsam?: string; gerekce?: string; kisiselVeri?: boolean };
    if (!(await var_(o.kullanici, GOREN))) return yok(y);
    if (!g.kapsam?.trim() || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Kapsam ve gerekçe zorunludur.' });
    const r = await b.db.query(`INSERT INTO kir_cam_erisim (kullanan_ref, kapsam, gerekce, kisisel_veri) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [o.kullanici, g.kapsam.trim(), g.gerekce.trim(), Boolean(g.kisiselVeri)]);
    const makam = (await var_(o.kullanici, [BTM])) ? BTD : BTM;
    await bildir(b.db, { olay: `kir-cam:${r.rows[0].kimlik}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, makam)), baslik: 'Acil Erişim Talebi', ozet: g.kapsam.trim().slice(0, 200), oncelik: 'Kritik' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Acil Erişim Talebi', nesneTuru: 'Acil Erişim', nesneKimligi: r.rows[0].kimlik, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.rows[0].kimlik };
  });
  s.post('/guvenlik/kir-cam/:id/onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { veriSahibiOnayi?: string };
    if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT * FROM kir_cam_erisim WHERE kimlik = $1`, [id])).rows[0]; if (!e) return yok(y);
    const makam = (await var_(e.kullanan_ref, [BTM])) ? BTD : BTM;
    if (e.kullanan_ref === o.kullanici || !(await var_(o.kullanici, [makam]))) return yok(y);
    if (e.kisisel_veri && !g.veriSahibiOnayi?.trim()) return y.code(400).send({ hata: 'Kişisel veriye dokunan erişimde veri sahibinin onayı kaydedilmelidir.' });
    const r = await b.db.query(`UPDATE kir_cam_erisim SET durum = 'Aktif', onaylayan_ref = $2, onay_zamani = now(), veri_sahibi_onayi = $3 WHERE kimlik = $1 AND durum = 'Talep'`, [id, o.kullanici, g.veriSahibiOnayi?.trim() || null]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu talep onay aşamasında değildir.' });
    await bildir(b.db, { olay: `kir-cam-aktif:${id}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, BTD)), baslik: 'Acil Erişim Kullanılıyor', ozet: e.kapsam.slice(0, 200), oncelik: 'Kritik' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Acil Erişim Onayı', nesneTuru: 'Acil Erişim', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/guvenlik/kir-cam/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sirYenilendi?: boolean; inceleme?: string };
    if (!UUID.test(id) || !(await var_(o.kullanici, GOREN))) return yok(y);
    const e = (await b.db.query(`SELECT kullanan_ref, onaylayan_ref FROM kir_cam_erisim WHERE kimlik = $1 AND durum = 'Aktif'`, [id])).rows[0]; if (!e) return y.code(409).send({ hata: 'Açık acil erişim bulunmamaktadır.' });
    if (o.kullanici === e.kullanan_ref || o.kullanici === e.onaylayan_ref) return y.code(403).send({ hata: 'Bağımsız inceleme kullanan ve onaylayan dışında biri tarafından yapılır.' });
    if (g.sirYenilendi !== true || !g.inceleme?.trim()) return y.code(400).send({ hata: 'Sır yenileme teyidi ve inceleme notu zorunludur.' });
    await b.db.query(`UPDATE kir_cam_erisim SET durum = 'Kapatıldı', sir_yenilendi = true, inceleyen_ref = $2, inceleme_notu = $3, kapanis_zamani = now() WHERE kimlik = $1`, [id, o.kullanici, g.inceleme.trim()]);
    return { tamam: true };
  });

  // YG-1188: geçici destek erişiminin ekran paylaşımı, dosya indirme ve uzaktan yönetim kaydı.
  s.post('/guvenlik/destek-erisim', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; kullanici?: string; kapsam?: string; destekNo?: string };
    if (!(await var_(o.kullanici, GOREN))) return yok(y);
    if (!['Ekran Paylaşımı', 'Dosya İndirme', 'Uzaktan Yönetim'].includes(g.tur ?? '') || !g.kullanici || !g.kapsam?.trim()) return y.code(400).send({ hata: 'Tür, kullanıcı ve kapsam zorunludur.' });
    const r = await b.db.query(`INSERT INTO destek_erisim_kaydi (tur, kullanici_ref, kapsam, destek_no, yapan_ref) SELECT $1,$2,$3,$4,$5 WHERE EXISTS (SELECT 1 FROM kullanici_hesabi WHERE kimlik = $2) RETURNING kimlik`, [g.tur, g.kullanici, g.kapsam.trim(), g.destekNo?.trim() || null, o.kullanici]);
    if (!r.rowCount) return y.code(400).send({ hata: 'Kullanıcı bulunamadı.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Destek Erişimi', nesneTuru: 'Destek Erişimi', nesneKimligi: r.rows[0].kimlik, yeni: { tur: g.tur, kullanici: g.kullanici }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.rows[0].kimlik };
  });
}
