import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ozelGunler } from '../src/ozel_gun.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test101', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('Özel Günler (YG-1633)', () => {
  it('rıza vermeyen görünmez ve doğum günü giremez; rıza verenin doğum günü ve yıl dönümü görünür; yaş yok', async () => {
    const bugun = new Date(); const g = bugun.toISOString().slice(5, 10);
    for (const k of [o.K.ds, o.K.opm]) await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, guncelleyen_ref) VALUES ($1, (current_date - interval '2 years')::date, $1) ON CONFLICT (kullanici_ref) DO UPDATE SET ise_giris_tarihi = EXCLUDED.ise_giris_tarihi`, [k]);
    const ds = await o.gir('ds');
    expect((await o.ist('POST', '/api/ozel-gunler/dogum-gunu', ds, { gun: g })).statusCode).toBe(409);
    for (const t of ['Özel gün – Doğum günü paylaşımı', 'Özel gün – İşe giriş yıl dönümü paylaşımı']) await o.sup.query(`INSERT INTO acik_riza (ilgili_kisi_ref, riza_turu, kaynak, metin_surumu) VALUES ($1,$2,'İlk Giriş','R00')`, [o.K.ds, t]);
    expect((await o.ist('POST', '/api/ozel-gunler/dogum-gunu', ds, { gun: g })).statusCode).toBe(200);
    const l = await ozelGunler(o.db, bugun);
    expect(l.filter((x) => x.gun === g).map((x) => x.tur).sort()).toEqual(['Doğum Günü', 'İşe Giriş Yıl Dönümü (2. yıl)']);
    expect(JSON.stringify(l)).not.toMatch(/yaş|19\d\d|20\d\d/);
    expect((await o.ist('GET', '/api/ozel-gunler', await o.gir('opm'))).json().dogumGunuGirebilir).toBe(false);
  });
});
