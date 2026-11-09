import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { dilKod, rolId, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy, metinGetir } from './metin.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

type Db = PoolClient | Pool;
const KART = 'Teslim Süresi Değerlendirmesi'; const GEC = 'Teslim Süresi Değerlendirmesi Gecikti';
const KARAR_ROL = ['Dosya Sorumlusu', 'Yedek Sorumlu', 'Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)'];
export const gunMetni = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });

/** D-001: bugünden sonra hedefe kadar kalan iş günü (Pazar ve resmî tatil yok, arife yarım). Hedef geçmişse 0. */
export async function kalanIsGunu(db: Db, simdi: Date, hedef: string): Promise<number> {
  const r = (await db.query(`SELECT to_char(tarih, 'YYYY-MM-DD') t, yarim_gun FROM resmi_tatil`)).rows;
  const tatil = new Set(r.filter((x) => !x.yarim_gun).map((x) => x.t as string)); const arife = new Set(r.filter((x) => x.yarim_gun).map((x) => x.t as string));
  const x = new Date(`${gunMetni(simdi)}T12:00:00Z`); let k = 0;
  for (;;) { x.setUTCDate(x.getUTCDate() + 1); const t = x.toISOString().slice(0, 10); if (t > hedef) return k; if (x.getUTCDay() !== 0 && !tatil.has(t)) k += arife.has(t) ? 0.5 : 1; }
}

/** Onarım iş emri başlayınca teslim tarihi gerçek başlangıçtan hesaplanır; dosyanın geçerli tahmini tarihini döndürür. */
export async function teslimTarihiKur(c: Db, e: { is_emri_turu: string; dosya_ref: string; teklif_ref: string | null }, simdi = new Date()): Promise<string | null> {
  const m = (await c.query(`SELECT tahmini_teslim_tarihi::text t FROM dosya WHERE kimlik = $1`, [e.dosya_ref])).rows[0]?.t as string | null;
  if (m || e.is_emri_turu !== 'ON' || !e.teklif_ref) return m ?? null;
  const n = (await c.query(`SELECT bildirilen_sure_gun n FROM fiyat_teklifi WHERE kimlik = $1`, [e.teklif_ref])).rows[0]?.n as number | null;
  if (!n) return null;
  const t = gunMetni(await isGunuSonu(c, simdi, n));
  await c.query(`UPDATE dosya SET tahmini_teslim_tarihi = $2, ilk_tahmini_teslim_tarihi = $2 WHERE kimlik = $1`, [e.dosya_ref, t]);
  return t;
}

/** SRE-1: 5 iş günü kala değerlendirme görevi; 3 iş günü kala hâlâ değerlendirilmemişse Operasyon Müdürüne uyarı. Her tarih için bir kez. */
export async function teslimSureIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  for (const d of (await db.query(`SELECT d.kimlik, d.dosya_no, d.dosya_sorumlusu_ref, d.tahmini_teslim_tarihi::text t FROM dosya d WHERE d.statu = 'Aktif' AND d.tahmini_teslim_tarihi IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teslim_kaydi k WHERE k.dosya_ref = d.kimlik AND k.durum LIKE 'Teslim Edildi%') AND NOT EXISTS (SELECT 1 FROM teslim_sure_degerlendirmesi v WHERE v.dosya_ref = d.kimlik AND v.hedef_tarih = d.tahmini_teslim_tarihi)`)).rows) {
    const kalan = await kalanIsGunu(db, simdi, d.t);
    if (kalan > 5) continue;
    if (d.dosya_sorumlusu_ref && await birKez(db, 'teslim_degerlendirme', `${d.kimlik}:${d.t}`)) { await kartAc(db, { tur: KART, kategori: 'gorev', baslik: `${d.dosya_no} · Teslim Süresi Değerlendirmesi`, ozet: `Teslim tarihi ${gunAy(d.t)}; uzama varsa en geç 3 iş günü kala taraflara bildirilmelidir.`, oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: d.kimlik }); n++; }
    if (kalan <= 3 && await birKez(db, 'teslim_degerlendirme_gec', `${d.kimlik}:${d.t}`)) await kartAc(db, { tur: GEC, kategori: 'gorev', baslik: `${d.dosya_no} · Teslim Süresi Değerlendirilmedi`, ozet: `Teslim tarihi ${gunAy(d.t)}; değerlendirme yapılmadı.`, oncelik: 'Yüksek', sahipRol: await rolId(db, 'Operasyon Müdürü'), nesneTuru: 'Dosya', nesneKimligi: d.kimlik });
  }
  return n;
}

