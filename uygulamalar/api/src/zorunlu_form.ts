import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;
type Form = { kod: string; ad: string; sql: string; teklifSonrasi: boolean };
const ISE = (t: string) => `SELECT 1 FROM ${t} x JOIN is_emri e ON e.kimlik = x.is_emri_ref WHERE e.dosya_ref = $1 LIMIT 1`;
const DOSYA = (t: string) => `SELECT 1 FROM ${t} WHERE dosya_ref = $1 LIMIT 1`;

/** YG-635: zorunlu form seti kayıt türlerine bağlıdır. FR-TIC-001 kullanım dışıdır (YG-653). */
const FORMLAR: Form[] = [
  { kod: 'FR-OPS-009', ad: 'Hasar İhbar ve İlk Kayıt', sql: `SELECT 1 FROM dosya WHERE kimlik = $1 AND talep_ref IS NOT NULL`, teklifSonrasi: false },
  { kod: 'FR-OPS-001', ad: 'Taraf ve Yetki Kaydı', sql: DOSYA('dosya_tarafi'), teklifSonrasi: false },
  { kod: 'FR-OPS-002', ad: 'Dosya Kaydı', sql: `SELECT 1 FROM dosya WHERE kimlik = $1`, teklifSonrasi: false },
  { kod: 'FR-OPS-004', ad: 'Görev Kabul ve Açılış Onayı', sql: DOSYA('dosya_acilis_karari'), teklifSonrasi: false },
  { kod: 'RP-RAP-002', ad: 'Teknik Rapor', sql: DOSYA('teknik_rapor'), teklifSonrasi: true },
  { kod: 'FR-ONR-012', ad: 'Kapsam ve Metraj Cetveli', sql: DOSYA('kapsam_cetveli'), teklifSonrasi: true },
  { kod: 'FR-TIC-008', ad: 'Fiyat Teklifi', sql: DOSYA('fiyat_teklifi'), teklifSonrasi: true },
  { kod: 'FR-OPS-007', ad: 'Onay Kararı', sql: `SELECT 1 FROM fiyat_teklifi WHERE dosya_ref = $1 AND karar IS NOT NULL LIMIT 1`, teklifSonrasi: true },
  { kod: 'FR-OPS-008', ad: 'İş Emri', sql: DOSYA('is_emri'), teklifSonrasi: true },
  { kod: 'FR-ONR-002', ad: 'Onarım Alanı Teslimi ve İşe Başlama', sql: ISE('baslangic_toplantisi'), teklifSonrasi: true },
  { kod: 'RP-RAP-001', ad: 'İlerleme Kaydı', sql: ISE('is_emri_ilerleme'), teklifSonrasi: true },
  { kod: 'FR-KLT-009', ad: 'Kabul Kaydı', sql: DOSYA('kabul_kaydi'), teklifSonrasi: true },
];

export type FormDurumu = { kod: string; ad: string; var: boolean };
/** Teklif aşamasından önce kapanan dosyada yalnız o aşamaya kadarki formlar aranır. */
export async function zorunluFormlar(db: Db, dosya: string): Promise<FormDurumu[]> {
  const teklif = Boolean((await db.query(`SELECT 1 FROM fiyat_teklifi WHERE dosya_ref = $1 AND gonderim_zamani IS NOT NULL LIMIT 1`, [dosya])).rowCount);
  // Ek II §10.7: bakım ve planlı hizmette Teknik Rapor aranmaz.
  const planli = Boolean((await db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND oncelik = 'Planlı' AND dosya_niteligi <> 'Sigorta bağlantılı'`, [dosya])).rowCount);
  const l: FormDurumu[] = [];
  for (const f of FORMLAR) if ((teklif || !f.teklifSonrasi) && !(planli && f.kod === 'RP-RAP-002')) l.push({ kod: f.kod, ad: f.ad, var: Boolean((await db.query(f.sql, [dosya])).rowCount) });
  return l;
}
