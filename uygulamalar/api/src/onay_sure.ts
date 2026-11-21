import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { onayMakami, rolSahipleri } from './makam.js';

type Db = Pool | PoolClient;
/** YG-171, YG-172: mesleki kararlar üst kademeye geçmez, kademe atlanmaz. */
export const MESLEKI = new Set(['Kalite Planı', 'Kapsam Cetveli', 'Teknik Rapor']);
const DK: Record<string, string> = { Kritik: 'onay_sure_dk_kritik', Yüksek: 'onay_sure_dk_yuksek', Normal: 'onay_sure_dk_normal', Planlı: 'onay_sure_dk_planli' };

/** YG-172: kalan süreye göre yapılacak adım. Süre 1 saat aşılınca üst kademe. */
export function sureAdimi(oncelik: string, gecenDk: number, sureDk: number, uyariOnceDk?: number | null): 'Uyarı' | 'Süre Doldu' | 'Üst Kademeye Geçti' | null {
  if (gecenDk >= sureDk + 60) return 'Üst Kademeye Geçti';
  if (gecenDk >= sureDk) return 'Süre Doldu';
  return gecenDk >= sureDk - (uyariOnceDk ?? (oncelik === 'Kritik' ? 10 : 30)) ? 'Uyarı' : null; // YG-536: türe özgü uyarı eşiği
}

// YG-536: her adımın beklenen eylemi kayda geçer; kapanış sonucu kart kapanınca (0319) yazılır.
const BEKLENEN: Record<string, string> = { 'Uyarı': 'Makamın kararı (Onaya Gönder, Onayla, Reddet veya Gerekçeyle İade Et)', 'Süre Doldu': 'Makamın gecikmeli kararı; üst makam bilgilendirildi', 'Yeniden Uyarı': 'Makamın kararı (yeniden hatırlatma)', 'Üst Kademeye Geçti': 'Üst makamın kararı veya kademe atlaması' };
const iz = async (db: Db, id: string, kademe: number, adim: string, rol: string) => Boolean((await db.query(`INSERT INTO kart_sure_kaydi (is_ref, kademe, adim, rol_ref, beklenen_eylem) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING adim`, [id, kademe, adim, rol, BEKLENEN[adim] ?? null])).rowCount);

/** YG-172: onaylayana uyarı, üst kademeye bilgi; 1 saat aşımda talep üst kademeye geçer. Mesleki kararda yalnız uyarı; son makam CEO ise uyarı ve CEO Asistanına bilgi. Kayıt performans girdisidir. */
export async function onaySureIsle(db: Pool, simdi = new Date()): Promise<number> {
  const par = new Map((await db.query(`SELECT kod, deger FROM sistem_parametresi WHERE kod LIKE 'onay_sure_dk_%'`)).rows.map((r) => [r.kod as string, Number(r.deger)]));
  const { rows } = await db.query(`SELECT k.kimlik, k.tur, k.baslik, k.oncelik, k.zincir, k.kademe, k.kademe_zamani, r.rol_adi, e.onay_sure_dk, e.uyari_once_dk FROM is_karti k JOIN rol r ON r.kimlik = k.zincir[k.kademe + 1] LEFT JOIN gorev_turu_esigi e ON e.tur = k.tur WHERE k.durum = 'Bekliyor' AND k.kategori = 'onay'`);
  let n = 0;
  for (const k of rows) {
    // YG-1426: kalıcı askıda Direktör kademesi 120 saattir.
    const ozel = k.tur === 'Kalıcı Askı Önerisi' && k.kademe === k.zincir.length - 1 ? 120 * 60 : undefined;
    const adim = sureAdimi(k.oncelik, (simdi.getTime() - new Date(k.kademe_zamani).getTime()) / 60_000, ozel ?? k.onay_sure_dk ?? par.get(DK[k.oncelik]!) ?? 240, k.uyari_once_dk);
    if (!adim) continue;
    const makam = k.zincir[k.kademe] as string; const son = k.kademe === k.zincir.length - 1;
    const sahip = await rolSahipleri(db, makam);
    const anahtar = `${k.kimlik}:${k.kademe}`;
    if (!(await iz(db, k.kimlik, k.kademe, 'Uyarı', makam)) && adim === 'Uyarı') continue;
    if (adim === 'Uyarı') { await bildir(db, { olay: `onay-sure:${anahtar}:u`, kullanicilar: sahip, baslik: `Onay Süresi Dolmak Üzere: ${k.baslik}`, oncelik: k.oncelik }, simdi); n++; continue; }
    const ustRol = son ? (k.rol_adi === 'CEO' ? null : await onayMakami(db, makam)) : (k.zincir[k.kademe + 1] as string);
    if (await iz(db, k.kimlik, k.kademe, 'Süre Doldu', makam)) {
      await bildir(db, { olay: `onay-sure:${anahtar}:d`, kullanicilar: sahip, baslik: `Onay Süresi Doldu: ${k.baslik}`, oncelik: k.oncelik, eposta: true }, simdi);
      const bilgi = ustRol ? await rolSahipleri(db, ustRol) : (await db.query(`SELECT a.kullanici_ref FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE r.rol_adi = 'CEO Asistanı' AND a.atama_durumu = 'Aktif'`)).rows.map((r) => r.kullanici_ref as string);
      await bildir(db, { olay: `onay-sure:${anahtar}:b`, kullanicilar: bilgi, baslik: `Bilgi: Onay Süresi Doldu: ${k.baslik}`, oncelik: k.oncelik }, simdi);
      n++;
    }
    if (adim !== 'Üst Kademeye Geçti') continue;
    if (MESLEKI.has(k.tur) || !ustRol) { // Geçmez, uyarı tekrarlanır (YG-172)
      if (await iz(db, k.kimlik, k.kademe, 'Yeniden Uyarı', makam)) { await bildir(db, { olay: `onay-sure:${anahtar}:r`, kullanicilar: sahip, baslik: `Onay Bekliyor: ${k.baslik}`, oncelik: k.oncelik, eposta: true }, simdi); n++; }
      continue;
    }
    if (!(await iz(db, k.kimlik, k.kademe, 'Üst Kademeye Geçti', makam))) continue;
    await db.query(`UPDATE is_karti SET zincir = CASE WHEN $2::boolean THEN array_append(zincir, $3) ELSE zincir END, kademe = kademe + 1, kademe_zamani = $4 WHERE kimlik = $1`, [k.kimlik, son, ustRol, simdi]);
    await db.query(`INSERT INTO is_karti_adim (is_ref, kademe, karar, gerekce, rol_ref) VALUES ($1,$2,'Süre Aşımıyla Geçti','Onay süresi 1 saat aşıldı',$3)`, [k.kimlik, k.kademe, makam]);
    await bildir(db, { olay: `onay-sure:${anahtar}:g`, kullanicilar: await rolSahipleri(db, ustRol), baslik: `Onayınızı Bekliyor: ${k.baslik}`, oncelik: k.oncelik, eposta: true }, simdi);
    await bildir(db, { olay: `onay-sure:${anahtar}:x`, kullanicilar: sahip, baslik: `Süre Aşımı Nedeniyle Üst Kademeye Geçti: ${k.baslik}`, oncelik: k.oncelik }, simdi);
    n++;
  }
  return n;
}

