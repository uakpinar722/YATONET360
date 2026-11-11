"""YG-858, YG-1385: LGM-2026-013 Hizmet Kapsamları belgesinden branş ve işlem kodlarını TSV'ye çıkarır (belgeyi değiştirmez).
Kullanım: py islem_katalogu_tsv.py <LGM-2026-013.docx> <cikti.tsv>
Çıktı sütunları: kod, duzey, ad, ust_kod"""
import re, sys, zipfile

DESEN = [
    (re.compile(r'^([A-ZÇĞİÖŞÜ]+-\d{2}\.\d{2}\.\d{2}-I\d{2})\s+(.+)$'), 'İşlem'),
    (re.compile(r'^([A-ZÇĞİÖŞÜ]+-\d{2}\.\d{2}\.\d{2})\s*(.+)$'), 'Tali Branş'),
    (re.compile(r'^([A-ZÇĞİÖŞÜ]+-\d{2}\.\d{2})\s*(.+)$'), 'Alt Branş'),
    (re.compile(r'^([A-ZÇĞİÖŞÜ]+-\d{2})\s*(.+)$'), 'Ana Branş'),
]

def ust(kod, duzey):
    if duzey == 'İşlem': return kod.rsplit('-I', 1)[0]
    if duzey == 'Ana Branş': return ''
    return kod.rsplit('.', 1)[0]

def main(belge, cikti):
    x = zipfile.ZipFile(belge).read('word/document.xml').decode('utf-8')
    x = re.sub(r'<w:tab/>', ' ', x); x = re.sub(r'</w:p>', '\n', x); x = re.sub(r'<[^>]+>', '', x)
    import html
    satirlar, gorulen = [], set()
    for s in html.unescape(x).splitlines():
        s = s.strip()
        for d, duzey in DESEN:
            m = d.match(s)
            if m and m.group(1) not in gorulen and not m.group(1).startswith('LGM-'):
                gorulen.add(m.group(1)); satirlar.append((m.group(1), duzey, m.group(2).strip().replace('\t', ' '), ust(m.group(1), duzey)))
                break
    with open(cikti, 'w', encoding='utf-8', newline='\n') as f:
        f.write('kod\tduzey\tad\tust_kod\n')
        for r in satirlar: f.write('\t'.join(r) + '\n')
    print(len(satirlar), 'kod;', {d: sum(1 for r in satirlar if r[1] == d) for _, d in DESEN})

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
