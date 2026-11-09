import { useEffect, useState } from 'react';
import { istek } from './api';

type F = { kimlik: string; fatura_no: string | null; proforma_no: string; dosya_no: string; toplam_eur: string; tahsil_edilen_eur: string };
type V = { sigortacilar: string[]; faturalar: F[]; odemeler: { kimlik: string; sigortaci_adi: string; toplam_eur: string; tarih: string; banka_referansi: string }[] };
const sayi = (x: string) => Number(x.replace(/\./g, '').replace(',', '.'));
const eur = (x: number) => `${x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;

/** YG-902: sigortacının toplu ödemesi dağılım bildirimiyle faturalara dağıtılır. */
export function TopluOdeme() {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ sigortaci: '', tarih: '', referans: '', bildirim: '' }); const [d, setD] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = (s = f.sigortaci) => istek<V>(`/sigorta-toplu-odeme?sigortaci=${encodeURIComponent(s)}`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(''); }, []);
  if (!v) return null;
  const toplam = Object.values(d).reduce((t, x) => t + (sayi(x) || 0), 0);
  const kaydet = () => void istek('/sigorta-toplu-odeme', { ...f, toplam: Math.round(toplam * 100) / 100, dagilim: Object.entries(d).filter(([, x]) => sayi(x) > 0).map(([fatura, x]) => ({ fatura, tutar: sayi(x) })) }).then(() => { setM('Toplu ödeme dosyalara dağıtıldı.'); setD({}); setF({ ...f, referans: '', bildirim: '' }); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Sigorta Toplu Ödemesi</div>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="tp-s">Sigorta Şirketi</label><select id="tp-s" value={f.sigortaci} onChange={(e) => { setF({ ...f, sigortaci: e.target.value }); setD({}); void yk(e.target.value); }}><option value="">Seçiniz</option>{v.sigortacilar.map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="tp-t">Ödeme Tarihi</label><input id="tp-t" type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} />
    <label htmlFor="tp-r">Banka Referansı</label><input id="tp-r" value={f.referans} onChange={(e) => setF({ ...f, referans: e.target.value })} />
    <label htmlFor="tp-b">Dağılım Bildirimi No</label><input id="tp-b" value={f.bildirim} onChange={(e) => setF({ ...f, bildirim: e.target.value })} />
    {v.faturalar.map((x) => { const kalan = Number(x.toplam_eur) - Number(x.tahsil_edilen_eur); return <div className="soru" key={x.kimlik}><span>{x.dosya_no} · {x.fatura_no ?? x.proforma_no} · Kalan: {eur(kalan)}</span><label htmlFor={`tp-${x.kimlik}`}>Dağıtılan Tutar (EUR)</label><input id={`tp-${x.kimlik}`} inputMode="decimal" value={d[x.kimlik] ?? ''} onChange={(e) => setD({ ...d, [x.kimlik]: e.target.value })} /></div>; })}
    {f.sigortaci && <div className="not">Dağılım Toplamı: {eur(toplam)}</div>}
    <button className="btn2 kucuk" disabled={!f.sigortaci || !f.tarih || !f.referans.trim() || !f.bildirim.trim() || !(toplam > 0)} onClick={kaydet}>Dosyalara Dağıt</button></>;
}
