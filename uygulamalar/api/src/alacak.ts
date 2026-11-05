import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { belgeUret } from './belge_uret.js';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { metinGetir, tutar } from './metin.js';
import { sigortayaHazirla } from './sigorta_gonderim.js';
import { parametre } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const HUD = 'Hukuk ve Uyum Direktörü'; const GMY = 'Genel Müdür Yardımcısı'; const TID = 'Ticari İşler Direktörü'; const MFM = 'Muhasebe ve Finans Müdürü'; const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
const KARAR_TURLERI = ['Dava', 'İcra Takibi', 'Şüpheli Alacak', 'Alacak Silme', 'İhtiyati Haciz'];
const AY_FAIZ_GUN = 36500;

/** YG-912: 60. günde sistem önerisi; HUD ve GMY görüş, CEO onay. Hakem heyeti parasal sınırı yıllık değiştiği için metinde sayı yazılmaz. */
export function alacakYolu(musteriTuru: string, tutarEur: number): string {
  const t = tutar(tutarEur);
  if (musteriTuru === 'Bireysel Müşteri') return `${t} EUR alacak için parasal sınıra göre Tüketici Hakem Heyeti veya zorunlu arabuluculuk ve Tüketici Mahkemesi.`;
  if (musteriTuru === 'Sigorta Şirketi') return `${t} EUR alacak için önce yazısız görüşme, sonuç alınamazsa zorunlu arabuluculuk ve icra takibi.`;
  return `${t} EUR alacak için zorunlu arabuluculuk ve icra takibi.`;
}

