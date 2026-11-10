import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const TUR = 'Kritik Bulgu Kararı';

/** YG-545: keşifte Kritik bulgu saha raporu beklenmeden dosya ekibine bildirilir; alıcılar ve bilgi kayda geçer, karar Dosya Sorumlusuna görev olur. */
export async function kritikBulguBildir(c: PoolClient, g: { dosya: string; dosyaNo: string; bulgu: string; bulguNo: string; aciklama: string; yapan: string }): Promise<string[]> {
  const ekip = (await c.query(`SELECT kullanici_ref k, rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL AND rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu', 'Operasyon Yöneticisi', 'Teknik Yönetici')`, [g.dosya])).rows as { k: string; rol: string }[];
  const alicilar = [...new Set(ekip.map((x) => x.k).filter((x) => x !== g.yapan))];
  const bilgi = `${g.bulguNo} · ${g.aciklama}`.slice(0, 300);
  await c.query(`INSERT INTO kritik_bulgu_bildirimi (bulgu_ref, alicilar, bilgi, bildiren_ref) VALUES ($1,$2,$3,$4)`, [g.bulgu, alicilar, bilgi, g.yapan]);
  if (alicilar.length) await bildir(c, { olay: `kritik-bulgu:${g.bulgu}`, kullanicilar: alicilar, baslik: `Kritik Bulgu: ${g.dosyaNo}`, ozet: bilgi, oncelik: 'Kritik', sms: true });
  const ds = ekip.find((x) => x.rol === 'Dosya Sorumlusu')?.k;
  if (ds) await kartAc(c, { tur: TUR, kategori: 'islem', baslik: `${g.dosyaNo} · Kritik Bulgu ${g.bulguNo}`, ozet: 'Saha raporunu beklemeden kararı kaydediniz.', oncelik: 'Kritik', sahipKullanici: ds, sonZaman: new Date(Date.now() + 2 * 3_600_000), nesneTuru: 'Bulgu', nesneKimligi: g.bulgu });
  return alicilar;
}

export function kritikBulguYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/dosya/:id/kritik-bulgular', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL`, [id, o.kullanici])).rowCount) return yok(y);
    return (await b.db.query(`SELECT x.kimlik, x.bulgu_no, n.bilgi, n.zaman, n.karar, n.karar_zamani FROM kritik_bulgu_bildirimi n JOIN bulgu x ON x.kimlik = n.bulgu_ref WHERE x.dosya_ref = $1 ORDER BY n.zaman DESC`, [id])).rows;
  });
  s.post('/bulgu/:id/kritik-karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT n.kimlik, n.karar, x.dosya_ref FROM kritik_bulgu_bildirimi n JOIN bulgu x ON x.kimlik = n.bulgu_ref WHERE n.bulgu_ref = $1`, [id])).rows[0];
    if (!k || !(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL AND rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu')`, [k.dosya_ref, o.kullanici])).rowCount) return yok(y);
    if (k.karar) return y.code(409).send({ hata: 'Karar kaydedilmiştir.' });
    if (!g.karar?.trim()) return y.code(400).send({ hata: 'Kararı yazınız.' });
    await b.db.query(`UPDATE kritik_bulgu_bildirimi SET karar = $2, karar_veren_ref = $3, karar_zamani = now() WHERE kimlik = $1`, [k.kimlik, g.karar.trim(), o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [TUR, id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: TUR, nesneTuru: 'Bulgu', nesneKimligi: id, yeni: { karar: g.karar.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
