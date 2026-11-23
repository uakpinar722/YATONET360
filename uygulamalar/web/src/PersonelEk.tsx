import { useEffect, useState } from 'react';
import { istek } from './api';
import { BelgeSec } from './Kalite';

type V = { zimmetYetkili: boolean; personeller?: { kimlik: string; ad_soyad: string }[]; zimmetlerim: { kimlik: string; ekipman: string; seri_no: string | null; teslim_tarihi: string; iade_zamani: string | null }[]; acikZimmetler: { kimlik: string; ekipman: string; seri_no: string | null; ad_soyad: string }[]; serbestZamanlarim: { nobet_tarihi: string; duzen: string; uygulama_tarihi: string }[]; ozelGun: { evlilik_tarihi: string | null; paylasim_rizasi: boolean } | null };
const tr = (s: string) => s.split('-').reverse().join('.');

/** YG-974 zimmet beyanı, YG-956 nöbet düzeni, YG-947 evlilik tarihi rızası. */
export function PersonelEk() {
  const [v, setV] = useState<V | null>(null); const [z, setZ] = useState({ ekipman: '', seri: '', tarih: '' }); const [iz, setIz] = useState({ personel: '', ekipman: '', seri: '', tarih: '', belge: '' }); /* YG-223 */ const [e, setE] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<V>('/personel-ek').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((x) => setM(x.message));
  return <><div className="bolum">Zimmetlerim</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{v.zimmetlerim.map((x) => <div key={x.kimlik}>{x.ekipman}{x.seri_no ? ` · ${x.seri_no}` : ''} · {tr(x.teslim_tarihi)}{x.iade_zamani ? ' · İade Edildi' : ''}</div>)}{v.serbestZamanlarim.map((x) => <div key={x.nobet_tarihi}>Nöbet {tr(x.nobet_tarihi)} · {x.duzen} · {tr(x.uygulama_tarihi)}</div>)}</div>
    <label htmlFor="pe-e">Teslim Aldığım Ekipman</label><input required id="pe-e" value={z.ekipman} onChange={(x) => setZ({ ...z, ekipman: x.target.value })} />
    <label htmlFor="pe-s">Seri No</label><input id="pe-s" value={z.seri} onChange={(x) => setZ({ ...z, seri: x.target.value })} />
    <label htmlFor="pe-t">Teslim Tarihi</label><input required id="pe-t" type="date" value={z.tarih} onChange={(x) => setZ({ ...z, tarih: x.target.value })} />
    <button className="btn2 kucuk" disabled={!z.ekipman.trim() || !z.tarih} onClick={() => is(istek('/zimmet', z).then(() => setZ({ ekipman: '', seri: '', tarih: '' })), 'Zimmet beyanınız kaydedildi.')}>Beyan Ediyorum</button>
    {v.zimmetYetkili && v.acikZimmetler.map((x) => <div className="soru" key={x.kimlik}><span>{x.ad_soyad} · {x.ekipman}{x.seri_no ? ` · ${x.seri_no}` : ''}</span><button className="btn2 kucuk" onClick={() => is(istek(`/zimmet/${x.kimlik}/iade`, {}), 'İade alındı.')}>İade Alındı</button></div>)}
    {v.zimmetYetkili && <><div className="bolum">Islak İmzalı Zimmet (Sistem Erişimi Olmayan Personel)</div>
      <label htmlFor="pi-p">Personel</label><select required id="pi-p" value={iz.personel} onChange={(x) => setIz({ ...iz, personel: x.target.value, belge: '' })}><option value="">Seçiniz</option>{(v.personeller ?? []).map((p) => <option key={p.kimlik} value={p.kimlik}>{p.ad_soyad}</option>)}</select>
      <label htmlFor="pi-e">Ekipman</label><input required id="pi-e" value={iz.ekipman} onChange={(x) => setIz({ ...iz, ekipman: x.target.value })} />
      <label htmlFor="pi-s">Seri No</label><input id="pi-s" value={iz.seri} onChange={(x) => setIz({ ...iz, seri: x.target.value })} />
      <label htmlFor="pi-t">Teslim Tarihi</label><input required id="pi-t" type="date" value={iz.tarih} onChange={(x) => setIz({ ...iz, tarih: x.target.value })} />
      {iz.personel && <BelgeSec ad="Islak İmzalı Zimmet Belgesi" bagTuru="Personel" bagKimligi={iz.personel} deger={iz.belge} sec={(b) => setIz({ ...iz, belge: b })} />}
      <button className="btn2 kucuk" disabled={!iz.personel || !iz.ekipman.trim() || !iz.tarih || !iz.belge} onClick={() => is(istek('/zimmet/islak-imza', iz).then(() => setIz({ personel: '', ekipman: '', seri: '', tarih: '', belge: '' })), 'Zimmet kaydedildi.')}>Zimmeti Kaydet</button></>}
    <label htmlFor="pe-v">Evlilik Tarihi (paylaşım rızasıyla)</label><input id="pe-v" type="date" value={e || v.ozelGun?.evlilik_tarihi || ''} onChange={(x) => setE(x.target.value)} />
    <button className="btn2 kucuk" disabled={!e} onClick={() => is(istek('/personel-ozel-gun', { riza: true, evlilikTarihi: e }).then(() => setE('')), 'Kaydedildi.')}>Rıza Veriyorum</button>
    {v.ozelGun?.paylasim_rizasi && <button className="btn2 kucuk" onClick={() => is(istek('/personel-ozel-gun', { riza: false }), 'Rıza geri alındı, tarih silindi.')}>Rızamı Geri Alıyorum</button>}</>;
}
