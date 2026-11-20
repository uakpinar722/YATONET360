import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { birKez } from './bildirim.js';
import { dosyaErisimi } from './dosya.js';
import { dilKod, yatTarafinaYaz } from './ihbar.js';
import { tutar } from './metin.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;

/**
 * YG-895: onay beklenirken oluşan bekleme ve muhafaza bedeli yalnız tesisin fiilî barınma/çekek/muhafaza gideridir; LGM bekleme ücreti uygulanmaz.
 * Sayım onay talebinin (teklifin) iletildiği andan başlar, serbest süre yoktur; her gün ayrı kalem olarak işlenir ve teklif sonuçlanınca durur.
 */
export async function beklemeMuhafazaIsle(db: Db, simdi = new Date(), web = ''): Promise<number> {
  const bugun = new Date(simdi.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  // Teklif artık onay beklemiyorsa (karar, süre dolumu, geri çekme) sayım kararın verildiği gün biter.
  await db.query(`UPDATE dosya_bekleme_muhafaza m SET bitis = coalesce(f.karar_zamani, $1::timestamptz) FROM fiyat_teklifi f WHERE f.kimlik = m.teklif_ref AND m.bitis IS NULL AND f.statu <> 'Gönderildi'`, [simdi]);
  const r = await db.query(`INSERT INTO bekleme_muhafaza_gunu (kayit_ref, gun, tutar_eur)
      SELECT m.kimlik, g::date, m.gunluk_eur FROM dosya_bekleme_muhafaza m
        CROSS JOIN LATERAL generate_series((m.baslangic AT TIME ZONE 'Europe/Istanbul')::date, least($1::date, coalesce((m.bitis AT TIME ZONE 'Europe/Istanbul')::date, $1::date)), interval '1 day') g
      ON CONFLICT DO NOTHING`, [bugun]);
  // BM-2 (BLD-100, CEO 21.11.2026): onay sürerken her pazartesi geçen haftanın özeti yat sahibine (portal ve e-posta) bir kez gider.
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const pzt = new Date(ist.getTime() - ((ist.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
  for (const x of (await db.query(`SELECT m.kimlik, d.dosya_no, d.yazisma_dili, t.telefon, t.eposta,
        (SELECT count(*)::int FROM bekleme_muhafaza_gunu g WHERE g.kayit_ref = m.kimlik AND g.gun >= $1::date - 7 AND g.gun < $1::date) hafta_gun, (SELECT coalesce(sum(tutar_eur), 0) FROM bekleme_muhafaza_gunu g WHERE g.kayit_ref = m.kimlik AND g.gun >= $1::date - 7 AND g.gun < $1::date) hafta_tutar,
        (SELECT count(*)::int FROM bekleme_muhafaza_gunu g WHERE g.kayit_ref = m.kimlik AND g.gun < $1::date) top_gun, (SELECT coalesce(sum(tutar_eur), 0) FROM bekleme_muhafaza_gunu g WHERE g.kayit_ref = m.kimlik AND g.gun < $1::date) top_tutar
      FROM dosya_bekleme_muhafaza m JOIN dosya d ON d.kimlik = m.dosya_ref JOIN dosya_tarafi t ON t.dosya_ref = m.dosya_ref AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif
      WHERE m.bitis IS NULL AND NOT d.vefat_isareti`, [pzt])).rows) {
    if (!x.hafta_gun || !(x.telefon || x.eposta) || !(await birKez(db, 'bekleme-muhafaza-hafta', `${x.kimlik}:${pzt}`))) continue;
    const dil = dilKod(x.yazisma_dili);
    await yatTarafinaYaz(db, { olay: `bm2:${x.kimlik}:${pzt}`, kod: 'BLD-100', dil, konu: `${x.dosya_no} Bekleme ve Muhafaza`, telefon: x.telefon, eposta: x.eposta,
      alanlar: { 'Dosya No': x.dosya_no, 'File No': x.dosya_no, gün: String(x.hafta_gun), days: String(x.hafta_gun), tutar: tutar(Number(x.hafta_tutar), dil), amount: tutar(Number(x.hafta_tutar), dil), 'toplam gün': String(x.top_gun), 'total days': String(x.top_gun), toplam: tutar(Number(x.top_tutar), dil), total: tutar(Number(x.top_tutar), dil), bağlantı: web, link: web } });
  }
  return r.rowCount ?? 0;
}

/** BM-1 (BLD-99, CEO 21.11.2026): yat sahibinin teklif onay ekranındaki günlük not; sayım sürmüyorsa yoktur. */
export async function beklemeNotu(db: Db, dosya: string): Promise<string | null> {
  const x = (await db.query(`SELECT m.gunluk_eur, d.yazisma_dili, (SELECT count(*)::int FROM bekleme_muhafaza_gunu g WHERE g.kayit_ref = m.kimlik) gun, (SELECT coalesce(sum(tutar_eur), 0) FROM bekleme_muhafaza_gunu g WHERE g.kayit_ref = m.kimlik) toplam
    FROM dosya_bekleme_muhafaza m JOIN dosya d ON d.kimlik = m.dosya_ref WHERE m.dosya_ref = $1 AND m.bitis IS NULL ORDER BY m.baslangic DESC LIMIT 1`, [dosya])).rows[0];
  if (!x) return null;
  const dil = dilKod(x.yazisma_dili); const { metinGetir } = await import('./metin.js');
  return metinGetir(db, 'BLD-99', dil, { tutar: tutar(Number(x.gunluk_eur), dil), amount: tutar(Number(x.gunluk_eur), dil), gün: String(x.gun), days: String(x.gun), toplam: tutar(Number(x.toplam), dil), total: tutar(Number(x.toplam), dil) });
}

export function beklemeMuhafazaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  s.get('/dosya/:id/bekleme-muhafaza', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    await beklemeMuhafazaIsle(b.db, new Date(), b.webAdresi);
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
    await beklemeMuhafazaIsle(b.db, new Date(), b.webAdresi);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bekleme ve Muhafaza Kaydı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { teklif: f.kimlik, gunlukEur: tutar }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r };
  });
}
