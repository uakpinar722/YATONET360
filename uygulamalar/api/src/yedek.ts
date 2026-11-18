import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync, writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import { join, relative } from 'node:path';
import { createGunzip, createGzip } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { izYaz } from './denetim.js';
import { sayac } from './sure.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';

export interface YedekAyari { veritabani: string; superParola: string; anahtar: string; klasor: string; ikinciKlasor?: string; depoKok?: string; port?: number }
const anahtarAl = (a: string) => createHash('sha256').update(`${a}:yedek`).digest();
const SY = 'Sistem Yöneticisi'; const BIM = 'Bilgi İşlem Müdürü';

/** YG-1278: tam geri yükleme testi ve felaket tatbikatı sonucunun son kabulünü BT ve Firma Yönetimi Direktörü verir. */
kapanisKaydet('Geri Yükleme Testi Sonucu', async (c, k, karar) => {
  if (karar !== 'Onayla' && karar !== 'Reddet') return;
  await c.query(`UPDATE geri_yukleme_testi SET kabul = $2, kabul_zamani = now() WHERE kimlik = $1 AND kabul = 'Onay Bekliyor'`, [k.nesne_kimligi, karar === 'Onayla' ? 'Kabul Edildi' : 'Reddedildi']);
});

function sifrele(veri: Buffer, a: string) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', anahtarAl(a), iv); const g = Buffer.concat([c.update(veri), c.final()]); return Buffer.concat([iv, c.getAuthTag(), g]); }
/** Yedek zarfı: iv (12) | GCM etiketi (16) | şifreli gzip. Yazım akış halindedir; etiket yazım bitince 12. bayta yerleştirilir. */
async function akisYaz(yol: string, a: string, uret: (yaz: (s: string) => Promise<void>) => Promise<void>) {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', anahtarAl(a), iv); const gz = createGzip();
  const out = createWriteStream(yol); out.write(Buffer.concat([iv, Buffer.alloc(16)]));
  gz.pipe(c).pipe(out);
  const yaz = async (s: string) => { if (!gz.write(s)) await once(gz, 'drain'); };
  await uret(yaz);
  gz.end(); await once(out, 'finish');
  const fd = openSync(yol, 'r+'); try { writeSync(fd, c.getAuthTag(), 0, 16, 12); } finally { closeSync(fd); }
}
/** Akış halinde çözer ve satır satır okur. */
function akisOku(dosya: string, a: string) {
  const fd = openSync(dosya, 'r'); const bas = Buffer.alloc(28); try { readSync(fd, bas, 0, 28, 0); } finally { closeSync(fd); }
  const d = createDecipheriv('aes-256-gcm', anahtarAl(a), bas.subarray(0, 12)); d.setAuthTag(bas.subarray(12, 28));
  return createInterface({ input: createReadStream(dosya, { start: 28 }).pipe(d).pipe(createGunzip()), crlfDelay: Infinity });
}
const dosyaOzeti = async (yol: string) => { const h = createHash('sha256'); for await (const p of createReadStream(yol)) h.update(p as Buffer); return h.digest('hex'); };

const superBaglan = async (v: string, p: string, port = 5432) => { const c = new pg.Client({ host: 'localhost', port, user: 'postgres', password: p, database: v }); await c.connect(); return c; };

