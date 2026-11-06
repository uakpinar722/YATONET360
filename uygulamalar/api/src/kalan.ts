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
  return { dosyaAdi: `${k.teklif_no}-OB.pdf`, sinif: 'Gizli', t: { ad: m.ad, no: `${k.teklif_no}-OB`, dosyaNo: k.dosya_no, tarih: gunAy(new Date()), surum: `Rev.${k.surum_no}`, dil, yat: k.yat_adi, bolumler, dogrulamaKodu: kod } as unknown as BelgeTanim };
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

/** YG-990: ayda bir İç Denetim Müdürüne gözetim görevi; bulgu yoksa görev açılmaz. */
export async function gorevAyriligiIsle(db: Pool, simdi = new Date()): Promise<number> {
  const donem = simdi.toISOString().slice(0, 7);
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

export function kalanYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

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
    const o = i.oturum!; const { id } = i.params as { id: string }; const brans = ((i.query ?? {}) as { brans?: string }).brans?.trim();
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!brans) return y.code(400).send({ hata: 'Branşı seçiniz.' });
    const konum = String((await b.db.query(`SELECT konum FROM dosya WHERE kimlik = $1`, [id])).rows[0].konum).toLocaleLowerCase('tr');
    const l = (await b.db.query(`SELECT u.kimlik, u.ticari_unvan, y.kapsama, y.bolge FROM brans_yetkinligi y JOIN kurulus u ON u.kimlik = y.kurulus_ref WHERE y.ana_brans = $1 AND y.durum = 'Aktif' AND u.kayit_rolu = 'Çözüm Ortağı' AND u.ag_statusu = 'Aktif' AND u.kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı')`, [brans])).rows.filter((f) => f.kapsama !== 'Bölge' || !f.bolge || konum.includes(String(f.bolge).toLocaleLowerCase('tr')));
    const S = { Kabul: 0, 'Koşullu Kabul': 1, Ret: 2 } as const; const sonuc = [];
    for (const f of l) { const k = await gorevlendirmeKontrolu(b.db, { firma: f.kimlik, dosya: id, brans }); sonuc.push({ kimlik: f.kimlik, ticari_unvan: f.ticari_unvan, kapsama: f.kapsama, sonuc: k.sonuc, engeller: k.engeller, uyarilar: k.uyarilar }); }
    return sonuc.sort((a, c) => S[a.sonuc] - S[c.sonuc] || a.ticari_unvan.localeCompare(c.ticari_unvan, 'tr'));
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
    if (g.bitis < new Date().toISOString().slice(0, 10)) return y.code(400).send({ hata: 'Bitiş tarihi geçmişte olamaz.' });
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
      const dl = dilKod(tm.tercih_dili); const ks = (x?: { ad?: string; limit?: number }) => (x?.ad ? `${x.ad}${x.limit !== undefined && x.limit !== null ? ` · ${tutar(Number(x.limit), dl)} EUR` : ''}` : '—');
      const on = await onayTalebiAc(c, { ony: 'ONY-15', dil: dl, alanlar: { Şirket: kr.unvan, Company: kr.unvan }, baslikAlanlari: { 'Müşteri Sözleşme Muhatabı': ks(st.muhatap), 'Teknik Kapsam Onayı': ks(st.kapsam), 'Fiyat ve Ödeme Onayı': ks(st.fiyat), 'Yat Teslim/İade Yetkilisi': ks(st.teslim), 'Yatın Kaptanı / Yat Yetkilisi': ks(kaptan), Yatlar: (g.yatlar ?? []).join(', ') || '—', 'Bitiş Tarihi': g.bitis || '—', Sürüm: String(n) }, aliciAd: tm.ad_soyad, kullanici: tm.kimlik, telefon: tm.cep_telefonu, eposta: tm.e_posta, nesneTuru: 'Kurumsal Ek-2', nesneKimligi: e2.kimlik, hazirlayan: o.kullanici, webAdresi: b.webAdresi, konu: `${kr.unvan} Ek-2` });
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
  const parametreci = (k: string) => rolVar(k, [TID, 'Genel Müdür Yardımcısı', 'CEO']);
  s.get('/parametreler', oturumlu, async (i, y) => (await parametreci(i.oturum!.kullanici)) ? (await b.db.query(`SELECT kod, deger, aciklama FROM sistem_parametresi WHERE kod <> 'fiyat_katsayisi' ORDER BY kod`)).rows : yok(y));
  s.post('/parametre/:kod', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string }; const g = (i.body ?? {}) as { deger?: number | null; gerekce?: string };
    if (!(await parametreci(o.kullanici))) return yok(y);
    if (kod === 'fiyat_katsayisi') return yok(y);
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Değişiklik gerekçesini yazmanızı rica ederiz.' });
    if (g.deger !== null && g.deger !== undefined && !(Number(g.deger) >= 0)) return y.code(400).send({ hata: 'Değer geçersizdir.' });
    const e = (await b.db.query(`SELECT deger FROM sistem_parametresi WHERE kod = $1`, [kod])).rows[0]; if (!e) return yok(y);
    const yeni = g.deger === null || g.deger === undefined ? null : Number(g.deger);
    await b.db.query(`UPDATE sistem_parametresi SET deger = $2, gecerlilik = current_date WHERE kod = $1`, [kod, yeni]);
    await b.db.query(`INSERT INTO parametre_gecmisi (kod, eski, yeni, gerekce, giren_ref) VALUES ($1,$2,$3,$4,$5)`, [kod, e.deger, yeni, g.gerekce.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Parametre Değişikliği', nesneTuru: 'Parametre', nesneKimligi: kod, eski: { deger: e.deger }, yeni: { deger: yeni }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
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
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { mersis?: string; mahalle?: string; konumTuru?: string; yetkili?: string; taliBranslar?: string[]; bolgeler?: string[]; calisan?: number; referanslar?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı']))) return yok(y);
    if (g.mersis && !/^\d{16}$/.test(g.mersis)) return y.code(400).send({ hata: 'MERSİS numarası 16 haneli olmalıdır.' });
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
