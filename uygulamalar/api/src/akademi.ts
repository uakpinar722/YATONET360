import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const IK = ['İnsan Kaynakları Müdürü', 'İnsan Kaynakları Sorumlusu']; const TURLER = ['Zorunlu', 'Oryantasyon', 'Rol Müfredatı'];
const HAZIRLIK = 'Deneme Süresi Değerlendirmesi'; const KARAR = 'Deneme Süresi Kararı';

/** YG-970: ilk amirden başlar; son karar personelde Direktör, müdürde GMY, direktörde CEO; hazırlayan son kararı vermez; İç Denetim Müdürü CEO'dadır. */
export async function denemeZinciri(db: Db, rolKimlik: string): Promise<string[]> {
  const r = (await db.query(`SELECT rol_adi, kademe, rol_sahibi_birim birim FROM rol WHERE kimlik = $1`, [rolKimlik])).rows[0];
  if (r.rol_adi === 'CEO' || r.rol_sahibi_birim === 'Üst Yönetim') return [];
  if (r.rol_adi === 'İç Denetim Müdürü') return [await rolId(db, 'CEO')];
  const GMY = await rolId(db, 'Genel Müdür Yardımcısı'); const m = await onayMakami(db, rolKimlik);
  if (r.kademe === 'Direktör') return [GMY, await rolId(db, 'CEO')];
  if (r.kademe === 'Müdür') return [m, GMY];
  const z: string[] = [];
  if (r.kademe !== 'Müdür Yardımcısı') { const my = (await db.query(`SELECT kimlik FROM rol WHERE rol_sahibi_birim = $1 AND kademe = 'Müdür Yardımcısı' LIMIT 1`, [r.birim])).rows[0]?.kimlik as string | undefined; if (my && my !== m && (await rolSahipleri(db, my)).length) z.push(my); }
  z.push(m);
  const mk = (await db.query(`SELECT kademe FROM rol WHERE kimlik = $1`, [m])).rows[0].kademe as string;
  z.push(mk === 'Direktör' ? GMY : await onayMakami(db, m));
  return z;
}

/** Deneme süresi işe girişten 2 ay; bitişten 2 hafta önce ilk amire görev düşer. */
export async function denemeIsle(db: Pool, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(`SELECT k.kullanici_ref, (k.ise_giris_tarihi + interval '2 months')::date bitis, h.ad_soyad FROM personel_karti k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.personel_durumu <> 'Ayrıldı' AND (k.ise_giris_tarihi + interval '2 months')::date BETWEEN $1::date AND $1::date + 14 AND NOT EXISTS (SELECT 1 FROM deneme_degerlendirme d WHERE d.personel_ref = k.kullanici_ref)`, [simdi]);
  let n = 0;
  for (const p of rows) {
    const rol = (await db.query(`SELECT a.rol_ref FROM rol_atamasi a WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' LIMIT 1`, [p.kullanici_ref])).rows[0]?.rol_ref as string | undefined;
    if (!rol) continue;
    const z = await denemeZinciri(db, rol); if (!z.length) continue;
    if (!(await birKez(db, 'deneme_degerlendirme', p.kullanici_ref))) continue;
    await db.query(`INSERT INTO deneme_degerlendirme (personel_ref, bitis_tarihi, zincir) VALUES ($1,$2,$3)`, [p.kullanici_ref, p.bitis, z]);
    await kartAc(db, { tur: HAZIRLIK, kategori: 'gorev', baslik: `${p.ad_soyad} · Deneme Süresi Değerlendirmesi`, sahipRol: z[0], sonZaman: new Date(p.bitis), nesneTuru: 'Personel', nesneKimligi: p.kullanici_ref }); n++;
  }
  return n;
}

