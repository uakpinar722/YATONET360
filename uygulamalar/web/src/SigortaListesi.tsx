import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-1557: sigorta şirketi alanına tam unvanlı açılır liste (31 şirket); listede olmayan ad elle yazılabilir. */
/** YG-1558: baştan eşleşen, sonra kelime başı eşleşen, sonra içeren. */
export function eslesmeSirasi(ad: string, ara: string): number {
  const a = ad.toLocaleLowerCase('tr'), q = ara.trim().toLocaleLowerCase('tr');
  if (!q) return 0; if (a.startsWith(q)) return 0; if (a.split(/[\s\-(]+/).some((k) => k.startsWith(q))) return 1; return a.includes(q) ? 2 : 3;
}
export function SigortaListesi({ ara = '' }: { ara?: string }) {
  const [l, setL] = useState<{ tsb_kodu: string; tam_unvan: string; durum: string }[]>([]);
  useEffect(() => { void istek<typeof l>('/sigorta-sirketleri').then(setL).catch(() => setL([])); }, []);
  return <datalist id="sigorta-listesi">{l.filter((x) => x.durum === 'Aktif' && eslesmeSirasi(x.tam_unvan, ara) < 3).sort((x, z) => eslesmeSirasi(x.tam_unvan, ara) - eslesmeSirasi(z.tam_unvan, ara) || x.tam_unvan.localeCompare(z.tam_unvan, 'tr')).map((x) => <option key={x.tsb_kodu} value={x.tam_unvan} />)}</datalist>;
}
