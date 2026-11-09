import { zorunluFormlar } from './zorunlu_form.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { dosyaErisimi, kapiKaydet, statuYaz } from './dosya.js';
import { dilKod, rolId, ONCELIK_SIRA, yatTarafinaYaz } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { garantiKarneIsle } from './karne.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayTalebiAc } from './onay.js';
import { altNumara, sureBaslat, sureBitir, sureKur } from './sure.js';
import { UUID } from './yat.js';
import { izinGerekli, kullaniciIzinleri } from './yetki.js';
import { birKez, bildir, disGonder } from './bildirim.js';
import { sigortaAdresiBekleniyor, sigortayaHazirla } from './sigorta_gonderim.js';
import { metinGetir, tutar } from './metin.js';
import { rolSahipleri } from './makam.js';

const ONEM_ONCELIK: Record<string, string> = { Kritik: 'Kritik', Yüksek: 'Yüksek', Orta: 'Normal', Düşük: 'Planlı', Gözlem: 'Planlı' };
const BAGLAMSIZ = /^(sağ|sol|ön|arka|sancak|iskele|baş|kıç|üst|alt)(\s+taraf(ı|ta)?)?$/i;
const KANIT_ZORUNLU = ['Bölge – Geniş Plan', 'Bölge – Yakın Plan (Ölçekli)'];
const GENEL_KALEMLER = ['Genel – Baş', 'Genel – Kıç', 'Genel – Sancak', 'Genel – İskele', 'Genel – Güverte', 'Kimlik – Yat Adı'];

/** Teknik kapılar: kapanış kontrolü YG-078'i, açık konuları ve keşfi denetler. Mali kapılar ilgili modülden eklenir (YG-067). */
export async function kapanisEksikleri(db: PoolClient | Baglam['db'], d: { kimlik: string; dosya_niteligi?: string; kapanma_nedeni?: string | null }, neden: string | null) {
  const l: string[] = [];
  if ((await db.query(`SELECT 1 FROM acik_konu WHERE dosya_ref = $1 AND statu NOT IN ('Kapalı', 'Geçersiz') LIMIT 1`, [d.kimlik])).rowCount) l.push('Açık Görev');
  if ((await db.query(`SELECT 1 FROM beklemede_isareti WHERE dosya_ref = $1 AND kaldirilma_zamani IS NULL LIMIT 1`, [d.kimlik])).rowCount) l.push('Beklemede işareti açık');
  if ((await db.query(`SELECT 1 FROM tedarik_siparisi WHERE dosya_ref = $1 AND statu IN ('Onay Bekliyor', 'Verildi', 'Kısmi Teslim') LIMIT 1`, [d.kimlik])).rowCount) l.push('Açık Tedarik Siparişi'); // YG-416
  if (neden === 'Tamamlandı' && !(await db.query(`SELECT 1 FROM kesif WHERE dosya_ref = $1 AND durum = 'Tamamlandı' LIMIT 1`, [d.kimlik])).rowCount) l.push('Teknik Eksik');
  if (neden === 'Tamamlandı' && (await db.query(`SELECT 1 FROM is_emri WHERE dosya_ref = $1 AND is_emri_turu IN ('ON', 'EK') LIMIT 1`, [d.kimlik])).rowCount && !(await db.query(`SELECT 1 FROM teslim_kaydi WHERE dosya_ref = $1 AND durum LIKE 'Teslim Edildi%' LIMIT 1`, [d.kimlik])).rowCount) l.push('Kabul Bekliyor'); // YG-148
  // YG-079: tam ziyada üzerinde iş yapılmış yat teslim adımıyla bırakılır; teslim kaydı olmadan dosya kapanmaz.
  if ((neden === 'Tam Ziya' || neden === 'Hükmi Tam Ziya') && (await db.query(`SELECT 1 FROM is_emri WHERE dosya_ref = $1 AND statu <> 'İptal' LIMIT 1`, [d.kimlik])).rowCount && !(await db.query(`SELECT 1 FROM teslim_kaydi WHERE dosya_ref = $1 AND durum LIKE 'Teslim Edildi%' LIMIT 1`, [d.kimlik])).rowCount) l.push('Tam Ziya Teslimi Bekliyor');
  return l;
}

kapanisKaydet('İyi Niyet Kararı', async (c, k, karar, yapan) => {
  if (!['Onayla', 'Reddet', 'Gerekçeyle İade Et'].includes(karar)) return; // ara kademe geçişi kaydı değiştirmez
  if (karar === 'Onayla') await c.query(`UPDATE garanti_sikayet SET karar = 'İyi Niyet', statu = 'Karar', karar_veren_ref = $2, yanit_zamani = coalesce(yanit_zamani, now()) WHERE kimlik = $1`, [k.nesne_kimligi, yapan]);
  else await c.query(`UPDATE garanti_sikayet SET statu = 'Açık', iyi_niyet_orani = NULL WHERE kimlik = $1`, [k.nesne_kimligi]);
});

