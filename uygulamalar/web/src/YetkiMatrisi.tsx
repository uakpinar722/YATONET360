import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-996: yetki matrisi görünümü; işlev veya risk değişiminde gerekçeli değişiklik talebi (rol makamı ve BT ve Firma Yönetimi Direktörü onayı). */
export function YetkiMatrisi() {
  type V = { izinler: string[]; roller: string[]; rolIzinleri: string[]; talepler: { kimlik: string; rol_adi: string; izin: string; islem: string; risk: string; gerekce: string; durum: string; hazirlayan: string }[]; hazirlar: boolean };
  const [rol, setRol] = useState(''); const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ izin: '', islem: 'Ekle', risk: 'Orta', gerekce: '' }); const [m, setM] = useState('');
  const yk = (r = rol) => istek<V>(`/yetki-matrisi${r ? `?rol=${encodeURIComponent(r)}` : ''}`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const gonder = () => void istek('/yetki-matrisi/talep', { rol, ...f }).then(() => { setM('Talep onaya gönderildi.'); setF({ ...f, gerekce: '' }); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Yetki Matrisi ({v.talepler.filter((x) => x.durum === 'Onay Bekliyor').length} bekleyen talep)</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="ym-r">Rol</label><select id="ym-r" value={rol} onChange={(e) => { setRol(e.target.value); void yk(e.target.value); }}><option value="">Seçiniz</option>{v.roller.map((x) => <option key={x}>{x}</option>)}</select>
    {rol && <div className="not">İzinler: {v.rolIzinleri.length ? v.rolIzinleri.join(', ') : 'Yok'}</div>}
    {rol && v.hazirlar && <div className="ozet">
      <label htmlFor="ym-i">İzin</label><select id="ym-i" value={f.izin} onChange={(e) => setF({ ...f, izin: e.target.value })}><option value="">Seçiniz</option>{v.izinler.map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="ym-s">İşlem</label><select id="ym-s" value={f.islem} onChange={(e) => setF({ ...f, islem: e.target.value })}><option>Ekle</option><option>Kaldır</option></select>
      <label htmlFor="ym-k">Risk</label><select id="ym-k" value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value })}>{['Düşük', 'Orta', 'Yüksek'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="ym-g">İşlev veya Risk Değişikliği Gerekçesi</label><input required id="ym-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
      <button className="btn2" disabled={!f.izin || !f.gerekce.trim()} onClick={gonder}>Onaya Gönder</button>
    </div>}
    {v.talepler.map((x) => <div key={x.kimlik} className="soru"><span>{x.rol_adi} · {x.izin} · {x.islem} · Risk {x.risk} · {x.durum} · {x.hazirlayan} · {x.gerekce}</span></div>)}
  </details>;
}
