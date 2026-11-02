import type { Pool, PoolClient } from 'pg';

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
      k.eski === undefined ? null : JSON.stringify(k.eski), k.yeni === undefined ? null : JSON.stringify(k.yeni),
      k.kanal ?? 'Web', k.adres ?? null, k.sonuc, k.gerekce ?? null, k.iliski ?? null],
  );
}
