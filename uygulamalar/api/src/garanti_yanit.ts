import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { belgeUret } from './belge_uret.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy, tutar, type Dil } from './metin.js';
import type { BelgeTanim, Bolum, Hucre } from './pdf.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let metin: Record<Dil, Record<string, any>> | undefined;
const M = (dil: Dil) => { metin ??= JSON.parse(readFileSync(join(KOK, 'veri', 'sablon', 'garanti_yanit.json'), 'utf8')); return metin![dil]!; };

export const VARYANTLAR = ['Garanti Değerlendirme Sonucu', 'Şikâyet Yanıtı', 'İtiraz İnceleme Sonucu', 'Ara Bilgilendirme', 'Takip Kontrolü', 'Talep Yanıtı'] as const;
/** Başvuru yolları bölümü yalnız karar bildiren varyantlarda basılır. */
const KARARLI = ['Garanti Değerlendirme Sonucu', 'Şikâyet Yanıtı', 'İtiraz İnceleme Sonucu'];
const HAZIRLAYAN = 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı';
const ONAYCI = 'Müşteri ve Paydaş İlişkileri Müdürü';
/** Bedel yat sahibine yansıtılmayan sonuçlar. */
const BEDELSIZ = ['Haklı – Düzeltildi', 'Garanti', 'İyi Niyet', 'Üretici Garantisi'];
const anSaat = (z: Date | string) => `${gunAy(z)} ${new Date(z).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}`;

