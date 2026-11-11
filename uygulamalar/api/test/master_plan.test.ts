import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kartRengi, masterPlanAktar } from '../src/master_plan.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { cg: 'CEO', gmy: 'Genel Müdür Yardımcısı', hud: 'Hukuk ve Uyum Direktörü', tid: 'Ticari İşler Direktörü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test96', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

const kart = (no: string, muhatap: string, hedef: string) => ({ islem_no: no, faz: 'F1 – Kuruluş', yapilacak: 'İş', muhatap, hedef_tarih: hedef });
describe('Master Plan takip listesi (YG-776)', () => {
  it('aktarım bir kez; renk, özet; muhatap yalnız kendi kartını görür; CEO notunu yalnız CEO yazar', async () => {
    expect(await masterPlanAktar(o.db, [kart('İŞLEM NO-001', 'Ticari İşler Direktörü', '2020-01-01'), kart('İŞLEM NO-002', 'Hukuk ve Uyum Direktörü', '2099-01-01')])).toBe(2);
    expect(await masterPlanAktar(o.db, [kart('İŞLEM NO-001', 'Başka', '2020-01-01')])).toBe(0);
    expect(kartRengi({ durum: 'Tamamlandı', hedef_tarih: '2020-01-01' })).toBe('yesil'); expect(kartRengi({ durum: 'Sürüyor', hedef_tarih: '2020-01-01' })).toBe('kirmizi');
    const g = (await o.ist('GET', '/api/master-plan', await o.gir('gmy'))).json();
    expect(g.kartlar).toHaveLength(2); expect(g.faz[0]).toMatchObject({ kart: 2, gecikti: 1 });
    const t = (await o.ist('GET', '/api/master-plan', await o.gir('tid'))).json();
    expect(t.kartlar.map((k: { islem_no: string }) => k.islem_no)).toEqual(['İŞLEM NO-001']);
    const tid = await o.gir('tid'); const u = encodeURIComponent('İŞLEM NO-001');
    expect((await o.ist('POST', `/api/master-plan/${u}`, tid, { ceoNotu: 'x' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/master-plan/${u}`, tid, { durum: 'Tamamlandı', tamamlanma: '2026-11-10' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/master-plan/${u}`, tid, { durum: 'Tamamlandı', tamamlanma: '2026-11-10', kayitNo: 'K-1' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/master-plan/${u}`, await o.gir('cg'), { ceoNotu: 'Teşekkürler' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM master_plan_gecmisi WHERE islem_no = 'İŞLEM NO-001'`)).rows[0].n).toBe(2);
    expect((await o.ist('POST', `/api/master-plan/${encodeURIComponent('İŞLEM NO-002')}`, tid, { durum: 'Sürüyor' })).statusCode).toBe(404);
  });
});

describe('Mevzuat Uyum Matrisi yönetimi (YG-1551)', () => {
  it('Hukuk ve Uyum değiştirir, geçmişe yazılır; Excel indirilir; yetkisiz göremez', async () => {
    const hud = await o.gir('hud');
    const v = (await o.ist('GET', '/api/uyum-matrisi', hud)).json(); expect(v.kurallar.length).toBeGreaterThan(0); expect(v.yonetir).toBe(true);
    const ilk = v.kurallar[0];
    expect((await o.ist('POST', '/api/uyum-kurali', hud, { mum_no: ilk.mum_no, yukumluluk: 'Güncel yükümlülük' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/uyum-kurali', hud, { mum_no: ilk.mum_no, yukumluluk: 'Güncel yükümlülük', gerekce: 'Mevzuat değişti' })).json()).toEqual({ tamam: true, yeni: false });
    const g = (await o.sup.query(`SELECT onceki->>'yukumluluk' o, sonraki->>'yukumluluk' s FROM uyum_kurali_gecmisi WHERE mum_no = $1`, [ilk.mum_no])).rows[0];
    expect(g).toEqual({ o: ilk.yukumluluk, s: 'Güncel yükümlülük' });
    const x = await o.ist('GET', '/api/uyum-matrisi/excel', hud); expect(x.statusCode).toBe(200); expect(x.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect((await o.ist('GET', '/api/uyum-matrisi', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/uyum-kurali', await o.gir('cg'), { mum_no: 'MUM-999', yukumluluk: 'x', gerekce: 'y' })).statusCode).toBe(404);
  });
});
