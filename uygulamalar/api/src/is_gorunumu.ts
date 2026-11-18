import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { kullaniciIzinleri } from './yetki.js';
import { haftaAnahtari } from './uyum_tarama.js';
import { UUID } from './yat.js';

type Rol = { rol_adi: string; kademe: string; birim: string };
const TEDARIK = ['Tedarik Sorumlusu', 'Tedarik Yöneticisi', 'Tedarik Müdür Yardımcısı', 'Tedarik Yönetimi Müdürü'];
const BITMIS = ['Tamamlandı', 'Kapalı', 'İptal', 'Yerine Geçti'];
const BASLAMAMIS = ['Taslak', 'İç Onayda', 'Kabul Bekliyor', 'Başlangıç Kontrolünde'];
const GUN = 86_400_000;
const roller = async (db: Pool, k: string): Promise<Rol[]> => (await db.query(`SELECT r.rol_adi, r.kademe, r.rol_sahibi_birim birim FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows;
const ustYonetim = (r: Rol) => r.birim === 'Üst Yönetim' || r.kademe === 'Direktör' || r.rol_adi === 'Genel Müdür Yardımcısı' || r.rol_adi === 'CEO';
/** YG-811, YG-364: firma adı yalnız Firma Yönetimi, Operasyon ve üst yönetime görünür. */
export const firmaAdiGorur = (l: Rol[]) => l.some((r) => ['Firma Yönetimi Müdürlüğü', 'Operasyon Müdürlüğü'].includes(r.birim) || ustYonetim(r) || r.rol_adi === 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü');
const tumIsler = (l: Rol[]) => l.some((r) => ['Operasyon Müdürlüğü', 'Teknik Müdürlük', 'Firma Yönetimi Müdürlüğü'].includes(r.birim) || ustYonetim(r));
const tarihStr = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

/** YG-812, YG-813: planlanan konum; izin, nöbet ve keşif kayıtlarından kendiliğinden oluşur, elle girilmez. Anlık GPS kullanılmaz. */
export async function konumPlani(db: Pool, kisiler: string[], bugun = new Date()): Promise<{ kimlik: string; ad: string; gunler: { tarih: string; konum: string }[] }[]> {
  const gunler = Array.from({ length: 7 }, (_, n) => tarihStr(new Date(bugun.getTime() + n * GUN)));
  const ilk = gunler[0]!; const son = gunler[6]!;
  const ad = (await db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kimlik = ANY($1) ORDER BY ad_soyad`, [kisiler])).rows;
  const izin = (await db.query(`SELECT personel_ref k, baslangic::text b, bitis::text s FROM izin_talebi WHERE durum = 'Onaylandı' AND personel_ref = ANY($1) AND bitis >= $2::date AND baslangic <= $3::date`, [kisiler, ilk, son])).rows;
  const nobet = (await db.query(`SELECT v.kullanici_ref k, (v.baslangic AT TIME ZONE 'Europe/Istanbul')::date::text b, (v.bitis AT TIME ZONE 'Europe/Istanbul')::date::text s FROM nobet_vardiyasi v JOIN nobet_cizelgesi c ON c.kimlik = v.cizelge_ref WHERE c.durum = 'Yürürlükte' AND v.kullanici_ref = ANY($1) AND v.bitis >= $2::date AND v.baslangic < $3::date + 1`, [kisiler, ilk, son])).rows;
  const kesif = (await db.query(`SELECT k.sorumlu_ref k, (k.planlanan_baslangic AT TIME ZONE 'Europe/Istanbul')::date::text b, (k.planlanan_bitis AT TIME ZONE 'Europe/Istanbul')::date::text s, d.dosya_no, d.konum FROM kesif k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.durum <> 'Durduruldu' AND k.sorumlu_ref = ANY($1) AND k.planlanan_bitis >= $2::date AND k.planlanan_baslangic < $3::date + 1 ORDER BY k.planlanan_baslangic`, [kisiler, ilk, son])).rows;
  const icinde = (t: string, x: { b: string; s: string }) => x.b <= t && t <= x.s;
  return ad.map((p) => ({
    kimlik: p.kimlik, ad: p.ad_soyad,
    gunler: gunler.map((t) => {
      if (izin.some((x) => x.k === p.kimlik && icinde(t, x))) return { tarih: t, konum: 'İzinli' }; // yalnız İzinli yazar
      const ks = kesif.filter((x) => x.k === p.kimlik && icinde(t, x));
      const parca = ks.map((x) => (x.b < t && t < x.s ? `Yolda · ${x.dosya_no}` : `${x.konum} · ${x.dosya_no}`));
      if (nobet.some((x) => x.k === p.kimlik && icinde(t, x))) parca.push('Nöbetçi');
      return { tarih: t, konum: parca.length ? parca.join(' / ') : 'Merkez Ofis' };
    }),
  }));
}

