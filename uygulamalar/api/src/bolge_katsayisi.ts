import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;
const TID = 'Ticari İşler Direktörü'; const TUR = 'Bölge Katsayısı Değişikliği';

/** YG-856, KS-11: dosyanın bölgesinin katsayısı (bölgesi bulunamayan dosyada 1,00); kartela birim fiyatı bu katsayıyla çarpılır, belgelere yazılmaz (K-104). */
export async function bolgeKatsayisi(db: Db, dosya: string): Promise<number> {
  const bolge = await (await import('./firma.js')).dosyaBolgesi(db, dosya);
  if (!bolge) return 1;
  return Number((await db.query(`SELECT katsayi FROM bolge_katsayisi WHERE bolge = $1`, [bolge])).rows[0]?.katsayi ?? 1);
}

kapanisKaydet(TUR, async (c, k, karar) => {
  if (karar !== 'Onayla' && karar !== 'Reddet') return;
  const t = (await c.query(`UPDATE bolge_katsayisi_talebi SET durum = $2, karar_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Onay Bekliyor' RETURNING bolge, yeni_katsayi`, [k.nesne_kimligi, karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi'])).rows[0];
  if (t && karar === 'Onayla') await c.query(`UPDATE bolge_katsayisi SET katsayi = $2, guncelleme_zamani = now() WHERE bolge = $1`, [t.bolge, t.yeni_katsayi]);
});

export function bolgeKatsayisiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  s.get('/bolge-katsayisi', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [TID, 'Genel Müdür Yardımcısı', 'CEO']))) return yok(y);
    return {
      bolgeler: (await b.db.query(`SELECT bolge, katsayi, guncelleme_zamani FROM bolge_katsayisi ORDER BY bolge`)).rows,
      talepler: (await b.db.query(`SELECT t.kimlik, t.bolge, t.yeni_katsayi, t.gerekce, t.durum, t.olusturma_zamani FROM bolge_katsayisi_talebi t ORDER BY t.olusturma_zamani DESC LIMIT 20`)).rows,
      hazirlar: await rolVar(i.oturum!.kullanici, [TID]),
    };
  });
  s.post('/bolge-katsayisi/talep', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, [TID]))) return y.code(403).send({ hata: 'Bölge katsayısı değişikliğini Ticari İşler Direktörü hazırlar.' });
    const g = (i.body ?? {}) as { bolge?: string; katsayi?: number | string; gerekce?: string };
    const kat = Number(String(g.katsayi ?? '').replace(',', '.'));
    if (!Number.isFinite(kat) || kat <= 0 || kat >= 100 || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Yeni katsayıyı ve gerekçeyi giriniz.' });
    const m = (await b.db.query(`SELECT katsayi FROM bolge_katsayisi WHERE bolge = $1`, [g.bolge ?? ''])).rows[0]; if (!m) return y.code(400).send({ hata: 'Bölge bulunamadı.' });
    if (Number(m.katsayi) === Math.round(kat * 100) / 100) return y.code(409).send({ hata: 'Yeni katsayı mevcut katsayıyla aynıdır.' });
    if ((await b.db.query(`SELECT 1 FROM bolge_katsayisi_talebi WHERE bolge = $1 AND durum = 'Onay Bekliyor'`, [g.bolge])).rowCount) return y.code(409).send({ hata: 'Bu bölge için bekleyen talep vardır.' });
    const t = (await b.db.query(`INSERT INTO bolge_katsayisi_talebi (bolge, yeni_katsayi, gerekce, hazirlayan_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [g.bolge, kat, g.gerekce.trim(), o.kullanici])).rows[0];
    const yaz = (x: number) => x.toFixed(2).replace('.', ',');
    await kartAc(b.db, { tur: TUR, baslik: `${g.bolge} · Katsayı ${yaz(Number(m.katsayi))} → ${yaz(kat)}`, ozet: g.gerekce.trim().slice(0, 300), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Genel Müdür Yardımcısı'), await rolId(b.db, 'CEO')], nesneTuru: 'Bölge Katsayısı Talebi', nesneKimligi: t.kimlik });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bölge Katsayısı Talebi', nesneTuru: 'Bölge', nesneKimligi: g.bolge!, eski: { katsayi: Number(m.katsayi) }, yeni: { katsayi: kat }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: t.kimlik };
  });
}
