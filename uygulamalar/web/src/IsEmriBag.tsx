import { useEffect, useState } from 'react';
import { istek, kuyrukSayisi } from './api';

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

/** YG-925, TZ-2: Ticari Sorumlu "Ticari Serbest Bırakma" adımını Beklemede işaretiyle bekletir; işaret açıkken proforma hazırlanmaz. */
export function TicariBekletme({ dosya, yap }: { dosya: string; yap: (f: () => Promise<unknown>, tamam?: string) => unknown }) {
  const [f, setF] = useState({ neden: 'Sigorta Onayı', hedefTarih: '', mesaj: '' });
  return <details><summary>Ticari Serbest Bırakmayı Beklet</summary>
    <label htmlFor={`tb-n-${dosya}`}>Bekleme Nedeni</label><select id={`tb-n-${dosya}`} value={f.neden} onChange={(e) => setF({ ...f, neden: e.target.value })}>{['Sigorta Onayı', 'Ödeme', 'Girdi Bekleniyor', 'Yetki Bekleniyor'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor={`tb-h-${dosya}`}>Hedef Tarih</label><input id={`tb-h-${dosya}`} type="date" value={f.hedefTarih} onChange={(e) => setF({ ...f, hedefTarih: e.target.value })} />
    <label htmlFor={`tb-m-${dosya}`}>Açıklama (İsteğe Bağlı)</label><input id={`tb-m-${dosya}`} value={f.mesaj} onChange={(e) => setF({ ...f, mesaj: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.hedefTarih} onClick={() => void yap(() => istek(`/dosya/${dosya}/ticari-bekletme`, f), 'Ticari serbest bırakma beklemeye alındı.')}>Beklemeye Al</button>
  </details>;
}

/** TZ-1: bu tarayıcıda sistem açılınca gönderilmek üzere bekleyen kayıt sayısı. */
export function KuyrukGostergesi() {
  const [n, setN] = useState(() => kuyrukSayisi());
  useEffect(() => { const d = (e: Event) => setN(Number((e as CustomEvent).detail ?? kuyrukSayisi())); window.addEventListener('kuyruk-degisti', d); return () => window.removeEventListener('kuyruk-degisti', d); }, []);
  if (!n) return null;
  return <span className="rozet kirmizi" role="status" title="Sistem açılınca sırayla gönderilir">İşlenmeyi bekleyen kayıt: {n}</span>;
}
