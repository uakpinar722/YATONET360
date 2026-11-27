import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kapanisKaydet } from './kapanis.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { etkinRoller, kullaniciRolleri } from './yetki.js';

type Db = Pool | PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIRA: Record<string, number> = { CEO: 9, 'Genel Müdür Yardımcısı': 8, Direktör: 7, Müdür: 6, 'Müdür Yardımcısı': 5, Yönetici: 4 };
const KATILIM = ['Zorunlu', 'İsteğe Bağlı', 'Yalnız Bilgi'];
const HATIRLATMA: [string, number][] = [['24 Saat', 1440], ['1 Saat', 60], ['15 Dakika', 15]];
const VEKIL_SON_DK = 60;
const saatYaz = (d: Date | string) => new Date(d).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });

/** YG-579: katalogda başkan rolü olan toplantıda o rolün katılımcısı; yoksa en üst kademedeki LGM katılımcısı. Eşitlikte düzenleyen, sonra alfabetik ilk kişi. */
const KARAR_TURU = ['Risk Kabulü', 'Kaynak Tahsisi', 'Öncelik', 'İyileştirme', 'Eğitim', 'Ek Denetim', 'Diğer']; const IZLEME = ['Haftalık', 'Aylık', 'Üç Aylık', 'Altı Aylık', 'Yıllık', 'Tek Sefer'];
async function baskanBul(db: Db, rol: string | null, kisiler: string[], duzenleyen: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT h.kimlik, h.ad_soyad, r.rol_adi, r.kademe FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik AND a.atama_durumu = 'Aktif' JOIN rol r ON r.kimlik = a.rol_ref WHERE h.kimlik = ANY($1) AND h.kullanici_grubu = 'LGM İç Rolü'`, [kisiler]);
  const adayRol = rol ? rows.find((x) => x.rol_adi === rol) : null;
  if (adayRol) return adayRol.kimlik;
  const puan = (k: string) => Math.max(0, ...rows.filter((x) => x.kimlik === k).map((x) => SIRA[x.kademe] ?? 1));
  const enIyi = Math.max(0, ...kisiler.map(puan));
  if (puan(duzenleyen) === enIyi) return duzenleyen;
  return rows.filter((x) => puan(x.kimlik) === enIyi).sort((a, b) => a.ad_soyad.localeCompare(b.ad_soyad, 'tr'))[0]?.kimlik ?? duzenleyen;
}

/** YG-584: gündem kayıtlardan dolar. Dosya, uygunsuzluk ve KPI kaynakları kendi modülleri açıldıkça eklenir. */
export async function gundemUret(db: Db, kod: string): Promise<string | null> {
  if (kod === 'TPL-04') {
    // YG-1550: uyum panosu özeti (kırmızı gecikti, sarı 7 gün ve daha az, yeşil süresi var) üç aylık stratejik gözden geçirme gündemine girer.
    const u = (await db.query(`SELECT count(*) FILTER (WHERE son_tarih < current_date)::int k, count(*) FILTER (WHERE son_tarih BETWEEN current_date AND current_date + 7)::int s, count(*) FILTER (WHERE son_tarih > current_date + 7)::int y,
        string_agg(ad, ', ' ORDER BY son_tarih) FILTER (WHERE son_tarih < current_date) gecikenler FROM uyum_gorevi WHERE durum <> 'Kapalı'`)).rows[0];
    return [`Uyum Panosu Özeti: Gecikti ${u.k} · Süresi Yaklaşıyor ${u.s} · Süresi Var ${u.y}`, ...(u.gecikenler ? [`Geciken Yükümlülükler: ${String(u.gecikenler).slice(0, 500)}`] : [])].join('\n');
  }
  if (kod !== 'TPL-02' && kod !== 'TPL-03') return null;
  const { rows } = await db.query(`SELECT count(*)::int n FROM is_karti WHERE durum = 'Bekliyor' AND kategori = 'onay' AND son_zaman < now()`);
  // YG-584: süre aşımları, açık uygunsuzluklar ve Kritik dosyalar gündeme kendiliğinden girer.
  const s = (await db.query(`SELECT (SELECT count(*)::int FROM is_karti WHERE durum = 'Bekliyor' AND kategori IN ('islem', 'gorev') AND son_zaman < now()) gorev,
      (SELECT count(*)::int FROM dosya_sure s JOIN dosya d ON d.kimlik = s.dosya_ref WHERE s.tamamlanma IS NULL AND s.bitis < now() AND d.statu <> 'Kapalı') sure,
      (SELECT count(*)::int FROM uygunsuzluk WHERE statu NOT IN ('Kapalı', 'Geçersiz')) uyg, (SELECT count(*)::int FROM uygunsuzluk WHERE statu NOT IN ('Kapalı', 'Geçersiz') AND sinif IN ('Kritik', 'Majör')) agir,
      (SELECT count(*)::int FROM uygunsuzluk WHERE statu NOT IN ('Kapalı', 'Geçersiz') AND hedef_zamani < now()) gecen,
      (SELECT string_agg(dosya_no, ', ' ORDER BY dosya_no) FROM (SELECT dosya_no FROM dosya WHERE oncelik = 'Kritik' AND statu NOT IN ('Kapalı', 'Teknik Kapalı') ORDER BY dosya_no LIMIT 10) x) kritik`)).rows[0];
  // YG-584: performans göstergeleri (Cilt I §9) gündeme girer; haftalık operasyonda Operasyon, Teknik ve Kalite göstergeleri, aylık yönetimde tümü. Kritik sapma ve inceleme gerekenler önce.
  const { gostergeleriHesapla } = await import('./gosterge.js');
  const birimler = kod === 'TPL-02' ? new Set(['Operasyon Müdürlüğü', 'Teknik Müdürlük', 'Kalite Müdürlüğü']) : null;
  const sira = { kirmizi: 0, sari: 1, yesil: 2 } as const;
  const kpi = (await gostergeleriHesapla(db, (x) => !birimler || birimler.has(x))).filter((g) => g.deger !== null)
    .sort((a, c) => (a.renk ? sira[a.renk] : 3) - (c.renk ? sira[c.renk] : 3))
    .map((g) => `Gösterge · ${g.ad}: ${String(g.deger).replace('.', ',')} ${g.birim}${g.hedef !== null ? ` (hedef ${String(g.hedef).replace('.', ',')})` : ''} · ${g.durum}`);
  return [`Süresi Aşan Onay: ${rows[0].n}`, `Süresi Aşan Görev ve İşlem: ${s.gorev}`, `Hedef Süresi Aşan Dosya Süresi: ${s.sure}`, `Açık Uygunsuzluk: ${s.uyg} (Kritik/Majör: ${s.agir}; hedef süresi geçen: ${s.gecen})`, `Kritik Öncelikli Açık Dosyalar: ${s.kritik ?? 'Yok'}`, ...(kpi.length ? kpi : ['Göstergeler: Hesaplanabilir veri yok'])].join('\n');
}

/** YG-1599: Kapsam Hazırlık Toplantısı (TPL-06) kapanınca dosyada "Fiyat Teklifi Hazırla" görevi Ticari Sorumluya açılır; açık görev varsa toplantı kararı özete eklenir. Hazırlanan teklif varsa görev açılmaz. */
export async function kapsamToplantisiGorevi(db: Db, toplanti: string): Promise<boolean> {
  const t = (await db.query(`SELECT t.tpl_kod, t.dosya_ref, t.tutanak, d.dosya_no, d.ticari_sorumlu_ref FROM toplanti t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1`, [toplanti])).rows[0];
  if (!t || t.tpl_kod !== 'TPL-06') return false;
  await (await import('./kapsam_toplantisi.js')).kapsamKararlariniAktar(db, toplanti); // YG-1598: Teknik Rapor ve Metraj kararları Teknik Uzmana
  const kararlar = (await db.query(`SELECT metin FROM toplanti_karar WHERE toplanti_ref = $1 AND (aktarim_hedefi IS NULL OR aktarim_hedefi = 'Fiyat Teklifi') ORDER BY zaman`, [toplanti])).rows.map((r) => r.metin as string);
  const ozet = `Kapsam Hazırlık Toplantısı kararı: ${(kararlar.length ? kararlar.join('; ') : String(t.tutanak ?? '')).slice(0, 250)}`;
  const cetvel = (await db.query(`SELECT kimlik FROM kapsam_cetveli WHERE dosya_ref = $1 AND durum <> 'Yerine Geçti' ORDER BY surum DESC LIMIT 1`, [t.dosya_ref])).rows[0]?.kimlik as string | undefined;
  const nesne = cetvel ?? String(t.dosya_ref);
  const acik = await db.query(`UPDATE is_karti SET ozet = left(coalesce(ozet, '') || ' ' || $2, 400) WHERE tur = 'Fiyat Teklifi Hazırla' AND nesne_kimligi = ANY($1::text[]) AND durum = 'Bekliyor'`, [[nesne, String(t.dosya_ref)], ozet]);
  if (acik.rowCount) return true;
  if ((await db.query(`SELECT 1 FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu IN ('Taslak', 'İç Onayda') LIMIT 1`, [t.dosya_ref])).rowCount) return false;
  const { kartAc } = await import('./is_motoru.js'); const { rolId } = await import('./ihbar.js');
  await kartAc(db, { tur: 'Fiyat Teklifi Hazırla', kategori: 'islem', baslik: `${t.dosya_no} · Fiyat Teklifi Hazırla`, ozet, ...(t.ticari_sorumlu_ref ? { sahipKullanici: t.ticari_sorumlu_ref } : { sahipRol: await rolId(db, 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)') }), nesneTuru: cetvel ? 'Kapsam Cetveli' : 'Dosya', nesneKimligi: nesne });
  return true;
}

/** Ek II §1.8: vekil üst makamın onayıyla geçerlidir; süre geçtiyse katılımcı mazeretli sayılır. */
kapanisKaydet('Toplantı Vekili', async (c, k, karar) => {
  const r = (await c.query(`SELECT p.kimlik, p.toplanti_ref, p.vekil_ref, t.baslangic, t.konu FROM toplanti_katilimci p JOIN toplanti t ON t.kimlik = p.toplanti_ref WHERE p.kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!r) return;
  const zamaninda = new Date(r.baslangic).getTime() - Date.now() >= VEKIL_SON_DK * 60_000;
  if (karar === 'Onayla' && zamaninda) {
    await c.query(`UPDATE toplanti_katilimci SET vekil_durumu = 'Onaylandı' WHERE kimlik = $1`, [r.kimlik]);
    await c.query(`INSERT INTO toplanti_katilimci (toplanti_ref, kullanici_ref) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [r.toplanti_ref, r.vekil_ref]);
    await bildir(c, { olay: `tpl-vekil:${r.kimlik}`, kullanicilar: [r.vekil_ref], baslik: `Toplantıya Vekil Atandınız: ${r.konu}`, ozet: saatYaz(r.baslangic), acil: true, eposta: true });
  } else if (karar === 'Onayla' || karar === 'Reddet') await c.query(`UPDATE toplanti_katilimci SET vekil_durumu = 'Mazeretli' WHERE kimlik = $1`, [r.kimlik]);
});

/** YG-581: 24 saat, 1 saat ve 15 dakika önce; mesai dışı toplu gönderim kuralının dışındadır. Aynı eşik iki kez gitmez. */
export async function toplantiHatirlat(db: Pool, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(`SELECT kimlik, konu, baslangic, oncelik FROM toplanti WHERE durum = 'Planlandı' AND baslangic > $1 AND baslangic <= $1::timestamptz + interval '24 hours'`, [simdi]);
  let n = 0;
  for (const t of rows) {
    const kalan = (new Date(t.baslangic).getTime() - simdi.getTime()) / 60_000;
    const esik = [...HATIRLATMA].reverse().find(([, dk]) => kalan <= dk);
    if (!esik || !(await birKez(db, 'toplanti_hatirlatma', `${t.kimlik}:${esik[1]}`))) continue;
    const k = (await db.query(`SELECT kullanici_ref FROM toplanti_katilimci WHERE toplanti_ref = $1 AND katilim <> 'Yalnız Bilgi' AND (vekil_durumu IS NULL OR vekil_durumu = 'Onay Bekliyor')`, [t.kimlik])).rows.map((x) => x.kullanici_ref as string);
    await bildir(db, { olay: `tpl-hat:${t.kimlik}:${esik[1]}`, kullanicilar: k, baslik: `Toplantı Hatırlatması · ${esik[0]}: ${t.konu}`, ozet: saatYaz(t.baslangic), oncelik: t.oncelik, acil: true, eposta: true }, simdi);
    n++;
  }
  return n;
}

export function toplantiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const lgmDegil = (grup: string, y: FastifyReply) => (grup === 'LGM İç Rolü' ? null : y.code(403).send({ hata: 'Bu sayfa LGM personeline açıktır.' }));
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Toplantı bulunamadı veya erişim yetkiniz yok.' });
  /** Kişinin planlayabileceği toplantılar: katalogdaki düzenleyen rolü; TPL-10'u her LGM personeli talep edebilir. Dosyaya bağlı toplantılar Dosya modülüyle açılır. */
  const planlanabilir = async (k: string) => {
    const roller = new Set((await etkinRoller(b.db, k)).map((r) => r.kimlik));
    const { rows } = await b.db.query(`SELECT c.*, (SELECT kimlik FROM rol WHERE rol_adi = c.duzenleyen_rol) AS drol FROM toplanti_katalogu c WHERE NOT c.dosyaya_bagli ORDER BY c.kod`);
    return rows.filter((c) => !c.duzenleyen_rol || roller.has(c.drol));
  };
  const katilimciMi = async (id: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM toplanti t LEFT JOIN toplanti_katilimci p ON p.toplanti_ref = t.kimlik AND p.kullanici_ref = $2 WHERE t.kimlik = $1 AND (p.kimlik IS NOT NULL OR t.duzenleyen_ref = $2 OR t.baskan_ref = $2)`, [id, k])).rowCount);
  const cakisanlar = async (kisiler: string[], bas: Date, dk: number) => (await b.db.query(
    `SELECT DISTINCT h.ad_soyad FROM toplanti_katilimci p JOIN toplanti t ON t.kimlik = p.toplanti_ref JOIN kullanici_hesabi h ON h.kimlik = p.kullanici_ref
      WHERE p.kullanici_ref = ANY($1) AND t.durum = 'Planlandı' AND p.katilim = 'Zorunlu' AND t.baslangic < $2::timestamptz + make_interval(mins => $3::int) AND t.baslangic + make_interval(mins => t.sure_dk) > $2::timestamptz ORDER BY 1`, [kisiler, bas, dk])).rows.map((r) => r.ad_soyad as string);

  s.get('/toplanti/secenek', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = lgmDegil(o.grup, y); if (e) return e;
    const kisiler = await b.db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif' AND kimlik <> $1 ORDER BY ad_soyad`, [o.kullanici]);
    const dosyaTurleri = (await b.db.query(`SELECT 1 FROM dosya WHERE dosya_sorumlusu_ref = $1 AND statu NOT IN ('Kapalı') LIMIT 1`, [o.kullanici])).rowCount ? (await b.db.query(`SELECT kod, ad, katilimcilar FROM toplanti_katalogu WHERE dosyaya_bagli AND duzenleyen_rol = 'Dosya Sorumlusu' ORDER BY kod`)).rows.map((c) => ({ ...c, dosyaGerekli: true })) : [];
    return { turler: [...(await planlanabilir(o.kullanici)).map((c) => ({ kod: c.kod, ad: c.ad, katilimcilar: c.katilimcilar })), ...dosyaTurleri], kisiler: kisiler.rows };
  });

  // YG-1408: dış katılımcı portalda kendi toplantılarını görür; gündem ve kararlar iç kayıttır, gösterilmez.
  s.get('/portal/toplantilarim', oturumlu, async (i) => (await b.db.query(`SELECT t.kimlik, t.konu, t.baslangic, t.sure_dk, t.durum, t.gorusme_baglantisi, d.dosya_no FROM toplanti t JOIN toplanti_katilimci p ON p.toplanti_ref = t.kimlik LEFT JOIN dosya d ON d.kimlik = t.dosya_ref
      WHERE p.kullanici_ref = $1 AND t.durum = 'Planlandı' AND t.baslangic > now() - interval '2 hours' ORDER BY t.baslangic LIMIT 20`, [i.oturum!.kullanici])).rows);
  s.get('/toplanti', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = lgmDegil(o.grup, y); if (e) return e;
    const { rows } = await b.db.query(
      `SELECT DISTINCT t.kimlik, t.tpl_kod, c.ad AS tur, t.konu, t.baslangic, t.sure_dk, t.durum, t.oncelik FROM toplanti t JOIN toplanti_katalogu c ON c.kod = t.tpl_kod LEFT JOIN toplanti_katilimci p ON p.toplanti_ref = t.kimlik
        WHERE p.kullanici_ref = $1 OR t.duzenleyen_ref = $1 ORDER BY t.baslangic DESC LIMIT 100`, [o.kullanici]);
    return rows;
  });

  // YG-583: takvim çakışması gösterilir, engellemez.
  s.post('/toplanti/cakisma', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = lgmDegil(o.grup, y); if (e) return e;
    const { kisiler, baslangic, sureDk } = (i.body ?? {}) as { kisiler?: string[]; baslangic?: string; sureDk?: number };
    const bas = new Date(baslangic ?? '');
    if (!Array.isArray(kisiler) || isNaN(bas.getTime()) || !Number.isInteger(sureDk)) return y.code(400).send({ hata: 'Eksik bilgi.' });
    return { cakisanlar: await cakisanlar([...kisiler, o.kullanici], bas, sureDk!) };
  });

  // YG-576, YG-579, YG-582, YG-583: katalogdaki roller otomatik eklenir, davet oluşturma anında gider (YG-581).
  s.post('/toplanti', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = lgmDegil(o.grup, y); if (e) return e;
    const g = (i.body ?? {}) as { kod?: string; konu?: string; gundem?: string; baslangic?: string; sureDk?: number; katilimcilar?: { kullanici: string; katilim?: string }[]; kritik?: boolean; baglanti?: string; dosya?: string; dosyaNo?: string };
    // YG-583: ilgili dosya dosya numarasıyla da seçilebilir.
    if (!g.dosya && g.dosyaNo?.trim()) { g.dosya = (await b.db.query(`SELECT kimlik FROM dosya WHERE dosya_no = $1`, [g.dosyaNo.trim()])).rows[0]?.kimlik; if (!g.dosya) return y.code(400).send({ hata: 'Bu numarada dosya bulunamadı.' }); }
    let c = (await planlanabilir(o.kullanici)).find((x) => x.kod === g.kod);
    // YG-579: dosyaya bağlı toplantıyı o dosyanın Dosya Sorumlusu düzenler; başkan katılımcılar arasındaki en üst kademedir.
    if (!c && g.dosya && UUID.test(g.dosya) && (await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND dosya_sorumlusu_ref = $2`, [g.dosya, o.kullanici])).rowCount) c = (await b.db.query(`SELECT * FROM toplanti_katalogu WHERE kod = $1 AND dosyaya_bagli`, [g.kod])).rows[0];
    if (g.dosya && (!UUID.test(g.dosya) || !(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1`, [g.dosya])).rowCount)) return y.code(400).send({ hata: 'Bağlanacak dosya bulunamadı.' }); // YG-1408
    if (!c) return y.code(403).send({ hata: 'Bu toplantıyı planlama yetkiniz bulunmamaktadır.' });
    if (c.kod === 'TPL-06') return y.code(409).send({ hata: 'Kapsam Hazırlık Toplantısı dosya ekranından, ön koşullar tamamlanınca planlanır.' }); // YG-1598
    if (!g.konu?.trim()) return y.code(400).send({ hata: 'Konu zorunludur.' });
    const bas = new Date(g.baslangic ?? '');
    if (isNaN(bas.getTime()) || bas.getTime() < Date.now() - 60_000) return y.code(400).send({ hata: 'Toplantı için ileri bir zaman seçmenizi rica ederiz.' });
    const dk = g.sureDk ?? 60;
    if (!Number.isInteger(dk) || dk < 5 || dk > 600) return y.code(400).send({ hata: 'Süre 5 ile 600 dakika arasında olmalıdır.' });
    if (g.kritik && c.kod !== 'TPL-10') return y.code(400).send({ hata: 'Kritik işareti yalnız Olağanüstü Toplantıda kullanılır.' });
    const secilen = g.katilimcilar ?? [];
    if (secilen.some((x) => x.katilim && !KATILIM.includes(x.katilim))) return y.code(400).send({ hata: 'Geçersiz katılım durumu.' });
    const liste = new Map<string, string>(secilen.map((x) => [x.kullanici, x.katilim ?? 'Zorunlu']));
    if (liste.size) {
      const v = await b.db.query(`SELECT kimlik, kullanici_grubu FROM kullanici_hesabi WHERE kimlik = ANY($1) AND hesap_durumu = 'Aktif'`, [[...liste.keys()]]);
      if (v.rowCount !== liste.size) return y.code(400).send({ hata: 'Katılımcı geçersizdir.' });
      // YG-1408: dış katılımcı yalnız dosyaya bağlı toplantıya ve dosyaya erişimi varsa eklenir.
      const { dosyaErisimi } = await import('./dosya.js');
      for (const k of v.rows.filter((x) => x.kullanici_grubu !== 'LGM İç Rolü')) if (!g.dosya || !(await dosyaErisimi(b.db, k.kimlik, g.dosya))) return y.code(400).send({ hata: 'Dış katılımcı yalnız erişimi olduğu dosyanın toplantısına eklenir.' });
    }
    const oto = await b.db.query(`SELECT DISTINCT a.kullanici_ref k FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND h.hesap_durumu = 'Aktif' AND (r.rol_adi = ANY($1) OR r.kademe = ANY($2))`, [c.oto_roller, c.oto_kademeler]);
    for (const r of oto.rows) if (!liste.has(r.k)) liste.set(r.k, 'Zorunlu');
    liste.set(o.kullanici, 'Zorunlu');
    if (liste.size < 2) return y.code(400).send({ hata: 'En az bir katılımcı seçilmelidir.' });
    const kisiler = [...liste.keys()];
    const baskan = await baskanBul(b.db, c.baskan_rol, kisiler, o.kullanici);
    const cakisma = await cakisanlar(kisiler, bas, dk);
    const otomatik = await gundemUret(b.db, c.kod);
    const gundem = [g.gundem?.trim(), otomatik].filter(Boolean).join('\n') || null;
    const oncelik = g.kritik ? 'Kritik' : 'Normal';
    const d = await b.db.connect();
    try {
      await d.query('BEGIN');
      const id = (await d.query(`INSERT INTO toplanti (tpl_kod, konu, gundem, baslangic, sure_dk, oncelik, duzenleyen_ref, baskan_ref, gorusme_baglantisi, dosya_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`, [c.kod, g.konu.trim(), gundem, bas, dk, oncelik, o.kullanici, baskan, g.baglanti?.trim() || null, g.dosya ?? null])).rows[0].kimlik as string;
      for (const [k, t] of liste) await d.query(`INSERT INTO toplanti_katilimci (toplanti_ref, kullanici_ref, katilim) VALUES ($1,$2,$3)`, [id, k, t]);
      // YG-582: davette kişinin katılım durumu (Zorunlu, İsteğe Bağlı, Yalnız Bilgi) yazılır.
      for (const kt of new Set([...liste].filter(([k]) => k !== o.kullanici).map(([, t]) => t))) await bildir(d, { olay: `tpl-davet:${id}`, kullanicilar: [...liste].filter(([k, t]) => k !== o.kullanici && t === kt).map(([k]) => k), baslik: `Toplantı Daveti: ${g.konu.trim()}`, ozet: `${c.kod} ${c.ad} · ${saatYaz(bas)} · Katılımınız: ${kt}`, oncelik, acil: true, eposta: true, sms: Boolean(g.kritik) });
      await izYaz(d, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplantı Planlandı', nesneTuru: 'toplanti', nesneKimligi: id, yeni: { kod: c.kod }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await d.query('COMMIT');
      return { kimlik: id, cakisanlar: cakisma };
    } catch (x) { await d.query('ROLLBACK').catch(() => {}); throw x; } finally { d.release(); }
  });

  s.get('/toplanti/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await katilimciMi(id, o.kullanici))) return yok(y);
    const t = (await b.db.query(`SELECT t.*, c.ad AS tur, c.siklik, b.ad_soyad AS baskan, d.ad_soyad AS duzenleyen FROM toplanti t JOIN toplanti_katalogu c ON c.kod = t.tpl_kod JOIN kullanici_hesabi b ON b.kimlik = t.baskan_ref JOIN kullanici_hesabi d ON d.kimlik = t.duzenleyen_ref WHERE t.kimlik = $1`, [id])).rows[0];
    const k = await b.db.query(`SELECT h.kimlik, h.ad_soyad, p.katilim, p.vekil_durumu, v.ad_soyad AS vekil FROM toplanti_katilimci p JOIN kullanici_hesabi h ON h.kimlik = p.kullanici_ref LEFT JOIN kullanici_hesabi v ON v.kimlik = p.vekil_ref WHERE p.toplanti_ref = $1 ORDER BY h.ad_soyad`, [id]);
    const r = await b.db.query(`SELECT a.kimlik, a.metin, a.hedef_tarih::text AS hedef, a.karar_turu, a.basari_olcutu, a.izleme_donemi, h.ad_soyad AS sorumlu FROM toplanti_karar a JOIN kullanici_hesabi h ON h.kimlik = a.sorumlu_ref WHERE a.toplanti_ref = $1 ORDER BY a.zaman`, [id]);
    const ilk = (await kullaniciRolleri(b.db, o.kullanici))[0]; // YG-1591: vekil talebinin gideceği makam
    const vekilMakami = ilk ? ((await b.db.query(`SELECT rol_adi FROM rol WHERE kimlik = $1`, [await onayMakami(b.db, ilk.kimlik)])).rows[0]?.rol_adi ?? null) : null;
    return { ...t, katilimcilar: k.rows, kararlar: r.rows, baskanim: t.baskan_ref === o.kullanici, duzenleyenim: t.duzenleyen_ref === o.kullanici, vekilMakami };
  });

  // YG-576, YG-584: karar sorumlu ve tarihle işlenir, sorumlunun Bugün listesine görev düşer.
  s.post('/toplanti/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const { metin, sorumlu, hedef, dosya, tur, olcut, izleme } = (i.body ?? {}) as { metin?: string; sorumlu?: string; hedef?: string; dosya?: string; tur?: string; olcut?: string; izleme?: string };
    if (tur && !KARAR_TURU.includes(tur)) return y.code(400).send({ hata: 'Karar türünü listeden seçiniz.' }); // YG-775
    if (izleme && !IZLEME.includes(izleme)) return y.code(400).send({ hata: 'İzleme dönemini listeden seçiniz.' });
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT konu, durum, baskan_ref, duzenleyen_ref, tpl_kod, dosya_ref FROM toplanti WHERE kimlik = $1`, [id])).rows[0];
    if (!t || (t.baskan_ref !== o.kullanici && t.duzenleyen_ref !== o.kullanici)) return yok(y);
    if (t.durum !== 'Planlandı') return y.code(409).send({ hata: 'Kararlar açık toplantılara eklenir.' });
    if (!metin?.trim() || !sorumlu || !hedef || !/^\d{4}-\d{2}-\d{2}$/.test(hedef)) return y.code(400).send({ hata: 'Karar, sorumlu ve hedef tarih zorunludur.' });
    if (dosya && (!UUID.test(dosya) || !(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1`, [dosya])).rowCount)) return y.code(400).send({ hata: 'Bağlanacak dosya bulunamadı.' });
    const kDosya = (dosya ?? t.dosya_ref ?? null) as string | null; // YG-1408: karar toplantının dosyasına (ya da seçilen dosyaya) bağlanır
    const v = await b.db.query(`SELECT 1 FROM toplanti_katilimci WHERE toplanti_ref = $1 AND kullanici_ref = $2`, [id, sorumlu]);
    if (!v.rowCount) return y.code(400).send({ hata: 'Sorumlu toplantı katılımcısı olmalıdır.' });
    const d = await b.db.connect();
    try {
      await d.query('BEGIN');
      const a = (await d.query(`INSERT INTO toplanti_karar (toplanti_ref, metin, sorumlu_ref, hedef_tarih, yazan_ref, dosya_ref, karar_turu, basari_olcutu, izleme_donemi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [id, metin.trim(), sorumlu, hedef, o.kullanici, kDosya, tur ?? 'Diğer', olcut?.trim() || null, izleme ?? null])).rows[0].kimlik;
      const dn = kDosya ? (await d.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [kDosya])).rows[0].dosya_no as string : null;
      const kart = await kartAc(d, { tur: 'Toplantı Kararı', kategori: 'gorev', baslik: `${dn ? `${dn} · ` : ''}Toplantı Kararı · ${t.konu}`, ozet: metin.trim(), hazirlayan: o.kullanici, sahipKullanici: sorumlu, sonZaman: new Date(`${hedef}T20:59:59Z`), nesneTuru: 'toplanti', nesneKimligi: id });
      await d.query(`UPDATE toplanti_karar SET is_karti_ref = $2 WHERE kimlik = $1`, [a, kart]);
      await izYaz(d, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplantı Kararı Yazıldı', nesneTuru: 'toplanti', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await d.query('COMMIT');
      return { kimlik: a, kart };
    } catch (x) { await d.query('ROLLBACK').catch(() => {}); throw x; } finally { d.release(); }
  });

  // YG-1408: dosyaya bağlı toplantı kararları dosya ekranında görünür.
  s.get('/dosya/:id/toplanti-kararlari', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !(await (await import('./dosya.js')).dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT a.metin, a.hedef_tarih::text AS hedef, h.ad_soyad AS sorumlu, t.tpl_kod, t.konu, t.baslangic, k.durum AS gorev_durumu FROM toplanti_karar a JOIN toplanti t ON t.kimlik = a.toplanti_ref JOIN kullanici_hesabi h ON h.kimlik = a.sorumlu_ref LEFT JOIN is_karti k ON k.kimlik = a.is_karti_ref WHERE a.dosya_ref = $1 ORDER BY a.zaman`, [id])).rows;
  });

  // Ek II §1.8: tutanağı düzenleyen tutar; YG-584: toplantıyı yöneten onaylayınca kapanır.
  s.post('/toplanti/:id/tutanak', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { tutanak } = (i.body ?? {}) as { tutanak?: string };
    if (!UUID.test(id)) return yok(y);
    if (!tutanak?.trim()) return y.code(400).send({ hata: 'Tutanağı yazmanızı rica ederiz.' });
    const r = await b.db.query(`UPDATE toplanti SET tutanak = $3 WHERE kimlik = $1 AND durum = 'Planlandı' AND (duzenleyen_ref = $2 OR baskan_ref = $2)`, [id, o.kullanici, tutanak.trim()]);
    return r.rowCount ? { tamam: true } : yok(y);
  });
  s.post('/toplanti/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT baskan_ref, durum, tutanak, baslangic FROM toplanti WHERE kimlik = $1`, [id])).rows[0];
    if (!t || t.baskan_ref !== o.kullanici) return y.code(403).send({ hata: 'Tutanağı toplantının başkanı onaylar.' });
    if (t.durum !== 'Planlandı') return y.code(409).send({ hata: 'Toplantı zaten kapalıdır.' });
    if (!t.tutanak) return y.code(400).send({ hata: 'Önce tutanak yazılmalıdır.' });
    if (new Date(t.baslangic).getTime() > Date.now()) return y.code(400).send({ hata: 'Kapanış toplantı başladıktan sonra yapılır.' });
    await b.db.query(`UPDATE toplanti SET durum = 'Tamamlandı', kapanis_zamani = now() WHERE kimlik = $1`, [id]);
    await kapsamToplantisiGorevi(b.db, id); // YG-1599
    await b.db.query(`UPDATE toplanti_katilimci SET vekil_durumu = 'Mazeretli' WHERE toplanti_ref = $1 AND vekil_durumu = 'Onay Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplantı Kapandı', nesneTuru: 'toplanti', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/toplanti/:id/iptal', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`UPDATE toplanti SET durum = 'İptal' WHERE kimlik = $1 AND durum = 'Planlandı' AND duzenleyen_ref = $2 RETURNING konu, baslangic`, [id, o.kullanici])).rows[0];
    if (!t) return yok(y);
    const k = (await b.db.query(`SELECT kullanici_ref FROM toplanti_katilimci WHERE toplanti_ref = $1 AND kullanici_ref <> $2`, [id, o.kullanici])).rows.map((x) => x.kullanici_ref as string);
    await bildir(b.db, { olay: `tpl-iptal:${id}`, kullanicilar: k, baslik: `Toplantı İptal Edildi: ${t.konu}`, ozet: saatYaz(t.baslangic), acil: true, eposta: true });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplantı İptal Edildi', nesneTuru: 'toplanti', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // Ek II §1.8: vekil talebi katılımcının üst makamına gider; en geç toplantıdan 1 saat önce onaylanmalıdır.
  // YG-1357: periyodik iş (gözden geçirme, yenileme vb.) tanımlarını Direktör, Genel Müdür Yardımcısı veya CEO girer; sahibi rol, periyodu ay olarak tutulur.
  const tanimlayan = async (k: string) => (await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.kademe IN ('Direktör', 'Genel Müdür Yardımcısı', 'CEO')`, [k])).rowCount;
  s.get('/periyodik-isler', oturumlu, async (i, y) => {
    const o = i.oturum!; const e = lgmDegil(o.grup, y); if (e) return e;
    const isler = (await b.db.query(`SELECT p.kimlik, p.ad, r.rol_adi sahip_rol, p.periyot_ay, p.periyot_turu, p.sonraki_tarih::text sonraki_tarih, p.aktif, EXISTS (SELECT 1 FROM rol_atamasi a WHERE a.rol_ref = p.sahip_rol_ref AND a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif') sahibim, (SELECT karar FROM periyodik_sonuc s WHERE s.periyodik_ref = p.kimlik ORDER BY s.zaman DESC LIMIT 1) son_karar FROM periyodik_is p JOIN rol r ON r.kimlik = p.sahip_rol_ref ORDER BY p.aktif DESC, p.sonraki_tarih`, [o.kullanici])).rows;
    const tanimlar = Boolean(await tanimlayan(o.kullanici));
    return { isler, tanimlar, periyotTurleri: PERIYOT_TURLERI, kontroller: KONTROL, roller: tanimlar ? (await b.db.query(`SELECT rol_adi FROM rol WHERE rol_durumu = 'Aktif' AND kullanici_gruplari LIKE '%LGM%' ORDER BY rol_adi`)).rows.map((r) => r.rol_adi) : [] };
  });
  s.post('/periyodik-is', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ad?: string; sahipRol?: string; periyotTuru?: string; periyotAy?: number; sonrakiTarih?: string };
    if (!(await tanimlayan(o.kullanici))) return y.code(403).send({ hata: 'Periyodik iş tanımını Direktör, Genel Müdür Yardımcısı veya CEO girer.' });
    const rol = (await b.db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1 AND rol_durumu = 'Aktif'`, [g.sahipRol ?? ''])).rows[0];
    // YG-969: periyot türü; "Aylık" n ayda birdir (periyot ay), diğer ay bazlı türler sabittir, olaya bağlı işin tarihi yoktur.
    const tur = g.periyotTuru ?? 'Aylık'; const ay = PERIYOT_AY[tur] ?? (tur === 'Aylık' ? Number(g.periyotAy ?? 1) : 1); const olay = tur === 'Olaya Bağlı';
    if (!g.ad?.trim() || !rol || !PERIYOT_TURLERI.includes(tur) || !(Number.isInteger(ay) && ay > 0) || (!olay && !/^\d{4}-\d{2}-\d{2}$/.test(g.sonrakiTarih ?? ''))) return y.code(400).send({ hata: 'İş adı, sahibi rol, periyot ve (olaya bağlı değilse) ilk tarih zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM periyodik_is WHERE lower(ad) = lower($1)`, [g.ad.trim()])).rowCount) return y.code(409).send({ hata: 'Bu adla periyodik iş tanımlıdır.' });
    const r = (await b.db.query(`INSERT INTO periyodik_is (ad, sahip_rol_ref, periyot_ay, periyot_turu, sonraki_tarih) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.ad.trim(), rol.kimlik, ay, tur, olay ? null : g.sonrakiTarih])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Periyodik İş Tanımı', nesneTuru: 'Periyodik İş', nesneKimligi: r.kimlik, yeni: g, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });
  // YG-534, YG-804: derlenmiş gözden geçirme paketi; yoksa o an derlenir.
  s.get('/periyodik-is/:id/paket', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const p = UUID.test(id) ? (await b.db.query(`SELECT kimlik, ad, sahip_rol_ref, sonraki_tarih::text tarih FROM periyodik_is WHERE kimlik = $1`, [id])).rows[0] : undefined;
    if (!p) return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    if (!(await rolSahipleri(b.db, p.sahip_rol_ref)).includes(o.kullanici) && !(await tanimlayan(o.kullanici))) return y.code(403).send({ hata: 'Paketi işin sahibi rol veya Direktör kademesi görür.' });
    const v = p.tarih ? (await b.db.query(`SELECT tur, icerik, zaman FROM gozden_gecirme_paketi WHERE periyodik_ref = $1 AND donem_tarihi = $2`, [id, p.tarih])).rows[0] : undefined;
    if (v) return { donem: p.tarih, tur: v.tur, zaman: v.zaman, ...v.icerik };
    const icerik = await gozdenGecirmePaketi(b.db, p, p.tarih ?? new Date().toISOString().slice(0, 10));
    return { donem: p.tarih, tur: /firma|çözüm ortağı/i.test(p.ad) ? 'Firma' : 'Genel', ...icerik };
  });
  // YG-1363: gözden geçirme kontrol listesiyle yürür ve sabit kararla kapanır; sonuç sahibi rol veya tanımlama yetkilisi tarafından girilir.
  const KONTROL = ['Önceki dönem kararları uygulandı', 'Göstergeler hedefle karşılaştırıldı', 'Riskler ve uygunsuzluklar gözden geçirildi', 'Kaynak ve sorumluluklar yeterli'];
  // TZ-5: türe özgü sorular; işin kontrol listesi ortak maddeler + onaylı sorular. Soruları Kalite Müdürü onaylar ve düzenler.
  const KM = 'Kalite Müdürü';
  s.get('/periyodik-is/:id/kontrol-listesi', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    const p = UUID.test(id) ? (await b.db.query(`SELECT ad FROM periyodik_is WHERE kimlik = $1`, [id])).rows[0] : undefined; if (!p) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    return [...KONTROL, ...(await b.db.query(`SELECT soru FROM gozden_gecirme_sorusu WHERE periyodik_ad = $1 AND onayli AND aktif ORDER BY sira`, [p.ad])).rows.map((r) => r.soru as string)];
  });
  s.get('/gozden-gecirme-sorulari', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    const km = (await rolSahipleri(b.db, await rolId(b.db, KM))).includes(i.oturum!.kullanici);
    if (!km) return { yetkili: false, sorular: [] };
    return { yetkili: true, sorular: (await b.db.query(`SELECT kimlik, periyodik_ad, soru, sira, onayli, aktif FROM gozden_gecirme_sorusu ORDER BY periyodik_ad, sira`)).rows };
  });
  s.post('/gozden-gecirme-sorulari', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { onayla?: string[]; duzenle?: { kimlik: string; soru?: string; aktif?: boolean }[]; ekle?: { periyodikAd: string; soru: string } };
    if (!(await rolSahipleri(b.db, await rolId(b.db, KM))).includes(o.kullanici)) return y.code(403).send({ hata: 'Gözden geçirme sorularını Kalite Müdürü onaylar ve düzenler.' });
    for (const d of g.duzenle ?? []) if (UUID.test(d.kimlik)) await b.db.query(`UPDATE gozden_gecirme_sorusu SET soru = coalesce($2, soru), aktif = coalesce($3, aktif), onayli = true, onaylayan_ref = $4, onay_zamani = now() WHERE kimlik = $1`, [d.kimlik, d.soru?.trim() || null, d.aktif ?? null, o.kullanici]);
    if (g.ekle?.periyodikAd && g.ekle.soru?.trim()) await b.db.query(`INSERT INTO gozden_gecirme_sorusu (periyodik_ad, soru, sira, onayli, onaylayan_ref, onay_zamani) SELECT $1, $2, coalesce(max(sira), 0) + 1, true, $3, now() FROM gozden_gecirme_sorusu WHERE periyodik_ad = $1 ON CONFLICT DO NOTHING`, [g.ekle.periyodikAd, g.ekle.soru.trim(), o.kullanici]);
    const on = (g.onayla ?? []).filter((x) => UUID.test(x));
    if (on.length) await b.db.query(`UPDATE gozden_gecirme_sorusu SET onayli = true, onaylayan_ref = $2, onay_zamani = now() WHERE kimlik = ANY($1::uuid[])`, [on, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Gözden Geçirme Soruları', nesneTuru: 'Gözden Geçirme Sorusu', yeni: { onaylanan: on.length, duzenlenen: (g.duzenle ?? []).length, eklenen: g.ekle ? 1 : 0 }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/periyodik-is/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; kontroller?: Record<string, string>; aciklama?: string; kosul?: string; yeniPeriyotAy?: number };
    const p = UUID.test(id) ? (await b.db.query(`SELECT * FROM periyodik_is WHERE kimlik = $1 AND aktif`, [id])).rows[0] : undefined;
    if (!p) return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    if (!(await rolSahipleri(b.db, p.sahip_rol_ref)).includes(o.kullanici) && !(await tanimlayan(o.kullanici))) return y.code(403).send({ hata: 'Sonucu işin sahibi rol veya Direktör kademesi girer.' });
    if (!['Sürdür', 'Koşullu Sürdür', 'Değiştir', 'Askıya Al'].includes(g.karar ?? '') || !g.aciklama?.trim()) return y.code(400).send({ hata: 'Karar ve açıklama zorunludur.' });
    const ozel = (await b.db.query(`SELECT soru FROM gozden_gecirme_sorusu WHERE periyodik_ad = $1 AND onayli AND aktif ORDER BY sira`, [p.ad])).rows.map((r) => r.soru as string); // TZ-5: türe özgü onaylı sorular
    if ([...KONTROL, ...ozel].some((m) => !['Evet', 'Hayır', 'Uygulanamaz'].includes(g.kontroller?.[m] ?? ''))) return y.code(400).send({ hata: 'Kontrol listesindeki her maddeyi yanıtlayınız.' });
    if (g.karar === 'Koşullu Sürdür' && !g.kosul?.trim()) return y.code(400).send({ hata: 'Koşulu yazınız.' });
    if (g.karar === 'Değiştir' && !(Number.isInteger(Number(g.yeniPeriyotAy)) && Number(g.yeniPeriyotAy) > 0)) return y.code(400).send({ hata: 'Değişiklikte yeni periyodu (ay) giriniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO periyodik_sonuc (periyodik_ref, donem_tarihi, karar, kontroller, aciklama, kosul, yeni_periyot_ay, karar_veren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, p.sonraki_tarih, g.karar, JSON.stringify(g.kontroller), g.aciklama.trim(), g.kosul?.trim() || null, g.karar === 'Değiştir' ? Number(g.yeniPeriyotAy) : null, o.kullanici]);
      if (g.karar === 'Askıya Al') await c.query(`UPDATE periyodik_is SET aktif = false WHERE kimlik = $1`, [id]);
      else await c.query(`UPDATE periyodik_is SET periyot_ay = coalesce($2, periyot_ay), sonraki_tarih = periyodik_sonraki(sonraki_tarih, periyot_turu, coalesce($2, periyot_ay)) WHERE kimlik = $1`, [id, g.karar === 'Değiştir' ? Number(g.yeniPeriyotAy) : null]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Periyodik Gözden Geçirme' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Periyodik Gözden Geçirme Sonucu', nesneTuru: 'Periyodik İş', nesneKimligi: id, yeni: { karar: g.karar, kosul: g.kosul }, gerekce: g.aciklama.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    return { tamam: true };
  });
  // YG-969: olaya bağlı periyodik iş, olay gerçekleşince sahibi rol veya tanımlama yetkilisi tarafından kaydedilir ve görev açılır.
  s.post('/periyodik-is/:id/olay', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { olay } = (i.body ?? {}) as { olay?: string };
    const p = UUID.test(id) ? (await b.db.query(`SELECT * FROM periyodik_is WHERE kimlik = $1 AND aktif AND periyot_turu = 'Olaya Bağlı'`, [id])).rows[0] : undefined;
    if (!p) return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    if (!(await rolSahipleri(b.db, p.sahip_rol_ref)).includes(o.kullanici) && !(await tanimlayan(o.kullanici))) return y.code(403).send({ hata: 'Olayı işin sahibi rol veya Direktör kademesi kaydeder.' });
    if (!olay?.trim()) return y.code(400).send({ hata: 'Olayı yazınız.' });
    const k = await kartAc(b.db, { tur: 'Periyodik İş', kategori: 'gorev', baslik: `Olaya Bağlı · ${p.ad}`, ozet: olay.trim().slice(0, 300), sahipRol: p.sahip_rol_ref, nesneTuru: 'periyodik_is', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Olaya Bağlı Periyodik İş Açıldı', nesneTuru: 'Periyodik İş', nesneKimligi: id, gerekce: olay.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kart: k };
  });
  s.post('/periyodik-is/:id/durum', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { aktif?: boolean; gerekce?: string };
    if (!(await tanimlayan(o.kullanici))) return y.code(403).send({ hata: 'Periyodik iş tanımını Direktör, Genel Müdür Yardımcısı veya CEO değiştirir.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    const r = await b.db.query(`UPDATE periyodik_is SET aktif = $2 WHERE kimlik::text = $1 RETURNING ad`, [id, Boolean(g.aktif)]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Kayıt bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Periyodik İş Durumu', nesneTuru: 'Periyodik İş', nesneKimligi: id, yeni: { aktif: Boolean(g.aktif) }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  s.post('/toplanti/:id/vekil', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { vekil } = (i.body ?? {}) as { vekil?: string };
    if (!UUID.test(id)) return yok(y);
    const p = (await b.db.query(`SELECT p.kimlik, p.vekil_durumu, t.konu, t.baslangic, t.durum, t.baskan_ref FROM toplanti_katilimci p JOIN toplanti t ON t.kimlik = p.toplanti_ref WHERE p.toplanti_ref = $1 AND p.kullanici_ref = $2`, [id, o.kullanici])).rows[0];
    if (!p) return yok(y);
    if (p.durum !== 'Planlandı' || p.baskan_ref === o.kullanici) return y.code(409).send({ hata: 'Bu toplantıda vekil ataması kullanılmıyor.' });
    if (new Date(p.baslangic).getTime() - Date.now() < VEKIL_SON_DK * 60_000) return y.code(400).send({ hata: 'Vekil onayı en geç toplantıdan 1 saat önce alınmalıdır.' });
    if (p.vekil_durumu) return y.code(409).send({ hata: 'Vekil talebi zaten açılmıştır.' });
    const v = await b.db.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1 AND kimlik <> $2 AND kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif'`, [vekil, o.kullanici]);
    if (!v.rowCount) return y.code(400).send({ hata: 'Vekil geçersizdir.' });
    const rol = (await kullaniciRolleri(b.db, o.kullanici))[0];
    if (!rol) return y.code(403).send({ hata: 'Aktif rolünüz bulunmamaktadır.' });
    const d = await b.db.connect();
    try {
      await d.query('BEGIN');
      await d.query(`UPDATE toplanti_katilimci SET vekil_ref = $2, vekil_durumu = 'Onay Bekliyor' WHERE kimlik = $1`, [p.kimlik, vekil]);
      const kart = await kartAc(d, { tur: 'Toplantı Vekili', baslik: `Toplantı Vekili · ${p.konu}`, ozet: `Vekil: ${v.rows[0].ad_soyad} · ${saatYaz(p.baslangic)}`, hazirlayan: o.kullanici, zincir: [await onayMakami(d, rol.kimlik)], sonZaman: new Date(new Date(p.baslangic).getTime() - VEKIL_SON_DK * 60_000), nesneTuru: 'toplanti_katilimci', nesneKimligi: p.kimlik });
      await d.query('COMMIT');
      return { kart };
    } catch (x) { await d.query('ROLLBACK').catch(() => {}); throw x; } finally { d.release(); }
  });
}

