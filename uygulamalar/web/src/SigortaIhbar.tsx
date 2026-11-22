import { useEffect, useState } from 'react';
import { istek } from './api';

const BOS = { hasarNo: '', policeNo: '', yatAdi: '', konum: '', ozet: '', sahipAd: '', sahipTel: '', yetkili: '', hizmet: '' };

/** YG-438, YG-446: sigorta şirketi kullanıcısının hasar ihbarı (Sigorta Görevlendirmesi); hasar dosya no zorunlu, poliçe no isteğe bağlı. */
export function SigortaIhbar({ sonra }: { sonra: () => void }) {
  const [f, setF] = useState(BOS); const [m, setM] = useState(''); const [ac, setAc] = useState(false);
  const A = (k: keyof typeof BOS, et: string) => <><label htmlFor={`si-${k}`}>{et}</label><input id={`si-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <details className="ozet" open={ac} onToggle={(e) => setAc((e.target as HTMLDetailsElement).open)}><summary>Hasar İhbarı / Görevlendirme</summary>{m && <div className="not" role="status">{m}</div>}
    {A('hasarNo', 'Hasar Dosya No')}{A('policeNo', 'Poliçe No (Varsa)')}{A('yatAdi', 'Yat Adı')}{A('konum', 'Yatın Bulunduğu Yer')}
    <label htmlFor="si-ozet">Olay Özeti</label><textarea required id="si-ozet" value={f.ozet} onChange={(e) => setF({ ...f, ozet: e.target.value })} />
    {A('hizmet', 'İstenen Hizmet')}{A('yetkili', 'Dosya Yetkilisi (Ad, Telefon)')}{A('sahipAd', 'Yat Sahibi Adı (Varsa)')}{A('sahipTel', 'Yat Sahibi Telefonu (Varsa)')}
    <button className="btn2" disabled={!f.hasarNo.trim() || !f.yatAdi.trim() || !f.konum.trim() || !f.ozet.trim()} onClick={() => void istek<{ talepNo: string }>('/sigorta/gorevlendirme', f).then((r) => { setM(`İhbarınız ${r.talepNo} numarasıyla alındı.`); setF(BOS); sonra(); }).catch((e) => setM(e.message))}>İhbarı Gönder</button></details>;
}

type Rapor = { kimlik: string; donem: string; kesim_tarihi: string; itiraz_son: string | null; durum: string; satirlar: { kimlik: string; dosya_no: string; fatura_no: string; acik_bakiye: string; itiraz_edildi: boolean; mutabik: boolean }[] };
/** YG-1571: Raporlar; aylık mutabakat raporu ve itiraz süresi içinde satır bazında "İtiraz Et". */
export function SigortaMutabakat() {
  const [l, setL] = useState<Rapor[] | null>(null); const [n, setN] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<Rapor[]>('/sigorta/mutabakat').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const bugun = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  return <details className="ozet"><summary>Raporlar · Aylık Mutabakat</summary>{m && <div className="not" role="status">{m}</div>}
    {l.length === 0 ? <div className="not">Gönderilmiş mutabakat raporu bulunmamaktadır.</div> : l.map((r) => <div key={r.kimlik}><b>{r.donem} · {r.durum}{r.itiraz_son ? ` · İtiraz Son: ${r.itiraz_son.split('-').reverse().join('.')}` : ''}</b>
      {r.satirlar.map((s) => <div key={s.kimlik} className="soru"><span>{s.dosya_no} · {s.fatura_no} · Açık Bakiye: {Number(s.acik_bakiye).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR{s.itiraz_edildi ? ' · İtiraz Edildi' : ''}{s.mutabik ? ' · Mutabık' : ''}</span>
        {!s.itiraz_edildi && !s.mutabik && r.itiraz_son && r.itiraz_son >= bugun && <div className="tam"><label htmlFor={`sm-${s.kimlik}`}>İtiraz Notu</label><input id={`sm-${s.kimlik}`} value={n[s.kimlik] ?? ''} onChange={(e) => setN({ ...n, [s.kimlik]: e.target.value })} />
          <button className="btn hayir" disabled={!(n[s.kimlik] ?? '').trim()} onClick={() => void istek(`/mutabakat-satiri/${s.kimlik}/itiraz`, { not: n[s.kimlik] }).then(() => { setM('İtirazınız kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>İtiraz Et</button></div>}</div>)}</div>)}</details>;
}
