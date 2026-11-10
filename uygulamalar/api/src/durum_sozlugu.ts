import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const ROLLER = ['Bilgi İşlem Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Genel Müdür Yardımcısı', 'Hukuk ve Uyum Direktörü', 'CEO'];
const dolu = (x?: string) => typeof x === 'string' && x.trim().length > 0;

/** YG-1365: her kayıt türünün durum değerleri CHECK kısıtlarından okunur. */
export async function durumKaynagi(db: Pool): Promise<{ kayit_turu: string; alan: string; durumlar: string[] }[]> {
  return (await db.query(`SELECT kayit_turu, alan, tanim FROM durum_kaynagi ORDER BY kayit_turu, alan`)).rows
    .map((r) => ({ kayit_turu: r.kayit_turu as string, alan: r.alan as string, durumlar: [...(r.tanim as string).matchAll(/'((?:[^']|'')*)'::text/g)].map((m) => (m[1] ?? '').replace(/''/g, "'")) }))
    .filter((r) => r.durumlar.length > 1);
}

export function durumSozluguYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const icKullanici = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü'`, [k])).rowCount);
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, ROLLER])).rowCount);

  // Tüm LGM personeli okur; tanımsız durumlar ve aynı adın farklı anlamları ayrıca listelenir.
  s.get('/durum-sozlugu', oturumlu, async (i, y) => {
    if (!(await icKullanici(i.oturum!.kullanici))) return yok(y);
    const kaynak = await durumKaynagi(b.db);
    const kayit = (await b.db.query(`SELECT kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi FROM durum_sozlugu`)).rows;
    const bul = (t: string, d: string) => kayit.find((x) => x.kayit_turu === t && x.durum === d) ?? null;
    const turler = kaynak.map((k) => ({ ...k, tanimlar: k.durumlar.map((d) => ({ durum: d, tanim: bul(k.kayit_turu, d) })) }));
    const anlam = new Map<string, Set<string>>();
    for (const x of kayit) { const s2 = anlam.get(x.durum) ?? new Set(); s2.add(x.is_anlami.trim()); anlam.set(x.durum, s2); }
    return {
      turler, yetkili: await yetkili(i.oturum!.kullanici),
      ozet: { tur: kaynak.length, durum: kaynak.reduce((a, k) => a + k.durumlar.length, 0), tanimli: kayit.length },
      cakisma: [...anlam].filter(([, v]) => v.size > 1).map(([d, v]) => ({ durum: d, anlamlar: [...v] })),
    };
  });
  // Aynı durum adı başka bir kayıt türünde farklı anlamla tanımlıysa kayıt reddedilir.
  s.post('/durum-sozlugu', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kayitTuru?: string; durum?: string; isAnlami?: string; girisKosulu?: string; cikisKosulu?: string; yetkiliRol?: string; izinliGecisler?: string[]; zorunluAciklama?: boolean; sureDurur?: boolean; otomatikBildirim?: string; musteriAdi?: string };
    if (!(await yetkili(o.kullanici))) return yok(y);
    const k = (await durumKaynagi(b.db)).find((x) => x.kayit_turu === g.kayitTuru);
    if (!k || !k.durumlar.includes(g.durum ?? '')) return y.code(400).send({ hata: 'Kayıt türü veya durum sistemde tanımlı değildir.' });
    if (!dolu(g.isAnlami) || !dolu(g.girisKosulu) || !dolu(g.cikisKosulu) || !dolu(g.yetkiliRol)) return y.code(400).send({ hata: 'İş anlamı, giriş koşulu, çıkış koşulu ve yetkili rol zorunludur.' });
    const gecis = (g.izinliGecisler ?? []).filter(dolu);
    const yanlis = gecis.filter((x) => !k.durumlar.includes(x) || x === g.durum); if (yanlis.length) return y.code(400).send({ hata: `Geçişler aynı kayıt türünün diğer durumları olmalıdır: ${yanlis.join(', ')}` });
    if (!(await b.db.query(`SELECT 1 FROM rol WHERE rol_adi = $1`, [g.yetkiliRol!.trim()])).rowCount) return y.code(400).send({ hata: 'Yetkili rol, Rol Kataloğundaki bir rol olmalıdır.' });
    const baska = (await b.db.query(`SELECT kayit_turu, is_anlami FROM durum_sozlugu WHERE durum = $1 AND kayit_turu <> $2 AND lower(trim(is_anlami)) <> lower(trim($3)) LIMIT 1`, [g.durum, g.kayitTuru, g.isAnlami])).rows[0];
    if (baska) return y.code(409).send({ hata: `"${g.durum}" durumu ${baska.kayit_turu} kaydında "${baska.is_anlami}" anlamıyla tanımlıdır; aynı ad farklı anlam taşıyamaz.` });
    await b.db.query(`INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi, guncelleyen_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (kayit_turu, durum) DO UPDATE SET is_anlami = EXCLUDED.is_anlami, giris_kosulu = EXCLUDED.giris_kosulu, cikis_kosulu = EXCLUDED.cikis_kosulu, yetkili_rol = EXCLUDED.yetkili_rol, izinli_gecisler = EXCLUDED.izinli_gecisler, zorunlu_aciklama = EXCLUDED.zorunlu_aciklama, sure_durur = EXCLUDED.sure_durur, otomatik_bildirim = EXCLUDED.otomatik_bildirim, musteri_adi = EXCLUDED.musteri_adi, guncelleyen_ref = EXCLUDED.guncelleyen_ref, zaman = now()`,
      [g.kayitTuru, g.durum, g.isAnlami!.trim(), g.girisKosulu!.trim(), g.cikisKosulu!.trim(), g.yetkiliRol!.trim(), gecis, g.zorunluAciklama === true, g.sureDurur === true, g.otomatikBildirim?.trim() || null, g.musteriAdi?.trim() || null, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Durum Sözlüğü Güncellendi', nesneTuru: 'Durum Sözlüğü', nesneKimligi: `${g.kayitTuru}:${g.durum}`, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
