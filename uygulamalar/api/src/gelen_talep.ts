import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, mesaiIcinde } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const EPOSTA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MPM = 'Müşteri ve Paydaş İlişkileri Müdürü'; const MPY = 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı';
const TUR = 'Gelen Talep';

/**
 * YG-1543, YG-1554, YG-1508 (K-211, D-054): web formundan gelen talep konuya göre doğrudan ilgili role yönlendirilir.
 * Basında sözcülüğü atamaya kadar Genel Müdür Yardımcısı yürütür (K-235). "Diğer" ve konusu belirsiz talep Müşteri ve Paydaş İlişkileri Müdürlüğünde yönlendirilir.
 */
export const KONU_ROL: Record<string, string> = {
  'Yat / hasar / bakım': 'Operasyon Müdürü',
  'Firma / tedarikçi': 'Firma Yönetimi Müdürü',
  'İş başvurusu': 'İnsan Kaynakları Müdürü',
  'Basın': 'Genel Müdür Yardımcısı',
  'Fatura / ödeme': 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)',
  'Garanti veya şikâyet bildirimi': MPY,
  'Kişisel veri başvurusu': 'Hukuk ve Uyum Direktörü',
  'Diğer': MPM,
};
const YONLENDIRILEBILIR = [...new Set(Object.values(KONU_ROL)), 'Teknik Müdür', 'Ticari İşler Direktörü', 'Bilgi İşlem Müdürü'];

/** Hedef rolde görev açar; kişisel veri başvurusunda 30 gün, diğerlerinde mesai içi 1 saat, mesai dışı ertesi mesai başlangıcından 1 saat. */
async function hedefeGorevAc(c: Db, t: { kimlik: string; talep_no: string; konu: string; ozet: string }, rol: string, simdi = new Date()) {
  let son: Date;
  if (t.konu === 'Kişisel veri başvurusu') son = new Date(simdi.getTime() + 30 * 86_400_000);
  else if (mesaiIcinde(simdi)) son = new Date(simdi.getTime() + 3_600_000);
  else { const { bitisKaydir, tatilGunleri } = await import('./sure.js'); son = bitisKaydir(new Date(simdi.getTime() + 3_600_000), 'Normal', await tatilGunleri(c)).bitis; }
  await kartAc(c, { tur: TUR, kategori: 'gorev', baslik: `${t.talep_no} · ${t.konu}`, ozet: t.ozet.slice(0, 300), sahipRol: await rolId(c, rol), sonZaman: son, nesneTuru: TUR, nesneKimligi: t.kimlik });
  await c.query(`UPDATE gelen_talep SET durum = $2, yonlenen_rol = $3 WHERE kimlik = $1`, [t.kimlik, rol === MPM && t.konu === 'Diğer' ? 'Yönlendirme bekliyor' : 'Yönlendirildi', rol]);
}

export function gelenTalepYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const mpi = async (k: string) => (await rolSahipleri(b.db, await rolId(b.db, MPM))).includes(k) || (await rolSahipleri(b.db, await rolId(b.db, MPY))).includes(k);

  s.get('/iletisim/gelen-talep-konulari', async () => Object.keys(KONU_ROL));
  // Herkese açık (web sitesi formu); saatte 5'ten fazla talep aynı adresten kabul edilmez.
  s.post('/iletisim/gelen-talep', async (i, y) => {
    const g = (i.body ?? {}) as { konu?: string; adSoyad?: string; eposta?: string; telefon?: string; mesaj?: string; dosyaNo?: string };
    const konu = KONU_ROL[g.konu ?? ''] ? g.konu! : 'Diğer';
    const ad = (g.adSoyad ?? '').trim(); const ep = (g.eposta ?? '').trim(); const mesaj = (g.mesaj ?? '').trim();
    if (!ad || !EPOSTA.test(ep) || !mesaj) return y.code(400).send({ hata: 'Ad soyad, e-posta ve mesaj zorunludur.' });
    if (konu === 'Garanti veya şikâyet bildirimi' && !g.dosyaNo?.trim()) return y.code(400).send({ hata: 'Garanti veya şikâyet bildiriminde dosya numarasını yazmanızı rica ederiz.' });
    if (Number((await b.db.query(`SELECT count(*) n FROM gelen_talep WHERE adres = $1 AND olusturma_zamani > now() - interval '1 hour'`, [i.ip])).rows[0].n) >= 5) return y.code(429).send({ hata: 'Çok sayıda talep gönderildi; lütfen daha sonra tekrar deneyiniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const no = `GT-${new Date().getFullYear()}-${String((await c.query(`SELECT nextval('gelen_talep_no') n`)).rows[0].n).padStart(4, '0')}`;
      const t = (await c.query(`INSERT INTO gelen_talep (talep_no, kanal, konu, ad_soyad, e_posta, telefon, mesaj, dosya_no, adres) VALUES ($1,'Web Formu',$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`,
        [no, konu, ad.slice(0, 120), ep, (g.telefon ?? '').trim().slice(0, 30) || null, mesaj.slice(0, 4000), g.dosyaNo?.trim().slice(0, 40) || null, i.ip])).rows[0].kimlik as string;
      await hedefeGorevAc(c, { kimlik: t, talep_no: no, konu, ozet: mesaj }, KONU_ROL[konu]!);
      await c.query('COMMIT');
      return { tamam: true, talepNo: no };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.get('/gelen-talepler', oturumlu, async (i, y) => {
    if (!(await mpi(i.oturum!.kullanici))) return yok(y);
    return { roller: YONLENDIRILEBILIR, talepler: (await b.db.query(`SELECT kimlik, talep_no, kanal, konu, ad_soyad, e_posta, telefon, mesaj, dosya_no, durum, yonlenen_rol, olusturma_zamani FROM gelen_talep ORDER BY olusturma_zamani DESC LIMIT 100`)).rows };
  });
  // "Diğer" veya yanlış konudaki talep Müşteri ve Paydaş İlişkileri Müdürlüğünce seçilen role yönlendirilir.
  s.post('/gelen-talep/:id/yonlendir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { rol } = (i.body ?? {}) as { rol?: string };
    if (!UUID.test(id) || !(await mpi(o.kullanici))) return yok(y);
    if (!YONLENDIRILEBILIR.includes(rol ?? '')) return y.code(400).send({ hata: 'Yönlendirilecek birimi seçiniz.' });
    const t = (await b.db.query(`SELECT kimlik, talep_no, konu, mesaj FROM gelen_talep WHERE kimlik = $1`, [id])).rows[0];
    if (!t) return yok(y);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [TUR, id]);
    await hedefeGorevAc(b.db, { kimlik: id, talep_no: t.talep_no, konu: t.konu, ozet: t.mesaj }, rol!);
    await b.db.query(`UPDATE gelen_talep SET durum = 'Yönlendirildi', yonlendiren_ref = $2 WHERE kimlik = $1`, [id, o.kullanici]);
    await bildir(b.db, { olay: `gelen-talep-yon:${id}:${rol}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, rol!)), baslik: `Gelen Talep Yönlendirildi: ${t.talep_no}`, ozet: t.konu });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Gelen Talep Yönlendirildi', nesneTuru: TUR, nesneKimligi: id, yeni: { rol }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
