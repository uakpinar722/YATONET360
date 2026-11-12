import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { gunAy } from './metin.js';
import type { Bolum } from './pdf.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;
const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** PR-RAP-001 Belge Kataloğu Prosedürünün onaylayanı (Ek II). */
const YONETIR = ['Teknik ve Operasyon Direktörü'];
const KOD = /^(FR|KL|RP|PR)-[A-Z]{3}-\d{3}$/;
export type Blok = { t: 'b' | 'a' | 'm'; m: string };
/** YG-1513 onaylı atamalar (katalogdaki dolduran/onaylayan sütunundan bağımsız). */
const ONAYLI: Record<string, string[]> = {
  'Dosya Sorumlusu': ['FR-OPS-017', 'FR-OPS-018', 'FR-HUK-003', 'FR-KLT-016'],
  'Müşteri ve Paydaş İlişkileri Müdürü': ['FR-KLT-016'],
  'Operasyon Müdürü': ['FR-OPS-018', 'FR-OPS-019'],
  'Teknik Uzman': ['FR-OPS-019'],
};
type Kalem = { kod: string; ad: string; durum: string; dolduran: string | null; onaylayan: string | null; goren: string | null };

/** YG-601: taslak veya iptal edilmiş araç yeni kayıtta seçilemez. */
export async function formSecilebilir(db: Db, kod: string): Promise<boolean> {
  return Boolean((await db.query(`SELECT 1 FROM form_katalogu WHERE kod = $1 AND durum = 'Yürürlükte'`, [kod])).rowCount);
}

/** Rol adı metinde geçiyor mu ("Teknik Müdür" "Teknik Müdür Yardımcısı"nı kapsamaz). */
export const rolGecer = (metin: string | null, rol: string) => Boolean(metin) && new RegExp(`${rol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])(?! Yardımcısı)`, 'u').test(metin!);

/** YG-1513: görev tanımındaki "Kullandığı formlar ve kayıtlar" bölümü katalogdan üretilir: ad ve durum katalogdan gelir, iptal kod düşer,
 * katalogda rolün dolduran veya onaylayan olarak geçtiği araçlar eklenir. */
export async function gorevFormlari(db: Db, rol: string, bloklar: Blok[]): Promise<Blok[]> {
  const k = (await db.query(`SELECT kod, ad, durum, dolduran, onaylayan, goren FROM form_katalogu ORDER BY kod`)).rows as Kalem[];
  if (!k.length) return bloklar;
  const i = bloklar.findIndex((x) => x.t === 'b' && x.m === 'Kullandığı formlar ve kayıtlar');
  const son = i < 0 ? -1 : bloklar.findIndex((x, j) => j > i && x.t === 'b');
  const eski = i < 0 ? [] : bloklar.slice(i + 1, son < 0 ? undefined : son);
  // Satırın başındaki kod; "KL-TEK-001…015" gibi aralıklar açılır.
  const eskiKod = new Set(eski.flatMap((x) => {
    const m = /^((?:FR|KL|RP|PR)-[A-Z]{3}-)(\d{3})(?:…(\d{3}))?/.exec(x.m); if (!m) return [];
    const bas = Number(m[2]); const bit = m[3] ? Number(m[3]) : bas;
    return Array.from({ length: Math.max(1, bit - bas + 1) }, (_, j) => `${m[1]}${String(bas + j).padStart(3, '0')}`);
  }));
  const satir = (x: Kalem) => {
    const r = [rolGecer(x.dolduran, rol) && 'doldurur', rolGecer(x.onaylayan, rol) && 'onaylar'].filter(Boolean).join(', ');
    return { t: 'm' as const, m: `${x.kod} ${x.ad}${r ? ` (${r})` : ''}${x.durum === 'Taslak' ? ' · taslak, henüz kullanımda değil' : ''}` };
  };
  const liste = k.filter((x) => x.durum !== 'İptal' && (eskiKod.has(x.kod) || ONAYLI[rol]?.includes(x.kod) || rolGecer(x.dolduran, rol) || rolGecer(x.onaylayan, rol))).map(satir);
  // Kodsuz satırlar (TPL, BLD vb.) olduğu gibi kalır.
  const kodsuz = eski.filter((x) => !/^(FR|KL|RP|PR)-[A-Z]{3}-\d{3}/.test(x.m));
  const bolum: Blok[] = [{ t: 'b', m: 'Kullandığı formlar ve kayıtlar' }, ...liste, ...kodsuz];
  if (i < 0) return liste.length ? [...bloklar, ...bolum] : bloklar;
  return [...bloklar.slice(0, i), ...bolum, ...(son < 0 ? [] : bloklar.slice(son))];
}

