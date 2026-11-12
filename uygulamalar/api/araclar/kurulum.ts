// Geliştirme ortamını kurar: gizli değerler, veritabanı, göçler, başlangıç verisi, deneme hesapları. Tekrar çalıştırılabilir.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import pg from 'pg';
import { ENV_YOLU, KOK, ortamOku } from '../src/ayarlar.js';
import { parolaOzetle } from '../src/parola.js';

export const AYRICALIKLI = new Set(['Sistem Yöneticisi']);

function kademeBul(ad: string) {
  if (['CEO', 'CEO Asistanı', 'Genel Müdür Yardımcısı'].includes(ad)) return ad;
  for (const [son, k] of [['Direktörü', 'Direktör'], ['Müdür Yardımcısı', 'Müdür Yardımcısı'], ['Müdürü', 'Müdür'], ['Müdür', 'Müdür'], ['Yöneticisi', 'Yönetici'], ['Yönetici', 'Yönetici']] as const) {
    if (ad === 'Sistem Yöneticisi') return 'Sistem Yöneticisi';
    if (ad.endsWith(son)) return k;
  }
  const ozel: Record<string, string> = { 'Dosya Sorumlusu': 'Dosya Sorumlusu', 'Saha Sorumlusu': 'Saha Sorumlusu', 'Tedarik Sorumlusu': 'Tedarik Sorumlusu', 'Sicil Sorumlusu': 'Sicil Sorumlusu', 'Bilgi İşlem Destek Sorumlusu': 'Destek Sorumlusu', 'İç Denetçi': 'Denetçi', 'Teknik Uzman': 'Uzman', 'Kalite Uzmanı (Kalite Kontrolör)': 'Kalite Uzmanı', 'İSG Uzmanı': 'İSG Sorumlusu', 'Hukuk ve Uyum Uzmanı': 'Hukuk ve Uyum Uzmanı' };
  return ozel[ad] ?? 'Sorumlu';
}

const DIS_ROLLER: [string, string, string][] = [ // YG-1030, YG-1025
  ['Firma Yetkilisi', 'Dış Kullanıcı', 'İş Birliği Firması'],
  ['Müşteri Portal Kullanıcısı', 'Dış Kullanıcı', 'Bireysel Müşteri (Yat Sahibi/Yetkilisi)'],
  ['Kurumsal Müşteri Kullanıcısı', 'Dış Kullanıcı', 'Kurumsal Müşteri'],
  ['Sigorta Şirketi Kullanıcısı', 'Dış Kullanıcı', 'Sigorta Şirketi / Eksper'],
  ['Broker, Acente, Yat Brokeri, Kaptan', 'Dış Kullanıcı', 'Broker, Acente, Yat Brokeri, Kaptan'],
  ['Tesis Yetkilisi', 'Dış Kullanıcı', 'Tesis Yetkilisi (Marina, Tersane, Çekek Sahası)'],
  ['Tedarikçi Kullanıcısı', 'Dış Kullanıcı', 'Tedarikçi'],
  ['Muhasebe Hizmeti', 'Dış Kullanıcı', 'Muhasebe Hizmeti'],
];

