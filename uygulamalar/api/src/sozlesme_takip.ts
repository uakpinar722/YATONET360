import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const HUD = 'Hukuk ve Uyum Direktörü';
const IMZA = ['Güvenli Elektronik İmza', 'Islak İmza'];
const KARAR = ['Yenileme', 'Fesih', 'Yeniden Görüşme'];

/** YG-614: Sözleşme Sahibi rolü sözleşme türünden önerilir (LST_SOZLESME_TURU açıklaması). */
export async function sahipOnerisi(db: Db, tur: string): Promise<string | null> {
  const r = (await db.query(`SELECT aciklama FROM deger_listesi WHERE liste_kodu = 'LST_SOZLESME_TURU' AND deger = $1`, [tur])).rows[0];
  return r ? (/Sözleşme Sahibi:\s*(.+)$/.exec(r.aciklama ?? '')?.[1]?.trim() ?? null) : null;
}

/** Bitiş tarihi geçen sözleşme: Yenileme kararı ya da otomatik yenileme hükmüyle süre uzar; aksi hâlde Sona Erdi. Karar kaydedilmeden uzayan kayıt işaretlenir. */
export async function sozlesmeYenilemeIsle(db: Pool, simdi = new Date()): Promise<number> {
  const bugun = new Date(simdi.getTime() + 3 * 3_600_000).toISOString().slice(0, 10); let n = 0;
  for (const s of (await db.query(`SELECT * FROM sozlesme_kaydi WHERE durum = 'Yürürlükte' AND bitis IS NOT NULL AND bitis < $1`, [bugun])).rows) {
    const uzat = s.yenileme_karari === 'Yenileme' || (s.otomatik_yenileme && s.yenileme_karari !== 'Fesih');
    if (uzat) {
      await db.query(`UPDATE sozlesme_kaydi SET bitis = (bitis + make_interval(months => coalesce(yenileme_suresi_ay, 12)))::date, kendiliginden_yenilendi = (yenileme_karari IS NULL),
        fesih_bildirim_son = CASE WHEN fesih_bildirim_gun IS NULL THEN NULL ELSE ((bitis + make_interval(months => coalesce(yenileme_suresi_ay, 12)))::date - fesih_bildirim_gun) END, yenileme_karari = NULL, karar_tarihi = NULL WHERE kimlik = $1`, [s.kimlik]);
    } else await db.query(`UPDATE sozlesme_kaydi SET durum = 'Sona Erdi' WHERE kimlik = $1`, [s.kimlik]);
    const kime = s.sozlesme_sahibi_ref ? [s.sozlesme_sahibi_ref] : await rolSahipleri(db, await rolId(db, s.sozlesme_sahibi_rolu ?? HUD));
    if (kime.length && await birKez(db, 'sozlesme_donem', `${s.kimlik}:${s.bitis instanceof Date ? s.bitis.toISOString().slice(0, 10) : s.bitis}`))
      await bildir(db, { olay: `sozlesme_donem:${s.kimlik}`, kullanicilar: kime, baslik: uzat ? 'Sözleşme Yenilendi' : 'Sözleşme Sona Erdi', ozet: `${s.sozlesme_turu} · ${uzat ? (s.yenileme_karari ? 'Yenileme kararıyla' : 'Karar kaydedilmediği için otomatik yenileme hükmüyle') : 'Devam eden yükümlülükleri kaydınıza işleyiniz.'}` });
    n++;
  }
  return n;
}

