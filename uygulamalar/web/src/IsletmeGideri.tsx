import { useEffect, useState } from 'react';
import { istek } from './api';

const e = (x: number | null) => (x ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** YG-930: YATONET 360 aylık işletme giderleri ve tavan. */
export function IsletmeGideri() {
  const [v, setV] = useState<{ tavan: number; giren: boolean; aylar: { ay: string; toplam: number | null; onayda: number | null }[]; kalemler: { kimlik: string; ay: string; kalem: string; saglayici: string; tutar_eur: number; gerekce: string | null; durum: string }[] } | null>(null);
  const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/yatonet-giderleri').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const al = (k: string, et: string, tip = 'text') => <span key={k}><label htmlFor={`ig-${k}`}>{et}</label><input id={`ig-${k}`} type={tip} value={g[k] ?? ''} onChange={(x) => setG({ ...g, [k]: x.target.value })} /></span>;
  return <details><summary>YATONET 360 İşletme Giderleri · Tavan {e(v.tavan)} EUR</summary>{m && <div className="not" role="status">{m}</div>}
    {v.aylar.map((a) => <div className={(a.toplam ?? 0) > v.tavan ? 'soru hata' : 'soru'} key={a.ay}><span>{a.ay} · {e(a.toplam)} EUR{a.onayda ? ` · Onayda ${e(a.onayda)} EUR` : ''}</span></div>)}
    {v.kalemler.map((k) => <div className="soru" key={k.kimlik}><span>{k.ay} · {k.kalem} · {k.saglayici} · {e(k.tutar_eur)} EUR · {k.durum}{k.gerekce ? ` · ${k.gerekce}` : ''}</span></div>)}
    {v.giren && <div className="tam">{al('ay', 'Ay', 'month')}{al('kalem', 'Kalem')}{al('saglayici', 'Sağlayıcı')}{al('tutar', 'Tutar (EUR)')}{al('gerekce', 'Gerekçe (tavan aşılırsa)')}
      <button className="btn2 kucuk" onClick={() => void istek<{ durum: string }>('/yatonet-gideri', { ay: g.ay, kalem: g.kalem, saglayici: g.saglayici, tutar: Number((g.tutar ?? '').replace(/\./g, '').replace(',', '.')), gerekce: g.gerekce }).then((r) => { setM(r.durum === 'Onayda' ? 'Tavan aşıldı; gider CEO onayına gönderildi.' : 'Gider kaydedildi.'); setG({}); return yk(); }).catch((x) => setM(x.message))}>Kaydet</button></div>}</details>;
}
