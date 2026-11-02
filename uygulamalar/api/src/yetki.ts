import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { dilKodu, eksikAdimlar, rizaBicimi } from './adimlar.js';
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

const GECERLI_VEKALET = `v.durum = 'Aktif' AND v.baslangic_tarihi <= current_date AND v.bitis_tarihi >= current_date`;

/** Kişinin asıl rolleri ve vekâlet ettiği roller. Vekâlet bitişte kendiliğinden düşer (YG-1056). */
export async function etkinRoller(db: Pool | PoolClient, kullanici: string) {
  const { rows } = await db.query(
    `SELECT r.kimlik, false AS vekalet FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND ${GECERLI}
     UNION SELECT v.rol_ref, true FROM vekalet v WHERE v.vekil_ref = $1 AND ${GECERLI_VEKALET}`, [kullanici]);
  const asil = new Set(rows.filter((r) => !r.vekalet).map((r) => r.kimlik));
  return rows.filter((r) => !r.vekalet || !asil.has(r.kimlik)) as { kimlik: string; vekalet: boolean }[];
}

export async function kullaniciIzinleri(db: Pool, kullanici: string) {
  const { rows } = await db.query(
    `SELECT DISTINCT z.izin FROM rol_izni z WHERE z.rol_ref = ANY($1) ORDER BY z.izin`, [(await etkinRoller(db, kullanici)).map((r) => r.kimlik)]);
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
  s.get('/ben', { preHandler: tamOturumGerekli(b, true) }, async (i) => {
    const o = i.oturum!;
    const { rows } = await b.db.query(`SELECT tercih_dili FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici]);
    return {
      kimlik: o.kullanici, adSoyad: o.adSoyad, grup: o.grup, dil: dilKodu(rows[0].tercih_dili), rizaBicimi: rizaBicimi(o.grup),
      eksik: await eksikAdimlar(b.db, o.kullanici), roller: await kullaniciRolleri(b.db, o.kullanici), izinler: await kullaniciIzinleri(b.db, o.kullanici),
    };
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
