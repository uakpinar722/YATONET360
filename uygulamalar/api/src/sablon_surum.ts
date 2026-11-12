import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kapanisKaydet } from './kapanis.js';
import { bildir } from './bildirim.js';
import { kartAc } from './is_motoru.js';
import { rolSahipleri } from './makam.js';
import type { Pool, PoolClient } from 'pg';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

/** YG-600, YG-626: metin kütüphanesinin sahibi BT ve Firma Yönetimi Direktörlüğü; anlamı etkileyen değişiklik yeni sürümle ve Genel Müdür Yardımcısı onayıyla yayımlanır, CEO bilgilendirilir (CEO 12.11.2026). */
const ONAY = 'Genel Müdür Yardımcısı';
const SAHIP = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü';
const DUZENLER = [SAHIP, 'Müşteri ve Paydaş İlişkileri Müdürü'];
/** Sürüm etiketi Rnn biçimindedir. */
export const sonrakiSurum = (s: string) => `R${String(Number(String(s).replace(/\D/g, '')) + 1).padStart(2, '0')}`;

/** Metin değişikliği yürürlüğe girince CEO'ya bilgi bildirimi gider. */
async function ceoBilgi(db: Pool | PoolClient, baslik: string, ozet: string) {
  const k = await rolSahipleri(db, await rolId(db, 'CEO'));
  if (k.length) await bildir(db, { olay: `metin:${baslik}`, kullanicilar: k, baslik: `Metin Değişikliği · ${baslik}`, ozet: ozet.slice(0, 300) });
}

kapanisKaydet('Şablon Metni Onayı', async (c, k, karar, yapan) => {
  const [kod, dil, surum] = String(k.nesne_kimligi).split('|');
  if (karar === 'Onayla') {
    await c.query(`UPDATE sablon_metni SET durum = 'Yerine Geçti' WHERE kod = $1 AND dil = $2 AND durum = 'Yürürlükte'`, [kod, dil]);
    await c.query(`UPDATE sablon_metni SET durum = 'Yürürlükte', onaylayan_ref = $4, yayim_zamani = now() WHERE kod = $1 AND dil = $2 AND surum = $3 AND durum = 'Onayda'`, [kod, dil, surum, yapan]);
    await ceoBilgi(c, `${kod} (${String(dil).toUpperCase()}) ${surum} yürürlüğe girdi`, `Genel Müdür Yardımcısı onayıyla. ${k.ozet ?? ''}`);
  } else if (karar === 'Gerekçeyle İade Et' || karar === 'Reddet') await c.query(`UPDATE sablon_metni SET durum = 'Taslak' WHERE kod = $1 AND dil = $2 AND surum = $3 AND durum = 'Onayda'`, [kod, dil, surum]);
  else if (karar === 'Yeniden Gönder') await c.query(`UPDATE sablon_metni SET durum = 'Onayda' WHERE kod = $1 AND dil = $2 AND surum = $3 AND durum = 'Taslak'`, [kod, dil, surum]);
});

export function sablonSurumYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const duzenler = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[])`, [k, DUZENLER])).rowCount);

  s.get('/sablon-metni', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const q = (i.query ?? {}) as { ara?: string };
    const { rows } = await b.db.query(`SELECT kod, dil, surum, tur, baslik, metin, durum, sahip_rol, onay_dayanagi, degisiklik_gerekcesi, yayim_zamani FROM sablon_metni
      WHERE $1::text IS NULL OR kod ILIKE '%' || $1 || '%' OR baslik ILIKE '%' || $1 || '%' ORDER BY kod, dil, surum DESC LIMIT 400`, [q.ara?.trim() || null]);
    return { duzenler: await duzenler(o.kullanici), metinler: rows };
  });
  // Anlamı etkileyen değişiklik yeni sürüm olarak Onayda açılır ve CEO'ya gider; yazım düzeltmesi de yeni sürümdür, sahip onayıyla doğrudan yürürlüğe girer.
  s.post('/sablon-metni/:kod/:dil', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod, dil } = i.params as { kod: string; dil: string };
    const g = (i.body ?? {}) as { metin?: string; gerekce?: string; anlamEtkiler?: boolean };
    if (!(await duzenler(o.kullanici))) return yok(y);
    const son = (await b.db.query(`SELECT surum, tur, baslik, metin, durum FROM sablon_metni WHERE kod = $1 AND dil = $2 ORDER BY surum DESC LIMIT 1`, [kod, dil])).rows[0];
    if (!son) return yok(y);
    if (['Onayda', 'Taslak'].includes(son.durum)) return y.code(409).send({ hata: 'Bu metnin sonuçlanmamış bir sürümü var.' });
    if (!g.metin?.trim() || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Yeni metin ve değişiklik gerekçesi zorunludur.' });
    if (g.metin.trim() === son.metin) return y.code(409).send({ hata: 'Metin değişmemiştir.' });
    const yeni = sonrakiSurum(son.surum); const anlam = g.anlamEtkiler !== false;
    await b.db.query(`INSERT INTO sablon_metni (kod, dil, surum, tur, baslik, metin, durum, sahip_rol, degisiklik_gerekcesi, onay_dayanagi, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [kod, dil, yeni, son.tur, son.baslik, g.metin.trim(), anlam ? 'Onayda' : 'Yürürlükte', SAHIP, g.gerekce.trim(), anlam ? 'Genel Müdür Yardımcısı onayı (YATONET 360)' : 'Yazım düzeltmesi · metin sahibi', o.kullanici]);
    if (anlam) await kartAc(b.db, { tur: 'Şablon Metni Onayı', baslik: `${kod} (${dil.toUpperCase()}) · ${yeni}`, ozet: g.gerekce.trim().slice(0, 300), hazirlayan: o.kullanici, zincir: [await rolId(b.db, ONAY)], nesneTuru: 'Şablon Metni', nesneKimligi: `${kod}|${dil}|${yeni}` });
    else { await ceoBilgi(b.db, `${kod} (${dil.toUpperCase()}) ${yeni} yürürlüğe girdi`, `Yazım düzeltmesi. ${g.gerekce.trim()}`); await b.db.query(`UPDATE sablon_metni SET durum = 'Yerine Geçti' WHERE kod = $1 AND dil = $2 AND surum = $3`, [kod, dil, son.surum]); await b.db.query(`UPDATE sablon_metni SET yayim_zamani = now(), onaylayan_ref = $4 WHERE kod = $1 AND dil = $2 AND surum = $3`, [kod, dil, yeni, o.kullanici]); }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Şablon Metni Yeni Sürüm', nesneTuru: 'Şablon Metni', nesneKimligi: `${kod}|${dil}|${yeni}`, eski: { metin: son.metin }, yeni: { metin: g.metin.trim() }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { surum: yeni, durum: anlam ? 'Onayda' : 'Yürürlükte' };
  });
}
