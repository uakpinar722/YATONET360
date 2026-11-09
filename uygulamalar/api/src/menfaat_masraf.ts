import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const HUD = 'Hukuk ve Uyum Direktörü'; const MFY = 'Muhasebe ve Finans Yöneticisi';

/** YG-1622: kâğıt fiş aslı ayda bir teslim edilir; önceki aydan teslim edilmemiş fişi olan personele ayda bir hatırlatma. Ödeme aslı beklemez. */
export async function fisAsliHatirlat(db: Pool, simdi = new Date()): Promise<number> {
  const ay = simdi.toISOString().slice(0, 7); let n = 0;
  for (const p of (await db.query(`SELECT personel_ref, count(*)::int adet FROM personel_masraf_fisi WHERE belge_turu = 'Kağıt Fiş' AND asil_teslim_zamani IS NULL AND to_char(fis_tarihi, 'YYYY-MM') < $1 GROUP BY personel_ref`, [ay])).rows) {
    if (!(await birKez(db, 'fis_asli', `${p.personel_ref}:${ay}`))) continue;
    await bildir(db, { olay: `fis-asli:${p.personel_ref}:${ay}`, kullanicilar: [p.personel_ref], baslik: `Teslim Edilecek Fiş Aslı: ${p.adet}` }); n++;
  }
  return n;
}

export function menfaatMasrafYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = $2 LIMIT 1`, [k, r])).rowCount);

  // YG-412: firma kaptan veya mürettebattan gelen menfaat talebini bildirir; kayıt yalnız Hukuk ve Uyum Direktörüne görünür.
  s.post('/firma-portal/is-emri/:id/menfaat-bildirimi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kaynak?: string; aciklama?: string };
    if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT e.kimlik, e.kurulus_ref, e.dosya_ref, e.is_emri_no FROM is_emri e JOIN kurulus_kullanici x ON x.kurulus_ref = e.kurulus_ref WHERE e.kimlik = $1 AND x.kullanici_ref = $2`, [id, o.kullanici])).rows[0];
    if (!e) return yok(y);
    if (!['Kaptan', 'Mürettebat'].includes(g.kaynak ?? '') || !g.aciklama?.trim()) return y.code(400).send({ hata: 'Talebi yapan ve açıklama zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = (await c.query(`INSERT INTO menfaat_bildirimi (is_emri_ref, dosya_ref, kurulus_ref, kaynak, aciklama, giren_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [e.kimlik, e.dosya_ref, e.kurulus_ref, g.kaynak, g.aciklama.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Menfaat Bildirimi', kategori: 'gorev', baslik: `${e.is_emri_no} · Menfaat Bildirimi`, ozet: `Kaynak: ${g.kaynak}`, oncelik: 'Yüksek', sahipRol: await rolId(c, HUD), nesneTuru: 'Menfaat Bildirimi', nesneKimligi: r.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Menfaat Bildirimi', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  s.get('/menfaat-bildirimleri', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, HUD))) return yok(y);
    return (await b.db.query(`SELECT m.kimlik, m.kaynak, m.aciklama, m.olusturma_zamani, e.is_emri_no, k.ticari_unvan FROM menfaat_bildirimi m JOIN is_emri e ON e.kimlik = m.is_emri_ref JOIN kurulus k ON k.kimlik = m.kurulus_ref ORDER BY m.olusturma_zamani DESC LIMIT 200`)).rows;
  });

  // YG-1622: Muhasebe ve Finans Yöneticisi kâğıt fişin aslını teslim aldığını kaydeder.
  s.get('/masraf/asil-bekleyen', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, MFY))) return yok(y);
    return (await b.db.query(`SELECT f.kimlik, f.masraf_turu, f.fis_tarihi::text, f.belge_ozeti, h.ad_soyad FROM personel_masraf_fisi f JOIN kullanici_hesabi h ON h.kimlik = f.personel_ref WHERE f.belge_turu = 'Kağıt Fiş' AND f.asil_teslim_zamani IS NULL ORDER BY f.fis_tarihi LIMIT 300`)).rows;
  });
  s.post('/masraf/:id/asil-teslim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, MFY))) return yok(y);
    const r = await b.db.query(`UPDATE personel_masraf_fisi SET asil_teslim_zamani = now(), asil_teslim_alan_ref = $2 WHERE kimlik = $1 AND belge_turu = 'Kağıt Fiş' AND asil_teslim_zamani IS NULL RETURNING kimlik`, [id, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu fiş için teslim kaydı alınamaz.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Fiş Aslı Teslim Alındı', nesneTuru: 'Masraf', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
