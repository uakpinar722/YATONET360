import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { parametre } from './teklif.js';
import { UUID } from './yat.js';

type Db = PoolClient | Pool;
const KART = 'Risk Rezervi Talebi'; const TOD = 'Teknik ve Operasyon Direktörü'; const OPM = 'Operasyon Müdürü';
const ONAY = `('Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü')`;
const R2 = (x: number) => Math.round(x * 100) / 100;
const GORUR = ['Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', 'Ticari İşler Direktörü', 'Genel Müdür Yardımcısı', 'CEO', 'Muhasebe ve Finans Müdürü', 'Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdür Yardımcısı', OPM, TOD];

export interface Butce { temelCizgi: number; guncelButce: number; gerceklesen: number; acikTaahhut: number; bitisTahmini: number; bekleyenDegisiklik: number; rezervOrani: number; rezerv: number; rezervKullanilan: number; rezervKalan: number; rezervKullanimOrani: number; asimOrani: number }

/** YG-863: temel çizgi ilk onaylı teklifin maliyetidir ve değişmez; bekleyen değişiklik güncel bütçeye katılmaz. */
export async function dosyaButcesi(db: Db, dosya: string): Promise<Butce> {
  const tek = async (sql: string) => Number((await db.query(sql, [dosya])).rows[0].t ?? 0);
  const mal = `coalesce(sum(k.birim_maliyet_eur * k.miktar), 0) t FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref WHERE f.dosya_ref = $1`;
  const temelCizgi = await tek(`SELECT ${mal} AND k.onay_durumu = 'Onaylandı' AND f.kimlik = (SELECT x.kimlik FROM fiyat_teklifi x WHERE x.dosya_ref = $1 AND x.karar IN ${ONAY} ORDER BY x.karar_zamani NULLS LAST, x.olusturma_zamani LIMIT 1)`);
  const guncelButce = await tek(`SELECT ${mal} AND k.onay_durumu = 'Onaylandı' AND f.statu = 'Karar' AND f.karar IN ${ONAY}`);
  const bekleyenDegisiklik = await tek(`SELECT ${mal} AND f.statu IN ('Taslak', 'İç Onayda', 'Onaylı', 'Gönderildi')`);
  const hakedis = await tek(`SELECT coalesce(sum(bu_donem_brut), 0) t FROM hakedis WHERE dosya_ref = $1 AND statu <> 'Reddedildi'`);
  const parcaGercek = await tek(`SELECT coalesce(sum(k.toplam_eur), 0) t FROM tedarik_siparisi_kalemi k JOIN tedarik_siparisi s ON s.kimlik = k.siparis_ref WHERE s.dosya_ref = $1 AND s.statu IN ('Teslim Alındı', 'Kapalı')`);
  const parcaAcik = await tek(`SELECT coalesce(sum(k.toplam_eur), 0) t FROM tedarik_siparisi_kalemi k JOIN tedarik_siparisi s ON s.kimlik = k.siparis_ref WHERE s.dosya_ref = $1 AND s.statu IN ('Verildi', 'Kısmi Teslim')`);
  const isEmri = await tek(`SELECT coalesce(sum(greatest(e.firma_bedeli_eur - coalesce((SELECT sum(h.bu_donem_brut) FROM hakedis h WHERE h.is_emri_ref = e.kimlik AND h.statu <> 'Reddedildi'), 0), 0)), 0) t FROM is_emri e WHERE e.dosya_ref = $1 AND e.firma_bedeli_eur IS NOT NULL AND e.statu NOT IN ('Taslak', 'İç Onayda', 'İptal', 'Yerine Geçti', 'Kapalı')`);
  const ozel = Number((await db.query(`SELECT risk_rezerv_orani o FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]?.o ?? 0);
  const rezervOrani = ozel > 0 ? ozel : await parametre(db, 'risk_rezerv_orani');
  const rezerv = R2(guncelButce * rezervOrani);
  const rezervKullanilan = await tek(`SELECT coalesce(sum(tutar_eur), 0) t FROM risk_rezerv_talebi WHERE dosya_ref = $1 AND tur = 'Kullanım' AND durum = 'Onaylandı'`);
  const gerceklesen = R2(hakedis + parcaGercek); const acikTaahhut = R2(isEmri + parcaAcik); const bitisTahmini = R2(gerceklesen + acikTaahhut);
  return { temelCizgi: R2(temelCizgi), guncelButce: R2(guncelButce), gerceklesen, acikTaahhut, bitisTahmini, bekleyenDegisiklik: R2(bekleyenDegisiklik), rezervOrani, rezerv, rezervKullanilan: R2(rezervKullanilan), rezervKalan: R2(rezerv - rezervKullanilan), rezervKullanimOrani: rezerv > 0 ? rezervKullanilan / rezerv : 0, asimOrani: guncelButce > 0 ? (bitisTahmini - guncelButce - rezervKullanilan) / guncelButce : 0 };
}

/** YG-862, YG-780: rezerv %80 kullanımda ve bütçe %10 aşımda Teknik ve Operasyon Direktörüne bir kez erken uyarı. */
export async function butceUyariKontrol(c: Db, dosya: string, dosyaNo: string): Promise<void> {
  const v = await dosyaButcesi(c, dosya);
  const ac = async (anahtar: string, baslik: string, ozet: string) => { if (await birKez(c, anahtar, dosya)) await kartAc(c, { tur: 'Bütçe Erken Uyarısı', kategori: 'gorev', baslik: `${dosyaNo} · ${baslik}`, ozet, oncelik: 'Yüksek', sahipRol: await rolId(c, TOD), nesneTuru: 'Dosya', nesneKimligi: dosya }); };
  if (v.rezerv > 0 && v.rezervKullanimOrani >= await parametre(c, 'risk_rezerv_uyari_orani')) await ac('rezerv_uyari', 'Risk Rezervi Erken Uyarısı', `Rezervin %${Math.round(v.rezervKullanimOrani * 100)} kadarı kullanıldı.`);
  if (v.guncelButce > 0 && v.asimOrani > await parametre(c, 'butce_asim_uyari_orani')) await ac('butce_asim_uyari', 'Bütçe Aşımı Erken Uyarısı', `Bitiş tahmini onaylı bütçeyi %${Math.round(v.asimOrani * 100)} aşıyor.`);
}

export async function butceIzle(db: Pool): Promise<void> {
  for (const d of (await db.query(`SELECT DISTINCT d.kimlik, d.dosya_no FROM dosya d JOIN fiyat_teklifi f ON f.dosya_ref = d.kimlik WHERE d.statu NOT IN ('Kapalı', 'Teknik Kapalı') AND f.statu = 'Karar' AND f.karar IN ${ONAY}`)).rows) await butceUyariKontrol(db, d.kimlik, d.dosya_no);
}

kapanisKaydet(KART, async (c, k, karar, yapan) => {
  const t = (await c.query(`SELECT r.*, d.dosya_no FROM risk_rezerv_talebi r JOIN dosya d ON d.kimlik = r.dosya_ref WHERE r.kimlik = $1 AND r.durum = 'Onayda'`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Onayla') {
    if (t.tur === 'Kullanım' && Number(t.tutar_eur) > (await dosyaButcesi(c, t.dosya_ref)).rezervKalan) throw Object.assign(new Error('Talep tutarı kullanılabilir rezervi aşmaktadır.'), { statusCode: 409 });
    await c.query(`UPDATE risk_rezerv_talebi SET durum = 'Onaylandı', karar_veren_ref = $2, karar_zamani = now() WHERE kimlik = $1`, [t.kimlik, yapan]);
    if (t.tur === 'Oran Değişikliği') await c.query(`UPDATE dosya SET risk_rezerv_orani = $2 WHERE kimlik = $1`, [t.dosya_ref, t.yeni_oran]);
    await butceUyariKontrol(c, t.dosya_ref, t.dosya_no);
  } else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') await c.query(`UPDATE risk_rezerv_talebi SET durum = $2, karar_veren_ref = $3, karar_zamani = now() WHERE kimlik = $1`, [t.kimlik, karar === 'Reddet' ? 'Reddedildi' : 'İade Edildi', yapan]);
});

export function riskRezerviYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const gorur = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, GORUR])).rowCount);
  const dsMi = async (d: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = 'Dosya Sorumlusu' AND bitis_zamani IS NULL`, [d, k])).rowCount);

  // Tutarlar yalnız maliyet görebilen rollere; rezerv maliyetin oranı olduğu için Dosya Sorumlusu yalnız kendi talebinin durumunu görür.
  s.get('/dosya/:id/risk-rezervi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const yetkili = await gorur(o.kullanici);
    return { butce: yetkili ? await dosyaButcesi(b.db, id) : null, talepAcabilir: await dsMi(id, o.kullanici), talepler: (await b.db.query(`SELECT kimlik, tur, tutar_eur, yeni_oran, gerekce, durum, olusturma_zamani FROM risk_rezerv_talebi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`, [id])).rows };
  });

  s.post('/dosya/:id/risk-rezervi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; tutar?: unknown; oran?: unknown; gerekce?: string };
    if (!UUID.test(id) || !(await dsMi(id, o.kullanici))) return yok(y);
    const tutar = Number(g.tutar); const oran = Number(g.oran);
    if (!['Kullanım', 'Oran Değişikliği'].includes(g.tur ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Talep türü ve gerekçe zorunludur.' });
    if (g.tur === 'Kullanım' && !(tutar > 0)) return y.code(400).send({ hata: 'Tutar geçersizdir.' });
    if (g.tur === 'Oran Değişikliği' && !(oran > 0 && oran < 1)) return y.code(400).send({ hata: 'Oran geçersizdir.' });
    const v = await dosyaButcesi(b.db, id);
    if (g.tur === 'Kullanım' && tutar > v.rezervKalan) return y.code(409).send({ hata: 'Talep tutarı kullanılabilir rezervi aşmaktadır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      const r = (await c.query(`INSERT INTO risk_rezerv_talebi (dosya_ref, tur, tutar_eur, yeni_oran, gerekce, talep_eden_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, g.tur, g.tur === 'Kullanım' ? tutar : null, g.tur === 'Oran Değişikliği' ? oran : null, g.gerekce.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: KART, baslik: `${d.dosya_no} · Risk Rezervi ${g.tur}`, ozet: g.gerekce.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, OPM), await rolId(c, TOD)], nesneTuru: 'Risk Rezervi', nesneKimligi: r.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Risk Rezervi Talebi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { tur: g.tur }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: r.kimlik };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
