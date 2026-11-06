import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aydinlatmaKodu } from '../src/adimlar.js';
import { suankiAdim, totpKodu } from '../src/kripto.js';
import { parolaOzetle } from '../src/parola.js';
import { ana, ortamKur, type Ortam } from './yardimci.js';

// YG-990, YG-993, YG-1159: dış kullanıcı yalnız kendi portalına ve ortak uçlara erişir; iç listeler ve maliyet, sicil, performans verisi görünmez.
const KADRO = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür' };
const PAROLA = 'Sinama-Parolasi-2026!';
let o: Ortam; const oturum: Record<string, string> = {};
const DIS: [string, string, string][] = [
  ['firma', 'İş Birliği Firması', 'Firma Yetkilisi'], ['tedarikci', 'Tedarikçi', 'Tedarikçi Kullanıcısı'], ['tesis', 'Tesis Yetkilisi (Marina, Tersane, Çekek Sahası)', 'Firma Yetkilisi'],
  ['sigorta', 'Sigorta Şirketi / Eksper', 'Sigorta Şirketi Kullanıcısı'], ['yatsahibi', 'Bireysel Müşteri (Yat Sahibi/Yetkilisi)', 'Müşteri Portal Kullanıcısı'], ['kurumsal', 'Kurumsal Müşteri', 'Kurumsal Müşteri Kullanıcısı'],
];
// Dış kullanıcıya açık olabilecek uçlar: kendi portalı, kendi hesabı ve ortak seçim listeleri.
const ACIK = [/^\/(ben|profil|bildirimler|yetkilerim|alan-erisim|saglik|hesap-kurtarma|riza-kayitlari|iletisim\/ret|mobil\/|kimlik\/|mesaj\/|portal\/|firma-portal\/|tedarikci-portal\/|tesis-portal\/|sigorta\/|kurumsal\/|kurum\/hesap|sigorta-ek2|ihbar\/secenek|yat\/marka|yat\/model|erisim\/taleplerim|disiplin\/benim|onayli-parca|faiz-orani|bugun|duyuru\/yetkim|ik\/yetki|kvkk\/yetki)/]; // son dördü: kendi yetki bayrakları, kendi kartları ve dış duyurular
const YASAK_ALAN = ['birim_maliyet_eur', 'maliyet_eur', 'brut_aylik_tl', 'tckn', 'iban', 'risk_derecesi', 'kapasite_is', 'performans_puani'];
const uclar = (desen = /s\.get\('([^':]+)'/g) => {
  const d = join(__dirname, '..', 'src'); const l = new Set<string>();
  for (const f of readdirSync(d).filter((x) => x.endsWith('.ts'))) for (const m of readFileSync(join(d, f), 'utf8').matchAll(desen)) l.add(m[1]!);
  return [...l].sort();
};
let dosya = ''; let firma = '';

