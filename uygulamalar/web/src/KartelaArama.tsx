import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-1372: kartela işlem araması; eş anlamlılar tanınır, kullanıcının sık seçtiği işlemler önde gelir.
 *  YG-1371: ana/alt branş kutuları isteğe bağlıdır; işlem doğrudan seçilince üst branşlar kendiliğinden dolar. */
type Brans = { ana_brans: string; alt_brans: string };
let BRANS: Promise<Brans[]> | null = null;
export function KartelaArama({ id, deger, sec }: { id: string; deger: string; sec: (kod: string) => void }) {
  const [l, setL] = useState<{ kod: string; ana_brans: string; alt_brans: string; tali_brans: string; islem: string; birim: string; sik: number }[]>([]);
  const [br, setBr] = useState<Brans[]>([]); const [ana, setAna] = useState(''); const [alt, setAlt] = useState('');
  useEffect(() => { void (BRANS ??= istek<Brans[]>('/kartela/branslar').catch(() => [])).then(setBr); }, []);
  useEffect(() => { const q = deger.trim(); if (q.length < 2) { setL([]); return; } const t = setTimeout(() => { void istek<typeof l>(`/kartela/ara?q=${encodeURIComponent(q)}${ana ? `&ana=${encodeURIComponent(ana)}` : ''}${alt ? `&alt=${encodeURIComponent(alt)}` : ''}`).then(setL).catch(() => setL([])); }, 250); return () => clearTimeout(t); }, [deger, ana, alt]);
  const secili = l.find((x) => x.kod === deger.trim()); const a = secili?.ana_brans ?? ana;
  return <><select aria-label="Ana Branş (isteğe bağlı)" value={a} onChange={(e) => { setAna(e.target.value); setAlt(''); }}><option value="">Ana Branş (tümü)</option>{[...new Set(br.map((x) => x.ana_brans))].map((x) => <option key={x}>{x}</option>)}</select>
    <select aria-label="Alt Branş (isteğe bağlı)" value={secili?.alt_brans ?? alt} onChange={(e) => setAlt(e.target.value)}><option value="">Alt Branş (tümü)</option>{br.filter((x) => !a || x.ana_brans === a).map((x) => <option key={`${x.ana_brans}-${x.alt_brans}`} value={x.alt_brans}>{x.alt_brans}</option>)}</select>
    <input id={id} list={`${id}-l`} value={deger} onChange={(e) => sec(e.target.value)} autoComplete="off" />
    <datalist id={`${id}-l`}>{l.map((x) => <option key={x.kod} value={x.kod}>{`${x.islem} (${x.birim})${x.sik ? ' · sık kullanılan' : ''}`}</option>)}</datalist>
    {secili && <div className="not">{secili.ana_brans} › {secili.alt_brans} › {secili.tali_brans} · {secili.islem}</div>}</>;
}