/** YG-1361: onay dışı görevde süre dolunca önce sorumluya, 24 saat sonra karar merciine (sorumlu rolün onay makamı) beklenen eylem ve hedef zamanla bildirim.
 * Her adım bir kez işlenir (zamanlanmis_is); işlenmiş kartlar sorguya hiç girmez. */
export async function gorevSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(`SELECT k.kimlik, k.baslik, k.oncelik, k.son_zaman, k.sahip_kullanici_ref, k.sahip_rol_ref, coalesce(e.eskalasyon_saat, 24) eskalasyon_saat,
      NOT EXISTS (SELECT 1 FROM zamanlanmis_is z WHERE z.ad = 'gorev-sure-u' AND z.anahtar = k.kimlik::text) u_bekliyor
    FROM is_karti k LEFT JOIN gorev_turu_esigi e ON e.tur = k.tur WHERE k.durum = 'Bekliyor' AND k.kategori = 'gorev' AND k.son_zaman IS NOT NULL AND k.son_zaman < $1
      AND (NOT EXISTS (SELECT 1 FROM zamanlanmis_is z WHERE z.ad = 'gorev-sure-u' AND z.anahtar = k.kimlik::text)
        OR (k.son_zaman < $1::timestamptz - make_interval(hours => coalesce(e.eskalasyon_saat, 24)) AND NOT EXISTS (SELECT 1 FROM zamanlanmis_is z WHERE z.ad = 'gorev-sure-e' AND z.anahtar = k.kimlik::text)))
    ORDER BY k.son_zaman LIMIT 200`, [simdi]);
  let n = 0;
  for (const k of rows) {
    const hedef = new Date(k.son_zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
    const sorumlu = k.sahip_kullanici_ref ? [k.sahip_kullanici_ref as string] : k.sahip_rol_ref ? await rolSahipleri(db, k.sahip_rol_ref) : [];
    if (k.u_bekliyor && (await birKez(db, 'gorev-sure-u', k.kimlik))) {
      if (sorumlu.length) { await bildir(db, { olay: `gorev-sure:${k.kimlik}:u`, kullanicilar: sorumlu, baslik: `Görev Süresi Doldu: ${k.baslik}`, ozet: `Beklenen eylem: görevi tamamlayınız veya engeli bildiriniz · Hedef zaman: ${hedef}`, oncelik: k.oncelik, eposta: true }, simdi); n++; }
    }
    if (simdi.getTime() - new Date(k.son_zaman).getTime() < Number(k.eskalasyon_saat) * 3_600_000 || !sorumlu.length) continue; // YG-536: türe özgü eskalasyon
    if (!(await birKez(db, 'gorev-sure-e', k.kimlik))) continue;
    const rol = (k.sahip_rol_ref as string | null) ?? (await db.query(`SELECT rol_ref FROM rol_atamasi WHERE kullanici_ref = $1 AND atama_durumu = 'Aktif' LIMIT 1`, [sorumlu[0]])).rows[0]?.rol_ref;
    if (!rol) continue;
    const mercii = (await rolSahipleri(db, await onayMakami(db, rol))).filter((x) => !sorumlu.includes(x));
    if (!mercii.length) continue;
    const ad = (await db.query(`SELECT string_agg(ad_soyad, ', ') a FROM kullanici_hesabi WHERE kimlik = ANY($1::text[])`, [sorumlu])).rows[0].a;
    await bildir(db, { olay: `gorev-sure:${k.kimlik}:e`, kullanicilar: mercii, baslik: `Geciken Görev: ${k.baslik}`, ozet: `Sorumlu: ${ad} · Hedef zaman: ${hedef} · Beklenen eylem: görevin tamamlanmasını sağlayınız veya yeniden atayınız`, oncelik: k.oncelik, eposta: true }, simdi);
    n++;
  }
  return n;
}
