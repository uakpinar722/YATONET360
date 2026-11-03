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
import { altNumara, sayac } from './sure.js';
import { parametre, parasalZincir, sonMakam } from './teklif.js';
import { UUID } from './yat.js';
import { emniyetEngeli } from './kalite.js';
import { tesisSerbestBirak } from './portallar.js';
import { izinGerekli } from './yetki.js';

type Db = Pool | PoolClient;
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
const MFM = 'Muhasebe ve Finans Müdürü';
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
  const borc = Number((await db.query(`SELECT coalesce(sum(toplam_eur - tahsil_edilen_eur), 0) b FROM musteri_faturasi WHERE dosya_ref = $1 AND durum IN ('Faturalandı', 'Kısmi Tahsil')`, [dosya])).rows[0].b);
  const talep = Number((await db.query(`SELECT coalesce(sum(tutar_eur), 0) b FROM odeme_talebi WHERE dosya_ref = $1 AND durum = 'Gönderildi'`, [dosya])).rows[0].b);
  return borc + talep > 0 ? `Ödeme bekleniyor: ${tutar(R2(borc + talep))} EUR.` : null;
}

/** YG-911, YG-1495, YG-1521: alacak takip basamakları. Sigortaya ihtar gitmez; vefatta tahsilat askısı. */
export async function alacakIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const { rows } = await db.query(`SELECT f.kimlik, f.vade, f.proforma_no, f.dosya_ref, d.dosya_no, d.musteri_turu, d.vefat_isareti FROM musteri_faturasi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.durum IN ('Faturalandı', 'Kısmi Tahsil') AND f.vade IS NOT NULL`);
  const BAS: [string, number, string][] = [['24 Saat', 1, TICARI], ['15 Gün', 15, 'Ticari İşler Direktörü'], ['30 Gün', 30, 'Genel Müdür Yardımcısı'], ['60 Gün', 60, 'CEO']];
  for (const f of rows) {
    const gecen = (simdi.getTime() - new Date(f.vade).getTime()) / 86_400_000;
    if (f.vefat_isareti) { if (gecen >= 1 && await birKez(db, 'vefat_askisi', f.kimlik)) await kartAc(db, { tur: 'Vefat Alacak Askısı', kategori: 'islem', baslik: `${f.dosya_no} · Alacak Vefat Askısında`, sahipRol: await rolId(db, 'Hukuk ve Uyum Direktörü'), nesneTuru: 'Fatura', nesneKimligi: f.kimlik }); continue; }
    for (const [ad, g, rol] of BAS) {
      if (gecen < g) continue;
      const r = await db.query(`INSERT INTO alacak_takip_adimi (fatura_ref, basamak, sorumlu_rol) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING kimlik`, [f.kimlik, ad, rol]);
      if (!r.rowCount) continue;
      await kartAc(db, { tur: 'Alacak Takibi', kategori: 'islem', baslik: `${f.dosya_no} · Alacak Takibi: ${ad}`, ozet: f.musteri_turu === 'Sigorta Şirketi' ? 'Sigorta şirketine yazılı ihtar gönderilmez; muhatabı arayınız.' : f.proforma_no, oncelik: g >= 30 ? 'Yüksek' : 'Normal', sahipRol: await rolId(db, rol), nesneTuru: 'Fatura', nesneKimligi: f.kimlik });
      n++;
    }
  }
  return n;
}

let webAdresi = '';

kapanisKaydet('Ödeme Talebi', async (c, k, karar) => {
  const t = (await c.query(`SELECT o.*, d.dosya_no, d.yazisma_dili, d.vefat_isareti FROM odeme_talebi o JOIN dosya d ON d.kimlik = o.dosya_ref WHERE o.kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Reddet') { await c.query(`UPDATE odeme_talebi SET durum = 'Reddedildi' WHERE kimlik = $1`, [t.kimlik]); return; }
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE odeme_talebi SET durum = 'Gönderildi' WHERE kimlik = $1`, [t.kimlik]);
  const y = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [t.dosya_ref])).rows[0];
  if (y && !t.vefat_isareti && t.muhatap !== 'Sigorta Şirketi') await yatTarafinaYaz(c, { olay: `bld26:${t.kimlik}`, kod: 'BLD-26', dil: dilKod(t.yazisma_dili), konu: `${t.dosya_no} Ödeme Talebi`, telefon: y.telefon, eposta: y.eposta, alanlar: { 'Dosya No': t.dosya_no, 'File No': t.dosya_no, 'ödeme türü': t.tur, 'payment type': t.tur, 'son tarih': gunAy(t.son_tarih), 'due date': gunAy(t.son_tarih), 'bağlantı': webAdresi, link: webAdresi } });
});

