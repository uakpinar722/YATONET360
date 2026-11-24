import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
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

export function tedarikGostergeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/tedarik/mudurluk-gostergeleri', oturumlu, async (i, y) => {
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [i.oturum!.kullanici, [TMY, TYM]])).rowCount) return yok(y);
    return tedarikGostergeleri(b.db);
  });
}
