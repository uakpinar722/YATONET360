import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kapanisKaydet } from './kapanis.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

/**
 * YG-1387, HG-1 (V-1126): onay gerektiren adımın hukuki gerekçesi ve ilgili belge bölümü ekranda yalnız "Neden?" bağlantısında gösterilir.
 * Metni iş türü (kart türü) başına Hukuk ve Uyum hazırlar, CEO onaylar; onaylanmamış metin gösterilmez. Her değişiklik yeni sürümdür.
 */
const HAZIRLAR = ['Hukuk ve Uyum Direktörü', 'Hukuk ve Uyum Uzmanı'];
const KART = 'Neden Metni Onayı';

kapanisKaydet(KART, async (c, k, karar, yapan) => {
  const [tur, surum] = String(k.nesne_kimligi).split('|');
  if (karar === 'Onayla') {
    await c.query(`UPDATE neden_metni SET durum = 'Yerine Geçti' WHERE kart_turu = $1 AND durum = 'Yürürlükte'`, [tur]);
    await c.query(`UPDATE neden_metni SET durum = 'Yürürlükte', onaylayan_ref = $3, onay_zamani = now() WHERE kart_turu = $1 AND surum = $2 AND durum = 'Onayda'`, [tur, Number(surum), yapan]);
  } else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') await c.query(`UPDATE neden_metni SET durum = 'Taslak' WHERE kart_turu = $1 AND surum = $2 AND durum = 'Onayda'`, [tur, Number(surum)]);
});

export function nedenMetniYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const hazirlar = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2)`, [k, HAZIRLAR])).rowCount);

  // Ekranlardaki Neden? bağlantısı: yalnız yürürlükteki metin; yoksa bağlantı gösterilmez.
  s.get('/neden', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const tur = String((i.query as { tur?: string }).tur ?? '').trim(); if (!tur) return y.code(400).send({ hata: 'İş türü belirtilmedi.' });
    const r = (await b.db.query(`SELECT metin, belge_bolumu FROM neden_metni WHERE kart_turu = $1 AND durum = 'Yürürlükte'`, [tur])).rows[0];
    return r ? { metin: r.metin, belgeBolumu: r.belge_bolumu } : { metin: null };
  });

  // Yönetim: sistemdeki onay iş türleri ve metin durumları.
  s.get('/neden-metinleri', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await hazirlar(o.kullanici))) return yok(y);
    const turler = (await b.db.query(`SELECT DISTINCT tur FROM is_karti WHERE kategori = 'onay' UNION SELECT kart_turu FROM neden_metni ORDER BY 1`)).rows.map((r) => r.tur as string);
    const metinler = (await b.db.query(`SELECT kart_turu, surum, metin, belge_bolumu, durum FROM neden_metni ORDER BY kart_turu, surum DESC`)).rows;
    return { turler, metinler };
  });

  s.post('/neden-metni', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; metin?: string; belgeBolumu?: string };
    if (!(await hazirlar(o.kullanici))) return yok(y);
    if (!g.tur?.trim() || !g.metin?.trim()) return y.code(400).send({ hata: 'İş türü ve gerekçe metni zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM neden_metni WHERE kart_turu = $1 AND durum IN ('Onayda', 'Taslak')`, [g.tur.trim()])).rowCount) return y.code(409).send({ hata: 'Bu iş türünün sonuçlanmamış bir metni vardır.' });
    const surum = Number((await b.db.query(`SELECT coalesce(max(surum), 0) + 1 n FROM neden_metni WHERE kart_turu = $1`, [g.tur.trim()])).rows[0].n);
    await b.db.query(`INSERT INTO neden_metni (kart_turu, surum, metin, belge_bolumu, durum, hazirlayan_ref) VALUES ($1,$2,$3,$4,'Onayda',$5)`, [g.tur.trim(), surum, g.metin.trim(), g.belgeBolumu?.trim() || null, o.kullanici]);
    await kartAc(b.db, { tur: KART, baslik: `Neden? Metni · ${g.tur.trim()} · Sürüm ${surum}`, ozet: g.metin.trim().slice(0, 300), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'CEO')], nesneTuru: 'Neden Metni', nesneKimligi: `${g.tur.trim()}|${surum}` });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Neden Metni Onaya Gönderildi', nesneTuru: 'Neden Metni', nesneKimligi: `${g.tur.trim()}|${surum}`, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { surum, durum: 'Onayda' };
  });
}
