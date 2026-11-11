import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-1385, YG-858, YG-660: branş ve işlem kodu kataloğu araması ve kartela bağı. */
export function IslemKatalogu() {
  const [q, setQ] = useState(''); const [v, setV] = useState<{ ozet: { duzey: string; n: number }[]; kartelaBaglanmayan: string[]; sonuc: { kod: string; duzey: string; ad: string; durum: string }[] } | null>(null);
  const [k, setK] = useState(''); const [ki, setKi] = useState<{ tali: { kod: string; ad: string; alt_ad: string; ana_ad: string }; islemler: { kod: string; ad: string; durum: string }[] } | null>(null); const [h, setH] = useState('');
  useEffect(() => { const t = setTimeout(() => { void istek<NonNullable<typeof v>>(`/islem-katalogu?q=${encodeURIComponent(q)}`).then(setV).catch(() => setV(null)); }, 250); return () => clearTimeout(t); }, [q]);
  if (!v) return null;
  return <details><summary>Branş ve İşlem Kataloğu · {v.ozet.map((x) => `${x.duzey} ${x.n}`).join(' · ')}</summary>
    {v.kartelaBaglanmayan.length > 0 && <div className="soru hata"><span>Kataloğa bağlanamayan kartela kalemleri: {v.kartelaBaglanmayan.join(', ')}</span></div>}
    <label htmlFor="ik-q">Kod veya işlem ara</label><input id="ik-q" value={q} onChange={(e) => setQ(e.target.value)} />
    {v.sonuc.map((x) => <div className={x.durum === 'Yürürlükte' ? 'soru' : 'soru bos'} key={x.kod}><span><b>{x.kod}</b> · {x.duzey} · {x.ad}{x.durum !== 'Yürürlükte' ? ` · ${x.durum}` : ''}</span></div>)}
    <label htmlFor="ik-k">Kartela kaleminin kapsadığı işlemler</label><input id="ik-k" placeholder="ör. TAHRIK-01.03.02-01" value={k} onChange={(e) => setK(e.target.value)} />
    <button className="btn2 kucuk" onClick={() => { setH(''); void istek<NonNullable<typeof ki>>(`/kartela/${encodeURIComponent(k.trim())}/islemler`).then(setKi).catch((e) => { setKi(null); setH(e.message); }); }}>Göster</button>
    {h && <div className="hata" role="alert">{h}</div>}
    {ki && <><div className="not">{ki.tali.ana_ad} › {ki.tali.alt_ad} › {ki.tali.ad} ({ki.tali.kod})</div>{ki.islemler.map((x) => <div className="soru" key={x.kod}><span><b>{x.kod}</b> · {x.ad}</span></div>)}</>}</details>;
}
