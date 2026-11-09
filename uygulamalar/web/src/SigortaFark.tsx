import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { sira_no: number; aciklama: string; tutar_eur: string };
type T = { kimlik: string; teklif_no: string; sigorta_odenecek_eur: string | null; odeme_farki_eur: string | null; odeme_farki_durum: string | null; onayli: number; kalemler: K[] };
const eur = (x: number | string) => `${Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;

/** YG-891, SGF-1: sigortanın bildirdiği ödeme tutarı ve fark kararı (iç ekran). */
export function SigortaFark({ dosya }: { dosya: string }) {
  const [v, setV] = useState<{ yetkili: boolean; teklifler: T[] } | null>(null); const [tut, setTut] = useState<Record<string, string>>({}); const [sec, setSec] = useState<Record<string, Record<number, string>>>({}); const [ne, setNe] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>(`/dosya/${dosya}/sigorta-fark`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!v?.yetkili || !v.teklifler.length) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  const karar = (t: T) => { const s = sec[t.kimlik] ?? {}; const al = (d: string) => Object.entries(s).filter(([, x]) => x === d).map(([k]) => Number(k)); is(istek(`/teklif/${t.kimlik}/odeme-farki`, { neden: ne[t.kimlik] ?? 'Diğer', kapsamdan: al('k'), ayri: al('a') }), 'Fark kararı kaydedildi.'); };
  return <><div className="bolum">Sigorta Ödeme Tutarı</div>{m && <div className="not" role="status">{m}</div>}
    {v.teklifler.map((t) => <div className="soru" key={t.kimlik}><span>{t.teklif_no} · Onaylı (KDV Hariç): {eur(t.onayli)}{t.sigorta_odenecek_eur !== null ? ` · Bildirilen: ${eur(t.sigorta_odenecek_eur)}` : ''}{t.odeme_farki_durum ? ` · Fark: ${eur(t.odeme_farki_eur ?? 0)} · ${t.odeme_farki_durum}` : ''}</span>
      {t.sigorta_odenecek_eur === null && <div className="tam"><label htmlFor={`sf-${t.kimlik}`}>Sigortanın Bildirdiği Ödeme Tutarı (KDV Hariç)</label><input id={`sf-${t.kimlik}`} inputMode="decimal" value={tut[t.kimlik] ?? ''} onChange={(e) => setTut({ ...tut, [t.kimlik]: e.target.value })} /><button className="btn2 kucuk" disabled={!tut[t.kimlik]} onClick={() => is(istek(`/teklif/${t.kimlik}/sigorta-odenecek`, { tutar: Number(String(tut[t.kimlik]).replace(/\./g, '').replace(',', '.')) }), 'Tutar kaydedildi.')}>Kaydet</button></div>}
      {t.odeme_farki_durum === 'Açık' && <div className="tam">
        <label htmlFor={`sn-${t.kimlik}`}>Fark Nedeni</label><select id={`sn-${t.kimlik}`} value={ne[t.kimlik] ?? 'Diğer'} onChange={(e) => setNe({ ...ne, [t.kimlik]: e.target.value })}><option>Diğer</option><option>Muafiyet</option></select>
        {(ne[t.kimlik] ?? 'Diğer') === 'Diğer' && t.kalemler.map((k) => <div key={k.sira_no}><label htmlFor={`sk-${t.kimlik}-${k.sira_no}`}>{k.sira_no}. {k.aciklama} · {eur(k.tutar_eur)}</label><select id={`sk-${t.kimlik}-${k.sira_no}`} value={sec[t.kimlik]?.[k.sira_no] ?? ''} onChange={(e) => setSec({ ...sec, [t.kimlik]: { ...sec[t.kimlik], [k.sira_no]: e.target.value } })}><option value="">Kalsın</option><option value="k">Kapsamdan Çıkar</option><option value="a">Yat Sahibine Ayrı Teklif</option></select></div>)}
        <button className="btn2 kucuk" onClick={() => karar(t)}>Fark Kararını Kaydet</button></div>}</div>)}</>;
}
