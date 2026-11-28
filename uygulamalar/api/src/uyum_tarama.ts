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

/** YG-807 (V-1144): uyum kuralının yapısal bağ türleri. */
export const BAG_TURLERI = ['Şablon Metni', 'Eğitim', 'Sözleşme Türü', 'Belge Türü', 'İş Emri Adımı'] as const;
type Db = Pick<Pool, 'query'>;
/** Kuralın gözden geçirilecekleri: yapısal bağlar (sözleşme türünde yürürlükteki sözleşme sayısıyla) ve kuralın belge/kayıt/doğrulama metinleri. */
export async function gozdenGecirilecekler(db: Db, mum: string, k?: { belge?: string | null; kayit?: string | null; dogrulama?: string | null }) {
  const baglar = (await db.query(`SELECT g.bag_turu, g.bag_kodu, CASE WHEN g.bag_turu = 'Sözleşme Türü' THEN (SELECT count(*)::int FROM sozlesme_kaydi s WHERE lower(s.sozlesme_turu) = lower(g.bag_kodu) AND s.durum = 'Yürürlükte') END yururlukte FROM uyum_kurali_bagi g WHERE g.mum_no = $1 AND g.durum = 'Aktif' ORDER BY array_position($2::text[], g.bag_turu), g.bag_kodu`, [mum, [...BAG_TURLERI]])).rows;
  const l = baglar.map((x) => `${x.bag_turu}: ${x.bag_kodu}${x.yururlukte != null ? ` (${x.yururlukte} yürürlükte sözleşme)` : ''}`);
  if (k) l.push(...[k.belge && `Belge: ${k.belge}`, k.kayit && `Kayıt: ${k.kayit}`, k.dogrulama && `Doğrulama: ${k.dogrulama}`].filter(Boolean) as string[]);
  return l;
}

