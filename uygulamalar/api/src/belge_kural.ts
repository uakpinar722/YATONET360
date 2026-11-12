import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { Depo, denemeTarayici, type Tarayici } from './depo.js';
import { rolId } from './ihbar.js';
import { kapanisKaydet } from './kapanis.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;
const BIM = 'Bilgi İşlem Müdürü'; const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü';
const ALANLAR = ['belge_tarihi', 'kaynak_kisi'] as const;
export const ALAN_ADI: Record<string, string> = { belge_tarihi: 'Belge tarihi', kaynak_kisi: 'Kaynak kişi' };
type Kural = { zorunlu: string[]; disKapali: string[] };
/** YG-605: tür kuralları bellekte tutulur (erişim denetimi eşzamanlıdır); değişince yenilenir. */
const KURAL = new Map<string, Kural>();
export async function kurallariYukle(db: Db) {
  const r = (await db.query(`SELECT belge_turu, zorunlu_alanlar, dis_kapali_gruplar FROM belge_turu_kurali`)).rows;
  KURAL.clear(); for (const x of r) KURAL.set(x.belge_turu, { zorunlu: x.zorunlu_alanlar, disKapali: x.dis_kapali_gruplar });
}
/** Türün tanımlı dış kapalılığı; grup adı başlangıcıyla eşleşir (ör. "Tesis"). */
export function tanimliKapali(grup: string, tur: string): boolean {
  return (KURAL.get(tur)?.disKapali ?? []).some((g) => grup === g || grup.startsWith(g));
}
/** YG-603, YG-605: türün zorunlu bilgileri eksikse hata metni; zamanı veya kaynağı belli olmayan kanıt kabul edilmez. */
export async function kuralEksigi(db: Db, tur: string, v: Record<string, string | undefined>): Promise<string | null> {
  if (!KURAL.size) await kurallariYukle(db);
  const k = KURAL.get(tur); if (!k) return null;
  const eksik = k.zorunlu.filter((a) => !v[a]?.trim());
  return eksik.length ? `${tur} için zorunlu bilgi: ${eksik.map((a) => ALAN_ADI[a] ?? a).join(', ')}.` : null;
}

/** YG-602: tarayıcıya ulaşılamadığında karantinaya alınan sürümler yeniden taranır; temizse kullanıma açılır, zararlıysa iptal edilir. */
export async function karantinaIsle(b: { db: Pool; depo?: Depo; tarayici?: Tarayici }): Promise<number> {
  const depo = b.depo ?? new Depo(); const tarayici = b.tarayici ?? denemeTarayici; let n = 0;
  for (const s of (await b.db.query(`SELECT kimlik, belge_ref, depo_anahtari FROM belge_surum WHERE durum = 'Karantina' ORDER BY yukleme_zamani LIMIT 20`)).rows) {
    if (String(s.depo_anahtari).startsWith('kritik/')) continue;
    let temiz: boolean;
    try { temiz = await tarayici.temizMi(join(depo.kok, s.depo_anahtari)); } catch { continue; }
    await b.db.query(`UPDATE belge_surum SET durum = $2, tarama_kaynagi = $3 WHERE kimlik = $1 AND durum = 'Karantina'`, [s.kimlik, temiz ? 'Taslak' : 'İptal', tarayici.ad]);
    await izYaz(b.db, { aktor: null, eylem: temiz ? 'Karantinadan Çıktı' : 'Zararlı Dosya Engellendi', nesneTuru: 'belge', nesneKimligi: s.belge_ref, sonuc: temiz ? 'Başarılı' : 'Başarısız' });
    n++;
  }
  return n;
}

