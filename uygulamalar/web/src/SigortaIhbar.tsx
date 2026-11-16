import { useState } from 'react';
import { istek } from './api';

const BOS = { hasarNo: '', policeNo: '', yatAdi: '', konum: '', ozet: '', sahipAd: '', sahipTel: '', yetkili: '', hizmet: '' };

/** YG-438, YG-446: sigorta şirketi kullanıcısının hasar ihbarı (Sigorta Görevlendirmesi); hasar dosya no zorunlu, poliçe no isteğe bağlı. */
export function SigortaIhbar({ sonra }: { sonra: () => void }) {
  const [f, setF] = useState(BOS); const [m, setM] = useState(''); const [ac, setAc] = useState(false);
  const A = (k: keyof typeof BOS, et: string) => <><label htmlFor={`si-${k}`}>{et}</label><input id={`si-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <details className="ozet" open={ac} onToggle={(e) => setAc((e.target as HTMLDetailsElement).open)}><summary>Hasar İhbarı / Görevlendirme</summary>{m && <div className="not" role="status">{m}</div>}
    {A('hasarNo', 'Hasar Dosya No')}{A('policeNo', 'Poliçe No (Varsa)')}{A('yatAdi', 'Yat Adı')}{A('konum', 'Yatın Bulunduğu Yer')}
    <label htmlFor="si-ozet">Olay Özeti</label><textarea id="si-ozet" value={f.ozet} onChange={(e) => setF({ ...f, ozet: e.target.value })} />
    {A('hizmet', 'İstenen Hizmet')}{A('yetkili', 'Dosya Yetkilisi (Ad, Telefon)')}{A('sahipAd', 'Yat Sahibi Adı (Varsa)')}{A('sahipTel', 'Yat Sahibi Telefonu (Varsa)')}
    <button className="btn2" disabled={!f.hasarNo.trim() || !f.yatAdi.trim() || !f.konum.trim() || !f.ozet.trim()} onClick={() => void istek<{ talepNo: string }>('/sigorta/gorevlendirme', f).then((r) => { setM(`İhbarınız ${r.talepNo} numarasıyla alındı.`); setF(BOS); sonra(); }).catch((e) => setM(e.message))}>İhbarı Gönder</button></details>;
}