/** ISO hafta anahtarı (YYYY-Www). */
export const haftaAnahtari = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const g = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - g);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${String(Math.ceil(((+t - +y) / 86_400_000 + 1) / 7)).padStart(2, '0')}`;
};

/** YG-807: her hafta Hukuk ve Uyum Direktörüne Resmî Gazete taraması; altı ayda bir (Ocak ve Temmuz) uyum matrisi gözden geçirme görevi. */
export async function uyumTaramaGorevi(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const hud = await rolId(db, HUD);
  // YG-1695: haftalık tarama Hukuk ve Uyum Uzmanının görevidir; Uzman yoksa Direktöre düşer.
  const uzman = await rolId(db, 'Hukuk ve Uyum Uzmanı'); const taramaSahibi = (await db.query(`SELECT 1 FROM rol_atamasi WHERE rol_ref = $1 AND atama_durumu = 'Aktif' LIMIT 1`, [uzman])).rowCount ? uzman : hud;
  const h = haftaAnahtari(simdi);
  if (await birKez(db, 'resmi-gazete', h)) {
    const t = (await db.query(`INSERT INTO resmi_gazete_tarama (donem) VALUES ($1) ON CONFLICT (donem) DO UPDATE SET donem = EXCLUDED.donem RETURNING kimlik`, [h])).rows[0].kimlik as string;
    const cuma = new Date(simdi); cuma.setDate(cuma.getDate() + ((5 - cuma.getDay() + 7) % 7)); cuma.setHours(18, 0, 0, 0);
    await kartAc(db, { tur: TARAMA, kategori: 'gorev', baslik: `${TARAMA} · ${h}`, ozet: 'Haftanın Resmî Gazete yayınlarını tarayınız; değişikliği ilgili uyum kuralına işleyiniz.', sahipRol: taramaSahibi, sonZaman: cuma, nesneTuru: TARAMA, nesneKimligi: t }); n++;
  }
  if ((simdi.getMonth() === 0 || simdi.getMonth() === 6) && (await birKez(db, 'uyum-matrisi', `${simdi.getFullYear()}-${simdi.getMonth() + 1}`))) {
    await kartAc(db, { tur: MATRIS, kategori: 'gorev', baslik: `${MATRIS} · ${simdi.getMonth() === 0 ? 'Ocak' : 'Temmuz'} ${simdi.getFullYear()}`, ozet: 'Uyum matrisini (MUM satırları) gözden geçiriniz.', sahipRol: hud, sonZaman: new Date(simdi.getFullYear(), simdi.getMonth() + 1, 0, 18), nesneTuru: MATRIS, nesneKimligi: `${simdi.getFullYear()}-${simdi.getMonth() + 1}` }); n++;
  }
  return n;
}

export function uyumTaramaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const hudMu = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, [HUD, 'Hukuk ve Uyum Uzmanı']])).rowCount); // YG-1695: Uzman da taramayı yürütür

  s.get('/resmi-gazete', oturumlu, async (i, y) => {
    if (!(await hudMu(i.oturum!.kullanici))) return yok(y);
    return {
      taramalar: (await b.db.query(`SELECT kimlik, donem, sonuc, aciklama, mum_listesi, tarama_zamani FROM resmi_gazete_tarama ORDER BY donem DESC LIMIT 26`)).rows,
      kurallar: (await b.db.query(`SELECT mum_no, mevzuat, madde, yukumluluk FROM uyum_kurali ORDER BY mum_no`)).rows,
      baglar: (await b.db.query(`SELECT kimlik, mum_no, bag_turu, bag_kodu, aciklama FROM uyum_kurali_bagi WHERE durum = 'Aktif' ORDER BY mum_no, bag_turu, bag_kodu`)).rows,
      bagTurleri: BAG_TURLERI,
    };
  });
  // YG-807: kurala yapısal bağ (şablon metni ve eğitim kayıtlı kayda bağlanır; sözleşme türü, belge türü ve iş emri adımı adıyla).
  s.post('/uyum-kurali/:mum/bag', oturumlu, async (i, y) => {
    const o = i.oturum!; const { mum } = i.params as { mum: string }; const g = (i.body ?? {}) as { tur?: string; kod?: string; aciklama?: string };
    if (!(await hudMu(o.kullanici)) || !(await b.db.query(`SELECT 1 FROM uyum_kurali WHERE mum_no = $1`, [mum])).rowCount) return yok(y);
    const kod = String(g.kod ?? '').trim();
    if (!BAG_TURLERI.includes(g.tur as never)) return y.code(400).send({ hata: 'Bağ türünü seçiniz.' });
    if (!kod || kod.length > 200) return y.code(400).send({ hata: 'Bağlanacak kaydı giriniz.' });
    if (g.tur === 'Şablon Metni' && !(await b.db.query(`SELECT 1 FROM sablon_metni WHERE kod = $1 LIMIT 1`, [kod])).rowCount) return y.code(400).send({ hata: 'Bu kodla şablon metni bulunamadı.' });
    if (g.tur === 'Eğitim' && !(await b.db.query(`SELECT 1 FROM akademi_ders WHERE lower(ad) = lower($1) AND aktif LIMIT 1`, [kod])).rowCount) return y.code(400).send({ hata: 'Bu adla etkin eğitim bulunamadı.' });
    const r = (await b.db.query(`INSERT INTO uyum_kurali_bagi (mum_no, bag_turu, bag_kodu, aciklama, ekleyen_ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING kimlik`, [mum, g.tur, kod, g.aciklama?.trim() || null, o.kullanici])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Bu bağ kuralda zaten kayıtlıdır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Uyum Kuralı Bağı Eklendi', nesneTuru: 'Uyum Kuralı', nesneKimligi: mum, yeni: { tur: g.tur, kod }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });
  s.post('/uyum-kurali-bagi/:id/kaldir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gerekce?: string };
    if (!UUID.test(id) || !(await hudMu(o.kullanici))) return yok(y);
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Kaldırma gerekçesini giriniz.' });
    const r = (await b.db.query(`UPDATE uyum_kurali_bagi SET durum = 'Pasif', kaldiran_ref = $2, kaldirma_zamani = now(), kaldirma_gerekcesi = $3 WHERE kimlik = $1 AND durum = 'Aktif' RETURNING mum_no, bag_turu, bag_kodu`, [id, o.kullanici, g.gerekce.trim()])).rows[0];
    if (!r) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Uyum Kuralı Bağı Kaldırıldı', nesneTuru: 'Uyum Kuralı', nesneKimligi: r.mum_no, eski: { tur: r.bag_turu, kod: r.bag_kodu }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
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
        const liste = (await gozdenGecirilecekler(c, k.mum_no, k)).join(' · ');
        const sahip = k.sorumlu_rol ? (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [k.sorumlu_rol])).rows[0]?.kimlik : null;
        await kartAc(c, { tur: GOZDEN, kategori: 'gorev', baslik: `${k.mum_no} · ${String(k.yukumluluk).slice(0, 80)}`, ozet: `${g.aciklama!.trim().slice(0, 120)}${liste ? ` · Gözden geçirilecekler: ${liste}` : ''}`.slice(0, 1500), sahipRol: sahip ?? (await rolId(c, HUD)), sonZaman: new Date(Date.now() + 14 * 86_400_000), nesneTuru: GOZDEN, nesneKimligi: `${id}:${k.mum_no}` });
      }
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [TARAMA, id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: TARAMA, nesneTuru: TARAMA, nesneKimligi: id, yeni: { sonuc: g.sonuc, mumlar }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true, gorev: kurallar.length };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
