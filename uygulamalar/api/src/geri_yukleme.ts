import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

const SY = 'Sistem Yöneticisi'; const BIM = 'Bilgi İşlem Müdürü';
const TUR = 'Geri Yükleme Sonrası Yeniden Giriş';
const anSaat = (z: Date) => z.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });

/**
 * YG-564: sistem gerçek bir yedekten geri yüklenip açıldığında LGM kullanıcılarına kayıtlarını kontrol etmeleri için zorunlu duyuru yayımlanır.
 * YG-015: açık dosyaların Dosya Sorumlularına ve Operasyon Yöneticisine, yedek zamanından sonra e-posta, SMS ve kurumsal WhatsApp ile gelen ihbar ve onayları yeniden girme görevi düşer.
 */
export function geriYuklemeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, [SY, BIM]])).rowCount);

  s.post('/geri-yukleme/kayit', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await yetkili(o.kullanici))) return yok(y);
    const g = (i.body ?? {}) as { yedek?: string; aciklama?: string };
    if (!g.yedek || !UUID.test(g.yedek) || !g.aciklama?.trim()) return y.code(400).send({ hata: 'Geri yüklenen yedeği ve olay açıklamasını giriniz.' });
    const yd = (await b.db.query(`SELECT bitis FROM yedek_kaydi WHERE kimlik = $1 AND durum = 'Başarılı'`, [g.yedek])).rows[0];
    if (!yd?.bitis) return y.code(400).send({ hata: 'Tamamlanmış bir yedek seçiniz.' });
    const zaman = new Date(yd.bitis); const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const k = (await c.query(`INSERT INTO geri_yukleme_kaydi (yedek_ref, yedek_zamani, aciklama, kaydeden_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [g.yedek, zaman, g.aciklama.trim(), o.kullanici])).rows[0].kimlik as string;
      await c.query(`INSERT INTO duyuru (baslik, govde, zorunlu, kapsam, yayimlayan_ref, bitis_zamani, durum) VALUES ($1,$2,true,'LGM',$3, now() + interval '7 days','Yayında')`, ['Sistem Geri Yüklendi: Kayıtlarınızı Kontrol Ediniz', `YATONET 360, ${anSaat(zaman)} tarihli yedekten geri yüklenmiştir. Bu saatten sonra girdiğiniz kayıtları kontrol ediniz; eksik kaydı yeniden giriniz.`, o.kullanici]);
      const son = await isGunuSonu(c, new Date(), 1); let n = 0;
      for (const d of (await c.query(`SELECT d.kimlik, d.dosya_no, d.dosya_sorumlusu_ref FROM dosya d WHERE d.statu NOT IN ('Kapalı') AND d.dosya_sorumlusu_ref IS NOT NULL`)).rows) {
        await kartAc(c, { tur: TUR, kategori: 'gorev', baslik: `${d.dosya_no} · Geri Yükleme Sonrası Kontrol`, ozet: `${anSaat(zaman)} sonrasında e-posta, SMS ve kurumsal WhatsApp ile gelen ihbar ve onayları yeniden giriniz.`, oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, sonZaman: son, nesneTuru: 'Geri Yükleme', nesneKimligi: `${k}:${d.kimlik}` }); n++;
      }
      await kartAc(c, { tur: TUR, kategori: 'gorev', baslik: 'Geri Yükleme Sonrası Yeni İhbarlar', ozet: `${anSaat(zaman)} sonrasında telefon, e-posta, SMS ve kurumsal WhatsApp ile gelen yeni ihbarları yeniden kaydediniz.`, oncelik: 'Yüksek', sahipRol: await rolId(c, 'Operasyon Yöneticisi'), sonZaman: son, nesneTuru: 'Geri Yükleme', nesneKimligi: `${k}:ihbar` }); n++;
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Gerçek Geri Yükleme Kaydı', nesneTuru: 'Geri Yükleme', nesneKimligi: k, yeni: { yedek: g.yedek, yedekZamani: zaman, gorev: n }, gerekce: g.aciklama.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: k, gorev: n };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
