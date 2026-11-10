import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test89', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('iç ilerleme raporu (YG-787)', () => {
  it('dönem günü önceliğe göre; görev bir kez; rapor fiziksel ve finansal ilerlemeyi ayrı kaydeder', async () => {
    const { donemGunu, icIlerlemeGorevi } = await import('../src/ic_ilerleme.js');
    expect([1, 2, 3, 4, 5].map((g) => donemGunu('Normal', g))).toEqual([true, false, false, true, false]); expect(donemGunu('Planlı', 2)).toBe(false); expect(donemGunu('Yüksek', 3)).toBe(true); expect(donemGunu('Yüksek', 6)).toBe(false);
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); await o.sup.query(`UPDATE dosya SET statu = 'Aktif', asama = 'Uygulama', oncelik = 'Yüksek', dosya_sorumlusu_ref = $2 WHERE kimlik = $1`, [d.kimlik, o.K.ds]);
    const z = new Date('2026-11-11T08:00:00Z'); expect(await icIlerlemeGorevi(o.db, z)).toBeGreaterThanOrEqual(1); const n2 = await icIlerlemeGorevi(o.db, z); expect(n2).toBe(0);
    expect((await o.kart('İç İlerleme Raporu', `${d.kimlik}:2026-11-11`)).sahip_kullanici_ref).toBe(o.K.ds);
    const ds = await o.gir('ds'); expect((await o.ist('POST', `/api/dosya/${d.kimlik}/ic-ilerleme`, ds, {})).statusCode).toBe(400);
    const r = (await o.ist('POST', `/api/dosya/${d.kimlik}/ic-ilerleme`, ds, { degerlendirme: 'Planlandığı gibi' })).json(); expect(r).toMatchObject({ tamam: true, fiziksel: null });
    expect((await o.kart('İç İlerleme Raporu', `${d.kimlik}:2026-11-11`)).durum).toBe('Tamamlandı');
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/ic-ilerleme`, ds)).json().raporlar.length).toBe(1);
  });
});

describe('iletişim bilgisi geçmişi (YG-518)', () => {
  it('değişen telefon eski kayıt olarak kalır; doğrulama kaynakla; eski değer yeniden hedef seçilebilir', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const ds = await o.gir('ds');
    const t = (await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, telefon, olusturan_ref) VALUES ($1,'Kaptan','K','+905550000001',$2) RETURNING kimlik`, [d.kimlik, o.K.ds])).rows[0].kimlik;
    await o.sup.query(`UPDATE dosya_tarafi SET telefon = '+905550000002' WHERE kimlik = $1`, [t]);
    const l = (await o.ist('GET', `/api/dosya/${d.kimlik}/iletisim-bilgisi`, ds)).json().kayitlar.filter((x: { tur: string; deger: string }) => x.tur === 'Telefon' && x.deger.startsWith('+90555000000'));
    expect(l.map((x: { deger: string; bildirim_hedefi: boolean }) => [x.deger, x.bildirim_hedefi])).toEqual([['+905550000002', true], ['+905550000001', false]]);
    expect((await o.ist('POST', `/api/iletisim-bilgisi/${l[0].kimlik}/dogrula`, ds, { kaynak: 'Uydurma' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/iletisim-bilgisi/${l[0].kimlik}/dogrula`, ds, { kaynak: 'Telefon Görüşmesi' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/iletisim-bilgisi/${l[1].kimlik}/hedef`, ds, {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT telefon FROM dosya_tarafi WHERE kimlik = $1`, [t])).rows[0].telefon).toBe('+905550000001');
    expect(Number((await o.sup.query(`SELECT count(*) n FROM iletisim_bilgisi WHERE taraf_ref = $1 AND tur = 'Telefon'`, [t])).rows[0].n)).toBe(2);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/iletisim-bilgisi`, await o.gir('tu'))).statusCode).toBe(404);
  });
});

