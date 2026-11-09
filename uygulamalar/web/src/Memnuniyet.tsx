import { useEffect, useState } from 'react';
import { istek } from './api';

const E = { tr: { b: 'Memnuniyet Anketi', g: 'Genel Memnuniyet', i: 'İletişim', k: 'İş Kalitesi', y: 'Yorum (isteğe bağlı)', d: 'Gönder', t: 'Teşekkür ederiz.' }, en: { b: 'Satisfaction Survey', g: 'Overall Satisfaction', i: 'Communication', k: 'Quality of Work', y: 'Comment (optional)', d: 'Submit', t: 'Thank you.' } };

/** YG-1470: 3 soru (1–5) ve isteğe bağlı yorum; giriş gerektirmez, firma adı yer almaz. */
export function Anket({ belirtec }: { belirtec: string }) {
  const [v, setV] = useState<{ dil: 'tr' | 'en'; yanitlandi: boolean } | null>(null); const [p, setP] = useState<Record<string, number>>({}); const [yorum, setYorum] = useState(''); const [m, setM] = useState(''); const [bitti, setBitti] = useState(false); const [yok, setYok] = useState(false);
  useEffect(() => { void istek<NonNullable<typeof v>>(`/anket/${belirtec}`).then(setV).catch(() => setYok(true)); }, [belirtec]);
  if (yok) return <div className="kart"><div className="not" role="alert">—</div></div>;
  if (!v) return null;
  const e = E[v.dil];
  if (bitti || v.yanitlandi) return <div className="kart"><h1>{e.b}</h1><div className="not" role="status">{e.t}</div></div>;
  const S = (a: string, et: string) => <fieldset key={a}><legend>{et}</legend>{[1, 2, 3, 4, 5].map((n) => <label key={n}><input type="radio" name={a} checked={p[a] === n} onChange={() => setP({ ...p, [a]: n })} /> {n}</label>)}</fieldset>;
  return <div className="kart"><h1>{e.b}</h1>{m && <div className="not" role="alert">{m}</div>}
    {S('genel', e.g)}{S('iletisim', e.i)}{S('isKalitesi', e.k)}
    <label htmlFor="an-y">{e.y}</label><textarea id="an-y" rows={3} value={yorum} onChange={(x) => setYorum(x.target.value)} />
    <button className="btn2" disabled={Object.keys(p).length < 3} onClick={() => void istek(`/anket/${belirtec}`, { ...p, yorum: yorum || undefined }).then(() => setBitti(true)).catch((x) => setM(x.message))}>{e.d}</button></div>;
}

type G = { kimlik: string; dosya_no: string; genel: number; iletisim: number; is_kalitesi: number; yorum: string | null };
/** K-203: 2 veya altı puanda Müşteri ve Paydaş İlişkileri Müdürü arar, sonucu kaydeder. */
export function MemnuniyetGorusme() {
  const [l, setL] = useState<G[] | null>(null); const [s, setS] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<G[]>('/anket-gorusme').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l?.length) return null;
  return <><div className="bolum">Memnuniyet Görüşmeleri</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div className="soru" key={x.kimlik}><span>{x.dosya_no} · Genel {x.genel} · İletişim {x.iletisim} · İş Kalitesi {x.is_kalitesi}{x.yorum ? ` · ${x.yorum}` : ''}</span><div className="tam"><label htmlFor={`mg-${x.kimlik}`}>Görüşme Sonucu</label><input id={`mg-${x.kimlik}`} value={s[x.kimlik] ?? ''} onChange={(e) => setS({ ...s, [x.kimlik]: e.target.value })} /><button className="btn2 kucuk" disabled={!s[x.kimlik]?.trim()} onClick={() => void istek(`/anket-gorusme/${x.kimlik}`, { sonuc: s[x.kimlik] }).then(() => { setM('Görüşme kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></div></div>)}</>;
}

type B = { rol: string; bloklar: { t: 'b' | 'a' | 'm'; m: string }[] };
/** YG-973: Görev Tanımım. */
export function GorevTanimim() {
  const [l, setL] = useState<B[]>([]);
  useEffect(() => { void istek<B[]>('/gorev-tanimim').then(setL).catch(() => setL([])); }, []);
  if (!l.length) return null;
  return <>{l.map((r) => <details key={r.rol}><summary>Görev Tanımım · {r.rol}</summary>{r.bloklar.map((x, n) => (x.t === 'b' ? <div className="bolum" key={n}>{x.m}</div> : x.t === 'a' ? <b key={n}>{x.m}</b> : <p key={n}>{x.m}</p>))}</details>)}</>;
}
