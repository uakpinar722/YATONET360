import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';

type Db = Pool | PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TU_ROLLER = ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)'];
/** YG-1598: kararın aktarım hedefi; teknik rapor ve metraj kararları Teknik Uzmana, Fiyat Teklifi kararları Ticari Sorumluya görev olur. */
export const AKTARIM = ['Teknik Rapor', 'Metraj', 'Fiyat Teklifi', 'Bilgi'];
const SURE_DK = 60;
const IST = 3 * 3_600_000; // Türkiye saati UTC+3
const MESAI = [9 * 60, 18 * 60];

/** YG-1598: toplantı Firma Teknik Raporu ve Firma Fiyat Teklifi portala girildikten, Teknik Uzman teknik rapor ve metraj hazırlığını tamamladıktan sonra yapılır. */
export async function kapsamOnKosullari(db: Db, dosya: string): Promise<string[]> {
  const x = (await db.query(`SELECT
      EXISTS (SELECT 1 FROM firma_teknik_raporu WHERE dosya_ref = $1) fr,
      EXISTS (SELECT 1 FROM firma_fiyat_teklifi WHERE dosya_ref = $1 AND durum IN ('Gönderildi', 'Seçildi')) ft,
      EXISTS (SELECT 1 FROM teknik_rapor WHERE dosya_ref = $1 AND durum NOT IN ('Reddedildi', 'Geri Çekildi')) tr,
      EXISTS (SELECT 1 FROM kapsam_cetveli c JOIN kapsam_satiri s ON s.cetvel_ref = c.kimlik WHERE c.dosya_ref = $1 AND c.durum <> 'Yerine Geçti') mt`, [dosya])).rows[0];
  return [...(x.fr ? [] : ['Firma Teknik Raporu portala girilmedi.']), ...(x.ft ? [] : ['Firma Fiyat Teklifi portala girilmedi.']),
    ...(x.tr ? [] : ['Teknik Uzmanın teknik raporu hazır değil.']), ...(x.mt ? [] : ['Kapsam ve Metraj Cetveli hazır değil.'])];
}

/** Katılımcılar: Dosya Sorumlusu, Teknik Uzman, (varsa görüntülü) Saha Sorumlusu ve Ticari Sorumlu. */
export async function kapsamKatilimcilari(db: Db, dosya: string) {
  const d = (await db.query(`SELECT dosya_sorumlusu_ref, ticari_sorumlu_ref FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  const l = new Map<string, { kullanici: string; rol: string; gorsel: boolean }>();
  if (d?.dosya_sorumlusu_ref) l.set(d.dosya_sorumlusu_ref, { kullanici: d.dosya_sorumlusu_ref, rol: 'Dosya Sorumlusu', gorsel: false });
  for (const e of (await db.query(`SELECT kullanici_ref, rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL AND rol = ANY($2) ORDER BY rol`, [dosya, [...TU_ROLLER, 'Saha Sorumlusu']])).rows) {
    if (!l.has(e.kullanici_ref)) l.set(e.kullanici_ref, { kullanici: e.kullanici_ref, rol: e.rol, gorsel: e.rol === 'Saha Sorumlusu' });
  }
  if (d?.ticari_sorumlu_ref && !l.has(d.ticari_sorumlu_ref)) l.set(d.ticari_sorumlu_ref, { kullanici: d.ticari_sorumlu_ref, rol: 'Ticari Sorumlu', gorsel: false });
  const adlar = new Map((await db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kimlik = ANY($1)`, [[...l.keys()]])).rows.map((r) => [r.kimlik as string, r.ad_soyad as string]));
  return [...l.values()].map((x) => ({ ...x, ad: adlar.get(x.kullanici) ?? '' }));
}

