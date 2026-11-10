import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';
import type { Satir } from './ana_veri.js';

/** YG-1291: kaynak Excel dosyaları bu tarihte dondurulur. */
export const DONDURMA = '2026-12-15';
const VERI_SAHIBI = 'Firma Yönetimi Müdürü';
const KABUL = 'Ana Veri Göç Kabulü'; const DEGISIKLIK = 'Göç Değişikliği';
const sayi = (x?: string) => (x?.trim() && !Number.isNaN(Number(x.replace(',', '.'))) ? Number(x.replace(',', '.')) : null); // ana_veri.ts ile aynı okuma
const anahtar = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/[.,]/g, ' ').replace(/\b(ltd|şti|sti|a ?ş|as|san|tic|ve|limited|şirketi|sirketi)\b/g, '').replace(/\s+/g, ' ').trim();

kapanisKaydet(KABUL, async (c, k, karar) => { if (karar === 'Onayla') await c.query(`UPDATE goc_calismasi SET kabul = 'Kabul Edildi', kabul_zamani = now() WHERE kimlik = $1::uuid`, [k.nesne_kimligi]); else if (karar === 'Reddet') await c.query(`UPDATE goc_calismasi SET kabul = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]); });
kapanisKaydet(DEGISIKLIK, async (c, k, karar) => { await c.query(`UPDATE goc_degisiklik SET durum = $2 WHERE kimlik = $1::uuid AND durum = 'GMY Değerlendirmesinde'`, [k.nesne_kimligi, karar === 'Onayla' ? 'Uygun' : karar === 'Reddet' ? 'Uygun Değil' : 'GMY Değerlendirmesinde']); });

/**
 * YG-1289: yüklemeden sonra aynı işlemde kaynak-hedef sayı, kimlik, ilişki ve kritik değer doğrulanır.
 * YG-1288: unvan ve telefon benzerliğinden mükerrer aday listesi çıkarılır (kaynak sütun → hedef alan eşlemesi ana_veri.ts yükleyicisindedir).
 */
export async function gocDogrula(c: PoolClient, g: { firmalar: Satir[]; noktalar: Satir[] }) {
  const fNo = g.firmalar.filter((f) => sayi(f['Sıra']) !== null && f['Firma Adı']?.trim() && f['Kayıt Rolü']?.trim() === 'İB Firması adayı').map((f) => sayi(f['Sıra'])!);
  const nNo = g.noktalar.filter((n) => sayi(n['Nokta No']) !== null && (n['Tesis / Nitelik']?.trim() || n['Belde / Yerleşim']?.trim())).map((n) => sayi(n['Nokta No'])!);
  const fVar = new Set((await c.query(`SELECT ana_veri_no n FROM kurulus WHERE ana_veri_no = ANY($1::int[])`, [fNo])).rows.map((r) => Number(r.n)));
  const nVar = new Set((await c.query(`SELECT nokta_no n FROM baglama_noktasi WHERE nokta_no = ANY($1::int[])`, [nNo])).rows.map((r) => Number(r.n)));
  const iliski = Number((await c.query(`SELECT count(*) n FROM baglama_noktasi b WHERE b.ana_nokta_ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM baglama_noktasi a WHERE a.kimlik = b.ana_nokta_ref)`)).rows[0].n);
  // Kritik değer: hedefteki unvan ve koordinat kaynakla aynı olmalı.
  const kayAd = new Map(g.firmalar.map((f) => [sayi(f['Sıra']), f['Firma Adı']?.trim()]));
  const kayKo = new Map(g.noktalar.map((n) => [sayi(n['Nokta No']), [n['Enlem']?.trim() || null, n['Boylam']?.trim() || null]]));
  let kritik = 0;
  for (const r of (await c.query(`SELECT ana_veri_no n, ticari_unvan FROM kurulus WHERE ana_veri_no = ANY($1::int[])`, [fNo])).rows) if (kayAd.get(Number(r.n)) !== r.ticari_unvan) kritik++;
  for (const r of (await c.query(`SELECT nokta_no n, enlem, boylam FROM baglama_noktasi WHERE nokta_no = ANY($1::int[])`, [nNo])).rows) { const k = kayKo.get(Number(r.n)); const es = (a: string | null | undefined, b: unknown) => (a === null || a === undefined ? b === null : b !== null && Math.abs(Number(a.replace(',', '.')) - Number(b)) < 1e-6); if (k && (!es(k[0], r.enlem) || !es(k[1], r.boylam))) kritik++; }
  const adaylar = new Map<string, string[]>();
  for (const r of (await c.query(`SELECT ticari_unvan, kurumsal_telefon FROM kurulus WHERE ana_veri_no = ANY($1::int[])`, [fNo])).rows) {
    for (const k of [`u:${anahtar(r.ticari_unvan)}`, r.kurumsal_telefon ? `t:${String(r.kurumsal_telefon).replace(/\D/g, '')}` : null]) if (k && k.length > 3) adaylar.set(k, [...(adaylar.get(k) ?? []), r.ticari_unvan]);
  }
  const mukerrerAdaylari = [...adaylar.entries()].filter(([, l]) => l.length > 1).map(([k, l]) => ({ olcut: k.startsWith('u:') ? 'Unvan' : 'Telefon', kayitlar: [...new Set(l)] }));
  const eksikFirma = fNo.filter((n) => !fVar.has(n)); const eksikNokta = nNo.filter((n) => !nVar.has(n));
  return { sayi: { kaynakFirma: fNo.length, hedefFirma: fVar.size, kaynakNokta: nNo.length, hedefNokta: nVar.size }, eksikFirma, eksikNokta, iliskiHatasi: iliski, kritikHata: kritik, mukerrerAdaylari, mutabik: !eksikFirma.length && !eksikNokta.length && !iliski && !kritik };
}

export const kaynakOzeti = (metinler: string[]) => createHash('sha256').update(metinler.join('\u0000')).digest('hex');

/**
 * YG-1290: en az iki deneme göçü yapılır; son deneme mutabık olmadan gerçek göç yapılmaz.
 * YG-1291: dondurma tarihinden sonra kaynak değişmişse, değişiklik GMY'ce uygun görülmüş Göç Değişiklik Listesinde olmalıdır.
 */
export async function gercekGocEngeli(c: PoolClient, ozet: string, simdi = new Date()): Promise<string | null> {
  const d = (await c.query(`SELECT mutabik FROM goc_calismasi WHERE tur = 'Deneme' ORDER BY zaman`)).rows;
  if (d.length < 2) return 'Gerçek göçten önce en az iki deneme göçü yapılmalıdır.';
  if (!d[d.length - 1].mutabik) return 'Son deneme göçü mutabık değildir.';
  if (simdi.toISOString().slice(0, 10) >= DONDURMA) {
    const taban = (await c.query(`SELECT kaynak_ozeti FROM goc_calismasi WHERE zaman::date >= $1::date ORDER BY zaman LIMIT 1`, [DONDURMA])).rows[0]?.kaynak_ozeti;
    if (taban && taban !== ozet && !(await c.query(`SELECT 1 FROM goc_degisiklik WHERE durum IN ('Uygun', 'Uygulandı')`)).rowCount) return 'Kaynak dosyalar dondurmadan sonra değişmiş; değişiklik GMY uygun görmüş Göç Değişiklik Listesinde değil.';
  }
  return null;
}

/** Göç çalışması kaydı; gerçek göçte veri sahibine YATONET 360 kabul onayı düşer (imzasız). */
export async function gocKaydet(c: PoolClient, g: { tur: 'Deneme' | 'Gerçek'; ozet: string; sonuc: Awaited<ReturnType<typeof gocDogrula>>; yapan?: string | null }): Promise<string> {
  const k = (await c.query(`INSERT INTO goc_calismasi (tur, kaynak_ozeti, sonuc, mutabik, yapan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.tur, g.ozet, JSON.stringify(g.sonuc), g.sonuc.mutabik, g.yapan ?? null])).rows[0].kimlik as string;
  if (g.tur === 'Gerçek') await kartAc(c, { tur: KABUL, baslik: `${KABUL}: ${g.sonuc.sayi.hedefFirma} firma, ${g.sonuc.sayi.hedefNokta} bağlama noktası`, ozet: `Mutabakat: ${g.sonuc.mutabik ? 'Tam' : 'Farklı'} · Mükerrer adayı: ${g.sonuc.mukerrerAdaylari.length}`, zincir: [await rolId(c, VERI_SAHIBI)], nesneTuru: 'Göç Çalışması', nesneKimligi: k });
  return k;
}

