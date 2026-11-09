import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { belgeUret } from './belge_uret.js';
import { gunAy, metinGetir } from './metin.js';
import { gonderimIsleyici, sigortayaHazirla } from './sigorta_gonderim.js';
import { dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { kurumsalMuhatap } from './memnuniyet.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { dosyaErisimi } from './dosya.js';
import { DURAK_SN } from './sure.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const KK = 'Kalite Uzmanı (Kalite Kontrolör)'; const KM = 'Kalite Müdürü'; const GOREV = 'Dosya Performans Değerlendirmesi'; const ONAY = 'Dosya Performans Onayı';

/** YG-1469: kapanış metninde tekne türüne göre hazır ekler. */
export function tekneCekim(tur: string | null): { yi: string; Yi: string; yin: string; Yin: string; en: string } {
  if (tur === 'Motor Yat') return { yi: 'motor yatınızı', Yi: 'Motor yatınızı', yin: 'yatınızın', Yin: 'Yatınızın', en: 'motor yacht' };
  if (tur === 'Yelkenli Yat') return { yi: 'yelkenlinizi', Yi: 'Yelkenlinizi', yin: 'yelkenlinizin', Yin: 'Yelkenlinizin', en: 'sailing yacht' };
  return { yi: 'teknenizi', Yi: 'Teknenizi', yin: 'teknenizin', Yin: 'Teknenizin', en: 'boat' };
}
/** YG-1475, K-185, K-208: Teknik Kapalı anında kapanış bildirimi; özel kapanışlar ayrı metindir; vefatta gitmez. */
export function kapanisKodu(k: { cikis: string; neden: string | null; vefat: boolean; sigortali: boolean; oncelik: string }): string | null {
  if (k.vefat) return null;
  if (k.cikis === 'Teknik Kapalı') return !k.sigortali && k.oncelik === 'Planlı' ? 'BLD-16P' : 'BLD-16';
  if (/^Hükmi Tam Ziya/.test(k.neden ?? '')) return 'BLD-43';
  if (/^Tam Ziya/.test(k.neden ?? '')) return 'BLD-44';
  return null;
}

/** Onaylanan kapanışların yat sahibine bildirimi ve FR-KLT-011 görevi; her kapanış için bir kez. */
export async function kapanisSonrasiIsle(db: Pool, web: string, simdi = new Date()): Promise<{ dosya: string; kod: string }[]> {
  const { rows } = await db.query(
    `SELECT c.kimlik, c.cikis_statusu, c.kapanma_nedeni, d.kimlik dosya, d.dosya_no, d.yazisma_dili, d.dosya_niteligi, d.oncelik, d.vefat_isareti, d.musteri_turu, d.dosya_sorumlusu_ref, y.yat_adi, m.tekne_turu, t.telefon, t.eposta,
            (SELECT a.kullanici_ref FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.rol = 'Kalite Kontrolör' AND a.bitis_zamani IS NULL LIMIT 1) kk
       FROM kapanis_kontrolu c JOIN dosya d ON d.kimlik = c.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref LEFT JOIN dosya_tarafi t ON t.dosya_ref = d.kimlik AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif
      WHERE c.durum = 'Onaylandı' AND c.kapanis_zamani > $1::timestamptz - interval '7 days'`, [simdi]);
  const sonuc: { dosya: string; kod: string }[] = [];
  for (const r of rows) {
    const kod = kapanisKodu({ cikis: r.cikis_statusu, neden: r.kapanma_nedeni, vefat: r.vefat_isareti, sigortali: r.dosya_niteligi === 'Sigorta bağlantılı', oncelik: r.oncelik });
    if (kod && r.eposta !== undefined && (await birKez(db, 'kapanis_bildirim', r.kimlik))) {
      const muhatap = kod === 'BLD-16P' && r.musteri_turu === 'Kurumsal Müşteri' ? await kurumsalMuhatap(db, r.dosya) : null; // BLD-16P: kurumsal müşteriye e-posta
      const c = tekneCekim(r.tekne_turu); const ad = [r.tekne_turu, r.yat_adi].filter(Boolean).join(' ');
      await yatTarafinaYaz(db, { olay: `kapanis:${r.kimlik}`, kod, dil: dilKod(r.yazisma_dili), konu: `${r.dosya_no} Dosya Kapanışı`, telefon: muhatap ? null : r.telefon, eposta: muhatap ?? r.eposta, alanlar: { 'Tekne türü + Yat': ad, 'Boat type + Yacht': ad, 'Dosya No': r.dosya_no, 'File No': r.dosya_no, 'bağlantı': web, link: web, 'motor yatınızı': c.yi, 'Motor yatınızı': c.Yi, 'motor yacht': c.en, 'yatınızın': c.yin, 'Yatınızın': c.Yin, 'your yacht': `your ${c.en}` } });
      sonuc.push({ dosya: r.dosya, kod });
    }
    if (await birKez(db, 'rp_rap_004', r.dosya)) { await db.query(`INSERT INTO nihai_kapanis_ozeti (dosya_ref) VALUES ($1) ON CONFLICT DO NOTHING`, [r.dosya]); await ozetKartiAc(db, r.dosya, r.dosya_no, r.dosya_sorumlusu_ref); }
    if (r.cikis_statusu === 'Teknik Kapalı' && (await birKez(db, 'fr_klt_011', r.kimlik)))
      await kartAc(db, { tur: GOREV, kategori: 'gorev', baslik: `${r.dosya_no} · Dosya Performans Değerlendirmesi`, sonZaman: await isGunuSonu(db, simdi, 2), nesneTuru: 'Dosya', nesneKimligi: r.dosya, ...(r.kk ? { sahipKullanici: r.kk } : { sahipRol: await rolId(db, KK) }) });
  }
  return sonuc;
}

kapanisKaydet(ONAY, async (c, k, karar, yapan) => {
  if (karar === 'Onayla') await c.query(`UPDATE dosya_performans SET durum = 'Onaylandı', onaylayan_ref = $2, onay_zamani = now() WHERE dosya_ref = $1 AND durum = 'Onayda'`, [k.nesne_kimligi, yapan]);
  else if (['Reddet', 'Gerekçeyle İade Et'].includes(karar)) await c.query(`UPDATE dosya_performans SET durum = 'İade' WHERE dosya_ref = $1 AND durum = 'Onayda'`, [k.nesne_kimligi]);
});

/** YG-1541: Operasyon Yöneticisi kontrol eder, Operasyon Müdür Yardımcısı onaylar; onaysız özet BLD-77'ye eklenmez. */
const OZET = 'Nihai Kapanış Özeti'; const SIGORTA_KAPANIS = 'Kapanış E-postası';
async function ozetKartiAc(c: Db, dosya: string, no: string, ds: string | null) {
  await kartAc(c, { tur: OZET, baslik: `${no} · Nihai Kapanış Özeti`, hazirlayan: ds, zincir: [await rolId(c, 'Operasyon Yöneticisi'), await rolId(c, 'Operasyon Müdür Yardımcısı')], nesneTuru: 'Dosya', nesneKimligi: dosya });
}
kapanisKaydet(OZET, async (c, k, karar, yapan) => {
  const d = (await c.query(`SELECT d.kimlik, d.dosya_no, d.dosya_sorumlusu_ref, d.teslim_tarihi, s.sigorta_hasar_dosya_no, t.eposta FROM dosya d LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik LEFT JOIN dosya_tarafi t ON t.kimlik = s.sigorta_taraf_ref WHERE d.kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!d) return;
  if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') {
    await c.query(`UPDATE nihai_kapanis_ozeti SET durum = 'İade' WHERE dosya_ref = $1 AND durum = 'Onayda'`, [d.kimlik]);
    if (d.dosya_sorumlusu_ref) await bildir(c, { olay: `nihai-ozet-iade:${d.kimlik}:${Date.now()}`, kullanicilar: [d.dosya_sorumlusu_ref], baslik: `${d.dosya_no} · Nihai Kapanış Özeti İade Edildi` });
    return;
  }
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE nihai_kapanis_ozeti SET durum = 'Onaylandı', onaylayan_ref = $2, onay_zamani = now() WHERE dosya_ref = $1 AND durum = 'Onayda'`, [d.kimlik, yapan]);
  if (d.eposta && d.sigorta_hasar_dosya_no) await sigortayaHazirla(c, { dosya: d.kimlik, tur: SIGORTA_KAPANIS, nesne: d.kimlik, alici: d.eposta, konu: `${d.dosya_no} Dosya Kapanışı`, metin: await metinGetir(c, 'BLD-77', 'tr', { 'Dosya No': d.dosya_no, 'Hasar Dosya No': d.sigorta_hasar_dosya_no, tarih: gunAy(d.teslim_tarihi ?? new Date()) }) });
  else await belgeUret(c, { tur: OZET, nesne: d.kimlik, dosya: d.kimlik });
});
// K-241: ikinci teyitten sonra özet üretilir ve BLD-77 ekiyle gider.
gonderimIsleyici(SIGORTA_KAPANIS, async (c, r) => {
  await belgeUret(c, { tur: OZET, nesne: r.nesne_kimligi, dosya: r.dosya_ref!, gonder: { olay: `bld77:${r.nesne_kimligi}`, eposta: r.alici!, konu: r.konu, metin: r.metin!, sigortaTeyitli: true } });
  return { metin: r.metin ?? undefined, ekli: true };
});

export function kapanisEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = $2 LIMIT 1`, [k, r])).rowCount);
  const yetkiliKk = async (k: string, id: string) => {
    const a = (await b.db.query(`SELECT kullanici_ref k FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Kalite Kontrolör' AND bitis_zamani IS NULL LIMIT 1`, [id])).rows[0];
    return a ? a.k === k : rolVar(k, KK);
  };

  s.post('/dosya/:id/kapanis-ozeti/yeniden', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (!d || d.dosya_sorumlusu_ref !== o.kullanici) return yok(y);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      if (!(await c.query(`UPDATE nihai_kapanis_ozeti SET durum = 'Onayda' WHERE dosya_ref = $1 AND durum = 'İade'`, [id])).rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Özet iade durumunda değildir.' }); }
      await ozetKartiAc(c, id, d.dosya_no, o.kullanici);
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  // YG-785: hedef ve gerçekleşen süreler kayıttan gelir; müşteri kararı, erişim ve üçüncü taraf beklemesi düşülür.
  s.get('/dosya/:id/performans', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !((await dosyaErisimi(b.db, o.kullanici, id)) || (await rolVar(o.kullanici, KM)))) return yok(y);
    const d = (await b.db.query(`SELECT statu, arsiv_zamani, oncelik, tahmini_teslim_tarihi::text hedef, teslim_tarihi::text teslim FROM dosya WHERE kimlik = $1`, [id])).rows[0]; if (!d) return yok(y);
    const sureler = (await b.db.query(`SELECT s.tur, s.bitis + make_interval(secs => ${DURAK_SN}) hedef, s.tamamlanma FROM dosya_sure s WHERE s.dosya_ref = $1 AND s.tur IN ('İlk Yanıt', 'Keşif', 'Teklif') ORDER BY s.bitis`, [id])).rows;
    const ilk = (await b.db.query(`SELECT count(*)::int n, (count(*) FILTER (WHERE teknik_ret_sayisi = 0))::int k FROM is_emri WHERE dosya_ref = $1 AND EXISTS (SELECT 1 FROM kabul_kaydi x WHERE x.is_emri_ref = is_emri.kimlik)`, [id])).rows[0];
    const uyg = (await b.db.query(`SELECT sinif, count(*)::int n FROM uygunsuzluk WHERE dosya_ref = $1 AND statu <> 'Geçersiz' GROUP BY sinif ORDER BY sinif`, [id])).rows;
    const mem = (await b.db.query(`SELECT ortalama FROM memnuniyet_anketi WHERE dosya_ref = $1`, [id])).rows[0]?.ortalama ?? null;
    const kayit = (await b.db.query(`SELECT sapma_nedeni, denetim_sinifi, denetim_bulgulari, firma_karne_etkisi, durum FROM dosya_performans WHERE dosya_ref = $1`, [id])).rows[0] ?? null;
    const ozetDurum = (await b.db.query(`SELECT durum FROM nihai_kapanis_ozeti WHERE dosya_ref = $1`, [id])).rows[0]?.durum ?? null;
    const ds = (await b.db.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [id])).rows[0]?.r === o.kullanici;
    return { ...d, arsivlenebilir: ds && d.statu === 'Kapalı' && !d.arsiv_zamani, ozetDurum, ozetYenilenir: ds && ozetDurum === 'İade', kapali: ['Teknik Kapalı', 'Kapalı'].includes(d.statu), sureler, ilkSeferde: ilk, uygunsuzluk: uyg, memnuniyet: mem, kayit, duzenleyebilir: await yetkiliKk(o.kullanici, id) };
  });

  // YG-786: Kalite Kontrolör değerlendirir, Kalite Müdürü onaylar; dosya başına bir değerlendirme.
  s.post('/dosya/:id/performans', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sapma?: string; sinif?: string; bulgular?: string; etki?: string };
    if (!UUID.test(id) || !(await yetkiliKk(o.kullanici, id))) return yok(y);
    if (!g.sapma?.trim() || !g.bulgular?.trim() || !g.etki?.trim()) return y.code(400).send({ hata: 'Sapma nedeni, denetim bulguları ve firma karnesine etki zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`SELECT dosya_no, statu FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      if (!d || !['Teknik Kapalı', 'Kapalı'].includes(d.statu)) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Değerlendirme dosya kapanışında yapılır.' }); }
      const r = await c.query(`INSERT INTO dosya_performans (dosya_ref, sapma_nedeni, denetim_sinifi, denetim_bulgulari, firma_karne_etkisi, degerlendiren_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dosya_ref) DO UPDATE SET sapma_nedeni = $2, denetim_sinifi = $3, denetim_bulgulari = $4, firma_karne_etkisi = $5, degerlendiren_ref = $6, durum = 'Onayda' WHERE dosya_performans.durum = 'İade' RETURNING dosya_ref`, [id, g.sapma.trim(), g.sinif?.trim() || null, g.bulgular.trim(), g.etki.trim(), o.kullanici]);
      if (!r.rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu dosya için değerlendirme yapılmıştır.' }); }
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [GOREV, id]);
      await kartAc(c, { tur: ONAY, baslik: `${d.dosya_no} · Dosya Performans Değerlendirmesi`, hazirlayan: o.kullanici, zincir: [await rolId(c, KM)], sonZaman: await isGunuSonu(c, new Date(), 2), nesneTuru: 'Dosya', nesneKimligi: id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
