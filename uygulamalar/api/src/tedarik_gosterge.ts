import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez, bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const TMY = 'Tedarik Müdür Yardımcısı'; const TYM = 'Tedarik Yönetimi Müdürü';
const oran = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

/** YG-1593: müdürlük göstergeleri (son 90 gün): zamanında teslim, K3–K4 kalem izlenebilirliği, karantina kararının 10 günde kapanması. */
export async function tedarikGostergeleri(db: Pool) {
  const t = (await db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE ilk IS NOT NULL AND ilk::date <= s.teslim_tarihi)::int z FROM tedarik_siparisi s
      LEFT JOIN LATERAL (SELECT min(m.olusturma_zamani) ilk FROM malzeme_giris_kabulu m WHERE m.siparis_ref = s.kimlik) g ON true
     WHERE s.statu <> 'İptal' AND s.teslim_tarihi < current_date AND s.teslim_tarihi >= current_date - 90`)).rows[0];
  const k = (await db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE m.lot_no <> '' AND coalesce(s.nihai_kullanim_yeri, '') <> '' AND coalesce(s.belge_giris_sartlari, '') <> ''
        AND EXISTS (SELECT 1 FROM belge e WHERE e.bag_turu = 'Dosya' AND e.bag_kimligi = s.dosya_ref::text AND e.belge_turu ILIKE '%sertifika%'))::int tam
      FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE s.kritik_sinif IN ('K3', 'K4') AND m.olusturma_zamani >= now() - interval '90 days'`)).rows[0];
  const q = (await db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE kapanma_zamani IS NOT NULL AND kapanma_zamani <= olusturma_zamani + interval '10 days')::int z FROM is_karti WHERE tur = 'Karantina Kararı' AND olusturma_zamani >= now() - interval '90 days' AND (kapanma_zamani IS NOT NULL OR olusturma_zamani < now() - interval '10 days')`)).rows[0];
  return [
    { ad: 'Zamanında teslim oranı', deger: oran(t.z, t.n), pay: t.z, payda: t.n, hedef: '≥ %90' },
    { ad: 'Kritik kalem izlenebilirliği (K3–K4)', deger: oran(k.tam, k.n), pay: k.tam, payda: k.n, hedef: '%100' },
    { ad: 'Karantina kapanışı (10 gün)', deger: oran(q.z, q.n), pay: q.z, payda: q.n, hedef: '≥ %90' },
  ];
}

/** YG-1593: aylık tedarikçi performans verisi; Tedarik Müdür Yardımcısı "Onaya Gönder" (Tedarik Yönetimi Müdürüne Gönder) → Tedarik Yönetimi Müdürü. */
export async function tedarikciAylikPerformans(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const bas = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1)); const bit = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1));
  const donem = bas.toISOString().slice(0, 7);
  if (!(await birKez(db, 'tedarikci-aylik-performans', donem))) return false;
  const p = [`${donem}-01`, bit.toISOString().slice(0, 10)];
  const l = (await db.query(`SELECT k.ticari_unvan, count(DISTINCT s.kimlik)::int siparis,
      count(DISTINCT s.kimlik) FILTER (WHERE (SELECT min(m.olusturma_zamani)::date FROM malzeme_giris_kabulu m WHERE m.siparis_ref = s.kimlik) <= s.teslim_tarihi)::int zamaninda,
      count(m.kimlik) FILTER (WHERE m.kabul_karari IN ('Ret', 'İade Edildi', 'Karantina'))::int sorunlu
    FROM tedarik_siparisi s JOIN kurulus k ON k.kimlik = s.kurulus_ref LEFT JOIN malzeme_giris_kabulu m ON m.siparis_ref = s.kimlik
    WHERE s.statu <> 'İptal' AND s.teslim_tarihi >= $1::date AND s.teslim_tarihi < $2::date GROUP BY k.ticari_unvan ORDER BY k.ticari_unvan`, p)).rows;
  const ozet = l.length ? l.map((x) => `${x.ticari_unvan}: sipariş ${x.siparis}, zamanında ${x.zamaninda}, ret/iade/karantina ${x.sorunlu}`).join(' · ') : 'Dönemde teslim tarihi gelen sipariş yoktur.';
  await kartAc(db, { tur: 'Aylık Tedarikçi Performans Verisi', kategori: 'onay', baslik: `${donem} · Aylık Tedarikçi Performans Verisi`, ozet: ozet.slice(0, 1500), zincir: [await rolId(db, TMY), await rolId(db, TYM)], nesneTuru: 'Tedarikçi Performans', nesneKimligi: donem, simdi });
  return true;
}

/** YG-1594: aylık yönetim raporu; Tedarik Yönetimi Müdürü "Onaya Gönder" (Teknik ve Operasyon Direktörüne Gönder) → Teknik ve Operasyon Direktörü. */
export async function tedarikAylikYonetimRaporu(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const bas = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1)); const bit = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1));
  const donem = bas.toISOString().slice(0, 7);
  if (!(await birKez(db, 'tedarik-aylik-yonetim-raporu', donem))) return false;
  const p = [`${donem}-01`, bit.toISOString().slice(0, 10)];
  const s = (await db.query(`SELECT count(*) FILTER (WHERE s.olusturma_zamani >= $1::date AND s.olusturma_zamani < $2::date)::int acilan,
      count(*) FILTER (WHERE s.statu NOT IN ('İptal', 'Teslim Alındı') AND s.teslim_tarihi < $2::date)::int geciken
    FROM tedarik_siparisi s`, p)).rows[0];
  const m = (await db.query(`SELECT count(*) FILTER (WHERE kabul_karari = 'Karantina')::int karantina, count(*) FILTER (WHERE kabul_karari IN ('Ret', 'İade Edildi'))::int ret
    FROM malzeme_giris_kabulu WHERE olusturma_zamani >= $1::date AND olusturma_zamani < $2::date`, p)).rows[0];
  const sup = (await db.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Karantina Kararı' AND olusturma_zamani >= $1::date AND olusturma_zamani < $2::date`, p)).rows[0].n;
  const g = await tedarikGostergeleri(db);
  const ozet = [`Açılan sipariş: ${s.acilan}`, `Teslim tarihi geçmiş açık sipariş: ${s.geciken}`, `Karantinaya alınan giriş: ${m.karantina}`, `Ret veya iade: ${m.ret}`, `Karantina kararı: ${sup}`,
    ...g.map((x) => `${x.ad}: ${x.deger === null ? 'Ölçüm Yok' : `%${x.deger.toLocaleString('tr-TR')}`} (hedef ${x.hedef})`)].join(' · ');
  await kartAc(db, { tur: 'Tedarik Aylık Yönetim Raporu', kategori: 'onay', baslik: `${donem} · Tedarik Aylık Yönetim Raporu`, ozet: ozet.slice(0, 1500), zincir: [await rolId(db, TYM), await rolId(db, 'Teknik ve Operasyon Direktörü')], nesneTuru: 'Tedarik Raporu', nesneKimligi: donem });
  return true;
}