kapanisKaydet('Proforma', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE musteri_faturasi SET durum = 'Proforma' WHERE kimlik = $1`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE musteri_faturasi SET durum = 'Reddedildi' WHERE kimlik = $1`, [k.nesne_kimligi]);
});

kapanisKaydet('Firma Ödeme Talimatı', async (c, k, karar) => {
  const t = (await c.query(`SELECT kimlik, hakedis_ref FROM odeme_talimati WHERE kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Onayla') await c.query(`UPDATE odeme_talimati SET durum = 'Onaylandı' WHERE kimlik = $1`, [t.kimlik]);
  else if (karar === 'Reddet') { await c.query(`UPDATE odeme_talimati SET durum = 'Reddedildi' WHERE kimlik = $1`, [t.kimlik]); await c.query(`UPDATE hakedis SET statu = 'Doğrulandı' WHERE kimlik = $1`, [t.hakedis_ref]); }
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
  await c.query(`UPDATE teslim_kaydi SET durum = 'Teslim Edildi', teslim_alan = $2, teslim_zamani = $3 WHERE dosya_ref = $1 AND durum = 'Onay Bekliyor'`, [t.dosya_ref, t.alici_ad, k.zaman]);
  await tesisSerbestBirak(c, t.dosya_ref, t.alici_ad); // YG-554
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
    const matrah = R2(hk - indirim - Number(t.kesif_mahsubu_eur)); const kdv = R2((matrah * Number(t.kdv_orani)) / 100);
    return islem(async (c) => {
      const no = `${t.dosya_no}-PF${String(await sayac(c, `${t.dosya_no}:PF`)).padStart(2, '0')}`;
      const r = (await c.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, teklif_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [no, t.dosya_ref, t.kimlik, t.teklif_muhatabi, matrah, kdv, R2(matrah + kdv), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Proforma', baslik: `${no} · Proforma Onayı`, ozet: `${tutar(matrah)} EUR (KDV hariç)`, hazirlayan: o.kullanici, zincir: await parasalZincir(c, [MFM], await sonMakam(c, matrah)), nesneTuru: 'Fatura', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, proformaNo: no, kdvHaric: matrah, kdv, toplam: R2(matrah + kdv) };
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
    const tl = R2(Number(f.toplam_eur) * Number(g.kur));
    await b.db.query(`UPDATE musteri_faturasi SET durum = 'Faturalandı', fatura_no = $2, fatura_tarihi = $3, kur = $4, kur_tarihi = $5, toplam_tl = $6, vade = $7 WHERE kimlik = $1`, [f.kimlik, g.no.trim(), g.tarih, g.kur, g.kurTarihi, tl, vade.toISOString().slice(0, 10)]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Fatura Bilgisi Girildi', nesneTuru: 'Fatura', nesneKimligi: f.kimlik, yeni: { no: g.no, kur: g.kur, tl }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { toplamTl: tl, vade: vade.toISOString().slice(0, 10) };
  });

  // YG-903, YG-904, YG-1460: havale, POS, ödeme bağlantısı; çek/senet yok; kısmi tahsilat; kart üst sınırı 20.000,00 EUR.
  s.post('/tahsilat', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { fatura?: string; odemeTalebi?: string; tutar?: number; tarih?: string; kanal?: string; referans?: string };
    if (!(await ticariMi(o.kullanici))) return y.code(403).send({ hata: 'Tahsilatı Ticari Sorumlu kaydeder.' });
    if (!['Havale', 'POS', 'Ödeme Bağlantısı'].includes(g.kanal ?? '')) return y.code(400).send({ hata: 'Ödeme kanalını havale, POS veya ödeme bağlantısı olarak seçmenizi rica ederiz.' });
    if (!(Number(g.tutar) > 0) || !g.tarih) return y.code(400).send({ hata: 'Tutar ve tarih zorunludur.' });
    if (g.kanal !== 'Havale' && Number(g.tutar) > 20000) return y.code(400).send({ hata: '20.000,00 EUR karşılığı üzerindeki tahsilatta havale kullanmanızı rica ederiz.' });
    return islem(async (c) => {
      if (g.fatura) {
        const f = (await c.query(`SELECT * FROM musteri_faturasi WHERE kimlik = $1 FOR UPDATE`, [g.fatura])).rows[0];
        if (!f || !['Faturalandı', 'Kısmi Tahsil'].includes(f.durum)) throw Object.assign(new Error('Tahsilat faturalanmış kayda girilir.'), { statusCode: 409 });
        const yeni = R2(Number(f.tahsil_edilen_eur) + Number(g.tutar));
        if (yeni > Number(f.toplam_eur)) throw Object.assign(new Error('Tahsilat fatura tutarının üzerindedir; fazla ödeme iade akışından yürütülür.'), { statusCode: 409 });
        await c.query(`INSERT INTO tahsilat (fatura_ref, dosya_ref, tutar_eur, tarih, kanal, referans, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [f.kimlik, f.dosya_ref, g.tutar, g.tarih, g.kanal, g.referans ?? null, o.kullanici]);
        const durum = yeni === Number(f.toplam_eur) ? 'Tahsil Edildi' : 'Kısmi Tahsil';
        await c.query(`UPDATE musteri_faturasi SET tahsil_edilen_eur = $2, durum = $3 WHERE kimlik = $1`, [f.kimlik, yeni, durum]);
        return { durum, kalan: R2(Number(f.toplam_eur) - yeni) };
      }
      const t = g.odemeTalebi ? (await c.query(`SELECT * FROM odeme_talebi WHERE kimlik = $1 FOR UPDATE`, [g.odemeTalebi])).rows[0] : undefined;
      if (!t || t.durum !== 'Gönderildi') throw Object.assign(new Error('Ödeme talebi bulunamadı.'), { statusCode: 404 });
      await c.query(`INSERT INTO tahsilat (odeme_talebi_ref, dosya_ref, tutar_eur, tarih, kanal, referans, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [t.kimlik, t.dosya_ref, g.tutar, g.tarih, g.kanal, g.referans ?? null, o.kullanici]);
      const top = Number((await c.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM tahsilat WHERE odeme_talebi_ref = $1`, [t.kimlik])).rows[0].t);
      if (top >= Number(t.tutar_eur)) await c.query(`UPDATE odeme_talebi SET durum = 'Ödendi' WHERE kimlik = $1`, [t.kimlik]);
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
      await onayTalebiAc(c, { dosya: id, ony: 'ONY-27', dil, alanlar: alan, baslikAlanlari: alan, kutular: kut, taraf: sah.kimlik, kullanici: sah.kullanici_ref, aliciAd: sah.kisi_adi_soyadi, telefon: sah.telefon, eposta: sah.eposta, belgeAdi: 'Teslim Tutanağı', hazirlayan: o.kullanici, gun: 7, webAdresi: b.webAdresi });
      return { durum: 'Teslim Onayı Bekleniyor' };
    });
  });

  const firmam = async (k: string) => (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;

  // YG-835, YG-836, YG-838: firma hakediş girer; kanıt zorunlu ve tek; kümülatif iş emri bedelini aşamaz; kesinti sistemce.
  s.post('/firma-portal/is-emri/:id/hakedis', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { brut?: number; belge?: string; faturaNo?: string };
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
      const r = (await c.query(`INSERT INTO hakedis (hakedis_no, is_emri_ref, dosya_ref, sira_no, bu_donem_brut, kumulatif, kesinti, net, kanit_belge_ref, firma_fatura_no, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`, [no, id, e.dosya_ref, sira, g.brut, R2(kum + Number(g.brut)), kes, R2(Number(g.brut) - kes), g.belge, g.faturaNo ?? null, o.kullanici])).rows[0];
      return { kimlik: r.kimlik, hakedisNo: no, kesinti: kes, net: R2(Number(g.brut) - kes) };
    });
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
    const h = (await b.db.query(`SELECT h.*, e.kurulus_ref, e.teknik_kabul_sonucu, e.is_emri_no FROM hakedis h JOIN is_emri e ON e.kimlik = h.is_emri_ref WHERE h.kimlik = $1`, [id])).rows[0];
    if (!h) return yok(y);
    if (h.statu !== 'Doğrulandı') return y.code(409).send({ hata: 'Hakediş doğrulanmamıştır.' });
    if (!h.teknik_kabul_sonucu || h.teknik_kabul_sonucu === 'Ret') return y.code(409).send({ hata: 'Ödeme planı için Teknik kabul bekleniyor.' });
    if (!h.firma_fatura_no) return y.code(409).send({ hata: 'Ödeme planı için Firma faturası bekleniyor.' });
    if ((await b.db.query(`SELECT 1 FROM hakedis WHERE firma_fatura_no = $1 AND kimlik <> $2 AND statu <> 'Reddedildi'`, [h.firma_fatura_no, id])).rowCount) return y.code(409).send({ hata: 'Bu fatura numarasıyla kayıt vardır; mükerrer ödeme engellendi.' });
    if (!(await b.db.query(`SELECT 1 FROM banka_hesabi WHERE kurulus_ref = $1 AND durum = 'Geçerli'`, [h.kurulus_ref])).rowCount) return y.code(409).send({ hata: 'Firmanın teyitli IBAN kaydı yoktur.' });
    const dolu = (await b.db.query(`SELECT tur FROM sicil_belgesi WHERE kurulus_ref = $1 AND tur ILIKE '%SGK%' AND (gecerlilik_bitis IS NULL OR gecerlilik_bitis >= current_date) LIMIT 1`, [h.kurulus_ref])).rows[0];
    if (!dolu) return y.code(409).send({ hata: 'SGK borcu yoktur yazısı olmadan hakediş ödemesi bekletilir.' }); // YG-341, YG-839
    const th = (await b.db.query(`SELECT max(t.tarih) t FROM tahsilat t WHERE t.dosya_ref = $1`, [h.dosya_ref])).rows[0].t;
    const plan = firmaOdemePlani(th ? new Date(th) : null, new Date(), await parametre(b.db, 'firma_odeme_gun'), await parametre(b.db, 'firma_odeme_azami_gun'));
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO odeme_talimati (hakedis_ref, kurulus_ref, tutar_eur, planlanan_tarih, tahsilata_bagli, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, h.kurulus_ref, h.net, gun(plan.tarih), plan.tahsilataBagli, o.kullanici])).rows[0];
      await c.query(`UPDATE hakedis SET statu = 'Ödeme Talimatında' WHERE kimlik = $1`, [id]);
      await kartAc(c, { tur: 'Firma Ödeme Talimatı', baslik: `${h.hakedis_no} · Ödeme Talimatı`, ozet: `${tutar(Number(h.net))} EUR`, hazirlayan: o.kullanici, zincir: [await rolId(c, MFM), await rolId(c, 'Ticari İşler Direktörü')], nesneTuru: 'Ödeme Talimatı', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, planlanan: gun(plan.tarih), tahsilataBagli: plan.tahsilataBagli };
    });
  });
  // YG-928: IBAN karantinada başlar; talep kanalından farklı kanalla geri aranarak teyit ve iki farklı kişi.
  s.post('/firma/:id/iban', { preHandler: izinGerekli(b, 'firma.kayit') }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { iban } = (i.body ?? {}) as { iban?: string };
    if (!UUID.test(id)) return yok(y);
    if (!iban || !ibanGecerli(iban)) return y.code(400).send({ hata: 'IBAN geçersiz.' });
    const r = (await b.db.query(`INSERT INTO banka_hesabi (kurulus_ref, iban, giren_ref) VALUES ($1,$2,$3) RETURNING kimlik`, [id, iban.replace(/\s/g, '').toUpperCase(), o.kullanici])).rows[0];
    return { kimlik: r.kimlik, durum: 'Karantina' };
  });
  s.get('/banka-hesabi/bekleyen', oturumlu, async (i, y) => {
    if (!(await roller(i.oturum!.kullanici)).includes(MFM)) return y.code(403).send({ hata: 'Teyidi Muhasebe ve Finans Müdürü yapar.' });
    return (await b.db.query(`SELECT h.kimlik, h.iban, k.ticari_unvan FROM banka_hesabi h JOIN kurulus k ON k.kimlik = h.kurulus_ref WHERE h.durum = 'Karantina' ORDER BY h.olusturma_zamani`)).rows;
  });
  s.post('/banka-hesabi/:id/teyit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { kanal } = (i.body ?? {}) as { kanal?: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await roller(o.kullanici)).includes(MFM)) return y.code(403).send({ hata: 'Teyidi Muhasebe ve Finans Müdürü yapar.' });
    if (!kanal?.trim() || /e-?posta/i.test(kanal)) return y.code(400).send({ hata: 'Sicildeki kayıtlı numaradan geri arama gibi bağımsız kanal yazınız; e-posta teyit sayılmaz.' });
    const h = (await b.db.query(`SELECT giren_ref FROM banka_hesabi WHERE kimlik = $1`, [id])).rows[0];
    if (!h) return yok(y);
    if (h.giren_ref === o.kullanici) return y.code(403).send({ hata: 'Teyidin giren kişi dışında bir yetkili tarafından yapılmasını rica ederiz.' });
    await b.db.query(`UPDATE banka_hesabi SET durum = 'Geçerli', teyit_eden_ref = $2, teyit_kanali = $3 WHERE kimlik = $1`, [id, o.kullanici, kanal.trim()]);
    return { durum: 'Geçerli' };
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
      faturalar: await q(`SELECT kimlik, proforma_no, durum, fatura_no, fatura_tarihi::text, toplam_eur, toplam_tl, vade::text, tahsil_edilen_eur FROM musteri_faturasi WHERE dosya_ref = $1 ORDER BY olusturma_zamani`),
      hakedisler: await q(`SELECT kimlik, hakedis_no, bu_donem_brut, kesinti, net, statu FROM hakedis WHERE dosya_ref = $1 ORDER BY olusturma_zamani`),
      teslimEngeli: await teslimEngeli(b.db, id),
    };
  });
}
