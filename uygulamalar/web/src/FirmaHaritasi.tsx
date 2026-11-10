import { useEffect, useState } from 'react';
import { istek } from './api';

type F = { kimlik: string; ad: string | null; il: string | null; enlem: number; boylam: number; renk: string; etiket: string; yakin: { ad: string; tur: string; km: number }[] };
type N = { ad: string; tur: string; enlem: number; boylam: number };
const SEKIL: Record<string, string> = {};
const sekil = (tur: string) => (SEKIL[tur] ??= ['kare', 'ucgen', 'elmas', 'arti'][Object.keys(SEKIL).length % 4]!);
// Türkiye kıyıları için sabit çerçeve (boylam 25–45, enlem 35–43); dış harita servisi kullanılmaz.
const X = (b: number) => ((b - 25) / 20) * 800; const Y = (e: number) => ((43 - e) / 8) * 320;
/** YG-364–366: firma haritası; statü rengi, bağlama noktası türü, en yakın noktalar; ad yalnız yetkili rollere. */
export function FirmaHaritasi() {
  const [v, setV] = useState<{ adGorur: boolean; firmalar: F[]; noktalar: N[] } | null>(null); const [s, setS] = useState<F | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/firma-haritasi').then(setV).catch(() => setV(null)); }, []);
  if (!v || (!v.firmalar.length && !v.noktalar.length)) return null;
  const etiketler = [...new Map(v.firmalar.map((f) => [f.etiket, f.renk])).entries()];
  const isaret = (n: N, k: number) => { const x = X(n.boylam), y = Y(n.enlem); const t = sekil(n.tur); return t === 'kare' ? <rect key={k} x={x - 3} y={y - 3} width={6} height={6} fill="none" stroke="#1d3557"><title>{`${n.ad} · ${n.tur}`}</title></rect> : t === 'ucgen' ? <polygon key={k} points={`${x},${y - 4} ${x - 4},${y + 3} ${x + 4},${y + 3}`} fill="none" stroke="#1d3557"><title>{`${n.ad} · ${n.tur}`}</title></polygon> : t === 'elmas' ? <polygon key={k} points={`${x},${y - 4} ${x + 4},${y} ${x},${y + 4} ${x - 4},${y}`} fill="none" stroke="#1d3557"><title>{`${n.ad} · ${n.tur}`}</title></polygon> : <path key={k} d={`M${x - 4} ${y}H${x + 4}M${x} ${y - 4}V${y + 4}`} stroke="#1d3557"><title>{`${n.ad} · ${n.tur}`}</title></path>; };
  return <details><summary>Firma Haritası</summary>
    <svg viewBox="0 0 800 320" style={{ width: '100%', background: 'var(--zemin2, #eef3f8)', borderRadius: 8 }} role="img" aria-label="Firma haritası">
      {v.noktalar.map(isaret)}
      {v.firmalar.map((f) => <circle key={f.kimlik} cx={X(f.boylam)} cy={Y(f.enlem)} r={6} fill={f.renk} stroke="#fff" onClick={() => setS(f)} style={{ cursor: 'pointer' }}><title>{`${f.ad ?? f.etiket}${f.il ? ` · ${f.il}` : ''}`}</title></circle>)}
    </svg>
    <div className="not">{etiketler.map(([e, r]) => <span key={e} style={{ marginRight: 12 }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: r, marginRight: 4 }} />{e}</span>)} · Bağlama noktası türleri: {Object.keys(SEKIL).join(', ')}</div>
    {s && <div className="ozet"><b>{s.ad ?? s.etiket}</b>{s.il ? ` · ${s.il}` : ''}{s.yakin.map((n) => <div key={n.ad}>{n.ad} · {n.tur} · {n.km.toLocaleString('tr-TR')} km</div>)}</div>}</details>;
}
