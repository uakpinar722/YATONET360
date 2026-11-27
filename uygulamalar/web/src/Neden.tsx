import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-1387: hukuki gerekçe ve ilgili belge bölümü yalnız "Neden?" bağlantısında; onaylı metin yoksa bağlantı görünmez. */
export function NedenBaglantisi({ tur }: { tur: string }) {
  const [m, setM] = useState<{ metin: string | null; belgeBolumu?: string | null } | null>(null); const [acik, setAcik] = useState(false);
  useEffect(() => { void istek<{ metin: string | null; belgeBolumu?: string | null }>(`/neden?tur=${encodeURIComponent(tur)}`).then(setM).catch(() => setM(null)); }, [tur]);
  if (!m?.metin) return null;
  return <div><button type="button" className="baglanti" aria-expanded={acik} onClick={() => setAcik(!acik)}>Neden?</button>
    {acik && <div className="not" style={{ whiteSpace: 'pre-wrap' }}>{m.metin}{m.belgeBolumu ? <div><b>İlgili Belge Bölümü:</b> {m.belgeBolumu}</div> : null}</div>}</div>;
}

type V = { turler: string[]; metinler: { kart_turu: string; surum: number; metin: string; belge_bolumu: string | null; durum: string }[] };
/** YG-1387, HG-1: Neden? metinlerini Hukuk ve Uyum hazırlar, CEO onaylar. */
export function NedenMetinleri() {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ tur: '', metin: '', belgeBolumu: '' }); const [m, setM] = useState('');
  const yk = () => istek<V>('/neden-metinleri').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const durum = (t: string) => v.metinler.find((x) => x.kart_turu === t)?.durum ?? 'Metin yok';
  return <><div className="bolum">Neden? Metinleri</div>{m && <div className="not" role="status">{m}</div>}
    <table><thead><tr><th>İş Türü</th><th>Durum</th></tr></thead><tbody>{v.turler.map((t) => <tr key={t}><td>{t}</td><td>{durum(t)}</td></tr>)}</tbody></table>
    <label htmlFor="nm-t">İş Türü</label><select id="nm-t" value={f.tur} onChange={(e) => { const x = v.metinler.find((z) => z.kart_turu === e.target.value); setF({ tur: e.target.value, metin: x?.metin ?? '', belgeBolumu: x?.belge_bolumu ?? '' }); }}><option value="">Seçiniz</option>{v.turler.map((t) => <option key={t}>{t}</option>)}</select>
    <label htmlFor="nm-m">Hukuki Gerekçe</label><textarea id="nm-m" rows={4} value={f.metin} onChange={(e) => setF({ ...f, metin: e.target.value })} />
    <label htmlFor="nm-b">İlgili Belge Bölümü</label><input id="nm-b" value={f.belgeBolumu} onChange={(e) => setF({ ...f, belgeBolumu: e.target.value })} />
    <button className="btn2" disabled={!f.tur || !f.metin.trim()} onClick={() => void istek('/neden-metni', f).then(() => { setM('Metin CEO onayına gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></>;
}
