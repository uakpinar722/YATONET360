import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-856, KS-11: bölge katsayıları (kartela birim fiyatı çarpanı); değişiklik Ticari İşler Direktörü talebi, GMY ve CEO onayı. */
export function BolgeKatsayisi() {
  type V = { bolgeler: { bolge: string; katsayi: string }[]; talepler: { kimlik: string; bolge: string; yeni_katsayi: string; gerekce: string; durum: string }[]; hazirlar: boolean };
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ bolge: '', katsayi: '', gerekce: '' }); const [m, setM] = useState('');
  const yk = () => istek<V>('/bolge-katsayisi').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const k = (x: string) => Number(x).toFixed(2).replace('.', ',');
  return <details><summary>Bölge Katsayıları</summary>{m && <div className="not" role="status">{m}</div>}
    {v.bolgeler.map((x) => <div key={x.bolge} className="soru"><span>{x.bolge} · {k(x.katsayi)}</span></div>)}
    {v.talepler.map((x) => <div key={x.kimlik} className="not">{x.bolge} · {k(x.yeni_katsayi)} · {x.durum} · {x.gerekce}</div>)}
    {v.hazirlar && <div className="ozet">
      <label htmlFor="bk-b">Bölge</label><select id="bk-b" value={f.bolge} onChange={(e) => setF({ ...f, bolge: e.target.value })}><option value="">Seçiniz</option>{v.bolgeler.map((x) => <option key={x.bolge}>{x.bolge}</option>)}</select>
      <label htmlFor="bk-k">Yeni Katsayı</label><input id="bk-k" inputMode="decimal" value={f.katsayi} onChange={(e) => setF({ ...f, katsayi: e.target.value })} />
      <label htmlFor="bk-g">Gerekçe</label><input required id="bk-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
      <button className="btn2" disabled={!f.bolge || !f.katsayi || !f.gerekce.trim()} onClick={() => void istek('/bolge-katsayisi/talep', f).then(() => { setM('Talep onaya gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button>
    </div>}
  </details>;
}
