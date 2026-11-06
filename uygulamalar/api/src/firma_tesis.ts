import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const SICIL_ROLLER = ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı'];

/** TSK-1, YG-010: yeni tesis/şube kaydı sıradaki -Tnn kodunu alır (LGM-SC-00001-T01). */
export async function tesisEkle(c: Db, kurulus: string, g: { ad: string; adres?: string | null; il?: string | null; ilce?: string | null }, kaydeden: string | null) {
  const k = (await c.query(`SELECT sicil_no FROM kurulus WHERE kimlik = $1`, [kurulus])).rows[0];
  if (!k) return null;
  const sira = Number((await c.query(`SELECT coalesce(max(sira), 0) + 1 n FROM firma_tesisi WHERE kurulus_ref = $1`, [kurulus])).rows[0].n);
  if (sira > 99) throw Object.assign(new Error('Bir kuruluşa en çok 99 tesis kaydedilir.'), { statusCode: 409 });
  const kod = `${k.sicil_no}-T${String(sira).padStart(2, '0')}`;
  const r = (await c.query(`INSERT INTO firma_tesisi (kurulus_ref, sira, tesis_kodu, ad, adres, il, ilce, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [kurulus, sira, kod, g.ad.trim(), g.adres ?? null, g.il ?? null, g.ilce ?? null, kaydeden])).rows[0];
  return { kimlik: r.kimlik as string, tesisKodu: kod };
}

export function firmaTesisYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const sicilci = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, SICIL_ROLLER])).rowCount);
  const kendiKurumu = async (k: string, id: string) => Boolean((await b.db.query(`SELECT 1 FROM kurulus_kullanici WHERE kullanici_ref = $1 AND kurulus_ref = $2`, [k, id])).rowCount);

  s.get('/firma/:id/tesis', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; const k = i.oturum!.kullanici;
    if (!UUID.test(id) || !((await sicilci(k)) || (await kendiKurumu(k, id)) || i.oturum!.grup === 'LGM İç Rolü')) return yok(y);
    return (await b.db.query(`SELECT kimlik, tesis_kodu, ad, adres, il, ilce, aktif FROM firma_tesisi WHERE kurulus_ref = $1 ORDER BY sira`, [id])).rows;
  });
  s.post('/firma/:id/tesis', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; adres?: string; il?: string; ilce?: string };
    if (!UUID.test(id) || !(await sicilci(o.kullanici))) return yok(y);
    if (!g.ad?.trim()) return y.code(400).send({ hata: 'Tesis adı zorunludur.' });
    const r = await tesisEkle(b.db, id, { ad: g.ad, adres: g.adres?.trim() || null, il: g.il?.trim() || null, ilce: g.ilce?.trim() || null }, o.kullanici);
    if (!r) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Tesis Kaydı', nesneTuru: 'Kuruluş', nesneKimligi: id, yeni: { tesisKodu: r.tesisKodu }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return r;
  });
  s.post('/firma-tesis/:id/pasif', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await sicilci(o.kullanici))) return yok(y);
    const r = await b.db.query(`UPDATE firma_tesisi SET aktif = false WHERE kimlik = $1 AND aktif RETURNING tesis_kodu`, [id]);
    return r.rowCount ? { tamam: true } : yok(y);
  });
}