/** YG-1274, YG-1276: tüm tablolar şifreli alınır; belgeler içerik adresli klasöre kopyalanır; ikinci konum tanımlı değilse set eksik sayılır. */
export async function yedekAl(db: Pool, tur: 'Dört Saatlik' | 'Gece Tam', a: YedekAyari, simdi = new Date()) {
  const k = (await db.query(`INSERT INTO yedek_kaydi (tur, baslangic) VALUES ($1,$2) RETURNING kimlik`, [tur, simdi])).rows[0].kimlik as string;
  let c: pg.Client | undefined;
  try {
    c = await superBaglan(a.veritabani, a.superParola, a.port);
    mkdirSync(a.klasor, { recursive: true });
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tablolar = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).rows.map((r) => r.tablename as string);
    let satir = 0;
    const ad = `yedek-${simdi.toISOString().replace(/[:.]/g, '-')}.yny`; const yol = join(a.klasor, ad);
    // Bellek taşmasını önlemek için her tablo imleçle 1.000 satırlık parçalar hâlinde okunur ve akış hâlinde yazılır (surum 2, satır başına bir JSON).
    await akisYaz(yol, a.anahtar, async (yaz) => {
      await yaz(JSON.stringify({ surum: 2, zaman: simdi.toISOString() }) + '\n');
      for (const t of tablolar) {
        await c!.query(`DECLARE yedek_imleci NO SCROLL CURSOR FOR SELECT to_jsonb(x) j FROM ${pg.escapeIdentifier(t)} x`);
        for (;;) { const r = (await c!.query(`FETCH 1000 FROM yedek_imleci`)).rows; if (!r.length) break; satir += r.length; await yaz(JSON.stringify({ t, r: r.map((z) => z.j) }) + '\n'); }
        await c!.query(`CLOSE yedek_imleci`);
      }
      const siralar = (await c!.query(`SELECT schemaname || '.' || sequencename s, last_value v FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL`)).rows;
      await yaz(JSON.stringify({ siralar }) + '\n');
    });
    await c.query('COMMIT');
    const ozet = await dosyaOzeti(yol); const paket = { length: statSync(yol).size };
    let belge = 0;
    if (a.depoKok && existsSync(a.depoKok)) {
      const hedef = join(a.klasor, 'belgeler'); const gez = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (e.name !== 'gecici') gez(p); continue; } const h = join(hedef, relative(a.depoKok!, p)); belge++; if (!existsSync(h)) { mkdirSync(join(h, '..'), { recursive: true }); writeFileSync(h, sifrele(readFileSync(p), a.anahtar)); } } }; gez(a.depoKok);
    }
    let ikinci = false;
    if (a.ikinciKlasor && tur === 'Gece Tam') { mkdirSync(a.ikinciKlasor, { recursive: true }); copyFileSync(yol, join(a.ikinciKlasor, ad)); ikinci = true; }
    const eksik = tur === 'Gece Tam' && !ikinci;
    await db.query(`UPDATE yedek_kaydi SET bitis = now(), dosya = $2, boyut = $3, ozet_sha256 = $4, tablo_sayisi = $5, satir_sayisi = $6, belge_sayisi = $7, ikinci_konum = $8, durum = $9, hata = $10 WHERE kimlik = $1`, [k, ad, paket.length, ozet, tablolar.length, satir, belge, ikinci, eksik ? 'Eksik Set' : 'Başarılı', eksik ? 'Gece yedeğinin ikinci konum kopyası alınamadı.' : null]);
    if (eksik && await birKez(db, 'yedek_ikinci', simdi.toISOString().slice(0, 10))) await kartAc(db, { tur: 'Başarısız Yedek İşi', kategori: 'islem', baslik: 'Eksik Yedek Seti · İkinci Konum', ozet: 'Gece yedeğinin farklı konumdaki kopyası alınamadı.', oncelik: 'Kritik', sonZaman: new Date(simdi.getTime() + 8 * 3_600_000), sahipRol: await rolId(db, SY), nesneTuru: 'Yedek', nesneKimligi: k });
    return { kimlik: k, dosya: ad, tablo: tablolar.length, satir, belge, eksik };
  } catch (e) {
    await c?.query('ROLLBACK').catch(() => {});
    await db.query(`UPDATE yedek_kaydi SET bitis = now(), durum = 'Başarısız', hata = $2 WHERE kimlik = $1`, [k, String((e as Error).message).slice(0, 300)]);
    await kartAc(db, { tur: 'Başarısız Yedek İşi', kategori: 'islem', baslik: 'Başarısız Yedek İşi', ozet: '8 saat içinde olay kaydına bağlamanız rica olunur.', oncelik: 'Kritik', sonZaman: new Date(simdi.getTime() + 8 * 3_600_000), sahipRol: await rolId(db, SY), nesneTuru: 'Yedek', nesneKimligi: k });
    throw e;
  } finally { await c?.end(); }
}

