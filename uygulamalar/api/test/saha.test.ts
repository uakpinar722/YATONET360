import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', hd: 'Hukuk ve Uyum Direktörü', mpd: 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü' };
let o: Ortam;
const hazir = async (e: Record<string, unknown> = {}, ac: Record<string, unknown> = {}) => { const d = await o.dosyaAc(e, ac); await o.ekipKur(d.kimlik); return d; };
const kesifAc = async (id: string, e: object = {}) => o.ist('POST', `/api/dosya/${id}/kesif`, await o.gir('tu'), { amac: 'Hasar tespiti', baslangic: '2026-11-20T09:00:00Z', bitis: '2026-11-20T12:00:00Z', ...e });
const bulgu = async (id: string, e: object = {}) => o.ist('POST', `/api/dosya/${id}/bulgu`, await o.gir('tu'), { konum: 'Baştan 8 m, sancak', aciklama: 'Çatlak', etiket: 'Hasar', bilgiTuru: 'İlk Gözlem', onem: 'Orta', yonlendirme: 'Onarım', sorumlu: o.K.tu, hedefTarih: '2026-12-01', ...e });
const genelFoto = async (id: string) => {
  for (const k of ['Genel – Baş', 'Genel – Kıç', 'Genel – Sancak', 'Genel – İskele', 'Genel – Güverte', 'Kimlik – Yat Adı']) {
    const r = await o.ist('POST', `/api/dosya/${id}/gorsel`, await o.gir('tu'), { asama: 'Keşif', kalem: k, cekilemedi: 'Erişim yok' });
    expect(r.statusCode, r.body).toBe(200);
  }
};
const TAMAM = { tarih: '2026-11-20T10:00:00Z', incelenen: 'Gövde', cikis: 'Hazır', supheli: 'Hayır', kanitSayimi: true };

