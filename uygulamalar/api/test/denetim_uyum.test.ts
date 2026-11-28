import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { denetimPlaniGorevi } from '../src/ic_denetim_ek.js';
import { sosyalMedyaIsle } from '../src/sosyal_medya.js';
import { uyumTaramaGorevi } from '../src/uyum_tarama.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ide: 'İç Denetçi', idm: 'İç Denetim Müdürü', cg: 'CEO', gmy: 'Genel Müdür Yardımcısı', hud: 'Hukuk ve Uyum Direktörü', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü', skd: 'Strateji ve Kurumsal Gelişim Direktörü', ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü' };
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
    // YG-807: kural yapısal bağları; gözden geçirme görevi bağları listeler.
    const ad = `Deneme Sözleşmesi ${Date.now()}`;
    expect((await o.ist('POST', `/api/uyum-kurali/${mum}/bag`, await o.gir('ds'), { tur: 'Sözleşme Türü', kod: ad })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/uyum-kurali/${mum}/bag`, hud, { tur: 'Şablon Metni', kod: 'YOK-KOD-0' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/uyum-kurali/${mum}/bag`, hud, { tur: 'Sözleşme Türü', kod: ad })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/uyum-kurali/${mum}/bag`, hud, { tur: 'Sözleşme Türü', kod: ad })).statusCode).toBe(409);
    const ib = (await o.ist('POST', `/api/uyum-kurali/${mum}/bag`, hud, { tur: 'İş Emri Adımı', kod: `Adım ${ad}` })).json().kimlik;
    expect((await o.ist('POST', `/api/uyum-kurali-bagi/${ib}/kaldir`, hud, {})).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/uyum-kurali-bagi/${ib}/kaldir`, hud, { gerekce: 'Adım kaldırıldı' })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/resmi-gazete', hud)).json().baglar.some((x: { bag_kodu: string }) => x.bag_kodu === ad)).toBe(true);
    expect((await o.ist('POST', `/api/resmi-gazete/${t}`, hud, { sonuc: 'Değişiklik Var', aciklama: 'Yönetmelik değişti', mumlar: [mum] })).json().gorev).toBe(1);
    const gk = (await o.sup.query(`SELECT ozet FROM is_karti WHERE tur = 'Uyum Kuralı Gözden Geçirme' AND nesne_kimligi = $1`, [`${t}:${mum}`])).rows[0].ozet as string;
    expect(gk).toContain(`Sözleşme Türü: ${ad} (0 yürürlükte sözleşme)`); expect(gk).not.toContain(`Adım ${ad}`);
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
      const sk = await o.ist('POST', `/api/sosyal-medya/${r.kimlik}/sikayet`, m, {}); expect(sk.statusCode, sk.body).toBe(200); expect(sk.json().kayitNo).toMatch(/-SK\d+$/); // T-YG1466-SKNN
      expect((await o.ist('POST', `/api/sosyal-medya/${r.kimlik}/sikayet`, m, {})).statusCode).toBe(409);
      expect((await o.sup.query(`SELECT kanal FROM garanti_sikayet WHERE kayit_no = $1`, [sk.json().kayitNo])).rows[0].kanal).toBe('Sosyal Medya');
    }
  });
});

