import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

const IHTIYAC = 'İdari Talep'; const SIPARIS = 'İdari Sipariş'; const SORUMLU = 'İdari İşler Sorumlusu';

/** YG-1619: personelin ilk amiri (varsa birim Müdür Yardımcısı) ve son karar makamı; İç Denetçide Müdür hem ilk amir hem son makamdır (YG-1683). */
export async function ihtiyacZinciri(c: PoolClient, kullanici: string): Promise<string[]> {
  const r = (await c.query(`SELECT x.kimlik, x.kademe, x.rol_sahibi_birim birim FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' LIMIT 1`, [kullanici])).rows[0];
  if (!r) throw Object.assign(new Error('Aktif rol bulunamadı.'), { statusCode: 409 });
  const son = await onayMakami(c, r.kimlik); const z: string[] = [];
  if (!['Müdür', 'Müdür Yardımcısı', 'Direktör'].includes(r.kademe)) {
    const my = (await c.query(`SELECT kimlik FROM rol WHERE rol_sahibi_birim = $1 AND kademe = 'Müdür Yardımcısı' LIMIT 1`, [r.birim])).rows[0]?.kimlik as string | undefined;
    if (my && my !== son && (await rolSahipleri(c, my)).length) z.push(my);
  }
  z.push(son);
  return z;
}

/** Parasal onay sipariş aşamasında: 5.000,00 EUR'ya kadar TİD, 10.000,00 EUR'ya kadar GMY, üzeri CEO; Müdür kademesi onaylamaz. */
export async function siparisZinciri(c: PoolClient, tutar: number): Promise<string[]> {
  const z = [await rolId(c, 'Ticari İşler Direktörü')];
  if (tutar > 5000) z.push(await rolId(c, 'Genel Müdür Yardımcısı'));
  if (tutar > 10000) z.push(await rolId(c, 'CEO'));
  return z;
}

kapanisKaydet(IHTIYAC, async (c, k, karar) => {
  // İade edilen talep düzeltilip yeniden gönderilince yeniden ihtiyaç onayına girer.
  if (karar === 'Yeniden Gönder') { await c.query(`UPDATE idari_talep SET durum = 'İhtiyaç Onayında' WHERE kimlik = $1 AND durum = 'İade Edildi'`, [k.nesne_kimligi]); return; }
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return;
  const t = (await c.query(`SELECT kimlik, talep_no, konu FROM idari_talep WHERE kimlik = $1 AND durum = 'İhtiyaç Onayında'`, [k.nesne_kimligi])).rows[0];
  if (!t) return;
  await c.query(`UPDATE idari_talep SET durum = $2 WHERE kimlik = $1`, [t.kimlik, karar === 'Onayla' ? 'İdari İşlerde' : karar === 'Reddet' ? 'Reddedildi' : 'İade Edildi']);
  if (karar === 'Onayla') await kartAc(c, { tur: 'İdari Talep Hazırlığı', kategori: 'gorev', baslik: `${t.talep_no} · ${t.konu}`, ozet: 'İhtiyaç onaylandı; siparişi hazırlayınız.', sahipRol: await rolId(c, SORUMLU), sonZaman: new Date(Date.now() + 8 * 3_600_000), nesneTuru: 'İdari Talep', nesneKimligi: t.kimlik });
});
kapanisKaydet(SIPARIS, async (c, k, karar) => {
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return;
  await c.query(`UPDATE idari_talep SET durum = $2 WHERE kimlik = $1 AND durum = 'Sipariş Onayında'`, [k.nesne_kimligi, karar === 'Onayla' ? 'Sipariş Onaylandı' : karar === 'Reddet' ? 'Reddedildi' : 'İdari İşlerde']);
});

/** YG-1677: çeyrek bitince CEO masraf inceleme raporu görevi. */
export async function ceoMasrafRaporIsle(db: Pool, simdi = new Date()): Promise<boolean> {
  const c = Math.floor(simdi.getUTCMonth() / 3); const yil = c === 0 ? simdi.getUTCFullYear() - 1 : simdi.getUTCFullYear(); const ceyrek = c === 0 ? 4 : c;
  if (!(await birKez(db, 'ceo_masraf_raporu', `${yil}-${ceyrek}`))) return false;
  await kartAc(db, { tur: 'CEO Masraf İnceleme Raporu', kategori: 'gorev', baslik: `${yil} / ${ceyrek}. Çeyrek CEO Masraf İnceleme Raporu`, ozet: 'Rapor Muhasebe ve Finans ekranındadır.', sahipRol: await rolId(db, 'CEO'), nesneTuru: 'Masraf Raporu', nesneKimligi: `${yil}-${ceyrek}` });
  return true;
}

