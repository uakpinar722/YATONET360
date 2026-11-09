import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { PROSES } from './proses.js';
import { UUID } from './yat.js';

type Db = PoolClient | Baglam['db'];
const TU = ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)']; const KART = 'Onarım Yöntem Raporu';
type Sinir = { tur: string; sicaklikMin: number | null; sicaklikMax: number | null; nemMin: number | null; nemMax: number | null };

/** YNT-1: yapısal, gövde, kompozit, kaynak ve özel proses branşları rapor ister; sözcük başına bakılır ("altyapı" sayılmaz). */
export const yontemGerekli = (brans: string) => /(^|[\s,;])(yapı|gövde|kompozit|kaynak|özel proses)/i.test(brans);

/** İş emrinin branş metni: formdan gelen branş ve onaylı teklif kalemlerinin kartela ana branşları. */
export async function isEmriBransMetni(db: Db, g: { brans?: string | null; teklif?: string | null; siralar?: number[] | null }): Promise<string> {
  const l = g.teklif ? (await db.query(`SELECT DISTINCT m.ana_brans FROM fiyat_teklifi_kalemi k JOIN kartela_kalemi m ON m.kod = k.kartela_kodu AND m.surum = k.kartela_surumu WHERE k.teklif_ref = $1 AND k.onay_durumu = 'Onaylandı' AND ($2::int[] IS NULL OR k.sira_no = ANY($2))`, [g.teklif, g.siralar ?? null])).rows.map((r) => r.ana_brans as string) : [];
  return [g.brans ?? '', ...l].filter(Boolean).join('; ');
}

/** YG-1454: onaysız ON iş emri açılmaz; muadil parçada yat sahibi onayı (ONY-07) aranır. */
export async function yontemEngeli(db: Db, dosya: string): Promise<string | null> {
  const r = (await db.query(`SELECT muadil_parcalar FROM yontem_raporu WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY onay_zamani DESC LIMIT 1`, [dosya])).rows[0];
  if (!r) return 'Bu iş için Teknik Müdürün onayladığı Onarım Yöntem Raporu gereklidir.';
  for (const p of r.muadil_parcalar as string[]) if (!(await db.query(`SELECT 1 FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-07' AND durum = 'Onaylandı' AND metin LIKE '%' || $2 || '%' LIMIT 1`, [dosya, p])).rowCount) return `Muadil parça için yat sahibi onayı bekleniyor: ${p}.`;
  return null;
}

/** Onaylı rapordaki proses sınırları ON iş emrine aktarılır; dayanak rapor numarasıdır. */
export async function yontemSinirAktar(c: PoolClient, isEmri: string, dosya: string): Promise<void> {
  const r = (await c.query(`SELECT rapor_no, sinirlar, hazirlayan_ref FROM yontem_raporu WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY onay_zamani DESC LIMIT 1`, [dosya])).rows[0];
  if (!r) return;
  for (const s of r.sinirlar as Sinir[]) await c.query(`INSERT INTO proses_siniri (is_emri_ref, proses_turu, sicaklik_min, sicaklik_max, nem_min, nem_max, dayanak, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (is_emri_ref, proses_turu) DO NOTHING`, [isEmri, s.tur, s.sicaklikMin, s.sicaklikMax, s.nemMin, s.nemMax, `Onarım Yöntem Raporu ${r.rapor_no}`, r.hazirlayan_ref]);
}

kapanisKaydet(KART, async (c, k, karar, yapan) => {
  const r = (await c.query(`SELECT kimlik, dosya_ref FROM yontem_raporu WHERE kimlik = $1 AND durum = 'Onayda'`, [k.nesne_kimligi])).rows[0];
  if (!r) return;
  if (karar === 'Onayla') {
    await c.query(`UPDATE yontem_raporu SET durum = 'Yerine Geçti' WHERE dosya_ref = $1 AND durum = 'Onaylı'`, [r.dosya_ref]);
    await c.query(`UPDATE yontem_raporu SET durum = 'Onaylı', onaylayan_ref = $2, onay_zamani = now() WHERE kimlik = $1`, [r.kimlik, yapan]);
  } else if (karar === 'Reddet') await c.query(`UPDATE yontem_raporu SET durum = 'Reddedildi' WHERE kimlik = $1`, [r.kimlik]);
  else if (karar === 'Gerekçeyle İade Et') await c.query(`UPDATE yontem_raporu SET durum = 'İade Edildi' WHERE kimlik = $1`, [r.kimlik]);
});

