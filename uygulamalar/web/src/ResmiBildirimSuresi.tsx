import { useEffect, useState } from 'react';
import { istek } from './api';

type S = { muhatap: string; sure_saat: string | null; dayanak: string | null };

/** YG-277, TZ-3: seçilen resmî muhatabın bildirim süresi; girilmemişse uyarı. Hukuk ve Uyum Direktörü süreyi ve dayanağını girer. */
export function ResmiBildirimSuresi({ muhatap }: { muhatap: string }) {
  const [v, setV] = useState<{ duzenler: boolean; sureler: S[] } | null>(null); const [f, setF] = useState({ saat: '', dayanak: '' }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/acil/resmi-bildirim-sureleri').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  const s = v?.sureler.find((x) => x.muhatap === muhatap);
  if (!v || !s) return null;
  return <>
    {s.sure_saat ? <div className="not">Resmî bildirim süresi: {String(s.sure_saat).replace('.', ',')} saat · Dayanak: {s.dayanak}</div> : <div className="uyari">{muhatap} için resmî bildirim süresi parametresi bekleniyor (Hukuk ve Uyum Direktörü girer). Bildirim kaydını yine tutunuz.</div>}
    {v.duzenler && <details><summary>Süreyi Gir ({muhatap})</summary>
      <label htmlFor="rbs-s">Süre (Saat)</label><input id="rbs-s" inputMode="decimal" value={f.saat} onChange={(e) => setF({ ...f, saat: e.target.value })} />
      <label htmlFor="rbs-d">Mevzuat Dayanağı</label><input id="rbs-d" value={f.dayanak} onChange={(e) => setF({ ...f, dayanak: e.target.value })} />
      <button className="btn2 kucuk" disabled={!f.saat || !f.dayanak.trim()} onClick={() => void istek('/acil/resmi-bildirim-suresi', { muhatap, saat: Number(f.saat.replace(',', '.')), dayanak: f.dayanak }).then(() => { setM('Süre kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button>
      {m && <div className="not" role="status">{m}</div>}
    </details>}
  </>;
}
