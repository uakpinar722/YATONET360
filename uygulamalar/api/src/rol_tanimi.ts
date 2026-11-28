import type { FastifyInstance } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import type { Baglam } from './kimlik.js';
import { onayMakami } from './makam.js';
import { izinGerekli } from './yetki.js';

const TUR = 'Rol Tanımı Değişikliği';

/** YG-1009: onaylanan rol tanımı role uygulanır; reddedilen tanım rolü değiştirmez. */
kapanisKaydet(TUR, async (c, k, karar) => {
  if (karar !== 'Onayla' && karar !== 'Reddet') return;
  const t = (await c.query(`UPDATE rol_tanimi_talebi SET durum = $2, karar_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Onay Bekliyor' RETURNING *`, [k.nesne_kimligi, karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi'])).rows[0];
  if (t && karar === 'Onayla') await c.query(`UPDATE rol SET is_amaci = $2, sahip_rol_ref = $3, gozden_gecirme_ay = $4 WHERE kimlik = $1`, [t.rol_ref, t.is_amaci, t.sahip_rol_ref, t.gozden_gecirme_ay]);
});

/**
 * YG-1007, YG-1009: rolün iş amacı, sahip rolü ve gözden geçirme dönemi Sistem Yöneticisince (veya Bilgi İşlem Müdürünce) hazırlanır, rolün bağlı olduğu birim Müdürü onaylar.
 * Makam onayMakami ile bulunur; rolün biriminde Müdür yoksa Bilgi İşlem Müdürü onaylar. Hazırlayan kendi hazırladığını onaylayamaz (makam bir üste çıkar).
 */
export function rolTanimiYollari(s: FastifyInstance, b: Baglam) {
  s.post('/yetki/rol/:id/tanim', { preHandler: izinGerekli(b, 'rol_katalogu.duzenle') }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { amac?: string; sahip?: string; gozdenGecirmeAy?: number };
    const ay = Number(g.gozdenGecirmeAy);
    if (!g.amac?.trim() || !g.sahip || !Number.isInteger(ay) || ay < 1 || ay > 36) return y.code(400).send({ hata: 'İş amacı, sahip rol ve gözden geçirme dönemi (1–36 ay) zorunludur.' });
    const r = (await b.db.query(`SELECT r.kimlik, r.rol_adi FROM rol r WHERE r.kimlik = $1 AND EXISTS (SELECT 1 FROM rol s WHERE s.kimlik = $2 AND s.kimlik <> $1)`, [id, g.sahip])).rows[0];
    if (!r) return y.code(404).send({ hata: 'Rol veya sahip rol bulunamadı.' });
    if ((await b.db.query(`SELECT 1 FROM rol_tanimi_talebi WHERE rol_ref = $1 AND durum = 'Onay Bekliyor'`, [id])).rowCount) return y.code(409).send({ hata: 'Bu rol için onay bekleyen bir tanım değişikliği vardır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = (await c.query(`INSERT INTO rol_tanimi_talebi (rol_ref, is_amaci, sahip_rol_ref, gozden_gecirme_ay, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, g.amac.trim(), g.sahip, ay, o.kullanici])).rows[0];
      const mk = await onayMakami(c, id).catch(() => rolId(c, 'Bilgi İşlem Müdürü'));
      const sahip = (await c.query(`SELECT rol_adi FROM rol WHERE kimlik = $1`, [g.sahip])).rows[0].rol_adi as string;
      await kartAc(c, { tur: TUR, baslik: `${r.rol_adi} · Rol Tanımı`, ozet: `İş amacı: ${g.amac.trim()} · Sahip rol: ${sahip} · Gözden geçirme: ${ay} ay`.slice(0, 300), hazirlayan: o.kullanici, zincir: [mk], nesneTuru: 'Rol Tanımı Talebi', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Rol Tanımı Değişikliği Hazırlandı', nesneTuru: 'Rol', nesneKimligi: id, yeni: { amac: g.amac.trim(), sahip: g.sahip, ay }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true, onayda: true };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
