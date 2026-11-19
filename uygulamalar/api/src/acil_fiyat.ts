import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';
import { izinGerekli } from './yetki.js';

type Db = Pool | PoolClient;
const BANT = 0.15; // kartela bandı ±%15

/** YG-1473: ekip-saat bandının dayanağı yürürlükteki kartelada birimi "saat" olan kalemlerin ortanca maliyetidir (kartelada acil ekip-saat kalemi yoktur). */
export async function ekipSaatReferansi(db: Db): Promise<number | null> {
  const r = (await db.query(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY maliyet_eur) m FROM kartela_kalemi WHERE birim = 'saat' AND maliyet_eur > 0 AND surum = (SELECT surum FROM kartela_surumu WHERE durum = 'Yürürlükte' ORDER BY surum DESC LIMIT 1)`)).rows[0]?.m;
  return r === null || r === undefined ? null : Math.round(Number(r) * 100) / 100;
}

/** YG-1473: acil ön değer = çıkış + bir ekip-saat + ekipman; firma kabul ekranında başlangıç değeridir, firma tahmini tutarı düzeltir. Müşteriye ve kartelaya gösterilmez. */
export async function acilOnDeger(db: Db, kurulus: string): Promise<number | null> {
  const f = (await db.query(`SELECT cikis_eur, ekip_saat_eur, ekipman_eur FROM firma_acil_fiyat WHERE kurulus_ref = $1`, [kurulus])).rows[0];
  return f ? Math.round((Number(f.cikis_eur) + Number(f.ekip_saat_eur) + Number(f.ekipman_eur)) * 100) / 100 : null;
}

export function acilFiyatYollari(s: FastifyInstance, b: Baglam) {
  const kayit = { preHandler: izinGerekli(b, 'firma.kayit') };
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/firma/:id/acil-birim-fiyat', kayit, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id)) return yok(y);
    const f = (await b.db.query(`SELECT cikis_eur, ekip_saat_eur, ekipman_eur, bant_disi_gerekce, zaman FROM firma_acil_fiyat WHERE kurulus_ref = $1`, [id])).rows[0] ?? null;
    const ref = await ekipSaatReferansi(b.db);
    return { fiyat: f, ekipSaatBandi: ref === null ? null : { alt: Math.round(ref * (1 - BANT) * 100) / 100, ust: Math.round(ref * (1 + BANT) * 100) / 100 } };
  });
  // YG-1473: ağa kabulde acil birim fiyatları (çıkış, ekip-saat, ekipman) girilir; ekip-saat kartela bandı dışındaysa gerekçe zorunludur.
  s.post('/firma/:id/acil-birim-fiyat', kayit, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { cikis?: number; ekipSaat?: number; ekipman?: number; gerekce?: string };
    if (!UUID.test(id) || !(await b.db.query(`SELECT 1 FROM kurulus WHERE kimlik = $1 AND kayit_rolu = 'Çözüm Ortağı'`, [id])).rowCount) return yok(y);
    const [c, e, m] = [Number(g.cikis), Number(g.ekipSaat), Number(g.ekipman ?? 0)];
    if (!(c >= 0) || !(e > 0) || !(m >= 0)) return y.code(400).send({ hata: 'Çıkış, ekip-saat ve ekipman birim fiyatlarını EUR olarak giriniz.' });
    const ref = await ekipSaatReferansi(b.db);
    const disinda = ref !== null && (e < ref * (1 - BANT) || e > ref * (1 + BANT));
    if (disinda && !g.gerekce?.trim()) return y.code(409).send({ hata: `Ekip-saat fiyatı kartela bandı dışındadır (${(ref! * (1 - BANT)).toFixed(2).replace('.', ',')}–${(ref! * (1 + BANT)).toFixed(2).replace('.', ',')} EUR); gerekçe yazınız.` });
    const eski = (await b.db.query(`SELECT cikis_eur, ekip_saat_eur, ekipman_eur FROM firma_acil_fiyat WHERE kurulus_ref = $1`, [id])).rows[0] ?? null;
    await b.db.query(`INSERT INTO firma_acil_fiyat (kurulus_ref, cikis_eur, ekip_saat_eur, ekipman_eur, bant_disi_gerekce, giren_ref) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (kurulus_ref) DO UPDATE SET cikis_eur = EXCLUDED.cikis_eur, ekip_saat_eur = EXCLUDED.ekip_saat_eur, ekipman_eur = EXCLUDED.ekipman_eur, bant_disi_gerekce = EXCLUDED.bant_disi_gerekce, giren_ref = EXCLUDED.giren_ref, zaman = now()`, [id, c, e, m, disinda ? g.gerekce!.trim() : null, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Acil Birim Fiyatı', nesneTuru: 'Kuruluş', nesneKimligi: id, eski, yeni: { cikis: c, ekipSaat: e, ekipman: m }, gerekce: g.gerekce?.trim() || undefined, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { onDeger: await acilOnDeger(b.db, id), bantDisi: disinda };
  });
  s.get('/firma-portal/acil-on-deger', oturumlu, async (i, y) => {
    const f = (await b.db.query(`SELECT kurulus_ref FROM kurulus_kullanici WHERE kullanici_ref = $1 LIMIT 1`, [i.oturum!.kullanici])).rows[0]?.kurulus_ref as string | undefined;
    if (!f) return yok(y);
    return { onDeger: await acilOnDeger(b.db, f) };
  });
}
