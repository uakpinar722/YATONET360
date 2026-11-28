import { DURAK_SN } from './sure.js';

type Sorgu = { sql: string; kapsam?: string };
const ONAY = `('Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü')`;
const ay = (alan: string) => `to_char(${alan} AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM') = $2`;
/** Dosya kapsamı: rolün ekip ataması veya müdürlük geneli. $1 kullanıcı, $2 dönem. */
const ekip = (rol: string) => `EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = $1 AND a.rol = '${rol}')`;
const GENEL = `$1::text IS NOT NULL`;

const sure = (k: string, km: boolean): Sorgu => ({ kapsam: 'İlerleme raporu adımı henüz sayılmıyor.', sql: `SELECT sum(k) payda, coalesce(sum(k) FILTER (WHERE ok), 0) pay FROM (
  SELECT d.zorluk_katsayisi k, (s.tamamlanma IS NOT NULL AND s.tamamlanma <= s.bitis + make_interval(secs => ${DURAK_SN})) ok FROM dosya_sure s JOIN dosya d ON d.kimlik = s.dosya_ref WHERE ${k} AND ${ay('s.bitis')} AND (s.tamamlanma IS NOT NULL OR s.bitis < now())
  ${km ? `UNION ALL SELECT d.zorluk_katsayisi, (m.gerceklesme_tarihi IS NOT NULL AND m.gerceklesme_tarihi <= coalesce(m.guncel_tarih, m.baz_tarih)) FROM kilometre_tasi m JOIN dosya d ON d.kimlik = m.dosya_ref WHERE ${k} AND to_char(coalesce(m.guncel_tarih, m.baz_tarih), 'YYYY-MM') = $2 AND (m.gerceklesme_tarihi IS NOT NULL OR coalesce(m.guncel_tarih, m.baz_tarih) < current_date)` : ''}) x` });
const kmUyum = (k: string): Sorgu => ({ sql: `SELECT sum(d.zorluk_katsayisi) payda, coalesce(sum(d.zorluk_katsayisi) FILTER (WHERE m.gerceklesme_tarihi IS NOT NULL AND m.gerceklesme_tarihi <= coalesce(m.guncel_tarih, m.baz_tarih)), 0) pay FROM kilometre_tasi m JOIN dosya d ON d.kimlik = m.dosya_ref WHERE ${k} AND to_char(coalesce(m.guncel_tarih, m.baz_tarih), 'YYYY-MM') = $2 AND (m.gerceklesme_tarihi IS NOT NULL OR coalesce(m.guncel_tarih, m.baz_tarih) < current_date)` });
const ilkKabul = (k: string, agirlik: boolean): Sorgu => { const a = agirlik ? 'd.zorluk_katsayisi' : '1'; return { sql: `SELECT sum(${a}) payda, coalesce(sum(${a}) FILTER (WHERE e.teknik_ret_sayisi = 0), 0) pay FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE ${k} AND EXISTS (SELECT 1 FROM kabul_kaydi x WHERE x.is_emri_ref = e.kimlik AND ${ay('x.olusturma_zamani')})` }; };
const kayit = (k: string): Sorgu => ({ sql: `SELECT count(*) payda, count(*) FILTER (WHERE cardinality(coalesce(c.eksiklik_isaretleri, '{}')) = 0) pay FROM kapanis_kontrolu c JOIN dosya d ON d.kimlik = c.dosya_ref WHERE ${k} AND c.durum = 'Onaylandı' AND c.cikis_statusu = 'Teknik Kapalı' AND ${ay('c.kapanis_zamani')}` });
const donusum: Sorgu = { sql: `SELECT count(*) payda, count(*) FILTER (WHERE f.karar IN ${ONAY}) pay FROM fiyat_teklifi f WHERE ${GENEL} AND f.gonderim_zamani IS NOT NULL AND f.statu <> 'Yerine Geçti' AND ${ay('f.gonderim_zamani')}` };
const tahsilat = (k: string): Sorgu => ({ sql: `SELECT sum(f.toplam_eur) payda, coalesce(sum(f.toplam_eur) FILTER (WHERE f.tahsil_edilen_eur >= f.toplam_eur AND (SELECT max(t.tarih) FROM tahsilat t WHERE t.fatura_ref = f.kimlik) <= f.vade), 0) pay FROM musteri_faturasi f JOIN dosya d ON d.kimlik = f.dosya_ref WHERE ${k} AND f.fatura_no IS NOT NULL AND f.vade < current_date AND to_char(f.vade, 'YYYY-MM') = $2` });
const kritik = (k: string): Sorgu => ({ kapsam: 'Zamanında koşulu tanımlı olmadığından kanıtlı kapanış sayılıyor.', sql: `SELECT count(*) payda, count(*) FILTER (WHERE n.serbest_birakma_zamani IS NOT NULL AND n.kanit_belge_ref IS NOT NULL) pay FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref WHERE ${k} AND n.nokta_turu = 'Bekletme' AND n.planlanan_zaman < now() AND ${ay('n.planlanan_zaman')}` });
const garanti = (k: string): Sorgu => ({ kapsam: 'Yeniden işlem sayısı henüz ayrılmıyor; yalnız geçerli garanti kararı sayılıyor.', sql: `SELECT (SELECT sum(d.zorluk_katsayisi) FROM dosya d WHERE ${k} AND to_char(d.teslim_tarihi, 'YYYY-MM') = $2) payda, (SELECT coalesce(sum(d.zorluk_katsayisi), 0) FROM garanti_sikayet g JOIN dosya d ON d.kimlik = g.dosya_ref WHERE ${k} AND g.karar = 'Garanti' AND ${ay('g.karar_zamani')}) pay` });

