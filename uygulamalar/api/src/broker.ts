import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const GRUP = 'Broker, Acente, Yat Brokeri, Kaptan';
/** Yetki durumu: kayıt yoksa Bekleniyor; bitişe 90 gün veya daha az kaldıysa Süresi Doluyor; geçmişse Süresi Doldu. */
const DURUM = `CASE WHEN y.kimlik IS NULL THEN 'Bekleniyor' WHEN y.gecerlilik_bitisi IS NOT NULL AND y.gecerlilik_bitisi < current_date THEN 'Süresi Doldu' WHEN y.gecerlilik_bitisi IS NOT NULL AND y.gecerlilik_bitisi <= current_date + 90 THEN 'Süresi Doluyor' ELSE 'Geçerli' END`;
const SON_YETKI = `LEFT JOIN LATERAL (SELECT * FROM yetki_kaydi k WHERE k.dosya_tarafi_ref = t.kimlik AND k.yetki_durumu IN ('Geçerli', 'Süresi Doldu') ORDER BY k.gecerlilik_bitisi DESC NULLS FIRST LIMIT 1) y ON true`;

/** YG-1573: yetki belgesinin bitişine 90, 45 ve 15 gün kala acente/broker kullanıcısına ve Dosya Sorumlusuna bildirim. */
export async function yetkiSureUyari(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  for (const r of (await db.query(`SELECT y.kimlik, y.gecerlilik_bitisi::text bitis, (y.gecerlilik_bitisi - $1::date) kalan, t.kullanici_ref, d.dosya_no, d.dosya_sorumlusu_ref FROM yetki_kaydi y JOIN dosya_tarafi t ON t.kimlik = y.dosya_tarafi_ref JOIN dosya d ON d.kimlik = y.dosya_ref WHERE t.aktif AND t.kullanici_ref IS NOT NULL AND y.yetki_durumu = 'Geçerli' AND y.gecerlilik_bitisi BETWEEN $1::date AND $1::date + 90 AND d.statu NOT IN ('Kapalı')`, [simdi])).rows) {
    const e = [15, 45, 90].find((x) => r.kalan <= x)!; if (!(await birKez(db, 'yetki-sure', `${r.kimlik}:${e}`))) continue;
    await bildir(db, { olay: `yetki-sure:${r.kimlik}:${e}`, kullanicilar: [r.kullanici_ref, r.dosya_sorumlusu_ref].filter(Boolean), baslik: `${r.dosya_no} · Yetki Belgesinin Süresi ${r.kalan} Gün Sonra Doluyor`, ozet: `Bitiş: ${r.bitis.split('-').reverse().join('.')}`, oncelik: e === 15 ? 'Yüksek' : 'Normal' }, simdi); n++;
  }
  return n;
}

/** YG-1573: acente ve broker ana ekranı (A6); birden çok yat sahibi adına dosya bazında çalışma ve yetki belgeleri. */
export function brokerYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const broker = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = $2 LIMIT 1`, [k, GRUP])).rowCount);
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/broker/ana', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await broker(o.kullanici))) return yok(y);
    const dosyalar = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.statu, x.yat_adi, t.taraf_rolu, (SELECT kisi_adi_soyadi FROM dosya_tarafi s WHERE s.dosya_ref = d.kimlik AND s.taraf_rolu = 'Yat Sahibi' AND s.aktif LIMIT 1) yat_sahibi, ${DURUM} yetki, y.gecerlilik_bitisi::text bitis FROM dosya_tarafi t JOIN dosya d ON d.kimlik = t.dosya_ref JOIN yat x ON x.kimlik = d.yat_ref ${SON_YETKI} WHERE t.kullanici_ref = $1 AND t.aktif ORDER BY d.olusturma_zamani DESC LIMIT 200`, [o.kullanici])).rows;
    return { dosyalar, bekleyen: dosyalar.filter((d) => d.yetki === 'Bekleniyor'), dolan: dosyalar.filter((d) => d.yetki === 'Süresi Doluyor' || d.yetki === 'Süresi Doldu') };
  });
  s.get('/broker/yetki-belgeleri', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await broker(o.kullanici))) return yok(y);
    return (await b.db.query(`SELECT y.kimlik, d.kimlik dosya, d.dosya_no, x.yat_adi, y.yetkili_islemler kapsam, y.parasal_sinir, y.gecerlilik_bitisi::text bitis, y.yetki_durumu, (SELECT durum FROM yetki_yenileme r WHERE r.yetki_ref = y.kimlik ORDER BY r.zaman DESC LIMIT 1) yenileme FROM yetki_kaydi y JOIN dosya_tarafi t ON t.kimlik = y.dosya_tarafi_ref JOIN dosya d ON d.kimlik = y.dosya_ref JOIN yat x ON x.kimlik = d.yat_ref WHERE t.kullanici_ref = $1 ORDER BY y.gecerlilik_bitisi NULLS LAST`, [o.kullanici])).rows;
  });
  // Yenilenmiş belge yüklenir; Dosya Sorumlusu doğrular ve yeni yetki kaydını açar.
  s.post('/broker/yetki/:id/yenile', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string; bitis?: string };
    if (!UUID.test(id) || !(await broker(o.kullanici))) return yok(y);
    const k = (await b.db.query(`SELECT y.dosya_ref, d.dosya_no, d.dosya_sorumlusu_ref FROM yetki_kaydi y JOIN dosya_tarafi t ON t.kimlik = y.dosya_tarafi_ref JOIN dosya d ON d.kimlik = y.dosya_ref WHERE y.kimlik = $1 AND t.kullanici_ref = $2`, [id, o.kullanici])).rows[0]; if (!k) return yok(y);
    if (!g.belge || !UUID.test(g.belge) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2`, [g.belge, k.dosya_ref])).rowCount) return y.code(400).send({ hata: 'Yenilenmiş belgeyi dosyaya yükleyip seçiniz.' });
    if (g.bitis && !/^\d{4}-\d{2}-\d{2}$/.test(g.bitis)) return y.code(400).send({ hata: 'Bitiş tarihini kontrol ediniz.' });
    const r = (await b.db.query(`INSERT INTO yetki_yenileme (yetki_ref, belge_ref, beyan_bitis, yukleyen_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [id, g.belge, g.bitis ?? null, o.kullanici])).rows[0].kimlik;
    if (k.dosya_sorumlusu_ref) await kartAc(b.db, { tur: 'Yetki Belgesi Yenileme Kontrolü', kategori: 'gorev', baslik: `${k.dosya_no} · Yenilenmiş Yetki Belgesi`, ozet: 'Belgeyi doğrulayıp yeni yetki kaydını açınız.', oncelik: 'Yüksek', sahipKullanici: k.dosya_sorumlusu_ref, nesneTuru: 'Yetki Yenileme', nesneKimligi: r });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yetki Belgesi Yenileme', nesneTuru: 'Yetki Kaydı', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
