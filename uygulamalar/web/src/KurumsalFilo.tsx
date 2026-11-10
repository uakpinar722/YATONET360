import { useEffect, useState } from 'react';
import { istek } from './api';

const t = (x: number | string) => Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type V = { anlik: { filo: { yat_adi: string; dosya_no: string; statu: string; asama: string; acilis: string }[]; bakiye: number }; raporlar: { kimlik: string; donem: string; durum: string; itiraz_son: string | null; itiraz: string | null }[] };
/** YG-765: kurumsal müşteri filo panosu ve aylık raporlar; itiraz süresi içinde itiraz edilebilir. */
export function KurumsalFilo() {
  const [v, setV] = useState<V | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>('/kurumsal/filo').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  return <section><div className="bolum">Filo ve Cari Hesap</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{v.anlik.filo.length === 0 ? <div className="bos">Kayıt bulunmamaktadır.</div> : v.anlik.filo.map((x) => <div key={x.dosya_no}>{x.yat_adi} · {x.dosya_no} · {x.statu}{x.asama ? ` · ${x.asama}` : ''} · {x.acilis}</div>)}<div>Açık Bakiye: <b>{t(v.anlik.bakiye)} EUR</b></div></div>
    {v.raporlar.map((r) => <div className="soru" key={r.kimlik}><span>{r.donem} Aylık Rapor · {r.durum} · <a href={`/api/kurumsal/rapor/${r.kimlik}/belge`}>PDF</a> · <a href={`/api/kurumsal/rapor/${r.kimlik}/belge?bicim=docx`}>Word</a>{r.itiraz_son && r.durum === 'Gönderildi' ? ` · İtiraz Son: ${new Date(r.itiraz_son).toLocaleDateString('tr-TR')}` : ''}</span>
      {r.durum === 'Gönderildi' && <div className="tam"><label htmlFor={`kf-${r.kimlik}`}>İtiraz</label><input id={`kf-${r.kimlik}`} value={g[r.kimlik] ?? ''} onChange={(e) => setG({ ...g, [r.kimlik]: e.target.value })} /><button className="btn2 kucuk" disabled={!g[r.kimlik]?.trim()} onClick={() => void istek(`/kurumsal/rapor/${r.kimlik}/itiraz`, { itiraz: g[r.kimlik] }).then(() => { setM('İtirazınız iletildi.'); return yk(); }).catch((e) => setM(e.message))}>İtiraz Et</button></div>}</div>)}</section>;
}
