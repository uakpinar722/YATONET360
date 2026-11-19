import type { FastifyInstance, FastifyReply } from 'fastify';
import { bildir, disGonder } from './bildirim.js';
import { davetOlustur } from './ilk_giris.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { silsileBildir } from './silsile.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

export const KURUM_TURLERI = ['Sigorta Şirketi', 'Sigorta Brokeri', 'Sigorta Acentesi', 'Kurumsal Müşteri', 'Marina / Tersane / Çekek Sahası', 'Tedarikçi', 'Çözüm Ortağı Adayı']; // YG-1560
const EPOSTA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FYM = 'Firma Yönetimi Müdürü'; const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü';
const TUR = 'Kurumsal İletişim Talebi'; const YON = 'Kurumsal Talep Görüşmesi';
const MPM = 'Müşteri ve Paydaş İlişkileri Müdürü'; const MPM_TURLERI = ['Sigorta Şirketi', 'Sigorta Brokeri', 'Sigorta Acentesi', 'Kurumsal Müşteri']; // A53-S1

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
      yonlendirir: await rolVar(k, [FYM]), turler: KURUM_TURLERI, karar: await rolVar(k, [MPM]), mpmTurleri: MPM_TURLERI,
      sigortaSirketleri: (await rolVar(k, [MPM])) ? (await b.db.query(`SELECT tsb_kodu, tam_unvan FROM sigorta_sirketi WHERE durum = 'Aktif' ORDER BY tam_unvan`)).rows : [],
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
  // YG-1701 (A53-S1): sigorta şirketi, broker, acente ve kurumsal müşteri talebinde Müşteri ve Paydaş İlişkileri Müdürü "Kararı Kaydet"; hesap açılacaksa davet kendiliğinden gider.
  s.post('/kurum-talebi/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { karar?: string; gorusme?: string; tsbKodu?: string; dayanak?: string; tarafNo?: string; ek2Siniri?: number };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [MPM]))) return yok(y);
    const t = (await b.db.query(`SELECT * FROM kurum_talebi WHERE kimlik = $1`, [id])).rows[0]; if (!t) return yok(y);
    if (!MPM_TURLERI.includes(t.kurum_turu)) return y.code(409).send({ hata: 'Bu kurum türünde karar ilgili birimin kayıt akışıyla verilir.' });
    if (t.durum === 'Davet Edildi' || t.durum === 'Kapatıldı') return y.code(409).send({ hata: 'Bu talep sonuçlanmıştır.' });
    if (!['Hesap Açılsın', 'Hesap Açılmasın'].includes(g.karar ?? '') || !g.gorusme?.trim()) return y.code(400).send({ hata: 'Kararı ve görüşme sonucunu yazınız.' });
    const fym = await rolSahipleri(b.db, await rolId(b.db, FYM));
    const kapat = async (c: { query: typeof b.db.query }, durum: string) => {
      await c.query(`UPDATE kurum_talebi SET durum = $2, not_metni = $3, isleyen_ref = $4, islem_zamani = now() WHERE kimlik = $1`, [id, durum, g.gorusme!.trim(), o.kullanici]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = ANY($1) AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [[TUR, YON], id]);
    };
    if (g.karar === 'Hesap Açılmasın') {
      await kapat(b.db, 'Kapatıldı');
      await bildir(b.db, { olay: `kurum-karar:${id}`, kullanicilar: fym, baslik: `${t.talep_no} · Hesap Açılmadı`, ozet: `${t.kurum_turu} · ${t.kurum_adi} · ${g.gorusme.trim().slice(0, 150)}` });
      await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurumsal Talep Kararı', nesneTuru: TUR, nesneKimligi: id, yeni: { karar: g.karar }, gerekce: g.gorusme.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { durum: 'Kapatıldı' };
    }
    if ((await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE lower(e_posta COLLATE "C") = lower($1::text COLLATE "C") LIMIT 1`, [t.e_posta])).rowCount) return y.code(409).send({ hata: 'Bu e-posta adresiyle kayıtlı hesap bulunmaktadır.' });
    let unvan = t.kurum_adi as string; let sg: { tsb_kodu: string; tam_unvan: string } | undefined; let taraf: { kimlik: string; unvan_ad_soyad: string } | undefined;
    if (t.kurum_turu === 'Sigorta Şirketi') {
      sg = (await b.db.query(`SELECT tsb_kodu, tam_unvan FROM sigorta_sirketi WHERE tsb_kodu = $1 AND durum = 'Aktif'`, [g.tsbKodu ?? ''])).rows[0];
      if (!sg || !g.dayanak?.trim()) return y.code(400).send({ hata: 'Sigorta şirketini listeden seçiniz ve yetkilendirme yazısının tarih ve sayısını yazınız.' });
      unvan = sg.tam_unvan;
    }
    if (t.kurum_turu === 'Kurumsal Müşteri') {
      if (!g.tarafNo?.trim() || !(Number(g.ek2Siniri) >= 0)) return y.code(400).send({ hata: 'Kurumsal müşterinin taraf numarasını ve Ek-2 onay sınırını giriniz.' });
      taraf = (await b.db.query(`SELECT kimlik, unvan_ad_soyad FROM taraf WHERE taraf_no = $1 AND musteri_turu = 'Kurumsal Müşteri'`, [g.tarafNo.trim()])).rows[0];
      if (!taraf) return y.code(404).send({ hata: 'Bu numarada kurumsal müşteri kaydı bulunamadı.' });
      if ((await b.db.query(`SELECT 1 FROM kurumsal_kurum WHERE taraf_ref = $1`, [taraf.kimlik])).rowCount) return y.code(409).send({ hata: 'Bu kurum tanımlıdır; kullanıcıyı kurum yetkilisi ekler.' });
      unvan = taraf.unvan_ad_soyad;
    }
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const [grup, rol] = t.kurum_turu === 'Sigorta Şirketi' ? ['Sigorta Şirketi / Eksper', 'Sigorta Şirketi Kullanıcısı'] : t.kurum_turu === 'Kurumsal Müşteri' ? ['Kurumsal Müşteri', 'Kurumsal Müşteri Kullanıcısı'] : ['Broker, Acente, Yat Brokeri, Kaptan', 'Broker, Acente, Yat Brokeri, Kaptan'];
      const { kimlik, belirtec } = await davetOlustur(c, { adSoyad: t.ad_soyad, eposta: t.e_posta, telefon: t.telefon ?? undefined, grup, rol, olusturan: o.kullanici });
      if (sg) await c.query(`INSERT INTO sigorta_kullanici (kullanici_ref, sigortaci_adi, tsb_kodu) VALUES ($1,$2,$3)`, [kimlik, sg.tam_unvan, sg.tsb_kodu]);
      if (taraf) {
        const k = (await c.query(`INSERT INTO kurumsal_kurum (taraf_ref, unvan, ek2_onay_siniri, kaydeden_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [taraf.kimlik, taraf.unvan_ad_soyad, g.ek2Siniri, o.kullanici])).rows[0];
        await c.query(`INSERT INTO kurumsal_kullanici (kullanici_ref, kurum_ref, rol, onay_siniri, yetkili, ekleyen_ref) VALUES ($1,$2,'Onaylayan',$3,true,$4)`, [kimlik, k.kimlik, g.ek2Siniri, o.kullanici]);
      }
      await disGonder(c, { olay: `kurum-talebi-davet:${id}`, eposta: t.e_posta, konu: 'YATONET 360 Hesabınız', metin: `LİMİT GLOBAL MARINE: ${unvan} adına YATONET 360 hesabınız açılmıştır. İlk girişinizi 7 gün içinde aşağıdaki bağlantıdan yapmanızı rica ederiz. ${b.webAdresi}/#davet=${belirtec}`, acil: true });
      await kapat(c, 'Davet Edildi');
      await bildir(c, { olay: `kurum-karar:${id}`, kullanicilar: fym, baslik: `${t.talep_no} · Hesap Açıldı, Davet Gönderildi`, ozet: `${t.kurum_turu} · ${unvan} · ${g.gorusme.trim().slice(0, 150)}` });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurumsal Talep Kararı', nesneTuru: TUR, nesneKimligi: id, yeni: { karar: g.karar, kullanici: kimlik }, gerekce: g.dayanak?.trim() || g.gorusme.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { durum: 'Davet Edildi', kullanici: kimlik };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.post('/kurum-talebi/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { durum?: string; not?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT durum, yonlenen_birim AS yon_rol FROM kurum_talebi WHERE kimlik = $1`, [id])).rows[0];
    if (!t || !(await erisir(o.kullanici, t))) return yok(y);
    if (g.durum !== 'Davet Edildi' && g.durum !== 'Kapatıldı') return y.code(400).send({ hata: 'Sonucu seçiniz.' });
    if (g.durum === 'Kapatıldı' && !g.not?.trim()) return y.code(400).send({ hata: 'Kapatma gerekçesi yazınız.' });
    if (MPM_TURLERI.includes((await b.db.query(`SELECT kurum_turu FROM kurum_talebi WHERE kimlik = $1`, [id])).rows[0]?.kurum_turu)) return y.code(409).send({ hata: 'Bu talepte sonuç Müşteri ve Paydaş İlişkileri Müdürünün "Kararı Kaydet" adımıyla verilir.' });
    if (t.durum === 'Davet Edildi' || t.durum === 'Kapatıldı') return y.code(409).send({ hata: 'Bu talep sonuçlanmıştır.' });
    await b.db.query(`UPDATE kurum_talebi SET durum = $2, not_metni = coalesce($3, not_metni), isleyen_ref = $4, islem_zamani = now() WHERE kimlik = $1`, [id, g.durum, g.not?.trim() || null, o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = ANY($1) AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [[TUR, YON], id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Kurumsal Talep ${g.durum}`, nesneTuru: TUR, nesneKimligi: id, gerekce: g.not?.trim() || undefined, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
