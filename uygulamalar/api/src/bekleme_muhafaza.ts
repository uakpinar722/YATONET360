import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;

/**
 * YG-895: onay beklenirken oluşan bekleme ve muhafaza bedeli yalnız tesisin fiilî barınma/çekek/muhafaza gideridir; LGM bekleme ücreti uygulanmaz.
 * Sayım onay talebinin (teklifin) iletildiği andan başlar, serbest süre yoktur; her gün ayrı kalem olarak işlenir ve teklif sonuçlanınca durur.
 */
export async function beklemeMuhafazaIsle(db: Db, simdi = new Date()): Promise<number> {
  const bugun = new Date(simdi.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  // Teklif artık onay beklemiyorsa (karar, süre dolumu, geri çekme) sayım kararın verildiği gün biter.
  await db.query(`UPDATE dosya_bekleme_muhafaza m SET bitis = coalesce(f.karar_zamani, $1::timestamptz) FROM fiyat_teklifi f WHERE f.kimlik = m.teklif_ref AND m.bitis IS NULL AND f.statu <> 'Gönderildi'`, [simdi]);
  const r = await db.query(`INSERT INTO bekleme_muhafaza_gunu (kayit_ref, gun, tutar_eur)
      SELECT m.kimlik, g::date, m.gunluk_eur FROM dosya_bekleme_muhafaza m
        CROSS JOIN LATERAL generate_series((m.baslangic AT TIME ZONE 'Europe/Istanbul')::date, least($1::date, coalesce((m.bitis AT TIME ZONE 'Europe/Istanbul')::date, $1::date)), interval '1 day') g
      ON CONFLICT DO NOTHING`, [bugun]);
  return r.rowCount ?? 0;
}

export function beklemeMuhafazaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  s.get('/dosya/:id/bekleme-muhafaza', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    await beklemeMuhafazaIsle(b.db);
    const kayitlar = (await b.db.query(`SELECT m.kimlik, k.ticari_unvan tesis, f.teklif_no, f.surum_no, m.gunluk_eur, m.baslangic, m.bitis, (SELECT count(*)::int FROM bekleme_muhafaza_gunu g WHERE g.kayit_ref = m.kimlik) gun, (SELECT coalesce(sum(tutar_eur), 0) FROM bekleme_muhafaza_gunu g WHERE g.kayit_ref = m.kimlik) toplam,
        (SELECT coalesce(json_agg(json_build_object('hafta', h.hafta, 'gun', h.gun, 'toplam', h.toplam) ORDER BY h.hafta), '[]') FROM (SELECT to_char(date_trunc('week', g.gun), 'YYYY-MM-DD') hafta, count(*)::int gun, sum(g.tutar_eur) toplam FROM bekleme_muhafaza_gunu g WHERE g.kayit_ref = m.kimlik GROUP BY 1) h) haftalar
      FROM dosya_bekleme_muhafaza m JOIN kurulus k ON k.kimlik = m.kurulus_ref JOIN fiyat_teklifi f ON f.kimlik = m.teklif_ref WHERE m.dosya_ref = $1 ORDER BY m.baslangic DESC`, [id])).rows;
    const d = (await b.db.query(`SELECT dosya_sorumlusu_ref = $2 sorumlu FROM dosya WHERE kimlik = $1`, [id, i.oturum!.kullanici])).rows[0];
    const teklif = (await b.db.query(`SELECT kimlik, teklif_no, surum_no FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu = 'Gönderildi' ORDER BY gonderim_zamani DESC LIMIT 1`, [id])).rows[0] ?? null;
    const tesisler = (await b.db.query(`SELECT DISTINCT k.kimlik, k.ticari_unvan FROM tesis_talebi t JOIN kurulus k ON k.kimlik = t.kurulus_ref WHERE t.dosya_ref = $1 ORDER BY k.ticari_unvan`, [id])).rows;
    return { kayitlar, girer: Boolean(d?.sorumlu), teklif, tesisler };
  });

  // Dosya Sorumlusu, onay beklenen teklif için tesisin günlük fiilî gider tutarını (tarifeden) girer; sayım teklifin iletildiği andan başlar.
  s.post('/dosya/:id/bekleme-muhafaza', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tesis?: string; gunlukEur?: number };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (d?.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Bekleme ve muhafaza kaydını Dosya Sorumlusu girer.' });
    const tutar = Number(g.gunlukEur);
    if (!g.tesis || !UUID.test(g.tesis) || !(tutar > 0)) return y.code(400).send({ hata: 'Tesisi ve tesisin günlük fiilî gider tutarını (EUR) giriniz.' });
    if (!(await b.db.query(`SELECT 1 FROM tesis_talebi WHERE dosya_ref = $1 AND kurulus_ref = $2`, [id, g.tesis])).rowCount) return y.code(400).send({ hata: 'Tesis bu dosyada kayıtlı değildir.' });
    const f = (await b.db.query(`SELECT kimlik, gonderim_zamani FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu = 'Gönderildi' ORDER BY gonderim_zamani DESC LIMIT 1`, [id])).rows[0];
    if (!f?.gonderim_zamani) return y.code(409).send({ hata: 'Onay beklenen (gönderilmiş) teklif yoktur.' });
    if ((await b.db.query(`SELECT 1 FROM dosya_bekleme_muhafaza WHERE teklif_ref = $1`, [f.kimlik])).rowCount) return y.code(409).send({ hata: 'Bu teklif için bekleme ve muhafaza kaydı vardır.' });
    const r = (await b.db.query(`INSERT INTO dosya_bekleme_muhafaza (dosya_ref, teklif_ref, kurulus_ref, gunluk_eur, baslangic, giren_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, f.kimlik, g.tesis, tutar, f.gonderim_zamani, o.kullanici])).rows[0].kimlik;
    await beklemeMuhafazaIsle(b.db);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bekleme ve Muhafaza Kaydı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { teklif: f.kimlik, gunlukEur: tutar }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r };
  });
}
