import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { UUID } from './yat.js';

const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const ZIMMET_ROL = ['İdari İşler Sorumlusu', 'İdari İşler Müdürü', 'İnsan Kaynakları Müdürü', 'İnsan Kaynakları Sorumlusu'];

export function personelEkYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolVar = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const amirMi = async (amir: string, personel: string) => {
    const r = (await b.db.query(`SELECT rol_ref FROM rol_atamasi WHERE kullanici_ref = $1 AND atama_durumu = 'Aktif' LIMIT 1`, [personel])).rows[0]?.rol_ref as string | undefined;
    return r ? (await rolSahipleri(b.db, await onayMakami(b.db, r))).includes(amir) : false;
  };

  s.get('/personel-ek', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const yetkili = await rolVar(o.kullanici, ZIMMET_ROL);
    return {
      zimmetYetkili: yetkili,
      zimmetlerim: (await b.db.query(`SELECT kimlik, ekipman, seri_no, teslim_tarihi::text, iade_zamani FROM personel_zimmet WHERE personel_ref = $1 ORDER BY teslim_tarihi DESC`, [o.kullanici])).rows,
      acikZimmetler: yetkili ? (await b.db.query(`SELECT z.kimlik, z.ekipman, z.seri_no, h.ad_soyad FROM personel_zimmet z JOIN kullanici_hesabi h ON h.kimlik = z.personel_ref WHERE z.iade_zamani IS NULL ORDER BY h.ad_soyad LIMIT 300`)).rows : [],
      serbestZamanlarim: (await b.db.query(`SELECT nobet_tarihi::text, duzen, uygulama_tarihi::text FROM nobet_serbest_zaman WHERE personel_ref = $1 ORDER BY nobet_tarihi DESC LIMIT 50`, [o.kullanici])).rows,
      ozelGun: (await b.db.query(`SELECT evlilik_tarihi::text, paylasim_rizasi FROM personel_ozel_gun WHERE personel_ref = $1`, [o.kullanici])).rows[0] ?? null,
    };
  });

  // YG-974: imza yok; personelin beyanı zimmet kaydıdır.
  s.post('/zimmet', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { ekipman?: string; seri?: string; tarih?: string };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    if (!g.ekipman?.trim() || !TARIH.test(g.tarih ?? '')) return y.code(400).send({ hata: 'Ekipman ve teslim tarihi zorunludur.' });
    const r = await b.db.query(`INSERT INTO personel_zimmet (personel_ref, ekipman, seri_no, teslim_tarihi) VALUES ($1,$2,$3,$4) RETURNING kimlik`, [o.kullanici, g.ekipman.trim(), g.seri?.trim() || null, g.tarih]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Zimmet Beyanı', nesneTuru: 'Zimmet', nesneKimligi: r.rows[0].kimlik, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.rows[0].kimlik };
  });
  s.post('/zimmet/:id/iade', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string };
    if (!UUID.test(id) || !(await rolVar(o.kullanici, ZIMMET_ROL))) return yok(y);
    const r = await b.db.query(`UPDATE personel_zimmet SET iade_zamani = now(), iade_alan_ref = $2 WHERE kimlik = $1 AND iade_zamani IS NULL`, [id, o.kullanici]);
    return r.rowCount ? { tamam: true } : y.code(409).send({ hata: 'Bu zimmet iade edilmiştir.' });
  });

  // YG-956: nöbet ek ücret doğurmaz; gece fiilen çalışılmışsa ertesi düzeni birim amiri belirler.
  s.post('/nobet-serbest-zaman', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { personel?: string; nobetTarihi?: string; duzen?: string; uygulamaTarihi?: string; aciklama?: string };
    if (!g.personel || !(await amirMi(o.kullanici, g.personel))) return yok(y);
    if (!TARIH.test(g.nobetTarihi ?? '') || !TARIH.test(g.uygulamaTarihi ?? '') || !['Geç Başlama', 'Serbest Zaman'].includes(g.duzen ?? '')) return y.code(400).send({ hata: 'Nöbet tarihi, düzen ve uygulama tarihi zorunludur.' });
    if (g.uygulamaTarihi! <= g.nobetTarihi!) return y.code(400).send({ hata: 'Uygulama tarihi nöbetten sonra olmalıdır.' });
    const r = await b.db.query(`INSERT INTO nobet_serbest_zaman (personel_ref, nobet_tarihi, duzen, uygulama_tarihi, aciklama, amir_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (personel_ref, nobet_tarihi) DO NOTHING RETURNING kimlik`, [g.personel, g.nobetTarihi, g.duzen, g.uygulamaTarihi, g.aciklama?.trim() || null, o.kullanici]);
    return r.rowCount ? { kimlik: r.rows[0].kimlik } : y.code(409).send({ hata: 'Bu nöbet için düzen belirlenmiştir.' });
  });

  // YG-947: rıza geri alınınca evlilik tarihi silinir.
  s.post('/personel-ozel-gun', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { riza?: boolean; evlilikTarihi?: string };
    if (o.grup !== 'LGM İç Rolü') return yok(y);
    if (typeof g.riza !== 'boolean' || (g.riza && !TARIH.test(g.evlilikTarihi ?? ''))) return y.code(400).send({ hata: 'Rıza ve tarih bilgisi geçersizdir.' });
    await b.db.query(`INSERT INTO personel_ozel_gun (personel_ref, evlilik_tarihi, paylasim_rizasi) VALUES ($1,$2,$3) ON CONFLICT (personel_ref) DO UPDATE SET evlilik_tarihi = $2, paylasim_rizasi = $3, guncelleme_zamani = now()`, [o.kullanici, g.riza ? g.evlilikTarihi : null, g.riza]);
    return { tamam: true };
  });
}
