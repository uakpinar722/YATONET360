import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kapanisKaydet } from './kapanis.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy } from './metin.js';
import type { BelgeTanim, Bolum } from './pdf.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
/** YG-679: çizimi dosyadaki Teknik Uzman hazırlar, Teknik Yönetici onaylar (FR-ONR-012 metraj onayıyla aynı kademe). */
const HAZIRLAYAN = ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)'];
const ONAY_ROL = 'Teknik Yönetici';
const GORSEL = new Set(['png', 'jpg', 'jpeg']);

kapanisKaydet('Teknik Çizim', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') await c.query(`UPDATE teknik_cizim SET durum = 'Onaylı', onaylayan_ref = $2, onay_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi, yapan]);
  else if (karar === 'Gerekçeyle İade Et' || karar === 'Reddet') await c.query(`UPDATE teknik_cizim SET durum = 'Taslak' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
  else if (karar === 'Yeniden Gönder') await c.query(`UPDATE teknik_cizim SET durum = 'Onayda' WHERE kimlik = $1::uuid AND durum = 'Taslak'`, [k.nesne_kimligi]);
});

/** LGM çizim anteti: dosya no, çizim adı/no, hazırlayan ve onaylayan rol, ölçek, tarih; revizyon tablosu ve genel notlar. Sistem notu yazılmaz. */
export async function cizimTanim(db: Db, id: string, gorsel: string | null): Promise<{ t: BelgeTanim; dosyaAdi: string } | null> {
  const c = (await db.query(`SELECT c.*, d.dosya_no, d.yazisma_dili, y.yat_adi FROM teknik_cizim c JOIN dosya d ON d.kimlik = c.dosya_ref LEFT JOIN yat y ON y.kimlik = d.yat_ref WHERE c.kimlik = $1`, [id])).rows[0];
  if (!c) return null;
  const en = c.yazisma_dili === 'İngilizce'; const L = (tr: string, e: string) => (en ? e : tr);
  const rev = (await db.query(`SELECT rev_no, tarih, aciklama FROM teknik_cizim_revizyonu WHERE cizim_ref = $1 ORDER BY rev_no`, [id])).rows;
  const bolumler: Bolum[] = [];
  if (gorsel) bolumler.push({ baslik: c.ad, tur: 'gorsel', src: gorsel, numarasiz: true });
  bolumler.push(
    { baslik: L('Çizim Anteti', 'Title Block'), tur: 'alanlar', numarasiz: true, alanlar: [
      { et: L('Dosya No', 'File No'), deger: c.dosya_no }, { et: L('Çizim Adı', 'Drawing Title'), deger: c.ad }, { et: L('Çizim No', 'Drawing No'), deger: c.cizim_no },
      { et: L('Hazırlayan', 'Prepared by'), deger: L('Teknik Uzman', 'Technical Specialist') }, { et: L('Onaylayan', 'Approved by'), deger: c.durum === 'Onaylı' ? L(ONAY_ROL, 'Technical Manager') : null },
      { et: L('Ölçek', 'Scale'), deger: c.olcek }, { et: L('Tarih', 'Date'), deger: gunAy(c.onay_zamani ?? c.olusturma_zamani) }] },
    { baslik: L('Revizyon Tablosu', 'Revision Table'), tur: 'tablo', numarasiz: true, sutunlar: [{ ad: 'Rev.', hiza: 'ort' }, { ad: L('Tarih', 'Date') }, { ad: L('Açıklama', 'Description') }], satirlar: rev.map((r) => [r.rev_no, gunAy(r.tarih), r.aciklama]) },
    { baslik: L('Genel Notlar', 'General Notes'), tur: 'metin', numarasiz: true, metin: c.genel_notlar ?? '---' },
  );
  return { dosyaAdi: `${c.cizim_no}_Rev${c.revizyon}.pdf`, t: { ad: L('Teknik Çizim', 'Technical Drawing'), no: c.cizim_no, dosyaNo: c.dosya_no, tarih: gunAy(c.onay_zamani ?? c.olusturma_zamani), surum: `Rev.${c.revizyon}`, dil: en ? 'en' : 'tr', yat: c.yat_adi ?? undefined, bolumler } };
}

export function teknikCizimYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const tu = async (dosya: string, k: string) => Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol = ANY($3::text[]) AND bitis_zamani IS NULL`, [dosya, k, HAZIRLAYAN])).rowCount);
  const gorselBelge = async (dosya: string, belge?: string) => (belge && UUID.test(belge) ? (await b.db.query(`SELECT s.uzanti FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik WHERE e.kimlik = $1 AND e.bag_turu = 'Dosya' AND e.bag_kimligi = $2::text ORDER BY s.surum_no DESC LIMIT 1`, [belge, dosya])).rows[0] : undefined);
  const cizim = async (id: string, k: string) => { if (!UUID.test(id)) return undefined; const c = (await b.db.query(`SELECT * FROM teknik_cizim WHERE kimlik = $1`, [id])).rows[0]; return c && (await dosyaErisimi(b.db, k, c.dosya_ref)) ? c : undefined; };

  s.get('/dosya/:id/teknik-cizim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return { hazirlar: await tu(id, o.kullanici), cizimler: (await b.db.query(`SELECT kimlik, cizim_no, ad, olcek, durum, revizyon, hazirlayan_ref = $2 benim FROM teknik_cizim WHERE dosya_ref = $1 ORDER BY cizim_no`, [id, o.kullanici])).rows };
  });
  s.post('/dosya/:id/teknik-cizim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ad?: string; olcek?: string; belge?: string; notlar?: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await tu(id, o.kullanici))) return y.code(403).send({ hata: 'Çizimi dosyadaki Teknik Uzman hazırlar.' });
    if (!g.ad?.trim() || !g.olcek?.trim()) return y.code(400).send({ hata: 'Çizim adı ve ölçek zorunludur (ölçeksiz krokide "Ölçeksiz" yazınız).' });
    const bl = await gorselBelge(id, g.belge); if (!bl || !GORSEL.has(String(bl.uzanti).toLowerCase())) return y.code(400).send({ hata: 'Dosyaya yüklenmiş PNG veya JPG çizim görselini seçiniz.' });
    const d = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    const n = Number((await b.db.query(`SELECT count(*) n FROM teknik_cizim WHERE dosya_ref = $1`, [id])).rows[0].n) + 1;
    const r = (await b.db.query(`INSERT INTO teknik_cizim (cizim_no, dosya_ref, ad, olcek, belge_ref, genel_notlar, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik, cizim_no`,
      [`${d.dosya_no}-CZ${String(n).padStart(2, '0')}`, id, g.ad.trim(), g.olcek.trim(), g.belge, g.notlar?.trim() || null, o.kullanici])).rows[0];
    await b.db.query(`INSERT INTO teknik_cizim_revizyonu (cizim_ref, rev_no, aciklama, hazirlayan_ref) VALUES ($1, 0, $2, $3)`, [r.kimlik, 'İlk yayım', o.kullanici]);
    return r;
  });
  s.post('/teknik-cizim/:id/onaya-gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const c = await cizim((i.params as { id: string }).id, o.kullanici); if (!c) return yok(y);
    if (c.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Onaya çizimi hazırlayan gönderir.' });
    if (c.durum !== 'Taslak') return y.code(409).send({ hata: 'Çizim taslak değildir.' });
    await b.db.query(`UPDATE teknik_cizim SET durum = 'Onayda' WHERE kimlik = $1`, [c.kimlik]);
    await kartAc(b.db, { tur: 'Teknik Çizim', baslik: `${c.cizim_no} · ${c.ad} · Rev.${c.revizyon}`, ozet: `Ölçek: ${c.olcek}`, hazirlayan: o.kullanici, zincir: [await rolId(b.db, ONAY_ROL)], nesneTuru: 'Teknik Çizim', nesneKimligi: c.kimlik });
    return { durum: 'Onayda', gonderilecek: ONAY_ROL };
  });
  // Onaylı çizimde değişiklik yeni revizyonla yapılır; önceki revizyonlar tabloda kalır.
  s.post('/teknik-cizim/:id/revizyon', oturumlu, async (i, y) => {
    const o = i.oturum!; const c = await cizim((i.params as { id: string }).id, o.kullanici); if (!c) return yok(y);
    const g = (i.body ?? {}) as { aciklama?: string; belge?: string; olcek?: string; notlar?: string };
    if (!(await tu(c.dosya_ref, o.kullanici))) return y.code(403).send({ hata: 'Revizyonu dosyadaki Teknik Uzman yapar.' });
    if (c.durum !== 'Onaylı') return y.code(409).send({ hata: 'Revizyon onaylı çizimde açılır.' });
    if (!g.aciklama?.trim()) return y.code(400).send({ hata: 'Revizyon açıklaması zorunludur.' });
    if (g.belge) { const bl = await gorselBelge(c.dosya_ref, g.belge); if (!bl || !GORSEL.has(String(bl.uzanti).toLowerCase())) return y.code(400).send({ hata: 'Dosyaya yüklenmiş PNG veya JPG çizim görselini seçiniz.' }); }
    const rev = c.revizyon + 1;
    await b.db.query(`UPDATE teknik_cizim SET revizyon = $2, durum = 'Taslak', belge_ref = coalesce($3, belge_ref), olcek = coalesce($4, olcek), genel_notlar = coalesce($5, genel_notlar), hazirlayan_ref = $6, onaylayan_ref = NULL, onay_zamani = NULL WHERE kimlik = $1`,
      [c.kimlik, rev, g.belge || null, g.olcek?.trim() || null, g.notlar?.trim() || null, o.kullanici]);
    await b.db.query(`INSERT INTO teknik_cizim_revizyonu (cizim_ref, rev_no, aciklama, hazirlayan_ref) VALUES ($1,$2,$3,$4)`, [c.kimlik, rev, g.aciklama.trim(), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Teknik Çizim Revizyonu', nesneTuru: 'Teknik Çizim', nesneKimligi: c.kimlik, gerekce: g.aciklama.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { revizyon: rev };
  });
  s.get('/teknik-cizim/:id/pdf', oturumlu, async (i, y) => {
    const o = i.oturum!; const c = await cizim((i.params as { id: string }).id, o.kullanici); if (!c) return yok(y);
    let gorsel: string | null = null;
    const sr = (await b.db.query(`SELECT depo_anahtari, uzanti FROM belge_surum WHERE belge_ref = $1 ORDER BY surum_no DESC LIMIT 1`, [c.belge_ref])).rows[0];
    if (sr && b.depo) {
      try {
        const parca: Buffer[] = []; for await (const x of b.depo.bagla(sr.depo_anahtari)) parca.push(x as Buffer);
        gorsel = `data:image/${String(sr.uzanti).toLowerCase() === 'png' ? 'png' : 'jpeg'};base64,${Buffer.concat(parca).toString('base64')}`;
      } catch { gorsel = null; }
    }
    const v = await cizimTanim(b.db, c.kimlik, gorsel); if (!v) return yok(y);
    const { pdfUret } = await import('./pdf.js');
    return y.type('application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(v.dosyaAdi)}"`).send(await pdfUret(v.t));
  });
}
