import { sureKur } from './sure.js';
import { rolId } from './ihbar.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { dilKod, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { coz, totpDogrula } from './kripto.js';
import { altNumara, sayac } from './sure.js';
import { belgeUret } from './belge_uret.js';
import { performansOlayIsle } from './karne.js';
import { isBasiAvansEngeli } from './tedarik.js';
import { kosulEngeli } from './onay_ek.js';
import { gorevlendirmeKontrolu, klasBildirimSonu, ON_KOSULLAR } from './firma_ek.js';
import { ilaveIsYetkiEngeli, yabanciBayrakEngeli } from './teslim_ek.js';
import { isAcmaEngeli as blokeSozlesmeDisi, sozlesmeEngeli } from './alacak.js';
import { baslangicToplantiEngeli, isDurduBildir } from './saha_kayit.js';
import { ekonomikKilitEngeli } from './yat_degeri.js';
import { caymaEngeli, firmaAralikIsaretle, parasalZincir, parametre, sonMakam } from './teklif.js';
import { UUID, vergiNoGecerli } from './yat.js';
import { belgeBagiKaydet } from './belge.js';
import { ilerlemeEngeli, kabulEngeli, planEngeli } from './kalite.js';
import { yatDegeriEngeli } from './yat_degeri.js';
import { izinGerekli } from './yetki.js';
import { rolSahipleri } from './makam.js';
import { tutar } from './metin.js';

type Db = Pool | PoolClient;
const GRUP = 'İş Birliği Firması';
const ARA_ISLEM = ['Operasyon Müdür Yardımcısı', 'Operasyon Müdürü'];
/** YG-1483: firmanın iş emri kabul süresi önceliğin ilk yanıt süresidir (takvim saati). */
const YANIT_SAAT: Record<string, number> = { Kritik: 0.5, Yüksek: 2, Normal: 4, Planlı: 8 };

/** BLD-02 metninde [tarih] iki kez geçer: başlangıç ve planlanan teslim. */
export function bld02Alanlari(yat: string, bas: Date, teslim: Date | string | null, web: string): Record<string, string | string[]> {
  const f = (x: Date | string) => new Date(x).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const tarih = [f(bas), teslim ? f(teslim) : 'belirlendiğinde tarafınıza bildirilecek tarih'];
  return { Yat: yat, Yacht: yat, tarih, date: [f(bas), teslim ? f(teslim) : 'to be notified'], 'bağlantı': web, link: web };
}

export async function firmaUygunlugu(db: Db, firma: string, brans?: string | null): Promise<string | null> {
  const f = (await db.query(`SELECT kayit_asamasi, ag_statusu FROM kurulus WHERE kimlik = $1`, [firma])).rows[0];
  if (!f) return 'Firma bulunamadı.';
  if (!['Onaylı', 'Koşullu Onaylı'].includes(f.kayit_asamasi)) return 'Firmanın kaydı onaylı değildir.';
  if (f.ag_statusu !== 'Aktif' && f.ag_statusu !== 'Kısıtlı') return `Firmanın ağ statüsü uygun değildir: ${f.ag_statusu}.`;
  // YG-342: süresi dolmuş belge görevlendirmeye engeldir; geçmiş işi geçersiz saymaz.
  const b = (await db.query(`SELECT tur FROM sicil_belgesi WHERE kurulus_ref = $1 AND gecerlilik_bitis < current_date ORDER BY tur LIMIT 1`, [firma])).rows[0];
  if (b) return `Firmanın belgesinin süresi dolmuştur: ${b.tur}.`;
  if (brans && !(await db.query(`SELECT 1 FROM brans_yetkinligi WHERE kurulus_ref = $1 AND ana_brans = $2 AND durum = 'Aktif' LIMIT 1`, [firma, brans])).rowCount) return 'Firma bu branşta yetkili değildir.';
  return null;
}

async function yayimla(c: PoolClient, e: { kimlik: string; is_emri_no: string; dosya_ref: string; kurulus_ref: string }, simdi = new Date()) {
  const d = (await c.query(`SELECT oncelik FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0];
  const son = new Date(simdi.getTime() + (YANIT_SAAT[d.oncelik] ?? 24) * 3_600_000);
  await c.query(`UPDATE is_emri SET statu = 'Kabul Bekliyor', yayim_zamani = $2, yanit_son = $3, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, simdi, son]);
  const kisiler = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [e.kurulus_ref])).rows.map((r) => r.kullanici_ref as string);
  await bildir(c, { olay: `is-emri:${e.kimlik}`, kullanicilar: kisiler, baslik: `Yeni İş Emri: ${e.is_emri_no}`, oncelik: d.oncelik, eposta: true, sms: true }, simdi); // YG-328
  // YG-665: iş emri PDF'i firmanın kurumsal adresine ekli gider; fiyat içermez.
  const ep = (await c.query(`SELECT kurumsal_eposta FROM kurulus WHERE kimlik = $1`, [e.kurulus_ref])).rows[0]?.kurumsal_eposta as string | null;
  await belgeUret(c, { tur: 'İş Emri', nesne: e.kimlik, dosya: e.dosya_ref, gonder: ep ? { olay: `is-emri-pdf:${e.kimlik}`, eposta: ep, konu: `Yeni İş Emri: ${e.is_emri_no}`, metin: `Yeni İş Emri: ${e.is_emri_no}`, acil: true } : undefined });
}

kapanisKaydet('Firma Hukuk Görüşü', async (c, k, karar, yapan) => {
  if (karar !== 'Onayla' && karar !== 'Reddet') return;
  await c.query(`UPDATE firma_hukuk_gorusu SET durum = 'Verildi', gorus = $2, veren_ref = $3, gorus_zamani = now() WHERE kimlik = $1 AND durum = 'Bekliyor'`, [k.nesne_kimligi, karar === 'Onayla' ? 'Uygun' : 'Uygun Görülmedi', yapan]);
});

