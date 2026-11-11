import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;
const MALI = ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü', 'Muhasebe ve Finans Müdürü', 'Muhasebe ve Finans Müdür Yardımcısı', 'Muhasebe ve Finans Yöneticisi'];
const SATIS_HEDEF = ['Ticari İşler Direktörü', 'Genel Müdür Yardımcısı', 'CEO'];
const SATIS = [...SATIS_HEDEF, 'Müşteri ve Paydaş İlişkileri Müdürü', 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı', 'Müşteri ve Paydaş İlişkileri Uzmanı'];
const YONETIM = ['CEO', 'Genel Müdür Yardımcısı', 'Strateji ve Kurumsal Gelişim Direktörü', 'Risk ve Kalite Direktörü'];
const R2 = (x: number) => Math.round(x * 100) / 100;
const ayAraligi = (donem: string) => { const s = new Date(`${donem}-01T00:00:00Z`); s.setUTCMonth(s.getUTCMonth() + 1); return [`${donem}-01`, s.toISOString().slice(0, 10)] as const; };

/** YG-763: KDV ve tevkifat özeti (fatura tarihine göre, KDV oranı ve durumu kırılımlı). */
export async function kdvOzeti(db: Db, donem: string) {
  const [bas, son] = ayAraligi(donem);
  const satir = (await db.query(`SELECT coalesce(kdv_durumu, 'Standart KDV') durum, coalesce(kdv_orani, 0)::float8 oran, count(*)::int fatura, sum(coalesce(kdv_matrahi_eur, kdv_haric_eur))::float8 matrah, sum(kdv_eur)::float8 kdv, sum(coalesce(tevkifat_eur, 0))::float8 tevkifat, sum(coalesce(kdv_tl, 0))::float8 kdv_tl
    FROM musteri_faturasi WHERE fatura_no IS NOT NULL AND fatura_tarihi >= $1 AND fatura_tarihi < $2 AND durum IN ('Faturalandı', 'Kısmi Tahsil', 'Tahsil Edildi') GROUP BY 1, 2 ORDER BY 1, 2`, [bas, son])).rows;
  const t = (k: string) => R2(satir.reduce((a, x) => a + Number(x[k] ?? 0), 0));
  return { donem, kesim: 'Fatura tarihi; Europe/Istanbul', satir: satir.map((x) => ({ ...x, matrah: R2(x.matrah), kdv: R2(x.kdv), tevkifat: R2(x.tevkifat), beyan: R2(x.kdv - x.tevkifat) })), toplam: { matrah: t('matrah'), kdv: t('kdv'), tevkifat: t('tevkifat'), beyan: R2(t('kdv') - t('tevkifat')), kdvTl: t('kdv_tl') } };
}

/**
 * YG-763: bütçe-gerçekleşme. Bütçe: yılın onaylı bütçe talepleri (birim, kategori). Gerçekleşme (KDV hariç, EUR): onaylı personel masraf fişleri personelin birimine,
 * teslim alınan idari siparişler İdari İşler Müdürlüğüne, doğrulanan veya ödenen hakedişler Operasyon Müdürlüğüne (hizmet maliyeti) yazılır; gelir faturalanan tutardır.
 */
export async function butceGerceklesme(db: Db, yil: number) {
  const bas = `${yil}-01-01`, son = `${yil + 1}-01-01`;
  const butce = (await db.query(`SELECT t.birim, sum(t.tutar_eur)::float8 b FROM butce_talebi t JOIN butce_donemi d ON d.yil = t.yil WHERE t.yil = $1 GROUP BY 1`, [yil])).rows;
  const durum = (await db.query(`SELECT durum FROM butce_donemi WHERE yil = $1`, [yil])).rows[0]?.durum ?? null;
  const masraf = (await db.query(`SELECT coalesce((SELECT r.rol_sahibi_birim FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = m.personel_ref ORDER BY a.atama_durumu = 'Aktif' DESC LIMIT 1), 'Belirsiz') birim, sum(m.odenecek_eur)::float8 g FROM personel_masraf_fisi m WHERE m.fis_tarihi >= $1 AND m.fis_tarihi < $2 AND m.durum IN ('Onaylandı', 'Ödendi') GROUP BY 1`, [bas, son])).rows;
  const idari = Number((await db.query(`SELECT coalesce(sum(coalesce(fatura_tutar_eur, siparis_tutar_eur)), 0) g FROM idari_talep WHERE durum IN ('Teslim Alındı', 'Kapandı', 'Sipariş Onaylandı') AND coalesce(teslim_zamani, olusturma_zamani) >= $1 AND coalesce(teslim_zamani, olusturma_zamani) < $2`, [bas, son])).rows[0].g);
  const hizmet = Number((await db.query(`SELECT coalesce(sum(net), 0) g FROM hakedis WHERE statu IN ('Doğrulandı', 'Ödeme Talimatında', 'Ödendi') AND olusturma_zamani >= $1 AND olusturma_zamani < $2`, [bas, son])).rows[0].g);
  const gelir = Number((await db.query(`SELECT coalesce(sum(kdv_haric_eur), 0) g FROM musteri_faturasi WHERE fatura_no IS NOT NULL AND fatura_tarihi >= $1 AND fatura_tarihi < $2 AND durum IN ('Faturalandı', 'Kısmi Tahsil', 'Tahsil Edildi')`, [bas, son])).rows[0].g);
  const g = new Map<string, number>(); for (const m of masraf) g.set(m.birim, (g.get(m.birim) ?? 0) + Number(m.g));
  g.set('İdari İşler Müdürlüğü', (g.get('İdari İşler Müdürlüğü') ?? 0) + idari); g.set('Operasyon Müdürlüğü', (g.get('Operasyon Müdürlüğü') ?? 0) + hizmet);
  const birimler = [...new Set([...butce.map((x) => x.birim as string), ...g.keys()])].sort();
  const satir = birimler.map((b) => { const bt = Number(butce.find((x) => x.birim === b)?.b ?? 0); const gr = R2(g.get(b) ?? 0); return { birim: b, butce: R2(bt), gerceklesen: gr, fark: R2(bt - gr), oran: bt ? Math.round((1000 * gr) / bt) / 10 : null }; });
  return { yil, butceDurumu: durum, satir, gelir: R2(gelir), toplam: { butce: R2(satir.reduce((a, x) => a + x.butce, 0)), gerceklesen: R2(satir.reduce((a, x) => a + x.gerceklesen, 0)) } };
}

/** YG-805: yaklaşan (30 gün) ve geciken gözden geçirmeler; firma, risk kabulü, saklama istisnası, gözden geçirme görevleri. */
export async function gozdenGecirmeler(db: Db, kullanici: string) {
  return (await db.query(`SELECT * FROM (
      SELECT 'Firma Gözden Geçirmesi' tur, ticari_unvan konu, sonraki_gozden_gecirme_tarihi tarih FROM kurulus WHERE sonraki_gozden_gecirme_tarihi IS NOT NULL AND kayit_rolu = 'Çözüm Ortağı' AND ag_statusu IS DISTINCT FROM 'Çıkarıldı'
      UNION ALL SELECT 'Risk Kabulü Yeniden İnceleme', sahip_rol || ': ' || left(gerekce, 60), yeniden_inceleme FROM risk_kabulu
      UNION ALL SELECT 'Gözden Geçirme Görevi', baslik, son_zaman::date FROM is_karti WHERE durum = 'Bekliyor' AND son_zaman IS NOT NULL AND (tur ILIKE '%gözden geçirme%' OR baslik ILIKE '%gözden geçirme%')
        AND (sahip_kullanici_ref = $1 OR sahip_rol_ref IN (SELECT rol_ref FROM rol_atamasi WHERE kullanici_ref = $1 AND atama_durumu = 'Aktif'))
    ) x WHERE tarih <= current_date + 30 ORDER BY tarih`, [kullanici])).rows.map((r) => ({ tur: r.tur, konu: r.konu, tarih: new Date(r.tarih).toISOString().slice(0, 10), gecikti: new Date(r.tarih) < new Date(new Date().toISOString().slice(0, 10)) }));
}

/** YG-774: yönetim değerlendirmesi girdi seti; her başlık kaynak kayıt numaralarıyla izlenebilir. */
export async function yonetimDegerlendirmesi(db: Db, bas: string, son: string) {
  const q = async (sql: string) => (await db.query(sql, [bas, son])).rows;
  const say = (l: { no: string }[]) => ({ adet: l.length, kayitlar: l.slice(0, 50).map((x) => x.no) });
  return {
    donem: { bas, son },
    guvenlikOlaylari: say(await q(`SELECT olay_no no FROM veri_ihlali WHERE ogrenme_zamani >= $1 AND ogrenme_zamani < $2 UNION ALL SELECT 'OLAY-' || left(kimlik::text, 8) FROM olay_kaydi WHERE olay_turu = 'BT Kesintisi veya Veri İhlali' AND olusturma_zamani >= $1 AND olusturma_zamani < $2`)),
    hizmetOlaylari: say(await q(`SELECT 'OLAY-' || left(kimlik::text, 8) no FROM olay_kaydi WHERE olay_turu <> 'BT Kesintisi veya Veri İhlali' AND olusturma_zamani >= $1 AND olusturma_zamani < $2`)),
    surekliliktestleri: { ...say(await q(`SELECT tur || ' ' || to_char(zaman, 'DD.MM.YYYY') no FROM geri_yukleme_testi WHERE zaman >= $1 AND zaman < $2`)), basarisiz: (await q(`SELECT count(*)::int n FROM geri_yukleme_testi WHERE zaman >= $1 AND zaman < $2 AND sonuc <> 'Başarılı'`))[0].n },
    destekTalepleri: { ...say(await q(`SELECT talep_no no FROM destek_talebi WHERE olusturma_zamani >= $1 AND olusturma_zamani < $2`)), acik: (await q(`SELECT count(*)::int n FROM destek_talebi WHERE olusturma_zamani < $2 AND durum NOT IN ('Kapalı', 'Çözüldü') AND $1::date IS NOT NULL`))[0].n },
    degisiklikler: { uretimeAlinan: say(await q(`SELECT surum no FROM yayin_seti WHERE ortam = 'Üretim' AND uretim_zamani >= $1 AND uretim_zamani < $2`)), geriAlinan: say(await q(`SELECT surum no FROM yayin_seti WHERE ortam = 'Üretim' AND durum = 'Geri Alındı' AND uretim_zamani >= $1 AND uretim_zamani < $2`)) },
    denetimBulgulari: say(await q(`SELECT d.denetim_no || ' · ' || b.sinif no FROM ic_denetim_bulgu b JOIN ic_denetim d ON d.kimlik = b.denetim_ref WHERE b.zaman >= $1 AND b.zaman < $2 UNION ALL SELECT bulgu_no FROM sistem_bulgusu WHERE olusturma_zamani >= $1 AND olusturma_zamani < $2`)),
    istisnalar: say(await q(`SELECT bulgu_no no FROM sistem_bulgusu WHERE durum = 'İstisna' AND $1::date IS NOT NULL AND $2::date IS NOT NULL UNION ALL SELECT 'Risk kabulü · ' || sahip_rol FROM risk_kabulu WHERE yeniden_inceleme >= $1`)),
    acikDuzelticiEylemler: say(await q(`SELECT eylem_no no FROM duzeltici_faaliyet WHERE statu IN ('Açık', 'İşlemde', 'Doğrulamada') AND $1::date IS NOT NULL AND $2::date IS NOT NULL`)),
    veriKalitesi: say(await q(`SELECT 'Dosya ' || dosya_no no FROM dosya WHERE acilis_tarihi >= $1 AND acilis_tarihi < $2 AND (ana_teknik_brans IS NULL OR tahmini_teslim_tarihi IS NULL)`)),
    gostergeHedefDegisiklikleri: say(await q(`SELECT kod || ' · ' || to_char(zaman, 'DD.MM.YYYY') no FROM gosterge_hedefi_gecmisi WHERE zaman >= $1 AND zaman < $2`)),
  };
}

export function yonetimTakipYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, l: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, l])).rowCount);
  const donemAl = (q: unknown) => { const d = (q as { donem?: string })?.donem; const n = new Date(); return d && /^\d{4}-(0[1-9]|1[0-2])$/.test(d) ? d : new Date(Date.UTC(n.getFullYear(), n.getMonth() - 1, 1)).toISOString().slice(0, 7); };
  s.get('/on-muhasebe/kdv-ozeti', oturumlu, async (i, y) => ((await rolde(i.oturum!.kullanici, MALI)) ? kdvOzeti(b.db, donemAl(i.query)) : yok(y)));
  s.get('/on-muhasebe/butce-gerceklesme', oturumlu, async (i, y) => {
    if (!(await rolde(i.oturum!.kullanici, MALI))) return yok(y);
    const yil = Number((i.query as { yil?: string })?.yil) || new Date().getFullYear(); return butceGerceklesme(b.db, yil);
  });
  s.get('/gozden-gecirmeler', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND (r.kademe IN ('Müdür', 'Direktör') OR r.rol_sahibi_birim = 'Üst Yönetim' OR r.rol_adi IN ('Genel Müdür Yardımcısı', 'CEO')) LIMIT 1`, [o.kullanici])).rowCount) return yok(y);
    return gozdenGecirmeler(b.db, o.kullanici);
  });
  s.get('/yonetim-degerlendirmesi', oturumlu, async (i, y) => {
    if (!(await rolde(i.oturum!.kullanici, YONETIM))) return yok(y);
    const q = (i.query ?? {}) as { bas?: string; son?: string }; const t = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
    const yil = new Date().getFullYear(); return yonetimDegerlendirmesi(b.db, t(q.bas) ?? `${yil}-01-01`, t(q.son) ?? `${yil + 1}-01-01`);
  });

  // YG-771: satış planındaki aylık görüşme hedefleri ve gerçekleşen görüşmeler.
  s.get('/satis-gorusmeleri', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, SATIS))) return yok(y);
    const donem = donemAl({ donem: (i.query as { donem?: string })?.donem ?? new Date().toISOString().slice(0, 7) }); const [bas, son] = ayAraligi(donem);
    const hedef = (await b.db.query(`SELECT h.kullanici_ref, k.ad_soyad, h.hedef FROM satis_hedefi h JOIN kullanici_hesabi k ON k.kimlik = h.kullanici_ref WHERE h.donem = $1`, [donem])).rows;
    const gerc = (await b.db.query(`SELECT gorusen_ref, count(*)::int n FROM satis_gorusmesi WHERE tarih >= $1 AND tarih < $2 GROUP BY 1`, [bas, son])).rows;
    return {
      donem, hedefGirer: await rolde(o.kullanici, SATIS_HEDEF),
      ozet: hedef.map((h) => { const g = gerc.find((x) => x.gorusen_ref === h.kullanici_ref)?.n ?? 0; return { kimlik: h.kullanici_ref, ad: h.ad_soyad, hedef: h.hedef, gerceklesen: g, oran: h.hedef ? Math.round((100 * g) / h.hedef) : null }; }),
      gorusmeler: (await b.db.query(`SELECT g.kimlik, g.tarih::text, g.kurum, g.kurum_turu, g.tur, g.sonuc, g.sonraki_adim, k.ad_soyad FROM satis_gorusmesi g JOIN kullanici_hesabi k ON k.kimlik = g.gorusen_ref WHERE g.tarih >= $1 AND g.tarih < $2 ORDER BY g.tarih DESC`, [bas, son])).rows,
      kisiler: (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik AND a.atama_durumu = 'Aktif' JOIN rol r ON r.kimlik = a.rol_ref WHERE r.rol_adi = ANY($1::text[]) ORDER BY h.ad_soyad`, [SATIS])).rows,
    };
  });
  s.post('/satis-hedefi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, SATIS_HEDEF))) return yok(y);
    const g = (i.body ?? {}) as { donem?: string; kullanici?: string; hedef?: number };
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(g.donem ?? '') || !g.kullanici || !Number.isInteger(g.hedef) || g.hedef! < 0) return y.code(400).send({ hata: 'Dönem, kişi ve hedef görüşme sayısı zorunludur.' });
    if (!(await rolde(g.kullanici, SATIS))) return y.code(400).send({ hata: 'Hedef yalnız satış ve müşteri ilişkileri rollerine verilir.' });
    await b.db.query(`INSERT INTO satis_hedefi (donem, kullanici_ref, hedef, giren_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (donem, kullanici_ref) DO UPDATE SET hedef = EXCLUDED.hedef, giren_ref = EXCLUDED.giren_ref, zaman = now()`, [g.donem, g.kullanici, g.hedef, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Satış Görüşme Hedefi', nesneTuru: 'Satış Hedefi', nesneKimligi: `${g.donem}:${g.kullanici}`, yeni: { hedef: g.hedef }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/satis-gorusmesi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, SATIS))) return yok(y);
    const g = (i.body ?? {}) as { tarih?: string; kurum?: string; kurumTuru?: string; tur?: string; sonuc?: string; sonrakiAdim?: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.tarih ?? '') || !g.kurum?.trim() || !['Sigorta Şirketi', 'Broker / Acente', 'Kurumsal Müşteri', 'Marina / Tesis', 'Diğer'].includes(g.kurumTuru ?? '') || !['Yüz Yüze', 'Telefon', 'Video', 'E-posta'].includes(g.tur ?? '') || !g.sonuc?.trim()) return y.code(400).send({ hata: 'Tarih, kurum, kurum türü, görüşme türü ve sonuç zorunludur.' });
    if (g.tarih! > new Date().toISOString().slice(0, 10)) return y.code(400).send({ hata: 'Gelecek tarihli görüşme kaydedilemez.' });
    const r = (await b.db.query(`INSERT INTO satis_gorusmesi (tarih, kurum, kurum_turu, tur, sonuc, sonraki_adim, gorusen_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [g.tarih, g.kurum.trim(), g.kurumTuru, g.tur, g.sonuc.trim(), g.sonrakiAdim?.trim() || null, o.kullanici])).rows[0].kimlik;
    return { kimlik: r };
  });
}
