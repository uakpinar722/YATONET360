import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const IKM = 'İnsan Kaynakları Müdürü'; const IKS = 'İnsan Kaynakları Sorumlusu'; const IK = [IKM, IKS]; const ISG = 'İSG Sorumlusu'; const GMY = 'Genel Müdür Yardımcısı'; const HUD = 'Hukuk ve Uyum Direktörü'; const TID = 'Ticari İşler Direktörü';
const R2 = (x: number) => Math.round(x * 100) / 100;
const gunStr = (d: Date) => d.toISOString().slice(0, 10);
const tl = (x: number) => `${x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
const YILLIK_FAZLA_DK = 270 * 60; const HAFTALIK_DK = 45 * 60; const GUNLUK_DK = 11 * 60;

/** YG-977: 4857 md. 17 bildirim süresi. */
export function ihbarHafta(giris: string, son: string): number {
  const a = new Date(giris); const b = new Date(son);
  let ay = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth(); const artik = b.getUTCDate() - a.getUTCDate(); if (artik < 0) ay--;
  if (ay < 6) return 2;
  if (ay < 18) return 4;
  if (ay < 36 || (ay === 36 && artik === 0)) return 6;
  return 8;
}

/** YG-978: tam yıl başına 30 günlük brüt ücret, artık süre orantılı; bir yılı doldurmayana ve kanunun saymadığı ayrılışa ödenmez; ücret tavanla sınırlanır. */
export function kidemTazminati(g: { giris: string; son: string; brutAylik: number; tavan: number; tur: string }): number {
  if (['İstifa', 'Haklı Fesih (25/II)', 'Mutabakat'].includes(g.tur)) return 0;
  const a = new Date(g.giris); const b = new Date(g.son);
  let yil = b.getUTCFullYear() - a.getUTCFullYear(); let yd = new Date(Date.UTC(a.getUTCFullYear() + yil, a.getUTCMonth(), a.getUTCDate()));
  if (yd > b) { yil--; yd = new Date(Date.UTC(a.getUTCFullYear() + yil, a.getUTCMonth(), a.getUTCDate())); }
  if (yil < 1) return 0;
  const gun = Math.round((b.getTime() - yd.getTime()) / 86_400_000);
  return R2(Math.min(g.brutAylik, g.tavan) * (yil + gun / 365));
}

/** YG-977, YG-1492: bildirim süresine uyulmayan günlerin ücreti; işveren feshinde LGM, istifada çalışan öder. */
export function ihbarTazminati(g: { giris: string; bildirim: string; son: string; brutAylik: number; tur: string; mutabakat: boolean }): { hafta: number; eksikGun: number; tutar: number; odeyen: 'LGM' | 'Çalışan' | null } {
  const hafta = ihbarHafta(g.giris, g.son); const verilen = Math.round((new Date(g.son).getTime() - new Date(g.bildirim).getTime()) / 86_400_000); const eksikGun = Math.max(0, hafta * 7 - verilen);
  const odeyen = g.tur === 'İşveren Feshi' ? 'LGM' as const : g.tur === 'İstifa' ? 'Çalışan' as const : null;
  if (!odeyen || g.mutabakat || !eksikGun) return { hafta, eksikGun: odeyen && !g.mutabakat ? eksikGun : 0, tutar: 0, odeyen: null };
  return { hafta, eksikGun, tutar: R2((eksikGun * g.brutAylik) / 30), odeyen };
}

/** İş Kanunu md. 68 ara dinlenmesi düşülür; nöbette fiilen çalışılan süre eklenir. */
export function netDakika(giris: string | null | undefined, cikis: string | null | undefined, nobet = 0): number {
  if (!giris || !cikis) return nobet;
  const d = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)); const brut = d(cikis) - d(giris);
  return brut - (brut > 450 ? 60 : brut > 240 ? 30 : brut > 0 ? 15 : 0) + nobet;
}

/** YG-941: süresi dolan ve yenilenmeyen belge yeni görevlendirmeyi engeller; geçmiş işe dokunmaz. */
/** D-025: yurt dışı dosyada yalnız geçerli pasaport ve vizesi olan personel önerilir. */
export const yurtDisiUygunMu = async (db: Db, kullanici: string): Promise<boolean> => Boolean((await db.query(`SELECT 1 FROM personel_karti WHERE kullanici_ref = $1 AND pasaport_bitis >= current_date AND vize_bitis >= current_date`, [kullanici])).rowCount);

export async function personelBelgeEngeli(db: Db, kullanici: string): Promise<string | null> {
  // YG-944: personel kartı olan çalışanda geçerli İSG eğitimi kaydı olmadan yeni görev verilmez.
  if ((await db.query(`SELECT 1 FROM personel_karti WHERE kullanici_ref = $1`, [kullanici])).rowCount && !(await db.query(`SELECT 1 FROM egitim_kaydi WHERE personel_ref = $1 AND tur = 'İSG' AND (gecerlilik_sonu IS NULL OR gecerlilik_sonu >= current_date) LIMIT 1`, [kullanici])).rowCount) return 'Personelin İSG eğitimi kaydı bekleniyor.';
  const r = (await db.query(`SELECT e.ad FROM egitim_kaydi e WHERE e.personel_ref = $1 AND e.gecerlilik_sonu < current_date AND NOT EXISTS (SELECT 1 FROM egitim_kaydi x WHERE x.personel_ref = e.personel_ref AND x.tur = e.tur AND x.ad = e.ad AND (x.gecerlilik_sonu IS NULL OR x.gecerlilik_sonu >= current_date)) LIMIT 1`, [kullanici])).rows[0];
  return r ? `Personelin ${r.ad} belgesinin süresi dolmuştur; yenilenmesi bekleniyor.` : null;
}

/** YG-1492, Yönetmelik 4.1: nöbet çizelgesine yalnız geçerli Ek-3 onayı olan yazılır. */
export async function ek3Engeli(db: Db, kullanicilar: string[], yil: number): Promise<string | null> {
  const r = (await db.query(`SELECT h.ad_soyad FROM personel_karti k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.kullanici_ref = ANY($1::text[]) AND k.ek3_yil IS DISTINCT FROM $2 LIMIT 1`, [kullanicilar, yil])).rows[0];
  return r ? `${r.ad_soyad} için ${yil} yılı Ek-3 fazla çalışma onayı bekleniyor.` : null;
}

async function birimAmiri(c: Db, k: string): Promise<string | null> {
  const r = (await c.query(`SELECT a.rol_ref FROM rol_atamasi a WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' LIMIT 1`, [k])).rows[0];
  if (!r) return null;
  return (await rolSahipleri(c, await onayMakami(c, r.rol_ref))).find((x) => x !== k) ?? null;
}
const dosyaDevret = async (c: Db, atama: string, yeni: string, yapan: string): Promise<string | null> => {
  const a = (await c.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE kimlik = $1 AND bitis_zamani IS NULL RETURNING dosya_ref, rol`, [atama])).rows[0];
  if (!a) return null;
  const r = (await c.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref, devir_notu) VALUES ($1,$2,$3,$4,'Personel devri') RETURNING kimlik`, [a.dosya_ref, yeni, a.rol, yapan])).rows[0];
  if (a.rol === 'Dosya Sorumlusu') await c.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [a.dosya_ref, yeni]);
  return r.kimlik;
};

