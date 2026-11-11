import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const BT = ['Bilgi İşlem Müdürü', 'Bilgi İşlem Müdür Yardımcısı', 'Sistem Yöneticisi', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
const GUVENLIK = ['Bilgi İşlem Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
/** YG-1287: başarı ölçütleri; sayısal olanlar "en çok", diğerleri "Evet" beklenir. */
export const OLCUTLER: { kod: string; ad: string; tur: 'dakika' | 'saat' | 'evet' }[] = [
  { kod: 'kurtarmaDk', ad: 'Kurtarma süresi (dk)', tur: 'dakika' }, { kod: 'veriKaybiDk', ad: 'Veri kaybı (dk)', tur: 'dakika' }, { kod: 'rolKatilimi', ad: 'Rol katılımı', tur: 'evet' },
  { kod: 'iletisimDk', ad: 'İletişim süresi (dk)', tur: 'dakika' }, { kod: 'belgeErisimi', ad: 'Belge erişimi', tur: 'evet' }, { kod: 'yetki', ad: 'Yetki tutarlılığı', tur: 'evet' },
  { kod: 'entegrasyon', ad: 'Entegrasyonların çalışması', tur: 'evet' }, { kod: 'alternatifKayit', ad: 'Alternatif kayıt ve sonradan aktarım', tur: 'evet' }, { kod: 'normallesmeSaat', ad: 'Normalleşme süresi (saat)', tur: 'saat' },
];
const tutar = (o: (typeof OLCUTLER)[number], hedef: unknown, g: unknown) => (o.tur === 'evet' ? g === true : Number(g) <= Number(hedef));

/** YG-1280: erişim süresi biten alt ortam kopyası için Sistem Yöneticisine imha görevi. */
export async function altOrtamIsle(db: Pool): Promise<number> {
  let n = 0;
  for (const k of (await db.query(`SELECT kimlik, ortam, amac FROM alt_ortam_kopyasi WHERE durum = 'Aktif' AND erisim_bitis < current_date AND NOT EXISTS (SELECT 1 FROM is_karti WHERE tur = 'Alt Ortam Verisi İmhası' AND nesne_kimligi = alt_ortam_kopyasi.kimlik::text)`)).rows) {
    await kartAc(db, { tur: 'Alt Ortam Verisi İmhası', kategori: 'gorev', baslik: `${k.ortam} ortamı · ${k.amac} · Güvenli İmha`, ozet: 'Erişim süresi doldu; veriyi güvenli imha edip kanıtını kaydediniz.', oncelik: 'Yüksek', sahipRol: await rolId(db, 'Sistem Yöneticisi'), sonZaman: new Date(Date.now() + 24 * 3_600_000), nesneTuru: 'Alt Ortam Kopyası', nesneKimligi: k.kimlik }); n++;
  }
  return n;
}

export function sureklilikOrtamYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);
  const iz = (i: { oturum?: { kullanici: string; oturum: string }; ip: string; id: string }, eylem: string, tur: string, id: string, gerekce?: string) => izYaz(b.db, { aktor: i.oturum!.kullanici, oturum: i.oturum!.oturum, eylem, nesneTuru: tur, nesneKimligi: id, gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });

  s.get('/sureklilik-ortam', oturumlu, async (i, y) => {
    const r = await roller(i.oturum!.kullanici); const sahip = (await b.db.query(`SELECT 1 FROM alt_ortam_kopyasi WHERE veri_sahibi_rol = ANY($1::text[]) LIMIT 1`, [r])).rowCount;
    if (!r.some((x) => BT.includes(x)) && !sahip) return yok(y);
    return {
      olcutler: OLCUTLER,
      testler: (await b.db.query(`SELECT t.kimlik, t.ad, t.senaryo, t.plan_tarihi::text, t.olcutler, t.sonuclar, t.durum, (SELECT json_agg(json_build_object('kimlik', s.kimlik, 'olcut', s.olcut, 'hedef', s.hedef, 'gerceklesen', s.gerceklesen, 'durum', s.durum, 'hedefTarih', s.hedef_tarih)) FROM sureklilik_sapmasi s WHERE s.test_ref = t.kimlik) sapmalar FROM sureklilik_testi t ORDER BY t.plan_tarihi DESC LIMIT 50`)).rows,
      kopyalar: (await b.db.query(`SELECT k.kimlik, k.ortam, k.amac, k.veri_kapsami, k.veri_sahibi_rol, k.maskeleme_yontemi, k.erisim_bitis::text, k.durum, k.veri_sahibi_onay_ref IS NOT NULL sahip_onayi, k.guvenlik_onay_ref IS NOT NULL guvenlik_onayi, k.imha_zamani FROM alt_ortam_kopyasi k ORDER BY k.zaman DESC LIMIT 50`)).rows,
      roller: r,
    };
  });
  // YG-1287: ölçütler testten önce; plan tarihi bugün veya ileride olmalı.
  s.post('/sureklilik-testi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await roller(o.kullanici)).some((x) => BT.includes(x))) return yok(y);
    const g = (i.body ?? {}) as { ad?: string; senaryo?: string; planTarihi?: string; olcutler?: Record<string, unknown>; yenidenSinanan?: string };
    if (!g.ad?.trim() || !g.senaryo?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(g.planTarihi ?? '') || g.planTarihi! < new Date().toISOString().slice(0, 10)) return y.code(400).send({ hata: 'Test adı, senaryo ve bugün veya sonraki plan tarihi zorunludur.' });
    const eksik = OLCUTLER.filter((x) => x.tur !== 'evet' && !(Number(g.olcutler?.[x.kod]) > 0)); if (eksik.length) return y.code(400).send({ hata: `Başarı ölçütleri testten önce tanımlanmalıdır: ${eksik.map((x) => x.ad).join(', ')}` });
    const ol = Object.fromEntries(OLCUTLER.map((x) => [x.kod, x.tur === 'evet' ? true : Number(g.olcutler![x.kod])]));
    const r = (await b.db.query(`INSERT INTO sureklilik_testi (ad, senaryo, plan_tarihi, olcutler, yeniden_sinanan_ref, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [g.ad.trim(), g.senaryo.trim(), g.planTarihi, ol, g.yenidenSinanan && UUID.test(g.yenidenSinanan) ? g.yenidenSinanan : null, o.kullanici])).rows[0].kimlik;
    await iz(i, 'Süreklilik Testi Planı', 'Süreklilik Testi', r); return { kimlik: r };
  });
  s.post('/sureklilik-testi/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await roller(o.kullanici)).some((x) => BT.includes(x))) return yok(y);
    const g = (i.body ?? {}) as { sonuclar?: Record<string, unknown>; sorumlu?: string; hedefTarih?: string };
    const t = (await b.db.query(`SELECT * FROM sureklilik_testi WHERE kimlik = $1 AND durum = 'Planlandı'`, [id])).rows[0]; if (!t) return y.code(409).send({ hata: 'Test planlı değildir.' });
    if (!g.sonuclar || OLCUTLER.some((x) => g.sonuclar![x.kod] === undefined)) return y.code(400).send({ hata: 'Her ölçütün sonucu girilmelidir.' });
    const sapma = OLCUTLER.filter((x) => !tutar(x, t.olcutler[x.kod], g.sonuclar![x.kod]));
    if (sapma.length && !/^\d{4}-\d{2}-\d{2}$/.test(g.hedefTarih ?? '')) return y.code(400).send({ hata: 'Sapma var; hedef tarih zorunludur.' });
    const sorumlu = g.sorumlu || o.kullanici; // sorumlu verilmezse kaydeden
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE sureklilik_testi SET sonuclar = $2, durum = 'Tamamlandı', sonuc_zamani = now() WHERE kimlik = $1`, [id, g.sonuclar]);
      for (const x of sapma) {
        const sp = (await c.query(`INSERT INTO sureklilik_sapmasi (test_ref, olcut, hedef, gerceklesen, sorumlu_ref, hedef_tarih) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, x.kod, String(t.olcutler[x.kod]), String(g.sonuclar[x.kod]), sorumlu, g.hedefTarih])).rows[0].kimlik;
        await kartAc(c, { tur: 'Süreklilik Sapması', kategori: 'gorev', baslik: `${t.ad} · ${x.ad} sapması`, ozet: `Hedef ${t.olcutler[x.kod]}, gerçekleşen ${g.sonuclar[x.kod]}. Düzeltip yeniden sınayınız.`, sahipKullanici: sorumlu, sonZaman: new Date(`${g.hedefTarih}T15:00:00Z`), nesneTuru: 'Süreklilik Sapması', nesneKimligi: sp });
      }
      // Yeniden sınamada tutan ölçütlerin önceki sapmaları kapanır.
      if (t.yeniden_sinanan_ref) for (const x of OLCUTLER.filter((z) => !sapma.includes(z))) {
        const k = (await c.query(`UPDATE sureklilik_sapmasi SET durum = 'Kapalı', kapatan_test_ref = $3 WHERE test_ref = $1 AND olcut = $2 AND durum = 'Açık' RETURNING kimlik`, [t.yeniden_sinanan_ref, x.kod, id])).rows;
        for (const r of k) await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Süreklilik Sapması' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [r.kimlik]);
      }
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    await iz(i, 'Süreklilik Testi Sonucu', 'Süreklilik Testi', id); return { sapma: sapma.map((x) => x.kod) };
  });

  // YG-1119, YG-1280: talep; maskeleme geri döndürülemez, dış bağlantı kapalı, erişim süresi en çok 30 gün.
  s.post('/alt-ortam-kopyasi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await roller(o.kullanici)).some((x) => BT.includes(x))) return yok(y);
    const g = (i.body ?? {}) as { ortam?: string; amac?: string; veriKapsami?: string; veriSahibiRol?: string; maskelemeYontemi?: string; geriDondurulemez?: boolean; disBaglantiKapali?: boolean; erisimBitis?: string };
    if (!['Test', 'Eğitim', 'Geliştirme'].includes(g.ortam ?? '') || !g.amac?.trim() || !g.veriKapsami?.trim() || !g.veriSahibiRol?.trim() || !g.maskelemeYontemi?.trim()) return y.code(400).send({ hata: 'Ortam, amaç, veri kapsamı, veri sahibi ve maskeleme yöntemi zorunludur.' });
    if (g.geriDondurulemez !== true) return y.code(400).send({ hata: 'Üretim verisi alt ortama yalnız geri döndürülemez maskelemeyle kopyalanır.' });
    if (g.disBaglantiKapali !== true) return y.code(400).send({ hata: 'Alt ortamın dış bağlantıları (e-posta, SMS, entegrasyonlar) kapalı olmalıdır.' });
    const bitis = g.erisimBitis ?? ''; const azami = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bitis) || bitis > azami || bitis < new Date().toISOString().slice(0, 10)) return y.code(400).send({ hata: 'Erişim bitişi bugünden itibaren en çok 30 gün olmalıdır.' });
    if (!(await b.db.query(`SELECT 1 FROM veri_kumesi WHERE sahip_rol = $1`, [g.veriSahibiRol.trim()])).rowCount) return y.code(400).send({ hata: 'Veri sahibi, bir veri kümesinin sahibi olan rol olmalıdır.' });
    const r = (await b.db.query(`INSERT INTO alt_ortam_kopyasi (ortam, amac, veri_kapsami, veri_sahibi_rol, maskeleme, maskeleme_yontemi, dis_baglanti_kapali, erisim_bitis, talep_eden_ref) VALUES ($1,$2,$3,$4,'Geri Döndürülemez',$5,true,$6,$7) RETURNING kimlik`, [g.ortam, g.amac.trim(), g.veriKapsami.trim(), g.veriSahibiRol.trim(), g.maskelemeYontemi.trim(), bitis, o.kullanici])).rows[0].kimlik;
    for (const rol of [g.veriSahibiRol.trim(), 'Bilgi İşlem Müdürü']) await kartAc(b.db, { tur: 'Alt Ortam Veri Onayı', kategori: 'gorev', baslik: `${g.ortam} ortamına üretim verisi · ${g.amac.trim()}`, ozet: `${g.veriKapsami.trim()} · ${g.maskelemeYontemi.trim()} · ${bitis} tarihine kadar`, sahipRol: await rolId(b.db, rol), nesneTuru: 'Alt Ortam Kopyası', nesneKimligi: r });
    await iz(i, 'Alt Ortam Veri Kopyası Talebi', 'Alt Ortam Kopyası', r); return { kimlik: r };
  });
  // Veri sahibi ve güvenlik (Bilgi İşlem Müdürü / BT ve FY Direktörü) ayrı ayrı onaylar; talep eden onaylayamaz.
  s.post('/alt-ortam-kopyasi/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id)) return yok(y);
    const g = (i.body ?? {}) as { onay?: boolean; gerekce?: string }; const r = await roller(o.kullanici);
    const k = (await b.db.query(`SELECT * FROM alt_ortam_kopyasi WHERE kimlik = $1 AND durum = 'Onayda'`, [id])).rows[0]; if (!k) return yok(y);
    if (k.talep_eden_ref === o.kullanici) return y.code(403).send({ hata: 'Talep eden kendi talebini onaylayamaz.' });
    const alan = r.includes(k.veri_sahibi_rol) && !k.veri_sahibi_onay_ref ? 'veri_sahibi_onay_ref' : r.some((x) => GUVENLIK.includes(x)) && !k.guvenlik_onay_ref ? 'guvenlik_onay_ref' : null;
    if (!alan) return yok(y);
    if (!g.onay) { if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Ret gerekçesi zorunludur.' }); await b.db.query(`UPDATE alt_ortam_kopyasi SET durum = 'Reddedildi' WHERE kimlik = $1`, [id]); await iz(i, 'Alt Ortam Veri Kopyası Reddedildi', 'Alt Ortam Kopyası', id, g.gerekce); return { durum: 'Reddedildi' }; }
    const u = (await b.db.query(`UPDATE alt_ortam_kopyasi SET ${alan} = $2, durum = CASE WHEN ${alan === 'veri_sahibi_onay_ref' ? 'guvenlik_onay_ref' : 'veri_sahibi_onay_ref'} IS NOT NULL THEN 'Aktif' ELSE durum END WHERE kimlik = $1 RETURNING durum`, [id, o.kullanici])).rows[0];
    if (u.durum === 'Aktif') await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Alt Ortam Veri Onayı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await iz(i, 'Alt Ortam Veri Kopyası Onayı', 'Alt Ortam Kopyası', id); return { durum: u.durum };
  });
  s.post('/alt-ortam-kopyasi/:id/imha', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await roller(o.kullanici)).some((x) => ['Sistem Yöneticisi', 'Bilgi İşlem Müdürü'].includes(x))) return yok(y);
    const g = (i.body ?? {}) as { kanit?: string }; if (!g.kanit?.trim()) return y.code(400).send({ hata: 'İmha kanıtı zorunludur.' });
    const r = await b.db.query(`UPDATE alt_ortam_kopyasi SET durum = 'İmha Edildi', imha_zamani = now(), imha_kaniti = $2 WHERE kimlik = $1 AND durum = 'Aktif' RETURNING veri_sahibi_rol`, [id, g.kanit.trim()]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Yalnız aktif kopya imha edilir.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Alt Ortam Verisi İmhası' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    const sahip = (await b.db.query(`SELECT a.kullanici_ref FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE x.rol_adi = $1 AND a.atama_durumu = 'Aktif'`, [r.rows[0].veri_sahibi_rol])).rows.map((x) => x.kullanici_ref as string);
    if (sahip.length) await bildir(b.db, { olay: `alt-ortam-imha:${id}`, kullanicilar: sahip, baslik: 'Alt ortamdaki verinin imhası tamamlandı', ozet: g.kanit.trim().slice(0, 150) });
    await iz(i, 'Alt Ortam Verisi İmha Edildi', 'Alt Ortam Kopyası', id, g.kanit); return { tamam: true };
  });
}
