import type { FastifyInstance, FastifyReply } from 'fastify';
import { belgeUret } from './belge_uret.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/** Cilt III §5.5 ilk risk taraması. */
export const RISKLER = ['Can Güvenliği ve Güvenli Erişim', 'Çevre Kirliliği veya Sızıntı', 'Batma, Devrilme, Yangın veya İkincil Hasar', 'Kanıtı Değiştirebilecek İşlem', 'Acil Müdahale İçin Görev, Yetki ve Koruyucu Donanım'];
const CEVAP = ['Hayır', 'Bilinmiyor', 'Kısmen', 'Evet'];
const ALANLAR = ['sonBilgi', 'kaynaklar', 'yeterlilik', 'yeterlilikGerekcesi', 'uzmanliklar', 'sonuc', 'yontem', 'yontemGerekcesi', 'oncelikTeyidi', 'kapsam', 'kronoloji', 'olgular', 'beyanlar', 'etkilenen', 'sonrakiAdim', 'acikKonular'] as const;
const ISTEGE = new Set(['etkilenen', 'yontemGerekcesi']);

/** YG-651: iç rapor; yeni bilgi önceki sürümü değiştirmez, yeni sürüm açılır (Cilt III §5.11). */
export function onDegerlendirmeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  s.get('/dosya/:id/on-degerlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const ds = (await b.db.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [id])).rows[0]?.r === o.kullanici;
    return { riskler: RISKLER, duzenleyebilir: ds, surumler: (await b.db.query(`SELECT surum, veriler, risk, olusturma_zamani FROM on_degerlendirme WHERE dosya_ref = $1 ORDER BY surum DESC`, [id])).rows };
  });

  s.post('/dosya/:id/on-degerlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as Record<string, unknown>; const risk = (g.risk ?? {}) as Record<string, string>;
    if (!UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (!d || d.r !== o.kullanici) return yok(y);
    const eksik = ALANLAR.filter((a) => !ISTEGE.has(a) && !String(g[a] ?? '').trim());
    if (eksik.length || RISKLER.some((r) => !CEVAP.includes(risk[r] ?? ''))) return y.code(400).send({ hata: 'Tüm zorunlu alanları ve risk taramasını doldurunuz.', eksik });
    const veriler = Object.fromEntries(ALANLAR.map((a) => [a, String(g[a] ?? '').trim()]));
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT 1 FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id]);
      const n = Number((await c.query(`SELECT coalesce(max(surum), 0) + 1 n FROM on_degerlendirme WHERE dosya_ref = $1`, [id])).rows[0].n);
      const r = (await c.query(`INSERT INTO on_degerlendirme (dosya_ref, surum, veriler, risk, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, n, JSON.stringify(veriler), JSON.stringify(risk), o.kullanici])).rows[0];
      await belgeUret(c, { tur: 'Ön Değerlendirme Raporu', nesne: r.kimlik, dosya: id });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ön Değerlendirme Raporu', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { surum: n };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
