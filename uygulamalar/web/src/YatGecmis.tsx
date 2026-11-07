import { useState } from 'react';
import { istek } from './api';

type Gecmis = { kimlik: string; dosya_no: string; bildirim_tarihi: string | null; kisa_teknik_tanim: string | null; statu: string; kapanma_nedeni: string | null; raporlar: { kimlik: string; raporNo: string; tur: string }[] };

/** YG-095: aynı yatın önceki dosyaları ve onaylı teknik raporları. */
export function YatGecmisi({ dosya }: { dosya: string }) {
  const [l, setL] = useState<Gecmis[] | null>(null); const [m, setM] = useState('');
  return <><div className="bolum">Yatın Onarım Geçmişi</div>{m && <div className="not" role="status">{m}</div>}
    <button className="btn2 kucuk" onClick={() => void istek<Gecmis[]>(`/dosya/${dosya}/yat-gecmisi`).then(setL).catch((e) => setM(e.message))}>Geçmişi Göster</button>
    {l && <div className="ozet">{l.length === 0 && <div className="not">Bu yat için önceki dosya bulunmamaktadır.</div>}{l.map((x) => <div key={x.kimlik}>{x.dosya_no} · {x.bildirim_tarihi ? x.bildirim_tarihi.split('-').reverse().join('.') : '-'} · {x.kisa_teknik_tanim ?? '-'} · {x.statu}{x.kapanma_nedeni ? ` (${x.kapanma_nedeni})` : ''}{x.raporlar.length ? ` · Raporlar: ${x.raporlar.map((r) => r.raporNo).join(', ')}` : ''}</div>)}</div>}</>;
}
