import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { KOK } from './ayarlar.js';
import { belgeBagiKaydet } from './belge.js';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { dosyaErisimi } from './dosya.js';
import { gorevlendirmeKontrolu } from './firma_ek.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { gunAy, tutar } from './metin.js';
import { onayTalebiAc, onaySonucKaydet } from './onay.js';
import type { BelgeTanim, Bolum } from './pdf.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const R2 = (x: number) => Math.round(x * 100) / 100;
const TIC = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)'; const TID = 'Ticari İşler Direktörü'; const MFM = 'Muhasebe ve Finans Müdürü'; const HUD = 'Hukuk ve Uyum Direktörü';

/** YG-906: 20.000,00 EUR üzeri işte her dilim için ara ödeme = dilim − avans × dilim / toplam. Yalnız tamamlanan dilimler; ödenen ara ödemeler düşülür. */
export function araOdemeHesapla(g: { toplam: number; avans: number; ilerleme: number; onceki: number; dilim?: number }): number {
  const dilim = g.dilim ?? 20000; if (g.toplam <= dilim || g.ilerleme <= 0) return 0;
  const adet = Math.floor((g.toplam * Math.min(g.ilerleme, 100)) / 100 / dilim);
  return Math.max(0, R2(adet * (dilim - (g.avans * dilim) / g.toplam) - g.onceki));
}
/** YG-906: kurumsalda başta %50, teslimde kalan. */
export const teslimBakiyesi = (toplam: number, odenen: number) => Math.max(0, R2(toplam - odenen));

/** YG-590, YG-620, YG-694: onaylı sözleşme metni; fiyat alanı yok, bedel "LGM tarafından ayrıca iletilir"; LGM Hizmet Koordinatörü imza satırında. */
export async function kurtarmaTanim(db: Db, id: string, kod: string): Promise<{ dosyaAdi: string; sinif: string; t: BelgeTanim }> {
  const k = (await db.query(`SELECT k.hizmet_turu, u.ticari_unvan, d.dosya_no, d.yazisma_dili, y.yat_adi, t.kisi_adi_soyadi FROM kurtarma_operasyonu k JOIN kurulus u ON u.kimlik = k.saglayici_ref JOIN dosya d ON d.kimlik = k.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE k.kimlik = $1`, [id])).rows[0];
  const dil = dilKod(k.yazisma_dili); const m = JSON.parse(readFileSync(join(KOK, 'veri', 'sablon', 'kurtarma_sozlesmesi.json'), 'utf8'))[dil] as { ad: string; maddeler: string[]; imza: string[]; et: Record<string, string> };
  const bolumler: Bolum[] = [
    { baslik: m.et.taraflar!, tur: 'alanlar', alanlar: [{ et: m.et.saglayici!, deger: k.ticari_unvan }, { et: m.et.sahip!, deger: k.kisi_adi_soyadi }, { et: m.et.yat!, deger: k.yat_adi }, { et: m.et.dosya!, deger: k.dosya_no }, { et: m.et.hizmet!, deger: k.hizmet_turu }] },
    { baslik: m.et.hukum!, tur: 'metin', metin: m.maddeler.join('\n\n') },
    { baslik: m.et.imzaBaslik!, tur: 'metin', metin: m.imza.join('\n') },
  ];
  return { dosyaAdi: `${k.dosya_no}-KRT.pdf`, sinif: 'Gizli', t: { ad: m.ad, no: `${k.dosya_no}-KRT`, dosyaNo: k.dosya_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil, yat: k.yat_adi, bolumler, dogrulamaKodu: kod } as unknown as BelgeTanim };
}

/** YG-618, YG-619: ön bilgilendirme, Ek-1, Ek-2, Ek-3 onaylı metinden; doldurulacak alanlar boş bırakılır. */
export async function onBilgiTanim(db: Db, teklif: string, kod: string): Promise<{ dosyaAdi: string; sinif: string; t: BelgeTanim }> {
  const k = (await db.query(`SELECT f.teklif_no, f.surum_no, d.dosya_no, d.yazisma_dili, y.yat_adi, t.kisi_adi_soyadi FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE f.kimlik = $1`, [teklif])).rows[0];
  const dil = dilKod(k.yazisma_dili); const m = JSON.parse(readFileSync(join(KOK, 'veri', 'sablon', 'bireysel_formlar.json'), 'utf8'))[dil] as { ad: string; saglayici: string; maddeler: string[]; eknot: string; ekler: { ad: string; satirlar: string[][] }[]; et: Record<string, string> };
  const bos = (x: string) => x.replace(/\[●\]/g, '……………');
  const bolumler: Bolum[] = [
    { baslik: m.et.taraflar!, tur: 'alanlar', alanlar: [{ et: m.et.saglayici!, deger: m.saglayici }, { et: m.et.sahip!, deger: k.kisi_adi_soyadi }, { et: m.et.yat!, deger: k.yat_adi }, { et: m.et.dosya!, deger: k.dosya_no }, { et: m.et.teklif!, deger: `${k.teklif_no} / ${k.surum_no}` }] },
    { baslik: m.et.hukum!, tur: 'metin', metin: m.maddeler.join('\n\n') },
    { baslik: m.et.ekler!, tur: 'metin', metin: m.eknot },
    ...m.ekler.map((e): Bolum => ({ baslik: e.ad, tur: 'tablo', sutunlar: [{ ad: m.et.alan! }, { ad: m.et.bilgi! }], satirlar: e.satirlar.map((r) => [bos(r[0]!), bos(r[1]!)]) })),
  ];
  // YG-1514: yat sahibi teklifi onayladıysa imza bloğu yerine YATONET 360 Onay Kaydı kutusu basılır.
  const on = (await db.query(`SELECT r.onay_kodu, r.onay_zamani FROM onay_talebi o JOIN yatonet_onay_kaydi r ON r.onay_talebi_ref = o.kimlik WHERE o.ony_kod = 'ONY-23' AND o.nesne_kimligi = $1::text AND r.karar = 'Onaylandı' ORDER BY r.onay_zamani DESC LIMIT 1`, [teklif])).rows[0];
  const onay = on ? { rol: dil === 'en' ? 'Yacht Owner' : 'Yat Sahibi', zaman: `${gunAy(on.onay_zamani)} ${new Date(on.onay_zamani).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}`, kanal: 'YATONET 360', kod: on.onay_kodu } : undefined;
  return { dosyaAdi: `${k.teklif_no}-OB.pdf`, sinif: 'Gizli', t: { ad: m.ad, no: `${k.teklif_no}-OB`, dosyaNo: k.dosya_no, tarih: gunAy(new Date()), surum: `Rev.${k.surum_no}`, dil, yat: k.yat_adi, bolumler, onay, dogrulamaKodu: kod } as unknown as BelgeTanim };
}

/** YG-1070, D-135: Ek-2 onaylı sözleşme metniyle kayıttan üretilir. Kaptan satırı yalnız yetki varsa dolar; "Fatura / Rapor Alıcısı" satırı yoktur. */
export async function ek2Tanim(db: Db, kurum: string, dil: 'tr' | 'en'): Promise<{ t: BelgeTanim; dosyaAdi: string } | null> {
  const e = (await db.query(`SELECT e.*, c.unvan FROM kurumsal_ek2 e JOIN kurumsal_kurum c ON c.kimlik = e.kurum_ref WHERE e.kurum_ref = $1 AND e.durum = 'Yürürlükte' ORDER BY e.surum DESC LIMIT 1`, [kurum])).rows[0];
  if (!e) return null;
  const m = JSON.parse(readFileSync(join(KOK, 'veri', 'sablon', 'kurumsal_ek2.json'), 'utf8'))[dil] as { ad: string; sutun: string[]; satir: Record<string, string>; kapsamNot: string; lgmSatir: string[]; dayanak: string; gunluk: string; resmi: string; kural: string; yatlar: string; islem: string; bitis: string; bilgi: string; limit: string; belge: string; surum: string; bilgiDeger: Record<string, string> };
  const s = e.satirlar as Record<string, { ad?: string; iletisim?: string; limit?: number; belge?: string; not?: string } | undefined>;
  const lm = (v?: number) => (v === undefined || v === null ? '' : `${m.limit}: ${tutar(Number(v), dil)} EUR`);
  const satir = (k: string, not: string) => [m.satir[k]!, s[k]?.ad ?? '', s[k]?.iletisim ?? '', not];
  const kpt = s.kaptan?.ad && Number(s.kaptan.limit) > 0 ? lm(s.kaptan.limit) : '';
  const bolumler: Bolum[] = [
    { baslik: m.ad, tur: 'tablo', sutunlar: m.sutun.map((ad) => ({ ad })), satirlar: [satir('muhatap', s.muhatap?.not ?? ''), satir('kapsam', m.kapsamNot), satir('fiyat', lm(s.fiyat?.limit)), satir('teslim', s.teslim?.belge ? `${m.belge}: ${s.teslim.belge}` : ''), kpt ? satir('kaptan', kpt) : [m.satir.kaptan!, '', '', ''], satir('lgm', ''), m.lgmSatir] },
    { baslik: dil === 'en' ? 'Authority and Channel Details' : 'Yetki ve Kanal Bilgileri', tur: 'alanlar', numarasiz: true, alanlar: [{ et: m.dayanak, deger: e.dayanak, genis: true }, { et: m.gunluk, deger: e.gunluk_kanal }, { et: m.resmi, deger: e.resmi_kanal }, { et: m.yatlar, deger: (e.yatlar as string[]).join(', ') }, { et: m.islem, deger: (e.islem_turleri as string[]).join(', ') }, { et: m.bitis, deger: e.bitis ? gunAy(new Date(e.bitis)) : null }, { et: m.bilgi, deger: (e.bilgi_izni as string[]).map((x) => m.bilgiDeger[x] ?? x).join(', ') }] },
    { baslik: dil === 'en' ? 'Authority and Approval Limit Record' : 'Yetki ve Onay Sınırı Kaydı', tur: 'metin', numarasiz: true, metin: m.kural },
  ];
  const no = `EK2-${String(e.unvan).replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 24).replace(/-+$/, '')}-${e.surum}`;
  return { dosyaAdi: `${no}.pdf`, t: { ad: m.ad, no, tarih: gunAy(new Date(e.zaman)), surum: `${m.surum} ${e.surum}`, dil, bolumler } };
}

// Kurumsal Çerçeve m.26.4, ONY-15: temsilci SMS koduyla onaylayınca sürüm yürürlüğe girer ve sınır kuruma yansır; reddederse önceki sürüm kalır.
onaySonucKaydet('ONY-15', async (c, t, karar) => {
  if (!t.nesne_kimligi) return;
  const e = (await c.query(`UPDATE kurumsal_ek2 SET durum = $2 WHERE kimlik = $1 AND durum = 'Onay Bekliyor' RETURNING kurum_ref, satirlar, surum, kaydeden_ref`, [t.nesne_kimligi, karar === 'Onaylandı' ? 'Yürürlükte' : 'Reddedildi'])).rows[0];
  if (!e) return;
  if (karar === 'Onaylandı') await c.query(`UPDATE kurumsal_kurum SET ek2_onay_siniri = $2 WHERE kimlik = $1`, [e.kurum_ref, Number(e.satirlar.fiyat.limit)]);
  await bildir(c, { olay: `ek2-karar:${t.nesne_kimligi}`, kullanicilar: [e.kaydeden_ref], baslik: `Kurumsal Ek-2 Sürüm ${e.surum}: ${karar}` });
});

/** Kurumsal Çerçeve Ek-2: limiti aşan onay, kurumda yeterli limiti olan Onaylayana geçer (YG-1070). */
export async function limitYonlendir(db: Db, onay: string, kullanici: string, tutarEur: number, simdi = new Date()): Promise<string> {
  const u = (await db.query(`SELECT k.kurum_ref, k.onay_siniri, c.ek2_onay_siniri FROM kurumsal_kullanici k JOIN kurumsal_kurum c ON c.kimlik = k.kurum_ref WHERE k.kullanici_ref = $1`, [kullanici])).rows[0];
  const h = (await db.query(`SELECT tercih_dili FROM kullanici_hesabi WHERE kimlik = $1`, [kullanici])).rows[0]; const dil = dilKod(h?.tercih_dili);
  const s = (await db.query(`SELECT metin FROM sablon_metni WHERE kod = 'ONY-17' AND dil = $1 AND durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`, [dil])).rows[0];
  const limit = Math.min(Number(u?.onay_siniri ?? 0), Number(u?.ek2_onay_siniri ?? 0));
  const yer = /\[0[.,]000[.,]00\]/; const metin = String(s.metin).replace(yer, tutar(tutarEur, dil)).replace(yer, tutar(limit, dil));
  const ad = (await db.query(`SELECT h.kimlik, h.ad_soyad, h.cep_telefonu, h.e_posta FROM kurumsal_kullanici k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.kurum_ref = $1 AND k.rol = 'Onaylayan' AND k.kullanici_ref <> $2 AND h.hesap_durumu = 'Aktif' AND least(coalesce(k.onay_siniri, 0), $3::numeric) >= $4 ORDER BY k.onay_siniri LIMIT 1`, [u?.kurum_ref, kullanici, Number(u?.ek2_onay_siniri ?? 0), tutarEur])).rows[0];
  if (!ad) return metin;
  const r = await db.query(`UPDATE onay_talebi SET alici_kullanici_ref = $2, alici_ad = $3, telefon = $4, eposta = $5 WHERE kimlik = $1 AND durum = 'Bekliyor' AND alici_kullanici_ref = $6`, [onay, ad.kimlik, ad.ad_soyad, ad.cep_telefonu, ad.e_posta, kullanici]);
  if (r.rowCount) await bildir(db, { olay: `limit-yon:${onay}`, kullanicilar: [ad.kimlik], baslik: 'Onayınız Bekleniyor', ozet: 'Limit nedeniyle bir onay size yönlendirildi; Onayınızı Bekleyenler bölümünden görebilirsiniz.', oncelik: 'Yüksek', sms: true }, simdi);
  return `${metin} ${dil === 'en' ? 'The approval has been forwarded to your authorised colleague.' : 'Onay, kurumunuzun yetkili kişisine iletilmiştir.'}`;
}

/** YG-990: dönemsel gözetim. Birden çok rol taşıyanlar ve aynı işte birden çok adımda karar verenler listelenir. */
export async function gorevAyriligiRaporu(db: Db, gun = 31) {
  const coklu = (await db.query(`SELECT h.ad_soyad, array_agg(x.rol_adi ORDER BY x.rol_adi) roller FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND h.kullanici_grubu = 'LGM İç Rolü' GROUP BY h.kimlik, h.ad_soyad HAVING count(*) > 1 ORDER BY h.ad_soyad`)).rows;
  const ayniKisi = (await db.query(`SELECT k.baslik, h.ad_soyad, count(DISTINCT a.kademe)::int kademe, bool_or(a.yapan_ref = k.hazirlayan_ref) hazirlayan_karar FROM is_karti_adim a JOIN is_karti k ON k.kimlik = a.is_ref JOIN kullanici_hesabi h ON h.kimlik = a.yapan_ref WHERE a.zaman > now() - make_interval(days => $1) GROUP BY k.kimlik, k.baslik, h.ad_soyad HAVING count(DISTINCT a.kademe) > 1 OR bool_or(a.yapan_ref = k.hazirlayan_ref) ORDER BY k.baslik`, [gun])).rows;
  return { cokluRol: coklu, ayniKisiAdimlari: ayniKisi };
}

