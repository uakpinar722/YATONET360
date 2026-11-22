import { useMemo } from 'react';
import { tarihSaat } from './bicim';

/** YG-734: rapor altbilgisi; ölçüm dönemi, seçili süzgeç ve güncellenme zamanı. Zaman verilmezse verinin alındığı an yazılır. */
export function RaporAltbilgisi({ donem, suzgec, veri, zaman }: { donem: string; suzgec: string; veri?: unknown; zaman?: string }) {
  const alindi = useMemo(() => new Date(), [veri]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="not">Ölçüm Dönemi: {donem} · Süzgeç: {suzgec} · Güncellenme: {tarihSaat(zaman ?? alindi)}</div>;
}
