import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { birKez } from './bildirim.js';
import { izYaz } from './denetim.js';
import { rolId } from './ihbar.js';
import { kartAc } from './is_motoru.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { sayac } from './sure.js';
import { UUID } from './yat.js';

export type Satir = Record<string, string | undefined>;
const SICIL = ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı'];
const dolu = (x?: string) => (x?.trim() ? x.trim() : null);
const sayi = (x?: string) => (x?.trim() && !Number.isNaN(Number(x.replace(',', '.'))) ? Number(x.replace(',', '.')) : null);

/** ANV-1, YG-367: adaylar sicile Aday ve Pasif girer, paydaşlar alınmaz; yeniden çalıştırmak mevcut kaydı değiştirmez. */
export async function anaVeriYukle(c: PoolClient, g: { firmalar: Satir[]; noktalar: Satir[] }): Promise<{ firma: number; atlanan: number; paydas: number; nokta: number; mukerrerFirma: number; mukerrerNokta: number }> {
  let firma = 0; let atlanan = 0; let paydas = 0; let nokta = 0; let mukerrerFirma = 0; let mukerrerNokta = 0;
  for (const f of g.firmalar) {
    const no = sayi(f['Sıra']); const ad = dolu(f['Firma Adı']);
    if (no === null || !ad) continue;
    if (f['Kayıt Rolü']?.trim() !== 'İB Firması adayı') { paydas++; continue; }
    if ((await c.query(`SELECT 1 FROM kurulus WHERE ana_veri_no = $1`, [no])).rowCount) { atlanan++; continue; }
    const grup = dolu(f['Mükerrer Grubu']); if (grup) mukerrerFirma++;
    await c.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, kayit_asamasi, ag_statusu, kurumsal_telefon, il, ilce, ana_veri_no, adres, web, mukerrer_grubu, mukerrer_karari) VALUES ($1,$2,'Çözüm Ortağı','Aday','Pasif',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [`LGM-SC-${String(await sayac(c, 'sicil')).padStart(5, '0')}`, ad, dolu(f['Telefon']), dolu(f['Konum İl']), dolu(f['Konum İlçe']), no, dolu(f['Adres']), /^https?:|^www\./i.test(f['Web'] ?? '') ? dolu(f['Web']) : null, grup, grup ? 'Karar bekliyor' : null]);
    firma++;
  }
  for (const n of g.noktalar) {
    const no = sayi(n['Nokta No']); const ad = dolu(n['Tesis / Nitelik']) ?? dolu(n['Belde / Yerleşim']);
    if (no === null || !ad) continue;
    const karar = dolu(n['Mükerrer Kararı']); const grup = dolu(n['Olası Mükerrer Grubu']);
    const r = await c.query(`INSERT INTO baglama_noktasi (nokta_no, tur, il, ilce, belde, ad, bolge, hizmet_kumesi, teyit_durumu, enlem, boylam, mukerrer_grubu, mukerrer_karari) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (nokta_no) DO NOTHING`,
      [no, dolu(n['Tür']) ?? 'Belirsiz', dolu(n['İl']), dolu(n['İlçe']), dolu(n['Belde / Yerleşim']), ad, dolu(n['Bölge']), dolu(n['Hizmet Kümesi']), dolu(n['Teyit Durumu']), sayi(n['Enlem']), sayi(n['Boylam']), grup, karar === 'Karar bekliyor' ? karar : null]);
    if (r.rowCount) { nokta++; if (karar === 'Karar bekliyor') mukerrerNokta++; }
  }
  if ((mukerrerFirma || mukerrerNokta) && await birKez(c, 'ana_veri_mukerrer', 'ilk')) await kartAc(c, { tur: 'Ana Veri Mükerrer Kararı', kategori: 'gorev', baslik: 'Ana Veri · Mükerrer Kararları', ozet: `${mukerrerFirma} firma ve ${mukerrerNokta} bağlama noktası karar bekliyor.`, sahipRol: await rolId(c, 'Sicil Sorumlusu'), nesneTuru: 'Ana Veri', nesneKimligi: 'mukerrer' });
  return { firma, atlanan, paydas, nokta, mukerrerFirma, mukerrerNokta };
}