/** YG-784: tedarikçi karnesi; son 180 günde teslim tarihi gelen en az 3 siparişte zamanında teslim ve giriş kabul oranlarının ortalaması. */
export async function tedarikciKarnesi(db: Pool, simdi = new Date()) {
  const l = (await db.query(`SELECT k.kimlik, k.ticari_unvan, count(DISTINCT s.kimlik)::int siparis,
      count(DISTINCT s.kimlik) FILTER (WHERE (SELECT min(m.olusturma_zamani) FROM malzeme_giris_kabulu m WHERE m.siparis_ref = s.kimlik)::date <= s.teslim_tarihi)::int zamaninda,
      count(m.kimlik) FILTER (WHERE m.kabul_karari IS NOT NULL)::int giris, count(m.kimlik) FILTER (WHERE m.kabul_karari IN ('Kabul', 'Koşullu Kabul'))::int kabul
    FROM tedarik_siparisi s JOIN kurulus k ON k.kimlik = s.kurulus_ref LEFT JOIN malzeme_giris_kabulu m ON m.siparis_ref = s.kimlik
    WHERE s.statu <> 'İptal' AND s.teslim_tarihi < $1::date AND s.teslim_tarihi >= $1::date - 180 GROUP BY 1, 2 ORDER BY 2`, [simdi.toISOString().slice(0, 10)])).rows;
  const esik = Number((await db.query(`SELECT deger->>'esik_standart' e FROM karne_parametresi WHERE durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`)).rows[0]?.e ?? NaN);
  return l.map((x) => {
    const z = oran(x.zamaninda, x.siparis); const kb = oran(x.kabul, x.giris);
    const puan = x.siparis < 3 ? null : kb === null ? z : Math.round(((z ?? 0) + kb) * 5) / 10;
    return { kimlik: x.kimlik as string, unvan: x.ticari_unvan as string, siparis: x.siparis as number, zamanindaOrani: z, kabulOrani: kb, puan, esik: Number.isFinite(esik) ? esik : null, esikAlti: puan !== null && Number.isFinite(esik) && puan < esik };
  });
}

