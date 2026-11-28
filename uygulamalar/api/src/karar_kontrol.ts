import type { FastifyInstance, FastifyReply } from 'fastify';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/** Kayıt türünün bağlı olduğu dosya; kart nesnesinden bulunur. */
const DOSYA_TABLOSU: Record<string, string> = { Teklif: 'fiyat_teklifi', 'Kapsam Cetveli': 'kapsam_cetveli', 'Teknik Rapor': 'teknik_rapor', 'İş Emri': 'is_emri', 'Kalite Planı': 'kalite_plani', 'Kart Önerisi': 'kart_onerisi', 'Garanti Kaydı': 'garanti_sikayet', Fatura: 'musteri_faturasi' };
type Madde = { ad: string; sonuc: boolean; aciklama: string };

/**
 * YG-1389 (V-1140): tek karar ekranında risk bazlı kısa kontrol listesi. Görev ayrılığı ve hedef süre her kartta;
 * dosyaya bağlı kartta beklemede işareti ve açık şikâyet, teklifte bant dışı ve katalog dışı kalem yalnız varsa gösterilir.
 * Önceki iade gerekçesi makama hatırlatılır. Engel olan madde düğmeyi kilitlemez; engel kararı ilgili iş kuralı verir.
 */
export function kararKontrolYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/is/:id/karar-kontrolleri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT kimlik, tur, kategori, hazirlayan_ref, zincir, sahip_kullanici_ref, son_zaman, durum, nesne_turu, nesne_kimligi FROM is_karti WHERE kimlik = $1`, [id])).rows[0];
    if (!k || k.kategori !== 'onay') return yok(y);
    const makam = k.sahip_kullanici_ref === o.kullanici || (await b.db.query(`SELECT 1 FROM rol_atamasi WHERE kullanici_ref = $1 AND atama_durumu = 'Aktif' AND rol_ref = ANY($2::text[])`, [o.kullanici, k.zincir ?? []])).rowCount;
    if (!makam) return yok(y);
    const m: Madde[] = [];
    const karar = (await b.db.query(`SELECT 1 FROM is_karti_adim WHERE is_ref = $1 AND yapan_ref = $2`, [id, o.kullanici])).rowCount;
    m.push({ ad: 'Görev Ayrılığı', sonuc: k.hazirlayan_ref !== o.kullanici && !karar, aciklama: k.hazirlayan_ref === o.kullanici ? 'Kaydı siz hazırladınız; karar veremezsiniz.' : karar ? 'Bu kartta önceki bir kademede karar verdiniz.' : 'Hazırlayan ve önceki kademeler sizden farklıdır.' });
    if (k.son_zaman) { const gecti = new Date(k.son_zaman).getTime() < Date.now(); m.push({ ad: 'Hedef Süre', sonuc: !gecti, aciklama: gecti ? 'Hedef süre aşılmıştır; karar gecikme olarak kaydedilir.' : 'Karar hedef süre içindedir.' }); }
    const iade = (await b.db.query(`SELECT gerekce FROM is_karti_adim WHERE is_ref = $1 AND karar = 'Gerekçeyle İade Et' ORDER BY zaman DESC LIMIT 1`, [id])).rows[0];
    if (iade) m.push({ ad: 'Önceki İade', sonuc: false, aciklama: `Kayıt daha önce iade edildi: ${iade.gerekce ?? '—'}. Düzeltmenin yapıldığını kontrol ediniz.` });
    let dosya: string | null = k.nesne_turu === 'Dosya' ? k.nesne_kimligi : null;
    const tablo = DOSYA_TABLOSU[k.nesne_turu ?? ''];
    if (tablo && k.nesne_kimligi && UUID.test(k.nesne_kimligi)) dosya = (await b.db.query(`SELECT dosya_ref::text d FROM ${tablo} WHERE kimlik = $1`, [k.nesne_kimligi])).rows[0]?.d ?? null;
    if (dosya) {
      const bek = (await b.db.query(`SELECT neden FROM beklemede_isareti WHERE dosya_ref = $1 AND kaldirilma_zamani IS NULL`, [dosya])).rows.map((r) => r.neden as string);
      if (bek.length) m.push({ ad: 'Dosya Beklemede', sonuc: false, aciklama: `Dosyada açık beklemede işareti var: ${bek.join(', ')}.` });
      const sik = (await b.db.query(`SELECT count(*)::int n FROM garanti_sikayet WHERE dosya_ref = $1 AND statu <> 'Kapalı'`, [dosya])).rows[0].n as number;
      if (sik && k.nesne_turu !== 'Garanti Kaydı') m.push({ ad: 'Açık Garanti veya Şikâyet', sonuc: false, aciklama: `Dosyada ${sik} açık garanti/şikâyet kaydı var.` });
    }
    if (k.nesne_turu === 'Teklif' && k.nesne_kimligi) {
      const t = (await b.db.query(`SELECT count(*) FILTER (WHERE bant_disi)::int bant, count(*) FILTER (WHERE kartela_disi)::int katalog FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1`, [k.nesne_kimligi])).rows[0];
      if (t?.bant) m.push({ ad: 'Bant Dışı Fiyat', sonuc: false, aciklama: `${t.bant} kalem kartela fiyat bandının dışındadır; gerekçeyi kontrol ediniz.` });
      if (t?.katalog) m.push({ ad: 'Katalog Dışı Kalem', sonuc: false, aciklama: `${t.katalog} kalem katalogda yoktur; fiyat dayanağını kontrol ediniz.` });
    }
    return { kontroller: m };
  });
}