export type Alan = { varlik: string; alan: string; teknik: string; aciklama: string; tip: string; bicim: string; zorunlu: string; liste: string; dogrulama: string; sahip: string; ekran: string };
let sozluk: Alan[] | undefined;
const norm = (s: string) => s.replace(/\(.*?\)/g, ' ').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
/** Adı sözlük varlığıyla birebir örtüşmeyen araçların varlığı. */
const VARLIK: Record<string, string> = {
  'FR-OPS-009': 'Talep (Hasar İhbarı)', 'FR-OPS-007': 'Onay Kararı', 'FR-OPS-011': 'Dosya Askı, İptal, Fesih ve Devir Tutanağı', 'FR-OPS-012': 'Kaldırma ve Taşıma Kontrolü',
  'FR-ONR-005': 'Kompozit Laminasyon ve Kür Kaydı', 'FR-KLT-008': 'Uygunsuzluk', 'FR-KLT-016': 'Garanti ve Şikâyet Kaydı', 'FR-RAP-001': 'Kapanış Kontrolü',
  'FR-SCL-002': 'Branş Yetkinliği', 'FR-SCL-004': 'Görevlendirme Uygunluk Kontrolü', 'FR-TIC-004': 'Teminat ve Garanti Kesintisi', 'FR-TIC-011': 'Personel Masraf Fişi',
  'FR-TIC-014': 'Ön Bilgilendirme ve Cayma Kaydı', 'FR-UYG-006': 'Öğrenilen Ders ve Bölüm Kapanışı', 'RP-RAP-001': 'İlerleme Raporu', 'RP-RAP-004': 'Nihai Kapanış Raporu',
  'RP-TIC-001': 'Sigorta Mutabakat Satırı',
  'FR-KLT-010': 'Nihai Teslim ve Doküman Paketi', 'FR-OPS-017': 'YATONET 360 Onay Kaydı', 'FR-TIC-010': 'Müşteri Faturası (Proforma ve Fatura)', 'FR-SCL-001': 'Kuruluş',
  'FR-TIC-012': 'İş Birliği Firması Fiyat Teklifi', 'FR-TIC-002': 'Ticari Onay Kaydı', 'RP-TIC-002': 'Aylık Fatura, Tahsilat ve Firma Ödeme Raporu',
};
/** YG-633: aracın alanları YATONET 360 alan sözlüğünden gelir (varlık adında kod, birebir ad veya eşleme); dolduran ve onaylayan katalogdan. */
export function aracAlanlari(kod: string, ad: string): Alan[] {
  // Ek sözlük: Ek II zorunlu alan tablolarından, sözlükte varlığı olmayan dışa giden belgeler.
  sozluk ??= [...JSON.parse(readFileSync(join(KOK, 'veri/sablon/alan_sozlugu.json'), 'utf-8')), ...JSON.parse(readFileSync(join(KOK, 'veri/sablon/alan_sozlugu_ek.json'), 'utf-8'))] as Alan[];
  const v = kod.startsWith('KL-') ? 'Kontrol Listesi Maddesi' : VARLIK[kod];
  return sozluk.filter((x) => (x.varlik.includes(kod) || (v ? x.varlik === v : norm(x.varlik) === norm(ad))) && !/^Gösterilmez/.test(x.ekran ?? ''));
}