beforeAll(async () => { o = await ortamKur('yatonet360_test13', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
beforeEach(async () => { await o.sup.query(`UPDATE dosya_ekibi_atamasi SET bitis_zamani = now() WHERE bitis_zamani IS NULL`); });

describe('metin kataloğu', () => {
  it('onaylı BLD metinleri BLD-83e kadar yüklüdür', async () => {
    const r = (await o.sup.query(`SELECT count(*)::int n FROM sablon_metni WHERE tur = 'Bildirim' AND dil = 'tr' AND kod LIKE 'BLD-%'`)).rows[0].n;
    expect(r).toBeGreaterThanOrEqual(84);
    expect((await o.sup.query(`SELECT metin FROM sablon_metni WHERE kod = 'BLD-45' AND dil = 'tr'`)).rows[0].metin).toContain('vefatı nedeniyle');
  });
});

describe('keşif (YG-049, YG-056, YG-111)', () => {
  it('Teknik Uzman atanmadan ve ekip dışından keşif açılmaz; sigortasız dosyada ONY-01, sigortalıda yok', async () => {
    const d = await o.dosyaAc();
    expect((await kesifAc(d.kimlik)).statusCode).toBe(404);
    await o.ekipKur(d.kimlik);
    expect((await kesifAc(d.kimlik, { amac: '' })).statusCode).toBe(400);
    expect((await kesifAc(d.kimlik)).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-01'`, [d.kimlik])).rowCount).toBe(1);
    expect((await o.sup.query(`SELECT tamamlanma FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Randevu İletişimi'`, [d.kimlik])).rows[0].tamamlanma).not.toBeNull();
    expect((await o.sup.query(`SELECT 1 FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Keşif'`, [d.kimlik])).rowCount).toBe(1);
    const s = await hazir({ sigortaci: 'SG' }, { musteriTuru: 'Sigorta Şirketi' });
    expect((await kesifAc(s.kimlik)).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-01'`, [s.kimlik])).rowCount).toBe(0);
  });
  it('tamamlama: fotoğraf eksikse kapanmaz; erişilemeyen alan açık konu olur; keşif sayacı kapanır; teklife geçilir', async () => {
    const d = await hazir(); const k = (await kesifAc(d.kimlik)).json().kimlik; const c = await o.gir('tu');
    const t = (x: object) => o.ist('POST', `/api/kesif/${k}/tamamla`, c, { ...TAMAM, ...x });
    expect((await o.ist('POST', `/api/kesif/${k}/tamamla`, await o.gir('ty'), TAMAM)).statusCode).toBe(403);
    expect((await t({})).statusCode).toBe(409);
    await genelFoto(d.kimlik);
    expect((await t({ kanitSayimi: false })).statusCode).toBe(400);
    expect((await t({ erisilemeyen: 'Sintine' })).statusCode).toBe(400);
    const r = await t({ erisilemeyen: 'Sintine', hedefTarih: '2026-12-01' });
    expect(r.statusCode, r.body).toBe(200);
    expect((await o.sup.query(`SELECT baslik, konu_no FROM acik_konu WHERE dosya_ref = $1`, [d.kimlik])).rows[0]).toEqual({ baslik: 'Erişilemeyen Alan', konu_no: `${d.dosyaNo}-AK01` });
    expect((await o.sup.query(`SELECT tamamlanma FROM dosya_sure WHERE dosya_ref = $1 AND tur = 'Keşif'`, [d.kimlik])).rows[0].tamamlanma).not.toBeNull();
    const ds = await o.gir('ds');
    await o.ist('POST', `/api/dosya/${d.kimlik}/yat-bilgisi`, ds, { tahrik: 'Dizel' });
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/asama`, ds, { asama: 'Teklif', gerekce: 'Keşif bitti' })).statusCode).toBe(200);
  });
  it('keşif bitmeden teklif aşamasına geçilmez', async () => {
    const d = await hazir(); const ds = await o.gir('ds');
    await o.ist('POST', `/api/dosya/${d.kimlik}/yat-bilgisi`, ds, { tahrik: 'Dizel' });
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/asama`, ds, { asama: 'Teklif', gerekce: 'x' });
    expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('Keşif tamamlanmadan');
  });
  it('asbest/TBT şüphesi işi durdurur ve açık konu açar', async () => {
    const d = await hazir(); const k = (await kesifAc(d.kimlik)).json().kimlik; await genelFoto(d.kimlik);
    const r = await o.ist('POST', `/api/kesif/${k}/tamamla`, await o.gir('tu'), { ...TAMAM, supheli: 'Bilinmiyor' });
    expect(r.json().durum).toBe('Durduruldu');
    expect((await o.sup.query(`SELECT baslik FROM acik_konu WHERE dosya_ref = $1`, [d.kimlik])).rows[0].baslik).toContain('Asbest');
  });
  it('katalogdan gelen bilgi teyit edilmeden keşif kapanmaz', async () => {
    const m = (await o.sup.query(`SELECT kimlik FROM yat_marka_model WHERE boy_m IS NOT NULL AND govde_malzemesi IS NOT NULL LIMIT 1`)).rows[0].kimlik;
    const d = await hazir({ yat: { adi: 'Katalog Teyit', markaModelId: m } }); const k = (await kesifAc(d.kimlik)).json().kimlik; await genelFoto(d.kimlik); const c = await o.gir('tu');
    const r = await o.ist('POST', `/api/kesif/${k}/tamamla`, c, TAMAM);
    expect(r.statusCode).toBe(409); expect(r.json().hata).toContain('teyit');
    await o.ist('POST', `/api/dosya/${d.kimlik}/yat-bilgisi`, c, { teyit: 'Teyit edildi' });
    expect((await o.ist('POST', `/api/kesif/${k}/tamamla`, c, TAMAM)).statusCode).toBe(200);
  });
});

describe('bulgu (YG-037, YG-129, YG-130)', () => {
  it('yetki ve bağlamsız konum; numara tekil; önerilen öncelik en ağır bulgudan', async () => {
    const d = await hazir();
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/bulgu`, await o.gir('ds'), { konum: 'x' })).statusCode).toBe(403);
    expect((await bulgu(d.kimlik, { konum: 'Sağ taraf' })).statusCode).toBe(400);
    expect((await bulgu(d.kimlik, { onem: 'Felaket' })).statusCode).toBe(400);
    const a = await bulgu(d.kimlik);
    expect(a.statusCode, a.body).toBe(200); expect(a.json().bulguNo).toBe(`${d.dosyaNo}-B001`); expect(a.json().onerilenOncelik).toBe('Normal');
    expect((await bulgu(d.kimlik, { onem: 'Kritik' })).json().bulguNo).toBe(`${d.dosyaNo}-B002`);
    await bulgu(d.kimlik, { onem: 'Gözlem' });
    expect((await o.sup.query(`SELECT onerilen_oncelik FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].onerilen_oncelik).toBe('Kritik');
  });
  it('beyanla çelişen ve tam ziya bulgusu sigorta bildirim görevi açar', async () => {
    const d = await hazir(); const b = await bulgu(d.kimlik, { beyanlaCelisen: true });
    expect((await o.kart('Sigorta Bildirimi', b.json().kimlik)).sahip_kullanici_ref).toBe(o.K.ds);
  });
});

describe('görsel kanıt (YG-503, YG-1452)', () => {
  it('numara kesintisiz; bölge kalemi kod ve ölçek ister, geçilemez; genel kare nedenle geçilir', async () => {
    const d = await hazir(); const c = await o.gir('tu'); const g = (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/gorsel`, c, { asama: 'Keşif', ...x });
    const bel = await o.belge(d.kimlik, 'tu', 'f1', 'jpg');
    expect((await g({ kalem: 'Genel – Baş', belge: bel })).json().gorselNo).toBe(`${d.dosyaNo}-G0001`);
    expect((await g({ kalem: 'Bölge – Geniş Plan', belge: bel })).statusCode).toBe(400);
    expect((await g({ kalem: 'Bölge – Yakın Plan (Ölçekli)', bolge: 'S1', belge: bel })).statusCode).toBe(400);
    expect((await g({ kalem: 'Bölge – Geniş Plan', bolge: 'S1', cekilemedi: 'Erişim yok' })).statusCode).toBe(400);
    expect((await g({ kalem: 'Genel – Kıç', cekilemedi: 'Yanlış' })).statusCode).toBe(400);
    expect((await g({ kalem: 'Genel – Kıç', cekilemedi: 'Diğer' })).statusCode).toBe(400);
    expect((await g({ kalem: 'Genel – Kıç', cekilemedi: 'Yat suda, su altı görülemiyor' })).statusCode).toBe(200);
    expect((await g({ kalem: 'Bölge – Yakın Plan (Ölçekli)', bolge: 'S1', olcek: 'Cetvel', belge: bel })).json().gorselNo).toBe(`${d.dosyaNo}-G0002`);
    expect((await g({ kalem: 'Genel – Baş', belge: '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(400);
  });
  it('bulgudaki bölgenin geniş ve yakın karesi olmadan keşif kapanmaz', async () => {
    const d = await hazir(); const k = (await kesifAc(d.kimlik)).json().kimlik; await genelFoto(d.kimlik); await bulgu(d.kimlik, { bolge: 'S1' }); const c = await o.gir('tu');
    const r = await o.ist('POST', `/api/kesif/${k}/tamamla`, c, TAMAM);
    expect(r.statusCode).toBe(409); expect(r.json().eksik).toEqual(['Bölge – Geniş Plan · S1', 'Bölge – Yakın Plan (Ölçekli) · S1']);
    const bel = await o.belge(d.kimlik, 'tu', 'f2', 'jpg'); const g = (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/gorsel`, c, { asama: 'Keşif', belge: bel, bolge: 'S1', ...x });
    await g({ kalem: 'Bölge – Geniş Plan' }); await g({ kalem: 'Bölge – Yakın Plan (Ölçekli)', olcek: 'Cetvel' });
    expect((await o.ist('POST', `/api/kesif/${k}/tamamla`, c, TAMAM)).statusCode).toBe(200);
  });
});

describe('ölçüm, bölge, kontrol listesi (YG-131, YG-134, YG-135)', () => {
  it('kalibrasyonu geçmiş sonuç geçerli olamaz; sınır dışında ikinci doğrulayan zorunlu', async () => {
    const d = await hazir(); const c = await o.gir('tu'); const m = (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/olcum`, c, { nokta: 'N1', buyukluk: 'Kalınlık', birim: 'mm', yontem: 'UT', cihaz: 'C1', ham: '10,04', deger: 10.04, kalibrasyon: 'Geçerli', gecerlilik: 'Geçerli', ...x });
    expect((await m({ kalibrasyon: 'Süresi geçmiş' })).statusCode).toBe(400);
    expect((await m({ nominal: 12, tolerans: 1 })).statusCode).toBe(400);
    expect((await m({ nominal: 12, tolerans: 1, ikinci: o.K.tu })).statusCode).toBe(400);
    const r = await m({ nominal: 12, tolerans: 1, ikinci: o.K.ty });
    expect(r.json()).toEqual({ olcumNo: `${d.dosyaNo}-OL001`, sinirDisi: true });
    expect((await o.sup.query(`SELECT ham_veri FROM olcum_kaydi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].ham_veri).toBe('10,04');
    expect((await m({ gecerlilik: 'Geçersiz' })).statusCode).toBe(400);
  });
  it('bölge yeni sürüm açar, önceki silinmez', async () => {
    const d = await hazir(); const c = await o.gir('tu'); const b = (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/bolge`, c, { kod: 'S1', gorunus: ['Profil'], isaret: { n: [[1, 2]] }, hat: 'Baş', boyuna: '8,0–10,4', ...x });
    expect((await b({ kod: 'sancak' })).statusCode).toBe(400);
    expect((await b({})).json().surum).toBe(1); expect((await b({ boyuna: '8,0–11,0' })).json().surum).toBe(2);
    expect((await o.sup.query(`SELECT count(*)::int n FROM hasar_bolgesi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].n).toBe(2);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/saha`, c)).json().bolgeler[0].surum).toBe(2);
  });
  it('kontrol listesi maddeleri katalogdan gelir; uygun değil açıklama ister; hazırlayan onaylayamaz', async () => {
    const d = await hazir(); const c = await o.gir('tu');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/kontrol-listesi`, c, { kod: 'KL-YOK' })).statusCode).toBe(400);
    const k = (await o.ist('POST', `/api/dosya/${d.kimlik}/kontrol-listesi`, c, { kod: 'KL-ISG-001' })).json();
    expect(k.kayitNo).toBe(`${d.dosyaNo}-KL-ISG-001-01`); expect(k.maddeler.length).toBeGreaterThan(2);
    expect((await o.ist('POST', `/api/kontrol-listesi/${k.kimlik}/madde`, c, { madde: k.maddeler[0], sonuc: 'Uygun Değil' })).statusCode).toBe(400);
    for (const m of k.maddeler) await o.ist('POST', `/api/kontrol-listesi/${k.kimlik}/madde`, c, { madde: m, sonuc: m === k.maddeler[0] ? 'Uygun Değil' : 'Uygun', aciklama: 'A' });
    expect((await o.ist('POST', `/api/kontrol-listesi/${k.kimlik}/tamamla`, c, { eksikler: 'E' })).statusCode).toBe(403);
    const ty = await o.gir('ty');
    expect((await o.ist('POST', `/api/kontrol-listesi/${k.kimlik}/tamamla`, ty, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/kontrol-listesi/${k.kimlik}/tamamla`, ty, { eksikler: 'E' })).statusCode).toBe(200);
  });
});

describe('dosya işlemi, kapanış, yeniden açma, birleştirme (YG-024, YG-075, YG-080, YG-148)', () => {
  const tutanak = { tur: 'Askı', gerekce: 'G', talepEden: 'Sahip', yatDurumu: 'Bağlı', yapilan: 'Keşif', acik: 'Teklif', teslim: 'Yok' };
  it('askı tutanağı Operasyon Müdürü onayıyla Kontrollü Askıda yapar', async () => {
    const d = await hazir(); const c = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/islem`, await o.gir('tu'), tutanak)).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/islem`, c, { ...tutanak, gerekce: '' })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/islem`, c, tutanak);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/islem`, c, tutanak)).statusCode).toBe(409);
    expect((await o.karar((await o.kart('Dosya İşlemi', r.json().kimlik)).kimlik, 'opm', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT statu FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].statu).toBe('Kontrollü Askıda');
  });
  it('devir nedeni Devredildi ve devralan ister; onayla Kapalı olur', async () => {
    const d = await hazir(); const c = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/islem`, c, { ...tutanak, tur: 'Devir', neden: 'Tamamlandı', devralan: 'F' })).statusCode).toBe(400);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/islem`, c, { ...tutanak, tur: 'Devir', neden: 'Devredildi', devralan: 'Başka Firma' });
    await o.karar((await o.kart('Dosya İşlemi', r.json().kimlik)).kimlik, 'opm', 'Onayla');
    expect((await o.sup.query(`SELECT statu, kapanma_nedeni FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0]).toEqual({ statu: 'Kapalı', kapanma_nedeni: 'Devredildi' });
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/beklemede`, c, {})).statusCode).toBe(409);
  });
  it('kapanış kontrolü: beyan zorunlu, her Hayır işaret üretir; Teknik Kapalı sonra Kapalı; kanuni süre hesaplanır', async () => {
    const d = await hazir(); const c = await o.gir('ds'); const K = (x: object) => o.ist('POST', `/api/dosya/${d.kimlik}/kapanis`, c, { yetkiKapsam: true, uygulama: true, testKabul: true, acikKonu: true, garanti: true, arsiv: true, yazismaBeyani: true, ...x });
    expect((await K({ cikis: 'Teknik Kapalı', yazismaBeyani: false })).statusCode).toBe(400);
    expect((await K({ cikis: 'Kapalı', neden: 'Tamamlandı' })).statusCode).toBe(409);
    // YG-076: kabul ve garanti işareti yalnız yayımlanmış ON/EK iş emri olan dosyada aranır.
    expect((await K({ cikis: 'Teknik Kapalı', testKabul: false, garanti: false, yetkiKapsam: false })).json().eksikler).toEqual(['Kapanış Bekliyor']);
    await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-KPN','Kapanış Firma','Çözüm Ortağı',$1) ON CONFLICT DO NOTHING`, [o.K.ds]);
    await o.sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, statu, hazirlayan_ref) VALUES ($1,'ON',$2,(SELECT kimlik FROM kurulus WHERE sicil_no = 'S-KPN'),'Y','K',100,'Tamamlandı',$3)`, [`${d.dosyaNo}-ON09`, d.kimlik, o.K.oy]);
    const e = await K({ cikis: 'Teknik Kapalı', testKabul: false, garanti: false });
    expect(e.statusCode).toBe(409); expect(e.json().eksikler).toEqual(['Kabul Bekliyor', 'Garanti Bağı Eksik']);
    const r = await K({ cikis: 'Teknik Kapalı' });
    expect(r.statusCode, r.body).toBe(200);
    await o.karar((await o.kart('Dosya Kapanışı', r.json().kimlik)).kimlik, 'opm', 'Onayla');
    const v = (await o.sup.query(`SELECT statu, kanuni_sorumluluk_bitis, teslim_tarihi FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0];
    expect(v.statu).toBe('Teknik Kapalı'); expect(v.kanuni_sorumluluk_bitis).not.toBeNull();
    const eksik = await K({ cikis: 'Kapalı', neden: 'Tamamlandı' });
    expect(eksik.statusCode).toBe(409); expect(eksik.json().eksikler).toContain('Teknik Eksik');
    const r2 = await K({ cikis: 'Kapalı', neden: 'Müşteri Vazgeçti' });
    await o.karar((await o.kart('Dosya Kapanışı', r2.json().kimlik)).kimlik, 'opm', 'Onayla');
    expect((await o.sup.query(`SELECT statu, kapanma_nedeni FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0]).toEqual({ statu: 'Kapalı', kapanma_nedeni: 'Müşteri Vazgeçti' });
  });
  it('açık konu ve Beklemede kapanışı engeller', async () => {
    const d = await hazir(); const c = await o.gir('ds');
    await o.ist('POST', `/api/dosya/${d.kimlik}/konu`, c, { baslik: 'K', sahip: o.K.ds, hedefTarih: '2026-12-01' });
    const e = await o.ist('POST', `/api/dosya/${d.kimlik}/kapanis`, c, { cikis: 'Teknik Kapalı', yetkiKapsam: true, uygulama: true, testKabul: true, acikKonu: true, garanti: true, yazismaBeyani: true });
    expect(e.json().eksikler).toContain('Açık Görev');
  });
  it('yeniden açma yalnız kapalı dosyada, onayla; önceki kapanış geçmişte kalır', async () => {
    const d = await hazir(); const c = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yeniden-ac`, c, { tur: 'Hata', gerekce: 'x' })).statusCode).toBe(409);
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/islem`, c, { ...tutanak, tur: 'İptal', neden: 'Hatalı Açılış' });
    await o.karar((await o.kart('Dosya İşlemi', r.json().kimlik)).kimlik, 'opm', 'Onayla');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yeniden-ac`, c, { tur: 'Keyif', gerekce: 'x' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/yeniden-ac`, c, { tur: 'Hata', gerekce: 'Yanlış kapanış' })).statusCode).toBe(200);
    const ta = (await o.sup.query(`SELECT kimlik FROM dosya_yeniden_acma WHERE dosya_ref = $1`, [d.kimlik])).rows[0];
    await o.karar((await o.kart('Dosya Yeniden Açma', ta.kimlik)).kimlik, 'opm', 'Onayla');
    const v = (await o.sup.query(`SELECT statu, kapanma_nedeni FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0];
    expect(v).toEqual({ statu: 'Aktif', kapanma_nedeni: null });
    const g = (await o.sup.query(`SELECT gerekce FROM dosya_statu_gecmisi WHERE dosya_ref = $1 ORDER BY kimlik`, [d.kimlik])).rows.map((x) => x.gerekce);
    expect(g.at(-1)).toContain('Yeniden açıldı'); expect(g.join()).toContain('G');
  });
  it('birleştirme: yetki, Kapalı+neden, ana dosyaya yönlendirme; birleşen yeniden açılmaz', async () => {
    const a = await hazir(); const b = await hazir(); const opm = await o.gir('opm');
    expect((await o.ist('POST', `/api/dosya/${b.kimlik}/birlestir`, await o.gir('ds'), { ana: a.kimlik, gerekce: 'x' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${b.kimlik}/birlestir`, opm, { ana: a.kimlik })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/dosya/${b.kimlik}/birlestir`, opm, { ana: a.kimlik, gerekce: 'Aynı olay' })).json().anaNo).toBe(a.dosyaNo);
    const ar = (await o.ist('GET', `/api/ara?q=${b.dosyaNo}`, opm)).json().dosyalar[0];
    expect(ar.ana_no).toBe(a.dosyaNo); expect(ar.ana_kimlik).toBe(a.kimlik);
    expect((await o.ist('POST', `/api/dosya/${b.kimlik}/yeniden-ac`, opm, { tur: 'Hata', gerekce: 'x' })).statusCode).toBe(409);
  });
});

