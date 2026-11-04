import type { FastifyInstance, FastifyReply } from 'fastify';
import { bildir, disGonder } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { davetOlustur } from './ilk_giris.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { bankaHesabiAc, firmaOdemePlani, ibanGecerli } from './ticari.js';
import { parametre } from './teklif.js';
import { dosyaErisimi } from './dosya.js';
import { UUID } from './yat.js';

const EPOSTA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GRUPLAR: Record<string, { grup: string; rol: string }> = {
  'Çözüm Ortağı': { grup: 'İş Birliği Firması', rol: 'Firma Yetkilisi' },
  Tedarikçi: { grup: 'Tedarikçi', rol: 'Tedarikçi Kullanıcısı' },
  Tesis: { grup: 'Tesis Yetkilisi (Marina, Tersane, Çekek Sahası)', rol: 'Tesis Yetkilisi' },
};
const MUHASEBE = ['Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', 'Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdürü'];
let webAdresi = '';

// YG-1004: LGM teyidinde hesap ve 7 gün geçerli davet açılır; bağlantı yalnız kişinin e-postasına gider.
kapanisKaydet('Kurum Kullanıcı Teyidi', async (c, k, karar) => {
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return; // ara kademe geçişi kaydı değiştirmez
  const t = (await c.query(`SELECT t.*, u.kayit_rolu, u.ticari_unvan FROM kurum_kullanici_talebi t JOIN kurulus u ON u.kimlik = t.kurulus_ref WHERE t.kimlik = $1 AND t.durum = 'Teyit Bekliyor'`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Onayla') {
    const g = GRUPLAR[t.kayit_rolu]!;
    const { kimlik, belirtec } = await davetOlustur(c, { adSoyad: t.ad_soyad, eposta: t.eposta, telefon: t.telefon ?? undefined, grup: g.grup, rol: g.rol, olusturan: t.talep_eden_ref });
    await c.query(`INSERT INTO kurulus_kullanici VALUES ($1,$2)`, [t.kurulus_ref, kimlik]);
    await c.query(`UPDATE kurum_kullanici_talebi SET durum = 'Açıldı', kullanici_ref = $2, karar_zamani = now() WHERE kimlik = $1`, [t.kimlik, kimlik]);
    await disGonder(c, { olay: `kurum-davet:${t.kimlik}`, eposta: t.eposta, konu: 'YATONET 360 Hesabınız', metin: `LİMİT GLOBAL MARINE: ${t.ticari_unvan} adına YATONET 360 hesabınız açılmıştır. İlk girişinizi 7 gün içinde aşağıdaki bağlantıdan yapmanızı rica ederiz. ${webAdresi}/#davet=${belirtec}`, acil: true });
  } else await c.query(`UPDATE kurum_kullanici_talebi SET durum = 'Reddedildi', karar_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
  await bildir(c, { olay: `kurum-kullanici:${t.kimlik}`, kullanicilar: [t.talep_eden_ref], baslik: `Kullanıcı Talebi: ${t.ad_soyad}`, ozet: karar === 'Onayla' ? 'Hesap açıldı, davet gönderildi.' : 'Talep kabul edilmedi.' });
});

// YG-425: firma bilgi değişikliği Sicil Sorumlusu teyidiyle işlenir; önceki değer kayıtta kalır.
kapanisKaydet('Kurum Bilgi Değişikliği', async (c, k, karar) => {
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return; // ara kademe geçişi kaydı değiştirmez
  const t = (await c.query(`SELECT * FROM kurum_bilgi_talebi WHERE kimlik = $1 AND durum = 'Teyit Bekliyor'`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Onayla') {
    const sutun = ({ kurumsal_eposta: 'kurumsal_eposta', kurumsal_telefon: 'kurumsal_telefon', il: 'il', ilce: 'ilce' } as Record<string, string>)[t.alan]!;
    await c.query(`UPDATE kurulus SET ${sutun} = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kurulus_ref, t.yeni_deger]);
  }
  await c.query(`UPDATE kurum_bilgi_talebi SET durum = $2, karar_zamani = now() WHERE kimlik = $1`, [t.kimlik, karar === 'Onayla' ? 'İşlendi' : 'Reddedildi']);
  await bildir(c, { olay: `kurum-bilgi:${t.kimlik}`, kullanicilar: [t.talep_eden_ref], baslik: 'Bilgi Değişikliği Talebi', ozet: karar === 'Onayla' ? 'Talebiniz işlendi.' : 'Talebiniz kabul edilmedi.' });
});

