import type { FastifyInstance, FastifyReply } from 'fastify';
import { belgeBagiKaydet } from './belge.js';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const UUID = /^[0-9a-f-]{36}$/;
export const BELGE_TURLERI = ['İç Tutanak', 'Tebliğ', 'Kontrol Listesi', 'Zimmet', 'Devir Tutanağı'] as const;
const KART = 'Belge Onayı';

/** Taranmış ıslak imzalı belge, beyanı hazırlayan ve onaylayacak kişi tarafından görülür. */
belgeBagiKaydet('İmza Beyanı', async (db, k, id) => {
  if (!UUID.test(id)) return 'yok';
  const r = (await db.query(`SELECT hazirlayan_ref, kisi_ref FROM imza_beyani WHERE kimlik = $1`, [id])).rows[0];
  if (!r) return 'yok';
  return r.hazirlayan_ref === k || r.kisi_ref === k ? 'tamam' : 'yetkisiz';
});

/**
 * YG-223, YG-1406, V-1111: iç tutanak, tebliğ, kontrol listesi, zimmet ve devir tutanağı ıslak imza yerine ilgili kişinin YATONET 360 onayıyla
 * (iki aşamalı doğrulamayla açılmış oturumdan) alınır. Kişinin sistem erişimi yoksa hazırlayan gerekçe yazarak ıslak imzalı taranmış belgeyi yükler
 * (ıslak imza istisnası). Hazırlayan kendi beyanını onaylayamaz.
 */
export function imzaBeyaniYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const kartKapat = (id: string) => b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [KART, id]);

  s.post('/imza-beyani', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const g = (i.body ?? {}) as { belgeTuru?: string; konu?: string; icerik?: string; kisi?: string; dosya?: string };
    if (!BELGE_TURLERI.includes(g.belgeTuru as (typeof BELGE_TURLERI)[number]) || !g.konu?.trim() || !g.icerik?.trim() || !g.kisi || g.kisi.length > 64) return y.code(400).send({ hata: 'Belge türü, konu, içerik ve onaylayacak kişi zorunludur.' });
    if (g.kisi === o.kullanici) return y.code(400).send({ hata: 'Hazırladığınız belgenin onayı başka bir kişiye aittir; onaylayacak kişiyi seçmenizi rica ederiz.' });
    const ks = (await b.db.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü'`, [g.kisi])).rows[0];
    if (!ks) return y.code(400).send({ hata: 'Onaylayacak LGM personeli bulunamadı.' });
    if (g.dosya && (!UUID.test(g.dosya) || !(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1`, [g.dosya])).rowCount)) return y.code(400).send({ hata: 'Dosya bulunamadı.' });
    const r = (await b.db.query(`INSERT INTO imza_beyani (belge_turu, konu, icerik, kisi_ref, dosya_ref, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [g.belgeTuru, g.konu.trim(), g.icerik.trim(), g.kisi, g.dosya || null, o.kullanici])).rows[0];
    await kartAc(b.db, { tur: KART, kategori: 'islem', baslik: `${g.belgeTuru} · ${g.konu.trim()}`, ozet: 'Belgeyi okuyup YATONET 360 onayınızı veriniz.', sahipKullanici: g.kisi, nesneTuru: 'İmza Beyanı', nesneKimligi: r.kimlik });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge Onayı Talebi', nesneTuru: 'İmza Beyanı', nesneKimligi: r.kimlik, yeni: { belgeTuru: g.belgeTuru, kisi: g.kisi }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });

  s.get('/imza-beyanlari', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const kisiler = (await b.db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kullanici_grubu = 'LGM İç Rolü' AND kimlik <> $1 AND hesap_durumu = 'Aktif' ORDER BY ad_soyad`, [o.kullanici])).rows;
    const kayitlar = (await b.db.query(`SELECT i.kimlik, i.belge_turu, i.konu, i.icerik, i.durum, i.kisi_ref = $1 AS bana, i.hazirlayan_ref = $1 AS benim, h.ad_soyad kisi, z.ad_soyad hazirlayan, d.dosya_no, i.olusturma_zamani, i.sonuc_zamani, i.islak_gerekce
      FROM imza_beyani i JOIN kullanici_hesabi h ON h.kimlik = i.kisi_ref JOIN kullanici_hesabi z ON z.kimlik = i.hazirlayan_ref LEFT JOIN dosya d ON d.kimlik = i.dosya_ref
      WHERE i.kisi_ref = $1 OR i.hazirlayan_ref = $1 ORDER BY i.durum = 'Onay Bekliyor' DESC, i.olusturma_zamani DESC LIMIT 100`, [o.kullanici])).rows;
    return { kisiler, kayitlar };
  });

  // YATONET 360 onayı: yalnız belgedeki kişi, kendi oturumundan verir.
  s.post('/imza-beyani/:id/onayla', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const r = await b.db.query(`UPDATE imza_beyani SET durum = 'Onaylandı', sonuc_zamani = now(), onay_oturumu = $3 WHERE kimlik = $1 AND kisi_ref = $2 AND durum = 'Onay Bekliyor' RETURNING kimlik`, [id, o.kullanici, o.oturum]);
    if (!r.rowCount) return yok(y);
    await kartKapat(id);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge Onayı (YATONET 360)', nesneTuru: 'İmza Beyanı', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // Islak imza istisnası: kişinin sistem erişimi yoksa hazırlayan, beyana yüklediği ıslak imzalı taranmış belgeyi gerekçesiyle bağlar.
  s.post('/imza-beyani/:id/islak-imza', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string; gerekce?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const r = (await b.db.query(`SELECT durum FROM imza_beyani WHERE kimlik = $1 AND hazirlayan_ref = $2`, [id, o.kullanici])).rows[0];
    if (!r) return yok(y);
    if (r.durum !== 'Onay Bekliyor') return y.code(409).send({ hata: 'Bu belge sonuçlanmıştır.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Kişinin neden sistemden onay veremediğini yazınız.' });
    if (!g.belge || !UUID.test(g.belge) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'İmza Beyanı' AND bag_kimligi = $2`, [g.belge, id])).rowCount) return y.code(400).send({ hata: 'Islak imzalı taranmış belgeyi bu kayda yükleyip seçiniz.' });
    await b.db.query(`UPDATE imza_beyani SET durum = 'Islak İmzalı', sonuc_zamani = now(), islak_belge_ref = $2, islak_gerekce = $3 WHERE kimlik = $1`, [id, g.belge, g.gerekce.trim()]);
    await kartKapat(id);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge Onayı (Islak İmza İstisnası)', nesneTuru: 'İmza Beyanı', nesneKimligi: id, yeni: { gerekce: g.gerekce.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
