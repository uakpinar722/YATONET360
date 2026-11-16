import { useState } from 'react';
import { istek } from './api';

/** YG-262, YG-1609: ciddi ve yakın tehlikede işi durdurma; yeniden başlatma izni Teknik Müdürde (dosya.ata.teknik). */
export function IsDurdur({ dosya, durdu: ilk, baslatabilir }: { dosya: string; durdu: boolean; baslatabilir: boolean }) {
  const [durdu, setDurdu] = useState(ilk); const [neden, setNeden] = useState(''); const [gv, setGv] = useState(''); const [m, setM] = useState(''); const [h, setH] = useState('');
  const yap = (yol: string, govde: object, sonra: boolean, mesaj: string) => { setH(''); setM(''); void istek(`/dosya/${dosya}/${yol}`, govde).then(() => { setDurdu(sonra); setNeden(''); setGv(''); setM(mesaj); }).catch((e) => setH((e as Error).message)); };
  return <div className="ozet">
    {h && <div className="hata" role="alert">{h}</div>}{m && <div className="not" role="status">{m}</div>}
    {durdu ? <>
      <div className="uyari">⚠ Bu dosyada çalışma durdurulmuştur.</div>
      {baslatabilir && <><label htmlFor="id-g">Güvenli Koşul Doğrulaması</label><textarea id="id-g" value={gv} onChange={(e) => setGv(e.target.value)} />
        <button className="btn2" disabled={!gv.trim()} onClick={() => yap('is-baslat', { gerekce: gv }, false, 'Çalışma yeniden başlatıldı.')}>İşi Yeniden Başlat</button></>}
    </> : <>
      <label htmlFor="id-n">Durdurma Nedeni (ciddi ve yakın tehlike)</label><textarea id="id-n" value={neden} onChange={(e) => setNeden(e.target.value)} />
      <button className="btn" disabled={!neden.trim()} onClick={() => yap('is-durdur', { neden }, true, 'İş durduruldu; ilgililere anlık bildirim gönderildi.')}>İşi Durdur</button>
    </>}
  </div>;
}
