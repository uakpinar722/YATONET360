import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alanKuraliYenile, alanSuz, type AlanKurali } from '../src/alan.js';
import { Depo, kritikAnahtari } from '../src/depo.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', iks: 'İnsan Kaynakları Sorumlusu', hud: 'Hukuk ve Uyum Direktörü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test52', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('alan erişim katmanı (AK-1a)', () => {
  const K = new Map<string, AlanKurali>([['ucret', { alan: 'ucret', davranis: 'Gizle', yasak_gruplar: [], yalniz_roller: ['İK'] }], ['unvan', { alan: 'unvan', davranis: 'Gizle', yasak_gruplar: ['Bireysel'], yalniz_roller: [] }], ['iban', { alan: 'iban', davranis: 'Maskele', yasak_gruplar: [], yalniz_roller: ['Mali'] }]]);
  it('iç içe yapıda gizler ve maskeler; yetkiliye dokunmaz; tarih bozulmaz', () => {
    const z = new Date(); const G = { ucret: 1, unvan: 'F', iban: 'TR123456', a: [{ ucret: 2, b: { iban: 'TR99887766', z } }] };
    expect(alanSuz(G, K, { grup: 'Bireysel Müşteri', roller: [] })).toEqual({ iban: '******56', a: [{ b: { iban: '********66', z } }] });
    expect(alanSuz(G, K, { grup: 'LGM İç Rolü', roller: ['İK', 'Mali'] })).toEqual(G);
  });
  it('kural tabloya eklenince yanıttan düşer; yetkili görür', async () => {
    await o.sup.query(`INSERT INTO alan_erisim_kurali (alan, davranis, yalniz_roller, aciklama) VALUES ('grup', 'Gizle', '{Hukuk ve Uyum Direktörü}', 'Sınama')`); alanKuraliYenile();
    expect((await o.ist('GET', '/api/saklama-plani', await o.gir('ds'))).json()[0]).not.toHaveProperty('grup');
    expect((await o.ist('GET', '/api/saklama-plani', await o.gir('hud'))).json()[0]).toHaveProperty('grup');
    await o.sup.query(`DELETE FROM alan_erisim_kurali WHERE alan = 'grup'`); alanKuraliYenile();
  });
  it('ücret yalnız yetkiliye', async () => {
    await o.ist('POST', `/api/ik/personel/${o.K.ds}`, await o.gir('iks'), { iseGiris: '2020-01-01', brut: 50000 });
    const r = (await o.ist('GET', '/api/ik/personel', await o.gir('iks'))).json().find((x: { kimlik: string }) => x.kimlik === o.K.ds); expect(r.brut_aylik_tl).toBe('50000.00');
  });
});

describe('Kritik belge şifreleme (DEP-1a, YG-1196)', () => {
  it('diskte şifreli, okuyunca özgün; yanlış anahtar açmaz', async () => {
    const kok = mkdtempSync(join(tmpdir(), 'dp-')); const d = new Depo(kok); kritikAnahtari('ab'.repeat(32)); const ic = randomBytes(2000); const gec = join(kok, 'gecici', 'x'); writeFileSync(gec, ic);
    const a = d.yerlestirKritik(gec, 'abcdef0123'); expect(a.startsWith('kritik/')).toBe(true); expect(existsSync(gec)).toBe(false);
    const ham = readFileSync(join(kok, a)); expect(ham.includes(ic.subarray(0, 64))).toBe(false);
    const parca: Buffer[] = []; for await (const c of d.bagla(a)) parca.push(c as Buffer); expect(Buffer.concat(parca).equals(ic)).toBe(true);
    kritikAnahtari('cd'.repeat(32)); await expect((async () => { for await (const _ of d.bagla(a)) { /* */ } })()).rejects.toThrow(); kritikAnahtari('ab'.repeat(32));
  });
});
