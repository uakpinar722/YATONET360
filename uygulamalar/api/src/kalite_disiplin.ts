import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { haftaAnahtari } from './uyum_tarama.js';
import { UUID } from './yat.js';

const KY = 'Kalite Yöneticisi'; const KMY = 'Kalite Müdür Yardımcısı'; const KM = 'Kalite Müdürü';

/** YG-1687: eksik kontrol kaydı: planlanan zamanından 24 saat geçmiş, sonucu ve kanıtı girilmemiş kontrol noktası; sonucu girilmiş ama ölçüm cihazı bağlanmamış test kaydı. */
const EKSIKLER = `
  SELECT 'Kontrol Noktası' tur, n.kimlik, n.kontrol_noktasi_no no, d.dosya_no, d.kimlik dosya, n.planlanan_zaman zaman, 'Sonuç ve kanıt girilmedi' eksik,
         (SELECT a.kullanici_ref FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.rol = 'Kalite Kontrolör' AND a.bitis_zamani IS NULL LIMIT 1) kontrolor
    FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref
   WHERE n.serbest_birakma_zamani IS NULL AND n.kanit_surum_ref IS NULL AND n.planlanan_zaman < $1::timestamptz - interval '24 hours' AND d.statu NOT IN ('Kapalı') AND e.statu NOT IN ('İptal', 'Yerine Geçti')
  UNION ALL
  SELECT 'Test Kaydı', t.kimlik, t.test_no, d.dosya_no, d.kimlik, t.olusturma_zamani, 'Ölçüm cihazı bağlanmadı',
         (SELECT a.kullanici_ref FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.rol = 'Kalite Kontrolör' AND a.bitis_zamani IS NULL LIMIT 1)
    FROM test_kaydi t JOIN dosya d ON d.kimlik = t.dosya_ref
   WHERE t.sonuc IS NOT NULL AND cardinality(t.cihazlar) = 0 AND t.olusturma_zamani > $1::timestamptz - interval '90 days'`;

/** YG-1687: her pazartesi Kalite Yöneticisine "Eksik Kontrol Kayıtları" görevi; liste Bugün sayfasında, kontrolörden "Düzeltme İste". */
export async function eksikKontrolKayitlari(db: Pool, simdi = new Date()): Promise<boolean> {
  if (simdi.getDay() !== 1 || !(await birKez(db, 'eksik-kontrol-kayitlari', haftaAnahtari(simdi)))) return false;
  const l = (await db.query(EKSIKLER, [simdi])).rows;
  if (!l.length) return false;
  const son = new Date(simdi); son.setHours(17, 0, 0, 0);
  await kartAc(db, { tur: 'Eksik Kontrol Kayıtları', kategori: 'gorev', baslik: `${haftaAnahtari(simdi)} · Eksik Kontrol Kayıtları (${l.length})`, ozet: `${l.slice(0, 10).map((x) => `${x.no} (${x.dosya_no}): ${x.eksik}`).join(' · ')}${l.length > 10 ? ' …' : ''}. Bugün sayfasındaki listeden kontrolörden "Düzeltme İste" ile isteyiniz.`, sahipRol: await rolId(db, KY), sonZaman: son, nesneTuru: 'Eksik Kontrol Kayıtları', nesneKimligi: haftaAnahtari(simdi), simdi });
  return true;
}