/** YG-784: karne eşiği altındaki tedarikçi ayda bir Tedarik Yönetimi Müdürüne bildirilir. */
export async function tedarikciKarneUyarisi(db: Pool, simdi = new Date()): Promise<number> {
  const ay = new Date(simdi.getTime() + 3 * 3_600_000).toISOString().slice(0, 7); let n = 0;
  const kisiler = (await db.query(`SELECT a.kullanici_ref FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.atama_durumu = 'Aktif' AND x.rol_adi = $1`, [TYM])).rows.map((z) => z.kullanici_ref as string);
  for (const t of (await tedarikciKarnesi(db, simdi)).filter((x) => x.esikAlti)) {
    if (!(await birKez(db, 'tedarikci-karne-esik', `${t.kimlik}:${ay}`))) continue;
    await bildir(db, { olay: `tedarikci-karne:${t.kimlik}:${ay}`, kullanicilar: kisiler, baslik: `${t.unvan} · Tedarikçi Karnesi Eşik Altında`, ozet: `Son 180 gün: puan ${String(t.puan).replace('.', ',')} (eşik ${t.esik}), zamanında teslim %${String(t.zamanindaOrani ?? 0).replace('.', ',')}, kabul %${String(t.kabulOrani ?? 0).replace('.', ',')}, ${t.siparis} sipariş.`, oncelik: 'Yüksek' }, simdi); n++;
  }
  return n;
}

/** YG-1594: muadil liste Mart ve Eylül aylarında gözden geçirilir; ayın ilk çalışmasında Tedarik Yönetimi Müdürüne görev açılır. */
export async function muadilGozdenGecirmeGorevi(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const ay = ist.getUTCMonth() + 1;
  if (ay !== 3 && ay !== 9) return false;
  const donem = ist.toISOString().slice(0, 7);
  if ((await db.query(`SELECT 1 FROM muadil_gozden_gecirme WHERE donem = $1`, [donem])).rowCount || !(await birKez(db, 'muadil-gozden-gecirme', donem))) return false;
  const n = (await db.query(`SELECT count(*)::int n FROM onayli_parca`)).rows[0].n;
  await kartAc(db, { tur: 'Muadil Liste Gözden Geçirmesi', kategori: 'gorev', oncelik: 'Normal', baslik: `${donem} · Muadil Liste Gözden Geçirmesi`, ozet: `Onaylı muadil listede ${n} kayıt vardır; kaynak ve ürün kayıtlarını, tek kaynak bağımlılıklarını gözden geçirmenizi rica ederiz.`, sahipRol: await rolId(db, TYM), nesneTuru: 'Muadil Liste', nesneKimligi: donem, simdi });
  return true;
}

const sonrakiGozdenGecirme = (simdi: Date) => {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const y = ist.getUTCFullYear(); const ay = ist.getUTCMonth() + 1;
  return ay < 3 ? `${y}-03` : ay < 9 ? `${y}-09` : `${y + 1}-03`;
};

