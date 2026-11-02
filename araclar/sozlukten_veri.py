"""Alan Sözlüğü (LGM-2026-014) değer listelerini ve rol listesini veri/ klasörüne TSV olarak çıkarır (YG-1124). Excel'i salt okunur açar."""
import csv, glob, html, os, re, shutil, sys, tempfile, zipfile
sys.stdout.reconfigure(encoding='utf-8')
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BELGE = r'C:\Users\limit\OneDrive\Desktop\LimitGlobalMarine'
def sutun(ref):
    n = 0
    for c in re.match(r'[A-Z]+', ref).group(0): n = n * 26 + ord(c) - 64
    return n - 1
def oku(f):
    h = os.path.join(tempfile.mkdtemp(), 'k.xlsx'); shutil.copy2(f, h)
    z = zipfile.ZipFile(h)
    ss = [html.unescape(''.join(re.findall(r'<t[^>]*>([^<]*)</t>', s))) for s in re.findall(r'<si>(.*?)</si>|<si/>', z.read('xl/sharedStrings.xml').decode('utf-8'), flags=re.S)]
    wbx = z.read('xl/workbook.xml').decode('utf-8'); rel = z.read('xl/_rels/workbook.xml.rels').decode('utf-8')
    hed = {re.search(r'Id="([^"]+)"', m).group(1): re.search(r'Target="([^"]+)"', m).group(1) for m in re.findall(r'<Relationship [^>]*>', rel)}
    S = {}
    for t in re.findall(r'<sheet [^>]*>', wbx):
        ad = html.unescape(re.search(r'name="([^"]+)"', t).group(1)); y = hed[re.search(r'r:id="([^"]+)"', t).group(1)].lstrip('/')
        y = y if y.startswith('xl/') else 'xl/' + y
        sat = []
        for r in re.finditer(r'<row [^>]*?(?:/>|>(.*?)</row>)', z.read(y).decode('utf-8'), flags=re.S):
            d = []
            for c in re.finditer(r'<c ([^>]*?)(?:/>|>(.*?)</c>)', r.group(1) or '', flags=re.S):
                a, ic = c.group(1), c.group(2) or ''; i = sutun(re.search(r'r="([A-Z]+\d+)"', a).group(1))
                tp = re.search(r't="(\w+)"', a); tp = tp.group(1) if tp else 'n'; v = re.search(r'<v>([^<]*)</v>', ic); v = v.group(1) if v else ''
                if tp == 's' and v != '': v = ss[int(v)]
                elif tp == 'inlineStr': v = html.unescape(''.join(re.findall(r'<t[^>]*>([^<]*)</t>', ic)))
                while len(d) <= i: d.append('')
                d[i] = html.unescape(v)
            sat.append(d)
        S[ad] = sat
    return S
Z = oku(glob.glob(os.path.join(BELGE, 'ANA DOKÜMANLAR', 'LGM-2026-014*.xlsx'))[0])
D = Z['Değer Listeleri'][1:]; A = Z['Alanlar']
os.makedirs(os.path.join(KOK, 'veri'), exist_ok=True)
temiz = lambda s: re.sub(r'[\t\r\n]+', ' ', s or '').strip()
with open(os.path.join(KOK, 'veri', 'deger_listeleri.tsv'), 'w', encoding='utf-8', newline='\n') as f:
    say = {}; g = set(); tekrar = 0
    for r in D:
        r = r + [''] * (4 - len(r))
        if not r[0]: continue
        if (r[0], r[1]) in g: tekrar += 1; continue
        g.add((r[0], r[1])); say[r[0]] = say.get(r[0], 0) + 1
        f.write('\t'.join([temiz(r[0]), temiz(r[1]), temiz(r[2]), temiz(r[3]), str(say[r[0]])]) + '\n')
print('liste', len(say), 'değer', sum(say.values()), 'yinelenen satır', tekrar)
for v, al in (('Kullanıcı Hesabı', ('hesap_turu', 'kullanici_grubu', 'dogrulama_yontemi', 'hesap_durumu', 'tercih_dili', 'kapatma_tetikleyicisi')), ('Oturum', ('kanal', 'bitis_nedeni')), ('Rol Ataması', ('atama_durumu',))):
    for r in A[1:]:
        if len(r) > 8 and r[1] == v and r[3] in al:
            print(v, r[3], r[8], [x[1] for x in D if x and x[0] == r[8]])
print('--- denetim izi alanları')
print([r[3] for r in A[1:] if len(r) > 3 and r[1].startswith('Denetim İzi')])
print([r[3] for r in A[1:] if len(r) > 3 and r[1].startswith('Rol (Rol')])
S = os.environ.get('YATONET_KIMLIK_TSV')
with open(S, encoding='utf-8') as f: rows = list(csv.reader(f, delimiter='\t'))
print([ (r[1], r[4]) for r in rows[1:] ])
