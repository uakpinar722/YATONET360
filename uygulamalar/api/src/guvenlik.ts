import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { izinGerekli } from './yetki.js';
import { rolId } from './ihbar.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

const BT = ['Sistem Yöneticisi', 'Bilgi İşlem Müdürü', 'Bilgi İşlem Müdür Yardımcısı', 'Hukuk ve Uyum Direktörü'];
const ANLIK_YANIT_DK = 30; const GECICI_COZUM_DK = 240;

/** YG-1184: hassas veriyi ve dosya içeriğini (dosya, portal dosyası, teklif ayrıntısı) okuyan GET istekleri izlenir. */
const HASSAS_GET = /^\/api\/(dosya\/[0-9a-f-]{36}$|portal\/dosya\/[0-9a-f-]{36}$|teklif\/[0-9a-f-]{36}$|ik\/personel|puantaj\/ozet|disiplin$|veri-ihlali|kvkk-basvuru|riza-kayitlari|hukuki-koruma|imha-listesi|saklama-plani|yedekler|denetim\/|mahsup-itirazlar|is-kazasi)/;

/** YG-1283: BT kesintisinde 30 dakika yanıt, 4 saat geçici çözüm; aşılınca Bilgi İşlem Müdürüne ve Direktöre uyarı. */
export async function olayIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0;
  for (const o of (await db.query(`SELECT kimlik, ozet, olusturma_zamani, yanit_zamani, gecici_cozum_zamani FROM olay_kaydi WHERE olay_turu = 'BT Kesintisi veya Veri İhlali' AND durum = 'Açık'`)).rows) {
    const dk = (simdi.getTime() - new Date(o.olusturma_zamani).getTime()) / 60_000;
    const a = !o.yanit_zamani && dk > ANLIK_YANIT_DK ? 'yanit' : !o.gecici_cozum_zamani && dk > GECICI_COZUM_DK ? 'cozum' : null;
    if (a && await birKez(db, 'bt_olay_sure', `${o.kimlik}:${a}`)) { await bildir(db, { olay: `bt-olay:${o.kimlik}:${a}`, kullanicilar: [...await rolSahipleri(db, await rolId(db, 'Bilgi İşlem Müdürü')), ...await rolSahipleri(db, await rolId(db, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'))], baslik: a === 'yanit' ? '⚠ BT Olayı · 30 Dakika Yanıt Süresi Aşıldı' : '⚠ BT Olayı · 4 Saat Geçici Çözüm Süresi Aşıldı', ozet: o.ozet, oncelik: 'Kritik', sms: true, acil: true }); n++; }
  }
  await db.query(`DELETE FROM islem_anahtari WHERE zaman < now() - interval '2 days'`);
  return n;
}

export function guvenlikYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const anahtar = (i: { headers: Record<string, unknown>; url: string }) => { const h = i.headers['x-islem-anahtari']; return typeof h === 'string' && h ? createHash('sha256').update(`${i.headers.cookie ?? ''}|${i.url}|${h}`).digest('hex') : null; };

  // YG-1310: aynı işlem anahtarıyla gelen tekrar işlenmez, ilk yanıt döner.
  s.addHook('preValidation', async (i, y) => {
    if (i.method !== 'POST') return;
    const k = anahtar(i); if (!k) return;
    const v = (await b.db.query(`SELECT kod, yanit FROM islem_anahtari WHERE anahtar = $1`, [k])).rows[0];
    if (v) return y.code(v.kod).header('content-type', 'application/json; charset=utf-8').send(v.yanit);
  });
  s.addHook('onSend', async (i, y, g) => {
    if (i.method === 'POST' && y.statusCode < 300 && typeof g === 'string') { const k = anahtar(i); if (k) await b.db.query(`INSERT INTO islem_anahtari (anahtar, kod, yanit) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [k, y.statusCode, g]); }
    return g;
  });
  // YG-1184
  s.addHook('onResponse', async (i, y) => {
    const o = i.oturum; if (i.method !== 'GET' || !o || y.statusCode !== 200) return;
    const yol = i.url.split('?')[0]!; if (!HASSAS_GET.test(yol) || yol.startsWith('/api/denetim/')) return;
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Veri Görüntüleme', nesneTuru: 'Uç Nokta', nesneKimligi: yol, sonuc: 'Başarılı', adres: i.ip, iliski: i.id }).catch(() => {});
  });

  // YG-1187: denetim erişimi olay, dönem ve amaçla; arama ve dışa aktarım ayrıca kaydedilir.
  s.get('/denetim/arama', { preHandler: izinGerekli(b, 'denetim_izi.goruntule') }, async (i, y) => {
    const o = i.oturum!; const q = i.query as { amac?: string; baslangic?: string; bitis?: string; eylem?: string; tablo?: string; nesne?: string; bicim?: string };
    if (!q.amac?.trim() || !q.baslangic || !q.bitis) return y.code(400).send({ hata: 'Amaç ve dönem zorunludur.' });
    const izler = (await b.db.query(`SELECT d.kimlik, d.olay_zamani, d.eylem, d.nesne_turu, d.nesne_kimligi, d.sonuc, d.gerekce, k.ad_soyad AS aktor FROM denetim_izi d LEFT JOIN kullanici_hesabi k ON k.kimlik = d.aktor_ref WHERE d.olay_zamani BETWEEN $1 AND $2 AND ($3::text IS NULL OR tr_norm(d.eylem) LIKE '%' || tr_norm($3) || '%') ORDER BY d.kimlik DESC LIMIT 1000`, [q.baslangic, q.bitis, q.eylem || null])).rows;
    const degisiklikler = (await b.db.query(`SELECT d.kimlik, d.zaman, d.tablo, d.nesne, d.islem, d.degisen, k.ad_soyad AS aktor FROM kayit_degisikligi d LEFT JOIN kullanici_hesabi k ON k.kimlik = d.aktor WHERE d.zaman BETWEEN $1 AND $2 AND ($3::text IS NULL OR d.tablo = $3) AND ($4::text IS NULL OR d.nesne = $4) ORDER BY d.kimlik DESC LIMIT 1000`, [q.baslangic, q.bitis, q.tablo || null, q.nesne || null])).rows;
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: q.bicim === 'dosya' ? 'İşlem İzi Dışa Aktarımı' : 'İşlem İzi Araması', yeni: { baslangic: q.baslangic, bitis: q.bitis, eylem: q.eylem, tablo: q.tablo, adet: izler.length + degisiklikler.length }, gerekce: q.amac.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { izler, degisiklikler };
  });

  // YG-1281, YG-1283: olay kaydı sürümlü güncellenir.
  const olay = async (id: string) => UUID.test(id) ? (await b.db.query(`SELECT * FROM olay_kaydi WHERE kimlik = $1`, [id])).rows[0] : undefined;
  const ONEM = ['Düşük', 'Orta', 'Yüksek', 'Kritik'];
  // YG-1285: müdahale, karar ve iletişim adımları zaman çizelgesine yazılır.
  s.post('/olay/:id/adim', oturumlu, async (i, y) => {
    const o = i.oturum!; const v = await olay((i.params as { id: string }).id); const g = (i.body ?? {}) as { tur?: string; metin?: string };
    if (!v) return yok(y);
    if (!(await rolVar(o.kullanici, BT))) return y.code(403).send({ hata: 'Olay adımını Bilgi İşlem veya Hukuk ve Uyum kaydeder.' });
    if (v.durum !== 'Açık') return y.code(409).send({ hata: 'Olay kapalıdır.' });
    if (!['Müdahale', 'Karar', 'İletişim'].includes(g.tur ?? '') || !g.metin?.trim()) return y.code(400).send({ hata: 'Adım türünü (Müdahale, Karar, İletişim) ve açıklamasını yazmanızı rica ederiz.' });
    await b.db.query(`INSERT INTO olay_adimi (olay_ref, tur, metin, yapan_ref) VALUES ($1,$2,$3,$4)`, [v.kimlik, g.tur, g.metin.trim(), o.kullanici]);
    return { tamam: true };
  });
  s.get('/olay/:id/zaman-cizelgesi', oturumlu, async (i, y) => {
    const v = await olay((i.params as { id: string }).id);
    if (!v || !(await rolVar(i.oturum!.kullanici, IZLEYEN))) return yok(y);
    const l: { zaman: Date; tur: string; metin: string }[] = [{ zaman: v.olusturma_zamani, tur: 'Başlangıç', metin: v.ozet }];
    if (v.yanit_zamani) l.push({ zaman: v.yanit_zamani, tur: 'Yanıt', metin: 'İlk yanıt verildi.' });
    if (v.gecici_cozum_zamani) l.push({ zaman: v.gecici_cozum_zamani, tur: 'Geçici Çözüm', metin: 'Geçici çözüm uygulandı.' });
    for (const r of (await b.db.query(`SELECT a.zaman, a.tur, a.metin || ' (' || k.ad_soyad || ')' metin FROM olay_adimi a JOIN kullanici_hesabi k ON k.kimlik = a.yapan_ref WHERE a.olay_ref = $1`, [v.kimlik])).rows) l.push(r);
    for (const r of (await b.db.query(`SELECT zaman, surum FROM olay_surumu WHERE olay_ref = $1`, [v.kimlik])).rows) l.push({ zaman: r.zaman, tur: 'Etki Güncellemesi', metin: `Sürüm ${r.surum}` });
    for (const r of (await b.db.query(`SELECT olusturma_zamani, ozet FROM olay_kaydi WHERE ana_olay_ref = $1`, [v.kimlik])).rows) l.push({ zaman: r.olusturma_zamani, tur: 'Bağlı Kayıt', metin: r.ozet });
    if (v.kapanis_zamani) l.push({ zaman: v.kapanis_zamani, tur: 'Kapanış', metin: `${v.kapanis_ozeti ?? ''} · Kanıt: ${v.kapanis_kaniti ?? ''}` });
    return l.sort((a, c) => new Date(a.zaman).getTime() - new Date(c.zaman).getTime());
  });
  // YG-1285: aynı kesintiden gelen kayıt ana olaya bağlanır; ana olay kapanınca bağlı kayıtlar da kapanır.
  s.post('/olay/:id/bagla', oturumlu, async (i, y) => {
    const o = i.oturum!; const v = await olay((i.params as { id: string }).id); const ana = await olay(((i.body ?? {}) as { anaOlay?: string }).anaOlay ?? '');
    if (!v) return yok(y);
    if (!(await rolVar(o.kullanici, BT))) return y.code(403).send({ hata: 'Bağlamayı Bilgi İşlem veya Hukuk ve Uyum yapar.' });
    if (!ana || ana.kimlik === v.kimlik || ana.ana_olay_ref || ana.durum !== 'Açık' || v.durum !== 'Açık') return y.code(400).send({ hata: 'Bağlanacak ana olay açık ve kendisi başka bir olaya bağlı olmayan bir kayıt olmalıdır.' });
    await b.db.query(`UPDATE olay_kaydi SET ana_olay_ref = $2 WHERE kimlik = $1 OR ana_olay_ref = $1`, [v.kimlik, ana.kimlik]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Olay Ana Olaya Bağlandı', nesneTuru: 'Olay', nesneKimligi: v.kimlik, yeni: { anaOlay: ana.kimlik }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/olay/:id/guncelle', oturumlu, async (i, y) => {
    const o = i.oturum!; const v = await olay((i.params as { id: string }).id); const g = (i.body ?? {}) as { hizmet?: string; kullanici?: string; surec?: string; veri?: string; kisiselVeri?: boolean; belirti?: string; isSonucu?: string; onem?: string };
    if (!v) return yok(y);
    if (!(await rolVar(o.kullanici, BT))) return y.code(403).send({ hata: 'Olay kaydını Bilgi İşlem veya Hukuk ve Uyum günceller.' });
    if (g.onem && !ONEM.includes(g.onem)) return y.code(400).send({ hata: 'Önem Düşük, Orta, Yüksek veya Kritik olmalıdır.' }); // YG-1285
    const n = v.surum + 1; let ihlal = v.veri_ihlali_ref as string | null;
    if (g.kisiselVeri && !ihlal) ihlal = (await (await import('./kvkk.js')).ihlalAc(b.db, { ozet: `${v.ozet} (olay kaydından)`, olayTuru: 'Teknik güvenlik olayı', farkEden: o.kullanici })).kimlik;
    await b.db.query(`UPDATE olay_kaydi SET etki = $2, surum = $3, veri_ihlali_ref = $4, onem = coalesce($5, onem) WHERE kimlik = $1`, [v.kimlik, JSON.stringify(g), n, ihlal, g.onem ?? null]);
    await b.db.query(`INSERT INTO olay_surumu (olay_ref, surum, etki, guncelleyen_ref) VALUES ($1,$2,$3,$4)`, [v.kimlik, n, JSON.stringify(g), o.kullanici]);
    return { surum: n, ihlal };
  });
  s.post('/olay/:id/yanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const v = await olay((i.params as { id: string }).id);
    if (!v) return yok(y);
    if (!(await rolVar(o.kullanici, BT))) return y.code(403).send({ hata: 'Yanıtı Bilgi İşlem kaydeder.' });
    await b.db.query(`UPDATE olay_kaydi SET yanit_zamani = coalesce(yanit_zamani, now()) WHERE kimlik = $1`, [v.kimlik]);
    return { tamam: true };
  });
  s.post('/olay/:id/gecici-cozum', oturumlu, async (i, y) => {
    const o = i.oturum!; const v = await olay((i.params as { id: string }).id);
    if (!v) return yok(y);
    if (!(await rolVar(o.kullanici, BT))) return y.code(403).send({ hata: 'Geçici çözümü Bilgi İşlem kaydeder.' });
    await b.db.query(`UPDATE olay_kaydi SET gecici_cozum_zamani = coalesce(gecici_cozum_zamani, now()) WHERE kimlik = $1`, [v.kimlik]);
    return { tamam: true };
  });
  // YG-1281: BT ve kriz olaylarının listesi ve kapanışı; açıklama yetkilisi CEO'ca seçilir.
  const IZLEYEN = [...BT, 'CEO', 'Genel Müdür Yardımcısı', 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'];
  s.get('/olaylar', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, IZLEYEN))) return yok(y);
    return (await b.db.query(`SELECT o.kimlik, o.olay_turu, o.ozet, o.durum, o.surum, o.etki, o.onem, o.ana_olay_ref, (SELECT count(*)::int FROM olay_kaydi b WHERE b.ana_olay_ref = o.kimlik) bagli_sayisi, o.olusturma_zamani, o.yanit_zamani, o.gecici_cozum_zamani, o.veri_ihlali_ref IS NOT NULL AS ihlal_bagli, a.ad_soyad AS acan, k.ad_soyad AS aciklama_yetkilisi
      FROM olay_kaydi o JOIN kullanici_hesabi a ON a.kimlik = o.acan_ref LEFT JOIN kullanici_hesabi k ON k.kimlik = o.aciklama_yetkilisi_ref
      WHERE o.olay_turu IN ('BT Kesintisi veya Veri İhlali', 'Kurumsal Kriz') ORDER BY o.durum, o.olusturma_zamani DESC LIMIT 100`)).rows;
  });
  s.post('/olay/:id/kapat', oturumlu, async (i, y) => {
    const o = i.oturum!; const v = await olay((i.params as { id: string }).id); const g = (i.body ?? {}) as { ozet?: string; kanit?: string };
    if (!v) return yok(y);
    if (!(await rolVar(o.kullanici, BT))) return y.code(403).send({ hata: 'Olayı Bilgi İşlem veya Hukuk ve Uyum kapatır.' });
    if (!g.ozet?.trim()) return y.code(400).send({ hata: 'Kapanış özetini (kök neden ve alınan önlem) yazmanızı rica ederiz.' });
    if (!g.kanit?.trim()) return y.code(400).send({ hata: 'Kapanış kanıtını (hizmetin olağan çalıştığını gösteren kontrol) yazmanızı rica ederiz.' }); // YG-1285
    if (v.ana_olay_ref) return y.code(409).send({ hata: 'Bu kayıt ana olaya bağlıdır; ana olay kapanınca kendiliğinden kapanır.' });
    const r = await b.db.query(`UPDATE olay_kaydi SET durum = 'Kapalı', gecici_cozum_zamani = coalesce(gecici_cozum_zamani, now()), kapanis_ozeti = $2, kapanis_kaniti = $3, kapanis_zamani = now() WHERE kimlik = $1 AND durum = 'Açık'`, [v.kimlik, g.ozet.trim(), g.kanit.trim()]);
    if (r.rowCount) await b.db.query(`UPDATE olay_kaydi SET durum = 'Kapalı', kapanis_ozeti = $2, kapanis_kaniti = $3, kapanis_zamani = now() WHERE ana_olay_ref = $1 AND durum = 'Açık'`, [v.kimlik, `Ana olayla kapandı: ${g.ozet.trim()}`, g.kanit.trim()]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Olay zaten kapalıdır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Olay Kapatıldı', nesneTuru: 'Olay', nesneKimligi: v.kimlik, gerekce: g.ozet.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/olay/:id/aciklama-yetkilisi', oturumlu, async (i, y) => {
    const o = i.oturum!; const v = await olay((i.params as { id: string }).id); const k = ((i.body ?? {}) as { kullanici?: string }).kullanici;
    if (!v) return yok(y);
    if (!(await rolVar(o.kullanici, ['CEO']))) return y.code(403).send({ hata: 'Açıklama yetkilisini CEO belirler.' });
    if (!k) return y.code(400).send({ hata: 'Kişiyi seçmenizi rica ederiz.' });
    await b.db.query(`UPDATE olay_kaydi SET aciklama_yetkilisi_ref = $2 WHERE kimlik = $1`, [v.kimlik, k]);
    return { tamam: true };
  });
}
