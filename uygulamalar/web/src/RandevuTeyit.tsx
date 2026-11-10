import { useEffect, useState } from 'react';
import { istek } from './api';

type V = { tur: string; zaman: string; yer: string; isTest: string | null; yat: string; dil: 'tr' | 'en'; teyit: string | null };
const T = {
  tr: { b: 'Randevu Teyidi', kat: 'Katılacağım', uyg: 'Uygun Değilim', not: 'Not', ka: 'Kaptan Adı', kt: 'Kaptan Telefonu', gon: 'Gönder', ok: 'Yanıtınız kaydedilmiştir. Teşekkür ederiz.', yer: 'Yer', zaman: 'Tarih-Saat' },
  en: { b: 'Appointment Confirmation', kat: 'I Will Attend', uyg: 'Not Available', not: 'Note', ka: "Captain's Name", kt: "Captain's Telephone", gon: 'Send', ok: 'Your response has been recorded. Thank you.', yer: 'Place', zaman: 'Date-Time' },
};
const EN: Record<string, string> = { 'Keşif': 'Survey', 'Garanti Keşfi': 'Warranty Survey', 'Tanıklık': 'Witness Point', 'Deniz Denemesi': 'Sea Trial' };
/** YG-552: BLD-19–22 bağlantısından uygunluk ve katılım teyidi; deniz denemesinde kaptan bilgisi. */
export function RandevuTeyit({ belirtec }: { belirtec: string }) {
  const [v, setV] = useState<V | null>(null); const [h, setH] = useState(''); const [f, setF] = useState({ yanit: '', not: '', kaptanAd: '', kaptanTelefon: '' }); const [ok, setOk] = useState(false);
  useEffect(() => { void istek<V>(`/randevu-teyit/${belirtec}`).then(setV).catch((e) => setH((e as Error).message)); }, [belirtec]);
  if (!v) return <main className="kart">{h && <div className="hata" role="alert">{h}</div>}</main>;
  const t = T[v.dil];
  return <main className="kart"><h1>{t.b}</h1>{h && <div className="hata" role="alert">{h}</div>}
    <div className="ozet"><div><b>{v.dil === 'en' ? EN[v.tur] ?? v.tur : v.tur}</b> · {v.yat}{v.isTest ? ` · ${v.isTest}` : ''}</div><div>{t.zaman}: {new Date(v.zaman).toLocaleString(v.dil === 'en' ? 'en-GB' : 'tr-TR')}</div><div>{t.yer}: {v.yer}</div></div>
    {ok || v.teyit ? <div className="not" role="status">{t.ok}</div> : <>
      <div className="dugmeler"><button className={f.yanit === 'Katılacağım' ? 'btn' : 'btn2'} onClick={() => setF({ ...f, yanit: 'Katılacağım' })}>{t.kat}</button><button className={f.yanit === 'Uygun Değil' ? 'btn' : 'btn2'} onClick={() => setF({ ...f, yanit: 'Uygun Değil' })}>{t.uyg}</button></div>
      {v.tur === 'Deniz Denemesi' && f.yanit === 'Katılacağım' && <><label htmlFor="rt-ka">{t.ka}</label><input id="rt-ka" value={f.kaptanAd} onChange={(e) => setF({ ...f, kaptanAd: e.target.value })} /><label htmlFor="rt-kt">{t.kt}</label><input id="rt-kt" inputMode="tel" value={f.kaptanTelefon} onChange={(e) => setF({ ...f, kaptanTelefon: e.target.value })} /></>}
      <label htmlFor="rt-n">{t.not}</label><input id="rt-n" value={f.not} onChange={(e) => setF({ ...f, not: e.target.value })} />
      <button className="btn" disabled={!f.yanit} onClick={() => void istek(`/randevu-teyit/${belirtec}`, f).then(() => setOk(true)).catch((e) => setH((e as Error).message))}>{t.gon}</button></>}</main>;
}
