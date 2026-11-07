import { useEffect, useState } from 'react';
import { istek } from './api';

type Tas = { kimlik: string; ad: string; baz_tarih: string; guncel_tarih: string; gerceklesme_tarihi: string | null; gecikme_nedeni: string | null };
const tr = (s: string | null) => (s ? s.split('-').reverse().join('.') : '-');

/** YG-072: kilometre taşları; baz tarih değişmez, aşımda gecikme nedeni, azaltıcı eylem ve sonraki etki zorunlu. */
export function KilometreTaslari({ dosya }: { dosya: string }) {
  const [l, setL] = useState<Tas[]>([]); const [f, setF] = useState({ ad: '', baz: '' }); const [u, setU] = useState({ kimlik: '', guncel: '', gerceklesme: '', neden: '', eylem: '', etki: '' }); const [m, setM] = useState('');
  const yk = () => istek<Tas[]>(`/dosya/${dosya}/kilometre`).then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, [dosya]);
  const is = (p: Promise<unknown>, ok: string) => void p.then(() => { setM(ok); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Kilometre Taşları</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{l.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}{l.map((x) => <div key={x.kimlik}>{x.ad} · Baz: {tr(x.baz_tarih)} · Güncel: {tr(x.guncel_tarih)}{x.gerceklesme_tarihi ? ` · Gerçekleşti: ${tr(x.gerceklesme_tarihi)}` : ''}{x.gecikme_nedeni ? ` · Gecikme: ${x.gecikme_nedeni}` : ''} <button className="btn2 kucuk" onClick={() => setU({ ...u, kimlik: x.kimlik, guncel: x.guncel_tarih })}>Güncelle</button></div>)}</div>
    <label htmlFor="km-a">Kilometre Taşı</label><input id="km-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
    <label htmlFor="km-b">Baz Tarih</label><input id="km-b" type="date" value={f.baz} onChange={(e) => setF({ ...f, baz: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.ad.trim() || !f.baz} onClick={() => is(istek(`/dosya/${dosya}/kilometre`, f).then(() => setF({ ad: '', baz: '' })), 'Kilometre taşı eklendi.')}>Ekle</button>
    {u.kimlik && <>
      <label htmlFor="km-g">Güncel Tarih</label><input id="km-g" type="date" value={u.guncel} onChange={(e) => setU({ ...u, guncel: e.target.value })} />
      <label htmlFor="km-r">Gerçekleşme Tarihi</label><input id="km-r" type="date" value={u.gerceklesme} onChange={(e) => setU({ ...u, gerceklesme: e.target.value })} />
      <label htmlFor="km-n">Gecikme Nedeni</label><input id="km-n" value={u.neden} onChange={(e) => setU({ ...u, neden: e.target.value })} />
      <label htmlFor="km-e">Azaltıcı Eylem</label><input id="km-e" value={u.eylem} onChange={(e) => setU({ ...u, eylem: e.target.value })} />
      <label htmlFor="km-t">Sonraki Etki</label><input id="km-t" value={u.etki} onChange={(e) => setU({ ...u, etki: e.target.value })} />
      <button className="btn2 kucuk" onClick={() => is(istek(`/kilometre/${u.kimlik}`, { guncel: u.guncel || undefined, gerceklesme: u.gerceklesme || undefined, neden: u.neden || undefined, eylem: u.eylem || undefined, etki: u.etki || undefined }).then(() => setU({ kimlik: '', guncel: '', gerceklesme: '', neden: '', eylem: '', etki: '' })), 'Kilometre taşı güncellendi.')}>Kaydet</button></>}</>;
}
