import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const MPM = 'Müşteri ve Paydaş İlişkileri Müdürü';

/** YG-1557: her Ocak liste TSB Tekne branşı verisi ve MERSİS unvanıyla güncellenir. */
export async function sigortaListesiGorevi(db: Pool, simdi = new Date()): Promise<boolean> {
  if (simdi.getMonth() !== 0 || !(await birKez(db, 'sigorta-listesi', String(simdi.getFullYear())))) return false;
  await kartAc(db, { tur: 'Sigorta Şirketi Listesi Güncellemesi', kategori: 'gorev', baslik: `${simdi.getFullYear()} Sigorta Şirketi Listesi Güncellemesi`, ozet: 'TSB Tekne branşı şirket listesini ve MERSİS unvanlarını teyit ederek güncelleyiniz.', sahipRol: await rolId(db, MPM), sonZaman: new Date(simdi.getFullYear(), 0, 31, 18), nesneTuru: 'Sigorta Şirketi Listesi', nesneKimligi: String(simdi.getFullYear()) });
  return true;
}

/** YG-1557: sigorta şirketleri tam kurumsal unvanla; giriş ekranlarına açılır liste kaynağıdır. Yazılan kısa ad veritabanında tam unvana çevrilir. */
export function sigortaSirketiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/sigorta-sirketleri', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    return (await b.db.query(`SELECT tsb_kodu, kisa_ad, tam_unvan, dayanak, mersis_teyit_tarihi, durum FROM sigorta_sirketi ORDER BY durum, tam_unvan`)).rows;
  });
  // Kayıt açılışında ve yıllık güncellemede MERSİS unvanıyla teyit edilir.
  s.post('/sigorta-sirketi', oturumlu, async (i, y) => {
    const o = i.oturum!;
    if (!(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2`, [o.kullanici, MPM])).rowCount) return yok(y);
    const g = (i.body ?? {}) as { tsbKodu?: string; kisaAd?: string; tamUnvan?: string; mersisUnvani?: string; teyitTarihi?: string; durum?: string };
    if (!/^\d{4}$/.test(g.tsbKodu ?? '') || !g.kisaAd?.trim() || !g.tamUnvan?.trim() || !g.mersisUnvani?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(g.teyitTarihi ?? '')) return y.code(400).send({ hata: 'TSB kodu, kısa ad, tam unvan, MERSİS unvanı ve teyit tarihi zorunludur.' });
    if (g.durum && g.durum !== 'Aktif' && g.durum !== 'Pasif') return y.code(400).send({ hata: 'Durum Aktif veya Pasif olmalıdır.' });
    const eski = (await b.db.query(`SELECT * FROM sigorta_sirketi WHERE tsb_kodu = $1`, [g.tsbKodu])).rows[0] ?? null;
    await b.db.query(`INSERT INTO sigorta_sirketi (tsb_kodu, kisa_ad, tam_unvan, dayanak, mersis_unvani, mersis_teyit_tarihi, durum, guncelleyen_ref) VALUES ($1,$2,$3,'Yıllık Güncelleme',$4,$5,$6,$7)
      ON CONFLICT (tsb_kodu) DO UPDATE SET kisa_ad = EXCLUDED.kisa_ad, tam_unvan = EXCLUDED.tam_unvan, mersis_unvani = EXCLUDED.mersis_unvani, mersis_teyit_tarihi = EXCLUDED.mersis_teyit_tarihi, durum = EXCLUDED.durum, guncelleyen_ref = EXCLUDED.guncelleyen_ref, guncelleme_zamani = now()`,
      [g.tsbKodu, g.kisaAd.trim(), g.tamUnvan.trim(), g.mersisUnvani.trim(), g.teyitTarihi, g.durum ?? 'Aktif', o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Şirketi Kaydı', nesneTuru: 'Sigorta Şirketi', nesneKimligi: g.tsbKodu!, eski, yeni: { tam_unvan: g.tamUnvan.trim(), durum: g.durum ?? 'Aktif' }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
