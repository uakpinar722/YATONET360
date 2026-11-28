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
import { onayEngeli, talepEngeli } from './kurumsal.js';
import { metinGetir } from './metin.js';
import { beklemeNotu } from './bekleme_muhafaza.js';

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

/**
 * YG-1564: müşteri durumunu besleyen göstergeler: cayma (yasal bekleme) süresi; ek bulgu bildirimi (BLD-04) yapılmış ve durdurulmuş iş emri;
 * teknik kapanış sonrası açık iş emri; başlamış (Aktif, Tamamlandı veya Durduruldu) iş emri.
 */
export async function musteriGostergeleri(db: Db, dosya: string, beklemede: string[]) {
  const { caymaEngeli } = await import('./teklif.js');
  const r = (await db.query(`SELECT
      EXISTS (SELECT 1 FROM is_emri e WHERE e.dosya_ref = $1 AND e.statu = 'Durduruldu' AND EXISTS (SELECT 1 FROM zamanlanmis_is z WHERE z.ad = 'bld04' AND z.anahtar = e.kimlik::text)) ek,
      EXISTS (SELECT 1 FROM is_emri e WHERE e.dosya_ref = $1 AND e.statu IN ('Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif', 'Çekinceli', 'Durduruldu')) acik,
      EXISTS (SELECT 1 FROM is_emri e WHERE e.dosya_ref = $1 AND e.statu IN ('Aktif', 'Tamamlandı', 'Durduruldu', 'Kapalı')) basladi`, [dosya])).rows[0];
  const cayma = await caymaEngeli(db, dosya);
  return { beklemede, yasalBekleme: Boolean(cayma) && !cayma!.includes('kullanmıştır'), ekBulgu: Boolean(r.ek), acikIs: Boolean(r.acik), isBasladi: Boolean(r.basladi) };
}

belgeBagiKaydet('Talep', async (db, k, id) => {
  if (!UUID.test(id)) return 'yok';
  const r = (await db.query(`SELECT olusturan_ref, olusturma_zamani FROM talep WHERE kimlik = $1`, [id])).rows[0];
  if (!r) return 'yok';
  if (r.olusturan_ref === k) return 'tamam';
  // YG-017: ihbar kaydetme yetkisi olan LGM personeli ihbara ilk fotoğrafları ekler ve görür.
  const { kullaniciIzinleri } = await import('./yetki.js');
  return (await kullaniciIzinleri(db as Pool, k)).includes('ihbar.kaydet') ? 'tamam' : 'yetkisiz';
});

