import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { parametre } from './teklif.js';

type Db = Pool | PoolClient;
const GORUR = ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü', 'Muhasebe ve Finans Müdürü', 'Muhasebe ve Finans Müdür Yardımcısı'];
const ONAY = `('Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü')`;
const R2 = (x: number) => Math.round(x * 100) / 100;
const gunEkle = (d: Date, n: number) => new Date(+d + n * 86_400_000);

/**
 * YG-762: 13 haftalık nakit tahmini. Giriş: açık müşteri faturasının kalanı vade tarihinde (vadesiz faturada fatura tarihi + sigorta tahsilat vadesi);
 * çıkış: doğrulanmış, ödenmemiş hakediş neti son tahsilattan firma ödeme gününde, en geç hakediş tarihinden azami günde. Vadesi geçenler ilk haftaya yazılır.
 */
export async function nakitTahmini(db: Db, simdi = new Date()) {
  const p = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth(), simdi.getUTCDate())); p.setUTCDate(p.getUTCDate() - ((p.getUTCDay() + 6) % 7));
  const vade = await parametre(db, 'sigorta_vade_gun'); const fGun = await parametre(db, 'firma_odeme_gun'); const fAzami = await parametre(db, 'firma_odeme_azami_gun');
  const haftalar = Array.from({ length: 13 }, (_, n) => ({ baslangic: gunEkle(p, n * 7).toISOString().slice(0, 10), giris: 0, cikis: 0, firma: 0, tedarik: 0, gider: 0, net: 0, kumulatif: 0 }));
  const yaz = (t: Date, tutar: number, k: 'giris' | 'firma' | 'tedarik' | 'gider') => { const n = Math.max(0, Math.floor((+t - +p) / (7 * 86_400_000))); if (n < 13) { haftalar[n]![k] += tutar; if (k !== 'giris') haftalar[n]!.cikis += tutar; } };
  for (const f of (await db.query(`SELECT f.toplam_eur - f.tahsil_edilen_eur kalan, coalesce(f.vade, f.fatura_tarihi + $1::int) tarih FROM musteri_faturasi f WHERE f.durum IN ('Faturalandı', 'Kısmi Tahsil') AND f.toplam_eur > f.tahsil_edilen_eur`, [vade])).rows) yaz(new Date(f.tarih), Number(f.kalan), 'giris');
  for (const h of (await db.query(`SELECT h.net, h.olusturma_zamani, (SELECT max(t.tarih) FROM tahsilat t WHERE t.dosya_ref = h.dosya_ref) son FROM hakedis h WHERE h.statu IN ('Doğrulandı', 'Ödeme Talimatında')`)).rows) {
    const azami = gunEkle(new Date(h.olusturma_zamani), fAzami); const t = h.son ? new Date(Math.min(+gunEkle(new Date(h.son), fGun), +azami)) : azami;
    yaz(t, Number(h.net), 'firma');
  }
  // Tedarikçi: ödenmemiş fatura faturadan, faturası gelmemiş açık sipariş teslimden 60 gün sonra (YG-298).
  for (const f of (await db.query(`SELECT tutar_eur, tarih FROM tedarikci_faturasi WHERE odeme_zamani IS NULL`)).rows) yaz(gunEkle(new Date(f.tarih), 60), Number(f.tutar_eur), 'tedarik');
  for (const s of (await db.query(`SELECT s.toplam_eur, coalesce(s.tedarikci_teslim_tarihi, s.teslim_tarihi) t FROM tedarik_siparisi s WHERE s.statu IN ('Verildi', 'Kısmi Teslim', 'Teslim Alındı') AND NOT EXISTS (SELECT 1 FROM tedarikci_faturasi f WHERE f.siparis_ref = s.kimlik)`)).rows) yaz(gunEkle(new Date(s.t ?? simdi), 60), Number(s.toplam_eur), 'tedarik');
  // Genel giderler: onaylı idari siparişler (onaydan 30 gün) ve Muhasebe ve Finans'ın girdiği gider planı (aylık tekrar veya tek sefer).
  for (const s of (await db.query(`SELECT siparis_tutar_eur t, olusturma_zamani z FROM idari_talep WHERE durum = 'Sipariş Onaylandı' AND siparis_tutar_eur > 0`)).rows) yaz(gunEkle(new Date(s.z), 30), Number(s.t), 'gider');
  const son = gunEkle(p, 91);
  for (const g of (await db.query(`SELECT tutar_eur, tekrar, ayin_gunu, tarih, baslangic, bitis FROM nakit_gider_plani WHERE aktif`)).rows) {
    if (g.tekrar === 'Tek Sefer') { yaz(new Date(g.tarih), Number(g.tutar_eur), 'gider'); continue; }
    for (let a = new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), g.ayin_gunu)); a < son; a = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, g.ayin_gunu)))
      if (a >= p && (!g.baslangic || a >= new Date(g.baslangic)) && (!g.bitis || a <= new Date(g.bitis))) yaz(a, Number(g.tutar_eur), 'gider');
  }
  let k = 0; for (const h of haftalar) { h.giris = R2(h.giris); h.cikis = R2(h.cikis); h.firma = R2(h.firma); h.tedarik = R2(h.tedarik); h.gider = R2(h.gider); h.net = R2(h.giris - h.cikis); k = R2(k + h.net); h.kumulatif = k; }
  return haftalar;
}

