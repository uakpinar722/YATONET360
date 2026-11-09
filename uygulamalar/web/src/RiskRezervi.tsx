import { useEffect, useState } from 'react';
import { istek } from './api';

type B = { temelCizgi: number; guncelButce: number; gerceklesen: number; acikTaahhut: number; bitisTahmini: number; bekleyenDegisiklik: number; rezervOrani: number; rezerv: number; rezervKullanilan: number; rezervKalan: number };
type V = { butce: B | null; talepAcabilir: boolean; talepler: { kimlik: string; tur: string; tutar_eur: string | null; yeni_oran: string | null; durum: string }[] };
const eur = (x: number) => `${x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;

/** YG-862, YG-863: dosya iç bütçesi ve risk rezervi; tutarlar yalnız maliyet görebilen rollere görünür. */
export function RiskRezervi({ dosya }: { dosya: string }) {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ tur: 'Kullanım', tutar: '', oran: '', gerekce: '' }); const [m, setM] = useState('');
  const yk = () => istek<V>(`/dosya/${dosya}/risk-rezervi`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!v || (!v.butce && !v.talepAcabilir)) return null;
  const b = v.butce;
  const gonder = () => void istek(`/dosya/${dosya}/risk-rezervi`, { tur: f.tur, gerekce: f.gerekce, tutar: f.tur === 'Kullanım' ? f.tutar.replace(',', '.') : undefined, oran: f.tur === 'Kullanım' ? undefined : Number(f.oran.replace(',', '.')) / 100 }).then(() => { setM('Talep onaya gönderildi.'); setF({ ...f, tutar: '', oran: '', gerekce: '' }); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">İç Bütçe ve Risk Rezervi</div>{m && <div className="not" role="status">{m}</div>}
    {b && <div className="ozet"><div>Temel Çizgi: {eur(b.temelCizgi)}</div><div>Güncel Bütçe: {eur(b.guncelButce)}</div><div>Gerçekleşen: {eur(b.gerceklesen)}</div><div>Açık Taahhüt: {eur(b.acikTaahhut)}</div><div>Bitiş Tahmini: {eur(b.bitisTahmini)}</div><div>Bekleyen Değişiklik (kesinleşmedi): {eur(b.bekleyenDegisiklik)}</div><div>Risk Rezervi (%{(b.rezervOrani * 100).toLocaleString('tr-TR')}): {eur(b.rezerv)} · Kullanılan: {eur(b.rezervKullanilan)} · Kalan: {eur(b.rezervKalan)}</div></div>}
    <div className="ozet">{v.talepler.map((x) => <div key={x.kimlik}>{x.tur}{b && x.tutar_eur ? ` · ${eur(Number(x.tutar_eur))}` : ''}{x.yeni_oran ? ` · %${(Number(x.yeni_oran) * 100).toLocaleString('tr-TR')}` : ''} · {x.durum}</div>)}</div>
    {v.talepAcabilir && <>
      <label htmlFor="rr-t">Talep Türü</label><select id="rr-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}><option>Kullanım</option><option>Oran Değişikliği</option></select>
      {f.tur === 'Kullanım' ? <><label htmlFor="rr-u">Tutar (EUR)</label><input id="rr-u" inputMode="decimal" value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} /></> : <><label htmlFor="rr-o">Yeni Oran (%)</label><input id="rr-o" inputMode="decimal" value={f.oran} onChange={(e) => setF({ ...f, oran: e.target.value })} /></>}
      <label htmlFor="rr-g">Gerekçe</label><input id="rr-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
      <button className="btn2 kucuk" disabled={!f.gerekce.trim()} onClick={gonder}>Risk Rezervi Talebi Aç</button></>}</>;
}