/** YG-1687: aylık Kalite Kontrolör Raporu (kontrol sayısı, açılan uygunsuzluk, kayıt tamlığı); Kalite Yöneticisi "Onaya Gönder" → Kalite Müdür Yardımcısı. */
export async function kaliteKontrolorAylikRapor(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const bas = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1)); const bit = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1));
  const donem = bas.toISOString().slice(0, 7);
  if (!(await birKez(db, 'kalite-kontrolor-aylik', donem))) return false;
  const p = [`${donem}-01T00:00:00+03:00`, `${bit.toISOString().slice(0, 10)}T00:00:00+03:00`];
  const l = (await db.query(`SELECT h.ad_soyad,
      (SELECT count(*)::int FROM kontrol_noktasi n WHERE h.kimlik = ANY(n.dogrulayanlar) AND n.serbest_birakma_zamani >= $1 AND n.serbest_birakma_zamani < $2) kontrol,
      (SELECT count(*)::int FROM kontrol_noktasi n WHERE h.kimlik = ANY(n.dogrulayanlar) AND n.serbest_birakma_zamani >= $1 AND n.serbest_birakma_zamani < $2 AND n.kanit_surum_ref IS NOT NULL) kanitli,
      (SELECT count(*)::int FROM uygunsuzluk u WHERE u.acan_ref = h.kimlik AND u.olusturma_zamani >= $1 AND u.olusturma_zamani < $2) uygunsuzluk
    FROM kullanici_hesabi h WHERE h.kimlik IN (SELECT a.kullanici_ref FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE r.rol_adi = 'Kalite Uzmanı (Kalite Kontrolör)' AND a.atama_durumu = 'Aktif') ORDER BY h.ad_soyad`, p)).rows;
  const satir = l.map((x) => `${x.ad_soyad}: kontrol ${x.kontrol}, uygunsuzluk ${x.uygunsuzluk}, kayıt tamlığı ${x.kontrol ? `%${Math.round((100 * x.kanitli) / x.kontrol)}` : '—'}`);
  await kartAc(db, { tur: 'Kalite Kontrolör Raporu', kategori: 'onay', baslik: `${donem} · Kalite Kontrolör Raporu · Aylık`, ozet: (satir.length ? satir.join(' · ') : 'Dönemde kayıtlı Kalite Uzmanı yoktur.').slice(0, 1500), zincir: [await rolId(db, KY), await rolId(db, KMY)], nesneTuru: 'Kalite Kontrolör Raporu', nesneKimligi: donem, simdi });
  return true;
}

/** YG-1687: her Ocak yıllık Saha Geri Bildirimi (kontrol listeleri ve test formları kullanım verisi); Kalite Yöneticisi görüşünü yazıp "Onaya Gönder" → Kalite Müdürü (Ek II araç setinin sahibi). */
export async function sahaGeriBildirimiYillik(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); if (ist.getUTCMonth() !== 0) return false;
  const yil = ist.getUTCFullYear() - 1;
  if (!(await birKez(db, 'saha-geri-bildirimi', String(yil)))) return false;
  const p = [`${yil}-01-01T00:00:00+03:00`, `${yil + 1}-01-01T00:00:00+03:00`];
  const kl = (await db.query(`SELECT count(*)::int n FROM kontrol_listesi_kaydi WHERE olusturma_zamani >= $1 AND olusturma_zamani < $2`, p).catch(() => ({ rows: [{ n: null }] }))).rows[0].n;
  const tg = (await db.query(`SELECT test_grubu g, count(*)::int n, count(*) FILTER (WHERE sonuc IS NOT NULL AND sonuc <> 'Başarılı')::int b FROM test_kaydi WHERE olusturma_zamani >= $1 AND olusturma_zamani < $2 GROUP BY 1 ORDER BY 2 DESC`, p)).rows;
  const ozet = `Kontrol listesi kaydı ${kl ?? '—'} · Test formları: ${tg.length ? tg.map((x) => `${x.g} ${x.n} (başarısız ${x.b})`).join(', ') : 'kayıt yok'}. Saha geri bildirimini arz notuna yazarak Kalite Müdürüne gönderiniz.`;
  await kartAc(db, { tur: 'Saha Geri Bildirimi', kategori: 'onay', baslik: `${yil} · Saha Geri Bildirimi · Yıllık`, ozet: ozet.slice(0, 1500), zincir: [await rolId(db, KY), await rolId(db, KM)], nesneTuru: 'Saha Geri Bildirimi', nesneKimligi: String(yil), simdi });
  return true;
}

