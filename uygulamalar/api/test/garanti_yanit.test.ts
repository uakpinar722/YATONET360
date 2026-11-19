import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { garantiYanitTanim, sikayetHaftalikIsle } from '../src/garanti_yanit.js';
import { ortamKur, type Ortam } from './yardimci.js';

const KADRO = { ds: 'Dosya Sorumlusu', mpm: 'Müşteri ve Paydaş İlişkileri Müdürü', mpy: 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', opm: 'Operasyon Müdürü', oy: 'Operasyon Yöneticisi', tu: 'Teknik Uzman', skg: 'Strateji ve Kurumsal Gelişim Direktörü', km: 'Kalite Müdürü' };
let o: Ortam;
beforeAll(async () => { o = await ortamKur('yatonet360_test119', KADRO); }, 120_000);
afterAll(async () => { await o.kapat(); });

describe('Garanti ve Şikâyet Yanıt Yazısı (YG-728)', () => {
  it('şikâyet yanıtı onaylı metinle; onayla takip kontrolü ve PDF; itiraz üst kademe 120 saat; hakem sınırı parametreden', async () => {
    const d = await o.dosyaAc();
    await o.ekipKur(d.kimlik);
    const g = (await o.sup.query(`INSERT INTO garanti_sikayet (kayit_no, dosya_ref, kayit_turu, kanal, bildirim_zamani, oncelik, sikayet_konusu, sikayet_sonucu, karar_veren_ref, statu, yanit_son, olusturan_ref) VALUES ($1,$2,'{Şikâyet}','WhatsApp','2026-11-25','Normal','Gelcoat renk farkı','Haklı – Düzeltildi',$3,'Karar','2026-12-09',$3) RETURNING kimlik`, [`${d.dosyaNo}-SK01`, d.kimlik, o.K.ty])).rows[0].kimlik;
    const ds = await o.gir('ds');
    { const gc = (await o.ist('GET', `/api/garanti-sikayet/${g}/gecmis`, ds)).json(); expect(gc.dosya.dosya_no).toBe(d.dosyaNo); for (const k of ['oncekiDosyalar', 'firmalar', 'parcalar', 'testler', 'teslim', 'belgeler', 'oncekiKayitlar']) expect(Array.isArray(gc[k])).toBe(true); } // YG-084
    expect((await o.ist('GET', `/api/garanti-sikayet/${g}/yanit`, await o.gir('mpy'))).json().hazirlar).toBe(true);
    // YG-1424 (T-YG1424): yanıtsız şikâyette haftada bir ara bilgilendirme hatırlatması
    await o.sup.query(`UPDATE garanti_sikayet SET olusturma_zamani = now() - interval '8 days' WHERE kimlik = $1`, [g]);
    expect(await sikayetHaftalikIsle(o.db)).toBe(1); expect(await sikayetHaftalikIsle(o.db)).toBe(0);
    expect((await o.sup.query(`SELECT count(*)::int n FROM bildirim WHERE kullanici_ref = $1 AND olay_anahtari = $2`, [o.K.mpy, `sikayet-haftalik:${g}:1`])).rows[0].n).toBe(1);
    expect((await o.ist('POST', `/api/garanti-sikayet/${g}/yanit-yazisi`, await o.gir('tu'), { varyant: 'Şikâyet Yanıtı', inceleme: 'X' })).statusCode).not.toBe(200);
    expect((await o.ist('POST', `/api/garanti-sikayet/${g}/yanit-yazisi`, ds, { varyant: 'Şikâyet Yanıtı', inceleme: 'X' })).json().hata).toMatch(/Düzeltmenin tamamlandığı/);
    const r = await o.ist('POST', `/api/garanti-sikayet/${g}/yanit-yazisi`, ds, { varyant: 'Şikâyet Yanıtı', inceleme: 'Yerinde incelendi.', duzeltmeTarihi: '2026-12-05', islemler: [{ islem: 'Son kat yenilendi', tarih: '04.12.2026', durum: 'Tamamlandı' }] });
    expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ yaziNo: `${d.dosyaNo}-SK01-Y1`, gonderilecek: 'Müşteri ve Paydaş İlişkileri Müdürü' });
    const k = await o.kart('Garanti Şikâyet Yanıtı', r.json().kimlik);
    expect((await o.karar(k.kimlik, 'mpm', 'Onayla')).statusCode).toBe(200);
    expect((await o.sup.query(`SELECT 1 FROM belge_uretim WHERE tur = 'Garanti Şikâyet Yanıtı' AND nesne = $1`, [r.json().kimlik])).rowCount).toBe(1);
    expect((await o.kart('Takip Kontrolü', g))).toBeDefined();
    const t = (await garantiYanitTanim(o.db, r.json().kimlik)).t; const j = JSON.stringify(t);
    expect(t.matbuBas![1]).toBe('KONU: ŞİKÂYETİNİZE YANIT 25.11.2026 tarihinde ilettiğiniz şikâyetiniz kayda alınmış, incelenmiş ve sonucu aşağıda bilgilerinize sunulmuştur. Yaşadığınız olumsuzluk için üzgünüz.');
    expect(j).toContain('186.000,00 TL’ye kadar'); expect(j).toContain('05.12.2026 tarihinden itibaren yeniden 12 ay'); expect(j).toContain('Tarafınıza yansıtılmamıştır'); expect(j).toContain('Takip Kontrolü');
    // itiraz (YG-1484): şikâyet itirazı Strateji ve Kurumsal Gelişim Direktörüne, 120 saat
    const it = (await o.ist('POST', `/api/garanti-sikayet/${g}/itiraz`, ds, { aciklama: 'Renk hâlâ farklı' })).json();
    expect(it.makam).toBe('Strateji ve Kurumsal Gelişim Direktörü'); expect(new Date(it.son).getTime() - Date.now()).toBeGreaterThan(119 * 3_600_000);
    expect((await o.ist('POST', `/api/garanti-sikayet/${g}/itiraz-karar`, await o.gir('tm'), { sonuc: 'Ret', gerekce: 'G' })).statusCode).toBe(403);
    expect((await o.ist('POST', `/api/garanti-sikayet/${g}/itiraz-karar`, await o.gir('skg'), { sonuc: 'Kısmen Kabul', gerekce: 'Ek rötuş' })).statusCode).toBe(200);
    { // T-YG1701: Kaliteye Yönlendir
      expect((await o.ist('POST', `/api/garanti-sikayet/${g}/kaliteye-yonlendir`, await o.gir('mpy'), { aciklama: 'X' })).statusCode).toBe(403);
      expect((await o.ist('POST', `/api/garanti-sikayet/${g}/kaliteye-yonlendir`, await o.gir('mpm'), { aciklama: 'Aynı boya şikâyeti üçüncü kez' })).statusCode).toBe(200);
      expect(await o.kart('Sistemsel Neden İncelemesi', g)).toBeDefined();
      expect((await o.ist('POST', `/api/garanti-sikayet/${g}/kaliteye-yonlendir`, await o.gir('mpm'), { aciklama: 'Y' })).statusCode).toBe(409);
    }
    const r2 = await o.ist('POST', `/api/garanti-sikayet/${g}/yanit-yazisi`, ds, { varyant: 'İtiraz İnceleme Sonucu', inceleme: 'Üst kademe inceledi.' });
    expect(r2.json().yaziNo).toBe(`${d.dosyaNo}-SK01-Y2`);
    expect((await garantiYanitTanim(o.db, r2.json().kimlik)).t.matbuBas![1]).toMatch(/^KONU: İTİRAZINIZIN İNCELEME SONUCU \d{2}\.\d{2}\.\d{4} tarihinde ilettiğiniz itirazınız/);
  });
});