/** YG-1598: katılımcıların ilk ortak boşluğu; mesai 09.00–18.00, Pazartesi–Cumartesi, resmî tatil, onaylı izin ve zorunlu katılımlı toplantılar dışında; en erken bir saat sonra, 10 gün içinde. */
export async function ortakBosluk(db: Db, kisiler: string[], dk = SURE_DK, simdi = new Date()): Promise<Date | null> {
  const ADIM = 30 * 60_000; let t = Math.ceil((simdi.getTime() + 3_600_000) / ADIM) * ADIM; const son = simdi.getTime() + 10 * 86_400_000;
  const gunu = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
  const mesgul = (await db.query(`SELECT t.baslangic, t.sure_dk FROM toplanti_katilimci p JOIN toplanti t ON t.kimlik = p.toplanti_ref WHERE p.kullanici_ref = ANY($1) AND t.durum = 'Planlandı' AND p.katilim = 'Zorunlu' AND t.baslangic < $3 AND t.baslangic + make_interval(mins => t.sure_dk) > $2`, [kisiler, new Date(t), new Date(son)])).rows
    .map((r) => [new Date(r.baslangic).getTime(), new Date(r.baslangic).getTime() + Number(r.sure_dk) * 60_000] as const);
  const izin = (await db.query(`SELECT baslangic::text b, bitis::text s FROM izin_talebi WHERE personel_ref = ANY($1) AND durum = 'Onaylandı' AND bitis >= $2::date AND baslangic <= $3::date`, [kisiler, gunu(t), gunu(son)])).rows as { b: string; s: string }[];
  const tatil = new Set((await db.query(`SELECT tarih::text t FROM resmi_tatil WHERE tarih BETWEEN $1::date AND $2::date`, [gunu(t), gunu(son)])).rows.map((r) => r.t as string));
  for (; t + dk * 60_000 <= son; t += ADIM) {
    const y = new Date(t + IST); const dakika = y.getUTCHours() * 60 + y.getUTCMinutes(); const g = gunu(t);
    if (y.getUTCDay() === 0 || dakika < MESAI[0]! || dakika + dk > MESAI[1]! || tatil.has(g)) continue;
    if (izin.some((x) => x.b <= g && x.s >= g) || mesgul.some(([a, c]) => a < t + dk * 60_000 && c > t)) continue;
    return new Date(t);
  }
  return null;
}

type Madde = { madde: string; uyari: boolean; aciklama: string };
/** YG-1598: sistemce doldurulan kontrol listesi; toplantıda yalnız ⚠ maddeler görüşülür. */
export async function kapsamKontrolListesi(db: Db, dosya: string): Promise<Madde[]> {
  const q = async (sql: string, p: unknown[] = [dosya]) => (await db.query(sql, p)).rows[0] ?? {};
  const yt = await q(`SELECT ihbar_yetki_durumu y FROM talep WHERE dosya_ref = $1 ORDER BY kayda_gecis_zamani LIMIT 1`);
  const bl = await q(`SELECT count(*)::int n, count(*) FILTER (WHERE teyit_bekliyor)::int t FROM bulgu WHERE dosya_ref = $1`);
  const ce = await q(`SELECT kimlik FROM kapsam_cetveli WHERE dosya_ref = $1 AND durum <> 'Yerine Geçti' ORDER BY surum DESC LIMIT 1`);
  const sa = ce.kimlik ? await q(`SELECT count(*)::int n, count(*) FILTER (WHERE olculemez OR miktar <= 0)::int o, count(*) FILTER (WHERE coalesce(trim(kabul_olcutu), '') = '')::int k FROM kapsam_satiri WHERE cetvel_ref = $1`, [ce.kimlik]) : { n: 0, o: 0, k: 0 };
  const tr = await q(`SELECT ek_inceleme_gerekir e, ek_inceleme_alani a, beyan_bulgu_uyumu u FROM teknik_rapor WHERE dosya_ref = $1 AND durum NOT IN ('Reddedildi', 'Geri Çekildi') ORDER BY olusturma_zamani DESC LIMIT 1`);
  const er = await q(`SELECT (SELECT count(*)::int FROM tesis_talebi WHERE dosya_ref = $1 AND durum IN ('Yanıt Bekliyor', 'İzin Verilmedi')) t,
      (SELECT count(*)::int FROM is_emri e WHERE e.dosya_ref = $1 AND e.calisma_izni_gerekli AND NOT EXISTS (SELECT 1 FROM calisma_izni_belgesi c WHERE c.is_emri_ref = e.kimlik)) i`);
  const kl = await q(`SELECT count(DISTINCT k.kimlik)::int n, count(m.kimlik) FILTER (WHERE m.sonuc IN ('Uygun değil', 'Doğrulanamadı'))::int u FROM kontrol_listesi_kaydi k LEFT JOIN kontrol_listesi_maddesi m ON m.kayit_ref = k.kimlik WHERE k.dosya_ref = $1`);
  const fg = await q(`SELECT (SELECT count(*)::int FROM firma_fiyat_kalemi x JOIN firma_fiyat_teklifi t ON t.kimlik = x.teklif_ref WHERE t.dosya_ref = $1 AND x.aralik_disi) a,
      EXISTS (SELECT 1 FROM denetim_izi z JOIN teknik_rapor r ON r.kimlik::text = z.nesne_kimligi WHERE r.dosya_ref = $1 AND z.eylem = 'Firma Raporu Düzeltildi') d`);
  return [
    { madde: 'Yetki', uyari: yt.y !== 'Doğrulandı', aciklama: yt.y === 'Doğrulandı' ? 'İhbar edenin yetkisi doğrulandı.' : `İhbar eden yetkisi: ${yt.y ?? 'kayıt yok'}.` },
    { madde: 'Bulgu', uyari: !bl.n || bl.t > 0, aciklama: !bl.n ? 'Bulgu kaydı yok.' : bl.t ? `${bl.t} bulgu teyit bekliyor.` : `${bl.n} bulgu teyitli.` },
    { madde: 'Ölçüm ve Metraj', uyari: !sa.n || sa.o > 0, aciklama: !sa.n ? 'Metraj satırı yok.' : sa.o ? `${sa.o} satır ölçülemedi veya miktarsız.` : `${sa.n} satır ölçülü.` },
    { madde: 'Teknik Referans', uyari: sa.k > 0 || tr.e === true, aciklama: [sa.k ? `${sa.k} satırda kabul ölçütü yok.` : '', tr.e ? `Ek inceleme gerekiyor: ${tr.a ?? ''}` : ''].filter(Boolean).join(' ') || 'Kabul ölçütleri ve teknik referanslar tamam.' },
    { madde: 'Erişim ve Güvenlik', uyari: er.t > 0 || er.i > 0, aciklama: [er.t ? `${er.t} tesis işlemi yanıt bekliyor veya izin verilmedi.` : '', er.i ? `${er.i} iş emrinde çalışma izni belgesi yok.` : ''].filter(Boolean).join(' ') || 'Tesis erişimi ve çalışma izinlerinde açık konu yok.' },
    { madde: 'Kontrol Çıktısı', uyari: !kl.n || kl.u > 0, aciklama: !kl.n ? 'Kontrol listesi kaydı yok.' : kl.u ? `${kl.u} madde uygun değil veya doğrulanamadı.` : 'Kontrol listesi maddeleri uygun.' },
    { madde: 'Firma Girdisi', uyari: fg.a > 0 || fg.d === true || (tr.u && tr.u !== 'Uyumlu'), aciklama: [fg.a ? `${fg.a} firma fiyat kalemi kartela bandı dışında.` : '', fg.d ? 'Firma raporu Teknik Uzmanca düzeltildi.' : '', tr.u && tr.u !== 'Uyumlu' ? `Beyan ve bulgu: ${tr.u}.` : ''].filter(Boolean).join(' ') || 'Firma raporu ve fiyat girdisi kartela ve rapor ile uyumlu.' },
  ];
}

