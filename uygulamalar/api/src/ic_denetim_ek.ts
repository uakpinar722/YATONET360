import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

const IDM = 'İç Denetim Müdürü'; const ID = 'İç Denetçi'; const CEO = 'CEO';
const PLAN = 'Yıllık İç Denetim Planı';

kapanisKaydet(PLAN, async (c, k, karar) => {
  const d = karar === 'Onayla' ? 'Yürürlükte' : karar === 'Reddet' ? 'Reddedildi' : karar === 'Gerekçeyle İade Et' ? 'İade Edildi' : null;
  if (d) await c.query(`UPDATE ic_denetim_plani SET durum = $2, onay_zamani = CASE WHEN $2 = 'Yürürlükte' THEN now() END WHERE kimlik = $1::uuid`, [k.nesne_kimligi, d]);
});

/** YG-1676: her Aralık'ın ilk günü İç Denetim Müdürüne gelecek yılın planını hazırlama görevi düşer (ay sonuna kadar). */
export async function denetimPlaniGorevi(db: Pool, simdi = new Date()): Promise<boolean> {
  if (simdi.getMonth() !== 11) return false;
  const yil = simdi.getFullYear() + 1;
  if ((await db.query(`SELECT 1 FROM ic_denetim_plani WHERE yil = $1 AND durum IN ('CEO Onayında', 'Yürürlükte')`, [yil])).rowCount) return false;
  if (!(await birKez(db, 'ic-denetim-plani', String(yil)))) return false;
  await kartAc(db, { tur: 'İç Denetim Planı Hazırla', kategori: 'gorev', baslik: `${yil} Yıllık İç Denetim Planı`, ozet: 'Planı hazırlayıp CEO onayına sununuz.', sahipRol: await rolId(db, IDM), sonZaman: new Date(simdi.getFullYear(), 11, 31, 18), nesneTuru: 'İç Denetim Planı', nesneKimligi: String(yil) });
  return true;
}

/**
 * YG-1676: yıllık plan İç Denetim Müdürünce hazırlanır, CEO onayıyla yürürlüğe girer.
 * YG-1680: bulgu takip denetiminde denetçinin "Etkin" kaydıyla kapanır; Müdür kapanış durumunu CEO'ya raporlar.
 */
