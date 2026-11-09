import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-412: firma, kaptan veya mürettebattan gelen menfaat talebini bildirir. */
export function MenfaatBildir({ isEmri }: { isEmri: string }) {
  const [f, setF] = useState({ kaynak: 'Kaptan', aciklama: '' }); const [m, setM] = useState('');
  return <div className="blok"><div className="bolum">Menfaat Talebi Bildirimi</div>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor={`mf-k-${isEmri}`}>Talebi Yapan</label><select id={`mf-k-${isEmri}`} value={f.kaynak} onChange={(e) => setF({ ...f, kaynak: e.target.value })}><option>Kaptan</option><option>Mürettebat</option></select>
    <label htmlFor={`mf-a-${isEmri}`}>Açıklama</label><textarea id={`mf-a-${isEmri}`} rows={2} value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.aciklama.trim()} onClick={() => void istek(`/firma-portal/is-emri/${isEmri}/menfaat-bildirimi`, f).then(() => { setM('Bildiriminiz iletildi.'); setF({ ...f, aciklama: '' }); }).catch((e) => setM(e.message))}>Bildir</button></div>;
}

type MB = { kimlik: string; kaynak: string; aciklama: string; is_emri_no: string; ticari_unvan: string };
/** YG-412: bildirimleri yalnız Hukuk ve Uyum Direktörü görür. */
export function MenfaatListesi() {
  const [l, setL] = useState<MB[] | null>(null);
  useEffect(() => { void istek<MB[]>('/menfaat-bildirimleri').then(setL).catch(() => setL(null)); }, []);
  if (!l?.length) return null;
  return <><div className="bolum">Menfaat Bildirimleri</div><div className="ozet">{l.map((x) => <div key={x.kimlik}>{x.is_emri_no} · {x.ticari_unvan} · {x.kaynak} · {x.aciklama}</div>)}</div></>;
}

type FA = { kimlik: string; masraf_turu: string; fis_tarihi: string; belge_ozeti: string; ad_soyad: string };
/** YG-1622: kâğıt fiş aslının teslim alınması. */
export function FisAsliTeslim() {
  const [l, setL] = useState<FA[] | null>(null); const [m, setM] = useState('');
  const yk = () => istek<FA[]>('/masraf/asil-bekleyen').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l?.length) return null;
  return <><div className="bolum">Teslim Edilecek Fiş Asılları</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div className="soru" key={x.kimlik}><span>{x.ad_soyad} · {x.masraf_turu} · {x.fis_tarihi.split('-').reverse().join('.')} · {x.belge_ozeti}</span><button className="btn2 kucuk" onClick={() => void istek(`/masraf/${x.kimlik}/asil-teslim`, {}).then(() => { setM('Teslim alındı.'); return yk(); }).catch((e) => setM(e.message))}>Asıl Teslim Edildi</button></div>)}</>;
}
