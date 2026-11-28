import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const SICIL_ROLLER = ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı'];

export type TesisBilgisi = { yerlesim?: string; konumTuru?: string; mahalle?: string; adres?: string; il?: string; ilce?: string; kullanimDayanagi?: string; tesisSinifi?: string; geciciSaha?: boolean; mobilEkip?: boolean; kapaliAlan?: number; acikAlan?: number; enlem?: number; boylam?: number; konumDogrulugu?: string; malikIsletmeci?: string; azamiBoy?: number; hassasKonum?: boolean };
const KAPASITELI = ['Şube', 'Teknik Tesis', 'Depo/Sevk'];
const liste = async (c: Db, kod: string) => (await c.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = $1 ORDER BY sira`, [kod])).rows.map((r) => r.deger as string);
const sayi = (x: unknown) => x !== undefined && x !== null && x !== '' && Number.isFinite(Number(x));

/** YG-348 (V-1139): yerleşim türü ve kuruluş rol türüne göre koşullu zorunlu alanlar (Alan Sözlüğü, Tesis ve Şube). */
export async function tesisBilgisiHatasi(c: Db, kurulus: string, g: TesisBilgisi): Promise<string | null> {
  if (!(await liste(c, 'LST_YERLESIM_TURU')).includes(g.yerlesim ?? '')) return 'Yerleşim türünü seçiniz: Merkez, Şube, Teknik Tesis veya Depo/Sevk.';
  if (!(await liste(c, 'LST_KONUM_TURU')).includes(g.konumTuru ?? '')) return 'Konum türünü listeden seçiniz.';
  if (!g.adres?.trim() || !g.il?.trim() || !g.ilce?.trim() || !g.mahalle?.trim()) return 'Açık adres, il, ilçe ve mahalle zorunludur.';
  // Eşleşme tablosu ana veri yüklemesiyle gelir; tablo yüklüyken il-ilçe tabloda bulunmalıdır.
  if ((await c.query(`SELECT 1 FROM bolge_eslesme LIMIT 1`)).rowCount && !(await c.query(`SELECT 1 FROM bolge_eslesme WHERE lower(il) = lower($1) AND lower(ilce) = lower($2) UNION ALL SELECT 1 FROM il_varsayilan WHERE lower(il) = lower($1)`, [g.il.trim(), g.ilce.trim()])).rowCount) return 'İl ve ilçe İlçe-Bölge Eşleşmesi tablosunda bulunamadı.';
  if (KAPASITELI.includes(g.yerlesim!) && !(await liste(c, 'LST_KULLANIM_DAYANAGI')).includes(g.kullanimDayanagi ?? '')) return 'Şube, teknik tesis ve depo için kullanım dayanağını seçiniz.';
  if (g.yerlesim === 'Teknik Tesis') {
    if (!(await liste(c, 'LST_TESIS_SINIFI')).includes(g.tesisSinifi ?? '')) return 'Teknik tesis için tesis sınıfını seçiniz.';
    if (!sayi(g.kapaliAlan) || !sayi(g.acikAlan) || Number(g.kapaliAlan) < 0 || Number(g.acikAlan) < 0) return 'Teknik tesis için kapalı ve açık alanı (m²) yazınız.';
  }
  const koordinat = sayi(g.enlem) && sayi(g.boylam);
  if ((g.yerlesim === 'Teknik Tesis' || g.mobilEkip) && !koordinat) return 'Teknik tesis ve mobil ekip çıkış noktası için koordinat zorunludur.';
  if (koordinat && (Math.abs(Number(g.enlem)) > 90 || Math.abs(Number(g.boylam)) > 180)) return 'Koordinat geçersizdir.';
  if (koordinat && !g.konumDogrulugu?.trim()) return 'Koordinatın doğruluk düzeyini yazınız.';
  const rol = (await c.query(`SELECT kayit_rolu FROM kurulus WHERE kimlik = $1`, [kurulus])).rows[0]?.kayit_rolu as string | undefined;
  if (rol === 'Tesis' && (!g.malikIsletmeci?.trim() || !(Number(g.azamiBoy) > 0))) return 'Marina, tersane ve çekek sahası işletmecisi için malik/işletmeci ve yat kabul azami boyu zorunludur.';
  return null;
}
/** Kayda yazılacak değerler; teknik kapasite yalnız teknik tesiste tutulur (sanal ofis veya posta adresi kapasite göstermez). */
const tesisDegerleri = (g: TesisBilgisi) => { const tt = g.yerlesim === 'Teknik Tesis'; const kd = sayi(g.enlem) && sayi(g.boylam);
  return [g.yerlesim, g.konumTuru, g.mahalle!.trim(), g.adres!.trim(), g.il!.trim(), g.ilce!.trim(), KAPASITELI.includes(g.yerlesim!) ? g.kullanimDayanagi : null, tt ? g.tesisSinifi : null, g.geciciSaha === true, g.mobilEkip === true,
    tt ? Number(g.kapaliAlan) : null, tt ? Number(g.acikAlan) : null, kd ? Number(g.enlem) : null, kd ? Number(g.boylam) : null, kd ? g.konumDogrulugu!.trim() : null, g.malikIsletmeci?.trim() || null, Number(g.azamiBoy) > 0 ? Number(g.azamiBoy) : null, g.hassasKonum === true]; };
const BOLGE_SQL = `UPDATE firma_tesisi t SET bolge = coalesce((SELECT e.bolge FROM bolge_eslesme e WHERE lower(e.il) = lower(t.il) AND lower(e.ilce) = lower(t.ilce)), (SELECT v.bolge FROM il_varsayilan v WHERE lower(v.il) = lower(t.il))),
  hizmet_kumesi = coalesce((SELECT e.hizmet_kumesi FROM bolge_eslesme e WHERE lower(e.il) = lower(t.il) AND lower(e.ilce) = lower(t.ilce)), (SELECT v.hizmet_kumesi FROM il_varsayilan v WHERE lower(v.il) = lower(t.il))) WHERE t.kimlik = $1`;

/** TSK-1, YG-010: yeni tesis/şube kaydı sıradaki -Tnn kodunu alır (LGM-SC-00001-T01). YG-348: bölge ve hizmet kümesi il-ilçeden türetilir. */
export async function tesisEkle(c: Db, kurulus: string, g: { ad: string; adres?: string | null; il?: string | null; ilce?: string | null }, kaydeden: string | null) {
  const k = (await c.query(`SELECT sicil_no FROM kurulus WHERE kimlik = $1`, [kurulus])).rows[0];
  if (!k) return null;
  const sira = Number((await c.query(`SELECT coalesce(max(sira), 0) + 1 n FROM firma_tesisi WHERE kurulus_ref = $1`, [kurulus])).rows[0].n);
  if (sira > 99) throw Object.assign(new Error('Bir kuruluşa en çok 99 tesis kaydedilir.'), { statusCode: 409 });
  const kod = `${k.sicil_no}-T${String(sira).padStart(2, '0')}`;
  const r = (await c.query(`INSERT INTO firma_tesisi (kurulus_ref, sira, tesis_kodu, ad, adres, il, ilce, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [kurulus, sira, kod, g.ad.trim(), g.adres ?? null, g.il ?? null, g.ilce ?? null, kaydeden])).rows[0];
  await c.query(BOLGE_SQL, [r.kimlik]);
  return { kimlik: r.kimlik as string, tesisKodu: kod };
}

