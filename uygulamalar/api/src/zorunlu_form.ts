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

/** YG-636: koşula bağlı formlar; koşul gerçekleşince zorunlu sete eklenir. */
const KOSULLU: (Form & { kosul: string })[] = [
  { kod: 'FR-KLT-001', ad: 'Kontrol Noktası (ITP) · A/B sınıfı iş', kosul: `SELECT 1 FROM kalite_plani WHERE dosya_ref = $1 AND durum = 'Onaylı' AND kabul_sinifi IN ('A', 'B') LIMIT 1`, sql: ISE('kontrol_noktasi'), teklifSonrasi: true },
  { kod: 'FR-MLZ-003', ad: 'Malzeme Giriş Kabulü · teslim alınan malzeme', kosul: `SELECT 1 FROM tedarik_siparisi WHERE dosya_ref = $1 AND statu IN ('Kısmi Teslim', 'Teslim Alındı', 'Kapalı') LIMIT 1`, sql: `SELECT 1 FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE s.dosya_ref = $1 LIMIT 1`, teklifSonrasi: true },
  { kod: 'FR-UYG-004', ad: 'Kök Neden Analizi · Majör/Kritik uygunsuzluk', kosul: `SELECT 1 FROM uygunsuzluk WHERE dosya_ref = $1 AND sinif IN ('Majör', 'Kritik') AND statu <> 'Geçersiz' LIMIT 1`, sql: `SELECT 1 FROM uygunsuzluk u WHERE u.dosya_ref = $1 AND u.sinif IN ('Majör', 'Kritik') AND u.statu <> 'Geçersiz' AND NOT EXISTS (SELECT 1 FROM kok_neden_analizi k WHERE k.uygunsuzluk_ref = u.kimlik) HAVING count(*) = 0`, teklifSonrasi: true },
  { kod: 'FR-ISG-001', ad: 'İzin Belgesi Kaydı · sıcak iş', kosul: `SELECT 1 FROM form_kaydi WHERE dosya_ref = $1 AND form_kodu = 'FR-ONR-004' LIMIT 1`, sql: ISE('calisma_izni_belgesi'), teklifSonrasi: true },
  { kod: 'FR-TIC-004', ad: 'Avans ve Mahsup İzleme · firma avansı', kosul: `SELECT 1 FROM firma_malzeme_avansi WHERE dosya_ref = $1 LIMIT 1`, sql: DOSYA('hakedis_mahsubu'), teklifSonrasi: true },
];
/** YG-636: onaylı teklif kalemlerinin ana branşına (kartela kodu öneki) göre istenen formlar. Ana branş → kontrol listesi, proses kaydı, test grubu. */
const BRANS_FORM: { kod: string; ad: string; branslar: string[]; sql: string }[] = [
  ...([
    ['KL-TEK-002', ['CELIK-01', 'ALUMINYUM-01', 'METAL-01']], ['KL-TEK-003', ['KOMPOZIT-01']], ['KL-TEK-004', ['MAKINE-01', 'TAHRIK-01', 'JENERATOR-01']],
    ['KL-TEK-005', ['POMPA-01', 'TEMIZSU-01', 'SANITASYON-01', 'ATIK-01']], ['KL-TEK-006', ['AKU-01', 'ELEKTRIK-01', 'JENERATOR-01']], ['KL-TEK-007', ['ELEKTRIK-01']],
    ['KL-TEK-008', ['OTOMASYON-01', 'SEYIR-01']], ['KL-TEK-009', ['MANEVRA-01', 'HIDROLIK-01']], ['KL-TEK-010', ['GUVERTE-01', 'KALDIRMA-01']],
    ['KL-TEK-011', ['AKISKAN-01', 'GAZYAKIT-01']], ['KL-TEK-012', ['IKLIMLENDIRME-01', 'SOGUTMA-01']], ['KL-TEK-013', ['YANGIN-01']], ['KL-TEK-014', ['CAMKAPI-01']],
    ['KL-TEK-015', ['DEKORASYON-01', 'MARANGOZLUK-01', 'DOSEME-01', 'MUTFAK-01', 'KONFOR-01']],
  ] as [string, string[]][]).map(([kod, branslar]) => ({ kod, ad: 'Teknik Branş Kontrol Listesi', branslar, sql: `SELECT 1 FROM kontrol_listesi_kaydi WHERE dosya_ref = $1 AND kontrol_listesi = '${kod}' LIMIT 1` })),
  { kod: 'FR-ONR-003', ad: 'Kaplama Uygulama Kaydı', branslar: ['BOYA-01', 'SUALTI-01'], sql: `SELECT 1 FROM form_kaydi WHERE dosya_ref = $1 AND form_kodu = 'FR-ONR-003' LIMIT 1` },
  { kod: 'FR-ONR-004', ad: 'Sıcak İş ve Kaynak Proses Kaydı', branslar: ['CELIK-01', 'ALUMINYUM-01', 'METAL-01'], sql: `SELECT 1 FROM form_kaydi WHERE dosya_ref = $1 AND form_kodu = 'FR-ONR-004' LIMIT 1` },
  { kod: 'FR-ONR-005', ad: 'Proses Kaydı (Kompozit Laminasyon ve Kür)', branslar: ['KOMPOZIT-01'], sql: `SELECT 1 FROM proses_kaydi WHERE dosya_ref = $1 AND proses_turu = 'Kompozit Laminasyon ve Kür' LIMIT 1` },
  { kod: 'FR-ONR-006', ad: 'Yapıştırma, Sızdırmazlık ve Dolgu Kaydı', branslar: ['CAMKAPI-01', 'TIK-01'], sql: `SELECT 1 FROM proses_kaydi WHERE dosya_ref = $1 AND proses_turu = 'Yapıştırma, Sızdırmazlık ve Dolgu' LIMIT 1` },
  { kod: 'FR-ONR-007', ad: 'Mekanik Montaj ve Tork Kaydı', branslar: ['MAKINE-01', 'TAHRIK-01', 'MANEVRA-01', 'GUVERTE-01', 'KALDIRMA-01', 'POMPA-01'], sql: `SELECT 1 FROM form_kaydi WHERE dosya_ref = $1 AND form_kodu = 'FR-ONR-007' LIMIT 1` },
  { kod: 'FR-ONR-008', ad: 'Elektrik Kablo ve Terminasyon Kaydı', branslar: ['ELEKTRIK-01', 'AKU-01', 'OTOMASYON-01', 'SEYIR-01', 'AV-01', 'JENERATOR-01'], sql: `SELECT 1 FROM form_kaydi WHERE dosya_ref = $1 AND form_kodu = 'FR-ONR-008' LIMIT 1` },
  { kod: 'FR-ONR-009', ad: 'Borulama ve Basınçlı Bağlantı Montaj Kaydı', branslar: ['AKISKAN-01', 'TEMIZSU-01', 'SANITASYON-01', 'GAZYAKIT-01', 'IKLIMLENDIRME-01', 'SOGUTMA-01', 'YANGIN-01', 'HIDROLIK-01'], sql: `SELECT 1 FROM form_kaydi WHERE dosya_ref = $1 AND form_kodu = 'FR-ONR-009' LIMIT 1` },
  { kod: 'FR-KLT-004', ad: 'Test Kaydı · Gövde ve Yapısal', branslar: ['CELIK-01', 'ALUMINYUM-01', 'METAL-01', 'KOMPOZIT-01', 'AHSAP-01'], sql: `SELECT 1 FROM test_kaydi WHERE dosya_ref = $1 AND test_grubu = 'Gövde ve Yapısal' LIMIT 1` },
  { kod: 'FR-KLT-005', ad: 'Test Kaydı (Basınç, Sızdırmazlık ve Akış)', branslar: ['AKISKAN-01', 'TEMIZSU-01', 'SANITASYON-01', 'GAZYAKIT-01', 'IKLIMLENDIRME-01', 'SOGUTMA-01', 'YANGIN-01', 'HIDROLIK-01', 'POMPA-01'], sql: `SELECT 1 FROM test_kaydi WHERE dosya_ref = $1 AND test_grubu = 'Tesisat ve Yardımcı' LIMIT 1` },
  { kod: 'FR-KLT-006', ad: 'Test Kaydı (Elektrik, Alarm ve İşlev)', branslar: ['ELEKTRIK-01', 'AKU-01', 'OTOMASYON-01', 'SEYIR-01', 'AV-01', 'JENERATOR-01'], sql: `SELECT 1 FROM test_kaydi WHERE dosya_ref = $1 AND test_grubu IN ('Elektrik/Elektronik', 'Seyir ve Haberleşme') LIMIT 1` },
  { kod: 'FR-KLT-007', ad: 'Test Kaydı (Deniz Denemesi)', branslar: ['MAKINE-01', 'TAHRIK-01', 'MANEVRA-01'], sql: `SELECT 1 FROM test_kaydi WHERE dosya_ref = $1 AND test_grubu = 'Makine ve Tahrik' LIMIT 1` },
];
/** YG-636: onaylı iş emri bedeli olan ve teknik kabulü yapılan işte hakediş. */
const HAKEDIS = { kod: 'FR-TIC-003', ad: 'Hakediş · teknik kabulü yapılan iş', kosul: `SELECT 1 FROM is_emri WHERE dosya_ref = $1 AND coalesce(firma_bedeli_eur, 0) > 0 AND teknik_kabul_sonucu IS NOT NULL LIMIT 1`, sql: DOSYA('hakedis'), teklifSonrasi: true };
export type FormDurumu = { kod: string; ad: string; var: boolean; istisna?: string };
/** Teklif aşamasından önce kapanan dosyada yalnız o aşamaya kadarki formlar aranır. */
export async function zorunluFormlar(db: Db, dosya: string): Promise<FormDurumu[]> {
  const teklif = Boolean((await db.query(`SELECT 1 FROM fiyat_teklifi WHERE dosya_ref = $1 AND gonderim_zamani IS NOT NULL LIMIT 1`, [dosya])).rowCount);
  // Ek II §10.7: bakım ve planlı hizmette Teknik Rapor aranmaz.
  const planli = Boolean((await db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND oncelik = 'Planlı' AND dosya_niteligi <> 'Sigorta bağlantılı'`, [dosya])).rowCount);
  const l: FormDurumu[] = [];
  for (const f of FORMLAR) if ((teklif || !f.teklifSonrasi) && !(planli && f.kod === 'RP-RAP-002')) l.push({ kod: f.kod, ad: f.ad, var: Boolean((await db.query(f.sql, [dosya])).rowCount) });
  for (const f of KOSULLU) if ((await db.query(f.kosul, [dosya])).rowCount) l.push({ kod: f.kod, ad: f.ad, var: Boolean((await db.query(f.sql, [dosya])).rowCount) });
  for (const f of [HAKEDIS]) if ((await db.query(f.kosul, [dosya])).rowCount) l.push({ kod: f.kod, ad: f.ad, var: Boolean((await db.query(f.sql, [dosya])).rowCount) });
  const br = new Set((await db.query(`SELECT DISTINCT split_part(k.kartela_kodu, '.', 1) b FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi t ON t.kimlik = k.teklif_ref WHERE t.dosya_ref = $1 AND k.onay_durumu = 'Onaylandı' AND k.kartela_kodu IS NOT NULL`, [dosya])).rows.map((r) => r.b as string));
  if (br.size && (await db.query(`SELECT 1 FROM kesif WHERE dosya_ref = $1 LIMIT 1`, [dosya])).rowCount) l.push({ kod: 'KL-TEK-001', ad: 'Teknik Branş Kontrol Listesi · ortak', var: Boolean((await db.query(`SELECT 1 FROM kontrol_listesi_kaydi WHERE dosya_ref = $1 AND kontrol_listesi = 'KL-TEK-001' LIMIT 1`, [dosya])).rowCount) });
  for (const f of BRANS_FORM) if (f.branslar.some((x) => br.has(x)) && !l.some((x) => x.kod === f.kod)) l.push({ kod: f.kod, ad: f.ad, var: Boolean((await db.query(f.sql, [dosya])).rowCount) });
  // Ek II: kullanılmayan zorunlu form için gerekçeli istisna ve eşdeğer kontrol.
  const ist = new Map((await db.query(`SELECT form_kodu, gerekce, esdeger_kontrol FROM zorunlu_form_istisnasi WHERE dosya_ref = $1`, [dosya])).rows.map((r) => [r.form_kodu as string, `${r.gerekce} · Eşdeğer kontrol: ${r.esdeger_kontrol}`]));
  for (const x of l) if (!x.var && ist.has(x.kod)) { x.var = true; x.istisna = ist.get(x.kod); }
  return l;
}
