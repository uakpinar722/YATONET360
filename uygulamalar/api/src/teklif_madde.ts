import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
/** YG-709: LGM-2026-013 "Uygulama ön koşulu" ve "Mühendislik durdurma noktaları" paragraflarının maddeleri; metin belgeden aynen alınır. */
export const TEKLIF_MADDELERI: { kod: string; grup: 'Ön Koşul' | 'Durdurma Noktası'; metin: string }[] = [
  { kod: 'ON-1', grup: 'Ön Koşul', metin: 'Yatın kimliği, boyu/tonajı, kullanım türü, bayrağı, varsa klas durumu, üretici verisi ve onaylı çizimlerinin doğrulanması' },
  { kod: 'ON-2', grup: 'Ön Koşul', metin: 'Tasarım hesabı, iş izni, seyire elverişlilik veya resmî sertifika' },
  { kod: 'DN-1', grup: 'Durdurma Noktası', metin: 'Taşıyıcı yapı veya gövde geçişi değişikliği öncesi yazılı yöntem, emniyet sınırı ve gerekli üretici/klas/bayrak onayı' },
  { kod: 'DN-2', grup: 'Durdurma Noktası', metin: 'Ağırlık merkezi/stabilite etkisi olan müdahale öncesi yazılı yöntem, emniyet sınırı ve gerekli üretici/klas/bayrak onayı' },
  { kod: 'DN-3', grup: 'Durdurma Noktası', metin: 'Sıcak iş öncesi yazılı yöntem, emniyet sınırı ve gerekli üretici/klas/bayrak onayı' },
  { kod: 'DN-4', grup: 'Durdurma Noktası', metin: 'Basınç ve yük deneyi öncesi yazılı yöntem, emniyet sınırı ve gerekli üretici/klas/bayrak onayı' },
  { kod: 'DN-5', grup: 'Durdurma Noktası', metin: 'Havuzlama öncesi yazılı yöntem, emniyet sınırı ve gerekli üretici/klas/bayrak onayı' },
  { kod: 'DN-6', grup: 'Durdurma Noktası', metin: 'Kaldırma öncesi yazılı yöntem, emniyet sınırı ve gerekli üretici/klas/bayrak onayı' },
  { kod: 'DN-7', grup: 'Durdurma Noktası', metin: 'Enerji/yakıt/gaz ve yangın sisteminde müdahale öncesi yazılı yöntem, emniyet sınırı ve gerekli üretici/klas/bayrak onayı' },
  { kod: 'DN-8', grup: 'Durdurma Noktası', metin: 'Gizli iş kapatılmadan muayene kanıtı' },
  { kod: 'DN-9', grup: 'Durdurma Noktası', metin: 'Teslimden önce güncel çizim, deney sonucu, kalan kusur ve kullanım kısıtının dosyalanması' },
];
export const MADDE_TURU = ['Hariç', 'Ayrıca Fiyatlandırılır'] as const;

/** Teklif belgesindeki "Hariç ve Ayrıca Fiyatlandırılacak Hususlar" bölümü satırları. */
export async function teklifMaddeleri(db: Db, teklif: string): Promise<{ tur: string; metin: string }[]> {
  const r = (await db.query(`SELECT madde, tur FROM teklif_maddesi WHERE teklif_ref = $1 ORDER BY tur, madde`, [teklif])).rows as { madde: string; tur: string }[];
  return r.map((x) => ({ tur: x.tur, metin: TEKLIF_MADDELERI.find((m) => m.kod === x.madde)?.metin ?? x.madde }));
}

export function teklifMaddeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  // Maddeleri teklifi hazırlayan, teklif taslakken seçer.
  const taslak = async (id: string) => (await b.db.query(`SELECT t.kimlik, t.statu, t.hazirlayan_ref, d.yazisma_dili FROM fiyat_teklifi t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1`, [id])).rows[0] as { statu: string; hazirlayan_ref: string; yazisma_dili: string } | undefined;
  s.get('/teklif/:id/madde', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    return { katalog: TEKLIF_MADDELERI, turler: MADDE_TURU, secili: (await b.db.query(`SELECT madde, tur FROM teklif_maddesi WHERE teklif_ref = $1 ORDER BY madde`, [id])).rows };
  });
  s.post('/teklif/:id/madde', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { madde?: string; tur?: string; kaldir?: boolean };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const t = await taslak(id); if (!t) return yok(y);
    if (t.hazirlayan_ref !== o.kullanici) return y.code(403).send({ hata: 'Maddeleri teklifi hazırlayan seçer.' });
    if (t.statu !== 'Taslak') return y.code(409).send({ hata: 'Teklif taslak değildir.' });
    if (!TEKLIF_MADDELERI.some((m) => m.kod === g.madde)) return y.code(400).send({ hata: 'Maddeyi seçiniz.' });
    if (g.kaldir) { await b.db.query(`DELETE FROM teklif_maddesi WHERE teklif_ref = $1 AND madde = $2`, [id, g.madde]); return { tamam: true }; }
    if (!MADDE_TURU.includes(g.tur as never)) return y.code(400).send({ hata: 'Hariç veya Ayrıca Fiyatlandırılır seçiniz.' });
    // Maddelerin İngilizce metni onaylanmadığından İngilizce teklifte kullanılmaz.
    if (t.yazisma_dili === 'İngilizce') return y.code(409).send({ hata: 'Bu maddelerin İngilizce metni henüz onaylı değildir; İngilizce teklifte kullanılamaz.' });
    await b.db.query(`INSERT INTO teklif_maddesi (teklif_ref, madde, tur, giren_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (teklif_ref, madde) DO UPDATE SET tur = EXCLUDED.tur, giren_ref = EXCLUDED.giren_ref, zaman = now()`, [id, g.madde, g.tur, o.kullanici]);
    return { tamam: true };
  });
}
