import { useEffect, useState } from 'react';

/** YG-491 (RHB-01): onaylı TR/EN kurulum rehberi. */
export function KurulumRehberi({ dil, kapat }: { dil: 'tr' | 'en'; kapat: () => void }) {
  const [v, setV] = useState<{ baslik: string; adimlar: string[]; web: string; guvenlik: string } | null>(null);
  useEffect(() => { void fetch(`/api/kurulum-rehberi?dil=${dil}`).then((r) => r.json()).then(setV).catch(() => setV(null)); }, [dil]);
  if (!v) return null;
  return <div className="ozet" data-t="kurulum-rehberi"><h2>{v.baslik}</h2><ol>{v.adimlar.map((a) => <li key={a}>{a}</li>)}</ol><div className="not">{v.web}</div><div className="not"><b>{v.guvenlik}</b></div>
    <button type="button" className="lnk" onClick={kapat}>{dil === 'tr' ? 'Kapat' : 'Close'}</button></div>;
}
