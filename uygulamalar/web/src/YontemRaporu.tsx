import { useEffect, useState } from 'react';
import { istek } from './api';

const TURLER = ['Kompozit Laminasyon ve Kür', 'Yapıştırma, Sızdırmazlık ve Dolgu'];
type Rapor = { kimlik: string; rapor_no: string; durum: string; kapsam: string };
type FirmaRapor = { rapor_no: string; kapsam: string; malzeme_tablosu: string; uygulama_sirasi: string; eszamanli_yapilamaz: string | null };

/** YG-1454: Teknik Uzman hazırlar, Teknik Müdür onaylar; proses sınırları iş emrine aktarılır. */
export function YontemRaporu({ dosya }: { dosya: string }) {
  const bos = { kapsam: '', malzeme: '', sira: '', eszamanli: '', muadil: '', tur: TURLER[0]!, sicaklikMin: '', sicaklikMax: '', nemMin: '', nemMax: '' };
  const [l, setL] = useState<Rapor[] | null>(null); const [f, setF] = useState(bos); const [m, setM] = useState('');
  const yk = () => istek<Rapor[]>(`/dosya/${dosya}/yontem-raporu`).then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!l) return null;
  const al = (a: keyof typeof bos, ad: string, uzun = false) => <><label htmlFor={`yr-${a}`}>{ad}</label>{uzun ? <textarea id={`yr-${a}`} rows={3} value={f[a]} onChange={(e) => setF({ ...f, [a]: e.target.value })} /> : <input id={`yr-${a}`} value={f[a]} onChange={(e) => setF({ ...f, [a]: e.target.value })} />}</>;
  const sinirVar = [f.sicaklikMin, f.sicaklikMax, f.nemMin, f.nemMax].some((x) => x.trim());
  const kaydet = () => void istek<{ raporNo: string }>(`/dosya/${dosya}/yontem-raporu`, { kapsam: f.kapsam, malzeme: f.malzeme, sira: f.sira, eszamanli: f.eszamanli || undefined, muadil: f.muadil.split('\n').map((x) => x.trim()).filter(Boolean), sinirlar: sinirVar ? [{ tur: f.tur, sicaklikMin: f.sicaklikMin, sicaklikMax: f.sicaklikMax, nemMin: f.nemMin, nemMax: f.nemMax }] : [] })
    .then((r) => { setM(`${r.raporNo} Teknik Müdür onayına gönderildi.`); setF(bos); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Onarım Yöntem Raporu</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{l.map((x) => <div key={x.kimlik}>{x.rapor_no} · {x.durum}</div>)}</div>
    {al('kapsam', 'Yöntem Kapsamı', true)}{al('malzeme', 'Malzeme Tablosu', true)}{al('sira', 'Uygulama Sırası', true)}{al('eszamanli', 'Eş Zamanlı Yapılamayacak İşler', true)}{al('muadil', 'Muadil Parçalar (her satıra bir parça)', true)}
    <label htmlFor="yr-tur">Proses Türü (Sınır)</label><select id="yr-tur" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{TURLER.map((x) => <option key={x}>{x}</option>)}</select>
    {al('sicaklikMin', 'Sıcaklık Alt (°C) ')}{al('sicaklikMax', 'Sıcaklık Üst (°C) ')}{al('nemMin', 'Nem Alt (%) ')}{al('nemMax', 'Nem Üst (%) ')}
    <button className="btn2 kucuk" disabled={!f.kapsam.trim() || !f.malzeme.trim() || !f.sira.trim()} onClick={kaydet}>Onaya Gönder</button></>;
}

/** K-192: firmaya ON iş emrinin bağlayıcı eki. */
export function YontemRaporuFirma({ isEmri }: { isEmri: string }) {
  const [r, setR] = useState<FirmaRapor | null>(null);
  useEffect(() => { void istek<FirmaRapor | null>(`/firma-portal/is-emri/${isEmri}/yontem-raporu`).then(setR).catch(() => setR(null)); }, [isEmri]);
  if (!r) return null;
  return <div className="blok"><div className="bolum">Onarım Yöntem Raporu · {r.rapor_no}</div>
    <div className="ozet"><div>Kapsam: {r.kapsam}</div><div>Malzeme Tablosu: {r.malzeme_tablosu}</div><div>Uygulama Sırası: {r.uygulama_sirasi}</div>{r.eszamanli_yapilamaz && <div>Eş Zamanlı Yapılamayacak İşler: {r.eszamanli_yapilamaz}</div>}<div className="not">Bu rapor iş emrinin bağlayıcı ekidir; sapma LGM onayıyla yapılır.</div></div></div>;
}
