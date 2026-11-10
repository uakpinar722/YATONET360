import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

/**
 * YG-860: işçilik normu (birim başına saat) ve fire oranı kartela ana verisinde, taslak sürümde tutulur; yalnız kartela yetkilisi ve maliyet görebilen
 * iç roller görür. Normlar hiçbir belgeye yazılmaz (teklif, rapor ve iş emri tanımları bu alanları okumaz).
 */
export function kartelaNormYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const taslak = async () => (await b.db.query(`SELECT surum FROM kartela_surumu WHERE durum = 'Taslak' ORDER BY surum DESC LIMIT 1`)).rows[0]?.surum as string | undefined;

  s.get('/kartela/norm', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, ['Ticari İşler Direktörü', 'CEO', 'Teknik Müdür', 'Teknik ve Operasyon Direktörü']))) return yok(y);
    const q = String((i.query as { q?: string }).q ?? '').trim(); const sur = (await taslak()) ?? (await b.db.query(`SELECT surum FROM kartela_surumu WHERE durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`)).rows[0]?.surum;
    return { surum: sur, taslak: Boolean(await taslak()), kalemler: (await b.db.query(`SELECT kod, islem, birim, iscilik_normu_saat, fire_orani FROM kartela_kalemi WHERE surum = $1 AND ($2 = '' OR kod ILIKE $2 || '%' OR tr_norm(islem) LIKE '%' || tr_norm($2) || '%') ORDER BY kod LIMIT 50`, [sur, q])).rows };
  });
  s.post('/kartela/taslak/norm', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, ['Ticari İşler Direktörü', 'CEO']))) return yok(y);
    const g = (i.body ?? {}) as { kod?: string; norm?: number | null; fire?: number | null; kaynak?: string };
    const sur = await taslak(); if (!sur) return y.code(409).send({ hata: 'Önce taslak sürüm açınız.' });
    const norm = g.norm === null || g.norm === undefined ? null : Number(g.norm); const fire = g.fire === null || g.fire === undefined ? null : Number(g.fire);
    if (!g.kod || (norm !== null && !(norm > 0)) || (fire !== null && !(fire >= 0 && fire < 100)) || (norm === null && fire === null) || !g.kaynak?.trim()) return y.code(400).send({ hata: 'Pozitif işçilik normu veya 0–100 arası fire oranı ile kaynak giriniz.' });
    const r = await b.db.query(`UPDATE kartela_kalemi SET iscilik_normu_saat = coalesce($3, iscilik_normu_saat), fire_orani = coalesce($4, fire_orani), norm_kaynagi = $5 WHERE kod = $1 AND surum = $2 RETURNING kod`, [g.kod, sur, norm, fire, g.kaynak.trim()]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Kalem taslak sürümde bulunamadı.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kartela Normu', nesneTuru: 'Kartela', nesneKimligi: `${g.kod}@${sur}`, yeni: { norm, fire, kaynak: g.kaynak.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
