import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { etkinRoller } from './yetki.js';
import { UUID } from './yat.js';

/** V-388: bir iş en çok iki kez ertelenir; sonrası üst kademeyle konuşulur. */
export const AZAMI_ERTELEME = 2;

/**
 * YG-1359: işlem ve görev kartı gerekçe yazılarak ertelenir; süresi aşılan iş, sahibinden alınmadan bir üst kademenin ekranına da düşer.
 */
export function gorevErtelemeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  s.post('/is/:id/ertele', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { yeniSon?: string; gerekce?: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    const roller = (await etkinRoller(b.db, o.kullanici, true)).map((r) => r.kimlik);
    const k = (await b.db.query(`SELECT kimlik, baslik, kategori, durum, son_zaman, sahip_kullanici_ref, sahip_rol_ref, ust_rol_ref, (SELECT count(*)::int FROM is_karti_erteleme e WHERE e.is_ref = is_karti.kimlik) n FROM is_karti WHERE kimlik = $1`, [id])).rows[0];
    if (!k || k.kategori === 'onay' || !(k.sahip_kullanici_ref === o.kullanici || roller.includes(k.sahip_rol_ref) || roller.includes(k.ust_rol_ref))) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    if (k.durum !== 'Bekliyor') return y.code(409).send({ hata: 'Bu kayıt üzerinde işlem yapılmıştır.' });
    const gerekce = (g.gerekce ?? '').trim(); const yeni = g.yeniSon ? new Date(g.yeniSon) : null;
    if (!gerekce) return y.code(400).send({ hata: 'Erteleme gerekçesi zorunludur.' });
    if (!yeni || Number.isNaN(+yeni) || +yeni <= Date.now() || (k.son_zaman && +yeni <= +new Date(k.son_zaman))) return y.code(400).send({ hata: 'Yeni tarih bugünden ve mevcut süreden sonra olmalıdır.' });
    if (k.n >= AZAMI_ERTELEME) return y.code(409).send({ hata: `Bu iş ${AZAMI_ERTELEME} kez ertelenmiştir; yeni erteleme için bağlı olduğunuz yöneticiyle görüşünüz.` });
    await b.db.query(`INSERT INTO is_karti_erteleme (is_ref, eski_son, yeni_son, gerekce, yapan_ref) VALUES ($1,$2,$3,$4,$5)`, [id, k.son_zaman, yeni, gerekce, o.kullanici]);
    await b.db.query(`UPDATE is_karti SET son_zaman = $2 WHERE kimlik = $1`, [id, yeni]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İş Ertelendi', nesneTuru: 'İş Kartı', nesneKimligi: id, eski: { son_zaman: k.son_zaman }, yeni: { son_zaman: yeni }, gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.get('/is/:id/ertelemeler', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    const roller = (await etkinRoller(b.db, i.oturum!.kullanici, true)).map((r) => r.kimlik);
    const k = (await b.db.query(`SELECT sahip_kullanici_ref, sahip_rol_ref, ust_rol_ref FROM is_karti WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(k.sahip_kullanici_ref === i.oturum!.kullanici || roller.includes(k.sahip_rol_ref) || roller.includes(k.ust_rol_ref))) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    return (await b.db.query(`SELECT e.eski_son, e.yeni_son, e.gerekce, h.ad_soyad, e.zaman FROM is_karti_erteleme e JOIN kullanici_hesabi h ON h.kimlik = e.yapan_ref WHERE e.is_ref = $1 ORDER BY e.kimlik`, [id])).rows;
  });
}

/** Süresi aşılan iç görev bir kez üst kademeye çıkar; sahibi işi yapmaya devam eder. */
export async function gorevUstKademe(db: Pool, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(
    `SELECT k.kimlik, k.baslik, k.oncelik, k.sahip_kullanici_ref, coalesce(k.sahip_rol_ref, (SELECT a.rol_ref FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = k.sahip_kullanici_ref AND a.atama_durumu = 'Aktif' AND r.kullanici_gruplari = 'LGM İç Rolü' ORDER BY a.baslangic_tarihi LIMIT 1)) AS rol
       FROM is_karti k WHERE k.durum = 'Bekliyor' AND k.kategori IN ('islem', 'gorev') AND k.son_zaman < $1 AND k.ust_kademe_zamani IS NULL`, [simdi]);
  let n = 0;
  for (const k of rows) {
    if (!k.rol || (await db.query(`SELECT kullanici_gruplari FROM rol WHERE kimlik = $1`, [k.rol])).rows[0]?.kullanici_gruplari !== 'LGM İç Rolü') { await db.query(`UPDATE is_karti SET ust_kademe_zamani = $2 WHERE kimlik = $1`, [k.kimlik, simdi]); continue; }
    let ust: string | null = null;
    try { ust = await onayMakami(db, k.rol); } catch { ust = null; }
    if (!(await birKez(db, 'gorev-ust-kademe', k.kimlik))) continue;
    await db.query(`UPDATE is_karti SET ust_rol_ref = $2, ust_kademe_zamani = $3 WHERE kimlik = $1`, [k.kimlik, ust && ust !== k.rol ? ust : null, simdi]);
    if (!ust || ust === k.rol) continue;
    const sahip = k.sahip_kullanici_ref ? [k.sahip_kullanici_ref] : await rolSahipleri(db, k.rol);
    await bildir(db, { olay: `gorev-ust:${k.kimlik}`, kullanicilar: [...await rolSahipleri(db, ust), ...sahip], baslik: `Süresi Aşıldı, Üst Kademeye Çıktı: ${k.baslik}`, oncelik: k.oncelik, isRef: k.kimlik }, simdi);
    n++;
  }
  return n;
}
