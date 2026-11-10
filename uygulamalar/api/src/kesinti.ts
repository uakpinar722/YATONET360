import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

const YONETIR = ['Sistem Yöneticisi', 'Bilgi İşlem Müdürü', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
const TESTLER = ['temsiliIsAkisi', 'veriGuncelligi', 'yetki', 'belge', 'bildirim', 'entegrasyon'] as const;
const KANAL = ['Önceden Tanımlı Form', 'Kurumsal E-posta', 'Telefon Kaydı', 'Kâğıt Form'];
const TUR = 'Platform Dışı İşlem İstisnası';

kapanisKaydet(TUR, async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE kesinti SET durum = 'Açık' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE kesinti SET durum = 'Reddedildi' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
});

/**
 * YG-1368: platform dışı işlem yalnız kesinti veya onaylı istisna düzeninde; sistem önceden benzersiz geçici referanslar üretir, her referans
 * tanımlı kanal, yetkili kişi, asgari veri, saklama yeri ve geri giriş sorumlusuyla sisteme geri girilir ve ana dosyaya bağlanır.
 * YG-1284: kesinti, normalleşme testi (temsilî iş akışı, veri güncelliği, yetki, belge, bildirim, entegrasyon) ve geçici kayıt uzlaştırması tamamlanmadan kapanmaz.
 */