export function icDenetimEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);
  const durum = async () => (await b.db.query(`SELECT x.sinif, count(*) FILTER (WHERE x.durum = 'Açık')::int acik, count(*) FILTER (WHERE x.durum = 'Kapandı')::int kapandi FROM ic_denetim_bulgu x GROUP BY x.sinif ORDER BY x.sinif`)).rows as { sinif: string; acik: number; kapandi: number }[];

  s.get('/ic-denetim/ek', oturumlu, async (i, y) => {
    const o = i.oturum!; const r = await roller(o.kullanici); const tum = r.includes(IDM) || r.includes(CEO); if (!tum && !r.includes(ID)) return yok(y);
    return {
      planlar: (await b.db.query(`SELECT kimlik, yil, surecler, aciklama, durum FROM ic_denetim_plani ORDER BY yil DESC LIMIT 5`)).rows,
      planHazirlar: r.includes(IDM), raporlar: r.includes(IDM),
      bulgular: (await b.db.query(`SELECT x.kimlik, d.denetim_no, x.sinif, x.tanim, x.durum, x.takip_sonucu, x.takip_notu FROM ic_denetim_bulgu x JOIN ic_denetim d ON d.kimlik = x.denetim_ref WHERE d.durum <> 'Açık' AND ($1 OR d.denetci_ref = $2) ORDER BY x.durum, x.zaman`, [tum, o.kullanici])).rows,
      ozet: tum ? await durum() : [],
    };
  });
  s.post('/ic-denetim/plan', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await roller(o.kullanici)).includes(IDM)) return yok(y);
    const g = (i.body ?? {}) as { yil?: number; surecler?: string[]; aciklama?: string };
    const surecler = (Array.isArray(g.surecler) ? g.surecler : []).map((x) => String(x).trim()).filter(Boolean);
    if (!Number.isInteger(g.yil) || g.yil! < 2026 || !surecler.length) return y.code(400).send({ hata: 'Yıl ve en az bir denetlenecek süreç giriniz.' });
    const var_ = (await b.db.query(`SELECT kimlik, durum FROM ic_denetim_plani WHERE yil = $1`, [g.yil])).rows[0];
    if (var_ && (var_.durum === 'CEO Onayında' || var_.durum === 'Yürürlükte')) return y.code(409).send({ hata: 'Bu yılın planı onayda veya yürürlüktedir.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const p = var_
        ? (await c.query(`UPDATE ic_denetim_plani SET surecler = $2, aciklama = $3, durum = 'CEO Onayında', hazirlayan_ref = $4 WHERE kimlik = $1 RETURNING kimlik`, [var_.kimlik, surecler, g.aciklama?.trim() || null, o.kullanici])).rows[0].kimlik
        : (await c.query(`INSERT INTO ic_denetim_plani (yil, surecler, aciklama, hazirlayan_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [g.yil, surecler, g.aciklama?.trim() || null, o.kullanici])).rows[0].kimlik;
      await kartAc(c, { tur: PLAN, baslik: `${g.yil} ${PLAN}`, ozet: surecler.join(', ').slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, CEO)], nesneTuru: 'İç Denetim Planı', nesneKimligi: p });
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'İç Denetim Planı Hazırla' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [String(g.yil)]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: PLAN, nesneTuru: 'İç Denetim Planı', nesneKimligi: p, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: p };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.post('/ic-denetim/bulgu/:id/takip', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; not?: string };
    if (!UUID.test(id)) return yok(y);
    const r = await roller(o.kullanici); if (!r.includes(ID) && !r.includes(IDM)) return yok(y);
    const x = (await b.db.query(`SELECT x.durum, d.durum AS ddurum FROM ic_denetim_bulgu x JOIN ic_denetim d ON d.kimlik = x.denetim_ref WHERE x.kimlik = $1`, [id])).rows[0]; if (!x) return yok(y);
    if (x.ddurum === 'Açık') return y.code(409).send({ hata: 'Takip denetimi rapordan sonra yapılır.' });
    if (x.durum === 'Kapandı') return y.code(409).send({ hata: 'Bulgu kapanmıştır.' });
    if ((g.sonuc !== 'Etkin' && g.sonuc !== 'Etkin Değil') || !g.not?.trim()) return y.code(400).send({ hata: 'Takip sonucu ve açıklama zorunludur.' });
    await b.db.query(`INSERT INTO ic_denetim_bulgu_takip (bulgu_ref, sonuc, notu, yapan_ref) VALUES ($1,$2,$3,$4)`, [id, g.sonuc, g.not.trim(), o.kullanici]);
    await b.db.query(`UPDATE ic_denetim_bulgu SET durum = CASE WHEN $2 = 'Etkin' THEN 'Kapandı' ELSE 'Açık' END, takip_sonucu = $2, takip_notu = $3, takip_eden_ref = $4, takip_zamani = now() WHERE kimlik = $1`, [id, g.sonuc, g.not.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İç Denetim Bulgu Takibi', nesneTuru: 'İç Denetim Bulgusu', nesneKimligi: id, yeni: { sonuc: g.sonuc }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/ic-denetim/bulgu-raporu', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await roller(o.kullanici)).includes(IDM)) return yok(y);
    const d = await durum(); const acik = d.reduce((a, x) => a + x.acik, 0); const kap = d.reduce((a, x) => a + x.kapandi, 0);
    await bildir(b.db, { olay: `ic-denetim-bulgu-raporu:${Date.now()}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, CEO)), baslik: 'İç Denetim Bulgu Kapanış Durumu', ozet: `Açık: ${acik} · Kapanan: ${kap} · ${d.map((x) => `${x.sinif} ${x.acik}/${x.acik + x.kapandi}`).join(' · ')}` });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İç Denetim Bulgu Raporu', nesneTuru: 'İç Denetim', nesneKimligi: 'bulgu-durumu', yeni: { acik, kapandi: kap }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { acik, kapandi: kap };
  });
}
