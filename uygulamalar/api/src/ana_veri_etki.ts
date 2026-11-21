import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { kartAc } from './is_motoru.js';

const YOK_SAY = new Set(['guncelleme_zamani', 'kayit_surumu', 'birlestirilen_ana_ref', 'surum']);

/**
 * YG-1240: yat, taraf ve firma ana kaydı değişince geçmiş değer kayıt izinde (kayit_degisikligi) korunur; değişiklik geriye dönük
 * uygulanmaz. Etkilenen her açık dosyanın Dosya Sorumlusuna, açık teklif ve iş emirlerini değerlendirmesi için bir kez görev açılır.
 */
export async function anaVeriEtkiIsle(db: Pool, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(`SELECT kimlik::text, tablo, nesne, degisen, to_char(zaman AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') z FROM kayit_degisikligi
    WHERE tablo IN ('yat', 'taraf', 'kurulus') AND islem = 'UPDATE' AND zaman > $1::timestamptz - interval '1 day' AND zaman <= $1::timestamptz ORDER BY kimlik`, [simdi]);
  // Aynı çalıştırmadaki değişiklikler dosya başına tek görevde toplanır.
  const toplu = new Map<string, { d: { kimlik: string; dosya_no: string; dosya_sorumlusu_ref: string }; alanlar: Set<string>; adlar: Set<string>; z: string }>();
  for (const r of rows) {
    const alanlar = Object.keys(r.degisen as Record<string, unknown>).filter((k) => !YOK_SAY.has(k));
    if (!alanlar.length || !r.nesne || !(await birKez(db, 'ana-veri-etki', r.kimlik))) continue;
    const dosyalar = (await db.query(r.tablo === 'yat'
      ? `SELECT d.kimlik, d.dosya_no, d.dosya_sorumlusu_ref FROM dosya d WHERE d.yat_ref::text = $1 AND d.statu NOT IN ('Kapalı', 'İptal')`
      : r.tablo === 'taraf'
        ? `SELECT DISTINCT d.kimlik, d.dosya_no, d.dosya_sorumlusu_ref FROM dosya d LEFT JOIN yat y ON y.kimlik = d.yat_ref WHERE d.statu NOT IN ('Kapalı', 'İptal') AND (y.yat_sahibi_ref::text = $1 OR EXISTS (SELECT 1 FROM dosya_tarafi t WHERE t.dosya_ref = d.kimlik AND t.aktif AND t.taraf_ref::text = $1))`
        : `SELECT DISTINCT d.kimlik, d.dosya_no, d.dosya_sorumlusu_ref FROM dosya d JOIN is_emri e ON e.dosya_ref = d.kimlik WHERE d.statu NOT IN ('Kapalı', 'İptal') AND e.kurulus_ref::text = $1 AND e.statu NOT IN ('İptal', 'Kapalı', 'Yerine Geçti')`, [r.nesne])).rows;
    const ad = { yat: 'Yat', taraf: 'Taraf', kurulus: 'Firma' }[r.tablo as 'yat' | 'taraf' | 'kurulus'];
    for (const d of dosyalar) {
      if (!d.dosya_sorumlusu_ref) continue;
      const x = toplu.get(d.kimlik) ?? { d, alanlar: new Set<string>(), adlar: new Set<string>(), z: r.z };
      alanlar.forEach((k) => x.alanlar.add(k.replace(/_/g, ' '))); x.adlar.add(ad); x.z = r.z; toplu.set(d.kimlik, x);
    }
  }
  let n = 0;
  for (const { d, alanlar, adlar, z } of toplu.values()) {
    const s = (await db.query(`SELECT (SELECT count(*) FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu <> 'Karar')::int teklif, (SELECT count(*) FROM is_emri WHERE dosya_ref = $1 AND statu NOT IN ('İptal', 'Kapalı', 'Yerine Geçti'))::int is_emri`, [d.kimlik])).rows[0];
    const ad = [...adlar].join(', ');
    await kartAc(db, { tur: 'Ana Veri Değişikliği Etkisi', kategori: 'gorev', baslik: `${d.dosya_no} · ${ad} Kaydı Değişti`, ozet: `${z} itibarıyla ${ad.toLocaleLowerCase('tr')} kaydında değişen alanlar: ${[...alanlar].join(', ')}. Önceki değer kayıt izinde korunur; değişiklik geçmiş işlemlere uygulanmaz. Açık ${s.teklif} teklif ve ${s.is_emri} iş emrini değerlendirmenizi rica ederiz.`, sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
    n++;
  }
  return n;
}
