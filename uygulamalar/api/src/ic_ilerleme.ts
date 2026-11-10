import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const TUR = 'İç İlerleme Raporu';
const ONAY = `('Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü')`;
/** YG-787: Yüksek (ve Kritik) her iş günü, Normal Pazartesi ve Perşembe, Planlı Pazartesi. */
export const donemGunu = (oncelik: string, gun: number) => (gun === 0 || gun === 6 ? false : oncelik === 'Yüksek' || oncelik === 'Kritik' ? true : oncelik === 'Normal' ? gun === 1 || gun === 4 : gun === 1);
const yuzde = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** Fiziksel ilerleme iş emri kalemlerinin gerçekleşen miktarından; finansal ilerleme hakediş ve faturalamadan ayrı hesaplanır. */
export async function ilerlemeOzeti(db: Db, dosya: string) {
  const f = (await db.query(`SELECT coalesce(sum(k.miktar), 0) plan, coalesce(sum(least(coalesce(k.gerceklesen_miktar, 0), k.miktar)), 0) gercek FROM is_emri_kalemi k JOIN is_emri e ON e.kimlik = k.is_emri_ref WHERE e.dosya_ref = $1 AND e.statu NOT IN ('İptal', 'Yerine Geçti', 'Taslak')`, [dosya])).rows[0];
  const h = (await db.query(`SELECT coalesce(sum(e.firma_bedeli_eur), 0) bedel, coalesce((SELECT sum(bu_donem_brut) FROM hakedis x WHERE x.dosya_ref = $1 AND x.statu <> 'Reddedildi'), 0) hakedis FROM is_emri e WHERE e.dosya_ref = $1 AND e.statu NOT IN ('İptal', 'Yerine Geçti', 'Taslak')`, [dosya])).rows[0];
  const m = (await db.query(`SELECT coalesce((SELECT sum(k.tutar_eur) FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi t ON t.kimlik = k.teklif_ref WHERE t.dosya_ref = $1 AND k.onay_durumu = 'Onaylandı' AND t.statu = 'Karar' AND t.karar IN ${ONAY}), 0) satis, coalesce((SELECT sum(kdv_haric_eur) FROM musteri_faturasi WHERE dosya_ref = $1 AND durum IN ('Faturalandı', 'Kısmi Tahsil', 'Tahsil Edildi')), 0) fatura`, [dosya])).rows[0];
  return { fiziksel: yuzde(Number(f.gercek), Number(f.plan)), hakedis: yuzde(Number(h.hakedis), Number(h.bedel)), faturalama: yuzde(Number(m.fatura), Number(m.satis)) };
}

/** Uygulama aşamasındaki dosyada dönem günü gelince Dosya Sorumlusuna gün sonu süreli iç ilerleme raporu görevi düşer. */
export async function icIlerlemeGorevi(db: Pool, simdi = new Date()): Promise<number> {
  const gun = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Europe/Istanbul' }).format(simdi); const g = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(gun);
  const tarih = simdi.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); let n = 0;
  for (const d of (await db.query(`SELECT kimlik, dosya_no, oncelik, dosya_sorumlusu_ref FROM dosya WHERE statu = 'Aktif' AND asama = 'Uygulama' AND dosya_sorumlusu_ref IS NOT NULL`)).rows) {
    if (!donemGunu(d.oncelik, g) || !(await birKez(db, 'ic-ilerleme', `${d.kimlik}:${tarih}`))) continue;
    await kartAc(db, { tur: TUR, kategori: 'gorev', baslik: `${d.dosya_no} · İç İlerleme Raporu ${tarih.split('-').reverse().join('.')}`, ozet: 'Fiziksel ve finansal ilerlemeyi ayrı ayrı değerlendirip raporu kaydediniz.', sahipKullanici: d.dosya_sorumlusu_ref, sonZaman: new Date(`${tarih}T15:00:00Z`), nesneTuru: TUR, nesneKimligi: `${d.kimlik}:${tarih}` }); n++;
  }
  return n;
}

export function icIlerlemeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const ekipte = async (d: string, k: string) => (await b.db.query(`SELECT rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL`, [d, k])).rows.map((r) => r.rol as string);
  s.get('/dosya/:id/ic-ilerleme', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || i.oturum!.grup !== 'LGM İç Rolü' || !(await ekipte(id, i.oturum!.kullanici)).length) return yok(y);
    return { ozet: await ilerlemeOzeti(b.db, id), raporlar: (await b.db.query(`SELECT r.tarih::text, r.fiziksel, r.hakedis, r.faturalama, r.degerlendirme, h.ad_soyad FROM ic_ilerleme_raporu r JOIN kullanici_hesabi h ON h.kimlik = r.hazirlayan_ref WHERE r.dosya_ref = $1 ORDER BY r.tarih DESC LIMIT 30`, [id])).rows };
  });
  s.post('/dosya/:id/ic-ilerleme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { degerlendirme?: string };
    if (!UUID.test(id) || !(await ekipte(id, o.kullanici)).some((r) => r === 'Dosya Sorumlusu' || r === 'Yedek Sorumlu')) return yok(y);
    if (!g.degerlendirme?.trim()) return y.code(400).send({ hata: 'Değerlendirme zorunludur.' });
    const oz = await ilerlemeOzeti(b.db, id); const tarih = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    await b.db.query(`INSERT INTO ic_ilerleme_raporu (dosya_ref, tarih, fiziksel, hakedis, faturalama, degerlendirme, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (dosya_ref, tarih) DO UPDATE SET fiziksel = EXCLUDED.fiziksel, hakedis = EXCLUDED.hakedis, faturalama = EXCLUDED.faturalama, degerlendirme = EXCLUDED.degerlendirme, hazirlayan_ref = EXCLUDED.hazirlayan_ref, zaman = now()`, [id, tarih, oz.fiziksel, oz.hakedis, oz.faturalama, g.degerlendirme.trim(), o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi LIKE $2 AND durum = 'Bekliyor'`, [TUR, `${id}:%`]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: TUR, nesneTuru: 'Dosya', nesneKimligi: id, yeni: oz, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true, ...oz };
  });
}