// Yetki matrisinin başlangıcı. İzinler modüller yazıldıkça eklenir (YG-996).
const IZINLER: [string, string][] = [
  ['Sistem Yöneticisi', 'rol_katalogu.goruntule'], ['Bilgi İşlem Müdürü', 'rol_katalogu.goruntule'], ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'rol_katalogu.goruntule'],
  ['Sistem Yöneticisi', 'erisim.uygula'], // A33-2
  ['Bilgi İşlem Destek Sorumlusu', 'hesap_kurtarma.ac'], // A32-3
  // Dosya modülü: ihbarı Operasyon kadrosu kaydeder; ekip atamaları YG-047, YG-048; dosya.tum yönetim görünümü.
  ...['Dosya Sorumlusu', 'Operasyon Yöneticisi', 'Operasyon Müdür Yardımcısı', 'Operasyon Müdürü', 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı'].map((r) => [r, 'ihbar.kaydet'] as [string, string]),
  ['Operasyon Müdürü', 'dosya.ata.operasyon'], ['Teknik Müdür', 'dosya.ata.teknik'], ['Kalite Müdürü', 'dosya.ata.kalite'], ['Tedarik Yönetimi Müdürü', 'dosya.ata.tedarik'],
  ['Operasyon Müdürü', 'dosya.statu'], ['Operasyon Müdür Yardımcısı', 'dosya.statu'], ['Operasyon Yöneticisi', 'dosya.statu'],
  ...['CEO', 'Genel Müdür Yardımcısı', 'Teknik ve Operasyon Direktörü', 'Ticari İşler Direktörü', 'Hukuk ve Uyum Direktörü', 'Risk ve Kalite Direktörü', 'Operasyon Müdürü', 'Operasyon Müdür Yardımcısı', 'Teknik Müdür', 'Teknik Müdür Yardımcısı', 'Müşteri ve Paydaş İlişkileri Müdürü', 'İç Denetim Müdürü', 'İç Denetçi', 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', 'Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdür Yardımcısı', 'Muhasebe ve Finans Müdürü', 'Kalite Müdürü', 'Kalite Müdür Yardımcısı', 'Tedarik Yönetimi Müdürü', 'Tedarik Müdür Yardımcısı'].map((r) => [r, 'dosya.tum'] as [string, string]),
  ...['Dosya Sorumlusu', 'Teknik Uzman', 'Teknik Yönetici', 'Operasyon Yöneticisi', 'Teknik Müdür', 'Operasyon Müdürü'].map((r) => [r, 'yat.duzelt'] as [string, string]),
  ['Operasyon Müdür Yardımcısı', 'nobet.hazirla'], ['Operasyon Müdürü', 'nobet.hazirla'],
  ['Sicil Sorumlusu', 'firma.kayit'], ['Firma Yönetimi Müdürü', 'firma.kayit'], ['Firma Yönetimi Müdürü', 'firma.onay'], ['Bilgi Teknolojileri ve Firma Yönetimi Direktörü', 'firma.onay'],
  ['İç Denetçi', 'denetim_izi.goruntule'], ['İç Denetim Müdürü', 'denetim_izi.goruntule'], ['Bilgi İşlem Müdürü', 'denetim_izi.goruntule'],
];

export async function kurVeritabani(ad: string, ayar: { superParola: string; uygulamaParola: string; denemeHesap: boolean }) {
  const bag = (database: string) => new pg.Client({ host: 'localhost', port: 5432, user: 'postgres', password: ayar.superParola, database });
  const a = bag('postgres'); await a.connect();
  const rol = await a.query(`SELECT 1 FROM pg_roles WHERE rolname = 'yatonet_uygulama'`);
  const parola = `'${ayar.uygulamaParola.replace(/'/g, "''")}'`;
  await a.query(rol.rowCount ? `ALTER ROLE yatonet_uygulama LOGIN PASSWORD ${parola}` : `CREATE ROLE yatonet_uygulama LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${parola}`);
  if (!(await a.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [ad])).rowCount) await a.query(`CREATE DATABASE "${ad}"`);
  await a.end();
  const c = bag(ad); await c.connect();
  await c.query(`CREATE TABLE IF NOT EXISTS sema_gocu (dosya text PRIMARY KEY, uygulama_zamani timestamptz NOT NULL DEFAULT now())`);
  const klasor = join(KOK, 'veritabani', 'gocler');
  for (const f of readdirSync(klasor).filter((x) => x.endsWith('.sql')).sort()) {
    if ((await c.query(`SELECT 1 FROM sema_gocu WHERE dosya = $1`, [f])).rowCount) continue;
    await c.query('BEGIN');
    try { await c.query(readFileSync(join(klasor, f), 'utf8')); await c.query(`INSERT INTO sema_gocu (dosya) VALUES ($1)`, [f]); await c.query('COMMIT'); console.log('göç uygulandı:', f); }
    catch (e) { await c.query('ROLLBACK'); throw e; }
  }
  // Değer listeleri (YG-1124)
  const dl = readFileSync(join(KOK, 'veri', 'deger_listeleri.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
  await c.query('BEGIN');
  for (const d of dl) await c.query(`INSERT INTO deger_listesi VALUES ($1,$2,$3,$4,$5) ON CONFLICT (liste_kodu, deger) DO UPDATE SET aciklama = EXCLUDED.aciklama, kaynak = EXCLUDED.kaynak, sira = EXCLUDED.sira`, [d[0], d[1], d[2] || null, d[3] || null, Number(d[4])]);
  // Roller
  const ic = readFileSync(join(KOK, 'veri', 'roller.tsv'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t') as [string, string]);
  let n = 0;
  for (const [adi, birim] of ic) await c.query(`INSERT INTO rol (kimlik, rol_adi, rol_sahibi_birim, kademe, kullanici_gruplari, ayricalikli_rol) VALUES ($1,$2,$3,$4,'LGM İç Rolü',$5) ON CONFLICT (rol_adi) DO UPDATE SET rol_sahibi_birim = EXCLUDED.rol_sahibi_birim, kademe = EXCLUDED.kademe`, [`ROL-${String(++n).padStart(3, '0')}`, adi, birim, kademeBul(adi), AYRICALIKLI.has(adi)]);
  for (const [adi, birim, grup] of DIS_ROLLER) await c.query(`INSERT INTO rol (kimlik, rol_adi, rol_sahibi_birim, kademe, kullanici_gruplari) VALUES ($1,$2,$3,'Dış Kullanıcı',$4) ON CONFLICT (rol_adi) DO NOTHING`, [`ROL-${String(++n).padStart(3, '0')}`, adi, birim, grup]);
  for (const [adi, izin] of IZINLER) await c.query(`INSERT INTO rol_izni SELECT kimlik, $2 FROM rol WHERE rol_adi = $1 ON CONFLICT DO NOTHING`, [adi, izin]);
  // Hukuki metinler (R\KVKK onaylı belgelerden aktarılır)
  const mk = join(KOK, 'veri', 'metinler');
  for (const f of readdirSync(mk).filter((x) => x.endsWith('.json'))) {
    const m = JSON.parse(readFileSync(join(mk, f), 'utf8'));
    await c.query(`INSERT INTO hukuki_metin (kod, dil, surum, baslik, govde) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (kod, dil, surum) DO UPDATE SET baslik = EXCLUDED.baslik, govde = EXCLUDED.govde`, [m.kod, m.dil, m.surum, m.baslik, JSON.stringify(m.govde)]);
  }
  // Yat Marka-Model Ana Verisi LGM-2026-012 (YG-1527). Toplu yüklenir; yalnız ilk kurulumda.
  if (!(await c.query(`SELECT 1 FROM yat_marka_model LIMIT 1`)).rowCount) {
    const mm = readFileSync(join(KOK, 'veri', 'yat_marka_model.tsv'), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));
    const sayi = (s: string | undefined) => { const n = Number((s ?? '').replace(/\./g, '').replace(',', '.')); return s && Number.isFinite(n) && n > 0 ? n : null; };
    const sutun = (f: (r: string[]) => unknown) => mm.map(f);
    await c.query(
      `INSERT INTO yat_marka_model (marka_kodu, marka, model, turkiye_kaynakli, katalog_seri, katalog_no, tekne_turu, boy_m, govde_malzemesi, tahrik_turu, fotograf, teknik_veri, durum)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[], $5::int[], $6::text[], $7::text[], $8::numeric[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[])`,
      [sutun((r) => r[0]), sutun((r) => r[1]), sutun((r) => r[2]), sutun((r) => r[3] === 'Evet'), sutun((r) => (r[4] && /^\d+$/.test(r[4]) ? Number(r[4]) : null)), sutun((r) => r[5] || null), sutun((r) => r[6] || null), sutun((r) => { const v = sayi(r[7]); return v !== null && v < 10000 ? v : null; }), sutun((r) => (['Fiber', 'Ahşap', 'Çelik', 'Alüminyum'].includes(r[8] ?? '') ? r[8] : null)), sutun((r) => r[9] || null), sutun((r) => r[10] || null), sutun((r) => r[11] || null), sutun((r) => r[12] || null)]);
  }
  // Kartela: CEO'nun Excel çalışması bitene kadar 2026.2 Taslak olarak yüklenir (KRT-8 sonrası Yürürlükte).
  // KRT-8: kurulu sistemde sürüm ve maliyetler kaynak dosyayla eşitlenir; kart önerisiyle eklenen kalemlere dokunulmaz.
  if ((await c.query(`SELECT 1 FROM kartela_surumu LIMIT 1`)).rowCount) {
    await c.query(`UPDATE kartela_surumu SET durum = 'Yürürlükte', yururluk = '2027-01-01' WHERE surum = '2026.2'`);
    const kl = readFileSync(join(KOK, 'veri', 'kartela_2026_2.tsv'), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));
    await c.query(`UPDATE kartela_kalemi k SET maliyet_eur = t.m, birim = t.b FROM unnest($1::text[], $2::numeric[], $3::text[]) t(a, m, b) WHERE k.kod = t.a AND k.surum = '2026.2' AND (k.maliyet_eur <> t.m OR k.birim <> t.b)`, [kl.map((r) => r[0]), kl.map((r) => r[6]), kl.map((r) => r[5])]);
    await c.query(`DELETE FROM kartela_kalemi WHERE surum = '2026.2' AND kod NOT LIKE 'KO-%' AND NOT kod = ANY($1)`, [kl.map((r) => r[0])]); // KRT-10
  }
  if (!(await c.query(`SELECT 1 FROM kartela_surumu LIMIT 1`)).rowCount) {
    await c.query(`INSERT INTO kartela_surumu VALUES ('2026.2', 'Yürürlükte', '2027-01-01')`); // KRT-8
    const kl = readFileSync(join(KOK, 'veri', 'kartela_2026_2.tsv'), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));
    await c.query(`INSERT INTO kartela_kalemi SELECT a, '2026.2', b, d, e, f, g, h FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::numeric[]) t(a, b, d, e, f, g, h)`, [kl.map((r) => r[0]), kl.map((r) => r[1]), kl.map((r) => r[2]), kl.map((r) => r[3]), kl.map((r) => r[4]), kl.map((r) => r[5]), kl.map((r) => Number(r[6]))]);
    const by = readFileSync(join(KOK, 'veri', 'kartela_birlikte_yazilmaz.tsv'), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));
    for (const r of by) await c.query(`INSERT INTO kartela_birlikte_yazilmaz VALUES ($1,$2,$3)`, [r[0], r[1]!.split(' ').filter(Boolean), r[2]]);
  }
  // KLS-1: ilk resmî / klas onayı etiket seti bir kez uygulanır; sonrasını Teknik Müdür yönetir.
  if (!(await c.query(`SELECT 1 FROM sema_gocu WHERE dosya = 'kls1_resmi_onay_etiketi'`)).rowCount) {
    const br = readFileSync(join(KOK, 'veri', 'kartela_resmi_onay_branslari.tsv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
    for (const x of br) if (!(await c.query(`SELECT 1 FROM kartela_kalemi WHERE ana_brans = $1 LIMIT 1`, [x])).rowCount) throw new Error(`KLS-1: kartelada olmayan branş: ${x}`);
    await c.query(`UPDATE kartela_kalemi SET resmi_onay_gerekebilir = true WHERE ana_brans = ANY($1::text[])`, [br]);
    await c.query(`INSERT INTO sema_gocu (dosya) VALUES ('kls1_resmi_onay_etiketi')`);
  }
  // KLS-2: şanzıman, şaft ve pervane branşı etiket setine eklenir (bir kez).
  if (!(await c.query(`SELECT 1 FROM sema_gocu WHERE dosya = 'kls2_resmi_onay_etiketi'`)).rowCount) {
    await c.query(`UPDATE kartela_kalemi SET resmi_onay_gerekebilir = true WHERE ana_brans = 'Şanzıman, şaft ve pervane sistemi'`);
    await c.query(`INSERT INTO sema_gocu (dosya) VALUES ('kls2_resmi_onay_etiketi')`);
  }
  // Onaylı metin kütüphanesi (YG-600, YG-626, YG-692). Kaynak: YATONET 360 KAYNAK\sablon.
  const tsv = (d: string) => readFileSync(join(KOK, 'veri', 'sablon', d), 'utf8').split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split('\t'));
  const metin = async (kod: string, dil: string, tur: string, baslik: string | null, m: string | undefined) => {
    if (!m) return;
    const son = (await c.query(`SELECT surum, metin, baslik, durum, hazirlayan_ref FROM sablon_metni WHERE kod = $1 AND dil = $2 ORDER BY surum DESC LIMIT 1`, [kod, dil])).rows[0];
    if (!son) { await c.query(`INSERT INTO sablon_metni (kod, dil, tur, baslik, metin, onay_dayanagi, yayim_zamani) VALUES ($1,$2,$3,$4,$5,'CEO onaylı metin kütüphanesi (kurulum)',now())`, [kod, dil, tur, baslik, m]); return; }
    // YG-600: uygulama içinden yönetilen metne kurulum dokunmaz; katalogdaki değişiklik yeni sürüm olur, eski sürüm Yerine Geçti.
    if (son.hazirlayan_ref || son.durum !== 'Yürürlükte') return;
    if (son.metin === m && son.baslik === baslik) return;
    if (son.metin === m) { await c.query(`UPDATE sablon_metni SET baslik = $4 WHERE kod = $1 AND dil = $2 AND surum = $3`, [kod, dil, son.surum, baslik]); return; }
    await c.query(`UPDATE sablon_metni SET durum = 'Yerine Geçti' WHERE kod = $1 AND dil = $2 AND surum = $3`, [kod, dil, son.surum]);
    await c.query(`INSERT INTO sablon_metni (kod, dil, surum, tur, baslik, metin, onay_dayanagi, degisiklik_gerekcesi, yayim_zamani) VALUES ($1,$2,$3,$4,$5,$6,'CEO onaylı metin kütüphanesi (kurulum)','Katalog güncellemesi',now())`, [kod, dil, `R${String(Number(String(son.surum).replace(/\D/g, '')) + 1).padStart(2, '0')}`, tur, baslik, m]);
  };
  for (const [kod, tr, en] of tsv('matbu_M1_M10.tsv')) { await metin(kod!, 'tr', 'Matbu', null, tr); await metin(kod!, 'en', 'Matbu', null, en); }
  for (const r of tsv('bildirim_katalog.tsv')) { await metin(r[0]!, 'tr', 'Bildirim', `${r[1]} · ${r[2]}`, r[4]); await metin(r[0]!, 'en', 'Bildirim', `${r[1]} · ${r[2]}`, r[5]); }
  // YG-1545: Mevzuat Uyum Matrisi kuralları. YG-1551: dosyadan yalnız ilk kurulumda alınır; sonrası program içinden yönetilir, mevcut kural değiştirilmez.
  const OLAY: [RegExp, string][] = [[/İşe alım/, 'personel_kaydi'], [/Dalış/, 'is_emri_dalis'], [/Sıcak iş/, 'is_emri_sicak'], [/Liman sahasında/, 'is_emri_sicak'], [/ağa kabul/, 'firma_kabulu'], [/Sözleşme/, 'sozlesme'], [/[Ff]atura/, 'fatura'], [/Hizmet tamamlanması/, 'teslim']];
  for (const l of readFileSync(join(KOK, 'veri', 'uyum_kurallari.tsv'), 'utf8').split(/\r?\n/).filter(Boolean)) {
    const r = l.split('\t'); const olay = OLAY.find(([x]) => x.test(r[5] ?? ''))?.[1] ?? null; const g = /(\d+)\s*(?:iş\s*)?gün/.exec(r[7] ?? ''); const on = /öncesi/.test(r[7] ?? '') ? 1 : g ? Number(g[1]) : 30;
    await c.query(`INSERT INTO uyum_kurali (mum_no, alan, mevzuat, madde, yukumluluk, tetikleyici, sorumlu_rol, sure_metni, gerekli_kanit, dogrulayan_rol, kayit, belge, dogrulama, not_metni, engelleyici, olay_kodu, sure_gun) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (mum_no) DO NOTHING`, [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], (r[14] ?? '').startsWith('E'), olay, on]);
  }
  for (const r of tsv('onay_ekran_metinleri.tsv')) {
    await metin(r[0]!, 'tr', 'Onay', r[3] ?? null, r[4]); await metin(r[0]!, 'en', 'Onay', r[5] ?? null, r[6]);
    for (const [dil, d] of [['tr', r[7]], ['en', r[8]]] as const) await c.query(`UPDATE sablon_metni SET dugme = $3, dogan_gorev = $4 WHERE kod = $1 AND dil = $2`, [r[0], dil, d && d !== '—' ? d : null, r[9] && r[9] !== '—' ? r[9] : null]);
  }
  // YG-1037: teknik kabulü yapan kalite kontrolünü doğrulayamaz.
  await c.query(`INSERT INTO rol_cakisma SELECT a.kimlik, b.kimlik, 'Teknik kabul ile kalite doğrulaması aynı kişide olamaz' FROM rol a, rol b WHERE a.rol_adi = 'Teknik Uzman' AND b.rol_adi = 'Kalite Uzmanı (Kalite Kontrolör)' ON CONFLICT DO NOTHING`);
  await c.query('COMMIT');
  console.log(`${dl.length} değer, ${n} rol yüklendi`);
  return c;
}

