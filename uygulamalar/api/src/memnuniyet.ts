import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { gorevFormlari } from './form_katalogu.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const MPM = 'Müşteri ve Paydaş İlişkileri Müdürü'; const GORUSME = 'Memnuniyet Görüşmesi';
const ozet = (b: string) => createHash('sha256').update(b).digest('hex');
const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
type Blok = { t: 'b' | 'a' | 'm'; m: string };
let tanimlar: Record<string, Blok[]> | null = null;

/** D-200: kurumsal dosyada yürürlükteki Ek-2'nin Müşteri Sözleşme Muhatabı e-postası. */
export async function kurumsalMuhatap(db: Pool, dosya: string): Promise<string | null> {
  const s = (await db.query(`SELECT e.satirlar FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref JOIN kurumsal_kurum c ON c.taraf_ref = y.yat_sahibi_ref JOIN kurumsal_ek2 e ON e.kurum_ref = c.kimlik AND e.durum = 'Yürürlükte' WHERE d.kimlik = $1 ORDER BY e.surum DESC LIMIT 1`, [dosya])).rows[0]?.satirlar as { muhatap?: { iletisim?: string } } | undefined;
  return /[^\s,;]+@[^\s,;]+\.[^\s,;]+/.exec(s?.muhatap?.iletisim ?? '')?.[0] ?? null;
}

/** YG-1470, YG-1475: Teknik Kapalı + 48 saat; tek anket, hatırlatma yok. Uyuşmazlık, vefat, tam ziya ve alt dosyada gönderilmez. Kurumsal dosyada Ek-2 muhatabına gider; e-postası yoksa gönderilmez. */
export async function anketGonder(db: Pool, web: string, simdi = new Date()): Promise<{ dosya: string; belirtec: string }[]> {
  const { rows } = await db.query(
    `SELECT d.kimlik, d.dosya_no, d.yazisma_dili, d.musteri_turu, t.kimlik taraf, t.telefon, t.eposta FROM dosya d JOIN kapanis_kontrolu c ON c.dosya_ref = d.kimlik AND c.cikis_statusu = 'Teknik Kapalı' AND c.durum = 'Onaylandı'
       LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif
      WHERE c.kapanis_zamani <= $1::timestamptz - interval '48 hours' AND d.statu IN ('Teknik Kapalı', 'Kapalı') AND d.ana_dosya_ref IS NULL AND NOT d.vefat_isareti
        AND coalesce(d.kapanma_nedeni, '') NOT IN ('Hükmi Tam Ziya (onarım ekonomik değil)', 'Tam Ziya (yat fiziken yok)', 'Hükmi Tam Ziya', 'Tam Ziya')
        AND NOT EXISTS (SELECT 1 FROM uyusmazlik_kaydi u WHERE u.dosya_ref = d.kimlik AND u.karar IS NULL) AND NOT EXISTS (SELECT 1 FROM memnuniyet_anketi a WHERE a.dosya_ref = d.kimlik)`, [simdi]);
  const sonuc: { dosya: string; belirtec: string }[] = [];
  for (const d of rows) {
    const muhatap = d.musteri_turu === 'Kurumsal Müşteri' ? await kurumsalMuhatap(db, d.kimlik) : null;
    if (d.musteri_turu === 'Kurumsal Müşteri' ? !muhatap : !d.taraf) continue;
    const belirtec = randomBytes(32).toString('hex'); const dil = dilKod(d.yazisma_dili); const l = `${web}/#anket=${belirtec}`;
    if (!(await db.query(`INSERT INTO memnuniyet_anketi (dosya_ref, belirtec_ozet, dil) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING kimlik`, [d.kimlik, ozet(belirtec), dil])).rowCount) continue;
    await yatTarafinaYaz(db, { olay: `bld36:${d.kimlik}`, kod: 'BLD-36', dil, konu: `${d.dosya_no} Memnuniyet Anketi`, telefon: muhatap ? null : d.telefon, eposta: muhatap ?? d.eposta, alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, 'bağlantı': l, link: l } });
    sonuc.push({ dosya: d.kimlik, belirtec });
  }
  return sonuc;
}

