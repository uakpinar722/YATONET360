import { useEffect, useState } from 'react';
import { istek } from './api';
import { BelgeSec } from './Kalite';

type R = { kimlik: string; belge_turu: string; konu: string; icerik: string; durum: string; bana: boolean; benim: boolean; kisi: string; hazirlayan: string; dosya_no: string | null; islak_gerekce: string | null };
type V = { kisiler: { kimlik: string; ad_soyad: string }[]; kayitlar: R[] };
const TURLER = ['İç Tutanak', 'Tebliğ', 'Kontrol Listesi', 'Zimmet', 'Devir Tutanağı'];

/** YG-223, YG-1406: iç tutanak, tebliğ, kontrol listesi, zimmet ve devir tutanağı YATONET 360 onayıyla; sistem erişimi yoksa ıslak imza istisnası. */
export function ImzaBeyani() {
  const [v, setV] = useState<V | null>(null); const [m, setM] = useState(''); const [f, setF] = useState({ belgeTuru: 'İç Tutanak', konu: '', icerik: '', kisi: '' });
  const [isl, setIsl] = useState<Record<string, { belge: string; gerekce: string }>>({});
  const yk = () => istek<V>('/imza-beyanlari').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  const bekleyen = v.kayitlar.filter((x) => x.bana && x.durum === 'Onay Bekliyor');
  return <><div className="bolum">Belge Onayları</div>{m && <div className="not" role="status">{m}</div>}
    {bekleyen.map((x) => <details key={x.kimlik} open><summary><b>{x.belge_turu}</b> · {x.konu} · Hazırlayan: {x.hazirlayan}{x.dosya_no ? ` · ${x.dosya_no}` : ''}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{x.icerik}</p>
      <button className="btn2 evet kucuk" onClick={() => is(istek(`/imza-beyani/${x.kimlik}/onayla`, {}), 'Onayınız kaydedildi.')}>Okudum, Onaylıyorum</button></details>)}
    <details><summary>Yeni Belge Onayı İste</summary>
      <label htmlFor="ib-t">Belge Türü</label><select id="ib-t" value={f.belgeTuru} onChange={(e) => setF({ ...f, belgeTuru: e.target.value })}>{TURLER.map((t) => <option key={t}>{t}</option>)}</select>
      <label htmlFor="ib-k">Onaylayacak Kişi</label><select id="ib-k" value={f.kisi} onChange={(e) => setF({ ...f, kisi: e.target.value })}><option value="">Seçiniz</option>{v.kisiler.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad_soyad}</option>)}</select>
      <label htmlFor="ib-o">Konu</label><input id="ib-o" value={f.konu} onChange={(e) => setF({ ...f, konu: e.target.value })} />
      <label htmlFor="ib-i">İçerik</label><textarea id="ib-i" rows={4} value={f.icerik} onChange={(e) => setF({ ...f, icerik: e.target.value })} />
      <button className="btn2" disabled={!f.kisi || !f.konu.trim() || !f.icerik.trim()} onClick={() => is(istek('/imza-beyani', f).then(() => setF({ ...f, konu: '', icerik: '' })), 'Belge onaya gönderildi.')}>Onaya Gönder</button>
    </details>
    {v.kayitlar.some((x) => x.benim) && <table><thead><tr><th>Belge</th><th>Kişi</th><th>Durum</th><th></th></tr></thead><tbody>
      {v.kayitlar.filter((x) => x.benim).map((x) => { const s = isl[x.kimlik] ?? { belge: '', gerekce: '' }; return <tr key={x.kimlik}><td>{x.belge_turu} · {x.konu}</td><td>{x.kisi}</td><td>{x.durum}{x.islak_gerekce ? ` (${x.islak_gerekce})` : ''}</td>
        <td>{x.durum === 'Onay Bekliyor' && <details><summary>Sistem Erişimi Yok · Islak İmza</summary>
          <BelgeSec ad="Islak İmzalı Belge" bagTuru="İmza Beyanı" bagKimligi={x.kimlik} deger={s.belge} sec={(b) => setIsl({ ...isl, [x.kimlik]: { ...s, belge: b } })} />
          <label htmlFor={`ib-g-${x.kimlik}`}>Gerekçe</label><input id={`ib-g-${x.kimlik}`} value={s.gerekce} onChange={(e) => setIsl({ ...isl, [x.kimlik]: { ...s, gerekce: e.target.value } })} />
          <button className="btn2 kucuk" disabled={!s.belge || !s.gerekce.trim()} onClick={() => is(istek(`/imza-beyani/${x.kimlik}/islak-imza`, s), 'Islak imzalı belge kaydedildi.')}>Kaydet</button></details>}</td></tr>; })}
    </tbody></table>}
  </>;
}
