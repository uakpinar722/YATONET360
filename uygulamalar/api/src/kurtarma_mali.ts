import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
const MFM = 'Muhasebe ve Finans Müdürü';
const KURTARMA_BEDEL = ['Kurtarma', 'Çekme / Refakat', 'Dalgıçlık'];
const R2 = (x: number) => Math.round(x * 100) / 100;

/**
 * YG-847, YG-848: kurtarma, çekme ve dalış işinde fiyatı müşteriye LGM verir ve faturalar (teklif bedel türleri);
 * hizmet sağlayıcı LGM'ye fatura keser. Sağlayıcıya yapılan ödeme mahsup kaydıyla tutulur ve yalnız LGM kullanıcılarına görünür.
 */
export function kurtarmaMaliYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, rol: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2`, [k, rol])).rowCount);
  // Sağlayıcıya ödenen tutar firma ve müşteri kullanıcılarına gösterilmez.
  const lgmMi = async (k: string) => !(await b.db.query(`SELECT 1 FROM kurulus_kullanici WHERE kullanici_ref = $1 UNION ALL SELECT 1 FROM dosya_tarafi WHERE kullanici_ref = $1 LIMIT 1`, [k])).rowCount;

  s.post('/kurtarma/:id/saglayici-faturasi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { faturaNo?: string; tarih?: string; tutar?: number; belge?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT dosya_ref, saglayici_ref FROM kurtarma_operasyonu WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (!(await rolVar(o.kullanici, TICARI))) return y.code(403).send({ hata: 'Sağlayıcı faturasını Ticari Sorumlu kaydeder.' });
    if (!g.faturaNo?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih ?? '') || !(Number(g.tutar) > 0)) return y.code(400).send({ hata: 'Fatura numarası, tarihi ve tutarı zorunludur.' });
    if (g.belge && !(UUID.test(g.belge) && (await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1`, [g.belge])).rowCount)) return y.code(400).send({ hata: 'Fatura belgesini dosyaya yükleyip seçiniz.' });
    if ((await b.db.query(`SELECT 1 FROM kurtarma_saglayici_faturasi WHERE saglayici_ref = $1 AND fatura_no = $2 AND durum <> 'Reddedildi'`, [k.saglayici_ref, g.faturaNo.trim()])).rowCount) return y.code(409).send({ hata: 'Bu fatura numarası daha önce kaydedilmiştir.' });
    const r = (await b.db.query(`INSERT INTO kurtarma_saglayici_faturasi (operasyon_ref, dosya_ref, saglayici_ref, fatura_no, fatura_tarihi, tutar_eur, belge_ref, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [id, k.dosya_ref, k.saglayici_ref, g.faturaNo.trim(), g.tarih, R2(Number(g.tutar)), g.belge || null, o.kullanici])).rows[0];
    return { kimlik: r.kimlik };
  });

  // Ödeme kaydı Muhasebe ve Finans Müdürünce, faturayı kaydedenden başka kişi tarafından girilir; mahsup kaydı LGM fiyatıyla birlikte tutulur.
  s.post('/kurtarma-saglayici-faturasi/:id/odendi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { referans?: string; tarih?: string };
    if (!UUID.test(id)) return yok(y);
    const f = (await b.db.query(`SELECT * FROM kurtarma_saglayici_faturasi WHERE kimlik = $1`, [id])).rows[0];
    if (!f || !(await dosyaErisimi(b.db, o.kullanici, f.dosya_ref))) return yok(y);
    if (!(await rolVar(o.kullanici, MFM))) return y.code(403).send({ hata: 'Sağlayıcı ödemesini Muhasebe ve Finans Müdürü kaydeder.' });
    if (f.kaydeden_ref === o.kullanici) return y.code(403).send({ hata: 'Görev ayrılığı gereği ödemenin faturayı kaydeden dışında bir yetkili tarafından kaydedilmesini rica ederiz.' });
    if (f.durum !== 'Kontrolde') return y.code(409).send({ hata: 'Bu fatura için ödeme kaydı yapılmıştır.' });
    if (!g.referans?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih ?? '')) return y.code(400).send({ hata: 'Banka referansı ve ödeme tarihi zorunludur.' });
    const lgm = Number((await b.db.query(`SELECT coalesce(sum(k.tutar_eur), 0) t FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi t ON t.kimlik = k.teklif_ref WHERE t.dosya_ref = $1 AND k.onay_durumu = 'Onaylandı' AND k.bedel_turu = ANY($2::text[])`, [f.dosya_ref, KURTARMA_BEDEL])).rows[0].t);
    await b.db.query(`UPDATE kurtarma_saglayici_faturasi SET durum = 'Ödendi', odeme_referansi = $2, odeme_tarihi = $3, odeyen_ref = $4, mahsup_lgm_fiyati_eur = $5 WHERE kimlik = $1`, [id, g.referans.trim(), g.tarih, o.kullanici, R2(lgm)]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurtarma Sağlayıcı Ödemesi', nesneTuru: 'Dosya', nesneKimligi: f.dosya_ref, yeni: { fatura: f.fatura_no, tutar: Number(f.tutar_eur) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Ödendi' };
  });

  s.get('/dosya/:id/kurtarma-mali', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id)) || !(await lgmMi(o.kullanici))) return yok(y);
    const lgmFiyat = R2(Number((await b.db.query(`SELECT coalesce(sum(k.tutar_eur), 0) t FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi t ON t.kimlik = k.teklif_ref WHERE t.dosya_ref = $1 AND k.onay_durumu = 'Onaylandı' AND k.bedel_turu = ANY($2::text[])`, [id, KURTARMA_BEDEL])).rows[0].t));
    const faturalar = (await b.db.query(`SELECT f.kimlik, f.fatura_no, f.fatura_tarihi::text, (f.fatura_tarihi + 60)::text vade, f.tutar_eur::float tutar, f.durum, f.odeme_tarihi::text, f.odeme_referansi, u.ticari_unvan saglayici FROM kurtarma_saglayici_faturasi f JOIN kurulus u ON u.kimlik = f.saglayici_ref WHERE f.dosya_ref = $1 ORDER BY f.olusturma_zamani`, [id])).rows;
    const odenen = R2(faturalar.filter((f) => f.durum === 'Ödendi').reduce((a, f) => a + f.tutar, 0));
    return { lgmFiyat, faturalar, saglayiciFaturaToplami: R2(faturalar.filter((f) => f.durum !== 'Reddedildi').reduce((a, f) => a + f.tutar, 0)), saglayiciyaOdenen: odenen, mahsupSonrasi: R2(lgmFiyat - odenen) };
  });
}
