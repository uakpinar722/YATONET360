import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

/** Gecikme eşiği: son başarılı bitişten bu yana periyodun üç katı geçtiyse iş gecikmiş sayılır. */
const GECIKME_KAT = 3;

/**
 * YG-1316: zamanlanmış iş grubu tekil çalışır; önceki tur bitmeden yeni tur başlamaz, çakışma kaydedilir. Her tur başlangıç, bitiş,
 * süre ve hata bilgisiyle zamanlanmis_is_durumu tablosuna yazılır; bir işin hatası gruptaki diğer işleri durdurmaz.
 */
export function isZamanlayici(db: Pool, hataYaz: (m: string) => void) {
  const calisiyor = new Set<string>();
  const tur = async (ad: string, etki: string, ms: number, isler: () => Promise<unknown>[]) => {
    if (calisiyor.has(ad)) {
      await db.query(`UPDATE zamanlanmis_is_durumu SET cakisma_sayisi = cakisma_sayisi + 1, son_cakisma = now(), guncelleme_zamani = now() WHERE ad = $1`, [ad]).catch(() => {});
      return 'Çakışma' as const;
    }
    calisiyor.add(ad); const bas = Date.now();
    try {
      await db.query(`INSERT INTO zamanlanmis_is_durumu (ad, etki, periyot_sn, son_baslangic) VALUES ($1,$2,$3,now()) ON CONFLICT (ad) DO UPDATE SET etki = EXCLUDED.etki, periyot_sn = EXCLUDED.periyot_sn, son_baslangic = now(), guncelleme_zamani = now()`, [ad, etki, Math.round(ms / 1000)]);
      const hatalar = (await Promise.allSettled(isler())).flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
      hatalar.forEach(hataYaz);
      await db.query(`UPDATE zamanlanmis_is_durumu SET son_bitis = now(), son_sure_ms = $2, son_hata = $3, hata_sayisi = hata_sayisi + $4, guncelleme_zamani = now() WHERE ad = $1`, [ad, Date.now() - bas, hatalar[0] ?? null, hatalar.length ? 1 : 0]);
      return 'Tamamlandı' as const;
    } catch (h) { hataYaz((h as Error).message); return 'Hata' as const; } finally { calisiyor.delete(ad); }
  };
  return {
    tur,
    zamanla: (ad: string, etki: string, ms: number, isler: () => Promise<unknown>[]) => setInterval(() => { void tur(ad, etki, ms, isler); }, ms),
  };
}

/** YG-1316: gecikmiş, takılmış veya çakışan iş için Sistem Yöneticisine saatte en çok bir uyarı; etkilenen çıktılar uyarıda yazılır. */
export async function zamanlanmisIsDenetimi(db: Pool, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(`SELECT ad, etki, periyot_sn, son_baslangic, son_bitis, son_cakisma,
      (son_bitis IS NULL OR son_bitis < $1::timestamptz - make_interval(secs => periyot_sn * $2)) AND son_baslangic < $1::timestamptz - make_interval(secs => periyot_sn * $2) gecikti,
      son_cakisma > $1::timestamptz - interval '1 hour' cakisti
    FROM zamanlanmis_is_durumu`, [simdi, GECIKME_KAT]);
  const saat = simdi.toISOString().slice(0, 13); let n = 0;
  for (const r of rows) {
    if (!r.gecikti && !r.cakisti) continue;
    const neden = r.gecikti ? 'gecikti veya tamamlanamadı' : 'önceki tur bitmeden yeniden tetiklendi (çakışma)';
    if (!(await birKez(db, 'zamanlanmis-is', `${r.ad}:${saat}`))) continue;
    await kartAc(db, { tur: 'Zamanlanmış İş Uyarısı', kategori: 'islem', baslik: `${r.ad} · ${r.gecikti ? 'Gecikme' : 'Çakışma'}`, ozet: `"${r.ad}" zamanlanmış işi ${neden}. Etkilenen çıktılar: ${r.etki}. Bu çıktılar iş yeniden tamamlanana kadar güncel olmayabilir; nedenini incelemenizi rica ederiz.`, oncelik: 'Yüksek', sahipRol: await rolId(db, 'Sistem Yöneticisi'), nesneTuru: 'Zamanlanmış İş', nesneKimligi: r.ad });
    n++;
  }
  return n;
}

export function zamanlayiciYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  s.get('/zamanlanmis-isler', oturumlu, async (i, y) => {
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi IN ('Sistem Yöneticisi', 'Bilgi İşlem Müdürü')`, [i.oturum!.kullanici])).rowCount) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    return (await b.db.query(`SELECT ad, etki, periyot_sn, son_baslangic, son_bitis, son_sure_ms, son_hata, hata_sayisi, cakisma_sayisi, son_cakisma,
        (son_bitis IS NULL OR son_bitis < now() - make_interval(secs => periyot_sn * $1)) AND son_baslangic < now() - make_interval(secs => periyot_sn * $1) gecikti
      FROM zamanlanmis_is_durumu ORDER BY ad`, [GECIKME_KAT])).rows;
  });
}
