import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const TUR = 'Yediemin Onayı';
kapanisKaydet(TUR, async (c, k, karar) => {
  if (karar !== 'Onayla' && karar !== 'Reddet') return;
  await c.query(`UPDATE yediemin_talebi SET durum = $2, karar_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Onay Bekliyor'`, [k.nesne_kimligi, karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi']);
});

/** YG-104: LGM veya Çözüm Ortağı yalnız Hukuk ve Uyum Direktörü onayıyla yediemin olur; dosyada aynı anda tek bekleyen talep. */
export async function yedieminMi(db: import("pg").Pool | import("pg").PoolClient, dosya: string): Promise<{ yediemin: string; kurulus: string | null } | null> {
  const r = (await db.query(`SELECT yediemin, kurulus_ref FROM yediemin_talebi WHERE dosya_ref = $1 AND durum = 'Onaylandı' ORDER BY karar_zamani DESC LIMIT 1`, [dosya])).rows[0];
  return r ? { yediemin: r.yediemin, kurulus: r.kurulus_ref } : null;
}

export function yedieminYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/dosya/:id/yediemin', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || i.oturum!.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return {
      talepler: (await b.db.query(`SELECT t.kimlik, t.yediemin, k.ticari_unvan, t.dayanak, t.durum, t.olusturma_zamani, t.karar_zamani FROM yediemin_talebi t LEFT JOIN kurulus k ON k.kimlik = t.kurulus_ref WHERE t.dosya_ref = $1 ORDER BY t.olusturma_zamani DESC`, [id])).rows,
      firmalar: (await b.db.query(`SELECT DISTINCT k.kimlik, k.ticari_unvan FROM is_emri e JOIN kurulus k ON k.kimlik = e.kurulus_ref WHERE e.dosya_ref = $1 AND k.kayit_rolu = 'Çözüm Ortağı' ORDER BY k.ticari_unvan`, [id])).rows,
    };
  });
  s.post('/dosya/:id/yediemin', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { yediemin?: string; kurulus?: string; dayanak?: string; belge?: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!['LGM', 'Çözüm Ortağı'].includes(g.yediemin ?? '') || !g.dayanak?.trim()) return y.code(400).send({ hata: 'Yedieminin kim olacağını ve dayanağını (mahkeme veya icra kararı) yazınız.' });
    if (g.yediemin === 'Çözüm Ortağı' && !(g.kurulus && UUID.test(g.kurulus) && (await b.db.query(`SELECT 1 FROM kurulus WHERE kimlik = $1 AND kayit_rolu = 'Çözüm Ortağı'`, [g.kurulus])).rowCount)) return y.code(400).send({ hata: 'Yediemin olacak Çözüm Ortağını seçiniz.' });
    if (g.belge && !(UUID.test(g.belge) && (await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2`, [g.belge, id])).rowCount)) return y.code(400).send({ hata: 'Belge bu dosyaya yüklenmiş olmalıdır.' });
    if ((await b.db.query(`SELECT 1 FROM yediemin_talebi WHERE dosya_ref = $1 AND durum = 'Onay Bekliyor'`, [id])).rowCount) return y.code(409).send({ hata: 'Bu dosyada karar bekleyen yediemin talebi vardır.' });
    const d = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    const r = (await b.db.query(`INSERT INTO yediemin_talebi (dosya_ref, yediemin, kurulus_ref, dayanak, belge_ref, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, g.yediemin, g.yediemin === 'Çözüm Ortağı' ? g.kurulus : null, g.dayanak.trim(), g.belge || null, o.kullanici])).rows[0];
    await kartAc(b.db, { tur: TUR, baslik: `${d.dosya_no} · Yediemin Onayı · ${g.yediemin}`, ozet: g.dayanak.trim().slice(0, 300), oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Hukuk ve Uyum Direktörü')], nesneTuru: 'Yediemin Talebi', nesneKimligi: r.kimlik });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yediemin Talebi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { yediemin: g.yediemin }, gerekce: g.dayanak.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });
}
