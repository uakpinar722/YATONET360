import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { xlsxUret } from './xlsx.js';

const DURUM = ['Verilecek', 'Görev Verildi', 'Sürüyor', 'Bekliyor', 'Düzeltilecek', 'Tamamlandı'];
const MP_YONETIR = ['CEO', 'Genel Müdür Yardımcısı'];
const UYUM_YONETIR = ['Hukuk ve Uyum Direktörü', 'Hukuk ve Uyum Uzmanı'];
const UYUM_GORUR = [...UYUM_YONETIR, 'CEO', 'Genel Müdür Yardımcısı', 'İç Denetim Müdürü', 'İç Denetçi', 'Risk ve Kalite Direktörü'];
const UYUM_ALAN: [string, string][] = [['mum_no', 'MUM No'], ['alan', 'Alan'], ['mevzuat', 'Mevzuat'], ['madde', 'Madde'], ['yukumluluk', 'Yükümlülük'], ['tetikleyici', 'Tetikleyici'], ['sorumlu_rol', 'Sorumlu Rol'], ['sure_metni', 'Süre'], ['gerekli_kanit', 'Gerekli Kanıt'], ['dogrulayan_rol', 'Doğrulayan Rol'], ['kayit', 'Kayıt'], ['belge', 'Belge'], ['dogrulama', 'Doğrulama'], ['not_metni', 'Not'], ['engelleyici', 'Engelleyici'], ['olay_kodu', 'Olay Kodu'], ['sure_gun', 'Süre (gün)']];
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const bugun = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/** YG-776: hedef tarihi geçen ve tamamlanmayan kart kırmızı, tamamlanan yeşil. */
export const kartRengi = (k: { durum: string; hedef_tarih: string | null }, gun = bugun()) => (k.durum === 'Tamamlandı' ? 'yesil' : k.hedef_tarih && k.hedef_tarih < gun ? 'kirmizi' : null);

/** Master Plan kartlarının ilk aktarımı: mevcut kart değiştirilmez (bir kez). */
export async function masterPlanAktar(db: Pool, satirlar: Record<string, string>[]): Promise<number> {
  let n = 0;
  for (const r of satirlar) {
    if (!r.islem_no || !r.yapilacak) continue;
    const t = (x?: string) => (x && TARIH.test(x) ? x : null);
    n += (await db.query(`INSERT INTO master_plan_karti (islem_no, faz, is_akisi, yapilacak, muhatap, on_kosul, hedef_tarih, siklik, beklenen_cikti, kapanis_kaniti, kabul_makami, baglanti, eski_kart_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (islem_no) DO NOTHING`,
      [r.islem_no, r.faz, r.is_akisi || null, r.yapilacak, r.muhatap, r.on_kosul || null, t(r.hedef_tarih), r.siklik || null, r.beklenen_cikti || null, r.kapanis_kaniti || null, r.kabul_makami || null, r.baglanti || null, r.eski_kart_no || null])).rowCount ?? 0;
  }
  return n;
}

