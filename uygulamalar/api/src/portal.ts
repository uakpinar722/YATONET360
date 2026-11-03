import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomInt } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { KURAL } from './ayarlar.js';
import { belgeBagiKaydet } from './belge.js';
import { izYaz } from './denetim.js';
import { acilisKancasi, dosyaErisimi, kapiKaydet } from './dosya.js';
import { dilKod, ihbarAlindiGonder, ihbarKaydet, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { cerezYaz, kimlikNormalle, tamOturumGerekli, type Baglam } from './kimlik.js';
import { ozet, rastgeleBelirtec } from './kripto.js';
import { rolSahipleri } from './makam.js';
import { onayFormKaydet, onaySonucKaydet, onayTalebiAc } from './onay.js';
import { tarafNo, UUID } from './yat.js';

type Db = Pool | PoolClient;
export const GRUP_YAT = 'Bireysel Müşteri (Yat Sahibi/Yetkilisi)';
const MUSTERI_GRUPLARI = [GRUP_YAT, 'Kurumsal Müşteri'];

/** YG-1564: yat sahibine yalnız 17 durum adı gösterilir. Renk: sarı işlem bekleniyor, kırmızı iş durdu, yeşil ilerliyor, gri kapandı. */
export function musteriDurumu(d: { statu: string; asama: string | null; yat_sahibi_itirazi?: Date | null }, b: { beklemede: string[]; yasalBekleme?: boolean; acikIs?: boolean; ekBulgu?: boolean; isBasladi?: boolean }): { ad: string; renk: 'sarı' | 'kırmızı' | 'yeşil' | 'gri' } {
  if (d.statu === 'Kapalı') return { ad: 'Kapandı', renk: 'gri' };
  if (d.statu === 'Teknik Kapalı') return b.acikIs ? { ad: 'Açık İş Devam Ediyor', renk: 'yeşil' } : { ad: 'Teslim Edildi', renk: 'gri' };
  if (b.ekBulgu) return { ad: 'Ek Bulgu – İş Durduruldu', renk: 'kırmızı' };
  if (b.beklemede.includes('Muvafakat')) return { ad: 'Muvafakat Bekleniyor', renk: 'sarı' };
  if (b.beklemede.includes('Ödeme')) return { ad: 'Ödeme Bekleniyor', renk: 'sarı' };
  if (d.statu === 'Kontrollü Askıda' || b.beklemede.length) return { ad: 'Beklemede', renk: 'kırmızı' };
  if (b.yasalBekleme) return { ad: 'Yasal Bekleme Süresinde', renk: 'sarı' };
  switch (d.asama) {
    case 'Keşif': return { ad: 'Keşif Planlandı', renk: 'yeşil' };
    case 'Teklif': return { ad: 'Teklif Hazırlanıyor', renk: 'yeşil' };
    case 'Onay': return { ad: 'Onay Bekleniyor', renk: 'sarı' };
    case 'Uygulama': return b.isBasladi ? { ad: 'Onarıma Devam Ediliyor', renk: 'yeşil' } : { ad: 'Planlama Başladı', renk: 'yeşil' };
    case 'Kontrol': return { ad: 'Test ve Kontrol Aşamasında', renk: 'yeşil' };
    case 'Teslim': return { ad: 'Teslime Hazır', renk: 'sarı' };
    default: return { ad: 'Talebiniz Alındı', renk: 'yeşil' };
  }
}

belgeBagiKaydet('Talep', async (db, k, id) => {
  if (!UUID.test(id)) return 'yok';
  const r = (await db.query(`SELECT olusturan_ref, olusturma_zamani FROM talep WHERE kimlik = $1`, [id])).rows[0];
  if (!r) return 'yok';
  return r.olusturan_ref === k ? 'tamam' : 'yetkisiz';
});

/** YG-103, YG-476: lehtar varsa muvafakat girilmeden teklif onayı açılmaz; kilit yalnız teklif onayını durdurur. */
export async function muvafakatKilidi(db: Db, dosya: string): Promise<boolean> {
  const y = (await db.query(`SELECT y.lehtar_adi, y.lehtar_ref, y.lehtar_muvafakati_ref FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  return Boolean(y && (y.lehtar_adi || y.lehtar_ref) && !y.lehtar_muvafakati_ref);
}

/** YG-1468 sonrası kapı: mülkiyet beyanı olmadan da teklif hazırlanır, onay aşamasında kilit devreye girer. */
kapiKaydet('Onay', async (db, d) => (await muvafakatKilidi(db, d.kimlik) ? 'Teklif onayı için Lehtar muvafakati bekleniyor.' : null));

// YG-476, ONY-11: Mülkiyet ve Takyidat Beyanı; ıslak imzasız YATONET 360 beyanı.
const MULKIYET = ['Malik', 'Finansal kiralama (leasing)', 'Kredi / ipotekli', 'Miras (elbirliği)', 'Paylı'];
const TAKYIDAT = ['Yok', 'Rehin / ipotek', 'Haciz', 'İhtiyati tedbir / ihtiyati haciz', 'Diğer kısıt'];
onayFormKaydet('Mülkiyet Beyanı', async (_db, _t, f) => {
  if (!MULKIYET.includes(f?.mulkiyet)) return 'Mülkiyet türünü seçiniz.';
  if (!Array.isArray(f?.takyidat) || !f.takyidat.length || f.takyidat.some((x: string) => !TAKYIDAT.includes(x))) return 'Takyidat bilgisini seçiniz.';
  if (f.takyidat.includes('Yok') && f.takyidat.length > 1) return '"Yok" seçeneğini tek başına işaretlemenizi rica ederiz.';
  if ((f.mulkiyet !== 'Malik' || f.takyidat.includes('Rehin / ipotek')) && f.mulkiyet !== 'Miras (elbirliği)' && f.mulkiyet !== 'Paylı' && !f.lehtar?.trim()) return 'Lehtar adını yazınız.';
  return null;
});
onaySonucKaydet('ONY-11', async (c, t, karar, k) => {
  if (karar !== 'Onaylandı') return;
  const f = k.form; const yat = (await c.query(`SELECT d.yat_ref, d.dosya_no FROM dosya d WHERE d.kimlik = $1`, [t.dosya_ref])).rows[0];
  await c.query(`UPDATE yat SET mulkiyet_turu = $2, takyidat = $3, lehtar_adi = $4, beyan_zamani = $5, beyan_eden_ref = $6, guncelleme_zamani = now() WHERE kimlik = $1`, [yat.yat_ref, f.mulkiyet, f.takyidat, f.lehtar?.trim() || null, k.zaman, t.alici_kullanici_ref]);
  await izYaz(c, { aktor: t.alici_kullanici_ref, eylem: 'Mülkiyet ve Takyidat Beyanı', nesneTuru: 'Yat', nesneKimligi: yat.yat_ref, yeni: { mulkiyet: f.mulkiyet, takyidat: f.takyidat }, sonuc: 'Başarılı' });
  // YG-104: hacizli veya tedbirli yat Hukuk ve Uyum Direktörünün onayı olmadan taşınmaz; takyidat değerlendirmesi açılır.
  if (f.takyidat.some((x: string) => x === 'Haciz' || x.startsWith('İhtiyati'))) await kartAc(c, { tur: 'Takyidat Değerlendirmesi', baslik: `${yat.dosya_no} · Takyidat Değerlendirmesi`, ozet: f.takyidat.join(', '), oncelik: 'Yüksek', kategori: 'islem', sahipRol: await rolId(c, 'Hukuk ve Uyum Direktörü'), nesneTuru: 'Dosya', nesneKimligi: t.dosya_ref });
  // YG-1463: paylı yatta tek yetkili malik atama adımı.
  if (f.mulkiyet === 'Paylı') await kartAc(c, { tur: 'Eksik Bilgi', kategori: 'gorev', baslik: `${yat.dosya_no} · Yetkili Malik Atanacak`, ozet: 'Paylı yatta malikler tek yetkili malik belirler; onay ve fatura ona gider.', sahipRol: await rolId(c, 'Dosya Sorumlusu'), nesneTuru: 'Dosya', nesneKimligi: t.dosya_ref });
});

/** Dosya açılışında yat sahibine beyan ekranı açılır (YG-476); iletişim veya önceki beyan yoksa açılır. */
export async function beyanIste(c: Db, dosya: string, web: string, hazirlayan: string | null): Promise<boolean> {
  const r = (await c.query(`SELECT d.dosya_no, d.yazisma_dili, y.yat_adi, y.beyan_zamani, t.kimlik AS taraf, t.kisi_adi_soyadi, t.telefon, t.eposta, t.kullanici_ref FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE d.kimlik = $1 LIMIT 1`, [dosya])).rows[0];
  if (!r?.taraf || r.beyan_zamani || (!r.telefon && !r.eposta)) return false;
  if ((await c.query(`SELECT 1 FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-11' AND durum = 'Bekliyor'`, [dosya])).rowCount) return false;
  await onayTalebiAc(c, { dosya, ony: 'ONY-11', dil: r.yazisma_dili === 'İngilizce' ? 'en' : 'tr', alanlar: { Yat: r.yat_adi, Yacht: r.yat_adi }, formTuru: 'Mülkiyet Beyanı', taraf: r.taraf, kullanici: r.kullanici_ref, aliciAd: r.kisi_adi_soyadi, telefon: r.telefon, eposta: r.eposta, belgeAdi: 'Mülkiyet ve Takyidat Beyanı', hazirlayan, webAdresi: web });
  return true;
}

// YG-463, BLD-25: dosya açılınca yat sahibine izleme bağlantısı; ardından beyan ekranı (YG-476).
acilisKancasi(async (c, dosya, web, yapan) => {
  const r = (await c.query(`SELECT d.dosya_no, d.yazisma_dili, t.telefon, t.eposta FROM dosya d JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE d.kimlik = $1 LIMIT 1`, [dosya])).rows[0];
  if (r?.telefon || r?.eposta) await yatTarafinaYaz(c, { olay: `bld25:${dosya}`, kod: 'BLD-25', dil: dilKod(r.yazisma_dili), konu: `${r.dosya_no} YATONET 360`, telefon: r.telefon, eposta: r.eposta, alanlar: { 'Dosya No': r.dosya_no, 'File No': r.dosya_no, 'bağlantı': web, link: web } });
  await beyanIste(c, dosya, web, yapan);
});

export function portalYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const musteri = (g: string, y: FastifyReply) => (MUSTERI_GRUPLARI.includes(g) ? null : y.code(403).send({ hata: 'Bu sayfa yat sahibi ve yetkilisine açıktır.' }));

  // Y1: telefon → kod → bilgiler. Var olan numarada yanıt aynıdır; hesap açma son adımda reddedilir.
  s.post('/kayit/kod', async (i, y) => {
    const { telefon } = (i.body ?? {}) as { telefon?: string };
    const n = kimlikNormalle(telefon ?? '');
    if (!n.telefon) return y.code(400).send({ hata: 'Cep telefonu numarasını başında ülke koduyla giriniz.' });
    const son = await b.db.query(`SELECT 1 FROM kayit_kodu WHERE telefon = $1 AND gonderim_zamani > now() - make_interval(secs => $2)`, [n.telefon, KURAL.smsYenidenGonderimSn]);
    if (son.rowCount) return y.code(429).send({ hata: 'Yeni kod için bir dakika bekleyiniz.' });
    const kod = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await b.db.query(`INSERT INTO kayit_kodu VALUES ($1,$2, now() + make_interval(mins => $3), now(), 0) ON CONFLICT (telefon) DO UPDATE SET kod_ozeti = EXCLUDED.kod_ozeti, son_gecerlilik = EXCLUDED.son_gecerlilik, gonderim_zamani = now(), deneme = 0`, [n.telefon, ozet(n.telefon + kod), KURAL.smsKodGecerlilikDk]);
    await b.sms.gonder(n.telefon, `YATONET 360 doğrulama kodunuz: ${kod}. LGM kod sormaz; kodu kimseyle paylaşmayınız.`);
    return { gonderildi: true };
  });

  s.post('/kayit/tamamla', async (i, y) => {
    const g = (i.body ?? {}) as { telefon?: string; kod?: string; ad?: string; eposta?: string; dil?: string };
    const n = kimlikNormalle(g.telefon ?? '');
    if (!n.telefon) return y.code(400).send({ hata: 'Telefon geçersiz.' });
    if (!g.ad?.trim()) return y.code(400).send({ hata: 'Ad soyad zorunludur.' });
    if (g.eposta && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.eposta)) return y.code(400).send({ hata: 'E-posta adresi geçersiz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      const r = (await c.query(`SELECT * FROM kayit_kodu WHERE telefon = $1 FOR UPDATE`, [n.telefon])).rows[0];
      if (!r || new Date(r.son_gecerlilik) <= new Date() || r.deneme >= 5) return dur(401, 'Doğrulama kodu hatalı veya süresi dolmuş.');
      if (ozet(n.telefon + String(g.kod ?? '')) !== r.kod_ozeti) { await c.query(`UPDATE kayit_kodu SET deneme = deneme + 1 WHERE telefon = $1`, [n.telefon]); await c.query('COMMIT'); return y.code(401).send({ hata: 'Doğrulama kodu hatalı veya süresi dolmuş.' }); }
      if ((await c.query(`SELECT 1 FROM kullanici_hesabi WHERE cep_telefonu = $1`, [n.telefon])).rowCount) return dur(409, 'Bu numarayla hesabınız vardır; giriş yapınız.');
      if (g.eposta && (await c.query(`SELECT 1 FROM kullanici_hesabi WHERE lower(e_posta) = lower($1)`, [g.eposta])).rowCount) return dur(409, 'Bu e-postayla hesap vardır; giriş yapınız.');
      const h = (await c.query(
        `INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, dogrulama_yontemi, tercih_dili) VALUES ('Müşteri/Kurum',$1,$2,$3,$4,$3,'SMS kodu',$5) RETURNING kimlik`,
        [GRUP_YAT, g.ad.trim(), n.telefon, g.eposta?.trim() || null, g.dil === 'en' ? 'İngilizce' : 'Türkçe'])).rows[0];
      await c.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) VALUES ($1,$2)`, [h.kimlik, await rolId(c, 'Müşteri Portal Kullanıcısı')]);
      await c.query(`DELETE FROM kayit_kodu WHERE telefon = $1`, [n.telefon]);
      // YG-463: ihbarda girilen numara hesabı açınca dosya kendiliğinden görünür.
      await c.query(`UPDATE taraf SET kullanici_ref = $2 WHERE telefon = $1 AND kullanici_ref IS NULL`, [n.telefon, h.kimlik]);
      await c.query(`UPDATE dosya_tarafi SET kullanici_ref = $2 WHERE telefon = $1 AND kullanici_ref IS NULL AND taraf_rolu = 'Yat Sahibi'`, [n.telefon, h.kimlik]);
      await c.query(`UPDATE onay_talebi SET alici_kullanici_ref = $2 WHERE telefon = $1 AND alici_kullanici_ref IS NULL AND durum = 'Bekliyor'`, [n.telefon, h.kimlik]);
      const bel = rastgeleBelirtec();
      await c.query(`INSERT INTO oturum (kullanici_ref, belirtec_ozeti, asama, azami_bitis_zamani, son_islem_zamani, kaynak_adres) VALUES ($1,$2,'Tamam', now() + make_interval(hours => $3), now(), $4)`, [h.kimlik, ozet(bel), KURAL.azamiOturumSaat, i.ip.slice(0, 100)]);
      await izYaz(c, { aktor: h.kimlik, eylem: 'Yat Sahibi Hesabı Açıldı', nesneTuru: 'Kullanıcı', nesneKimligi: h.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      cerezYaz(y, b, bel);
      return { tamam: true };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-463: parolası olmayan yat sahibi telefon ve SMS koduyla girer. Yanıt hesabın varlığını açık etmez.
  s.post('/kimlik/telefon', async (i, y) => {
    const n = kimlikNormalle(String(((i.body ?? {}) as { telefon?: string }).telefon ?? ''));
    if (!n.telefon) return y.code(400).send({ hata: 'Cep telefonu numarasını başında ülke koduyla giriniz.' });
    const h = (await b.db.query(`SELECT * FROM kullanici_hesabi WHERE cep_telefonu = $1 AND parola_ozeti IS NULL AND kullanici_grubu = $2 AND hesap_durumu = 'Aktif'`, [n.telefon, GRUP_YAT])).rows[0];
    if (!h) return { asama: 'kod', yontem: 'sms', kurulumGerekli: false, smsAcik: false };
    const bel = rastgeleBelirtec();
    const o = (await b.db.query(`INSERT INTO oturum (kullanici_ref, belirtec_ozeti, asama, azami_bitis_zamani, kaynak_adres) VALUES ($1,$2,'Kod Bekliyor', now() + make_interval(mins => $3), $4) RETURNING kimlik`, [h.kimlik, ozet(bel), KURAL.kodAsamasiDk, i.ip.slice(0, 100)])).rows[0];
    cerezYaz(y, b, bel);
    const kod = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await b.db.query(`INSERT INTO sms_kodu (oturum_ref, kod_ozeti, son_gecerlilik) VALUES ($1,$2, now() + make_interval(mins => $3))`, [o.kimlik, ozet(o.kimlik + kod), KURAL.smsKodGecerlilikDk]);
    await b.sms.gonder(n.telefon, `YATONET 360 doğrulama kodunuz: ${kod}. LGM kod sormaz; kodu kimseyle paylaşmayınız.`);
    return { asama: 'kod', yontem: 'sms', kurulumGerekli: false, smsAcik: true };
  });

  // YG-1449: muvafakati yat sahibi değil Dosya Sorumlusu girer; ONY-13 durumu yat sahibine görünür.
  s.post('/dosya/:id/muvafakat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { belge } = (i.body ?? {}) as { belge?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return y.code(404).send({ hata: 'Dosya bulunamadı veya erişim yetkiniz yok.' });
    if (!belge || !UUID.test(belge) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2`, [belge, id])).rowCount) return y.code(400).send({ hata: 'Muvafakat belgesini dosyaya yükleyip seçiniz.' });
    await b.db.query(`UPDATE yat SET lehtar_muvafakati_ref = $2, guncelleme_zamani = now() WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [id, belge]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Lehtar Muvafakati Girildi', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  const benimDosyalarim = `EXISTS (SELECT 1 FROM dosya_tarafi t WHERE t.dosya_ref = d.kimlik AND t.kullanici_ref = $1 AND t.aktif AND t.taraf_rolu IN ('Yat Sahibi', 'Yetkili Temsilci', 'Kaptan', 'İşletmeci', 'Yat Yönetim Şirketi'))`;
  const kart = async (d: Record<string, any>) => {
    const bek = (await b.db.query(`SELECT neden FROM beklemede_isareti WHERE dosya_ref = $1 AND kaldirilma_zamani IS NULL`, [d.kimlik])).rows.map((r) => r.neden as string);
    const durum = musteriDurumu(d as never, { beklemede: bek });
    return { kimlik: d.kimlik, dosyaNo: d.dosya_no, yat: d.yat_adi, durum: durum.ad, renk: durum.renk, ilerleme: Number(d.ilerleme_yuzdesi), acilis: d.acilis_tarihi, dosyaSorumlusu: d.dosya_sorumlusu ?? null };
  };

  // YG-1565: Onayınızı Bekleyenler, Dosyalarım. YG-459: firma, maliyet ve iç yazışma yoktur.
  s.get('/portal/ana', oturumlu, async (i, y) => {
    const o = i.oturum!; const red = musteri(o.grup, y); if (red) return red;
    const dosyalar = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.statu, d.asama, d.ilerleme_yuzdesi, d.acilis_tarihi, y.yat_adi, h.ad_soyad AS dosya_sorumlusu FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref WHERE d.birlestirilen_ana_dosya_ref IS NULL AND ${benimDosyalarim} ORDER BY d.statu = 'Kapalı', d.acilis_tarihi DESC`, [o.kullanici])).rows;
    const talepler = (await b.db.query(`SELECT t.kimlik, t.talep_no, t.statu, t.kayda_gecis_zamani, y.yat_adi FROM talep t JOIN yat y ON y.kimlik = t.yat_ref WHERE t.olusturan_ref = $1 AND t.dosya_ref IS NULL AND t.statu NOT IN ('Birleştirildi', 'Kapsam Dışı / Yönlendirme') ORDER BY t.kayda_gecis_zamani DESC`, [o.kullanici])).rows;
    const onaylar = (await b.db.query(`SELECT t.kimlik, t.baslik, t.belge_adi, t.son_gecerlilik, d.dosya_no FROM onay_talebi t LEFT JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.alici_kullanici_ref = $1 AND t.durum = 'Bekliyor' AND t.son_gecerlilik > now() ORDER BY t.olusturma_zamani DESC`, [o.kullanici])).rows;
    return { onaylar, dosyalar: await Promise.all(dosyalar.map(kart)), talepler: talepler.map((t) => ({ kimlik: t.kimlik, dosyaNo: t.talep_no, yat: t.yat_adi, durum: 'Talebiniz Alındı', renk: 'yeşil', zaman: t.kayda_gecis_zamani })) };
  });

  s.get('/portal/dosya/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const red = musteri(o.grup, y); if (red) return red;
    if (!UUID.test(id)) return y.code(404).send({ hata: 'Dosya bulunamadı.' });
    const d = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.statu, d.asama, d.ilerleme_yuzdesi, d.acilis_tarihi, y.yat_adi, h.ad_soyad AS dosya_sorumlusu FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref WHERE d.kimlik = $2 AND ${benimDosyalarim}`, [o.kullanici, id])).rows[0];
    if (!d) return y.code(404).send({ hata: 'Dosya bulunamadı.' });
    const belgeler = (await b.db.query(`SELECT e.kimlik, e.ad, s.surum_no FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik WHERE e.bag_turu = 'Dosya' AND e.bag_kimligi = $1 AND s.durum = 'Yürürlükte' AND e.bilgi_sinifi <> 'Kritik' ORDER BY e.olusturma_zamani DESC`, [id])).rows;
    return { ...(await kart(d)), belgeler };
  });

  // Portal kullanıcısının bekleyen onayı: bağlantıyı kaybetse de hesabından açar (YG-465).
  s.post('/portal/onay/:id/ac', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'Onay bulunamadı.' });
    const bel = rastgeleBelirtec();
    const r = await b.db.query(`UPDATE onay_talebi SET portal_belirtec_ozeti = $3 WHERE kimlik = $1 AND alici_kullanici_ref = $2 AND durum = 'Bekliyor' RETURNING kimlik`, [id, o.kullanici, ozet(bel)]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Onay bulunamadı.' });
    return { belirtec: bel };
  });

  // YG-011, YG-1553, YG-1562: portal kısa formu; hasar içerikli talep Operasyona düşer. YG-485: aydınlatma ilk girişte onaylandı.
  s.post('/portal/ihbar', oturumlu, async (i, y) => {
    const o = i.oturum!; const red = musteri(o.grup, y); if (red) return red;
    const g = (i.body ?? {}) as { yatAdi?: string; konum?: string; ozet?: string; sigorta?: string; sigortaci?: string; hasarNo?: string; tur?: 'Hasar' | 'Talep' };
    if (!g.yatAdi?.trim()) return y.code(400).send({ hata: 'Yatın adı zorunludur.' });
    if (!g.konum?.trim()) return y.code(400).send({ hata: 'Yatın bulunduğu yer zorunludur.' });
    if (!g.ozet?.trim()) return y.code(400).send({ hata: 'Olay özeti zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const h = (await c.query(`SELECT ad_soyad, cep_telefonu, e_posta, tercih_dili FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
      let sahip = (await c.query(`SELECT kimlik FROM taraf WHERE kullanici_ref = $1 LIMIT 1`, [o.kullanici])).rows[0];
      if (!sahip) sahip = (await c.query(`INSERT INTO taraf (taraf_no, kisi_turu, musteri_turu, unvan_ad_soyad, telefon, eposta, taraf_rolleri, kullanici_ref, olusturan_ref) VALUES ($1,'Gerçek kişi','Bireysel Müşteri',$2,$3,$4,'{Yat Sahibi}',$5,$5) RETURNING kimlik`, [await tarafNo(c), h.ad_soyad, h.cep_telefonu, h.e_posta, o.kullanici])).rows[0];
      const yat = (await c.query(`SELECT kimlik FROM yat WHERE yat_sahibi_ref = $1 AND lower(yat_adi) = lower($2) LIMIT 1`, [sahip.kimlik, g.yatAdi.trim()])).rows[0];
      // YG-1553: mesai içinde Operasyon Müdürü kuyruğu. Mesai dışı nöbetçi Dosya Sorumlusu Nöbet modülüyle gelir.
      const ilk = (await rolSahipleri(c, await rolId(c, 'Operasyon Müdürü')))[0] ?? o.kullanici;
      const r = await ihbarKaydet(c, {
        kanal: 'Portal', sahibiAdi: h.ad_soyad, sahibiTuru: 'Yat Sahibi', telefon: h.cep_telefonu ?? undefined, eposta: h.e_posta ?? undefined, konum: g.konum, yatDurumu: 'Beyan edilmedi', ihtiyac: g.ozet,
        yat: yat ? { yatId: yat.kimlik } : { adi: g.yatAdi, markaDiger: '', modelDiger: '' }, sigortaci: g.sigorta === 'Türkiye\'de Sigortalı' ? g.sigortaci : undefined, hasarNo: g.hasarNo, dil: h.tercih_dili, oncelik: 'Normal', cevaplar: {},
      }, o.kullanici, { ilkSorumlu: ilk });
      if ('hata' in r) { await c.query('ROLLBACK'); return y.code(400).send({ hata: r.hata }); }
      if (!yat) await c.query(`UPDATE yat SET yat_sahibi_ref = $1 WHERE kimlik = (SELECT yat_ref FROM talep WHERE kimlik = $2)`, [sahip.kimlik, r.kimlik]);
      await ihbarAlindiGonder(c, r.kimlik, b.webAdresi);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Portal İhbarı', nesneTuru: 'Talep', nesneKimligi: r.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, talepNo: r.talepNo };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}