/** YG-1479: izin ve rapor durumu onaylı kayıttan işlenir; açık dosya ve görev vekile geçer, dönüşte geri döner. Ayrılışta son gün hesap kapanır, kalan iş birim amirine düşer. */
export async function personelDurumIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const bugun = gunStr(simdi);
  for (const t of (await db.query(`SELECT * FROM izin_talebi WHERE durum = 'Onaylandı' AND devir_zamani IS NULL AND baslangic <= $1 AND bitis >= $1`, [bugun])).rows) {
    await db.query(`UPDATE personel_karti SET personel_durumu = $2 WHERE kullanici_ref = $1 AND personel_durumu = 'Görevde'`, [t.personel_ref, t.izin_turu === 'Rapor' ? 'Raporlu' : 'İzinli']);
    if (t.vekil_ref) {
      for (const a of (await db.query(`SELECT kimlik FROM dosya_ekibi_atamasi WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [t.personel_ref])).rows) { const y = await dosyaDevret(db, a.kimlik, t.vekil_ref, t.personel_ref); if (y) await db.query(`INSERT INTO izin_devri (izin_ref, tur, nesne) VALUES ($1,'Dosya',$2)`, [t.kimlik, y]); }
      for (const k of (await db.query(`UPDATE is_karti SET sahip_kullanici_ref = $2 WHERE sahip_kullanici_ref = $1 AND durum = 'Bekliyor' RETURNING kimlik`, [t.personel_ref, t.vekil_ref])).rows) await db.query(`INSERT INTO izin_devri (izin_ref, tur, nesne) VALUES ($1,'Görev',$2)`, [t.kimlik, k.kimlik]);
    }
    await db.query(`UPDATE izin_talebi SET devir_zamani = now() WHERE kimlik = $1`, [t.kimlik]); n++;
  }
  for (const t of (await db.query(`SELECT * FROM izin_talebi WHERE durum = 'Onaylandı' AND devir_zamani IS NOT NULL AND geri_zamani IS NULL AND bitis < $1`, [bugun])).rows) {
    await db.query(`UPDATE personel_karti SET personel_durumu = 'Görevde' WHERE kullanici_ref = $1 AND personel_durumu IN ('İzinli', 'Raporlu')`, [t.personel_ref]);
    for (const d of (await db.query(`SELECT tur, nesne FROM izin_devri WHERE izin_ref = $1`, [t.kimlik])).rows) {
      if (d.tur === 'Dosya') await dosyaDevret(db, d.nesne, t.personel_ref, t.personel_ref);
      else await db.query(`UPDATE is_karti SET sahip_kullanici_ref = $2 WHERE kimlik::text = $1 AND durum = 'Bekliyor'`, [d.nesne, t.personel_ref]);
    }
    await db.query(`UPDATE izin_talebi SET geri_zamani = now() WHERE kimlik = $1`, [t.kimlik]); n++;
  }
  // YG-1479: onaylı yurt dışı görevlendirme süresince "Görevlendirmede", bitince "Görevde".
  n += (await db.query(`UPDATE personel_karti k SET personel_durumu = 'Görevlendirmede' FROM yurtdisi_gorev g WHERE g.personel_ref = k.kullanici_ref AND g.durum = 'Onaylandı' AND g.baslangic <= $1 AND g.bitis >= $1 AND k.personel_durumu = 'Görevde'`, [bugun])).rowCount ?? 0;
  n += (await db.query(`UPDATE personel_karti k SET personel_durumu = 'Görevde' WHERE k.personel_durumu = 'Görevlendirmede' AND NOT EXISTS (SELECT 1 FROM yurtdisi_gorev g WHERE g.personel_ref = k.kullanici_ref AND g.durum = 'Onaylandı' AND g.baslangic <= $1 AND g.bitis >= $1)`, [bugun])).rowCount ?? 0;
  for (const a of (await db.query(`SELECT * FROM personel_ayrilisi WHERE durum = 'Açık' AND son_is_gunu < $1`, [bugun])).rows) {
    const amir = await birimAmiri(db, a.personel_ref);
    for (const d of (await db.query(`SELECT * FROM ayrilis_devri WHERE ayrilis_ref = $1 AND durum = 'Bekliyor'`, [a.kimlik])).rows) {
      if (amir) { if (d.tur === 'Dosya') await dosyaDevret(db, d.nesne, amir, a.kaydeden_ref); else if (d.tur === 'Görev') await db.query(`UPDATE is_karti SET sahip_kullanici_ref = $2 WHERE kimlik::text = $1 AND durum = 'Bekliyor'`, [d.nesne, amir]); }
      await db.query(`UPDATE ayrilis_devri SET durum = 'Birim Amirine Atandı', devralan_ref = $2, zaman = now() WHERE kimlik = $1`, [d.kimlik, amir]);
    }
    await db.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Kapalı' WHERE kimlik = $1`, [a.personel_ref]);
    await (await import('./mobil.js')).cihazIptal(db, a.personel_ref, 'Ayrılış'); // YG-498
    await hesapKapanisGorevi(db, a.kimlik); // YG-1050
    await db.query(`UPDATE personel_karti SET personel_durumu = 'Ayrıldı', ayrilis_tarihi = $2 WHERE kullanici_ref = $1`, [a.personel_ref, a.son_is_gunu]);
    await db.query(`UPDATE personel_ayrilisi SET durum = 'Kapandı' WHERE kimlik = $1`, [a.kimlik]);
    await kartAc(db, { tur: 'SGK İşten Ayrılış Bildirgesi', kategori: 'islem', baslik: 'SGK İşten Ayrılış Bildirgesi', ozet: 'Bildirgenin 10 gün içinde verilmesi rica olunur.', oncelik: 'Yüksek', sonZaman: new Date(new Date(a.son_is_gunu).getTime() + 10 * 86_400_000), sahipRol: await rolId(db, IKS), nesneTuru: 'Ayrılış', nesneKimligi: a.kimlik }); // YG-933
    n++;
  }
  for (const r of (await db.query(`SELECT k.olay_ref, k.isveren, o.ozet FROM is_kazasi k JOIN olay_kaydi o ON o.kimlik = k.olay_ref WHERE k.son_zaman < now() AND k.sgk_bildirim_tarihi IS NULL AND k.bildirim_belge IS NULL`)).rows) {
    if (await birKez(db, 'is_kazasi_sure', r.olay_ref)) { await bildir(db, { olay: `is-kazasi-sure:${r.olay_ref}`, kullanicilar: [...await rolSahipleri(db, await rolId(db, ISG)), ...await rolSahipleri(db, await rolId(db, IKS))], baslik: '⚠ İş Kazası SGK Bildirim Süresi Doldu', ozet: r.isveren === 'LGM' ? 'Bildirim bekleniyor.' : 'Bildirim Belgesi bekleniyor.', oncelik: 'Kritik' }); n++; } // YG-1669
  }
  await esikKontrol(db);
  return n;
}

/** YG-1050: sistem dışı erişimler görevle kapatılır. */
async function hesapKapanisGorevi(db: Db, ayrilis: string) {
  await kartAc(db, { tur: 'Hesap Kapanış Kontrolü', kategori: 'islem', baslik: 'Hesap Kapanış Kontrolü', ozet: 'API anahtarı, veri tabanı erişimi, uzak bağlantı ve acil erişim sırrının kapatılması; ortak şifre kullanıldıysa yenilenmesi rica olunur.', oncelik: 'Yüksek', sonZaman: new Date(Date.now() + 86_400_000), sahipRol: await rolId(db, 'Sistem Yöneticisi'), nesneTuru: 'Ayrılış', nesneKimligi: ayrilis });
}

/** YG-972, MUM-059–061: 28 ve 48 çalışanda Hukuk ve Uyum Direktörü ile Genel Müdür Yardımcısı uyarılır. */
export async function esikKontrol(db: Db): Promise<void> {
  const say = Number((await db.query(`SELECT count(*) n FROM personel_karti WHERE personel_durumu <> 'Ayrıldı'`)).rows[0].n);
  const E: [number, string][] = [[28, '30 çalışan eşiğinde iş güvencesi (İş Kanunu md. 18): fesihte geçerli neden, savunma ve yazılı bildirim.'], [48, '50 çalışan eşiğinde %3 engelli çalıştırma (İş Kanunu md. 30, 101) ve İSG kurulu (6331 md. 22).']];
  for (const [e, liste] of E) if (say >= e && await birKez(db, 'calisan_esigi', String(e))) await bildir(db, { olay: `calisan-esigi:${e}`, kullanicilar: [...await rolSahipleri(db, await rolId(db, HUD)), ...await rolSahipleri(db, await rolId(db, GMY))], baslik: `⚠ Çalışan Sayısı ${e}'e Ulaştı`, ozet: liste, oncelik: 'Yüksek' });
}

/** YG-953: onaylanan izin günleri puantaja otomatik işlenir. */
export async function izinPuantaja(c: Db, t: { kimlik: string; personel_ref: string; izin_turu: string; baslangic: Date | string; bitis: Date | string }) {
  for (let d = new Date(t.baslangic); d <= new Date(t.bitis); d = new Date(d.getTime() + 86_400_000)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    await c.query(`INSERT INTO puantaj_kaydi (personel_ref, tarih, gun_turu, izin_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (personel_ref, tarih) DO UPDATE SET gun_turu = EXCLUDED.gun_turu, izin_ref = EXCLUDED.izin_ref, giris_saati = NULL, cikis_saati = NULL, net_dakika = 0, fazla_dakika = 0`, [t.personel_ref, gunStr(d), t.izin_turu === 'Rapor' ? 'Rapor' : 'İzin', t.kimlik]);
  }
}

/** YG-949: bölünmüş yıllık izin; talep şartı, en çok üç bölüm, bir bölüm en az 10 gün, 14 günü aşan haklarda bölümler arası 60 takvim günü. */
export async function izinBolumEngeli(db: Db, k: string, g: { baslangic: string; bitis: string; gun: number; bolunmus?: boolean }, hak: number, kullanilan: number): Promise<string | null> {
  const yil = Number(g.baslangic.slice(0, 4));
  const on = (await db.query(`SELECT baslangic, bitis, gun FROM izin_talebi WHERE personel_ref = $1 AND izin_turu = 'Yıllık' AND durum IN ('İK Kontrolünde', 'Birim Amirinde', 'Onaylandı') AND EXTRACT(YEAR FROM baslangic) = $2`, [k, yil])).rows as { baslangic: Date; bitis: Date; gun: number }[];
  const kalan = hak - kullanilan - g.gun;
  if (on.length === 0 && kalan <= 0) return null;
  if (!g.bolunmus) return 'Yıllık izninizi bölerek kullanmak için Bölünmüş İzin Talebi seçmenizi rica ederiz.';
  if (on.length >= 3) return 'Yıllık izin en çok üç bölüm olarak kullanılır.';
  const gunler = [...on.map((x) => x.gun), g.gun];
  if (Math.max(...gunler) < 10 && (on.length === 2 || kalan < 10)) return 'Bölümlerden biri en az 10 gün olmalıdır.';
  if (hak > 14) for (const x of on) {
    const ara = new Date(g.baslangic) > new Date(x.bitis) ? new Date(g.baslangic).getTime() - new Date(x.bitis).getTime() : new Date(x.baslangic).getTime() - new Date(g.bitis).getTime();
    if (ara / 86_400_000 < 60) return 'Bölümler arasında en az 60 takvim günü bulunmalıdır.';
  }
  return null;
}

kapanisKaydet('Ayrılış Tazminatı', async (c, k, karar) => { await c.query(`UPDATE personel_ayrilisi SET odeme_durumu = $2 WHERE kimlik = $1::uuid`, [k.nesne_kimligi, karar === 'Onayla' ? 'Ödemeye Hazır' : 'Bekliyor']); });
kapanisKaydet('Yurt Dışı Görevlendirme', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE yurtdisi_gorev SET durum = 'Onaylandı' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE yurtdisi_gorev SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

export function ikYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const ikMi = (k: string) => rolVar(k, IK);
  const paramOku = async (kod: string) => { const r = (await b.db.query(`SELECT deger FROM ik_parametresi WHERE kod = $1`, [kod])).rows[0]; return r ? Number(r.deger) : null; };

  s.get('/ik/yetki', oturumlu, async (i) => ({ ik: await ikMi(i.oturum!.kullanici), isg: await rolVar(i.oturum!.kullanici, [ISG]), tid: await rolVar(i.oturum!.kullanici, [TID]) }));
  s.get('/ik/personel', oturumlu, async (i, y) => {
    if (!(await ikMi(i.oturum!.kullanici))) return y.code(403).send({ hata: 'Personel kayıtlarını İnsan Kaynakları görür.' });
    return (await b.db.query(`SELECT h.kimlik, h.ad_soyad, k.ise_giris_tarihi::text, k.personel_durumu, k.brut_aylik_tl, k.ek3_yil, k.ek3_serbest_zaman FROM kullanici_hesabi h LEFT JOIN personel_karti k ON k.kullanici_ref = h.kimlik WHERE h.kullanici_grubu = 'LGM İç Rolü' AND h.hesap_durumu = 'Aktif' ORDER BY h.ad_soyad`)).rows;
  });
  s.post('/ik/personel/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { iseGiris?: string; brut?: number; ek3Yil?: number; ek3Serbest?: boolean; vizeBitis?: string; pasaportBitis?: string };
    if (!(await ikMi(o.kullanici))) return y.code(403).send({ hata: 'Personel kaydını İnsan Kaynakları girer.' });
    if (!g.iseGiris) return y.code(400).send({ hata: 'İşe giriş tarihini girmenizi rica ederiz.' });
    if (g.brut !== undefined && !(Number(g.brut) > 0)) return y.code(400).send({ hata: 'Brüt ücreti kontrol etmenizi rica ederiz.' });
    if (!(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1`, [id])).rowCount) return yok(y);
    await b.db.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, brut_aylik_tl, ek3_yil, ek3_serbest_zaman, guncelleyen_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kullanici_ref) DO UPDATE SET ise_giris_tarihi = EXCLUDED.ise_giris_tarihi, brut_aylik_tl = coalesce(EXCLUDED.brut_aylik_tl, personel_karti.brut_aylik_tl), ek3_yil = coalesce(EXCLUDED.ek3_yil, personel_karti.ek3_yil), ek3_serbest_zaman = EXCLUDED.ek3_serbest_zaman, guncelleyen_ref = EXCLUDED.guncelleyen_ref, guncelleme_zamani = now()`, [id, g.iseGiris, g.brut ?? null, g.ek3Yil ?? null, Boolean(g.ek3Serbest), o.kullanici]);
    if (g.vizeBitis !== undefined || g.pasaportBitis !== undefined) await b.db.query(`UPDATE personel_karti SET vize_bitis = coalesce($2, vize_bitis), pasaport_bitis = coalesce($3, pasaport_bitis) WHERE kullanici_ref = $1`, [id, g.vizeBitis || null, g.pasaportBitis || null]); // D-025
    await (await import('./uyum.js')).uyumOlay(b.db, 'personel_kaydi', 'Personel', id); // YG-1546
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Personel Kartı', nesneTuru: 'Personel', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    await esikKontrol(b.db);
    return { tamam: true };
  });
  s.post('/ik/parametre', oturumlu, async (i, y) => { // Kıdem tavanı resmî tutardan İK Müdürü, harcırah TİD girer; sistem tutar uydurmaz.
    const o = i.oturum!; const g = (i.body ?? {}) as { kod?: string; deger?: number };
    const yetki = g.kod === 'kidem_tavani_tl' ? IKM : g.kod === 'harcirah_gunluk_eur' ? TID : null;
    if (!yetki || !(Number(g.deger) > 0)) return y.code(400).send({ hata: 'Parametre ve tutarı girmenizi rica ederiz.' });
    if (!(await rolVar(o.kullanici, [yetki]))) return y.code(403).send({ hata: `Bu tutarı ${yetki} girer.` });
    await b.db.query(`INSERT INTO ik_parametresi (kod, deger, giren_ref) VALUES ($1,$2,$3) ON CONFLICT (kod) DO UPDATE SET deger = EXCLUDED.deger, giren_ref = EXCLUDED.giren_ref, zaman = now()`, [g.kod, g.deger, o.kullanici]);
    return { tamam: true };
  });

  // YG-941, YG-944: İSG eğitimi çok tehlikeli sınıfta en az 16 saat, bir yıl geçerli; saha personeline tesis oryantasyonu.
  s.post('/ik/egitim', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { personel?: string; tur?: string; ad?: string; saat?: number; tesis?: string; tamamlanma?: string; gecerlilik?: string };
    if (!(await rolVar(o.kullanici, [...IK, ISG]))) return y.code(403).send({ hata: 'Eğitim kaydını İnsan Kaynakları veya İSG Sorumlusu girer.' });
    if (!g.personel || !['İSG', 'Tesis Oryantasyonu', 'Mesleki Belge', 'Diğer'].includes(g.tur ?? '') || !g.ad?.trim() || !g.tamamlanma) return y.code(400).send({ hata: 'Personel, tür, ad ve tamamlanma tarihini girmenizi rica ederiz.' });
    if (g.tur === 'İSG' && !(Number(g.saat) >= 16)) return y.code(409).send({ hata: 'Çok tehlikeli sınıfta İSG eğitimi en az 16 saattir.' });
    if (g.tur === 'Tesis Oryantasyonu' && !g.tesis?.trim()) return y.code(400).send({ hata: 'Tesisi yazmanızı rica ederiz.' });
    const son = g.tur === 'İSG' ? gunStr(new Date(new Date(g.tamamlanma).getTime() + 365 * 86_400_000)) : g.gecerlilik || null;
    const r = await b.db.query(`INSERT INTO egitim_kaydi (personel_ref, tur, ad, saat, tesis, tamamlanma_tarihi, gecerlilik_sonu, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [g.personel, g.tur, g.ad.trim(), g.saat ?? null, g.tesis?.trim() || null, g.tamamlanma, son, o.kullanici]);
    return { kimlik: r.rows[0].kimlik, gecerlilikSonu: son };
  });

  // YG-953, YG-957, YG-1492: puantaj; haftalık 45 saat üstü fazla çalışma; Ek-3 ve 270 saat sınırı; nöbette dinlenme kontrolü yok, fiilî çalışma sayılır.
  s.post('/puantaj', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { personel?: string; tarih?: string; gunTuru?: string; giris?: string; cikis?: string; nobetFiili?: number };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    const k = g.personel ?? o.kullanici; const ik = await ikMi(o.kullanici);
    if (k !== o.kullanici && !ik) return y.code(403).send({ hata: 'Başka personelin kaydını İnsan Kaynakları girer.' });
    if (!g.tarih || !['Çalışma', 'Hafta tatili', 'Resmî tatil', 'Devamsızlık'].includes(g.gunTuru ?? '')) return y.code(400).send({ hata: 'Tarih ve gün türünü girmenizi rica ederiz.' });
    if (g.gunTuru === 'Devamsızlık' && !ik) return y.code(403).send({ hata: 'Devamsızlığı İnsan Kaynakları girer.' });
    if (g.giris && g.cikis && g.cikis <= g.giris) return y.code(400).send({ hata: 'Çıkış saati girişten sonra olmalıdır.' });
    const var0 = (await b.db.query(`SELECT izin_ref, bordro_aktarim_zamani FROM puantaj_kaydi WHERE personel_ref = $1 AND tarih = $2`, [k, g.tarih])).rows[0];
    if (var0?.izin_ref) return y.code(409).send({ hata: 'Bu gün izin onayından işlenmiştir.' });
    if (var0?.bordro_aktarim_zamani) return y.code(409).send({ hata: 'Bordroya aktarılan kayıt değiştirilemez.' });
    const nobet = Math.max(0, Number(g.nobetFiili ?? 0)); const net = netDakika(g.giris, g.cikis, nobet);
    if (net - nobet > GUNLUK_DK) return y.code(409).send({ hata: 'Günlük çalışma 11 saati aşamaz.' });
    const onceki = (await b.db.query(`SELECT coalesce(sum(net_dakika), 0) n, coalesce(sum(fazla_dakika), 0) f FROM puantaj_kaydi WHERE personel_ref = $1 AND date_trunc('week', tarih) = date_trunc('week', $2::date) AND tarih <> $2`, [k, g.tarih])).rows[0];
    const fazla = Math.max(0, Number(onceki.n) + net - HAFTALIK_DK - Number(onceki.f));
    if (fazla > 0) {
      const kart = (await b.db.query(`SELECT ek3_yil FROM personel_karti WHERE kullanici_ref = $1`, [k])).rows[0]; const yil = Number(g.tarih.slice(0, 4));
      if (kart?.ek3_yil !== yil) return y.code(409).send({ hata: `Haftalık 45 saati aşan çalışma için ${yil} yılı Ek-3 onayı bekleniyor.` });
      const top = Number((await b.db.query(`SELECT coalesce(sum(fazla_dakika), 0) f FROM puantaj_kaydi WHERE personel_ref = $1 AND EXTRACT(YEAR FROM tarih) = $2 AND tarih <> $3`, [k, yil, g.tarih])).rows[0].f);
      if (top + fazla > YILLIK_FAZLA_DK) return y.code(409).send({ hata: 'Yıllık fazla çalışma 270 saati aşamaz.' });
    }
    await b.db.query(`INSERT INTO puantaj_kaydi (personel_ref, tarih, gun_turu, giris_saati, cikis_saati, net_dakika, nobet_fiili_dakika, fazla_dakika, onaylayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (personel_ref, tarih) DO UPDATE SET gun_turu = EXCLUDED.gun_turu, giris_saati = EXCLUDED.giris_saati, cikis_saati = EXCLUDED.cikis_saati, net_dakika = EXCLUDED.net_dakika, nobet_fiili_dakika = EXCLUDED.nobet_fiili_dakika, fazla_dakika = EXCLUDED.fazla_dakika, onaylayan_ref = EXCLUDED.onaylayan_ref`, [k, g.tarih, g.gunTuru, g.giris ?? null, g.cikis ?? null, net, nobet, fazla, ik ? o.kullanici : null]);
    return { netDakika: net, fazlaDakika: fazla };
  });
  s.get('/puantaj/ozet', oturumlu, async (i, y) => {
    if (!(await ikMi(i.oturum!.kullanici))) return y.code(403).send({ hata: 'Özeti İnsan Kaynakları görür.' });
    const ay = (i.query as { ay?: string }).ay; if (!/^\d{4}-\d{2}$/.test(ay ?? '')) return y.code(400).send({ hata: 'Ayı YYYY-AA biçiminde girmenizi rica ederiz.' });
    const r = (await b.db.query(`SELECT h.kimlik, h.ad_soyad, sum(p.net_dakika)::int net, sum(p.fazla_dakika)::int fazla, count(*) FILTER (WHERE p.gun_turu = 'İzin')::int izin, count(*) FILTER (WHERE p.gun_turu = 'Devamsızlık')::int devamsizlik, bool_and(p.bordro_aktarim_zamani IS NOT NULL) aktarildi, k.brut_aylik_tl, coalesce(k.ek3_serbest_zaman, false) serbest FROM puantaj_kaydi p JOIN kullanici_hesabi h ON h.kimlik = p.personel_ref LEFT JOIN personel_karti k ON k.kullanici_ref = p.personel_ref WHERE to_char(p.tarih, 'YYYY-MM') = $1 GROUP BY h.kimlik, h.ad_soyad, k.brut_aylik_tl, k.ek3_serbest_zaman ORDER BY h.ad_soyad`, [ay])).rows;
    // YG-1492: %50 zamlı ücret veya her saat için 1,5 saat serbest zaman; saat ücreti aylık brüt / 225.
    return r.map((x) => ({ ...x, serbestDakika: x.serbest ? Math.round(x.fazla * 1.5) : 0, fazlaUcretTl: !x.serbest && x.brut_aylik_tl ? R2((x.fazla / 60) * (Number(x.brut_aylik_tl) / 225) * 1.5) : 0 }));
  });
  s.post('/puantaj/bordro', oturumlu, async (i, y) => {
    if (!(await ikMi(i.oturum!.kullanici))) return y.code(403).send({ hata: 'Aktarımı İnsan Kaynakları yapar.' });
    const ay = ((i.body ?? {}) as { ay?: string }).ay; if (!/^\d{4}-\d{2}$/.test(ay ?? '')) return y.code(400).send({ hata: 'Ayı YYYY-AA biçiminde girmenizi rica ederiz.' });
    const r = await b.db.query(`UPDATE puantaj_kaydi SET bordro_aktarim_zamani = now() WHERE to_char(tarih, 'YYYY-MM') = $1 AND bordro_aktarim_zamani IS NULL`, [ay]);
    return { adet: r.rowCount };
  });

  // YG-954, Yönetmelik 13–15: sözlü uyarı savunmasız kaydedilir; diğerlerinde en az 2 iş günü savunma süresi; süresinde gelmezse vazgeçilmiş sayılır.
  s.post('/disiplin', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { personel?: string; olayTarihi?: string; konu?: string; kademe?: string; savunmaSon?: string; hizli?: boolean; ogrenme?: string };
    if (!g.personel || !g.olayTarihi || !g.konu?.trim() || !['Sözlü Uyarı', 'Yazılı Uyarı', 'Ücret Kesme', 'Fesih'].includes(g.kademe ?? '')) return y.code(400).send({ hata: 'Personel, olay tarihi, konu ve kademeyi girmenizi rica ederiz.' });
    const ik = await ikMi(o.kullanici);
    if (g.kademe === 'Sözlü Uyarı') { if (!ik && (await birimAmiri(b.db, g.personel)) !== o.kullanici) return y.code(403).send({ hata: 'Sözlü uyarıyı Birim Amiri kaydeder.' }); }
    else {
      if (!ik) return y.code(403).send({ hata: 'Disiplin kaydını İnsan Kaynakları açar.' });
      if (!g.savunmaSon) return y.code(400).send({ hata: 'Savunma son tarihini girmenizi rica ederiz.' });
      const asgari = await isGunuSonu(b.db, new Date(new Date().toISOString().slice(0, 10)), 2);
      if (new Date(g.savunmaSon) < new Date(gunStr(asgari))) return y.code(409).send({ hata: 'Savunma için en az iki iş günü süre verilir.' });
      if (g.hizli && !g.ogrenme) return y.code(400).send({ hata: 'Fiilin öğrenildiği tarihi girmenizi rica ederiz.' });
    }
    const soz = g.kademe === 'Sözlü Uyarı';
    const r = (await b.db.query(`INSERT INTO disiplin_kaydi (personel_ref, olay_tarihi, ogrenme_tarihi, hizli_yol, konu, kademe, savunma_son, karar, karar_veren_ref, karar_tarihi, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`, [g.personel, g.olayTarihi, g.ogrenme ?? null, Boolean(g.hizli), g.konu.trim(), g.kademe, g.savunmaSon ?? null, soz ? 'Sözlü Uyarı' : null, soz ? o.kullanici : null, soz ? gunStr(new Date()) : null, o.kullanici])).rows[0];
    if (!soz) await bildir(b.db, { olay: `disiplin-savunma:${r.kimlik}`, kullanicilar: [g.personel], baslik: 'Savunmanız Rica Olunur', ozet: `Son tarih: ${g.savunmaSon}`, oncelik: 'Yüksek' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Disiplin Kaydı', nesneTuru: 'Disiplin', nesneKimligi: r.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });
  s.get('/disiplin', oturumlu, async (i, y) => { // Yönetmelik 16.1: yalnız yetkili roller.
    if (!(await rolVar(i.oturum!.kullanici, [...IK, HUD, GMY]))) return y.code(403).send({ hata: 'Disiplin kayıtlarına yalnız yetkili roller erişir.' });
    return (await b.db.query(`SELECT d.kimlik, h.ad_soyad, d.olay_tarihi::text, d.konu, d.kademe, d.savunma_son::text, d.savunma, d.karar, d.karar_tarihi::text, d.itiraz, d.itiraz_sonucu FROM disiplin_kaydi d JOIN kullanici_hesabi h ON h.kimlik = d.personel_ref ORDER BY d.zaman DESC LIMIT 200`)).rows;
  });
  s.get('/disiplin/benim', oturumlu, async (i) => (await b.db.query(`SELECT kimlik, olay_tarihi::text, konu, kademe, savunma_son::text, savunma, karar, karar_tarihi::text, itiraz FROM disiplin_kaydi WHERE personel_ref = $1 ORDER BY zaman DESC`, [i.oturum!.kullanici])).rows);
  s.post('/disiplin/:id/savunma', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const m = ((i.body ?? {}) as { metin?: string }).metin?.trim();
    if (!UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT savunma_son, savunma, karar FROM disiplin_kaydi WHERE kimlik = $1 AND personel_ref = $2`, [id, o.kullanici])).rows[0];
    if (!d) return yok(y);
    if (!m) return y.code(400).send({ hata: 'Savunmanızı yazmanızı rica ederiz.' });
    if (d.savunma || d.karar) return y.code(409).send({ hata: 'Savunmanız alınmıştır.' });
    await b.db.query(`UPDATE disiplin_kaydi SET savunma = $2, savunma_zamani = now() WHERE kimlik = $1`, [id, m]);
    return { tamam: true };
  });
  s.post('/disiplin/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; gundelik?: number };
    if (!UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT * FROM disiplin_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!d) return yok(y);
    if (d.kademe === 'Fesih' ? !(await rolVar(o.kullanici, ['CEO'])) : !(await rolVar(o.kullanici, [IKM]))) return y.code(403).send({ hata: d.kademe === 'Fesih' ? 'Fesih kararını CEO verir.' : 'Kurul kararını İnsan Kaynakları Müdürü kaydeder.' });
    if (d.karar) return y.code(409).send({ hata: 'Karar kaydedilmiştir.' });
    if (!g.karar?.trim()) return y.code(400).send({ hata: 'Kararı yazmanızı rica ederiz.' });
    if (!d.savunma && new Date(d.savunma_son) >= new Date(gunStr(new Date()))) return y.code(409).send({ hata: 'Savunma alınmadan veya süresi dolmadan karar kaydedilemez.' });
    if (d.kademe === 'Ücret Kesme' && !(Number(g.gundelik) > 0 && Number(g.gundelik) <= 2)) return y.code(409).send({ hata: 'Ücret kesme bir ayda iki gündeliği aşamaz.' });
    if (d.hizli_yol) {
      const son = await isGunuSonu(b.db, new Date(d.ogrenme_tarihi), 6);
      if (new Date() > new Date(son.getTime() + 86_400_000)) return y.code(409).send({ hata: 'Fiilin öğrenilmesinden itibaren 6 iş günü geçmiştir.' });
      if (Date.now() - new Date(d.olay_tarihi).getTime() > 365 * 86_400_000) return y.code(409).send({ hata: 'Fiilin üzerinden bir yıl geçmiştir.' });
    }
    await b.db.query(`UPDATE disiplin_kaydi SET karar = $2, kesinti_gundelik = $3, karar_veren_ref = $4, karar_tarihi = current_date WHERE kimlik = $1`, [id, g.karar.trim(), g.gundelik ?? null, o.kullanici]);
    await bildir(b.db, { olay: `disiplin-karar:${id}`, kullanicilar: [d.personel_ref], baslik: 'Disiplin Kararı Tebliği', ozet: '5 iş günü içinde itiraz edebilirsiniz.', oncelik: 'Yüksek' });
    return { tamam: true };
  });
  s.post('/disiplin/:id/itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const m = ((i.body ?? {}) as { metin?: string }).metin?.trim();
    if (!UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT karar_tarihi, itiraz, kademe FROM disiplin_kaydi WHERE kimlik = $1 AND personel_ref = $2 AND karar IS NOT NULL`, [id, o.kullanici])).rows[0];
    if (!d) return yok(y);
    if (!m) return y.code(400).send({ hata: 'İtiraz gerekçenizi yazmanızı rica ederiz.' });
    if (d.itiraz) return y.code(409).send({ hata: 'İtirazınız alınmıştır.' });
    const son = await isGunuSonu(b.db, new Date(d.karar_tarihi), 5);
    if (new Date() > new Date(son.getTime() + 86_400_000)) return y.code(409).send({ hata: 'Beş iş günlük itiraz süresi dolmuştur.' });
    await b.db.query(`UPDATE disiplin_kaydi SET itiraz = $2, itiraz_zamani = now() WHERE kimlik = $1`, [id, m]);
    await kartAc(b.db, { tur: 'Disiplin İtirazı', kategori: 'islem', baslik: `Disiplin İtirazı · ${d.kademe}`, oncelik: 'Yüksek', sahipRol: await rolId(b.db, GMY), nesneTuru: 'Disiplin', nesneKimligi: id }); // YG-952 gereği kart içerik taşımaz.
    return { durum: 'İtiraz Alındı' };
  });
  s.post('/disiplin/:id/itiraz-karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const m = ((i.body ?? {}) as { sonuc?: string }).sonuc?.trim();
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [GMY]))) return y.code(403).send({ hata: 'İtirazı Genel Müdür Yardımcısı karara bağlar.' });
    if (!m) return y.code(400).send({ hata: 'Sonucu yazmanızı rica ederiz.' });
    const r = await b.db.query(`UPDATE disiplin_kaydi SET itiraz_sonucu = $2 WHERE kimlik = $1 AND itiraz IS NOT NULL AND itiraz_sonucu IS NULL RETURNING personel_ref`, [id, m]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Karar bekleyen itiraz bulunmamaktadır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Disiplin İtirazı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await bildir(b.db, { olay: `disiplin-itiraz:${id}`, kullanicilar: [r.rows[0].personel_ref], baslik: 'Disiplin İtirazı Sonucu', ozet: 'Sonuç kaydınıza işlendi.' });
    return { tamam: true };
  });

  // YG-975, YG-977–979, YG-1479: ayrılış; devir listesi otomatik çıkar; tazminat tüm adımlar bitince onaya gider.
  const ayrilisGetir = async (id: string) => UUID.test(id) ? (await b.db.query(`SELECT a.*, k.ise_giris_tarihi::text giris, k.brut_aylik_tl, h.ad_soyad FROM personel_ayrilisi a JOIN kullanici_hesabi h ON h.kimlik = a.personel_ref LEFT JOIN personel_karti k ON k.kullanici_ref = a.personel_ref WHERE a.kimlik = $1`, [id])).rows[0] : undefined;
  const ayrilisEngeli = async (a: { kimlik: string; tur: string; dilekce_belge: string | null; cihaz_beyan_zamani: unknown; cihaz_onay_ref: string | null; gizlilik_okundu_zamani: unknown }): Promise<string | null> => {
    if ((await b.db.query(`SELECT 1 FROM ayrilis_devri WHERE ayrilis_ref = $1 AND durum = 'Bekliyor' LIMIT 1`, [a.kimlik])).rowCount) return 'Devir listesi tamamlanmadı.';
    if (!a.cihaz_beyan_zamani || !a.cihaz_onay_ref) return 'Cihaz iadesi beyanı ve teslim onayı bekleniyor.';
    if (!a.gizlilik_okundu_zamani) return 'Gizlilik hatırlatmasının okundu onayı bekleniyor.';
    if (a.tur === 'İstifa' && !a.dilekce_belge) return 'İmzalı istifa dilekçesi bekleniyor.';
    return null;
  };
  s.post('/ayrilis', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { personel?: string; tur?: string; bildirim?: string; son?: string; mutabakat?: boolean; dilekce?: string };
    if (!(await ikMi(o.kullanici))) return y.code(403).send({ hata: 'Ayrılışı İnsan Kaynakları girer.' });
    if (!g.personel || !['İstifa', 'İşveren Feshi', 'Haklı Fesih (25/II)', 'Emeklilik', 'Askerlik', 'Evlilik', 'Ölüm', 'Mutabakat'].includes(g.tur ?? '') || !g.bildirim || !g.son || g.son < g.bildirim) return y.code(400).send({ hata: 'Personel, tür, bildirim tarihi ve son iş gününü girmenizi rica ederiz.' });
    if (!(await b.db.query(`SELECT 1 FROM personel_karti WHERE kullanici_ref = $1`, [g.personel])).rowCount) return y.code(409).send({ hata: 'Personel kartı bekleniyor.' });
    if ((await b.db.query(`SELECT 1 FROM personel_ayrilisi WHERE personel_ref = $1 AND durum = 'Açık'`, [g.personel])).rowCount) return y.code(409).send({ hata: 'Açık ayrılış kaydı vardır.' });
    const a = (await b.db.query(`INSERT INTO personel_ayrilisi (personel_ref, tur, bildirim_tarihi, son_is_gunu, sure_mutabakati, dilekce_belge, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [g.personel, g.tur, g.bildirim, g.son, Boolean(g.mutabakat), g.dilekce ?? null, o.kullanici])).rows[0];
    for (const r of (await b.db.query(`SELECT e.kimlik, e.rol, d.dosya_no FROM dosya_ekibi_atamasi e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kullanici_ref = $1 AND e.bitis_zamani IS NULL`, [g.personel])).rows) await b.db.query(`INSERT INTO ayrilis_devri (ayrilis_ref, tur, nesne, aciklama) VALUES ($1,'Dosya',$2,$3)`, [a.kimlik, r.kimlik, `${r.dosya_no} · ${r.rol}`]);
    for (const r of (await b.db.query(`SELECT kimlik, baslik FROM is_karti WHERE sahip_kullanici_ref = $1 AND durum = 'Bekliyor'`, [g.personel])).rows) await b.db.query(`INSERT INTO ayrilis_devri (ayrilis_ref, tur, nesne, aciklama) VALUES ($1,'Görev',$2,$3)`, [a.kimlik, r.kimlik, r.baslik]);
    for (const r of (await b.db.query(`SELECT x.kimlik, x.rol_adi FROM rol_atamasi t JOIN rol x ON x.kimlik = t.rol_ref WHERE t.kullanici_ref = $1 AND t.atama_durumu = 'Aktif'`, [g.personel])).rows) await b.db.query(`INSERT INTO ayrilis_devri (ayrilis_ref, tur, nesne, aciklama) VALUES ($1,'Rol',$2,$3)`, [a.kimlik, r.kimlik, r.rol_adi]);
    await b.db.query(`UPDATE personel_karti SET personel_durumu = 'Ayrılıyor' WHERE kullanici_ref = $1`, [g.personel]);
    await bildir(b.db, { olay: `ayrilis-gizlilik:${a.kimlik}`, kullanicilar: [g.personel], baslik: 'Gizlilik Yükümlülüğü Hatırlatması', ozet: 'Okuduğunuzu onaylamanızı rica ederiz.' }); // YG-932
    const amir = await birimAmiri(b.db, g.personel);
    if (amir) await kartAc(b.db, { tur: 'Personel Devir Listesi', kategori: 'islem', baslik: 'Personel Devir Listesi', ozet: `Son iş günü: ${g.son}`, oncelik: 'Yüksek', sonZaman: new Date(g.son), sahipKullanici: amir, nesneTuru: 'Ayrılış', nesneKimligi: a.kimlik });
    return { kimlik: a.kimlik };
  });
  const ayrilisGorur = async (k: string, a: { personel_ref: string }) => k === a.personel_ref || await ikMi(k) || await rolVar(k, [GMY]) || (await birimAmiri(b.db, a.personel_ref)) === k;
  s.get('/ayrilis', oturumlu, async (i) => {
    const o = i.oturum!; const ik = await ikMi(o.kullanici); const l = (await b.db.query(`SELECT a.kimlik, a.personel_ref, h.ad_soyad, a.tur, a.son_is_gunu::text, a.durum, a.odeme_durumu, a.cihaz_beyan_zamani, a.cihaz_onay_ref, a.gizlilik_okundu_zamani FROM personel_ayrilisi a JOIN kullanici_hesabi h ON h.kimlik = a.personel_ref ORDER BY a.zaman DESC LIMIT 100`)).rows;
    const s2 = []; for (const a of l) if (ik || await ayrilisGorur(o.kullanici, a)) s2.push({ ...a, benim: a.personel_ref === o.kullanici });
    return s2;
  });
  s.get('/ayrilis/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const a = await ayrilisGetir((i.params as { id: string }).id);
    if (!a || !(await ayrilisGorur(o.kullanici, a))) return yok(y);
    const devir = (await b.db.query(`SELECT kimlik, tur, aciklama, durum FROM ayrilis_devri WHERE ayrilis_ref = $1 ORDER BY tur, aciklama`, [a.kimlik])).rows;
    if (!(await ikMi(o.kullanici)) && !(await rolVar(o.kullanici, [GMY]))) return { devir, engel: await ayrilisEngeli(a) };
    const brut = a.brut_aylik_tl ? Number(a.brut_aylik_tl) : null; const tavan = await paramOku('kidem_tavani_tl'); const son = gunStr(new Date(a.son_is_gunu)); const bil = gunStr(new Date(a.bildirim_tarihi));
    const ih = brut ? ihbarTazminati({ giris: a.giris, bildirim: bil, son, brutAylik: brut, tur: a.tur, mutabakat: a.sure_mutabakati }) : { hafta: ihbarHafta(a.giris, son), eksikGun: 0, tutar: 0, odeyen: null };
    return { devir, engel: await ayrilisEngeli(a), ihbar: ih, kidem: brut && tavan ? kidemTazminati({ giris: a.giris, son, brutAylik: brut, tavan, tur: a.tur }) : null, uyari: !brut ? 'Brüt ücret bekleniyor.' : !tavan ? 'Kıdem tazminatı tavanı bekleniyor.' : null, odemeDurumu: a.odeme_durumu };
  });
  s.post('/ayrilis-devir/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const yeni = ((i.body ?? {}) as { devralan?: string }).devralan;
    if (!UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT v.*, a.personel_ref FROM ayrilis_devri v JOIN personel_ayrilisi a ON a.kimlik = v.ayrilis_ref WHERE v.kimlik = $1`, [id])).rows[0];
    if (!d) return yok(y);
    if ((await birimAmiri(b.db, d.personel_ref)) !== o.kullanici && !(await ikMi(o.kullanici))) return y.code(403).send({ hata: 'Devri Birim Amiri yapar.' });
    if (d.durum !== 'Bekliyor') return y.code(409).send({ hata: 'Bu kalem devredilmiştir.' });
    if (!yeni || yeni === d.personel_ref) return y.code(400).send({ hata: 'Devralan kişiyi seçmenizi rica ederiz.' });
    if (d.tur === 'Dosya') await dosyaDevret(b.db, d.nesne, yeni, o.kullanici);
    else if (d.tur === 'Görev') await b.db.query(`UPDATE is_karti SET sahip_kullanici_ref = $2 WHERE kimlik::text = $1 AND durum = 'Bekliyor'`, [d.nesne, yeni]);
    await b.db.query(`UPDATE ayrilis_devri SET durum = 'Devredildi', devralan_ref = $2, zaman = now() WHERE kimlik = $1`, [id, yeni]);
    return { tamam: true };
  });
  s.post('/ayrilis/:id/beyan', oturumlu, async (i, y) => { // YG-932, YG-980: imza yok; personel beyanı, gizlilik okundu.
    const o = i.oturum!; const a = await ayrilisGetir((i.params as { id: string }).id); const g = (i.body ?? {}) as { cihaz?: string; gizlilik?: boolean };
    if (!a || a.personel_ref !== o.kullanici) return yok(y);
    if (g.gizlilik) await b.db.query(`UPDATE personel_ayrilisi SET gizlilik_okundu_zamani = coalesce(gizlilik_okundu_zamani, now()) WHERE kimlik = $1`, [a.kimlik]);
    if (g.cihaz?.trim()) await b.db.query(`UPDATE personel_ayrilisi SET cihaz_beyani = $2, cihaz_beyan_zamani = now() WHERE kimlik = $1`, [a.kimlik, g.cihaz.trim()]);
    return { tamam: true };
  });
  s.post('/ayrilis/:id/cihaz-onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const a = await ayrilisGetir((i.params as { id: string }).id);
    if (!a) return yok(y);
    if ((await birimAmiri(b.db, a.personel_ref)) !== o.kullanici) return y.code(403).send({ hata: 'Teslim onayını yönetici verir.' });
    if (!a.cihaz_beyan_zamani) return y.code(409).send({ hata: 'Personel beyanı bekleniyor.' });
    await b.db.query(`UPDATE personel_ayrilisi SET cihaz_onay_ref = $2 WHERE kimlik = $1`, [a.kimlik, o.kullanici]);
    return { tamam: true };
  });
  s.post('/ayrilis/:id/derhal-kapat', oturumlu, async (i, y) => { // YG-1052: riskli ayrılış
    const o = i.oturum!; const a = await ayrilisGetir((i.params as { id: string }).id); const g = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!a) return yok(y);
    if (!(await rolVar(o.kullanici, [IKM, HUD]))) return y.code(403).send({ hata: 'Derhal kapatmayı İnsan Kaynakları Müdürü veya Hukuk ve Uyum Direktörü yapar.' });
    if (!g) return y.code(400).send({ hata: 'Gerekçeyi yazmanızı rica ederiz.' });
    await b.db.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Kapalı' WHERE kimlik = $1`, [a.personel_ref]);
    await b.db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [a.personel_ref]);
    await (await import('./mobil.js')).cihazIptal(b.db, a.personel_ref, 'Riskli Ayrılış');
    await hesapKapanisGorevi(b.db, a.kimlik);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Riskli Ayrılışta Hesap Kapatma', nesneTuru: 'Ayrılış', nesneKimligi: a.kimlik, gerekce: g, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/ayrilis/:id/tazminat', oturumlu, async (i, y) => { // YG-979
    const o = i.oturum!; const a = await ayrilisGetir((i.params as { id: string }).id);
    if (!a) return yok(y);
    if (!(await ikMi(o.kullanici))) return y.code(403).send({ hata: 'Tazminat onayını İnsan Kaynakları başlatır.' });
    const e = await ayrilisEngeli(a); if (e) return y.code(409).send({ hata: e });
    if (a.odeme_durumu !== 'Bekliyor') return y.code(409).send({ hata: 'Tazminat onayı başlatılmıştır.' });
    const brut = a.brut_aylik_tl ? Number(a.brut_aylik_tl) : null; const tavan = await paramOku('kidem_tavani_tl');
    if (!brut) return y.code(409).send({ hata: 'Brüt ücret bekleniyor.' });
    if (!tavan) return y.code(409).send({ hata: 'Kıdem tazminatı tavanı bekleniyor.' });
    const son = gunStr(new Date(a.son_is_gunu)); const kd = kidemTazminati({ giris: a.giris, son, brutAylik: brut, tavan, tur: a.tur }); const ih = ihbarTazminati({ giris: a.giris, bildirim: gunStr(new Date(a.bildirim_tarihi)), son, brutAylik: brut, tur: a.tur, mutabakat: a.sure_mutabakati });
    await b.db.query(`UPDATE personel_ayrilisi SET odeme_durumu = 'Onayda' WHERE kimlik = $1`, [a.kimlik]);
    await kartAc(b.db, { tur: 'Ayrılış Tazminatı', baslik: 'Ayrılış Tazminatı Onayı', ozet: `Kıdem ${tl(kd)}; ihbar ${tl(ih.tutar)}${ih.odeyen ? ` (${ih.odeyen} öder)` : ''}`, oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(b.db, GMY)], nesneTuru: 'Ayrılış', nesneKimligi: a.kimlik });
    return { kidem: kd, ihbar: ih };
  });

  // YG-981, YG-1669: iş kazası; LGM'de İK e-SGK 3 iş günü, Çözüm Ortağında belge sayacı.
  s.post('/olay/:id/is-kazasi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { isveren?: string; kurulus?: string; saglikKolluk?: string; sigortaci?: string; saglikVerisi?: boolean };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü') return yok(y);
    const ol = (await b.db.query(`SELECT olusturma_zamani, olay_turu FROM olay_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!ol || ol.olay_turu !== 'İş Kazası') return yok(y);
    if (!['LGM', 'Çözüm Ortağı'].includes(g.isveren ?? '') || !g.saglikKolluk?.trim() || !g.sigortaci?.trim()) return y.code(400).send({ hata: 'İşveren, sağlık/kolluk bildirimi ve sigortacıya ihbar alanları zorunludur.' });
    if (g.isveren === 'Çözüm Ortağı' && (!g.kurulus || !UUID.test(g.kurulus))) return y.code(400).send({ hata: 'Çözüm Ortağını seçmenizi rica ederiz.' });
    const son = await isGunuSonu(b.db, new Date(ol.olusturma_zamani), 3);
    const r = await b.db.query(`INSERT INTO is_kazasi (olay_ref, isveren, kurulus_ref, saglik_kolluk, sigortaci_ihbar, saglik_verisi, bilgi_sinifi, son_zaman, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`, [id, g.isveren, g.isveren === 'LGM' ? null : g.kurulus, g.saglikKolluk.trim(), g.sigortaci.trim(), Boolean(g.saglikVerisi), g.saglikVerisi ? 'Kritik' : 'Gizli', son, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu olayın iş kazası kaydı vardır.' });
    if (g.isveren === 'Çözüm Ortağı') await kartAc(b.db, { tur: 'Bildirim Belgesi Bekleniyor', kategori: 'islem', baslik: 'İş Kazası · Bildirim Belgesi Bekleniyor', oncelik: 'Kritik', sonZaman: son, sahipRol: await rolId(b.db, ISG), nesneTuru: 'Olay', nesneKimligi: id });
    return { sonZaman: son, bilgiSinifi: g.saglikVerisi ? 'Kritik' : 'Gizli' };
  });
  s.get('/is-kazasi', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [...IK, ISG, HUD]))) return y.code(403).send({ hata: 'İş kazası kayıtlarına yalnız yetkili roller erişir.' });
    return (await b.db.query(`SELECT k.olay_ref, k.isveren, u.ticari_unvan, k.son_zaman, k.bilgi_gonderme_zamani, k.sgk_bildirim_tarihi::text, k.bildirim_belge, o.ozet FROM is_kazasi k JOIN olay_kaydi o ON o.kimlik = k.olay_ref LEFT JOIN kurulus u ON u.kimlik = k.kurulus_ref WHERE k.sgk_bildirim_tarihi IS NULL AND k.bildirim_belge IS NULL ORDER BY k.son_zaman`)).rows;
  });
  s.post('/is-kazasi/:id/bilgi-gonder', oturumlu, async (i, y) => { // İSG olay bilgisini İK'ya gönderir.
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [ISG]))) return y.code(403).send({ hata: 'Olay bilgisini İSG Sorumlusu gönderir.' });
    const k = (await b.db.query(`SELECT son_zaman FROM is_kazasi WHERE olay_ref = $1 AND isveren = 'LGM' AND bilgi_gonderme_zamani IS NULL`, [id])).rows[0];
    if (!k) return y.code(409).send({ hata: 'Gönderilecek kayıt bulunmamaktadır.' });
    await b.db.query(`UPDATE is_kazasi SET bilgi_gonderme_zamani = now() WHERE olay_ref = $1`, [id]);
    await kartAc(b.db, { tur: 'İş Kazası SGK Bildirimi', kategori: 'islem', baslik: 'İş Kazası SGK Bildirimi', ozet: 'e-SGK üzerinden 3 iş günü içinde bildiriminiz rica olunur.', oncelik: 'Kritik', sonZaman: k.son_zaman, sahipRol: await rolId(b.db, IKS), nesneTuru: 'Olay', nesneKimligi: id });
    return { tamam: true };
  });
  s.post('/is-kazasi/:id/sgk', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const t = ((i.body ?? {}) as { tarih?: string }).tarih;
    if (!UUID.test(id)) return yok(y);
    if (!(await ikMi(o.kullanici))) return y.code(403).send({ hata: 'Bildirimi İnsan Kaynakları kaydeder.' });
    if (!t) return y.code(400).send({ hata: 'Bildirim tarihini girmenizi rica ederiz.' });
    const r = await b.db.query(`UPDATE is_kazasi SET sgk_bildirim_tarihi = $2 WHERE olay_ref = $1 AND isveren = 'LGM'`, [id, t]);
    if (!r.rowCount) return yok(y);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'İş Kazası SGK Bildirimi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    return { tamam: true };
  });
  s.post('/is-kazasi/:id/belge-iste', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [ISG]))) return y.code(403).send({ hata: 'Belgeyi İSG Sorumlusu ister.' });
    const k = (await b.db.query(`SELECT kurulus_ref FROM is_kazasi WHERE olay_ref = $1 AND isveren = 'Çözüm Ortağı'`, [id])).rows[0];
    if (!k) return yok(y);
    const ku = (await b.db.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [k.kurulus_ref])).rows.map((r) => r.kullanici_ref as string);
    if (ku.length) await bildir(b.db, { olay: `is-kazasi-belge:${id}:${Date.now()}`, kullanicilar: ku, baslik: 'İş Kazası Bildirim Belgesi Bekleniyor', ozet: 'SGK bildirim belgesini yüklemenizi rica ederiz.', oncelik: 'Kritik' });
    await b.db.query(`UPDATE is_kazasi SET belge_isteme_zamani = now() WHERE olay_ref = $1`, [id]);
    return { tamam: true };
  });
  s.post('/firma-portal/is-kazasi/:id/belge', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const belge = ((i.body ?? {}) as { belge?: string }).belge;
    if (!UUID.test(id) || !belge || !UUID.test(belge)) return yok(y);
    const r = await b.db.query(`UPDATE is_kazasi k SET bildirim_belge = $2 FROM kurulus_kullanici u WHERE k.olay_ref = $1 AND u.kurulus_ref = k.kurulus_ref AND u.kullanici_ref = $3`, [id, belge, o.kullanici]);
    if (!r.rowCount) return yok(y);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Bildirim Belgesi Bekleniyor' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    return { tamam: true };
  });

  // YG-1492: yurt dışı görevlendirme; harcırah TİD sabit günlük tutar, onay birim amiri ve GMY.
  s.post('/yurtdisi-gorev', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ulke?: string; baslangic?: string; bitis?: string };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    if (!g.ulke?.trim() || !g.baslangic || !g.bitis || g.bitis < g.baslangic) return y.code(400).send({ hata: 'Ülke ve geçerli tarih aralığını girmenizi rica ederiz.' });
    const gun = await paramOku('harcirah_gunluk_eur');
    if (!gun) return y.code(409).send({ hata: 'Günlük harcırah tutarı bekleniyor.' });
    const n = Math.round((new Date(g.bitis).getTime() - new Date(g.baslangic).getTime()) / 86_400_000) + 1; const top = R2(n * gun);
    const r = (await b.db.query(`INSERT INTO yurtdisi_gorev (personel_ref, ulke, baslangic, bitis, gun, gunluk_eur, harcirah_eur) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [o.kullanici, g.ulke.trim(), g.baslangic, g.bitis, n, gun, top])).rows[0];
    const rl = (await b.db.query(`SELECT rol_ref FROM rol_atamasi WHERE kullanici_ref = $1 AND atama_durumu = 'Aktif' LIMIT 1`, [o.kullanici])).rows[0];
    await kartAc(b.db, { tur: 'Yurt Dışı Görevlendirme', baslik: `Yurt Dışı Görevlendirme · ${g.ulke.trim()}`, ozet: `${n} gün · Harcırah ${top.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} EUR`, hazirlayan: o.kullanici, zincir: [await onayMakami(b.db, rl.rol_ref), await rolId(b.db, GMY)], nesneTuru: 'Yurt Dışı Görevi', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik, gun: n, harcirah: top };
  });
}
