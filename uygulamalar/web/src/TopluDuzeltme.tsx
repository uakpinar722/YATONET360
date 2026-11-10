import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kimlik: string; kapsam: string; veri_kumesi: string; beklenen_kayit: number; gerceklesen_kayit: number | null; durum: string; betik_surumu: string };
const ETKI: [string, string][] = [['rapor', 'Rapor'], ['bildirim', 'Bildirim'], ['onay', 'Onay'], ['fatura', 'Fatura'], ['disSistem', 'Dış Sistem']];
/** YG-1247, YG-1248: toplu veri düzeltme kaydı ve etki uzlaştırması. */
export function TopluDuzeltme() {
  const [v, setV] = useState<{ hazirlar: boolean; kayitlar: K[] } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/toplu-duzeltme').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  const al = (k: string, et: string) => <span key={k}><label htmlFor={`td-${k}`}>{et}</label><input id={`td-${k}`} value={g[k] ?? ''} onChange={(e) => setG({ ...g, [k]: e.target.value })} /></span>;
  return <details><summary>Toplu Veri Düzeltme</summary>{m && <div className="not" role="status">{m}</div>}
    {v.kayitlar.map((x) => <div className="soru" key={x.kimlik}><span>{x.veri_kumesi} · {x.kapsam} · {x.beklenen_kayit} kayıt{x.gerceklesen_kayit !== null ? ` / ${x.gerceklesen_kayit}` : ''} · {x.betik_surumu} · {x.durum}</span>
      {v.hazirlar && x.durum === 'Onaylandı' && <div className="tam">{al(`g${x.kimlik}`, 'Gerçekleşen Kayıt')}{al(`s${x.kimlik}`, 'Sonuç Kontrolü')}{al(`f${x.kimlik}`, 'Fark Açıklaması')}<button className="btn2 kucuk" onClick={() => is(istek(`/toplu-duzeltme/${x.kimlik}/uygulandi`, { gerceklesen: Number(g[`g${x.kimlik}`]), sonucKontrol: g[`s${x.kimlik}`], farkAciklamasi: g[`f${x.kimlik}`] }), 'Uygulama kaydedildi.')}>Uygulandı</button></div>}
      {v.hazirlar && x.durum === 'Uygulandı' && <div className="tam">{ETKI.map(([k, et]) => <span key={k}><label htmlFor={`te-${k}-${x.kimlik}`}>{et}</label><select id={`te-${k}-${x.kimlik}`} value={g[`${k}${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`${k}${x.kimlik}`]: e.target.value })}><option value="">Seçiniz</option><option>Etkilenmedi</option><option>Uzlaştırıldı</option></select></span>)}<button className="btn2 kucuk" onClick={() => is(istek(`/toplu-duzeltme/${x.kimlik}/kapat`, { etkiler: Object.fromEntries(ETKI.map(([k]) => [k, g[`${k}${x.kimlik}`]])) }), 'Düzeltme kapandı.')}>Kapat</button></div>}</div>)}
    {v.hazirlar && <>{al('veriKumesi', 'Veri Kümesi')}{al('kapsam', 'Kapsam')}{al('gerekce', 'Gerekçe')}{al('ornek', 'Örnek Doğrulama')}{al('yedek', 'Yedek Kimliği')}{al('betikSurumu', 'Betik Sürümü')}{al('betikOzeti', 'Betik SHA-256')}{al('beklenen', 'Beklenen Kayıt Sayısı')}
      <button className="btn2 kucuk" onClick={() => is(istek('/toplu-duzeltme', { ...g, beklenen: Number(g.beklenen) }), 'Onaya gönderildi.')}>Onaya Gönder</button></>}</details>;
}
