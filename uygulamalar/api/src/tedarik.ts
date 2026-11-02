import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { tutar } from './metin.js';
import { altNumara } from './sure.js';
import { parametre, parasalZincir, sonMakam } from './teklif.js';
import { avansHesapla } from './ticari.js';
import { UUID } from './yat.js';

const R2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;

/** YG-906: parça bedeli siparişten önce alınır; avans alınmayan dosyada aranmaz (sigorta eşik altı; acil ve kritikte sigorta ve kurumsal). */
export async function parcaOdemeEngeli(db: Pool | PoolClient, dosya: string): Promise<string | null> {
  const d = (await db.query(`SELECT d.musteri_turu, d.oncelik, (SELECT max(genel_toplam_eur) FROM fiyat_teklifi t WHERE t.dosya_ref = d.kimlik AND t.statu = 'Karar') tutar FROM dosya d WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (avansHesapla(d.musteri_turu, Number(d.tutar ?? 0), d.oncelik === 'Kritik', await parametre(db, 'avans_orani'), await parametre(db, 'sigorta_avans_esik_eur')) === 0) return null;
  return (await db.query(`SELECT 1 FROM odeme_talebi WHERE dosya_ref = $1 AND tur IN ('Parça', 'Avans') AND durum = 'Ödendi' LIMIT 1`, [dosya])).rowCount ? null : 'Parça bedeli alınmadan sipariş verilemez.';
}

/** Üçlü eşleştirme sonucu. Fazla teslim, miktar farkı ve fiyat farkı ayrı; fark varsa otomatik ödeme yok. */
export function eslestir(siparisMiktar: number, teslim: number, siparisTutar: number, fatura: number): { sonuc: string; miktarFarki: number; fiyatFarki: number } {
  const miktarFarki = Math.round((teslim - siparisMiktar) * 1000) / 1000; const fiyatFarki = R2(fatura - siparisTutar);
  return { sonuc: miktarFarki > 0 ? 'Fazla Teslim' : miktarFarki < 0 ? 'Miktar Farkı' : fiyatFarki !== 0 ? 'Fiyat Farkı' : 'Eşleşti', miktarFarki, fiyatFarki };
}

/** YG-823: teslim tarihinden 7 gün aşımda erken uyarı. */
export async function tedarikSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  for (const t of (await db.query(`SELECT kimlik, siparis_no FROM tedarik_siparisi s WHERE s.statu IN ('Verildi', 'Kısmi Teslim') AND s.teslim_tarihi + 7 < $1::date AND NOT EXISTS (SELECT 1 FROM is_karti k WHERE k.tur = 'Tedarik Gecikmesi' AND k.nesne_kimligi = s.kimlik::text)`, [simdi])).rows) {
    await kartAc(db, { tur: 'Tedarik Gecikmesi', kategori: 'islem', baslik: `${t.siparis_no} · Teslim 7 Gün Aştı`, oncelik: 'Yüksek', sahipRol: await rolId(db, 'Tedarik Yönetimi Müdürü'), nesneTuru: 'Sipariş', nesneKimligi: t.kimlik }); n++;
  }
  return n;
}

kapanisKaydet('Tedarik Siparişi', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE tedarik_siparisi SET statu = 'Verildi' WHERE kimlik = $1`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE tedarik_siparisi SET statu = 'İptal' WHERE kimlik = $1`, [k.nesne_kimligi]);
});

export function tedarikYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
  const tedarikSorumlusu = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = 'Tedarik Sorumlusu'`, [k])).rowCount);

  // YG-823, YG-906: Tedarik Sorumlusu hazırlar; Tedarik Müdürü → T&O Direktörü uygun görüş → limite göre son makam.
  s.post('/dosya/:id/siparis', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tedarikci?: string; teklifRef?: string; kullanim?: string; teslimTarihi?: string; teslimYeri?: string; kismi?: boolean; olcut?: string; gerekce?: string; kalemler?: { tanim?: string; parcaNo?: string; miktar?: number; birim?: string; bedel?: number }[] };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await tedarikSorumlusu(o.kullanici))) return y.code(403).send({ hata: 'Siparişi Tedarik Sorumlusu hazırlar.' });
    if (!g.tedarikci || !UUID.test(g.tedarikci) || !g.teklifRef?.trim() || !g.kullanim?.trim() || !g.teslimTarihi || !g.teslimYeri?.trim() || !g.olcut?.trim() || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Tedarikçi, teklif, kullanım yeri, teslim, kabul ölçütü ve seçim gerekçesi zorunludur.' });
    const kl = g.kalemler ?? [];
    if (!kl.length || kl.some((k) => !k.tanim?.trim() || !k.parcaNo?.trim() || !(Number(k.miktar) > 0) || !k.birim?.trim() || !(Number(k.bedel) >= 0))) return y.code(400).send({ hata: 'Kalem bilgileri eksiktir.' });
    const f = (await b.db.query(`SELECT kayit_rolu, kayit_asamasi, ag_statusu FROM kurulus WHERE kimlik = $1`, [g.tedarikci])).rows[0];
    if (!f || f.kayit_rolu !== 'Tedarikçi') return y.code(400).send({ hata: 'Kayıt tedarikçi değildir.' });
    if (f.ag_statusu !== 'Aktif' || !['Onaylı', 'Koşullu Onaylı'].includes(f.kayit_asamasi)) return y.code(409).send({ hata: 'Onaylı ve aktif olmayan tedarikçiye sipariş verilmez.' });
    const eng = await parcaOdemeEngeli(b.db, id);
    if (eng) return y.code(409).send({ hata: eng });
    const matrah = R2(kl.reduce((a, k) => a + R2(Number(k.miktar) * Number(k.bedel)), 0)); const kdv = R2((matrah * await parametre(b.db, 'kdv_orani')) / 100);
    return islem(async (c) => {
      const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const no = await altNumara(c, d.dosya_no, 'SP');
      const r = (await c.query(`INSERT INTO tedarik_siparisi (siparis_no, dosya_ref, kurulus_ref, tedarikci_teklif_ref, nihai_kullanim_yeri, kdv_haric_eur, kdv_eur, toplam_eur, teslim_tarihi, teslim_yeri, kismi_teslim_izni, kabul_olcutu, secim_gerekcesi, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING kimlik`, [no, id, g.tedarikci, g.teklifRef!.trim(), g.kullanim!.trim(), matrah, kdv, R2(matrah + kdv), g.teslimTarihi, g.teslimYeri!.trim(), Boolean(g.kismi), g.olcut!.trim(), g.gerekce!.trim(), o.kullanici])).rows[0];
      let n = 0;
      for (const k of kl) await c.query(`INSERT INTO tedarik_siparisi_kalemi (siparis_ref, satir_no, urun_tanimi, uretici_parca_no, miktar, birim, birim_bedel_eur, toplam_eur) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [r.kimlik, ++n, k.tanim!.trim(), k.parcaNo!.trim(), k.miktar, k.birim!.trim(), k.bedel, R2(Number(k.miktar) * Number(k.bedel))]);
      await kartAc(c, { tur: 'Tedarik Siparişi', baslik: `${no} · Tedarik Siparişi`, ozet: `${tutar(matrah)} EUR`, hazirlayan: o.kullanici, zincir: await parasalZincir(c, ['Tedarik Yönetimi Müdürü', 'Teknik ve Operasyon Direktörü'], await sonMakam(c, matrah)), nesneTuru: 'Sipariş', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, siparisNo: no, kdvHaric: matrah, toplam: R2(matrah + kdv) };
    });
  });

  // YG-404, YG-405, YG-1589: lotsuz kabul yok; bekletme yeri firma veya tedarikçi (LGM deposu yok); kontrol Saha Sorumlusu, yoksa Teknik Uzman.
  s.post('/siparis/:id/giris', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { satir?: number; miktar?: number; lot?: string; irsaliye?: string; bekletmeYeri?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT s.*, d.dosya_no FROM tedarik_siparisi s JOIN dosya d ON d.kimlik = s.dosya_ref WHERE s.kimlik = $1`, [id])).rows[0];
    if (!t || !(await dosyaErisimi(b.db, o.kullanici, t.dosya_ref))) return yok(y);
    if (!(await tedarikSorumlusu(o.kullanici))) return y.code(403).send({ hata: 'Giriş kaydını Tedarik Sorumlusu hazırlar.' });
    if (!['Verildi', 'Kısmi Teslim'].includes(t.statu)) return y.code(409).send({ hata: 'Sipariş verilmemiştir.' });
    if (!g.lot?.trim()) return y.code(400).send({ hata: 'Kaynağı veya lotu izlenemeyen malzeme kabul edilmez.' });
    if (!g.irsaliye?.trim() || !g.bekletmeYeri || !UUID.test(g.bekletmeYeri) || !(Number(g.miktar) > 0)) return y.code(400).send({ hata: 'İrsaliye, miktar ve bekletme yeri zorunludur.' });
    const k = (await b.db.query(`SELECT miktar, teslim_alinan FROM tedarik_siparisi_kalemi WHERE siparis_ref = $1 AND satir_no = $2`, [id, g.satir])).rows[0];
    if (!k) return y.code(400).send({ hata: 'Satır bulunamadı.' });
    if (Number(k.teslim_alinan) + Number(g.miktar) > Number(k.miktar)) return y.code(409).send({ hata: 'Fazla teslim yetkili değişiklik gerektirir.' });
    const saha = (await b.db.query(`SELECT kullanici_ref, rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol IN ('Saha Sorumlusu', 'Teknik Uzman') AND bitis_zamani IS NULL ORDER BY CASE rol WHEN 'Saha Sorumlusu' THEN 0 ELSE 1 END LIMIT 1`, [t.dosya_ref])).rows[0];
    if (!saha) return y.code(409).send({ hata: 'Dosyada teknik kontrol sorumlusu yoktur.' });
    return islem(async (c) => {
      const no = await altNumara(c, t.dosya_no, 'MG');
      const r = (await c.query(`INSERT INTO malzeme_giris_kabulu (kayit_no, siparis_ref, satir_no, miktar, lot_no, irsaliye_no, bekletme_yeri_ref, kontrol_eden_ref, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [no, id, g.satir, g.miktar, g.lot!.trim(), g.irsaliye!.trim(), g.bekletmeYeri, saha.kullanici_ref, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Malzeme Kontrolü', kategori: 'islem', baslik: `${no} · Malzeme Teknik Kontrolü`, sahipKullanici: saha.kullanici_ref, nesneTuru: 'Malzeme', nesneKimligi: r.kimlik });
      return { kimlik: r.kimlik, kayitNo: no, gonderilen: saha.rol };
    });
  });
  s.post('/malzeme-giris/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { karar } = (i.body ?? {}) as { karar?: string };
    if (!UUID.test(id)) return yok(y);
    const m = (await b.db.query(`SELECT * FROM malzeme_giris_kabulu WHERE kimlik = $1`, [id])).rows[0];
    if (!m) return yok(y);
    if (m.kontrol_eden_ref !== o.kullanici) return y.code(403).send({ hata: 'Kontrolü sistemin belirlediği sorumlu yapar.' });
    if (m.kabul_karari) return y.code(409).send({ hata: 'Karar verilmiştir.' });
    if (!['Kabul', 'Koşullu Kabul', 'Karantina', 'Ret', 'İade Edildi'].includes(karar ?? '')) return y.code(400).send({ hata: 'Kararı seçiniz.' });
    return islem(async (c) => {
      await c.query(`UPDATE malzeme_giris_kabulu SET kabul_karari = $2, onay_zamani = now() WHERE kimlik = $1`, [id, karar]);
      if (karar === 'Kabul' || karar === 'Koşullu Kabul') {
        await c.query(`UPDATE tedarik_siparisi_kalemi SET teslim_alinan = teslim_alinan + $3 WHERE siparis_ref = $1 AND satir_no = $2`, [m.siparis_ref, m.satir_no, m.miktar]);
        const kalan = (await c.query(`SELECT 1 FROM tedarik_siparisi_kalemi WHERE siparis_ref = $1 AND teslim_alinan < miktar LIMIT 1`, [m.siparis_ref])).rowCount;
        await c.query(`UPDATE tedarik_siparisi SET statu = $2 WHERE kimlik = $1`, [m.siparis_ref, kalan ? 'Kısmi Teslim' : 'Teslim Alındı']);
      }
      return { karar, uygunsuzlukGerekli: karar === 'Karantina' || karar === 'Ret' };
    });
  });
  // Üçlü eşleştirme: sipariş, teslim, fatura; fark varsa ödeme planlanmaz. Aynı fatura no + tutar + cari mükerrer.
  s.post('/siparis/:id/eslestirme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { no?: string; tarih?: string; tutar?: number };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT * FROM tedarik_siparisi WHERE kimlik = $1`, [id])).rows[0];
    if (!t || !(await dosyaErisimi(b.db, o.kullanici, t.dosya_ref))) return yok(y);
    if (!g.no?.trim() || !g.tarih || !(Number(g.tutar) > 0)) return y.code(400).send({ hata: 'Fatura no, tarih ve tutar zorunludur.' });
    if ((await b.db.query(`SELECT 1 FROM uclu_eslestirme WHERE kurulus_ref = $1 AND fatura_no = $2 AND fatura_tutari = $3`, [t.kurulus_ref, g.no.trim(), g.tutar])).rowCount) return y.code(409).send({ hata: 'Bu fatura kayıtlıdır; mükerrer ödeme engellendi.' });
    const m = (await b.db.query(`SELECT sum(miktar) m, sum(teslim_alinan) t FROM tedarik_siparisi_kalemi WHERE siparis_ref = $1`, [id])).rows[0];
    const r = eslestir(Number(m.m), Number(m.t), Number(t.kdv_haric_eur), Number(g.tutar));
    await b.db.query(`INSERT INTO uclu_eslestirme (siparis_ref, kurulus_ref, fatura_no, fatura_tarihi, fatura_tutari, miktar_farki, fiyat_farki, sonuc, kontrol_eden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, t.kurulus_ref, g.no.trim(), g.tarih, g.tutar, r.miktarFarki, r.fiyatFarki, r.sonuc, o.kullanici]);
    return r;
  });
}
