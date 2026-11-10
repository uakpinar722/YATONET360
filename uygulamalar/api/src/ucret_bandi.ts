import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const GORUR = ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü'];
const HAZIRLAR = ['İnsan Kaynakları Müdürü', 'İnsan Kaynakları Sorumlusu'];
const TUR = 'Bant Dışı Ücret Teklifi';

kapanisKaydet(TUR, async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE ucret_teklifi SET durum = 'Onaylandı' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE ucret_teklifi SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

/**
 * YG-1082: ücret bandı yalnız CEO, GMY, Ticari İşler Direktörü ve onun yetkilendirdiği personele görünür; alt sınır asgari ücretin altında olamaz;
 * bant dışı ücret teklifi CEO onayına gider. Asgari ücret İnsan Kaynakları Müdürünün girdiği resmî tutardır; sistem tutar uydurmaz.
 */
export function ucretBandiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const gorur = async (k: string) => (await rolVar(k, GORUR)) || Boolean((await b.db.query(`SELECT 1 FROM ucret_bandi_yetki WHERE kullanici_ref = $1`, [k])).rowCount);
  const asgari = async () => { const r = (await b.db.query(`SELECT deger FROM ik_parametresi WHERE kod = 'asgari_ucret_brut_tl'`)).rows[0]; return r ? Number(r.deger) : null; };

  s.get('/ucret-bandi', oturumlu, async (i, y) => {
    const k = i.oturum!.kullanici; if (!(await gorur(k))) return yok(y);
    return {
      asgari: await asgari(), yetkiVerir: await rolVar(k, ['Ticari İşler Direktörü']),
      bantlar: (await b.db.query(`SELECT r.kimlik rol, r.rol_adi, u.alt_tl, u.ust_tl FROM ucret_bandi u JOIN rol r ON r.kimlik = u.rol_ref ORDER BY r.rol_adi`)).rows,
      yetkililer: (await b.db.query(`SELECT h.kimlik, h.ad_soyad FROM ucret_bandi_yetki y JOIN kullanici_hesabi h ON h.kimlik = y.kullanici_ref ORDER BY h.ad_soyad`)).rows,
    };
  });
  s.post('/ucret-bandi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, ['CEO', 'Ticari İşler Direktörü']))) return yok(y);
    const g = (i.body ?? {}) as { rol?: string; alt?: number; ust?: number };
    const alt = Number(g.alt); const ust = Number(g.ust);
    if (!g.rol || !(alt > 0) || !(ust >= alt)) return y.code(400).send({ hata: 'Rol, alt ve üst sınırı giriniz; üst sınır alt sınırdan küçük olamaz.' });
    const a = await asgari(); if (a === null) return y.code(409).send({ hata: 'Önce İnsan Kaynakları Müdürünün güncel asgari ücreti girmesi gerekir.' });
    if (alt < a) return y.code(400).send({ hata: 'Alt sınır asgari ücretin altında olamaz.' });
    if (!(await b.db.query(`SELECT 1 FROM rol WHERE kimlik = $1 AND kullanici_gruplari = 'LGM İç Rolü'`, [g.rol])).rowCount) return y.code(400).send({ hata: 'Rol bulunamadı.' });
    const eski = (await b.db.query(`SELECT alt_tl, ust_tl FROM ucret_bandi WHERE rol_ref = $1`, [g.rol])).rows[0] ?? null;
    await b.db.query(`INSERT INTO ucret_bandi (rol_ref, alt_tl, ust_tl, giren_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (rol_ref) DO UPDATE SET alt_tl = EXCLUDED.alt_tl, ust_tl = EXCLUDED.ust_tl, giren_ref = EXCLUDED.giren_ref, zaman = now()`, [g.rol, alt, ust, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ücret Bandı', nesneTuru: 'Rol', nesneKimligi: g.rol, eski, yeni: { alt_tl: alt, ust_tl: ust }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/ucret-bandi/yetki', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, ['Ticari İşler Direktörü']))) return yok(y);
    const g = (i.body ?? {}) as { kullanici?: string; kaldir?: boolean };
    if (!g.kullanici || !(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü'`, [g.kullanici])).rowCount) return y.code(400).send({ hata: 'Personel bulunamadı.' });
    if (g.kaldir) await b.db.query(`DELETE FROM ucret_bandi_yetki WHERE kullanici_ref = $1`, [g.kullanici]);
    else await b.db.query(`INSERT INTO ucret_bandi_yetki (kullanici_ref, veren_ref) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [g.kullanici, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: g.kaldir ? 'Ücret Bandı Yetkisi Kaldırıldı' : 'Ücret Bandı Yetkisi Verildi', nesneTuru: 'Kullanıcı', nesneKimligi: g.kullanici, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // İK teklif hazırlar; bant görmeyen hazırlayana yalnız sonuç söylenir, sınırlar gösterilmez.
  s.post('/ucret-teklifi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, [...HAZIRLAR, ...GORUR]))) return yok(y);
    const g = (i.body ?? {}) as { aday?: string; rol?: string; brut?: number; gerekce?: string };
    const brut = Number(g.brut); const aday = (g.aday ?? '').trim();
    if (!aday || !g.rol || !(brut > 0)) return y.code(400).send({ hata: 'Aday, rol ve brüt ücreti giriniz.' });
    const a = await asgari(); if (a !== null && brut < a) return y.code(400).send({ hata: 'Ücret asgari ücretin altında olamaz.' });
    const bant = (await b.db.query(`SELECT alt_tl, ust_tl FROM ucret_bandi WHERE rol_ref = $1`, [g.rol])).rows[0];
    if (!bant) return y.code(409).send({ hata: 'Bu rol için ücret bandı tanımlanmamıştır; Ticari İşler Direktörüne başvurunuz.' });
    const disi = brut < Number(bant.alt_tl) || brut > Number(bant.ust_tl);
    if (disi && !(g.gerekce ?? '').trim()) return y.code(400).send({ hata: 'Ücret bant dışındadır; CEO onayı için gerekçe yazınız.' });
    const t = (await b.db.query(`INSERT INTO ucret_teklifi (aday_adi, rol_ref, brut_tl, bant_disi, gerekce, durum, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [aday, g.rol, brut, disi, g.gerekce?.trim() || null, disi ? 'CEO Onayında' : 'Geçerli', o.kullanici])).rows[0].kimlik as string;
    if (disi) await kartAc(b.db, { tur: TUR, baslik: `${TUR}: ${aday}`, ozet: g.gerekce!.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'CEO')], nesneTuru: 'Ücret Teklifi', nesneKimligi: t });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ücret Teklifi', nesneTuru: 'Ücret Teklifi', nesneKimligi: t, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: t, durum: disi ? 'CEO Onayında' : 'Geçerli' };
  });
  s.get('/ucret-teklifi/roller', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [...HAZIRLAR, ...GORUR]))) return yok(y);
    return (await b.db.query(`SELECT kimlik, rol_adi FROM rol WHERE kullanici_gruplari = 'LGM İç Rolü' AND rol_durumu = 'Aktif' ORDER BY rol_adi`)).rows;
  });
  s.get('/ucret-teklifi', oturumlu, async (i, y) => {
    const k = i.oturum!.kullanici; if (!(await rolVar(k, [...HAZIRLAR, ...GORUR]))) return yok(y);
    const tam = await gorur(k);
    return (await b.db.query(`SELECT t.kimlik, t.aday_adi, r.rol_adi, ${tam ? 't.brut_tl,' : ''} t.bant_disi, t.durum, t.zaman FROM ucret_teklifi t JOIN rol r ON r.kimlik = t.rol_ref ORDER BY t.zaman DESC LIMIT 100`)).rows;
  });
}
