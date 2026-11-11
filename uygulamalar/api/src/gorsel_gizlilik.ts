import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
/** YG-1165: hassas işaretli belgenin özgün sürümü dışarı gönderilmez; maskeli kopyası gönderilir. */
export async function hassasEkEngeli(db: Db, ekler: string[]): Promise<string | null> {
  if (!ekler.length) return null;
  const r = (await db.query(`SELECT e.ad FROM belge_surum s JOIN belge e ON e.kimlik = s.belge_ref WHERE s.kimlik = ANY($1::uuid[]) AND e.hassas_icerik LIMIT 1`, [ekler])).rows[0];
  return r ? `Hassas içerikli görsel (${r.ad}) özgün hâliyle dışarı gönderilemez; maskeli kopyasını ekleyiniz.` : null;
}

export function gorselGizlilikYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const dosyaBelgesi = async (k: string, id: string) => {
    const r = (await b.db.query(`SELECT kimlik, ad, bag_kimligi, hassas_icerik, bilgi_sinifi FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya'`, [id])).rows[0];
    return r && (await dosyaErisimi(b.db, k, r.bag_kimligi)) ? r : null;
  };
  // Hassas işaret, dosya sorumlusuna erişim seviyesi gözden geçirme görevi açar; bilgi sınıfı en az Gizli olur.
  s.post('/belge/:id/hassas', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { neden?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const e = await dosyaBelgesi(o.kullanici, id); if (!e) return yok(y);
    if (!g.neden?.trim()) return y.code(400).send({ hata: 'Hassasiyet nedeni zorunludur (ör. kişi yüzü, plaka, kimlik belgesi).' });
    if (e.hassas_icerik) return y.code(409).send({ hata: 'Belge hassas olarak işaretlidir.' });
    await b.db.query(`UPDATE belge SET hassas_icerik = true, hassasiyet_nedeni = $2, bilgi_sinifi = CASE WHEN bilgi_sinifi = 'Kritik' THEN 'Kritik' ELSE 'Gizli' END WHERE kimlik = $1`, [id, g.neden.trim()]);
    const ds = (await b.db.query(`SELECT dosya_sorumlusu_ref, dosya_no FROM dosya WHERE kimlik = $1`, [e.bag_kimligi])).rows[0];
    if (ds?.dosya_sorumlusu_ref) await kartAc(b.db, { tur: 'Hassas Görsel Erişim Gözden Geçirmesi', kategori: 'gorev', baslik: `${ds.dosya_no} · ${e.ad} · Erişim seviyesi gözden geçirmesi`, ozet: `Neden: ${g.neden.trim()}. Belgeyi kimlerin görebileceğini gözden geçiriniz; dış paylaşım için maskeli kopya yükleyiniz.`, sahipKullanici: ds.dosya_sorumlusu_ref, nesneTuru: 'Belge', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Hassas Görsel İşaretlendi', nesneTuru: 'Belge', nesneKimligi: id, gerekce: g.neden, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  // Maskeleme özgün üzerinde değil, ayrı yüklenen kopya üzerinde yapılır; özgün değişmez.
  s.post('/belge/:id/maskeli-kopya', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kopya?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !g.kopya || !UUID.test(g.kopya) || g.kopya === id) return yok(y);
    const e = await dosyaBelgesi(o.kullanici, id); const k = await dosyaBelgesi(o.kullanici, g.kopya);
    if (!e || !k || k.bag_kimligi !== e.bag_kimligi) return y.code(400).send({ hata: 'Maskeli kopya aynı dosyaya yüklenmiş ayrı bir belge olmalıdır.' });
    if (!e.hassas_icerik) return y.code(409).send({ hata: 'Özgün belge hassas olarak işaretli değildir.' });
    if (k.hassas_icerik) return y.code(409).send({ hata: 'Kopya hassas işaretlidir; maskelenmiş olmalıdır.' });
    await b.db.query(`UPDATE belge SET maskeli_kaynak_ref = $2 WHERE kimlik = $1`, [g.kopya, id]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Hassas Görsel Erişim Gözden Geçirmesi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Maskeli Kopya Bağlandı', nesneTuru: 'Belge', nesneKimligi: id, yeni: { kopya: g.kopya }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
