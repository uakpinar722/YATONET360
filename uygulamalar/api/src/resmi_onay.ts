import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = PoolClient | Baglam['db'];
const KART = 'Resmî / Klas Onayı Değerlendirmesi';
const ACIK = `SELECT count(*) n FROM fiyat_teklifi_kalemi k JOIN kartela_kalemi m ON m.kod = k.kartela_kodu AND m.surum = k.kartela_surumu WHERE k.teklif_ref = $1 AND m.resmi_onay_gerekebilir AND k.resmi_onay_karari IS NULL`;

/** YG-1441: yat klaslı ya da ticari (Charter) kullanımdaysa ve teklifte etiketli işlem varsa Teknik Uzmana değerlendirme görevi açılır. */
export async function resmiOnayKontrol(c: Db, teklif: string): Promise<number> {
  const t = (await c.query(`SELECT f.dosya_ref, d.dosya_no, y.klas_durumu, y.kullanim_amaci FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE f.kimlik = $1`, [teklif])).rows[0];
  if (!t || (t.klas_durumu !== 'Evet' && t.kullanim_amaci !== 'Charter')) return 0;
  const n = Number((await c.query(ACIK, [teklif])).rows[0].n);
  if (!n || (await c.query(`SELECT 1 FROM is_karti WHERE tur = $2 AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [teklif, KART])).rowCount) return n;
  const tu = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)') AND bitis_zamani IS NULL ORDER BY rol = 'Teknik Uzman' DESC LIMIT 1`, [t.dosya_ref])).rows[0]?.kullanici_ref as string | undefined;
  const tm = (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Teknik Müdür'`)).rows[0]?.kimlik as string | undefined;
  await kartAc(c, { tur: KART, kategori: 'gorev', baslik: `${t.dosya_no} · Resmî / Klas Onayı Gerekebilir`, ozet: `${t.klas_durumu === 'Evet' ? 'Klaslı yat' : 'Ticari kullanım'}; ${n} işlem için Gerekli / Gerekmez işaretleyiniz.`, oncelik: 'Yüksek', ...(tu ? { sahipKullanici: tu } : { sahipRol: tm }), nesneTuru: 'Teklif', nesneKimligi: teklif });
  return n;
}

/** Teknik Rapor tablosu: dosyanın geçerli tekliflerinde Gerekli işaretlenen işlemler. */
export async function resmiOnayGerekenler(db: Db, dosya: string): Promise<{ kod: string | null; aciklama: string }[]> {
  return (await db.query(`SELECT DISTINCT k.kartela_kodu kod, k.aciklama FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref WHERE f.dosya_ref = $1 AND f.statu NOT IN ('Yerine Geçti', 'Reddedildi', 'Geri Çekildi') AND k.resmi_onay_karari = 'Gerekli' ORDER BY 1, 2`, [dosya])).rows;
}

export function resmiOnayYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  s.get('/teklif/:id/resmi-onay', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    const f = (await b.db.query(`SELECT dosya_ref FROM fiyat_teklifi WHERE kimlik = $1`, [id])).rows[0];
    if (!f || !(await dosyaErisimi(b.db, i.oturum!.kullanici, f.dosya_ref))) return yok(y);
    return (await b.db.query(`SELECT k.kimlik, k.sira_no, k.kartela_kodu, k.aciklama, k.resmi_onay_karari FROM fiyat_teklifi_kalemi k JOIN kartela_kalemi m ON m.kod = k.kartela_kodu AND m.surum = k.kartela_surumu WHERE k.teklif_ref = $1 AND m.resmi_onay_gerekebilir ORDER BY k.sira_no`, [id])).rows;
  });

  // Dosya ekibindeki Teknik Uzman / Koordinatör her etiketli satır için Gerekli / Gerekmez işaretler; tümü işaretlenince görev kapanır.
  s.post('/teklif-kalemi/:id/resmi-onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT k.teklif_ref, f.dosya_ref, m.resmi_onay_gerekebilir e FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref LEFT JOIN kartela_kalemi m ON m.kod = k.kartela_kodu AND m.surum = k.kartela_surumu WHERE k.kimlik = $1`, [id])).rows[0];
    if (!k || !(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)') AND bitis_zamani IS NULL`, [k.dosya_ref, o.kullanici])).rowCount) return yok(y);
    if (!k.e) return y.code(409).send({ hata: 'Bu işlem resmî / klas onayı etiketi taşımıyor.' });
    if (!['Gerekli', 'Gerekmez'].includes(g.karar ?? '')) return y.code(400).send({ hata: 'Gerekli veya Gerekmez seçiniz.' });
    await b.db.query(`UPDATE fiyat_teklifi_kalemi SET resmi_onay_karari = $2, resmi_onay_karar_veren_ref = $3, resmi_onay_karar_zamani = now() WHERE kimlik = $1`, [id, g.karar, o.kullanici]);
    if (!Number((await b.db.query(ACIK, [k.teklif_ref])).rows[0].n)) await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $2 AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [k.teklif_ref, KART]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Resmî / Klas Onayı Kararı', nesneTuru: 'Teklif Kalemi', nesneKimligi: id, yeni: { karar: g.karar }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  s.get('/dosya/:id/resmi-onay', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || i.oturum!.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT k.kimlik, f.teklif_no, k.sira_no, k.kartela_kodu, k.aciklama, k.resmi_onay_karari FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref JOIN kartela_kalemi m ON m.kod = k.kartela_kodu AND m.surum = k.kartela_surumu WHERE f.dosya_ref = $1 AND f.statu NOT IN ('Yerine Geçti', 'Reddedildi', 'Geri Çekildi') AND m.resmi_onay_gerekebilir ORDER BY f.teklif_no, k.sira_no`, [id])).rows;
  });
  s.get('/kartela/resmi-onay', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, ['Teknik Müdür']))) return yok(y);
    return (await b.db.query(`SELECT DISTINCT ON (kod) kod, islem FROM kartela_kalemi WHERE resmi_onay_gerekebilir ORDER BY kod, surum DESC`)).rows;
  });
  // Etiket bakımı Teknik Müdürde; etiket aynı kodun tüm kartela sürümlerinde güncellenir.
  s.post('/kartela/:kod/resmi-onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string }; const g = (i.body ?? {}) as { etiket?: boolean };
    if (!(await rolVar(o.kullanici, ['Teknik Müdür']))) return yok(y);
    if (typeof g.etiket !== 'boolean') return y.code(400).send({ hata: 'Etiket değeri geçersizdir.' });
    const r = await b.db.query(`UPDATE kartela_kalemi SET resmi_onay_gerekebilir = $2 WHERE kod = $1`, [kod, g.etiket]);
    if (!r.rowCount) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Resmî / Klas Onayı Etiketi', nesneTuru: 'Kartela Kalemi', nesneKimligi: kod, yeni: { etiket: g.etiket }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
