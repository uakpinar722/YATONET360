import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { zorunluFormlar } from './zorunlu_form.js';

type Db = Pool | PoolClient;
type Tanim = { kod: string; ad: string; tablo: string; birim: string; yon: 'dusuk' | 'yuksek'; birimAdi: string; sql?: string; hesap?: (db: Db) => Promise<number | null> };
const OP = 'Operasyon Müdürlüğü'; const TK = 'Teknik Müdürlük'; const KL = 'Kalite Müdürlüğü'; const FY = 'Firma Yönetimi Müdürlüğü'; const MF = 'Muhasebe ve Finans Müdürlüğü';
const ONAY = `('Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü')`;
const oran = (pay: string, payda: string) => `SELECT CASE WHEN (${payda}) > 0 THEN round(100.0 * (${pay}) / (${payda}), 1) END n`;

/** Cilt I §9 Tablo 9.5, 9.6, 9.7 ve 9.10 göstergeleri; hesap kaynakları YATONET 360 kayıtlarıdır. */
export const GOSTERGELER: Tanim[] = [
  { kod: 'G-9.5-1', ad: 'İlk yanıt süresi', tablo: '9.5', birim: 'saat', yon: 'dusuk', birimAdi: OP, sql: `SELECT round(avg(extract(epoch FROM tamamlanma - baslangic) / 3600)::numeric, 1) n FROM dosya_sure WHERE tur = 'İlk Yanıt' AND tamamlanma > now() - interval '30 days'` },
  { kod: 'G-9.5-2', ad: 'Keşif planlama süresi', tablo: '9.5', birim: 'saat', yon: 'dusuk', birimAdi: OP, sql: `SELECT round(avg(extract(epoch FROM k.olusturma_zamani - d.olusturma_zamani) / 3600)::numeric, 1) n FROM kesif k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.olusturma_zamani > now() - interval '30 days'` },
  { kod: 'G-9.5-3', ad: 'Teklif çevrim süresi', tablo: '9.5', birim: 'saat', yon: 'dusuk', birimAdi: OP, sql: `SELECT round(avg(extract(epoch FROM tamamlanma - baslangic) / 3600)::numeric, 1) n FROM dosya_sure WHERE tur = 'Teklif' AND tamamlanma > now() - interval '90 days'` },
  { kod: 'G-9.5-4', ad: 'Kilometre taşı uyumu', tablo: '9.5', birim: '%', yon: 'yuksek', birimAdi: OP, sql: oran(`SELECT count(*) FROM dosya_sure WHERE bitis < now() AND bitis > now() - interval '90 days' AND tamamlanma IS NOT NULL AND tamamlanma <= bitis`, `SELECT count(*) FROM dosya_sure WHERE bitis < now() AND bitis > now() - interval '90 days'`) },
  { kod: 'G-9.5-5', ad: 'Bekleyen karar yaşı', tablo: '9.5', birim: 'saat', yon: 'dusuk', birimAdi: OP, sql: `SELECT round(avg(extract(epoch FROM now() - olusturma_zamani) / 3600)::numeric, 1) n FROM is_karti WHERE kategori = 'onay' AND durum = 'Bekliyor'` },
  { kod: 'G-9.5-6', ad: 'Alternatif kapasite kapsamı', tablo: '9.5', birim: '%', yon: 'yuksek', birimAdi: FY, sql: oran(`SELECT count(*) FROM (SELECT y.ana_brans FROM brans_yetkinligi y JOIN kurulus k ON k.kimlik = y.kurulus_ref WHERE k.ag_statusu = 'Aktif' GROUP BY y.ana_brans HAVING count(DISTINCT y.kurulus_ref) >= 2) x`, `SELECT count(*) FROM deger_listesi WHERE liste_kodu = 'LST_ANA_BRANS'`) },
  { kod: 'G-9.6-1', ad: 'İlk seferde kabul', tablo: '9.6', birim: '%', yon: 'yuksek', birimAdi: KL, sql: oran(`SELECT count(DISTINCT x.is_emri_ref) FROM kabul_kaydi x WHERE x.olusturma_zamani > now() - interval '180 days' AND NOT EXISTS (SELECT 1 FROM uygunsuzluk u WHERE u.is_emri_ref = x.is_emri_ref)`, `SELECT count(DISTINCT is_emri_ref) FROM kabul_kaydi WHERE olusturma_zamani > now() - interval '180 days'`) },
  { kod: 'G-9.6-2', ad: 'Yeniden iş oranı', tablo: '9.6', birim: '%', yon: 'dusuk', birimAdi: KL, sql: oran(`SELECT count(DISTINCT u.is_emri_ref) FROM uygunsuzluk u JOIN is_emri e ON e.kimlik = u.is_emri_ref WHERE e.statu IN ('Tamamlandı', 'Kapalı') AND e.olusturma_zamani > now() - interval '180 days'`, `SELECT count(*) FROM is_emri WHERE statu IN ('Tamamlandı', 'Kapalı') AND olusturma_zamani > now() - interval '180 days'`) },
  { kod: 'G-9.6-3', ad: 'Kritik kontrol tamlığı', tablo: '9.6', birim: '%', yon: 'yuksek', birimAdi: KL, sql: oran(`SELECT count(*) FROM kontrol_noktasi WHERE planlanan_zaman < now() AND planlanan_zaman > now() - interval '180 days' AND serbest_birakma_zamani IS NOT NULL AND kanit_belge_ref IS NOT NULL AND serbest_birakma_zamani::date <= planlanan_zaman::date + 1`, `SELECT count(*) FROM kontrol_noktasi WHERE planlanan_zaman < now() AND planlanan_zaman > now() - interval '180 days'`) },
  { kod: 'G-9.6-4', ad: 'Test başarı oranı', tablo: '9.6', birim: '%', yon: 'yuksek', birimAdi: KL, sql: oran(`SELECT count(*) FROM test_kaydi WHERE onceki_test_ref IS NULL AND sonuc = 'Başarılı' AND olusturma_zamani > now() - interval '180 days'`, `SELECT count(*) FROM test_kaydi WHERE onceki_test_ref IS NULL AND sonuc IS NOT NULL AND olusturma_zamani > now() - interval '180 days'`) },
  { kod: 'G-9.6-5', ad: 'Teslim dosyası tamlığı', tablo: '9.6', birim: '%', yon: 'yuksek', birimAdi: KL, hesap: async (db) => { const l = (await db.query(`SELECT kimlik FROM dosya WHERE statu IN ('Kapalı', 'Teknik Kapalı') AND coalesce(kapanis_zamani, guncelleme_zamani) > now() - interval '180 days' ORDER BY coalesce(kapanis_zamani, guncelleme_zamani) DESC LIMIT 200`)).rows; if (!l.length) return null; let t = 0; for (const d of l) if ((await zorunluFormlar(db, d.kimlik)).every((f) => f.var)) t++; return Math.round((1000 * t) / l.length) / 10; } },
  { kod: 'G-9.6-6', ad: 'Garanti bildirim oranı', tablo: '9.6', birim: '%', yon: 'dusuk', birimAdi: TK, sql: oran(`SELECT count(*) FROM garanti_sikayet WHERE olusturma_zamani > now() - interval '365 days'`, `SELECT count(*) FROM dosya WHERE statu IN ('Kapalı', 'Teknik Kapalı') AND coalesce(kapanis_zamani, guncelleme_zamani) > now() - interval '365 days'`) },
  { kod: 'G-9.7-1', ad: 'Risk değerlendirmesi tamlığı', tablo: '9.7', birim: '%', yon: 'yuksek', birimAdi: OP, sql: oran(`SELECT count(DISTINCT k.dosya_ref) FROM kesif k WHERE k.olusturma_zamani > now() - interval '180 days' AND EXISTS (SELECT 1 FROM on_degerlendirme o WHERE o.dosya_ref = k.dosya_ref)`, `SELECT count(DISTINCT dosya_ref) FROM kesif WHERE olusturma_zamani > now() - interval '180 days'`) },
  { kod: 'G-9.7-2', ad: 'Ramak kala bildirimi (30 gün)', tablo: '9.7', birim: 'adet', yon: 'yuksek', birimAdi: KL, sql: `SELECT count(*) n FROM ramak_kala WHERE zaman > now() - interval '30 days'` },
  { kod: 'G-9.7-3', ad: 'İş durdurma kapanışı', tablo: '9.7', birim: '%', yon: 'yuksek', birimAdi: KL, sql: oran(`SELECT count(*) FROM uygunsuzluk WHERE is_durduruldu AND statu = 'Kapalı' AND kapanis_kaniti_ref IS NOT NULL AND kapanis_yetkilisi_ref IS NOT NULL`, `SELECT count(*) FROM uygunsuzluk WHERE is_durduruldu AND statu = 'Kapalı'`) },
  { kod: 'G-9.7-4', ad: 'Çevresel olay (90 gün)', tablo: '9.7', birim: 'adet', yon: 'dusuk', birimAdi: KL, sql: `SELECT count(*) n FROM acil_mudahale a JOIN dosya d ON d.kimlik = a.dosya_ref WHERE (a.olay_turu = 'Kirlilik' OR a.can_cevre_riski) AND d.olusturma_zamani > now() - interval '90 days'` },
  { kod: 'G-9.7-5', ad: 'Süresi dolmuş zorunlu belgesi olan aktif firma', tablo: '9.7', birim: 'adet', yon: 'dusuk', birimAdi: FY, sql: `SELECT count(DISTINCT s.kurulus_ref) n FROM sicil_belgesi s JOIN kurulus k ON k.kimlik = s.kurulus_ref WHERE k.ag_statusu = 'Aktif' AND s.gecerlilik_bitis < current_date AND NOT EXISTS (SELECT 1 FROM sicil_belgesi y WHERE y.kurulus_ref = s.kurulus_ref AND y.tur = s.tur AND y.gecerlilik_bitis >= current_date)` },
  { kod: 'G-9.7-6', ad: 'Düzeltici faaliyet etkinliği', tablo: '9.7', birim: '%', yon: 'yuksek', birimAdi: KL, sql: oran(`SELECT count(*) FROM uygunsuzluk WHERE statu = 'Kapalı' AND hedef_zamani IS NOT NULL AND kapanis_zamani <= hedef_zamani AND kapanis_zamani > now() - interval '180 days'`, `SELECT count(*) FROM uygunsuzluk WHERE statu = 'Kapalı' AND hedef_zamani IS NOT NULL AND kapanis_zamani > now() - interval '180 days'`) },
  { kod: 'G-9.10-1', ad: 'Teklif dönüşü', tablo: '9.10', birim: '%', yon: 'yuksek', birimAdi: MF, sql: oran(`SELECT count(*) FROM fiyat_teklifi WHERE karar IN ${ONAY} AND karar_zamani > now() - interval '180 days'`, `SELECT count(*) FROM fiyat_teklifi WHERE karar IS NOT NULL AND karar_zamani > now() - interval '180 days'`) },
  { kod: 'G-9.10-2', ad: 'Onaylı kapsam sapması (90 gün değişiklik)', tablo: '9.10', birim: 'adet', yon: 'dusuk', birimAdi: OP, sql: `SELECT count(*) n FROM degisiklik_protokolu WHERE olusturma_zamani > now() - interval '90 days'` },
  { kod: 'G-9.10-3', ad: 'Bütçe uyumu', tablo: '9.10', birim: '%', yon: 'yuksek', birimAdi: TK, sql: oran(`SELECT count(DISTINCT f.dosya_ref) FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.statu = 'Karar' AND f.karar IN ${ONAY} AND d.statu NOT IN ('Kapalı', 'Teknik Kapalı') AND NOT EXISTS (SELECT 1 FROM is_karti c WHERE c.tur = 'Bütçe Erken Uyarısı' AND c.nesne_kimligi = f.dosya_ref::text)`, `SELECT count(DISTINCT f.dosya_ref) FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE f.statu = 'Karar' AND f.karar IN ${ONAY} AND d.statu NOT IN ('Kapalı', 'Teknik Kapalı')`) },
  { kod: 'G-9.10-4', ad: 'Hakediş doğruluğu', tablo: '9.10', birim: '%', yon: 'yuksek', birimAdi: MF, sql: oran(`SELECT count(*) FROM hakedis WHERE statu <> 'Reddedildi' AND olusturma_zamani > now() - interval '180 days'`, `SELECT count(*) FROM hakedis WHERE olusturma_zamani > now() - interval '180 days'`) },
  { kod: 'G-9.10-5', ad: 'Tahsilat yaşı (vadesi geçen ortalama)', tablo: '9.10', birim: 'gün', yon: 'dusuk', birimAdi: MF, sql: `SELECT round(avg(current_date - vade)::numeric, 1) n FROM musteri_faturasi WHERE durum IN ('Faturalandı', 'Kısmi Tahsil') AND vade < current_date` },
  { kod: 'G-9.10-6', ad: 'Kalitesizlik maliyeti (12 ay garanti iş emri)', tablo: '9.10', birim: 'EUR', yon: 'dusuk', birimAdi: TK, sql: `SELECT coalesce(sum(firma_bedeli_eur), 0) n FROM is_emri WHERE is_emri_turu = 'GR' AND olusturma_zamani > now() - interval '365 days'` },
];

