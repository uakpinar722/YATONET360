import type { FastifyInstance, RouteOptions } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

export const ISLEVLER = ['Teklif ve Mali', 'Saha', 'Kalite', 'Yönetici'];

/** YG-994: firma portalı işleminin gerektirdiği işlev (yol kalıbından). Eşleşmeyen yol sınırlanmaz. */
export function firmaIslevi(url: string): string | null {
  const u = url.replace(/^\/api/, '');
  if (!u.startsWith('/firma-portal/')) return null;
  if (/\/(personel|alt-yuklenici|itiraz|acil-musaitlik|kullanici)(\/|$)|\/kurtarma\/[^/]+\/onay$|\/(is-emri|acil-cagri)\/[^/]+\/yanit$/.test(u)) return 'Yönetici';
  if (/\/fiyat|\/fiyat-kalem\/|\/hakedis|\/fatura$|\/acil-tutar$|\/menfaat-bildirimi$/.test(u)) return 'Teklif ve Mali';
  if (/\/uygunsuzluk\/|\/teknik-rapor$/.test(u)) return 'Kalite';
  if (/\/(is-emri|calisma-izni|kurtarma|is-kazasi)\//.test(u)) return 'Saha';
  return null;
}

/** Rota işleyicisi sarılır: oturum doğrulandıktan sonra (rota ön işleyicisinden sonra) kişinin kurumundaki işlevi denetlenir. */
export function firmaIslevKancasi(s: FastifyInstance, b: Baglam) {
  s.addHook('onRoute', (r: RouteOptions) => {
    const yontem = Array.isArray(r.method) ? r.method : [r.method];
    const islev = firmaIslevi(r.url ?? '');
    if (!islev || !yontem.includes('POST')) return;
    const asil = r.handler;
    r.handler = async function (this: unknown, i, y) {
      const k = i.oturum?.kullanici;
      if (k) {
        const l = (await b.db.query(`SELECT islevler FROM kurulus_kullanici WHERE kullanici_ref = $1`, [k])).rows as { islevler: string[] }[];
        if (l.length && !l.some((x) => x.islevler.includes(islev))) {
          await izYaz(b.db, { aktor: k, oturum: i.oturum!.oturum, eylem: 'Yetkisiz Erişim Denemesi', nesneTuru: `Firma İşlevi: ${islev}`, sonuc: 'Başarısız', adres: i.ip, iliski: i.id });
          return y.code(403).send({ hata: `Bu işlem kurumunuzda "${islev}" işlevi tanımlı kullanıcılar tarafından yapılır.` });
        }
      }
      return (asil as (this: unknown, a: typeof i, c: typeof y) => unknown).call(this, i, y);
    };
  });
}

/** YG-994: kurum yöneticisi kendi kurumundaki kullanıcıların işlevlerini belirler; kurumda en az bir Yönetici kalır. */
export function firmaIslevYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  s.get('/firma-portal/kullanicilar', oturumlu, async (i, y) => {
    const k = (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [i.oturum!.kullanici])).rows[0];
    if (!k) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    return { islevler: ISLEVLER, kullanicilar: (await b.db.query(`SELECT h.kimlik, h.ad_soyad, x.islevler FROM kurulus_kullanici x JOIN kullanici_hesabi h ON h.kimlik = x.kullanici_ref WHERE x.kurulus_ref = $1 ORDER BY h.ad_soyad`, [k.kurulus_ref])).rows };
  });
  s.post('/firma-portal/kullanici/:id/islev', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { islevler?: string[] };
    const ben = (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 AND 'Yönetici' = ANY (islevler) LIMIT 1`, [o.kullanici])).rows[0];
    if (!ben) return y.code(403).send({ hata: 'Kullanıcı işlevlerini kurum yöneticisi belirler.' });
    if (!Array.isArray(g.islevler) || !g.islevler.length || g.islevler.some((x) => !ISLEVLER.includes(x))) return y.code(400).send({ hata: 'En az bir işlev seçiniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query(`UPDATE kurulus_kullanici SET islevler = $3 WHERE kurulus_ref = $1 AND kullanici_ref = $2`, [ben.kurulus_ref, id, [...new Set(g.islevler)]]);
      if (!r.rowCount) { await c.query('ROLLBACK'); return y.code(404).send({ hata: 'Kullanıcı kurumunuzda bulunamadı.' }); }
      if (!(await c.query(`SELECT 1 FROM kurulus_kullanici WHERE kurulus_ref = $1 AND 'Yönetici' = ANY (islevler)`, [ben.kurulus_ref])).rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Kurumda en az bir Yönetici kalmalıdır.' }); }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Kullanıcı İşlevi', nesneTuru: 'Kullanıcı', nesneKimligi: id, yeni: { islevler: g.islevler }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
