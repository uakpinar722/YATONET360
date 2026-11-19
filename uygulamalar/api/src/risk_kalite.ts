import type { FastifyInstance, FastifyReply } from 'fastify';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

const RKD = 'Risk ve Kalite Direktörü'; const KM = 'Kalite Müdürü';
export const SISTEM_ETKISI = ['Firma', 'Yöntem', 'Malzeme', 'Eğitim', 'Prosedür', 'Kontrol Planı'];
const KARAR_TURU = 'Kapsamlı Kök Neden Kararı';

// YG-1693 (¶626, ¶651): Kalite Müdürünün kapsamlı kök neden önerisi Risk ve Kalite Direktörünce "Kararı Kaydet" (Onayla) ile karara bağlanır; iade Kalite Müdürüne döner.
kapanisKaydet(KARAR_TURU, async (c, k, karar, yapan) => {
  if (karar === 'Onayla') await c.query(`UPDATE kapsamli_kok_neden SET durum = 'Karar Verildi', karar_veren_ref = $2, karar_zamani = now() WHERE kimlik = $1 AND durum = 'Onayda'`, [k.nesne_kimligi, yapan]);
  else if (karar === 'Gerekçeyle İade Et') await c.query(`UPDATE kapsamli_kok_neden SET durum = 'İade Edildi' WHERE kimlik = $1 AND durum = 'Onayda'`, [k.nesne_kimligi]);
  else if (karar === 'Yeniden Gönder') await c.query(`UPDATE kapsamli_kok_neden SET durum = 'Onayda' WHERE kimlik = $1 AND durum = 'İade Edildi'`, [k.nesne_kimligi]);
});

/** YG-1693: düzeltici faaliyet etkisiz çıkınca veya aynı Kritik uygunsuzluk tekrarlayınca Kalite Müdürüne kapsamlı kök neden önerisi görevi açılır (bir kez). */
export async function kapsamliKokNedenGorevi(db: Parameters<typeof kartAc>[0], uygunsuzluk: string, neden: string): Promise<void> {
  if ((await db.query(`SELECT 1 FROM is_karti WHERE tur = 'Kapsamlı Kök Neden Önerisi' AND nesne_kimligi = $1`, [uygunsuzluk])).rowCount) return;
  const u = (await db.query(`SELECT uygunsuzluk_no FROM uygunsuzluk WHERE kimlik = $1`, [uygunsuzluk])).rows[0]; if (!u) return;
  await kartAc(db, { tur: 'Kapsamlı Kök Neden Önerisi', kategori: 'gorev', baslik: `${u.uygunsuzluk_no} · Kapsamlı Kök Neden Önerisi`, ozet: `${neden}. Sistem etkisini (firma, yöntem, malzeme, eğitim, prosedür, kontrol planı), sorumlu birimi ve hedef tarihi önererek Risk ve Kalite Direktörüne gönderiniz.`, oncelik: 'Yüksek', sahipRol: await rolId(db, KM), nesneTuru: 'Uygunsuzluk', nesneKimligi: uygunsuzluk });
}

