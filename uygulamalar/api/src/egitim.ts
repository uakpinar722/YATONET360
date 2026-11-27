import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;

/**
 * YG-1398, YG-1399, YG-940: eğitim ortamı canlıdan ayrı bir veritabanında aynı kodla çalışır (YATONET_ORTAM=egitim).
 * Bu ortamda gerçek kişilere SMS, e-posta, WhatsApp, sigorta e-postası veya ödeme teknik olarak üretilmez; ekranlarda kalıcı EĞİTİM işareti görünür.
 */
export const egitimOrtami = (): boolean => process.env.YATONET_ORTAM === 'egitim';
const uretim = (): boolean => process.env.YATONET_ORTAM === 'uretim';

/** Eğitim ortamında başarı kaydının yazılacağı canlı veritabanı bağlantısı (yalnız egitim_basarisi tablosuna yazılır). */
let canliDb: Pool | null = null;
export const egitimCanliBagla = (p: Pool | null) => { canliDb = p; };

type Secenek = { metin: string; dogru?: boolean; durdurur?: string };
type Adim = { rol: string; durum: string; soru: string; puan: number; secenekler: Secenek[]; aciklama: string };
type Senaryo = { kod: string; ad: string; ozet: string; sure_dk: number; gecme_orani: string; dosya: Record<string, string>; adimlar: Adim[] };

const adimGoster = (s: Senaryo, n: number) => { const a = s.adimlar[n]; return a ? { no: n + 1, toplam: s.adimlar.length, rol: a.rol, durum: a.durum, soru: a.soru, puan: a.puan, secenekler: a.secenekler.map((x) => x.metin) } : null; };

