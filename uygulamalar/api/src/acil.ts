import { EMNIYET_ALICILAR } from './saha_kayit.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez, mesaiIcinde } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { dilKod, ihbarAlindiGonder, ihbarKaydet, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { tutar } from './metin.js';
import { onaySonucKaydet, onayTalebiAc } from './onay.js';
import { altNumara, sureBaslat } from './sure.js';
import { parametre } from './teklif.js';
import { UUID } from './yat.js';
import { izinGerekli } from './yetki.js';

type Db = Pool | PoolClient;
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const ACIL_ALICILAR = ['Operasyon Müdürü', 'Teknik Müdür', 'Teknik ve Operasyon Direktörü', 'Genel Müdür Yardımcısı', 'CEO'];
const ACIL_TURLER = ['Can Güvenliği', 'Su Alma veya Batma', 'Yangın', 'Sürüklenme veya Bağlama Tehlikesi', 'Kirlilik', 'Diğer'];
const CAN_CEVRE = ['Can Güvenliği', 'Kirlilik'];
const DEVIR_LISTESI = ['Telefon, şarj ve batarya', 'SIM PIN ve ekran kilidi', 'WhatsApp Business ve kurumsal e-posta oturumu', 'YATONET oturumu'];

/** YG-1517: olay tarih-saatine denk gelen yürürlükteki vardiya. Çizelge boşsa null. */
export async function nobetci(db: Db, katman: 'Dosya Sorumlusu' | 'Teknik Uzman' | 'Yönetici', zaman = new Date()): Promise<string | null> {
  return (await db.query(`SELECT v.kullanici_ref FROM nobet_vardiyasi v JOIN nobet_cizelgesi c ON c.kimlik = v.cizelge_ref WHERE c.durum = 'Yürürlükte' AND v.katman = $1 AND v.baslangic <= $2 AND v.bitis > $2 ORDER BY v.baslangic DESC LIMIT 1`, [katman, zaman])).rows[0]?.kullanici_ref ?? null;
}

/** YG-251, YG-252: ilk iş günü 12:00 (Türkiye). */
export function ilkIsGunu12(simdi: Date): Date {
  const y = new Date(simdi.getTime() + 180 * 60_000);
  const g = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate(), 12));
  if (y.getUTCHours() >= 12 || mesaiIcinde(simdi) === false) g.setUTCDate(g.getUTCDate() + (y.getUTCHours() >= 12 ? 1 : 0));
  while (g.getUTCDay() === 0) g.setUTCDate(g.getUTCDate() + 1);
  return new Date(g.getTime() - 180 * 60_000);
}

/** YG-256, YG-1473: firma tutarı × katsayı yat sahibine yansıyan tutardır; 2.000,00 ön uyarı, 2.500,00 sınır; can ve çevrede sınır yok. */
export function acilSinir(firmaEur: number, katsayi: number, onUyari: number, sinir: number, canCevre: boolean) {
  const yansiyan = R2(firmaEur * katsayi);
  if (canCevre) return { yansiyan, durum: 'Sınırsız' as const };
  if (yansiyan >= sinir) return { yansiyan, durum: 'Onay Bekliyor' as const };
  if (yansiyan >= onUyari) return { yansiyan, durum: 'Ön Uyarı' as const };
  return { yansiyan, durum: 'Sınır Altında' as const };
}

kapanisKaydet('Nöbet Çizelgesi', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') {
    const t = (await c.query(`SELECT donem FROM nobet_cizelgesi WHERE kimlik = $1`, [k.nesne_kimligi])).rows[0];
    await c.query(`UPDATE nobet_cizelgesi SET durum = 'Yerine Geçti' WHERE donem = $1 AND durum = 'Yürürlükte'`, [t.donem]);
    await c.query(`UPDATE nobet_cizelgesi SET durum = 'Yürürlükte', onaylayan_ref = $2, yayim_zamani = now() WHERE kimlik = $1`, [k.nesne_kimligi, yapan]);
  } else if (karar === 'Reddet') await c.query(`UPDATE nobet_cizelgesi SET durum = 'Reddedildi' WHERE kimlik = $1`, [k.nesne_kimligi]);
});

// YG-257: ONY-29 onayı; 2.500,00 EUR aşımı için.
onaySonucKaydet('ONY-29', async (c, t, karar) => {
  await c.query(`UPDATE acil_mudahale SET sinir_durumu = $2 WHERE dosya_ref = $1`, [t.dosya_ref, karar === 'Onaylandı' ? 'Onaylandı' : 'Yükseltildi']);
});
kapanisKaydet('Acil Tutar Onayı', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE acil_mudahale SET sinir_durumu = 'Onaylandı' WHERE dosya_ref = $1::uuid`, [k.nesne_kimligi]);
});

async function sirakiSaglayici(c: PoolClient, dosya: string): Promise<{ kimlik: string; ticari_unvan: string } | undefined> {
  // YG-266, YG-272: aktif, onaylı, acil hizmet verir; müsait olmayan atlanır; daha önce çağrılan atlanır.
  return (await c.query(`SELECT u.kimlik, u.ticari_unvan FROM kurulus u WHERE u.kayit_rolu = 'Çözüm Ortağı' AND u.acil_hizmet_verir AND u.acil_musaitlik AND u.ag_statusu = 'Aktif' AND u.kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı') AND NOT EXISTS (SELECT 1 FROM acil_gorev_cagrisi a WHERE a.dosya_ref = $1 AND a.kurulus_ref = u.kimlik) ORDER BY u.acil_arama_sirasi NULLS LAST, u.sicil_no LIMIT 1`, [dosya])).rows[0];
}

