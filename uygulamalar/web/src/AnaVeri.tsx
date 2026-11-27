import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kimlik: string; grup: string; no: string; ad: string; il: string | null };
type V = { firmalar: K[]; noktalar: K[] };

/** ANV-1: aktarılan ana verideki olası mükerrer kayıtlar için Sicil kararı. */
export function AnaVeriMukerrer() {
  const [v, setV] = useState<V | null>(null); const [ana, setAna] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>('/ana-veri/mukerrer').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v || (!v.firmalar.length && !v.noktalar.length)) return null;
  const karar = (tur: string, x: K, k: string) => void istek('/ana-veri/mukerrer', { tur, kimlik: x.kimlik, karar: k, ana: k === 'Birleştirildi' ? ana[x.kimlik] : undefined }).then(() => { setM('Karar kaydedildi.'); return yk(); }).catch((e) => setM(e.message));
  const liste = (tur: string, l: K[]) => l.map((x) => <div className="soru" key={x.kimlik}><span>Grup {x.grup} · {x.no} · {x.ad}{x.il ? ` · ${x.il}` : ''}</span>
    <label htmlFor={`am-${x.kimlik}`}>Ana Kayıt</label><select required id={`am-${x.kimlik}`} value={ana[x.kimlik] ?? ''} onChange={(e) => setAna({ ...ana, [x.kimlik]: e.target.value })}><option value="">Seçiniz</option>{l.filter((y) => y.grup === x.grup && y.kimlik !== x.kimlik).map((y) => <option key={y.kimlik} value={y.kimlik}>{y.ad}</option>)}</select>
    <button className="btn2 kucuk" onClick={() => karar(tur, x, 'Ayrı Kayıt')}>Ayrı Kayıt</button><button className="btn2 kucuk" disabled={!ana[x.kimlik]} onClick={() => karar(tur, x, 'Birleştirildi')}>Birleştir</button></div>);
  return <><div className="bolum">Ana Veri Mükerrer Kararları</div>{m && <div className="not" role="status">{m}</div>}{liste('firma', v.firmalar)}{liste('nokta', v.noktalar)}</>;
}

type Aday = { kimlik: string; etiket: string };
type Gecmis = { kimlik: string; tur: string; durum: string; gerekce: string; zaman: string; ana: string; eski: string; tasinan_sayisi: number | null };

/** YG-1244: mükerrer yat, taraf, ekipman, sözleşme ve belge kayıtlarının birleştirilmesi; ana kaydı türün veri sahibi seçer, çelişen alanlar önce gösterilir, geri alınabilir. */
export function KayitBirlestirme() {
  const [gecmis, setGecmis] = useState<Gecmis[] | null>(null); const [turler, setTurler] = useState<{ tur: string; ad: string }[]>([]); const [tur, setTur] = useState(''); const [m, setM] = useState('');
  const [q, setQ] = useState({ ana: '', eski: '' }); const [l, setL] = useState<{ ana: Aday[]; eski: Aday[] }>({ ana: [], eski: [] }); const [sec, setSec] = useState({ ana: '', eski: '' });
  const [on, setOn] = useState<{ celisenAlanlar: { alan: string; ana: unknown; eski: unknown }[] } | null>(null); const [gerekce, setGerekce] = useState('');
  const yk = () => istek<Gecmis[]>('/birlestirme').then(setGecmis).catch(() => setGecmis(null));
  useEffect(() => { void istek<{ tur: string; ad: string }[]>('/birlestirme/turler').then((l) => { setTurler(l); setTur((t) => t || (l[0]?.tur ?? '')); if (l.length) void yk(); }).catch(() => {}); }, []);
  if (!gecmis) return null;
  const ara = (k: 'ana' | 'eski', v: string) => { setQ({ ...q, [k]: v }); setOn(null); if (v.trim().length >= 2) void istek<Aday[]>(`/birlestirme/ara?tur=${tur}&q=${encodeURIComponent(v)}`).then((x) => setL((o) => ({ ...o, [k]: x }))).catch(() => {}); };
  const hata = (e: Error) => setM(e.message);
  return <><div className="bolum">Mükerrer Kayıt Birleştirme</div>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="kb-t">Kayıt Türü</label><select id="kb-t" value={tur} onChange={(e) => { setTur(e.target.value); setSec({ ana: '', eski: '' }); setL({ ana: [], eski: [] }); setOn(null); }}>{turler.map((x) => <option key={x.tur} value={x.tur}>{x.ad}</option>)}</select>
    {(['ana', 'eski'] as const).map((k) => <div key={k}><label htmlFor={`kb-${k}`}>{k === 'ana' ? 'Ana Kayıt (korunacak)' : 'Mükerrer Kayıt'}</label><input id={`kb-${k}`} value={q[k]} onChange={(e) => ara(k, e.target.value)} />
      <select aria-label={k === 'ana' ? 'Ana Kayıt Seçimi' : 'Mükerrer Kayıt Seçimi'} value={sec[k]} onChange={(e) => { setSec({ ...sec, [k]: e.target.value }); setOn(null); }}><option value="">Seçiniz</option>{l[k].map((x) => <option key={x.kimlik} value={x.kimlik}>{x.etiket}</option>)}</select></div>)}
    <button className="btn2 kucuk" disabled={!sec.ana || !sec.eski || sec.ana === sec.eski} onClick={() => void istek<typeof on>(`/birlestirme/onizleme?tur=${tur}&ana=${sec.ana}&eski=${sec.eski}`).then(setOn).catch(hata)}>Çelişen Alanları Göster</button>
    {on && <>{on.celisenAlanlar.length ? on.celisenAlanlar.map((x) => <div key={x.alan}>{x.alan}: Ana {String(x.ana)} · Mükerrer {String(x.eski)}</div>) : <div>Çelişen alan yoktur.</div>}
      <label htmlFor="kb-g">Gerekçe</label><input required id="kb-g" value={gerekce} onChange={(e) => setGerekce(e.target.value)} />
      <button className="btn2 kucuk" disabled={!gerekce.trim()} onClick={() => void istek('/birlestirme', { tur, ana: sec.ana, eski: sec.eski, gerekce }).then(() => { setM('Kayıtlar birleştirildi; mükerrer kayıt ana kayda yönlendirildi.'); setOn(null); setSec({ ana: '', eski: '' }); setGerekce(''); return yk(); }).catch(hata)}>Birleştir</button></>}
    {gecmis.map((x) => <div key={x.kimlik}>{x.tur === 'yat' ? 'Yat' : 'Taraf'} · {x.eski} → {x.ana} · {x.durum} · {x.tasinan_sayisi ?? 0} ilişki · {x.gerekce}
      {x.durum === 'Ana Kayda Bağlandı' && <button className="btn2 kucuk" onClick={() => { const g = window.prompt('Geri alma gerekçesi'); if (g?.trim()) void istek(`/birlestirme/${x.kimlik}/geri-al`, { gerekce: g }).then(() => { setM('Birleştirme geri alındı.'); return yk(); }).catch(hata); }}>Geri Al</button>}</div>)}
  </>;
}