kapanisKaydet('Dosya İşlemi', async (c, k, karar, yapan) => {
  const t = (await c.query(`SELECT t.*, d.statu, d.asama, d.dosya_no FROM dosya_islem_tutanagi t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!t || t.durum !== 'Onayda') return;
  if (karar === 'Reddet') { await c.query(`UPDATE dosya_islem_tutanagi SET durum = 'Reddedildi', karar_zamani = now() WHERE kimlik = $1`, [t.kimlik]); return; }
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE dosya_islem_tutanagi SET durum = 'Onaylandı', karar_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
  const d = { kimlik: t.dosya_ref, statu: t.statu, asama: t.asama };
  if (t.islem_turu === 'Askı') await statuYaz(c, d, { statu: 'Kontrollü Askıda', asama: t.asama }, t.gerekce, yapan, 'Operasyon Müdürü');
  else {
    await c.query(`UPDATE dosya SET kapanma_nedeni = $2, kapanis_zamani = now() WHERE kimlik = $1`, [t.dosya_ref, t.kapanis_nedeni]);
    await statuYaz(c, d, { statu: 'Kapalı', asama: t.asama }, t.gerekce, yapan);
  }
});

kapanisKaydet('Dosya Kapanışı', async (c, k, karar, yapan) => {
  const t = (await c.query(`SELECT t.*, d.statu, d.asama FROM kapanis_kontrolu t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!t || t.durum !== 'Hazırlandı') return;
  if (karar === 'Reddet') { await c.query(`UPDATE kapanis_kontrolu SET durum = 'Reddedildi' WHERE kimlik = $1`, [t.kimlik]); return; }
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE kapanis_kontrolu SET durum = 'Onaylandı', onaylayan_ref = $2, kapanis_zamani = now() WHERE kimlik = $1`, [t.kimlik, yapan]);
  if (t.cikis_statusu === 'Kapalı') {
    await c.query(`UPDATE dosya SET kapanma_nedeni = $2, kapanis_zamani = now() WHERE kimlik = $1`, [t.dosya_ref, t.kapanma_nedeni]);
    await c.query(`UPDATE paylasim_baglantisi p SET iptal_zamani = now() FROM belge_surum s JOIN belge e ON e.kimlik = s.belge_ref WHERE p.surum_ref = s.kimlik AND p.iptal_zamani IS NULL AND e.bag_turu = 'Dosya' AND e.bag_kimligi = $1::text`, [t.dosya_ref]); // YG-416
  }
  // YG-086: kanuni sorumluluk bitişi teslim + 24 ay; elle değiştirilmez.
  if (t.cikis_statusu === 'Teknik Kapalı') await c.query(`UPDATE dosya SET teslim_tarihi = current_date, kanuni_sorumluluk_bitis = current_date + interval '24 months' WHERE kimlik = $1`, [t.dosya_ref]);
  await statuYaz(c, { kimlik: t.dosya_ref, statu: t.statu, asama: t.asama }, { statu: t.cikis_statusu, asama: t.asama }, `Kapanış onayı${t.kapanma_nedeni ? `: ${t.kapanma_nedeni}` : ''}`, yapan);
});

kapanisKaydet('Dosya Yeniden Açma', async (c, k, karar, yapan) => {
  const t = (await c.query(`SELECT t.*, d.statu, d.asama FROM dosya_yeniden_acma t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kimlik = $1`, [k.nesne_kimligi])).rows[0];
  if (!t || t.durum !== 'Onayda') return;
  if (karar === 'Reddet') { await c.query(`UPDATE dosya_yeniden_acma SET durum = 'Reddedildi', karar_zamani = now() WHERE kimlik = $1`, [t.kimlik]); return; }
  if (karar !== 'Onayla') return;
  await c.query(`UPDATE dosya_yeniden_acma SET durum = 'Onaylandı', karar_zamani = now() WHERE kimlik = $1`, [t.kimlik]);
  // YG-080: yeni çevrim; önceki kararlar, teslim ve mali etkiler korunur, kapanış nedeni geçmişte kalır.
  await statuYaz(c, { kimlik: t.dosya_ref, statu: t.statu, asama: t.asama }, { statu: 'Aktif', asama: t.asama ?? 'Keşif' }, `Yeniden açıldı (${t.gerekce_turu}): ${t.gerekce}`, yapan, 'Dosya Sorumlusu');
  await c.query(`UPDATE dosya SET yeniden_acma_gerekcesi = $2, kapanma_nedeni = NULL, kapanis_zamani = NULL WHERE kimlik = $1`, [t.dosya_ref, t.gerekce]);
});

kapiKaydet('Teklif', async (db, d) => ((await db.query(`SELECT 1 FROM kesif WHERE dosya_ref = $1 AND durum = 'Tamamlandı' LIMIT 1`, [d.kimlik])).rowCount || d.oncelik === 'Kritik' ? null : 'Keşif tamamlanmadan teklif aşamasına geçilemez.'));
// YG-1452: hasar bölgesi fotoğrafı olmadan keşif kapanmaz.
export async function fotoEksikleri(db: Baglam['db'] | PoolClient, dosya: string, asama = 'Keşif'): Promise<string[]> {
  const kayit = (await db.query(`SELECT cekim_kalemi, bolge_kodu FROM gorsel_kanit WHERE dosya_ref = $1 AND asama = $2`, [dosya, asama])).rows as { cekim_kalemi: string; bolge_kodu: string | null }[];
  const eksik = GENEL_KALEMLER.filter((k) => !kayit.some((x) => x.cekim_kalemi === k));
  const bolgeler = (await db.query(`SELECT DISTINCT bolge_kodu FROM bulgu WHERE dosya_ref = $1 AND bolge_kodu IS NOT NULL`, [dosya])).rows.map((r) => r.bolge_kodu as string);
  for (const b of bolgeler) for (const k of KANIT_ZORUNLU) if (!kayit.some((x) => x.cekim_kalemi === k && x.bolge_kodu === b)) eksik.push(`${k} · ${b}`);
  return eksik;
}

export function sahaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Dosya bulunamadı veya erişim yetkiniz yok.' });
  const getir = async (id: string, k: string) => (UUID.test(id) && await dosyaErisimi(b.db, k, id) ? (await b.db.query(`SELECT * FROM dosya WHERE kimlik = $1`, [id])).rows[0] : undefined);
  const ekipRolleri = async (id: string, k: string) => (await b.db.query(`SELECT rol FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL`, [id, k])).rows.map((r) => r.rol as string);
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };

  // YG-056: keşif görevi onarımdan ayrı kayıt ve kapıdır. YG-049: Teknik Uzman atanmadan keşif başlamaz.
  s.post('/dosya/:id/kesif', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { amac?: string; sorular?: string; izinli?: string[]; kisit?: string; baslangic?: string; bitis?: string; bulusma?: string; guvenlik?: string; km?: number };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    if (d.statu !== 'Aktif' || d.asama !== 'Keşif') return y.code(409).send({ hata: 'Keşif yalnız Aktif dosyanın Keşif aşamasında planlanır.' });
    const roller = await ekipRolleri(id, o.kullanici);
    if (!roller.includes('Dosya Sorumlusu') && !roller.includes('Teknik Uzman') && !roller.includes('Sorumlu Teknik Uzman (Koordinatör)')) return y.code(403).send({ hata: 'Keşfi Dosya Sorumlusu veya Teknik Uzman planlar.' });
    if (!g.amac?.trim()) return y.code(400).send({ hata: 'Keşfin amacı ve kapsamı zorunludur.' });
    if (!g.baslangic || !g.bitis || new Date(g.bitis) <= new Date(g.baslangic)) return y.code(400).send({ hata: 'Planlanan başlangıç ve bitişi giriniz.' });
    const tu = (await b.db.query(`SELECT kullanici_ref FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND rol IN ('Sorumlu Teknik Uzman (Koordinatör)', 'Teknik Uzman') AND bitis_zamani IS NULL ORDER BY rol DESC LIMIT 1`, [id])).rows[0];
    if (!tu) return y.code(409).send({ hata: 'Keşif için Teknik Uzman ataması bekleniyor.' });
    const liste = (await b.db.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = 'LST_KESIF_IZINLI_ISLEM'`)).rows.map((r) => r.deger as string);
    if ((g.izinli ?? []).some((x) => !liste.includes(x))) return y.code(400).send({ hata: 'İzinli işlem listeden seçilir.' });
    const r = await islem(async (c) => {
      const k = (await c.query(`INSERT INTO kesif (dosya_ref, amac_kapsam, teknik_sorular, izinli_islemler, erisim_kisitlari, planlanan_baslangic, planlanan_bitis, bulusma_noktasi, sorumlu_ref, guvenlik_hazirligi, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING kimlik`,
        [id, g.amac!.trim(), g.sorular?.trim() || null, g.izinli ?? [], g.kisit?.trim() || null, g.baslangic, g.bitis, g.bulusma?.trim() || null, tu.kullanici_ref, g.guvenlik?.trim() || null, o.kullanici])).rows[0];
      await sureBitir(c, { tur: 'Randevu İletişimi', dosya: id });
      // YG-042, KSF-1: keşif iş emri firmaya gönderilmişse süre o andan işler; firmasız keşifte planlamayla başlar, gönderim gelirse yeniden kurulur.
      await c.query(`UPDATE kesif SET km = $2 WHERE kimlik = $1`, [k.kimlik, g.km ?? null]);
      const gn = (await c.query(`SELECT min(yayim_zamani) z FROM is_emri WHERE dosya_ref = $1 AND is_emri_turu = 'KN'`, [id])).rows[0].z as Date | null;
      await sureKur(c, { tur: 'Keşif', oncelik: d.oncelik, baslangic: gn ? new Date(gn) : new Date(), dosya: id, km: g.km });
      await bildir(c, { olay: `kesif:${k.kimlik}`, kullanicilar: [tu.kullanici_ref].filter((x) => x !== o.kullanici), baslik: `Keşif Görevi: ${d.dosya_no}`, ozet: g.amac!.trim().slice(0, 200), oncelik: d.oncelik, eposta: true });
      // K-213: keşif ve söküm izni yalnız sigortasız dosyada aranır; sigortalıda yat sahibi onayı alınmaz.
      if (d.dosya_niteligi !== 'Sigorta bağlantılı') {
        const t = (await c.query(`SELECT t.kimlik, t.kisi_adi_soyadi, t.telefon, t.eposta, t.kullanici_ref, y.yat_adi FROM dosya_tarafi t JOIN yat y ON y.kimlik = $2 WHERE t.dosya_ref = $1 AND t.taraf_rolu = 'Yat Sahibi' AND t.aktif LIMIT 1`, [id, d.yat_ref])).rows[0];
        if (t?.telefon || t?.eposta) await onayTalebiAc(c, { dosya: id, ony: 'ONY-01', dil: d.yazisma_dili === 'İngilizce' ? 'en' : 'tr', alanlar: { Yat: t.yat_adi, Yacht: t.yat_adi, 'Dosya No': d.dosya_no, 'File No': d.dosya_no }, taraf: t.kimlik, kullanici: t.kullanici_ref, aliciAd: t.kisi_adi_soyadi, telefon: t.telefon, eposta: t.eposta, belgeAdi: 'Keşif ve Söküm İzni', hazirlayan: o.kullanici, sigortaHatirlat: true, webAdresi: b.webAdresi, nesneTuru: 'Keşif', nesneKimligi: k.kimlik });
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Keşif Görevi Açıldı', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return k;
    });
    return r;
  });

  // YG-056, YG-111, YG-1529, YG-1452: tamamlanırken erişilemeyen alan açık konu olur; asbest/TBT şüphesi işi durdurur; katalog değeri teyit edilir; zorunlu fotoğraf eksiksizdir.
  s.post('/kesif/:id/tamamla', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { tarih?: string; katilimcilar?: string; baslangicDurumu?: string; incelenen?: string; erisilemeyen?: string; hedefTarih?: string; cikis?: string; supheli?: string; kanitSayimi?: boolean };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT k.*, d.dosya_no, d.yat_ref, d.oncelik FROM kesif k JOIN dosya d ON d.kimlik = k.dosya_ref WHERE k.kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (k.sorumlu_ref !== o.kullanici) return y.code(403).send({ hata: 'Keşfi sorumlu Teknik Uzman tamamlar.' });
    if (k.durum !== 'Planlandı') return y.code(409).send({ hata: 'Keşif sonuçlanmıştır.' });
    if (!g.incelenen?.trim() || !g.tarih) return y.code(400).send({ hata: 'Keşif tarihi ve incelenen alanlar zorunludur.' });
    if (!['Hazır', 'Koşullu', 'Açık'].includes(g.cikis ?? '')) return y.code(400).send({ hata: 'Çıkış durumunu seçiniz.' });
    if (!['Hayır', 'Evet', 'Bilinmiyor'].includes(g.supheli ?? '')) return y.code(400).send({ hata: 'Asbest ve eski TBT boyası sorusunu yanıtlayınız.' });
    if (!g.kanitSayimi) return y.code(400).send({ hata: 'Kanıt sayımını doğrulayınız.' });
    if (g.erisilemeyen?.trim() && !g.hedefTarih) return y.code(400).send({ hata: 'Erişilemeyen alan için hedef tarih giriniz; açık konu açılır.' });
    const yat = (await b.db.query(`SELECT katalog_teyit FROM yat WHERE kimlik = $1`, [k.yat_ref])).rows[0];
    if (yat.katalog_teyit === 'Katalogdan – teyit bekliyor') return y.code(409).send({ hata: 'Katalogdan gelen boy ve gövde bilgisini teyit ediniz veya düzeltiniz.' });
    const eksik = await fotoEksikleri(b.db, k.dosya_ref);
    if (eksik.length) return y.code(409).send({ hata: `Eksik fotoğraf: ${eksik.join(', ')}.`, eksik });
    const durdu = g.supheli !== 'Hayır';
    await islem(async (c) => {
      await c.query(`UPDATE kesif SET durum = $2, kesif_tarihi = $3, katilimcilar = $4, baslangic_durumu = $5, incelenen_alanlar = $6, erisilemeyen_alanlar = $7, cikis_durumu = $8, supheli_malzeme = $9, kanit_sayimi = true, saha_cikis_zamani = now(), durdurma_kaydi = $10, guncelleme_zamani = now() WHERE kimlik = $1`,
        [id, durdu ? 'Durduruldu' : 'Tamamlandı', g.tarih, g.katilimcilar?.trim() || null, g.baslangicDurumu?.trim() || null, g.incelenen!.trim(), g.erisilemeyen?.trim() || null, g.cikis, g.supheli, durdu ? 'Asbest veya eski TBT boyası şüphesi; numune ve analiz yönlendirmesi' : null]);
      if (!durdu) await sureBitir(c, { tur: 'Keşif', dosya: k.dosya_ref });
      if (g.erisilemeyen?.trim()) await c.query(`INSERT INTO acik_konu (konu_no, dosya_ref, baslik, aciklama, kaynak, sahip_ref, hedef_tarih, olusturan_ref) VALUES ($1,$2,'Erişilemeyen Alan',$3,'Keşif',$4,$5,$4)`, [await altNumara(c, k.dosya_no, 'AK'), k.dosya_ref, g.erisilemeyen.trim(), o.kullanici, g.hedefTarih]);
      if (durdu) await c.query(`INSERT INTO acik_konu (konu_no, dosya_ref, baslik, aciklama, kaynak, sahip_ref, hedef_tarih, olusturan_ref) VALUES ($1,$2,'Asbest / Eski TBT Boyası Şüphesi',$3,'Keşif',$4,current_date + 7,$4)`, [await altNumara(c, k.dosya_no, 'AK'), k.dosya_ref, `Cevap: ${g.supheli}. İş durduruldu; numune ve analiz yapılacak.`, o.kullanici]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: durdu ? 'Keşif Durduruldu' : 'Keşif Tamamlandı', nesneTuru: 'Dosya', nesneKimligi: k.dosya_ref, yeni: { cikis: g.cikis, supheli: g.supheli }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    });
    return { durum: durdu ? 'Durduruldu' : 'Tamamlandı' };
  });

  // YG-037, YG-130: önem bulguya verilir; dosya önceliği en ağır bulgudan önerilir. Konum bağlamsız olamaz.
  s.post('/dosya/:id/bulgu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { konum?: string; bolge?: string; aciklama?: string; etiket?: string; bilgiTuru?: string; onem?: string; islevEtkisi?: string; brans?: string; yonlendirme?: string; sorumlu?: string; hedefTarih?: string; beyanlaCelisen?: boolean; tamZiya?: boolean; anaBulgu?: string };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    if (!(await ekipRolleri(id, o.kullanici)).some((r) => ['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Saha Sorumlusu', 'Teknik Yönetici'].includes(r))) return y.code(403).send({ hata: 'Bulguyu teknik ekip girer.' });
    if (!g.konum?.trim() || BAGLAMSIZ.test(g.konum.trim())) return y.code(400).send({ hata: 'Konum referansını bölge veya referans hattına göre yazmanızı rica ederiz.' });
    if (!g.aciklama?.trim()) return y.code(400).send({ hata: 'Bulgu açıklaması zorunludur.' });
    const lst = async (k: string, v?: string) => Boolean((await b.db.query(`SELECT 1 FROM deger_listesi WHERE liste_kodu = $1 AND deger = $2`, [k, v ?? ''])).rowCount);
    if (!(await lst('LST_BULGU_ETIKETI', g.etiket)) || !(await lst('LST_BILGI_TURU', g.bilgiTuru)) || !(await lst('LST_HASAR_ONEMI', g.onem)) || !(await lst('LST_BULGU_YONLENDIRME', g.yonlendirme))) return y.code(400).send({ hata: 'Etiket, bilgi türü, önem ve yönlendirme listeden seçilir.' });
    if (!g.sorumlu || !g.hedefTarih || !(await dosyaErisimi(b.db, g.sorumlu, id))) return y.code(400).send({ hata: 'Yönlendirme sorumlusu ve hedef tarihi zorunludur.' });
    const r = await islem(async (c) => {
      const no = await altNumara(c, d.dosya_no, 'B', 3);
      const k = (await c.query(`INSERT INTO bulgu (bulgu_no, dosya_ref, kesif_ref, konum_referansi, bolge_kodu, ana_bulgu_ref, aciklama, bulgu_etiketi, bilgi_turu, hasar_onem_derecesi, islev_etkisi, teknik_brans, yonlendirme, yonlendirme_sorumlu_ref, yonlendirme_hedef_tarihi, beyanla_celisen, tam_ziya_onerisi, olusturan_ref)
        VALUES ($1,$2,(SELECT kimlik FROM kesif WHERE dosya_ref = $2 AND durum = 'Planlandı' ORDER BY olusturma_zamani DESC LIMIT 1),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING kimlik, bulgu_no`,
        [no, id, g.konum!.trim(), g.bolge?.trim() || null, g.anaBulgu || null, g.aciklama!.trim(), g.etiket, g.bilgiTuru, g.onem, g.islevEtkisi?.trim() || null, g.brans?.trim() || null, g.yonlendirme, g.sorumlu, g.hedefTarih, Boolean(g.beyanlaCelisen), Boolean(g.tamZiya), o.kullanici])).rows[0];
      const oneriS = ONEM_ONCELIK[g.onem!]!;
      const mevcut = d.onerilen_oncelik;
      if (!mevcut || ONCELIK_SIRA.indexOf(oneriS) > ONCELIK_SIRA.indexOf(mevcut)) await c.query(`UPDATE dosya SET onerilen_oncelik = $2 WHERE kimlik = $1`, [id, oneriS]);
      // YG-129: beyanla çelişen bulgu tarafsız kaydedilir ve sigortaya bildirilmek üzere Dosya Sorumlusuna düşer. Bulgu Tam Ziya önerisi de sigortacıya gider.
      if ((g.beyanlaCelisen || g.tamZiya) && d.dosya_sorumlusu_ref) await kartAc(c, { tur: 'Sigorta Bildirimi', kategori: 'gorev', baslik: `${d.dosya_no} · ${g.tamZiya ? 'Tam Ziya Önerisi' : 'Beyanla Çelişen Bulgu'} Sigortaya Bildirilecek`, ozet: k.bulgu_no, oncelik: 'Yüksek', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Bulgu', nesneKimligi: k.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bulgu Kaydedildi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { no: k.bulgu_no, onem: g.onem }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: k.kimlik, bulguNo: k.bulgu_no, onerilenOncelik: oneriS };
    });
    return r;
  });

  // YG-503, YG-1452: yönlendirmeli fotoğraf. Numara Dosya no-Gnnnn; çekilemeyen kare neden ister, hasar bölgesi karesi geçilemez.
  s.post('/dosya/:id/gorsel', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { belge?: string; asama?: string; kalem?: string; tur?: string; bolge?: string; zaman?: string; konum?: string; olcek?: string; bulgu?: string; aciklama?: string; cekilemedi?: string; cekilemediAciklama?: string };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    const lst = async (k: string, v?: string) => Boolean((await b.db.query(`SELECT 1 FROM deger_listesi WHERE liste_kodu = $1 AND deger = $2`, [k, v ?? ''])).rowCount);
    if (!(await lst('LST_FOTO_ASAMA', g.asama)) || !(await lst('LST_FOTO_CEKIM_KALEMI', g.kalem))) return y.code(400).send({ hata: 'Aşama ve çekim kalemi listeden seçilir.' });
    const bolgeKalemi = KANIT_ZORUNLU.includes(g.kalem!);
    if (bolgeKalemi && !g.bolge?.trim()) return y.code(400).send({ hata: 'Bölge kalemlerinde bölge kodu zorunludur.' });
    if (g.cekilemedi) {
      if (bolgeKalemi) return y.code(400).send({ hata: 'Hasar veya iş bölgesi fotoğrafını eklemenizi rica ederiz.' });
      if (!(await lst('LST_FOTO_CEKILEMEDI_NEDENI', g.cekilemedi))) return y.code(400).send({ hata: 'Çekilememe nedenini seçiniz.' });
      if (g.cekilemedi === 'Diğer' && !g.cekilemediAciklama?.trim()) return y.code(400).send({ hata: 'Açıklama zorunludur.' });
      await b.db.query(`INSERT INTO gorsel_kanit (dosya_ref, asama, cekim_kalemi, ceken_ref, cekilemedi_nedeni, cekilemedi_aciklama) VALUES ($1,$2,$3,$4,$5,$6)`, [id, g.asama, g.kalem, o.kullanici, g.cekilemedi, g.cekilemediAciklama?.trim() || null]);
      return { tamam: true };
    }
    if (g.kalem === 'Bölge – Yakın Plan (Ölçekli)' && !g.olcek?.trim()) return y.code(400).send({ hata: 'Yakın planda ölçek referansı zorunludur.' });
    if (!g.belge || !UUID.test(g.belge) || !(await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2`, [g.belge, id])).rowCount) return y.code(400).send({ hata: 'Fotoğrafı dosyaya yükleyip seçiniz.' });
    const rol = (await ekipRolleri(id, o.kullanici))[0] ?? null;
    return islem(async (c) => {
      const no = await altNumara(c, d.dosya_no, 'G', 4);
      const k = (await c.query(`INSERT INTO gorsel_kanit (gorsel_no, dosya_ref, belge_ref, cekim_zamani, ceken_ref, ceken_rol, konum, asama, cekim_kalemi, cekim_turu, bolge_kodu, olcek_referansi, bulgu_ref, aciklama) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING gorsel_no`,
        [no, id, g.belge, g.zaman ? new Date(g.zaman) : new Date(), o.kullanici, rol, g.konum ?? null, g.asama, g.kalem, g.tur ?? null, g.bolge?.trim() || null, g.olcek?.trim() || null, g.bulgu || null, g.aciklama?.trim() || null])).rows[0];
      return { gorselNo: k.gorsel_no };
    });
  });

  // YG-134: ham veri korunur; kalibrasyonu uygun olmayan cihaz kesin değer sayılmaz; sınır dışı sonuçta ikinci doğrulayan zorunlu.
  s.post('/dosya/:id/olcum', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { nokta?: string; buyukluk?: string; birim?: string; yontem?: string; cihaz?: string; kalibrasyon?: string; ham?: string; deger?: number; nominal?: number; tolerans?: number; gecerlilik?: string; ikinci?: string; zaman?: string; bulgu?: string; onceki?: string; gerekce?: string };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    if (!g.nokta?.trim() || !g.buyukluk?.trim() || !g.birim?.trim() || !g.yontem?.trim() || !g.cihaz?.trim() || !g.ham?.trim() || typeof g.deger !== 'number') return y.code(400).send({ hata: 'Ölçüm noktası, büyüklük, birim, yöntem, cihaz, ham veri ve değer zorunludur.' });
    if (!['Geçerli', 'Saha doğrulaması', 'Süresi geçmiş'].includes(g.kalibrasyon ?? '')) return y.code(400).send({ hata: 'Kalibrasyon durumunu seçiniz.' });
    if (!['Geçerli', 'Sınırlı', 'Geçersiz'].includes(g.gecerlilik ?? '')) return y.code(400).send({ hata: 'Geçerliliği seçiniz.' });
    if (g.kalibrasyon === 'Süresi geçmiş' && g.gecerlilik === 'Geçerli') return y.code(400).send({ hata: 'Kalibrasyonu geçmiş cihaz sonucu kesin değer olarak değil, bilgi olarak kaydedilir.' });
    const sinirDisi = g.nominal !== undefined && g.tolerans !== undefined && Math.abs(g.deger - g.nominal) > g.tolerans;
    if (sinirDisi && (!g.ikinci || g.ikinci === o.kullanici)) return y.code(400).send({ hata: 'Sınır dışı sonuçta farklı bir ikinci doğrulayan zorunludur.' });
    if (g.gecerlilik === 'Geçersiz' && !g.gerekce?.trim()) return y.code(400).send({ hata: 'Geçersizlik gerekçesi zorunludur.' });
    return islem(async (c) => {
      const no = await altNumara(c, d.dosya_no, 'OL', 3);
      await c.query(`INSERT INTO olcum_kaydi (olcum_no, dosya_ref, bulgu_ref, olcum_noktasi, olculen_buyukluk, birim, yontem, cihaz, kalibrasyon_durumu, ham_veri, ozet_deger, nominal_deger, tolerans, gecerlilik, sinir_disi, ikinci_dogrulayan_ref, olcum_zamani, olcen_ref, onceki_ref, gecersizlik_gerekcesi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [no, id, g.bulgu || null, g.nokta!.trim(), g.buyukluk!.trim(), g.birim!.trim(), g.yontem!.trim(), g.cihaz!.trim(), g.kalibrasyon, g.ham, g.deger, g.nominal ?? null, g.tolerans ?? null, g.gecerlilik, sinirDisi, g.ikinci ?? null, g.zaman ? new Date(g.zaman) : new Date(), o.kullanici, g.onceki ?? null, g.gerekce?.trim() || null]);
      return { olcumNo: no, sinirDisi };
    });
  });

  // YG-132: hasar bölgesi; altlık çizim ve yeni sürüm. Önceki sınır silinmez (YG-131).
  s.post('/dosya/:id/bolge', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { kod?: string; gorunus?: string[]; isaret?: unknown; hat?: string; boyuna?: string; enine?: string; miktar?: number; birim?: string; incelenmedi?: boolean };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    if (!/^[A-Z]{1,2}[0-9]{1,3}$/.test(g.kod ?? '')) return y.code(400).send({ hata: 'Bölge kodu S1, P1 biçiminde olmalıdır.' });
    if (!g.gorunus?.length || !g.isaret || !g.hat?.trim() || !g.boyuna?.trim()) return y.code(400).send({ hata: 'Görünüş, çizim, referans hat ve boyuna konum zorunludur.' });
    const r = await b.db.query(`INSERT INTO hasar_bolgesi (dosya_ref, bolge_kodu, gorunus, cizim_isaret, referans_hat, boyuna_konum_m, enine_konum_cm, alan_miktar, birim, surum, incelenmedi, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT coalesce(max(surum), 0) + 1 FROM hasar_bolgesi WHERE dosya_ref = $1 AND bolge_kodu = $2),$10,$11) RETURNING surum`,
      [id, g.kod, g.gorunus, JSON.stringify(g.isaret), g.hat.trim(), g.boyuna.trim(), g.enine?.trim() || null, g.miktar ?? null, g.birim ?? null, Boolean(g.incelenmedi), o.kullanici]);
    return { surum: r.rows[0].surum };
  });

  // YG-135: Uygun değilse açıklama; kritik maddede kanıt. Onayın hazırlayan dışında bir kişi tarafından verilmesini rica ederiz.
  s.post('/dosya/:id/kontrol-listesi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { kod } = (i.body ?? {}) as { kod?: string };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    const m = (await b.db.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = 'LST_KONTROL_LISTESI_MADDESI' AND deger LIKE $1 || ' / %' ORDER BY sira`, [kod ?? ''])).rows;
    if (!m.length) return y.code(400).send({ hata: 'Kontrol listesini seçiniz.' });
    return islem(async (c) => {
      const no = `${d.dosya_no}-${kod}-${String((await c.query(`SELECT count(*)::int + 1 n FROM kontrol_listesi_kaydi WHERE dosya_ref = $1 AND kontrol_listesi = $2`, [id, kod])).rows[0].n).padStart(2, '0')}`;
      const k = (await c.query(`INSERT INTO kontrol_listesi_kaydi (kayit_no, dosya_ref, kontrol_listesi, hazirlayan_ref) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [no, id, kod, o.kullanici])).rows[0];
      for (const r of m) await c.query(`INSERT INTO kontrol_listesi_maddesi (kayit_ref, madde, sorumlu_ref) VALUES ($1,$2,$3)`, [k.kimlik, r.deger, o.kullanici]);
      return { kimlik: k.kimlik, kayitNo: no, maddeler: m.map((r) => r.deger as string) };
    });
  });
  s.post('/kontrol-listesi/:id/madde', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { madde?: string; sonuc?: string; aciklama?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT dosya_ref, statu FROM kontrol_listesi_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (k.statu !== 'Taslak') return y.code(409).send({ hata: 'Kayıt tamamlanmıştır.' });
    if (!['Uygun', 'Uygun Değil', 'Geçerli Değil'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Sonucu seçiniz.' });
    if (g.sonuc === 'Uygun Değil' && !g.aciklama?.trim()) return y.code(400).send({ hata: 'Uygun değil sonucunda açıklama zorunludur.' });
    const r = await b.db.query(`UPDATE kontrol_listesi_maddesi SET sonuc = $3, aciklama = $4 WHERE kayit_ref = $1 AND madde = $2`, [id, g.madde, g.sonuc, g.aciklama?.trim() || null]);
    if (!r.rowCount) return y.code(404).send({ hata: 'Madde bulunamadı.' });
    return { tamam: true };
  });
  s.post('/kontrol-listesi/:id/tamamla', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { eksikler } = (i.body ?? {}) as { eksikler?: string };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT dosya_ref, hazirlayan_ref FROM kontrol_listesi_kaydi WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (k.hazirlayan_ref === o.kullanici) return y.code(403).send({ hata: 'Onayın hazırlayan dışında bir kişi tarafından verilmesini rica ederiz.' });
    const m = (await b.db.query(`SELECT sonuc FROM kontrol_listesi_maddesi WHERE kayit_ref = $1`, [id])).rows;
    if (m.some((x) => !x.sonuc)) return y.code(409).send({ hata: 'Tüm maddeleri yanıtlayınız.' });
    if (m.some((x) => x.sonuc === 'Uygun Değil') && !eksikler?.trim()) return y.code(400).send({ hata: 'Uygun dışı madde varken eksikler alanı zorunludur.' });
    await b.db.query(`UPDATE kontrol_listesi_kaydi SET statu = 'Tamamlandı', eksikler = $2, onaylayan_ref = $3, onay_zamani = now() WHERE kimlik = $1`, [id, eksikler?.trim() || null, o.kullanici]);
    return { tamam: true };
  });

  s.get('/dosya/:id/saha', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    const q = (t: string) => b.db.query(t, [id]).then((r) => r.rows);
    const ustKademe = Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND (x.kademe = 'Direktör' OR x.rol_adi IN ('CEO', 'Genel Müdür Yardımcısı')) LIMIT 1`, [o.kullanici])).rowCount);
    return {
      kesifler: await q(`SELECT kimlik, amac_kapsam, durum, planlanan_baslangic, planlanan_bitis, cikis_durumu, supheli_malzeme FROM kesif WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`),
      bulgular: await q(`SELECT kimlik, bulgu_no, konum_referansi, bolge_kodu, aciklama, hasar_onem_derecesi, bulgu_etiketi, bilgi_turu, yonlendirme, tam_ziya_onerisi, beyanla_celisen, sigortaciya_bildirim_zamani FROM bulgu WHERE dosya_ref = $1 ORDER BY bulgu_no`),
      gorseller: await q(`SELECT g.gorsel_no, g.asama, g.cekim_kalemi, g.bolge_kodu, g.cekilemedi_nedeni, g.cekim_zamani, g.belge_ref FROM gorsel_kanit g WHERE g.dosya_ref = $1 ORDER BY g.olusturma_zamani`),
      olcumler: await q(`SELECT olcum_no, olcum_noktasi, olculen_buyukluk, ozet_deger, birim, gecerlilik, sinir_disi FROM olcum_kaydi WHERE dosya_ref = $1 ORDER BY olcum_no`),
      bolgeler: await q(`SELECT DISTINCT ON (bolge_kodu) bolge_kodu, gorunus, referans_hat, boyuna_konum_m, surum, incelenmedi FROM hasar_bolgesi WHERE dosya_ref = $1 ORDER BY bolge_kodu, surum DESC`),
      kontrolListeleri: await q(`SELECT kimlik, kayit_no, kontrol_listesi, statu FROM kontrol_listesi_kaydi WHERE dosya_ref = $1 ORDER BY olusturma_zamani`),
      fotoEksik: await fotoEksikleri(b.db, id),
      garantiKayitlari: (await q(`SELECT kimlik, kayit_no, kayit_turu, statu, oncelik, yanit_son, karar, sikayet_sonucu FROM garanti_sikayet WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC`)).filter((g: { kayit_turu: string[] }) => ustKademe || !g.kayit_turu.some((x) => /ayıp/i.test(x))), // YG-1078
    };
  });

  // YG-075, YG-1436: askı, iptal, fesih ve devir tutanağı; Operasyon Müdürünün onayına düşer, imzasız iç onaydır.
  s.post('/dosya/:id/islem', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { tur?: string; neden?: string; gerekce?: string; talepEden?: string; yatDurumu?: string; yapilan?: string; bedel?: number; acik?: string; teslim?: string; devralan?: string; mucbir?: boolean };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    if (d.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Tutanağı Dosya Sorumlusu hazırlar.' });
    if (['Kapalı'].includes(d.statu)) return y.code(409).send({ hata: 'Dosya kapalıdır.' });
    if (!['Askı', 'İptal', 'Fesih', 'Devir'].includes(g.tur ?? '')) return y.code(400).send({ hata: 'İşlem türünü seçiniz.' });
    if (!g.gerekce?.trim() || !g.talepEden?.trim() || !g.yatDurumu?.trim() || !g.yapilan?.trim() || !g.acik?.trim() || !g.teslim?.trim()) return y.code(400).send({ hata: 'Gerekçe, talep eden, yat durumu, yapılan işler, açık işler ve teslim edilenler zorunludur.' });
    if (g.tur !== 'Askı') {
      if (!(await b.db.query(`SELECT 1 FROM deger_listesi WHERE liste_kodu = 'LST_KAPANMA_NEDENI' AND deger = $1`, [g.neden ?? ''])).rowCount) return y.code(400).send({ hata: 'Kapanma nedenini seçiniz.' });
      if (g.tur === 'Devir' && (!g.devralan?.trim() || g.neden !== 'Devredildi')) return y.code(400).send({ hata: 'Devirde devralan taraf yazılır, neden Devredildi olur.' });
    }
    if ((await b.db.query(`SELECT 1 FROM dosya_islem_tutanagi WHERE dosya_ref = $1 AND durum = 'Onayda'`, [id])).rowCount) return y.code(409).send({ hata: 'Onayda bekleyen tutanak vardır.' });
    return islem(async (c) => {
      const t = (await c.query(`INSERT INTO dosya_islem_tutanagi (dosya_ref, islem_turu, kapanis_nedeni, gerekce, talep_eden, yat_durumu, yapilan_isler, yapilan_isler_bedeli, acik_isler, teslim_edilenler, devralan_taraf, mucbir_sebep, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING kimlik`,
        [id, g.tur, g.tur === 'Askı' ? null : g.neden, g.gerekce!.trim(), g.talepEden!.trim(), g.yatDurumu!.trim(), g.yapilan!.trim(), g.bedel ?? null, g.acik!.trim(), g.teslim!.trim(), g.devralan?.trim() || null, Boolean(g.mucbir), o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Dosya İşlemi', baslik: `${d.dosya_no} · ${g.tur} Tutanağı`, ozet: g.gerekce!.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Operasyon Müdürü')], nesneTuru: 'Dosya İşlemi', nesneKimligi: t.kimlik });
      return { kimlik: t.kimlik, durum: 'Onaya Gönderildi' };
    });
  });

  // YG-148, YG-014: her Hayır eksiklik işareti üretir; zorunlu kayıt eksikken Kapalı olmaz. Aktarılmamış yazışma beyanı istenir. Onay Operasyon Müdüründe.
  s.post('/dosya/:id/kapanis', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { cikis?: string; neden?: string; yetkiKapsam?: boolean; uygulama?: boolean; testKabul?: boolean; acikKonu?: boolean; garanti?: boolean; arsiv?: boolean; yazismaBeyani?: boolean };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    if (d.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'Kapanış kontrolünü Dosya Sorumlusu hazırlar.' });
    if (!g.yazismaBeyani) return y.code(400).send({ hata: '"Bu dosyayla ilgili aktarılmamış yazışma yok" beyanını işaretleyiniz.' });
    if (!['Teknik Kapalı', 'Kapalı'].includes(g.cikis ?? '')) return y.code(400).send({ hata: 'Çıkış statüsünü seçiniz.' });
    if (g.cikis === 'Teknik Kapalı' && d.statu !== 'Aktif') return y.code(409).send({ hata: 'Teknik kapanış Aktif dosyada yapılır.' });
    if (g.cikis === 'Kapalı' && d.statu !== 'Teknik Kapalı') return y.code(409).send({ hata: 'Kapalı statüsüne Teknik Kapalı üzerinden geçilir; erken sonlandırmada tutanak düzenlenir.' });
    if (g.cikis === 'Kapalı' && !(await b.db.query(`SELECT 1 FROM deger_listesi WHERE liste_kodu = 'LST_KAPANMA_NEDENI' AND deger = $1`, [g.neden ?? ''])).rowCount) return y.code(400).send({ hata: 'Kapanma nedenini seçiniz.' });
    const isaret: string[] = [];
    if (!g.yetkiKapsam) isaret.push('Kapanış Bekliyor');
    // YG-076: ON/EK iş emri yayımlanmadan kapanan dosyada uygulama, kabul ve garanti işaretleri aranmaz.
    const onVar = Boolean((await b.db.query(`SELECT 1 FROM is_emri WHERE dosya_ref = $1 AND is_emri_turu IN ('ON', 'EK') AND statu NOT IN ('Taslak', 'İç Onayda', 'İptal') LIMIT 1`, [id])).rowCount);
    if (!g.uygulama && onVar) isaret.push('Teknik Eksik');
    if (!g.testKabul && onVar) isaret.push('Kabul Bekliyor');
    if (!g.acikKonu) isaret.push('Açık Görev');
    if (!g.garanti && onVar) isaret.push('Garanti Bağı Eksik');
    if (!g.arsiv && g.cikis === 'Kapalı') isaret.push('Arşiv Bekliyor');
    const kapi = await kapanisEksikleri(b.db, d, g.neden ?? null);
    for (const k of KAPILAR_KAPANIS) { const h = await k(b.db, d, g.cikis!); if (h) kapi.push(h); }
    if (isaret.length || kapi.length) return y.code(409).send({ hata: `Kapanış için eksikler: ${[...new Set([...isaret, ...kapi])].join(', ')}.`, eksikler: [...new Set([...isaret, ...kapi])] });
    return islem(async (c) => {
      const t = (await c.query(`INSERT INTO kapanis_kontrolu (dosya_ref, hazirlayan_ref, yetki_kapsam_kontrolu, uygulama_kontrolu, test_kabul_kontrolu, acik_konu_kontrolu, garanti_kontrolu, arsiv_kontrolu, yazisma_beyani, cikis_statusu, kapanma_nedeni) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10) RETURNING kimlik`,
        [id, o.kullanici, true, true, true, true, true, Boolean(g.arsiv), g.cikis, g.cikis === 'Kapalı' ? g.neden : null])).rows[0];
      { const fm = (await zorunluFormlar(c, id)).filter((x) => !x.var).map((x) => x.kod); if (fm.length) await c.query(`UPDATE kapanis_kontrolu SET eksiklik_isaretleri = $2 WHERE kimlik = $1`, [t.kimlik, fm]); } // YG-635: kayda geçer, kapanışı durdurmaz
      await kartAc(c, { tur: 'Dosya Kapanışı', baslik: `${d.dosya_no} · ${g.cikis} Onayı`, ozet: g.neden ?? 'Teslim ve kabul tamam', hazirlayan: o.kullanici, zincir: [await rolId(c, 'Operasyon Müdürü')], nesneTuru: 'Kapanış Kontrolü', nesneKimligi: t.kimlik });
      return { kimlik: t.kimlik, durum: 'Onaya Gönderildi' };
    });
  });

  // YG-080: yeni bilgi, hata veya müşteri bildirimiyle ve Operasyon Müdürü onayıyla. Yeni çevrim; önceki kayıtlar korunur. YG-081: garanti dosyayı yeniden açmaz.
  s.post('/dosya/:id/yeniden-ac', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; gerekce?: string };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    if (d.statu !== 'Kapalı') return y.code(409).send({ hata: 'Yalnız kapalı dosya yeniden açılır.' });
    if (d.kapanma_nedeni === 'Birleştirildi') return y.code(409).send({ hata: 'Birleştirilen dosyanın işlemlerini ana dosyadan yürütmenizi rica ederiz.' });
    if (!['Yeni Bilgi', 'Hata', 'Müşteri Bildirimi'].includes(g.tur ?? '') || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe türü ve açıklama zorunludur.' });
    return islem(async (c) => {
      const t = (await c.query(`INSERT INTO dosya_yeniden_acma (dosya_ref, gerekce_turu, gerekce, onceki_nedeni, talep_eden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, g.tur, g.gerekce!.trim(), d.kapanma_nedeni, o.kullanici])).rows[0];
      await kartAc(c, { tur: 'Dosya Yeniden Açma', baslik: `${d.dosya_no} · Yeniden Açma`, ozet: g.gerekce!.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Operasyon Müdürü')], nesneTuru: 'Yeniden Açma', nesneKimligi: t.kimlik });
      return { durum: 'Onaya Gönderildi' };
    });
  });

  // YG-024: mükerrer dosya silinmez; Birleştirildi nedeniyle kapanır, eski numara ana dosyaya yönlendirir, açık sayaç ve bekleyen onaylar ana dosyaya geçer.
  s.post('/dosya/:id/birlestir', { preHandler: izinGerekli(b, 'dosya.ata.operasyon') }, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ana?: string; gerekce?: string };
    if (!UUID.test(id) || !g.ana || !UUID.test(g.ana) || id === g.ana) return y.code(400).send({ hata: 'Ana dosyayı seçiniz.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    return islem(async (c) => {
      const d = (await c.query(`SELECT * FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      const a = (await c.query(`SELECT * FROM dosya WHERE kimlik = $1`, [g.ana])).rows[0];
      if (!d || !a) throw Object.assign(new Error('Dosya bulunamadı.'), { statusCode: 404 });
      if (d.statu === 'Kapalı' || a.statu === 'Kapalı') throw Object.assign(new Error('Birleştirme açık dosyalarda yapılır.'), { statusCode: 409 });
      await c.query(`UPDATE dosya SET birlestirilen_ana_dosya_ref = $2, kapanma_nedeni = 'Birleştirildi', kapanis_zamani = now() WHERE kimlik = $1`, [id, g.ana]);
      await statuYaz(c, d, { statu: 'Kapalı', asama: d.asama }, `Birleştirildi: ${a.dosya_no}. ${g.gerekce!.trim()}`, o.kullanici);
      await c.query(`INSERT INTO dosya_iliskisi (kaynak_ref, hedef_ref, tur, gerekce, olusturan_ref) VALUES ($1,$2,'Birleştirildi',$3,$4)`, [id, g.ana, g.gerekce!.trim(), o.kullanici]);
      await c.query(`UPDATE is_karti SET nesne_kimligi = $2 WHERE nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id, g.ana]);
      await c.query(`UPDATE onay_talebi SET dosya_ref = $2 WHERE dosya_ref = $1 AND durum = 'Bekliyor'`, [id, g.ana]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Dosya Birleştirildi', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { ana: a.dosya_no }, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { anaNo: a.dosya_no };
    });
  });

  // YG-1477: vefat işareti otomatik mesajı ve onay bağlantılarını durdurur; DS'ye sıralı görevler açılır. Kurumsal müşteride tetiklenmez.
  s.post('/dosya/:id/vefat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tarih?: string };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    if (d.dosya_sorumlusu_ref !== o.kullanici) return y.code(403).send({ hata: 'İşareti Dosya Sorumlusu girer.' });
    if (d.musteri_turu === 'Kurumsal Müşteri') return y.code(409).send({ hata: 'Kurumsal müşteride kurum yeni yetkili atar; vefat akışı bireysel yat sahipleri içindir.' });
    if (d.vefat_isareti) return y.code(409).send({ hata: 'İşaret girilmiştir.' });
    return islem(async (c) => {
      await c.query(`UPDATE dosya SET vefat_isareti = true, vefat_tarihi = $2, guncelleme_zamani = now() WHERE kimlik = $1`, [id, g.tarih || null]);
      await c.query(`UPDATE onay_talebi SET durum = 'Durduruldu' WHERE dosya_ref = $1 AND durum = 'Bekliyor'`, [id]);
      await c.query(`UPDATE gonderim SET durum = 'Başarısız', son_hata = 'Vefat işareti' WHERE durum = 'Bekliyor' AND (olay_anahtari LIKE '%' || $1 || '%')`, [id]);
      const enErken = g.tarih ? new Date(new Date(g.tarih).getTime() + 96 * 3_600_000) : null;
      await kartAc(c, { tur: 'Vefat Görevi', kategori: 'gorev', baslik: `${d.dosya_no} · Aileyi Ara`, ozet: enErken ? `En erken arama tarihi: ${enErken.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}` : 'Ailenin yas sürecine saygı gösteriniz.', sonZaman: enErken, sahipKullanici: o.kullanici, nesneTuru: 'Dosya', nesneKimligi: id });
      await kartAc(c, { tur: 'Vefat Görevi', kategori: 'gorev', baslik: `${d.dosya_no} · Mirasçılık Belgesi ve Tek Temsilci`, ozet: 'Mirasçılık belgesini ve tek temsilciyi kaydediniz.', sahipKullanici: o.kullanici, nesneTuru: 'Dosya', nesneKimligi: id });
      await kartAc(c, { tur: 'Vefat Görevi', kategori: 'islem', baslik: `${d.dosya_no} · Vefat Değerlendirmesi`, ozet: 'Tahsilat askıda; alacak bu göreve bağlıdır.', sahipRol: await rolId(c, 'Hukuk ve Uyum Direktörü'), nesneTuru: 'Dosya', nesneKimligi: id });
      // BLD-45: sigortaya bekletme e-postası Dosya Sorumlusunun ikili teyidiyle gider (K-241); yat sahibine otomatik ileti durmuştur.
      const sg = (await c.query(`SELECT t.eposta FROM dosya_sigorta_kaydi s JOIN dosya_tarafi t ON t.kimlik = s.sigorta_taraf_ref WHERE s.dosya_ref = $1`, [id])).rows[0];
      if (sg?.eposta) await sigortayaHazirla(c, { dosya: id, tur: 'BLD-45', nesne: id, alici: sg.eposta, konu: `${d.dosya_no} Bilgilendirme`, metin: await metinGetir(c, 'BLD-45', 'tr', { 'Dosya No': d.dosya_no }), acil: true });
      else await sigortaAdresiBekleniyor(c, id);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Vefat İşareti', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { tamam: true };
    });
  });

  // YG-1497: sigortalı dosyada yat sahibi itirazı çalışmaları geçici durdurur, onaylı bildirim gider, Dosya Sorumlusuna arama görevi açılır.
  s.post('/dosya/:id/itiraz', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    if (d.dosya_niteligi !== 'Sigorta bağlantılı') return y.code(409).send({ hata: 'Bu kayıt sigortalı dosyada kullanılır.' });
    return islem(async (c) => {
      await c.query(`UPDATE dosya SET yat_sahibi_itirazi = now(), calisma_durduruldu = true WHERE kimlik = $1`, [id]);
      const t = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [id])).rows[0];
      if (t) await yatTarafinaYaz(c, { olay: `bld40:${id}`, kod: 'BLD-40', dil: dilKod(d.yazisma_dili), konu: `${d.dosya_no} İtiraz`, telefon: t.telefon, eposta: t.eposta, acil: true, alanlar: { 'Dosya No': d.dosya_no, 'File No': d.dosya_no, 'bağlantı': b.webAdresi, link: b.webAdresi } });
      if (d.dosya_sorumlusu_ref) await kartAc(c, { tur: 'İtiraz Araması', kategori: 'gorev', baslik: `${d.dosya_no} · Yat Sahibini Arayınız`, ozet: 'Kılavuz cümle: Dosyanızdaki işler sigorta şirketinizin onayıyla yürütülecektir; teklif ve gelişmeler size ayrıca bildirilecektir.', oncelik: 'Kritik', sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Dosya', nesneKimligi: id });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Yat Sahibi İtirazı', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { durduruldu: true };
    });
  });

  // YG-081, YG-085, YG-1423, YG-1424, YG-1425: garanti ve şikâyet ayrı kayıt; numara GKnn / SKnn; kapalı dosyayı açmaz. Şikâyette 10 iş günü nihai yanıt.
  s.post('/dosya/:id/garanti-sikayet', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { turler?: string[]; kanal?: string; bildirimZamani?: string; belirti?: string; konu?: string; oncelik?: string; tekrarlayan?: boolean; konum?: string; yurtDisi?: boolean; yerinde?: boolean };
    const d = await getir(id, o.kullanici);
    if (!d) return yok(y);
    const turler = g.turler ?? [];
    if (!turler.length || turler.some((x) => !['Garanti bildirimi', 'Şikâyet'].includes(x))) return y.code(400).send({ hata: 'Kayıt türünü seçiniz.' });
    if (!(await b.db.query(`SELECT 1 FROM deger_listesi WHERE liste_kodu = 'LST_TALEP_KANALI' AND deger = $1`, [g.kanal ?? ''])).rowCount) return y.code(400).send({ hata: 'Kanalı seçiniz.' });
    if (!ONCELIK_SIRA.includes(g.oncelik ?? '')) return y.code(400).send({ hata: 'Önceliği seçiniz.' });
    const garanti = turler.includes('Garanti bildirimi'); const sikayet = turler.includes('Şikâyet');
    if (garanti && !g.belirti?.trim()) return y.code(400).send({ hata: 'Belirti zorunludur.' });
    if (g.yerinde && !(garanti && g.yurtDisi)) return y.code(400).send({ hata: 'Yerinde müdahale yalnız yurt dışı garanti talebinde seçilir.' });
    if (sikayet && !g.konu?.trim()) return y.code(400).send({ hata: 'Şikâyet konusu zorunludur.' });
    return islem(async (c) => {
      const no = await altNumara(c, d.dosya_no, garanti ? 'GK' : 'SK');
      const simdi = new Date();
      // YG-1417: garanti keşfi Yüksek 48 saat, Normal ve Planlı en geç 72 saat. Kritikte acil evre kuralı geçerlidir.
      const kesifSaat: Record<string, number | null> = { Kritik: null, Yüksek: 48, Normal: 72, Planlı: 72 };
      const saat = kesifSaat[g.oncelik!];
      // YG-1422: yurt dışındaki yatta garanti Türkiye'de yerine getirilir; keşif süresi yat gelene kadar işlemez.
      const kesifSon = garanti && saat && !g.yurtDisi ? new Date(simdi.getTime() + saat * 3_600_000) : null;
      const takip = sikayet ? (await rolSahipleri(c, await rolId(c, 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı')))[0] : null;
      const sonuc = sikayet ? (await rolSahipleri(c, await rolId(c, 'Müşteri ve Paydaş İlişkileri Müdürü')))[0] : null;
      const yanitSon = sikayet ? await isGunuEkle(c, simdi, 10) : null;
      const k = (await c.query(`INSERT INTO garanti_sikayet (kayit_no, dosya_ref, kayit_turu, kanal, bildirim_zamani, konum, belirti, oncelik, tekrarlayan, sikayet_konusu, kesif_son, yanit_son, sikayet_takip_ref, sikayet_sonuc_ref, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING kimlik`,
        [no, id, turler, g.kanal, g.bildirimZamani ? new Date(g.bildirimZamani) : simdi, g.konum?.trim() || d.konum, g.belirti?.trim() || null, g.oncelik, Boolean(g.tekrarlayan), g.konu?.trim() || null, kesifSon, yanitSon, takip ?? null, sonuc ?? null, o.kullanici])).rows[0];
      if (g.yurtDisi && garanti) { await c.query(`UPDATE garanti_sikayet SET yurt_disi = true, yerinde_mudahale = $2 WHERE kimlik = $1`, [k.kimlik, Boolean(g.yerinde)]); if (g.yerinde) await kartAc(c, { tur: 'Fiyat Teklifi Hazırla', kategori: 'islem', baslik: `${no} · Yurt Dışı Yerinde Müdahale Teklifi`, ozet: 'Garanti Türkiye\'de yerine getirilir; yerinde müdahale ayrı teklifle yürür.', sahipRol: await rolId(c, 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)'), nesneTuru: 'Garanti Şikâyet', nesneKimligi: k.kimlik }); }
      await c.query(`UPDATE garanti_sikayet g SET kurulus_ref = (SELECT e.kurulus_ref FROM is_emri e WHERE e.dosya_ref = $2 AND e.is_emri_turu IN ('ON', 'EK') ORDER BY e.olusturma_zamani DESC LIMIT 1) WHERE g.kimlik = $1`, [k.kimlik, id]); // YG-335: ayıp bildirimi işi yapan firmaya bağlanır
      if (takip) await kartAc(c, { tur: 'Şikâyet Takibi', kategori: 'islem', baslik: `${no} · Şikâyet Kaydı ve İlk Teyit`, ozet: g.konu!.trim().slice(0, 200), sahipKullanici: takip, sonZaman: yanitSon, nesneTuru: 'Garanti Şikâyet', nesneKimligi: k.kimlik });
      if (garanti && d.dosya_sorumlusu_ref) await kartAc(c, { tur: 'Garanti Keşfi', kategori: 'gorev', baslik: `${no} · Garanti Keşfi`, ozet: g.belirti!.trim().slice(0, 200), oncelik: g.oncelik === 'Kritik' ? 'Kritik' : 'Normal', sonZaman: kesifSon, sahipKullanici: d.dosya_sorumlusu_ref, nesneTuru: 'Garanti Şikâyet', nesneKimligi: k.kimlik });
      // YG-1423, BLD-62, BLD-63: alındı bildirimi otomatik; gönderim kayda geçer. Metin alanları kataloğa göre doldurulur.
      const yt = (await c.query(`SELECT telefon, eposta FROM dosya_tarafi WHERE dosya_ref = $1 AND taraf_rolu = 'Yat Sahibi' AND aktif LIMIT 1`, [id])).rows[0];
      if (yt && !d.vefat_isareti) await yatTarafinaYaz(c, { olay: `alindi:${k.kimlik}`, kod: garanti ? 'BLD-62' : 'BLD-63', dil: dilKod(d.yazisma_dili), konu: `${no} Kaydınız Alındı`, telefon: yt.telefon, eposta: yt.eposta, alanlar: alindiAlanlari(no, d.dosya_no, simdi, (g.belirti ?? g.konu)!.trim().slice(0, 120), b.webAdresi) });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Garanti/Şikâyet Kaydı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { no }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { kimlik: k.kimlik, kayitNo: no };
    });
  });

  // YG-1416, YG-1420: kapsam kararı Teknik Yönetici; kök neden olmadan kapanmaz. Düzeltme maliyeti 5.000,00 EUR üstünde Teknik Müdür onayına gider. YG-1425: şikâyet sonucu listesi.
  s.post('/garanti-sikayet/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const g = (i.body ?? {}) as { karar?: string; sikayetSonucu?: string; gerekce?: string; maliyet?: number; kokNeden?: boolean; kapat?: boolean };
    if (!UUID.test(id)) return yok(y);
    const k = (await b.db.query(`SELECT * FROM garanti_sikayet WHERE kimlik = $1`, [id])).rows[0];
    if (!k || !(await dosyaErisimi(b.db, o.kullanici, k.dosya_ref))) return yok(y);
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Karar gerekçesi zorunludur.' });
    const garanti = k.kayit_turu.includes('Garanti bildirimi');
    if (garanti) {
      if (!['Garanti', 'Üretici Garantisi', 'İyi Niyet', 'Ücretli İş', 'Kapsam Dışı'].includes(g.karar ?? '')) return y.code(400).send({ hata: 'Kararı seçiniz.' });
      const roller = await ekipRolleri(k.dosya_ref, o.kullanici);
      const izinler = await kullaniciIzinleri(b.db, o.kullanici);
      if (!roller.includes('Teknik Yönetici') && !izinler.includes('dosya.ata.teknik')) return y.code(403).send({ hata: 'Kapsam kararını Teknik Yönetici verir.' });
      if ((g.maliyet ?? 0) > 5000 && !izinler.includes('dosya.ata.teknik')) return y.code(403).send({ hata: 'Düzeltme maliyeti 5.000,00 EUR üstünde karar Teknik Müdür onayındadır.' });
      if (g.kapat && !g.kokNeden) return y.code(409).send({ hata: 'Kapanış için Kök neden analizi bekleniyor.' });
    }
    // YG-175: iyi niyet fatura tutarının %5'ine kadar GMY, üzeri CEO; karar onaylanınca yazılır. Fatura yoksa oran hesaplanamaz, CEO'ya gider.
    if (garanti && g.karar === 'İyi Niyet') {
      if (!(Number(g.maliyet) > 0)) return y.code(400).send({ hata: 'İyi niyet tutarını yazmanızı rica ederiz.' });
      if (k.iyi_niyet_orani !== null || await b.db.query(`SELECT 1 FROM is_karti WHERE tur = 'İyi Niyet Kararı' AND nesne_kimligi = $1 AND durum NOT IN ('Tamamlandı', 'Reddedildi', 'İptal') LIMIT 1`, [id]).then((r) => r.rowCount)) return y.code(409).send({ hata: 'Bu kayıt için iyi niyet onayı bekleniyor.' });
      const fatura = Number((await b.db.query(`SELECT coalesce(sum(kdv_haric_eur), 0) t FROM musteri_faturasi WHERE dosya_ref = $1 AND durum <> 'Reddedildi'`, [k.dosya_ref])).rows[0].t);
      const oran = fatura > 0 ? Math.round((Number(g.maliyet) / fatura) * 10000) / 100 : null;
      const tamOran = fatura > 0 ? Number(g.maliyet) / fatura : Infinity;
      const makam = tamOran <= 0.05 && Number(g.maliyet) <= 10000 ? 'Genel Müdür Yardımcısı' : 'CEO';
      const c = await b.db.connect();
      try {
        await c.query('BEGIN');
        await c.query(`UPDATE garanti_sikayet SET statu = 'İncelemede', iyi_niyet_orani = $2, duzeltme_maliyeti = $3, karar_gerekcesi = $4, kok_neden_tamam = kok_neden_tamam OR $5 WHERE kimlik = $1`, [id, oran ?? 100, g.maliyet, g.gerekce.trim(), Boolean(g.kokNeden)]);
        await kartAc(c, { tur: 'İyi Niyet Kararı', baslik: `${k.kayit_no} · İyi Niyet Kararı`, ozet: `${Number(g.maliyet).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR${oran === null ? ' · fatura yok' : ` · fatura tutarının %${String(oran).replace('.', ',')}'i`}`, hazirlayan: o.kullanici, zincir: [await rolId(c, makam)], nesneTuru: 'Garanti Kaydı', nesneKimligi: id });
        await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İyi Niyet Kararı Onaya Gönderildi', nesneTuru: 'Dosya', nesneKimligi: k.dosya_ref, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
      return { durum: 'Onay Bekleniyor', makam };
    }
    if (k.kayit_turu.includes('Şikâyet') && g.sikayetSonucu && !['Haklı – Düzeltildi', 'Kısmen Haklı', 'Haklı Değil', 'Bilgilendirme'].includes(g.sikayetSonucu)) return y.code(400).send({ hata: 'Şikâyet sonucunu seçiniz.' });
    await b.db.query(`UPDATE garanti_sikayet SET karar_zamani = coalesce(karar_zamani, now()) WHERE kimlik = $1`, [id]);
    await b.db.query(`UPDATE garanti_sikayet SET karar = coalesce($2, karar), sikayet_sonucu = coalesce($3, sikayet_sonucu), karar_gerekcesi = $4, karar_veren_ref = $5, duzeltme_maliyeti = coalesce($6, duzeltme_maliyeti), kok_neden_tamam = kok_neden_tamam OR $7, statu = $8, yanit_zamani = coalesce(yanit_zamani, now()) WHERE kimlik = $1`,
      [id, g.karar ?? null, g.sikayetSonucu ?? null, g.gerekce.trim(), o.kullanici, g.maliyet ?? null, Boolean(g.kokNeden), g.kapat ? 'Kapalı' : 'Karar']);
    if (g.karar === 'Garanti') {
      await garantiKarneIsle(b.db, k.dosya_ref); // Ek I §7.5
      const gm = Number((await b.db.query(`SELECT coalesce(sum(f.tutar_eur), 0) t FROM tesis_faturasi f JOIN tesis_talebi s ON s.kimlik = f.talep_ref WHERE s.dosya_ref = $1 AND f.kalem = 'Çekek'`, [k.dosya_ref])).rows[0].t);
      // YG-1418: LGM'nin ödediği çekek tutarı firma hakedişinden mahsup önerisi olarak kendiliğinden açılır; onay zinciri elle açılan mahsupla aynıdır.
      const firma = k.kurulus_ref ?? (await b.db.query(`SELECT DISTINCT kurulus_ref FROM is_emri WHERE dosya_ref = $1 AND is_emri_turu IN ('ON', 'EK')`, [k.dosya_ref])).rows.map((r) => r.kurulus_ref as string).find((_, n, l) => l.length === 1);
      if (gm > 0 && firma && await birKez(b.db, 'garanti_mahsup', id)) {
        const { parasalZincir, sonMakam } = await import('./teklif.js'); // döngüsel içe aktarmayı önler
        const m = (await b.db.query(`INSERT INTO hakedis_mahsubu (kurulus_ref, dosya_ref, tur, tutar_eur, aciklama, hazirlayan_ref) VALUES ($1,$2,'Garanti Masrafı',$3,$4,$5) RETURNING kimlik`, [firma, k.dosya_ref, gm, `${k.kayit_no} garanti kararı: LGM'nin ödediği çekek masrafı`, o.kullanici])).rows[0];
        await kartAc(b.db, { tur: 'Hakediş Mahsubu', baslik: 'Garanti Masrafı · Hakediş Mahsubu', ozet: `${tutar(gm)} EUR · ${k.kayit_no} garanti kararı`, hazirlayan: o.kullanici, zincir: await parasalZincir(b.db, ['Muhasebe ve Finans Müdürü'], await sonMakam(b.db, gm)), nesneTuru: 'Hakediş Mahsubu', nesneKimligi: m.kimlik });
      }
      if (await birKez(b.db, 'garanti_masraf', id)) await kartAc(b.db, { tur: 'Garanti Masrafı', kategori: 'islem', baslik: `${k.kayit_no} · Garanti Yan Masrafı`, ozet: `Karaya alma, çekek ve ulaşım masrafını LGM ödediyse firma hakedişinden mahsup önermenizi rica ederiz.${gm > 0 ? ` Kayıtlı çekek faturaları: ${gm.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR.` : ''}`, sahipRol: await rolId(b.db, 'Muhasebe ve Finans Müdürü'), nesneTuru: 'Dosya', nesneKimligi: k.dosya_ref }); // YG-1418
    }
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Garanti/Şikâyet Kararı', nesneTuru: 'Dosya', nesneKimligi: k.dosya_ref, yeni: { karar: g.karar, sonuc: g.sikayetSonucu }, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}

const alindiAlanlari = (no: string, dosya: string, zaman: Date, ozet: string, web: string): Record<string, string> => {
  const t = zaman.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
  return { GKnn: no, SKnn: no, süre: '72 saat', period: '72 hours', 'Kayıt No': no, 'Record No': no, 'Dosya No': dosya, 'File No': dosya, 'tarih saat': t, 'date time': t, 'tarih, saat': t, 'date, time': t, tarih: t, date: t, özet: ozet, summary: ozet, 'talep özeti': ozet, 'request summary': ozet, 'bağlantı': web, link: web };
};

/** Kapanışa modül kapıları (tahsilat, firma ödemesi, mutabakat; YG-067). */
type KapanisKapisi = (db: Baglam['db'], d: Record<string, any>, cikis: string) => Promise<string | null>;
const KAPILAR_KAPANIS: KapanisKapisi[] = [];
export function kapanisKapisi(f: KapanisKapisi) { KAPILAR_KAPANIS.push(f); }

async function isGunuEkle(c: PoolClient, d: Date, gun: number): Promise<Date> { // D-001
  return (await import('./teklif.js')).isGunuSonu(c, d, gun);
}