export function sozlesmeTakipYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);
  const sahipRolleri = async () => (await b.db.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = 'LST_SOZLESME_SAHIBI'`)).rows.map((r) => r.deger as string);
  /** Hukuk ve Uyum Direktörü ve CEO tümünü; Sözleşme Sahibi rolündeki kişi kendi türlerini görür. */
  const gorur = async (k: string, sahipRol: string | null) => { const r = await roller(k); return r.includes(HUD) || r.includes('CEO') || (sahipRol !== null && r.includes(sahipRol)); };

  s.get('/sozlesme-turleri', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    const l = (await b.db.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = 'LST_SOZLESME_TURU' ORDER BY sira, deger`)).rows.map((r) => r.deger as string);
    return Promise.all(l.map(async (tur) => ({ tur, sahip: await sahipOnerisi(b.db, tur) })));
  });
  s.get('/sozlesme-takip', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const r = await roller(o.kullanici); const tum = r.includes(HUD) || r.includes('CEO');
    if (!tum && !(await sahipRolleri()).some((x) => r.includes(x))) return yok(y);
    const { rows } = await b.db.query(`SELECT s.kimlik, s.sozlesme_turu, coalesce(k.ticari_unvan, t.unvan_ad_soyad, s.taraf_adi) taraf, s.sozlesme_sahibi_rolu, s.yururluk::text, s.bitis::text, s.otomatik_yenileme, s.fesih_bildirim_son::text,
        s.durum, s.imzali_nusha_ref IS NOT NULL imzali, s.imza_turu, s.kurumsal_kanal, s.yetkili_kisiler, s.yenileme_karari, s.kendiliginden_yenilendi, cardinality(s.ekler) ek_sayisi
      FROM sozlesme_kaydi s LEFT JOIN kurulus k ON k.kimlik = s.kurulus_ref LEFT JOIN taraf t ON t.kimlik = s.taraf_ref
      WHERE $1 OR s.sozlesme_sahibi_rolu = ANY($2::text[]) ORDER BY s.durum DESC, s.bitis NULLS LAST`, [tum, r]);
    return { tum, kayitlar: rows };
  });
  s.post('/sozlesme-takip', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; kurulus?: string; taraf?: string; tarafAdi?: string; sahipRol?: string; yururluk?: string; bitis?: string; otomatikYenileme?: boolean; yenilemeAy?: number; fesihGun?: number; kanal?: string; yetkililer?: string; ekler?: string[] };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    const oneri = g.tur ? await sahipOnerisi(b.db, g.tur) : null;
    if (!g.tur || !oneri) return y.code(400).send({ hata: 'Sözleşme türünü seçiniz.' });
    const sahip = g.sahipRol || oneri;
    if (!(await sahipRolleri()).includes(sahip)) return y.code(400).send({ hata: 'Sözleşme Sahibi rolü listede yok.' });
    if (!(await gorur(o.kullanici, sahip))) return y.code(403).send({ hata: 'Sözleşmeyi Sözleşme Sahibi rolü veya Hukuk ve Uyum Direktörü kaydeder.' });
    const tarafSayi = [g.kurulus, g.taraf, g.tarafAdi?.trim()].filter(Boolean).length;
    if (tarafSayi !== 1 || (g.kurulus && !UUID.test(g.kurulus)) || (g.taraf && !UUID.test(g.taraf))) return y.code(400).send({ hata: 'Karşı tarafı tek olarak seçiniz.' });
    if (!g.yururluk || !/^\d{4}-\d{2}-\d{2}$/.test(g.yururluk)) return y.code(400).send({ hata: 'Yürürlük tarihi zorunludur.' });
    if (g.bitis && g.bitis < g.yururluk) return y.code(400).send({ hata: 'Bitiş tarihi yürürlükten önce olamaz.' });
    if ((g.bitis || g.otomatikYenileme) && !(Number(g.fesihGun) > 0)) return y.code(400).send({ hata: 'Bitiş tarihli veya otomatik yenilemeli sözleşmede fesih bildirim süresi (gün) zorunludur.' });
    if (g.otomatikYenileme && !g.bitis) return y.code(400).send({ hata: 'Otomatik yenilemede bitiş tarihi zorunludur.' });
    if (!g.kanal?.trim() || !g.yetkililer?.trim()) return y.code(400).send({ hata: 'Kurumsal kanal ve karşı tarafın yetkili kişi listesi zorunludur.' });
    const ekler = (g.ekler ?? []).filter((x) => UUID.test(x));
    const r = (await b.db.query(`INSERT INTO sozlesme_kaydi (kurulus_ref, taraf_ref, taraf_adi, sozlesme_turu, sozlesme_sahibi_rolu, yururluk, bitis, otomatik_yenileme, yenileme_suresi_ay, fesih_bildirim_gun, fesih_bildirim_son, kurumsal_kanal, yetkili_kisiler, ekler, kaydeden_ref)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $7::date IS NULL OR $10::int IS NULL THEN NULL ELSE $7::date - $10::int END, $11,$12,$13,$14) RETURNING kimlik`,
      [g.kurulus ?? null, g.taraf ?? null, g.tarafAdi?.trim() || null, g.tur, sahip, g.yururluk, g.bitis || null, Boolean(g.otomatikYenileme), g.otomatikYenileme ? Number(g.yenilemeAy) || 12 : null, Number(g.fesihGun) || null, g.kanal.trim(), g.yetkililer.trim(), ekler, o.kullanici])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sözleşme Kaydı Açıldı', nesneTuru: 'Sözleşme', nesneKimligi: r.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik, sahipRol: sahip };
  });
  // İmzalı nüsha (güvenli elektronik veya ıslak imzalı) yüklenmeden sözleşme Yürürlükte olmaz.
  s.post('/sozlesme-takip/:id/yururluk', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string; imzaTuru?: string };
    if (!UUID.test(id)) return yok(y);
    const s = (await b.db.query(`SELECT sozlesme_sahibi_rolu, durum FROM sozlesme_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!s || !(await gorur(o.kullanici, s.sozlesme_sahibi_rolu))) return yok(y);
    if (!g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'İmzalı nüshayı yükleyiniz.' });
    if (!IMZA.includes(g.imzaTuru ?? '')) return y.code(400).send({ hata: 'İmza türünü seçiniz: güvenli elektronik imza veya ıslak imza.' });
    if (s.durum !== 'Taslak') return y.code(409).send({ hata: 'Sözleşme taslak değildir.' });
    await b.db.query(`UPDATE sozlesme_kaydi SET imzali_nusha_ref = $2, imza_turu = $3, birlikte_imza = true, durum = 'Yürürlükte' WHERE kimlik = $1`, [id, g.belge, g.imzaTuru]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sözleşme Yürürlüğe Girdi', nesneTuru: 'Sözleşme', nesneKimligi: id, yeni: { imza: g.imzaTuru }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Yürürlükte' };
  });
  s.post('/sozlesme-takip/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; gerekce?: string; devamEden?: string };
    if (!UUID.test(id)) return yok(y);
    const s = (await b.db.query(`SELECT sozlesme_sahibi_rolu, durum FROM sozlesme_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!s || !(await gorur(o.kullanici, s.sozlesme_sahibi_rolu))) return yok(y);
    if (s.durum !== 'Yürürlükte') return y.code(409).send({ hata: 'Karar yürürlükteki sözleşmede verilir.' });
    if (!KARAR.includes(g.karar ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Karar (Yenileme, Fesih, Yeniden Görüşme) ve gerekçe zorunludur.' });
    await b.db.query(`UPDATE sozlesme_kaydi SET yenileme_karari = $2, karar_tarihi = current_date, karar_gerekcesi = $3, devam_eden_yukumlulukler = coalesce($4, devam_eden_yukumlulukler) WHERE kimlik = $1`, [id, g.karar, g.gerekce.trim(), g.devamEden?.trim() || null]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Sözleşme Kararı: ${g.karar}`, nesneTuru: 'Sözleşme', nesneKimligi: id, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
