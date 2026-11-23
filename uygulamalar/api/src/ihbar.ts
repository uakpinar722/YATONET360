import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez, disGonder } from './bildirim.js';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import type { Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { metinGetir, type Dil } from './metin.js';
import { sureBaslat, sureBitir, talepNumarasi } from './sure.js';
import { UUID, tarafNo, yatBulVeyaAc, type YatGirdisi } from './yat.js';
import { izinGerekli } from './yetki.js';

type Db = Pool | PoolClient;
export const ONCELIK_SIRA = ['Planlı', 'Normal', 'Yüksek', 'Kritik'];
const IZLEME_ROLLERI = ['Sigorta Şirketi', 'Sigorta Brokeri / Acentesi'];
export const rolId = async (db: Db, ad: string) => (await db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
export const dilKod = (d: string): Dil => (d === 'İngilizce' ? 'en' : 'tr');

async function liste(db: Db, kod: string) {
  return (await db.query(`SELECT deger, aciklama FROM deger_listesi WHERE liste_kodu = $1 ORDER BY sira`, [kod])).rows as { deger: string; aciklama: string | null }[];
}

/**
 * YG-033: evet olan en üst sınıf; emin olunamazsa üst öncelik (Bilinmiyor riskli sayılır); yanıtlanmayan soru hayırdır.
 * Hiçbir sorunun evet olmadığı ihbar Normal önerilir. YG-038: acil durum Kritiktir.
 */
export async function oncelikOner(db: Db, cevaplar: Record<string, string>, acil: boolean): Promise<string> {
  if (acil) return 'Kritik';
  let en = -1;
  for (const s of await liste(db, 'LST_IHBAR_ONCELIK_SORUSU')) {
    const c = cevaplar[s.deger];
    if (c !== 'Evet' && c !== 'Bilinmiyor') continue;
    const sinif = ONCELIK_SIRA.findIndex((o) => s.aciklama?.includes(o));
    if (sinif > en) en = sinif;
  }
  return en < 0 ? 'Normal' : ONCELIK_SIRA[en]!;
}

/** Portal hesabı olmayan yat sahibi/yetkilisine dosya metni (YG-022, YG-1423). Vefat işaretinde otomatik ileti durur (YG-1477). */
export async function yatTarafinaYaz(c: Db, g: { olay: string; kod: string; dil: Dil; alanlar: Record<string, string | string[]>; telefon?: string | null; eposta?: string | null; konu: string; oncelik?: string; acil?: boolean; ekler?: string[] }) {
  const r = await disGonder(c, { olay: g.olay, telefon: g.telefon, eposta: g.eposta, konu: g.konu, metin: await metinGetir(c, g.kod, g.dil, g.alanlar), oncelik: g.oncelik, acil: g.acil, ekler: g.ekler });
  const no = g.alanlar['Dosya No'] ?? g.alanlar['File No'];
  if (typeof no === 'string' && no) await doganGorevAc(c, g.kod, no, g.olay);
  return r;
}

const EKIP_ROLLERI = ['Dosya Sorumlusu', 'Yedek Sorumlu', 'Operasyon Yöneticisi', 'Teknik Uzman', 'Teknik Yönetici', 'Saha Sorumlusu', 'Kalite Kontrolör', 'Tedarik Sorumlusu'];
const ROL_ADI: Record<string, string> = { 'Ticari Sorumlu': 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)' };
const ILK_YANIT_SAAT: Record<string, number> = { Kritik: 0.5, Yüksek: 2, Normal: 4, Planlı: 8 };

/** YG-1465: şablon kataloğundaki "doğan görev" (Rol – iş; noktalı virgülle birden çok) gönderimle birlikte dosya ekibindeki kişiye, yoksa role açılır.
 *  "En kısa sürede" denen işin üst sınırı dosyanın öncelik ilk yanıt süresidir; "1 iş günü" 24 saattir (pazar, tatil ve gece kaydırmalı). Dışa giden metne süre yazılmaz. */
export async function doganGorevAc(c: Db, kod: string, dosyaNo: string, olay: string, simdi = new Date()): Promise<number> {
  const tanim = (await c.query(`SELECT dogan_gorev FROM sablon_metni WHERE kod = $1 AND dil = 'tr' AND dogan_gorev IS NOT NULL AND dogan_gorev !~ '^\\s*[—-]?\\s*$' LIMIT 1`, [kod])).rows[0]?.dogan_gorev as string | undefined;
  if (!tanim) return 0;
  const d = (await c.query(`SELECT kimlik, oncelik, dosya_sorumlusu_ref FROM dosya WHERE dosya_no = $1`, [dosyaNo])).rows[0];
  if (!d) return 0;
  let n = 0;
  for (const [i, parca] of tanim.split(';').map((x) => x.trim()).filter(Boolean).entries()) {
    const m = parca.match(/^([^–]+?)\s+–\s+(.+)$/); if (!m) continue;
    const rol = m[1]!.trim(); const is = m[2]!.trim();
    if (!(await birKez(c, 'dogan_gorev', `${olay}:${i}`))) continue;
    let kisi: string | undefined;
    if (rol === 'Dosya Sorumlusu' && d.dosya_sorumlusu_ref) kisi = d.dosya_sorumlusu_ref;
    else if (EKIP_ROLLERI.includes(rol)) kisi = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = $2 AND bitis_zamani IS NULL ORDER BY atama_zamani DESC LIMIT 1`, [d.kimlik, rol])).rows[0]?.kullanici_ref;
    const rolKimlik = kisi ? undefined : (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ROL_ADI[rol] ?? rol])).rows[0]?.kimlik as string | undefined;
    if (!kisi && !rolKimlik) continue;
    let son: Date | undefined;
    if (/(gelince|girilince|gerçekleşince|değiştiğinde)/i.test(is)) son = undefined; // koşula bağlı iş: süre koşul gerçekleşince sahibince izlenir
    else if (/en kısa sürede/i.test(is)) son = new Date(simdi.getTime() + (ILK_YANIT_SAAT[d.oncelik] ?? 4) * 3_600_000);
    else if (/1 iş günü/i.test(is)) { const { bitisKaydir, tatilGunleri } = await import('./sure.js'); son = bitisKaydir(new Date(simdi.getTime() + 24 * 3_600_000), d.oncelik, await tatilGunleri(c)).bitis; }
    await kartAc(c, { tur: 'Doğan Görev', kategori: 'gorev', baslik: `${dosyaNo} · ${kod} sonrası görev`, ozet: is.replace(/\s*\(üst sınır: öncelik ilk yanıt süresi\)/, ''), oncelik: d.oncelik, sahipKullanici: kisi, sahipRol: kisi ? undefined : rolKimlik, sonZaman: son, nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
    n++;
  }
  return n;
}

/** YG-1465: doğan görevde sürenin yarısında sahibine uyarı; süre dolunca Operasyon Müdürüne bildirim (görev listede gecikmiş görünür). Her eşik bir kez. */
export async function doganGorevIsle(db: Pool, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(`SELECT kimlik, baslik, ozet, oncelik, olusturma_zamani, son_zaman, sahip_kullanici_ref, sahip_rol_ref FROM is_karti WHERE tur = 'Doğan Görev' AND durum IN ('Bekliyor', 'İade Edildi') AND son_zaman IS NOT NULL`);
  let n = 0;
  for (const k of rows) {
    const bas = new Date(k.olusturma_zamani).getTime(); const son = new Date(k.son_zaman).getTime(); const t = simdi.getTime();
    if (t >= son) {
      if (!(await birKez(db, 'dogan_gorev_doldu', k.kimlik))) continue;
      const om = await rolSahipleri(db, await rolId(db, 'Operasyon Müdürü'));
      if (om.length) await bildir(db, { olay: `dogan-doldu:${k.kimlik}`, kullanicilar: om, baslik: `Süresi Dolan Görev: ${k.baslik}`, ozet: k.ozet, isRef: k.kimlik, oncelik: k.oncelik }, simdi);
      n++;
    } else if (son > bas && t >= bas + (son - bas) / 2) {
      if (!(await birKez(db, 'dogan_gorev_yari', k.kimlik))) continue;
      const kisiler = k.sahip_kullanici_ref ? [k.sahip_kullanici_ref as string] : k.sahip_rol_ref ? await rolSahipleri(db, k.sahip_rol_ref) : [];
      if (kisiler.length) await bildir(db, { olay: `dogan-yari:${k.kimlik}`, kullanicilar: kisiler, baslik: `Görev Süresinin Yarısı Doldu: ${k.baslik}`, ozet: k.ozet, isRef: k.kimlik, oncelik: k.oncelik }, simdi);
      n++;
    }
  }
  return n;
}

interface IhbarGirdisi {
  bildirimZamani?: string; kanal?: string; sahibiAdi?: string; sahibiTuru?: string; sahibiTuruAciklama?: string; yetkiDurumu?: string; sifat?: string; telefon?: string; eposta?: string; yetkiBeyani?: string;
  yat?: YatGirdisi; yatSahibi?: { ad?: string; telefon?: string; eposta?: string; kisiTuru?: string };
  olayTarihi?: string; olayYeri?: string; konum?: string; yatDurumu?: string; ihtiyac?: string; acil?: boolean; cevaplar?: Record<string, string>; oncelik?: string; hedefTarih?: string;
  sigortaci?: string; policeNo?: string; hasarNo?: string; ozgun?: string; dil?: string; varyant?: string; iletisimKisileri?: string; oncelikGerekcesi?: string;
}

/** Ortak kayıt: personel ihbar ekranı ve portal kısa formu aynı yoldan geçer (YG-011: her kanaldan tek kayıt). */
export async function ihbarKaydet(c: PoolClient, g: IhbarGirdisi, kullanici: string, baglam: { ilkSorumlu: string }, simdi = new Date()): Promise<{ hata: string } | { kimlik: string; talepNo: string; oncelik: string; onerilen: string }> {
  const kanallar = (await liste(c, 'LST_TALEP_KANALI')).map((x) => x.deger);
  const turler = (await liste(c, 'LST_TALEP_SAHIBI_TURU')).map((x) => x.deger);
  const yetkiler = (await liste(c, 'LST_IHBAR_YETKI_DURUMU')).map((x) => x.deger);
  if (!kanallar.includes(g.kanal ?? '')) return { hata: 'Bildirim kanalını seçiniz.' };
  if (!g.sahibiAdi?.trim()) return { hata: 'İhbar edenin adı zorunludur.' };
  if (!turler.includes(g.sahibiTuru ?? '')) return { hata: 'İhbar edenin rolünü seçiniz.' };
  if (g.sahibiTuru === 'Diğer' && !g.sahibiTuruAciklama?.trim()) return { hata: '"Diğer" seçildiğinde kim olduğu yazılmalıdır.' }; // YG-020
  if (!g.telefon?.trim() && !g.eposta?.trim()) return { hata: 'Telefon veya e-postadan en az biri zorunludur.' };
  if (g.eposta && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.eposta)) return { hata: 'E-posta adresini kontrol etmenizi rica ederiz.' };
  const durum = yetkiler.includes(g.yetkiDurumu ?? '') ? g.yetkiDurumu! : 'Beyan · Doğrulama Bekliyor'; // YG-021
  if (!g.konum?.trim()) return { hata: 'Yatın mevcut konumu zorunludur.' };
  if (!g.yatDurumu?.trim()) return { hata: 'Yatın mevcut durumu zorunludur.' };
  if (!g.ihtiyac?.trim()) return { hata: 'Olay özeti zorunludur.' };
  const bildirimZamani = new Date(g.bildirimZamani ?? simdi);
  if (Number.isNaN(+bildirimZamani)) return { hata: 'Bildirim zamanı geçersiz.' };
  if (bildirimZamani > simdi) return { hata: 'Bildirim zamanının kayda geçiş zamanından önce olmasını rica ederiz.' }; // YG-040
  const olay = g.olayTarihi ? new Date(g.olayTarihi) : null;
  if (olay && (Number.isNaN(+olay) || olay > bildirimZamani)) return { hata: 'Olay tarihinin bildirim zamanından önce olmasını rica ederiz.' };
  const cevaplar = g.cevaplar ?? {};
  const onerilen = await oncelikOner(c, cevaplar, Boolean(g.acil));
  const oncelik = g.oncelik ?? onerilen;
  if (!ONCELIK_SIRA.includes(oncelik)) return { hata: 'Önceliği listeden seçmenizi rica ederiz.' };
  // YG-036: yükseltme serbest; önerinin altına inmek ancak açılıştan sonra gerekçe ve iki onayla olur.
  if (ONCELIK_SIRA.indexOf(oncelik) < ONCELIK_SIRA.indexOf(onerilen)) return { hata: 'Öncelik düşürme, dosya açıldıktan sonra gerekçeyle talep edilir; sistemin önerdiği öncelik korunmuştur.' };
  // YG-032: öncelik etki ve aciliyet sorularından gelir; önerilenin üstü ancak gerekçeyle seçilir (her işi acil işaretleme engellenir).
  const yukseltme = ONCELIK_SIRA.indexOf(oncelik) > ONCELIK_SIRA.indexOf(onerilen);
  if (yukseltme && !g.oncelikGerekcesi?.trim()) return { hata: `Sistemin önerdiği öncelik ${onerilen}; daha yüksek öncelik için gerekçe yazınız (güvenlik, hizmet kesintisi, yat programı, müşteri etkisi veya mali sonuç).` };
  const yat = await yatBulVeyaAc(c, g.yat ?? {}, kullanici);
  if ('hata' in yat) return yat;
  if (g.yatSahibi?.ad?.trim()) {
    const var_ = (await c.query(`SELECT yat_sahibi_ref FROM yat WHERE kimlik = $1`, [yat.kimlik])).rows[0];
    if (!var_.yat_sahibi_ref) {
      const t = await c.query(`INSERT INTO taraf (taraf_no, kisi_turu, unvan_ad_soyad, telefon, eposta, taraf_rolleri, olusturan_ref) VALUES ($1,$2,$3,$4,$5,'{Yat Sahibi}',$6) RETURNING kimlik`,
        [await tarafNo(c), g.yatSahibi.kisiTuru === 'Tüzel kişi' ? 'Tüzel kişi' : 'Gerçek kişi', g.yatSahibi.ad.trim(), g.yatSahibi.telefon ?? null, g.yatSahibi.eposta ?? null, kullanici]);
      await c.query(`UPDATE yat SET yat_sahibi_ref = $2 WHERE kimlik = $1`, [yat.kimlik, t.rows[0].kimlik]);
    }
  }
  const no = await talepNumarasi(c, simdi);
  const statu = g.acil || oncelik === 'Kritik' ? 'Acil Eskalasyon' : durum === 'Doğrulandı' ? 'Yeni Talep' : 'Doğrulama Bekliyor';
  const varyant = g.varyant ?? (g.acil ? 'Acil Müdahale' : 'Hasar');
  const dil = g.dil === 'İngilizce' ? 'İngilizce' : 'Türkçe';
  const { rows } = await c.query(
    `INSERT INTO talep (talep_no, bildirim_alinma_zamani, kayda_gecis_zamani, ihbar_alindi_varyanti, bildirim_kanali, talebi_alan_ref, talep_sahibi_adi, talep_sahibi_turu, talep_sahibi_turu_aciklama, ihbar_yetki_durumu, talep_sahibi_sifat, talep_sahibi_telefon, talep_sahibi_eposta, yetki_dayanagi_beyani, yat_ref, olay_tarihi, olay_yeri, yat_mevcut_konumu, yat_mevcut_durumu, ihtiyac_tanimi, acil_durum, oncelik_cevaplari, onerilen_oncelik, oncelik, musteri_hedef_tarihi, sigortaci_beyan, police_no_beyan, sigorta_hasar_dosya_no_beyan, ozgun_bildirim, statu, yazisma_dili, ilk_sorumlu_ref, olusturan_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$6) RETURNING kimlik`,
    [no, bildirimZamani, simdi, varyant, g.kanal, kullanici, g.sahibiAdi.trim(), g.sahibiTuru, g.sahibiTuruAciklama ?? null, durum, g.sifat ?? null, g.telefon?.trim() || null, g.eposta?.trim() || null, g.yetkiBeyani ?? null, yat.kimlik, olay, g.olayYeri ?? null, g.konum.trim(), g.yatDurumu.trim(), g.ihtiyac.trim(), Boolean(g.acil), JSON.stringify(cevaplar), onerilen, oncelik, g.hedefTarih || null, g.sigortaci ?? null, g.policeNo ?? null, g.hasarNo ?? null, g.ozgun?.trim() || g.ihtiyac.trim(), statu, dil, baglam.ilkSorumlu]);
  const id = rows[0].kimlik as string;
  if (g.iletisimKisileri?.trim()) await c.query(`UPDATE talep SET iletisim_kisileri = $2 WHERE kimlik = $1`, [id, g.iletisimKisileri.trim()]); // YG-018
  if (yukseltme) await c.query(`UPDATE talep SET oncelik_yukseltme_gerekcesi = $2 WHERE kimlik = $1`, [id, g.oncelikGerekcesi!.trim()]); // YG-032
  // YG-002: ilk durum — acil veya Kritik ise Acil; kayıtta bilgi eksikse Eksik; ihbar edenin yetkisi doğrulanmamışsa İncelemede; değilse Yeni.
  const eksik: string[] = [];
  if (!olay) eksik.push('Olay tarihi');
  if (!g.olayYeri?.trim()) eksik.push('Olay yeri');
  if (!(await c.query(`SELECT yat_sahibi_ref FROM yat WHERE kimlik = $1`, [yat.kimlik])).rows[0]?.yat_sahibi_ref) eksik.push('Yat sahibi');
  if (g.sigortaci?.trim() && !g.hasarNo?.trim()) eksik.push('Sigorta hasar dosya numarası');
  const ilkDurum = statu === 'Acil Eskalasyon' ? 'Acil' : eksik.length ? 'Eksik' : durum !== 'Doğrulandı' ? 'İncelemede' : 'Yeni';
  await c.query(`UPDATE talep SET ilk_siniflandirma = $2, eksik_bilgiler = $3 WHERE kimlik = $1`, [id, ilkDurum, eksik]);
  await sureBaslat(c, { tur: 'İlk Yanıt', oncelik, baslangic: bildirimZamani, talep: id });
  // YG-1558: liste dışı girilen sigorta şirketi ana veri güncelleme görevi açar.
  if (g.sigortaci?.trim() && !(await c.query(`SELECT 1 FROM sigorta_sirketi WHERE lower(tam_unvan) = lower($1) OR lower(kisa_ad) = lower($1)`, [g.sigortaci.trim()])).rowCount)
    await kartAc(c, { tur: 'Ana Veri Güncelleme', kategori: 'gorev', baslik: `${no} · Liste Dışı Sigorta Şirketi`, ozet: `"${g.sigortaci.trim()}" sigorta şirketi listesinde yoktur; ana veriye eklenmesi veya listedeki kayıtla eşleştirilmesi rica olunur.`.slice(0, 200), sahipRol: await rolId(c, 'Sicil Sorumlusu'), sonZaman: new Date(Date.now() + 3 * 86_400_000), nesneTuru: 'Talep', nesneKimligi: id });
  // YG-1558: yer listesi tanımlıyken liste dışı girilen yer ana veri güncelleme görevi açar.
  if (g.konum?.trim() && (await c.query(`SELECT 1 FROM baglama_noktasi LIMIT 1`)).rowCount && !(await c.query(`SELECT 1 FROM baglama_noktasi n WHERE lower(n.ad || coalesce(' (' || nullif(concat_ws(', ', n.ilce, n.il), '') || ')', '')) = lower($1) OR lower(n.ad) = lower($1) LIMIT 1`, [g.konum.trim()])).rowCount)
    await kartAc(c, { tur: 'Ana Veri Güncelleme', kategori: 'gorev', baslik: `${no} · Liste Dışı Yer`, ozet: `"${g.konum.trim()}" yer listesinde yoktur; ana veriye eklenmesi veya listedeki kayıtla eşleştirilmesi rica olunur.`.slice(0, 200), sahipRol: await rolId(c, 'Sicil Sorumlusu'), sonZaman: new Date(Date.now() + 3 * 86_400_000), nesneTuru: 'Talep', nesneKimligi: id });
  // YG-240: mesai dışında dış kanaldan (portal, sigorta, telefonla başkası adına) gelen ihbar nöbet düzenine yönlenir; görevi nöbetçi Dosya Sorumlusu alır.
  let acilisSahibi = baglam.ilkSorumlu;
  if (baglam.ilkSorumlu !== kullanici) {
    const { mesaiIcinde } = await import('./bildirim.js');
    if (!mesaiIcinde(simdi)) { const n = await (await import('./acil.js')).nobetci(c, 'Dosya Sorumlusu', simdi); if (n) acilisSahibi = n; }
  }
  await kartAc(c, { tur: 'İhbar Açılış Kontrolü', kategori: 'gorev', baslik: `${no} · Mükerrerlik ve Açılış Kontrolü`, ozet: `İlk durum: ${ilkDurum}${eksik.length ? ` (eksik: ${eksik.join(', ')})` : ''} · ${g.ihtiyac.trim()}`.slice(0, 300), oncelik: oncelik === 'Kritik' ? 'Kritik' : 'Normal', sahipKullanici: acilisSahibi, hazirlayan: kullanici, nesneTuru: 'Talep', nesneKimligi: id });
  // YG-525: yeni talep Operasyon Müdürlüğü talep kuyruğuna sistem içi bildirimle düşer; mesai dışında nöbetçi Dosya Sorumlusu da bilgilendirilir (Kritikte SMS).
  { const { mesaiIcinde } = await import('./bildirim.js'); const mesaiDisi = !mesaiIcinde(simdi);
    const om = await rolSahipleri(c, await rolId(c, 'Operasyon Müdürü'));
    await bildir(c, { olay: `yeni-talep:${id}`, kullanicilar: om.filter((x) => x !== kullanici), baslik: `Yeni Talep: ${no}`, ozet: `${oncelik} · ${g.ihtiyac.trim().slice(0, 160)}`, oncelik: oncelik === 'Kritik' ? 'Kritik' : 'Normal' }, simdi);
    if (mesaiDisi) { const n = await (await import('./acil.js')).nobetci(c, 'Dosya Sorumlusu', simdi);
      if (n && n !== kullanici) await bildir(c, { olay: `yeni-talep-nobet:${id}`, kullanicilar: [n], baslik: `Yeni Talep (Mesai Dışı): ${no}`, ozet: `${oncelik} · ${g.ihtiyac.trim().slice(0, 160)}`, oncelik: oncelik === 'Kritik' ? 'Kritik' : 'Normal', sms: oncelik === 'Kritik', acil: oncelik === 'Kritik' }, simdi); } }
  // YG-026: Kritik öncelikte son onay Operasyon Yöneticisindedir.
  if (oncelik === 'Kritik') {
    await kartAc(c, { tur: 'Kritik Öncelik Teyidi', baslik: `${no} · Kritik Öncelik Teyidi`, ozet: g.ihtiyac.trim().slice(0, 200), oncelik: 'Kritik', hazirlayan: kullanici, zincir: [await rolId(c, 'Operasyon Yöneticisi')], nesneTuru: 'Talep', nesneKimligi: id });
    await bildir(c, { olay: `acil-ihbar:${id}`, kullanicilar: await rolSahipleri(c, await rolId(c, 'Operasyon Müdürü')), baslik: `Acil İhbar: ${no}`, ozet: g.ihtiyac.trim().slice(0, 200), oncelik: 'Kritik', acil: true, sms: true, isRef: null }, simdi);
  }
  return { kimlik: id, talepNo: no, oncelik, onerilen };
}

/** YG-022, BLD-35: ihbar eden kim olursa olsun yat sahibine/yetkilisine alındı bilgisi gider. Marina, sigorta ve yabancı sigortacı muhatap sayılmaz. */
export async function ihbarAlindiGonder(c: Db, talepId: string, web: string) {
  const t = (await c.query(
    `SELECT t.*, y.yat_adi, y.tur, o.telefon AS sahip_telefon, o.eposta AS sahip_eposta FROM talep t JOIN yat y ON y.kimlik = t.yat_ref LEFT JOIN taraf o ON o.kimlik = y.yat_sahibi_ref WHERE t.kimlik = $1`, [talepId])).rows[0];
  const yatTarafi = !IZLEME_ROLLERI.includes(t.talep_sahibi_turu) && !['Marina / Tesis', 'Yabancı Sigortacı / Sörveyör', 'Diğer'].includes(t.talep_sahibi_turu);
  const telefon = t.sahip_telefon ?? (yatTarafi ? t.talep_sahibi_telefon : null); const eposta = t.sahip_eposta ?? (yatTarafi ? t.talep_sahibi_eposta : null);
  if (!telefon && !eposta) {
    await kartAc(c, { tur: 'Eksik Bilgi', kategori: 'gorev', baslik: `${t.talep_no} · Yat Sahibi İletişim Bilgisi Eksik`, ozet: 'İhbar Alındı bilgilendirmesi gönderilemedi; yat sahibi veya yetkilisinin iletişim bilgisini giriniz.', sahipKullanici: t.ilk_sorumlu_ref, nesneTuru: 'Talep', nesneKimligi: talepId });
    return false;
  }
  // YG-723, K-205: bakım ve planlı hizmette "geçmiş olsun" içermeyen BLD-35P varyantı seçilir.
  const planli = t.oncelik === 'Planlı' || /planlı|bakım/i.test(t.ihbar_alindi_varyanti ?? '');
  // YG-1437: yat sahibi kurumsal müşteriyse İhbar Alındı, Ek-2'de yetkili olarak tanımlı kurum kullanıcılarının e-postasına gider (yat sahibi kişisel kanalı yerine).
  const kurum = (await c.query(`SELECT DISTINCT h.e_posta FROM yat y JOIN kurumsal_kurum k ON k.taraf_ref = y.yat_sahibi_ref JOIN kurumsal_kullanici u ON u.kurum_ref = k.kimlik AND u.yetkili JOIN kullanici_hesabi h ON h.kimlik = u.kullanici_ref WHERE y.kimlik = $1 AND h.hesap_durumu = 'Aktif' AND h.e_posta IS NOT NULL`, [t.yat_ref])).rows.map((r) => r.e_posta as string);
  if (kurum.length) {
    let n = false;
    for (const e of kurum) n = (await yatTarafinaYaz(c, { olay: `bld35:${talepId}:${e}`, kod: planli ? 'BLD-35P' : 'BLD-35', dil: dilKod(t.yazisma_dili), konu: `${t.talep_no} İhbar Alındı`, eposta: e, oncelik: t.oncelik, acil: t.acil_durum,
      alanlar: { 'Tekne türü + Yat': [t.tur, t.yat_adi].filter(Boolean).join(' '), 'Boat type + Yacht': [t.tur, t.yat_adi].filter(Boolean).join(' '), 'Dosya No': t.talep_no, 'File No': t.talep_no, 'bağlantı': web, link: web } })) || n;
    return n;
  }
  return yatTarafinaYaz(c, { olay: `bld35:${talepId}`, kod: planli ? 'BLD-35P' : 'BLD-35', dil: dilKod(t.yazisma_dili), konu: `${t.talep_no} İhbar Alındı`, telefon, eposta, oncelik: t.oncelik, acil: t.acil_durum,
    alanlar: { 'Tekne türü + Yat': [t.tur, t.yat_adi].filter(Boolean).join(' '), 'Boat type + Yacht': [t.tur, t.yat_adi].filter(Boolean).join(' '), 'Dosya No': t.talep_no, 'File No': t.talep_no, 'bağlantı': web, link: web } });
}

export function ihbarYollari(s: FastifyInstance, b: Baglam) {
  const ihbarci = { preHandler: izinGerekli(b, 'ihbar.kaydet') };

  s.get('/ihbar/secenek', ihbarci, async () => {
    const [kanallar, turler, yetki, sorular, tekneTuru, govde, klas, sifat] = await Promise.all(['LST_TALEP_KANALI', 'LST_TALEP_SAHIBI_TURU', 'LST_IHBAR_YETKI_DURUMU', 'LST_IHBAR_ONCELIK_SORUSU', 'LST_TEKNE_TURU', 'LST_GOVDE_MALZEMESI', 'LST_KLAS_DURUMU', 'LST_SIFAT'].map((k) => liste(b.db, k)));
    return { kanallar: kanallar!.map((x) => x.deger), turler: turler!.map((x) => x.deger), yetki: yetki!.map((x) => x.deger), sorular: sorular!.map((x) => x.deger), tekneTuru: tekneTuru!.map((x) => x.deger), govde: govde!.map((x) => x.deger), klas: klas!.map((x) => x.deger), sifat: sifat!.map((x) => x.deger), oncelikler: [...ONCELIK_SIRA].reverse() };
  });

  // YG-033: form doldurulurken önerilen öncelik.
  // YG-278: kesinti öncesi nöbet için numaralı alternatif kayıt formu bloğu; numaralar tekildir, boş formlar PDF olarak yazdırılır.
  s.post('/alternatif-form/blok', ihbarci, async (i, y) => {
    const adet = Number(((i.body ?? {}) as { adet?: number }).adet ?? 10);
    if (!Number.isInteger(adet) || adet < 1 || adet > 50) return y.code(400).send({ hata: 'Adet 1 ile 50 arasında olmalıdır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN'); await c.query(`SELECT pg_advisory_xact_lock(hashtext('alternatif_form_blogu'))`);
      const yil = Number(new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 4));
      const bas = Number((await c.query(`SELECT coalesce(max(bitis), 0) n FROM alternatif_form_blogu WHERE yil = $1`, [yil])).rows[0].n) + 1;
      if (bas + adet - 1 > 9999) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu yılın numara aralığı dolmuştur.' }); }
      const k = (await c.query(`INSERT INTO alternatif_form_blogu (yil, baslangic, bitis, veren_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [yil, bas, bas + adet - 1, i.oturum!.kullanici])).rows[0].kimlik;
      await izYaz(c, { aktor: i.oturum!.kullanici, oturum: i.oturum!.oturum, eylem: 'Alternatif Form Bloğu', nesneTuru: 'Alternatif Form Bloğu', nesneKimligi: k, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      const no = (n: number) => `ALT-${yil}-${String(n).padStart(4, '0')}`;
      return { kimlik: k, ilk: no(bas), son: no(bas + adet - 1) };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.get('/alternatif-form/blok/:id/pdf', ihbarci, async (i, y) => {
    const { id } = i.params as { id: string };
    const k = UUID.test(id) ? (await b.db.query(`SELECT yil, baslangic, bitis FROM alternatif_form_blogu WHERE kimlik = $1`, [id])).rows[0] : null;
    if (!k) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    const bos = '________________________________';
    const alan = ['Bildirim Tarihi ve Saati', 'Kanal (Telefon / WhatsApp / E-posta)', 'Bildiren Adı Soyadı ve Sıfatı', 'Bildiren Telefonu', 'Yat Adı', 'Yatın Konumu', 'Olay ve İhtiyaç', 'Can, Çevre veya Batma Riski (Evet / Hayır)', 'Alınan İlk Önlem', 'Kaydı Alan (Rol)'];
    const bolumler = [] as import('./pdf.js').Bolum[];
    for (let n = k.baslangic; n <= k.bitis; n++) bolumler.push({ baslik: `Form No: ALT-${k.yil}-${String(n).padStart(4, '0')}`, tur: 'alanlar', alanlar: alan.map((et) => ({ et, deger: bos, genis: true })) });
    const ilk = `ALT-${k.yil}-${String(k.baslangic).padStart(4, '0')}`;
    const pdf = await (await import('./pdf.js')).pdfUret({ ad: 'Alternatif Kayıt Formu', no: ilk, tarih: (await import('./metin.js')).gunAy(new Date()), surum: 'Rev.0', dil: 'tr', bolumler });
    return y.type('application/pdf').header('Content-Disposition', `inline; filename="${ilk}.pdf"`).send(pdf);
  });

  s.post('/ihbar/oncelik-oner', ihbarci, async (i) => {
    const g = (i.body ?? {}) as { cevaplar?: Record<string, string>; acil?: boolean };
    return { onerilen: await oncelikOner(b.db, g.cevaplar ?? {}, Boolean(g.acil)) };
  });

  s.post('/ihbar', ihbarci, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as IhbarGirdisi;
    // YG-278: kesintide alternatif formla alınan ihbar; form numarası ve formdaki gerçek bildirim zamanı zorunlu, aynı form iki kez aktarılmaz.
    const alt = ((i.body as { alternatifFormNo?: string }).alternatifFormNo ?? '').trim();
    if (alt) {
      if (!g.bildirimZamani) return y.code(400).send({ hata: 'Alternatif formdaki bildirim zamanını giriniz.' });
      if ((await b.db.query(`SELECT talep_no FROM talep WHERE lower(alternatif_form_no) = lower($1)`, [alt])).rowCount) return y.code(409).send({ hata: 'Bu alternatif form daha önce aktarılmıştır.' });
      const an = /^ALT-(\d{4})-(\d{4})$/i.exec(alt); // YG-278: sistemden alınan numara verilmiş bir blokta olmalıdır
      if (an && !(await b.db.query(`SELECT 1 FROM alternatif_form_blogu WHERE yil = $1 AND $2 BETWEEN baslangic AND bitis`, [Number(an[1]), Number(an[2])])).rowCount) return y.code(409).send({ hata: 'Bu numara verilmiş bir alternatif form bloğunda değildir.' });
    }
    // YG-1438: Dosya Sorumlusu bayrak, özel/ticari kullanım ve klas durumunu girer; yabancı bayrakta Türkiye'de kalış bitişi sorulur.
    if (!g.yat?.yatId && (!g.yat?.bayrak?.trim() || !['Özel', 'Ticari'].includes(g.yat?.kullanim ?? '') || !['Evet', 'Hayır', 'Bilinmiyor'].includes(g.yat?.klas ?? ''))) return y.code(400).send({ hata: 'Bayrak, kullanım (Özel/Ticari) ve klas durumunu (Evet/Hayır/Bilinmiyor) giriniz.' });
    if (g.yat?.klas === 'Evet' && !g.yat.klasKurulusu?.trim() && !g.yat?.yatId) return y.code(400).send({ hata: 'Klaslı yatta klas kuruluşunu yazınız.' });
    if (!g.yat?.yatId && !g.yat?.markaModelId && (!g.yat?.markaDiger?.trim() || !g.yat?.modelDiger?.trim())) return y.code(400).send({ hata: '"Diğer" seçildiğinde marka ve modeli yazınız; bilinmiyorsa "Bilinmiyor" yazınız.' }); // YG-018
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = await ihbarKaydet(c, g, o.kullanici, { ilkSorumlu: o.kullanici });
      if ('hata' in r) { await c.query('ROLLBACK'); return y.code(400).send({ hata: r.hata }); }
      if (alt) await c.query(`UPDATE talep SET alternatif_form_no = $2 WHERE kimlik = $1`, [r.kimlik, alt]); // YG-278
      await ihbarAlindiGonder(c, r.kimlik, b.webAdresi);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İhbar Kaydedildi', nesneTuru: 'Talep', nesneKimligi: r.kimlik, yeni: { no: r.talepNo, oncelik: r.oncelik }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.get('/ihbar', ihbarci, async () => (await b.db.query(
    `SELECT t.kimlik, t.talep_no, t.statu, t.ilk_siniflandirma, t.eksik_bilgiler, t.oncelik, t.ihtiyac_tanimi, t.iletisim_kisileri, t.yat_mevcut_konumu, t.bildirim_alinma_zamani, t.ilk_yanit_zamani, t.talep_sahibi_adi, t.talep_sahibi_turu, y.yat_adi, u.bitis AS ilk_yanit_son
       FROM talep t JOIN yat y ON y.kimlik = t.yat_ref LEFT JOIN dosya_sure u ON u.talep_ref = t.kimlik AND u.tur = 'İlk Yanıt'
      WHERE t.statu NOT IN ('Dosyaya Dönüştü', 'Birleştirildi', 'Kapsam Dışı / Yönlendirme') ORDER BY array_position(ARRAY['Kritik','Yüksek','Normal','Planlı'], t.oncelik), t.bildirim_alinma_zamani LIMIT 200`)).rows);

  s.get('/ihbar/:id', ihbarci, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'İhbar kaydı bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    const t = (await b.db.query(
      `SELECT t.*, y.yat_adi, y.tur AS yat_turu, y.tam_boy_m, y.govde_malzemesi, y.bayrak, y.kullanim_amaci, y.gecici_kayit, y.katalog_teyit, coalesce(m.marka, y.marka_diger) AS marka, coalesce(m.model, y.model_diger) AS model, o.unvan_ad_soyad AS yat_sahibi, u.bitis AS ilk_yanit_son, d.dosya_no AS bagli_dosya, a.dosya_no AS mukerrer_dosya_no
         FROM talep t JOIN yat y ON y.kimlik = t.yat_ref LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref LEFT JOIN taraf o ON o.kimlik = y.yat_sahibi_ref LEFT JOIN dosya_sure u ON u.talep_ref = t.kimlik AND u.tur = 'İlk Yanıt' LEFT JOIN dosya d ON d.kimlik = t.dosya_ref LEFT JOIN dosya a ON a.kimlik = t.mukerrer_dosya_ref WHERE t.kimlik = $1`, [id])).rows[0];
    if (!t) return y.code(404).send({ hata: 'İhbar kaydı bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    // YG-023: olası mükerrer kayıtlar listelenir; birleştirme kullanıcı kararıyladır.
    const adaylar = (await b.db.query(
      `SELECT d.kimlik, d.dosya_no, d.statu, d.oncelik, d.konum, d.kisa_teknik_tanim, y.yat_adi, CASE WHEN d.yat_ref = $1 THEN 'Aynı Yat' ELSE 'Benzer Yat Adı' END AS neden
         FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.statu <> 'Kapalı' AND (d.yat_ref = $1 OR lower(y.yat_adi) = lower($2)) ORDER BY d.acilis_tarihi DESC LIMIT 10`, [t.yat_ref, t.yat_adi])).rows;
    return { ...t, adaylar };
  });

  s.post('/ihbar/:id/ilk-yanit', ihbarci, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'İhbar kaydı bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    const r = await b.db.query(`UPDATE talep SET ilk_yanit_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1 AND ilk_yanit_zamani IS NULL RETURNING kimlik`, [id]);
    if (!r.rowCount) return y.code(409).send({ hata: 'İlk yanıt daha önce kaydedilmiştir.' });
    await sureBitir(b.db, { tur: 'İlk Yanıt', talep: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İlk Yanıt Kaydedildi', nesneTuru: 'Talep', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  s.post('/ihbar/:id/yetki', ihbarci, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { durum?: string; dayanak?: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'İhbar kaydı bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    if (!(await liste(b.db, 'LST_IHBAR_YETKI_DURUMU')).some((x) => x.deger === g.durum)) return y.code(400).send({ hata: 'Yetki durumunu seçiniz.' });
    if (g.durum === 'Doğrulandı' && !g.dayanak?.trim()) return y.code(400).send({ hata: 'Doğrulamanın dayanağını yazınız.' });
    const r = await b.db.query(`UPDATE talep SET ihbar_yetki_durumu = $2, yetki_dayanagi_beyani = coalesce($3, yetki_dayanagi_beyani), statu = CASE WHEN statu = 'Doğrulama Bekliyor' AND $2 = 'Doğrulandı' THEN 'Teknik Ön İnceleme' ELSE statu END, guncelleme_zamani = now() WHERE kimlik = $1 AND dosya_ref IS NULL RETURNING kimlik`, [id, g.durum, g.dayanak?.trim() || null]);
    if (!r.rowCount) return y.code(404).send({ hata: 'İhbar kaydı bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İhbar Yetki Durumu', nesneTuru: 'Talep', nesneKimligi: id, yeni: { durum: g.durum }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-023, YG-007: kontrol tamamlanmadan ilk kayıt tamamlanmış sayılmaz; ikinci ihbar ilk dosyaya bağlanır, yat sahibine ilk dosyanın numarası bildirilir.
  s.post('/ihbar/:id/mukerrerlik', ihbarci, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; dosya?: string; gerekce?: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'İhbar kaydı bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    if (!['Mükerrer değil', 'Mevcut dosyaya bağlandı', 'Ayrı olay (gerekçeli)'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Kontrol sonucunu seçiniz.' });
    if (g.sonuc === 'Ayrı olay (gerekçeli)' && !g.gerekce?.trim()) return y.code(400).send({ hata: 'Ayrım gerekçesi zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      const t = (await c.query(`SELECT * FROM talep WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      if (!t) return dur(404, 'İhbar bulunamadı.');
      if (t.dosya_ref || ['Birleştirildi', 'Kapsam Dışı / Yönlendirme'].includes(t.statu)) return dur(409, 'Bu ihbar sonuçlanmıştır.');
      let hedef: { kimlik: string; dosya_no: string } | undefined;
      if (g.sonuc === 'Mevcut dosyaya bağlandı') {
        if (!g.dosya || !UUID.test(g.dosya)) return dur(400, 'Bağlanacak dosyayı seçiniz.');
        hedef = (await c.query(`SELECT kimlik, dosya_no FROM dosya WHERE kimlik = $1`, [g.dosya])).rows[0];
        if (!hedef) return dur(404, 'Dosya bulunamadı.');
      }
      await c.query(`UPDATE talep SET mukerrerlik_sonucu = $2, mukerrer_dosya_ref = $3, ayrim_gerekcesi = $4, statu = CASE WHEN $3::uuid IS NOT NULL THEN 'Birleştirildi' ELSE statu END, guncelleme_zamani = now() WHERE kimlik = $1`, [id, g.sonuc, hedef?.kimlik ?? null, g.gerekce?.trim() || null]);
      if (hedef) {
        await sureBitir(c, { tur: 'İlk Yanıt', talep: id });
        await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
        await disGonder(c, { olay: `birlesti:${id}`, telefon: t.talep_sahibi_telefon, eposta: t.talep_sahibi_eposta, konu: `${hedef.dosya_no} Dosya Bilgisi`, metin: `LİMİT GLOBAL MARINE: Bildiriminiz ${hedef.dosya_no} numaralı mevcut dosyanızla birleştirilmiştir. Bundan sonraki işlemlerde bu numarayı kullanınız.` });
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Mükerrerlik Kontrolü', nesneTuru: 'Talep', nesneKimligi: id, yeni: { sonuc: g.sonuc, dosya: hedef?.dosya_no }, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true, dosyaNo: hedef?.dosya_no ?? null };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