/** YG-1594: K4 tek kaynak bağımlılığı (son 24 ayda tek tedarikçiden alınan K4 parça), onaylı muadil sayısı ve ikinci kaynak planı. */
export async function kaynakRiski(db: Pool, simdi = new Date()) {
  const tekKaynak = (await db.query(`SELECT k.uretici_parca_no parca, max(k.urun_tanimi) urun, max(ku.ticari_unvan) tedarikci, count(DISTINCT s.kimlik)::int siparis,
      (SELECT count(*)::int FROM onayli_parca o WHERE o.orijinal_parca_no = k.uretici_parca_no) muadil, p.plan, p.zaman::text plan_zamani
    FROM tedarik_siparisi_kalemi k JOIN tedarik_siparisi s ON s.kimlik = k.siparis_ref JOIN kurulus ku ON ku.kimlik = s.kurulus_ref LEFT JOIN ikinci_kaynak_plani p ON p.uretici_parca_no = k.uretici_parca_no
    WHERE s.kritik_sinif = 'K4' AND s.statu <> 'İptal' AND s.olusturma_zamani >= $1::timestamptz - interval '24 months'
    GROUP BY k.uretici_parca_no, p.plan, p.zaman HAVING count(DISTINCT s.kurulus_ref) = 1 ORDER BY (p.plan IS NULL) DESC, k.uretici_parca_no LIMIT 200`, [simdi])).rows;
  const son = (await db.query(`SELECT g.donem, g.aciklama, g.zaman::text zaman, h.ad_soyad yapan FROM muadil_gozden_gecirme g JOIN kullanici_hesabi h ON h.kimlik = g.yapan_ref ORDER BY g.donem DESC LIMIT 1`)).rows[0] ?? null;
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const ay = ist.getUTCMonth() + 1; const donem = ist.toISOString().slice(0, 7);
  const supheli = (await db.query(`SELECT count(*)::int n FROM is_karti WHERE tur = 'Şüpheli Ürün' AND durum = 'Bekliyor'`)).rows[0].n;
  return { tekKaynak, muadil: { son, sonraki: sonrakiGozdenGecirme(simdi), buDonemBekliyor: (ay === 3 || ay === 9) && son?.donem !== donem, donem }, supheli, tedarikciler: await tedarikciKarnesi(db, simdi) };
}

export function tedarikGostergeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/tedarik/mudurluk-gostergeleri', oturumlu, async (i, y) => {
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [i.oturum!.kullanici, [TMY, TYM]])).rowCount) return yok(y);
    return tedarikGostergeleri(b.db);
  });
  const mudur = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, [TMY, TYM]])).rowCount);
  // YG-1594: Kaynak ve Risk.
  s.get('/tedarik/kaynak-risk', oturumlu, async (i, y) => {
    if (!(await mudur(i.oturum!.kullanici))) return yok(y);
    return kaynakRiski(b.db);
  });
  s.post('/tedarik/kaynak-risk/plan', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await mudur(o.kullanici))) return yok(y);
    const g = (i.body ?? {}) as { parca?: string; plan?: string };
    if (!g.parca?.trim() || !g.plan?.trim()) return y.code(400).send({ hata: 'Parça numarasını ve ikinci kaynak planını yazmanızı rica ederiz.' });
    await b.db.query(`INSERT INTO ikinci_kaynak_plani (uretici_parca_no, plan, kaydeden_ref) VALUES ($1,$2,$3) ON CONFLICT (uretici_parca_no) DO UPDATE SET plan = EXCLUDED.plan, kaydeden_ref = EXCLUDED.kaydeden_ref, zaman = now()`, [g.parca.trim(), g.plan.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İkinci Kaynak Planı', nesneTuru: 'Parça', nesneKimligi: g.parca.trim(), yeni: { plan: g.plan.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/tedarik/muadil-gozden-gecirme', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2 LIMIT 1`, [o.kullanici, TYM])).rowCount) return yok(y);
    const aciklama = String(((i.body ?? {}) as { aciklama?: string }).aciklama ?? '').trim();
    const ist = new Date(Date.now() + 3 * 3_600_000); const ay = ist.getUTCMonth() + 1; const donem = ist.toISOString().slice(0, 7);
    if (ay !== 3 && ay !== 9) return y.code(409).send({ hata: `Muadil liste gözden geçirmesi Mart ve Eylül aylarında yapılır; sonraki dönem ${sonrakiGozdenGecirme(new Date()).split('-').reverse().join('.')}.` });
    if (!aciklama) return y.code(400).send({ hata: 'Gözden geçirme sonucunu yazmanızı rica ederiz.' });
    const r = await b.db.query(`INSERT INTO muadil_gozden_gecirme (donem, aciklama, yapan_ref) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [donem, aciklama, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu dönemin gözden geçirmesi kayıtlıdır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Muadil Liste Gözden Geçirmesi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [donem]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Muadil Liste Gözden Geçirmesi', nesneTuru: 'Muadil Liste', nesneKimligi: donem, gerekce: aciklama, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
