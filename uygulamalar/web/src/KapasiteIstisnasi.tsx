import { useEffect, useState } from 'react';
import { istek } from './api';
import { OnayaGonder } from './Dugme';
import { tarih } from './bicim';

/** YG-1667, TZ-7: kapasitesi dolu firma için Dosya Sorumlusu gerekçeyle istisna ister (Teknik ve Operasyon Direktörü, 24 saat). */
export function KapasiteIstisnaIste({ dosya, firma }: { dosya: string; firma: string }) {
  const [g, setG] = useState(''); const [m, setM] = useState('');
  return <details><summary>Kapasite İstisnası İste</summary>
    <label htmlFor={`ki-${firma}`}>Gerekçe</label><input id={`ki-${firma}`} value={g} onChange={(e) => setG(e.target.value)} />
    <OnayaGonder rol="Teknik ve Operasyon Direktörü" className="btn2 kucuk" disabled={!g.trim()} onClick={() => void istek(`/dosya/${dosya}/kapasite-istisnasi`, { firma, gerekce: g }).then(() => { setM('Talep Teknik ve Operasyon Direktörüne gönderildi; karar 24 saat içinde verilir.'); setG(''); }).catch((e) => setM(e.message))}>Onaya Gönder</OnayaGonder>
    {m && <div className="not" role="status">{m}</div>}
  </details>;
}

type K = { kimlik: string; dosya_no: string; ticari_unvan: string; gerekce: string; talep_zamani: string; kapasite_is: number | null };

/** YG-1667, YG-1668, TZ-7: Teknik ve Operasyon Direktörü üç seçenekten biriyle "Kararı Kaydet" der. */
export function KapasiteIstisnaKarar() {
  const [v, setV] = useState<{ secenekler: string[]; kayitlar: K[] } | null>(null); const [f, setF] = useState<Record<string, { s?: string; a?: string; t?: string }>>({}); const [m, setM] = useState('');
  const yk = () => istek<{ yetkili: boolean; secenekler: string[]; kayitlar: K[] }>('/kapasite-istisnasi').then((r) => setV(r.yetkili ? r : null)).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v || !v.kayitlar.length) return null;
  return <><div className="bolum">Kapasite İstisnası Kararları</div>{m && <div className="not" role="status">{m}</div>}
    {v.kayitlar.map((x) => { const s = f[x.kimlik] ?? {}; const set = (y: typeof s) => setF({ ...f, [x.kimlik]: { ...s, ...y } });
      return <div key={x.kimlik} className="ozet kart-sol"><b>{x.dosya_no} · {x.ticari_unvan}</b><div>Beyan edilen kapasite: {x.kapasite_is ?? '—'} iş · Talep: {tarih(x.talep_zamani)} · {x.gerekce}</div>
        <label htmlFor={`kis-${x.kimlik}`}>Karar</label><select id={`kis-${x.kimlik}`} value={s.s ?? ''} onChange={(e) => set({ s: e.target.value })}><option value="">Seçiniz</option>{v.secenekler.map((o) => <option key={o}>{o}</option>)}</select>
        {s.s === 'Hedef Süre Uzatılarak Kabul' && <><label htmlFor={`kit-${x.kimlik}`}>Yeni Hedef Tarih</label><input id={`kit-${x.kimlik}`} type="date" value={s.t ?? ''} onChange={(e) => set({ t: e.target.value })} /></>}
        <label htmlFor={`kia-${x.kimlik}`}>Karar Açıklaması</label><input id={`kia-${x.kimlik}`} value={s.a ?? ''} onChange={(e) => set({ a: e.target.value })} />
        <div className="dugmeler"><button className="btn evet" disabled={!s.s || !s.a?.trim()} onClick={() => void istek(`/kapasite-istisnasi/${x.kimlik}/karar`, { secenek: s.s, aciklama: s.a, yeniHedef: s.t }).then(() => { setM('Karar kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kararı Kaydet</button></div>
      </div>; })}</>;
}
