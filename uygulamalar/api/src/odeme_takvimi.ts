import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { birKez, bildir } from './bildirim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const MUHASEBE_SQL = `x.rol_adi IN ('Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', 'Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdürü')`;
const TURLER = ['Vergi', 'SGK', 'Diğer'];
const gun = (d: Date) => new Date(d.getTime() + 180 * 60_000).toISOString().slice(0, 10);

/** İş günü değilse (Pazar veya resmî tatil) sonraki ilk iş gününe kaydırır; tarih TSİ gün olarak verilir. */
export async function isGununeKaydir(db: Db, t: string): Promise<string> {
  const d = new Date(`${t}T09:00:00+03:00`); const g = d.getUTCDay();
  const tatil = (await db.query(`SELECT 1 FROM resmi_tatil WHERE tarih = $1::date AND NOT yarim_gun`, [t])).rowCount;
  if (g !== 0 && !tatil) return t;
  return gun(await isGunuSonu(db, d, 1));
}

/** YG-918: masraf ödemesi ayın 7'si veya 21'i (bugünden sonraki ilk), maaş izleyen ayın ilk iş günü. */
export async function onerilenVadeler(db: Db, simdi = new Date()) {
  const b = gun(simdi); const [y, a, d] = b.split('-').map(Number) as [number, number, number];
  const ay = (yy: number, aa: number, dd: number) => new Date(Date.UTC(yy, aa - 1, dd)).toISOString().slice(0, 10);
  const masraf = d <= 7 ? ay(y, a, 7) : d <= 21 ? ay(y, a, 21) : ay(y, a + 1, 7);
  return { masraf: await isGununeKaydir(db, masraf), maas: await isGununeKaydir(db, ay(y, a + 1, 1)) };
}

/** Takvim satırları: personel masrafı, maaş, Çözüm Ortağı, tedarikçi ve elle girilen vergi/SGK/diğer ödemeler. */
export async function odemeTakvimi(db: Db, simdi = new Date()) {
  const v = await onerilenVadeler(db, simdi);
  const l: { kaynak: string; aciklama: string; tutar_eur: number | null; tutar_tl: number | null; vade: string; kimlik?: string }[] = [];
  const ms = (await db.query(`SELECT count(*)::int n, coalesce(sum(odenecek_eur), 0)::float t FROM personel_masraf_fisi WHERE durum = 'Onaylandı'`)).rows[0];
  if (ms.n) l.push({ kaynak: 'Personel Masrafı', aciklama: `${ms.n} onaylı masraf fişi`, tutar_eur: ms.t, tutar_tl: null, vade: v.masraf });
  l.push({ kaynak: 'Maaş', aciklama: 'Aylık maaş ödemesi', tutar_eur: null, tutar_tl: null, vade: v.maas });
  for (const r of (await db.query(`SELECT t.kimlik, (t.tutar_eur - coalesce(t.tutulan_eur, 0))::float t, to_char(t.planlanan_tarih, 'YYYY-MM-DD') v, u.ticari_unvan FROM odeme_talimati t JOIN kurulus u ON u.kimlik = t.kurulus_ref WHERE t.durum = 'Onaylandı'`)).rows)
    l.push({ kaynak: 'Çözüm Ortağı', aciklama: r.ticari_unvan, tutar_eur: r.t, tutar_tl: null, vade: r.v, kimlik: r.kimlik });
  for (const r of (await db.query(`SELECT f.kimlik, f.fatura_no, f.tutar_eur::float t, to_char(f.tarih + 60, 'YYYY-MM-DD') v, u.ticari_unvan FROM tedarikci_faturasi f JOIN kurulus u ON u.kimlik = f.kurulus_ref WHERE f.odeme_zamani IS NULL`)).rows)
    l.push({ kaynak: 'Tedarikçi', aciklama: `${r.ticari_unvan} · ${r.fatura_no}`, tutar_eur: r.t, tutar_tl: null, vade: r.v, kimlik: r.kimlik });
  for (const r of (await db.query(`SELECT kimlik, tur, aciklama, tutar_tl::float tl, to_char(vade, 'YYYY-MM-DD') v FROM odeme_takvimi_kalemi WHERE odenme_zamani IS NULL`)).rows)
    l.push({ kaynak: r.tur, aciklama: r.aciklama, tutar_eur: null, tutar_tl: r.tl, vade: r.v, kimlik: r.kimlik });
  return l.sort((x, y) => x.vade.localeCompare(y.vade));
}

