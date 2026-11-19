import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { sayac } from './sure.js';
import { haftaAnahtari } from './uyum_tarama.js';
import { UUID } from './yat.js';

const MPM = 'Müşteri ve Paydaş İlişkileri Müdürü';
const DEG = 'Sosyal Medya Değerlendirmesi'; const TARAMA = 'Sosyal Medya Haftalık Tarama';
const SONUC = ['İşlem Gerekmez', 'Sözcüye İletildi', 'Hukuka İletildi', 'Kapatıldı'];
const SOZCU = 'CEO'; // YG-586: sözcü yetkisi CEO'da
const VARYANT: Record<string, string> = { Genel: 'FR-KLT-017-1', Dosyalı: 'FR-KLT-017-2', Olumlu: 'FR-KLT-017-3' };

/** YG-586: haftalık tarama görevi; olumsuz paylaşımda 2 saatlik iç değerlendirme süresi aşılırsa Müdür ve bağlı Direktörü uyarılır. */
export async function sosyalMedyaIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const mpm = await rolId(db, MPM);
  if (simdi.getDay() === 1 && (await birKez(db, 'sosyal-medya-tarama', haftaAnahtari(simdi)))) {
    const son = new Date(simdi); son.setHours(18, 0, 0, 0);
    await kartAc(db, { tur: TARAMA, kategori: 'gorev', baslik: `${TARAMA} · ${haftaAnahtari(simdi)}`, ozet: 'Haftalık sosyal medya taramasını yapıp İzleme Kaydına işleyiniz.', sahipRol: mpm, sonZaman: son, nesneTuru: TARAMA, nesneKimligi: haftaAnahtari(simdi) }); n++;
  }
  const geciken = (await db.query(`SELECT kimlik, kayit_no, ozet FROM sosyal_medya_kaydi WHERE olumsuz AND degerlendirme_zamani IS NULL AND tespit_zamani < $1::timestamptz - interval '2 hours'`, [simdi])).rows;
  for (const k of geciken) {
    if (!(await birKez(db, 'sosyal-medya-gecikme', k.kimlik))) continue;
    const ust = await onayMakami(db, mpm).catch(() => null);
    await bildir(db, { olay: `sosyal-gecik:${k.kimlik}`, kullanicilar: [...await rolSahipleri(db, mpm), ...(ust ? await rolSahipleri(db, ust) : [])], baslik: `2 Saatlik Değerlendirme Süresi Aşıldı: ${k.kayit_no}`, ozet: String(k.ozet).slice(0, 120), oncelik: 'Yüksek' }, simdi); n++;
  }
  return n;
}

