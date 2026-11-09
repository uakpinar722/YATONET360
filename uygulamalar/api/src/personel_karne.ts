import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { EK_SORGU } from './karne_olcumler.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { dosyaButcesi } from './risk_rezervi.js';
import { DURAK_SN } from './sure.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const DONEM = /^\d{4}-\d{2}$/; const IKS = 'İnsan Kaynakları Sorumlusu'; const ITIRAZ = 'Personel Karne İtirazı'; const KAPANIS = 'Karne Dönemi Kapanışı'; const AGIRLIK = 'Karne Ağırlık Değişikliği';
const istanbulAy = (d = new Date()) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 7);
const yuvarla = (x: number) => Math.round(x * 100) / 100;

type Olcum = { pay: number; payda: number; kapsam?: string; dogrudan?: boolean };
type Gosterge = { kimlik: string; gosterge: string; hesap: string; hedef: string; agirlik: string };
export type Satir = { kimlik: string; gosterge: string; hesap: string; hedef: string; agirlik: number; pay: number | null; payda: number | null; deger: number | null; puan: number | null; kapsam: string | null };

/** Kayıt taramasıyla hesaplanan göstergeler; listede olmayan gösterge "Ölçüm Yok" kalır ve puana girmez. */
const ONAY_GOSTERGE = new Set(['Onay süresi uyumu', 'Silsile işlem süresi', 'Kademe onay süresi uyumu']);
async function onaySureOlc(db: Db, kullanici: string, rol: string, donem: string, siparis: boolean): Promise<Olcum | null> {
  const r = (await db.query(
    `WITH s AS (SELECT a.yapan_ref, a.rol_ref, a.zaman, k.tur, coalesce(lag(a.zaman) OVER (PARTITION BY a.is_ref ORDER BY a.zaman), k.olusturma_zamani) gelis,
        (SELECT deger FROM sistem_parametresi WHERE kod = CASE k.oncelik WHEN 'Kritik' THEN 'onay_sure_dk_kritik' WHEN 'Yüksek' THEN 'onay_sure_dk_yuksek' WHEN 'Planlı' THEN 'onay_sure_dk_planli' ELSE 'onay_sure_dk_normal' END) dk
       FROM is_karti_adim a JOIN is_karti k ON k.kimlik = a.is_ref WHERE k.kategori = 'onay')
     SELECT count(*)::int payda, (count(*) FILTER (WHERE extract(epoch FROM zaman - gelis) / 60 <= coalesce(dk, 240)))::int pay FROM s
      WHERE (yapan_ref = $1 OR (yapan_ref IS NULL AND rol_ref = $2)) AND to_char(zaman AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM') = $3 AND (NOT $4 OR tur ILIKE '%sipariş%')`, [kullanici, rol, donem, siparis])).rows[0];
  return r.payda ? { pay: r.pay, payda: r.payda } : null;
}
const ay = (alan: string) => `to_char(${alan} AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM') = $2`;
const kapanan = `FROM kapanis_kontrolu c JOIN dosya d ON d.kimlik = c.dosya_ref WHERE d.dosya_sorumlusu_ref = $1 AND c.durum = 'Onaylandı' AND c.cikis_statusu = 'Teknik Kapalı' AND ${ay('c.kapanis_zamani')}`;
/** Dosya Sorumlusu: dosyaya dayalı göstergeler zorluk katsayısıyla ağırlıklıdır (Cilt I ¶2029). Kaynağı henüz olmayan kısım kapsam notunda görünür. */
const DS_SORGU: Record<string, { sql: string; kapsam?: string }> = {
  'Süre uyumu': { kapsam: 'İlerleme raporu adımı henüz sayılmıyor.', sql: `SELECT sum(k) payda, coalesce(sum(k) FILTER (WHERE ok), 0) pay FROM (
      SELECT d.zorluk_katsayisi k, (s.tamamlanma IS NOT NULL AND s.tamamlanma <= s.bitis + make_interval(secs => ${DURAK_SN})) ok FROM dosya_sure s JOIN dosya d ON d.kimlik = s.dosya_ref WHERE d.dosya_sorumlusu_ref = $1 AND ${ay('s.bitis')} AND (s.tamamlanma IS NOT NULL OR s.bitis < now())
      UNION ALL SELECT d.zorluk_katsayisi, (m.gerceklesme_tarihi IS NOT NULL AND m.gerceklesme_tarihi <= coalesce(m.guncel_tarih, m.baz_tarih)) FROM kilometre_tasi m JOIN dosya d ON d.kimlik = m.dosya_ref WHERE d.dosya_sorumlusu_ref = $1 AND to_char(coalesce(m.guncel_tarih, m.baz_tarih), 'YYYY-MM') = $2 AND (m.gerceklesme_tarihi IS NOT NULL OR coalesce(m.guncel_tarih, m.baz_tarih) < current_date)) x` },
  'Kalite (ilk seferde kabul, uygunsuzluk)': { kapsam: 'Uygunsuzluk düşümü tanımlı olmadığından yalnız ilk seferde kabul sayılıyor.', sql: `SELECT sum(d.zorluk_katsayisi) payda, coalesce(sum(d.zorluk_katsayisi) FILTER (WHERE e.teknik_ret_sayisi = 0), 0) pay FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE d.dosya_sorumlusu_ref = $1 AND EXISTS (SELECT 1 FROM kabul_kaydi k WHERE k.is_emri_ref = e.kimlik AND ${ay('k.olusturma_zamani')})` },
  'Mali sonuç (marj, tahsilat süresi)': { kapsam: 'Net marj henüz ölçülmüyor; yalnız vadesinde tahsilat sayılıyor.', sql: `SELECT sum(d.zorluk_katsayisi) payda, coalesce(sum(d.zorluk_katsayisi) FILTER (WHERE f.tahsil_edilen_eur >= f.toplam_eur AND (SELECT max(t.tarih) FROM tahsilat t WHERE t.fatura_ref = f.kimlik) <= f.vade), 0) pay FROM musteri_faturasi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE d.dosya_sorumlusu_ref = $1 AND f.fatura_no IS NOT NULL AND f.vade < current_date AND to_char(f.vade, 'YYYY-MM') = $2` },
  'Müşteri ve şikâyet': { kapsam: 'Anket yanıtı olmayan dosyada yalnız şikâyetsiz kapanış sayılıyor.', sql: `SELECT sum(z.k) payda, coalesce(sum(z.k * CASE WHEN z.o IS NULL THEN z.s ELSE (z.o / 5 + z.s) / 2 END), 0) pay FROM (SELECT d.zorluk_katsayisi k, (SELECT a.ortalama FROM memnuniyet_anketi a WHERE a.dosya_ref = d.kimlik) o, (CASE WHEN EXISTS (SELECT 1 FROM garanti_sikayet g WHERE g.dosya_ref = d.kimlik AND 'Şikâyet' = ANY(g.kayit_turu)) THEN 0 ELSE 1 END)::numeric s ${kapanan}) z` },
  'Kayıt bütünlüğü': { kapsam: 'Form süresi henüz sayılmıyor; yalnız eksiksiz kapanış sayılıyor.', sql: `SELECT sum(d.zorluk_katsayisi) payda, coalesce(sum(d.zorluk_katsayisi) FILTER (WHERE cardinality(coalesce(c.eksiklik_isaretleri, '{}')) = 0), 0) pay ${kapanan}` },
};
const MALI = 'Mali sonuç (marj, tahsilat süresi)'; const MARJ_HEDEF = 23;
/** Mali sonuç: net marjın %23 hedefe ulaşma oranı ile vadesinde tahsilatın ortalaması; biri yoksa diğeri esas alınır. */
export const maliBirlesik = (marj: number | null, tahsil: number | null) => (marj === null ? tahsil : tahsil === null ? marj : yuvarla((marj + tahsil) / 2));
async function maliOlc(db: Db, kullanici: string, donem: string): Promise<Olcum | null> {
  const t = (await db.query(DS_SORGU[MALI]!.sql, [kullanici, donem])).rows[0]; const tp = Number(t.payda ?? 0);
  const tahsil = tp ? gostergePuani((Number(t.pay) / tp) * 100, '≥ %90') : null;
  const ds = (await db.query(`SELECT d.kimlik, d.zorluk_katsayisi k, (SELECT sum(f.kdv_haric_eur) FROM musteri_faturasi f WHERE f.dosya_ref = d.kimlik AND f.fatura_no IS NOT NULL) satis ${kapanan}`, [kullanici, donem])).rows.filter((r) => Number(r.satis) > 0);
  let top = 0; let ag = 0;
  for (const r of ds) { const m = ((Number(r.satis) - (await dosyaButcesi(db, r.kimlik)).gerceklesen) / Number(r.satis)) * 100; const k = Number(r.k); top += k * Math.max(0, Math.min(100, (m / MARJ_HEDEF) * 100)); ag += k; }
  const marj = ag ? top / ag : null; const v = maliBirlesik(marj === null ? null : yuvarla(marj), tahsil);
  if (v === null) return null;
  return { pay: v, payda: 100, dogrudan: true, ...(marj === null ? { kapsam: 'Bu dönemde kapanan faturalı dosya yok; yalnız vadesinde tahsilat sayılıyor.' } : tahsil === null ? { kapsam: 'Bu dönemde vadesi gelen fatura yok; yalnız net marj sayılıyor.' } : {}) };
}
const ROL_SORGU: Record<string, Record<string, { sql: string; kapsam?: string }>> = {
  'Dosya Sorumlusu': DS_SORGU,
  'Kalite Uzmanı (Kalite Kontrolör)': { 'FR-KLT-011 tamamlama': { sql: `SELECT count(*) payda, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM dosya_performans p WHERE p.dosya_ref = c.dosya_ref AND p.durum IN ('Onayda', 'Onaylandı'))) pay FROM kapanis_kontrolu c JOIN dosya_ekibi_atamasi e ON e.dosya_ref = c.dosya_ref AND e.kullanici_ref = $1 AND e.rol = 'Kalite Kontrolör' WHERE c.durum = 'Onaylandı' AND c.cikis_statusu = 'Teknik Kapalı' AND ${ay('c.kapanis_zamani')}` } },
};
for (const [r, m] of Object.entries(EK_SORGU)) ROL_SORGU[r] = { ...ROL_SORGU[r], ...m };
async function olc(db: Db, g: Gosterge, kullanici: string, rol: string, rolAdi: string, donem: string): Promise<Olcum | null> {
  if (ONAY_GOSTERGE.has(g.gosterge)) return onaySureOlc(db, kullanici, rol, donem, /sipariş onay/i.test(g.hesap));
  if (rolAdi === 'Dosya Sorumlusu' && g.gosterge === MALI) return maliOlc(db, kullanici, donem);
  const q = ROL_SORGU[rolAdi]?.[g.gosterge]; if (!q) return null;
  const r = (await db.query(q.sql, [kullanici, donem])).rows[0]; const payda = Number(r.payda ?? 0);
  return payda ? { pay: Number(r.pay), payda, kapsam: q.kapsam } : null;
}

