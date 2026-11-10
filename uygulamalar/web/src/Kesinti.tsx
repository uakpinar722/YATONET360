import { useEffect, useState } from 'react';
import { istek } from './api';

type V = { yonetir: boolean; kanallar: string[]; kesintiler: { kimlik: string; tur: string; neden: string; baslangic: string; durum: string; referans: number; bagsiz: number }[]; referanslarim: { kimlik: string; referans: string; durum: string }[] };
const TEST: [string, string][] = [['temsiliIsAkisi', 'Temsilî İş Akışı'], ['veriGuncelligi', 'Veri Güncelliği'], ['yetki', 'Yetki'], ['belge', 'Belge'], ['bildirim', 'Bildirim'], ['entegrasyon', 'Entegrasyon']];
/** YG-1368, YG-1284: kesinti ve platform dışı işlem düzeni; geçici referansların sisteme geri girişi. */
export function Kesinti() {
  const [v, setV] = useState<V | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>('/kesinti').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v || (!v.yonetir && !v.referanslarim.length)) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then((r) => { setM((r as { referanslar?: string[] }).referanslar ? `Referanslar: ${(r as { referanslar: string[] }).referanslar.join(', ')}` : t); return yk(); }).catch((e) => setM(e.message));
  const al = (k: string, et: string, tip = 'text') => <span key={k}><label htmlFor={`ks-${k}`}>{et}</label><input id={`ks-${k}`} type={tip} value={g[k] ?? ''} onChange={(e) => setG({ ...g, [k]: e.target.value })} /></span>;
  return <details><summary>Kesinti ve Platform Dışı İşlem</summary>{m && <div className="not" role="status">{m}</div>}
    {v.referanslarim.map((r) => <div className="soru" key={r.kimlik}><span>{r.referans} · Sisteme geri girilmedi</span><div className="tam">
      <label htmlFor={`gk-${r.kimlik}`}>Kanal</label><select id={`gk-${r.kimlik}`} value={g[`k${r.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`k${r.kimlik}`]: e.target.value })}><option value="">Seçiniz</option>{v.kanallar.map((x) => <option key={x}>{x}</option>)}</select>
      {al(`y${r.kimlik}`, 'Yetkili Kişi')}{al(`o${r.kimlik}`, 'Asgari Veri Özeti')}{al(`s${r.kimlik}`, 'Saklama Yeri')}{al(`d${r.kimlik}`, 'Ana Dosya Kimliği')}{al(`z${r.kimlik}`, 'İşlem Zamanı', 'datetime-local')}
      <button className="btn2 kucuk" onClick={() => is(istek(`/gecici-referans/${r.kimlik}/geri-giris`, { kanal: g[`k${r.kimlik}`], yetkili: g[`y${r.kimlik}`], ozet: g[`o${r.kimlik}`], saklama: g[`s${r.kimlik}`], dosya: g[`d${r.kimlik}`], zaman: g[`z${r.kimlik}`] ? new Date(g[`z${r.kimlik}`]!).toISOString() : undefined }), 'Sisteme geri girildi.')}>Sisteme Gir</button></div></div>)}
    {v.yonetir && <>{v.kesintiler.map((k) => <div className={k.durum === 'Açık' ? 'soru hata' : 'soru'} key={k.kimlik}><span>{k.tur} · {k.neden} · {new Date(k.baslangic).toLocaleString('tr-TR')} · {k.durum} · {k.referans} referans{k.bagsiz ? ` · ${k.bagsiz} bağsız` : ''}</span>
      {k.durum === 'Açık' && <div className="tam">{al(`rs${k.kimlik}`, 'Referans Sorumlusu (Personel Kimliği)')}{al(`ra${k.kimlik}`, 'Adet')}<button className="btn2 kucuk" onClick={() => is(istek(`/kesinti/${k.kimlik}/referans`, { sorumlu: g[`rs${k.kimlik}`], adet: Number(g[`ra${k.kimlik}`]) }), '')}>Geçici Referans Üret</button>
        {TEST.map(([t, et]) => <label key={t}><input type="checkbox" checked={g[`t${t}${k.kimlik}`] === '1'} onChange={(e) => setG({ ...g, [`t${t}${k.kimlik}`]: e.target.checked ? '1' : '' })} /> {et} Başarılı</label>)}
        <button className="btn2 kucuk" onClick={() => is(istek(`/kesinti/${k.kimlik}/kapat`, { normallesme: Object.fromEntries(TEST.map(([t]) => [t, g[`t${t}${k.kimlik}`] === '1' ? 'Başarılı' : 'Yapılmadı'])) }), 'Kesinti kapandı.')}>Kesintiyi Kapat</button></div>}</div>)}
      <label htmlFor="ks-tur">Tür</label><select id="ks-tur" value={g.tur ?? 'Kesinti'} onChange={(e) => setG({ ...g, tur: e.target.value })}><option>Kesinti</option><option>Onaylı İstisna</option></select>{al('neden', 'Neden')}{al('kapsam', 'Kapsam')}
      <button className="btn2 kucuk" onClick={() => is(istek('/kesinti', { tur: g.tur ?? 'Kesinti', neden: g.neden, kapsam: g.kapsam }), 'Kayıt açıldı.')}>Aç</button></>}</details>;
}
