import { useEffect, useState } from 'react';

type T = { hata: string; islem: string; hedef: string };
/** YG-1386: takılan adımda tek cümlelik açıklama ve yapılacak işin düğmesi; düğme ilgili alanı açar ve odaklar. */
export function TakilanAdim() {
  const [t, setT] = useState<T | null>(null);
  useEffect(() => { const f = (e: Event) => setT((e as CustomEvent<T>).detail); window.addEventListener('takilan-adim', f); return () => window.removeEventListener('takilan-adim', f); }, []);
  if (!t) return null;
  const git = () => {
    const el = document.getElementById(t.hedef); setT(null); if (!el) return;
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
    el.scrollIntoView({ block: 'center' }); el.focus();
  };
  return <div className="uyari" role="alert" data-t="takilan">{t.hata} <button className="btn2 kucuk" onClick={git}>{t.islem}</button></div>;
}
