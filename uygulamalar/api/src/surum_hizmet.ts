import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

const BT = ['Bilgi İşlem Müdürü', 'Bilgi İşlem Müdür Yardımcısı', 'Sistem Yöneticisi', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
const ONAY = ['Bilgi İşlem Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
/** YG-1134: bir yayın setinde bulunması gereken bileşenler. */
export const BILESENLER = ['uygulama', 'veritabani', 'yapilandirma', 'rapor', 'entegrasyon', 'sablon', 'altyapi'];
/** YG-1138: her yayın setinde sınanması gereken asgari senaryo türleri; yüksek riskli senaryo varsa kesinti ve tekrar çağrı da aranır. */
export const ASGARI_TUR = ['Mutlu Yol', 'Ret', 'Yetkisiz Kullanıcı', 'Geri Alma'];
const YUKSEK_RISK_TUR = ['Kesinti', 'Tekrar Çağrı'];
const TURLER = ['Mutlu Yol', 'Ret', 'İade', 'İptal', 'Yeniden Açma', 'Yetkisiz Kullanıcı', 'Tekrar Çağrı', 'Kesinti', 'Geri Alma'];
const IZLEME_ALANI = ['İş Akışı', 'Yetki', 'Rapor', 'Bildirim', 'Entegrasyon'];
/** YG-1305: çıkışta tamamlanması gereken maddeler. */
export const CIKIS_MADDELERI = ['Veri Dışa Aktarımı', 'Bütünlük Doğrulaması', 'Geçiş', 'Eski Hesapların Kapatılması', 'Silme Teyidi', 'API Anahtarı', 'Sertifika', 'Webhook', 'Ağ Kuralı', 'Hizmet Hesabı', 'Paylaşım Bağlantısı', 'Destek Erişimi'];
/** YG-1002: olay bazlı dış erişimin azami süresi (saat). */
const AZAMI_SAAT = 72;
const dolu = (x?: string) => typeof x === 'string' && x.trim().length > 0;

/** YG-1138, YG-1139: test edildi demek için eksikler; boş dizi uygun demektir. */
export async function testEksikleri(db: Pool, yayin: string): Promise<string[]> {
  const e: string[] = [];
  const s = (await db.query(`SELECT s.kimlik, s.kod, s.tur, s.risk, (SELECT sonuc FROM test_kosusu k WHERE k.senaryo_ref = s.kimlik ORDER BY k.zaman DESC LIMIT 1) son FROM test_senaryosu s WHERE s.yayin_ref = $1`, [yayin])).rows;
  const gerekli = [...ASGARI_TUR, ...(s.some((x) => x.risk === 'Yüksek') ? YUKSEK_RISK_TUR : [])];
  for (const t of gerekli) if (!s.some((x) => x.tur === t)) e.push(`${t} senaryosu yok`);
  for (const x of s) if (x.son !== 'Geçti') e.push(`${x.kod} geçmedi`);
  for (const h of (await db.query(`SELECT h.hata_no FROM test_hatasi h JOIN test_senaryosu s ON s.kimlik = h.senaryo_ref WHERE s.yayin_ref = $1 AND h.durum <> 'Kapalı' AND h.onem IN ('Kritik', 'Yüksek')`, [yayin])).rows) e.push(`${h.hata_no} açık`);
  return e;
}

/** YG-1002: süresi biten dış erişim kendiliğinden kapanır; YG-1305: sözleşme bitişine 30 gün kala çıkış görevi açılır. */
export async function disHizmetIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = (await db.query(`UPDATE dis_erisim_izni SET durum = 'Bitti' WHERE durum = 'Aktif' AND bitis <= $1`, [simdi])).rowCount ?? 0;
  for (const h of (await db.query(`SELECT kimlik, hesap_adi, saglayici, sozlesme_bitis::text bitis FROM hizmet_hesabi WHERE durum = 'Aktif' AND sozlesme_bitis <= $1::date + 30 AND NOT EXISTS (SELECT 1 FROM is_karti WHERE tur = 'Dış Hizmet Çıkışı' AND nesne_kimligi = hizmet_hesabi.kimlik::text)`, [simdi])).rows) {
    await kartAc(db, { tur: 'Dış Hizmet Çıkışı', kategori: 'gorev', baslik: `${h.saglayici} · ${h.hesap_adi} · Sözleşme Bitişi ${h.bitis.split('-').reverse().join('.')}`, ozet: 'Çıkış kontrol listesini başlatınız.', oncelik: 'Yüksek', sahipRol: await rolId(db, 'Bilgi İşlem Müdürü'), nesneTuru: 'Hizmet Hesabı', nesneKimligi: h.kimlik }); n++;
  }
  return n;
}

export function surumHizmetYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, l: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, l])).rowCount);
  const iz = (i: { oturum?: { kullanici: string; oturum: string }; ip: string; id: string }, eylem: string, nesneTuru: string, nesneKimligi: string) => izYaz(b.db, { aktor: i.oturum!.kullanici, oturum: i.oturum!.oturum, eylem, nesneTuru, nesneKimligi, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });

  s.get('/surum-hizmet', oturumlu, async (i, y) => {
    if (!(await rolde(i.oturum!.kullanici, BT))) return yok(y);
    const yayinlar = (await b.db.query(`SELECT y.kimlik, y.surum, y.ortam, y.paket_ozeti, y.bilesenler, y.durum, y.zaman, y.acik_dosya_karari, y.acik_dosya_gerekcesi, (SELECT count(*)::int FROM dosya d WHERE d.akis_surumu = y.surum) dosya_sayisi, (SELECT array_agg(bilet_no) FROM degisiklik_bileti d WHERE d.kimlik = ANY(y.degisiklikler)) degisiklikler, (SELECT array_agg(DISTINCT alan) FROM uretim_izleme u WHERE u.yayin_ref = y.kimlik) izlenen FROM yayin_seti y ORDER BY y.zaman DESC LIMIT 50`)).rows;
    for (const x of yayinlar) x.eksik = x.ortam === 'Test' ? await testEksikleri(b.db, x.kimlik) : IZLEME_ALANI.filter((a) => !(x.izlenen ?? []).includes(a));
    return {
      yayinlar,
      senaryolar: (await b.db.query(`SELECT s.kimlik, s.kod, y.surum, s.tur, s.risk, s.gereksinim, s.beklenen, (SELECT sonuc FROM test_kosusu k WHERE k.senaryo_ref = s.kimlik ORDER BY k.zaman DESC LIMIT 1) son FROM test_senaryosu s JOIN yayin_seti y ON y.kimlik = s.yayin_ref ORDER BY s.zaman DESC LIMIT 200`)).rows,
      hatalar: (await b.db.query(`SELECT h.kimlik, h.hata_no, h.onem, h.tekrar, h.gereksinim, h.hedef_surum, h.durum, k.ad_soyad sorumlu FROM test_hatasi h JOIN kullanici_hesabi k ON k.kimlik = h.sorumlu_ref ORDER BY h.durum = 'Kapalı', h.zaman DESC LIMIT 200`)).rows,
      hesaplar: (await b.db.query(`SELECT h.kimlik, h.hesap_adi, h.saglayici, h.kisi, h.kapsam, h.destek_yontemi, h.alt_saglayicilar, h.sozlesme_bitis::text, h.durum, (SELECT coalesce(sum(extract(epoch FROM o.bitis - o.baslangic) / 60), 0)::int FROM hizmet_seviyesi_olcumu o WHERE o.hesap_ref = h.kimlik AND o.baslangic >= date_trunc('month', now())) etki_dakika, (SELECT coalesce(sum(etkilenen_kullanici), 0)::int FROM hizmet_seviyesi_olcumu o WHERE o.hesap_ref = h.kimlik AND o.baslangic >= date_trunc('month', now())) etki_kullanici, (SELECT maddeler FROM hizmet_cikisi c WHERE c.hesap_ref = h.kimlik) cikis FROM hizmet_hesabi h ORDER BY h.durum = 'Kapalı', h.hesap_adi`)).rows,
      erisimler: (await b.db.query(`SELECT e.kimlik, h.hesap_adi, e.olay_turu, e.gerekce, e.veri, e.baslangic, e.bitis, e.durum FROM dis_erisim_izni e JOIN hizmet_hesabi h ON h.kimlik = e.hesap_ref ORDER BY e.zaman DESC LIMIT 100`)).rows,
      onayci: await rolde(i.oturum!.kullanici, ONAY), cikisMaddeleri: CIKIS_MADDELERI,
    };
  });
  // YG-1134: bir değişiklik biletinin hangi sürümde ve ortamda olduğu.
  s.get('/yayin-seti/izle', oturumlu, async (i, y) => {
    if (!(await rolde(i.oturum!.kullanici, BT))) return yok(y);
    const q = String(((i.query ?? {}) as { bilet?: string }).bilet ?? '');
    return (await b.db.query(`SELECT d.bilet_no, y.surum, y.ortam, y.durum, y.uretim_zamani FROM yayin_seti y JOIN degisiklik_bileti d ON d.kimlik = ANY(y.degisiklikler) WHERE d.bilet_no = $1 ORDER BY y.zaman`, [q])).rows;
  });
  s.post('/yayin-seti', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { surum?: string; ortam?: string; paketOzeti?: string; bilesenler?: Record<string, string>; degisiklikler?: string[]; testEdilen?: string; acikDosyaKarari?: string; acikDosyaGerekcesi?: string };
    if (!(await rolde(o.kullanici, BT))) return yok(y);
    if (!dolu(g.surum) || !['Test', 'Üretim'].includes(g.ortam ?? '') || !/^[0-9a-f]{64}$/.test(g.paketOzeti ?? '')) return y.code(400).send({ hata: 'Sürüm, ortam ve paket özeti (SHA-256) zorunludur.' });
    const eksik = BILESENLER.filter((k) => !dolu(g.bilesenler?.[k])); if (eksik.length) return y.code(400).send({ hata: `Bileşen sürümleri eksik: ${eksik.join(', ')}` });
    const bilet = (g.degisiklikler ?? []).filter((x) => UUID.test(x));
    if (g.ortam === 'Üretim') { // YG-1125: üretim paketi test edilen paketle birebir aynı olmalı.
      const t = g.testEdilen && UUID.test(g.testEdilen) ? (await b.db.query(`SELECT paket_ozeti, bilesenler, durum FROM yayin_seti WHERE kimlik = $1 AND ortam = 'Test'`, [g.testEdilen])).rows[0] : null;
      if (!t || t.durum !== 'Test Edildi') return y.code(409).send({ hata: 'Üretim seti, testi tamamlanmış bir test setine bağlanmalıdır.' });
      if (t.paket_ozeti !== g.paketOzeti || BILESENLER.some((k) => t.bilesenler[k] !== g.bilesenler![k])) return y.code(409).send({ hata: 'Paket özeti veya bileşen sürümleri test edilen paketle eşleşmiyor.' });
      // YG-066: yeni kuralın açık dosyalara uygulanıp uygulanmayacağı yetkili kararla ve gerekçeyle belirlenir.
      if (!['Açık dosyalara da uygulanır', 'Yalnız yeni dosyalara uygulanır'].includes(g.acikDosyaKarari ?? '') || !dolu(g.acikDosyaGerekcesi)) return y.code(400).send({ hata: 'Yeni kuralın açık dosyalara uygulanıp uygulanmayacağı kararı ve gerekçesi zorunludur.' });
    }
    const r = (await b.db.query(`INSERT INTO yayin_seti (surum, ortam, paket_ozeti, bilesenler, degisiklikler, test_edilen_ref, durum, hazirlayan_ref, acik_dosya_karari, acik_dosya_gerekcesi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (surum, ortam) DO NOTHING RETURNING kimlik`, [g.surum!.trim(), g.ortam, g.paketOzeti, Object.fromEntries(BILESENLER.map((k) => [k, (g.bilesenler?.[k] ?? '').trim()])), bilet, g.ortam === 'Üretim' ? g.testEdilen : null, g.ortam === 'Üretim' ? 'Onayda' : 'Hazırlandı', o.kullanici, g.ortam === 'Üretim' ? g.acikDosyaKarari : null, g.ortam === 'Üretim' ? g.acikDosyaGerekcesi!.trim() : null])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Bu sürüm bu ortam için kayıtlıdır.' });
    if (g.ortam === 'Üretim') await kartAc(b.db, { tur: 'Üretime Alma Onayı', kategori: 'gorev', baslik: `${g.surum!.trim()} · Üretime Alma Onayı`, oncelik: 'Yüksek', sahipRol: await rolId(b.db, 'Bilgi İşlem Müdürü'), nesneTuru: 'Yayın Seti', nesneKimligi: r.kimlik });
    await iz(i, 'Yayın Seti Kaydı', 'Yayın Seti', r.kimlik);
    return { kimlik: r.kimlik };
  });
  s.post('/yayin-seti/:id/test-edildi', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(i.oturum!.kullanici, BT))) return yok(y);
    const e = await testEksikleri(b.db, id); if (e.length) return y.code(409).send({ hata: `Test tamamlanmadı: ${e.join('; ')}`, eksik: e });
    if (!(await b.db.query(`UPDATE yayin_seti SET durum = 'Test Edildi' WHERE kimlik = $1 AND ortam = 'Test' AND durum = 'Hazırlandı'`, [id])).rowCount) return y.code(409).send({ hata: 'Bu set test edildi olarak işaretlenemez.' });
    await iz(i, 'Yayın Seti Test Edildi', 'Yayın Seti', id); return { tamam: true };
  });
  // Hazırlayan kendi setini üretime onaylayamaz; onay sonrası izleme görevi açılır (YG-1137).
  s.post('/yayin-seti/:id/uretime-al', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(o.kullanici, ONAY))) return yok(y);
    const r = (await b.db.query(`UPDATE yayin_seti SET durum = 'Üretimde', onaylayan_ref = $2, uretim_zamani = now() WHERE kimlik = $1 AND ortam = 'Üretim' AND durum = 'Onayda' AND hazirlayan_ref <> $2 RETURNING surum`, [id, o.kullanici])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Set onayda değil veya hazırlayan kendi setini onaylayamaz.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Üretime Alma Onayı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await kartAc(b.db, { tur: 'Üretim Sonrası İzleme', kategori: 'gorev', baslik: `${r.surum} · Üretim Sonrası İzleme`, ozet: `${IZLEME_ALANI.join(', ')} sonuçlarını kaydediniz.`, sahipRol: await rolId(b.db, 'Sistem Yöneticisi'), sonZaman: new Date(Date.now() + 2 * 86_400_000), nesneTuru: 'Yayın Seti', nesneKimligi: id });
    await iz(i, 'Üretime Alındı', 'Yayın Seti', id); return { tamam: true };
  });
  s.post('/yayin-seti/:id/geri-al', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { gerekce?: string }; if (!UUID.test(id) || !(await rolde(i.oturum!.kullanici, ONAY))) return yok(y);
    if (!dolu(g.gerekce)) return y.code(400).send({ hata: 'Geri alma gerekçesi zorunludur.' });
    if (!(await b.db.query(`UPDATE yayin_seti SET durum = 'Geri Alındı' WHERE kimlik = $1 AND durum = 'Üretimde'`, [id])).rowCount) return y.code(409).send({ hata: 'Yalnız üretimdeki set geri alınabilir.' });
    await izYaz(b.db, { aktor: i.oturum!.kullanici, oturum: i.oturum!.oturum, eylem: 'Yayın Geri Alındı', nesneTuru: 'Yayın Seti', nesneKimligi: id, sonuc: 'Başarılı', gerekce: g.gerekce, adres: i.ip, iliski: i.id }); return { tamam: true };
  });
  // YG-1137: beklenmeyen sonuç problem kaydı açar ve izlemeye bağlanır.
  s.post('/yayin-seti/:id/izleme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { alan?: string; sonuc?: string; aciklama?: string };
    if (!UUID.test(id) || !(await rolde(o.kullanici, BT))) return yok(y);
    if (!IZLEME_ALANI.includes(g.alan ?? '') || !['Beklendiği Gibi', 'Beklenmeyen'].includes(g.sonuc ?? '') || !dolu(g.aciklama)) return y.code(400).send({ hata: 'Alan, sonuç ve açıklama zorunludur.' });
    const ys = (await b.db.query(`SELECT surum FROM yayin_seti WHERE kimlik = $1 AND durum = 'Üretimde'`, [id])).rows[0]; if (!ys) return y.code(409).send({ hata: 'Yalnız üretimdeki set izlenir.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN'); let p: string | null = null;
      if (g.sonuc === 'Beklenmeyen') {
        const no = `PRB-${new Date().getFullYear()}-${String(await sayac(c, 'problem_kaydi')).padStart(4, '0')}`;
        p = (await c.query(`INSERT INTO problem_kaydi (problem_no, kaynak, baslik, aciklama, sorumlu_ref, hedef_tarih, acan_ref) VALUES ($1,'Üretim Sonrası İzleme',$2,$3,$4,current_date + 7,$4) RETURNING kimlik`, [no, `${ys.surum} · ${g.alan}`, g.aciklama!.trim(), o.kullanici])).rows[0].kimlik;
        await kartAc(c, { tur: 'Problem Kaydı', kategori: 'gorev', baslik: `${no} · ${ys.surum} · ${g.alan}`, sahipKullanici: o.kullanici, sonZaman: new Date(Date.now() + 7 * 86_400_000), nesneTuru: 'Problem', nesneKimligi: p! });
      }
      await c.query(`INSERT INTO uretim_izleme (yayin_ref, alan, sonuc, aciklama, problem_ref, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6)`, [id, g.alan, g.sonuc, g.aciklama!.trim(), p, o.kullanici]);
      if ((await c.query(`SELECT count(DISTINCT alan)::int n FROM uretim_izleme WHERE yayin_ref = $1`, [id])).rows[0].n === IZLEME_ALANI.length) await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Üretim Sonrası İzleme' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      await c.query('COMMIT'); return { problem: p };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  s.post('/test-senaryosu', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as Record<string, string>;
    if (!(await rolde(o.kullanici, BT))) return yok(y);
    if (!UUID.test(g.yayin ?? '') || !TURLER.includes(g.tur ?? '') || !['Yüksek', 'Orta', 'Düşük'].includes(g.risk ?? '') || !['gereksinim', 'onKosul', 'veri', 'rol', 'adimlar', 'beklenen'].every((k) => dolu(g[k]))) return y.code(400).send({ hata: 'Gereksinim, risk, tür, ön koşul, veri, rol, adımlar ve beklenen sonuç zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM yayin_seti WHERE kimlik = $1 AND ortam = 'Test' AND durum = 'Hazırlandı'`, [g.yayin])).rowCount) return y.code(409).send({ hata: 'Senaryo yalnız hazırlanan test setine eklenir.' });
    const kod = `TS-${String(await sayac(b.db, 'test_senaryosu')).padStart(5, '0')}`;
    const r = (await b.db.query(`INSERT INTO test_senaryosu (kod, yayin_ref, gereksinim, risk, tur, on_kosul, veri, rol, adimlar, beklenen, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`, [kod, g.yayin, g.gereksinim!.trim(), g.risk, g.tur, g.onKosul!.trim(), g.veri!.trim(), g.rol!.trim(), g.adimlar!.trim(), g.beklenen!.trim(), o.kullanici])).rows[0].kimlik;
    return { kimlik: r, kod };
  });
  s.post('/test-senaryosu/:id/kosu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; kanit?: string };
    if (!UUID.test(id) || !(await rolde(o.kullanici, BT))) return yok(y);
    if (!['Geçti', 'Kaldı'].includes(g.sonuc ?? '') || !dolu(g.kanit)) return y.code(400).send({ hata: 'Sonuç ve kanıt zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM test_senaryosu WHERE kimlik = $1`, [id])).rowCount) return yok(y);
    const r = (await b.db.query(`INSERT INTO test_kosusu (senaryo_ref, sonuc, kanit, kosan_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [id, g.sonuc, g.kanit!.trim(), o.kullanici])).rows[0].kimlik;
    return { kimlik: r };
  });
  s.post('/test-hatasi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as Record<string, string>;
    if (!(await rolde(o.kullanici, BT))) return yok(y);
    if (!UUID.test(g.senaryo ?? '') || !['Kritik', 'Yüksek', 'Orta', 'Düşük'].includes(g.onem ?? '') || !['Her Seferinde', 'Ara Sıra', 'Bir Kez'].includes(g.tekrar ?? '') || !dolu(g.gereksinim) || !dolu(g.kanit) || !dolu(g.hedefSurum) || !dolu(g.sorumlu)) return y.code(400).send({ hata: 'Önem, tekrar edilebilirlik, gereksinim, kanıt, sorumlu ve hedef sürüm zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü'`, [g.sorumlu])).rowCount || !(await b.db.query(`SELECT 1 FROM test_senaryosu WHERE kimlik = $1`, [g.senaryo])).rowCount) return y.code(400).send({ hata: 'Senaryo veya sorumlu geçersizdir.' });
    const no = `TH-${String(await sayac(b.db, 'test_hatasi')).padStart(5, '0')}`;
    const r = (await b.db.query(`INSERT INTO test_hatasi (hata_no, senaryo_ref, onem, tekrar, gereksinim, kanit, sorumlu_ref, hedef_surum, acan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [no, g.senaryo, g.onem, g.tekrar, g.gereksinim!.trim(), g.kanit!.trim(), g.sorumlu, g.hedefSurum!.trim(), o.kullanici])).rows[0].kimlik;
    await bildir(b.db, { olay: `test-hatasi:${r}`, kullanicilar: [g.sorumlu!], baslik: `${no} · ${g.onem} Test Hatası`, ozet: g.gereksinim!.trim() });
    return { kimlik: r, no };
  });
  s.post('/test-hatasi/:id/duzeltildi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { not?: string };
    if (!UUID.test(id)) return yok(y);
    if (!dolu(g.not)) return y.code(400).send({ hata: 'Düzeltme notu zorunludur.' });
    if (!(await b.db.query(`UPDATE test_hatasi SET durum = 'Düzeltildi', duzeltme_notu = $3, duzeltme_zamani = clock_timestamp() WHERE kimlik = $1 AND sorumlu_ref = $2 AND durum = 'Açık'`, [id, o.kullanici, g.not!.trim()])).rowCount) return y.code(409).send({ hata: 'Yalnız sorumlu, açık hatayı düzeltildi olarak işaretler.' });
    return { tamam: true };
  });
  // YG-1139: geliştirici beyanı yetmez; düzeltmeden sonra başka bir kişinin koştuğu geçen test aranır.
  s.post('/test-hatasi/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolde(o.kullanici, BT))) return yok(y);
    const h = (await b.db.query(`SELECT senaryo_ref, sorumlu_ref, durum, duzeltme_zamani FROM test_hatasi WHERE kimlik = $1`, [id])).rows[0]; if (!h) return yok(y);
    if (h.durum !== 'Düzeltildi') return y.code(409).send({ hata: 'Hata önce düzeltildi olarak işaretlenmelidir.' });
    const k = (await b.db.query(`SELECT kimlik FROM test_kosusu WHERE senaryo_ref = $1 AND sonuc = 'Geçti' AND zaman > $2 AND kosan_ref <> $3 ORDER BY zaman DESC LIMIT 1`, [h.senaryo_ref, h.duzeltme_zamani, h.sorumlu_ref])).rows[0];
    if (!k) return y.code(409).send({ hata: 'Düzeltmeden sonra sorumlu dışındaki bir kişinin koştuğu geçen yeniden test bulunmuyor.' });
    await b.db.query(`UPDATE test_hatasi SET durum = 'Kapalı', kapanis_kosu_ref = $2 WHERE kimlik = $1`, [id, k.kimlik]);
    await iz(i, 'Test Hatası Kapatıldı', 'Test Hatası', id); return { tamam: true };
  });

  s.post('/hizmet-hesabi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { hesapAdi?: string; saglayici?: string; kisi?: string; kapsam?: string[]; cokFaktorlu?: boolean; destekYontemi?: string; altSaglayicilar?: string[]; sozlesmeBitis?: string };
    if (!(await rolde(o.kullanici, BT))) return yok(y);
    if (!dolu(g.hesapAdi) || !dolu(g.saglayici) || !dolu(g.kisi) || !g.kapsam?.filter(dolu).length || !/^\d{4}-\d{2}-\d{2}$/.test(g.sozlesmeBitis ?? '')) return y.code(400).send({ hata: 'Hesap adı, sağlayıcı, isimli kişi, yetki kapsamı ve sözleşme bitişi zorunludur.' });
    if (g.cokFaktorlu !== true) return y.code(400).send({ hata: 'Dış hizmet hesabı çok faktörlü kimlik doğrulama olmadan açılmaz.' });
    if (!['Onaylı Uzak Erişim Aracı', 'LGM Gözetiminde Ekran Paylaşımı', 'Yerinde'].includes(g.destekYontemi ?? '')) return y.code(400).send({ hata: 'Onaylı destek yöntemini seçiniz.' });
    if (g.kapsam.some((k) => /tüm|hepsi|yönetici|admin|\*/i.test(k))) return y.code(400).send({ hata: 'Yetki kapsamı dar tanımlanmalıdır; tüm sistem veya yönetici yetkisi verilmez.' });
    const r = (await b.db.query(`INSERT INTO hizmet_hesabi (hesap_adi, saglayici, kisi, kapsam, cok_faktorlu, destek_yontemi, alt_saglayicilar, sozlesme_bitis, kaydeden_ref) VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8) ON CONFLICT (hesap_adi) DO NOTHING RETURNING kimlik`, [g.hesapAdi!.trim(), g.saglayici!.trim(), g.kisi!.trim(), g.kapsam.filter(dolu).map((x) => x.trim()), g.destekYontemi, (g.altSaglayicilar ?? []).filter(dolu).map((x) => x.trim()), g.sozlesmeBitis, o.kullanici])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Bu hesap adı kullanılmaktadır.' });
    await kartAc(b.db, { tur: 'Hizmet Hesabı Onayı', kategori: 'gorev', baslik: `${g.saglayici!.trim()} · ${g.hesapAdi!.trim()} · Hesap Onayı`, sahipRol: await rolId(b.db, 'Bilgi İşlem Müdürü'), nesneTuru: 'Hizmet Hesabı', nesneKimligi: r.kimlik });
    await iz(i, 'Hizmet Hesabı Kaydı', 'Hizmet Hesabı', r.kimlik); return { kimlik: r.kimlik };
  });
  s.post('/hizmet-hesabi/:id/onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(o.kullanici, ONAY))) return yok(y);
    if (!(await b.db.query(`UPDATE hizmet_hesabi SET durum = 'Aktif', onaylayan_ref = $2 WHERE kimlik = $1 AND durum = 'Onayda' AND kaydeden_ref <> $2`, [id, o.kullanici])).rowCount) return y.code(409).send({ hata: 'Hesap onayda değil veya kaydeden kendi kaydını onaylayamaz.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Hizmet Hesabı Onayı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await iz(i, 'Hizmet Hesabı Onaylandı', 'Hizmet Hesabı', id); return { tamam: true };
  });
  s.post('/hizmet-hesabi/:id/olcum', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { baslangic?: string; bitis?: string; etkilenenIs?: string; kullanici?: number; dosya?: number };
    if (!UUID.test(id) || !(await rolde(o.kullanici, BT))) return yok(y);
    const bs = new Date(g.baslangic ?? ''); const bt = new Date(g.bitis ?? '');
    if (isNaN(+bs) || isNaN(+bt) || bt <= bs || !dolu(g.etkilenenIs) || !Number.isInteger(g.kullanici) || g.kullanici! < 0 || !Number.isInteger(g.dosya) || g.dosya! < 0) return y.code(400).send({ hata: 'Başlangıç, bitiş, etkilenen iş, etkilenen kullanıcı ve dosya sayısı zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM hizmet_hesabi WHERE kimlik = $1`, [id])).rowCount) return yok(y);
    await b.db.query(`INSERT INTO hizmet_seviyesi_olcumu (hesap_ref, baslangic, bitis, etkilenen_is, etkilenen_kullanici, etkilenen_dosya, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, bs, bt, g.etkilenenIs!.trim(), g.kullanici, g.dosya, o.kullanici]);
    return { tamam: true };
  });
  // YG-1002: olay bazlı, süreli erişim; üretim verisi gerekçe ister.
  s.post('/dis-erisim', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { hesap?: string; olayTuru?: string; olay?: string; gerekce?: string; veri?: string; uretimGerekcesi?: string; baslangic?: string; bitis?: string };
    if (!(await rolde(o.kullanici, BT))) return yok(y);
    if (!UUID.test(g.hesap ?? '') || !['Problem', 'Olay', 'Değişiklik'].includes(g.olayTuru ?? '') || !UUID.test(g.olay ?? '') || !dolu(g.gerekce) || !['Test Verisi', 'Maskeli Veri', 'Üretim Verisi'].includes(g.veri ?? '')) return y.code(400).send({ hata: 'Hesap, bağlı olay, gerekçe ve veri türü zorunludur.' });
    if (g.veri === 'Üretim Verisi' && !dolu(g.uretimGerekcesi)) return y.code(400).send({ hata: 'Üretim verisi yalnız zorunluysa ve gerekçesi yazılarak verilir; mümkünse maskeli veya test verisi kullanınız.' });
    const tablo = { Problem: 'problem_kaydi', Olay: 'olay_kaydi', 'Değişiklik': 'degisiklik_bileti' }[g.olayTuru as 'Problem'];
    if (!(await b.db.query(`SELECT 1 FROM ${tablo} WHERE kimlik = $1`, [g.olay])).rowCount) return y.code(400).send({ hata: 'Bağlı olay kaydı bulunamadı.' });
    const bs = new Date(g.baslangic ?? ''); const bt = new Date(g.bitis ?? '');
    if (isNaN(+bs) || isNaN(+bt) || bt <= bs || +bt - +bs > AZAMI_SAAT * 3_600_000) return y.code(400).send({ hata: `Erişim süresi en çok ${AZAMI_SAAT} saattir.` });
    if (!(await b.db.query(`SELECT 1 FROM hizmet_hesabi WHERE kimlik = $1 AND durum = 'Aktif'`, [g.hesap])).rowCount) return y.code(409).send({ hata: 'Hizmet hesabı aktif değildir.' });
    const r = (await b.db.query(`INSERT INTO dis_erisim_izni (hesap_ref, olay_turu, olay_ref, gerekce, veri, uretim_gerekcesi, baslangic, bitis, talep_eden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [g.hesap, g.olayTuru, g.olay, g.gerekce!.trim(), g.veri, g.uretimGerekcesi?.trim() || null, bs, bt, o.kullanici])).rows[0].kimlik;
    await kartAc(b.db, { tur: 'Dış Erişim Onayı', kategori: 'gorev', baslik: `Dış Erişim · ${g.veri}`, ozet: g.gerekce!.trim(), oncelik: 'Yüksek', sahipRol: await rolId(b.db, 'Bilgi İşlem Müdürü'), nesneTuru: 'Dış Erişim', nesneKimligi: r });
    await iz(i, 'Dış Erişim Talebi', 'Dış Erişim', r); return { kimlik: r };
  });
  s.post('/dis-erisim/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { onay?: boolean };
    if (!UUID.test(id) || !(await rolde(o.kullanici, ONAY))) return yok(y);
    if (!(await b.db.query(`UPDATE dis_erisim_izni SET durum = $3, onaylayan_ref = $2 WHERE kimlik = $1 AND durum = 'Onayda' AND talep_eden_ref <> $2 AND bitis > now()`, [id, o.kullanici, g.onay ? 'Aktif' : 'Reddedildi'])).rowCount) return y.code(409).send({ hata: 'Talep onayda değil, süresi geçmiş veya talep eden kendi talebini onaylayamaz.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Dış Erişim Onayı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await iz(i, g.onay ? 'Dış Erişim Onaylandı' : 'Dış Erişim Reddedildi', 'Dış Erişim', id); return { tamam: true };
  });
  s.post('/dis-erisim/:id/kapat', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolde(i.oturum!.kullanici, BT))) return yok(y);
    if (!(await b.db.query(`UPDATE dis_erisim_izni SET durum = 'İptal' WHERE kimlik = $1 AND durum IN ('Onayda', 'Aktif')`, [id])).rowCount) return y.code(409).send({ hata: 'Erişim zaten kapalıdır.' });
    await iz(i, 'Dış Erişim Kapatıldı', 'Dış Erişim', id); return { tamam: true };
  });
  // YG-1305: çıkış kontrol listesi; her madde kanıtla işaretlenir, tamamlanınca hesap ve erişimler kapanır.
  s.post('/hizmet-hesabi/:id/cikis', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { madde?: string; kanit?: string };
    if (!UUID.test(id) || !(await rolde(o.kullanici, BT))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM hizmet_hesabi WHERE kimlik = $1 AND durum IN ('Aktif', 'Çıkışta')`, [id])).rowCount) return y.code(409).send({ hata: 'Hesap aktif değildir.' });
    await b.db.query(`INSERT INTO hizmet_cikisi (hesap_ref, baslatan_ref) VALUES ($1,$2) ON CONFLICT (hesap_ref) DO NOTHING`, [id, o.kullanici]);
    await b.db.query(`UPDATE hizmet_hesabi SET durum = 'Çıkışta' WHERE kimlik = $1`, [id]);
    if (g.madde !== undefined) {
      if (!CIKIS_MADDELERI.includes(g.madde) || !dolu(g.kanit)) return y.code(400).send({ hata: 'Madde ve kanıt zorunludur.' });
      await b.db.query(`UPDATE hizmet_cikisi SET maddeler = maddeler || jsonb_build_object($2::text, jsonb_build_object('kanit', $3::text, 'yapan', $4::text, 'zaman', now())) WHERE hesap_ref = $1 AND durum = 'Açık'`, [id, g.madde, g.kanit!.trim(), o.kullanici]);
    }
    const m = (await b.db.query(`SELECT maddeler FROM hizmet_cikisi WHERE hesap_ref = $1`, [id])).rows[0].maddeler as Record<string, unknown>;
    const eksik = CIKIS_MADDELERI.filter((x) => !m[x]);
    if (!eksik.length) {
      await b.db.query(`UPDATE hizmet_cikisi SET durum = 'Tamamlandı', tamamlayan_ref = $2, kapanis_zamani = now() WHERE hesap_ref = $1 AND durum = 'Açık'`, [id, o.kullanici]);
      await b.db.query(`UPDATE hizmet_hesabi SET durum = 'Kapalı' WHERE kimlik = $1`, [id]);
      await b.db.query(`UPDATE dis_erisim_izni SET durum = 'İptal' WHERE hesap_ref = $1 AND durum IN ('Onayda', 'Aktif')`, [id]);
      await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Dış Hizmet Çıkışı' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      await iz(i, 'Dış Hizmet Çıkışı Tamamlandı', 'Hizmet Hesabı', id);
    }
    return { eksik };
  });
}
