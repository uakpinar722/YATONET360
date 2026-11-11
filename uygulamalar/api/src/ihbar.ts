import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, disGonder } from './bildirim.js';
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
export async function yatTarafinaYaz(c: Db, g: { olay: string; kod: string; dil: Dil; alanlar: Record<string, string | string[]>; telefon?: string | null; eposta?: string | null; konu: string; oncelik?: string; acil?: boolean }) {
  return disGonder(c, { olay: g.olay, telefon: g.telefon, eposta: g.eposta, konu: g.konu, metin: await metinGetir(c, g.kod, g.dil, g.alanlar), oncelik: g.oncelik, acil: g.acil });
}

interface IhbarGirdisi {
  bildirimZamani?: string; kanal?: string; sahibiAdi?: string; sahibiTuru?: string; sahibiTuruAciklama?: string; yetkiDurumu?: string; sifat?: string; telefon?: string; eposta?: string; yetkiBeyani?: string;
  yat?: YatGirdisi; yatSahibi?: { ad?: string; telefon?: string; eposta?: string; kisiTuru?: string };
  olayTarihi?: string; olayYeri?: string; konum?: string; yatDurumu?: string; ihtiyac?: string; acil?: boolean; cevaplar?: Record<string, string>; oncelik?: string; hedefTarih?: string;
  sigortaci?: string; policeNo?: string; hasarNo?: string; ozgun?: string; dil?: string; varyant?: string;
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
  if (g.eposta && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.eposta)) return { hata: 'E-posta adresi geçersiz.' };
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
  if (!ONCELIK_SIRA.includes(oncelik)) return { hata: 'Öncelik geçersiz.' };
  // YG-036: yükseltme serbest; önerinin altına inmek ancak açılıştan sonra gerekçe ve iki onayla olur.
  if (ONCELIK_SIRA.indexOf(oncelik) < ONCELIK_SIRA.indexOf(onerilen)) return { hata: 'Öncelik düşürme, dosya açıldıktan sonra gerekçeyle talep edilir; sistemin önerdiği öncelik korunmuştur.' };
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
  await sureBaslat(c, { tur: 'İlk Yanıt', oncelik, baslangic: bildirimZamani, talep: id });
  await kartAc(c, { tur: 'İhbar Açılış Kontrolü', kategori: 'gorev', baslik: `${no} · Mükerrerlik ve Açılış Kontrolü`, ozet: g.ihtiyac.trim().slice(0, 200), oncelik: oncelik === 'Kritik' ? 'Kritik' : 'Normal', sahipKullanici: baglam.ilkSorumlu, hazirlayan: kullanici, nesneTuru: 'Talep', nesneKimligi: id });
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
  s.post('/ihbar/oncelik-oner', ihbarci, async (i) => {
    const g = (i.body ?? {}) as { cevaplar?: Record<string, string>; acil?: boolean };
    return { onerilen: await oncelikOner(b.db, g.cevaplar ?? {}, Boolean(g.acil)) };
  });

  s.post('/ihbar', ihbarci, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as IhbarGirdisi;
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = await ihbarKaydet(c, g, o.kullanici, { ilkSorumlu: o.kullanici });
      if ('hata' in r) { await c.query('ROLLBACK'); return y.code(400).send({ hata: r.hata }); }
      await ihbarAlindiGonder(c, r.kimlik, b.webAdresi);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İhbar Kaydedildi', nesneTuru: 'Talep', nesneKimligi: r.kimlik, yeni: { no: r.talepNo, oncelik: r.oncelik }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.get('/ihbar', ihbarci, async () => (await b.db.query(
    `SELECT t.kimlik, t.talep_no, t.statu, t.oncelik, t.ihtiyac_tanimi, t.yat_mevcut_konumu, t.bildirim_alinma_zamani, t.ilk_yanit_zamani, t.talep_sahibi_adi, t.talep_sahibi_turu, y.yat_adi, u.bitis AS ilk_yanit_son
       FROM talep t JOIN yat y ON y.kimlik = t.yat_ref LEFT JOIN dosya_sure u ON u.talep_ref = t.kimlik AND u.tur = 'İlk Yanıt'
      WHERE t.statu NOT IN ('Dosyaya Dönüştü', 'Birleştirildi', 'Kapsam Dışı / Yönlendirme') ORDER BY array_position(ARRAY['Kritik','Yüksek','Normal','Planlı'], t.oncelik), t.bildirim_alinma_zamani LIMIT 200`)).rows);

  s.get('/ihbar/:id', ihbarci, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'İhbar bulunamadı.' });
    const t = (await b.db.query(
      `SELECT t.*, y.yat_adi, y.tur AS yat_turu, y.tam_boy_m, y.govde_malzemesi, y.bayrak, y.kullanim_amaci, y.gecici_kayit, y.katalog_teyit, coalesce(m.marka, y.marka_diger) AS marka, coalesce(m.model, y.model_diger) AS model, o.unvan_ad_soyad AS yat_sahibi, u.bitis AS ilk_yanit_son, d.dosya_no AS bagli_dosya, a.dosya_no AS mukerrer_dosya_no
         FROM talep t JOIN yat y ON y.kimlik = t.yat_ref LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref LEFT JOIN taraf o ON o.kimlik = y.yat_sahibi_ref LEFT JOIN dosya_sure u ON u.talep_ref = t.kimlik AND u.tur = 'İlk Yanıt' LEFT JOIN dosya d ON d.kimlik = t.dosya_ref LEFT JOIN dosya a ON a.kimlik = t.mukerrer_dosya_ref WHERE t.kimlik = $1`, [id])).rows[0];
    if (!t) return y.code(404).send({ hata: 'İhbar bulunamadı.' });
    // YG-023: olası mükerrer kayıtlar listelenir; birleştirme kullanıcı kararıyladır.
    const adaylar = (await b.db.query(
      `SELECT d.kimlik, d.dosya_no, d.statu, d.oncelik, d.konum, d.kisa_teknik_tanim, y.yat_adi, CASE WHEN d.yat_ref = $1 THEN 'Aynı Yat' ELSE 'Benzer Yat Adı' END AS neden
         FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.statu <> 'Kapalı' AND (d.yat_ref = $1 OR lower(y.yat_adi) = lower($2)) ORDER BY d.acilis_tarihi DESC LIMIT 10`, [t.yat_ref, t.yat_adi])).rows;
    return { ...t, adaylar };
  });

  s.post('/ihbar/:id/ilk-yanit', ihbarci, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'İhbar bulunamadı.' });
    const r = await b.db.query(`UPDATE talep SET ilk_yanit_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1 AND ilk_yanit_zamani IS NULL RETURNING kimlik`, [id]);
    if (!r.rowCount) return y.code(409).send({ hata: 'İlk yanıt daha önce kaydedilmiştir.' });
    await sureBitir(b.db, { tur: 'İlk Yanıt', talep: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İlk Yanıt Kaydedildi', nesneTuru: 'Talep', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  s.post('/ihbar/:id/yetki', ihbarci, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { durum?: string; dayanak?: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'İhbar bulunamadı.' });
    if (!(await liste(b.db, 'LST_IHBAR_YETKI_DURUMU')).some((x) => x.deger === g.durum)) return y.code(400).send({ hata: 'Yetki durumunu seçiniz.' });
    if (g.durum === 'Doğrulandı' && !g.dayanak?.trim()) return y.code(400).send({ hata: 'Doğrulamanın dayanağını yazınız.' });
    const r = await b.db.query(`UPDATE talep SET ihbar_yetki_durumu = $2, yetki_dayanagi_beyani = coalesce($3, yetki_dayanagi_beyani), statu = CASE WHEN statu = 'Doğrulama Bekliyor' AND $2 = 'Doğrulandı' THEN 'Teknik Ön İnceleme' ELSE statu END, guncelleme_zamani = now() WHERE kimlik = $1 AND dosya_ref IS NULL RETURNING kimlik`, [id, g.durum, g.dayanak?.trim() || null]);
    if (!r.rowCount) return y.code(404).send({ hata: 'İhbar bulunamadı.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İhbar Yetki Durumu', nesneTuru: 'Talep', nesneKimligi: id, yeni: { durum: g.durum }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-023, YG-007: kontrol tamamlanmadan ilk kayıt tamamlanmış sayılmaz; ikinci ihbar ilk dosyaya bağlanır, yat sahibine ilk dosyanın numarası bildirilir.
  s.post('/ihbar/:id/mukerrerlik', ihbarci, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; dosya?: string; gerekce?: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'İhbar bulunamadı.' });
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
