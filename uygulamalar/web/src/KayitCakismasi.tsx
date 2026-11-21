import { useEffect, useState } from 'react';

/** YG-1382: eşzamanlı güncelleme çakışmasında uyarı; "Güncel Kaydı Yükle" açık ekranın kaydını yeniden yükler. */
export function KayitCakismasi() {
  const [m, setM] = useState('');
  useEffect(() => { const f = (e: Event) => setM((e as CustomEvent<string>).detail); window.addEventListener('kayit-cakismasi', f); return () => window.removeEventListener('kayit-cakismasi', f); }, []);
  if (!m) return null;
  return <div className="uyari" role="alert" data-t="cakisma">{m} <button className="btn2 kucuk" onClick={() => { setM(''); window.dispatchEvent(new Event('kayit-yenile')); }}>Güncel Kaydı Yükle</button></div>;
}
