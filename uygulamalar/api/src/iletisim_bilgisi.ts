import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const KAYNAK = ['Telefon Görüşmesi', 'E-posta', 'Portal', 'Belge', 'SMS Kodu', 'Sistem Kaydı'];
const AMAC = ['Dosya İletişimi', 'Bildirim', 'Fatura ve Ödeme', 'Kanıt'];

/**
 * YG-518: iletişim bilgisi kaynak, doğrulama zamanı, kullanım amacı ve geçerlilikle tutulur. Telefon veya e-posta değişince eski değer silinmez,
 * geçmiş dosyada kanıt olarak kalır; güncel bildirim hedefi ayrıca seçilir ve bildirimler bu hedefe gider.
 */
export function iletisimBilgisiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const ekipte = async (d: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL AND rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu', 'Operasyon Yöneticisi')`, [d, k])).rowCount);
  const kayit = async (id: string) => (await b.db.query(`SELECT i.*, t.dosya_ref FROM iletisim_bilgisi i JOIN dosya_tarafi t ON t.kimlik = i.taraf_ref WHERE i.kimlik = $1`, [id])).rows[0];

  s.get('/dosya/:id/iletisim-bilgisi', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || i.oturum!.grup !== 'LGM İç Rolü' || !(await ekipte(id, i.oturum!.kullanici))) return yok(y);
    return { kaynaklar: KAYNAK, amaclar: AMAC, kayitlar: (await b.db.query(`SELECT i.kimlik, t.taraf_rolu, t.kisi_adi_soyadi, i.tur, i.deger, i.kaynak, i.amac, i.dogrulama_zamani, i.gecerli, i.bildirim_hedefi, i.gecersiz_zamani, i.olusturma_zamani FROM iletisim_bilgisi i JOIN dosya_tarafi t ON t.kimlik = i.taraf_ref WHERE t.dosya_ref = $1 ORDER BY t.taraf_rolu, i.tur, i.bildirim_hedefi DESC, i.olusturma_zamani DESC`, [id])).rows };
  });
  s.post('/iletisim-bilgisi/:id/dogrula', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kaynak?: string; amac?: string };
    if (!UUID.test(id)) return yok(y); const k = await kayit(id); if (!k || !(await ekipte(k.dosya_ref, o.kullanici))) return yok(y);
    if (!KAYNAK.includes(g.kaynak ?? '') || (g.amac && !AMAC.includes(g.amac))) return y.code(400).send({ hata: 'Kaynağı ve amacı listeden seçiniz.' });
    await b.db.query(`UPDATE iletisim_bilgisi SET kaynak = $2, amac = coalesce($3, amac), dogrulama_zamani = now(), dogrulayan_ref = $4 WHERE kimlik = $1`, [id, g.kaynak, g.amac ?? null, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İletişim Bilgisi Doğrulandı', nesneTuru: 'İletişim Bilgisi', nesneKimligi: id, yeni: { kaynak: g.kaynak }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // Eski bir değer yeniden hedef seçilirse dosya tarafındaki iletişim alanı ona döner; diğer değerler kanıt olarak kalır.
  s.post('/iletisim-bilgisi/:id/hedef', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y); const k = await kayit(id); if (!k || !(await ekipte(k.dosya_ref, o.kullanici))) return yok(y);
    if (k.bildirim_hedefi) return y.code(409).send({ hata: 'Bu bilgi zaten bildirim hedefidir.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE iletisim_bilgisi SET bildirim_hedefi = false, gecerli = false, gecersiz_zamani = now() WHERE taraf_ref = $1 AND tur = $2 AND bildirim_hedefi`, [k.taraf_ref, k.tur]);
      await c.query(`UPDATE iletisim_bilgisi SET bildirim_hedefi = true, gecerli = true, gecersiz_zamani = NULL WHERE kimlik = $1`, [id]);
      await c.query(`UPDATE dosya_tarafi SET ${k.tur === 'Telefon' ? 'telefon' : 'eposta'} = $2 WHERE kimlik = $1`, [k.taraf_ref, k.deger]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bildirim Hedefi Seçildi', nesneTuru: 'İletişim Bilgisi', nesneKimligi: id, yeni: { tur: k.tur }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
