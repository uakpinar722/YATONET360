import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { belgeUret } from './belge_uret.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
/** YG-644: Kurtarma, Çekme ve Dalgıçlık Hizmet Sağlayıcı Sözleşmesi Ek-2; tüm sözleşmelerde aynı 27 satır. */
export const SATIRLAR = ['Operasyon Dosya No / Ek-1 Sürümü', 'Yat / Bayrak / Sicil / Gövde No', 'Hizmet Sağlayıcı / Araç / Personel', 'Hizmet Türü', 'Talep / İşe Başlama / İşin Bitişi Tarih-Saati', 'Başlangıç Yeri / Bitiş Yeri / Son Koordinat', 'Operasyon Özeti / Fiilen Yapılan İş', 'Kurtarma: Tehlike / Müdahale / Sonuç / Korunan Çevre', 'Çekme: Rota / Süre / Bağlantı / Seyir / Durum', 'Dalış: Plan / Dalgıçlar / Derinlik / Süre / Kayıt No', 'Kaptan / Operasyon Sorumlusu / Dalış Amiri', 'Hava / Deniz / Görüş / Akıntı / Ölçümler', 'Sapma / Değişiklik / Talimat / Onay Kaydı', 'Durdurma / Gecikme / Yeniden Başlama Nedeni', 'Olay / Yaralanma / Hasar / Kirlilik / Resmî Bildirim', 'Yatın İlk Durumu ve Son Durumu', 'Önceden Mevcut Hasar / Operasyon Sırasında Tespit Edilen Hasar', 'Fotoğraf / Video / Seyir / VHF / Dalış Kaydı', 'Kullanılan Araç / Ekipman / Arıza / Test Kaydı', 'Tamamlanmayan İş / Açık Risk / Geçici Tedbir', 'Süre / Ölçüm / Bekleme Kaydı', 'Ek Masraflar / Makbuzlar', 'Teslim Yeri / Tarihi / Saati', 'Teslim Eden / Sıfatı / Yetki Belgesi', 'Teslim Alan / Sıfatı / Yetki Belgesi', 'Teslim Edilen Anahtar / Evrak / Eşya / Numune', 'Ekler / Fotoğraf Listesi / Rapor Sürümü'];
const KART = 'Kurtarma Sonuç Kontrolü';

async function onDoldur(db: Db, id: string) {
  const k = (await db.query(`SELECT k.hizmet_turu, d.dosya_no, y.yat_adi, y.bayrak, u.ticari_unvan FROM kurtarma_operasyonu k JOIN dosya d ON d.kimlik = k.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref JOIN kurulus u ON u.kimlik = k.saglayici_ref WHERE k.kimlik = $1`, [id])).rows[0];
  const t = (await db.query(`SELECT metin, to_char(zaman AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') z FROM kurtarma_talimat WHERE operasyon_ref = $1 ORDER BY zaman`, [id])).rows;
  return { [SATIRLAR[0]!]: k.dosya_no, [SATIRLAR[1]!]: [k.yat_adi, k.bayrak].filter(Boolean).join(' / '), [SATIRLAR[2]!]: k.ticari_unvan, [SATIRLAR[3]!]: k.hizmet_turu, [SATIRLAR[12]!]: t.map((x) => `${x.z} ${x.metin}`).join('; ') } as Record<string, string>;
}

