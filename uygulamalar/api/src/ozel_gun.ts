import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const DOGUM = 'Özel gün – Doğum günü paylaşımı'; const ISE_GIRIS = 'Özel gün – İşe giriş yıl dönümü paylaşımı';
const rizaVar = `EXISTS (SELECT 1 FROM acik_riza r WHERE r.ilgili_kisi_ref = h.kimlik AND r.riza_turu = $1 AND r.geri_alma_zamani IS NULL)`;

/** YG-1633, YG-1711: önümüzdeki 7 günde doğum günü ve işe giriş yıl dönümü; yalnız rıza veren personel; yaş ve doğum yılı gösterilmez. */
export async function ozelGunler(db: Pool, bugun = new Date()) {
  const gunler = Array.from({ length: 7 }, (_, n) => new Date(bugun.getTime() + n * 86_400_000).toISOString().slice(5, 10));
  const dogum = (await db.query(`SELECT h.ad_soyad, k.dogum_gunu gun FROM personel_karti k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.personel_durumu <> 'Ayrıldı' AND k.dogum_gunu = ANY($2) AND ${rizaVar}`, [DOGUM, gunler])).rows;
  const giris = (await db.query(`SELECT h.ad_soyad, to_char(k.ise_giris_tarihi, 'MM-DD') gun, (extract(year FROM $3::date) - extract(year FROM k.ise_giris_tarihi))::int yil FROM personel_karti k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.personel_durumu <> 'Ayrıldı' AND to_char(k.ise_giris_tarihi, 'MM-DD') = ANY($2) AND k.ise_giris_tarihi < $3::date - 300 AND ${rizaVar}`, [ISE_GIRIS, gunler, bugun.toISOString().slice(0, 10)])).rows;
  const sira = (g: string) => gunler.indexOf(g);
  return [...dogum.map((x) => ({ ad: x.ad_soyad, gun: x.gun, tur: 'Doğum Günü' })), ...giris.map((x) => ({ ad: x.ad_soyad, gun: x.gun, tur: `İşe Giriş Yıl Dönümü (${x.yil}. yıl)` }))].sort((a, b) => sira(a.gun) - sira(b.gun));
}

export function ozelGunYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/ozel-gunler', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const ben = (await b.db.query(`SELECT k.dogum_gunu, EXISTS (SELECT 1 FROM acik_riza r WHERE r.ilgili_kisi_ref = $1 AND r.riza_turu = $2 AND r.geri_alma_zamani IS NULL) riza FROM personel_karti k WHERE k.kullanici_ref = $1`, [o.kullanici, DOGUM])).rows[0];
    return { liste: await ozelGunler(b.db), dogumGunuGirebilir: Boolean(ben?.riza), dogumGunu: ben?.dogum_gunu ?? null };
  });
  // Doğum günü yalnız gün ve ay olarak, yalnız rıza veren personelin kendisince girilir.
  s.post('/ozel-gunler/dogum-gunu', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const g = String(((i.body ?? {}) as { gun?: string }).gun ?? '');
    if (g && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(g)) return y.code(400).send({ hata: 'Gün ve ayı seçiniz.' });
    if (g && !(await b.db.query(`SELECT 1 FROM acik_riza WHERE ilgili_kisi_ref = $1 AND riza_turu = $2 AND geri_alma_zamani IS NULL`, [o.kullanici, DOGUM])).rowCount) return y.code(409).send({ hata: 'Doğum günü paylaşımı için izniniz bulunmamaktadır; Profilim sayfasından izin verebilirsiniz.' });
    const r = await b.db.query(`UPDATE personel_karti SET dogum_gunu = $2 WHERE kullanici_ref = $1`, [o.kullanici, g || null]);
    return r.rowCount ? { tamam: true } : yok(y);
  });
}
