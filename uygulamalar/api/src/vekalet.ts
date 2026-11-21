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
  /** YG-1744: uygun adayın öncelik basamağı (1 en öncelikli); uygun değilse null. */
  async function seviye(asil: Satir, aday: Satir): Promise<number | null> {
    if (aday.kullanici === asil.kullanici) return null;
    if (aday.rol === asil.rol) return 1;
    if (asil.rol_adi === 'CEO') { // YG-1058: T&O Direktörü yalnız CEO ve GMY birlikte yokken.
      if (aday.rol_adi === 'Genel Müdür Yardımcısı') return 2;
      if (aday.rol_adi !== 'Teknik ve Operasyon Direktörü') return null;
      return (await yokMu('Genel Müdür Yardımcısı')) ? 3 : null;
    }
    // YG-1660: BT ve Firma Yönetimi Direktörüne GMY ancak vekili Bilgi İşlem Müdürü de yokken vekâlet eder.
    if (asil.rol_adi === 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü' && aday.rol_adi === 'Genel Müdür Yardımcısı') return (await yokMu('Bilgi İşlem Müdürü')) ? 2 : null; // tablo vekili yokken GMY aynı basamakta
    // YG-1058: GMY ve Direktör vekilleri kritik pozisyon vekil tablosundan (LST_KRITIK_POZISYON_VEKILI); tablo vekili yoksa üst makam.
    if (asil.kademe === 'Direktör' || asil.rol_adi === 'Genel Müdür Yardımcısı') {
      const tablo = await kritikVekiller(asil.rol_adi);
      if (tablo.includes(aday.rol_adi)) return 2;
      return (await onayMakami(b.db, asil.rol)) === aday.rol ? 4 : null;
    }
    if (aday.birim === asil.birim && aday.kademe === asil.kademe) return 2;
    const cift = new Set(['Müdür', 'Müdür Yardımcısı']);
    if (aday.birim === asil.birim && cift.has(aday.kademe) && cift.has(asil.kademe)) return 3;
    return (await onayMakami(b.db, asil.rol)) === aday.rol ? 4 : null;
  }
  async function uygunMu(asil: Satir, aday: Satir) { return (await seviye(asil, aday)) !== null; }
  /** YG-1744: izinli, raporlu ya da bugün aktif vekâleti olan kişi öncelik hesabında aday sayılmaz. */
  async function kisiYok(k: string): Promise<boolean> {
    return Boolean((await b.db.query(`SELECT 1 FROM kullanici_hesabi h LEFT JOIN personel_karti p ON p.kullanici_ref = h.kimlik WHERE h.kimlik = $1 AND (p.personel_durumu IN ('İzinli', 'Raporlu', 'Görevlendirmede') OR EXISTS (SELECT 1 FROM vekalet v WHERE v.asil_ref = h.kimlik AND v.durum = 'Aktif' AND v.baslangic_tarihi <= current_date AND v.bitis_tarihi >= current_date))`, [k])).rowCount);
  }
  /** YG-1744: kadrodaki en öncelikli basamak; daha alt basamaktan vekil seçilemez. */
  async function enIyiSeviye(asil: Satir, kadro: Satir[]): Promise<number | null> {
    let en: number | null = null;
    for (const k of kadro) { if (await kisiYok(k.kullanici)) continue; const s = await seviye(asil, k); if (s !== null && (en === null || s < en)) en = s; }
    return en;
  }

  /** Rol sahibi izinli, raporlu ya da kendisi vekâlete bırakılmışsa yok sayılır. */
  async function yokMu(rolAdi: string): Promise<boolean> {
    return Boolean((await b.db.query(`SELECT 1 FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik JOIN rol x ON x.kimlik = a.rol_ref LEFT JOIN personel_karti p ON p.kullanici_ref = h.kimlik WHERE x.rol_adi = $1 AND a.atama_durumu = 'Aktif' AND (p.personel_durumu IN ('İzinli', 'Raporlu', 'Görevlendirmede') OR EXISTS (SELECT 1 FROM vekalet v WHERE v.asil_ref = h.kimlik AND v.durum = 'Aktif')) LIMIT 1`, [rolAdi])).rowCount);
  }

  async function kritikVekiller(rolAdi: string): Promise<string[]> {
    const r = (await b.db.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = 'LST_KRITIK_POZISYON_VEKILI' AND split_part(deger, ' → ', 1) = $1`, [rolAdi])).rows[0];
    return r ? String(r.deger).split(' → ')[1]!.split(' / ').map((x) => x.replace(/\s*\(.*\)$/, '').trim()) : [];
  }

  /** Vekili birim amiri atar (YG-1478). */
  async function altimdakiler(kullanici: string) {
    const benim = new Set((await kullaniciRolleri(b.db, kullanici)).map((r) => r.kimlik));
    const kadro = await icKadro(); const alt: Satir[] = [];
    for (const k of kadro) if (benim.has(await onayMakami(b.db, k.rol)) && (k.kullanici !== kullanici || k.rol_adi === 'CEO')) alt.push(k);
    return { alt, kadro };
  }

  // YG-1057: genel vekâlet tablosu; yürürlükteki rol vekâletleri ve izindeki personelin dosya/görev vekilleri. Neden (izin türü, hastalık) gösterilmez.
  s.get('/vekalet/tablo', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    return (await b.db.query(`SELECT 'Rol Vekâleti' tur, a.ad_soyad asil, w.ad_soyad vekil, r.rol_adi kapsam, v.baslangic_tarihi::text baslangic, v.bitis_tarihi::text bitis
        FROM vekalet v JOIN kullanici_hesabi a ON a.kimlik = v.asil_ref JOIN kullanici_hesabi w ON w.kimlik = v.vekil_ref JOIN rol r ON r.kimlik = v.rol_ref WHERE v.durum = 'Aktif' AND v.baslangic_tarihi <= current_date
      UNION ALL
      SELECT 'Dosya ve Görev Vekâleti', a.ad_soyad, w.ad_soyad, (SELECT count(*) FILTER (WHERE d.tur = 'Dosya') || ' dosya · ' || count(*) FILTER (WHERE d.tur = 'Görev') || ' görev' FROM izin_devri d WHERE d.izin_ref = t.kimlik), t.baslangic::text, t.bitis::text
        FROM izin_talebi t JOIN kullanici_hesabi a ON a.kimlik = t.personel_ref JOIN kullanici_hesabi w ON w.kimlik = t.vekil_ref WHERE t.devir_zamani IS NOT NULL AND t.geri_zamani IS NULL
      ORDER BY 1 DESC, 2 LIMIT 200`)).rows;
  });
  s.get('/vekalet', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    const { alt, kadro } = await altimdakiler(o.kullanici);
    const secenek = [];
    for (const a of alt) {
      const vekiller: { kimlik: string; ad: string; rol: string }[] = [];
      const en = await enIyiSeviye(a, kadro); // YG-1744: yalnız en öncelikli basamaktaki adaylar
      for (const k of kadro) if (en !== null && (await seviye(a, k)) === en && !vekiller.some((v) => v.kimlik === k.kullanici) && !(await kisiYok(k.kullanici))) vekiller.push({ kimlik: k.kullanici, ad: k.ad_soyad, rol: k.rol_adi }); // YG-1478: yalnız görevde olanlar
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
    let uygun = false; let sv: number | null = null; for (const k of adaylar) { const s = await seviye(a, k); if (s !== null) { uygun = true; sv = sv === null ? s : Math.min(sv, s); } }
    if (!uygun) return y.code(400).send({ hata: 'Bu role vekâlet için başka bir kişi seçmenizi rica ederiz.' });
    if (await kisiYok(vekil)) return y.code(400).send({ hata: 'Seçilen kişi izinli, raporlu, görevlendirmede veya kendisi vekâlete bırakılmış; görevde olan bir kişi seçmenizi rica ederiz.' }); // YG-1478
    { const en = await enIyiSeviye(a, kadro); if (en !== null && sv! > en) return y.code(400).send({ hata: 'Öncelikli vekil adayı vardır (sıra: aynı rol, aynı birim ve kademe, Müdür–Müdür Yardımcısı, onay makamı); listeden seçiniz.' }); } // YG-1744
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const cakisan = await c.query(`SELECT 1 FROM vekalet WHERE asil_ref = $1 AND rol_ref = $2 AND durum = 'Aktif' AND baslangic_tarihi <= $4 AND bitis_tarihi >= $3`, [asil, rol, baslangic, bitis]);
      if (cakisan.rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu tarihlerde görevlinin aktif vekâleti bulunmaktadır.' }); }
      const id = await kayitNo(c, 'VKL');
      // YG-1058: Hukuk ve Uyum Direktörüne aynı rol dışından vekâlet yalnız hazırlıktır; onaylar GMY'ye gider.
      const hazirlik = a.rol_adi === 'Hukuk ve Uyum Direktörü' && !adaylar.some((k) => k.rol === a.rol);
      await c.query(`INSERT INTO vekalet (kimlik, asil_ref, vekil_ref, rol_ref, vekalet_nedeni, kapsam, baslangic_tarihi, bitis_tarihi, atayan_ref, yalniz_hazirlik) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, asil, vekil, rol, neden, kapsam.trim(), baslangic, bitis, o.kullanici, hazirlik]);
      for (const k of [asil, vekil]) await c.query(`INSERT INTO bildirim (kullanici_ref, baslik, ozet) VALUES ($1,$2,$3)`, [k, `Vekâlet · ${id}`, `${a.rol_adi} · ${baslangic.split('-').reverse().join('.')} – ${bitis.split('-').reverse().join('.')}`]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Vekâlet Atandı', nesneTuru: 'vekalet', nesneKimligi: id, yeni: { asil, vekil, rol, baslangic, bitis }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: id };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.post('/vekalet/:id/bitir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const r = await b.db.query(`UPDATE vekalet SET durum = 'Kapalı', kapanis_zamani = now() WHERE kimlik = $1 AND atayan_ref = $2 AND durum = 'Aktif' RETURNING vekil_ref`, [id, o.kullanici]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Vekâlet Sonlandırıldı', nesneTuru: 'vekalet', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
