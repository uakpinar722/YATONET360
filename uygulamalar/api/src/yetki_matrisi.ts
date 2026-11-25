import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami } from './makam.js';

const HAZIRLAR = ['Sistem Yöneticisi', 'Bilgi İşlem Müdürü'];
const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü';
const TUR = 'Yetki Matrisi Değişikliği';

/** YG-996: onaylanan talep matrise uygulanır; kaldırılan izin rol_izni_kaldirilan kaydıyla kurulumda geri eklenmez. */
kapanisKaydet(TUR, async (c, k, karar) => {
  if (karar !== 'Onayla' && karar !== 'Reddet') return;
  const t = (await c.query(`UPDATE yetki_matrisi_talebi SET durum = $2, karar_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Onay Bekliyor' RETURNING *`, [k.nesne_kimligi, karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi'])).rows[0];
  if (!t || karar !== 'Onayla') return;
  if (t.islem === 'Ekle') {
    await c.query(`INSERT INTO rol_izni (rol_ref, izin) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [t.rol_ref, t.izin]);
    await c.query(`DELETE FROM rol_izni_kaldirilan WHERE rol_ref = $1 AND izin = $2`, [t.rol_ref, t.izin]);
  } else {
    await c.query(`DELETE FROM rol_izni WHERE rol_ref = $1 AND izin = $2`, [t.rol_ref, t.izin]);
    await c.query(`INSERT INTO rol_izni_kaldirilan (rol_ref, izin, talep_ref) VALUES ($1,$2,$3) ON CONFLICT (rol_ref, izin) DO UPDATE SET talep_ref = EXCLUDED.talep_ref, zaman = now()`, [t.rol_ref, t.izin, t.kimlik]);
  }
});

/** YG-996: yetki matrisi görünümü ve gerekçeli değişiklik talebi; yeni izin role sessizce eklenmez. */
export function yetkiMatrisiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  s.get('/yetki-matrisi', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [...HAZIRLAR, BTD]))) return yok(y);
    const rol = String(((i.query ?? {}) as { rol?: string }).rol ?? '').trim();
    const izinler = (await b.db.query(`SELECT DISTINCT izin FROM rol_izni UNION SELECT izin FROM rol_izni_kaldirilan ORDER BY 1`)).rows.map((x) => x.izin as string);
    const roller = (await b.db.query(`SELECT rol_adi FROM rol WHERE katalog_rolu ORDER BY rol_adi`)).rows.map((x) => x.rol_adi as string);
    const rolIzinleri = rol ? (await b.db.query(`SELECT z.izin FROM rol_izni z JOIN rol r ON r.kimlik = z.rol_ref WHERE r.rol_adi = $1 ORDER BY 1`, [rol])).rows.map((x) => x.izin as string) : [];
    const talepler = (await b.db.query(`SELECT t.kimlik, r.rol_adi, t.izin, t.islem, t.risk, t.gerekce, t.durum, t.olusturma_zamani, h.ad_soyad hazirlayan FROM yetki_matrisi_talebi t JOIN rol r ON r.kimlik = t.rol_ref JOIN kullanici_hesabi h ON h.kimlik = t.hazirlayan_ref ORDER BY t.olusturma_zamani DESC LIMIT 50`)).rows;
    return { izinler, roller, rolIzinleri, talepler, hazirlar: await rolVar(i.oturum!.kullanici, HAZIRLAR) };
  });

  s.post('/yetki-matrisi/talep', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, HAZIRLAR))) return y.code(403).send({ hata: 'Yetki matrisi değişikliğini Sistem Yöneticisi veya Bilgi İşlem Müdürü hazırlar.' });
    const g = (i.body ?? {}) as { rol?: string; izin?: string; islem?: string; risk?: string; gerekce?: string };
    if (!['Ekle', 'Kaldır'].includes(g.islem ?? '') || !['Düşük', 'Orta', 'Yüksek'].includes(g.risk ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'İşlemi, risk düzeyini ve işlev değişikliği gerekçesini giriniz.' });
    const r = (await b.db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [g.rol ?? ''])).rows[0]; if (!r) return y.code(400).send({ hata: 'Rol bulunamadı.' });
    const izin = g.izin?.trim() ?? '';
    if (!(await b.db.query(`SELECT 1 FROM rol_izni WHERE izin = $1 UNION SELECT 1 FROM rol_izni_kaldirilan WHERE izin = $1 LIMIT 1`, [izin])).rowCount) return y.code(400).send({ hata: 'İzin yetki matrisinde tanımlı değildir; yeni işlev izni yazılım sürümüyle tanımlanır.' });
    const var_ = Boolean((await b.db.query(`SELECT 1 FROM rol_izni WHERE rol_ref = $1 AND izin = $2`, [r.kimlik, izin])).rowCount);
    if (g.islem === 'Ekle' && var_) return y.code(409).send({ hata: 'Rol bu izne sahiptir.' });
    if (g.islem === 'Kaldır' && !var_) return y.code(409).send({ hata: 'Rolde bu izin yoktur.' });
    if ((await b.db.query(`SELECT 1 FROM yetki_matrisi_talebi WHERE rol_ref = $1 AND izin = $2 AND durum = 'Onay Bekliyor'`, [r.kimlik, izin])).rowCount) return y.code(409).send({ hata: 'Bu rol ve izin için bekleyen talep vardır.' });
    const t = (await b.db.query(`INSERT INTO yetki_matrisi_talebi (rol_ref, izin, islem, risk, gerekce, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [r.kimlik, izin, g.islem, g.risk, g.gerekce.trim(), o.kullanici])).rows[0];
    const btd = await rolId(b.db, BTD); const mk = await onayMakami(b.db, r.kimlik).catch(() => btd);
    await kartAc(b.db, { tur: TUR, baslik: `${g.rol} · ${izin} · ${g.islem}`, ozet: `Risk: ${g.risk} · ${g.gerekce.trim()}`.slice(0, 300), oncelik: g.risk === 'Yüksek' ? 'Yüksek' : 'Normal', hazirlayan: o.kullanici, zincir: mk === btd ? [btd] : [mk, btd], nesneTuru: 'Yetki Matrisi Talebi', nesneKimligi: t.kimlik });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yetki Matrisi Değişiklik Talebi', nesneTuru: 'Rol', nesneKimligi: r.kimlik, yeni: { izin, islem: g.islem, risk: g.risk }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: t.kimlik };
  });
}
