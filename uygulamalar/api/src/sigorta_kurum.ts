import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const YETKILI = ['Müşteri ve Paydaş İlişkileri Müdürü', 'Ticari İşler Direktörü'];
const KANAL = ['Kendi Portalı', 'E-posta Şablonu', 'YATONET 360 Portalı'];
const KART = 'Sigorta Portalına Yükleme';

/** YG-442: kendi portalını kullanan sigortacıya giden teklifte Dosya Sorumlusuna 8 saatlik yükleme görevi. */
export async function sigortaPortalGorevi(db: Pool, simdi = new Date()): Promise<number> {
  const { rows } = await db.query(
    `SELECT f.kimlik, f.dosya_ref, f.teklif_no, d.dosya_no, d.dosya_sorumlusu_ref, c.portal_adresi FROM fiyat_teklifi f JOIN dosya d ON d.kimlik = f.dosya_ref JOIN dosya_sigorta_kaydi s ON s.dosya_ref = d.kimlik JOIN sigorta_kurum_karti c ON lower(c.sigortaci_adi) = lower(s.sigortaci_adi)
      WHERE c.kanal = 'Kendi Portalı' AND f.gonderim_zamani > $1::timestamptz - interval '30 days' AND d.dosya_sorumlusu_ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sigorta_portal_yukleme y WHERE y.teklif_ref = f.kimlik)`, [simdi]);
  let n = 0;
  for (const r of rows) {
    if (!(await birKez(db, 'sigorta_portal', r.kimlik))) continue;
    await kartAc(db, { tur: KART, kategori: 'gorev', baslik: `${r.dosya_no} · Sigorta Portalına Yükleme`, ozet: `${r.teklif_no}${r.portal_adresi ? ` · ${r.portal_adresi}` : ''}`, sahipKullanici: r.dosya_sorumlusu_ref, sonZaman: new Date(simdi.getTime() + 8 * 3_600_000), nesneTuru: 'Teklif', nesneKimligi: r.kimlik }); n++;
  }
  return n;
}