/** YG-1598: toplantı kapanınca Teknik Rapor ve Metraj kararları Teknik Uzmana görev olur; Teknik Yönetici ve Muhasebe ve Finans Yöneticisine karar özeti gider. Fiyat Teklifi kararları "Fiyat Teklifi Hazırla" görevine yazılır (YG-1599). */
export async function kapsamKararlariniAktar(db: Db, toplanti: string): Promise<number> {
  const t = (await db.query(`SELECT t.kimlik, t.dosya_ref, d.dosya_no FROM toplanti t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1 AND t.tpl_kod = 'TPL-06'`, [toplanti])).rows[0];
  if (!t) return 0;
  let n = 0;
  for (const k of (await db.query(`SELECT kimlik, metin, sorumlu_ref, hedef_tarih::text h, aktarim_hedefi FROM toplanti_karar WHERE toplanti_ref = $1 AND aktarim_hedefi IN ('Teknik Rapor', 'Metraj') AND is_karti_ref IS NULL ORDER BY zaman`, [toplanti])).rows) {
    const kart = await kartAc(db, { tur: 'Kapsam Toplantısı Kararı', kategori: 'gorev', baslik: `${t.dosya_no} · ${k.aktarim_hedefi} Kararı`, ozet: String(k.metin).slice(0, 400), sahipKullanici: k.sorumlu_ref, sonZaman: new Date(`${k.h}T20:59:59Z`), nesneTuru: 'toplanti', nesneKimligi: toplanti });
    await db.query(`UPDATE toplanti_karar SET is_karti_ref = $2 WHERE kimlik = $1`, [k.kimlik, kart]); n++;
  }
  const tum = (await db.query(`SELECT aktarim_hedefi, metin FROM toplanti_karar WHERE toplanti_ref = $1 ORDER BY zaman`, [toplanti])).rows;
  if (tum.length && await birKez(db, 'kapsam_toplantisi_bilgi', toplanti)) {
    const al = [...await rolSahipleri(db, await rolId(db, 'Teknik Yönetici')), ...await rolSahipleri(db, await rolId(db, 'Muhasebe ve Finans Yöneticisi'))];
    if (al.length) await bildir(db, { olay: `tpl06-bilgi:${toplanti}`, kullanicilar: [...new Set(al)], baslik: `${t.dosya_no} · Kapsam Hazırlık Toplantısı Kararları`, ozet: tum.map((x) => `${x.aktarim_hedefi ?? 'Karar'}: ${x.metin}`).join(' · ').slice(0, 400) });
  }
  return n;
}

