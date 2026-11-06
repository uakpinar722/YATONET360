import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { kayitNo } from './erisim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { tatilGunleri } from './sure.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const SAAT = 3_600_000; const TZ = 3 * SAAT;
const BT = ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Bilgi İşlem Müdürü', 'Bilgi İşlem Müdür Yardımcısı', 'Sistem Yöneticisi'];
/** YG-1410: yanıt ve çözüm hedefleri (saat). D4 çözümü sürüm planına alınır, son zaman tutulmaz. */
const HEDEF: Record<string, { yanit: number; cozum: number | null; gecici?: number }> = { D1: { yanit: 0.5, cozum: null, gecici: 4 }, D2: { yanit: 2, cozum: 24 }, D3: { yanit: 24, cozum: 120 }, D4: { yanit: 48, cozum: null } };

/** YG-1411: seviye etki ölçütlerinden belirlenir; kullanıcının seçimi değil. */
export function destekSeviyesi(g: { tur: string; etkilenen: number; sistemKullanilamiyor: boolean; kritikSurec: boolean; guvenlik: boolean; veriButunlugu: boolean; musteriMali: boolean }): 'D1' | 'D2' | 'D3' | 'D4' {
  if (g.sistemKullanilamiyor || g.kritikSurec || g.guvenlik) return 'D1';
  if (g.veriButunlugu || g.musteriMali || g.etkilenen >= 10) return 'D2';
  if (g.tur === 'Öneri') return 'D4';
  return 'D3';
}

/** YG-1410: D1 dışındaki son an pazar, resmî tatil veya 22:00–08:00 arasına düşerse ilk çalışma günü 12:00'ye kayar. */
export function destekSonAn(baslangic: Date, saat: number, seviye: string, tatiller: Set<string>): Date {
  const son = new Date(baslangic.getTime() + saat * SAAT);
  if (seviye === 'D1') return son;
  const y = new Date(son.getTime() + TZ); const dk = y.getUTCHours() * 60 + y.getUTCMinutes();
  const gun = (d: Date) => d.toISOString().slice(0, 10);
  const calisma = (d: Date) => d.getUTCDay() !== 0 && !tatiller.has(gun(d));
  if (calisma(y) && dk >= 480 && dk < 1320) return son;
  const k = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()));
  if (dk >= 1320 || !calisma(y)) k.setUTCDate(k.getUTCDate() + 1);
  while (!calisma(k)) k.setUTCDate(k.getUTCDate() + 1);
  return new Date(k.getTime() + 12 * SAAT - TZ);
}

/** YG-1410: yanıt ve çözüm süresi aşılınca BT yönetimi bir kez uyarılır. */
export async function destekSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  for (const t of (await db.query(`SELECT kimlik, talep_no, seviye, yanit_son, yanit_zamani, cozum_son, gecici_cozum_son, gecici_cozum_zamani, durum FROM destek_talebi WHERE durum IN ('Açık', 'Yanıtlandı')`)).rows) {
    const asim = !t.yanit_zamani && new Date(t.yanit_son) < simdi ? 'yanit' : t.gecici_cozum_son && !t.gecici_cozum_zamani && new Date(t.gecici_cozum_son) < simdi ? 'gecici' : t.cozum_son && new Date(t.cozum_son) < simdi ? 'cozum' : null;
    if (!asim || !(await birKez(db, 'destek_sure', `${t.kimlik}:${asim}`))) continue;
    const al: string[] = []; for (const r of BT.slice(0, 2)) al.push(...await rolSahipleri(db, await rolId(db, r)));
    await bildir(db, { olay: `destek-sure:${t.kimlik}:${asim}`, kullanicilar: [...new Set(al)], baslik: `${t.talep_no} · ${t.seviye} ${asim === 'yanit' ? 'Yanıt' : asim === 'gecici' ? 'Geçici Çözüm' : 'Çözüm'} Süresi Aşıldı`, oncelik: t.seviye === 'D1' ? 'Kritik' : 'Yüksek' }, simdi);
    n++;
  }
  return n;
}