describe('vefat ve itiraz (YG-1477, YG-1497)', () => {
  it('vefat: bekleyen onay durur; bağlantı kapanır; DS sıralı görev; kurumsalda çalışmaz; yalnız DS', async () => {
    const d = await hazir(); await kesifAc(d.kimlik);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/vefat`, await o.gir('tu'), {})).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/vefat`, await o.gir('ds'), { tarih: '2026-11-01' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM onay_talebi WHERE dosya_ref = $1 AND durum = 'Durduruldu'`, [d.kimlik])).rows[0].n).toBeGreaterThan(0);
    const g = (await o.sup.query(`SELECT baslik, son_zaman FROM is_karti WHERE tur = 'Vefat Görevi' AND nesne_kimligi = $1 ORDER BY baslik`, [d.kimlik])).rows;
    expect(g).toHaveLength(3);
    expect((+new Date(g[0].son_zaman) - +new Date('2026-11-01')) / 3_600_000).toBe(96);
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/vefat`, await o.gir('ds'), {})).statusCode).toBe(409);
    const ku = await hazir({}, { musteriTuru: 'Kurumsal Müşteri' });
    expect((await o.ist('POST', `/api/dosya/${ku.kimlik}/vefat`, await o.gir('ds'), {})).statusCode).toBe(409);
  });
  it('sigortalı dosyada itiraz: işler durur, BLD-40 gider, DS kırmızı görev; sigortasızda yok', async () => {
    const d = await hazir({ sigortaci: 'SG' }, { musteriTuru: 'Sigorta Şirketi' }); const c = await o.gir('ds');
    expect((await o.ist('POST', `/api/dosya/${d.kimlik}/itiraz`, c, {})).json().durduruldu).toBe(true);
    expect((await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`bld40:${d.kimlik}`])).rows[0].metin).toContain('geçici olarak durdurulmuştur');
    expect((await o.kart('İtiraz Araması', d.kimlik)).oncelik).toBe('Kritik');
    const b = await hazir();
    expect((await o.ist('POST', `/api/dosya/${b.kimlik}/itiraz`, c, {})).statusCode).toBe(409);
  });
});