export function anaVeriYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const sicilci = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.rol_adi = ANY($2::text[]) LIMIT 1`, [k, SICIL])).rowCount);

  s.get('/ana-veri/mukerrer', oturumlu, async (i, y) => {
    if (!(await sicilci(i.oturum!.kullanici))) return yok(y);
    return {
      firmalar: (await b.db.query(`SELECT kimlik, mukerrer_grubu grup, sicil_no no, ticari_unvan ad, il FROM kurulus WHERE mukerrer_karari = 'Karar bekliyor' ORDER BY mukerrer_grubu, ticari_unvan`)).rows,
      noktalar: (await b.db.query(`SELECT kimlik, mukerrer_grubu grup, nokta_no::text no, ad, il FROM baglama_noktasi WHERE mukerrer_karari = 'Karar bekliyor' ORDER BY mukerrer_grubu, ad`)).rows,
    };
  });

  s.post('/ana-veri/mukerrer', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { tur?: string; kimlik?: string; karar?: string; ana?: string };
    if (!(await sicilci(o.kullanici))) return yok(y);
    if (!['firma', 'nokta'].includes(g.tur ?? '') || !g.kimlik || !UUID.test(g.kimlik) || !['Ayrı Kayıt', 'Birleştirildi'].includes(g.karar ?? '')) return y.code(400).send({ hata: 'Kayıt ve karar zorunludur.' });
    const [tablo, ref] = g.tur === 'firma' ? ['kurulus', 'ana_kayit_ref'] : ['baglama_noktasi', 'ana_nokta_ref'];
    const k = (await b.db.query(`SELECT mukerrer_grubu g FROM ${tablo} WHERE kimlik = $1 AND mukerrer_karari = 'Karar bekliyor'`, [g.kimlik])).rows[0];
    if (!k) return yok(y);
    if (g.karar === 'Birleştirildi' && (!g.ana || !UUID.test(g.ana) || g.ana === g.kimlik || !(await b.db.query(`SELECT 1 FROM ${tablo} WHERE kimlik = $1 AND mukerrer_grubu = $2`, [g.ana, k.g])).rowCount)) return y.code(400).send({ hata: 'Birleştirmede aynı gruptan ana kaydı seçiniz.' });
    await b.db.query(`UPDATE ${tablo} SET mukerrer_karari = $2, ${ref} = $3 WHERE kimlik = $1`, [g.kimlik, g.karar, g.karar === 'Birleştirildi' ? g.ana : null]);
    if (!(await b.db.query(`SELECT 1 FROM kurulus WHERE mukerrer_karari = 'Karar bekliyor' UNION ALL SELECT 1 FROM baglama_noktasi WHERE mukerrer_karari = 'Karar bekliyor' LIMIT 1`)).rowCount) await b.db.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Ana Veri Mükerrer Kararı' AND durum = 'Bekliyor'`);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Ana Veri Mükerrer Kararı', nesneTuru: g.tur!, nesneKimligi: g.kimlik, yeni: { karar: g.karar }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  s.get('/baglama-noktalari', oturumlu, async (i, y) => {
    if (i.oturum!.grup !== 'LGM İç Rolü') return yok(y);
    const q = i.query as { il?: string; ara?: string };
    return (await b.db.query(`SELECT n.kimlik, n.nokta_no, n.tur, n.il, n.ilce, n.ad, n.teyit_durumu, t.tesis_kodu FROM baglama_noktasi n LEFT JOIN firma_tesisi t ON t.kimlik = n.tesis_ref WHERE n.mukerrer_karari IS DISTINCT FROM 'Birleştirildi' AND ($1 = '' OR n.il = $1) AND ($2 = '' OR n.ad ILIKE '%' || $2 || '%') ORDER BY n.il, n.ad LIMIT 200`, [q.il ?? '', q.ara ?? ''])).rows;
  });

  // ANV-1: yalnız sözleşmeli tesis kaydına bağlanır; bağlama noktası tek başına iş alan kayıt değildir.
  s.post('/baglama-noktasi/:id/tesis', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; const g = (i.body ?? {}) as { tesis?: string };
    if (!UUID.test(id) || !(await sicilci(o.kullanici))) return yok(y);
    if (!g.tesis || !UUID.test(g.tesis) || !(await b.db.query(`SELECT 1 FROM firma_tesisi t JOIN kurulus k ON k.kimlik = t.kurulus_ref WHERE t.kimlik = $1 AND k.kayit_rolu = 'Tesis'`, [g.tesis])).rowCount) return y.code(400).send({ hata: 'Tesis kaydını seçiniz.' });
    const r = await b.db.query(`UPDATE baglama_noktasi SET tesis_ref = $2 WHERE kimlik = $1 AND tesis_ref IS NULL`, [id, g.tesis]);
    if (!r.rowCount) return y.code(409).send({ hata: 'Bu nokta bir tesise bağlıdır.' });
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Bağlama Noktası Tesise Bağlandı', nesneTuru: 'Bağlama Noktası', nesneKimligi: id, yeni: { tesis: g.tesis }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });
}
