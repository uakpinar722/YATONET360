import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { GOSTERGELER } from './gosterge.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const GORUR = ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü', 'Strateji ve Kurumsal Gelişim Direktörü', 'Muhasebe ve Finans Müdürü', 'Bilgi İşlem Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Risk ve Kalite Direktörü', 'Operasyon Müdürü', 'Teknik ve Operasyon Direktörü'];
const TANIMLAR = ['CEO', 'Genel Müdür Yardımcısı', 'Strateji ve Kurumsal Gelişim Direktörü', 'Bilgi İşlem Müdürü'];
/** Hassas raporun dağıtımı yalnız yönetim rollerine yapılır. */
const HASSAS_ALICI = ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü', 'Strateji ve Kurumsal Gelişim Direktörü', 'Muhasebe ve Finans Müdürü', 'Teknik ve Operasyon Direktörü', 'Risk ve Kalite Direktörü', 'Hukuk ve Uyum Direktörü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
const ZAMAN = ['Kayıt', 'Fiilî Olay', 'Onay', 'Kapanış', 'Fatura'];
const dolu = (x?: string) => typeof x === 'string' && x.trim().length > 0;
const bugun = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/** YG-737: her rapor üretimi süre, satır, filtre ve sonuçla kaydedilir; ekranda son başarılı çalışma gösterilir. */
export async function raporCalistir<T>(db: Db, kod: string, filtre: Record<string, unknown>, f: () => Promise<T>, satir?: (x: T) => number): Promise<T> {
  const bas = new Date();
  try {
    const r = await f();
    await db.query(`INSERT INTO rapor_calismasi (kod, baslangic, bitis, sonuc, satir, filtre) VALUES ($1,$2,now(),'Başarılı',$3,$4)`, [kod, bas, satir ? satir(r) : null, filtre]);
    return r;
  } catch (e) {
    await db.query(`INSERT INTO rapor_calismasi (kod, baslangic, bitis, sonuc, filtre, hata) VALUES ($1,$2,now(),'Başarısız',$3,$4)`, [kod, bas, filtre, (e as Error).message.slice(0, 300)]).catch(() => {});
    throw e;
  }
}

/** Kod içindeki göstergelerin ilk tanımları; sahip, göstergenin birimindeki Müdür rolüdür. */
export async function gostergeTanimlari(db: Db): Promise<void> {
  for (const g of GOSTERGELER) {
    if ((await db.query(`SELECT 1 FROM rapor_tanimi WHERE kod = $1`, [g.kod])).rowCount) continue;
    const sahip = (await db.query(`SELECT rol_adi FROM rol WHERE rol_sahibi_birim = $1 ORDER BY kademe = 'Müdür' DESC, kademe = 'Direktör' DESC LIMIT 1`, [g.birimAdi])).rows[0]?.rol_adi ?? g.birimAdi;
    await db.query(`INSERT INTO rapor_tanimi (kod, surum, ad, tur, sahip_rol, amac, kaynak, pay, zaman_boyutu, birim, siklik, beklenen_eylem, test_kaniti, yururluk) VALUES ($1,1,$2,'Gösterge',$3,$4,$5,$6,'Kayıt',$7,'Anlık',$8,'Otomatik test: gosterge','2026-11-01') ON CONFLICT DO NOTHING`,
      [g.kod, g.ad, sahip, `Cilt I Tablo ${g.tablo}: ${g.ad}`, g.sql ?? 'Kod içi hesap (gosterge.ts)', g.ad, g.birim, g.yon === 'dusuk' ? 'Eşik aşılınca süreç sahibinin düzeltici eylemi' : 'Eşik altında süreç sahibinin düzeltici eylemi']);
  }
}

/** Yürürlük günü gelen sürüm yürürlüğe girer; dağıtım listesinden ayrılan, pasif veya süresi biten alıcı çıkar (YG-752, YG-753). */
export async function raporKatalogIsle(db: Pool): Promise<number> {
  let n = 0;
  for (const r of (await db.query(`SELECT kod, surum FROM rapor_tanimi WHERE durum = 'Planlandı' AND yururluk <= $1::date ORDER BY surum`, [bugun()])).rows) {
    await db.query(`UPDATE rapor_tanimi SET durum = 'Yerine Geçti' WHERE kod = $1 AND durum = 'Yürürlükte'`, [r.kod]);
    await db.query(`UPDATE rapor_tanimi SET durum = 'Yürürlükte' WHERE kod = $1 AND surum = $2`, [r.kod, r.surum]); n++;
  }
  n += (await db.query(`UPDATE rapor_dagitim d SET durum = 'Çıkarıldı', cikis_nedeni = CASE WHEN d.bitis < $1::date THEN 'Süre doldu' ELSE 'Hesap veya rol ilişkisi sona erdi' END
    WHERE d.durum = 'Aktif' AND (d.bitis < $1::date OR NOT EXISTS (SELECT 1 FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik AND a.atama_durumu = 'Aktif' WHERE h.kimlik = d.kullanici_ref AND h.hesap_durumu = 'Aktif'))`, [bugun()])).rowCount ?? 0;
  return n;
}

