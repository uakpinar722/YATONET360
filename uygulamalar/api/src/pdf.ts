import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import type { Dil } from './metin.js';

const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// YG-701 resmî unvan. İletişim ve sicil bilgileri NUM-1 gereği şirket bilgileri (ŞB) kesinleşince parametreden gelir; YG-676 o zaman tamamlanır.
const UNVAN = 'LİMİT GLOBAL MARINE Denizcilik Onarım ve Teknik Hizmetler Sanayi ve Ticaret Limited Şirketi';

const ETIKET = {
  tr: { sayfa: 'Sayfa', belgeNo: 'Belge No', dosyaNo: 'Dosya No', tarih: 'Tarih', surum: 'Sürüm', icindekiler: 'İçindekiler', onay: 'YATONET 360 Onay Kaydı', onaylayan: 'Onaylayan', zaman: 'Tarih-Saat', kanal: 'Kanal', kod: 'Onay Kodu', ic: 'İÇ KAYIT · DIŞARIYA GÖNDERİLMEZ' },
  en: { sayfa: 'Page', belgeNo: 'Document No', dosyaNo: 'File No', tarih: 'Date', surum: 'Version', icindekiler: 'Contents', onay: 'YATONET 360 Approval Record', onaylayan: 'Approved By', zaman: 'Date and Time', kanal: 'Channel', kod: 'Approval Code', ic: 'INTERNAL RECORD · NOT FOR EXTERNAL USE' },
};

export type Hiza = 'sol' | 'ort' | 'sag';
/** YG-684: Hayır yeşil, Bilinmiyor sarı, Kısmen turuncu, Evet kırmızı. */
export type Renk = 'yesil' | 'sari' | 'turuncu' | 'kirmizi';
export type Hucre = string | number | null | undefined | { m: string; renk: Renk };
export type Bolum =
  | { baslik: string; tur: 'alanlar'; alanlar: { et: string; deger: string | null | undefined; genis?: boolean }[]; numarasiz?: boolean }
  | { baslik: string; tur: 'metin'; metin: string; numarasiz?: boolean }
  | { baslik: string; tur: 'tablo'; sutunlar: { ad: string; hiza?: Hiza }[]; satirlar: Hucre[][]; toplamlar?: { et: string; deger: string; ana?: boolean }[]; numarasiz?: boolean };

export interface BelgeTanim {
  ad: string; kod?: string; no: string; dosyaNo?: string; tarih: string; surum: string; dil: Dil; yat?: string;
  /** Rapor: 5 sayfayı aşınca İçindekiler de üretilir (YG-677). */
  rapor?: boolean; icKayit?: boolean;
  /** YG-610: gizlilik işareti, kullanıcı rolü ve tarih. */
  isaret?: string;
  matbuBas?: string[]; bolumler: Bolum[]; matbuSon?: string[];
  onay?: { rol: string; zaman: string; kanal: string; kod?: string };
  /** LGM'nin düzenlediği belgede kaşe; sözleşmelerde kullanılmaz (CEO 09.11). */
  kase?: boolean;
  /** YG-720: belgeye özgü kimlik bandı alanları. */
  bandEk?: { et: string; deger: string }[];
}

const k = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const css = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\A ');
const dolu = (x: unknown) => (x === null || x === undefined || x === '' ? '---' : String(x)); // YG-687, YG-686, YG-1377: boş alan "---" (CEO 12.11.2026)
const b64 = (yol: string) => readFileSync(join(KOK, yol)).toString('base64');
const onbellek = new Map<string, string>();
const gorsel = (yol: string) => { if (!onbellek.has(yol)) onbellek.set(yol, `data:image/png;base64,${b64(yol)}`); return onbellek.get(yol)!; };

