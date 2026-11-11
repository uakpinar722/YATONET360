import { useEffect, useState } from 'react';
import { istek } from './api';

type V = { katalog: { kod: string; grup: string; metin: string }[]; turler: string[]; secili: { madde: string; tur: string }[] };
/** YG-709: 013 ön koşulları ve mühendislik durdurma noktaları teklifte Hariç / Ayrıca Fiyatlandırılır maddesi olarak. */
export function TeklifMadde({ teklif }: { teklif: string }) {
  const [v, setV] = useState<V | null>(null); const [m, setM] = useState('');
  const yk = () => void istek<V>(`/teklif/${teklif}/madde`).then(setV).catch(() => setV(null));
  useEffect(yk, [teklif]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return null;
  const sec = (madde: string, tur: string) => void istek(`/teklif/${teklif}/madde`, tur ? { madde, tur } : { madde, kaldir: true }).then(() => { setM(''); yk(); }).catch((e) => setM(e.message));
  return <details><summary>Hariç ve Ayrıca Fiyatlandırılacak Hususlar · {v.secili.length} seçili</summary>{m && <div className="hata" role="alert">{m}</div>}
    {v.katalog.map((k) => { const s = v.secili.find((x) => x.madde === k.kod); return <div className="soru" key={k.kod}><span>{k.grup} · {k.metin}</span>
      <label htmlFor={`tm-${teklif}-${k.kod}`}>Teklifte</label><select id={`tm-${teklif}-${k.kod}`} value={s?.tur ?? ''} onChange={(e) => sec(k.kod, e.target.value)}><option value="">Yer almaz</option>{v.turler.map((t) => <option key={t}>{t}</option>)}</select></div>; })}</details>;
}
