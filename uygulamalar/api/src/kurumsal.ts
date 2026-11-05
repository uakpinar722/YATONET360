import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, disGonder } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { davetOlustur } from './ilk_giris.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const EPOSTA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLLER = ['İzleyici', 'Talep Açan', 'Onaylayan'];
const GRUP = 'Kurumsal Müşteri'; const ROL = 'Kurumsal Müşteri Kullanıcısı'; const MPM = 'Müşteri ve Paydaş İlişkileri Müdürü';

export const kurumsalKullanici = async (db: Db, k: string) => (await db.query(`SELECT u.rol, u.onay_siniri, u.yetkili, u.kurum_ref, c.unvan, c.ek2_onay_siniri, c.taraf_ref FROM kurumsal_kullanici u JOIN kurumsal_kurum c ON c.kimlik = u.kurum_ref JOIN kullanici_hesabi h ON h.kimlik = u.kullanici_ref WHERE u.kullanici_ref = $1 AND h.hesap_durumu = 'Aktif'`, [k])).rows[0] as { rol: string; onay_siniri: string | null; yetkili: boolean; kurum_ref: string; unvan: string; ek2_onay_siniri: string; taraf_ref: string } | undefined;

/** YG-1563: İzleyici talep açmaz. Kurumsal hesabı olmayan kullanıcıda kısıt yoktur. */
export async function talepEngeli(db: Db, k: string): Promise<string | null> {
  const u = await kurumsalKullanici(db, k);
  return u?.rol === 'İzleyici' ? 'Talep açma yetkiniz bulunmamaktadır; kurum yetkilinizle görüşmenizi rica ederiz.' : null;
}

/** YG-1563, YG-1070: onayı yalnız Onaylayan rolü, kendi sınırı içinde verir; sınır Ek-2 sınırını aşamaz. */
export async function onayEngeli(db: Db, k: string, tutar: number | null): Promise<string | null> {
  const u = await kurumsalKullanici(db, k);
  if (!u) return null;
  if (u.rol !== 'Onaylayan') return 'Onay yetkiniz bulunmamaktadır; kurumunuzun onaylayan kullanıcısından onay bekleniyor.';
  const s = Math.min(Number(u.onay_siniri ?? 0), Number(u.ek2_onay_siniri));
  return tutar !== null && tutar > s ? 'Tutar onay sınırınızın üzerindedir; kurumunuzun yetkili onaylayanından onay bekleniyor.' : null;
}

const davetGonder = async (c: PoolClient, b: Baglam, g: { ad: string; eposta: string; telefon?: string; unvan: string; olusturan: string }) => {
  const { kimlik, belirtec } = await davetOlustur(c, { adSoyad: g.ad, eposta: g.eposta, telefon: g.telefon, grup: GRUP, rol: ROL, olusturan: g.olusturan });
  await disGonder(c, { olay: `kurumsal-davet:${kimlik}`, eposta: g.eposta, konu: 'YATONET 360 Hesabınız', metin: `LİMİT GLOBAL MARINE: ${g.unvan} adına YATONET 360 hesabınız açılmıştır. İlk girişinizi 7 gün içinde aşağıdaki bağlantıdan yapmanızı rica ederiz. ${b.webAdresi}/#davet=${belirtec}`, acil: true });
  return kimlik;
};