/** Hedefi "≥ %N" olan göstergede hedefe ulaşan 100 alır; "≤ %N" olanda hedefin altı 100, üstünde hedef/değer oranı; diğerlerinde oran doğrudan puandır. */
export function gostergePuani(deger: number, hedef: string): number {
  const u = /≤\s*%\s*(\d+(?:[.,]\d+)?)/.exec(hedef);
  if (u && !/≥/.test(hedef)) { const h = Number(u[1]!.replace(',', '.')); return deger <= h ? 100 : yuvarla((h / deger) * 100); }
  const m = /≥\s*%\s*(\d+(?:[.,]\d+)?)/.exec(hedef); const h = m ? Number(m[1]!.replace(',', '.')) : 100;
  return yuvarla(Math.min(100, (deger / h) * 100));
}
/** YG-960: %80 sistem, %20 yönetici; yönetici puanı girilmemişse sistem puanı esas alınır. */
export const nihaiPuan = (sistem: number | null, yonetici: number | null) => (sistem === null ? null : yonetici === null ? sistem : yuvarla(sistem * 0.8 + yonetici * 0.2));

export async function karneRolu(db: Db, kullanici: string): Promise<{ ad: string; kimlik: string } | null> {
  const r = (await db.query(`SELECT x.rol_adi ad, x.kimlik FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND EXISTS (SELECT 1 FROM karne_gosterge g WHERE g.rol_adi = x.rol_adi) LIMIT 1`, [kullanici])).rows[0];
  return r ?? null;
}
/** YG-961: puan yalnız kayıtlardan hesaplanır; elle puan girişi yoktur. */
export async function karneHesapla(db: Db, kullanici: string, rol: { ad: string; kimlik: string }, donem: string): Promise<{ satirlar: Satir[]; sistem: number | null }> {
  const gs = (await db.query(`SELECT kimlik, gosterge, hesap, hedef, agirlik FROM karne_gosterge WHERE rol_adi = $1 ORDER BY sira`, [rol.ad])).rows as Gosterge[];
  const satirlar: Satir[] = [];
  for (const g of gs) {
    const o = await olc(db, g, kullanici, rol.kimlik, rol.ad, donem); const deger = o ? yuvarla((o.pay / o.payda) * 100) : null;
    satirlar.push({ kimlik: g.kimlik, gosterge: g.gosterge, hesap: g.hesap, hedef: g.hedef, agirlik: Number(g.agirlik), pay: o?.pay ?? null, payda: o?.payda ?? null, deger, puan: deger === null ? null : o?.dogrudan ? deger : gostergePuani(deger, g.hedef), kapsam: o?.kapsam ?? null });
  }
  const olcu = satirlar.filter((x) => x.puan !== null); const top = olcu.reduce((t, x) => t + x.agirlik, 0);
  return { satirlar, sistem: top ? yuvarla(olcu.reduce((t, x) => t + x.agirlik * x.puan!, 0) / top) : null };
}

