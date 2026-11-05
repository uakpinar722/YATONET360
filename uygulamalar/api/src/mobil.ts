import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { belgeBagiKaydet } from './belge.js';
import { bildir, mesaiIcinde } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const KONUM_GUN = 365;
/** YG-498: kilit ekranında içerik görünmez; ayrıntı uygulama açılınca okunur. */
export const KILIT_EKRANI_METNI = { tr: 'YATONET 360: Yeni bildiriminiz var.', en: 'YATONET 360: You have a new notification.' };
/** YG-494: çevrimdışı alınabilecek saha kayıtları ve çakışma ölçüsü olan nesne. */
const ESITLEME: { yol: RegExp; nesne: 'is_emri' | 'dosya' | null }[] = [
  { yol: /^\/firma-portal\/is-emri\/([0-9a-f-]{36})\/(gunluk|parca)$/, nesne: 'is_emri' },
  { yol: /^\/is-emri\/([0-9a-f-]{36})\/(sapma|denetim-bulgusu)$/, nesne: 'is_emri' },
  { yol: /^\/dosya\/([0-9a-f-]{36})\/(uygunsuzluk|gecici-onarim|kaldirma-tasima)$/, nesne: 'dosya' },
];

export const cihazIptal = (db: Db, kullanici: string, neden: string) => db.query(`UPDATE mobil_cihaz SET durum = 'İptal', iptal_nedeni = $2, iptal_zamani = now() WHERE kullanici_ref = $1 AND durum = 'Aktif'`, [kullanici, neden]);
export const oturumCihazIptal = (db: Db, oturum: string) => db.query(`UPDATE mobil_cihaz SET durum = 'İptal', iptal_nedeni = 'Oturum Kapanışı', iptal_zamani = now() WHERE oturum_ref = $1 AND durum = 'Aktif'`, [oturum]);
/** YG-500: saha konumu 1 yıl saklanır. */
export const konumTemizle = async (db: Db) => (await db.query(`DELETE FROM saha_konum_kaydi WHERE zaman < now() - make_interval(days => $1)`, [KONUM_GUN])).rowCount ?? 0;

/** YG-484: iletideki ret bağlantısı. */
export const retImzasi = (anahtar: string, kisi: string, kanal: string) => createHmac('sha256', anahtar).update(`ret:${kisi}:${kanal}`).digest('hex').slice(0, 32);
export const retBaglantisi = (web: string, anahtar: string, kisi: string, kanal: string) => `${web}/api/iletisim/ret?k=${encodeURIComponent(kisi)}&m=${encodeURIComponent(kanal)}&i=${retImzasi(anahtar, kisi, kanal)}`;
const pazarlamaGeriAl = (db: Db, kisi: string, kanal: string, nereden: string) => db.query(`UPDATE acik_riza SET durum = 'Geri Alındı', geri_alma_zamani = now(), geri_alma_kanali = $3, gonderim_engeli = true WHERE ilgili_kisi_ref = $1 AND kanal = $2 AND durum = 'Verildi'`, [kisi, kanal, nereden]);

