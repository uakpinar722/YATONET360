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
import { isGunuSonu, parametre } from './teklif.js';
import { UUID } from './yat.js';
import { GRUP_YAT } from './portal.js';
import { izinGerekli } from './yetki.js';

type Db = Pool | PoolClient;
const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const ACIL_ALICILAR = ['Operasyon Müdürü', 'Teknik Müdür', 'Teknik ve Operasyon Direktörü', 'Genel Müdür Yardımcısı', 'CEO'];
import { acilEkipBildirimi, omAramaGorevi, tedbirSonrasiGorevler } from './acil_ek.js';
const ACIL_TURLER = ['Can Güvenliği', 'Su Alma veya Batma', 'Yangın', 'Sürüklenme veya Bağlama Tehlikesi', 'Kirlilik', 'Diğer'];
const CAN_CEVRE = ['Can Güvenliği', 'Kirlilik'];
const DEVIR_LISTESI = ['Telefon, şarj ve batarya', 'SIM PIN ve ekran kilidi', 'WhatsApp Business ve kurumsal e-posta oturumu', 'YATONET oturumu'];

/** YG-1517: olay tarih-saatine denk gelen yürürlükteki vardiya. Çizelge boşsa null. */
/** YG-240: nöbet saatleri hafta içi 18:00–09:00, Cumartesi 15:00 sonrası, Pazar ve resmî tatil tüm gün; her katmanda (Dosya Sorumlusu, Teknik Uzman, Yönetici) her saat bir vardiyayla kapsanmalıdır. */
export async function nobetKapsamaBosluklari(db: Db, donem: string, vardiyalar: { katman: string; baslangic: string; bitis: string }[]): Promise<string[]> {
  const tatil = new Set((await db.query(`SELECT to_char(tarih, 'YYYY-MM-DD') t FROM resmi_tatil WHERE NOT yarim_gun`)).rows.map((r) => r.t as string));
  const [yil, ay] = donem.split('-').map(Number) as [number, number]; const bos: string[] = [];
  for (const katman of ['Dosya Sorumlusu', 'Teknik Uzman', 'Yönetici']) {
    const vl = vardiyalar.filter((v) => v.katman === katman).map((v) => [new Date(v.baslangic).getTime(), new Date(v.bitis).getTime()] as const);
    let acik: string | null = null;
    for (let g = new Date(Date.UTC(yil, ay - 1, 1, -3)); g.getTime() < Date.UTC(yil, ay, 1, -3); g = new Date(g.getTime() + 3_600_000)) {
      const yr = new Date(g.getTime() + 3 * 3_600_000); const s = yr.getUTCHours(); const dow = yr.getUTCDay(); const gun = yr.toISOString().slice(0, 10);
      const nobet = dow === 0 || tatil.has(gun) || (dow === 6 ? s < 9 || s >= 15 : s < 9 || s >= 18);
      const kapali = !nobet || vl.some(([b, e]) => b <= g.getTime() && e >= g.getTime() + 3_600_000);
      if (!kapali && !acik) acik = `${katman} ${gun.split('-').reverse().join('.')} ${String(s).padStart(2, '0')}:00`;
      if (kapali && acik) { bos.push(acik); acik = null; }
    }
    if (acik) bos.push(acik);
  }
  return bos;
}

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
  return (await c.query(`SELECT u.kimlik, u.ticari_unvan FROM kurulus u WHERE u.kayit_rolu = 'Çözüm Ortağı' AND u.acil_hizmet_verir AND u.acil_musaitlik AND u.ag_statusu = 'Aktif' AND u.kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı') AND NOT EXISTS (SELECT 1 FROM acil_gorev_cagrisi a WHERE a.dosya_ref = $1 AND a.kurulus_ref = u.kimlik)
    AND ($2::int <> 1 OR EXISTS (SELECT 1 FROM sozlesme_kaydi s WHERE s.kurulus_ref = u.kimlik AND s.durum = 'Yürürlükte' AND s.yururluk <= current_date AND (s.bitis IS NULL OR s.bitis >= current_date))) ORDER BY u.acil_arama_sirasi NULLS LAST, u.sicil_no LIMIT 1`, [dosya, await parametre(c, 'sozlesme_kapisi')])).rows[0]; // YG-272: Çerçeve Sözleşmesi yürürlükte
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
  const no = await altNumara(c, d.dosya_no, 'CA');
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

