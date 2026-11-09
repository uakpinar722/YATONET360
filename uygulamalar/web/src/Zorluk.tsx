import { useEffect, useState } from 'react';
import { istek } from './api';

const OLCUT = [['oncelik', 'Öncelik'], ['brans', 'Branş Sayısı'], ['kabulSinifi', 'Kabul Sınıfı'], ['tutarBandi', 'Tutar Bandı'], ['erisim', 'Erişim ve Lokasyon'], ['gizliHasar', 'Gizli Hasar']] as const;
type V = { katsayi: string; revize: boolean; girildi: boolean };

/** YG-964, YG-965: Teknik Müdür zorluk katsayısını girer; gerekçeyle bir kez revize eder. */
export function ZorlukKatsayisi({ dosya }: { dosya: string }) {
  const [v, setV] = useState<V | null>(null); const [k, setK] = useState(''); const [o, setO] = useState<Record<string, string>>({}); const [g, setG] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<V>(`/dosya/${dosya}/zorluk`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!v) return null;
  const kapali = v.girildi && v.revize;
  return <div className="blok"><div className="bolum">Zorluk Katsayısı: {Number(v.katsayi).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</div>{m && <div className="not" role="status">{m}</div>}
    {!kapali && <><label htmlFor="zk-k">Katsayı (0,8–2,0)</label><input id="zk-k" inputMode="decimal" value={k} onChange={(e) => setK(e.target.value)} />
      {OLCUT.map(([a, et]) => <span key={a}><label htmlFor={`zk-${a}`}>{et}</label><input id={`zk-${a}`} value={o[a] ?? ''} onChange={(e) => setO({ ...o, [a]: e.target.value })} /></span>)}
      {v.girildi && <><label htmlFor="zk-g">Revize Gerekçesi</label><input id="zk-g" value={g} onChange={(e) => setG(e.target.value)} /></>}
      <button className="btn2 kucuk" disabled={!k} onClick={() => void istek(`/dosya/${dosya}/zorluk`, { katsayi: Number(k.replace(',', '.')), olcutler: o, gerekce: g || undefined }).then(() => { setM('Zorluk katsayısı kaydedildi.'); setK(''); setG(''); return yk(); }).catch((e) => setM(e.message))}>{v.girildi ? 'Revize Et' : 'Kaydet'}</button></>}</div>;
}
