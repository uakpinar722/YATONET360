import { useEffect, useState } from 'react';
import { istek } from './api';

type C = { kod: string; ad: string; tablo: string; deger: number | null; birim: string; birimAdi: string; hedef: number | null; renk: 'yesil' | 'sari' | 'kirmizi' | null; durum: string };
type V = { kapsam: string | string[]; hedefGirer: boolean; gostergeler: { kod: string; ad: string; deger: number; birim: string; birimAdi: string; uyari: boolean }[]; cilt1: C[] };
const RENK = { yesil: '#2e8540', sari: '#c79a00', kirmizi: '#c62828' };
const d = (v: number | null, b: string) => (v === null ? '—' : b === 'EUR' ? `${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR` : b === '%' ? `%${v.toLocaleString('tr-TR')}` : `${v.toLocaleString('tr-TR')} ${b}`);
/** YG-758, YG-759: yönetim panosu; Cilt I §9 göstergeleri trafik ışığıyla, hedef ve eşik CEO/GMY girişiyle (§9.12). */
export function YonetimPanosu() {
  const [v, setV] = useState<V | null>(null); const [h, setH] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>('/yonetim-panosu').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const sayi = (x?: string) => (x ? Number(x.replace(',', '.')) : null);
  return <details open><summary>Yönetim Panosu · {Array.isArray(v.kapsam) ? v.kapsam.join(', ') : 'Tüm Birimler'}</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{v.gostergeler.map((x) => <div key={x.kod} className={x.uyari ? 'hata' : undefined}>{x.ad}: <b>{d(x.deger, x.birim === 'adet' ? 'adet' : x.birim)}</b> · {x.birimAdi}</div>)}</div>
    <div className="bolum">Cilt I §9 Performans Göstergeleri</div>
    {v.cilt1.map((x) => <div className="soru" key={x.kod}><span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, marginRight: 6, background: x.renk ? RENK[x.renk] : '#b8c2cc' }} />{x.tablo} · {x.ad}: <b>{d(x.deger, x.birim)}</b>{x.hedef !== null ? ` · Hedef ${d(x.hedef, x.birim)}` : ''} · {x.durum} · {x.birimAdi}</span>
      {v.hedefGirer && <div className="tam"><input aria-label={`${x.ad} hedef`} placeholder="Hedef" value={h[`h${x.kod}`] ?? ''} onChange={(e) => setH({ ...h, [`h${x.kod}`]: e.target.value })} /><input aria-label={`${x.ad} uyarı eşiği`} placeholder="Uyarı" value={h[`u${x.kod}`] ?? ''} onChange={(e) => setH({ ...h, [`u${x.kod}`]: e.target.value })} /><input aria-label={`${x.ad} kritik eşik`} placeholder="Kritik" value={h[`k${x.kod}`] ?? ''} onChange={(e) => setH({ ...h, [`k${x.kod}`]: e.target.value })} /><input aria-label={`${x.ad} gerekçe`} placeholder="Gerekçe" value={h[`g${x.kod}`] ?? ''} onChange={(e) => setH({ ...h, [`g${x.kod}`]: e.target.value })} />
        <button className="btn2 kucuk" onClick={() => void istek('/gosterge/hedef', { kod: x.kod, hedef: sayi(h[`h${x.kod}`]), uyari: sayi(h[`u${x.kod}`]), kritik: sayi(h[`k${x.kod}`]), gerekce: h[`g${x.kod}`] }).then(() => { setM('Hedef kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></div>}</div>)}</details>;
}
