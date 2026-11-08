import { useEffect, useState } from 'react';
import { istek } from './api';

type V = { bekleyenler: { kimlik: string; dosya_no: string; yat_adi: string }[]; adaylar: { kimlik: string; ad_soyad: string }[] };

/** YG-1600: Muhasebe ve Finans Yöneticisi keşif iş emri açılan dosyalara Ticari Sorumlu atar. */
export function TicariAtamaBekleyenler() {
  const [v, setV] = useState<V | null>(null); const [sec, setSec] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>('/ticari-atama').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const onayla = (d: string) => void istek(`/dosya/${d}/ticari-sorumlu`, { kullanici: sec[d] }).then(() => { setM('Ticari Sorumlu atandı.'); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Atama Bekleyenler</div>{m && <div className="not" role="status">{m}</div>}
    {v.bekleyenler.length === 0 && <div className="not">Atama bekleyen dosya bulunmamaktadır.</div>}
    {v.bekleyenler.map((x) => <div className="soru" key={x.kimlik}><span>{x.dosya_no} · {x.yat_adi}</span>
      <label htmlFor={`ta-${x.kimlik}`}>Ticari Sorumlu</label><select id={`ta-${x.kimlik}`} value={sec[x.kimlik] ?? ''} onChange={(e) => setSec({ ...sec, [x.kimlik]: e.target.value })}><option value="">Seçiniz</option>{v.adaylar.map((a) => <option key={a.kimlik} value={a.kimlik}>{a.ad_soyad}</option>)}</select>
      <button className="btn2 kucuk" disabled={!sec[x.kimlik]} onClick={() => onayla(x.kimlik)}>Onayla</button></div>)}</>;
}