/** YG-1279: boş veya test veritabanına geri yükler, kayıt sayılarını döner. Tetikleyici ve ilişki denetimi yükleme süresince kapalıdır. */
export async function yedekGeriYukle(dosya: string, a: { hedefVeritabani: string; superParola: string; anahtar: string; port?: number }) {
  const c = await superBaglan(a.hedefVeritabani, a.superParola, a.port); const sonuc: Record<string, number> = {};
  try {
    await c.query('BEGIN'); await c.query(`SET LOCAL session_replication_role = replica`);
    const var0 = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows.map((r) => r.tablename as string);
    await c.query(`TRUNCATE ${var0.map((t) => pg.escapeIdentifier(t)).join(', ')}`);
    // Hesaplanan (generated) sütunlar yazılmaz; hedef veritabanı yeniden hesaplar.
    const sutun = new Map<string, string>();
    const yukle = async (t: string, satirlar: unknown[]) => {
      if (!sutun.has(t)) sutun.set(t, (await c.query(`SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) l FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'`, [t])).rows[0].l);
      const s = sutun.get(t)!;
      for (let i = 0; i < satirlar.length; i += 500) await c.query(`INSERT INTO ${pg.escapeIdentifier(t)} (${s}) OVERRIDING SYSTEM VALUE SELECT ${s} FROM jsonb_populate_recordset(null::${pg.escapeIdentifier(t)}, $1::jsonb)`, [JSON.stringify(satirlar.slice(i, i + 500))]);
      sonuc[t] = (sonuc[t] ?? 0) + satirlar.length;
    };
    let siralar: { s: string; v: string }[] = [];
    for await (const satir of akisOku(dosya, a.anahtar)) {
      if (!satir.trim()) continue;
      const x = JSON.parse(satir) as { tablolar?: Record<string, unknown[]>; siralar?: { s: string; v: string }[]; t?: string; r?: unknown[] };
      if (x.tablolar) for (const [t, l] of Object.entries(x.tablolar)) await yukle(t, l); // surum 1: tek satır
      if (x.t && x.r) await yukle(x.t, x.r);
      if (x.siralar) siralar = x.siralar;
    }
    for (const [t, sayi] of Object.entries(sonuc)) if (sayi === 0) delete sonuc[t];
    for (const r of siralar) await c.query(`SELECT setval($1, $2)`, [r.s, r.v]);
    await c.query('COMMIT');
    return sonuc;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

/** YG-1275: 4 saatlik 48 saat; günlük 30 gün, haftalık (Pazar) 12 hafta, aylık (ayın 1'i) 6 ay. */
export async function yedekDongusu(db: Pool, klasor: string, simdi = new Date()): Promise<number> {
  let n = 0;
  for (const y of (await db.query(`SELECT kimlik, tur, dosya, baslangic FROM yedek_kaydi WHERE durum IN ('Başarılı', 'Eksik Set') AND dosya IS NOT NULL`)).rows) {
    const b = new Date(y.baslangic); const gun = (simdi.getTime() - b.getTime()) / 86_400_000;
    const tut = y.tur === 'Dört Saatlik' ? gun <= 2 : gun <= 30 || (b.getUTCDay() === 0 && gun <= 84) || (b.getUTCDate() === 1 && gun <= 183);
    if (tut) continue;
    rmSync(join(klasor, y.dosya), { force: true });
    await db.query(`UPDATE yedek_kaydi SET durum = 'Döngüden Çıktı' WHERE kimlik = $1`, [y.kimlik]); n++;
  }
  return n;
}

/** YG-523, YG-1274, YG-1278: 4 saatte bir ve gece tam; aylık, altı aylık ve yıllık testler görev olarak açılır. */
export async function yedekIsle(db: Pool, a: YedekAyari, simdi = new Date()) {
  const son = (await db.query(`SELECT max(baslangic) z FROM yedek_kaydi WHERE durum IN ('Başarılı', 'Eksik Set', 'Sürüyor')`)).rows[0].z as Date | null;
  const gun = simdi.toISOString().slice(0, 10); const saat = simdi.getUTCHours();
  const geceTam = saat >= 21 && !(await db.query(`SELECT 1 FROM yedek_kaydi WHERE tur = 'Gece Tam' AND baslangic::date = $1::date AND durum <> 'Başarısız'`, [gun])).rowCount;
  if (geceTam) await yedekAl(db, 'Gece Tam', a, simdi);
  else if (!son || simdi.getTime() - new Date(son).getTime() >= 4 * 3_600_000) await yedekAl(db, 'Dört Saatlik', a, simdi);
  await yedekDongusu(db, a.klasor, simdi);
  const ay = gun.slice(0, 7); const sy = await rolId(db, SY); const aci = (tur: string, ozet: string) => kartAc(db, { tur, kategori: 'islem', baslik: tur, ozet, oncelik: 'Yüksek', sahipRol: sy, nesneTuru: 'Yedek', nesneKimligi: ay });
  if (await birKez(db, 'geri_yukleme_aylik', ay)) await aci('Örnek Geri Yükleme Testi', 'Aylık örnek kayıt geri yükleme testinin yapılması rica olunur.');
  if ([0, 6].includes(simdi.getUTCMonth()) && await birKez(db, 'geri_yukleme_altiay', ay)) await aci('Tam Geri Yükleme Testi', 'Altı aylık tam sistem geri yükleme testinin yapılması rica olunur.');
  if (simdi.getUTCMonth() === 0 && await birKez(db, 'felaket_tatbikati', gun.slice(0, 4))) await aci('Felaket Tatbikatı', 'Yıllık uçtan uca felaket tatbikatının yapılması rica olunur.');
}

/** YG-1186: zaman sapması, disk ve zamanlanmış iş nabzı izlenir; durma güvenlik olayı olarak görünür. */
export async function saglikIzle(db: Pool, klasor: string, simdi = new Date(), sinir = { diskYuzde: 10, sapmaSn: 60, nabizSaat: 2 }): Promise<string[]> {
  const u: string[] = [];
  const dbz = new Date((await db.query(`SELECT now() z`)).rows[0].z); if (Math.abs(dbz.getTime() - Date.now()) / 1000 > sinir.sapmaSn) u.push('Uygulama ve veri tabanı saatleri arasında sapma var.');
  try { mkdirSync(klasor, { recursive: true }); const f = statfsSync(klasor); if ((f.bavail / f.blocks) * 100 < sinir.diskYuzde) u.push('Disk kapasitesi kritik düzeyde.'); } catch { u.push('Disk kapasitesi okunamadı.'); }
  const n = (await db.query(`SELECT zaman FROM sistem_nabzi WHERE kimlik = 1`)).rows[0]?.zaman as Date | undefined;
  if (n && simdi.getTime() - new Date(n).getTime() > sinir.nabizSaat * 3_600_000) u.push('Zamanlanmış işler bir süre çalışmadı; günlük ve izleme hizmeti durmuş olabilir.');
  // YG-511: iş sonucu geciktiğinde de uyarı; kuyrukta 30 dakikayı aşan ileti ve son bir saatte 5 ve üzeri başarısız gönderim. Tüm uyarılar saatte tek bildirimde birleşir.
  const kuyruk = Number((await db.query(`SELECT count(*) n FROM gonderim WHERE durum = 'Bekliyor' AND plan_zamani < $1::timestamptz - interval '30 minutes'`, [simdi])).rows[0].n);
  if (kuyruk > 0) u.push(`Gönderim kuyruğunda 30 dakikayı aşan ${kuyruk} ileti bekliyor.`);
  const basarisiz = Number((await db.query(`SELECT count(*) n FROM gonderim WHERE durum = 'Başarısız' AND olusturma_zamani > $1::timestamptz - interval '1 hour'`, [simdi])).rows[0].n);
  if (basarisiz >= 5) u.push(`Son bir saatte ${basarisiz} gönderim başarısız oldu.`);
  await db.query(`INSERT INTO sistem_nabzi (kimlik, zaman) VALUES (1,$1) ON CONFLICT (kimlik) DO UPDATE SET zaman = EXCLUDED.zaman`, [simdi]);
  if (u.length && await birKez(db, 'sistem_sagligi', simdi.toISOString().slice(0, 13))) { const al = [...await rolSahipleri(db, await rolId(db, SY)), ...await rolSahipleri(db, await rolId(db, BIM))]; await bildir(db, { olay: `sistem-sagligi:${simdi.toISOString().slice(0, 13)}`, kullanicilar: al, baslik: '⚠ Sistem Sağlığı Uyarısı', ozet: u.join(' '), oncelik: 'Kritik', sms: true, acil: true }); }
  return u;
}

export function yedekYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  s.get('/yedekler', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [SY, BIM]))) return y.code(403).send({ hata: 'Yedek kayıtlarını Sistem Yöneticisi ve Bilgi İşlem Müdürü görür.' });
    return { yedekler: (await b.db.query(`SELECT y.kimlik, y.tur, y.baslangic, y.bitis, y.boyut, y.tablo_sayisi, y.satir_sayisi, y.belge_sayisi, y.ikinci_konum, y.durum, y.hata, ol.olay_no FROM yedek_kaydi y LEFT JOIN olay_kaydi ol ON ol.kimlik = y.olay_ref ORDER BY y.baslangic DESC LIMIT 60`)).rows, testler: (await b.db.query(`SELECT tur, kurtarma_dakika, veri_kaybi_dakika, sonuc, kabul, zaman FROM geri_yukleme_testi ORDER BY zaman DESC LIMIT 12`)).rows };
  });
  // YG-1642: başarısız yedek işi 8 saat içinde OLY-YYYY-NNNN olay kaydına bağlanır; kart tamamlanır.
  s.post('/yedek/:id/olay-bagla', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!(await rolVar(o.kullanici, [SY, BIM]))) return y.code(403).send({ hata: 'Olay kaydını Sistem Yöneticisi veya Bilgi İşlem Müdürü bağlar.' });
    const k = /^[0-9a-f-]{36}$/i.test(id) ? (await b.db.query(`SELECT kimlik, tur, durum, hata, olay_ref, baslangic FROM yedek_kaydi WHERE kimlik = $1`, [id])).rows[0] : undefined;
    if (!k) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    if (!['Başarısız', 'Eksik Set'].includes(k.durum)) return y.code(409).send({ hata: 'Yalnız başarısız veya eksik yedek işi olay kaydına bağlanır.' });
    if (k.olay_ref) return y.code(409).send({ hata: 'Bu yedek işi olay kaydına bağlanmıştır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const yil = new Date().getFullYear(); const no = `OLY-${yil}-${String(await sayac(c, `veri_ihlali:${yil}`)).padStart(4, '0')}`;
      const ol = (await c.query(`INSERT INTO olay_kaydi (olay_turu, ozet, acan_ref, olay_no, onem) VALUES ('BT Kesintisi veya Veri İhlali', $1, $2, $3, 'Yüksek') RETURNING kimlik`, [`Başarısız yedek işi (${k.tur}, ${new Date(k.baslangic).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })})${k.hata ? `: ${k.hata}` : ''}`.slice(0, 300), o.kullanici, no])).rows[0].kimlik;
      await c.query(`UPDATE yedek_kaydi SET olay_ref = $2 WHERE kimlik = $1`, [k.kimlik, ol]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Başarısız Yedek İşi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [k.kimlik]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Başarısız Yedek Olaya Bağlandı', nesneTuru: 'Yedek', nesneKimligi: k.kimlik, yeni: { olay: no }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { olayNo: no, olay: ol };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.post('/geri-yukleme-testi', oturumlu, async (i, y) => { // YG-1279: hedeflerle karşılaştırma; kritik süreçler 24 saat kesinti, 4 saat veri kaybı.
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; yedek?: string; kurtarma?: number; kayip?: number; kayitTutarli?: boolean; belge?: boolean; yetki?: boolean; not?: string };
    if (!(await rolVar(o.kullanici, [SY]))) return y.code(403).send({ hata: 'Testi Sistem Yöneticisi kaydeder.' });
    if (!['Örnek Kayıt', 'Tam Sistem', 'Felaket Tatbikatı'].includes(g.tur ?? '') || !(Number(g.kurtarma) >= 0) || !(Number(g.kayip) >= 0)) return y.code(400).send({ hata: 'Tür, kurtarma süresi ve veri kaybı süresi zorunludur.' });
    const basarili = Boolean(g.kayitTutarli && g.belge && g.yetki) && Number(g.kurtarma) <= 24 * 60 && Number(g.kayip) <= 4 * 60;
    const zincirli = g.tur !== 'Örnek Kayıt'; // YG-1278
    const kayit = (await b.db.query(`INSERT INTO geri_yukleme_testi (tur, yedek_ref, kurtarma_dakika, veri_kaybi_dakika, kayit_sayisi_tutarli, belge_erisimi, yetki_tutarli, sonuc, not_metni, kaydeden_ref, kabul) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,${zincirli ? "'Onay Bekliyor'" : 'NULL'}) RETURNING kimlik`, [g.tur, g.yedek ?? null, g.kurtarma, g.kayip, Boolean(g.kayitTutarli), Boolean(g.belge), Boolean(g.yetki), basarili ? 'Başarılı' : 'Başarısız', g.not?.trim() || null, o.kullanici])).rows[0];
    // YG-1644: aylık örnek geri yükleme testinin sonucu Bilgi İşlem Müdür Yardımcısına gider.
    if (!zincirli) { const al = await rolSahipleri(b.db, await rolId(b.db, 'Bilgi İşlem Müdür Yardımcısı')); if (al.length) await bildir(b.db, { olay: `geri-yukleme-testi:${kayit.kimlik}`, kullanicilar: al, baslik: `Örnek Geri Yükleme Testi · ${basarili ? 'Başarılı' : 'Başarısız'}`, ozet: `Kurtarma ${g.kurtarma} dk · veri kaybı ${g.kayip} dk${g.not ? ` · ${g.not}` : ''}`.slice(0, 200), oncelik: basarili ? 'Normal' : 'Yüksek' }); }
    if (zincirli) await kartAc(b.db, { tur: 'Geri Yükleme Testi Sonucu', baslik: `${g.tur} Testi · ${basarili ? 'Başarılı' : 'Başarısız'}`, ozet: `Kurtarma ${g.kurtarma} dk · veri kaybı ${g.kayip} dk${g.not ? ` · ${g.not}` : ''}`.slice(0, 200), oncelik: basarili ? 'Normal' : 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Bilgi İşlem Müdür Yardımcısı'), await rolId(b.db, BIM), await rolId(b.db, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü')], nesneTuru: 'Geri Yükleme Testi', nesneKimligi: kayit.kimlik });
    return { sonuc: basarili ? 'Başarılı' : 'Başarısız' };
  });
}
