import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-1246: hatalı alan, doğru değer, kaynağı ve etkilenen işlemlerle veri düzeltme talebi; onaydan sonra kayıt düzelir, önceki değer denetim izinde kalır. */
export function VeriDuzeltme({ nesneTuru, nesne, yat, baslik }: { nesneTuru: 'Yat' | 'Taraf' | 'Kuruluş'; nesne?: string; yat?: string; baslik: string }) {
  const [alanlar, setAlanlar] = useState<string[]>([]); const [m, setM] = useState('');
  const [f, setF] = useState({ alan: '', dogruDeger: '', kaynak: '', etkilenen: '' });
  useEffect(() => { void istek<Record<string, string[]>>('/veri-duzeltme-alanlari').then((x) => setAlanlar(x[nesneTuru] ?? [])).catch(() => setAlanlar([])); }, [nesneTuru]);
  if (!alanlar.length) return null;
  const k = `vd-${nesneTuru === 'Kuruluş' ? 'k' : nesneTuru === 'Taraf' ? 't' : 'y'}`;
  return <details className="ozet"><summary>{baslik}</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor={`${k}-a`}>Hatalı Alan</label><select required id={`${k}-a`} value={f.alan} onChange={(e) => setF({ ...f, alan: e.target.value })}><option value="">Seçiniz</option>{alanlar.map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor={`${k}-d`}>Doğru Değer</label><input required id={`${k}-d`} value={f.dogruDeger} onChange={(e) => setF({ ...f, dogruDeger: e.target.value })} />
    <label htmlFor={`${k}-k`}>Doğru Değerin Kaynağı</label><input required id={`${k}-k`} value={f.kaynak} onChange={(e) => setF({ ...f, kaynak: e.target.value })} />
    <label htmlFor={`${k}-e`}>Etkilenen Dosya veya İşlemler</label><input required id={`${k}-e`} value={f.etkilenen} onChange={(e) => setF({ ...f, etkilenen: e.target.value })} />
    <button className="btn2" disabled={!f.alan || !f.dogruDeger.trim() || !f.kaynak.trim() || !f.etkilenen.trim()} onClick={() => void istek('/veri-duzeltme-talebi', { nesneTuru, nesne, yat, ...f }).then(() => { setM('Düzeltme talebiniz onaya gönderildi.'); setF({ alan: '', dogruDeger: '', kaynak: '', etkilenen: '' }); }).catch((e) => setM(e.message))}>Düzeltme Talebi Gönder</button></details>;
}
