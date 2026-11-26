import { useEffect, useState } from 'react';

/** YG-1477: giriş gerektirmeyen aydınlatma metni (mirasçıya giden ilk mesajdaki bağlantı). */
export function AydinlatmaAcik({ kod }: { kod: string }) {
  const [dil, setDil] = useState<'tr' | 'en'>('tr'); const [v, setV] = useState<{ baslik: string; govde: string[]; surum: string } | null>(null); const [h, setH] = useState('');
  useEffect(() => { void fetch(`/api/acik/aydinlatma/${encodeURIComponent(kod)}?dil=${dil}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.hata ?? 'Metin bulunamadı.'); setV(j); }).catch((e) => setH(e.message)); }, [kod, dil]);
  return <div className="ilk"><div className="ilk-kart"><div className="ilk-bas"><img src="/lgm_yatay_tr.png" alt="LİMİT GLOBAL MARINE" /></div><div className="ilk-ic">
    {h && <div className="hata" role="alert">{h}</div>}
    <div className="dugmeler"><button type="button" className={dil === 'tr' ? 'btn kucuk' : 'btn2 kucuk'} onClick={() => setDil('tr')}>Türkçe</button><button type="button" className={dil === 'en' ? 'btn kucuk' : 'btn2 kucuk'} onClick={() => setDil('en')}>English</button></div>
    {v && <><h2>{v.baslik}</h2>{(Array.isArray(v.govde) ? v.govde : []).map((p, n) => <p key={n}>{p}</p>)}<div className="not">{v.surum}</div></>}
  </div></div></div>;
}
