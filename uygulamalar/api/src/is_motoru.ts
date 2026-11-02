import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { bildir } from './bildirim.js';
import { KAPANIS } from './kapanis.js';
import { rolSahipleri, zinciriDuzelt } from './makam.js';
import { etkinRoller } from './yetki.js';

/** Buton standardı YG-1637: ara kademede Onaya Gönder, son makamda Onayla / Reddet, her kademede Gerekçeyle İade Et. */
export type Karar = 'Onaya Gönder' | 'Onayla' | 'Reddet' | 'Gerekçeyle İade Et' | 'Yeniden Gönder' | 'Tamamlandı';

export interface KartGirdisi {
  tur: string; baslik: string; ozet?: string; oncelik?: string; hazirlayan?: string | null; zincir?: string[];
  sahipKullanici?: string; sahipRol?: string; kategori?: 'onay' | 'islem' | 'gorev'; sonZaman?: Date | null; nesneTuru?: string; nesneKimligi?: string;
}

export { rolSahipleri };

/** Modüllerin ortak giriş noktası (YG-1143): iş kartı açar ve sıradaki makama bildirir. */
export async function kartAc(db: Pool | PoolClient, g: KartGirdisi): Promise<string> {
  const kategori = g.kategori ?? (g.zincir?.length ? 'onay' : 'islem');
  if (g.zincir?.length) g = { ...g, zincir: await zinciriDuzelt(db, g.zincir, g.hazirlayan) };
  const { rows } = await db.query(
    `INSERT INTO is_karti (tur, kategori, baslik, ozet, oncelik, hazirlayan_ref, zincir, sahip_kullanici_ref, sahip_rol_ref, son_zaman, nesne_turu, nesne_kimligi)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING kimlik`,
    [g.tur, kategori, g.baslik, g.ozet ?? null, g.oncelik ?? 'Normal', g.hazirlayan ?? null, g.zincir ?? [], g.sahipKullanici ?? null, g.sahipRol ?? null, g.sonZaman ?? null, g.nesneTuru ?? null, g.nesneKimligi ?? null]);
  const id = rows[0].kimlik as string;
  const hedef = kategori === 'onay' ? await rolSahipleri(db, g.zincir![0]!) : g.sahipKullanici ? [g.sahipKullanici] : await rolSahipleri(db, g.sahipRol!);
  await bildir(db, { olay: `kart-ac:${id}`, kullanicilar: hedef.filter((k) => k !== g.hazirlayan), baslik: `Yeni İş: ${g.baslik}`, ozet: g.ozet ?? null, isRef: id, oncelik: g.oncelik, eposta: true });
  return id;
}

/** Görev ayrılığı yalnız son gönderimden sonraki kararlara bakar: iade edilip yeniden gönderilen kayda aynı makam yine karar verir. */
const SON_GONDERIM = `(SELECT coalesce(max(g.kimlik), 0) FROM is_karti_adim g WHERE g.is_ref = k.kimlik AND g.karar = 'Yeniden Gönder')`;
const SECIM = `k.kimlik, k.tur, k.kategori, k.baslik, k.ozet, k.oncelik, k.son_zaman, k.kademe, k.durum, k.hazirlayan_ref, cardinality(k.zincir) AS kademe_sayisi`;

