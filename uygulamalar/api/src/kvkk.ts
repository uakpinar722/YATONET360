import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const HUD = 'Hukuk ve Uyum Direktörü'; const HUU = 'Hukuk ve Uyum Uzmanı'; const BIM = 'Bilgi İşlem Müdürü'; const GMY = 'Genel Müdür Yardımcısı';
const IHLAL_ROL = [HUD, HUU, BIM, GMY, 'CEO']; const KVKK_ROL = [HUD, HUU];
const SAAT = 3_600_000; const KURUL_SAAT = 72; const VERI_ISLEYEN_SAAT = 12;
const IMHA_METNI = 'İmha Edildi';
const OLAY = ['Yanlış alıcıya e-posta', 'Açık paylaşım bağlantısı', 'Kayıp çıktı', 'Yetkisiz görüntüleme', 'Cihaz kaybı veya çalınması', 'Teknik güvenlik olayı', 'Diğer'];

const ayEkle = (d: Date, ay: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + ay); return x; };
const rolKisileri = async (db: Db, ad: string) => rolSahipleri(db, await rolId(db, ad));

/** YG-1201, YG-1202: ihlal kaydı ilk kesin bilgi beklenmeden açılır; Bilgi İşlem Müdürü ve Hukuk ve Uyum Direktörü telefon ve sistem içi uyarılır. */
export async function ihlalAc(db: Db, g: { ozet: string; olayTuru: string; ogrenme?: Date; farkEden: string; veriIsleyen?: boolean; ozelNitelikli?: boolean; karsiTaraf?: string }) {
  const ogrenme = g.ogrenme ?? new Date(); const yil = ogrenme.getFullYear();
  const no = `OLY-${yil}-${String(await sayac(db, `veri_ihlali:${yil}`)).padStart(4, '0')}`;
  const r = (await db.query(`INSERT INTO veri_ihlali (olay_no, ozet, olay_turu, ogrenme_zamani, fark_eden_ref, veri_isleyen_kaynakli, ozel_nitelikli_veri) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [no, g.ozet, g.olayTuru, ogrenme, g.farkEden, Boolean(g.veriIsleyen), Boolean(g.ozelNitelikli)])).rows[0];
  const son = new Date(ogrenme.getTime() + (g.veriIsleyen ? VERI_ISLEYEN_SAAT : KURUL_SAAT) * SAAT);
  await kartAc(db, { tur: 'Veri İhlali Şüphesi', kategori: 'islem', baslik: `${no} · Veri İhlali Şüphesi · FR-HUK-002`, ozet: 'Değerlendirmenin başlatılması ve üst yönetimin bilgilendirilmesi rica olunur.', oncelik: 'Kritik', sonZaman: son, sahipRol: await rolId(db, HUD), nesneTuru: 'Veri İhlali', nesneKimligi: r.kimlik });
  // Kişisel Veri Çerçeve m.13.1: olay doğrulanmamış olsa da sözleşmeli tarafa 12 saat içinde ilk bildirim; Kurul süresini değiştirmez.
  if (g.karsiTaraf?.trim()) {
    await db.query(`UPDATE veri_ihlali SET karsi_taraf = $2 WHERE kimlik = $1`, [r.kimlik, g.karsiTaraf.trim()]);
    await kartAc(db, { tur: 'Karşı Tarafa İhlal Bildirimi', kategori: 'gorev', baslik: `${no} · ${g.karsiTaraf.trim()} · İlk Bildirim`, ozet: 'Sözleşme gereği öğrenmeden itibaren en geç 12 saat içinde ilk bildirim yapılması rica olunur.', oncelik: 'Kritik', sonZaman: new Date(ogrenme.getTime() + 12 * SAAT), sahipRol: await rolId(db, HUD), nesneTuru: 'Veri İhlali', nesneKimligi: r.kimlik });
  }
  await bildir(db, { olay: `veri-ihlali:${r.kimlik}`, kullanicilar: [...await rolKisileri(db, BIM), ...await rolKisileri(db, HUD)], baslik: `⚠ Veri İhlali Şüphesi · ${no}`, ozet: 'FR-HUK-002 kaydı açıldı; telefonla da aranmanız bekleniyor.', oncelik: 'Kritik', sms: true, acil: true });
  return { kimlik: r.kimlik as string, olayNo: no };
}

const hukukiKorumaVar = async (db: Db, grup: string, a: { dosya?: string | null; kurulus?: string | null; kullanici?: string | null }): Promise<boolean> => Boolean((await db.query(`SELECT 1 FROM hukuki_koruma WHERE kaldirma_tarihi IS NULL AND (cardinality(kapsam_gruplari) = 0 OR $1 = ANY(kapsam_gruplari)) AND (dosya_ref = $2::uuid OR kurulus_ref = $3::uuid OR kullanici_ref = $4) LIMIT 1`, [grup, a.dosya ?? null, a.kurulus ?? null, a.kullanici ?? null])).rowCount);

/** YG-1222: mali 10 yıl, sözleşme 10 yıl, ticari 10 yıl; kalanlar operasyon kaydı 5 yıl. */
export function saklamaGrubu(tur: string): string {
  if (['Proforma', 'Ödeme Talebi', 'Ödeme Sorumluluğu', 'Mutabakat Raporu'].includes(tur) || /fatura|makbuz|dekont/i.test(tur)) return 'MAL-10';
  if (['Onay Belgesi', 'Kurtarma Sözleşmesi', 'Ön Bilgilendirme Formu', 'Teslim Tutanağı'].includes(tur) || /sözleşme/i.test(tur)) return 'SOZ-10';
  if (tur === 'Fiyat Teklifi' || /teklif/i.test(tur)) return 'TIC-10';
  return 'OPS-5';
}

/** YG-1230, YG-1231, YG-1223: süresi dolan kayıtlar listeye girer; hukuki koruma veya açık garanti süreci olanlar girmez. */
export async function imhaListesiUret(db: Pool, simdi = new Date()): Promise<string | null> {
  const ay = simdi.getUTCMonth(); if (ay !== 0 && ay !== 6) return null;
  const yil = simdi.getUTCFullYear(); const donem = ay === 0 ? 'Ocak' : 'Temmuz';
  if (!(await birKez(db, 'imha_listesi', `${yil}-${donem}`))) return null;
  const l = (await db.query(`INSERT INTO imha_listesi (yil, imha_donemi) VALUES ($1,$2) RETURNING kimlik`, [yil, donem])).rows[0].kimlik as string;
  const ekle = (grup: string, tur: string, id: string, ozet: string) => db.query(`INSERT INTO imha_kalemi (liste_ref, grup_kod, nesne_turu, nesne_kimligi, ozet) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [l, grup, tur, id, ozet]);
  const sinir = (ay2: number) => ayEkle(simdi, -ay2);
  for (const d of (await db.query(`SELECT d.kimlik, d.dosya_no FROM dosya d WHERE d.imha_zamani IS NULL AND d.statu = 'Kapalı' AND d.kapanis_zamani < $1 AND NOT EXISTS (SELECT 1 FROM garanti_sikayet g WHERE g.dosya_ref = d.kimlik AND g.statu <> 'Kapalı')`, [sinir(60)])).rows) if (!(await hukukiKorumaVar(db, 'OPS-5', { dosya: d.kimlik }))) await ekle('OPS-5', 'Dosya', d.kimlik, d.dosya_no);
  for (const f of (await db.query(`SELECT kimlik, sicil_no, iliski_bitis FROM kurulus WHERE iliski_bitis IS NOT NULL AND iliski_bitis < $1`, [sinir(60)])).rows) {
    const korunan = await hukukiKorumaVar(db, 'ILS-5', { kurulus: f.kimlik });
    if (!korunan && !(await db.query(`SELECT 1 FROM imha_kalemi WHERE nesne_turu = 'Kuruluş' AND nesne_kimligi = $1 AND grup_kod = 'ILS-5' AND durum = 'İmha Edildi'`, [f.kimlik])).rowCount) await ekle('ILS-5', 'Kuruluş', f.kimlik, f.sicil_no);
    if (new Date(f.iliski_bitis) < sinir(120) && !(await hukukiKorumaVar(db, 'SIC-OZ', { kurulus: f.kimlik })) && !(await db.query(`SELECT 1 FROM imha_kalemi WHERE nesne_turu = 'Kuruluş' AND nesne_kimligi = $1 AND grup_kod = 'SIC-OZ' AND durum = 'İmha Edildi'`, [f.kimlik])).rowCount) await ekle('SIC-OZ', 'Kuruluş', f.kimlik, f.sicil_no);
  }
  for (const h of (await db.query(`SELECT kimlik, kullanici_adi, kullanici_grubu FROM kullanici_hesabi WHERE imha_zamani IS NULL AND hesap_durumu = 'Kapalı' AND ((kullanici_grubu = 'LGM İç Rolü' AND kapanma_zamani < $1) OR (kullanici_grubu <> 'LGM İç Rolü' AND kapanma_zamani < $2))`, [sinir(120), sinir(60)])).rows) if (!(await hukukiKorumaVar(db, 'HSP', { kullanici: h.kimlik }))) await ekle('HSP', 'Kullanıcı', h.kimlik, 'Kapanmış hesap');
  for (const r of (await db.query(`SELECT kimlik, ilgili_kisi_ref FROM acik_riza WHERE imha_zamani IS NULL AND riza_turu IN ('Pazarlama açık rızası', 'Ticari elektronik ileti onayı') AND (durum = 'Geri Alındı' OR onay_zamani < $1)`, [sinir(60)])).rows) if (!(await hukukiKorumaVar(db, 'RIZA', { kullanici: r.ilgili_kisi_ref }))) await ekle('RIZA', 'Rıza', r.kimlik, 'Pazarlama verisi');
  for (const e of (await db.query(`SELECT b.kimlik, b.ad, b.saklama_grubu, b.bag_kimligi FROM belge b WHERE b.imha_zamani IS NULL AND b.saklama_grubu IN ('MAL-10', 'SOZ-10', 'TIC-10') AND b.saklama_bitis < $1`, [simdi])).rows) if (!(await hukukiKorumaVar(db, e.saklama_grubu, { dosya: e.bag_kimligi }))) await ekle(e.saklama_grubu, 'Belge', e.kimlik, e.ad);
  for (const p of (await db.query(`SELECT kullanici_ref FROM personel_karti WHERE ayrilis_tarihi < $1 AND brut_aylik_tl IS NOT NULL`, [sinir(120)])).rows) if (!(await hukukiKorumaVar(db, 'OZL-10', { kullanici: p.kullanici_ref }))) await ekle('OZL-10', 'Personel', p.kullanici_ref, 'Özlük kaydı');
  for (const o of (await db.query(`SELECT o.kimlik FROM olay_kaydi o WHERE o.olusturma_zamani < $1 AND o.ozet <> $2`, [sinir(60), IMHA_METNI])).rows) await ekle('DST-5', 'Olay', o.kimlik, 'Olay kaydı');
  for (const v of (await db.query(`SELECT kimlik, olay_no FROM veri_ihlali WHERE durum = 'Kapalı' AND kapanis_zamani < $1`, [sinir(120)])).rows) await ekle('IHL-10', 'Veri İhlali', v.kimlik, v.olay_no);
  const n = Number((await db.query(`SELECT count(*) n FROM imha_kalemi WHERE liste_ref = $1`, [l])).rows[0].n);
  await kartAc(db, { tur: 'İmha Listesi', kategori: 'islem', baslik: `${yil} ${donem} · İmha Listesi`, ozet: `${n} kayıt süresi dolmuştur; listeyi incelemeniz rica olunur.`, sahipRol: await rolId(db, HUU), nesneTuru: 'İmha Listesi', nesneKimligi: l });
  return l;
}

/** YG-1233: imha kullanıcılar için erişilemez kılma ve kalıcı silmedir; mali kayıtlar kendi süresinde kalır. */
async function kalemUygula(c: Db, k: { grup_kod: string; nesne_turu: string; nesne_kimligi: string }, depoKok?: string) {
  const belgeIptal = async (bag: string, id: string, tek = false) => {
    for (const e of (await c.query(tek ? `UPDATE belge SET imha_zamani = now() WHERE $1::text IS NOT NULL AND kimlik = $2::uuid AND imha_zamani IS NULL RETURNING kimlik` : `UPDATE belge SET imha_zamani = now() WHERE bag_turu = $1 AND bag_kimligi = $2 AND imha_zamani IS NULL AND (saklama_grubu IS NULL OR saklama_grubu NOT IN ('MAL-10', 'SOZ-10', 'TIC-10')) RETURNING kimlik`, [bag, id])).rows) {
      await c.query(`UPDATE paylasim_baglantisi p SET iptal_zamani = now() FROM belge_surum u WHERE u.belge_ref = $1 AND p.surum_ref = u.kimlik AND p.iptal_zamani IS NULL`, [e.kimlik]);
      // İçerik adresli depo: aynı dosyayı kullanan başka etkin belge yoksa fiziksel olarak silinir.
      for (const s of (await c.query(`SELECT depo_anahtari FROM belge_surum WHERE belge_ref = $1`, [e.kimlik])).rows) if (depoKok && !(await c.query(`SELECT 1 FROM belge_surum u JOIN belge b ON b.kimlik = u.belge_ref WHERE u.depo_anahtari = $1 AND b.imha_zamani IS NULL LIMIT 1`, [s.depo_anahtari])).rowCount) rmSync(join(depoKok, s.depo_anahtari), { force: true });
    }
  };
  const id = k.nesne_kimligi;
  if (k.nesne_turu === 'Dosya') {
    await c.query(`UPDATE dosya_tarafi SET kisi_adi_soyadi = $2, telefon = NULL, eposta = NULL, kurulus_unvani = NULL, gorevi = NULL WHERE dosya_ref = $1::uuid`, [id, IMHA_METNI]);
    await c.query(`UPDATE taraf t SET unvan_ad_soyad = $2, telefon = NULL, eposta = NULL, adres = NULL, tckn = NULL WHERE t.kisi_turu = 'Gerçek kişi' AND t.kimlik IN (SELECT taraf_ref FROM dosya_tarafi WHERE dosya_ref = $1::uuid) AND NOT EXISTS (SELECT 1 FROM dosya_tarafi x JOIN dosya d ON d.kimlik = x.dosya_ref WHERE x.taraf_ref = t.kimlik AND d.kimlik <> $1::uuid AND d.imha_zamani IS NULL)`, [id, IMHA_METNI]);
    await belgeIptal('Dosya', id);
    await c.query(`UPDATE dosya SET imha_zamani = now() WHERE kimlik = $1::uuid`, [id]);
  } else if (k.nesne_turu === 'Kuruluş' && k.grup_kod === 'ILS-5') {
    await c.query(`UPDATE kurulus SET kurumsal_eposta = NULL, kurumsal_telefon = NULL WHERE kimlik = $1::uuid`, [id]);
    await belgeIptal('Kuruluş', id);
  } else if (k.nesne_turu === 'Kuruluş') {
    await c.query(`UPDATE kurulus SET ticari_unvan = $2, vergi_no = NULL, kurumsal_eposta = NULL, kurumsal_telefon = NULL, il = NULL, ilce = NULL, imha_zamani = now() WHERE kimlik = $1::uuid`, [id, IMHA_METNI]);
  } else if (k.nesne_turu === 'Kullanıcı') {
    await c.query(`UPDATE kullanici_hesabi SET ad_soyad = $2, kullanici_adi = 'imha-' || kimlik, e_posta = NULL, cep_telefonu = NULL, imha_zamani = now() WHERE kimlik = $1`, [id, IMHA_METNI]);
  } else if (k.nesne_turu === 'Belge') {
    await belgeIptal('Belge', id, true);
  } else if (k.nesne_turu === 'Personel') {
    await c.query(`UPDATE personel_karti SET brut_aylik_tl = NULL WHERE kullanici_ref = $1`, [id]);
  } else if (k.nesne_turu === 'Rıza') {
    await c.query(`UPDATE acik_riza SET amac = NULL, kanal = NULL, gonderim_engeli = true, imha_zamani = now() WHERE kimlik = $1::uuid`, [id]);
  } else if (k.nesne_turu === 'Olay') {
    await c.query(`UPDATE olay_kaydi SET ozet = $2 WHERE kimlik = $1::uuid`, [id, IMHA_METNI]);
  } else if (k.nesne_turu === 'Veri İhlali') {
    await c.query(`UPDATE veri_ihlali SET ozet = $2, etkilenen_sistem_alici = NULL, olasi_sonuclar = NULL, sinirlama_tedbirleri = NULL, kok_neden_faaliyet = NULL, durum = 'İmha' WHERE kimlik = $1::uuid`, [id, IMHA_METNI]);
  }
}

/** YG-1232: geri yüklenen eski veri sessizce aktif kullanıma dönmez; imha kayıtları yeniden uygulanır. */
export async function imhaYenidenUygula(db: Pool): Promise<number> {
  let n = 0;
  for (const k of (await db.query(`SELECT i.grup_kod, i.nesne_turu, i.nesne_kimligi FROM imha_kalemi i WHERE i.durum = 'İmha Edildi' AND ((i.nesne_turu = 'Dosya' AND EXISTS (SELECT 1 FROM dosya d WHERE d.kimlik::text = i.nesne_kimligi AND d.imha_zamani IS NULL)) OR (i.nesne_turu = 'Kullanıcı' AND EXISTS (SELECT 1 FROM kullanici_hesabi h WHERE h.kimlik = i.nesne_kimligi AND h.imha_zamani IS NULL)))`)).rows) { await kalemUygula(db, k); n++; }
  return n;
}

/** YG-1202: Kurul süresi yaklaşınca ve aşılınca uyarı; YG-1219: başvuru yanıt süresi; ERS-2 bildirim kayıtları 2 yıl sonra silinir; Ocak ve Temmuz imha listesi. */
export async function kvkkIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  for (const v of (await db.query(`SELECT kimlik, olay_no, ogrenme_zamani FROM veri_ihlali WHERE durum = 'Açık' AND kurul_bildirim_zamani IS NULL AND bildirim_karari IS DISTINCT FROM 'Bildirim Gerekmez'`)).rows) {
    const kalan = (new Date(v.ogrenme_zamani).getTime() + KURUL_SAAT * SAAT - simdi.getTime()) / SAAT;
    const esik = kalan < 0 ? 'asildi' : kalan <= 24 ? '24' : null;
    if (esik && await birKez(db, 'ihlal_kurul', `${v.kimlik}:${esik}`)) { await bildir(db, { olay: `ihlal-kurul:${v.kimlik}:${esik}`, kullanicilar: await rolKisileri(db, HUD), baslik: esik === 'asildi' ? `⚠ ${v.olay_no} · 72 Saat Aşıldı` : `⚠ ${v.olay_no} · Kurul Bildirimine 24 Saatten Az Kaldı`, ozet: esik === 'asildi' ? 'Gecikme gerekçesi zorunludur.' : 'Bildirim kararı bekleniyor.', oncelik: 'Kritik', sms: true, acil: true }); n++; }
  }
  for (const k of (await db.query(`SELECT kimlik, basvuru_no, son_yanit_tarihi, hazirlayan_ref FROM ilgili_kisi_basvurusu WHERE durum <> 'Yanıtlandı' AND son_yanit_tarihi <= ($1::date + 7)`, [simdi.toISOString().slice(0, 10)])).rows) if (await birKez(db, 'basvuru_son', k.kimlik)) { await bildir(db, { olay: `basvuru-son:${k.kimlik}`, kullanicilar: [k.hazirlayan_ref, ...await rolKisileri(db, HUD)], baslik: `⚠ ${k.basvuru_no} · Yanıt Süresi Yaklaşıyor`, ozet: `Son yanıt: ${new Date(k.son_yanit_tarihi).toLocaleDateString('tr-TR')}`, oncelik: 'Yüksek' }); n++; }
  await db.query(`DELETE FROM bildirim WHERE zaman < $1`, [ayEkle(simdi, -24)]);
  // YG-608, YG-1222: belge türüne göre grup; birden çok gruba giriyorsa en uzun süre. Mali kayıt takvim yılı sonundan başlar.
  for (const g of (await db.query(`SELECT b.kimlik, b.belge_turu, b.saklama_grubu, d.kapanis_zamani FROM belge b JOIN dosya d ON d.kimlik::text = b.bag_kimligi WHERE b.bag_turu = 'Dosya' AND b.saklama_bitis IS NULL AND d.kapanis_zamani IS NOT NULL LIMIT 500`)).rows) {
    const grup = (g.saklama_grubu as string | null) ?? saklamaGrubu(g.belge_turu); const k = new Date(g.kapanis_zamani);
    await db.query(`UPDATE belge SET saklama_grubu = $3, saklama_bitis = $2 WHERE kimlik = $1`, [g.kimlik, grup === 'OPS-5' ? ayEkle(k, 60) : ayEkle(grup === 'MAL-10' ? new Date(Date.UTC(k.getUTCFullYear(), 11, 31)) : k, 120), grup]);
  }
  if (await imhaListesiUret(db, simdi)) n++;
  n += await imhaYenidenUygula(db);
  return n;
}

