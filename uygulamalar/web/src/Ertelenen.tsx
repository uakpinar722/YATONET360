import { useEffect, useState } from 'react';
import { istek } from './api';

type Alt = { kimlik: string; talep_no: string; oncelik: string; statu: string; ihtiyac_tanimi: string; dosya_no: string | null };

/** YG-076: ertelenen kalemler Planlı alt dosya talebi olarak ayrılır; ana dosyada alt talepler listelenir. */
export function ErtelenenKalemler({ dosya }: { dosya: string }) {
  const [l, setL] = useState<Alt[]>([]); const [k, setK] = useState(''); const [h, setH] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<Alt[]>(`/dosya/${dosya}/alt-talepler`).then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, [dosya]);
  const ayir = () => void istek<{ talepNo: string }>(`/dosya/${dosya}/ertelenen`, { kalemler: k.split('\n').map((x) => x.trim()).filter(Boolean), hedef: h })
    .then((r) => { setM(`Planlı alt dosya talebi açıldı: ${r.talepNo}`); setK(''); setH(''); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Ertelenen Kalemler</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{l.map((x) => <div key={x.kimlik}>{x.talep_no} · {x.oncelik} · {x.dosya_no ?? x.statu}</div>)}</div>
    <label htmlFor="er-k">Ertelenen Kalemler (her satıra bir kalem)</label><textarea id="er-k" rows={3} value={k} onChange={(e) => setK(e.target.value)} />
    <label htmlFor="er-h">Hedef Tarih</label><input id="er-h" type="date" value={h} onChange={(e) => setH(e.target.value)} />
    <button className="btn2 kucuk" disabled={!k.trim() || !h} onClick={ayir}>Planlı Alt Dosya Aç</button></>;
}
