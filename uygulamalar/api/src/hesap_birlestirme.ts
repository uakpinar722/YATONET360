import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

/**
 * YG-1244, V-1134: mükerrer personel (aynı kişiye ait iki LGM kullanıcı hesabı) kendiliğinden birleştirilmez. Veri sahibi İnsan Kaynakları Müdürü ana hesabı seçer.
 * Geçmiş kayıtlar ve işlem izi eski hesapta kalır (iz değiştirilemez); güncel bağlar taşınır: aktif rol atamaları, açık dosya görevleri, bekleyen iş kartları ve
 * ana hesapta yoksa personel kartı. Eski hesap kapanır, ana hesaba yönlendirilir; birleştirme geri alınabilir.
 */
const VERI_SAHIBI = 'İnsan Kaynakları Müdürü';
type Tasinan = { rol: string[]; rolKapatilan: string[]; ekip: string[]; kart: string[]; personelKarti: boolean };

export function hesapBirlestirmeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2`, [k, VERI_SAHIBI])).rowCount);
  const hesap = async (k: string) => (await b.db.query(`SELECT kimlik, ad_soyad, e_posta, cep_telefonu, hesap_durumu, birlestirilen_ana_ref FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü'`, [k])).rows[0];
  const ozet = async (c: { query: PoolClient['query'] }, k: string) => ({
    roller: (await c.query(`SELECT r.rol_adi FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' ORDER BY 1`, [k])).rows.map((x) => x.rol_adi as string),
    acikDosyaGorevi: Number((await c.query(`SELECT count(*) n FROM dosya_ekibi_atamasi WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [k])).rows[0].n),
    bekleyenKart: Number((await c.query(`SELECT count(*) n FROM is_karti WHERE sahip_kullanici_ref = $1 AND durum = 'Bekliyor'`, [k])).rows[0].n),
    personelKarti: Boolean((await c.query(`SELECT 1 FROM personel_karti WHERE kullanici_ref = $1`, [k])).rowCount),
  });

  s.get('/hesap-birlestirme/onizleme', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = i.query as { ana?: string; eski?: string };
    if (!(await yetkili(o.kullanici))) return yok(y);
    if (!g.ana || !g.eski || g.ana === g.eski) return y.code(400).send({ hata: 'Ana hesabı ve mükerrer hesabı seçmenizi rica ederiz.' });
    const [a, e] = [await hesap(g.ana), await hesap(g.eski)];
    if (!a || !e || e.birlestirilen_ana_ref || a.birlestirilen_ana_ref) return y.code(404).send({ hata: 'Hesap bulunamadı veya daha önce birleştirilmiştir.' });
    const celisen = (['ad_soyad', 'e_posta', 'cep_telefonu'] as const).filter((k) => a[k] && e[k] && a[k] !== e[k]).map((k) => ({ alan: k, ana: a[k], eski: e[k] }));
    return { ana: { ad: a.ad_soyad, ...(await ozet(b.db, g.ana)) }, eski: { ad: e.ad_soyad, ...(await ozet(b.db, g.eski)) }, celisenAlanlar: celisen };
  });

  s.post('/hesap-birlestirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ana?: string; eski?: string; gerekce?: string };
    if (!(await yetkili(o.kullanici))) return yok(y);
    if (!g.ana || !g.eski || g.ana === g.eski || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Ana hesap, mükerrer hesap ve gerekçe zorunludur.' });
    if (g.eski === o.kullanici || g.ana === o.kullanici) return y.code(409).send({ hata: 'Görev ayrılığı gereği kendi hesabınızla ilgili birleştirmenin başka bir yetkili tarafından yapılmasını rica ederiz.' });
    const [a, e] = [await hesap(g.ana), await hesap(g.eski)];
    if (!a || !e || e.birlestirilen_ana_ref || a.birlestirilen_ana_ref || a.hesap_durumu !== 'Aktif') return y.code(404).send({ hata: 'Hesap bulunamadı veya daha önce birleştirilmiştir.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t: Tasinan = { rol: [], rolKapatilan: [], ekip: [], kart: [], personelKarti: false };
      for (const r of (await c.query(`SELECT a.kimlik, a.rol_ref, EXISTS (SELECT 1 FROM rol_atamasi x WHERE x.kullanici_ref = $2 AND x.rol_ref = a.rol_ref AND x.atama_durumu = 'Aktif') var0 FROM rol_atamasi a WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [g.eski, g.ana])).rows) {
        if (r.var0) { await c.query(`UPDATE rol_atamasi SET atama_durumu = 'Kapalı' WHERE kimlik = $1`, [r.kimlik]); t.rolKapatilan.push(r.kimlik); }
        else { await c.query(`UPDATE rol_atamasi SET kullanici_ref = $2 WHERE kimlik = $1`, [r.kimlik, g.ana]); t.rol.push(r.kimlik); }
      }
      t.ekip = (await c.query(`UPDATE dosya_ekibi_atamasi SET kullanici_ref = $2 WHERE kullanici_ref = $1 AND bitis_zamani IS NULL RETURNING kimlik`, [g.eski, g.ana])).rows.map((x) => x.kimlik as string);
      t.kart = (await c.query(`UPDATE is_karti SET sahip_kullanici_ref = $2 WHERE sahip_kullanici_ref = $1 AND durum = 'Bekliyor' RETURNING kimlik`, [g.eski, g.ana])).rows.map((x) => x.kimlik as string);
      if (!(await c.query(`SELECT 1 FROM personel_karti WHERE kullanici_ref = $1`, [g.ana])).rowCount) t.personelKarti = Boolean((await c.query(`UPDATE personel_karti SET kullanici_ref = $2 WHERE kullanici_ref = $1`, [g.eski, g.ana])).rowCount);
      await c.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Kapalı', birlestirilen_ana_ref = $2 WHERE kimlik = $1`, [g.eski, g.ana]);
      await c.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Hesap birleştirildi' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [g.eski]);
      const r = (await c.query(`INSERT INTO hesap_birlestirme (ana_ref, eski_ref, gerekce, tasinan, yapan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.ana, g.eski, g.gerekce.trim(), JSON.stringify(t), o.kullanici])).rows[0];
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Personel Hesabı Birleştirme', nesneTuru: 'Kullanıcı', nesneKimligi: g.eski, yeni: { ana: g.ana, tasinan: t }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, tasinan: t };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  s.post('/hesap-birlestirme/:id/geri-al', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gerekce?: string };
    if (!(await yetkili(o.kullanici))) return yok(y);
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Geri alma gerekçesini yazmanızı rica ederiz.' });
    const k = /^[0-9a-f-]{36}$/.test(id) ? (await b.db.query(`SELECT * FROM hesap_birlestirme WHERE kimlik = $1 AND durum = 'Ana Kayda Bağlandı'`, [id])).rows[0] : undefined;
    if (!k) return y.code(404).send({ hata: 'Geri alınacak birleştirme bulunamadı.' });
    const t = k.tasinan as Tasinan;
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      if (t.rol.length) await c.query(`UPDATE rol_atamasi SET kullanici_ref = $2 WHERE kimlik = ANY($1::uuid[])`, [t.rol, k.eski_ref]);
      if (t.rolKapatilan.length) await c.query(`UPDATE rol_atamasi SET atama_durumu = 'Aktif' WHERE kimlik = ANY($1::uuid[])`, [t.rolKapatilan]);
      if (t.ekip.length) await c.query(`UPDATE dosya_ekibi_atamasi SET kullanici_ref = $2 WHERE kimlik = ANY($1::uuid[]) AND bitis_zamani IS NULL`, [t.ekip, k.eski_ref]);
      if (t.kart.length) await c.query(`UPDATE is_karti SET sahip_kullanici_ref = $2 WHERE kimlik = ANY($1::uuid[]) AND durum = 'Bekliyor'`, [t.kart, k.eski_ref]);
      if (t.personelKarti) await c.query(`UPDATE personel_karti SET kullanici_ref = $2 WHERE kullanici_ref = $1`, [k.ana_ref, k.eski_ref]);
      await c.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Aktif', birlestirilen_ana_ref = NULL WHERE kimlik = $1`, [k.eski_ref]);
      await c.query(`UPDATE hesap_birlestirme SET durum = 'Geri Alındı', geri_alan_ref = $2, geri_alma_zamani = now() WHERE kimlik = $1`, [id, o.kullanici]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Personel Hesabı Birleştirme Geri Alma', nesneTuru: 'Kullanıcı', nesneKimligi: k.eski_ref, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { durum: 'Geri Alındı' };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  s.get('/hesap-birlestirme', oturumlu, async (i, y) => {
    if (!(await yetkili(i.oturum!.kullanici))) return yok(y);
    const kisiler = (await b.db.query(`SELECT kimlik, ad_soyad, e_posta FROM kullanici_hesabi WHERE kullanici_grubu = 'LGM İç Rolü' AND birlestirilen_ana_ref IS NULL AND hesap_durumu = 'Aktif' ORDER BY ad_soyad`)).rows;
    const gecmis = (await b.db.query(`SELECT k.kimlik, a.ad_soyad ana, e.ad_soyad eski, k.gerekce, k.durum, k.zaman FROM hesap_birlestirme k JOIN kullanici_hesabi a ON a.kimlik = k.ana_ref JOIN kullanici_hesabi e ON e.kimlik = k.eski_ref ORDER BY k.zaman DESC LIMIT 50`)).rows;
    return { kisiler, gecmis };
  });
}