/** Karnenin üst makamı; İç Denetim Müdürünün karnesi ve itirazı CEO'dadır (A48-S3). */
export async function karneMakami(db: Db, rol: { ad: string; kimlik: string }): Promise<string | null> {
  if (rol.ad === 'CEO') return null;
  return rol.ad === 'İç Denetim Müdürü' ? rolId(db, 'CEO') : onayMakami(db, rol.kimlik);
}
/** YG-966: yönetici zinciri bağlı personelin karnesini görür. */
export async function zincirdeMi(db: Db, bakan: string, personel: string): Promise<boolean> {
  const rol = await karneRolu(db, personel); if (!rol) return false;
  const my = (await db.query(`SELECT m.kimlik FROM rol x JOIN rol m ON m.rol_sahibi_birim = x.rol_sahibi_birim AND m.kademe = 'Müdür Yardımcısı' WHERE x.kimlik = $1 AND x.kademe NOT IN ('Müdür', 'Müdür Yardımcısı', 'Direktör') LIMIT 1`, [rol.kimlik])).rows[0]?.kimlik as string | undefined;
  if (my && (await rolSahipleri(db, my)).includes(bakan)) return true;
  let m = await karneMakami(db, rol).catch(() => null);
  for (let i = 0; m && i < 8; i++) {
    if ((await rolSahipleri(db, m)).includes(bakan)) return true;
    const r = (await db.query(`SELECT rol_adi FROM rol WHERE kimlik = $1`, [m])).rows[0];
    if (r.rol_adi === 'CEO') return false;
    m = await onayMakami(db, m).catch(() => null);
  }
  return false;
}