/** YG-1587 (A16-4): ayın ilk günü Teknik Müdür Yardımcısına aylık örneklem öz kontrolü; önceki ayda teknik raporu onaylanan dosyalardan rastgele en az 5 dosya (azsa tümü). */
export async function teknikOrneklemAylik(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const bas = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1)); const bit = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1));
  const donem = bas.toISOString().slice(0, 7);
  if (!(await birKez(db, 'teknik-orneklem', donem))) return false;
  const l = (await db.query(`SELECT d.dosya_no FROM dosya d WHERE EXISTS (SELECT 1 FROM teknik_rapor r WHERE r.dosya_ref = d.kimlik AND r.olusturma_zamani >= $1::date AND r.olusturma_zamani < $2::date) ORDER BY random() LIMIT 5`, [`${donem}-01`, bit.toISOString().slice(0, 10)])).rows.map((r) => r.dosya_no as string);
  await kartAc(db, { tur: 'Aylık Örneklem Öz Kontrolü', kategori: 'gorev', baslik: `${donem} · Aylık Örneklem Öz Kontrolü (${l.length} dosya)`, ozet: l.length ? `Teknik rapor, ölçüm ve kanıt tutarlılığını kontrol ediniz: ${l.join(', ')}.` : 'Dönemde teknik raporu olan dosya yoktur.', sahipRol: await rolId(db, 'Teknik Müdür Yardımcısı'), sonZaman: new Date(`${bit.toISOString().slice(0, 10)}T00:00:00+03:00`.replace(/-01T/, '-15T')), nesneTuru: 'Teknik Örneklem', nesneKimligi: donem, simdi });
  return true;
}

/** YG-1689 (¶2436, ¶2447): kalite verisi doğrulama; tamlık (sonuç girilmiş kontrol noktasında kanıt yok, açık uygunsuzlukta hedef zamanı yok), tutarlılık (kapalı uygunsuzlukta kapanış kanıtı yok), tekillik (aynı iş emrinde aynı ölçüt ve durumla mükerrer açık uygunsuzluk). */
const VERI_SORUNLARI = `
  SELECT 'Tamlık' boyut, n.kimlik, n.kontrol_noktasi_no no, d.dosya_no, 'Kontrol noktası serbest bırakılmış ancak kanıt sürümü yok' sorun, (SELECT a.kullanici_ref FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.rol = 'Kalite Kontrolör' AND a.bitis_zamani IS NULL LIMIT 1) sorumlu
    FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref WHERE n.serbest_birakma_zamani IS NOT NULL AND n.kanit_surum_ref IS NULL
  UNION ALL SELECT 'Tamlık', u.kimlik, u.uygunsuzluk_no, d.dosya_no, 'Açık uygunsuzlukta hedef zamanı yok', u.acan_ref FROM uygunsuzluk u JOIN dosya d ON d.kimlik = u.dosya_ref WHERE u.statu NOT IN ('Kapalı', 'Geçersiz') AND u.hedef_zamani IS NULL
  UNION ALL SELECT 'Tutarlılık', u.kimlik, u.uygunsuzluk_no, d.dosya_no, 'Kapalı uygunsuzlukta kapanış kanıtı veya kapatan yok', u.acan_ref FROM uygunsuzluk u JOIN dosya d ON d.kimlik = u.dosya_ref WHERE u.statu = 'Kapalı' AND (u.kapanis_kaniti_ref IS NULL OR u.kapanis_yetkilisi_ref IS NULL)
  UNION ALL SELECT 'Tekillik', u.kimlik, u.uygunsuzluk_no, d.dosya_no, 'Aynı iş emrinde aynı ölçüt ve durumla mükerrer açık uygunsuzluk', u.acan_ref FROM uygunsuzluk u JOIN dosya d ON d.kimlik = u.dosya_ref
    WHERE u.statu NOT IN ('Kapalı', 'Geçersiz') AND EXISTS (SELECT 1 FROM uygunsuzluk x WHERE x.kimlik <> u.kimlik AND x.is_emri_ref IS NOT DISTINCT FROM u.is_emri_ref AND x.dosya_ref = u.dosya_ref AND x.dayanak_olcut = u.dayanak_olcut AND x.gercek_durum = u.gercek_durum AND x.statu NOT IN ('Kapalı', 'Geçersiz') AND x.olusturma_zamani < u.olusturma_zamani)`;

