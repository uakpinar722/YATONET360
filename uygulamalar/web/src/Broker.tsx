import { useEffect, useState } from 'react';
import { istek } from './api';
import { BelgeSec } from './Kalite';

type D = { kimlik: string; dosya_no: string; statu: string; yat_adi: string; yat_sahibi: string | null; yetki: string; bitis: string | null };
const tarih = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '—');
/** YG-1573: acente ve broker ana ekranı (A6). */
export function BrokerAna() {
  const [v, setV] = useState<{ dosyalar: D[]; bekleyen: D[]; dolan: D[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/broker/ana').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const sat = (x: D) => <div className={x.yetki === 'Geçerli' ? 'soru' : 'soru hata'} key={x.kimlik}><span>{x.dosya_no} · {x.yat_adi}{x.yat_sahibi ? ` · ${x.yat_sahibi}` : ''} · {x.statu} · Yetki: {x.yetki}{x.bitis ? ` (${tarih(x.bitis)})` : ''}</span></div>;
  return <section><div className="bolum">Yetki Belgesi Bekleyen Dosyalar</div>{v.bekleyen.length ? v.bekleyen.map(sat) : <div className="ozet bos">Yetki belgesi bekleyen dosya bulunmamaktadır.</div>}
    <div className="bolum">Süresi Dolmak Üzere Olan Yetki Belgeleri</div>{v.dolan.length ? v.dolan.map(sat) : <div className="ozet bos">Süresi dolmak üzere olan yetki belgesi bulunmamaktadır.</div>}
    <div className="bolum">Dosyalarım</div>{v.dosyalar.length ? v.dosyalar.map(sat) : <div className="ozet bos">Dosya bulunmamaktadır.</div>}</section>;
}

type Y = { kimlik: string; dosya: string; dosya_no: string; yat_adi: string; kapsam: string[]; parasal_sinir: string | null; bitis: string | null; yetki_durumu: string; yenileme: string | null };
/** YG-1573: Yetki Belgeleri sayfası; kapsam, tek işlem üst limiti, bitiş ve yenilenmiş belge yükleme. */
export function YetkiBelgeleri() {
  const [l, setL] = useState<Y[]>([]); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<Y[]>('/broker/yetki-belgeleri').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  return <><h1>Yetki Belgeleri</h1>{m && <div className="not" role="status">{m}</div>}
    {l.length === 0 ? <div className="ozet bos">Yetki belgesi bulunmamaktadır.</div> : l.map((x) => <div className="soru" key={x.kimlik}><span>{x.dosya_no} · {x.yat_adi} · Kapsam: {x.kapsam.join(', ')} · Tek İşlem Üst Limiti: {x.parasal_sinir ? `${Number(x.parasal_sinir).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} EUR` : '—'} · Bitiş: {tarih(x.bitis)} · {x.yetki_durumu}{x.yenileme ? ` · Yenileme: ${x.yenileme}` : ''}</span>
      <div className="tam"><BelgeSec ad="Yenilenmiş Yetki Belgesi" bagTuru="Dosya" bagKimligi={x.dosya} deger={g[x.kimlik] ?? ''} sec={(b) => setG({ ...g, [x.kimlik]: b })} /><label htmlFor={`yt-${x.kimlik}`}>Yeni Bitiş</label><input id={`yt-${x.kimlik}`} type="date" value={g[`t${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`t${x.kimlik}`]: e.target.value })} />
        <button className="btn2 kucuk" onClick={() => void istek(`/broker/yetki/${x.kimlik}/yenile`, { belge: g[x.kimlik], bitis: g[`t${x.kimlik}`] || undefined }).then(() => { setM('Belge kontrole gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Yenilenmiş Belgeyi Yükle</button></div></div>)}</>;
}
