import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { altNumara } from './sure.js';
import { UUID } from './yat.js';

const TS = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)'; const MUH = [TS, 'Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdür Yardımcısı', 'Muhasebe ve Finans Müdürü'];
const KDV = ['Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdür Yardımcısı', 'Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü'];
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const KALEM = ['İşçilik', 'Parça', 'Malzeme', 'Ulaşım', 'Diğer']; const KARSILAYAN = ['Çözüm Ortağı', 'Tedarikçi', 'Üretici', 'LGM'];
const UGB_SIRA: Record<string, string[]> = { Hazırlanıyor: ['Gönderildi'], Gönderildi: ['Üretici İncelemesinde', 'Kabul', 'Kısmen Kabul', 'Ret'], 'Üretici İncelemesinde': ['Kabul', 'Kısmen Kabul', 'Ret'] };
const KDV_SIRA: Record<string, string> = { Hazırlanıyor: 'Mali Müşavirde', 'Mali Müşavirde': 'Başvuruldu', Başvuruldu: 'Sonuçlandı' };

kapanisKaydet('Garanti Maliyet Kaydı', async (c, k, karar) => {
  if (karar !== 'Onayla' && karar !== 'Reddet') return;
  await c.query(`UPDATE garanti_maliyet_kaydi SET durum = $2, karar_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Onay Bekliyor'`, [k.nesne_kimligi, karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi']);
});

/** YG-899: Garanti Maliyet Kaydı, Üretici Garanti Başvurusu ve KDV İade Dosyası. */
export function garantiMaliYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const dosyaBelgesi = async (dosya: string, l: string[]) => !l.length || Number((await b.db.query(`SELECT count(DISTINCT kimlik) n FROM belge WHERE kimlik = ANY($1::uuid[]) AND bag_turu = 'Dosya' AND bag_kimligi = $2`, [l, dosya])).rows[0].n) === new Set(l).size;

  // Garanti Maliyet Kaydı: Ticari Sorumlu girer, Ticari İşler Direktörü onaylar; LGM dışı karşılayanda mahsup referansı zorunlu.
  s.get('/dosya/:id/garanti-maliyet', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || i.oturum!.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return {
      maliyetler: (await b.db.query(`SELECT m.kimlik, m.kayit_no, m.kalem, m.tutar_eur, m.karsilayan, m.mahsup_referansi, m.aciklama, m.durum, g.kayit_no garanti_no FROM garanti_maliyet_kaydi m LEFT JOIN garanti_sikayet g ON g.kimlik = m.garanti_ref WHERE m.dosya_ref = $1 ORDER BY m.olusturma_zamani`, [id])).rows,
      basvurular: (await b.db.query(`SELECT kimlik, basvuru_no, marka, model, seri_no, parca_no, ariza_tanimi, ariza_tarihi::text, garanti_bitis::text, uretici, basvuru_tarihi::text, kanal, uretici_referans_no, durum, karar_tarihi::text, karsilanan_eur, sonuc_notu FROM uretici_garanti_basvurusu WHERE dosya_ref = $1 ORDER BY olusturma_zamani`, [id])).rows,
      garantiKayitlari: (await b.db.query(`SELECT kimlik, kayit_no FROM garanti_sikayet WHERE dosya_ref = $1 ORDER BY kayit_no`, [id])).rows,
    };
  });
  s.post('/dosya/:id/garanti-maliyet', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { garanti?: string; isEmri?: string; kalem?: string; tutar?: number | string; karsilayan?: string; mahsup?: string; belge?: string; aciklama?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await rolVar(o.kullanici, MUH))) return y.code(403).send({ hata: 'Garanti maliyet kaydını Muhasebe ve Finans birimi girer.' });
    const tutar = Number(String(g.tutar ?? '').replace(',', '.'));
    if (!KALEM.includes(g.kalem ?? '') || !(tutar > 0) || !KARSILAYAN.includes(g.karsilayan ?? '')) return y.code(400).send({ hata: 'Maliyet kalemini, pozitif tutarı ve karşılayan tarafı giriniz.' });
    if (g.karsilayan !== 'LGM' && !g.mahsup?.trim()) return y.code(400).send({ hata: 'LGM dışında karşılanan maliyette mahsup veya rücu referansı zorunludur.' });
    if (g.garanti && !(UUID.test(g.garanti) && (await b.db.query(`SELECT 1 FROM garanti_sikayet WHERE kimlik = $1 AND dosya_ref = $2`, [g.garanti, id])).rowCount)) return y.code(400).send({ hata: 'Garanti kaydı bu dosyaya ait değildir.' });
    if (g.isEmri && !(UUID.test(g.isEmri) && (await b.db.query(`SELECT 1 FROM is_emri WHERE kimlik = $1 AND dosya_ref = $2`, [g.isEmri, id])).rowCount)) return y.code(400).send({ hata: 'İş emri bu dosyaya ait değildir.' });
    if (g.belge && !(UUID.test(g.belge) && await dosyaBelgesi(id, [g.belge]))) return y.code(400).send({ hata: 'Belge bu dosyaya yüklenmiş olmalıdır.' });
    const d = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    const no = await altNumara(b.db, d.dosya_no, 'GM');
    const r = (await b.db.query(`INSERT INTO garanti_maliyet_kaydi (kayit_no, dosya_ref, garanti_ref, is_emri_ref, kalem, tutar_eur, karsilayan, mahsup_referansi, belge_ref, aciklama, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`,
      [no, id, g.garanti || null, g.isEmri || null, g.kalem, Math.round(tutar * 100) / 100, g.karsilayan, g.mahsup?.trim() || null, g.belge || null, g.aciklama?.trim() || null, o.kullanici])).rows[0];
    await kartAc(b.db, { tur: 'Garanti Maliyet Kaydı', baslik: `${no} · Garanti Maliyeti · ${g.kalem}`, ozet: `${tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR · Karşılayan: ${g.karsilayan}`, hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Ticari İşler Direktörü')], tutar, nesneTuru: 'Garanti Maliyet Kaydı', nesneKimligi: r.kimlik });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Garanti Maliyet Kaydı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { no, kalem: g.kalem, tutar, karsilayan: g.karsilayan }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik, kayitNo: no };
  });

  // Üretici Garanti Başvurusu: dosyaya erişimi olan LGM personeli açar ve günceller; durum sırası durum sözlüğündeki gibidir.
  s.post('/dosya/:id/uretici-garanti-basvurusu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { marka?: string; model?: string; seriNo?: string; parcaNo?: string; ariza?: string; arizaTarihi?: string; garantiBitis?: string; uretici?: string; ekler?: string[] };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g.marka?.trim() || !g.ariza?.trim() || !TARIH.test(g.arizaTarihi ?? '') || !g.uretici?.trim() || (g.garantiBitis && !TARIH.test(g.garantiBitis))) return y.code(400).send({ hata: 'Marka, arıza tanımı, arıza tarihi ve üretici veya yetkili servisi giriniz.' });
    if (!g.seriNo?.trim() && !g.parcaNo?.trim()) return y.code(400).send({ hata: 'Seri numarasını veya parça numarasını giriniz.' });
    const ekler = (g.ekler ?? []).filter((x) => UUID.test(x));
    if (!(await dosyaBelgesi(id, ekler))) return y.code(400).send({ hata: 'Ekler bu dosyaya yüklenmiş olmalıdır.' });
    const d = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    const no = await altNumara(b.db, d.dosya_no, 'UGB');
    const r = (await b.db.query(`INSERT INTO uretici_garanti_basvurusu (basvuru_no, dosya_ref, marka, model, seri_no, parca_no, ariza_tanimi, ariza_tarihi, garanti_bitis, uretici, ekler, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING kimlik`,
      [no, id, g.marka.trim(), g.model?.trim() || null, g.seriNo?.trim() || null, g.parcaNo?.trim() || null, g.ariza.trim(), g.arizaTarihi, g.garantiBitis || null, g.uretici.trim(), ekler, o.kullanici])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Üretici Garanti Başvurusu', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { no }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik, basvuruNo: no };
  });
  s.post('/uretici-garanti-basvurusu/:id/durum', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { durum?: string; basvuruTarihi?: string; kanal?: string; referansNo?: string; kararTarihi?: string; karsilanan?: number | string; sonucNotu?: string };
    const a = UUID.test(id) ? (await b.db.query(`SELECT dosya_ref, durum FROM uretici_garanti_basvurusu WHERE kimlik = $1`, [id])).rows[0] : undefined;
    if (!a || o.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, o.kullanici, a.dosya_ref))) return yok(y);
    if (!(UGB_SIRA[a.durum] ?? []).includes(g.durum ?? '')) return y.code(409).send({ hata: `${a.durum} durumundaki başvuru ${(UGB_SIRA[a.durum] ?? []).join(', ') || 'başka bir duruma'} geçebilir.` });
    if (g.durum === 'Gönderildi' && (!TARIH.test(g.basvuruTarihi ?? '') || !['E-posta', 'Üretici Portalı', 'Yetkili Servis', 'Posta', 'Diğer'].includes(g.kanal ?? ''))) return y.code(400).send({ hata: 'Başvuru tarihini ve kanalını giriniz.' });
    const karar = ['Kabul', 'Kısmen Kabul', 'Ret'].includes(g.durum!); const tutar = g.karsilanan === undefined || g.karsilanan === '' ? null : Number(String(g.karsilanan).replace(',', '.'));
    if (karar && !TARIH.test(g.kararTarihi ?? '')) return y.code(400).send({ hata: 'Üreticinin karar tarihini giriniz.' });
    if (g.durum !== 'Ret' && karar && !(tutar !== null && tutar >= 0)) return y.code(400).send({ hata: 'Üreticinin karşıladığı tutarı (EUR) giriniz.' });
    if ((g.durum === 'Kısmen Kabul' || g.durum === 'Ret') && !g.sonucNotu?.trim()) return y.code(400).send({ hata: 'Kısmi kabul ve retle ilgili sonuç notunu yazınız.' });
    await b.db.query(`UPDATE uretici_garanti_basvurusu SET durum = $2, basvuru_tarihi = coalesce($3, basvuru_tarihi), kanal = coalesce($4, kanal), uretici_referans_no = coalesce($5, uretici_referans_no), karar_tarihi = coalesce($6, karar_tarihi), karsilanan_eur = coalesce($7, karsilanan_eur), sonuc_notu = coalesce($8, sonuc_notu) WHERE kimlik = $1`,
      [id, g.durum, g.basvuruTarihi || null, g.kanal || null, g.referansNo?.trim() || null, g.kararTarihi || null, g.durum === 'Ret' ? 0 : tutar, g.sonucNotu?.trim() || null]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Üretici Garanti Başvurusu Durumu', nesneTuru: 'Üretici Garanti Başvurusu', nesneKimligi: id, eski: { durum: a.durum }, yeni: { durum: g.durum }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: g.durum };
  });

  // KDV İade Dosyası: Muhasebe ve Finans birimi açar ve yürütür; iade nedeni mali müşavir görüşüne bağlı olduğundan serbest metindir.
  s.get('/kdv-iade', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, KDV))) return yok(y);
    return (await b.db.query(`SELECT kimlik, donem, iade_nedeni, cardinality(fatura_refler) fatura_sayisi, iade_tutari_tl, mali_musavire_gonderim::text, vergi_dairesi_basvuru_no, sonuc_tutari_tl, durum FROM kdv_iade_dosyasi ORDER BY donem DESC, olusturma_zamani DESC LIMIT 100`)).rows;
  });
  s.post('/kdv-iade', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, KDV))) return y.code(403).send({ hata: 'KDV iade dosyasını Muhasebe ve Finans birimi açar.' });
    const g = (i.body ?? {}) as { donem?: string; neden?: string; faturalar?: string[]; tutar?: number | string; belgeler?: string[] };
    const tutar = Number(String(g.tutar ?? '').replace(',', '.'));
    if (!/^\d{4}-\d{2}$/.test(g.donem ?? '') || !(tutar > 0)) return y.code(400).send({ hata: 'Dönemi (yıl-ay) ve iade tutarını (TL) giriniz.' });
    const faturalar = (g.faturalar ?? []).filter((x) => UUID.test(x));
    if (!faturalar.length || Number((await b.db.query(`SELECT count(*) n FROM musteri_faturasi WHERE kimlik = ANY($1::uuid[])`, [faturalar])).rows[0].n) !== new Set(faturalar).size) return y.code(400).send({ hata: 'İadeye konu faturaları seçiniz.' });
    const belgeler = (g.belgeler ?? []).filter((x) => UUID.test(x));
    const r = (await b.db.query(`INSERT INTO kdv_iade_dosyasi (donem, iade_nedeni, fatura_refler, iade_tutari_tl, dayanak_belgeler, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [g.donem, g.neden?.trim() || null, faturalar, Math.round(tutar * 100) / 100, belgeler, o.kullanici])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'KDV İade Dosyası', nesneTuru: 'KDV İade Dosyası', nesneKimligi: r.kimlik, yeni: { donem: g.donem, tutar }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });
  s.post('/kdv-iade/:id/ilerlet', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gonderim?: string; basvuruNo?: string; sonucTutari?: number | string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, KDV))) return yok(y);
    const k = (await b.db.query(`SELECT durum FROM kdv_iade_dosyasi WHERE kimlik = $1`, [id])).rows[0]; if (!k) return yok(y);
    const yeni = KDV_SIRA[k.durum]; if (!yeni) return y.code(409).send({ hata: 'Dosya sonuçlanmıştır.' });
    const sonuc = g.sonucTutari === undefined || g.sonucTutari === '' ? NaN : Number(String(g.sonucTutari).replace(',', '.'));
    if (yeni === 'Mali Müşavirde' && !TARIH.test(g.gonderim ?? '')) return y.code(400).send({ hata: 'Mali müşavire gönderim tarihini giriniz.' });
    if (yeni === 'Başvuruldu' && !g.basvuruNo?.trim()) return y.code(400).send({ hata: 'Vergi dairesi başvuru numarasını giriniz.' });
    if (yeni === 'Sonuçlandı' && !(sonuc >= 0)) return y.code(400).send({ hata: 'Sonuç tutarını (TL) giriniz.' });
    await b.db.query(`UPDATE kdv_iade_dosyasi SET durum = $2, mali_musavire_gonderim = coalesce($3, mali_musavire_gonderim), vergi_dairesi_basvuru_no = coalesce($4, vergi_dairesi_basvuru_no), sonuc_tutari_tl = coalesce($5, sonuc_tutari_tl) WHERE kimlik = $1`,
      [id, yeni, yeni === 'Mali Müşavirde' ? g.gonderim : null, yeni === 'Başvuruldu' ? g.basvuruNo!.trim() : null, yeni === 'Sonuçlandı' ? Math.round(sonuc * 100) / 100 : null]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'KDV İade Dosyası Durumu', nesneTuru: 'KDV İade Dosyası', nesneKimligi: id, eski: { durum: k.durum }, yeni: { durum: yeni }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: yeni };
  });
}