/** Rolün üstündeki ilk Direktör makamı. */
async function direktorBul(db: Db, rol: string): Promise<string | null> {
  let r = rol;
  for (let i = 0; i < 4; i++) {
    const k = (await db.query(`SELECT kademe FROM rol WHERE kimlik = $1`, [r])).rows[0]?.kademe;
    if (k === 'Direktör') return r;
    if (k === 'CEO' || k === 'Genel Müdür Yardımcısı' || !k) return null;
    r = await onayMakami(db, r);
  }
  return null;
}

/** YG-534: Tamamlanınca sonraki tarih kendiliğinden kurulur. */
kapanisKaydet('Periyodik Gözden Geçirme', async (c, k, karar) => {
  if (karar === 'Tamamlandı') await c.query(`UPDATE periyodik_is SET sonraki_tarih = periyodik_sonraki(sonraki_tarih, periyot_turu, periyot_ay) WHERE kimlik = $1`, [k.nesne_kimligi]);
});
/** YG-969: günlük, haftalık ve olaya bağlı periyodik iş görevi Tamamlandı ile kapanır; tarihli işte sonraki tarih kendiliğinden kurulur. */
kapanisKaydet('Periyodik İş', async (c, k, karar) => {
  if (karar === 'Tamamlandı') await c.query(`UPDATE periyodik_is SET sonraki_tarih = periyodik_sonraki(sonraki_tarih, periyot_turu, periyot_ay) WHERE kimlik = $1 AND periyot_turu <> 'Olaya Bağlı'`, [k.nesne_kimligi]);
});
export const PERIYOT_TURLERI = ['Günlük', 'Haftalık', 'Aylık', '3 Aylık', '6 Aylık', 'Yıllık', 'Sezonluk', 'Olaya Bağlı'];
const PERIYOT_AY: Record<string, number> = { '3 Aylık': 3, '6 Aylık': 6, Yıllık: 12, Sezonluk: 12 };

