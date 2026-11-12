import { useEffect, useState } from 'react';
import { istek } from './api';

type F = { kod: string; ad: string; var: boolean; istisna?: string };
/** YG-635, YG-636: dosyanın zorunlu ve koşula bağlı formları; kullanılmayan form için gerekçeli istisna ve eşdeğer kontrol (Ek II). */
export function ZorunluFormlar({ dosya }: { dosya: string }) {
  const [l, setL] = useState<F[]>([]); const [g, setG] = useState<Record<string, { gerekce: string; esdeger: string }>>({}); const [m, setM] = useState('');
  const yk = () => void istek<F[]>(`/dosya/${dosya}/zorunlu-formlar`).then(setL).catch(() => setL([]));
  useEffect(yk, [dosya]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!l.length) return null;
  const eksik = l.filter((x) => !x.var).length;
  return <details><summary>Zorunlu Formlar · {eksik ? `${eksik} eksik` : 'tamam'}</summary>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => { const v = g[x.kod] ?? { gerekce: '', esdeger: '' }; return <div className={x.var ? 'soru' : 'soru hata'} key={x.kod}><span>{x.kod} · {x.ad} · {x.istisna ? `İstisna: ${x.istisna}` : x.var ? 'Var' : 'Eksik'}</span>
      {!x.var && <div className="tam"><label htmlFor={`zf-g-${x.kod}`}>İstisna Gerekçesi</label><input id={`zf-g-${x.kod}`} value={v.gerekce} onChange={(e) => setG({ ...g, [x.kod]: { ...v, gerekce: e.target.value } })} />
        <label htmlFor={`zf-e-${x.kod}`}>Eşdeğer Kontrol</label><input id={`zf-e-${x.kod}`} value={v.esdeger} onChange={(e) => setG({ ...g, [x.kod]: { ...v, esdeger: e.target.value } })} />
        <button className="btn2 kucuk" onClick={() => void istek(`/dosya/${dosya}/zorunlu-form-istisnasi`, { kod: x.kod, gerekce: v.gerekce, esdegerKontrol: v.esdeger }).then(() => { setM('İstisna kaydedildi.'); yk(); }).catch((e) => setM(e.message))}>İstisna Kaydet</button></div>}</div>; })}</details>;
}
