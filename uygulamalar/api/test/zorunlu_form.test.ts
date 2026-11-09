import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zorunluFormlar } from '../src/zorunlu_form.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test79', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('zorunlu form seti (YG-635)', () => {
  it('teklif gönderilmemiş dosyada yalnız ilk aşama formları aranır; FR-TIC-001 yoktur', async () => {
    const d = await o.dosyaAc({}, {}); const l = await zorunluFormlar(o.db, d.kimlik);
    expect(l.map((x) => x.kod)).toEqual(['FR-OPS-009', 'FR-OPS-001', 'FR-OPS-002', 'FR-OPS-004']);
    expect(l.find((x) => x.kod === 'FR-OPS-002')!.var).toBe(true);
    expect(l.every((x) => x.kod !== 'FR-TIC-001')).toBe(true);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$3)`, [d.kimlik, o.K.ds, o.K.opm]);
    const r = await o.ist('GET', `/api/dosya/${d.kimlik}/zorunlu-formlar`, await o.gir('ds')); expect(r.statusCode).toBe(200); expect(r.json().length).toBe(4);
  });
});

describe('belge ayrıntıları ve arama (YG-683, YG-715, YG-1373)', () => {
  it('paket birimi Maktuen; ihbar iç kayıttır; arama Türkçe karakter gözetmez', async () => {
    const { hasarIhbarTanim, miktarYaz } = await import('../src/belge_uret.js');
    expect(miktarYaz({ miktar: 1, birim: 'Paket' }, 'tr')).toBe('Maktuen'); expect(miktarYaz({ miktar: 1, birim: 'paket' }, 'en')).toBe('Lump sum'); expect(miktarYaz({ miktar: 2, birim: 'Adet' }, 'tr')).toContain('Adet');
    const d = await o.dosyaAc({}, {}); const v = await hasarIhbarTanim(o.db, d.kimlik); expect(v.t).toMatchObject({ kod: 'FR-OPS-009', icKayit: true }); expect(v.t.bandEk?.map((x) => x.et)).toEqual(['Bildirim Zamanı', 'Kayıt Zamanı']);
    const n = async (a: string) => (await o.sup.query(`SELECT tr_norm($1) x`, [a])).rows[0].x; expect(await n('ŞANZIMAN')).toBe(await n('sanziman')); expect(await n('İSTANBUL')).toBe(await n('Istanbul'));
  });
});
