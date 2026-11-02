import type { Pool } from 'pg';

export type Adim = 'kosullar' | 'aydinlatma' | 'izinler';

/** KVKK-10 Bölüm 3: kullanıcı grubuna göre aydınlatma metni. */
export function aydinlatmaKodu(grup: string): string {
  if (grup === 'LGM İç Rolü') return 'KVKK-05';
  if (grup === 'İş Birliği Firması') return 'KVKK-03';
  if (grup.startsWith('Bireysel Müşteri')) return 'KVKK-01';
  return 'KVKK-04';
}
export const disKullanici = (grup: string) => grup !== 'LGM İç Rolü';
/** KVKK-10 Bölüm 4: kurumsal dış kullanıcıdan açık rıza istenmez. */
export const izinAdimiVar = (grup: string) => grup === 'LGM İç Rolü' || grup.startsWith('Bireysel Müşteri');
/** Bireysel yat sahibi: pazarlama ve ticari ileti. LGM personeli: özel gün. */
export const rizaBicimi = (grup: string) => (grup === 'LGM İç Rolü' ? 'ozel_gun' : 'pazarlama');

export const dilKodu = (tercih: string) => (tercih === 'İngilizce' ? 'en' : 'tr');

export async function sonSurum(db: Pool, kod: string): Promise<string> {
  const { rows } = await db.query(`SELECT surum FROM hukuki_metin WHERE kod = $1 ORDER BY surum DESC LIMIT 1`, [kod]);
  if (!rows[0]) throw new Error(`Hukuki metin yüklü değil: ${kod}`);
  return rows[0].surum;
}

/** Sıra KVKK-10 Bölüm 2. Yeni sürüm yüklenince adım bir sonraki girişte yeniden açılır (Bölüm 5). */
export async function eksikAdimlar(db: Pool, kullanici: string): Promise<Adim[]> {
  const { rows } = await db.query(`SELECT kullanici_grubu, izin_adimi_zamani FROM kullanici_hesabi WHERE kimlik = $1`, [kullanici]);
  const h = rows[0]; const e: Adim[] = [];
  if (disKullanici(h.kullanici_grubu)) {
    const s = await sonSurum(db, 'PRT-01');
    if (!(await db.query(`SELECT 1 FROM kullanim_kosullari_kabulu WHERE kullanici_ref = $1 AND prt_surumu = $2`, [kullanici, s])).rowCount) e.push('kosullar');
  }
  const kod = aydinlatmaKodu(h.kullanici_grubu); const s = await sonSurum(db, kod);
  if (!(await db.query(`SELECT 1 FROM aydinlatma_kaydi WHERE ilgili_kisi_ref = $1 AND aydinlatma_metni = $2 AND metin_surumu = $3`, [kullanici, kod, s])).rowCount) e.push('aydinlatma');
  if (izinAdimiVar(h.kullanici_grubu) && !h.izin_adimi_zamani) e.push('izinler');
  return e;
}
