import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
export type BoyutDurumu = 'Başlamadı' | 'Sürüyor' | 'Tamamlandı' | 'Gerekmez';
export const BOYUTLAR = ['Müşteri Onayı', 'Satın Alma', 'Teknik İlerleme', 'Kalite', 'Ödeme', 'Kapanış'] as const;
export type Boyut = (typeof BOYUTLAR)[number];

/** YG-005: hangi boyutun hangisini engellediği yalnız burada tanımlıdır; ekran ve denetimler bu tablodan okur. */
export const ENGELLER: Record<Boyut, { engelleyen: Boyut[]; kural: string }> = {
  'Müşteri Onayı': { engelleyen: [], kural: 'Teklif kararı (yat sahibi veya sigorta) verilmeden onaylı kapsam oluşmaz.' },
  'Satın Alma': { engelleyen: ['Müşteri Onayı'], kural: 'Onaylı kapsam olmadan dosyaya tedarik siparişi verilmez.' },
  'Teknik İlerleme': { engelleyen: ['Müşteri Onayı'], kural: 'Onaylı kapsam olmadan onarım iş emri açılmaz.' },
  'Kalite': { engelleyen: ['Teknik İlerleme'], kural: 'Teknik kabul, iş emri tamamlanınca yapılır.' },
  'Ödeme': { engelleyen: ['Müşteri Onayı'], kural: 'Fatura onaylı kapsama göre kesilir.' },
  'Kapanış': { engelleyen: ['Satın Alma', 'Teknik İlerleme', 'Kalite', 'Ödeme'], kural: 'Açık sipariş, tamamlanmamış iş, teknik kabulü yapılmamış iş veya tahsil edilmemiş fatura varken dosya kapanmaz.' },
};

const say = async (db: Db, sql: string, p: unknown[]) => Number((await db.query(sql, p)).rows[0].n);

/** Her boyutun durumu dosyanın kendi kayıtlarından hesaplanır; ayrıca elle tutulmaz. */
export async function durumBoyutlari(db: Db, dosya: string) {
  const d = (await db.query(`SELECT statu FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  const onay = (await db.query(`SELECT count(*) FILTER (WHERE statu = 'Karar' AND karar IN ('Tam Onay', 'Kısmi Onay', 'Koşullu Onay', 'Süre Dolumu Kabulü'))::int onayli, count(*) FILTER (WHERE statu IN ('İç Onayda', 'Onaylı', 'Gönderildi'))::int bekleyen FROM fiyat_teklifi WHERE dosya_ref = $1`, [dosya])).rows[0];
  const sip = (await db.query(`SELECT count(*) FILTER (WHERE statu IN ('Onay Bekliyor', 'Verildi', 'Kısmi Teslim'))::int acik, count(*) FILTER (WHERE statu NOT IN ('Taslak', 'İptal'))::int tum FROM tedarik_siparisi WHERE dosya_ref = $1`, [dosya])).rows[0];
  const ie = (await db.query(`SELECT count(*)::int tum, count(*) FILTER (WHERE statu IN ('Tamamlandı', 'Kapalı'))::int biten, count(*) FILTER (WHERE statu IN ('Tamamlandı', 'Kapalı') AND teknik_kabul_sonucu IS NULL)::int kabulsuz FROM is_emri WHERE dosya_ref = $1 AND statu NOT IN ('İptal', 'Yerine Geçti')`, [dosya])).rows[0];
  const ft = (await db.query(`SELECT count(*)::int tum, count(*) FILTER (WHERE durum = 'Tahsil Edildi')::int tahsil FROM musteri_faturasi WHERE dosya_ref = $1 AND durum <> 'Reddedildi'`, [dosya])).rows[0];
  const kk = await say(db, `SELECT count(*)::int n FROM kapanis_kontrolu WHERE dosya_ref = $1 AND durum = 'Hazırlandı'`, [dosya]);
  const durum: Record<Boyut, { durum: BoyutDurumu; ayrinti: string }> = {
    'Müşteri Onayı': onay.onayli ? { durum: 'Tamamlandı', ayrinti: `${onay.onayli} onaylı teklif` } : onay.bekleyen ? { durum: 'Sürüyor', ayrinti: `${onay.bekleyen} teklif kararda değil` } : { durum: 'Başlamadı', ayrinti: 'Teklif yok' },
    'Satın Alma': !sip.tum ? { durum: 'Gerekmez', ayrinti: 'Tedarik siparişi yok' } : sip.acik ? { durum: 'Sürüyor', ayrinti: `${sip.acik} açık sipariş` } : { durum: 'Tamamlandı', ayrinti: `${sip.tum} sipariş kapandı` },
    'Teknik İlerleme': !ie.tum ? { durum: 'Başlamadı', ayrinti: 'İş emri yok' } : ie.biten === ie.tum ? { durum: 'Tamamlandı', ayrinti: `${ie.tum} iş emri tamamlandı` } : { durum: 'Sürüyor', ayrinti: `${ie.biten}/${ie.tum} iş emri tamamlandı` },
    'Kalite': !ie.biten ? { durum: 'Başlamadı', ayrinti: 'Tamamlanan iş emri yok' } : ie.kabulsuz ? { durum: 'Sürüyor', ayrinti: `${ie.kabulsuz} iş emrinde teknik kabul bekleniyor` } : ie.biten === ie.tum ? { durum: 'Tamamlandı', ayrinti: 'Teknik kabuller yapıldı' } : { durum: 'Sürüyor', ayrinti: 'Süren iş emri var' },
    'Ödeme': !ft.tum ? { durum: 'Başlamadı', ayrinti: 'Fatura yok' } : ft.tahsil === ft.tum ? { durum: 'Tamamlandı', ayrinti: `${ft.tum} fatura tahsil edildi` } : { durum: 'Sürüyor', ayrinti: `${ft.tum - ft.tahsil} fatura tahsil edilmedi` },
    'Kapanış': d?.statu === 'Kapalı' ? { durum: 'Tamamlandı', ayrinti: 'Dosya kapalı' } : kk ? { durum: 'Sürüyor', ayrinti: 'Kapanış kontrolü onayda' } : { durum: 'Başlamadı', ayrinti: 'Dosya açık' },
  };
  const bitti = (b: Boyut) => ['Tamamlandı', 'Gerekmez'].includes(durum[b].durum);
  return BOYUTLAR.map((b) => ({ boyut: b, ...durum[b], kural: ENGELLER[b].kural, engelleyenler: bitti(b) ? [] : ENGELLER[b].engelleyen.filter((e) => !bitti(e)) }));
}

export function durumBoyutlariYollari(s: FastifyInstance, b: Baglam) {
  s.get('/dosya/:id/durum-boyutlari', { preHandler: tamOturumGerekli(b) }, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
    return durumBoyutlari(b.db, id);
  });
}
