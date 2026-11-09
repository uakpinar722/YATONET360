import { useEffect, useState } from 'react';
import { istek } from './api';

type O = { kimlik: string; dosya_no: string; hizmet_turu: string };
type V = { satirlar: string[]; degerler: Record<string, string>; durum: string | null; iade: string | null };

/** YG-644, YG-275: hizmet sağlayıcı sonuç tutanağı ve resmî talimat kaydı. */
export function KurtarmaSonucFirma() {
  const [l, setL] = useState<O[]>([]); const [s, setS] = useState(''); const [v, setV] = useState<V | null>(null); const [f, setF] = useState<Record<string, string>>({}); const [t, setT] = useState(''); const [m, setM] = useState('');
  useEffect(() => { void istek<O[]>('/firma-portal/kurtarma').then(setL).catch(() => setL([])); }, []);
  const yk = (id: string) => istek<V>(`/firma-portal/kurtarma/${id}/sonuc`).then((x) => { setV(x); setF(x.degerler); }).catch((e) => setM(e.message));
  if (!l.length) return null;
  const acik = v && (!v.durum || v.durum === 'İade');
  return <details><summary>Operasyon Sonuç Tutanağı</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="ks-o">Operasyon</label><select id="ks-o" value={s} onChange={(e) => { setS(e.target.value); setV(null); if (e.target.value) void yk(e.target.value); }}><option value="">Seçiniz</option>{l.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.dosya_no} · {x.hizmet_turu}</option>)}</select>
    {v && <><div>Durum: {v.durum ?? 'Girilmedi'}{v.iade ? ` · İade: ${v.iade}` : ''}</div>
      <label htmlFor="ks-t">Resmî Talimat (Sahil Güvenlik, Liman)</label><input id="ks-t" value={t} onChange={(e) => setT(e.target.value)} /><button className="btn2 kucuk" disabled={!t.trim()} onClick={() => void istek(`/firma-portal/kurtarma/${s}/talimat`, { metin: t }).then(() => { setT(''); setM('Talimat kaydedildi.'); return yk(s); }).catch((e) => setM(e.message))}>Talimatı Kaydet</button>
      {v.satirlar.map((a, n) => <span key={a}><label htmlFor={`ks-${n}`}>{a}</label><input id={`ks-${n}`} disabled={!acik} value={f[a] ?? ''} onChange={(e) => setF({ ...f, [a]: e.target.value })} /></span>)}
      {acik && <button className="btn2 kucuk" onClick={() => void istek(`/firma-portal/kurtarma/${s}/sonuc`, { degerler: f }).then(() => { setM('Tutanak kontrole gönderildi.'); return yk(s); }).catch((e) => setM(e.message))}>Kontrole Gönder</button>}</>}</details>;
}

type K = { kimlik: string; hizmet_turu: string; veriler: Record<string, string>; durum: string };
/** Dosya Sorumlusu sonuç tutanağını kontrol eder. */
export function KurtarmaSonucKontrol({ dosya }: { dosya: string }) {
  const [l, setL] = useState<K[]>([]); const [g, setG] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<K[]>(`/dosya/${dosya}/kurtarma-sonuc`).then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, [dosya]);
  if (!l.length) return null;
  const is = (id: string, karar: string) => void istek(`/kurtarma/${id}/sonuc-kontrol`, { karar, gerekce: g || undefined }).then(() => { setM('Karar kaydedildi.'); setG(''); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Operasyon Sonuç Tutanağı</summary>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div key={x.kimlik}><div className="ozet"><div>{x.hizmet_turu} · {x.durum}</div>{Object.entries(x.veriler).map(([a, d]) => <div key={a}>{a}: {d}</div>)}</div>{x.durum === 'Kontrolde' && <><label htmlFor={`kk-${x.kimlik}`}>İade Gerekçesi</label><input id={`kk-${x.kimlik}`} value={g} onChange={(e) => setG(e.target.value)} /><button className="btn2 kucuk" onClick={() => is(x.kimlik, 'Onayla')}>Onayla</button><button className="btn2 kucuk" disabled={!g.trim()} onClick={() => is(x.kimlik, 'İade')}>Gerekçeyle İade Et</button></>}</div>)}</details>;
}