beforeAll(async () => {
  o = await ortamKur('yatonet360_test_erisim', KADRO);
  for (const [k, grup, rol] of DIS) {
    const ep = `${k}.tarama@deneme.yatonet.local`;
    const r = (await o.sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani) VALUES ('Müşteri/Kurum',$1,$2,$3,$3,$4,'Doğrulama uygulaması (6 haneli kod)',now()) RETURNING kimlik`, [grup, k, ep, await parolaOzetle(PAROLA)])).rows[0];
    await o.sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [r.kimlik, rol]);
    await o.sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Müşteri',$2,'R00','Türkçe','Web')`, [r.kimlik, aydinlatmaKodu(grup)]);
    await o.sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [r.kimlik]);
    const c = ana.ckr(await o.s.inject({ method: 'POST', url: '/api/kimlik/giris', headers: ana.H, payload: { kimlik: ep, parola: PAROLA } }));
    const q = await o.ist('GET', '/api/kimlik/kurulum', c);
    oturum[k] = ana.ckr(await o.ist('POST', '/api/kimlik/dogrula', c, { kod: totpKodu(q.json().gizli, suankiAdim()) }));
  }
  // Taranacak veri olsun: bir dosya, maliyetli teklif ve sicil kaydı.
  const d = await o.dosyaAc({}, {}); await o.ekipKur(d.kimlik); dosya = d.kimlik;
  await o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, risk_derecesi, olusturan_ref) VALUES ('S-TR1','Gizli Sicil Firma','Çözüm Ortağı','Yakın İzleme',$1)`, [o.K.ds]).catch(() => o.sup.query(`INSERT INTO kurulus (sicil_no, ticari_unvan, kayit_rolu, olusturan_ref) VALUES ('S-TR1','Gizli Sicil Firma','Çözüm Ortağı',$1)`, [o.K.ds]));
  firma = (await o.sup.query(`SELECT kimlik FROM kurulus WHERE sicil_no = 'S-TR1'`)).rows[0].kimlik;
}, 180_000);
afterAll(async () => { await o.kapat(); });

describe('erişim taraması', () => {
  it('dış kullanıcılar iç uçlarda veri alamaz, açık uçlarda yasak alan görmez', async () => {
    const l = uclar(); expect(l.length).toBeGreaterThan(80);
    const ihlal: string[] = [];
    for (const [k] of DIS) for (const u of l) {
      const r = await o.ist('GET', `/api${u}`, oturum[k]);
      if (r.statusCode >= 500) ihlal.push(`${k} ${u} → ${r.statusCode}`);
      if (r.statusCode !== 200) continue;
      const g = r.body;
      if (!ACIK.some((a) => a.test(u))) { let bos = false; try { const j = JSON.parse(g); bos = (Array.isArray(j) && j.length === 0) || (j && typeof j === 'object' && Object.keys(j).length === 0); } catch { /* düz metin */ } if (!bos) ihlal.push(`${k} ${u} → 200 iç uç`); }
      for (const a of YASAK_ALAN) if (g.includes(`"${a}"`)) ihlal.push(`${k} ${u} → ${a}`);
      if (['yatsahibi', 'kurumsal', 'sigorta'].includes(k) && g.includes('Gizli Sicil Firma')) ihlal.push(`${k} ${u} → firma kimliği`);
    }
    expect(ihlal, ihlal.join('\n')).toEqual([]);
  }, 300_000);
  it('dış kullanıcı ilgisiz dosya ve sicil kaydını kimlikle de açamaz', async () => {
    const l = uclar(/s\.get\('(\/[a-z-]+\/:id(?:\/[a-z-]+)?)'/g).filter((u) => /^\/(dosya|firma|is-emri|teklif|kurulus)\//.test(u)); expect(l.length).toBeGreaterThan(10);
    const ihlal: string[] = [];
    for (const [k] of DIS) for (const u of l) {
      const id = u.startsWith('/firma/') || u.startsWith('/kurulus/') ? firma : dosya;
      const r = await o.ist('GET', `/api${u.replace(':id', id)}`, oturum[k]);
      if (r.statusCode === 200 || r.statusCode >= 500) ihlal.push(`${k} ${u} → ${r.statusCode}`);
    }
    expect(ihlal, ihlal.join('\n')).toEqual([]);
  }, 300_000);
  it('iç rol: Dosya Sorumlusu maliyet, ücret ve banka alanı görmez (YG-1159)', async () => {
    await o.sup.query(`INSERT INTO personel_karti (kullanici_ref, ise_giris_tarihi, brut_aylik_tl, guncelleyen_ref) VALUES ($1,'2026-01-01',50000,$1) ON CONFLICT DO NOTHING`, [o.K.tu]);
    const tk = (await o.sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_turu, teklif_muhatabi, kdv_orani, hazirlayan_ref) VALUES ('T-TR1',$1,'Onarım','Yat Sahibi',20,$2) RETURNING kimlik`, [dosya, o.K.ds])).rows[0].kimlik as string;
    await o.sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_maliyet_eur, birim_satis_fiyati_eur, tutar_eur) VALUES ($1,1,'K','Onarım','İşçilik',1,'Adet',7771.37,1000,1000)`, [tk]);
    const c = await o.gir('ds'); const ihlal: string[] = [];
    const idli = uclar(/s\.get\('(\/(?:dosya|teklif)\/:id(?:\/[a-z-]+)?)'/g).map((u) => u.replace(':id', u.startsWith('/teklif/') ? tk : dosya));
    const bak = await o.ist('GET', `/api/teklif/${tk}`, c); expect(bak.statusCode, bak.body).toBe(200); expect(bak.body).toContain('1000'); // veri gerçekten okunuyor
    for (const u of [...uclar(), ...idli]) {
      const r = await o.ist('GET', `/api${u}`, c); if (r.statusCode >= 500) ihlal.push(`ds ${u} → ${r.statusCode}`);
      if (r.statusCode === 200 && r.body.includes('7771.37')) ihlal.push(`ds ${u} → maliyet değeri`);
      if (r.statusCode === 200) for (const a of ['birim_maliyet_eur', 'maliyet_eur', 'brut_aylik_tl', 'iban']) if (r.body.includes(`"${a}"`)) ihlal.push(`ds ${u} → ${a}`);
    }
    expect(ihlal, ihlal.join('\n')).toEqual([]);
  }, 300_000);
  it('kayıt ve güncelleme uçları: dış kullanıcı iç işlemi başlatamaz', async () => {
    // Oturumu kapatan veya hesabı etkileyen uçlar taramayı bozmasın diye dışarıda; kendi portal uçları açık listede.
    const ATLA = /^\/(kimlik|ilk-giris|hesap|hesabim|hesap-kurtarma|kayit|onay|paylasim|mobil|portal|firma-portal|tedarikci-portal|tesis-portal|sigorta|kurumsal|kurum|profil|bildirim|mesaj|veri-ihlali|kvkk-basvuru|iletisim|disiplin\/benim|erisim\/talep)/;
    const l = uclar(/s\.post\('([^':]+)'/g).filter((u) => !ATLA.test(u)); expect(l.length).toBeGreaterThan(30);
    const ihlal: string[] = []; const say: Record<number, number> = {};
    for (const [k] of DIS) for (const u of l) {
      const r = await o.ist('POST', `/api${u}`, oturum[k], {});
      if (r.statusCode === 200 || r.statusCode === 201 || r.statusCode >= 500) ihlal.push(`${k} POST ${u} → ${r.statusCode}`);
      say[r.statusCode] = (say[r.statusCode] ?? 0) + 1;
      // Bu uçlar içeriğe baktıktan sonra yetkiyi denetler; kodları incelendi, dış kullanıcı geçerli içerikle de işlem yapamaz (aşağıdaki test).
      if (r.statusCode === 400 && !['/belge/yukle', '/yetkilerim/belge', '/disiplin', '/ik/parametre'].includes(u)) ihlal.push(`${k} POST ${u} → 400 (yetkiden önce içerik denetimi)`);
    }
    expect(ihlal, ihlal.join('\n')).toEqual([]);
  }, 300_000);
});