describe('İç Denetçi kanıt ve örneklem (YG-1671)', () => {
  it('kanıt kaydı, kanıt talebi ve yanıtı, örneklem incelemesi bulgu alanıyla, üç aylık mali kontrol (T-YG1671)', async () => {
    const ide = await o.gir('ide'); const idm = await o.gir('idm');
    const d = (await o.ist('POST', '/api/ic-denetim', ide, { surec: 'Tedarik', kapsam: 'Siparişler', cikarYok: true, sonOnIkiAyGorevYok: true })).json().kimlik as string;
    expect((await o.ist('POST', `/api/ic-denetim/${d}/kanit`, ide, { tur: 'Tahmin', aciklama: 'X' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/ic-denetim/${d}/kanit`, ide, { tur: 'Kayıt', aciklama: 'Sipariş onay izleri incelendi' })).statusCode).toBe(200);
    const ep = (await o.sup.query(`SELECT e_posta FROM kullanici_hesabi WHERE kimlik = $1`, [o.K.ds])).rows[0].e_posta;
    const kt = (await o.ist('POST', `/api/ic-denetim/${d}/kanit-talebi`, ide, { eposta: ep, konu: 'Sipariş onay e-postaları', sonTarih: '2031-01-10' })).json().kimlik;
    const ds = await o.gir('ds'); expect((await o.ist('GET', '/api/ic-denetim-kanit-talebi/bana', ds)).json().some((x: any) => x.kimlik === kt)).toBe(true);
    expect((await o.ist('POST', `/api/ic-denetim-kanit-talebi/${kt}/yanit`, ds, { yanit: 'Dosya belgelerine yüklendi' })).statusCode).toBe(200);
    expect((await o.ist('GET', `/api/ic-denetim/${d}/kanitlar`, idm)).json().kanitlar).toHaveLength(2);
    const dsy = await o.dosyaAc();
    await o.sup.query(`INSERT INTO ic_denetim_orneklemi (donem, dosya_ref, havuz, denetci_ref) VALUES ('2031-01', $1, 10, $2)`, [dsy.kimlik, o.K.ide]);
    expect((await o.ist('POST', `/api/ic-denetim/orneklem/2031-01/${dsy.kimlik}/inceleme`, ide, { sonuc: 'Bulgulu', sinif: 'Minör' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/ic-denetim/orneklem/2031-01/${dsy.kimlik}/inceleme`, ide, { sonuc: 'Bulgulu', sinif: 'Minör', kanit: 'Onay kaydı sonradan girilmiş', sorumlu: 'Operasyon Müdürü', hedef: '2031-02-01' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT bulgu_sinif FROM ic_denetim_orneklemi WHERE donem = '2031-01' AND dosya_ref = $1`, [dsy.kimlik])).rows[0].bulgu_sinif).toBe('Minör');
    const { ucAylikMaliKontrol } = await import('../src/ic_denetci.js'); expect(await ucAylikMaliKontrol(o.db, new Date('2031-04-02T09:00:00+03:00'))).toBe(true); expect(await o.kart('Üç Aylık Mali Kontrol Testi', '2031-Q2')).toBeDefined();
  });
});

describe('Sigorta ve Panel (YG-1702)', () => {
  it('panel başvurusu, denetim talebi Hukuk görüşüyle yanıt, itibar riski CEO\'ya (T-YG1702)', async () => {
    const tsb = (await o.sup.query(`SELECT tsb_kodu FROM sigorta_sirketi WHERE durum = 'Aktif' LIMIT 1`)).rows[0]?.tsb_kodu as string;
    const sk = await o.gir('skd'); const hud = await o.gir('hud');
    expect((await o.ist('GET', '/api/sigorta-panel', await o.gir('ds'))).statusCode).toBe(404);
    const p = (await o.ist('POST', '/api/sigorta-panel/basvuru', sk, { tsbKodu: tsb, belgeler: ['Referanslar'] })).json().kimlik;
    expect((await o.ist('POST', `/api/sigorta-panel/basvuru/${p}`, sk, { islem: 'Başvuruyu Gönder' })).statusCode).toBe(409);
    const { PANEL_BELGELERI } = await import('../src/sigorta_panel.js');
    await o.ist('POST', `/api/sigorta-panel/basvuru/${p}`, sk, { islem: 'Belgeler', belgeler: PANEL_BELGELERI });
    expect((await o.ist('POST', `/api/sigorta-panel/basvuru/${p}`, sk, { islem: 'Başvuruyu Gönder' })).statusCode).toBe(200);
    const dt = (await o.ist('POST', '/api/sigorta-denetim-talebi', sk, { tsbKodu: tsb, konu: 'Hasar süreci denetimi', sonTarih: '2031-02-01' })).json().kimlik;
    expect((await o.ist('POST', `/api/sigorta-denetim-talebi/${dt}`, sk, { islem: 'Hukuk ve Uyum Görüşü İste' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/sigorta-denetim-talebi/${dt}`, hud, { islem: 'Görüşü Gönder', metin: 'Gizlilik sınırları içinde yanıtlanabilir' })).statusCode).toBe(200);
    expect((await o.ist('POST', `/api/sigorta-denetim-talebi/${dt}`, sk, { islem: 'Yanıtı Gönder', metin: 'Denetim tarihi teyit edildi' })).statusCode).toBe(200);
    expect((await o.kart('Sigorta Denetim Talebi', dt)).durum).toBe('Tamamlandı');
    const ir = (await o.ist('POST', '/api/kurumsal-itibar-riski', await o.gir('mpm'), { konu: 'Basında yer alan uyuşmazlık' })).json().kimlik;
    expect((await o.kart('Kurumsal İtibar Riski', ir)).oncelik).toBe('Kritik');
    expect((await o.ist('POST', `/api/kurumsal-itibar-riski/${ir}/ceoya-ilet`, sk, {})).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [o.K.cg, `itibar-ceo:${ir}`])).rows[0].n).toBe(1);
  });
});

describe('Sabit Hukuki Metinler (YG-1697)', () => {
  it('Hukuk ve Uyum yeni sürümü TR/EN birlikte CEO onayına gönderir; onayla yürürlüğe girer (T-YG1697-METIN)', async () => {
    const hud = await o.gir('hud');
    const l = (await o.ist('GET', '/api/hukuki-metinler', hud)).json(); expect(l.hazirlar).toBe(true);
    const tr = l.metinler.find((x: any) => x.kod === 'PRT-01' && x.dil === 'tr' && x.durum === 'Yürürlükte'); const en = l.metinler.find((x: any) => x.kod === 'PRT-01' && x.dil === 'en' && x.durum === 'Yürürlükte');
    expect((await o.ist('GET', '/api/hukuki-metinler', await o.gir('ds'))).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/hukuki-metin/PRT-01', hud, { tr: tr.govde, gerekce: 'G' })).statusCode).toBe(400);
    const r = await o.ist('POST', '/api/hukuki-metin/PRT-01', hud, { tr: `${tr.govde}\nEk madde`, en: `${en.govde}\nAdditional clause`, gerekce: 'Ek madde' }); expect(r.statusCode, r.body).toBe(200);
    const { sonSurum } = await import('../src/adimlar.js'); expect(await sonSurum(o.db, 'PRT-01')).toBe(tr.surum);
    const k = await o.kart('Hukuki Metin Onayı', `PRT-01|*|${r.json().surum}`); expect((await o.karar(k.kimlik, 'gmy', 'Onaya Gönder')).statusCode).toBe(200); expect((await o.karar(k.kimlik, 'cg', 'Onayla')).statusCode).toBe(200); // YG-541
    expect(await sonSurum(o.db, 'PRT-01')).toBe(r.json().surum);
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
