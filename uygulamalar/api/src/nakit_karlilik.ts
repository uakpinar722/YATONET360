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
  const haftalar = Array.from({ length: 13 }, (_, n) => ({ baslangic: gunEkle(p, n * 7).toISOString().slice(0, 10), giris: 0, cikis: 0, net: 0, kumulatif: 0 }));
  const yaz = (t: Date, tutar: number, k: 'giris' | 'cikis') => { const n = Math.max(0, Math.floor((+t - +p) / (7 * 86_400_000))); if (n < 13) haftalar[n]![k] += tutar; };
  for (const f of (await db.query(`SELECT f.toplam_eur - f.tahsil_edilen_eur kalan, coalesce(f.vade, f.fatura_tarihi + $1::int) tarih FROM musteri_faturasi f WHERE f.durum IN ('Faturalandı', 'Kısmi Tahsil') AND f.toplam_eur > f.tahsil_edilen_eur`, [vade])).rows) yaz(new Date(f.tarih), Number(f.kalan), 'giris');
  for (const h of (await db.query(`SELECT h.net, h.olusturma_zamani, (SELECT max(t.tarih) FROM tahsilat t WHERE t.dosya_ref = h.dosya_ref) son FROM hakedis h WHERE h.statu IN ('Doğrulandı', 'Ödeme Talimatında')`)).rows) {
    const azami = gunEkle(new Date(h.olusturma_zamani), fAzami); const t = h.son ? new Date(Math.min(+gunEkle(new Date(h.son), fGun), +azami)) : azami;
    yaz(t, Number(h.net), 'cikis');
  }
  let k = 0; for (const h of haftalar) { h.giris = R2(h.giris); h.cikis = R2(h.cikis); h.net = R2(h.giris - h.cikis); k = R2(k + h.net); h.kumulatif = k; }
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
  s.get('/nakit-tahmini', oturumlu, async (i, y) => ((await gorur(i.oturum!.kullanici)) ? { haftalar: await nakitTahmini(b.db), karlilik: await sigortaciKarlilik(b.db) } : yok(y)));
}
