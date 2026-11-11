import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;
const YONETIR = ['Teknik ve Operasyon Direktörü', 'Teknik Müdür', 'CEO'];
const SIRA: Record<string, number> = { 'Ana Branş': 0, 'Alt Branş': 1, 'Tali Branş': 2, 'İşlem': 3 };
/** Kartela kalem kodundaki sıra eki atılınca tali branş kodu kalır (KESIF-01.01.03-01 → KESIF-01.01.03). */
export const taliKod = (kartelaKodu: string) => kartelaKodu.replace(/-\d+$/, '');

/** YG-1385: LGM-2026-013 kodlarının ilk aktarımı; mevcut kod değiştirilmez, üst kod önce yazılır. */
export async function katalogAktar(db: Db, satirlar: { kod: string; duzey: string; ad: string; ust_kod: string }[]): Promise<number> {
  let n = 0;
  for (const r of [...satirlar].sort((a, b) => (SIRA[a.duzey] ?? 9) - (SIRA[b.duzey] ?? 9)))
    n += (await db.query(`INSERT INTO brans_kodu (kod, duzey, ad, ust_kod) VALUES ($1,$2,$3,$4) ON CONFLICT (kod) DO NOTHING`, [r.kod, r.duzey, r.ad, r.ust_kod || null])).rowCount ?? 0;
  return n;
}

export function islemKataloguYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  // Kataloğu tüm LGM personeli arar.
  s.get('/islem-katalogu', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    const q = String((i.query as { q?: string }).q ?? '').trim();
    const ozet = (await b.db.query(`SELECT duzey, count(*)::int n FROM brans_kodu WHERE durum = 'Yürürlükte' GROUP BY 1`)).rows;
    const kopuk = (await b.db.query(`SELECT k.kod FROM kartela_kalemi k WHERE NOT EXISTS (SELECT 1 FROM brans_kodu c WHERE c.kod = regexp_replace(k.kod, '-[0-9]+$', '') AND c.duzey = 'Tali Branş') GROUP BY k.kod ORDER BY k.kod LIMIT 100`)).rows.map((r) => r.kod as string);
    const sonuc = q.length < 2 ? [] : (await b.db.query(`SELECT kod, duzey, ad, ust_kod, durum FROM brans_kodu WHERE kod ILIKE $1 || '%' OR tr_norm(ad) LIKE '%' || tr_norm($1) || '%' ORDER BY kod LIMIT 100`, [q])).rows;
    return { ozet, kartelaBaglanmayan: kopuk, sonuc };
  });
  // YG-858: kartela kaleminin kapsadığı işlemler, ortak tali branş kodu üzerinden.
  s.get('/kartela/:kod/islemler', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    const { kod } = i.params as { kod: string }; const t = taliKod(kod);
    const tali = (await b.db.query(`SELECT c.kod, c.ad, a.ad alt_ad, n.ad ana_ad FROM brans_kodu c JOIN brans_kodu a ON a.kod = c.ust_kod JOIN brans_kodu n ON n.kod = a.ust_kod WHERE c.kod = $1 AND c.duzey = 'Tali Branş'`, [t])).rows[0];
    if (!tali) return y.code(404).send({ hata: 'Kartela kalemi katalogdaki bir tali branşa bağlanamadı.' });
    return { tali, islemler: (await b.db.query(`SELECT kod, ad, durum FROM brans_kodu WHERE ust_kod = $1 AND duzey = 'İşlem' ORDER BY kod`, [t])).rows };
  });
  // Yeni kod: biçim ve üst kod veritabanı kısıtıyla doğrulanır; kaldırılmış kodun numarası yeniden verilemez (kod birincil anahtardır).
  s.post('/brans-kodu', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[])`, [o.kullanici, YONETIR])).rowCount) return yok(y);
    const g = (i.body ?? {}) as { kod?: string; duzey?: string; ad?: string };
    if (!g.kod?.trim() || !(g.duzey! in SIRA) || !g.ad?.trim()) return y.code(400).send({ hata: 'Kod, düzey ve ad zorunludur.' });
    const kod = g.kod.trim().toLocaleUpperCase('tr');
    const ust = g.duzey === 'Ana Branş' ? null : g.duzey === 'İşlem' ? kod.replace(/-I\d{2}$/, '') : kod.replace(/\.\d{2}$/, '');
    if ((await b.db.query(`SELECT 1 FROM brans_kodu WHERE kod = $1`, [kod])).rowCount) return y.code(409).send({ hata: 'Bu kod kullanılmıştır; yürürlükten kalkmış olsa da yeniden verilemez.' });
    if (ust && !(await b.db.query(`SELECT 1 FROM brans_kodu WHERE kod = $1 AND durum = 'Yürürlükte'`, [ust])).rowCount) return y.code(400).send({ hata: 'Üst kod katalogda yürürlükte değildir.' });
    try { await b.db.query(`INSERT INTO brans_kodu (kod, duzey, ad, ust_kod, kaynak) VALUES ($1,$2,$3,$4,'YATONET 360')`, [kod, g.duzey, g.ad.trim(), ust]); }
    catch { return y.code(400).send({ hata: 'Kod biçimi düzeye uymuyor (ANA-NN / .NN / .NN / -INN).' }); }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Branş Kodu Eklendi', nesneTuru: 'Branş Kodu', nesneKimligi: kod, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kod };
  });
  s.post('/brans-kodu/:kod/kaldir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string }; const g = (i.body ?? {}) as { gerekce?: string };
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[])`, [o.kullanici, YONETIR])).rowCount) return yok(y);
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Kaldırma gerekçesi zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM brans_kodu WHERE ust_kod = $1 AND durum = 'Yürürlükte'`, [kod])).rowCount) return y.code(409).send({ hata: 'Altında yürürlükte kod bulunan kod kaldırılamaz.' });
    const r = await b.db.query(`UPDATE brans_kodu SET durum = 'Yürürlükten Kalktı', kaldirma_gerekcesi = $2, kaldiran_ref = $3 WHERE kod = $1 AND durum = 'Yürürlükte'`, [kod, g.gerekce.trim(), o.kullanici]);
    if (!r.rowCount) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Branş Kodu Yürürlükten Kaldırıldı', nesneTuru: 'Branş Kodu', nesneKimligi: kod, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