/** Üç makam sırayla: nihai kararı yalnız CEO verir (YG-820). */
const hukukZinciri = async (c: Db) => [await rolId(c, HUD), await rolId(c, GMY), await rolId(c, 'CEO')];
export async function alacakYoluAc(c: Db, f: { kimlik: string; dosya_ref: string; dosya_no: string; musteri_turu: string; kalan: number }) {
  const oneri = alacakYolu(f.musteri_turu, f.kalan);
  const r = (await c.query(`INSERT INTO hukuk_karari (tur, dosya_ref, fatura_ref, tutar_eur, oneri) VALUES ('Alacak Yolu',$1,$2,$3,$4) RETURNING kimlik`, [f.dosya_ref, f.kimlik, f.kalan, oneri])).rows[0];
  await kartAc(c, { tur: 'Hukuk Kararı', baslik: `${f.dosya_no} · Alacak Yolu Önerisi`, ozet: oneri, oncelik: 'Yüksek', zincir: await hukukZinciri(c), nesneTuru: 'Hukuk Kararı', nesneKimligi: r.kimlik });
}
kapanisKaydet('Hukuk Kararı', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE hukuk_karari SET durum = 'Onaylandı' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE hukuk_karari SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
kapanisKaydet('İş Açma Onayı', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE is_acma_onayi SET durum = 'Onaylandı' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE is_acma_onayi SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
kapanisKaydet('Üçüncü Kişi Ödemesi', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE ucuncu_kisi_odeme SET durum = 'Onaylandı' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE ucuncu_kisi_odeme SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

/** YG-909: faturalanmış tahsil edilmemiş + onaylı teklifte faturalanmamış; EUR, KDV dahil; müşteri bazında. Sigorta muhataplı kalemler sayılmaz. */
export async function acikAlacak(db: Db, taraf: string): Promise<number> {
  const a = Number((await db.query(`SELECT coalesce(sum(f.toplam_eur - f.tahsil_edilen_eur), 0) t FROM musteri_faturasi f JOIN dosya d ON d.kimlik = f.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE y.yat_sahibi_ref = $1 AND f.muhatap <> 'Sigorta Şirketi' AND f.durum IN ('Faturalandı', 'Kısmi Tahsil')`, [taraf])).rows[0].t);
  const b = Number((await db.query(`SELECT coalesce(sum(t.genel_toplam_eur), 0) t FROM fiyat_teklifi t JOIN dosya d ON d.kimlik = t.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE y.yat_sahibi_ref = $1 AND t.teklif_muhatabi <> 'Sigorta Şirketi' AND t.statu = 'Karar' AND t.karar IN ('Tam Onay', 'Kısmi Onay', 'Koşullu Onay') AND NOT EXISTS (SELECT 1 FROM musteri_faturasi f WHERE f.teklif_ref = t.kimlik AND f.durum <> 'Reddedildi')`, [taraf])).rows[0].t);
  return R2(a + b);
}
const dosyaMusterisi = async (db: Db, dosya: string) => (await db.query(`SELECT d.musteri_turu, y.yat_sahibi_ref, t.risk_olayi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN taraf t ON t.kimlik = y.yat_sahibi_ref WHERE d.kimlik = $1`, [dosya])).rows[0];

export async function krediDurumu(db: Db, dosya: string) {
  const d = await dosyaMusterisi(db, dosya);
  if (d?.musteri_turu !== 'Kurumsal Müşteri' || !d.yat_sahibi_ref) return null;
  const limit = await parametre(db, 'kurumsal_kredi_limiti_eur'); const acik = await acikAlacak(db, d.yat_sahibi_ref);
  return { acik, limit, oran: limit > 0 ? Math.round((acik / limit) * 100) : 100, uyari: acik >= limit * 0.8, asim: acik > limit, buyuk: acik > 20000 };
}

/** YG-909, YG-1488, YG-1490: yeni iş emri kapısı. Kredi limiti ON, PH, EK için; konkordato acil dışı yeni işlerde peşin ve GMY onayı; ödeme sorumlusu sigorta olan dosya muaftır. */
export async function isAcmaEngeli(db: Db, dosya: string, tur: string): Promise<string | null> {
  const d = await dosyaMusterisi(db, dosya);
  const onayli = async (t: string) => Boolean((await db.query(`SELECT 1 FROM is_acma_onayi WHERE dosya_ref = $1 AND tur = $2 AND durum = 'Onaylandı' LIMIT 1`, [dosya, t])).rowCount);
  if (d?.risk_olayi === 'Konkordato' && d.musteri_turu !== 'Sigorta Şirketi' && tur !== 'AC') {
    if (!(await onayli('Konkordato'))) return 'Konkordato kaydı nedeniyle yeni iş için peşin ödeme ve Genel Müdür Yardımcısı onayı bekleniyor.';
    const top = Number((await db.query(`SELECT coalesce(max(genel_toplam_eur), 0) t FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu = 'Karar'`, [dosya])).rows[0].t);
    const th = Number((await db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM tahsilat WHERE dosya_ref = $1`, [dosya])).rows[0].t);
    if (th < top) return 'Konkordato kaydı nedeniyle iş bedelinin peşin tahsili bekleniyor.';
  }
  if (['ON', 'PH', 'EK'].includes(tur)) { const k = await krediDurumu(db, dosya); if (k?.asim && !(await onayli('Kredi Limiti'))) return 'Açık alacak kredi limitini aşmıştır; Genel Müdür Yardımcısı onayı bekleniyor.'; }
  return null;
}

/** YG-923: imzalı nüsha ve birlikte imza olmadan o tarafa iş emri veya sipariş açılmaz. */
export async function sozlesmeEngeli(db: Db, kurulus: string): Promise<string | null> {
  if ((await parametre(db, 'sozlesme_kapisi')) !== 1) return null;
  return (await db.query(`SELECT 1 FROM sozlesme_kaydi WHERE kurulus_ref = $1 AND durum = 'Yürürlükte' AND yururluk <= current_date AND (bitis IS NULL OR bitis >= current_date) LIMIT 1`, [kurulus])).rowCount ? null : 'Yürürlükte sözleşme bulunmamaktadır; imzalı nüshanın yüklenmesi bekleniyor.';
}
/** YG-915: haciz ihbarı açıkken firma carisi blokedir. */
export const blokeEngeli = async (db: Db, kurulus: string) => ((await db.query(`SELECT cari_bloke FROM kurulus WHERE kimlik = $1`, [kurulus])).rows[0]?.cari_bloke ? 'Firma carisi haciz ihbarnamesi nedeniyle blokedir; Hukuk ve Uyum Direktörü kararı bekleniyor.' : null);

/** YG-872, K-210: bireyselde kanuni, tacirde ticari temerrüt faizi; sigorta çerçevesinde faiz yoktur. Oran tanımlı değilse hesaplanmaz. */
export async function gecikmeFaizi(db: Db, f: { vade: string | Date | null; kalan: number }, musteriTuru: string, simdi = new Date()) {
  if (musteriTuru === 'Sigorta Şirketi' || !f.vade || !(f.kalan > 0)) return null;
  const gun = Math.floor((simdi.getTime() - new Date(f.vade).getTime()) / 86_400_000);
  if (gun <= 0) return null;
  const tur = musteriTuru === 'Bireysel Müşteri' ? 'Kanuni Faiz' : 'Ticari Temerrüt Faizi';
  const o = (await db.query(`SELECT oran FROM faiz_orani WHERE tur = $1 AND yururluk <= $2::date ORDER BY yururluk DESC LIMIT 1`, [tur, simdi.toISOString().slice(0, 10)])).rows[0];
  return { gun, tur, oran: o ? Number(o.oran) : null, faiz: o ? R2((f.kalan * Number(o.oran) * gun) / AY_FAIZ_GUN) : null };
}

export function alacakYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const dosyaNo = async (id: string) => (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0]?.dosya_no as string;

  // YG-820, YG-914: dava, icra, şüpheli alacak, alacak silme, ihtiyati haciz; öneri HUD, GMY görüş, CEO karar.
  s.post('/dosya/:id/hukuk-karari', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; oneri?: string; tutar?: number; fatura?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await rolVar(o.kullanici, [HUD, TID, MFM]))) return y.code(403).send({ hata: 'Hukuk kararı önerisini Hukuk ve Uyum Direktörü, Ticari İşler Direktörü veya Muhasebe ve Finans Müdürü hazırlar.' });
    if (!KARAR_TURLERI.includes(g.tur ?? '') || !g.oneri?.trim()) return y.code(400).send({ hata: 'Karar türü ve öneriyi girmenizi rica ederiz.' });
    const no = await dosyaNo(id);
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO hukuk_karari (tur, dosya_ref, fatura_ref, tutar_eur, oneri, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [g.tur, id, g.fatura && UUID.test(g.fatura) ? g.fatura : null, Number(g.tutar) > 0 ? g.tutar : null, g.oneri!.trim(), o.kullanici])).rows[0];
      const z = await hukukZinciri(c);
      await kartAc(c, { tur: 'Hukuk Kararı', baslik: `${no} · ${g.tur}`, ozet: g.oneri!.trim(), oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: z, nesneTuru: 'Hukuk Kararı', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik };
    });
  });

  s.post('/dosya/:id/is-acma-onayi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; gerekce?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!['Kredi Limiti', 'Konkordato'].includes(g.tur ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçeyi yazmanızı rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM is_acma_onayi WHERE dosya_ref = $1 AND tur = $2 AND durum <> 'Reddedildi' LIMIT 1`, [id, g.tur])).rowCount) return y.code(409).send({ hata: 'Bu dosya için onay talebi bulunmaktadır.' });
    const no = await dosyaNo(id);
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO is_acma_onayi (dosya_ref, tur, gerekce, isteyen_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [id, g.tur, g.gerekce!.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'İş Açma Onayı', baslik: `${no} · ${g.tur} Onayı`, ozet: g.gerekce!.trim(), hazirlayan: o.kullanici, zincir: [await rolId(c, GMY)], nesneTuru: 'İş Açma Onayı', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik };
    });
  });

  // YG-872: faiz oranını Muhasebe ve Finans Müdürü dayanağıyla girer; değer sistemde sabit yazılmaz.
  s.get('/faiz-orani', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [MFM]))) return yok(y);
    return (await b.db.query(`SELECT tur, oran, yururluk::text, dayanak FROM faiz_orani ORDER BY tur, yururluk DESC`)).rows;
  });
  s.post('/faiz-orani', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; oran?: number; yururluk?: string; dayanak?: string };
    if (!(await rolVar(o.kullanici, [MFM]))) return y.code(403).send({ hata: 'Faiz oranını Muhasebe ve Finans Müdürü girer.' });
    if (!['Kanuni Faiz', 'Ticari Temerrüt Faizi'].includes(g.tur ?? '') || !(Number(g.oran) >= 0) || g.oran === undefined || !g.yururluk || !g.dayanak?.trim()) return y.code(400).send({ hata: 'Tür, oran, yürürlük ve dayanağı girmenizi rica ederiz.' });
    const r = await b.db.query(`INSERT INTO faiz_orani (tur, oran, yururluk, dayanak, kaydeden_ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [g.tur, g.oran, g.yururluk, g.dayanak.trim(), o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu yürürlük tarihiyle oran kayıtlıdır.' });
    return { tamam: true };
  });

  // YG-887: itiraz kalem, gerekçe ve belgeyle; sigortada faturadan 8 gün; 48 saat yanıt; itiraz edilmeyen kısım vadesinde ödenir.
  s.post('/fatura/:id/itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kalem?: string; tutar?: number; gerekce?: string; belge?: string };
    if (!UUID.test(id)) return yok(y);
    const f = (await b.db.query(`SELECT f.*, d.dosya_no FROM musteri_faturasi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [id])).rows[0];
    // YG-887: yat sahibi kendi faturasına portaldan itiraz eder.
    if (!f || !(await dosyaErisimi(b.db, o.kullanici, f.dosya_ref) || (await b.db.query(`SELECT 1 FROM dosya_tarafi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND aktif LIMIT 1`, [f.dosya_ref, o.kullanici])).rowCount)) return yok(y);
    if (!f.fatura_no) return y.code(409).send({ hata: 'İtiraz fatura bilgisi girilen kayda açılır.' });
    if (!g.kalem?.trim() || !g.gerekce?.trim() || !(Number(g.tutar) > 0)) return y.code(400).send({ hata: 'Kalem, tutar ve gerekçeyi girmenizi rica ederiz.' });
    const once = Number((await b.db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM fatura_itirazi WHERE fatura_ref = $1 AND durum <> 'Ret'`, [id])).rows[0].t);
    if (R2(once + Number(g.tutar)) > R2(Number(f.toplam_eur) - Number(f.tahsil_edilen_eur))) return y.code(409).send({ hata: 'İtiraz tutarı faturanın açık tutarını aşamaz.' });
    if (f.muhatap === 'Sigorta Şirketi' && (Date.now() - new Date(f.fatura_tarihi).getTime()) / 86_400_000 > 9) return y.code(409).send({ hata: 'Sekiz günlük itiraz süresi dolmuştur.' });
    const son = new Date(Date.now() + 48 * 3_600_000);
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO fatura_itirazi (fatura_ref, kalem, tutar_eur, gerekce, belge_ref, yanit_son, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [id, g.kalem!.trim(), g.tutar, g.gerekce!.trim(), g.belge && UUID.test(g.belge) ? g.belge : null, son, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Fatura İtirazı', kategori: 'islem', baslik: `${f.dosya_no} · Fatura İtirazı`, ozet: `${f.fatura_no} · ${tutar(Number(g.tutar))} EUR`, oncelik: 'Yüksek', sahipRol: await rolId(c, TID), sonZaman: son, nesneTuru: 'Fatura İtirazı', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, yanitSon: son.toISOString() };
    });
  });
  s.post('/fatura-itirazi/:id/yanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; yanit?: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [TID]))) return y.code(403).send({ hata: 'İtirazı Ticari İşler Direktörü yanıtlar.' });
    const t = (await b.db.query(`SELECT x.*, f.fatura_no, f.muhatap, f.dosya_ref, d.dosya_no FROM fatura_itirazi x JOIN musteri_faturasi f ON f.kimlik = x.fatura_ref JOIN dosya d ON d.kimlik = f.dosya_ref WHERE x.kimlik = $1`, [id])).rows[0];
    if (!t) return yok(y);
    if (t.durum !== 'Açık') return y.code(409).send({ hata: 'Bu itiraz yanıtlanmıştır.' });
    if (!['Kabul', 'Ret'].includes(g.karar ?? '') || !g.yanit?.trim()) return y.code(400).send({ hata: 'Karar ve yanıtı girmenizi rica ederiz.' });
    return islem(async (c) => {
      await c.query(`UPDATE fatura_itirazi SET durum = $2, yanit = $3, yanitlayan_ref = $4 WHERE kimlik = $1`, [id, g.karar, g.yanit!.trim(), o.kullanici]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Fatura İtirazı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      if (t.muhatap === 'Sigorta Şirketi') {
        const sg = (await c.query(`SELECT t.eposta, s.sigortaci_adi FROM dosya_sigorta_kaydi s JOIN dosya_tarafi t ON t.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1`, [t.dosya_ref])).rows[0];
        if (sg?.eposta) await sigortayaHazirla(c, { dosya: t.dosya_ref, tur: 'BLD-76', nesne: id, alici: sg.eposta, konu: `${t.dosya_no} Fatura İtirazı Yanıtı`, metin: await metinGetir(c, 'BLD-76', 'tr', { Kurum: sg.sigortaci_adi ?? '', 'fatura no / dönem': t.fatura_no, sonuç: g.yanit!.trim() }) });
      }
      return { durum: g.karar };
    });
  });

  // YG-915: haciz ihbarnamesiyle cari bloke; cevap süresi görevle izlenir.
  s.post('/firma/:id/haciz-ihbari', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { no?: string; teblig?: string; cevapSon?: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [HUD]))) return y.code(403).send({ hata: 'Haciz ihbarnamesini Hukuk ve Uyum Direktörü girer.' });
    if (!g.no?.trim() || !g.teblig || !g.cevapSon) return y.code(400).send({ hata: 'İhbarname no, tebliğ zamanı ve cevap son gününü girmenizi rica ederiz.' });
    const k = (await b.db.query(`SELECT ticari_unvan FROM kurulus WHERE kimlik = $1`, [id])).rows[0];
    if (!k) return yok(y);
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO haciz_ihbari (kurulus_ref, ihbar_no, teblig_zamani, cevap_son, giren_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, g.no!.trim(), g.teblig, g.cevapSon, o.kullanici])).rows[0];
      await c.query(`UPDATE kurulus SET cari_bloke = true WHERE kimlik = $1`, [id]);
      await bildir(c, { olay: `haciz:${r.kimlik}`, kullanicilar: await rolSahipleri(c, await rolId(c, TID)), baslik: `${k.ticari_unvan} · Cari Bloke`, ozet: `Haciz ihbarnamesi ${g.no!.trim()}` });
      await kartAc(c, { tur: 'Haciz İhbarı Cevabı', kategori: 'islem', baslik: `${k.ticari_unvan} · Haciz İhbarı Cevabı`, ozet: g.no!.trim(), oncelik: 'Yüksek', sahipRol: await rolId(c, HUD), sonZaman: new Date(`${g.cevapSon}T18:00:00+03:00`), nesneTuru: 'Haciz İhbarı', nesneKimligi: r.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Cari Bloke', nesneTuru: 'Kuruluş', nesneKimligi: id, yeni: { no: g.no }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: r.kimlik };
    });
  });
  s.post('/haciz-ihbari/:id/cevap', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { cevap?: string; blokeKaldir?: boolean };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [HUD]))) return y.code(403).send({ hata: 'Cevabı Hukuk ve Uyum Direktörü girer.' });
    const h = (await b.db.query(`SELECT * FROM haciz_ihbari WHERE kimlik = $1`, [id])).rows[0];
    if (!h) return yok(y);
    if (h.durum !== 'Açık') return y.code(409).send({ hata: 'Bu ihbar cevaplanmıştır.' });
    if (!g.cevap?.trim()) return y.code(400).send({ hata: 'Cevabı yazmanızı rica ederiz.' });
    return islem(async (c) => {
      await c.query(`UPDATE haciz_ihbari SET durum = 'Cevaplandı', cevap = $2 WHERE kimlik = $1`, [id, g.cevap!.trim()]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Haciz İhbarı Cevabı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      if (g.blokeKaldir) await c.query(`UPDATE kurulus k SET cari_bloke = false WHERE k.kimlik = $1 AND NOT EXISTS (SELECT 1 FROM haciz_ihbari x WHERE x.kurulus_ref = k.kimlik AND x.durum = 'Açık')`, [h.kurulus_ref]);
      return { durum: 'Cevaplandı' };
    });
  });

  // YG-916: tarama sonucu; risk olayı işaretlenince Hukuk ve Uyum Direktörüne bildirim.
  s.post('/taraf-tarama', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tarafNo?: string; sonuc?: string };
    if (!(await rolVar(o.kullanici, [HUD]))) return y.code(403).send({ hata: 'Tarama sonucunu Hukuk ve Uyum Direktörü girer.' });
    if (!g.tarafNo?.trim() || !['Temiz', 'İnceleme', 'Ret'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Taraf no ve sonucu girmenizi rica ederiz.' });
    const r = await b.db.query(`UPDATE taraf SET tarama_sonucu = $2, tarama_tarihi = current_date WHERE taraf_no = $1 RETURNING kimlik, unvan_ad_soyad`, [g.tarafNo.trim(), g.sonuc]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Bu numarada taraf kaydı bulunamadı.' });
    if (g.sonuc !== 'Temiz') await bildir(b.db, { olay: `tarama:${r.rows[0].kimlik}:${g.sonuc}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, TID)), baslik: `${r.rows[0].unvan_ad_soyad} · Yaptırım Taraması: ${g.sonuc}` });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yaptırım Taraması', nesneTuru: 'Taraf', nesneKimligi: r.rows[0].kimlik, yeni: { sonuc: g.sonuc }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/taraf-risk-olayi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tarafNo?: string; olay?: string };
    if (!(await rolVar(o.kullanici, [HUD, MFM, TID]))) return y.code(403).send({ hata: 'Risk olayını Hukuk ve Uyum Direktörü, Ticari İşler Direktörü veya Muhasebe ve Finans Müdürü işaretler.' });
    if (!g.tarafNo?.trim() || !['İflas', 'Konkordato'].includes(g.olay ?? '')) return y.code(400).send({ hata: 'Taraf no ve risk olayını girmenizi rica ederiz.' });
    const r = await b.db.query(`UPDATE taraf SET risk_olayi = $2 WHERE taraf_no = $1 RETURNING kimlik, unvan_ad_soyad`, [g.tarafNo.trim(), g.olay]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Bu numarada taraf kaydı bulunamadı.' });
    await bildir(b.db, { olay: `risk:${r.rows[0].kimlik}:${g.olay}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, HUD)), baslik: `${r.rows[0].unvan_ad_soyad} · Risk Olayı: ${g.olay}`, oncelik: 'Yüksek' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Risk Olayı', nesneTuru: 'Taraf', nesneKimligi: r.rows[0].kimlik, yeni: { olay: g.olay }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/dosya/:id/ucuncu-kisi-odeme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; tutar?: number; gerekce?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await rolVar(o.kullanici, [TICARI]))) return y.code(403).send({ hata: 'Üçüncü kişi ödemesi talebini Ticari Sorumlu açar.' });
    if (!g.ad?.trim() || !(Number(g.tutar) > 0) || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Ödeyen, tutar ve gerekçeyi girmenizi rica ederiz.' });
    const no = await dosyaNo(id);
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO ucuncu_kisi_odeme (dosya_ref, odeyen_adi, tutar_eur, gerekce, isteyen_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, g.ad!.trim(), g.tutar, g.gerekce!.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Üçüncü Kişi Ödemesi', baslik: `${no} · Üçüncü Kişi Ödemesi`, ozet: `${g.ad!.trim()} · ${tutar(Number(g.tutar))} EUR`, hazirlayan: o.kullanici, zincir: [await rolId(c, HUD), await rolId(c, TID)], nesneTuru: 'Üçüncü Kişi Ödemesi', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik };
    });
  });

  // YG-107: uyuşmazlık alt kaydı ve dışa aktarım paketi (FR-KLT-012).
  s.post('/dosya/:id/uyusmazlik', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { merci?: string; esasNo?: string; savunmaSon?: string; karar?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await rolVar(o.kullanici, [HUD]))) return y.code(403).send({ hata: 'Uyuşmazlık kaydını Hukuk ve Uyum Direktörü girer.' });
    if (!g.merci?.trim()) return y.code(400).send({ hata: 'Merciyi girmenizi rica ederiz.' });
    const no = await dosyaNo(id);
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO uyusmazlik_kaydi (dosya_ref, merci, esas_no, savunma_son, karar, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, g.merci!.trim(), g.esasNo?.trim() || null, g.savunmaSon || null, g.karar?.trim() || null, o.kullanici])).rows[0];
      if (g.savunmaSon) await kartAc(c, { tur: 'Savunma Süresi', kategori: 'islem', baslik: `${no} · Savunma Son Günü`, ozet: g.merci!.trim(), oncelik: 'Yüksek', sahipRol: await rolId(c, HUD), sonZaman: new Date(`${g.savunmaSon}T18:00:00+03:00`), nesneTuru: 'Uyuşmazlık', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik };
    });
  });
  s.post('/uyusmazlik/:id/paket', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [HUD]))) return y.code(403).send({ hata: 'Paketi Hukuk ve Uyum Direktörü üretir.' });
    const u = (await b.db.query(`SELECT dosya_ref FROM uyusmazlik_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!u) return yok(y);
    await belgeUret(b.db, { tur: 'Uyuşmazlık Paketi', nesne: id, dosya: u.dosya_ref });
    return { durum: 'Üretiliyor' };
  });

  // YG-923: sözleşme taslağı imzalı nüsha ve birlikte imzayla yürürlüğe girer; eski sözleşme silinmez.
  s.get('/firma/:id/sozlesme', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolVar(i.oturum!.kullanici, ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı', HUD]))) return yok(y);
    return (await b.db.query(`SELECT kimlik, sozlesme_turu, yururluk::text, bitis::text, durum, imzali_nusha_ref IS NOT NULL AS imzali FROM sozlesme_kaydi WHERE kurulus_ref = $1 ORDER BY olusturma_zamani DESC`, [id])).rows;
  });
  s.post('/firma/:id/sozlesme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; yururluk?: string; bitis?: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı']))) return y.code(403).send({ hata: 'Sözleşme kaydını Sicil Sorumlusu veya Firma Yönetimi açar.' });
    const turler = (await b.db.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = 'LST_SOZLESME_TURU'`)).rows.map((r) => r.deger as string);
    if (!turler.includes(g.tur ?? '') || !g.yururluk) return y.code(400).send({ hata: 'Sözleşme türü ve yürürlük tarihini girmenizi rica ederiz.' });
    if (g.bitis && g.bitis < g.yururluk) return y.code(400).send({ hata: 'Bitiş tarihi yürürlükten önce olamaz.' });
    if (!(await b.db.query(`SELECT 1 FROM kurulus WHERE kimlik = $1`, [id])).rowCount) return yok(y);
    await (await import('./uyum.js')).uyumOlay(b.db, 'sozlesme', 'Kuruluş', id); // YG-1546
    const r = await b.db.query(`INSERT INTO sozlesme_kaydi (kurulus_ref, sozlesme_turu, yururluk, bitis, kaydeden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, g.tur, g.yururluk, g.bitis || null, o.kullanici]);
    return { kimlik: r.rows[0].kimlik };
  });
  s.post('/sozlesme/:id/yururluk', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string; birlikteImza?: boolean };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı']))) return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'İmzalı nüshayı yüklemenizi rica ederiz.' });
    if (!g.birlikteImza) return y.code(409).send({ hata: 'Birlikte imza tamamlanmadan sözleşme yürürlüğe girmez.' });
    const r = await b.db.query(`UPDATE sozlesme_kaydi SET imzali_nusha_ref = $2, birlikte_imza = true, durum = 'Yürürlükte' WHERE kimlik = $1 AND durum = 'Taslak' RETURNING kurulus_ref`, [id, g.belge]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Sözleşme taslak değildir.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sözleşme Yürürlüğe Girdi', nesneTuru: 'Sözleşme', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Yürürlükte' };
  });
}

/** YG-909: kredi limitinin %80'i aşılınca bir kez erken uyarı; alacakIsle günlük çağırır. */
export async function krediUyarilari(db: Pool): Promise<number> {
  let n = 0; const limit = await parametre(db, 'kurumsal_kredi_limiti_eur');
  for (const t of (await db.query(`SELECT DISTINCT y.yat_sahibi_ref, x.unvan_ad_soyad FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref JOIN taraf x ON x.kimlik = y.yat_sahibi_ref WHERE d.musteri_turu = 'Kurumsal Müşteri'`)).rows) {
    const a = await acikAlacak(db, t.yat_sahibi_ref);
    if (a >= limit * 0.8 && await birKez(db, 'kredi_80', t.yat_sahibi_ref)) { await kartAc(db, { tur: 'Kredi Limiti Uyarısı', kategori: 'islem', baslik: `${t.unvan_ad_soyad} · Kredi Limiti %80`, ozet: `${tutar(a)} EUR / ${tutar(limit)} EUR`, oncelik: 'Yüksek', sahipRol: await rolId(db, TID), nesneTuru: 'Taraf', nesneKimligi: t.yat_sahibi_ref }); n++; }
  }
  return n;
}