export function formKataloguYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yonetir = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[])`, [k, YONETIR])).rowCount);

  // Katalog: secim=1 yalnız yürürlükteki araçları verir (yeni kayıtta seçim listesi).
  s.get('/form-katalogu', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const q = i.query as { secim?: string; ara?: string };
    const { rows } = await b.db.query(`SELECT kod, ad, sinif, bicim, bolum, dolduran, goren, onaylayan, kanal, dil, dayanak, ek2_notu, sistem_karsiligi, yerine, surum, yururluk_tarihi, durum, iptal_zamani, iptal_gerekcesi
      FROM form_katalogu WHERE ($1::boolean IS NOT TRUE OR durum = 'Yürürlükte') AND ($2::text IS NULL OR kod ILIKE '%' || $2 || '%' OR ad ILIKE '%' || $2 || '%') ORDER BY kod`, [q.secim === '1', q.ara?.trim() || null]);
    return { yonetir: await yonetir(o.kullanici), kalemler: rows };
  });
  s.get('/form-katalogu/:kod/alanlar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string };
    if (o.grup !== 'LGM İç Rolü' || !KOD.test(kod)) return yok(y);
    const k = (await b.db.query(`SELECT kod, ad, dolduran, onaylayan FROM form_katalogu WHERE kod = $1`, [kod])).rows[0]; if (!k) return yok(y);
    return { ...k, alanlar: aracAlanlari(kod, k.ad).map((x) => ({ alan: x.alan, tur: x.tip, bicim: x.bicim, zorunlu: x.zorunlu, liste: x.liste, dogrulama: x.dogrulama, sahip: x.sahip })) };
  });
  // YG-666: boş şablon; kimlik bandı, dosya ve yat kutusu, sözlükten alan kutuları ve onay bölümü aynı tasarım düzeninde.
  s.get('/form-katalogu/:kod/bos.pdf', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string };
    if (o.grup !== 'LGM İç Rolü' || !KOD.test(kod)) return yok(y);
    const k = (await b.db.query(`SELECT kod, ad, surum, durum FROM form_katalogu WHERE kod = $1`, [kod])).rows[0]; if (!k) return yok(y);
    if (k.durum === 'İptal') return y.code(409).send({ hata: 'İptal edilmiş aracın şablonu üretilmez.' });
    const ORTAK = new Set(['kimlik', 'kayit_no', 'dosya', 'sablon_surumu', 'statu', 'hazirlayan', 'onaylayan', 'onay_zamani', 'olusturma_zamani', 'olusturan', 'guncelleme_zamani']);
    const al = aracAlanlari(kod, k.ad).filter((x) => !ORTAK.has(x.teknik) && x.tip !== 'Sistem kimliği');
    if (!al.length) return y.code(409).send({ hata: 'Alan sözlüğünde bu araca bağlı alan yok.' });
    const BOS = ' ';
    const bolumler: Bolum[] = [
      { baslik: 'Dosya ve Yat', tur: 'alanlar', alanlar: [{ et: 'Dosya No', deger: BOS }, { et: 'Yat Adı', deger: BOS }, { et: 'Kayıt No', deger: BOS }] },
      { baslik: k.ad, tur: 'alanlar', alanlar: al.map((x) => ({ et: `${x.alan}${x.zorunlu === 'Zorunlu' ? ' *' : ''}`, deger: BOS, genis: x.tip === 'Uzun metin' })) },
      { baslik: 'Onay', tur: 'alanlar', numarasiz: true, alanlar: [{ et: 'Hazırlayan', deger: BOS }, { et: 'Kontrol Eden / Onaylayan', deger: BOS }, { et: 'Tarih', deger: BOS }] },
    ];
    const { pdfUret } = await import('./pdf.js');
    return y.type('application/pdf').header('Content-Disposition', `inline; filename="${kod}_R${k.surum}_bos.pdf"`).send(await pdfUret({ ad: k.ad, kod, no: `${kod} R${k.surum}`, tarih: gunAy(new Date()), surum: `R${k.surum}`, dil: 'tr', bolumler }));
  });
  // Yeni araç Taslak doğar; kod tekildir ve iptal edilmiş kod yeniden verilemez (birincil anahtar, silme yasağı).
  s.post('/form-katalogu', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await yonetir(o.kullanici))) return yok(y);
    const g = (i.body ?? {}) as Record<string, string | undefined>;
    if (!g.kod || !KOD.test(g.kod)) return y.code(400).send({ hata: 'Kod FR-, KL-, RP- veya PR- ile başlamalı, üç harfli bölüm ve üç haneli numara taşımalıdır (ör. FR-OPS-020).' });
    if (!g.ad?.trim() || !g.sinif || !g.bicim?.trim()) return y.code(400).send({ hata: 'Ad, sınıf ve biçim zorunludur.' });
    const var_ = (await b.db.query(`SELECT durum FROM form_katalogu WHERE kod = $1`, [g.kod])).rows[0];
    if (var_) return y.code(409).send({ hata: var_.durum === 'İptal' ? 'Bu kod iptal edilmiştir ve yeniden verilemez.' : 'Bu kod kullanımdadır.' });
    await b.db.query(`INSERT INTO form_katalogu (kod, ad, sinif, bicim, dolduran, goren, onaylayan, kanal, dil, dayanak, durum, guncelleyen_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Taslak',$11)`,
      [g.kod, g.ad.trim(), g.sinif, g.bicim.trim(), g.dolduran?.trim() || null, g.goren?.trim() || null, g.onaylayan?.trim() || null, g.kanal?.trim() || null, g.dil?.trim() || null, g.dayanak?.trim() || null, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Form Kataloğu Kalemi Eklendi', nesneTuru: 'Form Kataloğu', nesneKimligi: g.kod, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/form-katalogu/:kod/durum', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string }; const g = (i.body ?? {}) as { durum?: string; gerekce?: string; yerine?: string };
    if (!KOD.test(kod) || !(await yonetir(o.kullanici))) return yok(y);
    const k = (await b.db.query(`SELECT durum, surum FROM form_katalogu WHERE kod = $1`, [kod])).rows[0]; if (!k) return yok(y);
    if (k.durum === 'İptal') return y.code(409).send({ hata: 'İptal edilmiş araç yeniden yürürlüğe alınamaz; yeni kodla açılır.' });
    if (g.durum === 'Yürürlükte') {
      if (k.durum !== 'Taslak') return y.code(409).send({ hata: 'Yalnız taslak araç yürürlüğe alınır; içerik değişikliği yeni sürümle yapılır.' });
      await b.db.query(`UPDATE form_katalogu SET durum = 'Yürürlükte', yururluk_tarihi = current_date, guncelleyen_ref = $2, zaman = now() WHERE kod = $1`, [kod, o.kullanici]);
    } else if (g.durum === 'Yeni Sürüm') {
      if (k.durum !== 'Yürürlükte') return y.code(409).send({ hata: 'Yeni sürüm yalnız yürürlükteki araç için açılır.' });
      if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Sürüm gerekçesi zorunludur.' });
      // Doldurulmuş kayıtlar geriye dönük yeniden yazılmaz; yeni sürüm taslak olarak açılır ve onayla yürürlüğe girer (Ek II).
      await b.db.query(`UPDATE form_katalogu SET durum = 'Taslak', surum = surum + 1, yururluk_tarihi = NULL, guncelleyen_ref = $2, zaman = now() WHERE kod = $1`, [kod, o.kullanici]);
    } else if (g.durum === 'İptal') {
      if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'İptal gerekçesi zorunludur.' });
      if (g.yerine && !KOD.test(g.yerine)) return y.code(400).send({ hata: 'Yerine geçen kod geçersizdir.' });
      await b.db.query(`UPDATE form_katalogu SET durum = 'İptal', iptal_zamani = now(), iptal_gerekcesi = $2, yerine = coalesce($3, yerine), guncelleyen_ref = $4, zaman = now() WHERE kod = $1`, [kod, g.gerekce.trim(), g.yerine ?? null, o.kullanici]);
    } else return y.code(400).send({ hata: 'Durum Yürürlükte, Yeni Sürüm veya İptal olmalıdır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Form Kataloğu ${g.durum}`, nesneTuru: 'Form Kataloğu', nesneKimligi: kod, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
