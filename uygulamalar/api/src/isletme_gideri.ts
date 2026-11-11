import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';

const GIREN = ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'Bilgi İşlem Müdürü'];
const DIREKTOR = 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü';
const GORUR = [...GIREN, 'CEO', 'Genel Müdür Yardımcısı', 'Muhasebe ve Finans Müdürü'];
const ONAY = 'YATONET Tavan Üstü Gider';

kapanisKaydet(ONAY, async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE yatonet_gideri SET durum = 'Onaylandı' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
  else if (karar === 'Reddet') await c.query(`UPDATE yatonet_gideri SET durum = 'Reddedildi' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
});

/** YG-930: kullanıma girişten (ilk gider kaydı) 3 ay sonra tavanın yeniden değerlendirilmesi görevi bir kez açılır. */
export async function tavanDegerlendirmeIsle(db: Pool): Promise<number> {
  const ilk = (await db.query(`SELECT min(zaman) z FROM yatonet_gideri`)).rows[0].z as Date | null;
  if (!ilk || Date.now() < +new Date(ilk) + 92 * 86_400_000 || !(await birKez(db, 'yatonet-tavan-3ay', 'ilk'))) return 0;
  await kartAc(db, { tur: 'YATONET Tavan Değerlendirmesi', kategori: 'gorev', baslik: 'YATONET 360 aylık işletme gideri tavanının yeniden değerlendirilmesi', ozet: 'Kullanıma girişten 3 ay geçti; gerçekleşen giderlere göre tavanı CEO\'ya sununuz.', sahipRol: await rolId(db, DIREKTOR), nesneTuru: 'YATONET Gideri', nesneKimligi: 'tavan' });
  return 1;
}

export function isletmeGideriYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);
  const tavan = async () => Number((await b.db.query(`SELECT deger FROM sistem_parametresi WHERE kod = 'yatonet_aylik_tavan_eur'`)).rows[0].deger);
  s.get('/yatonet-giderleri', oturumlu, async (i, y) => {
    const r = await roller(i.oturum!.kullanici); if (!r.some((x) => GORUR.includes(x))) return yok(y);
    return {
      tavan: await tavan(), giren: r.some((x) => GIREN.includes(x)),
      aylar: (await b.db.query(`SELECT ay, sum(tutar_eur) FILTER (WHERE durum IN ('Kayıtlı', 'Onaylandı'))::float8 toplam, sum(tutar_eur) FILTER (WHERE durum = 'Onayda')::float8 onayda FROM yatonet_gideri GROUP BY ay ORDER BY ay DESC LIMIT 24`)).rows,
      kalemler: (await b.db.query(`SELECT kimlik, ay, kalem, saglayici, tutar_eur::float8, gerekce, durum FROM yatonet_gideri ORDER BY ay DESC, zaman DESC LIMIT 100`)).rows,
    };
  });
  // Tavanı aşan gider yalnız BT ve FY Direktörünce gerekçeyle girilir ve CEO onayına gider.
  s.post('/yatonet-gideri', oturumlu, async (i, y) => {
    const o = i.oturum!; const r = await roller(o.kullanici); if (!r.some((x) => GIREN.includes(x))) return yok(y);
    const g = (i.body ?? {}) as { ay?: string; kalem?: string; saglayici?: string; tutar?: number; gerekce?: string };
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(g.ay ?? '') || !g.kalem?.trim() || !g.saglayici?.trim() || !(Number(g.tutar) > 0)) return y.code(400).send({ hata: 'Ay, kalem, sağlayıcı ve tutar zorunludur.' });
    const mevcut = Number((await b.db.query(`SELECT coalesce(sum(tutar_eur), 0) t FROM yatonet_gideri WHERE ay = $1 AND durum IN ('Kayıtlı', 'Onaylandı', 'Onayda')`, [g.ay])).rows[0].t);
    const asim = mevcut + Number(g.tutar) > await tavan();
    if (asim && !r.includes(DIREKTOR)) return y.code(403).send({ hata: 'Tavanı aşan gideri Bilgi Teknolojileri ve Firma Yönetimi Direktörü gerekçeyle CEO onayına sunar.' });
    if (asim && !g.gerekce?.trim()) return y.code(400).send({ hata: 'Tavan aşılıyor; gerekçe zorunludur.' });
    const k = (await b.db.query(`INSERT INTO yatonet_gideri (ay, kalem, saglayici, tutar_eur, gerekce, durum, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kimlik`, [g.ay, g.kalem.trim(), g.saglayici.trim(), Number(g.tutar), g.gerekce?.trim() || null, asim ? 'Onayda' : 'Kayıtlı', o.kullanici])).rows[0].kimlik;
    if (asim) await kartAc(b.db, { tur: ONAY, baslik: `${g.ay} · YATONET 360 tavan üstü gider: ${g.kalem.trim()}`, ozet: `${Number(g.tutar).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} EUR · ${g.gerekce!.trim()}`.slice(0, 200), hazirlayan: o.kullanici, zincir: [await rolId(b.db, 'CEO')], nesneTuru: 'YATONET Gideri', nesneKimligi: k });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'YATONET İşletme Gideri', nesneTuru: 'YATONET Gideri', nesneKimligi: k, gerekce: g.gerekce, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: k, durum: asim ? 'Onayda' : 'Kayıtlı' };
  });
}
