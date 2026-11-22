import { useState } from 'react';
import { istek } from './api';

const SONRAKI: Record<string, string[]> = { 'Açık': ['İşlemde', 'Geçersiz'], 'İşlemde': ['Doğrulamada', 'Geçersiz'], 'Doğrulamada': ['Kapalı', 'İşlemde'], 'Kapalı': ['İşlemde'] };
const AD: Record<string, string> = { İşlemde: 'İşleme Al', Geçersiz: 'Geçersiz Say', Doğrulamada: 'Doğrulamaya Gönder', Kapalı: 'Kapat' };

/** YG-059, YG-153: açık konu durum geçişleri; doğrulamaya kanıtla gönderilir, kapanmış konu gerekçeyle yeniden açılır. */
/** YG-059: Dosya Sorumlusu hedef tarihi gerekçeyle değiştirir. */
export function KonuHedef({ kimlik, surum, statu, yenile }: { kimlik: string; surum?: number; statu: string; yenile: () => void }) {
  const [t, setT] = useState(''); const [g, setG] = useState(''); const [m, setM] = useState(''); const [ac, setAc] = useState(false);
  if (['Kapalı', 'Geçersiz'].includes(statu)) return null;
  if (!ac) return <button className="lnk" onClick={() => setAc(true)}>Hedef Tarihi Değiştir</button>;
  return <span className="tam">{m && <span className="not" role="status">{m}</span>}
    <label htmlFor={`kh-t-${kimlik}`}>Yeni Hedef Tarih</label><input required id={`kh-t-${kimlik}`} type="date" value={t} onChange={(e) => setT(e.target.value)} />
    <label htmlFor={`kh-g-${kimlik}`}>Değişiklik Gerekçesi</label><input required id={`kh-g-${kimlik}`} value={g} onChange={(e) => setG(e.target.value)} />
    <button className="btn2 kucuk" disabled={!t || !g.trim()} onClick={() => void istek(`/konu/${kimlik}/hedef`, { tarih: t, gerekce: g, surum }).then(() => { setAc(false); setT(''); setG(''); yenile(); }).catch((e) => setM(e.message))}>Kaydet</button></span>;
}

export function KonuIslem({ kimlik, surum, statu, yenile }: { kimlik: string; surum?: number; statu: string; yenile: () => void }) {
  const [m, setM] = useState(''); const [not, setNot] = useState('');
  const l = SONRAKI[statu] ?? [];
  if (!l.length) return null;
  const gonder = (s: string) => void istek(`/konu/${kimlik}/durum`, { statu: s, kanit: s === 'Doğrulamada' ? not : undefined, gerekce: statu === 'Kapalı' ? not : undefined, surum }).then(() => { setNot(''); setM(''); yenile(); }).catch((e) => setM(e.message));
  return <span className="tam">{m && <span className="not" role="status">{m}</span>}
    {(statu === 'İşlemde' || statu === 'Kapalı') && <><label htmlFor={`ki-${kimlik}`}>{statu === 'Kapalı' ? 'Yeniden Açma Gerekçesi' : 'Kapanış Kanıtı'}</label><input required id={`ki-${kimlik}`} value={not} onChange={(e) => setNot(e.target.value)} /></>}
    {l.map((s) => <button key={s} className="btn2 kucuk" disabled={(s === 'Doğrulamada' || statu === 'Kapalı') && !not.trim()} onClick={() => gonder(s)}>{statu === 'Kapalı' ? 'Yeniden Aç' : statu === 'Doğrulamada' && s === 'İşlemde' ? 'İşleme Geri Gönder' : AD[s]}</button>)}</span>;
}