/** YG-1118: yalnız sentetik deneme hesapları. Gerçek kişi verisi kullanılmaz. */
const DENEME: [string, string, string, string, string, string, boolean][] = [
  ['Deneme CEO', 'ceo@deneme.yatonet.local', '+905550000001', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'CEO', false],
  ['Deneme Sistem Yöneticisi', 'sistem@deneme.yatonet.local', '+905550000002', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'Sistem Yöneticisi', true],
  ['Deneme İç Denetçi', 'denetci@deneme.yatonet.local', '+905550000003', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'İç Denetçi', false],
  ['Deneme Bilgi İşlem Müdürü', 'bimuduru@deneme.yatonet.local', '+905550000005', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'Bilgi İşlem Müdürü', false],
  ['Deneme Destek Sorumlusu', 'destek@deneme.yatonet.local', '+905550000006', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'Bilgi İşlem Destek Sorumlusu', false],
  ['Deneme Sicil Sorumlusu', 'sicil@deneme.yatonet.local', '+905550000007', 'LGM İç Rolü', 'Doğrulama uygulaması (6 haneli kod)', 'Sicil Sorumlusu', false],
  ['Deneme Firma Yetkilisi', 'firma@deneme.yatonet.local', '+905550000008', 'İş Birliği Firması', 'Doğrulama uygulaması (6 haneli kod)', 'Firma Yetkilisi', false],
  ['Deneme Yat Sahibi', 'yatsahibi@deneme.yatonet.local', '+905550000004', 'Bireysel Müşteri (Yat Sahibi/Yetkilisi)', 'SMS kodu', 'Müşteri Portal Kullanıcısı', false],
];

