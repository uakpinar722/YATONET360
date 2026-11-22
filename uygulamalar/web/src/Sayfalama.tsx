import { useEffect, useState, type ReactNode } from 'react';

/** PRM-2 (liste_azami): liste ve filtre ekranlarında sayfa başına kayıt. */
export const SAYFA_BOYUTU = 50;
/** YG-1367: liste sayfalanır; liste uzunluğu değişince ilk sayfaya dönülür. */
export function useSayfa<T>(l: T[], boyut = SAYFA_BOYUTU): { parca: T[]; gezgin: ReactNode } {
  const [s, setS] = useState(0);
  useEffect(() => setS(0), [l.length]);
  const n = Math.max(1, Math.ceil(l.length / boyut)); const g = Math.min(s, n - 1);
  const gezgin = n > 1 ? <div className="dugmeler"><button className="btn2 kucuk" disabled={g === 0} onClick={() => setS(g - 1)}>Önceki</button><span>Sayfa {g + 1} / {n} · {l.length} kayıt</span><button className="btn2 kucuk" disabled={g >= n - 1} onClick={() => setS(g + 1)}>Sonraki</button></div> : null;
  return { parca: l.slice(g * boyut, (g + 1) * boyut), gezgin };
}