async function cagriGonder(c: PoolClient, dosya: string, simdi: Date): Promise<string | null> {
  const f = await sirakiSaglayici(c, dosya);
  const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  if (!f) {
    // YG-271: Kaynak Bulunamadı; kırmızı uyarı yönetici nöbetçisine ve Operasyon Müdürüne.
    const al = [...await rolSahipleri(c, await rolId(c, 'Operasyon Müdürü'))]; const y = await nobetci(c, 'Yönetici', simdi); if (y) al.push(y);
    await bildir(c, { olay: `kaynak-yok:${dosya}`, kullanicilar: al, baslik: `Kaynak Bulunamadı: ${d.dosya_no}`, ozet: 'Uygun acil sağlayıcı yanıt vermedi.', oncelik: 'Kritik', sms: true, acil: true }, simdi);
    return null;
  }
  const no = await altNumara(c, d.dosya_no, 'ÇA');
  const son = new Date(simdi.getTime() + (await parametre(c, 'acil_cagri_dk')) * 60_000);
  await c.query(`INSERT INTO acil_gorev_cagrisi (cagri_no, dosya_ref, kurulus_ref, gonderim, son_zaman) VALUES ($1,$2,$3,$4,$5)`, [no, dosya, f.kimlik, simdi, son]);
  const kisi = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [f.kimlik])).rows.map((r) => r.kullanici_ref as string);
  await bildir(c, { olay: `acil-cagri:${no}`, kullanicilar: kisi, baslik: `Acil Görev Çağrısı: ${no}`, ozet: `Yanıt süresi ${(await parametre(c, 'acil_cagri_dk'))} dakikadır.`, oncelik: 'Kritik', sms: true, acil: true }, simdi);
  return no;
}

/** YG-266: 30 dakikada kabul yoksa Yanıtsız, sıradakine. YG-257: ONY-29'a 30 dakikada yanıt yoksa GMY, yoksa T&O Direktörü. */
export async function acilIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const c = await db.connect();
  try {
    const { rows } = await c.query(`SELECT kimlik, dosya_ref FROM acil_gorev_cagrisi WHERE durum = 'Gönderildi' AND son_zaman < $1`, [simdi]);
    for (const r of rows) {
      await c.query('BEGIN');
      try {
        await c.query(`UPDATE acil_gorev_cagrisi SET durum = 'Yanıtsız' WHERE kimlik = $1 AND durum = 'Gönderildi'`, [r.kimlik]);
        await cagriGonder(c, r.dosya_ref, simdi);
        await c.query('COMMIT'); n++;
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    }
    const onay = (await c.query(`SELECT m.dosya_ref, d.dosya_no FROM acil_mudahale m JOIN dosya d ON d.kimlik = m.dosya_ref WHERE m.sinir_durumu = 'Onay Bekliyor' AND m.sinir_onay_son < $1 AND m.durum = 'Açık'`, [simdi])).rows;
    for (const r of onay) {
      if (!(await birKez(c, 'acil_sinir_yukselt', r.dosya_ref))) continue;
      const gmy = await rolId(c, 'Genel Müdür Yardımcısı'); const hedef = (await rolSahipleri(c, gmy)).length ? gmy : await rolId(c, 'Teknik ve Operasyon Direktörü');
      await c.query(`UPDATE acil_mudahale SET sinir_durumu = 'Yükseltildi' WHERE dosya_ref = $1`, [r.dosya_ref]);
      await kartAc(c, { tur: 'Acil Tutar Onayı', baslik: `${r.dosya_no} · Acil Tedbir 2.500,00 EUR Aşımı`, ozet: 'Yat sahibine 30 dakikada ulaşılamadı.', oncelik: 'Kritik', zincir: [hedef], nesneTuru: 'Dosya', nesneKimligi: r.dosya_ref });
      n++;
    }
  } finally { c.release(); }
  return n;
}