export type Sonuc = { kod: string; ad: string; tablo: string; deger: number | null; birim: string; birimAdi: string; hedef: number | null; renk: 'yesil' | 'sari' | 'kirmizi' | null; durum: string };

/** Cilt I §9.12: hedef ve eşik veri oluşmadan rastgele belirlenmez; tanımsızken "Başlangıç dönemi" gösterilir. */
export async function gostergeleriHesapla(db: Db, gor: (birim: string) => boolean): Promise<Sonuc[]> {
  const h = new Map((await db.query(`SELECT kod, hedef, uyari_esigi, kritik_esik FROM gosterge_hedefi`)).rows.map((r) => [r.kod, r]));
  const l: Sonuc[] = [];
  for (const g of GOSTERGELER) {
    if (!gor(g.birimAdi)) continue;
    const v = g.hesap ? await g.hesap(db) : (await db.query(g.sql!)).rows[0].n; const deger = v === null || v === undefined ? null : Number(v);
    const e = h.get(g.kod); let renk: Sonuc['renk'] = null; let durum = deger === null ? 'Veri yok' : 'Başlangıç dönemi';
    if (e && deger !== null) { const kotu = (x: number) => (g.yon === 'dusuk' ? deger > x : deger < x); renk = e.kritik_esik !== null && kotu(Number(e.kritik_esik)) ? 'kirmizi' : e.uyari_esigi !== null && kotu(Number(e.uyari_esigi)) ? 'sari' : 'yesil'; durum = { yesil: 'Hedefte', sari: 'İnceleme gerekli', kirmizi: 'Kritik sapma' }[renk]; }
    l.push({ kod: g.kod, ad: g.ad, tablo: g.tablo, deger, birim: g.birim, birimAdi: g.birimAdi, hedef: e?.hedef !== undefined && e?.hedef !== null ? Number(e.hedef) : null, renk, durum });
  }
  return l;
}

