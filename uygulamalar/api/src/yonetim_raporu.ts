import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';

type Db = Pool | PoolClient;
const GORUR = ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü', 'Muhasebe ve Finans Müdürü', 'Muhasebe ve Finans Müdür Yardımcısı', 'Muhasebe ve Finans Yöneticisi'];
const ONAY = `('Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü')`;
const R2 = (x: number) => Math.round(x * 100) / 100;

/**
 * YG-761: RP-TIC-002 aylık yönetim raporu; dönem sonu itibarıyla
 * (1) faturalanmamış iş (WIP): işe başlanmış dosyada onaylı satış tutarından faturalanan (KDV hariç) düşülür,
 * (2) tahsil edilmemiş fatura: faturalanmış veya kısmi tahsil edilmiş kalan tutar ve gecikme günü,
 * (3) tahsil edildi ama firmaya ödenmedi: tahsilatı olan dosyada doğrulanmış, ödenmemiş hakediş neti.
 */
export async function yonetimRaporu(db: Db, donem: string) {
  const son = new Date(`${donem}-01T00:00:00Z`); son.setUTCMonth(son.getUTCMonth() + 1); const kesim = son.toISOString().slice(0, 10);
  const wip = (await db.query(
    `WITH s AS (SELECT f.dosya_ref, sum(k.tutar_eur) satis FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref WHERE k.onay_durumu = 'Onaylandı' AND f.statu = 'Karar' AND f.karar IN ${ONAY} AND f.karar_zamani < $1 GROUP BY 1),
          fa AS (SELECT dosya_ref, sum(kdv_haric_eur) fat FROM musteri_faturasi WHERE durum IN ('Faturalandı', 'Kısmi Tahsil', 'Tahsil Edildi') AND fatura_tarihi < $1 GROUP BY 1)
     SELECT d.dosya_no, s.satis, coalesce(fa.fat, 0) faturalanan, s.satis - coalesce(fa.fat, 0) wip FROM s JOIN dosya d ON d.kimlik = s.dosya_ref LEFT JOIN fa ON fa.dosya_ref = s.dosya_ref
      WHERE s.satis - coalesce(fa.fat, 0) > 0.005 AND EXISTS (SELECT 1 FROM is_emri e WHERE e.dosya_ref = s.dosya_ref AND e.statu IN ('Aktif', 'Tamamlandı', 'Kapalı', 'Çekinceli', 'Durduruldu') AND e.olusturma_zamani < $1) ORDER BY d.dosya_no`, [kesim])).rows;
  const tahsil = (await db.query(
    `SELECT d.dosya_no, f.fatura_no, f.muhatap, f.toplam_eur - coalesce((SELECT sum(t.tutar_eur) FROM tahsilat t WHERE t.fatura_ref = f.kimlik AND t.tarih < $1), 0) kalan, f.vade::text, greatest(0, ($1::date - 1) - f.vade) gecikme
       FROM musteri_faturasi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.fatura_tarihi < $1 AND f.durum IN ('Faturalandı', 'Kısmi Tahsil', 'Tahsil Edildi')
        AND f.toplam_eur - coalesce((SELECT sum(t.tutar_eur) FROM tahsilat t WHERE t.fatura_ref = f.kimlik AND t.tarih < $1), 0) > 0.005 ORDER BY f.vade NULLS LAST`, [kesim])).rows;
  const firma = (await db.query(
    `SELECT d.dosya_no, (SELECT sum(tutar_eur) FROM tahsilat t WHERE t.dosya_ref = d.kimlik AND t.tarih < $1) tahsil, sum(h.net) odenmemis FROM hakedis h JOIN dosya d ON d.kimlik = h.dosya_ref
      WHERE h.statu IN ('Doğrulandı', 'Ödeme Talimatında') AND h.olusturma_zamani < $1 AND EXISTS (SELECT 1 FROM tahsilat t WHERE t.dosya_ref = d.kimlik AND t.tarih < $1) GROUP BY d.kimlik, d.dosya_no ORDER BY d.dosya_no`, [kesim])).rows;
  const top = (l: Record<string, unknown>[], k: string) => R2(l.reduce((a, x) => a + Number(x[k]), 0));
  return { donem, kesim, wip, tahsil, firma, toplam: { wip: top(wip, 'wip'), tahsil: top(tahsil, 'kalan'), firma: top(firma, 'odenmemis') } };
}

/** Her ayın ilk günü önceki dönemin raporu hazır bildirimi gider. */
export async function yonetimRaporuIsle(db: Pool, simdi = new Date()): Promise<boolean> {
  const o = new Date(Date.UTC(simdi.getFullYear(), simdi.getMonth() - 1, 1)); const donem = o.toISOString().slice(0, 7);
  if (!(await birKez(db, 'rp-tic-002', donem))) return false;
  const r = await yonetimRaporu(db, donem); const t = (x: number) => x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const k: string[] = []; for (const ad of ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü']) { const id = (await db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0]?.kimlik; if (id) k.push(...await rolSahipleri(db, id)); }
  await bildir(db, { olay: `rp-tic-002:${donem}`, kullanicilar: [...new Set(k)], baslik: `RP-TIC-002 Aylık Yönetim Raporu Hazır: ${donem}`, ozet: `Faturalanmamış iş ${t(r.toplam.wip)} EUR · Tahsil edilmemiş ${t(r.toplam.tahsil)} EUR · Firmaya ödenmemiş ${t(r.toplam.firma)} EUR` }, simdi);
  return true;
}

export function yonetimRaporuYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/yonetim-raporu', oturumlu, async (i, y) => {
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [i.oturum!.kullanici, GORUR])).rowCount) return yok(y);
    const q = (i.query ?? {}) as { donem?: string }; const n = new Date();
    const donem = q.donem && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.donem) ? q.donem : new Date(Date.UTC(n.getFullYear(), n.getMonth() - 1, 1)).toISOString().slice(0, 7);
    return yonetimRaporu(b.db, donem);
  });
}