export function kurtarmaSonucYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const firmam = async (k: string, id: string) => (await b.db.query(`SELECT o.kimlik, o.dosya_ref, o.baslama_zamani, d.dosya_no, d.dosya_sorumlusu_ref FROM kurtarma_operasyonu o JOIN dosya d ON d.kimlik = o.dosya_ref JOIN kurulus_kullanici x ON x.kurulus_ref = o.saglayici_ref WHERE o.kimlik = $1 AND x.kullanici_ref = $2`, [id, k])).rows[0];

  s.get('/firma-portal/kurtarma/:id/sonuc', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await firmam(i.oturum!.kullanici, id))) return yok(y);
    const r = (await b.db.query(`SELECT veriler, durum, iade_gerekcesi FROM kurtarma_sonuc WHERE operasyon_ref = $1`, [id])).rows[0];
    return { satirlar: SATIRLAR, degerler: { ...(await onDoldur(b.db, id)), ...(r?.veriler ?? {}) }, durum: r?.durum ?? null, iade: r?.iade_gerekcesi ?? null };
  });

  // YG-275: Sahil Güvenlik veya liman talimatı hızlı kaydedilir, Sapma / Talimat satırına geçer.
  s.post('/firma-portal/kurtarma/:id/talimat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { metin?: string };
    if (!UUID.test(id) || !(await firmam(o.kullanici, id))) return yok(y);
    if (!g.metin?.trim()) return y.code(400).send({ hata: 'Talimat metni zorunludur.' });
    await b.db.query(`INSERT INTO kurtarma_talimat (operasyon_ref, metin, giren_ref) VALUES ($1,$2,$3)`, [id, g.metin.trim(), o.kullanici]);
    return { tamam: true };
  });

  s.post('/firma-portal/kurtarma/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { degerler?: Record<string, string> };
    if (!UUID.test(id)) return yok(y);
    const k = await firmam(o.kullanici, id); if (!k) return yok(y);
    if (!k.baslama_zamani) return y.code(409).send({ hata: 'Operasyon başlamadan sonuç tutanağı girilemez.' });
    const eksik = SATIRLAR.filter((a) => !g.degerler?.[a]?.trim());
    if (eksik.length) return y.code(400).send({ hata: 'Tüm satırları doldurunuz; ilgili olmayan satıra "Yok" veya "Uygulanmaz" yazınız.', eksik });
    const veriler = Object.fromEntries(SATIRLAR.map((a) => [a, g.degerler![a]!.trim()]));
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query(`INSERT INTO kurtarma_sonuc (operasyon_ref, veriler, giren_ref) VALUES ($1,$2,$3) ON CONFLICT (operasyon_ref) DO UPDATE SET veriler = $2, giren_ref = $3, durum = 'Kontrolde', iade_gerekcesi = NULL WHERE kurtarma_sonuc.durum = 'İade' RETURNING operasyon_ref`, [id, JSON.stringify(veriler), o.kullanici]);
      if (!r.rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Sonuç tutanağı girilmiştir.' }); }
      await kartAc(c, { tur: KART, kategori: 'gorev', baslik: `${k.dosya_no} · Kurtarma Sonuç Kontrolü`, sahipKullanici: k.dosya_sorumlusu_ref, nesneTuru: 'Kurtarma', nesneKimligi: id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  s.get('/dosya/:id/kurtarma-sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT k.kimlik, k.hizmet_turu, s.veriler, s.durum FROM kurtarma_operasyonu k JOIN kurtarma_sonuc s ON s.operasyon_ref = k.kimlik WHERE k.dosya_ref = $1 ORDER BY s.zaman DESC`, [id])).rows;
  });
  s.post('/kurtarma/:id/sonuc-kontrol', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; gerekce?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT o.dosya_ref, d.dosya_sorumlusu_ref FROM kurtarma_operasyonu o JOIN dosya d ON d.kimlik = o.dosya_ref WHERE o.kimlik = $1`, [id])).rows[0];
    if (!k || k.dosya_sorumlusu_ref !== o.kullanici) return yok(y);
    if (!['Onayla', 'İade'].includes(g.karar ?? '') || (g.karar === 'İade' && !g.gerekce?.trim())) return y.code(400).send({ hata: 'Karar geçersizdir; iadede gerekçe zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query(`UPDATE kurtarma_sonuc SET durum = $2, iade_gerekcesi = $3, kontrol_eden_ref = $4, kontrol_zamani = now() WHERE operasyon_ref = $1 AND durum = 'Kontrolde' RETURNING operasyon_ref`, [id, g.karar === 'Onayla' ? 'Onaylandı' : 'İade', g.gerekce?.trim() || null, o.kullanici]);
      if (!r.rowCount) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu tutanak kontrol aşamasında değildir.' }); }
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [KART, id]);
      if (g.karar === 'Onayla') await belgeUret(c, { tur: 'Kurtarma Sonuç Tutanağı', nesne: id, dosya: k.dosya_ref });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurtarma Sonuç Kontrolü', nesneTuru: 'Kurtarma', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
