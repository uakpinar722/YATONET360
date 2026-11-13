import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { aracAlanlari, formSecilebilir, rolGecer } from './form_katalogu.js';
import { rolId } from './ihbar.js';
import { kapanisKaydet } from './kapanis.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** YG-632: ayrı kayıt tablosu olmayan Ek II araçları; ekranları alan sözlüğünden üretilir. */
export const GENEL_FORMLAR = ['FR-ONR-003', 'FR-ONR-004', 'FR-ONR-007', 'FR-ONR-008', 'FR-ONR-009', 'FR-MLZ-001', 'FR-MLZ-005', 'FR-MLZ-008', 'FR-UYG-006', 'FR-KLT-013'];
/** Sistemin doldurduğu ortak alanlar (sözlükte her form varlığında bulunur). */
const SISTEM = new Set(['kimlik', 'kayit_no', 'dosya', 'sablon_surumu', 'statu', 'hazirlayan', 'onaylayan', 'onay_zamani', 'olusturma_zamani', 'olusturan', 'guncelleme_zamani', 'surum', 'is_emri']);
/** Dosyadaki kayıtlardan seçilen başvuru alanları. */
const REF: Record<string, string> = {
  is_emri: `SELECT kimlik::text id, is_emri_no etiket FROM is_emri WHERE dosya_ref = $1 ORDER BY is_emri_no`,
  uygunsuzluk: `SELECT kimlik::text id, uygunsuzluk_no etiket FROM uygunsuzluk WHERE dosya_ref = $1 ORDER BY uygunsuzluk_no`,
  calisma_izni: `SELECT c.kimlik::text id, concat_ws(' · ', c.izin_turu, c.izin_no) etiket FROM calisma_izni_belgesi c JOIN is_emri e ON e.kimlik = c.is_emri_ref WHERE e.dosya_ref = $1 ORDER BY c.olusturma_zamani`,
  malzeme_giris_kabulu: `SELECT m.kimlik::text id, m.kayit_no etiket FROM malzeme_giris_kabulu m JOIN tedarik_siparisi s ON s.kimlik = m.siparis_ref WHERE s.dosya_ref = $1 ORDER BY m.kayit_no`,
  tedarik_siparisi: `SELECT kimlik::text id, siparis_no etiket FROM tedarik_siparisi WHERE dosya_ref = $1 ORDER BY siparis_no`,
  belge: `SELECT kimlik::text id, ad etiket FROM belge WHERE bag_turu = 'Dosya' AND bag_kimligi = $1::text ORDER BY olusturma_zamani`,
};
let listeler: Map<string, string[]> | undefined;
function liste(kod: string): string[] {
  if (!listeler) {
    listeler = new Map();
    for (const l of readFileSync(join(KOK, 'veri/deger_listeleri.tsv'), 'utf-8').split(/\r?\n/)) { const [k, d] = l.split('\t'); if (k && d) listeler.set(k, [...(listeler.get(k) ?? []), d]); }
  }
  return listeler.get(kod) ?? [];
}
export type FormAlani = { teknik: string; alan: string; tip: string; zorunlu: boolean; kosul: string | null; secenekler?: { id: string; etiket: string }[]; coklu?: boolean; enFazla?: number; aciklama: string };

/** Formun içerik alanları: türüne göre girdi, liste seçenekleri değer listesinden, başvurular dosyadaki kayıtlardan. */
export async function formTanimi(db: Db, kod: string, ad: string, dosya: string | null): Promise<FormAlani[]> {
  const l: FormAlani[] = [];
  for (const x of aracAlanlari(kod, ad)) {
    if (!x.teknik || SISTEM.has(x.teknik)) continue;
    const a: FormAlani = { teknik: x.teknik, alan: x.alan, tip: x.tip, zorunlu: x.zorunlu === 'Zorunlu', kosul: x.zorunlu.startsWith('Koşullu') ? x.zorunlu : null, aciklama: x.aciklama ?? '' };
    const n = /En fazla (\d+)/.exec(x.bicim ?? ''); if (n) a.enFazla = Number(n[1]);
    if (x.tip.startsWith('Liste') && x.liste.startsWith('LST_')) { a.secenekler = liste(x.liste).map((d) => ({ id: d, etiket: d })); a.coklu = x.tip.includes('çok'); }
    if (x.tip === 'Evet/Hayır') a.secenekler = [{ id: 'Evet', etiket: 'Evet' }, { id: 'Hayır', etiket: 'Hayır' }];
    const r = /^→([a-z_]+)/.exec(x.liste ?? '');
    if (x.tip === 'Referans' && r && REF[r[1]!] && dosya) a.secenekler = (await db.query(REF[r[1]!]!, [dosya])).rows;
    l.push(a);
  }
  return l;
}

