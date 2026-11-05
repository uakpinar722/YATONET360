import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { kapanisKaydet } from './kapanis.js';
import { kartAc } from './is_motoru.js';
import { onayMakami } from './makam.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { izinGerekli, kullaniciIzinleri } from './yetki.js';

const UYGULAMA_SAAT = 24; // A33-1

/** YG-1643: sıra her yıl 0001'den başlar. */
export async function kayitNo(db: Pool | PoolClient, onEk: string): Promise<string> {
  const yil = new Date().getFullYear();
  const { rows } = await db.query(
    `INSERT INTO kayit_sayaci (on_ek, yil, sayi) VALUES ($1,$2,1) ON CONFLICT (on_ek, yil) DO UPDATE SET sayi = kayit_sayaci.sayi + 1 RETURNING sayi`, [onEk, yil]);
  return `${onEk}-${yil}-${String(rows[0].sayi).padStart(4, '0')}`;
}

/** Onay sonucu erişim talebine işlenir; onayda Sistem Yöneticisine 24 saatlik uygulama işi düşer (A33-1). */
kapanisKaydet('Erişim Talebi', async (c, k, karar, yapan) => {
  const id = k.nesne_kimligi as string;
  if (karar === 'Onayla') {
    await c.query(`UPDATE erisim_talebi SET talep_asamasi = 'Teknik Atama', is_onayi_veren = $2, is_onayi_zamani = now() WHERE kimlik = $1`, [id, yapan]);
    const rol = (await c.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Sistem Yöneticisi'`)).rows[0].kimlik;
    await kartAc(c, { tur: 'Erişim Talebi Uygulama', baslik: `Uygulanacak Onaylı Talep · ${id}`, ozet: k.ozet ?? undefined, sahipRol: rol, sonZaman: new Date(Date.now() + UYGULAMA_SAAT * 3_600_000), nesneTuru: 'erisim_talebi', nesneKimligi: id });
  } else if (karar === 'Reddet') await c.query(`UPDATE erisim_talebi SET talep_asamasi = 'Reddedildi' WHERE kimlik = $1`, [id]);
  else if (karar === 'Gerekçeyle İade Et') await c.query(`UPDATE erisim_talebi SET talep_asamasi = 'İade Edildi' WHERE kimlik = $1`, [id]);
  else if (karar === 'Yeniden Gönder') await c.query(`UPDATE erisim_talebi SET talep_asamasi = 'İş Onayı' WHERE kimlik = $1`, [id]);
});

export function erisimYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const uygulayici = { preHandler: izinGerekli(b, 'erisim.uygula') };

  // Formda yalnız etkin LGM personeli ve iç roller listelenir; rol serbest metinle girilmez (YG-1008).
  s.get('/erisim/secenekler', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    const k = await b.db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif' ORDER BY ad_soyad`);
    const r = await b.db.query(`SELECT kimlik, rol_adi, rol_sahibi_birim FROM rol WHERE kullanici_gruplari = 'LGM İç Rolü' AND rol_durumu = 'Aktif' ORDER BY rol_adi`);
    return { kullanicilar: k.rows, roller: r.rows };
  });

  s.post('/erisim/talep', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (o.grup !== 'LGM İç Rolü') return y.code(403).send({ hata: 'Bu işlem için yetkiniz bulunmamaktadır.' });
    const { kullanici, rol, gerekce, kapsam, sureSonu } = (i.body ?? {}) as Record<string, string | undefined>;
    if (!kullanici || !rol || !gerekce?.trim() || !kapsam?.trim() || !sureSonu) return y.code(400).send({ hata: 'Kullanıcı, rol, gerekçe, kapsam ve süre sonu zorunludur.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sureSonu) || new Date(sureSonu) <= new Date()) return y.code(400).send({ hata: 'Süre sonu ileri bir tarih olmalıdır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const ku = await c.query(`SELECT ad_soyad FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif'`, [kullanici]);
      const ro = await c.query(`SELECT rol_adi FROM rol WHERE kimlik = $1 AND kullanici_gruplari = 'LGM İç Rolü' AND rol_durumu = 'Aktif'`, [rol]);
      if (!ku.rowCount || !ro.rowCount) { await c.query('ROLLBACK'); return y.code(400).send({ hata: 'Kullanıcı veya rol geçersizdir.' }); }
      const id = await kayitNo(c, 'ERS');
      await c.query(`INSERT INTO erisim_talebi (kimlik, talep_eden_ref, kullanici_ref, rol_ref, is_gerekcesi, kapsam, sure_sonu) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, o.kullanici, kullanici, rol, gerekce.trim(), kapsam.trim(), sureSonu]);
      const kart = await kartAc(c, { tur: 'Erişim Talebi', baslik: `Erişim Talebi · ${id}`, ozet: `${ku.rows[0].ad_soyad} · ${ro.rows[0].rol_adi} · Bitiş: ${sureSonu.split('-').reverse().join('.')} · ${gerekce.trim()}`, hazirlayan: o.kullanici, zincir: [await onayMakami(c, rol)], nesneTuru: 'erisim_talebi', nesneKimligi: id });
      await c.query(`UPDATE erisim_talebi SET is_karti_ref = $2 WHERE kimlik = $1`, [id, kart]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Erişim Talebi Açıldı', nesneTuru: 'erisim_talebi', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: id };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.get('/erisim/taleplerim', oturumlu, async (i) => {
    const { rows } = await b.db.query(
      `SELECT t.kimlik, t.talep_asamasi, t.sure_sonu::text, k.ad_soyad AS kullanici, r.rol_adi AS rol FROM erisim_talebi t JOIN kullanici_hesabi k ON k.kimlik = t.kullanici_ref JOIN rol r ON r.kimlik = t.rol_ref
        WHERE t.talep_eden_ref = $1 ORDER BY t.olusturma_zamani DESC LIMIT 50`, [i.oturum!.kullanici]);
    return rows;
  });

  s.get('/erisim/uygulanacak', uygulayici, async (i) => {
    const { rows } = await b.db.query(
      `SELECT t.kimlik, t.sure_sonu::text, t.kapsam, t.is_gerekcesi, k.ad_soyad AS kullanici, r.rol_adi AS rol, o.ad_soyad AS onaylayan, t.kullanici_ref = $1 AS kendi,
              (SELECT string_agg(m.rol_adi || ': ' || c.neden, '; ') FROM rol_atamasi a JOIN rol_cakisma c ON (c.rol_a = t.rol_ref AND c.rol_b = a.rol_ref) OR (c.rol_b = t.rol_ref AND c.rol_a = a.rol_ref) JOIN rol m ON m.kimlik = a.rol_ref WHERE a.kullanici_ref = t.kullanici_ref AND a.atama_durumu = 'Aktif') AS cakisma
         FROM erisim_talebi t JOIN kullanici_hesabi k ON k.kimlik = t.kullanici_ref JOIN rol r ON r.kimlik = t.rol_ref LEFT JOIN kullanici_hesabi o ON o.kimlik = t.is_onayi_veren
        WHERE t.talep_asamasi = 'Teknik Atama' ORDER BY t.is_onayi_zamani`, [i.oturum!.kullanici]);
    return rows;
  });

  // A33-2: Uygula ve Kullanıcıya Bildir. YG-1008: talep eden, onaylayan ve atayan farklı kişi; kendi hesabına yetki yok. YG-1042: gerçek izin karşılaştırılır.
  s.post('/erisim/:id/uygula', uygulayici, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(`SELECT * FROM erisim_talebi WHERE kimlik = $1 FOR UPDATE`, [id]);
      const t = rows[0];
      const dur = async (kod: number, hata: string) => { await c.query('ROLLBACK'); return y.code(kod).send({ hata }); };
      if (!t) return dur(404, 'Kayıt bulunamadı.');
      if (t.talep_asamasi !== 'Teknik Atama') return dur(409, 'Bu talep uygulamaya hazır değildir.');
      // YG-1041: çakışan rol ancak sahipli, gerekçeli, telafi kontrollü ve yeniden inceleme tarihli risk kabulüyle atanır.
      if ((await c.query(`SELECT 1 FROM rol_atamasi a JOIN rol_cakisma z ON (z.rol_a = $2 AND z.rol_b = a.rol_ref) OR (z.rol_b = $2 AND z.rol_a = a.rol_ref) WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' LIMIT 1`, [t.kullanici_ref, t.rol_ref])).rowCount) {
        const rk = ((i.body ?? {}) as { riskKabulu?: { sahip?: string; gerekce?: string; telafi?: string; yenidenInceleme?: string } }).riskKabulu;
        if (!rk?.sahip?.trim() || !rk.gerekce?.trim() || !rk.telafi?.trim() || !rk.yenidenInceleme) return dur(409, 'Çakışan rol için risk kabulü zorunludur: sahip, gerekçe, telafi kontrolü ve yeniden inceleme tarihi.');
        await c.query(`INSERT INTO risk_kabulu (kullanici_ref, rol_ref, sahip_rol, gerekce, telafi_kontrolu, yeniden_inceleme, kaydeden_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [t.kullanici_ref, t.rol_ref, rk.sahip.trim(), rk.gerekce.trim(), rk.telafi.trim(), rk.yenidenInceleme, o.kullanici]);
      }
      if (t.kullanici_ref === o.kullanici) return dur(403, 'Kendi hesabınıza yetki tanımlayamazsınız.');
      if (t.talep_eden_ref === o.kullanici || t.is_onayi_veren === o.kullanici) return dur(403, 'Talep eden veya onaylayan kişi atamayı yapamaz.');
      await c.query(
        `INSERT INTO rol_atamasi (kullanici_ref, rol_ref, bitis_tarihi, atayan_ref, onaylayan_ref, erisim_talebi_ref, izin_dogrulandi) VALUES ($1,$2,$3,$4,$5,$6,false)
         ON CONFLICT (kullanici_ref, rol_ref, baslangic_tarihi) DO UPDATE SET bitis_tarihi = EXCLUDED.bitis_tarihi, atayan_ref = EXCLUDED.atayan_ref, onaylayan_ref = EXCLUDED.onaylayan_ref, erisim_talebi_ref = EXCLUDED.erisim_talebi_ref, atama_durumu = 'Aktif'`,
        [t.kullanici_ref, t.rol_ref, t.sure_sonu, o.kullanici, t.is_onayi_veren, id]);
      // Yeni yetki, açık oturumda değil yeniden doğrulanmış oturumda geçerli olsun (YG-1154).
      await c.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Yetki değişikliği' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [t.kullanici_ref]);
      await c.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Erişim Talebi Uygulama' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
      await c.query(`UPDATE erisim_talebi SET talep_asamasi = 'Bildirim', teknik_atama_zamani = now(), teknik_atayan = $2, kullanici_bildirim_zamani = now() WHERE kimlik = $1`, [id, o.kullanici]);
      const rolAdi = (await c.query(`SELECT rol_adi FROM rol WHERE kimlik = $1`, [t.rol_ref])).rows[0].rol_adi;
      for (const k of [t.kullanici_ref, t.talep_eden_ref]) await c.query(`INSERT INTO bildirim (kullanici_ref, baslik, ozet) VALUES ($1,$2,$3)`, [k, `Erişim Tanımlandı · ${id}`, rolAdi]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Rol Atandı', nesneTuru: 'erisim_talebi', nesneKimligi: id, yeni: { kullanici: t.kullanici_ref, rol: t.rol_ref, bitis: t.sure_sonu }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    // YG-1042: işlem sonrası gerçek yetki okunur ve kayda geçer.
    const t = (await b.db.query(`SELECT kullanici_ref, rol_ref FROM erisim_talebi WHERE kimlik = $1`, [id])).rows[0];
    const gercek = await b.db.query(
      `SELECT 1 FROM rol_atamasi WHERE kullanici_ref = $1 AND rol_ref = $2 AND atama_durumu = 'Aktif' AND baslangic_tarihi <= current_date AND (bitis_tarihi IS NULL OR bitis_tarihi >= current_date)`, [t.kullanici_ref, t.rol_ref]);
    const dogru = Boolean(gercek.rowCount);
    await b.db.query(`UPDATE erisim_talebi SET izin_dogrulandi = $2 WHERE kimlik = $1`, [id, dogru]);
    await b.db.query(`UPDATE rol_atamasi SET izin_dogrulandi = $2 WHERE erisim_talebi_ref = $1`, [id, dogru]);
    return { izinDogrulandi: dogru, izinler: await kullaniciIzinleri(b.db, t.kullanici_ref) };
  });
}
export { onayMakami };
