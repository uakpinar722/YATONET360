import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { sonrakiSurum } from './sablon_surum.js';

/** YG-1697 (A51-S8): Sabit Hukuki Metinler (KVKK aydınlatma ve rıza metinleri, Portal Kullanım Koşulları); Hukuk ve Uyum hazırlar, metin değişikliği ve İngilizce sürüm "Onaya Gönder" ile CEO'ya gider. */
const HAZIRLAR = ['Hukuk ve Uyum Direktörü', 'Hukuk ve Uyum Uzmanı'];
const TUR = 'Hukuki Metin Onayı';

kapanisKaydet(TUR, async (c, k, karar, yapan) => {
  const [kod, dil, surum] = String(k.nesne_kimligi).split('|');
  if (karar === 'Onayla') {
    void dil;
    await c.query(`UPDATE hukuki_metin SET durum = 'Yerine Geçti' WHERE kod = $1 AND durum = 'Yürürlükte'`, [kod]);
    await c.query(`UPDATE hukuki_metin SET durum = 'Yürürlükte', onaylayan_ref = $3, yukleme_zamani = now() WHERE kod = $1 AND surum = $2 AND durum = 'Onayda'`, [kod, surum, yapan]);
  } else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') await c.query(`UPDATE hukuki_metin SET durum = 'Taslak' WHERE kod = $1 AND surum = $2 AND durum = 'Onayda'`, [kod, surum]);
});

export function hukukiMetinYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  s.get('/hukuki-metinler', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, [...HAZIRLAR, 'CEO']))) return yok(y);
    const l = (await b.db.query(`SELECT kod, dil, surum, baslik, durum, govde, yukleme_zamani FROM hukuki_metin ORDER BY kod, dil, surum DESC`)).rows;
    return { hazirlar: await rolde(o.kullanici, HAZIRLAR), metinler: l.map((x) => ({ ...x, govde: (x.govde as string[]).join('\n') })) };
  });
  // Sürüm metin koduna bağlıdır (yeni sürüm rızanın yeniden alınmasını tetikler); metnin mevcut tüm dilleri aynı sürümle birlikte onaya gider ve birlikte yürürlüğe girer.
  s.post('/hukuki-metin/:kod', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string }; const g = (i.body ?? {}) as { tr?: string; en?: string; gerekce?: string };
    if (!(await rolde(o.kullanici, HAZIRLAR))) return yok(y);
    const mevcut = (await b.db.query(`SELECT DISTINCT ON (dil) dil, surum, baslik FROM hukuki_metin WHERE kod = $1 ORDER BY dil, surum DESC`, [kod])).rows as { dil: 'tr' | 'en'; surum: string; baslik: string }[];
    if (!mevcut.length) return yok(y);
    if (!g.gerekce?.trim() || mevcut.some((m) => !g[m.dil]?.trim())) return y.code(400).send({ hata: `Metnin ${mevcut.map((m) => (m.dil === 'tr' ? 'Türkçe' : 'İngilizce')).join(' ve ')} sürümü ile değişiklik gerekçesi zorunludur.` });
    if ((await b.db.query(`SELECT 1 FROM hukuki_metin WHERE kod = $1 AND durum = 'Onayda'`, [kod])).rowCount) return y.code(409).send({ hata: 'Bu metnin onayda bekleyen sürümü vardır.' });
    const surum = sonrakiSurum(mevcut.map((m) => m.surum).sort().pop()!);
    for (const m of mevcut) await b.db.query(`INSERT INTO hukuki_metin (kod, dil, surum, baslik, govde, durum, hazirlayan_ref, degisiklik_gerekcesi) VALUES ($1,$2,$3,$4,$5,'Onayda',$6,$7)`, [kod, m.dil, surum, m.baslik, JSON.stringify(g[m.dil]!.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)), o.kullanici, g.gerekce.trim()]);
    await kartAc(b.db, { tur: TUR, baslik: `${kod} ${surum} · Sabit Hukuki Metin`, ozet: g.gerekce.trim().slice(0, 300), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Genel Müdür Yardımcısı'), await rolId(b.db, 'CEO')] /* YG-541: rutin konular CEO'ya GMY üzerinden */, nesneTuru: 'Hukuki Metin', nesneKimligi: `${kod}|*|${surum}` });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Hukuki Metin Onaya Gönderildi', nesneTuru: 'Hukuki Metin', nesneKimligi: `${kod}|${surum}`, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { surum };
  });
}
