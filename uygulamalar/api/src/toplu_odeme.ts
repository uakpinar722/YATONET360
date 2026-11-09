import type { FastifyInstance, FastifyReply } from 'fastify';
import { izYaz } from './denetim.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { faturaTahsilatIsle } from './ticari.js';
import { UUID } from './yat.js';

const TICARI = 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)';
const R2 = (x: number) => Math.round(x * 100) / 100;

/** YG-902: sigortacının toplu ödemesi dağılım bildirimiyle faturalara dağıtılır; her dosyaya ayrı tahsilat yazılır, firma ödeme takvimi dosya bazında işler. */
export function topluOdemeYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const ticariMi = async (k: string) => Boolean((await b.db.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND x.rol_adi = $2 LIMIT 1`, [k, TICARI])).rowCount);

  s.get('/sigorta-toplu-odeme', oturumlu, async (i, y) => {
    if (!(await ticariMi(i.oturum!.kullanici))) return yok(y);
    const q = String((i.query as { sigortaci?: string }).sigortaci ?? '').trim();
    return {
      sigortacilar: (await b.db.query(`SELECT DISTINCT s.sigortaci_adi FROM musteri_faturasi f JOIN dosya_sigorta_kaydi s ON s.dosya_ref = f.dosya_ref WHERE f.muhatap = 'Sigorta Şirketi' AND f.durum IN ('Faturalandı', 'Kısmi Tahsil') AND s.sigortaci_adi IS NOT NULL ORDER BY 1`)).rows.map((r) => r.sigortaci_adi as string),
      faturalar: q ? (await b.db.query(`SELECT f.kimlik, f.fatura_no, f.proforma_no, d.dosya_no, f.toplam_eur, f.tahsil_edilen_eur FROM musteri_faturasi f JOIN dosya d ON d.kimlik = f.dosya_ref JOIN dosya_sigorta_kaydi s ON s.dosya_ref = f.dosya_ref WHERE f.muhatap = 'Sigorta Şirketi' AND f.durum IN ('Faturalandı', 'Kısmi Tahsil') AND lower(s.sigortaci_adi) = lower($1) ORDER BY f.vade NULLS LAST`, [q])).rows : [],
      odemeler: (await b.db.query(`SELECT kimlik, sigortaci_adi, toplam_eur, tarih::text, banka_referansi, bildirim_no FROM sigorta_toplu_odeme ORDER BY olusturma_zamani DESC LIMIT 50`)).rows,
    };
  });

  s.post('/sigorta-toplu-odeme', oturumlu, async (i, y) => {
    const o = i.oturum!; const g = (i.body ?? {}) as { sigortaci?: string; toplam?: unknown; tarih?: string; referans?: string; bildirim?: string; dagilim?: { fatura?: string; tutar?: unknown }[] };
    if (!(await ticariMi(o.kullanici))) return yok(y);
    const toplam = Number(g.toplam); const dag = g.dagilim ?? [];
    if (!g.sigortaci?.trim() || !(toplam > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih ?? '') || !g.referans?.trim() || !g.bildirim?.trim() || !dag.length) return y.code(400).send({ hata: 'Sigorta şirketi, toplam tutar, tarih, banka referansı, dağılım bildirimi numarası ve dağılım zorunludur.' });
    if (dag.some((d) => !d.fatura || !UUID.test(d.fatura) || !(Number(d.tutar) > 0)) || new Set(dag.map((d) => d.fatura)).size !== dag.length) return y.code(400).send({ hata: 'Dağılım satırları geçersizdir.' });
    if (R2(dag.reduce((t, d) => t + Number(d.tutar), 0)) !== R2(toplam)) return y.code(400).send({ hata: 'Dağılım toplamı ödeme tutarına eşit olmalıdır.' });
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const dur = async (k: number, h: string) => { await c.query('ROLLBACK'); return y.code(k).send({ hata: h }); };
      if ((await c.query(`SELECT 1 FROM sigorta_toplu_odeme WHERE banka_referansi = $1`, [g.referans.trim()])).rowCount) return dur(409, 'Bu banka referansı daha önce kaydedilmiştir.');
      const r = (await c.query(`INSERT INTO sigorta_toplu_odeme (sigortaci_adi, toplam_eur, tarih, banka_referansi, bildirim_no, giren_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kimlik`, [g.sigortaci.trim(), toplam, g.tarih, g.referans.trim(), g.bildirim.trim(), o.kullanici])).rows[0];
      for (const d of dag) {
        const f = (await c.query(`SELECT f.muhatap, s.sigortaci_adi FROM musteri_faturasi f LEFT JOIN dosya_sigorta_kaydi s ON s.dosya_ref = f.dosya_ref WHERE f.kimlik = $1`, [d.fatura])).rows[0];
        if (!f || f.muhatap !== 'Sigorta Şirketi' || String(f.sigortaci_adi ?? '').toLocaleLowerCase('tr') !== g.sigortaci.trim().toLocaleLowerCase('tr')) return dur(409, 'Dağılımdaki fatura bu sigorta şirketine ait değildir.');
        await faturaTahsilatIsle(c, { fatura: d.fatura!, tutar: Number(d.tutar), tarih: g.tarih!, kanal: 'Havale', referans: g.referans.trim(), giren: o.kullanici, topluOdeme: r.kimlik });
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Sigorta Toplu Ödemesi', nesneTuru: 'Toplu Ödeme', nesneKimligi: r.kimlik, yeni: { toplam, satir: dag.length }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: r.kimlik, dagitilan: dag.length };
    } catch (h) { await c.query('ROLLBACK').catch(() => {}); throw h; } finally { c.release(); }
  });
}
