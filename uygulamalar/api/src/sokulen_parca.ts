import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { kartAc } from './is_motoru.js';

const ONCE_GUN = 7;

/**
 * YG-077: sökülen parçada karar (iade, montaj, bekletme, hurda, eksper incelemesi) beklenirken son güne 7 gün kala Dosya Sorumlusu hatırlatılır;
 * sigortalı dosyada hatırlatma sigorta talimatı içindir. Süre talimatsız dolarsa parça sistemce "İade" seçilir ve yatla birlikte iade için görev açılır.
 */
export async function sokulenParcaIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const bugun = new Date(simdi.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }));
  const { rows } = await db.query(`SELECT p.kimlik, p.parca_adi, p.son_tarih, d.dosya_no, d.dosya_sorumlusu_ref, d.musteri_turu FROM sokulen_parca p JOIN dosya d ON d.kimlik = p.dosya_ref WHERE p.secim IS NULL AND d.statu <> 'Kapalı'`);
  for (const p of rows) {
    if (!p.dosya_sorumlusu_ref) continue;
    const kalan = Math.round((new Date(p.son_tarih).getTime() - bugun.getTime()) / 86_400_000);
    const sigortali = p.musteri_turu === 'Sigorta Şirketi';
    if (kalan >= 0 && kalan <= ONCE_GUN && await birKez(db, 'sokulen_parca_once', p.kimlik)) {
      await bildir(db, { olay: `sokulen-parca-once:${p.kimlik}`, kullanicilar: [p.dosya_sorumlusu_ref], baslik: `${p.dosya_no} · Sökülen Parça: ${p.parca_adi}`, ozet: sigortali ? `Sigorta talimatı bekleniyor; son gün ${kalan} gün sonra.` : `Parça için karar bekleniyor; son gün ${kalan} gün sonra.`, oncelik: 'Yüksek' }, simdi);
      n++;
    }
    if (kalan < 0 && await birKez(db, 'sokulen_parca_iade', p.kimlik)) {
      await db.query(`UPDATE sokulen_parca SET secim = 'İade', secim_zamani = now() WHERE kimlik = $1 AND secim IS NULL`, [p.kimlik]);
      await kartAc(db, { tur: 'Talimatsız Parça İadesi', kategori: 'gorev', baslik: `${p.dosya_no} · ${p.parca_adi} · Yatla İade`, ozet: '30 günlük süre talimatsız doldu; parça yatla birlikte iade edilir. Teslimde iadeyi kaydediniz.', oncelik: 'Yüksek', sahipKullanici: p.dosya_sorumlusu_ref, nesneTuru: 'Sökülen Parça', nesneKimligi: p.kimlik });
      n++;
    }
  }
  return n;
}