kapanisKaydet('KVKK Başvuru Kararı', async (c, k, karar, yapan) => {
  if (karar === 'Onayla') await c.query(`UPDATE ilgili_kisi_basvurusu SET durum = 'Onaylandı', onaylayan_ref = $2 WHERE kimlik = $1::uuid`, [k.nesne_kimligi, yapan]);
  else if (karar === 'Reddet') await c.query(`UPDATE ilgili_kisi_basvurusu SET durum = 'İncelemede', karar = NULL WHERE kimlik = $1::uuid`, [k.nesne_kimligi]);
});

export function kvkkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  s.get('/kvkk/yetki', oturumlu, async (i) => ({ ihlal: await rolVar(i.oturum!.kullanici, IHLAL_ROL), hud: await rolVar(i.oturum!.kullanici, [HUD]), uzman: await rolVar(i.oturum!.kullanici, [HUU]) }));

  // YG-1201: her kullanıcı bildirebilir.
  s.post('/veri-ihlali', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ozet?: string; olayTuru?: string; ogrenme?: string; veriIsleyen?: boolean; ozelNitelikli?: boolean; karsiTaraf?: string };
    if (!g.ozet?.trim() || !OLAY.includes(g.olayTuru ?? '')) return y.code(400).send({ hata: 'Olay türünü ve kısa açıklamayı girmenizi rica ederiz.' });
    const r = await ihlalAc(b.db, { ozet: g.ozet.trim(), olayTuru: g.olayTuru!, ogrenme: g.ogrenme ? new Date(g.ogrenme) : undefined, farkEden: o.kullanici, veriIsleyen: g.veriIsleyen, ozelNitelikli: g.ozelNitelikli, karsiTaraf: g.karsiTaraf });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Veri İhlali Bildirimi', nesneTuru: 'Veri İhlali', nesneKimligi: r.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return r;
  });
  s.get('/veri-ihlali', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, IHLAL_ROL))) return y.code(403).send({ hata: 'Bu kayıtlara yalnız yetkili roller erişir.' });
    return (await b.db.query(`SELECT kimlik, olay_no, ozet, olay_turu, ogrenme_zamani, ust_yonetim_bilgi_zamani, bulgu_surumu, bildirim_karari, kurul_bildirim_zamani, ilgili_kisi_bildirim_zamani, durum, ozel_nitelikli_veri, etkilenen_kisi_sayisi FROM veri_ihlali WHERE durum <> 'İmha' ORDER BY ogrenme_zamani DESC LIMIT 100`)).rows;
  });
  const ihlal = async (id: string) => UUID.test(id) ? (await b.db.query(`SELECT * FROM veri_ihlali WHERE kimlik = $1`, [id])).rows[0] : undefined;
  const hudMu = (k: string) => rolVar(k, [HUD]);

  s.post('/veri-ihlali/:id/degerlendir', oturumlu, async (i, y) => { // YG-1201: HUD üst yönetimi bilgilendirir.
    const o = i.oturum!; const v = await ihlal((i.params as { id: string }).id);
    if (!v) return yok(y);
    if (!(await hudMu(o.kullanici))) return y.code(403).send({ hata: 'Değerlendirmeyi Hukuk ve Uyum Direktörü başlatır.' });
    if (v.ust_yonetim_bilgi_zamani) return y.code(409).send({ hata: 'Üst yönetim bilgilendirilmiştir.' });
    await b.db.query(`UPDATE veri_ihlali SET ust_yonetim_bilgi_zamani = now() WHERE kimlik = $1`, [v.kimlik]);
    await bildir(b.db, { olay: `veri-ihlali-ust:${v.kimlik}`, kullanicilar: [...await rolKisileri(b.db, GMY), ...await rolKisileri(b.db, 'CEO')], baslik: `⚠ Veri İhlali Şüphesi · ${v.olay_no}`, ozet: 'Hukuk ve Uyum Direktörü değerlendirmeyi başlattı.', oncelik: 'Kritik', sms: true, acil: true });
    return { tamam: true };
  });
  s.post('/veri-ihlali/:id/bulgu', oturumlu, async (i, y) => { // YG-1204: sürümlü bulgu.
    const o = i.oturum!; const v = await ihlal((i.params as { id: string }).id); const g = (i.body ?? {}) as { veriKategorileri?: string[]; kisiGruplari?: string[]; kisiSayisi?: number; kayitSayisi?: number; baslangic?: string; bitis?: string; sistemAlici?: string; sonuclar?: string; tedbirler?: string; ozelNitelikli?: boolean };
    if (!v) return yok(y);
    if (!(await rolVar(o.kullanici, [HUD, HUU, BIM]))) return y.code(403).send({ hata: 'Bulguyu Hukuk ve Uyum veya Bilgi İşlem Müdürü girer.' });
    if (v.durum !== 'Açık') return y.code(409).send({ hata: 'Kapalı olay güncellenemez.' });
    const n = v.bulgu_surumu + 1;
    await b.db.query(`UPDATE veri_ihlali SET veri_kategorileri = coalesce($2, veri_kategorileri), kisi_gruplari = coalesce($3, kisi_gruplari), etkilenen_kisi_sayisi = coalesce($4, etkilenen_kisi_sayisi), etkilenen_kayit_sayisi = coalesce($5, etkilenen_kayit_sayisi), ihlal_baslangic = coalesce($6, ihlal_baslangic), ihlal_bitis = coalesce($7, ihlal_bitis), etkilenen_sistem_alici = coalesce($8, etkilenen_sistem_alici), olasi_sonuclar = coalesce($9, olasi_sonuclar), sinirlama_tedbirleri = coalesce($10, sinirlama_tedbirleri), ozel_nitelikli_veri = coalesce($11, ozel_nitelikli_veri), bulgu_surumu = $12 WHERE kimlik = $1`, [v.kimlik, g.veriKategorileri ?? null, g.kisiGruplari ?? null, g.kisiSayisi ?? null, g.kayitSayisi ?? null, g.baslangic ?? null, g.bitis ?? null, g.sistemAlici ?? null, g.sonuclar ?? null, g.tedbirler ?? null, g.ozelNitelikli ?? null, n]);
    await b.db.query(`INSERT INTO veri_ihlali_surumu (ihlal_ref, surum, veri, guncelleyen_ref) VALUES ($1,$2,$3,$4)`, [v.kimlik, n, JSON.stringify(g), o.kullanici]);
    return { surum: n };
  });
  s.post('/veri-ihlali/:id/bildirim-karari', oturumlu, async (i, y) => {
    const o = i.oturum!; const v = await ihlal((i.params as { id: string }).id); const g = (i.body ?? {}) as { karar?: string; gerekce?: string };
    if (!v) return yok(y);
    if (!(await hudMu(o.kullanici))) return y.code(403).send({ hata: 'Kararı Hukuk ve Uyum Direktörü kaydeder.' });
    if (!['Bildirilecek', 'Bildirim Gerekmez'].includes(g.karar ?? '')) return y.code(400).send({ hata: 'Kararı seçmenizi rica ederiz.' });
    if (g.karar === 'Bildirim Gerekmez' && !g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçeyi yazmanızı rica ederiz.' });
    await b.db.query(`UPDATE veri_ihlali SET bildirim_karari = $2, bildirim_karari_gerekcesi = $3, bildirim_karari_veren_ref = $4 WHERE kimlik = $1`, [v.kimlik, g.karar, g.gerekce?.trim() || null, o.kullanici]);
    return { tamam: true };
  });
  s.post('/veri-ihlali/:id/kurul-bildirimi', oturumlu, async (i, y) => { // YG-1202, YG-1203
    const o = i.oturum!; const v = await ihlal((i.params as { id: string }).id); const g = (i.body ?? {}) as { zaman?: string; gecikme?: string };
    if (!v) return yok(y);
    if (!(await hudMu(o.kullanici))) return y.code(403).send({ hata: 'Kurul bildirimini Hukuk ve Uyum Direktörü kaydeder.' });
    if (!g.zaman) return y.code(400).send({ hata: 'Bildirim zamanını girmenizi rica ederiz.' });
    if (new Date(g.zaman).getTime() > new Date(v.ogrenme_zamani).getTime() + KURUL_SAAT * SAAT && !g.gecikme?.trim()) return y.code(409).send({ hata: '72 saat aşıldı; gecikme gerekçesi zorunludur.' });
    await b.db.query(`UPDATE veri_ihlali SET kurul_bildirim_zamani = $2, gecikme_gerekcesi = $3, bildirim_karari = 'Bildirilecek', bildirim_karari_veren_ref = $4 WHERE kimlik = $1`, [v.kimlik, g.zaman, g.gecikme?.trim() || null, o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Veri İhlali Şüphesi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [v.kimlik]);
    return { tamam: true };
  });
  s.post('/veri-ihlali/:id/ilgili-kisi-bildirimi', oturumlu, async (i, y) => {
    const o = i.oturum!; const v = await ihlal((i.params as { id: string }).id); const z = ((i.body ?? {}) as { zaman?: string }).zaman;
    if (!v) return yok(y);
    if (!(await hudMu(o.kullanici))) return y.code(403).send({ hata: 'Kaydı Hukuk ve Uyum Direktörü girer.' });
    if (!z) return y.code(400).send({ hata: 'Bildirim zamanını girmenizi rica ederiz.' });
    await b.db.query(`UPDATE veri_ihlali SET ilgili_kisi_bildirim_zamani = $2 WHERE kimlik = $1`, [v.kimlik, z]);
    return { tamam: true };
  });
  s.post('/veri-ihlali/:id/kapat', oturumlu, async (i, y) => { // YG-1203: kanıtlı düzeltme olmadan kapanmaz.
    const o = i.oturum!; const v = await ihlal((i.params as { id: string }).id); const g = (i.body ?? {}) as { kokNeden?: string; kanit?: string };
    if (!v) return yok(y);
    if (!(await hudMu(o.kullanici))) return y.code(403).send({ hata: 'Kapanışı Hukuk ve Uyum Direktörü yapar.' });
    if (!g.kokNeden?.trim() || !g.kanit || !UUID.test(g.kanit) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1`, [g.kanit])).rowCount) return y.code(400).send({ hata: 'Kök neden ve düzeltme kanıtı olmadan kapatılamaz.' });
    if (!v.bildirim_karari) return y.code(409).send({ hata: 'Bildirim kararı bekleniyor.' });
    if (v.bildirim_karari === 'Bildirilecek' && !v.kurul_bildirim_zamani) return y.code(409).send({ hata: 'Kurul bildirimi bekleniyor.' });
    await b.db.query(`UPDATE veri_ihlali SET kok_neden_faaliyet = $2, kapanis_kaniti_ref = $3, kapanis_zamani = now(), durum = 'Kapalı' WHERE kimlik = $1`, [v.kimlik, g.kokNeden.trim(), g.kanit]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Veri İhlali Şüphesi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [v.kimlik]);
    return { tamam: true };
  });

  // YG-1218–1220: ilgili kişi başvurusu; otomatik kabul veya ret yok.
  const basvuru = async (id: string) => UUID.test(id) ? (await b.db.query(`SELECT * FROM ilgili_kisi_basvurusu WHERE kimlik = $1`, [id])).rows[0] : undefined;
  s.post('/kvkk-basvuru', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ad?: string; iletisim?: string; kanal?: string; yanitKanali?: string; talepler?: string[]; kapsam?: string; alinma?: string };
    if (!(await rolVar(o.kullanici, [HUU]))) return y.code(403).send({ hata: 'Başvuruyu Hukuk ve Uyum Uzmanı kaydeder.' });
    if (!g.ad?.trim() || !g.iletisim?.trim() || !g.yanitKanali?.trim() || !g.talepler?.length || !g.alinma || !['Yazılı başvuru (adres)', 'KEP', 'Sistemde kayıtlı e-posta'].includes(g.kanal ?? '')) return y.code(400).send({ hata: 'Başvuran, iletişim, kanal, yanıt kanalı, talep türü ve alınma tarihi zorunludur.' });
    const yil = g.alinma.slice(0, 4); const no = `KVB-${yil}-${String(await sayac(b.db, `kvkk_basvuru:${yil}`)).padStart(4, '0')}`;
    const son = new Date(new Date(g.alinma).getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    const r = await b.db.query(`INSERT INTO ilgili_kisi_basvurusu (basvuru_no, basvuran_ad_soyad, iletisim, basvuru_kanali, yanit_kanali, talep_turleri, kapsam, alinma_tarihi, son_yanit_tarihi, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`, [no, g.ad.trim(), g.iletisim.trim(), g.kanal, g.yanitKanali.trim(), g.talepler, g.kapsam?.trim() || null, g.alinma, son, o.kullanici]);
    return { kimlik: r.rows[0].kimlik, basvuruNo: no, sonYanit: son };
  });
  s.get('/kvkk-basvuru', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, KVKK_ROL))) return y.code(403).send({ hata: 'Başvurulara Hukuk ve Uyum erişir.' });
    return (await b.db.query(`SELECT kimlik, basvuru_no, basvuran_ad_soyad, talep_turleri, alinma_tarihi::text, son_yanit_tarihi::text, kimlik_dogrulandi, karar, durum, arama_sonucu FROM ilgili_kisi_basvurusu ORDER BY son_yanit_tarihi LIMIT 200`)).rows;
  });
  s.post('/kvkk-basvuru/:id/dogrula', oturumlu, async (i, y) => {
    const o = i.oturum!; const a = await basvuru((i.params as { id: string }).id); const t = ((i.body ?? {}) as { temsilBelgesi?: string }).temsilBelgesi;
    if (!a) return yok(y);
    if (!(await rolVar(o.kullanici, [HUU]))) return y.code(403).send({ hata: 'Doğrulamayı Hukuk ve Uyum Uzmanı yapar.' });
    await b.db.query(`UPDATE ilgili_kisi_basvurusu SET kimlik_dogrulandi = true, temsil_belgesi_ref = $2 WHERE kimlik = $1`, [a.kimlik, t && UUID.test(t) ? t : null]);
    return { tamam: true };
  });
  s.post('/kvkk-basvuru/:id/arama', oturumlu, async (i, y) => { // YG-1220
    const o = i.oturum!; const a = await basvuru((i.params as { id: string }).id); const g = (i.body ?? {}) as { terim?: string; elleKontrol?: string[] };
    if (!a) return yok(y);
    if (!(await rolVar(o.kullanici, [HUU]))) return y.code(403).send({ hata: 'Aramayı Hukuk ve Uyum Uzmanı yapar.' });
    const t = g.terim?.trim(); if (!t || t.length < 3) return y.code(400).send({ hata: 'En az 3 karakterlik arama terimi girmenizi rica ederiz.' });
    if (!a.kimlik_dogrulandi) return y.code(409).send({ hata: 'Önce başvuranın kimliği doğrulanmalıdır.' });
    const m = `%${t}%`;
    const Q: [string, string][] = [['Kullanıcı Hesabı', `SELECT count(*) n FROM kullanici_hesabi WHERE ad_soyad ILIKE $1 OR e_posta ILIKE $1 OR cep_telefonu ILIKE $1`], ['Taraf', `SELECT count(*) n FROM taraf WHERE unvan_ad_soyad ILIKE $1 OR telefon ILIKE $1 OR eposta ILIKE $1 OR tckn = $2`], ['Dosya Tarafı', `SELECT count(*) n FROM dosya_tarafi WHERE kisi_adi_soyadi ILIKE $1 OR telefon ILIKE $1 OR eposta ILIKE $1`], ['İş Emri', `SELECT count(*) n FROM is_emri WHERE kapsam ILIKE $1`], ['Belge', `SELECT count(*) n FROM belge WHERE ad ILIKE $1`], ['Mesaj Geçmişi', `SELECT count(*) n FROM ic_mesaj WHERE metin ILIKE $1`], ['Bildirim', `SELECT count(*) n FROM bildirim WHERE ozet ILIKE $1 OR baslik ILIKE $1`], ['Onay Talebi', `SELECT count(*) n FROM onay_talebi WHERE metin ILIKE $1 OR telefon ILIKE $1 OR eposta ILIKE $1`], ['Rıza', `SELECT count(*) n FROM acik_riza r JOIN kullanici_hesabi h ON h.kimlik = r.ilgili_kisi_ref WHERE h.ad_soyad ILIKE $1 OR h.e_posta ILIKE $1`]];
    const sonuc: Record<string, number> = {};
    for (const [ad, q] of Q) sonuc[ad] = Number((await b.db.query(q, q.includes('$2') ? [m, t] : [m])).rows[0].n);
    const kapsam = [...Object.keys(sonuc), ...(g.elleKontrol ?? []).map((x) => `${x} (elle)`)];
    await b.db.query(`UPDATE ilgili_kisi_basvurusu SET arama_kapsami = $2, arama_sonucu = $3 WHERE kimlik = $1`, [a.kimlik, kapsam, JSON.stringify(sonuc)]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'KVKK Veri Araması', nesneTuru: 'KVKK Başvurusu', nesneKimligi: a.kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { sonuc };
  });
  s.post('/kvkk-basvuru/:id/karar', oturumlu, async (i, y) => { // YG-1218: hazırlayan ile onaylayan farklı.
    const o = i.oturum!; const a = await basvuru((i.params as { id: string }).id); const g = (i.body ?? {}) as { karar?: string; gerekce?: string };
    if (!a) return yok(y);
    if (!(await rolVar(o.kullanici, [HUU]))) return y.code(403).send({ hata: 'Kararı Hukuk ve Uyum Uzmanı hazırlar.' });
    if (!a.kimlik_dogrulandi) return y.code(409).send({ hata: 'Kimlik doğrulanmadan karar hazırlanamaz.' });
    if (!a.arama_sonucu) return y.code(409).send({ hata: 'Veri araması bekleniyor.' });
    if (!['Kabul', 'Kısmi Kabul', 'Ret'].includes(g.karar ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Karar ve gerekçe zorunludur.' });
    if (a.durum !== 'İncelemede') return y.code(409).send({ hata: 'Karar onaya gönderilmiştir.' });
    await b.db.query(`UPDATE ilgili_kisi_basvurusu SET karar = $2, karar_gerekcesi = $3, durum = 'Onayda' WHERE kimlik = $1`, [a.kimlik, g.karar, g.gerekce.trim()]);
    await kartAc(b.db, { tur: 'KVKK Başvuru Kararı', baslik: `${a.basvuru_no} · ${g.karar}`, ozet: `Son yanıt: ${a.son_yanit_tarihi.toISOString?.().slice(0, 10) ?? a.son_yanit_tarihi}`, oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [await rolId(b.db, HUD)], nesneTuru: 'KVKK Başvurusu', nesneKimligi: a.kimlik });
    return { durum: 'Onayda' };
  });
  s.post('/kvkk-basvuru/:id/yanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const a = await basvuru((i.params as { id: string }).id); const g = (i.body ?? {}) as { tarih?: string; kanit?: string };
    if (!a) return yok(y);
    if (!(await rolVar(o.kullanici, [HUU]))) return y.code(403).send({ hata: 'Yanıt kaydını Hukuk ve Uyum Uzmanı girer.' });
    if (a.durum !== 'Onaylandı') return y.code(409).send({ hata: 'Yanıt için onaylı karar bekleniyor.' });
    if (!g.tarih || !g.kanit || !UUID.test(g.kanit)) return y.code(400).send({ hata: 'Yanıt tarihi ve teslim kanıtı zorunludur.' });
    await b.db.query(`UPDATE ilgili_kisi_basvurusu SET yanit_tarihi = $2, teslim_kaniti_ref = $3, durum = 'Yanıtlandı' WHERE kimlik = $1`, [a.kimlik, g.tarih, g.kanit]);
    return { tamam: true };
  });

  // YG-1231: hukuki koruma.
  s.post('/hukuki-koruma', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { gerekce?: string; konu?: string; kisiler?: string; dosya?: string; kurulus?: string; kullanici?: string; gruplar?: string[]; gozden?: string; kosul?: string };
    if (!(await rolVar(o.kullanici, [HUD]))) return y.code(403).send({ hata: 'Hukuki korumayı Hukuk ve Uyum Direktörü başlatır.' });
    if (!['Uyuşmazlık', 'Denetim', 'Soruşturma', 'Resmî Talep', 'Garanti veya Yasal Ayıp'].includes(g.gerekce ?? '') || !g.konu?.trim() || !g.gozden) return y.code(400).send({ hata: 'Gerekçe, konu ve gözden geçirme tarihi zorunludur.' });
    if (!g.dosya && !g.kurulus && !g.kullanici) return y.code(400).send({ hata: 'Koruma kapsamındaki kaydı seçmenizi rica ederiz.' });
    const r = await b.db.query(`INSERT INTO hukuki_koruma (gerekce_turu, kapsam_konu, kapsam_kisiler, dosya_ref, kurulus_ref, kullanici_ref, kapsam_gruplari, karar_sahibi_ref, gozden_gecirme_tarihi, kaldirma_kosulu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`, [g.gerekce, g.konu.trim(), g.kisiler?.trim() || null, g.dosya ?? null, g.kurulus ?? null, g.kullanici ?? null, g.gruplar ?? [], o.kullanici, g.gozden, g.kosul?.trim() || null]);
    await b.db.query(`UPDATE imha_kalemi k SET durum = 'Çıkarıldı', cikarma_gerekcesi = 'Hukuki koruma' FROM imha_listesi l WHERE l.kimlik = k.liste_ref AND l.durum <> 'Uygulandı' AND k.durum = 'Listede' AND k.nesne_kimligi IN ($1, $2, $3)`, [g.dosya ?? '', g.kurulus ?? '', g.kullanici ?? '']);
    return { kimlik: r.rows[0].kimlik };
  });
  s.get('/hukuki-koruma', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, KVKK_ROL))) return y.code(403).send({ hata: 'Bu kayda Hukuk ve Uyum erişir.' });
    return (await b.db.query(`SELECT kimlik, gerekce_turu, kapsam_konu, baslangic_tarihi::text, gozden_gecirme_tarihi::text, kaldirma_tarihi::text FROM hukuki_koruma ORDER BY baslangic_tarihi DESC LIMIT 100`)).rows;
  });
  s.post('/hukuki-koruma/:id/kaldir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, [HUD]))) return y.code(403).send({ hata: 'Korumayı Hukuk ve Uyum Direktörü kaldırır.' });
    const r = await b.db.query(`UPDATE hukuki_koruma SET kaldirma_tarihi = current_date WHERE kimlik = $1 AND kaldirma_tarihi IS NULL`, [id]);
    return r.rowCount ? { tamam: true } : yok(y);
  });

  // YG-1218, YG-1230, YG-1232: imha listesi; hazırlayan, birim kontrolü, onay ayrı.
  const liste = async (id: string) => UUID.test(id) ? (await b.db.query(`SELECT * FROM imha_listesi WHERE kimlik = $1`, [id])).rows[0] : undefined;
  s.get('/imha-listesi', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, KVKK_ROL))) return y.code(403).send({ hata: 'İmha listesine Hukuk ve Uyum erişir.' });
    const l = (await b.db.query(`SELECT kimlik, yil, imha_donemi, durum, imha_tarihi::text, yedek_dizin_kapsandi FROM imha_listesi ORDER BY liste_olusturma_zamani DESC LIMIT 20`)).rows;
    const k = l.length ? (await b.db.query(`SELECT k.kimlik, k.liste_ref, k.grup_kod, p.grup, p.sorumlu_unvan, k.nesne_turu, k.ozet, k.durum, k.cikarma_gerekcesi, k.birim_kontrol_eden_ref FROM imha_kalemi k JOIN saklama_plani p ON p.kod = k.grup_kod WHERE k.liste_ref = ANY($1::uuid[]) ORDER BY k.grup_kod`, [l.map((x) => x.kimlik)])).rows : [];
    return l.map((x) => ({ ...x, kalemler: k.filter((z) => z.liste_ref === x.kimlik) }));
  });
  s.post('/imha-kalemi/:id/cikar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = ((i.body ?? {}) as { gerekce?: string }).gerekce?.trim();
    if (!UUID.test(id)) return yok(y);
    if (!(await rolVar(o.kullanici, KVKK_ROL))) return y.code(403).send({ hata: 'Listeyi Hukuk ve Uyum düzenler.' });
    if (!g) return y.code(400).send({ hata: 'Listeden çıkarma gerekçesi zorunludur.' });
    const r = await b.db.query(`UPDATE imha_kalemi k SET durum = 'Çıkarıldı', cikarma_gerekcesi = $2 FROM imha_listesi l WHERE k.kimlik = $1 AND l.kimlik = k.liste_ref AND l.durum IN ('Hazırlanıyor', 'Birim Kontrolünde') AND k.durum = 'Listede'`, [id, g]);
    return r.rowCount ? { tamam: true } : y.code(409).send({ hata: 'Bu kalem çıkarılamaz.' });
  });
  s.post('/imha-listesi/:id/birime-gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const l = await liste((i.params as { id: string }).id);
    if (!l) return yok(y);
    if (!(await rolVar(o.kullanici, [HUU]))) return y.code(403).send({ hata: 'Listeyi Hukuk ve Uyum Uzmanı hazırlar.' });
    if (l.durum !== 'Hazırlanıyor') return y.code(409).send({ hata: 'Liste gönderilmiştir.' });
    await b.db.query(`UPDATE imha_listesi SET durum = 'Birim Kontrolünde', hazirlayan_ref = $2 WHERE kimlik = $1`, [l.kimlik, o.kullanici]);
    for (const u of (await b.db.query(`SELECT DISTINCT p.sorumlu_unvan u FROM imha_kalemi k JOIN saklama_plani p ON p.kod = k.grup_kod WHERE k.liste_ref = $1 AND k.durum = 'Listede'`, [l.kimlik])).rows) await kartAc(b.db, { tur: 'İmha Birim Kontrolü', kategori: 'islem', baslik: `${l.yil} ${l.imha_donemi} · İmha Birim Kontrolü`, ozet: 'Biriminize ait kalemleri kontrol etmeniz rica olunur.', sahipRol: await rolId(b.db, u.u), nesneTuru: 'İmha Listesi', nesneKimligi: l.kimlik });
    return { durum: 'Birim Kontrolünde' };
  });
  s.post('/imha-listesi/:id/birim-onay', oturumlu, async (i, y) => {
    const o = i.oturum!; const l = await liste((i.params as { id: string }).id);
    if (!l) return yok(y);
    if (l.durum !== 'Birim Kontrolünde') return y.code(409).send({ hata: 'Liste birim kontrolünde değildir.' });
    const rl = (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [o.kullanici])).rows.map((r) => r.rol_adi as string);
    const r = await b.db.query(`UPDATE imha_kalemi k SET birim_kontrol_eden_ref = $2 FROM saklama_plani p WHERE k.liste_ref = $1 AND p.kod = k.grup_kod AND k.durum = 'Listede' AND p.sorumlu_unvan = ANY($3::text[])`, [l.kimlik, o.kullanici, rl]);
    if (!r.rowCount) return y.code(403).send({ hata: 'Size ait kalem bulunmamaktadır.' });
    await b.db.query(`UPDATE is_karti k SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE k.tur = 'İmha Birim Kontrolü' AND k.nesne_kimligi = $1 AND k.durum = 'Bekliyor' AND k.sahip_rol_ref IN (SELECT kimlik FROM rol WHERE rol_adi = ANY($2::text[]))`, [l.kimlik, rl]);
    if (!(await b.db.query(`SELECT 1 FROM imha_kalemi WHERE liste_ref = $1 AND durum = 'Listede' AND birim_kontrol_eden_ref IS NULL LIMIT 1`, [l.kimlik])).rowCount) {
      await b.db.query(`UPDATE imha_listesi SET durum = 'Onayda' WHERE kimlik = $1`, [l.kimlik]);
      await kartAc(b.db, { tur: 'İmha Onayı', baslik: `${l.yil} ${l.imha_donemi} · İmha Onayı`, ozet: 'Birim kontrolleri tamamlandı.', oncelik: 'Yüksek', hazirlayan: l.hazirlayan_ref, zincir: [await rolId(b.db, HUD)], nesneTuru: 'İmha Listesi', nesneKimligi: l.kimlik });
    }
    return { tamam: true };
  });
  kapanisKaydet('İmha Onayı', async (c, k, karar, yapan) => {
    if (karar === 'Reddet') { await c.query(`UPDATE imha_listesi SET durum = 'Reddedildi' WHERE kimlik = $1::uuid`, [k.nesne_kimligi]); return; }
    if (karar !== 'Onayla') return;
    const l = (await c.query(`SELECT hazirlayan_ref FROM imha_listesi WHERE kimlik = $1::uuid`, [k.nesne_kimligi])).rows[0];
    if (l?.hazirlayan_ref === yapan) throw new Error('Hazırlayan ile onaylayan farklı olmalıdır.');
    for (const i of (await c.query(`SELECT kimlik, grup_kod, nesne_turu, nesne_kimligi FROM imha_kalemi WHERE liste_ref = $1::uuid AND durum = 'Listede'`, [k.nesne_kimligi])).rows) {
      await kalemUygula(c, i, b.depo?.kok);
      await c.query(`UPDATE imha_kalemi SET durum = 'İmha Edildi', imha_zamani = now() WHERE kimlik = $1`, [i.kimlik]);
    }
    await c.query(`UPDATE imha_listesi SET durum = 'Uygulandı', onaylayan_ref = $2, islemi_yapan_ref = $2, imha_tarihi = current_date, ortam = '{YATONET 360 ve veritabanları}' WHERE kimlik = $1::uuid`, [k.nesne_kimligi, yapan]);
  });
  // YG-1232: tutanak; imha kayıtları 3 yıl saklanır.
  s.get('/imha-listesi/:id/tutanak', oturumlu, async (i, y) => {
    const l = await liste((i.params as { id: string }).id);
    if (!l) return yok(y);
    if (!(await rolVar(i.oturum!.kullanici, KVKK_ROL))) return y.code(403).send({ hata: 'Tutanağa Hukuk ve Uyum erişir.' });
    if (l.durum !== 'Uygulandı') return y.code(409).send({ hata: 'Liste henüz uygulanmamıştır.' });
    const r = (await b.db.query(`SELECT p.kod, p.grup, p.imha_yontemi, count(*)::int adet, h.ad_soyad AS yapan FROM imha_kalemi k JOIN saklama_plani p ON p.kod = k.grup_kod JOIN imha_listesi l ON l.kimlik = k.liste_ref LEFT JOIN kullanici_hesabi h ON h.kimlik = l.islemi_yapan_ref WHERE k.liste_ref = $1 AND k.durum = 'İmha Edildi' GROUP BY p.kod, p.grup, p.imha_yontemi, h.ad_soyad`, [l.kimlik])).rows;
    return { yil: l.yil, donem: l.imha_donemi, imhaTarihi: l.imha_tarihi, ortam: l.ortam, gruplar: r };
  });
  s.get('/saklama-plani', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    return (await b.db.query(`SELECT kod, grup, sure_ay, baslangic_olayi, sorumlu_unvan, imha_yontemi, dayanak FROM saklama_plani ORDER BY kod`)).rows;
  });
}
