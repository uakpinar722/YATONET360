import { useEffect, useState } from 'react';
import { istek } from './api';

type V = { varliklar: { kimlik: string; varlik_no: string; tur: string; ad: string; seri_no: string | null; durum: string; zimmetli: string | null }[]; personel: { kimlik: string; ad_soyad: string }[] };
/** YG-1618: LGM-VR varlık listesi; zimmet teslim ve iadeleri varlık numarasına bağlı hareket olarak tutulur. */
export function Varliklar() {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ tur: 'Cihaz', ad: '', seri: '' }); const [p, setP] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>('/varlik').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (x: Promise<unknown>, t: string) => void x.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Demirbaş ve Cihazlar</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="vr-t">Tür</label><select id="vr-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}><option>Cihaz</option><option>Demirbaş</option></select><label htmlFor="vr-a">Ad</label><input id="vr-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} /><label htmlFor="vr-s">Seri No</label><input id="vr-s" value={f.seri} onChange={(e) => setF({ ...f, seri: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.ad.trim()} onClick={() => is(istek('/varlik', f), 'Varlık kaydedildi.')}>Kaydet</button>
    {v.varliklar.map((x) => <div className="soru" key={x.kimlik}><span>{x.varlik_no} · {x.tur} · {x.ad}{x.seri_no ? ` · ${x.seri_no}` : ''} · {x.durum}{x.zimmetli ? ` · ${x.zimmetli}` : ''}</span>
      {x.durum === 'Depoda' && <div className="tam"><label htmlFor={`vr-p-${x.kimlik}`}>Personel</label><select id={`vr-p-${x.kimlik}`} value={p[x.kimlik] ?? ''} onChange={(e) => setP({ ...p, [x.kimlik]: e.target.value })}><option value="">Seçiniz</option>{v.personel.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad_soyad}</option>)}</select><button className="btn2 kucuk" disabled={!p[x.kimlik]} onClick={() => is(istek(`/varlik/${x.kimlik}/teslim`, { personel: p[x.kimlik] }), 'Zimmet teslim edildi.')}>Zimmetle</button></div>}
      {x.durum === 'Zimmette' && <button className="btn2 kucuk" onClick={() => is(istek(`/varlik/${x.kimlik}/iade`, {}), 'İade alındı.')}>İade Al</button>}</div>)}</details>;
}
