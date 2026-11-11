import { useState } from 'react';
import { istek } from './api';

/** YG-1453: Dosya Sorumlusu yatın karaya alındığını işaretler; çekilemeyen açılar sahaya hatırlatılır. */
export function YatKarada({ dosya }: { dosya: string }) {
  const [m, setM] = useState('');
  return <div className="tam"><button className="btn2 kucuk" onClick={() => void istek<{ hatirlatma: number; cekilemeyen: number }>(`/dosya/${dosya}/yat-karada`, {}).then((r) => setM(r.cekilemeyen ? `Yat karada işaretlendi; ${r.cekilemeyen} çekilemeyen açı sahaya hatırlatıldı.` : 'Yat karada işaretlendi; çekilemeyen açı yok.')).catch((e) => setM(e.message))}>Yat Karada</button>{m && <span className="not" role="status"> {m}</span>}</div>;
}