kapanisKaydet('Garanti Şikâyet Yanıtı', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') {
    const y = (await c.query(`UPDATE garanti_sikayet_yazisi SET durum = 'Onaylı', onaylayan_ref = $2, onay_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Onayda' RETURNING kimlik, kayit_ref, varyant, yazi_no, duzeltme_tarihi`, [k.nesne_kimligi, yapan])).rows[0];
    if (!y) return;
    const g = (await c.query(`SELECT g.dosya_ref, g.kayit_no, g.sikayet_sonucu, (SELECT eposta FROM dosya_tarafi WHERE dosya_ref = g.dosya_ref AND aktif AND taraf_rolu IN ('Yat Sahibi', 'Yetkili Temsilci') AND eposta IS NOT NULL ORDER BY taraf_rolu = 'Yat Sahibi' DESC LIMIT 1) eposta FROM garanti_sikayet g WHERE g.kimlik = $1`, [y.kayit_ref])).rows[0];
    if (KARARLI.includes(y.varyant)) await c.query(`UPDATE garanti_sikayet SET yanit_zamani = coalesce(yanit_zamani, now()) WHERE kimlik = $1`, [y.kayit_ref]);
    // YG-728: düzeltilen şikâyette 30 gün sonra Takip Kontrolü görevi.
    if (y.varyant === 'Şikâyet Yanıtı' && g.sikayet_sonucu === 'Haklı – Düzeltildi') {
      const son = new Date(y.duzeltme_tarihi ?? Date.now()); son.setDate(son.getDate() + 30);
      await c.query(`UPDATE garanti_sikayet SET takip_son = $2 WHERE kimlik = $1`, [y.kayit_ref, son]);
      await kartAc(c, { tur: 'Takip Kontrolü', kategori: 'gorev', baslik: `${g.kayit_no} · Takip Kontrolü`, ozet: 'Düzeltmeden 30 gün sonra yat sahibiyle iletişime geçiniz; sonucu Takip Kontrolü yazısıyla bildiriniz.', sahipRol: await rolId(c, HAZIRLAYAN), sonZaman: son, nesneTuru: 'Garanti Şikâyet', nesneKimligi: y.kayit_ref });
    }
    await belgeUret(c, { tur: 'Garanti Şikâyet Yanıtı', nesne: y.kimlik, dosya: g.dosya_ref, gonder: g.eposta ? { olay: `garanti-yanit:${y.kimlik}`, eposta: g.eposta, konu: `${y.yazi_no} ${y.varyant}`, metin: `${y.yazi_no} ${y.varyant}` } : undefined });
  } else if (karar === 'Reddet') await c.query(`UPDATE garanti_sikayet_yazisi SET durum = 'Reddedildi' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
});

/** YG-728: FR-KLT-016; metinler onaylı şablondan (ŞABLONLAR\FR-KLT-016, TR/EN). Konu paragrafı yalnız Şikâyet Yanıtı için onaylıdır; diğer varyantlarda konu satırı varyant adıdır. */
export async function garantiYanitTanim(db: Db, id: string): Promise<{ dosyaAdi: string; sinif: string; t: BelgeTanim }> {
  const y = (await db.query(`SELECT y.*, h.rol_adi hazirlayan_rol, o2.rol_adi onaylayan_rol FROM garanti_sikayet_yazisi y
    LEFT JOIN LATERAL (SELECT r.rol_adi FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = y.hazirlayan_ref AND a.atama_durumu = 'Aktif' AND r.rol_adi IN ('Dosya Sorumlusu', '${HAZIRLAYAN}') ORDER BY r.rol_adi = '${HAZIRLAYAN}' DESC LIMIT 1) h ON true
    LEFT JOIN LATERAL (SELECT '${ONAYCI}'::text rol_adi WHERE y.onaylayan_ref IS NOT NULL) o2 ON true WHERE y.kimlik = $1`, [id])).rows[0];
  const g = (await db.query(`SELECT g.*, d.dosya_no, d.bildirim_tarihi, d.yazisma_dili, d.musteri_turu, yt.yat_adi FROM garanti_sikayet g JOIN dosya d ON d.kimlik = g.dosya_ref JOIN yat yt ON yt.kimlik = d.yat_ref WHERE g.kimlik = $1`, [y.kayit_ref])).rows[0];
  const dil: Dil = g.yazisma_dili === 'İngilizce' ? 'en' : 'tr'; const T = M(dil); const en = dil === 'en';
  const sikayet = (g.kayit_turu as string[]).includes('Şikâyet');
  const V = (T.varyant as Record<string, string>)[y.varyant] ?? y.varyant;
  const sonuc = y.varyant === 'İtiraz İnceleme Sonucu' ? g.itiraz_sonucu : sikayet ? g.sikayet_sonucu : g.karar;
  const sonucYaz = (s: string | null) => (s ? (T.sonuclar as Record<string, string>)[s] ?? s : null);
  const ekip = (await db.query(`SELECT a.rol, h.cep_telefonu, h.e_posta FROM dosya_ekibi_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.dosya_ref = $1 AND a.bitis_zamani IS NULL AND a.rol IN ('Dosya Sorumlusu', 'Ticari Sorumlu') ORDER BY a.rol`, [g.dosya_ref])).rows;
  const islemler = (y.islemler ?? []) as { islem: string; tarih?: string; durum?: string }[];
  const bolumler: Bolum[] = [
    { baslik: T.b1, tur: 'alanlar', alanlar: [{ et: T.kayitNo, deger: g.kayit_no }, { et: T.dosyaNo, deger: g.dosya_no }, { et: T.yat, deger: g.yat_adi },
      { et: sikayet ? T.sikayetT : T.bildirimT, deger: gunAy(g.bildirim_zamani) }, { et: T.kanal, deger: g.kanal },
      ...(sikayet && g.yanit_son ? [{ et: T.sure, deger: String(T.sureD).replace('{son}', gunAy(g.yanit_son)) }] : [])] },
    { baslik: sikayet ? T.b2s : T.b2g, tur: 'alanlar', alanlar: [{ et: T.ozet, deger: g.sikayet_konusu ?? g.belirti, genis: true }] },
    { baslik: T.b3, tur: 'alanlar', alanlar: [{ et: T.inceleme, deger: y.inceleme, genis: true }, { et: T.sonuc, deger: sonucYaz(sonuc) }, ...(BEDELSIZ.includes(sonuc ?? '') ? [{ et: T.bedel, deger: T.bedelD }] : [])] },
  ];
  const sat: Hucre[][] = islemler.map((x, n) => [n + 1, x.islem, x.tarih ?? null, x.durum ?? null]);
  const duzeltildi = y.varyant === 'Şikâyet Yanıtı' && g.sikayet_sonucu === 'Haklı – Düzeltildi' && y.duzeltme_tarihi;
  if (duzeltildi) { const t = new Date(y.duzeltme_tarihi); t.setDate(t.getDate() + 30); sat.push([sat.length + 1, T.takip, gunAy(t), T.planlandi]); }
  if (sat.length) bolumler.push({ baslik: T.b4, tur: 'tablo', sutunlar: [{ ad: T.no, hiza: 'ort' }, { ad: T.islem }, { ad: T.tarih, hiza: 'ort' }, { ad: T.durum, hiza: 'ort' }], satirlar: sat });
  if (duzeltildi) bolumler.push({ baslik: T.b4, tur: 'metin', numarasiz: true, metin: String(T.garantiYeniden).replace('{tarih}', gunAy(y.duzeltme_tarihi)) });
  if (KARARLI.includes(y.varyant)) {
    const sinir = (await db.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'hakem_heyeti_siniri_tl'`)).rows[0]?.deger;
    bolumler.push({ baslik: T.b5, tur: 'alanlar', alanlar: [{ et: T.itiraz, deger: T.itirazD, genis: true }, { et: T.diger, deger: String(T.digerD).replace('{sinir}', tutar(Number(sinir), dil)), genis: true }] });
  }
  bolumler.push({ baslik: T.b6, tur: 'tablo', sutunlar: [{ ad: T.gorev }, { ad: T.tel }, { ad: T.eposta }], satirlar: ekip.map((x) => [x.rol === 'Dosya Sorumlusu' ? T.ds : T.ts, x.cep_telefonu, x.e_posta]) });
  bolumler.push({ baslik: T.onay, tur: 'alanlar', numarasiz: true, alanlar: [{ et: T.hazirlayan, deger: `${y.hazirlayan_rol ? (T.roller as Record<string, string>)[y.hazirlayan_rol] ?? y.hazirlayan_rol : '---'} · ${anSaat(y.olusturma_zamani)} · YATONET 360` },
    ...(y.onay_zamani ? [{ et: T.onaylayan, deger: `${(T.roller as Record<string, string>)[ONAYCI]} · ${anSaat(y.onay_zamani)} · YATONET 360` }] : [])] });
  // Konu tarihi: itirazda itiraz, takipte düzeltme, diğerlerinde bildirim tarihi.
  const duz = y.varyant === 'Takip Kontrolü' ? (await db.query(`SELECT duzeltme_tarihi FROM garanti_sikayet_yazisi WHERE kayit_ref = $1 AND duzeltme_tarihi IS NOT NULL ORDER BY olusturma_zamani DESC LIMIT 1`, [y.kayit_ref])).rows[0]?.duzeltme_tarihi : null;
  const kt = y.varyant === 'İtiraz İnceleme Sonucu' && g.itiraz_zamani ? g.itiraz_zamani : duz ?? g.bildirim_zamani;
  const konu = y.varyant === 'Şikâyet Yanıtı' ? `${T.konuS} ${String(T.konuSD).replace('{tarih}', gunAy(g.bildirim_zamani))}` : T.konuV?.[y.varyant] ? String(T.konuV[y.varyant]).replace('{tarih}', gunAy(kt)) : `${T.konu}: ${V.toLocaleUpperCase(en ? 'en' : 'tr-TR')}`;
  const sozlesme = g.musteri_turu === 'Sigorta Şirketi' ? T.sozlesmeSg : T.sozlesme;
  return {
    dosyaAdi: `${y.yazi_no}.pdf`, sinif: 'Gizli',
    t: { ad: T.ad, kod: 'FR-KLT-016', no: y.yazi_no, dosyaNo: g.dosya_no, tarih: gunAy(y.onay_zamani ?? y.olusturma_zamani), surum: 'Rev.1', dil, yat: g.yat_adi,
      bandEk: [{ et: T.kayitNo, deger: g.kayit_no }],
      matbuBas: [String(T.hitap).replace('{tarih}', gunAy(g.bildirim_tarihi)).replace('{dosya}', g.dosya_no), konu], bolumler,
      matbuSon: [sozlesme, T.gizli, T.tesekkur] } as BelgeTanim,
  };
}

