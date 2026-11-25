import { useEffect, useState } from 'react';
import { istek } from './api';

type A = { model: string; marka: string; ad: string; benzerlik: number };
type S = { katalog_seri: number; katalog_no: number; katalog_adi: string; adaylar: A[]; sonuc: string; teyit_notu: string | null; marka: string | null; model: string | null };

/** YG-1537: ad farkı teyit listesi; katalog kaydı ile ana veri modeli yan yana; teyit edilince katalog seri/no modele bağlanır, durum kendiliğinden güncellenir. */
export function AdFarki() {
  const [l, setL] = useState<S[] | null>(null); const [m, setM] = useState('');
  const [f, setF] = useState<Record<string, { model?: string; not?: string; marka?: string; q?: string; bul?: { kimlik: string; model: string }[] }>>({});
  const yk = () => istek<S[]>('/ana-veri/ad-farki').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l || !l.length) return null;
  const k = (x: S) => `${x.katalog_seri}-${x.katalog_no}`;
  const set = (x: S, v: Record<string, unknown>) => setF({ ...f, [k(x)]: { ...f[k(x)], ...v } });
  const teyit = (x: S, eslesmeYok = false) => void istek(`/ana-veri/ad-farki/${x.katalog_seri}/${x.katalog_no}`, { model: f[k(x)]?.model, not: f[k(x)]?.not, eslesmeYok }).then(() => { setM(eslesmeYok ? 'Eşleşme yok olarak kaydedildi.' : 'Katalog kaydı modele bağlandı.'); return yk(); }).catch((e) => setM(e.message));
  const ara = (x: S) => void istek<{ kimlik: string; model: string }[]>(`/yat/model?marka=${encodeURIComponent(f[k(x)]?.marka ?? '')}&q=${encodeURIComponent(f[k(x)]?.q ?? '')}`).then((r) => set(x, { bul: r.slice(0, 20) })).catch((e) => setM(e.message));
  return <details><summary>Katalog Ad Farkı Teyidi ({l.filter((x) => x.sonuc === 'Teyit Bekliyor').length} bekleyen)</summary>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => { const s = f[k(x)] ?? {}; return <div key={k(x)} className={x.sonuc === 'Teyit Bekliyor' ? 'ozet kart-sol' : 'soru'}>
      <b>Katalog: Seri {x.katalog_seri} · {String(x.katalog_no).padStart(4, '0')} · {x.katalog_adi}</b>
      {x.sonuc !== 'Teyit Bekliyor' ? <div>{x.sonuc}{x.marka ? ` · Ana veri: ${x.marka} ${x.model}` : ''}{x.teyit_notu ? ` · ${x.teyit_notu}` : ''}</div> : <>
        {x.adaylar.length === 0 && <div className="not">Sistem aday önermedi; modeli arayarak seçiniz.</div>}
        {x.adaylar.map((a) => <label key={a.model} className="kutu"><input type="radio" name={`af-${k(x)}`} checked={s.model === a.model} onChange={() => set(x, { model: a.model })} /><span>Ana veri: {a.marka} · {a.ad} (benzerlik %{Math.round(a.benzerlik * 100)})</span></label>)}
        <div className="iki-tarih"><div><label htmlFor={`af-m-${k(x)}`}>Ana Veri Markası</label><input id={`af-m-${k(x)}`} value={s.marka ?? ''} onChange={(e) => set(x, { marka: e.target.value })} /></div><div><label htmlFor={`af-q-${k(x)}`}>Ana Veri Modeli Ara</label><input id={`af-q-${k(x)}`} value={s.q ?? ''} onChange={(e) => set(x, { q: e.target.value })} /></div></div>
        <button className="btn2 kucuk" disabled={!s.marka?.trim()} onClick={() => ara(x)}>Modeli Ara</button>
        {s.bul?.map((b) => <label key={b.kimlik} className="kutu"><input type="radio" name={`af-${k(x)}`} checked={s.model === b.kimlik} onChange={() => set(x, { model: b.kimlik })} /><span>{s.marka} · {b.model}</span></label>)}
        <label htmlFor={`af-n-${k(x)}`}>Ad Farkı Teyit Notu</label><input required id={`af-n-${k(x)}`} value={s.not ?? ''} onChange={(e) => set(x, { not: e.target.value })} />
        <div className="dugmeler"><button className="btn2 kucuk" disabled={!s.model || !s.not?.trim()} onClick={() => teyit(x)}>Eşleştir</button><button className="btn2 kucuk" disabled={!s.not?.trim()} onClick={() => teyit(x, true)}>Eşleşme Yok</button></div>
      </>}</div>; })}
  </details>;
}
