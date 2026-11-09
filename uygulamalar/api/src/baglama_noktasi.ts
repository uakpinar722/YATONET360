import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const SICIL = ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı'];
const KURAL = ['Serbest', 'Kayıt Şartlı', 'Ücretli', 'Kısıtlı', 'Yasak'];
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** İki koordinat arası kuş uçuşu mesafe (km). */
export function mesafeKm(a: { enlem: number; boylam: number }, b: { enlem: number; boylam: number }): number {
  const r = (x: number) => (x * Math.PI) / 180; const dE = r(b.enlem - a.enlem); const dB = r(b.boylam - a.boylam);
  const h = Math.sin(dE / 2) ** 2 + Math.cos(r(a.enlem)) * Math.cos(r(b.enlem)) * Math.sin(dB / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

/** YG-113: dış firma kuralı teyidi 12 ayı geçen veya hiç teyit edilmemiş aktif tesis için Sicil Sorumlusuna yılda bir görev. */
export async function tesisTeyitIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const yil = simdi.getUTCFullYear(); const rol = await rolId(db, 'Sicil Sorumlusu');
  for (const t of (await db.query(`SELECT t.kimlik, t.tesis_kodu, t.ad FROM firma_tesisi t JOIN kurulus k ON k.kimlik = t.kurulus_ref WHERE t.aktif AND k.kayit_rolu = 'Tesis' AND t.kural_teyit_tarihi IS NOT NULL AND t.kural_teyit_tarihi <= ($1::timestamptz - interval '12 months')::date`, [simdi])).rows) {
    if (!(await birKez(db, 'tesis_kural_teyit', `${t.kimlik}:${yil}`))) continue;
    await kartAc(db, { tur: 'Tesis Kural Teyidi', kategori: 'gorev', baslik: `${t.tesis_kodu} · ${t.ad} · Kural Teyidi`, ozet: 'Dış firma kuralının teyidi 12 ayı geçti.', sahipRol: rol, nesneTuru: 'Tesis', nesneKimligi: t.kimlik }); n++;
  }
  return n;
}

export function baglamaNoktasiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const sicilci = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, SICIL])).rowCount);
  const say = (x: unknown) => (x === undefined || x === null || x === '' ? null : Number(x));

  s.get('/firma-tesis/:id/bilgi', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (i.oturum!.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    return (await b.db.query(`SELECT dis_firma_kurali, kayit_sarti, giris_ucreti_eur, servis_kurulus_ref, kural_teyit_tarihi::text, travel_lift_ton, vinc_ton, azami_boy_m, kara_park_kapasitesi, kapasite_teyit_tarihi::text, izin_turu, izin_no, izin_gecerlilik::text, enlem, boylam FROM firma_tesisi WHERE kimlik = $1`, [id])).rows[0] ?? yok(y);
  });

  s.post('/firma-tesis/:id/bilgi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as Record<string, unknown>;
    if (!UUID.test(id) || !(await sicilci(o.kullanici))) return yok(y);
    if (g.kural && !KURAL.includes(String(g.kural))) return y.code(400).send({ hata: 'Dış firma kuralı geçersizdir.' });
    if (g.kural === 'Kayıt Şartlı' && !String(g.kayitSarti ?? '').trim()) return y.code(400).send({ hata: 'Kayıt şartını yazınız.' });
    if (g.kural === 'Ücretli' && !(Number(g.ucret) >= 0 && g.ucret !== '' && g.ucret !== undefined)) return y.code(400).send({ hata: 'Giriş ücretini yazınız.' });
    for (const k of ['kuralTeyit', 'kapasiteTeyit', 'izinGecerlilik']) if (g[k] && !TARIH.test(String(g[k]))) return y.code(400).send({ hata: 'Tarih geçersizdir.' });
    const sayilar = ['ucret', 'travelLift', 'vinc', 'azamiBoy', 'karaPark', 'enlem', 'boylam'].map((k) => say(g[k]));
    if (sayilar.some((x) => x !== null && (Number.isNaN(x) || (x < 0 && ![sayilar[5], sayilar[6]].includes(x))))) return y.code(400).send({ hata: 'Sayısal alanlar geçersizdir.' });
    if (g.servis && !UUID.test(String(g.servis))) return y.code(400).send({ hata: 'Servis kaydı geçersizdir.' });
    const r = await b.db.query(`UPDATE firma_tesisi SET dis_firma_kurali = $2, kayit_sarti = $3, giris_ucreti_eur = $4, servis_kurulus_ref = $5, kural_teyit_tarihi = $6, travel_lift_ton = $7, vinc_ton = $8, azami_boy_m = $9, kara_park_kapasitesi = $10, kapasite_teyit_tarihi = $11, izin_turu = $12, izin_no = $13, izin_gecerlilik = $14, enlem = $15, boylam = $16 WHERE kimlik = $1 RETURNING tesis_kodu`,
      [id, g.kural || null, String(g.kayitSarti ?? '').trim() || null, sayilar[0], g.servis || null, g.kuralTeyit || null, sayilar[1], sayilar[2], sayilar[3], sayilar[4], g.kapasiteTeyit || null, String(g.izinTuru ?? '').trim() || null, String(g.izinNo ?? '').trim() || null, g.izinGecerlilik || null, sayilar[5], sayilar[6]]);
    if (!r.rowCount) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bağlama Noktası Bilgisi', nesneTuru: 'Tesis', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-115, YG-333: kapasitesi yatın tonaj ve boyunu karşılayan aktif tesisler en yakından sıralanır; dış firmaya yasak tesis önerilmez.
  s.get('/dosya/:id/onerilen-tesisler', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const q = i.query as { enlem?: string; boylam?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT d.konum, d.talep_ref, y.tonaj, y.tam_boy_m FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [id])).rows[0];
    if (!d) return yok(y);
    const tonaj = d.tonaj === null ? null : Number(d.tonaj); const boy = d.tam_boy_m === null ? null : Number(d.tam_boy_m);
    const konum = (await b.db.query(`SELECT enlem, boylam FROM konum_kaydi WHERE talep_ref = $1 AND enlem IS NOT NULL AND boylam IS NOT NULL ORDER BY zaman DESC LIMIT 1`, [d.talep_ref])).rows[0];
    const yer = q.enlem && q.boylam && !Number.isNaN(+q.enlem) && !Number.isNaN(+q.boylam) ? { enlem: +q.enlem, boylam: +q.boylam } : konum ? { enlem: Number(konum.enlem), boylam: Number(konum.boylam) } : null;
    const t = (await b.db.query(`SELECT t.kimlik, t.kurulus_ref, t.tesis_kodu, t.ad, t.il, t.ilce, t.travel_lift_ton, t.vinc_ton, t.azami_boy_m, t.dis_firma_kurali, t.kayit_sarti, t.giris_ucreti_eur, t.kapasite_teyit_tarihi::text, t.izin_gecerlilik::text, t.enlem, t.boylam FROM firma_tesisi t JOIN kurulus k ON k.kimlik = t.kurulus_ref WHERE t.aktif AND k.kayit_rolu = 'Tesis' AND k.ag_statusu = 'Aktif' AND t.dis_firma_kurali IS DISTINCT FROM 'Yasak'`)).rows;
    const kapasiteli = (x: Record<string, any>) => Math.max(Number(x.travel_lift_ton ?? 0), Number(x.vinc_ton ?? 0));
    const uygun = t.filter((x) => (x.travel_lift_ton !== null || x.vinc_ton !== null) && x.azami_boy_m !== null && (tonaj === null || kapasiteli(x) >= tonaj) && (boy === null || Number(x.azami_boy_m) >= boy));
    const konumMetni = String(d.konum ?? '').toLocaleLowerCase('tr');
    const liste = uygun.map((x) => ({ ...x, mesafeKm: yer && x.enlem !== null && x.boylam !== null ? mesafeKm(yer, { enlem: Number(x.enlem), boylam: Number(x.boylam) }) : null, ayniIl: Boolean(x.il) && konumMetni.includes(String(x.il).toLocaleLowerCase('tr')) }))
      .sort((a, c) => (a.mesafeKm ?? 1e9) - (c.mesafeKm ?? 1e9) || Number(c.ayniIl) - Number(a.ayniIl) || String(a.ad).localeCompare(String(c.ad), 'tr'));
    return { tonaj, boy, konumVar: Boolean(yer), eksikOlcu: tonaj === null || boy === null, kapasitesiGirilmemis: t.filter((x) => (x.travel_lift_ton === null && x.vinc_ton === null) || x.azami_boy_m === null).length, tesisler: liste.map(({ enlem: _e, boylam: _b, ...x }) => x) };
  });
}
