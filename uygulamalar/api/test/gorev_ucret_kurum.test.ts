import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kartAc } from '../src/is_motoru.js';
import { gorevUstKademe } from '../src/gorev_erteleme.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', opm: 'Operasyon Müdürü', cg: 'CEO', gmy: 'Genel Müdür Yardımcısı', tid: 'Ticari İşler Direktörü', ikm: 'İnsan Kaynakları Müdürü', iks: 'İnsan Kaynakları Sorumlusu', fym: 'Firma Yönetimi Müdürü', btd: 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü', mpy: 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test83', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });
const rol = async (ad: string) => (await o.sup.query(`SELECT kimlik FROM rol WHERE rol_adi = $1`, [ad])).rows[0].kimlik as string;

describe('görev erteleme ve üst kademe (YG-1359)', () => {
  it('gerekçeyle en çok iki kez ertelenir; süre aşılınca üst kademe de görür ve tamamlayabilir', async () => {
    const id = await kartAc(o.db, { tur: 'Deneme Görevi', kategori: 'gorev', baslik: 'Deneme', sahipRol: await rol('Dosya Sorumlusu'), sonZaman: new Date(Date.now() + 3_600_000) });
    const ds = await o.gir('ds'); const U = `/api/is/${id}/ertele`; const ileri = (g: number) => new Date(Date.now() + g * 86_400_000).toISOString();
    expect((await o.ist('POST', U, ds, { yeniSon: ileri(1) })).statusCode).toBe(400);
    expect((await o.ist('POST', U, ds, { yeniSon: new Date(Date.now() - 1000).toISOString(), gerekce: 'G' })).statusCode).toBe(400);
    expect((await o.ist('POST', U, await o.gir('opm'), { yeniSon: ileri(1), gerekce: 'G' })).statusCode).toBe(404);
    expect((await o.ist('POST', U, ds, { yeniSon: ileri(1), gerekce: 'Parça bekleniyor' })).statusCode).toBe(200);
    expect((await o.ist('POST', U, ds, { yeniSon: ileri(2), gerekce: 'Yine bekleniyor' })).statusCode).toBe(200);
    expect((await o.ist('POST', U, ds, { yeniSon: ileri(3), gerekce: 'Üçüncü' })).statusCode).toBe(409);
    expect((await o.ist('GET', `/api/is/${id}/ertelemeler`, ds)).json().length).toBe(2);
    await o.sup.query(`UPDATE is_karti SET son_zaman = now() - interval '1 hour' WHERE kimlik = $1`, [id]);
    expect(await gorevUstKademe(o.db)).toBeGreaterThan(0); expect(await gorevUstKademe(o.db)).toBe(0);
    const op = await o.gir('opm');
    expect((await o.ist('GET', '/api/bugun', op)).json().gorev.some((k: { kimlik: string }) => k.kimlik === id) || (await o.ist('GET', '/api/bugun', op)).json().islem.some((k: { kimlik: string }) => k.kimlik === id)).toBe(true);
    expect((await o.ist('POST', `/api/is/${id}/karar`, op, { karar: 'Tamamlandı' })).statusCode).toBe(200);
  });
});

