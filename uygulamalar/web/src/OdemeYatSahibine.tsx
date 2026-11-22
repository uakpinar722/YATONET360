import { useState } from 'react';
import { istek } from './api';

/** YG-892: sigorta şirketi ödemeyi yat sahibine yapacağını bildirdiğinde dosya ticari olarak sigortasız işlenir. */
export function OdemeYatSahibine({ id }: { id: string }) {
  const [d, setD] = useState(''); const [m, setM] = useState('');
  return <details className="ozet"><summary>Sigorta Ödemeyi Yat Sahibine Yapacak</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="not">Kayıttan sonra teklif, proforma ve ödeme talepleri yat sahibine düzenlenir.</div>
    <label htmlFor="oy-d">Sigorta Şirketinin Bildirimi (Tarih / Sayı veya E-posta)</label><input required id="oy-d" value={d} onChange={(e) => setD(e.target.value)} />
    <button className="btn2 kucuk" disabled={!d.trim()} onClick={() => void istek(`/dosya/${id}/odeme-yat-sahibine`, { dayanak: d }).then(() => { setM('Bildirim kaydedildi; dosya ticari olarak yat sahibine yönlendi.'); setD(''); }).catch((e) => setM(e.message))}>Bildirimi Kaydet</button></details>;
}