export function kurumsalYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const mpmMi = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2 LIMIT 1`, [k, MPM])).rowCount);
  const adresVar = async (e: string) => Boolean((await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE lower(e_posta COLLATE "C") = lower($1::text COLLATE "C") LIMIT 1`, [e])).rowCount);

  // Kurumu ve ilk yetkiliyi A53 Müşteri ve Paydaş İlişkileri Müdürü tanımlar; sınır Ek-2'den gelir.
  s.post('/kurumsal-kurum', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tarafNo?: string; ek2Siniri?: number; yetkiliAd?: string; yetkiliEposta?: string; yetkiliTelefon?: string };
    if (!(await mpmMi(o.kullanici))) return y.code(403).send({ hata: 'Kurumu Müşteri ve Paydaş İlişkileri Müdürü tanımlar.' });
    if (!g.tarafNo?.trim() || !(Number(g.ek2Siniri) >= 0) || !g.yetkiliAd?.trim() || !g.yetkiliEposta || !EPOSTA.test(g.yetkiliEposta.trim())) return y.code(400).send({ hata: 'Taraf no, Ek-2 sınırı, yetkili adı ve e-postasını girmenizi rica ederiz.' });
    const t = (await b.db.query(`SELECT kimlik, unvan_ad_soyad FROM taraf WHERE taraf_no = $1 AND musteri_turu = 'Kurumsal Müşteri'`, [g.tarafNo.trim()])).rows[0];
    if (!t) return y.code(404).send({ hata: 'Bu numarada kurumsal müşteri kaydı bulunamadı.' });
    if ((await b.db.query(`SELECT 1 FROM kurumsal_kurum WHERE taraf_ref = $1`, [t.kimlik])).rowCount) return y.code(409).send({ hata: 'Bu kurum tanımlıdır.' });
    if (await adresVar(g.yetkiliEposta.trim())) return y.code(409).send({ hata: 'Bu e-posta adresiyle kayıtlı hesap bulunmaktadır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const k = (await c.query(`INSERT INTO kurumsal_kurum (taraf_ref, unvan, ek2_onay_siniri, kaydeden_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [t.kimlik, t.unvan_ad_soyad, g.ek2Siniri, o.kullanici])).rows[0];
      const kim = await davetGonder(c, b, { ad: g.yetkiliAd.trim(), eposta: g.yetkiliEposta.trim(), telefon: g.yetkiliTelefon?.trim() || undefined, unvan: t.unvan_ad_soyad, olusturan: o.kullanici });
      await c.query(`INSERT INTO kurumsal_kullanici (kullanici_ref, kurum_ref, rol, onay_siniri, yetkili, ekleyen_ref) VALUES ($1,$2,'Onaylayan',$3,true,$4)`, [kim, k.kimlik, g.ek2Siniri, o.kullanici]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurumsal Kurum Tanımı', nesneTuru: 'Kurumsal Kurum', nesneKimligi: k.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: k.kimlik };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.get('/kurumsal/kullanicilar', oturumlu, async (i, y) => {
    const u = await kurumsalKullanici(b.db, i.oturum!.kullanici);
    if (!u) return yok(y);
    const kullanicilar = (await b.db.query(`SELECT h.kimlik, h.ad_soyad, h.e_posta, h.hesap_durumu, k.rol, k.onay_siniri, k.yetkili FROM kurumsal_kullanici k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.kurum_ref = $1 ORDER BY h.hesap_durumu, h.ad_soyad`, [u.kurum_ref])).rows;
    return { kurum: u.unvan, kurumId: u.kurum_ref, ek2Siniri: u.ek2_onay_siniri, yetkili: u.yetkili, rol: u.rol, kullanicilar: kullanicilar.map((x) => ({ ...x, ben: x.kimlik === i.oturum!.kullanici })) };
  });

  // YG-1563: onay adımı yok; Müşteri ve Paydaş İlişkileri Müdürüne bilgi gider.
  s.post('/kurumsal/kullanici', oturumlu, async (i, y) => {
    const o = i.oturum!; const u = await kurumsalKullanici(b.db, o.kullanici); const g = (i.body ?? {}) as { ad?: string; eposta?: string; telefon?: string; rol?: string; sinir?: number };
    if (!u) return yok(y);
    if (!u.yetkili) return y.code(403).send({ hata: 'Kullanıcıyı kurum yetkiliniz ekler.' });
    if (!g.ad?.trim() || !g.eposta || !EPOSTA.test(g.eposta.trim()) || !ROLLER.includes(g.rol ?? '')) return y.code(400).send({ hata: 'Ad soyad, geçerli e-posta ve rolü girmenizi rica ederiz.' });
    if (g.rol === 'Onaylayan' && !(Number(g.sinir) >= 0)) return y.code(400).send({ hata: 'Onaylayan için onay sınırını girmenizi rica ederiz.' });
    if (g.rol === 'Onaylayan' && Number(g.sinir) > Number(u.ek2_onay_siniri)) return y.code(400).send({ hata: 'Onay sınırı kurumunuzun Ek-2 sınırının üzerinde olamaz.' });
    if (await adresVar(g.eposta.trim())) return y.code(409).send({ hata: 'Bu e-posta adresiyle kayıtlı hesap bulunmaktadır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const kim = await davetGonder(c, b, { ad: g.ad.trim(), eposta: g.eposta.trim(), telefon: g.telefon?.trim() || undefined, unvan: u.unvan, olusturan: o.kullanici });
      await c.query(`INSERT INTO kurumsal_kullanici (kullanici_ref, kurum_ref, rol, onay_siniri, ekleyen_ref) VALUES ($1,$2,$3,$4,$5)`, [kim, u.kurum_ref, g.rol, g.rol === 'Onaylayan' ? g.sinir : null, o.kullanici]);
      await bildir(c, { olay: `kurumsal-kullanici:${kim}`, kullanicilar: await rolSahipleri(c, await rolId(c, MPM)), baslik: `${u.unvan} · Yeni Kullanıcı`, ozet: `${g.ad.trim()} · ${g.rol}` });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurumsal Kullanıcı Eklendi', nesneTuru: 'Kullanıcı', nesneKimligi: kim, yeni: { rol: g.rol }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
      await c.query('COMMIT');
      return { kimlik: kim };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-1004: kurumdan ayrılan kişinin hesabı kapatılır, yeni temsilciye devredilmez.
  s.post('/kurumsal/kullanici/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const u = await kurumsalKullanici(b.db, o.kullanici); const gerekce = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!u) return yok(y);
    if (!u.yetkili) return y.code(403).send({ hata: 'Hesabı kurum yetkiliniz kapatır.' });
    if (id === o.kullanici) return y.code(409).send({ hata: 'Kendi hesabınızı kapatmak için Müşteri ve Paydaş İlişkileri Müdürü ile görüşmenizi rica ederiz.' });
    if (!(await b.db.query(`SELECT 1 FROM kurumsal_kullanici WHERE kullanici_ref = $1 AND kurum_ref = $2`, [id, u.kurum_ref])).rowCount) return yok(y);
    if (!gerekce) return y.code(400).send({ hata: 'Kapatma nedenini yazmanızı rica ederiz.' });
    await b.db.query(`UPDATE kullanici_hesabi SET hesap_durumu = 'Kapalı' WHERE kimlik = $1`, [id]);
    await b.db.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurumsal Kullanıcı Kapatıldı', nesneTuru: 'Kullanıcı', nesneKimligi: id, gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id, kanal: 'Portal' });
    return { durum: 'Kapalı' };
  });
}
