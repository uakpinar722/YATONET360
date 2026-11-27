import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayFormKaydet, onaySonucKaydet, onayTalebiAc } from './onay.js';
import { UUID } from './yat.js';

/**
 * YG-1463, YG-478, V-1128: paylı yatta malikler SMS kodlu ONY-11M ekranında tek yetkili maliki seçer (metin CEO onaylı, 27.11.2026).
 * Bütün malikler aynı kişiyi seçince o kişi yetkili malik olur; yatın açık dosyalarında onay ve fatura muhatabı (Yat Sahibi tarafı) ona geçer.
 * Seçimler farklıysa Dosya Sorumlusuna görev düşer. Telefonu veya taraf kaydı olmayan malik için beyan ekranı açılmaz.
 */
const ONY = 'ONY-11M'; const FORM = 'Yetkili Malik Seçimi';

onayFormKaydet(FORM, async (db, t, f) => {
  const s = (t.secenekler ?? []) as { kimlik: string }[];
  return f?.malik && s.some((x) => x.kimlik === f.malik) ? null : 'Yetkili maliki listeden seçiniz.';
});

onaySonucKaydet(ONY, async (c, t, karar, k) => {
  if (karar !== 'Onaylandı') return;
  const oy = t.nesne_turu === 'Yat Maliki' ? (await c.query(`SELECT kimlik, yat_ref FROM yat_malik WHERE kimlik::text = $1`, [t.nesne_kimligi])).rows[0] : undefined;
  if (!oy) return;
  await c.query(`INSERT INTO yetkili_malik_oyu (yat_ref, malik_ref, secilen_ref, onay_ref) VALUES ($1,$2,$3,$4)`, [oy.yat_ref, oy.kimlik, k.form.malik, t.kimlik]);
  await sonuclandir(c, oy.yat_ref, t.dosya_ref);
});

