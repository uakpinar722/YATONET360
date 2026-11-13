import { bilgiBelgesiMi, BILGI_HATA } from './belge_kural.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { dilKod, rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy, metinGetir, tutar } from './metin.js';
import { belgeUret } from './belge_uret.js';
import { gonderimIsleyici, sigortayaHazirla } from './sigorta_gonderim.js';
import { onaySonucKaydet, onayTalebiAc } from './onay.js';
import { altNumara } from './sure.js';
import { firmaFiyatYansit, parametre, isGunuSonu, teklifKdvUygula } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)'; const MFM = 'Muhasebe ve Finans Müdürü'; const TID = 'Ticari İşler Direktörü'; const GMY = 'Genel Müdür Yardımcısı'; const HUD = 'Hukuk ve Uyum Direktörü';

/** YG-157: açık koşul kapanmadan onarım iş emri açılmaz; GMY risk kabulü tanımlı istisnadır. */
export async function kosulEngeli(db: Db, dosya: string, tur: string): Promise<string | null> {
  if (!['ON', 'EK', 'PH'].includes(tur)) return null;
  return (await db.query(`SELECT 1 FROM teklif_kosulu WHERE dosya_ref = $1 AND durum = 'Açık' LIMIT 1`, [dosya])).rowCount ? 'Koşullu onaydaki koşul kapanmadan iş emri açılamaz; koşulun tamamlanması veya Genel Müdür Yardımcısı risk kabulü bekleniyor.' : null;
}
/** YG-454: beyanla çelişen bulgu veya tam ziya önerisinde sigortaya bildirim yapılmadan teklif onaya gitmez. */
export async function sigortaBildirimEngeli(db: Db, dosya: string): Promise<string | null> {
  return (await db.query(`SELECT 1 FROM bulgu b JOIN dosya d ON d.kimlik = b.dosya_ref WHERE b.dosya_ref = $1 AND d.musteri_turu = 'Sigorta Şirketi' AND (b.beyanla_celisen OR b.tam_ziya_onerisi) AND b.sigortaciya_bildirim_zamani IS NULL LIMIT 1`, [dosya])).rowCount ? 'Beyanla çelişen bulgu veya tam ziya önerisi için sigorta şirketine bildirim kaydı bekleniyor.' : null;
}
/** YG-1461: yurt dışı yatta teklif en az GMY onayına gider. */
export const yurtDisiMi = async (db: Db, dosya: string) => Boolean((await db.query(`SELECT yurt_disi FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]?.yurt_disi);
/** YG-1461: masrafın tamamı ile kalanın %50'si peşin. */
export async function yurtDisiAvans(db: Db, teklif: string, genelToplam: number, oran: number): Promise<number> {
  const m = Number((await db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND bedel_turu IN ('Masraf', 'Ulaşım', 'Konaklama', 'Harcırah', 'Gümrük ve İzin Giderleri') AND NOT opsiyon`, [teklif])).rows[0].t);
  return R2(m + ((genelToplam - m) * oran) / 100);
}

/** YG-027, YG-239: ticari veya mesleki amaç dışında hareket eden gerçek kişi 6502 kapsamındadır. */
export function kapsam6502(musteriTuru: string, kisiTuru: string | null, kullanim: string | null): boolean {
  return musteriTuru === 'Bireysel Müşteri' && kisiTuru === 'Gerçek kişi' && !/ticari|charter/i.test(kullanim ?? '');
}