describe('garanti ve şikâyet (YG-081, YG-085, YG-1416, YG-1423, YG-1424, YG-1425)', () => {
  it('garanti kapalı dosyayı açmaz, GKnn alır, keşif süresi önceliğe göre; alındı bildirimi gider', async () => {
    const d = await hazir(); const c = await o.gir('ds');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/garanti-sikayet`, c, { turler: ['Garanti bildirimi'], kanal: 'Telefon', oncelik: 'Normal', belirti: 'Sızıntı' });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().kayitNo).toBe(`${d.dosyaNo}-GK01`);
    const k = (await o.sup.query(`SELECT bildirim_zamani, kesif_son FROM garanti_sikayet WHERE kimlik = $1`, [r.json().kimlik])).rows[0];
    expect(Math.round((+k.kesif_son - +k.bildirim_zamani) / 3_600_000)).toBe(72);
    expect((await o.sup.query(`SELECT metin FROM gonderim WHERE olay_anahtari = $1 LIMIT 1`, [`alindi:${r.json().kimlik}`])).rows[0].metin).toContain(`${d.dosyaNo}-GK01`);
    expect((await o.sup.query(`SELECT statu FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].statu).toBe('Aktif');
  });
  it('şikâyet SKnn, 10 iş günü sayacı, MPİ Müdür Yardımcısına takip; sonuç listesi', async () => {
    const d = await hazir(); const c = await o.gir('ds');
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/garanti-sikayet`, c, { turler: ['Şikâyet'], kanal: 'E-posta', oncelik: 'Normal', konu: 'Gecikme' });
    expect(r.json().kayitNo).toBe(`${d.dosyaNo}-SK01`);
    const k = (await o.sup.query(`SELECT yanit_son, bildirim_zamani, sikayet_takip_ref, sikayet_sonuc_ref FROM garanti_sikayet WHERE kimlik = $1`, [r.json().kimlik])).rows[0];
    expect((+k.yanit_son - +k.bildirim_zamani) / 86_400_000).toBeGreaterThanOrEqual(11);
    expect([k.sikayet_takip_ref, k.sikayet_sonuc_ref]).toEqual([o.K.mpd, o.K.mpm]);
    expect((await o.kart('Şikâyet Takibi', r.json().kimlik)).sahip_kullanici_ref).toBe(o.K.mpd);
    expect((await o.ist('POST', `/api/garanti-sikayet/${r.json().kimlik}/karar`, c, { gerekce: 'G', sikayetSonucu: 'Yanlış' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/garanti-sikayet/${r.json().kimlik}/karar`, c, { gerekce: 'G', sikayetSonucu: 'Kısmen Haklı' })).statusCode).toBe(200);
  });
  it('kapsam kararı Teknik Yönetici; 5.000 EUR üstü Teknik Müdür; kök neden olmadan kapanmaz', async () => {
    const d = await hazir(); const c = await o.gir('ds');
    const id = (await o.ist('POST', `/api/dosya/${d.kimlik}/garanti-sikayet`, c, { turler: ['Garanti bildirimi'], kanal: 'Telefon', oncelik: 'Yüksek', belirti: 'B' })).json().kimlik;
    const K = async (k: string, x: object) => o.ist('POST', `/api/garanti-sikayet/${id}/karar`, await o.gir(k), { gerekce: 'G', karar: 'Garanti', ...x });
    expect((await K('ds', {})).statusCode).toBe(403);
    expect((await K('ty', { maliyet: 5000.01 })).statusCode).toBe(403);
    expect((await K('ty', { maliyet: 5000, kapat: true })).statusCode).toBe(409);
    expect((await K('ty', { maliyet: 5000, kapat: true, kokNeden: true })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT statu FROM garanti_sikayet WHERE kimlik = $1`, [id])).rows[0].statu).toBe('Kapalı');
  });
});