function stil(t: BelgeTanim, kapak: boolean) {
  const e = ETIKET[t.dil];
  const ust = `${t.kod ? `${t.kod} — ` : ''}${t.ad}`;
  const sag = `${t.no} · ${t.surum}`;
  const alt = `${UNVAN}${t.isaret ? `\n${t.isaret}` : ''}`;
  const altLogo = gorsel('uygulamalar/web/public/yatonet.png');
  return `
@page { size: A4; margin: 21mm 16mm 25mm;
  @top-left { content: "${css(ust)}"; font: 9pt Calibri, Carlito, Arial, sans-serif; color: #A6743E; border-bottom: .6pt solid #A6743E; vertical-align: bottom; padding-bottom: 2pt; margin-bottom: 2.5mm; width: 55%; }
  @top-right { content: "${css(sag)}"; font: 9pt Calibri, Carlito, Arial, sans-serif; color: #A6743E; border-bottom: .6pt solid #A6743E; vertical-align: bottom; padding-bottom: 2pt; margin-bottom: 2.5mm; text-align: right; }
  @bottom-left { content: "${css(alt)}"; white-space: pre-wrap; font: 7.5pt Calibri, Carlito, Arial, sans-serif; color: #6B6B6B; border-top: .5pt solid #D9D4CC; vertical-align: top; padding-top: 3pt; margin-top: 2.5mm; width: 78%; }
  @bottom-right { content: image-set(url("${altLogo}") 9x) "\\A ${e.sayfa} " counter(page) " / " counter(pages); white-space: pre; font: bold 9pt Calibri, Carlito, Arial, sans-serif; color: #162442; border-top: .5pt solid #D9D4CC; vertical-align: top; padding-top: 3pt; margin-top: 2.5mm; text-align: right; width: 22%; }
}
@page :first { @top-left { content: none; border: 0; } @top-right { content: none; border: 0; } ${kapak ? '@bottom-left { content: none; border: 0; } @bottom-right { content: none; border: 0; }' : ''} }
* { box-sizing: border-box; }
body { margin: 0; font: 10.5pt/1.35 Calibri, Carlito, Arial, sans-serif; color: #162442; background: #fff; }
h1, .kapak h1 { font-family: Cambria, Caladea, Georgia, serif; font-weight: 400; }
.bas { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1.2pt solid #A6743E; padding-bottom: 3pt; }
.bas img { height: 13mm; }
.bas h1 { font-size: 19pt; margin: 0; text-align: right; }
.bas .kod { font-size: 9pt; color: #A6743E; text-align: right; }
.ic { margin-top: 3mm; padding: 1.5mm; text-align: center; font-weight: 700; color: #B3261E; border: .6pt solid #B3261E; }
table { width: 100%; border-collapse: collapse; margin-top: 4mm; }
table.band { margin-top: 5mm; }
.band td { border: .5pt solid #D9D4CC; border-top: 1.5pt solid #A6743E; background: #F7F5F1; padding: 3pt 6pt; }
.band b { display: block; font-size: 11pt; margin-top: 1pt; }
.et { font-size: 8pt; color: #6B6B6B; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
th.kb { background: #F7F5F1; border: .5pt solid #D9D4CC; border-top: 1.5pt solid #A6743E; padding: 4pt 6pt; font-size: 9.5pt; font-weight: 700; text-align: left; letter-spacing: .03em; }
th.su { font-size: 8.5pt; font-weight: 400; color: #6B6B6B; border: .5pt solid #D9D4CC; padding: 3pt 5pt; }
td.h { border: .5pt solid #D9D4CC; padding: 3pt 5pt; font-size: 10pt; vertical-align: middle; }
td.a { border: .5pt solid #D9D4CC; padding: 3pt 6pt; vertical-align: top; }
td.a .d { font-size: 10.5pt; }
td.a.uzun .d, .metin { text-align: justify; }
td.metin { border: .5pt solid #D9D4CC; padding: 5pt 6pt; }
tr.mt { break-inside: auto; }
.sol { text-align: left; } .ort { text-align: center; } .sag { text-align: right; }
.yesil { background: #DDEFE2; } .sari { background: #FBF2CC; } .turuncu { background: #FBE3CC; } .kirmizi { background: #F7D9D6; }
td.top { border: .5pt solid #D9D4CC; padding: 3pt 5pt; text-align: right; }
tr.ana td { background: #F7F5F1; font-weight: 700; border-top: 1.2pt solid #A6743E; font-size: 11pt; }
.matbu { margin-top: 3mm; text-align: justify; break-inside: avoid; }
.matbu.son { font-size: 9.5pt; color: #333; }
.kase { margin-top: 3mm; text-align: right; break-inside: avoid; }
.kase img { width: 55mm; }
.kapak { break-after: page; height: 250mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.kapak .lg { height: 22mm; }
.kapak .si { width: 120mm; margin: 14mm 0; }
.kapak h1 { font-size: 26pt; margin: 0 0 4mm; }
.kapak .bl { font-size: 11pt; line-height: 1.7; }
.toc { break-after: page; }
.toc h2 { font-family: Cambria, Caladea, Georgia, serif; font-weight: 400; font-size: 17pt; border-bottom: 1.2pt solid #A6743E; padding-bottom: 3pt; }
.toc div { display: flex; justify-content: space-between; padding: 2pt 0; border-bottom: .4pt dotted #D9D4CC; }
`;
}

