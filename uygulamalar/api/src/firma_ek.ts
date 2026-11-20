import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { rolSahipleri } from './makam.js';
import { dogrulamaKodu } from './belge.js';
import QRCode from 'qrcode';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';
import { isGunuSonu } from './teklif.js';

type Db = Pool | PoolClient;
const FYM = 'Firma Yönetimi Müdürü'; const TM = 'Teknik Müdür'; const HUD = 'Hukuk ve Uyum Direktörü'; const OPM = 'Operasyon Müdürü'; const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'; const TID = 'Ticari İşler Direktörü'; const TIC = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
export const ON_KOSULLAR = ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar', 'İSG Koordinasyonu Yapıldı', 'Absorban ve Bariyer Mevcut'];
const SICIL_ROLLER = ['Sicil Sorumlusu', FYM, 'Firma Yönetimi Müdür Yardımcısı'];
const YILDONUMU = 'Kayıt Yıldönümü Gözden Geçirme'; const YILDONUMU_PAKET = 'Kayıt Yıldönümü Paketi';
const KARNE_OZETI = 'Üç Aylık Karne Özeti'; const KARNE_OZETI_GOREV = 'Üç Aylık Karne Özeti Hazırlığı'; const DENETIM_PROGRAMI = 'Yıllık Firma Denetim Programı';
const KABUL_YILLIK = 'Kabul Sistemi Yıllık Gözden Geçirme'; const KABUL_IYILESTIRME = 'Kabul Sistemi İyileştirme Önerisi'; const BELGE_KONTROL = 'Başvuru Belge Kontrolü';
/** YG-1650 (A37): kabul sistemi aylık göstergeleri (son 12 ay): başvuru, ön inceleme, karar, ortalama karar süresi, 15 iş günü aşımı. */
export async function kabulGostergeleri(db: Pool | PoolClient) {
  return (await db.query(`SELECT to_char(a.ay, 'YYYY-MM') ay, b.basvuru, c.on_inceleme, r.karar, r.onayli, r.kosullu, r.reddedildi, r.ort_gun, r.sure_asimi
    FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul') - interval '11 months', date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul'), interval '1 month') a(ay)
    CROSS JOIN LATERAL (SELECT count(*)::int basvuru FROM kurulus k WHERE k.kayit_asamasi <> 'Aday' AND date_trunc('month', k.olusturma_zamani AT TIME ZONE 'Europe/Istanbul') = a.ay) b
    CROSS JOIN LATERAL (SELECT count(*)::int on_inceleme FROM is_karti x WHERE x.tur = 'Başvuru Ön İnceleme' AND date_trunc('month', x.olusturma_zamani AT TIME ZONE 'Europe/Istanbul') = a.ay) c
    CROSS JOIN LATERAL (SELECT count(*)::int karar, count(*) FILTER (WHERE o.oneri = 'Onaylı')::int onayli, count(*) FILTER (WHERE o.oneri = 'Koşullu Onaylı')::int kosullu, count(*) FILTER (WHERE o.oneri = 'Reddedildi')::int reddedildi,
        round(avg(extract(epoch FROM o.karar_zamani - i.olusturma_zamani) / 86400)::numeric, 1) ort_gun, count(*) FILTER (WHERE o.olusturma_zamani > i.son_zaman)::int sure_asimi
      FROM firma_karar_onerisi o LEFT JOIN LATERAL (SELECT olusturma_zamani, son_zaman FROM is_karti WHERE tur = 'Başvuru Ön İnceleme' AND nesne_kimligi = o.kurulus_ref::text ORDER BY olusturma_zamani DESC LIMIT 1) i ON true
      WHERE o.durum = 'Onaylandı' AND date_trunc('month', o.karar_zamani AT TIME ZONE 'Europe/Istanbul') = a.ay) r
    ORDER BY a.ay DESC`)).rows;
}

/** YG-1648 (A36): ayın ilk günü sicil veri kalitesi görevi; Ocak, Nisan, Temmuz, Ekim'de koşullu kuruluş koşul belgeleri; kayıt yıldönümü gelen firmaya gözden geçirme görevi. */
export async function sicilKaliteAylik(db: Pool, simdi = new Date()): Promise<number> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const donem = ist.toISOString().slice(0, 7); const ay = ist.getUTCMonth(); const yil = ist.getUTCFullYear();
  const sc = await rolId(db, 'Sicil Sorumlusu'); let n = 0;
  if (await birKez(db, 'sicil-veri-kalitesi', donem)) {
    const l = (await db.query(`SELECT h.boyut, count(*)::int n FROM veri_hatasi h JOIN kalite_kurali k ON k.kod = h.kural_kod AND k.durum = 'Yürürlükte' WHERE k.kume_ref = 'FIRMA' AND h.durum = 'Açık' GROUP BY h.boyut ORDER BY h.boyut`)).rows;
    await kartAc(db, { tur: 'Sicil Veri Kalitesi', kategori: 'gorev', baslik: `${donem} · Sicil Veri Kalitesi · Aylık`, ozet: l.length ? `${l.map((x) => `${x.boyut} ${x.n}`).join(' · ')}. Veri Kalitesi listesindeki firma hatalarını düzeltiniz.` : 'Tamlık, doğruluk, güncellik ve tekillik kontrollerinde açık hata yok.', sahipRol: sc, sonZaman: await isGunuSonu(db, simdi, 10), nesneTuru: 'Sicil Veri Kalitesi', nesneKimligi: donem, simdi }); n++;
  }
  if (ay % 3 === 0 && await birKez(db, 'sicil-kosullu-belge', donem)) {
    const l = (await db.query(`SELECT ticari_unvan, sicil_no FROM kurulus WHERE kayit_asamasi = 'Koşullu Onaylı' AND ag_statusu NOT IN ('Çıkarıldı', 'Pasif') ORDER BY ticari_unvan`)).rows;
    if (l.length) { await kartAc(db, { tur: 'Koşullu Kuruluş Koşul Belgeleri', kategori: 'gorev', baslik: `${yil}-Q${ay / 3 + 1} · Koşullu Kuruluş Koşul Belgeleri`, ozet: l.map((x) => `${x.sicil_no} ${x.ticari_unvan}`).join(' · ').slice(0, 1500), sahipRol: sc, sonZaman: await isGunuSonu(db, simdi, 10), nesneTuru: 'Sicil Veri Kalitesi', nesneKimligi: `${donem}-KK`, simdi }); n++; }
  }
  for (const f of (await db.query(`SELECT kimlik, ticari_unvan, sicil_no FROM kurulus WHERE kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı') AND ag_statusu NOT IN ('Çıkarıldı', 'Pasif') AND extract(month FROM coalesce(kabul_karar_zamani, olusturma_zamani) AT TIME ZONE 'Europe/Istanbul') = $1 AND extract(year FROM coalesce(kabul_karar_zamani, olusturma_zamani) AT TIME ZONE 'Europe/Istanbul') < $2`, [ay + 1, yil])).rows) {
    if (!(await birKez(db, 'sicil-yildonumu', `${f.kimlik}:${yil}`))) continue;
    await kartAc(db, { tur: YILDONUMU, kategori: 'gorev', baslik: `${f.sicil_no} · ${f.ticari_unvan} · ${YILDONUMU}`, ozet: 'Belge, personel, tesis ve ekipman kayıtlarını gözden geçirip paketi "Onaya Gönder" ile Firma Yönetimi Yöneticisine gönderiniz.', sahipRol: sc, sonZaman: await isGunuSonu(db, simdi, 10), nesneTuru: 'Firma', nesneKimligi: f.kimlik, simdi }); n++;
  }
  // YG-1654: Ocak, Nisan, Temmuz ve Ekim'de biten dönemin karne özeti gözden geçirme görevi Firma Yönetimi Müdür Yardımcısına.
  if (ay % 3 === 0 && await birKez(db, 'karne-ozeti', donem)) { await kartAc(db, { tur: KARNE_OZETI_GOREV, kategori: 'gorev', baslik: `${donem} · ${KARNE_OZETI_GOREV}`, ozet: 'Biten dönemin karne puanlarını gözden geçirip özet paketini Dönem Performans Kartlarından "Onaya Gönder" ile Firma Yönetimi Müdürüne sununuz.', sahipRol: await rolId(db, 'Firma Yönetimi Müdür Yardımcısı'), sonZaman: await isGunuSonu(db, simdi, 10), nesneTuru: 'Karne Dönemi', nesneKimligi: donem, simdi }); n++; }
  // YG-1650: her Ocak geçen yılın kabul sistemi gözden geçirmesi Firma Yönetimi Yöneticisine; iyileştirme önerisi Müdür Yardımcısı ve Müdür onayına gider.
  if (ay === 0 && await birKez(db, 'kabul-yillik', String(yil - 1))) { await kartAc(db, { tur: KABUL_YILLIK, kategori: 'gorev', baslik: `${yil - 1} · ${KABUL_YILLIK}`, ozet: 'Geçen yılın kabul göstergelerini (başvuru, karar, ortalama süre, süre aşımı) değerlendirip iyileştirme önerisini "Onaya Gönder" ile sununuz.', sahipRol: await rolId(db, 'Firma Yönetimi Yöneticisi'), sonZaman: await isGunuSonu(db, simdi, 15), nesneTuru: 'Kabul Sistemi', nesneKimligi: String(yil - 1), simdi }); n++; }
  return n;
}
const FYY = 'Firma Yönetimi Yöneticisi'; const FYMY = 'Firma Yönetimi Müdür Yardımcısı'; const KARAR_ONERI = 'Firma Karar Önerisi';
const ONERILER = ['Onaylı', 'Koşullu Onaylı', 'İncelemede', 'Reddedildi']; const KAPSAMA = ['Bölge', 'Komşu', 'Mobil Ekip', 'Ulusal'];
/** YG-1650: karar önerisi son makamda (Firma Yönetimi Müdürü) onaylanınca firmanın kayıt aşaması öneriye göre yazılır. */
kapanisKaydet(KARAR_ONERI, async (c, k, karar, yapan) => {
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return;
  const durum = karar === 'Onayla' ? 'Onaylandı' : karar === 'Reddet' ? 'Reddedildi' : 'İade Edildi';
  const o = (await c.query(`UPDATE firma_karar_onerisi SET durum = $2, karar_veren_ref = $3, karar_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Onayda' RETURNING kurulus_ref, oneri`, [k.nesne_kimligi, durum, yapan])).rows[0];
  if (!o || karar !== 'Onayla' || o.oneri === 'İncelemede') return;
  await c.query(`UPDATE kurulus SET kayit_asamasi = $2, kabul_karar_zamani = now(), son_statu_karar_zamani = now(), sonraki_gozden_gecirme_tarihi = NULL, on_inceleme_son = NULL, guncelleme_zamani = now() WHERE kimlik = $1`, [o.kurulus_ref, o.oneri]);
  if (o.oneri === 'Koşullu Onaylı' || o.oneri === 'Reddedildi') await c.query(`UPDATE firma_hukuk_gorusu SET durum = 'Kullanıldı' WHERE kurulus_ref = $1 AND oneri = $2 AND durum = 'Verildi'`, [o.kurulus_ref, o.oneri]);
  if (o.oneri !== 'Reddedildi') await (await import('./uyum.js')).uyumOlay(c, 'firma_kabulu', 'Kuruluş', o.kurulus_ref); // YG-1546
});

