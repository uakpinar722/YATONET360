import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tod: 'Teknik ve Operasyon Direktörü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test88', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('toplu dışa aktarma (YG-755)', () => {
  it('Yönetici ve üstü; gerekçe zorunlu; hassas alan ek onaya gider; indirme dosya kimliğiyle bir kez', async () => {
    await o.dosyaAc(); await o.dosyaAc();
    expect((await o.ist('GET', '/api/disa-aktarim', await o.gir('ds'))).statusCode).toBe(404);
    const oy = await o.gir('oy'); const v = (await o.ist('GET', '/api/disa-aktarim', oy)).json();
    expect(v.setler.map((x: { ad: string }) => x.ad)).toEqual(['Dosyalar']);
    expect((await o.ist('POST', '/api/disa-aktarim', oy, { veriSeti: 'İş Emirleri', alanlar: ['is_emri_no'], amac: 'A', gerekce: 'G' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/disa-aktarim', oy, { veriSeti: 'Dosyalar', alanlar: ['dosya_no'], amac: 'A' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/disa-aktarim', oy, { veriSeti: 'Dosyalar', alanlar: ['dosya_no', 'sifre'], amac: 'A', gerekce: 'G' })).statusCode).toBe(400);
    const a = (await o.ist('POST', '/api/disa-aktarim', oy, { veriSeti: 'Dosyalar', alanlar: ['dosya_no', 'statu'], amac: 'Haftalık takip', gerekce: 'Toplantı' })).json(); expect(a).toMatchObject({ durum: 'Hazır', kayit: 2 });
    const r = await o.ist('GET', `/api/disa-aktarim/${a.kimlik}/indir`, oy); expect(r.statusCode).toBe(200); expect(r.body).toContain('Dosya No;Statü');
    const dk = r.headers['x-dosya-kimligi'] as string; expect((await o.sup.query(`SELECT kayit_sayisi, length(ozet_sha256) l FROM disa_aktarim_indirme WHERE dosya_kimligi = $1`, [dk])).rows[0]).toEqual({ kayit_sayisi: 2, l: 64 });
    expect((await o.ist('GET', `/api/disa-aktarim/${a.kimlik}/indir`, oy)).statusCode).toBe(409);
    expect((await o.ist('GET', `/api/disa-aktarim/${a.kimlik}/indir`, await o.gir('opm'))).statusCode).toBe(404);
    const h = (await o.ist('POST', '/api/disa-aktarim', oy, { veriSeti: 'Dosyalar', alanlar: ['dosya_no', 'telefon'], amac: 'Arama', gerekce: 'Memnuniyet' })).json(); expect(h.durum).toBe('Onayda');
    expect((await o.ist('GET', `/api/disa-aktarim/${h.kimlik}/indir`, oy)).statusCode).toBe(409);
    const k = (await o.kart('Toplu Dışa Aktarma Onayı', h.kimlik)).kimlik; expect((await o.karar(k, 'opm', 'Onayla')).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/disa-aktarim/${h.kimlik}/indir`, oy)).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/disa-aktarim', await o.gir('tod'))).json().setler.length).toBe(2);
  });
});
