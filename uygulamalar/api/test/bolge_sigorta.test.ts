import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bolgeTuret, telefonBicimi } from '../src/ana_veri.js';
import { pazarlamaAdimi, sigortaPortalGorevi } from '../src/sigorta_kurum.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test81', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('telefon ve bölge (YG-1258, YG-1264, YG-1265)', () => {
  it('telefon biçimlenir, çözülemeyen null döner', () => {
    expect(telefonBicimi('5333516530')).toBe('0533 351 65 30'); expect(telefonBicimi('0 533 748 15 59')).toBe('0533 748 15 59'); expect(telefonBicimi('+90 212 555 11 22')).toBe('0212 555 11 22'); expect(telefonBicimi('1234')).toBeNull(); expect(telefonBicimi(null)).toBeNull();
  });
  it('firma ilçe eşleşmesinden, yoksa il varsayılanından bölge alır', async () => {
    await o.sup.query(`INSERT INTO bolge_eslesme (il, ilce, bolge, hizmet_kumesi, saha_merkezi) VALUES ('Çanakkale','Biga','1. Marmara','Saros','Tuzla')`);
    await o.sup.query(`INSERT INTO il_varsayilan (il, bolge, hizmet_kumesi) VALUES ('Çanakkale','1. Marmara','Varsayılan Küme')`);
    const ek = async (ilce: string, n: number) => (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, il, ilce, olusturan_ref) VALUES ($1,'F','Çözüm Ortağı','Çanakkale',$2,$3) RETURNING kimlik`, [`S-B${n}`, ilce, o.K.ds])).rows[0].kimlik as string;
    const a = await ek('BİGA', 1); const c = await ek('Bilinmeyen', 2);
    expect(await bolgeTuret(o.db)).toBeGreaterThanOrEqual(2);
    const g = async (k: string) => (await o.sup.query(`SELECT bolge, hizmet_kumesi, saha_merkezi FROM kurulus WHERE kimlik = $1`, [k])).rows[0];
    expect(await g(a)).toEqual({ bolge: '1. Marmara', hizmet_kumesi: 'Saros', saha_merkezi: 'Tuzla' }); expect((await g(c)).hizmet_kumesi).toBe('Varsayılan Küme');
  });
});

describe('sigorta kurum kartı (YG-441, YG-442)', () => {
  it('kendi portalında adres zorunlu; teklif gidince 8 saatlik yükleme görevi; kayıtla kapanır', async () => {
    const m = await o.gir('mpm'); expect((await o.ist('POST', '/api/sigorta-kurum', await o.gir('ds'), { ad: 'A', kanal: 'E-posta Şablonu' })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/sigorta-kurum', m, { ad: 'SgP', kanal: 'Kendi Portalı' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/sigorta-kurum', m, { ad: 'SgP', kanal: 'Kendi Portalı', portal: 'https://p.local', paket: 'PDF+ZIP' })).statusCode).toBe(200);
    const d = (await o.dosyaAc({}, {})).kimlik as string; await o.sup.query(`UPDATE dosya SET dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d, o.K.ds]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Dosya Sorumlusu',$2)`, [d, o.K.ds]);
    await o.sup.query(`INSERT INTO dosya_sigorta_kaydi (dosya_ref, sigortaci_adi, olusturan_ref) VALUES ($1,'SGP',$2)`, [d, o.K.ds]);
    const t = (await o.sup.query(`INSERT INTO kapsam_cetveli (dosya_ref, surum, hazirlayan_ref) VALUES ($1,1,$2) RETURNING kimlik`, [d, o.K.ds])).rows[0].kimlik;
    const f = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, cetvel_ref, teklif_muhatabi, teklif_dili, kdv_orani, odeme_vadesi, fatura_bilgisi, hazirlayan_ref, gonderim_zamani) VALUES ('T-P1',$1,$2,'Sigorta Şirketi','Türkçe',20,'30 gün','F',$3,now()) RETURNING kimlik`, [d, t, o.K.ds])).rows[0].kimlik as string;
    expect(await sigortaPortalGorevi(o.db)).toBe(1); expect(await sigortaPortalGorevi(o.db)).toBe(0);
    const ds = await o.gir('ds'); const u = `/api/dosya/${d}/sigorta-portal-yukleme`; expect((await o.ist('POST', u, ds, { teklif: f })).statusCode).toBe(400); expect((await o.ist('POST', u, ds, { teklif: f, referans: 'R1' })).statusCode).toBe(200); expect((await o.ist('POST', u, ds, { teklif: f, referans: 'R1' })).statusCode).toBe(409);
    expect((await o.kart('Sigorta Portalına Yükleme', f)).durum).toBe('Tamamlandı');
  });
});

describe('pazarlama sorusu (YG-1209)', () => {
  it('talepte sorulur; Şimdilik Geç ise teslimde bir kez daha; sonra sorulmaz', () => {
    const G = { izinVar: false, dosyaVar: true, teslimVar: false, talep: null, teslim: null };
    expect(pazarlamaAdimi(G)).toBe('Talep'); expect(pazarlamaAdimi({ ...G, dosyaVar: false })).toBeNull(); expect(pazarlamaAdimi({ ...G, izinVar: true })).toBeNull();
    expect(pazarlamaAdimi({ ...G, talep: 'Şimdilik Geç' })).toBeNull(); expect(pazarlamaAdimi({ ...G, talep: 'Şimdilik Geç', teslimVar: true })).toBe('Teslim');
    expect(pazarlamaAdimi({ ...G, talep: 'Şimdilik Geç', teslimVar: true, teslim: 'Şimdilik Geç' })).toBeNull(); expect(pazarlamaAdimi({ ...G, talep: 'Onay', teslimVar: true })).toBeNull();
  });
});
