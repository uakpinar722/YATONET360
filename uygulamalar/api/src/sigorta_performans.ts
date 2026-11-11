import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const MY = 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı'; const MUDUR = 'Müşteri ve Paydaş İlişkileri Müdürü'; const DIREKTOR = 'Strateji ve Kurumsal Gelişim Direktörü';
const ONAY = 'Sigorta Performans Onayı';
const R1 = (x: number) => Math.round(x * 10) / 10;

/** İş günü sonu saat 12:00 (Europe/Istanbul = UTC+3). */
async function gun12(db: Db, ilk: Date, n: number) { const d = await isGunuSonu(db, new Date(ilk.getTime() - 86_400_000), n); d.setUTCHours(9, 0, 0, 0); return d; }

/** YG-767: süre uyumu, ortalama dosya süresi, dosya sayısı ve şikâyetler; sigortacının dönemde açılan ve kapanan dosyalarından. */
export async function performansHesapla(db: Db, sigortaci: string, donem: string) {
  const bas = `${donem}-01`; const s = new Date(`${bas}T00:00:00Z`); s.setUTCMonth(s.getUTCMonth() + 1); const son = s.toISOString().slice(0, 10);
  const D = `SELECT x.dosya_ref FROM dosya_sigorta_kaydi x WHERE lower(x.sigortaci_adi) = lower($1)`;
  const acilan = Number((await db.query(`SELECT count(*) n FROM dosya d WHERE d.kimlik IN (${D}) AND d.acilis_tarihi >= $2 AND d.acilis_tarihi < $3`, [sigortaci, bas, son])).rows[0].n);
  const k = (await db.query(`SELECT avg(extract(epoch FROM d.kapanis_zamani - d.acilis_tarihi) / 86400) ort, count(*) n FROM dosya d WHERE d.kimlik IN (${D}) AND d.statu = 'Kapalı' AND d.kapanis_zamani >= $2 AND d.kapanis_zamani < $3`, [sigortaci, bas, son])).rows[0];
  const su = (await db.query(`SELECT count(*) FILTER (WHERE s.tamamlanma <= s.bitis) uygun, count(*) n FROM dosya_sure s WHERE s.dosya_ref IN (${D}) AND s.tamamlanma >= $2 AND s.tamamlanma < $3`, [sigortaci, bas, son])).rows[0];
  const sk = Number((await db.query(`SELECT count(*) n FROM garanti_sikayet g WHERE g.dosya_ref IN (${D}) AND g.bildirim_zamani >= $2 AND g.bildirim_zamani < $3 AND EXISTS (SELECT 1 FROM unnest(g.kayit_turu) t WHERE t ILIKE 'şik%' OR t ILIKE 'Şik%')`, [sigortaci, bas, son])).rows[0].n);
  return { dosyaSayisi: acilan, kapananDosya: Number(k.n), ortalamaDosyaSuresiGun: k.ort === null ? null : R1(Number(k.ort)), sureUyumuYuzde: Number(su.n) ? R1((100 * Number(su.uygun)) / Number(su.n)) : null, sureOlcumu: Number(su.n), sikayet: sk };
}

/** Ay başında önceki dönem için sigortacı başına rapor açılır; veri görevi Müdür Yardımcısına (3. iş günü 12:00). */
export async function sigortaPerformansIsle(db: Pool, simdi = new Date()): Promise<number> {
  const ilk = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth(), 1)); const donem = new Date(ilk.getTime() - 86_400_000).toISOString().slice(0, 7);
  const bas = `${donem}-01`; let n = 0;
  for (const s of (await db.query(`SELECT DISTINCT x.sigortaci_adi FROM dosya_sigorta_kaydi x JOIN dosya d ON d.kimlik = x.dosya_ref WHERE x.sigortaci_adi IS NOT NULL AND (d.statu <> 'Kapalı' OR d.kapanis_zamani >= $1::date)`, [bas])).rows) {
    const veriSon = await gun12(db, ilk, 3); const hazirSon = await gun12(db, ilk, 5);
    const r = await db.query(`INSERT INTO sigorta_performans_raporu (sigortaci_adi, donem, veri_son, hazir_son) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING kimlik`, [s.sigortaci_adi, donem, veriSon, hazirSon]);
    if (!r.rowCount) continue;
    await kartAc(db, { tur: 'Sigorta Performans Verisi', kategori: 'gorev', baslik: `${s.sigortaci_adi} · ${donem} Performans Verisi`, ozet: 'Süre uyumu, dosya süresi, dosya sayısı ve şikâyet verisini kaydediniz.', sonZaman: veriSon, oncelik: 'Yüksek', sahipRol: await rolId(db, MY), nesneTuru: 'Sigorta Performans', nesneKimligi: r.rows[0].kimlik }); n++;
  }
  return n;
}

