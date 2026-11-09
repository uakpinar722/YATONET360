import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-1229: aday firma teması ve ilk temas aydınlatması. */
export function AdayTemas({ id }: { id: string }) {
  const [v, setV] = useState<{ aday: boolean; sonTemas: string | null; aydinlatma: boolean } | null>(null); const [a, setA] = useState(false); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>(`/firma/${id}/aday-durum`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [id]);
  if (!v?.aday) return null;
  return <div className="blok"><div className="bolum">Aday Firma Teması</div>{m && <div className="not" role="status">{m}</div>}<div>Son Temas: {v.sonTemas ? v.sonTemas.split('-').reverse().join('.') : '—'}</div>
    {!v.aydinlatma && <label><input type="checkbox" checked={a} onChange={(e) => setA(e.target.checked)} /> Aydınlatma Yapıldı</label>}
    <button className="btn2 kucuk" disabled={!v.aydinlatma && !a} onClick={() => void istek(`/firma/${id}/aday-temas`, { aydinlatma: a }).then(() => { setM('Temas kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Temas Kaydet</button></div>;
}

/** YG-1235: arşivdeki dosyalar olağan listeden ayrıdır; yalnız erişilebilen dosyalar görünür. */
export function ArsivListesi() {
  const [l, setL] = useState<{ kimlik: string; dosya_no: string; yat_adi: string }[]>([]);
  useEffect(() => { void istek<typeof l>('/dosya?arsiv=1').then(setL).catch(() => setL([])); }, []);
  if (!l.length) return null;
  return <details><summary>Arşivdeki Dosyalar · {l.length}</summary><div className="ozet">{l.map((x) => <div key={x.kimlik}>{x.dosya_no} · {x.yat_adi}</div>)}</div></details>;
}
