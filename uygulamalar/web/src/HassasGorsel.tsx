import { useEffect, useState } from 'react';
import { istek } from './api';

type B = { kimlik: string; ad: string; belge_turu: string; hassas_icerik: boolean; maskeli_kaynak_ref: string | null };
/** YG-1165: hassas görsel işareti ve maskeli kopya bağı; özgün değişmez, dışarıya kopya gider. */
export function HassasGorsel({ dosya }: { dosya: string }) {
  const [l, setL] = useState<B[]>([]); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<B[]>(`/belge?bagTuru=Dosya&bagKimligi=${dosya}`).then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, [dosya]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!l.length) return null;
  const is = (p: Promise<unknown>, s: string) => void p.then(() => { setM(s); setG({}); return yk(); }).catch((e) => setM(e.message));
  const kopyalar = l.filter((x) => !x.hassas_icerik);
  return <details><summary>Hassas Görseller · {l.filter((x) => x.hassas_icerik).length} işaretli</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="not">Hassas görselin özgünü dışarı gönderilmez; maskeleme özgün üzerinde değil, ayrı yüklenen kopya üzerinde yapılır.</div>
    {l.map((x) => <div className={x.hassas_icerik ? 'soru hata' : 'soru'} key={x.kimlik}><span>{x.ad} · {x.belge_turu}{x.hassas_icerik ? ' · Hassas' : ''}{x.maskeli_kaynak_ref ? ' · Maskeli kopya' : ''}</span>
      <div className="tam">{!x.hassas_icerik && !x.maskeli_kaynak_ref && <><label htmlFor={`hg-n-${x.kimlik}`}>Hassasiyet Nedeni</label><input id={`hg-n-${x.kimlik}`} value={g[`n${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`n${x.kimlik}`]: e.target.value })} /><button className="btn2 kucuk" onClick={() => is(istek(`/belge/${x.kimlik}/hassas`, { neden: g[`n${x.kimlik}`] }), 'Hassas olarak işaretlendi; erişim gözden geçirmesi açıldı.')}>Hassas İşaretle</button></>}
        {x.hassas_icerik && <><label htmlFor={`hg-k-${x.kimlik}`}>Maskeli Kopya</label><select id={`hg-k-${x.kimlik}`} value={g[`k${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`k${x.kimlik}`]: e.target.value })}><option value="">Seçiniz</option>{kopyalar.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad}</option>)}</select><button className="btn2 kucuk" onClick={() => is(istek(`/belge/${x.kimlik}/maskeli-kopya`, { kopya: g[`k${x.kimlik}`] }), 'Maskeli kopya bağlandı.')}>Bağla</button></>}</div></div>)}</details>;
}