export function riskKaliteYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  s.post('/uygunsuzluk/:id/kapsamli-kok-neden', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sistemEtkisi?: string[]; oneri?: string; birim?: string; hedef?: string };
    if (!UUID.test(id) || !(await rolde(o.kullanici, [KM]))) return yok(y);
    const u = (await b.db.query(`SELECT uygunsuzluk_no FROM uygunsuzluk WHERE kimlik = $1`, [id])).rows[0]; if (!u) return yok(y);
    const se = (g.sistemEtkisi ?? []).filter((x) => SISTEM_ETKISI.includes(x));
    if (!se.length || !g.oneri?.trim() || !g.birim?.trim() || !g.hedef || !/^\d{4}-\d{2}-\d{2}$/.test(g.hedef)) return y.code(400).send({ hata: 'Sistem etkisi, öneri, sorumlu birim ve hedef tarih zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM kapsamli_kok_neden WHERE uygunsuzluk_ref = $1 AND durum IN ('Onayda', 'İade Edildi')`, [id])).rowCount) return y.code(409).send({ hata: 'Bu uygunsuzlukta karar bekleyen kapsamlı kök neden önerisi vardır.' });
    const r = (await b.db.query(`INSERT INTO kapsamli_kok_neden (uygunsuzluk_ref, sistem_etkisi, oneri, sorumlu_birim, hedef_tarih, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, se, g.oneri.trim(), g.birim.trim(), g.hedef, o.kullanici])).rows[0];
    await kartAc(b.db, { tur: KARAR_TURU, baslik: `${u.uygunsuzluk_no} · Kapsamlı Kök Neden Kararı`, ozet: `Sistem etkisi: ${se.join(', ')} · ${g.oneri.trim()} · Sorumlu: ${g.birim.trim()} · Hedef: ${g.hedef.split('-').reverse().join('.')}`.slice(0, 400), hazirlayan: o.kullanici, zincir: [await rolId(b.db, RKD)], nesneTuru: 'Kapsamlı Kök Neden', nesneKimligi: r.kimlik });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Kapsamlı Kök Neden Önerisi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kapsamlı Kök Neden Önerisi', nesneTuru: 'Uygunsuzluk', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });

  // YG-1693 (¶634): Olay İzleme · Günlük: açık Kritik/emniyet işaretli uygunsuzluk, çalışması durdurulmuş dosya, son 30 gün çevresel olay.
  s.get('/kalite/olay-izleme', oturumlu, async (i, y) => {
    if (!(await rolde(i.oturum!.kullanici, [RKD, KM, 'Kalite Müdür Yardımcısı']))) return yok(y);
    const uygunsuzluk = (await b.db.query(`SELECT u.kimlik, u.uygunsuzluk_no no, d.dosya_no, u.sinif, u.emniyet_isareti, u.statu, u.hedef_zamani FROM uygunsuzluk u JOIN dosya d ON d.kimlik = u.dosya_ref WHERE (u.sinif = 'Kritik' OR u.emniyet_isareti) AND u.statu NOT IN ('Kapalı', 'Geçersiz') ORDER BY u.olusturma_zamani LIMIT 100`)).rows;
    const durdurma = (await b.db.query(`SELECT d.kimlik, d.dosya_no, y.yat_adi, d.konum FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.calisma_durduruldu AND d.statu NOT IN ('Kapalı') ORDER BY d.dosya_no LIMIT 100`)).rows;
    const cevre = (await b.db.query(`SELECT a.kimlik, d.dosya_no, a.olay_turu, d.olusturma_zamani FROM acil_mudahale a JOIN dosya d ON d.kimlik = a.dosya_ref WHERE (a.olay_turu = 'Kirlilik' OR a.can_cevre_riski) AND d.olusturma_zamani > now() - interval '30 days' ORDER BY d.olusturma_zamani DESC LIMIT 100`)).rows;
    return { uygunsuzluk, durdurma, cevre };
  });

  // YG-1693 (¶648, FR-UYG-006): Kalite ve İSG Yönetim Gözden Geçirmesi · Yıllık; girdiler, kararlar, eylemler.
  s.get('/kalite/yonetim-gozden-gecirme', oturumlu, async (i, y) => {
    if (!(await rolde(i.oturum!.kullanici, [RKD, KM, 'CEO', 'Genel Müdür Yardımcısı']))) return yok(y);
    return (await b.db.query(`SELECT g.yil, g.girdiler, g.kararlar, g.eylemler, g.zaman, h.ad_soyad kaydeden FROM kalite_yonetim_gozden_gecirme g JOIN kullanici_hesabi h ON h.kimlik = g.kaydeden_ref ORDER BY g.yil DESC`)).rows;
  });
  s.post('/kalite/yonetim-gozden-gecirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { yil?: number; girdiler?: string; kararlar?: string; eylemler?: string };
    if (!(await rolde(o.kullanici, [RKD]))) return yok(y);
    if (!(Number(g.yil) >= 2026) || !g.girdiler?.trim() || !g.kararlar?.trim() || !g.eylemler?.trim()) return y.code(400).send({ hata: 'Yıl, girdiler, kararlar ve eylemler zorunludur.' });
    await b.db.query(`INSERT INTO kalite_yonetim_gozden_gecirme (yil, girdiler, kararlar, eylemler, kaydeden_ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (yil) DO UPDATE SET girdiler = EXCLUDED.girdiler, kararlar = EXCLUDED.kararlar, eylemler = EXCLUDED.eylemler, kaydeden_ref = EXCLUDED.kaydeden_ref, zaman = now()`, [g.yil, g.girdiler.trim(), g.kararlar.trim(), g.eylemler.trim(), o.kullanici]);
    await bildir(b.db, { olay: `kalite-gg:${g.yil}:${Date.now()}`, kullanicilar: [...await rolSahipleri(b.db, await rolId(b.db, KM)), ...await rolSahipleri(b.db, await rolId(b.db, 'CEO'))], baslik: `${g.yil} Kalite ve İSG Yönetim Gözden Geçirmesi Kaydedildi`, ozet: g.kararlar.trim().slice(0, 200) });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yönetim Gözden Geçirmesi', nesneTuru: 'Kalite Yönetim Gözden Geçirme', nesneKimligi: String(g.yil), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
