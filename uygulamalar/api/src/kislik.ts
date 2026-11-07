import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { parametre } from './teklif.js';
import { UUID } from './yat.js';

/** Ay (1–12) kış döneminde mi; dönem yıl sonunu aşabilir (11 → 3). */
export function kistaMi(ay: number, bas: number, bit: number): boolean {
  return bas <= bit ? ay >= bas && ay <= bit : ay >= bas || ay <= bit;
}

/** YG-110: açık dosya kışa sarkar: hedef tarihi kış dönemine düşer ya da kış başladığında dosya hâlâ açıktır. */
export async function kisaSarkiyor(db: Pool, d: { musteri_hedef_tarihi: string | null }, simdi = new Date()): Promise<boolean> {
  const bas = await parametre(db, 'kis_baslangic_ay'); const bit = await parametre(db, 'kis_bitis_ay');
  const bugunAy = Number(simdi.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }).slice(5, 7));
  if (kistaMi(bugunAy, bas, bit)) return true;
  return Boolean(d.musteri_hedef_tarihi && kistaMi(Number(String(d.musteri_hedef_tarihi).slice(5, 7)), bas, bit));
}

/** Kışa sarkan ve sorumlusu atanmamış açık dosya için Dosya Sorumlusuna her kış dönemi bir kez görev açılır. */
export async function kislikIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const yil = simdi.getMonth() >= 6 ? simdi.getFullYear() : simdi.getFullYear() - 1;
  for (const d of (await db.query(`SELECT kimlik, dosya_no, dosya_sorumlusu_ref, musteri_hedef_tarihi::text FROM dosya WHERE statu NOT IN ('Kapalı', 'Teknik Kapalı') AND kislik_sorumlu_kullanici_ref IS NULL AND kislik_sorumlu_taraf_ref IS NULL AND dosya_sorumlusu_ref IS NOT NULL`)).rows) {
    if (!(await kisaSarkiyor(db, d, simdi)) || !(await birKez(db, 'kislik_sorumlu', `${d.kimlik}:${yil}`))) continue;
    await kartAc(db, { tur: 'Kışlık Hazırlık Sorumlusu', kategori: 'gorev', baslik: `${d.dosya_no} · Kışlık Hazırlık Sorumlusu`, ozet: 'Dosya kış dönemine sarkıyor; kışlık hazırlık sorumlusunu belirleyiniz.', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
    n++;
  }
  return n;
}

export function kislikYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/dosya/:id/kislik', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (i.oturum!.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT d.musteri_hedef_tarihi::text, d.statu, h.ad_soyad kullanici, t.kisi_adi_soyadi taraf, t.taraf_rolu FROM dosya d LEFT JOIN kullanici_hesabi h ON h.kimlik = d.kislik_sorumlu_kullanici_ref LEFT JOIN dosya_tarafi t ON t.kimlik = d.kislik_sorumlu_taraf_ref WHERE d.kimlik = $1`, [id])).rows[0];
    const taraflar = (await b.db.query(`SELECT kimlik, kisi_adi_soyadi, taraf_rolu FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif ORDER BY taraf_rolu`, [id])).rows;
    const ekip = (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM dosya_ekibi_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.dosya_ref = $1 AND a.bitis_zamani IS NULL ORDER BY h.ad_soyad`, [id])).rows;
    const kapali = ['Kapalı', 'Teknik Kapalı'].includes(d.statu);
    return { gerekli: !kapali && (await kisaSarkiyor(b.db, d)), sorumlu: d.kullanici ?? (d.taraf ? `${d.taraf} (${d.taraf_rolu})` : null), taraflar, ekip };
  });
  s.post('/dosya/:id/kislik', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kullanici?: string; taraf?: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL AND rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu', 'Operasyon Yöneticisi') LIMIT 1`, [id, o.kullanici])).rowCount) return yok(y);
    if (Boolean(g.kullanici) === Boolean(g.taraf)) return y.code(400).send({ hata: 'Kışlık hazırlık sorumlusu olarak bir personel ya da bir dosya tarafı seçiniz.' });
    if (g.taraf && (!UUID.test(g.taraf) || !(await b.db.query(`SELECT 1 FROM dosya_tarafi WHERE kimlik = $1 AND dosya_ref = $2 AND aktif`, [g.taraf, id])).rowCount)) return y.code(400).send({ hata: 'Seçilen taraf bu dosyaya ait değildir.' });
    if (g.kullanici && !(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL`, [id, g.kullanici])).rowCount) return y.code(400).send({ hata: 'Seçilen personel dosya ekibinde değildir.' });
    await b.db.query(`UPDATE dosya SET kislik_sorumlu_kullanici_ref = $2, kislik_sorumlu_taraf_ref = $3 WHERE kimlik = $1`, [id, g.kullanici ?? null, g.taraf ?? null]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Kışlık Hazırlık Sorumlusu' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kışlık Hazırlık Sorumlusu Belirlendi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { kullanici: g.kullanici ?? null, taraf: g.taraf ?? null }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
