import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { parametre } from './teklif.js';

const IDM = 'İç Denetim Müdürü'; const TUR = 'İç Usulsüzlük Uyarısı';
/** V-394: 90 günlük pencere; eşleşmede en az 5 iş emri ve %60 pay; sapma ve eşik altında en az 3 kayıt; eşik altı limitin %90'ı ve üstü. */
export const USUL = { gun: 90, eslesmeAdet: 5, eslesmePay: 0.6, sapmaAdet: 3, esikAlti: 0.9, esikAdet: 3 };

/**
 * YG-768: iç usulsüzlük işaretleri İç Denetim Müdürüne görev olarak düşer: aynı personel ile aynı firmanın sürekli eşleşmesi,
 * kartela birim fiyatından bant dışı sapma, onay limitinin hemen altında kalan tutarlar. Uyarı suçlama değildir; inceleme başlatır.
 */
export async function usulsuzlukTara(db: Pool, simdi = new Date()): Promise<number> {
  const bas = new Date(+simdi - USUL.gun * 86_400_000); const donem = simdi.toISOString().slice(0, 7); const idm = await rolId(db, IDM); let n = 0;
  const ac = async (anahtar: string, baslik: string, ozet: string) => {
    if (!(await birKez(db, 'usulsuzluk', `${donem}:${anahtar}`))) return;
    await kartAc(db, { tur: TUR, kategori: 'gorev', baslik, ozet, sahipRol: idm, sonZaman: new Date(+simdi + 10 * 86_400_000), nesneTuru: TUR, nesneKimligi: `${donem}:${anahtar}` }); n++;
  };
  const eslesme = (await db.query(
    `WITH t AS (SELECT hazirlayan_ref k, kurulus_ref f, count(*)::int n FROM is_emri WHERE olusturma_zamani >= $1 AND olusturma_zamani < $2 AND kurulus_ref IS NOT NULL GROUP BY 1, 2)
     SELECT t.k, t.f, t.n, (SELECT sum(n) FROM t x WHERE x.k = t.k)::int toplam, h.ad_soyad, u.ticari_unvan FROM t JOIN kullanici_hesabi h ON h.kimlik = t.k JOIN kurulus u ON u.kimlik = t.f WHERE t.n >= $3`, [bas, simdi, USUL.eslesmeAdet])).rows;
  for (const r of eslesme) if (r.n / r.toplam >= USUL.eslesmePay) await ac(`eslesme:${r.k}:${r.f}`, `Personel–Firma Eşleşmesi: ${r.ad_soyad}`, `${USUL.gun} günde ${r.toplam} iş emrinin ${r.n} tanesi ${r.ticari_unvan} firmasına.`);
  const bant = await parametre(db, 'bant_orani');
  const sapma = (await db.query(
    `SELECT f.kurulus_ref, u.ticari_unvan, count(*)::int n FROM firma_fiyat_kalemi k JOIN firma_fiyat_teklifi f ON f.kimlik = k.teklif_ref JOIN kapsam_satiri s ON s.kimlik = k.satir_ref JOIN kartela_kalemi m ON m.kod = s.kartela_kodu JOIN kurulus u ON u.kimlik = f.kurulus_ref
      WHERE f.olusturma_zamani >= $1 AND f.olusturma_zamani < $2 AND m.maliyet_eur > 0 AND k.birim_fiyat_eur > m.maliyet_eur * (1 + $3::numeric) GROUP BY 1, 2 HAVING count(*) >= $4`, [bas, simdi, bant, USUL.sapmaAdet])).rows;
  for (const r of sapma) await ac(`sapma:${r.kurulus_ref}`, `Birim Fiyattan Sapma: ${r.ticari_unvan}`, `${USUL.gun} günde ${r.n} kalem kartela birim fiyatının %${Math.round(bant * 100)} üzerinde.`);
  for (const kod of ['limit_tid_eur', 'limit_gmy_eur']) {
    const lim = await parametre(db, kod); if (!(lim > 0)) continue;
    const esik = (await db.query(`SELECT k.hazirlayan_ref, h.ad_soyad, count(*)::int n FROM is_karti k JOIN kullanici_hesabi h ON h.kimlik = k.hazirlayan_ref WHERE k.kategori = 'onay' AND k.olusturma_zamani >= $1 AND k.olusturma_zamani < $2 AND k.tutar_eur >= $3 AND k.tutar_eur < $4 GROUP BY 1, 2 HAVING count(*) >= $5`, [bas, simdi, lim * USUL.esikAlti, lim, USUL.esikAdet])).rows;
    for (const r of esik) await ac(`esik:${kod}:${r.hazirlayan_ref}`, `Onay Limitinin Hemen Altında Tutarlar: ${r.ad_soyad}`, `${USUL.gun} günde ${r.n} kayıt ${lim.toLocaleString('tr-TR')} EUR limitinin %${Math.round(USUL.esikAlti * 100)}–100 aralığında.`);
  }
  return n;
}
