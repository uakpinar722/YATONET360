import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { belgeBagiKaydet } from './belge.js';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const HUD = 'Hukuk ve Uyum Direktörü'; const BIM = 'Bilgi İşlem Müdürü'; const MPI = 'Müşteri ve Paydaş İlişkileri Müdürü'; const OPM = 'Operasyon Müdürü'; const TOD = 'Teknik ve Operasyon Direktörü';

/** YG-1036: teklif onayını veren aynı işte teknik kabul veya ödeme onayı veremez. */
export const teklifOnaylayanlari = async (db: Db, dosya: string): Promise<string[]> => (await db.query(`SELECT DISTINCT a.yapan_ref FROM is_karti_adim a JOIN is_karti k ON k.kimlik = a.is_ref JOIN fiyat_teklifi t ON t.kimlik::text = k.nesne_kimligi WHERE k.tur = 'Fiyat Teklifi' AND t.dosya_ref = $1 AND a.karar IN ('Onayla', 'Onaya Gönder')`, [dosya])).rows.map((r) => r.yapan_ref as string);

/** YG-1036, YG-1037: teknik kabulü veren kişi kaliteyi doğrulamamış ve teklifi onaylamamış olmalıdır. */
export async function teknikKabulAyrimi(db: Db, e: { kimlik: string; dosya_ref: string }, kullanici: string): Promise<string | null> {
  if ((await teklifOnaylayanlari(db, e.dosya_ref)).includes(kullanici)) return 'Görev ayrılığı gereği teklifi onaylayan teknik kabul veremez.';
  if ((await db.query(`SELECT 1 FROM kontrol_noktasi WHERE is_emri_ref = $1 AND $2 = ANY(dogrulayanlar) LIMIT 1`, [e.kimlik, kullanici])).rowCount) return 'Görev ayrılığı gereği kalite kontrolünü doğrulayan teknik kabul veremez.';
  return null;
}

