import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { ihbarKaydet } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/**
 * YG-076: ertelenen kalemler Planlı öncelikli alt dosya talebi olarak açılır; aynı yat ve yat sahibi taşınır, ana dosyaya bağlanır.
 * Dosya Sorumlusu talebi olağan açılış kontrolüyle dosyaya çevirir.
 */
export function ertelenenYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  s.post('/dosya/:id/ertelenen', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { kalemler?: unknown; hedef?: string };
    if (!UUID.test(id)) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND bitis_zamani IS NULL AND rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu', 'Operasyon Yöneticisi') LIMIT 1`, [id, o.kullanici])).rowCount) return yok(y);
    const kalemler = Array.isArray(g.kalemler) ? g.kalemler.map((x) => String(x).trim()).filter(Boolean) : [];
    if (!kalemler.length) return y.code(400).send({ hata: 'Ertelenen en az bir kalem giriniz.' });
    if (!g.hedef || !/^\d{4}-\d{2}-\d{2}$/.test(g.hedef)) return y.code(400).send({ hata: 'Planlı alt dosya için hedef tarih zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`SELECT dosya_no, yat_ref, konum, dosya_sorumlusu_ref, yazisma_dili, statu FROM dosya WHERE kimlik = $1`, [id])).rows[0];
      const t = (await c.query(`SELECT kisi_adi_soyadi, telefon, eposta, taraf_rolu FROM dosya_tarafi WHERE dosya_ref = $1 AND aktif AND taraf_rolu IN ('Yat Sahibi', 'Kaptan') ORDER BY taraf_rolu = 'Yat Sahibi' DESC LIMIT 1`, [id])).rows[0];
      const ilk = d.dosya_sorumlusu_ref ?? o.kullanici;
      const r = await ihbarKaydet(c, {
        kanal: 'YATONET 360', sahibiAdi: t?.kisi_adi_soyadi ?? 'Yat Sahibi', sahibiTuru: t?.taraf_rolu === 'Kaptan' ? 'Yatın Kaptanı' : 'Yat Sahibi', telefon: t?.telefon ?? undefined, eposta: t?.eposta ?? undefined,
        konum: d.konum ?? '-', yatDurumu: 'Ertelenen işler', ihtiyac: `Ertelenen kalemler (ana dosya ${d.dosya_no}): ${kalemler.join('; ')}`, yat: { yatId: d.yat_ref }, hedefTarih: g.hedef, cevaplar: {}, dil: d.yazisma_dili,
      }, o.kullanici, { ilkSorumlu: ilk });
      if ('hata' in r) { await c.query('ROLLBACK'); return y.code(400).send({ hata: r.hata }); }
      // Ertelenen kalem tanımı gereği planlıdır (YG-076); öneri de Planlı yazılır.
      await c.query(`UPDATE talep SET onceki_dosya_ref = $2, oncelik = 'Planlı', onerilen_oncelik = 'Planlı' WHERE kimlik = $1`, [r.kimlik, id]);
      await kartAc(c, { tur: 'Planlı Alt Dosya', kategori: 'gorev', baslik: `${d.dosya_no} · Ertelenen Kalemler ${r.talepNo}`, ozet: `${kalemler.length} kalem; talebi açılış kontrolüyle Planlı dosyaya çeviriniz.`, sahipKullanici: ilk, nesneTuru: 'Talep', nesneKimligi: r.kimlik });
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ertelenen Kalemler Ayrıldı', nesneTuru: 'Dosya', nesneKimligi: id, yeni: { talep: r.talepNo, kalemler }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { talep: r.kimlik, talepNo: r.talepNo };
    } catch (h) { await c.query('ROLLBACK'); throw h; } finally { c.release(); }
  });

  s.get('/dosya/:id/alt-talepler', oturumlu, async (i, y) => {
    const { id } = i.params as { id: string };
    if (i.oturum!.grup !== 'LGM İç Rolü' || !UUID.test(id)) return yok(y);
    const { dosyaErisimi } = await import('./dosya.js');
    if (!(await dosyaErisimi(b.db, i.oturum!.kullanici, id))) return yok(y);
    return (await b.db.query(`SELECT t.kimlik, t.talep_no, t.oncelik, t.statu, t.ihtiyac_tanimi, x.dosya_no FROM talep t LEFT JOIN dosya x ON x.talep_ref = t.kimlik WHERE t.onceki_dosya_ref = $1 ORDER BY t.kayda_gecis_zamani`, [id])).rows;
  });
}