export function teslimSureYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (d: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = ANY($3) AND bitis_zamani IS NULL`, [d, k, KARAR_ROL])).rowCount);

  s.get('/dosya/:id/teslim-sure', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT tahmini_teslim_tarihi::text tahmini, ilk_tahmini_teslim_tarihi::text ilk FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    return { ...d, kalan: d.tahmini ? await kalanIsGunu(b.db, new Date(), d.tahmini) : null, karar: await yetkili(id, o.kullanici), gecmis: (await b.db.query(`SELECT hedef_tarih::text, sonuc, ek_is_gunu, yeni_tarih::text, gerekce, gec_bildirim, olusturma_zamani FROM teslim_sure_degerlendirmesi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`, [id])).rows };
  });

  // SRE-1: uzamada gerekçe ve ek iş günü zorunlu; yeni tarih takvimden hesaplanır; BLD-03 yat sahibine ve sigortaya gider.
  s.post('/dosya/:id/teslim-sure', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; ekGun?: unknown; gerekce?: string };
    if (!UUID.test(id) || !(await yetkili(id, o.kullanici))) return yok(y);
    if (!['Uzama Yok', 'Uzama Var'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Değerlendirme sonucunu seçiniz.' });
    const ek = Number(g.ekGun); const uz = g.sonuc === 'Uzama Var';
    if (uz && (!Number.isInteger(ek) || ek <= 0 || !g.gerekce?.trim())) return y.code(400).send({ hata: 'Uzamada ek iş günü ve gerekçe zorunludur.' });
    if (uz && (await b.db.query(`SELECT 1 FROM is_emri e JOIN kurulus k ON k.kimlik = e.kurulus_ref WHERE e.dosya_ref = $1 AND position(lower(k.ticari_unvan) in lower($2)) > 0 LIMIT 1`, [id, g.gerekce])).rowCount) return y.code(400).send({ hata: 'Gerekçe taraflara iletilir; firma adı yazılamaz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`SELECT d.dosya_no, d.yazisma_dili, d.vefat_isareti, d.tahmini_teslim_tarihi::text t, y.yat_adi FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1 FOR UPDATE OF d`, [id])).rows[0];
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      if (!d.t) return dur(409, 'Bu dosyada tahmini teslim tarihi yoktur.');
      if ((await c.query(`SELECT 1 FROM teslim_sure_degerlendirmesi WHERE dosya_ref = $1 AND hedef_tarih = $2`, [id, d.t])).rowCount) return dur(409, 'Bu teslim tarihi değerlendirilmiştir.');
      const simdi = new Date(); const gec = uz && (await kalanIsGunu(c, simdi, d.t)) < 3;
      const yeni = uz ? gunMetni(await isGunuSonu(c, new Date(`${d.t}T09:00:00Z`), ek)) : null;
      const r = (await c.query(`INSERT INTO teslim_sure_degerlendirmesi (dosya_ref, hedef_tarih, sonuc, ek_is_gunu, yeni_tarih, gerekce, gec_bildirim, karar_veren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [id, d.t, g.sonuc, uz ? ek : null, yeni, g.gerekce?.trim() || null, gec, o.kullanici])).rows[0];
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = ANY($2::text[]) AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id, [KART, GEC]]);
      if (uz) {
        await c.query(`UPDATE dosya SET tahmini_teslim_tarihi = $2 WHERE kimlik = $1`, [id, yeni]);
        const alan = { Yat: d.yat_adi, Yacht: d.yat_adi, neden: g.gerekce!.trim(), reason: g.gerekce!.trim(), 'eski tarih': gunAy(d.t), 'old date': gunAy(d.t), 'yeni tarih': gunAy(yeni!), 'new date': gunAy(yeni!), 'bağlantı': b.webAdresi, link: b.webAdresi };
        if (!d.vefat_isareti) {
          const t = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [id])).rows[0];
          if (t) await yatTarafinaYaz(c, { olay: `bld03:${r.kimlik}`, kod: 'BLD-03', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} Teslim Tarihi`, telefon: t.telefon, eposta: t.eposta, alanlar: alan });
        }
        const sg = (await c.query(`SELECT coalesce(s.onay_yetkilisi_eposta, p.eposta) eposta FROM dosya_sigorta_kaydi s LEFT JOIN dosya_tarafi p ON p.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1 LIMIT 1`, [id])).rows[0];
        if (sg) await (await import('./sigorta_gonderim.js')).sigortayaHazirla(c, { dosya: id, tur: 'BLD-03', nesne: r.kimlik, alici: sg.eposta ?? null, konu: `${d.dosya_no} Teslim Tarihi`, metin: await metinGetir(c, 'BLD-03', dilKod(d.yazisma_dili), alan), acil: true, sorumlu: o.kullanici });
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teslim Süresi Değerlendirildi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { sonuc: g.sonuc, yeni, gec }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { sonuc: g.sonuc, yeniTarih: yeni, gecBildirim: gec };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
