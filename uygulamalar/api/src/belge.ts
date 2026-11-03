import { randomBytes, randomInt } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { gonderimIsleyici, sigortaAdresi, sigortayaHazirla } from './sigorta_gonderim.js';
import { BoyutAsimi, Depo, basiniOku, denemeTarayici, icerikHatasi, type Tarayici } from './depo.js';
import { kapanisKaydet } from './kapanis.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { ozet, rastgeleBelirtec } from './kripto.js';
import { onayMakami } from './makam.js';
import { etkinRoller, kullaniciRolleri } from './yetki.js';

type Db = Pool | PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KANAL = ['WhatsApp', 'E-posta', 'Elden', 'Firma Portalı', 'Sistem'];
const SINIF = ['Kamuya Açık', 'Kurumsal', 'Gizli', 'Kritik'];
const KOD_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PAYLASIM_KOD_DK = 10; const PAYLASIM_HATA = 5;

/** YG-606: belge bir kayda bağlanmadan resmî sayılmaz. Modüller kendi kayıt türünü burada tanıtır (Yat, Taraf, Dosya, İş Emri, Ödeme). */
type Bag = (db: Db, kullanici: string, kimlik: string) => Promise<'yok' | 'yetkisiz' | 'tamam'>;
const BAGLAR = new Map<string, Bag>();
export function belgeBagiKaydet(tur: string, f: Bag) { BAGLAR.set(tur, f); }

let webAdresiPaylasim = '';
gonderimIsleyici('Belge Paylaşımı', async (c, r, kim) => {
  const v = r.veri as { surum: string; alici: string; izin: string; gun: number };
  const belirtec = rastgeleBelirtec();
  await c.query(`INSERT INTO paylasim_baglantisi (surum_ref, belirtec_ozeti, alici_eposta, izin, son_gecerlilik, olusturan_ref) VALUES ($1,$2,lower($3),$4,now() + make_interval(days => $5),$6)`, [v.surum, ozet(belirtec), v.alici, v.izin, v.gun, kim]);
  return { sonuc: { baglanti: `${webAdresiPaylasim}/#paylasim=${belirtec}` } };
});

const kartBagi: Bag = async (db, k, id) => {
  if (!UUID.test(id)) return 'yok';
  const r = (await db.query(`SELECT hazirlayan_ref, sahip_kullanici_ref, sahip_rol_ref, zincir FROM is_karti WHERE kimlik = $1`, [id])).rows[0];
  if (!r) return 'yok';
  if (r.hazirlayan_ref === k || r.sahip_kullanici_ref === k) return 'tamam';
  const roller = (await etkinRoller(db, k)).map((x) => x.kimlik);
  return roller.includes(r.sahip_rol_ref) || (r.zincir as string[]).some((z) => roller.includes(z)) ? 'tamam' : 'yetkisiz';
};
belgeBagiKaydet('Görev', kartBagi);
belgeBagiKaydet('Onay', kartBagi);

/** YG-691: doğrulama kodu okunaklıdır, karışan harfleri içermez: 7KQ4-M2XD. */
function dogrulamaKodu() {
  const b = randomBytes(8); let s = '';
  for (let i = 0; i < 8; i++) s += (i === 4 ? '-' : '') + KOD_ABC[b[i]! % KOD_ABC.length];
  return s;
}

/** YG-593: yürürlükte tek sürüm olur; önceki sürüm silinmez, Yerine Geçti görünür. */
async function yururlugeAl(c: Db, belge: string, surum: string) {
  await c.query(`UPDATE belge_surum SET durum = 'Yerine Geçti' WHERE belge_ref = $1 AND durum = 'Yürürlükte' AND kimlik <> $2`, [belge, surum]);
  await c.query(`UPDATE belge_surum SET durum = 'Yürürlükte' WHERE kimlik = $1`, [surum]);
}

/** YG-597: ileri tarihli onaylı sürüm tarihi gelince yürürlüğe girer. */
export async function belgeYururlukIsle(db: Pool): Promise<number> {
  const { rows } = await db.query(`SELECT kimlik, belge_ref FROM belge_surum WHERE durum = 'Onaylı' AND yururluk_tarihi <= (now() AT TIME ZONE 'Europe/Istanbul')::date ORDER BY surum_no`);
  for (const r of rows) await yururlugeAl(db, r.belge_ref, r.kimlik);
  return rows.length;
}

