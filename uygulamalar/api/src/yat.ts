import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { sayac } from './sure.js';
import { izinGerekli } from './yetki.js';

type Db = Pool | PoolClient;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ana verideki tür sütunu LST_TEKNE_TURU ile birebir değil; yalnız kesin eşleşenler yat kaydına geçer. */
const TUR_ESLE: [RegExp, string][] = [
  [/^motoryat$|^motor yat$/i, 'Motor Yat'], [/^(kabinli )?yelkenli( yat)?$/i, 'Yelkenli Yat'], [/katamaran.*yelken|yelkenli katamaran/i, 'Katamaran (Yelkenli)'],
  [/katamaran.*motor|motorlu katamaran/i, 'Katamaran (Motorlu)'], [/^gulet$/i, 'Gulet'], [/^trawler$/i, 'Trawler'], [/^sürat teknesi/i, 'Sürat Teknesi'], [/bot \/ rib|şişme bot|\(rib\)/i, 'Şişme Bot / RIB'],
];
export const anaVeriTuru = (t: string | null): string | null => (t ? TUR_ESLE.find(([r]) => r.test(t))?.[1] ?? null : null);

/** YG-926: TCKN algoritması. */
export function tcknGecerli(t: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(t)) return false;
  const h = [...t].map(Number);
  const tek = h[0]! + h[2]! + h[4]! + h[6]! + h[8]!; const cift = h[1]! + h[3]! + h[5]! + h[7]!;
  return ((tek * 7 - cift) % 10 + 10) % 10 === h[9] && h.slice(0, 10).reduce((a, x) => a + x, 0) % 10 === h[10];
}

/** YG-926: vergi numarası kontrol hanesi. */
export function vergiNoGecerli(v: string): boolean {
  if (!/^[0-9]{10}$/.test(v)) return false;
  let top = 0;
  for (let i = 0; i < 9; i++) {
    const x = (Number(v[i]) + 9 - i) % 10;
    const k = x === 9 ? 9 : (x * 2 ** (9 - i)) % 9;
    top += x === 0 ? 0 : k === 0 ? 9 : k;
  }
  return (10 - (top % 10)) % 10 === Number(v[9]);
}

/** YG-1164: kimlik numarası ekranda maskelidir. */
export const maskeTckn = (t: string | null) => (t ? `${t.slice(0, 2)}*******${t.slice(-2)}` : null);

export async function tarafNo(c: Db): Promise<string> { return `TR-${String(await sayac(c, 'taraf')).padStart(6, '0')}`; }

export interface YatGirdisi {
  yatId?: string; adi?: string; tur?: string; markaModelId?: string; markaDiger?: string; modelDiger?: string; boy?: number | null; govde?: string; bayrak?: string;
  kullanim?: string; klas?: string; klasKurulusu?: string; uretimYili?: number | null; turkiyeKalisBitis?: string; govdeNo?: string; imoNo?: string; sicil?: string;
}

/**
 * YG-023, YG-090, YG-1467, YG-1529, YG-1531: tekillik ad yerine gövde no / IMO ile. Eşleşme yoksa geçici kayıt açılır.
 * Modelde kayıtlı boy ve gövde ana veriden "Katalogdan – teyit bekliyor" ile gelir.
 */
