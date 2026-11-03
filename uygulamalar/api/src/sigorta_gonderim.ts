import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { disGonder } from './bildirim.js';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

type Db = Pool | PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // belge.ts bu modülü yükler; yat.ts üzerinden döngü kurulmaz
export interface GonderimSatiri { kimlik: string; dosya_ref: string | null; tur: string; nesne_kimligi: string; alici: string | null; konu: string; metin: string | null; acil: boolean; veri: Record<string, unknown>; sorumlu_ref: string | null }
type Isleyici = (c: PoolClient, r: GonderimSatiri, kim: string) => Promise<{ metin?: string; ekli?: boolean; sonuc?: Record<string, unknown> } | void>;
const ISLEYICI = new Map<string, Isleyici>();
/** Gönderimin iş sonucu (teklifin Gönderildi olması gibi) yalnız ikinci teyitte çalışır. */
export function gonderimIsleyici(tur: string, f: Isleyici) { ISLEYICI.set(tur, f); }

/** E-posta bir dosyanın sigorta tarafına aitse kayıtlıdır; doğrudan gönderim engeli ve belge paylaşımı bunu kullanır. */
export async function sigortaAdresi(db: Db, eposta: string): Promise<{ dosya: string } | null> {
  const r = (await db.query(`SELECT s.dosya_ref FROM dosya_sigorta_kaydi s JOIN dosya_tarafi t ON t.kimlik = s.sigorta_taraf_ref WHERE lower(t.eposta COLLATE "C") = lower($1::text COLLATE "C") ORDER BY s.olusturma_zamani DESC LIMIT 1`, [eposta])).rows[0];
  return r ? { dosya: r.dosya_ref } : null;
}

/**
 * K-241: sigortaya giden her şey önce buraya yazılır, gönderilmez. sorumlu verilirse son gönderen odur;
 * verilmezse (sistemin kendiliğinden ürettiği ileti) dosyanın Dosya Sorumlusu veya Yedek Sorumlusu teyit eder.
 */
