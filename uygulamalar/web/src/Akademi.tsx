import { useEffect, useState } from 'react';
import { istek } from './api';

type D = { kimlik: string; ad: string; tur: string; icerik: string; surum: number; degisiklik_notu: string | null; beyan: boolean };
type V = { ik: boolean; dersler: D[]; izleme: { kimlik: string; ad: string; surum: number; beyan: number; hedef: number }[] };

/** YG-937, YG-938, YG-943: ders listesi, okudum ve katılım beyanı; imza alınmaz. */
export function Akademi() {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ ad: '', tur: 'Zorunlu', icerik: '', roller: '' }); const [rv, setRv] = useState({ ders: '', icerik: '', degisiklik: '' }); const [m, setM] = useState('');
  const yk = () => istek<V>('/akademi').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Akademi</div>{m && <div className="not" role="status">{m}</div>}
    {v.dersler.map((d) => <details key={d.kimlik}><summary>{d.ad} · {d.tur}{d.beyan ? ' · Tamamlandı' : ''}</summary>{d.degisiklik_notu && <p><b>Ne Değişti:</b> {d.degisiklik_notu}</p>}<p>{d.icerik}</p>{!d.beyan && <button className="btn2 kucuk" onClick={() => is(istek(`/akademi/ders/${d.kimlik}/beyan`, {}), 'Beyanınız kaydedildi.')}>Okudum, Katıldım</button>}</details>)}
    {v.ik && <><div className="ozet">{v.izleme.map((x) => <div key={x.kimlik}>{x.ad} · Sürüm {x.surum} · {x.beyan} / {x.hedef}</div>)}</div>
      <label htmlFor="ak-a">Ders Adı</label><input id="ak-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
      <label htmlFor="ak-t">Tür</label><select id="ak-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}><option>Zorunlu</option><option>Oryantasyon</option><option>Rol Müfredatı</option></select>
      <label htmlFor="ak-r">Roller (virgülle; boşsa tüm personel)</label><input id="ak-r" value={f.roller} onChange={(e) => setF({ ...f, roller: e.target.value })} />
      <label htmlFor="ak-i">İçerik</label><textarea id="ak-i" rows={4} value={f.icerik} onChange={(e) => setF({ ...f, icerik: e.target.value })} />
      <button className="btn2 kucuk" disabled={!f.ad.trim() || !f.icerik.trim()} onClick={() => is(istek('/akademi/ders', { ad: f.ad, tur: f.tur, icerik: f.icerik, roller: f.roller.split(',').map((x) => x.trim()).filter(Boolean) }).then(() => setF({ ad: '', tur: 'Zorunlu', icerik: '', roller: '' })), 'Ders eklendi.')}>Ders Ekle</button>
      <label htmlFor="ak-rv">Revize Edilecek Ders</label><select id="ak-rv" value={rv.ders} onChange={(e) => setRv({ ...rv, ders: e.target.value })}><option value="">Seçiniz</option>{v.izleme.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad}</option>)}</select>
      <label htmlFor="ak-ri">Yeni İçerik</label><textarea id="ak-ri" rows={3} value={rv.icerik} onChange={(e) => setRv({ ...rv, icerik: e.target.value })} />
      <label htmlFor="ak-rd">Ne Değişti</label><input id="ak-rd" value={rv.degisiklik} onChange={(e) => setRv({ ...rv, degisiklik: e.target.value })} />
      <button className="btn2 kucuk" disabled={!rv.ders || !rv.icerik.trim() || !rv.degisiklik.trim()} onClick={() => is(istek(`/akademi/ders/${rv.ders}/revize`, { icerik: rv.icerik, degisiklik: rv.degisiklik }).then(() => setRv({ ders: '', icerik: '', degisiklik: '' })), 'Revizyon yayımlandı.')}>Revizyonu Yayımla</button></>}</>;
}

type B = { personel: string; bitis: string; ad: string };
/** YG-970: deneme süresi değerlendirmesini ilk amir hazırlar. */
export function DenemeDegerlendirme() {
  const [l, setL] = useState<B[]>([]); const [f, setF] = useState<Record<string, { oneri: string; notlar: string }>>({}); const [m, setM] = useState('');
  const yk = () => istek<B[]>('/deneme/bekleyen').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length) return null;
  return <><div className="bolum">Deneme Süresi Değerlendirmeleri</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => { const a = f[x.personel] ?? { oneri: 'Devam', notlar: '' }; return <div className="soru" key={x.personel}><span>{x.ad} · Bitiş: {x.bitis.split('-').reverse().join('.')}</span><div className="tam"><label htmlFor={`dn-o-${x.personel}`}>Öneri</label><select id={`dn-o-${x.personel}`} value={a.oneri} onChange={(e) => setF({ ...f, [x.personel]: { ...a, oneri: e.target.value } })}><option>Devam</option><option>Sonlandırma</option></select><label htmlFor={`dn-n-${x.personel}`}>Değerlendirme Notu</label><input id={`dn-n-${x.personel}`} value={a.notlar} onChange={(e) => setF({ ...f, [x.personel]: { ...a, notlar: e.target.value } })} /><button className="btn2 kucuk" disabled={!a.notlar.trim()} onClick={() => void istek(`/deneme/${x.personel}/hazirla`, a).then(() => { setM('Değerlendirme silsileye gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></div></div>; })}</>;
}
