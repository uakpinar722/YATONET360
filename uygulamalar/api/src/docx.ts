import { deflateRawSync } from 'node:zlib';
import type { BelgeTanim, Hucre } from './pdf.js';

/** Basit ZIP yazıcı (deflate); .docx kabı için yeterlidir. */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(dosyalar: { ad: string; veri: Buffer }[]): Buffer {
  const yerel: Buffer[] = []; const merkez: Buffer[] = []; let ofset = 0;
  for (const d of dosyalar) {
    const ad = Buffer.from(d.ad, 'utf8'); const sik = deflateRawSync(d.veri); const crc = crc32(d.veri);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(sik.length, 18); h.writeUInt32LE(d.veri.length, 22); h.writeUInt16LE(ad.length, 26); h.writeUInt16LE(0, 28);
    yerel.push(h, ad, sik);
    const m = Buffer.alloc(46); m.writeUInt32LE(0x02014b50, 0); m.writeUInt16LE(20, 4); m.writeUInt16LE(20, 6); m.writeUInt16LE(0x0800, 8); m.writeUInt16LE(8, 10); m.writeUInt32LE(0, 12); m.writeUInt32LE(crc, 16); m.writeUInt32LE(sik.length, 20); m.writeUInt32LE(d.veri.length, 24); m.writeUInt16LE(ad.length, 28); m.writeUInt32LE(ofset, 42);
    merkez.push(m, ad); ofset += 30 + ad.length + sik.length;
  }
  const mb = Buffer.concat(merkez); const s = Buffer.alloc(22); s.writeUInt32LE(0x06054b50, 0); s.writeUInt16LE(dosyalar.length, 8); s.writeUInt16LE(dosyalar.length, 10); s.writeUInt32LE(mb.length, 12); s.writeUInt32LE(ofset, 16);
  return Buffer.concat([...yerel, mb, s]);
}

