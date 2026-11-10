import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kod: string; islem: string; birim: string; iscilik_normu_saat: string | null; fire_orani: string | null };
/** YG-860: işçilik normu ve fire oranı yalnız kartela verisindedir; belgelere yazılmaz. */
export function KartelaNorm() {
  const [q, setQ] = useState(''); const [v, setV] = useState<{ surum: string; taslak: boolean; kalemler: K[] } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>(`/kartela/norm?q=${encodeURIComponent(q)}`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [q]);
  if (!v) return null;
  const sayi = (x: string | undefined) => (x ? Number(x.replace(',', '.')) : null);
  return <details><summary>Kartela İşçilik Normu ve Fire Oranı · {v.surum}{v.taslak ? ' (Taslak)' : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="kn-q">Ara</label><input id="kn-q" value={q} onChange={(e) => setQ(e.target.value)} />
    {v.kalemler.map((x) => <div className="soru" key={x.kod}><span>{x.kod} · {x.islem} · {x.birim} · Norm: {x.iscilik_normu_saat ?? '—'} saat · Fire: {x.fire_orani ? `%${x.fire_orani}` : '—'}</span>
      {v.taslak && <div className="tam"><input aria-label="İşçilik Normu (saat)" placeholder="Saat" value={g[`n${x.kod}`] ?? ''} onChange={(e) => setG({ ...g, [`n${x.kod}`]: e.target.value })} /><input aria-label="Fire Oranı (%)" placeholder="%" value={g[`f${x.kod}`] ?? ''} onChange={(e) => setG({ ...g, [`f${x.kod}`]: e.target.value })} /><input aria-label="Kaynak" placeholder="Kaynak" value={g[`k${x.kod}`] ?? ''} onChange={(e) => setG({ ...g, [`k${x.kod}`]: e.target.value })} /><button className="btn2 kucuk" onClick={() => void istek('/kartela/taslak/norm', { kod: x.kod, norm: sayi(g[`n${x.kod}`]), fire: sayi(g[`f${x.kod}`]), kaynak: g[`k${x.kod}`] }).then(() => { setM('Kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></div>}</div>)}</details>;
}