/** YG-918: vadeden 72 saat önce ve vade günü Muhasebe ve Finans rollerine birer kez uyarı. */
export async function odemeTakvimiUyariIsle(db: Pool, simdi = new Date()): Promise<number> {
  const al = (await db.query(`SELECT DISTINCT a.kullanici_ref FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.atama_durumu = 'Aktif' AND ${MUHASEBE_SQL}`)).rows.map((r) => r.kullanici_ref as string);
  if (!al.length) return 0;
  let n = 0; const bugun = gun(simdi);
  for (const s of await odemeTakvimi(db, simdi)) {
    const vadeAni = new Date(`${s.vade}T00:00:00+03:00`).getTime(); const kalan = vadeAni - simdi.getTime();
    const anahtar = `${s.kaynak}:${s.kimlik ?? s.vade}`;
    const tur = s.vade === bugun ? 'odeme-vade-gunu' : kalan > 0 && kalan <= 72 * 3_600_000 ? 'odeme-vade-72' : null;
    if (!tur || !(await birKez(db, tur, anahtar))) continue;
    const t = s.tutar_eur !== null ? ` · ${s.tutar_eur.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR` : s.tutar_tl !== null ? ` · ${s.tutar_tl.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL` : '';
    await bildir(db, { olay: `${tur}:${anahtar}`, kullanicilar: al, baslik: `${tur === 'odeme-vade-gunu' ? 'Bugün Vadeli Ödeme' : 'Yaklaşan Ödeme (72 Saat)'}: ${s.kaynak}`, ozet: `${s.aciklama}${t} · Vade: ${s.vade.split('-').reverse().join('.')}`, oncelik: tur === 'odeme-vade-gunu' ? 'Yüksek' : 'Normal' }, simdi);
    n++;
  }
  return n;
}

export function odemeTakvimiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const muhasebe = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND ${MUHASEBE_SQL} LIMIT 1`, [k])).rowCount);
  s.get('/odeme-takvimi', oturumlu, async (i, y) => {
    if (!(await muhasebe(i.oturum!.kullanici))) return yok(y);
    return { satirlar: await odemeTakvimi(b.db), oneri: await onerilenVadeler(b.db) };
  });
  // Vergi, SGK ve diğer dönemsel ödemeler vadesiyle elle girilir; vade iş günü değilse sonraki iş gününe kayar.
  s.post('/odeme-takvimi/kalem', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; aciklama?: string; tutarTl?: number; vade?: string };
    if (!(await muhasebe(o.kullanici))) return yok(y);
    if (!TURLER.includes(g.tur ?? '') || !g.aciklama?.trim() || !g.vade || !/^\d{4}-\d{2}-\d{2}$/.test(g.vade)) return y.code(400).send({ hata: 'Tür, açıklama ve vadeyi girmenizi rica ederiz.' });
    if (g.tutarTl !== undefined && !(Number(g.tutarTl) > 0)) return y.code(400).send({ hata: 'Tutar geçersiz.' });
    const vade = await isGununeKaydir(b.db, g.vade);
    const r = (await b.db.query(`INSERT INTO odeme_takvimi_kalemi (tur, aciklama, tutar_tl, vade, giren_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.tur, g.aciklama.trim(), g.tutarTl ?? null, vade, o.kullanici])).rows[0];
    return { kimlik: r.kimlik, vade };
  });
  s.post('/odeme-takvimi/kalem/:id/odendi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await muhasebe(o.kullanici))) return yok(y);
    const r = await b.db.query(`UPDATE odeme_takvimi_kalemi SET odenme_zamani = now(), odeyen_ref = $2 WHERE kimlik = $1 AND odenme_zamani IS NULL`, [id, o.kullanici]);
    return r.rowCount ? { tamam: true } : yok(y);
  });
}
