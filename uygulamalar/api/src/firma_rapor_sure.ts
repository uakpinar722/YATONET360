import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { kartAc } from './is_motoru.js';
import { raporSonZamani } from './rapor.js';

const ONCE_SAAT = 4;

/**
 * YG-1483, YG-1518: keşif iş emri kabul edildikten sonra Firma Teknik Raporu ve Firma Fiyat Teklifi için öncelik süresi işler.
 * Son zamana 4 saat kala firmaya hatırlatma gider; süre aşılınca Dosya Sorumlusuna görev açılır (her iş emri ve belge türü için bir kez).
 */
export async function firmaRaporSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const { rows } = await db.query(`SELECT e.kimlik, e.is_emri_no, e.kurulus_ref, e.dosya_ref, e.firma_kabul_zamani, d.oncelik, d.dosya_sorumlusu_ref,
      EXISTS (SELECT 1 FROM firma_teknik_raporu r WHERE r.is_emri_ref = e.kimlik) AS rapor,
      EXISTS (SELECT 1 FROM firma_fiyat_teklifi f WHERE f.dosya_ref = e.dosya_ref AND f.kurulus_ref = e.kurulus_ref) AS fiyat
    FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref
    WHERE e.is_emri_turu = 'KN' AND e.firma_kabul_zamani IS NOT NULL AND e.statu NOT IN ('İptal', 'Kapalı', 'Yerine Geçti') AND d.statu <> 'Kapalı'`);
  for (const e of rows) {
    if (e.rapor && e.fiyat) continue;
    const son = await raporSonZamani(db, e.oncelik, new Date(e.firma_kabul_zamani));
    const kalan = (son.getTime() - simdi.getTime()) / 3_600_000;
    const eksik = [!e.rapor && 'Firma Teknik Raporu', !e.fiyat && 'Firma Fiyat Teklifi'].filter(Boolean) as string[];
    const sonMetin = son.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
    if (kalan > 0 && kalan <= ONCE_SAAT && await birKez(db, 'firma_rapor_once', e.kimlik)) {
      const firma = (await db.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [e.kurulus_ref])).rows.map((r) => r.kullanici_ref as string);
      await bildir(db, { olay: `firma-rapor-once:${e.kimlik}`, kullanicilar: firma, baslik: `${e.is_emri_no} · Süre Yaklaşıyor`, ozet: `${eksik.join(' ve ')} için son zaman: ${sonMetin}.`, oncelik: 'Yüksek' }, simdi);
      n++;
    }
    if (kalan <= 0 && e.dosya_sorumlusu_ref && await birKez(db, 'firma_rapor_gecikti', `${e.kimlik}:${eksik.join('+')}`)) {
      await kartAc(db, { tur: 'Firma Raporu Gecikti', kategori: 'gorev', baslik: `${e.is_emri_no} · ${eksik.join(' ve ')} Gecikti`, ozet: `Son zaman ${sonMetin} geçti. Firmayla görüşünüz veya firmayı değiştiriniz.`, oncelik: e.oncelik === 'Kritik' ? 'Kritik' : 'Yüksek', sahipKullanici: e.dosya_sorumlusu_ref, nesneTuru: 'İş Emri', nesneKimligi: e.kimlik });
      n++;
    }
  }
  return n;
}
