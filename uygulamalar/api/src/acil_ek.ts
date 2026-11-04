import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { coz, totpDogrula } from './kripto.js';
import { rolSahipleri } from './makam.js';
import { metinGetir, gunAy } from './metin.js';
import { onaySonucKaydet, onayTalebiAc } from './onay.js';
import { sigortayaHazirla } from './sigorta_gonderim.js';
import { parametre } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const OPM = 'Operasyon Müdürü'; const GMY = 'Genel Müdür Yardımcısı'; const TOD = 'Teknik ve Operasyon Direktörü';
const LGM = 'LGM İç Rolü';
const NOBET_ZINCIR: Record<string, string[]> = { Operasyon: ['Dosya Sorumlusu', 'Operasyon Yöneticisi', 'Operasyon Müdür Yardımcısı', OPM], Teknik: ['Teknik Uzman', 'Teknik Yönetici', 'Teknik Müdür Yardımcısı', 'Teknik Müdür'] };
/** YG-261, Cilt II §7.9 olay komutası tablosu. */
const KOMUTA: Record<string, { ilk: string | null; yonetici: string[]; bilgi: string[] }> = {
  'Saha veya Deniz Acili': { ilk: 'Dosya Sorumlusu', yonetici: [OPM], bilgi: ['Teknik Müdür', TOD, GMY, 'CEO'] },
  'İş Kazası': { ilk: 'Saha Sorumlusu', yonetici: ['İSG Sorumlusu', OPM], bilgi: ['Risk ve Kalite Direktörü', GMY] },
  'BT Kesintisi veya Veri İhlali': { ilk: 'Bilgi İşlem Destek Sorumlusu', yonetici: ['Bilgi İşlem Müdürü', 'Hukuk ve Uyum Direktörü'], bilgi: [GMY, 'CEO'] },
  'Kurumsal Kriz': { ilk: null, yonetici: [GMY], bilgi: ['CEO'] },
};
const TEMAS = ['112 Arandı', 'Marina Teması', 'Operasyon Müdürü Arandı', 'Refakatli Giriş', 'Sahil Güvenlik', 'Liman Başkanlığı', 'İl Çevre Müdürlüğü'];
const DALIS = ['Dalgıçlık', 'Birden Fazla'];
const rolVarsa = async (db: Db, ad: string) => (await db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0]?.kimlik as string | undefined;
const sahipleri = async (db: Db, ad: string) => { const r = await rolVarsa(db, ad); return r ? rolSahipleri(db, r) : []; };

/** Onaylı metinlerdeki 7/24 Destek Hattı şirket bilgisidir; tanımlı değilse metin eksik gönderilmez. */
export const destekHatti = async (db: Db) => (await db.query(`SELECT deger FROM sirket_bilgisi WHERE anahtar = 'destek_hatti'`)).rows[0]?.deger as string | undefined;