export function kesintiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  s.get('/kesinti', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const yonetir = await rolVar(o.kullanici, YONETIR);
    return { yonetir, kanallar: KANAL, kesintiler: (await b.db.query(`SELECT k.kimlik, k.tur, k.neden, k.baslangic, k.bitis, k.durum, k.normallesme, (SELECT count(*)::int FROM gecici_referans g WHERE g.kesinti_ref = k.kimlik) referans, (SELECT count(*)::int FROM gecici_referans g WHERE g.kesinti_ref = k.kimlik AND g.kullanildi AND g.dosya_ref IS NULL) bagsiz FROM kesinti k ORDER BY k.baslangic DESC LIMIT 20`)).rows,
      referanslarim: (await b.db.query(`SELECT g.kimlik, g.referans, g.kullanildi, g.dosya_ref IS NOT NULL bagli, k.durum FROM gecici_referans g JOIN kesinti k ON k.kimlik = g.kesinti_ref WHERE g.sorumlu_ref = $1 AND (g.dosya_ref IS NULL) ORDER BY g.referans`, [o.kullanici])).rows };
  });
  // Kesinti hemen açılır; olağan dışı istisna BT ve Firma Yönetimi Direktörü onayıyla açılır.
  s.post('/kesinti', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, YONETIR))) return yok(y);
    const g = (i.body ?? {}) as { tur?: string; neden?: string; kapsam?: string };
    if ((g.tur !== 'Kesinti' && g.tur !== 'Onaylı İstisna') || !g.neden?.trim() || !g.kapsam?.trim()) return y.code(400).send({ hata: 'Tür, neden ve kapsam zorunludur.' });
    const k = (await b.db.query(`INSERT INTO kesinti (tur, neden, kapsam, durum, acan_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [g.tur, g.neden.trim(), g.kapsam.trim(), g.tur === 'Kesinti' ? 'Açık' : 'Onayda', o.kullanici])).rows[0].kimlik as string;
    if (g.tur === 'Onaylı İstisna') await kartAc(b.db, { tur: TUR, baslik: `${TUR}: ${g.neden.trim().slice(0, 80)}`, ozet: g.kapsam.trim().slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü')], nesneTuru: 'Kesinti', nesneKimligi: k });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: `${g.tur} Açıldı`, nesneTuru: 'Kesinti', nesneKimligi: k, gerekce: g.neden.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: k };
  });
  // Benzersiz geçici referanslar kesinti boyunca kullanılmak üzere kişiye üretilir (GR-YYYY-NNNNN); yeniden verilmez.
  s.post('/kesinti/:id/referans', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sorumlu?: string; adet?: number };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, YONETIR))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM kesinti WHERE kimlik = $1 AND durum = 'Açık'`, [id])).rowCount) return y.code(409).send({ hata: 'Açık kesinti veya istisna yoktur.' });
    const adet = Number(g.adet); if (!g.sorumlu || !(adet >= 1 && adet <= 50) || !(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü'`, [g.sorumlu])).rowCount) return y.code(400).send({ hata: 'Sorumlu personel ve 1–50 adet giriniz.' });
    const l: string[] = []; const yil = new Date().getFullYear();
    for (let n = 0; n < adet; n++) { const r = `GR-${yil}-${String(await sayac(b.db, `gecici_referans:${yil}`)).padStart(5, '0')}`; await b.db.query(`INSERT INTO gecici_referans (referans, kesinti_ref, sorumlu_ref) VALUES ($1,$2,$3)`, [r, id, g.sorumlu]); l.push(r); }
    return { referanslar: l };
  });
  // Sisteme geri giriş: kanal, yetkili kişi, asgari veri, saklama yeri ve ana dosya bağı zorunlu.
  s.post('/gecici-referans/:id/geri-giris', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kanal?: string; yetkili?: string; ozet?: string; saklama?: string; dosya?: string; zaman?: string };
    if (!UUID.test(id)) return yok(y);
    const r = (await b.db.query(`SELECT sorumlu_ref, dosya_ref FROM gecici_referans WHERE kimlik = $1`, [id])).rows[0]; if (!r || r.sorumlu_ref !== o.kullanici) return yok(y);
    if (r.dosya_ref) return y.code(409).send({ hata: 'Referans sisteme geri girilmiştir.' });
    if (!KANAL.includes(g.kanal ?? '') || !g.yetkili?.trim() || !g.ozet?.trim() || !g.saklama?.trim() || !g.zaman) return y.code(400).send({ hata: 'Kanal, yetkili kişi, asgari veri özeti, saklama yeri ve işlem zamanı zorunludur.' });
    if (!g.dosya || !UUID.test(g.dosya) || !(await b.db.query(`SELECT 1 FROM dosya WHERE kimlik = $1`, [g.dosya])).rowCount) return y.code(400).send({ hata: 'Ana dosyayı seçiniz.' });
    await b.db.query(`UPDATE gecici_referans SET kullanildi = true, kanal = $2, yetkili_kisi = $3, asgari_veri = $4, saklama_yeri = $5, dosya_ref = $6, islem_zamani = $7, geri_giris_zamani = now() WHERE kimlik = $1`, [id, g.kanal, g.yetkili.trim(), g.ozet.trim(), g.saklama.trim(), g.dosya, g.zaman]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Platform Dışı İşlem Geri Girişi', nesneTuru: 'Dosya', nesneKimligi: g.dosya, yeni: { referans: id, kanal: g.kanal }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/kesinti/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { normallesme?: Record<string, string>; kullanilmayan?: string[] };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, YONETIR))) return yok(y);
    const k = (await b.db.query(`SELECT durum FROM kesinti WHERE kimlik = $1`, [id])).rows[0]; if (!k) return yok(y);
    if (k.durum !== 'Açık') return y.code(409).send({ hata: 'Kesinti açık değildir.' });
    const n = g.normallesme ?? {}; if (TESTLER.some((t) => n[t] !== 'Başarılı')) return y.code(409).send({ hata: 'Normalleşme testi (temsilî iş akışı, veri güncelliği, yetki, belge, bildirim, entegrasyon) başarıyla tamamlanmadan kesinti kapanmaz; sisteme erişim tek başına yeterli değildir.' });
    const kul = new Set(g.kullanilmayan ?? []);
    const acik = (await b.db.query(`SELECT kimlik, referans FROM gecici_referans WHERE kesinti_ref = $1 AND dosya_ref IS NULL`, [id])).rows.filter((x) => !kul.has(x.kimlik));
    if (acik.length) return y.code(409).send({ hata: `Uzlaştırılmamış geçici referans var: ${acik.map((x) => x.referans).join(', ')}. Kullanılmayanları işaretleyiniz.` });
    if (kul.size) await b.db.query(`UPDATE gecici_referans SET iptal = true WHERE kesinti_ref = $1 AND kimlik = ANY($2::uuid[]) AND dosya_ref IS NULL`, [id, [...kul]]);
    await b.db.query(`UPDATE kesinti SET durum = 'Kapandı', bitis = now(), normallesme = $2, kapatan_ref = $3 WHERE kimlik = $1`, [id, JSON.stringify(n), o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kesinti Kapandı', nesneTuru: 'Kesinti', nesneKimligi: id, yeni: n, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
