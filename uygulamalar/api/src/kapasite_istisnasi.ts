import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc, rolSahipleri } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;
const UUID = /^[0-9a-f-]{36}$/;
const TOD = 'Teknik ve Operasyon Direktörü';
const KART = 'Kapasite İstisnası Kararı';
export const SECENEKLER = ['Ek Kaynak veya Alt Yükleniciyle Kabul', 'Hedef Süre Uzatılarak Kabul', 'Başka Çözüm Ortağına Yönlendirme'] as const;

/** Görevlendirme kontrolünde kapasite engeli (beyan edilen iş, branş veya tesis kapasitesi) metinleri. */
export const kapasiteEngeliMi = (m: string) => /kapasite/i.test(m);

/** Kabul yönünde (a veya b) verilmiş istisna varsa kapasite engeli o dosya ve firma için uyarıya döner. */
export async function kapasiteIstisnasiVar(db: Db, dosya: string, firma: string): Promise<boolean> {
  return Boolean((await db.query(`SELECT 1 FROM kapasite_istisnasi WHERE dosya_ref = $1 AND kurulus_ref = $2 AND secenek IN ($3, $4)`, [dosya, firma, SECENEKLER[0], SECENEKLER[1]])).rowCount);
}

/**
 * YG-1667, YG-1668, TZ-7 (CEO 26.11.2026): firma kapasitesi doluyken Dosya Sorumlusu gerekçeyle istisna ister; Teknik ve Operasyon Direktörü 24 saat içinde
 * üç seçenekten biriyle "Kararı Kaydet" der. Süre uzatmada yeni hedef tarih zorunludur ve yat tarafına bildirim görevi Dosya Sorumlusuna açılır.
 */
export function kapasiteIstisnasiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const tod = async (k: string) => (await rolSahipleri(b.db, await rolId(b.db, TOD))).includes(k);

  s.post('/dosya/:id/kapasite-istisnasi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { firma?: string; gerekce?: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, o.kullanici, id))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    if (!g.firma || !UUID.test(g.firma) || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Firma ve gerekçe zorunludur.' });
    const f = (await b.db.query(`SELECT ticari_unvan FROM kurulus WHERE kimlik = $1 AND kayit_rolu = 'Çözüm Ortağı'`, [g.firma])).rows[0];
    if (!f) return y.code(400).send({ hata: 'Firma bulunamadı.' });
    const d = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    const r = await b.db.query(`INSERT INTO kapasite_istisnasi (dosya_ref, kurulus_ref, gerekce, talep_eden_ref) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING kimlik`, [id, g.firma, g.gerekce.trim(), o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu firma için açık istisna talebi vardır.' });
    const k = r.rows[0].kimlik as string;
    await kartAc(b.db, { tur: KART, kategori: 'gorev', baslik: `${d.dosya_no} · ${f.ticari_unvan} · Kapasite İstisnası`, ozet: g.gerekce.trim().slice(0, 500), oncelik: 'Yüksek', sonZaman: new Date(Date.now() + 24 * 3_600_000), sahipRol: await rolId(b.db, TOD), nesneTuru: 'Kapasite İstisnası', nesneKimligi: k });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kapasite İstisnası Talebi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { firma: g.firma }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: k, gonderilecek: TOD };
  });

  s.get('/kapasite-istisnasi', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    if (!(await tod(i.oturum!.kullanici))) return { yetkili: false, kayitlar: [] };
    const l = (await b.db.query(`SELECT x.kimlik, d.dosya_no, k.ticari_unvan, x.gerekce, x.talep_zamani, k.kapasite_is FROM kapasite_istisnasi x JOIN dosya d ON d.kimlik = x.dosya_ref JOIN kurulus k ON k.kimlik = x.kurulus_ref WHERE x.secenek IS NULL ORDER BY x.talep_zamani`)).rows;
    return { yetkili: true, secenekler: SECENEKLER, kayitlar: l };
  });

  s.post('/kapasite-istisnasi/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { secenek?: string; aciklama?: string; yeniHedef?: string };
    if (!(await tod(o.kullanici))) return y.code(403).send({ hata: 'Kapasite istisnası kararını Teknik ve Operasyon Direktörü verir.' });
    if (!UUID.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    if (!SECENEKLER.includes(g.secenek as (typeof SECENEKLER)[number])) return y.code(400).send({ hata: 'Seçeneklerden birini seçiniz.' });
    if (!g.aciklama?.trim()) return y.code(400).send({ hata: 'Karar açıklaması zorunludur.' });
    if (g.secenek === SECENEKLER[1] && !/^\d{4}-\d{2}-\d{2}$/.test(g.yeniHedef ?? '')) return y.code(400).send({ hata: 'Süre uzatmada yeni hedef tarihi seçiniz.' });
    const r = (await b.db.query(`UPDATE kapasite_istisnasi x SET secenek = $2, karar_aciklamasi = $3, yeni_hedef_tarih = $4, karar_veren_ref = $5, karar_zamani = now() FROM dosya d
      WHERE x.kimlik = $1 AND x.secenek IS NULL AND d.kimlik = x.dosya_ref RETURNING x.talep_eden_ref, x.dosya_ref, d.dosya_no, d.dosya_sorumlusu_ref`, [id, g.secenek, g.aciklama.trim(), g.secenek === SECENEKLER[1] ? g.yeniHedef : null, o.kullanici])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Kayıt bulunamadı veya karar verilmiştir.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum <> 'Tamamlandı'`, [KART, id]);
    await bildir(b.db, { olay: `kapasite-istisna-karar:${id}`, kullanicilar: [r.talep_eden_ref], baslik: `${r.dosya_no} · Kapasite İstisnası: ${g.secenek}`, ozet: g.aciklama.trim() });
    if (g.secenek === SECENEKLER[1] && r.dosya_sorumlusu_ref) await kartAc(b.db, { tur: 'Süre Uzatımı Bildirimi', kategori: 'gorev', baslik: `${r.dosya_no} · Yat Tarafına Süre Uzatımını Bildiriniz`, ozet: `Yeni hedef tarih: ${g.yeniHedef!.split('-').reverse().join('.')}`, oncelik: 'Yüksek', sonZaman: new Date(Date.now() + 24 * 3_600_000), sahipKullanici: r.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: r.dosya_ref });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kapasite İstisnası Kararı', nesneTuru: 'Kapasite İstisnası', nesneKimligi: id, yeni: { secenek: g.secenek, aciklama: g.aciklama.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
