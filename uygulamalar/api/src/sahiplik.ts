import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const YONETIM = ['CEO', 'Genel Müdür Yardımcısı'];

/**
 * YG-998: modül ve veri kümesi sahipliği rol kimliğiyle tutulur. Görev değiştiğinde CEO veya GMY gerekçeyle devreder: modül ve veri kümesi
 * sahipliği, kalite kuralı sahipliği, role açık görevler ve bekleyen onayların henüz gelinmemiş makamları yeni role geçer; istenirse
 * eski rolün izinleri yeni role eklenir (eski rolden kaldırılmaz). Devredilen kayıt sayıları kaydedilir.
 */
export function sahiplikYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yonetim = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[])`, [k, YONETIM])).rowCount);
  const rol = async (ad: unknown) => (typeof ad === 'string' ? ((await b.db.query(`SELECT kimlik, rol_adi FROM rol WHERE rol_adi = $1`, [ad])).rows[0] as { kimlik: string; rol_adi: string } | undefined) : undefined);

  s.get('/sahiplik', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    return {
      yonetir: await yonetim(i.oturum!.kullanici),
      moduller: (await b.db.query(`SELECT m.modul, r.rol_adi sahip FROM modul_sahipligi m JOIN rol r ON r.kimlik = m.sahip_rol_ref ORDER BY m.modul`)).rows,
      veriKumeleri: (await b.db.query(`SELECT kod, ad, sahip_rol sahip FROM veri_kumesi ORDER BY kod`)).rows,
      devirler: (await b.db.query(`SELECT e.rol_adi eski, n.rol_adi yeni, d.gerekce, d.izinler_devredildi, d.sayilar, d.zaman FROM sahiplik_devri d JOIN rol e ON e.kimlik = d.eski_rol_ref JOIN rol n ON n.kimlik = d.yeni_rol_ref ORDER BY d.zaman DESC LIMIT 50`)).rows,
    };
  });
  s.post('/sahiplik/modul', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await yonetim(o.kullanici))) return yok(y);
    const g = (i.body ?? {}) as { modul?: string; sahipRol?: string }; const r = await rol(g.sahipRol);
    if (!g.modul?.trim() || !r) return y.code(400).send({ hata: 'Modül ve sahip rol zorunludur.' });
    await b.db.query(`INSERT INTO modul_sahipligi (modul, sahip_rol_ref, guncelleyen_ref) VALUES ($1,$2,$3) ON CONFLICT (modul) DO UPDATE SET sahip_rol_ref = EXCLUDED.sahip_rol_ref, guncelleyen_ref = EXCLUDED.guncelleyen_ref, guncelleme_zamani = now()`, [g.modul.trim(), r.kimlik, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Modül Sahipliği', nesneTuru: 'Modül', nesneKimligi: g.modul.trim(), yeni: { sahip: r.rol_adi }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/sahiplik/devir', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await yonetim(o.kullanici))) return yok(y);
    const g = (i.body ?? {}) as { eskiRol?: string; yeniRol?: string; gerekce?: string; izinler?: boolean };
    const e = await rol(g.eskiRol), n = await rol(g.yeniRol);
    if (!e || !n || e.kimlik === n.kimlik || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Farklı iki rol ve gerekçe zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const say = async (sql: string, p: unknown[]) => (await c.query(sql, p)).rowCount ?? 0;
      const sayilar = {
        modul: await say(`UPDATE modul_sahipligi SET sahip_rol_ref = $2, guncelleyen_ref = $3, guncelleme_zamani = now() WHERE sahip_rol_ref = $1`, [e.kimlik, n.kimlik, o.kullanici]),
        veriKumesi: await say(`UPDATE veri_kumesi SET sahip_rol = $2, guncelleyen_ref = $3, zaman = now() WHERE sahip_rol = $1`, [e.rol_adi, n.rol_adi, o.kullanici]),
        kaliteKurali: await say(`UPDATE kalite_kurali SET sahip_rol = $2 WHERE sahip_rol = $1 AND durum = 'Yürürlükte'`, [e.rol_adi, n.rol_adi]),
        gorev: await say(`UPDATE is_karti SET sahip_rol_ref = $2 WHERE sahip_rol_ref = $1 AND durum = 'Bekliyor'`, [e.kimlik, n.kimlik]),
        onay: await say(`UPDATE is_karti SET zincir = zincir[1:kademe] || array_replace(zincir[kademe + 1:], $1, $2) WHERE durum = 'Bekliyor' AND kategori = 'onay' AND $1 = ANY (zincir[kademe + 1:])`, [e.kimlik, n.kimlik]),
        izin: g.izinler ? await say(`INSERT INTO rol_izni (rol_ref, izin) SELECT $2, z.izin FROM rol_izni z WHERE z.rol_ref = $1 AND NOT EXISTS (SELECT 1 FROM rol_izni x WHERE x.rol_ref = $2 AND x.izin = z.izin)`, [e.kimlik, n.kimlik]) : 0,
      };
      await c.query(`INSERT INTO sahiplik_devri (eski_rol_ref, yeni_rol_ref, gerekce, izinler_devredildi, sayilar, yapan_ref) VALUES ($1,$2,$3,$4,$5,$6)`, [e.kimlik, n.kimlik, g.gerekce.trim(), Boolean(g.izinler), JSON.stringify(sayilar), o.kullanici]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sahiplik Devri', nesneTuru: 'Rol', nesneKimligi: e.kimlik, yeni: { yeniRol: n.rol_adi, ...sayilar }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { sayilar };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