function hucre(h: Hucre, hiza: Hiza = 'sol') {
  const nes = typeof h === 'object' && h !== null;
  return `<td class="h ${hiza}${nes ? ` ${h.renk}` : ''}">${k(dolu(nes ? h.m : h))}</td>`;
}

const bolumAdi = (t: BelgeTanim, bolumler: Bolum[], b: Bolum) => {
  const n = bolumler.filter((x) => !x.numarasiz).indexOf(b) + 1;
  const ad = b.baslik.toLocaleUpperCase(t.dil === 'en' ? 'en-US' : 'tr-TR');
  return b.numarasiz ? ad : `${String(n).padStart(2, '0')} · ${ad}`;
};

/** YG-672: bölüm başlığı thead'dedir, sayfa bölününce tekrarlanır. YG-668: dikey sütun çizgileri. YG-670: hizalar. */
function bolumHtml(t: BelgeTanim, bolumler: Bolum[], b: Bolum, yalnizIlk = false): string {
  const ad = k(bolumAdi(t, bolumler, b));
  if (b.tur === 'metin') return `<table><thead><tr><th class="kb">${ad}</th></tr></thead><tbody><tr class="mt"><td class="metin">${k(yalnizIlk ? b.metin.slice(0, 40) : b.metin)}</td></tr></tbody></table>`;
  if (b.tur === 'tablo') {
    const n = b.sutunlar.length;
    const satirlar = yalnizIlk ? b.satirlar.slice(0, 1) : b.satirlar;
    const top = yalnizIlk ? [] : b.toplamlar ?? [];
    return `<table><thead><tr><th class="kb" colspan="${n}">${ad}</th></tr><tr>${b.sutunlar.map((s) => `<th class="su ${s.hiza ?? 'sol'}">${k(s.ad)}</th>`).join('')}</tr></thead><tbody>${
      satirlar.map((r) => `<tr>${r.map((h, i) => hucre(h, b.sutunlar[i]?.hiza)).join('')}</tr>`).join('')}${
      top.map((x) => `<tr class="${x.ana ? 'ana' : ''}"><td class="top" colspan="${n - 1}">${k(x.et)}</td><td class="top">${k(x.deger)}</td></tr>`).join('')}</tbody></table>`;
  }
  // Alanlar üç sütunda dizilir; satır sonunda boş hücre kalmaz (YG-686).
  const satirlar: string[] = []; let dizi: typeof b.alanlar = [];
  const kapat = () => {
    if (!dizi.length) return;
    const son = 6 - (dizi.length - 1) * 2;
    satirlar.push(`<tr>${dizi.map((a, i) => `<td class="a" colspan="${i === dizi.length - 1 ? son : 2}"><div class="et">${k(a.et)}</div><div class="d">${k(dolu(a.deger))}</div></td>`).join('')}</tr>`);
    dizi = [];
  };
  for (const a of yalnizIlk ? b.alanlar.slice(0, 1) : b.alanlar) {
    if (a.genis) { kapat(); satirlar.push(`<tr><td class="a uzun" colspan="6"><div class="et">${k(a.et)}</div><div class="d">${k(dolu(a.deger))}</div></td></tr>`); continue; }
    dizi.push(a); if (dizi.length === 3) kapat();
  }
  kapat();
  return `<table><thead><tr><th class="kb" colspan="6">${ad}</th></tr></thead><tbody>${satirlar.join('')}</tbody></table>`;
}