/** YG-313: aynı kişinin birden çok onay kademesinde karar verdiği veya kendi hazırladığı işi onayladığı kayıtlar ile hazırlayanı teknik kabulü de veren iş emirleri için
 *  telafi kontrolü: kayıt başına "Görev Ayrılığı Telafi İncelemesi" (sonradan bağımsız inceleme) İç Denetim Müdürüne açılır; ayda en çok 10 kayıt rastgele örneklenir. */
export async function gorevAyriligiTelafi(db: Pool, donem: string): Promise<number> {
  const l = (await db.query(`SELECT * FROM (
      SELECT 'is_karti' tur, k.kimlik::text kimlik, k.baslik, h.ad_soyad FROM is_karti_adim a JOIN is_karti k ON k.kimlik = a.is_ref JOIN kullanici_hesabi h ON h.kimlik = a.yapan_ref
        WHERE a.karar = 'Onayla' AND a.zaman > now() - interval '31 days' GROUP BY k.kimlik, k.baslik, h.ad_soyad HAVING count(DISTINCT a.kademe) > 1 OR bool_or(a.yapan_ref = k.hazirlayan_ref)
      UNION ALL
      SELECT 'is_emri', e.kimlik::text, e.is_emri_no || ' · Teknik Kabul', h.ad_soyad FROM is_emri e JOIN kullanici_hesabi h ON h.kimlik = e.hazirlayan_ref
        WHERE e.teknik_kabul_eden_ref = e.hazirlayan_ref AND e.guncelleme_zamani > now() - interval '31 days') x
    WHERE NOT EXISTS (SELECT 1 FROM is_karti c WHERE c.tur = 'Görev Ayrılığı Telafi İncelemesi' AND c.nesne_kimligi = x.kimlik) ORDER BY random() LIMIT 10`)).rows;
  let n = 0;
  for (const x of l) {
    if (!(await birKez(db, 'gorev_ayriligi_telafi', `${donem}:${x.kimlik}`))) continue;
    await kartAc(db, { tur: 'Görev Ayrılığı Telafi İncelemesi', kategori: 'gorev', baslik: `${x.baslik} · Bağımsız İnceleme`, ozet: `${x.ad_soyad} aynı işte birden çok adımı (uygulama, kontrol, onay) yürütmüştür. Kaydı sonradan bağımsız olarak inceleyip sonucu not ediniz.`, sahipRol: await rolId(db, 'İç Denetim Müdürü'), nesneTuru: x.tur === 'is_emri' ? 'İş Emri' : 'İş Kartı', nesneKimligi: x.kimlik }); n++;
  }
  return n;
}

/** YG-990: ayda bir İç Denetim Müdürüne gözetim görevi; bulgu yoksa görev açılmaz. */
export async function gorevAyriligiIsle(db: Pool, simdi = new Date()): Promise<number> {
  const donem = simdi.toISOString().slice(0, 7);
  await gorevAyriligiTelafi(db, donem);
  const r = await gorevAyriligiRaporu(db);
  if (!r.ayniKisiAdimlari.length && !r.cokluRol.length) return 0;
  if (!(await birKez(db, 'gorev_ayriligi', donem))) return 0;
  await kartAc(db, { tur: 'Görev Ayrılığı Gözetimi', kategori: 'gorev', baslik: `${donem} · Görev Ayrılığı Gözetimi`, ozet: `Birden çok rol taşıyan: ${r.cokluRol.length} kişi · aynı işte birden çok adım veya kendi işine karar: ${r.ayniKisiAdimlari.length} kayıt. İncelemeniz rica olunur.`, sahipRol: await rolId(db, 'İç Denetim Müdürü') });
  return 1;
}

/** Cayma: kayıt, ONY-19 bildirimi, iade hesabı görevi (YG-1450, YG-1493). */
export async function caymaIsle(c: Db, kayit: string, kanal: string) {
  const k = (await c.query(`SELECT k.*, d.dosya_no, d.yazisma_dili, f.teklif_no, f.surum_no FROM on_bilgilendirme_cayma_kaydi k JOIN dosya d ON d.kimlik = k.dosya_ref JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref WHERE k.kimlik = $1`, [kayit])).rows[0];
  const g = Number((await c.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'cayma_gun'`)).rows[0].deger);
  const r = (await c.query(`UPDATE on_bilgilendirme_cayma_kaydi SET cayma_zamani = now(), kanal = $3, iade_son_tarihi = (now() AT TIME ZONE 'Europe/Istanbul')::date + $2::int, iade_durumu = 'Hesap Bekliyor' WHERE kimlik = $1 AND cayma_zamani IS NULL RETURNING iade_son_tarihi`, [kayit, g, kanal])).rows[0];
  if (!r) return false;
  const odenen = Number((await c.query(`SELECT coalesce(sum(t.tutar_eur), 0) o FROM tahsilat t JOIN musteri_faturasi m ON m.kimlik = t.fatura_ref WHERE m.dosya_ref = $1`, [k.dosya_ref])).rows[0].o);
  const t = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [k.dosya_ref])).rows[0]; const dil = dilKod(k.yazisma_dili); const ts = gunAy(new Date(r.iade_son_tarihi));
  if (t) await yatTarafinaYaz(c, { olay: `ony19:${kayit}`, kod: 'ONY-19', dil, konu: `${k.dosya_no}`, telefon: t.telefon, eposta: t.eposta, alanlar: { 'tarih saat': new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }), 'date and time': new Date().toLocaleString('en-GB', { timeZone: 'Europe/Istanbul' }), tutar: tutar(odenen, dil), amount: tutar(odenen, dil), 'para birimi': 'EUR', currency: 'EUR', tarih: ts, date: ts } });
  await kartAc(c, { tur: 'Cayma İade Hesabı', kategori: 'islem', baslik: `${k.dosya_no} · Cayma İade Hesabı`, ozet: `İade son tarihi: ${ts}`, oncelik: 'Yüksek', sonZaman: new Date(r.iade_son_tarihi), sahipRol: await rolId(c, TIC), nesneTuru: 'Cayma', nesneKimligi: kayit });
  return true;
}
onaySonucKaydet('ONY-18', async (c, t, karar) => { if (karar === 'Onaylandı' && t.nesne_kimligi) await caymaIsle(c, t.nesne_kimligi, 'YATONET 360'); });
kapanisKaydet('Cayma İadesi', async (c, k, karar) => {
  if (karar === 'Onayla') {
    await c.query(`UPDATE on_bilgilendirme_cayma_kaydi SET iade_durumu = 'Ödeme Bekliyor' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
    const dn = (await c.query(`SELECT d.dosya_no FROM on_bilgilendirme_cayma_kaydi x JOIN dosya d ON d.kimlik = x.dosya_ref WHERE x.kimlik = $1::uuid`, [k.nesne_kimligi])).rows[0].dosya_no;
    await kartAc(c, { tur: 'Cayma İade Ödemesi', kategori: 'islem', baslik: `${dn} · Cayma İade Ödemesi`, ozet: k.ozet ?? undefined, oncelik: 'Yüksek', sahipRol: await rolId(c, MFM), nesneTuru: 'Cayma', nesneKimligi: k.nesne_kimligi! });
  } else if (karar === 'Reddet') await c.query(`UPDATE on_bilgilendirme_cayma_kaydi SET iade_durumu = 'Hesap Bekliyor' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

// YG-1070, ONY-14: yat sahibi atamayı SMS kodlu ekranda onaylar; noter vekâleti istenmez, belge kontrolü gerekmez.
onaySonucKaydet('ONY-14', async (c, t, karar) => {
  if (karar !== 'Onaylandı' || !t.nesne_kimligi) return;
  const r = (await c.query(`SELECT atama_taslak a FROM yat_yetkilisi_kaydi WHERE kullanici_ref = $1`, [t.nesne_kimligi])).rows[0]?.a; if (!r) return;
  await c.query(`UPDATE yat_yetkilisi_kaydi SET belge_durumu = 'Geçerli', islem_turleri = $2, ust_limit_eur = $3, bitis_tarihi = $4, odeme_yetkisi = $5, bilgi_paylasim_izni = $6, yatlar = $7, atama_onay_ref = $8, atama_taslak = NULL WHERE kullanici_ref = $1`, [t.nesne_kimligi, r.islemler, r.limit, r.bitis, r.odeme, r.bilgi, r.yatlar, t.kimlik]);
  await bildir(c, { olay: `yetki-atama:${t.kimlik}`, kullanicilar: [t.nesne_kimligi], baslik: 'Yetkiniz Kaydedildi', ozet: 'Yetkilerinizi Yetkilerim sayfasından görebilirsiniz.' });
});

/** YG-1493: beyanı Dosya Sorumlusu 8 saat içinde kaydeder; geç kayıt Ticari İşler Direktörüne bildirilir. */
export async function caymaGecKayit(db: Db, kayit: string, beyan: string | undefined, simdi = new Date()): Promise<boolean> {
  if (!beyan || simdi.getTime() - new Date(beyan).getTime() <= 8 * 3_600_000) return false;
  const d = (await db.query(`SELECT d.dosya_no FROM on_bilgilendirme_cayma_kaydi k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.kimlik = $1`, [kayit])).rows[0];
  await bildir(db, { olay: `cayma-gec:${kayit}`, kullanicilar: await rolSahipleri(db, await rolId(db, TID)), baslik: `⚠ ${d.dosya_no} · Cayma Beyanı 8 Saat Sonra Kaydedildi`, ozet: `Beyan: ${new Date(beyan).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`, oncelik: 'Yüksek' });
  return true;
}

/** YG-1493: iade süresi yaklaşınca uyarı. */
export async function caymaSureIsle(db: Pool): Promise<number> {
  let n = 0;
  for (const k of (await db.query(`SELECT k.kimlik, k.iade_son_tarihi, d.dosya_no FROM on_bilgilendirme_cayma_kaydi k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.iade_durumu IN ('Hesap Bekliyor', 'Onayda', 'Ödeme Bekliyor') AND k.iade_son_tarihi <= current_date + 3`)).rows) if (await birKez(db, 'cayma_iade', k.kimlik)) { await bildir(db, { olay: `cayma-iade:${k.kimlik}`, kullanicilar: [...await rolSahipleri(db, await rolId(db, TID)), ...await rolSahipleri(db, await rolId(db, MFM))], baslik: `⚠ ${k.dosya_no} · Cayma İade Süresi Yaklaşıyor`, ozet: `Son tarih: ${gunAy(new Date(k.iade_son_tarihi))}`, oncelik: 'Kritik' }); n++; }
  return n;
}

// YG-952: izin belgesini yalnız sahibi yükler ve yalnız İnsan Kaynakları görür.
belgeBagiKaydet('İzin', async (db, k, id) => {
  const t = (await db.query(`SELECT personel_ref FROM izin_talebi WHERE kimlik::text = $1`, [id])).rows[0]; if (!t) return 'yok';
  if (t.personel_ref === k) return 'tamam';
  return (await db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi IN ('İnsan Kaynakları Müdürü', 'İnsan Kaynakları Sorumlusu') LIMIT 1`, [k])).rowCount ? 'tamam' : 'yetkisiz';
});

