import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kimlik: string; grup: string; no: string; ad: string; il: string | null };
type V = { firmalar: K[]; noktalar: K[] };

/** ANV-1: aktarılan ana verideki olası mükerrer kayıtlar için Sicil kararı. */
export function AnaVeriMukerrer() {
  const [v, setV] = useState<V | null>(null); const [ana, setAna] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>('/ana-veri/mukerrer').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v || (!v.firmalar.length && !v.noktalar.length)) return null;
  const karar = (tur: string, x: K, k: string) => void istek('/ana-veri/mukerrer', { tur, kimlik: x.kimlik, karar: k, ana: k === 'Birleştirildi' ? ana[x.kimlik] : undefined }).then(() => { setM('Karar kaydedildi.'); return yk(); }).catch((e) => setM(e.message));
  const liste = (tur: string, l: K[]) => l.map((x) => <div className="soru" key={x.kimlik}><span>Grup {x.grup} · {x.no} · {x.ad}{x.il ? ` · ${x.il}` : ''}</span>
    <label htmlFor={`am-${x.kimlik}`}>Ana Kayıt</label><select id={`am-${x.kimlik}`} value={ana[x.kimlik] ?? ''} onChange={(e) => setAna({ ...ana, [x.kimlik]: e.target.value })}><option value="">Seçiniz</option>{l.filter((y) => y.grup === x.grup && y.kimlik !== x.kimlik).map((y) => <option key={y.kimlik} value={y.kimlik}>{y.ad}</option>)}</select>
    <button className="btn2 kucuk" onClick={() => karar(tur, x, 'Ayrı Kayıt')}>Ayrı Kayıt</button><button className="btn2 kucuk" disabled={!ana[x.kimlik]} onClick={() => karar(tur, x, 'Birleştirildi')}>Birleştir</button></div>);
  return <><div className="bolum">Ana Veri Mükerrer Kararları</div>{m && <div className="not" role="status">{m}</div>}{liste('firma', v.firmalar)}{liste('nokta', v.noktalar)}</>;
}
