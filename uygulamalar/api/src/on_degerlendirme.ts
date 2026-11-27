import type { FastifyInstance, FastifyReply } from 'fastify';
import { belgeUret } from './belge_uret.js';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/** Cilt III §5.5 ilk risk taraması. */
export const RISKLER = ['Can Güvenliği ve Güvenli Erişim', 'Çevre Kirliliği veya Sızıntı', 'Batma, Devrilme, Yangın veya İkincil Hasar', 'Kanıtı Değiştirebilecek İşlem', 'Acil Müdahale İçin Görev, Yetki ve Koruyucu Donanım'];
const CEVAP = ['Hayır', 'Bilinmiyor', 'Kısmen', 'Evet'];
const ALANLAR = ['sonBilgi', 'kaynaklar', 'yeterlilik', 'yeterlilikGerekcesi', 'uzmanliklar', 'sonuc', 'yontem', 'yontemGerekcesi', 'oncelikTeyidi', 'kapsam', 'kronoloji', 'olgular', 'beyanlar', 'etkilenen', 'sonrakiAdim', 'acikKonular', 'oncelikGerekcesi'] as const;
const ISTEGE = new Set(['etkilenen', 'yontemGerekcesi', 'oncelikGerekcesi']);
/** YG-038: sonuç LST_ON_DEG_SONUCU'dan; bekleme gerektiren sonuçta neden, sorumlu ve hedef tarih zorunludur. */
const BEKLEME: Record<string, string> = { 'Uzman Görüşü Gerekli': 'Uzman Görüşü', 'Bilgi Tamamlama Gerekli': 'Bilgi' };
/** YG-038, V-1116: raporun kalite kontrolünü dosyanın Operasyon Yöneticisi yapar (hazırlayan kendi raporunu kontrol edemez). */
const KONTROLCU = 'Operasyon Yöneticisi'; const KONTROL_KARTI = 'Ön Değerlendirme Kalite Kontrolü';