/** YG-1623, YG-1167, YG-1074: dışa giden metinde firma adı müşteriye, sigorta bilgisi firmaya gitmez. Son savunma hattı: kaçak ileti durdurulur, görev açılır. */
/** YG-1074, YG-1167, YG-1174, YG-1623: üretilen belge son denetimden geçer. Müşteri ve sigorta belgesinde dosyadaki firma adı, firma belgesinde sigorta bilgisi, hiçbir dış belgede lehtar adı bulunmaz. */
export async function belgeMaskeEngeli(db: Db, tur: string, dosya: string, metin: string): Promise<string | null> {
  const var_ = (l: (string | null)[]) => l.find((x) => x && x.length >= 4 && metin.includes(x));
  const musteri = ['Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi', 'Teslim Tutanağı', 'Ödeme Sorumluluğu'];
  if (![...musteri, 'İş Emri'].includes(tur)) return null;
  const lehtar = (await db.query(`SELECT y.lehtar_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0]?.lehtar_adi as string | null;
  if (var_([lehtar])) return 'Belgede lehtar bilgisi yer alamaz.';
  if (tur === 'İş Emri') {
    const s = (await db.query(`SELECT sigorta_hasar_dosya_no n FROM dosya_sigorta_kaydi WHERE dosya_ref = $1`, [dosya])).rows.map((r) => r.n as string | null);
    return var_(s) ? 'Sigorta bilgisi firma belgesinde yer alamaz.' : null;
  }
  const f = (await db.query(`SELECT u.ticari_unvan n FROM is_emri e JOIN kurulus u ON u.kimlik = e.kurulus_ref WHERE e.dosya_ref = $1 AND u.kayit_rolu <> 'Tesis'`, [dosya])).rows.map((r) => r.n as string);
  if (var_(f)) return 'Firma kimliği müşteri ve sigorta belgesinde yer alamaz.';
  // YG-1158, YG-992: firma birim fiyatı ve iş emri bedeli (LGM maliyeti) müşteri ve sigorta belgesinde geçemez; satış tutarlarıyla çakışan değer sayılmaz.
  const { tutar } = await import('./metin.js');
  const mal = (await db.query(`SELECT k.birim_fiyat_eur v FROM firma_fiyat_kalemi k JOIN firma_fiyat_teklifi t ON t.kimlik = k.teklif_ref WHERE t.dosya_ref = $1 UNION SELECT firma_bedeli_eur FROM is_emri WHERE dosya_ref = $1 AND firma_bedeli_eur IS NOT NULL`, [dosya])).rows.map((r) => Number(r.v));
  const sat = new Set((await db.query(`SELECT k.birim_satis_fiyati_eur v FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref WHERE f.dosya_ref = $1 UNION SELECT k.tutar_eur FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref WHERE f.dosya_ref = $1 UNION SELECT unnest(ARRAY[ara_toplam_eur, genel_toplam_eur, kdv_tutari_eur, indirim_tutari_eur]) FROM fiyat_teklifi WHERE dosya_ref = $1`, [dosya])).rows.map((r) => Number(r.v)));
  const sizan = mal.filter((m) => m >= 10 && !sat.has(m)).some((m) => [tutar(m, 'tr'), tutar(m, 'en')].some((s) => new RegExp(`(^|[^\\d.,])${s.replace(/[.,]/g, '\\$&')}($|[^\\d])`).test(metin)));
  return sizan ? 'Firma maliyeti müşteri ve sigorta belgesinde yer alamaz.' : null;
}

/** YG-1171: dosya belgesi, dosya tarafı olmayan alıcıya ancak onaylı hasar paylaşım talebiyle paylaşılır. */
export async function hasarPaylasimEngeli(db: Db, bagTuru: string, dosya: string, alici: string): Promise<string | null> {
  if (bagTuru !== 'Dosya') return null;
  if ((await db.query(`SELECT 1 FROM dosya_tarafi WHERE dosya_ref = $1::uuid AND lower(eposta COLLATE "C") = lower($2 COLLATE "C") AND aktif LIMIT 1`, [dosya, alici])).rowCount) return null;
  if ((await db.query(`SELECT 1 FROM hasar_paylasim_talebi WHERE dosya_ref = $1::uuid AND lower(alici COLLATE "C") = lower($2 COLLATE "C") AND durum = 'Onaylandı' LIMIT 1`, [dosya, alici])).rowCount) return null;
  return 'Bu alıcıyla paylaşım için onaylı hasar bilgisi paylaşım talebi bekleniyor.';
}

export async function disMetinEngeli(db: Db, g: { telefon?: string | null; eposta?: string | null; metin: string; konu: string }): Promise<string | null> {
  const a = (await db.query(`SELECT kayit_rolu FROM kurulus WHERE ($1::text IS NOT NULL AND lower(kurumsal_eposta COLLATE "C") = lower($1 COLLATE "C")) OR ($2::text IS NOT NULL AND kurumsal_telefon = $2) LIMIT 1`, [g.eposta ?? null, g.telefon ?? null])).rows[0]
    ?? (await db.query(`SELECT u.kayit_rolu FROM kullanici_hesabi h JOIN kurulus_kullanici k ON k.kullanici_ref = h.kimlik JOIN kurulus u ON u.kimlik = k.kurulus_ref WHERE ($1::text IS NOT NULL AND lower(h.e_posta COLLATE "C") = lower($1 COLLATE "C")) OR ($2::text IS NOT NULL AND h.cep_telefonu = $2) LIMIT 1`, [g.eposta ?? null, g.telefon ?? null])).rows[0];
  const t = `${g.konu} ${g.metin}`;
  if (a) {
    if (a.kayit_rolu === 'Tesis') return null; // YG-1167: Çözüm Ortağının kimliği marinaya açılabilir.
    const s = (await db.query(`SELECT 1 FROM dosya_sigorta_kaydi s LEFT JOIN dosya_tarafi x ON x.kimlik = s.sigorta_taraf_ref WHERE (length(s.sigorta_hasar_dosya_no) >= 4 AND position(s.sigorta_hasar_dosya_no in $1) > 0) OR (length(x.kurulus_unvani) >= 5 AND position(x.kurulus_unvani in $1) > 0) OR (length(s.sigortaci_adi) >= 5 AND position(s.sigortaci_adi in $1) > 0) LIMIT 1`, [t])).rowCount;
    return s ? 'Sigorta bilgisi firmaya gönderilemez.' : null;
  }
  const f = (await db.query(`SELECT ticari_unvan FROM kurulus WHERE kayit_rolu IN ('Çözüm Ortağı', 'Tedarikçi') AND length(ticari_unvan) >= 5 AND position(ticari_unvan in $1) > 0 LIMIT 1`, [t])).rowCount;
  return f ? 'Firma kimliği müşteriye veya sigortaya gönderilemez.' : null;
}

/** YG-1031, YG-1070, YG-1073, YG-1086, YG-1566: Yat Yetkilisi yalnız geçerli belgedeki işlem, limit ve süre içinde onaylar. */
export const yetkiliOnaylari = async (db: Db, kullanici: string) => (await db.query(`SELECT t.kimlik, t.ony_kod, t.baslik, t.belge_adi, t.son_gecerlilik, d.dosya_no FROM yat_yetkilisi_kaydi y JOIN onay_talebi t ON t.telefon = y.sahip_telefon LEFT JOIN dosya d ON d.kimlik = t.dosya_ref WHERE y.kullanici_ref = $1 AND y.belge_durumu = 'Geçerli' AND y.bitis_tarihi >= current_date AND t.durum = 'Bekliyor' AND t.son_gecerlilik > now() AND t.ony_kod = ANY(y.islem_turleri) AND (t.tutar_eur IS NULL OR t.tutar_eur <= coalesce(y.ust_limit_eur, 0)) ORDER BY t.son_gecerlilik`, [kullanici])).rows;

/** Onay yetkiliye geçer; kod yetkilinin telefonuna gider, kayıtta asıl alıcı saklanır. */
export async function yetkiliyeDevret(db: Db, id: string, kullanici: string): Promise<boolean> {
  if (!(await yetkiliOnaylari(db, kullanici)).some((x) => x.kimlik === id)) return false;
  const h = (await db.query(`SELECT ad_soyad, cep_telefonu FROM kullanici_hesabi WHERE kimlik = $1`, [kullanici])).rows[0];
  const r = await db.query(`UPDATE onay_talebi SET adina_onay_sahibi = coalesce(adina_onay_sahibi, alici_ad), alici_kullanici_ref = $2, alici_ad = $3, telefon = $4 WHERE kimlik = $1 AND durum = 'Bekliyor'`, [id, kullanici, h.ad_soyad, h.cep_telefonu]);
  return Boolean(r.rowCount);
}

/** YG-1086: süresi geçen yetki işaretlenir; YG-1153: mobil cihaz kaydı 30 gün sonra yeniden doğrulanır; YG-611: erişimi kalkan paylaşım kapanır. */
export async function yetkiIsle(db: Pool): Promise<number> {
  let n = 0;
  for (const y of (await db.query(`UPDATE yat_yetkilisi_kaydi SET belge_durumu = 'Bekleniyor' WHERE belge_durumu = 'Geçerli' AND bitis_tarihi < current_date RETURNING kullanici_ref`)).rows) { await bildir(db, { olay: `yetki-suresi:${y.kullanici_ref}:${new Date().toISOString().slice(0, 10)}`, kullanicilar: [y.kullanici_ref], baslik: 'Yetki Belgenizin Süresi Doldu', ozet: 'Onay işlemleri yat sahibine iletilecektir.', oncelik: 'Yüksek' }); n++; }
  n += (await db.query(`UPDATE mobil_cihaz SET durum = 'İptal', iptal_nedeni = 'Yeniden Doğrulama', iptal_zamani = now() WHERE durum = 'Aktif' AND son_dogrulama < now() - interval '30 days'`)).rowCount ?? 0;
  for (const p of (await db.query(`SELECT p.kimlik, p.olusturan_ref, b.bag_kimligi FROM paylasim_baglantisi p JOIN belge_surum s ON s.kimlik = p.surum_ref JOIN belge b ON b.kimlik = s.belge_ref WHERE p.iptal_zamani IS NULL AND p.son_gecerlilik > now() AND b.bag_turu = 'Dosya'`)).rows) {
    if (await dosyaErisimi(db, p.olusturan_ref, p.bag_kimligi)) continue;
    await db.query(`UPDATE paylasim_baglantisi SET iptal_zamani = now() WHERE kimlik = $1`, [p.kimlik]);
    if (await birKez(db, 'paylasim_gozden', p.bag_kimligi)) { const d = (await db.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1::uuid`, [p.bag_kimligi])).rows[0]; if (d?.dosya_sorumlusu_ref) await kartAc(db, { tur: 'Paylaşım Gözden Geçirme', kategori: 'islem', baslik: `${d.dosya_no} · Paylaşım Bağlantısı Kapatıldı`, ozet: 'Bağlantıyı oluşturanın dosya erişimi kalktı; gerekiyorsa yeni bağlantı oluşturunuz.', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: p.bag_kimligi }); }
    n++;
  }
  for (const r of (await db.query(`SELECT k.kimlik, k.sahip_rol, h.ad_soyad FROM risk_kabulu k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.yeniden_inceleme <= current_date`)).rows) if (await birKez(db, 'risk_kabulu', r.kimlik)) { await kartAc(db, { tur: 'Risk Kabulü İncelemesi', kategori: 'islem', baslik: `Risk Kabulü İncelemesi · ${r.ad_soyad}`, sahipRol: await rolId(db, BIM), nesneTuru: 'Risk Kabulü', nesneKimligi: r.kimlik }); n++; }
  return n;
}

