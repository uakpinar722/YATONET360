import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const TUR = 'Kilit Rol Ataması';
/** Onay makamı olan iç roller (CEO hariç) ve sonradan eklenen kilit roller. */
const KILIT = `SELECT kimlik FROM rol WHERE kullanici_gruplari = 'LGM İç Rolü' AND rol_adi <> 'CEO' AND rol_durumu = 'Aktif' AND (kademe IN ('Müdür', 'Direktör') OR rol_adi = 'Genel Müdür Yardımcısı') UNION SELECT rol_ref FROM kilit_rol`;

// GMY görüşü "Onaya Gönder"; CEO "Onayla" ile atama yapılır, geçici vekilin ataması kapanır.
kapanisKaydet(TUR, async (c, k, karar, yapan) => {
  const t = (await c.query(`SELECT * FROM kilit_rol_talebi WHERE kimlik = $1::uuid`, [k.nesne_kimligi])).rows[0];
  if (!t || t.durum !== 'Onayda') return;
  if (karar === 'Onayla') {
    if (t.vekil_atama_ref && t.vekil_ref !== t.aday_ref) await c.query(`UPDATE rol_atamasi SET atama_durumu = 'Kapalı', bitis_tarihi = current_date WHERE kimlik = $1`, [t.vekil_atama_ref]);
    const var_ = (await c.query(`SELECT kimlik FROM rol_atamasi WHERE kullanici_ref = $1 AND rol_ref = $2 AND atama_durumu = 'Aktif' AND (bitis_tarihi IS NULL OR bitis_tarihi >= current_date) LIMIT 1`, [t.aday_ref, t.rol_ref])).rows[0];
    if (var_) await c.query(`UPDATE rol_atamasi SET onaylayan_ref = $2 WHERE kimlik = $1 AND (atayan_ref IS NULL OR atayan_ref <> $2)`, [var_.kimlik, yapan]);
    else await c.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref, atayan_ref, onaylayan_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (kullanici_ref, rol_ref, baslangic_tarihi) DO UPDATE SET atama_durumu = 'Aktif', bitis_tarihi = NULL, onaylayan_ref = EXCLUDED.onaylayan_ref`, [t.aday_ref, t.rol_ref, t.talep_eden_ref, t.talep_eden_ref === yapan ? null : yapan]);
    await c.query(`UPDATE kilit_rol_talebi SET durum = 'Onaylandı', sonuc_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
  } else if (karar === 'Reddet') {
    await c.query(`UPDATE kilit_rol_talebi SET durum = 'Reddedildi', sonuc_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
  }
});

/**
 * YG-1480: kilit rol (onay yetkili Müdür, Direktör ve GMY rolleri) ataması Direktör talebi, GMY görüşü ve CEO onayıyla yapılır.
 * Rol boşsa talepte geçici vekil atanır; boş roller GMY ve CEO ekranında kırmızı görünür.
 */
export function kilitRolYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT r.rol_adi, r.kademe FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND (a.bitis_tarihi IS NULL OR a.bitis_tarihi >= current_date)`, [k])).rows as { rol_adi: string; kademe: string }[];
  const direktor = (r: { rol_adi: string; kademe: string }[]) => r.some((x) => x.kademe === 'Direktör');
  const ust = (r: { rol_adi: string }[]) => r.some((x) => x.rol_adi === 'CEO' || x.rol_adi === 'Genel Müdür Yardımcısı');
  const iclMi = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif'`, [k])).rowCount);

  s.get('/kilit-rol', oturumlu, async (i, y) => {
    const r = await roller(i.oturum!.kullanici); if (!direktor(r) && !ust(r)) return yok(y);
    const l = (await b.db.query(
      `SELECT r.kimlik, r.rol_adi, r.rol_sahibi_birim,
              (SELECT string_agg(h.ad_soyad, ', ') FROM rol_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref LEFT JOIN kilit_rol_talebi t ON t.vekil_atama_ref = a.kimlik AND t.durum = 'Onayda'
                WHERE a.rol_ref = r.kimlik AND a.atama_durumu = 'Aktif' AND (a.bitis_tarihi IS NULL OR a.bitis_tarihi >= current_date) AND h.hesap_durumu = 'Aktif' AND t.kimlik IS NULL) AS sahip,
              (SELECT h.ad_soyad FROM kilit_rol_talebi t JOIN kullanici_hesabi h ON h.kimlik = t.vekil_ref WHERE t.rol_ref = r.kimlik AND t.durum = 'Onayda') AS vekil,
              (SELECT t.talep_no || ' · ' || h.ad_soyad FROM kilit_rol_talebi t JOIN kullanici_hesabi h ON h.kimlik = t.aday_ref WHERE t.rol_ref = r.kimlik AND t.durum = 'Onayda') AS talep
         FROM rol r WHERE r.kimlik IN (${KILIT}) ORDER BY r.rol_adi`)).rows;
    const personel = direktor(r) ? (await b.db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif' ORDER BY ad_soyad`)).rows : [];
    return { talepEder: direktor(r), personel, roller: l.map((x) => ({ ...x, kirmizi: !x.sahip })) };
  });
  s.post('/kilit-rol/talep', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!direktor(await roller(o.kullanici))) return yok(y);
    const g = (i.body ?? {}) as { rol?: string; aday?: string; vekil?: string; gerekce?: string };
    if (!g.rol || !g.aday || !(g.gerekce ?? '').trim()) return y.code(400).send({ hata: 'Rol, aday ve gerekçe zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM (${KILIT}) k WHERE k.kimlik = $1`, [g.rol])).rowCount) return y.code(400).send({ hata: 'Bu rol kilit rol değildir.' });
    if (!(await iclMi(g.aday)) || (g.vekil && !(await iclMi(g.vekil)))) return y.code(400).send({ hata: 'Aday ve vekil LGM personeli olmalıdır.' });
    if ((await b.db.query(`SELECT 1 FROM kilit_rol_talebi WHERE rol_ref = $1 AND durum = 'Onayda'`, [g.rol])).rowCount) return y.code(409).send({ hata: 'Bu rol için onayda bekleyen talep vardır.' });
    const bos = !(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.rol_ref = $1 AND a.atama_durumu = 'Aktif' AND (a.bitis_tarihi IS NULL OR a.bitis_tarihi >= current_date) AND h.hesap_durumu = 'Aktif'`, [g.rol])).rowCount;
    if (g.vekil && !bos) return y.code(400).send({ hata: 'Rol dolu olduğundan geçici vekil atanmaz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const no = `KRA-${new Date().getFullYear()}-${String((await c.query(`SELECT nextval('kilit_rol_talep_no') n`)).rows[0].n).padStart(4, '0')}`;
      const va = g.vekil ? (await c.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref, atayan_ref) VALUES ($1,$2,$3) ON CONFLICT (kullanici_ref, rol_ref, baslangic_tarihi) DO UPDATE SET atama_durumu = 'Aktif', bitis_tarihi = NULL RETURNING kimlik`, [g.vekil, g.rol, o.kullanici])).rows[0].kimlik : null;
      const t = (await c.query(`INSERT INTO kilit_rol_talebi (talep_no, rol_ref, aday_ref, vekil_ref, vekil_atama_ref, gerekce, talep_eden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [no, g.rol, g.aday, g.vekil ?? null, va, g.gerekce!.trim(), o.kullanici])).rows[0].kimlik as string;
      const ad = (await c.query(`SELECT r.rol_adi, h.ad_soyad FROM rol r, kullanici_hesabi h WHERE r.kimlik = $1 AND h.kimlik = $2`, [g.rol, g.aday])).rows[0];
      await kartAc(c, { tur: TUR, baslik: `${no} · ${ad.rol_adi}: ${ad.ad_soyad}`, ozet: g.gerekce!.trim().slice(0, 200), oncelik: bos ? 'Yüksek' : 'Normal', hazirlayan: o.kullanici, zincir: [await rolId(c, 'Genel Müdür Yardımcısı'), await rolId(c, 'CEO')], nesneTuru: 'Kilit Rol Talebi', nesneKimligi: t });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kilit Rol Atama Talebi', nesneTuru: 'Kilit Rol Talebi', nesneKimligi: t, yeni: { rol: g.rol, aday: g.aday, vekil: g.vekil ?? null }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: t, no };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
