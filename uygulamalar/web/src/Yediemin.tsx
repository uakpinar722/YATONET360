import { OnayaGonder } from './Dugme';
import { useEffect, useState } from 'react';
import { istek } from './api';
import { tarih } from './bicim';

/** YG-104: yediemin talebi; LGM veya Çözüm Ortağı yalnız Hukuk ve Uyum Direktörü onayıyla yediemin olur. */
export function Yediemin({ id }: { id: string }) {
  const [l, setL] = useState<{ kimlik: string; yediemin: string; ticari_unvan: string | null; dayanak: string; durum: string; olusturma_zamani: string }[] | null>(null); const [firmalar, setFirmalar] = useState<{ kimlik: string; ticari_unvan: string }[]>([]);
  const [f, setF] = useState({ yediemin: 'LGM', kurulus: '', dayanak: '' }); const [m, setM] = useState('');
  const yk = () => istek<{ talepler: NonNullable<typeof l>; firmalar: typeof firmalar }>(`/dosya/${id}/yediemin`).then((r) => { setL(r.talepler); setFirmalar(r.firmalar); }).catch(() => setL(null));
  useEffect(() => { void yk(); }, [id]);
  if (!l) return null;
  return <details><summary>Yediemin ({l.length})</summary>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div key={x.kimlik} className="soru"><span>{x.yediemin}{x.ticari_unvan ? ` · ${x.ticari_unvan}` : ''} · {x.durum} · {tarih(x.olusturma_zamani)} · {x.dayanak}</span></div>)}
    <div className="ozet">
      <label htmlFor="ye-y">Yediemin Olacak Taraf</label><select id="ye-y" value={f.yediemin} onChange={(e) => setF({ ...f, yediemin: e.target.value })}><option>LGM</option><option>Çözüm Ortağı</option></select>
      {f.yediemin === 'Çözüm Ortağı' && <><label htmlFor="ye-k">Yediemin Çözüm Ortağı</label><select id="ye-k" value={f.kurulus} onChange={(e) => setF({ ...f, kurulus: e.target.value })}><option value="">Seçiniz</option>{firmalar.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ticari_unvan}</option>)}</select></>}
      <label htmlFor="ye-d">Yediemin Dayanağı (mahkeme veya icra kararı)</label><input id="ye-d" value={f.dayanak} onChange={(e) => setF({ ...f, dayanak: e.target.value })} />
      <OnayaGonder rol="Hukuk ve Uyum Direktörü" className="btn2 kucuk" disabled={!f.dayanak.trim() || (f.yediemin === 'Çözüm Ortağı' && !f.kurulus)} onClick={() => void istek(`/dosya/${id}/yediemin`, { ...f, kurulus: f.kurulus || undefined }).then(() => { setM('Talep Hukuk ve Uyum Direktörü onayına gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</OnayaGonder>
    </div>
  </details>;
}