export async function yatBulVeyaAc(c: Db, g: YatGirdisi, kullanici: string): Promise<{ kimlik: string; yeni: boolean } | { hata: string }> {
  if (g.yatId) {
    if (!UUID.test(g.yatId) || !(await c.query(`SELECT 1 FROM yat WHERE kimlik = $1`, [g.yatId])).rowCount) return { hata: 'Yat kaydı bulunamadı.' };
    return { kimlik: g.yatId, yeni: false };
  }
  if (!g.adi?.trim()) return { hata: 'Yat adı zorunludur.' };
  const es = g.govdeNo || g.imoNo ? await c.query(`SELECT kimlik FROM yat WHERE lower(govde_no) = lower($1) OR imo_no = $2 LIMIT 1`, [g.govdeNo ?? null, g.imoNo ?? null]) : null;
  if (es?.rows[0]) return { kimlik: es.rows[0].kimlik, yeni: false };
  let mm: { kimlik: string; boy_m: string | null; govde_malzemesi: string | null; tahrik_turu: string | null; tekne_turu: string | null } | undefined;
  if (g.markaModelId) {
    if (!UUID.test(g.markaModelId)) return { hata: 'Marka veya model bulunamadı.' };
    mm = (await c.query(`SELECT kimlik, boy_m, govde_malzemesi, tahrik_turu, tekne_turu FROM yat_marka_model WHERE kimlik = $1`, [g.markaModelId])).rows[0];
    if (!mm) return { hata: 'Marka veya model bulunamadı.' };
  } else if (g.markaDiger === undefined && g.modelDiger === undefined) return { hata: 'Marka ve model seçiniz; listede yoksa "Diğer" ile yazınız.' };
  const anaBoy = mm?.boy_m ? Number(mm.boy_m) : null; const anaGovde = mm?.govde_malzemesi ?? null;
  const boy = anaBoy ?? g.boy ?? null; const govde = anaGovde ?? g.govde ?? 'Bilinmiyor';
  const { rows } = await c.query(
    `INSERT INTO yat (yat_adi, tur, bayrak, kullanim_amaci, klas_durumu, klas_kurulusu, turkiye_kalis_bitis, sicil_bilgisi, govde_no, imo_no, marka_model_ref, marka_diger, model_diger, diger_onay_durumu, katalog_teyit, uretim_yili, tam_boy_m, govde_malzemesi, tahrik_turu, boy_kaynagi, govde_kaynagi, gecici_kayit, olusturan_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,true,$22) RETURNING kimlik`,
    [g.adi.trim(), g.tur ?? anaVeriTuru(mm?.tekne_turu ?? null), g.bayrak ?? null, g.kullanim ?? null, g.klas ?? null, g.klasKurulusu ?? null, g.turkiyeKalisBitis ?? null, g.sicil ?? null, g.govdeNo ?? null, g.imoNo ?? null,
      mm?.kimlik ?? null, g.markaDiger ?? null, g.modelDiger ?? null, mm ? null : 'Bekliyor', mm && (anaBoy !== null || anaGovde) ? 'Katalogdan – teyit bekliyor' : null, g.uretimYili ?? null, boy, govde, mm?.tahrik_turu ?? null,
      boy === null ? null : anaBoy !== null ? 'Ana veri (katalog)' : 'İhbar beyanı', govde === 'Bilinmiyor' ? null : anaGovde ? 'Ana veri (katalog)' : 'İhbar beyanı', kullanici]);
  return { kimlik: rows[0].kimlik, yeni: true };
}

/** YG-094: teknik alan değişiminde kaynak tutulur; YG-090: tarihçe denetim izinde. */
const DUZELTILEBILIR: Record<string, string> = {
  yat_adi: 'yat_adi', tur: 'tur', bayrak: 'bayrak', kullanim_amaci: 'kullanim_amaci', klas_durumu: 'klas_durumu', klas_kurulusu: 'klas_kurulusu', tabi_kod: 'tabi_kod', sicil_bilgisi: 'sicil_bilgisi', govde_no: 'govde_no', imo_no: 'imo_no',
  uretim_yili: 'uretim_yili', tam_boy_m: 'tam_boy_m', genislik_m: 'genislik_m', derinlik_m: 'derinlik_m', tonaj: 'tonaj', govde_tipi: 'govde_tipi', govde_malzemesi: 'govde_malzemesi', tahrik_turu: 'tahrik_turu', turkiye_kalis_bitis: 'turkiye_kalis_bitis', yabanci_yat_belgesi: 'yabanci_yat_belgesi', yabanci_yat_belge_no: 'yabanci_yat_belge_no', yabanci_yat_belge_gecerlilik: 'yabanci_yat_belge_gecerlilik', gecici_ithalat_bitis: 'gecici_ithalat_bitis', cagri_isareti: 'cagri_isareti',
};
const KAYNAKLAR = ['Ruhsat', 'Telefon (kaptan / yat sahibi)', 'Teknik Uzman keşfi', 'İhbar beyanı'];

