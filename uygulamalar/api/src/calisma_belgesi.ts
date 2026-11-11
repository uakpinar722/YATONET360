import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { gunAy } from './metin.js';
import type { BelgeTanim, Bolum } from './pdf.js';

type Db = Pool | PoolClient;
const IK = ['İnsan Kaynakları Müdürü', 'İnsan Kaynakları Sorumlusu'];

/** Yıl, ay, gün olarak çalışma süresi (giriş ve çıkış günü dahil). */
export function calismaSuresi(giris: Date, cikis: Date): string {
  const s = new Date(cikis.getTime() + 86_400_000);
  let y = s.getUTCFullYear() - giris.getUTCFullYear(); let a = s.getUTCMonth() - giris.getUTCMonth(); let g = s.getUTCDate() - giris.getUTCDate();
  if (g < 0) { a--; g += new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 0)).getUTCDate(); }
  if (a < 0) { y--; a += 12; }
  return [y && `${y} yıl`, a && `${a} ay`, g && `${g} gün`].filter(Boolean).join(' ') || '0 gün';
}

/** YG-934: 4857 s. İş Kanunu m.28 çalışma belgesi; yalnız kanunun saydığı işin türü ve süresi yazılır (davranış ve çalışma değerlendirmesi yazılmaz). */
export async function calismaBelgesiTanim(db: Db, personel: string): Promise<{ t: BelgeTanim; dosyaAdi: string } | null> {
  const p = (await db.query(`SELECT h.ad_soyad, k.ise_giris_tarihi, k.ayrilis_tarihi FROM personel_karti k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.kullanici_ref = $1 AND k.ayrilis_tarihi IS NOT NULL AND k.ise_giris_tarihi IS NOT NULL`, [personel])).rows[0];
  if (!p) return null;
  // Hesap kapanınca tüm atamalar Kapalı olur; işin türü atanmış rollerin tamamıdır.
  const roller = (await db.query(`SELECT r.rol_adi, a.baslangic_tarihi, a.bitis_tarihi FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 ORDER BY a.baslangic_tarihi NULLS FIRST, r.rol_adi`, [personel])).rows;
  const gorev = [...new Map(roller.map((r) => [r.rol_adi as string, r])).values()];
  const bolumler: Bolum[] = [
    { baslik: 'Çalışan', tur: 'alanlar', alanlar: [{ et: 'Adı Soyadı', deger: p.ad_soyad }, { et: 'İşe Giriş Tarihi', deger: gunAy(p.ise_giris_tarihi) }, { et: 'İşten Ayrılış Tarihi', deger: gunAy(p.ayrilis_tarihi) }, { et: 'Çalışma Süresi', deger: calismaSuresi(new Date(p.ise_giris_tarihi), new Date(p.ayrilis_tarihi)) }] },
    { baslik: 'Yaptığı İşin Türü', tur: 'tablo', sutunlar: [{ ad: 'Görev' }, { ad: 'Başlangıç' }, { ad: 'Bitiş' }], satirlar: gorev.map((r) => [r.rol_adi, r.baslangic_tarihi ? gunAy(r.baslangic_tarihi) : null, r.bitis_tarihi ? gunAy(r.bitis_tarihi) : null]) },
    { baslik: 'Dayanak', tur: 'alanlar', numarasiz: true, alanlar: [{ et: 'Dayanak', deger: '4857 sayılı İş Kanunu m.28' }] },
  ];
  const no = `CB-${String(p.ad_soyad).replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 24).replace(/-+$/, '')}-${String(p.ayrilis_tarihi instanceof Date ? p.ayrilis_tarihi.toISOString() : p.ayrilis_tarihi).slice(0, 10)}`;
  return { dosyaAdi: `${no}.pdf`, t: { ad: 'Çalışma Belgesi', no, tarih: gunAy(new Date()), surum: 'Rev.0', dil: 'tr', bolumler } };
}

export function calismaBelgesiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/personel/:id/calisma-belgesi.pdf', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[])`, [o.kullanici, IK])).rowCount) return yok(y);
    const v = await calismaBelgesiTanim(b.db, id); if (!v) return y.code(409).send({ hata: 'Çalışma belgesi, ayrılış tarihi kayıtlı personel için üretilir.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Çalışma Belgesi Üretildi', nesneTuru: 'Personel', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    const { pdfUret } = await import('./pdf.js');
    return y.type('application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(v.dosyaAdi)}"`).send(await pdfUret(v.t));
  });
}
