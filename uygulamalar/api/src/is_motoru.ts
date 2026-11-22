import { ozelGunler } from './ozel_gun.js';
import { coz, totpDogrula } from './kripto.js';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { bildir, mesaiIcinde } from './bildirim.js';
import { KAPANIS } from './kapanis.js';
import { rolSahipleri, zinciriDuzelt } from './makam.js';
import { etkinRoller } from './yetki.js';
import { MESLEKI } from './onay_sure.js';

/** Buton standardı YG-1637: ara kademede Onaya Gönder, son makamda Onayla / Reddet, her kademede Gerekçeyle İade Et. */
export type Karar = 'Onaya Gönder' | 'Onayla' | 'Reddet' | 'Gerekçeyle İade Et' | 'Yeniden Gönder' | 'Tamamlandı' | 'Geri Çek' | 'Kademe Atla' | 'İncelendi';
/** YG-1694, A46-S5, A53-S4: bilgi amaçlı raporlar "İncelendi Olarak Kaydet" ile kapanır; gönderen bilgilendirilir (hazırlayan yoksa raporu hazırlayan rol). */
export const INCELEME_TURLERI: Record<string, string | null> = { 'Aylık İSG Göstergeleri': 'İSG Sorumlusu', 'Aylık Destek İstatistiği': null, 'Haftalık Uygunsuzluk Süre Raporu': null };
export const INCELENDI_METNI = 'İncelediğiniz kayda geçer; gönderen kişiye bilgi gider.';

export interface KartGirdisi {
  tur: string; baslik: string; ozet?: string; oncelik?: string; hazirlayan?: string | null; zincir?: string[];
  sahipKullanici?: string; sahipRol?: string; kategori?: 'onay' | 'islem' | 'gorev'; sonZaman?: Date | null; nesneTuru?: string; nesneKimligi?: string; simdi?: Date; ayrik?: string[]; tutar?: number | null; belgeSurumu?: string | null;
}

export { rolSahipleri };

/** Modüllerin ortak giriş noktası (YG-1143): iş kartı açar ve sıradaki makama bildirir. */
export async function kartAc(db: Pool | PoolClient, g: KartGirdisi): Promise<string> {
  const kategori = g.kategori ?? (g.zincir?.length ? 'onay' : 'islem');
  const ilkZincir = g.zincir ?? [];
  if (g.zincir?.length) g = { ...g, zincir: await zinciriDuzelt(db, g.zincir, g.hazirlayan, g.ayrik) };
  const atlanan = ilkZincir.filter((r) => !g.zincir!.includes(r)); // YG-168: görev ayrılığı atlaması işlem izine yazılır
  // YG-228: mesai dışında Kritik onay, son makam Direktör, GMY veya CEO ise ara kademeler beklenmeden son makama gider; ara kademeler bilgilenir.
  let ilkKademe = 0;
  if (kategori === 'onay' && g.oncelik === 'Kritik' && g.zincir!.length > 1 && !MESLEKI.has(g.tur) && !mesaiIcinde(g.simdi ?? new Date())) {
    const son = (await db.query(`SELECT rol_adi, kademe FROM rol WHERE kimlik = $1`, [g.zincir![g.zincir!.length - 1]])).rows[0];
    if (son && (son.kademe === 'Direktör' || son.rol_adi === 'Genel Müdür Yardımcısı' || son.rol_adi === 'CEO')) ilkKademe = g.zincir!.length - 1;
  }
  // YG-1607: 5 günü aşan süre gün sayısıyla izlenir (son gün 12:00, pazar ve tatilde ilk çalışma günü).
  let sonZaman = g.sonZaman ?? null; let sureNotu: string | null = null;
  if (sonZaman) { const { gunSuresiBitis, tatilGunleri } = await import('./sure.js'); const s = gunSuresiBitis(sonZaman, g.simdi ?? new Date(), g.oncelik ?? 'Normal', await tatilGunleri(db)); sonZaman = s.bitis; sureNotu = s.not; }
  const { rows } = await db.query(
    `INSERT INTO is_karti (tur, kategori, baslik, ozet, oncelik, hazirlayan_ref, zincir, sahip_kullanici_ref, sahip_rol_ref, son_zaman, nesne_turu, nesne_kimligi, kademe, ayrik_kullanicilar, tutar_eur, belge_surumu, sure_notu)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING kimlik`,
    [g.tur, kategori, g.baslik, g.ozet ?? null, g.oncelik ?? 'Normal', g.hazirlayan ?? null, g.zincir ?? [], g.sahipKullanici ?? null, g.sahipRol ?? null, sonZaman, g.nesneTuru ?? null, g.nesneKimligi ?? null, ilkKademe, g.ayrik ?? [], g.tutar ?? null, g.belgeSurumu ?? null, sureNotu]);
  const id = rows[0].kimlik as string;
  if (atlanan.length) await izYaz(db, { aktor: g.hazirlayan ?? null, eylem: 'Görev Ayrılığı Kademe Atlaması', nesneTuru: g.tur, nesneKimligi: id, eski: { zincir: ilkZincir }, yeni: { zincir: g.zincir, atlanan }, gerekce: 'Makamın sahipleri görev ayrılığına takıldığı için onay bir üst makama geçti.', sonuc: 'Başarılı' });
  if (ilkKademe) { const ara: string[] = []; for (const r of g.zincir!.slice(0, ilkKademe)) ara.push(...await rolSahipleri(db, r)); await bildir(db, { olay: `kart-ara:${id}`, kullanicilar: ara, baslik: `Bilgi: Doğrudan Son Makama Gitti: ${g.baslik}`, oncelik: g.oncelik, isRef: id }); }
  const hedef = kategori === 'onay' ? await rolSahipleri(db, g.zincir![ilkKademe]!) : g.sahipKullanici ? [g.sahipKullanici] : await rolSahipleri(db, g.sahipRol!);
  await bildir(db, { olay: `kart-ac:${id}`, kullanicilar: hedef.filter((k) => k !== g.hazirlayan), baslik: `Yeni İş: ${g.baslik}`, ozet: g.ozet ?? null, isRef: id, oncelik: g.oncelik, eposta: true });
  return id;
}