export function yatYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const ihbarci = { preHandler: izinGerekli(b, 'ihbar.kaydet') };
  const yonetici = { preHandler: izinGerekli(b, 'yat.duzelt') };
  const q = (x: unknown) => String(x ?? '').trim();

  // YG-1527: yazdıkça daralan liste.
  s.get('/yat/marka', oturumlu, async (i) => {
    const a = q((i.query as { q?: string }).q);
    return (await b.db.query(`SELECT marka, min(marka_kodu) AS kod, count(*)::int AS model_sayisi FROM yat_marka_model WHERE $1 = '' OR lower(marka) LIKE lower($1) || '%' OR lower(marka) LIKE '%' || lower($1) || '%' GROUP BY marka ORDER BY lower(marka) LIMIT 30`, [a])).rows;
  });
  s.get('/yat/model', oturumlu, async (i) => {
    const { marka, q: a } = i.query as { marka?: string; q?: string };
    const lgm = i.oturum!.grup === 'LGM İç Rolü'; // YG-1532
    return (await b.db.query(`SELECT kimlik, model, tekne_turu, boy_m, govde_malzemesi FROM yat_marka_model WHERE lower(marka) = lower($1) AND ($2 = '' OR lower(model) LIKE '%' || lower($2) || '%') ORDER BY lower(model) LIMIT 50`, [q(marka), q(a)])).rows.map((r) => (lgm ? { ...r, tur: anaVeriTuru(r.tekne_turu), tekne_turu: undefined, boy_m: r.boy_m === null ? null : Number(r.boy_m) } : { kimlik: r.kimlik, model: r.model }));
  });
  // YG-090: aynı adlı yat uyarısı için arama.
  s.get('/yat/ara', ihbarci, async (i) => {
    const a = q((i.query as { q?: string }).q);
    if (a.length < 2) return [];
    return (await b.db.query(`SELECT y.kimlik, y.yat_adi, y.tur, y.bayrak, y.govde_no, y.sicil_bilgisi, y.tam_boy_m, y.genislik_m, y.derinlik_m, y.govde_malzemesi, y.gecici_kayit, coalesce(m.marka, y.marka_diger) AS marka, coalesce(m.model, y.model_diger) AS model, t.unvan_ad_soyad AS yat_sahibi
      FROM yat y LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref LEFT JOIN taraf t ON t.kimlik = y.yat_sahibi_ref
      WHERE lower(y.yat_adi) LIKE '%' || lower($1) || '%' OR lower(y.govde_no) = lower($1) OR y.imo_no = $1 ORDER BY lower(y.yat_adi) LIMIT 20`, [a])).rows;
  });
  s.post('/yat/:id/duzelt', yonetici, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const { alanlar, kaynak, gerekce } = (i.body ?? {}) as { alanlar?: Record<string, unknown>; kaynak?: string; gerekce?: string };
    if (!UUID.test(id)) return y.code(404).send({ hata: 'Yat kaydı bulunamadı.' });
    if (!gerekce?.trim()) return y.code(400).send({ hata: 'Değişiklik gerekçesi zorunludur.' });
    if (kaynak && !KAYNAKLAR.includes(kaynak)) return y.code(400).send({ hata: 'Bilgi kaynağı geçersiz.' });
    const ad = Object.keys(alanlar ?? {}).filter((a) => DUZELTILEBILIR[a]);
    if (!ad.length) return y.code(400).send({ hata: 'Düzeltilecek alan yok.' }); // Yat değeri ve mülkiyet burada değişmez (YG-116, YG-476).
    const eski = (await b.db.query(`SELECT ${ad.join(',')} FROM yat WHERE kimlik = $1`, [id])).rows[0];
    if (!eski) return y.code(404).send({ hata: 'Yat kaydı bulunamadı.' });
    const kume = ad.map((a, n) => `${a} = $${n + 2}`);
    const degerler: unknown[] = ad.map((a) => alanlar![a] === '' ? null : alanlar![a]);
    if (kaynak && ad.includes('tam_boy_m')) { degerler.push(kaynak); kume.push(`boy_kaynagi = $${degerler.length + 1}`); }
    if (kaynak && ad.includes('govde_malzemesi')) { degerler.push(kaynak); kume.push(`govde_kaynagi = $${degerler.length + 1}`); }
    await b.db.query(`UPDATE yat SET ${kume.join(', ')}, guncelleme_zamani = now() WHERE kimlik = $1`, [id, ...degerler]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yat Kaydı Düzeltildi', nesneTuru: 'Yat', nesneKimligi: id, eski, yeni: alanlar, gerekce: gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  s.get('/taraf/ara', ihbarci, async (i) => {
    const a = q((i.query as { q?: string }).q);
    if (a.length < 2) return [];
    return (await b.db.query(`SELECT kimlik, taraf_no, kisi_turu, musteri_turu, unvan_ad_soyad, telefon, eposta, durum, tckn, vergi_no FROM taraf WHERE lower(unvan_ad_soyad) LIKE '%' || lower($1) || '%' OR vergi_no = $1 OR tckn = $1 ORDER BY lower(unvan_ad_soyad) LIMIT 20`, [a])).rows.map((r) => ({ ...r, tckn: maskeTckn(r.tckn) }));
  });
  s.post('/taraf', ihbarci, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kisiTuru?: string; musteriTuru?: string; ad?: string; tckn?: string; vergiNo?: string; vergiDairesi?: string; telefon?: string; eposta?: string; adres?: string; il?: string; ulke?: string; roller?: string[] };
    if (!['Gerçek kişi', 'Tüzel kişi'].includes(g.kisiTuru ?? '')) return y.code(400).send({ hata: 'Kişi türünü seçiniz.' });
    if (!g.ad?.trim()) return y.code(400).send({ hata: 'Ad soyad veya unvan zorunludur.' });
    // YG-1378: telefon veya e-postadan en az biri; e-posta ve telefon biçimi denetlenir.
    if (!g.telefon?.trim() && !g.eposta?.trim()) return y.code(400).send({ hata: 'Telefon veya e-postadan en az birini giriniz.' });
    if (g.eposta?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.eposta.trim())) return y.code(400).send({ hata: 'E-posta adresi geçersiz.' });
    if (g.telefon?.trim() && !/^\+?[0-9 ()-]{10,20}$/.test(g.telefon.trim())) return y.code(400).send({ hata: 'Telefon numarası geçersiz.' });
    if (g.tckn && !tcknGecerli(g.tckn)) return y.code(400).send({ hata: 'T.C. Kimlik Numarası geçersiz.' });
    if (g.vergiNo && !vergiNoGecerli(g.vergiNo)) return y.code(400).send({ hata: 'Vergi numarası geçersiz.' });
    const es = await b.db.query(`SELECT taraf_no FROM taraf WHERE vergi_no = $1 OR tckn = $2 LIMIT 1`, [g.vergiNo ?? null, g.tckn ?? null]);
    if (es.rows[0]) return y.code(409).send({ hata: `Bu kimlik bilgisiyle kayıt mevcuttur: ${es.rows[0].taraf_no}`, tarafNo: es.rows[0].taraf_no });
    const { rows } = await b.db.query(
      `INSERT INTO taraf (taraf_no, kisi_turu, musteri_turu, unvan_ad_soyad, tckn, vergi_no, vergi_dairesi, telefon, eposta, adres, il, ulke, taraf_rolleri, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING kimlik, taraf_no`,
      [await tarafNo(b.db), g.kisiTuru, g.musteriTuru ?? null, g.ad.trim(), g.tckn ?? null, g.vergiNo ?? null, g.vergiDairesi ?? null, g.telefon ?? null, g.eposta ?? null, g.adres ?? null, g.il ?? null, g.ulke ?? 'TR', g.roller ?? [], o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Taraf Kaydı Açıldı', nesneTuru: 'Taraf', nesneKimligi: rows[0].kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return rows[0];
  });
}
