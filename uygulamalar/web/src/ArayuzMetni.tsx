import { useEffect, useState } from 'react';
import { istek } from './api';

type M = { tr: string; en_oneri: string | null; hukuki: boolean; en_onayli: string | null; onay_zamani: string | null; bekliyor: boolean };
type V = { hazirlar: boolean; onaylar: boolean; ceo: boolean; metinler: M[] };

/** YG-1390, YG-1391: arayüz metni çeviri kütüphanesi; öneri Sistem Yöneticisi / Bilgi İşlem Müdürü, onay BT ve Firma Yönetimi Direktörü, hukuki metnin İngilizcesi CEO. */
export function ArayuzMetni() {
  const [v, setV] = useState<V | null>(null); const [m, setM] = useState(''); const [ara, setAra] = useState(''); const [sec, setSec] = useState<string[]>([]);
  const [f, setF] = useState({ tr: '', en: '', hukuki: false });
  const yk = () => istek<V>('/arayuz-metni/yonetim').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const onaylayabilir = (x: M) => x.bekliyor && (x.hukuki ? v.ceo : v.onaylar);
  const l = v.metinler.filter((x) => !ara.trim() || `${x.tr} ${x.en_oneri ?? ''}`.toLocaleLowerCase('tr').includes(ara.toLocaleLowerCase('tr')));
  return <div data-cevirme>
    <div className="bolum">Arayüz Metinleri (İngilizce)</div>
    <div className="not">İngilizce karşılık onaylanana kadar ekranda Türkçe metin gösterilir. Hukuki işaretli metnin İngilizcesini CEO, diğerlerini Bilgi Teknolojileri ve Firma Yönetimi Direktörü onaylar.</div>
    {m && <div className="not" role="status">{m}</div>}
    <label htmlFor="am-ara">Ara</label><input id="am-ara" value={ara} onChange={(e) => setAra(e.target.value)} />
    <div className="not">{v.metinler.filter((x) => x.bekliyor).length} metin onay bekliyor · {v.metinler.filter((x) => x.en_onayli).length} metin onaylı</div>
    {(v.onaylar || v.ceo) && <div className="dugmeler"><button className="btn2 kucuk" onClick={() => setSec(l.filter(onaylayabilir).map((x) => x.tr))}>Onaylayabileceklerimin Tümünü Seç</button>
      <button className="btn evet kucuk" disabled={!sec.length} onClick={() => void istek<{ onaylanan: number; uyari?: string }>('/arayuz-metni/onay', { metinler: sec }).then((r) => { setM(`${r.onaylanan} metin onaylandı.${r.uyari ? ` ${r.uyari}` : ''}`); setSec([]); return yk(); }).catch((e) => setM(e.message))}>Seçilenleri Onayla ({sec.length})</button></div>}
    <div className="tablo"><table><thead><tr><th></th><th>Türkçe</th><th>İngilizce Öneri</th><th>Onaylı İngilizce</th><th>Onay</th></tr></thead><tbody>
      {l.map((x) => <tr key={x.tr}><td>{onaylayabilir(x) && <input type="checkbox" aria-label={`${x.tr} seç`} checked={sec.includes(x.tr)} onChange={(e) => setSec(e.target.checked ? [...sec, x.tr] : sec.filter((y) => y !== x.tr))} />}</td>
        <td>{x.tr}</td><td>{x.en_oneri ?? '—'}</td><td>{x.en_onayli ?? '—'}</td><td>{x.hukuki ? 'CEO (hukuki)' : 'Direktör'}{x.bekliyor ? ' · Bekliyor' : ''}</td></tr>)}
    </tbody></table></div>
    {v.hazirlar && <details><summary>Metin Öner</summary>
      <label htmlFor="am-tr">Türkçe Metin (ekrandaki gibi)</label><input id="am-tr" value={f.tr} onChange={(e) => setF({ ...f, tr: e.target.value })} />
      <label htmlFor="am-en">İngilizce Karşılık</label><input id="am-en" value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} />
      <label className="kutu"><input type="checkbox" checked={f.hukuki} onChange={(e) => setF({ ...f, hukuki: e.target.checked })} /><span>Hukuki metin (İngilizcesini CEO onaylar)</span></label>
      <button className="btn2 kucuk" disabled={!f.tr.trim() || !f.en.trim()} onClick={() => void istek('/arayuz-metni/oneri', f).then(() => { setM('Öneri kaydedildi; onay bekliyor.'); setF({ tr: '', en: '', hukuki: false }); return yk(); }).catch((e) => setM(e.message))}>Öneriyi Kaydet</button>
    </details>}
  </div>;
}