export function destekYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const btMi = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, BT])).rowCount);
  const talep = async (id: string, k: string) => {
    if (!UUID.test(id)) return undefined;
    const t = (await b.db.query(`SELECT t.*, d.dosya_sorumlusu_ref FROM destek_talebi t LEFT JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1`, [id])).rows[0];
    if (!t) return undefined;
    const yetki = t.acan_ref === k ? 'acan' : t.atanan_ref === k || t.dosya_sorumlusu_ref === k || (await btMi(k)) ? 'cozen' : null;
    return yetki ? { t, yetki } : undefined;
  };

  // YG-1409, YG-1504: her ekrandan açılır; dosyalı talep dosyanın Dosya Sorumlusuna, teknik veya dosyasız talep BT ve Firma Yönetimi Direktörlüğüne görev olur.
  s.post('/destek', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; hizmet?: string; ekran?: string; dosya?: string; nesneTuru?: string; nesneKimligi?: string; belirti?: string; etki?: string; beklenen?: string; ekranGoruntusu?: string; etkilenen?: number; sistemKullanilamiyor?: boolean; kritikSurec?: boolean; guvenlik?: boolean; veriButunlugu?: boolean; musteriMali?: boolean; ilgili?: string };
    const tur = g.tur ?? 'Hata';
    if (!['Hata', 'Öneri', 'Soru'].includes(tur) || !g.belirti?.trim()) return y.code(400).send({ hata: 'Kısa bir açıklama yazmanızı rica ederiz.' });
    for (const x of [g.dosya, g.ekranGoruntusu, g.ilgili]) if (x && !UUID.test(x)) return y.code(400).send({ hata: 'Bağlantılı kayıt geçersizdir.' });
    const dosya = g.dosya && ((o.grup === 'LGM İç Rolü' && await dosyaErisimi(b.db, o.kullanici, g.dosya)) || (await b.db.query(`SELECT 1 FROM dosya_tarafi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND aktif`, [g.dosya, o.kullanici])).rowCount) ? g.dosya : null;
    const seviye = destekSeviyesi({ tur, etkilenen: Math.max(1, Number(g.etkilenen) || 1), sistemKullanilamiyor: Boolean(g.sistemKullanilamiyor), kritikSurec: Boolean(g.kritikSurec), guvenlik: Boolean(g.guvenlik), veriButunlugu: Boolean(g.veriButunlugu), musteriMali: Boolean(g.musteriMali) });
    const simdi = new Date(); const tatil = await tatilGunleri(b.db); const h = HEDEF[seviye]!;
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const no = await kayitNo(c, 'DST');
      const ds = dosya ? (await c.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [dosya])).rows[0] : null;
      const teknik = tur === 'Hata' && (seviye === 'D1' || seviye === 'D2');
      const atanan = ds?.dosya_sorumlusu_ref && !teknik ? ds.dosya_sorumlusu_ref : null;
      const t = (await c.query(`INSERT INTO destek_talebi (talep_no, acan_ref, tur, hizmet, ekran, dosya_ref, nesne_turu, nesne_kimligi, belirti, etki, beklenen, ekran_goruntusu_ref, etkilenen_sayi, sistem_kullanilamiyor, kritik_surec, guvenlik, veri_butunlugu, musteri_mali, seviye, yanit_son, gecici_cozum_son, cozum_son, ilgili_ref, atanan_ref)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING kimlik`,
        [no, o.kullanici, tur, g.hizmet?.trim() || null, g.ekran?.trim() || null, dosya, g.nesneTuru ?? null, g.nesneKimligi ?? null, g.belirti.trim(), g.etki?.trim() || null, g.beklenen?.trim() || null, g.ekranGoruntusu ?? null, Math.max(1, Number(g.etkilenen) || 1), Boolean(g.sistemKullanilamiyor), Boolean(g.kritikSurec), Boolean(g.guvenlik), Boolean(g.veriButunlugu), Boolean(g.musteriMali), seviye,
          destekSonAn(simdi, h.yanit, seviye, tatil), h.gecici ? destekSonAn(simdi, h.gecici, seviye, tatil) : null, h.cozum ? destekSonAn(simdi, h.cozum, seviye, tatil) : null, g.ilgili ?? null, atanan])).rows[0];
      const baslik = `${no} · ${seviye} · ${tur}${ds ? ` · ${ds.dosya_no}` : ''}`;
      if (atanan) await kartAc(c, { tur: 'Destek Talebi', kategori: 'gorev', baslik, ozet: g.belirti.trim().slice(0, 200), oncelik: seviye === 'D1' ? 'Kritik' : 'Yüksek', sahipKullanici: atanan, nesneTuru: 'Destek Talebi', nesneKimligi: t.kimlik });
      else await kartAc(c, { tur: 'Destek Talebi', kategori: 'gorev', baslik, ozet: g.belirti.trim().slice(0, 200), oncelik: seviye === 'D1' ? 'Kritik' : seviye === 'D2' ? 'Yüksek' : 'Normal', sahipRol: await rolId(c, BT[0]!), nesneTuru: 'Destek Talebi', nesneKimligi: t.kimlik });
      if (seviye === 'D1') { const al: string[] = []; for (const r of BT) al.push(...await rolSahipleri(c, await rolId(c, r))); await bildir(c, { olay: `destek-d1:${t.kimlik}`, kullanicilar: [...new Set(al)], baslik: `D1 Destek Talebi: ${no}`, ozet: g.belirti.trim().slice(0, 200), oncelik: 'Kritik', sms: true, acil: true }); }
      await c.query('COMMIT');
      return { kimlik: t.kimlik, talepNo: no, seviye };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.get('/destek', oturumlu, async (i) => {
    const k = i.oturum!.kullanici; const hepsi = (i.query as { hepsi?: string }).hepsi === '1' && (await btMi(k));
    return (await b.db.query(`SELECT t.kimlik, t.talep_no, t.tur, t.seviye, t.durum, t.belirti, t.yanit_son, t.cozum_son, t.kullaniciya_sonuc, t.olusturma_zamani, d.dosya_no FROM destek_talebi t LEFT JOIN dosya d ON d.kimlik = t.dosya_ref
      WHERE ${hepsi ? `t.durum <> 'Kapalı'` : `t.acan_ref = $1 OR t.atanan_ref = $1`} ORDER BY t.olusturma_zamani DESC LIMIT 200`, hepsi ? [] : [k])).rows;
  });

  s.post('/destek/:id/mesaj', oturumlu, async (i, y) => {
    const o = i.oturum!; const a = await talep((i.params as { id: string }).id, o.kullanici); const metin = ((i.body ?? {}) as { metin?: string }).metin?.trim();
    if (!a) return yok(y);
    if (!metin) return y.code(400).send({ hata: 'Mesaj boş olamaz.' });
    if (a.t.durum === 'Kapalı') return y.code(409).send({ hata: 'Kapalı talep yeniden açılmaz; sorun sürüyorsa bu talebe bağlı yeni talep açınız.' }); // YG-1411
    await b.db.query(`INSERT INTO destek_mesaji (talep_ref, yazan_ref, metin) VALUES ($1,$2,$3)`, [a.t.kimlik, o.kullanici, metin]);
    if (a.yetki === 'cozen' && !a.t.yanit_zamani) await b.db.query(`UPDATE destek_talebi SET yanit_zamani = now(), durum = CASE WHEN durum = 'Açık' THEN 'Yanıtlandı' ELSE durum END WHERE kimlik = $1`, [a.t.kimlik]);
    const karsi = a.yetki === 'acan' ? a.t.atanan_ref : a.t.acan_ref;
    if (karsi) await bildir(b.db, { olay: `destek-mesaj:${a.t.kimlik}:${Date.now()}`, kullanicilar: [karsi], baslik: `${a.t.talep_no} · Yeni Mesaj`, ozet: metin.slice(0, 200) });
    return { tamam: true };
  });
  s.get('/destek/:id', oturumlu, async (i, y) => {
    const a = await talep((i.params as { id: string }).id, i.oturum!.kullanici); if (!a) return yok(y);
    const mesajlar = (await b.db.query(`SELECT m.metin, m.zaman, h.ad_soyad FROM destek_mesaji m JOIN kullanici_hesabi h ON h.kimlik = m.yazan_ref WHERE m.talep_ref = $1 ORDER BY m.zaman`, [a.t.kimlik])).rows;
    const ilgili = (await b.db.query(`SELECT kimlik, talep_no, durum FROM destek_talebi WHERE ilgili_ref = $1 OR kimlik = $2`, [a.t.kimlik, a.t.ilgili_ref])).rows;
    return { ...a.t, mesajlar, ilgili };
  });
  s.post('/destek/:id/gecici-cozum', oturumlu, async (i, y) => {
    const a = await talep((i.params as { id: string }).id, i.oturum!.kullanici); if (!a || a.yetki !== 'cozen') return yok(y);
    await b.db.query(`UPDATE destek_talebi SET gecici_cozum_zamani = coalesce(gecici_cozum_zamani, now()), yanit_zamani = coalesce(yanit_zamani, now()), durum = CASE WHEN durum = 'Açık' THEN 'Yanıtlandı' ELSE durum END WHERE kimlik = $1`, [a.t.kimlik]);
    return { tamam: true };
  });

  // YG-1412: çözüm kaydı dört unsurla; kullanıcı doğrulamadan kayıt kapanmaz, sessizlik memnuniyet sayılmaz.
  s.post('/destek/:id/cozum', oturumlu, async (i, y) => {
    const o = i.oturum!; const a = await talep((i.params as { id: string }).id, o.kullanici); const g = (i.body ?? {}) as { yapilan?: string; degisen?: string; dogrulama?: string; sonuc?: string };
    if (!a || a.yetki !== 'cozen') return yok(y);
    if (a.t.durum === 'Kapalı') return y.code(409).send({ hata: 'Talep kapalıdır.' });
    if (!g.yapilan?.trim() || !g.degisen?.trim() || !g.dogrulama?.trim() || !g.sonuc?.trim()) return y.code(400).send({ hata: 'Yapılan işlem, değişen kayıt veya sürüm, doğrulama yöntemi ve kullanıcıya bildirilen sonuç zorunludur.' });
    await b.db.query(`UPDATE destek_talebi SET durum = 'Çözüldü', yapilan_islem = $2, degisen_kayit = $3, dogrulama_yontemi = $4, kullaniciya_sonuc = $5, cozum_zamani = now(), cozen_ref = $6, yanit_zamani = coalesce(yanit_zamani, now()), kullanici_dogrulama = NULL WHERE kimlik = $1`, [a.t.kimlik, g.yapilan.trim(), g.degisen.trim(), g.dogrulama.trim(), g.sonuc.trim(), o.kullanici]);
    await bildir(b.db, { olay: `destek-cozum:${a.t.kimlik}:${Date.now()}`, kullanicilar: [a.t.acan_ref], baslik: `${a.t.talep_no} · Çözüm Bildirildi`, ozet: `${g.sonuc.trim().slice(0, 180)} Sonucu doğrulamanızı rica ederiz.`, eposta: true });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Destek Çözümü', nesneTuru: 'Destek Talebi', nesneKimligi: a.t.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Çözüldü' };
  });
  s.post('/destek/:id/dogrula', oturumlu, async (i, y) => {
    const o = i.oturum!; const a = await talep((i.params as { id: string }).id, o.kullanici); const sonuc = ((i.body ?? {}) as { sonuc?: string }).sonuc;
    if (!a || a.yetki !== 'acan') return yok(y);
    if (a.t.durum !== 'Çözüldü') return y.code(409).send({ hata: 'Doğrulanacak çözüm yoktur.' });
    if (!['Çözüldü', 'Sorun Sürüyor'].includes(sonuc ?? '')) return y.code(400).send({ hata: 'Sonucu seçiniz.' });
    if (sonuc === 'Çözüldü') await b.db.query(`UPDATE destek_talebi SET kullanici_dogrulama = 'Çözüldü', durum = 'Kapalı', kapanis_zamani = now(), kapanis_notu = 'Kullanıcı doğruladı' WHERE kimlik = $1`, [a.t.kimlik]);
    else await b.db.query(`UPDATE destek_talebi SET kullanici_dogrulama = 'Sorun Sürüyor', durum = 'Yanıtlandı' WHERE kimlik = $1`, [a.t.kimlik]);
    return { durum: sonuc === 'Çözüldü' ? 'Kapalı' : 'Yanıtlandı' };
  });
  // Kullanıcıya ulaşılamazsa BT yönetimi gerekçeyle kapatır; kapanış memnuniyet olarak kaydedilmez.
  s.post('/destek/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const a = await talep((i.params as { id: string }).id, o.kullanici); const not = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!a || !(await btMi(o.kullanici))) return yok(y);
    if (a.t.durum !== 'Çözüldü') return y.code(409).send({ hata: 'Önce çözüm kaydı girilir.' });
    if (!not) return y.code(400).send({ hata: 'Kullanıcı doğrulaması olmadan kapatmada gerekçe zorunludur.' });
    await b.db.query(`UPDATE destek_talebi SET durum = 'Kapalı', kapanis_zamani = now(), kapanis_notu = $2 WHERE kimlik = $1`, [a.t.kimlik, `Kullanıcı doğrulaması alınamadı: ${not}`]);
    return { durum: 'Kapalı' };
  });
}