/** YG-456: ay sonu kesimiyle sigorta şirketi başına tek rapor; izleyen ayın 5. iş günü 12:00'ye kadar gönderim görevi; süresinde itiraz edilmeyen satır mutabık sayılır. */
export async function mutabakatIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const ilk = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth(), 1));
  const kesim = new Date(ilk.getTime() - 86_400_000); const donem = kesim.toISOString().slice(0, 7);
  for (const s of (await db.query(`SELECT DISTINCT x.sigortaci_adi FROM musteri_faturasi f JOIN dosya_sigorta_kaydi x ON x.dosya_ref = f.dosya_ref WHERE f.muhatap = 'Sigorta Şirketi' AND f.fatura_no IS NOT NULL AND f.fatura_tarihi <= $1::date AND f.durum <> 'Tahsil Edildi' AND x.sigortaci_adi IS NOT NULL`, [kesim.toISOString().slice(0, 10)])).rows) {
    const son5 = await isGunuSonu(db, ilk, 5); son5.setUTCHours(9, 0, 0, 0);
    const r = await db.query(`INSERT INTO sigorta_mutabakat_raporu (sigortaci_adi, donem, kesim_tarihi, gonderim_son) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING kimlik`, [s.sigortaci_adi, donem, kesim.toISOString().slice(0, 10), son5]);
    if (!r.rowCount) continue;
    await db.query(`INSERT INTO sigorta_mutabakat_satiri (rapor_ref, dosya_ref, fatura_ref, onayli_tutar, odenen_tutar, acik_bakiye) SELECT $1, f.dosya_ref, f.kimlik, f.toplam_eur, f.tahsil_edilen_eur, f.toplam_eur - f.tahsil_edilen_eur FROM musteri_faturasi f JOIN dosya_sigorta_kaydi x ON x.dosya_ref = f.dosya_ref WHERE f.muhatap = 'Sigorta Şirketi' AND x.sigortaci_adi = $2 AND f.fatura_no IS NOT NULL AND f.fatura_tarihi <= $3::date AND f.durum <> 'Tahsil Edildi'`, [r.rows[0].kimlik, s.sigortaci_adi, kesim.toISOString().slice(0, 10)]);
    await kartAc(db, { tur: 'Sigorta Mutabakat Raporu', kategori: 'islem', baslik: `${s.sigortaci_adi} · ${donem} Mutabakat Raporu`, ozet: 'İzleyen ayın 5. iş günü 12:00’ye kadar gönderim', sonZaman: son5, oncelik: 'Yüksek', sahipRol: await rolId(db, TID), nesneTuru: 'Mutabakat Raporu', nesneKimligi: r.rows[0].kimlik }); n++;
  }
  for (const a of (await db.query(`SELECT kimlik FROM sigorta_mutabakat_raporu WHERE durum = 'Gönderildi' AND itiraz_son < $1::date`, [simdi.toISOString().slice(0, 10)])).rows) {
    await db.query(`UPDATE sigorta_mutabakat_satiri SET mutabik = NOT itiraz_edildi WHERE rapor_ref = $1`, [a.kimlik]);
    await db.query(`UPDATE sigorta_mutabakat_raporu SET durum = 'Sonuçlandı' WHERE kimlik = $1`, [a.kimlik]); n++;
  }
  return n;
}

