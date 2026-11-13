import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { onayMakami, rolSahipleri } from './makam.js';

type Db = Pool | PoolClient;
/** YG-171, YG-172: mesleki kararlar üst kademeye geçmez, kademe atlanmaz. */
export const MESLEKI = new Set(['Kalite Planı', 'Kapsam Cetveli', 'Teknik Rapor']);
const DK: Record<string, string> = { Kritik: 'onay_sure_dk_kritik', Yüksek: 'onay_sure_dk_yuksek', Normal: 'onay_sure_dk_normal', Planlı: 'onay_sure_dk_planli' };

/** YG-172: kalan süreye göre yapılacak adım. Süre 1 saat aşılınca üst kademe. */
export function sureAdimi(oncelik: string, gecenDk: number, sureDk: number): 'Uyarı' | 'Süre Doldu' | 'Üst Kademeye Geçti' | null {
  if (gecenDk >= sureDk + 60) return 'Üst Kademeye Geçti';
  if (gecenDk >= sureDk) return 'Süre Doldu';
  return gecenDk >= sureDk - (oncelik === 'Kritik' ? 10 : 30) ? 'Uyarı' : null;
}

const iz = async (db: Db, id: string, kademe: number, adim: string, rol: string) => Boolean((await db.query(`INSERT INTO kart_sure_kaydi (is_ref, kademe, adim, rol_ref) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING adim`, [id, kademe, adim, rol])).rowCount);

/** YG-172: onaylayana uyarı, üst kademeye bilgi; 1 saat aşımda talep üst kademeye geçer. Mesleki kararda yalnız uyarı; son makam CEO ise uyarı ve CEO Asistanına bilgi. Kayıt performans girdisidir. */
export async function onaySureIsle(db: Pool, simdi = new Date()): Promise<number> {
  const par = new Map((await db.query(`SELECT kod, deger FROM sistem_parametresi WHERE kod LIKE 'onay_sure_dk_%'`)).rows.map((r) => [r.kod as string, Number(r.deger)]));
  const { rows } = await db.query(`SELECT k.kimlik, k.tur, k.baslik, k.oncelik, k.zincir, k.kademe, k.kademe_zamani, r.rol_adi FROM is_karti k JOIN rol r ON r.kimlik = k.zincir[k.kademe + 1] WHERE k.durum = 'Bekliyor' AND k.kategori = 'onay'`);
  let n = 0;
  for (const k of rows) {
    // YG-1426: kalıcı askıda Direktör kademesi 120 saattir.
    const ozel = k.tur === 'Kalıcı Askı Önerisi' && k.kademe === k.zincir.length - 1 ? 120 * 60 : undefined;
    const adim = sureAdimi(k.oncelik, (simdi.getTime() - new Date(k.kademe_zamani).getTime()) / 60_000, ozel ?? par.get(DK[k.oncelik]!) ?? 240);
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
