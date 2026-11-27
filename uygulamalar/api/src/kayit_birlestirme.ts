import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const KARSILASTIRILMAZ = new Set(['kimlik', 'olusturma_zamani', 'guncelleme_zamani', 'kayit_surumu', 'birlestirilen_ana_ref', 'olusturan_ref', 'taraf_no']);
type Tur = 'yat' | 'taraf' | 'firma_ekipmani' | 'sozlesme_kaydi' | 'belge';
type J = Record<string, unknown>;
/** V-1112: tür başına veri sahibi rolü, arama koşulu ve etiket. Ekipman yalnız aynı firmanın kayıtlarıyla birleşir. */
const TURLER: Record<Tur, { ad: string; sahip: string; ara: string; sira: string; sql: string; etiket: (j: J) => unknown[] }> = {
  yat: { ad: 'Yat', sahip: 'Operasyon Müdürü', ara: `lower(yat_adi) LIKE '%' || lower($1) || '%' OR lower(govde_no) = lower($1)`, sira: 'yat_adi', sql: 'x.yat_adi', etiket: (j) => [j.yat_adi, j.govde_no, j.bayrak] },
  taraf: { ad: 'Taraf', sahip: 'Operasyon Müdürü', ara: `taraf_no = $1 OR lower(unvan_ad_soyad) LIKE '%' || lower($1) || '%'`, sira: 'unvan_ad_soyad', sql: `concat_ws(' · ', x.taraf_no, x.unvan_ad_soyad)`, etiket: (j) => [j.taraf_no, j.unvan_ad_soyad] },
  firma_ekipmani: { ad: 'Ekipman', sahip: 'Firma Yönetimi Müdürü', ara: `lower(ad) LIKE '%' || lower($1) || '%' OR lower(seri_no) = lower($1)`, sira: 'ad', sql: `concat_ws(' · ', x.ad, x.seri_no)`, etiket: (j) => [j.ad, j.seri_no] },
  sozlesme_kaydi: { ad: 'Sözleşme', sahip: 'Hukuk ve Uyum Direktörü', ara: `sozlesme_no = $1 OR lower(taraf_adi) LIKE '%' || lower($1) || '%' OR lower(sozlesme_turu) LIKE '%' || lower($1) || '%'`, sira: 'olusturma_zamani DESC', sql: `concat_ws(' · ', x.sozlesme_no, x.sozlesme_turu, x.taraf_adi)`, etiket: (j) => [j.sozlesme_no, j.sozlesme_turu, j.taraf_adi, j.yururluk] },
  belge: { ad: 'Belge', sahip: 'Operasyon Müdürü', ara: `lower(ad) LIKE '%' || lower($1) || '%'`, sira: 'ad', sql: `concat_ws(' · ', x.ad, x.belge_turu)`, etiket: (j) => [j.ad, j.belge_turu, j.belge_tarihi] },
};

/**
 * YG-1244: mükerrer yat, taraf, ekipman, sözleşme ve belge kayıtları otomatik silinmez ve birleştirilmez. Türün veri sahibi ana kaydı seçer;
 * çelişen alanlar önceden listelenir, ilişkiler kontrollü taşınır, eski kimlik ana kayda yönlendirilir ve birleştirme geri alınabilir.
 */