/** YG-594, YG-595, YG-596: inceleme kararı ve gerekçesi kart adımlarında kalır; hazırlayan kendi belgesini onaylayamaz. */
kapanisKaydet('Belge Onayı', async (c, k, karar, yapan) => {
  const id = k.nesne_kimligi!;
  if (karar === 'Onayla') {
    const s = (await c.query(`UPDATE belge_surum SET durum = 'Onaylı', onaylayan_ref = $2, onay_zamani = now(), dogrulama_kodu = $3 WHERE kimlik = $1 RETURNING belge_ref, yururluk_tarihi, (yururluk_tarihi IS NULL OR yururluk_tarihi <= (now() AT TIME ZONE 'Europe/Istanbul')::date) AS bugun`, [id, yapan, dogrulamaKodu()])).rows[0];
    if (s.bugun) await yururlugeAl(c, s.belge_ref, id);
  } else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') await c.query(`UPDATE belge_surum SET durum = 'Taslak' WHERE kimlik = $1`, [id]);
  else if (karar === 'Yeniden Gönder') await c.query(`UPDATE belge_surum SET durum = 'İncelemede' WHERE kimlik = $1`, [id]);
});

const dosyaAdi = (ad: string) => `filename*=UTF-8''${encodeURIComponent(ad)}`;

