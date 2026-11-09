import { useEffect, useState } from 'react';
import { istek } from './api';

type V = { ozetDurum: string | null; ozetYenilenir: boolean; kapali: boolean; oncelik: string; hedef: string | null; teslim: string | null; sureler: { tur: string; hedef: string; tamamlanma: string | null }[]; ilkSeferde: { n: number; k: number }; uygunsuzluk: { sinif: string; n: number }[]; memnuniyet: string | null; kayit: { sapma_nedeni: string; denetim_sinifi: string | null; denetim_bulgulari: string; firma_karne_etkisi: string; durum: string } | null; duzenleyebilir: boolean };
const z = (x: string | null) => (x ? new Date(x).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const t = (x: string | null) => (x ? x.split('-').reverse().join('.') : '—');

/** YG-785, YG-786: FR-KLT-011 Dosya Performans Değerlendirmesi. */
export function DosyaPerformans({ dosya }: { dosya: string }) {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ sapma: '', sinif: '', bulgular: '', etki: '' }); const [m, setM] = useState('');
  const yk = () => istek<V>(`/dosya/${dosya}/performans`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!v?.kapali) return null;
  const A = (k: keyof typeof f, et: string) => <><label htmlFor={`dp-${k}`}>{et}</label><input id={`dp-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <div className="blok"><div className="bolum">Dosya Performans Değerlendirmesi</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet"><div>Öncelik: {v.oncelik}</div>{v.sureler.map((x) => <div key={x.tur}>{x.tur} · Hedef: {z(x.hedef)} · Gerçekleşen: {z(x.tamamlanma)}</div>)}<div>Teslim · Hedef: {t(v.hedef)} · Gerçekleşen: {t(v.teslim)}</div><div>İlk Seferde Kabul: {v.ilkSeferde.k} / {v.ilkSeferde.n}</div><div>Uygunsuzluk: {v.uygunsuzluk.length ? v.uygunsuzluk.map((x) => `${x.sinif} ${x.n}`).join(' · ') : 'Yok'}</div><div>Müşteri Memnuniyet Puanı: {v.memnuniyet ?? '—'}</div><div>Nihai Kapanış Özeti: {v.ozetDurum ?? '—'}</div>
      {v.kayit && <><div>Durum: {v.kayit.durum}</div><div>Sapma Nedeni: {v.kayit.sapma_nedeni}</div><div>Denetim Bulguları: {v.kayit.denetim_bulgulari}</div><div>Firma Karnesine Etki: {v.kayit.firma_karne_etkisi}</div></>}</div>
    {v.ozetYenilenir && <button className="btn2 kucuk" onClick={() => void istek(`/dosya/${dosya}/kapanis-ozeti/yeniden`, {}).then(() => { setM('Nihai Kapanış Özeti yeniden onaya gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Özeti Yeniden Onaya Gönder</button>}
    {v.duzenleyebilir && (!v.kayit || v.kayit.durum === 'İade') && <>{A('sapma', 'Sapma Nedeni')}{A('sinif', 'Denetim Bulgusu Sınıfı')}{A('bulgular', 'Denetim Bulguları')}{A('etki', 'Firma Karnesine Etki')}<button className="btn2 kucuk" disabled={!f.sapma.trim() || !f.bulgular.trim() || !f.etki.trim()} onClick={() => void istek(`/dosya/${dosya}/performans`, f).then(() => { setM('Değerlendirme onaya gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></>}</div>;
}