/** YG-651: iç rapor; yeni bilgi önceki sürümü değiştirmez, yeni sürüm açılır (Cilt III §5.11). */
export function onDegerlendirmeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  s.get('/dosya/:id/on-degerlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const ds = (await b.db.query(`SELECT dosya_sorumlusu_ref r FROM dosya WHERE kimlik = $1`, [id])).rows[0]?.r === o.kullanici;
    const liste = async (k: string) => (await b.db.query(`SELECT deger, aciklama FROM deger_listesi WHERE liste_kodu = $1 ORDER BY sira`, [k])).rows;
    const ekip = ds ? (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM dosya_ekibi_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.dosya_ref = $1 AND a.bitis_zamani IS NULL ORDER BY h.ad_soyad`, [id])).rows : [];
    return { sonuclar: await liste('LST_ON_DEG_SONUCU'), oncelikler: (await liste('LST_ONCELIK')).map((x) => x.deger), mevcutOncelik: (await b.db.query(`SELECT oncelik FROM dosya WHERE kimlik = $1`, [id])).rows[0]?.oncelik, ekip, riskler: RISKLER, duzenleyebilir: ds, surumler: (await b.db.query(`SELECT surum, veriler, risk, olusturma_zamani, kalite_kontrol_sonucu, kalite_kontrol_notu, onayli FROM on_degerlendirme WHERE dosya_ref = $1 ORDER BY surum DESC`, [id])).rows,
      kontrolEdebilir: Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi a JOIN on_degerlendirme r ON r.dosya_ref = a.dosya_ref WHERE a.dosya_ref = $1 AND a.kullanici_ref = $2 AND a.rol = $3 AND a.bitis_zamani IS NULL AND r.hazirlayan_ref <> $2 AND r.kalite_kontrol_sonucu IS NULL AND r.surum = (SELECT max(surum) FROM on_degerlendirme WHERE dosya_ref = $1)`, [id, o.kullanici, KONTROLCU])).rowCount) };
  });

  s.post('/dosya/:id/on-degerlendirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as Record<string, unknown>; const risk = (g.risk ?? {}) as Record<string, string>;
    if (!UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT dosya_sorumlusu_ref r, oncelik FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (!d || d.r !== o.kullanici) return yok(y);
    const lst = async (k: string, v: unknown) => Boolean((await b.db.query(`SELECT 1 FROM deger_listesi WHERE liste_kodu = $1 AND deger = $2`, [k, String(v ?? '')])).rowCount);
    if (g.sonuc && !(await lst('LST_ON_DEG_SONUCU', g.sonuc))) return y.code(400).send({ hata: 'Ön değerlendirme sonucunu listeden seçiniz.' });
    if (g.oncelikTeyidi && !(await lst('LST_ONCELIK', g.oncelikTeyidi))) return y.code(400).send({ hata: 'Öncelik teyidini listeden seçiniz.' });
    if (g.sonuc === 'Acil Müdahale Gerekli' && g.oncelikTeyidi !== 'Kritik') return y.code(400).send({ hata: 'Acil Müdahale Gerekli sonucunda öncelik Kritik olmalıdır.' });
    if (g.oncelikTeyidi && g.oncelikTeyidi !== d.oncelik && !String(g.oncelikGerekcesi ?? '').trim()) return y.code(400).send({ hata: 'Öncelik değişikliğinin gerekçesini yazınız.' });
    const bekleme = BEKLEME[String(g.sonuc ?? '')]; const bk = (g.bekleme ?? {}) as { sorumlu?: string; hedefTarih?: string };
    if (bekleme && (!bk.sorumlu || !(await dosyaErisimi(b.db, bk.sorumlu, id)) || !bk.hedefTarih || !/^\d{4}-\d{2}-\d{2}$/.test(bk.hedefTarih) || bk.hedefTarih <= new Date().toISOString().slice(0, 10))) return y.code(400).send({ hata: 'Bu sonuçta Beklemede işareti için sorumlu ve ileri bir hedef tarih zorunludur.' });
    const eksik = ALANLAR.filter((a) => !ISTEGE.has(a) && !String(g[a] ?? '').trim());
    if (eksik.length || RISKLER.some((r) => !CEVAP.includes(risk[r] ?? ''))) return y.code(400).send({ hata: 'Tüm zorunlu alanları ve risk taramasını doldurunuz.', eksik });
    const veriler = Object.fromEntries(ALANLAR.map((a) => [a, String(g[a] ?? '').trim()]));
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT 1 FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id]);
      const n = Number((await c.query(`SELECT coalesce(max(surum), 0) + 1 n FROM on_degerlendirme WHERE dosya_ref = $1`, [id])).rows[0].n);
      const r = (await c.query(`INSERT INTO on_degerlendirme (dosya_ref, surum, veriler, risk, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, n, JSON.stringify(veriler), JSON.stringify(risk), o.kullanici])).rows[0];
      await belgeUret(c, { tur: 'Ön Değerlendirme Raporu', nesne: r.kimlik, dosya: id });
      if (bekleme && !(await c.query(`SELECT 1 FROM beklemede_isareti WHERE dosya_ref = $1 AND neden = $2 AND kaldirilma_zamani IS NULL`, [id, bekleme])).rowCount) {
        const durur = !(await c.query(`SELECT aciklama FROM deger_listesi WHERE liste_kodu = 'LST_BEKLEME_NEDENI' AND deger = $1`, [bekleme])).rows[0]?.aciklama?.includes('sayaç işler');
        await c.query(`INSERT INTO beklemede_isareti (dosya_ref, kayit_turu, kayit_referansi, neden, sorumlu_ref, hedef_tarih, durum_mesaji, sayac_durur, olusturan_ref) VALUES ($1,'Ön Değerlendirme',$2,$3,$4,$5,$6,$7,$8)`, [id, r.kimlik, bekleme, bk.sorumlu, bk.hedefTarih, String(g.sonuc), durur, o.kullanici]);
      }
      // YG-038: yeni sürüm kalite kontrolüne gider; önceki sürümün bekleyen kontrol görevi kapanır.
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [KONTROL_KARTI, id]);
      const oy = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = $2 AND bitis_zamani IS NULL AND kullanici_ref <> $3 LIMIT 1`, [id, KONTROLCU, o.kullanici])).rows[0]?.kullanici_ref;
      if (oy) await kartAc(c, { tur: KONTROL_KARTI, kategori: 'islem', baslik: `Ön Değerlendirme Raporu Rev.${n} · Kalite Kontrolü`, ozet: 'Raporu kontrol edip Uygun veya Uygun Değil olarak işaretleyiniz.', sahipKullanici: oy, nesneTuru: 'Dosya', nesneKimligi: id });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ön Değerlendirme Raporu', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { surum: n };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  // YG-038: kalite kontrolü olumlu ise rapor Onaylı olur; olumsuzsa gerekçe zorunludur ve rapor Onaylı işaretlenemez (düzeltme yeni sürümle yapılır).
  s.post('/dosya/:id/on-degerlendirme/:surum/kalite-kontrol', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id, surum } = i.params as { id: string; surum: string }; const g = (i.body ?? {}) as { sonuc?: string; not?: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !/^\d+$/.test(surum)) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = $3 AND bitis_zamani IS NULL`, [id, o.kullanici, KONTROLCU])).rowCount) return yok(y);
    const r = (await b.db.query(`SELECT kimlik, hazirlayan_ref, kalite_kontrol_sonucu, surum = (SELECT max(surum) FROM on_degerlendirme WHERE dosya_ref = $1) AS son FROM on_degerlendirme WHERE dosya_ref = $1 AND surum = $2`, [id, Number(surum)])).rows[0];
    if (!r) return yok(y);
    if (r.hazirlayan_ref === o.kullanici) return y.code(403).send({ hata: 'Hazırladığınız raporu kontrol edemezsiniz.' });
    if (!r.son || r.kalite_kontrol_sonucu) return y.code(409).send({ hata: 'Yalnız son sürümün kontrolü bir kez yapılır.' });
    if (!['Uygun', 'Uygun Değil'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Kontrol sonucunu seçiniz.' });
    if (g.sonuc === 'Uygun Değil' && !g.not?.trim()) return y.code(400).send({ hata: 'Uygun bulunmama gerekçesini yazınız.' });
    await b.db.query(`UPDATE on_degerlendirme SET kalite_kontrol_sonucu = $2, kalite_kontrol_notu = $3, kalite_kontrol_ref = $4, kalite_kontrol_zamani = now(), onayli = $5 WHERE kimlik = $1`, [r.kimlik, g.sonuc, g.not?.trim() || null, o.kullanici, g.sonuc === 'Uygun']);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [KONTROL_KARTI, id]);
    if (g.sonuc === 'Uygun Değil') await kartAc(b.db, { tur: 'Ön Değerlendirme Düzeltmesi', kategori: 'islem', baslik: `Ön Değerlendirme Raporu Rev.${surum} · Düzeltme`, ozet: g.not!.trim().slice(0, 300), sahipKullanici: r.hazirlayan_ref, nesneTuru: 'Dosya', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ön Değerlendirme Kalite Kontrolü', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { surum: Number(surum), sonuc: g.sonuc }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { onayli: g.sonuc === 'Uygun' };
  });
}