describe('ücret bandı (YG-1082)', () => {
  it('asgari ücret olmadan bant girilmez; bant yalnız yetkiliye görünür; bant dışı teklif CEO onayına gider', async () => {
    const tid = await o.gir('tid'); const r = await rol('Dosya Sorumlusu');
    expect((await o.ist('GET', '/api/ucret-bandi', await o.gir('iks'))).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/ucret-bandi', await o.gir('ikm'), { rol: r, alt: 40000, ust: 60000 })).statusCode).toBe(404);
    expect((await o.ist('POST', '/api/ucret-bandi', tid, { rol: r, alt: 40000, ust: 60000 })).statusCode).toBe(409);
    expect((await o.ist('POST', '/api/ik/parametre', await o.gir('ikm'), { kod: 'asgari_ucret_brut_tl', deger: 30000 })).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/ucret-bandi', tid, { rol: r, alt: 20000, ust: 60000 })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/ucret-bandi', tid, { rol: r, alt: 40000, ust: 60000 })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/ucret-bandi', await o.gir('gmy'))).json().bantlar.length).toBe(1);
    const iks = await o.gir('iks');
    expect((await o.ist('POST', '/api/ucret-bandi/yetki', tid, { kullanici: o.K.iks })).statusCode).toBe(200);
    expect((await o.ist('GET', '/api/ucret-bandi', iks)).statusCode).toBe(200);
    await o.ist('POST', '/api/ucret-bandi/yetki', tid, { kullanici: o.K.iks, kaldir: true });
    expect((await o.ist('POST', '/api/ucret-teklifi', iks, { aday: 'Aday A', rol: r, brut: 25000 })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/ucret-teklifi', iks, { aday: 'Aday A', rol: r, brut: 50000 })).json().durum).toBe('Geçerli');
    expect((await o.ist('POST', '/api/ucret-teklifi', iks, { aday: 'Aday B', rol: r, brut: 70000 })).statusCode).toBe(400);
    const t = (await o.ist('POST', '/api/ucret-teklifi', iks, { aday: 'Aday B', rol: r, brut: 70000, gerekce: 'Deneyim' })).json(); expect(t.durum).toBe('CEO Onayında');
    expect(JSON.stringify((await o.ist('GET', '/api/ucret-teklifi', iks)).json())).not.toContain('brut_tl');
    const k = (await o.kart('Bant Dışı Ücret Teklifi', t.kimlik)).kimlik; expect((await o.karar(k, 'cg', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT durum FROM ucret_teklifi WHERE kimlik = $1`, [t.kimlik])).rows[0].durum).toBe('Onaylandı');
  });
});

describe('kurumsal iletişim talebi (YG-1556)', () => {
  it('Firma Yönetimi Müdürüne görev, Direktöre bilgi; yönlendirilen birim sonuçlandırır', async () => {
    const G = { kurumTuru: 'Sigorta Brokeri', kurumAdi: 'Deneme Broker', adSoyad: 'Kişi', eposta: 'kisi@broker.local' };
    expect((await o.ist('POST', '/api/iletisim/kurum-talebi', undefined, { ...G, kurumTuru: 'Yat Sahibi' })).statusCode).toBe(400);
    expect((await o.ist('POST', '/api/iletisim/kurum-talebi', undefined, G)).statusCode).toBe(200);
    expect((await o.ist('POST', '/api/iletisim/kurum-talebi', undefined, G)).statusCode).toBe(200);
    expect(Number((await o.sup.query(`SELECT count(*) n FROM kurum_talebi WHERE e_posta = $1`, [G.eposta])).rows[0].n)).toBe(1);
    const t = (await o.sup.query(`SELECT kimlik FROM kurum_talebi WHERE e_posta = $1`, [G.eposta])).rows[0].kimlik as string;
    expect((await o.kart('Kurumsal İletişim Talebi', t)).sahip_rol_ref).toBe(await rol('Firma Yönetimi Müdürü'));
    expect(Number((await o.sup.query(`SELECT count(*) n FROM bildirim WHERE kullanici_ref = $1 AND baslik LIKE 'Yeni Kurumsal İletişim Talebi%'`, [o.K.btd])).rows[0].n)).toBe(1);
    // YG-1560 (T-YG1560): giriş ekranından Çözüm Ortağı başvurusu aynı kuyruğa düşer
    expect((await o.ist('POST', '/api/iletisim/kurum-talebi', undefined, { ...G, kurumTuru: 'Çözüm Ortağı Adayı', eposta: 'aday1560@deneme.local' })).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT count(*)::int n FROM kurum_talebi WHERE kurum_turu = 'Çözüm Ortağı Adayı'`)).rows[0].n).toBe(1);
    expect((await o.ist('GET', '/api/kurum-talebi', await o.gir('ds'))).statusCode).toBe(404);
    const mpm = await rol('Müşteri ve Paydaş İlişkileri Müdürü');
    expect((await o.ist('POST', `/api/kurum-talebi/${t}/yonlendir`, await o.gir('btd'), { rol: mpm })).statusCode).toBe(404);
    expect((await o.ist('POST', `/api/kurum-talebi/${t}/yonlendir`, await o.gir('fym'), { rol: mpm })).statusCode).toBe(200);
    expect((await o.kart('Kurumsal İletişim Talebi', t)).durum).toBe('Tamamlandı');
    const m = await o.gir('mpm'); expect((await o.ist('GET', '/api/kurum-talebi', m)).json().talepler.length).toBe(1);
    expect((await o.ist('POST', `/api/kurum-talebi/${t}/sonuc`, m, { durum: 'Kapatıldı' })).statusCode).toBe(400);
    expect((await o.ist('POST', `/api/kurum-talebi/${t}/sonuc`, m, { durum: 'Davet Edildi' })).statusCode).toBe(409);
    // T-YG1701-KARAR: Kararı Kaydet → davet kendiliğinden, Firma Yönetimi Müdürüne sonuç
    expect((await o.ist('POST', `/api/kurum-talebi/${t}/karar`, m, { karar: 'Hesap Açılsın' })).statusCode).toBe(400);
    const kr = await o.ist('POST', `/api/kurum-talebi/${t}/karar`, m, { karar: 'Hesap Açılsın', gorusme: 'Çerçeve görüşme yapıldı; broker portalı açılacak' }); expect(kr.statusCode, kr.body).toBe(200);
    expect((await o.sup.query(`SELECT kullanici_grubu FROM kullanici_hesabi WHERE kimlik = $1`, [kr.json().kullanici])).rows[0].kullanici_grubu).toBe('Broker, Acente, Yat Brokeri, Kaptan');
    expect((await o.sup.query(`SELECT count(*)::int n FROM gonderim WHERE olay_anahtari = $1`, [`kurum-talebi-davet:${t}`])).rows[0].n).toBe(1);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [o.K.fym, `kurum-karar:${t}`])).rows[0].n).toBe(1);
    expect((await o.ist('POST', `/api/kurum-talebi/${t}/karar`, m, { karar: 'Hesap Açılmasın', gorusme: 'X' })).statusCode).toBe(409);
    expect((await o.kart('Kurumsal Talep Görüşmesi', t)).durum).toBe('Tamamlandı');
  });
});