/** Bütün malikler oy verdiyse sonuç: oybirliğinde yetkili malik atanır ve muhatap geçer, farklı seçimde Dosya Sorumlusuna görev. */
async function sonuclandir(c: PoolClient, yat: string, dosya: string) {
  const m = (await c.query(`SELECT m.kimlik, m.ad, m.taraf_ref, o.secilen_ref FROM yat_malik m LEFT JOIN LATERAL (SELECT secilen_ref FROM yetkili_malik_oyu o WHERE o.malik_ref = m.kimlik AND o.yat_ref = m.yat_ref AND o.gecerli ORDER BY o.zaman DESC LIMIT 1) o ON true WHERE m.yat_ref = $1`, [yat])).rows;
  if (m.some((x) => !x.secilen_ref)) return;
  const d = (await c.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [dosya])).rows[0];
  const secimler = new Set(m.map((x) => x.secilen_ref as string));
  if (secimler.size > 1) { await kartAc(c, { tur: 'Eksik Bilgi', kategori: 'gorev', baslik: `${d.dosya_no} · Malikler Farklı Yetkili Malik Seçti`, ozet: 'Maliklerle görüşüp seçimin yenilenmesini sağlayınız.', sahipRol: await rolId(c, 'Dosya Sorumlusu'), nesneTuru: 'Dosya', nesneKimligi: dosya }); return; }
  const sec = m.find((x) => x.kimlik === [...secimler][0])!;
  await c.query(`UPDATE yat_malik SET yetkili = false WHERE yat_ref = $1 AND yetkili`, [yat]);
  await c.query(`UPDATE yat_malik SET yetkili = true WHERE kimlik = $1`, [sec.kimlik]);
  if (!sec.taraf_ref) return;
  await c.query(`UPDATE yat SET yetkili_malik_ref = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [yat, sec.taraf_ref]);
  // Onay ve fatura muhatabı: açık dosyalarda Yat Sahibi tarafı yetkili malik olur; eski kayıt bitiş gerekçesiyle saklanır.
  const tr = (await c.query(`SELECT unvan_ad_soyad, telefon, eposta, kullanici_ref FROM taraf WHERE kimlik = $1`, [sec.taraf_ref])).rows[0];
  for (const x of (await c.query(`SELECT kimlik FROM dosya WHERE yat_ref = $1 AND statu NOT IN ('Kapalı')`, [yat])).rows) {
    const var0 = (await c.query(`SELECT kimlik, taraf_ref FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif`, [x.kimlik])).rows[0];
    if (var0?.taraf_ref === sec.taraf_ref) continue;
    if (var0) await c.query(`UPDATE dosya_tarafi SET aktif = false, bitis_zamani = now(), bitis_gerekcesi = 'Paylı yatta yetkili malik seçildi' WHERE kimlik = $1`, [var0.kimlik]);
    await c.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_ref, taraf_rolu, kisi_adi_soyadi, telefon, eposta, kullanici_ref, sifat) VALUES ($1,$2,'Yat Sahibi',$3,$4,$5,$6,'Yetkili Malik')`, [x.kimlik, sec.taraf_ref, tr.unvan_ad_soyad, tr.telefon, tr.eposta, tr.kullanici_ref]);
  }
  await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE nesne_kimligi = $1 AND durum = 'Bekliyor' AND baslik LIKE '%Yetkili Malik Atanacak'`, [dosya]);
  await izYaz(c, { eylem: 'Yetkili Malik Belirlendi (Malik Beyanı)', nesneTuru: 'Yat', nesneKimligi: yat, yeni: { malik: sec.ad }, sonuc: 'Başarılı' });
}

export function yetkiliMalikYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  // Dosya Sorumlusu malik kayıtlarını tamamlayınca beyan ekranını bütün maliklere SMS koduyla açar.
  s.post('/dosya/:id/yetkili-malik-beyani', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const d = (await b.db.query(`SELECT d.yat_ref, d.yazisma_dili, y.yat_adi, y.mulkiyet_turu FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref WHERE d.kimlik = $1`, [id])).rows[0];
    const m = (await b.db.query(`SELECT m.kimlik, m.ad, m.taraf_ref, t.telefon, t.eposta, t.kullanici_ref FROM yat_malik m LEFT JOIN taraf t ON t.kimlik = m.taraf_ref WHERE m.yat_ref = $1 ORDER BY m.ad`, [d.yat_ref])).rows;
    if (m.length < 2) return y.code(409).send({ hata: 'Yetkili malik seçimi için en az iki malik kaydı gerekir.' });
    const eksik = m.filter((x) => !x.taraf_ref || (!x.telefon && !x.eposta));
    if (eksik.length) return y.code(409).send({ hata: `Malik kaydında taraf veya iletişim bilgisi eksik: ${eksik.map((x) => x.ad).join(', ')}.` });
    if ((await b.db.query(`SELECT 1 FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = $2 AND durum = 'Bekliyor'`, [id, ONY])).rowCount) return y.code(409).send({ hata: 'Bekleyen yetkili malik beyanı vardır.' });
    const dil = d.yazisma_dili === 'İngilizce' ? 'en' : 'tr'; const secenekler = m.map((x) => ({ kimlik: x.kimlik, ad: x.ad }));
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE yetkili_malik_oyu SET gecerli = false WHERE yat_ref = $1 AND gecerli`, [d.yat_ref]); // yeni tur: önceki oylar geçersiz sayılır, silinmez
      for (const x of m) {
        const r = await onayTalebiAc(c, { dosya: id, ony: ONY, dil, alanlar: { Yat: d.yat_adi, Yacht: d.yat_adi }, formTuru: FORM, nesneTuru: 'Yat Maliki', nesneKimligi: x.kimlik, kullanici: x.kullanici_ref, aliciAd: x.ad, telefon: x.telefon, eposta: x.eposta, hazirlayan: o.kullanici, webAdresi: b.webAdresi });
        await c.query(`UPDATE onay_talebi SET secenekler = $2 WHERE kimlik = $1`, [r.kimlik, JSON.stringify(secenekler)]);
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yetkili Malik Beyanı Gönderildi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { malik: m.length }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    return { gonderilen: m.length };
  });
}