const TY = ekip('Teknik Yönetici'); const OY = ekip('Operasyon Yöneticisi'); const SS = ekip('Saha Sorumlusu'); const TU = ekip('Teknik Uzman');

// YG-960 (V-1135): Bilgi İşlem göstergeleri destek talebi, yedek, geri yükleme testi ve erişim incelemesi kayıtlarından.
const yanitUyum = (k: string): Sorgu => ({ sql: `SELECT count(*) payda, count(*) FILTER (WHERE t.yanit_zamani IS NOT NULL AND t.yanit_zamani <= t.yanit_son) pay FROM destek_talebi t WHERE ${k} AND ${ay('t.olusturma_zamani')} AND (t.yanit_zamani IS NOT NULL OR t.yanit_son < now())` });
const cozumUyum = (k: string, sv: string[]): Sorgu => ({ sql: `SELECT count(*) payda, count(*) FILTER (WHERE t.cozum_zamani <= t.cozum_son) pay FROM destek_talebi t WHERE ${k} AND t.seviye IN (${sv.map((x) => `'${x}'`).join(', ')}) AND t.cozum_zamani IS NOT NULL AND ${ay('t.cozum_zamani')}` });
const hizmetSeviyesi = (k: string): Sorgu => ({ sql: `SELECT count(*) payda, count(*) FILTER (WHERE t.cozum_zamani <= t.cozum_son AND t.yanit_zamani IS NOT NULL AND t.yanit_zamani <= t.yanit_son) pay FROM destek_talebi t WHERE ${k} AND t.cozum_zamani IS NOT NULL AND ${ay('t.cozum_zamani')}` });
const yenidenAcilma = (k: string): Sorgu => ({ kapsam: 'Yeniden açılma, önceki talebe bağlanan yeni talep (ilgili talep) olarak sayılıyor.', sql: `SELECT count(*) payda, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM destek_talebi y WHERE y.ilgili_ref = t.kimlik AND y.olusturma_zamani <= t.cozum_zamani + interval '30 days')) pay FROM destek_talebi t WHERE ${k} AND t.cozum_zamani IS NOT NULL AND ${ay('t.cozum_zamani')}` });
const aylikTest: Sorgu = { sql: `SELECT 1 payda, CASE WHEN EXISTS (SELECT 1 FROM geri_yukleme_testi g WHERE ${GENEL} AND g.tur = 'Örnek Kayıt' AND ${ay('g.zaman')}) THEN 1 ELSE 0 END pay` };
const BI_DS = 't.atanan_ref = $1';
// YG-960 (V-1135): müşteri ilişkileri ve İK göstergeleri şikâyet, memnuniyet anketi ve Akademi kayıtlarından.
const sikayetYanit: Sorgu = { sql: `SELECT count(*) payda, count(*) FILTER (WHERE g.yanit_zamani IS NOT NULL AND g.yanit_zamani <= g.yanit_son) pay FROM garanti_sikayet g WHERE ${GENEL} AND 'Şikâyet' = ANY(g.kayit_turu) AND g.yanit_son IS NOT NULL AND ${ay('g.bildirim_zamani')} AND (g.yanit_zamani IS NOT NULL OR g.yanit_son < now())` };
const anketYanit: Sorgu = { sql: `SELECT count(*) payda, count(*) FILTER (WHERE a.cevap_zamani IS NOT NULL) pay FROM memnuniyet_anketi a WHERE ${GENEL} AND a.gonderim_zamani IS NOT NULL AND ${ay('a.gonderim_zamani')}` };
const zorunluEgitim: Sorgu = { kapsam: 'Dönem sonu yerine güncel durum ölçülüyor; ders beyanı güncel sürüme göre aranıyor.', sql: `SELECT count(*) payda, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM akademi_ders d WHERE d.aktif AND d.tur = 'Zorunlu'
  AND (cardinality(d.roller) = 0 OR d.roller && (SELECT array_agg(r.rol_adi) FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = h.kimlik AND a.atama_durumu = 'Aktif'))
  AND NOT EXISTS (SELECT 1 FROM akademi_beyan x WHERE x.ders_ref = d.kimlik AND x.surum = d.surum AND x.personel_ref = h.kimlik))) pay FROM kullanici_hesabi h WHERE ${GENEL} AND $2::text IS NOT NULL AND h.kullanici_grubu = 'LGM İç Rolü' AND h.hesap_durumu = 'Aktif'` };

