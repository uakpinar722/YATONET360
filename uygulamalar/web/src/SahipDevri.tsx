import { useState } from 'react';
import { istek } from './api';

/** YG-091: yat satışında sahip devri; önceki sahip geçmişte kalır. */
export function SahipDevri({ yat }: { yat: string }) {
  const [f, setF] = useState({ tarafNo: '', devirTarihi: '', dayanak: '' }); const [m, setM] = useState('');
  const [g, setG] = useState<{ devir_tarihi: string; onceki: string | null; yeni: string; dayanak: string }[] | null>(null);
  return <details className="ozet" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !g) void istek<NonNullable<typeof g>>(`/yat/${yat}/sahip-gecmisi`).then(setG).catch(() => setG([])); }}><summary>Yat Satışı / Sahip Devri</summary>{m && <div className="not" role="status">{m}</div>}
    {g && g.map((x, n) => <div key={n}>{x.devir_tarihi.split('-').reverse().join('.')} · {x.onceki ?? '—'} → {x.yeni} · {x.dayanak}</div>)}
    <label htmlFor="sd-t">Yeni Sahibin Taraf No</label><input required id="sd-t" value={f.tarafNo} onChange={(e) => setF({ ...f, tarafNo: e.target.value })} />
    <label htmlFor="sd-d">Devir Tarihi</label><input required id="sd-d" type="date" value={f.devirTarihi} onChange={(e) => setF({ ...f, devirTarihi: e.target.value })} />
    <label htmlFor="sd-b">Devir Dayanağı (Satış Sözleşmesi, Ruhsat vb.)</label><input required id="sd-b" value={f.dayanak} onChange={(e) => setF({ ...f, dayanak: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.tarafNo.trim() || !f.devirTarihi || !f.dayanak.trim()} onClick={() => void istek<{ acikDosya: number }>(`/yat/${yat}/sahip-devri`, f).then((r) => { setM(`Sahip devri kaydedildi.${r.acikDosya ? ` Açık ${r.acikDosya} dosyanın Dosya Sorumlusuna gözden geçirme görevi açıldı.` : ''}`); setF({ tarafNo: '', devirTarihi: '', dayanak: '' }); setG(null); }).catch((e) => setM(e.message))}>Sahip Devrini Kaydet</button></details>;
}
