import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { tamOturumGerekli } from './kimlik.js';
import type { Baglam } from './kimlik.js';
import { izYaz } from './denetim.js';
import { tutar } from './metin.js';

type Db = Pool | PoolClient;
export const KURUMSAL_EPOSTA = 'Sözleşmede Tanımlı Kurumsal E-posta';
const EPOSTA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAHIP = ['Müşteri ve Paydaş İlişkileri Müdürü'];

/**
 * YG-219, YG-1522: e-postayla gelen onay yalnız dosyaya özel onay yetkilisinden (Ek-3), o yoksa yürürlükteki Ek-2 onay adresinden kabul edilir.
 * Süresi geçen yetki ve tek işlem sınırını aşan tutar kabul edilmez. Sorun yoksa null döner.
 */
export async function ek2Engeli(db: Db, dosya: string, gonderen: string | undefined, tutarEur: number, kullanici?: string): Promise<string | null> {
  const adres = gonderen?.trim();
  if (!adres || !EPOSTA.test(adres)) return 'Onayın geldiği e-posta adresini yazmanızı rica ederiz.';
  // YG-1272: benzer alan adlı gönderen kabul edilmez, güvenlik göstergesi açılır.
  if (kullanici) { const u = await (await import('./teyit.js')).benzerAlanKontrolu(db, adres, kullanici, dosya); if (u) return u; }
  const k = (await db.query(`SELECT sigortaci_adi, onay_yetkilisi_eposta, onay_siniri FROM dosya_sigorta_kaydi WHERE dosya_ref = $1`, [dosya])).rows[0];
  if (k?.onay_yetkilisi_eposta) {
    if (k.onay_yetkilisi_eposta.toLowerCase() !== adres.toLowerCase()) return 'Bu dosyada onay, Ek-3\'te tanımlı onay yetkilisinin adresinden bekleniyor.';
    if (k.onay_siniri !== null && tutarEur > Number(k.onay_siniri)) return `Tutar, dosya yetkilisinin ${tutar(Number(k.onay_siniri))} EUR onay sınırının üzerindedir; yetkili makamdan onay bekleniyor.`;
    return null;
  }
  const a = (await db.query(`SELECT a.onay_yetkisi, a.tek_islem_limit_eur, a.gecerlilik_bitis < (now() AT TIME ZONE 'Europe/Istanbul')::date AS doldu FROM sigorta_ek2_surum s LEFT JOIN sigorta_ek2_adres a ON a.surum_ref = s.kimlik AND lower(a.eposta COLLATE "C") = lower($2::text COLLATE "C") WHERE lower(s.sigortaci_adi COLLATE "C") = lower($1::text COLLATE "C") AND s.durum = 'Yürürlükte'`, [k?.sigortaci_adi ?? '', adres])).rows[0];
  if (!a) return 'Bu sigorta şirketinin Ek-2 listesi kayıtlı değildir; YATONET 360, KEP veya e-imza kanalını seçmenizi rica ederiz.';
  if (!a.onay_yetkisi) return 'Bu adres Ek-2 onay listesinde bulunmamaktadır; tanımlı adresten onay bekleniyor.';
  if (a.doldu) return 'Bu adresin yetki süresi dolmuştur; geçerli yetkiliden onay bekleniyor.';
  if (a.tek_islem_limit_eur !== null && tutarEur > Number(a.tek_islem_limit_eur)) return `Tutar, yetkilinin ${tutar(Number(a.tek_islem_limit_eur))} EUR tek işlem sınırının üzerindedir; yetkili makamdan onay bekleniyor.`;
  return null;
}

