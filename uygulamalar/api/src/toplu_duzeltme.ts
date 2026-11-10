import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const HAZIRLAR = ['Sistem Yöneticisi', 'Bilgi İşlem Müdürü']; const GORUR = [...HAZIRLAR, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'CEO'];
const TUR = 'Toplu Veri Düzeltme Onayı';
const ETKI = ['rapor', 'bildirim', 'onay', 'fatura', 'disSistem'] as const;

kapanisKaydet(TUR, async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE toplu_duzeltme SET durum = 'Onaylandı' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE toplu_duzeltme SET durum = 'Reddedildi' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
});

/**
 * YG-1247: toplu düzeltme kapsam, örnek doğrulama, yedek, betik sürümü ve özeti, onay, beklenen ve gerçekleşen kayıt sayısı ve sonuç kontrolüyle değişiklik kaydına bağlanır.
 * YG-1248: rapor, bildirim, onay, fatura ve dış sistem etkisi uzlaştırılmadan düzeltme işi kapanmaz.
 */
export function topluDuzeltmeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const kayit = async (id: string) => (await b.db.query(`SELECT * FROM toplu_duzeltme WHERE kimlik = $1`, [id])).rows[0];

  s.get('/toplu-duzeltme', oturumlu, async (i, y) => ((await rolVar(i.oturum!.kullanici, GORUR)) ? { hazirlar: await rolVar(i.oturum!.kullanici, HAZIRLAR), kayitlar: (await b.db.query(`SELECT kimlik, kapsam, veri_kumesi, beklenen_kayit, gerceklesen_kayit, durum, betik_surumu, olusturma_zamani FROM toplu_duzeltme ORDER BY olusturma_zamani DESC LIMIT 50`)).rows } : yok(y)));
  s.post('/toplu-duzeltme', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, HAZIRLAR))) return yok(y);
    const g = (i.body ?? {}) as { veriKumesi?: string; kapsam?: string; gerekce?: string; ornek?: string; yedek?: string; betikSurumu?: string; betikOzeti?: string; beklenen?: number };
    if (![g.veriKumesi, g.kapsam, g.gerekce, g.ornek, g.betikSurumu].every((x) => x?.trim()) || !/^[0-9a-f]{64}$/i.test(g.betikOzeti ?? '') || !(Number(g.beklenen) > 0)) return y.code(400).send({ hata: 'Veri kümesi, kapsam, gerekçe, örnek doğrulama, betik sürümü, betik SHA-256 özeti ve beklenen kayıt sayısı zorunludur.' });
    if (!g.yedek || !UUID.test(g.yedek) || !(await b.db.query(`SELECT 1 FROM yedek_kaydi WHERE kimlik = $1 AND durum = 'Başarılı'`, [g.yedek])).rowCount) return y.code(400).send({ hata: 'Düzeltme öncesi başarılı bir yedek seçiniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const k = (await c.query(`INSERT INTO toplu_duzeltme (veri_kumesi, kapsam, gerekce, ornek_dogrulama, yedek_ref, betik_surumu, betik_ozeti, beklenen_kayit, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [g.veriKumesi!.trim(), g.kapsam!.trim(), g.gerekce!.trim(), g.ornek!.trim(), g.yedek, g.betikSurumu!.trim(), g.betikOzeti!.toLowerCase(), Number(g.beklenen), o.kullanici])).rows[0].kimlik as string;
      await kartAc(c, { tur: TUR, baslik: `${TUR}: ${g.veriKumesi!.trim()} (${Number(g.beklenen)} kayıt)`, ozet: `${g.kapsam!.trim()} · ${g.gerekce!.trim()}`.slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü')], nesneTuru: 'Toplu Düzeltme', nesneKimligi: k });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplu Düzeltme Talebi', nesneTuru: 'Toplu Düzeltme', nesneKimligi: k, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: k };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.post('/toplu-duzeltme/:id/uygulandi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gerceklesen?: number; sonucKontrol?: string; farkAciklamasi?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, HAZIRLAR))) return yok(y);
    const k = await kayit(id); if (!k) return yok(y);
    if (k.durum !== 'Onaylandı') return y.code(409).send({ hata: 'Düzeltme onaylanmadan uygulanmış sayılmaz.' });
    if (!(Number(g.gerceklesen) >= 0) || !g.sonucKontrol?.trim()) return y.code(400).send({ hata: 'Gerçekleşen kayıt sayısı ve sonuç kontrolü zorunludur.' });
    if (Number(g.gerceklesen) !== k.beklenen_kayit && !g.farkAciklamasi?.trim()) return y.code(409).send({ hata: 'Gerçekleşen kayıt sayısı beklenenden farklıdır; fark açıklaması yazınız.' });
    await b.db.query(`UPDATE toplu_duzeltme SET durum = 'Uygulandı', gerceklesen_kayit = $2, sonuc_kontrolu = $3, fark_aciklamasi = $4, uygulama_zamani = now() WHERE kimlik = $1`, [id, Number(g.gerceklesen), g.sonucKontrol.trim(), g.farkAciklamasi?.trim() || null]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplu Düzeltme Uygulandı', nesneTuru: 'Toplu Düzeltme', nesneKimligi: id, yeni: { gerceklesen: Number(g.gerceklesen) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/toplu-duzeltme/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { etkiler?: Record<string, string> };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, HAZIRLAR))) return yok(y);
    const k = await kayit(id); if (!k) return yok(y);
    if (k.durum !== 'Uygulandı') return y.code(409).send({ hata: 'Önce uygulama sonucunu kaydediniz.' });
    const e = g.etkiler ?? {}; if (ETKI.some((x) => !['Etkilenmedi', 'Uzlaştırıldı'].includes(e[x] ?? ''))) return y.code(400).send({ hata: 'Rapor, bildirim, onay, fatura ve dış sistem etkisinin her biri için Etkilenmedi veya Uzlaştırıldı seçiniz.' });
    await b.db.query(`UPDATE toplu_duzeltme SET durum = 'Kapandı', etki_uzlastirma = $2, kapanis_zamani = now() WHERE kimlik = $1`, [id, JSON.stringify(Object.fromEntries(ETKI.map((x) => [x, e[x]])))]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplu Düzeltme Kapandı', nesneTuru: 'Toplu Düzeltme', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