/** YG-1399, V-1109: yeni personel ilk gerçek dosyasından önce bu sayıda farklı senaryoyu başarıyla tamamlamış olmalıdır. Kapı yalnız parametrenin geçerlilik tarihinden sonra işe girenlere uygulanır. */
export async function egitimKapisi(db: Db, kullanici: string): Promise<string | null> {
  const p = (await db.query(`SELECT deger, gecerlilik FROM sistem_parametresi WHERE kod = 'egitim_kapisi_senaryo'`)).rows[0];
  if (!p || Number(p.deger) <= 0) return null;
  const k = (await db.query(`SELECT h.e_posta eposta FROM personel_karti k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.kullanici_ref = $1 AND k.ise_giris_tarihi >= $2 AND k.personel_durumu <> 'Ayrıldı'`, [kullanici, p.gecerlilik])).rows[0];
  if (!k) return null;
  if ((await db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE kullanici_ref = $1 LIMIT 1`, [kullanici])).rowCount) return null; // yalnız ilk gerçek dosya
  const n = Number((await db.query(`SELECT count(DISTINCT senaryo_kod) n FROM egitim_basarisi WHERE lower(eposta) = lower($1)`, [k.eposta])).rows[0].n);
  return n >= Number(p.deger) ? null : `Kişi ilk gerçek dosyasından önce ${Number(p.deger)} eğitim senaryosunu başarıyla tamamlamalıdır (tamamlanan: ${n}).`;
}

export function egitimYollari(s: FastifyInstance, b: Baglam) {
  // Oturum gerektirmez: giriş ekranı da EĞİTİM işaretini gösterir.
  s.get('/ortam', async () => ({ ortam: egitimOrtami() ? 'egitim' : uretim() ? 'uretim' : 'gelistirme' }));

  // Senaryolar canlı (üretim) ortamda oynanmaz; yalnız iç kullanıcılar içindir (YG-1398).
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const izinli = (g: string) => !uretim() && g === 'LGM İç Rolü';
  const senaryo = async (kod: string) => (await b.db.query(`SELECT kod, ad, ozet, sure_dk, gecme_orani::text, dosya, adimlar FROM egitim_senaryosu WHERE kod = $1 AND aktif`, [kod])).rows[0] as Senaryo | undefined;
  const eposta = async (k: string) => (await b.db.query(`SELECT e_posta eposta FROM kullanici_hesabi WHERE kimlik = $1`, [k])).rows[0]?.eposta as string;

  s.get('/egitim/senaryolar', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!izinli(o.grup)) return y.code(404).send({ hata: 'Bulunamadı.' });
    const l = (await b.db.query(`SELECT s.kod, s.ad, s.ozet, s.sure_dk, jsonb_array_length(s.adimlar) adim,
        (SELECT max(d.puan * 100 / d.azami) FROM egitim_denemesi d WHERE d.senaryo_kod = s.kod AND d.kullanici_ref = $1 AND d.durum IN ('Geçti', 'Kaldı')) en_iyi,
        EXISTS (SELECT 1 FROM egitim_denemesi d WHERE d.senaryo_kod = s.kod AND d.kullanici_ref = $1 AND d.durum = 'Geçti') basarili,
        (SELECT d.kimlik FROM egitim_denemesi d WHERE d.senaryo_kod = s.kod AND d.kullanici_ref = $1 AND d.durum = 'Sürüyor') suren
      FROM egitim_senaryosu s WHERE s.aktif ORDER BY s.sira`, [o.kullanici])).rows;
    const kapi = Number((await b.db.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'egitim_kapisi_senaryo'`)).rows[0]?.deger ?? 0);
    return { ortam: egitimOrtami() ? 'egitim' : 'gelistirme', kapi, basarili: l.filter((x) => x.basarili).length, senaryolar: l };
  });

  // Başlat: süren deneme varsa kaldığı adımdan döner; sıfırla ile baştan başlanır (YG-1399).
  s.post('/egitim/senaryo/:kod/basla', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!izinli(o.grup)) return y.code(404).send({ hata: 'Bulunamadı.' });
    const sn = await senaryo((i.params as { kod: string }).kod); if (!sn) return y.code(404).send({ hata: 'Bulunamadı.' });
    let d = (await b.db.query(`SELECT kimlik, adim, puan, durdurma, baslangic FROM egitim_denemesi WHERE kullanici_ref = $1 AND senaryo_kod = $2 AND durum = 'Sürüyor'`, [o.kullanici, sn.kod])).rows[0];
    if (!d) d = (await b.db.query(`INSERT INTO egitim_denemesi (kullanici_ref, senaryo_kod, azami) VALUES ($1,$2,$3) RETURNING kimlik, adim, puan, durdurma, baslangic`, [o.kullanici, sn.kod, sn.adimlar.reduce((t, a) => t + a.puan, 0)])).rows[0];
    return { deneme: d.kimlik, ad: sn.ad, dosya: sn.dosya, sureDk: sn.sure_dk, baslangic: d.baslangic, puan: d.puan, durdurma: d.durdurma, adim: adimGoster(sn, d.adim) };
  });

  // Cevap: doğru seçenek puan kazandırır; engellenmesi gereken işlemde sistem kullanıcıyı durdurur ve durdurma sayılır.
  s.post('/egitim/deneme/:id/cevap', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!izinli(o.grup)) return y.code(404).send({ hata: 'Bulunamadı.' });
    const { id } = i.params as { id: string }; const { secim } = (i.body ?? {}) as { secim?: number };
    if (!/^[0-9a-f-]{36}$/.test(id)) return y.code(404).send({ hata: 'Bulunamadı.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`SELECT kimlik, senaryo_kod, adim, puan, azami, durdurma, cevaplar, baslangic FROM egitim_denemesi WHERE kimlik = $1 AND kullanici_ref = $2 AND durum = 'Sürüyor' FOR UPDATE`, [id, o.kullanici])).rows[0];
      if (!d) { await c.query('ROLLBACK'); return y.code(404).send({ hata: 'Bulunamadı.' }); }
      const sn = await senaryo(d.senaryo_kod); const a = sn?.adimlar[d.adim];
      if (!sn || !a) { await c.query('ROLLBACK'); return y.code(404).send({ hata: 'Bulunamadı.' }); }
      if (!Number.isInteger(secim) || secim! < 0 || secim! >= a.secenekler.length) { await c.query('ROLLBACK'); return y.code(400).send({ hata: 'Bir seçenek seçiniz.' }); }
      const sc = a.secenekler[secim!]!; const dogru = Boolean(sc.dogru); const durduruldu = !dogru && Boolean(sc.durdurur);
      const puan = d.puan + (dogru ? a.puan : 0); const durdurma = d.durdurma + (durduruldu ? 1 : 0); const sonraki = d.adim + 1;
      const cevaplar = [...d.cevaplar, { adim: d.adim + 1, secim, dogru, durduruldu }];
      const sureSn = Math.round((Date.now() - new Date(d.baslangic).getTime()) / 1000);
      let sonuc: null | { durum: string; puan: number; azami: number; sureSn: number; sureAsildi: boolean } = null;
      if (sonraki >= sn.adimlar.length) {
        const sureAsildi = sureSn > sn.sure_dk * 60; const basarili = !sureAsildi && puan >= Math.ceil(d.azami * Number(sn.gecme_orani));
        sonuc = { durum: basarili ? 'Geçti' : 'Kaldı', puan, azami: d.azami, sureSn, sureAsildi };
        await c.query(`UPDATE egitim_denemesi SET adim = $2, puan = $3, durdurma = $4, cevaplar = $5, durum = $6, bitis = now() WHERE kimlik = $1`, [id, sonraki, puan, durdurma, JSON.stringify(cevaplar), sonuc.durum]);
        if (basarili) { // Başarı canlı veritabanına (eğitim ortamında) ya da aynı veritabanına yazılır; en iyi puan korunur.
          const hedef = egitimOrtami() && canliDb ? canliDb : c;
          await hedef.query(`INSERT INTO egitim_basarisi (eposta, senaryo_kod, puan, azami, sure_sn) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (eposta, senaryo_kod) DO UPDATE SET puan = greatest(egitim_basarisi.puan, EXCLUDED.puan), zaman = now()`, [await eposta(o.kullanici), sn.kod, puan, d.azami, sureSn]);
        }
        await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Eğitim Senaryosu Tamamlandı', nesneTuru: 'Eğitim Senaryosu', nesneKimligi: sn.kod, yeni: sonuc, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      } else await c.query(`UPDATE egitim_denemesi SET adim = $2, puan = $3, durdurma = $4, cevaplar = $5 WHERE kimlik = $1`, [id, sonraki, puan, durdurma, JSON.stringify(cevaplar)]);
      await c.query('COMMIT');
      return { dogru, durduruldu, sistemMesaji: durduruldu ? sc.durdurur : null, dogruCevap: a.secenekler.find((x) => x.dogru)?.metin ?? null, aciklama: a.aciklama, puan, durdurma, adim: sonuc ? null : adimGoster(sn, sonraki), sonuc };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  // Sıfırla: süren deneme kapanır, senaryo baştan başlar (YG-1399).
  s.post('/egitim/senaryo/:kod/sifirla', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!izinli(o.grup)) return y.code(404).send({ hata: 'Bulunamadı.' });
    const { kod } = i.params as { kod: string };
    await b.db.query(`UPDATE egitim_denemesi SET durum = 'İptal', bitis = now() WHERE kullanici_ref = $1 AND senaryo_kod = $2 AND durum = 'Sürüyor'`, [o.kullanici, kod]);
    return { tamam: true };
  });
}
