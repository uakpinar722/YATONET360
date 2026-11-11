import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { KAPASITE, kapasiteYuku } from './dosya.js';
import { firmaAdiGorur } from './is_gorunumu.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const GORUR = ['CEO', 'Genel Müdür Yardımcısı', 'Teknik ve Operasyon Direktörü', 'Operasyon Müdürü', 'Operasyon Yöneticisi', 'Teknik Müdür', 'Teknik Yönetici', 'Firma Yönetimi Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
const UFUK = 14; // gün
const AKTIF = ['Açılış Kontrolünde', 'Aktif', 'Kontrollü Askıda'];

/**
 * YG-749: gerçekçi yük. Personelde yük/eşik, eş zamanlı kritik ve yüksek öncelikli dosya, ortalama zorluk, önümüzdeki 14 günde izin ve nöbet günleri, planlı keşif yerleri;
 * kullanılabilir kapasite eşiğin izin günleriyle orantılı azaltılmış hâlidir. Firmada iş kapasitesi, aktif iş emri, branş ve bölge yetkinliği, kullanılabilir ekipman,
 * bakım/kalibrasyonu geçmiş ekipman, İSG eğitimi geçmiş personel ve kapasite teyidinin güncelliği.
 */
export async function kapasiteAnalizi(db: Pool, adGorur: boolean) {
  const personel = [];
  for (const rol of Object.keys(KAPASITE)) {
    for (const p of (await db.query(`SELECT DISTINCT h.kimlik, h.ad_soyad FROM kullanici_hesabi h JOIN rol_atamasi a ON a.kullanici_ref = h.kimlik AND a.atama_durumu = 'Aktif' JOIN rol r ON r.kimlik = a.rol_ref WHERE r.rol_adi = $1 AND h.hesap_durumu = 'Aktif' ORDER BY h.ad_soyad`, [rol])).rows) {
      const yuk = await kapasiteYuku(db, p.kimlik, rol); const esik = KAPASITE[rol]!;
      const x = (await db.query(`SELECT
          (SELECT count(DISTINCT d.kimlik)::int FROM dosya_ekibi_atamasi e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kullanici_ref = $1 AND e.bitis_zamani IS NULL AND d.statu = ANY($2) AND d.oncelik IN ('Kritik', 'Yüksek')) kritik,
          (SELECT round(avg(d.zorluk_katsayisi)::numeric, 2) FROM dosya_ekibi_atamasi e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kullanici_ref = $1 AND e.bitis_zamani IS NULL AND d.statu = ANY($2)) zorluk,
          (SELECT coalesce(sum(least(bitis, current_date + $3::int) - greatest(baslangic, current_date) + 1), 0)::int FROM izin_talebi WHERE personel_ref = $1 AND durum = 'Onaylandı' AND bitis >= current_date AND baslangic <= current_date + $3::int) izin,
          (SELECT count(*)::int FROM nobet_vardiyasi v JOIN nobet_cizelgesi c ON c.kimlik = v.cizelge_ref WHERE c.durum = 'Yürürlükte' AND v.kullanici_ref = $1 AND v.baslangic < current_date + $3::int AND v.bitis > now()) nobet,
          (SELECT array_agg(DISTINCT d.konum) FROM kesif k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.sorumlu_ref = $1 AND k.durum = 'Planlandı' AND k.planlanan_baslangic < current_date + $3::int AND k.planlanan_bitis > now()) kesif`, [p.kimlik, AKTIF, UFUK])).rows[0];
      const kullanilabilir = Math.round(esik * Math.max(0, 1 - x.izin / UFUK) * 10) / 10;
      personel.push({ kimlik: p.kimlik, ad: p.ad_soyad, rol, yuk, esik, kullanilabilir, doluluk: kullanilabilir ? Math.round((100 * yuk) / kullanilabilir) : null, kritikDosya: x.kritik, ortalamaZorluk: x.zorluk === null ? null : Number(x.zorluk), izinGunu: x.izin, nobetVardiyasi: x.nobet, planliKesif: x.kesif ?? [] });
    }
  }
  const firmalar = (await db.query(`SELECT k.kimlik, k.ticari_unvan, k.kapasite_is, (SELECT max(t.kapasite_teyit_tarihi)::text FROM firma_tesisi t WHERE t.kurulus_ref = k.kimlik) teyit,
      (SELECT count(*)::int FROM is_emri e WHERE e.kurulus_ref = k.kimlik AND e.statu IN ('Kabul Bekliyor', 'Başlangıç Kontrolünde', 'Aktif', 'Çekinceli', 'Durduruldu') AND NOT EXISTS (SELECT 1 FROM is_emri n WHERE n.is_emri_no = e.is_emri_no AND n.surum > e.surum)) aktif_is,
      (SELECT count(*)::int FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kurulus_ref = k.kimlik AND e.statu = 'Aktif' AND d.oncelik = 'Kritik') kritik_is,
      (SELECT array_agg(DISTINCT b.ana_brans || coalesce(' · ' || b.bolge, '')) FROM brans_yetkinligi b WHERE b.kurulus_ref = k.kimlik AND b.durum = 'Aktif') branslar,
      (SELECT count(*)::int FROM firma_ekipmani x WHERE x.kurulus_ref = k.kimlik AND x.kullanilabilir AND coalesce(x.bakim_bitis, 'infinity') >= current_date AND coalesce(x.kalibrasyon_bitis, 'infinity') >= current_date) ekipman,
      (SELECT count(*)::int FROM firma_ekipmani x WHERE x.kurulus_ref = k.kimlik AND (x.bakim_bitis < current_date OR x.kalibrasyon_bitis < current_date)) ekipman_suresi_gecen,
      (SELECT count(*)::int FROM firma_personeli p WHERE p.kurulus_ref = k.kimlik AND p.isg_egitim_bitis < current_date) isg_gecen
    FROM kurulus k WHERE k.kayit_rolu = 'Çözüm Ortağı' AND k.ag_statusu = 'Aktif' ORDER BY k.ticari_unvan`)).rows.map((f, n) => ({
    firma: adGorur ? f.ticari_unvan : `Firma ${n + 1}`, kapasite: f.kapasite_is, aktifIs: f.aktif_is, doluluk: f.kapasite_is ? Math.round((100 * f.aktif_is) / f.kapasite_is) : null, kritikIs: f.kritik_is, branslar: f.branslar ?? [],
    kullanilabilirEkipman: f.ekipman, suresiGecenEkipman: f.ekipman_suresi_gecen, isgSuresiGecenPersonel: f.isg_gecen, teyitEski: !f.teyit || new Date(f.teyit) < new Date(Date.now() - 365 * 86_400_000),
  }));
  return { ufukGun: UFUK, personel, firmalar };
}

export function kapasiteYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/kapasite', oturumlu, async (i, y) => {
    const l = (await b.db.query(`SELECT r.rol_adi, r.kademe, r.rol_sahibi_birim birim FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [i.oturum!.kullanici])).rows;
    if (!l.some((r) => GORUR.includes(r.rol_adi))) return yok(y);
    return kapasiteAnalizi(b.db, firmaAdiGorur(l));
  });
}
