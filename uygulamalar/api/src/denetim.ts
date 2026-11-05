import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import type { Pool, PoolClient } from 'pg';

/** YG-1183: isteği yapan kullanıcı, değişiklik tetikleyicisine sorgu başındaki yorumla taşınır. */
export const istekBaglami = new AsyncLocalStorage<{ aktor?: string }>();
const YAZMA = /^\s*(INSERT|UPDATE|DELETE|WITH)\b/i;
const asilQuery = pg.Client.prototype.query as (...a: unknown[]) => unknown;
pg.Client.prototype.query = function (this: unknown, ...a: unknown[]) {
  const k = istekBaglami.getStore()?.aktor;
  if (k && typeof a[0] === 'string' && YAZMA.test(a[0])) a[0] = `/*aktor=${k.replace(/[^\w-]/g, '')}*/ ${a[0]}`;
  return asilQuery.apply(this, a);
} as typeof pg.Client.prototype.query;

/** YG-1185, LOG-1: izde kişisel veri ve gizli değer maskeli tutulur; tutar ve durum gibi kanıtlar kalır. */
const GIZLI_ANAHTAR = /(parola|belirtec|gizli|tckn|telefon|eposta|e_posta|iban|adres|ad_soyad|kisi_adi)/i;
export const izMaskele = (d: unknown): unknown => Array.isArray(d) ? d.map(izMaskele) : d && typeof d === 'object' ? Object.fromEntries(Object.entries(d as object).map(([k, v]) => [k, GIZLI_ANAHTAR.test(k) ? '***' : izMaskele(v)])) : d;

export interface IzKaydi {
  aktor?: string | null; oturum?: string | null; eylem: string; nesneTuru?: string; nesneKimligi?: string;
  eski?: unknown; yeni?: unknown; kanal?: string; adres?: string; sonuc: 'Başarılı' | 'Başarısız'; gerekce?: string; iliski?: string;
}

/** YG-1183, YG-1184. Parola, kod ve belirteç bu kayda hiçbir zaman yazılmaz (YG-1147, YG-1185). */
export async function izYaz(db: Pool | PoolClient, k: IzKaydi) {
  await db.query(
    `INSERT INTO denetim_izi (aktor_ref, oturum_ref, eylem, nesne_turu, nesne_kimligi, eski_deger, yeni_deger, kaynak_kanal, kaynak_adres, sonuc, gerekce, iliski_kimligi, butunluk_degeri)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'')`,
    [k.aktor ?? null, k.oturum ?? null, k.eylem, k.nesneTuru ?? null, k.nesneKimligi ?? null,
      k.eski === undefined ? null : JSON.stringify(izMaskele(k.eski)), k.yeni === undefined ? null : JSON.stringify(izMaskele(k.yeni)),
      k.kanal ?? 'Web', k.adres ?? null, k.sonuc, k.gerekce ?? null, k.iliski ?? null],
  );
}
