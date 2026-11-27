import type { FastifyInstance, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import { gorselMaskele } from './pdf.js';
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
const ONAYLAR = ['ONY-03', 'ONY-06', 'ONY-07', 'ONY-08', 'ONY-09', 'ONY-09Y', 'ONY-10']; // YG-1864: ONY-09Y yer değiştirme
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
  const bugun = new Date().toISOString().slice(0, 10); const s = (v: Date | string | null) => (v ? (typeof v === 'string' ? v.slice(0, 10) : v.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })) : null); // tarih alanı İstanbul günüyle (UTC kayması yok)
  // MTN-3 (CEO 26.11.2026): belge türü ve son tarihi; süresi dolmuşsa BLD-102S, geçerliyse dosya başına bir kez BLD-102.
  const belge = s(y.g) ? { tr: 'Yabancı Yat Belgesi', en: 'foreign yacht certificate', son: s(y.g)! } : s(y.i) ? { tr: 'Geçici İthalat İzni', en: 'temporary import permit', son: s(y.i)! } : null;
  if ((s(y.g) && s(y.g)! < bugun) || (s(y.i) && s(y.i)! < bugun)) {
    const dolan = s(y.g) && s(y.g)! < bugun ? { tr: 'Yabancı Yat Belgesi', en: 'foreign yacht certificate', son: s(y.g)! } : { tr: 'Geçici İthalat İzni', en: 'temporary import permit', son: s(y.i)! };
    await yabanciBilgilendir(db, dosya, 'BLD-102S', dolan, s(y.k));
    return 'Yabancı yat belgesinin süresi dolmuştur; iş emri planlanamaz.';
  }
  if (hedefBitis && s(y.k) && s(y.k)! < hedefBitis && !(await kalisBildir(db, dosya, hedefBitis, y.k))) return 'Planlanan bitiş Türkiye’de kalış süresini aşıyor; önce yat sahibine bildirim yapılmalıdır.';
  if (belge && s(y.k)) await yabanciBilgilendir(db, dosya, 'BLD-102', belge, s(y.k));
  return null;
}

