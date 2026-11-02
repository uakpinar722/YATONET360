"""Onaylı hukuki metinleri (R\\KVKK) Word'den satır satır veri/metinler/ altına aktarır. Metin değiştirilmez; yalnız biçim atılır."""
import html, json, os, re, sys, zipfile
sys.stdout.reconfigure(encoding='utf-8')
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K = r'C:\Users\limit\OneDrive\Desktop\LimitGlobalMarine\KVKK'
L = [('KVKK-01', 'tr', 'LGM_KVKK_01_Aydinlatma_Yat_Sahibi.docx'), ('KVKK-01', 'en', 'LGM_KVKK_01_Aydinlatma_Yat_Sahibi_EN.docx'),
     ('KVKK-03', 'tr', 'LGM_KVKK_03_Aydinlatma_Cozum_Ortagi.docx'),
     ('KVKK-04', 'tr', 'LGM_KVKK_04_Aydinlatma_Is_Ortaklari_ve_Paydaslar.docx'), ('KVKK-04', 'en', 'LGM_KVKK_04_Aydinlatma_Is_Ortaklari_ve_Paydaslar_EN.docx'),
     ('KVKK-05', 'tr', 'LGM_KVKK_05_Aydinlatma_Calisan_ve_Aday.docx'),
     ('PRT-01', 'tr', 'LGM_Portal_Kullanim_Kosullari.docx'), ('PRT-01', 'en', 'LGM_Portal_Kullanim_Kosullari_EN.docx')]
def paragraflar(f):
    x = zipfile.ZipFile(f).read('word/document.xml').decode('utf-8')
    o = []
    for p in re.findall(r'<w:p[ >].*?</w:p>', x, flags=re.S):
        t = html.unescape(''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', p))).strip()
        if t: o.append(t)
    return o
os.makedirs(os.path.join(KOK, 'veri', 'metinler'), exist_ok=True)
for kod, dil, ad in L:
    P = paragraflar(os.path.join(K, ad))
    surum = next((m.group(0) for t in P[:12] for m in [re.search(r'\bR\d{2}\b', t)] if m), 'R00')
    json.dump({'kod': kod, 'dil': dil, 'surum': surum, 'baslik': P[0], 'govde': P}, open(os.path.join(KOK, 'veri', 'metinler', f'{kod}_{dil}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(kod, dil, surum, len(P), '[●]:', sum('●' in t for t in P), '|', P[0][:60], '|', P[1][:60] if len(P) > 1 else '')
if len(sys.argv) > 1:
    for t in paragraflar(os.path.join(K, sys.argv[1])): print(t[:420])
