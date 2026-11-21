import { useEffect, useState } from 'react';
import { istek } from './api';

const tarih = (x: string) => new Date(x).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });

type G = { zaman: string; teklif_no: string; surum_no: number; teklif_muhatabi: string; dosya_no: string; eski_statu: string | null; yeni_statu: string; karar: string | null };
/** YG-227: Teklif Statü Geçişi ekranı. */
export function TeklifStatuGecisleri() {
  const [d, setD] = useState(() => new Date().toISOString().slice(0, 7)); const [v, setV] = useState<G[] | null>(null); const [m, setM] = useState('');
  useEffect(() => { void istek<{ gecisler: G[] }>(`/teklif-statu-gecisleri?donem=${d}`).then((x) => { setV(x.gecisler); setM(''); }).catch((e) => { setV(null); setM(e.message); }); }, [d]);
  return <><h1>Teklif Statü Geçişleri</h1>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="tg-d">Dönem</label><input id="tg-d" type="month" value={d} onChange={(e) => setD(e.target.value)} />
    {v && (v.length ? <div className="tablo"><table className="kartli"><thead><tr><th>Tarih</th><th>Dosya No</th><th>Teklif</th><th>Muhatap</th><th>Önceki</th><th>Yeni</th><th>Karar</th></tr></thead>
      <tbody>{v.map((x, n) => <tr key={n}><td data-ad="Tarih">{tarih(x.zaman)}</td><td data-ad="Dosya No">{x.dosya_no}</td><td data-ad="Teklif">{x.teklif_no} Rev.{x.surum_no}</td><td data-ad="Muhatap">{x.teklif_muhatabi}</td><td data-ad="Önceki">{x.eski_statu ?? '—'}</td><td data-ad="Yeni">{x.yeni_statu}</td><td data-ad="Karar">{x.karar ?? '—'}</td></tr>)}</tbody></table></div> : <div className="not">Kayıt bulunmamaktadır.</div>)}</>;
}

type E = { dosya_no: string; neden: string; olusturma_zamani: string; hedef_tarih: string | null; eskalasyon_zamani: string | null; gun45_karari: string | null; gun: number; sorumlu: string | null };
/** YG-227, YG-068: Beklemede Eskalasyonu ekranı. */
export function BeklemedeEskalasyonlari() {
  const [v, setV] = useState<E[] | null>(null); const [m, setM] = useState('');
  useEffect(() => { void istek<E[]>('/beklemede-eskalasyonlari').then(setV).catch((e) => setM(e.message)); }, []);
  return <><h1>Beklemede Eskalasyonları</h1>{m && <div className="not" role="status">{m}</div>}
    {v && (v.length ? <div className="tablo"><table className="kartli"><thead><tr><th>Dosya No</th><th>Neden</th><th>Gün</th><th>Sorumlu</th><th>Hedef Tarih</th><th>10. Gün Yükseltmesi</th><th>45. Gün</th></tr></thead>
      <tbody>{v.map((x, n) => <tr key={n}><td data-ad="Dosya No">{x.dosya_no}</td><td data-ad="Neden">{x.neden}</td><td data-ad="Gün">{x.gun}</td><td data-ad="Sorumlu">{x.sorumlu ?? '—'}</td><td data-ad="Hedef Tarih">{x.hedef_tarih ? x.hedef_tarih.slice(0, 10).split('-').reverse().join('.') : '—'}</td><td data-ad="10. Gün Yükseltmesi">{x.eskalasyon_zamani ? tarih(x.eskalasyon_zamani) : '—'}</td><td data-ad="45. Gün">{x.gun45_karari ?? (x.gun >= 45 ? 'Karar bekleniyor' : '—')}</td></tr>)}</tbody></table></div> : <div className="not">Açık Beklemede işareti bulunmamaktadır.</div>)}</>;
}
