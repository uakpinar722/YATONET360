# ŞABLONLAR\LGM_Bildirim_Metinleri_TR_EN.xlsx ve LGM_Onay_Ekran_Metinleri_TR_EN.xlsx → veri/sablon. Resmî kaynak bu dosyalardır; metin elle düzeltilmez.
# Kullanım: py araclar\bildirim_metinlerini_aktar.py <xl_oku klasörü>
import os, sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, sys.argv[1])
from xl_oku import oku
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = r'C:\Users\limit\OneDrive\Desktop\LimitGlobalMarine\ŞABLONLAR'
tem = lambda x: ('' if x is None else str(x)).replace('\t', ' ').replace('\r', ' ').replace('\n', ' ').strip()
for kaynak, hedef, sutun in (('LGM_Bildirim_Metinleri_TR_EN.xlsx', 'bildirim_katalog.tsv', 8), ('LGM_Onay_Ekran_Metinleri_TR_EN.xlsx', 'onay_ekran_metinleri.tsv', 10)):
    d = oku(os.path.join(R, kaynak)); v = next(iter(d.values()))
    print(kaynak, list(d), v[0][:sutun])
    with open(os.path.join(KOK, 'veri', 'sablon', hedef), 'w', encoding='utf-8', newline='\n') as f:
        for r in v:
            if r and r[0]: f.write('\t'.join(tem(x) for x in (list(r) + [''] * sutun)[:sutun]) + '\n')
    print(hedef, len(v) - 1, 'satır')
