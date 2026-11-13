import { useState } from 'react';
import { istek } from './api';
import { BelgeSec } from './Kalite';

/** YG-589: marinada imzalatılan ön bilgilendirme nüshası ve kâğıt cayma formu (Dosya Sorumlusu). */
export function ImzaliNusha({ dosya, teklifler, yap }: { dosya: string; teklifler: { kimlik: string; teklif_no: string; surum_no: number; teklif_muhatabi: string }[]; yap: (f: () => Promise<unknown>, m?: string) => Promise<void> }) {
  const [t, setT] = useState(''); const [ob, setOb] = useState(''); const [cf, setCf] = useState('');
  const yt = teklifler.filter((x) => x.teklif_muhatabi === 'Yat Sahibi');
  return <><div className="bolum">İmzalı Nüshalar</div><div className="ozet">
    <label htmlFor="in-t">Teklif</label><select id="in-t" value={t} onChange={(e) => setT(e.target.value)}><option value="">Seçiniz</option>{yt.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.teklif_no} Rev.{x.surum_no}</option>)}</select>
    <BelgeSec ad="İmzalı Ön Bilgilendirme Nüshası" bagTuru="Dosya" bagKimligi={dosya} deger={ob} sec={setOb} />
    <button className="btn2 kucuk" disabled={!t || !ob} onClick={() => void yap(() => istek(`/teklif/${t}/imzali-on-bilgi`, { belge: ob }), 'İmzalı nüsha teklife bağlandı.')}>Nüshayı Bağla</button>
    <BelgeSec ad="İmzalı Cayma Formu" bagTuru="Dosya" bagKimligi={dosya} deger={cf} sec={setCf} />
    <button className="btn2 kucuk" disabled={!cf} onClick={() => void yap(() => istek(`/dosya/${dosya}/cayma-formu`, { belge: cf }), 'Cayma bildirimi kaydedildi; iade hesabı görevi açıldı.')}>Cayma Formunu Kaydet</button>
  </div></>;
}
