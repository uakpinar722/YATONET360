import { useEffect, useState } from 'react';
import { istek } from './api';

type V = { riskler: string[]; duzenleyebilir: boolean; surumler: { surum: number; olusturma_zamani: string }[] };
const ALAN: [string, string, boolean?][] = [['kapsam', 'Görevlendirme Kapsamı ve Karar Sınırı'], ['kronoloji', 'Olay Özeti ve Kronoloji'], ['kaynaklar', 'İncelenen Kaynaklar'], ['olgular', 'Doğrulanmış Olgular'], ['beyanlar', 'Beyanlar, Gözlemler ve Varsayımlar'], ['yeterlilikGerekcesi', 'Bilgi Yeterliliği Gerekçesi ve Eksik Listesi'], ['uzmanliklar', 'Gerekli Uzmanlıklar'], ['etkilenen', 'Etkilenen Sistemler', true], ['sonuc', 'Ön Değerlendirme Sonucu'], ['yontem', 'Yöntem Kararı'], ['yontemGerekcesi', 'Yöntem Gerekçesi', true], ['oncelikTeyidi', 'Öncelik Teyidi'], ['sonrakiAdim', 'Sonraki Adım'], ['acikKonular', 'Açık Konular']];

/** YG-651: RP-OPS-001 Ön Değerlendirme sekmesi; her kayıt yeni sürümdür. */
export function OnDegerlendirme({ dosya }: { dosya: string }) {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState<Record<string, string>>({ yeterlilik: 'Yeterli' }); const [r, setR] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>(`/dosya/${dosya}/on-degerlendirme`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!v) return null;
  return <details><summary>Ön Değerlendirme Raporu{v.surumler.length ? ` · Rev.${v.surumler[0]!.surum}` : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    {v.duzenleyebilir && <><label htmlFor="od-t">Esas Alınan Son Bilgi Tarihi</label><input id="od-t" type="date" value={f.sonBilgi ?? ''} onChange={(e) => setF({ ...f, sonBilgi: e.target.value })} />
      <label htmlFor="od-y">Bilgi Yeterliliği</label><select id="od-y" value={f.yeterlilik} onChange={(e) => setF({ ...f, yeterlilik: e.target.value })}><option>Yeterli</option><option>Kısmen Yeterli</option><option>Yetersiz</option></select>
      {ALAN.map(([k, et]) => <span key={k}><label htmlFor={`od-${k}`}>{et}</label><textarea id={`od-${k}`} rows={2} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></span>)}
      <div className="bolum">Risk Taraması</div>{v.riskler.map((x, n) => <span key={x}><label htmlFor={`od-r${n}`}>{x}</label><select id={`od-r${n}`} value={r[x] ?? ''} onChange={(e) => setR({ ...r, [x]: e.target.value })}><option value="">Seçiniz</option><option>Hayır</option><option>Bilinmiyor</option><option>Kısmen</option><option>Evet</option></select></span>)}
      <button className="btn2 kucuk" onClick={() => void istek<{ surum: number }>(`/dosya/${dosya}/on-degerlendirme`, { ...f, risk: r }).then((x) => { setM(`Rapor kaydedildi: Rev.${x.surum}`); return yk(); }).catch((e) => setM(e.message))}>Raporu Kaydet</button></>}</details>;
}
