import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri, onayMakami } from './makam.js';
import { gunAy, tutar } from './metin.js';
import { kutuAyikla, onaySonucKaydet, onayTalebiAc } from './onay.js';
import { kapanisKapisi } from './saha.js';
import { altNumara } from './sure.js';
import { parametre, parasalZincir, sonMakam } from './teklif.js';
import { UUID } from './yat.js';
import { emniyetEngeli } from './kalite.js';
import { tesisSerbestBirak } from './portallar.js';
import { belgeUret } from './belge_uret.js';
import { izinGerekli } from './yetki.js';
import { kdvBelirle, kdvHesapla } from './vergi.js';
import { alacakYoluAc, blokeEngeli, gecikmeFaizi, krediDurumu, krediUyarilari } from './alacak.js';
import { sigortayaHazirla } from './sigorta_gonderim.js';
import { yurtDisiAvans, yurtDisiMi } from './onay_ek.js';
import { disGonder } from './bildirim.js';
import { metinGetir } from './metin.js';

type Db = Pool | PoolClient;
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
const MFM = 'Muhasebe ve Finans Müdürü';
const MFMY = 'Muhasebe ve Finans Müdür Yardımcısı';
const gun = (d: Date | string) => new Date(new Date(d).getTime() + 180 * 60_000).toISOString().slice(0, 10);

/** YG-906: sigorta 20.000,00 EUR'ya kadar avans yok, üzerinde %50; bireysel tutardan bağımsız %50; kurumsal %50. Acil/kritikte sigorta ve kurumsalda avans beklenmez. Tutar KDV dahil genel toplamdır. */
export function avansHesapla(musteri: string, onayliEur: number, kritik: boolean, oran = 50, esik = 20000): number {
  if (musteri !== 'Bireysel Müşteri' && kritik) return 0;
  if (musteri === 'Sigorta Şirketi' && onayliEur <= esik) return 0;
  return R2((onayliEur * oran) / 100);
}

/** YG-838: bedeli 10.000,00 EUR'yu aşan iş emrinde brütten %5 kesinti; 12 ay sonra serbest bırakılır. */
export function hakedisKesintisi(brut: number, isEmriBedeli: number, esik = 10000, oran = 5, teminatMektubu = false): number {
  return !teminatMektubu && isEmriBedeli > esik ? R2((brut * oran) / 100) : 0;
}