kapanisKaydet(KARAR, async (c, k, karar) => {
  const d = (await c.query(`SELECT d.*, h.ad_soyad FROM deneme_degerlendirme d JOIN kullanici_hesabi h ON h.kimlik = d.personel_ref WHERE d.personel_ref = $1 AND d.durum = 'Onayda'`, [k.nesne_kimligi])).rows[0];
  if (!d) return;
  if (karar === 'Onayla') {
    await c.query(`UPDATE deneme_degerlendirme SET durum = 'Sonuçlandı', karar_zamani = now() WHERE personel_ref = $1`, [d.personel_ref]);
    const gmy = await rolSahipleri(c, await rolId(c, 'Genel Müdür Yardımcısı'));
    await bildir(c, { olay: `deneme-karar:${d.personel_ref}`, kullanicilar: gmy, baslik: `${d.ad_soyad} · Deneme Süresi Değerlendirmesi Sonuçlandı` });
  } else if (['Reddet', 'Gerekçeyle İade Et'].includes(karar)) {
    await c.query(`UPDATE deneme_degerlendirme SET durum = 'Hazırlanıyor' WHERE personel_ref = $1`, [d.personel_ref]);
    await kartAc(c, { tur: HAZIRLIK, kategori: 'gorev', baslik: `${d.ad_soyad} · Deneme Süresi Değerlendirmesi`, sahipRol: d.zincir[0], nesneTuru: 'Personel', nesneKimligi: d.personel_ref });
  }
});

