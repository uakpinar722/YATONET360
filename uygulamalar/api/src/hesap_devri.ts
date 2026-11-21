import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { onayMakami, rolSahipleri } from './makam.js';

type Db = Pool | PoolClient;

/**
 * YG-1054: kapatılan hesabın açık görevleri, makamı boşalan onay kararları ve belge sorumluluğu yeni sorumluya geçer; geçmiş işlemler
 * (aktör, oluşturan, karar veren) eski kimlikte kalır. Yeni sorumlu: dosyaya bağlı işte Dosya Sorumlusu; değilse kişinin birim amiri
 * (rolünün onay makamı); dış kullanıcıda Operasyon Müdürü. Her devir hesap_kapanis_devri tablosuna yazılır.
 */
export async function hesapKapanisDevri(db: Db, kullanici: string): Promise<number> {
  const h = (await db.query(`SELECT kullanici_grubu FROM kullanici_hesabi WHERE kimlik = $1`, [kullanici])).rows[0];
  if (!h) return 0;
  const roller = (await db.query(`SELECT rol_ref FROM rol_atamasi WHERE kullanici_ref = $1 AND atama_durumu = 'Aktif'`, [kullanici])).rows.map((r) => r.rol_ref as string);
  const opm = (await db.query(`SELECT a.kullanici_ref FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE r.rol_adi = 'Operasyon Müdürü' AND a.atama_durumu = 'Aktif' AND a.kullanici_ref <> $1 LIMIT 1`, [kullanici])).rows[0]?.kullanici_ref ?? null;
  let amir: string | null = null;
  for (const r of roller) { amir = (await rolSahipleri(db, await onayMakami(db, r))).find((x) => x !== kullanici) ?? null; if (amir) break; }
  const varsayilan = h.kullanici_grubu === 'LGM İç Rolü' ? amir ?? opm : opm;
  const dosyaSorumlusu = async (dosya: string | null) => dosya ? ((await db.query(`SELECT dosya_sorumlusu_ref FROM dosya WHERE kimlik::text = $1`, [dosya])).rows[0]?.dosya_sorumlusu_ref as string | undefined) : undefined;
  const yaz = (tur: string, nesne: string, yeni: string | null, aciklama: string) => db.query(`INSERT INTO hesap_kapanis_devri (kullanici_ref, tur, nesne, yeni_sorumlu_ref, aciklama) VALUES ($1,$2,$3,$4,$5)`, [kullanici, tur, nesne, yeni, aciklama]);
  let n = 0;
  // 1) Açık görev ve işlem kartları
  for (const k of (await db.query(`SELECT kimlik, baslik, nesne_turu, nesne_kimligi FROM is_karti WHERE sahip_kullanici_ref = $1 AND durum = 'Bekliyor' AND kategori <> 'onay'`, [kullanici])).rows) {
    const ds = k.nesne_turu === 'Dosya' ? await dosyaSorumlusu(k.nesne_kimligi) : undefined;
    const yeni = ds && ds !== kullanici ? ds : varsayilan;
    if (!yeni) { await yaz('Görev', k.kimlik, null, `${k.baslik}: devralacak kişi bulunamadı`); continue; }
    await db.query(`UPDATE is_karti SET sahip_kullanici_ref = $2 WHERE kimlik = $1`, [k.kimlik, yeni]);
    await yaz('Görev', k.kimlik, yeni, k.baslik); n++;
  }
  // 2) Makamı yalnız bu kişide olan bekleyen onaylar: makamın üst makamı bilgilendirilir ve karar vermesi istenir (onay zinciri kendiliğinden değiştirilmez).
  for (const k of (await db.query(`SELECT k.kimlik, k.baslik, k.zincir[k.kademe + 1] makam FROM is_karti k WHERE k.durum = 'Bekliyor' AND k.kategori = 'onay' AND k.zincir[k.kademe + 1] = ANY($1::text[])
      AND NOT EXISTS (SELECT 1 FROM rol_atamasi a WHERE a.rol_ref = k.zincir[k.kademe + 1] AND a.atama_durumu = 'Aktif' AND a.kullanici_ref <> $2)`, [roller, kullanici])).rows) {
    const ust = (await rolSahipleri(db, await onayMakami(db, k.makam))).filter((x) => x !== kullanici);
    await bildir(db, { olay: `makam-bos:${k.kimlik}:${kullanici}`, kullanicilar: ust, baslik: `Makamı Boşalan Onay: ${k.baslik}`, ozet: 'Onay makamındaki tek kişinin hesabı kapandı. Vekil atayınız veya kararı üst makam olarak veriniz.', oncelik: 'Yüksek', eposta: true });
    await yaz('Onay', k.kimlik, ust[0] ?? null, `${k.baslik}: makam boşaldı, üst makam bilgilendirildi`); n++;
  }
  // 3) Belge sorumluluğu (oluşturan alanı değişmez); Kritik belgede yeni sorumlu erişim grubuna eklenir.
  for (const b of (await db.query(`SELECT kimlik, ad, bag_turu, bag_kimligi, bilgi_sinifi FROM belge WHERE coalesce(sorumlu_ref, olusturan_ref) = $1`, [kullanici])).rows) {
    const ds = b.bag_turu === 'Dosya' ? await dosyaSorumlusu(b.bag_kimligi) : undefined;
    const yeni = ds && ds !== kullanici ? ds : varsayilan;
    if (!yeni) continue;
    await db.query(`UPDATE belge SET sorumlu_ref = $2 WHERE kimlik = $1`, [b.kimlik, yeni]);
    if (b.bilgi_sinifi === 'Kritik') await db.query(`INSERT INTO belge_erisim_grubu (belge_ref, kullanici_ref, ekleyen_ref) SELECT $1, $2, $2 WHERE NOT EXISTS (SELECT 1 FROM belge_erisim_grubu WHERE belge_ref = $1 AND kullanici_ref = $2)`, [b.kimlik, yeni]);
    await yaz('Belge', b.kimlik, yeni, b.ad); n++;
  }
  return n;
}
