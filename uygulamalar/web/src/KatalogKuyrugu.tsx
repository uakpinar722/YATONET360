import { useEffect, useState } from 'react';
import { istek } from './api';

export type KuyrukKalemi = { kimlik: string; dosya_ref: string; dosya_no: string; aciklama: string; birim: string; durum: string; kartela_kodu: string | null; karar_gerekcesi: string | null; olusturma_zamani: string; oneri_islem: string | null };
/** YG-662: katalogda bulunmayan iş için açılan geçici kalemler katalog geliştirme kuyruğunda izlenir; Ticari İşler Direktörü gerekçeyle kataloğa almayabilir. */
export function KatalogKuyrugu() {
  const [l, setL] = useState<KuyrukKalemi[] | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState(''); const [tumu, setTumu] = useState(false);
  const yk = () => istek<KuyrukKalemi[]>(`/katalog-gelistirme${tumu ? '' : '?durum=Kuyrukta'}`).then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, [tumu]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) return null;
  return <details><summary>Katalog Geliştirme Kuyruğu · {l.filter((x) => x.durum === 'Kuyrukta').length} kalem kart önerisi bekliyor</summary>{m && <div className="not" role="status">{m}</div>}
    <label className="kutu"><input type="checkbox" checked={tumu} onChange={(e) => setTumu(e.target.checked)} /> Sonuçlananları da göster</label>
    {l.length === 0 && <div className="not">Kuyrukta kalem bulunmamaktadır.</div>}
    {l.map((x) => <div key={x.kimlik} className="soru"><span>{x.dosya_no} · {x.aciklama} ({x.birim}) · {x.durum}{x.oneri_islem ? ` · Öneri: ${x.oneri_islem}` : ''}{x.kartela_kodu ? ` · Kod: ${x.kartela_kodu}` : ''}{x.karar_gerekcesi ? ` · Gerekçe: ${x.karar_gerekcesi}` : ''}</span>
      {x.durum === 'Kuyrukta' && <><label htmlFor={`kk-${x.kimlik}`}>Kataloğa Almama Gerekçesi</label><input id={`kk-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />
        <button className="btn2 kucuk" disabled={!g[x.kimlik]?.trim()} onClick={() => void istek(`/katalog-gelistirme/${x.kimlik}/alinmadi`, { gerekce: g[x.kimlik] }).then(() => { setM('Kalem dosyaya özgü bırakıldı.'); return yk(); }).catch((e) => setM((e as Error).message))}>Kataloğa Alma</button></>}
    </div>)}
  </details>;
}
