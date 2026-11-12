import { useEffect, useState } from 'react';
import { istek } from './api';
import { GenelForm } from './GenelForm';

type K = { kod: string; ad: string; sinif: string; bicim: string; dolduran: string | null; onaylayan: string | null; goren: string | null; kanal: string | null; sistem_karsiligi: string | null; yerine: string | null; surum: number; yururluk_tarihi: string | null; durum: string; iptal_gerekcesi: string | null };
type A = { kod: string; ad: string; dolduran: string | null; onaylayan: string | null; alanlar: { alan: string; tur: string; bicim: string; zorunlu: string; liste: string }[] };
const BOS = { kod: '', ad: '', sinif: 'İç', bicim: 'Ekran adımı', dolduran: '', onaylayan: '', goren: '' };
/** YG-601, YG-632, YG-633: Ek II belge kataloğu (FR-RAP-002'nin yerini alan sistem tablosu). */
export function FormKatalogu() {
  const [v, setV] = useState<{ yonetir: boolean; kalemler: K[] } | null>(null); const [ara, setAra] = useState(''); const [a, setA] = useState<A | null>(null);
  const [f, setF] = useState(BOS); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => void istek<NonNullable<typeof v>>(`/form-katalogu?ara=${encodeURIComponent(ara)}`).then(setV).catch(() => setV(null));
  useEffect(() => { const t = setTimeout(yk, 250); return () => clearTimeout(t); }, [ara]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return null;
  const is = (p: Promise<unknown>, s: string) => void p.then(() => { setM(s); setG({}); yk(); }).catch((e) => setM(e.message));
  const say = (d: string) => v.kalemler.filter((x) => x.durum === d).length;
  const bagsiz = v.kalemler.filter((x) => x.durum !== 'İptal' && !x.sistem_karsiligi).length;
  return <details><summary>Belge Kataloğu (Ek II) · {say('Yürürlükte')} yürürlükte · {say('Taslak')} taslak · {say('İptal')} iptal{bagsiz ? ` · ${bagsiz} sistem karşılığı bekliyor` : ''}</summary>
    {m && <div className="not" role="status">{m}</div>}
    <div className="not">Taslak veya iptal edilmiş araç yeni kayıtta seçilemez; iptal edilen kod yeniden verilmez. Doldurulmuş kayıtlar yeni sürümle geriye dönük değişmez.</div>
    <label htmlFor="fk-ara">Kod veya ad ara</label><input id="fk-ara" value={ara} onChange={(e) => setAra(e.target.value)} />
    {v.kalemler.map((x) => <div className={x.durum === 'Yürürlükte' ? 'soru' : x.durum === 'İptal' ? 'soru bos' : 'soru hata'} key={x.kod}>
      <span><b>{x.kod}</b> · {x.ad} · {x.sinif} · {x.bicim} · Sürüm {x.surum} · {x.durum}{x.yerine ? ` → ${x.yerine}` : ''}{x.durum !== 'İptal' ? ` · Sistem: ${x.sistem_karsiligi ?? 'bekliyor'}` : ''}<br />
        <small>Dolduran: {x.dolduran ?? '—'} · Onaylayan: {x.onaylayan ?? '—'}</small></span>
      <div className="tam"><button className="btn2 kucuk" onClick={() => void istek<A>(`/form-katalogu/${x.kod}/alanlar`).then(setA).catch((e) => setM(e.message))}>Alanlar</button>{x.durum !== 'İptal' && <a className="btn2 kucuk" href={`/api/form-katalogu/${x.kod}/bos.pdf`} target="_blank" rel="noreferrer">Boş Şablon</a>}
        {v.yonetir && x.durum !== 'İptal' && <><label htmlFor={`fk-g-${x.kod}`}>Gerekçe</label><input id={`fk-g-${x.kod}`} value={g[x.kod] ?? ''} onChange={(e) => setG({ ...g, [x.kod]: e.target.value })} />
          {x.durum === 'Taslak' && <button className="btn2 kucuk" onClick={() => is(istek(`/form-katalogu/${x.kod}/durum`, { durum: 'Yürürlükte' }), 'Yürürlüğe alındı.')}>Yürürlüğe Al</button>}
          {x.durum === 'Yürürlükte' && <button className="btn2 kucuk" onClick={() => is(istek(`/form-katalogu/${x.kod}/durum`, { durum: 'Yeni Sürüm', gerekce: g[x.kod] }), 'Yeni sürüm taslak olarak açıldı.')}>Yeni Sürüm</button>}
          <button className="btn2 kucuk" onClick={() => is(istek(`/form-katalogu/${x.kod}/durum`, { durum: 'İptal', gerekce: g[x.kod] }), 'İptal edildi; kod yeniden verilmez.')}>İptal Et</button></>}</div>
      {a?.kod === x.kod && <div className="tam">{a.alanlar.length ? a.alanlar.map((l) => <div className="not" key={l.alan}>{l.alan} · {l.tur}{l.bicim ? ` · ${l.bicim}` : ''} · {l.zorunlu}{l.liste ? ` · ${l.liste}` : ''}</div>) : <div className="not">Alan sözlüğünde bu araca bağlı alan yok.</div>}</div>}</div>)}
    <GenelForm />
    {v.yonetir && <div className="izgara"><b>Yeni Araç (taslak doğar)</b>
      {(['kod', 'ad', 'dolduran', 'onaylayan', 'goren'] as const).map((k) => <div key={k}><label htmlFor={`fk-y-${k}`}>{{ kod: 'Kod', ad: 'Ad', dolduran: 'Dolduran', onaylayan: 'Onaylayan', goren: 'Gören' }[k]}</label><input id={`fk-y-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
      <div><label htmlFor="fk-y-sinif">Sınıf</label><select id="fk-y-sinif" value={f.sinif} onChange={(e) => setF({ ...f, sinif: e.target.value })}>{['İç', 'Dışa', 'Firmaya', 'Firmadan'].map((s) => <option key={s}>{s}</option>)}</select></div>
      <div><label htmlFor="fk-y-bicim">Biçim</label><select id="fk-y-bicim" value={f.bicim} onChange={(e) => setF({ ...f, bicim: e.target.value })}>{['Ekran adımı', 'A4 belge', 'Bildirim', 'Yüklenen belge'].map((s) => <option key={s}>{s}</option>)}</select></div>
      <button className="btn kucuk" onClick={() => is(istek('/form-katalogu', f).then(() => setF(BOS)), 'Taslak araç eklendi.')}>Ekle</button></div>}</details>;
}