async function satirYaz(c: Db, id: string, satirlar: Satir[]) {
  for (const s of satirlar) await c.query(`INSERT INTO personel_karne_satir (donem_ref, gosterge_ref, agirlik, pay, payda, deger, puan, kapsam) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (donem_ref, gosterge_ref) DO UPDATE SET agirlik = $3, pay = $4, payda = $5, deger = $6, puan = $7, kapsam = $8`, [id, s.kimlik, s.agirlik, s.pay, s.payda, s.deger, s.puan, s.kapsam]);
}
const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));

/** Her ayın başında bir önceki dönemin kapanışı İK Sorumlusuna düşer; son: izleyen 5. iş günü 12:00. */
export async function karneKapanisGorevi(db: Pool, simdi = new Date()): Promise<boolean> {
  const b = new Date(`${istanbulAy(simdi)}-01T00:00:00Z`); const onceki = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  if (!(await birKez(db, 'karne_donem_kapanis', onceki))) return false;
  const son = await isGunuSonu(db, b, 5); son.setUTCHours(9, 0, 0, 0);
  await kartAc(db, { tur: KAPANIS, kategori: 'gorev', baslik: `${onceki} Karne Dönemi Kapanışı`, sahipRol: await rolId(db, IKS), sonZaman: son, nesneTuru: 'Karne Dönemi', nesneKimligi: onceki });
  return true;
}

