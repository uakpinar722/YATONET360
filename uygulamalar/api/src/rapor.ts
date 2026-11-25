import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { belgeUret } from './belge_uret.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { kapanisKapisi } from './saha.js';
import { altNumara, sayac, teklifSayaciBaslat } from './sure.js';
import { yururlukSurumu } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const SAAT: Record<string, string> = { Kritik: 'rapor_sure_saat_kritik', Yüksek: 'rapor_sure_saat_yuksek', Normal: 'rapor_sure_saat_normal', Planlı: 'rapor_sure_saat_planli' };

/** YG-1518, YG-1519: rapor ve fiyat son zamanı dosya önceliğinden hesaplanır. */
export async function raporSonZamani(db: Db, oncelik: string, baslangic: Date): Promise<Date> {
  const s = Number((await db.query(`SELECT deger FROM sistem_parametresi WHERE kod = $1`, [SAAT[oncelik] ?? SAAT.Normal])).rows[0].deger);
  return new Date(baslangic.getTime() + s * 3_600_000);
}

/** YG-200: teklif silsilesi raporun Teknik Müdür Yardımcısı ve Teknik Müdür kontrolünü beklemez; Teknik Yönetici kontrolü geçmiş rapor yeterlidir. Hasar dosyasında aranır. */
export async function raporEngeli(db: Db, dosya: string): Promise<string | null> {
  const d = (await db.query(`SELECT hizmet_turu FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  if (d.hizmet_turu !== 'Hasar onarımı') return null;
  const r = await db.query(`SELECT 1 FROM teknik_rapor t LEFT JOIN is_karti k ON k.tur = 'Teknik Rapor' AND k.nesne_kimligi = t.kimlik::text WHERE t.dosya_ref = $1 AND (t.durum = 'Onaylı' OR (t.durum = 'Kontrolde' AND k.kademe >= 1)) LIMIT 1`, [dosya]);
  return r.rowCount ? null : 'Teklif için Teknik Yönetici kontrolünden geçmiş Teknik Rapor bekleniyor.';
}

export const RAPOR_REVIZYON_NEDENLERI = ['Kontrol iadesi', 'Yeni teknik bulgu', 'Ölçüm veya yazım hatası'];

kapanisKaydet('Teknik Rapor', async (c, k, karar) => {
  const durum = karar === 'Onayla' ? 'Onaylı' : karar === 'Reddet' ? 'Reddedildi' : karar === 'Gerekçeyle İade Et' ? 'İade Edildi' : karar === 'Yeniden Gönder' ? 'Kontrolde' : karar === 'Geri Çek' ? 'Geri Çekildi' : null;
  if (durum) await c.query(`UPDATE teknik_rapor SET durum = $2 WHERE kimlik = $1`, [k.nesne_kimligi, durum]);
  if (karar === 'Onayla') { const d = (await c.query(`SELECT dosya_ref FROM teknik_rapor WHERE kimlik = $1`, [k.nesne_kimligi])).rows[0]; await belgeUret(c, { tur: 'Teknik Rapor', nesne: k.nesne_kimligi!, dosya: d.dosya_ref }); }
});

kapanisKaydet('Kart Önerisi', async (c, k, karar) => {
  const o = (await c.query(`SELECT * FROM kart_onerisi WHERE kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!o) return;
  if (karar === 'Reddet') { await c.query(`UPDATE kart_onerisi SET durum = 'Reddedildi' WHERE kimlik = $1`, [o.kimlik]); return; }
  if (karar !== 'Onayla') return;
  // YG-857: kod tali branş koduna bağlıdır (<tali kod>-NN); NN tüm sürümlerde ve önerilerde verilmiş en büyük numaranın bir fazlası, kod yeniden kullanılmaz.
  const on = (await c.query(`SELECT regexp_replace(kod, '-[0-9]+$', '') onek FROM kartela_kalemi WHERE ana_brans = $1 AND alt_brans = $2 AND tali_brans = $3 ORDER BY kod LIMIT 1`, [o.ana_brans, o.alt_brans, o.tali_brans])).rows[0]?.onek as string | undefined;
  let kod: string;
  if (on) { const enb = Number((await c.query(`SELECT coalesce(max((regexp_match(kod, '-([0-9]+)$'))[1]::int), 0) n FROM (SELECT kod FROM kartela_kalemi WHERE kod LIKE $1 || '-%' UNION ALL SELECT kod FROM kart_onerisi WHERE kod LIKE $1 || '-%') x`, [on])).rows[0].n); kod = `${on}-${String(enb + 1).padStart(2, '0')}`; }
  else kod = `KO-${String(await sayac(c, 'kart_onerisi')).padStart(5, '0')}`; // tali kodu bulunamayan eski öneriler için
  const sur = await yururlukSurumu(c);
  await c.query(`INSERT INTO kartela_kalemi (kod, surum, ana_brans, alt_brans, tali_brans, islem, birim, maliyet_eur, maliyet_tarihi, kaynak_norm) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(now() AT TIME ZONE 'Europe/Istanbul')::date,'Kart önerisi')`, [kod, sur, o.ana_brans, o.alt_brans, o.tali_brans, o.islem, o.birim, o.maliyet_eur]);
  await c.query(`UPDATE kart_onerisi SET durum = 'Eklendi', kod = $2 WHERE kimlik = $1`, [o.kimlik, kod]);
  await bildir(c, { olay: `kart-oneri:${o.kimlik}`, kullanicilar: [o.hazirlayan_ref], baslik: `Kartela Kodu Hazır: ${kod}` });
});

