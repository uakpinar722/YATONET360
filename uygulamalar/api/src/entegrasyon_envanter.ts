import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const GORUR = ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Bilgi İşlem Müdürü', 'Sistem Yöneticisi', 'Hukuk ve Uyum Direktörü', 'CEO', 'Genel Müdür Yardımcısı', 'Muhasebe ve Finans Müdürü'];
const DUZENLER = ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Bilgi İşlem Müdürü'];
const YUKLER = [...DUZENLER, 'Sistem Yöneticisi', 'Muhasebe ve Finans Müdürü'];
/** YG-1297: sahibi ve amacı bu süre içinde doğrulanmayan üretimdeki bağlantı incelemeye alınır. */
const DOGRULAMA_GUN = 365;
const SOZLESME = ['kaynakAlan', 'hedefAlan', 'donusum', 'eslestirme', 'varsayilan', 'guncellenme'];
const dolu = (x?: unknown) => typeof x === 'string' && x.trim().length > 0;

/** YG-1297: sahibi veya amacı doğrulanmamış bağlantı incelemeye alınır, BT ve FY Direktörüne görev. */
export async function envanterIsle(db: Pool): Promise<number> {
  let n = 0;
  for (const e of (await db.query(`UPDATE entegrasyon_tanimi SET durum = 'İncelemede' WHERE durum = 'Üretimde' AND (son_dogrulama IS NULL OR son_dogrulama < current_date - $1::int) RETURNING kimlik, ad`, [DOGRULAMA_GUN])).rows) {
    await kartAc(db, { tur: 'Entegrasyon İncelemesi', kategori: 'gorev', baslik: `${e.ad} · Sahip ve Kullanım Amacı Doğrulaması`, ozet: 'Bağlantının sahibini ve kullanım amacını doğrulayınız; gereksizse kapatınız.', oncelik: 'Yüksek', sahipRol: await rolId(db, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'), nesneTuru: 'Entegrasyon', nesneKimligi: e.kimlik }); n++;
  }
  return n;
}

/**
 * YG-1315: toplu dosya aktarımı; beyan edilen kayıt sayısı ve SHA-256 özeti içerikle, şema sürümü beklenenle karşılaştırılır; uyuşmazlıkta dosya bütünüyle karantinaya alınır.
 * Satırlar tek tek doğrulanır (dış kimlik zorunlu, tekrar yasak); kısmi başarıda kabul edilen ve reddedilen satırlar ayrı raporlanır.
 */
export function topluDogrula(g: { beyanSayi: number; beyanOzet: string; semaSurumu: string; beklenenSema: string | null; icerik: string }) {
  const ozet = createHash('sha256').update(g.icerik, 'utf8').digest('hex');
  let satirlar: Record<string, unknown>[] = [];
  try { const j = JSON.parse(g.icerik); if (!Array.isArray(j)) throw new Error(); satirlar = j; } catch { return { sonuc: 'Karantina' as const, neden: 'Dosya okunamadı veya bozuk.', ozet, sayi: 0, kabul: 0, red: [] as { sira: number; neden: string }[] }; }
  if (ozet !== g.beyanOzet.toLowerCase()) return { sonuc: 'Karantina' as const, neden: 'Bütünlük değeri uyuşmuyor.', ozet, sayi: satirlar.length, kabul: 0, red: [] };
  if (satirlar.length !== g.beyanSayi) return { sonuc: 'Karantina' as const, neden: `Kayıt sayısı uyuşmuyor (beyan ${g.beyanSayi}, dosya ${satirlar.length}).`, ozet, sayi: satirlar.length, kabul: 0, red: [] };
  if (g.beklenenSema && g.semaSurumu !== g.beklenenSema) return { sonuc: 'Karantina' as const, neden: `Şema sürümü uyuşmuyor (beklenen ${g.beklenenSema}).`, ozet, sayi: satirlar.length, kabul: 0, red: [] };
  const red: { sira: number; neden: string }[] = []; const gorulen = new Set<string>();
  satirlar.forEach((s, i) => {
    const k = s && typeof s === 'object' ? String((s as { dis_kimlik?: unknown }).dis_kimlik ?? '').trim() : '';
    if (!k) red.push({ sira: i + 1, neden: 'Dış kimlik yok' }); else if (gorulen.has(k)) red.push({ sira: i + 1, neden: 'Tekrarlanan dış kimlik' }); else gorulen.add(k);
  });
  return { sonuc: red.length ? ('Kısmi Kabul' as const) : ('Kabul' as const), neden: null, ozet, sayi: satirlar.length, kabul: satirlar.length - red.length, red };
}

export function entegrasyonEnvanterYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, l: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, l])).rowCount);

  // YG-1297, 1298, 1317: envanter; her bağlantının son veri zamanı (son gelen kayıt veya toplu aktarım) gösterilir.
  s.get('/entegrasyon-envanteri', oturumlu, async (i, y) => {
    if (!(await rolde(i.oturum!.kullanici, GORUR))) return yok(y);
    return {
      duzenler: await rolde(i.oturum!.kullanici, DUZENLER), yukler: await rolde(i.oturum!.kullanici, YUKLER),
      baglantilar: (await b.db.query(`SELECT e.kimlik, e.ad, e.gonderen_sistem, e.alan_sistem, e.yon, e.veri_akisi, e.kayit_sahibi, e.teknik_sahip, e.bilgi_sinifi, e.hizmet_hesabi, e.uc_nokta, e.surum, e.siklik, e.hizmet_beklentisi, e.destek_yolu, e.paylasim_amaci, e.durum, e.veri_sozlesmesi, e.son_dogrulama::text,
          greatest((SELECT max(k.olusturma_zamani) FROM entegrasyon_kaydi k WHERE k.entegrasyon_ref = e.kimlik), (SELECT max(t.zaman) FROM toplu_aktarim t WHERE t.entegrasyon_ref = e.kimlik AND t.sonuc <> 'Karantina')) son_veri
        FROM entegrasyon_tanimi e ORDER BY e.durum = 'Kapalı', e.ad`)).rows,
      aktarimlar: (await b.db.query(`SELECT t.kimlik, e.ad, t.donem, t.kaynak, t.gercek_sayi, t.sonuc, t.kabul_sayisi, t.red_sayisi, t.red_raporu, t.karantina_nedeni, t.sema_surumu, t.zaman FROM toplu_aktarim t JOIN entegrasyon_tanimi e ON e.kimlik = t.entegrasyon_ref ORDER BY t.zaman DESC LIMIT 50`)).rows,
    };
  });
  // YG-1297, YG-1300: envanter alanları ve veri sözleşmesi (kaynak-hedef alan, dönüşüm, eşleştirme, varsayılan değer, güncellenme).
  s.post('/entegrasyon-envanteri/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(o.kullanici, DUZENLER))) return yok(y);
    const g = (i.body ?? {}) as { teknikSahip?: string; hizmetHesabi?: string; ucNokta?: string; surum?: string; destekYolu?: string; yon?: string; veriAkisi?: string; veriSozlesmesi?: Record<string, string>[] };
    if (g.yon && !['Giden', 'Gelen', 'Çift Yönlü'].includes(g.yon)) return y.code(400).send({ hata: 'Yönü seçiniz.' });
    const vs = g.veriSozlesmesi;
    if (vs !== undefined && (!Array.isArray(vs) || vs.some((x) => !dolu(x.kaynakAlan) || !dolu(x.hedefAlan) || !dolu(x.guncellenme)))) return y.code(400).send({ hata: 'Veri sözleşmesinin her satırında kaynak alan, hedef alan ve güncellenme zamanı zorunludur; dönüşüm, eşleştirme ve varsayılan değer açıkça yazılır ("Yok" dahil).' });
    const temiz = vs?.map((x) => Object.fromEntries(SOZLESME.map((k) => [k, String(x[k] ?? 'Yok').trim() || 'Yok'])));
    const r = await b.db.query(`UPDATE entegrasyon_tanimi SET teknik_sahip = coalesce($2, teknik_sahip), hizmet_hesabi = coalesce($3, hizmet_hesabi), uc_nokta = coalesce($4, uc_nokta), surum = coalesce($5, surum), destek_yolu = coalesce($6, destek_yolu), yon = coalesce($7, yon), veri_akisi = coalesce($8, veri_akisi), veri_sozlesmesi = coalesce($9, veri_sozlesmesi) WHERE kimlik = $1`,
      [id, g.teknikSahip?.trim() || null, g.hizmetHesabi?.trim() || null, g.ucNokta?.trim() || null, g.surum?.trim() || null, g.destekYolu?.trim() || null, g.yon ?? null, g.veriAkisi?.trim() || null, temiz ? JSON.stringify(temiz) : null]);
    if (!r.rowCount) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Entegrasyon Envanteri Güncellendi', nesneTuru: 'Entegrasyon', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/entegrasyon-envanteri/:id/dogrula', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(o.kullanici, DUZENLER))) return yok(y);
    const g = (i.body ?? {}) as { kapat?: boolean; gerekce?: string };
    if (!dolu(g.gerekce)) return y.code(400).send({ hata: 'Doğrulama veya kapatma gerekçesi zorunludur.' });
    const r = await b.db.query(`UPDATE entegrasyon_tanimi SET son_dogrulama = current_date, dogrulayan_ref = $2, durum = CASE WHEN $3 THEN 'Kapalı' WHEN durum = 'İncelemede' THEN 'Üretimde' ELSE durum END WHERE kimlik = $1 AND durum <> 'Kapalı' RETURNING durum`, [id, o.kullanici, g.kapat === true]);
    if (!r.rowCount) return yok(y);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Entegrasyon İncelemesi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: g.kapat ? 'Entegrasyon Kapatıldı' : 'Entegrasyon Sahip ve Amaç Doğrulandı', nesneTuru: 'Entegrasyon', nesneKimligi: id, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: r.rows[0].durum };
  });
  s.post('/entegrasyon-envanteri/:id/toplu-aktarim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(o.kullanici, YUKLER))) return yok(y);
    const g = (i.body ?? {}) as { donem?: string; kaynak?: string; beyanSayi?: number; beyanOzet?: string; semaSurumu?: string; icerik?: string };
    if (!dolu(g.donem) || !dolu(g.kaynak) || !Number.isInteger(g.beyanSayi) || !/^[0-9a-fA-F]{64}$/.test(g.beyanOzet ?? '') || !dolu(g.semaSurumu) || typeof g.icerik !== 'string') return y.code(400).send({ hata: 'Dönem, kaynak, kayıt sayısı, bütünlük değeri (SHA-256), şema sürümü ve dosya içeriği zorunludur.' });
    const e = (await b.db.query(`SELECT surum, durum FROM entegrasyon_tanimi WHERE kimlik = $1`, [id])).rows[0]; if (!e) return yok(y);
    if (e.durum === 'Askıda' || e.durum === 'Kapalı') return y.code(409).send({ hata: 'Askıdaki veya kapalı bağlantıya aktarım yapılamaz.' });
    const d = topluDogrula({ beyanSayi: g.beyanSayi!, beyanOzet: g.beyanOzet!, semaSurumu: g.semaSurumu!.trim(), beklenenSema: e.surum, icerik: g.icerik });
    const r = (await b.db.query(`INSERT INTO toplu_aktarim (entegrasyon_ref, donem, kaynak, beyan_sayi, gercek_sayi, beyan_ozet, gercek_ozet, sema_surumu, beklenen_sema, sonuc, kabul_sayisi, red_sayisi, red_raporu, karantina_nedeni, yukleyen_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING kimlik`,
      [id, g.donem!.trim(), g.kaynak!.trim(), g.beyanSayi, d.sayi, g.beyanOzet!.toLowerCase(), d.ozet, g.semaSurumu!.trim(), e.surum, d.sonuc, d.kabul, d.red.length, JSON.stringify(d.red), d.neden, o.kullanici])).rows[0].kimlik;
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplu Dosya Aktarımı', nesneTuru: 'Entegrasyon', nesneKimligi: id, yeni: { sonuc: d.sonuc, kabul: d.kabul, red: d.red.length }, sonuc: d.sonuc === 'Karantina' ? 'Başarısız' : 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r, sonuc: d.sonuc, neden: d.neden, kabul: d.kabul, red: d.red };
  });
}
