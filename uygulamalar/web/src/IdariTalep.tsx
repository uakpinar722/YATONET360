import { useEffect, useState } from 'react';
import { istek } from './api';

type T = { kimlik: string; talep_no: string; konu: string; durum: string; tedarikci: string | null; siparis_tutar_eur: string | null };

/** YG-1619: idari talep; ihtiyaç onayı silsileyle, parasal onay sipariş aşamasında. */
export function IdariTalep() {
  const [v, setV] = useState<{ sorumlu: boolean; talepler: T[] } | null>(null); const [f, setF] = useState({ konu: '', gerekce: '' }); const [s, setS] = useState<Record<string, { tedarikci: string; tutar: string }>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/idari-talep').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">İdari Talepler</div>{m && <div className="not" role="status">{m}</div>}
    {v.talepler.map((x) => { const a = s[x.kimlik] ?? { tedarikci: '', tutar: '' }; return <div className="soru" key={x.kimlik}><span>{x.talep_no} · {x.konu} · {x.durum}</span>
      {v.sorumlu && x.durum === 'İdari İşlerde' && <div className="tam"><label htmlFor={`it-t-${x.kimlik}`}>Tedarikçi</label><input id={`it-t-${x.kimlik}`} value={a.tedarikci} onChange={(e) => setS({ ...s, [x.kimlik]: { ...a, tedarikci: e.target.value } })} /><label htmlFor={`it-u-${x.kimlik}`}>Tutar (EUR)</label><input id={`it-u-${x.kimlik}`} inputMode="decimal" value={a.tutar} onChange={(e) => setS({ ...s, [x.kimlik]: { ...a, tutar: e.target.value } })} /><button className="btn2 kucuk" disabled={!a.tedarikci.trim() || !a.tutar} onClick={() => is(istek(`/idari-talep/${x.kimlik}/siparis`, { tedarikci: a.tedarikci, tutar: Number(a.tutar.replace(/\./g, '').replace(',', '.')) }), 'Sipariş onaya gönderildi.')}>Siparişi Onaya Gönder</button></div>}</div>; })}
    <label htmlFor="it-k">Talep Konusu</label><input id="it-k" value={f.konu} onChange={(e) => setF({ ...f, konu: e.target.value })} />
    <label htmlFor="it-g">Gerekçe</label><input id="it-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.konu.trim() || !f.gerekce.trim()} onClick={() => is(istek('/idari-talep', f).then(() => setF({ konu: '', gerekce: '' })), 'Talep açıldı.')}>Talep Aç</button></>;
}
