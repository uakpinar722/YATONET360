import { useState } from 'react';
import { istek } from './api';

const SONRAKI: Record<string, string[]> = { 'Açık': ['İşlemde', 'Geçersiz'], 'İşlemde': ['Doğrulamada', 'Geçersiz'], 'Doğrulamada': ['Kapalı', 'İşlemde'], 'Kapalı': ['İşlemde'] };
const AD: Record<string, string> = { İşlemde: 'İşleme Al', Geçersiz: 'Geçersiz Say', Doğrulamada: 'Doğrulamaya Gönder', Kapalı: 'Kapat' };

/** YG-059, YG-153: açık konu durum geçişleri; doğrulamaya kanıtla gönderilir, kapanmış konu gerekçeyle yeniden açılır. */
export function KonuIslem({ kimlik, statu, yenile }: { kimlik: string; statu: string; yenile: () => void }) {
  const [m, setM] = useState(''); const [not, setNot] = useState('');
  const l = SONRAKI[statu] ?? [];
  if (!l.length) return null;
  const gonder = (s: string) => void istek(`/konu/${kimlik}/durum`, { statu: s, kanit: s === 'Doğrulamada' ? not : undefined, gerekce: statu === 'Kapalı' ? not : undefined }).then(() => { setNot(''); setM(''); yenile(); }).catch((e) => setM(e.message));
  return <span className="tam">{m && <span className="not" role="status">{m}</span>}
    {(statu === 'İşlemde' || statu === 'Kapalı') && <><label htmlFor={`ki-${kimlik}`}>{statu === 'Kapalı' ? 'Yeniden Açma Gerekçesi' : 'Kapanış Kanıtı'}</label><input id={`ki-${kimlik}`} value={not} onChange={(e) => setNot(e.target.value)} /></>}
    {l.map((s) => <button key={s} className="btn2 kucuk" disabled={(s === 'Doğrulamada' || statu === 'Kapalı') && !not.trim()} onClick={() => gonder(s)}>{statu === 'Kapalı' ? 'Yeniden Aç' : statu === 'Doğrulamada' && s === 'İşlemde' ? 'İşleme Geri Gönder' : AD[s]}</button>)}</span>;
}
