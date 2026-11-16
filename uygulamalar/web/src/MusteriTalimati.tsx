import { useState } from 'react';
import { istek } from './api';

/** YG-437: kurumsal müşteri dosyasında LGM'yi görevlendiren Müşteri Talimatı (Dosya Sorumlusu kaydeder; BLD-67 kurumsal onay e-postasına gider). */
export function MusteriTalimati({ dosya }: { dosya: string }) {
  const [f, setF] = useState({ kanal: 'Portal', limit: '', hedef: '', metin: '' }); const [m, setM] = useState('');
  const kaydet = () => void istek<{ talimatNo: string; bildirim: boolean }>(`/dosya/${dosya}/musteri-talimati`, { kanal: f.kanal, limit: Number(f.limit.replace(/\./g, '').replace(',', '.')), hedef: f.hedef, metin: f.metin }).then((r) => { setM(`${r.talimatNo} kaydedildi.${r.bildirim ? ' Müşteriye alındı bildirimi gönderildi.' : ''}`); setF({ kanal: 'Portal', limit: '', hedef: '', metin: '' }); }).catch((e) => setM(e.message));
  return <><div className="bolum">Müşteri Talimatı</div><div className="ozet">{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="mt-k">Geliş Kanalı</label><select id="mt-k" value={f.kanal} onChange={(e) => setF({ ...f, kanal: e.target.value })}>{['Portal', 'E-posta', 'Ek-2 Kanalı'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="mt-l">Mali Limit (EUR)</label><input id="mt-l" inputMode="decimal" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} />
    <label htmlFor="mt-h">Hedef Tarih</label><input id="mt-h" type="date" value={f.hedef} onChange={(e) => setF({ ...f, hedef: e.target.value })} />
    <label htmlFor="mt-m">Talimat Metni</label><textarea id="mt-m" value={f.metin} onChange={(e) => setF({ ...f, metin: e.target.value })} />
    <button className="btn2" disabled={!f.limit || !f.hedef || !f.metin.trim()} onClick={kaydet}>Talimatı Kaydet</button></div></>;
}