export function kapsamToplantisiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Dosya bulunamadı veya erişim yetkiniz yok.' });
  const acik = async (dosya: string) => (await b.db.query(`SELECT kimlik, baslangic, sure_dk, durum, gorusme_baglantisi, kontrol_listesi, tutanak, duzenleyen_ref FROM toplanti WHERE dosya_ref = $1 AND tpl_kod = 'TPL-06' AND durum IN ('Planlandı', 'Tamamlandı') ORDER BY baslangic DESC LIMIT 1`, [dosya])).rows[0];

  s.get('/dosya/:id/kapsam-toplantisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const katilimcilar = await kapsamKatilimcilari(b.db, id);
    const t = await acik(id);
    const ds = (await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1 AND dosya_sorumlusu_ref = $2`, [id, o.kullanici])).rowCount === 1;
    const kararlar = t ? (await b.db.query(`SELECT a.kimlik, a.metin, a.aktarim_hedefi, a.hedef_tarih::text hedef, h.ad_soyad sorumlu, k.durum gorev_durumu FROM toplanti_karar a JOIN kullanici_hesabi h ON h.kimlik = a.sorumlu_ref LEFT JOIN is_karti k ON k.kimlik = a.is_karti_ref WHERE a.toplanti_ref = $1 ORDER BY a.zaman`, [t.kimlik])).rows : [];
    return {
      onKosul: await kapsamOnKosullari(b.db, id), katilimcilar, ds, aktarimlar: AKTARIM,
      oneri: t ? null : (await ortakBosluk(b.db, katilimcilar.map((x) => x.kullanici)))?.toISOString() ?? null,
      kontrolListesi: t?.durum === 'Tamamlandı' && t.kontrol_listesi ? t.kontrol_listesi : await kapsamKontrolListesi(b.db, id),
      toplanti: t ? { kimlik: t.kimlik, baslangic: t.baslangic, sureDk: t.sure_dk, durum: t.durum, baglanti: t.gorusme_baglantisi, tutanak: t.tutanak } : null, kararlar,
    };
  });

  // YG-1598: Dosya Sorumlusu önerilen (veya seçtiği) zamanı onaylar; toplantı kontrol listesiyle açılır. Saha Sorumlusu varsa görüntülü katılır.
  s.post('/dosya/:id/kapsam-toplantisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { baslangic?: string; baglanti?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    if (!d) return yok(y);
    if (d.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Kapsam Hazırlık Toplantısını Dosya Sorumlusu onaylar.' });
    const eksik = await kapsamOnKosullari(b.db, id);
    if (eksik.length) return y.code(409).send({ hata: `Toplantı için ön koşullar tamamlanmadı: ${eksik.join(' ')}`, eksik });
    if ((await b.db.query(`SELECT 1 FROM toplanti WHERE dosya_ref = $1 AND tpl_kod = 'TPL-06' AND durum = 'Planlandı'`, [id])).rowCount) return y.code(409).send({ hata: 'Planlanmış Kapsam Hazırlık Toplantısı vardır.' });
    const katilimcilar = await kapsamKatilimcilari(b.db, id);
    if (katilimcilar.some((x) => x.gorsel) && !g.baglanti?.trim()) return y.code(400).send({ hata: 'Saha Sorumlusu toplantıya görüntülü katılır; görüşme bağlantısını giriniz.' });
    const bas = g.baslangic ? new Date(g.baslangic) : await ortakBosluk(b.db, katilimcilar.map((x) => x.kullanici));
    if (!bas || isNaN(bas.getTime()) || bas.getTime() < Date.now() - 60_000) return y.code(400).send({ hata: 'Toplantı için ileri bir zaman seçmenizi rica ederiz.' });
    const kl = await kapsamKontrolListesi(b.db, id);
    const gundem = ['Görüşülecek ⚠ maddeler:', ...kl.filter((x) => x.uyari).map((x) => `⚠ ${x.madde}: ${x.aciklama}`)].join('\n');
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = (await c.query(`INSERT INTO toplanti (tpl_kod, konu, gundem, baslangic, sure_dk, oncelik, duzenleyen_ref, baskan_ref, gorusme_baglantisi, dosya_ref, kontrol_listesi) VALUES ('TPL-06',$1,$2,$3,$4,'Normal',$5,$5,$6,$7,$8) RETURNING kimlik`,
        [`${d.dosya_no} · Kapsam Hazırlık`, gundem, bas, SURE_DK, o.kullanici, g.baglanti?.trim() || null, id, JSON.stringify(kl)])).rows[0].kimlik as string;
      for (const k of katilimcilar) await c.query(`INSERT INTO toplanti_katilimci (toplanti_ref, kullanici_ref, katilim) VALUES ($1,$2,'Zorunlu') ON CONFLICT DO NOTHING`, [t, k.kullanici]);
      if (!katilimcilar.some((k) => k.kullanici === o.kullanici)) await c.query(`INSERT INTO toplanti_katilimci (toplanti_ref, kullanici_ref, katilim) VALUES ($1,$2,'Zorunlu') ON CONFLICT DO NOTHING`, [t, o.kullanici]);
      const saat = bas.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
      const digerleri = katilimcilar.filter((k) => k.kullanici !== o.kullanici);
      if (digerleri.length) await bildir(c, { olay: `tpl-davet:${t}`, kullanicilar: digerleri.map((k) => k.kullanici), baslik: `Toplantı Daveti: ${d.dosya_no} · Kapsam Hazırlık`, ozet: `TPL-06 · ${saat}${g.baglanti?.trim() ? ' · görüntülü bağlantı davette' : ''}`, eposta: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplantı Planlandı', nesneTuru: 'toplanti', nesneKimligi: t, yeni: { kod: 'TPL-06', dosya: id }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: t, baslangic: bas.toISOString() };
    } catch (x) { await c.query('ROLLBACK').catch(() => {}); throw x; } finally { c.release(); }
  });

  // YG-1598: kararı Dosya Sorumlusu toplantı sırasında girer ve aktarım hedefini seçer; sorumlu hedefe göre sistemce belirlenir.
  s.post('/kapsam-toplantisi/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { metin?: string; aktarim?: string; hedef?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT t.kimlik, t.durum, t.duzenleyen_ref, t.dosya_ref, d.ticari_sorumlu_ref, d.dosya_sorumlusu_ref FROM toplanti t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1 AND t.tpl_kod = 'TPL-06'`, [id])).rows[0];
    if (!t || t.duzenleyen_ref !== o.kullanici) return yok(y);
    if (t.durum !== 'Planlandı') return y.code(409).send({ hata: 'Kararlar açık toplantıya eklenir.' });
    if (!g.metin?.trim() || !AKTARIM.includes(g.aktarim ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(g.hedef ?? '')) return y.code(400).send({ hata: 'Karar, aktarım hedefi ve hedef tarih zorunludur.' });
    let sorumlu: string | null = o.kullanici;
    if (g.aktarim === 'Teknik Rapor' || g.aktarim === 'Metraj') sorumlu = (await b.db.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND bitis_zamani IS NULL AND rol = ANY($2) ORDER BY rol DESC LIMIT 1`, [t.dosya_ref, TU_ROLLER])).rows[0]?.kullanici_ref ?? null;
    if (g.aktarim === 'Fiyat Teklifi') sorumlu = t.ticari_sorumlu_ref ?? (await rolSahipleri(b.db, await rolId(b.db, 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)')))[0] ?? null;
    if (!sorumlu) return y.code(409).send({ hata: g.aktarim === 'Fiyat Teklifi' ? 'Dosyada Ticari Sorumlu yoktur.' : 'Dosyada Teknik Uzman yoktur.' });
    const k = (await b.db.query(`INSERT INTO toplanti_karar (toplanti_ref, metin, sorumlu_ref, hedef_tarih, yazan_ref, dosya_ref, aktarim_hedefi) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [id, g.metin.trim(), sorumlu, g.hedef, o.kullanici, t.dosya_ref, g.aktarim])).rows[0].kimlik as string;
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplantı Kararı Yazıldı', nesneTuru: 'toplanti', nesneKimligi: id, yeni: { aktarim: g.aktarim }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: k };
  });
}
