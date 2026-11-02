import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { izYaz } from './denetim.js';
import { kapanisKaydet } from './kapanis.js';
import { ozet, rastgeleBelirtec } from './kripto.js';
import { kartAc } from './is_motoru.js';
import { onayMakami } from './makam.js';

export const CIHAZ_COOKIE = 'yatonet_cihaz';
const YIL_SN = 365 * 86_400;

const yaz = (y: FastifyReply, belirtec: string, guvenli: boolean) => y.setCookie(CIHAZ_COOKIE, belirtec, { path: '/', httpOnly: true, sameSite: 'strict', secure: guvenli, maxAge: YIL_SN });

/**
 * YG-1006, YG-1150: ayrıcalıklı hesap yalnız kayıtlı cihazdan girer. Doğrulama uygulaması kurulurken kullanılan cihaz kaydolur;
 * başka cihazdan girişte kod doğru olsa da oturum açılmaz, cihaz onayı Bilgi İşlem Müdürüne gider. Null dönerse giriş serbesttir, metin dönerse engeldir.
 */
export async function cihazDenetle(db: Pool, i: FastifyRequest, y: FastifyReply, h: { kimlik: string; ad_soyad: string }, yeniKurulum: boolean, guvenli: boolean): Promise<string | null> {
  const gelen = i.cookies[CIHAZ_COOKIE];
  if (yeniKurulum) {
    await db.query(`UPDATE cihaz_kaydi SET durum = 'İptal' WHERE kullanici_ref = $1 AND durum <> 'İptal'`, [h.kimlik]);
    const b = rastgeleBelirtec();
    await db.query(`INSERT INTO cihaz_kaydi (kullanici_ref, belirtec_ozeti, durum, kaynak_adres) VALUES ($1,$2,'Onaylı',$3)`, [h.kimlik, ozet(b), i.ip]);
    yaz(y, b, guvenli);
    await izYaz(db, { aktor: h.kimlik, eylem: 'Cihaz Kaydedildi', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return null;
  }
  const kayit = gelen ? (await db.query(`SELECT durum FROM cihaz_kaydi WHERE kullanici_ref = $1 AND belirtec_ozeti = $2`, [h.kimlik, ozet(gelen)])).rows[0] : null;
  if (kayit?.durum === 'Onaylı') return null;
  if (kayit?.durum === 'Onay Bekliyor') return 'Bu cihazın onayı beklenmektedir.';
  const b = rastgeleBelirtec();
  const c = (await db.query(`INSERT INTO cihaz_kaydi (kullanici_ref, belirtec_ozeti, durum, kaynak_adres) VALUES ($1,$2,'Onay Bekliyor',$3) RETURNING kimlik`, [h.kimlik, ozet(b), i.ip])).rows[0].kimlik as string;
  yaz(y, b, guvenli);
  const rol = (await db.query(`SELECT r.kimlik FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.ayricalikli_rol ORDER BY r.kimlik LIMIT 1`, [h.kimlik])).rows[0]?.kimlik;
  const makam = rol ? await onayMakami(db, rol) : (await db.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Bilgi İşlem Müdürü'`)).rows[0].kimlik;
  await kartAc(db, { tur: 'Cihaz Onayı', baslik: `Yeni Cihaz Onayı · ${h.ad_soyad}`, ozet: `Ayrıcalıklı hesap kayıtlı olmayan bir cihazdan giriş denedi. Kaynak: ${i.ip}. Kullanıcıyla kurumsal telefondan teyit ediniz.`, oncelik: 'Yüksek', zincir: [makam], nesneTuru: 'cihaz_kaydi', nesneKimligi: c });
  await izYaz(db, { aktor: h.kimlik, eylem: 'Kayıtsız Cihazdan Giriş', sonuc: 'Başarısız', adres: i.ip, iliski: i.id });
  return 'Bu cihaz kayıtlı değildir; onay talebi gönderilmiştir. Onaylandıktan sonra yeniden giriş yapınız.';
}

kapanisKaydet('Cihaz Onayı', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') await c.query(`UPDATE cihaz_kaydi SET durum = 'Onaylı', onaylayan_ref = $2 WHERE kimlik = $1`, [k.nesne_kimligi, yapan]);
  else if (karar === 'Reddet') await c.query(`UPDATE cihaz_kaydi SET durum = 'İptal', onaylayan_ref = $2 WHERE kimlik = $1`, [k.nesne_kimligi, yapan]);
});
