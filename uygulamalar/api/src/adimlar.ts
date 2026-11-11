import type { Pool } from 'pg';

export type Adim = 'kosullar' | 'aydinlatma' | 'izinler' | 'rehber' | 'egitim';
/**
 * YG-1396: LGM personelinden ilk girişte, hesabından önce yayımlanmış Zorunlu ve Oryantasyon derslerinin; ayrıcalıklı (yüksek riskli) rolde,
 * rol atamasından önce yayımlanmış o rolün Rol Müfredatı derslerinin "okudum, anladım" beyanı aranır. Sonradan yayımlanan ders erişimi kilitlemez; Akademi bildirimiyle izlenir.
 */
export async function gerekliEgitimler(db: Pool, kullanici: string): Promise<{ kimlik: string; ad: string; tur: string; icerik: string; surum: number }[]> {
  return (await db.query(`SELECT DISTINCT d.kimlik, d.ad, d.tur, d.icerik, d.surum FROM akademi_ders d JOIN kullanici_hesabi h ON h.kimlik = $1
    WHERE d.aktif AND h.kullanici_grubu = 'LGM İç Rolü' AND NOT EXISTS (SELECT 1 FROM akademi_beyan x WHERE x.ders_ref = d.kimlik AND x.personel_ref = $1)
      AND ((d.tur IN ('Zorunlu', 'Oryantasyon') AND d.olusturma_zamani < h.olusturma_zamani AND (cardinality(d.roller) = 0 OR d.roller && (SELECT array_agg(r.rol_adi) FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif')))
        OR (d.tur = 'Rol Müfredatı' AND EXISTS (SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.ayricalikli_rol AND r.rol_adi = ANY (d.roller) AND d.olusturma_zamani < a.olusturma_zamani)))
    ORDER BY d.ad`, [kullanici])).rows;
}
/** YG-1396: portal rehberi beyanı yalnız Çözüm Ortağından istenir; sigorta şirketi ve diğer kullanıcılardan istenmez. */
export const rehberAdimiVar = (grup: string) => grup === 'İş Birliği Firması';

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
  const { rows } = await db.query(`SELECT kullanici_grubu, izin_adimi_zamani, portal_rehberi_beyani FROM kullanici_hesabi WHERE kimlik = $1`, [kullanici]);
  const h = rows[0]; const e: Adim[] = [];
  if (disKullanici(h.kullanici_grubu)) {
    const s = await sonSurum(db, 'PRT-01');
    if (!(await db.query(`SELECT 1 FROM kullanim_kosullari_kabulu WHERE kullanici_ref = $1 AND prt_surumu = $2`, [kullanici, s])).rowCount) e.push('kosullar');
  }
  const kod = aydinlatmaKodu(h.kullanici_grubu); const s = await sonSurum(db, kod);
  if (!(await db.query(`SELECT 1 FROM aydinlatma_kaydi WHERE ilgili_kisi_ref = $1 AND aydinlatma_metni = $2 AND metin_surumu = $3`, [kullanici, kod, s])).rowCount) e.push('aydinlatma');
  if (izinAdimiVar(h.kullanici_grubu) && !h.izin_adimi_zamani) e.push('izinler');
  if (rehberAdimiVar(h.kullanici_grubu) && !h.portal_rehberi_beyani) e.push('rehber');
  if (h.kullanici_grubu === 'LGM İç Rolü' && (await gerekliEgitimler(db, kullanici)).length) e.push('egitim');
  return e;
}