/** Karne Gösterge Kataloğu: kayıtlardan hesaplanabilen göstergeler. Listede olmayan "Ölçüm Yok" kalır. */
export const EK_SORGU: Record<string, Record<string, Sorgu>> = {
  CEO: { 'İlk seferde kabul oranı (şirket)': ilkKabul(GENEL, false), 'Şirket teklif dönüşüm oranı': donusum, 'Sigorta tahsilat süresi uyumu': tahsilat(`${GENEL} AND d.musteri_turu = 'Sigorta Şirketi'`) },
  'Operasyon Müdürü': { 'Müdürlük hizmet süresi uyumu': sure(GENEL, false), 'Teklif dönüşümü': donusum, 'Kayıt bütünlüğü (müdürlük)': kayit(GENEL) },
  'Operasyon Yöneticisi': { 'Gözetim dosyalarında süre uyumu': sure(OY, true), 'Gözetim dosyalarında kayıt bütünlüğü': kayit(OY), 'Yönetici nöbeti yanıt süresi': { sql: `SELECT count(*) payda, count(*) FILTER (WHERE n.donus_zamani <= n.son_zaman) pay FROM nobet_cagrisi n WHERE (n.donen_ref = $1 OR n.sorumlu_ref = $1) AND ${ay('n.olusturma_zamani')}` } },
  'Teknik ve Operasyon Direktörü': { 'Garanti ve yeniden işlem oranı': garanti(GENEL) },
  'Teknik Müdür': { 'Müdürlük ilk seferde kabul oranı': ilkKabul(GENEL, true), 'Garanti ve yeniden işlem oranı': garanti(GENEL), 'Zorluk katsayısı disiplini': { sql: `SELECT count(DISTINCT f.dosya_ref) payda, count(DISTINCT f.dosya_ref) FILTER (WHERE EXISTS (SELECT 1 FROM dosya_zorluk_kaydi z WHERE z.dosya_ref = f.dosya_ref)) pay FROM fiyat_teklifi f WHERE ${GENEL} AND f.karar IN ${ONAY} AND ${ay('f.karar_zamani')}` } },
  'Teknik Yönetici': { 'Gözetim dosyalarında ilk seferde kabul': ilkKabul(TY, true), 'Kritik kontrol tamlığı': kritik(TY) },
  'Teknik Uzman': { 'Garanti ve yeniden işlem oranı': garanti(TU) },
  'Saha Sorumlusu': { 'Saha kilometre taşı uyumu': kmUyum(SS), 'Saha günlüğü kapanışı': { sql: `SELECT count(*) payda, count(*) FILTER (WHERE (g.kapanis_zamani AT TIME ZONE 'Europe/Istanbul')::date = g.tarih) pay FROM firma_gunluk_kaydi g JOIN is_emri e ON e.kimlik = g.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref WHERE ${SS} AND to_char(g.tarih, 'YYYY-MM') = $2` } },
  'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)': { 'Tahsilat süresi (portföy)': tahsilat('d.ticari_sorumlu_ref = $1'), 'Teklif iade oranı': { kapsam: 'Tüm iadeler sayılıyor; hata nedeni ayrılmıyor.', sql: `SELECT count(*) payda, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM is_karti_adim a WHERE a.is_ref = k.kimlik AND a.karar = 'Gerekçeyle İade Et')) pay FROM is_karti k WHERE k.tur = 'Fiyat Teklifi' AND k.hazirlayan_ref = $1 AND ${ay('k.olusturma_zamani')}` } },
  'Kalite Müdürü': { 'İlk seferde kabul oranı': ilkKabul(GENEL, false), 'Kritik kontrol tamlığı': kritik(GENEL), 'Koşullu kabul kapanışı': { sql: `SELECT count(*) payda, count(*) FILTER (WHERE (a.kapanis_zamani AT TIME ZONE 'Europe/Istanbul')::date <= a.hedef_tarih) pay FROM acik_is_kalemi a WHERE ${GENEL} AND a.hedef_tarih < current_date AND to_char(a.hedef_tarih, 'YYYY-MM') = $2` } },
  'Bilgi İşlem Destek Sorumlusu': { 'İlk yanıt süresi uyumu': yanitUyum(BI_DS), 'Çözüm süresi uyumu': cozumUyum('t.cozen_ref = $1', ['D1', 'D2', 'D3']), 'Yeniden açılma oranı': yenidenAcilma('t.cozen_ref = $1') },
  'Bilgi İşlem Müdür Yardımcısı': { 'Destek hizmet seviyesi uyumu': hizmetSeviyesi(GENEL), 'Aylık geri yükleme testi': aylikTest, 'Tekrarlayan talep oranı': yenidenAcilma(GENEL) },
  'Bilgi İşlem Müdürü': {
    'Yedek başarı oranı': { kapsam: 'Döngüden çıkan yedek, hata kaydı yoksa başarılı sayılıyor.', sql: `SELECT count(*) payda, count(*) FILTER (WHERE y.durum = 'Başarılı' OR (y.durum = 'Döngüden Çıktı' AND y.hata IS NULL)) pay FROM yedek_kaydi y WHERE ${GENEL} AND y.durum <> 'Sürüyor' AND ${ay('y.baslangic')}` },
    'Geri yükleme testi zamanlılığı': { ...aylikTest, kapsam: 'Yalnız aylık örnek test sayılıyor; 6 aylık tam test ve yıllık tatbikat takvimi henüz bağlanmadı.' },
    'Erişim incelemesi zamanlılığı': { sql: `SELECT count(*) payda, count(*) FILTER (WHERE e.durum = 'Tamamlandı' AND coalesce((SELECT max(k.karar_zamani) FROM erisim_inceleme_kalemi k WHERE k.inceleme_ref = e.kimlik), e.olusturma_zamani) <= e.son_zaman) pay FROM erisim_inceleme e WHERE ${GENEL} AND ${ay('e.son_zaman')} AND (e.durum = 'Tamamlandı' OR e.son_zaman < now())` },
    'Destek hizmet seviyesi uyumu': hizmetSeviyesi(GENEL) },
  'Bilgi Teknolojileri ve Firma Yönetimi Direktörü': { 'D1–D2 destek çözüm uyumu': cozumUyum(GENEL, ['D1', 'D2']) },
  'Müşteri ve Paydaş İlişkileri Müdürü': { 'Şikâyet ilk yanıt uyumu': sikayetYanit, 'Geri bildirim yanıt oranı': anketYanit },
  'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı': { 'Şikâyet ilk yanıt uyumu': sikayetYanit },
  'Strateji ve Kurumsal Gelişim Direktörü': { 'Şikâyet ilk yanıt uyumu': sikayetYanit },
  'İnsan Kaynakları Müdürü': { 'Zorunlu eğitim tamamlama oranı': zorunluEgitim },
  'Tedarik Sorumlusu': { 'Seçim gerekçesi tamlığı': { sql: `SELECT count(*) payda, count(*) FILTER (WHERE s.tedarikci_teklif_ref IS NOT NULL OR length(trim(coalesce(s.secim_gerekcesi, ''))) > 0) pay FROM tedarik_siparisi s WHERE s.hazirlayan_ref = $1 AND ${ay('s.olusturma_zamani')}` } },
};
