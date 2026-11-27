import { useState } from 'react';
import { istek } from './api';

type B = { bolge_kodu: string; gorunus: string[]; referans_hat: string; boyuna_konum_m: string; enine_konum_cm: string | null; alan_miktar: string | null; birim: string | null; cizim_isaret: { n?: [number, number][] } | null; surum: number; incelenmedi: boolean };
const GORUNUS = ['Profil', 'Plan'] as const;
const G = 400; const Y = 130;
/** Genel tekne altlığı (ölçeksiz): profil ve plan görünüşü; çizim noktaları 0–100 yüzde koordinatıdır. */
const ALTLIK: Record<string, string> = {
  Profil: 'M 20 55 L 360 55 L 385 40 L 380 70 Q 300 105 120 100 L 30 90 Z',
  Plan: 'M 20 40 L 300 30 Q 385 45 390 65 Q 385 85 300 100 L 20 90 Z',
};
const nokta = (p: [number, number][]) => p.map(([x, y]) => `${(x / 100) * G},${(y / 100) * Y}`).join(' ');

/** YG-131, YG-132, YG-704: hasar bölgesi altlık üzerinde çizilir; her kayıt yeni sürümdür, önceki sınır silinmez; incelenmemiş bölge ayrı durumda gösterilir. */
export function HasarBolgesi({ dosya, bolgeler, yenile }: { dosya: string; bolgeler: B[]; yenile: () => void }) {
  const [gor, setGor] = useState<string>('Profil'); const [p, setP] = useState<[number, number][]>([]); const [m, setM] = useState('');
  const [f, setF] = useState({ kod: '', hat: '', boyuna: '', enine: '', miktar: '', birim: 'm²', incelenmedi: false });
  const tikla = (e: React.MouseEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); setP([...p, [Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, Math.round(((e.clientY - r.top) / r.height) * 1000) / 10]]); };
  const kaydet = () => void istek<{ surum: number }>(`/dosya/${dosya}/bolge`, { kod: f.kod.trim().toUpperCase(), gorunus: [gor], isaret: { n: p }, hat: f.hat, boyuna: f.boyuna, enine: f.enine || undefined, miktar: f.miktar ? Number(f.miktar.replace(',', '.')) : undefined, birim: f.miktar ? f.birim : undefined, incelenmedi: f.incelenmedi })
    .then((r) => { setM(`Bölge ${f.kod.toUpperCase()} kaydedildi (Rev.${r.surum}).`); setP([]); yenile(); }).catch((e) => setM(e.message));
  return <details><summary>Hasar Haritası ({bolgeler.length} bölge)</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="dugmeler">{GORUNUS.map((x) => <button key={x} className={x === gor ? 'btn2 kucuk evet' : 'btn2 kucuk'} onClick={() => { setGor(x); setP([]); }}>{x}</button>)}</div>
    <svg viewBox={`0 0 ${G} ${Y}`} role="img" aria-label={`${gor} görünüşü hasar haritası`} style={{ width: '100%', maxWidth: 640, border: '1px solid var(--cizgi, #ccd)', cursor: 'crosshair', background: 'var(--zemin2, #f7f9fc)' }} onClick={tikla}>
      <path d={ALTLIK[gor]} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
      {bolgeler.filter((b) => b.gorunus.includes(gor) && b.cizim_isaret?.n?.length).map((b) => <g key={b.bolge_kodu}>
        <polygon points={nokta(b.cizim_isaret!.n!)} fill={b.incelenmedi ? 'rgba(220,160,0,0.25)' : 'rgba(200,30,30,0.25)'} stroke={b.incelenmedi ? '#b07a00' : '#b01e1e'} strokeDasharray={b.incelenmedi ? '4 3' : undefined} />
        <text x={(b.cizim_isaret!.n![0]![0] / 100) * G} y={(b.cizim_isaret!.n![0]![1] / 100) * Y - 3} fontSize="10">{b.bolge_kodu}</text></g>)}
      {p.length > 0 && <polyline points={nokta(p)} fill="rgba(30,80,200,0.15)" stroke="#1e50c8" />}
    </svg>
    <div className="not">Altlık ölçeksizdir; bölge sınırını görünüş üzerinde tıklayarak çiziniz. Kırmızı: incelenen hasar bölgesi · Sarı kesik çizgi: incelenmemiş bölge.</div>
    {bolgeler.length > 0 && <table><thead><tr><th>Bölge</th><th>Görünüş</th><th>Referans Hat · Boyuna</th><th>Alan</th><th>Durum</th></tr></thead><tbody>
      {bolgeler.map((b) => <tr key={b.bolge_kodu}><td>{b.bolge_kodu} · Rev.{b.surum}</td><td>{b.gorunus.join(', ')}</td><td>{b.referans_hat} · {b.boyuna_konum_m} m{b.enine_konum_cm ? ` · ${b.enine_konum_cm} cm` : ''}</td><td>{b.alan_miktar ? `${String(b.alan_miktar).replace('.', ',')} ${b.birim ?? ''}` : '—'}</td><td>{b.incelenmedi ? 'İncelenmedi' : 'İncelendi'}</td></tr>)}
    </tbody></table>}
    <div className="bolum">Bölge Kaydı (yeni sürüm)</div>
    <label htmlFor="hb-k">Bölge Kodu (ör. S1, P1)</label><input id="hb-k" value={f.kod} onChange={(e) => setF({ ...f, kod: e.target.value })} />
    <label htmlFor="hb-h">Referans Hat</label><input id="hb-h" value={f.hat} onChange={(e) => setF({ ...f, hat: e.target.value })} />
    <label htmlFor="hb-b">Boyuna Konum (m)</label><input id="hb-b" value={f.boyuna} onChange={(e) => setF({ ...f, boyuna: e.target.value })} />
    <label htmlFor="hb-e">Enine Konum (cm)</label><input id="hb-e" value={f.enine} onChange={(e) => setF({ ...f, enine: e.target.value })} />
    <label htmlFor="hb-m">Alan Miktarı</label><input id="hb-m" inputMode="decimal" value={f.miktar} onChange={(e) => setF({ ...f, miktar: e.target.value })} />
    <label className="kutu"><input type="checkbox" checked={f.incelenmedi} onChange={(e) => setF({ ...f, incelenmedi: e.target.checked })} /><span>Bu bölge incelenemedi</span></label>
    <div className="dugmeler"><button className="btn2" disabled={!/^[A-Za-z]{1,2}[0-9]{1,3}$/.test(f.kod.trim()) || !f.hat.trim() || !f.boyuna.trim() || p.length < 2} onClick={kaydet}>Bölgeyi Kaydet</button>{p.length > 0 && <button className="btn2 kucuk hayir" onClick={() => setP([])}>Çizimi Temizle</button>}</div>
  </details>;
}
