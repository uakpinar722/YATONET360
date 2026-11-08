import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

export const KESIF_HAZIR = 'Keşif Talebi Hazır'; export const FIRMAYA_GONDER = 'Firmaya Gönder';

/** YG-1597, KSF-1: Teknik Uzman atanıp ekip tamamlanınca keşif talebi hazırlanır; firmayı Operasyon Yöneticisi seçer. */
export async function kesifTalebiHazirla(c: PoolClient, dosya: string, dosyaNo: string): Promise<void> {
  const oy = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Operasyon Yöneticisi' AND bitis_zamani IS NULL LIMIT 1`, [dosya])).rows[0]?.kullanici_ref as string | undefined;
  if (oy) await kartAc(c, { tur: KESIF_HAZIR, kategori: 'gorev', baslik: `${dosyaNo} · Keşif Talebi Hazır`, ozet: 'Keşif iş emri için firmayı seçiniz.', sahipKullanici: oy, nesneTuru: 'Dosya', nesneKimligi: dosya });
}

/** KN iş emri firmaya hemen gitmez; Dosya Sorumlusuna "Firmaya Gönder" görevi düşer. */
export async function gonderimeHazirla(c: PoolClient, e: { kimlik: string; is_emri_no: string; dosya_ref: string }): Promise<void> {
  await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $2 AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [e.dosya_ref, KESIF_HAZIR]);
  const ds = (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0]?.r as string | null;
  if (ds) await kartAc(c, { tur: FIRMAYA_GONDER, kategori: 'gorev', baslik: `${e.is_emri_no} · Firmaya Gönder`, ozet: 'Keşif iş emri hazır; gönderimle keşif süresi başlar.', oncelik: 'Yüksek', sahipKullanici: ds, nesneTuru: 'İş Emri', nesneKimligi: e.kimlik });
}

export function kesifTalebiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  // Hazır talep: iş emri formuna yer ve kapsam dolu gelir; Operasyon Yöneticisi düzeltebilir.
  s.get('/dosya/:id/kesif-talebi', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (i.oturum!.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT d.konum, t.ihtiyac_tanimi FROM dosya d JOIN talep t ON t.kimlik = d.talep_ref WHERE d.kimlik = $1`, [id])).rows[0];
    return d ? { yer: d.konum ?? '', kapsam: d.ihtiyac_tanimi ?? '' } : yok(y);
  });
}
