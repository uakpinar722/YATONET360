import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { tutar } from './metin.js';

/**
 * CEO 06.11.2026: her yıl Kasım başında içinde bulunulan yılın bilanço çalışması ile gelecek yılın bütçe çalışması başlar;
 * hazırlık görevleri ve koordinasyon toplantıları sistemce açılır, nihai onay toplantısı Aralık ayının ikinci haftasıdır.
 * Gelecek yılın tatil ve arife takvimi de Kasım içinde tamamlanır (TAT-1).
 */
const GMY = 'Genel Müdür Yardımcısı'; const MFM = 'Muhasebe ve Finans Müdürü'; const TID = 'Ticari İşler Direktörü';
export const KATEGORILER = ['Personel', 'Eğitim', 'Ekipman', 'BT ve Lisans', 'Seyahat', 'Danışmanlık ve Hizmet', 'Pazarlama', 'Yatırım', 'Diğer'];

type Asama = { kod: string; tpl: string; ad: string; ay: number; gun: [number, number]; dk: number; baskan: string; roller: string[]; direktorler: boolean; gundem: string[] };
/** Toplantılar ilgili gün aralığındaki Çarşamba 10:00'dadır; tatile denk gelirse aralık içindeki ilk çalışma gününe kayar. */
export const ASAMALAR: Asama[] = [
  { kod: 'B1', tpl: 'TPL-11', ad: 'Açılış ve Bütçe Varsayımları', ay: 10, gun: [3, 9], dk: 90, baskan: 'CEO', roller: ['CEO', GMY, MFM], direktorler: true, gundem: [
    'İçinde bulunulan yılın Ocak–Ekim gerçekleşme özeti ve yıl sonu tahmin yöntemi',
    'Gelecek yıl bütçe varsayımları: EUR/TL kuru, enflasyon, ücret artışı, dosya hacmi ve hizmet karması',
    'Bilanço hazırlık takvimi: cari hesap mutabakatları, alacak yaşlandırma, açık hakediş ve tahakkuklar, demirbaş ve BT varlık sayımı, muhasebe hizmetine belge teslimi',
    'Birim bütçe talebi kalemleri ve son tarihleri',
    'Gelecek yıl resmî tatil ve arife takviminin 30 Kasıma kadar tamamlanması',
    'Görev ve sorumlulukların dağıtımı'] },
  { kod: 'B2', tpl: 'TPL-11', ad: 'Birim Bütçe Talepleri', ay: 10, gun: [17, 23], dk: 120, baskan: GMY, roller: [GMY, MFM, 'İnsan Kaynakları Müdürü', 'Bilgi İşlem Müdürü'], direktorler: true, gundem: [
    'Bütçe varsayımlarının kesinleştirilmesi',
    'Direktörlüklerin birim bütçe talepleri: personel, eğitim, ekipman, BT ve lisans, seyahat, danışmanlık ve hizmet, pazarlama, yatırım',
    'Personel planı (İnsan Kaynakları Müdürü)',
    'BT ve lisans planı (Bilgi İşlem Müdürü)',
    'Taleplerin gelir tahminiyle dengelenmesi; öncelik ve kısıntı önerileri',
    'Konsolide taslak için düzeltme listesi'] },
  { kod: 'B3', tpl: 'TPL-11', ad: 'Yıl Sonu Tahmini ve Konsolide Bütçe Taslağı', ay: 11, gun: [1, 7], dk: 120, baskan: GMY, roller: [GMY, MFM], direktorler: true, gundem: [
    'Yıl sonu tahmini gelir tablosu ve bilanço ön çalışması',
    'Cari hesap mutabakatları ve alacak yaşlandırma sonuçları; şüpheli alacaklar',
    'Açık hakediş, tahakkuk ve taahhütler',
    'Konsolide bütçe taslağı ve aylık nakit akışı',
    'Senaryolar: temel, düşük ve yüksek hacim',
    'Parasal onay limitleri ve mali parametrelerin gözden geçirilmesi',
    'Nihai onaya kalan açık konular'] },
  { kod: 'B4', tpl: 'TPL-12', ad: 'Bütçe Nihai Onay', ay: 11, gun: [8, 14], dk: 90, baskan: 'CEO', roller: ['CEO', GMY, MFM], direktorler: true, gundem: [
    'Nihai bütçe ve aylık dağılımı',
    'Yıl sonu kapanış planı ve muhasebe hizmeti takvimi',
    'Gelecek yıl mali parametreleri ile tatil ve arife takviminin kontrolü',
    'Bütçe onay kararı (yürürlük 1 Ocak)',
    'Bütçe–gerçekleşme izleme düzeni (Aylık Yönetim Toplantısında)'] },
];