export function raporKataloguYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, l: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, l])).rowCount);

  s.get('/rapor-katalogu', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, GORUR))) return yok(y);
    await gostergeTanimlari(b.db);
    const tanimlar = (await b.db.query(`SELECT t.*, t.yururluk::text yururluk, (SELECT count(*)::int FROM rapor_tanimi x WHERE x.kod = t.kod) surum_sayisi,
        (SELECT jsonb_build_object('bitis', c.bitis, 'satir', c.satir, 'filtre', c.filtre) FROM rapor_calismasi c WHERE c.kod = t.kod AND c.sonuc = 'Başarılı' ORDER BY c.bitis DESC LIMIT 1) son_basarili,
        (SELECT c.bitis FROM rapor_calismasi c WHERE c.kod = t.kod AND c.sonuc = 'Başarısız' AND c.bitis > coalesce((SELECT max(z.bitis) FROM rapor_calismasi z WHERE z.kod = t.kod AND z.sonuc = 'Başarılı'), '-infinity') ORDER BY c.bitis DESC LIMIT 1) son_hata,
        (SELECT jsonb_agg(jsonb_build_object('surum', p.surum, 'yururluk', p.yururluk, 'not', p.degisiklik_notu, 'etki', p.karsilastirma_etkisi)) FROM rapor_tanimi p WHERE p.kod = t.kod AND p.durum = 'Planlandı') planli
      FROM rapor_tanimi t WHERE t.durum = 'Yürürlükte' ORDER BY t.tur DESC, t.kod`)).rows;
    return {
      tanimlar, duzenler: await rolde(o.kullanici, TANIMLAR),
      dagitim: (await b.db.query(`SELECT d.kimlik, d.kod, h.ad_soyad, d.amac, d.bitis::text, d.durum, d.cikis_nedeni FROM rapor_dagitim d JOIN kullanici_hesabi h ON h.kimlik = d.kullanici_ref ORDER BY d.durum, d.kod`)).rows,
      yayinlar: (await b.db.query(`SELECT y.kimlik, y.kod, y.surum, y.donem, y.durum, y.gerekce, y.etkilenen_kararlar, y.zaman, (SELECT x.donem || ' / ' || x.zaman::date FROM rapor_yayini x WHERE x.kimlik = y.dogru_yayin_ref) dogru FROM rapor_yayini y ORDER BY y.zaman DESC LIMIT 100`)).rows,
      hedefGecmisi: (await b.db.query(`SELECT g.kod, g.hedef, g.uyari_esigi, g.kritik_esik, g.gerekce, h.ad_soyad, g.zaman FROM gosterge_hedefi_gecmisi g LEFT JOIN kullanici_hesabi h ON h.kimlik = g.guncelleyen_ref ORDER BY g.zaman DESC LIMIT 100`)).rows,
      kisiler: (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik AND a.atama_durumu = 'Aktif' WHERE h.kullanici_grubu = 'LGM İç Rolü' AND h.hesap_durumu = 'Aktif' ORDER BY h.ad_soyad`)).rows,
    };
  });

  // YG-739, 740, 751, 752: yeni sürüm; test kanıtı, değişiklik notu, karşılaştırma etkisi ve yürürlük tarihi zorunlu; aynı ad başka hesapla kullanılamaz.
  s.post('/rapor-tanimi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, TANIMLAR))) return yok(y);
    const g = (i.body ?? {}) as Record<string, string>;
    const eski = (await b.db.query(`SELECT * FROM rapor_tanimi WHERE kod = $1 ORDER BY surum DESC LIMIT 1`, [g.kod ?? ''])).rows[0];
    if (!dolu(g.kod) || !/^[A-ZÇĞİÖŞÜ0-9.-]{3,30}$/.test(g.kod!)) return y.code(400).send({ hata: 'Rapor kodunu giriniz.' });
    for (const k of ['ad', 'sahipRol', 'amac', 'kaynak', 'pay', 'birim', 'testKaniti']) if (!dolu(g[k])) return y.code(400).send({ hata: 'Ad, sahip, amaç, kaynak, pay (ölçü tanımı), birim ve test kanıtı zorunludur.' });
    if (!ZAMAN.includes(g.zamanBoyutu ?? '') || !['Anlık', 'Günlük', 'Aylık'].includes(g.siklik ?? '') || !['Genel', 'Hassas'].includes(g.hassasiyet ?? 'Genel')) return y.code(400).send({ hata: 'Zaman boyutu, sıklık ve hassasiyeti seçiniz.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.yururluk ?? '') || g.yururluk! < bugun()) return y.code(400).send({ hata: 'Yürürlük tarihi bugün veya sonrası olmalıdır.' });
    if (eski && (!dolu(g.degisiklikNotu) || !dolu(g.karsilastirmaEtkisi))) return y.code(400).send({ hata: 'Yeni sürümde değişiklik notu ve önceki dönemlerle karşılaştırma etkisi zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM rol WHERE rol_adi = $1`, [g.sahipRol!.trim()])).rowCount) return y.code(400).send({ hata: 'Sahip, Rol Kataloğundaki bir rol olmalıdır.' });
    if ((await b.db.query(`SELECT 1 FROM rapor_tanimi WHERE lower(ad) = lower($1) AND kod <> $2 AND durum <> 'Yerine Geçti'`, [g.ad!.trim(), g.kod])).rowCount) return y.code(409).send({ hata: 'Aynı ad başka bir rapor veya göstergede kullanılmaktadır; aynı ad farklı hesapla kullanılamaz.' });
    if ((await b.db.query(`SELECT 1 FROM rapor_tanimi WHERE kod = $1 AND durum = 'Planlandı'`, [g.kod])).rowCount) return y.code(409).send({ hata: 'Bu kodun yürürlüğü bekleyen bir sürümü vardır.' });
    const surum = (eski?.surum ?? 0) + 1; const hemen = g.yururluk === bugun() || !eski;
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      if (hemen && eski) await c.query(`UPDATE rapor_tanimi SET durum = 'Yerine Geçti' WHERE kod = $1 AND durum = 'Yürürlükte'`, [g.kod]);
      await c.query(`INSERT INTO rapor_tanimi (kod, surum, ad, tur, sahip_rol, amac, kaynak, pay, payda, dahil, haric, zaman_boyutu, kesim, birim, yuvarlama, siklik, hassasiyet, beklenen_eylem, test_kaniti, yururluk, degisiklik_notu, karsilastirma_etkisi, durum, hazirlayan_ref)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13,'Dönem sonu 24:00, Europe/Istanbul'),$14,coalesce($15,'Ondalık bir basamak'),$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [g.kod, surum, g.ad!.trim(), g.tur === 'Gösterge' ? 'Gösterge' : 'Rapor', g.sahipRol!.trim(), g.amac!.trim(), g.kaynak!.trim(), g.pay!.trim(), g.payda?.trim() || null, g.dahil?.trim() || null, g.haric?.trim() || null, g.zamanBoyutu, g.kesim?.trim() || null, g.birim!.trim(), g.yuvarlama?.trim() || null, g.siklik, g.hassasiyet ?? 'Genel', g.beklenenEylem?.trim() || null, g.testKaniti!.trim(), g.yururluk, g.degisiklikNotu?.trim() || null, g.karsilastirmaEtkisi?.trim() || null, hemen ? 'Yürürlükte' : 'Planlandı', o.kullanici]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Rapor Tanımı Sürümü', nesneTuru: 'Rapor Tanımı', nesneKimligi: `${g.kod}:${surum}`, gerekce: g.degisiklikNotu, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    return { surum, durum: hemen ? 'Yürürlükte' : 'Planlandı' };
  });

  // YG-753: dağıtım; hassas rapor yalnız yönetim rollerine, amaç ve süreyle.
  s.post('/rapor-dagitim', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, TANIMLAR))) return yok(y);
    const g = (i.body ?? {}) as { kod?: string; kullanici?: string; amac?: string; bitis?: string };
    const t = (await b.db.query(`SELECT hassasiyet FROM rapor_tanimi WHERE kod = $1 AND durum = 'Yürürlükte'`, [g.kod ?? ''])).rows[0];
    if (!t || !dolu(g.kullanici) || !dolu(g.amac) || !/^\d{4}-\d{2}-\d{2}$/.test(g.bitis ?? '') || g.bitis! < bugun()) return y.code(400).send({ hata: 'Rapor, alıcı, amaç ve bitiş tarihi zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif'`, [g.kullanici])).rowCount) return y.code(400).send({ hata: 'Alıcı aktif bir LGM personeli olmalıdır.' });
    if (t.hassasiyet === 'Hassas' && !(await rolde(g.kullanici!, HASSAS_ALICI))) return y.code(409).send({ hata: 'Hassas rapor yalnız yönetim rollerine dağıtılır.' });
    const r = await b.db.query(`INSERT INTO rapor_dagitim (kod, kullanici_ref, amac, bitis, ekleyen_ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING kimlik`, [g.kod, g.kullanici, g.amac!.trim(), g.bitis, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Alıcı bu raporun dağıtım listesindedir.' });
    return { kimlik: r.rows[0].kimlik };
  });
  s.post('/rapor-dagitim/:id/cikar', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(i.oturum!.kullanici, TANIMLAR))) return yok(y);
    await b.db.query(`UPDATE rapor_dagitim SET durum = 'Çıkarıldı', cikis_nedeni = 'Elle çıkarıldı' WHERE kimlik = $1 AND durum = 'Aktif'`, [id]); return { tamam: true };
  });

  // YG-754: yayın kaydı ve geri çağırma; dağıtım listesine duyurulur, doğru sürüm ve etkilenen kararlar kayıtlıdır.
  s.post('/rapor-yayini', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, GORUR))) return yok(y);
    const g = (i.body ?? {}) as { kod?: string; donem?: string; belge?: string };
    const t = (await b.db.query(`SELECT surum FROM rapor_tanimi WHERE kod = $1 AND durum = 'Yürürlükte'`, [g.kod ?? ''])).rows[0];
    if (!t || !/^\d{4}-\d{2}$/.test(g.donem ?? '')) return y.code(400).send({ hata: 'Rapor ve dönem zorunludur.' });
    const r = (await b.db.query(`INSERT INTO rapor_yayini (kod, surum, donem, belge_ref, yayimlayan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.kod, t.surum, g.donem, g.belge && UUID.test(g.belge) ? g.belge : null, o.kullanici])).rows[0].kimlik;
    return { kimlik: r };
  });
  s.post('/rapor-yayini/:id/geri-cagir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(o.kullanici, TANIMLAR))) return yok(y);
    const g = (i.body ?? {}) as { gerekce?: string; etkilenenKararlar?: string; dogruYayin?: string };
    if (!dolu(g.gerekce) || !dolu(g.etkilenenKararlar)) return y.code(400).send({ hata: 'Gerekçe ve etkilenen kararlar zorunludur.' });
    if (g.dogruYayin && (!UUID.test(g.dogruYayin) || g.dogruYayin === id)) return y.code(400).send({ hata: 'Doğru sürüm geçersizdir.' });
    const r = (await b.db.query(`UPDATE rapor_yayini SET durum = 'Geri Çağrıldı', gerekce = $2, etkilenen_kararlar = $3, dogru_yayin_ref = $4, geri_cagiran_ref = $5, geri_cagirma_zamani = now() WHERE kimlik = $1 AND durum = 'Yayımlandı' RETURNING kod, donem`, [id, g.gerekce!.trim(), g.etkilenenKararlar!.trim(), g.dogruYayin ?? null, o.kullanici])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Yayın geri çağrılmış veya bulunamadı.' });
    const alici = (await b.db.query(`SELECT kullanici_ref FROM rapor_dagitim WHERE kod = $1 AND durum = 'Aktif'`, [r.kod])).rows.map((x) => x.kullanici_ref as string);
    if (alici.length) await bildir(b.db, { olay: `rapor-geri:${id}`, kullanicilar: alici, baslik: `${r.kod} · ${r.donem} Raporu Geri Çağrıldı`, ozet: `${g.gerekce!.trim()}${g.dogruYayin ? ' · Doğru sürüm yayımlandı.' : ''}`, oncelik: 'Yüksek' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Rapor Geri Çağrıldı', nesneTuru: 'Rapor Yayını', nesneKimligi: id, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true, bildirilen: alici.length };
  });
}