export function sigortaEk2Yollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, SAHIP])).rowCount);

  s.get('/sigorta-ek2', oturumlu, async (i, y) => {
    if (!(await yetkili(i.oturum!.kullanici))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    const { rows } = await b.db.query(`SELECT s.kimlik, s.sigortaci_adi, s.surum, s.durum, s.bildiren_eposta, s.bildirim_referansi, s.zaman, coalesce((SELECT json_agg(json_build_object('eposta', a.eposta, 'ad', a.ad_soyad, 'gorev', a.gorev, 'onay', a.onay_yetkisi, 'temsilci', a.temsilci, 'limit', a.tek_islem_limit_eur, 'bitis', a.gecerlilik_bitis) ORDER BY a.eposta) FROM sigorta_ek2_adres a WHERE a.surum_ref = s.kimlik), '[]') AS adresler FROM sigorta_ek2_surum s ORDER BY s.sigortaci_adi, s.surum DESC`);
    return rows;
  });

  // YG-1522: değişiklik kayıtlı kurumsal temsilcinin kayıtlı adresinden gelen bildirimle yeni sürüm olur; önceki sürüm korunur, sözleşme değişikliği akışı açılmaz.
  s.post('/sigorta-ek2', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { sigortaci?: string; bildiren?: string; referans?: string; adresler?: { eposta?: string; ad?: string; gorev?: string; onay?: boolean; temsilci?: boolean; limit?: number; bitis?: string }[] };
    if (!(await yetkili(o.kullanici))) return y.code(403).send({ hata: 'Ek-2 listesini Müşteri ve Paydaş İlişkileri Müdürü kaydeder.' });
    const sigortaci = g.sigortaci?.trim();
    if (!sigortaci) return y.code(400).send({ hata: 'Sigorta şirketini yazmanızı rica ederiz.' });
    if (!g.adresler?.length || g.adresler.some((a) => !a.eposta || !EPOSTA.test(a.eposta.trim()) || !a.ad?.trim() || (a.limit !== undefined && !(a.limit > 0)))) return y.code(400).send({ hata: 'Her satır için ad soyad ve geçerli e-posta girmenizi rica ederiz.' });
    if (!g.adresler.some((a) => a.onay)) return y.code(400).send({ hata: 'En az bir onay adresi girmenizi rica ederiz.' });
    if (!g.adresler.some((a) => a.temsilci)) return y.code(400).send({ hata: 'Kurumsal temsilciyi işaretlemenizi rica ederiz.' });
    if (new Set(g.adresler.map((a) => a.eposta!.trim().toLowerCase())).size !== g.adresler.length) return y.code(400).send({ hata: 'Aynı adres bir kez yazılır.' });
    const c = await b.db.connect();
    const dur = async (kod: number, hata: string) => { await c.query('ROLLBACK'); return y.code(kod).send({ hata }); };
    try {
      await c.query('BEGIN');
      const once = (await c.query(`SELECT kimlik, surum, sigortaci_adi FROM sigorta_ek2_surum WHERE lower(sigortaci_adi COLLATE "C") = lower($1::text COLLATE "C") AND durum = 'Yürürlükte' FOR UPDATE`, [sigortaci])).rows[0];
      if (once) {
        if (!g.referans?.trim()) return await dur(400, 'Temsilcinin bildiriminin referansını yazmanızı rica ederiz.');
        if (!(await c.query(`SELECT 1 FROM sigorta_ek2_adres WHERE surum_ref = $1 AND temsilci AND lower(eposta COLLATE "C") = lower($2::text COLLATE "C")`, [once.kimlik, g.bildiren?.trim() ?? ''])).rowCount) return await dur(409, 'Değişiklik, kayıtlı kurumsal temsilcinin kayıtlı adresinden gelen bildirimle yapılır.');
        await c.query(`UPDATE sigorta_ek2_surum SET durum = 'Yerine Geçti' WHERE kimlik = $1`, [once.kimlik]);
      }
      const surum = once ? Number(once.surum) + 1 : 1;
      const r = (await c.query(`INSERT INTO sigorta_ek2_surum (sigortaci_adi, surum, bildiren_eposta, bildirim_referansi, kaydeden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [once?.sigortaci_adi ?? sigortaci, surum, g.bildiren?.trim() || null, g.referans?.trim() || null, o.kullanici])).rows[0];
      for (const a of g.adresler) await c.query(`INSERT INTO sigorta_ek2_adres (surum_ref, eposta, ad_soyad, gorev, onay_yetkisi, temsilci, tek_islem_limit_eur, gecerlilik_bitis) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [r.kimlik, a.eposta!.trim(), a.ad!.trim(), a.gorev?.trim() || null, Boolean(a.onay), Boolean(a.temsilci), a.limit ?? null, a.bitis || null]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Ek-2 Kaydedildi', nesneTuru: 'Sigorta Ek-2', nesneKimligi: r.kimlik, yeni: { sigortaci, surum }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, surum };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-1522: Ek-3'te dosyaya özel onay yetkilisi; boş bırakılırsa Ek-2 geçerli olur.
  s.post('/dosya/:id/ek3-onay-yetkilisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const eposta = ((i.body ?? {}) as { eposta?: string }).eposta?.trim() || null;
    const d = /^[0-9a-f-]{36}$/i.test(id) ? (await b.db.query(`SELECT dosya_sorumlusu_ref, yedek_sorumlu_ref FROM dosya WHERE kimlik = $1`, [id])).rows[0] : null;
    if (!d || (d.dosya_sorumlusu_ref !== o.kullanici && d.yedek_sorumlu_ref !== o.kullanici)) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    if (eposta && !EPOSTA.test(eposta)) return y.code(400).send({ hata: 'Geçerli bir e-posta adresi girmenizi rica ederiz.' });
    const r = await b.db.query(`UPDATE dosya_sigorta_kaydi SET onay_yetkilisi_eposta = $2 WHERE dosya_ref = $1`, [id, eposta]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ek-3 Onay Yetkilisi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { eposta }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { eposta };
  });
}