export function kayitBirlestirmeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const turlerim = async (k: string) => { const r = new Set((await b.db.query(`SELECT r.rol_adi FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((x) => x.rol_adi as string)); return (Object.keys(TURLER) as Tur[]).filter((t) => r.has(TURLER[t].sahip)); };
  const yetkili = async (k: string, tur?: string) => { const l = await turlerim(k); return tur === undefined ? l.length > 0 : l.includes(tur as Tur); };
  const ret = (y: FastifyReply, tur?: string) => y.code(403).send({ hata: `Kayıt birleştirmeyi ${turMu(tur) ? TURLER[tur].sahip : 'kayıt türünün veri sahibi'} yapar.` });
  const turMu = (t: unknown): t is Tur => typeof t === 'string' && Object.hasOwn(TURLER, t);
  const satir = async (tur: Tur, id: string) => (UUID.test(id) ? (await b.db.query(`SELECT to_jsonb(x) j FROM ${tur} x WHERE kimlik = $1`, [id])).rows[0]?.j as Record<string, unknown> | undefined : undefined);
  const celisen = (a: Record<string, unknown>, e: Record<string, unknown>) => Object.keys(a).filter((k) => !KARSILASTIRILMAZ.has(k) && a[k] !== null && e[k] !== null && e[k] !== undefined && JSON.stringify(a[k]) !== JSON.stringify(e[k])).map((k) => ({ alan: k, ana: a[k], eski: e[k] }));
  const etiket = (tur: Tur, j: J) => TURLER[tur].etiket(j).filter(Boolean).join(' · ');

  s.get('/birlestirme/turler', oturumlu, async (i, y) => (i.oturum!.grup !== 'LGM İç Rolü' ? y.code(404).send({ hata: 'Bulunamadı.' }) : (await turlerim(i.oturum!.kullanici)).map((t) => ({ tur: t, ad: TURLER[t].ad }))));

  s.get('/birlestirme/ara', oturumlu, async (i, y) => {
    const g = i.query as { tur?: string; q?: string };
    if (!(await yetkili(i.oturum!.kullanici, g.tur))) return ret(y, g.tur);
    if (!turMu(g.tur) || (g.q ?? '').trim().length < 2) return [];
    const q = g.q!.trim(); const d = TURLER[g.tur];
    const l = (await b.db.query(`SELECT kimlik, to_jsonb(x) j FROM ${g.tur} x WHERE birlestirilen_ana_ref IS NULL AND (${d.ara}) ORDER BY ${d.sira} LIMIT 20`, [q])).rows;
    return l.map((x) => ({ kimlik: x.kimlik, etiket: etiket(g.tur as Tur, x.j) }));
  });

  // Önizleme: çelişen alanlar ve taşınacak ilişkiler kararı verecek kişiye gösterilir.
  s.get('/birlestirme/onizleme', oturumlu, async (i, y) => {
    const g = i.query as { tur?: string; ana?: string; eski?: string };
    if (!(await yetkili(i.oturum!.kullanici, g.tur))) return ret(y, g.tur);
    if (!turMu(g.tur) || !g.ana || !g.eski || g.ana === g.eski) return y.code(400).send({ hata: 'Ana kaydı ve mükerrer kaydı seçiniz.' });
    const [a, e] = [await satir(g.tur, g.ana), await satir(g.tur, g.eski)];
    if (!a || !e || a.birlestirilen_ana_ref || e.birlestirilen_ana_ref) return y.code(404).send({ hata: 'Kayıt bulunamadı veya daha önce birleştirilmiş.' });
    return { ana: etiket(g.tur, a), eski: etiket(g.tur, e), celisenAlanlar: celisen(a, e) };
  });

  s.post('/birlestirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; ana?: string; eski?: string; gerekce?: string };
    if (!(await yetkili(o.kullanici, g.tur))) return ret(y, g.tur);
    if (!turMu(g.tur) || !g.ana || !g.eski || g.ana === g.eski || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Ana kayıt, mükerrer kayıt ve gerekçe zorunludur.' });
    const tur = g.tur;
    const [a, e] = [await satir(tur, g.ana), await satir(tur, g.eski)];
    if (!a || !e || a.birlestirilen_ana_ref || e.birlestirilen_ana_ref) return y.code(404).send({ hata: 'Kayıt bulunamadı veya daha önce birleştirilmiş.' });
    if (tur === 'firma_ekipmani' && a.kurulus_ref !== e.kurulus_ref) return y.code(409).send({ hata: 'Farklı firmaların ekipmanı birleştirilemez.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const tasinan = (await c.query(`SELECT kayit_birlestir($1, $2, $3) t`, [tur, g.ana, g.eski])).rows[0].t;
      const r = (await c.query(`INSERT INTO kayit_birlestirme (tur, ana_ref, eski_ref, gerekce, celisen_alanlar, tasinan, yapan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [tur, g.ana, g.eski, g.gerekce.trim(), JSON.stringify(celisen(a, e)), JSON.stringify(tasinan), o.kullanici])).rows[0];
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kayıt Birleştirme', nesneTuru: TURLER[tur].ad, nesneKimligi: g.eski, yeni: { ana: g.ana }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, tasinan };
    } catch (x) {
      await c.query('ROLLBACK').catch(() => {});
      const m = String((x as Error).message ?? '');
      if (m.startsWith('Taşınamayan ilişki') || (x as { code?: string }).code === '23505') return y.code(409).send({ hata: `Birleştirme yapılamadı; ilişkiler elle gözden geçirilmelidir (${m}).` });
      throw x;
    } finally { c.release(); }
  });

  s.post('/birlestirme/:id/geri-al', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gerekce?: string };
    if (!(await yetkili(o.kullanici))) return ret(y);
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Geri alma gerekçesi zorunludur.' });
    const k = UUID.test(id) ? (await b.db.query(`SELECT tur, eski_ref FROM kayit_birlestirme WHERE kimlik = $1 AND durum = 'Ana Kayda Bağlandı'`, [id])).rows[0] : undefined;
    if (!k) return y.code(404).send({ hata: 'Geri alınacak birleştirme bulunamadı.' });
    if (!(await yetkili(o.kullanici, k.tur))) return ret(y, k.tur);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT kayit_birlestirme_geri_al($1)`, [id]);
      await c.query(`UPDATE kayit_birlestirme SET durum = 'Geri Alındı', geri_alan_ref = $2, geri_alma_zamani = now() WHERE kimlik = $1`, [id, o.kullanici]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kayıt Birleştirme Geri Alma', nesneTuru: TURLER[k.tur as Tur].ad, nesneKimligi: k.eski_ref, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { durum: 'Geri Alındı' };
    } catch (x) { await c.query('ROLLBACK').catch(() => {}); throw x; } finally { c.release(); }
  });

  s.get('/birlestirme', oturumlu, async (i, y) => {
    const l = await turlerim(i.oturum!.kullanici); if (!l.length) return ret(y);
    const ad = (tablo: Tur, ref: string) => `(SELECT ${TURLER[tablo].sql} FROM ${tablo} x WHERE x.kimlik = k.${ref})`;
    const durum = (ref: string) => `CASE k.tur ${l.map((t) => `WHEN '${t}' THEN ${ad(t, ref)}`).join(' ')} END`;
    return (await b.db.query(`SELECT k.kimlik, k.tur, k.durum, k.gerekce, k.zaman, k.celisen_alanlar, (SELECT sum(jsonb_array_length(x->'kimlikler')) FROM jsonb_array_elements(k.tasinan) x)::int tasinan_sayisi,
      ${durum('ana_ref')} ana, ${durum('eski_ref')} eski
      FROM kayit_birlestirme k WHERE k.tur = ANY($1) ORDER BY k.zaman DESC LIMIT 50`, [l])).rows;
  });

  // Eski kimlik yönlendirmesi: birleştirilmiş kayda gelen istek ana kayda yönlendirilir.
  s.get('/birlestirme/yonlendir/:tur/:id', oturumlu, async (i, y) => {
    const { tur, id } = i.params as { tur: string; id: string };
    if (!turMu(tur) || !UUID.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    const r = (await b.db.query(`SELECT birlestirilen_ana_ref a FROM ${tur} WHERE kimlik = $1`, [id])).rows[0];
    if (!r) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    return { kimlik: r.a ?? id, yonlendirildi: Boolean(r.a) };
  });
}
