import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const FYM = 'Firma Yönetimi Müdürü'; const TM = 'Teknik Müdür'; const HUD = 'Hukuk ve Uyum Direktörü'; const OPM = 'Operasyon Müdürü'; const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'; const TID = 'Ticari İşler Direktörü'; const TIC = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
export const ON_KOSULLAR = ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar'];
const SICIL_ROLLER = ['Sicil Sorumlusu', FYM, 'Firma Yönetimi Müdür Yardımcısı'];

/** YG-307: görev sınıfı ve asgari yetkinlik. */
export function gorevSinifi(g: { tutar?: number | null; cokBrans?: boolean; anaSistem?: boolean; kritik?: boolean }): { sinif: 'G1' | 'G2' | 'G3' | 'G4'; asgari: 'Y1' | 'Y2' | 'Y3' | 'Y4' } {
  const t = Number(g.tutar ?? 0);
  if (g.kritik || t > 50000) return { sinif: 'G4', asgari: 'Y4' };
  if (g.cokBrans || g.anaSistem || t > 10000) return { sinif: 'G3', asgari: 'Y3' };
  if (t > 2000) return { sinif: 'G2', asgari: 'Y2' };
  return { sinif: 'G1', asgari: 'Y1' };
}

/** YG-304, YG-306, YG-307, YG-332: belgeler dışında sözleşme, yetkinlik, garanti, çıkar ve kapasite birlikte; en ucuz veya en yakın otomatik seçilmez. */
export async function gorevlendirmeKontrolu(db: Db, g: { firma: string; dosya: string; brans?: string | null; tutar?: number | null; cokBrans?: boolean; anaSistem?: boolean; kritik?: boolean }) {
  const engeller: string[] = []; const uyarilar: string[] = []; const { sinif, asgari } = gorevSinifi(g);
  const f = (await db.query(`SELECT risk_derecesi, kapasite_is FROM kurulus WHERE kimlik = $1`, [g.firma])).rows[0];
  if (g.brans) {
    const by = (await db.query(`SELECT yetkinlik_seviyesi, durum, kapsama FROM brans_yetkinligi WHERE kurulus_ref = $1 AND ana_brans = $2`, [g.firma, g.brans])).rows;
    if (by.length && by.every((x) => x.durum === 'Doğrulama Bekliyor')) engeller.push('Firmanın bu branştaki belgeleri doğrulanmamıştır.');
    const en = by.filter((x) => x.durum === 'Aktif').map((x) => x.yetkinlik_seviyesi as string | null).filter(Boolean).sort().pop();
    if (en && en < asgari) engeller.push(`Bu iş ${sinif} sınıfındadır; en az ${asgari} yetkinlik gerekir.`);
  }
  const d = (await db.query(`SELECT d.garantili_ekipman, d.garantili_ekipman_marka, d.garanti_bitis, y.yat_sahibi_ref FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [g.dosya])).rows[0];
  if (d?.garantili_ekipman && d.garantili_ekipman_marka && d.garanti_bitis && new Date(d.garanti_bitis) >= new Date(new Date().toISOString().slice(0, 10)) && !(await db.query(`SELECT 1 FROM yetkili_servis WHERE kurulus_ref = $1 AND lower(marka) = lower($2)`, [g.firma, d.garantili_ekipman_marka])).rowCount) engeller.push(`Garanti süresindeki ${d.garantili_ekipman_marka} ekipmanında iş yalnız yetkili servise verilir.`);
  if (d?.yat_sahibi_ref && (await db.query(`SELECT 1 FROM cikar_beyani WHERE kurulus_ref = $1 AND taraf_ref = $2`, [g.firma, d.yat_sahibi_ref])).rowCount) engeller.push('Firmanın bu yat sahibiyle çıkar çatışması beyanı vardır.');
  if (f?.risk_derecesi === 'Yakın İzleme') uyarilar.push('Firma yakın izlemededir.');
  if (f?.kapasite_is && Number((await db.query(`SELECT count(*) n FROM is_emri WHERE kurulus_ref = $1 AND statu IN ('Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif')`, [g.firma])).rows[0].n) >= f.kapasite_is) uyarilar.push('Firmanın beyan ettiği iş kapasitesi doludur.');
  if (!(await db.query(`SELECT 1 FROM sicil_belgesi WHERE kurulus_ref = $1 AND tur ILIKE '%sigorta%' AND (gecerlilik_bitis IS NULL OR gecerlilik_bitis >= current_date) LIMIT 1`, [g.firma])).rowCount) uyarilar.push('Firmanın sorumluluk sigortası kaydı yoktur.');
  return { sinif, asgari, sonuc: engeller.length ? 'Ret' as const : uyarilar.length ? 'Koşullu Kabul' as const : 'Kabul' as const, engeller, uyarilar };
}

/** YG-337: kurtarma görevlendirmesinde Türk bayrağı, römorkörcülük izni ve dalış belgesi zorunlu kanıt. */
export async function kurtarmaBelgeEngeli(db: Db, firma: string, hizmet: string): Promise<string | null> {
  const gerek = ['Türk Bayrağı Belgesi']; if (['Çekme / Refakat', 'Kurtarma', 'Birden Fazla'].includes(hizmet)) gerek.push('Römorkörcülük Faaliyet İzni'); if (['Dalgıçlık', 'Birden Fazla'].includes(hizmet)) gerek.push('Dalış Belgesi');
  for (const t of gerek) if (!(await db.query(`SELECT 1 FROM sicil_belgesi WHERE kurulus_ref = $1 AND tur = $2 AND (gecerlilik_bitis IS NULL OR gecerlilik_bitis >= current_date) LIMIT 1`, [firma, t])).rowCount) return `Kurtarma görevlendirmesi için firmanın ${t} kaydı bekleniyor.`;
  return null;
}

/** YG-409: motorlu yatta suda ana makine hizası kontrol edilmeden deniz denemesi açılmaz. */
export async function hizaEngeli(db: Db, dosya: string): Promise<string | null> {
  const r = (await db.query(`SELECT d.hiza_kontrol_zamani, y.tahrik_turu FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (r?.hiza_kontrol_zamani || /yelken/i.test(r?.tahrik_turu ?? '')) return null;
  return 'Deniz denemesi için suda ana makine hizası kontrolü bekleniyor.';
}

/** YG-143: haciz veya tedbirli yat Hukuk ve Uyum Direktörü onayı olmadan taşınamaz, tesis değiştiremez. */
export async function takyidatTasimaEngeli(db: Db, dosya: string): Promise<string | null> {
  const y = (await db.query(`SELECT y.takyidat FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (!((y?.takyidat ?? []) as string[]).some((x) => x === 'Haciz' || x.startsWith('İhtiyati') || /tedbir/i.test(x))) return null;
  return (await db.query(`SELECT 1 FROM is_karti WHERE tur = 'Taşıma Onayı' AND nesne_kimligi = $1 AND durum = 'Onaylandı' LIMIT 1`, [dosya])).rowCount ? null : 'Haciz veya tedbir kaydı olan yat için Hukuk ve Uyum Direktörü onayı bekleniyor.';
}

/** YG-867: muadil parça listede olmalı ve ONY-07 onayı alınmış olmalı. */
export async function muadilEngeli(db: Db, dosya: string, orijinal: string, muadil: string, parcaAdi: string): Promise<string | null> {
  if (!(await db.query(`SELECT 1 FROM onayli_parca WHERE orijinal_parca_no = $1 AND muadil_parca_no = $2`, [orijinal, muadil])).rowCount) return 'Muadil parça onaylı listede değildir; üretici eşdeğerlik belgesi veya klas onayı bekleniyor.';
  return (await db.query(`SELECT 1 FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-07' AND durum = 'Onaylandı' AND metin LIKE '%' || $2 || '%' LIMIT 1`, [dosya, parcaAdi])).rowCount ? null : 'Muadil parça için müşteri onayı bekleniyor.';
}

/** YG-312, YG-416: kapanışta paylaşım bağlantıları ve konum gönderimi kapanır, süren yükümlülük göreve dönüşür. */
export async function dosyaKapanisIsleri(c: Db, dosya: string) {
  await c.query(`UPDATE paylasim_baglantisi p SET iptal_zamani = now() FROM belge_surum s JOIN belge b ON b.kimlik = s.belge_ref WHERE p.surum_ref = s.kimlik AND b.bag_turu = 'Dosya' AND b.bag_kimligi = $1 AND p.iptal_zamani IS NULL`, [dosya]);
  await c.query(`UPDATE acil_konum a SET aktif = false, durduran = 'Dosya Kapanışı', durma_zamani = now() FROM dosya d WHERE d.kimlik = $1 AND d.talep_ref = a.talep_ref AND a.aktif`, [dosya]);
  await c.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref = $1 AND rol = 'Saha Sorumlusu' AND bitis_zamani IS NULL`, [dosya]);
  const d = (await c.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  if (d?.dosya_sorumlusu_ref && await birKez(c, 'kapanis_yukumluluk', dosya)) await kartAc(c, { tur: 'Garanti İzleme', kategori: 'islem', baslik: `${d.dosya_no} · Garanti İzleme`, ozet: '12 aylık garanti süresince izlenir.', sonZaman: new Date(Date.now() + 365 * 86_400_000), sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: dosya });
}

/** YG-141: geçici onarım süresi ve kontrol hatırlatması; su alma riskinde ilk 3 gün her gün, sonra haftalık, diğerlerinde haftalık. */
export async function geciciOnarimIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  for (const g of (await db.query(`SELECT o.*, d.dosya_no FROM gecici_onarim o JOIN dosya d ON d.kimlik = o.dosya_ref WHERE o.durum = 'Açık'`)).rows) {
    const gecen = Math.floor((simdi.getTime() - new Date(g.uygulama_tarihi).getTime()) / 86_400_000);
    if (new Date(g.son_gecerlilik).getTime() < simdi.getTime() - 86_400_000) { if (await birKez(db, 'gecici_sure', `${g.kimlik}:${g.uzatma_sayisi}`)) { await bildir(db, { olay: `gecici-sure:${g.kimlik}:${g.uzatma_sayisi}`, kullanicilar: [g.sorumlu_ref], baslik: `${g.dosya_no} · Geçici Onarım Süresi Doldu`, ozet: g.islem, oncelik: 'Yüksek' }); n++; } continue; }
    const kontrol = g.su_alma_riski && gecen <= 3 ? gecen >= 0 : gecen > 0 && gecen % 7 === 0;
    if (kontrol && await birKez(db, 'gecici_kontrol', `${g.kimlik}:${gecen}`)) { await bildir(db, { olay: `gecici-kontrol:${g.kimlik}:${gecen}`, kullanicilar: [g.sorumlu_ref], baslik: `${g.dosya_no} · Geçici Onarım Kontrolü`, ozet: g.islem }); n++; }
  }
  return n;
}

kapanisKaydet('Alt Yüklenici Talebi', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE alt_yuklenici_talebi SET durum = 'Onaylandı' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE alt_yuklenici_talebi SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
kapanisKaydet('Kalıcı Askı Önerisi', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE kurulus SET ag_statusu = 'Askıda', guncelleme_zamani = now() WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

export function firmaEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const firmam = async (k: string) => (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;
  const dosyaBelgesi = async (belge: string | undefined, dosya: string) => Boolean(belge && UUID.test(belge) && (await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi::text = $2`, [belge, dosya])).rowCount);
  const isGunuGecti = (t: Date, gun: number) => { let d = new Date(t); let n = 0; while (n < gun) { d = new Date(d.getTime() + 86_400_000); if (d.getDay() !== 0) n++; } return Date.now() > d.getTime(); };

  // Sicil: yetkili servis, çıkar beyanı, kapasite, kaptan.
  s.post('/firma/:id/sicil-ek', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { marka?: string; cikarTaraf?: string; cikarNot?: string; kapasite?: number };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, SICIL_ROLLER))) return yok(y);
    if (g.marka?.trim()) await b.db.query(`INSERT INTO yetkili_servis (kurulus_ref, marka) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, g.marka.trim()]);
    if (g.cikarTaraf?.trim()) {
      const t = (await b.db.query(`SELECT kimlik FROM taraf WHERE taraf_no = $1`, [g.cikarTaraf.trim()])).rows[0];
      if (!t) return y.code(404).send({ hata: 'Bu numarada taraf kaydı bulunamadı.' });
      await b.db.query(`INSERT INTO cikar_beyani (kurulus_ref, taraf_ref, aciklama, kaydeden_ref) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [id, t.kimlik, g.cikarNot?.trim() || 'Beyan', o.kullanici]);
    }
    if (Number(g.kapasite) > 0) await b.db.query(`UPDATE kurulus SET kapasite_is = $2 WHERE kimlik = $1`, [id, g.kapasite]);
    return { tamam: true };
  });
  s.post('/firma/:id/kaptan', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; belge?: string; belgeBitis?: string; police?: string; policeBitis?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, SICIL_ROLLER))) return yok(y);
    if (!g.ad?.trim() || !g.belge?.trim() || !g.belgeBitis || !g.police?.trim() || !g.policeBitis) return y.code(400).send({ hata: 'Ad, yeterlilik belgesi, geçerlilik, poliçe ve poliçe bitişini girmenizi rica ederiz.' });
    const r = await b.db.query(`INSERT INTO kaptan_kaydi (kurulus_ref, ad_soyad, yeterlilik_belgesi, yeterlilik_bitis, police_no, police_bitis, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [id, g.ad.trim(), g.belge.trim(), g.belgeBitis, g.police.trim(), g.policeBitis, o.kullanici]);
    return { kimlik: r.rows[0].kimlik };
  });
  s.get('/kaptanlar', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    return (await b.db.query(`SELECT k.kimlik, k.ad_soyad, k.yeterlilik_bitis::text, k.police_bitis::text, u.ticari_unvan, (k.yeterlilik_bitis >= current_date AND k.police_bitis >= current_date) AS gecerli FROM kaptan_kaydi k JOIN kurulus u ON u.kimlik = k.kurulus_ref ORDER BY k.ad_soyad`)).rows;
  });
  s.post('/dosya/:id/kaptan-gorevlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const kaptan = ((i.body ?? {}) as { kaptan?: string }).kaptan;
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!kaptan || !UUID.test(kaptan)) return y.code(400).send({ hata: 'Kaptanı seçmenizi rica ederiz.' });
    const k = (await b.db.query(`SELECT yeterlilik_bitis >= current_date AS b, police_bitis >= current_date AS p FROM kaptan_kaydi WHERE kimlik = $1`, [kaptan])).rows[0];
    if (!k) return yok(y);
    if (!k.b) return y.code(409).send({ hata: 'Kaptanın yeterlilik belgesinin süresi dolmuştur.' });
    if (!k.p) return y.code(409).send({ hata: 'Kaptanın mesleki sorumluluk poliçesinin süresi dolmuştur.' });
    await b.db.query(`INSERT INTO kaptan_gorevlendirme (dosya_ref, kaptan_ref, yapan_ref) VALUES ($1,$2,$3)`, [id, kaptan, o.kullanici]);
    return { tamam: true };
  });

  s.post('/dosya/:id/hiza-kontrolu', oturumlu, async (i, y) => { // YG-409
    const o = i.oturum!; const { id } = i.params as { id: string }; const { belge } = (i.body ?? {}) as { belge?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await dosyaBelgesi(belge, id))) return y.code(400).send({ hata: 'Hiza ölçüm kaydını eklemenizi rica ederiz.' });
    await b.db.query(`UPDATE dosya SET hiza_kontrol_zamani = now(), hiza_kontrol_belge = $2 WHERE kimlik = $1`, [id, belge]);
    return { tamam: true };
  });

  // YG-411: alt yüklenici önceden onaya bağlıdır.
  s.post('/firma-portal/is-emri/:id/alt-yuklenici', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; kapsam?: string }; const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT is_emri_no FROM is_emri WHERE kimlik = $1 AND kurulus_ref = $2`, [id, f])).rows[0];
    if (!e) return yok(y);
    if (!g.ad?.trim() || !g.kapsam?.trim()) return y.code(400).send({ hata: 'Alt yüklenici ve kapsamı yazmanızı rica ederiz.' });
    const r = (await b.db.query(`INSERT INTO alt_yuklenici_talebi (is_emri_ref, alt_yuklenici, kapsam, talep_eden_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [id, g.ad.trim(), g.kapsam.trim(), o.kullanici])).rows[0];
    await kartAc(b.db, { tur: 'Alt Yüklenici Talebi', baslik: `${e.is_emri_no} · Alt Yüklenici Talebi`, ozet: `${g.ad.trim()} · ${g.kapsam.trim()}`, hazirlayan: o.kullanici, zincir: [await rolId(b.db, OPM)], nesneTuru: 'Alt Yüklenici', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik };
  });

  // YG-423: garanti kararına 2 iş günü, rücu ve mahsuba 5 iş günü itiraz.
  s.get('/firma-portal/itirazlar', oturumlu, async (i, y) => {
    const f = await firmam(i.oturum!.kullanici);
    if (!f) return yok(y);
    const garanti = (await b.db.query(`SELECT kimlik, kayit_no, karar, karar_zamani, firma_itiraz FROM garanti_sikayet WHERE kurulus_ref = $1 AND karar = 'Garanti' ORDER BY olusturma_zamani DESC LIMIT 50`, [f])).rows;
    const mahsup = (await b.db.query(`SELECT kimlik, tur, tutar_eur, aciklama, onay_zamani, firma_itiraz FROM hakedis_mahsubu WHERE kurulus_ref = $1 AND statu = 'Onaylandı' AND tur <> 'Malzeme Avansı' ORDER BY olusturma_zamani DESC LIMIT 50`, [f])).rows;
    return { garanti, mahsup };
  });
  s.post('/firma-portal/garanti/:id/itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim(); const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT kayit_no, karar_zamani, firma_itiraz FROM garanti_sikayet WHERE kimlik = $1 AND kurulus_ref = $2 AND karar = 'Garanti'`, [id, f])).rows[0];
    if (!k) return yok(y);
    if (!g) return y.code(400).send({ hata: 'İtiraz gerekçenizi yazmanızı rica ederiz.' });
    if (k.firma_itiraz) return y.code(409).send({ hata: 'İtirazınız alınmıştır.' });
    if (k.karar_zamani && isGunuGecti(new Date(k.karar_zamani), 2)) return y.code(409).send({ hata: 'İki iş günlük itiraz süresi dolmuştur.' });
    await b.db.query(`UPDATE garanti_sikayet SET firma_itiraz = $2, firma_itiraz_zamani = now() WHERE kimlik = $1`, [id, g]);
    await kartAc(b.db, { tur: 'Garanti Kararı İtirazı', kategori: 'islem', baslik: `${k.kayit_no} · Firma İtirazı`, ozet: g, oncelik: 'Yüksek', sahipRol: await rolId(b.db, TM), nesneTuru: 'Garanti', nesneKimligi: id });
    return { durum: 'İtiraz Alındı' };
  });
  s.post('/firma-portal/mahsup/:id/itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim(); const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    const m = (await b.db.query(`SELECT tur, onay_zamani, firma_itiraz FROM hakedis_mahsubu WHERE kimlik = $1 AND kurulus_ref = $2 AND statu = 'Onaylandı'`, [id, f])).rows[0];
    if (!m) return yok(y);
    if (!g) return y.code(400).send({ hata: 'İtiraz gerekçenizi yazmanızı rica ederiz.' });
    if (m.firma_itiraz) return y.code(409).send({ hata: 'İtirazınız alınmıştır.' });
    if (m.onay_zamani && isGunuGecti(new Date(m.onay_zamani), 5)) return y.code(409).send({ hata: 'Beş iş günlük itiraz süresi dolmuştur.' });
    await b.db.query(`UPDATE hakedis_mahsubu SET firma_itiraz = $2, firma_itiraz_zamani = now() WHERE kimlik = $1`, [id, g]);
    await kartAc(b.db, { tur: 'Mahsup İtirazı', kategori: 'islem', baslik: `${m.tur} · Firma İtirazı`, ozet: g, oncelik: 'Yüksek', sahipRol: await rolId(b.db, TID), nesneTuru: 'Hakediş Mahsubu', nesneKimligi: id });
    return { durum: 'İtiraz Alındı' };
  });

  // V-186: itiraz sonuçlanana kadar mahsup durur. Kabulde mahsup iptal edilir, önceden düşülen tutar için iade görevi açılır; retle kaldığı yerden sürer.
  s.get('/mahsup-itirazlar', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [TID]))) return y.code(403).send({ hata: 'Mahsup itirazlarını Ticari İşler Direktörü görür.' });
    return (await b.db.query(`SELECT m.kimlik, m.tur, m.tutar_eur, m.kalan_eur, m.aciklama, m.firma_itiraz, u.ticari_unvan, d.dosya_no FROM hakedis_mahsubu m JOIN kurulus u ON u.kimlik = m.kurulus_ref JOIN dosya d ON d.kimlik = m.dosya_ref WHERE m.firma_itiraz IS NOT NULL AND m.itiraz_sonucu IS NULL ORDER BY m.firma_itiraz_zamani`)).rows;
  });
  s.post('/mahsup/:id/itiraz-karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; gerekce?: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [TID]))) return y.code(403).send({ hata: 'İtiraz kararını Ticari İşler Direktörü verir.' });
    if (!['Kabul', 'Ret'].includes(g.karar ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Karar ve gerekçeyi girmenizi rica ederiz.' });
    const m = (await b.db.query(`SELECT m.kurulus_ref, m.dosya_ref, m.tur, m.tutar_eur, m.kalan_eur, d.dosya_no FROM hakedis_mahsubu m JOIN dosya d ON d.kimlik = m.dosya_ref WHERE m.kimlik = $1 AND m.firma_itiraz IS NOT NULL AND m.itiraz_sonucu IS NULL`, [id])).rows[0];
    if (!m) return y.code(409).send({ hata: 'Karar bekleyen itiraz bulunmamaktadır.' });
    const dusulen = Math.round((Number(m.tutar_eur) - Number(m.kalan_eur)) * 100) / 100;
    await b.db.query(`UPDATE hakedis_mahsubu SET itiraz_sonucu = $2, itiraz_gerekcesi = $3, itiraz_karar_veren_ref = $4, itiraz_karar_zamani = now(), statu = CASE WHEN $2 = 'Kabul' THEN 'Reddedildi' ELSE statu END, kalan_eur = CASE WHEN $2 = 'Kabul' THEN 0 ELSE kalan_eur END WHERE kimlik = $1`, [id, g.karar, g.gerekce.trim(), o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Mahsup İtirazı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    if (g.karar === 'Kabul' && dusulen > 0) await kartAc(b.db, { tur: 'Mahsup İadesi', kategori: 'islem', baslik: `${m.dosya_no} · Mahsup İadesi`, ozet: `İtiraz kabul edildi; ödemeden düşülen ${dusulen.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR firmaya iade edilecektir.`, oncelik: 'Yüksek', sahipRol: await rolId(b.db, TIC), nesneTuru: 'Hakediş Mahsubu', nesneKimligi: id });
    const ku = (await b.db.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [m.kurulus_ref])).rows.map((r) => r.kullanici_ref as string);
    if (ku.length) await bildir(b.db, { olay: `mahsup-itiraz:${id}`, kullanicilar: ku, baslik: `${m.tur} · İtiraz Sonucu: ${g.karar === 'Kabul' ? 'Kabul Edildi' : 'Reddedildi'}`, ozet: g.gerekce.trim() });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Mahsup İtiraz Kararı', nesneTuru: 'Hakediş Mahsubu', nesneKimligi: id, yeni: { karar: g.karar, iade: dusulen }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: g.karar, iade: g.karar === 'Kabul' ? dusulen : 0 };
  });

  // YG-1660: görüşleri Firma Yönetimi Müdürü ister; Teknik Müdür, Hukuk ve Uyum, Operasyon Müdürü sırayla görüş verir, Direktör karar verir.
  s.post('/firma/:id/kalici-aski-onerisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [FYM]))) return y.code(403).send({ hata: 'Öneriyi Firma Yönetimi Müdürü başlatır.' });
    if (!g) return y.code(400).send({ hata: 'Gerekçeyi yazmanızı rica ederiz.' });
    const f = (await b.db.query(`SELECT ticari_unvan FROM kurulus WHERE kimlik = $1`, [id])).rows[0];
    if (!f) return yok(y);
    const k = await kartAc(b.db, { tur: 'Kalıcı Askı Önerisi', baslik: `${f.ticari_unvan} · Kalıcı Askı Önerisi`, ozet: g, oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(b.db, TM), await rolId(b.db, HUD), await rolId(b.db, OPM), await rolId(b.db, BTD)], nesneTuru: 'Kuruluş', nesneKimligi: id });
    return { kimlik: k };
  });

  // YG-141: geçici onarım en çok 30 gün; Teknik Yönetici en çok 2 uzatma, toplam 60 gün.
  s.post('/dosya/:id/gecici-onarim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { islem?: string; uygulama?: string; kullanim?: string; suAlma?: boolean; son?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g.islem?.trim() || !g.uygulama || !g.kullanim?.trim() || !g.son) return y.code(400).send({ hata: 'İşlem, uygulama tarihi, izin verilen kullanım ve son geçerliliği girmenizi rica ederiz.' });
    if ((new Date(g.son).getTime() - new Date(g.uygulama).getTime()) / 86_400_000 > 30) return y.code(400).send({ hata: 'Son geçerlilik uygulamadan en çok 30 gün olabilir.' });
    const r = await b.db.query(`INSERT INTO gecici_onarim (dosya_ref, islem, uygulama_tarihi, izinli_kullanim, su_alma_riski, son_gecerlilik, sorumlu_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [id, g.islem.trim(), g.uygulama, g.kullanim.trim(), Boolean(g.suAlma), g.son, o.kullanici]);
    return { kimlik: r.rows[0].kimlik };
  });
  s.get('/dosya/:id/gecici-onarim', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT kimlik, islem, uygulama_tarihi::text, son_gecerlilik::text, uzatma_sayisi, su_alma_riski, durum FROM gecici_onarim WHERE dosya_ref = $1 ORDER BY olusturma_zamani`, [id])).rows;
  });
  s.post('/gecici-onarim/:id/uzat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const son = ((i.body ?? {}) as { son?: string }).son;
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, ['Teknik Yönetici']))) return y.code(403).send({ hata: 'Uzatmayı Teknik Yönetici onaylar.' });
    const g = (await b.db.query(`SELECT uygulama_tarihi, uzatma_sayisi FROM gecici_onarim WHERE kimlik = $1`, [id])).rows[0];
    if (!g) return yok(y);
    if (!son) return y.code(400).send({ hata: 'Yeni son tarihi girmenizi rica ederiz.' });
    if (g.uzatma_sayisi >= 2) return y.code(409).send({ hata: 'En çok 2 uzatma yapılır.' });
    if ((new Date(son).getTime() - new Date(g.uygulama_tarihi).getTime()) / 86_400_000 > 60) return y.code(409).send({ hata: 'Toplam süre 60 günü aşamaz.' });
    await b.db.query(`UPDATE gecici_onarim SET son_gecerlilik = $2, uzatma_sayisi = uzatma_sayisi + 1, uzatma_onaylayan_ref = $3 WHERE kimlik = $1`, [id, son, o.kullanici]);
    return { tamam: true };
  });
  s.post('/gecici-onarim/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const g = (await b.db.query(`SELECT dosya_ref FROM gecici_onarim WHERE kimlik = $1`, [id])).rows[0];
    if (!g || !(await dosyaErisimi(b.db, o.kullanici, g.dosya_ref))) return yok(y);
    await b.db.query(`UPDATE gecici_onarim SET durum = 'Kapalı' WHERE kimlik = $1`, [id]);
    return { tamam: true };
  });

  // YG-142, YG-143: kapasite ağırlığı karşılamalı; yeni hasarda görev; tedbirli yat Hukuk ve Uyum onayına bağlı.
  s.post('/dosya/:id/tasima-onayi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g) return y.code(400).send({ hata: 'Gerekçeyi yazmanızı rica ederiz.' });
    const no = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0].dosya_no;
    await kartAc(b.db, { tur: 'Taşıma Onayı', baslik: `${no} · Taşıma Onayı`, ozet: g, oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(b.db, HUD)], nesneTuru: 'Dosya', nesneKimligi: id });
    return { durum: 'Onayda' };
  });
  s.post('/dosya/:id/kaldirma-tasima', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; ekipman?: string; kapasite?: number; agirlik?: number; yeniHasar?: boolean };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!['Kaldırma', 'Taşıma', 'Tesis Değişikliği'].includes(g.tur ?? '') || !g.ekipman?.trim()) return y.code(400).send({ hata: 'Tür ve ekipmanı girmenizi rica ederiz.' });
    const e = await takyidatTasimaEngeli(b.db, id); if (e) return y.code(409).send({ hata: e });
    if (g.tur !== 'Tesis Değişikliği') {
      if (!(Number(g.kapasite) > 0) || !(Number(g.agirlik) > 0)) return y.code(400).send({ hata: 'Ekipman kapasitesi ve yat ağırlığını girmenizi rica ederiz.' });
      if (Number(g.kapasite) < Number(g.agirlik)) return y.code(409).send({ hata: 'Ekipman kapasitesi yat ağırlığını karşılamıyor.' });
    }
    const r = await b.db.query(`INSERT INTO kaldirma_tasima (dosya_ref, tur, ekipman, kapasite_ton, yat_agirlik_ton, yeni_hasar, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [id, g.tur, g.ekipman.trim(), g.kapasite ?? null, g.agirlik ?? null, Boolean(g.yeniHasar), o.kullanici]);
    if (g.yeniHasar) { const d = (await b.db.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0]; if (d.dosya_sorumlusu_ref) await kartAc(b.db, { tur: 'Uygunsuzluk Kaydı Aç', kategori: 'gorev', baslik: `${d.dosya_no} · Kaldırma ve Taşımada Yeni Hasar`, ozet: g.ekipman.trim(), oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: id }); }
    return { kimlik: r.rows[0].kimlik };
  });

  // YG-867: onaylı parça ve muadil listesi ana veri.
  s.get('/onayli-parca', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    return (await b.db.query(`SELECT orijinal_parca_no, muadil_parca_no, dayanak FROM onayli_parca ORDER BY orijinal_parca_no LIMIT 500`)).rows;
  });
  s.post('/onayli-parca', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { orijinal?: string; muadil?: string; dayanak?: string };
    if (!(await rolVar(o.kullanici, [TM, 'Tedarik Yönetimi Müdürü']))) return y.code(403).send({ hata: 'Listeyi Teknik Müdür veya Tedarik Yönetimi Müdürü yönetir.' });
    if (!g.orijinal?.trim() || !g.muadil?.trim() || !['Üretici Eşdeğerlik Belgesi', 'Klas Onayı'].includes(g.dayanak ?? '')) return y.code(400).send({ hata: 'Parça numaraları ve dayanağı girmenizi rica ederiz.' });
    await b.db.query(`INSERT INTO onayli_parca (orijinal_parca_no, muadil_parca_no, dayanak, kaydeden_ref) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [g.orijinal.trim(), g.muadil.trim(), g.dayanak, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Onaylı Parça', nesneTuru: 'Parça', nesneKimligi: g.orijinal.trim(), yeni: { muadil: g.muadil }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
