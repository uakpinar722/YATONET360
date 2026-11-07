import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/** YG-089: şifre, parola, PIN gibi hassas bilgi tutanağa yazılmaz; güvenli kanalla ayrıca verilir. */
const HASSAS = /(şifre|sifre|parola|password|passcode|\bpin\b|wi-?fi\s*(kodu|code)|alarm\s*(kodu|code))\s*[:=]?\s*\S+/iu;
export function hassasBilgi(...metinler: (string | null | undefined)[]): string | null {
  return metinler.some((m) => m && HASSAS.test(m)) ? 'Şifre, parola veya PIN gibi hassas bilgiler tutanağa yazılmaz; ilgili kişiye güvenli kanalla ayrıca iletiniz.' : null;
}

/** YG-089: imzalı tutanakta değişiklik yalnız tarihli ek kayıtla yapılır; ek kayıtlar tutanakla birlikte listelenir. */
export function tutanakEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const TUR: Record<string, { tablo: string; ad: string }> = { 'yat-kabul': { tablo: 'yat_kabul_tutanagi', ad: 'Yat Kabul Tutanağı' }, teslim: { tablo: 'teslim_kaydi', ad: 'Teslim Tutanağı' } };
  const bul = async (tur: string, id: string, k: string) => {
    const t = TUR[tur]; if (!t || !UUID.test(id)) return null;
    const r = (await b.db.query(`SELECT dosya_ref FROM ${t.tablo} WHERE kimlik = $1`, [id])).rows[0];
    return r && (await dosyaErisimi(b.db, k, r.dosya_ref)) ? { ...t, dosya: r.dosya_ref as string } : null;
  };
  s.get('/tutanak/:tur/:id/ek', oturumlu, async (i, y) => {
    const { tur, id } = i.params as { tur: string; id: string }; const t = await bul(tur, id, i.oturum!.kullanici);
    if (!t || i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    return (await b.db.query(`SELECT e.kimlik, e.metin, e.olusturma_zamani, h.ad_soyad FROM tutanak_ek_kaydi e JOIN kullanici_hesabi h ON h.kimlik = e.giren_ref WHERE e.tutanak_ref = $1 ORDER BY e.olusturma_zamani`, [id])).rows;
  });
  s.post('/tutanak/:tur/:id/ek', oturumlu, async (i, y) => {
    const o = i.oturum!; const { tur, id } = i.params as { tur: string; id: string }; const g = (i.body ?? {}) as { metin?: string };
    const t = await bul(tur, id, o.kullanici);
    if (!t || o.grup !== 'LGM İç Rolü') return yok(y);
    if (!g.metin?.trim()) return y.code(400).send({ hata: 'Ek kaydın açıklamasını giriniz.' });
    const h = hassasBilgi(g.metin); if (h) return y.code(400).send({ hata: h });
    const r = await b.db.query(`INSERT INTO tutanak_ek_kaydi (tutanak_turu, tutanak_ref, dosya_ref, metin, giren_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik, olusturma_zamani`, [t.ad, id, t.dosya, g.metin.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Tutanak Ek Kaydı', nesneTuru: t.ad, nesneKimligi: id, yeni: { metin: g.metin.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return r.rows[0];
  });
}