// YG-062: süre dolumuyla kabulde dosya sorumlusu görür; geri alma Ticari İşler Direktöründe.
export async function otomatikKabulKontrolu(c: Db, t: { kimlik: string; teklif_no: string; dosya_ref: string }, ds: string | null) {
  if (ds && await birKez(c, 'otomatik_kabul', t.kimlik)) await kartAc(c, { tur: 'Otomatik Kabul Kontrolü', kategori: 'islem', baslik: `${t.teklif_no} · Süre Dolumuyla Kabul Kontrolü`, ozet: 'Yanlış uygulandıysa Ticari İşler Direktöründen geri alma isteyiniz.', sahipKullanici: ds, nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
}

gonderimIsleyici('Mutabakat Raporu', async (c, g) => {
  const gun = await parametre(c, 'mutabakat_itiraz_gun');
  const r = (await c.query(`UPDATE sigorta_mutabakat_raporu SET durum = 'Gönderildi', gonderim_zamani = now(), itiraz_son = (now() AT TIME ZONE 'Europe/Istanbul')::date + $2::int WHERE kimlik = $1 AND durum = 'Hazır' RETURNING sigortaci_adi, donem, itiraz_son`, [g.nesne_kimligi, gun])).rows[0];
  if (!r) throw Object.assign(new Error('Rapor gönderilmiştir.'), { statusCode: 409 });
  await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Sigorta Mutabakat Raporu' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [g.nesne_kimligi]);
  const metin = await metinGetir(c, 'BLD-87', 'tr', { Kurum: r.sigortaci_adi, dönem: r.donem, 'itiraz son tarihi': gunAy(r.itiraz_son) });
  const dosya = (await c.query(`SELECT dosya_ref FROM sigorta_mutabakat_satiri WHERE rapor_ref = $1 LIMIT 1`, [g.nesne_kimligi])).rows[0]?.dosya_ref;
  if (g.alici && dosya) await belgeUret(c, { tur: 'Mutabakat Raporu', nesne: g.nesne_kimligi!, dosya, gonder: { olay: `sigorta:${g.kimlik}`, eposta: g.alici, konu: g.konu, metin, sigortaTeyitli: true } });
  return { metin, ekli: true };
});

kapanisKaydet('Koşul Risk Kabulü', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') await c.query(`UPDATE teklif_kosulu SET durum = 'Risk Kabulü', risk_kabul_eden_ref = $2 WHERE kimlik = $1::uuid AND durum = 'Açık'`, [k.nesne_kimligi, yapan]);
});
kapanisKaydet('Kesin Teslim Tarihi', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE dosya SET kesin_teslim_durumu = 'Onaylandı' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE dosya SET kesin_teslim_durumu = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
kapanisKaydet('Firma Fiyatı Düzeltme', async (c, k, karar) => {
  if (karar === 'Reddet') { await c.query(`UPDATE firma_fiyat_duzeltme SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]); return; }
  if (karar !== 'Onayla') return;
  const d = (await c.query(`UPDATE firma_fiyat_duzeltme SET durum = 'Onaylandı' WHERE kimlik = $1::uuid RETURNING kalem_ref, yeni_fiyat_eur, gerekce`, [k.nesne_kimligi])).rows[0];
  if (d) { await c.query(`UPDATE firma_fiyat_kalemi SET eski_fiyat_eur = birim_fiyat_eur, birim_fiyat_eur = $2, duzeltme_gerekcesi = $3 WHERE kimlik = $1`, [d.kalem_ref, d.yeni_fiyat_eur, d.gerekce]); await firmaFiyatYansit(c, d.kalem_ref); }
});
onaySonucKaydet('ONY-05', async (c, t, karar) => {
  await c.query(`UPDATE degisiklik_protokolu SET durum = $2 WHERE onay_talebi_ref = $1`, [t.kimlik, karar === 'Onaylandı' ? 'Onaylandı' : 'Reddedildi']);
});

export function onayEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const dosyaBelgesi = async (belge: string | undefined, dosya: string) => Boolean(belge && UUID.test(belge) && (await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi::text = $2`, [belge, dosya])).rowCount);
  const teklif = async (id: string, k: string) => { if (!UUID.test(id)) return undefined; const t = (await b.db.query(`SELECT f.*, d.dosya_no, d.musteri_turu, d.dosya_sorumlusu_ref FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [id])).rows[0]; return t && await dosyaErisimi(b.db, k, t.dosya_ref) ? t : undefined; };

  // YG-450: hasar dosya numarası ihbarla veya sonradan girilir.
  s.post('/dosya/:id/hasar-no', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const no = ((i.body ?? {}) as { no?: string }).no?.trim();
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!no) return y.code(400).send({ hata: 'Hasar dosya numarasını yazmanızı rica ederiz.' });
    const r = await b.db.query(`UPDATE dosya_sigorta_kaydi SET sigorta_hasar_dosya_no = $2 WHERE dosya_ref = $1`, [id, no]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu dosyada sigorta kaydı bulunmamaktadır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Hasar Dosya No', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { no }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-062: süre dolumuyla verilen kabulü yetkili geri alır; iş emri açılmışsa geri alınmaz.
  s.post('/teklif/:id/otomatik-kabul-geri', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklif((i.params as { id: string }).id, o.kullanici); const g = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!t) return yok(y);
    if (!(await rolVar(o.kullanici, [TID]))) return y.code(403).send({ hata: 'Geri almayı Ticari İşler Direktörü yapar.' });
    if (!g) return y.code(400).send({ hata: 'Gerekçeyi yazmanızı rica ederiz.' });
    if (!(await b.db.query(`SELECT 1 FROM sigorta_onayi WHERE teklif_ref = $1 AND onay_kanali = 'Çerçeve Sözleşme Süresi'`, [t.kimlik])).rowCount) return y.code(409).send({ hata: 'Bu teklif süre dolumuyla kabul edilmemiştir.' });
    if ((await b.db.query(`SELECT 1 FROM is_emri WHERE teklif_ref = $1 AND statu NOT IN ('İptal', 'Yerine Geçti') LIMIT 1`, [t.kimlik])).rowCount) return y.code(409).send({ hata: 'Bu teklife iş emri açılmıştır; geri alınamaz.' });
    return islem(async (c) => {
      await c.query(`UPDATE fiyat_teklifi SET statu = 'Gönderildi', karar = NULL, karar_zamani = NULL, sigorta_karar_son = now() + interval '5 days' WHERE kimlik = $1`, [t.kimlik]);
      await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = 'Bekliyor' WHERE teklif_ref = $1`, [t.kimlik]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Otomatik Kabul Geri Alındı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, gerekce: g, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { durum: 'Gönderildi' };
    });
  });

  // YG-150, K-172: sigortanın onaylamaması yalnız ödeme kararıdır; yat sahibine devam, kapanış veya devir sorulur.
  s.post('/teklif/:id/ret-secenegi', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklif((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { secim?: string };
    if (!t) return yok(y);
    if (t.teklif_muhatabi !== 'Sigorta Şirketi' || t.karar !== 'Ret') return y.code(409).send({ hata: 'Seçenek, sigortanın onaylamadığı teklifte kaydedilir.' });
    if (!['Devam', 'Kapanış', 'Devir'].includes(g.secim ?? '')) return y.code(400).send({ hata: 'Yat sahibinin seçimini girmenizi rica ederiz.' });
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND x.rol_adi = 'Dosya Sorumlusu' AND a.atama_durumu = 'Aktif'`, [o.kullanici])).rowCount) return y.code(403).send({ hata: 'Seçimi Dosya Sorumlusu kaydeder.' });
    return islem(async (c) => {
      if (g.secim === 'Devam') await kartAc(c, { tur: 'Fiyat Teklifi Hazırla', kategori: 'islem', baslik: `${t.dosya_no} · Yat Sahibine Fiyat Teklifi`, ozet: 'Yat sahibi devam etmek istiyor.', sahipRol: await rolId(c, TICARI), nesneTuru: 'Teklif', nesneKimligi: t.kimlik });
      else await kartAc(c, { tur: g.secim === 'Kapanış' ? 'Dosya Kapanışı' : 'Dosya Devri', kategori: 'islem', baslik: `${t.dosya_no} · ${g.secim}`, ozet: 'Yat sahibinin seçimi kaydedildi.', sahipKullanici: t.dosya_sorumlusu_ref ?? o.kullanici, nesneTuru: 'Dosya', nesneKimligi: t.dosya_ref });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yat Sahibi Seçimi', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { secim: g.secim }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { secim: g.secim };
    });
  });

  // YG-206, K-172: sigortanın onaylamadığı kalemlerden yat sahibine ayrı teklif; kalemler silinmez, ana teklif değişmez.
  s.post('/teklif/:id/onaylanmayan-teklif', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklif((i.params as { id: string }).id, o.kullanici);
    if (!t) return yok(y);
    if (!(await rolVar(o.kullanici, [TICARI]))) return y.code(403).send({ hata: 'Teklifi Ticari Sorumlu hazırlar.' });
    if (t.teklif_muhatabi !== 'Sigorta Şirketi' || (!['Kısmi Onay', 'Ret'].includes(t.karar ?? '') && !t.odeme_farki_ayri)) return y.code(409).send({ hata: 'Ayrı teklif, sigortanın onaylamadığı kalemler için açılır.' });
    if ((await b.db.query(`SELECT 1 FROM fiyat_teklifi WHERE ana_teklif_ref = $1 AND teklif_muhatabi = 'Yat Sahibi' AND statu NOT IN ('İptal', 'Yerine Geçti') LIMIT 1`, [t.kimlik])).rowCount) return y.code(409).send({ hata: 'Bu kalemler için teklif bulunmaktadır.' });
    // YG-891: kapsamdan çıkarılan kalem teklife girmez; kalan bakiye ayrı kalem olur.
    const kl = (await b.db.query(`SELECT * FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu = 'Onaylanmadı' AND fark_karari IS DISTINCT FROM 'Kapsamdan Çıkarıldı' ORDER BY sira_no`, [t.kimlik])).rows;
    const bakiye = Number(t.odeme_farki_kalan_eur ?? 0);
    if (!kl.length && !(bakiye > 0)) return y.code(409).send({ hata: 'Onaylanmayan kalem bulunmamaktadır.' });
    const ara = R2(kl.reduce((a, k) => a + Number(k.tutar_eur), 0) + bakiye); const kdv = R2((ara * Number(t.kdv_orani)) / 100);
    return islem(async (c) => {
      const no = await altNumara(c, t.dosya_no, 'TK');
      const r = (await c.query(`INSERT INTO fiyat_teklifi (teklif_no, ana_teklif_ref, dosya_ref, cetvel_ref, teklif_muhatabi, teklif_dili, kdv_orani, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,$3,$4,'Yat Sahibi',$5,$6,$7,$8,$9,$7,$10) RETURNING kimlik`, [no, t.kimlik, t.dosya_ref, t.cetvel_ref, t.teklif_dili, t.kdv_orani, ara, kdv, R2(ara + kdv), o.kullanici])).rows[0];
      let n = 0;
      for (const k of kl) await c.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, satir_ref, kartela_kodu, kartela_surumu, kartela_disi, aciklama, isin_niteligi, bedel_turu, miktar, birim, firma_kalem_ref, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur, bant_disi, opsiyon, tedarikci_kalem_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [r.kimlik, ++n, k.satir_ref, k.kartela_kodu, k.kartela_surumu, k.kartela_disi, k.aciklama, k.isin_niteligi, k.bedel_turu, k.miktar, k.birim, k.firma_kalem_ref, k.birim_maliyet_eur, k.birim_satis_fiyati_eur, k.tutar_eur, false, k.opsiyon, k.tedarikci_kalem_ref]);
      if (bakiye > 0) await c.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, kartela_disi, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur) VALUES ($1,$2,true,'Onarım Bedeli Bakiyesi','Onarım','Masraf',1,'adet',0,$3,$3)`, [r.kimlik, ++n, bakiye]);
      await teklifKdvUygula(c, r.kimlik); // KDV-1
      return { kimlik: r.kimlik, teklifNo: no, tutar: ara };
    });
  });

  // YG-157: koşul eylem, sorumlu, süre ve gerçekleşmezse sonuçla kaydedilir.
  s.post('/teklif/:id/kosul', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklif((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { eylem?: string; sorumlu?: string; son?: string; gerceklesmezse?: string };
    if (!t) return yok(y);
    if (!g.eylem?.trim() || !g.sorumlu || !g.son || !g.gerceklesmezse?.trim()) return y.code(400).send({ hata: 'Eylem, sorumlu, son tarih ve gerçekleşmezse sonucu girmenizi rica ederiz.' });
    const r = await b.db.query(`INSERT INTO teklif_kosulu (teklif_ref, dosya_ref, eylem, sorumlu_ref, son_tarih, gerceklesmezse, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [t.kimlik, t.dosya_ref, g.eylem.trim(), g.sorumlu, g.son, g.gerceklesmezse.trim(), o.kullanici]);
    await kartAc(b.db, { tur: 'Koşul Takibi', kategori: 'islem', baslik: `${t.dosya_no} · Koşul: ${g.eylem.trim()}`, ozet: g.gerceklesmezse.trim(), sahipKullanici: g.sorumlu, sonZaman: new Date(`${g.son}T18:00:00+03:00`), oncelik: 'Yüksek', nesneTuru: 'Teklif Koşulu', nesneKimligi: r.rows[0].kimlik });
    return { kimlik: r.rows[0].kimlik };
  });
  s.get('/dosya/:id/kosullar', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT k.kimlik, k.eylem, k.son_tarih::text, k.gerceklesmezse, k.durum, h.ad_soyad AS sorumlu, (k.son_tarih - current_date) AS kalan FROM teklif_kosulu k JOIN kullanici_hesabi h ON h.kimlik = k.sorumlu_ref WHERE k.dosya_ref = $1 ORDER BY k.olusturma_zamani`, [id])).rows;
  });
  s.post('/teklif-kosulu/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT * FROM teklif_kosulu WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (k.durum !== 'Açık') return y.code(409).send({ hata: 'Koşul kapanmıştır.' });
    if (!(await dosyaBelgesi(g.belge, k.dosya_ref))) return y.code(400).send({ hata: 'Kanıt belgesini eklemenizi rica ederiz.' });
    await b.db.query(`UPDATE teklif_kosulu SET durum = 'Kapalı', kanit_belge_ref = $2 WHERE kimlik = $1`, [id, g.belge]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Koşul Takibi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    return { durum: 'Kapalı' };
  });
  s.post('/teklif-kosulu/:id/risk-kabulu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT k.*, d.dosya_no FROM teklif_kosulu k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (!g) return y.code(400).send({ hata: 'Gerekçeyi yazmanızı rica ederiz.' });
    await kartAc(b.db, { tur: 'Koşul Risk Kabulü', baslik: `${k.dosya_no} · Koşul Risk Kabulü`, ozet: `${k.eylem} · ${g}`, hazirlayan: o.kullanici, zincir: [await rolId(b.db, GMY)], nesneTuru: 'Teklif Koşulu', nesneKimligi: id });
    return { durum: 'Onayda' };
  });

  // YG-215: kesin teslim tarihi ve gecikme bedeli GMY onayıyla iş emrine yansır.
  s.post('/dosya/:id/kesin-teslim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tarih?: string; gecikmeBedeli?: number };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g.tarih || !(Number(g.gecikmeBedeli) >= 0) || g.gecikmeBedeli === undefined) return y.code(400).send({ hata: 'Kesin teslim tarihi ve gecikme bedelini girmenizi rica ederiz.' });
    const no = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0].dosya_no;
    return islem(async (c) => {
      await c.query(`UPDATE dosya SET kesin_teslim_tarihi = $2, gecikme_bedeli_eur = $3, kesin_teslim_durumu = 'Onayda' WHERE kimlik = $1`, [id, g.tarih, g.gecikmeBedeli]);
      await kartAc(c, { tur: 'Kesin Teslim Tarihi', baslik: `${no} · Kesin Teslim Tarihi`, ozet: `${g.tarih} · Gecikme Bedeli: ${tutar(Number(g.gecikmeBedeli))} EUR`, hazirlayan: o.kullanici, zincir: [await rolId(c, GMY)], nesneTuru: 'Dosya', nesneKimligi: id });
      return { durum: 'Onayda' };
    });
  });

  // YG-225, YG-226: her değişiklik ayrı kayıt; YATONET onayı, e-imza veya ıslak imza; sigorta onayı alanı.
  s.post('/dosya/:id/degisiklik', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; mevcut?: string; onerilen?: string; bedelFarki?: number; yeniToplam?: number; ekSure?: number; kanal?: string; belge?: string; sigortaOnayi?: string; sigortaTarih?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!['Değişiklik', 'İlave İş', 'Süre Uzatımı'].includes(g.tur ?? '') || !g.mevcut?.trim() || !g.onerilen?.trim()) return y.code(400).send({ hata: 'Tür, mevcut ve önerilen durumu girmenizi rica ederiz.' });
    if (!['YATONET 360', 'E-imza', 'Islak İmza'].includes(g.kanal ?? '')) return y.code(400).send({ hata: 'Onay kanalını seçmenizi rica ederiz.' });
    const si = g.sigortaOnayi ?? 'Gerekli Değil';
    if (!['Gerekli Değil', 'Alındı'].includes(si) || (si === 'Alındı' && !g.sigortaTarih)) return y.code(400).send({ hata: 'Sigorta şirketi onay tarihini girmenizi rica ederiz.' });
    if (g.kanal !== 'YATONET 360' && !(await dosyaBelgesi(g.belge, id))) return y.code(400).send({ hata: 'İmzalı protokolü dosyaya yükleyip seçmenizi rica ederiz.' });
    if (g.kanal !== 'YATONET 360' && (await bilgiBelgesiMi(b.db, g.belge!))) return y.code(409).send({ hata: BILGI_HATA }); // YG-622
    const d = (await b.db.query(`SELECT d.dosya_no, d.yazisma_dili FROM dosya d WHERE d.kimlik = $1`, [id])).rows[0];
    const yt = (await b.db.query(`SELECT kimlik, kisi_adi_soyadi, telefon, eposta, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [id])).rows[0];
    if (g.kanal === 'YATONET 360' && !yt) return y.code(409).send({ hata: 'Yat sahibi kaydı bulunamadı.' });
    return islem(async (c) => {
      const no = await altNumara(c, d.dosya_no, 'DG');
      const yeni = Number(g.yeniToplam) >= 0 && g.yeniToplam !== undefined ? g.yeniToplam : null;
      const r = (await c.query(`INSERT INTO degisiklik_protokolu (degisiklik_no, dosya_ref, tur, mevcut, onerilen, bedel_farki_eur, yeni_toplam_eur, ek_sure_gun, kanal, belge_ref, sigorta_onayi, sigorta_onay_tarihi, durum, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING kimlik`, [no, id, g.tur, g.mevcut!.trim(), g.onerilen!.trim(), Number(g.bedelFarki) || 0, yeni, Number(g.ekSure) || 0, g.kanal, g.belge ?? null, si, si === 'Alındı' ? g.sigortaTarih : null, g.kanal === 'YATONET 360' ? 'Onay Bekliyor' : 'Onaylandı', o.kullanici])).rows[0];
      await belgeUret(c, { tur: 'Değişiklik Kaydı', nesne: r.kimlik, dosya: id }); // YG-656: iç FR-UYG-003
      if (g.kanal === 'YATONET 360') {
        const dl = dilKod(d.yazisma_dili); const ts = tutar(Number(yeni ?? 0), dl);
        const on = await onayTalebiAc(c, { dosya: id, ony: 'ONY-05', dil: dl, alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, 'Değişiklik No / Sürüm': no, 'Change No / Version': no, 'bağlantı': b.webAdresi, link: b.webAdresi, '0.000,00': ts, '0,000.00': ts }, tutar: yeni, taraf: yt.kimlik, kullanici: yt.kullanici_ref, aliciAd: yt.kisi_adi_soyadi, telefon: yt.telefon, eposta: yt.eposta, nesneTuru: 'Değişiklik', nesneKimligi: r.kimlik, hazirlayan: o.kullanici, webAdresi: b.webAdresi, konu: `${d.dosya_no} Değişiklik Onayı` });
        await c.query(`UPDATE degisiklik_protokolu SET onay_talebi_ref = $2 WHERE kimlik = $1`, [r.kimlik, on.kimlik]);
      }
      return { kimlik: r.kimlik, degisiklikNo: no };
    });
  });
  s.get('/dosya/:id/degisiklikler', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT degisiklik_no, tur, mevcut, onerilen, bedel_farki_eur, yeni_toplam_eur, ek_sure_gun, kanal, sigorta_onayi, durum, sum(CASE WHEN durum = 'Onaylandı' THEN coalesce(bedel_farki_eur, 0) ELSE 0 END) OVER (ORDER BY olusturma_zamani) AS kumulatif_eur FROM degisiklik_protokolu WHERE dosya_ref = $1 ORDER BY olusturma_zamani`, [id])).rows;
  });

  // YG-1461: yurt dışı işareti Hukuk ve Uyum izin kontrolü görevini açar.
  s.post('/dosya/:id/yurt-disi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const no = (await b.db.query(`UPDATE dosya SET yurt_disi = true WHERE kimlik = $1 RETURNING dosya_no`, [id])).rows[0].dosya_no;
    if (await birKez(b.db, 'yurt_disi', id)) await kartAc(b.db, { tur: 'Yurt Dışı İzin Kontrolü', kategori: 'islem', baslik: `${no} · Yurt Dışı İzin Kontrolü`, oncelik: 'Yüksek', sahipRol: await rolId(b.db, HUD), nesneTuru: 'Dosya', nesneKimligi: id });
    return { uyari: 'Yurt dışı yat: teklif Genel Müdür Yardımcısı onayına gider.' };
  });

  // YG-454: bildirim yapıldığında zaman kaydedilir.
  s.post('/bulgu/:id/sigorta-bildirimi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT dosya_ref FROM bulgu WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    await b.db.query(`UPDATE bulgu SET sigortaciya_bildirim_zamani = now() WHERE kimlik = $1 AND sigortaciya_bildirim_zamani IS NULL`, [id]);
    return { tamam: true };
  });

  // YG-456: rapor listesi, gönderim ve satır itirazı. E-posta metni onaylanana kadar gönderim yalnız kayda geçer.
  s.get('/mutabakat', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [TID, MFM, TICARI]))) return yok(y);
    const r = (await b.db.query(`SELECT kimlik, sigortaci_adi, donem, kesim_tarihi::text, gonderim_son, gonderim_zamani, itiraz_son::text, durum FROM sigorta_mutabakat_raporu ORDER BY kesim_tarihi DESC LIMIT 60`)).rows;
    const s2 = (await b.db.query(`SELECT x.kimlik, x.rapor_ref, d.dosya_no, f.fatura_no, x.onayli_tutar, x.odenen_tutar, x.acik_bakiye, x.itiraz_edildi, x.mutabik FROM sigorta_mutabakat_satiri x JOIN dosya d ON d.kimlik = x.dosya_ref JOIN musteri_faturasi f ON f.kimlik = x.fatura_ref WHERE x.rapor_ref = ANY($1::uuid[])`, [r.map((a) => a.kimlik)])).rows;
    return r.map((a) => ({ ...a, satirlar: s2.filter((x) => x.rapor_ref === a.kimlik) }));
  });
  s.post('/mutabakat/:id/gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [TID]))) return y.code(403).send({ hata: 'Raporu Ticari İşler Direktörü gönderir.' });
    const r = (await b.db.query(`SELECT r.sigortaci_adi, r.durum, r.donem, (SELECT t.eposta FROM dosya_sigorta_kaydi s JOIN dosya_tarafi t ON t.kimlik = s.sigorta_taraf_ref WHERE s.sigortaci_adi = r.sigortaci_adi AND t.eposta IS NOT NULL LIMIT 1) AS eposta FROM sigorta_mutabakat_raporu r WHERE r.kimlik = $1`, [id])).rows[0];
    if (!r) return yok(y);
    if (r.durum !== 'Hazır') return y.code(409).send({ hata: 'Rapor gönderilmiştir.' });
    if (!r.eposta) return y.code(409).send({ hata: 'Sigorta şirketinin e-posta adresi bekleniyor.' });
    // K-241: sigortaya gönderim ikili teyitten geçer; itiraz süresi ikinci teyitte başlar.
    const gonderim = await sigortayaHazirla(b.db, { tur: 'Mutabakat Raporu', nesne: id, alici: r.eposta, konu: `${r.sigortaci_adi} ${r.donem} Mutabakat Raporu`, sorumlu: o.kullanici });
    return { gonderim };
  });
  s.post('/mutabakat-satiri/:id/itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const not = ((i.body ?? {}) as { not?: string }).not?.trim();
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [TID, MFM, TICARI]))) return yok(y);
    if (!not) return y.code(400).send({ hata: 'İtiraz notunu yazmanızı rica ederiz.' });
    const r = await b.db.query(`UPDATE sigorta_mutabakat_satiri x SET itiraz_edildi = true, itiraz_notu = $2 FROM sigorta_mutabakat_raporu r WHERE x.kimlik = $1 AND r.kimlik = x.rapor_ref AND r.durum = 'Gönderildi' AND r.itiraz_son >= current_date`, [id, not]);
    return r.rowCount ? { tamam: true } : y.code(409).send({ hata: 'İtiraz süresi dolmuştur.' });
  });

  // YG-189: firma kaynaklı hatada kalem firmaya iade; LGM kaynaklı hatada firma belgesine dayalı düzeltme, Müdür onayı.
  s.get('/firma-teklif/:id/kalemler', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolVar(i.oturum!.kullanici, [TICARI]))) return yok(y);
    return (await b.db.query(`SELECT x.kimlik, x.birim_fiyat_eur, x.eski_fiyat_eur, x.iade_gerekcesi, s.satir_kodu, s.aciklama FROM firma_fiyat_kalemi x JOIN kapsam_satiri s ON s.kimlik = x.satir_ref WHERE x.teklif_ref = $1 ORDER BY s.satir_kodu`, [id])).rows;
  });
  s.post('/firma-kalem/:id/iade', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [TICARI]))) return yok(y);
    if (!g) return y.code(400).send({ hata: 'Gerekçeyi yazmanızı rica ederiz.' });
    const k = (await b.db.query(`UPDATE firma_fiyat_kalemi x SET iade_gerekcesi = $2 FROM firma_fiyat_teklifi t WHERE x.kimlik = $1 AND t.kimlik = x.teklif_ref RETURNING t.kurulus_ref, t.teklif_no`, [id, g])).rows[0];
    if (!k) return yok(y);
    const kisi = (await b.db.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [k.kurulus_ref])).rows.map((r) => r.kullanici_ref as string);
    await bildir(b.db, { olay: `firma-kalem-iade:${id}:${Date.now()}`, kullanicilar: kisi, baslik: `${k.teklif_no} · Fiyat Düzeltmesi İstendi`, ozet: g, oncelik: 'Yüksek', eposta: true });
    return { tamam: true };
  });
  s.post('/firma-portal/fiyat-kalem/:id/duzelt', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const fiyat = ((i.body ?? {}) as { fiyat?: number }).fiyat;
    if (!UUID.test(id)) return yok(y);
    if (!(Number(fiyat) >= 0) || fiyat === undefined) return y.code(400).send({ hata: 'Fiyatı girmenizi rica ederiz.' });
    const r = await b.db.query(`UPDATE firma_fiyat_kalemi x SET eski_fiyat_eur = x.birim_fiyat_eur, birim_fiyat_eur = $2, duzeltme_gerekcesi = x.iade_gerekcesi, iade_gerekcesi = NULL FROM firma_fiyat_teklifi t JOIN kurulus_kullanici u ON u.kurulus_ref = t.kurulus_ref WHERE x.kimlik = $1 AND t.kimlik = x.teklif_ref AND u.kullanici_ref = $3 AND x.iade_gerekcesi IS NOT NULL`, [id, fiyat, o.kullanici]);
    if (r.rowCount) await firmaFiyatYansit(b.db, id);
    return r.rowCount ? { tamam: true } : yok(y);
  });
  s.post('/firma-kalem/:id/lgm-duzeltme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { fiyat?: number; gerekce?: string; belge?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [TICARI]))) return yok(y);
    const k = (await b.db.query(`SELECT x.kimlik, t.dosya_ref, t.teklif_no FROM firma_fiyat_kalemi x JOIN firma_fiyat_teklifi t ON t.kimlik = x.teklif_ref WHERE x.kimlik = $1`, [id])).rows[0];
    if (!k) return yok(y);
    if (!(Number(g.fiyat) >= 0) || g.fiyat === undefined || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Fiyat ve gerekçeyi girmenizi rica ederiz.' });
    if (!(await dosyaBelgesi(g.belge, k.dosya_ref))) return y.code(400).send({ hata: 'Firmanın teklif belgesini eklemenizi rica ederiz.' });
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO firma_fiyat_duzeltme (kalem_ref, yeni_fiyat_eur, gerekce, belge_ref, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, g.fiyat, g.gerekce!.trim(), g.belge, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Firma Fiyatı Düzeltme', baslik: `${k.teklif_no} · Firma Fiyatı Düzeltme`, ozet: `${tutar(Number(g.fiyat))} EUR · ${g.gerekce!.trim()}`, hazirlayan: o.kullanici, zincir: [await rolId(c, MFM)], nesneTuru: 'Firma Fiyat Düzeltme', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik };
    });
  });

  // YG-208: kurumsal müşteride Ek-2 kurumsal e-postadan gelen onay; gönderen kurumun Onaylayan kullanıcısı olmalı, sınır aşılmamalı.
  s.post('/teklif/:id/kurumsal-eposta-onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklif((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { gonderen?: string; belge?: string };
    if (!t) return yok(y);
    if (t.teklif_muhatabi !== 'Kurumsal Müşteri' || t.statu !== 'Gönderildi') return y.code(409).send({ hata: 'Bu işlem gönderilmiş kurumsal teklifte yapılır.' });
    if (!g.gonderen?.trim() || !(await dosyaBelgesi(g.belge, t.dosya_ref))) return y.code(400).send({ hata: 'Gönderen adresi ve onay e-postasını eklemenizi rica ederiz.' });
    if (await bilgiBelgesiMi(b.db, g.belge!)) return y.code(409).send({ hata: BILGI_HATA }); // YG-622
    const bz = await (await import('./teyit.js')).benzerAlanKontrolu(b.db, g.gonderen, o.kullanici, t.dosya_ref); if (bz) return y.code(409).send({ hata: bz }); // YG-1272
    const u = (await b.db.query(`SELECT u.onay_siniri, c.ek2_onay_siniri FROM kurumsal_kullanici u JOIN kurumsal_kurum c ON c.kimlik = u.kurum_ref JOIN kullanici_hesabi h ON h.kimlik = u.kullanici_ref JOIN yat ky ON ky.yat_sahibi_ref = c.taraf_ref JOIN dosya d ON d.yat_ref = ky.kimlik WHERE d.kimlik = $1 AND lower(h.e_posta COLLATE "C") = lower($2::text COLLATE "C") AND u.rol = 'Onaylayan' AND h.hesap_durumu = 'Aktif'`, [t.dosya_ref, g.gonderen.trim()])).rows[0];
    if (!u) return y.code(409).send({ hata: 'Bu adres kurumun onay yetkilisi olarak tanımlı değildir.' });
    if (Number(t.genel_toplam_eur) > Math.min(Number(u.onay_siniri ?? 0), Number(u.ek2_onay_siniri))) return y.code(409).send({ hata: 'Tutar onay yetkilisinin sınırının üzerindedir.' });
    return islem(async (c) => {
      await c.query(`UPDATE fiyat_teklifi SET statu = 'Karar', karar = 'Tam Onay', karar_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
      await c.query(`UPDATE fiyat_teklifi_kalemi SET onay_durumu = 'Onaylandı' WHERE teklif_ref = $1 AND NOT opsiyon`, [t.kimlik]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurumsal E-posta Onayı', nesneTuru: 'Teklif', nesneKimligi: t.kimlik, yeni: { gonderen: g.gonderen!.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { durum: 'Tam Onay' };
    });
  });
}
