import type { FastifyInstance, FastifyReply } from 'fastify';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { isDurduBildir } from './saha_kayit.js';
import { UUID } from './yat.js';

export const PROSES: Record<string, string> = { 'Kompozit Laminasyon ve Kür': 'FR-ONR-005', 'Yapıştırma, Sızdırmazlık ve Dolgu': 'FR-ONR-006' };
const TU = ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)']; const KART = 'Proses Sınır Dışı Değer';
const sayi = (x: unknown) => (x === undefined || x === null || x === '' ? null : Number(x));

/** FR-ONR-010: sınırın dışında kalan ölçümleri döndürür. */
export function sinirDisi(s: { sicaklik_min: unknown; sicaklik_max: unknown; nem_min: unknown; nem_max: unknown }, sicaklik: number, nem: number): string[] {
  const asti = (d: number, a: unknown, u: unknown) => (a !== null && d < Number(a)) || (u !== null && d > Number(u));
  return [...(asti(sicaklik, s.sicaklik_min, s.sicaklik_max) ? ['Sıcaklık'] : []), ...(asti(nem, s.nem_min, s.nem_max) ? ['Nem'] : [])];
}

/** YG-1455, YG-408, YG-282 (PRS-1): firma seans satırını girer; sınır dışı değerde Teknik Uzman devam kararı verir; seansı rol bazlı onaylar. */
export function prosesYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const firmaIsi = async (id: string, k: string) => (UUID.test(id) ? (await b.db.query(`SELECT e.*, d.dosya_no FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref JOIN kurulus_kullanici x ON x.kurulus_ref = e.kurulus_ref WHERE e.kimlik = $1 AND x.kullanici_ref = $2`, [id, k])).rows[0] : undefined);
  const lgmIsi = async (id: string, k: string) => { if (!UUID.test(id)) return undefined; const e = (await b.db.query(`SELECT * FROM is_emri WHERE kimlik = $1`, [id])).rows[0]; return e && await dosyaErisimi(b.db, k, e.dosya_ref) ? e : undefined; };
  const tuMu = async (dosya: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = ANY($3) AND bitis_zamani IS NULL`, [dosya, k, TU])).rowCount);
  const liste = async (e: string) => ({
    sinirlar: (await b.db.query(`SELECT proses_turu, sicaklik_min, sicaklik_max, nem_min, nem_max, dayanak FROM proses_siniri WHERE is_emri_ref = $1 ORDER BY proses_turu`, [e])).rows,
    seanslar: (await b.db.query(`SELECT s.kimlik, k.kayit_no, k.proses_turu, s.seans_no, s.seans_zamani, s.sicaklik, s.nem, s.recine_kg, s.sertlestirici_kg, s.kat_sirasi, s.vakum_degeri, s.vakum_suresi_dk, s.malzeme, s.sorumlu_rol, s.sinir_disi, s.durum, s.karar, s.karar_gerekcesi FROM proses_seansi s JOIN proses_kaydi k ON k.kimlik = s.kayit_ref WHERE k.is_emri_ref = $1 ORDER BY k.proses_turu, s.seans_no`, [e])).rows,
  });
  const seansGetir = async (id: string) => (UUID.test(id) ? (await b.db.query(`SELECT s.*, k.dosya_ref, k.is_emri_ref, k.kayit_no FROM proses_seansi s JOIN proses_kaydi k ON k.kimlik = s.kayit_ref WHERE s.kimlik = $1`, [id])).rows[0] : undefined);

  s.get('/firma-portal/is-emri/:id/proses', oturumlu, async (i, y) => { const e = await firmaIsi((i.params as { id: string }).id, i.oturum!.kullanici); return e ? liste(e.kimlik) : yok(y); });
  s.get('/is-emri/:id/proses', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    const e = await lgmIsi((i.params as { id: string }).id, i.oturum!.kullanici); if (!e) return yok(y);
    return { ...(await liste(e.kimlik)), uygunsuzluklar: (await b.db.query(`SELECT kimlik, uygunsuzluk_no FROM uygunsuzluk WHERE dosya_ref = $1 ORDER BY uygunsuzluk_no`, [e.dosya_ref])).rows, tu: await tuMu(e.dosya_ref, i.oturum!.kullanici) };
  });

  s.post('/is-emri/:id/proses-siniri', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; sicaklikMin?: unknown; sicaklikMax?: unknown; nemMin?: unknown; nemMax?: unknown; dayanak?: string };
    const e = await lgmIsi((i.params as { id: string }).id, o.kullanici); if (!e) return yok(y);
    if (!(await tuMu(e.dosya_ref, o.kullanici))) return y.code(403).send({ hata: 'Proses sınırlarını Teknik Uzman girer.' });
    const v = [sayi(g.sicaklikMin), sayi(g.sicaklikMax), sayi(g.nemMin), sayi(g.nemMax)];
    if (!PROSES[g.tur ?? ''] || !g.dayanak?.trim() || v.every((x) => x === null) || v.some((x) => x !== null && Number.isNaN(x))) return y.code(400).send({ hata: 'Proses türü, en az bir sınır değeri ve dayanak (üretici verisi veya yöntem belgesi) zorunludur.' });
    if ((v[0] !== null && v[1] !== null && v[0]! > v[1]!) || (v[2] !== null && v[3] !== null && v[2]! > v[3]!)) return y.code(400).send({ hata: 'Alt sınır üst sınırdan büyük olamaz.' });
    if ((await b.db.query(`SELECT 1 FROM proses_seansi s JOIN proses_kaydi k ON k.kimlik = s.kayit_ref WHERE k.is_emri_ref = $1 AND k.proses_turu = $2 LIMIT 1`, [e.kimlik, g.tur])).rowCount) return y.code(409).send({ hata: 'Seans girildikten sonra sınırlar değiştirilemez.' });
    await b.db.query(`INSERT INTO proses_siniri (is_emri_ref, proses_turu, sicaklik_min, sicaklik_max, nem_min, nem_max, dayanak, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (is_emri_ref, proses_turu) DO UPDATE SET sicaklik_min = $3, sicaklik_max = $4, nem_min = $5, nem_max = $6, dayanak = $7, giren_ref = $8`, [e.kimlik, g.tur, ...v, g.dayanak.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Proses Sınırı Girildi', nesneTuru: 'İş Emri', nesneKimligi: e.kimlik, yeni: { tur: g.tur, sinirlar: v, dayanak: g.dayanak.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  s.post('/firma-portal/is-emri/:id/proses', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; zaman?: string; sicaklik?: unknown; nem?: unknown; recine?: unknown; sertlestirici?: unknown; katlar?: string; vakum?: unknown; vakumSure?: unknown; malzeme?: string; sorumlu?: string; not?: string };
    const e = await firmaIsi((i.params as { id: string }).id, o.kullanici); if (!e) return yok(y);
    if (e.statu !== 'Aktif') return y.code(409).send({ hata: 'Proses kaydı aktif iş emrine girilir.' });
    const kod = PROSES[g.tur ?? '']; const sic = sayi(g.sicaklik); const nem = sayi(g.nem);
    if (!kod || !g.zaman || Number.isNaN(Date.parse(g.zaman)) || sic === null || Number.isNaN(sic) || nem === null || Number.isNaN(nem) || nem < 0 || nem > 100 || !g.sorumlu?.trim()) return y.code(400).send({ hata: 'Proses türü, seans zamanı, sıcaklık, nem ve sorumlu rolü girmenizi rica ederiz.' });
    const kompozit = kod === 'FR-ONR-005'; const rc = sayi(g.recine); const st = sayi(g.sertlestirici); const vk = sayi(g.vakum); const vs = sayi(g.vakumSure);
    if (kompozit && ([rc, st, vk, vs].some((x) => x === null || Number.isNaN(x)) || !g.katlar?.trim())) return y.code(400).send({ hata: 'Laminasyon seansında reçine ve sertleştirici miktarı, kat sırası, vakum değeri ve süresi zorunludur.' });
    if (!kompozit && !g.malzeme?.trim()) return y.code(400).send({ hata: 'Uygulanan malzeme ve parti numarasını girmenizi rica ederiz.' });
    const sn = (await b.db.query(`SELECT * FROM proses_siniri WHERE is_emri_ref = $1 AND proses_turu = $2`, [e.kimlik, g.tur])).rows[0];
    if (!sn) return y.code(409).send({ hata: 'Bu proses için sınır değerleri henüz girilmemiştir; Teknik Uzmanla iletişime geçmenizi rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM proses_seansi s JOIN proses_kaydi k ON k.kimlik = s.kayit_ref WHERE k.is_emri_ref = $1 AND s.durum = 'Karar Bekliyor' LIMIT 1`, [e.kimlik])).rowCount) return y.code(409).send({ hata: 'Sınır dışı seans için Teknik Uzmanın kararı beklenmektedir.' });
    const disi = sinirDisi(sn, sic, nem);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT 1 FROM is_emri WHERE kimlik = $1 FOR UPDATE`, [e.kimlik]);
      let kayit = (await c.query(`SELECT kimlik, kayit_no FROM proses_kaydi WHERE is_emri_ref = $1 AND proses_turu = $2`, [e.kimlik, g.tur])).rows[0];
      if (!kayit) { const nn = String(Number((await c.query(`SELECT count(*) n FROM proses_kaydi WHERE dosya_ref = $1 AND proses_turu = $2`, [e.dosya_ref, g.tur])).rows[0].n) + 1).padStart(2, '0'); kayit = (await c.query(`INSERT INTO proses_kaydi (kayit_no, dosya_ref, is_emri_ref, proses_turu) VALUES ($1,$2,$3,$4) RETURNING kimlik, kayit_no`, [`${e.dosya_no}-${kod}-${nn}`, e.dosya_ref, e.kimlik, g.tur])).rows[0]; }
      const no = Number((await c.query(`SELECT coalesce(max(seans_no), 0) + 1 n FROM proses_seansi WHERE kayit_ref = $1`, [kayit.kimlik])).rows[0].n);
      const r = (await c.query(`INSERT INTO proses_seansi (kayit_ref, seans_no, seans_zamani, sicaklik, nem, recine_kg, sertlestirici_kg, kat_sirasi, vakum_degeri, vakum_suresi_dk, malzeme, sorumlu_rol, notlar, sinir_disi, durum, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING kimlik`,
        [kayit.kimlik, no, g.zaman, sic, nem, kompozit ? rc : null, kompozit ? st : null, kompozit ? g.katlar!.trim() : null, kompozit ? vk : null, kompozit ? vs : null, g.malzeme?.trim() || null, g.sorumlu.trim(), g.not?.trim() || null, disi, disi.length ? 'Karar Bekliyor' : 'Girildi', o.kullanici])).rows[0];
      if (disi.length) {
        const tu = (await c.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol = ANY($2) AND bitis_zamani IS NULL ORDER BY rol = 'Teknik Uzman' DESC LIMIT 1`, [e.dosya_ref, TU])).rows[0]?.kullanici_ref as string | undefined;
        await kartAc(c, { tur: KART, kategori: 'gorev', baslik: `${e.is_emri_no} · Seans ${no} · ${disi.join(', ')} Sınır Dışı`, ozet: 'Devam veya Durdur kararı veriniz.', oncelik: 'Yüksek', ...(tu ? { sahipKullanici: tu } : { sahipRol: await rolId(c, 'Teknik Müdür') }), nesneTuru: 'Proses Seansı', nesneKimligi: r.kimlik });
        if (tu) await bildir(c, { olay: `proses:${r.kimlik}`, kullanicilar: [tu], baslik: `${e.is_emri_no} · Proses Değeri Sınır Dışı`, oncelik: 'Yüksek' });
      }
      await c.query('COMMIT');
      return { kimlik: r.kimlik, kayitNo: kayit.kayit_no, seansNo: no, sinirDisi: disi };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  s.post('/proses-seansi/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { karar?: string; gerekce?: string };
    const t = await seansGetir((i.params as { id: string }).id); if (!t || !(await dosyaErisimi(b.db, o.kullanici, t.dosya_ref))) return yok(y);
    if (!(await tuMu(t.dosya_ref, o.kullanici))) return y.code(403).send({ hata: 'Sınır dışı değerde kararı Teknik Uzman verir.' });
    if (t.durum !== 'Karar Bekliyor') return y.code(409).send({ hata: 'Bu seans karar beklemiyor.' });
    if (!['Devam', 'Durdur'].includes(g.karar ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Karar ve gerekçe zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE proses_seansi SET durum = 'Girildi', karar = $2, karar_gerekcesi = $3, karar_veren_ref = $4, karar_zamani = now() WHERE kimlik = $1`, [t.kimlik, g.karar, g.gerekce.trim(), o.kullanici]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $2 AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [t.kimlik, KART]);
      if (g.karar === 'Durdur') {
        const e = (await c.query(`SELECT kimlik, is_emri_no, dosya_ref, statu FROM is_emri WHERE kimlik = $1 FOR UPDATE`, [t.is_emri_ref])).rows[0];
        const neden = `Proses sınır dışı (${t.kayit_no}, Seans ${t.seans_no}): ${g.gerekce.trim()}`;
        if (e.statu === 'Aktif') { await c.query(`UPDATE is_emri SET statu = 'Durduruldu', durdurma_nedeni = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [e.kimlik, neden]); await isDurduBildir(c, e, neden, false); }
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Proses Sınır Dışı Kararı', nesneTuru: 'Proses Seansı', nesneKimligi: t.kimlik, yeni: { karar: g.karar }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    return { karar: g.karar };
  });

  // YG-282, YG-408: Uygun → onaylayan ve zaman; Uygun Değil → uygunsuzluk bağı zorunlu. Islak imza yerine rol bazlı onay.
  s.post('/proses-seansi/:id/sonuc', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { sonuc?: string; uygunsuzluk?: string };
    const t = await seansGetir((i.params as { id: string }).id); if (!t || !(await dosyaErisimi(b.db, o.kullanici, t.dosya_ref))) return yok(y);
    if (!(await tuMu(t.dosya_ref, o.kullanici))) return y.code(403).send({ hata: 'Seansı Teknik Uzman onaylar.' });
    if (t.durum !== 'Girildi') return y.code(409).send({ hata: t.durum === 'Karar Bekliyor' ? 'Önce sınır dışı değer için karar veriniz.' : 'Bu seans sonuçlandırılmıştır.' });
    if (g.sonuc === 'Uygun') await b.db.query(`UPDATE proses_seansi SET durum = 'Onaylı', onaylayan_ref = $2, onay_zamani = now() WHERE kimlik = $1`, [t.kimlik, o.kullanici]);
    else if (g.sonuc === 'Uygun Değil') {
      if (!g.uygunsuzluk || !UUID.test(g.uygunsuzluk) || !(await b.db.query(`SELECT 1 FROM uygunsuzluk WHERE kimlik = $1 AND dosya_ref = $2`, [g.uygunsuzluk, t.dosya_ref])).rowCount) return y.code(400).send({ hata: 'Uygun Değil sonucunda dosyanın uygunsuzluk kaydını seçiniz.' });
      await b.db.query(`UPDATE proses_seansi SET durum = 'Uygun Değil', uygunsuzluk_ref = $2 WHERE kimlik = $1`, [t.kimlik, g.uygunsuzluk]);
    } else return y.code(400).send({ hata: 'Sonucu seçiniz.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Proses Seansı Sonucu', nesneTuru: 'Proses Seansı', nesneKimligi: t.kimlik, yeni: { sonuc: g.sonuc }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: g.sonuc === 'Uygun' ? 'Onaylı' : 'Uygun Değil' };
  });
}
