import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

/** Cilt I ¶1030: Müdürlüğün bağlı olduğu Direktör. */
const BAGLI_DIREKTOR: Record<string, string> = {
  'Operasyon Müdürlüğü': 'Teknik ve Operasyon Direktörü', 'Teknik Müdürlük': 'Teknik ve Operasyon Direktörü', 'Tedarik Yönetimi Müdürlüğü': 'Teknik ve Operasyon Direktörü',
  'Muhasebe ve Finans Müdürlüğü': 'Ticari İşler Direktörü', 'İnsan Kaynakları Müdürlüğü': 'Ticari İşler Direktörü', 'İdari İşler Müdürlüğü': 'Ticari İşler Direktörü',
  'Bilgi İşlem Müdürlüğü': 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Firma Yönetimi Müdürlüğü': 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü',
  'Kalite Müdürlüğü': 'Risk ve Kalite Direktörü', 'İç Denetim Müdürlüğü': 'Risk ve Kalite Direktörü',
  'Müşteri ve Paydaş İlişkileri Müdürlüğü': 'Strateji ve Kurumsal Gelişim Direktörü',
};

/**
 * YG-1009, YG-1714 (ERS-1): birim personeli → birim Müdürü; Müdürlüğü olmayan birimde aynı birimin Direktörü; Müdür → bağlı Direktör;
 * Direktör → Genel Müdür Yardımcısı; Üst Yönetim rolleri → CEO.
 */
export async function onayMakami(db: Db, rolId: string): Promise<string> {
  const { rows } = await db.query(`SELECT rol_adi, rol_sahibi_birim, kademe FROM rol WHERE kimlik = $1`, [rolId]);
  const r = rows[0];
  const bul = async (ad: string) => (await db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
  if (r.rol_sahibi_birim === 'Üst Yönetim') return bul('CEO');
  if (r.kademe === 'Direktör') return bul('Genel Müdür Yardımcısı');
  if (r.kademe === 'Müdür') {
    const d = BAGLI_DIREKTOR[r.rol_sahibi_birim];
    if (!d) throw new Error(`Bağlı Direktör tanımsız: ${r.rol_sahibi_birim}`);
    return bul(d);
  }
  for (const k of ['Müdür', 'Direktör']) {
    const m = await db.query(`SELECT kimlik FROM rol WHERE rol_sahibi_birim = $1 AND kademe = $2 AND kimlik <> $3 LIMIT 1`, [r.rol_sahibi_birim, k, rolId]);
    if (m.rows[0]) return m.rows[0].kimlik;
  }
  throw new Error(`Onay makamı tanımsız: ${r.rol_adi}`);
}

/** Geçerli sahipler: rolün asıl sahipleri ve o rolde vekâlet yürütenler. */
export async function rolSahipleri(db: Db, rol: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT a.kullanici_ref k FROM rol_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref
      WHERE a.rol_ref = $1 AND a.atama_durumu = 'Aktif' AND a.baslangic_tarihi <= current_date AND (a.bitis_tarihi IS NULL OR a.bitis_tarihi >= current_date) AND h.hesap_durumu = 'Aktif'
     UNION
     SELECT v.vekil_ref FROM vekalet v JOIN kullanici_hesabi h ON h.kimlik = v.vekil_ref
      WHERE v.rol_ref = $1 AND v.durum = 'Aktif' AND v.baslangic_tarihi <= current_date AND v.bitis_tarihi >= current_date AND h.hesap_durumu = 'Aktif'`, [rol]);
  return rows.map((r) => r.k as string);
}

/**
 * YG-1034: hazırlayan kendi kaydını onaylayamaz. Makamda ondan başka kimse yoksa kayıt bir sonraki yetkiliye düşer; zincirin sonunda CEO kalır.
 */
export async function zinciriDuzelt(db: Db, zincir: string[], hazirlayan?: string | null): Promise<string[]> {
  if (!hazirlayan) return zincir;
  const sonuc: string[] = [];
  for (let rol of zincir) {
    for (let i = 0; i < 6; i++) {
      const s = await rolSahipleri(db, rol);
      if (!(s.length === 1 && s[0] === hazirlayan)) break;
      const ust = await onayMakami(db, rol);
      if (ust === rol) break;
      rol = ust;
    }
    if (!sonuc.includes(rol)) sonuc.push(rol);
  }
  return sonuc;
}
