import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { butceSapmaIsle, kdvOzeti } from '../src/yonetim_takip.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { cg: 'CEO', tid: 'Ticari İşler Direktörü', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü', mfm: 'Muhasebe ve Finans Müdürü', ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', skg: 'Strateji ve Kurumsal Gelişim Direktörü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test98', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('ön muhasebe raporları, gözden geçirmeler, yönetim değerlendirmesi, satış görüşmeleri (YG-763, 771, 774, 805)', () => {
  it('KDV/tevkifat özeti fatura tarihine göre toplanır; bütçe-gerçekleşme yalnız mali rollere', async () => {
    const d = await o.dosyaAc();
    await o.sup.query(`INSERT INTO musteri_faturasi (proforma_no, dosya_ref, muhatap, kdv_haric_eur, kdv_eur, toplam_eur, durum, fatura_no, fatura_tarihi, hazirlayan_ref, kdv_orani, tevkifat_eur) VALUES ('PF-K1',$1,'Sigorta Şirketi',1000,200,1200,'Faturalandı','F-1','2026-10-10',$2,20,40)`, [d.kimlik, o.K.ds]);
    const k = await kdvOzeti(o.db, '2026-10');
    expect(k.toplam).toMatchObject({ matrah: 1000, kdv: 200, tevkifat: 40, beyan: 160 });
    expect((await o.ist('GET', '/api/on-muhasebe/butce-gerceklesme?yil=2026', await o.gir('mfm'))).json().gelir).toBe(1000);
    expect((await o.ist('GET', '/api/on-muhasebe/kdv-ozeti', await o.gir('ds'))).statusCode).toBe(404);
  });
  it('bütçede %10 üzeri sapmada Ticari İşler Direktörü bir kez uyarılır (T-YG919-SAPMA)', async () => {
    await o.sup.query(`INSERT INTO butce_donemi (yil, durum) VALUES (2031, 'Onaylandı') ON CONFLICT (yil) DO UPDATE SET durum = 'Onaylandı'`);
    await o.sup.query(`INSERT INTO butce_talebi (yil, birim, kategori, aciklama, tutar_eur, gerekce, giren_ref) VALUES (2031, 'Operasyon Müdürlüğü', 'Diğer', 'Hizmet', 1000, 'G', $1)`, [o.K.tid]);
    const d = await o.dosyaAc();
    const f = (await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-BS1','Sapma Firma','Çözüm Ortağı',$1) RETURNING kimlik`, [o.K.ds])).rows[0].kimlik;
    const e = (await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Y','K','Aktif',$4) RETURNING kimlik`, [`${d.dosyaNo}-ON91`, d.kimlik, f, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`INSERT INTO hakedis (hakedis_no, is_emri_ref, dosya_ref, sira_no, bu_donem_brut, kumulatif, kesinti, net, statu, giren_ref, olusturma_zamani) VALUES ($1,$2,$3,1,800,800,0,800,'Doğrulandı',$4,'2031-03-01')`, [`${d.dosyaNo}-HK91`, e, d.kimlik, o.K.ds]);
    const t = new Date('2031-06-30T12:00:00Z');
    expect(await butceSapmaIsle(o.db, t)).toBe(1); expect(await butceSapmaIsle(o.db, t)).toBe(0);
    expect((await o.sup.query(`SELECT ozet FROM bildirim WHERE kullanici_ref = $1 AND baslik = 'Bütçe Sapması · Operasyon Müdürlüğü'`, [o.K.tid])).rows[0].ozet).toContain('800,00 EUR');
  });
  it('gözden geçirmeler yöneticide görünür, personelde kapalı; yönetim değerlendirmesi kaynak kayıtlarla gelir', async () => {
    await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref, sonraki_gozden_gecirme_tarihi) VALUES ('S-GG1','Gözden Firma','Çözüm Ortağı',$1, current_date - 2)`, [o.K.ds]);
    const l = (await o.ist('GET', '/api/gozden-gecirmeler', await o.gir('opm'))).json();
    expect(l.some((x: { konu: string; gecikti: boolean }) => x.konu === 'Gözden Firma' && x.gecikti)).toBe(true);
    expect((await o.ist('GET', '/api/gozden-gecirmeler', await o.gir('ds'))).statusCode).toBe(404);
    const y = (await o.ist('GET', '/api/yonetim-degerlendirmesi', await o.gir('skg'))).json();
    for (const k of ['guvenlikOlaylari', 'surekliliktestleri', 'destekTalepleri', 'denetimBulgulari', 'istisnalar', 'acikDuzelticiEylemler']) expect(y[k]).toHaveProperty('kayitlar');
  });
  it('görüşme hedefi yalnız TİD/GMY/CEO girer; gerçekleşen sayılır; gelecek tarihli görüşme kaydedilmez', async () => {
    const donem = new Date().toISOString().slice(0, 7); const bugun = new Date().toISOString().slice(0, 10);
    expect((await o.ist('POST', '/api/satis-hedefi', await o.gir('mpm'), { donem, kullanici: o.K.mpm, hedef: 4 })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/satis-hedefi', await o.gir('tid'), { donem, kullanici: o.K.mpm, hedef: 4 })).statusCode).toBe(200);
    const mpm = await o.gir('mpm');
    expect((await o.ist('POST', '/api/satis-gorusmesi', mpm, { tarih: '2099-01-01', kurum: 'A Sigorta', kurumTuru: 'Sigorta Şirketi', tur: 'Telefon', sonuc: 'Tanışma' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/satis-gorusmesi', mpm, { tarih: bugun, kurum: 'A Sigorta', kurumTuru: 'Sigorta Şirketi', tur: 'Telefon', sonuc: 'Tanışma' })).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/satis-gorusmeleri?donem=${donem}`, mpm)).json().ozet[0]).toMatchObject({ hedef: 4, gerceklesen: 1, oran: 25 });
  });
});
