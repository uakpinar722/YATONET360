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
await sup.connect(); await sup.query(`UPDATE sistem_parametresi SET deger = 0 WHERE kod = 'sozlesme_kapisi'`); await sup.query(`UPDATE sistem_parametresi SET deger = NULL WHERE kod = 'onay_kod_esik_eur'`); // Deneme ortamı: sözleşme kapısı api sınamasında
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
const dosyaYaz = (ad) => { const y = TEMP.replace('.pdf', `${ad}.pdf`); writeFileSync(y, `%PDF-1.4 ${tek}${ad}`); return y; };
writeFileSync(TEMP, `%PDF-1.4 ${tek}`); writeFileSync(TEMP.replace('.pdf', '2.pdf'), `%PDF-1.4 ${tek}2`); writeFileSync(TEMP.replace('.pdf', '3.pdf'), `%PDF-1.4 ${tek}3`); writeFileSync(TEMP.replace('.pdf', '5.pdf'), `%PDF-1.4 ${tek}5`);
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
const tasmaYok = async (p, ad) => { const v = p.viewportSize(); await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(250); kontrol(`${ad} telefonda taşmaz`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) console.log('TAŞAN', ad, await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8).map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().right)} ${(e.textContent ?? '').slice(0, 30)}`).join(' | '))); kontrol(`${ad} metin yaslaması uygun`, await p.evaluate(() => { const o = document.querySelector('.ozet, .not'); const h = document.querySelector('h1, .bolum'); return (!o || getComputedStyle(o).textAlign === 'justify') && (!h || ['left', 'start'].includes(getComputedStyle(h).textAlign)); })); await p.screenshot({ path: join(CIKTI, `${ad.replace(/\s/g, '_')}.png`), fullPage: true }); await p.setViewportSize(v); };
const R = { ds: 'Dosya Sorumlusu', oy: 'Operasyon Yöneticisi', opm: 'Operasyon Müdürü', tu: 'Teknik Uzman', ty: 'Teknik Yönetici', tm: 'Teknik Müdür', ts: 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', mfm: 'Muhasebe ve Finans Müdürü', mfy: 'Muhasebe ve Finans Müdür Yardımcısı', fmy: 'Firma Yönetimi Müdür Yardımcısı', tid: 'Ticari İşler Direktörü', sc: 'Sicil Sorumlusu', fym: 'Firma Yönetimi Müdürü' };
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
  const firmaIsEmri = async (no) => { const p = await al('fir', E); await p.getByRole('button', { name: 'İş Emirleri' }).first().click(); await p.locator('tr', { hasText: no }).getByRole('button', { name: 'Aç' }).click(); await p.getByRole('heading', { name: no }).waitFor(); return p; };
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

  // Firma raporu ve Teknik Rapor
  const pFr = await firmaIsEmri(kn);
  await pFr.locator('#fr-t').fill('2026-11-05'); await pFr.locator('#fr-b').fill('Gövdede çatlak'); await pFr.locator('#fr-o').fill('Laminasyon'); await pFr.locator('#fr-s').fill('5'); await pFr.locator('#fr-d').fill('Onarım uygundur');
  await tikla(pFr, 'Raporu Onayla ve Gönder');
  const pR = await al('tu', E); await dosyaAc(pR, d.dosyaNo);
  await pR.waitForFunction(() => document.querySelector('#rp-bulgular')?.value === 'Gövdede çatlak');
  kontrol('firma raporu Teknik Rapor formuna kendiliğinden gelir', true);
  for (const k of ['kapsam', 'incelenen', 'saha', 'yontem', 'acikSorular', 'uzmanlik']) await pR.locator(`#rp-${k}`).fill('Yazıldı');
  await tikla(pR, 'Raporu Kontrole Gönder');
  await kartKarar(E, 'ty', `${d.dosyaNo}-TR01`, 'Onaya Gönder');
  kontrol('Teknik Yönetici raporu kontrol eder', true);

  // Teklif
  const pTs = await al('ts', E); await dosyaAc(pTs, d.dosyaNo);
  await pTs.getByLabel('Firma Fiyat Teklifi').selectOption({ index: 1 });
  await tikla(pTs, 'Fiyat Teklifi Hazırla');
  await pTs.getByLabel('Masraf Açıklaması (Tesis Bedeli)').fill('Travel lift bedeli'); await pTs.getByLabel('Gerçek Tutar (EUR)').fill('1.000,00');
  await pTs.getByLabel('Tesis Teklifi veya Tarifesi').setInputFiles(TEMP.replace('.pdf', '5.pdf')); await pTs.getByText('Dosya yüklendi.').first().waitFor();
  await tikla(pTs, 'Masraf Ekle');
  kontrol('tesis bedeli teklife gerçek tutarıyla Masraf olarak eklenir', (await sup.query(`SELECT tutar_eur FROM fiyat_teklifi_kalemi k JOIN fiyat_teklifi f ON f.kimlik = k.teklif_ref WHERE f.dosya_ref = $1 AND k.bedel_turu = 'Masraf'`, [d.kimlik])).rows[0]?.tutar_eur === '1000.00');
  await tikla(pTs, 'Onaya Gönder');
  kontrol('Ticari Sorumlu teklifi ekrandan hazırlar ve gönderir', true);
  const no = (await sup.query(`SELECT teklif_no FROM fiyat_teklifi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].teklif_no;
  await kartKarar(E, 'mfy', no, 'Onaya Gönder'); await kartKarar(E, 'mfm', no, 'Onaya Gönder'); await kartKarar(E, 'tid', no, 'Onayla');
  await dosyaAc(pTs, d.dosyaNo); await tikla(pTs, 'Gönder');
  kontrol('sigortaya teklif ilk düğmeyle gitmez', (await sup.query(`SELECT statu FROM fiyat_teklifi WHERE teklif_no = $1`, [no])).rows[0].statu === 'Onaylı');
  kontrol('teyit ekranı giden ekleri gösterir', await pTs.getByText(`Fiyat Teklifi ${no}.pdf`).first().isVisible());
  const on = await pTs.getByRole('link', { name: 'Teklif PDF Önizleme' }).first().getAttribute('href');
  kontrol('teklif PDF önizlemesi açılır', (await pTs.evaluate(async (u) => (await fetch(u)).headers.get('content-type'), on)).includes('pdf'));
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

  await dosyaAc(pDs, d.dosyaNo);
  await pDs.getByText('Kalemler ve Eksper Raporu').first().waitFor();
  kontrol('Dosya Sorumlusu eksper tutarı girebilir', await pDs.getByLabel('Eksper Tutarı 1').first().isEditable());
  await tasmaYok(pDs, 'eksper_karsilastirma');
  await pDs.getByText('Kalemler ve Eksper Raporu').first().scrollIntoViewIfNeeded();
  await pDs.screenshot({ path: join(CIKTI, 'eksper_karsilastirma.png') });

  // Kısmi kararlı teklif: yeniden değerlendirme ekranı (YG-204)
  const yd = (await sup.query(`INSERT INTO fiyat_teklifi (teklif_no, dosya_ref, teklif_muhatabi, kdv_orani, statu, karar, ara_toplam_eur, kdv_tutari_eur, genel_toplam_eur, onay_limit_tutari_eur, hazirlayan_ref) SELECT $1, $2, 'Sigorta Şirketi', 20, 'Gönderildi', NULL, 400, 80, 480, 400, hazirlayan_ref FROM fiyat_teklifi WHERE teklif_no = $3 RETURNING kimlik`, [`${d.dosyaNo}-TK98`, d.kimlik, no])).rows[0].kimlik;
  await sup.query(`INSERT INTO fiyat_teklifi_kalemi (teklif_ref, sira_no, aciklama, isin_niteligi, bedel_turu, miktar, birim, birim_satis_fiyati_eur, tutar_eur) VALUES ($1,1,'Pervane','Onarım','İşçilik',1,'adet',100,100), ($1,2,'Şaft','Onarım','İşçilik',1,'adet',300,300)`, [yd]);
  await pDs.reload(); await dosyaAc(pDs, d.dosyaNo);
  const adresDugme = pDs.getByRole('button', { name: 'Adres Gir' }); await pDs.getByText('Fiyat Teklifleri').first().waitFor();
  if (await adresDugme.count()) { await adresDugme.click(); await pDs.getByLabel('Sigorta E-postası').fill('hasar@deneme.local'); await tikla(pDs, 'Kaydet'); await pDs.getByText('Sigorta E-postası: hasar@deneme.local').waitFor(); }
  kontrol('sigorta adresi dosya ekranından girilir', await pDs.getByText(/Sigorta E-postası: /).first().isVisible());
  const ydKart = pDs.locator('.soru', { hasText: `${d.dosyaNo}-TK98` });
  await ydKart.getByLabel('Kalem Seç 1').check();
  await ydKart.getByLabel('Onaylayan Yetkili').fill('Hasar Müdürü');
  await ydKart.getByLabel(/Onay Belgesi/).setInputFiles(TEMP); await pDs.getByText('Dosya yüklendi.').first().waitFor();
  await ydKart.getByRole('button', { name: 'Seçilenlerle Kısmi Onay Kaydet' }).click(); await pDs.waitForTimeout(600); await hataVarsa(pDs, 'Kısmi onay');
  kontrol('kısmi onay ekrandan kaydedilir', (await sup.query(`SELECT karar FROM fiyat_teklifi WHERE kimlik = $1`, [yd])).rows[0].karar === 'Kısmi Onay');
  await ydKart.getByLabel('Kalem Seç 2').check();
  await ydKart.getByLabel('Teknik Gerekçe').fill('Salgı 0,11 mm ölçüldü');
  await ydKart.getByRole('button', { name: 'Seçilenler İçin Yeniden Değerlendirme İste' }).click(); await pDs.waitForTimeout(500); await hataVarsa(pDs, 'Yeniden değerlendirme');
  await pDs.getByRole('button', { name: 'Birinci Teyit: İçeriği Gördüm' }).first().click();
  const yd2 = pDs.getByRole('button', { name: 'İkinci Teyit: Sigortaya Gönder' }).first(); await yd2.waitFor(); await pDs.waitForTimeout(2300);
  await yd2.click(); await pDs.waitForTimeout(500); await hataVarsa(pDs, 'Yeniden değerlendirme teyidi');
  kontrol('yeniden değerlendirme ikinci teyitle gider', (await sup.query(`SELECT durum FROM yeniden_degerlendirme WHERE teklif_ref = $1`, [yd])).rows[0].durum === 'Gönderildi');
  await pDs.reload(); await dosyaAc(pDs, d.dosyaNo);
  const ydSon = pDs.locator('.soru', { hasText: `${d.dosyaNo}-TK98` });
  await ydSon.getByLabel('Kalem Seç 2').check();
  await ydSon.getByLabel('Onaylayan Yetkili').fill('Hasar Müdürü');
  await ydSon.getByLabel(/Onay Belgesi/).setInputFiles(dosyaYaz('yd')); await pDs.getByText('Dosya yüklendi.').first().waitFor();
  await ydSon.getByRole('button', { name: 'Yeniden Değerlendirme Sonucunu Kaydet' }).click(); await pDs.waitForTimeout(500); await hataVarsa(pDs, 'Yeniden değerlendirme sonucu');
  kontrol('yeniden değerlendirme sonucu kalemi onaylar', (await sup.query(`SELECT onay_durumu FROM fiyat_teklifi_kalemi WHERE teklif_ref = $1 AND sira_no = 2`, [yd])).rows[0].onay_durumu === 'Onaylandı');
  await sup.query(`UPDATE fiyat_teklifi SET statu = 'Yerine Geçti' WHERE kimlik = $1`, [yd]);

  // Ek-3 alanı ve ekonomik kilit ekranı
  await pDs.reload(); await dosyaAc(pDs, d.dosyaNo);
  await pDs.getByLabel('Dosyaya Özel Onay Yetkilisi (Ek-3)').fill('yetkili@deneme.local'); await tikla(pDs, 'Onay Yetkilisini Kaydet');
  kontrol('Ek-3 onay yetkilisi ekrandan kaydedilir', (await sup.query(`SELECT onay_yetkilisi_eposta e FROM dosya_sigorta_kaydi WHERE dosya_ref = $1`, [d.kimlik])).rows[0].e === 'yetkili@deneme.local');
  await sup.query(`UPDATE dosya_sigorta_kaydi SET onay_yetkilisi_eposta = NULL WHERE dosya_ref = $1`, [d.kimlik]);
  await sup.query(`UPDATE dosya SET ekonomik_kilit = true WHERE kimlik = $1`, [d.kimlik]);
  await pDs.reload(); await dosyaAc(pDs, d.dosyaNo);
  await pDs.getByText('onarıma devam kararı bekleniyor').first().waitFor();
  await pDs.getByLabel('Onaylayan Yetkili').first().fill('Hasar Müdürü');
  await tikla(pDs, 'Sigorta Kararı: Devam');
  kontrol('ekonomik kilit sigorta kararıyla açılır', (await sup.query(`SELECT ekonomik_kilit k FROM dosya WHERE kimlik = $1`, [d.kimlik])).rows[0].k === false);

  // Firma sayfası (YG-425, YG-422)
  const pFf = await al('fir', E); await pFf.getByRole('button', { name: 'Firma' }).first().click(); await pFf.getByText('Cari Ekstre').waitFor();
  await tasmaYok(pFf, 'firma_sayfasi');
  await pFf.getByLabel('Yeni IBAN').fill('TR200006100519786457849999'); await tikla(pFf, 'IBAN Bildir'); await pFf.waitForTimeout(400);
  kontrol('firma IBAN bildirir, karantinada başlar', (await sup.query(`SELECT durum FROM banka_hesabi WHERE kurulus_ref = $1 AND iban = 'TR200006100519786457849999'`, [firma])).rows[0]?.durum === 'Karantina');
  await sup.query(`UPDATE banka_hesabi SET durum = 'İptal' WHERE kurulus_ref = $1`, [firma]); // sonraki sicil adımı kendi IBAN'ını teyit eder
  await sup.query(`UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur IN ('Banka Hesabı Onayı', 'Banka Geri Arama Teyidi') AND baslik LIKE $1`, [`E2E Firma ${tek}%`]);
  await pFf.getByLabel('Yeni Değer').fill('yeni@firma.local'); await tikla(pFf, 'Değişiklik Talep Et'); await pFf.waitForTimeout(400);
  kontrol('firma bilgi değişikliği teyide gider', (await sup.query(`SELECT durum FROM kurum_bilgi_talebi WHERE kurulus_ref = $1`, [firma])).rows[0]?.durum === 'Teyit Bekliyor');

  // Karne (YG-351, YG-795)
  await pFf.getByText('Performans Karnesi').first().waitFor();
  kontrol('firma karnesini görür, risk derecesini görmez', !(await pFf.locator('main').innerText()).includes('Risk Derecesi'));
  E.tod = await hesap('tod', 'Teknik ve Operasyon Direktörü');
  const pTod = await al('tod', E); await pTod.getByRole('button', { name: 'Karne Parametreleri' }).first().click(); await pTod.getByLabel('Kalite: Minör uygunsuzluk kesintisi').waitFor();
  await tasmaYok(pTod, 'karne_parametreleri');
  kontrol('karne parametreleri başlangıç değerleriyle görünür', (await pTod.getByLabel('Kalite: Minör uygunsuzluk kesintisi').inputValue()) === '5');

  // Sigorta Ek-2 sayfası (YG-219)
  E.mpm = await hesap('mpm', 'Müşteri ve Paydaş İlişkileri Müdürü');
  const pMpm = await al('mpm', E);
  await pMpm.getByRole('button', { name: 'Sigorta Ek-2' }).first().click();
  await pMpm.getByLabel('Sigorta Şirketi').fill(`E2E Ek2 ${tek}`);
  await pMpm.getByLabel('Ad Soyad').fill('Onay Yetkilisi'); await pMpm.getByLabel('E-posta', { exact: true }).fill('ek2@deneme.local');
  await pMpm.getByLabel('Onay Adresi').check(); await pMpm.getByLabel('Kurumsal Temsilci').check();
  await tikla(pMpm, 'Listeyi Kaydet');
  await tasmaYok(pMpm, 'sigorta_ek2');
  kontrol('Ek-2 listesi ekrandan kaydedilir', (await sup.query(`SELECT count(*)::int n FROM sigorta_ek2_surum WHERE sigortaci_adi = $1 AND durum = 'Yürürlükte'`, [`E2E Ek2 ${tek}`])).rows[0].n === 1);

  // Garanti kararı ekranı: iyi niyet onaya gider (YG-175)
  await pDs.reload(); await dosyaAc(pDs, d.dosyaNo);
  await pDs.getByLabel('Belirti').fill('Titreşim'); await tikla(pDs, 'Kaydı Aç'); await pDs.waitForTimeout(500);
  await dosyaAc(sayfalar.ty, d.dosyaNo);
  await sayfalar.ty.getByLabel('Kapsam Kararı').first().selectOption('İyi Niyet');
  await sayfalar.ty.getByLabel('Karar Gerekçesi').first().fill('Müşteri memnuniyeti'); await sayfalar.ty.getByLabel('İyi Niyet Tutarı (EUR)').first().fill('10');
  await tikla(sayfalar.ty, 'Kararı Kaydet');
  kontrol('iyi niyet kararı onaya gider, karar yazılmaz', (await sup.query(`SELECT g.karar, (SELECT count(*)::int FROM is_karti k WHERE k.tur = 'İyi Niyet Kararı' AND k.nesne_kimligi = g.kimlik::text) n FROM garanti_sikayet g WHERE g.dosya_ref = $1 ORDER BY g.olusturma_zamani DESC LIMIT 1`, [d.kimlik])).rows.every((r) => r.karar === null && r.n === 1));

  // Onarım iş emri
  await dosyaAc(pOy, d.dosyaNo);
  await isEmriForm(pOy, 'ON', 'Laminasyon', '510', true);
  let ie; for (let i = 0; i < 20 && !ie; i++) { ie = (await sup.query(`SELECT kimlik, is_emri_no FROM is_emri WHERE dosya_ref = $1 AND is_emri_turu = 'ON'`, [d.kimlik])).rows[0]; if (!ie) await pOy.waitForTimeout(250); }
  if (!ie) throw new Error(`onarım iş emri oluşmadı: ${await pOy.locator('[role=status]').allTextContents()}`);
  await kartKarar(E, 'opm', ie.is_emri_no, 'Onaya Gönder'); await kartKarar(E, 'tid', ie.is_emri_no, 'Onayla');
  await firmaKabul(ie.is_emri_no);
  await dosyaAc(pDs, d.dosyaNo); const ieKart = pDs.locator('.soru', { hasText: ie.is_emri_no });
  await ieKart.getByRole('button', { name: 'Saha Kayıtları' }).click(); await ieKart.getByLabel('Başlangıç Toplantısı Tarihi').fill('2026-12-01');
  await ieKart.getByLabel('Toplantı Katılımcıları').fill('Saha Sorumlusu, Firma Yetkilisi'); await ieKart.getByLabel('Konuşulanlar').fill('İSG ve iş programı');
  await ieKart.getByRole('button', { name: 'Toplantıyı Kaydet' }).click(); await pDs.waitForTimeout(500); await hataVarsa(pDs, 'Başlangıç toplantısı');
  kontrol('başlangıç toplantısı ekrandan kaydedilir', (await sup.query(`SELECT 1 FROM baslangic_toplantisi t JOIN is_emri e ON e.kimlik = t.is_emri_ref WHERE e.is_emri_no = $1`, [ie.is_emri_no])).rowCount === 1);
  await ieKart.getByLabel('Sapma Açıklaması').fill('Yöntem bildirimi eksik'); await ieKart.getByLabel('Sapma Kararı').selectOption('Değişiklik Talebi');
  await dosyaAc(pTu, d.dosyaNo); for (const x of ['Saha Erişimi', 'Güvenlik İzni', 'Enerji Kesme', 'Çizim ve Üretici Verisi', 'Müşteri Malı', 'Malzeme', 'Ekipman', 'Onaylar']) await pTu.locator('.soru', { hasText: ie.is_emri_no }).getByLabel(x).check(); await pTu.locator('.soru', { hasText: ie.is_emri_no }).getByRole('button', { name: 'Başlanabilir', exact: true }).click(); await pTu.waitForTimeout(500); await hataVarsa(pTu, 'Başlanabilir');
  kontrol('Teknik Uzman başlangıç kontrolünü ekrandan verir', (await sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [ie.kimlik])).rows[0].statu === 'Aktif');

  // İlerleme: dosya yükleyerek
  const pF2 = await firmaIsEmri(ie.is_emri_no);
  await pF2.getByLabel('Kalem', { exact: true }).selectOption({ index: 1 });
  await pF2.getByLabel('Miktar', { exact: true }).fill('10');
  await pF2.getByLabel('Kanıt Belgesi').setInputFiles(TEMP);
  await pF2.getByText('Dosya yüklendi.').first().waitFor();
  await tikla(pF2, 'İlerleme Kaydet');
  // Günlük Kayıt ve Parça Girişi (YG-1574, YG-1430)
  await pF2.getByLabel('Yapılan Faaliyet').fill('Söküm'); await tikla(pF2, 'Kaydı Sakla');
  const glKapat = pF2.getByRole('button', { name: 'Günü Kapat', exact: true }); await glKapat.click(); await pF2.waitForTimeout(400);
  kontrol('zorunlu alan olmadan gün kapanmaz', (await pF2.getByRole('alert').first().textContent()).includes('zorunlu alan'));
  await pF2.getByLabel('Fotoğraf').setInputFiles(dosyaYaz('gunluk')); await pF2.waitForTimeout(500);
  await pF2.getByLabel('Bir Sonraki Çalışma Günü Planı').fill('Montaj'); await pF2.getByLabel('Sorumlu', { exact: true }).fill('Usta');
  await tikla(pF2, 'Günü Kapat');
  kontrol('günlük kayıt kapatılır', (await sup.query(`SELECT g.durum FROM firma_gunluk_kaydi g JOIN is_emri e ON e.kimlik = g.is_emri_ref WHERE e.is_emri_no = $1`, [ie.is_emri_no])).rows[0]?.durum === 'Kapatıldı');
  await pF2.getByLabel('Ürün', { exact: true }).fill('Kovan'); await pF2.getByLabel('Parça No').fill('PN-1'); await pF2.getByLabel('Parça Miktarı').fill('1'); await pF2.getByLabel('Lot No').fill('L-1');
  await pF2.getByLabel('İrsaliye veya Sertifika').setInputFiles(dosyaYaz('parca')); await pF2.getByRole('button', { name: 'Parça Girişini Kaydet' }).waitFor(); await pF2.waitForTimeout(500);
  await tikla(pF2, 'Parça Girişini Kaydet');
  kontrol('firma parça girişi kontrole gider', (await sup.query(`SELECT p.kabul_karari FROM firma_parca_girisi p JOIN is_emri e ON e.kimlik = p.is_emri_ref WHERE e.is_emri_no = $1`, [ie.is_emri_no])).rowCount === 1);
  await tasmaYok(pF2, 'firma_is_emri_ayrinti');
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
  await tikla(pTs, 'Proforma Hazırla'); await pTs.locator('[role=alert], .ok, .basari').first().waitFor({ timeout: 15000 }).catch(() => {}); await hataVarsa(pTs, 'Proforma'); await pTs.waitForTimeout(800);
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
  kontrol('Dosya İşlemleri ekranda: koşul, protokol, kurtarma, temas', await pTs.getByRole('button', { name: 'Protokol Aç' }).isVisible() && await pTs.getByRole('button', { name: 'Operasyon Aç' }).isVisible() && await pTs.getByRole('button', { name: 'Temas Kaydet' }).isVisible());
  kontrol('Teslim ekranı: onay iste, teslime hazır, yat kabul, sökülen parça', await pTs.getByRole('button', { name: 'Onay İste' }).isVisible() && await pTs.getByRole('button', { name: 'Teslime Hazır Bildir' }).isVisible() && await pTs.getByRole('button', { name: 'Tutanağı Kaydet' }).isVisible() && await pTs.getByRole('button', { name: 'Parça Ekle' }).isVisible());

  // Hakediş, IBAN, ödeme talimatı
  const pH = await firmaIsEmri(ie.is_emri_no);
  await pH.getByLabel('Hakediş Kanıtı').setInputFiles(TEMP.replace('.pdf', '3.pdf'));
  await pH.getByText('Dosya yüklendi.').first().waitFor();
  await pH.getByLabel('Brüt (EUR)').fill('510'); await pH.getByLabel('Fatura No').fill(`H${tek}`); await pH.getByLabel('Fatura Tarihi').fill('2026-11-10'); await pH.getByLabel('TCMB Satış Kuru').fill('40,1234');
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
  const pMy = await al('mfy', E);
  await pMy.getByRole('button', { name: 'İdari İşlemlerim' }).click();
  await pMy.locator('.soru', { hasText: `E2E Firma ${tek}` }).getByLabel('Teyit Kanalı').fill('Sicildeki numaradan geri arama');
  await pMy.locator('.soru', { hasText: `E2E Firma ${tek}` }).getByRole('button', { name: 'Teyit Et' }).click(); await pMy.waitForTimeout(400); await hataVarsa(pMy, 'IBAN');
  const ibanB = `E2E Firma ${tek} · Banka Hesabı Onayı`;
  await kartKarar(E, 'fmy', ibanB, 'Onaya Gönder'); await kartKarar(E, 'fym', ibanB, 'Onaya Gönder'); await kartKarar(E, 'mfm', ibanB, 'Onayla');
  const pM = await al('mfm', E);
  kontrol('IBAN Sicilden girilir, geri arama ve iki onayla geçerli olur', (await sup.query(`SELECT durum FROM banka_hesabi b JOIN kurulus k ON k.kimlik = b.kurulus_ref WHERE k.kimlik = $1 AND b.durum <> 'İptal'`, [firma])).rows[0].durum === 'Geçerli');
  await dosyaAc(pTs, d.dosyaNo); await tikla(pTs, 'Ödeme Talimatı');
  await kartKarar(E, 'mfm', h.hakedis_no, 'Onaya Gönder');
  kontrol('Ticari Sorumlu ödeme talimatını ekrandan hazırlar', (await sup.query(`SELECT count(*)::int n FROM odeme_talimati t JOIN hakedis h ON h.kimlik = t.hakedis_ref WHERE h.is_emri_ref = $1`, [ie.kimlik])).rows[0].n === 1);
  // Ödeme Listesi (YG-830): plan tarihi geçmiş talimat listeye alınır, liste iki kademe onaylanır, ödeme kaydı ekranda açılır.
  await kartKarar(E, 'tid', h.hakedis_no, 'Onayla');
  await sup.query(`UPDATE tahsilat SET tarih = current_date - 50 WHERE dosya_ref = $1`, [d.kimlik]);
  await dosyaAc(pTs, d.dosyaNo);
  kontrol('Ticari Sorumlu dosyada mahsup ve malzeme avansı formunu görür', await pTs.getByRole('button', { name: 'Mahsup Öner' }).waitFor({ timeout: 8000 }).then(() => true, () => false));
  await pTs.getByRole('button', { name: 'Tedarikçi Ödemeleri' }).click();
  const satirOd = pTs.locator('.soru', { hasText: h.hakedis_no });
  await satirOd.getByLabel('Listeye Al').check();
  await tikla(pTs, 'Ödeme Listesi Oluştur');
  await tasmaYok(pTs, 'odeme_listesi');
  const lst = (await sup.query(`SELECT l.liste_no, l.kimlik FROM odeme_listesi l JOIN odeme_talimati t ON t.odeme_listesi_ref = l.kimlik JOIN hakedis h ON h.kimlik = t.hakedis_ref WHERE h.is_emri_ref = $1`, [ie.kimlik])).rows[0];
  kontrol('Ticari Sorumlu onaylı talimatı ödeme listesine alır', Boolean(lst));
  await kartKarar(E, 'mfy', lst.liste_no, 'Onaya Gönder'); await kartKarar(E, 'tid', lst.liste_no, 'Onayla');
  await pTs.reload(); await pTs.getByRole('button', { name: 'Tedarikçi Ödemeleri' }).click();
  await pTs.getByText(`${lst.liste_no}: Onaylandı`).waitFor();
  kontrol('liste onaylanınca banka referansı alanı açılır', await pTs.locator('.soru', { hasText: h.hakedis_no }).getByLabel('Banka İşlem Referansı').isVisible());

  // Teslim
  await sup.query(`UPDATE dosya SET asama = 'Teslim' WHERE kimlik = $1`, [d.kimlik]);
  await dosyaAc(pDs, d.dosyaNo); await tikla(pDs, 'Teslimi Başlat');
  let ony27 = 0; for (let i = 0; i < 25 && ony27 === 0; i++) { ony27 = (await sup.query(`SELECT count(*)::int n FROM onay_talebi WHERE dosya_ref = $1 AND ony_kod = 'ONY-27'`, [d.kimlik])).rows[0].n; if (!ony27) await pDs.waitForTimeout(200); } // yük altında yanıt gecikebilir
  kontrol('Dosya Sorumlusu teslimi ekrandan başlatır, yat sahibine ONY-27 gider', ony27 === 1);
  sonuc.push(`DOSYA ${d.dosyaNo}`);

  // İkinci dosya: bekletme noktası, çalışma izni, uygunsuzluk, koşullu kabul, tedarik; nöbet çizelgesi
  const t2 = await pDs.api('/ihbar', { kanal: 'Telefon', sahibiAdi: 'Kaptan', sahibiTuru: 'Yatın Kaptanı', yetkiDurumu: 'Doğrulandı', telefon: '+905550001111', konum: 'Bodrum', yatDurumu: 'Bağlı', ihtiyac: 'Hasar', sigortaci: sgAd, hasarNo: `J${tek}`, yat: { adi: `E2E Yat2 ${tek}`, markaDiger: 'M', modelDiger: 'N', boy: 14, govde: 'Fiber', tur: 'Motor Yat' }, yatSahibi: { ad: 'Sahip', telefon: '+905550002222', eposta: `sahip2${tek}@deneme.yatonet.local` }, cevaplar: {} });
  await pDs.api(`/ihbar/${t2.kimlik}/mukerrerlik`, { sonuc: 'Mükerrer değil' });
  const d2 = await pDs.api(`/ihbar/${t2.kimlik}/acilis`, { karar: 'Kabul', ozet: 'Açılış', musteriTuru: 'Sigorta Şirketi' });
  for (const [p, k, r] of [[pOpm, 'ds', 'Dosya Sorumlusu'], [pOpm, 'oy', 'Operasyon Yöneticisi'], [pTm, 'tu', 'Teknik Uzman'], [pTm, 'ty', 'Teknik Yönetici']]) await p.api(`/dosya/${d2.kimlik}/ekip`, { kullanici: kimlikler[k], rol: r });
  E.kk = await hesap('kk', 'Kalite Uzmanı (Kalite Kontrolör)'); E.tds = await hesap('tds', 'Tedarik Sorumlusu'); E.tym = await hesap('tym', 'Tedarik Yönetimi Müdürü'); E.to = await hesap('to', 'Teknik ve Operasyon Direktörü');
  for (const [k, r] of [['kk', 'Kalite Kontrolör'], ['tds', 'Tedarik Sorumlusu']]) await sup.query(`INSERT INTO dosya_ekibi_atamasi (dosya_ref, kullanici_ref, rol, olusturan_ref) VALUES ($1,$2,$3,$4)`, [d2.kimlik, kimlikler[k], r, kimlikler.opm]);
  await sup.query(`INSERT INTO kalite_plani (dosya_ref, surum, kabul_sinifi, ozet, durum, hazirlayan_ref) VALUES ($1,1,'D','Ö','Onaylı',$2)`, [d2.kimlik, kimlikler.tu]);
  const ie2 = (await sup.query(`INSERT INTO is_emri (is_emri_no, is_emri_turu, dosya_ref, kurulus_ref, uygulama_yeri, kapsam, firma_bedeli_eur, statu, hazirlayan_ref) VALUES ($1,'ON',$2,$3,'Bodrum','K',500,'Aktif',$4) RETURNING kimlik, is_emri_no`, [`${d2.dosyaNo}-ON01`, d2.kimlik, firma, kimlikler.oy])).rows[0];
  await sup.query(`INSERT INTO is_emri_kalemi (is_emri_ref, aciklama, miktar, birim) VALUES ($1,'Kalem A',4,'saat')`, [ie2.kimlik]);
  // Bekletme noktası
  const pT2 = await al('tu', E); await dosyaAc(pT2, d2.dosyaNo);
  await pT2.locator('#kp-e').selectOption(ie2.kimlik); await pT2.locator('#kp-o').fill('Basınç'); await pT2.locator('#kp-k').fill('5 bar');
  await pT2.locator('#kp-z').fill(new Date(Date.now() + 30 * 3_600_000 + 180 * 60_000).toISOString().slice(0, 16));
  await tikla(pT2, 'Kontrol Noktası Ekle');
  const firmaIlerleme = async (dosya) => { const p = await firmaIsEmri(ie2.is_emri_no); await p.getByLabel('Kalem', { exact: true }).selectOption({ index: 1 }); await p.getByLabel('Miktar', { exact: true }).fill('1'); await p.getByLabel('Kanıt Belgesi').setInputFiles(dosyaYaz(dosya)); await p.getByText('Dosya yüklendi.').first().waitFor(); await p.getByRole('button', { name: 'İlerleme Kaydet' }).click(); await p.waitForTimeout(500); return p; };
  let pF3 = await firmaIlerleme('a');
  kontrol('bekletme noktası serbest bırakılmadan firma ilerleyemez', (await pF3.getByRole('alert').first().textContent()).includes('Bekletme noktası'));
  await dosyaAc(pT2, d2.dosyaNo);
  await pT2.getByLabel('Kontrol Kanıtı').first().setInputFiles(dosyaYaz('b')); await pT2.getByText('Dosya yüklendi.').first().waitFor();
  await pT2.getByRole('button', { name: 'Uygun', exact: true }).click(); await pT2.waitForTimeout(500); await hataVarsa(pT2, 'Kontrol sonucu');
  kontrol('kontrol noktası ekrandan serbest bırakılır', (await sup.query(`SELECT serbest_birakma_zamani z FROM kontrol_noktasi WHERE is_emri_ref = $1`, [ie2.kimlik])).rows[0].z !== null);
  // Çalışma izni
  await pT2.locator('#kp-e').selectOption(ie2.kimlik); await tikla(pT2, 'Çalışma İzni Zorunlu');
  pF3 = await firmaIlerleme('c');
  kontrol('çalışma izni yokken firma ilerleyemez', (await pF3.getByRole('alert').first().textContent()).includes('çalışma izni'));
  await pF3.locator('#ci-s').fill('Marina'); await pF3.locator('#ci-n').fill('İ-1'); await pF3.locator('#ci-v').fill('Tesis Yetkilisi');
  const yerel = (s) => new Date(Date.now() + 180 * 60_000 + s * 3_600_000).toISOString().slice(0, 16);
  await pF3.locator('#ci-b').fill(yerel(-1)); await pF3.locator('#ci-e').fill(yerel(5)); await pF3.locator('#ci-o').fill('25'); await pF3.locator('#ci-y').fill('1');
  await pF3.getByLabel('İzin Belgesi').setInputFiles(dosyaYaz('d')); await pF3.waitForTimeout(600);
  await pF3.getByRole('button', { name: 'İzin Belgesini Kaydet' }).click(); await pF3.waitForTimeout(400);
  kontrol('gaz ölçümü aralık dışıysa izin kaydedilmez', (await pF3.getByRole('alert').first().textContent()).includes('Gaz ölçümü'));
  await pF3.locator('#ci-o').fill('20,9'); await tikla(pF3, 'İzin Belgesini Kaydet');
  pF3 = await firmaIlerleme('e'); await hataVarsa(pF3, 'İlerleme');
  await tikla(pF3, 'İş Tamamlandı');
  kontrol('firma izin belgesini yükler, ilerler ve işi bitirir', (await sup.query(`SELECT statu FROM is_emri WHERE kimlik = $1`, [ie2.kimlik])).rows[0].statu === 'Tamamlandı');
  // Uygunsuzluk ve koşullu kabul
  const pK = await al('kk', E); await dosyaAc(pK, d2.dosyaNo);
  await pK.locator('#n-y').fill('Güverte'); await pK.locator('#n-o').fill('Şartname 4'); await pK.locator('#n-d').fill('Çizik'); await pK.getByLabel('Uygunsuzluk Kanıtı').setInputFiles(dosyaYaz('f')); await pK.getByText('Dosya yüklendi.').first().waitFor();
  await tikla(pK, 'Uygunsuzluk Aç');
  kontrol('Kalite Kontrolör uygunsuzluğu ekrandan açar', (await sup.query(`SELECT count(*)::int n FROM uygunsuzluk WHERE dosya_ref = $1`, [d2.kimlik])).rows[0].n === 1);
  await dosyaAc(pT2, d2.dosyaNo);
  await pT2.locator('#kk-e').selectOption(ie2.kimlik); await pT2.locator('#kk-b').fill(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)); await pT2.locator('#kk-t').fill('Rötuş'); await pT2.locator('#kk-i').fill('Görsel'); await pT2.locator('#kk-h').fill(new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10));
  await pT2.locator('#kk-bd').fill('0');
  await tikla(pT2, 'Koşullu Kabul Ver');
  kontrol('Teknik Uzman koşullu kabulü ekrandan verir', (await sup.query(`SELECT teknik_kabul_sonucu s FROM is_emri WHERE kimlik = $1`, [ie2.kimlik])).rows[0].s === 'Koşullu Kabul');
  // Tedarik
  const ted = (await pSc.api('/firma', { unvan: `E2E Tedarikçi ${tek}`, rol: 'Tedarikçi' })).kimlik;
  await pFym.api(`/firma/${ted}/statu`, { asama: 'Onaylı', ag: 'Aktif', gerekce: 'E2E' });
  const pTd = await al('tds', E); await dosyaAc(pTd, d2.dosyaNo);
  await pTd.locator('#sp-ted').selectOption(ted);
  for (const [i, v] of [['teklifRef', 'T1'], ['kullanim', 'Ana makine'], ['teslimTarihi', '2027-01-15'], ['teslimYeri', 'Marina'], ['olcut', 'Sertifikalı'], ['gerekce', 'Tek kaynak'], ['tanim', 'Pompa'], ['parcaNo', 'P-1'], ['miktar', '2'], ['bedel', '100']]) await pTd.locator(`#sp-${i}`).fill(v);
  await tikla(pTd, 'Siparişi Onaya Gönder');
  let sp; for (let i = 0; i < 20 && !sp; i++) { sp = (await sup.query(`SELECT kimlik, siparis_no FROM tedarik_siparisi WHERE dosya_ref = $1`, [d2.kimlik])).rows[0]; if (!sp) await pTd.waitForTimeout(250); }
  if (!sp) throw new Error(`tedarik siparişi oluşmadı: ${await pTd.locator('[role=status]').allTextContents()}`);
  await kartKarar(E, 'tym', sp.siparis_no, 'Onaya Gönder'); await kartKarar(E, 'to', sp.siparis_no, 'Onaya Gönder'); await kartKarar(E, 'tid', sp.siparis_no, 'Onayla');
  await dosyaAc(pTd, d2.dosyaNo);
  await pTd.locator(`#g-l-${sp.kimlik}`).fill('L1'); await pTd.locator(`#g-i-${sp.kimlik}`).fill('İ1'); await pTd.locator(`#g-m-${sp.kimlik}`).fill('2'); await pTd.locator(`#g-y-${sp.kimlik}`).selectOption(firma);
  await tikla(pTd, 'Teknik Kontrole Gönder');
  await dosyaAc(pT2, d2.dosyaNo);
  await pT2.locator('.soru', { hasText: 'Lot L1' }).getByRole('button', { name: 'Kabul', exact: true }).click(); await pT2.waitForTimeout(500); await hataVarsa(pT2, 'Malzeme');
  kontrol('sipariş, giriş ve teknik kabul ekrandan tamamlanır', (await sup.query(`SELECT statu FROM tedarik_siparisi WHERE kimlik = $1`, [sp.kimlik])).rows[0].statu === 'Teslim Alındı');
  await dosyaAc(pTd, d2.dosyaNo);
  await pTd.locator(`#fa-n-${sp.kimlik}`).fill(`S${tek}`); await pTd.locator(`#fa-t-${sp.kimlik}`).fill('2026-11-20'); await pTd.locator(`#fa-u-${sp.kimlik}`).fill('200,00');
  await pTd.getByRole('button', { name: 'Üçlü Eşleştir' }).click(); await pTd.getByText('Eşleştirme: Eşleşti').waitFor();
  kontrol('üçlü eşleştirme ekrandan sonuç verir', true);
  await tasmaYok(pTd, 'tedarik_bolumu');
  // Nöbet çizelgesi
  const pOp2 = await al('opm', E);
  await pOp2.getByRole('button', { name: 'Nöbet ve Acil' }).click();
  await pOp2.locator('#nb-d').fill('2027-03'); await pOp2.locator('#nb-u').selectOption(kimlikler.ds); await pOp2.locator('#nb-b').fill('2027-03-01T18:00'); await pOp2.locator('#nb-s').fill('2027-03-02T09:00');
  await tikla(pOp2, 'Vardiya Ekle'); await tikla(pOp2, 'Çizelgeyi Onaya Gönder');
  await pOp2.getByText('Çizelge onaya gönderildi.').waitFor();
  kontrol('nöbet çizelgesi ekrandan onaya gönderilir', true);
  // A8 Tesis
  const marina = (await pSc.api('/firma', { unvan: `E2E Marina ${tek}`, rol: 'Tesis' })).kimlik;
  await pFym.api(`/firma/${marina}/statu`, { asama: 'Onaylı', ag: 'Aktif', gerekce: 'E2E' });
  E.mar = await hesap('mar', 'Tesis Yetkilisi', 'Tesis Yetkilisi (Marina, Tersane, Çekek Sahası)');
  await pFym.api(`/firma/${marina}/kullanici`, { kullanici: kimlikler.mar });
  await dosyaAc(pDs, d2.dosyaNo);
  await pDs.locator('#tis-t').selectOption(marina); await pDs.locator('#tis-u').selectOption('Çekek Randevusu'); await pDs.locator('#tis-h').fill('2026-12-15');
  await tikla(pDs, 'Tesise Talep Gönder');
  const pMar = await al('mar', E);
  for (let n = 0; n < 6; n++) { await pMar.waitForTimeout(500); const b = pMar.getByRole('button', { name: /^(Bilgilendim|Devam|Ana Ekrana Geç|Okudum, Kabul Ediyorum)$/ }); if (await b.count()) await b.first().click(); else break; }
  await pMar.getByText('LGM teslim onayını beklemenizi rica ederiz').first().waitFor();
  const mGovde = await pMar.locator('body').innerText();
  kontrol('tesise firma unvanı ve fiyat görünmez', !mGovde.includes(`E2E Firma ${tek}`) && !mGovde.includes('Teklif'));
  await tasmaYok(pMar, 'tesis_portali');
  await pMar.getByLabel('Tesis İzin Numarası').fill('M-77');
  await tikla(pMar, 'İzin Ver');
  await pMar.getByText('İzin No: M-77').first().waitFor();
  kontrol('tesis talebi portaldan onaylar, takvimde Onaylı görünür', (await pMar.locator('body').innerText()).includes('Onaylı'));
  // A9 Tedarikçi
  E.tdc = await hesap('tdc', 'Tedarikçi Kullanıcısı', 'Tedarikçi');
  await pFym.api(`/firma/${ted}/kullanici`, { kullanici: kimlikler.tdc });
  await dosyaAc(pTd, d2.dosyaNo);
  await pTd.locator('#tt-t').selectOption(ted); await pTd.locator('#tt-s').fill('2027-01-20T12:00'); await pTd.locator('#tt-u').fill('Filtre'); await pTd.locator('#tt-p').fill('F-9');
  await tikla(pTd, 'Teklif Talebi Gönder');
  const pTc = await al('tdc', E);
  for (let n = 0; n < 6; n++) { await pTc.waitForTimeout(500); const b = pTc.getByRole('button', { name: /^(Bilgilendim|Devam|Ana Ekrana Geç|Okudum, Kabul Ediyorum)$/ }); if (await b.count()) await b.first().click(); else break; }
  await pTc.getByLabel('Birim Fiyat (EUR)').fill('40'); await pTc.getByLabel('Teslim Süresi (Gün)').fill('3');
  await tasmaYok(pTc, 'tedarikci_portali');
  await tikla(pTc, 'Teklifi Gönder');
  const sp2 = (await sup.query(`INSERT INTO tedarik_siparisi (siparis_no, dosya_ref, kurulus_ref, tedarikci_teklif_ref, nihai_kullanim_yeri, kdv_haric_eur, kdv_eur, toplam_eur, teslim_tarihi, teslim_yeri, kabul_olcutu, secim_gerekcesi, statu, hazirlayan_ref) VALUES ($1,$2,$3,'T','K',80,16,96,'2027-01-20','Marina','Ö','G','Verildi',$4) RETURNING kimlik`, [`${d2.dosyaNo}-SP09`, d2.kimlik, ted, kimlikler.tds])).rows[0];
  await sup.query(`INSERT INTO tedarik_siparisi_kalemi (siparis_ref, satir_no, urun_tanimi, uretici_parca_no, miktar, birim, birim_bedel_eur, toplam_eur) VALUES ($1,1,'Filtre','F-9',2,'adet',40,80)`, [sp2.kimlik]);
  await al('tdc', E);
  await pTc.locator(`#sk-t-${sp2.kimlik}`).fill('2027-01-15'); await pTc.locator(`#sk-k-${sp2.kimlik}`).fill(await kod('tdc'));
  await tikla(pTc, 'Siparişi Kabul Ediyorum');
  await pTc.getByRole('button', { name: 'Siparişler' }).first().click(); await pTc.locator(`#sv-t-${sp2.kimlik}`).waitFor();
  kontrol('tedarikçi alt menüde Teklifler ve Hesap vardır', await pTc.getByRole('button', { name: 'Teklifler' }).first().isVisible() && await pTc.getByRole('button', { name: 'Hesap' }).first().isVisible());
  await pTc.getByRole('button', { name: 'Hesap' }).first().click(); await pTc.getByText('Kurum Bilgileri').waitFor();
  await tasmaYok(pTc, 'kurum_hesap');
  await pTc.getByLabel('Ad Soyad').fill('Yeni Kişi'); await pTc.getByLabel('E-posta').fill(`e2e-yeni-${tek}@deneme.local`);
  await tikla(pTc, 'Kullanıcı Ekle');
  kontrol('kurum kullanıcı talebi ekrandan açılır, hesap teyitten önce açılmaz', (await sup.query(`SELECT durum FROM kurum_kullanici_talebi WHERE eposta = $1`, [`e2e-yeni-${tek}@deneme.local`])).rows[0]?.durum === 'Teyit Bekliyor' && !(await sup.query(`SELECT 1 FROM kullanici_hesabi WHERE e_posta = $1`, [`e2e-yeni-${tek}@deneme.local`])).rowCount);
  await pTc.getByRole('button', { name: 'Siparişler' }).first().click(); await pTc.locator(`#sv-t-${sp2.kimlik}`).waitFor();
  await pTc.locator(`#sv-t-${sp2.kimlik}`).fill('2027-01-10'); await pTc.locator(`#sv-i-${sp2.kimlik}`).fill('İ9'); await pTc.locator(`#sv-s-${sp2.kimlik}`).fill('Kargo'); await pTc.locator(`#sv-l-${sp2.kimlik}`).fill('L9');
  await pTc.getByLabel('İrsaliye ve Sertifika').setInputFiles(dosyaYaz('g')); await pTc.getByText('Dosya yüklendi.').first().waitFor();
  await tikla(pTc, 'Sevk Bildir');
  const pMt = await al('mfm', E); await pMt.getByRole('button', { name: 'Tedarikçi Ödemeleri' }).first().click(); await pMt.getByRole('heading', { name: 'Tedarikçi Ödemeleri' }).waitFor();
  kontrol('muhasebe Tedarikçi Ödemeleri sayfasını açar', await pMt.getByText('Açık Faturalar').first().isVisible());
  kontrol('tedarikçi teklif verir, siparişi kodla kabul eder, sevk bildirir', (await sup.query(`SELECT count(*)::int n FROM tedarik_sevki WHERE siparis_ref = $1`, [sp2.kimlik])).rows[0].n === 1);
  // Bugün: kademe atlama ve geri çekme
  const atlaR = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Muhasebe ve Finans Müdürü'`)).rows[0].kimlik; const atlaS = (await sup.query(`SELECT kimlik FROM rol WHERE rol_adi = 'Ticari İşler Direktörü'`)).rows[0].kimlik;
  const atlaB = `E2E Kademe ${tek}`; await sup.query(`INSERT INTO is_karti (tur, kategori, baslik, hazirlayan_ref, zincir) VALUES ('Deneme','onay',$1,$2,$3)`, [atlaB, kimlikler.ds, [atlaR, atlaS]]);
  const pTd2 = await al('tid', E);
  const atlaK = pTd2.locator('.ozet', { hasText: atlaB }); await atlaK.waitFor();
  await atlaK.getByLabel('Gerekçe').fill('Acil'); await atlaK.getByRole('button', { name: 'Kademeyi Atla' }).click(); await atlaK.waitFor({ state: 'detached' });
  kontrol('Direktör Bugün ekranından kademeyi gerekçeyle atlar', (await sup.query(`SELECT durum FROM is_karti WHERE baslik = $1`, [atlaB])).rows[0].durum === 'Onaylandı');
  const iadeB = `E2E İade ${tek}`; await sup.query(`INSERT INTO is_karti (tur, kategori, baslik, hazirlayan_ref, zincir, durum) VALUES ('Deneme','onay',$1,$2,$3,'İade Edildi')`, [iadeB, kimlikler.ds, [atlaS]]);
  await al('ds', E); const iadeK = pDs.locator('.ozet', { hasText: iadeB }); await iadeK.waitFor();
  await iadeK.getByRole('button', { name: 'Geri Çek' }).click(); await iadeK.waitFor({ state: 'detached' });
  kontrol('hazırlayan iade edileni Bugün ekranından geri çeker', (await sup.query(`SELECT durum FROM is_karti WHERE baslik = $1`, [iadeB])).rows[0].durum === 'Geri Çekildi');
  // İP-7, İP-8, İP-10 ekranları
  const pDs3 = await al('ds', E);
  await pDs3.getByRole('button', { name: /Veri İhlali Bildir/ }).click();
  const ihAd = `E2E İhlal ${tek}`; await pDs3.locator('#vi-o').fill(ihAd); await tikla(pDs3, 'Bildir'); await pDs3.waitForTimeout(600); await hataVarsa(pDs3, 'İhlal');
  kontrol('kullanıcı üst menüden veri ihlali bildirir', (await sup.query(`SELECT 1 FROM veri_ihlali WHERE ozet = $1`, [ihAd])).rowCount === 1);
  E.hud2 = await hesap('hud2', 'Hukuk ve Uyum Direktörü'); E.huu2 = await hesap('huu2', 'Hukuk ve Uyum Uzmanı'); E.iks2 = await hesap('iks2', 'İnsan Kaynakları Sorumlusu');
  const pHud = await al('hud2', E); await pHud.getByRole('button', { name: /KVKK ve Uyum/ }).first().click();
  const ihK = pHud.locator('.soru', { hasText: ihAd }); await ihK.waitFor(); await ihK.getByRole('button', { name: 'Değerlendirmeyi Başlat' }).click(); await pHud.waitForTimeout(600); await hataVarsa(pHud, 'Değerlendirme');
  kontrol('Hukuk ve Uyum Direktörü ekrandan değerlendirmeyi başlatır', (await sup.query(`SELECT ust_yonetim_bilgi_zamani z FROM veri_ihlali WHERE ozet = $1`, [ihAd])).rows[0].z !== null);
  const pHuu = await al('huu2', E); await pHuu.getByRole('button', { name: /KVKK ve Uyum/ }).first().click();
  const bsAd = `E2E Başvuran ${tek}`; await pHuu.locator('#kb-a').fill(bsAd); await pHuu.locator('#kb-i').fill('a@b.local'); await pHuu.locator('#kb-y').fill('KEP'); await pHuu.locator('#kb-d').fill('2026-11-05'); await tikla(pHuu, 'Başvuruyu Kaydet'); await pHuu.waitForTimeout(600); await hataVarsa(pHuu, 'Başvuru');
  kontrol('Hukuk ve Uyum Uzmanı başvuruyu ekrandan kaydeder', (await sup.query(`SELECT son_yanit_tarihi::text s FROM ilgili_kisi_basvurusu WHERE basvuran_ad_soyad = $1`, [bsAd])).rows[0]?.s === '2026-12-05');
  const pIk = await al('iks2', E); await pIk.getByRole('button', { name: 'İdari İşlemlerim' }).click(); await pIk.locator('#pk-k').waitFor();
  await pIk.locator('#pk-k').selectOption(kimlikler.ds); await pIk.locator('#pk-g').fill('2024-01-01'); await pIk.locator('#pk-b').fill('50000'); await pIk.locator('#pk-e').fill('2026'); await tikla(pIk, 'Kartı Kaydet'); await pIk.waitForTimeout(600); await hataVarsa(pIk, 'Kart');
  kontrol('İnsan Kaynakları personel kartını ekrandan girer', (await sup.query(`SELECT ek3_yil FROM personel_karti WHERE kullanici_ref = $1`, [kimlikler.ds])).rows[0]?.ek3_yil === 2026);
  await pDs3.getByRole('button', { name: 'İdari İşlemlerim' }).click(); await pDs3.locator('#pu-t').waitFor();
  await pDs3.locator('#pu-t').fill('2026-11-02'); await pDs3.locator('#pu-i').fill('09:00'); await pDs3.locator('#pu-c').fill('18:00'); await tikla(pDs3, 'Puantaj Kaydet'); await pDs3.waitForTimeout(600); await hataVarsa(pDs3, 'Puantaj');
  kontrol('personel puantajı ekrandan girer', (await sup.query(`SELECT net_dakika n FROM puantaj_kaydi WHERE personel_ref = $1 AND tarih = '2026-11-02'`, [kimlikler.ds])).rows[0]?.n === 480);
  const pDs4 = await al('ds', E); await dosyaAc(pDs4, d.dosyaNo);
  await pDs4.locator('#go-i').fill('Yama'); await pDs4.locator('#go-k').fill('Limanda'); await pDs4.locator('#go-u').fill('2026-11-05'); await pDs4.locator('#go-s').fill('2026-11-20'); await tikla(pDs4, 'Geçici Onarım Kaydet'); await pDs4.waitForTimeout(600); await hataVarsa(pDs4, 'Geçici onarım');
  kontrol('geçici onarım ekrandan kaydedilir', (await sup.query(`SELECT 1 FROM gecici_onarim WHERE dosya_ref = $1`, [d.kimlik])).rowCount === 1);
  const pFirA = await al('fir', E); await pFirA.locator('#fa-q').fill(d.dosyaNo); await pFirA.waitForTimeout(800);
  kontrol('firma dosya numarasıyla iş emri arar', (await pFirA.locator('.ozet', { hasText: d.dosyaNo }).count()) > 0);
  sonuc.push(`DOSYA ${d2.dosyaNo}`);
} catch (e) {
  sonuc.push(`KALDI  beklenmeyen: ${e.message.split('\n')[0]}`);
  for (const [k, s] of Object.entries(sayfalar)) await s.screenshot({ path: join(CIKTI, `hata_${k}.png`), fullPage: true }).catch(() => {});
} finally {
  kontrol('sayfa hatası yok', hatalar.length === 0);
  if (hatalar.length) sonuc.push(...hatalar);
  console.log(sonuc.join('\n'));
  await tarayici.close(); await sup.end();
}
