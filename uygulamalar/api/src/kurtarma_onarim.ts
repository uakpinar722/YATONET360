import type { PoolClient } from 'pg';
import { birKez } from './bildirim.js';
import { ihbarKaydet } from './ihbar.js';
import { kartAc } from './is_motoru.js';

/**
 * YG-145: kurtarma, çekme veya dalış işi biten dosyada onarım için yeni olay talebi açılır; aynı yat ve yat sahibi taşınır, önceki dosyaya bağlanır.
 * Dosya Sorumlusu talebi olağan mükerrerlik ve açılış kontrolüyle yeni dosyaya çevirir. Her dosya için bir kez.
 */
export async function kurtarmaSonrasiOnarimTalebi(c: PoolClient, dosya: string, kullanici: string): Promise<string | null> {
  if (!(await c.query(`SELECT 1 FROM kurtarma_operasyonu WHERE dosya_ref = $1 LIMIT 1`, [dosya])).rowCount) return null;
  if (!(await birKez(c, 'kurtarma_onarim_talebi', dosya))) return null;
  const d = (await c.query(`SELECT d.dosya_no, d.yat_ref, d.konum, d.dosya_sorumlusu_ref, d.yazisma_dili FROM dosya d WHERE d.kimlik = $1`, [dosya])).rows[0];
  const s = (await c.query(`SELECT kisi_adi_soyadi, telefon, eposta, taraf_rolu FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif AND taraf_rolu IN ('Yat Sahibi', 'Kaptan') ORDER BY taraf_rolu = 'Yat Sahibi' DESC LIMIT 1`, [dosya])).rows[0];
  const ilk = d.dosya_sorumlusu_ref ?? kullanici;
  const r = await ihbarKaydet(c, {
    kanal: 'YATONET 360', sahibiAdi: s?.kisi_adi_soyadi ?? 'Yat Sahibi', sahibiTuru: s?.taraf_rolu === 'Kaptan' ? 'Yatın Kaptanı' : 'Yat Sahibi', telefon: s?.telefon ?? undefined, eposta: s?.eposta ?? undefined,
    konum: d.konum ?? '-', yatDurumu: 'Kurtarma sonrası', ihtiyac: `Kurtarma, çekme veya dalış sonrası onarım (önceki dosya ${d.dosya_no})`, yat: { yatId: d.yat_ref }, oncelik: 'Normal', cevaplar: {}, dil: d.yazisma_dili,
  }, kullanici, { ilkSorumlu: ilk });
  if ('hata' in r) return null;
  await c.query(`UPDATE talep SET onceki_dosya_ref = $2 WHERE kimlik = $1`, [r.kimlik, dosya]);
  await kartAc(c, { tur: 'Onarım İçin Yeni Dosya', kategori: 'gorev', baslik: `${d.dosya_no} · Onarım Talebi ${r.talepNo}`, ozet: 'Kurtarma işi tamamlandı; onarım talebini mükerrerlik ve açılış kontrolüyle dosyaya çeviriniz.', oncelik: 'Yüksek', sahipKullanici: ilk, nesneTuru: 'Talep', nesneKimligi: r.kimlik });
  return r.kimlik;
}
