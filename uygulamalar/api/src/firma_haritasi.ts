import type { FastifyInstance, FastifyReply } from 'fastify';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

/** YG-364: ağ statüsü renkleri; çıkarılmış ve reddedilmiş firma haritada yoktur. */
export function firmaRengi(f: { kayit_asamasi: string; ag_statusu: string; risk_derecesi: string | null }): { renk: string; etiket: string } | null {
  if (f.ag_statusu === 'Çıkarıldı' || f.kayit_asamasi === 'Reddedildi') return null;
  if (f.kayit_asamasi === 'Aday') return { renk: '#cfd4da', etiket: 'Değerlendirilmemiş Aday' };
  if (f.kayit_asamasi === 'Başvuru' || f.kayit_asamasi === 'İncelemede') return { renk: '#2f6fd6', etiket: 'Sicil İncelemesindeki Aday' };
  if (f.ag_statusu === 'Aktif') return f.risk_derecesi === 'Tercihli' ? { renk: '#0b6b2e', etiket: 'Aktif–Tercihli' } : f.risk_derecesi === 'Yakın İzleme' ? { renk: '#e0b100', etiket: 'Aktif–Yakın İzleme' } : { renk: '#36a852', etiket: 'Aktif–Standart' };
  if (f.ag_statusu === 'Kısıtlı') return { renk: '#f08a24', etiket: 'Kısıtlı' };
  if (f.ag_statusu === 'Geçici Askıda' || f.ag_statusu === 'Askıda') return { renk: '#d22d2d', etiket: f.ag_statusu };
  return { renk: '#8a8f96', etiket: 'Pasif' };
}

export const mesafeKm = (a: number, b: number, c: number, d: number) => { const r = Math.PI / 180; const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return Math.round(6371 * 2 * Math.asin(Math.sqrt(x)) * 10) / 10; };

/**
 * YG-364–366: firma haritası; Çözüm Ortağı ve aday firmaların tesisleri statü rengiyle, bağlama noktaları türüne göre gösterilir; her tesise en yakın üç bağlama noktası mesafesiyle verilir.
 * Firma adı yalnız Firma Yönetimi, Operasyon ve üst yönetim rollerine açıktır; diğer iç roller yalnız statü rengini görür.
 */
export function firmaHaritasiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/firma-haritasi', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const roller = (await b.db.query(`SELECT r.rol_adi, r.kademe, r.rol_sahibi_birim FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [o.kullanici])).rows as { rol_adi: string; kademe: string; rol_sahibi_birim: string }[];
    const adGorur = roller.some((r) => ['Firma Yönetimi Müdürlüğü', 'Operasyon Müdürlüğü', 'Üst Yönetim'].includes(r.rol_sahibi_birim) || r.kademe === 'Direktör' || r.rol_adi === 'Genel Müdür Yardımcısı' || r.rol_adi === 'CEO' || r.rol_adi === 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü');
    const noktalar = (await b.db.query(`SELECT kimlik, tur, ad, il, enlem::float8 enlem, boylam::float8 boylam FROM baglama_noktasi WHERE enlem IS NOT NULL AND boylam IS NOT NULL AND (mukerrer_karari IS DISTINCT FROM 'Birleştirildi')`)).rows as { kimlik: string; tur: string; ad: string; il: string | null; enlem: number; boylam: number }[];
    const tesisler = (await b.db.query(`SELECT t.kimlik, t.ad tesis, t.il, t.enlem::float8 enlem, t.boylam::float8 boylam, k.ticari_unvan, k.kayit_rolu, k.kayit_asamasi, k.ag_statusu, k.risk_derecesi FROM firma_tesisi t JOIN kurulus k ON k.kimlik = t.kurulus_ref WHERE t.enlem IS NOT NULL AND t.boylam IS NOT NULL AND k.kayit_rolu = 'Çözüm Ortağı'`)).rows;
    const firmalar = tesisler.flatMap((t) => {
      const r = firmaRengi(t); if (!r) return [];
      const yakin = noktalar.map((n) => ({ ad: n.ad, tur: n.tur, km: mesafeKm(t.enlem, t.boylam, n.enlem, n.boylam) })).sort((a, c) => a.km - c.km).slice(0, 3);
      return [{ kimlik: t.kimlik, ad: adGorur ? t.ticari_unvan : null, il: t.il, enlem: t.enlem, boylam: t.boylam, ...r, yakin }];
    });
    return { adGorur, firmalar, noktalar: noktalar.map((n) => ({ ad: n.ad, tur: n.tur, enlem: n.enlem, boylam: n.boylam })) };
  });
}