kapanisKaydet('İş Emri', async (c, k, karar) => {
  const e = (await c.query(`SELECT * FROM is_emri WHERE kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!e) return;
  if (karar === 'Onayla') await yayimla(c, e);
  else if (karar === 'Reddet') await c.query(`UPDATE is_emri SET statu = 'İptal', guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik]);
  else if (karar === 'Gerekçeyle İade Et') await c.query(`UPDATE is_emri SET statu = 'Taslak', guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik]);
});

/** YG-071, YG-378: ilerleme doğrulanmış miktar ÷ onaylı miktar; elle girilemez, iyimser yuvarlanmaz (aşağı). */
async function ilerlemeHesapla(c: Db, dosya: string) {
  const r = (await c.query(`SELECT coalesce(sum(k.miktar), 0) m, coalesce(sum(least(k.gerceklesen_miktar, k.miktar)), 0) g FROM is_emri_kalemi k JOIN is_emri e ON e.kimlik = k.is_emri_ref WHERE e.dosya_ref = $1 AND e.statu NOT IN ('İptal', 'Yerine Geçti') AND e.is_emri_turu <> 'KN'`, [dosya])).rows[0];
  const y = Number(r.m) > 0 ? Math.floor((Number(r.g) / Number(r.m)) * 10000) / 100 : 0;
  await c.query(`UPDATE dosya SET ilerleme_yuzdesi = $2 WHERE kimlik = $1`, [dosya, y]);
  return y;
}

// Firma kanıtını kendi iş emrine bağlar; LGM kullanıcısı dosya erişimiyle görür.
belgeBagiKaydet('İş Emri', async (db, k, id) => {
  if (!UUID.test(id)) return 'yok';
  const e = (await db.query(`SELECT kurulus_ref, dosya_ref FROM is_emri WHERE kimlik = $1`, [id])).rows[0];
  if (!e) return 'yok';
  if ((await db.query(`SELECT 1 FROM kurulus_kullanici WHERE kullanici_ref = $1 AND kurulus_ref = $2`, [k, e.kurulus_ref])).rowCount) return 'tamam';
  return (await dosyaErisimi(db, k, e.dosya_ref)) ? 'tamam' : 'yetkisiz';
});

export function firmaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const firmam = async (k: string) => (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;

  // YG-009, YG-345: sicil no LGM-SC-NNNNN; başvuruda verilir, ayrı numara yok. Vergi no mükerrerlik anahtarı.
  s.get('/firma/sicil', { preHandler: izinGerekli(b, 'firma.kayit') }, async (i) => (await b.db.query(`SELECT kimlik, sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu FROM kurulus WHERE $1 OR kayit_asamasi <> 'Aday' ORDER BY ticari_unvan LIMIT 1000`, [(i.query as { aday?: string }).aday === '1'])).rows); // ANV-1: aday havuzu ayrı gösterilir
  s.post('/firma', { preHandler: izinGerekli(b, 'firma.kayit') }, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { unvan?: string; vergiNo?: string; rol?: string; eposta?: string; telefon?: string; il?: string; ilce?: string };
    if (!g.unvan?.trim()) return y.code(400).send({ hata: 'Ticari unvan zorunludur.' });
    if (!['Çözüm Ortağı', 'Tedarikçi', 'Tesis'].includes(g.rol ?? '')) return y.code(400).send({ hata: 'Kayıt rolünü seçiniz.' });
    if (g.vergiNo && !vergiNoGecerli(g.vergiNo)) return y.code(400).send({ hata: 'Vergi numarası geçersiz.' });
    return islem(async (c) => {
      if (g.vergiNo && (await c.query(`SELECT 1 FROM kurulus WHERE vergi_no = $1`, [g.vergiNo])).rowCount) throw Object.assign(new Error('Bu vergi numarasıyla kayıt vardır.'), { statusCode: 409 });
      const no = `LGM-SC-${String(await sayac(c, 'sicil')).padStart(5, '0')}`;
      const r = (await c.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, vergi_no, kayit_rolu, kurumsal_eposta, kurumsal_telefon, il, ilce, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [no, g.unvan!.trim(), g.vergiNo ?? null, g.rol, g.eposta ?? null, g.telefon ?? null, g.il ?? null, g.ilce ?? null, o.kullanici])).rows[0];
      if (g.rol === 'Tesis') await (await import('./firma_tesis.js')).tesisEkle(c, r.kimlik, { ad: g.unvan!, il: g.il ?? null, ilce: g.ilce ?? null }, o.kullanici); // TSK-1: tek yerleşkeli tesis T01
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Kaydı', nesneTuru: 'Kuruluş', nesneKimligi: r.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: r.kimlik, sicilNo: no };
    });
  });

  // YG-360, YG-361, YG-362: statü kararını Sicil Sorumlusu hazırlar, Firma Yönetimi Müdürü verir. Kalıcı askı ve çıkarma Direktörde.
  s.post('/firma/:id/hukuk-gorusu', { preHandler: izinGerekli(b, 'firma.onay') }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { oneri } = (i.body ?? {}) as { oneri?: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    if (oneri !== 'Koşullu Onaylı' && oneri !== 'Reddedildi') return y.code(400).send({ hata: 'Öneriyi seçmenizi rica ederiz.' });
    const u = (await b.db.query(`SELECT ticari_unvan FROM kurulus WHERE kimlik = $1`, [id])).rows[0];
    if (!u) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    if ((await b.db.query(`SELECT 1 FROM firma_hukuk_gorusu WHERE kurulus_ref = $1 AND oneri = $2 AND durum IN ('Bekliyor', 'Verildi')`, [id, oneri])).rowCount) return y.code(409).send({ hata: 'Bu öneri için açık görüş kaydı bulunmaktadır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = (await c.query(`INSERT INTO firma_hukuk_gorusu (kurulus_ref, oneri, isteyen_ref) VALUES ($1,$2,$3) RETURNING kimlik`, [id, oneri, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Firma Hukuk Görüşü', baslik: `${u.ticari_unvan} · Hukuk ve Uyum Görüşü`, ozet: `Öneri: ${oneri}`, hazirlayan: o.kullanici, zincir: [await rolId(c, 'Hukuk ve Uyum Direktörü')], nesneTuru: 'Firma Hukuk Görüşü', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Hukuk Görüşü İstendi', nesneTuru: 'Kuruluş', nesneKimligi: id, yeni: { oneri }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { durum: 'Bekliyor' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.post('/firma/:id/statu', { preHandler: izinGerekli(b, 'firma.onay') }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { asama?: string; ag?: string; risk?: string; gerekce?: string };
    if (!UUID.test(id)) return yok(y);
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Karar gerekçesi zorunludur.' });
    // YG-1659, K-178: Koşullu Onaylı ve Reddedildi önerisinde Hukuk ve Uyum görüşü alınır; bağlayıcı değildir, kademe sayılmaz.
    if ((g.asama === 'Koşullu Onaylı' || g.asama === 'Reddedildi') && !(await b.db.query(`UPDATE firma_hukuk_gorusu SET durum = 'Kullanıldı' WHERE kurulus_ref = $1 AND oneri = $2 AND durum = 'Verildi' RETURNING kimlik`, [id, g.asama])).rowCount) return y.code(409).send({ hata: 'Hukuk ve Uyum görüşü bekleniyor.' });
    if ((g.ag === 'Askıda' || g.ag === 'Çıkarıldı') && !(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND r.rol_adi = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'`, [o.kullanici])).rowCount) return y.code(403).send({ hata: 'Kalıcı askı ve ağdan çıkarma Direktör kararıdır.' });
    if (g.asama === 'Onaylı' || g.asama === 'Koşullu Onaylı') await (await import('./uyum.js')).uyumOlay(b.db, 'firma_kabulu', 'Kuruluş', id); // YG-1546
    const r = await b.db.query(`UPDATE kurulus SET kayit_asamasi = coalesce($2, kayit_asamasi), ag_statusu = coalesce($3, ag_statusu), risk_derecesi = coalesce($4, risk_derecesi), kabul_karar_zamani = CASE WHEN $2::text IS NOT NULL THEN now() ELSE kabul_karar_zamani END, sonraki_gozden_gecirme_tarihi = CASE WHEN $2::text IS NOT NULL OR $4::text IS NOT NULL THEN NULL ELSE sonraki_gozden_gecirme_tarihi END, guncelleme_zamani = now() WHERE kimlik = $1 RETURNING kimlik`, [id, g.asama ?? null, g.ag ?? null, g.risk ?? null]);
    if (!r.rowCount) return yok(y);
    if (g.ag === 'Geçici Askıda') await (await import('./firma_ek.js')).askiIsKararlariAc(b.db, id); // YG-1660: her açık iş için ayrı karar
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Statü Kararı', nesneTuru: 'Kuruluş', nesneKimligi: id, yeni: g, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/firma/:id/kullanici', { preHandler: izinGerekli(b, 'firma.onay') }, async (i, y) => {
    const { id } = i.params as { id: string }; const { kullanici } = (i.body ?? {}) as { kullanici?: string };
    if (!UUID.test(id) || !kullanici) return y.code(400).send({ hata: 'Firma ve kullanıcıyı seçiniz.' });
    const h = (await b.db.query(`SELECT kullanici_grubu FROM kullanici_hesabi WHERE kimlik = $1`, [kullanici])).rows[0];
    if (h?.kullanici_grubu !== GRUP && h?.kullanici_grubu !== 'Tedarikçi' && !h?.kullanici_grubu?.startsWith('Tesis Yetkilisi')) return y.code(400).send({ hata: 'Kullanıcı firma hesabı değildir.' });
    await b.db.query(`INSERT INTO kurulus_kullanici VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, kullanici]);
    return { tamam: true };
  });
  s.post('/firma/:id/brans', { preHandler: izinGerekli(b, 'firma.onay') }, async (i, y) => {
    const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { brans?: string; kapsama?: string; bolge?: string; seviye?: string };
    if (!UUID.test(id) || !g.brans?.trim()) return y.code(400).send({ hata: 'Branş zorunludur.' });
    await b.db.query(`INSERT INTO brans_yetkinligi (kurulus_ref, ana_brans, kapsama, bolge, yetkinlik_seviyesi) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [id, g.brans.trim(), g.kapsama ?? 'Bölge', g.bolge ?? null, g.seviye ?? null]);
    return { tamam: true };
  });
  s.post('/firma/:id/belge', { preHandler: izinGerekli(b, 'firma.kayit') }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; bitis?: string; policeLimit?: number; gozetim?: boolean };
    if (!UUID.test(id) || !g.tur?.trim()) return y.code(400).send({ hata: 'Belge türü zorunludur.' });
    if (g.policeLimit !== undefined && !(Number(g.policeLimit) > 0)) return y.code(400).send({ hata: 'Poliçe limiti geçersizdir.' }); // YG-1471
    await b.db.query(`INSERT INTO sicil_belgesi (kurulus_ref, tur, gecerlilik_bitis, kontrol_eden_ref, police_limit_eur, gozetim_muhafaza) VALUES ($1,$2,$3,$4,$5,$6)`, [id, g.tur.trim(), g.bitis ?? null, o.kullanici, g.policeLimit ?? null, g.gozetim ?? null]);
    return { tamam: true };
  });

  // YG-301, YG-303: Dosya Sorumlusu uygunluk listesinden seçer; uygun olmayan neden yazılı görünür.
  s.get('/firma/uygunluk', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu sayfa LGM personeline açıktır.' });
    const { brans, rol } = i.query as { brans?: string; rol?: string };
    const { rows } = await b.db.query(`SELECT kimlik, sicil_no, ticari_unvan, ag_statusu, risk_derecesi FROM kurulus WHERE kayit_rolu = $1 AND kayit_asamasi NOT IN ('Aday', 'Reddedildi') AND ag_statusu IS DISTINCT FROM 'Çıkarıldı' ORDER BY ticari_unvan`, [rol === 'Tedarikçi' ? rol : 'Çözüm Ortağı']);
    const l = []; for (const f of rows) l.push({ ...f, engel: await firmaUygunlugu(b.db, f.kimlik, brans || null) });
    return l;
  });

  // YG-435: KN, ON, EK Operasyon Yöneticisi; GR Teknik Yönetici çıkarır. YG-322: mali ve kapsam doğrulanmadan yayımlanmaz.
  s.post('/dosya/:id/is-emri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { sapma?: string; tur?: string; firma?: string; yer?: string; kapsam?: string; bedel?: number; baslangic?: string; bitis?: string; teklif?: string; siralar?: number[]; ana?: string; tehlikeliAtik?: boolean; brans?: string; cokBrans?: boolean; anaSistem?: boolean; kritik?: boolean };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT * FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (d.statu !== 'Aktif') return y.code(409).send({ hata: 'İş emri yalnız Aktif dosyada verilir.' });
    if (g.tur === 'EK') { const kilit = await ekonomikKilitEngeli(b.db, id); if (kilit) return y.code(409).send({ hata: kilit }); }
    if (d.calisma_durduruldu) return y.code(409).send({ hata: 'Yat sahibi itirazı nedeniyle çalışmalar durdurulmuştur.' });
    if (!['KN', 'AC', 'ON', 'EK', 'GR', 'PH'].includes(g.tur ?? '')) return y.code(400).send({ hata: 'İş emri türünü seçiniz.' });
    const yde = await yatDegeriEngeli(b.db, id, g.tur); if (yde) return y.code(409).send({ hata: yde });
    const roller = (await b.db.query(`SELECT rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL`, [id, o.kullanici])).rows.map((r) => r.rol as string);
    const yetkili = g.tur === 'GR' ? 'Teknik Yönetici' : 'Operasyon Yöneticisi';
    if (!roller.includes(yetkili)) return y.code(403).send({ hata: `Bu iş emrini ${yetkili} çıkarır.` });
    if (!g.yer?.trim() || !g.kapsam?.trim()) return y.code(400).send({ hata: 'Uygulama yeri ve kapsam zorunludur.' });
    if (!g.firma || !UUID.test(g.firma)) return y.code(400).send({ hata: 'Firmayı seçiniz.' });
    // YG-311: aynı dosyada aynı türdeki işi reddeden firmaya iş, gerekçesi yazılmadan yeniden atanamaz; yeniden atama denetim izine geçer.
    const red = (await b.db.query(`SELECT is_emri_no FROM is_emri WHERE dosya_ref = $1 AND kurulus_ref = $2 AND is_emri_turu = $3 AND firma_yaniti = 'Ret' LIMIT 1`, [id, g.firma, g.tur])).rows[0];
    if (red && !(g as { yenidenAtamaGerekcesi?: string }).yenidenAtamaGerekcesi?.trim()) return y.code(409).send({ hata: `Firma ${red.is_emri_no} iş emrini reddetmiştir; aynı firmaya yeniden atama için gerekçe yazınız.`, yenidenAtama: true });
    if (red) await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Reddeden Firmaya Yeniden Atama', nesneTuru: 'Dosya', nesneKimligi: id, gerekce: (g as { yenidenAtamaGerekcesi?: string }).yenidenAtamaGerekcesi!.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    const engel = await firmaUygunlugu(b.db, g.firma, g.brans ?? null);
    if (engel) return y.code(409).send({ hata: engel });
    // YG-1548: dalış ve sıcak işte kanıt yoksa iş emri açılmaz; acil işler beklemez.
    { const u = await import('./uyum.js'); for (const ol of u.isEmriUyumOlaylari(g.kapsam!)) { const ue = await u.uyumEngeli(b.db, ol, 'Dosya', id, d.oncelik === 'Kritik'); if (ue) return y.code(409).send({ hata: ue }); } }
    // YG-306: görevlendirme kontrolü; Ret engeller, Koşullu Kabul uyarıyla geçer.
    const gk = await gorevlendirmeKontrolu(b.db, { firma: g.firma, dosya: id, brans: g.brans ?? null, tutar: g.bedel ?? null, cokBrans: g.cokBrans, anaSistem: g.anaSistem, kritik: g.kritik });
    await b.db.query(`INSERT INTO gorevlendirme_kontrolu (dosya_ref, kurulus_ref, gorev_sinifi, sonuc, engeller, uyarilar, yapan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, g.firma, gk.sinif, gk.sonuc, gk.engeller, gk.uyarilar, o.kullanici]);
    if (gk.sonuc === 'Ret') return y.code(409).send({ hata: gk.engeller[0] });
    if ((g.tur === 'EK' || g.tur === 'GR') && (!g.ana || !UUID.test(g.ana) || !(await b.db.query(`SELECT 1 FROM is_emri WHERE kimlik = $1 AND dosya_ref = $2`, [g.ana, id])).rowCount)) return y.code(400).send({ hata: 'Ek İş ve Garanti iş emri bir ana iş emrine bağlanır.' }); // YG-316
    const karar = (g.tur === 'ON' || g.tur === 'EK' || g.tur === 'PH');
    let kalemler: { kimlik: string; aciklama: string; miktar: string; birim: string; satir_ref: string | null }[] = [];
    if (karar) {
      if (!g.teklif || !UUID.test(g.teklif)) return y.code(400).send({ hata: 'İş emri onaylı teklife dayanır; teklifi seçiniz.' }); // YG-319
      const t = (await b.db.query(`SELECT statu, karar, gecerlilik_bitis_tarihi FROM fiyat_teklifi WHERE kimlik = $1 AND dosya_ref = $2`, [g.teklif, id])).rows[0];
      if (!t || t.statu !== 'Karar' || !['Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü'].includes(t.karar)) return y.code(409).send({ hata: 'İş emri için Onaylanmış teklif bekleniyor.' });
      const cay = await caymaEngeli(b.db, id);
      if (cay) return y.code(409).send({ hata: cay });
      { const fe = await (await import('./sigorta_fark.js')).odemeFarkiEngeli(b.db, g.teklif!); if (fe) return y.code(409).send({ hata: fe }); } // YG-891
      // YG-324: yalnız onaylanan paketler seçilir.
      kalemler = (await b.db.query(`SELECT kimlik, aciklama, miktar, birim, satir_ref FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND onay_durumu = 'Onaylandı' AND ($2::int[] IS NULL OR sira_no = ANY($2)) ORDER BY sira_no`, [g.teklif, g.siralar ?? null])).rows;
      if (!kalemler.length) return y.code(409).send({ hata: 'Seçilebilecek onaylı kalem yoktur.' });
      if (g.bedel === undefined) return y.code(400).send({ hata: 'Mali limit boş olan iş emri yayımlanmaz.' }); // YG-323
    }
    // YG-211: sigortasız dosyada keşif, Keşif ve Söküm İzni onaylanmadan KN iş emri açılmaz.
    if (g.tur === 'KN' && d.dosya_niteligi !== 'Sigorta bağlantılı' && !(await b.db.query(`SELECT 1 FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod IN ('ONY-01', 'ONY-24') AND durum = 'Onaylandı'`, [id])).rowCount) return y.code(409).send({ hata: 'Keşif iş emri için yat sahibinin keşif izni bekleniyor.' });
    { const e1 = await sozlesmeEngeli(b.db, g.firma!) ?? await blokeSozlesmeDisi(b.db, id, g.tur!) ?? await kosulEngeli(b.db, id, g.tur!) ?? await ilaveIsYetkiEngeli(b.db, id, g.tur!) ?? await yabanciBayrakEngeli(b.db, id, g.bitis); if (e1) return y.code(409).send({ hata: e1 }); } // YG-923, YG-909, YG-1490, YG-157
    // YG-1487: bireyselde Keşif Ücreti keşiften önce ödenir.
    if (g.tur === 'KN' && d.musteri_turu === 'Bireysel Müşteri' && (await b.db.query(`SELECT 1 FROM odeme_talebi WHERE dosya_ref = $1 AND tur = 'Keşif Ücreti' AND durum = 'Gönderildi' LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Keşif iş emri için Keşif Ücreti ödemesi bekleniyor.' });
    // YG-1454, YNT-1: branş ekrandan gelmez; onaylı teklif kalemlerinin kartela branşından türetilir.
    const ym = await import('./yontem_raporu.js'); const bransMetni = ['ON', 'EK'].includes(g.tur!) ? await ym.isEmriBransMetni(b.db, g) : '';
    if (g.tur === 'ON' && ym.yontemGerekli(bransMetni)) { const ye = await ym.yontemEngeli(b.db, id); if (ye) return y.code(409).send({ hata: ye }); }
    return islem(async (c) => {
      if (/(^|[\s,;])(yapı|gövde|makine|yangın)/i.test(bransMetni)) { // YG-334
        const kl = (await c.query(`SELECT y.klas_durumu, y.tabi_kod FROM yat y WHERE y.kimlik = $1`, [d.yat_ref])).rows[0];
        if (kl?.klas_durumu === 'Evet' || kl?.tabi_kod) await kartAc(c, { tur: 'Klas Kuruluşu Bildirimi', kategori: 'islem', baslik: `${d.dosya_no} · Sörveyör Katılımı Gerekir`, ozet: 'Klas kuruluşuna en az 48 saat önce bildirim yapınız.', oncelik: 'Yüksek', sonZaman: klasBildirimSonu(g.baslangic), sahipKullanici: d.dosya_sorumlusu_ref ?? o.kullanici, nesneTuru: 'Dosya', nesneKimligi: id });
      }
      const no = await altNumara(c, d.dosya_no, g.tur!);
      const e = (await c.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, ana_is_emri_ref, dosya_ref, teklif_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, baslangic_tarihi, hedef_bitis_tarihi, tehlikeli_atik, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [no, g.tur, g.ana ?? null, id, g.teklif ?? null, g.firma, g.yer!.trim(), g.kapsam!.trim(), g.bedel ?? null, g.baslangic ?? null, g.bitis ?? null, Boolean(g.tehlikeliAtik), o.kullanici])).rows[0];
      if (g.tur === 'KN') await (await import('./ticari_atama.js')).ticariAtamaAc(c, id); // YG-1600
      if (g.tur === 'ON') await ym.yontemSinirAktar(c, e.kimlik, id); // PRS-1
      if (g.tur === 'EK' && g.sapma && UUID.test(g.sapma)) { const zs = await c.query(`UPDATE sapma_kaydi SET ek_is_emri_ref = $3 WHERE kimlik = $1 AND dosya_ref = $2 AND zarf_genisledi AND ek_is_emri_ref IS NULL RETURNING kimlik`, [g.sapma, id, e.kimlik]); if (zs.rowCount) await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Ek İş İş Emri Gerekli' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [g.sapma]); } // YG-407
      for (const k of kalemler) await c.query(`INSERT INTO is_emri_kalemi (is_emri_ref, teklif_kalem_ref, satir_ref, aciklama, miktar, birim) VALUES ($1,$2,$3,$4,$5,$6)`, [e.kimlik, k.kimlik, k.satir_ref, k.aciklama, k.miktar, k.birim]);
      if (g.bedel !== undefined && g.bedel > 0) {
        // YG-302: son onay limite göre; kümülatif izlenir.
        const kum = Number((await c.query(`SELECT coalesce(sum(firma_bedeli_eur), 0) t FROM is_emri WHERE dosya_ref = $1 AND statu NOT IN ('İptal', 'Yerine Geçti')`, [id])).rows[0].t);
        const zincir = await parasalZincir(c, ARA_ISLEM, await sonMakam(c, kum));
        await c.query(`UPDATE is_emri SET statu = 'İç Onayda' WHERE kimlik = $1`, [e.kimlik]);
        await kartAc(c, { tur: 'İş Emri', baslik: `${no} · İş Emri Onayı`, ozet: `Kümülatif ${kum.toFixed(2)} EUR`, oncelik: d.oncelik === 'Kritik' ? 'Kritik' : 'Normal', hazirlayan: o.kullanici, zincir, nesneTuru: 'İş Emri', nesneKimligi: e.kimlik });
      } else if (g.tur === 'KN') await (await import('./kesif_talebi.js')).gonderimeHazirla(c, { kimlik: e.kimlik, is_emri_no: no, dosya_ref: id }); // YG-1597
      else await yayimla(c, e);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İş Emri Oluşturuldu', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { no, tur: g.tur }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: e.kimlik, isEmriNo: no };
    });
  });

  // YG-291, YG-294, YG-295, YG-436: firma yalnız kendi iş emrini görür; müşteri fiyatı, yat sahibi ve sigorta bilgisi yoktur.
  const firmaIsEmri = async (id: string, k: string) => {
    const f = await firmam(k);
    if (!f || !UUID.test(id)) return undefined;
    return (await b.db.query(`SELECT e.*, (SELECT a.is_emri_no FROM is_emri a WHERE a.kimlik = e.ana_is_emri_ref) AS ana_is_emri_no, d.dosya_no, d.oncelik, y.yat_adi, y.tur AS yat_turu, y.tam_boy_m, y.govde_malzemesi FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE e.kimlik = $1 AND e.kurulus_ref = $2`, [id, f])).rows[0];
  };
  const firmaGorunum = (e: Record<string, any>) => ({ kimlik: e.kimlik, dosya: e.dosya_ref, isEmriNo: e.is_emri_no, tur: e.is_emri_turu, statu: e.statu, anaIsEmri: e.ana_is_emri_ref, anaIsEmriNo: e.ana_is_emri_no ?? null, dosyaNo: e.dosya_no, oncelik: e.oncelik, yat: e.yat_adi, yatTuru: e.yat_turu, boy: e.tam_boy_m, govde: e.govde_malzemesi, yer: e.uygulama_yeri, kapsam: e.kapsam, bedel: e.firma_bedeli_eur, baslangic: e.baslangic_tarihi, bitis: e.hedef_bitis_tarihi, yanitSon: e.yanit_son, yanit: e.firma_yaniti, tehlikeliAtik: e.tehlikeli_atik });

  s.get('/firma-portal/ana', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await firmam(o.kullanici);
    if (!f) return y.code(403).send({ hata: 'Bu sayfa Çözüm Ortağı kullanıcılarına açıktır.' });
    const { rows } = await b.db.query(`SELECT e.*, (SELECT a.is_emri_no FROM is_emri a WHERE a.kimlik = e.ana_is_emri_ref) AS ana_is_emri_no, d.dosya_no, d.oncelik, y.yat_adi, y.tur AS yat_turu, y.tam_boy_m, y.govde_malzemesi FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE e.kurulus_ref = $1 AND e.statu NOT IN ('Taslak', 'İç Onayda', 'İptal', 'Yerine Geçti') ORDER BY e.statu = 'Kabul Bekliyor' DESC, e.yanit_son, e.olusturma_zamani DESC`, [f]);
    return { isEmirleri: rows.map(firmaGorunum) };
  });

  s.get('/firma-portal/is-emri/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await firmaIsEmri((i.params as { id: string }).id, o.kullanici);
    if (!e) return yok(y);
    const kalemler = (await b.db.query(`SELECT aciklama, miktar, birim, gerceklesen_miktar FROM is_emri_kalemi WHERE is_emri_ref = $1 ORDER BY aciklama`, [e.kimlik])).rows;
    return { ...firmaGorunum(e), kalemler };
  });

  // YG-224, YG-325: Kabul / Koşullu Kabul / Çekince / Ret; kabul onay koduyla tek adımda. Sessizlik kabul sayılmaz.
  s.post('/firma-portal/is-emri/:id/yanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await firmaIsEmri((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { yanit?: string; aciklama?: string; kod?: string };
    if (!e) return yok(y);
    if (e.statu !== 'Kabul Bekliyor') return y.code(409).send({ hata: 'Bu iş emri yanıt beklemiyor.' });
    if (!['Kabul', 'Koşullu Kabul', 'Çekince', 'Ret'].includes(g.yanit ?? '')) return y.code(400).send({ hata: 'Yanıtı seçiniz.' });
    if (g.yanit !== 'Kabul' && !g.aciklama?.trim()) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    if (g.yanit === 'Kabul') {
      const h = (await b.db.query(`SELECT totp_gizli_sifreli, totp_son_adim FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
      const adim = h.totp_gizli_sifreli && /^\d{6}$/.test(g.kod ?? '') ? totpDogrula(coz(h.totp_gizli_sifreli, b.anahtar), g.kod!, Number(h.totp_son_adim)) : null;
      if (!adim) return y.code(401).send({ hata: 'Onay kodu hatalıdır.' });
      await b.db.query(`UPDATE kullanici_hesabi SET totp_son_adim = $2 WHERE kimlik = $1`, [o.kullanici, adim]);
    }
    return islem(async (c) => {
      const statu = g.yanit === 'Kabul' ? 'Başlangıç Kontrolünde' : g.yanit === 'Ret' ? 'İptal' : 'Çekinceli';
      await c.query(`UPDATE is_emri SET statu = $2, firma_yaniti = $3, firma_kabul_eden_ref = $4, firma_kabul_zamani = now(), cekince_aciklamasi = $5, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, statu, g.yanit, o.kullanici, g.aciklama?.trim() || null]);
      const ds = (await c.query(`SELECT dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0].dosya_sorumlusu_ref;
      if (g.yanit === 'Kabul') await belgeUret(c, { tur: 'İş Emri', nesne: e.kimlik, dosya: e.dosya_ref }); // YG-224: kabul kaydı PDF'e basılır
      if (g.yanit !== 'Kabul' && ds) await kartAc(c, { tur: g.yanit === 'Ret' ? 'Firma Değiştir' : 'Firma Çekincesi', kategori: 'gorev', baslik: `${e.is_emri_no} · Firma ${g.yanit}`, ozet: g.aciklama!.trim().slice(0, 200), oncelik: e.oncelik === 'Kritik' ? 'Kritik' : 'Normal', sahipKullanici: ds, nesneTuru: 'İş Emri', nesneKimligi: e.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: `İş Emri Yanıtı: ${g.yanit}`, nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Firma Portalı' });
      return { statu };
    });
  });

  // YG-426, YG-1540: firma fiyatı yalnız firma ekranından girilir; geçerlilik 30 gün, kısaltılamaz.
  s.post('/firma-portal/dosya/:id/fiyat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kalemler?: { satir?: string; fiyat?: number }[] };
    const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM is_emri WHERE dosya_ref = $1 AND kurulus_ref = $2 AND is_emri_turu = 'KN' AND statu NOT IN ('Taslak', 'İç Onayda', 'İptal') LIMIT 1`, [id, f])).rowCount) return yok(y);
    const cetvel = (await b.db.query(`SELECT kimlik FROM kapsam_cetveli WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY surum DESC LIMIT 1`, [id])).rows[0];
    if (!cetvel) return y.code(409).send({ hata: 'Onaylı kapsam henüz hazır değildir.' });
    if (!g.kalemler?.length || g.kalemler.some((k) => !k.satir || !(Number(k.fiyat) >= 0))) return y.code(400).send({ hata: 'Her kalem için birim fiyat giriniz.' });
    const satirlar = new Set((await b.db.query(`SELECT kimlik FROM kapsam_satiri WHERE cetvel_ref = $1`, [cetvel.kimlik])).rows.map((r) => r.kimlik as string));
    if (g.kalemler.some((k) => !satirlar.has(k.satir!))) return y.code(400).send({ hata: 'Kalem kapsamda değildir.' });
    const dosyaNo = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0].dosya_no;
    const gun = await parametre(b.db, 'firma_teklif_gecerlilik_gun');
    return islem(async (c) => {
      const no = await altNumara(c, dosyaNo, 'FFT');
      const t = (await c.query(`INSERT INTO firma_fiyat_teklifi (teklif_no, dosya_ref, kurulus_ref, cetvel_ref, durum, gecerlilik, giren_ref) VALUES ($1,$2,$3,$4,'Gönderildi',(now() AT TIME ZONE 'Europe/Istanbul')::date + $5::int,$6) RETURNING kimlik`, [no, id, f, cetvel.kimlik, gun, o.kullanici])).rows[0];
      for (const k of g.kalemler!) await c.query(`INSERT INTO firma_fiyat_kalemi (teklif_ref, satir_ref, birim_fiyat_eur) VALUES ($1,$2,$3)`, [t.kimlik, k.satir, k.fiyat]);
      await c.query(`UPDATE firma_fiyat_teklifi SET toplam_eur = (SELECT sum(k.birim_fiyat_eur * s.miktar) FROM firma_fiyat_kalemi k JOIN kapsam_satiri s ON s.kimlik = k.satir_ref WHERE k.teklif_ref = $1) WHERE kimlik = $1`, [t.kimlik]);
      await firmaAralikIsaretle(c, t.kimlik); // YG-234: aralık işareti yalnız LGM ekranında görünür.
      return { kimlik: t.kimlik, teklifNo: no };
    });
  });
  // Firma kapsamı fiyatsız görür (YG-293).
  s.get('/firma-portal/dosya/:id/kapsam', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id) || !(await b.db.query(`SELECT 1 FROM is_emri WHERE dosya_ref = $1 AND kurulus_ref = $2 AND statu NOT IN ('Taslak', 'İç Onayda', 'İptal') LIMIT 1`, [id, f])).rowCount) return yok(y);
    return (await b.db.query(`SELECT s.kimlik, s.satir_kodu, s.bolge_kodu, s.kartela_kodu, s.aciklama, s.miktar, s.birim FROM kapsam_satiri s JOIN kapsam_cetveli c ON c.kimlik = s.cetvel_ref WHERE c.dosya_ref = $1 AND c.durum = 'Onaylı' AND NOT EXISTS (SELECT 1 FROM tedarikci_teklif_kalemi x JOIN tedarikci_teklif_talebi t ON t.kimlik = x.talep_ref WHERE x.satir_ref = s.kimlik AND t.durum <> 'Süresi Doldu') ORDER BY s.satir_kodu`, [id])).rows; // YG-1427: tedarikçiye bağlı satırı firma fiyatlamaz
  });

  // YG-377: ilerleme miktar ve kanıtla; yalnız yüzde resmî ilerleme sayılmaz. YG-318: kapsam dışında iş durdurulur.
  s.post('/firma-portal/is-emri/:id/ilerleme', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await firmaIsEmri((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { kalem?: string; miktar?: number; belge?: string };
    if (!e) return yok(y);
    if (e.statu !== 'Aktif') return y.code(409).send({ hata: 'İlerleme yalnız aktif iş emrinde girilir.' });
    if (!g.kalem || !(Number(g.miktar) > 0)) return y.code(400).send({ hata: 'Kalem ve miktar zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM is_emri_kalemi WHERE is_emri_ref = $1 AND aciklama = $2`, [e.kimlik, g.kalem])).rowCount) return y.code(400).send({ hata: 'Kalem bu iş emrinde değildir.' });
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'İlerleme için önce kanıt yüklemenizi rica ederiz.' });
    const ie = await ilerlemeEngeli(b.db, e, g.kalem); if (ie) return y.code(409).send({ hata: ie });
    const r = await b.db.query(`INSERT INTO is_emri_ilerleme (is_emri_ref, aciklama, miktar, belge_ref, giren_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [e.kimlik, g.kalem, g.miktar, g.belge, o.kullanici]);
    return { kimlik: r.rows[0].kimlik };
  });
  s.post('/firma-portal/is-emri/:id/durdur', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await firmaIsEmri((i.params as { id: string }).id, o.kullanici); const { neden } = (i.body ?? {}) as { neden?: string };
    if (!e) return yok(y);
    if (!neden?.trim()) return y.code(400).send({ hata: 'Neden zorunludur.' });
    if (e.statu !== 'Aktif') return y.code(409).send({ hata: 'İş emri aktif değildir.' });
    return islem(async (c) => {
      await c.query(`UPDATE is_emri SET statu = 'Durduruldu', durdurma_nedeni = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, neden!.trim()]);
      const ds = (await c.query(`SELECT dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0].dosya_sorumlusu_ref;
      await isDurduBildir(c, e, neden!.trim(), false); // YG-1437
      if (ds) await kartAc(c, { tur: 'İş Durduruldu', kategori: 'gorev', baslik: `${e.is_emri_no} · Firma İşi Durdurdu`, ozet: neden!.trim().slice(0, 200), oncelik: 'Yüksek', sahipKullanici: ds, nesneTuru: 'İş Emri', nesneKimligi: e.kimlik });
      return { tamam: true };
    });
  });
  s.post('/firma-portal/is-emri/:id/tamamlandi', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await firmaIsEmri((i.params as { id: string }).id, o.kullanici);
    if (!e) return yok(y);
    if (e.statu !== 'Aktif') return y.code(409).send({ hata: 'İş emri aktif değildir.' });
    const te = await ilerlemeEngeli(b.db, { ...e, calisma_izni_gerekli: false }, null); if (te) return y.code(409).send({ hata: te });
    await b.db.query(`UPDATE is_emri SET statu = 'Tamamlandı', firma_tamamlama_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik]); // YG-386: firma bildirimi teknik kabul değildir.
    return { statu: 'Tamamlandı' };
  });

  const lgmIsEmri = async (id: string, k: string) => {
    if (!UUID.test(id)) return undefined;
    const e = (await b.db.query(`SELECT e.*, d.dosya_no, d.oncelik, d.yazisma_dili FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kimlik = $1`, [id])).rows[0];
    return e && await dosyaErisimi(b.db, k, e.dosya_ref) ? e : undefined;
  };
  const ekipteMi = async (dosya: string, k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = ANY($3) AND bitis_zamani IS NULL`, [dosya, k, r])).rowCount);
  const TEKNIK = ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Saha Sorumlusu'];

  // YG-1660: firma işi bırakırsa iş emri kapanır, Dosya Sorumlusuna firma değiştirme görevi açılır; rücu ve mahsup için hakediş, kesinti ve ödeme bilgisi Muhasebe ve Finans Müdürüne gider.
  s.post('/is-emri/:id/firma-birakti', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsEmri((i.params as { id: string }).id, o.kullanici); const gerekce = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!e) return yok(y);
    const ds = (await b.db.query(`SELECT dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0].dosya_sorumlusu_ref;
    if (ds !== o.kullanici) return y.code(403).send({ hata: 'Firmanın işi bıraktığını Dosya Sorumlusu kaydeder.' });
    if (!['Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif', 'Çekinceli', 'Durduruldu'].includes(e.statu)) return y.code(409).send({ hata: 'İş emri bu durumda kapatılamaz.' });
    if (!gerekce) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    return islem(async (c) => {
      await c.query(`UPDATE is_emri SET statu = 'İptal', durdurma_nedeni = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, `Firma işi bıraktı: ${gerekce}`]);
      const h = (await c.query(`SELECT coalesce(sum(h.bu_donem_brut), 0) AS brut, coalesce(sum(h.kesinti), 0) AS kesinti, coalesce((SELECT sum(x.tutar_eur) FROM odeme_talimati x JOIN hakedis z ON z.kimlik = x.hakedis_ref WHERE z.is_emri_ref = $1 AND x.durum = 'Ödendi'), 0) AS odenen FROM hakedis h WHERE h.is_emri_ref = $1 AND h.statu <> 'Reddedildi'`, [e.kimlik])).rows[0];
      await kartAc(c, { tur: 'Firma Değiştir', kategori: 'gorev', baslik: `${e.is_emri_no} · Firma İşi Bıraktı`, ozet: gerekce.slice(0, 200), oncelik: e.oncelik === 'Kritik' ? 'Kritik' : 'Yüksek', sahipKullanici: o.kullanici, nesneTuru: 'İş Emri', nesneKimligi: e.kimlik });
      const mfm = await rolSahipleri(c, await rolId(c, 'Muhasebe ve Finans Müdürü'));
      await bildir(c, { olay: `firma-birakti:${e.kimlik}`, kullanicilar: mfm, baslik: `${e.is_emri_no} · Firma İşi Bıraktı · Rücu ve Mahsup`, ozet: `Hakediş brüt ${tutar(Number(h.brut))} EUR, kesinti ${tutar(Number(h.kesinti))} EUR, ödenen ${tutar(Number(h.odenen))} EUR. Rücu ve mahsup değerlendirmesi rica olunur.`, oncelik: 'Yüksek' });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma İşi Bıraktı', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, yeni: { gerekce }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { statu: 'İptal' };
    });
  });

  // YG-1597, YG-042, KSF-1: keşif iş emrini Dosya Sorumlusu firmaya gönderir; keşif süresi gönderimle başlar.
  s.post('/is-emri/:id/firmaya-gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsEmri((i.params as { id: string }).id, o.kullanici);
    if (!e) return yok(y);
    if (!(await ekipteMi(e.dosya_ref, o.kullanici, ['Dosya Sorumlusu', 'Yedek Sorumlu']))) return y.code(403).send({ hata: 'Keşif iş emrini Dosya Sorumlusu firmaya gönderir.' });
    if (e.is_emri_turu !== 'KN' || e.statu !== 'Taslak') return y.code(409).send({ hata: 'Yalnız gönderilmemiş keşif iş emri firmaya gönderilir.' });
    const engel = await firmaUygunlugu(b.db, e.kurulus_ref, null); if (engel) return y.code(409).send({ hata: engel });
    return islem(async (c) => {
      const onceki = (await c.query(`SELECT 1 FROM is_emri WHERE dosya_ref = $1 AND is_emri_turu = 'KN' AND kimlik <> $2 AND yayim_zamani IS NOT NULL LIMIT 1`, [e.dosya_ref, e.kimlik])).rowCount;
      const simdi = new Date(); await yayimla(c, e, simdi);
      if (!onceki) { const d = (await c.query(`SELECT oncelik, (SELECT km FROM kesif k WHERE k.dosya_ref = x.kimlik ORDER BY k.planlanan_baslangic DESC LIMIT 1) km FROM dosya x WHERE x.kimlik = $1`, [e.dosya_ref])).rows[0]; await sureKur(c, { tur: 'Keşif', oncelik: d.oncelik, baslangic: simdi, dosya: e.dosya_ref, km: d.km === null ? null : Number(d.km) }); }
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Firmaya Gönder' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [e.kimlik]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Keşif İş Emri Firmaya Gönderildi', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { statu: 'Kabul Bekliyor' };
    });
  });

  // YG-369: başlangıç kontrolü firma kabulünden sonra; Başlanabilir / Koşullu Başlanabilir / Bekletilir. BLD-02 yat sahibine.
  s.post('/is-emri/:id/baslangic', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsEmri((i.params as { id: string }).id, o.kullanici); const { sonuc, onKosul, gerekce, altYuklenici } = (i.body ?? {}) as { sonuc?: string; onKosul?: string[]; gerekce?: string; altYuklenici?: string };
    if (!e) return yok(y);
    if (!(await ekipteMi(e.dosya_ref, o.kullanici, TEKNIK))) return y.code(403).send({ hata: 'Başlangıç kontrolünü Saha Sorumlusu veya Teknik Uzman yapar.' });
    if (e.statu !== 'Başlangıç Kontrolünde') return y.code(409).send({ hata: 'İş emri başlangıç kontrolünde değildir.' });
    if (!['Başlanabilir', 'Koşullu Başlanabilir', 'Bekletilir'].includes(sonuc ?? '')) return y.code(400).send({ hata: 'Sonucu seçiniz.' });
    // YG-368: eksik ön koşulla başlama ancak Koşullu ve gerekçeyle; Başlanabilir yalnız tamamı işaretliyse.
    // YG-370: absorban ve bariyer onarım işlerinde aranır; keşifte aranmaz.
    const eksikOn = ON_KOSULLAR.filter((x) => !(e.is_emri_turu === 'KN' && x === 'Absorban ve Bariyer Mevcut') && !(onKosul ?? []).includes(x));
    if (sonuc === 'Başlanabilir' && eksikOn.length) return y.code(409).send({ hata: `Başlama ön koşulu eksiktir: ${eksikOn.join(', ')}. Sapma gerekçesiyle Koşullu Başlanabilir seçmenizi rica ederiz.`, eksikler: eksikOn });
    if (sonuc === 'Koşullu Başlanabilir' && eksikOn.length && !gerekce?.trim()) return y.code(400).send({ hata: 'Eksik ön koşul için sapma gerekçesini yazmanızı rica ederiz.' });
    if (sonuc !== 'Bekletilir' && altYuklenici?.trim()) { const { altYukleniciEngeli } = await import('./kalan.js'); const ae = await altYukleniciEngeli(b.db, e.kimlik, altYuklenici.split(',')); if (ae) return y.code(409).send({ hata: ae }); } // YG-411
    if (sonuc !== 'Bekletilir') { const pe = await planEngeli(b.db, e.dosya_ref, e.is_emri_turu) ?? await baslangicToplantiEngeli(b.db, e.kimlik, e.is_emri_turu) ?? (e.is_emri_turu === 'ON' ? await isBasiAvansEngeli(b.db, e.dosya_ref) : null); if (pe) return y.code(409).send({ hata: pe }); }
    return islem(async (c) => {
      await c.query(`UPDATE is_emri SET baslangic_sonucu = $2, statu = CASE WHEN $2 = 'Bekletilir' THEN statu ELSE 'Aktif' END, eksik_on_kosullar = $3, on_kosul_gerekcesi = $4, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, sonuc, eksikOn, gerekce?.trim() || null]);
      if (sonuc !== 'Bekletilir' && e.is_emri_turu !== 'KN') {
        const teslimT = await (await import('./teslim_sure.js')).teslimTarihiKur(c, e); // SRE-1
        const t = (await c.query(`SELECT t.telefon, t.eposta, y.yat_adi FROM dosya_tarafi t JOIN dosya d ON d.kimlik = t.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE t.dosya_ref = $1 AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif AND NOT d.vefat_isareti LIMIT 1`, [e.dosya_ref])).rows[0];
        if (t) await yatTarafinaYaz(c, { olay: `bld02:${e.kimlik}`, kod: 'BLD-02', dil: dilKod(e.yazisma_dili), konu: `${e.dosya_no} İşe Başlandı`, telefon: t.telefon, eposta: t.eposta, alanlar: bld02Alanlari(t.yat_adi, new Date(), teslimT ?? e.hedef_bitis_tarihi, b.webAdresi) }); // K-197: yat sahibine tamponlu tarih
        if (teslimT) await (await import('./teslim_sure.js')).sigortayaTarihBildir(c, e.dosya_ref, teslimT, new Date(), b.webAdresi, o.kullanici); // SRE-2
      }
      return { statu: sonuc === 'Bekletilir' ? 'Başlangıç Kontrolünde' : 'Aktif' };
    });
  });

  // YG-378: LGM doğrular; doğrulanan miktar ilerlemeye girer. YG-386: uygulayıcı kendi işini kabul edemez (ayrı hesap ve portal).
  s.get('/is-emri/:id/ilerlemeler', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsEmri((i.params as { id: string }).id, o.kullanici);
    if (!e) return yok(y);
    return (await b.db.query(`SELECT kimlik, aciklama, miktar, dogrulandi FROM is_emri_ilerleme WHERE is_emri_ref = $1 ORDER BY zaman`, [e.kimlik])).rows;
  });
  s.post('/is-emri/:id/ilerleme/:no/dogrula', oturumlu, async (i, y) => {
    const o = i.oturum!; const p = i.params as { id: string; no: string }; const e = await lgmIsEmri(p.id, o.kullanici);
    if (!e) return yok(y);
    if (!(await ekipteMi(e.dosya_ref, o.kullanici, TEKNIK))) return y.code(403).send({ hata: 'İlerlemeyi teknik ekip doğrular.' });
    return islem(async (c) => {
      const r = (await c.query(`UPDATE is_emri_ilerleme SET dogrulandi = true, dogrulayan_ref = $3 WHERE kimlik = $1 AND is_emri_ref = $2 AND NOT dogrulandi RETURNING aciklama, miktar`, [p.no, e.kimlik, o.kullanici])).rows[0];
      if (!r) throw Object.assign(new Error('Kayıt bulunamadı.'), { statusCode: 404 });
      await c.query(`UPDATE is_emri_kalemi SET gerceklesen_miktar = gerceklesen_miktar + $3 WHERE is_emri_ref = $1 AND aciklama = $2`, [e.kimlik, r.aciklama, r.miktar]);
      return { ilerleme: await ilerlemeHesapla(c, e.dosya_ref) };
    });
  });

  // YG-387: firma işinin teknik kabulü (kısmi kabul dahil) LGM yetkilisince; YG-413: kanıt eksikse kapanmaz; YG-330: tehlikeli atık belgesi.
  s.post('/is-emri/:id/teknik-kabul', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsEmri((i.params as { id: string }).id, o.kullanici); const { sonuc, gerekce } = (i.body ?? {}) as { sonuc?: string; gerekce?: string };
    if (!e) return yok(y);
    if (!(await ekipteMi(e.dosya_ref, o.kullanici, ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)']))) return y.code(403).send({ hata: 'Teknik kabulü Teknik Uzman verir.' });
    // YG-649: Paket Kabulü iş devam ederken teslim edilen paketi kabul eder; Bekletmede gerekçeyle sonucu erteler.
    if (!['Kabul', 'Koşullu Kabul', 'Paket Kabulü', 'Ret', 'Bekletmede'].includes(sonuc ?? '')) return y.code(400).send({ hata: 'Sonucu seçiniz: Kabul, Koşullu Kabul, Paket Kabulü, Ret, Bekletmede.' });
    if (sonuc === 'Paket Kabulü' || sonuc === 'Bekletmede') {
      if (!gerekce?.trim()) return y.code(400).send({ hata: sonuc === 'Paket Kabulü' ? 'Kabul edilen paketi yazınız.' : 'Bekletme gerekçesini yazınız.' });
      if (!['Aktif', 'Tamamlandı'].includes(e.statu)) return y.code(409).send({ hata: 'İş emri aktif veya tamamlanmış olmalıdır.' });
      await b.db.query(`UPDATE is_emri SET teknik_kabul_sonucu = $2, teknik_kabul_eden_ref = $3, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, sonuc, o.kullanici]);
      await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Teknik Kabul: ${sonuc}`, nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, gerekce: gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      // YG-399: kabul tamamlanamadıysa dosya Bekletmede işaretiyle izlenir (sayaç durmaz; 7 gün hedef).
      if (sonuc === 'Bekletmede' && !(await b.db.query(`SELECT 1 FROM beklemede_isareti WHERE dosya_ref = $1 AND kayit_referansi = $2 AND kaldirilma_zamani IS NULL`, [e.dosya_ref, e.kimlik])).rowCount)
        await b.db.query(`INSERT INTO beklemede_isareti (dosya_ref, kayit_turu, kayit_referansi, neden, sorumlu_ref, hedef_tarih, durum_mesaji, sayac_durur, olusturan_ref) VALUES ($1,'İş Emri',$2,'Kabul Bekletmede',$3,(now() AT TIME ZONE 'Europe/Istanbul')::date + 7,$4,false,$3)`, [e.dosya_ref, e.kimlik, o.kullanici, gerekce.trim().slice(0, 200)]);
      return { tamam: true };
    }
    if (e.statu !== 'Tamamlandı') return y.code(409).send({ hata: 'Firma işi tamamlandı bildirmemiştir.' });
    await b.db.query(`UPDATE beklemede_isareti SET kaldirilma_zamani = now() WHERE kayit_referansi = $1 AND neden = 'Kabul Bekletmede' AND kaldirilma_zamani IS NULL`, [e.kimlik]); // YG-399
    { const ga = await (await import('./yetki_ek.js')).teknikKabulAyrimi(b.db, e, o.kullanici); if (ga) return y.code(403).send({ hata: ga }); } // YG-1036, YG-1037
    const ke = await kabulEngeli(b.db, e, sonuc!); if (ke) return y.code(409).send({ hata: ke });
    if (sonuc === 'Koşullu Kabul') return y.code(400).send({ hata: 'Koşullu kabul açık iş listesiyle ayrı kaydedilir.' });
    const sonuclanmamis = (await b.db.query(`SELECT count(*)::int n FROM is_emri_ilerleme WHERE is_emri_ref = $1 AND NOT dogrulandi`, [e.kimlik])).rows[0].n;
    if (sonuc === 'Kabul' && sonuclanmamis) return y.code(409).send({ hata: 'Kabul için Doğrulanmamış ilerlemenin doğrulanması bekleniyor.' });
    await b.db.query(`UPDATE is_emri SET teknik_kabul_sonucu = $2, teknik_kabul_eden_ref = $3, statu = CASE WHEN $2 = 'Ret' THEN 'Aktif' ELSE statu END, teknik_ret_sayisi = teknik_ret_sayisi + CASE WHEN $2 = 'Ret' THEN 1 ELSE 0 END, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, sonuc, o.kullanici]);
    return { tamam: true };
  });
  s.post('/is-emri/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsEmri((i.params as { id: string }).id, o.kullanici); const { atikBelgesi } = (i.body ?? {}) as { atikBelgesi?: string };
    if (!e) return yok(y);
    if (!(await ekipteMi(e.dosya_ref, o.kullanici, ['Dosya Sorumlusu']))) return y.code(403).send({ hata: 'İş emrini Dosya Sorumlusu kapatır.' });
    if (!['Kabul', 'Koşullu Kabul'].includes(e.teknik_kabul_sonucu ?? '')) return y.code(409).send({ hata: 'İş emrini kapatmak için Teknik kabul bekleniyor.' });
    if (e.tehlikeli_atik && !atikBelgesi && !e.atik_teslim_belgesi_ref) return y.code(409).send({ hata: 'Kapanış için Tehlikeli atık teslim belgesi bekleniyor.' });
    await b.db.query(`UPDATE is_emri SET statu = 'Kapalı', kapanis_zamani = now(), atik_teslim_belgesi_ref = coalesce($2, atik_teslim_belgesi_ref), guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, atikBelgesi ?? null]);
    await performansOlayIsle(b.db, e.kimlik); // YG-350: karne her iş emri kapanışında güncellenir
    return { statu: 'Kapalı' };
  });

}