kapanisKaydet(AGIRLIK, async (c, k, karar) => {
  const o = (await c.query(`SELECT * FROM karne_agirlik_onerisi WHERE kimlik = $1 AND durum = 'Onayda'`, [k.nesne_kimligi])).rows[0];
  if (!o) return;
  if (karar === 'Onayla') {
    for (const d of o.degerler as { kimlik: string; agirlik: number }[]) await c.query(`UPDATE karne_gosterge SET agirlik = $2 WHERE kimlik = $1 AND rol_adi = $3`, [d.kimlik, d.agirlik, o.rol_adi]);
    await c.query(`UPDATE karne_agirlik_onerisi SET durum = 'Yürürlükte' WHERE kimlik = $1`, [o.kimlik]);
  } else if (['Reddet', 'Gerekçeyle İade Et'].includes(karar)) await c.query(`UPDATE karne_agirlik_onerisi SET durum = 'Reddedildi' WHERE kimlik = $1`, [o.kimlik]);
});

export function personelKarneYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = $2 LIMIT 1`, [k, r])).rowCount);
  const donemKaydi = async (k: string, d: string) => (await b.db.query(`SELECT * FROM personel_karne_donem WHERE personel_ref = $1 AND donem = $2`, [k, d])).rows[0];

  s.get('/personel-karne', oturumlu, async (i, y) => {
    const o = i.oturum!; const q = i.query as { kullanici?: string; donem?: string }; const kisi = q.kullanici || o.kullanici; const donem = q.donem || istanbulAy();
    if (o.grup !== 'LGM İç Rolü' || !DONEM.test(donem)) return yok(y);
    if (kisi !== o.kullanici && !(await zincirdeMi(b.db, o.kullanici, kisi))) return yok(y);
    const rol = await karneRolu(b.db, kisi); if (!rol) return yok(y);
    const k = await donemKaydi(kisi, donem);
    const itiraz = k ? (await b.db.query(`SELECT durum, konu, karar_gerekce FROM personel_karne_itiraz WHERE donem_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 5`, [k.kimlik])).rows : [];
    const hf = (await b.db.query(`SELECT count(*)::int payda, (count(*) FILTER (WHERE c.kapanma_zamani <= c.son_zaman))::int pay FROM is_karti c WHERE c.son_zaman BETWEEN now() - interval '7 days' AND now() AND (c.sahip_kullanici_ref = $1 OR c.sahip_rol_ref = $2)`, [kisi, rol.kimlik])).rows[0]; // YG-962: haftalık süre uyumu, puansız
    const degerlendirmeler = (await b.db.query(`SELECT tur, donem, gorusme_tarihi::text, notlar, egitim_ihtiyaci FROM personel_degerlendirme WHERE personel_ref = $1 ORDER BY zaman DESC LIMIT 12`, [kisi])).rows;
    const ortak = { rol: rol.ad, donem, kendisi: kisi === o.kullanici, ikYetkili: await rolVar(o.kullanici, IKS), itiraz, haftalik: hf, degerlendirmeler };
    if (k?.durum === 'Kapalı') {
      const satirlar = (await b.db.query(`SELECT g.kimlik, g.gosterge, g.hesap, g.hedef, s.agirlik, s.pay, s.payda, s.deger, s.puan, s.kapsam FROM personel_karne_satir s JOIN karne_gosterge g ON g.kimlik = s.gosterge_ref WHERE s.donem_ref = $1 ORDER BY g.sira`, [k.kimlik])).rows;
      return { ...ortak, durum: 'Kapalı', satirlar, sistem: num(k.sistem_puani), yonetici: num(k.yonetici_puani), nihai: num(k.nihai_puan) };
    }
    const h = await karneHesapla(b.db, kisi, rol, donem); const yon = num(k?.yonetici_puani);
    return { ...ortak, durum: 'Açık', satirlar: h.satirlar, sistem: h.sistem, yonetici: yon, nihai: nihaiPuan(h.sistem, yon) };
  });

  s.get('/personel-karne/bagli', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const l = (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik JOIN rol x ON x.kimlik = a.rol_ref JOIN karne_gosterge g ON g.rol_adi = x.rol_adi WHERE a.atama_durumu = 'Aktif' AND h.hesap_durumu = 'Aktif' AND h.kimlik <> $1 ORDER BY h.ad_soyad LIMIT 500`, [o.kullanici])).rows;
    const r = []; for (const x of l) if (await zincirdeMi(b.db, o.kullanici, x.kimlik)) r.push(x);
    return r;
  });

  // YG-960: doğrudan üst makam dönem kapanmadan yönetici puanını girer.
  s.post('/personel-karne/yonetici-puani', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kullanici?: string; donem?: string; puan?: unknown; gerekce?: string }; const puan = Number(g.puan);
    const rol = g.kullanici ? await karneRolu(b.db, g.kullanici) : null; if (!rol || !g.kullanici) return yok(y);
    const m = await karneMakami(b.db, rol); if (!m || !(await rolSahipleri(b.db, m)).includes(o.kullanici)) return yok(y);
    if (!DONEM.test(g.donem ?? '') || !(puan >= 0 && puan <= 100) || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Dönem, 0–100 arası puan ve gerekçe zorunludur.' });
    const r = await b.db.query(`INSERT INTO personel_karne_donem (personel_ref, donem, rol_adi, yonetici_puani, yonetici_gerekce, yonetici_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (personel_ref, donem) DO UPDATE SET yonetici_puani = $4, yonetici_gerekce = $5, yonetici_ref = $6 WHERE personel_karne_donem.durum = 'Açık' RETURNING kimlik`, [g.kullanici, g.donem, rol.ad, puan, g.gerekce.trim(), o.kullanici]);
    return r.rowCount ? { tamam: true } : y.code(409).send({ hata: 'Bu dönem kapanmıştır.' });
  });

  s.post('/personel-karne/donem-kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { donem?: string };
    if (!(await rolVar(o.kullanici, IKS))) return yok(y);
    if (!DONEM.test(g.donem ?? '') || g.donem! >= istanbulAy()) return y.code(400).send({ hata: 'Yalnız geçmiş dönem kapatılır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      if (!(await c.query(`INSERT INTO karne_donem_kapanis (donem, kapatan_ref) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING donem`, [g.donem, o.kullanici])).rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu dönem kapanmıştır.' }); }
      const kisiler = (await c.query(`SELECT DISTINCT h.kimlik FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik JOIN rol x ON x.kimlik = a.rol_ref JOIN karne_gosterge k ON k.rol_adi = x.rol_adi WHERE a.atama_durumu = 'Aktif' AND h.hesap_durumu = 'Aktif'`)).rows;
      for (const p of kisiler) {
        const rol = (await karneRolu(c, p.kimlik))!; const h = await karneHesapla(c, p.kimlik, rol, g.donem!);
        const v = (await c.query(`SELECT yonetici_puani FROM personel_karne_donem WHERE personel_ref = $1 AND donem = $2`, [p.kimlik, g.donem])).rows[0];
        const id = (await c.query(`INSERT INTO personel_karne_donem (personel_ref, donem, rol_adi, sistem_puani, nihai_puan, durum, kapanis_zamani) VALUES ($1,$2,$3,$4,$5,'Kapalı',now()) ON CONFLICT (personel_ref, donem) DO UPDATE SET rol_adi = $3, sistem_puani = $4, nihai_puan = $5, durum = 'Kapalı', kapanis_zamani = now() RETURNING kimlik`, [p.kimlik, g.donem, rol.ad, h.sistem, nihaiPuan(h.sistem, num(v?.yonetici_puani))])).rows[0].kimlik;
        await satirYaz(c, id, h.satirlar);
      }
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [KAPANIS, g.donem]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Karne Dönemi Kapatıldı', nesneTuru: 'Karne Dönemi', nesneKimligi: g.donem!, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kisi: kisiler.length };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  // YG-962, YG-971: üç aylık görüşme ve yıllık değerlendirme doğrudan üst makamca kaydedilir; yıllıkta eğitim ve gelişim ihtiyacı zorunludur.
  s.post('/personel-karne/degerlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kullanici?: string; tur?: string; donem?: string; gorusmeTarihi?: string; notlar?: string; egitim?: string };
    const rol = g.kullanici ? await karneRolu(b.db, g.kullanici) : null; if (!rol || !g.kullanici) return yok(y);
    const m = await karneMakami(b.db, rol); if (!m || !(await rolSahipleri(b.db, m)).includes(o.kullanici)) return yok(y);
    const gecerli = g.tur === 'Üç Aylık' ? /^\d{4}-Q[1-4]$/.test(g.donem ?? '') : g.tur === 'Yıllık' && /^\d{4}$/.test(g.donem ?? '');
    if (!gecerli || !/^\d{4}-\d{2}-\d{2}$/.test(g.gorusmeTarihi ?? '') || !g.notlar?.trim() || (g.tur === 'Yıllık' && !g.egitim?.trim())) return y.code(400).send({ hata: 'Dönem, görüşme tarihi ve notlar zorunludur; yıllık değerlendirmede eğitim ve gelişim ihtiyacı da yazılır.' });
    const r = await b.db.query(`INSERT INTO personel_degerlendirme (personel_ref, tur, donem, gorusme_tarihi, notlar, egitim_ihtiyaci, amir_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING kimlik`, [g.kullanici, g.tur, g.donem, g.gorusmeTarihi, g.notlar.trim(), g.egitim?.trim() || null, o.kullanici]);
    return r.rowCount ? { kimlik: r.rows[0].kimlik } : y.code(409).send({ hata: 'Bu dönem için değerlendirme kaydedilmiştir.' });
  });

  // YG-967, YG-968: yalnız karnenin sahibi, kapanıştan itibaren 10 iş günü içinde itiraz eder; bir üst makam karar verir.
  s.post('/personel-karne/itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { donem?: string; konu?: string };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    if (!DONEM.test(g.donem ?? '') || !g.konu?.trim()) return y.code(400).send({ hata: 'Dönem ve itiraz konusu zorunludur.' });
    const k = await donemKaydi(o.kullanici, g.donem!); if (!k || k.durum !== 'Kapalı') return y.code(409).send({ hata: 'İtiraz dönem kapandıktan sonra yapılır.' });
    if (Date.now() > (await isGunuSonu(b.db, new Date(k.kapanis_zamani), 10)).getTime()) return y.code(409).send({ hata: 'İtiraz süresi dolmuştur.' });
    const rol = await karneRolu(b.db, o.kullanici); const m = rol ? await karneMakami(b.db, rol) : null; if (!m) return y.code(409).send({ hata: 'Bu karne için itiraz makamı bulunmamaktadır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = (await c.query(`INSERT INTO personel_karne_itiraz (donem_ref, itiraz_eden_ref, konu, makam_rol_ref, onceki_puan) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING kimlik`, [k.kimlik, o.kullanici, g.konu.trim(), m, k.nihai_puan])).rows[0];
      if (!r) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu dönem için incelemede bir itirazınız vardır.' }); }
      await kartAc(c, { tur: ITIRAZ, kategori: 'gorev', baslik: `${g.donem} Karne İtirazı`, sahipRol: m, sonZaman: await isGunuSonu(c, new Date(), 10), nesneTuru: 'Karne İtirazı', nesneKimligi: r.kimlik });
      await c.query('COMMIT');
      return { kimlik: r.kimlik };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  const makamRolleri = async (k: string) => (await b.db.query(`SELECT kimlik FROM rol`)).rows.map((r) => r.kimlik as string).reduce(async (a, r) => ((await rolSahipleri(b.db, r)).includes(k) ? [...(await a), r] : a), Promise.resolve([] as string[]));
  s.get('/personel-karne/itiraz-bekleyen', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    return (await b.db.query(`SELECT t.kimlik, t.konu, d.donem, d.nihai_puan, h.ad_soyad FROM personel_karne_itiraz t JOIN personel_karne_donem d ON d.kimlik = t.donem_ref JOIN kullanici_hesabi h ON h.kimlik = t.itiraz_eden_ref WHERE t.durum = 'İncelemede' AND t.makam_rol_ref = ANY($1::text[]) AND t.itiraz_eden_ref <> $2 ORDER BY t.olusturma_zamani`, [await makamRolleri(o.kullanici), o.kullanici])).rows;
  });
  s.post('/personel-karne/itiraz/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; gerekce?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT t.*, d.personel_ref, d.donem FROM personel_karne_itiraz t JOIN personel_karne_donem d ON d.kimlik = t.donem_ref WHERE t.kimlik = $1`, [id])).rows[0];
    if (!t || t.itiraz_eden_ref === o.kullanici || !(await rolSahipleri(b.db, t.makam_rol_ref)).includes(o.kullanici)) return yok(y);
    if (!['Kabul', 'Kısmi Kabul', 'Ret'].includes(g.karar ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Karar ve gerekçe zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query(`UPDATE personel_karne_itiraz SET durum = $2, karar_gerekce = $3, karar_ref = $4, karar_zamani = now() WHERE kimlik = $1 AND durum = 'İncelemede'`, [id, g.karar, g.gerekce.trim(), o.kullanici]);
      if (!u.rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu itiraz sonuçlanmıştır.' }); }
      if (g.karar !== 'Ret') { // YG-961: puan elle değişmez; kabulde kayıtlardan yeniden hesaplanır, önceki puan itirazda kalır.
        const rol = (await karneRolu(c, t.personel_ref))!; const h = await karneHesapla(c, t.personel_ref, rol, t.donem);
        const v = (await c.query(`SELECT yonetici_puani FROM personel_karne_donem WHERE kimlik = $1`, [t.donem_ref])).rows[0];
        await c.query(`UPDATE personel_karne_donem SET sistem_puani = $2, nihai_puan = $3 WHERE kimlik = $1`, [t.donem_ref, h.sistem, nihaiPuan(h.sistem, num(v.yonetici_puani))]);
        await satirYaz(c, t.donem_ref, h.satirlar);
      }
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [ITIRAZ, id]);
      await bildir(c, { olay: `personel-karne-itiraz:${id}`, kullanicilar: [t.itiraz_eden_ref], baslik: `Karne İtirazınız: ${g.karar}` });
      await c.query('COMMIT');
      return { durum: g.karar };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  // YG-963: ağırlık değişikliğini rolün üst makamı (Süreç Sahibi) önerir, CEO onaylar; rol toplamı 100 olmalıdır.
  s.post('/personel-karne/agirlik', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { rol?: string; degerler?: { kimlik: string; agirlik: number }[]; gerekce?: string };
    const r = (await b.db.query(`SELECT kimlik, rol_adi ad FROM rol WHERE rol_adi = $1`, [g.rol ?? ''])).rows[0]; if (!r) return yok(y);
    const m = await karneMakami(b.db, r).catch(() => null); if (!m || !(await rolSahipleri(b.db, m)).includes(o.kullanici)) return yok(y);
    const mevcut = new Set((await b.db.query(`SELECT kimlik FROM karne_gosterge WHERE rol_adi = $1`, [r.ad])).rows.map((x) => x.kimlik as string)); const d = g.degerler ?? [];
    if (!g.gerekce?.trim() || d.length !== mevcut.size || new Set(d.map((x) => x.kimlik)).size !== mevcut.size || d.some((x) => !mevcut.has(x.kimlik) || !(Number(x.agirlik) >= 0)) || Math.abs(d.reduce((t, x) => t + Number(x.agirlik), 0) - 100) > 0.001) return y.code(400).send({ hata: 'Tüm göstergeler, toplamı 100 olan ağırlıklar ve gerekçe zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const k = (await c.query(`INSERT INTO karne_agirlik_onerisi (rol_adi, degerler, gerekce, oneren_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [r.ad, JSON.stringify(d), g.gerekce.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: AGIRLIK, baslik: `${r.ad} · Karne Ağırlıkları`, ozet: g.gerekce.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, 'CEO')], nesneTuru: 'Karne Ağırlığı', nesneKimligi: k.kimlik });
      await c.query('COMMIT');
      return { kimlik: k.kimlik };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
