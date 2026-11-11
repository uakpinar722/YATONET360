import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-1372: kartela işlem araması; eş anlamlılar tanınır, kullanıcının sık seçtiği işlemler önde gelir. */
export function KartelaArama({ id, deger, sec }: { id: string; deger: string; sec: (kod: string) => void }) {
  const [l, setL] = useState<{ kod: string; islem: string; birim: string; sik: number }[]>([]);
  useEffect(() => { const q = deger.trim(); if (q.length < 2) { setL([]); return; } const t = setTimeout(() => { void istek<typeof l>(`/kartela/ara?q=${encodeURIComponent(q)}`).then(setL).catch(() => setL([])); }, 250); return () => clearTimeout(t); }, [deger]);
  return <><input id={id} list={`${id}-l`} value={deger} onChange={(e) => sec(e.target.value)} autoComplete="off" />
    <datalist id={`${id}-l`}>{l.map((x) => <option key={x.kod} value={x.kod}>{`${x.islem} (${x.birim})${x.sik ? ' · sık kullanılan' : ''}`}</option>)}</datalist></>;
}
