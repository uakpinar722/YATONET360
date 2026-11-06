import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { rolId } from './ihbar.js';
import { rolSahipleri } from './makam.js';

const SAAT = 3_600_000;
/** Acilde onaylar iş sürerken tamamlanır; hatırlatma saatte bir. Acil olmayanda iş başlamadan tamamlanır; hatırlatma 4 saatte bir. */
const ARALIK = { acil: 1, normal: 4 };
const AZAMI = 3;

/**
 * YG-210: kurtarma, çekme ve dalgıçlık sözleşmesinde eksik kalan onay (firma, yat sahibi, LGM koordinatör) eksik taraf için hatırlatılır.
 * Üçüncü hatırlatmada Operasyon Müdürü de bilgilenir; sonrasında hatırlatma durur.
 */
export async function kurtarmaOnayHatirlat(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const { rows } = await db.query(`SELECT k.kimlik, k.acil, k.olusturma_zamani, k.saglayici_ref, k.yat_sahibi_onay_zamani, k.firma_onay_zamani, k.koordinator_onay_zamani, d.dosya_no, t.alici_kullanici_ref
    FROM kurtarma_operasyonu k JOIN dosya d ON d.kimlik = k.dosya_ref LEFT JOIN onay_talebi t ON t.kimlik = k.onay_talebi_ref
    WHERE d.statu <> 'Kapalı' AND (k.yat_sahibi_onay_zamani IS NULL OR k.firma_onay_zamani IS NULL OR k.koordinator_onay_zamani IS NULL)`);
  for (const k of rows) {
    const aralik = (k.acil ? ARALIK.acil : ARALIK.normal) * SAAT;
    const tur = Math.floor((simdi.getTime() - new Date(k.olusturma_zamani).getTime()) / aralik);
    if (tur < 1 || tur > AZAMI || !(await birKez(db, 'kurtarma_onay_hatir', `${k.kimlik}:${tur}`))) continue;
    const eksik: string[] = []; const alici: string[] = [];
    if (!k.firma_onay_zamani) { eksik.push('Hizmet sağlayıcı'); alici.push(...(await db.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [k.saglayici_ref])).rows.map((r) => r.kullanici_ref as string)); }
    if (!k.yat_sahibi_onay_zamani) { eksik.push('Yat sahibi'); if (k.alici_kullanici_ref) alici.push(k.alici_kullanici_ref); }
    if (!k.koordinator_onay_zamani) { eksik.push('LGM koordinatör'); alici.push(...await rolSahipleri(db, await rolId(db, 'Teknik ve Operasyon Direktörü'))); }
    if (tur === AZAMI) alici.push(...await rolSahipleri(db, await rolId(db, 'Operasyon Müdürü')));
    await bildir(db, { olay: `kurtarma-hatir:${k.kimlik}:${tur}`, kullanicilar: [...new Set(alici)], baslik: `${k.dosya_no} · Kurtarma Sözleşmesi Onayı Bekleniyor`, ozet: `Eksik onay: ${eksik.join(', ')}.`, oncelik: k.acil ? 'Kritik' : 'Yüksek', sms: Boolean(k.acil), acil: Boolean(k.acil) }, simdi);
    n++;
  }
  return n;
}