// YG-1561: yat sahibi adına işlem yapan kullanıcı belgesini kendi kaydına yükler.
belgeBagiKaydet('Yat Yetkilisi', async (db, k, id) => { if (!(await db.query(`SELECT 1 FROM yat_yetkilisi_kaydi WHERE kullanici_ref = $1`, [id])).rowCount) return 'yok'; return k === id ? 'tamam' : 'yetkisiz'; });
// Ayrılış: istifa dilekçesini İnsan Kaynakları ekler.
belgeBagiKaydet('Personel', async (db, k, id) => { if (!(await db.query(`SELECT 1 FROM personel_karti WHERE kullanici_ref = $1`, [id])).rowCount) return 'yok'; return (await db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi IN ('İnsan Kaynakları Müdürü', 'İnsan Kaynakları Sorumlusu') LIMIT 1`, [k])).rowCount ? 'tamam' : 'yetkisiz'; });

export function mobilYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  // YG-498
  s.post('/mobil/cihaz', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { platform?: string; belirtec?: string };
    if (!['iOS', 'Android'].includes(g.platform ?? '') || !g.belirtec?.trim()) return y.code(400).send({ hata: 'Platform ve bildirim belirteci zorunludur.' });
    // Devredilen cihazda eski alıcının mesajı görünmez: aynı belirteç yeni kullanıcıya geçer.
    const r = await b.db.query(`INSERT INTO mobil_cihaz (kullanici_ref, oturum_ref, platform, bildirim_belirteci) VALUES ($1,$2,$3,$4) ON CONFLICT (bildirim_belirteci) DO UPDATE SET kullanici_ref = EXCLUDED.kullanici_ref, oturum_ref = EXCLUDED.oturum_ref, durum = 'Aktif', iptal_nedeni = NULL, iptal_zamani = NULL, son_dogrulama = now() RETURNING kimlik`, [o.kullanici, o.oturum, g.platform, g.belirtec.trim()]);
    return { kimlik: r.rows[0].kimlik };
  });
  s.get('/mobil/cihazlarim', oturumlu, async (i) => (await b.db.query(`SELECT kimlik, platform, durum, olusturma_zamani FROM mobil_cihaz WHERE kullanici_ref = $1 ORDER BY olusturma_zamani DESC`, [i.oturum!.kullanici])).rows);
  s.post('/mobil/cihaz/:id/kayip', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const r = await b.db.query(`UPDATE mobil_cihaz SET durum = 'Kayıp', iptal_nedeni = 'Cihaz Kaybı', iptal_zamani = now() WHERE kimlik = $1 AND kullanici_ref = $2 AND durum <> 'Kayıp' RETURNING kimlik`, [id, o.kullanici]);
    if (!r.rowCount) return yok(y);
    await b.db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL AND kimlik <> $2`, [o.kullanici, o.oturum]);
    const ol = await (await import('./kvkk.js')).ihlalAc(b.db, { ozet: 'Mobil cihaz kaybı veya çalınması', olayTuru: 'Cihaz kaybı veya çalınması', farkEden: o.kullanici });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Cihaz Kaybı', nesneTuru: 'Mobil Cihaz', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { olay: ol.kimlik };
  });

  // YG-494: kuyruktaki kayıt asıl yolundan aynı oturumla işlenir; tekrar gönderim yinelenmez; nesne değiştiyse sunucu kaydı esas alınır.
  s.post('/mobil/esitle', oturumlu, async (i, y) => {
    const o = i.oturum!; const l = ((i.body ?? {}) as { kayitlar?: { kimlik?: string; yol?: string; govde?: unknown; temelZaman?: string }[] }).kayitlar;
    if (!Array.isArray(l) || !l.length || l.length > 50) return y.code(400).send({ hata: 'En çok 50 kayıt gönderilir.' });
    const sonuc: { kimlik: string; durum: string; yanitKodu?: number; hata?: string; sunucuZamani?: string }[] = [];
    for (const k of l) {
      if (!k.kimlik || !UUID.test(k.kimlik) || !k.yol) return y.code(400).send({ hata: 'Kayıt kimliği ve yolu zorunludur.' });
      const once = (await b.db.query(`SELECT durum, yanit_kodu, yanit, kullanici_ref FROM mobil_esitleme WHERE istemci_kimlik = $1`, [k.kimlik])).rows[0];
      if (once) { if (once.kullanici_ref !== o.kullanici) return yok(y); sonuc.push({ kimlik: k.kimlik, durum: once.durum, yanitKodu: once.yanit_kodu, hata: once.durum === 'Uygulandı' ? undefined : once.yanit }); continue; }
      const t = ESITLEME.find((x) => x.yol.test(k.yol!));
      if (!t) return y.code(400).send({ hata: 'Bu kayıt türü çevrimdışı alınamaz.' });
      const nid = t.yol.exec(k.yol)![1];
      let zaman: Date | null = null;
      if (t.nesne) zaman = (await b.db.query(`SELECT guncelleme_zamani z FROM ${t.nesne === 'is_emri' ? 'is_emri' : 'dosya'} WHERE kimlik = $1`, [nid])).rows[0]?.z ?? null;
      if (zaman && k.temelZaman && zaman > new Date(k.temelZaman)) {
        const h = 'Bu kayıt siz çevrimdışıyken değişti; sunucudaki kayıt esas alındı, kaydınız üzerine yazılmadı.';
        await b.db.query(`INSERT INTO mobil_esitleme (istemci_kimlik, kullanici_ref, yol, govde, temel_zaman, durum, yanit) VALUES ($1,$2,$3,$4,$5,'Çakışma',$6)`, [k.kimlik, o.kullanici, k.yol, JSON.stringify(k.govde ?? {}), k.temelZaman, h]);
        sonuc.push({ kimlik: k.kimlik, durum: 'Çakışma', hata: h, sunucuZamani: zaman.toISOString() }); continue;
      }
      const r = await s.inject({ method: 'POST', url: `/api${k.yol}`, headers: { cookie: i.headers.cookie ?? '', 'content-type': 'application/json', 'x-yatonet': '1', 'x-forwarded-for': i.ip }, payload: JSON.stringify(k.govde ?? {}) });
      const tamam = r.statusCode < 300; const hata = tamam ? null : (() => { try { return JSON.parse(r.body).hata as string; } catch { return 'İşlenemedi.'; } })();
      await b.db.query(`INSERT INTO mobil_esitleme (istemci_kimlik, kullanici_ref, yol, govde, temel_zaman, durum, yanit_kodu, yanit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [k.kimlik, o.kullanici, k.yol, JSON.stringify(k.govde ?? {}), k.temelZaman ?? null, tamam ? 'Uygulandı' : 'Reddedildi', r.statusCode, hata]);
      sonuc.push({ kimlik: k.kimlik, durum: tamam ? 'Uygulandı' : 'Reddedildi', yanitKodu: r.statusCode, hata: hata ?? undefined });
    }
    return { sonuc };
  });

  // YG-500: izin aydınlatmayla istenir; yalnız iş amaçlı; izin olmadan konum alınmaz.
  s.post('/mobil/izin', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; aydinlatmaGosterildi?: boolean; ver?: boolean };
    if (!['Konum', 'Kamera'].includes(g.tur ?? '')) return y.code(400).send({ hata: 'İzin türü geçersiz.' });
    if (g.ver === false) { await b.db.query(`UPDATE mobil_izin SET geri_alma_zamani = now() WHERE kullanici_ref = $1 AND tur = $2`, [o.kullanici, g.tur]); return { tamam: true }; }
    if (!g.aydinlatmaGosterildi) return y.code(400).send({ hata: 'İzin için aydınlatmanın gösterilmesi gerekir.' });
    await b.db.query(`INSERT INTO mobil_izin (kullanici_ref, tur, metin_surumu) VALUES ($1,$2,'KVKK-07') ON CONFLICT (kullanici_ref, tur) DO UPDATE SET zaman = now(), geri_alma_zamani = NULL`, [o.kullanici, g.tur]);
    return { tamam: true };
  });
  s.post('/mobil/saha-konum', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { dosya?: string; enlem?: number; boylam?: number };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    if (!g.dosya || !UUID.test(g.dosya) || !(await dosyaErisimi(b.db, o.kullanici, g.dosya))) return yok(y);
    if (!(Math.abs(Number(g.enlem)) <= 90) || !(Math.abs(Number(g.boylam)) <= 180)) return y.code(400).send({ hata: 'Konum geçersiz.' });
    if (!(await b.db.query(`SELECT 1 FROM mobil_izin WHERE kullanici_ref = $1 AND tur = 'Konum' AND geri_alma_zamani IS NULL`, [o.kullanici])).rowCount) return y.code(409).send({ hata: 'Konum izni bekleniyor.' });
    if (!mesaiIcinde(new Date())) return y.code(409).send({ hata: 'Konum yalnız mesai saatinde kaydedilir.' }); // YG-1237
    await b.db.query(`INSERT INTO saha_konum_kaydi (kullanici_ref, dosya_ref, enlem, boylam) VALUES ($1,$2,$3,$4)`, [o.kullanici, g.dosya, g.enlem, g.boylam]);
    return { tamam: true };
  });

  // YG-492: hesap kapanır; dosya kayıtları yasal süre korunur. LGM personeli ayrılış akışına tabidir.
  s.post('/hesabim/kapatma-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { onay?: boolean };
    if (o.grup === 'LGM İç Rolü') return y.code(409).send({ hata: 'Personel hesabı ayrılış süreciyle kapanır.' });
    if (!g.onay) return y.code(400).send({ hata: 'Hesabınızın kapatılacağını onaylamanızı rica ederiz.' });
    const ds = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.dosya_sorumlusu_ref FROM dosya_tarafi t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kullanici_ref = $1 AND d.statu NOT IN ('Kapalı') GROUP BY d.kimlik, d.dosya_no, d.dosya_sorumlusu_ref`, [o.kullanici])).rows;
    await b.db.query(`INSERT INTO hesap_kapatma_talebi (kullanici_ref, acik_dosya_sayisi) VALUES ($1,$2)`, [o.kullanici, ds.length]);
    for (const d of ds) if (d.dosya_sorumlusu_ref) await kartAc(b.db, { tur: 'Portal Hesabı Kapatıldı', kategori: 'islem', baslik: `${d.dosya_no} · Müşteri Portal Hesabını Kapattı`, ozet: 'Dosya işlemleri için müşteriyle iletişim yolunu kontrol etmeniz rica olunur.', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
    await cihazIptal(b.db, o.kullanici, 'Hesap Kapatma');
    await b.db.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Kapalı' WHERE kimlik = $1`, [o.kullanici]);
    await b.db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Hesap Kapatma Talebi', nesneTuru: 'Kullanıcı', nesneKimligi: o.kullanici, yeni: { acikDosya: ds.length }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Kapatıldı', acikDosya: ds.length };
  });

  // YG-484: ret bağlantısı oturum istemez; imza kişiye ve kanala özeldir. İYS geri alması aynı işlemi yapar (entegrasyon anahtarıyla).
  s.get('/iletisim/ret', async (i, y) => {
    const { k, m, i: imza } = i.query as { k?: string; m?: string; i?: string };
    const dogru = k && m ? retImzasi(b.anahtar, k, m) : ''; const a = Buffer.from(imza ?? ''); const c = Buffer.from(dogru);
    if (!dogru || a.length !== c.length || !timingSafeEqual(a, c)) return y.code(400).send({ hata: 'Bağlantı geçersiz.' });
    await pazarlamaGeriAl(b.db, k!, m!, 'İleti Ret Bağlantısı');
    return { durum: 'İletişim izniniz geri alındı.' };
  });
  s.post('/iletisim/iys-ret', async (i, y) => {
    const g = (i.body ?? {}) as { kisi?: string; kanal?: string }; const anahtar = process.env.IYS_GIZLI;
    if (!anahtar || i.headers['x-iys-anahtar'] !== anahtar) return y.code(403).send({ hata: 'Yetkisiz.' });
    if (!g.kisi || !g.kanal) return y.code(400).send({ hata: 'Kişi ve kanal zorunludur.' });
    await pazarlamaGeriAl(b.db, g.kisi, g.kanal, 'İYS');
    return { tamam: true };
  });

  // YG-1561, YG-1566: Yetkilerim; onay adımı yok, belge kontrolünü Müşteri ve Paydaş İlişkileri Müdürü yapar.
  s.get('/yetkilerim', oturumlu, async (i) => (await b.db.query(`SELECT rol, sahip_ad, belge_ref, belge_durumu, islem_turleri, ust_limit_eur, bitis_tarihi::text, odeme_yetkisi, bilgi_paylasim_izni FROM yat_yetkilisi_kaydi WHERE kullanici_ref = $1`, [i.oturum!.kullanici])).rows[0] ?? null);
  s.post('/yetkilerim/belge', oturumlu, async (i, y) => {
    const o = i.oturum!; const belge = ((i.body ?? {}) as { belge?: string }).belge;
    if (!belge || !UUID.test(belge) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Yat Yetkilisi' AND bag_kimligi = $2`, [belge, o.kullanici])).rowCount) return y.code(400).send({ hata: 'Yetki belgesini yüklemenizi rica ederiz.' });
    const r = await b.db.query(`UPDATE yat_yetkilisi_kaydi SET belge_ref = $2, belge_durumu = 'Kontrolde' WHERE kullanici_ref = $1 RETURNING sahip_ad`, [o.kullanici, belge]);
    if (!r.rowCount) return yok(y);
    await kartAc(b.db, { tur: 'Yetki Belgesi Kontrolü', kategori: 'islem', baslik: `Yetki Belgesi Kontrolü · ${r.rows[0].sahip_ad}`, sahipRol: await rolId(b.db, 'Müşteri ve Paydaş İlişkileri Müdürü'), nesneTuru: 'Yat Yetkilisi', nesneKimligi: o.kullanici });
    return { durum: 'Kontrolde' };
  });
  s.post('/yat-yetkilisi/:id/dogrula', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { islemler?: string[]; limit?: number; bitis?: string; odeme?: boolean; bilgi?: boolean };
    if (!(await rolSahipleri(b.db, await rolId(b.db, 'Müşteri ve Paydaş İlişkileri Müdürü'))).includes(o.kullanici)) return y.code(403).send({ hata: 'Kontrolü Müşteri ve Paydaş İlişkileri Müdürü yapar.' });
    if (!g.islemler?.length || !g.bitis || g.limit === undefined || !(Number(g.limit) >= 0) || !g.islemler.every((x) => /^ONY-\d{2}$/.test(x))) return y.code(400).send({ hata: 'Belgede yazılı işlem türleri, tek işlem limiti ve bitiş tarihini girmenizi rica ederiz; genel yetki verilmez.' }); // YG-1072
    const r = await b.db.query(`UPDATE yat_yetkilisi_kaydi SET belge_durumu = 'Geçerli', islem_turleri = $2, ust_limit_eur = $3, bitis_tarihi = $4, odeme_yetkisi = $5, bilgi_paylasim_izni = $6, dogrulayan_ref = $7 WHERE kullanici_ref = $1 AND belge_durumu = 'Kontrolde'`, [id, g.islemler, g.limit ?? null, g.bitis, Boolean(g.odeme), Boolean(g.bilgi), o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Kontrol bekleyen belge bulunmamaktadır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Yetki Belgesi Kontrolü' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await bildir(b.db, { olay: `yetki-belgesi:${id}:${Date.now()}`, kullanicilar: [id], baslik: 'Yetki Belgeniz Kaydedildi', ozet: 'Yetkilerinizi Yetkilerim sayfasından görebilirsiniz.' });
    return { tamam: true };
  });
}
