import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aracAlanlari } from '../src/form_katalogu.js';
import { teklifMaddeleri } from '../src/teklif_madde.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test114', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('Ek II tamamlama (YG-632, YG-633, YG-666, YG-709)', () => {
  it('her etkin aracın sistem karşılığı ve sözlük alanı vardır', async () => {
    const k = (await o.sup.query(`SELECT kod, ad, sistem_karsiligi FROM form_katalogu WHERE durum <> 'İptal'`)).rows;
    expect(k.filter((x) => !x.sistem_karsiligi).map((x) => x.kod)).toEqual([]);
    expect(k.filter((x) => !x.kod.startsWith('PR-') && !aracAlanlari(x.kod, x.ad).length).map((x) => x.kod)).toEqual([]);
  });
  it('sözlükten üretilen form: liste ve zorunluluk doğrulanır, kayıt no ve sürüm taşır, onaylayan yoksa gönderimle onaylanır', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
    const ds = await o.gir('ds');
    expect((await o.ist('GET', '/api/form-genel', ds)).json().map((x: { kod: string }) => x.kod)).toContain('FR-MLZ-005');
    const t = (await o.ist('GET', `/api/form/FR-MLZ-005/tanim?dosya=${d.kimlik}`, ds)).json();
    const ht = t.alanlar.find((a: { teknik: string }) => a.teknik === 'hareket_turu'); expect(ht.secenekler.length).toBeGreaterThan(0);
    const V = { hareket_turu: ht.secenekler[0].id, yer_statu: 'Depo A', koruma: 'Kuru', omur: '12 ay', parti_stok: 'P-1', cikis_iade: 'Yok' };
    expect((await o.ist('POST', '/api/form-kaydi', ds, { kod: 'FR-MLZ-005', dosya: d.kimlik, veriler: { ...V, koruma: '' } })).json().hata).toMatch(/Koruma zorunludur/);
    expect((await o.ist('POST', '/api/form-kaydi', ds, { kod: 'FR-MLZ-005', dosya: d.kimlik, veriler: { ...V, hareket_turu: 'Uydurma' } })).statusCode).toBe(400);
    const r = (await o.ist('POST', '/api/form-kaydi', ds, { kod: 'FR-MLZ-005', dosya: d.kimlik, veriler: V })).json();
    expect(r.kayit_no).toBe(`${d.dosyaNo}-FR-MLZ-005-01`);
    expect((await o.ist('POST', `/api/form-kaydi/${r.kimlik}/gonder`, ds, {})).json().durum).toBe('Onaylı');
    expect((await o.ist('POST', `/api/form-kaydi/${r.kimlik}`, ds, { veriler: V })).statusCode).toBe(409);
  });
  it('onaylayanlı form kontrole gider; taslak araç seçilemez; boş şablon üretilir', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik);
    const oy = await o.gir('oy');
    const t = (await o.ist('GET', `/api/form/FR-UYG-006/tanim?dosya=${d.kimlik}`, oy)).json();
    const v = Object.fromEntries(t.alanlar.filter((a: { zorunlu: boolean }) => a.zorunlu).map((a: { teknik: string; secenekler?: { id: string }[] }) => [a.teknik, a.secenekler?.[0]?.id ?? 'Yazıldı']));
    const r = (await o.ist('POST', '/api/form-kaydi', oy, { kod: 'FR-UYG-006', dosya: d.kimlik, veriler: v })).json();
    const g = (await o.ist('POST', `/api/form-kaydi/${r.kimlik}/gonder`, oy, {})).json(); expect(g).toMatchObject({ durum: 'Kontrolde', gonderilecek: 'Operasyon Müdürü' });
    expect((await o.kart('Form Onayı', r.kimlik)).durum).toBe('Bekliyor');
    await o.sup.query(`UPDATE form_katalogu SET durum = 'Taslak' WHERE kod = 'FR-MLZ-001'`);
    expect((await o.ist('POST', '/api/form-kaydi', oy, { kod: 'FR-MLZ-001', dosya: d.kimlik, veriler: {} })).statusCode).toBe(409);
    const p = await o.ist('GET', '/api/form-katalogu/FR-ONR-003/bos.pdf', oy); expect(p.statusCode).toBe(200); expect(p.headers['content-type']).toContain('pdf');
    expect((await o.ist('GET', '/api/form-katalogu/FR-TIC-013/alanlar', oy)).json().alanlar.length).toBeGreaterThan(0);
  });
  it('013 maddeleri İngilizce teklifte İngilizce metinle', async () => {
    const d = await o.dosyaAc();
    const t = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) VALUES ($1,$2,'Yat Sahibi',20,'Taslak',1,0,1,1,$3) RETURNING kimlik`, [`${d.dosyaNo}-TK01`, d.kimlik, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO teklif_maddesi (teklif_ref, madde, tur, giren_ref) VALUES ($1,'DN-3','Hariç',$2)`, [t, o.K.ds]);
    expect(await teklifMaddeleri(o.db, t, 'en')).toEqual([{ tur: 'Excluded', metin: expect.stringContaining('before hot work') }]);
  });
});

describe('Ek II kod uyumu (YG-631, YG-646)', () => {
  it('üretilen belgelerdeki her form kodu katalogda yürürlükte ve adı katalogdaki adla başlar', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync(new URL('../src/belge_uret.ts', import.meta.url), 'utf-8');
    const kodlar = [...new Set([...s.matchAll(/kod: '([A-Z]{2}-[A-Z]{3}-[A-Z0-9]{3})'/g)].map((m) => m[1]!))];
    const k = new Map((await o.sup.query(`SELECT kod, durum FROM form_katalogu WHERE kod = ANY($1)`, [kodlar])).rows.map((r) => [r.kod, r.durum]));
    expect(kodlar.filter((x) => k.get(x) !== 'Yürürlükte')).toEqual([]);
  });
});