/** YG-586: personel olumsuz paylaşımı bildirir, kayıt Sosyal Medya İzleme Kaydına girer; personel yanıt vermez, değerlendirme Müşteri ve Paydaş İlişkileri Müdürlüğündedir. */
export function sosyalMedyaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const gorur = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, [MPM, 'CEO', 'Strateji ve Kurumsal Gelişim Direktörü']])).rowCount);

  s.post('/sosyal-medya', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const g = (i.body ?? {}) as { platform?: string; baglanti?: string; ozet?: string; tespit?: string; olumsuz?: boolean; tarama?: boolean };
    const tespit = g.tespit ? new Date(g.tespit) : new Date();
    // YG-1701: İdari İşlemlerim "Paylaşımı Bildir": platform ve paylaşım bağlantısı; not isteğe bağlıdır (bağlantı yoksa not zorunlu).
    if (!g.ozet?.trim() && g.baglanti?.trim()) g.ozet = g.baglanti.trim();
    if (!g.platform?.trim() || !g.ozet?.trim() || Number.isNaN(+tespit) || +tespit > Date.now() + 60_000) return y.code(400).send({ hata: 'Platform ile paylaşım bağlantısı veya not zorunludur.' });
    const tarama = Boolean(g.tarama) && (await gorur(o.kullanici));
    const no = `SMK-${new Date().getFullYear()}-${String(await sayac(b.db, 'sosyal_medya')).padStart(4, '0')}`;
    const k = (await b.db.query(`INSERT INTO sosyal_medya_kaydi (kayit_no, kaynak, platform, baglanti, ozet, tespit_zamani, olumsuz, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [no, tarama ? 'Haftalık Tarama' : 'Personel Bildirimi', g.platform.trim().slice(0, 60), g.baglanti?.trim() || null, g.ozet.trim().slice(0, 1000), tespit, g.olumsuz !== false, o.kullanici])).rows[0].kimlik as string;
    // YG-1466: olumsuz paylaşım sözcüye anlık bildirilir (Müdürlüğe değerlendirme görevi ayrıca açılır).
    if (g.olumsuz !== false) await bildir(b.db, { olay: `sosyal-olumsuz:${k}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, SOZCU)), baslik: `Olumsuz Sosyal Medya Paylaşımı: ${no}`, ozet: `${g.platform.trim()} · ${g.ozet.trim().slice(0, 120)}`, oncelik: 'Yüksek', acil: true });
    if (g.olumsuz !== false) await kartAc(b.db, { tur: DEG, kategori: 'gorev', baslik: `${no} · ${g.platform.trim()}`, ozet: g.ozet.trim().slice(0, 200), oncelik: 'Yüksek', sahipRol: await rolId(b.db, MPM), sonZaman: new Date(+tespit + 2 * 3_600_000), nesneTuru: DEG, nesneKimligi: k });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sosyal Medya Kaydı', nesneTuru: 'Sosyal Medya Kaydı', nesneKimligi: k, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: k, no };
  });
  s.get('/sosyal-medya', oturumlu, async (i, y) => {
    if (!(await gorur(i.oturum!.kullanici))) return yok(y);
    return (await b.db.query(`SELECT k.kimlik, k.kayit_no, k.kaynak, k.platform, k.baglanti, k.ozet, k.tespit_zamani, k.olumsuz, k.degerlendirme, k.sonuc, k.degerlendirme_zamani, (SELECT dosya_no FROM dosya WHERE kimlik = k.dosya_ref) dosya_no, k.yanit_varyant, k.yanit_zamani, ${await sozcuMu(i.oturum!.kullanici)} AS yanitlar, (k.olumsuz AND k.degerlendirme_zamani IS NULL AND k.tespit_zamani < now() - interval '2 hours') AS gecikti FROM sosyal_medya_kaydi k ORDER BY k.degerlendirme_zamani IS NULL DESC, k.tespit_zamani DESC LIMIT 200`)).rows;
  });
  const sozcuMu = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2 LIMIT 1`, [k, SOZCU])).rowCount);
  // YG-1466: Müşteri ve Paydaş İlişkileri Müdürü paylaşımı dosyayla eşleştirir; Dosya Sorumlusu bilgilendirilir.
  s.post('/sosyal-medya/:id/dosya', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { dosyaNo } = (i.body ?? {}) as { dosyaNo?: string };
    if (!UUID.test(id) || !(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[])`, [o.kullanici, [MPM, SOZCU]])).rowCount) return yok(y);
    const d = (await b.db.query(`SELECT kimlik, dosya_no, dosya_sorumlusu_ref FROM dosya WHERE dosya_no = $1`, [dosyaNo?.trim() ?? ''])).rows[0];
    if (!d) return y.code(400).send({ hata: 'Dosya numarası bulunamadı.' });
    const r = (await b.db.query(`UPDATE sosyal_medya_kaydi SET dosya_ref = $2 WHERE kimlik = $1 RETURNING kayit_no, platform, ozet`, [id, d.kimlik])).rows[0]; if (!r) return yok(y);
    if (d.dosya_sorumlusu_ref) await bildir(b.db, { olay: `sosyal-dosya:${id}:${d.kimlik}`, kullanicilar: [d.dosya_sorumlusu_ref], baslik: `${d.dosya_no} · Dosyanızla İlgili Sosyal Medya Paylaşımı`, ozet: `${r.kayit_no} · ${r.platform} · ${String(r.ozet).slice(0, 120)}. Paylaşıma yanıt vermeyiniz; yanıt sözcüdedir.`, oncelik: 'Yüksek' });
    return { dosyaNo: d.dosya_no };
  });
  // YG-731, YG-1466: yalnız sözcü onaylı FR-KLT-017 şablonunu kullanır; olay açıklama şablonu yoktur.
  const yanitMetni = async (k: Record<string, any>, varyant: string, dil: 'tr' | 'en') => {
    const { metinGetir } = await import('./metin.js');
    if (varyant !== 'Genel') return metinGetir(b.db, VARYANT[varyant]!, dil);
    const sb = Object.fromEntries((await b.db.query(`SELECT anahtar, deger FROM sirket_bilgisi WHERE anahtar IN ('genel_telefon', 'genel_eposta')`)).rows.map((r) => [r.anahtar, r.deger]));
    if (!sb.genel_telefon || !sb.genel_eposta) throw Object.assign(new Error('Genel yanıt için şirketin genel telefon ve e-posta bilgisi girilmemiştir.'), { statusCode: 409 });
    return metinGetir(b.db, VARYANT.Genel!, dil, { 'e-posta': sb.genel_eposta, 'e-mail': sb.genel_eposta, telefon: sb.genel_telefon, phone: sb.genel_telefon });
  };
  s.get('/sosyal-medya/:id/yanit-metni', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const q = i.query as { varyant?: string; dil?: string };
    if (!UUID.test(id) || !(await sozcuMu(o.kullanici))) return yok(y);
    if (!VARYANT[q.varyant ?? ''] || !['tr', 'en'].includes(q.dil ?? '')) return y.code(400).send({ hata: 'Şablon varyantını ve dili seçiniz.' });
    const k = (await b.db.query(`SELECT * FROM sosyal_medya_kaydi WHERE kimlik = $1`, [id])).rows[0]; if (!k) return yok(y);
    if (q.varyant === 'Dosyalı' && !k.dosya_ref) return y.code(409).send({ hata: 'Dosyalı yanıt için önce paylaşımı dosyayla eşleştiriniz.' });
    return { metin: await yanitMetni(k, q.varyant!, q.dil as 'tr' | 'en') };
  });
  s.post('/sosyal-medya/:id/yanitlandi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { varyant?: string; dil?: string };
    if (!UUID.test(id) || !(await sozcuMu(o.kullanici))) return yok(y);
    if (!VARYANT[g.varyant ?? ''] || !['tr', 'en'].includes(g.dil ?? '')) return y.code(400).send({ hata: 'Şablon varyantını ve dili seçiniz.' });
    const k = (await b.db.query(`SELECT s.*, d.dosya_no, d.dosya_sorumlusu_ref FROM sosyal_medya_kaydi s LEFT JOIN dosya d ON d.kimlik = s.dosya_ref WHERE s.kimlik = $1`, [id])).rows[0]; if (!k) return yok(y);
    if (k.yanit_zamani) return y.code(409).send({ hata: 'Paylaşım yanıtlanmıştır.' });
    if (g.varyant === 'Dosyalı' && !k.dosya_ref) return y.code(409).send({ hata: 'Dosyalı yanıt için önce paylaşımı dosyayla eşleştiriniz.' });
    const metin = await yanitMetni(k, g.varyant!, g.dil as 'tr' | 'en');
    await b.db.query(`UPDATE sosyal_medya_kaydi SET yanit_varyant = $2, yanit_dil = $3, yanit_metni = $4, yanitlayan_ref = $5, yanit_zamani = now() WHERE kimlik = $1`, [id, g.varyant, g.dil, metin, o.kullanici]);
    // FR-KLT-017-2: Dosyalı yanıtta Dosya Sorumlusuna arama görevi açılır.
    if (g.varyant === 'Dosyalı' && k.dosya_sorumlusu_ref) await kartAc(b.db, { tur: 'Sosyal Medya Dosya Araması', kategori: 'gorev', baslik: `${k.dosya_no} · Sosyal Medya Yanıtı Sonrası Arama`, ozet: `${k.kayit_no} · ${k.platform}: paylaşım sahibine dosyası hakkında ulaşınız.`, oncelik: 'Yüksek', sahipKullanici: k.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: k.dosya_ref });
    await bildir(b.db, { olay: `sosyal-yanit:${id}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, MPM)), baslik: `Sosyal Medya Paylaşımı Yanıtlandı: ${k.kayit_no}`, ozet: `${g.varyant} şablon (${g.dil === 'tr' ? 'Türkçe' : 'İngilizce'})` });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sosyal Medya Yanıtlandı', nesneTuru: 'Sosyal Medya Kaydı', nesneKimligi: id, yeni: { varyant: g.varyant, dil: g.dil }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { metin };
  });
  s.post('/sosyal-medya/:id/degerlendir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { degerlendirme?: string; sonuc?: string };
    if (!UUID.test(id) || !(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2`, [o.kullanici, MPM])).rowCount) return yok(y);
    if (!g.degerlendirme?.trim() || !SONUC.includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Değerlendirme ve sonuç zorunludur.' });
    const r = await b.db.query(`UPDATE sosyal_medya_kaydi SET degerlendirme = $2, sonuc = $3, degerlendiren_ref = $4, degerlendirme_zamani = now() WHERE kimlik = $1 AND degerlendirme_zamani IS NULL`, [id, g.degerlendirme.trim(), g.sonuc, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Kayıt değerlendirilmiştir veya bulunamadı.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [DEG, id]);
    if (g.sonuc === 'Sözcüye İletildi') await bildir(b.db, { olay: `sosyal-sozcu:${id}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, 'CEO')), baslik: 'Sosyal Medya Paylaşımı Sözcü Değerlendirmesinde', ozet: g.degerlendirme.trim().slice(0, 120), oncelik: 'Yüksek' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sosyal Medya Değerlendirmesi', nesneTuru: 'Sosyal Medya Kaydı', nesneKimligi: id, yeni: { sonuc: g.sonuc }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
