import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { izinGerekli } from './yetki.js';
import { UUID } from './yat.js';

/** YG-1236: imha dönemleri Ocak ve Temmuz; saklama bitişinden sonraki ilk dönem. */
export function imhaDonemi(bitis: Date): string {
  const y = bitis.getUTCFullYear(); const a = bitis.getUTCMonth();
  return a === 0 ? `${y} Ocak` : a <= 6 ? `${y} Temmuz` : `${y + 1} Ocak`;
}

export function arsivFirmaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });

  // YG-1235, YG-1236: yalnız Kapalı dosya devredilir; olağan listeden çıkar, erişim dosya erişimiyle aynı kalır; dış paylaşım kapanır.
  s.post('/dosya/:id/arsivle', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const d = (await c.query(`SELECT statu, dosya_no, kapanma_nedeni, kapanis_zamani, teslim_tarihi, dosya_sorumlusu_ref, arsiv_zamani FROM dosya WHERE kimlik = $1 FOR UPDATE`, [id])).rows[0];
      if (!d || d.dosya_sorumlusu_ref !== o.kullanici) { await c.query('ROLLBACK'); return yok(y); }
      if (d.statu !== 'Kapalı' || d.arsiv_zamani) { await c.query('ROLLBACK'); return y.code(409).send({ hata: 'Arşiv devri yalnız arşivlenmemiş Kapalı dosyada yapılır.' }); }
      const kritik = (await c.query(`SELECT 1 FROM belge WHERE bag_turu = 'Dosya' AND bag_kimligi = $1 AND bilgi_sinifi = 'Kritik' LIMIT 1`, [id])).rowCount;
      const bitis = new Date(d.kapanis_zamani ?? Date.now()); bitis.setUTCFullYear(bitis.getUTCFullYear() + 5);
      const garanti = d.teslim_tarihi ? new Date(d.teslim_tarihi) : null; garanti?.setUTCFullYear(garanti.getUTCFullYear() + 1);
      await c.query(`INSERT INTO dosya_arsiv_devri (dosya_ref, kapanma_nedeni, bilgi_sinifi, saklama_grubu, saklama_bitis, imha_donemi, garanti_bitis, devreden_ref) VALUES ($1,$2,$3,'OPS-5',$4,$5,$6,$7)`, [id, d.kapanma_nedeni, kritik ? 'Kritik' : 'Gizli', bitis, imhaDonemi(bitis), garanti, o.kullanici]);
      await c.query(`UPDATE dosya SET arsiv_zamani = now() WHERE kimlik = $1`, [id]);
      await c.query(`UPDATE paylasim_baglantisi p SET iptal_zamani = now() FROM belge_surum s JOIN belge e ON e.kimlik = s.belge_ref WHERE p.surum_ref = s.kimlik AND p.iptal_zamani IS NULL AND e.bag_turu = 'Dosya' AND e.bag_kimligi = $1`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Arşiv Devri', nesneTuru: 'Dosya', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });

  // YG-1229: ilk temasta aydınlatma kaydı; son temastan 1 yıl sonra aday kayıt imha listesine girer. Hiç temas edilmemiş havuz kaydı listede kalır (YG-1263).
  const kayit = { preHandler: izinGerekli(b, 'firma.kayit') };
  s.get('/firma/:id/aday-durum', kayit, async (i, y) => {
    const { id } = i.params as { id: string };
    if (!UUID.test(id)) return yok(y);
    const f = (await b.db.query(`SELECT kayit_asamasi, son_temas_tarihi::text, aydinlatma_zamani FROM kurulus WHERE kimlik = $1`, [id])).rows[0];
    return f ? { aday: f.kayit_asamasi === 'Aday', sonTemas: f.son_temas_tarihi, aydinlatma: f.aydinlatma_zamani !== null } : yok(y);
  });
  s.post('/firma/:id/aday-temas', kayit, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { aydinlatma?: boolean };
    if (!UUID.test(id)) return yok(y);
    const f = (await b.db.query(`SELECT kayit_asamasi, aydinlatma_zamani FROM kurulus WHERE kimlik = $1`, [id])).rows[0]; if (!f) return yok(y);
    if (f.kayit_asamasi !== 'Aday') return y.code(409).send({ hata: 'Yalnız aday firma için temas kaydedilir.' });
    if (!f.aydinlatma_zamani && g.aydinlatma !== true) return y.code(400).send({ hata: 'İlk temasta aydınlatma yapıldığını işaretleyiniz.' });
    await b.db.query(`UPDATE kurulus SET son_temas_tarihi = current_date, aydinlatma_zamani = coalesce(aydinlatma_zamani, now()) WHERE kimlik = $1`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Aday Firma Teması', nesneTuru: 'Kuruluş', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
