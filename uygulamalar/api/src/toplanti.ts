import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
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
async function gundemUret(db: Db, kod: string): Promise<string | null> {
  if (kod !== 'TPL-02' && kod !== 'TPL-03') return null;
  const { rows } = await db.query(`SELECT count(*)::int n FROM is_karti WHERE durum = 'Bekliyor' AND kategori = 'onay' AND son_zaman < now()`);
  return `Süresi Aşan Onay: ${rows[0].n}`;
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
    return { turler: (await planlanabilir(o.kullanici)).map((c) => ({ kod: c.kod, ad: c.ad, katilimcilar: c.katilimcilar })), kisiler: kisiler.rows };
  });

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
    const g = (i.body ?? {}) as { kod?: string; konu?: string; gundem?: string; baslangic?: string; sureDk?: number; katilimcilar?: { kullanici: string; katilim?: string }[]; kritik?: boolean; baglanti?: string };
    const c = (await planlanabilir(o.kullanici)).find((x) => x.kod === g.kod);
    if (!c) return y.code(403).send({ hata: 'Bu toplantıyı planlama yetkiniz bulunmamaktadır.' });
    if (!g.konu?.trim()) return y.code(400).send({ hata: 'Konu zorunludur.' });
    const bas = new Date(g.baslangic ?? '');
    if (isNaN(bas.getTime()) || bas.getTime() < Date.now() - 60_000) return y.code(400).send({ hata: 'Toplantı zamanı geçmişte olamaz.' });
    const dk = g.sureDk ?? 60;
    if (!Number.isInteger(dk) || dk < 5 || dk > 600) return y.code(400).send({ hata: 'Süre 5 ile 600 dakika arasında olmalıdır.' });
    if (g.kritik && c.kod !== 'TPL-10') return y.code(400).send({ hata: 'Kritik işareti yalnız Olağanüstü Toplantıda kullanılır.' });
    const secilen = g.katilimcilar ?? [];
    if (secilen.some((x) => x.katilim && !KATILIM.includes(x.katilim))) return y.code(400).send({ hata: 'Geçersiz katılım durumu.' });
    const liste = new Map<string, string>(secilen.map((x) => [x.kullanici, x.katilim ?? 'Zorunlu']));
    if (liste.size) {
      const v = await b.db.query(`SELECT count(*)::int n FROM kullanici_hesabi WHERE kimlik = ANY($1) AND kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif'`, [[...liste.keys()]]);
      if (v.rows[0].n !== liste.size) return y.code(400).send({ hata: 'Katılımcı geçersizdir.' });
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
      const id = (await d.query(`INSERT INTO toplanti (tpl_kod, konu, gundem, baslangic, sure_dk, oncelik, duzenleyen_ref, baskan_ref, gorusme_baglantisi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [c.kod, g.konu.trim(), gundem, bas, dk, oncelik, o.kullanici, baskan, g.baglanti?.trim() || null])).rows[0].kimlik as string;
      for (const [k, t] of liste) await d.query(`INSERT INTO toplanti_katilimci (toplanti_ref, kullanici_ref, katilim) VALUES ($1,$2,$3)`, [id, k, t]);
      await bildir(d, { olay: `tpl-davet:${id}`, kullanicilar: kisiler.filter((k) => k !== o.kullanici), baslik: `Toplantı Daveti: ${g.konu.trim()}`, ozet: `${c.kod} ${c.ad} · ${saatYaz(bas)}`, oncelik, acil: true, eposta: true, sms: Boolean(g.kritik) });
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
    const r = await b.db.query(`SELECT a.kimlik, a.metin, a.hedef_tarih::text AS hedef, h.ad_soyad AS sorumlu FROM toplanti_karar a JOIN kullanici_hesabi h ON h.kimlik = a.sorumlu_ref WHERE a.toplanti_ref = $1 ORDER BY a.zaman`, [id]);
    return { ...t, katilimcilar: k.rows, kararlar: r.rows, baskanim: t.baskan_ref === o.kullanici, duzenleyenim: t.duzenleyen_ref === o.kullanici };
  });

  // YG-576, YG-584: karar sorumlu ve tarihle işlenir, sorumlunun Bugün listesine görev düşer.
  s.post('/toplanti/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const { metin, sorumlu, hedef } = (i.body ?? {}) as { metin?: string; sorumlu?: string; hedef?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT konu, durum, baskan_ref, duzenleyen_ref, tpl_kod FROM toplanti WHERE kimlik = $1`, [id])).rows[0];
    if (!t || (t.baskan_ref !== o.kullanici && t.duzenleyen_ref !== o.kullanici)) return yok(y);
    if (t.durum !== 'Planlandı') return y.code(409).send({ hata: 'Kapanan toplantıya karar eklenemez.' });
    if (!metin?.trim() || !sorumlu || !hedef || !/^\d{4}-\d{2}-\d{2}$/.test(hedef)) return y.code(400).send({ hata: 'Karar, sorumlu ve hedef tarih zorunludur.' });
    const v = await b.db.query(`SELECT 1 FROM toplanti_katilimci WHERE toplanti_ref = $1 AND kullanici_ref = $2`, [id, sorumlu]);
    if (!v.rowCount) return y.code(400).send({ hata: 'Sorumlu toplantı katılımcısı olmalıdır.' });
    const d = await b.db.connect();
    try {
      await d.query('BEGIN');
      const a = (await d.query(`INSERT INTO toplanti_karar (toplanti_ref, metin, sorumlu_ref, hedef_tarih, yazan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, metin.trim(), sorumlu, hedef, o.kullanici])).rows[0].kimlik;
      const kart = await kartAc(d, { tur: 'Toplantı Kararı', kategori: 'gorev', baslik: `Toplantı Kararı · ${t.konu}`, ozet: metin.trim(), hazirlayan: o.kullanici, sahipKullanici: sorumlu, sonZaman: new Date(`${hedef}T20:59:59Z`), nesneTuru: 'toplanti', nesneKimligi: id });
      await d.query(`UPDATE toplanti_karar SET is_karti_ref = $2 WHERE kimlik = $1`, [a, kart]);
      await izYaz(d, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplantı Kararı Yazıldı', nesneTuru: 'toplanti', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await d.query('COMMIT');
      return { kimlik: a, kart };
    } catch (x) { await d.query('ROLLBACK').catch(() => {}); throw x; } finally { d.release(); }
  });

  // Ek II §1.8: tutanağı düzenleyen tutar; YG-584: toplantıyı yöneten onaylayınca kapanır.
  s.post('/toplanti/:id/tutanak', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { tutanak } = (i.body ?? {}) as { tutanak?: string };
    if (!UUID.test(id)) return yok(y);
    if (!tutanak?.trim()) return y.code(400).send({ hata: 'Tutanak boş olamaz.' });
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
    if (new Date(t.baslangic).getTime() > Date.now()) return y.code(400).send({ hata: 'Toplantı başlamadan kapatılamaz.' });
    await b.db.query(`UPDATE toplanti SET durum = 'Tamamlandı', kapanis_zamani = now() WHERE kimlik = $1`, [id]);
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
  s.post('/toplanti/:id/vekil', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { vekil } = (i.body ?? {}) as { vekil?: string };
    if (!UUID.test(id)) return yok(y);
    const p = (await b.db.query(`SELECT p.kimlik, p.vekil_durumu, t.konu, t.baslangic, t.durum, t.baskan_ref FROM toplanti_katilimci p JOIN toplanti t ON t.kimlik = p.toplanti_ref WHERE p.toplanti_ref = $1 AND p.kullanici_ref = $2`, [id, o.kullanici])).rows[0];
    if (!p) return yok(y);
    if (p.durum !== 'Planlandı' || p.baskan_ref === o.kullanici) return y.code(409).send({ hata: 'Bu toplantı için vekil atanamaz.' });
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
  if (karar === 'Tamamlandı') await c.query(`UPDATE periyodik_is SET sonraki_tarih = (sonraki_tarih + make_interval(months => periyot_ay))::date WHERE kimlik = $1`, [k.nesne_kimligi]);
});

/**
 * YG-534: 30 gün önce sahibine bilgi, 14 gün önce hazırlık görevi, 7 gün ve 24 saat önce hatırlatma; tarih geçerse 72 saat sonra Direktöre, 10 gün sonra GMY'ye.
 * Sistem günde bir çalıştırır; aynı eşik aynı tarih için iki kez işlemez (YG-523).
 */
export async function periyodikIsle(db: Pool, simdi = new Date()): Promise<number> {
  const bugun = new Date(simdi.getTime() + 180 * 60_000).toISOString().slice(0, 10);
  const { rows } = await db.query(`SELECT p.kimlik, p.ad, p.sahip_rol_ref, p.sonraki_tarih::text AS tarih, (p.sonraki_tarih - $1::date) AS kalan FROM periyodik_is p WHERE p.aktif AND p.sonraki_tarih - $1::date <= 30`, [bugun]);
  let n = 0;
  for (const p of rows) {
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
      await kartAc(db, { tur: 'Periyodik Gözden Geçirme', kategori: 'gorev', baslik: `Gözden Geçirme Hazırlığı · ${p.ad}`, ozet: `Tarih: ${tarihYaz}`, sahipRol: p.sahip_rol_ref, sonZaman: new Date(`${p.tarih}T20:59:59Z`), nesneTuru: 'periyodik_is', nesneKimligi: p.kimlik });
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
