"""ANV-1: LGM_Ana_Veri_Firmalar_ve_Baglama_Noktalari.xlsx dosyasını salt okunur açıp iki TSV üretir.
Veri gizlidir; çıktı dizini depo dışında olmalıdır. Kullanım: py ana_veri_tsv.py <xlsx> <cikti_dizini>"""
import os, re, sys, zipfile
import xml.etree.ElementTree as ET
A = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'; R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
N = {'a': A}

def sayfalar(p):
    z = zipfile.ZipFile(p)
    ss = [''.join(t.text or '' for t in si.iter('{%s}t' % A)) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
    wb = ET.fromstring(z.read('xl/workbook.xml')); rel = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    for s in wb.find('a:sheets', N):
        h = rel[s.attrib['{%s}id' % R]].lstrip('/'); h = h if h.startswith('xl/') else 'xl/' + h
        sat = []
        for r in ET.fromstring(z.read(h)).find('a:sheetData', N):
            d = {}
            for c in r:
                k = re.match('[A-Z]+', c.attrib['r']).group(0); v = c.find('a:v', N); t = c.attrib.get('t')
                if t == 'inlineStr': d[k] = ''.join(x.text or '' for x in c.iter('{%s}t' % A))
                elif v is not None: d[k] = ss[int(v.text)] if t == 's' else v.text
            sat.append(d)
        yield s.attrib['name'], sat

def yaz(sat, yol):
    bas = sat[0]; harf = list(bas)
    temiz = lambda x: re.sub(r'[\t\r\n]+', ' ', x or '').strip()
    with open(yol, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\t'.join(temiz(bas[k]) for k in harf) + '\n')
        for r in sat[1:]: f.write('\t'.join(temiz(r.get(k)) for k in harf) + '\n')

d = dict(sayfalar(sys.argv[1])); os.makedirs(sys.argv[2], exist_ok=True)
yaz(d['Firmalar'], os.path.join(sys.argv[2], 'firmalar.tsv')); yaz(d['Bağlama Noktaları'], os.path.join(sys.argv[2], 'noktalar.tsv'))
yaz(d['Bölgeler'], os.path.join(sys.argv[2], 'bolgeler.tsv')); yaz(d['İl Varsayılanları'], os.path.join(sys.argv[2], 'iller.tsv'))
print(len(d['Firmalar']) - 1, len(d['Bağlama Noktaları']) - 1)
