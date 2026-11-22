import { useEffect, useState } from 'react';
import { istek } from './api';

type R = { kimlik: string; rol_adi: string; is_amaci: string | null; sahip_rol_ref: string | null; gozden_gecirme_ay: number | null };
/** YG-1007: rolün iş amacı, sahip rolü ve gözden geçirme dönemi. */
export function RolTanimi() {
  const [l, setL] = useState<R[]>([]); const [f, setF] = useState({ rol: '', amac: '', sahip: '', ay: '12' }); const [m, setM] = useState('');
  const yk = () => istek<R[]>('/yetki/roller').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  const sec = (k: string) => { const r = l.find((x) => x.kimlik === k); setF({ rol: k, amac: r?.is_amaci ?? '', sahip: r?.sahip_rol_ref ?? '', ay: String(r?.gozden_gecirme_ay ?? 12) }); };
  return <><div className="bolum">Rol Tanımı</div>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="rt-r">Rol</label><select required id="rt-r" value={f.rol} onChange={(e) => sec(e.target.value)}><option value="">Seçiniz</option>{l.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.rol_adi}</option>)}</select>
    <label htmlFor="rt-a">İş Amacı</label><input required id="rt-a" value={f.amac} onChange={(e) => setF({ ...f, amac: e.target.value })} />
    <label htmlFor="rt-s">Sahip Rol</label><select required id="rt-s" value={f.sahip} onChange={(e) => setF({ ...f, sahip: e.target.value })}><option value="">Seçiniz</option>{l.filter((x) => x.kimlik !== f.rol).map((x) => <option key={x.kimlik} value={x.kimlik}>{x.rol_adi}</option>)}</select>
    <label htmlFor="rt-g">Gözden Geçirme Dönemi (Ay)</label><input id="rt-g" inputMode="numeric" value={f.ay} onChange={(e) => setF({ ...f, ay: e.target.value })} />
    <button className="btn2" disabled={!f.rol || !f.amac.trim() || !f.sahip} onClick={() => void istek(`/yetki/rol/${f.rol}/tanim`, { amac: f.amac, sahip: f.sahip, gozdenGecirmeAy: Number(f.ay) }).then(() => { setM('Rol tanımı kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></>;
}