export function idariTalepYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  s.get('/idari-talep', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const sorumlu = await rolVar(o.kullanici, [SORUMLU]);
    return { sorumlu, talepler: (await b.db.query(`SELECT kimlik, talep_no, siparis_no, konu, durum, tedarikci, siparis_tutar_eur FROM idari_talep WHERE talep_eden_ref = $1 OR ($2 AND durum IN ('İdari İşlerde', 'Müdürde', 'Sipariş Onayında', 'Sipariş Onaylandı', 'Teslim Alındı')) ORDER BY olusturma_zamani DESC LIMIT 100`, [o.kullanici, sorumlu])).rows };
  });

  s.post('/idari-talep', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { konu?: string; gerekce?: string };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    if (!g.konu?.trim() || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Konu ve gerekçe zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const yil = new Date().getFullYear(); const no = `LGM-ID-${yil}-${String(await sayac(c, `idari_talep:${yil}`)).padStart(4, '0')}`; // YG-1618
      const r = (await c.query(`INSERT INTO idari_talep (talep_no, talep_eden_ref, konu, gerekce) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [no, o.kullanici, g.konu.trim(), g.gerekce.trim()])).rows[0];
      const zincir = await ihtiyacZinciri(c, o.kullanici);
      await kartAc(c, { tur: IHTIYAC, baslik: `${no} · ${g.konu.trim()}`, ozet: g.gerekce.trim().slice(0, 200), hazirlayan: o.kullanici, zincir, nesneTuru: 'İdari Talep', nesneKimligi: r.kimlik });
      const kisiler = (await Promise.all(zincir.map((z) => rolSahipleri(c, z)))).flat();
      await bildir(c, { olay: `idari-talep:${r.kimlik}`, kullanicilar: kisiler, baslik: `${no} · İdari Talep Açıldı` }); // YG-1619: silsileye aynı anda bilgi
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İdari Talep', nesneTuru: 'İdari Talep', nesneKimligi: r.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, talepNo: no };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  // YG-1620: siparişe dönüştürme ve onaya sunma İdari İşler Müdüründe; tedarikçi ve tutar seçilen fiyat kartından gelir.
  // Kart geçerliliği, BT alımında Bilgi İşlem şartnamesi ve bölünme kontrolü (aynı tedarikçiye 30 günlük toplam) uygulanır; son onay makamı toplam tutara göre belirlenir.
  s.post('/idari-talep/:id/siparis', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kart?: number; teslimPlan?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, ['İdari İşler Müdürü']))) return yok(y);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = (await c.query(`SELECT talep_no, konu, durum, kategori, bt_sartname FROM idari_talep WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      if (!t || t.durum !== 'Müdürde') return dur(409, 'Talep sipariş hazırlama aşamasında değildir.');
      const f = (await c.query(`SELECT f.sira, f.tutar_eur, f.gecerlilik::text, f.tedarikci_ref, d.ad FROM idari_fiyat_karti f JOIN idari_tedarikci d ON d.kimlik = f.tedarikci_ref WHERE f.talep_ref = $1 AND f.sira = $2`, [id, Number(g.kart)])).rows[0];
      if (!f) return dur(400, 'Fiyat kartını seçiniz.');
      if (f.gecerlilik < new Date().toISOString().slice(0, 10)) return dur(409, 'Seçilen fiyat kartının geçerliliği dolmuştur.');
      if (t.kategori === 'Bilgi Teknolojisi' && !t.bt_sartname) return dur(409, 'Bilgi İşlem teknik şartnamesi bekleniyor.');
      if (!g.teslimPlan || !/^\d{4}-\d{2}-\d{2}$/.test(g.teslimPlan)) return dur(400, 'Planlanan teslim tarihini giriniz.');
      const tutar = Number(f.tutar_eur);
      const otuz = Number((await c.query(`SELECT coalesce(sum(siparis_tutar_eur), 0) n FROM idari_talep WHERE tedarikci_ref = $1 AND kimlik <> $2 AND siparis_no IS NOT NULL AND durum NOT IN ('Reddedildi') AND olusturma_zamani > now() - interval '30 days'`, [f.tedarikci_ref, id])).rows[0].n);
      const sp = `${t.talep_no}-SP${String(await sayac(c, `idari_siparis:${t.talep_no}`)).padStart(2, '0')}`; // YG-1618
      await c.query(`UPDATE idari_talep SET durum = 'Sipariş Onayında', tedarikci = $2, tedarikci_ref = $3, siparis_tutar_eur = $4, siparis_no = $5, secilen_kart = $6, teslim_plan = $7 WHERE kimlik = $1`, [id, f.ad, f.tedarikci_ref, tutar, sp, f.sira, g.teslimPlan]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur IN ('İdari Talep Hazırlığı', 'İdari Sipariş Hazırlama') AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      const ozet = `${tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} EUR${otuz > 0 ? ` · Aynı tedarikçiye son 30 günde ${otuz.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} EUR (bölünme kontrolü)` : ''}`;
      await kartAc(c, { tur: SIPARIS, baslik: `${t.talep_no} · ${t.konu}`, ozet, hazirlayan: o.kullanici, zincir: await siparisZinciri(c, tutar + otuz), nesneTuru: 'İdari Talep', nesneKimligi: id });
      await c.query('COMMIT');
      return { durum: 'Sipariş Onayında', siparisNo: sp, bolunme: otuz > 0 };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  // YG-1677: CEO, Muhasebe ve Finans Müdürü ve mali müşavir görür; kayıt silinemez.
  s.get('/masraf/ceo-raporu', oturumlu, async (i, y) => {
    const o = i.oturum!; const q = i.query as { yil?: string; ceyrek?: string }; const yil = Number(q.yil); const ceyrek = Number(q.ceyrek);
    if (!(await rolVar(o.kullanici, ['CEO', 'Muhasebe ve Finans Müdürü', 'Muhasebe Hizmeti']))) return yok(y);
    if (!(yil > 2000) || ![1, 2, 3, 4].includes(ceyrek)) return y.code(400).send({ hata: 'Yıl ve çeyrek zorunludur.' });
    const satirlar = (await b.db.query(`SELECT f.fis_tarihi::text, f.masraf_turu, f.belge_ozeti, f.tutar_eur, f.odenecek_eur FROM personel_masraf_fisi f WHERE EXISTS (SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = f.personel_ref AND r.rol_adi = 'CEO') AND extract(year FROM f.fis_tarihi) = $1 AND extract(quarter FROM f.fis_tarihi) = $2 ORDER BY f.fis_tarihi`, [yil, ceyrek])).rows;
    return { satirlar, toplam: Math.round(satirlar.reduce((t, x) => t + Number(x.odenecek_eur), 0) * 100) / 100 };
  });
}