export function acilYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };

  // YG-244: çizelgeyi Operasyon Müdür Yardımcısı hazırlar, Operasyon Müdürü onaylar; en az 10 gün önce yayımlanır, ay başına tek yürürlükte.
  s.get('/nobet/adaylar', { preHandler: izinGerekli(b, 'nobet.hazirla') }, async () => (await b.db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kullanici_grubu = 'LGM İç Rolü' ORDER BY ad_soyad LIMIT 500`)).rows);
  s.post('/nobet/cizelge', { preHandler: izinGerekli(b, 'nobet.hazirla') }, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { donem?: string; vardiyalar?: { katman?: string; kullanici?: string; baslangic?: string; bitis?: string; brans?: string }[]; degisiklik?: boolean };
    if (!/^\d{4}-\d{2}$/.test(g.donem ?? '')) return y.code(400).send({ hata: 'Dönem YYYY-AA biçiminde olmalıdır.' });
    if (!g.vardiyalar?.length) return y.code(400).send({ hata: 'Vardiya giriniz.' });
    const ilkGun = new Date(`${g.donem}-01T00:00:00+03:00`);
    if (!g.degisiklik && ilkGun.getTime() - Date.now() < 10 * 86_400_000) return y.code(409).send({ hata: 'Çizelge dönem başından en az 10 gün önce yayımlanır; değişiklik olarak gönderiniz.' });
    for (const v of g.vardiyalar) {
      if (!['Dosya Sorumlusu', 'Teknik Uzman', 'Yönetici'].includes(v.katman ?? '') || !v.kullanici || !v.baslangic || !v.bitis || new Date(v.bitis) <= new Date(v.baslangic)) return y.code(400).send({ hata: 'Vardiya katman, kişi ve zaman içermelidir.' });
    }
    return islem(async (c) => {
      const sur = (await c.query(`SELECT coalesce(max(surum), 0) + 1 n FROM nobet_cizelgesi WHERE donem = $1`, [g.donem])).rows[0].n;
      const t = (await c.query(`INSERT INTO nobet_cizelgesi (donem, surum, durum, hazirlayan_ref) VALUES ($1,$2,'Onayda',$3) RETURNING kimlik`, [g.donem, sur, o.kullanici])).rows[0];
      for (const v of g.vardiyalar!) await c.query(`INSERT INTO nobet_vardiyasi (cizelge_ref, katman, kullanici_ref, baslangic, bitis, brans) VALUES ($1,$2,$3,$4,$5,$6)`, [t.kimlik, v.katman, v.kullanici, v.baslangic, v.bitis, v.brans ?? null]);
      await kartAc(c, { tur: 'Nöbet Çizelgesi', baslik: `Nöbet Çizelgesi ${g.donem} Rev.${sur}`, ozet: `${g.vardiyalar!.length} vardiya`, hazirlayan: o.kullanici, zincir: [await rolId(c, 'Operasyon Müdürü')], nesneTuru: 'Nöbet Çizelgesi', nesneKimligi: t.kimlik });
      return { kimlik: t.kimlik, surum: sur };
    });
  });
  s.get('/nobet/simdi', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu sayfa LGM personeline açıktır.' });
    const ad = async (k: string | null) => (k ? (await b.db.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1`, [k])).rows[0]?.ad_soyad : null);
    return { mesaiIcinde: mesaiIcinde(new Date()), dosyaSorumlusu: await ad(await nobetci(b.db, 'Dosya Sorumlusu')), teknikUzman: await ad(await nobetci(b.db, 'Teknik Uzman')), yonetici: await ad(await nobetci(b.db, 'Yönetici')) };
  });
  // YG-246, YG-247: dijital devir; kontrol listesi tamamlanmadan olmaz; devralan onaylar.
  s.post('/nobet/devir', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { devralan?: string; liste?: string[]; acikOlaylar?: string };
    if (!g.devralan || g.devralan === o.kullanici) return y.code(400).send({ hata: 'Devralan kişiyi seçiniz.' });
    if (DEVIR_LISTESI.some((m) => !g.liste?.includes(m))) return y.code(400).send({ hata: `Kontrol listesini tamamlayınız: ${DEVIR_LISTESI.filter((m) => !g.liste?.includes(m)).join(', ')}.` });
    const r = (await b.db.query(`INSERT INTO nobet_devri (devreden_ref, devralan_ref, kontrol_listesi, acik_olaylar) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [o.kullanici, g.devralan, JSON.stringify(g.liste), g.acikOlaylar ?? null])).rows[0];
    await bildir(b.db, { olay: `nobet-devir:${r.kimlik}`, kullanicilar: [g.devralan], baslik: 'Nöbet Devri Onayınızı Bekliyor', acil: true, sms: true });
    return { kimlik: r.kimlik };
  });
  s.post('/nobet/devir/:id/onayla', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const r = await b.db.query(`UPDATE nobet_devri SET devralan_onay_zamani = now() WHERE kimlik = $1 AND devralan_ref = $2 AND devralan_onay_zamani IS NULL RETURNING kimlik`, [id, o.kullanici]);
    if (!r.rowCount) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Nöbet Devri Onaylandı', sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-263, YG-253, YG-255: Acil Çağrı; kısa kayıt, dosya geçici açılır, tedbir beklemeden başlar, bildirim anında ve silsilesiz gider.
  s.post('/acil/cagri', { preHandler: izinGerekli(b, 'ihbar.kaydet') }, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { telefon?: string; ad?: string; sahibiTuru?: string; yatAdi?: string; konum?: string; olay?: string; olayTuru?: string; musteriTuru?: string; hatirlatma112?: boolean; sigortaci?: string };
    if (!ACIL_TURLER.includes(g.olayTuru ?? '')) return y.code(400).send({ hata: 'Olay türünü seçiniz.' });
    if (!g.telefon?.trim() || !g.yatAdi?.trim() || !g.konum?.trim() || !g.olay?.trim()) return y.code(400).send({ hata: 'Arayan numara, yat, konum ve olay özeti zorunludur.' });
    const musteri = g.musteriTuru ?? 'Bireysel Müşteri';
    if (!['Bireysel Müşteri', 'Kurumsal Müşteri', 'Sigorta Şirketi'].includes(musteri)) return y.code(400).send({ hata: 'Müşteri türü geçersiz.' });
    const simdi = new Date();
    return islem(async (c) => {
      const ds = (await nobetci(c, 'Dosya Sorumlusu', simdi)) ?? o.kullanici;
      const r = await ihbarKaydet(c, { kanal: 'Telefon', sahibiAdi: g.ad?.trim() || 'Arayan', sahibiTuru: g.sahibiTuru ?? 'Yatın Kaptanı', telefon: g.telefon!.trim(), konum: g.konum!, yatDurumu: g.olayTuru!, ihtiyac: g.olay!, acil: true, yat: { adi: g.yatAdi, markaDiger: '', modelDiger: '' }, sigortaci: g.sigortaci, cevaplar: {} }, o.kullanici, { ilkSorumlu: ds }, simdi);
      if ('hata' in r) throw Object.assign(new Error(r.hata), { statusCode: 400 });
      await c.query(`UPDATE talep SET mukerrerlik_sonucu = 'Mükerrer değil' WHERE kimlik = $1`, [r.kimlik]);
      await ihbarAlindiGonder(c, r.kimlik, b.webAdresi);
      const t = (await c.query(`SELECT * FROM talep WHERE kimlik = $1`, [r.kimlik])).rows[0];
      const sigortali = musteri === 'Sigorta Şirketi';
      const d = (await c.query(`INSERT INTO dosya (dosya_no, talep_ref, yat_ref, bildirim_tarihi, konum, kisa_teknik_tanim, musteri_turu, dosya_niteligi, odeme_sorumlusu, oncelik, onerilen_oncelik, acil_gecici_acilis, eksik_alan_gerekcesi, tamamlama_hedef_tarihi, yazisma_dili, dosya_sorumlusu_ref, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Kritik','Kritik',true,'Acil kısa kayıt',$10,$11,$12,$13) RETURNING kimlik, dosya_no`,
        [t.talep_no, t.kimlik, t.yat_ref, t.bildirim_alinma_zamani, g.konum, g.olay, musteri, sigortali ? 'Sigorta bağlantılı' : 'Doğrudan hizmet', sigortali ? ['Sigorta'] : ['Yat sahibi'], ilkIsGunu12(simdi).toISOString().slice(0, 10), t.yazisma_dili, ds, o.kullanici])).rows[0];
      await c.query(`UPDATE talep SET statu = 'Dosyaya Dönüştü', dosya_ref = $2 WHERE kimlik = $1`, [t.kimlik, d.kimlik]);
      await c.query(`INSERT INTO dosya_statu_gecmisi (dosya_ref, yeni_statu, yeni_asama, gerekce, sonraki_sorumlu_rol, olusturan_ref) VALUES ($1,'Aktif','Keşif','Acil geçici açılış','Dosya Sorumlusu',$2)`, [d.kimlik, o.kullanici]);
      await c.query(`UPDATE dosya SET statu = 'Aktif', asama = 'Keşif' WHERE kimlik = $1`, [d.kimlik]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE nesne_kimligi = $1 AND tur = 'İhbar Açılış Kontrolü'`, [t.kimlik]);
      await c.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, ds, o.kullanici]);
      await c.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, telefon, talep_sahibi_mi, olusturan_ref) VALUES ($1,'Kaptan',$2,$3,true,$4)`, [d.kimlik, t.talep_sahibi_adi, t.talep_sahibi_telefon, o.kullanici]);
      if (sigortali) await c.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi, olusturan_ref) VALUES ($1,$2,$3)`, [d.kimlik, g.sigortaci ?? null, o.kullanici]);
      await sureBaslat(c, { tur: 'Sahaya Ulaşma', oncelik: 'Kritik', baslangic: simdi, dosya: d.kimlik });
      // YG-250, YG-251, YG-252: mesai dışında nöbetçi Uzman atanır; Teknik Müdür ilk iş günü 12:00'ye kadar teyit eder; olağan DS'ye devir aynı süre.
      const tu = await nobetci(c, 'Teknik Uzman', simdi);
      const mesaiDisi = !mesaiIcinde(simdi);
      if (tu) await c.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Teknik Uzman',$3)`, [d.kimlik, tu, o.kullanici]);
      const son12 = ilkIsGunu12(simdi);
      if (mesaiDisi && tu) await kartAc(c, { tur: 'Nöbetçi Uzman Teyidi', kategori: 'islem', baslik: `${d.dosya_no} · Nöbetçi Uzman Teyidi`, ozet: 'Onaylayınız veya değiştiriniz.', sonZaman: son12, sahipRol: await rolId(c, 'Teknik Müdür'), nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
      if (mesaiDisi) await kartAc(c, { tur: 'Acil Dosya Devri', kategori: 'islem', baslik: `${d.dosya_no} · Olağan Dosya Sorumlusuna Devir`, ozet: 'İlk iş günü 12:00', sonZaman: son12, sahipRol: await rolId(c, 'Operasyon Müdürü'), nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
      const canCevre = CAN_CEVRE.includes(g.olayTuru!);
      const yon = (await nobetci(c, 'Yönetici', simdi));
      await c.query(`INSERT INTO acil_mudahale (dosya_ref, olay_turu, can_cevre_riski, tehlike, talimat_veren_ref, olay_yoneticisi_ref, hatirlatma_112, sinir_durumu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [d.kimlik, g.olayTuru, canCevre, g.olay, o.kullanici, mesaiDisi ? yon : null, Boolean(g.hatirlatma112), canCevre ? 'Sınırsız' : 'Sınır Altında']);
      const al: string[] = []; for (const rl of ACIL_ALICILAR) al.push(...await rolSahipleri(c, await rolId(c, rl))); if (mesaiDisi && yon) al.push(yon);
      await bildir(c, { olay: `acil-tedbir:${d.kimlik}`, kullanicilar: al, baslik: `Acil İlk Tedbir: ${d.dosya_no}`, ozet: `${g.olayTuru} · ${g.yatAdi} · ${g.konum} · Eşiğe kalan: ${tutar(await parametre(c, 'acil_sinir_eur'))} EUR`, oncelik: 'Kritik', sms: true, acil: true }, simdi);
      const cagri = await cagriGonder(c, d.kimlik, simdi);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Acil Çağrı Açıldı', nesneTuru: 'Dosya', nesneKimligi: d.kimlik, yeni: { tur: g.olayTuru }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: d.kimlik, dosyaNo: d.dosya_no, cagri, uyari112: "Acil durumlarda lütfen önce 112'yi arayınız." };
    });
  });

  const firmam = async (k: string) => (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;

  // YG-267: çağrı fiyatsız; konum, yat tipi, olay türü, tehlike ve erişim.
  s.get('/firma-portal/acil-cagrilar', oturumlu, async (i, y) => {
    const f = await firmam(i.oturum!.kullanici);
    if (!f) return y.code(403).send({ hata: 'Bu sayfa Çözüm Ortağı kullanıcılarına açıktır.' });
    return (await b.db.query(`SELECT a.kimlik, a.cagri_no, a.son_zaman, a.durum, d.konum, y.tur AS yat_tipi, m.olay_turu, m.tehlike FROM acil_gorev_cagrisi a JOIN dosya d ON d.kimlik = a.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref JOIN acil_mudahale m ON m.dosya_ref = d.kimlik WHERE a.kurulus_ref = $1 AND a.durum = 'Gönderildi' ORDER BY a.gonderim`, [f])).rows;
  });

  // YG-268, YG-269, YG-1473: Kabul ediyorum, yola çıkıyorum / Müsait değilim. Kabulle AC iş emri kendiliğinden açılır; tutar ön değeri girilir.
  s.post('/firma-portal/acil-cagri/:id/yanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { yanit?: string; tahmini?: number };
    const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    if (!['Kabul', 'Müsait Değil'].includes(g.yanit ?? '')) return y.code(400).send({ hata: 'Yanıtı seçiniz.' });
    if (g.yanit === 'Kabul' && !(Number(g.tahmini) >= 0)) return y.code(400).send({ hata: 'Tahmini tutarı giriniz.' });
    return islem(async (c) => {
      const a = (await c.query(`SELECT a.*, d.dosya_no, d.konum, d.kisa_teknik_tanim FROM acil_gorev_cagrisi a JOIN dosya d ON d.kimlik = a.dosya_ref WHERE a.kimlik = $1 AND a.kurulus_ref = $2 FOR UPDATE OF a`, [id, f])).rows[0];
      if (!a) throw Object.assign(new Error('Çağrı bulunamadı.'), { statusCode: 404 });
      if (a.durum !== 'Gönderildi') throw Object.assign(new Error('Bu çağrı artık açık değildir.'), { statusCode: 409 });
      const simdi = new Date();
      if (g.yanit === 'Müsait Değil') {
        await c.query(`UPDATE acil_gorev_cagrisi SET durum = 'Müsait Değil', yanit_zamani = $2 WHERE kimlik = $1`, [id, simdi]);
        return { durum: 'Müsait Değil', siradaki: await cagriGonder(c, a.dosya_ref, simdi) };
      }
      const r = await acKabul(c, a, f, o.kullanici, Number(g.tahmini), simdi);
      await c.query(`UPDATE acil_gorev_cagrisi SET durum = 'Kabul', yanit_zamani = $2, is_emri_ref = $3 WHERE kimlik = $1`, [id, simdi, r.isEmri]);
      return { durum: 'Kabul', ...r };
    });
  });

  async function acKabul(c: PoolClient, a: Record<string, any>, firma: string, kim: string, tahmini: number, simdi: Date) {
    const no = await altNumara(c, a.dosya_no, 'AC');
    const e = (await c.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, firma_yaniti, firma_kabul_eden_ref, firma_kabul_zamani, yayim_zamani, hazirlayan_ref) VALUES ($1,'AC',$2,$3,$4,$5,'Aktif','Kabul',$6,$7,$7,(SELECT talimat_veren_ref FROM acil_mudahale WHERE dosya_ref = $2)) RETURNING kimlik`,
      [no, a.dosya_ref, firma, a.konum, `Acil ilk tedbir: ${a.kisa_teknik_tanim}`, kim, simdi])).rows[0];
    const t = await tutarIsle(c, a.dosya_ref, tahmini, simdi);
    return { isEmri: e.kimlik, isEmriNo: no, ...t };
  }

  // YG-256, YG-257, YG-1473: tahmini tutar her güncellendiğinde eşikler yeniden hesaplanır; ONY-29 yalnız bireysel/sigortasız.
  async function tutarIsle(c: PoolClient, dosya: string, firmaEur: number, simdi: Date) {
    const [kat, ou, sn] = [await parametre(c, 'fiyat_katsayisi'), await parametre(c, 'acil_on_uyari_eur'), await parametre(c, 'acil_sinir_eur')];
    const m = (await c.query(`SELECT m.*, d.dosya_no, d.dosya_sorumlusu_ref, d.dosya_niteligi, d.yazisma_dili, y.yat_adi FROM acil_mudahale m JOIN dosya d ON d.kimlik = m.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE m.dosya_ref = $1 FOR UPDATE OF m`, [dosya])).rows[0];
    const h = acilSinir(firmaEur, kat, ou, sn, m.can_cevre_riski);
    const durumKilitli = ['Onay Bekliyor', 'Onaylandı', 'Yükseltildi'].includes(m.sinir_durumu);
    const yeni = durumKilitli ? m.sinir_durumu : h.durum;
    await c.query(`UPDATE acil_mudahale SET tahmini_firma_eur = $2, yansiyan_eur = $3, sinir_durumu = $4 WHERE dosya_ref = $1`, [dosya, firmaEur, h.yansiyan, yeni]);
    const al = [m.dosya_sorumlusu_ref].filter(Boolean);
    if (h.durum === 'Ön Uyarı' && m.sinir_durumu === 'Sınır Altında') await bildir(c, { olay: `acil-onuyari:${dosya}`, kullanicilar: al, baslik: `Acil Tutar Ön Uyarı: ${m.dosya_no}`, ozet: `${tutar(h.yansiyan)} EUR`, oncelik: 'Kritik', acil: true }, simdi);
    if (h.durum === 'Onay Bekliyor' && !durumKilitli) {
      await bildir(c, { olay: `acil-sinir:${dosya}`, kullanicilar: al, baslik: `Acil Tutar Sınırı Aşıldı: ${m.dosya_no}`, ozet: `${tutar(h.yansiyan)} EUR`, oncelik: 'Kritik', acil: true, sms: true }, simdi);
      if (m.dosya_niteligi === 'Sigorta bağlantılı') await c.query(`UPDATE acil_mudahale SET sinir_durumu = 'Sınır Altında' WHERE dosya_ref = $1`, [dosya]); // K-217: sigortalıda aşım onayı istenmez; ödenmeyen kalem ayrı teklif.
      else {
        const sah = (await c.query(`SELECT kimlik, kisi_adi_soyadi, telefon, eposta, kullanici_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu IN ('Yat Sahibi', 'Kaptan') AND aktif ORDER BY taraf_rolu = 'Yat Sahibi' DESC LIMIT 1`, [dosya])).rows[0];
        await c.query(`UPDATE acil_mudahale SET sinir_onay_son = $2 WHERE dosya_ref = $1`, [dosya, new Date(simdi.getTime() + 30 * 60_000)]);
        if (sah) await onayTalebiAc(c, { dosya, ony: 'ONY-29', dil: dilKod(m.yazisma_dili), alanlar: { Yat: m.yat_adi, Yacht: m.yat_adi, tutar: tutar(h.yansiyan), amount: tutar(h.yansiyan, 'en'), özet: m.tehlike, summary: m.tehlike, 'bağlantı': b.webAdresi, link: b.webAdresi }, tutar: h.yansiyan, taraf: sah.kimlik, kullanici: sah.kullanici_ref, aliciAd: sah.kisi_adi_soyadi, telefon: sah.telefon, eposta: sah.eposta, belgeAdi: 'Acil İlk Tedbir Ek Çalışma Onayı', gun: 1, webAdresi: b.webAdresi });
      }
    }
    return { yansiyan: h.yansiyan, sinirDurumu: (await c.query(`SELECT sinir_durumu FROM acil_mudahale WHERE dosya_ref = $1`, [dosya])).rows[0].sinir_durumu as string };
  }

  s.post('/firma-portal/is-emri/:id/acil-tutar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tahmini?: number };
    const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    if (!(Number(g.tahmini) >= 0)) return y.code(400).send({ hata: 'Tutar geçersiz.' });
    const e = (await b.db.query(`SELECT dosya_ref FROM is_emri WHERE kimlik = $1 AND kurulus_ref = $2 AND is_emri_turu = 'AC'`, [id, f])).rows[0];
    if (!e) return yok(y);
    return islem((c) => tutarIsle(c, e.dosya_ref, Number(g.tahmini), new Date()));
  });

  // YG-1456, YG-270: firmayla başka kanaldan temas: elle kayıt, AC iş emri, sıralı arama durur.
  s.post('/acil/:dosya/elle-kabul', oturumlu, async (i, y) => {
    const o = i.oturum!; const { dosya } = i.params as { dosya: string }; const g = (i.body ?? {}) as { firma?: string; kanal?: string; kisi?: string; talimat?: string; tahmini?: number };
    if (!UUID.test(dosya) || !(await dosyaErisimi(b.db, o.kullanici, dosya))) return yok(y);
    if (!g.firma || !g.kanal?.trim() || !g.kisi?.trim() || !g.talimat?.trim()) return y.code(400).send({ hata: 'Firma, kanal, kişi ve talimat zorunludur.' });
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no, konum, kisa_teknik_tanim FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
      await c.query(`UPDATE acil_gorev_cagrisi SET durum = 'İptal' WHERE dosya_ref = $1 AND durum = 'Gönderildi'`, [dosya]);
      const no = await altNumara(c, d.dosya_no, 'ÇA');
      const r = await acKabul(c, { ...d, dosya_ref: dosya }, g.firma!, o.kullanici, Number(g.tahmini ?? 0), new Date());
      await c.query(`INSERT INTO acil_gorev_cagrisi (cagri_no, dosya_ref, kurulus_ref, durum, son_zaman, yanit_zamani, is_emri_ref, elle_kayit) VALUES ($1,$2,$3,'Kabul',now(),now(),$4,$5)`, [no, dosya, g.firma, r.isEmri, JSON.stringify({ kanal: g.kanal, kisi: g.kisi, talimat: g.talimat, giren: o.kullanici })]);
      return r;
    });
  });

  // YG-254, YG-274, YG-1595: kapanış sonuç, risk ve devam kararıyla; sigortalıda ilk bilgi tutarsız. BLD-55 tutar içermez.
  s.post('/acil/:dosya/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { dosya } = i.params as { dosya: string }; const g = (i.body ?? {}) as { sonuc?: string; risk?: string };
    if (!UUID.test(dosya) || !(await dosyaErisimi(b.db, o.kullanici, dosya))) return yok(y);
    if (!g.sonuc?.trim() || !g.risk?.trim()) return y.code(400).send({ hata: 'Sonuç ve riskin son durumu zorunludur.' });
    return islem(async (c) => {
      const m = (await c.query(`SELECT m.*, d.dosya_no, d.oncelik, d.statu, d.asama, d.yazisma_dili, y.yat_adi FROM acil_mudahale m JOIN dosya d ON d.kimlik = m.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE m.dosya_ref = $1 FOR UPDATE OF m`, [dosya])).rows[0];
      if (!m) throw Object.assign(new Error('Acil kaydı bulunamadı.'), { statusCode: 404 });
      if (m.durum === 'Kapalı') throw Object.assign(new Error('Acil kaydı kapalıdır.'), { statusCode: 409 });
      await c.query(`UPDATE acil_mudahale SET durum = 'Kapalı', sonuc = $2, risk_durumu = $3, bitis = now() WHERE dosya_ref = $1`, [dosya, g.sonuc!.trim(), g.risk!.trim()]);
      await c.query(`UPDATE acil_gorev_cagrisi SET durum = 'İptal' WHERE dosya_ref = $1 AND durum = 'Gönderildi'`, [dosya]);
      const t = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu IN ('Yat Sahibi', 'Kaptan') AND aktif ORDER BY taraf_rolu = 'Yat Sahibi' DESC LIMIT 1`, [dosya])).rows[0];
      const saat = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
      const alan = { Yat: m.yat_adi, Yacht: m.yat_adi, saat, time: saat, özet: g.sonuc!.trim(), summary: g.sonuc!.trim() };
      if (t) await yatTarafinaYaz(c, { olay: `bld55:${dosya}`, kod: 'BLD-55', dil: dilKod(m.yazisma_dili), konu: `${m.dosya_no} Acil Tedbir`, telefon: t.telefon, eposta: t.eposta, acil: true, alanlar: alan });
      return { tamam: true };
    });
  });

  // YG-262: emniyet olayı veya iş durdurma tüm alıcılara; yeniden başlatma izni Teknik Müdürde.
  s.post('/dosya/:id/is-durdur', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { neden } = (i.body ?? {}) as { neden?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!neden?.trim()) return y.code(400).send({ hata: 'Neden zorunludur.' });
    return islem(async (c) => {
      await c.query(`UPDATE dosya SET calisma_durduruldu = true WHERE kimlik = $1`, [id]);
      await c.query(`UPDATE is_emri SET statu = 'Durduruldu', durdurma_nedeni = $2 WHERE dosya_ref = $1 AND statu = 'Aktif'`, [id, neden!.trim()]);
      const d = (await c.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const al: string[] = [d.dosya_sorumlusu_ref].filter(Boolean); for (const r of EMNIYET_ALICILAR) al.push(...await rolSahipleri(c, await rolId(c, r)));
      await bildir(c, { olay: `is-durdu:${id}:${Date.now()}`, kullanicilar: al, baslik: `Emniyet Olayı · İş Durduruldu: ${d.dosya_no}`, ozet: neden!.trim().slice(0, 200), oncelik: 'Kritik', sms: true, acil: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İş Durduruldu', nesneTuru: 'Dosya', nesneKimligi: id, gerekce: neden, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { tamam: true };
    });
  });
  s.post('/dosya/:id/is-baslat', { preHandler: izinGerekli(b, 'dosya.ata.teknik') }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { gerekce } = (i.body ?? {}) as { gerekce?: string };
    if (!UUID.test(id)) return yok(y);
    if (!gerekce?.trim()) return y.code(400).send({ hata: 'Güvenli koşul doğrulaması zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM uygunsuzluk u JOIN is_emri e ON e.kimlik = u.is_emri_ref WHERE e.dosya_ref = $1 AND e.statu = 'Durduruldu' AND u.is_durduruldu AND u.statu NOT IN ('Kapalı', 'Geçersiz') LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'İşi durduran uygunsuzluk açıktır; kapanması bekleniyor.' }); // V-123
    await b.db.query(`UPDATE dosya SET calisma_durduruldu = false WHERE kimlik = $1`, [id]);
    await b.db.query(`UPDATE is_emri SET statu = 'Aktif', durdurma_nedeni = NULL WHERE dosya_ref = $1 AND statu = 'Durduruldu'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İş Yeniden Başlatıldı', nesneTuru: 'Dosya', nesneKimligi: id, gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-1656, YG-1657: yat sahibi Acil Durum: tür seçimi; Diğer açıklama ister; önce 112 uyarısı. Nöbetçi Dosya Sorumlusuna düşer.
  s.post('/portal/acil', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; aciklama?: string; yatAdi?: string; konum?: string };
    if (o.grup === 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu sayfa dış kullanıcılara açıktır.' });
    if (!ACIL_TURLER.includes(g.tur ?? '')) return y.code(400).send({ hata: 'Acil durum türünü seçiniz.' });
    if (g.tur === 'Diğer' && !g.aciklama?.trim()) return y.code(400).send({ hata: 'Kısaca belirtiniz.' });
    if (!g.yatAdi?.trim() || !g.konum?.trim()) return y.code(400).send({ hata: 'Yat ve konum zorunludur.' });
    const simdi = new Date();
    return islem(async (c) => {
      const h = (await c.query(`SELECT ad_soyad, cep_telefonu, e_posta FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
      const ilk = (await nobetci(c, 'Dosya Sorumlusu', simdi)) ?? (await rolSahipleri(c, await rolId(c, 'Operasyon Müdürü')))[0] ?? o.kullanici;
      const r = await ihbarKaydet(c, { kanal: 'Portal', sahibiAdi: h.ad_soyad, sahibiTuru: 'Yat Sahibi', telefon: h.cep_telefonu ?? undefined, eposta: h.e_posta ?? undefined, konum: g.konum!, yatDurumu: g.tur!, ihtiyac: g.aciklama?.trim() || g.tur!, acil: true, yat: { adi: g.yatAdi, markaDiger: '', modelDiger: '' }, cevaplar: {} }, o.kullanici, { ilkSorumlu: ilk }, simdi);
      if ('hata' in r) throw Object.assign(new Error(r.hata), { statusCode: 400 });
      await bildir(c, { olay: `portal-acil:${r.kimlik}`, kullanicilar: [ilk], baslik: `Acil İhbar: ${r.talepNo}`, ozet: `${g.tur} · ${g.yatAdi} · ${g.konum}`, oncelik: 'Kritik', sms: true, acil: true }, simdi);
      return { talepNo: r.talepNo, uyari112: "Acil durumlarda lütfen önce 112'yi arayınız." };
    });
  });
}
