import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez, disGonder } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { kurumsalKullanici } from './kurumsal.js';
import { rolSahipleri } from './makam.js';
import { metinGetir } from './metin.js';
import { isGunuSonu } from './teklif.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const TUR = 'Kurumsal Aylık Rapor Onayı'; const TID = 'Ticari İşler Direktörü';
let WEB = '';

/** Kurumun filosu: yat sahibi tarafı kurum olan yatlar ve dosyaları; cari: dönem sonu itibarıyla faturalar ve tahsilat. */
export async function kurumsalRaporIcerik(db: Db, kurum: string, donem: string) {
  const son = new Date(`${donem}-01T00:00:00Z`); son.setUTCMonth(son.getUTCMonth() + 1); const kesim = son.toISOString().slice(0, 10);
  const taraf = (await db.query(`SELECT taraf_ref FROM kurumsal_kurum WHERE kimlik = $1`, [kurum])).rows[0].taraf_ref;
  const filo = (await db.query(`SELECT y.yat_adi, d.dosya_no, d.statu, d.asama, to_char(d.olusturma_zamani AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY') acilis FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE y.yat_sahibi_ref = $1 AND d.olusturma_zamani < $2 ORDER BY y.yat_adi, d.dosya_no`, [taraf, kesim])).rows;
  const cari = (await db.query(`SELECT d.dosya_no, f.fatura_no, f.fatura_tarihi::text, f.vade::text, f.toplam_eur, coalesce((SELECT sum(t.tutar_eur) FROM tahsilat t WHERE t.fatura_ref = f.kimlik AND t.tarih < $2), 0) tahsil FROM musteri_faturasi f JOIN dosya d ON d.kimlik = f.dosya_ref JOIN yat y ON y.kimlik = d.yat_ref WHERE y.yat_sahibi_ref = $1 AND f.fatura_no IS NOT NULL AND f.fatura_tarihi < $2 ORDER BY f.fatura_tarihi`, [taraf, kesim])).rows;
  const bakiye = Math.round(cari.reduce((a, x) => a + Number(x.toplam_eur) - Number(x.tahsil), 0) * 100) / 100;
  return { donem, kesim, filo, cari, bakiye };
}

