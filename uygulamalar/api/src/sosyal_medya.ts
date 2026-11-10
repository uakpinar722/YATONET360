import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami, rolSahipleri } from './makam.js';
import { sayac } from './sure.js';
import { haftaAnahtari } from './uyum_tarama.js';
import { UUID } from './yat.js';

const MPM = 'Müşteri ve Paydaş İlişkileri Müdürü';
const DEG = 'Sosyal Medya Değerlendirmesi'; const TARAMA = 'Sosyal Medya Haftalık Tarama';
const SONUC = ['İşlem Gerekmez', 'Sözcüye İletildi', 'Hukuka İletildi', 'Kapatıldı'];

/** YG-586: haftalık tarama görevi; olumsuz paylaşımda 2 saatlik iç değerlendirme süresi aşılırsa Müdür ve bağlı Direktörü uyarılır. */
export async function sosyalMedyaIsle(db: Pool, simdi = new Date()): Promise<number> {
  let n = 0; const mpm = await rolId(db, MPM);
  if (simdi.getDay() === 1 && (await birKez(db, 'sosyal-medya-tarama', haftaAnahtari(simdi)))) {
    const son = new Date(simdi); son.setHours(18, 0, 0, 0);
    await kartAc(db, { tur: TARAMA, kategori: 'gorev', baslik: `${TARAMA} · ${haftaAnahtari(simdi)}`, ozet: 'Haftalık sosyal medya taramasını yapıp İzleme Kaydına işleyiniz.', sahipRol: mpm, sonZaman: son, nesneTuru: TARAMA, nesneKimligi: haftaAnahtari(simdi) }); n++;
  }
  const geciken = (await db.query(`SELECT kimlik, kayit_no, ozet FROM sosyal_medya_kaydi WHERE olumsuz AND degerlendirme_zamani IS NULL AND tespit_zamani < $1::timestamptz - interval '2 hours'`, [simdi])).rows;
  for (const k of geciken) {
    if (!(await birKez(db, 'sosyal-medya-gecikme', k.kimlik))) continue;
    const ust = await onayMakami(db, mpm).catch(() => null);
    await bildir(db, { olay: `sosyal-gecik:${k.kimlik}`, kullanicilar: [...await rolSahipleri(db, mpm), ...(ust ? await rolSahipleri(db, ust) : [])], baslik: `2 Saatlik Değerlendirme Süresi Aşıldı: ${k.kayit_no}`, ozet: String(k.ozet).slice(0, 120), oncelik: 'Yüksek' }, simdi); n++;
  }
  return n;
}

/** YG-586: personel olumsuz paylaşımı bildirir, kayıt Sosyal Medya İzleme Kaydına girer; personel yanıt vermez, değerlendirme Müşteri ve Paydaş İlişkileri Müdürlüğündedir. */
export function sosyalMedyaYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const gorur = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, [MPM, 'CEO', 'Strateji ve Kurumsal Gelişim Direktörü']])).rowCount);

  s.post('/sosyal-medya', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const g = (i.body ?? {}) as { platform?: string; baglanti?: string; ozet?: string; tespit?: string; olumsuz?: boolean; tarama?: boolean };
    const tespit = g.tespit ? new Date(g.tespit) : new Date();
    if (!g.platform?.trim() || !g.ozet?.trim() || Number.isNaN(+tespit) || +tespit > Date.now() + 60_000) return y.code(400).send({ hata: 'Platform, özet ve tespit zamanı zorunludur.' });
    const tarama = Boolean(g.tarama) && (await gorur(o.kullanici));
    const no = `SMK-${new Date().getFullYear()}-${String(await sayac(b.db, 'sosyal_medya')).padStart(4, '0')}`;
    const k = (await b.db.query(`INSERT INTO sosyal_medya_kaydi (kayit_no, kaynak, platform, baglanti, ozet, tespit_zamani, olumsuz, giren_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING kimlik`, [no, tarama ? 'Haftalık Tarama' : 'Personel Bildirimi', g.platform.trim().slice(0, 60), g.baglanti?.trim() || null, g.ozet.trim().slice(0, 1000), tespit, g.olumsuz !== false, o.kullanici])).rows[0].kimlik as string;
    if (g.olumsuz !== false) await kartAc(b.db, { tur: DEG, kategori: 'gorev', baslik: `${no} · ${g.platform.trim()}`, ozet: g.ozet.trim().slice(0, 200), oncelik: 'Yüksek', sahipRol: await rolId(b.db, MPM), sonZaman: new Date(+tespit + 2 * 3_600_000), nesneTuru: DEG, nesneKimligi: k });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sosyal Medya Kaydı', nesneTuru: 'Sosyal Medya Kaydı', nesneKimligi: k, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: k, no };
  });
  s.get('/sosyal-medya', oturumlu, async (i, y) => {
    if (!(await gorur(i.oturum!.kullanici))) return yok(y);
    return (await b.db.query(`SELECT k.kimlik, k.kayit_no, k.kaynak, k.platform, k.baglanti, k.ozet, k.tespit_zamani, k.olumsuz, k.degerlendirme, k.sonuc, k.degerlendirme_zamani, (k.olumsuz AND k.degerlendirme_zamani IS NULL AND k.tespit_zamani < now() - interval '2 hours') AS gecikti FROM sosyal_medya_kaydi k ORDER BY k.degerlendirme_zamani IS NULL DESC, k.tespit_zamani DESC LIMIT 200`)).rows;
  });
  s.post('/sosyal-medya/:id/degerlendir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { degerlendirme?: string; sonuc?: string };
    if (!UUID.test(id) || !(await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = $2`, [o.kullanici, MPM])).rowCount) return yok(y);
    if (!g.degerlendirme?.trim() || !SONUC.includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'Değerlendirme ve sonuç zorunludur.' });
    const r = await b.db.query(`UPDATE sosyal_medya_kaydi SET degerlendirme = $2, sonuc = $3, degerlendiren_ref = $4, degerlendirme_zamani = now() WHERE kimlik = $1 AND degerlendirme_zamani IS NULL`, [id, g.degerlendirme.trim(), g.sonuc, o.kullanici]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Kayıt değerlendirilmiştir veya bulunamadı.' });
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = $1 AND nesne_kimligi = $2 AND durum = 'Bekliyor'`, [DEG, id]);
    if (g.sonuc === 'Sözcüye İletildi') await bildir(b.db, { olay: `sosyal-sozcu:${id}`, kullanicilar: await rolSahipleri(b.db, await rolId(b.db, 'CEO')), baslik: 'Sosyal Medya Paylaşımı Sözcü Değerlendirmesinde', ozet: g.degerlendirme.trim().slice(0, 120), oncelik: 'Yüksek' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sosyal Medya Değerlendirmesi', nesneTuru: 'Sosyal Medya Kaydı', nesneKimligi: id, yeni: { sonuc: g.sonuc }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
