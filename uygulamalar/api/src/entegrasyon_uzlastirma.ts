import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const YETKILI = ['Bilgi İşlem Müdürü', 'Sistem Yöneticisi', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
const DURUMLAR = ['Zaman Aşımı', 'Kısmi Başarı', 'Tekrar', 'Çelişki', 'Hata'] as const;

/** Hata sorumlusu metni rol adıysa görev o role, değilse Bilgi İşlem Müdürüne düşer. */
async function sorumluRol(db: Db, ent: string): Promise<string> {
  const r = (await db.query(`SELECT r.kimlik FROM entegrasyon_tanimi e JOIN rol r ON r.rol_adi = e.hata_sorumlusu WHERE e.kimlik = $1`, [ent])).rows[0]?.kimlik;
  return r ?? (await db.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Bilgi İşlem Müdürü'`)).rows[0].kimlik;
}

/**
 * YG-1311: teknik teslim yetmez; her entegrasyon kaydı beklenen iş sonucuyla (iş emri, belge, bildirim, ana veri) doğrulanır.
 * Zaman aşımı, kısmi başarı, tekrar, çelişki ve hata kaydı karantinaya alınır, hata sorumlusuna manuel uzlaştırma görevi açılır.
 */
export async function entegrasyonSonucu(db: Db, g: { entegrasyon: string; disKimlik: string; beklenen: string; sonucRef?: string | null; durum?: (typeof DURUMLAR)[number]; hata?: string }): Promise<string> {
  const tekrar = (await db.query(`SELECT kimlik FROM entegrasyon_kaydi WHERE entegrasyon_ref = $1 AND dis_kimlik = $2`, [g.entegrasyon, g.disKimlik])).rows[0];
  const durum = tekrar ? 'Tekrar' : g.durum ?? (g.sonucRef ? null : 'Kısmi Başarı');
  const k = (await db.query(`INSERT INTO entegrasyon_kaydi (entegrasyon_ref, dis_kimlik, beklenen_sonuc, sonuc_ref, durum, hata) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [g.entegrasyon, tekrar ? `${g.disKimlik}#${Date.now()}` : g.disKimlik, g.beklenen, g.sonucRef ?? null, durum ? 'Karantina' : 'Doğrulandı', durum ? `${durum}${g.hata ? `: ${g.hata}` : ''}` : null])).rows[0].kimlik as string;
  if (durum) await kartAc(db, { tur: 'Entegrasyon Uzlaştırma', kategori: 'islem', baslik: `Karantina: ${durum} · ${g.disKimlik}`, ozet: `Beklenen iş sonucu: ${g.beklenen}`.slice(0, 200), oncelik: 'Yüksek', sahipRol: await sorumluRol(db, g.entegrasyon), nesneTuru: 'Entegrasyon Kaydı', nesneKimligi: k });
  return k;
}

/** YG-1312: dönem uzlaştırması; kayıt sayısı, kimlik, kritik değer, durum ve dönem toplamları karşılaştırılır, her fark sahipli görev olur. */
export async function uzlastir(db: Db, g: { entegrasyon: string; donem: string; karsi: { disKimlik: string; deger: number; durum: string }[]; yapan: string }) {
  const bizde = (await db.query(`SELECT dis_kimlik, kritik_deger, karsi_durum FROM entegrasyon_kaydi WHERE entegrasyon_ref = $1 AND donem = $2 AND durum <> 'Karantina'`, [g.entegrasyon, g.donem])).rows as { dis_kimlik: string; kritik_deger: string | null; karsi_durum: string | null }[];
  const B = new Map(bizde.map((x) => [x.dis_kimlik, x])); const K = new Map(g.karsi.map((x) => [x.disKimlik, x]));
  const farklar: { tur: string; disKimlik: string | null; aciklama: string }[] = [];
  if (bizde.length !== g.karsi.length) farklar.push({ tur: 'Kayıt Sayısı', disKimlik: null, aciklama: `Sistem ${bizde.length}, karşı sistem ${g.karsi.length}` });
  for (const [k] of K) if (!B.has(k)) farklar.push({ tur: 'Kimlik', disKimlik: k, aciklama: 'Karşı sistemde var, sistemde yok' });
  for (const [k] of B) if (!K.has(k)) farklar.push({ tur: 'Kimlik', disKimlik: k, aciklama: 'Sistemde var, karşı sistemde yok' });
  for (const [k, x] of K) { const b = B.get(k); if (!b) continue; if (b.kritik_deger !== null && Math.abs(Number(b.kritik_deger) - x.deger) > 0.005) farklar.push({ tur: 'Kritik Değer', disKimlik: k, aciklama: `Sistem ${b.kritik_deger}, karşı sistem ${x.deger}` }); if (b.karsi_durum && b.karsi_durum !== x.durum) farklar.push({ tur: 'Durum', disKimlik: k, aciklama: `Sistem ${b.karsi_durum}, karşı sistem ${x.durum}` }); }
  const ts = Math.round(bizde.reduce((a, x) => a + Number(x.kritik_deger ?? 0), 0) * 100) / 100; const tk = Math.round(g.karsi.reduce((a, x) => a + x.deger, 0) * 100) / 100;
  if (Math.abs(ts - tk) > 0.005) farklar.push({ tur: 'Dönem Toplamı', disKimlik: null, aciklama: `Sistem ${ts}, karşı sistem ${tk}` });
  const u = (await db.query(`INSERT INTO entegrasyon_uzlastirma (entegrasyon_ref, donem, sistem_sayisi, karsi_sayisi, sistem_toplami, karsi_toplami, fark_sayisi, yapan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [g.entegrasyon, g.donem, bizde.length, g.karsi.length, ts, tk, farklar.length, g.yapan])).rows[0].kimlik as string;
  const rol = await sorumluRol(db, g.entegrasyon);
  for (const f of farklar) {
    const fk = (await db.query(`INSERT INTO entegrasyon_farki (uzlastirma_ref, tur, dis_kimlik, aciklama) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [u, f.tur, f.disKimlik, f.aciklama])).rows[0].kimlik;
    await kartAc(db, { tur: 'Entegrasyon Farkı', kategori: 'islem', baslik: `${g.donem} · ${f.tur}${f.disKimlik ? ` · ${f.disKimlik}` : ''}`, ozet: f.aciklama, sahipRol: rol, nesneTuru: 'Entegrasyon Farkı', nesneKimligi: fk });
  }
  return { kimlik: u, farklar };
}

export function entegrasyonUzlastirmaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, YETKILI])).rowCount);
  s.get('/entegrasyon/karantina', oturumlu, async (i, y) => ((await yetkili(i.oturum!.kullanici)) ? (await b.db.query(`SELECT k.kimlik, e.ad, k.dis_kimlik, k.beklenen_sonuc, k.hata, k.olusturma_zamani FROM entegrasyon_kaydi k JOIN entegrasyon_tanimi e ON e.kimlik = k.entegrasyon_ref WHERE k.durum = 'Karantina' ORDER BY k.olusturma_zamani`)).rows : yok(y)));
  // Manuel uzlaştırma: yetkili doğrulama olmadan en yeni zaman damgası doğru kabul edilmez; karar ve gerekçe yazılır.
  s.post('/entegrasyon/kayit/:id/uzlastir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; gerekce?: string; sonucRef?: string };
    if (!UUID.test(id) || !(await yetkili(o.kullanici))) return yok(y);
    if (!['Sistem Kaydı Doğru', 'Karşı Kayıt Doğru', 'Elle Düzeltildi', 'Geçersiz'].includes(g.karar ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Karar ve gerekçe zorunludur.' });
    const r = await b.db.query(`UPDATE entegrasyon_kaydi SET durum = 'Uzlaştırıldı', uzlastirma_karari = $2, uzlastirma_gerekcesi = $3, uzlastiran_ref = $4, sonuc_ref = coalesce($5, sonuc_ref) WHERE kimlik = $1 AND durum = 'Karantina'`, [id, g.karar, g.gerekce.trim(), o.kullanici, g.sonucRef ?? null]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Kayıt karantinada değildir.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Entegrasyon Uzlaştırma' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Entegrasyon Manuel Uzlaştırma', nesneTuru: 'Entegrasyon Kaydı', nesneKimligi: id, yeni: { karar: g.karar }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
