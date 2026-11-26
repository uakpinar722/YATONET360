import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;
const UUID = /^[0-9a-f-]{36}$/;
const TABLOLAR = ['olcum_kaydi', 'test_kaydi', 'sokulen_parca', 'tedarik_siparisi'] as const;

/**
 * YG-384, YG-004 (PKT-1: iş paketi = iş emri): kayıt, aynı dosyadaki iş emrine bağlanır. İş emri verilmezse kayıt dosya düzeyinde kalır.
 * Başka dosyanın, iptal edilmiş veya yerine geçmiş iş emri kabul edilmez.
 */
export async function isEmriBagla(db: Db, tablo: (typeof TABLOLAR)[number], kimlik: string, dosya: string, isEmri?: string | null): Promise<string | null> {
  if (!isEmri) return null;
  if (!UUID.test(isEmri)) return 'İş emri geçersizdir.';
  const e = (await db.query(`SELECT statu FROM is_emri WHERE kimlik = $1 AND dosya_ref = $2`, [isEmri, dosya])).rows[0];
  if (!e || ['İptal', 'Yerine Geçti'].includes(e.statu)) return 'İş emri bu dosyada bulunamadı veya geçerli değildir.';
  await db.query(`UPDATE ${tablo} SET is_emri_ref = $2 WHERE kimlik = $1`, [kimlik, isEmri]);
  return null;
}

/** Gönderimden önce doğrulama (kayıt açılmadan). */
export async function isEmriGecerli(db: Db, dosya: string, isEmri?: string | null): Promise<boolean> {
  if (!isEmri) return true;
  if (!UUID.test(isEmri)) return false;
  return Boolean((await db.query(`SELECT 1 FROM is_emri WHERE kimlik = $1 AND dosya_ref = $2 AND statu NOT IN ('İptal', 'Yerine Geçti')`, [isEmri, dosya])).rowCount);
}

/** YG-004, YG-384: iş emrine bağlı kontrol noktası, ölçüm, test, parça, malzeme, uygunsuzluk, sapma ve kabul kayıtları tek görünümde. */
export function isEmriBagYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  s.get('/dosya/:id/is-emri-secenekleri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, o.kullanici, id))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    return (await b.db.query(`SELECT e.kimlik, e.is_emri_no, e.statu, k.ticari_unvan AS firma FROM is_emri e JOIN kurulus k ON k.kimlik = e.kurulus_ref WHERE e.dosya_ref = $1 AND e.statu NOT IN ('İptal', 'Yerine Geçti') ORDER BY e.is_emri_no`, [id])).rows;
  });
  s.get('/is-emri/:id/izlenebilirlik', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const e = UUID.test(id) ? (await b.db.query(`SELECT kimlik, dosya_ref, is_emri_no, statu FROM is_emri WHERE kimlik = $1`, [id])).rows[0] : undefined;
    if (!e || o.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, o.kullanici, e.dosya_ref))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    const q = async (sql: string) => (await b.db.query(sql, [id])).rows;
    return {
      isEmri: { no: e.is_emri_no, statu: e.statu },
      kontrolNoktalari: await q(`SELECT kimlik, kontrol_noktasi_no AS no, nokta_turu AS ad, sonuc AS durum FROM kontrol_noktasi WHERE is_emri_ref = $1 ORDER BY 1`),
      olcumler: await q(`SELECT kimlik, olcum_no AS no, olculen_buyukluk AS ad, sinir_disi FROM olcum_kaydi WHERE is_emri_ref = $1 ORDER BY olcum_zamani`),
      testler: await q(`SELECT kimlik, test_no AS no, test_grubu AS ad, durum, sonuc FROM test_kaydi WHERE is_emri_ref = $1 ORDER BY test_no`),
      parcalar: await q(`SELECT kimlik, parca_no AS no, urun_tanimi AS ad, kabul_karari AS durum FROM firma_parca_girisi WHERE is_emri_ref = $1 ORDER BY 1`),
      sokulenParcalar: await q(`SELECT kimlik, parca_adi AS ad, coalesce(sonuc, secim) AS durum FROM sokulen_parca WHERE is_emri_ref = $1 ORDER BY 1`),
      siparisler: await q(`SELECT kimlik, siparis_no AS no, statu AS durum FROM tedarik_siparisi WHERE is_emri_ref = $1 ORDER BY 1`),
      uygunsuzluklar: await q(`SELECT kimlik, uygunsuzluk_no AS no, sinif AS ad, statu AS durum FROM uygunsuzluk WHERE is_emri_ref = $1 ORDER BY 1`),
      sapmalar: await q(`SELECT kimlik, tur AS ad, durum FROM sapma_kaydi WHERE is_emri_ref = $1 ORDER BY 1`),
      kabuller: await q(`SELECT kimlik, kabul_turu AS ad FROM kabul_kaydi WHERE is_emri_ref = $1 ORDER BY 1`),
    };
  });
}
