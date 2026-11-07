import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy, tutar } from './metin.js';
import { onayFormKaydet, onaySonucKaydet, onayTalebiAc } from './onay.js';
import { UUID } from './yat.js';
import { hizaEngeli } from './firma_ek.js';
import { Depo } from './depo.js';

type Db = Pool | PoolClient;
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const SECIMLER = ['İade', 'Montaj', 'Süreli Bekletme', 'Hurda-Bertaraf', 'Sigorta Eksperi İncelemesi İçin Bekletme'];
const ONAYLAR = ['ONY-03', 'ONY-06', 'ONY-07', 'ONY-08', 'ONY-09', 'ONY-10'];
const TESLIM_GUN = 7; const PARCA_GUN = 30;

/** YG-475, YG-414: teslim kararı Kabul veya Koşullu Kabul (çekinceli); çekincede metin zorunlu. */
onayFormKaydet('Teslim Kararı', async (_db, _t, f) => (f?.teslimKarar === 'Koşullu Kabul' && !String(f?.cekince ?? '').trim() ? 'Çekincenizi yazmanızı rica ederiz.' : null));

/** YG-1500: yabancı sigortacılı yatta ONY-03 onayıyla Dosya Sorumlusuna belge desteği görevi. */
onaySonucKaydet('ONY-03', async (c, t, karar) => {
  if (karar !== 'Onaylandı' || !t.dosya_ref) return;
  const d = (await c.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [t.dosya_ref])).rows[0];
  if (d?.dosya_sorumlusu_ref) await kartAc(c, { tur: 'Sigorta Belge Desteği', kategori: 'islem', baslik: `${d.dosya_no} · Sigorta Belge Desteği`, ozet: 'Sigorta şirketinin isteyebileceği rapor ve belgeler için destek.', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: t.dosya_ref });
});

