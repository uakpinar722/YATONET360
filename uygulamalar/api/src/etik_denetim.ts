import type { FastifyInstance, FastifyReply } from 'fastify';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { rolSahipleri } from './makam.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

const GMY = 'Genel Müdür Yardımcısı'; const MPM = 'Müşteri ve Paydaş İlişkileri Müdürü'; const IDM = 'İç Denetim Müdürü'; const CEO = 'CEO'; const ID = 'İç Denetçi';
const KATEGORI: Record<string, string> = { 'Yönlendirme Komisyonu': GMY, 'Etik Bildirim': GMY, 'Suistimal Şüphesi': GMY, 'Sosyal Medya': MPM, 'Doğrudan Müşteri Talebi': MPM };
const KARARLI = ['Yönlendirme Komisyonu', 'Etik Bildirim'];
const SINIF = ['Gözlem', 'Minör', 'Majör', 'Kritik'];

kapanisKaydet('İç Denetim Raporu', async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE ic_denetim SET durum = 'Sonuçlandı', kapanis_zamani = now() WHERE kimlik = $1 AND durum = 'Raporda'`, [k.nesne_kimligi]);
  else if (['Reddet', 'Gerekçeyle İade Et'].includes(karar)) await c.query(`UPDATE ic_denetim SET durum = 'Açık' WHERE kimlik = $1 AND durum = 'Raporda'`, [k.nesne_kimligi]);
});

/** YG-585, YG-587, YG-1068: tek modül; GMY bilgilenir, yat sahibine bildirime GMY karar verir. YG-1673–1682: iç denetim yalnız denetçi, Müdür ve CEO arasında kalır. */
export function etikDenetimYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);

  s.post('/etik-bildirim', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { kategori?: string; aciklama?: string; dosya?: string };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    const makam = KATEGORI[g.kategori ?? '']; if (!makam || !g.aciklama?.trim() || (g.dosya && !UUID.test(g.dosya))) return y.code(400).send({ hata: 'Kategori ve açıklama zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const no = `ETK-${new Date().getFullYear()}-${String(await sayac(c, 'etik_bildirim')).padStart(4, '0')}`; const ri = await rolId(c, makam);
      const r = (await c.query(`INSERT INTO etik_bildirim (bildirim_no, kategori, aciklama, dosya_ref, giren_ref, makam_rol_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [no, g.kategori, g.aciklama.trim(), g.dosya ?? null, o.kullanici, ri])).rows[0];
      await kartAc(c, { tur: 'Etik Bildirim', kategori: 'gorev', baslik: `${no} · ${g.kategori}`, oncelik: 'Yüksek', sahipRol: ri, nesneTuru: 'Etik Bildirim', nesneKimligi: r.kimlik });
      await bildir(c, { olay: `etik:${r.kimlik}`, kullanicilar: await rolSahipleri(c, ri), baslik: `${no} · ${g.kategori}`, oncelik: 'Yüksek' });
      await c.query('COMMIT');
      return { no };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
  s.get('/etik-bildirim', oturumlu, async (i, y) => {
    const r = await roller(i.oturum!.kullanici); const mk = [GMY, MPM].filter((x) => r.includes(x)); if (!mk.length) return yok(y);
    return (await b.db.query(`SELECT e.kimlik, e.bildirim_no, e.kategori, e.aciklama, e.durum, e.yat_sahibi_karari FROM etik_bildirim e JOIN rol x ON x.kimlik = e.makam_rol_ref WHERE x.rol_adi = ANY($1::text[]) ORDER BY e.durum = 'Kapalı', e.olusturma_zamani DESC LIMIT 200`, [mk])).rows;
  });
  s.post('/etik-bildirim/:id/karar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sonuc?: string; yatSahibi?: string };
    if (!UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT e.kategori, e.giren_ref, x.rol_adi FROM etik_bildirim e JOIN rol x ON x.kimlik = e.makam_rol_ref WHERE e.kimlik = $1`, [id])).rows[0];
    if (!e || !(await roller(o.kullanici)).includes(e.rol_adi) || e.giren_ref === o.kullanici) return yok(y);
    if (!g.sonuc?.trim() || (KARARLI.includes(e.kategori) && !['Bildirilsin', 'Bildirilmesin'].includes(g.yatSahibi ?? ''))) return y.code(400).send({ hata: 'Sonuç zorunludur; etik bildirimde yat sahibine bildirim kararı da verilir.' });
    const r = await b.db.query(`UPDATE etik_bildirim SET durum = 'Kapalı', sonuc = $2, yat_sahibi_karari = $3, karar_ref = $4, karar_zamani = now() WHERE kimlik = $1 AND durum = 'Açık'`, [id, g.sonuc.trim(), g.yatSahibi ?? null, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu kayıt kapanmıştır.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Etik Bildirim' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    return { tamam: true };
  });

  s.get('/ic-denetim', oturumlu, async (i, y) => {
    const o = i.oturum!; const r = await roller(o.kullanici); const tum = r.includes(IDM) || r.includes(CEO); if (!tum && !r.includes(ID)) return yok(y);
    const l = (await b.db.query(`SELECT d.kimlik, d.denetim_no, d.surec, d.kapsam, d.durum, d.vekaleten, (SELECT json_agg(json_build_object('sinif', x.sinif, 'tanim', x.tanim) ORDER BY x.zaman) FROM ic_denetim_bulgu x WHERE x.denetim_ref = d.kimlik) bulgular FROM ic_denetim d WHERE $1 OR d.denetci_ref = $2 ORDER BY d.durum = 'Sonuçlandı', d.olusturma_zamani DESC LIMIT 100`, [tum, o.kullanici])).rows;
    return { acabilir: r.includes(ID) || r.includes(IDM), denetimler: l };
  });
  // YG-1673: açılışta çıkar çatışması beyanı; son 12 ayda süreçte görev alan denetleyemez.
  s.post('/ic-denetim', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { surec?: string; kapsam?: string; cikarYok?: boolean; sonOnIkiAyGorevYok?: boolean };
    const r = await roller(o.kullanici); if (!r.includes(ID) && !r.includes(IDM)) return yok(y);
    if (!g.surec?.trim() || !g.kapsam?.trim() || g.cikarYok !== true) return y.code(400).send({ hata: 'Süreç, kapsam ve çıkar çatışması beyanı zorunludur.' });
    if (g.sonOnIkiAyGorevYok !== true) return y.code(409).send({ hata: 'Son 12 ayda görev aldığınız veya sorumlu olduğunuz süreci denetleyemezsiniz.' });
    const no = `DNT-${new Date().getFullYear()}-${String(await sayac(b.db, 'ic_denetim')).padStart(4, '0')}`;
    const t = (await b.db.query(`INSERT INTO ic_denetim (denetim_no, surec, kapsam, denetci_ref, vekaleten) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [no, g.surec.trim(), g.kapsam.trim(), o.kullanici, r.includes(IDM)])).rows[0];
    return { kimlik: t.kimlik, no };
  });
  const denetciMi = async (k: string, id: string) => (await b.db.query(`SELECT * FROM ic_denetim WHERE kimlik = $1 AND denetci_ref = $2 AND durum = 'Açık'`, [id, k])).rows[0];
  s.post('/ic-denetim/:id/bulgu', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { sinif?: string; tanim?: string };
    if (!UUID.test(id) || !(await denetciMi(o.kullanici, id))) return yok(y);
    if (!SINIF.includes(g.sinif ?? '') || !g.tanim?.trim()) return y.code(400).send({ hata: 'Sınıf ve tanım zorunludur.' });
    await b.db.query(`INSERT INTO ic_denetim_bulgu (denetim_ref, sinif, tanim) VALUES ($1,$2,$3)`, [id, g.sinif, g.tanim.trim()]);
    return { tamam: true };
  });
  // YG-1675, YG-1681, YG-1682: İç Denetçi → Müdür → CEO; Müdür yürüttüyse veya yoksa doğrudan CEO; GMY ve Risk Direktörü zincirde değildir.
  s.post('/ic-denetim/:id/rapor', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { ozet?: string };
    if (!UUID.test(id)) return yok(y);
    const d = await denetciMi(o.kullanici, id); if (!d) return yok(y);
    if (!g.ozet?.trim()) return y.code(400).send({ hata: 'Rapor özeti zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const idm = await rolId(c, IDM); const cg = await rolId(c, CEO); const mudurYok = !(await rolSahipleri(c, idm)).some((k) => k !== o.kullanici);
      const zincir = d.vekaleten || mudurYok ? [cg] : [idm, cg];
      await c.query(`UPDATE ic_denetim SET durum = 'Raporda', rapor_ozeti = $2 WHERE kimlik = $1`, [id, g.ozet.trim()]);
      await kartAc(c, { tur: 'İç Denetim Raporu', baslik: `${d.denetim_no} · İç Denetim Raporu`, ozet: d.vekaleten ? 'Vekâleten Yürütüldü' : undefined, hazirlayan: o.kullanici, zincir, nesneTuru: 'İç Denetim', nesneKimligi: id });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İç Denetim Raporu', nesneTuru: 'İç Denetim', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
