import { useEffect, useState } from 'react';
import { istek } from './api';
import { eslesmeSirasi } from './SigortaListesi';

export const DIGER_YER = 'Diğer (Listede Yok)';
/** YG-1558: yer listesi ana veriden; yazdıkça süzülür (baştan, kelime başı, içeren); "Diğer (Listede Yok)" her zaman en altta. */
export function YerListesi({ ara = '' }: { ara?: string }) {
  const [l, setL] = useState<string[]>([]);
  useEffect(() => { void istek<string[]>('/yer-listesi').then(setL).catch(() => setL([])); }, []);
  const s = l.filter((x) => eslesmeSirasi(x, ara) < 3).sort((x, z) => eslesmeSirasi(x, ara) - eslesmeSirasi(z, ara) || x.localeCompare(z, 'tr')).slice(0, 50);
  return <datalist id="yer-listesi">{s.map((x) => <option key={x} value={x} />)}<option value={DIGER_YER} /></datalist>;
}