/** Sözlük kurallarıyla doğrulama; hata metni ya da temizlenmiş veri döner. */
export function formDogrula(alanlar: FormAlani[], v: Record<string, unknown>): { hata: string } | { veri: Record<string, unknown> } {
  const veri: Record<string, unknown> = {};
  for (const a of alanlar) {
    let d = v[a.teknik];
    if (typeof d === 'string') d = d.trim();
    const bos = d === undefined || d === null || d === '' || (Array.isArray(d) && !d.length);
    if (bos) { if (a.zorunlu) return { hata: `${a.alan} zorunludur.` }; continue; }
    if (a.secenekler && (a.tip !== 'Referans' || a.secenekler.length)) {
      const izin = new Set(a.secenekler.map((s) => s.id));
      const dl = a.coklu ? (Array.isArray(d) ? d : [d]) : [d];
      if (dl.some((x) => !izin.has(String(x)))) return { hata: `${a.alan} için listedeki değerlerden birini seçiniz.` };
    }
    if (['Tam sayı', 'Ondalık', 'Para', 'Yüzde'].includes(a.tip) && !Number.isFinite(Number(d))) return { hata: `${a.alan} sayı olmalıdır.` };
    if (a.tip === 'Tarih' && !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return { hata: `${a.alan} tarih olmalıdır.` };
    if (a.enFazla && String(d).length > a.enFazla) return { hata: `${a.alan} en fazla ${a.enFazla} karakter olabilir.` };
    veri[a.teknik] = d;
  }
  return { veri };
}

/** YG-599: FR-KLT-013 onaylanınca her eylem satırı (Eylem | gg.aa.yyyy) sorumlusuna görev olur; sonraki gözden geçirme tarihi takvimin sıklığından kurulur ve görev açılır. */
const SIKLIK: [RegExp, number][] = [[/aylık/i, 1], [/3 ayda bir/i, 3], [/6 ayda bir/i, 6], [/yılda bir|yıllık|her yıl/i, 12]];
export async function gozdenGecirmeIsle(c: Db, id: string) {
  const f = (await c.query(`SELECT kimlik, kayit_no, veriler, hazirlayan_ref, form_kodu FROM form_kaydi WHERE kimlik = $1`, [id])).rows[0];
  if (!f || f.form_kodu !== 'FR-KLT-013') return;
  const v = (f.veriler ?? {}) as Record<string, string>;
  const satirlar = String(v.eylemler ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const [n, s] of satirlar.entries()) {
    const [eylem, tarih] = s.split('|').map((x) => x.trim()); const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(tarih ?? '');
    const son = m ? new Date(`${m[3]}-${m[2]}-${m[1]}T18:00:00+03:00`) : new Date(Date.now() + 30 * 86_400_000);
    await kartAc(c, { tur: 'Gözden Geçirme Eylemi', kategori: 'gorev', baslik: `${f.kayit_no} · Eylem ${n + 1}`, ozet: eylem!.slice(0, 200), sahipKullanici: f.hazirlayan_ref, sonZaman: son, nesneTuru: 'Form Kaydı', nesneKimligi: f.kimlik });
  }
  let sonraki = v.sonraki_tarih ? new Date(v.sonraki_tarih) : null;
  if (!sonraki) {
    const ack = (await c.query(`SELECT aciklama FROM deger_listesi WHERE liste_kodu = 'LST_GOZDEN_GECIRME_TAKVIMI' AND deger = $1`, [v.gozden_gecirme_turu ?? ''])).rows[0]?.aciklama as string | undefined;
    const ay = SIKLIK.find(([r]) => r.test(ack ?? ''))?.[1];
    if (ay) { sonraki = new Date(); sonraki.setMonth(sonraki.getMonth() + ay); await c.query(`UPDATE form_kaydi SET veriler = veriler || jsonb_build_object('sonraki_tarih', $2::text) WHERE kimlik = $1`, [f.kimlik, sonraki.toISOString().slice(0, 10)]); }
  }
  if (sonraki) await kartAc(c, { tur: 'Periyodik Gözden Geçirme', kategori: 'gorev', baslik: `${v.gozden_gecirme_turu ?? 'Gözden Geçirme'} · Sonraki Gözden Geçirme`, ozet: `Önceki kayıt: ${f.kayit_no}`, sahipKullanici: f.hazirlayan_ref, sonZaman: sonraki, nesneTuru: 'Form Kaydı', nesneKimligi: f.kimlik });
}

kapanisKaydet('Form Onayı', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') { await c.query(`UPDATE form_kaydi SET durum = 'Onaylı', onaylayan_ref = $2, onay_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Kontrolde'`, [k.nesne_kimligi, yapan]); await gozdenGecirmeIsle(c, k.nesne_kimligi!); }
  else if (karar === 'Gerekçeyle İade Et' || karar === 'Reddet') await c.query(`UPDATE form_kaydi SET durum = 'Açık', iade_nedeni = $2, guncelleme_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Kontrolde'`, [k.nesne_kimligi, karar]);
  else if (karar === 'Yeniden Gönder') await c.query(`UPDATE form_kaydi SET durum = 'Kontrolde', iade_nedeni = NULL WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

export function genelFormYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const katalog = async (kod: string) => (await b.db.query(`SELECT kod, ad, dolduran, onaylayan, surum, durum FROM form_katalogu WHERE kod = $1`, [kod])).rows[0] as { kod: string; ad: string; dolduran: string | null; onaylayan: string | null; surum: number; durum: string } | undefined;
  const rollerim = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);
  /** Bağlam: firma kullanıcısı kendi iş emrinde; LGM personeli erişebildiği dosyada; dosyasız araçta dolduran veya onaylayan rolü. */
  const baglam = async (o: { kullanici: string; grup: string }, kat: { dolduran: string | null; onaylayan: string | null }, dosya?: string | null, isEmri?: string | null) => {
    if (isEmri) {
      if (!UUID.test(isEmri)) return null;
      const e = (await b.db.query(`SELECT e.kimlik, e.dosya_ref, e.kurulus_ref FROM is_emri e WHERE e.kimlik = $1`, [isEmri])).rows[0]; if (!e) return null;
      if (o.grup === 'LGM İç Rolü') return (await dosyaErisimi(b.db, o.kullanici, e.dosya_ref)) ? { dosya: e.dosya_ref as string, isEmri: e.kimlik as string, kurulus: null } : null;
      if (!/Firma Yetkilisi/.test(kat.dolduran ?? '')) return null;
      return (await b.db.query(`SELECT 1 FROM kurulus_kullanici WHERE kurulus_ref = $1 AND kullanici_ref = $2`, [e.kurulus_ref, o.kullanici])).rowCount ? { dosya: e.dosya_ref as string, isEmri: e.kimlik as string, kurulus: e.kurulus_ref as string } : null;
    }
    if (o.grup !== 'LGM İç Rolü') return null;
    if (dosya) return UUID.test(dosya) && (await dosyaErisimi(b.db, o.kullanici, dosya)) ? { dosya, isEmri: null, kurulus: null } : null;
    const r = await rollerim(o.kullanici);
    return r.some((x) => rolGecer(kat.dolduran, x) || rolGecer(kat.onaylayan, x)) ? { dosya: null, isEmri: null, kurulus: null } : null;
  };

  // Seçim listesi: yalnız yürürlükteki genel araçlar; firma kullanıcısına yalnız firmanın doldurduğu araçlar.
  s.get('/form-genel', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü' && o.grup !== 'İş Birliği Firması') return yok(y);
    const { rows } = await b.db.query(`SELECT kod, ad, dolduran, onaylayan FROM form_katalogu WHERE kod = ANY($1::text[]) AND durum = 'Yürürlükte' ORDER BY kod`, [GENEL_FORMLAR]);
    const q = i.query as { dosyasiz?: string };
    if (q.dosyasiz) return o.grup === 'LGM İç Rolü' ? rows.filter((r) => r.kod === 'FR-KLT-013') : [];
    return o.grup === 'LGM İç Rolü' ? rows.filter((r) => r.kod !== 'FR-KLT-013') : rows.filter((r) => /Firma Yetkilisi/.test(r.dolduran ?? ''));
  });
  s.get('/form/:kod/tanim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { kod } = i.params as { kod: string }; const q = i.query as { dosya?: string; isEmri?: string };
    const k = GENEL_FORMLAR.includes(kod) ? await katalog(kod) : undefined; if (!k) return yok(y);
    const bg = await baglam(o, k, q.dosya, q.isEmri); if (!bg) return yok(y);
    return { kod: k.kod, ad: k.ad, surum: k.surum, secilebilir: k.durum === 'Yürürlükte', dolduran: k.dolduran, onaylayan: k.onaylayan, alanlar: await formTanimi(b.db, kod, k.ad, bg.dosya) };
  });
  s.get('/form-kaydi', oturumlu, async (i, y) => {
    const o = i.oturum!; const q = i.query as { dosya?: string; isEmri?: string };
    if (q.isEmri) { if (!(await baglam(o, { dolduran: 'Firma Yetkilisi', onaylayan: null }, null, q.isEmri))) return yok(y); }
    else if (!q.dosya) {
      // Dosyasız kayıtlar (FR-KLT-013): yalnız aracın dolduran veya onaylayan rolündeki personel görür.
      if (o.grup !== 'LGM İç Rolü') return yok(y);
      const r = await rollerim(o.kullanici); const l = [];
      for (const x of (await b.db.query(`SELECT f.kimlik, f.kayit_no, f.form_kodu, k.ad, f.form_surumu, f.durum, f.iade_nedeni, f.veriler, f.olusturma_zamani, k.dolduran, k.onaylayan FROM form_kaydi f JOIN form_katalogu k ON k.kod = f.form_kodu WHERE f.dosya_ref IS NULL ORDER BY f.olusturma_zamani DESC`)).rows)
        if (r.some((z) => rolGecer(x.dolduran, z) || rolGecer(x.onaylayan, z))) { delete x.dolduran; delete x.onaylayan; l.push(x); }
      return l;
    } else if (!(await baglam(o, { dolduran: null, onaylayan: null }, q.dosya))) return yok(y);
    const { rows } = await b.db.query(`SELECT f.kimlik, f.kayit_no, f.form_kodu, k.ad, f.form_surumu, f.durum, f.iade_nedeni, f.veriler, f.olusturma_zamani FROM form_kaydi f JOIN form_katalogu k ON k.kod = f.form_kodu
      WHERE ($1::uuid IS NULL OR f.is_emri_ref = $1) AND ($2::uuid IS NULL OR f.dosya_ref = $2) ORDER BY f.olusturma_zamani DESC`, [q.isEmri ?? null, q.isEmri ? null : q.dosya]);
    return rows;
  });
  // Kayıt Açık doğar; yalnız yürürlükteki araç seçilir (YG-601); kayıt, doldurulduğu şablon sürümünü taşır.
  s.post('/form-kaydi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kod?: string; dosya?: string; isEmri?: string; veriler?: Record<string, unknown> };
    const k = g.kod && GENEL_FORMLAR.includes(g.kod) ? await katalog(g.kod) : undefined; if (!k) return yok(y);
    const bg = await baglam(o, k, g.dosya, g.isEmri); if (!bg) return yok(y);
    if (!(await formSecilebilir(b.db, k.kod))) return y.code(409).send({ hata: 'Bu araç taslak veya iptal durumundadır; yeni kayıtta kullanılamaz.' });
    if (!bg.dosya && k.kod !== 'FR-KLT-013') return y.code(400).send({ hata: 'Bu form dosyada doldurulur.' });
    const d = formDogrula(await formTanimi(b.db, k.kod, k.ad, bg.dosya), g.veriler ?? {}); if ('hata' in d) return y.code(400).send(d);
    const on = bg.dosya ? (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [bg.dosya])).rows[0].dosya_no : 'LGM';
    const n = Number((await b.db.query(`SELECT count(*) n FROM form_kaydi WHERE form_kodu = $1 AND coalesce(dosya_ref::text, '') = coalesce($2::text, '')`, [k.kod, bg.dosya])).rows[0].n) + 1;
    const r = (await b.db.query(`INSERT INTO form_kaydi (kayit_no, form_kodu, form_surumu, dosya_ref, is_emri_ref, kurulus_ref, veriler, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik, kayit_no`,
      [`${on}-${k.kod}-${String(n).padStart(2, '0')}`, k.kod, k.surum, bg.dosya, bg.isEmri, bg.kurulus, JSON.stringify(d.veri), o.kullanici])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Form Kaydı Açıldı', nesneTuru: k.kod, nesneKimligi: r.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return r;
  });
  const kayit = async (id: string) => (UUID.test(id) ? (await b.db.query(`SELECT f.*, k.ad, k.dolduran, k.onaylayan FROM form_kaydi f JOIN form_katalogu k ON k.kod = f.form_kodu WHERE f.kimlik = $1`, [id])).rows[0] : undefined);
  s.post('/form-kaydi/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await kayit((i.params as { id: string }).id); if (!f) return yok(y);
    if (f.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Kaydı hazırlayan düzeltir.' });
    if (f.durum !== 'Açık') return y.code(409).send({ hata: 'Kontroldeki veya onaylı kayıt değiştirilemez.' });
    const d = formDogrula(await formTanimi(b.db, f.form_kodu, f.ad, f.dosya_ref), ((i.body ?? {}) as { veriler?: Record<string, unknown> }).veriler ?? {}); if ('hata' in d) return y.code(400).send(d);
    await b.db.query(`UPDATE form_kaydi SET veriler = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [f.kimlik, JSON.stringify(d.veri)]);
    return { tamam: true };
  });
  // Kontrole gönderim: onaylayan katalogdan; onaylayan tanımlı değilse kayıt doğrudan onaylı olur.
  s.post('/form-kaydi/:id/gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const f = await kayit((i.params as { id: string }).id); if (!f) return yok(y);
    if (f.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Kaydı hazırlayan gönderir.' });
    if (f.durum !== 'Açık') return y.code(409).send({ hata: 'Kayıt açık değildir.' });
    const roller = (await b.db.query(`SELECT rol_adi FROM rol`)).rows.map((r) => r.rol_adi as string).filter((r) => rolGecer(f.onaylayan, r));
    const rol = roller.sort((a, c) => (f.onaylayan as string).indexOf(a) - (f.onaylayan as string).indexOf(c))[0];
    if (!rol) { await b.db.query(`UPDATE form_kaydi SET durum = 'Onaylı', onay_zamani = now(), guncelleme_zamani = now() WHERE kimlik = $1`, [f.kimlik]); await gozdenGecirmeIsle(b.db, f.kimlik); return { durum: 'Onaylı' }; }
    await b.db.query(`UPDATE form_kaydi SET durum = 'Kontrolde', iade_nedeni = NULL, guncelleme_zamani = now() WHERE kimlik = $1`, [f.kimlik]);
    await kartAc(b.db, { tur: 'Form Onayı', baslik: `${f.kayit_no} · ${f.ad}`, ozet: `Kontrol: ${rol}`, hazirlayan: o.kullanici, zincir: [await rolId(b.db, rol)], nesneTuru: 'Form Kaydı', nesneKimligi: f.kimlik });
    return { durum: 'Kontrolde', gonderilecek: rol };
  });
}