// Keşif yapılan her hasar dosyasında en az bir onaylı rapor (Alan Sözlüğü, teknik_rapor).
kapanisKapisi(async (db, d) => {
  const kesif = (await db.query(`SELECT 1 FROM kesif k JOIN dosya f ON f.kimlik = k.dosya_ref WHERE k.dosya_ref = $1 AND k.durum = 'Tamamlandı' AND f.hizmet_turu = 'Hasar onarımı' LIMIT 1`, [d.kimlik])).rowCount;
  if (!kesif) return null;
  return (await db.query(`SELECT 1 FROM teknik_rapor WHERE dosya_ref = $1 AND durum = 'Onaylı' LIMIT 1`, [d.kimlik])).rowCount ? null : 'Teknik Rapor Bekliyor';
});

// YG-078: uygulamaya geçmiş (ON/EK iş emri yayımlanmış) hasar dosyası onaylı fiyat teklifi olmadan kapanmaz; işe başlamadan vazgeçilen dosyada aranmaz.
kapanisKapisi(async (db, d) => {
  const uyg = (await db.query(`SELECT 1 FROM is_emri e JOIN dosya f ON f.kimlik = e.dosya_ref WHERE e.dosya_ref = $1 AND f.hizmet_turu = 'Hasar onarımı' AND e.is_emri_turu IN ('ON', 'EK') AND e.statu NOT IN ('Taslak', 'İç Onayda', 'İptal') LIMIT 1`, [d.kimlik])).rowCount;
  if (!uyg) return null;
  return (await db.query(`SELECT 1 FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu = 'Karar' AND karar <> 'Ret' LIMIT 1`, [d.kimlik])).rowCount ? null : 'Fiyat Teklifi Bekliyor';
});

