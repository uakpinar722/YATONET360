import { useEffect, useState } from 'react';
import { istek } from './api';
import { eur } from './bicim';

type V = { donem: string; ozet: { olusturulan: number; gonderilen: number; revizyon: number; hazirlik_saat: string | null; karar_saat: string | null; gonderilen_tutar: string }; durumlar: { statu: string; n: number }[]; kararlar: { karar: string; n: number }[]; muhataplar: { teklif_muhatabi: string; n: number; tutar: string }[] };

/** YG-227: Teklif Performans Verisi. */
export function TeklifPerformans() {
  const [d, setD] = useState(() => new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 7)); const [v, setV] = useState<V | null>(null); const [m, setM] = useState('');
  useEffect(() => { void istek<V>(`/teklif-performans?donem=${d}`).then((x) => { setV(x); setM(''); }).catch((e) => { setV(null); setM(e.message); }); }, [d]);
  const saat = (x: string | null) => (x === null ? '---' : `${Number(x).toLocaleString('tr-TR')} saat`);
  return <><h1>Teklif Performansı</h1>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="tp-d">Dönem</label><input id="tp-d" type="month" value={d} onChange={(e) => setD(e.target.value)} />
    {v && <><div className="bolum">Özet</div><div className="ozet">
      <div>Oluşturulan teklif: {v.ozet.olusturulan} · Gönderilen: {v.ozet.gonderilen} · Revizyon: {v.ozet.revizyon}</div>
      <div>Ortalama hazırlık süresi: {saat(v.ozet.hazirlik_saat)} · Ortalama karar süresi: {saat(v.ozet.karar_saat)}</div>
      <div>Gönderilen teklif tutarı: {eur(v.ozet.gonderilen_tutar)}</div></div>
      <div className="bolum">Durum Dağılımı</div><div className="ozet">{v.durumlar.length ? v.durumlar.map((x) => <div key={x.statu}>{x.statu}: {x.n}</div>) : <div className="not">Kayıt bulunmamaktadır.</div>}</div>
      <div className="bolum">Karar Dağılımı</div><div className="ozet">{v.kararlar.length ? v.kararlar.map((x) => <div key={x.karar}>{x.karar}: {x.n}</div>) : <div className="not">Kayıt bulunmamaktadır.</div>}</div>
      <div className="bolum">Muhataba Göre</div><div className="ozet">{v.muhataplar.length ? v.muhataplar.map((x) => <div key={x.teklif_muhatabi}>{x.teklif_muhatabi}: {x.n} teklif · {eur(x.tutar)}</div>) : <div className="not">Kayıt bulunmamaktadır.</div>}</div></>}</>;
}
