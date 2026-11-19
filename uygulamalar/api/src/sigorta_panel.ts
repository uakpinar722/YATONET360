import type { FastifyInstance, FastifyReply } from 'fastify';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

const SKGD = 'Strateji ve Kurumsal Gelişim Direktörü'; const MPM = 'Müşteri ve Paydaş İlişkileri Müdürü'; const HUD = 'Hukuk ve Uyum Direktörü';
/** YG-1702: panel başvuru dosyasının içeriği (¶828, Cilt I ¶2489); sunumda süre rakamı yer almaz (K-235). */
export const PANEL_BELGELERI = ['Şirket profili ve organizasyon', 'YATONET 360 tanıtımı', 'Firma adı içermeyen ağ kapsama haritası', 'KVKK ve bilgi güvenliği beyanı', 'Kurumsal sigortalar', 'Referanslar', 'Örnek Fiyat Teklifi ve rapor'];

/** YG-1702 (A54): Sigorta ve Panel: panel başvuruları ve deneme dosyaları, sigorta şirketi denetim talepleri (Hukuk ve Uyum görüşüyle), kurumsal itibar riski acil kartı. */
export function sigortaPanelYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const sirket = async (tsb: string | undefined) => (await b.db.query(`SELECT tsb_kodu, tam_unvan FROM sigorta_sirketi WHERE tsb_kodu = $1`, [tsb ?? ''])).rows[0] as { tsb_kodu: string; tam_unvan: string } | undefined;

  s.get('/sigorta-panel', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolde(o.kullanici, [SKGD, MPM, HUD, 'CEO', 'Genel Müdür Yardımcısı']))) return yok(y);
    return {
      direktor: await rolde(o.kullanici, [SKGD]), hukuk: await rolde(o.kullanici, [HUD]), belgeler: PANEL_BELGELERI,
      sirketler: (await b.db.query(`SELECT tsb_kodu, tam_unvan FROM sigorta_sirketi WHERE durum = 'Aktif' ORDER BY tam_unvan`)).rows,
      basvurular: (await b.db.query(`SELECT p.kimlik, s.tam_unvan, p.belgeler, p.durum, p.gonderim_zamani, p.not_metni, (SELECT string_agg(d.dosya_no, ', ') FROM dosya d WHERE d.kimlik = ANY(p.deneme_dosyalari)) deneme FROM sigorta_panel_basvurusu p JOIN sigorta_sirketi s ON s.tsb_kodu = p.tsb_kodu ORDER BY p.olusturma_zamani DESC LIMIT 100`)).rows,
      denetimler: (await b.db.query(`SELECT t.kimlik, s.tam_unvan, t.konu, t.son_tarih::text son_tarih, t.durum, t.hukuk_gorusu, t.yanit_ozeti, t.yanit_zamani FROM sigorta_denetim_talebi t JOIN sigorta_sirketi s ON s.tsb_kodu = t.tsb_kodu ORDER BY t.durum = 'Yanıtlandı', t.son_tarih LIMIT 100`)).rows,
      itibar: (await b.db.query(`SELECT r.kimlik, r.konu, (SELECT dosya_no FROM dosya WHERE kimlik = r.dosya_ref) dosya_no, r.durum, r.olusturma_zamani FROM kurumsal_itibar_riski r ORDER BY r.durum = 'Açık' DESC, r.olusturma_zamani DESC LIMIT 50`)).rows,
    };
  });

  // Panel başvurusu: dosya içeriği tamamlanmadan "Başvuruyu Gönder" yapılmaz; gönderim sigorta şirketine yalnız e-postayladır (K-185), kayıt gönderimi işler.
  s.post('/sigorta-panel/basvuru', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tsbKodu?: string; belgeler?: string[]; not?: string };
    if (!(await rolde(o.kullanici, [SKGD]))) return yok(y);
    const sg = await sirket(g.tsbKodu); if (!sg) return y.code(400).send({ hata: 'Sigorta şirketini listeden seçiniz.' });
    if ((await b.db.query(`SELECT 1 FROM sigorta_panel_basvurusu WHERE tsb_kodu = $1 AND durum IN ('Hazırlanıyor', 'Gönderildi', 'Deneme Dosyasında')`, [sg.tsb_kodu])).rowCount) return y.code(409).send({ hata: 'Bu sigorta şirketi için açık panel başvurusu vardır.' });
    const bel = (g.belgeler ?? []).filter((x) => PANEL_BELGELERI.includes(x));
    const r = (await b.db.query(`INSERT INTO sigorta_panel_basvurusu (tsb_kodu, belgeler, not_metni, hazirlayan_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [sg.tsb_kodu, bel, g.not?.trim() || null, o.kullanici])).rows[0];
    return { kimlik: r.kimlik };
  });
  s.post('/sigorta-panel/basvuru/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { islem?: string; belgeler?: string[]; dosyaNo?: string; sonuc?: string; not?: string };
    if (!UUID.test(id) || !(await rolde(o.kullanici, [SKGD]))) return yok(y);
    const p = (await b.db.query(`SELECT * FROM sigorta_panel_basvurusu WHERE kimlik = $1`, [id])).rows[0]; if (!p) return yok(y);
    if (g.islem === 'Belgeler') { await b.db.query(`UPDATE sigorta_panel_basvurusu SET belgeler = $2 WHERE kimlik = $1 AND durum = 'Hazırlanıyor'`, [id, (g.belgeler ?? []).filter((x) => PANEL_BELGELERI.includes(x))]); return { tamam: true }; }
    if (g.islem === 'Başvuruyu Gönder') {
      if (p.durum !== 'Hazırlanıyor') return y.code(409).send({ hata: 'Başvuru gönderilmiştir.' });
      const eksik = PANEL_BELGELERI.filter((x) => !(p.belgeler as string[]).includes(x));
      if (eksik.length) return y.code(409).send({ hata: `Başvuru dosyasında eksik: ${eksik.join(', ')}.` });
      await b.db.query(`UPDATE sigorta_panel_basvurusu SET durum = 'Gönderildi', gonderim_zamani = now() WHERE kimlik = $1`, [id]);
    } else if (g.islem === 'Deneme Dosyasını Kabul Et') {
      const d = (await b.db.query(`SELECT kimlik FROM dosya WHERE dosya_no = $1`, [g.dosyaNo?.trim() ?? ''])).rows[0]; if (!d) return y.code(400).send({ hata: 'Dosya numarası bulunamadı.' });
      if (!['Gönderildi', 'Deneme Dosyasında'].includes(p.durum)) return y.code(409).send({ hata: 'Deneme dosyası gönderilmiş başvuruda kabul edilir.' });
      await b.db.query(`UPDATE sigorta_panel_basvurusu SET durum = 'Deneme Dosyasında', deneme_dosyalari = array_append(deneme_dosyalari, $2) WHERE kimlik = $1 AND NOT ($2 = ANY(deneme_dosyalari))`, [id, d.kimlik]);
    } else if (g.islem === 'Sonuç') {
      if (!['Panele Alındı', 'Kabul Edilmedi'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Sonucu seçiniz.' });
      await b.db.query(`UPDATE sigorta_panel_basvurusu SET durum = $2, not_metni = coalesce($3, not_metni), sonuc_zamani = now() WHERE kimlik = $1`, [id, g.sonuc, g.not?.trim() || null]);
    } else return y.code(400).send({ hata: 'İşlemi seçiniz.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Panel Başvurusu: ${g.islem}`, nesneTuru: 'Panel Başvurusu', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // Sigorta şirketi denetim talebi: Direktör kaydeder (yanıt son tarihi Süre Uyarısı), "Hukuk ve Uyum Görüşü İste", "Yanıtı Gönder" (¶855, A51-S9).
  s.post('/sigorta-denetim-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tsbKodu?: string; konu?: string; sonTarih?: string };
    if (!(await rolde(o.kullanici, [SKGD, MPM]))) return yok(y);
    const sg = await sirket(g.tsbKodu); if (!sg) return y.code(400).send({ hata: 'Sigorta şirketini listeden seçiniz.' });
    if (!g.konu?.trim() || !g.sonTarih || !/^\d{4}-\d{2}-\d{2}$/.test(g.sonTarih)) return y.code(400).send({ hata: 'Denetim konusu ve yanıt son tarihi zorunludur.' });
    const r = (await b.db.query(`INSERT INTO sigorta_denetim_talebi (tsb_kodu, konu, son_tarih, kaydeden_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [sg.tsb_kodu, g.konu.trim(), g.sonTarih, o.kullanici])).rows[0];
    await kartAc(b.db, { tur: 'Sigorta Denetim Talebi', kategori: 'islem', baslik: `${sg.tam_unvan} · Denetim Talebi Yanıtı`, ozet: g.konu.trim().slice(0, 200), oncelik: 'Yüksek', sahipRol: await rolId(b.db, SKGD), sonZaman: new Date(`${g.sonTarih}T17:00:00+03:00`), nesneTuru: 'Sigorta Denetim Talebi', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik };
  });
  s.post('/sigorta-denetim-talebi/:id', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { islem?: string; metin?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT t.*, t.son_tarih::text son_gun, s.tam_unvan FROM sigorta_denetim_talebi t JOIN sigorta_sirketi s ON s.tsb_kodu = t.tsb_kodu WHERE t.kimlik = $1`, [id])).rows[0]; if (!t) return yok(y);
    if (t.durum === 'Yanıtlandı') return y.code(409).send({ hata: 'Talep yanıtlanmıştır.' });
    if (g.islem === 'Hukuk ve Uyum Görüşü İste') {
      if (!(await rolde(o.kullanici, [SKGD]))) return yok(y);
      await b.db.query(`UPDATE sigorta_denetim_talebi SET durum = 'Hukuk Görüşünde' WHERE kimlik = $1`, [id]);
      await kartAc(b.db, { tur: 'Sigorta Denetim Hukuk Görüşü', kategori: 'gorev', baslik: `${t.tam_unvan} · Denetim Talebi · Hukuk ve Uyum Görüşü`, ozet: `${t.konu}`.slice(0, 200), sahipRol: await rolId(b.db, HUD), hazirlayan: o.kullanici, sonZaman: new Date(`${t.son_gun}T12:00:00+03:00`), nesneTuru: 'Sigorta Denetim Talebi', nesneKimligi: id });
    } else if (g.islem === 'Görüşü Gönder') {
      if (!(await rolde(o.kullanici, [HUD]))) return yok(y);
      if (!g.metin?.trim()) return y.code(400).send({ hata: 'Görüşünüzü yazınız.' });
      await b.db.query(`UPDATE sigorta_denetim_talebi SET hukuk_gorusu = $2, durum = 'Açık' WHERE kimlik = $1`, [id, g.metin.trim()]);
      await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Sigorta Denetim Hukuk Görüşü' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      await bildir(b.db, { olay: `sigorta-denetim-gorus:${id}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, SKGD)), baslik: `${t.tam_unvan} · Denetim Talebi: Hukuk ve Uyum Görüşü Geldi`, ozet: g.metin.trim().slice(0, 200) });
    } else if (g.islem === 'Yanıtı Gönder') {
      if (!(await rolde(o.kullanici, [SKGD]))) return yok(y);
      if (!g.metin?.trim()) return y.code(400).send({ hata: 'Yanıt özetini yazınız.' });
      await b.db.query(`UPDATE sigorta_denetim_talebi SET yanit_ozeti = $2, yanit_zamani = now(), durum = 'Yanıtlandı', yanitlayan_ref = $3 WHERE kimlik = $1`, [id, g.metin.trim(), o.kullanici]);
      await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur IN ('Sigorta Denetim Talebi', 'Sigorta Denetim Hukuk Görüşü') AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    } else return y.code(400).send({ hata: 'İşlemi seçiniz.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `Sigorta Denetim Talebi: ${g.islem}`, nesneTuru: 'Sigorta Denetim Talebi', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // Kurumsal İtibar Riski · Müşteri Uyuşmazlığı: Direktöre acil kart (sayaçsız); "CEO'ya İlet" (¶858, Cilt I §7.2).
  s.post('/kurumsal-itibar-riski', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { konu?: string; dosyaNo?: string };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    if (!g.konu?.trim()) return y.code(400).send({ hata: 'Konuyu yazınız.' });
    const d = g.dosyaNo?.trim() ? (await b.db.query(`SELECT kimlik FROM dosya WHERE dosya_no = $1`, [g.dosyaNo.trim()])).rows[0] : null;
    if (g.dosyaNo?.trim() && !d) return y.code(400).send({ hata: 'Dosya numarası bulunamadı.' });
    const r = (await b.db.query(`INSERT INTO kurumsal_itibar_riski (konu, dosya_ref, bildiren_ref) VALUES ($1,$2,$3) RETURNING kimlik`, [g.konu.trim(), d?.kimlik ?? null, o.kullanici])).rows[0];
    await kartAc(b.db, { tur: 'Kurumsal İtibar Riski', kategori: 'gorev', baslik: `Kurumsal İtibar Riski · Müşteri Uyuşmazlığı${g.dosyaNo?.trim() ? ` · ${g.dosyaNo.trim()}` : ''}`, ozet: g.konu.trim().slice(0, 300), oncelik: 'Kritik', sahipRol: await rolId(b.db, SKGD), hazirlayan: o.kullanici, nesneTuru: 'Kurumsal İtibar Riski', nesneKimligi: r.kimlik });
    return { kimlik: r.kimlik };
  });
  s.post('/kurumsal-itibar-riski/:id/ceoya-ilet', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { not } = (i.body ?? {}) as { not?: string };
    if (!UUID.test(id) || !(await rolde(o.kullanici, [SKGD]))) return yok(y);
    const r = (await b.db.query(`UPDATE kurumsal_itibar_riski SET durum = 'CEO''ya İletildi', iletim_notu = $2, ileten_ref = $3, iletim_zamani = now() WHERE kimlik = $1 AND durum = 'Açık' RETURNING konu`, [id, not?.trim() || null, o.kullanici])).rows[0];
    if (!r) return y.code(409).send({ hata: 'Kayıt iletilmiştir veya bulunamadı.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Kurumsal İtibar Riski' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await bildir(b.db, { olay: `itibar-ceo:${id}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, 'CEO')), baslik: 'Kurumsal İtibar Riski · Müşteri Uyuşmazlığı', ozet: `${r.konu}${not?.trim() ? ` · ${not.trim()}` : ''}`.slice(0, 300), oncelik: 'Kritik', acil: true, sms: true });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: "İtibar Riski CEO'ya İletildi", nesneTuru: 'Kurumsal İtibar Riski', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