// Paket son makamda onaylanınca sicil gözden geçirilmiş sayılır; sonraki gözden geçirme bir yıl sonradır.
kapanisKaydet(YILDONUMU_PAKET, async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE kurulus SET guncelleme_zamani = now(), sonraki_gozden_gecirme_tarihi = (current_date + interval '1 year')::date WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
async function yildonumuPaketi(db: Db, firma: string) {
  return (await db.query(`SELECT (SELECT count(*)::int FROM sicil_belgesi WHERE kurulus_ref = $1 AND (gecerlilik_bitis IS NULL OR gecerlilik_bitis >= current_date)) gecerli_belge,
      (SELECT count(*)::int FROM sicil_belgesi s WHERE s.kurulus_ref = $1 AND s.gecerlilik_bitis < current_date AND NOT EXISTS (SELECT 1 FROM sicil_belgesi x WHERE x.kurulus_ref = s.kurulus_ref AND x.tur = s.tur AND (x.gecerlilik_bitis IS NULL OR x.gecerlilik_bitis >= current_date))) dolan_belge,
      (SELECT count(*)::int FROM firma_personeli WHERE kurulus_ref = $1 AND aktif) personel, (SELECT count(*)::int FROM firma_tesisi WHERE kurulus_ref = $1 AND aktif) tesis,
      (SELECT count(*)::int FROM firma_ekipmani WHERE kurulus_ref = $1) ekipman, (SELECT count(*)::int FROM firma_ekipmani WHERE kurulus_ref = $1 AND NOT kullanilabilir) kullanilamaz_ekipman`, [firma])).rows[0];
}

/** YG-307: görev sınıfı ve asgari yetkinlik. */
export function gorevSinifi(g: { tutar?: number | null; cokBrans?: boolean; anaSistem?: boolean; kritik?: boolean }): { sinif: 'G1' | 'G2' | 'G3' | 'G4'; asgari: 'Y1' | 'Y2' | 'Y3' | 'Y4' } {
  const t = Number(g.tutar ?? 0);
  if (g.kritik || t > 50000) return { sinif: 'G4', asgari: 'Y4' };
  if (g.cokBrans || g.anaSistem || t > 10000) return { sinif: 'G3', asgari: 'Y3' };
  if (t > 2000) return { sinif: 'G2', asgari: 'Y2' };
  return { sinif: 'G1', asgari: 'Y1' };
}

/** YG-304, YG-306, YG-307, YG-332: belgeler dışında sözleşme, yetkinlik, garanti, çıkar ve kapasite birlikte; en ucuz veya en yakın otomatik seçilmez. */
/** YG-334: klas kuruluşuna bildirim, işe başlamadan 48 saat önce; tarih yoksa son zaman konmaz. */
export const klasBildirimSonu = (baslangic?: string | null): Date | undefined => (baslangic ? new Date(new Date(baslangic).getTime() - 48 * 3_600_000) : undefined);

export async function gorevlendirmeKontrolu(db: Db, g: { firma: string; dosya: string; brans?: string | null; tutar?: number | null; cokBrans?: boolean; anaSistem?: boolean; kritik?: boolean ; tesis?: string | null }) {
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
  if (f?.risk_derecesi === 'Yakın İzleme') { const pu = (await db.query(`SELECT donem_puani FROM performans_donem_puani WHERE kurulus_ref = $1 AND donem_puani IS NOT NULL ORDER BY donem_sonu DESC LIMIT 1`, [g.firma])).rows[0]?.donem_puani; uyarilar.push(`Firma yakın izlemededir${pu != null ? ` (son dönem puanı ${Number(pu).toFixed(2).replace('.', ',')})` : ''}.`); }
  // YG-304, YG-533: süresi geçmiş bakım veya kalibrasyonlu ekipman görevlendirmede uyarı olarak görünür.
  const ek = (await db.query(`SELECT ad, seri_no FROM firma_ekipmani WHERE kurulus_ref = $1 AND (NOT kullanilabilir OR least(bakim_bitis, kalibrasyon_bitis) < current_date OR coalesce(bakim_bitis, kalibrasyon_bitis) < current_date)`, [g.firma])).rows;
  if (ek.length) uyarilar.push(`Firmanın bakım veya kalibrasyon süresi geçmiş ekipmanı vardır: ${ek.map((x) => `${x.ad} (${x.seri_no})`).join(', ')}.`);
  // YG-304: firma personeli; aktif personel kaydı yoksa ya da İSG eğitimi veya yetki belgesi süresi geçmişse uyarı.
  const pr = (await db.query(`SELECT ad_soyad, isg_egitim_bitis < current_date AS isg, yetki_belgesi_bitis < current_date AS belge FROM firma_personeli WHERE kurulus_ref = $1 AND aktif`, [g.firma])).rows;
  if (!pr.length) uyarilar.push('Firmanın kayıtlı aktif personeli yoktur.');
  const sureli = pr.filter((x) => x.isg || x.belge);
  // YG-938: güncel saha oryantasyonunu almamış aktif personel uyarı olur.
  const oryEksik = Number((await db.query(`SELECT count(*) n FROM firma_personeli p WHERE p.kurulus_ref = $1 AND p.aktif AND EXISTS (SELECT 1 FROM akademi_ders d WHERE d.aktif AND d.tur = 'Saha Oryantasyonu' AND NOT EXISTS (SELECT 1 FROM firma_oryantasyon o WHERE o.ders_ref = d.kimlik AND o.surum = d.surum AND o.personel_ref = p.kimlik))`, [g.firma])).rows[0].n);
  if (oryEksik) uyarilar.push(`Saha oryantasyonunu almamış ${oryEksik} personel vardır.`);
  if (sureli.length) uyarilar.push(`İSG eğitimi veya yetki belgesi süresi geçmiş personel vardır: ${sureli.map((x) => x.ad_soyad).join(', ')}.`);
  if (f?.kapasite_is && Number((await db.query(`SELECT count(*) n FROM is_emri WHERE kurulus_ref = $1 AND statu IN ('Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif')`, [g.firma])).rows[0].n) >= f.kapasite_is) uyarilar.push('Firmanın beyan ettiği iş kapasitesi doludur.');
  // YG-309: branş ve görev sınıfı bazındaki kapasite; sınıfa özel satır yoksa branşın genel satırı (tüm sınıflar ve tesisler toplamı) esas alınır.
  if (g.brans) {
    const kp = (await db.query(`SELECT sum(es_zamanli_is)::int n FROM firma_kapasitesi WHERE kurulus_ref = $1 AND ana_brans = $2 AND (gorev_sinifi = $3 OR (gorev_sinifi IS NULL AND NOT EXISTS (SELECT 1 FROM firma_kapasitesi x WHERE x.kurulus_ref = $1 AND x.ana_brans = $2 AND x.gorev_sinifi = $3)))`, [g.firma, g.brans, sinif])).rows[0].n;
    if (kp) { const ak = Number((await db.query(`SELECT count(*) n FROM is_emri WHERE kurulus_ref = $1 AND ana_brans = $2 AND statu IN ('Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif')`, [g.firma, g.brans])).rows[0].n); if (ak >= kp) uyarilar.push(`Firmanın ${g.brans} branşındaki ${sinif} kapasitesi doludur (${ak}/${kp}).`); }
    // Tesis seçildiyse o tesisin kendi kapasite satırı ayrıca denetlenir.
    if (g.tesis) {
      const tk = (await db.query(`SELECT sum(es_zamanli_is)::int n FROM firma_kapasitesi WHERE kurulus_ref = $1 AND ana_brans = $2 AND tesis_ref = $3 AND (gorev_sinifi IS NULL OR gorev_sinifi = $4)`, [g.firma, g.brans, g.tesis, sinif])).rows[0].n;
      if (tk) { const ak = Number((await db.query(`SELECT count(*) n FROM is_emri WHERE kurulus_ref = $1 AND ana_brans = $2 AND tesis_ref = $3 AND statu IN ('Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif')`, [g.firma, g.brans, g.tesis])).rows[0].n); if (ak >= tk) uyarilar.push(`Seçilen tesisteki ${g.brans} kapasitesi doludur (${ak}/${tk}).`); }
    }
  }
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

/** YG-312, YG-416: kapanışta paylaşım bağlantıları, konum gönderimi ve bekleyen tesis talepleri kapanır; bekleyen malzeme ve süren yükümlülük göreve dönüşür. */
export async function dosyaKapanisIsleri(c: Db, dosya: string) {
  await c.query(`UPDATE paylasim_baglantisi p SET iptal_zamani = now() FROM belge_surum s JOIN belge b ON b.kimlik = s.belge_ref WHERE p.surum_ref = s.kimlik AND b.bag_turu = 'Dosya' AND b.bag_kimligi = $1 AND p.iptal_zamani IS NULL`, [dosya]);
  await c.query(`UPDATE acil_konum a SET aktif = false, durduran = 'Dosya Kapanışı', durma_zamani = now() FROM dosya d WHERE d.kimlik = $1 AND d.talep_ref = a.talep_ref AND a.aktif`, [dosya]);
  await c.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE dosya_ref = $1 AND rol = 'Saha Sorumlusu' AND bitis_zamani IS NULL`, [dosya]);
  await c.query(`UPDATE tesis_talebi SET durum = 'Geri Çekildi' WHERE dosya_ref = $1 AND durum = 'Yanıt Bekliyor'`, [dosya]); // YG-416: tesiste bekleyen saha/çalışma izni talebi kapanır
  const d = (await c.query(`SELECT dosya_no, dosya_sorumlusu_ref, garanti_tanimli, garanti_suresi_ay FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  // YG-416: karantinada veya kararı bekleyen malzeme dosyaya ayrılmış kalır; iade ya da teslim kaydı için görev açılır.
  const malzeme = (await c.query(`SELECT count(*)::int AS n FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE s.dosya_ref = $1 AND (m.kabul_karari IS NULL OR m.kabul_karari = 'Karantina')`, [dosya])).rows[0].n;
  if (malzeme && d?.dosya_sorumlusu_ref && await birKez(c, 'kapanis_malzeme', dosya)) await kartAc(c, { tur: 'Kapanış Malzeme Kontrolü', kategori: 'gorev', baslik: `${d.dosya_no} · Bekleyen Malzeme`, ozet: `${malzeme} malzeme kaydı karantinada veya karar bekliyor; iade ya da teslim kaydını tamamlayınız.`, oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: dosya });
  if (d?.dosya_sorumlusu_ref && d.garanti_tanimli === true && await birKez(c, 'kapanis_yukumluluk', dosya)) await kartAc(c, { tur: 'Garanti İzleme', kategori: 'islem', baslik: `${d.dosya_no} · Garanti İzleme`, ozet: `${d.garanti_suresi_ay} aylık garanti süresince izlenir.`, sonZaman: new Date(Date.now() + Number(d.garanti_suresi_ay) * 30.4375 * 86_400_000) /* KS-1 */, sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: dosya });
}

/** YG-1660: geçici askıda her açık iş emri için ayrı karar kaydı ve Dosya Sorumlusuna görev. Öneri: iş başlamadıysa Devir, durdurulmuşsa Güvenli Durdurma, sürüyorsa Ek Gözetim. */
export async function askiIsKararlariAc(c: Db, firma: string): Promise<number> {
  let n = 0;
  for (const e of (await c.query(`SELECT e.kimlik, e.is_emri_no, e.statu, d.dosya_sorumlusu_ref, d.oncelik FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kurulus_ref = $1 AND e.statu IN ('Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif', 'Çekinceli', 'Durduruldu') AND NOT EXISTS (SELECT 1 FROM aski_is_karari a WHERE a.is_emri_ref = e.kimlik AND a.karar IS NULL)`, [firma])).rows) {
    const oneri = ['Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Çekinceli'].includes(e.statu) ? 'Devir' : e.statu === 'Durduruldu' ? 'Güvenli Durdurma' : 'Ek Gözetim';
    const a = (await c.query(`INSERT INTO aski_is_karari (is_emri_ref, kurulus_ref, oneri) VALUES ($1,$2,$3) RETURNING kimlik`, [e.kimlik, firma, oneri])).rows[0];
    if (e.dosya_sorumlusu_ref) await kartAc(c, { tur: 'Geçici Askı İş Kararı', kategori: 'gorev', baslik: `${e.is_emri_no} · Firma Geçici Askıda`, ozet: `Öneri: ${oneri}. Güvenli Durdurma, Kontrollü Devam, Ek Gözetim veya Devir kararını veriniz.`, oncelik: e.oncelik === 'Kritik' ? 'Kritik' : 'Yüksek', sahipKullanici: e.dosya_sorumlusu_ref, nesneTuru: 'Askı İş Kararı', nesneKimligi: a.kimlik });
    n++;
  }
  return n;
}

/** YG-1660: Firma Kapsama Raporu; branş, kapsama türü ve bölge başına onaylı aktif firma sayısı. Aday raporu kayıt sürecindeki firmaları sayar. Aktif firması kalmayan satır "Boş" görünür. */
export async function firmaKapsamaRaporu(db: Db, aday = false) {
  const asama = aday ? ['Aday', 'Başvuru', 'İncelemede'] : ['Onaylı', 'Koşullu Onaylı'];
  return (await db.query(`SELECT y.ana_brans, y.kapsama, coalesce(y.bolge, '-') AS bolge, count(DISTINCT u.kimlik) FILTER (WHERE u.kayit_asamasi = ANY($1) AND ($2 OR (u.ag_statusu = 'Aktif' AND y.durum = 'Aktif')))::int AS firma FROM brans_yetkinligi y JOIN kurulus u ON u.kimlik = y.kurulus_ref WHERE u.kayit_rolu = 'Çözüm Ortağı' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [asama, aday])).rows as { ana_brans: string; kapsama: string; bolge: string; firma: number }[];
}

/** YG-1660: her ayın ilk çalışmasında kapsama raporu BT ve Firma Yönetimi Direktörüne, aday firma kapsama raporu GMY'ye bildirilir. */
export async function kapsamaRaporIsle(db: Pool, simdi = new Date()): Promise<number> {
  const ay = simdi.toISOString().slice(0, 7);
  if (!(await birKez(db, 'firma_kapsama_raporu', ay))) return 0;
  const r = await firmaKapsamaRaporu(db); const a = await firmaKapsamaRaporu(db, true);
  const bos = r.filter((x) => x.firma === 0).map((x) => `${x.ana_brans} (${x.bolge})`);
  await bildir(db, { olay: `kapsama-raporu:${ay}`, kullanicilar: await rolSahipleri(db, await rolId(db, BTD)), baslik: `Firma Kapsama Raporu · ${ay}`, ozet: `${r.length} branş-bölge satırı; aktif firması olmayan: ${bos.length ? bos.slice(0, 10).join(', ') : 'yok'}.` });
  await bildir(db, { olay: `aday-kapsama-raporu:${ay}`, kullanicilar: await rolSahipleri(db, await rolId(db, 'Genel Müdür Yardımcısı')), baslik: `Aday Firma Kapsama Raporu · ${ay}`, ozet: `Kayıt sürecindeki aday firmalar ${a.filter((x) => x.firma > 0).length} branş-bölge satırında.` });
  return 2;
}

/**
 * YG-342: firma sicil belgeleri bitişine 30 gün kala firma kullanıcılarına ve Sicil Sorumlusuna bir kez hatırlatılır; süresi dolunca
 * Sicil Sorumlusu ve Firma Yönetimi Müdürü bilgilendirilir, firmanın açık iş emri varsa Operasyon Müdürüne etki değerlendirmesi görevi açılır.
 */
export async function sicilBelgeSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  const bugun = simdi.toISOString().slice(0, 10); let n = 0;
  const fk = async (k: string) => (await db.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [k])).rows.map((x) => x.kullanici_ref as string);
  const sicil = await rolSahipleri(db, await rolId(db, 'Sicil Sorumlusu'));
  for (const s of (await db.query(`SELECT s.kimlik, s.kurulus_ref, s.tur, s.gecerlilik_bitis::text bitis, k.ticari_unvan FROM sicil_belgesi s JOIN kurulus k ON k.kimlik = s.kurulus_ref WHERE s.gecerlilik_bitis BETWEEN $1::date AND $1::date + 30 AND k.ag_statusu IS DISTINCT FROM 'Çıkarıldı'`, [bugun])).rows) {
    if (!(await birKez(db, 'sicil-belge-30', `${s.kimlik}:${s.bitis}`))) continue;
    await bildir(db, { olay: `sicil-belge-30:${s.kimlik}:${s.bitis}`, kullanicilar: [...await fk(s.kurulus_ref), ...sicil], baslik: `${s.tur} · Geçerlilik Bitiyor`, ozet: `${s.ticari_unvan}: ${s.bitis.split('-').reverse().join('.')} tarihinde sona eriyor; yenilenmiş belgeyi yükleyiniz.` }, simdi); n++;
  }
  const fym = await rolSahipleri(db, await rolId(db, 'Firma Yönetimi Müdürü'));
  for (const s of (await db.query(`SELECT s.kimlik, s.kurulus_ref, s.tur, s.gecerlilik_bitis::text bitis, k.ticari_unvan, (SELECT count(*)::int FROM is_emri e WHERE e.kurulus_ref = s.kurulus_ref AND e.statu IN ('Aktif', 'Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Durduruldu')) acik FROM sicil_belgesi s JOIN kurulus k ON k.kimlik = s.kurulus_ref
      WHERE s.gecerlilik_bitis < $1::date AND s.gecerlilik_bitis >= $1::date - 30 AND k.ag_statusu IS DISTINCT FROM 'Çıkarıldı' AND NOT EXISTS (SELECT 1 FROM sicil_belgesi y WHERE y.kurulus_ref = s.kurulus_ref AND y.tur = s.tur AND y.gecerlilik_bitis >= $1::date)`, [bugun])).rows) {
    if (!(await birKez(db, 'sicil-belge-doldu', `${s.kimlik}:${s.bitis}`))) continue;
    await bildir(db, { olay: `sicil-belge-doldu:${s.kimlik}:${s.bitis}`, kullanicilar: [...await fk(s.kurulus_ref), ...sicil, ...fym], baslik: `${s.tur} · Süresi Doldu`, ozet: `${s.ticari_unvan}: yeni görevlendirme belge yenilenene kadar yapılmaz.`, oncelik: 'Yüksek' }, simdi);
    if (s.acik > 0) await kartAc(db, { tur: 'Belge Süresi Etki Değerlendirmesi', kategori: 'gorev', baslik: `${s.ticari_unvan} · ${s.tur} Süresi Doldu`, ozet: `Firmanın ${s.acik} açık iş emri var; devam, durdurma veya devir kararını değerlendiriniz.`, sahipRol: await rolId(db, 'Operasyon Müdürü'), nesneTuru: 'Kuruluş', nesneKimligi: s.kurulus_ref });
    n++;
  }
  // YG-420: iş emri durduruldu, iptal edildi veya kapandı bilgisi firmaya portal bildirimiyle gider (son 7 gün; her durum bir kez).
  for (const e of (await db.query(`SELECT kimlik, is_emri_no, statu, kurulus_ref, durdurma_nedeni FROM is_emri WHERE statu IN ('Durduruldu', 'İptal', 'Kapalı') AND kurulus_ref IS NOT NULL AND coalesce(guncelleme_zamani, olusturma_zamani) > $1::timestamptz - interval '7 days'`, [simdi])).rows) {
    if (!(await birKez(db, 'is-emri-durum-firma', `${e.kimlik}:${e.statu}`))) continue;
    await bildir(db, { olay: `is-emri-durum:${e.kimlik}:${e.statu}`, kullanicilar: await fk(e.kurulus_ref), baslik: `${e.is_emri_no} · İş Emri ${e.statu === 'Kapalı' ? 'Kapandı' : e.statu === 'İptal' ? 'İptal Edildi' : 'Durduruldu'}`, ozet: e.statu === 'Durduruldu' && e.durdurma_nedeni ? String(e.durdurma_nedeni) : undefined, oncelik: e.statu === 'Durduruldu' ? 'Yüksek' : 'Normal' }, simdi);
    n++;
  }
  return n;
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
/** YG-1660: iki onay birbirini beklemez; ikisi de onaylayınca talep onaylanır, biri reddederse reddedilir. Sonuç Operasyon Müdürüne bildirilir. */
async function yurtDisiKarar(c: Db, k: { nesne_kimligi: string | null }, karar: string, alan: 'fym_karari' | 'hud_karari') {
  if (!['Onayla', 'Reddet'].includes(karar)) return;
  const t = (await c.query(`UPDATE yurt_disi_firma_talebi SET ${alan} = $2 WHERE kimlik = $1::uuid AND durum = 'Onayda' RETURNING *`, [k.nesne_kimligi, karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi'])).rows[0];
  if (!t) return;
  const durum = t.fym_karari === 'Reddedildi' || t.hud_karari === 'Reddedildi' ? 'Reddedildi' : t.fym_karari && t.hud_karari ? 'Onaylandı' : null;
  if (!durum) return;
  await c.query(`UPDATE yurt_disi_firma_talebi SET durum = $2 WHERE kimlik = $1`, [t.kimlik, durum]);
  await bildir(c, { olay: `yurt-disi-firma:${t.kimlik}`, kullanicilar: [t.talep_eden_ref], baslik: `Yurt Dışı Yerel Firma Talebi · ${durum}`, ozet: `${t.ulke} / ${t.sehir} · ${t.ana_brans}` });
}
kapanisKaydet('Yurt Dışı Firma Onayı', (c, k, karar) => yurtDisiKarar(c, k, karar, 'fym_karari'));
kapanisKaydet('Yurt Dışı Firma Hukuk Onayı', (c, k, karar) => yurtDisiKarar(c, k, karar, 'hud_karari'));
kapanisKaydet('Kalıcı Askı Önerisi', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE kurulus SET ag_statusu = 'Askıda', guncelleme_zamani = now() WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

export function firmaEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const firmam = async (k: string) => (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;
  const dosyaBelgesi = async (belge: string | undefined, dosya: string) => Boolean(belge && UUID.test(belge) && (await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi::text = $2`, [belge, dosya])).rowCount);
  const isGunuGecti = async (t: Date, gun: number) => { const { isGunuSonu } = await import('./teklif.js'); return Date.now() > (await isGunuSonu(b.db, t, gun)).getTime(); }; // YG-1472: resmî tatil ve arife dahil

  // Sicil: yetkili servis, çıkar beyanı, kapasite, kaptan.
  s.post('/firma/:id/sicil-ek', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { marka?: string; cikarTaraf?: string; cikarNot?: string; kapasite?: number; ilceTeyitKaynagi?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, SICIL_ROLLER))) return yok(y);
    // YG-1261: ilçe bilgisi kaynağıyla teyit edilir; teyit tarihi ve teyit eden tutulur.
    if (g.ilceTeyitKaynagi?.trim()) {
      const r = await b.db.query(`UPDATE kurulus SET ilce_teyit_zamani = now(), ilce_teyit_kaynagi = $2, ilce_teyit_eden_ref = $3 WHERE kimlik = $1 AND ilce IS NOT NULL RETURNING ilce`, [id, g.ilceTeyitKaynagi.trim(), o.kullanici]);
      if (!r.rowCount) return y.code(409).send({ hata: 'Firmanın ilçe bilgisi girilmeden teyit yapılamaz.' });
    }
    if (g.marka?.trim()) await b.db.query(`INSERT INTO yetkili_servis (kurulus_ref, marka) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, g.marka.trim()]);
    if (g.cikarTaraf?.trim()) {
      const t = (await b.db.query(`SELECT kimlik FROM taraf WHERE taraf_no = $1`, [g.cikarTaraf.trim()])).rows[0];
      if (!t) return y.code(404).send({ hata: 'Bu numarada taraf kaydı bulunamadı.' });
      await b.db.query(`INSERT INTO cikar_beyani (kurulus_ref, taraf_ref, aciklama, kaydeden_ref) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [id, t.kimlik, g.cikarNot?.trim() || 'Beyan', o.kullanici]);
    }
    if (Number(g.kapasite) > 0) await b.db.query(`UPDATE kurulus SET kapasite_is = $2 WHERE kimlik = $1`, [id, g.kapasite]);
    return { tamam: true };
  });
  // YG-346: firma ana kayıt görünümü; tüm ilişkiler tek yerde (sicil rollerine).
  s.get('/firma/:id/ozet', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolVar(i.oturum!.kullanici, SICIL_ROLLER))) return yok(y);
    const q = async (sql: string) => (await b.db.query(sql, [id])).rows;
    const k = (await q(`SELECT sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, risk_derecesi, il, ilce, ilce_teyit_zamani IS NOT NULL ilce_teyitli, hizmet_kumesi, acil_hizmet_verir FROM kurulus WHERE kimlik = $1`))[0];
    if (!k) return yok(y);
    return {
      kimlik: k,
      sozlesmeler: await q(`SELECT sozlesme_turu, yururluk::text, bitis::text, durum FROM sozlesme_kaydi WHERE kurulus_ref = $1 ORDER BY olusturma_zamani DESC`),
      branslar: await q(`SELECT ana_brans, kapsama, bolge, durum FROM brans_yetkinligi WHERE kurulus_ref = $1 ORDER BY ana_brans`),
      belgeler: await q(`SELECT tur, gecerlilik_bitis::text gecerlilik_bitis, (gecerlilik_bitis < current_date) suresi_dolmus FROM sicil_belgesi WHERE kurulus_ref = $1 ORDER BY gecerlilik_bitis NULLS LAST`),
      tesisler: await q(`SELECT tesis_kodu, ad, il, ilce, aktif FROM firma_tesisi WHERE kurulus_ref = $1 ORDER BY sira`),
      kapasite: await q(`SELECT k.ana_brans, k.gorev_sinifi, t.ad tesis, k.es_zamanli_is FROM firma_kapasitesi k LEFT JOIN firma_tesisi t ON t.kimlik = k.tesis_ref WHERE k.kurulus_ref = $1 ORDER BY k.ana_brans`),
      sayilar: (await q(`SELECT (SELECT count(*)::int FROM firma_ekipmani WHERE kurulus_ref = $1) ekipman,
          (SELECT count(*)::int FROM firma_ekipmani WHERE kurulus_ref = $1 AND (bakim_bitis < current_date OR kalibrasyon_bitis < current_date)) ekipman_suresi_dolan,
          (SELECT count(*)::int FROM kurulus_kullanici WHERE kurulus_ref = $1) kullanici,
          (SELECT count(*)::int FROM firma_personeli WHERE kurulus_ref = $1 AND aktif) personel,
          (SELECT count(*)::int FROM firma_personeli WHERE kurulus_ref = $1 AND aktif AND kritik) kritik_personel,
          (SELECT count(*)::int FROM is_emri WHERE kurulus_ref = $1 AND statu IN ('Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif')) acik_is_emri,
          (SELECT count(*)::int FROM is_emri WHERE kurulus_ref = $1) toplam_is_emri`))[0],
    };
  });
  // YG-309: branş, görev sınıfı (boşsa tüm sınıflar) ve tesis (boşsa tüm yerler) bazında eş zamanlı iş kapasitesi.
  s.post('/firma/:id/kapasite', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { brans?: string; sinif?: string; tesis?: string; adet?: number };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, SICIL_ROLLER))) return yok(y);
    if (!g.brans?.trim() || !(Number.isInteger(Number(g.adet)) && Number(g.adet) > 0)) return y.code(400).send({ hata: 'Branş ve eş zamanlı iş sayısı zorunludur.' });
    if (g.sinif && !['G1', 'G2', 'G3', 'G4'].includes(g.sinif)) return y.code(400).send({ hata: 'Görev sınıfı G1–G4 olmalıdır.' });
    if (g.tesis && !(UUID.test(g.tesis) && (await b.db.query(`SELECT 1 FROM firma_tesisi WHERE kimlik = $1 AND kurulus_ref = $2`, [g.tesis, id])).rowCount)) return y.code(400).send({ hata: 'Tesis bu firmaya ait değildir.' });
    await b.db.query(`INSERT INTO firma_kapasitesi (kurulus_ref, ana_brans, gorev_sinifi, tesis_ref, es_zamanli_is, giren_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kurulus_ref, ana_brans, coalesce(gorev_sinifi, '*'), coalesce(tesis_ref::text, '*')) DO UPDATE SET es_zamanli_is = EXCLUDED.es_zamanli_is, giren_ref = EXCLUDED.giren_ref`, [id, g.brans.trim(), g.sinif || null, g.tesis || null, Number(g.adet), o.kullanici]);
    return { tamam: true };
  });
  s.get('/firma/:id/kapasite', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (i.oturum!.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    return (await b.db.query(`SELECT k.ana_brans, k.gorev_sinifi, t.tesis_kodu, t.ad tesis, k.es_zamanli_is, (SELECT count(*)::int FROM is_emri e WHERE e.kurulus_ref = k.kurulus_ref AND e.ana_brans = k.ana_brans AND (k.tesis_ref IS NULL OR e.tesis_ref = k.tesis_ref) AND (k.gorev_sinifi IS NULL OR e.gorev_sinifi = k.gorev_sinifi) AND e.statu IN ('Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif')) aktif FROM firma_kapasitesi k LEFT JOIN firma_tesisi t ON t.kimlik = k.tesis_ref WHERE k.kurulus_ref = $1 ORDER BY k.ana_brans, k.gorev_sinifi NULLS FIRST`, [id])).rows;
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
    const k = (await b.db.query(`SELECT yeterlilik_bitis >= current_date AS b, police_bitis >= current_date AS p, kurulus_ref FROM kaptan_kaydi WHERE kimlik = $1`, [kaptan])).rows[0];
    if (!k) return yok(y);
    if (!k.b) return y.code(409).send({ hata: 'Kaptanın yeterlilik belgesinin süresi dolmuştur.' });
    if (!k.p) return y.code(409).send({ hata: 'Kaptanın mesleki sorumluluk poliçesinin süresi dolmuştur.' });
    // YG-097: kaptan hizmeti yalnız Lojistik branşında aktif yetkinliği olan firmadan alınır.
    if (!(await b.db.query(`SELECT 1 FROM brans_yetkinligi WHERE kurulus_ref = $1 AND ana_brans = 'LOJISTIK-01' AND durum = 'Aktif'`, [k.kurulus_ref])).rowCount) return y.code(409).send({ hata: 'Kaptan hizmeti Lojistik branşında aktif yetkinliği olan firmadan alınır.' });
    await b.db.query(`INSERT INTO kaptan_gorevlendirme (dosya_ref, kaptan_ref, yapan_ref, kurulus_ref) VALUES ($1,$2,$3,$4)`, [id, kaptan, o.kullanici, k.kurulus_ref]);
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
    if (k.karar_zamani && await isGunuGecti(new Date(k.karar_zamani), 2)) return y.code(409).send({ hata: 'İki iş günlük itiraz süresi dolmuştur.' });
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
    if (m.onay_zamani && await isGunuGecti(new Date(m.onay_zamani), 5)) return y.code(409).send({ hata: 'Beş iş günlük itiraz süresi dolmuştur.' });
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
    // YG-1426: Hukuk ve Uyum görüşü kademe sayacına girmez; ayrı kartta "Hukuk ve Uyum Görüşü Bekleniyor" olarak yürür. Direktör görüş verilmeden karar vermez.
    const k = await kartAc(b.db, { tur: 'Kalıcı Askı Önerisi', baslik: `${f.ticari_unvan} · Kalıcı Askı Önerisi`, ozet: g, oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(b.db, TM), await rolId(b.db, OPM), await rolId(b.db, BTD)], nesneTuru: 'Kuruluş', nesneKimligi: id });
    await kartAc(b.db, { tur: 'Kalıcı Askı Hukuk Görüşü', baslik: `${f.ticari_unvan} · Hukuk ve Uyum Görüşü Bekleniyor`, ozet: `Kalıcı askı önerisi: ${g}`, oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(b.db, HUD)], nesneTuru: 'Kuruluş', nesneKimligi: id });
    return { kimlik: k };
  });

  // YG-938: Çözüm Ortağı saha oryantasyonu; firma yetkilisi dersin hangi personeline verildiğini kaydeder.
  s.get('/firma-portal/oryantasyon', oturumlu, async (i, y) => {
    const f = await firmam(i.oturum!.kullanici); if (!f) return yok(y);
    const dersler = (await b.db.query(`SELECT kimlik, ad, icerik, surum FROM akademi_ders WHERE aktif AND tur = 'Saha Oryantasyonu' ORDER BY ad`)).rows;
    const verilen = (await b.db.query(`SELECT o.ders_ref, o.surum, o.personel_ref FROM firma_oryantasyon o JOIN firma_personeli p ON p.kimlik = o.personel_ref WHERE p.kurulus_ref = $1`, [f])).rows;
    return dersler.map((d) => ({ ...d, verilenler: verilen.filter((v) => v.ders_ref === d.kimlik && v.surum === d.surum).map((v) => v.personel_ref) }));
  });
  s.post('/firma-portal/oryantasyon/:ders', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await firmam(o.kullanici); const { ders } = i.params as { ders: string }; const g = (i.body ?? {}) as { personel?: string[] };
    if (!f || !UUID.test(ders)) return yok(y);
    const d = (await b.db.query(`SELECT surum FROM akademi_ders WHERE kimlik = $1 AND aktif AND tur = 'Saha Oryantasyonu'`, [ders])).rows[0]; if (!d) return yok(y);
    const l = (g.personel ?? []).filter((x) => UUID.test(x));
    if (!l.length) return y.code(400).send({ hata: 'Oryantasyonun verildiği personeli seçiniz.' });
    const ok = (await b.db.query(`SELECT kimlik FROM firma_personeli WHERE kurulus_ref = $1 AND aktif AND kimlik = ANY($2::uuid[])`, [f, l])).rows.map((r) => r.kimlik as string);
    if (ok.length !== l.length) return y.code(400).send({ hata: 'Personel firmanıza ait ve aktif olmalıdır.' });
    for (const p of ok) await b.db.query(`INSERT INTO firma_oryantasyon (ders_ref, surum, personel_ref, beyan_eden_ref) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [ders, d.surum, p, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Saha Oryantasyonu Verildi', nesneTuru: 'Kuruluş', nesneKimligi: f, yeni: { ders, surum: d.surum, personel: ok.length }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Firma Portalı' });
    return { tamam: true };
  });

  // YG-304, YG-339: firma kendi personelini kaydeder; ayrılan personelin ekip kartları iptal olur, bağlı hesabı kapanır, geçmiş korunur.
  s.get('/firma-portal/personel', oturumlu, async (i, y) => {
    const f = await firmam(i.oturum!.kullanici); if (!f) return yok(y);
    return (await b.db.query(`SELECT kimlik, ad_soyad, gorev, telefon, isg_egitim_bitis::text, yetki_belgesi, yetki_belgesi_bitis::text, aktif, kritik, esdegerlik_sonucu FROM firma_personeli WHERE kurulus_ref = $1 ORDER BY aktif DESC, ad_soyad`, [f])).rows;
  });
  s.post('/firma-portal/personel', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await firmam(o.kullanici); if (!f) return yok(y);
    const g = (i.body ?? {}) as { ad?: string; gorev?: string; telefon?: string; isgBitis?: string; belge?: string; belgeBitis?: string; kullanici?: string; kritik?: boolean; yerine?: string; yeterlilikBelgesi?: string };
    const tarih = (x?: string) => !x || /^\d{4}-\d{2}-\d{2}$/.test(x);
    if (!g.ad?.trim() || !g.gorev?.trim() || !tarih(g.isgBitis) || !tarih(g.belgeBitis)) return y.code(400).send({ hata: 'Ad soyad ve görev zorunludur; tarihleri geçerli giriniz.' });
    // KV-3: personele KVKK-03 aydınlatma metninin iletildiği firma tarafından beyan edilmeden kayıt alınmaz.
    if ((i.body as { kvkk03?: boolean }).kvkk03 !== true) return y.code(400).send({ hata: 'Bu personele Çözüm Ortağı Aydınlatma Metninin (KVKK-03) iletildiğini işaretleyiniz.' });
    // Personelin portal hesabı varsa bağlanır; ayrılışta hesap da kapanır (YG-339).
    if (g.kullanici && !(await b.db.query(`SELECT 1 FROM kurulus_kullanici WHERE kurulus_ref = $1 AND kullanici_ref = $2`, [f, g.kullanici])).rowCount) return y.code(400).send({ hata: 'Hesap firmanıza ait değildir.' });
    // YG-340: kritik personelin yerine geçen kişi için LGM kişi onayı istenmez; eşdeğer yeterlilik belgesi yüklenir, sistem aynı türde ve süresi geçerli belgeyi doğrular.
    let esdeger: { eski: string; sonuc: string } | null = null;
    if (g.yerine) {
      const eski = UUID.test(g.yerine) ? (await b.db.query(`SELECT kimlik, kritik, yetki_belgesi FROM firma_personeli WHERE kimlik = $1 AND kurulus_ref = $2`, [g.yerine, f])).rows[0] : undefined;
      if (!eski) return y.code(400).send({ hata: 'Yerine geçilen personel bulunamadı.' });
      if (eski.kritik) {
        if (!g.yeterlilikBelgesi || !UUID.test(g.yeterlilikBelgesi) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND olusturan_ref = $2`, [g.yeterlilikBelgesi, o.kullanici])).rowCount) return y.code(400).send({ hata: 'Kritik personel değişikliğinde yeni kişinin yeterlilik belgesini yüklemeniz gerekir.' });
        if (eski.yetki_belgesi && (String(g.belge ?? '').trim().toLocaleLowerCase('tr') !== String(eski.yetki_belgesi).trim().toLocaleLowerCase('tr') || !g.belgeBitis || g.belgeBitis < new Date().toISOString().slice(0, 10))) return y.code(409).send({ hata: `Yeni kişinin "${eski.yetki_belgesi}" belgesi olmalı ve süresi geçerli olmalıdır; eşdeğer yeterlilik sağlanmadan kritik görev devredilmez.` });
        esdeger = { eski: eski.kimlik, sonuc: 'Eşdeğer (sistem doğruladı)' };
      } else esdeger = { eski: eski.kimlik, sonuc: 'Kritik olmayan görev' };
    }
    const r = await b.db.query(`INSERT INTO firma_personeli (kurulus_ref, ad_soyad, gorev, telefon, isg_egitim_bitis, yetki_belgesi, yetki_belgesi_bitis, kullanici_ref, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [f, g.ad.trim(), g.gorev.trim(), g.telefon?.trim() || null, g.isgBitis || null, g.belge?.trim() || null, g.belgeBitis || null, g.kullanici || null, o.kullanici]);
    await b.db.query(`UPDATE firma_personeli SET kvkk03_iletim_zamani = now() WHERE kimlik = $1`, [r.rows[0].kimlik]); // KV-3
    await b.db.query(`UPDATE firma_personeli SET kritik = $2 WHERE kimlik = $1`, [r.rows[0].kimlik, Boolean(g.kritik) || Boolean(esdeger && esdeger.sonuc.startsWith('Eşdeğer'))]); // YG-340
    if (esdeger) {
      await b.db.query(`UPDATE firma_personeli SET yerine_gectigi_ref = $2, yeterlilik_belge_ref = $3, esdegerlik_sonucu = $4 WHERE kimlik = $1`, [r.rows[0].kimlik, esdeger.eski, g.yeterlilikBelgesi ?? null, esdeger.sonuc]);
      await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Personel Değişikliği', nesneTuru: 'Kuruluş', nesneKimligi: f, yeni: { yeni: r.rows[0].kimlik, eski: esdeger.eski, sonuc: esdeger.sonuc }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Firma Portalı' });
    }
    return { kimlik: r.rows[0].kimlik };
  });
  s.post('/firma-portal/personel/:id/ayrildi', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await firmam(o.kullanici); const { id } = i.params as { id: string };
    if (!f || !UUID.test(id)) return yok(y);
    const p = (await b.db.query(`UPDATE firma_personeli SET aktif = false, ayrilis_zamani = now() WHERE kimlik = $1 AND kurulus_ref = $2 AND aktif RETURNING kullanici_ref`, [id, f])).rows[0];
    if (!p) return yok(y);
    await b.db.query(`UPDATE ekip_karti SET iptal_zamani = now() WHERE personel_ref = $1 AND iptal_zamani IS NULL`, [id]);
    if (p.kullanici_ref) { await b.db.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Kapalı' WHERE kimlik = $1`, [p.kullanici_ref]); await b.db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [p.kullanici_ref]); }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Personeli Ayrıldı', nesneTuru: 'Kuruluş', nesneKimligi: f, yeni: { personel: id }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Firma Portalı' });
    return { tamam: true };
  });
  s.get('/firma/:id/personel', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolVar(i.oturum!.kullanici, [...SICIL_ROLLER, BTD, OPM, 'Dosya Sorumlusu', 'Teknik Uzman']))) return yok(y);
    return (await b.db.query(`SELECT kimlik, ad_soyad, gorev, isg_egitim_bitis::text, yetki_belgesi, yetki_belgesi_bitis::text, aktif, kritik, esdegerlik_sonucu FROM firma_personeli WHERE kurulus_ref = $1 ORDER BY aktif DESC, ad_soyad`, [id])).rows;
  });

  // YG-424: Görevli Ekip Kartı; firma unvanı yazılmaz, QR kodu herkese açık doğrulamaya gider. Geçerlilik iş emrinin hedef bitişi, yoksa 30 gün.
  s.post('/firma-portal/is-emri/:id/ekip-karti', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await firmam(o.kullanici); const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { personel?: string[] };
    if (!f || !UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT kimlik, coalesce(hedef_bitis_tarihi, current_date + 30) AS bitis FROM is_emri WHERE kimlik = $1 AND kurulus_ref = $2 AND statu IN ('Başlangıç Kontrolünde', 'Aktif', 'Çekinceli')`, [id, f])).rows[0];
    if (!e) return yok(y);
    if (!g.personel?.length || g.personel.some((x) => !UUID.test(x))) return y.code(400).send({ hata: 'Personel seçiniz.' });
    const p = (await b.db.query(`SELECT kimlik FROM firma_personeli WHERE kimlik = ANY($1::uuid[]) AND kurulus_ref = $2 AND aktif`, [g.personel, f])).rows;
    if (p.length !== g.personel.length) return y.code(400).send({ hata: 'Seçilen personel firmanızda aktif değildir.' });
    const kartlar: { personel: string; kod: string; qr: string }[] = [];
    for (const x of p) { const kod = dogrulamaKodu(); await b.db.query(`INSERT INTO ekip_karti (kod, personel_ref, is_emri_ref, gecerlilik_bitis) VALUES ($1,$2,$3,$4) ON CONFLICT (personel_ref, is_emri_ref) DO UPDATE SET kod = EXCLUDED.kod, gecerlilik_bitis = EXCLUDED.gecerlilik_bitis, iptal_zamani = NULL`, [kod, x.kimlik, id, e.bitis]); kartlar.push({ personel: x.kimlik, kod, qr: await QRCode.toDataURL(`${b.webAdresi}/#ekip=${kod}`, { margin: 1, width: 180 }) }); }
    return { kartlar };
  });
  s.get('/ekip-karti/:kod', async (i, y) => {
    const { kod } = i.params as { kod: string };
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(kod)) return yok(y);
    const k = (await b.db.query(`SELECT p.ad_soyad, p.gorev, k.gecerlilik_bitis::text, d.dosya_no, k.iptal_zamani IS NULL AND p.aktif AND k.gecerlilik_bitis >= current_date AND e.statu NOT IN ('İptal', 'Kapalı') AS gecerli FROM ekip_karti k JOIN firma_personeli p ON p.kimlik = k.personel_ref JOIN is_emri e ON e.kimlik = k.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref WHERE k.kod = $1`, [kod])).rows[0];
    if (!k) return yok(y);
    return { ifade: 'LİMİT GLOBAL MARINE adına görevli', ad: k.ad_soyad, gorev: k.gorev, gecerlilik: k.gecerlilik_bitis, dosyaNo: k.dosya_no, gecerli: k.gecerli };
  });

  // YG-1660: geçici askı iş kararı; öneri öndeğerdir. Güvenli Durdurma iş emrini durdurur, Devir firma değiştirme görevi açar.
  // YG-1648: aktif firmada süresi dolmuş ve aynı türde geçerli yenisi olmayan belge; SGK ve vergi borcu yazısında yeni iş emri verilmez, hakediş ödemesi bekletilir.
  s.get('/sicil/suresi-dolmus-belgeler', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, SICIL_ROLLER))) return yok(y);
    return (await b.db.query(`SELECT s.kimlik, k.kimlik firma, k.ticari_unvan, s.tur, s.gecerlilik_bitis::text, (s.tur ~* 'SGK|vergi borcu') engelleyici FROM sicil_belgesi s JOIN kurulus k ON k.kimlik = s.kurulus_ref
      WHERE k.ag_statusu = 'Aktif' AND s.gecerlilik_bitis < current_date AND NOT EXISTS (SELECT 1 FROM sicil_belgesi x WHERE x.kurulus_ref = s.kurulus_ref AND x.tur = s.tur AND (x.gecerlilik_bitis IS NULL OR x.gecerlilik_bitis >= current_date))
      ORDER BY s.gecerlilik_bitis LIMIT 100`)).rows;
  });
  // YG-1654 (A38): Dönem Performans Kartları; risk derecesi yalnız öneridir. Son üç dönem puanı kesintisiz düşen firma "Kademeli Düşüş" işaretlenir.
  const FY_YONETIM = [FYM, FYMY, FYY, BTD];
  s.get('/firma/donem-kartlari', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, FY_YONETIM))) return yok(y);
    const l = (await b.db.query(`SELECT k.kimlik, k.sicil_no, k.ticari_unvan, k.risk_derecesi, k.kapasite_is, p.donem_sonu::text, p.donem_puani, p.agirlikli_ortalama, p.uygunsuzluk_kesintisi, p.kapanan_dosya_sayisi, p.yetersiz_veri, p.acik_emniyet_uygunsuzlugu, p.risk_derecesi_onerisi,
        (SELECT count(*)::int FROM uygunsuzluk u WHERE u.sorumlu_firma_ref = k.kimlik AND u.statu NOT IN ('Kapalı', 'Geçersiz')) acik_duzeltici,
        (SELECT count(*)::int FROM firma_denetim_plani d WHERE d.kurulus_ref = k.kimlik AND d.durum = 'Tamamlandı' AND d.tamamlanma_zamani > p.donem_sonu - interval '6 months') denetim,
        (SELECT array_agg(x.donem_puani ORDER BY x.donem_sonu DESC) FROM (SELECT donem_puani, donem_sonu FROM performans_donem_puani WHERE kurulus_ref = k.kimlik ORDER BY donem_sonu DESC LIMIT 3) x) son_uc
      FROM kurulus k JOIN LATERAL (SELECT * FROM performans_donem_puani WHERE kurulus_ref = k.kimlik ORDER BY donem_sonu DESC LIMIT 1) p ON true
      WHERE k.ag_statusu NOT IN ('Çıkarıldı', 'Pasif') ORDER BY p.donem_puani NULLS FIRST LIMIT 200`)).rows;
    for (const x of l) {
      const s = ((x.son_uc ?? []) as (string | null)[]).map((v) => (v === null ? null : Number(v)));
      x.kademeli_dusus = s.length === 3 && s.every((v) => v !== null) && s[0]! < s[1]! && s[1]! < s[2]!;
      x.son = await isGunuSonu(b.db, new Date(`${x.donem_sonu}T12:00:00Z`), 10);
      x.oneri_bekliyor = Boolean((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Kademeli Düşüş Önerisi' AND nesne_kimligi = $1 AND durum = 'Bekliyor' LIMIT 1`, [x.kimlik])).rowCount);
    }
    // Yeni aktif firmaların ilk dönem izlemesi: kabul edilmiş, henüz dönem puanı oluşmamış firmalar.
    const ilkDonem = (await b.db.query(`SELECT k.kimlik, k.sicil_no, k.ticari_unvan, k.kabul_karar_zamani, (current_date - (k.kabul_karar_zamani AT TIME ZONE 'Europe/Istanbul')::date) gun,
        (SELECT count(*)::int FROM is_emri e WHERE e.kurulus_ref = k.kimlik AND e.statu NOT IN ('Taslak', 'İptal', 'Yerine Geçti')) is_emri, (SELECT count(*)::int FROM is_emri e WHERE e.kurulus_ref = k.kimlik AND e.statu IN ('Tamamlandı', 'Kapalı')) tamamlanan,
        (SELECT count(*)::int FROM uygunsuzluk u WHERE u.sorumlu_firma_ref = k.kimlik AND u.statu NOT IN ('Kapalı', 'Geçersiz')) acik_uygunsuzluk
      FROM kurulus k WHERE k.kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı') AND k.ag_statusu IN ('Aktif', 'Kısıtlı') AND k.kabul_karar_zamani IS NOT NULL AND NOT EXISTS (SELECT 1 FROM performans_donem_puani p WHERE p.kurulus_ref = k.kimlik) ORDER BY k.kabul_karar_zamani LIMIT 100`)).rows;
    const donem = l.reduce<string | null>((a, x) => (!a || x.donem_sonu > a ? x.donem_sonu : a), null);
    const ozetBekliyor = donem ? Boolean((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor' LIMIT 1`, [KARNE_OZETI, donem])).rowCount) : false;
    return { kartlar: l, ilkDonem, donem, ozetBekliyor, oneriVerir: await rolVar(i.oturum!.kullanici, [FYMY, FYY]) };
  });
  // YG-1654: üç aylık karne özeti gözden geçirme paketi; Firma Yönetimi Müdür Yardımcısı veya Yöneticisi hazırlar, Firma Yönetimi Müdürü onaylar.
  s.post('/firma/karne-ozeti', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { donem?: string; degerlendirme?: string };
    if (!(await rolVar(o.kullanici, [FYMY, FYY]))) return yok(y);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.donem ?? '') || !g.degerlendirme?.trim()) return y.code(400).send({ hata: 'Dönemi ve gözden geçirme değerlendirmesini yazınız.' });
    const t = (await b.db.query(`SELECT count(*)::int firma, count(*) FILTER (WHERE yetersiz_veri)::int yetersiz, round(avg(donem_puani) FILTER (WHERE NOT yetersiz_veri), 2) ortalama, count(*) FILTER (WHERE risk_derecesi_onerisi = 'Yakın İzleme')::int yakin, count(*) FILTER (WHERE acik_emniyet_uygunsuzlugu)::int emniyet FROM performans_donem_puani WHERE donem_sonu = $1::date`, [g.donem])).rows[0];
    if (!t.firma) return y.code(409).send({ hata: 'Bu dönem için karne puanı yoktur.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor' LIMIT 1`, [KARNE_OZETI, g.donem])).rowCount) return y.code(409).send({ hata: 'Bu dönemin karne özeti onaydadır.' });
    const ort = t.ortalama === null ? '---' : String(t.ortalama).replace('.', ',');
    await kartAc(b.db, { tur: KARNE_OZETI, baslik: `${g.donem!.split('-').reverse().join('.')} · ${KARNE_OZETI}`, ozet: `Firma: ${t.firma} · Ortalama Puan: ${ort} · Yetersiz Veri: ${t.yetersiz} · Yakın İzleme Önerisi: ${t.yakin} · Açık Emniyet Uygunsuzluğu: ${t.emniyet} · ${g.degerlendirme.trim()}`.slice(0, 1500), hazirlayan: o.kullanici, zincir: [await rolId(b.db, FYM)], nesneTuru: 'Karne Dönemi', nesneKimligi: g.donem });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND durum = 'Bekliyor'`, [KARNE_OZETI_GOREV]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Üç Aylık Karne Özeti Onaya Gönderildi', nesneTuru: 'Karne Dönemi', nesneKimligi: g.donem!, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { gonderilecek: FYM, ozet: t };
  });
  s.post('/firma/:id/kademeli-dusus-onerisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { oneri?: string; gerekce?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [FYMY, FYY]))) return yok(y);
    if (!['Erken Denetim', 'Gelişim Görüşmesi'].includes(g.oneri ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Öneriyi (Erken Denetim veya Gelişim Görüşmesi) ve gerekçeyi yazınız.' });
    const p = (await b.db.query(`SELECT donem_puani FROM performans_donem_puani WHERE kurulus_ref = $1 ORDER BY donem_sonu DESC LIMIT 3`, [id])).rows.map((r) => (r.donem_puani === null ? null : Number(r.donem_puani)));
    if (!(p.length === 3 && p.every((v) => v !== null) && p[0]! < p[1]! && p[1]! < p[2]!)) return y.code(409).send({ hata: 'Firmanın son üç dönem puanında kademeli düşüş yoktur.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Kademeli Düşüş Önerisi' AND nesne_kimligi = $1 AND durum = 'Bekliyor' LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Bu firma için onay bekleyen öneri vardır.' });
    const f = (await b.db.query(`SELECT sicil_no, ticari_unvan FROM kurulus WHERE kimlik = $1`, [id])).rows[0]; if (!f) return yok(y);
    await kartAc(b.db, { tur: 'Kademeli Düşüş Önerisi', baslik: `${f.sicil_no} · ${f.ticari_unvan} · Üç Dönem Kademeli Düşüş: ${g.oneri}`, ozet: `Dönem puanları: ${p.map((v) => String(v).replace('.', ',')).join(' ← ')} · ${g.gerekce.trim()}`, hazirlayan: o.kullanici, zincir: [await rolId(b.db, FYM)], nesneTuru: 'Kuruluş', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kademeli Düşüş Önerisi Onaya Gönderildi', nesneTuru: 'Kuruluş', nesneKimligi: id, yeni: { oneri: g.oneri }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { gonderilecek: FYM };
  });
  // YG-1654 (A38): Risk Esaslı Denetim Planı; ertelemede gerekçe ve yeni tarih zorunlu; denetçi LGM personelidir ve çıkar çatışması olmadığını beyan eder.
  const DENETIM_TURLERI = ['Belge ve Sicil', 'Uzaktan Dosya', 'Saha ve Tesis', 'Olay Sonrası', 'Takip', 'Yeniden Kabul'];
  s.get('/firma-denetim-plani', oturumlu, async (i, y) => {
    const o = i.oturum!; const yon = await rolVar(o.kullanici, FY_YONETIM);
    const l = (await b.db.query(`SELECT d.kimlik, d.tur, d.planlanan_tarih::text, d.durum, d.risk_gerekcesi, d.erteleme_sayisi, d.son_erteleme_gerekcesi, d.sonuc, k.sicil_no, k.ticari_unvan, h.ad_soyad denetci, d.denetci_ref = $1 benim FROM firma_denetim_plani d JOIN kurulus k ON k.kimlik = d.kurulus_ref JOIN kullanici_hesabi h ON h.kimlik = d.denetci_ref WHERE $2 OR d.denetci_ref = $1 ORDER BY d.durum = 'Tamamlandı', d.planlanan_tarih LIMIT 200`, [o.kullanici, yon])).rows;
    if (!yon && !l.length) return yok(y);
    const riskli = yon ? (await b.db.query(`SELECT k.kimlik, k.sicil_no, k.ticari_unvan, concat_ws(', ', CASE WHEN k.risk_derecesi = 'Yakın İzleme' THEN 'Yakın İzleme' END, CASE WHEN p.acik_emniyet_uygunsuzlugu THEN 'Açık emniyet uygunsuzluğu' END, CASE WHEN p.risk_derecesi_onerisi = 'Yakın İzleme' THEN 'Dönem önerisi Yakın İzleme' END) neden
        FROM kurulus k LEFT JOIN LATERAL (SELECT * FROM performans_donem_puani WHERE kurulus_ref = k.kimlik ORDER BY donem_sonu DESC LIMIT 1) p ON true
        WHERE k.ag_statusu IN ('Aktif', 'Kısıtlı', 'Geçici Askıda') AND (k.risk_derecesi = 'Yakın İzleme' OR p.acik_emniyet_uygunsuzlugu OR p.risk_derecesi_onerisi = 'Yakın İzleme')
          AND NOT EXISTS (SELECT 1 FROM firma_denetim_plani d WHERE d.kurulus_ref = k.kimlik AND d.durum = 'Planlandı') ORDER BY k.ticari_unvan LIMIT 100`)).rows : [];
    return { planlar: l, riskli, turler: DENETIM_TURLERI, planlar_mi: await rolVar(o.kullanici, [FYMY, FYY]), program_mi: await rolVar(o.kullanici, [FYMY]) };
  });
  // YG-1654: yıllık firma denetim programı taslağı; İç Denetim planı ve açık iç denetimlerle çakışma kontrol edilir, program Firma Yönetimi Müdürü onayına gider.
  s.post('/firma-denetim-programi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { yil?: number; aciklama?: string };
    if (!(await rolVar(o.kullanici, [FYMY]))) return yok(y);
    const yil = Number(g.yil);
    if (!Number.isInteger(yil) || yil < 2026 || !g.aciklama?.trim()) return y.code(400).send({ hata: 'Program yılını ve açıklamayı yazınız.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor' LIMIT 1`, [DENETIM_PROGRAMI, String(yil)])).rowCount) return y.code(409).send({ hata: 'Bu yılın denetim programı onaydadır.' });
    const l = (await b.db.query(`SELECT d.tur, count(*)::int n, array_agg(DISTINCT d.denetci_ref) denetciler FROM firma_denetim_plani d WHERE extract(year FROM d.planlanan_tarih) = $1 GROUP BY d.tur ORDER BY d.tur`, [yil])).rows;
    if (!l.length) return y.code(409).send({ hata: 'Bu yıl için planlanmış firma denetimi yoktur.' });
    // Çakışma: İç Denetim yıllık planında firma yönetimi süreci; firma denetçisinin açık iç denetimde denetçi olması.
    const cakisma: string[] = [];
    const ip = (await b.db.query(`SELECT array_to_string(surecler, ', ') s FROM ic_denetim_plani WHERE yil = $1 AND durum IN ('CEO Onayında', 'Yürürlükte') AND EXISTS (SELECT 1 FROM unnest(surecler) x WHERE x ILIKE '%firma%' OR x ILIKE '%tedarik%')`, [yil])).rows[0];
    if (ip) cakisma.push(`İç Denetim ${yil} planı firma süreçlerini kapsıyor (${ip.s}); tarihler İç Denetim ile eşgüdümlenmelidir`);
    const dn = [...new Set(l.flatMap((x) => x.denetciler as string[]))];
    for (const x of (await b.db.query(`SELECT DISTINCT h.ad_soyad FROM ic_denetim d JOIN kullanici_hesabi h ON h.kimlik = d.denetci_ref WHERE d.durum <> 'Sonuçlandı' AND d.denetci_ref = ANY($1::text[])`, [dn])).rows) cakisma.push(`${x.ad_soyad} açık iç denetimde denetçidir`);
    const ozet = `${l.map((x) => `${x.tur}: ${x.n}`).join(' · ')}${cakisma.length ? ` · Çakışma: ${cakisma.join('; ')}` : ' · İç Denetim ile çakışma yok'} · ${g.aciklama.trim()}`;
    await kartAc(b.db, { tur: DENETIM_PROGRAMI, baslik: `${yil} · ${DENETIM_PROGRAMI}`, ozet: ozet.slice(0, 1500), hazirlayan: o.kullanici, zincir: [await rolId(b.db, FYM)], nesneTuru: 'Firma Denetim Programı', nesneKimligi: String(yil) });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yıllık Firma Denetim Programı Onaya Gönderildi', nesneTuru: 'Firma Denetim Programı', nesneKimligi: String(yil), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { gonderilecek: FYM, cakisma };
  });
  s.post('/firma/:id/denetim-plani', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; tarih?: string; denetci?: string; riskGerekcesi?: string; cikarYok?: boolean };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [FYMY, FYY]))) return yok(y);
    if (!DENETIM_TURLERI.includes(g.tur ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih ?? '') || !g.denetci || !g.riskGerekcesi?.trim()) return y.code(400).send({ hata: 'Denetim türü, tarih, denetçi ve risk gerekçesi zorunludur.' });
    const d = (await b.db.query(`SELECT kullanici_grubu, hesap_durumu FROM kullanici_hesabi WHERE kimlik = $1`, [g.denetci])).rows[0];
    if (d?.kullanici_grubu !== 'LGM İç Rolü' || d.hesap_durumu !== 'Aktif') return y.code(400).send({ hata: 'Denetçi aktif LGM personeli olmalıdır.' });
    if (!g.cikarYok) return y.code(409).send({ hata: 'Denetçinin firmayla çıkar çatışması olmadığı beyan edilmeden denetim planlanmaz.' });
    // Başvuru kabulünü yapan veya firmanın karar önerisini hazırlayan kişi aynı firmanın denetçisi olmaz.
    if ((await b.db.query(`SELECT 1 FROM kurulus WHERE kimlik = $1 AND olusturan_ref = $2 UNION SELECT 1 FROM firma_karar_onerisi WHERE kurulus_ref = $1 AND hazirlayan_ref = $2 AND durum <> 'Reddedildi' LIMIT 1`, [id, g.denetci])).rowCount) return y.code(409).send({ hata: 'Firmanın başvurusunu kabul eden veya karar önerisini hazırlayan kişi denetçi olamaz.' });
    const f = (await b.db.query(`SELECT sicil_no, ticari_unvan FROM kurulus WHERE kimlik = $1`, [id])).rows[0]; if (!f) return yok(y);
    const r = (await b.db.query(`INSERT INTO firma_denetim_plani (kurulus_ref, tur, planlanan_tarih, denetci_ref, risk_gerekcesi, planlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, g.tur, g.tarih, g.denetci, g.riskGerekcesi.trim(), o.kullanici])).rows[0].kimlik;
    await kartAc(b.db, { tur: 'Firma Denetimi', kategori: 'gorev', baslik: `${f.sicil_no} · ${f.ticari_unvan} · ${g.tur} Denetimi`, ozet: g.riskGerekcesi.trim().slice(0, 200), sahipKullanici: g.denetci, sonZaman: new Date(`${g.tarih}T17:00:00+03:00`), nesneTuru: 'Firma Denetimi', nesneKimligi: r });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Denetimi Planlandı', nesneTuru: 'Kuruluş', nesneKimligi: id, yeni: { tur: g.tur, tarih: g.tarih }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r };
  });
  s.post('/firma-denetim/:id/ertele', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gerekce?: string; yeniTarih?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [FYMY, FYY]))) return yok(y);
    if (!g.gerekce?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(g.yeniTarih ?? '')) return y.code(400).send({ hata: 'Erteleme gerekçesi ve yeni tarih zorunludur.' });
    const r = await b.db.query(`UPDATE firma_denetim_plani SET planlanan_tarih = $2, son_erteleme_gerekcesi = $3, erteleme_sayisi = erteleme_sayisi + 1 WHERE kimlik = $1 AND durum = 'Planlandı' AND $2::date > planlanan_tarih RETURNING kimlik`, [id, g.yeniTarih, g.gerekce.trim()]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Yeni tarih planlanan tarihten sonra olmalı; tamamlanan denetim ertelenmez.' });
    await b.db.query(`UPDATE is_karti SET son_zaman = $2 WHERE tur = 'Firma Denetimi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id, new Date(`${g.yeniTarih}T17:00:00+03:00`)]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Denetimi Ertelendi', nesneTuru: 'Firma Denetimi', nesneKimligi: id, gerekce: g.gerekce.trim(), yeni: { tarih: g.yeniTarih }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/firma-denetim/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { sonuc } = (i.body ?? {}) as { sonuc?: string };
    if (!UUID.test(id)) return yok(y);
    if (!sonuc?.trim()) return y.code(400).send({ hata: 'Denetim sonucunu yazınız.' });
    const r = await b.db.query(`UPDATE firma_denetim_plani SET durum = 'Tamamlandı', sonuc = $3, tamamlanma_zamani = now() WHERE kimlik = $1 AND denetci_ref = $2 AND durum = 'Planlandı' RETURNING kimlik`, [id, o.kullanici, sonuc.trim()]);
    if (!r.rowCount) return yok(y);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Firma Denetimi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Denetimi Tamamlandı', nesneTuru: 'Firma Denetimi', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // YG-1650 (A37): Sicil Sorumlusu belge kontrolünü bitirip başvuruyu ön incelemeye gönderir; karara sunma süresi 15 iş günü.
  s.post('/firma/:id/on-incelemeye-gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, ['Sicil Sorumlusu']))) return yok(y);
    const f = (await b.db.query(`SELECT ticari_unvan, sicil_no, kayit_asamasi, atanan_sicil_ref FROM kurulus WHERE kimlik = $1`, [id])).rows[0]; if (!f) return yok(y);
    if (f.kayit_asamasi !== 'Başvuru') return y.code(409).send({ hata: 'Yalnız Başvuru aşamasındaki kayıt ön incelemeye gönderilir.' });
    if (f.atanan_sicil_ref && f.atanan_sicil_ref !== o.kullanici) return y.code(409).send({ hata: 'Başvuru başka bir Sicil Sorumlusuna atanmıştır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [BELGE_KONTROL, id]);
    const son = await isGunuSonu(b.db, new Date(), 15);
    await b.db.query(`UPDATE kurulus SET kayit_asamasi = 'İncelemede', on_inceleme_son = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, son]);
    await kartAc(b.db, { tur: 'Başvuru Ön İnceleme', kategori: 'gorev', baslik: `${f.sicil_no} · ${f.ticari_unvan} · Ön İnceleme`, ozet: 'Dosya tamlığını, görüşleri ve puanlamayı tamamlayıp karar önerisini 15 iş günü içinde Onaya Gönder ile sununuz.', sahipRol: await rolId(b.db, FYY), sonZaman: son, nesneTuru: 'Kuruluş', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Başvuru Ön İncelemeye Gönderildi', nesneTuru: 'Kuruluş', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { son };
  });
  s.get('/firma/:id/karar-onerisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [...SICIL_ROLLER, FYY]))) return yok(y);
    const f = (await b.db.query(`SELECT kayit_asamasi, on_inceleme_son FROM kurulus WHERE kimlik = $1`, [id])).rows[0]; if (!f) return yok(y);
    const l = (await b.db.query(`SELECT r.kimlik, r.oneri, r.kapsama, r.puanlar, r.gerekce, r.durum, r.olusturma_zamani, h.ad_soyad hazirlayan, (SELECT x.rol_adi FROM is_karti c JOIN rol x ON x.kimlik = c.zincir[c.kademe + 1] WHERE c.tur = $2 AND c.nesne_kimligi = r.kimlik::text AND c.durum = 'Bekliyor' LIMIT 1) makam FROM firma_karar_onerisi r JOIN kullanici_hesabi h ON h.kimlik = r.hazirlayan_ref WHERE r.kurulus_ref = $1 ORDER BY r.olusturma_zamani DESC`, [id, KARAR_ONERI])).rows;
    return { asama: f.kayit_asamasi, son: f.on_inceleme_son, oneriler: l, hazirlar: (await rolSahipleri(b.db, await rolId(b.db, FYY))).includes(o.kullanici), oneriTurleri: ONERILER, kapsamalar: KAPSAMA };
  });
  s.post('/firma/:id/karar-onerisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { oneri?: string; kapsama?: string; gerekce?: string; puanlar?: { baslik?: string; puan?: number; kanit?: string }[] };
    if (!UUID.test(id) || !(await rolSahipleri(b.db, await rolId(b.db, FYY))).includes(o.kullanici)) return yok(y);
    const f = (await b.db.query(`SELECT ticari_unvan, sicil_no, kayit_asamasi, olusturan_ref FROM kurulus WHERE kimlik = $1`, [id])).rows[0]; if (!f) return yok(y);
    if (f.kayit_asamasi !== 'İncelemede') return y.code(409).send({ hata: 'Karar önerisi ön incelemedeki (İncelemede) başvuru için hazırlanır.' });
    if (!ONERILER.includes(g.oneri ?? '')) return y.code(400).send({ hata: 'Öneriyi seçiniz.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Öneri gerekçesi zorunludur.' });
    const kabul = g.oneri === 'Onaylı' || g.oneri === 'Koşullu Onaylı';
    if (kabul && !KAPSAMA.includes(g.kapsama ?? '')) return y.code(400).send({ hata: 'Kapsama türünü seçiniz: Bölge, Komşu, Mobil Ekip veya Ulusal.' });
    // Puan kanıta bağlıdır; aynı gözlem (kanıt) iki başlıkta puanlanmaz.
    const puanlar = (g.puanlar ?? []).map((x) => ({ baslik: String(x.baslik ?? '').trim(), puan: Number(x.puan), kanit: String(x.kanit ?? '').trim() })).filter((x) => x.baslik);
    if (kabul && !puanlar.length) return y.code(400).send({ hata: 'Kabul önerisinde puanlama zorunludur.' });
    if (puanlar.some((x) => !Number.isInteger(x.puan) || x.puan < 1 || x.puan > 5 || !x.kanit)) return y.code(400).send({ hata: 'Her başlık için 1–5 puan ve dayandığı kanıt zorunludur.' });
    const kanitlar = puanlar.map((x) => x.kanit.toLocaleLowerCase('tr-TR'));
    if (new Set(kanitlar).size !== kanitlar.length) return y.code(409).send({ hata: 'Aynı gözlem iki başlıkta puanlanmaz; her başlığa ayrı kanıt yazınız.' });
    if (new Set(puanlar.map((x) => x.baslik)).size !== puanlar.length) return y.code(409).send({ hata: 'Aynı başlık iki kez puanlanmaz.' });
    // Görev ayrılığı: başvuru kabulü ve belge kontrolü yapan karar önerisini hazırlamaz.
    if (f.olusturan_ref === o.kullanici || (await b.db.query(`SELECT 1 FROM sicil_belgesi WHERE kurulus_ref = $1 AND kontrol_eden_ref = $2 LIMIT 1`, [id, o.kullanici])).rowCount) return y.code(409).send({ hata: 'Başvuru kabulü veya belge kontrolünü yaptığınız firmanın karar önerisini hazırlayamazsınız (görev ayrılığı).' });
    if ((g.oneri === 'Koşullu Onaylı' || g.oneri === 'Reddedildi') && !(await b.db.query(`SELECT 1 FROM firma_hukuk_gorusu WHERE kurulus_ref = $1 AND oneri = $2 AND durum = 'Verildi'`, [id, g.oneri])).rowCount) return y.code(409).send({ hata: 'Hukuk ve Uyum görüşü bekleniyor.' });
    if ((await b.db.query(`SELECT 1 FROM firma_karar_onerisi WHERE kurulus_ref = $1 AND durum = 'Onayda'`, [id])).rowCount) return y.code(409).send({ hata: 'Onayda bekleyen karar önerisi vardır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = (await c.query(`INSERT INTO firma_karar_onerisi (kurulus_ref, oneri, kapsama, puanlar, gerekce, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, g.oneri, kabul ? g.kapsama : null, JSON.stringify(puanlar), g.gerekce.trim(), o.kullanici])).rows[0].kimlik;
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Başvuru Ön İnceleme' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      const ort = puanlar.length ? ` · Ortalama Puan ${(puanlar.reduce((a, x) => a + x.puan, 0) / puanlar.length).toFixed(1).replace('.', ',')}` : '';
      await kartAc(c, { tur: KARAR_ONERI, baslik: `${f.sicil_no} · ${f.ticari_unvan} · Karar Önerisi: ${g.oneri}`, ozet: `${kabul ? `Kapsama: ${g.kapsama}` : g.oneri}${ort} · ${g.gerekce.trim()}`.slice(0, 1500), hazirlayan: o.kullanici, zincir: [await rolId(c, FYMY), await rolId(c, FYM)], nesneTuru: 'Firma Karar Önerisi', nesneKimligi: r });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Karar Önerisi Onaya Gönderildi', nesneTuru: 'Kuruluş', nesneKimligi: id, yeni: { oneri: g.oneri, kapsama: g.kapsama }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: r, gonderilecek: FYMY };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
  // YG-1650 (A37): Dağıtım Bekleyen Başvurular, aylık kabul göstergeleri ve yıllık iyileştirme önerisi.
  s.get('/firma/kabul-sistemi', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (!(await rolVar(o.kullanici, [FYY, FYMY, FYM]))) return yok(y);
    const dagitim = (await b.db.query(`SELECT kimlik, sicil_no, ticari_unvan, kayit_rolu, olusturma_zamani FROM kurulus WHERE kayit_asamasi = 'Başvuru' AND atanan_sicil_ref IS NULL ORDER BY olusturma_zamani LIMIT 100`)).rows;
    const sorumlular = (await b.db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kimlik = ANY($1::text[]) ORDER BY ad_soyad`, [await rolSahipleri(b.db, await rolId(b.db, 'Sicil Sorumlusu'))])).rows;
    const yillik = (await b.db.query(`SELECT nesne_kimligi yil, son_zaman FROM is_karti WHERE tur = $1 AND durum = 'Bekliyor' ORDER BY olusturma_zamani DESC LIMIT 1`, [KABUL_YILLIK])).rows[0] ?? null;
    return { dagitim, sorumlular, gostergeler: await kabulGostergeleri(b.db), yillik, atar: await rolVar(o.kullanici, [FYY, FYMY]), hazirlar: (await rolSahipleri(b.db, await rolId(b.db, FYY))).includes(o.kullanici) };
  });
  s.post('/firma/:id/sicil-ata', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { kullanici } = (i.body ?? {}) as { kullanici?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [FYY, FYMY]))) return yok(y);
    const f = (await b.db.query(`SELECT ticari_unvan, sicil_no, kayit_asamasi, atanan_sicil_ref FROM kurulus WHERE kimlik = $1`, [id])).rows[0]; if (!f) return yok(y);
    if (f.kayit_asamasi !== 'Başvuru' || f.atanan_sicil_ref) return y.code(409).send({ hata: 'Yalnız dağıtım bekleyen başvuru atanır.' });
    if (!kullanici || !(await rolSahipleri(b.db, await rolId(b.db, 'Sicil Sorumlusu'))).includes(kullanici)) return y.code(400).send({ hata: 'Atanacak Sicil Sorumlusunu seçiniz.' });
    await b.db.query(`UPDATE kurulus SET atanan_sicil_ref = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, kullanici]);
    await kartAc(b.db, { tur: BELGE_KONTROL, kategori: 'gorev', baslik: `${f.sicil_no} · ${f.ticari_unvan} · ${BELGE_KONTROL}`, ozet: 'Başvuru belgelerini kontrol edip kaydı "Ön İncelemeye Gönder" ile Firma Yönetimi Yöneticisine gönderiniz.', sahipKullanici: kullanici, nesneTuru: 'Kuruluş', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Başvuru Sicil Sorumlusuna Atandı', nesneTuru: 'Kuruluş', nesneKimligi: id, yeni: { atanan: kullanici }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/firma/kabul-iyilestirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { oneri } = (i.body ?? {}) as { oneri?: string };
    if (!(await rolSahipleri(b.db, await rolId(b.db, FYY))).includes(o.kullanici)) return yok(y);
    const g = (await b.db.query(`SELECT kimlik, nesne_kimligi yil FROM is_karti WHERE tur = $1 AND durum = 'Bekliyor' ORDER BY olusturma_zamani DESC LIMIT 1`, [KABUL_YILLIK])).rows[0];
    if (!g) return y.code(409).send({ hata: 'Bekleyen yıllık kabul sistemi gözden geçirmesi yoktur.' });
    if (!oneri?.trim()) return y.code(400).send({ hata: 'İyileştirme önerisini yazınız.' });
    const t = (await b.db.query(`SELECT count(*)::int basvuru, (SELECT count(*)::int FROM firma_karar_onerisi WHERE durum = 'Onaylandı' AND extract(year FROM karar_zamani AT TIME ZONE 'Europe/Istanbul') = $1::int) karar FROM kurulus WHERE kayit_asamasi <> 'Aday' AND extract(year FROM olusturma_zamani AT TIME ZONE 'Europe/Istanbul') = $1::int`, [g.yil])).rows[0];
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE kimlik = $1`, [g.kimlik]);
    await kartAc(b.db, { tur: KABUL_IYILESTIRME, baslik: `${g.yil} · ${KABUL_IYILESTIRME}`, ozet: `Başvuru: ${t.basvuru} · Karar: ${t.karar} · ${oneri.trim()}`.slice(0, 1500), hazirlayan: o.kullanici, zincir: [await rolId(b.db, FYMY), await rolId(b.db, FYM)], nesneTuru: 'Kabul Sistemi', nesneKimligi: g.yil });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kabul Sistemi İyileştirme Önerisi Onaya Gönderildi', nesneTuru: 'Kabul Sistemi', nesneKimligi: g.yil, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { gonderilecek: FYMY };
  });
  // YG-1648 (A36): Sicil Kalitesi — yıldönümü paketi bekleyen firmalar ve 12 aydır güncellenmeyen kayıtlar.
  s.get('/sicil/kalite', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, SICIL_ROLLER))) return yok(y);
    const yd = (await b.db.query(`SELECT c.nesne_kimligi firma, k.ticari_unvan, k.sicil_no, c.son_zaman FROM is_karti c JOIN kurulus k ON k.kimlik::text = c.nesne_kimligi WHERE c.tur = $1 AND c.durum = 'Bekliyor' ORDER BY c.son_zaman NULLS LAST LIMIT 50`, [YILDONUMU])).rows;
    for (const x of yd) Object.assign(x, await yildonumuPaketi(b.db, x.firma));
    const eski = (await b.db.query(`SELECT kimlik, ticari_unvan, sicil_no, guncelleme_zamani FROM kurulus WHERE kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı') AND guncelleme_zamani < now() - interval '12 months' ORDER BY guncelleme_zamani LIMIT 100`)).rows;
    return { yildonumu: yd, guncellenmeyen: eski, hazirlar: await rolVar(i.oturum!.kullanici, ['Sicil Sorumlusu']) };
  });
  s.post('/sicil/yildonumu/:id/onaya-gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { degerlendirme } = (i.body ?? {}) as { degerlendirme?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, ['Sicil Sorumlusu']))) return yok(y);
    const g = (await b.db.query(`SELECT c.kimlik, k.ticari_unvan, k.sicil_no FROM is_karti c JOIN kurulus k ON k.kimlik::text = c.nesne_kimligi WHERE c.tur = $1 AND c.durum = 'Bekliyor' AND c.nesne_kimligi = $2 LIMIT 1`, [YILDONUMU, id])).rows[0];
    if (!g) return y.code(409).send({ hata: 'Bu firma için bekleyen yıldönümü gözden geçirmesi yoktur.' });
    if (!degerlendirme?.trim()) return y.code(400).send({ hata: 'Gözden geçirme değerlendirmesini yazınız.' });
    const p = await yildonumuPaketi(b.db, id);
    const ozet = `Belge: ${p.gecerli_belge} geçerli, ${p.dolan_belge} süresi dolmuş · Personel: ${p.personel} · Tesis: ${p.tesis} · Ekipman: ${p.ekipman} (${p.kullanilamaz_ekipman} kullanılamaz) · ${degerlendirme.trim()}`;
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE kimlik = $1`, [g.kimlik]);
    const zincir = [await rolId(b.db, 'Firma Yönetimi Yöneticisi'), await rolId(b.db, 'Firma Yönetimi Müdür Yardımcısı'), await rolId(b.db, FYM)];
    await kartAc(b.db, { tur: YILDONUMU_PAKET, baslik: `${g.sicil_no} · ${g.ticari_unvan} · ${YILDONUMU_PAKET}`, ozet: ozet.slice(0, 1500), hazirlayan: o.kullanici, zincir, nesneTuru: 'Firma', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kayıt Yıldönümü Paketi Onaya Gönderildi', nesneTuru: 'Firma', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { gonderilecek: 'Firma Yönetimi Yöneticisi', paket: p };
  });
  // YG-1654: geçici askıdaki firmaların karar bekleyen açık işleri (dosya bazında öneri); Firma Yönetimi Müdürlüğü izler, kararı Dosya Sorumlusu veya Operasyon Müdürü verir.
  s.get('/aski/acik-isler', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [FYM, 'Firma Yönetimi Müdür Yardımcısı']))) return yok(y);
    return (await b.db.query(`SELECT a.kimlik, k.ticari_unvan, e.is_emri_no, e.statu, d.dosya_no, a.oneri, h.ad_soyad dosya_sorumlusu, a.olusturma_zamani FROM aski_is_karari a JOIN kurulus k ON k.kimlik = a.kurulus_ref JOIN is_emri e ON e.kimlik = a.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref
      WHERE a.karar IS NULL ORDER BY k.ticari_unvan, d.dosya_no LIMIT 100`)).rows;
  });
  s.post('/aski-karari/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; gerekce?: string };
    if (!UUID.test(id)) return yok(y);
    const a = (await b.db.query(`SELECT a.*, e.is_emri_no, e.dosya_ref, e.statu, d.dosya_sorumlusu_ref FROM aski_is_karari a JOIN is_emri e ON e.kimlik = a.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref WHERE a.kimlik = $1 AND a.karar IS NULL`, [id])).rows[0];
    if (!a) return yok(y);
    if (a.dosya_sorumlusu_ref !== o.kullanici && !(await rolVar(o.kullanici, [OPM]))) return y.code(403).send({ hata: 'Kararı Dosya Sorumlusu veya Operasyon Müdürü verir.' });
    const karar = g.karar ?? a.oneri;
    if (!['Güvenli Durdurma', 'Kontrollü Devam', 'Ek Gözetim', 'Devir'].includes(karar)) return y.code(400).send({ hata: 'Kararı seçiniz.' });
    if (karar !== a.oneri && !g.gerekce?.trim()) return y.code(400).send({ hata: 'Öneriden farklı kararda gerekçe zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE aski_is_karari SET karar = $2, gerekce = $3, karar_veren_ref = $4, karar_zamani = now() WHERE kimlik = $1`, [id, karar, g.gerekce?.trim() || null, o.kullanici]);
      if (karar === 'Güvenli Durdurma' && a.statu === 'Aktif') await c.query(`UPDATE is_emri SET statu = 'Durduruldu', durdurma_nedeni = 'Firma geçici askıda: güvenli durdurma', guncelleme_zamani = now() WHERE kimlik = $1`, [a.is_emri_ref]);
      if (karar === 'Devir' && a.dosya_sorumlusu_ref) await kartAc(c, { tur: 'Firma Değiştir', kategori: 'gorev', baslik: `${a.is_emri_no} · Firma Geçici Askıda · Devir`, ozet: g.gerekce?.trim() || 'Geçici askı kararı: Devir', oncelik: 'Yüksek', sahipKullanici: a.dosya_sorumlusu_ref, nesneTuru: 'İş Emri', nesneKimligi: a.is_emri_ref });
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Geçici Askı İş Kararı' AND nesne_kimligi = $1 AND kapanma_zamani IS NULL`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Geçici Askı İş Kararı', nesneTuru: 'İş Emri', nesneKimligi: a.is_emri_ref, yeni: { karar, oneri: a.oneri }, gerekce: g.gerekce?.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { karar };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-1660: yurt dışı yerel firma talebini Operasyon Müdürü açar; iki onay kartı aynı anda açılır.
  s.post('/firma/yurt-disi-talep', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ulke?: string; sehir?: string; brans?: string; firma?: string; dosya?: string; gerekce?: string };
    if (!(await rolVar(o.kullanici, [OPM]))) return y.code(403).send({ hata: 'Yurt dışı yerel firma talebini Operasyon Müdürü açar.' });
    if (!g.ulke?.trim() || !g.sehir?.trim() || !g.brans?.trim() || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Ülke, şehir, branş ve gerekçe zorunludur.' });
    if (g.dosya && !UUID.test(g.dosya)) return y.code(400).send({ hata: 'Dosya geçersizdir.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = (await c.query(`INSERT INTO yurt_disi_firma_talebi (ulke, sehir, ana_brans, firma_adi, dosya_ref, gerekce, talep_eden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [g.ulke.trim(), g.sehir.trim(), g.brans.trim(), g.firma?.trim() || null, g.dosya || null, g.gerekce.trim(), o.kullanici])).rows[0];
      const baslik = `${g.ulke.trim()} / ${g.sehir.trim()} · ${g.brans.trim()} · Yurt Dışı Yerel Firma`;
      for (const [tur, rol] of [['Yurt Dışı Firma Onayı', FYM], ['Yurt Dışı Firma Hukuk Onayı', HUD]] as const) await kartAc(c, { tur, baslik, ozet: g.gerekce.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, rol)], nesneTuru: 'Yurt Dışı Firma Talebi', nesneKimligi: t.kimlik });
      await c.query('COMMIT');
      return { kimlik: t.kimlik, durum: 'Onayda' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.get('/firma/yurt-disi-talep', oturumlu, async (i, y) => (await rolVar(i.oturum!.kullanici, [OPM, FYM, HUD, BTD, 'Genel Müdür Yardımcısı', 'CEO'])) ? (await b.db.query(`SELECT kimlik, ulke, sehir, ana_brans, firma_adi, gerekce, fym_karari, hud_karari, durum, olusturma_zamani FROM yurt_disi_firma_talebi ORDER BY olusturma_zamani DESC LIMIT 100`)).rows : yok(y));

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
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; ekipman?: string; kapasite?: number; agirlik?: number; yeniHasar?: boolean; guzergah?: string; suAlma?: string; hasarAciklama?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!['Kaldırma', 'Taşıma', 'Tesis Değişikliği', 'Kara Taşıması', 'Denize İndirme'].includes(g.tur ?? '') || !g.ekipman?.trim()) return y.code(400).send({ hata: 'Tür ve ekipmanı girmenizi rica ederiz.' });
    // YG-376: kara taşımasında güzergâh, denize indirmeden sonra su alma kontrolü, yeni hasarda açıklama zorunludur.
    if (g.tur === 'Kara Taşıması' && !g.guzergah?.trim()) return y.code(400).send({ hata: 'Kara taşımasında güzergâhı (çıkış ve varış yeri) yazınız.' });
    if (g.tur === 'Denize İndirme' && !['Su Alma Yok', 'Su Alma Var'].includes(g.suAlma ?? '')) return y.code(400).send({ hata: 'Denize indirmeden sonra su alma kontrolünün sonucunu seçiniz.' });
    if (g.yeniHasar && !g.hasarAciklama?.trim()) return y.code(400).send({ hata: 'İşlem sırasında oluşan yeni hasarı kısaca tanımlayınız.' });
    const e = await takyidatTasimaEngeli(b.db, id); if (e) return y.code(409).send({ hata: e });
    if (g.tur !== 'Tesis Değişikliği') {
      if (!(Number(g.kapasite) > 0) || !(Number(g.agirlik) > 0)) return y.code(400).send({ hata: 'Ekipman kapasitesi ve yat ağırlığını girmenizi rica ederiz.' });
      if (Number(g.kapasite) < Number(g.agirlik)) return y.code(409).send({ hata: 'Ekipman kapasitesi yat ağırlığını karşılamıyor.' });
    }
    const r = await b.db.query(`INSERT INTO kaldirma_tasima (dosya_ref, tur, ekipman, kapasite_ton, yat_agirlik_ton, yeni_hasar, kaydeden_ref, guzergah, su_alma_kontrolu, yeni_hasar_aciklama) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`, [id, g.tur, g.ekipman.trim(), g.kapasite ?? null, g.agirlik ?? null, Boolean(g.yeniHasar), o.kullanici, g.guzergah?.trim() || null, g.tur === 'Denize İndirme' ? g.suAlma : null, g.hasarAciklama?.trim() || null]);
    if (g.suAlma === 'Su Alma Var') { const d = (await b.db.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0]; await kartAc(b.db, { tur: 'Su Alma Tedbiri', kategori: 'gorev', baslik: `${d.dosya_no} · Denize İndirmeden Sonra Su Alma`, ozet: 'Yat tekrar kaldırılmalı veya acil tedbir alınmalıdır.', oncelik: 'Kritik', sahipKullanici: d.dosya_sorumlusu_ref ?? o.kullanici, nesneTuru: 'Dosya', nesneKimligi: id }); }
    if (g.yeniHasar) { const d = (await b.db.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0]; if (d.dosya_sorumlusu_ref) await kartAc(b.db, { tur: 'Uygunsuzluk Kaydı Aç', kategori: 'gorev', baslik: `${d.dosya_no} · Kaldırma ve Taşımada Yeni Hasar`, ozet: g.ekipman.trim(), oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: id }); }
    return { kimlik: r.rows[0].kimlik };
  });

  // YG-376: FR-OPS-012 Kaldırma ve Taşıma Tutanağı; kaydeden kişi adıyla değil dosyadaki rolüyle yazılır.
  s.get('/dosya/:id/kaldirma-tasima', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT kimlik, tur, ekipman, zaman, yeni_hasar, su_alma_kontrolu FROM kaldirma_tasima WHERE dosya_ref = $1 ORDER BY zaman DESC`, [id])).rows;
  });
  s.get('/kaldirma-tasima/:id/tutanak', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT t.*, d.dosya_no, d.kimlik dosya, yt.yat_adi, (SELECT a.rol FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = t.kaydeden_ref ORDER BY a.bitis_zamani NULLS FIRST LIMIT 1) kaydeden_rol FROM kaldirma_tasima t JOIN dosya d ON d.kimlik = t.dosya_ref JOIN yat yt ON yt.kimlik = d.yat_ref WHERE t.kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, i.oturum!.kullanici, k.dosya))) return yok(y);
    const ton = (x: unknown) => (x === null || x === undefined ? null : `${Number(x).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ton`);
    const zaman = new Date(k.zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
    const { belgeIcerik } = await import('./rapor_belge.js');
    const no = `${k.dosya_no}-KT-${String(k.kimlik).slice(0, 4).toUpperCase()}`;
    const tanim = { ad: 'Kaldırma ve Taşıma Tutanağı', kod: 'FR-OPS-012', no, dosyaNo: k.dosya_no, tarih: zaman.split(' ')[0]!, surum: 'Rev.1', dil: 'tr' as const, yat: k.yat_adi, icKayit: true, bolumler: [
      { baslik: 'İşlem', tur: 'alanlar' as const, alanlar: [{ et: 'Dosya No', deger: k.dosya_no }, { et: 'Yat', deger: k.yat_adi }, { et: 'İşlem Türü', deger: k.tur }, { et: 'İşlem Zamanı', deger: zaman }, { et: 'Ekipman', deger: k.ekipman }, { et: 'Ekipman Kapasitesi', deger: ton(k.kapasite_ton) }, { et: 'Yat Ağırlığı', deger: ton(k.yat_agirlik_ton) }, { et: 'Kaydeden', deger: k.kaydeden_rol ?? 'LGM' }] },
      ...(k.tur === 'Kara Taşıması' ? [{ baslik: 'Kara Taşıması', tur: 'alanlar' as const, alanlar: [{ et: 'Güzergâh', deger: k.guzergah, genis: true }] }] : []),
      ...(k.tur === 'Denize İndirme' ? [{ baslik: 'Denize İndirme Sonrası Kontrol', tur: 'alanlar' as const, alanlar: [{ et: 'Su Alma Kontrolü', deger: k.su_alma_kontrolu }] }] : []),
      { baslik: 'İşlem Sırasında Oluşan Yeni Hasar', tur: 'alanlar' as const, alanlar: [{ et: 'Yeni Hasar', deger: k.yeni_hasar ? 'Var' : 'Yok' }, ...(k.yeni_hasar ? [{ et: 'Hasar Tanımı', deger: k.yeni_hasar_aciklama, genis: true }] : [])] },
    ] };
    const x = await belgeIcerik(tanim, (i.query as { bicim?: string }).bicim === 'docx' ? 'docx' : 'pdf');
    await izYaz(b.db, { aktor: i.oturum!.kullanici, oturum: i.oturum!.oturum, eylem: 'Belge İndirildi', nesneTuru: 'Kaldırma ve Taşıma', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return y.header('content-type', x.tur).header('content-disposition', `attachment; filename="${no}.${x.uzanti}"`).send(x.veri);
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
