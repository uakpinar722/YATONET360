import { useEffect, useState } from 'react';
import { istek } from './api';

type Satir = { kimlik: string; teklif_no: string; sira_no: number; kartela_kodu: string; aciklama: string; resmi_onay_karari: string | null };

/** YG-1441: etiketli teklif işlemleri; dosya ekibindeki Teknik Uzman Gerekli / Gerekmez işaretler. */
export function ResmiOnayIsaretleri({ dosya }: { dosya: string }) {
  const [l, setL] = useState<Satir[]>([]); const [m, setM] = useState('');
  const yk = () => istek<Satir[]>(`/dosya/${dosya}/resmi-onay`).then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, [dosya]);
  if (!l.length) return null;
  const isaretle = (k: string, karar: string) => void istek(`/teklif-kalemi/${k}/resmi-onay`, { karar }).then(() => { setM('Karar kaydedildi.'); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Resmî / Klas Onayı Gerekebilir</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div className="soru" key={x.kimlik}><span>{x.teklif_no} · {x.sira_no}. {x.kartela_kodu} · {x.aciklama} · {x.resmi_onay_karari ?? 'Değerlendirilmedi'}</span>
      <button className="btn2 kucuk" onClick={() => isaretle(x.kimlik, 'Gerekli')}>Gerekli</button><button className="btn2 kucuk" onClick={() => isaretle(x.kimlik, 'Gerekmez')}>Gerekmez</button></div>)}</>;
}

/** YG-1441: Teknik Müdür kartela işlemlerine "resmî / klas onayı gerekebilir" etiketini koyar veya kaldırır. */
export function KartelaResmiEtiket() {
  const [l, setL] = useState<{ kod: string; islem: string }[] | null>(null); const [kod, setKod] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<{ kod: string; islem: string }[]>('/kartela/resmi-onay').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const yap = (etiket: boolean, k = kod.trim()) => void istek(`/kartela/${encodeURIComponent(k)}/resmi-onay`, { etiket }).then(() => { setM(etiket ? 'Etiket eklendi.' : 'Etiket kaldırıldı.'); setKod(''); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Resmî / Klas Onayı Etiketi</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{l.length === 0 && <div className="not">Etiketli işlem bulunmamaktadır.</div>}{l.map((x) => <div key={x.kod}>{x.kod} · {x.islem} <button className="btn2 kucuk" onClick={() => yap(false, x.kod)}>Kaldır</button></div>)}</div>
    <label htmlFor="ro-k">İşlem Kodu</label><input id="ro-k" value={kod} onChange={(e) => setKod(e.target.value)} />
    <button className="btn2 kucuk" disabled={!kod.trim()} onClick={() => yap(true)}>Etiketle</button></>;
}
