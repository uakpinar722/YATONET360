import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez, disGonder } from './bildirim.js';
import { davetOlustur } from './ilk_giris.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const MPM = 'Müşteri ve Paydaş İlişkileri Müdürü';

/** YG-1557: her Ocak liste TSB Tekne branşı verisi ve MERSİS unvanıyla güncellenir. */
export async function sigortaListesiGorevi(db: Pool, simdi = new Date()): Promise<boolean> {
  if (simdi.getMonth() !== 0 || !(await birKez(db, 'sigorta-listesi', String(simdi.getFullYear())))) return false;
  await kartAc(db, { tur: 'Sigorta Şirketi Listesi Güncellemesi', kategori: 'gorev', baslik: `${simdi.getFullYear()} Sigorta Şirketi Listesi Güncellemesi`, ozet: 'TSB Tekne branşı şirket listesini ve MERSİS unvanlarını teyit ederek güncelleyiniz.', sahipRol: await rolId(db, MPM), sonZaman: new Date(simdi.getFullYear(), 0, 31, 18), nesneTuru: 'Sigorta Şirketi Listesi', nesneKimligi: String(simdi.getFullYear()) });
  return true;
}

/** YG-1557: sigorta şirketleri tam kurumsal unvanla; giriş ekranlarına açılır liste kaynağıdır. Yazılan kısa ad veritabanında tam unvana çevrilir. */
export function sigortaSirketiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/sigorta-sirketleri', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    return (await b.db.query(`SELECT tsb_kodu, kisa_ad, tam_unvan, dayanak, mersis_teyit_tarihi, durum FROM sigorta_sirketi ORDER BY durum, tam_unvan`)).rows;
  });
  // YG-453: sigorta şirketinin yazılı olarak yetkilendirdiği kişiye (yetkili veya eksper) sigorta portalı hesabı açılır; kişi yalnız o şirketin dosyalarını görür.
  s.post('/sigorta-kullanici', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tsbKodu?: string; ad?: string; eposta?: string; telefon?: string; dayanak?: string };
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2`, [o.kullanici, MPM])).rowCount) return yok(y);
    const sg = (await b.db.query(`SELECT tsb_kodu, tam_unvan FROM sigorta_sirketi WHERE tsb_kodu = $1 AND durum = 'Aktif'`, [g.tsbKodu ?? ''])).rows[0];
    if (!sg) return y.code(400).send({ hata: 'Sigorta şirketini listeden seçiniz.' });
    const eposta = g.eposta?.trim();
    if (!g.ad?.trim() || !eposta || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(eposta)) return y.code(400).send({ hata: 'Ad soyad ve geçerli e-posta zorunludur.' });
    if (!g.dayanak?.trim()) return y.code(400).send({ hata: 'Sigorta şirketinin yetkilendirme yazısının tarih ve sayısını yazınız.' });
    if ((await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE lower(e_posta COLLATE "C") = lower($1::text COLLATE "C") LIMIT 1`, [eposta])).rowCount) return y.code(409).send({ hata: 'Bu e-posta adresiyle kayıtlı hesap bulunmaktadır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const { kimlik, belirtec } = await davetOlustur(c, { adSoyad: g.ad.trim(), eposta, telefon: g.telefon?.trim() || undefined, grup: 'Sigorta Şirketi / Eksper', rol: 'Sigorta Şirketi Kullanıcısı', olusturan: o.kullanici });
      await c.query(`INSERT INTO sigorta_kullanici (kullanici_ref, sigortaci_adi, tsb_kodu) VALUES ($1,$2,$3)`, [kimlik, sg.tam_unvan, sg.tsb_kodu]); // YG-1758
      await disGonder(c, { olay: `sigorta-davet:${kimlik}`, eposta, konu: 'YATONET 360 Hesabınız', metin: `LİMİT GLOBAL MARINE: ${sg.tam_unvan} adına YATONET 360 hesabınız açılmıştır. İlk girişinizi 7 gün içinde aşağıdaki bağlantıdan yapmanızı rica ederiz. ${b.webAdresi}/#davet=${belirtec}`, acil: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Portalı Hesabı Açıldı', nesneTuru: 'Kullanıcı', nesneKimligi: kimlik, yeni: { sigorta: sg.tam_unvan, eposta }, gerekce: g.dayanak.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-453: Müşteri ve Paydaş İlişkileri Müdürü açtığı sigorta portalı hesaplarını görür; kapatma ayrılış bildirimiyle (/dis-kullanici/:id/ayrilis-bildirimi) yapılır.
  s.get('/sigorta-kullanicilar', oturumlu, async (i, y) => {
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2`, [i.oturum!.kullanici, MPM])).rowCount) return yok(y);
    return (await b.db.query(`SELECT h.kimlik, h.ad_soyad, h.e_posta, h.hesap_durumu, s.sigortaci_adi, s.tsb_kodu FROM sigorta_kullanici s JOIN kullanici_hesabi h ON h.kimlik = s.kullanici_ref ORDER BY s.sigortaci_adi, h.hesap_durumu, h.ad_soyad`)).rows;
  });

  // YG-1758: siciline bağlanmamış (veya yanlış bağlı) kullanıcı, Müşteri ve Paydaş İlişkileri Müdürünce şirket kaydına bağlanır; unvan sicilden alınır.
  s.post('/sigorta-kullanici/:id/bagla', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tsbKodu?: string };
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2`, [o.kullanici, MPM])).rowCount) return yok(y);
    const sg = (await b.db.query(`SELECT tsb_kodu, tam_unvan FROM sigorta_sirketi WHERE tsb_kodu = $1 AND durum = 'Aktif'`, [g.tsbKodu ?? ''])).rows[0];
    if (!sg) return y.code(400).send({ hata: 'Sigorta şirketini listeden seçiniz.' });
    const eski = (await b.db.query(`SELECT sigortaci_adi, tsb_kodu FROM sigorta_kullanici WHERE kullanici_ref = $1`, [id])).rows[0];
    if (!eski) return yok(y);
    await b.db.query(`UPDATE sigorta_kullanici SET tsb_kodu = $2, sigortaci_adi = $3 WHERE kullanici_ref = $1`, [id, sg.tsb_kodu, sg.tam_unvan]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Kullanıcısı Şirkete Bağlandı', nesneTuru: 'Kullanıcı', nesneKimligi: id, eski, yeni: { tsb_kodu: sg.tsb_kodu, sigortaci_adi: sg.tam_unvan }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // Kayıt açılışında ve yıllık güncellemede MERSİS unvanıyla teyit edilir.
  s.post('/sigorta-sirketi', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2`, [o.kullanici, MPM])).rowCount) return yok(y);
    const g = (i.body ?? {}) as { tsbKodu?: string; kisaAd?: string; tamUnvan?: string; mersisUnvani?: string; teyitTarihi?: string; durum?: string };
    if (!/^\d{4}$/.test(g.tsbKodu ?? '') || !g.kisaAd?.trim() || !g.tamUnvan?.trim() || !g.mersisUnvani?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(g.teyitTarihi ?? '')) return y.code(400).send({ hata: 'TSB kodu, kısa ad, tam unvan, MERSİS unvanı ve teyit tarihi zorunludur.' });
    if (g.durum && g.durum !== 'Aktif' && g.durum !== 'Pasif') return y.code(400).send({ hata: 'Durum Aktif veya Pasif olmalıdır.' });
    const eski = (await b.db.query(`SELECT * FROM sigorta_sirketi WHERE tsb_kodu = $1`, [g.tsbKodu])).rows[0] ?? null;
    await b.db.query(`INSERT INTO sigorta_sirketi (tsb_kodu, kisa_ad, tam_unvan, dayanak, mersis_unvani, mersis_teyit_tarihi, durum, guncelleyen_ref) VALUES ($1,$2,$3,'Yıllık Güncelleme',$4,$5,$6,$7)
      ON CONFLICT (tsb_kodu) DO UPDATE SET kisa_ad = EXCLUDED.kisa_ad, tam_unvan = EXCLUDED.tam_unvan, mersis_unvani = EXCLUDED.mersis_unvani, mersis_teyit_tarihi = EXCLUDED.mersis_teyit_tarihi, durum = EXCLUDED.durum, guncelleyen_ref = EXCLUDED.guncelleyen_ref, guncelleme_zamani = now()`,
      [g.tsbKodu, g.kisaAd.trim(), g.tamUnvan.trim(), g.mersisUnvani.trim(), g.teyitTarihi, g.durum ?? 'Aktif', o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Şirketi Kaydı', nesneTuru: 'Sigorta Şirketi', nesneKimligi: g.tsbKodu!, eski, yeni: { tam_unvan: g.tamUnvan.trim(), durum: g.durum ?? 'Aktif' }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
