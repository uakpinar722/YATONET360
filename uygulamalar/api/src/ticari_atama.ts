import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)'; const YONETICI = 'Muhasebe ve Finans Yöneticisi';
const KART = 'Ticari Sorumlu Ataması';

/** YG-1600: keşif iş emri açılınca dosya Muhasebe ve Finans Yöneticisinin Atama Bekleyenler listesine düşer. */
export async function ticariAtamaAc(c: PoolClient, dosya: string): Promise<void> {
  const d = (await c.query(`SELECT dosya_no, ticari_sorumlu_ref FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  if (!d || d.ticari_sorumlu_ref) return;
  if ((await c.query(`SELECT 1 FROM is_karti WHERE tur = $2 AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [dosya, KART])).rowCount) return;
  await kartAc(c, { tur: KART, kategori: 'gorev', baslik: `${d.dosya_no} · Ticari Sorumlu Ataması`, ozet: 'Keşif iş emri açıldı; Atama Bekleyenler listesinden Ticari Sorumlu seçiniz.', sahipRol: await rolId(c, YONETICI), nesneTuru: 'Dosya', nesneKimligi: dosya });
}

export function ticariAtamaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = $2 LIMIT 1`, [k, r])).rowCount);
  const adaylar = async () => (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND x.rol_adi = $1 ORDER BY h.ad_soyad`, [TICARI])).rows as { kimlik: string; ad_soyad: string }[];

  s.get('/ticari-atama', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, YONETICI))) return yok(y);
    const bekleyenler = (await b.db.query(`SELECT d.kimlik, d.dosya_no, y.yat_adi, k.olusturma_zamani FROM is_karti k JOIN dosya d ON d.kimlik::text = k.nesne_kimligi JOIN yat y ON y.kimlik = d.yat_ref WHERE k.tur = $1 AND k.durum = 'Bekliyor' ORDER BY k.olusturma_zamani`, [KART])).rows;
    return { bekleyenler, adaylar: await adaylar() };
  });

  s.post('/dosya/:id/ticari-sorumlu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kullanici?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, YONETICI))) return yok(y);
    const d = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (!d) return yok(y);
    if (!g.kullanici || !(await rolVar(g.kullanici, TICARI))) return y.code(400).send({ hata: 'Ticari Sorumlu rolündeki bir personeli seçiniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE dosya SET ticari_sorumlu_ref = $2 WHERE kimlik = $1`, [id, g.kullanici]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $2 AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id, KART]);
      await bildir(c, { olay: `ticari-atama:${id}:${g.kullanici}`, kullanicilar: [g.kullanici], baslik: `${d.dosya_no} · Ticari Sorumlu Olarak Atandınız` });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ticari Sorumlu Atandı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { kullanici: g.kullanici }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    return { tamam: true };
  });
}
