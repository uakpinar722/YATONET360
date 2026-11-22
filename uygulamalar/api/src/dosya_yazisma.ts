import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const ONCELIK = ['Planlı', 'Normal', 'Yüksek', 'Kritik'];
/** YG-1666, YG-260: tehlike ifadesi geçen mesaj Kritik sayılır ve alarm verir. */
export const TEHLIKE = /(bat[ıi]yor|batma|batt[ıi]|yang[ıi]n|alev|su al[ıi]yor|su alma|su ald[ıi]|duman|sinking|fire|taking water)/i;

/** Dış kullanıcının dosyaya bağı: dosya tarafı, kurumsal müşteri kurumu veya dosyada iş emri bulunan firma kullanıcısı. */
export async function disDosyaBagi(db: Db, kullanici: string, dosya: string): Promise<boolean> {
  return Boolean((await db.query(`SELECT 1 FROM dosya d WHERE d.kimlik = $2 AND (
      EXISTS (SELECT 1 FROM dosya_tarafi t WHERE t.dosya_ref = d.kimlik AND t.kullanici_ref = $1 AND t.aktif)
      OR EXISTS (SELECT 1 FROM kurumsal_kullanici u JOIN kurumsal_kurum c ON c.kimlik = u.kurum_ref JOIN yat ky ON ky.yat_sahibi_ref = c.taraf_ref WHERE u.kullanici_ref = $1 AND ky.kimlik = d.yat_ref)
      OR EXISTS (SELECT 1 FROM kurulus_kullanici k JOIN is_emri e ON e.kurulus_ref = k.kurulus_ref WHERE k.kullanici_ref = $1 AND e.dosya_ref = d.kimlik AND e.statu NOT IN ('Taslak', 'İptal')))`, [kullanici, dosya])).rowCount);
}
const atanmis = async (db: Db, k: string, dosya: string) => Boolean((await db.query(`SELECT 1 FROM dosya d WHERE d.kimlik = $2 AND (d.dosya_sorumlusu_ref = $1 OR EXISTS (SELECT 1 FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = d.kimlik AND a.kullanici_ref = $1 AND a.bitis_zamani IS NULL))`, [k, dosya])).rowCount);

