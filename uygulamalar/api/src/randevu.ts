import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { disGonder } from './bildirim.js';
import { izYaz } from './denetim.js';
import { Depo } from './depo.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { metinGetir, type Dil } from './metin.js';
import { gonderimIsleyici, sigortayaHazirla } from './sigorta_gonderim.js';
import { UUID } from './yat.js';

export const RANDEVU: Record<string, string> = { 'Keşif': 'BLD-19', 'Garanti Keşfi': 'BLD-20', 'Tanıklık': 'BLD-21', 'Deniz Denemesi': 'BLD-22' };
const SURE_DK: Record<string, number> = { 'Keşif': 120, 'Garanti Keşfi': 120, 'Tanıklık': 60, 'Deniz Denemesi': 180 };
const TUR_EN: Record<string, string> = { 'Keşif': 'Survey', 'Garanti Keşfi': 'Warranty Survey', 'Tanıklık': 'Witness Point', 'Deniz Denemesi': 'Sea Trial' };
const SIGORTA = 'Randevu Bildirimi';

const anSaat = (z: Date) => z.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const icsZaman = (z: Date) => z.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsMetin = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 takvim daveti; firma adı içermez. */
export function takvimDaveti(g: { uid: string; baslik: string; aciklama: string; yer: string; baslangic: Date; dakika: number }): string {
  const bitis = new Date(+g.baslangic + g.dakika * 60_000);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LIMIT GLOBAL MARINE//YATONET 360//TR', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${g.uid}@yatonet360`, `DTSTAMP:${icsZaman(new Date())}`, `DTSTART:${icsZaman(g.baslangic)}`, `DTEND:${icsZaman(bitis)}`, `SUMMARY:${icsMetin(g.baslik)}`, `DESCRIPTION:${icsMetin(g.aciklama)}`, `LOCATION:${icsMetin(g.yer)}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

// K-241: sigortaya ikinci teyitten sonra davet ekiyle gider.
gonderimIsleyici(SIGORTA, async (c, r) => {
  await disGonder(c, { olay: `randevu-sigorta:${r.nesne_kimligi}`, eposta: r.alici, konu: r.konu, metin: r.metin!, sigortaTeyitli: true, ekler: (r.veri.ekler as string[] | undefined) ?? [] });
  return { metin: r.metin ?? undefined, ekli: true };
});

/**
 * YG-552: keşif, garanti keşfi, tanıklık noktası ve deniz denemesi bildirimleri onaylı BLD-19–22 metniyle ve takvim davetiyle gider;
 * gönderim zamanı öncelikten belirlenir (Kritikte hemen, diğerlerinde mesai içinde); metinde ve davette firma adı bulunmaz.
 */
export async function randevuBildir(c: PoolClient, b: Pick<Baglam, 'webAdresi' | 'depo'>, g: { dosya: string; tur: string; zaman: Date; yer: string; isTest?: string; kayitNo?: string; yapan: string }): Promise<{ kimlik: string; alicilar: number }> {
  const kod = RANDEVU[g.tur]; if (!kod) throw Object.assign(new Error('Randevu türü geçersiz.'), { statusCode: 400 });
  const d = (await c.query(`SELECT d.dosya_no, d.oncelik, d.yazisma_dili, d.dosya_niteligi, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [g.dosya])).rows[0];
  const dil: Dil = d.yazisma_dili === 'İngilizce' ? 'en' : 'tr'; const en = dil === 'en';
  const alan = { Yat: d.yat_adi, Yacht: d.yat_adi, 'tarih saat': anSaat(g.zaman), 'date time': anSaat(g.zaman), yer: g.yer, place: g.yer, 'Kayıt No': g.kayitNo ?? d.dosya_no, 'Record No': g.kayitNo ?? d.dosya_no, 'iş/test': g.isTest ?? '', 'work/test': g.isTest ?? '', 'bağlantı': b.webAdresi, link: b.webAdresi };
  const metin = await metinGetir(c, kod, dil, alan);
  const k = (await c.query(`INSERT INTO randevu_bildirimi (dosya_ref, tur, bld_kodu, randevu_zamani, yer, is_test, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [g.dosya, g.tur, kod, g.zaman, g.yer, g.isTest ?? null, g.yapan])).rows[0].kimlik as string;
  const ics = Buffer.from(takvimDaveti({ uid: k, baslik: `${en ? TUR_EN[g.tur] : g.tur} · ${d.yat_adi}`, aciklama: metin, yer: g.yer, baslangic: g.zaman, dakika: SURE_DK[g.tur]! }), 'utf8');
  const depo = b.depo ?? new Depo(); const al = await depo.al(Readable.from(ics), ics.length + 1); const anahtar = depo.yerlestir(al.yol, al.ozet);
  const be = (await c.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'Takvim Daveti','Gizli','Dosya',$2,'Sistem',(now() AT TIME ZONE 'Europe/Istanbul')::date,$3) RETURNING kimlik`, [`${d.dosya_no} ${g.tur} Takvim Daveti ${anSaat(g.zaman)}`, g.dosya, g.yapan])).rows[0].kimlik;
  const sv = (await c.query(`INSERT INTO belge_surum (belge_ref, surum_no, dosya_adi, uzanti, boyut, ozet_sha256, depo_anahtari, tarama_kaynagi, yukleyen_ref, durum, onay_zamani) VALUES ($1,1,$2,'ics',$3,$4,$5,'Sistem',$6,'Yürürlükte',now()) RETURNING kimlik`, [be, `${d.dosya_no}-randevu.ics`, al.boyut, al.ozet, anahtar, g.yapan])).rows[0].kimlik as string;
  let n = 0; const konu = `${d.dosya_no} ${en ? TUR_EN[g.tur] : g.tur}`;
  const sahip = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [g.dosya])).rows[0];
  if (sahip && (sahip.telefon || sahip.eposta) && (await disGonder(c, { olay: `randevu:${k}`, telefon: sahip.telefon, eposta: sahip.eposta, konu, metin, oncelik: d.oncelik, ekler: sahip.eposta ? [sv] : undefined }))) n++;
  const sg = (await c.query(`SELECT t.eposta FROM dosya_sigorta_kaydi s JOIN dosya_tarafi t ON t.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1 AND t.eposta IS NOT NULL LIMIT 1`, [g.dosya])).rows[0];
  if (sg?.eposta) { await sigortayaHazirla(c, { dosya: g.dosya, tur: SIGORTA, nesne: k, alici: sg.eposta, konu, metin, acil: d.oncelik === 'Kritik', veri: { ekler: [sv] } }); n++; }
  await c.query(`UPDATE randevu_bildirimi SET davet_surum_ref = $2, alici_sayisi = $3 WHERE kimlik = $1`, [k, sv, n]);
  return { kimlik: k, alicilar: n };
}

export function randevuYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const ekipte = async (d: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL AND rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu', 'Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)')`, [d, k])).rowCount);
  s.get('/dosya/:id/randevu', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || i.oturum!.grup !== 'LGM İç Rolü' || !(await ekipte(id, i.oturum!.kullanici))) return yok(y);
    return (await b.db.query(`SELECT kimlik, tur, randevu_zamani, yer, is_test, alici_sayisi, olusturma_zamani FROM randevu_bildirimi WHERE dosya_ref = $1 ORDER BY randevu_zamani DESC`, [id])).rows;
  });
  // Keşif bildirimi keşif planlamasıyla kendiliğinden gider; diğer randevular buradan bildirilir.
  s.post('/dosya/:id/randevu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; zaman?: string; yer?: string; isTest?: string; kayitNo?: string };
    if (!UUID.test(id) || !(await ekipte(id, o.kullanici))) return yok(y);
    if (!g.tur || g.tur === 'Keşif' || !RANDEVU[g.tur]) return y.code(400).send({ hata: 'Randevu türünü seçiniz.' });
    const z = g.zaman ? new Date(g.zaman) : null;
    if (!z || Number.isNaN(+z) || +z <= Date.now() || !g.yer?.trim()) return y.code(400).send({ hata: 'İleri bir tarih-saat ve yer giriniz.' });
    if (g.tur === 'Tanıklık' && !g.isTest?.trim()) return y.code(400).send({ hata: 'Tanıklık edilecek iş veya testi yazınız.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = await randevuBildir(c, b, { dosya: id, tur: g.tur, zaman: z, yer: g.yer.trim(), isTest: g.isTest?.trim(), kayitNo: g.kayitNo?.trim(), yapan: o.kullanici });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: `Randevu Bildirimi: ${g.tur}`, nesneTuru: 'Dosya', nesneKimligi: id, yeni: { zaman: z, yer: g.yer.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
