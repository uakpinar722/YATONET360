import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { katalogDurumu } from '../src/ana_veri_ek.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { sic: 'Sicil Sorumlusu', tu: 'Teknik Uzman', ds: 'Dosya Sorumlusu' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test108', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('ana veri kalemleri (YG-1266, 1532, 1533, 1535)', () => {
  it('katalog durumu kendiliğinden hesaplanır', () => {
    expect(katalogDurumu(true, true)).toBe('Tamam'); expect(katalogDurumu(false, true)).toBe('Fotoğraf eksik'); expect(katalogDurumu(true, false)).toBe('Teknik eksik'); expect(katalogDurumu(false, false)).toBe('Fotoğraf ve teknik eksik');
  });
  it('bağlama noktası teyidinde koordinat ve mükerrer kararı aranır', async () => {
    const n = (await o.sup.query(`INSERT INTO baglama_noktasi (nokta_no, tur, il, ad, mukerrer_grubu, mukerrer_karari, uyari) VALUES (99001,'Marina','Muğla','Test Marina','G1','Karar bekliyor','Göl kıyısı') RETURNING kimlik`)).rows[0].kimlik;
    const sic = await o.gir('sic'); const bugun = new Date().toISOString().slice(0, 10);
    expect((await o.ist('POST', `/api/baglama-noktasi/${n}/teyit`, sic, { teyitDurumu: 'Teyit edildi', sonTeyit: bugun, enlem: 50, boylam: 28 })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/baglama-noktasi/${n}/teyit`, sic, { teyitDurumu: 'Teyit edildi', sonTeyit: bugun, enlem: 37.03, boylam: 27.43 })).statusCode).toBe(409);
    await o.sup.query(`UPDATE baglama_noktasi SET mukerrer_karari = 'Ayrı Kayıt' WHERE kimlik = $1`, [n]);
    expect((await o.ist('POST', `/api/baglama-noktasi/${n}/teyit`, sic, { teyitDurumu: 'Teyit edildi', sonTeyit: bugun, enlem: 37.03, boylam: 27.43 })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/baglama-noktasi/${n}/teyit`, await o.gir('ds'), { teyitDurumu: 'Teyit edildi', sonTeyit: bugun })).statusCode).toBe(404);
  });
  it('model referansı yalnız LGM; Teknik Uzman keşif bilgisini işler, durum güncellenir; branş önerisi kartela adlarından', async () => {
    const d = await o.dosyaAc();
    const m = (await o.sup.query(`INSERT INTO yat_marka_model (marka_kodu, marka, model, tekne_turu, govde_malzemesi, tahrik_turu, fotograf, teknik_veri, durum, kaynak) VALUES ('TST','Test Marka','Model X','Motoryat','Fiber','2 × dizel 300 hp','Yok','Yok','Fotoğraf ve teknik eksik','LGM-2026-012') RETURNING kimlik`)).rows[0].kimlik;
    await o.sup.query(`UPDATE yat SET marka_model_ref = $2 WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik, m]);
    await o.sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,'Teknik Uzman',$2)`, [d.kimlik, o.K.tu]);
    const tu = await o.gir('tu');
    const r = (await o.ist('GET', `/api/dosya/${d.kimlik}/katalog-referansi`, tu)).json();
    expect(r.model.model).toBe('Model X'); expect(r.teknik).toBe(true);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/katalog-bilgisi`, tu, { kaynak: 'Ruhsat / plaka' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/katalog-bilgisi`, tu, { kaynak: 'Ruhsat / plaka', teknikBilgi: 'Boy 14,2 m; 2 × 300 hp' })).json().durum).toBe('Fotoğraf eksik');
    expect((await o.sup.query(`SELECT bilgi_kaynagi, teknik_veri FROM yat_marka_model WHERE kimlik = $1`, [m])).rows[0]).toEqual({ bilgi_kaynagi: 'Ruhsat / plaka', teknik_veri: 'Var' });
  });
});