kapanisKaydet('Mesaj Önceliği Düşürme', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE dosya_yazismasi SET oncelik = bekleyen_oncelik, bekleyen_oncelik = NULL WHERE kimlik = $1::uuid AND bekleyen_oncelik IS NOT NULL`, [k.nesne_kimligi]);
  else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') await c.query(`UPDATE dosya_yazismasi SET bekleyen_oncelik = NULL WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

export function dosyaYazismaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };

  s.get('/dosya/:id/yazisma', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    // LGM tarafı kişi adıyla değil rolle görünür (dış kullanıcıya).
    const rolSql = `coalesce((SELECT a.rol FROM dosya_ekibi_atamasi a WHERE a.dosya_ref = m.dosya_ref AND a.kullanici_ref = m.gonderen_ref AND a.bitis_zamani IS NULL ORDER BY a.atama_zamani LIMIT 1), CASE WHEN d.dosya_sorumlusu_ref = m.gonderen_ref THEN 'Dosya Sorumlusu' END, 'LİMİT GLOBAL MARINE')`;
    if (o.grup !== 'LGM İç Rolü') {
      if (!(await disDosyaBagi(b.db, o.kullanici, id))) return yok(y);
      await b.db.query(`UPDATE dosya_yazismasi SET okunma_zamani = now() WHERE dosya_ref = $1 AND dis_taraf_ref = $2 AND lgm AND okunma_zamani IS NULL`, [id, o.kullanici]);
      return { yazabilir: true, mesajlar: (await b.db.query(`SELECT m.kimlik, m.zaman, m.metin, m.lgm, CASE WHEN m.lgm THEN ${rolSql} ELSE 'Siz' END gonderen FROM dosya_yazismasi m JOIN dosya d ON d.kimlik = m.dosya_ref WHERE m.dosya_ref = $1 AND m.dis_taraf_ref = $2 ORDER BY m.zaman`, [id, o.kullanici])).rows };
    }
    if (!(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const yazabilir = await atanmis(b.db, o.kullanici, id);
    const mesajlar = (await b.db.query(`SELECT m.kimlik, m.zaman, m.metin, m.lgm, m.oncelik, m.bekleyen_oncelik, m.tehlike, m.yanit_son, m.yanitlandi_zamani, m.dis_taraf_ref, t.ad_soyad taraf, g.ad_soyad || CASE WHEN m.lgm THEN ' · ' || ${rolSql} ELSE '' END gonderen
      FROM dosya_yazismasi m JOIN dosya d ON d.kimlik = m.dosya_ref JOIN kullanici_hesabi t ON t.kimlik = m.dis_taraf_ref JOIN kullanici_hesabi g ON g.kimlik = m.gonderen_ref WHERE m.dosya_ref = $1 ORDER BY m.zaman`, [id])).rows;
    // YG-1663: yanıt sayacı yalnız atanmış kişide görünür.
    const yanitBekleyen = yazabilir ? mesajlar.filter((m) => !m.lgm && !m.yanitlandi_zamani).length : undefined;
    const taraflar = yazabilir ? (await b.db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM kullanici_hesabi h WHERE h.kullanici_grubu <> 'LGM İç Rolü' AND (
        h.kimlik IN (SELECT t.kullanici_ref FROM dosya_tarafi t WHERE t.dosya_ref = $1 AND t.aktif AND t.kullanici_ref IS NOT NULL)
        OR h.kimlik IN (SELECT k.kullanici_ref FROM kurulus_kullanici k JOIN is_emri e ON e.kurulus_ref = k.kurulus_ref WHERE e.dosya_ref = $1 AND e.statu NOT IN ('Taslak', 'İptal'))) ORDER BY h.ad_soyad`, [id])).rows : [];
    return { yazabilir, yanitBekleyen, taraflar, mesajlar };
  });

  s.post('/dosya/:id/yazisma', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { metin?: string; taraf?: string };
    if (!UUID.test(id)) return yok(y);
    const metin = g.metin?.trim();
    const lgm = o.grup === 'LGM İç Rolü';
    if (lgm ? !(await atanmis(b.db, o.kullanici, id)) : !(await disDosyaBagi(b.db, o.kullanici, id))) return lgm && (await dosyaErisimi(b.db, o.kullanici, id)) ? y.code(403).send({ hata: 'Dosya yazışmasına dosyaya atanmış personel yazar.' }) : yok(y);
    if (!metin) return y.code(400).send({ hata: 'Mesaj zorunludur.' });
    if (metin.length > 4000) return y.code(400).send({ hata: 'Mesajın 4.000 karakter içinde kalmasını rica ederiz.' });
    const taraf = lgm ? g.taraf : o.kullanici;
    // Dış taraflar birbirine yazamaz: LGM yalnız dosyaya bağlı bir dış kullanıcının başlığına yazar.
    if (!taraf || (lgm && (!(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu <> 'LGM İç Rolü'`, [taraf])).rowCount || !(await disDosyaBagi(b.db, taraf, id))))) return y.code(400).send({ hata: 'Yazışılacak dış tarafı seçiniz.' });
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no, oncelik, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const tehlike = TEHLIKE.test(metin);
      const oncelik = tehlike ? 'Kritik' : ONCELIK.includes(d.oncelik) ? d.oncelik : 'Normal';
      const yanitSon = lgm ? null : new Date(Date.now() + (['Kritik', 'Yüksek'].includes(oncelik) ? 0 : 24 * 3_600_000));
      const m = (await c.query(`INSERT INTO dosya_yazismasi (dosya_ref, dis_taraf_ref, gonderen_ref, lgm, metin, oncelik, tehlike, yanit_son) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [id, taraf, o.kullanici, lgm, metin, oncelik, tehlike, yanitSon])).rows[0];
      if (lgm) {
        // LGM yanıtı başlıktaki bekleyen dış mesajları yanıtlanmış sayar; yanıt görevleri kapanır.
        const ac = (await c.query(`UPDATE dosya_yazismasi SET yanitlandi_zamani = now() WHERE dosya_ref = $1 AND dis_taraf_ref = $2 AND NOT lgm AND yanitlandi_zamani IS NULL RETURNING kimlik::text`, [id, taraf])).rows.map((r) => r.kimlik);
        if (ac.length) await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Mesaj Yanıtı' AND nesne_kimligi = ANY($1) AND kapanma_zamani IS NULL`, [ac]);
      } else {
        const ekip = (await c.query(`SELECT DISTINCT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL`, [id])).rows.map((r) => r.kullanici_ref as string);
        const ds = d.dosya_sorumlusu_ref ?? ekip[0] ?? null;
        if (ds) await kartAc(c, { tur: 'Mesaj Yanıtı', kategori: 'gorev', baslik: `${d.dosya_no} · Dosya Yazışması Yanıt Bekliyor`, ozet: metin.slice(0, 160), oncelik, sahipKullanici: ds, sonZaman: yanitSon, nesneTuru: 'Dosya Yazışması', nesneKimligi: m.kimlik });
        if (tehlike) await bildir(c, { olay: `yazisma-tehlike:${m.kimlik}`, kullanicilar: [...new Set([ds, ...ekip].filter(Boolean) as string[])], baslik: `⚠ Kritik Mesaj: ${d.dosya_no}`, ozet: metin.slice(0, 200), oncelik: 'Kritik', acil: true, sms: true });
      }
      return { kimlik: m.kimlik, oncelik };
    });
  });

  // YG-1666: Dosya Sorumlusu önceliği hemen yükseltir; düşürme Operasyon Müdürü onayından geçer.
  s.post('/dosya-yazismasi/:id/oncelik', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { oncelik?: string; gerekce?: string };
    const m = UUID.test(id) ? (await b.db.query(`SELECT m.kimlik, m.oncelik, m.bekleyen_oncelik, d.dosya_no, d.dosya_sorumlusu_ref FROM dosya_yazismasi m JOIN dosya d ON d.kimlik = m.dosya_ref WHERE m.kimlik = $1`, [id])).rows[0] : null;
    if (!m || m.dosya_sorumlusu_ref !== o.kullanici) return yok(y);
    if (!ONCELIK.includes(g.oncelik ?? '') || g.oncelik === m.oncelik) return y.code(400).send({ hata: 'Yeni önceliği seçiniz.' });
    if (ONCELIK.indexOf(g.oncelik!) > ONCELIK.indexOf(m.oncelik)) {
      await b.db.query(`UPDATE dosya_yazismasi SET oncelik = $2 WHERE kimlik = $1`, [id, g.oncelik]);
      await b.db.query(`UPDATE is_karti SET oncelik = $2 WHERE tur = 'Mesaj Yanıtı' AND nesne_kimligi = $1 AND kapanma_zamani IS NULL`, [id, g.oncelik]);
      return { oncelik: g.oncelik };
    }
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Öncelik düşürme gerekçesi zorunludur.' });
    if (m.bekleyen_oncelik) return y.code(409).send({ hata: 'Bu mesaj için öncelik düşürme onayı bekleniyor.' });
    await islem(async (c) => {
      await c.query(`UPDATE dosya_yazismasi SET bekleyen_oncelik = $2 WHERE kimlik = $1`, [id, g.oncelik]);
      await kartAc(c, { tur: 'Mesaj Önceliği Düşürme', baslik: `${m.dosya_no} · Mesaj Önceliği: ${m.oncelik} → ${g.oncelik}`, ozet: g.gerekce!.trim(), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Operasyon Müdürü')], nesneTuru: 'Dosya Yazışması', nesneKimligi: id });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Mesaj Önceliği Düşürme Talebi', nesneTuru: 'Dosya Yazışması', nesneKimligi: id, yeni: { oncelik: g.oncelik }, gerekce: g.gerekce!.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    });
    return { durum: 'Onay Bekleniyor', makam: 'Operasyon Müdürü' };
  });
}
