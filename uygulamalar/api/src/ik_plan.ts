import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const IKM = 'İnsan Kaynakları Müdürü'; const IKS = 'İnsan Kaynakları Sorumlusu'; const ISG = 'İSG Sorumlusu'; // YG-1029: İSG eğitim planı satırları
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** YG-1616: yıllık eğitim planı (İnsan Kaynakları Müdürü) ve personel yan hak kaydı (İnsan Kaynakları; tutar tutulmaz). */
export function ikPlanYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  // Gerçekleşme: hedef rollerdeki görevdeki personelden plan yılında dersi beyanla tamamlayan (ders bağlı) veya aynı adlı eğitim kaydı bulunan (ders bağsız) oran.
  s.get('/ik/egitim-plani', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [IKM, IKS, ISG]))) return yok(y);
    const yil = Number(((i.query ?? {}) as { yil?: string }).yil) || new Date().getFullYear();
    const l = (await b.db.query(`SELECT p.kimlik, p.yil, p.egitim_adi, p.hedef_roller, p.planlanan_ay, p.aciklama, d.ad ders, p.ders_ref,
        (SELECT count(DISTINCT a.kullanici_ref)::int FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND h.hesap_durumu = 'Aktif' AND (cardinality(p.hedef_roller) = 0 OR r.rol_adi = ANY(p.hedef_roller)) AND h.kullanici_grubu = 'LGM İç Rolü') hedef,
        (SELECT count(DISTINCT a.kullanici_ref)::int FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref WHERE a.atama_durumu = 'Aktif' AND h.hesap_durumu = 'Aktif' AND (cardinality(p.hedef_roller) = 0 OR r.rol_adi = ANY(p.hedef_roller)) AND h.kullanici_grubu = 'LGM İç Rolü'
          AND (CASE WHEN p.ders_ref IS NOT NULL THEN EXISTS (SELECT 1 FROM akademi_beyan e WHERE e.ders_ref = p.ders_ref AND e.personel_ref = a.kullanici_ref AND extract(year FROM e.beyan_zamani AT TIME ZONE 'Europe/Istanbul') = p.yil)
               ELSE EXISTS (SELECT 1 FROM egitim_kaydi e WHERE e.personel_ref = a.kullanici_ref AND lower(e.ad) = lower(p.egitim_adi) AND extract(year FROM e.tamamlanma_tarihi) = p.yil) END)) tamamlayan
      FROM egitim_plani p LEFT JOIN akademi_ders d ON d.kimlik = p.ders_ref WHERE p.yil = $1 ORDER BY p.planlanan_ay, p.egitim_adi`, [yil])).rows;
    const dersler = (await b.db.query(`SELECT kimlik, ad, tur FROM akademi_ders WHERE aktif ORDER BY ad`)).rows;
    return { yil, planlar: l.map((x) => ({ ...x, oran: x.hedef ? Math.round((1000 * x.tamamlayan) / x.hedef) / 10 : null })), dersler, duzenler: await rolVar(i.oturum!.kullanici, [IKM, ISG]) };
  });
  s.post('/ik/egitim-plani', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, [IKM, ISG]))) return y.code(403).send({ hata: 'Yıllık eğitim planını İnsan Kaynakları Müdürü hazırlar; İSG eğitimlerini İSG Sorumlusu ekler.' });
    const g = (i.body ?? {}) as { yil?: number; ders?: string; ad?: string; roller?: string[]; ay?: number; aciklama?: string };
    const yil = Number(g.yil); const ay = Number(g.ay);
    if (!Number.isInteger(yil) || yil < 2026 || !Number.isInteger(ay) || ay < 1 || ay > 12) return y.code(400).send({ hata: 'Plan yılını ve planlanan ayı seçiniz.' });
    let ad = g.ad?.trim() ?? '';
    if (g.ders) {
      const d = UUID.test(g.ders) ? (await b.db.query(`SELECT ad FROM akademi_ders WHERE kimlik = $1`, [g.ders])).rows[0] : undefined;
      if (!d) return y.code(400).send({ hata: 'Seçilen ders bulunamadı.' }); ad ||= d.ad;
    }
    if (!ad) return y.code(400).send({ hata: 'Eğitimin adını yazınız veya Akademi dersini seçiniz.' });
    const roller = (g.roller ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (roller.length && Number((await b.db.query(`SELECT count(*) n FROM rol WHERE rol_adi = ANY($1::text[])`, [roller])).rows[0].n) !== new Set(roller).size) return y.code(400).send({ hata: 'Hedef rollerden biri tanımlı değildir.' });
    const r = await b.db.query(`INSERT INTO egitim_plani (yil, ders_ref, egitim_adi, hedef_roller, planlanan_ay, aciklama, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (yil, egitim_adi) DO NOTHING RETURNING kimlik`, [yil, g.ders || null, ad, roller, ay, g.aciklama?.trim() || null, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu eğitim plan yılında kayıtlıdır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yıllık Eğitim Planı Satırı', nesneTuru: 'Eğitim Planı', nesneKimligi: r.rows[0].kimlik, yeni: { yil, ad, ay, roller }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.rows[0].kimlik };
  });

  // YG-1615: Personel ve Akademi; sertifika geçerlilikleri (dolmuş veya 60 gün içinde dolacak, her belgenin son kaydı), zorunlu ders tamamlama ve özel gün rıza durumu (tarih gösterilmez).
  s.get('/ik/personel-akademi', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [IKM, IKS]))) return yok(y);
    const sertifika = (await b.db.query(`SELECT * FROM (SELECT DISTINCT ON (e.personel_ref, lower(e.ad)) h.ad_soyad, e.tur, e.ad, e.gecerlilik_sonu::text bitis, e.gecerlilik_sonu < (now() AT TIME ZONE 'Europe/Istanbul')::date dolmus
        FROM egitim_kaydi e JOIN kullanici_hesabi h ON h.kimlik = e.personel_ref JOIN personel_karti k ON k.kullanici_ref = e.personel_ref WHERE k.personel_durumu <> 'Ayrıldı' AND e.gecerlilik_sonu IS NOT NULL ORDER BY e.personel_ref, lower(e.ad), e.gecerlilik_sonu DESC) x
      WHERE x.bitis::date < (now() AT TIME ZONE 'Europe/Istanbul')::date + 60 ORDER BY x.bitis`)).rows;
    const personel = (await b.db.query(`SELECT h.ad_soyad, k.personel_durumu,
        (SELECT count(*)::int FROM akademi_ders d WHERE d.aktif AND d.tur = 'Zorunlu') zorunlu,
        (SELECT count(*)::int FROM akademi_ders d WHERE d.aktif AND d.tur = 'Zorunlu' AND EXISTS (SELECT 1 FROM akademi_beyan a WHERE a.ders_ref = d.kimlik AND a.surum = d.surum AND a.personel_ref = h.kimlik)) tamamlanan,
        EXISTS (SELECT 1 FROM acik_riza r WHERE r.ilgili_kisi_ref = h.kimlik AND r.riza_turu = 'Özel gün – Doğum günü paylaşımı' AND r.geri_alma_zamani IS NULL) dogum_rizasi,
        EXISTS (SELECT 1 FROM acik_riza r WHERE r.ilgili_kisi_ref = h.kimlik AND r.riza_turu = 'Özel gün – İşe giriş yıl dönümü paylaşımı' AND r.geri_alma_zamani IS NULL) ise_giris_rizasi,
        coalesce((SELECT z.paylasim_rizasi FROM personel_ozel_gun z WHERE z.personel_ref = h.kimlik), false) evlilik_rizasi
      FROM personel_karti k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.personel_durumu <> 'Ayrıldı' ORDER BY h.ad_soyad`)).rows;
    return { sertifika, personel };
  });
  s.get('/ik/yan-hak', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, [IKM, IKS]))) return yok(y);
    return (await b.db.query(`SELECT v.kimlik, v.personel_ref, h.ad_soyad, v.tur, v.aciklama, v.baslangic::text, v.bitis::text FROM personel_yan_hak v JOIN kullanici_hesabi h ON h.kimlik = v.personel_ref ORDER BY h.ad_soyad, v.baslangic DESC LIMIT 500`)).rows;
  });
  s.post('/ik/yan-hak', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, [IKM, IKS]))) return y.code(403).send({ hata: 'Yan hak kaydını İnsan Kaynakları girer.' });
    const g = (i.body ?? {}) as { personel?: string; tur?: string; aciklama?: string; baslangic?: string; bitis?: string };
    if (!g.personel || !g.tur?.trim() || !TARIH.test(g.baslangic ?? '') || (g.bitis && !TARIH.test(g.bitis))) return y.code(400).send({ hata: 'Personeli, yan hak türünü ve başlangıç tarihini giriniz.' });
    if (g.bitis && g.bitis < g.baslangic!) return y.code(400).send({ hata: 'Bitiş tarihini başlangıç tarihinden sonra girmenizi rica ederiz.' });
    if (!(await b.db.query(`SELECT 1 FROM personel_karti WHERE kullanici_ref = $1`, [g.personel])).rowCount) return y.code(400).send({ hata: 'Personel kartı bulunamadı.' });
    const r = (await b.db.query(`INSERT INTO personel_yan_hak (personel_ref, tur, aciklama, baslangic, bitis, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [g.personel, g.tur.trim(), g.aciklama?.trim() || null, g.baslangic, g.bitis || null, o.kullanici])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yan Hak Kaydı', nesneTuru: 'Personel', nesneKimligi: g.personel, yeni: { tur: g.tur.trim(), baslangic: g.baslangic, bitis: g.bitis ?? null }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });
  s.post('/ik/yan-hak/:id/sonlandir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const bitis = String(((i.body ?? {}) as { bitis?: string }).bitis ?? '');
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [IKM, IKS]))) return yok(y);
    if (!TARIH.test(bitis)) return y.code(400).send({ hata: 'Bitiş tarihini giriniz.' });
    const r = await b.db.query(`UPDATE personel_yan_hak SET bitis = $2 WHERE kimlik = $1 AND bitis IS NULL AND baslangic <= $2::date RETURNING personel_ref`, [id, bitis]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Yan hak sonlandırılmış veya bitiş tarihi başlangıçtan öncedir.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yan Hak Sonlandırıldı', nesneTuru: 'Personel', nesneKimligi: r.rows[0].personel_ref, yeni: { bitis }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