kapanisKaydet('Dosya Sınırı Değişikliği', async (c, k, karar, yapan) => {
  const o = (await c.query(`SELECT * FROM dosya_siniri_onerisi WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi])).rows[0]; if (!o) return;
  if (karar === 'Onayla') {
    await c.query(`INSERT INTO dosya_siniri (grup, uzantilar, azami_bayt) VALUES ($1,$2,$3) ON CONFLICT (grup) DO UPDATE SET uzantilar = EXCLUDED.uzantilar, azami_bayt = EXCLUDED.azami_bayt`, [o.grup, o.uzantilar, o.azami_bayt]);
    await c.query(`UPDATE dosya_siniri_onerisi SET durum = 'Onaylandı', karar_veren_ref = $2, karar_zamani = now() WHERE kimlik = $1`, [o.kimlik, yapan]);
  } else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') await c.query(`UPDATE dosya_siniri_onerisi SET durum = 'Reddedildi', karar_veren_ref = $2, karar_zamani = now() WHERE kimlik = $1`, [o.kimlik, yapan]);
});

export function belgeKuralYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[])`, [k, r])).rowCount);
  void kurallariYukle(b.db).catch(() => {});

  s.get('/belge-kurallari', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    return {
      duzenler: await rolde(o.kullanici, [BTD]), oneriVerir: await rolde(o.kullanici, [BIM]),
      turler: (await b.db.query(`SELECT belge_turu, zorunlu_alanlar, dis_kapali_gruplar FROM belge_turu_kurali ORDER BY belge_turu`)).rows,
      sinirlar: (await b.db.query(`SELECT grup, uzantilar, azami_bayt FROM dosya_siniri ORDER BY grup`)).rows,
      oneriler: (await b.db.query(`SELECT kimlik, grup, uzantilar, azami_bayt, gerekce, durum, olusturma_zamani FROM dosya_siniri_onerisi ORDER BY olusturma_zamani DESC LIMIT 20`)).rows,
    };
  });
  // YG-605: tür kuralı BT ve Firma Yönetimi Direktörünce tanımlanır.
  s.post('/belge-kurallari/tur', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; zorunlu?: string[]; disKapali?: string[] };
    if (!(await rolde(o.kullanici, [BTD]))) return yok(y);
    if (!g.tur?.trim()) return y.code(400).send({ hata: 'Belge türü zorunludur.' });
    const zorunlu = (g.zorunlu ?? []).filter((x) => (ALANLAR as readonly string[]).includes(x));
    const kapali = (g.disKapali ?? []).filter((x) => ['İş Birliği Firması', 'Tedarikçi', 'Tesis', 'Yat Sahibi', 'Kurumsal Müşteri', 'Sigorta Şirketi'].includes(x));
    await b.db.query(`INSERT INTO belge_turu_kurali (belge_turu, zorunlu_alanlar, dis_kapali_gruplar, guncelleyen_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (belge_turu) DO UPDATE SET zorunlu_alanlar = EXCLUDED.zorunlu_alanlar, dis_kapali_gruplar = EXCLUDED.dis_kapali_gruplar, guncelleyen_ref = EXCLUDED.guncelleyen_ref, zaman = now()`, [g.tur.trim(), zorunlu, kapali, o.kullanici]);
    await kurallariYukle(b.db);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge Türü Kuralı', nesneTuru: 'Belge Türü', nesneKimligi: g.tur.trim(), yeni: { zorunlu, kapali }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // YG-604: sınır değişikliğini Bilgi İşlem Müdürü önerir, BT ve Firma Yönetimi Direktörü onaylar.
  s.post('/dosya-siniri/oneri', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { grup?: string; uzantilar?: string[]; azamiMb?: number; gerekce?: string };
    if (!(await rolde(o.kullanici, [BIM]))) return yok(y);
    const uz = (g.uzantilar ?? []).map((x) => String(x).trim().toLowerCase().replace(/^\./, '')).filter((x) => /^[a-z0-9]{1,8}$/.test(x));
    if (!g.grup?.trim() || !uz.length || !(Number(g.azamiMb) > 0) || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Grup, uzantılar, azami boyut (MB) ve gerekçe zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM dosya_siniri_onerisi WHERE grup = $1 AND durum = 'Onayda'`, [g.grup.trim()])).rowCount) return y.code(409).send({ hata: 'Bu grup için sonuçlanmamış öneri var.' });
    const r = (await b.db.query(`INSERT INTO dosya_siniri_onerisi (grup, uzantilar, azami_bayt, gerekce, oneren_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.grup.trim(), uz, Math.round(Number(g.azamiMb) * 1_048_576), g.gerekce.trim(), o.kullanici])).rows[0];
    await kartAc(b.db, { tur: 'Dosya Sınırı Değişikliği', baslik: `Dosya sınırı · ${g.grup.trim()}`, ozet: `${uz.join(', ')} · ${g.azamiMb} MB · ${g.gerekce.trim()}`.slice(0, 300), hazirlayan: o.kullanici, zincir: [await rolId(b.db, BTD)], nesneTuru: 'Dosya Sınırı', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik, gonderilecek: BTD };
  });
}