const G = (d: Date) => d.toISOString().slice(0, 10);
/** Türkiye saatiyle 10:00 toplantı anı. */
export async function asamaTarihi(db: Pool, yil: number, a: Asama, simdi = new Date()): Promise<Date> {
  const tatil = new Set((await db.query(`SELECT to_char(tarih, 'YYYY-MM-DD') t FROM resmi_tatil WHERE NOT yarim_gun`)).rows.map((r) => r.t as string));
  let d = new Date(Date.UTC(yil, a.ay, a.gun[0], 7));
  while (d.getUTCDay() !== 3) d = new Date(d.getTime() + 86_400_000);
  // Tatilse aynı hafta içinde ilk çalışma günü; geçmiş tarih olamaz (dönem geç başlarsa ertesi çalışma gününe alınır).
  const enErken = new Date(simdi.getTime() + 86_400_000);
  while (tatil.has(G(d)) || d.getUTCDay() === 0 || d < enErken) d = new Date(d.getTime() + 86_400_000);
  return d;
}
const gunOnce = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);

async function rolKisileri(db: Pool, roller: string[], direktorler: boolean): Promise<string[]> {
  return (await db.query(`SELECT DISTINCT a.kullanici_ref k FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND h.hesap_durumu = 'Aktif' AND (r.rol_adi = ANY($1) OR ($2 AND r.kademe = 'Direktör'))`, [roller, direktorler])).rows.map((r) => r.k as string);
}