export function firmaTesisYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const sicilci = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, SICIL_ROLLER])).rowCount);
  const kendiKurumu = async (k: string, id: string) => Boolean((await b.db.query(`SELECT 1 FROM kurulus_kullanici WHERE kullanici_ref = $1 AND kurulus_ref = $2`, [k, id])).rowCount);

  // YG-348: tesis formunun seçim listeleri (yalnız sözlükteki değerler, YG-1379).
  s.get('/firma-tesis/secenekler', oturumlu, async (i, y) => {
    if (!(await sicilci(i.oturum!.kullanici))) return yok(y);
    return { yerlesim: await liste(b.db, 'LST_YERLESIM_TURU'), konum: await liste(b.db, 'LST_KONUM_TURU'), dayanak: await liste(b.db, 'LST_KULLANIM_DAYANAGI'), sinif: await liste(b.db, 'LST_TESIS_SINIFI') };
  });
  s.get('/firma/:id/tesis', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; const k = i.oturum!.kullanici;
    if (!UUID.test(id) || !((await sicilci(k)) || (await kendiKurumu(k, id)) || i.oturum!.grup === 'LGM İç Rolü')) return yok(y);
    // YG-348: koordinat yalnız Firma Yönetimi ve kuruluşun kendisine; diğer iç kullanıcılar koordinatı görmez.
    const tam = (await sicilci(k)) || (await kendiKurumu(k, id));
    return (await b.db.query(`SELECT kimlik, tesis_kodu, ad, adres, mahalle, il, ilce, bolge, hizmet_kumesi, yerlesim_turu, konum_turu, kullanim_dayanagi, tesis_sinifi, gecici_saha, mobil_ekip_cikis_noktasi, kapali_alan_m2, acik_alan_m2, malik_isletmeci, azami_boy_m, hassas_konum,
      CASE WHEN $2 THEN enlem::float8 END enlem, CASE WHEN $2 THEN boylam::float8 END boylam, CASE WHEN $2 THEN konum_dogrulugu END konum_dogrulugu, aktif FROM firma_tesisi WHERE kurulus_ref = $1 ORDER BY sira`, [id, tam])).rows;
  });
  s.post('/firma/:id/tesis', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as TesisBilgisi & { ad?: string };
    if (!UUID.test(id) || !(await sicilci(o.kullanici))) return yok(y);
    if (!g.ad?.trim()) return y.code(400).send({ hata: 'Tesis adı zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM kurulus WHERE kimlik = $1`, [id])).rowCount) return yok(y);
    const h = await tesisBilgisiHatasi(b.db, id, g); if (h) return y.code(400).send({ hata: h }); // YG-348
    const r = await tesisEkle(b.db, id, { ad: g.ad, adres: g.adres!.trim(), il: g.il!.trim(), ilce: g.ilce!.trim() }, o.kullanici);
    if (!r) return yok(y);
    await tesisBilgisiYaz(r.kimlik, g);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Tesis Kaydı', nesneTuru: 'Kuruluş', nesneKimligi: id, yeni: { tesisKodu: r.tesisKodu }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return r;
  });
  const tesisBilgisiYaz = async (kimlik: string, g: TesisBilgisi) => {
    await b.db.query(`UPDATE firma_tesisi SET yerlesim_turu = $2, konum_turu = $3, mahalle = $4, adres = $5, il = $6, ilce = $7, kullanim_dayanagi = $8, tesis_sinifi = $9, gecici_saha = $10, mobil_ekip_cikis_noktasi = $11,
      kapali_alan_m2 = $12, acik_alan_m2 = $13, enlem = $14, boylam = $15, konum_dogrulugu = $16, malik_isletmeci = $17, azami_boy_m = coalesce($18, azami_boy_m), hassas_konum = $19 WHERE kimlik = $1`, [kimlik, ...tesisDegerleri(g)]);
    await b.db.query(BOLGE_SQL, [kimlik]);
  };
  // YG-348: sicil başvurusundan veya eski kayıttan gelen eksik tesis bilgisi tamamlanır; eski ve yeni değer işlem izine yazılır.
  s.post('/firma-tesis/:id/yerlesim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as TesisBilgisi;
    if (!UUID.test(id) || !(await sicilci(o.kullanici))) return yok(y);
    const t = (await b.db.query(`SELECT * FROM firma_tesisi WHERE kimlik = $1`, [id])).rows[0]; if (!t) return yok(y);
    const h = await tesisBilgisiHatasi(b.db, t.kurulus_ref, g); if (h) return y.code(400).send({ hata: h });
    await tesisBilgisiYaz(id, g);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Tesis Bilgisi Güncellendi', nesneTuru: 'Tesis', nesneKimligi: id, eski: { yerlesim: t.yerlesim_turu, adres: t.adres, il: t.il, ilce: t.ilce, hassas: t.hassas_konum }, yeni: { yerlesim: g.yerlesim, adres: g.adres, il: g.il, ilce: g.ilce, hassas: g.hassasKonum === true }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/firma-tesis/:id/pasif', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await sicilci(o.kullanici))) return yok(y);
    const r = await b.db.query(`UPDATE firma_tesisi SET aktif = false WHERE kimlik = $1 AND aktif RETURNING tesis_kodu`, [id]);
    return r.rowCount ? { tamam: true } : yok(y);
  });
}