export function masterPlanYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT x.rol_adi FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif'`, [k])).rows.map((r) => r.rol_adi as string);

  // YG-776: CEO ve GMY tüm kartları, muhatap rol kendi kartlarını görür; faz ve muhatap özeti.
  s.get('/master-plan', oturumlu, async (i, y) => {
    const o = i.oturum!; if (o.grup !== 'LGM İç Rolü') return yok(y);
    const r = await roller(o.kullanici); const tum = r.some((x) => MP_YONETIR.includes(x));
    const l = (await b.db.query(`SELECT islem_no, faz, is_akisi, yapilacak, muhatap, on_kosul, hedef_tarih::text, siklik, beklenen_cikti, kapanis_kaniti, kabul_makami, baglanti, durum, verildigi_tarih::text, tamamlanma_tarihi::text, kayit_no, ceo_notu FROM master_plan_karti WHERE $1 OR muhatap = ANY($2::text[]) ORDER BY islem_no`, [tum, r])).rows;
    if (!l.length && !tum) return yok(y);
    const g = bugun(); const kartlar = l.map((k) => ({ ...k, renk: kartRengi(k, g) }));
    const ozetle = (anahtar: 'faz' | 'muhatap') => [...new Set(kartlar.map((k) => k[anahtar] as string))].sort().map((a) => {
      const x = kartlar.filter((k) => k[anahtar] === a);
      return { ad: a, kart: x.length, tamamlandi: x.filter((k) => k.durum === 'Tamamlandı').length, suruyor: x.filter((k) => ['Görev Verildi', 'Sürüyor'].includes(k.durum)).length, bekliyor: x.filter((k) => ['Bekliyor', 'Düzeltilecek'].includes(k.durum)).length, verilecek: x.filter((k) => k.durum === 'Verilecek').length, gecikti: x.filter((k) => k.renk === 'kirmizi').length, oran: Math.round((100 * x.filter((k) => k.durum === 'Tamamlandı').length) / x.length) };
    });
    return { kartlar, faz: ozetle('faz'), muhatap: ozetle('muhatap'), yonetir: tum, ceo: r.includes('CEO') };
  });
  s.post('/master-plan/:no', oturumlu, async (i, y) => {
    const o = i.oturum!; const { no } = i.params as { no: string }; const r = await roller(o.kullanici);
    const g = (i.body ?? {}) as { durum?: string; verildigi?: string; tamamlanma?: string; kayitNo?: string; ceoNotu?: string };
    const k = (await b.db.query(`SELECT *, verildigi_tarih::text vt, tamamlanma_tarihi::text tt FROM master_plan_karti WHERE islem_no = $1`, [no])).rows[0];
    if (!k || !(r.some((x) => MP_YONETIR.includes(x)) || r.includes(k.muhatap))) return yok(y);
    if (g.ceoNotu !== undefined && !r.includes('CEO')) return y.code(403).send({ hata: 'CEO notunu yalnız CEO yazar.' });
    const durum = g.durum ?? k.durum; if (!DURUM.includes(durum)) return y.code(400).send({ hata: 'Durumu seçiniz.' });
    const verildigi: string | null = g.verildigi || k.vt || null; const tamamlanma: string | null = g.tamamlanma || k.tt || null;
    if ((verildigi && !TARIH.test(verildigi)) || (tamamlanma && !TARIH.test(tamamlanma))) return y.code(400).send({ hata: 'Tarihleri kontrol ediniz.' });
    if (durum === 'Görev Verildi' && !verildigi) return y.code(400).send({ hata: 'Verildiği tarih zorunludur.' });
    if (durum === 'Tamamlandı' && (!tamamlanma || !(g.kayitNo ?? k.kayit_no))) return y.code(400).send({ hata: 'Tamamlanma tarihi ve kayıt numarası zorunludur.' });
    await b.db.query(`UPDATE master_plan_karti SET durum = $2, verildigi_tarih = $3, tamamlanma_tarihi = $4, kayit_no = coalesce($5, kayit_no), ceo_notu = coalesce($6, ceo_notu), guncelleyen_ref = $7, zaman = now() WHERE islem_no = $1`, [no, durum, verildigi, tamamlanma, g.kayitNo?.trim() || null, g.ceoNotu?.trim() ?? null, o.kullanici]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Master Plan Kartı Güncellendi', nesneTuru: 'Master Plan', nesneKimligi: no, eski: { durum: k.durum }, yeni: { durum }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return { tamam: true };
  });

  // YG-1551: matris program içinden yönetilir; her değişiklik önceki ve sonraki değerle geçmişe yazılır; Excel'e dışa aktarma.
  s.get('/uyum-matrisi', oturumlu, async (i, y) => {
    const r = await roller(i.oturum!.kullanici); if (!r.some((x) => UYUM_GORUR.includes(x))) return yok(y);
    return {
      kurallar: (await b.db.query(`SELECT * FROM uyum_kurali ORDER BY mum_no`)).rows, yonetir: r.some((x) => UYUM_YONETIR.includes(x)),
      gecmis: (await b.db.query(`SELECT g.mum_no, g.onceki, g.sonraki, g.gerekce, g.zaman, h.ad_soyad FROM uyum_kurali_gecmisi g LEFT JOIN kullanici_hesabi h ON h.kimlik = g.degistiren_ref ORDER BY g.zaman DESC LIMIT 100`)).rows,
    };
  });
  s.post('/uyum-kurali', oturumlu, async (i, y) => {
    const o = i.oturum!; if (!(await roller(o.kullanici)).some((x) => UYUM_YONETIR.includes(x))) return yok(y);
    const g = (i.body ?? {}) as Record<string, unknown> & { gerekce?: string };
    const mum = String(g.mum_no ?? '').trim(); if (!/^MUM-\d{3,4}$/.test(mum)) return y.code(400).send({ hata: 'MUM numarası MUM-000 biçiminde olmalıdır.' });
    if (!String(g.yukumluluk ?? '').trim() || !String(g.gerekce ?? '').trim()) return y.code(400).send({ hata: 'Yükümlülük ve değişiklik gerekçesi zorunludur.' });
    const sure = g.sure_gun === undefined || g.sure_gun === '' ? 30 : Number(g.sure_gun); if (!Number.isInteger(sure) || sure < 0) return y.code(400).send({ hata: 'Süre (gün) tam sayı olmalıdır.' });
    const eski = (await b.db.query(`SELECT * FROM uyum_kurali WHERE mum_no = $1`, [mum])).rows[0] ?? null;
    const alan = UYUM_ALAN.map(([k]) => k).filter((k) => !['mum_no', 'engelleyici', 'sure_gun'].includes(k));
    const deger = alan.map((k) => (g[k] === undefined ? eski?.[k] ?? null : String(g[k]).trim() || null));
    const engel = g.engelleyici === undefined ? eski?.engelleyici ?? false : g.engelleyici === true;
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const sonraki = (await c.query(`INSERT INTO uyum_kurali (mum_no, ${alan.join(', ')}, engelleyici, sure_gun) VALUES ($1, ${alan.map((_, n) => `$${n + 2}`).join(', ')}, $${alan.length + 2}, $${alan.length + 3})
        ON CONFLICT (mum_no) DO UPDATE SET ${alan.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}, engelleyici = EXCLUDED.engelleyici, sure_gun = EXCLUDED.sure_gun RETURNING *`, [mum, ...deger, engel, sure])).rows[0];
      await c.query(`INSERT INTO uyum_kurali_gecmisi (mum_no, onceki, sonraki, degistiren_ref, gerekce) VALUES ($1,$2,$3,$4,$5)`, [mum, eski, sonraki, o.kullanici, String(g.gerekce).trim()]);
      await c.query('COMMIT');
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
    return { tamam: true, yeni: !eski };
  });
  s.get('/uyum-matrisi/excel', oturumlu, async (i, y) => {
    if (!(await roller(i.oturum!.kullanici)).some((x) => UYUM_GORUR.includes(x))) return yok(y);
    const l = (await b.db.query(`SELECT * FROM uyum_kurali ORDER BY mum_no`)).rows;
    const dosya = xlsxUret('Mevzuat Uyum Matrisi', UYUM_ALAN.map(([, a]) => a), l.map((r) => UYUM_ALAN.map(([k]) => (k === 'engelleyici' ? (r[k] ? 'Evet' : 'Hayır') : r[k] ?? null))));
    return y.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="LGM-Mevzuat-Uyum-Matrisi_${bugun()}.xlsx"`).send(dosya);
  });
}
