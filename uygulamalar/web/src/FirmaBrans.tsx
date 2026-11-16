import { useEffect, useState } from 'react';
import { istek } from './api';

type O = { seviye: string; gerekce: string };

/** YG-308: branş yetkinlik seviyesi Cilt II §5.4 ölçütlerinden önerilir; ölçütün üstünde seviye verilmez. */
export function FirmaBrans({ id, yap }: { id: string; yap: (f: () => Promise<unknown>, t: string) => Promise<void> }) {
  const [f, setF] = useState({ brans: '', kapsama: 'Bölge', bolge: '', deneyim: '', belgeli: false, uretici: false, muhendislik: false, seviye: '', kisit: '' });
  const [on, setOn] = useState<O | null>(null);
  useEffect(() => {
    if (!f.brans.trim()) { setOn(null); return; }
    const q = new URLSearchParams({ brans: f.brans.trim(), deneyim: f.deneyim || '0', belgeli: f.belgeli ? '1' : '0', uretici: f.uretici ? '1' : '0', muhendislik: f.muhendislik ? '1' : '0' });
    const t = setTimeout(() => { void istek<O>(`/firma/${id}/brans-oneri?${q}`).then(setOn).catch(() => setOn(null)); }, 300); return () => clearTimeout(t);
  }, [id, f.brans, f.deneyim, f.belgeli, f.uretici, f.muhendislik]);
  const k = (a: 'belgeli' | 'uretici' | 'muhendislik', et: string) => <label><input type="checkbox" checked={f[a]} onChange={(e) => setF({ ...f, [a]: e.target.checked })} /> {et}</label>;
  return <><div className="bolum">Branş Yetkinliği</div>
    <label htmlFor="fb-b">Ana Branş (Yetkinlik)</label><input id="fb-b" value={f.brans} onChange={(e) => setF({ ...f, brans: e.target.value })} />
    <label htmlFor="fb-k">Kapsama</label><select id="fb-k" value={f.kapsama} onChange={(e) => setF({ ...f, kapsama: e.target.value })}>{['Bölge', 'Komşu', 'Mobil Ekip', 'Ulusal'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="fb-r">Bölge</label><input id="fb-r" value={f.bolge} onChange={(e) => setF({ ...f, bolge: e.target.value })} />
    <label htmlFor="fb-d">Branş Deneyimi (Yıl)</label><input id="fb-d" inputMode="numeric" value={f.deneyim} onChange={(e) => setF({ ...f, deneyim: e.target.value })} />
    {k('belgeli', 'Branşında belgeli usta veya mühendis var')}{k('uretici', 'Üretici yetkisi veya klas onayı var')}{k('muhendislik', 'Mühendislik kapasitesi var')}
    {on && <div className="not">Ölçütlere göre önerilen seviye: <b>{on.seviye}</b> ({on.gerekce})</div>}
    <label htmlFor="fb-s">Verilecek Seviye</label><select id="fb-s" value={f.seviye} onChange={(e) => setF({ ...f, seviye: e.target.value })}><option value="">Önerilen seviye</option>{['Y1', 'Y2', 'Y3', 'Y4'].map((x) => <option key={x} disabled={Boolean(on && x > on.seviye)}>{x}</option>)}</select>
    <label htmlFor="fb-i">Kısıt / İstisna (Alt veya Tali Branş)</label><input id="fb-i" value={f.kisit} onChange={(e) => setF({ ...f, kisit: e.target.value })} />
    <button className="btn2" disabled={!f.brans.trim()} onClick={() => void yap(() => istek(`/firma/${id}/brans`, { brans: f.brans, kapsama: f.kapsama, bolge: f.bolge || undefined, deneyim: f.deneyim ? Number(f.deneyim) : undefined, belgeli: f.belgeli, uretici: f.uretici, muhendislik: f.muhendislik, seviye: f.seviye || undefined, kisit: f.kisit || undefined }), 'Branş yetkinliği kaydedildi.')}>Yetkinliği Kaydet</button></>;
}
