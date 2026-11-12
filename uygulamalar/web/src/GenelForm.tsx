import { useEffect, useState } from 'react';
import { istek } from './api';

type Alan = { teknik: string; alan: string; tip: string; zorunlu: boolean; kosul: string | null; secenekler?: { id: string; etiket: string }[]; coklu?: boolean; enFazla?: number; aciklama: string };
type Tanim = { kod: string; ad: string; surum: number; onaylayan: string | null; alanlar: Alan[] };
type Kayit = { kimlik: string; kayit_no: string; form_kodu: string; ad: string; form_surumu: number; durum: string; iade_nedeni: string | null; veriler: Record<string, unknown> };
const GIRDI: Record<string, string> = { Tarih: 'date', 'Tarih-saat': 'datetime-local', 'Tam sayı': 'number', Ondalık: 'number', Para: 'number', Yüzde: 'number' };

/** YG-632: ayrı tablosu olmayan Ek II araçlarının ekranı alan sözlüğünden üretilir. */
export function GenelForm({ dosya, isEmri }: { dosya?: string; isEmri?: string }) {
  const bag = isEmri ? `isEmri=${isEmri}` : dosya ? `dosya=${dosya}` : '';
  const [araclar, setAraclar] = useState<{ kod: string; ad: string }[]>([]); const [l, setL] = useState<Kayit[]>([]);
  const [kod, setKod] = useState(''); const [t, setT] = useState<Tanim | null>(null); const [v, setV] = useState<Record<string, unknown>>({}); const [duzelt, setDuzelt] = useState<string | null>(null); const [m, setM] = useState('');
  const yk = () => void istek<Kayit[]>(`/form-kaydi?${bag}`).then(setL).catch(() => setL([]));
  useEffect(() => { void istek<{ kod: string; ad: string }[]>(`/form-genel${bag ? '' : '?dosyasiz=1'}`).then(setAraclar).catch(() => setAraclar([])); yk(); }, [bag]); // eslint-disable-line react-hooks/exhaustive-deps
  const ac = (k: string, kayit?: Kayit) => { setKod(k); setM(''); setDuzelt(kayit?.kimlik ?? null); setV(kayit?.veriler ?? {}); if (k) void istek<Tanim>(`/form/${k}/tanim?${bag}`).then(setT).catch((e) => { setT(null); setM(e.message); }); else setT(null); };
  const kaydet = () => void (duzelt ? istek(`/form-kaydi/${duzelt}`, { veriler: v }) : istek('/form-kaydi', { kod, ...(isEmri ? { isEmri } : dosya ? { dosya } : {}), veriler: v }))
    .then(() => { setM('Kaydedildi.'); ac(''); yk(); }).catch((e) => setM(e.message));
  const gonder = (id: string) => void istek<{ durum: string; gonderilecek?: string }>(`/form-kaydi/${id}/gonder`, {}).then((r) => { setM(r.gonderilecek ? `Kontrole gönderildi: ${r.gonderilecek}` : 'Onaylandı.'); yk(); }).catch((e) => setM(e.message));
  if (!araclar.length && !l.length) return null;
  const alan = (a: Alan) => {
    const id = `gf-${a.teknik}`; const d = v[a.teknik];
    const set = (x: unknown) => setV({ ...v, [a.teknik]: x });
    let g;
    if (a.secenekler && a.coklu) g = <div id={id}>{a.secenekler.map((s) => <label className="kutu" key={s.id}><input type="checkbox" checked={Array.isArray(d) && d.includes(s.id)} onChange={(e) => set(e.target.checked ? [...(Array.isArray(d) ? d : []), s.id] : (Array.isArray(d) ? d : []).filter((x) => x !== s.id))} /><span>{s.etiket}</span></label>)}</div>;
    else if (a.secenekler && (a.tip !== 'Referans' || a.secenekler.length)) g = <select id={id} value={String(d ?? '')} onChange={(e) => set(e.target.value)}><option value="">Seçiniz</option>{a.secenekler.map((s) => <option key={s.id} value={s.id}>{s.etiket}</option>)}</select>;
    else if (a.tip === 'Uzun metin') g = <textarea id={id} maxLength={a.enFazla} value={String(d ?? '')} onChange={(e) => set(e.target.value)} />;
    else g = <input id={id} type={GIRDI[a.tip] ?? 'text'} value={String(d ?? '')} onChange={(e) => set(e.target.value)} />;
    return <div key={a.teknik}><label htmlFor={id}>{a.alan}{a.zorunlu ? ' *' : ''}</label>{g}{a.kosul && <small>{a.kosul}</small>}</div>;
  };
  return <details><summary>Sözlükten Üretilen Formlar · {l.length} kayıt</summary>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div className={x.durum === 'Onaylı' ? 'soru' : 'soru hata'} key={x.kimlik}><span>{x.kayit_no} · {x.ad} · R{x.form_surumu} · {x.durum}{x.iade_nedeni ? ` · İade: ${x.iade_nedeni}` : ''}</span>
      {x.durum === 'Açık' && <div className="dugmeler"><button className="btn2 kucuk" onClick={() => ac(x.form_kodu, x)}>Düzelt</button><button className="btn2 kucuk" onClick={() => gonder(x.kimlik)}>Kontrole Gönder</button></div>}</div>)}
    <label htmlFor="gf-kod">Yeni Form</label><select id="gf-kod" value={duzelt ? '' : kod} onChange={(e) => ac(e.target.value)}><option value="">Seçiniz</option>{araclar.map((a) => <option key={a.kod} value={a.kod}>{a.kod} · {a.ad}</option>)}</select>
    {t && <div className="izgara"><b>{t.kod} · {t.ad} · R{t.surum}</b>{t.alanlar.map(alan)}
      <div className="not">{t.onaylayan && t.onaylayan !== '—' ? `Gönderilecek: ${t.onaylayan}` : 'Kontrol gerektirmez; gönderilince onaylı olur.'}</div>
      <button className="btn kucuk" onClick={kaydet}>{duzelt ? 'Düzeltmeyi Kaydet' : 'Kaydet'}</button></div>}</details>;
}