kapanisKaydet(TUR, async (c, k, karar, yapan) => {
  const r = (await c.query(`SELECT r.*, u.unvan FROM kurumsal_rapor r JOIN kurumsal_kurum u ON u.kimlik = r.kurum_ref WHERE r.kimlik = $1::uuid AND r.durum = 'TİD Onayında'`, [k.nesne_kimligi])).rows[0];
  if (!r) return;
  if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') { await c.query(`UPDATE kurumsal_rapor SET durum = 'Hazırlıkta' WHERE kimlik = $1`, [r.kimlik]); return; }
  if (karar !== 'Onayla') return;
  const itirazSon = await isGunuSonu(c, new Date(), 10);
  await c.query(`UPDATE kurumsal_rapor SET durum = 'Gönderildi', gonderim_zamani = now(), itiraz_son = $2 WHERE kimlik = $1`, [r.kimlik, itirazSon]);
  const tarih = itirazSon.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
  // A4 PDF rapor kaydedilir ve BLD-31 ekiyle gider.
  const { kurumsalRaporTanim } = await import('./rapor_belge.js'); const { pdfUret } = await import('./pdf.js'); const { Depo } = await import('./depo.js'); const { Readable } = await import('node:stream');
  const tanim = await kurumsalRaporTanim(c, r.kimlik); const pdf = await pdfUret(tanim); const depo = new Depo(); const al = await depo.al(Readable.from(pdf), pdf.length + 1); const anahtar = depo.yerlestir(al.yol, al.ozet);
  const be = (await c.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, belge_tarihi, olusturan_ref) VALUES ($1,'Kurumsal Aylık Rapor','Gizli','Kurumsal Rapor',$2,'Sistem',(now() AT TIME ZONE 'Europe/Istanbul')::date,$3) RETURNING kimlik`, [`${tanim.ad} ${tanim.no}`, r.kimlik, yapan])).rows[0].kimlik;
  const sv = (await c.query(`INSERT INTO belge_surum (belge_ref, surum_no, dosya_adi, uzanti, boyut, ozet_sha256, depo_anahtari, tarama_kaynagi, yukleyen_ref, durum, onay_zamani) VALUES ($1,1,$2,'pdf',$3,$4,$5,'Sistem',$6,'Yürürlükte',now()) RETURNING kimlik`, [be, `${tanim.no}.pdf`, al.boyut, al.ozet, anahtar, yapan])).rows[0].kimlik as string;
  await c.query(`UPDATE kurumsal_rapor SET pdf_surum_ref = $2 WHERE kimlik = $1`, [r.kimlik, sv]);
  for (const u of (await c.query(`SELECT h.e_posta FROM kurumsal_kullanici k JOIN kullanici_hesabi h ON h.kimlik = k.kullanici_ref WHERE k.kurum_ref = $1 AND h.hesap_durumu = 'Aktif' AND h.e_posta IS NOT NULL`, [r.kurum_ref])).rows) {
    const metin = await metinGetir(c, 'BLD-31', 'tr', { 'dönem': r.donem, period: r.donem, 'bağlantı': WEB, link: WEB, 'itiraz son tarihi': tarih, 'objection deadline': tarih });
    await disGonder(c, { olay: `bld31:${r.kimlik}:${u.e_posta}`, eposta: u.e_posta, konu: `${r.unvan} · ${r.donem} Kurumsal Aylık Filo ve Cari Hesap Raporu`, metin, ekler: [sv] });
  }
});

/**
 * YG-765: kurumsal müşteri aylık filo ve cari hesap raporu ay sonunda kesilir; izleyen ayın 5. iş günü 12.00'ye kadar Ticari İşler Direktörü onayıyla
 * BLD-31 ile gönderilir; 10 iş günü itiraz süresi izlenir, süre itirazsız biterse rapor mutabık sayılır. Portal filo panosu kurum kullanıcısına açıktır.
 */
export async function kurumsalRaporIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  const o = new Date(Date.UTC(simdi.getFullYear(), simdi.getMonth() - 1, 1)); const donem = o.toISOString().slice(0, 7);
  const ayBasi = new Date(simdi.getFullYear(), simdi.getMonth(), 1); const son = await isGunuSonu(db, new Date(+ayBasi - 86_400_000), 5); son.setHours(12, 0, 0, 0);
  for (const k of (await db.query(`SELECT kimlik, unvan FROM kurumsal_kurum`)).rows) {
    if (!(await birKez(db, 'kurumsal-rapor', `${k.kimlik}:${donem}`))) continue;
    const r = (await db.query(`INSERT INTO kurumsal_rapor (kurum_ref, donem, icerik, son_gonderim) VALUES ($1,$2,$3,$4) ON CONFLICT (kurum_ref, donem) DO NOTHING RETURNING kimlik`, [k.kimlik, donem, JSON.stringify(await kurumsalRaporIcerik(db, k.kimlik, donem)), son])).rows[0];
    if (!r) continue;
    await kartAc(db, { tur: TUR, baslik: `${k.unvan} · ${donem} Filo ve Cari Hesap Raporu`, ozet: 'Raporu kontrol edip onaylayınız; onayla birlikte kuruma gönderilir.', zincir: [await rolId(db, TID)], sonZaman: son, nesneTuru: 'Kurumsal Rapor', nesneKimligi: r.kimlik }); n++;
  }
  for (const r of (await db.query(`UPDATE kurumsal_rapor SET durum = 'Mutabık' WHERE durum = 'Gönderildi' AND itiraz_son < $1 RETURNING kimlik`, [simdi])).rows) { void r; n++; }
  return n;
}

export function kurumsalRaporYollari(s: FastifyInstance, b: Baglam) {
  WEB = b.webAdresi;
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  // Portal filo panosu ve gönderilmiş raporlar; yalnız kendi kurumunun kaydı.
  s.get('/kurumsal/filo', oturumlu, async (i, y) => {
    const u = await kurumsalKullanici(b.db, i.oturum!.kullanici); if (!u) return yok(y);
    const n = new Date(); const donem = new Date(Date.UTC(n.getFullYear(), n.getMonth(), 1)).toISOString().slice(0, 7);
    return { anlik: await kurumsalRaporIcerik(b.db, u.kurum_ref, donem), raporlar: (await b.db.query(`SELECT kimlik, donem, durum, itiraz_son, itiraz FROM kurumsal_rapor WHERE kurum_ref = $1 AND durum IN ('Gönderildi', 'İtirazlı', 'Mutabık') ORDER BY donem DESC LIMIT 12`, [u.kurum_ref])).rows };
  });
  s.get('/kurumsal/rapor/:id', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; const u = await kurumsalKullanici(b.db, i.oturum!.kullanici); if (!UUID.test(id) || !u) return yok(y);
    const r = (await b.db.query(`SELECT donem, durum, icerik, itiraz_son, itiraz FROM kurumsal_rapor WHERE kimlik = $1 AND kurum_ref = $2 AND durum IN ('Gönderildi', 'İtirazlı', 'Mutabık')`, [id, u.kurum_ref])).rows[0];
    return r ?? yok(y);
  });
  s.post('/kurumsal/rapor/:id/itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { itiraz?: string };
    const u = await kurumsalKullanici(b.db, o.kullanici); if (!UUID.test(id) || !u) return yok(y);
    if (!g.itiraz?.trim()) return y.code(400).send({ hata: 'İtiraz konusunu yazınız.' });
    const r = (await b.db.query(`UPDATE kurumsal_rapor SET durum = 'İtirazlı', itiraz = $3, itiraz_eden_ref = $4, itiraz_zamani = now() WHERE kimlik = $1 AND kurum_ref = $2 AND durum = 'Gönderildi' AND itiraz_son >= now() RETURNING donem`, [id, u.kurum_ref, g.itiraz.trim(), o.kullanici])).rows[0];
    if (!r) return y.code(409).send({ hata: 'İtiraz süresi dolmuştur veya rapora itiraz edilmiştir.' });
    await bildir(b.db, { olay: `kurumsal-itiraz:${id}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, TID)), baslik: `Kurumsal Rapor İtirazı: ${u.unvan} ${r.donem}`, ozet: g.itiraz.trim().slice(0, 200), oncelik: 'Yüksek' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kurumsal Rapor İtirazı', nesneTuru: 'Kurumsal Rapor', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
