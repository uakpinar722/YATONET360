import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { isGunuSonu } from './teklif.js';

const FYM = 'Firma Yönetimi Müdürü'; const BTD = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'; const GMY = 'Genel Müdür Yardımcısı';
export type PoliceSatiri = { kimlik: string; ticari_unvan: string; sicil_no: string; bitis: string | null; limit_eur: string | null; gozetim: boolean | null; durum: 'Eksik' | 'Süresi Dolmuş' | 'Düşük' | 'Uygun'; tavsiye: boolean };

/** YG-1471: ağdaki Çözüm Ortaklarının son sorumluluk poliçesi; önerilen seviye LMT-1 parametresidir, ağa kabul şartı değildir. */
export async function policeListesi(db: Pool): Promise<PoliceSatiri[]> {
  const { rows } = await db.query(
    `SELECT u.kimlik, u.ticari_unvan, u.sicil_no, s.gecerlilik_bitis::text bitis, s.police_limit_eur limit_eur, s.gozetim_muhafaza gozetim, s.kimlik belge, (s.gecerlilik_bitis < current_date) dolmus, (s.police_limit_eur < (SELECT deger FROM sistem_parametresi WHERE kod = 'police_olay_basi_limit_eur')) dusuk
       FROM kurulus u LEFT JOIN LATERAL (SELECT * FROM sicil_belgesi b WHERE b.kurulus_ref = u.kimlik AND b.tur ILIKE '%sigorta%' ORDER BY b.olusturma_zamani DESC LIMIT 1) s ON true
      WHERE u.kayit_rolu = 'Çözüm Ortağı' AND u.kayit_asamasi IN ('Onaylı', 'Koşullu Onaylı') AND u.ag_statusu IN ('Aktif', 'Kısıtlı') ORDER BY u.ticari_unvan LIMIT 2000`);
  return rows.map((r) => {
    const durum = !r.belge ? 'Eksik' as const : r.dolmus ? 'Süresi Dolmuş' as const : r.dusuk ? 'Düşük' as const : 'Uygun' as const;
    return { kimlik: r.kimlik, ticari_unvan: r.ticari_unvan, sicil_no: r.sicil_no, bitis: r.bitis, limit_eur: r.limit_eur, gozetim: r.gozetim, durum, tavsiye: r.gozetim !== true };
  });
}

/** YG-1471: üç ayda bir Firma Yönetimi Müdürüne görev; 10 iş günü; silsile Direktör ve GMY; süre aşımı onay kartlarının ortak yükseltmesiyle üst kademeye gider. */
export async function policeGozdenGecirIsle(db: Pool, simdi = new Date()): Promise<boolean> {
  const anahtar = `${simdi.getUTCFullYear()}-${Math.floor(simdi.getUTCMonth() / 3) + 1}`;
  if (!(await birKez(db, 'firma_police_gozden_gecir', anahtar))) return false;
  const l = await policeListesi(db); const say = (d: string) => l.filter((x) => x.durum === d).length;
  await kartAc(db, { tur: 'Firma Poliçe Gözden Geçirme', baslik: `${anahtar} Firma Poliçe Gözden Geçirme`, ozet: `Eksik: ${say('Eksik')} · Süresi Dolmuş: ${say('Süresi Dolmuş')} · Düşük: ${say('Düşük')}`, zincir: [await rolId(db, FYM), await rolId(db, BTD), await rolId(db, GMY)], sonZaman: await isGunuSonu(db, simdi, 10), nesneTuru: 'Firma Poliçe Listesi', nesneKimligi: anahtar });
  return true;
}

export function firmaPoliceYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/firma/police-listesi', oturumlu, async (i, y) => {
    const yetkili = (await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [i.oturum!.kullanici, [FYM, BTD, GMY]])).rowCount;
    return yetkili ? policeListesi(b.db) : yok(y);
  });
}
