import { useEffect, useState } from 'react';
import { istek } from './api';

const t = (x: number | string) => Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type V = { haftalar: { baslangic: string; giris: number; cikis: number; net: number; kumulatif: number }[]; karlilik: { sigortaci_adi: string; dosya: number; satis: string; maliyet: string; katki: string; oran: string | null }[] };
/** YG-762: 13 haftalık nakit tahmini ve sigortacı bazında kârlılık. */
export function NakitTahmini() {
  const [v, setV] = useState<V | null>(null);
  useEffect(() => { void istek<V>('/nakit-tahmini').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  return <details><summary>13 Haftalık Nakit Tahmini ve Sigortacı Kârlılığı</summary>
    {v.haftalar.map((h) => <div className={h.kumulatif < 0 ? 'soru hata' : 'soru'} key={h.baslangic}><span>{h.baslangic.split('-').reverse().join('.')} haftası · Giriş {t(h.giris)} · Çıkış {t(h.cikis)} · Net {t(h.net)} · Kümülatif {t(h.kumulatif)} EUR</span></div>)}
    <div className="bolum">Sigortacı Bazında Kârlılık (Son 12 Ay)</div>
    {v.karlilik.length === 0 ? <div className="ozet bos">Kayıt bulunmamaktadır.</div> : v.karlilik.map((x) => <div className="soru" key={x.sigortaci_adi}><span>{x.sigortaci_adi} · {x.dosya} dosya · Satış {t(x.satis)} · Maliyet {t(x.maliyet)} · Katkı {t(x.katki)} EUR{x.oran ? ` · %${String(x.oran).replace('.', ',')}` : ''}</span></div>)}</details>;
}
