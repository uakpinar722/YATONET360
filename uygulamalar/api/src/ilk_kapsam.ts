import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const TUR = 'İlk Kapsam Kontrolü';
const ALAN = ['varlikSistem', 'faaliyet', 'teknikBrans', 'koordinator', 'destekIsleri', 'beklenenCikti', 'kabulOlcutu', 'hariclar', 'varsayimlar'] as const;
type G = Partial<Record<(typeof ALAN)[number], unknown>>;

/**
 * YG-1069: FR-OPS-003 İlk Kapsam, Hizmet Branşı ve Çıktı Tanımı. Dosya Sorumlusu doldurur; dosyanın Teknik Uzmanı tamamlar ve kontrol eder.
 * Yat sahibi, sigorta şirketi ve firma formu görmez. Kapsamı değiştiren her kayıt yeni sürümdür (alan sözlüğü: sessiz genişleme yok).
 */
export function ilkKapsamYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const ekipRol = async (d: string, k: string) => (await b.db.query(`SELECT rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL`, [d, k])).rows.map((r) => r.rol as string);
  const liste = async (k: string) => (await b.db.query(`SELECT deger, aciklama FROM deger_listesi WHERE liste_kodu = $1 ORDER BY sira`, [k])).rows as { deger: string; aciklama: string }[];
  const denetle = async (d: string, g: G): Promise<string | null> => {
    const br = Array.isArray(g.teknikBrans) ? g.teknikBrans.map(String) : [];
    for (const a of ['varlikSistem', 'faaliyet', 'beklenenCikti', 'kabulOlcutu', 'hariclar'] as const) if (!String(g[a] ?? '').trim()) return 'Varlık/sistem, faaliyet, beklenen çıktı, kabul ölçütü ve hariçler zorunludur.';
    if (!br.length) return 'En az bir teknik branş seçiniz.';
    if (!(await liste('LST_ILK_FAALIYET')).some((x) => x.deger === g.faaliyet)) return 'Faaliyeti listeden seçiniz.';
    if (!(await liste('LST_BEKLENEN_CIKTI')).some((x) => x.deger === g.beklenenCikti)) return 'Beklenen çıktıyı listeden seçiniz.';
    const ana = new Set((await liste('LST_ANA_BRANS')).map((x) => x.deger)); if (br.some((x) => !ana.has(x))) return 'Teknik branşı listeden seçiniz.';
    if (br.length > 1 && (!g.koordinator || !(await ekipRol(d, String(g.koordinator))).includes('Teknik Uzman'))) return 'Birden fazla branşta koordinatör Teknik Uzman zorunludur.';
    return null;
  };
  const deger = (g: G) => [String(g.varlikSistem).trim(), g.faaliyet, (g.teknikBrans as unknown[]).map(String), (g.teknikBrans as unknown[]).length > 1 ? g.koordinator : null, String(g.destekIsleri ?? '').trim() || null, g.beklenenCikti, String(g.kabulOlcutu).trim(), String(g.hariclar).trim(), String(g.varsayimlar ?? '').trim() || null];

  s.get('/dosya/:id/ilk-kapsam', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü') return yok(y);
    const r = await ekipRol(id, o.kullanici); const ust = (await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[])`, [o.kullanici, ['Operasyon Müdürü', 'Teknik Müdür', 'Operasyon Yöneticisi', 'Teknik Yönetici']])).rowCount;
    if (!r.length && !ust) return yok(y);
    return {
      doldurur: r.includes('Dosya Sorumlusu'), kontrolEder: r.includes('Teknik Uzman'),
      faaliyetler: (await liste('LST_ILK_FAALIYET')).map((x) => x.deger), ciktilar: (await liste('LST_BEKLENEN_CIKTI')).map((x) => x.deger), branslar: await liste('LST_ANA_BRANS'),
      uzmanlar: (await b.db.query(`SELECT h.kimlik, h.ad_soyad FROM dosya_ekibi_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.dosya_ref = $1 AND a.rol = 'Teknik Uzman' AND a.bitis_zamani IS NULL`, [id])).rows,
      surumler: (await b.db.query(`SELECT k.*, h.ad_soyad koordinator FROM ilk_kapsam k LEFT JOIN kullanici_hesabi h ON h.kimlik = k.koordinator_ref WHERE k.dosya_ref = $1 ORDER BY k.surum DESC`, [id])).rows,
    };
  });
  s.post('/dosya/:id/ilk-kapsam', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as G;
    if (!UUID.test(id) || !(await ekipRol(id, o.kullanici)).includes('Dosya Sorumlusu')) return yok(y);
    const h = await denetle(id, g); if (h) return y.code(400).send({ hata: h });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT 1 FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id]);
      const n = Number((await c.query(`SELECT coalesce(max(surum), 0) + 1 n FROM ilk_kapsam WHERE dosya_ref = $1`, [id])).rows[0].n);
      await c.query(`UPDATE ilk_kapsam SET durum = 'Yerine Geçti', guncelleme_zamani = now() WHERE dosya_ref = $1 AND durum IN ('Kontrolde', 'Onaylı', 'İade Edildi')`, [id]);
      const k = (await c.query(`INSERT INTO ilk_kapsam (dosya_ref, surum, varlik_sistem, faaliyet, teknik_brans, koordinator_ref, destek_isleri, beklenen_cikti, kabul_olcutu, hariclar, varsayimlar, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING kimlik`, [id, n, ...deger(g), o.kullanici])).rows[0].kimlik as string;
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_turu = 'Dosya' AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [TUR, id]);
      const tu = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = 'Teknik Uzman' AND bitis_zamani IS NULL ORDER BY atama_zamani LIMIT 1`, [id])).rows[0]?.kullanici_ref;
      const no = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0].dosya_no;
      if (tu) await kartAc(c, { tur: TUR, kategori: 'gorev', baslik: `${no} · FR-OPS-003 İlk Kapsam Rev.${n}`, ozet: 'Kapsamı tamamlayıp kontrol ediniz.', sahipKullanici: tu, nesneTuru: 'Dosya', nesneKimligi: id });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İlk Kapsam', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { surum: n }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: k, surum: n, kontrolGorevi: Boolean(tu) };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  // Teknik Uzman eksik alanları tamamlayabilir; değişiklik aynı sürüme kontrol kaydıyla işlenir, onay veya gerekçeli iade verir.
  s.post('/dosya/:id/ilk-kapsam/:surum/kontrol', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id, surum } = i.params as { id: string; surum: string }; const g = (i.body ?? {}) as G & { karar?: string; gerekce?: string };
    if (!UUID.test(id) || !/^\d+$/.test(surum) || !(await ekipRol(id, o.kullanici)).includes('Teknik Uzman')) return yok(y);
    const k = (await b.db.query(`SELECT * FROM ilk_kapsam WHERE dosya_ref = $1 AND surum = $2`, [id, Number(surum)])).rows[0]; if (!k) return yok(y);
    if (k.durum !== 'Kontrolde') return y.code(409).send({ hata: 'Bu sürüm kontrolde değildir.' });
    if (g.karar === 'İade') {
      if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'İade gerekçesi zorunludur.' });
      await b.db.query(`UPDATE ilk_kapsam SET durum = 'İade Edildi', iade_gerekcesi = $2, kontrol_eden_ref = $3, kontrol_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1`, [k.kimlik, g.gerekce.trim(), o.kullanici]);
    } else if (g.karar === 'Onayla') {
      const yeni: G = { varlikSistem: g.varlikSistem ?? k.varlik_sistem, faaliyet: g.faaliyet ?? k.faaliyet, teknikBrans: g.teknikBrans ?? k.teknik_brans, koordinator: g.koordinator ?? k.koordinator_ref, destekIsleri: g.destekIsleri ?? k.destek_isleri, beklenenCikti: g.beklenenCikti ?? k.beklenen_cikti, kabulOlcutu: g.kabulOlcutu ?? k.kabul_olcutu, hariclar: g.hariclar ?? k.hariclar, varsayimlar: g.varsayimlar ?? k.varsayimlar };
      const h = await denetle(id, yeni); if (h) return y.code(400).send({ hata: h });
      const [vs, fa, br, ko, de, bc, ka, ha, va] = deger(yeni);
      await b.db.query(`UPDATE ilk_kapsam SET varlik_sistem = $2, faaliyet = $3, teknik_brans = $4, koordinator_ref = $5, destek_isleri = $6, beklenen_cikti = $7, kabul_olcutu = $8, hariclar = $9, varsayimlar = $10, durum = 'Onaylı', kontrol_eden_ref = $11, kontrol_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1`, [k.kimlik, vs, fa, br, ko, de, bc, ka, ha, va, o.kullanici]);
    } else return y.code(400).send({ hata: 'Kararı seçiniz.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_turu = 'Dosya' AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [TUR, id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `İlk Kapsam Kontrolü: ${g.karar}`, nesneTuru: 'Dosya', nesneKimligi: id, eski: { surum: k.surum }, gerekce: g.gerekce?.trim() || undefined, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