/** Görev ayrılığı yalnız son gönderimden sonraki kararlara bakar: iade edilip yeniden gönderilen kayda aynı makam yine karar verir. */
const SON_GONDERIM = `(SELECT coalesce(max(g.kimlik), 0) FROM is_karti_adim g WHERE g.is_ref = k.kimlik AND g.karar = 'Yeniden Gönder')`;
// YG-058: kart statüsü ortak akışla (Açık → İşlemde → Kapalı; Geri Çekildi Geçersiz); Beklemede ve Gecikmiş işarettir.
const ORTAK_STATU = `CASE WHEN k.durum = 'Geri Çekildi' THEN 'Geçersiz' WHEN k.durum IN ('Tamamlandı', 'Onaylandı', 'Reddedildi') THEN 'Kapalı' WHEN k.durum = 'İade Edildi' OR k.kademe > 0 THEN 'İşlemde' ELSE 'Açık' END AS ortak_statu,
  EXISTS (SELECT 1 FROM beklemede_isareti w WHERE w.dosya_ref::text = k.nesne_kimligi AND w.kaldirilma_zamani IS NULL) AS beklemede, (k.durum IN ('Bekliyor', 'İade Edildi') AND k.son_zaman < now()) AS gecikmis`;
const SECIM = `${ORTAK_STATU}, k.kimlik, k.tur, k.kategori, k.baslik, k.ozet, k.oncelik, k.son_zaman, k.sure_notu, k.olusturma_zamani, k.kademe, k.durum, k.hazirlayan_ref, cardinality(k.zincir) AS kademe_sayisi, (SELECT string_agg('Kademe ' || (a.kademe + 1) || ': ' || a.gerekce, ' · ' ORDER BY a.kimlik) FROM is_karti_adim a WHERE a.is_ref = k.kimlik AND a.karar = 'Onaya Gönder' AND a.gerekce IS NOT NULL) AS arz_notlari`; // YG-166