belgeBagiKaydet('Değişiklik Bileti', async (db, k, id) => { const r = (await db.query(`SELECT hazirlayan_ref FROM degisiklik_bileti WHERE kimlik::text = $1`, [id])).rows[0]; if (!r) return 'yok'; return r.hazirlayan_ref === k ? 'tamam' : 'yetkisiz'; });
kapanisKaydet('Firma Kimliği Açıklama', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') await c.query(`UPDATE firma_kimlik_aciklama SET durum = 'Onaylandı', onaylayan_ref = $2 WHERE kimlik = $1::uuid`, [k.nesne_kimligi, yapan]);
  else if (karar === 'Reddet') await c.query(`UPDATE firma_kimlik_aciklama SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
kapanisKaydet('Değişiklik Bileti', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE degisiklik_bileti SET durum = 'Onaylandı' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE degisiklik_bileti SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
kapanisKaydet('Hasar Bilgisi Paylaşımı', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE hasar_paylasim_talebi SET durum = 'Onaylandı' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE hasar_paylasim_talebi SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

export function yetkiEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  // YG-296, YG-1168: firma kimliği yalnız mahkeme veya resmî makam talebiyle, Hukuk ve Uyum Direktörü onayıyla.
  s.post('/dosya/:id/firma-kimlik-aciklama', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { firma?: string; makam?: string; dayanak?: string; belge?: string; duzey?: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, ['Hukuk ve Uyum Uzmanı']))) return y.code(403).send({ hata: 'Talebi Hukuk ve Uyum Uzmanı hazırlar.' });
    if (!g.firma || !UUID.test(g.firma) || !['Mahkeme', 'Yetkili Resmî Makam'].includes(g.makam ?? '') || !g.dayanak?.trim() || !g.duzey?.trim() || !g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Firma, makam, dayanak, belge ve açıklama düzeyi zorunludur.' });
    const r = (await b.db.query(`INSERT INTO firma_kimlik_aciklama (dosya_ref, kurulus_ref, talep_eden_makam, dayanak, dayanak_belge_ref, aciklama_duzeyi, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [id, g.firma, g.makam, g.dayanak.trim(), g.belge, g.duzey.trim(), o.kullanici])).rows[0];
    await kartAc(b.db, { tur: 'Firma Kimliği Açıklama', baslik: `Firma Kimliği Açıklama · ${g.makam}`, ozet: g.duzey.trim(), oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(b.db, HUD)], nesneTuru: 'Firma Kimliği', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik };
  });

  // YG-1160: Kritik belgede erişim grubu kişi adlarıyla.
  s.get('/belge/:id/erisim-grubu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT olusturan_ref FROM belge WHERE kimlik = $1 AND bilgi_sinifi = 'Kritik'`, [id])).rows[0];
    if (!e || (e.olusturan_ref !== o.kullanici && !(await rolVar(o.kullanici, [HUD])))) return yok(y);
    return (await b.db.query(`SELECT h.kimlik, h.ad_soyad FROM belge_erisim_grubu g JOIN kullanici_hesabi h ON h.kimlik = g.kullanici_ref WHERE g.belge_ref = $1 ORDER BY h.ad_soyad`, [id])).rows;
  });
  s.post('/belge/:id/erisim-grubu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const k = ((i.body ?? {}) as { kullanici?: string }).kullanici;
    if (!UUID.test(id) || !k) return yok(y);
    const e = (await b.db.query(`SELECT olusturan_ref FROM belge WHERE kimlik = $1 AND bilgi_sinifi = 'Kritik'`, [id])).rows[0];
    if (!e || e.olusturan_ref !== o.kullanici) return yok(y);
    await b.db.query(`INSERT INTO belge_erisim_grubu (belge_ref, kullanici_ref, ekleyen_ref) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, k, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kritik Erişim Grubu', nesneTuru: 'belge', nesneKimligi: id, yeni: { kullanici: k }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-1001: veri tabanına doğrudan müdahale bileti.
  s.post('/degisiklik-bileti', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { konu?: string; gerekce?: string; kisiselVeri?: boolean; veriSahibiRol?: string };
    if (!(await rolVar(o.kullanici, ['Sistem Yöneticisi', BIM]))) return y.code(403).send({ hata: 'Bileti Sistem Yöneticisi açar.' });
    if (!g.konu?.trim() || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Konu ve gerekçe zorunludur.' });
    if (g.kisiselVeri && !g.veriSahibiRol) return y.code(400).send({ hata: 'Kişisel veriye dokunan müdahalede veri sahibi rolü zorunludur.' });
    const yil = new Date().getFullYear(); const no = `DGS-${yil}-${String(await sayac(b.db, `dgs:${yil}`)).padStart(4, '0')}`;
    const r = (await b.db.query(`INSERT INTO degisiklik_bileti (bilet_no, konu, gerekce, kisisel_veri, veri_sahibi_rol, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [no, g.konu.trim(), g.gerekce.trim(), Boolean(g.kisiselVeri), g.veriSahibiRol ?? null, o.kullanici])).rows[0];
    const zincir = [await rolId(b.db, BIM)]; if (g.kisiselVeri) zincir.push(await rolId(b.db, g.veriSahibiRol!));
    await kartAc(b.db, { tur: 'Değişiklik Bileti', baslik: `${no} · ${g.konu.trim()}`, ozet: g.gerekce.trim(), oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir, nesneTuru: 'Değişiklik Bileti', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik, biletNo: no };
  });
  s.post('/degisiklik-bileti/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { oncesi?: string; sonrasi?: string };
    if (!UUID.test(id)) return yok(y);
    if (!g.oncesi || !g.sonrasi || !UUID.test(g.oncesi) || !UUID.test(g.sonrasi)) return y.code(400).send({ hata: 'Öncesi ve sonrası kanıtı zorunludur.' });
    const r = await b.db.query(`UPDATE degisiklik_bileti SET oncesi_kanit_ref = $2, sonrasi_kanit_ref = $3, durum = 'Kapalı', kapanis_zamani = now() WHERE kimlik = $1 AND hazirlayan_ref = $4 AND durum = 'Onaylandı'`, [id, g.oncesi, g.sonrasi, o.kullanici]);
    return r.rowCount ? { tamam: true } : y.code(409).send({ hata: 'Kapatılacak onaylı bilet bulunmamaktadır.' });
  });

  // YG-1171: hasar bilgisi paylaşımı hiyerarşik, isteğe bağlı çift onay.
  s.post('/dosya/:id/hasar-paylasim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { alici?: string; kapsam?: string; cift?: boolean };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g.alici?.trim() || !g.kapsam?.trim()) return y.code(400).send({ hata: 'Alıcı ve kapsam zorunludur.' });
    const r = (await b.db.query(`INSERT INTO hasar_paylasim_talebi (dosya_ref, alici, kapsam, cift_onay, talep_eden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, g.alici.trim(), g.kapsam.trim(), Boolean(g.cift), o.kullanici])).rows[0];
    const zincir = [await rolId(b.db, OPM)]; if (g.cift) zincir.push(await rolId(b.db, TOD));
    await kartAc(b.db, { tur: 'Hasar Bilgisi Paylaşımı', baslik: `Hasar Bilgisi Paylaşımı · ${g.alici.trim()}`, ozet: g.kapsam.trim(), hazirlayan: o.kullanici, zincir, nesneTuru: 'Hasar Paylaşımı', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik };
  });

  // YG-1624: firma ve tedarikçi yalnız Dosya No, İş Emri No veya Yat Adı ile arar; sigorta hasar numarası ölçüt ve sonuç değildir.
  s.get('/firma-portal/ara', oturumlu, async (i, y) => {
    const o = i.oturum!; const q = String((i.query as { q?: string }).q ?? '').trim();
    const f = (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [o.kullanici])).rows[0];
    if (!f) return yok(y);
    if (q.length < 2) return [];
    return (await b.db.query(`SELECT e.kimlik, e.is_emri_no, e.statu, d.dosya_no, x.yat_adi FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref JOIN yat x ON x.kimlik = d.yat_ref WHERE e.kurulus_ref = $1 AND (e.is_emri_no ILIKE '%' || $2 || '%' OR d.dosya_no ILIKE '%' || $2 || '%' OR x.yat_adi ILIKE '%' || $2 || '%') ORDER BY e.olusturma_zamani DESC LIMIT 30`, [f.kurulus_ref, q])).rows;
  });
  s.get('/tedarikci-portal/ara', oturumlu, async (i, y) => {
    const o = i.oturum!; const q = String((i.query as { q?: string }).q ?? '').trim();
    const f = (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [o.kullanici])).rows[0];
    if (!f) return yok(y);
    if (q.length < 2) return [];
    return (await b.db.query(`SELECT s.kimlik, s.siparis_no, d.dosya_no FROM tedarik_siparisi s JOIN dosya d ON d.kimlik = s.dosya_ref JOIN yat x ON x.kimlik = d.yat_ref WHERE s.kurulus_ref = $1 AND (s.siparis_no ILIKE '%' || $2 || '%' OR d.dosya_no ILIKE '%' || $2 || '%' OR x.yat_adi ILIKE '%' || $2 || '%') ORDER BY s.olusturma_zamani DESC LIMIT 30`, [f.kurulus_ref, q])).rows;
  });

  // YG-1027: rıza kayıtları; veri sahibi Müşteri ve Paydaş İlişkileri Müdürü, süreç kontrolü Hukuk ve Uyum Uzmanı.
  s.get('/riza-kayitlari', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [MPI, 'Hukuk ve Uyum Uzmanı', HUD]))) return y.code(403).send({ hata: 'Rıza kayıtlarına yalnız yetkili roller erişir.' });
    return (await b.db.query(`SELECT r.kimlik, h.ad_soyad, r.riza_turu, r.amac, r.kanal, r.durum, r.kaynak, r.onay_adimi, r.metin_surumu, r.onay_zamani, r.geri_alma_zamani, r.geri_alma_kanali, r.iys_bildirim_zamani FROM acik_riza r JOIN kullanici_hesabi h ON h.kimlik = r.ilgili_kisi_ref WHERE r.imha_zamani IS NULL ORDER BY r.onay_zamani DESC LIMIT 300`)).rows;
  });

  // YG-1566: bekleyen yetki belgeleri.
  s.get('/yat-yetkilisi/bekleyen', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [MPI]))) return y.code(403).send({ hata: 'Bu listeyi Müşteri ve Paydaş İlişkileri Müdürü görür.' });
    return (await b.db.query(`SELECT r.kullanici_ref, h.ad_soyad, r.rol, r.sahip_ad, r.belge_ref FROM yat_yetkilisi_kaydi r JOIN kullanici_hesabi h ON h.kimlik = r.kullanici_ref WHERE r.belge_durumu = 'Kontrolde' ORDER BY r.olusturma_zamani`)).rows;
  });
}
