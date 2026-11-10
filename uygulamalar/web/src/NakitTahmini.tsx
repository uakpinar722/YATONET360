import { useEffect, useState } from 'react';
import { istek } from './api';

const t = (x: number | string) => Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type V = { haftalar: { baslangic: string; giris: number; cikis: number; firma: number; tedarik: number; gider: number; net: number; kumulatif: number }[]; karlilik: { sigortaci_adi: string; dosya: number; satis: string; maliyet: string; katki: string; oran: string | null }[]; giderPlani: { kimlik: string; kalem: string; tutar_eur: string; tekrar: string; ayin_gunu: number | null; tarih: string | null }[] };
/** YG-762: 13 haftalık nakit tahmini (müşteri tahsilatı, firma ve tedarikçi ödemeleri, genel giderler) ve sigortacı kârlılığı. */
export function NakitTahmini() {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ kalem: '', tutar: '', tekrar: 'Aylık', ayinGunu: '1', tarih: '' }); const [m, setM] = useState('');
  const yk = () => istek<V>('/nakit-tahmini').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  return <details><summary>13 Haftalık Nakit Tahmini ve Sigortacı Kârlılığı</summary>{m && <div className="not" role="status">{m}</div>}
    {v.haftalar.map((h) => <div className={h.kumulatif < 0 ? 'soru hata' : 'soru'} key={h.baslangic}><span>{h.baslangic.split('-').reverse().join('.')} haftası · Giriş {t(h.giris)} · Firma {t(h.firma)} · Tedarikçi {t(h.tedarik)} · Genel Gider {t(h.gider)} · Net {t(h.net)} · Kümülatif {t(h.kumulatif)} EUR</span></div>)}
    <div className="bolum">Genel Gider Planı</div>
    {v.giderPlani.map((g) => <div className="soru" key={g.kimlik}><span>{g.kalem} · {t(g.tutar_eur)} EUR · {g.tekrar === 'Aylık' ? `Her ayın ${g.ayin_gunu}. günü` : g.tarih?.split('-').reverse().join('.')}</span><button className="btn2 kucuk" onClick={() => void istek(`/nakit-gider-plani/${g.kimlik}/kapat`, {}).then(yk).catch((e) => setM(e.message))}>Kaldır</button></div>)}
    <label htmlFor="ng-k">Kalem</label><input id="ng-k" value={f.kalem} onChange={(e) => setF({ ...f, kalem: e.target.value })} /><label htmlFor="ng-t">Tutar (EUR)</label><input id="ng-t" inputMode="decimal" value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} />
    <label htmlFor="ng-r">Tekrar</label><select id="ng-r" value={f.tekrar} onChange={(e) => setF({ ...f, tekrar: e.target.value })}><option>Aylık</option><option>Tek Sefer</option></select>
    {f.tekrar === 'Aylık' ? <><label htmlFor="ng-g">Ayın Günü</label><input id="ng-g" inputMode="numeric" value={f.ayinGunu} onChange={(e) => setF({ ...f, ayinGunu: e.target.value })} /></> : <><label htmlFor="ng-d">Tarih</label><input id="ng-d" type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} /></>}
    <button className="btn2 kucuk" onClick={() => void istek('/nakit-gider-plani', { kalem: f.kalem, tutar: Number(f.tutar.replace(/\./g, '').replace(',', '.')), tekrar: f.tekrar, ayinGunu: Number(f.ayinGunu), tarih: f.tarih || undefined }).then(() => { setM('Gider eklendi.'); setF({ ...f, kalem: '', tutar: '' }); return yk(); }).catch((e) => setM(e.message))}>Gider Ekle</button>
    <div className="bolum">Sigortacı Bazında Kârlılık (Son 12 Ay)</div>
    {v.karlilik.length === 0 ? <div className="ozet bos">Kayıt bulunmamaktadır.</div> : v.karlilik.map((x) => <div className="soru" key={x.sigortaci_adi}><span>{x.sigortaci_adi} · {x.dosya} dosya · Satış {t(x.satis)} · Maliyet {t(x.maliyet)} · Katkı {t(x.katki)} EUR{x.oran ? ` · %${String(x.oran).replace('.', ',')}` : ''}</span></div>)}</details>;
}