export async function denemeHesaplari(c: pg.Client, dosya: string | null) {
  const satirlar: string[] = [];
  for (const [ad, ep, tel, grup, yontem, rol, ayr] of DENEME) {
    if ((await c.query(`SELECT 1 FROM kullanici_hesabi WHERE e_posta = $1`, [ep])).rowCount) continue;
    const parola = 'Deneme-' + randomBytes(9).toString('base64url');
    const { rows } = await c.query(
      `INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, cep_telefonu, parola_ozeti, dogrulama_yontemi, ayricalikli_mi)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8) RETURNING kimlik`,
      [grup === 'LGM İç Rolü' ? 'İç Kullanıcı' : 'Müşteri/Kurum', grup, ad, ep, tel, await parolaOzetle(parola), yontem, ayr]);
    await c.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [rows[0].kimlik, rol]);
    satirlar.push(`${rol}\t${ep}\t${parola}`);
  }
  if (dosya && satirlar.length) { appendFileSync(dosya, satirlar.join('\n') + '\n', 'utf8'); console.log('deneme hesapları yazıldı:', dosya); }
  return satirlar;
}

if (process.argv[1]?.endsWith('kurulum.ts')) {
  const e = ortamOku();
  const ekle = (k: string, v: string) => { if (!e[k]) { appendFileSync(ENV_YOLU, `${k}=${v}\n`, 'ascii'); e[k] = v; } };
  if (!existsSync(ENV_YOLU)) writeFileSync(ENV_YOLU, '');
  ekle('YATONET_DB_PAROLA', randomBytes(24).toString('base64url'));
  ekle('YATONET_SIFRELEME_ANAHTARI', randomBytes(32).toString('hex'));
  ekle('YATONET_ORTAM', 'gelistirme');
  const c = await kurVeritabani('yatonet360', { superParola: e.POSTGRES_SUPER_PAROLA!, uygulamaParola: e.YATONET_DB_PAROLA!, denemeHesap: true });
  await denemeHesaplari(c, join(KOK, '.araclar', 'deneme_hesaplari.txt'));
  await c.end();
}