/** YG-103, YG-476: lehtar varsa muvafakat girilmeden teklif onayı açılmaz; kilit yalnız teklif onayını durdurur. */
export async function muvafakatKilidi(db: Db, dosya: string): Promise<boolean> {
  const y = (await db.query(`SELECT y.lehtar_adi, y.lehtar_ref, y.lehtar_muvafakati_ref FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  return Boolean(y && (y.lehtar_adi || y.lehtar_ref) && !y.lehtar_muvafakati_ref);
}

/** YG-1468 sonrası kapı: mülkiyet beyanı olmadan da teklif hazırlanır, onay aşamasında kilit devreye girer. */
kapiKaydet('Onay', async (db, d) => (await muvafakatKilidi(db, d.kimlik) ? 'Teklif onayı için Lehtar muvafakati bekleniyor.' : null));
// YG-1439 (V-1147, K-170): zorunlu belgesi eksik dosya teklif onayı aşamasına geçmez; lehtar muvafakati yukarıdaki kapıyla durur.
kapiKaydet('Onay', async (db, d) => {
  const e = (await belgeListesi(db, d.kimlik)).filter((x) => x.durum === 'Eksik' && x.belge !== 'Lehtar Muvafakati').map((x) => x.belge);
  return e.length ? `Teklif onayına geçmek için eksik belge: ${e.join(', ')}.` : null;
});

// YG-476, ONY-11: Mülkiyet ve Takyidat Beyanı; ıslak imzasız YATONET 360 beyanı.
const MULKIYET = ['Malik', 'Finansal kiralama (leasing)', 'Kredi / ipotekli', 'Miras (elbirliği)', 'Paylı'];
const TAKYIDAT = ['Yok', 'Rehin / ipotek', 'Haciz', 'İhtiyati tedbir / ihtiyati haciz', 'Diğer kısıt'];
onayFormKaydet('Mülkiyet Beyanı', async (_db, _t, f) => {
  if (!MULKIYET.includes(f?.mulkiyet)) return 'Mülkiyet türünü seçiniz.';
  if (!Array.isArray(f?.takyidat) || !f.takyidat.length || f.takyidat.some((x: string) => !TAKYIDAT.includes(x))) return 'Takyidat bilgisini seçiniz.';
  if (f.takyidat.includes('Yok') && f.takyidat.length > 1) return '"Yok" seçeneğini tek başına işaretlemenizi rica ederiz.';
  if ((f.mulkiyet !== 'Malik' || f.takyidat.includes('Rehin / ipotek')) && f.mulkiyet !== 'Miras (elbirliği)' && f.mulkiyet !== 'Paylı' && !f.lehtar?.trim()) return f.mulkiyet === 'Finansal kiralama (leasing)' ? 'Kiralayan (leasing) şirketinin adını yazınız.' : 'Lehtar adını yazınız.';
  if (f.mulkiyet !== 'Finansal kiralama (leasing)' && f.malikDegil && !String(f.malikAdi ?? '').trim()) return 'Yat belgesinde malik olarak yazılı kişinin adını yazınız.'; // YG-103
  return null;
});
onaySonucKaydet('ONY-11', async (c, t, karar, k) => {
  if (karar !== 'Onaylandı') return;
  const f = k.form; const yat = (await c.query(`SELECT d.yat_ref, d.dosya_no FROM dosya d WHERE d.kimlik = $1`, [t.dosya_ref])).rows[0];
  await c.query(`UPDATE yat SET mulkiyet_turu = $2, takyidat = $3, lehtar_adi = $4, beyan_zamani = $5, beyan_eden_ref = $6, guncelleme_zamani = now() WHERE kimlik = $1`, [yat.yat_ref, f.mulkiyet, f.takyidat, f.lehtar?.trim() || null, k.zaman, t.alici_kullanici_ref]);
  await izYaz(c, { aktor: t.alici_kullanici_ref, eylem: 'Mülkiyet ve Takyidat Beyanı', nesneTuru: 'Yat', nesneKimligi: yat.yat_ref, yeni: { mulkiyet: f.mulkiyet, takyidat: f.takyidat }, sonuc: 'Başarılı' });
  // YG-1446: lehtar beyan edilmiş ve muvafakat yoksa BLD-07 ile muvafakat belgesi istenir.
  if (await muvafakatKilidi(c, t.dosya_ref)) {
    const s = (await c.query(`SELECT d.yazisma_dili, d.vefat_isareti, y.yat_adi, x.telefon, x.eposta FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_tarafi x ON x.dosya_ref = d.kimlik AND x.taraf_rolu = 'Yat Sahibi' AND x.aktif WHERE d.kimlik = $1 LIMIT 1`, [t.dosya_ref])).rows[0];
    if (s && !s.vefat_isareti && (s.telefon || s.eposta)) await yatTarafinaYaz(c, { olay: `bld07:${t.dosya_ref}`, kod: 'BLD-07', dil: dilKod(s.yazisma_dili), konu: `${yat.dosya_no} Muvafakat`, telefon: s.telefon, eposta: s.eposta, alanlar: { Yat: s.yat_adi, Yacht: s.yat_adi, Lehtar: f.lehtar.trim(), 'Loss payee': f.lehtar.trim(), 'Dosya No': yat.dosya_no } });
  }
  // YG-103, V-1117: leasingde beyan eden kiracıdır, malik (kiralayan) ayrı malik kaydıdır; malik ile kullanan farklıysa taraf yat belgesindeki malik olmalıdır.
  { const leasing = f.mulkiyet === 'Finansal kiralama (leasing)'; const kullanan = !leasing && Boolean(f.malikDegil);
    const malikAdi = leasing ? f.lehtar?.trim() : kullanan ? String(f.malikAdi).trim() : null;
    await c.query(`UPDATE yat SET beyan_eden_sifati = $2 WHERE kimlik = $1`, [yat.yat_ref, leasing ? 'Kiracı' : kullanan ? 'Kullanan' : 'Malik']);
    const ekleyen = t.alici_kullanici_ref ?? (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [t.dosya_ref])).rows[0]?.r;
    if (malikAdi && ekleyen && !(await c.query(`SELECT 1 FROM yat_malik WHERE yat_ref = $1 AND lower(ad) = lower($2)`, [yat.yat_ref, malikAdi])).rowCount) await c.query(`INSERT INTO yat_malik (yat_ref, ad, ekleyen_ref) VALUES ($1,$2,$3)`, [yat.yat_ref, malikAdi, ekleyen]);
    if (kullanan) await kartAc(c, { tur: 'Eksik Bilgi', kategori: 'gorev', baslik: `${yat.dosya_no} · Taraf Yat Belgesindeki Malik Olmalı`, ozet: `Beyanı veren yatı kullanan kişidir; yat belgesindeki malik (${malikAdi}) dosyada taraf olarak kaydedilmeli ve onaylar ona yöneltilmelidir.`, sahipRol: await rolId(c, 'Dosya Sorumlusu'), nesneTuru: 'Dosya', nesneKimligi: t.dosya_ref }); }
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

/**
 * YG-1439: istenecek belge listesi sistemce oluşur. Genel: ruhsat/tonilato veya tescil belgesi; gerçek kişide kimlik, şirkette imza sirküleri ve vergi levhası; varsa olay fotoğrafları.
 * Yata özel: klaslıysa klas sertifikası; ihbarı yat sahibi dışında biri yaptıysa vekâletname veya Yetkili Temsilci Beyanı; lehtar varsa lehtar muvafakati.
 * Poliçe, ekspertiz raporu, ticari kullanım belgesi ve Transit Log istenmez (gönderilirse girilir). Sigortalı dosyada belge yerine yalnız hasar dosya no istenir.
 */
export async function belgeListesi(db: Pool | PoolClient, dosya: string) {
  const d = (await db.query(`SELECT d.musteri_turu, coalesce((SELECT k.sigorta_hasar_dosya_no FROM dosya_sigorta_kaydi k WHERE k.dosya_ref = d.kimlik AND k.sigorta_hasar_dosya_no IS NOT NULL LIMIT 1), (SELECT t.sigorta_hasar_dosya_no_beyan FROM talep t WHERE t.dosya_ref = d.kimlik LIMIT 1)) sigorta_hasar_dosya_no, y.klas_durumu, y.lehtar_adi, y.lehtar_ref, y.lehtar_muvafakati_ref, s.kisi_turu,
      (SELECT t.talep_sahibi_turu FROM talep t WHERE t.dosya_ref = d.kimlik ORDER BY t.olusturma_zamani LIMIT 1) ihbar_eden
    FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN taraf s ON s.kimlik = y.yat_sahibi_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (!d) return [];
  const yuklu = (await db.query(`SELECT lower(coalesce(belge_turu, '') || ' ' || ad) a FROM belge WHERE bag_turu = 'Dosya' AND bag_kimligi::text = $1`, [dosya])).rows.map((r) => r.a as string);
  const var_ = (...k: string[]) => yuklu.some((a) => k.some((x) => a.includes(x)));
  const tuzel = /tüzel|şirket/i.test(d.kisi_turu ?? '');
  const l: { belge: string; grup: 'Genel' | 'Yata Özel'; zorunlu: boolean; durum: string }[] = [];
  const ekle = (belge: string, grup: 'Genel' | 'Yata Özel', zorunlu: boolean, var__: boolean) => l.push({ belge, grup, zorunlu, durum: var__ ? 'Alındı' : zorunlu ? 'Eksik' : 'Varsa' });
  ekle('Ruhsat / Tonilato veya Tescil Belgesi', 'Genel', true, var_('ruhsat', 'tonilato', 'tescil'));
  if (tuzel) { ekle('İmza Sirküleri', 'Genel', true, var_('imza sirk')); ekle('Vergi Levhası', 'Genel', true, var_('vergi levha')); }
  else ekle('Kimlik', 'Genel', true, var_('kimlik', 'pasaport'));
  ekle('Olay Fotoğrafları', 'Genel', false, var_('fotoğraf', 'foto'));
  if (d.klas_durumu === 'Evet') ekle('Klas Sertifikası', 'Yata Özel', true, var_('klas'));
  if (d.ihbar_eden && !['Yat Sahibi', 'Sigorta Şirketi'].includes(d.ihbar_eden)) ekle('Vekâletname veya Yetkili Temsilci Beyanı', 'Yata Özel', true, var_('vekâlet', 'vekalet', 'yetkili temsilci'));
  if (d.lehtar_adi || d.lehtar_ref) l.push({ belge: 'Lehtar Muvafakati', grup: 'Yata Özel', zorunlu: true, durum: d.lehtar_muvafakati_ref ? 'Alındı' : 'Eksik' });
  if (d.musteri_turu === 'Sigorta Şirketi') l.push({ belge: 'Sigorta Hasar Dosya No', grup: 'Yata Özel', zorunlu: true, durum: d.sigorta_hasar_dosya_no ? 'Alındı' : 'Eksik' });
  return l;
}

export function portalYollari(s: FastifyInstance, b: Baglam) {
  s.get('/dosya/:id/belge-listesi', { preHandler: tamOturumGerekli(b) }, async (i, y) => { // YG-1439
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    return belgeListesi(b.db, id);
  });
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
    // Yeni kayıtta e-posta henüz yoktur; SMS kesintisinde destek hattına yönlendirilir (V-258).
    if (!(await (await import('./bildirim.js')).girisKoduGonder(b, n.telefon, null, `YATONET 360 doğrulama kodunuz: ${kod}. LGM kod sormaz; kodu kimseyle paylaşmayınız.`))) return y.code(503).send({ hata: 'SMS şu anda gönderilemiyor. 7/24 Destek Hattımızı aramanızı rica ederiz.' });
    return { gonderildi: true };
  });

  s.post('/kayit/tamamla', async (i, y) => {
    const g = (i.body ?? {}) as { telefon?: string; kod?: string; ad?: string; eposta?: string; dil?: string; yetkili?: { rol?: string; sahipAd?: string; sahipTelefon?: string; sahipEposta?: string } };
    const n = kimlikNormalle(g.telefon ?? '');
    if (!n.telefon) return y.code(400).send({ hata: 'Telefon geçersiz.' });
    if (!g.ad?.trim()) return y.code(400).send({ hata: 'Ad soyad zorunludur.' });
    if (g.eposta && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.eposta)) return y.code(400).send({ hata: 'E-posta adresini kontrol etmenizi rica ederiz.' });
    const st = g.yetkili ? kimlikNormalle(g.yetkili.sahipTelefon ?? '') : null; // YG-1561
    if (g.yetkili && (!['Yatın Kaptanı', 'Yat Sahibinin Yetkili Temsilcisi', 'Yat Yönetim Şirketi / İşletmeci', 'Sigorta Brokeri', 'Sigorta Acentesi', 'Yat Brokeri', 'Diğer'].includes(g.yetkili.rol ?? '') || !g.yetkili.sahipAd?.trim() || !st?.telefon)) return y.code(400).send({ hata: 'Rolünüzü ve yat sahibinin adı ile telefonunu girmenizi rica ederiz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      const r = (await c.query(`SELECT * FROM kayit_kodu WHERE telefon = $1 FOR UPDATE`, [n.telefon])).rows[0];
      if (!r || new Date(r.son_gecerlilik) <= new Date() || r.deneme >= 5) return dur(401, 'Doğrulama kodu hatalı veya süresi dolmuş.');
      if (ozet(n.telefon + String(g.kod ?? '')) !== r.kod_ozeti) { await c.query(`UPDATE kayit_kodu SET deneme = deneme + 1 WHERE telefon = $1`, [n.telefon]); await c.query('COMMIT'); return y.code(401).send({ hata: 'Doğrulama kodu hatalı veya süresi dolmuş.' }); }
      if ((await c.query(`SELECT 1 FROM kullanici_hesabi WHERE cep_telefonu = $1`, [n.telefon])).rowCount) return dur(409, 'Bu numarayla hesabınız vardır; giriş yapınız.');
      if (g.eposta && (await c.query(`SELECT 1 FROM kullanici_hesabi WHERE lower(e_posta COLLATE "C") = lower($1 COLLATE "C")`, [g.eposta])).rowCount) return dur(409, 'Bu e-postayla hesap vardır; giriş yapınız.');
      const h = (await c.query(
        `INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, dogrulama_yontemi, tercih_dili) VALUES ('Müşteri/Kurum',$1,$2,$3,$4,$3,'SMS kodu',$5) RETURNING kimlik`,
        [GRUP_YAT, g.ad.trim(), n.telefon, g.eposta?.trim() || null, g.dil === 'en' ? 'İngilizce' : 'Türkçe'])).rows[0];
      await c.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) VALUES ($1,$2)`, [h.kimlik, await rolId(c, 'Müşteri Portal Kullanıcısı')]);
      await c.query(`DELETE FROM kayit_kodu WHERE telefon = $1`, [n.telefon]);
      if (g.yetkili) await c.query(`INSERT INTO yat_yetkilisi_kaydi (kullanici_ref, rol, sahip_ad, sahip_telefon, sahip_eposta) VALUES ($1,$2,$3,$4,$5)`, [h.kimlik, g.yetkili.rol, g.yetkili.sahipAd!.trim(), st!.telefon, g.yetkili.sahipEposta?.trim() || null]);
      // YG-463: ihbarda girilen numara hesabı açınca dosya kendiliğinden görünür.
      await c.query(`UPDATE taraf SET kullanici_ref = $2 WHERE telefon = $1 AND kullanici_ref IS NULL`, [n.telefon, h.kimlik]);
      await c.query(`UPDATE dosya_tarafi SET kullanici_ref = $2 WHERE telefon = $1 AND kullanici_ref IS NULL AND taraf_rolu = 'Yat Sahibi'`, [n.telefon, h.kimlik]);
      await c.query(`UPDATE onay_talebi SET alici_kullanici_ref = $2 WHERE telefon = $1 AND alici_kullanici_ref IS NULL AND durum = 'Bekliyor'`, [n.telefon, h.kimlik]);
      const bel = rastgeleBelirtec();
      await c.query(`INSERT INTO oturum (kullanici_ref, belirtec_ozeti, asama, azami_bitis_zamani, son_islem_zamani, kaynak_adres) VALUES ($1,$2,'Tamam', now() + make_interval(hours => $3), now(), $4)`, [h.kimlik, ozet(bel), KURAL.azamiOturumSaat, i.ip.slice(0, 100)]);
      await izYaz(c, { aktor: h.kimlik, eylem: 'Yat Sahibi Hesabı Açıldı', nesneTuru: 'Kullanıcı', nesneKimligi: h.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      if (g.yetkili) { // YG-1561, YY-M1: gönderim kaydı engellemez, gitmezse zaman boş kalır.
        try {
          const en = !st!.telefon!.startsWith('+90'); // YG-1896
          const rolEn: Record<string, string> = { 'Yatın Kaptanı': 'Captain of the Yacht', 'Yat Sahibinin Yetkili Temsilcisi': "Owner's Authorized Representative", 'Yat Yönetim Şirketi / İşletmeci': 'Yacht Management Company / Operator', 'Sigorta Brokeri': 'Insurance Broker', 'Sigorta Acentesi': 'Insurance Agent', 'Yat Brokeri': 'Yacht Broker', 'Diğer': 'Authorized Person' };
          await b.sms.gonder(st!.telefon!, await metinGetir(b.db, 'BLD-88', en ? 'en' : 'tr', en ? { 'Full Name': g.ad.trim(), Role: rolEn[g.yetkili.rol!]! } : { 'Ad Soyad': g.ad.trim(), Rol: g.yetkili.rol! }));
          await b.db.query(`UPDATE yat_yetkilisi_kaydi SET sahip_bilgilendirme_zamani = now() WHERE kullanici_ref = $1`, [h.kimlik]);
        } catch (e) { i.log.error(e); }
      }
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
    const kanal = await (await import('./bildirim.js')).girisKoduGonder(b, n.telefon, h.e_posta, `YATONET 360 doğrulama kodunuz: ${kod}. LGM kod sormaz; kodu kimseyle paylaşmayınız.`);
    if (!kanal) return y.code(503).send({ hata: 'SMS şu anda gönderilemiyor. 7/24 Destek Hattımızı aramanızı rica ederiz.' });
    return { asama: 'kod', yontem: 'sms', kurulumGerekli: false, smsAcik: true, kanal };
  });

  // YG-1449: muvafakati yat sahibi değil Dosya Sorumlusu girer; ONY-13 durumu yat sahibine görünür.
  s.post('/dosya/:id/muvafakat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { belge } = (i.body ?? {}) as { belge?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return y.code(404).send({ hata: 'Dosya bulunamadı veya erişim yetkiniz yok.' });
    if (!belge || !UUID.test(belge) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2`, [belge, id])).rowCount) return y.code(400).send({ hata: 'Muvafakat belgesini dosyaya yükleyip seçiniz.' });
    if (await (await import('./belge_kural.js')).bilgiBelgesiMi(b.db, belge)) return y.code(409).send({ hata: (await import('./belge_kural.js')).BILGI_HATA }); // YG-622
    // YG-214: muvafakat kilidini yalnız dosyanın Dosya Sorumlusu açar.
    if (!(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND dosya_sorumlusu_ref = $2`, [id, o.kullanici])).rowCount) return y.code(403).send({ hata: 'Lehtar muvafakatini dosyanın Dosya Sorumlusu girer.' });
    await b.db.query(`UPDATE yat SET lehtar_muvafakati_ref = $2, guncelleme_zamani = now() WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [id, belge]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Lehtar Muvafakati Girildi', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  const benimDosyalarim = `EXISTS (SELECT 1 FROM dosya_tarafi t WHERE t.dosya_ref = d.kimlik AND t.kullanici_ref = $1 AND t.aktif AND t.taraf_rolu IN ('Yat Sahibi', 'Yetkili Temsilci', 'Kaptan', 'İşletmeci', 'Yat Yönetim Şirketi')) OR EXISTS (SELECT 1 FROM kurumsal_kullanici u JOIN kurumsal_kurum c ON c.kimlik = u.kurum_ref JOIN yat ky ON ky.yat_sahibi_ref = c.taraf_ref WHERE u.kullanici_ref = $1 AND ky.kimlik = d.yat_ref)`;
  const kart = async (d: Record<string, any>, kim?: string) => {
    const bek = (await b.db.query(`SELECT neden FROM beklemede_isareti WHERE dosya_ref = $1 AND kaldirilma_zamani IS NULL`, [d.kimlik])).rows.map((r) => r.neden as string);
    const durum = musteriDurumu(d as never, await musteriGostergeleri(b.db, d.kimlik, bek)); // YG-1564
    // YG-1565: sonraki adım; yat sahibinden beklenen iş varsa o, yoksa LGM tarafındaki adım.
    const onayBek = (await b.db.query(`SELECT 1 FROM onay_talebi WHERE dosya_ref = $1 AND alici_kullanici_ref = $2 AND durum = 'Bekliyor' AND son_gecerlilik > now() LIMIT 1`, [d.kimlik, kim ?? null])).rowCount;
    const mesajBek = (await b.db.query(`SELECT 1 FROM dosya_yazismasi WHERE dosya_ref = $1 AND dis_taraf_ref = $2 AND lgm AND okunma_zamani IS NULL LIMIT 1`, [d.kimlik, kim ?? null])).rowCount;
    const sonrakiAdim = durum.renk === 'gri' ? 'Dosya tamamlanmıştır.' : onayBek ? 'Onayınızı bekleyen belge bulunmaktadır.' : mesajBek ? 'Dosya Sorumlunuzdan yanıtlanmamış mesajınız bulunmaktadır.' : bek.length ? 'Beklenen bilgi veya belge için Dosya Sorumlunuz sizinle iletişime geçecektir.' : 'Dosyanızda LGM ekibinin çalışması sürmektedir.';
    return { kimlik: d.kimlik, dosyaNo: d.dosya_no, yat: d.yat_adi, durum: durum.ad, renk: durum.renk, ilerleme: Number(d.ilerleme_yuzdesi), acilis: d.acilis_tarihi, dosyaSorumlusu: d.dosya_sorumlusu ?? null, sonrakiAdim };
  };

  // YG-1565: Onayınızı Bekleyenler, Dosyalarım. YG-459: firma, maliyet ve iç yazışma yoktur.
  // YG-1374: yat sahibi, temsilci ve kurumsal kullanıcı yalnız kendi dosyalarında dosya no ve yat adıyla arar.
  s.get('/portal/ara', oturumlu, async (i) => {
    const q = String((i.query as { q?: string }).q ?? '').trim(); if (q.length < 2) return [];
    return (await b.db.query(`SELECT d.kimlik, d.dosya_no, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE (${benimDosyalarim}) AND (tr_norm(d.dosya_no) LIKE '%' || tr_norm($2) || '%' OR tr_norm(y.yat_adi) LIKE '%' || tr_norm($2) || '%') ORDER BY d.acilis_tarihi DESC LIMIT 30`, [i.oturum!.kullanici, q])).rows;
  });
  s.get('/portal/ana', oturumlu, async (i, y) => {
    const o = i.oturum!; const red = musteri(o.grup, y); if (red) return red;
    const dosyalar = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.statu, d.asama, d.ilerleme_yuzdesi, d.acilis_tarihi, y.yat_adi, h.ad_soyad AS dosya_sorumlusu FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref WHERE d.birlestirilen_ana_dosya_ref IS NULL AND (${benimDosyalarim}) ORDER BY d.statu = 'Kapalı', d.acilis_tarihi DESC`, [o.kullanici])).rows;
    const talepler = (await b.db.query(`SELECT t.kimlik, t.talep_no, t.statu, t.kayda_gecis_zamani, y.yat_adi FROM talep t JOIN yat y ON y.kimlik = t.yat_ref WHERE t.olusturan_ref = $1 AND t.dosya_ref IS NULL AND t.statu NOT IN ('Birleştirildi', 'Kapsam Dışı / Yönlendirme') ORDER BY t.kayda_gecis_zamani DESC`, [o.kullanici])).rows;
    const yetkili = (await b.db.query(`SELECT rol, sahip_ad, belge_durumu, ust_limit_eur, bitis_tarihi::text, odeme_yetkisi FROM yat_yetkilisi_kaydi WHERE kullanici_ref = $1`, [o.kullanici])).rows[0] ?? null; // YG-1566
    const onaylar = (await b.db.query(`SELECT t.kimlik, t.ony_kod, t.baslik, t.belge_adi, t.son_gecerlilik, d.dosya_no FROM onay_talebi t LEFT JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.alici_kullanici_ref = $1 AND t.durum = 'Bekliyor' AND t.son_gecerlilik > now() ORDER BY t.olusturma_zamani DESC`, [o.kullanici])).rows;
    if (yetkili?.belge_durumu === 'Geçerli') { const var0 = new Set(onaylar.map((x) => x.kimlik)); for (const x of await (await import('./yetki_ek.js')).yetkiliOnaylari(b.db, o.kullanici)) if (!var0.has(x.kimlik)) onaylar.push(x); } // YG-1566
    const limitAsan = yetkili?.belge_durumu === 'Geçerli' ? await (await import('./yetki_ek.js')).yetkiliLimitAsanlar(b.db, o.kullanici) : []; // YG-1449
    return { yetkili, onaylar, limitAsan, dosyalar: await Promise.all(dosyalar.map((x) => kart(x, o.kullanici))), talepler: talepler.map((t) => ({ kimlik: t.kimlik, dosyaNo: t.talep_no, yat: t.yat_adi, durum: 'Talebiniz Alındı', renk: 'yeşil', zaman: t.kayda_gecis_zamani })) };
  });

  // YG-460: RP-RAP-001 İlerleme Raporu (PDF) yat sahibinin kendi dosyası için.
  s.get('/portal/dosya/:id/ilerleme-raporu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const red = musteri(o.grup, y); if (red) return red;
    if (!UUID.test(id) || !(await b.db.query(`SELECT 1 FROM dosya d WHERE d.kimlik = $2 AND (${benimDosyalarim})`, [o.kullanici, id])).rowCount) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    const r = await (await import('./ilerleme_rapor.js')).ilerlemeRaporuPdf(b.db, id); if (!r) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    return y.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${r.dosyaAdi}"`).header('x-content-type-options', 'nosniff').send(r.pdf);
  });
  // YG-1566, YG-1565: Belgelerim; kullanıcının (yetkilide yetki kapsamındaki) dosyalarının yürürlükteki belgeleri, Kritik sınıf hariç.
  s.get('/portal/belgelerim', oturumlu, async (i) => (await b.db.query(`SELECT e.kimlik, e.ad, s.surum_no, d.dosya_no, y.yat_adi, e.olusturma_zamani FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik JOIN dosya d ON d.kimlik::text = e.bag_kimligi JOIN yat y ON y.kimlik = d.yat_ref
      WHERE e.bag_turu = 'Dosya' AND s.durum = 'Yürürlükte' AND e.bilgi_sinifi <> 'Kritik' AND d.birlestirilen_ana_dosya_ref IS NULL AND (${benimDosyalarim}) ORDER BY e.olusturma_zamani DESC LIMIT 200`, [i.oturum!.kullanici])).rows);
  s.get('/portal/dosya/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const red = musteri(o.grup, y); if (red) return red;
    if (!UUID.test(id)) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    const d = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.statu, d.asama, d.ilerleme_yuzdesi, d.acilis_tarihi, d.tahmini_teslim_tarihi::text, y.yat_adi, h.ad_soyad AS dosya_sorumlusu FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref WHERE d.kimlik = $2 AND (${benimDosyalarim})`, [o.kullanici, id])).rows[0];
    if (!d) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    const belgeler = (await b.db.query(`SELECT e.kimlik, e.ad, s.surum_no FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik WHERE e.bag_turu = 'Dosya' AND e.bag_kimligi = $1 AND s.durum = 'Yürürlükte' AND e.bilgi_sinifi <> 'Kritik' ORDER BY e.olusturma_zamani DESC`, [id])).rows;
    const kurtarma = (await b.db.query(`SELECT k.hizmet_turu, k.baslama_zamani, CASE WHEN k.saglayici_aciklama_onayi THEN u.ticari_unvan END AS saglayici FROM kurtarma_operasyonu k JOIN kurulus u ON u.kimlik = k.saglayici_ref WHERE k.dosya_ref = $1`, [d.kimlik])).rows; // YG-486
    // YG-206: teklif yat sahibinden saklanmaz, salt okunur; firma ve maliyet bilgisi yoktur.
    const teklifler = (await b.db.query(`SELECT f.kimlik, f.teklif_no, f.surum_no, f.teklif_turu, f.teklif_muhatabi, f.statu, f.karar, f.genel_toplam_eur, f.bildirilen_sure_gun FROM fiyat_teklifi f WHERE f.dosya_ref = $1 AND f.statu IN ('Gönderildi', 'Karar') ORDER BY f.olusturma_zamani`, [d.kimlik])).rows;
    const kalemler = (await b.db.query(`SELECT teklif_ref, sira_no, aciklama, miktar, birim, tutar_eur, onay_durumu FROM fiyat_teklifi_kalemi WHERE teklif_ref = ANY($1::uuid[]) ORDER BY sira_no`, [teklifler.map((x) => x.kimlik)])).rows;
    // YG-458: fatura bilgisi; belgeyi muhasebe iletir, burada yalnız kayıt görünür.
    const faturalar = (await b.db.query(`SELECT kimlik, fatura_no, fatura_tarihi::text, toplam_eur, toplam_tl, durum FROM musteri_faturasi WHERE dosya_ref = $1 AND fatura_no IS NOT NULL AND muhatap <> 'Sigorta Şirketi' ORDER BY fatura_tarihi`, [d.kimlik])).rows;
    const teslim = (await b.db.query(`SELECT teslime_hazir_zamani, teslim_son_tarihi::text, GREATEST(teslim_son_tarihi - current_date, 0) AS kalan_gun FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0]; // YG-481
    // YG-1450: düğme yalnız süresi içinde ve bireysel kayıtta görünür.
    const cayma = Boolean((await b.db.query(`SELECT 1 FROM on_bilgilendirme_cayma_kaydi WHERE dosya_ref = $1 AND cayma_zamani IS NULL AND cayma_bitis > now() LIMIT 1`, [id])).rowCount);
    const fotograflar = (await b.db.query(`SELECT kimlik, aciklama, onay_zamani FROM portal_ilerleme_fotografi WHERE dosya_ref = $1 AND kaldirma_zamani IS NULL ORDER BY onay_zamani`, [d.kimlik])).rows; // YG-458
    // YG-055: yat sahibi yalnız onaylanmış kapsamın özetini görür (fiyat ve iç notlar olmadan).
    const kapsamOzeti = (await b.db.query(`SELECT s.satir_kodu, s.aciklama, s.miktar, s.birim FROM kapsam_satiri s WHERE s.cetvel_ref = (SELECT c.kimlik FROM kapsam_cetveli c WHERE c.dosya_ref = $1 AND c.durum = 'Onaylı' ORDER BY c.surum DESC LIMIT 1) ORDER BY s.satir_kodu`, [d.kimlik])).rows;
    // YG-477: yat sahibi kendi yatının mülkiyet türünü, takyidatını ve lehtarını görür.
    const mulkiyet = (await b.db.query(`SELECT y.mulkiyet_turu, y.takyidat, coalesce(y.lehtar_adi, (SELECT unvan_ad_soyad FROM taraf WHERE kimlik = y.lehtar_ref)) lehtar FROM dosya x JOIN yat y ON y.kimlik = x.yat_ref WHERE x.kimlik = $1`, [d.kimlik])).rows[0] ?? null;
    for (const x of teklifler) if (x.karar === 'Süre Dolumu Kabulü') x.karar = null; // SGT-1: sigorta onayı olarak gösterilmez
    // YG-1449: lehtar varsa muvafakat durumu onaylı ONY-12 / ONY-13 metniyle gösterilir.
    let muvafakat: { baslik: string; metin: string } | null = null;
    { const mv = (await b.db.query(`SELECT coalesce(y.lehtar_adi, (SELECT unvan_ad_soyad FROM taraf WHERE kimlik = y.lehtar_ref)) lehtar, y.lehtar_muvafakati_ref, (SELECT olusturma_zamani FROM belge WHERE kimlik = y.lehtar_muvafakati_ref) z, x.yazisma_dili FROM dosya x JOIN yat y ON y.kimlik = x.yat_ref WHERE x.kimlik = $1`, [d.kimlik])).rows[0];
      if (mv?.lehtar) { const dil = dilKod(mv.yazisma_dili); const s = (await b.db.query(`SELECT baslik, metin FROM sablon_metni WHERE kod = $1 AND dil = $2 AND durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`, [mv.lehtar_muvafakati_ref ? 'ONY-13' : 'ONY-12', dil])).rows[0];
        const { doldur, gunAy } = await import('./metin.js'); const tarih = mv.z ? gunAy(mv.z) : '';
        if (s) muvafakat = { baslik: s.baslik, metin: doldur(s.metin, { Lehtar: mv.lehtar, 'Loss payee': mv.lehtar, tarih, date: tarih }) }; } }
    return { ...(await kart(d, o.kullanici)), mulkiyet, muvafakat, cayma, belgeler, fotograflar, kapsamOzeti, kurtarma, faturalar, teslim, beklemeNotu: await beklemeNotu(b.db, d.kimlik), teklifler: teklifler.map((x) => ({ ...x, kalemler: kalemler.filter((k) => k.teklif_ref === x.kimlik) })) };
  });

  // Portal kullanıcısının bekleyen onayı: bağlantıyı kaybetse de hesabından açar (YG-465).
  s.post('/portal/onay/:id/ac', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'Onay kaydı bulunamadı; bağlantıyı kontrol etmenizi rica ederiz.' });
    await (await import('./yetki_ek.js')).yetkiliyeDevret(b.db, id, o.kullanici); // YG-1031, YG-1070: kapsam, limit, süre içindeyse kod yetkiliye gider.
    const ot = (await b.db.query(`SELECT tutar_eur FROM onay_talebi WHERE kimlik = $1 AND alici_kullanici_ref = $2`, [id, o.kullanici])).rows[0];
    if (ot) { const oe = await onayEngeli(b.db, o.kullanici, ot.tutar_eur === null ? null : Number(ot.tutar_eur)); if (oe) { if (ot.tutar_eur !== null && /sınırınızın üzerinde/.test(oe)) return y.code(403).send({ hata: await (await import('./kalan.js')).limitYonlendir(b.db, id, o.kullanici, Number(ot.tutar_eur)) }); return y.code(403).send({ hata: oe }); } }
    const bel = rastgeleBelirtec();
    const r = await b.db.query(`UPDATE onay_talebi SET portal_belirtec_ozeti = $3 WHERE kimlik = $1 AND alici_kullanici_ref = $2 AND durum = 'Bekliyor' RETURNING kimlik`, [id, o.kullanici, ozet(bel)]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Onay kaydı bulunamadı; bağlantıyı kontrol etmenizi rica ederiz.' });
    return { belirtec: bel };
  });

  // YG-011, YG-1553, YG-1562: portal kısa formu; hasar içerikli talep Operasyona düşer. YG-485: aydınlatma ilk girişte onaylandı.
  s.post('/portal/ihbar', oturumlu, async (i, y) => {
    const o = i.oturum!; const red = musteri(o.grup, y); if (red) return red;
    const ke = await talepEngeli(b.db, o.kullanici); if (ke) return y.code(403).send({ hata: ke });
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
      // YG-1553: mesai içinde Operasyon Müdürü kuyruğu; mesai dışında nöbetçi Dosya Sorumlusu (nöbetçi yoksa Operasyon Müdürü).
      const mesai = (await import('./bildirim.js')).mesaiIcinde(new Date());
      const ilk = (!mesai ? await (await import('./acil.js')).nobetci(c, 'Dosya Sorumlusu') : null) ?? (await rolSahipleri(c, await rolId(c, 'Operasyon Müdürü')))[0] ?? o.kullanici;
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

