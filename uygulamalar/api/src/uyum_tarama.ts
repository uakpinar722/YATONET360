import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const HUD = 'Hukuk ve Uyum Direktörü';
const TARAMA = 'Resmî Gazete Taraması'; const GOZDEN = 'Uyum Kuralı Gözden Geçirme'; const MATRIS = 'Uyum Matrisi Gözden Geçirme';

/** ISO hafta anahtarı (YYYY-Www). */
export const haftaAnahtari = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const g = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - g);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${String(Math.ceil(((+t - +y) / 86_400_000 + 1) / 7)).padStart(2, '0')}`;
};

/** YG-807: her hafta Hukuk ve Uyum Direktörüne Resmî Gazete taraması; altı ayda bir (Ocak ve Temmuz) uyum matrisi gözden geçirme görevi. */
export async function uyumTaramaGorevi(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const hud = await rolId(db, HUD);
  const h = haftaAnahtari(simdi);
  if (await birKez(db, 'resmi-gazete', h)) {
    const t = (await db.query(`INSERT INTO resmi_gazete_tarama (donem) VALUES ($1) ON CONFLICT (donem) DO UPDATE SET donem = EXCLUDED.donem RETURNING kimlik`, [h])).rows[0].kimlik as string;
    const cuma = new Date(simdi); cuma.setDate(cuma.getDate() + ((5 - cuma.getDay() + 7) % 7)); cuma.setHours(18, 0, 0, 0);
    await kartAc(db, { tur: TARAMA, kategori: 'gorev', baslik: `${TARAMA} · ${h}`, ozet: 'Haftanın Resmî Gazete yayınlarını tarayınız; değişikliği ilgili uyum kuralına işleyiniz.', sahipRol: hud, sonZaman: cuma, nesneTuru: TARAMA, nesneKimligi: t }); n++;
  }
  if ((simdi.getMonth() === 0 || simdi.getMonth() === 6) && (await birKez(db, 'uyum-matrisi', `${simdi.getFullYear()}-${simdi.getMonth() + 1}`))) {
    await kartAc(db, { tur: MATRIS, kategori: 'gorev', baslik: `${MATRIS} · ${simdi.getMonth() === 0 ? 'Ocak' : 'Temmuz'} ${simdi.getFullYear()}`, ozet: 'Uyum matrisini (MUM satırları) gözden geçiriniz.', sahipRol: hud, sonZaman: new Date(simdi.getFullYear(), simdi.getMonth() + 1, 0, 18), nesneTuru: MATRIS, nesneKimligi: `${simdi.getFullYear()}-${simdi.getMonth() + 1}` }); n++;
  }
  return n;
}

export function uyumTaramaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const hudMu = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2 LIMIT 1`, [k, HUD])).rowCount);

  s.get('/resmi-gazete', oturumlu, async (i, y) => {
    if (!(await hudMu(i.oturum!.kullanici))) return yok(y);
    return {
      taramalar: (await b.db.query(`SELECT kimlik, donem, sonuc, aciklama, mum_listesi, tarama_zamani FROM resmi_gazete_tarama ORDER BY donem DESC LIMIT 26`)).rows,
      kurallar: (await b.db.query(`SELECT mum_no, mevzuat, madde, yukumluluk FROM uyum_kurali ORDER BY mum_no`)).rows,
    };
  });
  // Değişiklik işlenen her kural için bağlı belge, kayıt ve doğrulama adımları "gözden geçirilecekler" olarak kuralın sorumlusuna görev olur.
  s.post('/resmi-gazete/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; aciklama?: string; mumlar?: string[] };
    if (!UUID.test(id) || !(await hudMu(o.kullanici))) return yok(y);
    const t = (await b.db.query(`SELECT donem, sonuc FROM resmi_gazete_tarama WHERE kimlik = $1`, [id])).rows[0]; if (!t) return yok(y);
    if (t.sonuc) return y.code(409).send({ hata: 'Bu dönemin taraması kaydedilmiştir.' });
    const mumlar = (Array.isArray(g.mumlar) ? g.mumlar : []).map(String);
    if (g.sonuc !== 'Değişiklik Yok' && g.sonuc !== 'Değişiklik Var') return y.code(400).send({ hata: 'Tarama sonucunu seçiniz.' });
    if (g.sonuc === 'Değişiklik Var' && (!mumlar.length || !g.aciklama?.trim())) return y.code(400).send({ hata: 'Değişikliği ve ilgili uyum kurallarını giriniz.' });
    const kurallar = mumlar.length ? (await b.db.query(`SELECT mum_no, yukumluluk, belge, kayit, dogrulama, sorumlu_rol FROM uyum_kurali WHERE mum_no = ANY($1)`, [mumlar])).rows : [];
    if (kurallar.length !== mumlar.length) return y.code(400).send({ hata: 'Uyum kuralı bulunamadı.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE resmi_gazete_tarama SET sonuc = $2, aciklama = $3, mum_listesi = $4, tarayan_ref = $5, tarama_zamani = now() WHERE kimlik = $1`, [id, g.sonuc, g.aciklama?.trim() || null, mumlar, o.kullanici]);
      for (const k of kurallar) {
        const liste = [k.belge && `Belge: ${k.belge}`, k.kayit && `Kayıt: ${k.kayit}`, k.dogrulama && `Doğrulama: ${k.dogrulama}`].filter(Boolean).join(' · ');
        const sahip = k.sorumlu_rol ? (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [k.sorumlu_rol])).rows[0]?.kimlik : null;
        await kartAc(c, { tur: GOZDEN, kategori: 'gorev', baslik: `${k.mum_no} · ${String(k.yukumluluk).slice(0, 80)}`, ozet: `${g.aciklama!.trim().slice(0, 120)}${liste ? ` · Gözden geçirilecekler: ${liste}` : ''}`.slice(0, 400), sahipRol: sahip ?? (await rolId(c, HUD)), sonZaman: new Date(Date.now() + 14 * 86_400_000), nesneTuru: GOZDEN, nesneKimligi: `${id}:${k.mum_no}` });
      }
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [TARAMA, id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: TARAMA, nesneTuru: TARAMA, nesneKimligi: id, yeni: { sonuc: g.sonuc, mumlar }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true, gorev: kurallar.length };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
