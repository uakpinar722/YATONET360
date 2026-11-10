import { useEffect, useState } from 'react';
import { istek } from './api';

type O = { fiziksel: number | null; hakedis: number | null; faturalama: number | null };
type V = { ozet: O; raporlar: (O & { tarih: string; degerlendirme: string; ad_soyad: string })[] };
const y = (x: number | null) => (x === null ? '—' : `%${String(x).replace('.', ',')}`);
/** YG-787: iç ilerleme raporu; fiziksel ve finansal ilerleme ayrı. Firma kimliği yer almaz. */
export function IcIlerleme({ dosya }: { dosya: string }) {
  const [v, setV] = useState<V | null>(null); const [g, setG] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<V>(`/dosya/${dosya}/ic-ilerleme`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!v) return null;
  return <details><summary>İç İlerleme Raporu · Fiziksel {y(v.ozet.fiziksel)} · Hakediş {y(v.ozet.hakedis)} · Faturalama {y(v.ozet.faturalama)}</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="ii-d">Değerlendirme</label><textarea id="ii-d" rows={2} value={g} onChange={(e) => setG(e.target.value)} />
    <button className="btn2 kucuk" disabled={!g.trim()} onClick={() => void istek(`/dosya/${dosya}/ic-ilerleme`, { degerlendirme: g }).then(() => { setM('Rapor kaydedildi.'); setG(''); return yk(); }).catch((e) => setM(e.message))}>Raporu Kaydet</button>
    {v.raporlar.map((r) => <div className="soru" key={r.tarih}><span>{r.tarih.split('-').reverse().join('.')} · Fiziksel {y(r.fiziksel)} · Hakediş {y(r.hakedis)} · Faturalama {y(r.faturalama)} · {r.degerlendirme} · {r.ad_soyad}</span></div>)}</details>;
}
