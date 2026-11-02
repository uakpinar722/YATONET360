import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

/** Geçerli atamalar: durumu Aktif, tarih aralığında. Süresi biten atama kendiliğinden yetki vermez (YG-1008). */
const GECERLI = `a.atama_durumu = 'Aktif' AND a.baslangic_tarihi <= current_date AND (a.bitis_tarihi IS NULL OR a.bitis_tarihi >= current_date) AND r.rol_durumu = 'Aktif'`;

export async function kullaniciRolleri(db: Pool, kullanici: string) {
  const { rows } = await db.query(
    `SELECT r.kimlik, r.rol_adi, r.rol_sahibi_birim, r.kademe FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref
      WHERE a.kullanici_ref = $1 AND ${GECERLI} ORDER BY r.kimlik`, [kullanici]);
  return rows as { kimlik: string; rol_adi: string; rol_sahibi_birim: string; kademe: string }[];
}

export async function kullaniciIzinleri(db: Pool, kullanici: string) {
  const { rows } = await db.query(
    `SELECT DISTINCT z.izin FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref JOIN rol_izni z ON z.rol_ref = r.kimlik
      WHERE a.kullanici_ref = $1 AND ${GECERLI} ORDER BY z.izin`, [kullanici]);
  return rows.map((r) => r.izin as string);
}

/** YG-987, YG-1113: yetki sunucuda her istekte denetlenir; yetkisiz deneme izlenir. */
export function izinGerekli(b: Baglam, izin: string) {
  const oturum = tamOturumGerekli(b);
  return async (i: FastifyRequest, y: FastifyReply) => {
    await oturum(i, y);
    if (y.sent) return;
    const o = i.oturum!;
    if (!(await kullaniciIzinleri(b.db, o.kullanici)).includes(izin)) {
      await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yetkisiz Erişim Denemesi', nesneTuru: izin, sonuc: 'Başarısız', adres: i.ip, iliski: i.id });
      return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    }
  };
}

export function yetkiYollari(s: FastifyInstance, b: Baglam) {
  s.get('/ben', { preHandler: tamOturumGerekli(b) }, async (i) => {
    const o = i.oturum!;
    return { kimlik: o.kullanici, adSoyad: o.adSoyad, grup: o.grup, roller: await kullaniciRolleri(b.db, o.kullanici), izinler: await kullaniciIzinleri(b.db, o.kullanici) };
  });

  s.get('/yetki/roller', { preHandler: izinGerekli(b, 'rol_katalogu.goruntule') }, async () => {
    const { rows } = await b.db.query(`SELECT kimlik, rol_adi, rol_sahibi_birim, kademe, kullanici_gruplari, ayricalikli_rol FROM rol ORDER BY kimlik`);
    return rows;
  });

  // YG-1187: izi görüntüleme de kayda geçer.
  s.get('/denetim/izler', { preHandler: izinGerekli(b, 'denetim_izi.goruntule') }, async (i) => {
    const o = i.oturum!;
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İşlem İzi Görüntülendi', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    const { rows } = await b.db.query(
      `SELECT d.kimlik, d.olay_zamani, d.eylem, d.sonuc, d.gerekce, d.kaynak_kanal, k.ad_soyad AS aktor
         FROM denetim_izi d LEFT JOIN kullanici_hesabi k ON k.kimlik = d.aktor_ref ORDER BY d.kimlik DESC LIMIT 100`);
    return rows;
  });
}