export function memnuniyetYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const anket = async (x: string) => (/^[0-9a-f]{64}$/.test(x) ? (await b.db.query(`SELECT a.*, d.dosya_no FROM memnuniyet_anketi a JOIN dosya d ON d.kimlik = a.dosya_ref WHERE a.belirtec_ozet = $1`, [ozet(x)])).rows[0] : undefined);

  // Giriş gerektirmez; belirteç dışında bilgi döndürmez, firma adı yer almaz.
  s.get('/anket/:b', async (i, y) => {
    const a = await anket((i.params as { b: string }).b); if (!a) return yok(y);
    return { dil: a.dil, yanitlandi: a.cevap_zamani !== null };
  });
  s.post('/anket/:b', async (i, y) => {
    const a = await anket((i.params as { b: string }).b); if (!a) return yok(y);
    const g = (i.body ?? {}) as { genel?: unknown; iletisim?: unknown; isKalitesi?: unknown; yorum?: string }; const P = [Number(g.genel), Number(g.iletisim), Number(g.isKalitesi)];
    if (P.some((x) => !Number.isInteger(x) || x < 1 || x > 5)) return y.code(400).send({ hata: a.dil === 'en' ? 'Please rate all three questions.' : 'Lütfen üç soruyu da puanlayınız.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query(`UPDATE memnuniyet_anketi SET genel = $2, iletisim = $3, is_kalitesi = $4, yorum = $5, ortalama = $6, cevap_zamani = now() WHERE kimlik = $1 AND cevap_zamani IS NULL`, [a.kimlik, P[0], P[1], P[2], g.yorum?.trim().slice(0, 2000) || null, Math.round((P.reduce((t, x) => t + x, 0) / 3) * 100) / 100]);
      if (!u.rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: a.dil === 'en' ? 'This survey has already been answered.' : 'Bu anket yanıtlanmıştır.' }); }
      // K-203: herhangi bir soruda 2 veya altı (ortalama değil).
      if (P.some((x) => x <= 2)) await kartAc(c, { tur: GORUSME, kategori: 'gorev', baslik: `${a.dosya_no} · Memnuniyet Görüşmesi`, ozet: `Genel ${P[0]} · İletişim ${P[1]} · İş Kalitesi ${P[2]}`, oncelik: 'Yüksek', sahipRol: await rolId(c, MPM), nesneTuru: 'Memnuniyet Anketi', nesneKimligi: a.kimlik });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  const mpm = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = $2 LIMIT 1`, [k, MPM])).rowCount);
  s.get('/anket-gorusme', oturumlu, async (i, y) => {
    if (!(await mpm(i.oturum!.kullanici))) return yok(y);
    return (await b.db.query(`SELECT a.kimlik, d.dosya_no, a.genel, a.iletisim, a.is_kalitesi, a.yorum FROM memnuniyet_anketi a JOIN dosya d ON d.kimlik = a.dosya_ref WHERE least(a.genel, a.iletisim, a.is_kalitesi) <= 2 AND a.gorusme_sonucu IS NULL ORDER BY a.cevap_zamani`)).rows;
  });
  s.post('/anket-gorusme/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string };
    if (!UUID.test(id) || !(await mpm(o.kullanici))) return yok(y);
    if (!g.sonuc?.trim()) return y.code(400).send({ hata: 'Görüşme sonucu zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query(`UPDATE memnuniyet_anketi SET gorusme_sonucu = $2, gorusen_ref = $3 WHERE kimlik = $1 AND gorusme_sonucu IS NULL AND least(genel, iletisim, is_kalitesi) <= 2`, [id, g.sonuc.trim(), o.kullanici]);
      if (!u.rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu görüşme kaydedilmiştir.' }); }
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [GORUSME, id]);
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  // YG-973: personel kendi rolünün görev tanımını görür; karne göstergeleri Karnem ekranındadır.
  s.get('/gorev-tanimim', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const roller = (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [o.kullanici])).rows.map((r) => r.rol_adi as string);
    tanimlar ??= JSON.parse(readFileSync(join(KOK, 'veri/sablon/rol_gorev_tanimlari.json'), 'utf-8')) as Record<string, Blok[]>;
    // YG-1513: form listesi bölümü belge kataloğundan üretilir.
    return Promise.all(roller.filter((r) => tanimlar![r]).map(async (r) => ({ rol: r, bloklar: await gorevFormlari(b.db, r, tanimlar![r]!) })));
  });
}