/** YG-843: firma ödemesi tahsilattan 45 gün sonra, tahsil edilen oranda; tahsilat olmasa da teknik kabul ve faturadan en geç 120. günde. */
/** YG-843: tahsil edilen / faturalanan; kısmi tahsilatta firma ödemesi bu oranda. */
export async function tahsilatOrani(db: Db, dosya: string): Promise<number> {
  const f = Number((await db.query(`SELECT coalesce(sum(toplam_eur), 0) t FROM musteri_faturasi WHERE dosya_ref = $1 AND fatura_no IS NOT NULL`, [dosya])).rows[0].t);
  const t = Number((await db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM tahsilat WHERE dosya_ref = $1`, [dosya])).rows[0].t);
  return f > 0 ? Math.min(1, t / f) : 1;
}

/** Ödenen ve mahsup edilen bedel neti karşılayınca hakediş kapanır; kalan varsa yeni talimat için döner (YG-841, YG-843). */
export async function hakedisSonuc(c: Db, hakedis: string) {
  await c.query(`UPDATE hakedis h SET statu = CASE WHEN (SELECT coalesce(sum(t.tutar_eur + t.mahsup_eur), 0) FROM odeme_talimati t WHERE t.hakedis_ref = h.kimlik AND t.durum = 'Ödendi') >= h.net THEN 'Ödendi' ELSE 'Doğrulandı' END WHERE h.kimlik = $1`, [hakedis]);
}

export function firmaOdemePlani(tahsilatTarihi: Date | null, kabulFaturaTarihi: Date, odemeGun = 45, azamiGun = 120) {
  const azami = new Date(kabulFaturaTarihi.getTime() + azamiGun * 86_400_000);
  if (!tahsilatTarihi) return { tarih: azami, tahsilataBagli: false };
  const plan = new Date(tahsilatTarihi.getTime() + odemeGun * 86_400_000);
  return plan < azami ? { tarih: plan, tahsilataBagli: true } : { tarih: azami, tahsilataBagli: false };
}

/** YG-921: masraf limitleri EUR; aşan kısım ödenmez. Km 0,20 / yemek 25 / konaklama 90. */
export function masrafOdenecek(tur: string, eur: number, miktar: number, lim: { km: number; yemek: number; konaklama: number }): number {
  const sinir = tur === 'Km' ? lim.km * miktar : tur === 'Yemek' ? lim.yemek * miktar : tur === 'Konaklama' ? lim.konaklama * miktar : null;
  return R2(sinir === null ? eur : Math.min(eur, sinir));
}

/** YG-948: yıllık izin hakkı kıdeme göre (İş Kanunu m.53): 1–5 yıl 14, 5–15 yıl 20, 15 ve üzeri 26 gün. */
export const yillikHak = (kidemYil: number) => (kidemYil < 1 ? 0 : kidemYil < 5 ? 14 : kidemYil < 15 ? 20 : 26);

/** YG-948: hafta sonu ve resmî tatiller düşülür. Cumartesi mesai günü olduğu hâlde katalog "hafta sonu" der; Cumartesi ve Pazar düşülür. */
export function izinGunu(bas: string, bit: string, tatil: Set<string> = new Set()): number {
  let n = 0; const x = new Date(`${bas}T12:00:00Z`); const z = new Date(`${bit}T12:00:00Z`);
  while (x <= z) { const g = x.getUTCDay(); if (g !== 0 && g !== 6 && !tatil.has(x.toISOString().slice(0, 10))) n++; x.setUTCDate(x.getUTCDate() + 1); }
  return n;
}

/** TR IBAN: 26 karakter, mod 97 (YG-919, YG-928). */
export function ibanGecerli(iban: string): boolean {
  const t = iban.replace(/\s/g, '').toUpperCase();
  if (!/^TR[0-9]{24}$/.test(t)) return false;
  const s = (t.slice(4) + t.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0; for (const c of s) r = (r * 10 + Number(c)) % 97;
  return r === 1;
}

/** YG-087, YG-910: vadesi gelen ödeme tahsil edilmeden teslim yok. Bireysel tüm bakiye; sigortanın vadeli alacağı engellemez. Takyidat ve açık iş kontrolü (YG-417). */
export async function teslimEngeli(db: Db, dosya: string): Promise<string | null> {
  const d = (await db.query(`SELECT d.musteri_turu, d.teslim_istisnasi, d.calisma_durduruldu, y.takyidat FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (d.calisma_durduruldu) return 'Çalışmalar durdurulmuştur.';
  const em = await emniyetEngeli(db, dosya); if (em) return em;
  if ((d.takyidat as string[]).some((x) => x === 'Haciz' || x.startsWith('İhtiyati')) && !(await db.query(`SELECT 1 FROM is_karti WHERE tur = 'Takyidat Değerlendirmesi' AND nesne_kimligi = $1 AND durum = 'Tamamlandı'`, [dosya])).rowCount) return 'Takyidatlı yatın teslimi için Hukuk ve Uyum değerlendirmesi bekleniyor.';
  if (d.teslim_istisnasi) return null;
  if (d.musteri_turu === 'Sigorta Şirketi') return null;
  const borc = Number((await db.query(`SELECT coalesce(sum(toplam_eur - tahsil_edilen_eur), 0) - coalesce((SELECT sum(x.tutar_eur) FROM fatura_itirazi x JOIN musteri_faturasi m ON m.kimlik = x.fatura_ref WHERE m.dosya_ref = $1 AND x.durum = 'Açık'), 0) b FROM musteri_faturasi WHERE dosya_ref = $1 AND durum IN ('Faturalandı', 'Kısmi Tahsil')`, [dosya])).rows[0].b); // K-169: itiraz edilmeyen kısım ödenince teslim
  const talep = Number((await db.query(`SELECT coalesce(sum(tutar_eur), 0) b FROM odeme_talebi WHERE dosya_ref = $1 AND durum = 'Gönderildi'`, [dosya])).rows[0].b);
  return borc + talep > 0 ? `Ödeme bekleniyor: ${tutar(R2(borc + talep))} EUR.` : null;
}

/** YG-911, YG-1495, YG-1521: alacak takip basamakları. Sigortaya ihtar gitmez; vefatta tahsilat askısı. */
export async function alacakIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const { rows } = await db.query(`SELECT f.kimlik, f.vade, f.proforma_no, f.fatura_no, f.toplam_eur, f.toplam_tl, f.tahsil_edilen_eur, f.dosya_ref, d.dosya_no, d.musteri_turu, d.vefat_isareti FROM musteri_faturasi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.durum IN ('Faturalandı', 'Kısmi Tahsil') AND f.vade IS NOT NULL`);
  const BAS: [string, number, string][] = [['24 Saat', 1, TICARI], ['15 Gün', 15, 'Ticari İşler Direktörü'], ['30 Gün', 30, 'Genel Müdür Yardımcısı'], ['60 Gün', 60, 'CEO']];
  for (const f of rows) {
    const gecen = (simdi.getTime() - new Date(f.vade).getTime()) / 86_400_000;
    if (f.vefat_isareti) { if (gecen >= 1 && await birKez(db, 'vefat_askisi', f.kimlik)) await kartAc(db, { tur: 'Vefat Alacak Askısı', kategori: 'islem', baslik: `${f.dosya_no} · Alacak Vefat Askısında`, sahipRol: await rolId(db, 'Hukuk ve Uyum Direktörü'), nesneTuru: 'Fatura', nesneKimligi: f.kimlik }); continue; }
    for (const [ad, g, rol] of BAS) {
      if (gecen < g) continue;
      const r = await db.query(`INSERT INTO alacak_takip_adimi (fatura_ref, basamak, sorumlu_rol) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING kimlik`, [f.kimlik, ad, rol]);
      if (!r.rowCount) continue;
      if (g === 60) { await alacakYoluAc(db, { kimlik: f.kimlik, dosya_ref: f.dosya_ref, dosya_no: f.dosya_no, musteri_turu: f.musteri_turu, kalan: R2(Number(f.toplam_eur) - Number(f.tahsil_edilen_eur)) }); n++; continue; } // YG-912
      if (g === 1 && f.musteri_turu === 'Sigorta Şirketi') { // D-040: sigortaya ihtar gitmez, hatırlatma e-postası (BLD-75)
        const sg = (await db.query(`SELECT t.eposta, s.sigortaci_adi FROM dosya_sigorta_kaydi s JOIN dosya_tarafi t ON t.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1`, [f.dosya_ref])).rows[0];
        if (sg?.eposta && f.fatura_no) await sigortayaHazirla(db, { dosya: f.dosya_ref, tur: 'BLD-75', nesne: f.kimlik, alici: sg.eposta, konu: `${f.dosya_no} Ödeme Hatırlatması`, metin: await metinGetir(db, 'BLD-75', 'tr', { Kurum: sg.sigortaci_adi ?? '', 'Dosya No': f.dosya_no, 'fatura no': f.fatura_no, vade: gunAy(f.vade), tutar: tutar(Number(f.toplam_tl ?? 0)) }) });
      }
      if (g === 1 && f.musteri_turu !== 'Sigorta Şirketi') { // YG-897, D-194: vade ertesi gün Ödeme Hatırlatması (BLD-28)
        const yt = (await db.query(`SELECT t.telefon, t.eposta, d.yazisma_dili FROM dosya d JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE d.kimlik = $1 LIMIT 1`, [f.dosya_ref])).rows[0];
        if (yt) await yatTarafinaYaz(db, { olay: `bld28:${f.kimlik}`, kod: 'BLD-28', dil: dilKod(yt.yazisma_dili), konu: `${f.dosya_no} Ödeme Hatırlatması`, telefon: yt.telefon, eposta: yt.eposta, alanlar: { 'Dosya No': f.dosya_no, 'File No': f.dosya_no, vade: gunAy(f.vade), 'due date': gunAy(f.vade), 'bağlantı': webAdresi, link: webAdresi } });
      }
      await kartAc(db, { tur: 'Alacak Takibi', kategori: 'islem', baslik: `${f.dosya_no} · Alacak Takibi: ${ad}`, ozet: f.musteri_turu === 'Sigorta Şirketi' ? 'Sigorta şirketine yazılı ihtar gönderilmez; muhatabı arayınız.' : f.proforma_no, oncelik: g >= 30 ? 'Yüksek' : 'Normal', sahipRol: await rolId(db, rol), nesneTuru: 'Fatura', nesneKimligi: f.kimlik });
      n++;
    }
  }
  n += await krediUyarilari(db);
  // YG-908: 30 günü aşan açık avans için erken uyarı.
  for (const a of (await db.query(`SELECT o.kimlik, o.tutar_eur, d.dosya_no FROM odeme_talebi o JOIN dosya d ON d.kimlik = o.dosya_ref WHERE o.tur = 'Avans' AND o.durum = 'Gönderildi' AND o.olusturma_zamani < $1::timestamptz - interval '30 days'`, [simdi])).rows) {
    if (await birKez(db, 'acik_avans_30', a.kimlik)) { await kartAc(db, { tur: 'Açık Avans', kategori: 'islem', baslik: `${a.dosya_no} · 30 Günü Aşan Açık Avans`, ozet: `${tutar(Number(a.tutar_eur))} EUR`, oncelik: 'Yüksek', sahipRol: await rolId(db, MFM), nesneTuru: 'Ödeme Talebi', nesneKimligi: a.kimlik }); n++; }
  }
  return n;
}

let webAdresi = '';
/** YG-897: Ödeme Alındı (BLD-27); sigortaya ve vefat işaretli dosyaya gitmez. */
async function odemeAlindi(c: Db, dosya: string, muhatap: string, tarih: string) {
  if (muhatap === 'Sigorta Şirketi') return;
  const d = (await c.query(`SELECT d.dosya_no, d.yazisma_dili, d.vefat_isareti, t.telefon, t.eposta FROM dosya d LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE d.kimlik = $1 LIMIT 1`, [dosya])).rows[0];
  if (!d || d.vefat_isareti || (!d.telefon && !d.eposta)) return;
  await yatTarafinaYaz(c, { olay: `bld27:${dosya}:${tarih}:${Math.random()}`, kod: 'BLD-27', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Ödemeniz Alındı`, telefon: d.telefon, eposta: d.eposta, alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, tarih: gunAy(tarih), date: gunAy(tarih), 'bağlantı': webAdresi, link: webAdresi } });
}


kapanisKaydet('Ödeme Talebi', async (c, k, karar) => {
  const t = (await c.query(`SELECT o.*, d.dosya_no, d.yazisma_dili, d.vefat_isareti FROM odeme_talebi o JOIN dosya d ON d.kimlik = o.dosya_ref WHERE o.kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Reddet') { await c.query(`UPDATE odeme_talebi SET durum = 'Reddedildi' WHERE kimlik = $1`, [t.kimlik]); return; }
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE odeme_talebi SET durum = 'Gönderildi' WHERE kimlik = $1`, [t.kimlik]);
  await belgeUret(c, { tur: 'Ödeme Talebi', nesne: t.kimlik, dosya: t.dosya_ref });
  const y = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [t.dosya_ref])).rows[0];
  if (y && !t.vefat_isareti && t.muhatap !== 'Sigorta Şirketi') await yatTarafinaYaz(c, { olay: `bld26:${t.kimlik}`, kod: 'BLD-26', dil: dilKod(t.yazisma_dili), konu: `${t.dosya_no} Ödeme Talebi`, telefon: y.telefon, eposta: y.eposta, alanlar: { 'Dosya No': t.dosya_no, 'File No': t.dosya_no, 'ödeme türü': t.tur, 'payment type': t.tur, 'son tarih': gunAy(t.son_tarih), 'due date': gunAy(t.son_tarih), 'bağlantı': webAdresi, link: webAdresi } });
});

kapanisKaydet('Proforma', async (c, k, karar) => {
  if (karar === 'Onayla') { const f = (await c.query(`UPDATE musteri_faturasi SET durum = 'Proforma' WHERE kimlik = $1 RETURNING dosya_ref`, [k.nesne_kimligi])).rows[0]; await belgeUret(c, { tur: 'Proforma', nesne: k.nesne_kimligi!, dosya: f.dosya_ref }); }
  else if (karar === 'Reddet') await c.query(`UPDATE musteri_faturasi SET durum = 'Reddedildi' WHERE kimlik = $1`, [k.nesne_kimligi]);
});

kapanisKaydet('Firma Ödeme Talimatı', async (c, k, karar) => {
  const t = (await c.query(`SELECT kimlik, hakedis_ref FROM odeme_talimati WHERE kimlik = $1::uuid`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Onayla') await c.query(`UPDATE odeme_talimati SET durum = 'Onaylandı' WHERE kimlik = $1`, [t.kimlik]);
  else if (karar === 'Reddet') { await c.query(`UPDATE odeme_talimati SET durum = 'Reddedildi' WHERE kimlik = $1`, [t.kimlik]); await c.query(`UPDATE hakedis SET statu = 'Doğrulandı' WHERE kimlik = $1`, [t.hakedis_ref]); await c.query(`UPDATE hakedis_mahsubu m SET kalan_eur = m.kalan_eur + x.tutar_eur FROM talimat_mahsubu x WHERE x.mahsup_ref = m.kimlik AND x.talimat_ref = $1`, [t.kimlik]); }
});

kapanisKaydet('Teslim İstisnası', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE dosya SET teslim_istisnasi = true WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

kapanisKaydet('İzin Talebi', async (c, k, karar) => {
  const t = (await c.query(`SELECT * FROM izin_talebi WHERE kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Onayla') {
    await c.query(`UPDATE izin_talebi SET durum = 'Onaylandı' WHERE kimlik = $1`, [t.kimlik]);
    if (t.izin_turu === 'Yıllık') await c.query(`UPDATE izin_bakiyesi SET kullanilan = kullanilan + $3 WHERE personel_ref = $1 AND yil = $2`, [t.personel_ref, new Date(t.baslangic).getUTCFullYear(), t.gun]);
  } else if (karar === 'Reddet') await c.query(`UPDATE izin_talebi SET durum = 'Reddedildi' WHERE kimlik = $1`, [t.kimlik]);
});

kapanisKaydet('Masraf Fişi', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE personel_masraf_fisi SET durum = 'Onaylandı' WHERE kimlik = $1`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE personel_masraf_fisi SET durum = 'Reddedildi' WHERE kimlik = $1`, [k.nesne_kimligi]);
});

