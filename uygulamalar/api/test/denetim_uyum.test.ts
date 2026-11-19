import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { denetimPlaniGorevi } from '../src/ic_denetim_ek.js';
import { sosyalMedyaIsle } from '../src/sosyal_medya.js';
import { uyumTaramaGorevi } from '../src/uyum_tarama.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ide: 'İç Denetçi', idm: 'İç Denetim Müdürü', cg: 'CEO', hud: 'Hukuk ve Uyum Direktörü', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü', skd: 'Strateji ve Kurumsal Gelişim Direktörü', ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test85', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('iç denetim planı ve bulgu takibi (YG-1676, YG-1680)', () => {
  it('Aralık görevi; plan CEO onayıyla yürürlüğe girer; bulgu Etkin takiple kapanır; Müdür CEO\'ya raporlar', async () => {
    expect(await denetimPlaniGorevi(o.db, new Date('2026-11-30T09:00:00'))).toBe(false);
    expect(await denetimPlaniGorevi(o.db, new Date('2026-12-01T09:00:00'))).toBe(true); expect(await denetimPlaniGorevi(o.db, new Date('2026-12-02T09:00:00'))).toBe(false);
    const idm = await o.gir('idm');
    expect((await o.ist('POST', '/api/ic-denetim/plan', await o.gir('ide'), { yil: 2027, surecler: ['Satın Alma'] })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/ic-denetim/plan', idm, { yil: 2027, surecler: [] })).statusCode).toBe(400);
    const p = (await o.ist('POST', '/api/ic-denetim/plan', idm, { yil: 2027, surecler: ['Satın Alma', 'Teklif'] })).json().kimlik as string;
    expect((await o.kart('İç Denetim Planı Hazırla', '2027')).durum).toBe('Tamamlandı');
    expect((await o.ist('POST', '/api/ic-denetim/plan', idm, { yil: 2027, surecler: ['X'] })).statusCode).toBe(409);
    expect((await o.karar((await o.kart('Yıllık İç Denetim Planı', p)).kimlik, 'cg', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM ic_denetim_plani WHERE kimlik = $1`, [p])).rows[0].durum).toBe('Yürürlükte');
    const ide = await o.gir('ide'); const G = { surec: 'Satın Alma', kapsam: 'K', cikarYok: true, sonOnIkiAyGorevYok: true };
    const a = (await o.ist('POST', '/api/ic-denetim', ide, G)).json().kimlik as string;
    await o.ist('POST', `/api/ic-denetim/${a}/bulgu`, ide, { sinif: 'Majör', tanim: 'T' });
    const bulgu = (await o.sup.query(`SELECT kimlik FROM ic_denetim_bulgu WHERE denetim_ref = $1`, [a])).rows[0].kimlik as string; const U = `/api/ic-denetim/bulgu/${bulgu}/takip`;
    expect((await o.ist('POST', U, ide, { sonuc: 'Etkin', not: 'N' })).statusCode).toBe(409);
    await o.ist('POST', `/api/ic-denetim/${a}/rapor`, ide, { ozet: 'Ö' });
    expect((await o.ist('POST', U, ide, { sonuc: 'Etkin' })).statusCode).toBe(400);
    expect((await o.ist('POST', U, ide, { sonuc: 'Etkin Değil', not: 'Düzeltme yok' })).statusCode).toBe(200);
    expect((await o.ist('POST', U, ide, { sonuc: 'Etkin', not: 'Düzeltildi' })).statusCode).toBe(200);
    expect((await o.ist('POST', U, ide, { sonuc: 'Etkin', not: 'Tekrar' })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/ic-denetim/bulgu-raporu', ide, {})).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/ic-denetim/bulgu-raporu', idm, {})).json()).toEqual({ acik: 0, kapandi: 1 });
    expect(Number((await o.sup.query(`SELECT count(*) n FROM bildirim WHERE kullanici_ref = $1 AND baslik = 'İç Denetim Bulgu Kapanış Durumu'`, [o.K.cg])).rows[0].n)).toBe(1);
  });
});

describe('Resmî Gazete taraması (YG-807)', () => {
  it('haftalık görev bir kez açılır; değişiklik kurala işlenir ve gözden geçirme görevi açılır; Ocak ve Temmuz matris görevi', async () => {
    expect(await uyumTaramaGorevi(o.db, new Date('2027-01-04T09:00:00'))).toBe(2); expect(await uyumTaramaGorevi(o.db, new Date('2027-01-05T09:00:00'))).toBe(0);
    const hud = await o.gir('hud'); const v = (await o.ist('GET', '/api/resmi-gazete', hud)).json(); expect(v.taramalar.length).toBe(1);
    expect((await o.ist('GET', '/api/resmi-gazete', await o.gir('ds'))).statusCode).toBe(404);
    const t = v.taramalar[0].kimlik; const mum = v.kurallar[0].mum_no;
    expect((await o.ist('POST', `/api/resmi-gazete/${t}`, hud, { sonuc: 'Değişiklik Var', mumlar: [mum] })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/resmi-gazete/${t}`, hud, { sonuc: 'Değişiklik Var', aciklama: 'Yönetmelik değişti', mumlar: [mum] })).json().gorev).toBe(1);
    expect((await o.kart('Resmî Gazete Taraması', t)).durum).toBe('Tamamlandı');
    expect(await o.kart('Uyum Kuralı Gözden Geçirme', `${t}:${mum}`)).toBeDefined();
    expect((await o.ist('POST', `/api/resmi-gazete/${t}`, hud, { sonuc: 'Değişiklik Yok' })).statusCode).toBe(409);
  });
});

