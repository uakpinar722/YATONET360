import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kimlik: string; bulgu_no: string; bilgi: string; karar: string | null };
/** YG-545: kritik bulgu kararı saha raporu beklenmeden kaydedilir. */
export function KritikBulgular({ dosya }: { dosya: string }) {
  const [l, setL] = useState<K[]>([]); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<K[]>(`/dosya/${dosya}/kritik-bulgular`).then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, [dosya]);
  if (!l.length) return null;
  return <><div className="bolum">Kritik Bulgular</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div className={x.karar ? 'soru' : 'soru hata'} key={x.kimlik}><span>{x.bilgi}{x.karar ? ` · Karar: ${x.karar}` : ''}</span>{!x.karar && <div className="tam"><label htmlFor={`kb-${x.kimlik}`}>Karar</label><input id={`kb-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} /><button className="btn2 kucuk" disabled={!g[x.kimlik]?.trim()} onClick={() => void istek(`/bulgu/${x.kimlik}/kritik-karar`, { karar: g[x.kimlik] }).then(() => { setM('Karar kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kararı Kaydet</button></div>}</div>)}</>;
}
