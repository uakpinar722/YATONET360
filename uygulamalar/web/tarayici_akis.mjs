// Gerçek tarayıcıda (Edge) Adım 5–7 uçtan uca: kalite planı, cetvel, keşif iş emri, firma fiyatı, teklif, sigorta kararı, onarım iş emri, ilerleme, kabul, proforma, fatura, tahsilat. Yalnız deneme veritabanında çalışır.
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';

const CIKTI = process.argv[2] ?? '.';
const KOK = 'http://127.0.0.1:5173';
const env = Object.fromEntries(readFileSync('C:/YATONET360/.env.local', 'utf8').split(/\r?\n/).filter(Boolean).map((s) => s.split(/=(.*)/s).slice(0, 2)));
const [, , PAROLA] = readFileSync('C:/YATONET360/.araclar/deneme_hesaplari.txt', 'utf8').split('\n').map((l) => l.split('\t')).find((x) => x[0] === 'İç Denetçi');
const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const totp = (g) => {
  let bit = 0, d = 0; const c = [];
  for (const h of g) { d = (d << 5) | B.indexOf(h); bit += 5; if (bit >= 8) { c.push((d >>> (bit - 8)) & 255); bit -= 8; } }
  const s = Buffer.alloc(8); s.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const m = createHmac('sha1', Buffer.from(c)).update(s).digest(); const o = m[m.length - 1] & 15;
  return String((m.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
};
const sup = new pg.Client({ host: 'localhost', user: 'postgres', password: env.POSTGRES_SUPER_PAROLA, database: 'yatonet360' });
await sup.connect();
const tek = randomBytes(3).toString('hex');
const tarayici = await chromium.launch({ channel: 'msedge', headless: true });
const sonuc = []; const hatalar = [];
const kontrol = (ad, k) => { sonuc.push(`${k ? 'GEÇTİ' : 'KALDI'}  ${ad}`); };
const H = { 'x-yatonet': '1' };
const gizliler = {}; const kimlikler = {};
const hesap = async (k, rol, grup = 'LGM İç Rolü') => {
  const ep = `e2e-${k}-${tek}@deneme.yatonet.local`;
  const asil = (await sup.query(`SELECT parola_ozeti FROM kullanici_hesabi k JOIN rol_atamasi a ON a.kullanici_ref = k.kimlik JOIN rol r ON r.kimlik = a.rol_ref WHERE r.rol_adi = 'İç Denetçi' LIMIT 1`)).rows[0].parola_ozeti;
  const u = (await sup.query(`INSERT INTO kullanici_hesabi (hesap_turu, kullanici_grubu, ad_soyad, kullanici_adi, e_posta, parola_ozeti, dogrulama_yontemi, izin_adimi_zamani) VALUES ($1,$2,$3,$4,$4,$5,'Doğrulama uygulaması (6 haneli kod)',now()) RETURNING kimlik`, [grup === 'LGM İç Rolü' ? 'İç Kullanıcı' : 'Dış Kullanıcı', grup, `Deneme ${k}`, ep, asil])).rows[0].kimlik;
  kimlikler[k] = u;
  if (rol) await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = $2`, [u, rol]);
  await sup.query(`INSERT INTO aydinlatma_kaydi (ilgili_kisi_ref, ilgili_kisi_grubu, aydinlatma_metni, metin_surumu, dil, sunum_kanali) VALUES ($1,'Çalışan',$2,'R00','Türkçe','Web')`, [u, grup === 'LGM İç Rolü' ? 'KVKK-05' : grup === 'İş Birliği Firması' ? 'KVKK-03' : 'KVKK-01']);
  await sup.query(`INSERT INTO kullanim_kosullari_kabulu (kullanici_ref, prt_surumu, dil) VALUES ($1,'R00','Türkçe')`, [u]);
  return ep;
};
const gir = async (ep, k, w = 1280, h = 900) => {
  const ctx = await tarayici.newContext({ viewport: { width: w, height: h }, locale: 'tr-TR' });
  const hd = { ...H };
  const g = await ctx.request.post(`${KOK}/api/kimlik/giris`, { headers: hd, data: { kimlik: ep, parola: PAROLA } });
  if (!g.ok()) throw new Error(`giriş ${k}: ${await g.text()}`);
  const q = await (await ctx.request.get(`${KOK}/api/kimlik/kurulum`, { headers: hd })).json();
  gizliler[k] = q.gizli;
  const d = await ctx.request.post(`${KOK}/api/kimlik/dogrula`, { headers: hd, data: { kod: totp(q.gizli) } });
  if (!d.ok()) throw new Error(`doğrulama ${k}: ${await d.text()}`);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => hatalar.push(`${k}: ${e.message}`));
  p.api = async (yol, data) => { const r = data === undefined ? await ctx.request.get(`${KOK}/api${yol}`, { headers: hd }) : await ctx.request.post(`${KOK}/api${yol}`, { headers: hd, data }); const j = await r.json().catch(() => ({})); if (!r.ok()) throw new Error(`${yol}: ${j.hata ?? r.status()}`); return j; };
  await p.goto(KOK);
  return p;
};
const TEMP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.araclar', 'e2e_kanit.pdf');
writeFileSync(TEMP, `%PDF-1.4 ${tek}`); writeFileSync(TEMP.replace('.pdf', '2.pdf'), `%PDF-1.4 ${tek}2`); writeFileSync(TEMP.replace('.pdf', '3.pdf'), `%PDF-1.4 ${tek}3`);
const dosyaAc = async (p, no) => {
  await p.goto(KOK); await p.reload();
  await p.getByRole('button', { name: 'Dosyalar', exact: true }).click();
  await p.getByRole('button', { name: /^Tümü|Tüm Dosyalar/ }).first().click({ timeout: 1500 }).catch(() => {});
  const satir = p.locator('tr', { hasText: no });
  await satir.waitFor();
  await satir.getByRole('button').first().click();
  await p.getByRole('heading', { name: new RegExp(no) }).first().waitFor();
};
const hataVarsa = async (p, ne) => { const a = p.getByRole('alert'); if (await a.count()) { const t = await a.first().textContent(); if (t) throw new Error(`${ne}: ${t}`); } };
const tikla = async (p, ad) => { await p.getByRole('button', { name: ad, exact: true }).first().click(); await p.waitForTimeout(350); await hataVarsa(p, ad); };
const sayfalar = {};
const al = async (k, E) => { if (!sayfalar[k]) sayfalar[k] = await gir(E[k], k); else { await sayfalar[k].goto(KOK); await sayfalar[k].reload(); } return sayfalar[k]; };
const kartKarar = async (E, kim, baslik, karar) => {
  const p = await al(kim, E);
  const kart = p.locator('.ozet', { hasText: baslik }).filter({ has: p.getByRole('button', { name: karar, exact: true }) }).first();
  await kart.waitFor({ timeout: 15000 }).catch(async (e) => { throw new Error(`${kim} kartı yok (${baslik}): ${(await p.locator('main, body').first().innerText()).replace(/\s+/g, ' ').slice(0, 300)}`); });
  await kart.getByRole('button', { name: karar, exact: true }).click();
  await p.locator('.ozet', { hasText: baslik }).filter({ has: p.getByRole('button', { name: karar, exact: true }) }).waitFor({ state: 'detached', timeout: 15000 }).catch(async () => { throw new Error(`${kim} karar sonrası (${baslik}): ${(await kart.innerText()).replace(/\s+/g, ' ').slice(0, 300)}`); });
};
const kod = async (k) => { await sup.query(`UPDATE kullanici_hesabi SET totp_son_adim = 0 WHERE kimlik = $1`, [kimlikler[k]]); return totp(gizliler[k]); };
const tasmaYok = async (p, ad) => { const v = p.viewportSize(); await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(250); kontrol(`${ad} telefonda taşmaz`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); await p.screenshot({ path: join(CIKTI, `${ad.replace(/\s/g, '_')}.png`), fullPage: true }); await p.setViewportSize(v); };
const R = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', mfm: 'Muhasebe ve Finans Müdürü', tid: 'Ticari İşler Direktörü', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü' };
try {
  const E = {};
  for (const [k, r] of Object.entries(R)) E[k] = await hesap(k, r);
  E.fir = await hesap('fir', null, 'İş Birliği Firması');
  E.sg = await hesap('sg', null, 'Sigorta Şirketi / Eksper');
  await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = 'Sigorta Şirketi Kullanıcısı'`, [kimlikler.sg]);
  await sup.query(`INSERT INTO rol_atamasi (kullanici_ref, rol_ref) SELECT $1, kimlik FROM rol WHERE rol_adi = 'Firma Yetkilisi'`, [kimlikler.fir]);
  const sgAd = `E2E Sigorta ${tek}`;
  await sup.query(`INSERT INTO sigorta_kullanici VALUES ($1,$2)`, [kimlikler.sg, sgAd]);
  const pSc = await al('sc', E); const pFym = await al('fym', E);
  const firma = (await pSc.api('/firma', { unvan: `E2E Firma ${tek}`, rol: 'Çözüm Ortağı' })).kimlik;
  await pFym.api(`/firma/${firma}/statu`, { asama: 'Onaylı', ag: 'Aktif', gerekce: 'E2E' });
  await pFym.api(`/firma/${firma}/kullanici`, { kullanici: kimlikler.fir });

  // Dosya ve ekip (Adım 4 ekranları tarayici_testi.mjs içinde sınanır)
  const pDs = await al('ds', E);
  const t = await pDs.api('/ihbar', { kanal: 'Telefon', sahibiAdi: 'Kaptan', sahibiTuru: 'Yatın Kaptanı', yetkiDurumu: 'Doğrulandı', telefon: '+905550001111', konum: 'Marmaris', yatDurumu: 'Bağlı', ihtiyac: 'Hasar', sigortaci: sgAd, hasarNo: `H${tek}`, yat: { adi: `E2E Yat ${tek}`, markaDiger: 'M', modelDiger: 'N', boy: 14, govde: 'Fiber', tur: 'Motor Yat' }, yatSahibi: { ad: 'Sahip', telefon: '+905550002222', eposta: `sahip${tek}@deneme.yatonet.local` }, cevaplar: {} });
  await pDs.api(`/ihbar/${t.kimlik}/mukerrerlik`, { sonuc: 'Mükerrer değil' });
  const d = await pDs.api(`/ihbar/${t.kimlik}/acilis`, { karar: 'Kabul', ozet: 'Açılış', musteriTuru: 'Sigorta Şirketi' });
  const pOpm = await al('opm', E); const pTm = await al('tm', E);
  for (const [p, k, r] of [[pOpm, 'ds', 'Dosya Sorumlusu'], [pOpm, 'oy', 'Operasyon Yöneticisi'], [pTm, 'tu', 'Teknik Uzman'], [pTm, 'ty', 'Teknik Yönetici']]) await p.api(`/dosya/${d.kimlik}/ekip`, { kullanici: kimlikler[k], rol: r });
  await pDs.api(`/dosya/${d.kimlik}/yat-bilgisi`, { tahrik: 'Dizel' });
  await sup.query(`UPDATE yat SET gecici_kayit = false WHERE kimlik = (SELECT yat_ref FROM dosya WHERE kimlik = $1)`, [d.kimlik]);
  await sup.query(`INSERT INTO onay_talebi (dosya_ref, ony_kod, baslik, metin, dugme, alici_ad, telefon, belirtec_ozeti, durum, son_gecerlilik) VALUES ($1,'ONY-01','k','m','d','a','+905550002222',$2,'Onaylandı',now())`, [d.kimlik, `e2e${tek}`]);
  for (const k of ['oy', 'ty']) {
    const p = await al(k, E); await dosyaAc(p, d.dosyaNo);
    await p.locator('#yd-d').fill('900.000,50'); await p.locator('#yd-g').fill('Piyasa bilgisi');
    await tikla(p, 'Görüşü Kaydet');
  }
  await (await al('ty', E)); await dosyaAc(sayfalar.ty, d.dosyaNo);
  await sayfalar.ty.getByText('900.000,50 EUR').first().waitFor();
  kontrol('Operasyon Yöneticisi ve Teknik Yönetici yat değerine ekrandan ortak karar verir', (await sup.query(`SELECT durum FROM dosya_yat_degeri WHERE dosya_ref = $1`, [d.kimlik])).rows[0].durum === 'Kesin');
  const isEmriForm = async (p, tur, kapsam, bedel, teklif) => {
    await p.getByLabel('Tür', { exact: true }).selectOption(tur);
    await p.getByLabel('Firma', { exact: true }).selectOption(firma);
    await p.getByLabel('Uygulama Yeri').fill('Marmaris'); await p.getByLabel('Kapsam', { exact: true }).fill(kapsam);
    if (bedel) await p.getByLabel('Firma Bedeli (EUR)').fill(bedel);
    if (teklif) await p.getByLabel('Onaylı Teklif').selectOption({ index: 1 });
    await tikla(p, 'İş Emri Oluştur');
  };
  const firmaIsEmri = async (no) => { const p = await al('fir', E); await p.locator('tr', { hasText: no }).getByRole('button', { name: 'Aç' }).click(); await p.getByRole('heading', { name: no }).waitFor(); return p; };
  const firmaKabul = async (no) => { const p = await firmaIsEmri(no); await p.getByLabel('Onay Kodu').fill(await kod('fir')); await tikla(p, 'Kabul Ediyorum'); return p; };

  // Keşif iş emri ekrandan; firma kabul eder
  const pOy = await al('oy', E); await dosyaAc(pOy, d.dosyaNo);
  await isEmriForm(pOy, 'KN', 'Keşif');
  const kn = `${d.dosyaNo}-KN01`;
  kontrol('Operasyon Yöneticisi keşif iş emrini ekrandan açar', await pOy.getByText(kn).first().isVisible());
  await firmaKabul(kn);
  kontrol('firma keşif iş emrini kodla kabul eder', true);

  // Teknik Uzman: kalite planı ve cetvel ekrandan
  const pTu = await al('tu', E); await dosyaAc(pTu, d.dosyaNo);
  await pTu.getByText('Onaylı kalite planı olmadan onarım işi başlatılamaz.').waitFor();
  kontrol('dosya ekranı kalite planı uyarısı gösterir', true);
  await pTu.getByLabel('Plan Özeti').fill('Gövde onarımı'); await pTu.getByLabel('Gereklilik', { exact: true }).fill('Sızdırmazlık'); await pTu.getByLabel('Doğrulama Yöntemi').fill('Basınç testi');
  await tikla(pTu, 'Kalite Planını Onaya Gönder');
  const kart = (await sup.query(`SELECT kod FROM kartela_kalemi LIMIT 1`)).rows[0].kod;
  await pTu.locator('#c-a').fill('Gövde laminasyonu'); await pTu.locator('#c-k').fill(kart); await pTu.locator('#c-m').fill('10');
  await tikla(pTu, 'Satır Ekle');
  await tikla(pTu, 'Cetveli Onaya Gönder');
  await tasmaYok(pTu, 'dosya_ekrani');
  kontrol('Teknik Uzman plan ve cetveli ekrandan gönderir', true);
  await kartKarar(E, 'ty', `${d.dosyaNo} · Kalite Planı`, 'Onayla');
  await kartKarar(E, 'ty', `${d.dosyaNo} · Kapsam ve Metraj`, 'Onayla');
  kontrol('Teknik Yönetici plan ve cetveli Bugün ekranından onaylar', true);

  // Firma fiyatı
  const pF = await firmaIsEmri(kn);
  await pF.getByLabel(/Birim Fiyat/).first().fill('51');
  await tikla(pF, 'Fiyat Teklifini Gönder');
  await tasmaYok(pF, 'firma_is_emri');
  kontrol('firma fiyatını portaldan girer', true);

  // Teklif
  const pTs = await al('ts', E); await dosyaAc(pTs, d.dosyaNo);
  await pTs.getByLabel('Firma Fiyat Teklifi').selectOption({ index: 1 });
  await tikla(pTs, 'Fiyat Teklifi Hazırla');
  await tikla(pTs, 'Onaya Gönder');
  kontrol('Ticari Sorumlu teklifi ekrandan hazırlar ve gönderir', true);
  const no = (await sup.query(`SELECT teklif_no FROM fiyat_teklifi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].teklif_no;
  await kartKarar(E, 'mfm', no, 'Onaya Gönder'); await kartKarar(E, 'tid', no, 'Onayla');
  await dosyaAc(pTs, d.dosyaNo); await tikla(pTs, 'Gönder');
  kontrol('sigortaya teklif ilk düğmeyle gitmez', (await sup.query(`SELECT statu FROM fiyat_teklifi WHERE teklif_no = $1`, [no])).rows[0].statu === 'Onaylı');
  await pTs.getByRole('button', { name: 'Birinci Teyit: İçeriği Gördüm' }).click();
  const ikinci = pTs.getByRole('button', { name: 'İkinci Teyit: Sigortaya Gönder' });
  await ikinci.waitFor();
  kontrol('ikinci teyit düğmesi metin okunmadan açılmaz', await ikinci.isDisabled());
  await tasmaYok(pTs, 'sigorta_teyit');
  await ikinci.click({ timeout: 6000 }); await pTs.waitForTimeout(500); await hataVarsa(pTs, 'İkinci Teyit');
  kontrol('sigortaya teklif ikinci teyitle gider', (await sup.query(`SELECT statu FROM fiyat_teklifi WHERE teklif_no = $1`, [no])).rows[0].statu === 'Gönderildi');
  const pSg = await al('sg', E);
  for (let n = 0; n < 6; n++) { // Dış kullanıcının ilk giriş adımları
    await pSg.waitForTimeout(500);
    const b = pSg.getByRole('button', { name: /^(Bilgilendim|Devam|Ana Ekrana Geç|Okudum, Kabul Ediyorum)$/ });
    if (await b.count()) await b.first().click(); else break;
  }
  await pSg.getByRole('button', { name: 'İncele' }).click();
  await pSg.getByText('Tümünü Seç').click();
  await tasmaYok(pSg, 'sigorta_teklif');
  await tikla(pSg, 'Seçilen Kalemleri Onayla');
  kontrol('Sigorta Şirketi kalemleri portaldan onaylar', (await sup.query(`SELECT statu FROM fiyat_teklifi WHERE teklif_no = $1`, [no])).rows[0].statu === 'Karar');

  // Onarım iş emri
  await dosyaAc(pOy, d.dosyaNo);
  await isEmriForm(pOy, 'ON', 'Laminasyon', '510', true);
  const ie = (await sup.query(`SELECT kimlik, is_emri_no FROM is_emri WHERE dosya_ref = $1 AND is_emri_turu = 'ON'`, [d.kimlik])).rows[0];
  await kartKarar(E, 'opm', ie.is_emri_no, 'Onaya Gönder'); await kartKarar(E, 'tid', ie.is_emri_no, 'Onayla');
  await firmaKabul(ie.is_emri_no);
  await dosyaAc(pTu, d.dosyaNo); await pTu.locator('.soru', { hasText: ie.is_emri_no }).getByRole('button', { name: 'Başlanabilir' }).click(); await pTu.waitForTimeout(500); await hataVarsa(pTu, 'Başlanabilir');
  kontrol('Teknik Uzman başlangıç kontrolünü ekrandan verir', (await sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [ie.kimlik])).rows[0].statu === 'Aktif');

  // İlerleme: dosya yükleyerek
  const pF2 = await firmaIsEmri(ie.is_emri_no);
  await pF2.getByLabel('Kalem', { exact: true }).selectOption({ index: 1 });
  await pF2.getByLabel('Miktar', { exact: true }).fill('10');
  await pF2.getByLabel('Kanıt Belgesi').setInputFiles(TEMP);
  await pF2.getByText('Dosya yüklendi.').first().waitFor();
  await tikla(pF2, 'İlerleme Kaydet');
  await tikla(pF2, 'İş Tamamlandı');
  kontrol('firma ilerlemeyi dosya yükleyerek girer ve işi bitirir', (await sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [ie.kimlik])).rows[0].statu === 'Tamamlandı');

  // Kabul
  await dosyaAc(pTu, d.dosyaNo);
  await pTu.locator('.soru', { hasText: ie.is_emri_no }).getByRole('button', { name: /Doğrula$/ }).first().click(); await pTu.waitForTimeout(500);
  await pTu.getByLabel('Gereklilik Kanıtı').first().setInputFiles(TEMP.replace('.pdf', '2.pdf'));
  await pTu.getByText('Dosya yüklendi.').first().waitFor();
  await tikla(pTu, 'Karşılandı');
  await dosyaAc(pTu, d.dosyaNo); await pTu.locator('.soru', { hasText: ie.is_emri_no }).getByRole('button', { name: 'Teknik Kabul' }).click(); await pTu.waitForTimeout(500); await hataVarsa(pTu, 'Teknik Kabul');
  kontrol('Teknik Uzman ilerlemeyi doğrular, gerekliliği kanıtlar, teknik kabul verir', (await sup.query(`SELECT teknik_kabul_sonucu s FROM is_emri WHERE kimlik = $1`, [ie.kimlik])).rows[0].s === 'Kabul');

  // Proforma, fatura, tahsilat
  await dosyaAc(pTs, d.dosyaNo);
  await tikla(pTs, 'Proforma Hazırla');
  const pf = (await sup.query(`SELECT proforma_no FROM musteri_faturasi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].proforma_no;
  await kartKarar(E, 'mfm', pf, 'Onaya Gönder'); await kartKarar(E, 'tid', pf, 'Onayla');
  await dosyaAc(pTs, d.dosyaNo); await tikla(pTs, 'Muhasebeye İlet');
  await pTs.getByLabel('Fatura No (Muhasebeden)').fill(`F${tek}`); await pTs.getByLabel('Fatura Tarihi').fill('2026-11-10'); await pTs.getByLabel('TCMB Satış Kuru').fill('40,1234'); await pTs.getByLabel('Kur Tarihi').fill('2026-11-09');
  await tikla(pTs, 'Fatura Bilgisini Kaydet');
  const top = Number((await sup.query(`SELECT toplam_eur FROM musteri_faturasi WHERE proforma_no = $1`, [pf])).rows[0].toplam_eur);
  await pTs.getByLabel('Tahsilat (EUR)').fill(String(top).replace('.', ',')); await pTs.getByLabel('Tahsilat Tarihi').fill('2026-11-20');
  await tikla(pTs, 'Havale Tahsilatı');
  kontrol('proforma, fatura bilgisi ve tahsilat ekrandan tamamlanır', (await sup.query(`SELECT durum FROM musteri_faturasi WHERE proforma_no = $1`, [pf])).rows[0].durum === 'Tahsil Edildi');
  await tasmaYok(pTs, 'mali_bolum');

  // Hakediş, IBAN, ödeme talimatı
  const pH = await firmaIsEmri(ie.is_emri_no);
  await pH.getByLabel('Hakediş Kanıtı').setInputFiles(TEMP.replace('.pdf', '3.pdf'));
  await pH.getByText('Dosya yüklendi.').first().waitFor();
  await pH.getByLabel('Brüt (EUR)').fill('510'); await pH.getByLabel('Fatura No').fill(`H${tek}`);
  await tikla(pH, 'Hakediş Gönder');
  const h = (await sup.query(`SELECT hakedis_no FROM hakedis WHERE is_emri_ref = $1`, [ie.kimlik])).rows[0];
  kontrol('firma hakedişi kanıtla portaldan gönderir', Boolean(h));
  await dosyaAc(pDs, d.dosyaNo); await tikla(pDs, 'Doğrula');
  const pSc2 = await al('sc', E);
  await pSc2.getByRole('button', { name: 'Firma Sicili' }).click();
  await pSc2.locator('tr', { hasText: `E2E Firma ${tek}` }).getByRole('button', { name: 'Seç' }).click();
  await pSc2.getByLabel('IBAN').fill('TR330006100519786457841326');
  await tikla(pSc2, 'IBAN Ekle');
  await pSc2.getByLabel('Belge Türü').fill('SGK Borcu Yoktur Yazısı'); await pSc2.getByLabel('Geçerlilik Bitişi').fill('2099-01-01');
  await tikla(pSc2, 'Belge Kaydet');
  await tasmaYok(pSc2, 'firma_sicili');
  const pM = await al('mfm', E);
  await pM.getByRole('button', { name: 'İdari İşlemlerim' }).click();
  await pM.locator('.soru', { hasText: `E2E Firma ${tek}` }).getByLabel('Teyit Kanalı').fill('Sicildeki numaradan geri arama');
  await pM.locator('.soru', { hasText: `E2E Firma ${tek}` }).getByRole('button', { name: 'Teyit Et' }).click(); await pM.waitForTimeout(400); await hataVarsa(pM, 'IBAN');
  kontrol('IBAN Sicilden girilir, Muhasebe ve Finans Müdürü teyit eder', (await sup.query(`SELECT durum FROM banka_hesabi b JOIN kurulus k ON k.kimlik = b.kurulus_ref WHERE k.kimlik = $1`, [firma])).rows[0].durum === 'Geçerli');
  await dosyaAc(pTs, d.dosyaNo); await tikla(pTs, 'Ödeme Talimatı');
  await kartKarar(E, 'mfm', h.hakedis_no, 'Onaya Gönder');
  kontrol('Ticari Sorumlu ödeme talimatını ekrandan hazırlar', (await sup.query(`SELECT count(*)::int n FROM odeme_talimati t JOIN hakedis h ON h.kimlik = t.hakedis_ref WHERE h.is_emri_ref = $1`, [ie.kimlik])).rows[0].n === 1);

  // Teslim
  await sup.query(`UPDATE dosya SET asama = 'Teslim' WHERE kimlik = $1`, [d.kimlik]);
  await dosyaAc(pDs, d.dosyaNo); await tikla(pDs, 'Teslimi Başlat');
  kontrol('Dosya Sorumlusu teslimi ekrandan başlatır, yat sahibine ONY-27 gider', (await sup.query(`SELECT count(*)::int n FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-27'`, [d.kimlik])).rows[0].n === 1);
  sonuc.push(`DOSYA ${d.dosyaNo}`);
} catch (e) {
  sonuc.push(`KALDI  beklenmeyen: ${e.message.split('\n')[0]}`);
  for (const [k, s] of Object.entries(sayfalar)) await s.screenshot({ path: join(CIKTI, `hata_${k}.png`), fullPage: true }).catch(() => {});
} finally {
  kontrol('sayfa hatası yok', hatalar.length === 0);
  if (hatalar.length) sonuc.push(...hatalar);
  console.log(sonuc.join('\n'));
  await tarayici.close(); await sup.end();
}
