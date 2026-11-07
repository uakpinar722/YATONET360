import { useEffect, useState } from 'react';
import { istek } from './api';

type Durum = { gerekli: boolean; sorumlu: string | null; taraflar: { kimlik: string; kisi_adi_soyadi: string; taraf_rolu: string }[]; ekip: { kimlik: string; ad_soyad: string }[] };

/** YG-110: kışa sarkan dosyada kışlık hazırlık sorumlusu (dosya ekibinden personel ya da dosya tarafı). */
export function KislikSorumlusu({ dosya }: { dosya: string }) {
  const [d, setD] = useState<Durum | null>(null); const [sec, setSec] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<Durum>(`/dosya/${dosya}/kislik`).then(setD).catch(() => setD(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!d || (!d.gerekli && !d.sorumlu)) return null;
  const kaydet = () => { const [t, k] = sec.split(':'); void istek(`/dosya/${dosya}/kislik`, t === 'p' ? { kullanici: k } : { taraf: k }).then(() => { setM('Kışlık hazırlık sorumlusu kaydedildi.'); setSec(''); return yk(); }).catch((e) => setM(e.message)); };
  return <><div className="bolum">Kışlık Hazırlık</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">Kışlık Hazırlık Sorumlusu: {d.sorumlu ?? <b>Belirlenmedi</b>}</div>
    <label htmlFor="ks-s">Kışlık Hazırlık Sorumlusu Seçimi</label>
    <select id="ks-s" value={sec} onChange={(e) => setSec(e.target.value)}><option value="">Seçiniz</option>
      <optgroup label="Dosya Ekibi">{d.ekip.map((x) => <option key={x.kimlik} value={`p:${x.kimlik}`}>{x.ad_soyad}</option>)}</optgroup>
      <optgroup label="Dosya Tarafları">{d.taraflar.map((x) => <option key={x.kimlik} value={`t:${x.kimlik}`}>{x.kisi_adi_soyadi} ({x.taraf_rolu})</option>)}</optgroup>
    </select>
    <button className="btn2 kucuk" disabled={!sec} onClick={kaydet}>Kaydet</button></>;
}
