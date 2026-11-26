import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kimlik: string; tur: 'Firma' | 'Tesis'; no: string; ad: string; telefon: string | null };

/** YG-1259, TZ-4: aktarımda test kaydı şüphesi taşıyan firma ve tesis kayıtları; "Ayıklandı" listelerden çıkarır, kayıt silinmez. */
export function TestSuphesi() {
  const [l, setL] = useState<K[] | null>(null); const [m, setM] = useState('');
  const yk = () => istek<K[]>('/ana-veri/test-suphesi').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l || !l.length) return null;
  const karar = (x: K, k: string) => void istek(`/ana-veri/test-suphesi/${x.tur}/${x.kimlik}`, { karar: k }).then(() => { setM(`${x.ad}: ${k}.`); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Şüpheli Test Kayıtları</div>
    <div className="not">Aktarılan listede test veya örnek kayıt olabileceği değerlendirilen kayıtlardır. "Ayıklandı" kaydı listelerden çıkarır, kayıt silinmez.</div>
    {m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div key={x.kimlik} className="soru"><span>{x.tur} · {x.no} · {x.ad}{x.telefon ? ` · ${x.telefon}` : ''}</span>
      <div className="dugmeler"><button className="btn2 kucuk hayir" onClick={() => karar(x, 'Ayıklandı')}>Ayıklandı</button><button className="btn2 kucuk" onClick={() => karar(x, 'Gerçek Kayıt')}>Gerçek Kayıt</button></div></div>)}
  </>;
}
