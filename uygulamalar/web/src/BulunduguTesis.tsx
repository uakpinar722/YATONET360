import { useEffect, useState } from 'react';
import { istek } from './api';
import { tarih } from './bicim';

/** YG-331: yatın bulunduğu tesis; dış firma kuralı ve işletme izni iş emri uyarılarına bağlanır. */
export function BulunduguTesis({ id }: { id: string }) {
  type T = { kimlik: string; ad: string; il?: string | null };
  const [v, setV] = useState<{ secili: { kimlik: string; ad: string; kural: string | null; izinTuru: string | null; izinGecerlilik: string | null } | null; oneri: T[]; tesisler: T[] } | null>(null);
  const [s, setS] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>(`/dosya/${id}/bulundugu-tesis`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [id]);
  if (!v) return null;
  const liste = [...v.oneri, ...v.tesisler.filter((x) => !v.oneri.some((o) => o.kimlik === x.kimlik))];
  return <details><summary>Yatın Bulunduğu Tesis{v.secili ? ` · ${v.secili.ad}` : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    {v.secili && <div className={v.secili.kural === 'Yasak' || v.secili.kural === 'Kısıtlı' ? 'uyari' : 'soru'}><span>{v.secili.ad} · Dış firma kuralı: {v.secili.kural ?? 'Girilmemiş'} · İşletme izni: {v.secili.izinTuru ? `${v.secili.izinTuru}${v.secili.izinGecerlilik ? ` (${tarih(v.secili.izinGecerlilik)})` : ''}` : 'Kayıtlı değil'}</span></div>}
    <label htmlFor={`bt-${id}`}>Tesis{v.oneri.length ? ' (konumdan öneriler üstte)' : ''}</label>
    <select id={`bt-${id}`} value={s} onChange={(e) => setS(e.target.value)}><option value="">Seçiniz</option>{liste.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad}{x.il ? ` · ${x.il}` : ''}</option>)}</select>
    <button className="btn2 kucuk" disabled={!s} onClick={() => void istek(`/dosya/${id}/bulundugu-tesis`, { tesis: s }).then(() => { setM('Yatın bulunduğu tesis kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button>
  </details>;
}