/** YG-051, YG-052: Saha Sorumlusu talebinin ve geri çekmenin kararı. Atama onaylanınca Teknik Müdüre atama işi düşer; geri çekme onaylanınca atama devir notuyla biter. */
async function sahaTalepKarari(c: Db, dosya: string, makam: string, karar: string) {
  const t = (await c.query(`SELECT kimlik, tur, gerekce FROM saha_sorumlusu_talebi WHERE dosya_ref = $1 AND durum IN ('Bekliyor', 'Direktörde') ORDER BY olusturma_zamani DESC LIMIT 1`, [dosya])).rows[0];
  if (!t || (karar !== 'Onayla' && karar !== 'Reddet')) return;
  await c.query(`UPDATE saha_sorumlusu_talebi SET durum = $2, karar_makami = $3 WHERE kimlik = $1`, [t.kimlik, karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi', makam]);
  if (karar !== 'Onayla') return;
  if (t.tur === 'Atama') { const no = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [dosya])).rows[0].dosya_no; await kartAc(c, { tur: 'Saha Sorumlusu Ataması', kategori: 'islem', baslik: `${no} · Saha Sorumlusunu Ata (Talep Onaylandı)`, ozet: t.gerekce, sahipRol: await rolId(c, 'Teknik Müdür'), nesneTuru: 'Dosya', nesneKimligi: dosya }); }
  else await c.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now(), devir_notu = $2 WHERE dosya_ref = $1 AND rol = 'Saha Sorumlusu' AND bitis_zamani IS NULL`, [dosya, t.gerekce]);
}
kapanisKaydet('Saha Sorumlusu Talebi', async (c, k, karar) => sahaTalepKarari(c, k.nesne_kimligi!, 'Teknik Müdür', karar));
kapanisKaydet('Saha Sorumlusu Anlaşmazlığı', async (c, k, karar) => sahaTalepKarari(c, k.nesne_kimligi!, 'Teknik ve Operasyon Direktörü', karar));

/**
 * YG-073: beş kapanış aşaması ayrı koşulla izlenir. Teslim: teslim tutanağı; Teknik: onaylı kapanış kontrolü (Teknik Kapalı);
 * Mali: tahsilat ve firma ödemesi tamamlanıp Kapalı (YG-067); Kurumsal: arşiv devri; Garanti: teslimden 12 ay ve açık garanti kaydı yok. Dosya kapanışı garanti takibini kapatmaz.
 */
export async function kapanisAsamalari(db: Db, dosya: string, simdi = new Date()) {
  const d = (await db.query(`SELECT statu, teslim_tarihi::text, kapanis_zamani, arsiv_zamani FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  if (!d) return null;
  const teslim = (await db.query(`SELECT teslim_zamani FROM teslim_kaydi WHERE dosya_ref = $1 AND durum = 'Teslim Edildi' ORDER BY teslim_zamani LIMIT 1`, [dosya])).rows[0];
  const teknik = (await db.query(`SELECT kapanis_zamani FROM kapanis_kontrolu WHERE dosya_ref = $1 AND cikis_statusu = 'Teknik Kapalı' AND durum = 'Onaylandı' ORDER BY kapanis_zamani LIMIT 1`, [dosya])).rows[0];
  const tahsil = (await db.query(`SELECT 1 FROM musteri_faturasi WHERE dosya_ref = $1 AND durum NOT IN ('Tahsil Edildi', 'Reddedildi') LIMIT 1`, [dosya])).rowCount;
  const odeme = (await db.query(`SELECT 1 FROM hakedis WHERE dosya_ref = $1 AND statu NOT IN ('Ödendi', 'Reddedildi') LIMIT 1`, [dosya])).rowCount;
  const garantiAcik = (await db.query(`SELECT 1 FROM garanti_sikayet WHERE dosya_ref = $1 AND statu <> 'Kapalı' LIMIT 1`, [dosya])).rowCount;
  // KS-1: garanti yalnız dosyada tanımlıysa ve tanımlı süre kadar izlenir.
  const gTan = (await db.query(`SELECT garanti_tanimli, garanti_suresi_ay FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  const gBitis = d.teslim_tarihi && gTan?.garanti_tanimli ? new Date(`${d.teslim_tarihi}T00:00:00Z`) : null; if (gBitis) gBitis.setUTCMonth(gBitis.getUTCMonth() + Number(gTan.garanti_suresi_ay));
  const mali = d.statu === 'Kapalı' && d.kapanis_zamani;
  return [
    { asama: 'Teslim', durum: teslim ? 'Tamamlandı' : 'Bekliyor', zaman: teslim?.teslim_zamani ?? null, kosul: 'Yat Teslim Tutanağının onaylanması' },
    { asama: 'Teknik Kapanış', durum: teknik ? 'Tamamlandı' : 'Bekliyor', zaman: teknik?.kapanis_zamani ?? null, kosul: 'Kapanış kontrolünün onaylanması (Teknik Kapalı)' },
    { asama: 'Mali Kapanış', durum: mali ? 'Tamamlandı' : 'Bekliyor', zaman: mali ? d.kapanis_zamani : null, kosul: mali ? 'Tahsilat ve firma ödemesi tamamlandı' : [tahsil ? 'Tahsilat Bekliyor' : null, odeme ? 'Firma Ödemesi Bekliyor' : null].filter(Boolean).join(', ') || 'Kapanış kontrolü (Kapalı) bekleniyor' },
    { asama: 'Kurumsal Dosya Kapanışı', durum: d.arsiv_zamani ? 'Tamamlandı' : 'Bekliyor', zaman: d.arsiv_zamani ?? null, kosul: 'Arşiv devri' },
    { asama: 'Garanti Takibi', durum: !gBitis ? 'Başlamadı' : garantiAcik || gBitis > simdi ? 'Sürüyor' : 'Tamamlandı', zaman: gBitis ? gBitis.toISOString().slice(0, 10) : null, kosul: garantiAcik ? 'Açık garanti kaydı var' : 'Teslimden itibaren 12 ay' },
  ];
}

/** YG-147: dosyanın bağlı olduğu sözleşmedeki taahhüt süresi; sözleşmede yoksa "Tanımsız"; bireysel yat sahibine süre taahhüt edilmez (null). */
export async function sozlesmeHedefi(db: Db, dosya: string, tur: string): Promise<string | null> {
  if (!['İlk Yanıt', 'Keşif', 'Teklif'].includes(tur)) return null;
  const d = (await db.query(`SELECT d.musteri_turu, d.oncelik, (SELECT s.sigortaci_adi FROM dosya_sigorta_kaydi s WHERE s.dosya_ref = d.kimlik LIMIT 1) sigortaci,
      (SELECT k.kimlik FROM kurumsal_kurum k JOIN yat y ON y.yat_sahibi_ref = k.taraf_ref WHERE y.kimlik = d.yat_ref LIMIT 1) kurum FROM dosya d WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (!d || d.musteri_turu === 'Bireysel Müşteri') return null;
  const r = (await db.query(`SELECT saat FROM sozlesme_hedef_suresi WHERE tur = $1 AND oncelik = $2 AND ((sigortaci_adi IS NOT NULL AND lower(sigortaci_adi) = lower($3)) OR kurum_ref = $4) LIMIT 1`, [tur, d.oncelik, d.musteri_turu === 'Sigorta Şirketi' ? d.sigortaci ?? '' : '', d.musteri_turu === 'Kurumsal Müşteri' ? d.kurum : null])).rows[0];
  return r ? `${Number(r.saat).toLocaleString('tr-TR')} saat` : 'Tanımsız';
}

/** YG-1246: düzeltme talebi açılabilen kayıtlar; tablo, görünen ad sütunu, alan → sütun ve onay makamı. */
const DUZELTME: Record<string, { tablo: string; ad: string; onay: string; alanlar: Record<string, string>; bicim?: Record<string, RegExp> }> = {
  Taraf: { tablo: 'taraf', ad: 'unvan_ad_soyad', onay: 'Operasyon Müdürü', alanlar: { 'Unvan / Ad Soyad': 'unvan_ad_soyad', 'Vergi Dairesi': 'vergi_dairesi', 'Vergi No': 'vergi_no', 'MERSİS No': 'mersis_no', Adres: 'adres', İl: 'il', Telefon: 'telefon', 'E-posta': 'eposta', 'KEP Adresi': 'kep_adresi' }, bicim: { vergi_no: /^[0-9]{10}$/ } },
  Kuruluş: { tablo: 'kurulus', ad: 'ticari_unvan', onay: 'Firma Yönetimi Müdürü', alanlar: { 'Ticari Unvan': 'ticari_unvan', 'MERSİS No': 'mersis_no', Adres: 'adres', İl: 'il', İlçe: 'ilce', 'Kurumsal E-posta': 'kurumsal_eposta', 'Kurumsal Telefon': 'kurumsal_telefon', 'Web Adresi': 'web', 'Yetkili Kişi': 'yetkili_kisi' } },
};
async function duzeltmeTanimi(t: string) {
  if (t !== 'Yat') return DUZELTME[t];
  const { DUZELTILEBILIR } = await import('./yat.js');
  return { tablo: 'yat', ad: 'yat_adi', onay: 'Operasyon Müdürü', alanlar: DUZELTILEBILIR, bicim: undefined as Record<string, RegExp> | undefined };
}
kapanisKaydet('Veri Düzeltme Talebi', async (c, k, karar, yapan) => { // YG-1246
  const t = (await c.query(`SELECT * FROM veri_duzeltme_talebi WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') { await c.query(`UPDATE veri_duzeltme_talebi SET durum = 'Reddedildi' WHERE kimlik = $1`, [t.kimlik]); return; }
  if (karar !== 'Onayla') return;
  const tn = await duzeltmeTanimi(t.nesne_turu); const kol = tn?.alanlar[t.alan]; if (!tn || !kol) return;
  const eski = (await c.query(`SELECT ${kol}::text v FROM ${tn.tablo} WHERE kimlik = $1`, [t.nesne_ref])).rows[0]?.v ?? null;
  await c.query(`UPDATE ${tn.tablo} SET ${kol} = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [t.nesne_ref, t.dogru_deger]);
  await c.query(`UPDATE veri_duzeltme_talebi SET durum = 'Onaylandı' WHERE kimlik = $1`, [t.kimlik]);
  await izYaz(c, { aktor: yapan, eylem: 'Veri Düzeltme', nesneTuru: t.nesne_turu, nesneKimligi: t.nesne_ref, eski: { [t.alan]: eski }, yeni: { [t.alan]: t.dogru_deger }, gerekce: `Kaynak: ${t.kaynak}; etkilenen: ${t.etkilenen}`, sonuc: 'Başarılı' });
});

kapanisKaydet('İade Kaydı', async (c, k, karar) => { // YG-1499
  const r = (await c.query(`SELECT i.*, d.dosya_no, d.yazisma_dili FROM iade_kaydi i JOIN dosya d ON d.kimlik = i.dosya_ref WHERE i.kimlik = $1::uuid AND i.durum = 'Onayda'`, [k.nesne_kimligi])).rows[0];
  if (!r) return;
  if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') { await c.query(`UPDATE iade_kaydi SET durum = 'Reddedildi' WHERE kimlik = $1`, [r.kimlik]); return; }
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE iade_kaydi SET durum = 'Onaylandı' WHERE kimlik = $1`, [r.kimlik]);
  const sahip = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif AND taraf_rolu IN ('Yat Sahibi', 'Yetkili Temsilci') ORDER BY taraf_rolu = 'Yat Sahibi' DESC LIMIT 1`, [r.dosya_ref])).rows[0];
  if (!sahip) return;
  const tt = tutar(Number(r.tutar)); const tr = String(r.iade_tarihi instanceof Date ? r.iade_tarihi.toISOString().slice(0, 10) : r.iade_tarihi).split('-').reverse().join('.');
  await yatTarafinaYaz(c, { olay: `bld47:${r.kimlik}`, kod: 'BLD-47', dil: dilKod(r.yazisma_dili), konu: `${r.dosya_no} İade`, telefon: sahip.telefon, eposta: sahip.eposta,
    alanlar: { 'Dosya No': r.dosya_no, 'File No': r.dosya_no, tutar: tt, amount: tt, 'para birimi': r.para_birimi, currency: r.para_birimi, tarih: tr, date: tr, 'ödeme aracı': r.odeme_araci, 'payment method': r.odeme_araci } });
});

/** YG-147: açık hedef sürede sözleşme taahhüdü aşılınca Dosya Sorumlusu ve Müşteri ve Paydaş İlişkileri Müdürüne bir kez uyarı gider. */
export async function sozlesmeSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const { rows } = await db.query(`SELECT s.kimlik, s.tur, s.baslangic, s.dosya_ref, d.dosya_no, d.dosya_sorumlusu_ref FROM dosya_sure s JOIN dosya d ON d.kimlik = s.dosya_ref WHERE s.tamamlanma IS NULL AND s.tur IN ('İlk Yanıt', 'Keşif', 'Teklif') AND d.musteri_turu <> 'Bireysel Müşteri'`);
  for (const s of rows) {
    const h = await sozlesmeHedefi(db, s.dosya_ref, s.tur); const saat = h && h !== 'Tanımsız' ? Number(h.split(' ')[0]!.replace('.', '').replace(',', '.')) : null;
    if (!saat || new Date(s.baslangic).getTime() + saat * 3_600_000 > simdi.getTime()) continue;
    if (!(await birKez(db, 'sozlesme-sure-asimi', s.kimlik))) continue;
    const kisiler = [...new Set([...(s.dosya_sorumlusu_ref ? [s.dosya_sorumlusu_ref] : []), ...await rolSahipleri(db, await rolId(db, 'Müşteri ve Paydaş İlişkileri Müdürü'))])];
    await bildir(db, { olay: `sozlesme-sure:${s.kimlik}`, kullanicilar: kisiler, baslik: `⚠ ${s.dosya_no} · ${s.tur} Sözleşme Taahhüdü Aşıldı`, ozet: `Sözleşmedeki süre: ${h}.`, oncelik: 'Yüksek' }, simdi);
    n++;
  }
  return n;
}

export const KONUM_TURLERI = ['Bağlama Noktası', 'Tersane Bölgesi', 'Sanayi Sitesi', 'Organize Sanayi Bölgesi', 'Serbest Bölge', 'Diğer'];

