import { useEffect, useState } from 'react';
import { istek } from './api';

type S = { kimlik: string; sozlesme_turu: string; taraf: string | null; sozlesme_sahibi_rolu: string | null; yururluk: string; bitis: string | null; otomatik_yenileme: boolean; fesih_bildirim_son: string | null; durum: string; imzali: boolean; imza_turu: string | null; kurumsal_kanal: string | null; yenileme_karari: string | null; kendiliginden_yenilendi: boolean; ek_sayisi: number };
const t = (x: string | null) => (x ? x.slice(0, 10).split('-').reverse().join('.') : '---');
const BOS = { tur: '', tarafAdi: '', sahipRol: '', yururluk: '', bitis: '', otomatikYenileme: false, yenilemeAy: '12', fesihGun: '', kanal: '', yetkililer: '' };
/** YG-614: sözleşme takip; Sözleşme Sahibi türden önerilir, imzalı nüsha olmadan yürürlüğe girmez. */
export function SozlesmeTakip() {
  const [v, setV] = useState<{ tum: boolean; kayitlar: S[] } | null>(null); const [turler, setTurler] = useState<{ tur: string; sahip: string | null }[]>([]);
  const [f, setF] = useState(BOS); const [m, setM] = useState(''); const [g, setG] = useState<Record<string, string>>({});
  const yk = () => void istek<NonNullable<typeof v>>('/sozlesme-takip').then(setV).catch(() => setV(null));
  useEffect(() => { yk(); void istek<typeof turler>('/sozlesme-turleri').then(setTurler).catch(() => setTurler([])); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, s: string) => void p.then(() => { setM(s); setG({}); yk(); }).catch((e) => setM(e.message));
  const oneri = turler.find((x) => x.tur === f.tur)?.sahip;
  return <details><summary>Sözleşme Takibi · {v.kayitlar.filter((x) => x.durum === 'Yürürlükte').length} yürürlükte</summary>{m && <div className="not" role="status">{m}</div>}
    {v.kayitlar.map((x) => <div className={x.durum === 'Yürürlükte' ? 'soru' : 'soru bos'} key={x.kimlik}><span>{x.sozlesme_turu} · {x.taraf ?? '---'} · Sahip: {x.sozlesme_sahibi_rolu ?? '---'} · {x.durum}<br />
      <small>Yürürlük {t(x.yururluk)} · Bitiş {t(x.bitis)}{x.otomatik_yenileme ? ' · Otomatik yenileme' : ''} · Fesih bildirimi son gün {t(x.fesih_bildirim_son)} · {x.imzali ? `İmzalı (${x.imza_turu ?? '---'})` : 'İmzalı nüsha yok'} · Ek: {x.ek_sayisi}{x.yenileme_karari ? ` · Karar: ${x.yenileme_karari}` : ''}{x.kendiliginden_yenilendi ? ' · Karar olmadan yenilendi' : ''}</small></span>
      {x.durum === 'Yürürlükte' && <div className="tam"><label htmlFor={`st-k-${x.kimlik}`}>Karar</label><select id={`st-k-${x.kimlik}`} value={g[`k${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`k${x.kimlik}`]: e.target.value })}><option value="">Seçiniz</option>{['Yenileme', 'Fesih', 'Yeniden Görüşme'].map((k) => <option key={k}>{k}</option>)}</select>
        <label htmlFor={`st-g-${x.kimlik}`}>Gerekçe</label><input id={`st-g-${x.kimlik}`} value={g[`g${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`g${x.kimlik}`]: e.target.value })} />
        <button className="btn2 kucuk" onClick={() => is(istek(`/sozlesme-takip/${x.kimlik}/karar`, { karar: g[`k${x.kimlik}`], gerekce: g[`g${x.kimlik}`] }), 'Karar kaydedildi.')}>Kararı Kaydet</button></div>}</div>)}
    <div className="izgara"><b>Yeni Sözleşme Kaydı</b>
      <label htmlFor="st-tur">Sözleşme Türü</label><select id="st-tur" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value, sahipRol: '' })}><option value="">Seçiniz</option>{turler.map((x) => <option key={x.tur}>{x.tur}</option>)}</select>
      {oneri && <div className="not">Önerilen Sözleşme Sahibi: {oneri}</div>}
      <label htmlFor="st-taraf">Karşı Taraf</label><input id="st-taraf" value={f.tarafAdi} onChange={(e) => setF({ ...f, tarafAdi: e.target.value })} />
      <label htmlFor="st-y">Yürürlük Tarihi</label><input id="st-y" type="date" value={f.yururluk} onChange={(e) => setF({ ...f, yururluk: e.target.value })} />
      <label htmlFor="st-b">Bitiş Tarihi</label><input id="st-b" type="date" value={f.bitis} onChange={(e) => setF({ ...f, bitis: e.target.value })} />
      <label className="kutu"><input type="checkbox" checked={f.otomatikYenileme} onChange={(e) => setF({ ...f, otomatikYenileme: e.target.checked })} /><span>Otomatik yenileme hükmü var</span></label>
      <label htmlFor="st-f">Fesih Bildirim Süresi (Gün)</label><input id="st-f" type="number" value={f.fesihGun} onChange={(e) => setF({ ...f, fesihGun: e.target.value })} />
      <label htmlFor="st-kanal">Kurumsal Kanal (KEP, e-posta, adres)</label><input id="st-kanal" value={f.kanal} onChange={(e) => setF({ ...f, kanal: e.target.value })} />
      <label htmlFor="st-yet">Karşı Tarafın Yetkili Kişileri</label><textarea id="st-yet" value={f.yetkililer} onChange={(e) => setF({ ...f, yetkililer: e.target.value })} />
      <button className="btn kucuk" onClick={() => is(istek('/sozlesme-takip', { ...f, fesihGun: Number(f.fesihGun) || undefined, yenilemeAy: Number(f.yenilemeAy) }).then(() => setF(BOS)), 'Sözleşme taslak olarak kaydedildi; imzalı nüsha yüklenince yürürlüğe girer.')}>Kaydet</button></div></details>;
}