/**
 * YG-534: 30 gün önce sahibine bilgi, 14 gün önce hazırlık görevi, 7 gün ve 24 saat önce hatırlatma; tarih geçerse 72 saat sonra Direktöre, 10 gün sonra GMY'ye.
 * Sistem günde bir çalıştırır; aynı eşik aynı tarih için iki kez işlemez (YG-523).
 */
/** YG-534, YG-804: gözden geçirme paketi; firma işlerinde karne, belge süresi, uygunsuzluk, şikâyet ve iş hacmi, diğerlerinde açık uygunsuzluk ve şikâyet; önceki kararla birlikte. */
export async function gozdenGecirmePaketi(db: Pool | PoolClient, p: { kimlik: string; ad: string }, donem: string) {
  const firma = /firma|çözüm ortağı/i.test(p.ad);
  const onceki = (await db.query(`SELECT donem_tarihi::text donem, karar, aciklama, kosul FROM periyodik_sonuc WHERE periyodik_ref = $1 ORDER BY zaman DESC LIMIT 1`, [p.kimlik])).rows[0] ?? null;
  const u = (await db.query(`SELECT sinif, count(*)::int n FROM uygunsuzluk WHERE statu NOT IN ('Kapalı', 'Geçersiz') AND ($1::boolean IS FALSE OR sorumlu_firma_ref IS NOT NULL) GROUP BY sinif ORDER BY sinif`, [firma])).rows;
  const sk = (await db.query(`SELECT count(*) FILTER (WHERE statu <> 'Kapalı')::int acik, count(*) FILTER (WHERE olusturma_zamani > now() - interval '12 months')::int yil FROM garanti_sikayet WHERE 'Şikâyet' = ANY(kayit_turu)`)).rows[0];
  const icerik: Record<string, unknown> = { onceki, acikUygunsuzluk: u, sikayet: sk };
  if (firma) {
    icerik.karne = (await db.query(`SELECT coalesce(p.risk_derecesi_onerisi, 'Yetersiz Veri') oneri, count(*)::int n FROM (SELECT DISTINCT ON (kurulus_ref) kurulus_ref, risk_derecesi_onerisi FROM performans_donem_puani ORDER BY kurulus_ref, donem_sonu DESC) p GROUP BY 1 ORDER BY 1`)).rows;
    icerik.belgeSuresi = (await db.query(`SELECT count(*) FILTER (WHERE gecerlilik_bitis < $1::date)::int dolmus, count(*) FILTER (WHERE gecerlilik_bitis >= $1::date AND gecerlilik_bitis < $1::date + 60)::int yaklasan FROM sicil_belgesi`, [donem])).rows[0];
    icerik.isHacmi = (await db.query(`SELECT count(*)::int is_emri, count(DISTINCT kurulus_ref)::int firma FROM is_emri WHERE olusturma_zamani > now() - interval '12 months'`)).rows[0];
  }
  await db.query(`INSERT INTO gozden_gecirme_paketi (periyodik_ref, donem_tarihi, tur, icerik) VALUES ($1,$2,$3,$4) ON CONFLICT (periyodik_ref, donem_tarihi) DO UPDATE SET icerik = EXCLUDED.icerik, zaman = now()`, [p.kimlik, donem, firma ? 'Firma' : 'Genel', JSON.stringify(icerik)]);
  return icerik;
}

