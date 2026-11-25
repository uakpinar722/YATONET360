import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { katalogDurumu } from './ana_veri_ek.js';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const SICIL = ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı'];
const sozcuk = (s: string) => s.toLocaleUpperCase('tr-TR').replace(/[^0-9A-ZÇĞİÖŞÜ ]/g, ' ').split(/\s+/).filter(Boolean);
const ikili = (s: string) => { const t = s.replace(/\s+/g, ''); const l: string[] = []; for (let n = 0; n < t.length - 1; n++) l.push(t.slice(n, n + 2)); return l; };
/** Dice benzerliği (karakter ikilileri, 0–1). */
export function benzerlik(a: string, b: string): number {
  const x = ikili(a); const y = ikili(b); if (!x.length || !y.length) return a === b ? 1 : 0;
  const m = new Map<string, number>(); for (const k of x) m.set(k, (m.get(k) ?? 0) + 1);
  let o = 0; for (const k of y) { const c = m.get(k) ?? 0; if (c) { o++; m.set(k, c - 1); } }
  return Math.round((2 * o / (x.length + y.length)) * 100) / 100;
}

/**
 * YG-1537: ana veri modeline bağlanmamış katalog kayıtları teyit listesine alınır; aday modeller aynı markanın "Katalog kaydı yok" modelleri arasından,
 * katalog adında marka sözcükleri çıkarıldıktan sonraki benzerliğe göre (en çok 3) önerilir. Yeniden yüklemede teyit edilmiş satır değişmez.
 */
export async function adFarkiYukle(db: Db, kayitlar: { seri: number; no: number; ad: string }[]): Promise<{ eklenen: number; bagli: number }> {
  const bagli = new Set((await db.query(`SELECT katalog_seri, katalog_no FROM yat_marka_model WHERE katalog_seri IS NOT NULL`)).rows.map((r) => `${Number(r.katalog_seri)}:${Number(r.katalog_no)}`));
  const yok = (await db.query(`SELECT kimlik, marka, model FROM yat_marka_model WHERE durum = 'Katalog kaydı yok'`)).rows as { kimlik: string; marka: string; model: string }[];
  let eklenen = 0; let b = 0;
  for (const k of kayitlar) {
    if (bagli.has(`${k.seri}:${k.no}`)) { b++; continue; }
    const s = sozcuk(k.ad);
    const adaylar = yok.filter((m) => { const ms = sozcuk(m.marka); return ms.length > 0 && ms.every((w, n) => s[n] === w); })
      .map((m) => { const ms = new Set(sozcuk(m.marka)); return { model: m.kimlik, marka: m.marka, ad: m.model, benzerlik: benzerlik(s.filter((w) => !ms.has(w)).join(' '), sozcuk(m.model).join(' ')) }; })
      .filter((x) => x.benzerlik >= 0.3).sort((p, q) => q.benzerlik - p.benzerlik).slice(0, 3);
    const r = await db.query(`INSERT INTO katalog_ad_farki (katalog_seri, katalog_no, katalog_adi, adaylar) VALUES ($1,$2,$3,$4) ON CONFLICT (katalog_seri, katalog_no) DO UPDATE SET katalog_adi = EXCLUDED.katalog_adi, adaylar = EXCLUDED.adaylar, yukleme_zamani = now() WHERE katalog_ad_farki.sonuc = 'Teyit Bekliyor'`, [k.seri, k.no, k.ad, JSON.stringify(adaylar)]);
    eklenen += r.rowCount ?? 0;
  }
  return { eklenen, bagli: b };
}

export function katalogAdFarkiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const sicil = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, SICIL])).rowCount);
  s.get('/ana-veri/ad-farki', oturumlu, async (i, y) => {
    if (!(await sicil(i.oturum!.kullanici))) return yok(y);
    return (await b.db.query(`SELECT a.katalog_seri, a.katalog_no, a.katalog_adi, a.adaylar, a.sonuc, a.teyit_notu, m.marka, m.model FROM katalog_ad_farki a LEFT JOIN yat_marka_model m ON m.kimlik = a.model_ref ORDER BY a.sonuc <> 'Teyit Bekliyor', a.katalog_seri, a.katalog_no`)).rows;
  });
  // Teyit: aday veya aranıp bulunan model seçilir; katalog seri/no modele bağlanır ve durum fotoğraf/teknik varlığından kendiliğinden hesaplanır.
  s.post('/ana-veri/ad-farki/:seri/:no', oturumlu, async (i, y) => {
    const o = i.oturum!; const p = i.params as { seri: string; no: string }; const g = (i.body ?? {}) as { model?: string; eslesmeYok?: boolean; not?: string };
    if (!(await sicil(o.kullanici))) return yok(y);
    const a = (await b.db.query(`SELECT * FROM katalog_ad_farki WHERE katalog_seri = $1 AND katalog_no = $2`, [Number(p.seri), Number(p.no)])).rows[0]; if (!a) return yok(y);
    if (a.sonuc !== 'Teyit Bekliyor') return y.code(409).send({ hata: 'Bu kayıt teyit edilmiştir.' });
    if (!g.not?.trim()) return y.code(400).send({ hata: 'Teyit notunu yazmanızı rica ederiz.' });
    if (g.eslesmeYok) {
      await b.db.query(`UPDATE katalog_ad_farki SET sonuc = 'Eşleşme Yok', teyit_eden_ref = $3, teyit_zamani = now(), teyit_notu = $4 WHERE katalog_seri = $1 AND katalog_no = $2`, [a.katalog_seri, a.katalog_no, o.kullanici, g.not.trim()]);
      return { sonuc: 'Eşleşme Yok' };
    }
    const m = g.model && UUID.test(g.model) ? (await b.db.query(`SELECT kimlik, fotograf, teknik_veri, katalog_seri FROM yat_marka_model WHERE kimlik = $1`, [g.model])).rows[0] : undefined;
    if (!m) return y.code(400).send({ hata: 'Eşleşen ana veri modelini seçiniz.' });
    if (m.katalog_seri !== null) return y.code(409).send({ hata: 'Seçilen model başka bir katalog kaydına bağlıdır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE yat_marka_model SET katalog_seri = $2, katalog_no = $3, durum = $4, guncelleme_zamani = now() WHERE kimlik = $1`, [m.kimlik, a.katalog_seri, String(a.katalog_no).padStart(5, '0'), katalogDurumu(m.fotograf === 'Var', m.teknik_veri === 'Var')]);
      await c.query(`UPDATE katalog_ad_farki SET sonuc = 'Eşleştirildi', model_ref = $3, teyit_eden_ref = $4, teyit_zamani = now(), teyit_notu = $5 WHERE katalog_seri = $1 AND katalog_no = $2`, [a.katalog_seri, a.katalog_no, m.kimlik, o.kullanici, g.not.trim()]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Katalog Ad Farkı Eşleştirildi', nesneTuru: 'Yat Marka-Model', nesneKimligi: m.kimlik, yeni: { seri: a.katalog_seri, no: a.katalog_no }, gerekce: g.not.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    return { sonuc: 'Eşleştirildi' };
  });
}