/** Zamanlayıcı: Kasımın ilk gününden itibaren bir kez dönemi açar; Aralıkta takvim eksikse CEO'ya yükseltir. */
export async function butceDonemiIsle(db: Pool, simdi = new Date()): Promise<number> {
  const yil = simdi.getUTCFullYear(); const ay = simdi.getUTCMonth(); let n = 0;
  if (ay === 11 && !(await db.query(`SELECT 1 FROM resmi_tatil WHERE extract(year FROM tarih) = $1 LIMIT 1`, [yil + 1])).rowCount && await birKez(db, 'tatil_takvimi_eksik', String(yil + 1))) {
    await kartAc(db, { tur: 'Tatil Takvimi Eksik', kategori: 'gorev', oncelik: 'Yüksek', baslik: `${yil + 1} Tatil ve Arife Takvimi Girilmedi`, ozet: 'İş günü sayaçları yalnız Pazar gününü düşüyor; takvimin Bütçe Nihai Onay Toplantısından önce tamamlanması rica olunur.', sahipRol: await rolId(db, 'CEO'), nesneTuru: 'Takvim', nesneKimligi: String(yil + 1) }); n++;
  }
  if (ay !== 10 || !(await birKez(db, 'butce_donemi', String(yil)))) return n;
  await db.query(`INSERT INTO butce_donemi (yil) VALUES ($1) ON CONFLICT DO NOTHING`, [yil + 1]);
  const t: Record<string, Date> = {};
  for (const a of ASAMALAR) t[a.kod] = await asamaTarihi(db, yil, a, simdi);
  const gorev = async (rol: string, baslik: string, ozet: string, son: Date) => { await kartAc(db, { tur: 'Bütçe Dönemi', kategori: 'gorev', baslik, ozet, sahipRol: await rolId(db, rol), sonZaman: son, nesneTuru: 'Bütçe Dönemi', nesneKimligi: String(yil + 1) }); n++; };
  await gorev(GMY, `${yil + 1} Bütçe Varsayımları`, 'EUR/TL kuru, enflasyon, ücret artışı, dosya hacmi ve hizmet karması varsayımlarını Açılış Toplantısına hazırlamanız rica olunur.', gunOnce(t.B1!, 1));
  await gorev(GMY, `${yil + 1} Tatil ve Arife Takvimi`, 'Gelecek yılın resmî tatil ve arife günlerini 30 Kasıma kadar takvime girmeniz rica olunur.', new Date(Date.UTC(yil, 10, 30, 15)));
  for (const r of (await db.query(`SELECT rol_adi FROM rol WHERE kademe = 'Direktör' ORDER BY rol_adi`)).rows) await gorev(r.rol_adi, `${yil + 1} Birim Bütçe Talebi`, 'Direktörlüğünüzün bütçe talebini kalem, tutar ve gerekçesiyle Bütçe ekranına girmeniz rica olunur.', gunOnce(t.B2!, 2));
  await gorev('İnsan Kaynakları Müdürü', `${yil + 1} Personel Planı`, 'Kadro, işe alım, ücret artışı ve eğitim planını Birim Bütçe Talepleri Toplantısına hazırlamanız rica olunur.', gunOnce(t.B2!, 2));
  await gorev('Bilgi İşlem Müdürü', `${yil} Demirbaş ve BT Varlık Sayımı; ${yil + 1} BT ve Lisans Planı`, 'Sayım sonucunu ve lisans yenilemelerini bütçe çalışmasına hazırlamanız rica olunur.', gunOnce(t.B2!, 2));
  await gorev(MFM, `${yil} Cari Hesap Mutabakatları`, 'Çözüm Ortakları, sigorta şirketleri, tesisler ve tedarikçilerle cari mutabakatları tamamlamanız rica olunur.', gunOnce(t.B3!, 2));
  await gorev(MFM, `${yil} Alacak Yaşlandırma ve Şüpheli Alacaklar`, 'Yaşlandırma tablosu ve şüpheli alacak listesini hazırlamanız rica olunur.', gunOnce(t.B3!, 2));
  await gorev(MFM, `${yil} Muhasebe Hizmetine Yıl Sonu Belge Teslimi`, 'Yıl sonu kapanış takvimini muhasebe hizmetiyle kesinleştirip belge teslim listesini tamamlamanız rica olunur.', gunOnce(t.B4!, 2));
  await gorev(TID, `${yil} Yıl Sonu Tahmini ve Bilanço Ön Çalışması`, 'Gelir tablosu tahmini, açık hakediş, tahakkuk ve taahhütleri hazırlamanız rica olunur.', gunOnce(t.B3!, 2));
  await gorev(TID, `${yil + 1} Konsolide Bütçe Taslağı`, 'Birim talepleri ve varsayımlarla konsolide taslak ile aylık nakit akışını hazırlamanız rica olunur.', gunOnce(t.B3!, 1));
  const duzenleyen = (await rolSahipleri(db, await rolId(db, MFM)))[0] ?? (await rolSahipleri(db, await rolId(db, GMY)))[0];
  if (!duzenleyen) return n;
  for (const a of ASAMALAR) {
    const kisiler = await rolKisileri(db, a.roller, a.direktorler); if (!kisiler.length) continue;
    const baskan = (await rolSahipleri(db, await rolId(db, a.baskan)))[0] ?? (await rolSahipleri(db, await rolId(db, GMY)))[0] ?? duzenleyen;
    const liste = [...new Set([...kisiler, baskan, duzenleyen])];
    const konu = `${a.kod} · ${yil + 1} Bütçe: ${a.ad}`;
    const id = (await db.query(`INSERT INTO toplanti (tpl_kod, konu, gundem, baslangic, sure_dk, duzenleyen_ref, baskan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [a.tpl, konu, a.gundem.map((x, i) => `${i + 1}. ${x}`).join('\n'), t[a.kod], a.dk, duzenleyen, baskan])).rows[0].kimlik as string;
    for (const k of liste) await db.query(`INSERT INTO toplanti_katilimci (toplanti_ref, kullanici_ref, katilim) VALUES ($1,$2,'Zorunlu') ON CONFLICT DO NOTHING`, [id, k]);
    await bildir(db, { olay: `tpl-davet:${id}`, kullanicilar: liste, baslik: `Toplantı Daveti: ${konu}`, ozet: t[a.kod]!.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' }), eposta: true });
    n++;
  }
  return n;
}

export function butceYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT r.rol_adi, r.kademe FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows as { rol_adi: string; kademe: string }[];
  const TUMU = ['CEO', GMY, MFM, TID];
  const BIRIM = ['İnsan Kaynakları Müdürü', 'Bilgi İşlem Müdürü', GMY, MFM];

  s.get('/butce/:yil', oturumlu, async (i, y) => {
    const yil = Number((i.params as { yil: string }).yil); const r = await roller(i.oturum!.kullanici);
    const tum = r.some((x) => TUMU.includes(x.rol_adi)); const birimler = r.filter((x) => x.kademe === 'Direktör' || BIRIM.includes(x.rol_adi)).map((x) => x.rol_adi);
    if (!Number.isInteger(yil) || (!tum && !birimler.length)) return yok(y);
    const d = (await b.db.query(`SELECT yil, durum, onay_zamani, karar_notu FROM butce_donemi WHERE yil = $1`, [yil])).rows[0] ?? { yil, durum: 'Açılmadı' };
    const t = (await b.db.query(`SELECT kimlik, birim, kategori, aciklama, tutar_eur, gerekce FROM butce_talebi WHERE yil = $1 AND ($2 OR birim = ANY($3)) ORDER BY birim, kategori`, [yil, tum, birimler])).rows;
    const toplam = (k: string) => Object.entries(t.reduce<Record<string, number>>((a, x) => ({ ...a, [x[k]]: (a[x[k]] ?? 0) + Number(x.tutar_eur) }), {})).map(([ad, tutarEur]) => ({ ad, tutarEur: Math.round(tutarEur * 100) / 100 }));
    return { ...d, talepler: t, kategoriToplam: toplam('kategori'), birimToplam: toplam('birim'), birimlerim: birimler, kategoriler: KATEGORILER, onaylayabilir: r.some((x) => x.rol_adi === 'CEO') };
  });

  s.post('/butce/:yil/talep', oturumlu, async (i, y) => {
    const o = i.oturum!; const yil = Number((i.params as { yil: string }).yil); const g = (i.body ?? {}) as { birim?: string; kategori?: string; aciklama?: string; tutar?: number; gerekce?: string };
    const r = await roller(o.kullanici); const birimler = r.filter((x) => x.kademe === 'Direktör' || BIRIM.includes(x.rol_adi)).map((x) => x.rol_adi);
    if (!birimler.length) return yok(y);
    const d = (await b.db.query(`SELECT durum FROM butce_donemi WHERE yil = $1`, [yil])).rows[0];
    if (!d) return y.code(409).send({ hata: 'Bu yılın bütçe dönemi açılmamıştır.' });
    if (d.durum === 'Onaylandı') return y.code(409).send({ hata: 'Bütçe onaylanmıştır; değişiklik yapılamaz.' });
    const birim = g.birim && birimler.includes(g.birim) ? g.birim : birimler.length === 1 ? birimler[0] : null;
    if (!birim) return y.code(400).send({ hata: 'Birimi seçmenizi rica ederiz.' });
    if (!KATEGORILER.includes(g.kategori ?? '') || !g.aciklama?.trim() || !(Number(g.tutar) > 0) || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Kategori, açıklama, tutar ve gerekçeyi girmenizi rica ederiz.' });
    const k = (await b.db.query(`INSERT INTO butce_talebi (yil, birim, kategori, aciklama, tutar_eur, gerekce, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [yil, birim, g.kategori, g.aciklama.trim(), Number(g.tutar), g.gerekce.trim(), o.kullanici])).rows[0].kimlik;
    return { kimlik: k };
  });

  s.post('/butce/:yil/onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const yil = Number((i.params as { yil: string }).yil); const g = (i.body ?? {}) as { not?: string };
    if (!(await roller(o.kullanici)).some((x) => x.rol_adi === 'CEO')) return yok(y);
    const top = Number((await b.db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM butce_talebi WHERE yil = $1`, [yil])).rows[0].t);
    if (!top) return y.code(409).send({ hata: 'Onaylanacak bütçe kalemi bulunmamaktadır.' });
    const r = await b.db.query(`UPDATE butce_donemi SET durum = 'Onaylandı', onaylayan_ref = $2, onay_zamani = now(), karar_notu = $3 WHERE yil = $1 AND durum = 'Hazırlık'`, [yil, o.kullanici, g.not?.trim() || null]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bütçe dönemi onaya hazır değildir.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bütçe Onaylandı', nesneTuru: 'Bütçe Dönemi', nesneKimligi: String(yil), yeni: { toplam: tutar(top) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Bütçe Dönemi' AND nesne_kimligi = $1 AND kapanma_zamani IS NULL`, [String(yil)]);
    return { tamam: true, toplamEur: top };
  });
}
