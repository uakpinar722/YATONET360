import type { FastifyInstance, FastifyReply } from 'fastify';
import { belgeUret } from './belge_uret.js';
import { izYaz } from './denetim.js';
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
    return { sonuclar: await liste('LST_ON_DEG_SONUCU'), oncelikler: (await liste('LST_ONCELIK')).map((x) => x.deger), mevcutOncelik: (await b.db.query(`SELECT oncelik FROM dosya WHERE kimlik = $1`, [id])).rows[0]?.oncelik, ekip, riskler: RISKLER, duzenleyebilir: ds, surumler: (await b.db.query(`SELECT surum, veriler, risk, olusturma_zamani FROM on_degerlendirme WHERE dosya_ref = $1 ORDER BY surum DESC`, [id])).rows };
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
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ön Değerlendirme Raporu', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { surum: n };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