export function belgeYollari(s: FastifyInstance, b: Baglam) {
  webAdresiPaylasim = b.webAdresi;
  if (b.guvenliCerez && !b.tarayici) throw new Error('Üretimde gerçek virüs tarayıcısı bağlanmadan belge yükleme açılamaz (YG-602).');
  const depo = b.depo ?? new Depo();
  const tarayici: Tarayici = b.tarayici ?? denemeTarayici;
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  // Dosya bellekte toplanmaz; sınır depo.al içinde akış sırasında uygulanır.
  s.addContentTypeParser('application/octet-stream', (_i, govde, bitti) => bitti(null, govde));

  /** YG-609: Kritik belgeyi yalnız yükleyen görür; diğerlerinde bağlı kayda erişim gerekir. Dış kullanıcı yalnız yürürlükteki sürümü görür (YG-598). */
  const erisim = async (kullanici: string, grup: string, id: string) => {
    if (!UUID.test(id)) return null;
    const e = (await b.db.query(`SELECT * FROM belge WHERE kimlik = $1`, [id])).rows[0];
    if (!e) return null;
    if (e.olusturan_ref === kullanici) return { e, tum: true };
    if (e.bilgi_sinifi === 'Kritik') return null;
    const bag = BAGLAR.get(e.bag_turu);
    if (!bag || (await bag(b.db, kullanici, e.bag_kimligi)) !== 'tamam') return null;
    return { e, tum: grup === 'LGM İç Rolü' };
  };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Belge bulunamadı veya erişim yetkiniz yok.' });

  // YG-602, YG-1269, YG-1270: tür, boyut, içerik ve virüs denetimi; özgün dosya özetiyle saklanır. YG-592: aynı adla yükleme yeni sürüm açar.
  s.post('/belge/yukle', { ...oturumlu, bodyLimit: Number.MAX_SAFE_INTEGER }, async (i, y) => {
    const o = i.oturum!; const akis = i.body as Readable;
    const q = i.query as Record<string, string | undefined>;
    const red = (kod: number, hata: string) => { akis?.resume?.(); return y.code(kod).send({ hata }); };
    // YG-1440: yat sahibi belge yüklemez; belgeleri Dosya Sorumlusu girer, onarım kanıtını firma portalı yükler.
    // YG-1562: tek istisna, hasar bildirimine en fazla 5 fotoğraf.
    const bildirimFoto = q.bagTuru === 'Talep' && o.grup !== 'LGM İç Rolü';
    if (bildirimFoto) {
      if (!['jpg', 'jpeg', 'png', 'heic'].includes((q.dosya ?? '').split('.').pop()?.toLowerCase() ?? '')) return red(400, 'Yalnız fotoğraf eklenebilir.');
      if ((await b.db.query(`SELECT count(*)::int n FROM belge WHERE bag_turu = 'Talep' AND bag_kimligi = $1`, [q.bagKimligi])).rows[0].n >= 5) return red(409, 'En fazla 5 fotoğraf ekleyebilirsiniz.');
    } else if (o.grup !== 'LGM İç Rolü' && o.grup !== 'İş Birliği Firması' && o.grup !== 'Tedarikçi' && !o.grup.startsWith('Tesis Yetkilisi')) return red(403, 'Belgeleriniz Dosya Sorumlunuz tarafından sisteme eklenir.');
    if (!akis || typeof akis.resume !== 'function') return y.code(400).send({ hata: 'Dosya gönderilmedi.' });
    const { ad, tur, bagTuru, bagKimligi, kaynak, kaynakKisi, sinif, belgeTarihi, gerekce, dosya } = q;
    if (!ad?.trim() || !tur?.trim() || !dosya?.trim()) return red(400, 'Belge adı, türü ve dosya zorunludur.');
    if (!bagTuru || !bagKimligi) return red(400, 'Belgenin bağlanacağı kayıt seçilmelidir.');
    if (!kaynak || !KANAL.includes(kaynak)) return red(400, 'Kaynak kanalı seçilmelidir.');
    if (sinif && !SINIF.includes(sinif)) return red(400, 'Geçersiz bilgi sınıfı.');
    const bag = BAGLAR.get(bagTuru);
    const durum = bag ? await bag(b.db, o.kullanici, bagKimligi) : 'yok';
    if (durum === 'yok') return red(400, 'Bağlanacak kayıt bulunamadı.');
    if (durum === 'yetkisiz') return red(403, 'Bu kayda belge ekleme yetkiniz yok.');
    const uzanti = dosya.includes('.') ? dosya.split('.').pop()!.toLowerCase() : '';
    const sinir = (await b.db.query(`SELECT azami_bayt FROM dosya_siniri WHERE $1 = ANY(uzantilar)`, [uzanti])).rows[0];
    if (!sinir) return red(400, 'Bu dosya türü yüklenemez.');
    let al;
    try { al = await depo.al(akis, Number(sinir.azami_bayt)); } catch (e) {
      if (e instanceof BoyutAsimi) return red(413, 'Dosya, bu tür için izin verilen boyutu aşmaktadır.');
      throw e;
    }
    const ic = icerikHatasi(uzanti, basiniOku(al.yol));
    if (ic) { depo.vazgec(al.yol); return y.code(400).send({ hata: ic }); }
    if (!(await tarayici.temizMi(al.yol))) {
      depo.vazgec(al.yol);
      await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Zararlı Dosya Engellendi', nesneKimligi: dosya, sonuc: 'Başarısız', adres: i.ip, iliski: i.id });
      return y.code(422).send({ hata: 'Dosyada zararlı içerik bulundu; yüklenmedi.' });
    }
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      // Aynı kayda aynı adla eşzamanlı yükleme sıraya girer; sürüm numarası çakışmaz.
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`belge:${bagTuru}:${bagKimligi}:${ad.trim().toLocaleLowerCase('tr-TR')}`]);
      let e = (await c.query(`SELECT kimlik FROM belge WHERE bag_turu = $1 AND bag_kimligi = $2 AND lower(ad) = lower($3)`, [bagTuru, bagKimligi, ad.trim()])).rows[0];
      let no = 1;
      if (e) {
        const onceki = (await c.query(`SELECT surum_no, ozet_sha256 FROM belge_surum WHERE belge_ref = $1 ORDER BY surum_no DESC`, [e.kimlik])).rows;
        const ayni = onceki.find((x) => x.ozet_sha256 === al.ozet);
        if (ayni) { await c.query('ROLLBACK'); depo.vazgec(al.yol); return y.code(409).send({ hata: `Bu dosya zaten ${ayni.surum_no}. sürüm olarak kayıtlıdır.` }); }
        if (!gerekce?.trim()) { await c.query('ROLLBACK'); depo.vazgec(al.yol); return y.code(400).send({ hata: 'Yeni sürüm için değişiklik gerekçesi zorunludur.' }); }
        no = onceki[0].surum_no + 1;
      } else {
        e = (await c.query(`INSERT INTO belge (ad, belge_turu, bilgi_sinifi, bag_turu, bag_kimligi, kaynak_kanali, kaynak_kisi, belge_tarihi, olusturan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING kimlik`,
          [ad.trim(), tur.trim(), sinif ?? 'Gizli', bagTuru, bagKimligi, kaynak, kaynakKisi?.trim() || null, belgeTarihi || null, o.kullanici])).rows[0];
      }
      const anahtar = depo.yerlestir(al.yol, al.ozet);
      const r = (await c.query(`INSERT INTO belge_surum (belge_ref, surum_no, dosya_adi, uzanti, boyut, ozet_sha256, depo_anahtari, tarama_kaynagi, degisiklik_gerekcesi, yukleyen_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING kimlik`,
        [e.kimlik, no, dosya.trim(), uzanti, al.boyut, al.ozet, anahtar, tarayici.ad, gerekce?.trim() || null, o.kullanici])).rows[0];
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge Yüklendi', nesneTuru: 'belge', nesneKimligi: e.kimlik, yeni: { surum: no, ozet: al.ozet, boyut: al.boyut }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { belge: e.kimlik, surum: no, surumKimligi: r.kimlik };
    } catch (x) { await c.query('ROLLBACK').catch(() => {}); depo.vazgec(al.yol); throw x; } finally { c.release(); }
  });

  // YG-591, YG-593, YG-598: varsayılan görünüm güncel sürüm; geçmiş ve gerekçeler yalnız LGM personeline.
  s.get('/belge', oturumlu, async (i, y) => {
    const o = i.oturum!; const { bagTuru, bagKimligi } = i.query as { bagTuru?: string; bagKimligi?: string };
    const bag = bagTuru ? BAGLAR.get(bagTuru) : null;
    if (!bag || !bagKimligi || (await bag(b.db, o.kullanici, bagKimligi)) !== 'tamam') return yok(y);
    const lgm = o.grup === 'LGM İç Rolü';
    const { rows } = await b.db.query(
      `SELECT e.kimlik, e.ad, e.belge_turu, e.bilgi_sinifi, e.kaynak_kanali, e.belge_tarihi, e.olusturan_ref = $3 AS benim,
              coalesce(json_agg(json_build_object('no', s.surum_no, 'dosya', s.dosya_adi, 'boyut', s.boyut, 'durum', s.durum, 'yukleme', s.yukleme_zamani, 'yururluk', s.yururluk_tarihi, 'gerekce', CASE WHEN $4 THEN s.degisiklik_gerekcesi END) ORDER BY s.surum_no DESC), '[]') AS surumler
         FROM belge e JOIN belge_surum s ON s.belge_ref = e.kimlik
        WHERE e.bag_turu = $1 AND e.bag_kimligi = $2 AND (e.bilgi_sinifi <> 'Kritik' OR e.olusturan_ref = $3) AND ($4 OR e.olusturan_ref = $3 OR s.durum = 'Yürürlükte')
        GROUP BY e.kimlik ORDER BY e.olusturma_zamani DESC`, [bagTuru, bagKimligi, o.kullanici, lgm]);
    return rows;
  });

  s.get('/belge/:id/surum/:no/indir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id, no } = i.params as { id: string; no: string };
    const a = await erisim(o.kullanici, o.grup, id);
    if (!a) return yok(y);
    const r = (await b.db.query(`SELECT dosya_adi, depo_anahtari, boyut, durum FROM belge_surum WHERE belge_ref = $1 AND surum_no = $2`, [id, Number(no) || 0])).rows[0];
    if (!r || (!a.tum && r.durum !== 'Yürürlükte')) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge İndirildi', nesneTuru: 'belge', nesneKimligi: id, yeni: { surum: Number(no) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return y.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; ${dosyaAdi(r.dosya_adi)}`).header('x-content-type-options', 'nosniff').send(depo.bagla(r.depo_anahtari));
  });

  // YG-594, YG-597: Taslak → İncelemede; onay kart motorundan geçer.
  s.post('/belge/:id/surum/:no/onaya-gonder', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id, no } = i.params as { id: string; no: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const { yururluk } = (i.body ?? {}) as { yururluk?: string };
    if (yururluk && !/^\d{4}-\d{2}-\d{2}$/.test(yururluk)) return y.code(400).send({ hata: 'Geçersiz yürürlük tarihi.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const r = (await c.query(`SELECT s.kimlik, s.durum, s.yukleyen_ref, e.ad FROM belge_surum s JOIN belge e ON e.kimlik = s.belge_ref WHERE s.belge_ref = $1 AND s.surum_no = $2 FOR UPDATE OF s`, [id, Number(no) || 0])).rows[0];
      if (!r || r.yukleyen_ref !== o.kullanici) { await c.query('ROLLBACK'); return yok(y); }
      if (r.durum !== 'Taslak') { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Bu sürüm onaya uygun durumda değildir.' }); }
      const rol = (await kullaniciRolleri(b.db, o.kullanici))[0];
      if (!rol) { await c.query('ROLLBACK'); return y.code(403).send({ hata: 'Aktif rolünüz bulunmamaktadır.' }); }
      const kart = await kartAc(c, { tur: 'Belge Onayı', baslik: `Belge Onayı · ${r.ad}`, ozet: `${no}. sürüm${yururluk ? ` · Yürürlük: ${yururluk.split('-').reverse().join('.')}` : ''}`, hazirlayan: o.kullanici, zincir: [await onayMakami(c, rol.kimlik)], nesneTuru: 'belge_surum', nesneKimligi: r.kimlik });
      await c.query(`UPDATE belge_surum SET durum = 'İncelemede', yururluk_tarihi = $2, is_karti_ref = $3 WHERE kimlik = $1`, [r.kimlik, yururluk ?? null, kart]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge Onaya Gönderildi', nesneTuru: 'belge', nesneKimligi: id, yeni: { surum: Number(no) }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kart };
    } catch (x) { await c.query('ROLLBACK').catch(() => {}); throw x; } finally { c.release(); }
  });

  // YG-691: M7 doğrulaması. Giriş istemez; yalnız kimlik bilgisi döner, içerik dönmez.
  s.get('/dogrula/:kod', async (i, y) => {
    const kod = (i.params as { kod: string }).kod.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(kod)) return y.code(404).send({ hata: 'Bu kodla kayıtlı belge bulunamadı.' });
    const r = (await b.db.query(`SELECT e.ad, s.surum_no, s.durum, s.onay_zamani, s.ozet_sha256 FROM belge_surum s JOIN belge e ON e.kimlik = s.belge_ref WHERE s.dogrulama_kodu = $1`, [kod])).rows[0];
    if (!r) return y.code(404).send({ hata: 'Bu kodla kayıtlı belge bulunamadı.' });
    return { ad: r.ad, surum: r.surum_no, durum: r.durum, onayZamani: r.onay_zamani, ozet: r.ozet_sha256 };
  });

  // YG-611: alıcısı, süresi (varsayılan 7, en çok 30 gün) ve izni belli bağlantı. Güvenliğiniz için Kritik belgeler bağlantıyla paylaşılmıyor.
  s.post('/belge/:id/surum/:no/paylas', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id, no } = i.params as { id: string; no: string };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    const a = await erisim(o.kullanici, o.grup, id);
    if (!a) return yok(y);
    if (a.e.bilgi_sinifi === 'Kritik') return y.code(403).send({ hata: 'Güvenliğiniz için Kritik belgeler bağlantıyla paylaşılmıyor.' });
    const { alici, gun = 7, izin = 'Görüntüle' } = (i.body ?? {}) as { alici?: string; gun?: number; izin?: string };
    if (!alici || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alici)) return y.code(400).send({ hata: 'Alıcı e-posta adresi zorunludur.' });
    if (!Number.isInteger(gun) || gun < 1 || gun > 30) return y.code(400).send({ hata: 'Bağlantı süresi 1 ile 30 gün arasında olmalıdır.' });
    if (izin !== 'Görüntüle' && izin !== 'İndir') return y.code(400).send({ hata: 'Geçersiz izin.' });
    const s2 = (await b.db.query(`SELECT kimlik FROM belge_surum WHERE belge_ref = $1 AND surum_no = $2`, [id, Number(no) || 0])).rows[0];
    if (!s2) return yok(y);
    // K-241: sigorta adresine bağlantı ancak son gönderenin ikili teyidinden sonra üretilir.
    const sg = await sigortaAdresi(b.db, alici);
    if (sg) return { gonderim: await sigortayaHazirla(b.db, { dosya: sg.dosya, tur: 'Belge Paylaşımı', nesne: `${s2.kimlik}:${alici.toLowerCase()}`, alici: null, konu: `${a.e.ad} · ${alici}`, sorumlu: o.kullanici, veri: { surum: s2.kimlik, belge: id, alici, izin, gun } }), durum: 'Teyit Bekliyor' };
    const belirtec = rastgeleBelirtec();
    const r = (await b.db.query(`INSERT INTO paylasim_baglantisi (surum_ref, belirtec_ozeti, alici_eposta, izin, son_gecerlilik, olusturan_ref) VALUES ($1,$2,lower($3),$4,now() + make_interval(days => $5),$6) RETURNING kimlik, son_gecerlilik`, [s2.kimlik, ozet(belirtec), alici, izin, gun, o.kullanici])).rows[0];
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Belge Paylaşıldı', nesneTuru: 'belge', nesneKimligi: id, yeni: { alici, gun, izin }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik, baglanti: `${b.webAdresi}/#paylasim=${belirtec}`, sonGecerlilik: r.son_gecerlilik };
  });
  s.post('/paylasim/:id/iptal', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const r = await b.db.query(`UPDATE paylasim_baglantisi SET iptal_zamani = now() WHERE kimlik = $1 AND olusturan_ref = $2 AND iptal_zamani IS NULL`, [id, o.kullanici]);
    if (!r.rowCount) return yok(y);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Paylaşım İptal Edildi', nesneTuru: 'paylasim', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  const GECERSIZ = 'Bu bağlantı geçersiz veya süresi dolmuştur.';
  const baglantiBul = async (belirtec: unknown) => (await b.db.query(
    `SELECT p.*, e.ad, e.kimlik AS belge, s.dosya_adi, s.depo_anahtari FROM paylasim_baglantisi p JOIN belge_surum s ON s.kimlik = p.surum_ref JOIN belge e ON e.kimlik = s.belge_ref
      WHERE p.belirtec_ozeti = $1 AND p.iptal_zamani IS NULL AND p.son_gecerlilik > now()`, [ozet(String(belirtec ?? ''))])).rows[0];
  // Bağlantı anonim açılmaz: kayıtlı alıcıya tek kullanımlık kod gider.
  s.post('/paylasim/kod', async (i, y) => {
    const { belirtec } = (i.body ?? {}) as { belirtec?: string };
    const p = await baglantiBul(belirtec);
    if (!p) return y.code(410).send({ hata: GECERSIZ });
    const kod = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const t = await b.db.query(`UPDATE paylasim_baglantisi SET kod_ozeti = $2, kod_bitis = now() + make_interval(mins => $3::int), hatali_deneme = 0 WHERE kimlik = $1 AND (kod_bitis IS NULL OR kod_bitis < now() + make_interval(mins => $3::int - 1))`, [p.kimlik, ozet(kod), PAYLASIM_KOD_DK]);
    if (t.rowCount) await b.eposta.gonder(p.alici_eposta, `Belge erişim kodunuz ${kod}. Kodu kimseyle paylaşmayınız; LİMİT GLOBAL MARINE kodunuzu hiçbir zaman sormaz.`);
    const [ad, alan] = p.alici_eposta.split('@');
    return { belge: p.ad, alici: `${ad.slice(0, 2)}***@${alan}`, izin: p.izin };
  });
  s.post('/paylasim/ac', async (i, y) => {
    const { belirtec, kod } = (i.body ?? {}) as { belirtec?: string; kod?: string };
    const p = await baglantiBul(belirtec);
    if (!p) return y.code(410).send({ hata: GECERSIZ });
    if (!p.kod_ozeti || new Date(p.kod_bitis) < new Date() || p.kod_ozeti !== ozet(String(kod ?? ''))) {
      const h = p.hatali_deneme + 1;
      await b.db.query(`UPDATE paylasim_baglantisi SET hatali_deneme = $2::int, iptal_zamani = CASE WHEN $2::int >= $3::int THEN now() END WHERE kimlik = $1`, [p.kimlik, h, PAYLASIM_HATA]);
      return y.code(401).send({ hata: 'Kod hatalı veya süresi dolmuş.' });
    }
    await izYaz(b.db, { eylem: 'Paylaşılan Belge Açıldı', nesneTuru: 'belge', nesneKimligi: p.belge, yeni: { alici: p.alici_eposta }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    const tip = p.izin === 'İndir' ? 'attachment' : 'inline';
    return y.header('content-type', 'application/octet-stream').header('content-disposition', `${tip}; ${dosyaAdi(p.dosya_adi)}`).header('x-content-type-options', 'nosniff').header('x-yatonet-izin', encodeURIComponent(p.izin)).send(depo.bagla(p.depo_anahtari));
  });
}