/** Adres yoksa ileti sessizce atlanmaz: Dosya Sorumlusuna bir kez görev açılır, adres girilince kapanır. */
export async function sigortaAdresiBekleniyor(c: Db, dosya: string): Promise<void> {
  const d = (await c.query(`SELECT dosya_no, dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  if (!d?.dosya_sorumlusu_ref) return;
  if ((await c.query(`SELECT 1 FROM is_karti WHERE tur = 'Sigorta Adresi Bekleniyor' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı' LIMIT 1`, [dosya])).rowCount) return;
  await kartAc(c, { tur: 'Sigorta Adresi Bekleniyor', kategori: 'gorev', baslik: `${d.dosya_no} · Sigorta E-posta Adresi Bekleniyor`, ozet: 'Sigorta şirketine ileti gönderilemedi; adresi dosya ayrıntısından girmenizi rica ederiz.', oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: dosya });
}

export async function sigortayaHazirla(c: Db, g: { dosya?: string | null; tur: string; nesne: string; alici?: string | null; konu: string; metin?: string | null; acil?: boolean; veri?: object; sorumlu?: string | null; sonZaman?: Date | null }): Promise<string> {
  const var_ = (await c.query(`SELECT kimlik FROM sigorta_gonderim WHERE tur = $1 AND nesne_kimligi = $2 AND durum IN ('Teyit Bekliyor', 'Birinci Teyit')`, [g.tur, g.nesne])).rows[0];
  if (var_) return var_.kimlik;
  const r = (await c.query(`INSERT INTO sigorta_gonderim (dosya_ref, tur, nesne_kimligi, alici, konu, metin, acil, veri, sorumlu_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`, [g.dosya ?? null, g.tur, g.nesne, g.alici ?? null, g.konu, g.metin ?? null, Boolean(g.acil), JSON.stringify(g.veri ?? {}), g.sorumlu ?? null])).rows[0];
  const sahip = g.sorumlu ?? (g.dosya ? (await c.query(`SELECT dosya_sorumlusu_ref FROM dosya WHERE kimlik = $1`, [g.dosya])).rows[0]?.dosya_sorumlusu_ref : null);
  if (sahip) await kartAc(c, { tur: 'Sigortaya Gönderim Teyidi', kategori: 'islem', baslik: `${g.konu} · Sigortaya Gönderim Teyidi`, oncelik: 'Yüksek', sahipKullanici: sahip, sonZaman: g.sonZaman ?? undefined, nesneTuru: 'Sigorta Gönderimi', nesneKimligi: r.kimlik });
  return r.kimlik;
}

export function sigortaGonderimYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (r: { sorumlu_ref: string | null; dosya_ref: string | null }, k: string) => {
    if (r.sorumlu_ref) return r.sorumlu_ref === k;
    if (!r.dosya_ref) return false;
    const d = (await b.db.query(`SELECT dosya_sorumlusu_ref, yedek_sorumlu_ref FROM dosya WHERE kimlik = $1`, [r.dosya_ref])).rows[0];
    return d?.dosya_sorumlusu_ref === k || d?.yedek_sorumlu_ref === k;
  };
  // İkili teyit veren kişi nelerin gideceğini görür (V-80).
  const ekListesi = async (r: { tur: string; nesne_kimligi: string; dosya_ref: string | null }) => {
    if (r.tur !== 'Fiyat Teklifi') return [] as string[];
    const t = (await b.db.query(`SELECT teklif_no FROM fiyat_teklifi WHERE kimlik = $1`, [r.nesne_kimligi])).rows[0];
    const ra = (await b.db.query(`SELECT e.ad FROM belge_uretim u JOIN belge e ON e.kimlik = u.belge_ref WHERE u.dosya_ref = $1 AND u.tur = 'Teknik Rapor' AND u.durum = 'Üretildi' ORDER BY u.olusturma_zamani DESC LIMIT 1`, [r.dosya_ref])).rows[0];
    return [`Fiyat Teklifi ${t?.teklif_no ?? ''}.pdf`, ...(ra ? [`${ra.ad}.pdf`] : [])];
  };
  const satirlar = async (k: string, dosya?: string) => {
    const { rows } = await b.db.query(`SELECT kimlik, dosya_ref, tur, nesne_kimligi, alici, konu, metin, durum, sorumlu_ref, birinci_teyit_ref FROM sigorta_gonderim WHERE durum IN ('Teyit Bekliyor', 'Birinci Teyit') AND ($1::uuid IS NULL OR dosya_ref = $1) ORDER BY olusturma_zamani`, [dosya ?? null]);
    const l = []; for (const r of rows) if (await yetkili(r, k)) l.push({ kimlik: r.kimlik, tur: r.tur, alici: r.alici ?? 'Sigorta Portalı', konu: r.konu, metin: r.metin, durum: r.durum, benimBirinci: r.birinci_teyit_ref === k, ekler: await ekListesi(r), onizleme: r.tur === 'Fiyat Teklifi' });
    return l;
  };
  s.get('/sigorta-gonderim', oturumlu, async (i, y) => {
    const { dosya } = i.query as { dosya?: string };
    if (dosya && !UUID.test(dosya)) return yok(y);
    return satirlar(i.oturum!.kullanici, dosya);
  });
  // Gönderimden önce teklif PDF'i görülür; önizleme dosyaya kaydedilmez, doğrulama kodu taşımaz.
  s.get('/sigorta-gonderim/:id/onizleme', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const r = (await b.db.query(`SELECT kimlik, dosya_ref, tur, nesne_kimligi, sorumlu_ref FROM sigorta_gonderim WHERE kimlik = $1`, [id])).rows[0];
    if (!r || r.tur !== 'Fiyat Teklifi' || !(await yetkili(r, i.oturum!.kullanici))) return yok(y);
    const { teklifTanim } = await import('./belge_uret.js'); const { pdfUret } = await import('./pdf.js');
    const v = await teklifTanim(b.db, r.nesne_kimligi, 'ÖNİZLEME', b.webAdresi);
    return y.type('application/pdf').header('Content-Disposition', `inline; filename="onizleme.pdf"`).send(await pdfUret(v.t));
  });
  // YG-443: sigorta şirketinin e-posta adresini dosya sorumlusu girer; bekleyen gönderimler yeni adrese yeniden teyit ister.
  s.post('/dosya/:id/sigorta-eposta', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const eposta = ((i.body ?? {}) as { eposta?: string }).eposta?.trim();
    if (!UUID.test(id) || !(await yetkili({ dosya_ref: id, sorumlu_ref: null }, o.kullanici))) return yok(y);
    if (!eposta || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eposta)) return y.code(400).send({ hata: 'Geçerli bir e-posta adresi girmenizi rica ederiz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const k = (await c.query(`SELECT sigorta_taraf_ref, sigortaci_adi FROM dosya_sigorta_kaydi WHERE dosya_ref = $1 FOR UPDATE`, [id])).rows[0];
      if (!k) { await c.query('ROLLBACK'); return yok(y); }
      if (k.sigorta_taraf_ref) await c.query(`UPDATE dosya_tarafi SET eposta = $2 WHERE kimlik = $1`, [k.sigorta_taraf_ref, eposta]);
      else {
        const t = (await c.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, eposta, olusturan_ref) VALUES ($1,'Sigorta Şirketi',$2,$3,$4) RETURNING kimlik`, [id, k.sigortaci_adi ?? 'Sigorta Şirketi', eposta, o.kullanici])).rows[0];
        await c.query(`UPDATE dosya_sigorta_kaydi SET sigorta_taraf_ref = $2 WHERE dosya_ref = $1`, [id, t.kimlik]);
      }
      await c.query(`UPDATE sigorta_gonderim SET alici = $2, durum = 'Teyit Bekliyor', birinci_teyit_ref = NULL, birinci_teyit_zamani = NULL WHERE dosya_ref = $1 AND durum IN ('Teyit Bekliyor', 'Birinci Teyit') AND tur <> 'Belge Paylaşımı'`, [id, eposta]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Sigorta Adresi Bekleniyor' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı'`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta E-posta Adresi Girildi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { eposta }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { eposta };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  // K-241: birinci teyit göndermez; ikinci teyit aynı kişiden, ayrı istekle ve bekleme süresinden sonra gelir.
  s.post('/sigorta-gonderim/:id/teyit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { adim } = (i.body ?? {}) as { adim?: number };
    if (!UUID.test(id) || (adim !== 1 && adim !== 2)) return y.code(400).send({ hata: 'Teyit adımı geçersizdir.' });
    const c = await b.db.connect();
    const dur = async (kod: number, hata: string) => { await c.query('ROLLBACK'); return y.code(kod).send({ hata }); };
    try {
      await c.query('BEGIN');
      const r = (await c.query(`SELECT * FROM sigorta_gonderim WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      if (!r || !(await yetkili(r, o.kullanici))) { await c.query('ROLLBACK'); return yok(y); }
      if (r.durum === 'Gönderildi' || r.durum === 'İptal') return dur(409, 'Bu gönderim sonuçlanmıştır.');
      if (adim === 1) {
        await c.query(`UPDATE sigorta_gonderim SET durum = 'Birinci Teyit', birinci_teyit_ref = $2, birinci_teyit_zamani = now() WHERE kimlik = $1`, [id, o.kullanici]);
        await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Gönderimi Birinci Teyit', nesneTuru: r.tur, nesneKimligi: r.nesne_kimligi, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
        await c.query('COMMIT');
        return { durum: 'Birinci Teyit', alici: r.alici ?? 'Sigorta Portalı', konu: r.konu, metin: r.metin };
      }
      if (r.durum !== 'Birinci Teyit') return dur(409, 'Önce birinci teyit verilmelidir.');
      if (r.birinci_teyit_ref !== o.kullanici) return dur(403, 'İkinci teyidi birinci teyidi veren kişi verir.');
      const bekle = Number((await c.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'sigorta_teyit_bekleme_sn'`)).rows[0]?.deger ?? 2);
      if ((Date.now() - new Date(r.birinci_teyit_zamani).getTime()) / 1000 < bekle) return dur(409, 'Metni okuyup yeniden teyit ediniz.');
      const is = await ISLEYICI.get(r.tur)?.(c, r, o.kullanici);
      const metin = is?.metin ?? r.metin;
      if (r.alici && metin && !is?.ekli) await disGonder(c, { olay: `sigorta:${id}`, eposta: r.alici, konu: r.konu, metin, acil: r.acil, sigortaTeyitli: true });
      await c.query(`UPDATE sigorta_gonderim SET durum = 'Gönderildi', metin = $2, ikinci_teyit_zamani = now() WHERE kimlik = $1`, [id, metin]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Sigortaya Gönderim Teyidi' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı'`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Gönderimi İkinci Teyit', nesneTuru: r.tur, nesneKimligi: r.nesne_kimligi, yeni: { alici: r.alici }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { durum: 'Gönderildi', ...(is?.sonuc ?? {}) };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.post('/sigorta-gonderim/:id/iptal', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { gerekce } = (i.body ?? {}) as { gerekce?: string };
    if (!UUID.test(id)) return yok(y);
    const r = (await b.db.query(`SELECT * FROM sigorta_gonderim WHERE kimlik = $1`, [id])).rows[0];
    if (!r || !(await yetkili(r, o.kullanici))) return yok(y);
    if (!gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    const u = await b.db.query(`UPDATE sigorta_gonderim SET durum = 'İptal', iptal_gerekcesi = $2 WHERE kimlik = $1 AND durum IN ('Teyit Bekliyor', 'Birinci Teyit')`, [id, gerekce.trim()]);
    if (!u.rowCount) return y.code(409).send({ hata: 'Bu gönderim sonuçlanmıştır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Sigortaya Gönderim Teyidi' AND nesne_kimligi = $1 AND durum <> 'Tamamlandı'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Gönderimi İptal', nesneTuru: r.tur, nesneKimligi: r.nesne_kimligi, yeni: { gerekce }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { durum: 'İptal' };
  });
}
