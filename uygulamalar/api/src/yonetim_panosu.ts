import type { FastifyInstance, FastifyReply } from 'fastify';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { zorunluFormlar } from './zorunlu_form.js';

type Gosterge = { kod: string; ad: string; deger: number; birim: string; birimAdi: string; uyari: boolean };
/** Göstergenin sahibi olan müdürlük; Müdür kendi müdürlüğünü, Direktör bağlı müdürlüklerini, GMY ve CEO tümünü görür. */
const BAGLI: Record<string, string[]> = {
  'Teknik ve Operasyon Direktörü': ['Operasyon Müdürlüğü', 'Teknik Müdürlük', 'Tedarik Yönetimi Müdürlüğü'],
  'Ticari İşler Direktörü': ['Muhasebe ve Finans Müdürlüğü', 'İnsan Kaynakları Müdürlüğü', 'İdari İşler Müdürlüğü'],
  'Bilgi Teknolojileri ve Firma Yönetimi Direktörü': ['Bilgi İşlem Müdürlüğü', 'Firma Yönetimi Müdürlüğü'],
  'Risk ve Kalite Direktörü': ['Kalite Müdürlüğü', 'İç Denetim Müdürlüğü'],
  'Strateji ve Kurumsal Gelişim Direktörü': ['Müşteri ve Paydaş İlişkileri Müdürlüğü'],
};

/**
 * YG-758, YG-759: yönetim panosu sistemce üretilir; açık dosya, süre aşımı, bütçe sapması, bekleyen onay, eksik belge, kalite, yeniden işleme,
 * firma performansı, tahsilat ve garanti geri dönüşleri. Müdür kendi biriminin, Direktör bağlı birimlerinin, GMY ve CEO tümünün göstergelerini görür.
 */
export function yonetimPanosuYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const n = async (sql: string, p: unknown[] = []) => Number((await b.db.query(sql, p)).rows[0].n ?? 0);

  s.get('/yonetim-panosu', oturumlu, async (i, y) => {
    const roller = (await b.db.query(`SELECT r.rol_adi, r.kademe, r.rol_sahibi_birim FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.kullanici_gruplari = 'LGM İç Rolü'`, [i.oturum!.kullanici])).rows as { rol_adi: string; kademe: string; rol_sahibi_birim: string }[];
    const tum = roller.some((r) => r.rol_adi === 'CEO' || r.rol_adi === 'Genel Müdür Yardımcısı');
    const birimler = new Set<string>(); for (const r of roller) { if (r.kademe === 'Müdür') birimler.add(r.rol_sahibi_birim); for (const x of BAGLI[r.rol_adi] ?? []) birimler.add(x); }
    if (!tum && !birimler.size) return yok(y);
    const gor = (birim: string) => tum || birimler.has(birim);
    const l: Gosterge[] = [];
    const ekle = async (kod: string, ad: string, birim: string, f: () => Promise<number>, br = 'adet', esik = 0) => { if (!gor(birim)) return; const d = await f(); l.push({ kod, ad, deger: d, birim: br, birimAdi: birim, uyari: d > esik }); };
    const OP = 'Operasyon Müdürlüğü';
    await ekle('acik', 'Açık Dosya', OP, () => n(`SELECT count(*) n FROM dosya WHERE statu NOT IN ('Kapalı', 'Teknik Kapalı')`), 'adet', Number.MAX_SAFE_INTEGER);
    await ekle('kritik', 'Kritik ve Yüksek Öncelikli Açık Dosya', OP, () => n(`SELECT count(*) n FROM dosya WHERE statu NOT IN ('Kapalı', 'Teknik Kapalı') AND oncelik IN ('Kritik', 'Yüksek')`), 'adet', Number.MAX_SAFE_INTEGER);
    await ekle('sure', 'Süresi Aşılan Süreç Adımı', OP, () => n(`SELECT count(*) n FROM dosya_sure WHERE tamamlanma IS NULL AND bitis < now()`));
    await ekle('beklemede', 'Beklemede İşaretli Dosya', OP, () => n(`SELECT count(DISTINCT dosya_ref) n FROM beklemede_isareti WHERE kaldirilma_zamani IS NULL`), 'adet', Number.MAX_SAFE_INTEGER);
    await ekle('butce', 'Bütçe Sapması Uyarısı (Açık)', 'Teknik Müdürlük', () => n(`SELECT count(*) n FROM is_karti WHERE tur = 'Bütçe Erken Uyarısı' AND durum = 'Bekliyor'`));
    await ekle('onay', 'Süresi Geçmiş Bekleyen Onay', OP, () => n(`SELECT count(*) n FROM is_karti WHERE kategori = 'onay' AND durum = 'Bekliyor' AND son_zaman < now()`));
    if (gor('Kalite Müdürlüğü')) {
      const acik = (await b.db.query(`SELECT kimlik FROM dosya WHERE statu NOT IN ('Kapalı', 'Teknik Kapalı') ORDER BY olusturma_zamani DESC LIMIT 200`)).rows;
      let eksik = 0; for (const d of acik) if ((await zorunluFormlar(b.db, d.kimlik)).some((f) => !f.var)) eksik++;
      l.push({ kod: 'eksik', ad: 'Zorunlu Formu Eksik Açık Dosya', deger: eksik, birim: 'adet', birimAdi: 'Kalite Müdürlüğü', uyari: eksik > 0 });
    }
    await ekle('uygunsuzluk', 'Açık Uygunsuzluk', 'Kalite Müdürlüğü', () => n(`SELECT count(*) n FROM uygunsuzluk WHERE statu NOT IN ('Kapalı', 'Geçersiz')`));
    await ekle('yeniden', 'Yeniden İşleme (Son 90 Gün Başarısız Test)', 'Kalite Müdürlüğü', () => n(`SELECT count(*) n FROM test_kaydi WHERE sonuc = 'Başarısız' AND olusturma_zamani > now() - interval '90 days'`));
    await ekle('firma', 'Yakın İzlemedeki Firma', 'Firma Yönetimi Müdürlüğü', () => n(`SELECT count(*) n FROM kurulus WHERE risk_derecesi = 'Yakın İzleme'`));
    await ekle('tahsilat', 'Vadesi Geçmiş Alacak', 'Muhasebe ve Finans Müdürlüğü', () => n(`SELECT coalesce(sum(toplam_eur - tahsil_edilen_eur), 0) n FROM musteri_faturasi WHERE durum IN ('Faturalandı', 'Kısmi Tahsil') AND vade < current_date`), 'EUR');
    await ekle('garanti', 'Garanti Geri Dönüşü (Son 90 Gün)', 'Teknik Müdürlük', () => n(`SELECT count(*) n FROM garanti_sikayet WHERE olusturma_zamani > now() - interval '90 days'`));
    return { kapsam: tum ? 'Tümü' : [...birimler], gostergeler: l, uretim: new Date().toISOString() };
  });
}