/** MTN-3 (YG-099): yabancı bayraklı yatta belge ve kalış bilgilendirmesi (BLD-102) veya belge süresi dolmuş bildirimi (BLD-102S); dosya ve kod başına bir kez. */
async function yabanciBilgilendir(db: Db, dosya: string, kod: 'BLD-102' | 'BLD-102S', belge: { tr: string; en: string; son: string }, kalis: string | null): Promise<void> {
  const olay = `${kod.toLowerCase()}:${dosya}:${belge.son}`;
  if ((await db.query(`SELECT 1 FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`${olay}%`])).rowCount) return;
  const r = (await db.query(`SELECT d.dosya_no, d.yazisma_dili, d.vefat_isareti, y.yat_adi, t.telefon, t.eposta FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE d.kimlik = $1 ORDER BY (t.telefon IS NOT NULL) DESC LIMIT 1`, [dosya])).rows[0];
  if (!r || r.vefat_isareti || (!r.telefon && !r.eposta)) return;
  const bs = gunAy(belge.son); const ks = kalis ? gunAy(kalis) : '';
  await yatTarafinaYaz(db, { olay, kod, dil: dilKod(r.yazisma_dili), konu: `${r.dosya_no} Belge ve Kalış Süresi`, telefon: r.telefon, eposta: r.eposta, alanlar: { Yat: r.yat_adi, Yacht: r.yat_adi, 'Belge türü': belge.tr, 'Document type': belge.en, 'belge sonu': bs, 'document end': bs, 'kalış sonu': ks, 'stay end': ks } });
}

/** YG-1446 (D-063): kalış süresi aşımında yat sahibine BLD-53 kendiliğinden gider (doğan görev: Dosya Sorumlusu arar); gitmişse veya gönderildiyse true. */
async function kalisBildir(db: Db, dosya: string, hedefBitis: string, kalis: Date | string): Promise<boolean> {
  const olay = `bld53:${dosya}:${hedefBitis}`;
  if ((await db.query(`SELECT 1 FROM gonderim WHERE olay_anahtari LIKE $1 LIMIT 1`, [`${olay}%`])).rowCount) return true;
  const r = (await db.query(`SELECT d.dosya_no, d.yazisma_dili, d.vefat_isareti, y.yat_adi, t.telefon, t.eposta FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE d.kimlik = $1 ORDER BY (t.telefon IS NOT NULL OR t.eposta IS NOT NULL) DESC LIMIT 1`, [dosya])).rows[0];
  if (!r || r.vefat_isareti || (!r.telefon && !r.eposta)) return false;
  const tarih = [gunAy(hedefBitis), gunAy(kalis)];
  await yatTarafinaYaz(db, { olay, kod: 'BLD-53', dil: dilKod(r.yazisma_dili), konu: `${r.dosya_no} Türkiye’de Kalış Süresi`, telefon: r.telefon, eposta: r.eposta, alanlar: { Yat: r.yat_adi, Yacht: r.yat_adi, tarih, date: tarih, 'Dosya No': r.dosya_no, 'File No': r.dosya_no } });
  return true;
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
  // YG-550: hazır bildiriminden 30. gün yazılı ihtar görevi ve risk geçişi kaydı; 90. gün tevdi veya satış değerlendirmesi (Hukuk ve Uyum Direktörü, Dosya Sorumlusuna bilgi).
  for (const [gun, anahtar] of [[30, 'teslim_30'], [90, 'teslim_90']] as const) {
    for (const d of (await db.query(`SELECT d.kimlik, d.dosya_no, d.dosya_sorumlusu_ref, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.teslime_hazir_zamani <= $1::timestamptz - make_interval(days => $2) AND NOT EXISTS (SELECT 1 FROM teslim_kaydi k WHERE k.dosya_ref = d.kimlik AND k.durum LIKE 'Teslim Edildi%')`, [simdi, gun])).rows) {
      if (!(await birKez(db, anahtar, d.kimlik))) continue;
      const hud = await rolId(db, 'Hukuk ve Uyum Direktörü');
      if (gun === 30) {
        await db.query(`UPDATE dosya SET teslim_risk_gecis_zamani = coalesce(teslim_risk_gecis_zamani, $2) WHERE kimlik = $1`, [d.kimlik, simdi]);
        await kartAc(db, { tur: 'Teslim Alınmayan Yat İhtarı', kategori: 'gorev', baslik: `${d.dosya_no} · 30. Gün Yazılı İhtar`, ozet: `${d.yat_adi} hazır bildiriminden 30 gün sonra teslim alınmadı; yazılı ihtar hazırlanır, risk geçişi kaydedildi.`, oncelik: 'Yüksek', sahipRol: hud, nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
      } else await kartAc(db, { tur: 'Tevdi veya Satış Değerlendirmesi', kategori: 'gorev', baslik: `${d.dosya_no} · 90. Gün Tevdi veya Satış Değerlendirmesi`, ozet: `${d.yat_adi} hazır bildiriminden 90 gün sonra teslim alınmadı; tevdi veya satış yolu değerlendirilir.`, oncelik: 'Yüksek', sahipRol: hud, nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
      if (d.dosya_sorumlusu_ref) await (await import('./bildirim.js')).bildir(db, { olay: `${anahtar}:${d.kimlik}`, kullanicilar: [d.dosya_sorumlusu_ref], baslik: `${d.dosya_no} · Teslim Alınmayan Yat (${gun}. gün)`, ozet: gun === 30 ? 'Yazılı ihtar görevi Hukuk ve Uyum Direktörüne açıldı.' : 'Tevdi veya satış değerlendirmesi Hukuk ve Uyum Direktörüne açıldı.' });
      n++;
    }
  }
  return n;
}

/** YG-555, YG-787: RP-RAP-006 Müşteri İlerleme Özeti PDF'i; firma adı, fiyat, maliyet ve iç not içermez. Dosya belgesi olarak saklanır, sürüm kimliği döner. */
async function ilerlemeOzetiPdf(b: Baglam, yapan: string, id: string, d: { dosya_no: string; yat_adi: string; yazisma_dili: string | null }, v: { tarih: string; oran: string; teslim: string; sonraki: string; fotolar: { gorsel_no: string; cekim_kalemi: string; bolge_kodu: string | null; depo_anahtari: string; uzanti: string }[] }): Promise<string> {
  const { pdfUret } = await import('./pdf.js'); const dil = dilKod(d.yazisma_dili ?? 'Türkçe') === 'en' ? 'en' : 'tr'; const en = dil === 'en';
  const depo = b.depo ?? new Depo();
  const bolumler: import('./pdf.js').Bolum[] = [{ baslik: en ? 'Progress' : 'İlerleme', tur: 'alanlar', alanlar: [
    { et: en ? 'Yacht' : 'Yat', deger: d.yat_adi }, { et: en ? 'File No' : 'Dosya No', deger: d.dosya_no }, { et: en ? 'Date' : 'Tarih', deger: v.tarih },
    { et: en ? 'Physical Progress' : 'Fiziksel İlerleme', deger: `%${v.oran}` }, { et: en ? 'Estimated Delivery' : 'Tahmini Teslim', deger: v.teslim }, { et: en ? 'Next Step' : 'Sonraki Adım', deger: v.sonraki, genis: true }] }];
  for (const f of v.fotolar) {
    try {
      const parca: Buffer[] = []; for await (const x of depo.bagla(f.depo_anahtari)) parca.push(x as Buffer);
      bolumler.push({ baslik: `${f.gorsel_no} · ${f.cekim_kalemi}${f.bolge_kodu ? ` · ${f.bolge_kodu}` : ''}`, tur: 'gorsel', src: `data:image/${String(f.uzanti).toLowerCase() === 'png' ? 'png' : 'jpeg'};base64,${Buffer.concat(parca).toString('base64')}` });
    } catch { /* depoda bulunmayan görsel PDF'e eklenmez */ }
  }
  const tanim = { ad: en ? 'Customer Progress Summary' : 'Müşteri İlerleme Özeti', kod: 'RP-RAP-006', no: `${d.dosya_no}-RAP006-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`, dosyaNo: d.dosya_no, yat: d.yat_adi, tarih: v.tarih, surum: 'Rev.1', dil, kase: true, bolumler } as import('./pdf.js').BelgeTanim;
  const pdf = await pdfUret(tanim); const al = await depo.al(Readable.from(pdf), pdf.length + 1); const anahtar = depo.yerlestir(al.yol, al.ozet);
  const be = (await b.db.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'Müşteri İlerleme Özeti','Gizli','Dosya',$2,'Sistem',(now() AT TIME ZONE 'Europe/Istanbul')::date,$3) RETURNING kimlik`, [`${tanim.ad} ${tanim.no}`, id, yapan])).rows[0].kimlik;
  return (await b.db.query(`INSERT INTO belge_surum (belge_ref, surum_no, dosya_adi, uzanti, boyut, ozet_sha256, depo_anahtari, tarama_kaynagi, yukleyen_ref, durum, onay_zamani) VALUES ($1,1,$2,'pdf',$3,$4,$5,'Sistem',$6,'Yürürlükte',now()) RETURNING kimlik`, [be, `${tanim.no}.pdf`, pdf.length, al.ozet, anahtar, yapan])).rows[0].kimlik as string;
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
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ony?: string; parca?: string; tutar?: number; zaman?: string; mevcutYer?: string; yeniYer?: string; kayitNo?: string; teklifNo?: string; yapilmayanIs?: string; teknikEtki?: string; kullanimSiniri?: string; onerilenKontrol?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!ONAYLAR.includes(g.ony ?? '')) return y.code(400).send({ hata: 'Onay türünü seçmenizi rica ederiz.' });
    if (['ONY-07', 'ONY-08'].includes(g.ony!) && !g.parca?.trim()) return y.code(400).send({ hata: 'Parça adını yazmanızı rica ederiz.' });
    if (g.ony === 'ONY-08' && !(Number(g.tutar) > 0)) return y.code(400).send({ hata: 'Parça bedelini yazmanızı rica ederiz.' });
    if (g.ony === 'ONY-09' && !g.zaman) return y.code(400).send({ hata: 'Deneme tarih ve saatini yazmanızı rica ederiz.' });
    if (g.ony === 'ONY-09Y' && (!g.zaman || !g.mevcutYer?.trim() || !g.yeniYer?.trim())) return y.code(400).send({ hata: 'Taşıma tarih ve saatini, mevcut ve yeni yeri yazmanızı rica ederiz.' }); // YG-1864
    if (g.ony === 'ONY-10' && !g.kayitNo?.trim()) return y.code(400).send({ hata: 'Garanti kayıt numarasını yazmanızı rica ederiz.' });
    if (g.ony === 'ONY-06' && !g.teklifNo?.trim()) return y.code(400).send({ hata: 'Teklif numarasını yazmanızı rica ederiz.' });
    // YG-726: kullanım sınırı bildirimi alanları (yapılmayan iş, olası teknik etki, kullanım sınırı, önerilen kontrol).
    if (g.ony === 'ONY-06' && (!g.yapilmayanIs?.trim() || !g.teknikEtki?.trim() || !g.kullanimSiniri?.trim() || !g.onerilenKontrol?.trim())) return y.code(400).send({ hata: 'Yapılmayan iş, olası teknik etki, kullanım sınırı ve önerilen kontrol zorunludur.' });
    if (g.ony === 'ONY-09') { const he = await hizaEngeli(b.db, id); if (he) return y.code(409).send({ hata: he }); } // YG-409
    const d = await dosya(id); const t = await sahip(id);
    if (!t) return y.code(409).send({ hata: 'Yat sahibi kaydı bulunamadı.' });
    const dil = dilKod(d.yazisma_dili); const web = b.webAdresi; const ts = tutar(Number(g.tutar ?? 0), dil);
    const zm = g.zaman ? new Date(g.zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' }) : '';
    const alanlar = { 'mevcut yer': g.mevcutYer?.trim() ?? '', 'current place': g.mevcutYer?.trim() ?? '', 'yeni yer': g.yeniYer?.trim() ?? '', 'new place': g.yeniYer?.trim() ?? '', 'Dosya No': d.dosya_no, 'File No': d.dosya_no, Yat: d.yat_adi, Yacht: d.yat_adi, 'bağlantı': web, link: web, 'Parça adı': g.parca ?? '', 'Part name': g.parca ?? '', '0.000,00': ts, '0,000.00': ts, 'tarih saat': zm, 'date time': zm, 'Kayıt No': g.kayitNo ?? '', 'Record No': g.kayitNo ?? '', 'Teklif No / Sürüm': g.teklifNo ?? '', 'Quotation No / Version': g.teklifNo ?? '' };
    return islem(async (c) => {
      const on = await onayTalebiAc(c, { dosya: id, ony: g.ony!, dil, alanlar, baslikAlanlari: alanlar, tutar: g.ony === 'ONY-08' ? g.tutar : null, taraf: t.kimlik, kullanici: t.kullanici_ref, aliciAd: t.kisi_adi_soyadi, telefon: t.telefon, eposta: t.eposta, nesneTuru: 'Dosya', nesneKimligi: id, hazirlayan: o.kullanici, webAdresi: web, konu: `${d.dosya_no} Onayınız Bekleniyor` });
      if (g.ony === 'ONY-06') await c.query(`INSERT INTO ek_is_reddi (dosya_ref, onay_talebi_ref, teklif_no, yapilmayan_is, teknik_etki, kullanim_siniri, onerilen_kontrol, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, on.kimlik, g.teklifNo!.trim(), g.yapilmayanIs!.trim(), g.teknikEtki!.trim(), g.kullanimSiniri!.trim(), g.onerilenKontrol!.trim(), o.kullanici]); // YG-726
      return { kimlik: on.kimlik };
    });
  });
  // YG-472: bireysel ve sigortasız dosyada Acil İlk Tedbir talebi; sigortalıda varyant yoktur. Firma adı yazılmaz.
  s.post('/acil/:dosya/ilk-tedbir-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { dosya: id } = i.params as { dosya: string }; const rol = ((i.body ?? {}) as { alici?: string }).alici === 'Kaptan' ? 'Kaptan' : 'Yat Sahibi';
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = await dosya(id);
    if (rol !== 'Kaptan' && d.dosya_niteligi === 'Sigorta bağlantılı') return y.code(409).send({ hata: 'Sigortalı dosyada tedbir hemen uygulanır; onay ekranı gönderilmez.' }); // YG-472: kaptan izni (ONY-31) her dosyada
    const t = (await b.db.query(`SELECT kimlik, kisi_adi_soyadi, telefon, eposta, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = $2 AND aktif LIMIT 1`, [id, rol])).rows[0];
    if (!t) return y.code(409).send({ hata: `${rol} kaydı bulunamadı.` });
    return islem(async (c) => {
      const on = await onayTalebiAc(c, { dosya: id, ony: rol === 'Kaptan' ? 'ONY-31' : 'ONY-28', dil: dilKod(d.yazisma_dili), alanlar: { Yat: d.yat_adi, Yacht: d.yat_adi, 'Dosya No': d.dosya_no, 'File No': d.dosya_no }, /* YG-472: kaptana bedelsiz ONY-31 */ taraf: t.kimlik, kullanici: t.kullanici_ref, aliciAd: t.kisi_adi_soyadi, telefon: t.telefon, eposta: t.eposta, nesneTuru: 'Dosya', nesneKimligi: id, hazirlayan: o.kullanici, webAdresi: b.webAdresi, konu: `${d.dosya_no} Acil İlk Tedbir` });
      return { kimlik: on.kimlik };
    });
  });

  // YG-415: teslim bildiriminden önce yetkili alıcı (aktif Yat Sahibi veya yetki kaydı olan Yetkili Temsilci) ayrı adımda doğrulanır.
  s.get('/dosya/:id/teslim-alicilari', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT t.kimlik, t.taraf_rolu, t.kisi_adi_soyadi, EXISTS (SELECT 1 FROM yetki_kaydi k WHERE k.dosya_tarafi_ref = t.kimlik) yetki_kaydi, (SELECT json_build_object('yontem', d.yontem, 'zaman', d.zaman) FROM teslim_alici_dogrulama d WHERE d.dosya_tarafi_ref = t.kimlik ORDER BY d.zaman DESC LIMIT 1) dogrulama FROM dosya_tarafi t WHERE t.dosya_ref = $1 AND t.aktif AND t.taraf_rolu IN ('Yat Sahibi', 'Yetkili Temsilci') ORDER BY t.taraf_rolu DESC, t.kisi_adi_soyadi`, [id])).rows;
  });
  s.post('/dosya/:id/teslim-alici-dogrula', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { alici?: string; yontem?: string; aciklama?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const t = UUID.test(g.alici ?? '') ? (await b.db.query(`SELECT kimlik, taraf_rolu, kisi_adi_soyadi, EXISTS (SELECT 1 FROM yetki_kaydi k WHERE k.dosya_tarafi_ref = dosya_tarafi.kimlik) yetkili FROM dosya_tarafi WHERE kimlik = $1 AND dosya_ref = $2 AND aktif AND taraf_rolu IN ('Yat Sahibi', 'Yetkili Temsilci')`, [g.alici, id])).rows[0] : undefined;
    if (!t) return y.code(400).send({ hata: 'Teslim alacak kişiyi dosyadaki yat sahibi veya yetkili temsilciler arasından seçiniz.' });
    if (!['Kimlik Belgesi', 'Yetki Belgesi', 'Portal Hesabı', 'Kayıtlı Telefonla Geri Arama'].includes(g.yontem ?? '')) return y.code(400).send({ hata: 'Doğrulama yöntemini seçiniz.' });
    if (t.taraf_rolu === 'Yetkili Temsilci' && !t.yetkili) return y.code(409).send({ hata: 'Yetkili temsilcinin yetki kaydı doğrulanmadan teslim alıcısı olarak onaylanamaz.' });
    await b.db.query(`INSERT INTO teslim_alici_dogrulama (dosya_ref, dosya_tarafi_ref, yontem, aciklama, dogrulayan_ref) VALUES ($1,$2,$3,$4,$5)`, [id, t.kimlik, g.yontem, g.aciklama?.trim() || null, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teslim Alıcısı Doğrulandı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { alici: t.kisi_adi_soyadi, rol: t.taraf_rolu, yontem: g.yontem }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-481: hazır bildirimi BLD-12; 7 takvim günü sayılır.
  // YG-1867: teslim alınmayan yatın barınma gideri tutarını Ticari Sorumlu elle girer; Barınma Gideri görevi kapanır.
  s.post('/dosya/:id/barinma-gideri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tutar?: number };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)'`, [o.kullanici])).rowCount) return y.code(403).send({ hata: 'Barınma giderini Ticari Sorumlu girer.' });
    if (!(Number(g.tutar) >= 0) || g.tutar === undefined || g.tutar === null) return y.code(400).send({ hata: 'Barınma gideri tutarını giriniz.' });
    if (!(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND teslim_son_tarihi IS NOT NULL AND teslim_son_tarihi < current_date`, [id])).rowCount) return y.code(409).send({ hata: 'Barınma gideri, teslim için verilen sürenin dolmasından sonra girilir.' });
    await b.db.query(`UPDATE dosya SET barinma_gideri_eur = $2, barinma_gideri_giren_ref = $3, barinma_gideri_zamani = now() WHERE kimlik = $1`, [id, Number(g.tutar), o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Barınma Gideri' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    return { tamam: true };
  });
  // YG-551: Bilgi ve Belge Talebi (BLD-17) ve Ulaşılamama (BLD-18); Dosya Sorumlusu gönderir. Belge adresi operasyon kutusudur (CEO 18.11.2026); BLD-18 telefonu kurumsal hat bildirilene kadar Dosya Sorumlusunun telefonudur.
  const OPERASYON_EPOSTA = 'operasyon@limitglobalmarine.com.tr';
  s.post('/dosya/:id/belge-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belgeler?: string[]; ulasilamadi?: boolean; eksikler?: boolean; sonTarih?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g.ulasilamadi && (!/^\d{4}-\d{2}-\d{2}$/.test(g.sonTarih ?? '') || g.sonTarih! < new Date().toISOString().slice(0, 10))) return y.code(400).send({ hata: 'Belgelerin iletilmesi için son tarihi (bugün veya sonrası) seçiniz.' }); // MTN-5
    const d = (await b.db.query(`SELECT d.dosya_no, d.yazisma_dili, d.vefat_isareti, h.e_posta, h.cep_telefonu FROM dosya d JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref WHERE d.kimlik = $1 AND d.dosya_sorumlusu_ref = $2`, [id, o.kullanici])).rows[0];
    if (!d) return y.code(403).send({ hata: 'Belge talebini Dosya Sorumlusu gönderir.' });
    if (d.vefat_isareti) return y.code(409).send({ hata: 'Vefat işaretli dosyada otomatik ileti gönderilmez.' });
    const t = await sahip(id); if (!t || (!t.telefon && !t.eposta)) return y.code(409).send({ hata: 'Yat sahibinin iletişim bilgisi bulunamadı.' });
    const gun = new Date().toISOString().slice(0, 16);
    if (g.ulasilamadi) {
      if (!d.cep_telefonu) return y.code(409).send({ hata: 'Telefon numaranız hesabınızda kayıtlı değildir.' });
      await yatTarafinaYaz(b.db, { olay: `bld18:${id}:${gun}`, kod: 'BLD-18', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Bilgilendirme`, telefon: t.telefon, eposta: t.eposta, alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, telefon: d.cep_telefonu, phone: d.cep_telefonu } });
    } else {
      // YG-1439: "Eksik Belgeleri İste" sistemin belge listesindeki eksik zorunlu belgeleri tek mesajda ister.
      const l = g.eksikler ? (await (await import('./portal.js')).belgeListesi(b.db, id)).filter((x) => x.zorunlu && x.durum === 'Eksik').map((x) => x.belge) : (g.belgeler ?? []).map((x) => String(x).trim()).filter(Boolean);
      if (!l.length) return y.code(g.eksikler ? 409 : 400).send({ hata: g.eksikler ? 'Eksik zorunlu belge bulunmamaktadır.' : 'İstenen belgeleri yazınız.' });
      await yatTarafinaYaz(b.db, { olay: `${g.eksikler ? 'bld17e' : 'bld17'}:${id}:${gun}`, kod: 'BLD-17', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Belge Talebi`, telefon: t.telefon, eposta: t.eposta, alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, liste: l.join(', '), list: l.join(', '), 'e-posta': OPERASYON_EPOSTA, 'e-mail': OPERASYON_EPOSTA, 'son tarih': g.sonTarih!.split('-').reverse().join('.'), deadline: g.sonTarih!.split('-').reverse().join('.') } });
    }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: g.ulasilamadi ? 'Ulaşılamama Bildirimi' : 'Belge Talebi Gönderildi', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // YG-555, YG-787 (BLD-93, CEO 17.11.2026): Müşteri İlerleme Özeti; yalnız fiziksel ilerleme; firma, fiyat ve finansal oran yazılmaz; sigortaya e-postayla gitmez (MT-6).
  s.post('/dosya/:id/ilerleme-ozeti', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonrakiAdim?: string; gorseller?: string[] };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND dosya_sorumlusu_ref = $2`, [id, o.kullanici])).rowCount) return y.code(403).send({ hata: 'İlerleme Özetini Dosya Sorumlusu gönderir.' });
    if (!g.sonrakiAdim?.trim()) return y.code(400).send({ hata: 'Sonraki adımı yazınız.' });
    // YG-555: seçili fotoğraflar (en çok 6) dosyanın görsel kanıtlarından; gizlilik denetiminden geçmeyen fotoğraf eklenmez.
    const secili = [...new Set((g.gorseller ?? []).filter((x) => typeof x === 'string'))];
    if (secili.length > 6) return y.code(400).send({ hata: 'En çok 6 fotoğraf seçiniz.' });
    const fotolar = secili.length ? (await b.db.query(`SELECT k.gorsel_no, k.cekim_kalemi, k.bolge_kodu, s.kimlik surum, s.depo_anahtari, s.uzanti FROM gorsel_kanit k JOIN LATERAL (SELECT * FROM belge_surum WHERE belge_ref = k.belge_ref ORDER BY surum_no DESC LIMIT 1) s ON true WHERE k.dosya_ref = $1 AND k.gorsel_no = ANY($2) ORDER BY k.gorsel_no`, [id, secili])).rows : [];
    if (fotolar.length !== secili.length) return y.code(400).send({ hata: 'Fotoğraflar bu dosyanın görsel kayıtlarından seçilir.' });
    if (fotolar.length) { const h = await (await import('./gorsel_gizlilik.js')).hassasEkEngeli(b.db, fotolar.map((f) => f.surum)); if (h) return y.code(409).send({ hata: h }); }
    const d = (await b.db.query(`SELECT d.dosya_no, d.hizmet_turu, d.ilerleme_yuzdesi, d.tahmini_teslim_tarihi::text teslim, d.yazisma_dili, d.vefat_isareti, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [id])).rows[0];
    if (/kurtarma/i.test(d.hizmet_turu ?? '')) return y.code(409).send({ hata: 'Kurtarma dosyasında İlerleme Özeti gönderilmez.' });
    const t = await sahip(id); if (!t || (!t.telefon && !t.eposta)) return y.code(409).send({ hata: 'Yat sahibinin iletişim bilgisi bulunamadı.' });
    if (d.vefat_isareti) return y.code(409).send({ hata: 'Vefat işaretli dosyada otomatik ileti gönderilmez.' });
    const tr = gunAy(new Date()); const oran = String(Math.floor(Number(d.ilerleme_yuzdesi ?? 0))); const tes = d.teslim ? gunAy(d.teslim) : '-';
    const ek = await ilerlemeOzetiPdf(b, o.kullanici, id, d, { tarih: tr, oran, teslim: tes, sonraki: g.sonrakiAdim.trim(), fotolar }); // YG-555: RP-RAP-006
    await yatTarafinaYaz(b.db, { olay: `bld93:${id}:${new Date().toISOString().slice(0, 10)}`, kod: 'BLD-93', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Müşteri İlerleme Özeti`, telefon: t.telefon, eposta: t.eposta, ekler: [ek],
      alanlar: { Yat: d.yat_adi, Yacht: d.yat_adi, tarih: tr, date: tr, oran, rate: oran, 'sonraki adım': g.sonrakiAdim.trim(), 'next step': g.sonrakiAdim.trim(), 'teslim tarihi': tes, 'delivery date': tes, 'bağlantı': b.webAdresi, link: b.webAdresi } });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'İlerleme Özetini Gönder' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Müşteri İlerleme Özeti Gönderildi', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true, belgeSurumu: ek };
  });
  s.post('/dosya/:id/teslime-hazir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = await dosya(id); const t = await sahip(id);
    if (d.teslime_hazir_zamani) return y.code(409).send({ hata: 'Hazır bildirimi yapılmıştır.' });
    if (!(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND dosya_sorumlusu_ref = $2`, [id, o.kullanici])).rowCount) return y.code(403).send({ hata: 'Teslime Hazır bildirimini dosyanın Dosya Sorumlusu yapar.' }); // YG-1867
    if (!(await b.db.query(`SELECT 1 FROM teslim_alici_dogrulama WHERE dosya_ref = $1`, [id])).rowCount) return y.code(409).send({ hata: 'Teslim bildiriminden önce yetkili alıcıyı doğrulayınız.', islem: 'Alıcıyı Doğrula', hedef: 'ta-a' }); // YG-1386 // YG-415
    const son = new Date(Date.now() + TESLIM_GUN * 86_400_000); const gs = son.toISOString().slice(0, 10); const tr = gunAy(son);
    return islem(async (c) => {
      await c.query(`UPDATE dosya SET teslime_hazir_zamani = now(), teslim_son_tarihi = $2 WHERE kimlik = $1`, [id, gs]);
      // YG-480: portal hesabı olan yat sahibi/temsilciye sistem içi bildirim de gider (e-posta/SMS BLD-12 ile).
      const pk = (await c.query(`SELECT DISTINCT kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif AND kullanici_ref IS NOT NULL AND taraf_rolu IN ('Yat Sahibi', 'Yetkili Temsilci')`, [id])).rows.map((r) => r.kullanici_ref as string);
      if (pk.length && !d.vefat_isareti) await (await import('./bildirim.js')).bildir(c, { olay: `teslime-hazir:${id}`, kullanicilar: pk, baslik: `${d.yat_adi} Teslime Hazır`, ozet: `Son teslim tarihi: ${tr}` });
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
  // YG-1433: teslim alan YATONET 360 onayı veremiyorsa (sistem erişimi yok) ıslak imzalı tutanak taranıp yüklenir; teslim onaylı sayılır, kayıt belge sürümüyle tutulur.
  s.post('/dosya/:id/teslim-islak-imza', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { aliciTuru?: string; alici?: string; belge?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!['Yat Sahibi', 'Yetkili Temsilci'].includes(g.aliciTuru ?? '') || !g.alici?.trim()) return y.code(400).send({ hata: 'Teslim alanı girmenizi rica ederiz.' });
    if (!(await dosyaBelgesi(g.belge, id))) return y.code(400).send({ hata: 'Islak imzalı taranmış teslim tutanağını yükleyip seçiniz.' });
    if (await (await import('./belge_kural.js')).bilgiBelgesiMi(b.db, g.belge!)) return y.code(409).send({ hata: (await import('./belge_kural.js')).BILGI_HATA }); // YG-622
    if (g.aliciTuru === 'Yetkili Temsilci' && !(await b.db.query(`SELECT 1 FROM yetki_kaydi y JOIN dosya_tarafi x ON x.kimlik = y.dosya_tarafi_ref WHERE y.dosya_ref = $1 AND lower(x.kisi_adi_soyadi) = lower($2) AND y.yetki_durumu = 'Geçerli' AND (y.gecerlilik_bitisi IS NULL OR y.gecerlilik_bitisi >= current_date)`, [id, g.alici.trim()])).rowCount) return y.code(409).send({ hata: 'Yetkili temsilcinin geçerli yetki kaydı bulunmamaktadır.' }); // YG-414
    const k = (await b.db.query(`SELECT kimlik FROM teslim_kaydi WHERE dosya_ref = $1 AND durum = 'Onay Bekliyor' LIMIT 1`, [id])).rows[0];
    if (!k) return y.code(409).send({ hata: 'Onay bekleyen teslim kaydı yoktur.' });
    return islem(async (c) => {
      await c.query(`UPDATE teslim_kaydi SET durum = 'Teslim Edildi', teslim_alan = $2, alici_turu = $3, islak_imzali_belge_ref = $4, teslim_zamani = now() WHERE kimlik = $1`, [k.kimlik, g.alici!.trim(), g.aliciTuru, g.belge]);
      await c.query(`UPDATE onay_talebi SET durum = 'İptal' WHERE dosya_ref = $1 AND ony_kod = 'ONY-27' AND durum = 'Bekliyor'`, [id]);
      const { belgeUret } = await import('./belge_uret.js');
      await belgeUret(c, { tur: 'Teslim Tutanağı', nesne: k.kimlik, dosya: id });
      await belgeUret(c, { tur: 'Garanti Belgesi', nesne: k.kimlik, dosya: id });
      await (await import('./portallar.js')).tesisSerbestBirak(c, id, g.alici!.trim()); // YG-554
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teslim – Islak İmzalı Tutanak', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { alici: g.alici, tur: g.aliciTuru, belge: g.belge }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { durum: 'Teslim Edildi' };
    });
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
    if (!(await (await import('./is_emri_bag.js')).isEmriGecerli(b.db, id, ((i.body ?? {}) as { isEmri?: string }).isEmri))) return y.code(400).send({ hata: 'İş emri bu dosyada bulunamadı veya geçerli değildir.' }); // YG-384
    if (!((i.body ?? {}) as { isEmri?: string }).isEmri) { const ke = await (await import('./saha.js')).kesifIzinEngeli(b.db, id, 'Söküm'); if (ke) return y.code(409).send({ hata: ke }); } // YG-056
    const r = await b.db.query(`INSERT INTO sokulen_parca (dosya_ref, parca_adi, konum, son_tarih, giren_ref) VALUES ($1,$2,$3,(now() AT TIME ZONE 'Europe/Istanbul')::date + $4::int,$5) RETURNING kimlik`, [id, g.ad.trim(), g.konum?.trim() || null, PARCA_GUN, o.kullanici]);
    await (await import('./is_emri_bag.js')).isEmriBagla(b.db, 'sokulen_parca', r.rows[0].kimlik, id, ((i.body ?? {}) as { isEmri?: string }).isEmri); // YG-384
    return { kimlik: r.rows[0].kimlik };
  });
  s.get('/dosya/:id/sokulen-parca', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; const k = i.oturum!.kullanici;
    if (!UUID.test(id) || !((await dosyaErisimi(b.db, k, id)) || (await musteriMi(id, k)))) return yok(y);
    return (await b.db.query(`SELECT kimlik, parca_adi, konum, secim, son_tarih::text, sonuc, sonuc_zamani FROM sokulen_parca WHERE dosya_ref = $1 ORDER BY olusturma_zamani`, [id])).rows;
  });
  // YG-730: teslim veya imha fotoğrafla kayda alınır, imza alınmaz; sigortalı dosyada imha sigorta şirketinin onay belgesiyle yapılır.
  s.post('/sokulen-parca/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { foto?: string; sigortaOnay?: string; akibet?: string };
    if (!UUID.test(id)) return yok(y);
    const p = (await b.db.query(`SELECT p.*, d.dosya_niteligi FROM sokulen_parca p JOIN dosya d ON d.kimlik = p.dosya_ref WHERE p.kimlik = $1`, [id])).rows[0];
    if (!p || !(await dosyaErisimi(b.db, o.kullanici, p.dosya_ref))) return yok(y);
    if (p.sonuc) return y.code(409).send({ hata: 'Parçanın sonucu kayıtlıdır.' });
    if (!p.secim) return y.code(409).send({ hata: 'Önce parçanın seçimi yapılmalıdır.' });
    // YG-406: akıbet altı değerden biridir; Hurda ve Çevresel Bertaraf imhadır.
    const AKIBET = ['Yeniden Kullanım', 'İnceleme-Delil', 'Müşteriye İade', 'Garanti İadesi', 'Hurda', 'Çevresel Bertaraf'];
    const akibet = g.akibet ?? (p.secim === 'İade' ? 'Müşteriye İade' : p.secim === 'Hurda-Bertaraf' ? 'Hurda' : '');
    if (!AKIBET.includes(akibet)) return y.code(400).send({ hata: `Akıbeti seçiniz: ${AKIBET.join(', ')}.` });
    const dosyaBelgesi = async (x?: string) => Boolean(x && UUID.test(x) && (await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2::text`, [x, p.dosya_ref])).rowCount);
    if (!(await dosyaBelgesi(g.foto))) return y.code(400).send({ hata: 'Teslim veya imha fotoğrafını dosyaya yükleyip seçiniz.' });
    const imha = akibet === 'Hurda' || akibet === 'Çevresel Bertaraf';
    if (imha && p.dosya_niteligi === 'Sigorta bağlantılı' && !(await dosyaBelgesi(g.sigortaOnay))) return y.code(409).send({ hata: 'Sigortalı dosyada imha için sigorta şirketinin onay belgesini seçiniz.' });
    await b.db.query(`UPDATE sokulen_parca SET sonuc = $2, sonuc_foto_ref = $3, sigorta_onay_ref = $4, sonuc_kaydeden_ref = $5, sonuc_zamani = now() WHERE kimlik = $1`, [id, akibet, g.foto, imha ? g.sigortaOnay ?? null : null, o.kullanici]);
    return { sonuc: akibet };
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
  /** YG-1079: teslim sonrası arıza bildirimi; bildiren taraf özete yazılır, Dosya Sorumlusuna Garanti Talebi görevi açılır. */
  const arizaBildir = async (id: string, belirti: string, bildiren: string, o: { kullanici: string; oturum: string }, ip: string, iliski: string) => {
    const d = (await b.db.query(`SELECT dosya_no, dosya_sorumlusu_ref, teslim_tarihi FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (!d) return { kod: 404, hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' };
    if (!d.teslim_tarihi) return { kod: 409, hata: 'Arıza bildirimi teslimden sonra açılır; devam eden işler için Dosya Sorumlusuyla iletişime geçiniz.' };
    await kartAc(b.db, { tur: 'Garanti Talebi', kategori: 'islem', baslik: `${d.dosya_no} · ${bildiren} Arıza Bildirimi`, ozet: belirti, oncelik: 'Yüksek', ...(d.dosya_sorumlusu_ref ? { sahipKullanici: d.dosya_sorumlusu_ref } : { sahipRol: await rolId(b.db, 'Operasyon Müdürü') }), nesneTuru: 'Dosya', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Arıza Bildirimi', nesneTuru: 'Dosya', nesneKimligi: id, gerekce: belirti, sonuc: 'Başarılı', adres: ip, iliski, kanal: 'Portal' });
    return null;
  };
  s.post('/sigorta/dosya/:id/ariza-bildirimi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const belirti = ((i.body ?? {}) as { belirti?: string }).belirti?.trim();
    const sir = (await b.db.query(`SELECT sigortaci_adi FROM sigorta_kullanici WHERE kullanici_ref = $1`, [o.kullanici])).rows[0]?.sigortaci_adi as string | undefined;
    if (!UUID.test(id) || (!sir && !o.grup.startsWith('Sigorta'))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya d LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik WHERE d.kimlik = $3 AND (lower(s.sigortaci_adi) = lower($1) OR EXISTS (SELECT 1 FROM dosya_tarafi e WHERE e.dosya_ref = d.kimlik AND e.taraf_rolu = 'Eksper' AND e.kullanici_ref = $2 AND e.aktif))`, [sir ?? '', o.kullanici, id])).rowCount) return yok(y);
    if (!belirti) return y.code(400).send({ hata: 'Arızayı kısaca yazmanızı rica ederiz.' });
    const h = await arizaBildir(id, belirti, 'Sigorta Şirketinden', o, i.ip, i.id); if (h) return y.code(h.kod).send({ hata: h.hata });
    return { durum: 'İletildi' };
  });
  s.post('/broker/dosya/:id/ariza-bildirimi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const belirti = ((i.body ?? {}) as { belirti?: string }).belirti?.trim();
    // Broker/acente yalnız geçerli yetki kaydı olan dosyada bildirir.
    if (!UUID.test(id) || !(await b.db.query(`SELECT 1 FROM dosya_tarafi t JOIN yetki_kaydi k ON k.dosya_tarafi_ref = t.kimlik WHERE t.dosya_ref = $1 AND t.kullanici_ref = $2 AND t.aktif AND k.yetki_durumu = 'Geçerli' AND (k.gecerlilik_bitisi IS NULL OR k.gecerlilik_bitisi >= current_date)`, [id, o.kullanici])).rowCount) return yok(y);
    if (!belirti) return y.code(400).send({ hata: 'Arızayı kısaca yazmanızı rica ederiz.' });
    const h = await arizaBildir(id, belirti, 'Broker/Acenteden', o, i.ip, i.id); if (h) return y.code(h.kod).send({ hata: h.hata });
    return { durum: 'İletildi' };
  });
  s.post('/portal/dosya/:id/garanti-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const belirti = ((i.body ?? {}) as { belirti?: string }).belirti?.trim();
    if (!UUID.test(id) || !(await musteriMi(id, o.kullanici))) return yok(y);
    if (!belirti) return y.code(400).send({ hata: 'Sorunu kısaca yazmanızı rica ederiz.' });
    const d = await dosya(id);
    if (!d.dosya_sorumlusu_ref) return yok(y);
    await kartAc(b.db, { tur: 'Garanti Talebi', kategori: 'islem', baslik: `${d.dosya_no} · Portaldan Garanti Talebi`, ozet: belirti, oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: id });
    return { durum: 'İletildi' };
  });

  // YG-108: yat sahibi portaldan iptal veya devir talebi iletir; talep Dosya Sorumlusuna görev olarak düşer, İptal/Devir tutanağı iç akışla (Operasyon Müdürü onayı) hazırlanır.
  // YG-1449, ONY-16: Bilgi Paylaşım İzni; yalnız yat sahibi verir, seçilen taraflarla sınırlıdır ve her zaman güncellenir.
  const PAYLASIM = ['Sörveyör', 'Broker', 'Lehtar', 'Klas Kuruluşu'];
  const yatSahibiMi = async (dosyaRef: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya_tarafi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [dosyaRef, k])).rowCount);
  s.get('/portal/dosya/:id/bilgi-paylasim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await yatSahibiMi(id, o.kullanici))) return yok(y);
    const dil = dilKod((await b.db.query(`SELECT yazisma_dili FROM dosya WHERE kimlik = $1`, [id])).rows[0]?.yazisma_dili);
    const s0 = (await b.db.query(`SELECT baslik, metin, dugme FROM sablon_metni WHERE kod = 'ONY-16' AND dil = $1 AND durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`, [dil])).rows[0];
    const v = (await b.db.query(`SELECT taraflar, zaman FROM bilgi_paylasim_izni WHERE dosya_ref = $1`, [id])).rows[0];
    return { baslik: s0?.baslik ?? 'Bilgi Paylaşım İzni', metin: s0?.metin ?? '', dugme: s0?.dugme ?? 'Paylaşıma İzin Veriyorum', secenekler: PAYLASIM, secili: v?.taraflar ?? [], zaman: v?.zaman ?? null };
  });
  s.post('/portal/dosya/:id/bilgi-paylasim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { taraflar?: string[] };
    if (!UUID.test(id) || !(await yatSahibiMi(id, o.kullanici))) return yok(y);
    const l = [...new Set(g.taraflar ?? [])];
    if (l.some((x) => !PAYLASIM.includes(x))) return y.code(400).send({ hata: 'Paylaşım taraflarını listeden seçiniz.' });
    await b.db.query(`INSERT INTO bilgi_paylasim_izni (dosya_ref, taraflar, veren_ref) VALUES ($1,$2,$3) ON CONFLICT (dosya_ref) DO UPDATE SET taraflar = EXCLUDED.taraflar, veren_ref = EXCLUDED.veren_ref, zaman = now()`, [id, l, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bilgi Paylaşım İzni', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { taraflar: l }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { taraflar: l };
  });

  s.post('/portal/dosya/:id/iptal-devir-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; gerekce?: string; devralan?: string };
    if (!UUID.test(id) || !(await musteriMi(id, o.kullanici))) return yok(y);
    if (!['İptal', 'Devir'].includes(g.tur ?? '')) return y.code(400).send({ hata: 'Talep türünü seçiniz.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Talebinizin gerekçesini kısaca yazmanızı rica ederiz.' });
    if (g.tur === 'Devir' && !g.devralan?.trim()) return y.code(400).send({ hata: 'Dosyanın devredileceği tarafı yazmanızı rica ederiz.' });
    const d = await dosya(id);
    if (!d.dosya_sorumlusu_ref || d.statu === 'Kapalı') return y.code(409).send({ hata: 'Bu dosya için talep alınamamaktadır.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Müşteri İptal/Devir Talebi' AND nesne_kimligi = $1 AND durum NOT IN ('Tamamlandı', 'İptal')`, [id])).rowCount) return y.code(409).send({ hata: 'Bu dosya için iletilmiş bir talebiniz bulunmaktadır.' });
    await kartAc(b.db, { tur: 'Müşteri İptal/Devir Talebi', kategori: 'gorev', baslik: `${d.dosya_no} · Portaldan ${g.tur} Talebi`, ozet: `${g.gerekce.trim()}${g.devralan?.trim() ? ` · Devralan: ${g.devralan.trim()}` : ''}`.slice(0, 400), oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Portal ${g.tur} Talebi`, nesneTuru: 'Dosya', nesneKimligi: id, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
    return { durum: 'İletildi' };
  });

  // YG-458: ilerleme fotoğrafını Dosya Sorumlusu veya dosyadaki teknik ekip onaylayıp portala açar; fotoğraf dosyaya ya da dosyanın iş emrine bağlı olmalıdır.
  // YG-462: fotoğraf, video ve PDF kanıtı yayımlanır. YG-1170: firma adı, logosu ve imzası fotoğrafta alan kapatılarak gizlenir; PDF ve videoda (alan kapatılamaz) yayımlayan görünmediğini teyit eder.
  const FOTO = /\.(jpe?g|png|webp|heic|mp4|mov|pdf)$/i; const MASKELENIR = /\.(jpe?g|png|webp)$/i;
  const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const fotoYetkili = async (dosyaRef: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya d WHERE d.kimlik = $1 AND d.dosya_sorumlusu_ref = $2 UNION SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = $1 AND a.kullanici_ref = $2 AND a.bitis_zamani IS NULL AND a.rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Saha Sorumlusu') LIMIT 1`, [dosyaRef, k])).rowCount);
  s.post('/dosya/:id/ilerleme-fotografi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string; aciklama?: string; maske?: { x: number; y: number; w: number; h: number }[]; teyit?: boolean };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await fotoYetkili(id, o.kullanici))) return y.code(403).send({ hata: 'Fotoğrafı Dosya Sorumlusu veya dosyadaki teknik ekip onaylar.' });
    const oran = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
    const alanlar = Array.isArray(g.maske) ? g.maske.filter((a) => a && oran(a.x) && oran(a.y) && oran(a.w) && oran(a.h) && a.w > 0 && a.h > 0 && a.x + a.w <= 1.0001 && a.y + a.h <= 1.0001) : [];
    if ((g.maske !== undefined && (!Array.isArray(g.maske) || alanlar.length !== g.maske.length)) || alanlar.length > 30) return y.code(400).send({ hata: 'Kapatılacak alanlar geçersizdir.' });
    if (!g.belge || !UUID.test(g.belge) || !g.aciklama?.trim()) return y.code(400).send({ hata: 'Fotoğraf ve açıklama zorunludur.' });
    const s0 = (await b.db.query(`SELECT s.kimlik, s.dosya_adi, s.depo_anahtari FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik AND s.durum NOT IN ('İptal', 'Yerine Geçti', 'Arşiv') WHERE e.kimlik = $1 AND e.imha_zamani IS NULL AND e.bilgi_sinifi <> 'Kritik' AND ((e.bag_turu = 'Dosya' AND e.bag_kimligi = $2::text) OR (e.bag_turu = 'İş Emri' AND e.bag_kimligi IN (SELECT kimlik::text FROM is_emri WHERE dosya_ref = $3))) ORDER BY s.surum_no DESC LIMIT 1`, [g.belge, id, id])).rows[0];
    if (!s0) return y.code(404).send({ hata: 'Fotoğraf bu dosyada bulunamadı.' });
    if (!FOTO.test(s0.dosya_adi)) return y.code(400).send({ hata: 'Yalnız fotoğraf, video veya PDF paylaşılabilir.' });
    if (alanlar.length && !MASKELENIR.test(s0.dosya_adi)) return y.code(400).send({ hata: 'Alan kapatma yalnız fotoğrafta yapılır; PDF ve videoda firma adı, logosu ve imzası kapatılmış sürümü yükleyip teyit ediniz.' });
    if (!alanlar.length && g.teyit !== true) return y.code(400).send({ hata: 'Firma adı, logosu veya imzası görünüyorsa alanları kapatınız; görünmüyorsa teyit ediniz.' });
    let maskeli: string | null = null;
    if (alanlar.length) {
      const depo = b.depo ?? new Depo(); const parca: Buffer[] = [];
      for await (const x of depo.bagla(s0.depo_anahtari) as AsyncIterable<Buffer>) parca.push(x);
      let cikti: Buffer;
      try { cikti = await gorselMaskele(Buffer.concat(parca), MIME[(s0.dosya_adi as string).split('.').pop()!.toLowerCase()]!, alanlar); } catch { return y.code(400).send({ hata: 'Görsel okunamadı; alanları kapatılmış sürümü yükleyiniz.' }); }
      const al = await depo.al(Readable.from([cikti]), 100 * 1024 * 1024); maskeli = depo.yerlestir(al.yol, al.ozet);
    }
    const r = await b.db.query(`INSERT INTO portal_ilerleme_fotografi (dosya_ref, surum_ref, aciklama, onaylayan_ref, maske, maskeli_anahtar, maske_teyidi) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (dosya_ref, surum_ref) DO UPDATE SET aciklama = EXCLUDED.aciklama, onaylayan_ref = EXCLUDED.onaylayan_ref, onay_zamani = now(), kaldiran_ref = NULL, kaldirma_zamani = NULL, maske = EXCLUDED.maske, maskeli_anahtar = EXCLUDED.maskeli_anahtar, maske_teyidi = EXCLUDED.maske_teyidi RETURNING kimlik`, [id, s0.kimlik, g.aciklama.trim(), o.kullanici, alanlar.length ? JSON.stringify(alanlar) : null, maskeli, !alanlar.length]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İlerleme Fotoğrafı Paylaşıldı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { surum: s0.kimlik, kapatilanAlan: alanlar.length, teyit: !alanlar.length }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
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
    const f = (await b.db.query(`SELECT f.dosya_ref, s.dosya_adi, s.depo_anahtari, f.maskeli_anahtar FROM portal_ilerleme_fotografi f JOIN belge_surum s ON s.kimlik = f.surum_ref JOIN belge e ON e.kimlik = s.belge_ref WHERE f.kimlik = $1 AND f.kaldirma_zamani IS NULL AND e.imha_zamani IS NULL`, [id])).rows[0];
    // YG-460: dosyanın sigorta şirketinin kullanıcısı veya dosyadaki eksper de görür.
    const sigortaGorur = async () => Boolean((await b.db.query(`SELECT 1 FROM dosya_sigorta_kaydi s JOIN sigorta_kullanici u ON lower(u.sigortaci_adi) = lower(s.sigortaci_adi) WHERE s.dosya_ref = $1 AND u.kullanici_ref = $2 UNION SELECT 1 FROM dosya_tarafi e WHERE e.dosya_ref = $1 AND e.taraf_rolu = 'Eksper' AND e.kullanici_ref = $2 AND e.aktif`, [f?.dosya_ref, o.kullanici])).rowCount);
    if (!f || !((await musteriMi(f.dosya_ref, o.kullanici)) || (await sigortaGorur()))) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge İndirildi', nesneTuru: 'İlerleme Fotoğrafı', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
    // YG-1170: alanı kapatılmış görselde yalnız kapatılmış kopya verilir.
    const uz = f.maskeli_anahtar ? 'png' : (f.dosya_adi as string).match(FOTO)![1]!.toLowerCase();
    return y.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="ilerleme-${id.slice(0, 8)}.${uz}"`).header('x-content-type-options', 'nosniff').send((b.depo ?? new Depo()).bagla(f.maskeli_anahtar ?? f.depo_anahtari));
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
