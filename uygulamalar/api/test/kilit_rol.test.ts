import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { tod: 'Teknik ve Operasyon Direktörü', gmy: 'Genel Müdür Yardımcısı', cg: 'CEO', opm: 'Operasyon Müdürü', ds: 'Dosya Sorumlusu', ds2: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test84', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const rol = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;

describe('kilit rol ataması (YG-1480)', () => {
  it('boş kilit rol kırmızı; Direktör talebi GMY görüşü ve CEO onayıyla atanır; geçici vekil atanır ve onayda kapanır', async () => {
    const tm = await rol('Teknik Müdür'); const gmy = await o.gir('gmy');
    const l = (await o.ist('GET', '/api/kilit-rol', gmy)).json(); expect(l.talepEder).toBe(false);
    expect(l.roller.find((x: { kimlik: string }) => x.kimlik === tm).kirmizi).toBe(true);
    expect((await o.ist('GET', '/api/kilit-rol', await o.gir('ds'))).statusCode).toBe(404);
    const tod = await o.gir('tod'); const U = '/api/kilit-rol/talep';
    expect((await o.ist('POST', U, gmy, { rol: tm, aday: o.K.ds, gerekce: 'G' })).statusCode).toBe(404);
    expect((await o.ist('POST', U, tod, { rol: await rol('Dosya Sorumlusu'), aday: o.K.ds, gerekce: 'G' })).statusCode).toBe(400);
    expect((await o.ist('POST', U, tod, { rol: await rol('Operasyon Müdürü'), aday: o.K.ds, vekil: o.K.ds2, gerekce: 'G' })).statusCode).toBe(400);
    const r = await o.ist('POST', U, tod, { rol: tm, aday: o.K.ds, vekil: o.K.ds2, gerekce: 'Teknik Müdür boş' }); expect(r.statusCode, r.body).toBe(200);
    expect((await o.ist('POST', U, tod, { rol: tm, aday: o.K.ds, gerekce: 'Yine' })).statusCode).toBe(409);
    const v = (await o.ist('GET', '/api/kilit-rol', gmy)).json().roller.find((x: { kimlik: string }) => x.kimlik === tm); expect(v).toMatchObject({ kirmizi: true }); expect(v.vekil).toBeTruthy();
    const k = (await o.kart('Kilit Rol Ataması', r.json().kimlik)).kimlik;
    expect((await o.karar(k, 'gmy', 'Onaya Gönder')).statusCode).toBe(200); expect((await o.karar(k, 'cg', 'Onayla')).statusCode).toBe(200);
    const a = async (kim: string | undefined) => (await o.sup.query(`SELECT atama_durumu FROM rol_atamasi WHERE kullanici_ref = $1 AND rol_ref = $2`, [kim, tm])).rows[0]?.atama_durumu;
    expect(await a(o.K.ds)).toBe('Aktif'); expect(await a(o.K.ds2)).toBe('Kapalı');
    expect((await o.ist('GET', '/api/kilit-rol', await o.gir('cg'))).json().roller.find((x: { kimlik: string }) => x.kimlik === tm).kirmizi).toBe(false);
  });
});
