import { useEffect, useState } from 'react';
import { istek } from './api';

export type Ekipman = { kimlik: string; ekipman_no: string; sistem: string; ad: string; marka: string | null; model: string | null; seri_no: string | null; konum: string | null; bulgu: number; parca: number };

/** YG-001: yat ekipmanları tekil numarayla (EK-nnn) kaydedilir; bulgu ve sökülen parça ekipmana bağlanır. */
export function YatEkipmani({ dosya, degisti }: { dosya: string; degisti?: (l: Ekipman[]) => void }) {
  const [l, setL] = useState<Ekipman[]>([]); const [m, setM] = useState('');
  const [f, setF] = useState({ sistem: '', ad: '', marka: '', model: '', seriNo: '', konum: '' });
  const yk = () => istek<Ekipman[]>(`/dosya/${dosya}/ekipman`).then((x) => { setL(x); degisti?.(x); }).catch(() => setL([]));
  useEffect(() => { void yk(); }, [dosya]); // eslint-disable-line react-hooks/exhaustive-deps
  const al = (k: keyof typeof f, et: string) => <><label htmlFor={`ye-${k}`}>{et}</label><input id={`ye-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <details><summary>Yat Ekipmanları ({l.length})</summary>{m && <div className="not" role="status">{m}</div>}
    {l.length > 0 && <table><thead><tr><th>No</th><th>Ekipman</th><th>Sistem</th><th>Seri No</th><th>Bulgu · Parça</th></tr></thead><tbody>
      {l.map((x) => <tr key={x.kimlik}><td>{x.ekipman_no}</td><td>{x.ad}{x.marka ? ` · ${x.marka}` : ''}{x.model ? ` ${x.model}` : ''}</td><td>{x.sistem}</td><td>{x.seri_no ?? '—'}</td><td>{x.bulgu} · {x.parca}</td></tr>)}
    </tbody></table>}
    {al('ad', 'Ekipman Adı')}{al('sistem', 'Bağlı Olduğu Sistem')}{al('marka', 'Marka')}{al('model', 'Model')}{al('seriNo', 'Seri No')}{al('konum', 'Konum')}
    <button className="btn2 kucuk" disabled={!f.ad.trim() || !f.sistem.trim()} onClick={() => void istek<{ ekipmanNo: string }>(`/dosya/${dosya}/ekipman`, f).then((r) => { setM(`Ekipman kaydedildi: ${r.ekipmanNo}`); setF({ sistem: '', ad: '', marka: '', model: '', seriNo: '', konum: '' }); return yk(); }).catch((e) => setM(e.message))}>Ekipmanı Kaydet</button>
  </details>;
}