export function kalanYollari(s: FastifyInstance, b: Baglam) {
  // YG-1499: iade (avans iadesi, fazla ödeme, itiraz sonucu) Ticari Sorumluca hazırlanır, Ticari İşler Direktörü onaylar; onayla BLD-47 yat sahibine gider.
  s.post('/dosya/:id/iade', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { neden?: string; tutar?: number; paraBirimi?: string; tarih?: string; odemeAraci?: string; aciklama?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    if (!(await rolSahipleri(b.db, await rolId(b.db, TIC))).includes(o.kullanici)) return y.code(403).send({ hata: 'İade kaydını Ticari Sorumlu hazırlar.' });
    if (!['Avans İadesi', 'Fazla Ödeme', 'İtiraz Sonucu İade'].includes(g.neden ?? '') || !(Number(g.tutar) > 0) || !['EUR', 'TL'].includes(g.paraBirimi ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih ?? '') || !g.odemeAraci?.trim()) return y.code(400).send({ hata: 'İade nedeni, tutar, para birimi, iade tarihi ve ödeme aracı zorunludur.' });
    const r = (await b.db.query(`INSERT INTO iade_kaydi (dosya_ref, neden, tutar, para_birimi, iade_tarihi, odeme_araci, aciklama, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [id, g.neden, Number(g.tutar), g.paraBirimi, g.tarih, g.odemeAraci!.trim(), g.aciklama?.trim() || null, o.kullanici])).rows[0];
    const no = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0].dosya_no;
    await kartAc(b.db, { tur: 'İade Kaydı', baslik: `${no} · ${g.neden} · ${tutar(Number(g.tutar))} ${g.paraBirimi}`, ozet: `${g.odemeAraci!.trim()} · ${g.tarih!.split('-').reverse().join('.')}`, hazirlayan: o.kullanici, zincir: [await rolId(b.db, TID)], nesneTuru: 'İade Kaydı', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik, durum: 'Onayda' };
  });
  // YG-1246: hatalı alan, doğru değer, doğru değerin kaynağı ve etkilenen dosya/işlemler yazılarak düzeltme istenir; Operasyon Müdürü onaylar; önceki değer denetim izinde korunur.
  s.get('/veri-duzeltme-alanlari', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    const sonuc: Record<string, string[]> = {};
    for (const t of ['Yat', 'Taraf', 'Kuruluş']) sonuc[t] = Object.keys((await duzeltmeTanimi(t))!.alanlar);
    return sonuc;
  });
  s.post('/veri-duzeltme-talebi', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { nesneTuru?: string; nesne?: string; yat?: string; alan?: string; dogruDeger?: string; kaynak?: string; etkilenen?: string };
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Veri düzeltme talebini LGM personeli açar.' });
    const tn = await duzeltmeTanimi(g.nesneTuru ?? '');
    // Taraf talebi yat üzerinden de açılabilir: yatın kayıtlı sahibi düzeltilir.
    if (g.nesneTuru === 'Taraf' && !g.nesne && g.yat && UUID.test(g.yat)) g.nesne = (await b.db.query(`SELECT yat_sahibi_ref::text r FROM yat WHERE kimlik = $1`, [g.yat])).rows[0]?.r ?? undefined;
    if (!tn || !g.nesne || !UUID.test(g.nesne) || !tn.alanlar[g.alan ?? '']) return y.code(400).send({ hata: 'Kayıt ve düzeltilecek alanı seçiniz.' });
    if (!String(g.dogruDeger ?? '').trim() || !g.kaynak?.trim() || !g.etkilenen?.trim()) return y.code(400).send({ hata: 'Doğru değer, doğru değerin kaynağı ve etkilenen dosya veya işlemler zorunludur.' });
    const kol = tn.alanlar[g.alan!]!;
    if (tn.bicim?.[kol] && !tn.bicim[kol]!.test(String(g.dogruDeger).trim())) return y.code(400).send({ hata: `${g.alan} biçimi geçersizdir.` });
    const m = (await b.db.query(`SELECT ${tn.ad} ad, ${kol}::text v FROM ${tn.tablo} WHERE kimlik = $1`, [g.nesne])).rows[0]; if (!m) return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    const r = (await b.db.query(`INSERT INTO veri_duzeltme_talebi (nesne_turu, nesne_ref, alan, mevcut_deger, dogru_deger, kaynak, etkilenen, talep_eden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [g.nesneTuru, g.nesne, g.alan, m.v, String(g.dogruDeger).trim(), g.kaynak.trim(), g.etkilenen.trim(), o.kullanici])).rows[0];
    await kartAc(b.db, { tur: 'Veri Düzeltme Talebi', baslik: `${m.ad} · ${g.alan}: ${m.v ?? '—'} → ${String(g.dogruDeger).trim()}`, ozet: `Kaynak: ${g.kaynak.trim()} · Etkilenen: ${g.etkilenen.trim()}`.slice(0, 400), hazirlayan: o.kullanici, zincir: [await rolId(b.db, tn.onay)], nesneTuru: 'Veri Düzeltme Talebi', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik, durum: 'Onayda' };
  });
  // YG-437: kurumsal müşteri tarafında LGM'yi görevlendiren kayıt "Müşteri Talimatı"dır (sigortada Sigorta Görevlendirmesi; İş Emri yalnız firmaya verilen belgedir). BLD-67 kurumsal onay e-postasına gider.
  s.post('/dosya/:id/musteri-talimati', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kanal?: string; limit?: number; hedef?: string; metin?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    const d = (await b.db.query(`SELECT d.dosya_no, d.musteri_turu, d.yazisma_dili, d.dosya_sorumlusu_ref, h.e_posta ds_eposta, t.kurumsal_onay_epostasi, t.eposta FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN taraf t ON t.kimlik = y.yat_sahibi_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref WHERE d.kimlik = $1`, [id])).rows[0];
    if (d.musteri_turu !== 'Kurumsal Müşteri') return y.code(409).send({ hata: 'Müşteri Talimatı kurumsal müşteri dosyasında kaydedilir.' });
    if (d.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Müşteri Talimatını Dosya Sorumlusu kaydeder.' });
    if (!['Portal', 'E-posta', 'Ek-2 Kanalı'].includes(g.kanal ?? '') || !(Number(g.limit) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(g.hedef ?? '') || !g.metin?.trim()) return y.code(400).send({ hata: 'Kanal, mali limit, hedef tarih ve talimat metni zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const { altNumara } = await import('./sure.js'); const no = await altNumara(c, d.dosya_no, 'MT');
      await c.query(`INSERT INTO musteri_talimati (talimat_no, dosya_ref, kanal, mali_limit_eur, hedef_tarih, talimat_metni, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [no, id, g.kanal, Number(g.limit), g.hedef, g.metin.trim(), o.kullanici]);
      const alici = d.kurumsal_onay_epostasi ?? d.eposta;
      if (alici) { const en = dilKod(d.yazisma_dili) === 'en'; const tarih = g.hedef!.split('-').reverse().join('.'); const tut = tutar(Number(g.limit));
        await yatTarafinaYaz(c, { olay: `bld67:${no}`, kod: 'BLD-67', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} ${en ? 'Instruction Received' : 'Talimatınız Alındı'}`, eposta: alici, alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, tutar: tut, amount: tut, tarih, date: tarih, 'rol / iletişim': `Dosya Sorumlusu · ${d.ds_eposta ?? ''}`, 'role / contact': `File Manager · ${d.ds_eposta ?? ''}` } }); }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Müşteri Talimatı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { no, limit: g.limit, hedef: g.hedef }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { talimatNo: no, bildirim: Boolean(alici) };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  // YG-478, YG-091: çok malikli yat; malikler pay oranıyla kaydedilir, onay ve fatura muhatabı olarak tek yetkili malik seçilir.
  const malikDosya = async (k: string, id: string) => (UUID.test(id) && await dosyaErisimi(b.db, k, id) ? (await b.db.query(`SELECT d.dosya_no, d.yat_ref FROM dosya d WHERE d.kimlik = $1`, [id])).rows[0] : undefined);
  s.get('/dosya/:id/malikler', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const d = await malikDosya(i.oturum!.kullanici, (i.params as { id: string }).id); if (!d) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    return (await b.db.query(`SELECT m.kimlik, m.ad, m.pay_orani, m.yetkili, m.yurt_disi, m.tebligat_adresi_tr, t.taraf_no FROM yat_malik m LEFT JOIN taraf t ON t.kimlik = m.taraf_ref WHERE m.yat_ref = $1 ORDER BY m.yetkili DESC, m.ad`, [d.yat_ref])).rows;
  });
  s.post('/dosya/:id/malik', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; pay?: number; tarafNo?: string; yurtDisi?: boolean; tebligat?: string };
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Malik kaydını LGM personeli girer.' });
    if (g.yurtDisi && !g.tebligat?.trim()) return y.code(400).send({ hata: 'Yurt dışında yerleşik veya yabancı malik için Türkiye tebligat adresi zorunludur.' }); // YG-479
    const d = await malikDosya(o.kullanici, id); if (!d) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    if (!g.ad?.trim() || (g.pay !== undefined && !(Number(g.pay) > 0 && Number(g.pay) <= 100))) return y.code(400).send({ hata: 'Malik adı zorunludur; pay oranı 0–100 arasında olmalıdır.' });
    const toplam = Number((await b.db.query(`SELECT coalesce(sum(pay_orani), 0) s FROM yat_malik WHERE yat_ref = $1`, [d.yat_ref])).rows[0].s);
    if (g.pay !== undefined && toplam + Number(g.pay) > 100) return y.code(409).send({ hata: 'Malik payları toplamı %100\'ü aşamaz.' });
    const taraf = g.tarafNo?.trim() ? (await b.db.query(`SELECT kimlik FROM taraf WHERE taraf_no = $1`, [g.tarafNo.trim()])).rows[0]?.kimlik : null;
    if (g.tarafNo?.trim() && !taraf) return y.code(400).send({ hata: 'Bu numarada taraf kaydı bulunamadı.' });
    const r = (await b.db.query(`INSERT INTO yat_malik (yat_ref, ad, taraf_ref, pay_orani, ekleyen_ref, yurt_disi, tebligat_adresi_tr) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [d.yat_ref, g.ad.trim(), taraf, g.pay ?? null, o.kullanici, Boolean(g.yurtDisi), g.tebligat?.trim() || null])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yat Maliki Eklendi', nesneTuru: 'Yat', nesneKimligi: d.yat_ref, yeni: { ad: g.ad.trim(), pay: g.pay }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });
  s.post('/dosya/:id/malik/:malik/yetkili', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const o = i.oturum!; const { id, malik } = i.params as { id: string; malik: string }; const g = (i.body ?? {}) as { dayanak?: string };
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Yetkili maliki LGM personeli kaydeder.' });
    const d = await malikDosya(o.kullanici, id); if (!d || !UUID.test(malik)) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    if (!g.dayanak?.trim()) return y.code(400).send({ hata: 'Maliklerin yetkili malik belirlediği belge veya beyanı yazınız.' });
    const m = (await b.db.query(`SELECT kimlik, ad, taraf_ref FROM yat_malik WHERE kimlik = $1 AND yat_ref = $2`, [malik, d.yat_ref])).rows[0]; if (!m) return y.code(404).send({ hata: 'Malik bulunamadı.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE yat_malik SET yetkili = false WHERE yat_ref = $1 AND yetkili`, [d.yat_ref]);
      await c.query(`UPDATE yat_malik SET yetkili = true WHERE kimlik = $1`, [malik]);
      if (m.taraf_ref) await c.query(`UPDATE yat SET yetkili_malik_ref = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [d.yat_ref, m.taraf_ref]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE nesne_kimligi = $1 AND durum = 'Bekliyor' AND baslik LIKE '%Yetkili Malik Atanacak'`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yetkili Malik Belirlendi', nesneTuru: 'Yat', nesneKimligi: d.yat_ref, yeni: { malik: m.ad }, gerekce: g.dayanak.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    return { tamam: true };
  });
  // YG-147: sözleşme taahhüt süreleri Müşteri ve Paydaş İlişkileri Müdürü veya Ticari İşler Direktörünce girilir.
  s.get('/sozlesme-hedef-sureleri', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    return (await b.db.query(`SELECT h.kimlik, h.sigortaci_adi, k.unvan kurum, h.tur, h.oncelik, h.saat FROM sozlesme_hedef_suresi h LEFT JOIN kurumsal_kurum k ON k.kimlik = h.kurum_ref ORDER BY coalesce(h.sigortaci_adi, k.unvan), h.tur, h.oncelik`)).rows;
  });
  s.post('/sozlesme-hedef-suresi', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { sigortaci?: string; kurum?: string; tur?: string; oncelik?: string; saat?: number };
    if (!(await rolSahipleri(b.db, await rolId(b.db, 'Müşteri ve Paydaş İlişkileri Müdürü'))).includes(o.kullanici) && !(await rolSahipleri(b.db, await rolId(b.db, 'Ticari İşler Direktörü'))).includes(o.kullanici)) return y.code(403).send({ hata: 'Sözleşme sürelerini Müşteri ve Paydaş İlişkileri Müdürü veya Ticari İşler Direktörü girer.' });
    if (Boolean(g.sigortaci?.trim()) === Boolean(g.kurum)) return y.code(400).send({ hata: 'Sigorta şirketini veya kurumsal müşteriyi seçiniz.' });
    if (g.kurum && !(UUID.test(g.kurum) && (await b.db.query(`SELECT 1 FROM kurumsal_kurum WHERE kimlik = $1`, [g.kurum])).rowCount)) return y.code(400).send({ hata: 'Kurumsal müşteri bulunamadı.' });
    if (!['İlk Yanıt', 'Keşif', 'Teklif'].includes(g.tur ?? '') || !['Kritik', 'Yüksek', 'Normal', 'Planlı'].includes(g.oncelik ?? '') || !(Number(g.saat) > 0)) return y.code(400).send({ hata: 'Süre türü, öncelik ve saat zorunludur.' });
    await b.db.query(`INSERT INTO sozlesme_hedef_suresi (sigortaci_adi, kurum_ref, tur, oncelik, saat, giren_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (coalesce(lower(sigortaci_adi), kurum_ref::text), tur, oncelik) DO UPDATE SET saat = EXCLUDED.saat, giren_ref = EXCLUDED.giren_ref`, [g.sigortaci?.trim() || null, g.kurum || null, g.tur, g.oncelik, Number(g.saat), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sözleşme Hedef Süresi', nesneTuru: 'Parametre', nesneKimligi: `${g.sigortaci ?? g.kurum}:${g.tur}:${g.oncelik}`, yeni: { saat: g.saat }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // YG-900: tahsilat vadesi; sigortada şirketin bildirdiği ödeme günü (en çok 30 gün), kurumsalda sözleşme vadesi.
  s.get('/sozlesme-odeme-vadeleri', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    return (await b.db.query(`SELECT v.kimlik, v.sigortaci_adi, k.unvan kurum, v.gun, v.dayanak FROM sozlesme_odeme_vadesi v LEFT JOIN kurumsal_kurum k ON k.kimlik = v.kurum_ref ORDER BY coalesce(v.sigortaci_adi, k.unvan)`)).rows;
  });
  s.post('/sozlesme-odeme-vadesi', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { sigortaci?: string; kurum?: string; gun?: number; dayanak?: string };
    if (!(await rolSahipleri(b.db, await rolId(b.db, 'Müşteri ve Paydaş İlişkileri Müdürü'))).includes(o.kullanici) && !(await rolSahipleri(b.db, await rolId(b.db, 'Ticari İşler Direktörü'))).includes(o.kullanici)) return y.code(403).send({ hata: 'Ödeme vadesini Müşteri ve Paydaş İlişkileri Müdürü veya Ticari İşler Direktörü girer.' });
    if (Boolean(g.sigortaci?.trim()) === Boolean(g.kurum)) return y.code(400).send({ hata: 'Sigorta şirketini veya kurumsal müşteriyi seçiniz.' });
    if (g.kurum && !(UUID.test(g.kurum) && (await b.db.query(`SELECT 1 FROM kurumsal_kurum WHERE kimlik = $1`, [g.kurum])).rowCount)) return y.code(400).send({ hata: 'Kurumsal müşteri bulunamadı.' });
    const gun = Number(g.gun); if (!Number.isInteger(gun) || gun < 0 || gun > 180) return y.code(400).send({ hata: 'Vade gün olarak girilir.' });
    if (g.sigortaci && (gun < 1 || gun > 30)) return y.code(400).send({ hata: 'Sigorta şirketinde vade fatura tarihinden en çok 30 takvim günüdür.' });
    if (!g.dayanak?.trim()) return y.code(400).send({ hata: 'Dayanağı (sigorta şirketi yazısı veya sözleşme maddesi) yazınız.' });
    await b.db.query(`INSERT INTO sozlesme_odeme_vadesi (sigortaci_adi, kurum_ref, gun, dayanak, giren_ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (coalesce(lower(sigortaci_adi), kurum_ref::text)) DO UPDATE SET gun = EXCLUDED.gun, dayanak = EXCLUDED.dayanak, giren_ref = EXCLUDED.giren_ref, zaman = now()`, [g.sigortaci?.trim() || null, g.kurum || null, gun, g.dayanak.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sözleşme Ödeme Vadesi', nesneTuru: 'Parametre', nesneKimligi: String(g.sigortaci ?? g.kurum), yeni: { gun, dayanak: g.dayanak.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.get('/dosya/:id/kapanis-asamalari', { preHandler: tamOturumGerekli(b) }, async (i, y) => { // YG-073
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    return kapanisAsamalari(b.db, id);
  });
  // YG-051, YG-052: Operasyon tarafı Saha Sorumlusu ister veya iş bitmeden geri çekilmesini ister; karar Teknik Müdürde. Kritik öncelikte atama zaten zorunludur (YG-050).
  s.post('/dosya/:id/saha-sorumlusu-talebi', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; gerekce?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    const tur = g.tur === 'Geri Çekme' ? 'Geri Çekme' : 'Atama';
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: tur === 'Atama' ? 'Talep gerekçesini yazınız.' : 'Devir notunu yazınız; devir kaydı tamamlanmadan Saha Sorumlusu geri çekilmez.' });
    const ekipte = (await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL AND rol IN ('Dosya Sorumlusu', 'Operasyon Yöneticisi', 'Teknik Yönetici')`, [id, o.kullanici])).rowCount;
    if (!ekipte && !(await rolSahipleri(b.db, await rolId(b.db, 'Operasyon Müdürü'))).includes(o.kullanici)) return y.code(403).send({ hata: 'Talebi dosya ekibi veya Operasyon Müdürü açar.' });
    const d = (await b.db.query(`SELECT dosya_no, oncelik, statu FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (d.statu === 'Kapalı') return y.code(409).send({ hata: 'Kapalı dosyada talep açılmaz.' });
    const saha = (await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Saha Sorumlusu' AND bitis_zamani IS NULL`, [id])).rowCount;
    if (tur === 'Atama' && d.oncelik === 'Kritik') return y.code(409).send({ hata: 'Kritik öncelikte Saha Sorumlusu zaten zorunludur; Teknik Müdür doğrudan atar.' });
    if (tur === 'Atama' && saha) return y.code(409).send({ hata: 'Dosyada Saha Sorumlusu atanmıştır.' });
    if (tur === 'Geri Çekme' && !saha) return y.code(409).send({ hata: 'Dosyada Saha Sorumlusu yoktur.' });
    if ((await b.db.query(`SELECT 1 FROM saha_sorumlusu_talebi WHERE dosya_ref = $1 AND durum IN ('Bekliyor', 'Direktörde')`, [id])).rowCount) return y.code(409).send({ hata: 'Dosyada karar bekleyen Saha Sorumlusu talebi vardır.' });
    await b.db.query(`INSERT INTO saha_sorumlusu_talebi (dosya_ref, tur, gerekce, talep_eden_ref) VALUES ($1,$2,$3,$4)`, [id, tur, g.gerekce.trim(), o.kullanici]);
    await kartAc(b.db, { tur: 'Saha Sorumlusu Talebi', baslik: `${d.dosya_no} · Saha Sorumlusu ${tur === 'Atama' ? 'Talebi' : 'Geri Çekme Talebi'}`, ozet: g.gerekce.trim(), oncelik: d.oncelik, hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Teknik Müdür')], nesneTuru: 'Dosya', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Saha Sorumlusu ${tur} Talebi`, nesneTuru: 'Dosya', nesneKimligi: id, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // YG-051: Teknik Müdür reddederse (uygun personel yok veya anlaşmazlık) Operasyon tarafı kararı T&O Direktörüne taşır.
  s.post('/dosya/:id/saha-sorumlusu-talebi/direktor', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gerekce?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return y.code(404).send({ hata: 'Dosya bulunamadı; dosya bilgisini kontrol etmenizi rica ederiz.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Anlaşmazlık gerekçesini yazınız.' });
    const t = (await b.db.query(`SELECT kimlik, tur FROM saha_sorumlusu_talebi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 1`, [id])).rows[0];
    if (!t || (await b.db.query(`SELECT durum FROM saha_sorumlusu_talebi WHERE kimlik = $1`, [t.kimlik])).rows[0].durum !== 'Reddedildi') return y.code(409).send({ hata: 'Direktöre yalnız Teknik Müdürün reddettiği talep taşınır.' });
    const no = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0].dosya_no;
    await b.db.query(`UPDATE saha_sorumlusu_talebi SET durum = 'Direktörde' WHERE kimlik = $1`, [t.kimlik]);
    await kartAc(b.db, { tur: 'Saha Sorumlusu Anlaşmazlığı', baslik: `${no} · Saha Sorumlusu Anlaşmazlığı`, ozet: g.gerekce.trim(), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Teknik ve Operasyon Direktörü')], nesneTuru: 'Dosya', nesneKimligi: id });
    return { tamam: true };
  });

  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  // YG-589: marinada tablet veya kâğıtla imzalatılan ön bilgilendirme nüshası teklife bağlanır; kâğıt cayma formu Dosya Sorumlusunca kayda alınır ve cayma işler.
  const dsMi = async (dosya: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND dosya_sorumlusu_ref = $2`, [dosya, k])).rowCount);
  const dosyaBelgesi = async (x: unknown, dosya: string) => typeof x === 'string' && UUID.test(x) && Boolean((await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2::text`, [x, dosya])).rowCount);
  s.post('/teklif/:id/imzali-on-bilgi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { belge } = (i.body ?? {}) as { belge?: string };
    if (!UUID.test(id)) return yok(y);
    const f = (await b.db.query(`SELECT f.dosya_ref, d.musteri_turu FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [id])).rows[0];
    if (!f || !(await dsMi(f.dosya_ref, o.kullanici))) return yok(y);
    if (f.musteri_turu !== 'Bireysel Müşteri') return y.code(409).send({ hata: 'Ön bilgilendirme yalnız bireysel müşteride vardır.' });
    if (!(await dosyaBelgesi(belge, f.dosya_ref))) return y.code(400).send({ hata: 'İmzalı nüshayı dosyaya yükleyip seçiniz.' });
    await b.db.query(`UPDATE fiyat_teklifi SET imzali_ob_ref = $2 WHERE kimlik = $1`, [id, belge]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İmzalı Ön Bilgilendirme Nüshası Bağlandı', nesneTuru: 'Fiyat Teklifi', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/dosya/:id/cayma-formu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { belge } = (i.body ?? {}) as { belge?: string };
    if (!UUID.test(id) || !(await dsMi(id, o.kullanici))) return yok(y);
    const k = (await b.db.query(`SELECT kimlik, cayma_bitis, cayma_zamani FROM on_bilgilendirme_cayma_kaydi WHERE dosya_ref = $1 ORDER BY sozlesme_zamani DESC LIMIT 1`, [id])).rows[0];
    if (!k) return y.code(409).send({ hata: 'Bu dosyada cayma hakkı kaydı bulunmamaktadır.' });
    if (k.cayma_zamani) return y.code(409).send({ hata: 'Cayma bildirimi alınmıştır.' });
    if (!(await dosyaBelgesi(belge, id))) return y.code(400).send({ hata: 'İmzalı cayma formunu dosyaya yükleyip seçiniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE on_bilgilendirme_cayma_kaydi SET cayma_belge_ref = $2 WHERE kimlik = $1`, [k.kimlik, belge]);
      const ok = await caymaIsle(c, k.kimlik, 'Islak İmzalı Form');
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kâğıt Cayma Formu Kaydedildi', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { cayma: ok };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-1450: yat sahibi cayma düğmesi; ONY-18 kodlu ekran açılır.
  s.post('/portal/dosya/:id/cayma', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT kisi_adi_soyadi, telefon, eposta, kimlik FROM dosya_tarafi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [id, o.kullanici])).rows[0];
    if (!t) return yok(y);
    const k = (await b.db.query(`SELECT k.kimlik, k.cayma_bitis, k.cayma_zamani, f.teklif_no, f.surum_no, d.yazisma_dili, d.dosya_no FROM on_bilgilendirme_cayma_kaydi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.dosya_ref = $1 ORDER BY k.sozlesme_zamani DESC LIMIT 1`, [id])).rows[0];
    if (!k) return y.code(409).send({ hata: 'Bu dosyada cayma hakkı kaydı bulunmamaktadır.' });
    if (k.cayma_zamani) return y.code(409).send({ hata: 'Cayma bildiriminiz alınmıştır.' });
    if (new Date(k.cayma_bitis) < new Date()) return y.code(409).send({ hata: 'Cayma süresi dolmuştur.' });
    const tv = `${k.teklif_no} / ${k.surum_no}`;
    const on = await onayTalebiAc(b.db, { dosya: id, ony: 'ONY-18', dil: dilKod(k.yazisma_dili), alanlar: { 'Teklif No / Sürüm': tv, 'Quotation No / Version': tv }, aliciAd: t.kisi_adi_soyadi, taraf: t.kimlik, kullanici: o.kullanici, telefon: t.telefon, eposta: t.eposta, nesneTuru: 'Cayma', nesneKimligi: k.kimlik, hazirlayan: o.kullanici, webAdresi: b.webAdresi, konu: k.dosya_no });
    return { kimlik: on.kimlik };
  });
  s.get('/cayma-iadeleri', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [TIC, TID, MFM]))) return y.code(403).send({ hata: 'İadeleri Muhasebe ve Finans görür.' });
    return (await b.db.query(`SELECT k.kimlik, d.dosya_no, k.iade_durumu, k.iade_tutar_eur, k.iade_son_tarihi::text FROM on_bilgilendirme_cayma_kaydi k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.iade_durumu <> 'Yok' AND k.iade_durumu <> 'Ödendi' ORDER BY k.iade_son_tarihi`)).rows;
  });
  s.post('/cayma/:id/iade-hesabi', oturumlu, async (i, y) => { // YG-1493: Ticari Sorumlu hesaplar, TİD onaylar, MFM öder.
    const o = i.oturum!; const { id } = i.params as { id: string }; const t = Number(((i.body ?? {}) as { tutar?: number }).tutar);
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [TIC]))) return y.code(403).send({ hata: 'İade hesabını Ticari Sorumlu yapar.' });
    if (!(t >= 0)) return y.code(400).send({ hata: 'İade tutarını girmenizi rica ederiz.' });
    const k = (await b.db.query(`UPDATE on_bilgilendirme_cayma_kaydi k SET iade_tutar_eur = $2, iade_durumu = 'Onayda' FROM dosya d WHERE k.kimlik = $1 AND d.kimlik = k.dosya_ref AND k.iade_durumu = 'Hesap Bekliyor' RETURNING d.dosya_no`, [id, t])).rows[0];
    if (!k) return y.code(409).send({ hata: 'Hesap bekleyen iade bulunmamaktadır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Cayma İade Hesabı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await kartAc(b.db, { tur: 'Cayma İadesi', baslik: `${k.dosya_no} · Cayma İadesi`, ozet: `${tutar(t)} EUR`, oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(b.db, TID)], nesneTuru: 'Cayma', nesneKimligi: id });
    return { durum: 'Onayda' };
  });
  s.post('/cayma/:id/iade-odendi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [MFM]))) return y.code(403).send({ hata: 'İade ödemesini Muhasebe ve Finans Müdürü kaydeder.' });
    const r = await b.db.query(`UPDATE on_bilgilendirme_cayma_kaydi SET iade_durumu = 'Ödendi', iade_odeme_zamani = now() WHERE kimlik = $1 AND iade_durumu = 'Ödeme Bekliyor'`, [id]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Ödeme bekleyen iade bulunmamaktadır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Cayma İade Ödemesi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Cayma İadesi Ödendi', nesneTuru: 'Cayma', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-1521: temsilci kaydedilince vefat askısı kalkar; kararı Hukuk ve Uyum Direktörü verir.
  s.post('/dosya/:id/vefat-temsilci', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { temsilci?: string; belge?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [HUD]))) return y.code(403).send({ hata: 'Temsilciyi Hukuk ve Uyum Direktörü kaydeder.' });
    if (!g.temsilci?.trim() || !g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Temsilci ve mirasçılık belgesi zorunludur.' });
    const r = await b.db.query(`UPDATE dosya SET vefat_isareti = false, vefat_temsilci = $2, vefat_temsilci_belge = $3, guncelleme_zamani = now() WHERE kimlik = $1 AND vefat_isareti`, [id, g.temsilci.trim(), g.belge]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu dosyada vefat askısı bulunmamaktadır.' });
    await b.db.query(`UPDATE is_karti k SET durum = 'Tamamlandı', kapanma_zamani = now() FROM musteri_faturasi f WHERE k.tur = 'Vefat Alacak Askısı' AND k.durum = 'Bekliyor' AND k.nesne_kimligi = f.kimlik::text AND f.dosya_ref = $1`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Vefat Temsilcisi', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-304: atama listesi kapsamadan süzülür, tüm kapılar birlikte değerlendirilir; en yakın veya en ucuz otomatik seçilmez, fiyat ve mesafe sıralamaya girmez.
  s.get('/dosya/:id/firma-adaylari', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const q = (i.query ?? {}) as { brans?: string; katman?: string; yalnizMobil?: string; yalnizUygun?: string }; const brans = q.brans?.trim();
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!brans) return y.code(400).send({ hata: 'Branşı seçiniz.' });
    const konum = String((await b.db.query(`SELECT konum FROM dosya WHERE kimlik = $1`, [id])).rows[0].konum).toLocaleLowerCase('tr');
    const l0 = (await b.db.query(`SELECT u.kimlik, u.ticari_unvan, y.kapsama, y.bolge FROM brans_yetkinligi y JOIN kurulus u ON u.kimlik = y.kurulus_ref WHERE y.ana_brans = $1 AND y.durum = 'Aktif' AND u.kayit_rolu = 'Çözüm Ortağı' AND u.ag_statusu = 'Aktif' AND u.kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı')`, [brans])).rows;
    // YG-1539: katmanlar Bölge (varsayılan), Komşu, Mobil Ekip, Ulusal; istenen katmana kadar birikimli listelenir.
    const SIRA = ['Bölge', 'Komşu', 'Mobil Ekip', 'Ulusal']; const ust = Math.max(0, SIRA.indexOf(q.katman ?? 'Bölge'));
    // Komşu Bölge Tablosu: Komşu kapsamlı firma yalnız kendi bölgesi veya komşu bölgesindeki dosyada listelenir (dosya bölgesi belirlenemezse listelenir).
    const dBolge = await (await import('./firma.js')).dosyaBolgesi(b.db, id);
    const komsular = dBolge ? new Set((await b.db.query(`SELECT lower(bolge) b FROM komsu_bolge WHERE lower(komsu) = lower($1)`, [dBolge])).rows.map((r) => r.b as string)) : null;
    const katmanOf = (f: { kapsama: string; bolge: string | null }) => f.kapsama === 'Bölge' ? (!f.bolge || konum.includes(String(f.bolge).toLocaleLowerCase('tr')) || (dBolge && f.bolge.toLocaleLowerCase('tr') === dBolge.toLocaleLowerCase('tr')) ? 'Bölge' : null)
      : f.kapsama === 'Komşu' ? (!f.bolge || !dBolge || f.bolge.toLocaleLowerCase('tr') === dBolge.toLocaleLowerCase('tr') || komsular!.has(f.bolge.toLocaleLowerCase('tr')) ? 'Komşu' : null) : f.kapsama;
    const mobiller = new Set((await b.db.query(`SELECT DISTINCT kurulus_ref FROM brans_yetkinligi WHERE kapsama = 'Mobil Ekip' AND durum = 'Aktif'`)).rows.map((r) => r.kurulus_ref as string));
    const l = l0.map((f) => ({ ...f, katman: katmanOf(f) })).filter((f) => f.katman && SIRA.indexOf(f.katman) <= ust && (q.yalnizMobil !== '1' || mobiller.has(f.kimlik)));
    const S = { Kabul: 0, 'Koşullu Kabul': 1, Ret: 2 } as const; const sonuc = [];
    for (const f of l) { const k = await gorevlendirmeKontrolu(b.db, { firma: f.kimlik, dosya: id, brans }); if (q.yalnizUygun === '1' && k.sonuc === 'Ret') continue; sonuc.push({ kimlik: f.kimlik, ticari_unvan: f.ticari_unvan, kapsama: f.kapsama, katman: f.katman, bolgeDisi: f.katman !== 'Bölge', sonuc: k.sonuc, engeller: k.engeller, uyarilar: f.katman !== 'Bölge' ? [...k.uyarilar, 'Bölge dışı: varış süresi ve yol, konaklama maliyeti artabilir.'] : k.uyarilar }); }
    return sonuc.sort((a, c) => SIRA.indexOf(a.katman!) - SIRA.indexOf(c.katman!) || S[a.sonuc] - S[c.sonuc] || a.ticari_unvan.localeCompare(c.ticari_unvan, 'tr'));
  });

  // YG-1070: yat sahibi kendisini gösteren yetkili kayıtlarını görür ve atar. Kaptanda limit girilmezse sıfırdır.
  const sahibim = async (k: string) => (await b.db.query(`SELECT y.kullanici_ref, y.rol, h.ad_soyad, y.belge_durumu, y.ust_limit_eur, y.bitis_tarihi::text, y.yatlar, y.islem_turleri FROM yat_yetkilisi_kaydi y JOIN kullanici_hesabi h ON h.kimlik = y.kullanici_ref JOIN kullanici_hesabi s ON s.cep_telefonu = y.sahip_telefon WHERE s.kimlik = $1 ORDER BY h.ad_soyad`, [k])).rows;
  s.get('/portal/yetkililerim', oturumlu, async (i) => sahibim(i.oturum!.kullanici));
  s.post('/portal/yetkili/:id/atama', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { yatlar?: string[]; islemler?: string[]; limit?: number; bitis?: string; odeme?: boolean; bilgi?: boolean };
    const k = (await sahibim(o.kullanici)).find((x) => x.kullanici_ref === id);
    if (!k) return yok(y);
    if (k.rol !== 'Yatın Kaptanı' && g.limit === undefined) return y.code(400).send({ hata: 'Tek işlem üst limitini girmenizi rica ederiz.' });
    const limit = g.limit === undefined ? 0 : Number(g.limit);
    if (!g.yatlar?.length || !g.islemler?.length || !g.bitis || !(limit >= 0)) return y.code(400).send({ hata: 'Yat, işlem türü ve bitiş tarihini girmenizi rica ederiz.' });
    if (!g.islemler.every((x) => /^ONY-\d{2}$/.test(x))) return y.code(400).send({ hata: 'İşlem türü geçersizdir.' });
    if (g.bitis < new Date().toISOString().slice(0, 10)) return y.code(400).send({ hata: 'Bitiş tarihini bugün veya sonrası olarak seçmenizi rica ederiz.' });
    const h = (await b.db.query(`SELECT ad_soyad, cep_telefonu, e_posta, tercih_dili FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
    await b.db.query(`UPDATE yat_yetkilisi_kaydi SET atama_taslak = $2 WHERE kullanici_ref = $1`, [id, JSON.stringify({ yatlar: g.yatlar, islemler: g.islemler, limit, bitis: g.bitis, odeme: Boolean(g.odeme) && limit > 0, bilgi: Boolean(g.bilgi) })]);
    const dil = dilKod(h.tercih_dili); const lt = tutar(limit, dil);
    const on = await onayTalebiAc(b.db, { ony: 'ONY-14', dil, alanlar: { 'Ad Soyad': h.ad_soyad, 'Full name': h.ad_soyad, '0.000,00': lt, '0,000.00': lt }, baslikAlanlari: { Kişi: k.ad_soyad, Rol: k.rol, Yatlar: g.yatlar.join(', '), 'İşlem Türü': g.islemler.join(', '), 'Bitiş Tarihi': g.bitis }, aliciAd: h.ad_soyad, kullanici: o.kullanici, telefon: h.cep_telefonu, eposta: h.e_posta, nesneTuru: 'Yat Yetkilisi', nesneKimligi: id, hazirlayan: o.kullanici, webAdresi: b.webAdresi, konu: 'Yetkili Temsilci Atama Beyanı' });
    return { kimlik: on.kimlik };
  });

  // YG-1070, D-135: A53 Müşteri ve Paydaş İlişkileri Müdürü Ek-2'yi kaydeder; her değişiklik yeni sürüm, sınır kuruma yansır.
  const mpm = (k: string) => rolVar(k, ['Müşteri ve Paydaş İlişkileri Müdürü']);
  s.get('/kurumsal-kurumlar', oturumlu, async (i, y) => (await mpm(i.oturum!.kullanici)) ? (await b.db.query(`SELECT c.kimlik, c.unvan, c.ek2_onay_siniri, (SELECT max(e.surum) FROM kurumsal_ek2 e WHERE e.kurum_ref = c.kimlik AND e.durum = 'Yürürlükte') surum, EXISTS (SELECT 1 FROM kurumsal_ek2 e WHERE e.kurum_ref = c.kimlik AND e.durum = 'Onay Bekliyor') onayda FROM kurumsal_kurum c ORDER BY c.unvan`)).rows : y.code(403).send({ hata: 'Bu listeyi Müşteri ve Paydaş İlişkileri Müdürü görür.' }));
  s.post('/kurumsal-kurum/:id/ek2', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { satirlar?: Record<string, { ad?: string; iletisim?: string; limit?: number; belge?: string; not?: string }>; dayanak?: string; gunluk?: string; resmi?: string; yatlar?: string[]; islemler?: string[]; bitis?: string; bilgi?: string[] };
    if (!UUID.test(id) || !(await mpm(o.kullanici))) return y.code(403).send({ hata: 'Ek-2’yi Müşteri ve Paydaş İlişkileri Müdürü kaydeder.' });
    const st = g.satirlar ?? {}; const fy = Number(st.fiyat?.limit);
    if (!st.muhatap?.ad?.trim() || !st.fiyat?.ad?.trim() || !(fy >= 0)) return y.code(400).send({ hata: 'Sözleşme muhatabı, fiyat ve ödeme yetkilisi ile üst limiti girmenizi rica ederiz.' });
    if (g.bilgi?.some((x) => !['Sörveyör', 'Broker', 'Lehtar', 'Klas Kuruluşu'].includes(x))) return y.code(400).send({ hata: 'Bilgi paylaşım izni geçersizdir.' });
    const kr = (await b.db.query(`SELECT unvan FROM kurumsal_kurum WHERE kimlik = $1`, [id])).rows[0]; if (!kr) return yok(y);
    if ((await b.db.query(`SELECT 1 FROM kurumsal_ek2 WHERE kurum_ref = $1 AND durum = 'Onay Bekliyor'`, [id])).rowCount) return y.code(409).send({ hata: 'Temsilcinin onayını bekleyen bir sürüm bulunmaktadır.' });
    const tm = (await b.db.query(`SELECT h.kimlik, h.ad_soyad, h.cep_telefonu, h.e_posta, h.tercih_dili FROM kurumsal_kullanici k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.kurum_ref = $1 AND k.yetkili AND h.hesap_durumu = 'Aktif' ORDER BY k.olusturma_zamani LIMIT 1`, [id])).rows[0];
    if (!tm?.cep_telefonu) return y.code(409).send({ hata: 'Ek-2 temsilcinin SMS kodlu onayıyla kabul edilir; kurum yetkilisinin cep telefonu kayıtlı olmalıdır.' });
    // Kaptanda yetki yoksa satır boş, limit sıfır.
    const kp = st.kaptan; const kaptan = kp?.ad?.trim() && Number(kp.limit) > 0 ? { ad: kp.ad.trim(), iletisim: kp.iletisim?.trim(), limit: Number(kp.limit) } : undefined;
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const n = Number((await c.query(`SELECT coalesce(max(surum), 0) + 1 n FROM kurumsal_ek2 WHERE kurum_ref = $1`, [id])).rows[0].n);
      const e2 = (await c.query(`INSERT INTO kurumsal_ek2 (kurum_ref, surum, satirlar, dayanak, gunluk_kanal, resmi_kanal, yatlar, islem_turleri, bitis, bilgi_izni, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`, [id, n, JSON.stringify({ ...st, kaptan }), g.dayanak?.trim() || null, g.gunluk?.trim() || null, g.resmi?.trim() || null, g.yatlar ?? [], g.islemler ?? [], g.bitis || null, g.bilgi ?? [], o.kullanici])).rows[0];
      const dl = dilKod(tm.tercih_dili); const ks = (x?: { ad?: string; limit?: number }) => (x?.ad ? `${x.ad}${x.limit !== undefined && x.limit !== null ? ` · ${tutar(Number(x.limit), dl)} EUR` : ''}` : '---');
      const on = await onayTalebiAc(c, { ony: 'ONY-15', dil: dl, alanlar: { Şirket: kr.unvan, Company: kr.unvan }, baslikAlanlari: { 'Müşteri Sözleşme Muhatabı': ks(st.muhatap), 'Teknik Kapsam Onayı': ks(st.kapsam), 'Fiyat ve Ödeme Onayı': ks(st.fiyat), 'Yat Teslim/İade Yetkilisi': ks(st.teslim), 'Yatın Kaptanı / Yat Yetkilisi': ks(kaptan), Yatlar: (g.yatlar ?? []).join(', ') || '---', 'Bitiş Tarihi': g.bitis || '---', Sürüm: String(n) }, aliciAd: tm.ad_soyad, kullanici: tm.kimlik, telefon: tm.cep_telefonu, eposta: tm.e_posta, nesneTuru: 'Kurumsal Ek-2', nesneKimligi: e2.kimlik, hazirlayan: o.kullanici, webAdresi: b.webAdresi, konu: `${kr.unvan} Ek-2` });
      await c.query(`UPDATE kurumsal_ek2 SET onay_ref = $2 WHERE kimlik = $1`, [e2.kimlik, on.kimlik]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurumsal Ek-2 Sürümü', nesneTuru: 'Kurumsal Kurum', nesneKimligi: id, yeni: { surum: n, sinir: fy }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { surum: n, durum: 'Onay Bekliyor' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.get('/kurumsal-kurum/:id/ek2.pdf', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const dil = ((i.query ?? {}) as { dil?: string }).dil === 'en' ? 'en' : 'tr';
    if (!UUID.test(id)) return yok(y);
    const benim = (await b.db.query(`SELECT 1 FROM kurumsal_kullanici WHERE kullanici_ref = $1 AND kurum_ref = $2 AND yetkili`, [o.kullanici, id])).rowCount;
    if (!benim && !(await mpm(o.kullanici))) return yok(y);
    const v = await ek2Tanim(b.db, id, dil); if (!v) return yok(y);
    const { pdfUret } = await import('./pdf.js');
    return y.type('application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(v.dosyaAdi)}"`).send(await pdfUret(v.t));
  });

  // YG-990: gözetim raporu İç Denetim, Hukuk ve Uyum, GMY ve CEO'ya açıktır.
  s.get('/rapor/gorev-ayriligi', oturumlu, async (i, y) => (await rolVar(i.oturum!.kullanici, ['İç Denetim Müdürü', 'İç Denetçi', HUD, 'Genel Müdür Yardımcısı', 'CEO'])) ? gorevAyriligiRaporu(b.db) : yok(y));

  // YG-411: sahada onaysız alt yüklenici tespiti; kayıt, Firma Yönetimi Müdürü ve Operasyon Müdürüne görev.
  s.post('/is-emri/:id/alt-yuklenici-tespit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; aciklama?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT kimlik, dosya_ref, is_emri_no FROM is_emri WHERE kimlik = $1`, [id])).rows[0];
    if (!e || !(await dosyaErisimi(b.db, o.kullanici, e.dosya_ref))) return yok(y);
    if (!g.ad?.trim()) return y.code(400).send({ hata: 'Sahada görülen alt yüklenicinin adını yazmanızı rica ederiz.' });
    const engel = await altYukleniciEngeli(b.db, id, [g.ad]);
    if (!engel) return { onayli: true };
    for (const rol of ['Firma Yönetimi Müdürü', 'Operasyon Müdürü']) await kartAc(b.db, { tur: 'Onaysız Alt Yüklenici', kategori: 'gorev', baslik: `${e.is_emri_no} · Onaysız Alt Yüklenici`, ozet: `${g.ad.trim()}${g.aciklama?.trim() ? ` · ${g.aciklama.trim()}` : ''}`, sahipRol: await rolId(b.db, rol), nesneTuru: 'İş Emri', nesneKimligi: e.kimlik });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Onaysız Alt Yüklenici Tespiti', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, yeni: { ad: g.ad.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { onayli: false };
  });

  // YG-533: firma ekipmanı; Sicil Sorumlusu, Firma Yönetimi Müdürü veya firmanın kendi kullanıcısı girer. Süresi geçen kullanılamaz görünür.
  const ekipmanci = async (k: string, firma: string) => (await rolVar(k, ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü'])) || Boolean((await b.db.query(`SELECT 1 FROM kurulus_kullanici WHERE kullanici_ref = $1 AND kurulus_ref = $2`, [k, firma])).rowCount);
  s.get('/firma/:id/ekipman', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await ekipmanci(i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT kimlik, ad, seri_no, bakim_bitis::text, kalibrasyon_bitis::text, (kullanilabilir AND coalesce(least(bakim_bitis, kalibrasyon_bitis), coalesce(bakim_bitis, kalibrasyon_bitis), current_date) >= current_date) kullanilabilir FROM firma_ekipmani WHERE kurulus_ref = $1 ORDER BY ad`, [id])).rows;
  });
  s.post('/firma/:id/ekipman', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; seri?: string; bakim?: string; kalibrasyon?: string };
    if (!UUID.test(id) || !(await ekipmanci(o.kullanici, id))) return yok(y);
    const tarih = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
    if (!g.ad?.trim() || !g.seri?.trim() || (!tarih(g.bakim) && !tarih(g.kalibrasyon))) return y.code(400).send({ hata: 'Ekipman adı, seri no ve bakım veya kalibrasyon geçerlilik tarihini girmenizi rica ederiz.' });
    const r = await b.db.query(`INSERT INTO firma_ekipmani (kurulus_ref, ad, seri_no, bakim_bitis, kalibrasyon_bitis, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kurulus_ref, seri_no) DO UPDATE SET ad = EXCLUDED.ad, bakim_bitis = EXCLUDED.bakim_bitis, kalibrasyon_bitis = EXCLUDED.kalibrasyon_bitis, kullanilabilir = true, kaydeden_ref = EXCLUDED.kaydeden_ref, zaman = now() RETURNING kimlik`, [id, g.ad.trim(), g.seri.trim(), tarih(g.bakim), tarih(g.kalibrasyon), o.kullanici]);
    return { kimlik: r.rows[0].kimlik };
  });

  // YG-532: LGM'nin kurumsal belgeleri; yenilenen belge eskisini "Yenilendi" yapar.
  const KB_TUR = ['LGM Sigorta Poliçesi', 'İmza Sirküleri', 'Broker Yetki Belgesi', 'Acente Yetki Belgesi'];
  const kbci = (k: string) => rolVar(k, ['CEO', 'Genel Müdür Yardımcısı', HUD, TID, MFM, 'Sicil Sorumlusu']);
  s.get('/kurum-belgesi', oturumlu, async (i, y) => (await kbci(i.oturum!.kullanici)) ? (await b.db.query(`SELECT kimlik, tur, ad, karsi_taraf, bitis::text, durum FROM kurum_belgesi ORDER BY durum, bitis`)).rows : yok(y));
  s.post('/kurum-belgesi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; ad?: string; karsiTaraf?: string; bitis?: string; belge?: string; yenilenen?: string };
    if (!(await kbci(o.kullanici))) return yok(y);
    if (!KB_TUR.includes(g.tur ?? '') || !g.ad?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(g.bitis ?? '')) return y.code(400).send({ hata: 'Tür, belge adı ve bitiş tarihini girmenizi rica ederiz.' });
    const r = (await b.db.query(`INSERT INTO kurum_belgesi (tur, ad, karsi_taraf, bitis, belge_ref, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [g.tur, g.ad.trim(), g.karsiTaraf?.trim() || null, g.bitis, g.belge && UUID.test(g.belge) ? g.belge : null, o.kullanici])).rows[0];
    if (g.yenilenen && UUID.test(g.yenilenen)) await b.db.query(`UPDATE kurum_belgesi SET durum = 'Yenilendi' WHERE kimlik = $1 AND durum = 'Geçerli'`, [g.yenilenen]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurumsal Belge Kaydı', nesneTuru: 'Kurumsal Belge', nesneKimligi: r.kimlik, yeni: { tur: g.tur, bitis: g.bitis }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return r;
  });

  // YG-1472: resmî tatil ve arife takvimi; yıllık parametre, CEO veya GMY girer.
  s.get('/takvim', oturumlu, async (i, y) => i.oturum!.grup === 'LGM İç Rolü' ? (await b.db.query(`SELECT tarih::text, ad, yarim_gun FROM resmi_tatil WHERE tarih >= current_date - 31 ORDER BY tarih`)).rows : yok(y));
  s.post('/takvim', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tarih?: string; ad?: string; arife?: boolean; sil?: boolean };
    if (!(await rolVar(o.kullanici, ['CEO', 'Genel Müdür Yardımcısı']))) return yok(y);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.tarih ?? '')) return y.code(400).send({ hata: 'Tarihi girmenizi rica ederiz.' });
    if (g.sil) await b.db.query(`DELETE FROM resmi_tatil WHERE tarih = $1`, [g.tarih]);
    else { if (!g.ad?.trim()) return y.code(400).send({ hata: 'Tatil adını yazmanızı rica ederiz.' }); await b.db.query(`INSERT INTO resmi_tatil (tarih, ad, yarim_gun, giren_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (tarih) DO UPDATE SET ad = EXCLUDED.ad, yarim_gun = EXCLUDED.yarim_gun, giren_ref = EXCLUDED.giren_ref, zaman = now()`, [g.tarih, g.ad.trim(), Boolean(g.arife), o.kullanici]); }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: g.sil ? 'Tatil Silindi' : 'Tatil Kaydedildi', nesneTuru: 'Takvim', nesneKimligi: g.tarih!, yeni: { ad: g.ad, arife: Boolean(g.arife) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-1078: dışa aktarım; görüntüleme gibi iz kaydına girer.
  s.get('/rapor/yasal-ayip.csv', oturumlu, async (i, y) => {
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND (x.rol_adi LIKE '%Direktörü' OR x.rol_adi IN ('Genel Müdür Yardımcısı', 'CEO')) LIMIT 1`, [i.oturum!.kullanici])).rowCount) return yok(y);
    const ayip = (await b.db.query(`SELECT d.dosya_no, g.kayit_no, g.statu, coalesce(g.karar, '') karar, g.olusturma_zamani::date::text tarih FROM garanti_sikayet g JOIN dosya d ON d.kimlik = g.dosya_ref WHERE EXISTS (SELECT 1 FROM unnest(g.kayit_turu) x WHERE x ILIKE '%ayıp%') ORDER BY g.olusturma_zamani`)).rows;
    const rucu = (await b.db.query(`SELECT d.dosya_no, u.ticari_unvan, m.tur, m.tutar_eur, m.kalan_eur, m.statu, m.olusturma_zamani::date::text tarih FROM hakedis_mahsubu m JOIN dosya d ON d.kimlik = m.dosya_ref JOIN kurulus u ON u.kimlik = m.kurulus_ref ORDER BY m.olusturma_zamani`)).rows;
    const h = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`; const s2 = (n: unknown) => Number(n).toFixed(2).replace('.', ',');
    const satir = ['Kayıt;Dosya No;Kayıt No / Firma;Tür / Durum;Tutar (EUR);Kalan (EUR);Tarih', ...ayip.map((a) => ['Yasal Ayıp', a.dosya_no, a.kayit_no, `${a.statu}${a.karar ? ` / ${a.karar}` : ''}`, '', '', a.tarih].map(h).join(';')), ...rucu.map((r) => ['Rücu / Mahsup', r.dosya_no, r.ticari_unvan, `${r.tur} / ${r.statu}`, s2(r.tutar_eur), s2(r.kalan_eur), r.tarih].map(h).join(';'))];
    await izYaz(b.db, { aktor: i.oturum!.kullanici, oturum: i.oturum!.oturum, eylem: 'Yasal Ayıp Raporu Dışa Aktarıldı', nesneTuru: 'Rapor', nesneKimligi: 'yasal-ayip', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return y.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="yasal-ayip-rucu.csv"').send('\uFEFF' + satir.join('\r\n'));
  });

  // YG-1299: Sağlayıcı ve Sözleşme Matrisi; yurt dışında KVKK m.9 dayanağı ve maskeleme kuralı zorunlu.
  const matrisci = (k: string) => rolVar(k, ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü', HUD, 'Bilgi İşlem Müdürü']);
  // YG-1145: kayıt tamamlanıp dış gönderim (e-posta, SMS, WhatsApp) beklerse ya da başarısız olursa parçalar ayrı durumla görünür; hedef maskelenir.
  s.get('/dosya/:id/gonderimler', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const k = (await b.db.query(`SELECT $1::text AS k UNION SELECT talep_ref::text FROM dosya WHERE kimlik = $1::uuid AND talep_ref IS NOT NULL
      UNION SELECT kimlik::text FROM fiyat_teklifi WHERE dosya_ref = $1::uuid UNION SELECT kimlik::text FROM onay_talebi WHERE dosya_ref = $1::uuid UNION SELECT kimlik::text FROM is_emri WHERE dosya_ref = $1::uuid
      UNION SELECT kimlik::text FROM teslim_kaydi WHERE dosya_ref = $1::uuid UNION SELECT kimlik::text FROM musteri_faturasi WHERE dosya_ref = $1::uuid UNION SELECT kimlik::text FROM tesis_talebi WHERE dosya_ref = $1::uuid`, [id])).rows.map((r) => r.k as string).filter(Boolean);
    const r = (await b.db.query(`SELECT kanal, konu, hedef, durum, deneme, plan_zamani, gonderim_zamani FROM gonderim WHERE olay_anahtari ~ $1 ORDER BY olusturma_zamani DESC LIMIT 200`, [`(${k.join('|')})`])).rows;
    const maske = (h: string) => h.includes('@') ? h.replace(/^(.).*(@.*)$/, '$1***$2') : h.replace(/.(?=.{3})/g, '*');
    const parca = (d: string) => (d === 'Bekliyor' ? 'Bekliyor' : d === 'Başarısız' ? 'Başarısız' : 'Tamamlandı');
    const satirlar = r.map((x) => ({ kanal: x.kanal, konu: x.konu, hedef: maske(x.hedef), durum: x.durum, parca: parca(x.durum), deneme: x.deneme, plan: x.plan_zamani, gonderim: x.gonderim_zamani }));
    // YG-1308: dosyanın neden beklediği (karantinadaki entegrasyon kaydı) görünür.
    const entegrasyonBeklemeleri = (await b.db.query(`SELECT e.ad, k.beklenen_sonuc, k.hata, k.olusturma_zamani FROM entegrasyon_kaydi k JOIN entegrasyon_tanimi e ON e.kimlik = k.entegrasyon_ref WHERE k.dosya_ref = $1::uuid AND k.durum = 'Karantina' ORDER BY k.olusturma_zamani`, [id])).rows;
    return { ozet: { tamamlandi: satirlar.filter((x) => x.parca === 'Tamamlandı').length, bekliyor: satirlar.filter((x) => x.parca === 'Bekliyor').length, basarisiz: satirlar.filter((x) => x.parca === 'Başarısız').length }, satirlar, entegrasyonBeklemeleri };
  });

  // YG-995: dosya bazlı süreli ek erişim; dosya ekibi talep eder, Operasyon Müdürü onaylar; geniş rol verilmez.
  s.get('/dosya/:id/ek-yetki', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT e.kimlik, h.ad_soyad, e.gerekce, e.bitis, CASE WHEN e.durum = 'Aktif' AND e.bitis <= now() THEN 'Süresi Doldu' ELSE e.durum END durum FROM dosya_ek_yetki e JOIN kullanici_hesabi h ON h.kimlik = e.kullanici_ref WHERE e.dosya_ref = $1 ORDER BY e.olusturma_zamani DESC`, [id])).rows;
  });
  s.post('/dosya/:id/ek-yetki', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kullanici?: string; gerekce?: string; bitis?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const bitis = g.bitis ? new Date(g.bitis) : null;
    if (!g.kullanici || !g.gerekce?.trim() || !bitis || Number.isNaN(bitis.getTime()) || bitis <= new Date()) return y.code(400).send({ hata: 'Kullanıcı, gerekçe ve ileri bir bitiş zamanı zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif'`, [g.kullanici])).rowCount) return y.code(400).send({ hata: 'Ek erişim yalnız aktif LGM personeline verilir.' });
    const r = (await b.db.query(`INSERT INTO dosya_ek_yetki (dosya_ref, kullanici_ref, gerekce, bitis, talep_eden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, g.kullanici, g.gerekce.trim(), bitis, o.kullanici])).rows[0].kimlik;
    const no = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0].dosya_no;
    await kartAc(b.db, { tur: 'Dosya Ek Erişim Onayı', baslik: `${no} · Süreli Ek Erişim`, ozet: g.gerekce.trim().slice(0, 200), hazirlayan: o.kullanici, ayrik: [g.kullanici], zincir: [(await b.db.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Operasyon Müdürü'`)).rows[0].kimlik], nesneTuru: 'Dosya Ek Yetki', nesneKimligi: r });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Dosya Ek Erişim Talebi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { kullanici: g.kullanici, bitis }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r };
  });

  // YG-1071: tarafın dosyadaki işlevsel görevleri dayanak ve sınırla; dosya ekibi kaydeder, görev gerekçeyle sonlandırılır.
  const GOREVLER = ['Talebi İleten', 'Teknik Muhatap', 'Sözleşme İmzalayan', 'Kapsam Onaylayan', 'Mali Taahhüt Veren', 'Ödeme Yapan', 'Yatı Teslim Alan'];
  s.get('/dosya/:id/taraf-gorevleri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return { gorevler: GOREVLER, taraflar: (await b.db.query(`SELECT kimlik, taraf_rolu, kisi_adi_soyadi FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif ORDER BY taraf_rolu`, [id])).rows,
      kayitlar: (await b.db.query(`SELECT g.kimlik, g.gorev, g.dayanak, g.sinir, t.kisi_adi_soyadi, t.taraf_rolu FROM dosya_taraf_gorevi g JOIN dosya_tarafi t ON t.kimlik = g.dosya_tarafi_ref WHERE t.dosya_ref = $1 AND g.aktif ORDER BY g.gorev`, [id])).rows };
  });
  s.post('/dosya/:id/taraf-gorevi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { taraf?: string; gorev?: string; dayanak?: string; sinir?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g.taraf || !UUID.test(g.taraf) || !GOREVLER.includes(g.gorev ?? '') || !g.dayanak?.trim()) return y.code(400).send({ hata: 'Taraf, görev ve yetki dayanağı zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM dosya_tarafi WHERE kimlik = $1 AND dosya_ref = $2 AND aktif`, [g.taraf, id])).rowCount) return y.code(400).send({ hata: 'Taraf bu dosyaya ait değildir.' });
    const r = await b.db.query(`INSERT INTO dosya_taraf_gorevi (dosya_tarafi_ref, gorev, dayanak, sinir, kaydeden_ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING kimlik`, [g.taraf, g.gorev, g.dayanak.trim(), g.sinir?.trim() || null, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu görev tarafa zaten kayıtlıdır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Taraf Görevi Kaydedildi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { gorev: g.gorev, dayanak: g.dayanak.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.rows[0].kimlik };
  });
  s.post('/taraf-gorevi/:id/sonlandir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gerekce?: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü') return yok(y);
    const d = (await b.db.query(`SELECT t.dosya_ref FROM dosya_taraf_gorevi g JOIN dosya_tarafi t ON t.kimlik = g.dosya_tarafi_ref WHERE g.kimlik = $1 AND g.aktif`, [id])).rows[0];
    if (!d || !(await dosyaErisimi(b.db, o.kullanici, d.dosya_ref))) return yok(y);
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    await b.db.query(`UPDATE dosya_taraf_gorevi SET aktif = false WHERE kimlik = $1`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Taraf Görevi Sonlandırıldı', nesneTuru: 'Dosya', nesneKimligi: d.dosya_ref, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-539: tek görünüm. Açık iş, sahibi ve hedefi; bekleyen onayın makamı ve o makamdaki kişiler; durma nedeni (beklemede işareti,
  // entegrasyon karantinası); eksik yat bilgisi ve zorunlu form; engelleyen işler bağımlılık olarak; sonraki işlem ilk engel, yoksa en yakın hedefli iştir.
  s.get('/dosya/:id/durum-ozeti', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT kimlik, statu, asama, oncelik, dosya_niteligi, yat_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0]; if (!d) return yok(y);
    const { yapilacaklar, yatEksikleri } = await import('./dosya.js'); const { zorunluFormlar } = await import('./zorunlu_form.js');
    const isler = await yapilacaklar(b.db, d);
    const onaylar = (await b.db.query(`SELECT k.baslik, r.rol_adi makam, k.son_zaman, (SELECT string_agg(h.ad_soyad, ', ') FROM rol_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.rol_ref = r.kimlik AND a.atama_durumu = 'Aktif') kimde
      FROM is_karti k JOIN rol r ON r.kimlik = k.zincir[k.kademe + 1] WHERE k.durum = 'Bekliyor' AND k.kategori = 'onay' AND (k.nesne_kimligi = $1::text
        OR k.nesne_kimligi IN (SELECT kimlik::text FROM fiyat_teklifi WHERE dosya_ref = $1::uuid UNION SELECT kimlik::text FROM is_emri WHERE dosya_ref = $1::uuid UNION SELECT kimlik::text FROM hakedis WHERE dosya_ref = $1::uuid))
      ORDER BY k.son_zaman NULLS LAST`, [id])).rows;
    const durma = [
      ...(await b.db.query(`SELECT 'Beklemede: ' || neden || coalesce(' (hedef ' || to_char(hedef_tarih, 'DD.MM.YYYY') || ')', '') n FROM beklemede_isareti WHERE dosya_ref = $1 AND kaldirilma_zamani IS NULL`, [id])).rows.map((r) => r.n as string),
      ...(await b.db.query(`SELECT 'Entegrasyon bekleniyor: ' || e.ad || ' · ' || k.beklenen_sonuc n FROM entegrasyon_kaydi k JOIN entegrasyon_tanimi e ON e.kimlik = k.entegrasyon_ref WHERE k.dosya_ref = $1 AND k.durum = 'Karantina'`, [id])).rows.map((r) => r.n as string),
      ...(await b.db.query(`SELECT 'Açık konu: ' || konu_no || ' · ' || baslik n FROM acik_konu WHERE dosya_ref = $1 AND statu IN ('Açık', 'İşlemde') AND hedef_tarih < current_date`, [id])).rows.map((r) => r.n as string),
    ];
    const eksik = [...(d.yat_ref ? (await yatEksikleri(b.db, d.yat_ref)).map((x) => `Yat bilgisi: ${x}`) : []), ...(await zorunluFormlar(b.db, id)).filter((f) => !f.var && !f.istisna).map((f) => `Form: ${f.kod} ${f.ad}`)];
    const bagimliliklar = isler.filter((x) => x.engel).map((x) => x.is);
    const sirali = [...isler].sort((a, c) => Number(Boolean(c.engel)) - Number(Boolean(a.engel)) || (a.hedef ?? '9').localeCompare(c.hedef ?? '9'));
    const sonraki = sirali[0] ?? (onaylar[0] ? { is: `Onay: ${onaylar[0].baslik}`, sorumlu: onaylar[0].makam, hedef: onaylar[0].son_zaman } : null);
    return { isler, onaylar, durma, eksik, bagimliliklar, sonraki };
  });

  // YG-1660: Firma Kapsama Raporu ve aday raporu ekranda da görülür.
  s.get('/rapor/firma-kapsama', oturumlu, async (i, y) => {
    const aday = (i.query as { aday?: string }).aday === '1';
    if (!(await rolVar(i.oturum!.kullanici, ['CEO', 'Genel Müdür Yardımcısı', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Firma Yönetimi Müdürü']))) return yok(y);
    const { firmaKapsamaRaporu } = await import('./firma_ek.js');
    return firmaKapsamaRaporu(b.db, aday);
  });
  s.get('/saglayici-matrisi', oturumlu, async (i, y) => (await matrisci(i.oturum!.kullanici)) ? (await b.db.query(`SELECT kimlik, baglanti, saglayici, veri_yeri, ulke, erisim_yontemi, ucret, hizmet_seviyesi, yedek_saglayici, kvkk_sozlesmesi, m9_dayanak, maskeleme_kurali, kurul_bildirim_tarihi::text, durum FROM saglayici_matrisi ORDER BY baglanti, saglayici`)).rows : yok(y));
  s.post('/saglayici-matrisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { baglanti?: string; saglayici?: string; veriYeri?: string; ulke?: string; erisim?: string; ucret?: string; seviye?: string; yedek?: string; kvkk?: boolean; m9?: string; maskeleme?: string; kurulBildirim?: string; belge?: string };
    if (!(await matrisci(o.kullanici))) return yok(y);
    if (!g.baglanti?.trim() || !g.saglayici?.trim() || !g.erisim?.trim() || !['Türkiye', 'Yurt Dışı'].includes(g.veriYeri ?? '')) return y.code(400).send({ hata: 'Bağlantı, sağlayıcı, veri yeri ve erişim yöntemini girmenizi rica ederiz.' });
    if (g.veriYeri === 'Yurt Dışı' && (!g.ulke?.trim() || !g.m9?.trim() || !g.maskeleme?.trim())) return y.code(400).send({ hata: 'Yurt dışı bağlantıda ülke, KVKK m.9 dayanağı ve maskeleme kuralı zorunludur.' });
    if (g.m9 && /standart sözleşme/i.test(g.m9) && !g.kurulBildirim) return y.code(400).send({ hata: 'Standart sözleşmede Kurula bildirim tarihini girmenizi rica ederiz (imzadan itibaren beş iş günü).' });
    const r = (await b.db.query(`INSERT INTO saglayici_matrisi (baglanti, saglayici, veri_yeri, ulke, erisim_yontemi, ucret, hizmet_seviyesi, yedek_saglayici, kvkk_sozlesmesi, m9_dayanak, maskeleme_kurali, kurul_bildirim_tarihi, sozlesme_belge_ref, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING kimlik`, [g.baglanti.trim(), g.saglayici.trim(), g.veriYeri, g.ulke?.trim() || null, g.erisim.trim(), g.ucret?.trim() || null, g.seviye?.trim() || null, g.yedek?.trim() || null, Boolean(g.kvkk), g.m9?.trim() || null, g.maskeleme?.trim() || null, g.kurulBildirim || null, g.belge && UUID.test(g.belge) ? g.belge : null, o.kullanici])).rows[0];
    if (!g.kvkk) await kartAc(b.db, { tur: 'KVKK Veri İşleyen Sözleşmesi', kategori: 'gorev', baslik: `${g.saglayici.trim()} · Veri İşleyen Sözleşmesi Bekleniyor`, ozet: g.baglanti.trim(), sahipRol: await rolId(b.db, HUD), nesneTuru: 'Sağlayıcı', nesneKimligi: r.kimlik });
    return r;
  });

  // YG-826: mali parametreler. Tanımsız değer işlemi bir üst onaya gönderir; fiyat katsayısı bu ekranda hiç görünmez (K-104).
  const parametreci = (k: string) => rolVar(k, [TID, 'Teknik ve Operasyon Direktörü', 'Genel Müdür Yardımcısı', 'CEO']);
  // YG-1024: Ticari Sorumlu (ve ticari yöneticiler) dosyanın teklif, iş emri, hakediş, fatura ve teknik rapor özetini tek yerde görür.
  s.get('/dosya/:id/ticari-ozet', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id) || !(await rolVar(o.kullanici, ['Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', 'Muhasebe ve Finans Müdürü', 'Muhasebe ve Finans Müdür Yardımcısı', TID]))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    const q = async (sql: string) => (await b.db.query(sql, [id])).rows;
    return {
      teklifler: await q(`SELECT teklif_no, surum_no, teklif_turu, statu, genel_toplam_eur FROM fiyat_teklifi WHERE dosya_ref = $1 ORDER BY teklif_no, surum_no`),
      isEmirleri: await q(`SELECT is_emri_no, is_emri_turu, statu FROM is_emri WHERE dosya_ref = $1 ORDER BY is_emri_no`),
      hakedisler: await q(`SELECT hakedis_no, statu, bu_donem_brut, kesinti, net FROM hakedis WHERE dosya_ref = $1 ORDER BY hakedis_no`),
      faturalar: await q(`SELECT proforma_no, fatura_no, fatura_tarihi::text AS fatura_tarihi, durum, muhatap, toplam_eur FROM musteri_faturasi WHERE dosya_ref = $1 ORDER BY proforma_no`),
      teknikRaporlar: await q(`SELECT rapor_no, rapor_turu, surum, durum FROM teknik_rapor WHERE dosya_ref = $1 ORDER BY rapor_no, surum`),
    };
  });

  // YG-1039: hizmet süresi ve performans parametrelerini T&O Direktörü, mali ve fiyat parametrelerini Ticari İşler Direktörü önerir.
  const HIZMET_PARAMETRESI = /^(rapor_sure_saat_|onay_sure_dk_|tedarik_|acil_cagri_dk|nobet_donus_dk|onarim_sure_tamponu|kis_|hizmet_)/;
  // YG-1601: dosyaya ait giden yazışmaların kopyası (ticari koldan gidenler dahil); yalnız dosyaya erişimi olan LGM personeli.
  s.get('/dosya/:id/yazismalar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !/^[0-9a-f-]{36}$/.test(id) || !(await (await import('./dosya.js')).dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT kimlik, kanal, hedef, konu, durum, olusturma_zamani, gonderim_zamani FROM gonderim WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 200`, [id])).rows;
  });
  // YG-1017: unvan–rol eşleşmesi (LGM personeli).
  s.get('/unvan-rol', oturumlu, async (i, y) => i.oturum!.grup !== 'LGM İç Rolü' ? yok(y) : (await b.db.query(`SELECT rol_ref, rol_adi, unvan, kademe, birim FROM unvan_rol_eslesmesi ORDER BY birim, rol_adi`)).rows);
  // YG-1367: katalogda sahip (öneren rol, YG-853) ve onaylayan (GMY uygun görüşüyle CEO) ile yürürlük tarihi ve son değişiklik gösterilir.
  s.get('/parametreler', oturumlu, async (i, y) => (await parametreci(i.oturum!.kullanici)) ? (await b.db.query(`SELECT p.kod, p.deger, p.aciklama, to_char(p.gecerlilik, 'DD.MM.YYYY') yururluk,
      (SELECT to_char(g.zaman AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY') FROM parametre_gecmisi g WHERE g.kod = p.kod ORDER BY g.zaman DESC LIMIT 1) son_degisiklik
    FROM sistem_parametresi p WHERE p.kod NOT IN ('fiyat_katsayisi', 'ara_kademesiz_donem') ORDER BY p.kod`)).rows.map((r) => ({ ...r, sahip: HIZMET_PARAMETRESI.test(r.kod) ? 'Teknik ve Operasyon Direktörü' : TID, onaylayan: 'Genel Müdür Yardımcısı uygun görüşüyle CEO' })) : yok(y));
  // YG-176 (KS-8): Ara Kademesiz Dönemi yalnız CEO açar ve kapatır; her değişiklik gerekçeyle geçmişe yazılır.
  s.get('/ara-kademesiz-donem', oturumlu, async (i, y) => {
    if (!(await parametreci(i.oturum!.kullanici))) return yok(y);
    return { acik: Number((await b.db.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'ara_kademesiz_donem'`)).rows[0]?.deger ?? 0) === 1, ceo: await rolVar(i.oturum!.kullanici, ['CEO']) };
  });
  s.post('/ara-kademesiz-donem', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { acik?: boolean; gerekce?: string };
    if (!(await rolVar(o.kullanici, ['CEO']))) return y.code(403).send({ hata: 'Ara Kademesiz Dönemi yalnız CEO açar ve kapatır.' });
    if (typeof g.acik !== 'boolean' || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Durum ve gerekçe zorunludur.' });
    const eski = Number((await b.db.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'ara_kademesiz_donem'`)).rows[0]?.deger ?? 0);
    await b.db.query(`UPDATE sistem_parametresi SET deger = $1, gecerlilik = current_date WHERE kod = 'ara_kademesiz_donem'`, [g.acik ? 1 : 0]);
    await b.db.query(`INSERT INTO parametre_gecmisi (kod, eski, yeni, gerekce, giren_ref) VALUES ('ara_kademesiz_donem',$1,$2,$3,$4)`, [eski, g.acik ? 1 : 0, g.gerekce.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: g.acik ? 'Ara Kademesiz Dönem Açıldı' : 'Ara Kademesiz Dönem Kapatıldı', nesneTuru: 'Parametre', nesneKimligi: 'ara_kademesiz_donem', gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { acik: g.acik };
  });
  s.post('/parametre/:kod', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string }; const g = (i.body ?? {}) as { deger?: number | null; gerekce?: string };
    if (!(await parametreci(o.kullanici))) return yok(y);
    if (kod === 'fiyat_katsayisi' || kod === 'ara_kademesiz_donem') return yok(y);
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Değişiklik gerekçesini yazmanızı rica ederiz.' });
    if (g.deger !== null && g.deger !== undefined && !(Number(g.deger) >= 0)) return y.code(400).send({ hata: 'Değer geçersizdir.' });
    const e = (await b.db.query(`SELECT deger, aciklama FROM sistem_parametresi WHERE kod = $1`, [kod])).rows[0]; if (!e) return yok(y);
    const yeni = g.deger === null || g.deger === undefined ? null : Number(g.deger);
    // YG-853: değişikliği Ticari İşler Direktörü önerir; Genel Müdür Yardımcısı uygun görüşle (Onaya Gönder) CEO'ya arz eder, CEO onaylayınca yürürlüğe girer.
    const oneren = HIZMET_PARAMETRESI.test(kod) ? 'Teknik ve Operasyon Direktörü' : TID;
    if (!(await rolVar(o.kullanici, [oneren]))) return y.code(403).send({ hata: `Bu parametre değişikliğini ${oneren} önerir; Genel Müdür Yardımcısı ve CEO onay kartından karar verir.` });
    if ((await b.db.query(`SELECT 1 FROM parametre_onerisi WHERE kod = $1 AND durum = 'Onayda'`, [kod])).rowCount) return y.code(409).send({ hata: 'Bu parametre için onayda bekleyen öneri vardır.' });
    const on = (await b.db.query(`INSERT INTO parametre_onerisi (kod, eski, yeni, gerekce, oneren_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [kod, e.deger, yeni, g.gerekce.trim(), o.kullanici])).rows[0];
    await kartAc(b.db, { tur: 'Parametre Değişikliği', baslik: `${e.aciklama ?? kod}: ${e.deger ?? 'Tanımsız'} → ${yeni ?? 'Tanımsız'}`, ozet: g.gerekce.trim(), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Genel Müdür Yardımcısı'), await rolId(b.db, 'CEO')], nesneTuru: 'Parametre Önerisi', nesneKimligi: on.kimlik });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Parametre Değişikliği Önerisi', nesneTuru: 'Parametre', nesneKimligi: kod, eski: { deger: e.deger }, yeni: { deger: yeni }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Onaya Gönderildi', oneri: on.kimlik };
  });

  // YG-1078: yasal ayıp ve rücu listesi yalnız Direktör ve üstü; Müdürler göremez.
  s.get('/rapor/yasal-ayip', oturumlu, async (i, y) => {
    const r = (await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND (x.rol_adi LIKE '%Direktörü' OR x.rol_adi IN ('Genel Müdür Yardımcısı', 'CEO')) LIMIT 1`, [i.oturum!.kullanici])).rowCount;
    if (!r) return yok(y);
    const ayip = (await b.db.query(`SELECT g.kayit_no, d.dosya_no, g.kayit_turu, g.statu, g.karar, g.olusturma_zamani::date::text tarih FROM garanti_sikayet g JOIN dosya d ON d.kimlik = g.dosya_ref WHERE EXISTS (SELECT 1 FROM unnest(g.kayit_turu) x WHERE x ILIKE '%ayıp%') ORDER BY g.olusturma_zamani DESC LIMIT 500`)).rows;
    const rucu = (await b.db.query(`SELECT d.dosya_no, u.ticari_unvan, m.tur, m.tutar_eur, m.kalan_eur, m.statu, m.olusturma_zamani::date::text tarih FROM hakedis_mahsubu m JOIN dosya d ON d.kimlik = m.dosya_ref JOIN kurulus u ON u.kimlik = m.kurulus_ref ORDER BY m.olusturma_zamani DESC LIMIT 500`)).rows;
    await izYaz(b.db, { aktor: i.oturum!.kullanici, oturum: i.oturum!.oturum, eylem: 'Yasal Ayıp Raporu', nesneTuru: 'Rapor', nesneKimligi: 'yasal-ayip', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { ayip, rucu };
  });

  // YG-344: FR-SCL-001 ön kayıt alanları.
  s.post('/firma/:id/on-kayit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { mersis?: string; mahalle?: string; konumTuru?: string; baglamaNoktasi?: string; yetkili?: string; taliBranslar?: string[]; bolgeler?: string[]; calisan?: number; referanslar?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı']))) return yok(y);
    if (g.mersis && !/^\d{16}$/.test(g.mersis)) return y.code(400).send({ hata: 'MERSİS numarası 16 haneli olmalıdır.' });
    // YG-347: bağlama noktasındaki firma o noktaya bağlanır; değilse konum türü listeden seçilir.
    if (g.konumTuru && !KONUM_TURLERI.includes(g.konumTuru)) return y.code(400).send({ hata: `Konum türünü seçiniz: ${KONUM_TURLERI.join(', ')}.` });
    if (g.konumTuru === 'Bağlama Noktası' && !(g.baglamaNoktasi && UUID.test(g.baglamaNoktasi) && (await b.db.query(`SELECT 1 FROM baglama_noktasi WHERE kimlik = $1`, [g.baglamaNoktasi])).rowCount)) return y.code(400).send({ hata: 'Firmanın bulunduğu bağlama noktasını seçiniz.' });
    if (g.konumTuru) await b.db.query(`UPDATE kurulus SET baglama_noktasi_ref = $2 WHERE kimlik = $1`, [id, g.konumTuru === 'Bağlama Noktası' ? g.baglamaNoktasi : null]);
    await b.db.query(`UPDATE kurulus SET mersis_no = coalesce($2, mersis_no), mahalle = coalesce($3, mahalle), konum_turu = coalesce($4, konum_turu), yetkili_kisi = coalesce($5, yetkili_kisi), tali_branslar = coalesce($6, tali_branslar), hizmet_bolgeleri = coalesce($7, hizmet_bolgeleri), calisan_sayisi = coalesce($8, calisan_sayisi), referanslar = coalesce($9, referanslar) WHERE kimlik = $1`, [id, g.mersis ?? null, g.mahalle ?? null, g.konumTuru ?? null, g.yetkili ?? null, g.taliBranslar ?? null, g.bolgeler ?? null, g.calisan ?? null, g.referanslar ?? null]);
    return { tamam: true };
  });
}

