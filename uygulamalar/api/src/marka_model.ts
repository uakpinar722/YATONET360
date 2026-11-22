import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

/** Yat Marka-Model Ana Verisi sütunları (LGM-2026-012; ilk kurulum dosyasıyla aynı). */
export const MARKA_MODEL_SUTUNLARI = ['marka_kodu', 'marka', 'model', 'turkiye_kaynakli', 'katalog_seri', 'katalog_no', 'tekne_turu', 'boy_m', 'govde_malzemesi', 'tahrik_turu', 'fotograf', 'teknik_veri', 'durum'];
const YETKILI = ['Bilgi İşlem Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
const sayi = (s: string | undefined) => { const n = Number((s ?? '').replace(/\./g, '').replace(',', '.')); return s && Number.isFinite(n) && n > 0 && n < 10000 ? n : null; };
const say = (l: string[]) => l.reduce<Record<string, number>>((t, x) => ({ ...t, [x]: (t[x] ?? 0) + 1 }), {});
const esit = (a: Record<string, number>, b: Record<string, number>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * YG-1267, YG-1526: marka-model listesini yeniler. Model (marka + model, büyük/küçük harf duyarsız) varsa güncellenir, yoksa eklenir; markanın kodu
 * dosyadakiyle değiştirilir (markanın listede olmayan modelleri dahil). Sonunda dosyadaki satır, marka ve durum sayıları aktarılan kayıtlarla
 * karşılaştırılır; uyuşmazlıkta aktarım geri alınır. Her deneme aktarım raporu olarak kaydedilir.
 */
export async function markaModelYenile(db: Pool, g: { dosyaAdi: string; metin: string; yapan: string }) {
  const satirlar = g.metin.replace(/\r/g, '').split('\n');
  const baslik = (satirlar.shift() ?? '').split('\t');
  if (MARKA_MODEL_SUTUNLARI.some((s, n) => baslik[n] !== s)) return { hata: `Dosya sütunları ${MARKA_MODEL_SUTUNLARI.join(', ')} sırasında olmalıdır.` };
  const mm = satirlar.filter((l) => l.trim()).map((l) => l.split('\t'));
  const bozuk = mm.findIndex((r) => r.length < 13 || !/^MRK-\d{4,}$/.test(r[0]!) || !r[1]?.trim() || !r[2]?.trim());
  if (!mm.length || bozuk >= 0) return { hata: mm.length ? `${bozuk + 2}. satırda marka kodu (MRK-0001), marka veya model eksik.` : 'Dosyada satır yok.' };
  const anahtar = (r: string[]) => `${r[1]!.trim().toLocaleLowerCase('tr')}\t${r[2]!.trim().toLocaleLowerCase('tr')}`;
  if (new Set(mm.map(anahtar)).size !== mm.length) return { hata: 'Dosyada aynı marka ve model birden fazla satırda geçiyor.' };
  const ozet = createHash('sha256').update(g.metin).digest('hex');
  const dosya = { satir: mm.length, marka: new Set(mm.map((r) => r[1]!.trim().toLocaleLowerCase('tr'))).size, durum: say(mm.map((r) => r[12]!.trim())) };
  const c = await db.connect();
  let rapor: Record<string, unknown> = {};
  try {
    await c.query('BEGIN');
    await c.query(`CREATE TEMP TABLE mm_yeni (marka_kodu text, marka text, model text, turkiye_kaynakli boolean, katalog_seri int, katalog_no text, tekne_turu text, boy_m numeric, govde_malzemesi text, tahrik_turu text, fotograf text, teknik_veri text, durum text) ON COMMIT DROP`);
    await c.query(`INSERT INTO mm_yeni SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[], $5::int[], $6::text[], $7::text[], $8::numeric[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[])`,
      [mm.map((r) => r[0]), mm.map((r) => r[1]!.trim()), mm.map((r) => r[2]!.trim()), mm.map((r) => r[3] === 'Evet'), mm.map((r) => (r[4] && /^\d+$/.test(r[4]) ? Number(r[4]) : null)), mm.map((r) => r[5] || null), mm.map((r) => r[6] || null), mm.map((r) => sayi(r[7])), mm.map((r) => r[8] || null), mm.map((r) => r[9] || null), mm.map((r) => r[10] || null), mm.map((r) => r[11] || null), mm.map((r) => r[12]!.trim())]);
    const kodDegisen = (await c.query(`UPDATE yat_marka_model m SET marka_kodu = y.marka_kodu, guncelleme_zamani = now() FROM (SELECT DISTINCT lower(marka) lm, marka_kodu FROM mm_yeni) y WHERE lower(m.marka) = y.lm AND m.marka_kodu <> y.marka_kodu RETURNING lower(m.marka) lm`)).rows;
    const gun = (await c.query(`UPDATE yat_marka_model m SET marka_kodu = y.marka_kodu, marka = y.marka, model = y.model, turkiye_kaynakli = y.turkiye_kaynakli, katalog_seri = y.katalog_seri, katalog_no = y.katalog_no, tekne_turu = y.tekne_turu,
        boy_m = y.boy_m, govde_malzemesi = y.govde_malzemesi, tahrik_turu = y.tahrik_turu, fotograf = y.fotograf, teknik_veri = y.teknik_veri, durum = y.durum, guncelleme_zamani = now()
      FROM mm_yeni y WHERE lower(m.marka) = lower(y.marka) AND lower(m.model) = lower(y.model)`)).rowCount ?? 0;
    const ekl = (await c.query(`INSERT INTO yat_marka_model (marka_kodu, marka, model, turkiye_kaynakli, katalog_seri, katalog_no, tekne_turu, boy_m, govde_malzemesi, tahrik_turu, fotograf, teknik_veri, durum)
      SELECT y.* FROM mm_yeni y WHERE NOT EXISTS (SELECT 1 FROM yat_marka_model m WHERE lower(m.marka) = lower(y.marka) AND lower(m.model) = lower(y.model))`)).rowCount ?? 0;
    const ak = (await c.query(`SELECT count(*)::int n, count(DISTINCT lower(m.marka))::int marka FROM yat_marka_model m JOIN mm_yeni y ON lower(m.marka) = lower(y.marka) AND lower(m.model) = lower(y.model)`)).rows[0];
    const akDurum = Object.fromEntries((await c.query(`SELECT m.durum, count(*)::int n FROM yat_marka_model m JOIN mm_yeni y ON lower(m.marka) = lower(y.marka) AND lower(m.model) = lower(y.model) GROUP BY 1`)).rows.map((r) => [r.durum, r.n]));
    const disarida = Number((await c.query(`SELECT count(*) n FROM yat_marka_model m WHERE NOT EXISTS (SELECT 1 FROM mm_yeni y WHERE lower(m.marka) = lower(y.marka) AND lower(m.model) = lower(y.model))`)).rows[0].n);
    const uyumlu = ak.n === dosya.satir && ak.marka === dosya.marka && esit(akDurum, dosya.durum);
    rapor = { dosya_satir: dosya.satir, dosya_marka: dosya.marka, dosya_durum: dosya.durum, aktarilan_satir: ak.n, aktarilan_marka: ak.marka, aktarilan_durum: akDurum, eklenen: ekl, guncellenen: gun, kod_degisen_marka: new Set(kodDegisen.map((r) => r.lm)).size, listede_olmayan: disarida, sonuc: uyumlu ? 'Uyumlu' : 'Uyumsuz' };
    if (!uyumlu) await c.query('ROLLBACK'); else await c.query('COMMIT'); // tekillik denetimi COMMIT anında
  } catch (h) {
    await c.query('ROLLBACK').catch(() => {});
    const e = h as { code?: string; message?: string };
    rapor = { dosya_satir: dosya.satir, dosya_marka: dosya.marka, dosya_durum: dosya.durum, aktarilan_satir: 0, aktarilan_marka: 0, aktarilan_durum: {}, eklenen: 0, guncellenen: 0, kod_degisen_marka: 0, listede_olmayan: 0, sonuc: 'Hatalı', hata: e.code === '23505' ? 'Bir marka kodu birden fazla markaya veya bir marka birden fazla koda karşılık geliyor.' : 'Aktarım tamamlanamadı.' };
    if (e.code !== '23505') rapor.hata_teknik = e.message;
  } finally { c.release(); }
  const kimlik = (await db.query(`INSERT INTO marka_model_aktarimi (dosya_adi, ozet_sha256, dosya_satir, dosya_marka, dosya_durum, aktarilan_satir, aktarilan_marka, aktarilan_durum, eklenen, guncellenen, kod_degisen_marka, listede_olmayan, sonuc, hata, yapan_ref)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING kimlik`, [g.dosyaAdi, ozet, rapor.dosya_satir, rapor.dosya_marka, JSON.stringify(rapor.dosya_durum), rapor.aktarilan_satir, rapor.aktarilan_marka, JSON.stringify(rapor.aktarilan_durum), rapor.eklenen, rapor.guncellenen, rapor.kod_degisen_marka, rapor.listede_olmayan, rapor.sonuc, (rapor.hata as string | undefined) ?? null, g.yapan])).rows[0].kimlik as string;
  delete rapor.hata_teknik;
  return { kimlik, ...rapor };
}

export function markaModelYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yetkili = async (k: string) => (await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY ($2)`, [k, YETKILI])).rowCount! > 0;
  s.post('/yat/marka-model/yenile', { ...oturumlu, bodyLimit: 20 * 1024 * 1024 }, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { dosyaAdi?: string; metin?: string };
    if (!(await yetkili(o.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    if (!g.dosyaAdi?.trim() || !g.metin) return y.code(400).send({ hata: 'Liste dosyasını seçiniz.' });
    const r = (await markaModelYenile(b.db, { dosyaAdi: g.dosyaAdi.trim(), metin: g.metin, yapan: o.kullanici })) as Record<string, unknown>;
    if ('hata' in r && !('kimlik' in r)) return y.code(400).send(r);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Marka-Model Listesi Yenilendi', nesneTuru: 'Marka-Model Aktarımı', nesneKimligi: r.kimlik as string, yeni: r, sonuc: r.sonuc === 'Uyumlu' ? 'Başarılı' : 'Başarısız', adres: i.ip, iliski: i.id });
    return r.sonuc === 'Uyumlu' ? r : y.code(409).send({ ...r, hata: r.hata as string | undefined ?? 'Aktarılan kayıt sayıları dosyayla uyuşmadı; aktarım geri alındı.' });
  });
  s.get('/yat/marka-model/aktarimlar', oturumlu, async (i, y) => (await yetkili(i.oturum!.kullanici)) ? (await b.db.query(`SELECT a.kimlik, a.dosya_adi, a.dosya_satir, a.dosya_marka, a.aktarilan_satir, a.aktarilan_marka, a.eklenen, a.guncellenen, a.kod_degisen_marka, a.listede_olmayan, a.sonuc, a.hata, h.ad_soyad yapan, a.zaman FROM marka_model_aktarimi a JOIN kullanici_hesabi h ON h.kimlik = a.yapan_ref ORDER BY a.zaman DESC LIMIT 50`)).rows : y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' }));
}
