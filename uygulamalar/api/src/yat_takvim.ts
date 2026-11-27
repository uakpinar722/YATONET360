import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { UUID } from './yat.js';
import { izinGerekli } from './yetki.js';
import type { Baglam } from './kimlik.js';

const TURLER = ['Kullanım', 'Kiralama', 'Kışlama', 'Onarım Penceresi', 'Yat Erişilemez'];
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/**
 * YG-106: Yat Kullanım Takvimi (12 ay). Sistem satırları: dosyalardaki iş emri dönemleri, teslim tarihleri, Türkiye'de kalış ve geçici ithalat bitişi, kışlama yeri.
 * Elle girilen dönemler: Kullanım, Kiralama, Kışlama, Onarım Penceresi, Yat Erişilemez. İş emrinin hedef bitişi Kullanım veya Kiralama dönemine taşarsa uyarı.
 */
export function yatTakvimYollari(s: FastifyInstance, b: Baglam) {
  const yetkili = { preHandler: izinGerekli(b, 'ihbar.kaydet') };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  s.get('/yat/:id/kullanim-takvimi', yetkili, async (i, y) => {
    const { id } = i.params as { id: string };
    const yat = UUID.test(id) ? (await b.db.query(`SELECT yat_adi, kislama_yeri, turkiye_kalis_bitis::text kalis, gecici_ithalat_bitis::text ithalat FROM yat WHERE kimlik = $1`, [id])).rows[0] : undefined;
    if (!yat) return yok(y);
    const donemler = (await b.db.query(`SELECT k.kimlik, k.tur, k.baslangic::text, k.bitis::text, k.konum, k.aciklama, h.ad_soyad giren FROM yat_kullanim_donemi k JOIN kullanici_hesabi h ON h.kimlik = k.giren_ref
      WHERE k.yat_ref = $1 AND k.bitis >= current_date - 365 ORDER BY k.baslangic`, [id])).rows;
    const isler = (await b.db.query(`SELECT d.dosya_no, e.is_emri_no, e.statu, e.baslangic_tarihi::text baslangic, e.hedef_bitis_tarihi::text bitis FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref
      WHERE d.yat_ref = $1 AND e.statu NOT IN ('Taslak', 'İptal', 'Yerine Geçti') AND e.hedef_bitis_tarihi IS NOT NULL AND e.hedef_bitis_tarihi >= current_date - 365
        AND NOT EXISTS (SELECT 1 FROM is_emri n WHERE n.is_emri_no = e.is_emri_no AND n.surum > e.surum) ORDER BY e.hedef_bitis_tarihi`, [id])).rows;
    const teslimler = (await b.db.query(`SELECT d.dosya_no, t.teslim_zamani::date::text tarih FROM teslim_kaydi t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE d.yat_ref = $1 AND t.teslim_zamani IS NOT NULL ORDER BY t.teslim_zamani DESC LIMIT 10`, [id]).catch(() => ({ rows: [] }))).rows;
    const uyarilar: string[] = [];
    for (const e of isler) for (const k of donemler.filter((x) => x.tur === 'Kullanım' || x.tur === 'Kiralama'))
      if (e.bitis >= k.baslangic && (e.baslangic ?? e.bitis) <= k.bitis) uyarilar.push(`${e.is_emri_no} hedef bitişi (${e.bitis.split('-').reverse().join('.')}) ${k.tur.toLocaleLowerCase('tr-TR')} dönemiyle (${k.baslangic.split('-').reverse().join('.')}–${k.bitis.split('-').reverse().join('.')}) çakışıyor.`);
    const sistem = [
      ...isler.map((e) => ({ tur: 'İş Dönemi', baslangic: e.baslangic, bitis: e.bitis, aciklama: `${e.dosya_no} · ${e.is_emri_no} · ${e.statu}` })),
      ...teslimler.map((t) => ({ tur: 'Teslim', baslangic: t.tarih, bitis: t.tarih, aciklama: t.dosya_no })),
      ...(yat.kalis ? [{ tur: 'Türkiye’de Kalış Bitişi', baslangic: yat.kalis, bitis: yat.kalis, aciklama: null }] : []),
      ...(yat.ithalat ? [{ tur: 'Geçici İthalat Bitişi', baslangic: yat.ithalat, bitis: yat.ithalat, aciklama: null }] : []),
    ];
    return { yat: yat.yat_adi, kislamaYeri: yat.kislama_yeri, donemler, sistem, uyarilar, turler: TURLER };
  });

  s.post('/yat/:id/kullanim-donemi', yetkili, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; baslangic?: string; bitis?: string; konum?: string; aciklama?: string };
    if (!UUID.test(id) || !(await b.db.query(`SELECT 1 FROM yat WHERE kimlik = $1`, [id])).rowCount) return yok(y);
    if (!TURLER.includes(g.tur ?? '') || !TARIH.test(g.baslangic ?? '') || !TARIH.test(g.bitis ?? '')) return y.code(400).send({ hata: 'Dönem türünü, başlangıç ve bitiş tarihini giriniz.' });
    if (g.bitis! < g.baslangic!) return y.code(400).send({ hata: 'Bitiş tarihini başlangıç tarihinden sonra girmenizi rica ederiz.' });
    const r = (await b.db.query(`INSERT INTO yat_kullanim_donemi (yat_ref, tur, baslangic, bitis, konum, aciklama, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [id, g.tur, g.baslangic, g.bitis, g.konum?.trim() || null, g.aciklama?.trim() || null, o.kullanici])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yat Kullanım Dönemi', nesneTuru: 'Yat', nesneKimligi: id, yeni: { tur: g.tur, baslangic: g.baslangic, bitis: g.bitis }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });
}
