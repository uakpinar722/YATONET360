import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const ROLLER = ['Bilgi İşlem Müdürü', 'Bilgi İşlem Müdür Yardımcısı', 'Sistem Yöneticisi', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'İç Denetim Müdürü', 'İç Denetçi', 'Hukuk ve Uyum Direktörü'];
const KAYNAK = ['Tekrarlayan Olay', 'Yüksek Etkili Olay', 'Denetim Bulgusu', 'Eğilim', 'Üretim Sonrası İzleme'];
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** YG-1293: süresi dolan istisna kendiliğinden yenilenmez, bulgu yeniden açılır ve sorumluya bildirilir. */
export async function bulguIstisnaIsle(db: Db, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(`UPDATE sistem_bulgusu SET durum = 'Açık' WHERE durum = 'İstisna' AND istisna_bitis <= $1::date RETURNING kimlik, bulgu_no, sorumlu_ref`, [simdi]);
  for (const r of rows) await bildir(db, { olay: `bulgu-istisna:${r.kimlik}:${simdi.toISOString().slice(0, 10)}`, kullanicilar: [r.sorumlu_ref], baslik: `${r.bulgu_no} · İstisna Süresi Doldu` }, simdi);
  return rows.length;
}

export function problemYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, ROLLER])).rowCount);
  const icKullanici = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü'`, [k])).rowCount);

  s.get('/problem-kayitlari', oturumlu, async (i, y) => {
    if (!(await yetkili(i.oturum!.kullanici))) return yok(y);
    return {
      problemler: (await b.db.query(`SELECT p.kimlik, p.problem_no, p.kaynak, p.baslik, p.gecici_cozum, p.hedef_tarih::text, p.durum, h.ad_soyad sorumlu FROM problem_kaydi p JOIN kullanici_hesabi h ON h.kimlik = p.sorumlu_ref ORDER BY p.durum = 'Kapalı', p.olusturma_zamani DESC LIMIT 200`)).rows,
      bulgular: (await b.db.query(`SELECT b.kimlik, b.bulgu_no, b.kosul, b.kok_neden, b.hedef_tarih::text, b.durum, b.istisna_bitis::text, h.ad_soyad sorumlu, b.sorumlu_ref, (SELECT count(*)::int FROM sistem_bulgusu x WHERE x.kok_neden = b.kok_neden AND x.kimlik <> b.kimlik) iliskili FROM sistem_bulgusu b JOIN kullanici_hesabi h ON h.kimlik = b.sorumlu_ref ORDER BY b.durum = 'Kapalı', b.olusturma_zamani DESC LIMIT 200`)).rows,
      kisiler: (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik WHERE a.atama_durumu = 'Aktif' AND h.kullanici_grubu = 'LGM İç Rolü' AND h.hesap_durumu = 'Aktif' ORDER BY h.ad_soyad LIMIT 500`)).rows,
    };
  });

  // YG-1286: olay kapanışı problemi kapatmaz; problem ayrı kapanır.
  s.post('/problem-kaydi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kaynak?: string; baslik?: string; aciklama?: string; sorumlu?: string; hedef?: string; geciciCozum?: string; olay?: string };
    if (!(await yetkili(o.kullanici))) return yok(y);
    if (!KAYNAK.includes(g.kaynak ?? '') || !g.baslik?.trim() || !g.aciklama?.trim() || !g.sorumlu || !TARIH.test(g.hedef ?? '') || !(await icKullanici(g.sorumlu))) return y.code(400).send({ hata: 'Kaynak, başlık, açıklama, sorumlu ve hedef tarih zorunludur.' });
    if (g.olay && !UUID.test(g.olay)) return y.code(400).send({ hata: 'Olay kaydı geçersizdir.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const no = `PRB-${new Date().getFullYear()}-${String(await sayac(c, 'problem_kaydi')).padStart(4, '0')}`;
      const r = (await c.query(`INSERT INTO problem_kaydi (problem_no, kaynak, baslik, aciklama, sorumlu_ref, hedef_tarih, gecici_cozum, olay_ref, acan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [no, g.kaynak, g.baslik.trim(), g.aciklama.trim(), g.sorumlu, g.hedef, g.geciciCozum?.trim() || null, g.olay ?? null, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Problem Kaydı', kategori: 'gorev', baslik: `${no} · ${g.baslik.trim()}`, sahipKullanici: g.sorumlu, sonZaman: new Date(g.hedef!), nesneTuru: 'Problem', nesneKimligi: r.kimlik });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, no };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
  s.post('/problem-kaydi/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kokNeden?: string; cozum?: string };
    if (!UUID.test(id) || !(await yetkili(o.kullanici))) return yok(y);
    if (!g.kokNeden?.trim() || !g.cozum?.trim()) return y.code(400).send({ hata: 'Kök neden ve kalıcı çözüm zorunludur.' });
    const r = await b.db.query(`UPDATE problem_kaydi SET durum = 'Kapalı', kok_neden = $2, kalici_cozum = $3, kapanis_zamani = now() WHERE kimlik = $1 AND durum = 'Açık'`, [id, g.kokNeden.trim(), g.cozum.trim()]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu kayıt kapanmıştır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Problem Kaydı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Problem Kapatıldı', nesneTuru: 'Problem', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-1293: aynı kök nedenli bulgular ilişkilidir; kapanış bağımsız doğrulama ister; istisna süreli, kalan risk kayıtlıdır.
  s.post('/sistem-bulgusu', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as Record<string, string | undefined>;
    if (!(await yetkili(o.kullanici))) return yok(y);
    const Z = [g.kosul, g.olcut, g.kanit, g.neden, g.kapsam, g.kokNeden].map((x) => x?.trim());
    if (Z.some((x) => !x) || !g.sorumlu || !TARIH.test(g.hedef ?? '') || !(await icKullanici(g.sorumlu))) return y.code(400).send({ hata: 'Koşul, ölçüt, kanıt, neden/risk, kapsam, kök neden, sorumlu ve hedef tarih zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const no = `BLG-${new Date().getFullYear()}-${String(await sayac(c, 'sistem_bulgusu')).padStart(4, '0')}`;
      const r = (await c.query(`INSERT INTO sistem_bulgusu (bulgu_no, kosul, olcut, kanit, neden_risk, kapsam, kok_neden, sorumlu_ref, hedef_tarih, acan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`, [no, ...Z, g.sorumlu, g.hedef, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Sistem Bulgusu', kategori: 'gorev', baslik: `${no} · Denetim Bulgusu`, sahipKullanici: g.sorumlu, sonZaman: new Date(g.hedef!), nesneTuru: 'Bulgu', nesneKimligi: r.kimlik });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, no };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
  s.post('/sistem-bulgusu/:id/istisna', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { bitis?: string; kalanRisk?: string };
    if (!UUID.test(id) || !(await yetkili(o.kullanici))) return yok(y);
    if (!TARIH.test(g.bitis ?? '') || !(new Date(g.bitis!).getTime() > Date.now()) || !g.kalanRisk?.trim()) return y.code(400).send({ hata: 'Gelecek bir bitiş tarihi ve kalan risk zorunludur.' });
    const r = await b.db.query(`UPDATE sistem_bulgusu SET durum = 'İstisna', istisna_bitis = $2, kalan_risk = $3, istisna_veren_ref = $4 WHERE kimlik = $1 AND durum = 'Açık' AND sorumlu_ref <> $4`, [id, g.bitis, g.kalanRisk.trim(), o.kullanici]);
    return r.rowCount ? { tamam: true } : y.code(409).send({ hata: 'İstisna açık bulguya, sorumlu dışından verilir.' });
  });
  s.post('/sistem-bulgusu/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { dogrulama?: string };
    if (!UUID.test(id) || !(await yetkili(o.kullanici))) return yok(y);
    if (!g.dogrulama?.trim()) return y.code(400).send({ hata: 'Bağımsız test veya kaynak kanıt zorunludur.' });
    const k = (await b.db.query(`SELECT sorumlu_ref FROM sistem_bulgusu WHERE kimlik = $1`, [id])).rows[0]; if (!k) return yok(y);
    if (k.sorumlu_ref === o.kullanici) return y.code(403).send({ hata: 'Düzeltmeyi yapan kapatamaz; doğrulama bağımsız olmalıdır.' });
    const r = await b.db.query(`UPDATE sistem_bulgusu SET durum = 'Kapalı', dogrulama_kaniti = $2, dogrulayan_ref = $3, kapanis_zamani = now() WHERE kimlik = $1 AND durum IN ('Açık', 'İstisna')`, [id, g.dogrulama.trim(), o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu kayıt kapanmıştır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Sistem Bulgusu' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    return { tamam: true };
  });
}