// YG-067: Teknik Kapalı'dan Kapalı'ya tahsilat ve firma ödemesi tamamlanınca geçilir.
kapanisKapisi(async (db, d, cikis) => {
  if (cikis !== 'Kapalı') return null;
  if ((await db.query(`SELECT 1 FROM musteri_faturasi WHERE dosya_ref = $1 AND durum NOT IN ('Tahsil Edildi', 'Reddedildi') LIMIT 1`, [d.kimlik])).rowCount) return 'Tahsilat Bekliyor';
  if ((await db.query(`SELECT 1 FROM hakedis WHERE dosya_ref = $1 AND statu NOT IN ('Ödendi', 'Reddedildi') LIMIT 1`, [d.kimlik])).rowCount) return 'Firma Ödemesi Bekliyor';
  return null;
});

onaySonucKaydet('ONY-27', async (c, t, karar, k) => {
  if (karar !== 'Onaylandı') return;
  // YG-475, YG-414: Kabul veya Koşullu Kabul (çekinceli); çekince kayda geçer.
  const ts = (await c.query(`UPDATE teslim_kaydi SET durum = 'Teslim Edildi', teslim_alan = $2, teslim_zamani = $3, alici_turu = 'Yat Sahibi', karar = $4, cekince = $5 WHERE dosya_ref = $1 AND durum = 'Onay Bekliyor' RETURNING kimlik`, [t.dosya_ref, t.alici_ad, k.zaman, k.form?.teslimKarar === 'Koşullu Kabul' ? 'Koşullu Kabul' : 'Kabul', k.form?.cekince?.trim() || null])).rows[0];
  if (ts) await belgeUret(c, { tur: 'Teslim Tutanağı', nesne: ts.kimlik, dosya: t.dosya_ref });
  await tesisSerbestBirak(c, t.dosya_ref, t.alici_ad); // YG-554
});

/**
 * YG-928, A38-S1: hesap karantinada başlar; FY Müdür Yardımcısı kontrol eder, FY Müdürü birinci, MF Müdürü ikinci onayı verir.
 * Geri arama teyidini MF Müdür Yardımcısı ayrıca yapar; teyit olmadan son onay verilmez. Önceki hesap silinmez.
 */
export async function bankaHesabiAc(c: PoolClient, g: { kurulus: string; iban: string; giren: string }): Promise<string> {
  const temiz = g.iban.replace(/\s/g, '').toUpperCase();
  const u = (await c.query(`SELECT ticari_unvan FROM kurulus WHERE kimlik = $1`, [g.kurulus])).rows[0];
  const r = (await c.query(`INSERT INTO banka_hesabi (kurulus_ref, iban, giren_ref) VALUES ($1,$2,$3) RETURNING kimlik`, [g.kurulus, temiz, g.giren])).rows[0];
  const rol = (ad: string) => rolId(c, ad);
  await kartAc(c, { tur: 'Banka Hesabı Onayı', baslik: `${u.ticari_unvan} · Banka Hesabı Onayı`, ozet: temiz, hazirlayan: g.giren, zincir: [await rol('Firma Yönetimi Müdür Yardımcısı'), await rol('Firma Yönetimi Müdürü'), await rol('Muhasebe ve Finans Müdürü')], nesneTuru: 'Banka Hesabı', nesneKimligi: r.kimlik });
  await kartAc(c, { tur: 'Banka Geri Arama Teyidi', kategori: 'gorev', baslik: `${u.ticari_unvan} · Banka Hesabı Geri Arama`, ozet: 'Sicildeki kayıtlı numaradan geri arayarak teyit etmenizi rica ederiz.', oncelik: 'Yüksek', sahipRol: await rol('Muhasebe ve Finans Müdür Yardımcısı'), nesneTuru: 'Banka Hesabı', nesneKimligi: r.kimlik });
  return r.kimlik;
}