export function yontemRaporuYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const ALANLAR = `kimlik, rapor_no, durum, kapsam, malzeme_tablosu, uygulama_sirasi, eszamanli_yapilamaz, muadil_parcalar, sinirlar, onay_zamani`;

  s.get('/dosya/:id/yontem-raporu', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (i.oturum!.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT ${ALANLAR} FROM yontem_raporu WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`, [id])).rows;
  });

  // K-192: firmaya ON iş emrinin bağlayıcı eki olarak görünür; yalnız onaylı son sürüm.
  s.get('/firma-portal/is-emri/:id/yontem-raporu', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT e.dosya_ref, e.is_emri_turu FROM is_emri e JOIN kurulus_kullanici x ON x.kurulus_ref = e.kurulus_ref WHERE e.kimlik = $1 AND x.kullanici_ref = $2 AND e.statu NOT IN ('Taslak', 'İç Onayda', 'İptal')`, [id, i.oturum!.kullanici])).rows[0];
    if (!e) return yok(y);
    return (await b.db.query(`SELECT rapor_no, kapsam, malzeme_tablosu, uygulama_sirasi, eszamanli_yapilamaz FROM yontem_raporu WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY onay_zamani DESC LIMIT 1`, [e.dosya_ref])).rows[0] ?? null;
  });

  s.post('/dosya/:id/yontem-raporu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kapsam?: string; malzeme?: string; sira?: string; eszamanli?: string; cizim?: string; muadil?: string[]; sinirlar?: Partial<Sinir>[] };
    if (!UUID.test(id)) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = ANY($3) AND bitis_zamani IS NULL`, [id, o.kullanici, TU])).rowCount) return y.code(403).send({ hata: 'Onarım Yöntem Raporunu Teknik Uzman hazırlar.' });
    if (!g.kapsam?.trim() || !g.malzeme?.trim() || !g.sira?.trim()) return y.code(400).send({ hata: 'Kapsam, malzeme tablosu ve uygulama sırası zorunludur.' });
    if (g.cizim && !UUID.test(g.cizim)) return y.code(400).send({ hata: 'Çizim belgesi geçersizdir.' });
    const n = (x: unknown) => (x === undefined || x === null || x === '' ? null : Number(x));
    const sinirlar: Sinir[] = (g.sinirlar ?? []).map((x) => ({ tur: x.tur ?? '', sicaklikMin: n(x.sicaklikMin), sicaklikMax: n(x.sicaklikMax), nemMin: n(x.nemMin), nemMax: n(x.nemMax) }));
    for (const x of sinirlar) {
      const v = [x.sicaklikMin, x.sicaklikMax, x.nemMin, x.nemMax];
      if (!PROSES[x.tur] || v.every((a) => a === null) || v.some((a) => a !== null && Number.isNaN(a)) || (x.sicaklikMin !== null && x.sicaklikMax !== null && x.sicaklikMin > x.sicaklikMax) || (x.nemMin !== null && x.nemMax !== null && x.nemMin > x.nemMax)) return y.code(400).send({ hata: 'Proses sınırları geçersizdir.' });
    }
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      if ((await c.query(`SELECT 1 FROM yontem_raporu WHERE dosya_ref = $1 AND durum = 'Onayda'`, [id])).rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Onay bekleyen rapor vardır.' }); }
      const nn = String(Number((await c.query(`SELECT count(*) n FROM yontem_raporu WHERE dosya_ref = $1`, [id])).rows[0].n) + 1).padStart(2, '0');
      const r = (await c.query(`INSERT INTO yontem_raporu (rapor_no, dosya_ref, kapsam, malzeme_tablosu, uygulama_sirasi, eszamanli_yapilamaz, cizim_belge_ref, muadil_parcalar, sinirlar, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik, rapor_no`,
        [`${d.dosya_no}-FR-ONR-001-${nn}`, id, g.kapsam.trim(), g.malzeme.trim(), g.sira.trim(), g.eszamanli?.trim() || null, g.cizim ?? null, (g.muadil ?? []).map((x) => String(x).trim()).filter(Boolean), JSON.stringify(sinirlar), o.kullanici])).rows[0];
      await kartAc(c, { tur: KART, baslik: `${r.rapor_no} · Onarım Yöntem Raporu`, ozet: g.kapsam.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Teknik Müdür')], nesneTuru: 'Onarım Yöntem Raporu', nesneKimligi: r.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Onarım Yöntem Raporu Hazırlandı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { no: r.rapor_no }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, raporNo: r.rapor_no };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
