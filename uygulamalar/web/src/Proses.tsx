import { useEffect, useState } from 'react';
import { istek } from './api';

const TURLER = ['Kompozit Laminasyon ve Kür', 'Yapıştırma, Sızdırmazlık ve Dolgu'];
type Sinir = { proses_turu: string; sicaklik_min: string | null; sicaklik_max: string | null; nem_min: string | null; nem_max: string | null; dayanak: string };
type Seans = { kimlik: string; kayit_no: string; proses_turu: string; seans_no: number; sicaklik: string; nem: string; sinir_disi: string[]; durum: string; karar: string | null };
type V = { sinirlar: Sinir[]; seanslar: Seans[]; uygunsuzluklar?: { kimlik: string; uygunsuzluk_no: string }[]; tu?: boolean };
const aralik = (a: string | null, u: string | null) => `${a ?? '—'} / ${u ?? '—'}`;
const Sinirlar = ({ l }: { l: Sinir[] }) => <>{l.map((x) => <div key={x.proses_turu}>{x.proses_turu} · Sıcaklık (°C): {aralik(x.sicaklik_min, x.sicaklik_max)} · Nem (%): {aralik(x.nem_min, x.nem_max)} · Dayanak: {x.dayanak}</div>)}</>;
const satir = (x: Seans) => `${x.kayit_no} · Seans ${x.seans_no} · ${x.sicaklik} °C · %${x.nem} · ${x.durum}${x.sinir_disi.length ? ` · Sınır Dışı: ${x.sinir_disi.join(', ')}` : ''}${x.karar ? ` · Karar: ${x.karar}` : ''}`;

/** YG-1455, YG-408: firma seans satırını portaldan girer. */
export function ProsesFirma({ isEmri }: { isEmri: string }) {
  const bos = { tur: TURLER[0]!, zaman: '', sicaklik: '', nem: '', recine: '', sertlestirici: '', katlar: '', vakum: '', vakumSure: '', malzeme: '', sorumlu: '' };
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState(bos); const [m, setM] = useState('');
  const yk = () => istek<V>(`/firma-portal/is-emri/${isEmri}/proses`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [isEmri]);
  if (!v) return null;
  const al = (a: keyof typeof bos, ad: string, tip = 'text') => <><label htmlFor={`pr-${a}-${isEmri}`}>{ad}</label><input id={`pr-${a}-${isEmri}`} type={tip} value={f[a]} onChange={(e) => setF({ ...f, [a]: e.target.value })} /></>;
  const kompozit = f.tur === TURLER[0];
  const kaydet = () => void istek<{ sinirDisi: string[] }>(`/firma-portal/is-emri/${isEmri}/proses`, f).then((r) => { setM(r.sinirDisi.length ? `Kaydedildi; ${r.sinirDisi.join(', ')} sınır dışı. Teknik Uzmanın kararını bekleyiniz.` : 'Seans kaydedildi.'); setF({ ...bos, tur: f.tur }); return yk(); }).catch((e) => setM(e.message));
  return <div className="blok"><div className="bolum">Proses Kayıtları</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet"><Sinirlar l={v.sinirlar} />{v.seanslar.map((x) => <div key={x.kimlik}>{satir(x)}</div>)}</div>
    <label htmlFor={`pr-t-${isEmri}`}>Proses Türü</label><select id={`pr-t-${isEmri}`} value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{TURLER.map((x) => <option key={x}>{x}</option>)}</select>
    {al('zaman', 'Seans Zamanı', 'datetime-local')}{al('sicaklik', 'Sıcaklık (°C)')}{al('nem', 'Bağıl Nem (%)')}
    {kompozit ? <>{al('recine', 'Reçine (kg)')}{al('sertlestirici', 'Sertleştirici (kg)')}{al('katlar', 'Kat Sırası')}{al('vakum', 'Vakum Değeri')}{al('vakumSure', 'Vakum Süresi (dk)')}</> : al('malzeme', 'Malzeme ve Parti No')}
    {al('sorumlu', 'Sorumlu Rol')}
    <button className="btn2 kucuk" onClick={kaydet}>Seansı Kaydet</button></div>;
}

