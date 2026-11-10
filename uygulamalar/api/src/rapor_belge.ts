import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { docxUret } from './docx.js';
import { gostergeleriHesapla } from './gosterge.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { kurumsalKullanici } from './kurumsal.js';
import { nakitTahmini, sigortaciKarlilik } from './nakit_karlilik.js';
import { pdfUret, type BelgeTanim, type Bolum } from './pdf.js';
import { panoGostergeleri } from './yonetim_panosu.js';
import { yonetimRaporu } from './yonetim_raporu.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const t = (x: unknown) => Number(x ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const g = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '—');
const bugun = () => new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
const deger = (v: number | null, b: string) => (v === null ? '—' : b === 'EUR' ? `${t(v)} EUR` : b === '%' ? `%${String(v).replace('.', ',')}` : `${String(v).replace('.', ',')} ${b}`);

/** YG-761: RP-TIC-002 Aylık Yönetim Raporu (iç kayıt). */
export async function yonetimRaporuTanim(db: Db, donem: string): Promise<BelgeTanim> {
  const r = await yonetimRaporu(db, donem);
  const bolumler: Bolum[] = [
    { baslik: 'Özet', tur: 'alanlar', alanlar: [{ et: 'Dönem', deger: donem }, { et: 'Kesim Tarihi', deger: g(r.kesim) }, { et: 'Faturalanmamış İş', deger: `${t(r.toplam.wip)} EUR` }, { et: 'Tahsil Edilmemiş Fatura', deger: `${t(r.toplam.tahsil)} EUR` }, { et: 'Tahsil Edildi, Firmaya Ödenmedi', deger: `${t(r.toplam.firma)} EUR` }] },
    { baslik: 'Faturalanmamış İş (WIP)', tur: 'tablo', sutunlar: [{ ad: 'Dosya No' }, { ad: 'Onaylı Satış (EUR)', hiza: 'sag' }, { ad: 'Faturalanan (EUR)', hiza: 'sag' }, { ad: 'Kalan (EUR)', hiza: 'sag' }], satirlar: r.wip.map((x) => [x.dosya_no, t(x.satis), t(x.faturalanan), t(x.wip)]), toplamlar: [{ et: 'Toplam', deger: t(r.toplam.wip), ana: true }] },
    { baslik: 'Tahsil Edilmemiş Fatura', tur: 'tablo', sutunlar: [{ ad: 'Dosya No' }, { ad: 'Fatura No' }, { ad: 'Muhatap' }, { ad: 'Vade' }, { ad: 'Gecikme (Gün)', hiza: 'sag' }, { ad: 'Kalan (EUR)', hiza: 'sag' }], satirlar: r.tahsil.map((x) => [x.dosya_no, x.fatura_no, x.muhatap, g(x.vade), x.gecikme ?? 0, t(x.kalan)]), toplamlar: [{ et: 'Toplam', deger: t(r.toplam.tahsil), ana: true }] },
    { baslik: 'Tahsil Edildi, Firmaya Ödenmedi', tur: 'tablo', sutunlar: [{ ad: 'Dosya No' }, { ad: 'Tahsilat (EUR)', hiza: 'sag' }, { ad: 'Ödenmemiş Hakediş (EUR)', hiza: 'sag' }], satirlar: r.firma.map((x) => [x.dosya_no, t(x.tahsil), t(x.odenmemis)]), toplamlar: [{ et: 'Toplam', deger: t(r.toplam.firma), ana: true }] },
  ];
  return { ad: 'Aylık Yönetim Raporu', kod: 'RP-TIC-002', no: `RP-TIC-002-${donem}`, tarih: bugun(), surum: 'Rev.1', dil: 'tr', icKayit: true, rapor: true, bolumler };
}

