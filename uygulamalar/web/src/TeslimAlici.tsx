import { useEffect, useState } from 'react';
import { istek } from './api';

type T = { kimlik: string; taraf_rolu: string; kisi_adi_soyadi: string; yetki_kaydi: boolean; dogrulama: { yontem: string; zaman: string } | null };

/** YG-415: teslim bildiriminden önce yetkili alıcı doğrulaması. */
export function TeslimAlici({ dosya }: { dosya: string }) {
  const [l, setL] = useState<T[]>([]); const [f, setF] = useState({ alici: '', yontem: 'Kimlik Belgesi', aciklama: '' }); const [m, setM] = useState('');
  const yk = () => istek<T[]>(`/dosya/${dosya}/teslim-alicilari`).then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, [dosya]);
  return <><div className="bolum">Yetkili Alıcı Doğrulaması</div><div className="ozet">{m && <div className="not" role="status">{m}</div>}
    {l.length === 0 ? <div className="not">Dosyada yat sahibi veya yetkili temsilci kaydı bulunmamaktadır.</div> : l.map((x) => <div key={x.kimlik}>{x.taraf_rolu} · {x.kisi_adi_soyadi}{x.taraf_rolu === 'Yetkili Temsilci' && !x.yetki_kaydi ? ' · Yetki kaydı yok' : ''} · {x.dogrulama ? `Doğrulandı (${x.dogrulama.yontem}, ${new Date(x.dogrulama.zaman).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })})` : 'Doğrulanmadı'}</div>)}
    <label htmlFor="ta-a">Teslim Alacak Kişi</label><select id="ta-a" value={f.alici} onChange={(e) => setF({ ...f, alici: e.target.value })}><option value="">Seçiniz</option>{l.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.taraf_rolu} · {x.kisi_adi_soyadi}</option>)}</select>
    <label htmlFor="ta-y">Alıcı Doğrulama Yöntemi</label><select id="ta-y" value={f.yontem} onChange={(e) => setF({ ...f, yontem: e.target.value })}>{['Kimlik Belgesi', 'Yetki Belgesi', 'Portal Hesabı', 'Kayıtlı Telefonla Geri Arama'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="ta-n">Doğrulama Açıklaması</label><input id="ta-n" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.alici} onClick={() => void istek(`/dosya/${dosya}/teslim-alici-dogrula`, f).then(() => { setM('Teslim alıcısı doğrulandı.'); setF({ alici: '', yontem: 'Kimlik Belgesi', aciklama: '' }); return yk(); }).catch((e) => setM(e.message))}>Alıcıyı Doğrula</button></div></>;
}