/** YG-1455, YG-282, PRS-1: Teknik Uzman sınırları girer, sınır dışı seansa karar verir, seansı sonuçlandırır. */
export function ProsesLgm({ isEmri }: { isEmri: string }) {
  const [v, setV] = useState<V | null>(null); const [s, setS] = useState({ tur: TURLER[0]!, sicaklikMin: '', sicaklikMax: '', nemMin: '', nemMax: '', dayanak: '' }); const [g, setG] = useState<Record<string, string>>({}); const [u, setU] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>(`/is-emri/${isEmri}/proses`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [isEmri]);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  const al = (a: 'sicaklikMin' | 'sicaklikMax' | 'nemMin' | 'nemMax' | 'dayanak', ad: string) => <><label htmlFor={`ps-${a}-${isEmri}`}>{ad}</label><input id={`ps-${a}-${isEmri}`} value={s[a]} onChange={(e) => setS({ ...s, [a]: e.target.value })} /></>;
  return <><div className="bolum">Proses Kayıtları</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet"><Sinirlar l={v.sinirlar} /></div>
    {v.seanslar.map((x) => <div className="soru" key={x.kimlik}><span>{satir(x)}</span>{v.tu && x.durum === 'Karar Bekliyor' && <div className="tam">
      <label htmlFor={`pg-${x.kimlik}`}>Karar Gerekçesi</label><input id={`pg-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />
      <button className="btn2 kucuk" onClick={() => is(istek(`/proses-seansi/${x.kimlik}/karar`, { karar: 'Devam', gerekce: g[x.kimlik] }), 'Karar kaydedildi.')}>Devam</button>
      <button className="btn2 kucuk" onClick={() => is(istek(`/proses-seansi/${x.kimlik}/karar`, { karar: 'Durdur', gerekce: g[x.kimlik] }), 'İş durduruldu.')}>Durdur</button></div>}
      {v.tu && x.durum === 'Girildi' && <div className="tam">
        <button className="btn2 kucuk" onClick={() => is(istek(`/proses-seansi/${x.kimlik}/sonuc`, { sonuc: 'Uygun' }), 'Seans onaylandı.')}>Uygun</button>
        <label htmlFor={`pu-${x.kimlik}`}>Uygunsuzluk Kaydı</label><select id={`pu-${x.kimlik}`} value={u[x.kimlik] ?? ''} onChange={(e) => setU({ ...u, [x.kimlik]: e.target.value })}><option value="">Seçiniz</option>{(v.uygunsuzluklar ?? []).map((n) => <option key={n.kimlik} value={n.kimlik}>{n.uygunsuzluk_no}</option>)}</select>
        <button className="btn2 kucuk" disabled={!u[x.kimlik]} onClick={() => is(istek(`/proses-seansi/${x.kimlik}/sonuc`, { sonuc: 'Uygun Değil', uygunsuzluk: u[x.kimlik] }), 'Sonuç kaydedildi.')}>Uygun Değil</button></div>}</div>)}
    {v.tu && <>
      <label htmlFor={`ps-t-${isEmri}`}>Proses Türü (Sınır)</label><select id={`ps-t-${isEmri}`} value={s.tur} onChange={(e) => setS({ ...s, tur: e.target.value })}>{TURLER.map((x) => <option key={x}>{x}</option>)}</select>
      {al('sicaklikMin', 'Sıcaklık Alt (°C)')}{al('sicaklikMax', 'Sıcaklık Üst (°C)')}{al('nemMin', 'Nem Alt (%)')}{al('nemMax', 'Nem Üst (%)')}{al('dayanak', 'Dayanak (Üretici Verisi veya Yöntem Belgesi)')}
      <button className="btn2 kucuk" disabled={!s.dayanak.trim()} onClick={() => is(istek(`/is-emri/${isEmri}/proses-siniri`, { ...s }), 'Sınırlar kaydedildi.')}>Sınırları Kaydet</button></>}</>;
}