export async function kaliteVeriDogrulamaAylik(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const donem = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  if (!(await birKez(db, 'kalite-veri-dogrulama', donem))) return false;
  const l = (await db.query(`SELECT boyut, count(*)::int n FROM (${VERI_SORUNLARI}) x GROUP BY boyut`)).rows;
  await kartAc(db, { tur: 'Kalite Verisi Doğrulama', kategori: 'gorev', baslik: `${donem} · Kalite Verisi Doğrulama · Aylık`, ozet: l.length ? `${l.map((x) => `${x.boyut} ${x.n}`).join(' · ')}. Bugün sayfasındaki listeden "Tamamlatma İste" ile kayıt sahibinden tamamlatınız.` : 'Tamlık, tutarlılık ve tekillik sorunu bulunmamaktadır.', sahipRol: await rolId(db, KMY), nesneTuru: 'Kalite Verisi Doğrulama', nesneKimligi: donem, simdi });
  return true;
}

/** YG-1689 (¶2452): üç ayda bir (Ocak, Nisan, Temmuz, Ekim) önümüzdeki 3 ayda ara doğrulaması gelen kritik cihazlar; Kalite Müdür Yardımcısı "Onaya Gönder" → Kalite Müdürü (kalibrasyon programının sahibi). */
export async function kritikCihazAraDogrulamaTakvimi(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const ay = ist.getUTCMonth(); if (ay % 3 !== 0) return false;
  const ceyrek = `${ist.getUTCFullYear()}-Q${ay / 3 + 1}`;
  if (!(await birKez(db, 'kritik-cihaz-ara-dogrulama', ceyrek))) return false;
  const l = (await db.query(`SELECT ad, seri_no, (coalesce(ara_dogrulama_tarihi, kalibrasyon_tarihi) + interval '6 months')::date::text vade FROM olcum_cihazi WHERE kritik AND kabul AND coalesce(durum, '') <> 'Karantina' AND coalesce(ara_dogrulama_tarihi, kalibrasyon_tarihi) + interval '6 months' < $1::date + interval '3 months' ORDER BY 3`, [ist.toISOString().slice(0, 10)]).catch(async () => db.query(`SELECT ad, seri_no, (coalesce(ara_dogrulama_tarihi, kalibrasyon_tarihi) + interval '6 months')::date::text vade FROM olcum_cihazi WHERE kritik AND kabul AND coalesce(ara_dogrulama_tarihi, kalibrasyon_tarihi) + interval '6 months' < $1::date + interval '3 months' ORDER BY 3`, [ist.toISOString().slice(0, 10)]))).rows;
  await kartAc(db, { tur: 'Kritik Cihaz Ara Doğrulama Takvimi', kategori: 'onay', baslik: `${ceyrek} · Kritik Cihaz Ara Doğrulama Takvimi`, ozet: (l.length ? l.map((x) => `${x.ad} ${x.seri_no}: ${x.vade.split('-').reverse().join('.')}`).join(' · ') : 'Önümüzdeki 3 ayda ara doğrulaması gelen kritik cihaz yoktur.').slice(0, 1500), zincir: [await rolId(db, KMY), await rolId(db, KM)], nesneTuru: 'Kritik Cihaz Takvimi', nesneKimligi: ceyrek, simdi });
  return true;
}

