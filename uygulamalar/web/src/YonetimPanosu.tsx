import { useEffect, useState } from 'react';
import { istek } from './api';

type V = { kapsam: string | string[]; gostergeler: { kod: string; ad: string; deger: number; birim: string; birimAdi: string; uyari: boolean }[] };
/** YG-758, YG-759: yönetim panosu; kapsam role göre. */
export function YonetimPanosu() {
  const [v, setV] = useState<V | null>(null);
  useEffect(() => { void istek<V>('/yonetim-panosu').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const d = (x: V['gostergeler'][number]) => (x.birim === 'EUR' ? `${x.deger.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR` : x.deger.toLocaleString('tr-TR'));
  return <details open><summary>Yönetim Panosu · {Array.isArray(v.kapsam) ? v.kapsam.join(', ') : 'Tüm Birimler'}</summary>
    <div className="ozet">{v.gostergeler.map((x) => <div key={x.kod} className={x.uyari ? 'hata' : undefined}>{x.ad}: <b>{d(x)}</b> · {x.birimAdi}</div>)}</div></details>;
}
