import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { kayitNo } from './erisim.js';
import { kapanisKaydet } from './kapanis.js';
import { kartAc } from './is_motoru.js';
import { onayMakami } from './makam.js';
import { kimlikNormalle, type Baglam } from './kimlik.js';
import { izinGerekli } from './yetki.js';

const DIS_TEYIT_SAAT = 8; // YG-1649

/** A32-3, YG-1649, YG-1699: iç kullanıcıda birim Müdürü; dış kullanıcıda kurum türüne göre teyit makamı. */
async function teyitMakami(db: Pool | PoolClient, kullanici: string, grup: string): Promise<{ rol: string; dis: boolean } | null> {
  const bul = async (ad: string) => (await db.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;
  if (grup === 'LGM İç Rolü') {
    const r = await db.query(
      `SELECT a.rol_ref FROM rol_atamasi a WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND a.baslangic_tarihi <= current_date AND (a.bitis_tarihi IS NULL OR a.bitis_tarihi >= current_date) ORDER BY a.olusturma_zamani LIMIT 1`, [kullanici]);
    return r.rows[0] ? { rol: await onayMakami(db, r.rows[0].rol_ref), dis: false } : null;
  }
  if (grup === 'İş Birliği Firması' || grup === 'Tedarikçi' || grup.startsWith('Tesis Yetkilisi')) return { rol: await bul('Sicil Sorumlusu'), dis: true };
  if (grup === 'Kurumsal Müşteri' || grup.startsWith('Sigorta Şirketi') || grup.startsWith('Broker')) return { rol: await bul('Müşteri ve Paydaş İlişkileri Müdür Yardımcısı'), dis: true };
  return null;
}

/** Teyit gelince ikinci faktör sıfırlanır, açık oturumlar kapanır; kullanıcı sonraki girişte yeniden kurar (YG-1050, YG-1198). */
const kapanis = async (c: PoolClient, k: { nesne_kimligi: string | null }, karar: string, yapan: string) => {
  const id = k.nesne_kimligi as string;
  if (karar === 'Onayla') {
    const u = (await c.query(`UPDATE hesap_kurtarma SET durum = 'Uygulandı', uygulama_zamani = now() WHERE kimlik = $1 RETURNING kullanici_ref`, [id])).rows[0].kullanici_ref as string;
    await c.query(`UPDATE kullanici_hesabi SET totp_gizli_sifreli = NULL, totp_son_adim = 0, basarisiz_giris_sayisi = 0, kilit_bitis_zamani = NULL, guncelleme_zamani = now(), surum = surum + 1 WHERE kimlik = $1`, [u]);
    await c.query(`UPDATE oturum SET bitis_zamani = now(), bitis_nedeni = 'Güvenlik sınırlaması' WHERE kullanici_ref = $1 AND bitis_zamani IS NULL`, [u]);
    await c.query(`INSERT INTO bildirim (kullanici_ref, baslik, ozet) VALUES ($1,$2,$3)`, [u, `Hesap Kurtarma · ${id}`, 'Doğrulama uygulamanız sıfırlanmıştır. Sonraki girişte yeniden kurunuz. Bu işlemi siz talep etmediyseniz destek hattına başvurunuz.']);
    await izYaz(c, { aktor: yapan, eylem: 'İkinci Faktör Sıfırlandı', nesneTuru: 'hesap_kurtarma', nesneKimligi: id, yeni: { kullanici: u }, sonuc: 'Başarılı' });
  } else if (karar === 'Reddet') await c.query(`UPDATE hesap_kurtarma SET durum = 'Reddedildi' WHERE kimlik = $1`, [id]);
  else if (karar === 'Gerekçeyle İade Et') await c.query(`UPDATE hesap_kurtarma SET durum = 'İade Edildi' WHERE kimlik = $1`, [id]);
  else if (karar === 'Yeniden Gönder') await c.query(`UPDATE hesap_kurtarma SET durum = 'Teyit Bekliyor' WHERE kimlik = $1`, [id]);
};
kapanisKaydet('Hesap Kurtarma', kapanis);
kapanisKaydet('Hesap Kurtarma Teyidi', kapanis);

export function hesapKurtarmaYollari(s: FastifyInstance, b: Baglam) {
  const yetkili = { preHandler: izinGerekli(b, 'hesap_kurtarma.ac') };

  // Yalnız tam e-posta veya telefonla bulunur; destek rolü kullanıcı listesi görmez (YG-992).
  s.post('/hesap-kurtarma/bul', yetkili, async (i, y) => {
    const n = kimlikNormalle(String(((i.body ?? {}) as { kimlik?: string }).kimlik ?? ''));
    if (!n.eposta && !n.telefon) return y.code(400).send({ hata: 'E-posta veya cep telefonu giriniz.' });
    const { rows } = await b.db.query(`SELECT kimlik, ad_soyad, kullanici_grubu, hesap_durumu FROM kullanici_hesabi WHERE ${n.eposta ? 'lower(e_posta) = $1' : 'cep_telefonu = $1'}`, [n.eposta ?? n.telefon]);
    if (!rows[0]) return y.code(404).send({ hata: 'Bu bilgiyle kayıtlı hesap bulunamadı.' });
    return rows[0];
  });

  s.post('/hesap-kurtarma', yetkili, async (i, y) => {
    const o = i.oturum!;
    const { kullanici, kimlikTeyidi, neden } = (i.body ?? {}) as Record<string, string | undefined>;
    if (!kullanici || !kimlikTeyidi?.trim() || !neden?.trim()) return y.code(400).send({ hata: 'Kullanıcı, kimlik teyidi ve neden zorunludur.' });
    if (kullanici === o.kullanici) return y.code(403).send({ hata: 'Kendi hesabınız için kurtarma açamazsınız.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const h = (await c.query(`SELECT ad_soyad, kullanici_grubu, dogrulama_yontemi FROM kullanici_hesabi WHERE kimlik = $1`, [kullanici])).rows[0];
      const dur = async (kod: number, hata: string) => { await c.query('ROLLBACK'); return y.code(kod).send({ hata }); };
      if (!h) return dur(400, 'Kullanıcı geçersizdir.');
      if (h.dogrulama_yontemi !== 'Doğrulama uygulaması (6 haneli kod)') return dur(409, 'Bu hesap SMS koduyla giriş yapar; kurtarma gerekmez.');
      const m = await teyitMakami(c, kullanici, h.kullanici_grubu);
      if (!m) return dur(409, 'Bu hesap için teyit makamı tanımlı değildir.');
      const id = await kayitNo(c, 'DST');
      await c.query(`INSERT INTO hesap_kurtarma (kimlik, acan_ref, kullanici_ref, kimlik_teyidi, neden) VALUES ($1,$2,$3,$4,$5)`, [id, o.kullanici, kullanici, kimlikTeyidi.trim(), neden.trim()]);
      const kart = await kartAc(c, {
        tur: m.dis ? 'Hesap Kurtarma Teyidi' : 'Hesap Kurtarma', baslik: `Hesap Kurtarma · ${id}`, ozet: `${h.ad_soyad} · ${neden.trim()} · Kimlik Teyidi: ${kimlikTeyidi.trim()}`,
        oncelik: 'Yüksek', hazirlayan: o.kullanici, zincir: [m.rol], sonZaman: m.dis ? new Date(Date.now() + DIS_TEYIT_SAAT * 3_600_000) : null, nesneTuru: 'hesap_kurtarma', nesneKimligi: id,
      });
      await c.query(`UPDATE hesap_kurtarma SET is_karti_ref = $2 WHERE kimlik = $1`, [id, kart]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Hesap Kurtarma Açıldı', nesneTuru: 'hesap_kurtarma', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: id, dis: m.dis };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  s.get('/hesap-kurtarma', yetkili, async (i) => {
    const { rows } = await b.db.query(
      `SELECT t.kimlik, t.durum, t.olusturma_zamani, k.ad_soyad AS kullanici, (SELECT rol_adi FROM rol WHERE kimlik = c.zincir[c.kademe + 1]) AS makam
         FROM hesap_kurtarma t JOIN kullanici_hesabi k ON k.kimlik = t.kullanici_ref LEFT JOIN is_karti c ON c.kimlik = t.is_karti_ref
        WHERE t.acan_ref = $1 ORDER BY t.olusturma_zamani DESC LIMIT 50`, [i.oturum!.kullanici]);
    return rows;
  });
}
