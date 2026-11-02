import type { FastifyInstance } from 'fastify';
import { izYaz } from './denetim.js';
import { kayitNo } from './erisim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami } from './makam.js';
import { kullaniciRolleri } from './yetki.js';

const EN_COK_GUN = 30; // YG-1056
const NEDEN = ['İzin', 'Hastalık', 'Görev değişikliği', 'Ayrılık', 'Ulaşım veya olağanüstü durum'];

interface Satir { kullanici: string; ad_soyad: string; rol: string; rol_adi: string; birim: string; kademe: string }

export function vekaletYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };

  const icKadro = async (): Promise<Satir[]> => (await b.db.query(
    `SELECT a.kullanici_ref AS kullanici, h.ad_soyad, r.kimlik AS rol, r.rol_adi, r.rol_sahibi_birim AS birim, r.kademe FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref
      WHERE h.kullanici_grubu = 'LGM İç Rolü' AND h.hesap_durumu = 'Aktif' AND a.atama_durumu = 'Aktif' AND a.baslangic_tarihi <= current_date AND (a.bitis_tarihi IS NULL OR a.bitis_tarihi >= current_date) ORDER BY h.ad_soyad`)).rows;

  /** YG-1478: önce aynı rol veya aynı kademe; Müdür ve Müdür Yardımcısı birbirine; yoksa ilk dolu üst kademe. YG-1058: Genel Müdür Yardımcısı CEO'ya vekâlet eder. */
  async function uygunMu(asil: Satir, aday: Satir) {
    if (aday.kullanici === asil.kullanici) return false;
    if (aday.rol === asil.rol) return true;
    if (asil.rol_adi === 'CEO') return aday.rol_adi === 'Genel Müdür Yardımcısı' || aday.rol_adi === 'Teknik ve Operasyon Direktörü';
    if (aday.birim === asil.birim && aday.kademe === asil.kademe) return true;
    const cift = new Set(['Müdür', 'Müdür Yardımcısı']);
    if (aday.birim === asil.birim && cift.has(aday.kademe) && cift.has(asil.kademe)) return true;
    return (await onayMakami(b.db, asil.rol)) === aday.rol;
  }

  /** Vekili birim amiri atar (YG-1478). */
  async function altimdakiler(kullanici: string) {
    const benim = new Set((await kullaniciRolleri(b.db, kullanici)).map((r) => r.kimlik));
    const kadro = await icKadro(); const alt: Satir[] = [];
    for (const k of kadro) if (benim.has(await onayMakami(b.db, k.rol)) && (k.kullanici !== kullanici || k.rol_adi === 'CEO')) alt.push(k);
    return { alt, kadro };
  }

  s.get('/vekalet', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    const { alt, kadro } = await altimdakiler(o.kullanici);
    const secenek = [];
    for (const a of alt) {
      const vekiller: { kimlik: string; ad: string; rol: string }[] = [];
      for (const k of kadro) if (await uygunMu(a, k) && !vekiller.some((v) => v.kimlik === k.kullanici)) vekiller.push({ kimlik: k.kullanici, ad: k.ad_soyad, rol: k.rol_adi });
      secenek.push({ kimlik: a.kullanici, ad: a.ad_soyad, rol: a.rol, rolAdi: a.rol_adi, vekiller });
    }
    const l = await b.db.query(
      `SELECT v.kimlik, v.baslangic_tarihi::text AS baslangic, v.bitis_tarihi::text AS bitis, v.durum, v.vekalet_nedeni AS neden, a.ad_soyad AS asil, w.ad_soyad AS vekil, r.rol_adi AS rol, v.atayan_ref = $1 AS benim
         FROM vekalet v JOIN kullanici_hesabi a ON a.kimlik = v.asil_ref JOIN kullanici_hesabi w ON w.kimlik = v.vekil_ref JOIN rol r ON r.kimlik = v.rol_ref
        WHERE $1 IN (v.asil_ref, v.vekil_ref, v.atayan_ref) ORDER BY v.olusturma_zamani DESC LIMIT 50`, [o.kullanici]);
    return { secenek, kayitlar: l.rows };
  });

  s.post('/vekalet', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    const { asil, rol, vekil, neden, kapsam, baslangic, bitis } = (i.body ?? {}) as Record<string, string | undefined>;
    if (!asil || !rol || !vekil || !neden || !kapsam?.trim() || !baslangic || !bitis) return y.code(400).send({ hata: 'Asıl görevli, vekil, neden, kapsam ve tarihler zorunludur.' });
    if (!NEDEN.includes(neden)) return y.code(400).send({ hata: 'Geçersiz neden.' });
    const d1 = new Date(baslangic), d2 = new Date(bitis);
    const gun = (d2.getTime() - d1.getTime()) / 86_400_000;
    if (!Number.isFinite(gun) || gun < 0) return y.code(400).send({ hata: 'Tarihler geçersizdir.' });
    if (gun > EN_COK_GUN) return y.code(400).send({ hata: 'Vekâlet en fazla 30 gün olabilir.' });
    const { alt, kadro } = await altimdakiler(o.kullanici);
    const a = alt.find((x) => x.kullanici === asil && x.rol === rol);
    if (!a) return y.code(403).send({ hata: 'Bu görevli için vekil atama yetkiniz bulunmamaktadır.' });
    const adaylar = kadro.filter((k) => k.kullanici === vekil);
    let uygun = false; for (const k of adaylar) if (await uygunMu(a, k)) uygun = true;
    if (!uygun) return y.code(400).send({ hata: 'Seçilen kişi bu role vekâlet edemez.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const cakisan = await c.query(`SELECT 1 FROM vekalet WHERE asil_ref = $1 AND rol_ref = $2 AND durum = 'Aktif' AND baslangic_tarihi <= $4 AND bitis_tarihi >= $3`, [asil, rol, baslangic, bitis]);
      if (cakisan.rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu tarihlerde görevlinin aktif vekâleti bulunmaktadır.' }); }
      const id = await kayitNo(c, 'VKL');
      await c.query(`INSERT INTO vekalet (kimlik, asil_ref, vekil_ref, rol_ref, vekalet_nedeni, kapsam, baslangic_tarihi, bitis_tarihi, atayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, asil, vekil, rol, neden, kapsam.trim(), baslangic, bitis, o.kullanici]);
      for (const k of [asil, vekil]) await c.query(`INSERT INTO bildirim (kullanici_ref, baslik, ozet) VALUES ($1,$2,$3)`, [k, `Vekâlet · ${id}`, `${a.rol_adi} · ${baslangic.split('-').reverse().join('.')} – ${bitis.split('-').reverse().join('.')}`]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Vekâlet Atandı', nesneTuru: 'vekalet', nesneKimligi: id, yeni: { asil, vekil, rol, baslangic, bitis }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: id };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.post('/vekalet/:id/bitir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const r = await b.db.query(`UPDATE vekalet SET durum = 'Kapalı', kapanis_zamani = now() WHERE kimlik = $1 AND atayan_ref = $2 AND durum = 'Aktif' RETURNING vekil_ref`, [id, o.kullanici]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Vekâlet Sonlandırıldı', nesneTuru: 'vekalet', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
