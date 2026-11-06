import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { belgeBagiKaydet } from './belge.js';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const HUD = 'Hukuk ve Uyum Direktörü'; const GMY = 'Genel Müdür Yardımcısı'; const MFM = 'Muhasebe ve Finans Müdürü';
/** Matristeki "Muhasebe hizmeti" dış taraftır; içeride Muhasebe ve Finans Müdürü izler. */
const rolEsle = (r: string | null) => !r ? HUD : r.startsWith('Muhasebe hizmeti') ? MFM : r;
const G = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const gunEkle = (d: Date, g: number) => new Date(d.getTime() + g * 86_400_000);

/** YG-1546: olay gerçekleşince sorumlu role son tarihli görev açılır. */
export async function uyumOlay(db: Db, olay: string, nesneTuru: string, nesne: string, simdi = new Date()): Promise<number> {
  let n = 0;
  for (const k of (await db.query(`SELECT * FROM uyum_kurali WHERE olay_kodu = $1`, [olay])).rows) n += await gorevAc(db, { mum: k.mum_no, ad: k.yukumluluk, nesneTuru, nesne, son: gunEkle(simdi, k.sure_gun), sorumlu: rolEsle(k.sorumlu_rol), dogrulayan: rolEsle(k.dogrulayan_rol), kanit: k.gerekli_kanit ?? 'Kanıt belgesi' });
  return n;
}
async function gorevAc(db: Db, g: { mum: string | null; ad: string; nesneTuru: string; nesne: string; son: Date; sorumlu: string; dogrulayan: string; kanit: string }): Promise<number> {
  const r = await db.query(`INSERT INTO uyum_gorevi (mum_no, ad, nesne_turu, nesne, son_tarih, sorumlu_rol, dogrulayan_rol, gerekli_kanit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING kimlik`, [g.mum, g.ad, g.nesneTuru, g.nesne, G(g.son), g.sorumlu, g.dogrulayan, g.kanit]);
  if (!r.rowCount) return 0;
  await kartAc(db, { tur: 'Uyum Görevi', kategori: 'islem', baslik: `Uyum Görevi · ${g.ad.slice(0, 80)}`, ozet: `Gerekli kanıt: ${g.kanit}`, sonZaman: g.son, sahipRol: await rolId(db, g.sorumlu), nesneTuru: 'Uyum Görevi', nesneKimligi: r.rows[0].kimlik });
  return 1;
}

/** YG-1548: yalnız engelleyici kuralda kanıt yoksa veya süresi dolmuşsa işlem durur; acil iş kanıt beklemez. */
export async function uyumEngeli(db: Db, olay: string, nesneTuru: string, nesne: string, acil = false): Promise<string | null> {
  if (acil) return null;
  for (const k of (await db.query(`SELECT mum_no, gerekli_kanit FROM uyum_kurali WHERE olay_kodu = $1 AND engelleyici`, [olay])).rows) {
    if ((await db.query(`SELECT 1 FROM uyum_gorevi WHERE mum_no = $1 AND nesne_turu = $2 AND nesne = $3 AND durum = 'Kapalı' AND (kanit_bitis IS NULL OR kanit_bitis >= current_date) LIMIT 1`, [k.mum_no, nesneTuru, nesne])).rowCount) continue;
    await uyumOlay(db, olay, nesneTuru, nesne);
    return `Bu işlem için kanıt bekleniyor: ${k.gerekli_kanit}.`;
  }
  return null;
}

/** İş emri kapsamından uyum olayı: dalış, sıcak iş ve benzeri işler (MUM-047, MUM-048, MUM-054). */
export const isEmriUyumOlaylari = (kapsam: string) => { const o: string[] = []; if (/dal[ıi]ş|dalg[ıi]ç|sualt/i.test(kapsam)) o.push('is_emri_dalis'); if (/s[ıi]cak iş|kaynak|antifouling|z[ıi]mpara/i.test(kapsam)) o.push('is_emri_sicak'); return o; };