describe('sosyal medya izleme kaydı (YG-586)', () => {
  it('personel bildirir; 2 saatte değerlendirilmezse uyarı; Müdür değerlendirir', async () => {
    const ds = await o.gir('ds');
    expect((await o.ist('POST', '/api/sosyal-medya', ds, { platform: 'X' })).statusCode).toBe(400);
    const r = (await o.ist('POST', '/api/sosyal-medya', ds, { platform: 'Instagram', ozet: 'Olumsuz yorum', tespit: new Date(Date.now() - 3 * 3_600_000).toISOString() })).json();
    expect(r.no).toMatch(/^SMK-/); expect((await o.ist('GET', '/api/sosyal-medya', ds)).statusCode).toBe(404);
    expect((await o.kart('Sosyal Medya Değerlendirmesi', r.kimlik)).sahip_rol_ref).toBeTruthy();
    expect(await sosyalMedyaIsle(o.db, new Date('2027-01-05T10:00:00'))).toBeGreaterThan(0);
    expect(Number((await o.sup.query(`SELECT count(*) n FROM bildirim WHERE kullanici_ref = ANY($1) AND baslik LIKE '2 Saatlik%'`, [[o.K.mpm, o.K.skd]])).rows[0].n)).toBe(2);
    const m = await o.gir('mpm'); expect((await o.ist('GET', '/api/sosyal-medya', m)).json()[0].gecikti).toBe(true);
    expect((await o.ist('POST', `/api/sosyal-medya/${r.kimlik}/degerlendir`, ds, { degerlendirme: 'D', sonuc: 'Kapatıldı' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/sosyal-medya/${r.kimlik}/degerlendir`, m, { degerlendirme: 'Müşteriyle görüşülecek', sonuc: 'Sözcüye İletildi' })).statusCode).toBe(200);
    expect((await o.kart('Sosyal Medya Değerlendirmesi', r.kimlik)).durum).toBe('Tamamlandı');
    expect(await sosyalMedyaIsle(o.db, new Date('2027-01-11T10:00:00'))).toBe(1);
    { // T-YG1466-SOZCU: sözcüye anlık bildirim, dosya eşleşmesi, onaylı şablonla yanıt ve Dosyalı'da DS araması
      expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [o.K.cg, `sosyal-olumsuz:${r.kimlik}`])).rows[0].n).toBe(1);
      const d = await o.dosyaAc(); await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
      const cg = await o.gir('cg');
      expect((await o.ist('GET', `/api/sosyal-medya/${r.kimlik}/yanit-metni?varyant=Dosyalı&dil=tr`, cg)).statusCode).toBe(409);
      expect((await o.ist('POST', `/api/sosyal-medya/${r.kimlik}/dosya`, m, { dosyaNo: d.dosyaNo })).statusCode).toBe(200);
      expect((await o.ist('GET', `/api/sosyal-medya/${r.kimlik}/yanit-metni?varyant=Dosyalı&dil=tr`, m)).statusCode).toBe(404);
      expect((await o.ist('GET', `/api/sosyal-medya/${r.kimlik}/yanit-metni?varyant=Dosyalı&dil=en`, cg)).json().metin).toContain('File Manager');
      expect((await o.ist('POST', `/api/sosyal-medya/${r.kimlik}/yanitlandi`, cg, { varyant: 'Dosyalı', dil: 'tr' })).statusCode).toBe(200);
      expect((await o.ist('POST', `/api/sosyal-medya/${r.kimlik}/yanitlandi`, cg, { varyant: 'Olumlu', dil: 'tr' })).statusCode).toBe(409);
      expect((await o.kart('Sosyal Medya Dosya Araması', d.kimlik)).sahip_kullanici_ref).toBe(o.K.ds);
    }
  });
});

describe('denetçi ataması ve sınırlı erişim (YG-1679)', () => {
  it('Müdür atar; denetçi süre içinde salt okunur izleri görür; süre dolunca erişim kapanır', async () => {
    const ide = await o.gir('ide'); const idm = await o.gir('idm');
    const d = (await o.ist('POST', '/api/ic-denetim', idm, { surec: 'Satın Alma', kapsam: 'Sipariş onayları', cikarYok: true, sonOnIkiAyGorevYok: true })).json().kimlik as string;
    expect((await o.ist('GET', `/api/ic-denetim/${d}/izler`, ide)).statusCode).toBe(403);
    const bitis = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await o.ist('POST', `/api/ic-denetim/${d}/ata`, ide, { denetci: o.K.ide, bitis, amac: 'Sipariş onay kontrolü' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/ic-denetim/${d}/ata`, idm, { denetci: o.K.ide, bitis: '2030-01-01', amac: 'x' })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/ic-denetim/${d}/ata`, idm, { denetci: o.K.ide, bitis, amac: 'Sipariş onay kontrolü' }); expect(r.statusCode, r.body).toBe(200);
    const z = await o.ist('GET', `/api/ic-denetim/${d}/izler`, ide); expect(z.statusCode, z.body).toBe(200); expect(Array.isArray(z.json())).toBe(true);
    await o.sup.query(`UPDATE ic_denetim SET erisim_bitis = current_date - 1 WHERE kimlik = $1`, [d]);
    expect((await o.ist('GET', `/api/ic-denetim/${d}/izler`, ide)).statusCode).toBe(403);
  });
});
