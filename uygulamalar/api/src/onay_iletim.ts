import type { PoolClient } from 'pg';
import { disGonder } from './bildirim.js';
import { kartAc } from './is_motoru.js';

/**
 * YG-207, YG-239: e-postası olmayan alıcıya onaylı belge kalıcı veri saklayıcıyla iletilir. Onay sonuç metni (ONY-21) SMS ile,
 * belgenin bulunduğu YATONET 360 hesabının bağlantısıyla gider; alıcının portal hesabı yoksa Dosya Sorumlusuna iletim görevi açılır.
 * Belge PDF'i dosyada üretilir; yat sahibi hesabından Belgelerim bölümünde indirir.
 */
export async function epostasizIletim(c: PoolClient, t: { kimlik: string; telefon: string | null; alici_kullanici_ref: string | null; dosya_ref: string | null; dosya_no?: string | null; belge_adi: string }, metin: string, web: string) {
  if (t.telefon) await disGonder(c, { olay: `onay-sonuc:${t.kimlik}`, telefon: t.telefon, konu: t.belge_adi, metin: `${metin} ${web}`, acil: true });
  if (t.dosya_ref) await (await import('./belge_uret.js')).belgeUret(c, { tur: 'Onay Belgesi', nesne: t.kimlik, dosya: t.dosya_ref });
  const ds = t.dosya_ref ? (await c.query(`SELECT dosya_sorumlusu_ref, dosya_no FROM dosya WHERE kimlik = $1`, [t.dosya_ref])).rows[0] : null;
  if (!t.alici_kullanici_ref && ds?.dosya_sorumlusu_ref) await kartAc(c, { tur: 'Kalıcı Saklayıcıyla İletim', kategori: 'gorev', baslik: `${ds.dosya_no} · ${t.belge_adi} · Kalıcı Saklayıcıyla İletim`, ozet: 'Alıcının e-posta adresi ve YATONET 360 hesabı yoktur. Onaylı belgeyi kalıcı veri saklayıcıyla iletiniz ve iletimi kaydediniz.', oncelik: 'Yüksek', sahipKullanici: ds.dosya_sorumlusu_ref, nesneTuru: 'Onay Talebi', nesneKimligi: t.kimlik });
}