/** YG-762: Aylık CEO Raporu: RP-TIC-002 özeti, Cilt I §9 göstergeleri, pano, 13 haftalık nakit tahmini ve sigortacı kârlılığı (iç kayıt). */
export async function ceoRaporuTanim(db: Db, donem: string): Promise<BelgeTanim> {
  const r = await yonetimRaporu(db, donem); const gs = await gostergeleriHesapla(db, () => true); const pano = await panoGostergeleri(db as Pool, true);
  const n = await nakitTahmini(db); const k = await sigortaciKarlilik(db);
  const bolumler: Bolum[] = [
    { baslik: 'Ticari Özet (RP-TIC-002)', tur: 'alanlar', alanlar: [{ et: 'Dönem', deger: donem }, { et: 'Faturalanmamış İş', deger: `${t(r.toplam.wip)} EUR` }, { et: 'Tahsil Edilmemiş Fatura', deger: `${t(r.toplam.tahsil)} EUR` }, { et: 'Tahsil Edildi, Firmaya Ödenmedi', deger: `${t(r.toplam.firma)} EUR` }] },
    { baslik: 'Cilt I §9 Performans Göstergeleri', tur: 'tablo', sutunlar: [{ ad: 'Tablo', hiza: 'ort' }, { ad: 'Gösterge' }, { ad: 'Değer', hiza: 'sag' }, { ad: 'Hedef', hiza: 'sag' }, { ad: 'Durum' }, { ad: 'Sahip Birim' }], satirlar: gs.map((x) => [x.tablo, x.ad, deger(x.deger, x.birim), x.hedef === null ? '—' : deger(x.hedef, x.birim), x.renk ? { m: x.durum, renk: x.renk } : x.durum, x.birimAdi]) },
    { baslik: 'Operasyon Panosu', tur: 'tablo', sutunlar: [{ ad: 'Gösterge' }, { ad: 'Değer', hiza: 'sag' }, { ad: 'Birim' }], satirlar: pano.map((x) => [x.ad, x.birim === 'EUR' ? `${t(x.deger)} EUR` : x.deger, x.birimAdi]) },
    { baslik: '13 Haftalık Nakit Tahmini (EUR)', tur: 'tablo', sutunlar: [{ ad: 'Hafta' }, { ad: 'Giriş', hiza: 'sag' }, { ad: 'Firma', hiza: 'sag' }, { ad: 'Tedarikçi', hiza: 'sag' }, { ad: 'Genel Gider', hiza: 'sag' }, { ad: 'Net', hiza: 'sag' }, { ad: 'Kümülatif', hiza: 'sag' }], satirlar: n.map((h) => [g(h.baslangic), t(h.giris), t(h.firma), t(h.tedarik), t(h.gider), t(h.net), t(h.kumulatif)]) },
    { baslik: 'Sigortacı Bazında Kârlılık (Son 12 Ay)', tur: 'tablo', sutunlar: [{ ad: 'Sigorta Şirketi' }, { ad: 'Dosya', hiza: 'sag' }, { ad: 'Satış (EUR)', hiza: 'sag' }, { ad: 'Maliyet (EUR)', hiza: 'sag' }, { ad: 'Katkı (EUR)', hiza: 'sag' }, { ad: 'Oran', hiza: 'sag' }], satirlar: k.map((x) => [x.sigortaci_adi, x.dosya, t(x.satis), t(x.maliyet), t(x.katki), x.oran ? `%${String(x.oran).replace('.', ',')}` : '—']) },
  ];
  return { ad: 'Aylık CEO Raporu', no: `CEO-${donem}`, tarih: bugun(), surum: 'Rev.1', dil: 'tr', icKayit: true, rapor: true, bolumler };
}

