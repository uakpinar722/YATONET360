import { useEffect, useState } from 'react';
import { istek } from './api';

type T = { kimlik: string; talep_no: string; konu: string; durum: string; tedarikci: string | null; siparis_tutar_eur: string | null };

/** YG-1619: idari talep; ihtiyaç onayı silsileyle, parasal onay sipariş aşamasında. */
export function IdariTalep() {
  const [v, setV] = useState<{ sorumlu: boolean; talepler: T[] } | null>(null); const [f, setF] = useState({ konu: '', gerekce: '' }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/idari-talep').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">İdari Talepler</div>{m && <div className="not" role="status">{m}</div>}
    {v.talepler.map((x) => { return <div className="soru" key={x.kimlik}><span>{x.talep_no} · {x.konu} · {x.durum}</span>
      </div>; })}
    <label htmlFor="it-k">Talep Konusu</label><input id="it-k" value={f.konu} onChange={(e) => setF({ ...f, konu: e.target.value })} />
    <label htmlFor="it-g">Gerekçe</label><input id="it-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.konu.trim() || !f.gerekce.trim()} onClick={() => is(istek('/idari-talep', f).then(() => setF({ konu: '', gerekce: '' })), 'Talep açıldı.')}>Talep Aç</button></>;
}
