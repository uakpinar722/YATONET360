import { useEffect, useState } from 'react';
import { istek } from './api';
import { BelgeSec } from './Kalite';

type C = { kimlik: string; cizim_no: string; ad: string; olcek: string; durum: string; revizyon: number; benim: boolean };
/** YG-679: LGM çizim antetli teknik çizim ve kroki; revizyon tablosu ve Teknik Yönetici onayı. */
export function TeknikCizim({ dosya }: { dosya: string }) {
  const [v, setV] = useState<{ hazirlar: boolean; cizimler: C[] } | null>(null); const [m, setM] = useState('');
  const [f, setF] = useState({ ad: '', olcek: '', notlar: '' }); const [belge, setBelge] = useState(''); const [rv, setRv] = useState<Record<string, string>>({});
  const yk = () => void istek<NonNullable<typeof v>>(`/dosya/${dosya}/teknik-cizim`).then(setV).catch(() => setV(null));
  useEffect(yk, [dosya]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v || (!v.hazirlar && !v.cizimler.length)) return null;
  const is = (p: Promise<unknown>, s: string) => void p.then(() => { setM(s); yk(); }).catch((e) => setM(e.message));
  return <details><summary>Teknik Çizimler · {v.cizimler.length}</summary>{m && <div className="not" role="status">{m}</div>}
    {v.cizimler.map((c) => <div className={c.durum === 'Onaylı' ? 'soru' : 'soru hata'} key={c.kimlik}><span>{c.cizim_no} · {c.ad} · Ölçek {c.olcek} · Rev.{c.revizyon} · {c.durum}</span>
      <div className="dugmeler"><a className="btn2 kucuk" href={`/api/teknik-cizim/${c.kimlik}/pdf`} target="_blank" rel="noreferrer">PDF</a>
        {c.benim && c.durum === 'Taslak' && <button className="btn2 kucuk" onClick={() => is(istek(`/teknik-cizim/${c.kimlik}/onaya-gonder`, {}), 'Onaya gönderildi: Teknik Yönetici.')}>Onaya Gönder</button>}
        {v.hazirlar && c.durum === 'Onaylı' && <><label htmlFor={`cz-r-${c.kimlik}`}>Revizyon Açıklaması</label><input id={`cz-r-${c.kimlik}`} value={rv[c.kimlik] ?? ''} onChange={(e) => setRv({ ...rv, [c.kimlik]: e.target.value })} />
          <button className="btn2 kucuk" onClick={() => is(istek(`/teknik-cizim/${c.kimlik}/revizyon`, { aciklama: rv[c.kimlik] }), 'Yeni revizyon taslak olarak açıldı.')}>Revizyon Aç</button></>}</div></div>)}
    {v.hazirlar && <div className="izgara"><b>Yeni Çizim</b>
      <label htmlFor="cz-ad">Çizim Adı</label><input id="cz-ad" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
      <label htmlFor="cz-o">Ölçek</label><input id="cz-o" placeholder="ör. 1:20 veya Ölçeksiz" value={f.olcek} onChange={(e) => setF({ ...f, olcek: e.target.value })} />
      <BelgeSec ad="Çizim Görseli (PNG/JPG)" bagTuru="Dosya" bagKimligi={dosya} deger={belge} sec={setBelge} />
      <label htmlFor="cz-n">Genel Notlar</label><textarea id="cz-n" value={f.notlar} onChange={(e) => setF({ ...f, notlar: e.target.value })} />
      <button className="btn kucuk" onClick={() => is(istek(`/dosya/${dosya}/teknik-cizim`, { ...f, belge }).then(() => { setF({ ad: '', olcek: '', notlar: '' }); setBelge(''); }), 'Çizim taslak olarak kaydedildi.')}>Kaydet</button></div>}</details>;
}