kapanisKaydet('Banka Hesabı Onayı', async (c, k, karar, yapan) => {
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return; // ara kademe geçişi kaydı değiştirmez
  const h = (await c.query(`SELECT * FROM banka_hesabi WHERE kimlik = $1 AND durum = 'Karantina' FOR UPDATE`, [k.nesne_kimligi])).rows[0];
  if (!h) return;
  if (karar === 'Onayla') {
    if (!h.teyit_eden_ref) throw Object.assign(new Error('Muhasebe ve Finans Müdür Yardımcısının geri arama teyidi bekleniyor.'), { statusCode: 409 });
    if (h.teyit_eden_ref === yapan) throw Object.assign(new Error('Geri arama teyidini veren kişi son onayı veremez.'), { statusCode: 403 });
    await c.query(`UPDATE banka_hesabi SET durum = 'İptal' WHERE kurulus_ref = $1 AND durum = 'Geçerli'`, [h.kurulus_ref]);
    await c.query(`UPDATE banka_hesabi SET durum = 'Geçerli', onaylayan_ref = $2 WHERE kimlik = $1`, [h.kimlik, yapan]);
  } else {
    await c.query(`UPDATE banka_hesabi SET durum = 'İptal' WHERE kimlik = $1`, [h.kimlik]);
    await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Banka Geri Arama Teyidi' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı'`, [h.kimlik]);
  }
  const kisiler = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [h.kurulus_ref])).rows.map((r) => r.kullanici_ref as string);
  await bildir(c, { olay: `banka-sonuc:${h.kimlik}`, kullanicilar: kisiler, baslik: 'Banka Hesabı', ozet: karar === 'Onayla' ? 'Bildirdiğiniz banka hesabı teyit edildi.' : 'Bildirdiğiniz banka hesabı kabul edilmedi; Sicil Sorumlusu ile görüşmenizi rica ederiz.' });
});

export function ticariYollari(s: FastifyInstance, b: Baglam) {
  webAdresi = b.webAdresi;
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const roller = async (k: string) => (await b.db.query(`SELECT r.rol_adi FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);
  const ticariMi = async (k: string) => (await roller(k)).includes(TICARI);
  const teklifGetir = async (id: string, k: string) => {
    if (!UUID.test(id)) return undefined;
    const t = (await b.db.query(`SELECT f.*, d.dosya_no, d.musteri_turu, d.oncelik, d.yazisma_dili FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.kimlik = $1`, [id])).rows[0];
    return t && await dosyaErisimi(b.db, k, t.dosya_ref) ? t : undefined;
  };

  // YG-906, YG-907, YG-1474, YG-1493: ödeme talebini Ticari Sorumlu hazırlar; MF Müdürü kontrol → limite göre son makam. Bireyselde avans erken ifa onayından sonra.
  s.post('/teklif/:id/odeme-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { tur?: string; tutar?: number; sonTarih?: string };
    if (!t) return yok(y);
    if (!(await ticariMi(o.kullanici))) return y.code(403).send({ hata: 'Ödeme talebini Ticari Sorumlu hazırlar.' });
    if (!['Avans', 'Ara Ödeme', 'Nihai', 'Parça', 'Acil Tedbir Bedeli'].includes(g.tur ?? '')) return y.code(400).send({ hata: 'Ödeme türünü seçiniz.' });
    if (t.statu !== 'Karar' || !['Tam Onay', 'Kısmi Onay', 'Koşullu Onay'].includes(t.karar)) return y.code(409).send({ hata: 'Ödeme talebi onaylı teklife dayanır.' });
    if (!g.sonTarih) return y.code(400).send({ hata: 'Son ödeme tarihini giriniz.' });
    let tut = Number(g.tutar);
    if (g.tur === 'Avans') {
      const c = (await b.db.query(`SELECT erken_ifa_onayi, cayma_bitis FROM on_bilgilendirme_cayma_kaydi WHERE teklif_ref = $1`, [t.kimlik])).rows[0];
      if (c && !c.erken_ifa_onayi && new Date(c.cayma_bitis) > new Date()) return y.code(409).send({ hata: 'Erken başlama onayı yokken cayma süresinde avans istenmez.' });
      tut = avansHesapla(t.musteri_turu, Number(t.genel_toplam_eur), t.oncelik === 'Kritik', await parametre(b.db, 'avans_orani'), await parametre(b.db, 'sigorta_avans_esik_eur'));
      if (await yurtDisiMi(b.db, t.dosya_ref)) tut = await yurtDisiAvans(b.db, t.kimlik, Number(t.genel_toplam_eur), await parametre(b.db, 'avans_orani')); // YG-1461
      if (tut === 0) return y.code(409).send({ hata: 'Bu dosyada avans alınmaz; ayrıca talep gerekmez.' });
    } else if (!(tut > 0)) return y.code(400).send({ hata: 'Tutar geçersiz.' });
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO odeme_talebi (dosya_ref, teklif_ref, tur, tutar_eur, muhatap, son_tarih, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [t.dosya_ref, t.kimlik, g.tur, tut, t.teklif_muhatabi, g.sonTarih, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Ödeme Talebi', baslik: `${t.dosya_no} · ${g.tur} Ödeme Talebi`, ozet: `${tutar(tut)} EUR`, hazirlayan: o.kullanici, zincir: await parasalZincir(c, [MFM], await sonMakam(c, tut)), nesneTuru: 'Ödeme Talebi', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, tutar: tut };
    });
  });

  // YG-884, YG-885, YG-888: proforma; LGM fatura numarası üretmez. Kalemler yalnız onaylı olanlardan; sigorta ve yat sahibi ayrı.
  s.post('/teklif/:id/proforma', oturumlu, async (i, y) => {
    const o = i.oturum!; const t = await teklifGetir((i.params as { id: string }).id, o.kullanici);
    if (!t) return yok(y);
    if (!(await ticariMi(o.kullanici))) return y.code(403).send({ hata: 'Proformayı Ticari Sorumlu hazırlar.' });
    if (t.statu !== 'Karar' || !['Tam Onay', 'Kısmi Onay', 'Koşullu Onay'].includes(t.karar)) return y.code(409).send({ hata: 'Proforma onaylı teklife dayanır.' });
    if ((await b.db.query(`SELECT 1 FROM musteri_faturasi WHERE teklif_ref = $1 AND durum <> 'Reddedildi'`, [t.kimlik])).rowCount) return y.code(409).send({ hata: 'Bu teklifin proforması vardır; mevcut proformayı kullanmanızı rica ederiz.' }); // YG-886
    if (t.teklif_muhatabi === 'Sigorta Şirketi' && !(await b.db.query(`SELECT 1 FROM dosya_sigorta_kaydi WHERE dosya_ref = $1 AND sigorta_hasar_dosya_no IS NOT NULL`, [t.dosya_ref])).rowCount) return y.code(409).send({ hata: 'Sigortaya fatura için Hasar dosya numarası bekleniyor.' }); // YG-451
    const hk = Number((await b.db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu = 'Onaylandı'`, [t.kimlik])).rows[0].t);
    const indirim = Number(t.ara_toplam_eur) > 0 ? R2((hk * Number(t.indirim_tutari_eur)) / Number(t.ara_toplam_eur)) : 0;
    const matrah = R2(hk - indirim - Number(t.kesif_mahsubu_eur));
    // YG-878, YG-881: KDV durumu sistemce belirlenir; istisnada yalnız parça ve malzeme KDV'li kalır.
    const malz = Number((await b.db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu = 'Onaylandı' AND bedel_turu = 'Malzeme'`, [t.kimlik])).rows[0].t);
    const malzNet = hk > 0 ? R2(malz - (malz * indirim) / hk) : 0;
    const ks = await kdvBelirle(b.db, t.dosya_ref, t.teklif_muhatabi); const kh = kdvHesapla(matrah, malzNet, Number(t.kdv_orani), ks); const kdv = kh.kdv;
    return islem(async (c) => {
      const no = await altNumara(c, t.dosya_no, 'OT');
      const r = (await c.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, kdv_durumu, kdv_orani, kdv_matrahi_eur, tevkifat_orani, tevkifat_eur, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING kimlik`, [no, t.dosya_ref, t.kimlik, t.teklif_muhatabi, matrah, kdv, kh.toplam, ks.durum, t.kdv_orani, kh.taban, ks.tevkifat ? `${ks.tevkifat.pay}/${ks.tevkifat.payda}` : null, kh.tevkifat, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Proforma', baslik: `${no} · Proforma Onayı`, ozet: `${tutar(matrah)} EUR (KDV hariç)`, hazirlayan: o.kullanici, zincir: await parasalZincir(c, [MFM], await sonMakam(c, matrah)), nesneTuru: 'Fatura', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, proformaNo: no, kdvHaric: matrah, kdv, toplam: kh.toplam, kdvDurumu: ks.durum };
    });
  });

  const fatura = async (id: string, k: string) => {
    if (!UUID.test(id)) return undefined;
    const f = (await b.db.query(`SELECT m.*, d.dosya_no, d.musteri_turu, d.yazisma_dili, d.vefat_isareti FROM musteri_faturasi m JOIN dosya d ON d.kimlik = m.dosya_ref WHERE m.kimlik = $1`, [id])).rows[0];
    return f && await dosyaErisimi(b.db, k, f.dosya_ref) ? f : undefined;
  };
  s.post('/fatura/:id/muhasebeye', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await fatura((i.params as { id: string }).id, o.kullanici);
    if (!f) return yok(y);
    if (!(await ticariMi(o.kullanici))) return y.code(403).send({ hata: 'Bu işlem Ticari Sorumluya aittir.' });
    if (f.durum !== 'Proforma') return y.code(409).send({ hata: 'Önce proforma onaylanmalıdır.' });
    await b.db.query(`UPDATE musteri_faturasi SET durum = 'Muhasebeye İletildi' WHERE kimlik = $1`, [f.kimlik]);
    return { durum: 'Muhasebeye İletildi' };
  });
  // YG-875, YG-884, YG-900, K-193: fatura no, tarih ve kuru muhasebeden gelince Ticari Sorumlu girer; kur önceki iş günü TCMB satış; TL tutar nihai; vade sigortada 30 gün.
  s.post('/fatura/:id/bilgi', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await fatura((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { no?: string; tarih?: string; kur?: number; kurTarihi?: string };
    if (!f) return yok(y);
    if (!(await ticariMi(o.kullanici))) return y.code(403).send({ hata: 'Fatura bilgisini Ticari Sorumlu girer.' });
    if (f.durum !== 'Muhasebeye İletildi') return y.code(409).send({ hata: 'Proforma önce muhasebeye iletilmelidir.' });
    if (!g.no?.trim() || !g.tarih || !(Number(g.kur) > 0) || !g.kurTarihi) return y.code(400).send({ hata: 'Fatura no, tarih, kur ve kur tarihi zorunludur.' });
    if (g.kurTarihi >= g.tarih) return y.code(400).send({ hata: 'Kur, fatura tarihinden önceki iş gününün TCMB satış kurudur.' });
    if ((await b.db.query(`SELECT 1 FROM musteri_faturasi WHERE fatura_no = $1`, [g.no.trim()])).rowCount) return y.code(409).send({ hata: 'Bu fatura numarası kayıtlıdır.' });
    const vadeGun = f.muhatap === 'Sigorta Şirketi' ? await parametre(b.db, 'sigorta_vade_gun') : 0;
    const vade = new Date(`${g.tarih}T12:00:00Z`); vade.setUTCDate(vade.getUTCDate() + vadeGun);
    // YG-874: KDV TL matrah üzerinden hesaplanır.
    const matrahTl = R2(Number(f.kdv_haric_eur) * Number(g.kur)); const oranK = f.kdv_orani === null ? (Number(f.kdv_haric_eur) > 0 ? (Number(f.kdv_eur) / Number(f.kdv_haric_eur)) * 100 : 0) : Number(f.kdv_orani);
    const kdvTl = R2((R2(Number(f.kdv_matrahi_eur ?? f.kdv_haric_eur) * Number(g.kur)) * oranK) / 100);
    const tevTl = Number(f.kdv_eur) > 0 ? R2((kdvTl * Number(f.tevkifat_eur)) / Number(f.kdv_eur)) : 0;
    const tl = R2(matrahTl + kdvTl - tevTl);
    await b.db.query(`UPDATE musteri_faturasi SET durum = 'Faturalandı', fatura_no = $2, fatura_tarihi = $3, kur = $4, kur_tarihi = $5, toplam_tl = $6, vade = $7, kdv_tl = $8 WHERE kimlik = $1`, [f.kimlik, g.no.trim(), g.tarih, g.kur, g.kurTarihi, tl, vade.toISOString().slice(0, 10), kdvTl]);
    // YG-421, K-193: firmaya Fatura Düzenleme Bildirimi (BLD-80).
    for (const e of (await b.db.query(`SELECT e.kimlik, e.is_emri_no, e.kurulus_ref, coalesce((SELECT sum(h.bu_donem_brut) FROM hakedis h WHERE h.is_emri_ref = e.kimlik AND h.statu <> 'Reddedildi'), e.firma_bedeli_eur) AS tutar FROM is_emri e WHERE e.dosya_ref = $1 AND e.statu NOT IN ('İptal', 'Yerine Geçti', 'Taslak')`, [f.dosya_ref])).rows) {
      if (!(Number(e.tutar) > 0)) continue;
      const kisi = (await b.db.query(`SELECT u.kullanici_ref, h.e_posta FROM kurulus_kullanici u JOIN kullanici_hesabi h ON h.kimlik = u.kullanici_ref WHERE u.kurulus_ref = $1`, [e.kurulus_ref])).rows;
      const metin = await metinGetir(b.db, 'BLD-80', 'tr', { 'İş Emri No': e.is_emri_no, tarih: gunAy(g.tarih), 'kur tarihi': gunAy(g.kurTarihi), kur: String(g.kur).replace('.', ','), tutar: tutar(Number(e.tutar)), 'bağlantı': webAdresi });
      await bildir(b.db, { olay: `bld80:${f.kimlik}:${e.kimlik}`, kullanicilar: kisi.map((x) => x.kullanici_ref), baslik: `${e.is_emri_no} · Fatura Düzenleme Bildirimi`, ozet: metin });
      for (const x of kisi) if (x.e_posta) await disGonder(b.db, { olay: `bld80:${f.kimlik}:${e.kimlik}:${x.kullanici_ref}`, eposta: x.e_posta, konu: `${e.is_emri_no} Fatura Düzenleme Bildirimi`, metin });
    }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Fatura Bilgisi Girildi', nesneTuru: 'Fatura', nesneKimligi: f.kimlik, yeni: { no: g.no, kur: g.kur, tl }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { toplamTl: tl, vade: vade.toISOString().slice(0, 10) };
  });

  // YG-903, YG-904, YG-1460: havale, POS, ödeme bağlantısı; çek/senet yok; kısmi tahsilat; kart üst sınırı 20.000,00 EUR.
  s.post('/tahsilat', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { fatura?: string; odemeTalebi?: string; tutar?: number; tarih?: string; kanal?: string; referans?: string; ucuncuKisi?: string };
    if (!(await ticariMi(o.kullanici))) return y.code(403).send({ hata: 'Tahsilatı Ticari Sorumlu kaydeder.' });
    if (!['Havale', 'POS', 'Ödeme Bağlantısı'].includes(g.kanal ?? '')) return y.code(400).send({ hata: 'Ödeme kanalını havale, POS veya ödeme bağlantısı olarak seçmenizi rica ederiz.' });
    if (!(Number(g.tutar) > 0) || !g.tarih) return y.code(400).send({ hata: 'Tutar ve tarih zorunludur.' });
    if (g.kanal !== 'Havale' && Number(g.tutar) > 20000) return y.code(400).send({ hata: '20.000,00 EUR karşılığı üzerindeki tahsilatta havale kullanmanızı rica ederiz.' });
    if (g.ucuncuKisi) { // YG-916: üçüncü kişi ödemesi onaylı kayda bağlıdır
      const u = UUID.test(g.ucuncuKisi) ? (await b.db.query(`UPDATE ucuncu_kisi_odeme SET durum = 'Kullanıldı' WHERE kimlik = $1 AND durum = 'Onaylandı' AND tutar_eur >= $2 RETURNING kimlik`, [g.ucuncuKisi, g.tutar])).rows[0] : undefined;
      if (!u) return y.code(409).send({ hata: 'Üçüncü kişi ödemesi için onay bekleniyor.' });
    }
    return islem(async (c) => {
      if (g.fatura) {
        const f = (await c.query(`SELECT * FROM musteri_faturasi WHERE kimlik = $1 FOR UPDATE`, [g.fatura])).rows[0];
        if (!f || !['Faturalandı', 'Kısmi Tahsil'].includes(f.durum)) throw Object.assign(new Error('Tahsilat faturalanmış kayda girilir.'), { statusCode: 409 });
        const yeni = R2(Number(f.tahsil_edilen_eur) + Number(g.tutar));
        if (yeni > Number(f.toplam_eur)) throw Object.assign(new Error('Tahsilat fatura tutarının üzerindedir; fazla ödeme iade akışından yürütülür.'), { statusCode: 409 });
        await c.query(`INSERT INTO tahsilat (fatura_ref, dosya_ref, tutar_eur, tarih, kanal, referans, giren_ref, ucuncu_kisi_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [f.kimlik, f.dosya_ref, g.tutar, g.tarih, g.kanal, g.referans ?? null, o.kullanici, g.ucuncuKisi ?? null]);
        const durum = yeni === Number(f.toplam_eur) ? 'Tahsil Edildi' : 'Kısmi Tahsil';
        await c.query(`UPDATE musteri_faturasi SET tahsil_edilen_eur = $2, durum = $3 WHERE kimlik = $1`, [f.kimlik, yeni, durum]);
        await odemeAlindi(c, f.dosya_ref, f.muhatap, g.tarih!);
        return { durum, kalan: R2(Number(f.toplam_eur) - yeni) };
      }
      const t = g.odemeTalebi ? (await c.query(`SELECT * FROM odeme_talebi WHERE kimlik = $1 FOR UPDATE`, [g.odemeTalebi])).rows[0] : undefined;
      if (!t || t.durum !== 'Gönderildi') throw Object.assign(new Error('Ödeme talebi bulunamadı.'), { statusCode: 404 });
      await c.query(`INSERT INTO tahsilat (odeme_talebi_ref, dosya_ref, tutar_eur, tarih, kanal, referans, giren_ref, ucuncu_kisi_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [t.kimlik, t.dosya_ref, g.tutar, g.tarih, g.kanal, g.referans ?? null, o.kullanici, g.ucuncuKisi ?? null]);
      const top = Number((await c.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM tahsilat WHERE odeme_talebi_ref = $1`, [t.kimlik])).rows[0].t);
      if (top >= Number(t.tutar_eur)) await c.query(`UPDATE odeme_talebi SET durum = 'Ödendi' WHERE kimlik = $1`, [t.kimlik]);
      await odemeAlindi(c, t.dosya_ref, t.muhatap, g.tarih!);
      return { durum: top >= Number(t.tutar_eur) ? 'Ödendi' : 'Kısmi', kalan: R2(Math.max(0, Number(t.tutar_eur) - top)) };
    });
  });

  // YG-087, YG-216, YG-1434: teslim kilidi; istisna GMY. Bireyselde tüm bakiye. ONY-27 yat sahibine.
  s.get('/dosya/:id/teslim-durumu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return { engel: await teslimEngeli(b.db, id) };
  });
  s.post('/dosya/:id/teslim-istisnasi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { gerekce } = (i.body ?? {}) as { gerekce?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    const d = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    await kartAc(b.db, { tur: 'Teslim İstisnası', baslik: `${d.dosya_no} · Teslim İstisnası`, ozet: gerekce.trim(), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Genel Müdür Yardımcısı')], nesneTuru: 'Dosya', nesneKimligi: id });
    return { durum: 'Onaya Gönderildi' };
  });
  s.post('/dosya/:id/teslim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT d.*, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [id])).rows[0];
    if (d.asama !== 'Teslim') return y.code(409).send({ hata: 'Dosya Teslim aşamasında değildir.' });
    const engel = await teslimEngeli(b.db, id);
    if (engel) return y.code(409).send({ hata: engel });
    const sah = (await b.db.query(`SELECT kimlik, kisi_adi_soyadi, telefon, eposta, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [id])).rows[0];
    if (!sah) return y.code(409).send({ hata: 'Yat sahibi kaydı yoktur.' });
    return islem(async (c) => {
      const dil = dilKod(d.yazisma_dili);
      const s0 = (await c.query(`SELECT metin FROM sablon_metni WHERE kod = 'ONY-27' AND dil = $1 AND durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1`, [dil])).rows[0];
      const zaman = new Date().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
      const alan = { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, 'bağlantı': b.webAdresi, link: b.webAdresi, Yat: d.yat_adi, Yacht: d.yat_adi, 'tarih saat': zaman, 'date time': zaman };
      const kut = kutuAyikla(s0.metin).kutular.map((k) => ({ ad: k.replace(/\[([^\]]+)\]/g, (_t, a: string) => (alan as Record<string, string>)[a] ?? a), zorunlu: true }));
      await c.query(`INSERT INTO teslim_kaydi (dosya_ref, teslim_eden_ref) VALUES ($1,$2)`, [id, o.kullanici]);
      await onayTalebiAc(c, { dosya: id, ony: 'ONY-27', dil, alanlar: alan, baslikAlanlari: alan, kutular: kut, formTuru: 'Teslim Kararı', taraf: sah.kimlik, kullanici: sah.kullanici_ref, aliciAd: sah.kisi_adi_soyadi, telefon: sah.telefon, eposta: sah.eposta, belgeAdi: 'Teslim Tutanağı', hazirlayan: o.kullanici, gun: 7, webAdresi: b.webAdresi });
      return { durum: 'Teslim Onayı Bekleniyor' };
    });
  });

  const firmam = async (k: string) => (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;

  // YG-835, YG-836, YG-838: firma hakediş girer; kanıt zorunlu ve tek; kümülatif iş emri bedelini aşamaz; kesinti sistemce.
  s.post('/firma-portal/is-emri/:id/hakedis', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { brut?: number; belge?: string; faturaNo?: string; faturaTarihi?: string; faturaKuru?: number };
    const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT e.*, d.dosya_no FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kimlik = $1 AND e.kurulus_ref = $2`, [id, f])).rows[0];
    if (!e) return yok(y);
    if (!(Number(g.brut) > 0)) return y.code(400).send({ hata: 'Tutar geçersiz.' });
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Hakediş için Gerçekleşme kanıtını eklemenizi rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM hakedis WHERE kanit_belge_ref = $1`, [g.belge])).rowCount) return y.code(409).send({ hata: 'Aynı kanıt daha önce kullanılmıştır; bu dönemin kanıtını eklemenizi rica ederiz.' });
    return islem(async (c) => {
      const kum = Number((await c.query(`SELECT coalesce(sum(bu_donem_brut), 0) t FROM hakedis WHERE is_emri_ref = $1 AND statu <> 'Reddedildi'`, [id])).rows[0].t);
      const bedel = Number(e.firma_bedeli_eur ?? 0);
      if (R2(kum + Number(g.brut)) > bedel) throw Object.assign(new Error('Kümülatif tutar iş emri bedelini aşıyor; değişiklik onayı gereklidir.'), { statusCode: 409 });
      const kes = hakedisKesintisi(Number(g.brut), bedel, await parametre(c, 'hakedis_kesinti_esik_eur'), await parametre(c, 'hakedis_kesinti_orani'));
      const no = await altNumara(c, e.dosya_no, 'HK');
      const sira = (await c.query(`SELECT coalesce(max(sira_no), 0) + 1 n FROM hakedis WHERE is_emri_ref = $1`, [id])).rows[0].n;
      const r = (await c.query(`INSERT INTO hakedis (hakedis_no, is_emri_ref, dosya_ref, sira_no, bu_donem_brut, kumulatif, kesinti, net, kanit_belge_ref, firma_fatura_no, firma_fatura_tarihi, firma_fatura_kuru, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING kimlik`, [no, id, e.dosya_ref, sira, g.brut, R2(kum + Number(g.brut)), kes, R2(Number(g.brut) - kes), g.belge, g.faturaNo ?? null, g.faturaTarihi || null, Number(g.faturaKuru) > 0 ? g.faturaKuru : null, o.kullanici])).rows[0];
      return { kimlik: r.kimlik, hakedisNo: no, kesinti: kes, net: R2(Number(g.brut) - kes) };
    });
  });
  // YG-846, K-193: firma, fatura düzenleme bildiriminden sonra fatura no, tarih ve kuru girer.
  s.post('/firma-portal/hakedis/:id/fatura', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { no?: string; tarih?: string; kur?: number };
    const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    const h = (await b.db.query(`SELECT h.statu FROM hakedis h JOIN is_emri e ON e.kimlik = h.is_emri_ref WHERE h.kimlik = $1 AND e.kurulus_ref = $2`, [id, f])).rows[0];
    if (!h) return yok(y);
    if (!['Doğrulama Bekliyor', 'Doğrulandı'].includes(h.statu)) return y.code(409).send({ hata: 'Bu aşamada fatura bilgisi değiştirilemez.' });
    if (!g.no?.trim() || !g.tarih || !(Number(g.kur) > 0)) return y.code(400).send({ hata: 'Fatura no, tarih ve kuru girmenizi rica ederiz.' });
    await b.db.query(`UPDATE hakedis SET firma_fatura_no = $2, firma_fatura_tarihi = $3, firma_fatura_kuru = $4 WHERE kimlik = $1`, [id, g.no.trim(), g.tarih, g.kur]);
    return { tamam: true };
  });
  // YG-834: Saha Sorumlusu, atanmamışsa Dosya Sorumlusu doğrular.
  s.post('/hakedis/:id/dogrula', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { karar } = (i.body ?? {}) as { karar?: string };
    if (!UUID.test(id)) return yok(y);
    const h = (await b.db.query(`SELECT * FROM hakedis WHERE kimlik = $1`, [id])).rows[0];
    if (!h || !(await dosyaErisimi(b.db, o.kullanici, h.dosya_ref))) return yok(y);
    const saha = (await b.db.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Saha Sorumlusu' AND bitis_zamani IS NULL LIMIT 1`, [h.dosya_ref])).rows[0];
    const ds = (await b.db.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [h.dosya_ref])).rows[0].r;
    if (o.kullanici !== (saha?.kullanici_ref ?? ds)) return y.code(403).send({ hata: `Hakedişi ${saha ? 'Saha Sorumlusu' : 'Dosya Sorumlusu'} doğrular.` });
    if (h.statu !== 'Doğrulama Bekliyor') return y.code(409).send({ hata: 'Hakediş sonuçlanmıştır.' });
    const statu = karar === 'Reddet' ? 'Reddedildi' : 'Doğrulandı';
    await b.db.query(`UPDATE hakedis SET statu = $2, dogrulayan_ref = $3 WHERE kimlik = $1`, [id, statu, o.kullanici]);
    return { statu };
  });
  // YG-829, YG-831, YG-839, YG-843, YG-1428: Ticari Sorumlu hazırlar; MF Müdürü + TİD onaylar. Üçlü eşleştirme, belge ve IBAN kapısı.
  s.post('/hakedis/:id/odeme-talimati', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await ticariMi(o.kullanici))) return y.code(403).send({ hata: 'Ödeme talimatını Ticari Sorumlu hazırlar.' });
    const h = (await b.db.query(`SELECT h.*, e.kurulus_ref, e.teknik_kabul_sonucu, e.teknik_kabul_eden_ref, e.is_emri_no FROM hakedis h JOIN is_emri e ON e.kimlik = h.is_emri_ref WHERE h.kimlik = $1`, [id])).rows[0];
    if (!h) return yok(y);
    if (h.statu !== 'Doğrulandı') return y.code(409).send({ hata: 'Hakediş doğrulanmamıştır.' });
    { const bl = await blokeEngeli(b.db, h.kurulus_ref); if (bl) return y.code(409).send({ hata: bl }); } // YG-915
    if (!h.teknik_kabul_sonucu || h.teknik_kabul_sonucu === 'Ret') return y.code(409).send({ hata: 'Ödeme planı için Teknik kabul bekleniyor.' });
    if (!h.firma_fatura_no) return y.code(409).send({ hata: 'Ödeme planı için Firma faturası bekleniyor.' });
    if ((await b.db.query(`SELECT 1 FROM hakedis WHERE firma_fatura_no = $1 AND kimlik <> $2 AND statu <> 'Reddedildi'`, [h.firma_fatura_no, id])).rowCount) return y.code(409).send({ hata: 'Bu fatura numarasıyla kayıt vardır; mükerrer ödeme engellendi.' });
    if (!(await b.db.query(`SELECT 1 FROM banka_hesabi WHERE kurulus_ref = $1 AND durum = 'Geçerli'`, [h.kurulus_ref])).rowCount) return y.code(409).send({ hata: 'Firmanın teyitli IBAN kaydı yoktur.' });
    const dolu = (await b.db.query(`SELECT tur FROM sicil_belgesi WHERE kurulus_ref = $1 AND tur ILIKE '%SGK%' AND (gecerlilik_bitis IS NULL OR gecerlilik_bitis >= current_date) LIMIT 1`, [h.kurulus_ref])).rows[0];
    if (!dolu) return y.code(409).send({ hata: 'SGK borcu yoktur yazısı olmadan hakediş ödemesi bekletilir.' }); // YG-341, YG-839
    // YG-846: firma faturası Esas Müşteri Faturası ile aynı tarih ve kurda olmalı.
    if (!h.firma_fatura_tarihi || !h.firma_fatura_kuru) return y.code(409).send({ hata: 'Firma faturasının tarih ve kuru bekleniyor.' });
    const esas = (await b.db.query(`SELECT fatura_tarihi::text AS tarih, kur FROM musteri_faturasi WHERE dosya_ref = $1 AND fatura_no IS NOT NULL`, [h.dosya_ref])).rows;
    if (!esas.length) return y.code(409).send({ hata: 'Esas Müşteri Faturası bekleniyor.' });
    const ft = (await b.db.query(`SELECT $1::date::text AS t`, [h.firma_fatura_tarihi])).rows[0].t;
    if (!esas.some((x) => x.tarih === ft && Number(x.kur) === Number(h.firma_fatura_kuru))) return y.code(409).send({ hata: 'Firma faturasının tarihi veya kuru Esas Müşteri Faturası ile aynı değildir.' });
    const th = (await b.db.query(`SELECT max(t.tarih) t FROM tahsilat t WHERE t.dosya_ref = $1`, [h.dosya_ref])).rows[0].t;
    const ilk = (await b.db.query(`SELECT min(olusturma_zamani) t FROM odeme_talimati WHERE hakedis_ref = $1 AND durum <> 'Reddedildi'`, [id])).rows[0].t;
    const plan = firmaOdemePlani(th ? new Date(th) : null, ilk ? new Date(ilk) : new Date(), await parametre(b.db, 'firma_odeme_gun'), await parametre(b.db, 'firma_odeme_azami_gun'));
    // YG-841 açık iş bedeli ayrı tutulur; YG-843 tahsilat oranı; YG-840 onaylı mahsuplar düşülür.
    const once = Number((await b.db.query(`SELECT coalesce(sum(tutar_eur + mahsup_eur), 0) t FROM odeme_talimati WHERE hakedis_ref = $1 AND durum <> 'Reddedildi'`, [id])).rows[0].t);
    const kalan = R2(Number(h.net) - once);
    const acik = Number((await b.db.query(`SELECT coalesce(sum(bedel_eur), 0) t FROM acik_is_kalemi WHERE is_emri_ref = $1 AND kapanis_zamani IS NULL`, [h.is_emri_ref])).rows[0].t);
    const tutulan = R2(Math.min(kalan, acik));
    let odenebilir = R2(kalan - tutulan);
    if (plan.tahsilataBagli) odenebilir = R2(Math.min(odenebilir, Math.max(0, R2(Number(h.net) * await tahsilatOrani(b.db, h.dosya_ref)) - once)));
    if (odenebilir <= 0) return y.code(409).send({ hata: 'Açık iş bedeli veya tahsilat nedeniyle ödenecek tutar bulunmamaktadır; kapanması bekleniyor.' });
    return islem(async (c) => {
      const ml = (await c.query(`SELECT kimlik, kalan_eur FROM hakedis_mahsubu WHERE kurulus_ref = $1 AND statu = 'Onaylandı' AND kalan_eur > 0 ORDER BY olusturma_zamani FOR UPDATE`, [h.kurulus_ref])).rows;
      let mahsup = 0; const dusum: { kimlik: string; t: number }[] = [];
      for (const m of ml) { const t = R2(Math.min(Number(m.kalan_eur), R2(odenebilir - mahsup))); if (t <= 0) break; dusum.push({ kimlik: m.kimlik, t }); mahsup = R2(mahsup + t); }
      const tut = R2(odenebilir - mahsup);
      const r = (await c.query(`INSERT INTO odeme_talimati (hakedis_ref, kurulus_ref, tutar_eur, mahsup_eur, tutulan_eur, planlanan_tarih, tahsilata_bagli, hazirlayan_ref, durum, odeme_zamani) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`, [id, h.kurulus_ref, tut, mahsup, tutulan, gun(plan.tarih), plan.tahsilataBagli, o.kullanici, tut > 0 ? 'İç Onayda' : 'Ödendi', tut > 0 ? null : new Date()])).rows[0];
      for (const m of dusum) { await c.query(`UPDATE hakedis_mahsubu SET kalan_eur = kalan_eur - $2 WHERE kimlik = $1`, [m.kimlik, m.t]); await c.query(`INSERT INTO talimat_mahsubu (talimat_ref, mahsup_ref, tutar_eur) VALUES ($1,$2,$3)`, [r.kimlik, m.kimlik, m.t]); }
      if (tut > 0) {
        await c.query(`UPDATE hakedis SET statu = 'Ödeme Talimatında' WHERE kimlik = $1`, [id]);
        await kartAc(c, { tur: 'Firma Ödeme Talimatı', baslik: `${h.hakedis_no} · Ödeme Talimatı`, ozet: `${tutar(tut)} EUR${mahsup ? ` · Mahsup: ${tutar(mahsup)} EUR` : ''}${tutulan ? ` · Tutulan: ${tutar(tutulan)} EUR` : ''}`, tutar: tut, hazirlayan: o.kullanici, zincir: [await rolId(c, MFM), await rolId(c, 'Ticari İşler Direktörü')], ayrik: h.teknik_kabul_eden_ref ? [h.teknik_kabul_eden_ref] : [], nesneTuru: 'Ödeme Talimatı', nesneKimligi: r.kimlik });
      } else await hakedisSonuc(c, id);
      return { kimlik: r.kimlik, planlanan: gun(plan.tarih), tahsilataBagli: plan.tahsilataBagli, tutar: tut, mahsup, tutulan };
    });
  });
  // YG-928: IBAN karantinada başlar; talep kanalından farklı kanalla geri aranarak teyit ve iki farklı kişi.
  s.post('/firma/:id/iban', { preHandler: izinGerekli(b, 'firma.kayit') }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { iban } = (i.body ?? {}) as { iban?: string };
    if (!UUID.test(id)) return yok(y);
    if (!iban || !ibanGecerli(iban)) return y.code(400).send({ hata: 'IBAN geçersiz.' });
    if ((await b.db.query(`SELECT 1 FROM banka_hesabi WHERE kurulus_ref = $1 AND iban = $2`, [id, iban.replace(/\s/g, '').toUpperCase()])).rowCount) return y.code(409).send({ hata: 'Bu IBAN kayıtlıdır.' });
    return islem(async (c) => ({ kimlik: await bankaHesabiAc(c, { kurulus: id, iban, giren: o.kullanici }), durum: 'Karantina' }));
  });
  s.get('/banka-hesabi/bekleyen', oturumlu, async (i, y) => {
    if (!(await roller(i.oturum!.kullanici)).includes(MFMY)) return y.code(403).send({ hata: 'Geri arama teyidini Muhasebe ve Finans Müdür Yardımcısı yapar.' });
    return (await b.db.query(`SELECT h.kimlik, h.iban, k.ticari_unvan, k.kurumsal_telefon FROM banka_hesabi h JOIN kurulus k ON k.kimlik = h.kurulus_ref WHERE h.durum = 'Karantina' AND h.teyit_eden_ref IS NULL ORDER BY h.olusturma_zamani`)).rows;
  });
  s.post('/banka-hesabi/:id/teyit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { kanal } = (i.body ?? {}) as { kanal?: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await roller(o.kullanici)).includes(MFMY)) return y.code(403).send({ hata: 'Geri arama teyidini Muhasebe ve Finans Müdür Yardımcısı yapar.' });
    if (!kanal?.trim() || /e-?posta/i.test(kanal)) return y.code(400).send({ hata: 'Sicildeki kayıtlı numaradan geri arama gibi bağımsız kanal yazınız; e-posta teyit sayılmaz.' });
    const h = (await b.db.query(`SELECT giren_ref FROM banka_hesabi WHERE kimlik = $1`, [id])).rows[0];
    if (!h) return yok(y);
    if (h.giren_ref === o.kullanici) return y.code(403).send({ hata: 'Teyidin giren kişi dışında bir yetkili tarafından yapılmasını rica ederiz.' });
    await b.db.query(`UPDATE banka_hesabi SET teyit_eden_ref = $2, teyit_kanali = $3 WHERE kimlik = $1 AND durum = 'Karantina'`, [id, o.kullanici, kanal.trim()]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Banka Geri Arama Teyidi' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Banka Hesabı Geri Arama Teyidi', nesneTuru: 'Banka Hesabı', nesneKimligi: id, yeni: { kanal: kanal.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Karantina', teyit: true };
  });

  // YG-948, YG-950, YG-951, YG-1614: izin; gün sistemce; bakiye negatif olamaz; açık dosyası olanda vekil zorunlu; İK sonra birim amiri.
  s.post('/izin', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; baslangic?: string; bitis?: string; vekil?: string };
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu sayfa LGM personeline açıktır.' });
    if (!g.tur?.trim() || !g.baslangic || !g.bitis || g.bitis < g.baslangic) return y.code(400).send({ hata: 'İzin türü ve geçerli tarih aralığı zorunludur.' });
    const tatil = new Set((await b.db.query(`SELECT to_char(tarih, 'YYYY-MM-DD') t FROM resmi_tatil`)).rows.map((r) => r.t as string));
    const n = izinGunu(g.baslangic, g.bitis, tatil);
    if (n === 0) return y.code(400).send({ hata: 'Seçilen tarihlerde çalışma günü yoktur.' });
    const yil = Number(g.baslangic.slice(0, 4));
    if (g.tur === 'Yıllık') {
      const bk = (await b.db.query(`SELECT hak, kullanilan FROM izin_bakiyesi WHERE personel_ref = $1 AND yil = $2`, [o.kullanici, yil])).rows[0];
      if (!bk) return y.code(409).send({ hata: 'İzin bakiyeniz tanımlı değildir; İnsan Kaynaklarına başvurunuz.' });
      if (bk.hak - bk.kullanilan < n) return y.code(409).send({ hata: `Bakiye yetersiz: kalan ${bk.hak - bk.kullanilan} gün.` });
    }
    if ((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi a JOIN dosya d ON d.kimlik = a.dosya_ref WHERE a.kullanici_ref = $1 AND a.bitis_zamani IS NULL AND d.statu IN ('Açılış Kontrolünde', 'Aktif', 'Kontrollü Askıda') LIMIT 1`, [o.kullanici])).rowCount && !g.vekil) return y.code(400).send({ hata: 'Açık dosyanız var; vekil belirleyiniz.' });
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO izin_talebi (personel_ref, izin_turu, baslangic, bitis, gun, vekil_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [o.kullanici, g.tur, g.baslangic, g.bitis, n, g.vekil ?? null])).rows[0];
      const rl = (await c.query(`SELECT r.kimlik FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' LIMIT 1`, [o.kullanici])).rows[0];
      const amir = await onayMakami(c, rl.kimlik);
      const ik = await rolId(c, 'İnsan Kaynakları Sorumlusu');
      const zincir = (await rolSahipleri(c, ik)).length ? [ik, amir] : [amir];
      await kartAc(c, { tur: 'İzin Talebi', baslik: 'İzin Talebi', ozet: `${n} gün`, hazirlayan: o.kullanici, zincir, nesneTuru: 'İzin', nesneKimligi: r.kimlik }); // YG-952: içerik taşımaz.
      return { kimlik: r.kimlik, gun: n };
    });
  });

  // YG-920, YG-921: masraf; limit EUR, form TL; 30 gün sınırı; aşan ödenmez; belgesiz ve mükerrer kabul edilmez; 250 EUR üstü TİD.
  s.post('/masraf', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; tarih?: string; tutarTl?: number; kur?: number; miktar?: number; belge?: string; belgeOzeti?: string };
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu sayfa LGM personeline açıktır.' });
    if (!g.tur?.trim() || !g.tarih || !(Number(g.tutarTl) > 0) || !(Number(g.kur) > 0)) return y.code(400).send({ hata: 'Tür, tarih, tutar ve kur zorunludur.' });
    if (!g.belgeOzeti?.trim()) return y.code(400).send({ hata: 'Masraf için belge numarasını yazmanızı rica ederiz.' });
    if ((Date.now() - new Date(g.tarih).getTime()) / 86_400_000 > 30) return y.code(409).send({ hata: 'Fiş tarihinden itibaren 30 gün geçmiştir.' });
    const eur = R2(Number(g.tutarTl) / Number(g.kur));
    const lim = { km: await parametre(b.db, 'masraf_km_eur'), yemek: await parametre(b.db, 'masraf_yemek_eur'), konaklama: await parametre(b.db, 'masraf_konaklama_eur') };
    const od = masrafOdenecek(g.tur, eur, Number(g.miktar ?? 1), lim);
    if ((await b.db.query(`SELECT 1 FROM personel_masraf_fisi WHERE personel_ref = $1 AND belge_ozeti = $2`, [o.kullanici, g.belgeOzeti.trim()])).rowCount) return y.code(409).send({ hata: 'Bu belge daha önce girilmiştir.' });
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO personel_masraf_fisi (personel_ref, masraf_turu, fis_tarihi, tutar_tl, kur, tutar_eur, odenecek_eur, miktar, belge_ref, belge_ozeti) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`, [o.kullanici, g.tur, g.tarih, g.tutarTl, g.kur, eur, od, g.miktar ?? 1, g.belge ?? null, g.belgeOzeti!.trim()])).rows[0];
      const rl = (await c.query(`SELECT r.kimlik FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' LIMIT 1`, [o.kullanici])).rows[0];
      const zincir = [await onayMakami(c, rl.kimlik)];
      const my = await rolId(c, 'Muhasebe ve Finans Yöneticisi'); if ((await rolSahipleri(c, my)).length) zincir.push(my);
      if (od > await parametre(c, 'masraf_tid_esik_eur')) zincir.push(await rolId(c, 'Ticari İşler Direktörü'));
      await kartAc(c, { tur: 'Masraf Fişi', baslik: `Masraf Fişi · ${g.tur}`, ozet: `${tutar(od)} EUR`, hazirlayan: o.kullanici, zincir, nesneTuru: 'Masraf', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, odenecek: od, kesilen: R2(eur - od) };
    });
  });

  s.get('/dosya/:id/mali', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const q = (t: string) => b.db.query(t, [id]).then((r) => r.rows);
    return {
      odemeTalepleri: await q(`SELECT kimlik, tur, tutar_eur, son_tarih::text, durum FROM odeme_talebi WHERE dosya_ref = $1 ORDER BY olusturma_zamani`),
      sigortali: (await b.db.query(`SELECT dosya_niteligi FROM dosya WHERE kimlik = $1`, [id])).rows[0]?.dosya_niteligi === 'Sigorta bağlantılı',
      ayriKalemler: await q(`SELECT kimlik, tur, aciklama, tutar_eur, durum FROM odeme_sorumlulugu_kalemi WHERE dosya_ref = $1 ORDER BY olusturma_zamani`),
      faturalar: await q(`SELECT kimlik, proforma_no, durum, fatura_no, fatura_tarihi::text, toplam_eur, toplam_tl, vade::text, tahsil_edilen_eur, kdv_durumu, kdv_eur, kdv_tl, tevkifat_orani, tevkifat_eur, aciklama FROM musteri_faturasi WHERE dosya_ref = $1 ORDER BY olusturma_zamani`),
      hakedisler: await q(`SELECT kimlik, hakedis_no, bu_donem_brut, kesinti, net, statu FROM hakedis WHERE dosya_ref = $1 ORDER BY olusturma_zamani`),
      isEmirleri: await q(`SELECT e.kimlik, e.is_emri_no, e.kurulus_ref, k.ticari_unvan FROM is_emri e JOIN kurulus k ON k.kimlik = e.kurulus_ref WHERE e.dosya_ref = $1 AND e.statu NOT IN ('İptal', 'Yerine Geçti') ORDER BY e.olusturma_zamani`),
      teslimEngeli: await teslimEngeli(b.db, id),
      kredi: await krediDurumu(b.db, id),
      itirazlar: await q(`SELECT x.kimlik, x.fatura_ref, x.kalem, x.tutar_eur, x.gerekce, x.durum, x.yanit, x.yanit_son FROM fatura_itirazi x JOIN musteri_faturasi f ON f.kimlik = x.fatura_ref WHERE f.dosya_ref = $1 ORDER BY x.olusturma_zamani`),
      gecikme: await (async () => { const t = (await b.db.query(`SELECT musteri_turu FROM dosya WHERE kimlik = $1`, [id])).rows[0]?.musteri_turu; const a = []; for (const f of (await q(`SELECT kimlik, vade, toplam_eur, tahsil_edilen_eur FROM musteri_faturasi WHERE dosya_ref = $1 AND durum IN ('Faturalandı', 'Kısmi Tahsil')`))) { const r = await gecikmeFaizi(b.db, { vade: f.vade, kalan: R2(Number(f.toplam_eur) - Number(f.tahsil_edilen_eur)) }, t); if (r) a.push({ fatura: f.kimlik, ...r }); } return a; })(),
    };
  });
}