kapanisKaydet(ONAY, async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE sigorta_performans_raporu SET durum = 'Onaylandı', onay_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
  else if (['Reddet', 'Gerekçeyle İade Et'].includes(karar)) await c.query(`UPDATE sigorta_performans_raporu SET durum = 'Hazırlanıyor' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
});

/** RP-TIC-001 ile birlikte gönderim: onaylı performans raporu mutabakat belgesinin içine bölüm olarak eklenir. */
export async function onayliPerformans(db: Db, sigortaci: string, donem: string) {
  return (await db.query(`SELECT veri, mudur_notu FROM sigorta_performans_raporu WHERE lower(sigortaci_adi) = lower($1) AND donem = $2 AND durum = 'Onaylandı'`, [sigortaci, donem])).rows[0] ?? null;
}

export function sigortaPerformansYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, l: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, l])).rowCount);
  const kapat = (tur: string, id: string) => b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [tur, id]);
  s.get('/sigorta-performans', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, [MY, MUDUR, DIREKTOR, 'Ticari İşler Direktörü', 'CEO', 'Genel Müdür Yardımcısı']))) return yok(y);
    return { raporlar: (await b.db.query(`SELECT kimlik, sigortaci_adi, donem, veri, mudur_notu, durum, veri_son, hazir_son FROM sigorta_performans_raporu ORDER BY donem DESC, sigortaci_adi LIMIT 100`)).rows, my: await rolde(o.kullanici, [MY]), mudur: await rolde(o.kullanici, [MUDUR]) };
  });
  s.post('/sigorta-performans/:id/veri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(o.kullanici, [MY]))) return yok(y);
    const r = (await b.db.query(`SELECT sigortaci_adi, donem, hazir_son FROM sigorta_performans_raporu WHERE kimlik = $1 AND durum = 'Veri Bekleniyor'`, [id])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Rapor veri beklemiyor.' });
    const v = await performansHesapla(b.db, r.sigortaci_adi, r.donem);
    await b.db.query(`UPDATE sigorta_performans_raporu SET veri = $2, durum = 'Hazırlanıyor', veri_giren_ref = $3 WHERE kimlik = $1`, [id, v, o.kullanici]);
    await kapat('Sigorta Performans Verisi', id);
    await kartAc(b.db, { tur: 'Sigorta Performans Raporu', kategori: 'gorev', baslik: `${r.sigortaci_adi} · ${r.donem} Performans Raporu`, ozet: 'Raporu değerlendirip Strateji ve Kurumsal Gelişim Direktörü onayına gönderiniz.', sonZaman: new Date(r.hazir_son), oncelik: 'Yüksek', sahipRol: await rolId(b.db, MUDUR), nesneTuru: 'Sigorta Performans', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Performans Verisi', nesneTuru: 'Sigorta Performans', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { veri: v };
  });
  s.post('/sigorta-performans/:id/onaya', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(o.kullanici, [MUDUR]))) return yok(y);
    const g = (i.body ?? {}) as { not?: string };
    const r = (await b.db.query(`UPDATE sigorta_performans_raporu SET durum = 'Onayda', mudur_notu = $2, hazirlayan_ref = $3 WHERE kimlik = $1 AND durum = 'Hazırlanıyor' RETURNING sigortaci_adi, donem, hazir_son`, [id, g.not?.trim() || null, o.kullanici])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Rapor onaya gönderilebilecek durumda değildir.' });
    await kapat('Sigorta Performans Raporu', id);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'İade Edildi'`, [ONAY, id]); // iade sonrası yeni onay turu
    await kartAc(b.db, { tur: ONAY, baslik: `${r.sigortaci_adi} · ${r.donem} Performans Raporu Onayı`, hazirlayan: o.kullanici, zincir: [await rolId(b.db, DIREKTOR)], sonZaman: new Date(r.hazir_son), oncelik: 'Yüksek', nesneTuru: 'Sigorta Performans', nesneKimligi: id });
    return { tamam: true };
  });
}
