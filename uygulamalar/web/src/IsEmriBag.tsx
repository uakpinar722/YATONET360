import { useEffect, useState } from 'react';
import { istek } from './api';

type Secenek = { kimlik: string; is_emri_no: string; statu: string; firma: string };

/** YG-384 (PKT-1: iş paketi = iş emri): kaydın bağlanacağı iş emri; boş bırakılırsa kayıt dosya düzeyinde kalır. */
export function IsEmriSec({ dosya, deger, degisti, kimlik }: { dosya: string; deger: string; degisti: (v: string) => void; kimlik: string }) {
  const [l, setL] = useState<Secenek[]>([]);
  useEffect(() => { void istek<Secenek[]>(`/dosya/${dosya}/is-emri-secenekleri`).then(setL).catch(() => setL([])); }, [dosya]);
  if (!l.length) return null;
  return <><label htmlFor={kimlik}>İş Emri</label><select id={kimlik} value={deger} onChange={(e) => degisti(e.target.value)}>
    <option value="">Dosya geneli (iş emrine bağlı değil)</option>{l.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.is_emri_no} · {x.firma} · {x.statu}</option>)}
  </select></>;
}

type Satir = { kimlik: string; no?: string; ad?: string; durum?: string | null; sonuc?: string | null; sinir_disi?: boolean };
type Iz = Record<'kontrolNoktalari' | 'olcumler' | 'testler' | 'parcalar' | 'sokulenParcalar' | 'siparisler' | 'uygunsuzluklar' | 'sapmalar' | 'kabuller', Satir[]>;
const BASLIK: [keyof Iz, string][] = [['kontrolNoktalari', 'Kontrol Noktaları'], ['olcumler', 'Ölçümler'], ['testler', 'Testler'], ['parcalar', 'Parça Girişleri'], ['sokulenParcalar', 'Sökülen Parçalar'], ['siparisler', 'Tedarik Siparişleri'], ['uygunsuzluklar', 'Uygunsuzluklar'], ['sapmalar', 'Sapmalar'], ['kabuller', 'Kabul Kayıtları']];

/** YG-004, YG-384: iş emrine bağlı kayıtların tek görünümü. */
export function Izlenebilirlik({ isEmri }: { isEmri: string }) {
  const [v, setV] = useState<Iz | null>(null); const [h, setH] = useState('');
  return <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !v) void istek<Iz>(`/is-emri/${isEmri}/izlenebilirlik`).then(setV).catch((x) => setH(x.message)); }}><summary>İzlenebilirlik</summary>
    {h && <div className="hata" role="alert">{h}</div>}
    {v && BASLIK.map(([k, b]) => <div key={k}><b>{b}</b>: {v[k].length ? v[k].map((x) => [x.no, x.ad, x.durum ?? x.sonuc, x.sinir_disi ? 'Sınır Dışı' : null].filter(Boolean).join(' · ')).join('; ') : 'Kayıt yok'}</div>)}
  </details>;
}
