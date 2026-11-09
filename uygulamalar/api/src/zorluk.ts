import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const OLCUTLER = ['oncelik', 'brans', 'kabulSinifi', 'tutarBandi', 'erisim', 'gizliHasar'] as const;

/** YG-964, YG-965: zorluk katsayısını Teknik Müdür ölçütlerle girer; gerekçeyle yalnız bir kez revize edilir. */
export function zorlukYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const tm = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = 'Teknik Müdür' LIMIT 1`, [k])).rowCount);

  s.get('/dosya/:id/zorluk', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await tm(i.oturum!.kullanici))) return yok(y);
    const d = (await b.db.query(`SELECT zorluk_katsayisi, zorluk_revize_edildi FROM dosya WHERE kimlik = $1`, [id])).rows[0]; if (!d) return yok(y);
    const n = (await b.db.query(`SELECT count(*)::int n FROM dosya_zorluk_kaydi WHERE dosya_ref = $1`, [id])).rows[0].n as number;
    return { katsayi: d.zorluk_katsayisi, revize: d.zorluk_revize_edildi, girildi: n > 0 };
  });

  s.post('/dosya/:id/zorluk', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { katsayi?: unknown; olcutler?: Record<string, string>; gerekce?: string }; const k = Number(g.katsayi);
    if (!UUID.test(id) || !(await tm(o.kullanici))) return yok(y);
    if (!(k >= 0.8 && k <= 2) || OLCUTLER.some((x) => !g.olcutler?.[x]?.trim())) return y.code(400).send({ hata: '0,8–2,0 arası katsayı ve tüm ölçütler zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`SELECT zorluk_revize_edildi r FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      if (!d) { await c.query('ROLLBACK'); return yok(y); }
      const onceki = Number((await c.query(`SELECT count(*) n FROM dosya_zorluk_kaydi WHERE dosya_ref = $1`, [id])).rows[0].n);
      if (onceki && d.r) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Zorluk katsayısı yalnız bir kez revize edilebilir.' }); }
      if (onceki && !g.gerekce?.trim()) { await c.query('ROLLBACK'); return y.code(400).send({ hata: 'Revize için gerekçe zorunludur.' }); }
      await c.query(`INSERT INTO dosya_zorluk_kaydi (dosya_ref, katsayi, olcutler, gerekce, giren_ref) VALUES ($1,$2,$3,$4,$5)`, [id, k, JSON.stringify(g.olcutler), g.gerekce?.trim() || null, o.kullanici]);
      await c.query(`UPDATE dosya SET zorluk_katsayisi = $2, zorluk_revize_edildi = $3 WHERE kimlik = $1`, [id, k, onceki > 0]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: onceki ? 'Zorluk Katsayısı Revize' : 'Zorluk Katsayısı', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
