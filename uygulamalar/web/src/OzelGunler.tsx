import { useEffect, useState } from 'react';
import { istek } from './api';

const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const gunYaz = (g: string) => `${Number(g.slice(3))} ${AY[Number(g.slice(0, 2)) - 1]}`;
/** YG-1633: Özel Günler kutusu; yalnız rıza veren personel, yaş ve yıl yok. */
export function OzelGunler() {
  const [v, setV] = useState<{ liste: { ad: string; gun: string; tur: string }[]; dogumGunuGirebilir: boolean; dogumGunu: string | null } | null>(null); const [g, setG] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/ozel-gunler').then((x) => { setV(x); setG(x.dogumGunu ?? ''); }).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v || (!v.liste.length && !v.dogumGunuGirebilir)) return null;
  return <><div className="bolum">Özel Günler</div>
    {v.liste.length ? v.liste.map((x, i) => <div className="soru" key={i}><span>{gunYaz(x.gun)} · {x.ad} · {x.tur}</span></div>) : <div className="ozet bos">Önümüzdeki 7 günde özel gün bulunmamaktadır.</div>}
    {v.dogumGunuGirebilir && <details><summary>Doğum Günüm</summary>{m && <div className="not" role="status">{m}</div>}
      <label htmlFor="og-ay">Ay</label><select id="og-ay" value={g.slice(0, 2)} onChange={(e) => setG(`${e.target.value}-${g.slice(3) || '01'}`)}><option value="">Seçiniz</option>{AY.map((a, i) => <option key={a} value={String(i + 1).padStart(2, '0')}>{a}</option>)}</select>
      <label htmlFor="og-gun">Gün</label><select id="og-gun" value={g.slice(3)} onChange={(e) => setG(`${g.slice(0, 2) || '01'}-${e.target.value}`)}><option value="">Seçiniz</option>{Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => <option key={d} value={d}>{Number(d)}</option>)}</select>
      <button className="btn2 kucuk" onClick={() => void istek('/ozel-gunler/dogum-gunu', { gun: g }).then(() => { setM('Kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></details>}</>;
}
