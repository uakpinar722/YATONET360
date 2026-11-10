import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-564, YG-015: gerçek geri yükleme kaydı; duyuru ve yeniden giriş görevleri sistemden çıkar. */
export function GeriYukleme() {
  const [l, setL] = useState<{ kimlik: string; tur: string; baslangic: string; durum: string }[] | null>(null); const [f, setF] = useState({ yedek: '', aciklama: '' }); const [m, setM] = useState('');
  useEffect(() => { void istek<{ yedekler: NonNullable<typeof l> }>('/yedekler').then((r) => setL(r.yedekler.filter((x) => x.durum === 'Başarılı'))).catch(() => setL(null)); }, []);
  if (!l) return null;
  return <details><summary>Gerçek Geri Yükleme Kaydı</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="gy-y">Geri Yüklenen Yedek</label><select id="gy-y" value={f.yedek} onChange={(e) => setF({ ...f, yedek: e.target.value })}><option value="">Seçiniz</option>{l.slice(0, 30).map((x) => <option key={x.kimlik} value={x.kimlik}>{new Date(x.baslangic).toLocaleString('tr-TR')} · {x.tur}</option>)}</select>
    <label htmlFor="gy-a">Olay Açıklaması</label><input id="gy-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.yedek || !f.aciklama.trim()} onClick={() => void istek<{ gorev: number }>('/geri-yukleme/kayit', f).then((r) => setM(`Duyuru yayımlandı; ${r.gorev} yeniden giriş görevi açıldı.`)).catch((e) => setM(e.message))}>Kaydet ve Duyur</button></details>;
}
