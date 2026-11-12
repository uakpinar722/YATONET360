import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { sira: number; belge: string; islev: string; kayitlar: string[] };
type V = { kural: string; musteri: K[]; firma: K[]; celiski: string };
/** YG-617: sözleşme türüne göre belge öncelik sırası; çelişkide Hukuk ve Uyum incelemesi. */
export function BelgeOnceligi({ dosya }: { dosya: string }) {
  const [v, setV] = useState<V | null>(null); const [g, setG] = useState({ belgeler: '', konu: '' }); const [m, setM] = useState('');
  useEffect(() => { void istek<V>(`/dosya/${dosya}/belge-onceligi`).then(setV).catch(() => setV(null)); }, [dosya]);
  if (!v) return null;
  const liste = (b: string, l: K[]) => <><div className="bolum">{b}</div>{l.map((x) => <div className="soru" key={x.sira}><span>{x.sira}. {x.belge} · {x.islev}{x.kayitlar.length ? ` · ${x.kayitlar.join(', ')}` : ''}</span></div>)}</>;
  return <details><summary>Belge Önceliği · {v.kural}</summary>{m && <div className="not" role="status">{m}</div>}
    {liste('Müşteri tarafı', v.musteri)}{liste('Çözüm Ortağı tarafı', v.firma)}
    <div className="not">{v.celiski}</div>
    <label htmlFor="bo-b">Çelişen Belgeler</label><input id="bo-b" value={g.belgeler} onChange={(e) => setG({ ...g, belgeler: e.target.value })} />
    <label htmlFor="bo-k">Konu</label><textarea id="bo-k" value={g.konu} onChange={(e) => setG({ ...g, konu: e.target.value })} />
    <button className="btn2 kucuk" onClick={() => void istek(`/dosya/${dosya}/belge-celiskisi`, g).then(() => { setM('Hukuk ve Uyum Direktörüne inceleme görevi açıldı.'); setG({ belgeler: '', konu: '' }); }).catch((e) => setM(e.message))}>Çelişki Bildir</button></details>;
}