const x = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const LAC = '1D3557';
const r = (t: unknown, o: { b?: boolean; sz?: number; renk?: string } = {}) => `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${o.b ? '<w:b/>' : ''}${o.renk ? `<w:color w:val="${o.renk}"/>` : ''}<w:sz w:val="${o.sz ?? 20}"/></w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
const p = (ic: string, o: { hiza?: 'left' | 'center' | 'right'; once?: number; sonra?: number } = {}) => `<w:p><w:pPr><w:spacing w:before="${o.once ?? 0}" w:after="${o.sonra ?? 80}"/>${o.hiza ? `<w:jc w:val="${o.hiza}"/>` : ''}</w:pPr>${ic}</w:p>`;
const hucre = (ic: string, o: { gen?: number; zemin?: string; hiza?: 'left' | 'center' | 'right' } = {}) => `<w:tc><w:tcPr>${o.gen ? `<w:tcW w:w="${o.gen}" w:type="dxa"/>` : ''}${o.zemin ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.zemin}"/>` : ''}</w:tcPr>${p(ic, { hiza: o.hiza, sonra: 0 })}</w:tc>`;
const tablo = (satirlar: string[]) => `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="single" w:sz="4" w:color="B8C2CC"/>`).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>${satirlar.map((s) => `<w:tr>${s}</w:tr>`).join('')}</w:tbl>${p('', { sonra: 60 })}`;
const metinHucre = (h: Hucre) => (h && typeof h === 'object' ? h.m : h ?? '---');
const HIZA = { sol: 'left', ort: 'center', sag: 'right' } as const;
const UNVAN = 'LİMİT GLOBAL MARINE Denizcilik Onarım ve Teknik Hizmetler Sanayi ve Ticaret Limited Şirketi';

/** PDF ile aynı belge tanımından Word (.docx) üretir: kimlik bandı, numaralı bölümler, alan ve kalem tabloları, toplamlar, matbu metinler. */
export function docxUret(t: BelgeTanim): Buffer {
  const en = t.dil === 'en'; const g: string[] = [];
  g.push(p(r(UNVAN, { b: true, sz: 18, renk: LAC }), { sonra: 40 }));
  g.push(p(r(`${t.kod ? `${t.kod} · ` : ''}${t.ad}`, { b: true, sz: 30, renk: LAC }), { sonra: 120 }));
  if (t.icKayit) g.push(p(r(en ? 'INTERNAL RECORD · NOT FOR EXTERNAL USE' : 'İÇ KAYIT · DIŞARIYA GÖNDERİLMEZ', { b: true, sz: 16, renk: 'B00020' })));
  const band = [[en ? 'Document No' : 'Belge No', t.no], ...(t.dosyaNo ? [[en ? 'File No' : 'Dosya No', t.dosyaNo]] : []), [en ? 'Date' : 'Tarih', t.tarih], [en ? 'Version' : 'Sürüm', t.surum], ...(t.bandEk ?? []).map((b) => [b.et, b.deger])];
  g.push(tablo([band.map(([e]) => hucre(r(e, { b: true, sz: 16, renk: LAC }), { zemin: 'EEF3F8' })).join(''), band.map(([, d]) => hucre(r(d, { sz: 18 }))).join('')]));
  for (const m of t.matbuBas ?? []) g.push(p(r(m)));
  let n = 0;
  for (const b of t.bolumler) {
    g.push(p(r(`${b.numarasiz ? '' : `${String(++n).padStart(2, '0')} · `}${b.baslik.toLocaleUpperCase(en ? 'en' : 'tr-TR')}`, { b: true, sz: 20, renk: LAC }), { once: 160, sonra: 60 }));
    if (b.tur === 'metin') for (const s of b.metin.split(/\r?\n/)) g.push(p(r(s)));
    else if (b.tur === 'gorsel') g.push(p(r(b.altyazi ?? '', { sz: 16 }))); // YG-679: görsel yalnız PDF'te gömülür
    else if (b.tur === 'fotolar') for (const f of b.ogeler) g.push(p(r(f.altyazi, { sz: 16 }))); // YG-713
    else if (b.tur === 'alanlar') g.push(tablo(b.alanlar.map((a) => hucre(r(a.et, { b: true, sz: 18, renk: LAC }), { gen: 2800, zemin: 'F4F7FA' }) + hucre(r(a.deger ?? '---', { sz: 18 })))));
    else {
      const sat = [b.sutunlar.map((s) => hucre(r(s.ad, { b: true, sz: 16, renk: 'FFFFFF' }), { zemin: LAC, hiza: s.hiza ? HIZA[s.hiza] : undefined })).join('')];
      for (const s of b.satirlar) sat.push(s.map((h, i) => hucre(r(metinHucre(h), { sz: 18 }), { hiza: b.sutunlar[i]?.hiza ? HIZA[b.sutunlar[i]!.hiza!] : undefined })).join(''));
      for (const tp of b.toplamlar ?? []) sat.push(`<w:tc><w:tcPr><w:gridSpan w:val="${b.sutunlar.length - 1}"/></w:tcPr>${p(r(tp.et, { b: true, sz: 18 }), { hiza: 'right', sonra: 0 })}</w:tc>${hucre(r(tp.deger, { b: Boolean(tp.ana), sz: 18 }), { hiza: 'right', zemin: tp.ana ? 'EEF3F8' : undefined })}`);
      if (!b.satirlar.length) sat.push(hucre(r(en ? 'No records.' : 'Kayıt bulunmamaktadır.', { sz: 18 })) );
      g.push(tablo(sat));
    }
  }
  if (t.onay) g.push(p(r(`${en ? 'YATONET 360 Approval Record' : 'YATONET 360 Onay Kaydı'}: ${t.onay.rol} · ${t.onay.zaman} · ${t.onay.kanal}${t.onay.kod ? ` · ${t.onay.kod}` : ''}`, { sz: 18 }), { once: 160 }));
  for (const m of t.matbuSon ?? []) g.push(p(r(m, { sz: 16 })));
  const govde = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${g.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="900" w:bottom="1000" w:left="900" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zip([
    { ad: '[Content_Types].xml', veri: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { ad: '_rels/.rels', veri: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { ad: 'word/document.xml', veri: Buffer.from(govde, 'utf8') },
  ]);
}