/** YG-1691 (¶2340): ayın ilk günü Aylık Kalite Göstergeleri (Kalite Müdürlüğü göstergeleri: ilk seferde kabul, yeniden iş, test başarı, kritik kontrol tamlığı, garanti); Kalite Müdürü "Risk ve Kalite Direktörüne Gönder". */
export async function aylikKaliteGostergeleri(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const donem = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  if (!(await birKez(db, 'aylik-kalite-gostergeleri', donem))) return false;
  const { gostergeleriHesapla } = await import('./gosterge.js');
  const l = (await gostergeleriHesapla(db, (x) => x === 'Kalite Müdürlüğü')).concat((await gostergeleriHesapla(db, () => true)).filter((x) => x.kod === 'G-9.6-6'));
  const ozet = l.map((x) => `${x.ad}: ${x.deger === null ? 'veri yok' : `${String(x.deger).replace('.', ',')} ${x.birim}`}`).join(' · ');
  await kartAc(db, { tur: 'Aylık Kalite Göstergeleri', kategori: 'onay', baslik: `${donem} · Aylık Kalite Göstergeleri`, ozet: ozet.slice(0, 1500), zincir: [await rolId(db, KM), await rolId(db, 'Risk ve Kalite Direktörü')], nesneTuru: 'Aylık Kalite Göstergeleri', nesneKimligi: donem, simdi });
  return true;
}

