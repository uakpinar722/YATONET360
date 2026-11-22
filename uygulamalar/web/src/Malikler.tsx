import { useEffect, useState } from 'react';
import { istek } from './api';

type M = { kimlik: string; ad: string; pay_orani: string | null; yetkili: boolean; taraf_no: string | null; yurt_disi: boolean; tebligat_adresi_tr: string | null };

/** YG-478: çok malikli yat; malikler ve tek yetkili malik. */
export function Malikler({ dosya }: { dosya: string }) {
  const [l, setL] = useState<M[]>([]); const [f, setF] = useState({ ad: '', pay: '', tarafNo: '', yurtDisi: false, tebligat: '' }); const [day, setDay] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<M[]>(`/dosya/${dosya}/malikler`).then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, [dosya]);
  return <details className="ozet"><summary>Yat Malikleri{l.length ? ` (${l.length})` : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div className="soru" key={x.kimlik}><span>{x.ad}{x.pay_orani ? ` · %${Number(x.pay_orani).toLocaleString('tr-TR')}` : ''}{x.taraf_no ? ` · ${x.taraf_no}` : ''}{x.yetkili ? ' · Yetkili Malik' : ''}{x.yurt_disi ? ` · Türkiye Tebligat Adresi: ${x.tebligat_adresi_tr ?? '---'}` : ''}</span>
      {!x.yetkili && <button className="btn2 kucuk" disabled={!day.trim()} onClick={() => void istek(`/dosya/${dosya}/malik/${x.kimlik}/yetkili`, { dayanak: day }).then(() => { setM('Yetkili malik kaydedildi.'); setDay(''); return yk(); }).catch((e) => setM(e.message))}>Yetkili Malik Yap</button>}</div>)}
    {l.length > 0 && <><label htmlFor="mk-d">Yetkili Malik Dayanağı (Belge / Beyan)</label><input required id="mk-d" value={day} onChange={(e) => setDay(e.target.value)} /></>}
    <label htmlFor="mk-a">Malik Adı / Unvanı</label><input required id="mk-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
    <label htmlFor="mk-p">Pay Oranı (%)</label><input id="mk-p" inputMode="decimal" value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })} />
    <label htmlFor="mk-t">Taraf No (Varsa)</label><input id="mk-t" value={f.tarafNo} onChange={(e) => setF({ ...f, tarafNo: e.target.value })} />
    <label className="kutu"><input type="checkbox" checked={f.yurtDisi} onChange={(e) => setF({ ...f, yurtDisi: e.target.checked })} /><span>Yurt Dışında Yerleşik / Yabancı Malik</span></label>
    {f.yurtDisi && <><label htmlFor="mk-tb">Türkiye Tebligat Adresi</label><textarea id="mk-tb" value={f.tebligat} onChange={(e) => setF({ ...f, tebligat: e.target.value })} /></>}
    <button className="btn2 kucuk" disabled={!f.ad.trim()} onClick={() => void istek(`/dosya/${dosya}/malik`, { ad: f.ad, pay: f.pay ? Number(f.pay.replace(',', '.')) : undefined, tarafNo: f.tarafNo || undefined, yurtDisi: f.yurtDisi, tebligat: f.tebligat || undefined }).then(() => { setF({ ad: '', pay: '', tarafNo: '', yurtDisi: false, tebligat: '' }); return yk(); }).catch((e) => setM(e.message))}>Malik Ekle</button></details>;
}
