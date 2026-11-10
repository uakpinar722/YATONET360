import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-1557: sigorta şirketi alanına tam unvanlı açılır liste (31 şirket); listede olmayan ad elle yazılabilir. */
export function SigortaListesi() {
  const [l, setL] = useState<{ tsb_kodu: string; tam_unvan: string; durum: string }[]>([]);
  useEffect(() => { void istek<typeof l>('/sigorta-sirketleri').then(setL).catch(() => setL([])); }, []);
  return <datalist id="sigorta-listesi">{l.filter((x) => x.durum === 'Aktif').map((x) => <option key={x.tsb_kodu} value={x.tam_unvan} />)}</datalist>;
}