// K-178: itirazı BT ve Firma Yönetimi Direktörü karara bağlar; kabulde başvuru yeniden incelemeye döner.
kapanisKaydet('Firma Kabul İtirazı', async (c, k, karar) => {
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return; // ara kademe geçişi kaydı değiştirmez
  const t = (await c.query(`SELECT * FROM kurum_kabul_itirazi WHERE kimlik = $1 AND durum = 'İncelemede'`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  if (karar === 'Onayla') await c.query(`UPDATE kurulus SET kayit_asamasi = 'İncelemede', kabul_karar_zamani = NULL, guncelleme_zamani = now() WHERE kimlik = $1`, [t.kurulus_ref]);
  await c.query(`UPDATE kurum_kabul_itirazi SET durum = $2, karar_zamani = now() WHERE kimlik = $1`, [t.kimlik, karar === 'Onayla' ? 'Kabul Edildi' : 'Reddedildi']);
  await bildir(c, { olay: `kurum-itiraz:${t.kimlik}`, kullanicilar: [t.itiraz_eden_ref], baslik: 'Kabul Kararı İtirazı', ozet: karar === 'Onayla' ? 'İtirazınız kabul edildi; başvurunuz yeniden incelenecektir.' : 'İtirazınız kabul edilmedi.' });
});

export function kurumHesapYollari(s: FastifyInstance, b: Baglam) {
  webAdresi = b.webAdresi;
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const kurumum = async (k: string) => (await b.db.query(`SELECT u.kimlik, u.sicil_no, u.ticari_unvan, u.kayit_rolu, u.kayit_asamasi, u.kabul_karar_zamani, u.kurumsal_eposta, u.kurumsal_telefon, u.il, u.ilce FROM kurulus_kullanici x JOIN kurulus u ON u.kimlik = x.kurulus_ref WHERE x.kullanici_ref = $1 LIMIT 1`, [k])).rows[0];

  // YG-425, YG-1574, YG-1575, YG-1577: firma bilgileri ve kullanıcılar; kurum yalnız kendini görür.
  s.get('/kurum/hesap', oturumlu, async (i, y) => {
    const u = await kurumum(i.oturum!.kullanici);
    if (!u) return yok(y);
    const kullanicilar = (await b.db.query(`SELECT h.kimlik, h.ad_soyad, h.e_posta, h.cep_telefonu, h.hesap_durumu FROM kurulus_kullanici x JOIN kullanici_hesabi h ON h.kimlik = x.kullanici_ref WHERE x.kurulus_ref = $1 ORDER BY h.hesap_durumu, h.ad_soyad`, [u.kimlik])).rows;
    const talepler = (await b.db.query(`SELECT kimlik, ad_soyad, eposta, durum FROM kurum_kullanici_talebi WHERE kurulus_ref = $1 AND durum <> 'Açıldı' ORDER BY olusturma_zamani DESC LIMIT 20`, [u.kimlik])).rows;
    const bankalar = (await b.db.query(`SELECT kimlik, iban, durum FROM banka_hesabi WHERE kurulus_ref = $1 ORDER BY olusturma_zamani DESC`, [u.kimlik])).rows.map((x) => ({ kimlik: x.kimlik, iban: `${String(x.iban).slice(0, 4)} •••• ${String(x.iban).slice(-4)}`, durum: x.durum }));
    const bilgiTalepleri = (await b.db.query(`SELECT kimlik, alan, yeni_deger, durum FROM kurum_bilgi_talebi WHERE kurulus_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 10`, [u.kimlik])).rows;
    const itiraz = (await b.db.query(`SELECT durum, olusturma_zamani FROM kurum_kabul_itirazi WHERE kurulus_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 1`, [u.kimlik])).rows[0] ?? null;
    const itirazEdilebilir = ['Reddedildi', 'Koşullu Onaylı'].includes(u.kayit_asamasi) && u.kabul_karar_zamani && Date.now() - new Date(u.kabul_karar_zamani).getTime() <= 15 * 86_400_000 && !itiraz;
    return { kurum: u, kullanicilar: kullanicilar.map((x) => ({ ...x, ben: x.kimlik === i.oturum!.kullanici })), talepler, bankalar, bilgiTalepleri, itiraz, itirazEdilebilir: Boolean(itirazEdilebilir) };
  });

  // YG-928, YG-1272: yeni hesap karantinada başlar; sicildeki numaradan geri aranıp Muhasebe ve Finans Müdürü teyit etmeden geçerli olmaz.
  s.post('/kurum/banka', oturumlu, async (i, y) => {
    const o = i.oturum!; const u = await kurumum(o.kullanici); const iban = ((i.body ?? {}) as { iban?: string }).iban;
    if (!u) return yok(y);
    if (!iban || !ibanGecerli(iban)) return y.code(400).send({ hata: 'Geçerli bir IBAN girmenizi rica ederiz.' });
    const temiz = iban.replace(/\s/g, '').toUpperCase();
    if ((await b.db.query(`SELECT 1 FROM banka_hesabi WHERE kurulus_ref = $1 AND iban = $2`, [u.kimlik, temiz])).rowCount) return y.code(409).send({ hata: 'Bu IBAN kayıtlıdır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await bankaHesabiAc(c, { kurulus: u.kimlik, iban: temiz, giren: o.kullanici });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurum Banka Hesabı Bildirimi', nesneTuru: 'Kuruluş', nesneKimligi: u.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
      await c.query('COMMIT');
      return { durum: 'Karantina' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.post('/kurum/bilgi-degisikligi', oturumlu, async (i, y) => {
    const o = i.oturum!; const u = await kurumum(o.kullanici); const g = (i.body ?? {}) as { alan?: string; yeni?: string };
    if (!u) return yok(y);
    if (!['kurumsal_eposta', 'kurumsal_telefon', 'il', 'ilce'].includes(g.alan ?? '') || !g.yeni?.trim()) return y.code(400).send({ hata: 'Alanı ve yeni değeri girmenizi rica ederiz.' });
    if (g.alan === 'kurumsal_eposta' && !EPOSTA.test(g.yeni.trim())) return y.code(400).send({ hata: 'Geçerli bir e-posta adresi girmenizi rica ederiz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = (await c.query(`INSERT INTO kurum_bilgi_talebi (kurulus_ref, alan, eski_deger, yeni_deger, talep_eden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [u.kimlik, g.alan, u[g.alan!] ?? null, g.yeni.trim(), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Kurum Bilgi Değişikliği', baslik: `${u.ticari_unvan} · Bilgi Değişikliği`, ozet: `${g.alan}: ${g.yeni.trim()}`.slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Sicil Sorumlusu')], nesneTuru: 'Kurum Bilgi Talebi', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurum Bilgi Değişikliği Talebi', nesneTuru: 'Kuruluş', nesneKimligi: u.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
      await c.query('COMMIT');
      return { durum: 'Teyit Bekliyor', talep: t.kimlik };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // K-178, YG-425: ağa kabul kararına 15 gün içinde bir kez itiraz.
  s.post('/kurum/kabul-itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const u = await kurumum(o.kullanici); const gerekce = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!u) return yok(y);
    if (!gerekce) return y.code(400).send({ hata: 'İtiraz gerekçesini yazmanızı rica ederiz.' });
    if (!['Reddedildi', 'Koşullu Onaylı'].includes(u.kayit_asamasi) || !u.kabul_karar_zamani) return y.code(409).send({ hata: 'İtiraz, ret veya koşullu onay kararına yapılır.' });
    if (Date.now() - new Date(u.kabul_karar_zamani).getTime() > 15 * 86_400_000) return y.code(409).send({ hata: 'İtiraz süresi kararın 15. gününde sona ermiştir.' });
    if ((await b.db.query(`SELECT 1 FROM kurum_kabul_itirazi WHERE kurulus_ref = $1 LIMIT 1`, [u.kimlik])).rowCount) return y.code(409).send({ hata: 'Bu karara itiraz edilmiştir.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = (await c.query(`INSERT INTO kurum_kabul_itirazi (kurulus_ref, karar_asamasi, gerekce, itiraz_eden_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [u.kimlik, u.kayit_asamasi, gerekce, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Firma Kabul İtirazı', baslik: `${u.ticari_unvan} · Kabul Kararı İtirazı`, ozet: gerekce.slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü')], nesneTuru: 'Kurum Kabul İtirazı', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kabul Kararı İtirazı', nesneTuru: 'Kuruluş', nesneKimligi: u.kimlik, gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
      await c.query('COMMIT');
      return { durum: 'İncelemede' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-422, K-193: cari ekstre portalda; firma yalnız kendi hakedişini görür, müşteri adı ve müşteri fiyatı yazmaz.
  s.get('/firma-portal/cari', oturumlu, async (i, y) => {
    const u = await kurumum(i.oturum!.kullanici);
    if (!u) return yok(y);
    const satirlar = (await b.db.query(`SELECT h.hakedis_no, e.is_emri_no, h.bu_donem_brut, h.kesinti, h.net, h.statu, h.firma_fatura_no, t.planlanan_tarih::text, t.durum AS talimat, (SELECT max(x.tarih)::text FROM tahsilat x WHERE x.dosya_ref = h.dosya_ref) AS tahsilat_tarihi FROM hakedis h JOIN is_emri e ON e.kimlik = h.is_emri_ref LEFT JOIN odeme_talimati t ON t.hakedis_ref = h.kimlik WHERE e.kurulus_ref = $1 ORDER BY h.olusturma_zamani DESC`, [u.kimlik])).rows;
    const acik = satirlar.filter((x) => x.statu !== 'Reddedildi' && x.statu !== 'Ödendi').reduce((a, x) => a + Number(x.net), 0);
    return { satirlar, acikNet: Math.round(acik * 100) / 100 };
  });

  // YG-202: gerçekleşen teslimlerden parça bazında ortalama tedarik süresi; Dosya Sorumlusu teklifte tahmini süre olarak görür.
  s.get('/dosya/:id/tedarik-suresi', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; const q = ((i.query ?? {}) as { parca?: string }).parca?.trim();
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    if (!q || q.length < 2) return y.code(400).send({ hata: 'Parça numarası veya adını yazmanızı rica ederiz.' });
    const r = (await b.db.query(`SELECT k.uretici_parca_no, min(k.urun_tanimi) AS urun_tanimi, count(*)::int AS adet, round(avg(EXTRACT(EPOCH FROM (g.bekletme_baslangic - s.olusturma_zamani)) / 86400)::numeric, 1) AS gun FROM tedarik_siparisi_kalemi k JOIN tedarik_siparisi s ON s.kimlik = k.siparis_ref JOIN malzeme_giris_kabulu g ON g.siparis_ref = k.siparis_ref AND g.satir_no = k.satir_no WHERE (k.uretici_parca_no ILIKE $1 OR k.urun_tanimi ILIKE $1) AND g.kabul_karari = 'Kabul' GROUP BY k.uretici_parca_no ORDER BY adet DESC LIMIT 10`, [`%${q.replace(/[%_\\]/g, '\\$&')}%`])).rows;
    return r.map((x) => ({ parcaNo: x.uretici_parca_no, ad: x.urun_tanimi, adet: x.adet, gun: Number(x.gun) }));
  });

  s.post('/kurum/kullanici', oturumlu, async (i, y) => {
    const o = i.oturum!; const u = await kurumum(o.kullanici); const g = (i.body ?? {}) as { ad?: string; eposta?: string; telefon?: string };
    if (!u) return yok(y);
    const eposta = g.eposta?.trim();
    if (!g.ad?.trim() || !eposta || !EPOSTA.test(eposta)) return y.code(400).send({ hata: 'Ad soyad ve geçerli e-posta girmenizi rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE lower(e_posta COLLATE "C") = lower($1::text COLLATE "C") LIMIT 1`, [eposta])).rowCount) return y.code(409).send({ hata: 'Bu e-posta adresiyle kayıtlı hesap bulunmaktadır; Sicil Sorumlusu ile görüşmenizi rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM kurum_kullanici_talebi WHERE lower(eposta COLLATE "C") = lower($1::text COLLATE "C") AND durum = 'Teyit Bekliyor'`, [eposta])).rowCount) return y.code(409).send({ hata: 'Bu adres için teyit bekleyen talep bulunmaktadır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = (await c.query(`INSERT INTO kurum_kullanici_talebi (kurulus_ref, ad_soyad, eposta, telefon, talep_eden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [u.kimlik, g.ad.trim(), eposta, g.telefon?.trim() || null, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Kurum Kullanıcı Teyidi', baslik: `${u.ticari_unvan} · Kullanıcı Talebi`, ozet: `${g.ad.trim()} · ${eposta}`, hazirlayan: o.kullanici, zincir: [await rolId(c, 'Sicil Sorumlusu')], nesneTuru: 'Kurum Kullanıcı Talebi', nesneKimligi: t.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurum Kullanıcı Talebi', nesneTuru: 'Kuruluş', nesneKimligi: u.kimlik, yeni: { eposta }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
      await c.query('COMMIT');
      return { durum: 'Teyit Bekliyor', talep: t.kimlik };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-1004: kurum bildirdiğinde hesap hemen kapanır, oturumları biter; Sicil Sorumlusu 24 saat içinde kaydı gözden geçirir. Hesap yeni temsilciye devredilmez.
  s.post('/kurum/kullanici/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const u = await kurumum(o.kullanici); const gerekce = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!u) return yok(y);
    if (id === o.kullanici) return y.code(409).send({ hata: 'Kendi hesabınızı kapatmak için kurumunuzdan başka bir kullanıcı veya Sicil Sorumlusu ile görüşmenizi rica ederiz.' });
    const h = (await b.db.query(`SELECT h.ad_soyad, h.hesap_durumu FROM kurulus_kullanici x JOIN kullanici_hesabi h ON h.kimlik = x.kullanici_ref WHERE x.kurulus_ref = $1 AND x.kullanici_ref = $2`, [u.kimlik, id])).rows[0];
    if (!h) return yok(y);
    if (h.hesap_durumu === 'Kapalı') return y.code(409).send({ hata: 'Bu hesap kapalıdır.' });
    if (!gerekce) return y.code(400).send({ hata: 'Kapatma nedenini yazmanızı rica ederiz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Kapalı' WHERE kimlik = $1`, [id]);
      await c.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [id]);
      const sicil = await rolId(c, 'Sicil Sorumlusu');
      await kartAc(c, { tur: 'Çalışan Ayrıldı Bildirimi', kategori: 'gorev', baslik: `${u.ticari_unvan} · Çalışan Ayrıldı Bildirimi`, ozet: `${h.ad_soyad} · ${gerekce}`.slice(0, 200), sahipRol: sicil, sonZaman: new Date(Date.now() + 24 * 3_600_000), nesneTuru: 'Kullanıcı', nesneKimligi: id });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurum Kullanıcısı Kapatıldı', nesneTuru: 'Kullanıcı', nesneKimligi: id, gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
      await c.query('COMMIT');
      return { durum: 'Kapalı' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  const muhasebeMi = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, MUHASEBE])).rowCount);
  // YG-845: tedarikçi ödemesi tahsilattan bağımsız, faturadan 60 gün vadeli planlanır; üçlü eşleşme tamamlanmadan ödenmez.
  s.get('/tedarikci-odemeleri', oturumlu, async (i, y) => {
    if (!(await muhasebeMi(i.oturum!.kullanici))) return yok(y);
    return (await b.db.query(`SELECT f.kimlik, f.fatura_no, f.tarih::text, f.tutar_eur, (f.tarih + 60)::text AS vade, u.ticari_unvan, s.siparis_no, (SELECT e.sonuc FROM uclu_eslestirme e WHERE e.siparis_ref = f.siparis_ref AND e.fatura_no = f.fatura_no LIMIT 1) AS eslestirme FROM tedarikci_faturasi f JOIN kurulus u ON u.kimlik = f.kurulus_ref JOIN tedarik_siparisi s ON s.kimlik = f.siparis_ref WHERE f.odeme_zamani IS NULL ORDER BY f.tarih`)).rows;
  });
  s.post('/tedarikci-odemeleri/:id/odendi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await muhasebeMi(o.kullanici))) return yok(y);
    const f = (await b.db.query(`SELECT f.kimlik, f.fatura_no, f.kurulus_ref, f.odeme_zamani, (SELECT e.sonuc FROM uclu_eslestirme e WHERE e.siparis_ref = f.siparis_ref AND e.fatura_no = f.fatura_no LIMIT 1) AS eslestirme FROM tedarikci_faturasi f WHERE f.kimlik = $1`, [id])).rows[0];
    if (!f) return yok(y);
    if (f.odeme_zamani) return y.code(409).send({ hata: 'Bu fatura ödenmiştir.' });
    if (f.eslestirme !== 'Eşleşti') return y.code(409).send({ hata: 'Üçlü eşleşme tamamlanmadan ödeme kaydedilmemektedir.' });
    if (!(await b.db.query(`SELECT 1 FROM banka_hesabi WHERE kurulus_ref = $1 AND durum = 'Geçerli'`, [f.kurulus_ref])).rowCount) return y.code(409).send({ hata: 'Tedarikçinin teyitli banka hesabı bekleniyor.' }); // YG-928
    await b.db.query(`UPDATE tedarikci_faturasi SET odeme_zamani = now(), odeyen_ref = $2 WHERE kimlik = $1`, [id, o.kullanici]);
    const kisiler = (await b.db.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [f.kurulus_ref])).rows.map((r) => r.kullanici_ref as string);
    await bildir(b.db, { olay: `tedarikci-odeme:${id}`, kullanicilar: kisiler, baslik: `Fatura ${f.fatura_no} Ödendi` });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Tedarikçi Ödemesi', nesneTuru: 'Tedarikçi Faturası', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Ödendi' };
  });

  // YG-830: onaylı talimat bankada ödenince kaydedilir; plan tahsilat geldiyse güncel tahsilat tarihinden yeniden hesaplanır (V-131).
  const planTarihi = async (dosya: string, olusturma: Date) => {
    const th = (await b.db.query(`SELECT max(tarih) t FROM tahsilat WHERE dosya_ref = $1`, [dosya])).rows[0].t;
    return firmaOdemePlani(th ? new Date(th) : null, olusturma, await parametre(b.db, 'firma_odeme_gun'), await parametre(b.db, 'firma_odeme_azami_gun'));
  };
  s.get('/firma-odemeleri', oturumlu, async (i, y) => {
    if (!(await muhasebeMi(i.oturum!.kullanici))) return yok(y);
    const l = (await b.db.query(`SELECT t.kimlik, t.tutar_eur, t.olusturma_zamani, h.hakedis_no, h.dosya_ref, h.firma_fatura_no, u.ticari_unvan FROM odeme_talimati t JOIN hakedis h ON h.kimlik = t.hakedis_ref JOIN kurulus u ON u.kimlik = t.kurulus_ref WHERE t.durum = 'Onaylandı' ORDER BY t.olusturma_zamani`)).rows;
    return Promise.all(l.map(async (x) => { const p = await planTarihi(x.dosya_ref, x.olusturma_zamani); return { kimlik: x.kimlik, tutar_eur: x.tutar_eur, hakedis_no: x.hakedis_no, firma_fatura_no: x.firma_fatura_no, ticari_unvan: x.ticari_unvan, plan: p.tarih.toISOString().slice(0, 10), tahsilataBagli: p.tahsilataBagli }; }));
  });
  s.post('/firma-odemeleri/:id/odendi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const referans = ((i.body ?? {}) as { referans?: string }).referans?.trim();
    if (!UUID.test(id) || !(await muhasebeMi(o.kullanici))) return yok(y);
    const t = (await b.db.query(`SELECT t.*, h.dosya_ref, h.hakedis_no, e.teknik_kabul_eden_ref FROM odeme_talimati t JOIN hakedis h ON h.kimlik = t.hakedis_ref JOIN is_emri e ON e.kimlik = h.is_emri_ref WHERE t.kimlik = $1`, [id])).rows[0];
    if (!t) return yok(y);
    if (t.durum !== 'Onaylandı') return y.code(409).send({ hata: 'Ödeme talimatı onaylı değildir.' });
    if (!referans) return y.code(400).send({ hata: 'Banka işlem referansını yazmanızı rica ederiz.' });
    const onaylayan = (await b.db.query(`SELECT 1 FROM is_karti_adim a JOIN is_karti k ON k.kimlik = a.is_ref WHERE k.tur = 'Firma Ödeme Talimatı' AND k.nesne_kimligi = $1 AND a.yapan_ref = $2 LIMIT 1`, [id, o.kullanici])).rowCount;
    if (o.kullanici === t.hazirlayan_ref || onaylayan || o.kullanici === t.teknik_kabul_eden_ref) return y.code(409).send({ hata: 'Talimatı hazırlayan, onaylayan veya teknik kabulü veren kişi ödemeyi kaydedemez; başka bir yetkiliden işlem bekleniyor.' }); // YG-827, YG-830
    if (!(await b.db.query(`SELECT 1 FROM banka_hesabi WHERE kurulus_ref = $1 AND durum = 'Geçerli'`, [t.kurulus_ref])).rowCount) return y.code(409).send({ hata: 'Firmanın teyitli banka hesabı bekleniyor.' }); // YG-928
    const p = await planTarihi(t.dosya_ref, t.olusturma_zamani);
    if (p.tarih.getTime() > Date.now()) return y.code(409).send({ hata: `Ödeme planı tarihi ${p.tarih.toISOString().slice(0, 10).split('-').reverse().join('.')} olup bu tarih bekleniyor.` });
    if ((await b.db.query(`SELECT 1 FROM odeme_talimati WHERE banka_referansi = $1`, [referans])).rowCount) return y.code(409).send({ hata: 'Bu banka referansıyla kayıt vardır; mükerrer ödeme engellendi.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE odeme_talimati SET durum = 'Ödendi', odeyen_ref = $2, odeme_zamani = now(), banka_referansi = $3 WHERE kimlik = $1`, [id, o.kullanici, referans]);
      await c.query(`UPDATE hakedis SET statu = 'Ödendi' WHERE kimlik = $1`, [t.hakedis_ref]);
      const kisiler = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [t.kurulus_ref])).rows.map((r) => r.kullanici_ref as string);
      await bildir(c, { olay: `firma-odeme:${id}`, kullanicilar: kisiler, baslik: `${t.hakedis_no} Ödendi` });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Firma Ödemesi', nesneTuru: 'Ödeme Talimatı', nesneKimligi: id, yeni: { referans }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    return { durum: 'Ödendi' };
  });
}