export async function periyodikIsle(db: Pool, simdi = new Date()): Promise<number> {
  const bugun = new Date(simdi.getTime() + 180 * 60_000).toISOString().slice(0, 10);
  const { rows } = await db.query(`SELECT p.kimlik, p.ad, p.sahip_rol_ref, p.periyot_turu, p.sonraki_tarih::text AS tarih, (p.sonraki_tarih - $1::date) AS kalan FROM periyodik_is p WHERE p.aktif AND p.sonraki_tarih IS NOT NULL AND p.sonraki_tarih - $1::date <= 30`, [bugun]);
  let n = 0;
  for (const p of rows) {
    // YG-969: günlük ve haftalık iş hatırlatma beklemeden günü gelince görev olarak açılır; görev açıkken yenisi açılmaz.
    if (p.periyot_turu === 'Günlük' || p.periyot_turu === 'Haftalık') {
      if (p.kalan <= 0 && !(await db.query(`SELECT 1 FROM is_karti WHERE tur = 'Periyodik İş' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [p.kimlik])).rowCount && await birKez(db, 'periyodik', `${p.kimlik}:${p.tarih}:gorev`)) {
        await kartAc(db, { tur: 'Periyodik İş', kategori: 'gorev', baslik: `${p.periyot_turu} · ${p.ad}`, ozet: `Tarih: ${p.tarih.split('-').reverse().join('.')}`, sahipRol: p.sahip_rol_ref, sonZaman: new Date(`${p.tarih}T20:59:59Z`), nesneTuru: 'periyodik_is', nesneKimligi: p.kimlik }); n++;
      }
      continue;
    }
    const anahtar = (e: string) => `${p.kimlik}:${p.tarih}:${e}`;
    const sahip = await rolSahipleri(db, p.sahip_rol_ref);
    const tarihYaz = p.tarih.split('-').reverse().join('.');
    const hatir = async (e: string, kisiler: string[], baslik: string) => {
      if (!(await birKez(db, 'periyodik', anahtar(e)))) return;
      await bildir(db, { olay: `periyodik:${anahtar(e)}`, kullanicilar: kisiler, baslik: `${baslik}: ${p.ad}`, ozet: `Tarih: ${tarihYaz}`, eposta: true }, simdi);
      n++;
    };
    if (p.kalan <= 30) await hatir('30g', sahip, 'Yaklaşan Gözden Geçirme');
    if (p.kalan <= 14 && await birKez(db, 'periyodik', anahtar('14g'))) {
      await gozdenGecirmePaketi(db, p, p.tarih); // YG-534, YG-804
      await kartAc(db, { tur: 'Periyodik Gözden Geçirme', kategori: 'gorev', baslik: `Gözden Geçirme Hazırlığı · ${p.ad}`, ozet: `Tarih: ${tarihYaz} · Gözden geçirme paketi derlendi.`, sahipRol: p.sahip_rol_ref, sonZaman: new Date(`${p.tarih}T20:59:59Z`), nesneTuru: 'periyodik_is', nesneKimligi: p.kimlik });
      n++;
    }
    if (p.kalan <= 7) await hatir('7g', sahip, 'Gözden Geçirme Hatırlatması');
    if (p.kalan <= 1) await hatir('1g', sahip, 'Gözden Geçirme Hatırlatması');
    if (p.kalan <= -3) {
      const d = await direktorBul(db, p.sahip_rol_ref);
      if (d) await hatir('72s', await rolSahipleri(db, d), 'Geciken Gözden Geçirme');
    }
    if (p.kalan <= -10) {
      const gmy = (await db.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Genel Müdür Yardımcısı'`)).rows[0].kimlik;
      await hatir('10g', await rolSahipleri(db, gmy), 'Geciken Gözden Geçirme');
    }
  }
  return n;
}
