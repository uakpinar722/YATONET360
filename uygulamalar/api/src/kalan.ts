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

  // YG-344: FR-SCL-001 ön kayıt alanları.
  s.post('/firma/:id/on-kayit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { mersis?: string; mahalle?: string; konumTuru?: string; yetkili?: string; taliBranslar?: string[]; bolgeler?: string[]; calisan?: number; referanslar?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı']))) return yok(y);
    if (g.mersis && !/^\d{16}$/.test(g.mersis)) return y.code(400).send({ hata: 'MERSİS numarası 16 haneli olmalıdır.' });
    await b.db.query(`UPDATE kurulus SET mersis_no = coalesce($2, mersis_no), mahalle = coalesce($3, mahalle), konum_turu = coalesce($4, konum_turu), yetkili_kisi = coalesce($5, yetkili_kisi), tali_branslar = coalesce($6, tali_branslar), hizmet_bolgeleri = coalesce($7, hizmet_bolgeleri), calisan_sayisi = coalesce($8, calisan_sayisi), referanslar = coalesce($9, referanslar) WHERE kimlik = $1`, [id, g.mersis ?? null, g.mahalle ?? null, g.konumTuru ?? null, g.yetkili ?? null, g.taliBranslar ?? null, g.bolgeler ?? null, g.calisan ?? null, g.referanslar ?? null]);
    return { tamam: true };
  });
}
