import type { FastifyInstance, FastifyReply } from 'fastify';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { silsileBildir } from './silsile.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

export const KURUM_TURLERI = ['Sigorta Şirketi', 'Sigorta Brokeri', 'Sigorta Acentesi', 'Kurumsal Müşteri', 'Marina / Tersane / Çekek Sahası', 'Tedarikçi'];
const EPOSTA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FYM = 'Firma Yönetimi Müdürü'; const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü';
const TUR = 'Kurumsal İletişim Talebi'; const YON = 'Kurumsal Talep Görüşmesi';

/**
 * YG-1556: "Hesap Oluştur" kurumsal iletişim talebi Firma Yönetimi Müdürüne görev, BT ve Firma Yönetimi Direktörüne bilgi olarak düşer;
 * Müdür ilgili birime yönlendirir; hesap görüşmeden sonra ilgili birimin davetiyle açılır, talepten kendiliğinden hesap açılmaz.
 */
export function kurumTalebiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  // Herkese açık; aynı adresten 24 saatte yinelenen talep yeni görev açmaz, yanıt aynıdır.
  s.post('/iletisim/kurum-talebi', async (i, y) => {
    const g = (i.body ?? {}) as { kurumTuru?: string; kurumAdi?: string; adSoyad?: string; eposta?: string; telefon?: string; mesaj?: string };
    const ep = (g.eposta ?? '').trim(); const kurum = (g.kurumAdi ?? '').trim(); const ad = (g.adSoyad ?? '').trim();
    if (!g.kurumTuru || !KURUM_TURLERI.includes(g.kurumTuru) || !kurum || !ad || !EPOSTA.test(ep)) return y.code(400).send({ hata: 'Kurum türü, kurum adı, ad soyad ve e-posta zorunludur.' });
    if (Number((await b.db.query(`SELECT count(*) n FROM kurum_talebi WHERE adres = $1 AND olusturma_zamani > now() - interval '1 hour'`, [i.ip])).rows[0].n) >= 5) return y.code(429).send({ hata: 'Çok sayıda talep gönderildi; lütfen daha sonra tekrar deneyiniz.' });
    if ((await b.db.query(`SELECT 1 FROM kurum_talebi WHERE lower(e_posta) = lower($1) AND olusturma_zamani > now() - interval '24 hours'`, [ep])).rowCount) return { tamam: true };
    const no = `KIT-${new Date().getFullYear()}-${String((await b.db.query(`SELECT nextval('kurum_talebi_no') n`)).rows[0].n).padStart(4, '0')}`;
    const t = (await b.db.query(`INSERT INTO kurum_talebi (talep_no, kurum_turu, kurum_adi, ad_soyad, e_posta, telefon, mesaj, adres) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [no, g.kurumTuru, kurum.slice(0, 200), ad.slice(0, 120), ep, (g.telefon ?? '').trim().slice(0, 30) || null, (g.mesaj ?? '').trim().slice(0, 2000) || null, i.ip])).rows[0].kimlik as string;
    await kartAc(b.db, { tur: TUR, kategori: 'gorev', baslik: `${no} · ${g.kurumTuru}: ${kurum.slice(0, 80)}`, ozet: 'Talebi ilgili birime yönlendiriniz.', sahipRol: await rolId(b.db, FYM), sonZaman: await isGunuSonu(b.db, new Date(), 1), nesneTuru: TUR, nesneKimligi: t });
    await bildir(b.db, { olay: `kurum-talebi:${t}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, BTD)), baslik: `Yeni Kurumsal İletişim Talebi: ${g.kurumTuru}`, ozet: kurum.slice(0, 120) });
    return { tamam: true };
  });

  const erisir = async (k: string, t: { yon_rol: string | null }) => (await rolVar(k, [FYM, BTD])) || (t.yon_rol ? (await rolSahipleri(b.db, t.yon_rol)).includes(k) : false);
  s.get('/kurum-talebi', oturumlu, async (i, y) => {
    const k = i.oturum!.kullanici; const yon = (await b.db.query(`SELECT a.rol_ref FROM rol_atamasi a WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_ref as string);
    const ust = await rolVar(k, [FYM, BTD]);
    if (!ust && !(await b.db.query(`SELECT 1 FROM kurum_talebi WHERE yonlenen_birim = ANY($1) LIMIT 1`, [yon])).rowCount) return yok(y);
    return {
      yonlendirir: await rolVar(k, [FYM]), turler: KURUM_TURLERI,
      roller: ust ? (await b.db.query(`SELECT kimlik, rol_adi FROM rol WHERE kullanici_gruplari = 'LGM İç Rolü' AND kademe IN ('Müdür', 'Direktör') ORDER BY rol_adi`)).rows : [],
      talepler: (await b.db.query(`SELECT t.kimlik, t.talep_no, t.kurum_turu, t.kurum_adi, t.ad_soyad, t.e_posta, t.telefon, t.mesaj, t.durum, r.rol_adi AS yonlenen, t.not_metni, t.olusturma_zamani FROM kurum_talebi t LEFT JOIN rol r ON r.kimlik = t.yonlenen_birim WHERE ($1 OR t.yonlenen_birim = ANY($2)) ORDER BY t.durum IN ('Davet Edildi', 'Kapatıldı'), t.olusturma_zamani DESC LIMIT 200`, [ust, yon])).rows,
    };
  });
  s.post('/kurum-talebi/:id/yonlendir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { rol?: string; not?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [FYM]))) return yok(y);
    const t = (await b.db.query(`SELECT talep_no, kurum_turu, kurum_adi, durum FROM kurum_talebi WHERE kimlik = $1`, [id])).rows[0]; if (!t) return yok(y);
    if (t.durum !== 'Yeni' && t.durum !== 'Yönlendirildi') return y.code(409).send({ hata: 'Bu talep sonuçlanmıştır.' });
    if (!g.rol || !(await b.db.query(`SELECT 1 FROM rol WHERE kimlik = $1 AND kullanici_gruplari = 'LGM İç Rolü'`, [g.rol])).rowCount) return y.code(400).send({ hata: 'Yönlendirilecek birimi seçiniz.' });
    await b.db.query(`UPDATE kurum_talebi SET durum = 'Yönlendirildi', yonlenen_birim = $2, not_metni = coalesce($3, not_metni), isleyen_ref = $4, islem_zamani = now() WHERE kimlik = $1`, [id, g.rol, g.not?.trim() || null, o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [TUR, id]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [YON, id]);
    await kartAc(b.db, { tur: YON, kategori: 'gorev', baslik: `${t.talep_no} · ${t.kurum_turu}: ${t.kurum_adi}`, ozet: 'Kurumla görüşünüz; uygunsa hesabı davetle açınız ve sonucu kaydediniz.', sahipRol: g.rol, sonZaman: await isGunuSonu(b.db, new Date(), 2), nesneTuru: YON, nesneKimligi: id });
    await silsileBildir(b.db, g.rol, { olay: `kurum-talebi-silsile:${id}:${g.rol}`, baslik: `Birime Yönlendirilen Talep: ${t.talep_no}`, ozet: `${t.kurum_turu} · ${t.kurum_adi}` }, [o.kullanici]); // YG-1555
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurumsal Talep Yönlendirildi', nesneTuru: TUR, nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/kurum-talebi/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { durum?: string; not?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT durum, yonlenen_birim AS yon_rol FROM kurum_talebi WHERE kimlik = $1`, [id])).rows[0];
    if (!t || !(await erisir(o.kullanici, t))) return yok(y);
    if (g.durum !== 'Davet Edildi' && g.durum !== 'Kapatıldı') return y.code(400).send({ hata: 'Sonucu seçiniz.' });
    if (g.durum === 'Kapatıldı' && !g.not?.trim()) return y.code(400).send({ hata: 'Kapatma gerekçesi yazınız.' });
    if (t.durum === 'Davet Edildi' || t.durum === 'Kapatıldı') return y.code(409).send({ hata: 'Bu talep sonuçlanmıştır.' });
    await b.db.query(`UPDATE kurum_talebi SET durum = $2, not_metni = coalesce($3, not_metni), isleyen_ref = $4, islem_zamani = now() WHERE kimlik = $1`, [id, g.durum, g.not?.trim() || null, o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = ANY($1) AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [[TUR, YON], id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Kurumsal Talep ${g.durum}`, nesneTuru: TUR, nesneKimligi: id, gerekce: g.not?.trim() || undefined, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
