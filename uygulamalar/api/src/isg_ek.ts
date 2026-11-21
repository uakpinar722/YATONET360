import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

const ISG = 'İSG Sorumlusu'; const IKM = 'İnsan Kaynakları Müdürü'; const IKS = 'İnsan Kaynakları Sorumlusu';
const SONUC = ['Çalışmaya Uygun', 'Çalışmaya Uygun Değil']; const YON = ["OSGB'den Gelen", "OSGB'ye İletilen"];
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** YG-1670: her ayın başında önceki ayın İSG göstergeleri (iş kazası, iş durdurma, çalışma izni belgeleri, sağlık gözetimi) Kalite Müdür Yardımcısına (yoksa Kalite Müdürüne) rapor görevi olarak sunulur; bir kez. */
export async function isgAylikRapor(db: Pool, simdi = new Date()): Promise<boolean> {
  const { birKez } = await import('./bildirim.js'); const { kartAc } = await import('./is_motoru.js');
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const bas = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1)); const bit = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1));
  const donem = bas.toISOString().slice(0, 7);
  if (!(await birKez(db, 'isg_aylik', donem))) return false;
  const p = [`${donem}-01T00:00:00+03:00`, `${bit.toISOString().slice(0, 10)}T00:00:00+03:00`];
  const s = (await db.query(`SELECT (SELECT count(*)::int FROM olay_kaydi WHERE olay_turu = 'İş Kazası' AND olusturma_zamani >= $1 AND olusturma_zamani < $2) kaza,
      (SELECT count(*)::int FROM denetim_izi WHERE eylem = 'İş Durduruldu' AND olay_zamani >= $1 AND olay_zamani < $2) durdurma,
      (SELECT count(*)::int FROM calisma_izni_belgesi WHERE baslangic >= $1 AND baslangic < $2) izin,
      (SELECT count(*)::int FROM saglik_gozetimi WHERE muayene_tarihi >= $1::date AND muayene_tarihi < $2::date) muayene,
      (SELECT count(*)::int FROM saglik_gozetimi WHERE sonuc = 'Çalışmaya Uygun Değil' AND muayene_tarihi >= $1::date AND muayene_tarihi < $2::date) uygun_degil`, p)).rows[0];
  const kmy = await rolId(db, 'Kalite Müdür Yardımcısı'); const sahip = (await rolSahipleri(db, kmy)).length ? kmy : await rolId(db, 'Kalite Müdürü');
  await kartAc(db, { tur: 'Aylık İSG Göstergeleri', kategori: 'gorev', baslik: `${donem} · Aylık İSG Göstergeleri`, ozet: `İş kazası ${s.kaza} · Emniyet nedeniyle iş durdurma ${s.durdurma} · Çalışma izni belgesi ${s.izin} · Sağlık muayenesi ${s.muayene} (uygun değil ${s.uygun_degil}). Göstergeleri inceleyiniz.`, sahipRol: sahip, nesneTuru: 'İSG Dönemi', nesneKimligi: donem });
  return true;
}

/** YG-1670: İSG Sorumlusu sağlık gözetiminde yalnız muayene tarihi ve "Çalışmaya Uygun / Uygun Değil" sonucunu kaydeder (tanı ve sağlık bilgisi tutulmaz); OSGB'den gelen belgeler ve OSGB'ye iletilen bilgiler kayda alınır. */
export function isgEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);

  s.get('/isg/kayitlar', oturumlu, async (i, y) => {
    const r = await roller(i.oturum!.kullanici); const isg = r.includes(ISG);
    if (!isg && !r.some((x) => [IKM, IKS].includes(x))) return yok(y);
    const personel = (await b.db.query(`SELECT h.kimlik, h.ad_soyad FROM kullanici_hesabi h WHERE h.kullanici_grubu = 'LGM İç Rolü' AND h.hesap_durumu = 'Aktif' ORDER BY h.ad_soyad`)).rows;
    const gozetim = (await b.db.query(`SELECT DISTINCT ON (g.personel_ref) g.kimlik, h.ad_soyad, g.muayene_tarihi::text, g.sonuc, g.sonraki_muayene::text FROM saglik_gozetimi g JOIN kullanici_hesabi h ON h.kimlik = g.personel_ref ORDER BY g.personel_ref, g.muayene_tarihi DESC, g.zaman DESC`)).rows;
    const osgb = isg ? (await b.db.query(`SELECT kimlik, yon, konu, tarih::text, belge_ref FROM osgb_yazisma ORDER BY tarih DESC, zaman DESC LIMIT 100`)).rows : [];
    return { isg, personel: isg ? personel : [], gozetim, osgb };
  });
  s.post('/isg/saglik-gozetimi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { personel?: string; tarih?: string; sonuc?: string; sonraki?: string };
    if (!(await roller(o.kullanici)).includes(ISG)) return yok(y);
    if (!g.personel || !TARIH.test(g.tarih ?? '') || !SONUC.includes(g.sonuc ?? '') || (g.sonraki && !TARIH.test(g.sonraki))) return y.code(400).send({ hata: 'Personel, muayene tarihi ve sonuç (Çalışmaya Uygun / Uygun Değil) zorunludur; tanı veya sağlık bilgisi yazılmaz.' });
    if (!(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü'`, [g.personel])).rowCount) return y.code(400).send({ hata: 'Personel kaydı bulunamadı; bilgileri kontrol etmenizi rica ederiz.' });
    const r = (await b.db.query(`INSERT INTO saglik_gozetimi (personel_ref, muayene_tarihi, sonuc, sonraki_muayene, kaydeden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.personel, g.tarih, g.sonuc, g.sonraki || null, o.kullanici])).rows[0];
    if (g.sonuc === 'Çalışmaya Uygun Değil') await bildir(b.db, { olay: `saglik-uygun-degil:${r.kimlik}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, IKM)), baslik: 'Sağlık Gözetimi · Çalışmaya Uygun Değil', ozet: 'Görev düzenlemesi için personel kaydını inceleyiniz.', oncelik: 'Yüksek' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sağlık Gözetimi Kaydı', nesneTuru: 'Personel', nesneKimligi: g.personel, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });
  s.post('/isg/osgb', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { yon?: string; konu?: string; tarih?: string; belge?: string };
    if (!(await roller(o.kullanici)).includes(ISG)) return yok(y);
    if (!YON.includes(g.yon ?? '') || !g.konu?.trim() || !TARIH.test(g.tarih ?? '') || (g.belge && !UUID.test(g.belge))) return y.code(400).send({ hata: 'Yön, konu ve tarih zorunludur.' });
    return { kimlik: (await b.db.query(`INSERT INTO osgb_yazisma (yon, konu, tarih, belge_ref, kaydeden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.yon, g.konu.trim(), g.tarih, g.belge || null, o.kullanici])).rows[0].kimlik };
  });
}
