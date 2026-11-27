import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/** YG-001, YG-004, V-1124: yat ekipmanı tekil kimlikle kaydedilir; bulgu, sökülen parça ve iş emri kalemi ekipmana bağlanır, dosya ekipmana kadar izlenir. */
export async function ekipmanYataAit(db: { query: PoolClient['query'] }, dosya: string, ekipman: string | undefined | null): Promise<boolean> {
  if (!ekipman) return true;
  return UUID.test(ekipman) && Boolean((await db.query(`SELECT 1 FROM yat_ekipmani e JOIN dosya d ON d.yat_ref = e.yat_ref WHERE e.kimlik = $1 AND d.kimlik = $2`, [ekipman, dosya])).rowCount);
}

export function yatEkipmanYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  s.get('/dosya/:id/ekipman', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT e.kimlik, e.ekipman_no, e.sistem, e.ad, e.marka, e.model, e.seri_no, e.konum,
        (SELECT count(*)::int FROM bulgu u WHERE u.ekipman_ref = e.kimlik) bulgu, (SELECT count(*)::int FROM sokulen_parca p WHERE p.ekipman_ref = e.kimlik) parca
      FROM yat_ekipmani e JOIN dosya d ON d.yat_ref = e.yat_ref WHERE d.kimlik = $1 ORDER BY e.ekipman_no`, [id])).rows;
  });

  s.post('/dosya/:id/ekipman', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sistem?: string; ad?: string; marka?: string; model?: string; seriNo?: string; konum?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g.ad?.trim() || !g.sistem?.trim()) return y.code(400).send({ hata: 'Ekipman adı ve bağlı olduğu sistem zorunludur.' });
    const d = (await b.db.query(`SELECT d.yat_ref, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [id])).rows[0];
    if (g.seriNo?.trim() && (await b.db.query(`SELECT 1 FROM yat_ekipmani WHERE yat_ref = $1 AND lower(seri_no) = lower($2)`, [d.yat_ref, g.seriNo.trim()])).rowCount) return y.code(409).send({ hata: 'Bu seri numarasıyla kayıtlı ekipman vardır; mevcut kaydı seçiniz.' });
    const r = (await b.db.query(`INSERT INTO yat_ekipmani (yat_ref, ekipman_no, sistem, ad, marka, model, seri_no, konum, kaydeden_ref)
      VALUES ($1, 'EK-' || lpad(((SELECT count(*) FROM yat_ekipmani WHERE yat_ref = $1) + 1)::text, 3, '0'), $2,$3,$4,$5,$6,$7,$8) RETURNING kimlik, ekipman_no`,
      [d.yat_ref, g.sistem.trim(), g.ad.trim(), g.marka?.trim() || null, g.model?.trim() || null, g.seriNo?.trim() || null, g.konum?.trim() || null, o.kullanici])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yat Ekipmanı Kaydı', nesneTuru: 'Yat', nesneKimligi: d.yat_ref, yeni: { no: r.ekipman_no, ad: g.ad.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik, ekipmanNo: r.ekipman_no };
  });

  // Ekipmanın izi: hangi dosyada hangi bulgu, sökülen parça ve iş emri kalemi.
  s.get('/ekipman/:id/iz', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT e.*, (SELECT array_agg(kimlik) FROM dosya WHERE yat_ref = e.yat_ref) dosyalar FROM yat_ekipmani e WHERE e.kimlik = $1`, [id])).rows[0];
    if (!e || !(await Promise.all(((e.dosyalar ?? []) as string[]).map((d) => dosyaErisimi(b.db, o.kullanici, d)))).some(Boolean)) return yok(y);
    const q = async (sql: string) => (await b.db.query(sql, [id])).rows;
    return {
      ekipman: { kimlik: e.kimlik, ekipmanNo: e.ekipman_no, ad: e.ad, sistem: e.sistem, marka: e.marka, model: e.model, seriNo: e.seri_no },
      bulgular: await q(`SELECT u.bulgu_no, u.aciklama, u.hasar_onem_derecesi, d.dosya_no FROM bulgu u JOIN dosya d ON d.kimlik = u.dosya_ref WHERE u.ekipman_ref = $1 ORDER BY u.olusturma_zamani`),
      parcalar: await q(`SELECT p.parca_adi, p.konum, d.dosya_no FROM sokulen_parca p JOIN dosya d ON d.kimlik = p.dosya_ref WHERE p.ekipman_ref = $1`),
      kalemler: await q(`SELECT e.is_emri_no, k.aciklama FROM is_emri_kalemi k JOIN is_emri e ON e.kimlik = k.is_emri_ref WHERE k.ekipman_ref = $1`),
    };
  });
}
