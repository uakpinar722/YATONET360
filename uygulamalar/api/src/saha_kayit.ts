import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { birKez, bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { rolSahipleri } from './makam.js';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { performansOlayIsle } from './karne.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const KABUL = ['Kabul', 'Koşullu Kabul', 'Karantina', 'Ret'];
const SAPMA_TUR = ['Kapsam', 'Yöntem', 'Süre', 'Maliyet', 'Kalite', 'Güvenlik', 'Belge'];
const SAPMA_KARAR = ['İşi Durdur', 'Sınırlı Devam', 'Düzeltme', 'Değişiklik Talebi'];
const SAHA_ROLLERI = ['Saha Sorumlusu', 'Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Teknik Yönetici', 'Kalite Uzmanı (Kalite Kontrolör)', 'Kalite Müdürü'];
const PARCA_ROLLERI = ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Kalite Uzmanı (Kalite Kontrolör)', 'Tedarik Sorumlusu'];
const DENETIM_ROLLERI = ['Kalite Uzmanı (Kalite Kontrolör)', 'Kalite Müdürü', 'Firma Yönetimi Müdürü'];

export const EMNIYET_ALICILAR = ['Teknik Müdür', 'Operasyon Müdürü', 'Teknik ve Operasyon Direktörü', 'Genel Müdür Yardımcısı', 'CEO', 'İSG Uzmanı', 'Risk ve Kalite Direktörü'];
type Db = Pool | PoolClient;

/** YG-1437: işi durdurma ayrı olaydır, DS, TU ve OY'ye sistem içi ve e-posta. YG-262: emniyet durdurmasında üst alıcılara SMS ile. */
export async function isDurduBildir(c: Db, e: { kimlik: string; is_emri_no: string; dosya_ref: string }, neden: string, emniyet: boolean): Promise<void> {
  const ekip = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL AND rol IN ('Dosya Sorumlusu', 'Teknik Uzman', 'Operasyon Yöneticisi')`, [e.dosya_ref])).rows.map((r) => r.kullanici_ref as string);
  const al = [...ekip]; if (emniyet) for (const r of EMNIYET_ALICILAR) al.push(...await rolSahipleri(c, await rolId(c, r)));
  await bildir(c, { olay: `is-emri-durdu:${e.kimlik}:${Date.now()}`, kullanicilar: [...new Set(al)], baslik: `${emniyet ? 'Emniyet Olayı · ' : ''}İş Durduruldu: ${e.is_emri_no}`, ozet: neden.slice(0, 200), oncelik: emniyet ? 'Kritik' : 'Yüksek', eposta: true, sms: emniyet, acil: true });
}

/** YG-580: her mobilizasyonda TPL-07; keşif ve acil ilk tedbir toplantıyı beklemez. */
export async function baslangicToplantiEngeli(db: Db, isEmri: string, tur: string): Promise<string | null> {
  if (tur === 'KN' || tur === 'AC') return null;
  return (await db.query(`SELECT 1 FROM baslangic_toplantisi WHERE is_emri_ref = $1`, [isEmri])).rowCount ? null : 'Başlangıç toplantısı kaydı bekleniyor; Dosya Sorumlusunun kaydetmesini rica ederiz.';
}

/** YG-417: Teslim Talebi 24 saatte sonuçlanmazsa uyuşmazlık sayılır ve Operasyon Müdürüne yükselir. YG-350: firma yeniden değerlendirme görevi ve karne özeti. */
export async function sahaSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const { rows } = await db.query(`SELECT kimlik, baslik, nesne_kimligi FROM is_karti WHERE tur = 'Teslim Talebi' AND durum = 'Bekliyor' AND olusturma_zamani <= $1::timestamptz - interval '24 hours'`, [simdi]);
  for (const k of rows) {
    if (!(await birKez(db, 'Teslim Uyuşmazlığı', k.kimlik))) continue;
    await kartAc(db, { tur: 'Teslim Uyuşmazlığı', kategori: 'islem', baslik: k.baslik.replace(/ · .*$/, ' · Teslim Uyuşmazlığı'), ozet: 'Teslim talebi 24 saat içinde sonuçlanmadı.', oncelik: 'Yüksek', sahipRol: await rolId(db, 'Operasyon Müdürü'), nesneTuru: 'Dosya', nesneKimligi: k.nesne_kimligi });
    n++;
  }
  // Yeniden değerlendirme tarihi: Koşullu Onaylı 3 ay, diğer onaylı ve aktif firma 12 ay; kabul kararından başlar.
  await db.query(`UPDATE kurulus SET sonraki_gozden_gecirme_tarihi = (coalesce(kabul_karar_zamani, olusturma_zamani) + CASE WHEN kayit_asamasi = 'Koşullu Onaylı' THEN interval '3 months' ELSE interval '12 months' END)::date WHERE sonraki_gozden_gecirme_tarihi IS NULL AND kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı') AND ag_statusu = 'Aktif'`);
  const vade = (await db.query(`SELECT kimlik, ticari_unvan, sonraki_gozden_gecirme_tarihi::text t FROM kurulus WHERE sonraki_gozden_gecirme_tarihi <= $1::date AND kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı') AND ag_statusu = 'Aktif'`, [simdi])).rows;
  for (const f of vade) {
    if (!(await birKez(db, 'Firma Yeniden Değerlendirme', `${f.kimlik}:${f.t}`))) continue;
    await kartAc(db, { tur: 'Firma Yeniden Değerlendirme', kategori: 'gorev', baslik: `${f.ticari_unvan} · Yeniden Değerlendirme`, ozet: 'Karneyi inceleyip statü kararını vermenizi rica ederiz.', sahipRol: await rolId(db, 'Firma Yönetimi Müdürü'), nesneTuru: 'Kuruluş', nesneKimligi: f.kimlik });
    n++;
  }
  const ceyrek = `${simdi.getFullYear()}-Q${Math.floor(simdi.getMonth() / 3) + 1}`;
  if (await birKez(db, 'Karne Üç Aylık Özet', ceyrek)) {
    const o = (await db.query(`SELECT count(DISTINCT kurulus_ref)::int firma, count(DISTINCT kurulus_ref) FILTER (WHERE risk_derecesi_onerisi = 'Yakın İzleme')::int izleme FROM performans_donem_puani WHERE guncelleme_zamani > $1::timestamptz - interval '3 months'`, [simdi])).rows[0];
    await bildir(db, { olay: `karne-ozet:${ceyrek}`, kullanicilar: await rolSahipleri(db, await rolId(db, 'Firma Yönetimi Müdürü')), baslik: `Karne Üç Aylık Özeti: ${ceyrek}`, ozet: `${o.firma} firma puanlandı; ${o.izleme} firma için Yakın İzleme önerildi.` }, simdi);
  }
  return n;
}

export function sahaKayitYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const firmaIsi = async (id: string, k: string) => (UUID.test(id) ? (await b.db.query(`SELECT e.* FROM is_emri e JOIN kurulus_kullanici x ON x.kurulus_ref = e.kurulus_ref WHERE e.kimlik = $1 AND x.kullanici_ref = $2`, [id, k])).rows[0] : undefined);
  const lgmIsi = async (id: string, k: string) => { if (!UUID.test(id)) return undefined; const e = (await b.db.query(`SELECT * FROM is_emri WHERE kimlik = $1`, [id])).rows[0]; return e && await dosyaErisimi(b.db, k, e.dosya_ref) ? e : undefined; };
  const rolVar = async (k: string, l: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, l])).rowCount);
  const isBelgesi = async (belge: unknown, isEmri: string) => typeof belge === 'string' && UUID.test(belge) && Boolean((await b.db.query(`SELECT 1 FROM belge x JOIN is_emri e ON e.kimlik = $2 WHERE x.kimlik = $1 AND ((x.bag_turu = 'İş Emri' AND x.bag_kimligi::text = e.kimlik::text) OR (x.bag_turu = 'Dosya' AND x.bag_kimligi::text = e.dosya_ref::text))`, [belge, isEmri])).rowCount);

  // YG-1574, YG-381: gün başına bir kayıt; zorunlu alanlar dolmadan gün kapanmaz; aynı görsel başka kayıtta kanıt olmaz.
  s.post('/firma-portal/is-emri/:id/gunluk', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await firmaIsi((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { faaliyet?: string; fotograflar?: string[]; olcumler?: string; engel?: string; sonrakiPlan?: string; sorumlu?: string; kapat?: boolean };
    if (!e) return yok(y);
    if (e.statu !== 'Aktif') return y.code(409).send({ hata: 'Günlük kayıt aktif iş emrine girilir.' });
    const fot = g.fotograflar ?? [];
    for (const x of fot) if (!(await isBelgesi(x, e.kimlik))) return y.code(400).send({ hata: 'Fotoğrafı bu iş emrine yüklemenizi rica ederiz.' });
    const onceki = await b.db.query(`SELECT 1 FROM firma_gunluk_kaydi WHERE fotograflar && $1::uuid[] AND NOT (is_emri_ref = $2 AND tarih = (now() AT TIME ZONE 'Europe/Istanbul')::date) LIMIT 1`, [fot, e.kimlik]);
    if (onceki.rowCount) return y.code(409).send({ hata: 'Aynı fotoğraf başka bir kayıtta kanıt olarak kullanılmıştır.' });
    if (g.kapat && (!g.faaliyet?.trim() || !fot.length || !g.sonrakiPlan?.trim() || !g.sorumlu?.trim())) return y.code(400).send({ hata: 'Günü kapatabilmeniz için zorunlu alanları tamamlamanızı rica ederiz.' });
    const r = (await b.db.query(`INSERT INTO firma_gunluk_kaydi (is_emri_ref, kurulus_ref, tarih, faaliyet, fotograflar, olcumler, engel, sonraki_plan, sorumlu, durum, giren_ref, kapanis_zamani) VALUES ($1,$2,(now() AT TIME ZONE 'Europe/Istanbul')::date,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (is_emri_ref, tarih) DO UPDATE SET faaliyet = EXCLUDED.faaliyet, fotograflar = EXCLUDED.fotograflar, olcumler = EXCLUDED.olcumler, engel = EXCLUDED.engel, sonraki_plan = EXCLUDED.sonraki_plan, sorumlu = EXCLUDED.sorumlu, durum = EXCLUDED.durum, kapanis_zamani = EXCLUDED.kapanis_zamani WHERE firma_gunluk_kaydi.durum = 'Açık' RETURNING kimlik, durum`,
    [e.kimlik, e.kurulus_ref, g.faaliyet?.trim() || null, fot, g.olcumler?.trim() || null, g.engel?.trim() || null, g.sonrakiPlan?.trim() || null, g.sorumlu?.trim() || null, g.kapat ? 'Kapatıldı' : 'Açık', o.kullanici, g.kapat ? new Date() : null])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Bugünün kaydı kapatılmıştır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: g.kapat ? 'Günü Kapat' : 'Günlük Kayıt', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Firma Portalı' });
    return { durum: r.durum };
  });

  s.get('/firma-portal/gunluk', oturumlu, async (i, y) => {
    const f = (await b.db.query(`SELECT x.kurulus_ref FROM kurulus_kullanici x WHERE x.kullanici_ref = $1 LIMIT 1`, [i.oturum!.kullanici])).rows[0]?.kurulus_ref;
    if (!f) return yok(y);
    const acik = (await b.db.query(`SELECT g.kimlik, g.tarih::text, e.kimlik AS is_emri, e.is_emri_no FROM firma_gunluk_kaydi g JOIN is_emri e ON e.kimlik = g.is_emri_ref WHERE g.kurulus_ref = $1 AND g.durum = 'Açık' ORDER BY g.tarih`, [f])).rows;
    const aktif = (await b.db.query(`SELECT e.kimlik, e.is_emri_no, (SELECT g.durum FROM firma_gunluk_kaydi g WHERE g.is_emri_ref = e.kimlik AND g.tarih = (now() AT TIME ZONE 'Europe/Istanbul')::date) AS bugun FROM is_emri e WHERE e.kurulus_ref = $1 AND e.statu = 'Aktif' ORDER BY e.is_emri_no`, [f])).rows;
    return { acik, aktif };
  });

  // YG-1430, YG-404: firma tedariki parça lot ve belgeyle girilir; kabulü firma veremez (YG-386).
  s.post('/firma-portal/is-emri/:id/parca', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await firmaIsi((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { urun?: string; parcaNo?: string; miktar?: number; birim?: string; lot?: string; belge?: string };
    if (!e) return yok(y);
    if (e.statu !== 'Aktif') return y.code(409).send({ hata: 'Parça girişi aktif iş emrine yapılır.' });
    if (!g.urun?.trim() || !g.parcaNo?.trim() || !(Number(g.miktar) > 0) || !g.birim?.trim()) return y.code(400).send({ hata: 'Ürün, parça no, miktar ve birimi girmenizi rica ederiz.' });
    if (!g.lot?.trim()) return y.code(400).send({ hata: 'Kaynağı izlenebilmesi için lot numarasını girmenizi rica ederiz.' });
    if (!(await isBelgesi(g.belge, e.kimlik))) return y.code(400).send({ hata: 'İrsaliye veya sertifikayı yüklemenizi rica ederiz.' });
    const r = (await b.db.query(`INSERT INTO firma_parca_girisi (is_emri_ref, kurulus_ref, urun_tanimi, parca_no, miktar, birim, lot_no, belge_ref, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [e.kimlik, e.kurulus_ref, g.urun.trim(), g.parcaNo.trim(), g.miktar, g.birim.trim(), g.lot.trim(), g.belge, o.kullanici])).rows[0];
    const ds = (await b.db.query(`SELECT dosya_sorumlusu_ref r, dosya_no FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0];
    if (ds.r) await kartAc(b.db, { tur: 'Parça Girişi Kontrolü', kategori: 'gorev', baslik: `${e.is_emri_no} · Parça Girişi`, ozet: `${g.urun.trim()} · ${g.parcaNo.trim()}`.slice(0, 200), sahipKullanici: ds.r, nesneTuru: 'Parça Girişi', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik, durum: 'Kontrol Bekliyor' };
  });
  s.get('/firma-portal/is-emri/:id/parca', oturumlu, async (i, y) => {
    const e = await firmaIsi((i.params as { id: string }).id, i.oturum!.kullanici);
    if (!e) return yok(y);
    return (await b.db.query(`SELECT kimlik, urun_tanimi, parca_no, miktar, birim, lot_no, kabul_karari FROM firma_parca_girisi WHERE is_emri_ref = $1 ORDER BY olusturma_zamani DESC`, [e.kimlik])).rows;
  });

  // YG-417: Teslim Talebi; kararı Dosya Sorumlusu verir. Firma engelin nedenini görmez, yalnız onay durumunu görür.
  s.post('/firma-portal/is-emri/:id/teslim-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await firmaIsi((i.params as { id: string }).id, o.kullanici);
    if (!e) return yok(y);
    const d = (await b.db.query(`SELECT dosya_sorumlusu_ref r, dosya_no FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0];
    if (!d.r) return y.code(409).send({ hata: 'Dosya Sorumlusu ataması bekleniyor.' });
    if ((await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'Teslim Talebi' AND nesne_kimligi = $1 AND durum = 'Bekliyor' AND baslik LIKE '%Firmadan%' LIMIT 1`, [e.dosya_ref])).rowCount) return y.code(409).send({ hata: 'Teslim talebiniz iletilmiştir.' });
    await kartAc(b.db, { tur: 'Teslim Talebi', kategori: 'islem', baslik: `${d.dosya_no} · Firmadan Teslim Talebi`, sahipKullanici: d.r, nesneTuru: 'Dosya', nesneKimligi: e.dosya_ref });
    return { durum: 'İletildi' };
  });
  s.get('/firma-portal/is-emri/:id/teslim-durumu', oturumlu, async (i, y) => {
    const e = await firmaIsi((i.params as { id: string }).id, i.oturum!.kullanici);
    if (!e) return yok(y);
    const t = (await b.db.query(`SELECT durum FROM teslim_kaydi WHERE dosya_ref = $1 AND durum = 'Teslim Edildi' LIMIT 1`, [e.dosya_ref])).rowCount;
    return { teslimOnayi: Boolean(t) };
  });

  // LGM tarafı: günlükleri, parçaları, sapma ve denetim kayıtlarını görür.
  s.get('/is-emri/:id/saha-kayitlari', oturumlu, async (i, y) => {
    const e = await lgmIsi((i.params as { id: string }).id, i.oturum!.kullanici);
    if (!e) return yok(y);
    const q = async (sql: string) => (await b.db.query(sql, [e.kimlik])).rows;
    return {
      teshisiBelirsiz: e.teshisi_belirsiz, statu: e.statu, toplanti: (await b.db.query(`SELECT tarih::text, kisa_form, katilimcilar FROM baslangic_toplantisi WHERE is_emri_ref = $1`, [e.kimlik])).rows[0] ?? null,
      gunlukler: await q(`SELECT kimlik, tarih::text, faaliyet, engel, sonraki_plan, sorumlu, durum FROM firma_gunluk_kaydi WHERE is_emri_ref = $1 ORDER BY tarih DESC LIMIT 30`),
      parcalar: await q(`SELECT kimlik, urun_tanimi, parca_no, miktar, birim, lot_no, belge_ref, kabul_karari FROM firma_parca_girisi WHERE is_emri_ref = $1 ORDER BY olusturma_zamani DESC`),
      sapmalar: await q(`SELECT kimlik, tur, aciklama, karar, durum, hedef_tarih::text, firma_kaynakli, isg_ihlali, onaysiz_ek_is, olusturma_zamani FROM sapma_kaydi WHERE is_emri_ref = $1 ORDER BY olusturma_zamani DESC`),
      bulgular: await q(`SELECT kimlik, sinif, aciklama, hedef_tarih::text FROM firma_denetim_bulgusu WHERE is_emri_ref = $1 ORDER BY olusturma_zamani DESC`),
    };
  });

  s.post('/parca-girisi/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { karar } = (i.body ?? {}) as { karar?: string };
    if (!UUID.test(id)) return yok(y);
    const p = (await b.db.query(`SELECT * FROM firma_parca_girisi WHERE kimlik = $1`, [id])).rows[0];
    if (!p || !(await lgmIsi(p.is_emri_ref, o.kullanici))) return yok(y);
    if (!(await rolVar(o.kullanici, PARCA_ROLLERI))) return y.code(403).send({ hata: 'Parça kabulünü Teknik Uzman, Kalite Kontrolör veya Tedarik Sorumlusu verir.' });
    if (!KABUL.includes(karar ?? '')) return y.code(400).send({ hata: 'Kararı seçmenizi rica ederiz.' });
    if (p.kabul_karari) return y.code(409).send({ hata: 'Bu parça için karar verilmiştir.' });
    await b.db.query(`UPDATE firma_parca_girisi SET kabul_karari = $2, karar_veren_ref = $3, karar_zamani = now() WHERE kimlik = $1`, [id, karar, o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Parça Girişi Kontrolü' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Parça Girişi Kararı', nesneTuru: 'İş Emri', nesneKimligi: p.is_emri_ref, yeni: { karar }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { karar };
  });

  // YG-379, YG-380: sapma türü ve kararı yetkili rolde; kayıt silinmez; düzeltme Dosya Sorumlusuna görev açar; karneye yansır.
  s.post('/is-emri/:id/sapma', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsi((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { tur?: string; aciklama?: string; karar?: string; firmaKaynakli?: boolean; isgIhlali?: boolean; onaysizEkIs?: boolean; hedef?: string };
    if (!e) return yok(y);
    if (!(await rolVar(o.kullanici, SAHA_ROLLERI))) return y.code(403).send({ hata: 'Sapmayı Saha Sorumlusu, Teknik Uzman veya Kalite Kontrolör kaydeder.' });
    if (!SAPMA_TUR.includes(g.tur ?? '') || !SAPMA_KARAR.includes(g.karar ?? '') || !g.aciklama?.trim()) return y.code(400).send({ hata: 'Tür, açıklama ve kararı girmenizi rica ederiz.' });
    if ((g.karar === 'Düzeltme' || g.karar === 'Sınırlı Devam') && !/^\d{4}-\d{2}-\d{2}$/.test(g.hedef ?? '')) return y.code(400).send({ hata: 'Düzeltme için hedef tarih girmenizi rica ederiz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = (await c.query(`INSERT INTO sapma_kaydi (is_emri_ref, dosya_ref, tur, aciklama, karar, firma_kaynakli, isg_ihlali, onaysiz_ek_is, giren_ref, hedef_tarih, sorumlu_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`, [e.kimlik, e.dosya_ref, g.tur, g.aciklama.trim(), g.karar, g.firmaKaynakli !== false, Boolean(g.isgIhlali), Boolean(g.onaysizEkIs), o.kullanici, g.hedef || null, (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0].r])).rows[0];
      if (g.karar === 'İşi Durdur' && e.statu === 'Aktif') { await c.query(`UPDATE is_emri SET statu = 'Durduruldu', durdurma_nedeni = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, g.aciklama.trim()]); await isDurduBildir(c, e, g.aciklama.trim(), g.tur === 'Güvenlik' || Boolean(g.isgIhlali)); }
      const ds = (await c.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0].r;
      if (ds) await kartAc(c, { tur: 'Sapma Kaydı', kategori: 'gorev', baslik: `${e.is_emri_no} · ${g.tur} Sapması · ${g.karar}`, ozet: g.aciklama.trim().slice(0, 200), oncelik: g.karar === 'İşi Durdur' || g.isgIhlali ? 'Yüksek' : 'Normal', sahipKullanici: ds, sonZaman: g.hedef ? new Date(`${g.hedef}T18:00:00+03:00`) : undefined, nesneTuru: 'Sapma', nesneKimligi: r.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sapma Kaydı', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, yeni: { tur: g.tur, karar: g.karar }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await performansOlayIsle(c, e.kimlik, 'Sapma kaydı');
      await c.query('COMMIT');
      return { kimlik: r.kimlik };
    } catch (x) { await c.query('ROLLBACK').catch(() => {}); throw x; } finally { c.release(); }
  });

  // YG-380: kapanış kanıtla olur; kayıt silinmez. Girenden başka bir yetkili kapatır.
  s.post('/sapma/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { belge } = (i.body ?? {}) as { belge?: string };
    if (!UUID.test(id)) return yok(y);
    const r = (await b.db.query(`SELECT * FROM sapma_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!r || !(await lgmIsi(r.is_emri_ref, o.kullanici))) return yok(y);
    if (!(await rolVar(o.kullanici, [...SAHA_ROLLERI, 'Dosya Sorumlusu']))) return y.code(403).send({ hata: 'Sapmayı Saha Sorumlusu, Teknik Uzman, Kalite Kontrolör veya Dosya Sorumlusu kapatır.' });
    if (r.durum === 'Kapalı') return y.code(409).send({ hata: 'Bu sapma kapatılmıştır.' });
    if (r.giren_ref === o.kullanici) return y.code(403).send({ hata: 'Sapmayı kaydeden kişi dışında bir yetkilinin kapatmasını rica ederiz.' });
    if (!(await isBelgesi(belge, r.is_emri_ref))) return y.code(400).send({ hata: 'Kapanış kanıtını yüklemenizi rica ederiz.' });
    await b.db.query(`UPDATE sapma_kaydi SET durum = 'Kapalı', kapanis_kaniti_ref = $2, kapatan_ref = $3, kapanis_zamani = now() WHERE kimlik = $1`, [id, belge, o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Sapma Kaydı' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sapma Kapatıldı', nesneTuru: 'İş Emri', nesneKimligi: r.is_emri_ref, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Kapalı' };
  });

  // YG-262, YG-1588: durdurulan iş emrini yalnız Teknik Müdür, güvenli koşul doğrulamasıyla yeniden başlatır; işi durduran açık uygunsuzluk varken başlatılmaz.
  s.post('/is-emri/:id/yeniden-baslat', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsi((i.params as { id: string }).id, o.kullanici); const { gerekce } = (i.body ?? {}) as { gerekce?: string };
    if (!e) return yok(y);
    if (!(await rolVar(o.kullanici, ['Teknik Müdür']))) return y.code(403).send({ hata: 'Yeniden başlatma izni Teknik Müdürdedir.' });
    if (e.statu !== 'Durduruldu') return y.code(409).send({ hata: 'İş emri durdurulmuş değildir.' });
    if (!gerekce?.trim()) return y.code(400).send({ hata: 'Güvenli koşul doğrulamasını yazmanızı rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM uygunsuzluk WHERE is_emri_ref = $1 AND is_durduruldu AND statu NOT IN ('Kapalı', 'Geçersiz') LIMIT 1`, [e.kimlik])).rowCount) return y.code(409).send({ hata: 'İşi durduran uygunsuzluk açıktır; kapanması bekleniyor.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE is_emri SET statu = 'Aktif', durdurma_nedeni = NULL, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik]);
      const kisiler = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [e.kurulus_ref])).rows.map((r) => r.kullanici_ref as string);
      const ekip = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL AND rol IN ('Dosya Sorumlusu', 'Teknik Uzman', 'Operasyon Yöneticisi')`, [e.dosya_ref])).rows.map((r) => r.kullanici_ref as string);
      await bildir(c, { olay: `is-emri-basladi:${e.kimlik}:${Date.now()}`, kullanicilar: [...new Set([...kisiler, ...ekip])], baslik: `İş Yeniden Başlatıldı: ${e.is_emri_no}`, oncelik: 'Yüksek', eposta: true, acil: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İş Emri Yeniden Başlatıldı', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { statu: 'Aktif' };
    } catch (x) { await c.query('ROLLBACK').catch(() => {}); throw x; } finally { c.release(); }
  });

  // YG-329, YG-580, YG-425: TPL-07 kaydını Dosya Sorumlusu girer; firma görür.
  s.post('/is-emri/:id/baslangic-toplantisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsi((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { tarih?: string; kisaForm?: boolean; katilimcilar?: string; konusulanlar?: string };
    if (!e) return yok(y);
    const d = (await b.db.query(`SELECT dosya_sorumlusu_ref, yedek_sorumlu_ref FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0];
    if (d.dosya_sorumlusu_ref !== o.kullanici && d.yedek_sorumlu_ref !== o.kullanici) return y.code(403).send({ hata: 'Başlangıç toplantısını Dosya Sorumlusu kaydeder.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.tarih ?? '') || !g.katilimcilar?.trim() || !g.konusulanlar?.trim()) return y.code(400).send({ hata: 'Tarih, katılımcılar ve konuşulanları girmenizi rica ederiz.' });
    const r = await b.db.query(`INSERT INTO baslangic_toplantisi (is_emri_ref, tarih, kisa_form, katilimcilar, konusulanlar, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (is_emri_ref) DO NOTHING RETURNING kimlik`, [e.kimlik, g.tarih, Boolean(g.kisaForm), g.katilimcilar.trim(), g.konusulanlar.trim(), o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu iş emrinin başlangıç toplantısı kayıtlıdır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Başlangıç Toplantısı', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.rows[0].kimlik };
  });
  s.get('/firma-portal/is-emri/:id/baslangic-toplantisi', oturumlu, async (i, y) => {
    const e = await firmaIsi((i.params as { id: string }).id, i.oturum!.kullanici);
    if (!e) return yok(y);
    return (await b.db.query(`SELECT tarih::text, kisa_form, katilimcilar, konusulanlar FROM baslangic_toplantisi WHERE is_emri_ref = $1`, [e.kimlik])).rows[0] ?? null;
  });

  // YG-380: tekrar eden sapmalar firma ve tür bazında izlenir.
  s.get('/firma/:id/sapma-ozeti', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolVar(i.oturum!.kullanici, DENETIM_ROLLERI))) return yok(y);
    return (await b.db.query(`SELECT s.tur, count(*)::int adet, count(*) FILTER (WHERE s.durum = 'Açık')::int acik FROM sapma_kaydi s JOIN is_emri e ON e.kimlik = s.is_emri_ref WHERE e.kurulus_ref = $1 AND s.firma_kaynakli AND s.olusturma_zamani > now() - interval '12 months' GROUP BY s.tur ORDER BY adet DESC`, [id])).rows;
  });

  // YG-786: denetim bulgusu sınıf, kanıt ve hedef tarihle; firma karnesine işlenir.
  s.post('/is-emri/:id/denetim-bulgusu', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsi((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { sinif?: string; aciklama?: string; belge?: string; hedef?: string };
    if (!e) return yok(y);
    if (!(await rolVar(o.kullanici, DENETIM_ROLLERI))) return y.code(403).send({ hata: 'Denetim bulgusunu Kalite Kontrolör, Kalite Müdürü veya Firma Yönetimi Müdürü kaydeder.' });
    if (!['Majör', 'Minör'].includes(g.sinif ?? '') || !g.aciklama?.trim()) return y.code(400).send({ hata: 'Sınıf ve açıklamayı girmenizi rica ederiz.' });
    if (!(await isBelgesi(g.belge, e.kimlik))) return y.code(400).send({ hata: 'Kanıt belgesini yüklemenizi rica ederiz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = (await c.query(`INSERT INTO firma_denetim_bulgusu (is_emri_ref, kurulus_ref, sinif, aciklama, kanit_belge_ref, hedef_tarih, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [e.kimlik, e.kurulus_ref, g.sinif, g.aciklama.trim(), g.belge, g.hedef || null, o.kullanici])).rows[0];
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Denetim Bulgusu', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, yeni: { sinif: g.sinif }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await performansOlayIsle(c, e.kimlik, 'Denetim bulgusu');
      await c.query('COMMIT');
      return { kimlik: r.kimlik };
    } catch (x) { await c.query('ROLLBACK').catch(() => {}); throw x; } finally { c.release(); }
  });

  // Ek I §7.5: gizli hasar ve arıza tespiti gibi işlerde +%5 tolerans; işareti Teknik Uzman koyar.
  s.post('/is-emri/:id/teshisi-belirsiz', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = await lgmIsi((i.params as { id: string }).id, o.kullanici); const { deger } = (i.body ?? {}) as { deger?: boolean };
    if (!e) return yok(y);
    if (!(await rolVar(o.kullanici, ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Teknik Yönetici']))) return y.code(403).send({ hata: 'İşareti Teknik Uzman veya Teknik Yönetici koyar.' });
    await b.db.query(`UPDATE is_emri SET teshisi_belirsiz = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, Boolean(deger)]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teşhisi Belirsiz İşareti', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, yeni: { deger: Boolean(deger) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    await performansOlayIsle(b.db, e.kimlik, 'Teşhisi belirsiz işareti');
    return { teshisiBelirsiz: Boolean(deger) };
  });
}