export function gocYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const GOR = [VERI_SAHIBI, 'Genel Müdür Yardımcısı', 'Bilgi İşlem Müdürü', 'Sistem Yöneticisi', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
  s.get('/goc', oturumlu, async (i, y) => ((await rolVar(i.oturum!.kullanici, GOR)) ? { dondurma: DONDURMA, calismalar: (await b.db.query(`SELECT kimlik, tur, zaman, mutabik, kabul, sonuc->'sayi' sayi FROM goc_calismasi ORDER BY zaman DESC LIMIT 20`)).rows, degisiklikler: (await b.db.query(`SELECT kimlik, kaynak, kayit, alan, eski, yeni, gerekce, durum FROM goc_degisiklik ORDER BY olusturma_zamani DESC`)).rows } : yok(y)));
  // YG-1291: dondurmadan sonraki zorunlu değişikliği veri sahibi kaydeder, GMY uygun görür; gerçek göçten sonra uygulanır.
  s.post('/goc/degisiklik', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, [VERI_SAHIBI]))) return yok(y);
    const g = (i.body ?? {}) as { kaynak?: string; kayit?: string; alan?: string; eski?: string; yeni?: string; gerekce?: string };
    if (![g.kaynak, g.kayit, g.alan, g.yeni, g.gerekce].every((x) => x?.trim())) return y.code(400).send({ hata: 'Kaynak dosya, kayıt, alan, yeni değer ve gerekçe zorunludur.' });
    const k = (await b.db.query(`INSERT INTO goc_degisiklik (kaynak, kayit, alan, eski, yeni, gerekce, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [g.kaynak!.trim(), g.kayit!.trim(), g.alan!.trim(), g.eski?.trim() || null, g.yeni!.trim(), g.gerekce!.trim(), o.kullanici])).rows[0].kimlik as string;
    await kartAc(b.db, { tur: DEGISIKLIK, baslik: `${DEGISIKLIK}: ${g.kaynak!.trim()} · ${g.kayit!.trim()} · ${g.alan!.trim()}`, ozet: g.gerekce!.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Genel Müdür Yardımcısı')], nesneTuru: 'Göç Değişikliği', nesneKimligi: k });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: DEGISIKLIK, nesneTuru: 'Göç Değişikliği', nesneKimligi: k, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: k };
  });
  s.post('/goc/degisiklik/:id/uygulandi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [VERI_SAHIBI, 'Sistem Yöneticisi']))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM goc_calismasi WHERE tur = 'Gerçek'`)).rowCount) return y.code(409).send({ hata: 'Değişiklik gerçek göçten sonra uygulanır.' });
    const r = await b.db.query(`UPDATE goc_degisiklik SET durum = 'Uygulandı', uygulama_zamani = now() WHERE kimlik = $1 AND durum = 'Uygun'`, [id]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Yalnız GMY uygun görmüş değişiklik uygulanır.' });
    return { tamam: true };
  });
}