/** YG-259: acil ihbar (telefon veya portal) beklemeden Kritik dosyaya dönüşür; nöbetçi ekip atanır, sağlayıcı çağrısı ve eskalasyon hemen başlar. */
async function acilDosyaAc(c: PoolClient, talep: string, g: { konum: string; olay: string; olayTuru: string; yatAdi: string; musteri: string; sigortaci?: string; hatirlatma112?: boolean }, ds: string, yapan: string, simdi: Date, taraf: { rol: string; kullanici?: string }) {
  const t = (await c.query(`SELECT * FROM talep WHERE kimlik = $1`, [talep])).rows[0];
  const sigortali = g.musteri === 'Sigorta Şirketi';
  const d = (await c.query(`INSERT INTO dosya (dosya_no, talep_ref, yat_ref, bildirim_tarihi, konum, kisa_teknik_tanim, musteri_turu, dosya_niteligi, odeme_sorumlusu, oncelik, onerilen_oncelik, acil_gecici_acilis, eksik_alan_gerekcesi, tamamlama_hedef_tarihi, yazisma_dili, dosya_sorumlusu_ref, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Kritik','Kritik',true,'Acil kısa kayıt',$10,$11,$12,$13) RETURNING kimlik, dosya_no`,
    [t.talep_no, t.kimlik, t.yat_ref, t.bildirim_alinma_zamani, g.konum, g.olay, g.musteri, sigortali ? 'Sigorta bağlantılı' : 'Doğrudan hizmet', sigortali ? ['Sigorta'] : ['Yat sahibi'], ilkIsGunu12(simdi).toISOString().slice(0, 10), t.yazisma_dili, ds, yapan])).rows[0];
  await c.query(`UPDATE talep SET statu = 'Dosyaya Dönüştü', dosya_ref = $2 WHERE kimlik = $1`, [t.kimlik, d.kimlik]);
  await c.query(`INSERT INTO dosya_statu_gecmisi (dosya_ref, yeni_statu, yeni_asama, gerekce, sonraki_sorumlu_rol, olusturan_ref) VALUES ($1,'Aktif','Keşif','Acil geçici açılış','Dosya Sorumlusu',$2)`, [d.kimlik, yapan]);
  await c.query(`UPDATE dosya SET statu = 'Aktif', asama = 'Keşif' WHERE kimlik = $1`, [d.kimlik]);
  await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE nesne_kimligi = $1 AND tur = 'İhbar Açılış Kontrolü'`, [t.kimlik]);
  await c.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, ds, yapan]);
  await c.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, telefon, talep_sahibi_mi, olusturan_ref, kullanici_ref) VALUES ($1,$2,$3,$4,true,$5,$6)`, [d.kimlik, taraf.rol, t.talep_sahibi_adi, t.talep_sahibi_telefon, yapan, taraf.kullanici ?? null]);
  if (sigortali) await c.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi, olusturan_ref) VALUES ($1,$2,$3)`, [d.kimlik, g.sigortaci ?? null, yapan]);
  await sureBaslat(c, { tur: 'Sahaya Ulaşma', oncelik: 'Kritik', baslangic: simdi, dosya: d.kimlik });
  // YG-250, YG-251, YG-252: mesai dışında nöbetçi Uzman atanır; Teknik Müdür ilk iş günü 12:00'ye kadar teyit eder; olağan DS'ye devir aynı süre.
  const tu = await nobetci(c, 'Teknik Uzman', simdi);
  const mesaiDisi = !mesaiIcinde(simdi);
  if (tu) await c.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Teknik Uzman',$3)`, [d.kimlik, tu, yapan]);
  const son12 = ilkIsGunu12(simdi);
  if (mesaiDisi && tu) await kartAc(c, { tur: 'Nöbetçi Uzman Teyidi', kategori: 'islem', baslik: `${d.dosya_no} · Nöbetçi Uzman Teyidi`, ozet: 'Onaylayınız veya değiştiriniz.', sonZaman: son12, sahipRol: await rolId(c, 'Teknik Müdür'), nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
  if (mesaiDisi) await kartAc(c, { tur: 'Acil Dosya Devri', kategori: 'islem', baslik: `${d.dosya_no} · Olağan Dosya Sorumlusuna Devir`, ozet: 'İlk iş günü 12:00', sonZaman: son12, sahipRol: await rolId(c, 'Operasyon Müdürü'), nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
  const canCevre = CAN_CEVRE.includes(g.olayTuru!);
  const yon = (await nobetci(c, 'Yönetici', simdi));
  await c.query(`INSERT INTO acil_mudahale (dosya_ref, olay_turu, can_cevre_riski, tehlike, talimat_veren_ref, olay_yoneticisi_ref, hatirlatma_112, sinir_durumu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [d.kimlik, g.olayTuru, canCevre, g.olay, yapan, mesaiDisi ? yon : null, Boolean(g.hatirlatma112), canCevre ? 'Sınırsız' : 'Sınır Altında']);
  const al: string[] = []; for (const rl of ACIL_ALICILAR) al.push(...await rolSahipleri(c, await rolId(c, rl))); if (mesaiDisi && yon) al.push(yon);
  const cagri = await cagriGonder(c, d.kimlik, simdi);
  // YG-255: olay türü, yat, adres, can/çevre riski, alınan tedbir, tahmini tutar, eşiğe kalan, olay yöneticisi ve sonraki adım.
  const yonAd = (await c.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1`, [(mesaiDisi ? yon : null) ?? yapan])).rows[0]?.ad_soyad ?? '-';
  const ozet = [`Olay: ${g.olayTuru}`, `Yat: ${g.yatAdi}`, `Adres: ${g.konum}`, `Can/Çevre Riski: ${canCevre ? 'Var' : 'Yok'}`, `Alınan Tedbir: Acil ilk tedbir başlatıldı${g.hatirlatma112 ? '; 112 hatırlatıldı' : ''}`,
    'Tahmini Tutar: 0,00 EUR (firma kabulünde girilir)', canCevre ? 'Eşiğe Kalan: Sınırsız (can/çevre)' : `Eşiğe Kalan: ${tutar(await parametre(c, 'acil_sinir_eur'))} EUR`, `Olay Yöneticisi: ${yonAd}`,
    `Sonraki Adım: ${cagri ? 'Sağlayıcı kabulü bekleniyor' : 'Müsait sağlayıcı yok; Operasyon Müdürü sağlayıcı arar'}`].join(' · ');
  await bildir(c, { olay: `acil-tedbir:${d.kimlik}`, kullanicilar: al, baslik: `Acil İlk Tedbir: ${d.dosya_no}`, ozet, oncelik: 'Kritik', sms: true, acil: true }, simdi);
  if (mesaiDisi && canCevre) await omAramaGorevi(c, d.kimlik, d.dosya_no, 'Can veya çevre riski'); // YG-1481
  if (mesaiDisi && !cagri) await omAramaGorevi(c, d.kimlik, d.dosya_no, 'Müsait sağlayıcı yok');
  return { d, cagri };
}

export function acilYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };

  // YG-244: çizelgeyi Operasyon Müdür Yardımcısı hazırlar, Operasyon Müdürü onaylar; en az 10 gün önce yayımlanır, ay başına tek yürürlükte.
  // YG-241: adaylar katmanın rol sahipleridir; Yönetici katmanı Operasyon ve Teknik müdürlüklerinin müdür yardımcıları ve yöneticileridir.
  const KATMAN_ROL: Record<string, string[]> = { 'Dosya Sorumlusu': ['Dosya Sorumlusu'], 'Teknik Uzman': ['Teknik Uzman'], 'Yönetici': ['Operasyon Müdür Yardımcısı', 'Teknik Müdür Yardımcısı', 'Operasyon Yöneticisi', 'Teknik Yönetici'] };
  const katmanAdaylari = async () => (await b.db.query(`SELECT u.kimlik, u.ad_soyad, array_agg(DISTINCT k.katman) katmanlar FROM kullanici_hesabi u JOIN rol_atamasi a ON a.kullanici_ref = u.kimlik AND a.atama_durumu = 'Aktif' JOIN rol r ON r.kimlik = a.rol_ref JOIN jsonb_each($1::jsonb) k(katman, roller) ON r.rol_adi IN (SELECT jsonb_array_elements_text(k.roller)) WHERE u.kullanici_grubu = 'LGM İç Rolü' GROUP BY u.kimlik, u.ad_soyad ORDER BY u.ad_soyad`, [JSON.stringify(KATMAN_ROL)])).rows as { kimlik: string; ad_soyad: string; katmanlar: string[] }[];
  s.get('/nobet/adaylar', { preHandler: izinGerekli(b, 'nobet.hazirla') }, async () => katmanAdaylari());
  // YG-244, YG-1587: teknik taraf (branş nöbeti Teknik Uzman, teknik yönetici nöbeti Teknik Yönetici/Teknik Müdür Yardımcısı) Teknik Müdür Yardımcısınca (veya Teknik Müdürce) hazırlanır;
  // yayımdan (dönem başından 10 gün önce) en az 15 gün önce, yani dönem başından 25 gün önce Operasyon Müdür Yardımcısına iletilir. Geç iletim kaydedilir ve işaretlenir.
  const TEKNIK_YON = ['Teknik Müdür Yardımcısı', 'Teknik Yönetici'];
  const teknikHazirlayan = async (k: string) => {
    const r = (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((z) => z.rol_adi as string);
    return r.includes('Teknik Müdür Yardımcısı') || r.includes('Teknik Müdür');
  };
  const teknikAdaylar = async () => {
    const tek = new Set((await b.db.query(`SELECT a.kullanici_ref FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($1)`, [TEKNIK_YON])).rows.map((z) => z.kullanici_ref as string));
    return (await katmanAdaylari()).map((x) => ({ ...x, katmanlar: x.katmanlar.filter((k) => k === 'Teknik Uzman' || (k === 'Yönetici' && tek.has(x.kimlik))) })).filter((x) => x.katmanlar.length);
  };
  s.get('/nobet/teknik-adaylar', oturumlu, async (i, y) => (await teknikHazirlayan(i.oturum!.kullanici)) ? teknikAdaylar() : yok(y));
  s.post('/nobet/teknik-taraf', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { donem?: string; vardiyalar?: { katman?: string; kullanici?: string; baslangic?: string; bitis?: string; brans?: string }[] };
    if (!(await teknikHazirlayan(o.kullanici))) return yok(y);
    if (!/^\d{4}-\d{2}$/.test(g.donem ?? '')) return y.code(400).send({ hata: 'Dönem YYYY-AA biçiminde olmalıdır.' });
    if (!g.vardiyalar?.length) return y.code(400).send({ hata: 'Vardiya giriniz.' });
    const ad = new Map((await teknikAdaylar()).map((x) => [x.kimlik, x.katmanlar]));
    for (const v of g.vardiyalar) {
      if (!['Teknik Uzman', 'Yönetici'].includes(v.katman ?? '') || !v.kullanici || !v.baslangic || !v.bitis || new Date(v.bitis) <= new Date(v.baslangic)) return y.code(400).send({ hata: 'Vardiya katman, kişi ve zaman içermelidir.' });
      if (!ad.get(v.kullanici)?.includes(v.katman!)) return y.code(400).send({ hata: v.katman === 'Yönetici' ? 'Teknik yönetici nöbetine Teknik Yönetici veya Teknik Müdür Yardımcısı yazılır.' : 'Branş nöbetine Teknik Uzman yazılır.' });
    }
    const son = new Date(new Date(`${g.donem}-01T00:00:00+03:00`).getTime() - 25 * 86_400_000); const gec = Date.now() > son.getTime();
    const vardiyalar = g.vardiyalar.map((v) => ({ katman: v.katman, kullanici: v.kullanici, baslangic: v.baslangic, bitis: v.bitis, brans: v.brans?.trim() || null }));
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO nobet_teknik_taraf (donem, vardiyalar, gec, hazirlayan_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [g.donem, JSON.stringify(vardiyalar), gec, o.kullanici])).rows[0];
      const omy = await rolId(c, 'Operasyon Müdür Yardımcısı'); const hedef = (await rolSahipleri(c, omy)).length ? omy : await rolId(c, 'Operasyon Müdürü');
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Nöbet Çizelgesi Teknik Taraf' AND baslik LIKE $1 AND durum = 'Bekliyor'`, [`${g.donem} %`]);
      await kartAc(c, { tur: 'Nöbet Çizelgesi Teknik Taraf', kategori: 'gorev', baslik: `${g.donem} · Nöbet Çizelgesi Teknik Taraf`, ozet: `${vardiyalar.length} vardiya${gec ? ' · süresinden sonra iletildi' : ''}. Nöbet Çizelgesi bölümünde "Teknik Tarafı Ekle" ile çizelgeye alınız.`, sahipRol: hedef, sonZaman: new Date(new Date(`${g.donem}-01T00:00:00+03:00`).getTime() - 10 * 86_400_000), nesneTuru: 'Nöbet Teknik Taraf', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, gec };
    });
  });
  s.get('/nobet/teknik-taraf', oturumlu, async (i, y) => {
    const o = i.oturum!; const donem = String((i.query as { donem?: string }).donem ?? '');
    const izin = (await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2)`, [o.kullanici, ['Operasyon Müdür Yardımcısı', 'Operasyon Müdürü', 'Teknik Müdür Yardımcısı', 'Teknik Müdür']])).rowCount;
    if (!izin || !/^\d{4}-\d{2}$/.test(donem)) return yok(y);
    const r = (await b.db.query(`SELECT t.kimlik, t.vardiyalar, t.gec, t.iletim_zamani, h.ad_soyad hazirlayan FROM nobet_teknik_taraf t JOIN kullanici_hesabi h ON h.kimlik = t.hazirlayan_ref WHERE t.donem = $1 ORDER BY t.iletim_zamani DESC LIMIT 1`, [donem])).rows[0];
    return r ?? null;
  });
  s.post('/nobet/cizelge', { preHandler: izinGerekli(b, 'nobet.hazirla') }, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { donem?: string; vardiyalar?: { katman?: string; kullanici?: string; baslangic?: string; bitis?: string; brans?: string }[]; degisiklik?: boolean };
    if (!/^\d{4}-\d{2}$/.test(g.donem ?? '')) return y.code(400).send({ hata: 'Dönem YYYY-AA biçiminde olmalıdır.' });
    if (!g.vardiyalar?.length) return y.code(400).send({ hata: 'Vardiya giriniz.' });
    const ilkGun = new Date(`${g.donem}-01T00:00:00+03:00`);
    if (!g.degisiklik && ilkGun.getTime() - Date.now() < 10 * 86_400_000) return y.code(409).send({ hata: 'Çizelge dönem başından en az 10 gün önce yayımlanır; değişiklik olarak gönderiniz.' });
    for (const v of g.vardiyalar) {
      if (!['Dosya Sorumlusu', 'Teknik Uzman', 'Yönetici'].includes(v.katman ?? '') || !v.kullanici || !v.baslangic || !v.bitis || new Date(v.bitis) <= new Date(v.baslangic)) return y.code(400).send({ hata: 'Vardiya katman, kişi ve zaman içermelidir.' });
    }
    { const ad = new Map((await katmanAdaylari()).map((x) => [x.kimlik, x.katmanlar])); const u = g.vardiyalar.find((v) => !ad.get(v.kullanici!)?.includes(v.katman!)); if (u) return y.code(400).send({ hata: `${u.katman} katmanına bu katmanın rolünü taşıyan personel yazılır.` }); }
    { const e3 = await (await import('./ik.js')).ek3Engeli(b.db, g.vardiyalar.map((v) => v.kullanici!), Number(g.donem!.slice(0, 4))); if (e3) return y.code(409).send({ hata: e3 }); } // Yönetmelik 4.1
    { const bos = await nobetKapsamaBosluklari(b.db, g.donem!, g.vardiyalar as { katman: string; baslangic: string; bitis: string }[]); if (bos.length) return y.code(409).send({ hata: `Nöbet saatleri kapsanmıyor: ${bos.slice(0, 3).join('; ')}${bos.length > 3 ? ` (+${bos.length - 3})` : ''}.`, bosluklar: bos }); } // YG-240
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
  // YG-244: günlük nöbet takvimi; yürürlükteki çizelgenin vardiyaları İstanbul gününe göre (bir vardiya birden çok güne yayılabilir).
  s.get('/nobet/takvim', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu sayfa LGM personeline açıktır.' });
    const donem = String((i.query as { donem?: string }).donem ?? '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(donem)) return y.code(400).send({ hata: 'Dönem YYYY-AA biçiminde olmalıdır.' });
    return (await b.db.query(`SELECT g::date::text gun, v.katman, v.brans, h.ad_soyad, to_char(v.baslangic AT TIME ZONE 'Europe/Istanbul', 'DD.MM HH24:MI') baslangic, to_char(v.bitis AT TIME ZONE 'Europe/Istanbul', 'DD.MM HH24:MI') bitis
      FROM nobet_cizelgesi c JOIN nobet_vardiyasi v ON v.cizelge_ref = c.kimlik JOIN kullanici_hesabi h ON h.kimlik = v.kullanici_ref
      CROSS JOIN LATERAL generate_series(greatest((v.baslangic AT TIME ZONE 'Europe/Istanbul')::date, ($1 || '-01')::date), least(((v.bitis - interval '1 second') AT TIME ZONE 'Europe/Istanbul')::date, (($1 || '-01')::date + interval '1 month' - interval '1 day')::date), interval '1 day') g
      WHERE c.durum = 'Yürürlükte' AND c.donem = $1 ORDER BY g, CASE v.katman WHEN 'Dosya Sorumlusu' THEN 0 WHEN 'Teknik Uzman' THEN 1 ELSE 2 END, v.baslangic`, [donem])).rows;
  });
  // YG-246, YG-247: dijital devir; kontrol listesi tamamlanmadan olmaz; devralan onaylar.
  s.post('/nobet/devir', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { devralan?: string; liste?: string[]; acikOlaylar?: string };
    // Nöbet yalnız LGM personeli arasında devredilir; yetki içerikten önce denetlenir (erişim taraması bulgusu).
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Nöbet devri LGM personeli arasında yapılır.' });
    if (!g.devralan || g.devralan === o.kullanici) return y.code(400).send({ hata: 'Devralan kişiyi seçiniz.' });
    if (!(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif'`, [g.devralan])).rowCount) return y.code(400).send({ hata: 'Devralan kişi aktif bir LGM personeli olmalıdır.' });
    if (DEVIR_LISTESI.some((m) => !g.liste?.includes(m))) return y.code(400).send({ hata: `Kontrol listesini tamamlayınız: ${DEVIR_LISTESI.filter((m) => !g.liste?.includes(m)).join(', ')}.` });
    const r = (await b.db.query(`INSERT INTO nobet_devri (devreden_ref, devralan_ref, kontrol_listesi, acik_olaylar) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [o.kullanici, g.devralan, JSON.stringify(g.liste), g.acikOlaylar ?? null])).rows[0];
    await bildir(b.db, { olay: `nobet-devir:${r.kimlik}`, kullanicilar: [g.devralan], baslik: 'Nöbet Devri Onayınızı Bekliyor', acil: true, sms: true });
    return { kimlik: r.kimlik };
  });
  // YG-247: devir ekranı için kontrol listesi, devredilebilecek kişiler ve onay bekleyen devirler.
  s.get('/nobet/devir', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Nöbet devri LGM personeli arasında yapılır.' });
    return {
      liste: DEVIR_LISTESI,
      kisiler: (await b.db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif' AND kimlik <> $1 ORDER BY ad_soyad`, [o.kullanici])).rows,
      bekleyen: (await b.db.query(`SELECT n.kimlik, h.ad_soyad AS devreden, n.acik_olaylar, n.kontrol_listesi FROM nobet_devri n JOIN kullanici_hesabi h ON h.kimlik = n.devreden_ref WHERE n.devralan_ref = $1 AND n.devralan_onay_zamani IS NULL ORDER BY n.kimlik`, [o.kullanici])).rows,
    };
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
      const { d, cagri } = await acilDosyaAc(c, r.kimlik, { konum: g.konum!, olay: g.olay!, olayTuru: g.olayTuru!, yatAdi: g.yatAdi!, musteri, sigortaci: g.sigortaci, hatirlatma112: g.hatirlatma112 }, ds, o.kullanici, simdi, { rol: 'Kaptan' });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Acil Çağrı Açıldı', nesneTuru: 'Dosya', nesneKimligi: d.kimlik, yeni: { tur: g.olayTuru }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: d.kimlik, dosyaNo: d.dosya_no, cagri, uyari112: "Acil durumlarda lütfen önce 112'yi arayınız." };
    });
  });

  const firmam = async (k: string) => (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;

  // YG-267: çağrı fiyatsız; konum, yat tipi, olay türü, tehlike ve erişim.
  s.get('/firma-portal/acil-cagrilar', oturumlu, async (i, y) => {
    const f = await firmam(i.oturum!.kullanici);
    if (!f) return y.code(403).send({ hata: 'Bu sayfa Çözüm Ortağı kullanıcılarına açıktır.' });
    return (await b.db.query(`SELECT a.kimlik, a.cagri_no, a.son_zaman, a.durum, d.konum, y.tur AS yat_tipi, m.olay_turu, m.tehlike, d.hizmet_turu, t.yat_mevcut_durumu AS erisim, t.yat_mevcut_konumu AS erisim_konumu /* YG-267 */ FROM acil_gorev_cagrisi a JOIN dosya d ON d.kimlik = a.dosya_ref LEFT JOIN talep t ON t.kimlik = d.talep_ref JOIN yat y ON y.kimlik = d.yat_ref JOIN acil_mudahale m ON m.dosya_ref = d.kimlik WHERE a.kurulus_ref = $1 AND a.durum = 'Gönderildi' ORDER BY a.gonderim`, [f])).rows;
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
      // YG-268: firmanın portaldan verdiği kabulü nöbetçi Dosya Sorumlusu (yoksa dosyanın Dosya Sorumlusu) teyit eder.
      const teyitci = (await nobetci(c, 'Dosya Sorumlusu', simdi)) ?? (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [a.dosya_ref])).rows[0]?.r;
      if (teyitci) await kartAc(c, { tur: 'Acil Kabul Teyidi', kategori: 'islem', baslik: `${a.dosya_no} · Acil Kabul Teyidi`, ozet: `${r.isEmriNo} acil iş emrini firma kabul etti; firmayla teyit ederek kartı kapatınız.`, sahipKullanici: teyitci, nesneTuru: 'Dosya', nesneKimligi: a.dosya_ref });
      return { durum: 'Kabul', ...r };
    });
  });

  async function acKabul(c: PoolClient, a: Record<string, any>, firma: string, kim: string, tahmini: number, simdi: Date) {
    const no = await altNumara(c, a.dosya_no, 'AC');
    const e = (await c.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, firma_yaniti, firma_kabul_eden_ref, firma_kabul_zamani, yayim_zamani, hazirlayan_ref) VALUES ($1,'AC',$2,$3,$4,$5,'Aktif','Kabul',$6,$7,$7,(SELECT talimat_veren_ref FROM acil_mudahale WHERE dosya_ref = $2)) RETURNING kimlik`,
      [no, a.dosya_ref, firma, a.konum, `Acil ilk tedbir: ${a.kisa_teknik_tanim}`, kim, simdi])).rows[0];
    await c.query(`UPDATE is_emri SET acil_beyan_dk = (SELECT acil_yanit_dk FROM kurulus WHERE kimlik = $2) WHERE kimlik = $1`, [e.kimlik, firma]); // YG-802: kabul anındaki beyan
    await acilEkipBildirimi(c, a.dosya_ref, b.webAdresi); // D-046, BLD-54
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
      if (!mesaiIcinde(simdi)) await omAramaGorevi(c, dosya, m.dosya_no, '2.500,00 EUR aşımı'); // YG-1481
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
    // YG-272: elle kabulde de firma sicilde aktif, onaylı Çözüm Ortağı ve Çerçeve Sözleşmesi yürürlükte olmalıdır.
    if (!UUID.test(g.firma) || !(await b.db.query(`SELECT 1 FROM kurulus WHERE kimlik = $1 AND kayit_rolu = 'Çözüm Ortağı' AND ag_statusu = 'Aktif' AND kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı')`, [g.firma])).rowCount) return y.code(409).send({ hata: 'Acil iş yalnız sicilde aktif ve onaylı Çözüm Ortağına verilir.' });
    { const se = await (await import('./alacak.js')).sozlesmeEngeli(b.db, g.firma); if (se) return y.code(409).send({ hata: se }); }
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no, konum, kisa_teknik_tanim FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
      await c.query(`UPDATE acil_gorev_cagrisi SET durum = 'İptal' WHERE dosya_ref = $1 AND durum = 'Gönderildi'`, [dosya]);
      const no = await altNumara(c, d.dosya_no, 'CA');
      const r = await acKabul(c, { ...d, dosya_ref: dosya }, g.firma!, o.kullanici, Number(g.tahmini ?? 0), new Date());
      await c.query(`INSERT INTO acil_gorev_cagrisi (cagri_no, dosya_ref, kurulus_ref, durum, son_zaman, yanit_zamani, is_emri_ref, elle_kayit) VALUES ($1,$2,$3,'Kabul',now(),now(),$4,$5)`, [no, dosya, g.firma, r.isEmri, JSON.stringify({ kanal: g.kanal, kisi: g.kisi, talimat: g.talimat, giren: o.kullanici })]);
      return r;
    });
  });

  // YG-254, YG-274, YG-1595: kapanış sonuç, risk ve devam kararıyla; sigortalıda ilk bilgi tutarsız. BLD-55 tutar içermez.
  s.post('/acil/:dosya/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { dosya } = i.params as { dosya: string }; const g = (i.body ?? {}) as { sonuc?: string; risk?: string; kapsam?: string; gerekce?: string; yetkiliKisi?: string; kaynak?: string; sonradan?: string; devam?: string };
    if (!UUID.test(dosya) || !(await dosyaErisimi(b.db, o.kullanici, dosya))) return yok(y);
    if (!g.sonuc?.trim() || !g.risk?.trim()) return y.code(400).send({ hata: 'Sonuç ve riskin son durumu zorunludur.' });
    if (g.devam && !['Esas Onarıma Devam', 'Dosya Kapatılsın'].includes(g.devam)) return y.code(400).send({ hata: 'Devam kararını seçiniz.' }); // YG-274
    return islem(async (c) => {
      const m = (await c.query(`SELECT m.*, d.dosya_no, d.oncelik, d.statu, d.asama, d.yazisma_dili, y.yat_adi FROM acil_mudahale m JOIN dosya d ON d.kimlik = m.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE m.dosya_ref = $1 FOR UPDATE OF m`, [dosya])).rows[0];
      if (!m) throw Object.assign(new Error('Acil kaydı bulunamadı.'), { statusCode: 404 });
      if (m.durum === 'Kapalı') throw Object.assign(new Error('Acil kaydı kapalıdır.'), { statusCode: 409 });
      await c.query(`UPDATE acil_mudahale SET durum = 'Kapalı', sonuc = $2, risk_durumu = $3, bitis = now() WHERE dosya_ref = $1`, [dosya, g.sonuc!.trim(), g.risk!.trim()]);
      // YG-254, YG-274: kapsam, gerekçe, yetkili kişi, kaynak, sonradan tamamlanacak kayıtlar, devam kararı ve normal akışa dönüş zamanı.
      await c.query(`UPDATE acil_mudahale SET mudahale_kapsami = $2, gerekce = $3, yetkili_kisi = $4, kaynak = $5, sonradan_tamamlanacak = $6, devam_karari = $7, normal_akis_zamani = now() WHERE dosya_ref = $1`, [dosya, g.kapsam?.trim() || null, g.gerekce?.trim() || null, g.yetkiliKisi?.trim() || null, g.kaynak?.trim() || null, g.sonradan?.trim() || null, g.devam ?? null]);
      { const ds = (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]?.r;
        if (ds && g.sonradan?.trim()) await kartAc(c, { tur: 'Acil Kayıt Tamamlama', kategori: 'gorev', baslik: `${m.dosya_no} · Acil Müdahale Kayıtlarını Tamamla`, ozet: g.sonradan.trim(), sahipKullanici: ds, nesneTuru: 'Dosya', nesneKimligi: dosya });
        if (ds && ['Yangın', 'Kirlilik', 'Can Güvenliği'].includes(m.olay_turu)) await kartAc(c, { tur: 'Resmî Tutanak', kategori: 'gorev', baslik: `${m.dosya_no} · Resmî Tutanak / İtfaiye Raporu Yükleyiniz`, ozet: `${m.olay_turu}: resmî tutanak veya itfaiye raporunu dosyaya yükleyiniz.`, sahipKullanici: ds, nesneTuru: 'Dosya', nesneKimligi: dosya }); }
      await c.query(`UPDATE acil_gorev_cagrisi SET durum = 'İptal' WHERE dosya_ref = $1 AND durum = 'Gönderildi'`, [dosya]);
      const t = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu IN ('Yat Sahibi', 'Kaptan') AND aktif ORDER BY taraf_rolu = 'Yat Sahibi' DESC LIMIT 1`, [dosya])).rows[0];
      const saat = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
      const alan = { Yat: m.yat_adi, Yacht: m.yat_adi, saat, time: saat, özet: g.sonuc!.trim(), summary: g.sonuc!.trim() };
      await tedbirSonrasiGorevler(c, dosya, m.dosya_no, (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [dosya])).rows[0].r, ilkIsGunu12(new Date())); // YG-1506
      // YG-445, BLD-74: tedbir kapanınca sigortaya tutarsız ve firma adsız ilk bilgilendirme taslağı; nöbetçi Dosya Sorumlusu teyit edip gönderir.
      const sg = (await c.query(`SELECT s.sigortaci_adi, coalesce(s.onay_yetkilisi_eposta, p.eposta) eposta FROM dosya_sigorta_kaydi s LEFT JOIN dosya_tarafi p ON p.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1 LIMIT 1`, [dosya])).rows[0];
      if (sg) {
        const sgdil = dilKod(m.yazisma_dili); const zmn = new Date(m.baslangic ?? Date.now()).toLocaleString(sgdil === 'en' ? 'en-GB' : 'tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
        const { sigortayaHazirla } = await import('./sigorta_gonderim.js'); const { metinGetir } = await import('./metin.js');
        // YG-556: sigortaca ödenmeyecek acil tedbir kalemi tedbir kapanışından itibaren 5 iş günü içinde bildirilir.
        { const ds = (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]?.r; if (ds) await kartAc(c, { tur: 'Ödenmeyecek Acil Kalem Bildirimi', kategori: 'islem', baslik: `${m.dosya_no} · Sigortaca Ödenmeyecek Acil Tedbir Kalemi`, ozet: 'Sigortaca ödenmeyecek acil tedbir kalemi varsa 5 iş günü içinde yat sahibine bildiriniz (ayrı teklif); yoksa kartı kapatınız.', sahipKullanici: ds, sonZaman: await isGunuSonu(c, new Date(), 5), nesneTuru: 'Dosya', nesneKimligi: dosya }); }
        await sigortayaHazirla(c, { dosya, tur: 'BLD-74', nesne: dosya, alici: sg.eposta ?? null, acil: true, konu: `${m.dosya_no} Acil İlk Tedbir`, metin: await metinGetir(c, 'BLD-74', sgdil, { Kurum: sg.sigortaci_adi ?? '', Institution: sg.sigortaci_adi ?? '', 'Dosya No': m.dosya_no, 'File No': m.dosya_no, 'tarih saat': zmn, 'date time': zmn, 'tedbir özeti': g.sonuc!.trim(), 'summary of measure': g.sonuc!.trim() }) });
      }
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
      // YG-1656: bildirenin türü kullanıcı grubundan; Çözüm Ortağı listede olmadığından Diğer ve açıklama.
      const tr = o.grup.startsWith('Broker') ? 'Sigorta Brokeri / Acentesi' : o.grup.startsWith('Tesis') ? 'Marina / Tesis' : o.grup === 'İş Birliği Firması' ? 'Diğer' : 'Yat Sahibi';
      const r = await ihbarKaydet(c, { kanal: 'Portal', sahibiAdi: h.ad_soyad, sahibiTuru: tr, sahibiTuruAciklama: tr === 'Diğer' ? 'Çözüm Ortağı' : undefined, telefon: h.cep_telefonu ?? undefined, eposta: h.e_posta ?? undefined, konum: g.konum!, yatDurumu: g.tur!, ihtiyac: g.aciklama?.trim() || g.tur!, acil: true, yat: { adi: g.yatAdi, markaDiger: '', modelDiger: '' }, cevaplar: {} }, o.kullanici, { ilkSorumlu: ilk }, simdi);
      if ('hata' in r) throw Object.assign(new Error(r.hata), { statusCode: 400 });
      await bildir(c, { olay: `portal-acil:${r.kimlik}`, kullanicilar: [ilk], baslik: `Acil İhbar: ${r.talepNo}`, ozet: `${g.tur} · ${g.yatAdi} · ${g.konum}`, oncelik: 'Kritik', sms: true, acil: true }, simdi);
      await c.query(`INSERT INTO acil_konum (talep_ref, kullanici_ref) VALUES ($1,$2)`, [r.kimlik, o.kullanici]); // YG-1658
      // YG-259: acil ihbar nöbetçinin açmasını beklemez; Kritik dosya, nöbetçi ekip ve sağlayıcı çağrısı hemen başlar.
      await c.query(`UPDATE talep SET mukerrerlik_sonucu = 'Mükerrer değil' WHERE kimlik = $1`, [r.kimlik]);
      await ihbarAlindiGonder(c, r.kimlik, b.webAdresi);
      await acilDosyaAc(c, r.kimlik, { konum: g.konum!, olay: g.aciklama?.trim() || g.tur!, olayTuru: g.tur!, yatAdi: g.yatAdi!, musteri: o.grup === 'Kurumsal Müşteri' ? 'Kurumsal Müşteri' : 'Bireysel Müşteri' }, ilk, ilk, simdi, [GRUP_YAT, 'Kurumsal Müşteri'].includes(o.grup) ? { rol: 'Yat Sahibi', kullanici: o.kullanici } : { rol: 'Kaptan' });
      return { talep: r.kimlik, talepNo: r.talepNo, uyari112: "Acil durumlarda lütfen önce 112'yi arayınız." };
    });
  });
}
