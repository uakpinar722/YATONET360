import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kod: string; ana_brans: string; tali_brans: string; islem: string; birim: string };

/** YG-433: Çözüm Ortağı portalında fiyat kartelası fiyatsız gösterilir (kod, branş, işlem, birim). */
export function KartelaGoruntule() {
  const [q, setQ] = useState(''); const [l, setL] = useState<K[]>([]);
  useEffect(() => { const s = q.trim(); if (s.length < 2) { setL([]); return; } const t = setTimeout(() => { void istek<K[]>(`/kartela/ara?q=${encodeURIComponent(s)}`).then(setL).catch(() => setL([])); }, 250); return () => clearTimeout(t); }, [q]);
  return <><h1>Fiyat Kartelası</h1><div className="not">Kartela işlemleri fiyatsız gösterilir; fiyat teklif talebinde iletilir.</div>
    <label htmlFor="kg-q">İşlem veya Kod</label><input id="kg-q" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
    <div className="ozet">{q.trim().length < 2 ? <div className="not">Aramak için en az iki harf yazınız.</div> : l.length === 0 ? <div className="not">Sonuç bulunmamaktadır.</div> : l.map((x) => <div key={x.kod}>{x.kod} · {x.ana_brans}{x.tali_brans ? ` / ${x.tali_brans}` : ''} · {x.islem} · {x.birim}</div>)}</div></>;
}