/** YG-765: Kurumsal Aylık Filo ve Cari Hesap Raporu (A4, kaşeli; kuruma gider). */
export async function kurumsalRaporTanim(db: Db, id: string): Promise<BelgeTanim> {
  const r = (await db.query(`SELECT r.donem, r.icerik, r.itiraz_son, u.unvan FROM kurumsal_rapor r JOIN kurumsal_kurum u ON u.kimlik = r.kurum_ref WHERE r.kimlik = $1`, [id])).rows[0];
  const i = r.icerik as { kesim: string; filo: { yat_adi: string; dosya_no: string; statu: string; asama: string | null; acilis: string }[]; cari: { dosya_no: string; fatura_no: string; fatura_tarihi: string; vade: string | null; toplam_eur: string; tahsil: string }[]; bakiye: number };
  const bolumler: Bolum[] = [
    { baslik: 'Kurum ve Dönem', tur: 'alanlar', alanlar: [{ et: 'Kurum', deger: r.unvan, genis: true }, { et: 'Dönem', deger: r.donem }, { et: 'Kesim Tarihi', deger: g(i.kesim) }, { et: 'İtiraz Son Tarihi', deger: r.itiraz_son ? new Date(r.itiraz_son).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—' }] },
    { baslik: 'Filo ve Dosyalar', tur: 'tablo', sutunlar: [{ ad: 'Yat' }, { ad: 'Dosya No' }, { ad: 'Statü' }, { ad: 'Aşama' }, { ad: 'Açılış' }], satirlar: i.filo.map((x) => [x.yat_adi, x.dosya_no, x.statu, x.asama, x.acilis]) },
    { baslik: 'Cari Hesap', tur: 'tablo', sutunlar: [{ ad: 'Dosya No' }, { ad: 'Fatura No' }, { ad: 'Fatura Tarihi' }, { ad: 'Vade' }, { ad: 'Tutar (EUR)', hiza: 'sag' }, { ad: 'Tahsil (EUR)', hiza: 'sag' }, { ad: 'Kalan (EUR)', hiza: 'sag' }], satirlar: i.cari.map((x) => [x.dosya_no, x.fatura_no, g(x.fatura_tarihi), g(x.vade), t(x.toplam_eur), t(x.tahsil), t(Number(x.toplam_eur) - Number(x.tahsil))]), toplamlar: [{ et: 'Açık Bakiye', deger: t(i.bakiye), ana: true }] },
  ];
  return { ad: 'Kurumsal Aylık Filo ve Cari Hesap Raporu', no: `KFR-${r.donem}-${id.slice(0, 8).toUpperCase()}`, tarih: bugun(), surum: 'Rev.1', dil: 'tr', kase: true, bolumler };
}

export async function belgeIcerik(tanim: BelgeTanim, bicim: string): Promise<{ veri: Buffer; tur: string; uzanti: string }> {
  return bicim === 'docx' ? { veri: docxUret(tanim), tur: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', uzanti: 'docx' } : { veri: await pdfUret(tanim), tur: 'application/pdf', uzanti: 'pdf' };
}

export function raporBelgeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const donem = (q: unknown) => { const d = (q as { donem?: string }).donem; const n = new Date(); return d && /^\d{4}-(0[1-9]|1[0-2])$/.test(d) ? d : new Date(Date.UTC(n.getFullYear(), n.getMonth() - 1, 1)).toISOString().slice(0, 7); };
  const gonder = async (y: FastifyReply, tanim: BelgeTanim, q: unknown) => { const x = await belgeIcerik(tanim, (q as { bicim?: string }).bicim === 'docx' ? 'docx' : 'pdf'); return y.header('content-type', x.tur).header('content-disposition', `attachment; filename="${tanim.no}.${x.uzanti}"`).send(x.veri); };
  s.get('/yonetim-raporu/belge', oturumlu, async (i, y) => ((await rolVar(i.oturum!.kullanici, ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü', 'Muhasebe ve Finans Müdürü', 'Muhasebe ve Finans Müdür Yardımcısı', 'Muhasebe ve Finans Yöneticisi'])) ? gonder(y, await yonetimRaporuTanim(b.db, donem(i.query)), i.query) : yok(y)));
  s.get('/ceo-raporu/belge', oturumlu, async (i, y) => ((await rolVar(i.oturum!.kullanici, ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü'])) ? gonder(y, await ceoRaporuTanim(b.db, donem(i.query)), i.query) : yok(y)));
  s.get('/kurumsal-rapor/:id/belge', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; if (!UUID.test(id) || !(await rolVar(i.oturum!.kullanici, ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü']))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM kurumsal_rapor WHERE kimlik = $1`, [id])).rowCount) return yok(y);
    return gonder(y, await kurumsalRaporTanim(b.db, id), i.query);
  });
  s.get('/kurumsal/rapor/:id/belge', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string }; const u = await kurumsalKullanici(b.db, i.oturum!.kullanici); if (!UUID.test(id) || !u) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM kurumsal_rapor WHERE kimlik = $1 AND kurum_ref = $2 AND durum IN ('Gönderildi', 'İtirazlı', 'Mutabık')`, [id, u.kurum_ref])).rowCount) return yok(y);
    return gonder(y, await kurumsalRaporTanim(b.db, id), i.query);
  });
}
