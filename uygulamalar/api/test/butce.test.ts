import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

// CEO 06.11.2026: Kasım başında bilanço ve bütçe dönemi; Aralık 2. hafta nihai onay; Kasımda gelecek yıl takvimi.
const KADRO = { bceo: 'CEO', gmy: 'Genel Müdür Yardımcısı', tid: 'Ticari İşler Direktörü', hud: 'Hukuk ve Uyum Direktörü', mfm: 'Muhasebe ve Finans Müdürü', ikm: 'İnsan Kaynakları Müdürü', bim: 'Bilgi İşlem Müdürü', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test_butce', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('bilanço ve bütçe dönemi', () => {
  it('Kasım başında görevler ve dört toplantı açılır; tarihler kurala uyar; bir kez çalışır', async () => {
    const { butceDonemiIsle } = await import('../src/butce.js');
    expect(await butceDonemiIsle(o.db, new Date('2030-10-31T08:00:00Z'))).toBe(0);
    const n = await butceDonemiIsle(o.db, new Date('2030-11-01T06:00:00Z')); expect(n).toBeGreaterThan(10);
    expect(await butceDonemiIsle(o.db, new Date('2030-11-02T06:00:00Z'))).toBe(0);
    const t = (await o.sup.query(`SELECT tpl_kod, konu, to_char(baslangic AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') z, baskan_ref, duzenleyen_ref FROM toplanti WHERE konu LIKE '% 2031 Bütçe:%' ORDER BY baslangic`)).rows;
    expect(t.map((x) => x.z)).toEqual(['2030-11-06 10:00', '2030-11-20 10:00', '2030-12-04 10:00', '2030-12-11 10:00']);
    expect(t.map((x) => x.tpl_kod)).toEqual(['TPL-11', 'TPL-11', 'TPL-11', 'TPL-12']);
    const rolu = async (k: string) => (await o.sup.query(`SELECT r.rol_adi FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1`, [k])).rows.map((r) => r.rol_adi);
    expect(await rolu(t[0].baskan_ref)).toContain('CEO'); expect(t[1].baskan_ref).toBe(o.K.gmy); expect(await rolu(t[3].baskan_ref)).toContain('CEO'); expect(t[0].duzenleyen_ref).toBe(o.K.mfm);
    const kat = async (i: number) => (await o.sup.query(`SELECT kullanici_ref FROM toplanti_katilimci p JOIN toplanti t ON t.kimlik = p.toplanti_ref WHERE t.konu = $1`, [t[i].konu])).rows.map((r) => r.kullanici_ref);
    expect(await kat(1)).toEqual(expect.arrayContaining([o.K.gmy, o.K.tid, o.K.hud, o.K.mfm, o.K.ikm, o.K.bim])); expect(await kat(1)).not.toContain(o.K.ds); expect(await kat(1)).not.toContain(o.K.bceo); expect(await kat(0)).toContain(o.K.bceo);
    const g = (await o.sup.query(`SELECT baslik FROM is_karti WHERE tur = 'Bütçe Dönemi' AND nesne_kimligi = '2031'`)).rows.map((r) => r.baslik);
    expect(g).toEqual(expect.arrayContaining(['2031 Bütçe Varsayımları', '2031 Tatil ve Arife Takvimi', '2031 Birim Bütçe Talebi', '2031 Personel Planı', '2030 Cari Hesap Mutabakatları', '2030 Yıl Sonu Tahmini ve Bilanço Ön Çalışması', '2031 Konsolide Bütçe Taslağı']));
  });
  it('tatil günü toplantıyı aynı aralıkta ileri kaydırır', async () => {
    const { asamaTarihi, ASAMALAR } = await import('../src/butce.js');
    await o.sup.query(`INSERT INTO resmi_tatil (tarih, ad) VALUES ('2032-12-08', 'Deneme') ON CONFLICT DO NOTHING`);
    expect((await asamaTarihi(o.db, 2032, ASAMALAR[3]!, new Date('2032-11-01T06:00:00Z'))).toISOString()).toBe('2032-12-09T07:00:00.000Z');
  });
  it('Aralıkta gelecek yıl takvimi boşsa GMY\'ye görev, CEO\'ya bilgi; doluysa açılmaz', async () => {
    const { butceDonemiIsle } = await import('../src/butce.js');
    expect(await butceDonemiIsle(o.db, new Date('2033-12-01T06:00:00Z'))).toBe(1);
    const k = await o.kart('Tatil Takvimi Eksik', '2034'); expect(k.durum).toBe('Bekliyor'); expect(k.sahip_rol_ref).toBe((await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Genel Müdür Yardımcısı'`)).rows[0].kimlik);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND baslik = 'Bilgi: 2034 Tatil ve Arife Takvimi Girilmedi'`, [o.K.bceo])).rowCount).toBe(1);
    await o.sup.query(`INSERT INTO resmi_tatil (tarih, ad) VALUES ('2035-01-01', 'Yılbaşı') ON CONFLICT DO NOTHING`);
    expect(Number((await o.sup.query(`SELECT count(*) n FROM resmi_tatil WHERE extract(year FROM tarih) IN (2026, 2027)`)).rows[0].n)).toBe(33); // TAT-1 yüklü
    expect(await butceDonemiIsle(o.db, new Date('2034-12-01T06:00:00Z'))).toBe(0);
  });
  it('talep: birim kendi talebini girer, başkasınınkini görmez; CEO onaylar, sonra değişiklik yok', async () => {
    const u = '/api/butce/2031';
    expect((await o.ist('GET', u, await o.gir('ds'))).statusCode).toBe(404);
    const g = { kategori: 'Eğitim', aciklama: 'ISO eğitimi', tutar: 3000, gerekce: 'ISO 9001' };
    expect((await o.ist('POST', `${u}/talep`, await o.gir('hud'), { ...g, tutar: 0 })).statusCode).toBe(400);
    expect((await o.ist('POST', `${u}/talep`, await o.gir('hud'), g)).statusCode).toBe(200);
    expect((await o.ist('POST', `${u}/talep`, await o.gir('ikm'), { ...g, kategori: 'Personel', tutar: 1500.5 })).statusCode).toBe(200);
    const h = (await o.ist('GET', u, await o.gir('hud'))).json(); expect(h.talepler).toHaveLength(1);
    const c = (await o.ist('GET', u, await o.gir('bceo'))).json(); expect(c.talepler).toHaveLength(2); expect(c.kategoriToplam).toEqual(expect.arrayContaining([{ ad: 'Personel', tutarEur: 1500.5 }]));
    expect((await o.ist('POST', `${u}/onay`, await o.gir('gmy'), {})).statusCode).toBe(404);
    const r = await o.ist('POST', `${u}/onay`, await o.gir('bceo'), {}); expect(r.statusCode, r.body).toBe(200); expect(r.json().toplamEur).toBe(4500.5);
    expect((await o.ist('POST', `${u}/talep`, await o.gir('hud'), g)).statusCode).toBe(409);
    expect(Number((await o.sup.query(`SELECT count(*) n FROM is_karti WHERE tur = 'Bütçe Dönemi' AND nesne_kimligi = '2031' AND kapanma_zamani IS NULL`)).rows[0].n)).toBe(0);
  });
});
