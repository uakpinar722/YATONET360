import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

const YETKILI = ['İdari İşler Sorumlusu', 'İdari İşler Müdürü'];

/** YG-1618: varlık (demirbaş ve cihaz) LGM-VR-NNNNN; yıl içermez, boşluksuz ve tekil; zimmet teslim ve iadeleri bu numaraya bağlı hareket olarak tutulur. */
export function varlikYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const yetkili = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, YETKILI])).rowCount);

  s.get('/varlik', oturumlu, async (i, y) => {
    if (!(await yetkili(i.oturum!.kullanici))) return yok(y);
    return {
      varliklar: (await b.db.query(`SELECT v.kimlik, v.varlik_no, v.tur, v.ad, v.seri_no, v.durum, h.ad_soyad zimmetli FROM varlik v LEFT JOIN personel_zimmet z ON z.varlik_ref = v.kimlik AND z.iade_zamani IS NULL LEFT JOIN kullanici_hesabi h ON h.kimlik = z.personel_ref ORDER BY v.varlik_no`)).rows,
      personel: (await b.db.query(`SELECT kimlik, ad_soyad FROM kullanici_hesabi WHERE kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif' ORDER BY ad_soyad`)).rows,
    };
  });
  s.post('/varlik', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await yetkili(o.kullanici))) return yok(y);
    const g = (i.body ?? {}) as { tur?: string; ad?: string; seri?: string };
    if ((g.tur !== 'Demirbaş' && g.tur !== 'Cihaz') || !g.ad?.trim()) return y.code(400).send({ hata: 'Tür ve ad zorunludur.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const no = `LGM-VR-${String(await sayac(c, 'varlik')).padStart(5, '0')}`;
      const k = (await c.query(`INSERT INTO varlik (varlik_no, tur, ad, seri_no, kaydeden_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [no, g.tur, g.ad.trim(), g.seri?.trim() || null, o.kullanici])).rows[0].kimlik as string;
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Varlık Kaydı', nesneTuru: 'Varlık', nesneKimligi: k, yeni: { no }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: k, no };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.post('/varlik/:id/teslim', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { personel?: string };
    if (!UUID.test(id) || !(await yetkili(o.kullanici))) return yok(y);
    const v = (await b.db.query(`SELECT ad, seri_no, durum FROM varlik WHERE kimlik = $1`, [id])).rows[0]; if (!v) return yok(y);
    if (v.durum !== 'Depoda') return y.code(409).send({ hata: 'Varlık depoda değildir.' });
    if (!g.personel || !(await b.db.query(`SELECT 1 FROM kullanici_hesabi WHERE kimlik = $1 AND kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif'`, [g.personel])).rowCount) return y.code(400).send({ hata: 'Personeli seçiniz.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const z = (await c.query(`INSERT INTO personel_zimmet (personel_ref, ekipman, seri_no, teslim_tarihi, varlik_ref) VALUES ($1,$2,$3,(now() AT TIME ZONE 'Europe/Istanbul')::date,$4) RETURNING kimlik`, [g.personel, v.ad, v.seri_no, id])).rows[0].kimlik;
      await c.query(`INSERT INTO varlik_hareketi (varlik_ref, tur, personel_ref, zimmet_ref, yapan_ref) VALUES ($1,'Teslim',$2,$3,$4)`, [id, g.personel, z, o.kullanici]);
      await c.query(`UPDATE varlik SET durum = 'Zimmette' WHERE kimlik = $1`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Varlık Zimmet Teslimi', nesneTuru: 'Varlık', nesneKimligi: id, yeni: { personel: g.personel }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { zimmet: z };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.post('/varlik/:id/iade', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await yetkili(o.kullanici))) return yok(y);
    const z = (await b.db.query(`SELECT kimlik, personel_ref FROM personel_zimmet WHERE varlik_ref = $1 AND iade_zamani IS NULL`, [id])).rows[0];
    if (!z) return y.code(409).send({ hata: 'Varlık zimmette değildir.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE personel_zimmet SET iade_zamani = now(), iade_alan_ref = $2 WHERE kimlik = $1`, [z.kimlik, o.kullanici]);
      await c.query(`INSERT INTO varlik_hareketi (varlik_ref, tur, personel_ref, zimmet_ref, yapan_ref) VALUES ($1,'İade',$2,$3,$4)`, [id, z.personel_ref, z.kimlik, o.kullanici]);
      await c.query(`UPDATE varlik SET durum = 'Depoda' WHERE kimlik = $1`, [id]);
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Varlık Zimmet İadesi', nesneTuru: 'Varlık', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { tamam: true };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
}
