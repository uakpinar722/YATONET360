import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const KART = 'Sigorta Ödeme Farkı'; const ONAY = ['Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü'];
const R2 = (x: number) => Math.round(x * 100) / 100;
export const NEDEN = ['Muafiyet', 'Diğer'];

type Db = PoolClient | Baglam['db'];
/** YG-891: açık ödeme farkı varken ON iş emri açılmaz. */
export async function odemeFarkiEngeli(db: Db, teklif: string): Promise<string | null> {
  return (await db.query(`SELECT 1 FROM fiyat_teklifi WHERE kimlik = $1 AND odeme_farki_durum = 'Açık'`, [teklif])).rowCount ? 'Sigortanın bildirdiği ödeme tutarı onaylı toplamdan düşüktür; önce fark kararı verilmelidir.' : null;
}

/** YG-891, SGF-1: sigortanın bildirdiği tutar onaylı toplamdan düşükse fark işi kapsamdan çıkarılır ya da yat sahibine ayrı teklif olur. Kayıtlar iç kullanımdır. */
export function sigortaFarkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const dsMi = async (d: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu') AND bitis_zamani IS NULL`, [d, k])).rowCount);
  const teklifGetir = async (id: string) => (UUID.test(id) ? (await b.db.query(`SELECT f.*, d.dosya_no, d.dosya_sorumlusu_ref FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [id])).rows[0] : undefined);
  const onayli = async (t: string) => Number((await b.db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu = 'Onaylandı'`, [t])).rows[0].t);
  const isEmriVar = async (t: string) => Boolean((await b.db.query(`SELECT 1 FROM is_emri WHERE teklif_ref = $1 AND statu NOT IN ('İptal', 'Yerine Geçti') LIMIT 1`, [t])).rowCount);

  s.get('/dosya/:id/sigorta-fark', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const tl = (await b.db.query(`SELECT kimlik, teklif_no, sigorta_odenecek_eur, odeme_farki_eur, odeme_farki_durum FROM fiyat_teklifi WHERE dosya_ref = $1 AND teklif_muhatabi = 'Sigorta Şirketi' AND statu = 'Karar' AND karar = ANY($2::text[]) ORDER BY olusturma_zamani`, [id, ONAY])).rows;
    const l = []; for (const t of tl) l.push({ ...t, onayli: await onayli(t.kimlik), kalemler: (await b.db.query(`SELECT sira_no, aciklama, tutar_eur FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu = 'Onaylandı' ORDER BY sira_no`, [t.kimlik])).rows });
    return { yetkili: await dsMi(id, o.kullanici), teklifler: l };
  });

  s.post('/teklif/:id/sigorta-odenecek', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tutar?: unknown }; const t = await teklifGetir((i.params as { id: string }).id);
    if (!t || !(await dsMi(t.dosya_ref, o.kullanici))) return yok(y);
    if (t.teklif_muhatabi !== 'Sigorta Şirketi' || t.statu !== 'Karar' || !ONAY.includes(t.karar)) return y.code(409).send({ hata: 'Tutar, sigortanın onayladığı teklife girilir.' });
    if (t.sigorta_odenecek_eur !== null) return y.code(409).send({ hata: 'Bu teklif için tutar girilmiştir.' });
    if (await isEmriVar(t.kimlik)) return y.code(409).send({ hata: 'İş emri açılmıştır; kapsam değişikliği değişiklik akışından yürütülür.' });
    const tutar = Number(g.tutar); const top = await onayli(t.kimlik);
    if (!(tutar >= 0) || g.tutar === undefined || g.tutar === '' || tutar > top) return y.code(400).send({ hata: 'Tutar geçersizdir; onaylı toplamı aşamaz.' });
    const fark = R2(top - tutar);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE fiyat_teklifi SET sigorta_odenecek_eur = $2, odeme_farki_eur = $3, odeme_farki_durum = $4 WHERE kimlik = $1`, [t.kimlik, tutar, fark, fark > 0 ? 'Açık' : null]);
      if (fark > 0 && t.dosya_sorumlusu_ref) await kartAc(c, { tur: KART, kategori: 'gorev', baslik: `${t.dosya_no} · Sigorta Ödeme Farkı`, ozet: 'Fark kararı verilmeden onarım iş emri açılamaz.', oncelik: 'Yüksek', sahipKullanici: t.dosya_sorumlusu_ref, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Ödenecek Tutar', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { tutar, fark }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    return { onayli: top, fark };
  });

  s.post('/teklif/:id/odeme-farki', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { neden?: string; kapsamdan?: number[]; ayri?: number[] }; const t = await teklifGetir((i.params as { id: string }).id);
    if (!t || !(await dsMi(t.dosya_ref, o.kullanici))) return yok(y);
    if (t.odeme_farki_durum !== 'Açık') return y.code(409).send({ hata: 'Açık ödeme farkı yoktur.' });
    if (!NEDEN.includes(g.neden ?? '')) return y.code(400).send({ hata: 'Fark nedenini seçiniz.' });
    const kap = g.kapsamdan ?? []; const ayri = g.ayri ?? [];
    // Muafiyet yat sahibinden alınmaz; tutar sigorta alacağı olarak kalır, kapsam değişmez.
    if (g.neden === 'Muafiyet' && (kap.length || ayri.length)) return y.code(400).send({ hata: 'Bu nedenle kalem seçilmez; tutar sigorta alacağı olarak izlenir.' });
    if (new Set([...kap, ...ayri]).size !== kap.length + ayri.length) return y.code(400).send({ hata: 'Bir kalem iki kez seçilemez.' });
    const secili = kap.length + ayri.length ? (await b.db.query(`SELECT sira_no, tutar_eur FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu = 'Onaylandı' AND sira_no = ANY($2::int[])`, [t.kimlik, [...kap, ...ayri]])).rows : [];
    if (secili.length !== kap.length + ayri.length) return y.code(400).send({ hata: 'Seçilen kalem onaylı kalemler arasında değildir.' });
    const toplam = R2(secili.reduce((a, k) => a + Number(k.tutar_eur), 0)); const fark = Number(t.odeme_farki_eur);
    if (toplam > fark) return y.code(400).send({ hata: 'Seçilen kalemler fark tutarını aşmaktadır.' });
    const kalan = g.neden === 'Muafiyet' ? 0 : R2(fark - toplam); const ayriVar = ayri.length > 0 || kalan > 0;
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      if (kap.length) await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = 'Onaylanmadı', fark_karari = 'Kapsamdan Çıkarıldı' WHERE teklif_ref = $1 AND sira_no = ANY($2::int[])`, [t.kimlik, kap]);
      if (ayri.length) await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = 'Onaylanmadı', fark_karari = 'Yat Sahibine Ayrı Teklif' WHERE teklif_ref = $1 AND sira_no = ANY($2::int[])`, [t.kimlik, ayri]);
      await c.query(`UPDATE fiyat_teklifi SET odeme_farki_durum = 'Kapandı', odeme_farki_nedeni = $2, odeme_farki_kalan_eur = $3, odeme_farki_ayri = $4 WHERE kimlik = $1`, [t.kimlik, g.neden, kalan, ayriVar]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $2 AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [t.kimlik, KART]);
      if (ayriVar) await kartAc(c, { tur: 'Fiyat Teklifi Hazırla', baslik: `${t.dosya_no} · Yat Sahibine Ayrı Teklif`, ozet: `${ayri.length} kalem${kalan > 0 ? ' ve bakiye' : ''}`, kategori: 'islem', sahipKullanici: t.hazirlayan_ref, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Ödeme Farkı Kararı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { neden: g.neden, kapsamdan: kap, ayri, kalan }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    return { kalan, ayriTeklif: ayriVar };
  });
}
