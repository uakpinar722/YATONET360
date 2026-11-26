import type { FastifyInstance } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { rolSahipleri } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const HAZIRLAR = ['Sistem Yöneticisi', 'Bilgi İşlem Müdürü'];
const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü';

/**
 * YG-1390, YG-1391: arayüz sabit metinleri onaylı çeviri kütüphanesinden gelir. Kütüphaneyi BT ve Firma Yönetimi Direktörlüğü yönetir:
 * öneriyi Sistem Yöneticisi veya Bilgi İşlem Müdürü yazar, Direktör onaylar; hukuki işaretli metnin İngilizcesini CEO onaylar.
 * Onaylanmamış karşılık kullanılmaz, ekran Türkçe kalır. Öneri değişince eski onaylı karşılık yeni onaya kadar kullanılmaya devam eder.
 */
export function arayuzMetniYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const sahip = async (k: string, roller: string[]) => { for (const r of roller) if ((await rolSahipleri(b.db, await rolId(b.db, r))).includes(k)) return true; return false; };

  s.get('/arayuz-metinleri', oturumlu, async () => {
    const l = (await b.db.query(`SELECT tr, en_onayli FROM arayuz_metni WHERE en_onayli IS NOT NULL`)).rows;
    return { en: Object.fromEntries(l.map((r) => [r.tr, r.en_onayli])) };
  });

  s.get('/arayuz-metni/yonetim', oturumlu, async (i, y) => {
    const o = i.oturum!; const hazir = await sahip(o.kullanici, HAZIRLAR); const btd = await sahip(o.kullanici, [BTD]); const ceo = await sahip(o.kullanici, ['CEO']);
    if (!hazir && !btd && !ceo) return y.code(403).send({ hata: 'Arayüz metni kütüphanesi Bilgi Teknolojileri ve Firma Yönetimi Direktörlüğüne açıktır.' });
    const l = (await b.db.query(`SELECT tr, en_oneri, hukuki, en_onayli, onay_zamani, (en_oneri IS NOT NULL AND en_oneri IS DISTINCT FROM en_onayli) bekliyor FROM arayuz_metni ORDER BY (en_oneri IS NOT NULL AND en_oneri IS DISTINCT FROM en_onayli) DESC, tr`)).rows;
    return { hazirlar: hazir, onaylar: btd, ceo, metinler: l };
  });

  s.post('/arayuz-metni/oneri', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tr?: string; en?: string; hukuki?: boolean };
    if (!(await sahip(o.kullanici, HAZIRLAR))) return y.code(403).send({ hata: 'Öneriyi Sistem Yöneticisi veya Bilgi İşlem Müdürü yazar.' });
    if (!g.tr?.trim() || !g.en?.trim()) return y.code(400).send({ hata: 'Türkçe metin ve İngilizce karşılığı zorunludur.' });
    await b.db.query(`INSERT INTO arayuz_metni (tr, en_oneri, hukuki) VALUES ($1, $2, $3) ON CONFLICT (tr) DO UPDATE SET en_oneri = EXCLUDED.en_oneri, hukuki = EXCLUDED.hukuki, guncelleme_zamani = now()`, [g.tr.trim(), g.en.trim(), Boolean(g.hukuki)]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Arayüz Metni Önerisi', nesneTuru: 'Arayüz Metni', nesneKimligi: g.tr.trim(), yeni: { en: g.en.trim(), hukuki: Boolean(g.hukuki) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  s.post('/arayuz-metni/onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const l = (((i.body ?? {}) as { metinler?: string[] }).metinler ?? []).filter((x) => typeof x === 'string');
    const btd = await sahip(o.kullanici, [BTD]); const ceo = await sahip(o.kullanici, ['CEO']);
    if (!btd && !ceo) return y.code(403).send({ hata: 'Onay Bilgi Teknolojileri ve Firma Yönetimi Direktöründedir; hukuki metnin İngilizcesini CEO onaylar.' });
    if (!l.length) return y.code(400).send({ hata: 'Onaylanacak metinleri seçiniz.' });
    const r = await b.db.query(`UPDATE arayuz_metni SET en_onayli = en_oneri, onaylayan_ref = $2, onay_zamani = now() WHERE tr = ANY($1) AND en_oneri IS NOT NULL AND ((NOT hukuki AND $3) OR (hukuki AND $4)) RETURNING tr`, [l, o.kullanici, btd, ceo]);
    const atlanan = l.length - (r.rowCount ?? 0);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Arayüz Metni Onayı', nesneTuru: 'Arayüz Metni', yeni: { metinler: r.rows.map((x) => x.tr) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { onaylanan: r.rowCount, uyari: atlanan ? `${atlanan} metin onaylanmadı: hukuki metnin İngilizcesini CEO, diğerlerini Direktör onaylar.` : undefined };
  });
}
