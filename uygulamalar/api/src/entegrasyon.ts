import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const HAZIRLAR = ['Bilgi İşlem Müdürü', 'Sistem Yöneticisi']; const GORUR = [...HAZIRLAR, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Hukuk ve Uyum Direktörü', 'CEO', 'Genel Müdür Yardımcısı'];
const TUR = 'Entegrasyon Üretime Açma Onayı';
const SINIF = ['Kamuya Açık', 'Kurumsal', 'Gizli', 'Kritik'];
const ALAN = ['ad', 'gonderen', 'alan', 'kayitSahibi', 'tetikleyici', 'siklik', 'bilgiSinifi', 'hataSorumlusu', 'hizmetBeklentisi', 'amac'] as const;

kapanisKaydet(TUR, async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE entegrasyon_tanimi SET durum = 'Üretimde', uretim_zamani = now() WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
  else if (karar === 'Reddet' || karar === 'Gerekçeyle İade Et') await c.query(`UPDATE entegrasyon_tanimi SET durum = 'Taslak' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
});

/** YG-1296: bağlantı yalnız onaylı ve askıda değilse çalışır; entegrasyon işleri gönderimden önce bunu sorar. */
export async function entegrasyonAcik(db: Db, ad: string): Promise<boolean> {
  return Boolean((await db.query(`SELECT 1 FROM entegrasyon_tanimi WHERE ad = $1 AND durum = 'Üretimde'`, [ad])).rowCount);
}

/**
 * YG-1296: her entegrasyonun gönderen/alan sistemi, kayıt sahibi, tetikleyicisi, sıklığı, bilgi sınıfı, hata sorumlusu ve hizmet beklentisi tanımlanır;
 * paylaşım amacı BT ve Firma Yönetimi Direktörü ile Hukuk ve Uyum Direktörü onaylamadan bağlantı üretime açılmaz.
 * YG-1306: güvenlik olayı veya ciddi veri uyuşmazlığında bağlantı gerekçe, etkilenen işler, geçici yöntem, kullanıcı bildirimi ve yeniden açma ölçütüyle askıya alınır.
 */
export function entegrasyonYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);

  s.get('/entegrasyon', oturumlu, async (i, y) => {
    if (!(await rolVar(i.oturum!.kullanici, GORUR))) return yok(y);
    return { hazirlar: await rolVar(i.oturum!.kullanici, HAZIRLAR), siniflar: SINIF, kayitlar: (await b.db.query(`SELECT e.*, (SELECT json_agg(json_build_object('neden', a.neden, 'zaman', a.askiya_alma_zamani, 'acilis', a.acilis_zamani) ORDER BY a.askiya_alma_zamani DESC) FROM entegrasyon_askisi a WHERE a.entegrasyon_ref = e.kimlik) askilar FROM entegrasyon_tanimi e ORDER BY e.ad`)).rows };
  });
  s.post('/entegrasyon', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await rolVar(o.kullanici, HAZIRLAR))) return yok(y);
    const g = (i.body ?? {}) as Partial<Record<(typeof ALAN)[number], string>>;
    if (ALAN.some((a) => !String(g[a] ?? '').trim())) return y.code(400).send({ hata: 'Tüm tanım alanları ve veri paylaşım amacı zorunludur.' });
    if (!SINIF.includes(g.bilgiSinifi!)) return y.code(400).send({ hata: 'Bilgi sınıfını seçiniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const k = (await c.query(`INSERT INTO entegrasyon_tanimi (ad, gonderen_sistem, alan_sistem, kayit_sahibi, tetikleyici, siklik, bilgi_sinifi, hata_sorumlusu, hizmet_beklentisi, paylasim_amaci, durum, hazirlayan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Onayda',$11) RETURNING kimlik`, [...ALAN.map((a) => g[a]!.trim()), o.kullanici])).rows[0].kimlik as string;
      await kartAc(c, { tur: TUR, baslik: `${TUR}: ${g.ad!.trim()}`, ozet: `${g.gonderen!.trim()} → ${g.alan!.trim()} · ${g.bilgiSinifi} · ${g.amac!.trim()}`.slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(c, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü'), await rolId(c, 'Hukuk ve Uyum Direktörü')], nesneTuru: 'Entegrasyon', nesneKimligi: k });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Entegrasyon Tanımı', nesneTuru: 'Entegrasyon', nesneKimligi: k, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: k };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.post('/entegrasyon/:id/askiya-al', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { neden?: string; aciklama?: string; etkilenen?: string; geciciYontem?: string; kullaniciBildirimi?: string; olcut?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, [...HAZIRLAR, 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü']))) return yok(y);
    if (g.neden !== 'Güvenlik Olayı' && g.neden !== 'Ciddi Veri Uyuşmazlığı') return y.code(400).send({ hata: 'Askıya alma nedenini seçiniz.' });
    if (![g.aciklama, g.etkilenen, g.geciciYontem, g.kullaniciBildirimi, g.olcut].every((x) => x?.trim())) return y.code(400).send({ hata: 'Açıklama, etkilenen işler, geçici yöntem, kullanıcı bildirimi ve yeniden açma ölçütü zorunludur.' });
    const e = (await b.db.query(`UPDATE entegrasyon_tanimi SET durum = 'Askıda' WHERE kimlik = $1 AND durum = 'Üretimde' RETURNING ad`, [id])).rows[0];
    if (!e) return y.code(409).send({ hata: 'Yalnız üretimdeki bağlantı askıya alınır.' });
    await b.db.query(`INSERT INTO entegrasyon_askisi (entegrasyon_ref, neden, aciklama, etkilenen_isler, gecici_yontem, kullanici_bildirimi, yeniden_acma_olcutu, askiya_alan_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, g.neden, g.aciklama!.trim(), g.etkilenen!.trim(), g.geciciYontem!.trim(), g.kullaniciBildirimi!.trim(), g.olcut!.trim(), o.kullanici]);
    const al: string[] = []; for (const r of ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Hukuk ve Uyum Direktörü']) al.push(...await rolSahipleri(b.db, await rolId(b.db, r)));
    await bildir(b.db, { olay: `entegrasyon-aski:${id}:${Date.now()}`, kullanicilar: al.filter((x) => x !== o.kullanici), baslik: `Bağlantı Askıya Alındı: ${e.ad}`, ozet: `${g.neden} · ${g.geciciYontem!.trim()}`.slice(0, 200), oncelik: 'Yüksek' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Entegrasyon Askıya Alındı', nesneTuru: 'Entegrasyon', nesneKimligi: id, gerekce: g.aciklama!.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
  s.post('/entegrasyon/:id/yeniden-ac', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { olcutKarsilandi?: boolean; gerekce?: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü']))) return yok(y);
    if (g.olcutKarsilandi !== true || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Yeniden açma ölçütünün karşılandığını gerekçesiyle kaydediniz.' });
    const a = (await b.db.query(`UPDATE entegrasyon_askisi SET acilis_zamani = now(), acan_ref = $2, acilis_gerekcesi = $3 WHERE entegrasyon_ref = $1 AND acilis_zamani IS NULL RETURNING kimlik`, [id, o.kullanici, g.gerekce.trim()])).rows[0];
    if (!a) return y.code(409).send({ hata: 'Bağlantı askıda değildir.' });
    await b.db.query(`UPDATE entegrasyon_tanimi SET durum = 'Üretimde' WHERE kimlik = $1`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Entegrasyon Yeniden Açıldı', nesneTuru: 'Entegrasyon', nesneKimligi: id, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
