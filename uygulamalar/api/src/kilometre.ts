import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** YG-072: baz tarihi açıklamasız geçen kilometre taşı için Dosya Sorumlusuna bir kez görev açılır. */
export async function kilometreIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const bugun = simdi.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  for (const k of (await db.query(`SELECT k.kimlik, k.ad, d.dosya_no, d.dosya_sorumlusu_ref FROM kilometre_tasi k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.gerceklesme_tarihi IS NULL AND k.baz_tarih < $1::date AND k.gecikme_nedeni IS NULL AND d.statu <> 'Kapalı'`, [bugun])).rows) {
    if (!k.dosya_sorumlusu_ref || !(await birKez(db, 'kilometre_gecikme', k.kimlik))) continue;
    await kartAc(db, { tur: 'Kilometre Taşı Gecikmesi', kategori: 'gorev', baslik: `${k.dosya_no} · ${k.ad} · Baz Tarih Aşıldı`, ozet: 'Gecikme nedeni, azaltıcı eylem ve sonraki etkiyi giriniz.', oncelik: 'Yüksek', sahipKullanici: k.dosya_sorumlusu_ref, nesneTuru: 'Kilometre Taşı', nesneKimligi: k.kimlik });
    n++;
  }
  return n;
}

export function kilometreYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const ekipte = async (dosya: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL AND rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu', 'Operasyon Yöneticisi') LIMIT 1`, [dosya, k])).rowCount);

  s.get('/dosya/:id/kilometre', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (i.oturum!.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT kimlik, ad, baz_tarih::text, guncel_tarih::text, gerceklesme_tarihi::text, gecikme_nedeni, azaltici_eylem, sonraki_etki FROM kilometre_tasi WHERE dosya_ref = $1 ORDER BY baz_tarih, olusturma_zamani`, [id])).rows;
  });
  s.post('/dosya/:id/kilometre', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; baz?: string };
    if (!UUID.test(id) || !(await ekipte(id, o.kullanici))) return yok(y);
    if (!g.ad?.trim() || !TARIH.test(g.baz ?? '')) return y.code(400).send({ hata: 'Kilometre taşı adı ve baz tarihi zorunludur.' });
    const r = await b.db.query(`INSERT INTO kilometre_tasi (dosya_ref, ad, baz_tarih, guncel_tarih, giren_ref) VALUES ($1,$2,$3,$3,$4) RETURNING kimlik`, [id, g.ad.trim(), g.baz, o.kullanici]);
    return { kimlik: r.rows[0].kimlik };
  });
  // Baz tarih değişmez; güncel tarih baz tarihi aşarsa üç açıklama zorunludur.
  s.post('/kilometre/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { guncel?: string; gerceklesme?: string; neden?: string; eylem?: string; etki?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT dosya_ref, baz_tarih::text AS baz, guncel_tarih::text AS guncel, gecikme_nedeni FROM kilometre_tasi WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(await ekipte(k.dosya_ref, o.kullanici))) return yok(y);
    if ((g.guncel && !TARIH.test(g.guncel)) || (g.gerceklesme && !TARIH.test(g.gerceklesme))) return y.code(400).send({ hata: 'Tarih geçersizdir.' });
    const baz = k.baz as string; const guncel = g.guncel ?? (k.guncel as string);
    const asim = guncel > baz || (g.gerceklesme ?? '') > baz;
    if (asim && (!g.neden?.trim() || !g.eylem?.trim() || !g.etki?.trim()) && !k.gecikme_nedeni) return y.code(400).send({ hata: 'Baz tarih aşıldığında gecikme nedeni, azaltıcı eylem ve sonraki etki zorunludur.' });
    await b.db.query(`UPDATE kilometre_tasi SET guncel_tarih = $2, gerceklesme_tarihi = coalesce($3, gerceklesme_tarihi), gecikme_nedeni = coalesce($4, gecikme_nedeni), azaltici_eylem = coalesce($5, azaltici_eylem), sonraki_etki = coalesce($6, sonraki_etki) WHERE kimlik = $1`, [id, guncel, g.gerceklesme ?? null, g.neden?.trim() || null, g.eylem?.trim() || null, g.etki?.trim() || null]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kilometre Taşı Güncellendi', nesneTuru: 'Kilometre Taşı', nesneKimligi: id, eski: { guncel: k.guncel }, yeni: { guncel }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
