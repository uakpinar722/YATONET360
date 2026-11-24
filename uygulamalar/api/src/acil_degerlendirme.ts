import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { saatBul } from './sure.js';

type Db = Pool | PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TU_ROLLER = ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)'];
export const YONTEM = ['Yerinde', 'Uzaktan (Firma Ön Keşfi ve Görüntülü)'];

/** YG-1483: Kritik dosya aktif olunca acil tedbir değerlendirmesi Teknik Uzmana sahaya ulaşma süresi içinde görev olarak açılır. */
export async function acilDegerlendirmeGorevi(c: Db, dosya: string, dosyaNo: string): Promise<boolean> {
  const tu = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = ANY($2) AND bitis_zamani IS NULL LIMIT 1`, [dosya, TU_ROLLER])).rows[0];
  if (!tu || (await c.query(`SELECT 1 FROM is_karti WHERE tur = 'Acil Tedbir Değerlendirmesi' AND nesne_kimligi = $1`, [dosya])).rowCount) return false;
  const saat = (await saatBul(c, 'Sahaya Ulaşma', 'Kritik')) ?? 4;
  await kartAc(c, { tur: 'Acil Tedbir Değerlendirmesi', kategori: 'gorev', baslik: `${dosyaNo} · Acil Tedbir Değerlendirmesi`, ozet: 'Kritik dosya: acil tedbir için değerlendirme sahaya ulaşma süresi içinde yapılır. Bölgede değilseniz firma ön keşfi, yönlendirmeli fotoğraf ve görüntülü değerlendirmeyle yapınız.', oncelik: 'Kritik', sahipKullanici: tu.kullanici_ref, sonZaman: new Date(Date.now() + saat * 3_600_000), nesneTuru: 'Dosya', nesneKimligi: dosya });
  return true;
}

export function acilDegerlendirmeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Dosya bulunamadı veya erişim yetkiniz yok.' });
  s.get('/dosya/:id/acil-degerlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const kayitlar = (await b.db.query(`SELECT a.yontem, a.firma_on_kesif_ozeti, a.gorusme_zamani, a.sonuc, a.acil_tedbir, a.zaman, h.ad_soyad degerlendiren, k.ticari_unvan firma FROM acil_degerlendirme a JOIN kullanici_hesabi h ON h.kimlik = a.degerlendiren_ref LEFT JOIN kurulus k ON k.kimlik = a.firma_ref WHERE a.dosya_ref = $1 ORDER BY a.zaman`, [id])).rows;
    const firmalar = (await b.db.query(`SELECT DISTINCT k.kimlik, k.ticari_unvan FROM is_emri e JOIN kurulus k ON k.kimlik = e.kurulus_ref WHERE e.dosya_ref = $1 ORDER BY k.ticari_unvan`, [id])).rows;
    const fotograf = Number((await b.db.query(`SELECT count(*)::int n FROM gorsel_kanit WHERE dosya_ref = $1`, [id])).rows[0].n);
    return { yontemler: YONTEM, kayitlar, firmalar, fotograf };
  });
  // YG-1483: Teknik Uzman değerlendirmeyi kaydeder; uzaktan yöntemde firma ön keşfi, yönlendirmeli fotoğraf ve görüntülü görüşme zamanı zorunludur ve yerinde keşif Yüksek süreyle görev olur.
  s.post('/dosya/:id/acil-degerlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { yontem?: string; firma?: string; firmaOzeti?: string; gorusmeZamani?: string; sonuc?: string; tedbir?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT dosya_no, oncelik FROM dosya WHERE kimlik = $1`, [id])).rows[0]; if (!d) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = ANY($3) AND bitis_zamani IS NULL`, [id, o.kullanici, TU_ROLLER])).rowCount) return y.code(403).send({ hata: 'Acil tedbir değerlendirmesini dosyanın Teknik Uzmanı kaydeder.' });
    if (d.oncelik !== 'Kritik') return y.code(409).send({ hata: 'Acil tedbir değerlendirmesi Kritik öncelikli dosyada yapılır.' });
    if (!YONTEM.includes(g.yontem ?? '') || !g.sonuc?.trim() || !g.tedbir?.trim()) return y.code(400).send({ hata: 'Yöntem, değerlendirme sonucu ve acil tedbir zorunludur.' });
    const uzak = g.yontem !== 'Yerinde';
    if (uzak) {
      if (!g.firma || !UUID.test(g.firma) || !(await b.db.query(`SELECT 1 FROM kurulus WHERE kimlik = $1 AND kayit_rolu = 'Çözüm Ortağı'`, [g.firma])).rowCount) return y.code(400).send({ hata: 'Ön keşfi yapan firmayı seçiniz.' });
      if (!g.firmaOzeti?.trim()) return y.code(400).send({ hata: 'Firma ön keşif özetini yazınız.' });
      const z = new Date(g.gorusmeZamani ?? ''); if (isNaN(z.getTime()) || z.getTime() > Date.now() + 60_000) return y.code(400).send({ hata: 'Görüntülü değerlendirmenin yapıldığı zamanı giriniz.' });
      if (!(await b.db.query(`SELECT 1 FROM gorsel_kanit WHERE dosya_ref = $1 LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Uzaktan değerlendirme için yönlendirmeli fotoğraf dosyaya yüklenmelidir.' });
    }
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const k = (await c.query(`INSERT INTO acil_degerlendirme (dosya_ref, yontem, firma_ref, firma_on_kesif_ozeti, gorusme_zamani, sonuc, acil_tedbir, degerlendiren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`,
        [id, g.yontem, uzak ? g.firma : null, uzak ? g.firmaOzeti!.trim() : null, uzak ? new Date(g.gorusmeZamani!) : null, g.sonuc.trim(), g.tedbir.trim(), o.kullanici])).rows[0].kimlik as string;
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Acil Tedbir Değerlendirmesi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      if (uzak && !(await c.query(`SELECT 1 FROM is_karti WHERE tur = 'Yerinde Keşif' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id])).rowCount) {
        const saat = (await saatBul(c, 'Keşif', 'Yüksek')) ?? 48;
        await kartAc(c, { tur: 'Yerinde Keşif', kategori: 'gorev', baslik: `${d.dosya_no} · Yerinde Keşif`, ozet: 'Uzaktan acil tedbir değerlendirmesi yapıldı; acil durum giderildikten sonra yerinde keşif Yüksek öncelik süresiyle tamamlanır.', oncelik: 'Yüksek', sahipKullanici: o.kullanici, sonZaman: new Date(Date.now() + saat * 3_600_000), nesneTuru: 'Dosya', nesneKimligi: id });
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Acil Tedbir Değerlendirmesi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { yontem: g.yontem }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: k, yerindeKesif: uzak };
    } catch (x) { await c.query('ROLLBACK').catch(() => {}); throw x; } finally { c.release(); }
  });
}
