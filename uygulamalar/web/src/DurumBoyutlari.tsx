import { useEffect, useState } from 'react';
import { istek } from './api';

type B = { boyut: string; durum: string; ayrinti: string; kural: string; engelleyenler: string[] };
/** YG-005: teknik ilerleme, müşteri onayı, satın alma, kalite, ödeme ve kapanış ayrı boyutlar; engelleyen boyut gösterilir. */
export function DurumBoyutlari({ dosya }: { dosya: string }) {
  const [l, setL] = useState<B[] | null>(null);
  useEffect(() => { void istek<B[]>(`/dosya/${dosya}/durum-boyutlari`).then(setL).catch(() => setL(null)); }, [dosya]);
  if (!l) return null;
  return <details><summary>Durum Boyutları</summary><div className="tablo"><table className="kartli"><thead><tr><th>Boyut</th><th>Durum</th><th>Ayrıntı</th><th>Engelleyen</th></tr></thead>
    <tbody>{l.map((x) => <tr key={x.boyut}><td data-ad="Boyut">{x.boyut}</td><td data-ad="Durum">{x.durum}</td><td data-ad="Ayrıntı">{x.ayrinti}</td><td data-ad="Engelleyen" title={x.kural}>{x.engelleyenler.length ? x.engelleyenler.join(', ') : '—'}</td></tr>)}</tbody></table></div></details>;
}