/** YG-1546, YG-1549: hatırlatma, eskalasyon ve takvimden görev. */
export async function uyumIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const bugun = G(simdi); const ay = simdi.getUTCMonth(); const yil = simdi.getUTCFullYear(); const donem = `${yil}-${String(ay + 1).padStart(2, '0')}`;
  const T = async (ad: string, rol: string, dogrulayan: string, kanit: string, gun: number) => { if (await birKez(db, 'uyum_takvim', `${ad}:${donem}`)) n += await gorevAc(db, { mum: null, ad, nesneTuru: 'Takvim', nesne: donem, son: new Date(Date.UTC(yil, ay, gun)), sorumlu: rol, dogrulayan, kanit }); };
  await T('Aylık muhtasar beyanname', MFM, 'Ticari İşler Direktörü', 'Beyanname ve tahakkuk', 26);
  if (ay === 5 || ay === 9) await T('Oda aidatı', MFM, 'Ticari İşler Direktörü', 'Ödeme belgesi', 28);
  if (ay === 0) { await T('VERBİS eşik kontrolü', HUD, HUD, 'Eşik kontrol notu', 31); await T('Hakem heyeti parasal sınırı kontrolü', HUD, HUD, 'Güncel sınır notu', 31); }
  for (const g of (await db.query(`SELECT kimlik, ad, sorumlu_rol, son_tarih::text son FROM uyum_gorevi WHERE durum <> 'Kapalı'`)).rows) {
    const kalan = Math.round((new Date(g.son).getTime() - new Date(bugun).getTime()) / 86_400_000);
    if (kalan <= 3 && kalan >= 0 && await birKez(db, 'uyum_hatir', g.kimlik)) { await bildir(db, { olay: `uyum-hatir:${g.kimlik}`, kullanicilar: await rolSahipleri(db, await rolId(db, g.sorumlu_rol)), baslik: `Uyum Görevi Yaklaşıyor · ${g.ad.slice(0, 60)}`, ozet: `Son tarih: ${g.son}` }); n++; }
    if (kalan < 0 && await birKez(db, 'uyum_gecti', g.kimlik)) {
      const r = await rolId(db, g.sorumlu_rol); const ust = g.sorumlu_rol === 'CEO' || g.sorumlu_rol === GMY ? [] : await rolSahipleri(db, await onayMakami(db, r));
      await bildir(db, { olay: `uyum-gecti:${g.kimlik}`, kullanicilar: [...ust, ...await rolSahipleri(db, await rolId(db, GMY))], baslik: `⚠ Uyum Görevi Süresi Geçti · ${g.ad.slice(0, 60)}`, ozet: `Son tarih: ${g.son}`, oncelik: 'Yüksek' }); n++;
    }
  }
  n += await sureUyariIsle(db, simdi);
  return n;
}