export function raporYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const firmam = async (k: string) => (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [k])).rows[0]?.kurulus_ref as string | undefined;
  const firmaIsi = async (id: string, k: string) => { const f = await firmam(k); if (!f || !UUID.test(id)) return undefined; return (await b.db.query(`SELECT e.*, d.dosya_no, d.oncelik, d.dosya_sorumlusu_ref FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kimlik = $1 AND e.kurulus_ref = $2`, [id, f])).rows[0]; };

  // YG-1518, YG-428, YG-429: fiyat içermez; Firma Değerlendirmesi zorunlu; son zaman portalda görünür.
  s.get('/firma-portal/is-emri/:id/teknik-rapor', oturumlu, async (i, y) => {
    const e = await firmaIsi((i.params as { id: string }).id, i.oturum!.kullanici);
    if (!e) return yok(y);
    const r = (await b.db.query(`SELECT rapor_no, firma_onayi FROM firma_teknik_raporu WHERE is_emri_ref = $1`, [e.kimlik])).rows[0];
    return { rapor: r ?? null, sonZaman: await raporSonZamani(b.db, e.oncelik, new Date(e.firma_kabul_zamani ?? e.olusturma_zamani ?? Date.now())) };
  });
  s.post('/firma-portal/is-emri/:id/teknik-rapor', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await firmaIsi((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { tarih?: string; bulgular?: string; oneriler?: string; malzeme?: string; sure?: number; degerlendirme?: string; resmiOnay?: boolean; miktarlar?: { kalem?: string; miktar?: number | string; birim?: string }[]; fotograflar?: string[] };
    if (!e) return yok(y);
    if (e.is_emri_turu !== 'KN') return y.code(409).send({ hata: 'Firma Teknik Raporu keşif iş emrinde girilir.' });
    if (!g.tarih || !g.bulgular?.trim() || !g.oneriler?.trim() || !(Number(g.sure) > 0) || !g.degerlendirme?.trim()) return y.code(400).send({ hata: 'İnceleme tarihi, bulgular, önerilen işlemler, tahmini süre ve Firma Değerlendirmesini yazmanızı rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM firma_teknik_raporu WHERE is_emri_ref = $1`, [e.kimlik])).rowCount) return y.code(409).send({ hata: 'Bu iş emrinin raporu kayıtlıdır.' });
    // YG-427: iş kalemi miktarları ve iş emrine yüklenmiş fotoğraflar (isteğe bağlı) LGM teknik rapor önerisine aktarılır.
    const miktarlar = (g.miktarlar ?? []).map((x) => ({ kalem: String(x.kalem ?? '').trim(), miktar: Number(String(x.miktar ?? '').replace(',', '.')), birim: String(x.birim ?? '').trim() })).filter((x) => x.kalem || x.birim);
    if (miktarlar.some((x) => !x.kalem || !x.birim || !(x.miktar > 0))) return y.code(400).send({ hata: 'Her miktar satırında iş kalemi, pozitif miktar ve birim giriniz.' });
    const fotograflar = [...new Set((g.fotograflar ?? []).filter((x) => UUID.test(x)))];
    if (fotograflar.length && Number((await b.db.query(`SELECT count(*) n FROM belge WHERE kimlik = ANY($1::uuid[]) AND bag_turu = 'İş Emri' AND bag_kimligi = $2`, [fotograflar, e.kimlik])).rows[0].n) !== fotograflar.length) return y.code(400).send({ hata: 'Fotoğraflar bu iş emrine yüklenmiş olmalıdır.' });
    // YG-1441: klaslı ya da ticari yatta firma "resmî / klas onayı gerekir mi" sorusunu yanıtlar.
    const kl = (await b.db.query(`SELECT y.klas_durumu, y.kullanim_amaci FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [e.dosya_ref])).rows[0];
    if ((kl?.klas_durumu === 'Evet' || kl?.kullanim_amaci === 'Charter') && typeof g.resmiOnay !== 'boolean') return y.code(400).send({ hata: 'Önerilen işlemler için resmî / klas onayı gerekip gerekmediğini belirtmenizi rica ederiz.' });
    return islem(async (c) => {
      const no = await altNumara(c, e.dosya_no, 'FR');
      await c.query(`INSERT INTO firma_teknik_raporu (rapor_no, dosya_ref, is_emri_ref, kurulus_ref, inceleme_tarihi, bulgular, onerilen_islemler, malzeme_ihtiyaci, tahmini_sure_gun, firma_degerlendirmesi, giren_ref, resmi_onay_gerekir, miktarlar, fotograflar) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [no, e.dosya_ref, e.kimlik, e.kurulus_ref, g.tarih, g.bulgular!.trim(), g.oneriler!.trim(), g.malzeme?.trim() ?? null, g.sure, g.degerlendirme!.trim(), o.kullanici, typeof g.resmiOnay === 'boolean' ? g.resmiOnay : null, JSON.stringify(miktarlar), fotograflar]);
      const tu = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)') AND bitis_zamani IS NULL`, [e.dosya_ref])).rows.map((r) => r.kullanici_ref as string);
      await bildir(c, { olay: `firma-rapor:${e.kimlik}`, kullanicilar: tu, baslik: `${e.dosya_no} · Firma Teknik Raporu Geldi` });
      await teklifSayaciBaslat(c, e.dosya_ref); // YG-199
      return { raporNo: no };
    });
  });

  // YG-200, YG-280, YG-427: firma girdisi rapora kendiliğinden gelir; LGM yalnız düzeltir, düzeltme kayda geçer. Firma raporu dışa giden rapora yazılmaz.
  // YG-280: firma raporundan aktarılıp LGM'ce düzeltilen öneriler cetvel satırı taslağı olarak döner (firma raporu dışa gitmez).
  s.get('/dosya/:id/rapor-onerileri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const r = (await b.db.query(`SELECT rapor_no, oneriler FROM teknik_rapor WHERE dosya_ref = $1 AND oneriler IS NOT NULL ORDER BY (durum = 'Onaylı') DESC, olusturma_zamani DESC LIMIT 1`, [id])).rows[0];
    if (!r) return { rapor: null, satirlar: [] };
    return { rapor: r.rapor_no, satirlar: String(r.oneriler).split(/\r?\n|;/).map((x) => x.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean) };
  });
  s.get('/dosya/:id/teknik-rapor', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const rapor = (await b.db.query(`SELECT t.kimlik, t.rapor_no, t.surum, t.rapor_turu, t.durum, t.son_zaman, t.revizyon_nedeni, (SELECT p.rapor_no FROM teknik_rapor p WHERE p.kimlik = t.onceki_surum_ref) onceki_surum, k.kademe, cardinality(k.zincir) AS kademe_sayisi FROM teknik_rapor t LEFT JOIN is_karti k ON k.tur = 'Teknik Rapor' AND k.nesne_kimligi = t.kimlik::text WHERE t.dosya_ref = $1 ORDER BY t.olusturma_zamani DESC`, [id])).rows;
    const firma = (await b.db.query(`SELECT f.kimlik, f.rapor_no, f.inceleme_tarihi::text, f.bulgular, f.onerilen_islemler, f.malzeme_ihtiyaci, f.tahmini_sure_gun, f.firma_degerlendirmesi, f.miktarlar, (SELECT coalesce(json_agg(json_build_object('kimlik', e.kimlik, 'ad', e.ad) ORDER BY e.ad), '[]') FROM belge e WHERE e.kimlik = ANY(f.fotograflar)) fotograflar FROM firma_teknik_raporu f WHERE f.dosya_ref = $1 ORDER BY f.firma_onayi DESC LIMIT 1`, [id])).rows[0] ?? null;
    // YG-427: malzeme ihtiyacı, tahmini süre ve yat bilgisi de forma aktarılır.
    const yat = (await b.db.query(`SELECT y.yat_adi, coalesce(m.marka || ' ' || m.model, nullif(concat_ws(' ', y.marka_diger, y.model_diger), '')) mm FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref WHERE d.kimlik = $1`, [id])).rows[0];
    const ek = firma ? [firma.malzeme_ihtiyaci ? `Malzeme İhtiyacı: ${firma.malzeme_ihtiyaci}` : '', firma.tahmini_sure_gun ? `Tahmini Süre: ${firma.tahmini_sure_gun} gün` : '',
      ...((firma.miktarlar ?? []) as { kalem: string; miktar: number; birim: string }[]).map((x) => `${x.kalem}: ${String(x.miktar).replace('.', ',')} ${x.birim}`)].filter(Boolean).join('\n') : ''; // YG-427: miktarlar
    return { raporlar: rapor, firmaRaporu: firma, oneri: firma ? { bulgular: firma.bulgular, oneriler: [firma.onerilen_islemler, ek].filter(Boolean).join('\n'), analiz: firma.firma_degerlendirmesi, incelenen: yat ? `Yat: ${yat.yat_adi}${yat.mm ? ` (${yat.mm})` : ''}` : '', fotograflar: firma.fotograflar } : null };
  });
  s.post('/dosya/:id/teknik-rapor', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as Record<string, string | undefined>;
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)') AND bitis_zamani IS NULL`, [id, o.kullanici])).rowCount) return y.code(403).send({ hata: 'Teknik Raporu dosyanın Teknik Uzmanı hazırlar.' });
    // YG-128: beyan ile gözlemi ayrıştırılmamış (teyit bekleyen) bulgu varken rapor kaydedilmez.
    if ((await b.db.query(`SELECT 1 FROM bulgu WHERE dosya_ref = $1 AND teyit_bekliyor LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Teyit bekleyen (beyan ile gözlemi ayrıştırılmamış) bulgu vardır; önce teyit ediniz.' });
    const tur = g.tur ?? 'İlk Rapor';
    if (!['İlk Rapor', 'Ek Teknik Rapor', 'Garanti İnceleme Raporu'].includes(tur)) return y.code(400).send({ hata: 'Rapor türünü seçiniz.' });
    if (['kapsam', 'incelenen', 'saha', 'yontem', 'bulgular', 'acikSorular', 'analiz', 'oneriler', 'uzmanlik'].some((a) => !g[a]?.trim())) return y.code(400).send({ hata: 'Raporun tüm zorunlu alanlarını doldurmanızı rica ederiz.' });
    // YG-714: ek inceleme gerektiren alan sorusu yanıtsız geçilemez.
    if (!['Evet', 'Hayır'].includes(g.ekInceleme ?? '')) return y.code(400).send({ hata: 'Ek inceleme gerektiren alan bulunup bulunmadığını belirtiniz.' });
    if (g.ekInceleme === 'Evet' && !g.ekIncelemeAlani?.trim()) return y.code(400).send({ hata: 'Ek inceleme gerektiren alanı yazınız.' });
    // YG-712: beyan edilen olay ile gözlenen teknik işaretlerin uyumu; uyumsuzluk olduğu gibi yazılır ve Hukuk ve Uyum'a bildirilir.
    if (!['Uyumlu', 'Kısmen Uyumlu', 'Uyumsuz'].includes(g.beyanUyum ?? '')) return y.code(400).send({ hata: 'Beyan–bulgu uyumunu seçiniz: Uyumlu, Kısmen Uyumlu, Uyumsuz.' });
    if (g.beyanUyum !== 'Uyumlu' && !g.uyumAciklamasi?.trim()) return y.code(400).send({ hata: 'Uyumsuzluğun açıklamasını yazınız.' });
    if ((await b.db.query(`SELECT 1 FROM teknik_rapor WHERE dosya_ref = $1 AND durum IN ('Kontrolde', 'İade Edildi') LIMIT 1`, [id])).rowCount) return y.code(409).send({ hata: 'Sonuçlanmamış bir rapor vardır.' });
    // YG-711: onaylı rapor değişmez; reddedilen veya geri çekilen raporun yerine yazılan rapor yeni sürümdür ve nedeni tanımlı listeden seçilir. Taraf talebi revizyon nedeni değildir.
    if (tur !== 'Ek Teknik Rapor' && (await b.db.query(`SELECT 1 FROM teknik_rapor WHERE dosya_ref = $1 AND rapor_turu = $2 AND durum = 'Onaylı' LIMIT 1`, [id, tur])).rowCount) return y.code(409).send({ hata: 'Onaylı rapor değiştirilmez; yeni bilgi Ek Teknik Rapor ile verilir.' });
    const oncekiSurum = tur === 'Ek Teknik Rapor' ? undefined : (await b.db.query(`SELECT kimlik, rapor_no, surum, bulgular, oneriler FROM teknik_rapor WHERE dosya_ref = $1 AND rapor_turu = $2 AND durum IN ('Reddedildi', 'Geri Çekildi') ORDER BY surum DESC, olusturma_zamani DESC LIMIT 1`, [id, tur])).rows[0];
    if (oncekiSurum && (!RAPOR_REVIZYON_NEDENLERI.includes(g.revizyonNedeni ?? '') || !g.revizyonAciklamasi?.trim())) return y.code(400).send({ hata: `Önceki sürüm ${oncekiSurum.rapor_no} vardır; revizyon nedenini (${RAPOR_REVIZYON_NEDENLERI.join(', ')}) ve açıklamasını yazınız. Taraf talebi revizyon nedeni değildir.` });
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no, oncelik, yazisma_dili FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const f = (await c.query(`SELECT kimlik, bulgular, onerilen_islemler, firma_onayi FROM firma_teknik_raporu WHERE dosya_ref = $1 ORDER BY firma_onayi DESC LIMIT 1`, [id])).rows[0];
      const ana = tur === 'Ek Teknik Rapor' ? (await c.query(`SELECT kimlik FROM teknik_rapor WHERE dosya_ref = $1 AND rapor_turu = 'İlk Rapor' AND durum = 'Onaylı' LIMIT 1`, [id])).rows[0]?.kimlik : null;
      if (tur === 'Ek Teknik Rapor' && !ana) throw Object.assign(new Error('Ek Teknik Rapor için onaylı İlk Rapor bekleniyor.'), { statusCode: 409 });
      // YG-095: rapor aynı yatın önceki dosyalarındaki onaylı raporlara atıf yapabilir.
      const onceki = Array.isArray((i.body as { oncekiRaporlar?: unknown })?.oncekiRaporlar) ? ((i.body as { oncekiRaporlar: string[] }).oncekiRaporlar).filter((x) => UUID.test(x)) : [];
      if (onceki.length && Number((await c.query(`SELECT count(*) n FROM teknik_rapor r JOIN dosya x ON x.kimlik = r.dosya_ref WHERE r.kimlik = ANY($1::uuid[]) AND r.durum = 'Onaylı' AND x.yat_ref = (SELECT yat_ref FROM dosya WHERE kimlik = $2) AND x.kimlik <> $2`, [onceki, id])).rows[0].n) !== onceki.length) throw Object.assign(new Error('Atıf yalnız aynı yatın önceki dosyalarındaki onaylı raporlara yapılır.'), { statusCode: 400 });
      const no = await altNumara(c, d.dosya_no, 'TR');
      const son = f ? await raporSonZamani(c, d.oncelik, new Date(f.firma_onayi)) : null;
      const r = (await c.query(`INSERT INTO teknik_rapor (rapor_no, rapor_turu, ana_rapor_ref, dosya_ref, dayanak_firma_raporu_ref, kapsam, incelenen_alan, saha_kosullari, yontem_olcut, bulgular, acik_sorular, analiz_risk, oneriler, uzmanlik_siniri, rapor_dili, son_zaman, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING kimlik`, [no, tur, ana, id, f?.kimlik ?? null, g.kapsam!.trim(), g.incelenen!.trim(), g.saha!.trim(), g.yontem!.trim(), g.bulgular!.trim(), g.acikSorular!.trim(), g.analiz!.trim(), g.oneriler!.trim(), g.uzmanlik!.trim(), d.yazisma_dili ?? 'Türkçe', son, o.kullanici])).rows[0];
      if (onceki.length) await c.query(`UPDATE teknik_rapor SET onceki_raporlar = $2 WHERE kimlik = $1`, [r.kimlik, onceki]); // YG-095
      if (oncekiSurum) { // YG-711
        await c.query(`UPDATE teknik_rapor SET surum = $2, onceki_surum_ref = $3, revizyon_nedeni = $4, revizyon_aciklamasi = $5 WHERE kimlik = $1`, [r.kimlik, Number(oncekiSurum.surum) + 1, oncekiSurum.kimlik, g.revizyonNedeni, g.revizyonAciklamasi!.trim()]);
        await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teknik Rapor Revizyonu', nesneTuru: 'Teknik Rapor', nesneKimligi: r.kimlik, eski: { rapor: oncekiSurum.rapor_no, bulgular: oncekiSurum.bulgular, oneriler: oncekiSurum.oneriler }, yeni: { neden: g.revizyonNedeni, aciklama: g.revizyonAciklamasi!.trim(), bulgular: g.bulgular, oneriler: g.oneriler }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      }
      // YG-732: yapay zekâ taslağı iç kayıt olarak tutulur; giden raporda ve rapor yanıtlarında gösterilmez.
      const yz = (i.body as { yzTaslak?: unknown })?.yzTaslak; if (typeof yz === 'string' && yz.trim()) await c.query(`UPDATE teknik_rapor SET yz_taslagi = $2 WHERE kimlik = $1`, [r.kimlik, yz.trim().slice(0, 50_000)]);
      await c.query(`UPDATE teknik_rapor SET ek_inceleme_gerekir = $2, ek_inceleme_alani = $3 WHERE kimlik = $1`, [r.kimlik, g.ekInceleme === 'Evet', g.ekInceleme === 'Evet' ? g.ekIncelemeAlani!.trim() : null]); // YG-714
      await c.query(`UPDATE teknik_rapor SET beyan_bulgu_uyumu = $2, uyum_aciklamasi = $3 WHERE kimlik = $1`, [r.kimlik, g.beyanUyum, g.beyanUyum === 'Uyumlu' ? null : g.uyumAciklamasi!.trim()]); // YG-712
      if (g.beyanUyum === 'Uyumsuz') await kartAc(c, { tur: 'Beyan Bulgu Uyumsuzluğu', kategori: 'gorev', baslik: `${no} · Beyan ile Bulgu Uyumsuz`, ozet: g.uyumAciklamasi!.trim().slice(0, 200), oncelik: 'Yüksek', sahipRol: await rolId(c, 'Hukuk ve Uyum Uzmanı'), nesneTuru: 'Teknik Rapor', nesneKimligi: r.kimlik });
      if (f) {
        await c.query(`UPDATE firma_teknik_raporu SET lgm_inceleyen_ref = $2, lgm_inceleme_zamani = now() WHERE kimlik = $1`, [f.kimlik, o.kullanici]);
        const degisen = g.bulgular!.trim() !== f.bulgular || g.oneriler!.trim() !== f.onerilen_islemler;
        if (degisen) await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Raporu Düzeltildi', nesneTuru: 'Teknik Rapor', nesneKimligi: r.kimlik, eski: { bulgular: f.bulgular, oneriler: f.onerilen_islemler }, yeni: { bulgular: g.bulgular, oneriler: g.oneriler }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      }
      await kartAc(c, { tur: 'Teknik Rapor', baslik: `${no} · Teknik Rapor`, ozet: tur, oncelik: d.oncelik, sonZaman: son, hazirlayan: o.kullanici, zincir: [await rolId(c, 'Teknik Yönetici'), await rolId(c, 'Teknik Müdür Yardımcısı'), await rolId(c, 'Teknik Müdür')], nesneTuru: 'Teknik Rapor', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, raporNo: no };
    });
  });

  // YG-188: kartelada kodu olmayan kalem için Teknik Uzman öneri hazırlar; Ticari İşler Direktörü onaylayınca kartelaya eklenir.
  s.post('/dosya/:id/kart-onerisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ana?: string; alt?: string; tali?: string; islem?: string; birim?: string; maliyet?: number; gerekce?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2)`, [o.kullanici, ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)']])).rowCount) return y.code(403).send({ hata: 'Kart önerisini Teknik Uzman hazırlar.' });
    if (!g.ana?.trim() || !g.alt?.trim() || !g.tali?.trim() || !g.islem?.trim() || !g.birim?.trim() || !(Number(g.maliyet) > 0) || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Branş, işlem, birim, pozitif maliyet ve gerekçeyi yazmanızı rica ederiz.' }); // YG-859
    // YG-857: yeni kalem LGM-2026-013 listesindeki bir tali branşa bağlanır; kod o tali koddan üretilir.
    if (!(await b.db.query(`SELECT 1 FROM kartela_kalemi WHERE ana_brans = $1 AND alt_brans = $2 AND tali_brans = $3 LIMIT 1`, [g.ana.trim(), g.alt.trim(), g.tali.trim()])).rowCount) return y.code(400).send({ hata: 'Ana, alt ve tali branşı kartelada tanımlı branş listesinden seçiniz; kalem kodu tali branş koduna bağlanır.' });
    return islem(async (c) => {
      const r = (await c.query(`INSERT INTO kart_onerisi (dosya_ref, ana_brans, alt_brans, tali_brans, islem, birim, maliyet_eur, gerekce, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [id, g.ana!.trim(), g.alt!.trim(), g.tali!.trim(), g.islem!.trim(), g.birim!.trim(), g.maliyet, g.gerekce!.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Kart Önerisi', baslik: `Kartela Önerisi · ${g.islem!.trim()}`, ozet: g.gerekce!.trim(), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Ticari İşler Direktörü')], nesneTuru: 'Kart Önerisi', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik };
    });
  });
}
