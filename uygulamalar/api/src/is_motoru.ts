import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { kullaniciRolleri } from './yetki.js';

/** Buton standardı YG-1637: ara kademede Onaya Gönder, son makamda Onayla / Reddet, her kademede Gerekçeyle İade Et. */
export type Karar = 'Onaya Gönder' | 'Onayla' | 'Reddet' | 'Gerekçeyle İade Et' | 'Yeniden Gönder' | 'Tamamlandı';

export interface KartGirdisi {
  tur: string; baslik: string; ozet?: string; oncelik?: string; hazirlayan?: string | null; zincir?: string[];
  sahipKullanici?: string; sahipRol?: string; kategori?: 'onay' | 'islem' | 'gorev'; sonZaman?: Date | null; nesneTuru?: string; nesneKimligi?: string;
}

export async function rolSahipleri(db: Pool | PoolClient, rol: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT a.kullanici_ref k FROM rol_atamasi a JOIN kullanici_hesabi h ON h.kimlik = a.kullanici_ref
      WHERE a.rol_ref = $1 AND a.atama_durumu = 'Aktif' AND a.baslangic_tarihi <= current_date AND (a.bitis_tarihi IS NULL OR a.bitis_tarihi >= current_date) AND h.hesap_durumu = 'Aktif'`, [rol]);
  return rows.map((r) => r.k as string);
}

async function bildir(db: Pool | PoolClient, kisiler: string[], baslik: string, ozet: string | null, is: string) {
  for (const k of kisiler) await db.query(`INSERT INTO bildirim (kullanici_ref, baslik, ozet, is_ref) VALUES ($1,$2,$3,$4)`, [k, baslik, ozet, is]);
}

/** Modüllerin ortak giriş noktası (YG-1143): iş kartı açar ve sıradaki makama bildirir. */
export async function kartAc(db: Pool | PoolClient, g: KartGirdisi): Promise<string> {
  const kategori = g.kategori ?? (g.zincir?.length ? 'onay' : 'islem');
  const { rows } = await db.query(
    `INSERT INTO is_karti (tur, kategori, baslik, ozet, oncelik, hazirlayan_ref, zincir, sahip_kullanici_ref, sahip_rol_ref, son_zaman, nesne_turu, nesne_kimligi)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING kimlik`,
    [g.tur, kategori, g.baslik, g.ozet ?? null, g.oncelik ?? 'Normal', g.hazirlayan ?? null, g.zincir ?? [], g.sahipKullanici ?? null, g.sahipRol ?? null, g.sonZaman ?? null, g.nesneTuru ?? null, g.nesneKimligi ?? null]);
  const id = rows[0].kimlik as string;
  const hedef = kategori === 'onay' ? await rolSahipleri(db, g.zincir![0]!) : g.sahipKullanici ? [g.sahipKullanici] : await rolSahipleri(db, g.sahipRol!);
  await bildir(db, hedef.filter((k) => k !== g.hazirlayan), `Yeni İş: ${g.baslik}`, g.ozet ?? null, id);
  return id;
}

const SECIM = `k.kimlik, k.tur, k.kategori, k.baslik, k.ozet, k.oncelik, k.son_zaman, k.kademe, k.durum, k.hazirlayan_ref, cardinality(k.zincir) AS kademe_sayisi`;

export function isYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };

  /** Kişinin karar verebileceği adaylar: rolü sıradaki makam; kendi hazırladığı ve daha önce karar verdiği kartlar hariç (YG-1034). */
  async function kartlarim(kullanici: string) {
    const roller = (await kullaniciRolleri(b.db, kullanici)).map((r) => r.kimlik);
    const onay = await b.db.query(
      `SELECT ${SECIM}, h.ad_soyad AS hazirlayan_adi,
              (SELECT rol_adi FROM rol WHERE kimlik = k.zincir[k.kademe + 2]) AS sonraki_rol, (SELECT rol_adi FROM rol WHERE kimlik = k.zincir[k.kademe + 1]) AS makam
         FROM is_karti k LEFT JOIN kullanici_hesabi h ON h.kimlik = k.hazirlayan_ref
        WHERE k.durum = 'Bekliyor' AND k.kategori = 'onay' AND k.zincir[k.kademe + 1] = ANY($1)
          AND k.hazirlayan_ref IS DISTINCT FROM $2
          AND NOT EXISTS (SELECT 1 FROM is_karti_adim a WHERE a.is_ref = k.kimlik AND a.yapan_ref = $2 AND a.karar <> 'Yeniden Gönder')
        ORDER BY k.son_zaman NULLS LAST, k.olusturma_zamani`, [roller, kullanici]);
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
        WHERE d.kapsam = ANY($2) AND (d.bitis_zamani IS NULL OR d.bitis_zamani > now()) AND (NOT d.zorunlu OR r.zaman IS NULL) ORDER BY d.zorunlu DESC, d.yayim_zamani DESC LIMIT 5`, [o.kullanici, kapsam]);
    const ood = await b.db.query(`SELECT baslangic FROM olaganustu_donem WHERE bitis IS NULL ORDER BY baslangic DESC LIMIT 1`);
    const say = await b.db.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND okunma_zamani IS NULL`, [o.kullanici]);
    return { ...k, sureUyarilari: sure, duyurular: d.rows, olaganustu: ood.rows[0]?.baslangic ?? null, okunmamisBildirim: say.rows[0].n };
  });

  s.post('/is/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const { karar, gerekce } = (i.body ?? {}) as { karar?: Karar; gerekce?: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    const g = (gerekce ?? '').trim();
    if ((karar === 'Gerekçeyle İade Et' || karar === 'Reddet') && !g) return y.code(400).send({ hata: 'Gerekçe zorunludur.' });
    const roller = (await kullaniciRolleri(b.db, o.kullanici)).map((r) => r.kimlik);
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
        const once = await c.query(`SELECT 1 FROM is_karti_adim WHERE is_ref = $1 AND yapan_ref = $2 AND karar <> 'Yeniden Gönder'`, [id, o.kullanici]);
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
      await c.query(`INSERT INTO is_karti_adim (is_ref, kademe, karar, gerekce, yapan_ref, rol_ref) VALUES ($1,$2,$3,$4,$5,$6)`, [id, k.kademe, karar, g || null, o.kullanici, makam ?? null]);
      if (hedef.length) await bildir(c, hedef.filter((x) => x !== o.kullanici), baslik, g || k.ozet, id);
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
    const r = await b.db.query(`INSERT INTO duyuru_okuma (duyuru_ref, kullanici_ref) SELECT kimlik, $2 FROM duyuru WHERE kimlik = $1 AND kapsam = ANY($3) ON CONFLICT DO NOTHING`, [id, o.kullanici, kapsam]);
    if (!r.rowCount) {
      const var_ = await b.db.query(`SELECT 1 FROM duyuru_okuma WHERE duyuru_ref = $1 AND kullanici_ref = $2`, [id, o.kullanici]);
      if (!var_.rowCount) return y.code(404).send({ hata: 'Kayıt bulunamadı.' });
    }
    return { tamam: true };
  });
}