export function garantiYanitYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2) LIMIT 1`, [k, r])).rowCount);
  const kayit = async (id: string, k: string) => { if (!UUID.test(id)) return null; const g = (await b.db.query(`SELECT g.*, d.dosya_no, d.dosya_sorumlusu_ref FROM garanti_sikayet g JOIN dosya d ON d.kimlik = g.dosya_ref WHERE g.kimlik = $1`, [id])).rows[0]; return g && ((await dosyaErisimi(b.db, k, g.dosya_ref)) || (await rolVar(k, [HAZIRLAYAN, ONAYCI]))) ? g : null; }; // şikâyet yönetimi müşteri ilişkileri birimindedir
  const hazirlayabilir = async (g: Record<string, any>, k: string) => g.dosya_sorumlusu_ref === k || await rolVar(k, [HAZIRLAYAN]);
  /** İtirazı ilk kararı vermeyen üst kademe inceler: ilk karar Teknik Müdürden değilse Teknik Müdür, değilse Genel Müdür Yardımcısı. */
  const ustKademe = async (g: Record<string, any>) => (g.karar_veren_ref && (await rolVar(g.karar_veren_ref, ['Teknik Müdür'])) ? 'Genel Müdür Yardımcısı' : 'Teknik Müdür');

  s.get('/garanti-sikayet/:id/yanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = await kayit((i.params as { id: string }).id, o.kullanici); if (!g) return yok(y);
    const yazilar = (await b.db.query(`SELECT kimlik, yazi_no, varyant, durum, olusturma_zamani FROM garanti_sikayet_yazisi WHERE kayit_ref = $1 ORDER BY olusturma_zamani`, [g.kimlik])).rows;
    return { yazilar, hazirlar: await hazirlayabilir(g, o.kullanici), itiraz: { zaman: g.itiraz_zamani, son: g.itiraz_son, makam: g.itiraz_makami, sonuc: g.itiraz_sonucu }, itirazKarar: Boolean(g.itiraz_zamani && !g.itiraz_sonucu && g.itiraz_makami && g.karar_veren_ref !== o.kullanici && (await rolVar(o.kullanici, [g.itiraz_makami]))), yanitVar: Boolean(g.yanit_zamani), takipSon: g.takip_son };
  });

  s.post('/garanti-sikayet/:id/yanit-yazisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = await kayit((i.params as { id: string }).id, o.kullanici); if (!g) return yok(y);
    const v = (i.body ?? {}) as { varyant?: string; inceleme?: string; islemler?: { islem?: string; tarih?: string; durum?: string }[]; duzeltmeTarihi?: string };
    if (!(await hazirlayabilir(g, o.kullanici))) return y.code(403).send({ hata: `Yanıt yazısını Dosya Sorumlusu veya ${HAZIRLAYAN} hazırlar.` });
    if (!VARYANTLAR.includes(v.varyant as never)) return y.code(400).send({ hata: `Varyantı seçiniz: ${VARYANTLAR.join(', ')}.` });
    const sikayet = (g.kayit_turu as string[]).includes('Şikâyet');
    if (v.varyant === 'Şikâyet Yanıtı' && (!sikayet || !g.sikayet_sonucu)) return y.code(409).send({ hata: 'Şikâyet yanıtı için önce şikâyet sonucunu kaydediniz.' });
    if (v.varyant === 'Garanti Değerlendirme Sonucu' && (sikayet || !g.karar)) return y.code(409).send({ hata: 'Garanti değerlendirme sonucu için önce kapsam kararını kaydediniz.' });
    if (v.varyant === 'İtiraz İnceleme Sonucu' && !g.itiraz_sonucu) return y.code(409).send({ hata: 'İtiraz inceleme sonucu henüz verilmemiştir.' });
    if (KARARLI.includes(v.varyant!) && !v.inceleme?.trim()) return y.code(400).send({ hata: 'İnceleme bölümünü yazınız.' });
    if (v.varyant === 'Şikâyet Yanıtı' && g.sikayet_sonucu === 'Haklı – Düzeltildi' && !v.duzeltmeTarihi) return y.code(400).send({ hata: 'Düzeltmenin tamamlandığı tarihi giriniz; garanti yeniden bu tarihten başlar.' });
    if (KARARLI.includes(v.varyant!) && (await b.db.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'hakem_heyeti_siniri_tl'`)).rows[0]?.deger == null) return y.code(409).send({ hata: 'Hakem heyeti parasal sınırı parametresi tanımlı değildir.' });
    if ((await b.db.query(`SELECT 1 FROM garanti_sikayet_yazisi WHERE kayit_ref = $1 AND durum = 'Onayda'`, [g.kimlik])).rowCount) return y.code(409).send({ hata: 'Onayda bekleyen yanıt yazısı vardır.' });
    const islemler = (v.islemler ?? []).filter((x) => x.islem?.trim()).map((x) => ({ islem: x.islem!.trim(), tarih: x.tarih?.trim() || undefined, durum: x.durum?.trim() || undefined }));
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const n = Number((await c.query(`SELECT count(*) n FROM garanti_sikayet_yazisi WHERE kayit_ref = $1`, [g.kimlik])).rows[0].n) + 1;
      const r = (await c.query(`INSERT INTO garanti_sikayet_yazisi (kayit_ref, yazi_no, varyant, inceleme, islemler, duzeltme_tarihi, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik, yazi_no`,
        [g.kimlik, `${g.kayit_no}-Y${n}`, v.varyant, v.inceleme?.trim() || null, JSON.stringify(islemler), v.duzeltmeTarihi || null, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Garanti Şikâyet Yanıtı', baslik: `${r.yazi_no} · ${v.varyant}`, ozet: g.sikayet_konusu ?? g.belirti ?? undefined, hazirlayan: o.kullanici, zincir: [await rolId(c, ONAYCI)], nesneTuru: 'Garanti Şikâyet Yazısı', nesneKimligi: r.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Garanti Şikâyet Yanıt Yazısı Onaya Gönderildi', nesneTuru: 'Dosya', nesneKimligi: g.dosya_ref, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, yaziNo: r.yazi_no, gonderilecek: ONAYCI };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-728: yat sahibinin itirazı yanıttan sonra 15 gün içinde kaydedilir; ilk kararı vermeyen üst kademe 120 saat içinde karar verir.
  s.post('/garanti-sikayet/:id/itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = await kayit((i.params as { id: string }).id, o.kullanici); if (!g) return yok(y);
    const { aciklama } = (i.body ?? {}) as { aciklama?: string };
    if (!(await hazirlayabilir(g, o.kullanici))) return y.code(403).send({ hata: `İtirazı Dosya Sorumlusu veya ${HAZIRLAYAN} kaydeder.` });
    if (!aciklama?.trim()) return y.code(400).send({ hata: 'İtiraz açıklamasını yazınız.' });
    if (!g.yanit_zamani) return y.code(409).send({ hata: 'Yanıt verilmemiş kayda itiraz kaydedilemez.' });
    if (g.itiraz_zamani) return y.code(409).send({ hata: 'Bu kayıtta itiraz zaten kaydedilmiştir.' });
    if (Date.now() - new Date(g.yanit_zamani).getTime() > 15 * 86_400_000) return y.code(409).send({ hata: 'İtiraz süresi (yanıttan sonra 15 gün) geçmiştir.' });
    const makam = await ustKademe(g); const son = new Date(Date.now() + 120 * 3_600_000);
    await b.db.query(`UPDATE garanti_sikayet SET itiraz_zamani = now(), itiraz_son = $2, itiraz_aciklamasi = $3, itiraz_makami = $4 WHERE kimlik = $1`, [g.kimlik, son, aciklama.trim(), makam]);
    await kartAc(b.db, { tur: 'Şikâyet İtirazı', kategori: 'islem', baslik: `${g.kayit_no} · İtiraz İncelemesi`, ozet: aciklama.trim().slice(0, 200), sahipRol: await rolId(b.db, makam), sonZaman: son, oncelik: 'Yüksek', nesneTuru: 'Garanti Şikâyet', nesneKimligi: g.kimlik });
    return { makam, son };
  });

  s.post('/garanti-sikayet/:id/itiraz-karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = await kayit((i.params as { id: string }).id, o.kullanici); if (!g) return yok(y);
    const { sonuc, gerekce } = (i.body ?? {}) as { sonuc?: string; gerekce?: string };
    if (!g.itiraz_zamani || g.itiraz_sonucu) return y.code(409).send({ hata: 'Karar bekleyen itiraz yoktur.' });
    if (g.karar_veren_ref === o.kullanici || !(await rolVar(o.kullanici, [g.itiraz_makami]))) return y.code(403).send({ hata: `İtirazı ilk kararı vermeyen ${g.itiraz_makami} inceler.` });
    if (!['Kabul', 'Kısmen Kabul', 'Ret'].includes(sonuc ?? '') || !gerekce?.trim()) return y.code(400).send({ hata: 'Sonuç (Kabul, Kısmen Kabul, Ret) ve gerekçe zorunludur.' });
    await b.db.query(`UPDATE garanti_sikayet SET itiraz_sonucu = $2, itiraz_gerekcesi = $3, itiraz_karar_veren_ref = $4, itiraz_karar_zamani = now() WHERE kimlik = $1`, [g.kimlik, sonuc, gerekce.trim(), o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Şikâyet İtirazı' AND nesne_kimligi = $1 AND durum NOT IN ('Tamamlandı', 'İptal')`, [g.kimlik]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Şikâyet İtirazı: ${sonuc}`, nesneTuru: 'Dosya', nesneKimligi: g.dosya_ref, gerekce: gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { sonuc };
  });
}
