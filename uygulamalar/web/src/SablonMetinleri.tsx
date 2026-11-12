import { useEffect, useState } from 'react';
import { istek } from './api';

type M = { kod: string; dil: string; surum: number; baslik: string | null; metin: string; durum: string; sahip_rol: string; onay_dayanagi: string | null; degisiklik_gerekcesi: string | null };
/** YG-600: bildirim ve matbu metinlerin adı, dili, sürümü, sahibi ve onayı; değişiklik yeni sürümle. */
export function SablonMetinleri() {
  const [v, setV] = useState<{ duzenler: boolean; metinler: M[] } | null>(null); const [ara, setAra] = useState(''); const [m, setM] = useState('');
  const [d, setD] = useState<{ anahtar: string; metin: string; gerekce: string; anlam: boolean } | null>(null);
  const yk = () => void istek<NonNullable<typeof v>>(`/sablon-metni?ara=${encodeURIComponent(ara)}`).then(setV).catch(() => setV(null));
  useEffect(() => { const t = setTimeout(yk, 250); return () => clearTimeout(t); }, [ara]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return null;
  return <details><summary>Metin Kütüphanesi · {v.metinler.filter((x) => x.durum === 'Yürürlükte').length} yürürlükte · {v.metinler.filter((x) => x.durum === 'Onayda').length} onayda</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="sm-ara">Kod veya ad ara</label><input id="sm-ara" value={ara} onChange={(e) => setAra(e.target.value)} />
    {v.metinler.map((x) => { const k = `${x.kod}|${x.dil}|${x.surum}`; return <div className={x.durum === 'Yürürlükte' ? 'soru' : 'soru bos'} key={k}>
      <span><b>{x.kod}</b> · {x.dil.toUpperCase()} · Rev.{x.surum} · {x.durum}{x.baslik ? ` · ${x.baslik}` : ''}<br /><small>Sahip: {x.sahip_rol} · Onay: {x.onay_dayanagi ?? '---'}{x.degisiklik_gerekcesi ? ` · Gerekçe: ${x.degisiklik_gerekcesi}` : ''}</small><br />{x.metin}</span>
      {v.duzenler && x.durum === 'Yürürlükte' && (d?.anahtar === k ? <div className="tam">
        <label htmlFor={`sm-m-${k}`}>Yeni Metin</label><textarea id={`sm-m-${k}`} value={d.metin} onChange={(e) => setD({ ...d, metin: e.target.value })} />
        <label htmlFor={`sm-g-${k}`}>Değişiklik Gerekçesi</label><input id={`sm-g-${k}`} value={d.gerekce} onChange={(e) => setD({ ...d, gerekce: e.target.value })} />
        <label className="kutu"><input type="checkbox" checked={!d.anlam} onChange={(e) => setD({ ...d, anlam: !e.target.checked })} /><span>Yalnız yazım düzeltmesi (anlam değişmiyor)</span></label>
        <div className="not">{d.anlam ? 'Gönderilecek: CEO' : 'Metin sahibi kaydıyla doğrudan yürürlüğe girer.'}</div>
        <button className="btn2 kucuk" onClick={() => void istek<{ durum: string }>(`/sablon-metni/${encodeURIComponent(x.kod)}/${x.dil}`, { metin: d.metin, gerekce: d.gerekce, anlamEtkiler: d.anlam }).then((r) => { setM(r.durum === 'Onayda' ? 'Yeni sürüm CEO onayına gönderildi.' : 'Yeni sürüm yürürlüğe girdi.'); setD(null); yk(); }).catch((e) => setM(e.message))}>Yeni Sürüm Kaydet</button></div>
        : <button className="btn2 kucuk" onClick={() => setD({ anahtar: k, metin: x.metin, gerekce: '', anlam: true })}>Yeni Sürüm</button>)}</div>; })}</details>;
}
