import { useEffect, useState } from 'react';
import { istek } from './api';

type R = { kimlik: string; rol_adi: string; rol_sahibi_birim: string; sahip: string | null; vekil: string | null; talep: string | null; kirmizi: boolean };
/** YG-1480: kilit roller; boş rol kırmızı görünür, Direktör atama talebi açar (GMY görüşü, CEO onayı). */
export function KilitRoller() {
  const [v, setV] = useState<{ talepEder: boolean; personel: { kimlik: string; ad_soyad: string }[]; roller: R[] } | null>(null); const [f, setF] = useState({ rol: '', aday: '', vekil: '', gerekce: '' }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/kilit-rol').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const bos = v.roller.filter((x) => x.kirmizi);
  const sec = (id: string, d: string, k: (x: string) => void) => <select id={id} value={d} onChange={(e) => k(e.target.value)}><option value="">Seçiniz</option>{v.personel.map((p) => <option key={p.kimlik} value={p.kimlik}>{p.ad_soyad}</option>)}</select>;
  return <details open={bos.length > 0}><summary>Kilit Roller{bos.length ? ` · ${bos.length} boş` : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    {v.roller.map((x) => <div className={x.kirmizi ? 'soru hata' : 'soru'} key={x.kimlik}><span>{x.rol_adi} · {x.sahip ?? (x.vekil ? `Boş · Geçici Vekil: ${x.vekil}` : 'Boş · Vekilsiz')}{x.talep ? ` · Talep: ${x.talep}` : ''}</span></div>)}
    {v.talepEder && <><div className="bolum">Atama Talebi</div><label htmlFor="kr-r">Rol</label><select id="kr-r" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}><option value="">Seçiniz</option>{v.roller.filter((x) => !x.talep).map((x) => <option key={x.kimlik} value={x.kimlik}>{x.rol_adi}</option>)}</select>
      <label htmlFor="kr-a">Aday</label>{sec('kr-a', f.aday, (x) => setF({ ...f, aday: x }))}<label htmlFor="kr-v">Geçici Vekil (Rol Boşsa)</label>{sec('kr-v', f.vekil, (x) => setF({ ...f, vekil: x }))}<label htmlFor="kr-g">Gerekçe</label><input id="kr-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
      <button className="btn2 kucuk" disabled={!f.rol || !f.aday || !f.gerekce.trim()} onClick={() => void istek('/kilit-rol/talep', { ...f, vekil: f.vekil || undefined }).then(() => { setM('Talep GMY görüşüne gönderildi.'); setF({ rol: '', aday: '', vekil: '', gerekce: '' }); return yk(); }).catch((e) => setM(e.message))}>Talep Aç</button></>}</details>;
}
