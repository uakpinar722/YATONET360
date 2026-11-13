import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy, type Dil } from './metin.js';
import { pdfUret, type BelgeTanim, type Bolum } from './pdf.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let metin: Record<Dil, Record<string, any>> | undefined;

/** Hak türü kutusu: yalnız kayıttan açıkça çıkan tür işaretlenir; "Rehin / ipotek" takyidatı ayrıştırılamadığından kutu boş kalır. */
export function hakTuru(sablon: string, mulkiyet: string | null): string {
  const isaret = mulkiyet === 'Finansal kiralama (leasing)' ? 1 : mulkiyet === 'Kredi / ipotekli' ? 0 : -1;
  return sablon.split('☐').slice(1).map((x, n) => `${n === isaret ? '☒' : '☐'}${x}`).join('').trim();
}

/** YG-729: FR-HUK-003 Lehtar Muvafakat Yazısı örneği (TR/EN); metinler onaylı şablondan (ŞABLONLAR\FR-HUK-003). */
export async function lehtarMuvafakatTanim(db: Db, dosya: string, dil: Dil): Promise<{ dosyaAdi: string; t: BelgeTanim } | null> {
  metin ??= JSON.parse(readFileSync(join(KOK, 'veri', 'sablon', 'lehtar_muvafakat.json'), 'utf8'));
  const M = metin![dil]!;
  const d = (await db.query(`SELECT d.dosya_no, d.konum, y.yat_adi, y.bayrak, y.sicil_bilgisi, y.mulkiyet_turu, coalesce(lt.unvan_ad_soyad, y.lehtar_adi) lehtar, coalesce(m.marka, y.marka_diger) marka, coalesce(m.model, y.model_diger) model
    FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN taraf lt ON lt.kimlik = y.lehtar_ref LEFT JOIN yat_marka_model m ON m.kimlik = y.marka_model_ref WHERE d.kimlik = $1`, [dosya])).rows[0];
  if (!d?.lehtar) return null;
  const malik = (await db.query(`SELECT kisi_adi_soyadi FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [dosya])).rows[0]?.kisi_adi_soyadi as string | undefined;
  const tk = (await db.query(`SELECT teklif_no, bildirilen_sure_gun FROM fiyat_teklifi WHERE dosya_ref = $1 AND teklif_muhatabi <> 'Firma' AND statu NOT IN ('İptal', 'Yerine Geçti', 'Reddedildi') ORDER BY olusturma_zamani DESC LIMIT 1`, [dosya])).rows[0];
  const bolumler: Bolum[] = [
    { baslik: M.muhatap, tur: 'alanlar', numarasiz: true, alanlar: [{ et: M.kime, deger: M.kimeD, genis: true }, { et: M.konu, deger: M.konuD, genis: true }] },
    { baslik: M.b1, tur: 'alanlar', alanlar: [{ et: M.yat, deger: d.yat_adi }, { et: M.marka, deger: [d.marka, d.model].filter(Boolean).join(' · ') }, { et: M.bayrak, deger: [d.bayrak, d.sicil_bilgisi].filter(Boolean).join(' · ') },
      { et: M.ruhsat, deger: null }, { et: M.malik, deger: malik }, { et: M.lgmNo, deger: d.dosya_no }, { et: M.lehtar, deger: d.lehtar }, { et: M.hak, deger: hakTuru(M.hakD, d.mulkiyet_turu) }, { et: M.tescil, deger: null }] },
    { baslik: M.b2, tur: 'tablo', sutunlar: [{ ad: M.no, hiza: 'ort' }, { ad: M.is }, { ad: M.not }],
      satirlar: (M.isler as string[][]).map(([is, not], n) => [n + 1, is, not!.includes('{teklif}') ? (tk ? not!.replace('{teklif}', tk.teklif_no) : null) : not]) },
    { baslik: M.b3, tur: 'alanlar', alanlar: [{ et: M.yer, deger: d.konum }, { et: M.sure, deger: tk?.bildirilen_sure_gun ? `${tk.bildirilen_sure_gun} ${dil === 'en' ? 'days' : 'gün'}` : null }] },
    { baslik: M.b4, tur: 'alanlar', alanlar: [{ et: M.beyan, deger: M.beyanD, genis: true }] },
    { baslik: M.b5, tur: 'alanlar', alanlar: [{ et: M.lehtar, deger: d.lehtar }, { et: M.yetkili, deger: null }, { et: M.tarih, deger: null }, { et: M.imza, deger: '……………………………' }] },
    { baslik: M.b5, tur: 'metin', numarasiz: true, metin: M.not2 },
  ];
  return { dosyaAdi: `${d.dosya_no}-LEHTAR-MUVAFAKAT-${dil.toUpperCase()}.pdf`,
    t: { ad: M.ad, kod: 'FR-HUK-003', no: d.dosya_no, tarih: gunAy(new Date()), surum: 'Rev.1', dil, yat: d.yat_adi, bandEk: [{ et: M.ref, deger: '---' }], bolumler } };
}

export function lehtarMuvafakatYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  // Örnek yazıyı Dosya Sorumlusu lehtara gönderir; gelen muvafakat belgesi /dosya/:id/muvafakat ile girilir.
  s.get('/dosya/:id/lehtar-muvafakat.pdf', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const dil: Dil = (i.query as { dil?: string }).dil === 'en' ? 'en' : 'tr';
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return y.code(404).send({ hata: 'Dosya bulunamadı veya erişim yetkiniz yok.' });
    const v = await lehtarMuvafakatTanim(b.db, id, dil);
    if (!v) return y.code(409).send({ hata: 'Yatta kayıtlı lehtar yoktur.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Lehtar Muvafakat Yazısı Örneği Üretildi', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return y.type('application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(v.dosyaAdi)}"`).send(await pdfUret(v.t));
  });
}