/** D-046, YG-258: BLD-54; hat tanımlı değilse Dosya Sorumlusuna görev düşer. */
export async function acilEkipBildirimi(c: Db, dosya: string, webAdresi: string) {
  const d = (await c.query(`SELECT d.dosya_no, d.yazisma_dili, d.vefat_isareti, d.dosya_sorumlusu_ref, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (!d || d.vefat_isareti) return;
  const t = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu IN ('Yat Sahibi', 'Kaptan') AND aktif ORDER BY taraf_rolu = 'Yat Sahibi' DESC LIMIT 1`, [dosya])).rows[0];
  const hat = await destekHatti(c);
  if (t && hat) await yatTarafinaYaz(c, { olay: `bld54:${dosya}`, kod: 'BLD-54', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Acil Müdahale`, telefon: t.telefon, eposta: t.eposta, acil: true, alanlar: { Yat: d.yat_adi, Yacht: d.yat_adi, telefon: hat, phone: hat, 'Dosya No': d.dosya_no, 'File No': d.dosya_no } });
  if (d.dosya_sorumlusu_ref) await kartAc(c, { tur: 'Acil Gelişme Bildirimi', kategori: 'islem', baslik: `${d.dosya_no} · Gelişmeleri Bildirme`, ozet: hat ? 'Gelişmeleri yat sahibine bildirmenizi, tedbir bitince kaydı kapatmanızı rica ederiz.' : '7/24 Destek Hattı tanımlı olmadığından ilk mesaj gönderilemedi; yat sahibini aramanızı rica ederiz.', oncelik: 'Kritik', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: dosya });
}

/** YG-1481, D-027: mesai dışında can riski, tutar aşımı veya sağlayıcı yokluğunda Operasyon Müdürü hemen aranır. */
export async function omAramaGorevi(c: Db, dosya: string, dosyaNo: string, neden: string) {
  if (!(await birKez(c, 'om_arama', `${dosya}:${neden}`))) return;
  const y = (await sahipleri(c, 'Yönetici'))[0];
  await kartAc(c, { tur: 'Operasyon Müdürü Araması', kategori: 'islem', baslik: `${dosyaNo} · Operasyon Müdürünü Hemen Arayınız`, ozet: neden, oncelik: 'Kritik', sahipRol: await rolId(c, OPM), ...(y ? {} : {}), nesneTuru: 'Dosya', nesneKimligi: dosya });
}

/** YG-1506: tedbir kapanınca doğan görevler. */
export async function tedbirSonrasiGorevler(c: Db, dosya: string, dosyaNo: string, ds: string | null, son12: Date) {
  if (ds) await kartAc(c, { tur: 'Tedbir Sonrası Arama', kategori: 'islem', baslik: `${dosyaNo} · Yat Sahibi Araması`, ozet: 'İlk iş günü 12:00’ye kadar', sonZaman: son12, sahipKullanici: ds, nesneTuru: 'Dosya', nesneKimligi: dosya });
  await kartAc(c, { tur: 'Acil Tedbir Fiyat Teklifi', kategori: 'islem', baslik: `${dosyaNo} · Acil Tedbir Fiyat Teklifi`, ozet: 'Gerçekleşen tutar girilince Acil Tedbir Fiyat Teklifini hazırlayınız.', sahipRol: await rolId(c, 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)'), nesneTuru: 'Dosya', nesneKimligi: dosya });
}

/** YG-243: 15 dakikada dönülmeyen çağrı bir üst katmana çıkar. */
export async function nobetCagriIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const dk = await parametre(db, 'nobet_donus_dk');
  for (const k of (await db.query(`SELECT * FROM nobet_cagrisi WHERE donus_zamani IS NULL AND son_zaman <= $1::timestamptz`, [simdi])).rows) {
    const z = NOBET_ZINCIR[k.hat]!; const yeni = Math.min(k.kademe + 1, z.length - 1);
    const al = await sahipleri(db, z[yeni]!);
    await db.query(`UPDATE nobet_cagrisi SET kademe = $2, sorumlu_rol = $3, sorumlu_ref = NULL, son_zaman = $4 WHERE kimlik = $1`, [k.kimlik, yeni, z[yeni], new Date(simdi.getTime() + dk * 60_000)]);
    await bildir(db, { olay: `nobet-cagri:${k.kimlik}:${yeni}:${simdi.getTime()}`, kullanicilar: al, baslik: `Yanıtsız Nöbet Çağrısı: ${k.arayan}`, ozet: k.ozet, oncelik: 'Kritik', sms: true, acil: true }, simdi); n++;
  }
  // YG-1483: firma iş emrini süresinde kabul etmezse Dosya Sorumlusuna Firma Değiştir görevi.
  for (const e of (await db.query(`SELECT e.kimlik, e.is_emri_no, d.dosya_sorumlusu_ref FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.statu = 'Kabul Bekliyor' AND e.yanit_son <= $1::timestamptz`, [simdi])).rows) {
    if (e.dosya_sorumlusu_ref && await birKez(db, 'firma_degistir', e.kimlik)) { await kartAc(db, { tur: 'Firma Değiştir', kategori: 'gorev', baslik: `${e.is_emri_no} · Firma Yanıt Vermedi`, ozet: 'Kabul süresi doldu; firmayı değiştirmenizi rica ederiz.', oncelik: 'Yüksek', sahipKullanici: e.dosya_sorumlusu_ref, nesneTuru: 'İş Emri', nesneKimligi: e.kimlik }); n++; }
  }
  return n;
}

/** YG-1489: aciliyet sırası can > çevre > batma, su alma, yangın > sürüklenme > hasar büyümesi > diğer; eşitlikte ihbar saati. */
export const ACILIYET = `CASE m.olay_turu WHEN 'Can Güvenliği' THEN 1 WHEN 'Kirlilik' THEN 2 WHEN 'Su Alma veya Batma' THEN 3 WHEN 'Yangın' THEN 3 WHEN 'Sürüklenme veya Bağlama Tehlikesi' THEN 4 ELSE CASE WHEN m.kimlik IS NULL THEN 6 ELSE 5 END END`;

async function donemIlan(c: Db, g: { bolge: string; olay: string; ilanEden: string; oneren: string }, webAdresi: string) {
  const d = (await c.query(`INSERT INTO olaganustu_donem (ilan_eden, sebep, bolge, olay) VALUES ($1,$2,$3,$4) RETURNING kimlik, baslangic`, [g.ilanEden, `${g.bolge} · ${g.olay}`, g.bolge, g.olay])).rows[0];
  await donemBildir(c, d.kimlik, g.bolge, { olay: g.olay, tarih: gunAy(d.baslangic) }, 'bas', g.oneren, webAdresi);
  return d.kimlik as string;
}
async function donemBildir(c: Db, donem: string, bolge: string, a: { olay?: string; tarih?: string; bas?: string; bit?: string }, tur: 'bas' | 'son', sorumlu: string, _web: string) {
  const hat = await destekHatti(c);
  const yatKod = tur === 'bas' ? 'BLD-60' : 'BLD-61';
  for (const t of (await c.query(`SELECT DISTINCT ON (t.telefon, t.eposta) t.telefon, t.eposta, d.yazisma_dili FROM dosya d JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif WHERE d.statu = 'Aktif' AND NOT d.vefat_isareti`)).rows) {
    if (tur === 'bas' && !hat) break;
    await yatTarafinaYaz(c, { olay: `${yatKod}:${donem}:${t.telefon ?? t.eposta}`, kod: yatKod, dil: dilKod(t.yazisma_dili), konu: 'Olağanüstü Olay Dönemi', telefon: t.telefon, eposta: t.eposta, acil: true, alanlar: { Bölge: bolge, Region: bolge, telefon: hat ?? '', phone: hat ?? '' } });
  }
  const kod = tur === 'bas' ? 'BLD-33' : 'BLD-34';
  for (const s of (await c.query(`SELECT DISTINCT t.eposta, x.sigortaci_adi FROM dosya_sigorta_kaydi x JOIN dosya_tarafi t ON t.kimlik = x.sigorta_taraf_ref JOIN dosya d ON d.kimlik = x.dosya_ref WHERE d.statu = 'Aktif' AND t.eposta IS NOT NULL`)).rows) {
    await sigortayaHazirla(c, { tur: kod, nesne: `${donem}:${s.eposta}`, alici: s.eposta, konu: `${bolge} Olağanüstü Olay Dönemi`, sorumlu, metin: await metinGetir(c, kod, 'tr', { Bölge: bolge, Kurum: s.sigortaci_adi ?? '', olay: a.olay ?? '', tarih: a.tarih ?? '', 'başlangıç tarihi': a.bas ?? '', 'bitiş tarihi': a.bit ?? '' }) });
  }
}
let webAdresiKapanis = '';
kapanisKaydet('Olağanüstü Dönem İlanı', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') {
    const o = (await c.query(`UPDATE olaganustu_onerisi SET durum = 'İlan Edildi' WHERE kimlik = $1::uuid AND durum = 'Görüşte' RETURNING bolge, olay, oneren_ref`, [k.nesne_kimligi])).rows[0];
    if (o) await donemIlan(c, { bolge: o.bolge, olay: o.olay, ilanEden: yapan, oneren: o.oneren_ref }, webAdresiKapanis);
  } else if (karar === 'Reddet') await c.query(`UPDATE olaganustu_onerisi SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});
onaySonucKaydet('ONY-30', async (c, t, karar) => {
  if (karar === 'Onaylandı') await c.query(`UPDATE kurtarma_operasyonu SET yat_sahibi_onay_zamani = now() WHERE onay_talebi_ref = $1`, [t.kimlik]);
});

export function acilEkYollari(s: FastifyInstance, b: Baglam) {
  webAdresiKapanis = b.webAdresi;
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const kodDogru = async (k: string, kod?: string) => {
    const h = (await b.db.query(`SELECT totp_gizli_sifreli, totp_son_adim FROM kullanici_hesabi WHERE kimlik = $1`, [k])).rows[0];
    const adim = h?.totp_gizli_sifreli && /^\d{6}$/.test(kod ?? '') ? totpDogrula(coz(h.totp_gizli_sifreli, b.anahtar), kod!, Number(h.totp_son_adim)) : null;
    if (adim) await b.db.query(`UPDATE kullanici_hesabi SET totp_son_adim = $2 WHERE kimlik = $1`, [k, adim]);
    return Boolean(adim);
  };
  const firmam = async (k: string) => (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;

  // YG-243: gelen çağrıyı nöbetçi kaydeder; santral bağlantısı olmadığından çağrı elle girilir.
  s.post('/nobet/cagri', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { hat?: string; arayan?: string; telefon?: string; ozet?: string };
    if (o.grup !== LGM) return yok(y);
    if (!NOBET_ZINCIR[g.hat ?? ''] || !g.arayan?.trim() || !g.ozet?.trim()) return y.code(400).send({ hata: 'Hat, arayan ve özeti girmenizi rica ederiz.' });
    const rol = NOBET_ZINCIR[g.hat!]![0]!; const son = new Date(Date.now() + (await parametre(b.db, 'nobet_donus_dk')) * 60_000);
    const sorumlu = (await b.db.query(`SELECT v.kullanici_ref FROM nobet_vardiyasi v JOIN nobet_cizelgesi c ON c.kimlik = v.cizelge_ref WHERE c.durum = 'Yürürlükte' AND v.katman = $1 AND now() BETWEEN v.baslangic AND v.bitis LIMIT 1`, [rol])).rows[0]?.kullanici_ref as string | undefined;
    const r = (await b.db.query(`INSERT INTO nobet_cagrisi (hat, arayan, telefon, ozet, sorumlu_rol, sorumlu_ref, son_zaman, acan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [g.hat, g.arayan.trim(), g.telefon?.trim() || null, g.ozet.trim(), rol, sorumlu ?? null, son, o.kullanici])).rows[0];
    await bildir(b.db, { olay: `nobet-cagri:${r.kimlik}:0`, kullanicilar: sorumlu ? [sorumlu] : await sahipleri(b.db, rol), baslik: `Nöbet Çağrısı: ${g.arayan.trim()}`, ozet: g.ozet.trim(), oncelik: 'Kritik', sms: true, acil: true });
    return { kimlik: r.kimlik, sonZaman: son.toISOString() };
  });
  s.get('/nobet/cagrilar', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== LGM) return yok(y);
    return (await b.db.query(`SELECT kimlik, hat, arayan, telefon, ozet, sorumlu_rol, son_zaman, son_zaman < now() AS gecikti FROM nobet_cagrisi WHERE donus_zamani IS NULL ORDER BY son_zaman`)).rows;
  });
  s.post('/nobet/cagri/:id/donus', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const not = ((i.body ?? {}) as { not?: string }).not?.trim();
    if (!UUID.test(id) || o.grup !== LGM) return yok(y);
    if (!not) return y.code(400).send({ hata: 'Görüşme notunu yazmanızı rica ederiz.' });
    const r = await b.db.query(`UPDATE nobet_cagrisi SET donus_zamani = now(), donus_notu = $2, donen_ref = $3 WHERE kimlik = $1 AND donus_zamani IS NULL`, [id, not, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu çağrıya dönülmüştür.' });
    return { tamam: true };
  });

  // YG-261: olay türüne göre ilk müdahale eden, olay yöneticisi ve bilgilendirilecekler.
  s.post('/olay-komutasi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; ozet?: string; dosya?: string };
    if (o.grup !== LGM) return yok(y);
    const k = KOMUTA[g.tur ?? '']; if (!k || !g.ozet?.trim()) return y.code(400).send({ hata: 'Olay türü ve özeti girmenizi rica ederiz.' });
    if (g.dosya && (!UUID.test(g.dosya) || !(await dosyaErisimi(b.db, o.kullanici, g.dosya)))) return yok(y);
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO olay_kaydi (olay_turu, ozet, dosya_ref, acan_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [g.tur, g.ozet!.trim(), g.dosya ?? null, o.kullanici])).rows[0];
      // Kurumsal krizde ilk müdahale olayı açan ilgili Direktördür.
      const ilk = k.ilk ? await sahipleri(c, k.ilk) : [o.kullanici]; const yon: string[] = []; for (const x of k.yonetici) yon.push(...await sahipleri(c, x)); const bil: string[] = []; for (const x of k.bilgi) bil.push(...await sahipleri(c, x));
      await bildir(c, { olay: `olay:${r.kimlik}:ilk`, kullanicilar: ilk, baslik: `İlk Müdahale: ${g.tur}`, ozet: g.ozet!.trim(), oncelik: 'Kritik', sms: true, acil: true });
      await bildir(c, { olay: `olay:${r.kimlik}:yon`, kullanicilar: yon, baslik: `Olay Yöneticisi: ${g.tur}`, ozet: g.ozet!.trim(), oncelik: 'Kritik', sms: true, acil: true });
      await bildir(c, { olay: `olay:${r.kimlik}:bil`, kullanicilar: bil, baslik: `Bilgi: ${g.tur}`, ozet: g.ozet!.trim(), oncelik: 'Yüksek' });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Olay Komutası', nesneTuru: 'Olay', nesneKimligi: r.kimlik, yeni: { tur: g.tur }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: r.kimlik, ilkMudahale: k.ilk ?? 'İlgili Direktör', olayYoneticisi: k.yonetici, bilgilendirilen: k.bilgi };
    });
  });

  // YG-1489, D-028: Operasyon Müdürü (gece yönetici nöbetçisi) önerir, GMY görüş, CEO ilan eder; ulaşılamazsa GMY.
  s.post('/olaganustu/oneri', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { bolge?: string; olay?: string };
    const nobetciYon = (await b.db.query(`SELECT 1 FROM nobet_vardiyasi v JOIN nobet_cizelgesi c ON c.kimlik = v.cizelge_ref WHERE c.durum = 'Yürürlükte' AND v.katman = 'Yönetici' AND v.kullanici_ref = $1 AND now() BETWEEN v.baslangic AND v.bitis LIMIT 1`, [o.kullanici])).rowCount;
    if (!nobetciYon && !(await rolVar(o.kullanici, [OPM]))) return y.code(403).send({ hata: 'Öneriyi Operasyon Müdürü veya yönetici nöbetçisi yapar.' });
    if (!g.bolge?.trim() || !g.olay?.trim()) return y.code(400).send({ hata: 'Bölge ve olayı girmenizi rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM olaganustu_donem WHERE bitis IS NULL LIMIT 1`)).rowCount) return y.code(409).send({ hata: 'Açık bir Olağanüstü Olay Dönemi bulunmaktadır.' });
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO olaganustu_onerisi (bolge, olay, oneren_ref) VALUES ($1,$2,$3) RETURNING kimlik`, [g.bolge!.trim(), g.olay!.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Olağanüstü Dönem İlanı', baslik: `${g.bolge!.trim()} · Olağanüstü Olay Dönemi`, ozet: g.olay!.trim(), oncelik: 'Kritik', hazirlayan: o.kullanici, zincir: [await rolId(c, GMY), await rolId(c, 'CEO')], nesneTuru: 'Olağanüstü Öneri', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik };
    });
  });
  s.post('/olaganustu/oneri/:id/gmy-ilan', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const gerekce = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [GMY]))) return yok(y);
    if (!gerekce) return y.code(400).send({ hata: 'CEO’ya ulaşılamadığını belirten gerekçeyi yazmanızı rica ederiz.' });
    return islem(async (c) => {
      const u = (await c.query(`UPDATE olaganustu_onerisi SET durum = 'İlan Edildi' WHERE kimlik = $1 AND durum = 'Görüşte' RETURNING bolge, olay, oneren_ref`, [id])).rows[0];
      if (!u) throw Object.assign(new Error('Öneri sonuçlanmıştır.'), { statusCode: 409 });
      await c.query(`UPDATE is_karti SET durum = 'Onaylandı', kapanma_zamani = now() WHERE tur = 'Olağanüstü Dönem İlanı' AND nesne_kimligi = $1`, [id]);
      const donem = await donemIlan(c, { bolge: u.bolge, olay: u.olay, ilanEden: o.kullanici, oneren: u.oneren_ref }, b.webAdresi);
      await bildir(c, { olay: `ood-gmy:${donem}`, kullanicilar: await sahipleri(c, 'CEO'), baslik: 'Olağanüstü Olay Dönemi GMY Tarafından İlan Edildi', ozet: gerekce, oncelik: 'Kritik', sms: true, acil: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Olağanüstü Dönem İlanı (GMY)', nesneTuru: 'Olağanüstü Dönem', nesneKimligi: donem, gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { donem };
    });
  });
  s.post('/olaganustu/bitir', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (!(await rolVar(o.kullanici, [OPM, GMY, 'CEO']))) return y.code(403).send({ hata: 'Dönemi Operasyon Müdürü, Genel Müdür Yardımcısı veya CEO kapatır.' });
    return islem(async (c) => {
      const d = (await c.query(`UPDATE olaganustu_donem SET bitis = now() WHERE bitis IS NULL RETURNING kimlik, bolge, baslangic, bitis`)).rows[0];
      if (!d) throw Object.assign(new Error('Açık Olağanüstü Olay Dönemi bulunmamaktadır.'), { statusCode: 409 });
      await donemBildir(c, d.kimlik, d.bolge ?? '', { bas: gunAy(d.baslangic), bit: gunAy(d.bitis) }, 'son', o.kullanici, b.webAdresi);
      return { tamam: true };
    });
  });
  s.get('/olaganustu/sira', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== LGM) return yok(y);
    return (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.olusturma_zamani, y.yat_adi, m.olay_turu, ${ACILIYET} AS sira FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN acil_mudahale m ON m.dosya_ref = d.kimlik AND m.durum <> 'Kapalı' WHERE d.statu = 'Aktif' ORDER BY sira, d.olusturma_zamani LIMIT 200`)).rows;
  });

  // YG-1481, YG-277: 112, marina, Operasyon Müdürü ve resmî muhatap temas kayıtları; refakatli girişte BLD-56 ve görev.
  s.post('/acil/:dosya/temas', oturumlu, async (i, y) => {
    const o = i.oturum!; const { dosya } = i.params as { dosya: string }; const g = (i.body ?? {}) as { tur?: string; ozet?: string };
    if (!UUID.test(dosya) || !(await dosyaErisimi(b.db, o.kullanici, dosya))) return yok(y);
    if (!TEMAS.includes(g.tur ?? '') || !g.ozet?.trim()) return y.code(400).send({ hata: 'Muhatap ve özeti girmenizi rica ederiz.' });
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO acil_temas_kaydi (dosya_ref, tur, ozet, kaydeden_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [dosya, g.tur, g.ozet!.trim(), o.kullanici])).rows[0];
      if (g.tur === 'Refakatli Giriş') {
        const d = (await c.query(`SELECT d.dosya_no, d.yazisma_dili, d.vefat_isareti, d.dosya_sorumlusu_ref FROM dosya d WHERE d.kimlik = $1`, [dosya])).rows[0];
        const t = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [dosya])).rows[0]; const hat = await destekHatti(c);
        const saat = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
        if (t && hat && !d.vefat_isareti) await yatTarafinaYaz(c, { olay: `bld56:${r.kimlik}`, kod: 'BLD-56', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Yata Giriş`, telefon: t.telefon, eposta: t.eposta, acil: true, alanlar: { saat, time: saat, 'bağlantı': b.webAdresi, link: b.webAdresi, telefon: hat, phone: hat } });
        if (d.dosya_sorumlusu_ref) await kartAc(c, { tur: 'Refakatli Giriş Araması', kategori: 'islem', baslik: `${d.dosya_no} · Bilgilendirme Araması`, ozet: 'İlk iş günü bilgilendirme araması', oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: dosya });
      }
      return { kimlik: r.kimlik };
    });
  });
  s.get('/acil/:dosya/temas', oturumlu, async (i, y) => {
    const { dosya } = i.params as { dosya: string };
    if (!UUID.test(dosya) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, dosya))) return yok(y);
    return (await b.db.query(`SELECT tur, ozet, zaman FROM acil_temas_kaydi WHERE dosya_ref = $1 ORDER BY zaman DESC`, [dosya])).rows;
  });

  // YG-273: arama sırası ve hizmet verme sicilde; müsaitlik ve beyan edilen yanıt süresi firma tarafından güncel tutulur.
  s.post('/firma/:id/acil-bilgi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { hizmetVerir?: boolean; aramaSirasi?: number };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı']))) return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    if (typeof g.hizmetVerir !== 'boolean' || !(Number(g.aramaSirasi) > 0)) return y.code(400).send({ hata: 'Acil hizmet durumu ve arama sırasını girmenizi rica ederiz.' });
    const r = await b.db.query(`UPDATE kurulus SET acil_hizmet_verir = $2, acil_arama_sirasi = $3 WHERE kimlik = $1`, [id, g.hizmetVerir, g.aramaSirasi]);
    return r.rowCount ? { tamam: true } : yok(y);
  });
  s.post('/firma-portal/acil-musaitlik', oturumlu, async (i, y) => {
    const f = await firmam(i.oturum!.kullanici); const g = (i.body ?? {}) as { musait?: boolean; yanitDk?: number };
    if (!f) return yok(y);
    if (typeof g.musait !== 'boolean' || !(Number(g.yanitDk) > 0)) return y.code(400).send({ hata: 'Müsaitlik ve yanıt süresini girmenizi rica ederiz.' });
    await b.db.query(`UPDATE kurulus SET acil_musaitlik = $2, acil_yanit_dk = $3 WHERE kimlik = $1`, [f, g.musait, g.yanitDk]);
    return { tamam: true };
  });

  // YG-210, K-216: firma, yat sahibi ve koordinatör kodlu onayı; acilde iş beklemez, acil olmayanda başlamadan tamamlanır.
  s.post('/dosya/:id/kurtarma', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { hizmet?: string; saglayici?: string; acil?: boolean };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!['Kurtarma', 'Çekme / Refakat', 'Dalgıçlık', 'Birden Fazla'].includes(g.hizmet ?? '') || !g.saglayici || !UUID.test(g.saglayici)) return y.code(400).send({ hata: 'Hizmet türü ve sağlayıcıyı seçmenizi rica ederiz.' });
    const d = (await b.db.query(`SELECT d.dosya_no, d.yazisma_dili, d.dosya_niteligi, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [id])).rows[0];
    const yt = (await b.db.query(`SELECT t.kimlik, t.kisi_adi_soyadi, t.telefon, t.eposta, t.kullanici_ref FROM dosya_tarafi t WHERE t.dosya_ref = $1 AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif LIMIT 1`, [id])).rows[0];
    if (!yt) return y.code(409).send({ hata: 'Yat sahibi kaydı bulunamadı.' });
    if (!(await b.db.query(`SELECT 1 FROM kurulus WHERE kimlik = $1`, [g.saglayici])).rowCount) return yok(y);
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO kurtarma_operasyonu (dosya_ref, hizmet_turu, saglayici_ref, acil, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, g.hizmet, g.saglayici, Boolean(g.acil), o.kullanici])).rows[0];
      const on = await onayTalebiAc(c, { dosya: id, ony: 'ONY-30', dil: dilKod(d.yazisma_dili), alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, 'bağlantı': b.webAdresi, link: b.webAdresi }, aliciAd: yt.kisi_adi_soyadi, telefon: yt.telefon, eposta: yt.eposta, kullanici: yt.kullanici_ref, nesneTuru: 'Kurtarma', nesneKimligi: r.kimlik, hazirlayan: o.kullanici, webAdresi: b.webAdresi, konu: `${d.dosya_no} Kurtarma Sözleşmesi` });
      await c.query(`UPDATE kurtarma_operasyonu SET onay_talebi_ref = $2 WHERE kimlik = $1`, [r.kimlik, on.kimlik]);
      const firma = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [g.saglayici])).rows.map((x) => x.kullanici_ref as string);
      await bildir(c, { olay: `kurtarma:${r.kimlik}:firma`, kullanicilar: firma, baslik: `${d.dosya_no} · Kurtarma Sözleşmesi Onayı`, oncelik: g.acil ? 'Kritik' : 'Yüksek', sms: true, acil: Boolean(g.acil) });
      await kartAc(c, { tur: 'Kurtarma Koordinatör Onayı', kategori: 'islem', baslik: `${d.dosya_no} · Kurtarma Koordinatör Onayı`, ozet: g.hizmet, oncelik: g.acil ? 'Kritik' : 'Yüksek', sahipRol: await rolId(c, TOD), nesneTuru: 'Kurtarma', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik };
    });
  });
  s.get('/dosya/:id/kurtarma', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT k.kimlik, k.hizmet_turu, k.acil, k.yat_sahibi_onay_zamani, k.firma_onay_zamani, k.koordinator_onay_zamani, k.baslama_zamani, u.ticari_unvan FROM kurtarma_operasyonu k JOIN kurulus u ON u.kimlik = k.saglayici_ref WHERE k.dosya_ref = $1 ORDER BY k.olusturma_zamani DESC`, [id])).rows;
  });
  s.post('/kurtarma/:id/koordinator-onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { kod } = (i.body ?? {}) as { kod?: string };
    if (!UUID.test(id)) return yok(y);
    const gece = (await b.db.query(`SELECT 1 FROM nobet_vardiyasi v JOIN nobet_cizelgesi c ON c.kimlik = v.cizelge_ref WHERE c.durum = 'Yürürlükte' AND v.katman = 'Yönetici' AND v.kullanici_ref = $1 AND now() BETWEEN v.baslangic AND v.bitis LIMIT 1`, [o.kullanici])).rowCount;
    if (!gece && !(await rolVar(o.kullanici, [TOD]))) return y.code(403).send({ hata: 'Koordinatör onayını Teknik ve Operasyon Direktörü, gece olay yöneticisi verir.' });
    if (!(await kodDogru(o.kullanici, kod))) return y.code(401).send({ hata: 'Onay kodu hatalıdır.' });
    const r = await b.db.query(`UPDATE kurtarma_operasyonu SET koordinator_onay_zamani = now(), koordinator_ref = $2 WHERE kimlik = $1 AND koordinator_onay_zamani IS NULL`, [id, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Onay verilmiştir.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Kurtarma Koordinatör Onayı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    return { tamam: true };
  });
  s.get('/firma-portal/kurtarma', oturumlu, async (i, y) => {
    const f = await firmam(i.oturum!.kullanici);
    if (!f) return yok(y);
    return (await b.db.query(`SELECT k.kimlik, k.hizmet_turu, k.acil, k.firma_onay_zamani, d.dosya_no FROM kurtarma_operasyonu k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.saglayici_ref = $1 ORDER BY k.olusturma_zamani DESC`, [f])).rows;
  });
  s.post('/firma-portal/kurtarma/:id/onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { kod } = (i.body ?? {}) as { kod?: string }; const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT firma_onay_zamani FROM kurtarma_operasyonu WHERE kimlik = $1 AND saglayici_ref = $2`, [id, f])).rows[0];
    if (!k) return yok(y);
    if (k.firma_onay_zamani) return y.code(409).send({ hata: 'Onay verilmiştir.' });
    if (!(await kodDogru(o.kullanici, kod))) return y.code(401).send({ hata: 'Onay kodu hatalıdır.' });
    await b.db.query(`UPDATE kurtarma_operasyonu SET firma_onay_zamani = now(), firma_onaylayan_ref = $2 WHERE kimlik = $1`, [id, o.kullanici]);
    return { tamam: true };
  });
  // YG-276: liman izni, dalış planı ve enerji izolasyonu olmadan dalış başlamaz; acil olmayanda üçlü onay başlamadan tamamlanır.
  s.post('/kurtarma/:id/baslat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { limanIzni?: string; dalisPlani?: string; enerjiIzolasyonu?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT * FROM kurtarma_operasyonu WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (k.baslama_zamani) return y.code(409).send({ hata: 'Operasyon başlamıştır.' });
    if (!k.acil && (!k.yat_sahibi_onay_zamani || !k.firma_onay_zamani || !k.koordinator_onay_zamani)) return y.code(409).send({ hata: 'Üç tarafın kodlu onayı tamamlanmadan iş başlamaz.' });
    if (DALIS.includes(k.hizmet_turu)) {
      const ok = [g.limanIzni, g.dalisPlani, g.enerjiIzolasyonu].every((x) => x && UUID.test(x));
      if (!ok) return y.code(409).send({ hata: 'Liman izni, dalış planı ve enerji izolasyonu kaydı olmadan dalış görevi başlatılamaz.' });
    }
    await b.db.query(`UPDATE kurtarma_operasyonu SET baslama_zamani = now(), liman_izni_belge = $2, dalis_plani_belge = $3, enerji_izolasyon_belge = $4 WHERE kimlik = $1`, [id, g.limanIzni ?? null, g.dalisPlani ?? null, g.enerjiIzolasyonu ?? null]);
    return { tamam: true };
  });
  s.post('/kurtarma/:id/saglayici-gorunur', oturumlu, async (i, y) => { // YG-486
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT dosya_ref FROM kurtarma_operasyonu WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    await b.db.query(`UPDATE kurtarma_operasyonu SET saglayici_aciklama_onayi = true WHERE kimlik = $1`, [id]);
    return { tamam: true };
  });

  // YG-1658: konum 10 dakikada bir; izin yoksa yatın kayıtlı konumu; nöbetçi ve kullanıcı durdurabilir; firma varınca kendiliğinden durur.
  s.post('/portal/acil/:talep/konum', oturumlu, async (i, y) => {
    const o = i.oturum!; const { talep } = i.params as { talep: string }; const g = (i.body ?? {}) as { enlem?: number; boylam?: number };
    if (!UUID.test(talep)) return yok(y);
    const a = (await b.db.query(`SELECT aktif FROM acil_konum WHERE talep_ref = $1 AND kullanici_ref = $2`, [talep, o.kullanici])).rows[0];
    if (!a) return yok(y);
    if (!a.aktif) return { durdu: true };
    if (typeof g.enlem === 'number' && typeof g.boylam === 'number') {
      if (Math.abs(g.enlem) > 90 || Math.abs(g.boylam) > 180) return y.code(400).send({ hata: 'Konum geçersiz.' });
      await b.db.query(`INSERT INTO konum_kaydi (talep_ref, enlem, boylam, kaynak) VALUES ($1,$2,$3,'Cihaz')`, [talep, g.enlem, g.boylam]);
    } else await b.db.query(`INSERT INTO konum_kaydi (talep_ref, kaynak, metin) SELECT t.kimlik, 'Kayıtlı Konum', t.yat_mevcut_konumu FROM talep t WHERE t.kimlik = $1`, [talep]);
    return { durdu: false };
  });
  s.post('/portal/acil/:talep/konum-durdur', oturumlu, async (i, y) => {
    const o = i.oturum!; const { talep } = i.params as { talep: string };
    if (!UUID.test(talep)) return yok(y);
    const r = await b.db.query(`UPDATE acil_konum SET aktif = false, durduran = 'Kullanıcı', durma_zamani = now() WHERE talep_ref = $1 AND kullanici_ref = $2 AND aktif`, [talep, o.kullanici]);
    return r.rowCount ? { tamam: true } : yok(y);
  });
  s.get('/acil-konum', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== LGM) return yok(y);
    return (await b.db.query(`SELECT a.talep_ref, t.talep_no, k.enlem, k.boylam, k.kaynak, k.metin, k.zaman FROM acil_konum a JOIN talep t ON t.kimlik = a.talep_ref LEFT JOIN LATERAL (SELECT * FROM konum_kaydi x WHERE x.talep_ref = a.talep_ref ORDER BY x.zaman DESC LIMIT 1) k ON true WHERE a.aktif ORDER BY a.olusturma_zamani DESC`)).rows;
  });
  s.post('/acil-konum/:talep/durdur', oturumlu, async (i, y) => {
    const { talep } = i.params as { talep: string };
    if (!UUID.test(talep) || i.oturum!.grup !== LGM) return yok(y);
    await b.db.query(`UPDATE acil_konum SET aktif = false, durduran = 'Nöbetçi', durma_zamani = now() WHERE talep_ref = $1 AND aktif`, [talep]);
    return { tamam: true };
  });
  s.post('/firma-portal/is-emri/:id/varis', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const f = await firmam(o.kullanici);
    if (!f || !UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT dosya_ref, is_emri_turu FROM is_emri WHERE kimlik = $1 AND kurulus_ref = $2`, [id, f])).rows[0];
    if (!e) return yok(y);
    await b.db.query(`UPDATE acil_konum a SET aktif = false, durduran = 'Sahaya Varış', durma_zamani = now() FROM dosya d WHERE d.kimlik = $1 AND d.talep_ref = a.talep_ref AND a.aktif`, [e.dosya_ref]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sahaya Varış', nesneTuru: 'İş Emri', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
    return { tamam: true };
  });
}