describe('gelen talep (YG-1543, YG-1554)', () => {
  it('web formu konuya göre role görev açar; Diğer MPİ Müdürünce yönlendirilir; şikâyette dosya no zorunlu (T-YG1554)', async () => {
    const G = { adSoyad: 'Kişi', eposta: 'kisi@ornek.local', mesaj: 'Bilgi rica ederim' };
    expect((await o.ist('POST', '/api/iletisim/gelen-talep', undefined, { ...G, konu: 'Garanti veya şikâyet bildirimi' })).statusCode).toBe(400);
    const f = (await o.ist('POST', '/api/iletisim/gelen-talep', undefined, { ...G, konu: 'Fatura / ödeme' })).json();
    expect(f.talepNo).toMatch(/^GT-\d{4}-\d{4}$/);
    const fk = (await o.sup.query(`SELECT k.sahip_rol_ref, r.rol_adi FROM is_karti k JOIN gelen_talep g ON g.kimlik::text = k.nesne_kimligi JOIN rol r ON r.kimlik = k.sahip_rol_ref WHERE g.talep_no = $1`, [f.talepNo])).rows[0];
    expect(fk.rol_adi).toBe('Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)');
    const d = (await o.ist('POST', '/api/iletisim/gelen-talep', undefined, { ...G, konu: 'Bilinmeyen' })).json();
    const dk = (await o.sup.query(`SELECT g.kimlik, g.durum, g.konu FROM gelen_talep g WHERE g.talep_no = $1`, [d.talepNo])).rows[0];
    expect(dk).toMatchObject({ durum: 'Yönlendirme bekliyor', konu: 'Diğer' });
    expect((await o.ist('POST', `/api/gelen-talep/${dk.kimlik}/yonlendir`, await o.gir('btd'), { rol: 'Teknik Müdür' })).statusCode).toBe(404);
    { // T-YG1699: Müdür Yardımcısı yönlendiremez, hasar içerikli talebi Operasyona Aktarır
      const mpy = await o.gir('mpy');
      expect((await o.ist('POST', `/api/gelen-talep/${dk.kimlik}/yonlendir`, mpy, { rol: 'Teknik Müdür' })).statusCode).toBe(403);
      expect((await o.ist('POST', `/api/gelen-talep/${dk.kimlik}/operasyona-aktar`, mpy, {})).statusCode).toBe(200);
      expect((await o.sup.query(`SELECT yonlenen_rol FROM gelen_talep WHERE kimlik = $1`, [dk.kimlik])).rows[0].yonlenen_rol).toBe('Operasyon Müdürü');
      expect((await o.ist('POST', `/api/gelen-talep/${dk.kimlik}/yonlendir`, await o.gir('mpm'), { rol: 'Teknik Müdür' })).statusCode).toBe(200);
    }
  });
});