export function sigortaKurumYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, YETKILI])).rowCount);

  // YG-441: sigorta şirketi kartında kanal, portal adresi ve paket biçimi.
  s.get('/sigorta-kurum', oturumlu, async (i, y) => (await yetkili(i.oturum!.kullanici)) ? (await b.db.query(`SELECT sigortaci_adi, kanal, portal_adresi, paket_bicimi FROM sigorta_kurum_karti ORDER BY sigortaci_adi LIMIT 500`)).rows : yok(y));
  s.post('/sigorta-kurum', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ad?: string; kanal?: string; portal?: string; paket?: string };
    if (!(await yetkili(o.kullanici))) return yok(y);
    if (!g.ad?.trim() || !KANAL.includes(g.kanal ?? '') || (g.kanal === 'Kendi Portalı' && !g.portal?.trim())) return y.code(400).send({ hata: 'Şirket adı ve kanal zorunludur; kendi portalında adres de yazılır.' });
    await b.db.query(`INSERT INTO sigorta_kurum_karti (sigortaci_adi, kanal, portal_adresi, paket_bicimi, guncelleyen_ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sigortaci_adi) DO UPDATE SET kanal = $2, portal_adresi = $3, paket_bicimi = $4, guncelleyen_ref = $5, zaman = now()`, [g.ad.trim(), g.kanal, g.portal?.trim() || null, g.paket?.trim() || null, o.kullanici]);
    return { tamam: true };
  });
  s.post('/dosya/:id/sigorta-portal-yukleme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { teklif?: string; referans?: string };
    if (!UUID.test(id) || !g.teklif || !UUID.test(g.teklif) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!g.referans?.trim()) return y.code(400).send({ hata: 'Portal kayıt referansı zorunludur.' });
    if (!(await b.db.query(`SELECT 1 FROM fiyat_teklifi WHERE kimlik = $1 AND dosya_ref = $2`, [g.teklif, id])).rowCount) return yok(y);
    const r = await b.db.query(`INSERT INTO sigorta_portal_yukleme (teklif_ref, referans, yukleyen_ref) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING teklif_ref`, [g.teklif, g.referans.trim(), o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Yükleme kaydedilmiştir.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [KART, g.teklif]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Portalına Yükleme', nesneTuru: 'Teklif', nesneKimligi: g.teklif, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}

/** YG-1209: pazarlama izni talep aşamasında, "Şimdilik Geç" seçildiyse teslimde bir kez daha sorulur; sonra sorulmaz. */
export function pazarlamaAdimi(g: { izinVar: boolean; dosyaVar: boolean; teslimVar: boolean; talep: string | null; teslim: string | null }): 'Talep' | 'Teslim' | null {
  if (g.izinVar || !g.dosyaVar) return null;
  if (!g.talep) return 'Talep';
  return g.talep === 'Şimdilik Geç' && g.teslimVar && !g.teslim ? 'Teslim' : null;
}
const AMACLAR = ['Bakım ve sezon hatırlatmaları', 'Hizmet ve kampanya tanıtımları']; const KANALLAR = ['SMS', 'E-posta', 'Telefon', 'WhatsApp'];
const DOSYAM = `SELECT d.statu FROM dosya_tarafi t JOIN dosya d ON d.kimlik = t.dosya_ref WHERE t.kullanici_ref = $1 AND t.aktif`;

export function pazarlamaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const adim = async (k: string) => {
    const izinVar = Boolean((await b.db.query(`SELECT 1 FROM acik_riza WHERE ilgili_kisi_ref = $1 AND riza_turu = 'Pazarlama açık rızası' AND durum = 'Verildi' LIMIT 1`, [k])).rowCount);
    const d = (await b.db.query(DOSYAM, [k])).rows; const c = (await b.db.query(`SELECT adim, cevap FROM pazarlama_sorusu WHERE kullanici_ref = $1`, [k])).rows;
    const bul = (a: string) => (c.find((x) => x.adim === a)?.cevap as string | undefined) ?? null;
    return pazarlamaAdimi({ izinVar, dosyaVar: d.length > 0, teslimVar: d.some((x) => ['Teknik Kapalı', 'Kapalı'].includes(x.statu)), talep: bul('Talep'), teslim: bul('Teslim') });
  };
  s.get('/portal/pazarlama-sorusu', oturumlu, async (i) => ({ adim: i.oturum!.grup === 'LGM İç Rolü' ? null : await adim(i.oturum!.kullanici) }));
  s.post('/portal/pazarlama-sorusu', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { cevap?: string; amaclar?: string[]; kanallar?: string[] };
    const a = o.grup === 'LGM İç Rolü' ? null : await adim(o.kullanici);
    if (!a) return y.code(409).send({ hata: 'Bu aşamada izin sorusu bulunmamaktadır.' });
    if (!['Onay', 'Şimdilik Geç'].includes(g.cevap ?? '')) return y.code(400).send({ hata: 'Yanıt geçersizdir.' });
    const amaclar = (g.amaclar ?? []).filter((x) => AMACLAR.includes(x)); const kanallar = (g.kanallar ?? []).filter((x) => KANALLAR.includes(x));
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO pazarlama_sorusu (kullanici_ref, adim, cevap) VALUES ($1,$2,$3)`, [o.kullanici, a, g.cevap]);
      if (g.cevap === 'Onay') {
        for (const x of amaclar) await c.query(`INSERT INTO acik_riza (ilgili_kisi_ref, riza_turu, amac, kanal, kaynak, metin_surumu, onay_adimi) VALUES ($1,'Pazarlama açık rızası',$2,NULL,'Portal','R00',$3)`, [o.kullanici, x, a]);
        if (amaclar.length) for (const x of kanallar) await c.query(`INSERT INTO acik_riza (ilgili_kisi_ref, riza_turu, amac, kanal, kaynak, metin_surumu, onay_adimi) VALUES ($1,'Ticari elektronik ileti onayı',NULL,$2,'Portal','R00',$3)`, [o.kullanici, x, a]);
      }
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