export function isYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };

  /** Kişinin karar verebileceği adaylar: rolü sıradaki makam; kendi hazırladığı ve daha önce karar verdiği kartlar hariç (YG-1034). */
  async function kartlarim(kullanici: string) {
    const etkin = await etkinRoller(b.db, kullanici, true); const roller = etkin.map((r) => r.kimlik);
    const vekilRoller = etkin.filter((r) => r.vekalet).map((r) => r.kimlik);
    const onay = await b.db.query(
      `SELECT ${SECIM}, h.ad_soyad AS hazirlayan_adi,
              (SELECT rol_adi FROM rol WHERE kimlik = k.zincir[k.kademe + 2]) AS sonraki_rol, (SELECT rol_adi FROM rol WHERE kimlik = k.zincir[k.kademe + 1]) AS makam, k.zincir[k.kademe + 1] = ANY($3) AS vekaleten
         FROM is_karti k LEFT JOIN kullanici_hesabi h ON h.kimlik = k.hazirlayan_ref
        WHERE k.durum = 'Bekliyor' AND k.kategori = 'onay' AND k.zincir[k.kademe + 1] = ANY($1)
          AND k.hazirlayan_ref IS DISTINCT FROM $2
          AND NOT EXISTS (SELECT 1 FROM is_karti_adim a WHERE a.is_ref = k.kimlik AND a.yapan_ref = $2 AND a.kimlik > ${SON_GONDERIM})
        ORDER BY CASE k.oncelik WHEN 'Kritik' THEN 0 WHEN 'Yüksek' THEN 1 ELSE 2 END, k.son_zaman NULLS LAST, k.olusturma_zamani`, [roller, kullanici, vekilRoller]);
    const islem = await b.db.query(
      `SELECT ${SECIM} FROM is_karti k WHERE k.durum = 'Bekliyor' AND k.kategori IN ('islem','gorev') AND (k.sahip_kullanici_ref = $1 OR k.sahip_rol_ref = ANY($2) OR k.ust_rol_ref = ANY($2)) ORDER BY k.son_zaman NULLS LAST, k.olusturma_zamani`, [kullanici, roller]);
    const iade = await b.db.query(`SELECT ${SECIM}, (SELECT gerekce FROM is_karti_adim a WHERE a.is_ref = k.kimlik ORDER BY a.kimlik DESC LIMIT 1) AS gerekce FROM is_karti k WHERE k.durum = 'İade Edildi' AND k.hazirlayan_ref = $1 ORDER BY k.olusturma_zamani DESC`, [kullanici]);
    const gonderilmis = await b.db.query(
      `SELECT ${SECIM}, (SELECT rol_adi FROM rol WHERE kimlik = k.zincir[k.kademe + 1]) AS makam FROM is_karti k
        WHERE k.durum = 'Bekliyor' AND k.kategori = 'onay' AND k.hazirlayan_ref = $1 ORDER BY k.olusturma_zamani DESC`, [kullanici]);
    // YG-169: üst makam, sırası kendisine gelmeyen işi görüp kademeyi gerekçeyle atlayabilir.
    const ustAd = (await b.db.query(`SELECT rol_adi, kademe FROM rol WHERE kimlik = ANY($1)`, [roller])).rows;
    const genel = ustAd.some((r) => r.rol_adi === 'CEO' || r.rol_adi === 'Genel Müdür Yardımcısı');
    const zincirde = genel || ustAd.some((r) => r.kademe === 'Direktör') ? (await b.db.query(
      `SELECT ${SECIM}, (SELECT rol_adi FROM rol WHERE kimlik = k.zincir[k.kademe + 1]) AS makam FROM is_karti k
        WHERE k.durum = 'Bekliyor' AND k.kategori = 'onay' AND k.hazirlayan_ref IS DISTINCT FROM $2 AND NOT k.tur = ANY($3) AND NOT k.zincir[k.kademe + 1] = ANY($1) AND ($4 OR k.zincir && $1::text[]) ORDER BY k.olusturma_zamani DESC LIMIT 100`, [roller, kullanici, [...MESLEKI], genel])).rows : undefined; // YG-1580: silsile bölümü yalnız Direktör ve üstüne
    return { zincirde, onay: onay.rows, islem: islem.rows.filter((r) => r.kategori === 'islem'), gorev: islem.rows.filter((r) => r.kategori === 'gorev'), iade: iade.rows, gonderilmis: gonderilmis.rows };
  }

  s.get('/bugun', oturumlu, async (i) => {
    const o = i.oturum!;
    const k = await kartlarim(o.kullanici);
    // YG-1635: kişinin süreli işlerinden en yakın 5'i.
    const sure = [...k.onay, ...k.islem, ...k.gorev].filter((x) => x.son_zaman).sort((a, c) => +new Date(a.son_zaman) - +new Date(c.son_zaman)).slice(0, 5);
    const kapsam = o.grup === 'LGM İç Rolü' ? ['LGM', 'Tümü'] : ['Dış', 'Tümü'];
    const d = await b.db.query(
      `SELECT d.kimlik, CASE WHEN h.tercih_dili = 'İngilizce' AND d.baslik_en IS NOT NULL THEN d.baslik_en ELSE d.baslik END baslik, CASE WHEN h.tercih_dili = 'İngilizce' AND d.govde_en IS NOT NULL THEN d.govde_en ELSE d.govde END govde, d.ek_belge_ref, (SELECT max(s.surum_no) FROM belge_surum s WHERE s.belge_ref = d.ek_belge_ref) ek_surum, d.zorunlu, d.tur, d.yayim_zamani, r.zaman AS okundu
        FROM duyuru d JOIN kullanici_hesabi h ON h.kimlik = $1 LEFT JOIN duyuru_okuma r ON r.duyuru_ref = d.kimlik AND r.kullanici_ref = $1
        WHERE d.durum = 'Yayında' AND d.kapsam = ANY($2) AND (d.bitis_zamani IS NULL OR d.bitis_zamani > now()) AND (d.yayin_baslangic IS NULL OR d.yayin_baslangic <= now()) AND duyuru_hedefte(d.kimlik, $1) AND (NOT d.zorunlu OR r.zaman IS NULL) ORDER BY d.zorunlu DESC, d.yayim_zamani DESC LIMIT 5`, [o.kullanici, kapsam]);
    const ood = await b.db.query(`SELECT baslangic FROM olaganustu_donem WHERE bitis IS NULL ORDER BY baslangic DESC LIMIT 1`);
    const say = await b.db.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND okunma_zamani IS NULL`, [o.kullanici]);
    const msj = await b.db.query(`SELECT count(*)::int n FROM ic_mesaj WHERE alici_ref = $1 AND okunma_zamani IS NULL`, [o.kullanici]);
    const vek = await b.db.query(`SELECT v.kimlik, v.bitis_tarihi::text AS bitis, h.ad_soyad AS asil, r.rol_adi AS rol FROM vekalet v JOIN kullanici_hesabi h ON h.kimlik = v.asil_ref JOIN rol r ON r.kimlik = v.rol_ref WHERE v.vekil_ref = $1 AND v.durum = 'Aktif' AND v.baslangic_tarihi <= current_date AND v.bitis_tarihi >= current_date ORDER BY v.bitis_tarihi`, [o.kullanici]);
    // YG-1586: Toplantı Başkanlığı; başkanı olunan planlı toplantılar (7 gün içinde başlayacak veya süresi bitip kapanışı bekleyen).
    const baskanlik = (await b.db.query(`SELECT t.kimlik, t.tpl_kod, t.konu, t.baslangic, (t.baslangic + make_interval(mins => t.sure_dk)) < now() AS kapanis_bekliyor, t.tutanak IS NOT NULL AS tutanak_var, (SELECT count(*)::int FROM toplanti_katilimci p WHERE p.toplanti_ref = t.kimlik) AS katilimci
      FROM toplanti t WHERE t.baskan_ref = $1 AND t.durum = 'Planlandı' AND t.baslangic < now() + interval '7 days' ORDER BY t.baslangic LIMIT 20`, [o.kullanici])).rows;
    const tpl = await b.db.query(`SELECT DISTINCT t.kimlik, t.tpl_kod, t.konu, t.baslangic FROM toplanti t JOIN toplanti_katilimci p ON p.toplanti_ref = t.kimlik WHERE p.kullanici_ref = $1 AND t.durum = 'Planlandı' AND t.baslangic BETWEEN now() - interval '1 hour' AND now() + interval '24 hours' ORDER BY t.baslangic`, [o.kullanici]);
    // YG-563: ana sayfada önümüzdeki 7 günün özel günleri (yalnız LGM personeline, rıza verenler).
    const ozel = o.grup === 'LGM İç Rolü' ? await ozelGunler(b.db) : [];
    // YG-1579, YG-1585: son 72 saatte kişinin tamamladığı veya karar verdiği işler; 7 günlük takvim (süreli işler ve toplantılar).
    const tamamlanan = o.grup !== 'LGM İç Rolü' ? [] : (await b.db.query(`SELECT k.kimlik, k.tur, k.baslik, k.durum, k.kapanma_zamani FROM is_karti k WHERE k.kapanma_zamani > now() - interval '72 hours' AND k.durum IN ('Tamamlandı', 'Onaylandı', 'Reddedildi')
        AND (k.sahip_kullanici_ref = $1 OR EXISTS (SELECT 1 FROM is_karti_adim a WHERE a.is_ref = k.kimlik AND a.yapan_ref = $1)) ORDER BY k.kapanma_zamani DESC LIMIT 20`, [o.kullanici])).rows;
    const hafta = Date.now() + 7 * 86_400_000;
    const takvim = o.grup !== 'LGM İç Rolü' ? [] : [...[...k.onay, ...k.islem, ...k.gorev].filter((x) => x.son_zaman && +new Date(x.son_zaman) <= hafta).map((x) => ({ zaman: x.son_zaman, baslik: x.baslik, tur: 'Son Zaman' })),
      ...(await b.db.query(`SELECT DISTINCT t.kimlik, t.konu, t.baslangic FROM toplanti t JOIN toplanti_katilimci p ON p.toplanti_ref = t.kimlik WHERE p.kullanici_ref = $1 AND t.durum = 'Planlandı' AND t.baslangic BETWEEN now() AND now() + interval '7 days'`, [o.kullanici])).rows.map((t) => ({ zaman: t.baslangic, baslik: t.konu, tur: 'Toplantı' }))]
      .sort((a, c) => +new Date(a.zaman) - +new Date(c.zaman));
    return { ...k, tamamlanan, takvim, toplantilar: tpl.rows, baskanlik, sureUyarilari: sure, duyurular: d.rows, ozelGunler: ozel, olaganustu: ood.rows[0]?.baslangic ?? null, okunmamisBildirim: say.rows[0].n, okunmamisMesaj: msj.rows[0].n, vekaletler: vek.rows };
  });

  // YG-502: süreli kartlar son zamandan önceki 30 dakikalık olay, toplantılar kendi süresiyle kişisel takvime aktarılır.
  s.get('/takvim/gorevlerim.ics', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    const k = await kartlarim(o.kullanici); const { takvimDosyasi } = await import('./randevu.js');
    const kart = [...k.onay, ...k.islem, ...k.gorev].filter((x) => x.son_zaman).map((x) => ({ uid: `is-${x.kimlik}`, baslik: `${x.baslik} (Son Zaman)`, aciklama: `${x.tur}${x.ozet ? ` · ${x.ozet}` : ''} · YATONET 360 Bugün ekranından işleyiniz.`, yer: 'YATONET 360', baslangic: new Date(+new Date(x.son_zaman) - 30 * 60_000), dakika: 30 }));
    const tpl = (await b.db.query(`SELECT DISTINCT t.kimlik, t.konu, t.baslangic, t.sure_dk, t.gorusme_baglantisi FROM toplanti t JOIN toplanti_katilimci p ON p.toplanti_ref = t.kimlik WHERE p.kullanici_ref = $1 AND t.durum = 'Planlandı' AND t.baslangic BETWEEN now() AND now() + interval '30 days' ORDER BY t.baslangic`, [o.kullanici])).rows
      .map((t) => ({ uid: `tpl-${t.kimlik}`, baslik: t.konu as string, aciklama: 'Toplantı · YATONET 360', yer: (t.gorusme_baglantisi as string | null) ?? '', baslangic: new Date(t.baslangic), dakika: Number(t.sure_dk) }));
    y.header('content-type', 'text/calendar; charset=utf-8').header('content-disposition', 'attachment; filename="yatonet360-gorevlerim.ics"');
    return takvimDosyasi([...kart, ...tpl]);
  });

  s.post('/is/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const { karar, gerekce, kod, donulecekKademe } = (i.body ?? {}) as { karar?: Karar; gerekce?: string; kod?: string; donulecekKademe?: number };
    if (!/^[0-9a-f-]{36}$/.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    const g = (gerekce ?? '').trim();
    if ((karar === 'Gerekçeyle İade Et' || karar === 'Reddet' || karar === 'Kademe Atla') && !g) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    const etkin = await etkinRoller(b.db, o.kullanici, true); const roller = etkin.map((r) => r.kimlik);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(`SELECT * FROM is_karti WHERE kimlik = $1 FOR UPDATE`, [id]);
      const k = rows[0];
      const dur = async (kod: number, hata: string) => { await c.query('ROLLBACK'); return y.code(kod).send({ hata }); };
      if (!k) return dur(404, 'Kayıt bulunamadı.');
      if (k.ayrik_kullanicilar?.includes(o.kullanici)) return dur(403, 'Görev ayrılığı gereği bu kaydı onaylayamazsınız; teknik kabulü veren kişi ödemeyi onaylamaz.'); // YG-827, YG-1036
      const makam: string | undefined = k.zincir[k.kademe];
      // YG-990: aynı kişi iki kademeyi taşısa da her kademe ayrı karardır (görev ayrılığı); YG-168 birleşik adım bu kuralla çeliştiği için uygulanmaz.
      const birlesikSon = k.kademe;
      const sonMakam = birlesikSon === k.zincir.length - 1;
      // YG-1043: makamın Rol Müfredatı tamamlanmadan o makamda karar verilmez (rolü dersten önce almış olan kişi hariç).
      if (k.kategori === 'onay' && makam && roller.includes(makam) && karar !== 'Geri Çek') {
        const e = (await c.query(`SELECT d.ad FROM akademi_ders d JOIN rol r ON r.kimlik = $2 WHERE d.aktif AND d.tur = 'Rol Müfredatı' AND r.rol_adi = ANY (d.roller)
          AND NOT EXISTS (SELECT 1 FROM akademi_beyan x WHERE x.ders_ref = d.kimlik AND x.personel_ref = $1)
          AND NOT EXISTS (SELECT 1 FROM rol_atamasi a WHERE a.kullanici_ref = $1 AND a.rol_ref = $2 AND a.atama_durumu = 'Aktif' AND a.olusturma_zamani <= d.olusturma_zamani) ORDER BY d.ad LIMIT 1`, [o.kullanici, makam])).rows[0];
        if (e) return dur(403, `Bu makamın zorunlu eğitimi (${e.ad}) tamamlanmadan karar verilemez; eğitimi Akademi'den tamamlamanızı rica ederiz.`);
      }
      // YG-1426: kalıcı askı kararı Hukuk ve Uyum görüşü verilmeden son makamda kapanmaz.
      if (k.tur === 'Kalıcı Askı Önerisi' && sonMakam && (karar === 'Onayla' || karar === 'Reddet') && (await c.query(`SELECT 1 FROM is_karti WHERE tur = 'Kalıcı Askı Hukuk Görüşü' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [k.nesne_kimligi])).rowCount) return dur(409, 'Hukuk ve Uyum Görüşü Bekleniyor; görüş verildikten sonra karar verebilirsiniz.');
      let yeni: { durum: string; kademe: number; kapanir: boolean };
      let hedef: string[] = []; let baslik = ''; let kapanisKarari: string = karar!;
      if (karar === 'Geri Çek') { // YG-167
        if (k.durum !== 'İade Edildi' || k.hazirlayan_ref !== o.kullanici) return dur(403, 'Bu işlem için yetkiniz bulunmamaktadır.');
        yeni = { durum: 'Geri Çekildi', kademe: k.kademe, kapanir: true };
        if (k.tur !== 'Fiyat Teklifi' && k.tur !== 'Teknik Rapor') kapanisKarari = 'Reddet';
      } else if (karar === 'Kademe Atla') { // YG-169, YG-170
        if (k.durum !== 'Bekliyor' || k.kategori !== 'onay') return dur(409, 'Bu kayıt üzerinde işlem yapılmıştır.');
        if (MESLEKI.has(k.tur) || k.hazirlayan_ref === o.kullanici) return dur(403, 'Bu kayıtta kademe atlanmaz.');
        const ad = (await c.query(`SELECT kimlik, rol_adi, kademe FROM rol WHERE kimlik = ANY($1)`, [roller])).rows;
        if (!ad.some((r) => r.kademe === 'Direktör' || r.rol_adi === 'Genel Müdür Yardımcısı' || r.rol_adi === 'CEO')) return dur(403, 'Kademe atlama Direktör, Genel Müdür Yardımcısı ve CEO içindir.');
        const son = k.zincir.length - 1; let j = -1;
        for (let n = k.kademe; n <= son; n++) if (roller.includes(k.zincir[n])) j = n;
        const sonAd = (await c.query(`SELECT rol_adi FROM rol WHERE kimlik = $1`, [k.zincir[son]])).rows[0].rol_adi;
        const nihai = j === son || ad.some((r) => r.rol_adi === 'CEO') || (ad.some((r) => r.rol_adi === 'Genel Müdür Yardımcısı') && sonAd !== 'CEO');
        if (j < 0 && !nihai) return dur(403, 'Bu kayıt onay silsilenizde değildir.');
        const atlanan = k.zincir.slice(k.kademe, nihai ? son : j); const ata: string[] = [];
        for (const r of atlanan) ata.push(...await rolSahipleri(c, r));
        await bildir(c, { olay: `kart-atla:${id}:${k.kademe}`, kullanicilar: ata, baslik: `Kademe Atlandı: ${k.baslik}`, ozet: g, isRef: id });
        if (nihai) { yeni = { durum: 'Onaylandı', kademe: son, kapanir: true }; hedef = k.hazirlayan_ref ? [k.hazirlayan_ref] : []; baslik = `Onaylandı: ${k.baslik}`; kapanisKarari = 'Onayla'; }
        else { yeni = { durum: 'Bekliyor', kademe: j + 1, kapanir: false }; hedef = await rolSahipleri(c, k.zincir[j + 1]); baslik = `Onayınızı Bekliyor: ${k.baslik}`; kapanisKarari = 'Onaya Gönder'; }
      } else if (karar === 'Yeniden Gönder') {
        if (k.durum !== 'İade Edildi' || k.hazirlayan_ref !== o.kullanici) return dur(403, 'Bu işlem için yetkiniz bulunmamaktadır.');
        yeni = { durum: 'Bekliyor', kademe: 0, kapanir: false };
        hedef = await rolSahipleri(c, k.zincir[0]); baslik = `Yeniden Gönderildi: ${k.baslik}`;
      } else if (karar === 'İncelendi') { // YG-1694
        if (!(k.tur in INCELEME_TURLERI) || k.kategori === 'onay' || k.durum !== 'Bekliyor' || !(k.sahip_kullanici_ref === o.kullanici || roller.includes(k.sahip_rol_ref) || roller.includes(k.ust_rol_ref))) return dur(403, 'Bu işlem için yetkiniz bulunmamaktadır.');
        yeni = { durum: 'Tamamlandı', kademe: k.kademe, kapanir: true }; baslik = `İncelendi: ${k.baslik}`;
        const gr = INCELEME_TURLERI[k.tur]; hedef = k.hazirlayan_ref ? [k.hazirlayan_ref] : gr ? await rolSahipleri(c, (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [gr])).rows[0]?.kimlik ?? '') : [];
      } else if (karar === 'Tamamlandı') {
        if (k.kategori === 'onay' || k.durum !== 'Bekliyor' || !(k.sahip_kullanici_ref === o.kullanici || roller.includes(k.sahip_rol_ref) || roller.includes(k.ust_rol_ref))) return dur(403, 'Bu işlem için yetkiniz bulunmamaktadır.');
        yeni = { durum: 'Tamamlandı', kademe: k.kademe, kapanir: true };
      } else {
        if (k.durum !== 'Bekliyor') return dur(409, 'Bu kayıt üzerinde işlem yapılmıştır.');
        if (k.kategori !== 'onay' || !makam || !roller.includes(makam)) return dur(403, 'Bu işlem için yetkiniz bulunmamaktadır.');
        // YG-1034, YG-990: hazırlayan veya zincirde daha önce karar veren aynı kaydı onaylayamaz.
        const once = await c.query(`SELECT 1 FROM is_karti_adim a WHERE a.is_ref = $1 AND a.yapan_ref = $2 AND a.kimlik > (SELECT coalesce(max(g.kimlik), 0) FROM is_karti_adim g WHERE g.is_ref = $1 AND g.karar = 'Yeniden Gönder')`, [id, o.kullanici]);
        if (k.hazirlayan_ref === o.kullanici || once.rowCount) return dur(403, 'Kendi hazırladığınız veya daha önce karar verdiğiniz kaydı onaylayamazsınız.');
        if (karar === 'Gerekçeyle İade Et' && Number.isInteger(donulecekKademe) && donulecekKademe! >= 0 && donulecekKademe! < k.kademe) {
          // YG-153: iade önceki bir onay kademesine döner; o makam düzeltilecek hususu gerekçeyle görür.
          yeni = { durum: 'Bekliyor', kademe: donulecekKademe!, kapanir: false };
          hedef = await rolSahipleri(c, k.zincir[donulecekKademe!]); baslik = `Kademenize İade Edildi: ${k.baslik}`;
        } else if (karar === 'Gerekçeyle İade Et') {
          yeni = { durum: 'İade Edildi', kademe: 0, kapanir: false };
          hedef = k.hazirlayan_ref ? [k.hazirlayan_ref] : []; baslik = `İade Edildi: ${k.baslik}`;
        } else if (karar === 'Onaya Gönder') {
          if (sonMakam) return dur(400, 'Son makamda "Onayla" veya "Reddet" kullanılır.');
          yeni = { durum: 'Bekliyor', kademe: birlesikSon + 1, kapanir: false };
          hedef = await rolSahipleri(c, k.zincir[birlesikSon + 1]); baslik = `Onayınızı Bekliyor: ${k.baslik}`;
        } else if (karar === 'Onayla' || karar === 'Reddet') {
          if (!sonMakam) return dur(400, 'Ara kademede "Onaya Gönder" veya "Gerekçeyle İade Et" kullanılır.');
          // YG-222: limit üstü son onayda doğrulama kodu yeniden istenir.
          const esik = (await c.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'onay_kod_esik_eur'`)).rows[0]?.deger;
          if (karar === 'Onayla' && esik !== null && esik !== undefined && k.tutar_eur !== null && Number(k.tutar_eur) > Number(esik)) {
            const h = (await c.query(`SELECT totp_gizli_sifreli, totp_son_adim FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
            const adim = h?.totp_gizli_sifreli && /^\d{6}$/.test(kod ?? '') ? totpDogrula(coz(h.totp_gizli_sifreli, b.anahtar), kod!, Number(h.totp_son_adim)) : null;
            if (!adim) { await c.query('ROLLBACK'); return y.code(401).send({ hata: 'Bu onay için doğrulama kodunu girmenizi rica ederiz.', kodGerekli: true }); }
            await c.query(`UPDATE kullanici_hesabi SET totp_son_adim = $2 WHERE kimlik = $1`, [o.kullanici, adim]);
          }
          yeni = { durum: karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi', kademe: birlesikSon, kapanir: true };
          hedef = k.hazirlayan_ref ? [k.hazirlayan_ref] : []; baslik = `${yeni.durum}: ${k.baslik}`;
        } else return dur(400, 'Geçersiz karar.');
      }
      await c.query(`UPDATE is_karti SET durum = $2, kademe = $3, kademe_zamani = now(), kapanma_zamani = CASE WHEN $4 THEN now() END WHERE kimlik = $1`, [id, yeni.durum, yeni.kademe, yeni.kapanir]);
      // Silinmez; kararın tamamı adım kaydında kalır (YG-1183).
      await c.query(`INSERT INTO is_karti_adim (is_ref, kademe, karar, gerekce, yapan_ref, rol_ref, vekaleten) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, k.kademe, karar, g || null, o.kullanici, makam ?? null, Boolean(makam && etkin.find((r) => r.kimlik === makam)?.vekalet)]);
      await KAPANIS.get(k.tur)?.(c, k, kapanisKarari as never, o.kullanici);
      if (hedef.length) await bildir(c, { olay: `kart-karar:${id}:${(await c.query('SELECT count(*) n FROM is_karti_adim WHERE is_ref = $1', [id])).rows[0].n}`, kullanicilar: hedef.filter((x) => x !== o.kullanici), baslik, ozet: g || k.ozet, isRef: id, oncelik: k.oncelik, eposta: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: `İş Kartı: ${karar}`, nesneTuru: k.tur, nesneKimligi: id, eski: { durum: k.durum, kademe: k.kademe }, yeni: { durum: yeni.durum, kademe: yeni.kademe }, gerekce: g || undefined, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { durum: yeni.durum, kademe: yeni.kademe };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-1626: okunmamışlar önde.
  s.get('/bildirimler', oturumlu, async (i) => {
    // YG-514: kayıt bağlantısı (dosya numarası başlıktan, iş kartı is_ref'ten); YG-509: gizlenenler listelenmez.
    const { rows } = await b.db.query(`SELECT n.kimlik, n.zaman, n.baslik, n.ozet, n.okunma_zamani, n.is_ref, coalesce(d.dosya_no, substring(n.baslik FROM 'LGM-[0-9]{4}-[0-9]{2}-[0-9]{4}')) dosya_no, c.durum gorev_durumu
      FROM bildirim n LEFT JOIN dosya d ON d.kimlik = n.dosya_ref LEFT JOIN is_karti c ON c.kimlik = n.is_ref WHERE n.kullanici_ref = $1 AND n.gizlenme_zamani IS NULL ORDER BY (n.okunma_zamani IS NULL) DESC, n.zaman DESC LIMIT 200`, [i.oturum!.kullanici]);
    return rows;
  });
  s.post('/bildirim/:id/gizle', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    const r = await b.db.query(`UPDATE bildirim SET gizlenme_zamani = now(), okunma_zamani = coalesce(okunma_zamani, now()) WHERE kimlik::text = $1 AND kullanici_ref = $2 AND gizlenme_zamani IS NULL`, [id, i.oturum!.kullanici]);
    return r.rowCount ? { tamam: true } : y.code(404).send({ hata: 'Bildirim bulunamadı.' });
  });
  s.post('/bildirimler/okundu', oturumlu, async (i) => {
    await b.db.query(`UPDATE bildirim SET okunma_zamani = now() WHERE kullanici_ref = $1 AND okunma_zamani IS NULL`, [i.oturum!.kullanici]);
    await (await import('./bildirim.js')).gonderimOkundu(b.db, i.oturum!.kullanici); // YG-513
    return { tamam: true };
  });

  // YG-1632: okundu kaydı yalnız kişinin kapsamındaki duyuruya yazılır.
  s.post('/duyuru/:id/okudum', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    const kapsam = o.grup === 'LGM İç Rolü' ? ['LGM', 'Tümü'] : ['Dış', 'Tümü'];
    const r = await b.db.query(`INSERT INTO duyuru_okuma (duyuru_ref, kullanici_ref) SELECT kimlik, $2 FROM duyuru WHERE kimlik = $1 AND durum = 'Yayında' AND kapsam = ANY($3) AND duyuru_hedefte(kimlik, $2) ON CONFLICT DO NOTHING`, [id, o.kullanici, kapsam]);
    if (!r.rowCount) {
      const var_ = await b.db.query(`SELECT 1 FROM duyuru_okuma WHERE duyuru_ref = $1 AND kullanici_ref = $2`, [id, o.kullanici]);
      if (!var_.rowCount) return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    }
    return { tamam: true };
  });
}
