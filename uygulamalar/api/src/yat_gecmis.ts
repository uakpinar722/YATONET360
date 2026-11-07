import type { FastifyInstance, FastifyReply } from 'fastify';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/**
 * YG-095: yatın önceki onarım geçmişi (aynı yatın diğer dosyaları, kapanma nedeni, onaylı teknik raporları) dosya ekranında görünür.
 * Dosyaya erişimi olan LGM personeli görür; firma ve maliyet bilgisi listelenmez.
 */
export function yatGecmisYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/dosya/:id/yat-gecmisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const dosyalar = (await b.db.query(`SELECT d.kimlik, d.dosya_no, d.bildirim_tarihi::text, d.kisa_teknik_tanim, d.statu, d.kapanma_nedeni, d.kapanis_zamani
      FROM dosya d WHERE d.yat_ref = (SELECT yat_ref FROM dosya WHERE kimlik = $1) AND d.kimlik <> $1 ORDER BY d.bildirim_tarihi DESC NULLS LAST LIMIT 50`, [id])).rows;
    const raporlar = (await b.db.query(`SELECT r.kimlik, r.rapor_no, r.rapor_turu, r.dosya_ref FROM teknik_rapor r WHERE r.durum = 'Onaylı' AND r.dosya_ref = ANY($1::uuid[]) ORDER BY r.rapor_no`, [dosyalar.map((d) => d.kimlik)])).rows;
    return dosyalar.map((d) => ({ ...d, raporlar: raporlar.filter((r) => r.dosya_ref === d.kimlik).map((r) => ({ kimlik: r.kimlik, raporNo: r.rapor_no, tur: r.rapor_turu })) }));
  });
}
