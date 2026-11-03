import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { belgeBagiKaydet } from './belge.js';
import { bildir } from './bildirim.js';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { coz, totpDogrula } from './kripto.js';
import { metinGetir } from './metin.js';
import { altNumara } from './sure.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const TALEP = ['Saha Girişi', 'Çalışma İzni', 'Çekek Randevusu', 'Kalış Uzatma'];
const kurulusum = async (db: Db, k: string) => (await db.query(`SELECT k.kurulus_ref, u.kayit_rolu FROM kurulus_kullanici k JOIN kurulus u ON u.kimlik = k.kurulus_ref WHERE k.kullanici_ref = $1 LIMIT 1`, [k])).rows[0] as { kurulus_ref: string; kayit_rolu: string } | undefined;

// Portal belgesi kullanıcının kendi kuruluşuna bağlanır; LGM kullanıcısı için kayıt sahibi modül erişimi ayrıca denetler.
belgeBagiKaydet('Kuruluş', async (db, k, id) => {
  if (!UUID.test(id)) return 'yok';
  return (await db.query(`SELECT 1 FROM kurulus_kullanici WHERE kullanici_ref = $1 AND kurulus_ref = $2`, [k, id])).rowCount ? 'tamam' : 'yetkisiz';
});

/** YG-554, BLD-24: teslim onayıyla serbest bırakma bildirimi tesise kendiliğinden gider; firma unvanı yazılmaz. */
export async function tesisSerbestBirak(c: PoolClient, dosya: string, teslimAlan: string): Promise<void> {
  const d = (await c.query(`SELECT d.dosya_no, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  const kod = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await c.query(`UPDATE teslim_kaydi SET serbest_birakma_kodu = $2 WHERE dosya_ref = $1 AND durum = 'Teslim Edildi'`, [dosya, kod]);
  const alici = (await c.query(`SELECT DISTINCT u.kullanici_ref FROM tesis_talebi t JOIN kurulus_kullanici u ON u.kurulus_ref = t.kurulus_ref WHERE t.dosya_ref = $1`, [dosya])).rows.map((r) => r.kullanici_ref as string);
  if (!alici.length) return;
  await bildir(c, { olay: `bld24:${dosya}`, kullanicilar: alici, baslik: `${d.yat_adi} · Teslim Onayı`, ozet: await metinGetir(c, 'BLD-24', 'tr', { Yat: d.yat_adi, 'Dosya No': d.dosya_no, 'teslim alan': teslimAlan, kod }), eposta: true, sms: true });
}

export function tesisTedarikciYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const rolBak = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2) LIMIT 1`, [k, r])).rowCount);

  // YG-1447: tesis işlemini Dosya Sorumlusu açar. İlk talepte BLD-23 teslim ve taşıma kısıtı tesise gider.
  s.post('/dosya/:id/tesis-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tesis?: string; tur?: string; hedef?: string; aciklama?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT d.dosya_no, d.dosya_sorumlusu_ref, y.yat_adi, h.cep_telefonu FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = d.dosya_sorumlusu_ref WHERE d.kimlik = $1`, [id])).rows[0];
    if (d.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Tesis işlemini Dosya Sorumlusu açar.' });
    if (!g.tesis || !UUID.test(g.tesis) || !TALEP.includes(g.tur ?? '') || !g.hedef) return y.code(400).send({ hata: 'Tesis, işlem türü ve hedef tarihi seçiniz.' });
    const t = (await b.db.query(`SELECT kayit_rolu FROM kurulus WHERE kimlik = $1`, [g.tesis])).rows[0];
    if (t?.kayit_rolu !== 'Tesis') return y.code(400).send({ hata: 'Seçilen kayıt tesis değildir.' });
    return islem(async (c) => {
      const ilk = !(await c.query(`SELECT 1 FROM tesis_talebi WHERE dosya_ref = $1 AND kurulus_ref = $2 LIMIT 1`, [id, g.tesis])).rowCount;
      const r = (await c.query(`INSERT INTO tesis_talebi (dosya_ref, kurulus_ref, tur, hedef_tarih, aciklama, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [id, g.tesis, g.tur, g.hedef, g.aciklama?.trim() || null, o.kullanici])).rows[0];
      const al = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [g.tesis])).rows.map((x) => x.kullanici_ref as string);
      await bildir(c, { olay: `tesis:${r.kimlik}`, kullanicilar: al, baslik: `${d.yat_adi} · ${g.tur} Talebi`, eposta: true });
      if (ilk) await bildir(c, { olay: `bld23:${id}:${g.tesis}`, kullanicilar: al, baslik: `${d.yat_adi} · Teslim Bilgisi`, ozet: await metinGetir(c, 'BLD-23', 'tr', { Yat: d.yat_adi, 'Dosya No': d.dosya_no, telefon: d.cep_telefonu ?? '' }), eposta: true, sms: true });
      return { kimlik: r.kimlik };
    });
  });
  s.get('/dosya/:id/tesis-talepleri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT t.kimlik, t.tur, t.hedef_tarih::text, t.durum, t.tesis_izin_no, t.red_gerekcesi, k.ticari_unvan FROM tesis_talebi t JOIN kurulus k ON k.kimlik = t.kurulus_ref WHERE t.dosya_ref = $1 ORDER BY t.olusturma_zamani`, [id])).rows;
  });
  s.get('/tesis-listesi', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu sayfa LGM personeline açıktır.' });
    return (await b.db.query(`SELECT kimlik, ticari_unvan FROM kurulus WHERE kayit_rolu = 'Tesis' AND ag_statusu = 'Aktif' ORDER BY ticari_unvan LIMIT 300`)).rows;
  });

  const tesis = async (k: string) => { const f = await kurulusum(b.db, k); return f?.kayit_rolu === 'Tesis' ? f.kurulus_ref : undefined; };
  // YG-297, YG-1575: firma unvanı, müşteri fiyatı, firma maliyeti ve teknik dosya görünmez. Onaylı işler "Onaylı" yazar.
  s.get('/tesis-portal/ana', oturumlu, async (i, y) => {
    const f = await tesis(i.oturum!.kullanici);
    if (!f) return yok(y);
    const q = (t: string) => b.db.query(t, [f]).then((r) => r.rows);
    return {
      kurulus: f,
      bekleyen: await q(`SELECT t.kimlik, t.tur, t.hedef_tarih::text, t.aciklama, y.yat_adi, y.tam_boy_m, y.tur AS yat_turu FROM tesis_talebi t JOIN dosya d ON d.kimlik = t.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE t.kurulus_ref = $1 AND t.durum = 'Yanıt Bekliyor' ORDER BY t.hedef_tarih`),
      takvim: await q(`SELECT t.kimlik, t.tur, t.hedef_tarih::text, t.tesis_izin_no, y.yat_adi FROM tesis_talebi t JOIN dosya d ON d.kimlik = t.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE t.kurulus_ref = $1 AND t.durum = 'Onaylı' ORDER BY t.hedef_tarih`),
      yatlar: await q(`SELECT DISTINCT ON (d.kimlik) d.kimlik AS dosya, y.yat_adi, k.durum AS teslim, k.serbest_birakma_kodu FROM tesis_talebi t JOIN dosya d ON d.kimlik = t.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN teslim_kaydi k ON k.dosya_ref = d.kimlik AND k.durum = 'Teslim Edildi' WHERE t.kurulus_ref = $1 AND d.statu NOT IN ('Kapalı', 'İptal') ORDER BY d.kimlik`),
      kayitlar: await q(`SELECT kimlik, tur, baslik FROM tesis_kaydi WHERE kurulus_ref = $1 ORDER BY olusturma_zamani DESC`),
      faturalar: await q(`SELECT kimlik, fatura_no, tarih::text, kalem, gun, tutar_eur, durum FROM tesis_faturasi WHERE kurulus_ref = $1 ORDER BY olusturma_zamani DESC`),
    };
  });
  s.post('/tesis-portal/talep/:id/yanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await tesis(o.kullanici); const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { izin?: boolean; izinNo?: string; gerekce?: string };
    if (!f || !UUID.test(id)) return yok(y);
    if (g.izin && !g.izinNo?.trim()) return y.code(400).send({ hata: 'Tesis izin numarasını yazmanızı rica ederiz.' });
    if (!g.izin && !g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçeyi yazmanızı rica ederiz.' });
    return islem(async (c) => {
      const r = (await c.query(`UPDATE tesis_talebi SET durum = $3, tesis_izin_no = $4, red_gerekcesi = $5, yanit_veren_ref = $6, yanit_zamani = now() WHERE kimlik = $1 AND kurulus_ref = $2 AND durum = 'Yanıt Bekliyor' RETURNING dosya_ref, tur`, [id, f, g.izin ? 'Onaylı' : 'İzin Verilmedi', g.izinNo?.trim() ?? null, g.gerekce?.trim() ?? null, o.kullanici])).rows[0];
      if (!r) throw Object.assign(new Error('Bu talep yanıtlanmıştır.'), { statusCode: 409 });
      const d = (await c.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [r.dosya_ref])).rows[0];
      await bildir(c, { olay: `tesis-yanit:${id}`, kullanicilar: [d.dosya_sorumlusu_ref], baslik: `${d.dosya_no} · ${r.tur}: ${g.izin ? 'Onaylı' : 'İzin Verilmedi'}` });
      return { durum: g.izin ? 'Onaylı' : 'İzin Verilmedi' };
    });
  });
  // YG-417: Teslim Talebi düğmesi; karar Dosya Sorumlusundadır.
  s.post('/tesis-portal/dosya/:id/teslim-talebi', oturumlu, async (i, y) => {
    const f = await tesis(i.oturum!.kullanici); const { id } = i.params as { id: string };
    if (!f || !UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT d.dosya_no, d.dosya_sorumlusu_ref FROM dosya d WHERE d.kimlik = $1 AND EXISTS (SELECT 1 FROM tesis_talebi t WHERE t.dosya_ref = d.kimlik AND t.kurulus_ref = $2)`, [id, f])).rows[0];
    if (!d) return yok(y);
    await kartAc(b.db, { tur: 'Teslim Talebi', kategori: 'islem', baslik: `${d.dosya_no} · Tesisten Teslim Talebi`, sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: id });
    return { tamam: true };
  });
  s.post('/tesis-portal/kayit', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await tesis(o.kullanici); const g = (i.body ?? {}) as { tur?: string; baslik?: string; belge?: string };
    if (!f) return yok(y);
    if (!['Tesis Kuralı', 'Tarife'].includes(g.tur ?? '') || !g.baslik?.trim() || !g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Tür, başlık ve belgeyi eklemenizi rica ederiz.' });
    await b.db.query(`INSERT INTO tesis_kaydi (kurulus_ref, tur, baslik, belge_ref, yukleyen_ref) VALUES ($1,$2,$3,$4,$5)`, [f, g.tur, g.baslik.trim(), g.belge, o.kullanici]);
    return { tamam: true };
  });
  s.post('/tesis-portal/fatura', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await tesis(o.kullanici); const g = (i.body ?? {}) as { talep?: string; no?: string; tarih?: string; kalem?: string; gun?: number; tutar?: number; belge?: string };
    if (!f) return yok(y);
    if (!g.talep || !UUID.test(g.talep) || !g.no?.trim() || !g.tarih || !(Number(g.tutar) > 0) || !g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Talep, fatura no, tarih, tutar ve belgeyi eklemenizi rica ederiz.' });
    if (!['Çekek', 'Barınma', 'Bekleme ve Muhafaza', 'Diğer'].includes(g.kalem ?? '')) return y.code(400).send({ hata: 'Kalemi seçmenizi rica ederiz.' });
    if (g.kalem === 'Bekleme ve Muhafaza' && !(Number(g.gun) > 0)) return y.code(400).send({ hata: 'Gün sayısını yazmanızı rica ederiz.' });
    if (!(await b.db.query(`SELECT 1 FROM tesis_talebi WHERE kimlik = $1 AND kurulus_ref = $2`, [g.talep, f])).rowCount) return yok(y);
    if ((await b.db.query(`SELECT 1 FROM tesis_faturasi WHERE kurulus_ref = $1 AND fatura_no = $2`, [f, g.no.trim()])).rowCount) return y.code(409).send({ hata: 'Bu fatura numarası kayıtlıdır.' });
    await b.db.query(`INSERT INTO tesis_faturasi (kurulus_ref, talep_ref, fatura_no, tarih, kalem, gun, tutar_eur, belge_ref, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [f, g.talep, g.no.trim(), g.tarih, g.kalem, g.gun ?? null, g.tutar, g.belge, o.kullanici]);
    return { tamam: true };
  });

  // Teklif talebi Tedarik Sorumlusundan; dosya kimliği ve müşteri tedarikçiye görünmez (YG-298).
  s.post('/dosya/:id/teklif-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tedarikci?: string; sonZaman?: string; kalemler?: { tanim?: string; parcaNo?: string; miktar?: number; birim?: string }[] };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await rolBak(o.kullanici, ['Tedarik Sorumlusu']))) return y.code(403).send({ hata: 'Teklif talebini Tedarik Sorumlusu açar.' });
    const kl = g.kalemler ?? [];
    if (!g.tedarikci || !UUID.test(g.tedarikci) || !g.sonZaman || !kl.length || kl.some((k) => !k.tanim?.trim() || !(Number(k.miktar) > 0) || !k.birim?.trim())) return y.code(400).send({ hata: 'Tedarikçi, son zaman ve kalem bilgileri zorunludur.' });
    const f = (await b.db.query(`SELECT kayit_rolu FROM kurulus WHERE kimlik = $1`, [g.tedarikci])).rows[0];
    if (f?.kayit_rolu !== 'Tedarikçi') return y.code(400).send({ hata: 'Kayıt tedarikçi değildir.' });
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const no = await altNumara(c, d.dosya_no, 'TT');
      const r = (await c.query(`INSERT INTO tedarikci_teklif_talebi (talep_no, dosya_ref, kurulus_ref, son_zaman, olusturan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [no, id, g.tedarikci, g.sonZaman, o.kullanici])).rows[0];
      for (const k of kl) await c.query(`INSERT INTO tedarikci_teklif_kalemi (talep_ref, urun_tanimi, uretici_parca_no, miktar, birim) VALUES ($1,$2,$3,$4,$5)`, [r.kimlik, k.tanim!.trim(), k.parcaNo?.trim() ?? null, k.miktar, k.birim!.trim()]);
      const al = (await c.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [g.tedarikci])).rows.map((x) => x.kullanici_ref as string);
      await bildir(c, { olay: `tt:${r.kimlik}`, kullanicilar: al, baslik: `${no} · Teklif Talebi`, eposta: true });
      return { kimlik: r.kimlik, talepNo: no };
    });
  });
  s.get('/dosya/:id/teklif-talepleri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const t = (await b.db.query(`SELECT t.kimlik, t.talep_no, t.durum, t.gecerlilik::text, k.ticari_unvan FROM tedarikci_teklif_talebi t JOIN kurulus k ON k.kimlik = t.kurulus_ref WHERE t.dosya_ref = $1 ORDER BY t.olusturma_zamani`, [id])).rows;
    const kalem = (await b.db.query(`SELECT k.talep_ref, k.urun_tanimi, k.miktar, k.birim, k.birim_fiyat_eur, k.teslim_suresi_gun FROM tedarikci_teklif_kalemi k JOIN tedarikci_teklif_talebi t ON t.kimlik = k.talep_ref WHERE t.dosya_ref = $1`, [id])).rows;
    return t.map((x) => ({ ...x, kalemler: kalem.filter((k) => k.talep_ref === x.kimlik) }));
  });

  const tedarikci = async (k: string) => { const f = await kurulusum(b.db, k); return f?.kayit_rolu === 'Tedarikçi' ? f.kurulus_ref : undefined; };
  // YG-298, YG-1088, YG-1577: yalnız kendi kayıtları; müşteri ve dosya içeriği yoktur.
  s.get('/tedarikci-portal/ana', oturumlu, async (i, y) => {
    const f = await tedarikci(i.oturum!.kullanici);
    if (!f) return yok(y);
    const q = (t: string) => b.db.query(t, [f]).then((r) => r.rows);
    const talepler = await q(`SELECT kimlik, talep_no, son_zaman, durum FROM tedarikci_teklif_talebi WHERE kurulus_ref = $1 ORDER BY son_zaman DESC LIMIT 100`);
    const kalemler = await q(`SELECT k.kimlik, k.talep_ref, k.urun_tanimi, k.uretici_parca_no, k.miktar, k.birim, k.birim_fiyat_eur, k.teslim_suresi_gun FROM tedarikci_teklif_kalemi k JOIN tedarikci_teklif_talebi t ON t.kimlik = k.talep_ref WHERE t.kurulus_ref = $1`);
    const siparisler = await q(`SELECT kimlik, siparis_no, statu, kdv_haric_eur, toplam_eur, teslim_tarihi::text, teslim_yeri, tedarikci_kabul, tedarikci_teslim_tarihi::text, EXISTS (SELECT 1 FROM tedarik_sevki v WHERE v.siparis_ref = s.kimlik) AS sevk_var FROM tedarik_siparisi s WHERE kurulus_ref = $1 AND statu NOT IN ('Taslak', 'Onay Bekliyor') ORDER BY olusturma_zamani DESC LIMIT 100`);
    const skalem = await q(`SELECT k.siparis_ref, k.urun_tanimi, k.uretici_parca_no, k.miktar, k.birim, k.birim_bedel_eur FROM tedarik_siparisi_kalemi k JOIN tedarik_siparisi s ON s.kimlik = k.siparis_ref WHERE s.kurulus_ref = $1`);
    const faturalar = await q(`SELECT f.kimlik, f.fatura_no, f.tarih::text, f.tutar_eur, s.siparis_no, (SELECT u.sonuc FROM uclu_eslestirme u WHERE u.siparis_ref = f.siparis_ref AND u.fatura_no = f.fatura_no LIMIT 1) AS eslestirme FROM tedarikci_faturasi f JOIN tedarik_siparisi s ON s.kimlik = f.siparis_ref WHERE f.kurulus_ref = $1 ORDER BY f.olusturma_zamani DESC`);
    return { kurulus: f, talepler: talepler.map((t) => ({ ...t, kalemler: kalemler.filter((k) => k.talep_ref === t.kimlik) })), siparisler: siparisler.map((t) => ({ ...t, kalemler: skalem.filter((k) => k.siparis_ref === t.kimlik) })), faturalar };
  });
  s.post('/tedarikci-portal/talep/:id/yanit', oturumlu, async (i, y) => {
    const f = await tedarikci(i.oturum!.kullanici); const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kalemler?: { kimlik?: string; fiyat?: number; sure?: number }[] };
    if (!f || !UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT son_zaman, durum FROM tedarikci_teklif_talebi WHERE kimlik = $1 AND kurulus_ref = $2`, [id, f])).rows[0];
    if (!t) return yok(y);
    if (t.durum !== 'Yanıt Bekliyor') return y.code(409).send({ hata: 'Bu talep yanıtlanmıştır.' });
    if (new Date(t.son_zaman) < new Date()) return y.code(409).send({ hata: 'Yanıt süresi dolmuştur; Tedarik Sorumlusuyla görüşmenizi rica ederiz.' });
    const mevcut = (await b.db.query(`SELECT kimlik FROM tedarikci_teklif_kalemi WHERE talep_ref = $1`, [id])).rows.map((r) => r.kimlik as string);
    const kl = g.kalemler ?? [];
    if (mevcut.some((m) => { const k = kl.find((x) => x.kimlik === m); return !k || !(Number(k.fiyat) >= 0) || !Number.isInteger(Number(k.sure)) || Number(k.sure) < 0; })) return y.code(400).send({ hata: 'Her kalem için birim fiyat ve teslim süresi yazmanızı rica ederiz.' });
    return islem(async (c) => {
      for (const k of kl) if (mevcut.includes(k.kimlik!)) await c.query(`UPDATE tedarikci_teklif_kalemi SET birim_fiyat_eur = $2, teslim_suresi_gun = $3 WHERE kimlik = $1`, [k.kimlik, k.fiyat, k.sure]);
      const r = (await c.query(`UPDATE tedarikci_teklif_talebi SET durum = 'Yanıtlandı', gecerlilik = (now() AT TIME ZONE 'Europe/Istanbul')::date + 30 WHERE kimlik = $1 RETURNING olusturan_ref, talep_no, gecerlilik::text`, [id])).rows[0];
      await bildir(c, { olay: `tt-yanit:${id}`, kullanicilar: [r.olusturan_ref], baslik: `${r.talep_no} · Teklif Geldi` });
      return { gecerlilik: r.gecerlilik };
    });
  });
  // YG-1577: kabul teslim tarihi ve onay koduyla (V-68: firma ile aynı doğrulama kodu).
  s.post('/tedarikci-portal/siparis/:id/yanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await tedarikci(o.kullanici); const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kabul?: boolean; kod?: string; teslim?: string; gerekce?: string };
    if (!f || !UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT siparis_no, statu, tedarikci_kabul, hazirlayan_ref FROM tedarik_siparisi WHERE kimlik = $1 AND kurulus_ref = $2`, [id, f])).rows[0];
    if (!t) return yok(y);
    if (t.statu !== 'Verildi' || t.tedarikci_kabul) return y.code(409).send({ hata: 'Bu sipariş yanıtlanmıştır.' });
    if (g.kabul) {
      if (!g.teslim) return y.code(400).send({ hata: 'Teslim tarihini yazmanızı rica ederiz.' });
      const h = (await b.db.query(`SELECT totp_gizli_sifreli, totp_son_adim FROM kullanici_hesabi WHERE kimlik = $1`, [o.kullanici])).rows[0];
      const adim = h.totp_gizli_sifreli && /^\d{6}$/.test(g.kod ?? '') ? totpDogrula(coz(h.totp_gizli_sifreli, b.anahtar), g.kod!, Number(h.totp_son_adim)) : null;
      if (!adim) return y.code(401).send({ hata: 'Onay kodu hatalıdır.' });
      await b.db.query(`UPDATE kullanici_hesabi SET totp_son_adim = $2 WHERE kimlik = $1`, [o.kullanici, adim]);
    } else if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçeyi yazmanızı rica ederiz.' });
    return islem(async (c) => {
      await c.query(`UPDATE tedarik_siparisi SET tedarikci_kabul = $2, tedarikci_teslim_tarihi = $3, tedarikci_red_gerekcesi = $4 WHERE kimlik = $1`, [id, g.kabul ? 'Kabul' : 'Ret', g.kabul ? g.teslim : null, g.gerekce?.trim() ?? null]);
      await bildir(c, { olay: `sp-yanit:${id}`, kullanicilar: [t.hazirlayan_ref], baslik: `${t.siparis_no} · Tedarikçi: ${g.kabul ? 'Kabul' : 'Kabul Edilmedi'}`, oncelik: g.kabul ? 'Normal' : 'Yüksek' });
      return { yanit: g.kabul ? 'Kabul' : 'Ret' };
    });
  });
  s.post('/tedarikci-portal/siparis/:id/sevk', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await tedarikci(o.kullanici); const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tarih?: string; irsaliye?: string; tasiyici?: string; lot?: string; belge?: string };
    if (!f || !UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT siparis_no, tedarikci_kabul, hazirlayan_ref FROM tedarik_siparisi WHERE kimlik = $1 AND kurulus_ref = $2`, [id, f])).rows[0];
    if (!t) return yok(y);
    if (t.tedarikci_kabul !== 'Kabul') return y.code(409).send({ hata: 'Sevk bildirimi sipariş kabulünden sonra yapılır.' });
    if (!g.tarih || !g.irsaliye?.trim() || !g.tasiyici?.trim() || !g.lot?.trim() || !g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Sevk tarihi, irsaliye, taşıyıcı, lot ve belgeyi eklemenizi rica ederiz.' });
    return islem(async (c) => {
      await c.query(`INSERT INTO tedarik_sevki (siparis_ref, sevk_tarihi, irsaliye_no, tasiyici, lot_no, belge_ref, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, g.tarih, g.irsaliye!.trim(), g.tasiyici!.trim(), g.lot!.trim(), g.belge, o.kullanici]);
      await bildir(c, { olay: `sevk:${id}:${g.irsaliye}`, kullanicilar: [t.hazirlayan_ref], baslik: `${t.siparis_no} · Sevk Edildi` });
      return { tamam: true };
    });
  });
  s.post('/tedarikci-portal/siparis/:id/fatura', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await tedarikci(o.kullanici); const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { no?: string; tarih?: string; tutar?: number; belge?: string };
    if (!f || !UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT tedarikci_kabul FROM tedarik_siparisi WHERE kimlik = $1 AND kurulus_ref = $2`, [id, f])).rows[0];
    if (!t) return yok(y);
    if (t.tedarikci_kabul !== 'Kabul') return y.code(409).send({ hata: 'Fatura sipariş kabulünden sonra girilir.' });
    if (!g.no?.trim() || !g.tarih || !(Number(g.tutar) > 0) || !g.belge || !UUID.test(g.belge)) return y.code(400).send({ hata: 'Fatura no, tarih, tutar ve belgeyi eklemenizi rica ederiz.' });
    if ((await b.db.query(`SELECT 1 FROM tedarikci_faturasi WHERE kurulus_ref = $1 AND fatura_no = $2`, [f, g.no.trim()])).rowCount) return y.code(409).send({ hata: 'Bu fatura numarası kayıtlıdır.' });
    await b.db.query(`INSERT INTO tedarikci_faturasi (siparis_ref, kurulus_ref, fatura_no, tarih, tutar_eur, belge_ref, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, f, g.no.trim(), g.tarih, g.tutar, g.belge, o.kullanici]);
    return { tamam: true };
  });
}
