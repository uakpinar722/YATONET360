import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ozDenetimCalistir, ozDenetimGunuMu, SENARYOLAR, senaryoSec, type Senaryo } from '../src/oz_denetim.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { bim: 'Bilgi İşlem Müdürü', sy: 'Sistem Yöneticisi', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test121', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('sistem öz denetimi (YG-1652)', () => {
  it('beş farklı süreçten seçer; döngüde tekrar etmez; bulgulu süreç önce gelir', () => {
    const a = senaryoSec(SENARYOLAR, new Set(), []);
    expect(a.secim).toHaveLength(5); expect(new Set(a.secim.map((x) => x.surec)).size).toBe(5); expect(a.yeniDongu).toBe(false);
    const b = senaryoSec(SENARYOLAR, new Set(a.secim.map((x) => x.kod)), ['Tedarik']);
    expect(b.secim[0]!.surec).toBe('Tedarik'); expect(b.secim.some((x) => a.secim.some((y) => y.kod === x.kod))).toBe(false);
    const c = senaryoSec(SENARYOLAR, new Set(SENARYOLAR.map((x) => x.kod)), []); expect(c.yeniDongu).toBe(true); expect(c.secim).toHaveLength(5);
  });
  it('sıklık: 0–3 ay her gece, 3–6 ay Pzt/Çrş/Cuma, 6–12 ay Pazartesi, sonra 15 günde bir; başlangıç yoksa çalışmaz', () => {
    const g = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(ozDenetimGunuMu(0, g('2027-01-05'))).toBe(false);
    expect(ozDenetimGunuMu(20270101, g('2027-02-07'))).toBe(true); // Pazar, ilk 3 ay
    expect(ozDenetimGunuMu(20270101, g('2027-05-04'))).toBe(false); // Salı, 3–6 ay
    expect(ozDenetimGunuMu(20270101, g('2027-05-05'))).toBe(true); // Çarşamba
    expect(ozDenetimGunuMu(20270101, g('2027-08-04'))).toBe(false); // Çarşamba, 6–12 ay
    expect(ozDenetimGunuMu(20270101, g('2027-08-02'))).toBe(true); // Pazartesi
    expect(ozDenetimGunuMu(20270101, g('2028-01-16'))).toBe(Math.round((Date.UTC(2028, 0, 16) - Date.UTC(2027, 0, 1)) / 86_400_000) % 15 === 0);
  });
  it('sentetik ortamda beş senaryo çalışır; sonuç ve özet kaydedilir (T-YG1652)', async () => {
    const c = (await o.sup.query(`INSERT INTO oz_denetim_calismasi (calisma_no, tur) VALUES ('ODN-T-1','Kural Değişikliği') RETURNING kimlik`)).rows[0].kimlik;
    expect(await ozDenetimCalistir(o.db, c, { vt: 'yatonet360_test121oz' })).toBe('Başarılı');
    const s = (await o.sup.query(`SELECT surec, basarili, gerceklesen FROM oz_denetim_sonucu WHERE calisma_ref = $1`, [c])).rows;
    expect(s, JSON.stringify(s)).toHaveLength(5); expect(s.every((x) => x.basarili)).toBe(true); expect(new Set(s.map((x) => x.surec)).size).toBe(5);
    expect((await o.sup.query(`SELECT 1 FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE '%Öz Denetim Başarılı'`, [o.K.bim])).rowCount).toBe(1);
  }, 300_000);
  it('başarısız senaryo bulgu (PRB), sabit set, yetki bulgusunda acil kart açar; sürüm öncesi notu yazılır', async () => {
    const yanlis: Senaryo = { kod: 'OD-T-99', surec: 'Bilgi İşlem', ad: 'Deneme ihlali', tur: 'Kural İhlali Denemesi', bulgu: 'Yetki', beklenen: 'Reddedilir', calistir: async () => ({ basarili: false, gerceklesen: 'HTTP 200' }) };
    const y = (await o.sup.query(`INSERT INTO yayin_seti (surum, ortam, paket_ozeti, bilesenler, degisiklikler, durum, hazirlayan_ref) VALUES ('OZ1','Test',$1,'{}'::jsonb,'{}'::uuid[],'Hazırlandı',$2) RETURNING kimlik`, ['c'.repeat(64), o.K.sy])).rows[0].kimlik;
    const c = (await o.sup.query(`INSERT INTO oz_denetim_calismasi (calisma_no, tur, yayin_ref) VALUES ('ODN-T-2','Sürüm Öncesi',$1) RETURNING kimlik`, [y])).rows[0].kimlik;
    expect(await ozDenetimCalistir(o.db, c, { vt: 'yatonet360_test121oz', havuz: [yanlis] })).toBe('Başarısız');
    expect((await o.sup.query(`SELECT aciklama FROM oz_denetim_calismasi WHERE kimlik = $1`, [c])).rows[0].aciklama).toContain('yayına alınmamıştır');
    const b = (await o.sup.query(`SELECT g.bulgu_no, g.sorumlu_ref FROM oz_denetim_sonucu s JOIN sistem_bulgusu g ON g.kimlik = s.bulgu_ref WHERE s.calisma_ref = $1`, [c])).rows[0];
    expect(b.bulgu_no).toMatch(/^PRB-\d{4}-\d{4}$/); expect((await o.sup.query(`SELECT 1 FROM rol_atamasi a JOIN rol x ON x.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND x.rol_adi = 'Bilgi İşlem Müdürü'`, [b.sorumlu_ref])).rowCount).toBe(1);
    expect((await o.sup.query(`SELECT 1 FROM oz_denetim_sabit_set WHERE senaryo_kodu = 'OD-T-99'`)).rowCount).toBe(1);
    expect((await o.kart('Öz Denetim Acil Bulgu', c)).oncelik).toBe('Kritik');
    // Liste ve yetki
    const l = (await o.ist('GET', '/api/oz-denetim', await o.gir('bim'))).json(); expect(l.calismalar.find((x: { kimlik: string }) => x.kimlik === c).sonuclar).toHaveLength(1);
    expect((await o.ist('GET', '/api/oz-denetim', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/oz-denetim', await o.gir('sy'), { tur: 'Sürüm Öncesi' })).statusCode).toBe(400);
  }, 300_000);
});