export function isYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };

  /** Kişinin karar verebileceği adaylar: rolü sıradaki makam; kendi hazırladığı ve daha önce karar verdiği kartlar hariç (YG-1034). */
  async function kartlarim(kullanici: string) {
    const etkin = await etkinRoller(b.db, kullanici); const roller = etkin.map((r) => r.kimlik);
    const vekilRoller = etkin.filter((r) => r.vekalet).map((r) => r.kimlik);
    const onay = await b.db.query(
      `SELECT ${SECIM}, h.ad_soyad AS hazirlayan_adi,
              (SELECT rol_adi FROM rol WHERE kimlik = k.zincir[k.kademe + 2]) AS sonraki_rol, (SELECT rol_adi FROM rol WHERE kimlik = k.zincir[k.kademe + 1]) AS makam, k.zincir[k.kademe + 1] = ANY($3) AS vekaleten
         FROM is_karti k LEFT JOIN kullanici_hesabi h ON h.kimlik = k.hazirlayan_ref
        WHERE k.durum = 'Bekliyor' AND k.kategori = 'onay' AND k.zincir[k.kademe + 1] = ANY($1)
          AND k.hazirlayan_ref IS DISTINCT FROM $2
          AND NOT EXISTS (SELECT 1 FROM is_karti_adim a WHERE a.is_ref = k.kimlik AND a.yapan_ref = $2 AND a.kimlik > ${SON_GONDERIM})
        ORDER BY k.son_zaman NULLS LAST, k.olusturma_zamani`, [roller, kullanici, vekilRoller]);
    const islem = await b.db.query(
      `SELECT ${SECIM} FROM is_karti k WHERE k.durum = 'Bekliyor' AND k.kategori IN ('islem','gorev') AND (k.sahip_kullanici_ref = $1 OR k.sahip_rol_ref = ANY($2)) ORDER BY k.son_zaman NULLS LAST, k.olusturma_zamani`, [kullanici, roller]);
    const iade = await b.db.query(`SELECT ${SECIM}, (SELECT gerekce FROM is_karti_adim a WHERE a.is_ref = k.kimlik ORDER BY a.kimlik DESC LIMIT 1) AS gerekce FROM is_karti k WHERE k.durum = 'İade Edildi' AND k.hazirlayan_ref = $1 ORDER BY k.olusturma_zamani DESC`, [kullanici]);
    const gonderilmis = await b.db.query(
      `SELECT ${SECIM}, (SELECT rol_adi FROM rol WHERE kimlik = k.zincir[k.kademe + 1]) AS makam FROM is_karti k
        WHERE k.durum = 'Bekliyor' AND k.kategori = 'onay' AND k.hazirlayan_ref = $1 ORDER BY k.olusturma_zamani DESC`, [kullanici]);
    return { onay: onay.rows, islem: islem.rows.filter((r) => r.kategori === 'islem'), gorev: islem.rows.filter((r) => r.kategori === 'gorev'), iade: iade.rows, gonderilmis: gonderilmis.rows };
  }

  s.get('/bugun', oturumlu, async (i) => {
    const o = i.oturum!;
    const k = await kartlarim(o.kullanici);
    // YG-1635: kişinin süreli işlerinden en yakın 5'i.
    const sure = [...k.onay, ...k.islem, ...k.gorev].filter((x) => x.son_zaman).sort((a, c) => +new Date(a.son_zaman) - +new Date(c.son_zaman)).slice(0, 5);
    const kapsam = o.grup === 'LGM İç Rolü' ? ['LGM', 'Tümü'] : ['Dış', 'Tümü'];
    const d = await b.db.query(
      `SELECT d.kimlik, d.baslik, d.govde, d.zorunlu, d.yayim_zamani, r.zaman AS okundu FROM duyuru d LEFT JOIN duyuru_okuma r ON r.duyuru_ref = d.kimlik AND r.kullanici_ref = $1
        WHERE d.durum = 'Yayında' AND d.kapsam = ANY($2) AND (d.bitis_zamani IS NULL OR d.bitis_zamani > now()) AND (NOT d.zorunlu OR r.zaman IS NULL) ORDER BY d.zorunlu DESC, d.yayim_zamani DESC LIMIT 5`, [o.kullanici, kapsam]);
    const ood = await b.db.query(`SELECT baslangic FROM olaganustu_donem WHERE bitis IS NULL ORDER BY baslangic DESC LIMIT 1`);
    const say = await b.db.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND okunma_zamani IS NULL`, [o.kullanici]);
    const msj = await b.db.query(`SELECT count(*)::int n FROM ic_mesaj WHERE alici_ref = $1 AND okunma_zamani IS NULL`, [o.kullanici]);
    const vek = await b.db.query(`SELECT v.kimlik, v.bitis_tarihi::text AS bitis, h.ad_soyad AS asil, r.rol_adi AS rol FROM vekalet v JOIN kullanici_hesabi h ON h.kimlik = v.asil_ref JOIN rol r ON r.kimlik = v.rol_ref WHERE v.vekil_ref = $1 AND v.durum = 'Aktif' AND v.baslangic_tarihi <= current_date AND v.bitis_tarihi >= current_date ORDER BY v.bitis_tarihi`, [o.kullanici]);
    const tpl = await b.db.query(`SELECT DISTINCT t.kimlik, t.tpl_kod, t.konu, t.baslangic FROM toplanti t JOIN toplanti_katilimci p ON p.toplanti_ref = t.kimlik WHERE p.kullanici_ref = $1 AND t.durum = 'Planlandı' AND t.baslangic BETWEEN now() - interval '1 hour' AND now() + interval '24 hours' ORDER BY t.baslangic`, [o.kullanici]);
    return { ...k, toplantilar: tpl.rows, sureUyarilari: sure, duyurular: d.rows, olaganustu: ood.rows[0]?.baslangic ?? null, okunmamisBildirim: say.rows[0].n, okunmamisMesaj: msj.rows[0].n, vekaletler: vek.rows };
  });

  s.post('/is/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const { karar, gerekce } = (i.body ?? {}) as { karar?: Karar; gerekce?: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    const g = (gerekce ?? '').trim();
    if ((karar === 'Gerekçeyle İade Et' || karar === 'Reddet') && !g) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    const etkin = await etkinRoller(b.db, o.kullanici); const roller = etkin.map((r) => r.kimlik);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(`SELECT * FROM is_karti WHERE kimlik = $1 FOR UPDATE`, [id]);
      const k = rows[0];
      const dur = async (kod: number, hata: string) => { await c.query('ROLLBACK'); return y.code(kod).send({ hata }); };
      if (!k) return dur(404, 'Kayıt bulunamadı.');
      const makam: string | undefined = k.zincir[k.kademe];
      const sonMakam = k.kademe === k.zincir.length - 1;
      let yeni: { durum: string; kademe: number; kapanir: boolean };
      let hedef: string[] = []; let baslik = '';
      if (karar === 'Yeniden Gönder') {
        if (k.durum !== 'İade Edildi' || k.hazirlayan_ref !== o.kullanici) return dur(403, 'Bu işlem için yetkiniz bulunmamaktadır.');
        yeni = { durum: 'Bekliyor', kademe: 0, kapanir: false };
        hedef = await rolSahipleri(c, k.zincir[0]); baslik = `Yeniden Gönderildi: ${k.baslik}`;
      } else if (karar === 'Tamamlandı') {
        if (k.kategori === 'onay' || k.durum !== 'Bekliyor' || !(k.sahip_kullanici_ref === o.kullanici || roller.includes(k.sahip_rol_ref))) return dur(403, 'Bu işlem için yetkiniz bulunmamaktadır.');
        yeni = { durum: 'Tamamlandı', kademe: k.kademe, kapanir: true };
      } else {
        if (k.durum !== 'Bekliyor') return dur(409, 'Bu kayıt üzerinde işlem yapılmıştır.');
        if (k.kategori !== 'onay' || !makam || !roller.includes(makam)) return dur(403, 'Bu işlem için yetkiniz bulunmamaktadır.');
        // YG-1034, YG-990: hazırlayan veya zincirde daha önce karar veren aynı kaydı onaylayamaz.
        const once = await c.query(`SELECT 1 FROM is_karti_adim a WHERE a.is_ref = $1 AND a.yapan_ref = $2 AND a.kimlik > (SELECT coalesce(max(g.kimlik), 0) FROM is_karti_adim g WHERE g.is_ref = $1 AND g.karar = 'Yeniden Gönder')`, [id, o.kullanici]);
        if (k.hazirlayan_ref === o.kullanici || once.rowCount) return dur(403, 'Kendi hazırladığınız veya daha önce karar verdiğiniz kaydı onaylayamazsınız.');
        if (karar === 'Gerekçeyle İade Et') {
          yeni = { durum: 'İade Edildi', kademe: 0, kapanir: false };
          hedef = k.hazirlayan_ref ? [k.hazirlayan_ref] : []; baslik = `İade Edildi: ${k.baslik}`;
        } else if (karar === 'Onaya Gönder') {
          if (sonMakam) return dur(400, 'Son makamda "Onayla" veya "Reddet" kullanılır.');
          yeni = { durum: 'Bekliyor', kademe: k.kademe + 1, kapanir: false };
          hedef = await rolSahipleri(c, k.zincir[k.kademe + 1]); baslik = `Onayınızı Bekliyor: ${k.baslik}`;
        } else if (karar === 'Onayla' || karar === 'Reddet') {
          if (!sonMakam) return dur(400, 'Ara kademede "Onaya Gönder" veya "Gerekçeyle İade Et" kullanılır.');
          yeni = { durum: karar === 'Onayla' ? 'Onaylandı' : 'Reddedildi', kademe: k.kademe, kapanir: true };
          hedef = k.hazirlayan_ref ? [k.hazirlayan_ref] : []; baslik = `${yeni.durum}: ${k.baslik}`;
        } else return dur(400, 'Geçersiz karar.');
      }
      await c.query(`UPDATE is_karti SET durum = $2, kademe = $3, kapanma_zamani = CASE WHEN $4 THEN now() END WHERE kimlik = $1`, [id, yeni.durum, yeni.kademe, yeni.kapanir]);
      // Silinmez; kararın tamamı adım kaydında kalır (YG-1183).
      await c.query(`INSERT INTO is_karti_adim (is_ref, kademe, karar, gerekce, yapan_ref, rol_ref, vekaleten) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, k.kademe, karar, g || null, o.kullanici, makam ?? null, Boolean(makam && etkin.find((r) => r.kimlik === makam)?.vekalet)]);
      await KAPANIS.get(k.tur)?.(c, k, karar!, o.kullanici);
      if (hedef.length) await bildir(c, { olay: `kart-karar:${id}:${(await c.query('SELECT count(*) n FROM is_karti_adim WHERE is_ref = $1', [id])).rows[0].n}`, kullanicilar: hedef.filter((x) => x !== o.kullanici), baslik, ozet: g || k.ozet, isRef: id, oncelik: k.oncelik, eposta: true });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: `İş Kartı: ${karar}`, nesneTuru: k.tur, nesneKimligi: id, eski: { durum: k.durum, kademe: k.kademe }, yeni: { durum: yeni.durum, kademe: yeni.kademe }, gerekce: g || undefined, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { durum: yeni.durum, kademe: yeni.kademe };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // YG-1626: okunmamışlar önde.
  s.get('/bildirimler', oturumlu, async (i) => {
    const { rows } = await b.db.query(`SELECT kimlik, zaman, baslik, ozet, okunma_zamani FROM bildirim WHERE kullanici_ref = $1 ORDER BY (okunma_zamani IS NULL) DESC, zaman DESC LIMIT 200`, [i.oturum!.kullanici]);
    return rows;
  });
  s.post('/bildirimler/okundu', oturumlu, async (i) => {
    await b.db.query(`UPDATE bildirim SET okunma_zamani = now() WHERE kullanici_ref = $1 AND okunma_zamani IS NULL`, [i.oturum!.kullanici]);
    return { tamam: true };
  });

  // YG-1632: okundu kaydı yalnız kişinin kapsamındaki duyuruya yazılır.
  s.post('/duyuru/:id/okudum', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    const kapsam = o.grup === 'LGM İç Rolü' ? ['LGM', 'Tümü'] : ['Dış', 'Tümü'];
    const r = await b.db.query(`INSERT INTO duyuru_okuma (duyuru_ref, kullanici_ref) SELECT kimlik, $2 FROM duyuru WHERE kimlik = $1 AND durum = 'Yayında' AND kapsam = ANY($3) ON CONFLICT DO NOTHING`, [id, o.kullanici, kapsam]);
    if (!r.rowCount) {
      const var_ = await b.db.query(`SELECT 1 FROM duyuru_okuma WHERE duyuru_ref = $1 AND kullanici_ref = $2`, [id, o.kullanici]);
      if (!var_.rowCount) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    }
    return { tamam: true };
  });
}
