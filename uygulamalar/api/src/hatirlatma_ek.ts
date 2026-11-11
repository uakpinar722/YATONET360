import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/** YG-1640, YG-555: öncelik başına İlerleme Özeti günleri (0 = Pazar); Kritik onarım evresinde yoktur (CEO 28.10.2026). */
export const OZET_GUNLERI: Record<string, number[]> = { 'Yüksek': [1, 3, 5], Normal: [2], 'Planlı': [3] };

/** Her gün: önceliğinin günü gelen aktif dosyanın Dosya Sorumlusuna saat 12:00 son süreli "İlerleme Özetini Gönder" görevi bir kez açılır. */
export async function ilerlemeOzetiIsle(db: Pool, simdi = new Date()): Promise<number> {
  const yerel = new Date(simdi.getTime() + 3 * 3_600_000); const gun = yerel.getUTCDay(); const tarih = yerel.toISOString().slice(0, 10);
  const son = new Date(`${tarih}T09:00:00Z`); // 12:00 Europe/Istanbul
  let n = 0;
  for (const d of (await db.query(`SELECT kimlik, dosya_no, oncelik, dosya_sorumlusu_ref FROM dosya WHERE statu = 'Aktif' AND dosya_sorumlusu_ref IS NOT NULL AND oncelik = ANY($1::text[])`, [Object.keys(OZET_GUNLERI)])).rows) {
    if (!OZET_GUNLERI[d.oncelik]!.includes(gun) || !(await birKez(db, 'ilerleme-ozeti', `${d.kimlik}:${tarih}`))) continue;
    await kartAc(db, { tur: 'İlerleme Özetini Gönder', kategori: 'gorev', baslik: `${d.dosya_no} · İlerleme Özetini Gönder`, ozet: `${d.oncelik} öncelik · bugün 12:00'ye kadar yat sahibine iletilir; firma adı, fiyat, maliyet ve iç not yer almaz.`, sahipKullanici: d.dosya_sorumlusu_ref, sonZaman: son, oncelik: d.oncelik === 'Yüksek' ? 'Yüksek' : 'Normal', nesneTuru: 'Dosya', nesneKimligi: d.kimlik }); n++;
  }
  return n;
}

/** Dosyanın, sonradan çekilmemiş "çekilemedi" kareleri. */
async function cekilemeyenler(db: Pool, dosya: string) {
  return (await db.query(`SELECT g.cekim_kalemi, g.bolge_kodu, g.cekilemedi_nedeni FROM gorsel_kanit g WHERE g.dosya_ref = $1 AND g.cekilemedi_nedeni IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM gorsel_kanit x WHERE x.dosya_ref = g.dosya_ref AND x.cekim_kalemi = g.cekim_kalemi AND coalesce(x.bolge_kodu, '') = coalesce(g.bolge_kodu, '') AND x.belge_ref IS NOT NULL AND x.olusturma_zamani > g.olusturma_zamani) ORDER BY g.cekim_kalemi`, [dosya])).rows;
}

/**
 * YG-1453: yat karaya alınınca (onaylı çekek randevusunun günü geldi veya Dosya Sorumlusu "yat karada" işaretledi) daha önce çekilemeyen açılar
 * sahadaki Teknik Uzmana, yoksa dosyadaki aktif iş emrinin firma kullanıcılarına hatırlatılır; dosya başına bir kez.
 */
export async function karadaHatirlatIsle(db: Pool): Promise<number> {
  let n = 0;
  const l = (await db.query(`SELECT DISTINCT d.kimlik, d.dosya_no FROM dosya d WHERE d.statu = 'Aktif' AND (d.yat_karada IS TRUE OR EXISTS (SELECT 1 FROM tesis_talebi t WHERE t.dosya_ref = d.kimlik AND t.tur = 'Çekek Randevusu' AND t.durum = 'Onaylı' AND t.hedef_tarih <= current_date))`)).rows;
  for (const d of l) {
    const c = await cekilemeyenler(db, d.kimlik); if (!c.length || !(await birKez(db, 'karada-acilar', d.kimlik))) continue;
    let al = (await db.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Teknik Uzman' AND bitis_zamani IS NULL`, [d.kimlik])).rows.map((r) => r.kullanici_ref as string);
    if (!al.length) al = (await db.query(`SELECT DISTINCT u.kullanici_ref FROM is_emri e JOIN kurulus_kullanici u ON u.kurulus_ref = e.kurulus_ref WHERE e.dosya_ref = $1 AND e.statu IN ('Aktif', 'Başlangıç Kontrolünde')`, [d.kimlik])).rows.map((r) => r.kullanici_ref as string);
    if (!al.length) continue;
    await bildir(db, { olay: `karada-acilar:${d.kimlik}`, kullanicilar: al, baslik: `${d.dosya_no} · Yat karada: daha önce çekilemeyen açılar`, ozet: c.map((x) => `${x.cekim_kalemi}${x.bolge_kodu ? ` (${x.bolge_kodu})` : ''}`).join(', ').slice(0, 300), oncelik: 'Yüksek' }); n++;
  }
  return n;
}

export function hatirlatmaEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  // YG-1453: Dosya Sorumlusu yatın karaya alındığını işaretler; hatırlatma hemen çalışır.
  s.post('/dosya/:id/yat-karada', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND dosya_sorumlusu_ref = $2`, [id, o.kullanici])).rowCount) return yok(y);
    await b.db.query(`UPDATE dosya SET yat_karada = true WHERE kimlik = $1`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yat Karada İşaretlendi', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    const n = await karadaHatirlatIsle(b.db);
    return { hatirlatma: n, cekilemeyen: (await cekilemeyenler(b.db, id)).length };
  });
}
