import { useEffect, useState } from 'react';
import { istek } from './api';

type R = { kimlik: string; tur: string; randevu_zamani: string; yer: string; is_test: string | null; alici_sayisi: number };
/** YG-552: garanti keşfi, tanıklık ve deniz denemesi bildirimi takvim davetiyle; keşif bildirimi planlamayla kendiliğinden gider. */
export function Randevular({ dosya }: { dosya: string }) {
  const [l, setL] = useState<R[] | null>(null); const [f, setF] = useState({ tur: 'Deniz Denemesi', zaman: '', yer: '', isTest: '', kayitNo: '' }); const [m, setM] = useState('');
  const yk = () => istek<R[]>(`/dosya/${dosya}/randevu`).then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!l) return null;
  return <details><summary>Randevu Bildirimleri{l.length ? ` · ${l.length}` : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div className="soru" key={x.kimlik}><span>{x.tur} · {new Date(x.randevu_zamani).toLocaleString('tr-TR')} · {x.yer}{x.is_test ? ` · ${x.is_test}` : ''} · {x.alici_sayisi} alıcı</span></div>)}
    <label htmlFor="rv-t">Tür</label><select id="rv-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}><option>Deniz Denemesi</option><option>Tanıklık</option><option>Garanti Keşfi</option></select>
    <label htmlFor="rv-z">Tarih-Saat</label><input id="rv-z" type="datetime-local" value={f.zaman} onChange={(e) => setF({ ...f, zaman: e.target.value })} /><label htmlFor="rv-y">Yer</label><input id="rv-y" value={f.yer} onChange={(e) => setF({ ...f, yer: e.target.value })} />
    {f.tur === 'Tanıklık' && <><label htmlFor="rv-i">İş / Test</label><input id="rv-i" value={f.isTest} onChange={(e) => setF({ ...f, isTest: e.target.value })} /></>}
    {f.tur === 'Garanti Keşfi' && <><label htmlFor="rv-k">Garanti Bildirim No</label><input id="rv-k" value={f.kayitNo} onChange={(e) => setF({ ...f, kayitNo: e.target.value })} /></>}
    <button className="btn2 kucuk" disabled={!f.zaman || !f.yer.trim()} onClick={() => void istek<{ alicilar: number }>(`/dosya/${dosya}/randevu`, { ...f, zaman: new Date(f.zaman).toISOString(), isTest: f.isTest || undefined, kayitNo: f.kayitNo || undefined }).then((r) => { setM(`Bildirim hazırlandı (${r.alicilar} alıcı).`); return yk(); }).catch((e) => setM(e.message))}>Bildir ve Davet Gönder</button></details>;
}
