import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
export const GORUS_ROLLERI = ['Operasyon Yöneticisi', 'Teknik Yönetici'];
const GORUNUR = ['CEO', 'Genel Müdür Yardımcısı', 'Teknik ve Operasyon Direktörü', 'Operasyon Müdürü', 'Hukuk ve Uyum Direktörü'];
const POLICE = 'Hukuk ve Uyum Direktörü';

/** K-240: iki görüş aynıysa karar kesinleşir; farklıysa kapı kapalı kalır. */
export function ortakKarar(oy: number | null, ty: number | null): { durum: string; deger: number | null } {
  if (oy === null || ty === null) return { durum: 'Bekliyor', deger: null };
  return oy === ty ? { durum: 'Kesin', deger: oy } : { durum: 'Uyuşmazlık', deger: null };
}

/** YG-126, YG-336: değer poliçe olay başı limitini aşıyorsa ek poliçe gerekir; limit tanımsızsa güvenli tarafta kalınır. */
export function ekPoliceDurumu(deger: number, limit: number | null): string {
  return limit === null || deger > limit ? 'Gerekli – bekleniyor' : 'Gerekli değil';
}

/** YG-1458: teklif / yat değeri oranının geçtiği en yüksek eşik. */
export function ekonomikEsik(tutar: number, deger: number): 60 | 70 | 80 | null {
  const o = (tutar * 100) / deger;
  return o >= 80 ? 80 : o >= 70 ? 70 : o >= 60 ? 60 : null;
}

