import { useEffect, useState } from 'react';
import { istek } from './api';
import { eur } from './bicim';

type F = { fatura_no: string; fatura_tarihi: string; dosya_no: string; muhatap: string; kdv_eur: string; tevkifat_orani: string | null; tevkifat_eur: string };

/** YG-882: KDV tevkifatlı faturaların aylık listesi ve KDV iade dosyası için döküm. */
export function TevkifatListesi() {
  const [ay, setAy] = useState(() => new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 7));
  const [v, setV] = useState<{ faturalar: F[]; toplamTevkifatEur: number } | null>(null); const [m, setM] = useState('');
  useEffect(() => { void istek<NonNullable<typeof v>>(`/muhasebe/tevkifatli?ay=${ay}`).then((x) => { setV(x); setM(''); }).catch((e) => { setV(null); setM(e.message); }); }, [ay]);
  return <><div className="bolum">KDV Tevkifatlı Faturalar</div><div className="ozet">{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="tv-a">Ay</label><input id="tv-a" type="month" value={ay} onChange={(e) => setAy(e.target.value)} />
    {v && (v.faturalar.length === 0 ? <div className="not">Bu ayda tevkifatlı fatura bulunmamaktadır.</div> : <>{v.faturalar.map((x) => <div key={x.fatura_no}>{x.fatura_no} · {x.fatura_tarihi.split('-').reverse().join('.')} · {x.dosya_no} · {x.muhatap} · KDV {eur(x.kdv_eur)} · Tevkifat {x.tevkifat_orani ?? ''} {eur(x.tevkifat_eur)}</div>)}
      <div>Toplam tevkifat: {eur(v.toplamTevkifatEur)}</div><a className="btn2 kucuk" href={`/api/muhasebe/tevkifatli?ay=${ay}&bicim=csv`}>KDV İade Dökümünü İndir</a></>)}</div></>;
}
