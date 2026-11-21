import type { FastifyInstance } from 'fastify';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/** YG-160: onay kayıt türleri; her biri kendi kaynak kaydından gelir (talimat, kapsam onayı, teklif ve sigorta kararı, değişiklik protokolü, teslim). */
export const ONAY_KAYIT_TURLERI = ['Talimat', 'Teknik Onay', 'Bedel Kabulü', 'Değişiklik Onayı', 'Teslim Kabulü'] as const;

export function onayKaydiYollari(s: FastifyInstance, b: Baglam) {
  s.get('/dosya/:id/onay-kayitlari', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { tur } = (i.query ?? {}) as { tur?: string };
    if (!UUID.test(id) || o.grup !== 'LGM İç Rolü' || !(await dosyaErisimi(b.db, o.kullanici, id))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    if (tur && !(ONAY_KAYIT_TURLERI as readonly string[]).includes(tur)) return y.code(400).send({ hata: 'Onay kayıt türünü listeden seçiniz.' });
    const kayitlar = (await b.db.query(`SELECT tur, zaman, konu, sonuc, onaylayan, kanal FROM onay_kaydi WHERE dosya_ref = $1 AND ($2::text IS NULL OR tur = $2) ORDER BY zaman DESC`, [id, tur ?? null])).rows;
    return { turler: ONAY_KAYIT_TURLERI, kayitlar };
  });
}