/** YG-126, K-240: hasar dosyasında teklif gönderimi ve iş emri için kapı; acil ilk tedbir dışarıda. */
export async function yatDegeriEngeli(db: Db, dosya: string, isEmriTuru?: string): Promise<string | null> {
  if (isEmriTuru === 'AC') return null;
  const d = (await db.query(`SELECT d.hizmet_turu, v.durum, v.ek_police_durumu FROM dosya d LEFT JOIN dosya_yat_degeri v ON v.dosya_ref = d.kimlik WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (d.hizmet_turu !== 'Hasar onarımı') return null;
  if (d.durum !== 'Kesin') return 'Yat değeri Operasyon Yöneticisi ve Teknik Yöneticinin ortak kararıyla belirlenmeden işlem yapılamaz.';
  if (isEmriTuru && d.ek_police_durumu === 'Gerekli – bekleniyor') return 'Dosyaya özel ek poliçe sağlanmadan iş emri verilemez.';
  return null;
}

/** YG-1458: %60 uyarı, %70 değerlendirme görevi, %80 yat sahibine onaylı metin. Oran ve değer kart ve metinlerde yazılmaz. Her eşik dosyada bir kez. */
export async function ekonomikIzle(c: PoolClient, dosya: string, tutar: number): Promise<void> {
  const v = (await c.query(`SELECT v.deger_eur, d.dosya_no, d.yazisma_dili, d.vefat_isareti, d.dosya_niteligi, y.yat_adi FROM dosya_yat_degeri v JOIN dosya d ON d.kimlik = v.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE v.dosya_ref = $1 AND v.durum = 'Kesin'`, [dosya])).rows[0];
  if (!v) return;
  const esik = ekonomikEsik(tutar, Number(v.deger_eur));
  if (!esik) return;
  const kart = async (tur: string, baslik: string, rol: string) => { if (await birKez(c, `${tur}:${rol}`, dosya)) await kartAc(c, { tur, kategori: 'islem', baslik: `${v.dosya_no} · ${baslik}`, oncelik: 'Yüksek', sahipRol: await rolId(c, rol), nesneTuru: 'Dosya', nesneKimligi: dosya }); };
  await kart('Ekonomik Onarım Uyarısı', 'Ekonomik Onarım Uyarısı', 'Teknik Müdür');
  if (esik >= 70) await kart('Ekonomik Onarım Değerlendirmesi', 'Ekonomik Onarım Değerlendirmesi', 'Teknik Müdür');
  if (esik === 80) {
    await kart('Ekonomik Onarılamazlık', 'Ekonomik Onarılamazlık Değerlendirmesi', 'Ticari İşler Direktörü');
    const t = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [dosya])).rows[0];
    if (t && !v.vefat_isareti) await yatTarafinaYaz(c, { olay: `ekonomik:${dosya}`, kod: v.dosya_niteligi === 'Sigorta bağlantılı' ? 'BLD-58' : 'BLD-59', dil: dilKod(v.yazisma_dili), konu: `${v.dosya_no} Onarım Planı`, telefon: t.telefon, eposta: t.eposta, alanlar: { Yat: v.yat_adi, Yacht: v.yat_adi } });
  }
}

export function yatDegeriYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const atanmisRol = async (dosya: string, k: string) => (await b.db.query(`SELECT rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = ANY($3) AND bitis_zamani IS NULL`, [dosya, k, GORUS_ROLLERI])).rows.map((r) => r.rol as string);
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2) LIMIT 1`, [k, r])).rowCount);

  // YG-985, YG-1172: yalnız dosyaya atanmış iki rol ve yetkili üst roller görür; diğerine kaydın varlığı da söylenmez.
  s.get('/dosya/:id/yat-degeri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const roller = await atanmisRol(id, o.kullanici);
    if (!roller.length && !(await rolVar(o.kullanici, GORUNUR))) return yok(y);
    const v = (await b.db.query(`SELECT durum, deger_eur, ek_police_durumu FROM dosya_yat_degeri WHERE dosya_ref = $1`, [id])).rows[0];
    const gorusler = (await b.db.query(`SELECT rol, deger_eur, dayanak, zaman FROM dosya_yat_degeri_gorusu WHERE dosya_ref = $1 ORDER BY rol`, [id])).rows;
    return { durum: v?.durum ?? 'Bekliyor', deger: v?.deger_eur ?? null, ekPolice: v?.ek_police_durumu ?? null, gorusler, rollerim: roller };
  });

  // K-240: atanmış Operasyon Yöneticisi ve Teknik Yönetici görüşünü yazar; değerler aynı olunca karar kesinleşir. Biri değiştirirse karar yeniden açılır.
  s.post('/dosya/:id/yat-degeri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { deger?: number; dayanak?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const roller = await atanmisRol(id, o.kullanici);
    if (!roller.length) return y.code(403).send({ hata: 'Yat değerine dosyaya atanmış Operasyon Yöneticisi ve Teknik Yönetici ortak karar verir.' });
    if (roller.length > 1) return y.code(409).send({ hata: 'İki rol aynı kişide olduğundan ortak karar verilemez; rollerden birini başka kişiye atayınız.' });
    if (!(Number(g.deger) > 0) || !g.dayanak?.trim()) return y.code(400).send({ hata: 'Değer ve dayanak zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`SELECT dosya_no, hizmet_turu FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      await c.query(`INSERT INTO dosya_yat_degeri_gorusu (dosya_ref, rol, kullanici_ref, deger_eur, dayanak) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (dosya_ref, rol) DO UPDATE SET kullanici_ref = $3, deger_eur = $4, dayanak = $5, zaman = now()`, [id, roller[0], o.kullanici, g.deger, g.dayanak.trim()]);
      const gr = (await c.query(`SELECT rol, deger_eur FROM dosya_yat_degeri_gorusu WHERE dosya_ref = $1`, [id])).rows;
      const al = (r: string) => { const x = gr.find((z) => z.rol === r); return x ? Number(x.deger_eur) : null; };
      const k = ortakKarar(al('Operasyon Yöneticisi'), al('Teknik Yönetici'));
      const eskiPolice = (await c.query(`SELECT ek_police_durumu FROM dosya_yat_degeri WHERE dosya_ref = $1`, [id])).rows[0]?.ek_police_durumu;
      const limit = (await c.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'police_olay_basi_limit_eur'`)).rows[0]?.deger;
      const police = k.deger === null ? null : eskiPolice === 'Sağlandı' ? 'Sağlandı' : ekPoliceDurumu(k.deger, limit === undefined ? null : Number(limit));
      await c.query(`INSERT INTO dosya_yat_degeri (dosya_ref, durum, deger_eur, kesinlesme_zamani, ek_police_durumu) VALUES ($1,$2,$3,CASE WHEN $2::text = 'Kesin' THEN now() END,$4) ON CONFLICT (dosya_ref) DO UPDATE SET durum = $2, deger_eur = $3, kesinlesme_zamani = CASE WHEN $2::text = 'Kesin' THEN now() END, ek_police_durumu = $4, guncelleme_zamani = now()`, [id, k.durum, k.deger, police]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Yat Değeri Görüşü' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı' AND ($2::text = 'Kesin' OR sahip_kullanici_ref = $3)`, [id, k.durum, o.kullanici]);
      if (k.durum === 'Uyuşmazlık' && await birKez(c, 'yat_degeri_uyusmazlik', id)) await kartAc(c, { tur: 'Yat Değeri Uyuşmazlığı', kategori: 'islem', baslik: `${d.dosya_no} · Yat Değerinde Görüş Ayrılığı`, ozet: 'Teklif ve iş emri kapalıdır; iki yöneticiyi aynı değerde buluşturunuz.', oncelik: 'Yüksek', sahipRol: await rolId(c, 'Teknik ve Operasyon Direktörü'), nesneTuru: 'Dosya', nesneKimligi: id });
      if (police === 'Gerekli – bekleniyor' && await birKez(c, 'ek_police_gerekli', id)) await kartAc(c, { tur: 'Ek Poliçe', kategori: 'islem', baslik: `${d.dosya_no} · Dosyaya Özel Ek Poliçe`, oncelik: 'Yüksek', sahipRol: await rolId(c, POLICE), nesneTuru: 'Dosya', nesneKimligi: id });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yat Değeri Görüşü', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { rol: roller[0], deger: g.deger, durum: k.durum }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { durum: k.durum, ekPolice: police };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-336: ek poliçe yüklenince iş emri kapısı açılır. Bedel teklife yansımaz (YG-238).
  s.post('/dosya/:id/ek-police', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { belge } = (i.body ?? {}) as { belge?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await rolVar(o.kullanici, [POLICE]))) return y.code(403).send({ hata: 'Ek poliçeyi Hukuk ve Uyum Direktörü kaydeder.' });
    if (!belge || !UUID.test(belge)) return y.code(400).send({ hata: 'Poliçe belgesi zorunludur.' });
    const r = await b.db.query(`UPDATE dosya_yat_degeri SET ek_police_durumu = 'Sağlandı', ek_police_belge_ref = $2, guncelleme_zamani = now() WHERE dosya_ref = $1 AND ek_police_durumu = 'Gerekli – bekleniyor'`, [id, belge]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu dosyada bekleyen ek poliçe yoktur.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Ek Poliçe' AND nesne_kimligi = $1`, [id]);
    return { ekPolice: 'Sağlandı' };
  });
}