describe('randevu bildirimi ve takvim daveti (YG-552)', () => {
  it('deniz denemesi BLD-22 ile yat sahibine gider; .ics dosyaya kaydedilir ve e-postaya eklenir', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const ds = await o.gir('ds'); const u = `/api/dosya/${d.kimlik}/randevu`;
    await o.sup.query(`INSERT INTO dosya_tarafi (dosya_ref, taraf_rolu, kisi_adi_soyadi, telefon, eposta, olusturan_ref) VALUES ($1,'Yat Sahibi','Sahip','+905551112233','sahip@randevu.local',$2)`, [d.kimlik, o.K.ds]).catch(() => undefined);
    const z = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect((await o.ist('POST', u, ds, { tur: 'Keşif', zaman: z, yer: 'Marina' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { tur: 'Tanıklık', zaman: z, yer: 'Marina' })).statusCode).toBe(400);
    const r = await o.ist('POST', u, ds, { tur: 'Deniz Denemesi', zaman: z, yer: 'Marina' }); expect(r.statusCode, r.body).toBe(200); expect(r.json().alicilar).toBeGreaterThanOrEqual(1);
    const g = (await o.sup.query(`SELECT metin, ek_surumler FROM gonderim WHERE olay_anahtari = $1 AND kanal = 'E-posta'`, [`randevu:${r.json().kimlik}`])).rows[0];
    expect(g.metin).toContain('deniz denemesi'); expect(g.ek_surumler.length).toBe(1);
    expect((await o.sup.query(`SELECT uzanti FROM belge_surum WHERE kimlik = $1`, [g.ek_surumler[0]])).rows[0].uzanti).toBe('ics');
    const bt = (await o.sup.query(`SELECT teyit_belirteci b FROM randevu_bildirimi WHERE kimlik = $1`, [r.json().kimlik])).rows[0].b as string; expect(g.metin).toContain(`#randevu=${bt}`);
    expect((await o.ist('GET', `/api/randevu-teyit/${bt}`)).json().tur).toBe('Deniz Denemesi');
    expect((await o.ist('POST', `/api/randevu-teyit/${bt}`, undefined, { yanit: 'Katılacağım' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/randevu-teyit/${bt}`, undefined, { yanit: 'Katılacağım', kaptanAd: 'Kaptan K', kaptanTelefon: '+905551110000' })).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/dosya/${d.kimlik}/randevu`, ds)).json()[0]).toMatchObject({ teyit: 'Katılacağım', kaptan_ad: 'Kaptan K' });
    expect((await o.ist('GET', '/api/randevu-teyit/' + 'a'.repeat(48))).statusCode).toBe(404);
    const { takvimDaveti } = await import('../src/randevu.js'); const ics = takvimDaveti({ uid: 'x', baslik: 'A, B', aciklama: 'C;D', yer: 'M', baslangic: new Date('2026-12-01T09:00:00Z'), dakika: 60 });
    expect(ics).toContain('DTSTART:20261201T090000Z'); expect(ics).toContain('DTEND:20261201T100000Z'); expect(ics).toContain('SUMMARY:A' + String.fromCharCode(92) + ', B');
  });
});

describe('kritik bulgu bildirimi (YG-545)', () => {
  it('Kritik bulgu ekibe hemen bildirilir; alıcı ve bilgi kayda geçer; karar Dosya Sorumlusundan', async () => {
    const d = await o.dosyaAc(); await o.ekipKur(d.kimlik); const tu = await o.gir('tu');
    const G = { konum: 'Sancak kıç omuzluk, su hattı altı', aciklama: 'Gövdede çatlak, su alıyor', etiket: 'Hasar', bilgiTuru: 'Doğrulanmış olgu', onem: 'Kritik', yonlendirme: 'Teklif', sorumlu: o.K.ds, hedefTarih: '2099-01-01' };
    const lst = async (k: string) => (await o.sup.query(`SELECT deger FROM deger_listesi WHERE liste_kodu = $1 ORDER BY sira LIMIT 1`, [k])).rows[0].deger as string;
    const r = await o.ist('POST', `/api/dosya/${d.kimlik}/bulgu`, tu, { ...G, etiket: await lst('LST_BULGU_ETIKETI'), bilgiTuru: await lst('LST_BILGI_TURU'), yonlendirme: await lst('LST_BULGU_YONLENDIRME') }); expect(r.statusCode, r.body).toBe(200);
    const b = r.json().kimlik as string; const n = (await o.sup.query(`SELECT alicilar, bilgi FROM kritik_bulgu_bildirimi WHERE bulgu_ref = $1`, [b])).rows[0];
    expect(n.alicilar.sort()).toEqual([o.K.ds, o.K.oy, o.K.ty].sort()); expect(n.bilgi).toContain('çatlak');
    expect((await o.kart('Kritik Bulgu Kararı', b)).sahip_kullanici_ref).toBe(o.K.ds);
    expect((await o.ist('POST', `/api/bulgu/${b}/kritik-karar`, tu, { karar: 'K' })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/bulgu/${b}/kritik-karar`, await o.gir('ds'), { karar: 'Yat derhal karaya alınacak' })).statusCode).toBe(200);
    expect((await o.kart('Kritik Bulgu Kararı', b)).durum).toBe('Tamamlandı');
  });
});

describe('FR-OPS-003 İlk Kapsam (YG-1069)', () => {
  it('Dosya Sorumlusu doldurur; Teknik Uzman tamamlar ve onaylar; iki branşta koordinatör zorunlu; yeni kayıt yeni sürüm', async () => {
    const d = (await o.dosyaAc()).kimlik as string; await o.ekipKur(d); const u = `/api/dosya/${d}/ilk-kapsam`;
    const ds = await o.gir('ds'); const tu = await o.gir('tu');
    const G = { varlikSistem: 'Sancak şaft hattı', faaliyet: 'Teşhis', teknikBrans: ['TAHRIK-01'], beklenenCikti: 'Kök neden görüşü', kabulOlcutu: 'Titreşim ölçümü sınırda', hariclar: 'Motor revizyonu hariç' };
    expect((await o.ist('POST', u, tu, G)).statusCode).toBe(404);
    expect((await o.ist('POST', u, ds, { ...G, faaliyet: 'Bakım' })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ...G, teknikBrans: ['TAHRIK-01', 'MAKINE-01'] })).statusCode).toBe(400);
    expect((await o.ist('POST', u, ds, { ...G, kabulOlcutu: '' })).statusCode).toBe(400);
    const r = (await o.ist('POST', u, ds, G)).json(); expect(r).toMatchObject({ surum: 1, kontrolGorevi: true });
    expect((await o.kart('İlk Kapsam Kontrolü', d)).sahip_kullanici_ref).toBe(o.K.tu);
    const k = `${u}/1/kontrol`;
    expect((await o.ist('POST', k, ds, { karar: 'Onayla' })).statusCode).toBe(404);
    expect((await o.ist('POST', k, tu, { karar: 'İade' })).statusCode).toBe(400);
    expect((await o.ist('POST', k, tu, { karar: 'Onayla', varsayimlar: 'Yat karada' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum, varsayimlar, kontrol_eden_ref FROM ilk_kapsam WHERE dosya_ref = $1 AND surum = 1`, [d])).rows[0]).toEqual({ durum: 'Onaylı', varsayimlar: 'Yat karada', kontrol_eden_ref: o.K.tu });
    expect((await o.kart('İlk Kapsam Kontrolü', d)).durum).toBe('Tamamlandı');
    expect((await o.ist('POST', u, ds, { ...G, teknikBrans: ['TAHRIK-01', 'MAKINE-01'], koordinator: o.K.tu })).json().surum).toBe(2);
    expect((await o.sup.query(`SELECT array_agg(durum ORDER BY surum) d FROM ilk_kapsam WHERE dosya_ref = $1`, [d])).rows[0].d).toEqual(['Yerine Geçti', 'Kontrolde']);
    expect((await o.ist('GET', u, ds)).json().surumler.length).toBe(2);
  });
});