/** YG-762: sigortacı bazında kârlılık; onaylı kalemlerin satışı ve maliyetiyle, son 12 ayda karara bağlanan teklifler. */
export async function sigortaciKarlilik(db: Db, simdi = new Date()) {
  return (await db.query(
    `SELECT s.sigortaci_adi, count(DISTINCT f.dosya_ref)::int dosya, round(sum(k.tutar_eur), 2) satis, round(sum(k.birim_maliyet_eur * k.miktar), 2) maliyet,
            round(sum(k.tutar_eur) - sum(k.birim_maliyet_eur * k.miktar), 2) katki, CASE WHEN sum(k.tutar_eur) > 0 THEN round((sum(k.tutar_eur) - sum(k.birim_maliyet_eur * k.miktar)) / sum(k.tutar_eur) * 100, 1) END oran
       FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref JOIN dosya_sigorta_kaydi s ON s.dosya_ref = f.dosya_ref
      WHERE k.onay_durumu = 'Onaylandı' AND f.statu = 'Karar' AND f.karar IN ${ONAY} AND f.karar_zamani >= $1::timestamptz - interval '12 months' AND s.sigortaci_adi IS NOT NULL
      GROUP BY s.sigortaci_adi ORDER BY katki DESC`, [simdi])).rows;
}

export function nakitKarlilikYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const gorur = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, GORUR])).rowCount);
  s.get('/nakit-tahmini', oturumlu, async (i, y) => ((await gorur(i.oturum!.kullanici)) ? { haftalar: await nakitTahmini(b.db), karlilik: await sigortaciKarlilik(b.db), giderPlani: (await b.db.query(`SELECT kimlik, kalem, tutar_eur, tekrar, ayin_gunu, tarih::text, baslangic::text, bitis::text FROM nakit_gider_plani WHERE aktif ORDER BY kalem`)).rows } : yok(y)));
  // Genel gider planını (kira, ücret, vergi, abonelik gibi) Muhasebe ve Finans Müdürü veya TİD girer; tutar EUR karşılığıdır.
  const planci = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, ['Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü']])).rowCount);
  s.post('/nakit-gider-plani', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await planci(o.kullanici))) return yok(y);
    const g = (i.body ?? {}) as { kalem?: string; tutar?: number; tekrar?: string; ayinGunu?: number; tarih?: string; baslangic?: string; bitis?: string };
    const tarih = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
    if (!g.kalem?.trim() || !(Number(g.tutar) > 0) || (g.tekrar === 'Aylık' ? !(Number(g.ayinGunu) >= 1 && Number(g.ayinGunu) <= 28) : g.tekrar === 'Tek Sefer' ? !tarih(g.tarih) : true)) return y.code(400).send({ hata: 'Kalem, pozitif tutar ve tekrar (aylık: ayın 1–28. günü; tek sefer: tarih) zorunludur.' });
    const k = (await b.db.query(`INSERT INTO nakit_gider_plani (kalem, tutar_eur, tekrar, ayin_gunu, tarih, baslangic, bitis, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [g.kalem.trim(), Number(g.tutar), g.tekrar, g.tekrar === 'Aylık' ? Number(g.ayinGunu) : null, g.tekrar === 'Tek Sefer' ? g.tarih : null, tarih(g.baslangic), tarih(g.bitis), o.kullanici])).rows[0].kimlik;
    return { kimlik: k };
  });
  s.post('/nakit-gider-plani/:id/kapat', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!/^[0-9a-f-]{36}$/.test(id) || !(await planci(i.oturum!.kullanici))) return yok(y);
    await b.db.query(`UPDATE nakit_gider_plani SET aktif = false WHERE kimlik = $1`, [id]); return { tamam: true };
  });
}
