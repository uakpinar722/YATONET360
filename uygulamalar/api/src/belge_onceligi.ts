import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
type Kalem = { sira: number; belge: string; islev: string; kayitlar: string[] };
/** YG-617 (K-020; Cilt VII §2.1): belge önceliği sözleşme türüne göre iki kuralla. Çerçeve ilişkide iş emri/onay ana metinle birlikte okunur ve onu değiştirmez;
 * tek iş sözleşmesinde ekler sözleşmede listelendiği sırayla uygulanır. Çelişkide otomatik tercih yapılmaz. */
export async function belgeOnceligi(db: Db, dosya: string) {
  const d = (await db.query(`SELECT musteri_turu, dosya_no FROM dosya WHERE kimlik = $1`, [dosya])).rows[0]; if (!d) return null;
  const q = async (sql: string) => (await db.query(sql, [dosya])).rows.map((r) => String(r.x));
  const teklif = await q(`SELECT teklif_no || ' Rev.' || surum_no x FROM fiyat_teklifi WHERE dosya_ref = $1 AND statu IN ('Onaylı', 'Gönderildi', 'Karar') ORDER BY teklif_no`);
  const teknik = [...await q(`SELECT rapor_no x FROM teknik_rapor WHERE dosya_ref = $1 AND durum = 'Onaylı' ORDER BY rapor_no`), ...await q(`SELECT 'Kapsam ve Metraj Cetveli Rev.' || surum x FROM kapsam_cetveli WHERE dosya_ref = $1 AND durum = 'Onaylı'`)];
  const isEmri = await q(`SELECT is_emri_no || ' Rev.' || surum x FROM is_emri WHERE dosya_ref = $1 ORDER BY is_emri_no`);
  const cerceve = d.musteri_turu !== 'Bireysel Müşteri';
  const musteri: Kalem[] = cerceve ? [
    { sira: 1, belge: d.musteri_turu === 'Sigorta Şirketi' ? 'Sigorta Çerçeve Sözleşmesi' : 'Kurumsal Müşteri Çerçeve Sözleşmesi', islev: 'Sürekli ilişkinin genel şartları; iş emri ve onayla birlikte okunur', kayitlar: [] },
    { sira: 2, belge: 'Çerçeve Sözleşme Ek-2 (yetki ve kanal)', islev: 'Yetkili, kanal ve onay sınırı; yetki ve tarih doğrulanır', kayitlar: [] },
    { sira: 3, belge: 'Onay Kaydı (FR-OPS-007)', islev: 'İşe özgü onay; ana metni değiştirmez', kayitlar: [] },
    { sira: 4, belge: 'Teknik Ek', islev: 'Yöntem, metraj, kabul ve test ölçütü; sürüm numarası taşır', kayitlar: teknik },
    { sira: 5, belge: 'Ticari Ek · Fiyat Teklifi (FR-TIC-008)', islev: 'Fiyat ve ödeme koşulları', kayitlar: teklif },
  ] : [
    { sira: 1, belge: 'Yat Onarım Sözleşmesi', islev: 'Belirli onarımın bütün koşulları; ekleri açıkça listeler', kayitlar: [] },
    { sira: 2, belge: 'Ticari Ek · Fiyat Teklifi (FR-TIC-008)', islev: 'Sözleşmede listelenen ek; fiyat ve ödeme koşulları', kayitlar: teklif },
    { sira: 3, belge: 'Teknik Ek', islev: 'Sözleşmede listelenen ek; yöntem, metraj, kabul ölçütü; sürüm numarası taşır', kayitlar: teknik },
    { sira: 4, belge: 'Yat Teslim Alma ve Envanter Tutanağı (Ek-2)', islev: 'Sözleşmede listelenen ek; teslim anındaki durum', kayitlar: [] },
  ];
  const firma: Kalem[] = [
    { sira: 1, belge: 'Çözüm Ortağı Çerçeve Sözleşmesi', islev: 'Sürekli ilişkinin genel şartları; iş emriyle birlikte okunur', kayitlar: [] },
    { sira: 2, belge: 'Çerçeve Sözleşme Ek-1 (sicilden)', islev: 'Firma bilgileri ve yetkiler', kayitlar: [] },
    { sira: 3, belge: 'İş Emri (FR-OPS-008)', islev: 'Görev, yer, kapsam, süre; ana metni değiştirmez', kayitlar: isEmri },
    { sira: 4, belge: 'Teknik Ek', islev: 'Yöntem raporu, metraj ve kabul ölçütü; sürüm numarası taşır', kayitlar: teknik },
    { sira: 5, belge: 'Firma Fiyat Teklifi (FR-TIC-012)', islev: 'Bedel; iş emri fiyat içermez', kayitlar: [] },
  ];
  return { kural: cerceve ? 'Çerçeve Sözleşme' : 'Tek İş Sözleşmesi', musteri, firma, celiski: 'Çelişki hâlinde sıra numarasına göre otomatik tercih yapılmaz; konu, yürürlük tarihi, özel-genel hüküm ilişkisi ve yetki kaydı Hukuk ve Uyum Direktörünce incelenir.' };
}

export function belgeOnceligiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/dosya/:id/belge-onceligi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    return (await belgeOnceligi(b.db, id)) ?? yok(y);
  });
  // Çelişki bildirimi: otomatik sonuç kurulmaz; Hukuk ve Uyum Direktörüne inceleme görevi açılır.
  s.post('/dosya/:id/belge-celiskisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belgeler?: string; konu?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g.belgeler?.trim() || !g.konu?.trim()) return y.code(400).send({ hata: 'Çelişen belgeler ve konu zorunludur.' });
    const d = (await b.db.query(`SELECT dosya_no FROM dosya WHERE kimlik = $1`, [id])).rows[0];
    await kartAc(b.db, { tur: 'Belge Çelişkisi İncelemesi', kategori: 'gorev', baslik: `${d.dosya_no} · Belge çelişkisi`, ozet: `${g.belgeler.trim()} · ${g.konu.trim()}`.slice(0, 400), hazirlayan: o.kullanici, sahipRol: await rolId(b.db, 'Hukuk ve Uyum Direktörü'), nesneTuru: 'Dosya', nesneKimligi: id });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge Çelişkisi Bildirildi', nesneTuru: 'Dosya', nesneKimligi: id, gerekce: g.konu.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
