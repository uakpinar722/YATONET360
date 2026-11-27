import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { belgeUret } from './belge_uret.js';
import { bildir } from './bildirim.js';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/**
 * YG-224, K-139, V-1118: firma iş emrini ve tedarikçi siparişi portalda onay koduyla tek adımda kabul eder. Firmanın veya tedarikçinin sistem erişimi yoksa
 * ıslak imzalı taranmış kabul belgesi gerekçesiyle kaydedilir: iş emrinde Dosya Sorumlusu, siparişte siparişi hazırlayan girer. Belge dosyaya yüklenmiş olmalıdır.
 */
export function islakKabulYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const islem = async <T>(f: (c: PoolClient) => Promise<T>) => { const c = await b.db.connect(); try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); } };
  const dosyaBelgesi = async (belge: string | undefined, dosya: string) => Boolean(belge && UUID.test(belge) && (await b.db.query(`SELECT 1 FROM belge WHERE kimlik = $1 AND bag_turu = 'Dosya' AND bag_kimligi = $2`, [belge, dosya])).rowCount);

  s.post('/is-emri/:id/islak-imza-kabul', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string; gerekce?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const e = (await b.db.query(`SELECT e.kimlik, e.is_emri_no, e.statu, e.dosya_ref, d.dosya_sorumlusu_ref FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref WHERE e.kimlik = $1`, [id])).rows[0];
    if (!e || e.dosya_sorumlusu_ref !== o.kullanici) return yok(y);
    if (e.statu !== 'Kabul Bekliyor') return y.code(409).send({ hata: 'Bu iş emri kabul beklemiyor.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Firmanın neden sistemden kabul veremediğini yazınız.' });
    if (!(await dosyaBelgesi(g.belge, e.dosya_ref))) return y.code(400).send({ hata: 'Islak imzalı taranmış kabul belgesini dosyaya yükleyip seçiniz.' });
    return islem(async (c) => {
      await c.query(`UPDATE is_emri SET statu = 'Başlangıç Kontrolünde', firma_yaniti = 'Kabul', firma_kabul_zamani = now(), islak_imza_belge_ref = $2, islak_imza_gerekcesi = $3, guncelleme_zamani = now() WHERE kimlik = $1`, [id, g.belge, g.gerekce!.trim()]);
      await belgeUret(c, { tur: 'İş Emri', nesne: id, dosya: e.dosya_ref });
      await (await import('./firma.js')).bld01Gonder(c, id, b.webAdresi); // YG-1446
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'İş Emri Kabulü (Islak İmza İstisnası)', nesneTuru: 'İş Emri', nesneKimligi: id, yeni: { gerekce: g.gerekce!.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { statu: 'Başlangıç Kontrolünde' };
    });
  });

  s.post('/tedarik-siparisi/:id/islak-imza-kabul', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { belge?: string; gerekce?: string; teslim?: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT siparis_no, statu, tedarikci_kabul, hazirlayan_ref, dosya_ref FROM tedarik_siparisi WHERE kimlik = $1`, [id])).rows[0];
    if (!t || t.hazirlayan_ref !== o.kullanici) return yok(y);
    if (t.statu !== 'Verildi' || t.tedarikci_kabul) return y.code(409).send({ hata: 'Bu sipariş yanıtlanmıştır.' });
    if (!g.teslim || !/^\d{4}-\d{2}-\d{2}$/.test(g.teslim)) return y.code(400).send({ hata: 'Tedarikçinin taahhüt ettiği teslim tarihini yazınız.' });
    if (!g.gerekce?.trim()) return y.code(400).send({ hata: 'Tedarikçinin neden sistemden kabul veremediğini yazınız.' });
    if (!t.dosya_ref || !(await dosyaBelgesi(g.belge, t.dosya_ref))) return y.code(400).send({ hata: 'Islak imzalı taranmış sipariş kabul belgesini dosyaya yükleyip seçiniz.' });
    return islem(async (c) => {
      await c.query(`UPDATE tedarik_siparisi SET tedarikci_kabul = 'Kabul', tedarikci_teslim_tarihi = $2, islak_imza_belge_ref = $3, islak_imza_gerekcesi = $4 WHERE kimlik = $1`, [id, g.teslim, g.belge, g.gerekce!.trim()]);
      await bildir(c, { olay: `sp-yanit:${id}`, kullanicilar: [t.hazirlayan_ref], baslik: `${t.siparis_no} · Tedarikçi: Kabul (Islak İmza)`, oncelik: 'Normal' });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sipariş Kabulü (Islak İmza İstisnası)', nesneTuru: 'Tedarik Siparişi', nesneKimligi: id, yeni: { gerekce: g.gerekce!.trim() }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      return { yanit: 'Kabul' };
    });
  });
}