/** YG-531, YG-532, YG-533: her eşik için bir kez; sözleşme 90, 45, 15; belge 60, 30; BT varlığı 30 gün. */
export async function sureUyariIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const bugun = G(simdi);
  const kalan = (d: Date | string) => Math.round((new Date(G(d)).getTime() - new Date(bugun).getTime()) / 86_400_000);
  const esik = (k: number, l: number[]) => l.filter((e) => k <= e && k >= 0).sort((a, b) => a - b)[0];
  const uyar = async (ad: string, id: string, e: number, kisiler: string[], baslik: string, ozet: string) => { if (kisiler.length && await birKez(db, ad, `${id}:${e}`)) { await bildir(db, { olay: `${ad}:${id}:${e}`, kullanicilar: kisiler, baslik, ozet, oncelik: e <= 15 ? 'Yüksek' : 'Normal', eposta: true }, simdi); n++; } };
  const ust = [...await rolSahipleri(db, await rolId(db, HUD)), ...await rolSahipleri(db, await rolId(db, GMY)), ...await rolSahipleri(db, await rolId(db, 'CEO')), ...await rolSahipleri(db, await rolId(db, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'))];
  const sc = await rolSahipleri(db, await rolId(db, 'Sicil Sorumlusu')); const sy = await rolSahipleri(db, await rolId(db, 'Sistem Yöneticisi')); const kk = await rolSahipleri(db, await rolId(db, 'Kalite Müdürü'));
  for (const s of (await db.query(`SELECT s.kimlik, s.sozlesme_turu, s.bitis, s.fesih_bildirim_son, s.kaydeden_ref, u.ticari_unvan FROM sozlesme_kaydi s JOIN kurulus u ON u.kimlik = s.kurulus_ref WHERE s.durum = 'Yürürlükte' AND (s.bitis IS NOT NULL OR s.fesih_bildirim_son IS NOT NULL)`)).rows) {
    if (s.bitis) { const e = esik(kalan(s.bitis), [90, 45, 15]); if (e) await uyar('sozlesme_bitis', s.kimlik, e, [s.kaydeden_ref, ...ust], `Sözleşme Yenilemesi · ${e} Gün`, `${s.ticari_unvan} · ${s.sozlesme_turu} · Bitiş: ${G(s.bitis)}`); }
    if (s.fesih_bildirim_son) { const e = esik(kalan(s.fesih_bildirim_son), [90, 45, 15]); if (e) await uyar('sozlesme_fesih', s.kimlik, e, [s.kaydeden_ref, ...ust], `Fesih Bildirimi Son Günü · ${e} Gün`, `${s.ticari_unvan} · ${s.sozlesme_turu} · Son gün: ${G(s.fesih_bildirim_son)}`); }
  }
  for (const b of (await db.query(`SELECT b.kimlik, b.tur, b.gecerlilik_bitis, u.kimlik AS firma, u.ticari_unvan FROM sicil_belgesi b JOIN kurulus u ON u.kimlik = b.kurulus_ref WHERE b.gecerlilik_bitis IS NOT NULL AND u.ag_statusu <> 'Çıkarıldı'`)).rows) {
    const e = esik(kalan(b.gecerlilik_bitis), [60, 30]); if (!e) continue;
    const ku = (await db.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [b.firma])).rows.map((r) => r.kullanici_ref as string);
    await uyar('sicil_belge', b.kimlik, e, [...sc, ...ku], `Belge Süresi Doluyor · ${e} Gün`, `${b.ticari_unvan} · ${b.tur} · Bitiş: ${G(b.gecerlilik_bitis)}`);
  }
  for (const y of (await db.query(`SELECT kullanici_ref, sahip_ad, bitis_tarihi FROM yat_yetkilisi_kaydi WHERE belge_durumu = 'Geçerli' AND bitis_tarihi IS NOT NULL`)).rows) { const e = esik(kalan(y.bitis_tarihi), [60, 30]); if (e) await uyar('yetki_belge', y.kullanici_ref, e, [y.kullanici_ref, ...await rolSahipleri(db, await rolId(db, 'Müşteri ve Paydaş İlişkileri Müdürü'))], `Yetki Belgesi Süresi Doluyor · ${e} Gün`, `${y.sahip_ad} · Bitiş: ${G(y.bitis_tarihi)}`); }
  for (const k of (await db.query(`SELECT kimlik, ad_soyad, least(yeterlilik_bitis, police_bitis) b FROM kaptan_kaydi`)).rows) { const e = esik(kalan(k.b), [60, 30]); if (e) await uyar('kaptan_belge', k.kimlik, e, sc, `Kaptan Belgesi Süresi Doluyor · ${e} Gün`, `${k.ad_soyad} · Bitiş: ${G(k.b)}`); }
  for (const c of (await db.query(`SELECT kimlik, ad, seri_no, (kalibrasyon_tarihi + make_interval(months => aralik_ay))::date b FROM olcum_cihazi WHERE kabul`)).rows) {
    const k = kalan(c.b); if (k < 0) { await db.query(`UPDATE olcum_cihazi SET kabul = false WHERE kimlik = $1`, [c.kimlik]); n++; continue; } // YG-533: süresi geçen kullanılabilir görünmez
    const e = esik(k, [60, 30]); if (e) await uyar('kalibrasyon', c.kimlik, e, kk, `Kalibrasyon Süresi Doluyor · ${e} Gün`, `${c.ad} · ${c.seri_no} · Son: ${G(c.b)}`);
  }
  // YG-532: LGM poliçesi ve imza sirküleri 90/45/15 gün (kaydeden, Hukuk ve Uyum, GMY, CEO); broker ve acente yetki belgesi 60/30 gün (kaydeden, Sicil Sorumlusu, Hukuk ve Uyum).
  const hud = await rolSahipleri(db, await rolId(db, HUD));
  for (const q of (await db.query(`SELECT kimlik, tur, ad, karsi_taraf, bitis, kaydeden_ref FROM kurum_belgesi WHERE durum = 'Geçerli'`)).rows) {
    const lgm = q.tur === 'LGM Sigorta Poliçesi' || q.tur === 'İmza Sirküleri';
    const e = esik(kalan(q.bitis), lgm ? [90, 45, 15] : [60, 30]); if (!e) continue;
    await uyar('kurum_belgesi', q.kimlik, e, lgm ? [q.kaydeden_ref, ...ust] : [q.kaydeden_ref, ...sc, ...hud], `${q.tur} Yenilemesi · ${e} Gün`, `${q.ad}${q.karsi_taraf ? ` · ${q.karsi_taraf}` : ''} · Bitiş: ${G(q.bitis)}`);
  }
  // YG-533: firma ekipmanı bakım ve kalibrasyon bitişi; süresi geçen kullanılabilir gösterilmez.
  for (const q of (await db.query(`SELECT e.kimlik, e.ad, e.seri_no, e.kurulus_ref, u.ticari_unvan, least(e.bakim_bitis, e.kalibrasyon_bitis) b FROM firma_ekipmani e JOIN kurulus u ON u.kimlik = e.kurulus_ref WHERE e.kullanilabilir AND coalesce(e.bakim_bitis, e.kalibrasyon_bitis) IS NOT NULL`)).rows) {
    const k = kalan(q.b); if (k < 0) { await db.query(`UPDATE firma_ekipmani SET kullanilabilir = false WHERE kimlik = $1`, [q.kimlik]); n++; continue; }
    const e = esik(k, [60, 30]); if (!e) continue;
    const ku = (await db.query(`SELECT kullanici_ref FROM kurulus_kullanici WHERE kurulus_ref = $1`, [q.kurulus_ref])).rows.map((r) => r.kullanici_ref as string);
    await uyar('firma_ekipman', q.kimlik, e, [...sc, ...ku], `Ekipman Bakım/Kalibrasyon Süresi Doluyor · ${e} Gün`, `${q.ticari_unvan} · ${q.ad} · ${q.seri_no} · Son: ${G(q.b)}`);
  }
  // D-025: personel vize ve pasaport bitişi İnsan Kaynaklarına.
  const ikl = [...await rolSahipleri(db, await rolId(db, 'İnsan Kaynakları Müdürü')), ...await rolSahipleri(db, await rolId(db, 'İnsan Kaynakları Sorumlusu'))];
  for (const p of (await db.query(`SELECT k.kullanici_ref, h.ad_soyad, k.vize_bitis, k.pasaport_bitis FROM personel_karti k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.personel_durumu <> 'Ayrıldı' AND (k.vize_bitis IS NOT NULL OR k.pasaport_bitis IS NOT NULL)`)).rows) {
    for (const [tur, d] of [['Vize', p.vize_bitis], ['Pasaport', p.pasaport_bitis]] as [string, Date | null][]) { if (!d) continue; const e = esik(kalan(d), [60, 30]); if (e) await uyar('personel_belge', `${p.kullanici_ref}:${tur}`, e, ikl, `${tur} Süresi Doluyor · ${e} Gün`, `${p.ad_soyad} · Bitiş: ${G(d)}`); }
  }
  for (const v of (await db.query(`SELECT kimlik, ad, bitis FROM bt_varligi`)).rows) { const e = esik(kalan(v.bitis), [30]); if (e) await uyar('bt_varligi', v.kimlik, e, sy, 'BT Varlığı veya Lisans Bitişi · 30 Gün', `${v.ad} · Bitiş: ${G(v.bitis)}`); }
  return n;
}

belgeBagiKaydet('Uyum Görevi', async (db, k, id) => { const r = (await db.query(`SELECT sorumlu_rol FROM uyum_gorevi WHERE kimlik::text = $1`, [id])).rows[0]; if (!r) return 'yok'; return (await rolSahipleri(db, await rolId(db, r.sorumlu_rol))).includes(k) ? 'tamam' : 'yetkisiz'; });

export function uyumYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolleri = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);
  // YG-1545: kural kodu ve olay adı kullanıcıya gösterilmez.
  s.get('/uyum-gorevleri', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    const r = await rolleri(i.oturum!.kullanici);
    return (await b.db.query(`SELECT kimlik, ad, son_tarih::text, sorumlu_rol, dogrulayan_rol, gerekli_kanit, durum, kanit_bitis::text FROM uyum_gorevi WHERE durum <> 'Kapalı' AND (sorumlu_rol = ANY($1::text[]) OR dogrulayan_rol = ANY($1::text[]) OR $2) ORDER BY son_tarih LIMIT 200`, [r, r.includes(HUD)])).rows;
  });
  s.post('/uyum-gorevi/:id/kanit', oturumlu, async (i, y) => { // YG-1547
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string; bitis?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT sorumlu_rol, durum FROM uyum_gorevi WHERE kimlik = $1`, [id])).rows[0];
    if (!t) return yok(y);
    if (!(await rolleri(o.kullanici)).includes(t.sorumlu_rol)) return y.code(403).send({ hata: `Kanıtı ${t.sorumlu_rol} yükler.` });
    if (!g.belge || !UUID.test(g.belge) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1`, [g.belge])).rowCount) return y.code(400).send({ hata: 'Kanıt belgesini yüklemenizi rica ederiz.' });
    await b.db.query(`UPDATE uyum_gorevi SET kanit_belge_ref = $2, kanit_bitis = $3, yukleyen_ref = $4, durum = 'Kanıt Yüklendi' WHERE kimlik = $1`, [id, g.belge, g.bitis || null, o.kullanici]);
    return { durum: 'Kanıt Yüklendi' };
  });
  s.post('/uyum-gorevi/:id/dogrula', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT dogrulayan_rol, sorumlu_rol, durum, yukleyen_ref FROM uyum_gorevi WHERE kimlik = $1`, [id])).rows[0];
    if (!t) return yok(y);
    if (!(await rolleri(o.kullanici)).includes(t.dogrulayan_rol)) return y.code(403).send({ hata: `Doğrulamayı ${t.dogrulayan_rol} yapar.` });
    if (t.durum !== 'Kanıt Yüklendi') return y.code(409).send({ hata: 'Kanıt yüklenmeden görev kapanmaz.' });
    if (t.yukleyen_ref === o.kullanici && t.sorumlu_rol !== t.dogrulayan_rol) return y.code(403).send({ hata: 'Kanıtı yükleyen doğrulayamaz.' });
    await b.db.query(`UPDATE uyum_gorevi SET durum = 'Kapalı', dogrulayan_ref = $2, kapanis_zamani = now() WHERE kimlik = $1`, [id, o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Uyum Görevi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Uyum Görevi Kapandı', nesneTuru: 'Uyum Görevi', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'Kapalı' };
  });
  s.post('/bt-varligi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ad?: string; tur?: string; bitis?: string };
    if (!(await rolleri(o.kullanici)).some((r) => ['Sistem Yöneticisi', 'Bilgi İşlem Müdürü'].includes(r))) return y.code(403).send({ hata: 'BT varlığını Sistem Yöneticisi girer.' });
    if (!g.ad?.trim() || !g.bitis || !['Donanım', 'Lisans', 'Alan Adı', 'Sertifika', 'Diğer'].includes(g.tur ?? '')) return y.code(400).send({ hata: 'Ad, tür ve bitiş tarihi zorunludur.' });
    return (await b.db.query(`INSERT INTO bt_varligi (ad, tur, bitis, kaydeden_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [g.ad.trim(), g.tur, g.bitis, o.kullanici])).rows[0];
  });
}
