"""YG-1537: LGM-2026-012 Word serilerinden katalog kayıtlarını (seri, no, ad) salt okunur çıkarır. Kullanım: py katalog_tsv.py <seri_klasoru> <cikti.tsv> (çıktı depo dışında)."""
import glob, os, re, sys, zipfile
kok, cikti = sys.argv[1], sys.argv[2]
out = []
for f in sorted(glob.glob(os.path.join(kok, 'LGM-2026-012_Seri-*.docx'))):
    seri = int(re.search(r'Seri-(\d+)', f).group(1))
    x = zipfile.ZipFile(f).read('word/document.xml').decode('utf-8')
    for p in re.findall(r'<w:p[ >].*?</w:p>', x, re.S):
        t = ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p)).strip()
        m = re.match(r'^(\d{4})\s+\|\s+(.+)$', t)
        if m: out.append((seri, int(m.group(1)), re.sub(r'\s+', ' ', m.group(2)).strip()))
with open(cikti, 'w', encoding='utf-8', newline='\n') as w:
    w.write('seri\tno\tad\n'); w.writelines(f'{a}\t{b}\t{c}\n' for a, b, c in out)
print(len(out))
