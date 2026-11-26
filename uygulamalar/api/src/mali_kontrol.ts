import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/** YG-1611, YG-1080 uzlaştırması: Muhasebe ve Finans Müdür Yardımcısı işlem bazında kontrol yapar; hesap bakiyesi, genel gider, bütçe ve ödeme takvimi toplamları dört role kapalıdır. */
export const MALI_KONTROL = ['Muhasebe ve Finans Müdür Yardımcısı', 'Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü', 'Genel Müdür Yardımcısı', 'CEO'];
const CARI = ['Müşteri', 'Sigorta Şirketi', 'Çözüm Ortağı', 'Tedarikçi'];

export function maliKontrolYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, MALI_KONTROL])).rowCount);

  // Kontrol Uyarıları: 24 saati aşan, cariye eşleşmemiş banka hareketi; fatura kuru ile kayıtlı TCMB satış kuru arasında fark.
  s.get('/mali-kontrol', oturumlu, async (i, y) => {
    if (!(await yetkili(i.oturum!.kullanici))) return yok(y);
    const eslesmeyen = (await b.db.query(`SELECT kimlik, tarih::text, yon, tutar_eur, aciklama FROM hesap_hareketi WHERE hesap_turu = 'Banka' AND cari_ref IS NULL AND olusturma_zamani < now() - interval '24 hours' ORDER BY tarih LIMIT 200`)).rows;
    const kur = (await b.db.query(`SELECT f.kimlik, coalesce(f.fatura_no, f.proforma_no) belge_no, f.kur_tarihi::text, f.kur::float fatura_kuru, k.satis::float tcmb_kuru FROM musteri_faturasi f JOIN doviz_kuru k ON k.tarih = f.kur_tarihi AND k.para_birimi = 'EUR'
      WHERE f.kur IS NOT NULL AND abs(f.kur - k.satis) > 0.0001 AND f.durum <> 'İptal' ORDER BY f.kur_tarihi DESC LIMIT 100`)).rows;
    const odemeListeleri = (await b.db.query(`SELECT kimlik, liste_no FROM odeme_listesi WHERE durum = 'Onayda' ORDER BY olusturma_zamani`)).rows; // YG-1611 ön kontrol
    return { eslesmeyen, kurUyusmazligi: kur, odemeListeleri };
  });

  s.post('/mali-kontrol/eslestir/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { cariTuru?: string; cari?: string; not?: string };
    if (!UUID.test(id) || !(await yetkili(o.kullanici))) return yok(y);
    if (!CARI.includes(g.cariTuru ?? '') || !g.cari?.trim()) return y.code(400).send({ hata: 'Cari türünü ve cariyi seçiniz.' });
    if (!g.not?.trim()) return y.code(400).send({ hata: 'Eşleştirme teyit notunu yazmanızı rica ederiz.' });
    const r = await b.db.query(`UPDATE hesap_hareketi SET cari_turu = $2, cari_ref = $3, eslestiren_ref = $4, eslesme_zamani = now() WHERE kimlik = $1 AND cari_ref IS NULL RETURNING kimlik`, [id, g.cariTuru, g.cari.trim(), o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Hareket eşleştirilmiştir.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Banka Hareketi Eşleştirildi', nesneTuru: 'Hesap Hareketi', nesneKimligi: id, yeni: { cariTuru: g.cariTuru, cari: g.cari.trim() }, gerekce: g.not.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
