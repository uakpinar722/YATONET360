import type { FastifyInstance, FastifyReply } from 'fastify';
import { bildir, disGonder } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { davetOlustur } from './ilk_giris.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
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

export function kurumHesapYollari(s: FastifyInstance, b: Baglam) {
  webAdresi = b.webAdresi;
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const kurumum = async (k: string) => (await b.db.query(`SELECT u.kimlik, u.sicil_no, u.ticari_unvan, u.kayit_rolu, u.kurumsal_eposta, u.kurumsal_telefon, u.il, u.ilce FROM kurulus_kullanici x JOIN kurulus u ON u.kimlik = x.kurulus_ref WHERE x.kullanici_ref = $1 LIMIT 1`, [k])).rows[0];

  // YG-425, YG-1574, YG-1575, YG-1577: firma bilgileri ve kullanıcılar; kurum yalnız kendini görür.
  s.get('/kurum/hesap', oturumlu, async (i, y) => {
    const u = await kurumum(i.oturum!.kullanici);
    if (!u) return yok(y);
    const kullanicilar = (await b.db.query(`SELECT h.kimlik, h.ad_soyad, h.e_posta, h.cep_telefonu, h.hesap_durumu FROM kurulus_kullanici x JOIN kullanici_hesabi h ON h.kimlik = x.kullanici_ref WHERE x.kurulus_ref = $1 ORDER BY h.hesap_durumu, h.ad_soyad`, [u.kimlik])).rows;
    const talepler = (await b.db.query(`SELECT kimlik, ad_soyad, eposta, durum FROM kurum_kullanici_talebi WHERE kurulus_ref = $1 AND durum <> 'Açıldı' ORDER BY olusturma_zamani DESC LIMIT 20`, [u.kimlik])).rows;
    return { kurum: u, kullanicilar: kullanicilar.map((x) => ({ ...x, ben: x.kimlik === i.oturum!.kullanici })), talepler };
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
}