export function isGorunumuYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  // YG-814–817: iş birimi iş emri; tedarik kolunda sipariş. Listeler iş emri başlangıç, kabul/teslim ve sipariş kayıtlarından oluşur.
  // YG-1685: Kalite Kontrolörün atandığı dosyalardaki açık kontrol noktaları ve Kritik uygunsuzluklar (acil kart; kontrol noktası kapatılmaz).
  s.get('/kalite-pano', oturumlu, async (i, y) => {
    const o = i.oturum!; const l = await roller(b.db, o.kullanici);
    if (!l.some((r) => r.rol_adi === 'Kalite Uzmanı (Kalite Kontrolör)')) return yok(y);
    const kapsam = `EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = e.dosya_ref AND a.kullanici_ref = $1 AND a.rol = 'Kalite Kontrolör' AND a.bitis_zamani IS NULL)`;
    const noktalar = (await b.db.query(`SELECT n.kimlik, n.kontrol_noktasi_no, n.nokta_turu, n.kalem, n.kontrol_ozelligi, n.planlanan_zaman, n.sonuc, e.is_emri_no, d.dosya_no, e.kabul_sinifi
      FROM kontrol_noktasi n JOIN is_emri e ON e.kimlik = n.is_emri_ref JOIN dosya d ON d.kimlik = e.dosya_ref WHERE n.serbest_birakma_zamani IS NULL AND ${kapsam} ORDER BY n.planlanan_zaman LIMIT 100`, [o.kullanici])).rows;
    const kritik = (await b.db.query(`SELECT u.kimlik, u.uygunsuzluk_no, d.dosya_no, u.gercek_durum FROM uygunsuzluk u JOIN dosya d ON d.kimlik = u.dosya_ref JOIN is_emri e ON e.dosya_ref = d.kimlik WHERE u.sinif = 'Kritik' AND u.statu NOT IN ('Kapalı', 'Geçersiz') AND ${kapsam} GROUP BY u.kimlik, u.uygunsuzluk_no, d.dosya_no, u.gercek_durum`, [o.kullanici])).rows;
    return { noktalar, kritik };
  });
  // YG-1586, YG-1587: teknik gözetim panosu. Teknik Yönetici gözetimindeki, Teknik Müdür ve Yardımcısı tüm açık dosyaları kapsar; Teknik Uzman yükü gösterilmez.
  s.get('/teknik-pano', oturumlu, async (i, y) => {
    const o = i.oturum!; const l = await roller(b.db, o.kullanici);
    const mudur = l.some((r) => ['Teknik Müdür', 'Teknik Müdür Yardımcısı'].includes(r.rol_adi)); const ty = l.some((r) => r.rol_adi === 'Teknik Yönetici');
    if (!mudur && !ty) return yok(y);
    const dosyalar = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.oncelik, d.statu, y.yat_adi,
        (SELECT CASE WHEN r.durum = 'Kontrolde' THEN coalesce((SELECT x.rol_adi FROM is_karti k JOIN rol x ON x.kimlik = k.zincir[k.kademe + 1] WHERE k.tur = 'Teknik Rapor' AND k.nesne_kimligi = r.kimlik::text AND k.durum = 'Bekliyor' LIMIT 1), 'Makam') || ' Kontrolünde' ELSE r.durum END FROM teknik_rapor r WHERE r.dosya_ref = d.kimlik ORDER BY r.olusturma_zamani DESC LIMIT 1) rapor
      FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.statu NOT IN ('Kapalı', 'Teknik Kapalı') AND ($1 OR EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = $2 AND a.rol = 'Teknik Yönetici' AND a.bitis_zamani IS NULL))
      ORDER BY CASE d.oncelik WHEN 'Kritik' THEN 0 WHEN 'Yüksek' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, d.dosya_no LIMIT 200`, [mudur, o.kullanici])).rows;
    const { sahaSorumlusuGerekceleri } = await import('./dosya.js'); const uyarilar: { dosya: string; dosya_no: string; tur: string; ozet: string }[] = [];
    for (const d of dosyalar) {
      if (!(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Saha Sorumlusu' AND bitis_zamani IS NULL`, [d.kimlik])).rowCount) { const g = await sahaSorumlusuGerekceleri(b.db, d.kimlik); if (g.length) uyarilar.push({ dosya: d.kimlik, dosya_no: d.dosya_no, tur: 'Saha Sorumlusu Gerekiyor', ozet: g.join(', ') }); }
    }
    for (const u of (await b.db.query(`SELECT u.dosya_ref, d.dosya_no, u.uygunsuzluk_no, u.sinif FROM uygunsuzluk u JOIN dosya d ON d.kimlik = u.dosya_ref WHERE u.statu NOT IN ('Kapalı', 'Geçersiz') AND u.sinif IN ('Majör', 'Kritik') AND u.dosya_ref = ANY($1::uuid[])`, [dosyalar.map((d) => d.kimlik)])).rows)
      uyarilar.push({ dosya: u.dosya_ref, dosya_no: u.dosya_no, tur: `${u.sinif} Uygunsuzluk`, ozet: u.uygunsuzluk_no });
    // YG-1588: Teknik Müdürde ciddi tehlikeyle durdurulan dosyalar (Karar Seviyesi: Siz) ve teknik atama kuyruğu (öncelik → kalan süre → geliş).
    const tm = l.some((r) => r.rol_adi === 'Teknik Müdür');
    const durdurulan = !tm ? [] : (await b.db.query(`SELECT d.kimlik, d.dosya_no, y.yat_adi, (SELECT e.durdurma_nedeni FROM is_emri e WHERE e.dosya_ref = d.kimlik AND e.statu = 'Durduruldu' LIMIT 1) neden FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.calisma_durduruldu AND d.statu NOT IN ('Kapalı', 'Teknik Kapalı')`)).rows;
    const kuyruk = !mudur ? [] : (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.oncelik, y.yat_adi, (SELECT min(s.bitis) FROM dosya_sure s WHERE s.dosya_ref = d.kimlik AND s.tamamlanma IS NULL) son,
        array_remove(ARRAY[CASE WHEN NOT EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)') AND a.bitis_zamani IS NULL) THEN 'Teknik Uzman' END,
          CASE WHEN NOT EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.rol = 'Teknik Yönetici' AND a.bitis_zamani IS NULL) THEN 'Teknik Yönetici' END], NULL) eksik
      FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.statu = 'Açılış Kontrolünde'
        AND (NOT EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)') AND a.bitis_zamani IS NULL) OR NOT EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.rol = 'Teknik Yönetici' AND a.bitis_zamani IS NULL))
      ORDER BY CASE d.oncelik WHEN 'Kritik' THEN 0 WHEN 'Yüksek' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, son NULLS LAST, d.olusturma_zamani LIMIT 50`)).rows;
    await notEkle(dosyalar, 'Teknik Yönetici');
    return { dosyalar, uyarilar, mudur, durdurulan, kuyruk };
  });
  // YG-1586: Teknik Yönetici Saha Sorumlusu ihtiyacını Teknik Müdüre bildirir; atama ayrı onay aranmadan Teknik Müdürdedir.
  s.post('/dosya/:id/saha-sorumlusu-bildir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!/^[0-9a-f-]{36}$/.test(id) || !(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = 'Teknik Yönetici' AND bitis_zamani IS NULL`, [id, o.kullanici])).rowCount) return yok(y);
    const d = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    const g = await (await import('./dosya.js')).sahaSorumlusuGerekceleri(b.db, id);
    const { bildir } = await import('./bildirim.js'); const { rolSahipleri } = await import('./makam.js'); const { rolId } = await import('./ihbar.js');
    await bildir(b.db, { olay: `ss-bildir:${id}:${new Date().toISOString().slice(0, 10)}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, 'Teknik Müdür')), baslik: `${d.dosya_no} · Saha Sorumlusu Gerekiyor`, ozet: g.length ? g.join(', ') : 'Teknik Yönetici bildirimi', oncelik: 'Yüksek' });
    return { tamam: true };
  });
  // YG-1582, YG-1586: haftalık gözetim notu; dosyada etkin Operasyon Yöneticisi veya Teknik Yönetici olan yazar, hafta içinde günceller.
  const hafta = () => haftaAnahtari(new Date(Date.now() + 3 * 3_600_000));
  const notEkle = async (l: { kimlik: string; gozetim_notu?: string | null }[], rol: string) => {
    if (!l.length) return;
    const n = new Map((await b.db.query(`SELECT dosya_ref::text, notu FROM gozetim_notu WHERE rol = $1 AND hafta = $2 AND dosya_ref = ANY($3::uuid[])`, [rol, hafta(), l.map((x) => x.kimlik)])).rows.map((r) => [r.dosya_ref as string, r.notu as string]));
    for (const x of l) x.gozetim_notu = n.get(x.kimlik) ?? null;
  };
  s.post('/dosya/:id/gozetim-notu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const notu = String(((i.body ?? {}) as { notu?: string }).notu ?? '').trim();
    if (!UUID.test(id)) return yok(y);
    const rol = (await b.db.query(`SELECT rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol IN ('Operasyon Yöneticisi', 'Teknik Yönetici') AND bitis_zamani IS NULL ORDER BY rol LIMIT 1`, [id, o.kullanici])).rows[0]?.rol as string | undefined;
    if (!rol) return yok(y);
    if (!notu) return y.code(400).send({ hata: 'Gözetim notunu yazmanızı rica ederiz.' });
    await b.db.query(`INSERT INTO gozetim_notu (dosya_ref, rol, hafta, notu, yazan_ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (dosya_ref, rol, hafta) DO UPDATE SET notu = EXCLUDED.notu, yazan_ref = EXCLUDED.yazan_ref, zaman = now()`, [id, rol, hafta(), notu, o.kullanici]);
    return { tamam: true };
  });
  // YG-1582, YG-1583: Operasyon panosu. Operasyon Yöneticisi gözetimindeki dosyaları, Müdür ve Müdür Yardımcısı tüm aktif dosyaları kapsar.
  s.get('/operasyon-pano', oturumlu, async (i, y) => {
    const o = i.oturum!; const l = await roller(b.db, o.kullanici);
    const mudur = l.some((r) => ['Operasyon Müdürü', 'Operasyon Müdür Yardımcısı'].includes(r.rol_adi)); const oy = l.some((r) => r.rol_adi === 'Operasyon Yöneticisi');
    if (!mudur && !oy) return yok(y);
    const kapsam = `d.statu NOT IN ('Kapalı', 'Teknik Kapalı') AND ($1 OR EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = $2 AND a.rol = 'Operasyon Yöneticisi' AND a.bitis_zamani IS NULL))`;
    const dosyalar = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.oncelik, d.statu, d.asama, y.yat_adi, h.ad_soyad dosya_sorumlusu FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref WHERE ${kapsam} ORDER BY CASE d.oncelik WHEN 'Kritik' THEN 0 WHEN 'Yüksek' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, d.dosya_no LIMIT 200`, [mudur, o.kullanici])).rows;
    const ids = dosyalar.map((x) => x.kimlik as string);
    const mudahale = [
      ...(await b.db.query(`SELECT k.baslik, k.son_zaman, 'Gecikmiş Görev' tur FROM is_karti k WHERE k.durum = 'Bekliyor' AND k.son_zaman < now() AND k.nesne_turu = 'Dosya' AND k.nesne_kimligi = ANY($1::text[]) AND k.tur <> 'İlerleme Özetini Gönder' ORDER BY k.son_zaman LIMIT 50`, [ids])).rows,
      ...(await b.db.query(`SELECT k.baslik, k.son_zaman, 'Gönderilmemiş İlerleme Özeti' tur FROM is_karti k WHERE k.durum = 'Bekliyor' AND k.tur = 'İlerleme Özetini Gönder' AND k.son_zaman < now() AND k.nesne_kimligi = ANY($1::text[]) LIMIT 50`, [ids])).rows,
      ...(await b.db.query(`SELECT d.dosya_no || ' · Beklemede ' || (current_date - x.olusturma_zamani::date) || '. gün · ' || x.neden baslik, x.hedef_tarih::text son_zaman, 'Beklemede 10. Gün' tur FROM beklemede_isareti x JOIN dosya d ON d.kimlik = x.dosya_ref WHERE x.kaldirilma_zamani IS NULL AND x.olusturma_zamani <= now() - interval '10 days' AND x.dosya_ref = ANY($1::uuid[])`, [ids])).rows,
    ];
    const ekip = (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND r.rol_adi = 'Dosya Sorumlusu' AND h.hesap_durumu = 'Aktif' ORDER BY h.ad_soyad`)).rows;
    const { kapasiteYuku, KAPASITE } = await import('./dosya.js'); const ust = KAPASITE['Dosya Sorumlusu'] ?? 25;
    for (const e of ekip) e.yuk = await kapasiteYuku(b.db, e.kimlik, 'Dosya Sorumlusu');
    const dolu = ekip.filter((e) => e.yuk >= ust * 0.8); const bos = ekip.filter((e) => e.yuk <= ust * 0.5).sort((a, c) => a.yuk - c.yuk);
    const oneri = dolu.length && bos.length ? `${dolu.map((e) => e.ad_soyad).join(', ')} kapasitesinin %80'ine ulaştı; yeni dosyalar ${bos.slice(0, 2).map((e) => e.ad_soyad).join(', ')} üzerinden dengelenebilir (öneri Operasyon Müdürüne).` : null;
    // YG-1584: atama kuyruğu (yalnız Müdürlük); öncelik sınıfı, sonra hizmet süresinin dolmasına en az kalan, sonra geliş sırası; önerilen Dosya Sorumlusu en düşük yüklü ve %100 olmayan kişi.
    const kuyruk = !mudur ? [] : (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.oncelik, y.yat_adi, d.olusturma_zamani, (SELECT min(s.bitis) FROM dosya_sure s WHERE s.dosya_ref = d.kimlik AND s.tamamlanma IS NULL) son FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref
        WHERE d.statu = 'Açılış Kontrolünde' AND NOT EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.rol = 'Dosya Sorumlusu' AND a.bitis_zamani IS NULL)
        ORDER BY CASE d.oncelik WHEN 'Kritik' THEN 0 WHEN 'Yüksek' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, son NULLS LAST, d.olusturma_zamani LIMIT 50`)).rows;
    const onerilen = ekip.filter((e) => e.yuk < ust).sort((a, c) => a.yuk - c.yuk)[0]?.ad_soyad ?? null;
    await notEkle(dosyalar, 'Operasyon Yöneticisi');
    return { dosyalar, mudur, mudahale, ekip: ekip.map((e) => ({ ad: e.ad_soyad, yuk: e.yuk, ust })), oneri, kuyruk: kuyruk.map((k) => ({ ...k, onerilen })) };
  });
  s.get('/is-listeleri', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const l = await roller(b.db, o.kullanici); const adGorur = firmaAdiGorur(l);
    const tedarik = l.some((r) => TEDARIK.includes(r.rol_adi));
    const ortalamaKesifDakika = Number((await b.db.query(`SELECT round(avg(extract(epoch FROM saha_cikis_zamani - kesif_tarihi) / 60))::int d FROM kesif WHERE durum = 'Tamamlandı' AND kesif_tarihi IS NOT NULL AND saha_cikis_zamani > kesif_tarihi`)).rows[0].d ?? 0) || null; // YG-818
    if (tedarik) {
      const sp = (await b.db.query(`SELECT s.kimlik, s.siparis_no, d.dosya_no, x.yat_adi, k.ticari_unvan tedarikci, s.statu, s.teslim_tarihi::text, (SELECT max(m.bekletme_baslangic) FROM malzeme_giris_kabulu m WHERE m.siparis_ref = s.kimlik) teslim_zamani, h.ad_soyad sorumlu FROM tedarik_siparisi s JOIN dosya d ON d.kimlik = s.dosya_ref JOIN yat x ON x.kimlik = d.yat_ref JOIN kurulus k ON k.kimlik = s.kurulus_ref JOIN kullanici_hesabi h ON h.kimlik = s.hazirlayan_ref WHERE s.statu <> 'İptal' ORDER BY s.teslim_tarihi`)).rows;
      const simdi = Date.now();
      return {
        tur: 'Sipariş', ortalamaKesifDakika,
        tamamlanan: sp.filter((x) => ['Teslim Alındı', 'Kapalı'].includes(x.statu) && x.teslim_zamani && simdi - +new Date(x.teslim_zamani) <= 3 * GUN),
        devamEden: sp.filter((x) => ['Verildi', 'Kısmi Teslim'].includes(x.statu)).map((x) => ({ ...x, gecikti: x.teslim_tarihi < tarihStr(new Date()) })).sort((a, c) => Number(c.gecikti) - Number(a.gecikti)),
        planli: sp.filter((x) => ['Taslak', 'Onay Bekliyor'].includes(x.statu)),
      };
    }
    const tum = tumIsler(l) || (await kullaniciIzinleri(b.db, o.kullanici)).includes('dosya.tum');
    const ie = (await b.db.query(`SELECT e.kimlik, e.is_emri_no, e.statu, d.dosya_no, d.kimlik dosya, x.yat_adi, k.ticari_unvan cozum_ortagi, d.ana_teknik_brans brans, h.ad_soyad sorumlu, e.baslangic_tarihi::text baslangic, e.hedef_bitis_tarihi::text hedef,
        coalesce((SELECT max(a.olusturma_zamani) FROM kabul_kaydi a WHERE a.is_emri_ref = e.kimlik AND a.kabul_turu IN ('Teknik Kabul', 'Koşullu Kabul', 'Nihai Kabul')), (SELECT max(t.teslim_zamani) FROM teslim_kaydi t WHERE t.dosya_ref = d.kimlik AND t.durum LIKE 'Teslim Edildi%'), e.kapanis_zamani) tamamlanma
      FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref JOIN yat x ON x.kimlik = d.yat_ref JOIN kurulus k ON k.kimlik = e.kurulus_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref
      WHERE e.statu NOT IN ('İptal', 'Yerine Geçti') AND NOT EXISTS (SELECT 1 FROM is_emri n WHERE n.is_emri_no = e.is_emri_no AND n.surum > e.surum)
        AND ($1 OR EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = $2 AND a.bitis_zamani IS NULL) OR d.dosya_sorumlusu_ref = $2
          OR EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a JOIN rol_atamasi ra ON ra.kullanici_ref = a.kullanici_ref AND ra.atama_durumu = 'Aktif' JOIN rol r ON r.kimlik = ra.rol_ref WHERE a.dosya_ref = d.kimlik AND a.bitis_zamani IS NULL AND r.rol_sahibi_birim = ANY($3::text[])))`, [tum, o.kullanici, l.filter((r) => ['Müdür', 'Müdür Yardımcısı'].includes(r.kademe)).map((r) => r.birim)])).rows // YG-1084: müdür birimindeki personelin dosyalarını görür
      .map((x) => ({ ...x, cozum_ortagi: adGorur ? x.cozum_ortagi : null }));
    const bugun = tarihStr(new Date()); const simdi = Date.now();
    return {
      tur: 'İş Emri', ortalamaKesifDakika,
      tamamlanan: ie.filter((x) => BITMIS.includes(x.statu) && x.tamamlanma && simdi - +new Date(x.tamamlanma) <= 3 * GUN).sort((a, c) => +new Date(c.tamamlanma) - +new Date(a.tamamlanma)), // YG-815
      devamEden: ie.filter((x) => !BITMIS.includes(x.statu) && !BASLAMAMIS.includes(x.statu) && x.baslangic && x.baslangic <= bugun).map((x) => ({ ...x, gecikti: Boolean(x.hedef && x.hedef < bugun) })).sort((a, c) => Number(c.gecikti) - Number(a.gecikti) || String(a.hedef).localeCompare(String(c.hedef))), // YG-816
      planli: ie.filter((x) => !BITMIS.includes(x.statu) && (BASLAMAMIS.includes(x.statu) || !x.baslangic || x.baslangic > bugun)).sort((a, c) => (a.baslangic ? (c.baslangic ? a.baslangic.localeCompare(c.baslangic) : -1) : 1)), // YG-817: belirsiz olanlar sonda
    };
  });

  // YG-812: kişinin kendisi, amirleri (aynı birimde Müdür ve üstü), Operasyon ve Teknik Müdürlükleri, GMY ve CEO görür; dış kullanıcı göremez.
  // YG-1631: kişinin kendi 7 günlük konum planı (Bugün şeridi).
  s.get('/konum-plani/ben', oturumlu, async (i, y) => i.oturum!.grup !== 'LGM İç Rolü' ? yok(y) : (await konumPlani(b.db, [i.oturum!.kullanici]))[0]?.gunler ?? []);
  s.get('/konum-plani', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const l = await roller(b.db, o.kullanici);
    const genel = l.some((r) => ['Operasyon Müdürlüğü', 'Teknik Müdürlük'].includes(r.birim) || r.rol_adi === 'Genel Müdür Yardımcısı' || r.rol_adi === 'CEO');
    const amirBirim = l.filter((r) => ['Müdür', 'Direktör'].includes(r.kademe)).map((r) => r.birim);
    const kisiler = (await b.db.query(`SELECT DISTINCT h.kimlik FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik AND a.atama_durumu = 'Aktif' JOIN rol r ON r.kimlik = a.rol_ref WHERE h.kullanici_grubu = 'LGM İç Rolü' AND h.hesap_durumu = 'Aktif' AND ($1 OR h.kimlik = $2 OR r.rol_sahibi_birim = ANY($3::text[]))`, [genel, o.kullanici, amirBirim])).rows.map((r) => r.kimlik as string);
    return { kisiler: await konumPlani(b.db, kisiler.length ? kisiler : [o.kullanici]) };
  });

  // YG-810, YG-811: dosya haritası; konum bağlama noktasıyla eşleşir, bölge özetleri ve dosya özet kartı. Sigorta kullanıcısı yalnız kendi dosyalarını görür.
  s.get('/dosya-haritasi', oturumlu, async (i, y) => {
    const o = i.oturum!;
    let kosul = 'false'; const p: unknown[] = [];
    if (o.grup === 'LGM İç Rolü') {
      const l = await roller(b.db, o.kullanici);
      const tum = tumIsler(l) || (await kullaniciIzinleri(b.db, o.kullanici)).includes('dosya.tum');
      p.push(tum, o.kullanici); kosul = `($1 OR EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = $2 AND a.bitis_zamani IS NULL))`;
    } else if (o.grup.startsWith('Sigorta')) {
      const sir = (await b.db.query(`SELECT sigortaci_adi FROM sigorta_kullanici WHERE kullanici_ref = $1`, [o.kullanici])).rows[0]?.sigortaci_adi ?? '';
      p.push(sir, o.kullanici); kosul = `(lower(s.sigortaci_adi) = lower($1) OR EXISTS (SELECT 1 FROM dosya_tarafi e WHERE e.dosya_ref = d.kimlik AND e.taraf_rolu = 'Eksper' AND e.kullanici_ref = $2 AND e.aktif))`;
    } else return yok(y);
    const lgm = o.grup === 'LGM İç Rolü';
    const rows = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.statu, d.oncelik, d.tahmini_teslim_tarihi::text hedef, h.ad_soyad sorumlu, d.guncelleme_zamani son_islem,
        EXISTS (SELECT 1 FROM beklemede_isareti x WHERE x.dosya_ref = d.kimlik AND x.kaldirilma_zamani IS NULL) beklemede, n.ad nokta, n.bolge, n.enlem::float8 enlem, n.boylam::float8 boylam
      FROM dosya d LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref
        LEFT JOIN LATERAL (SELECT ad, bolge, enlem, boylam FROM baglama_noktasi n WHERE n.enlem IS NOT NULL AND (n.mukerrer_karari IS DISTINCT FROM 'Birleştirildi') AND (lower(d.konum) LIKE '%' || lower(n.ad) || '%' OR lower(n.ad) LIKE '%' || lower(d.konum) || '%') ORDER BY length(n.ad) DESC LIMIT 1) n ON true
      WHERE d.statu IN ('Açılış Kontrolünde', 'Aktif', 'Kontrollü Askıda') AND ${kosul}`, p)).rows;
    const bolgeler = new Map<string, { bolge: string; devamEden: number; beklemede: number; oncelik: Record<string, number> }>();
    for (const r of rows) {
      const k = r.bolge ?? 'Konumu Eşleşmeyen'; const x = bolgeler.get(k) ?? { bolge: k, devamEden: 0, beklemede: 0, oncelik: {} as Record<string, number> };
      x.devamEden++; if (r.beklemede) x.beklemede++; x.oncelik[String(r.oncelik)] = (x.oncelik[String(r.oncelik)] ?? 0) + 1; bolgeler.set(k, x);
    }
    return {
      bolgeler: [...bolgeler.values()].sort((a, c) => c.devamEden - a.devamEden),
      dosyalar: rows.filter((r) => r.enlem != null).map((r) => ({ kimlik: r.kimlik, dosyaNo: r.dosya_no, statu: r.beklemede ? 'Beklemede' : r.statu, oncelik: r.oncelik, sorumlu: lgm ? r.sorumlu : null, sonIslem: r.son_islem, hedef: r.hedef, nokta: r.nokta, bolge: r.bolge, enlem: r.enlem, boylam: r.boylam })),
    };
  });
}