export function gostergeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  // Cilt I §9.3: hedef ve eşiği iş sahibi belirler; CEO ve GMY yürürlüğe alır. Değişiklik izlenir.
  s.post('/gosterge/hedef', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, ['CEO', 'Genel Müdür Yardımcısı']))) return yok(y);
    const g = (i.body ?? {}) as { kod?: string; hedef?: number | null; uyari?: number | null; kritik?: number | null; gerekce?: string };
    if (!GOSTERGELER.some((x) => x.kod === g.kod) || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Gösterge ve gerekçe zorunludur.' });
    const n = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number(x));
    if ([g.hedef, g.uyari, g.kritik].some((x) => n(x) !== null && Number.isNaN(n(x)))) return y.code(400).send({ hata: 'Sayısal değer giriniz.' });
    const eski = (await b.db.query(`SELECT hedef, uyari_esigi, kritik_esik FROM gosterge_hedefi WHERE kod = $1`, [g.kod])).rows[0] ?? null;
    await b.db.query(`INSERT INTO gosterge_hedefi (kod, hedef, uyari_esigi, kritik_esik, gerekce, guncelleyen_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kod) DO UPDATE SET hedef = EXCLUDED.hedef, uyari_esigi = EXCLUDED.uyari_esigi, kritik_esik = EXCLUDED.kritik_esik, gerekce = EXCLUDED.gerekce, guncelleyen_ref = EXCLUDED.guncelleyen_ref, zaman = now()`, [g.kod, n(g.hedef), n(g.uyari), n(g.kritik), g.gerekce.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Gösterge Hedefi', nesneTuru: 'Gösterge', nesneKimligi: g.kod!, eski, yeni: { hedef: n(g.hedef), uyari: n(g.uyari), kritik: n(g.kritik) }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // Cilt I Tablo 9.7: ramak kala bildirimi tüm ekiplerden; cezalandırıcı değildir.
  s.post('/ramak-kala', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü' && o.grup !== 'İş Birliği Firması') return yok(y);
    const g = (i.body ?? {}) as { aciklama?: string; faaliyet?: string; dosya?: string };
    if (!g.aciklama?.trim() || !g.faaliyet?.trim()) return y.code(400).send({ hata: 'Faaliyet ve açıklama zorunludur.' });
    await b.db.query(`INSERT INTO ramak_kala (faaliyet, aciklama, dosya_ref, bildiren_ref) VALUES ($1,$2,$3,$4)`, [g.faaliyet.trim(), g.aciklama.trim(), g.dosya && /^[0-9a-f-]{36}$/.test(g.dosya) ? g.dosya : null, o.kullanici]);
    return { tamam: true };
  });
}