function belgeHtml(t: BelgeTanim, o: { kapak?: boolean; toc?: [string, number][]; olcum?: number } = {}): string {
  const e = ETIKET[t.dil];
  const logo = gorsel(`uygulamalar/web/public/lgm_yatay_${t.dil}.png`);
  const adTam = `${t.kod ? `${t.kod} — ` : ''}${t.ad}`;
  const kapak = o.kapak ? `<div class="kapak"><img class="lg" src="${logo}" alt=""><img class="si" src="${gorsel('veri/sablon/yat_silet.png')}" alt=""><h1>${k(t.ad)}</h1><div class="bl">${t.kod ? `${k(t.kod)}<br>` : ''}${t.yat ? `${k(t.yat)}<br>` : ''}${k(t.no)} · ${k(t.surum)}<br>${t.dosyaNo ? `${k(t.dosyaNo)}<br>` : ''}${k(t.tarih)}</div></div>` : '';
  const toc = o.toc ? `<div class="toc"><h2>${e.icindekiler}</h2>${o.toc.map(([a, s]) => `<div><span>${k(a)}</span><span>${s}</span></div>`).join('')}</div>` : '';
  const band = `<table class="band"><tr><td><div class="et">${e.belgeNo}</div><b>${k(t.no)}</b></td>${t.dosyaNo ? `<td><div class="et">${e.dosyaNo}</div><b>${k(t.dosyaNo)}</b></td>` : ''}<td><div class="et">${e.tarih}</div><b>${k(t.tarih)}</b></td>${(t.bandEk ?? []).map((x) => `<td><div class="et">${k(x.et)}</div><b>${k(x.deger)}</b></td>`).join('')}<td><div class="et">${e.surum}</div><b>${k(t.surum)}</b></td></tr></table>`;
  const son = o.olcum === undefined ? t.bolumler.length : o.olcum + 1;
  const govde = t.bolumler.slice(0, son).map((b, i) => bolumHtml(t, t.bolumler, b, i === o.olcum)).join('');
  const tamam = o.olcum === undefined;
  const onay = tamam && t.onay ? bolumHtml(t, [], { baslik: e.onay, tur: 'alanlar', numarasiz: true, alanlar: [{ et: e.onaylayan, deger: t.onay.rol }, { et: e.zaman, deger: t.onay.zaman }, { et: e.kanal, deger: t.onay.kanal }, ...(t.onay.kod ? [{ et: e.kod, deger: t.onay.kod, genis: true }] : [])] }) : '';
  return `<!doctype html><html lang="${t.dil}"><head><meta charset="utf-8"><title>${k(adTam)}</title><style>${stil(t, Boolean(o.kapak))}</style></head><body>
${kapak}${toc}<div class="bas"><img src="${logo}" alt=""><div><h1>${k(t.ad)}</h1>${t.kod ? `<div class="kod">${k(t.kod)}</div>` : ''}</div></div>${band}
${t.icKayit ? `<div class="ic">${e.ic}</div>` : ''}
${(t.matbuBas ?? []).map((m) => `<p class="matbu">${k(m)}</p>`).join('')}${govde}${onay}
${tamam && t.kase ? `<div class="kase"><img src="${gorsel(`veri/sablon/kase_${t.dil}.png`)}" alt="${k(UNVAN)}"></div>` : ''}
${tamam ? (t.matbuSon ?? []).map((m) => `<p class="matbu son">${k(m)}</p>`).join('') : ''}
</body></html>`;
}

let tarayici: Promise<Browser> | null = null;
function tarayiciAl() {
  // Geliştirmede kurulu Edge; üretimde sunucuya kurulan Chromium'un yolu ortam değişkeninden gelir.
  const yol = process.env.YATONET_PDF_TARAYICI;
  tarayici ??= chromium.launch(yol ? { executablePath: yol } : { channel: 'msedge' });
  return tarayici;
}
export async function pdfKapat() { if (tarayici) { const t = tarayici; tarayici = null; await (await t).close(); } }

async function bas(html: string): Promise<Buffer> {
  const s = await (await tarayiciAl()).newPage();
  try {
    await s.setContent(html, { waitUntil: 'load' });
    return await s.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true });
  } finally { await s.close(); }
}

export const sayfaSayisi = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;

/** YG-665…YG-677: ortak A4 şablon. 5 sayfayı aşınca kapak, raporda İçindekiler eklenir; sayfa numaraları ölçülerek yazılır. */
export async function pdfUret(t: BelgeTanim): Promise<Buffer> {
  const ilk = await bas(belgeHtml(t));
  if (sayfaSayisi(ilk) <= 5) return ilk;
  if (!t.rapor) return bas(belgeHtml(t, { kapak: true }));
  const adlar = t.bolumler.map((b) => bolumAdi(t, t.bolumler, b));
  const toc: [string, number][] = adlar.map((a) => [a, 0]);
  for (let i = 0; i < t.bolumler.length; i++) {
    const olcum = await bas(belgeHtml(t, { kapak: true, toc, olcum: i }));
    toc[i]![1] = sayfaSayisi(olcum);
  }
  return bas(belgeHtml(t, { kapak: true, toc }));
}
