import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { dosyaErisimi } from './dosya.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

/** YG-624: Garanti Belgesi Ek-1 kullanım ve bakım önerileri; teslimden önce dosyadaki Teknik Uzman girer. */
export function garantiBelgesiYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  s.get('/dosya/:id/bakim-onerileri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    const k = (await b.db.query(`SELECT durum, bakim_onerileri FROM teslim_kaydi WHERE dosya_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 1`, [id])).rows[0];
    const tu = Boolean((await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)') AND bitis_zamani IS NULL`, [id, o.kullanici])).rowCount);
    return { teslim: k?.durum ?? null, oneriler: k?.bakim_onerileri ?? [], girer: tu && k?.durum === 'Onay Bekliyor' };
  });
  s.post('/dosya/:id/bakim-onerileri', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { oneriler?: { oneri?: string; zaman?: string }[] };
    if (o.grup !== 'LGM İç Rolü' || !UUID.test(id) || !(await dosyaErisimi(b.db, o.kullanici, id))) return yok(y);
    if (!(await b.db.query(`SELECT 1 FROM dosya_ekibi_atamasi WHERE dosya_ref = $1 AND kullanici_ref = $2 AND rol IN ('Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)') AND bitis_zamani IS NULL`, [id, o.kullanici])).rowCount) return y.code(403).send({ hata: 'Bakım önerilerini dosyadaki Teknik Uzman girer.' });
    const l = (g.oneriler ?? []).map((x) => ({ oneri: String(x.oneri ?? '').trim(), zaman: String(x.zaman ?? '').trim() })).filter((x) => x.oneri);
    if (!l.length || l.some((x) => !x.zaman)) return y.code(400).send({ hata: 'Her öneri için zaman (ör. İlk 10 çalışma saati) zorunludur.' });
    const r = await b.db.query(`UPDATE teslim_kaydi SET bakim_onerileri = $2 WHERE kimlik = (SELECT kimlik FROM teslim_kaydi WHERE dosya_ref = $1 AND durum = 'Onay Bekliyor' ORDER BY olusturma_zamani DESC LIMIT 1) RETURNING kimlik`, [id, JSON.stringify(l)]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Öneriler, yat sahibinin teslim onayından önce girilir.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bakım Önerileri Girildi', nesneTuru: 'Teslim', nesneKimligi: r.rows[0].kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
