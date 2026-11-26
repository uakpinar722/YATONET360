import type { FastifyInstance } from 'fastify';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { rolSahipleri } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { tutar } from './metin.js';

const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
const UUID = /^[0-9a-f-]{36}$/;
/** Sigorta onay tutarı ne onaylı teklifin KDV hariç toplamına ne de onaylanan kalemlerin toplamına (0,01 EUR tolerans) uyan ve henüz kontrol edilmemiş onaylar. */
const FARKLI = `FROM sigorta_onayi s JOIN fiyat_teklifi t ON t.kimlik = s.teklif_ref JOIN dosya d ON d.kimlik = s.dosya_ref
  WHERE s.karar IN ('Tam Onay', 'Kısmi Onay', 'Koşullu Onay') AND s.tutar_kontrol_sonucu IS NULL AND abs(coalesce(s.onaylanan_tutar_eur, 0) - (coalesce(t.genel_toplam_eur, 0) - coalesce(t.kdv_tutari_eur, 0))) > 0.01
    AND NOT EXISTS (SELECT 1 FROM fiyat_teklifi_kalemi k WHERE k.teklif_ref = t.kimlik AND k.onay_durumu = 'Onaylandı' HAVING abs(sum(k.tutar_eur) - coalesce(s.onaylanan_tutar_eur, 0)) <= 0.01)`; // kısmi onayda onaylanan kalemlerin toplamı da geçerli karşılıktır

/** YG-1608, TZ-6 (CEO 26.11.2026): Ticari Sorumlunun "Kontrol Bekleyenler" bölümü — sigorta onay tutarı doğrulaması. */
export function sigortaTutarYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const ticariMi = async (k: string) => (await rolSahipleri(b.db, await rolId(b.db, TICARI))).includes(k);

  s.get('/ticari/kontrol-bekleyenler', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    if (!(await ticariMi(i.oturum!.kullanici))) return { yetkili: false, kayitlar: [] };
    const l = (await b.db.query(`SELECT s.kimlik, d.dosya_no, t.teklif_no, s.onaylanan_tutar_eur, (coalesce(t.genel_toplam_eur, 0) - coalesce(t.kdv_tutari_eur, 0)) AS teklif_kdv_haric_eur, s.onay_tarihi::text ${FARKLI} ORDER BY s.olusturma_zamani`)).rows;
    return { yetkili: true, kayitlar: l };
  });

  s.post('/sigorta-onayi/:id/tutar-kontrol', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { karar?: string; gerekce?: string };
    if (!(await ticariMi(o.kullanici))) return y.code(403).send({ hata: 'Tutar doğrulamasını Ticari Sorumlu yapar.' });
    if (!UUID.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    if (!['Doğrulandı', 'Gerekçeyle İade Et'].includes(g.karar ?? '')) return y.code(400).send({ hata: 'Kararı seçiniz.' });
    if (g.karar === 'Gerekçeyle İade Et' && !g.gerekce?.trim()) return y.code(400).send({ hata: 'İade gerekçesi zorunludur.' });
    const r = (await b.db.query(`UPDATE sigorta_onayi s SET tutar_kontrol_sonucu = $2, tutar_kontrol_gerekcesi = $3, tutar_kontrol_eden_ref = $4, tutar_kontrol_zamani = now()
      FROM dosya d WHERE s.kimlik = $1 AND d.kimlik = s.dosya_ref AND s.tutar_kontrol_sonucu IS NULL RETURNING s.kaydi_yapan_ref, s.onaylanan_tutar_eur, d.dosya_no`, [id, g.karar === 'Doğrulandı' ? 'Doğrulandı' : 'İade Edildi', g.gerekce?.trim() || null, o.kullanici])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Kayıt bulunamadı veya kontrol edilmiştir.' });
    if (g.karar !== 'Doğrulandı' && r.kaydi_yapan_ref) await bildir(b.db, { olay: `sigorta-tutar-iade:${id}`, kullanicilar: [r.kaydi_yapan_ref], baslik: `${r.dosya_no} · Sigorta Onay Tutarı İade Edildi`, ozet: `Onay tutarı ${tutar(Number(r.onaylanan_tutar_eur))} EUR · ${g.gerekce!.trim()}` });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Onay Tutarı Kontrolü', nesneTuru: 'Sigorta Onayı', nesneKimligi: id, yeni: { karar: g.karar, gerekce: g.gerekce?.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