/** YG-1086: teslim öncesinde yetki yeniden kontrol edilir. */
export async function teslimYetkiEngeli(db: Db, dosya: string): Promise<string | null> {
  const t = (await db.query(`SELECT t.ihbar_yetki_durumu FROM dosya d JOIN talep t ON t.kimlik = d.talep_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (t && t.ihbar_yetki_durumu !== 'Doğrulandı') return 'Yetki doğrulanmadan teslim yapılamaz; yetki belgesi bekleniyor.';
  // YG-1086: yat sahibi tarafındaki kişinin yetki kaydı süresi dolmuş veya geçersizse teslim durur.
  if ((await db.query(`SELECT 1 FROM yetki_kaydi y JOIN dosya_tarafi t ON t.kimlik = y.dosya_tarafi_ref WHERE y.dosya_ref = $1 AND t.aktif AND t.taraf_rolu = 'Yat Sahibi' AND (y.yetki_durumu <> 'Geçerli' OR y.gecerlilik_bitisi < current_date) AND NOT EXISTS (SELECT 1 FROM yetki_kaydi z WHERE z.dosya_tarafi_ref = y.dosya_tarafi_ref AND z.yetki_durumu = 'Geçerli' AND (z.gecerlilik_bitisi IS NULL OR z.gecerlilik_bitisi >= current_date)) LIMIT 1`, [dosya])).rowCount) return 'Teslim alacak kişinin yetki kaydının süresi dolmuştur; yenilenmesi bekleniyor.';
  return null;
}

/** YG-473: yetkisi doğrulanmamış ihbar edenin (kaptan) sözlü onayıyla ilave iş başlamaz; dosya yetki belgesi gelene kadar bekler. */
export async function ilaveIsYetkiEngeli(db: Db, dosya: string, tur: string): Promise<string | null> {
  if (tur !== 'EK' && tur !== 'ON') return null; // YG-1086: kapsam, ilave iş ve iş emrinde yeniden kontrol
  const t = (await db.query(`SELECT t.ihbar_yetki_durumu FROM dosya d JOIN talep t ON t.kimlik = d.talep_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  return t && t.ihbar_yetki_durumu !== 'Doğrulandı' ? (tur === 'EK' ? 'Yetki belgesi gelmeden ilave iş başlatılamaz; dosyayı Beklemede işaretlemenizi rica ederiz.' : 'Yetki doğrulanmadan onarım iş emri açılamaz; dosyayı Beklemede işaretlemenizi rica ederiz.') : null;
}

/** YG-099: yabancı bayraklı yatta belge ve kalış süresi işi kapsamalı. */
export async function yabanciBayrakEngeli(db: Db, dosya: string, hedefBitis?: string | null): Promise<string | null> {
  const y = (await db.query(`SELECT y.bayrak, y.yabanci_yat_belge_gecerlilik g, y.gecici_ithalat_bitis i, y.turkiye_kalis_bitis k FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (!y?.bayrak || /^(türk|turk|tr$)/i.test(y.bayrak)) return null;
  const bugun = new Date().toISOString().slice(0, 10); const s = (v: Date | string | null) => (v ? new Date(v).toISOString().slice(0, 10) : null);
  if ((s(y.g) && s(y.g)! < bugun) || (s(y.i) && s(y.i)! < bugun)) return 'Yabancı yat belgesinin süresi dolmuştur; iş emri planlanamaz.';
  if (hedefBitis && s(y.k) && s(y.k)! < hedefBitis) return 'Planlanan bitiş Türkiye’de kalış süresini aşıyor; önce yat sahibine bildirim yapılmalıdır.';
  return null;
}

/** YG-1498, YG-481: yasal bekleme bitişi; hazır bildiriminden 7 gün sonra teslim alınmayan yat. */
export async function teslimIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  for (const r of (await db.query(`SELECT k.teklif_ref, k.dosya_ref, k.cayma_bitis, d.dosya_no, d.yazisma_dili, d.dosya_sorumlusu_ref, d.vefat_isareti, t.telefon, t.eposta FROM on_bilgilendirme_cayma_kaydi k JOIN dosya d ON d.kimlik = k.dosya_ref LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE k.cayma_bitis <= $1::timestamptz AND NOT k.erken_ifa_onayi AND k.cayma_zamani IS NULL`, [simdi])).rows) {
    if (!(await birKez(db, 'yasal_bekleme', r.teklif_ref))) continue;
    const tr = gunAy(simdi);
    if ((r.telefon || r.eposta) && !r.vefat_isareti) await yatTarafinaYaz(db, { olay: `bld50:${r.teklif_ref}`, kod: 'BLD-50', dil: dilKod(r.yazisma_dili), konu: `${r.dosya_no} Çalışmalara Başlama`, telefon: r.telefon, eposta: r.eposta, alanlar: { 'Dosya No': r.dosya_no, 'File No': r.dosya_no, tarih: tr, date: tr } });
    if (r.dosya_sorumlusu_ref) await kartAc(db, { tur: 'Çalışmayı Başlat', kategori: 'islem', baslik: `${r.dosya_no} · Çalışmaları Başlatınız`, ozet: 'Yasal bekleme süresi sona erdi.', sonZaman: simdi, sahipKullanici: r.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: r.dosya_ref });
    n++;
  }
  for (const d of (await db.query(`SELECT d.kimlik, d.dosya_no, d.yazisma_dili, d.teslime_hazir_zamani, d.teslim_son_tarihi, d.vefat_isareti, y.yat_adi, t.telefon, t.eposta FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE d.teslim_son_tarihi < $1::date AND NOT EXISTS (SELECT 1 FROM teslim_kaydi k WHERE k.dosya_ref = d.kimlik AND k.durum LIKE 'Teslim Edildi%')`, [simdi.toISOString().slice(0, 10)])).rows) {
    if (!(await birKez(db, 'teslim_alinmadi', d.kimlik))) continue;
    const tr = gunAy(d.teslim_son_tarihi);
    if ((d.telefon || d.eposta) && !d.vefat_isareti) await yatTarafinaYaz(db, { olay: `bld14:${d.kimlik}`, kod: 'BLD-14', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Teslim Daveti`, telefon: d.telefon, eposta: d.eposta, alanlar: { Yat: d.yat_adi, Yacht: d.yat_adi, tarih: tr, date: tr, 'bağlantı': '', link: '' } });
    await kartAc(db, { tur: 'Barınma Gideri', kategori: 'islem', baslik: `${d.dosya_no} · Teslim Alınmayan Yat`, ozet: `${tr} sonrası barınma ve çekek gideri yat sahibine aittir.`, sahipRol: await rolId(db, 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)'), nesneTuru: 'Dosya', nesneKimligi: d.kimlik }); n++;
  }
  return n;
}

export function teslimEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const dosyaBelgesi = async (belge: string | undefined, dosya: string) => Boolean(belge && UUID.test(belge) && (await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi::text = $2`, [belge, dosya])).rowCount);
  const dosya = async (id: string) => (await b.db.query(`SELECT d.*, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [id])).rows[0];
  const sahip = async (id: string) => (await b.db.query(`SELECT kimlik, kisi_adi_soyadi, telefon, eposta, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [id])).rows[0];
  const musteriMi = async (dosyaRef: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya_tarafi t WHERE t.dosya_ref = $1 AND t.kullanici_ref = $2 AND t.aktif LIMIT 1`, [dosyaRef, k])).rowCount);

  // YG-471, YG-474, YG-1500: ONY-03, 06, 07, 08, 09, 10; onay PDF'i onay akışından e-postayla gider.
  s.post('/dosya/:id/onay-iste', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ony?: string; parca?: string; tutar?: number; zaman?: string; kayitNo?: string; teklifNo?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!ONAYLAR.includes(g.ony ?? '')) return y.code(400).send({ hata: 'Onay türünü seçmenizi rica ederiz.' });
    if (['ONY-07', 'ONY-08'].includes(g.ony!) && !g.parca?.trim()) return y.code(400).send({ hata: 'Parça adını yazmanızı rica ederiz.' });
    if (g.ony === 'ONY-08' && !(Number(g.tutar) > 0)) return y.code(400).send({ hata: 'Parça bedelini yazmanızı rica ederiz.' });
    if (g.ony === 'ONY-09' && !g.zaman) return y.code(400).send({ hata: 'Deneme tarih ve saatini yazmanızı rica ederiz.' });
    if (g.ony === 'ONY-10' && !g.kayitNo?.trim()) return y.code(400).send({ hata: 'Garanti kayıt numarasını yazmanızı rica ederiz.' });
    if (g.ony === 'ONY-06' && !g.teklifNo?.trim()) return y.code(400).send({ hata: 'Teklif numarasını yazmanızı rica ederiz.' });
    if (g.ony === 'ONY-09') { const he = await hizaEngeli(b.db, id); if (he) return y.code(409).send({ hata: he }); } // YG-409
    const d = await dosya(id); const t = await sahip(id);
    if (!t) return y.code(409).send({ hata: 'Yat sahibi kaydı bulunamadı.' });
    const dil = dilKod(d.yazisma_dili); const web = b.webAdresi; const ts = tutar(Number(g.tutar ?? 0), dil);
    const zm = g.zaman ? new Date(g.zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' }) : '';
    const alanlar = { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, Yat: d.yat_adi, Yacht: d.yat_adi, 'bağlantı': web, link: web, 'Parça adı': g.parca ?? '', 'Part name': g.parca ?? '', '0.000,00': ts, '0,000.00': ts, 'tarih saat': zm, 'date time': zm, 'Kayıt No': g.kayitNo ?? '', 'Record No': g.kayitNo ?? '', 'Teklif No / Sürüm': g.teklifNo ?? '', 'Quotation No / Version': g.teklifNo ?? '' };
    return islem(async (c) => {
      const on = await onayTalebiAc(c, { dosya: id, ony: g.ony!, dil, alanlar, baslikAlanlari: alanlar, tutar: g.ony === 'ONY-08' ? g.tutar : null, taraf: t.kimlik, kullanici: t.kullanici_ref, aliciAd: t.kisi_adi_soyadi, telefon: t.telefon, eposta: t.eposta, nesneTuru: 'Dosya', nesneKimligi: id, hazirlayan: o.kullanici, webAdresi: web, konu: `${d.dosya_no} Onayınız Bekleniyor` });
      return { kimlik: on.kimlik };
    });
  });
  // YG-472: bireysel ve sigortasız dosyada Acil İlk Tedbir talebi; sigortalıda varyant yoktur. Firma adı yazılmaz.
  s.post('/acil/:dosya/ilk-tedbir-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { dosya: id } = i.params as { dosya: string }; const rol = ((i.body ?? {}) as { alici?: string }).alici === 'Kaptan' ? 'Kaptan' : 'Yat Sahibi';
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = await dosya(id);
    if (d.dosya_niteligi === 'Sigorta bağlantılı') return y.code(409).send({ hata: 'Sigortalı dosyada tedbir hemen uygulanır; onay ekranı gönderilmez.' });
    const t = (await b.db.query(`SELECT kimlik, kisi_adi_soyadi, telefon, eposta, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = $2 AND aktif LIMIT 1`, [id, rol])).rows[0];
    if (!t) return y.code(409).send({ hata: `${rol} kaydı bulunamadı.` });
    return islem(async (c) => {
      const on = await onayTalebiAc(c, { dosya: id, ony: 'ONY-28', dil: dilKod(d.yazisma_dili), alanlar: { Yat: d.yat_adi, Yacht: d.yat_adi }, taraf: t.kimlik, kullanici: t.kullanici_ref, aliciAd: t.kisi_adi_soyadi, telefon: t.telefon, eposta: t.eposta, nesneTuru: 'Dosya', nesneKimligi: id, hazirlayan: o.kullanici, webAdresi: b.webAdresi, konu: `${d.dosya_no} Acil İlk Tedbir` });
      return { kimlik: on.kimlik };
    });
  });

  // YG-481: hazır bildirimi BLD-12; 7 takvim günü sayılır.
  s.post('/dosya/:id/teslime-hazir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = await dosya(id); const t = await sahip(id);
    if (d.teslime_hazir_zamani) return y.code(409).send({ hata: 'Hazır bildirimi yapılmıştır.' });
    const son = new Date(Date.now() + TESLIM_GUN * 86_400_000); const gs = son.toISOString().slice(0, 10); const tr = gunAy(son);
    return islem(async (c) => {
      await c.query(`UPDATE dosya SET teslime_hazir_zamani = now(), teslim_son_tarihi = $2 WHERE kimlik = $1`, [id, gs]);
      if (t && !d.vefat_isareti) await yatTarafinaYaz(c, { olay: `bld12:${id}`, kod: 'BLD-12', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Teslime Hazır`, telefon: t.telefon, eposta: t.eposta, alanlar: { Yat: d.yat_adi, Yacht: d.yat_adi, tarih: tr, date: tr, 'bağlantı': b.webAdresi, link: b.webAdresi } });
      return { sonTarih: gs };
    });
  });

  // YG-1435: tek hatırlatma; onay gelmezse "Teslim edildi - onay verilmedi". Yat sahibi yoksa temsilci veya tesis, fotoğraf zorunlu.
  s.post('/dosya/:id/teslim-hatirlat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = await dosya(id); const t = await sahip(id);
    const k = (await b.db.query(`SELECT kimlik, hatirlatma_zamani FROM teslim_kaydi WHERE dosya_ref = $1 AND durum = 'Onay Bekliyor' LIMIT 1`, [id])).rows[0];
    if (!k) return y.code(409).send({ hata: 'Onay bekleyen teslim kaydı yoktur.' });
    if (k.hatirlatma_zamani) return y.code(409).send({ hata: 'Hatırlatma yapılmıştır; tek hatırlatma gönderilir.' });
    await islem(async (c) => {
      await c.query(`UPDATE teslim_kaydi SET hatirlatma_zamani = now() WHERE kimlik = $1`, [k.kimlik]);
      if (t && !d.vefat_isareti) await yatTarafinaYaz(c, { olay: `bld48:${k.kimlik}`, kod: 'BLD-48', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Teslim Tutanağı`, telefon: t.telefon, eposta: t.eposta, alanlar: { Yat: d.yat_adi, Yacht: d.yat_adi, 'bağlantı': b.webAdresi, link: b.webAdresi } });
    });
    return { tamam: true };
  });
  s.post('/dosya/:id/teslim-onaysiz', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { aliciTuru?: string; alici?: string; belge?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!['Yat Sahibi', 'Yetkili Temsilci', 'Marina veya Tersane'].includes(g.aliciTuru ?? '') || !g.alici?.trim()) return y.code(400).send({ hata: 'Teslim alanı girmenizi rica ederiz.' });
    { const hb = (await import('./tutanak_ek.js')).hassasBilgi(g.alici); if (hb) return y.code(400).send({ hata: hb }); }
    if (!(await dosyaBelgesi(g.belge, id))) return y.code(400).send({ hata: 'Teslim fotoğrafını eklemenizi rica ederiz.' });
    const d = await dosya(id); const t = await sahip(id);
    // YG-414: temsilciye teslimde geçerli yetki kaydı aranır; sözlü veya e-posta teyidi yerine geçmez.
    if (g.aliciTuru === 'Yetkili Temsilci' && !(await b.db.query(`SELECT 1 FROM yetki_kaydi y JOIN dosya_tarafi x ON x.kimlik = y.dosya_tarafi_ref WHERE y.dosya_ref = $1 AND lower(x.kisi_adi_soyadi) = lower($3) AND y.yetki_durumu = 'Geçerli' AND (y.gecerlilik_bitisi IS NULL OR y.gecerlilik_bitisi >= current_date) UNION ALL SELECT 1 FROM yat_yetkilisi_kaydi k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.sahip_telefon = $2 AND lower(h.ad_soyad) = lower($3) AND k.belge_durumu = 'Geçerli' AND k.bitis_tarihi >= current_date LIMIT 1`, [id, t?.telefon ?? '', g.alici!.trim()])).rowCount) return y.code(409).send({ hata: 'Teslim alan kişi adına geçerli yetki kaydı bekleniyor.' });
    const k = (await b.db.query(`SELECT kimlik, hatirlatma_zamani FROM teslim_kaydi WHERE dosya_ref = $1 AND durum = 'Onay Bekliyor' LIMIT 1`, [id])).rows[0];
    if (!k) return y.code(409).send({ hata: 'Onay bekleyen teslim kaydı yoktur.' });
    if (!k.hatirlatma_zamani) return y.code(409).send({ hata: 'Önce tek hatırlatma gönderilmelidir.' });
    return islem(async (c) => {
      await c.query(`UPDATE teslim_kaydi SET durum = 'Teslim Edildi - Onay Verilmedi', teslim_alan = $2, alici_turu = $3, foto_belge_ref = $4, teslim_zamani = now() WHERE kimlik = $1`, [k.kimlik, g.alici!.trim(), g.aliciTuru, g.belge]);
      const zm = new Date().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
      if (t && !d.vefat_isareti) await yatTarafinaYaz(c, { olay: `bld49:${k.kimlik}`, kod: 'BLD-49', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Teslim`, telefon: t.telefon, eposta: t.eposta, alanlar: { Yat: d.yat_adi, Yacht: d.yat_adi, 'tarih saat': zm, 'date time': zm, 'bağlantı': b.webAdresi, link: b.webAdresi } });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teslim Edildi - Onay Verilmedi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { alici: g.alici, tur: g.aliciTuru }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { durum: 'Teslim Edildi - Onay Verilmedi' };
    });
  });

  // YG-088: yat LGM'ye veya görevli firmaya teslim edildiğinde kabul tutanağı.
  s.post('/dosya/:id/yat-kabul', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { teslimAlan?: string; firma?: string; envanter?: string; anahtarlar?: string; sayaclar?: string; yakit?: string; belge?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!['LGM', 'Görevli Firma'].includes(g.teslimAlan ?? '') || !g.envanter?.trim() || !g.anahtarlar?.trim() || !g.sayaclar?.trim() || !g.yakit?.trim()) return y.code(400).send({ hata: 'Teslim alan, envanter, anahtarlar, sayaçlar ve yakıt seviyesini girmenizi rica ederiz.' });
    // YG-089: görevli firmaya teslimde firma, dosyada iş emri olan firmalar arasından zorunlu; şifre gibi hassas bilgi yazılmaz.
    if (g.teslimAlan === 'Görevli Firma' && (!g.firma || !UUID.test(g.firma) || !(await b.db.query(`SELECT 1 FROM is_emri WHERE dosya_ref = $1 AND kurulus_ref = $2 AND statu <> 'İptal' LIMIT 1`, [id, g.firma])).rowCount)) return y.code(400).send({ hata: 'Yatı teslim alan görevli firmayı seçiniz.' });
    const hb = (await import('./tutanak_ek.js')).hassasBilgi(g.envanter, g.anahtarlar, g.sayaclar, g.yakit); if (hb) return y.code(400).send({ hata: hb });
    if (!(await dosyaBelgesi(g.belge, id))) return y.code(400).send({ hata: 'Fotoğrafları eklemenizi rica ederiz.' });
    const r = await b.db.query(`INSERT INTO yat_kabul_tutanagi (dosya_ref, teslim_alan, envanter, anahtarlar, sayaclar, yakit_seviyesi, foto_belge_ref, kaydeden_ref, kurulus_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [id, g.teslimAlan, g.envanter.trim(), g.anahtarlar.trim(), g.sayaclar.trim(), g.yakit.trim(), g.belge, o.kullanici, g.teslimAlan === 'Görevli Firma' ? g.firma : null]);
    return { kimlik: r.rows[0].kimlik };
  });

  // YG-482: sökülen parça listesi; sigortalıda seçim önce sigorta talimatıyla (30 gün).
  s.post('/dosya/:id/sokulen-parca', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; konum?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g.ad?.trim()) return y.code(400).send({ hata: 'Parça adını yazmanızı rica ederiz.' });
    const r = await b.db.query(`INSERT INTO sokulen_parca (dosya_ref, parca_adi, konum, son_tarih, giren_ref) VALUES ($1,$2,$3,(now() AT TIME ZONE 'Europe/Istanbul')::date + $4::int,$5) RETURNING kimlik`, [id, g.ad.trim(), g.konum?.trim() || null, PARCA_GUN, o.kullanici]);
    return { kimlik: r.rows[0].kimlik };
  });
  s.get('/dosya/:id/sokulen-parca', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; const k = i.oturum!.kullanici;
    if (!UUID.test(id) || !((await dosyaErisimi(b.db, k, id)) || (await musteriMi(id, k)))) return yok(y);
    return (await b.db.query(`SELECT kimlik, parca_adi, konum, secim, son_tarih::text FROM sokulen_parca WHERE dosya_ref = $1 ORDER BY olusturma_zamani`, [id])).rows;
  });
  s.post('/sokulen-parca/:id/secim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const secim = ((i.body ?? {}) as { secim?: string }).secim;
    if (!UUID.test(id)) return yok(y);
    const p = (await b.db.query(`SELECT p.*, d.dosya_niteligi FROM sokulen_parca p JOIN dosya d ON d.kimlik = p.dosya_ref WHERE p.kimlik = $1`, [id])).rows[0];
    if (!p) return yok(y);
    const lgm = await dosyaErisimi(b.db, o.kullanici, p.dosya_ref); const mus = !lgm && await musteriMi(p.dosya_ref, o.kullanici);
    if (!lgm && !mus) return yok(y);
    if (!SECIMLER.includes(secim ?? '')) return y.code(400).send({ hata: 'Seçiminizi yapmanızı rica ederiz.' });
    if (mus && p.dosya_niteligi === 'Sigorta bağlantılı') return y.code(409).send({ hata: 'Sigortalı dosyada parça için önce sigorta şirketinin talimatı bekleniyor.' });
    await b.db.query(`UPDATE sokulen_parca SET secim = $2, secen_ref = $3, secim_zamani = now() WHERE kimlik = $1`, [id, secim, o.kullanici]);
    return { secim };
  });

  // YG-458: portaldan garanti talebi; kayıt Dosya Sorumlusu tarafından açılır.
  s.post('/portal/dosya/:id/garanti-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const belirti = ((i.body ?? {}) as { belirti?: string }).belirti?.trim();
    if (!UUID.test(id) || !(await musteriMi(id, o.kullanici))) return yok(y);
    if (!belirti) return y.code(400).send({ hata: 'Sorunu kısaca yazmanızı rica ederiz.' });
    const d = await dosya(id);
    if (!d.dosya_sorumlusu_ref) return yok(y);
    await kartAc(b.db, { tur: 'Garanti Talebi', kategori: 'islem', baslik: `${d.dosya_no} · Portaldan Garanti Talebi`, ozet: belirti, oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: id });
    return { durum: 'İletildi' };
  });

  // YG-458: ilerleme fotoğrafını Dosya Sorumlusu veya dosyadaki teknik ekip onaylayıp portala açar; fotoğraf dosyaya ya da dosyanın iş emrine bağlı olmalıdır.
  const FOTO = /\.(jpe?g|png|webp|heic)$/i;
  const fotoYetkili = async (dosyaRef: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya d WHERE d.kimlik = $1 AND d.dosya_sorumlusu_ref = $2 UNION SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = $1 AND a.kullanici_ref = $2 AND a.bitis_zamani IS NULL AND a.rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Saha Sorumlusu') LIMIT 1`, [dosyaRef, k])).rowCount);
  s.post('/dosya/:id/ilerleme-fotografi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string; aciklama?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await fotoYetkili(id, o.kullanici))) return y.code(403).send({ hata: 'Fotoğrafı Dosya Sorumlusu veya dosyadaki teknik ekip onaylar.' });
    if (!g.belge || !UUID.test(g.belge) || !g.aciklama?.trim()) return y.code(400).send({ hata: 'Fotoğraf ve açıklama zorunludur.' });
    const s0 = (await b.db.query(`SELECT s.kimlik, s.dosya_adi FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik AND s.durum NOT IN ('İptal', 'Yerine Geçti', 'Arşiv') WHERE e.kimlik = $1 AND e.imha_zamani IS NULL AND e.bilgi_sinifi <> 'Kritik' AND ((e.bag_turu = 'Dosya' AND e.bag_kimligi = $2::text) OR (e.bag_turu = 'İş Emri' AND e.bag_kimligi IN (SELECT kimlik::text FROM is_emri WHERE dosya_ref = $3))) ORDER BY s.surum_no DESC LIMIT 1`, [g.belge, id, id])).rows[0];
    if (!s0) return y.code(404).send({ hata: 'Fotoğraf bu dosyada bulunamadı.' });
    if (!FOTO.test(s0.dosya_adi)) return y.code(400).send({ hata: 'Yalnız fotoğraf dosyası paylaşılabilir.' });
    const r = await b.db.query(`INSERT INTO portal_ilerleme_fotografi (dosya_ref, surum_ref, aciklama, onaylayan_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (dosya_ref, surum_ref) DO UPDATE SET aciklama = EXCLUDED.aciklama, onaylayan_ref = EXCLUDED.onaylayan_ref, onay_zamani = now(), kaldiran_ref = NULL, kaldirma_zamani = NULL RETURNING kimlik`, [id, s0.kimlik, g.aciklama.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İlerleme Fotoğrafı Paylaşıldı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { surum: s0.kimlik }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.rows[0].kimlik };
  });
  s.post('/ilerleme-fotografi/:id/kaldir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const f = (await b.db.query(`SELECT dosya_ref FROM portal_ilerleme_fotografi WHERE kimlik = $1 AND kaldirma_zamani IS NULL`, [id])).rows[0];
    if (!f || !(await fotoYetkili(f.dosya_ref, o.kullanici))) return yok(y);
    await b.db.query(`UPDATE portal_ilerleme_fotografi SET kaldiran_ref = $2, kaldirma_zamani = now() WHERE kimlik = $1`, [id, o.kullanici]);
    return { tamam: true };
  });
  // Portal yalnız onaylı fotoğrafı verir; dosya adı yerine sıra numarası kullanılır (firma adı sızmaz).
  s.get('/portal/fotograf/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const f = (await b.db.query(`SELECT f.dosya_ref, s.dosya_adi, s.depo_anahtari FROM portal_ilerleme_fotografi f JOIN belge_surum s ON s.kimlik = f.surum_ref JOIN belge e ON e.kimlik = s.belge_ref WHERE f.kimlik = $1 AND f.kaldirma_zamani IS NULL AND e.imha_zamani IS NULL`, [id])).rows[0];
    if (!f || !(await musteriMi(f.dosya_ref, o.kullanici))) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge İndirildi', nesneTuru: 'İlerleme Fotoğrafı', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
    const uz = (f.dosya_adi as string).match(FOTO)![1]!.toLowerCase();
    return y.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="ilerleme-${id.slice(0, 8)}.${uz}"`).header('x-content-type-options', 'nosniff').send((b.depo ?? new Depo()).bagla(f.depo_anahtari));
  });

  // YG-079: tam ziyada onarım teslimi olmaz; yat, teslim alan kişi ve kapanış hesabı görülerek ayrı adımla bırakılır.
  s.post('/dosya/:id/tam-ziya-teslim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { teslimAlan?: string; aciklama?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT dosya_sorumlusu_ref, statu FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (d.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Tam ziya teslimini Dosya Sorumlusu kaydeder.' });
    if (d.statu === 'Kapalı') return y.code(409).send({ hata: 'Dosya kapalıdır.' });
    if (!g.teslimAlan?.trim()) return y.code(400).send({ hata: 'Yatı teslim alan kişi ve sıfatı zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM teslim_kaydi WHERE dosya_ref = $1 AND durum LIKE 'Teslim Edildi%' LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Teslim kaydı zaten vardır.' });
    return islem(async (c) => {
      const k = (await c.query(`INSERT INTO teslim_kaydi (dosya_ref, durum, teslim_eden_ref, teslim_alan, istisna_gerekcesi, teslim_zamani) VALUES ($1,'Teslim Edildi',$2,$3,$4,now()) RETURNING kimlik`, [id, o.kullanici, g.teslimAlan!.trim(), `Tam Ziya${g.aciklama?.trim() ? `: ${g.aciklama.trim()}` : ''}`])).rows[0];
      await c.query(`UPDATE teslim_kaydi SET durum = 'İptal' WHERE dosya_ref = $1 AND durum = 'Onay Bekliyor'`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Tam Ziya Teslimi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { teslimAlan: g.teslimAlan!.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: k.kimlik };
    });
  });

  // YG-079: kapanış hesabı (tam ziya dahil): onaylı, faturalı, tahsil edilen ve firma alacağı.
  s.get('/dosya/:id/kapanis-hesabi', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    const t = async (q: string) => Number((await b.db.query(q, [id])).rows[0].t);
    const onayli = await t(`SELECT coalesce(sum(k.tutar_eur), 0) t FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref WHERE f.dosya_ref = $1 AND k.onay_durumu = 'Onaylandı'`);
    const fatura = await t(`SELECT coalesce(sum(toplam_eur), 0) t FROM musteri_faturasi WHERE dosya_ref = $1 AND fatura_no IS NOT NULL`);
    const tahsil = await t(`SELECT coalesce(sum(tutar_eur), 0) t FROM tahsilat WHERE dosya_ref = $1`);
    const hakedis = await t(`SELECT coalesce(sum(net), 0) t FROM hakedis WHERE dosya_ref = $1 AND statu <> 'Reddedildi'`);
    const odenen = await t(`SELECT coalesce(sum(x.tutar_eur + x.mahsup_eur), 0) t FROM odeme_talimati x JOIN hakedis h ON h.kimlik = x.hakedis_ref WHERE h.dosya_ref = $1 AND x.durum = 'Ödendi'`);
    return { onayliKdvHaric: onayli, faturali: fatura, tahsil, acikAlacak: R2(fatura - tahsil), firmaHakedis: hakedis, firmayaOdenen: odenen, firmaBorcu: R2(hakedis - odenen) };
  });
}