/** YG-411: alt yüklenici kullanımı LGM'nin önceden yazılı onayına bağlıdır; ad, bu iş emrinde onaylanmış bir talepte geçmelidir. */
export async function altYukleniciEngeli(db: Db, isEmri: string, adlar: string[]): Promise<string | null> {
  const k = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
  const onayli = (await db.query(`SELECT alt_yuklenici FROM alt_yuklenici_talebi WHERE is_emri_ref = $1 AND durum = 'Onaylandı'`, [isEmri])).rows.map((r) => k(r.alt_yuklenici));
  const eksik = adlar.map((a) => a.trim()).filter((a) => a && !onayli.includes(k(a)));
  return eksik.length ? `LGM'nin yazılı onayı olmayan alt yüklenici: ${eksik.join(', ')}. Önce Alt Yüklenici Talebi onaylanmalıdır.` : null;
}

kapanisKaydet('Parametre Değişikliği', async (c, k, karar, yapan) => { // YG-853
  const o = (await c.query(`SELECT * FROM parametre_onerisi WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi])).rows[0];
  if (!o) return;
  if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') { await c.query(`UPDATE parametre_onerisi SET durum = 'Reddedildi' WHERE kimlik = $1`, [o.kimlik]); return; }
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE sistem_parametresi SET deger = $2, gecerlilik = current_date WHERE kod = $1`, [o.kod, o.yeni]);
  await c.query(`INSERT INTO parametre_gecmisi (kod, eski, yeni, gerekce, giren_ref) VALUES ($1,$2,$3,$4,$5)`, [o.kod, o.eski, o.yeni, o.gerekce, yapan]);
  await c.query(`UPDATE parametre_onerisi SET durum = 'Onaylandı' WHERE kimlik = $1`, [o.kimlik]);
  if (String(o.kod).startsWith('kimlik_')) await (await import('./ayarlar.js')).kuralYukle(c); // YG-1712: kimlik süreleri hemen geçerli olur
});

// YG-995: onay sonucu ek erişime işlenir.
kapanisKaydet('Dosya Ek Erişim Onayı', async (c, k, karar, yapan) => {
  if (!k.nesne_kimligi) return;
  if (karar === 'Onayla') await c.query(`UPDATE dosya_ek_yetki SET durum = 'Aktif', onaylayan_ref = $2 WHERE kimlik = $1 AND durum = 'Onayda'`, [k.nesne_kimligi, yapan]);
  else if (karar === 'Reddet') await c.query(`UPDATE dosya_ek_yetki SET durum = 'Reddedildi', onaylayan_ref = $2 WHERE kimlik = $1 AND durum = 'Onayda'`, [k.nesne_kimligi, yapan]);
});