export function kaliteDisiplinYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, [KY, KMY, KM]])).rowCount);
  s.get('/kalite/eksik-kontrol-kayitlari', oturumlu, async (i, y) => {
    if (!(await yetkili(i.oturum!.kullanici))) return yok(y);
    return (await b.db.query(`SELECT x.*, h.ad_soyad kontrolor_adi, EXISTS (SELECT 1 FROM is_karti k WHERE k.tur = 'Kontrol Kaydı Düzeltme' AND k.nesne_kimligi = x.kimlik::text AND k.durum = 'Bekliyor') istendi FROM (${EKSIKLER}) x LEFT JOIN kullanici_hesabi h ON h.kimlik = x.kontrolor ORDER BY x.zaman LIMIT 200`, [new Date()])).rows;
  });
  // YG-1685: Kalite Uzmanı takvimi (7 gün): kontrolörü olduğu dosyalarda kontrol noktaları ve tanıklıklar, katıldığı TPL-07/08/09 toplantıları; bekleyen garanti yeniden doğrulamaları.
  s.get('/kalite/takvim', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    const k = i.oturum!.kullanici;
    const noktalar = (await b.db.query(`SELECT n.kimlik, n.kontrol_noktasi_no no, n.nokta_turu tur, n.planlanan_zaman zaman, d.dosya_no FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref
      WHERE n.serbest_birakma_zamani IS NULL AND n.planlanan_zaman BETWEEN now() - interval '1 day' AND now() + interval '7 days' AND EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = $1 AND a.rol IN ('Kalite Kontrolör', 'Yedek Kalite Kontrolör') AND a.bitis_zamani IS NULL) ORDER BY n.planlanan_zaman`, [k])).rows;
    const toplantilar = (await b.db.query(`SELECT t.kimlik, t.tpl_kod tur, t.konu no, t.baslangic zaman, (SELECT dosya_no FROM dosya WHERE kimlik = t.dosya_ref) dosya_no FROM toplanti t JOIN toplanti_katilimci p ON p.toplanti_ref = t.kimlik AND p.kullanici_ref = $1 WHERE t.tpl_kod IN ('TPL-07', 'TPL-08', 'TPL-09') AND t.baslangic BETWEEN now() AND now() + interval '7 days' ORDER BY t.baslangic`, [k])).rows;
    const garanti = (await b.db.query(`SELECT g.kimlik, g.kayit_no, d.dosya_no FROM is_karti c JOIN garanti_sikayet g ON g.kimlik::text = c.nesne_kimligi JOIN dosya d ON d.kimlik = g.dosya_ref WHERE c.tur = 'Garanti Yeniden Doğrulama' AND c.durum = 'Bekliyor' AND (c.sahip_kullanici_ref = $1 OR c.sahip_rol_ref IN (SELECT rol_ref FROM rol_atamasi WHERE kullanici_ref = $1 AND atama_durumu = 'Aktif')) ORDER BY c.olusturma_zamani`, [k])).rows;
    return { olaylar: [...noktalar, ...toplantilar].sort((a, c) => +new Date(a.zaman) - +new Date(c.zaman)), garanti };
  });
  s.get('/kalite/veri-dogrulama', oturumlu, async (i, y) => {
    if (!(await yetkili(i.oturum!.kullanici))) return yok(y);
    return (await b.db.query(`SELECT x.*, h.ad_soyad sorumlu_adi, EXISTS (SELECT 1 FROM is_karti k WHERE k.tur = 'Kalite Verisi Tamamlatma' AND k.nesne_kimligi = x.kimlik::text AND k.durum = 'Bekliyor') istendi FROM (${VERI_SORUNLARI}) x LEFT JOIN kullanici_hesabi h ON h.kimlik = x.sorumlu ORDER BY x.boyut, x.dosya_no LIMIT 200`)).rows;
  });
  s.post('/kalite/veri-dogrulama/:id/tamamlatma-iste', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await yetkili(o.kullanici))) return yok(y);
    const x = (await b.db.query(`SELECT * FROM (${VERI_SORUNLARI}) x WHERE x.kimlik = $1`, [id])).rows[0]; if (!x) return yok(y);
    if (!x.sorumlu) return y.code(409).send({ hata: 'Kaydın sorumlusu belirlenemedi.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Kalite Verisi Tamamlatma' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id])).rowCount) return y.code(409).send({ hata: 'Tamamlatma istenmiştir.' });
    await kartAc(b.db, { tur: 'Kalite Verisi Tamamlatma', kategori: 'gorev', baslik: `${x.dosya_no} · ${x.no} · Kayıt Tamamlatma`, ozet: `${x.boyut}: ${x.sorun}.`, oncelik: 'Yüksek', sahipKullanici: x.sorumlu, hazirlayan: o.kullanici, nesneTuru: x.boyut, nesneKimligi: id });
    return { tamam: true };
  });
  s.post('/kalite/eksik-kontrol-kaydi/:id/duzeltme-iste', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await yetkili(o.kullanici))) return yok(y);
    const x = (await b.db.query(`SELECT * FROM (${EKSIKLER}) x WHERE x.kimlik = $2`, [new Date(), id])).rows[0]; if (!x) return yok(y);
    if (!x.kontrolor) return y.code(409).send({ hata: 'Dosyada Kalite Kontrolör atanmamıştır; önce atama yapınız.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Kontrol Kaydı Düzeltme' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id])).rowCount) return y.code(409).send({ hata: 'Bu kayıt için düzeltme istenmiştir.' });
    await kartAc(b.db, { tur: 'Kontrol Kaydı Düzeltme', kategori: 'gorev', baslik: `${x.dosya_no} · ${x.no} · Kayıt Düzeltme`, ozet: `${x.tur}: ${x.eksik}. Kaydı tamamlayınız.`, oncelik: 'Yüksek', sahipKullanici: x.kontrolor, hazirlayan: o.kullanici, nesneTuru: x.tur, nesneKimligi: id });
    await bildir(b.db, { olay: `kontrol-duzeltme:${id}:${Date.now()}`, kullanicilar: [x.kontrolor], baslik: `Kayıt Düzeltme İstendi: ${x.no}`, ozet: x.eksik });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kontrol Kaydı Düzeltme İstendi', nesneTuru: x.tur, nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  void rolSahipleri;
}