export function akademiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);
  const ikMi = async (k: string) => (await roller(k)).some((r) => IK.includes(r));

  // YG-937, YG-938, YG-943: ders listesi kişinin rolüne göre; katılım personel beyanıyla, imza alınmaz.
  s.get('/akademi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const r = await roller(o.kullanici); const ik = r.some((x) => IK.includes(x));
    const dersler = (await b.db.query(`SELECT d.kimlik, d.ad, d.tur, d.icerik, d.surum, d.degisiklik_notu, EXISTS (SELECT 1 FROM akademi_beyan x WHERE x.ders_ref = d.kimlik AND x.surum = d.surum AND x.personel_ref = $1) beyan FROM akademi_ders d WHERE d.aktif AND (cardinality(d.roller) = 0 OR d.roller && $2::text[]) ORDER BY beyan, d.tur, d.ad`, [o.kullanici, r])).rows;
    const izleme = ik ? (await b.db.query(`SELECT d.kimlik, d.ad, d.surum, (SELECT count(*)::int FROM akademi_beyan x WHERE x.ders_ref = d.kimlik AND x.surum = d.surum) beyan, (SELECT count(DISTINCT a.kullanici_ref)::int FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.atama_durumu = 'Aktif' AND r.rol_sahibi_birim <> 'Dış Kullanıcı' AND (cardinality(d.roller) = 0 OR r.rol_adi = ANY(d.roller))) hedef FROM akademi_ders d WHERE d.aktif ORDER BY d.ad`)).rows : [];
    return { ik, dersler, izleme };
  });
  s.post('/akademi/ders', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ad?: string; tur?: string; icerik?: string; roller?: string[] };
    if (!(await ikMi(o.kullanici))) return yok(y);
    if (!g.ad?.trim() || !g.icerik?.trim() || !TURLER.includes(g.tur ?? '')) return y.code(400).send({ hata: 'Ders adı, türü ve içerik zorunludur.' });
    const r = await b.db.query(`INSERT INTO akademi_ders (ad, tur, icerik, roller, olusturan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.ad.trim(), g.tur, g.icerik.trim(), g.roller ?? [], o.kullanici]);
    return { kimlik: r.rows[0].kimlik };
  });
  // YG-938: revizyonda etkilenen rollere "ne değişti" bildirimi; okudum beyanı yeni sürüm için yeniden istenir.
  s.post('/akademi/ders/:id/revize', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { icerik?: string; degisiklik?: string };
    if (!UUID.test(id) || !(await ikMi(o.kullanici))) return yok(y);
    if (!g.icerik?.trim() || !g.degisiklik?.trim()) return y.code(400).send({ hata: 'İçerik ve ne değiştiği zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`UPDATE akademi_ders SET icerik = $2, degisiklik_notu = $3, surum = surum + 1 WHERE kimlik = $1 AND aktif RETURNING ad, surum, roller`, [id, g.icerik.trim(), g.degisiklik.trim()])).rows[0];
      if (!d) { await c.query('ROLLBACK'); return yok(y); }
      const kisiler = (await c.query(`SELECT DISTINCT a.kullanici_ref k FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.atama_durumu = 'Aktif' AND r.rol_sahibi_birim <> 'Dış Kullanıcı' AND (cardinality($1::text[]) = 0 OR r.rol_adi = ANY($1::text[]))`, [d.roller])).rows.map((r) => r.k as string);
      await bildir(c, { olay: `akademi:${id}:${d.surum}`, kullanicilar: kisiler, baslik: `Ne Değişti: ${d.ad}`, ozet: g.degisiklik.trim().slice(0, 200) });
      await c.query('COMMIT');
      return { surum: d.surum };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
  s.post('/akademi/ders/:id/beyan', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü') return yok(y);
    const r = await roller(o.kullanici);
    const d = (await b.db.query(`SELECT surum FROM akademi_ders WHERE kimlik = $1 AND aktif AND (cardinality(roller) = 0 OR roller && $2::text[])`, [id, r])).rows[0]; if (!d) return yok(y);
    const u = await b.db.query(`INSERT INTO akademi_beyan (ders_ref, surum, personel_ref) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING ders_ref`, [id, d.surum, o.kullanici]);
    if (!u.rowCount) return y.code(409).send({ hata: 'Bu ders için beyanınız kayıtlıdır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Eğitim Katılım Beyanı', nesneTuru: 'Akademi', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-970: ilk amir karne verisine dayanarak hazırlar, silsile devam eder.
  const hazirlayanMi = async (k: string, z: string[]) => (await rolSahipleri(b.db, z[0]!)).includes(k);
  s.get('/deneme/bekleyen', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const l = (await b.db.query(`SELECT d.personel_ref, d.bitis_tarihi::text, d.zincir, h.ad_soyad FROM deneme_degerlendirme d JOIN kullanici_hesabi h ON h.kimlik = d.personel_ref WHERE d.durum = 'Hazırlanıyor' AND d.personel_ref <> $1`, [o.kullanici])).rows;
    const r = []; for (const x of l) if (await hazirlayanMi(o.kullanici, x.zincir)) r.push({ personel: x.personel_ref, bitis: x.bitis_tarihi, ad: x.ad_soyad });
    return r;
  });
  s.post('/deneme/:personel/hazirla', oturumlu, async (i, y) => {
    const o = i.oturum!; const { personel } = i.params as { personel: string }; const g = (i.body ?? {}) as { oneri?: string; notlar?: string };
    const d = (await b.db.query(`SELECT d.zincir, h.ad_soyad FROM deneme_degerlendirme d JOIN kullanici_hesabi h ON h.kimlik = d.personel_ref WHERE d.personel_ref = $1 AND d.durum = 'Hazırlanıyor'`, [personel])).rows[0];
    if (!d || personel === o.kullanici || !(await hazirlayanMi(o.kullanici, d.zincir))) return yok(y);
    if (!['Devam', 'Sonlandırma'].includes(g.oneri ?? '') || !g.notlar?.trim()) return y.code(400).send({ hata: 'Öneri ve değerlendirme notu zorunludur.' });
    const kalan = (d.zincir as string[]).slice(1);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE deneme_degerlendirme SET oneri = $2, notlar = $3, hazirlayan_ref = $4, durum = $5, karar_zamani = CASE WHEN $5 = 'Sonuçlandı' THEN now() END WHERE personel_ref = $1`, [personel, g.oneri, g.notlar.trim(), o.kullanici, kalan.length ? 'Onayda' : 'Sonuçlandı']);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [HAZIRLIK, personel]);
      if (kalan.length) await kartAc(c, { tur: KARAR, baslik: `${d.ad_soyad} · Deneme Süresi Değerlendirmesi`, ozet: `Öneri: ${g.oneri}`, hazirlayan: o.kullanici, zincir: kalan, nesneTuru: 'Personel', nesneKimligi: personel });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
