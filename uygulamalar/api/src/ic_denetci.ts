import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { bildir, birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { UUID } from './yat.js';

const ID = 'İç Denetçi'; const IDM = 'İç Denetim Müdürü';
export const KANIT_TURLERI = ['Belge', 'Kayıt', 'Gözlem', 'Ölçüm', 'Yetkili Görüşme']; // Cilt II §8.12
const BULGU_SINIF = ['Gözlem', 'Minör', 'Majör', 'Kritik'];

/** YG-1671 (¶2222–2223): üç ayda bir (Ocak, Nisan, Temmuz, Ekim) İç Denetim Müdürüne "Üç Aylık Mali Kontrol Testi" görevi; denetim açılıp İç Denetçiye atanır. */
export async function ucAylikMaliKontrol(db: Pool, simdi = new Date()): Promise<boolean> {
  const ist = new Date(simdi.getTime() + 3 * 3_600_000); const ay = ist.getUTCMonth(); if (ay % 3 !== 0) return false;
  const ceyrek = `${ist.getUTCFullYear()}-Q${ay / 3 + 1}`;
  if (!(await birKez(db, 'uc-aylik-mali-kontrol', ceyrek))) return false;
  const son = new Date(`${new Date(Date.UTC(ist.getUTCFullYear(), ay + 1, 0)).toISOString().slice(0, 10)}T17:00:00+03:00`);
  await kartAc(db, { tur: 'Üç Aylık Mali Kontrol Testi', kategori: 'gorev', baslik: `${ceyrek} · Üç Aylık Mali Kontrol Testi`, ozet: 'Yetki, görev ayrılığı, ödeme ve tahsilat kontrollerini test etmek için "Mali Kontrol" süreçli denetimi açıp İç Denetçiye atayınız.', sahipRol: await rolId(db, IDM), sonZaman: son, nesneTuru: 'Mali Kontrol Testi', nesneKimligi: ceyrek, simdi });
  return true;
}

/** YG-1671 (A47): İç Denetçinin kanıt toplama ve kanıt talebi; dosya örnekleminin FR-KLT-011 denetim bulguları alanıyla incelenmesi. İç Denetçi onay vermez. */
export function icDenetciYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const rolde = async (k: string, r: string[]) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = ANY($2::text[]) LIMIT 1`, [k, r])).rowCount);
  const denetimim = async (k: string, id: string) => UUID.test(id) ? (await b.db.query(`SELECT * FROM ic_denetim WHERE kimlik = $1 AND denetci_ref = $2 AND durum = 'Açık'`, [id, k])).rows[0] : undefined;

  s.get('/ic-denetim/:id/kanitlar', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id)) return yok(y);
    const d = (await b.db.query(`SELECT denetci_ref FROM ic_denetim WHERE kimlik = $1`, [id])).rows[0];
    if (!d || (d.denetci_ref !== o.kullanici && !(await rolde(o.kullanici, [IDM, 'CEO'])))) return yok(y);
    const kanitlar = (await b.db.query(`SELECT k.tur, k.aciklama, k.zaman FROM ic_denetim_kanit k WHERE k.denetim_ref = $1 ORDER BY k.zaman`, [id])).rows;
    const talepler = (await b.db.query(`SELECT t.kimlik, t.konu, t.son_tarih::text son_tarih, t.yanit, t.yanit_zamani, h.ad_soyad istenen FROM ic_denetim_kanit_talebi t JOIN kullanici_hesabi h ON h.kimlik = t.istenen_ref WHERE t.denetim_ref = $1 ORDER BY t.zaman`, [id])).rows;
    return { kanitlar, talepler };
  });
  s.post('/ic-denetim/:id/kanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tur?: string; aciklama?: string };
    const d = await denetimim(o.kullanici, id); if (!d) return yok(y);
    if (!KANIT_TURLERI.includes(g.tur ?? '') || !g.aciklama?.trim()) return y.code(400).send({ hata: 'Kanıt türü ve açıklama zorunludur.' });
    await b.db.query(`INSERT INTO ic_denetim_kanit (denetim_ref, tur, aciklama, kaydeden_ref) VALUES ($1,$2,$3,$4)`, [id, g.tur, g.aciklama.trim(), o.kullanici]);
    return { tamam: true };
  });
  // Kanıt talebi (¶2236): denetçi LGM personelinden belge veya açıklama ister; yanıt süresi Süre Uyarılarında.
  s.post('/ic-denetim/:id/kanit-talebi', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { eposta?: string; konu?: string; sonTarih?: string };
    const d = await denetimim(o.kullanici, id); if (!d) return yok(y);
    const k = (await b.db.query(`SELECT kimlik FROM kullanici_hesabi WHERE lower(e_posta) = lower($1) AND kullanici_grubu = 'LGM İç Rolü' AND hesap_durumu = 'Aktif'`, [g.eposta?.trim() ?? ''])).rows[0];
    if (!k) return y.code(400).send({ hata: 'Kanıt istenecek LGM personelini kurumsal e-postasıyla giriniz.' });
    if (!g.konu?.trim() || !g.sonTarih || !/^\d{4}-\d{2}-\d{2}$/.test(g.sonTarih)) return y.code(400).send({ hata: 'Talep konusu ve yanıt son tarihi zorunludur.' });
    const r = (await b.db.query(`INSERT INTO ic_denetim_kanit_talebi (denetim_ref, istenen_ref, konu, son_tarih, isteyen_ref) VALUES ($1,$2,$3,$4,$5) RETURNING kimlik`, [id, k.kimlik, g.konu.trim(), g.sonTarih, o.kullanici])).rows[0];
    await kartAc(b.db, { tur: 'İç Denetim Kanıt Talebi', kategori: 'gorev', baslik: `${d.denetim_no} · Kanıt Talebi`, ozet: `${g.konu.trim().slice(0, 200)} · Bugün sayfasındaki "Kanıt Talepleri" bölümünden yanıtlayınız.`, oncelik: 'Yüksek', sahipKullanici: k.kimlik, hazirlayan: o.kullanici, sonZaman: new Date(`${g.sonTarih}T17:00:00+03:00`), nesneTuru: 'İç Denetim Kanıt Talebi', nesneKimligi: r.kimlik });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Kanıt Talebi', nesneTuru: 'İç Denetim', nesneKimligi: id, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { kimlik: r.kimlik };
  });
  s.get('/ic-denetim-kanit-talebi/bana', oturumlu, async (i) => (await b.db.query(`SELECT t.kimlik, t.konu, t.son_tarih::text son_tarih, d.denetim_no FROM ic_denetim_kanit_talebi t JOIN ic_denetim d ON d.kimlik = t.denetim_ref WHERE t.istenen_ref = $1 AND t.yanit IS NULL ORDER BY t.son_tarih`, [i.oturum!.kullanici])).rows);
  s.post('/ic-denetim-kanit-talebi/:id/yanit', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const { yanit } = (i.body ?? {}) as { yanit?: string };
    if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT t.*, d.denetim_no FROM ic_denetim_kanit_talebi t JOIN ic_denetim d ON d.kimlik = t.denetim_ref WHERE t.kimlik = $1 AND t.istenen_ref = $2 AND t.yanit IS NULL`, [id, o.kullanici])).rows[0]; if (!t) return yok(y);
    if (!yanit?.trim()) return y.code(400).send({ hata: 'Yanıtınızı yazınız; belgeyi ilgili kayda yükleyip yerini belirtiniz.' });
    await b.db.query(`UPDATE ic_denetim_kanit_talebi SET yanit = $2, yanit_zamani = now() WHERE kimlik = $1`, [id, yanit.trim()]);
    await b.db.query(`INSERT INTO ic_denetim_kanit (denetim_ref, tur, aciklama, kaydeden_ref) VALUES ($1,'Belge',$2,$3)`, [t.denetim_ref, `Kanıt talebi yanıtı: ${yanit.trim()}`.slice(0, 2000), o.kullanici]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'İç Denetim Kanıt Talebi' AND nesne_kimligi = $1 AND durum = 'Bekliyor'`, [id]);
    await bildir(b.db, { olay: `kanit-yanit:${id}`, kullanicilar: [t.isteyen_ref], baslik: `${t.denetim_no} · Kanıt Talebi Yanıtlandı`, ozet: yanit.trim().slice(0, 200) });
    return { tamam: true };
  });

  // Dosya örneklemi incelemesi (YG-808, ¶2206, ¶2218): atanan denetçi sonucu ve FR-KLT-011 denetim bulguları alanını (sınıf, kanıt, sorumlu, hedef tarih) kaydeder.
  s.get('/ic-denetim/orneklemim', oturumlu, async (i) => (await b.db.query(`SELECT o.donem, d.kimlik, d.dosya_no, o.inceleme_sonucu FROM ic_denetim_orneklemi o JOIN dosya d ON d.kimlik = o.dosya_ref WHERE o.denetci_ref = $1 AND o.inceleme_sonucu IS NULL ORDER BY o.donem, d.dosya_no`, [i.oturum!.kullanici])).rows);
  s.post('/ic-denetim/orneklem/:donem/:dosya/inceleme', oturumlu, async (i, y) => {
    const o = i.oturum!; const { donem, dosya } = i.params as { donem: string; dosya: string }; const g = (i.body ?? {}) as { sonuc?: string; sinif?: string; kanit?: string; sorumlu?: string; hedef?: string };
    if (!UUID.test(dosya) || !(await rolde(o.kullanici, [ID, IDM]))) return yok(y);
    const x = (await b.db.query(`SELECT 1 FROM ic_denetim_orneklemi WHERE donem = $1 AND dosya_ref = $2 AND denetci_ref = $3 AND inceleme_sonucu IS NULL`, [donem, dosya, o.kullanici])).rowCount; if (!x) return yok(y);
    if (!['Uygun', 'Bulgulu'].includes(g.sonuc ?? '')) return y.code(400).send({ hata: 'İnceleme sonucunu seçiniz.' });
    if (g.sonuc === 'Bulgulu' && (!BULGU_SINIF.includes(g.sinif ?? '') || !g.kanit?.trim() || !g.sorumlu?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(g.hedef ?? ''))) return y.code(400).send({ hata: 'Bulguda sınıf, kanıt, sorumlu ve hedef tarih zorunludur.' });
    await b.db.query(`UPDATE ic_denetim_orneklemi SET inceleme_sonucu = $3, bulgu_sinif = $4, bulgu_kanit = $5, bulgu_sorumlu = $6, bulgu_hedef = $7, inceleme_zamani = now() WHERE donem = $1 AND dosya_ref = $2`, [donem, dosya, g.sonuc, g.sonuc === 'Bulgulu' ? g.sinif : null, g.kanit?.trim() || null, g.sorumlu?.trim() || null, g.sonuc === 'Bulgulu' ? g.hedef : null]);
    await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Örneklem Denetimi' AND nesne_kimligi = $1 AND durum = 'Bekliyor' AND sahip_kullanici_ref = $2`, [dosya, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Örneklem İncelemesi', nesneTuru: 'Dosya', nesneKimligi: dosya, yeni: { sonuc: g.sonuc, sinif: g.sinif ?? null }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
