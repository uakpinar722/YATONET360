import { useEffect, useState } from 'react';
import { istek } from './api';

type V = { tahmini: string | null; ilk: string | null; kalan: number | null; karar: boolean; gecmis: { hedef_tarih: string; sonuc: string; ek_is_gunu: number | null; yeni_tarih: string | null; gerekce: string | null; gec_bildirim: boolean }[] };
const tr = (s: string) => s.split('-').reverse().join('.');

/** SRE-1: tahmini teslim tarihi; 5 iş günü kala değerlendirme, uzamada gerekçeli bildirim. */
export function TeslimSure({ dosya }: { dosya: string }) {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ sonuc: 'Uzama Yok', ekGun: '', gerekce: '' }); const [m, setM] = useState('');
  const yk = () => istek<V>(`/dosya/${dosya}/teslim-sure`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!v?.tahmini) return null;
  const uz = f.sonuc === 'Uzama Var';
  const kaydet = () => void istek<{ yeniTarih: string | null; gecBildirim: boolean }>(`/dosya/${dosya}/teslim-sure`, { sonuc: f.sonuc, ekGun: uz ? Number(f.ekGun) : undefined, gerekce: uz ? f.gerekce : undefined }).then((r) => { setM(r.yeniTarih ? `Yeni teslim tarihi ${tr(r.yeniTarih)}; taraflara iletildi.${r.gecBildirim ? ' 3 iş gününden az kala bildirildi.' : ''}` : 'Değerlendirme kaydedildi.'); setF({ sonuc: 'Uzama Yok', ekGun: '', gerekce: '' }); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Teslim Süresi</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet"><div>Tahmini Teslim Tarihi: {tr(v.tahmini)} · Kalan: {v.kalan?.toLocaleString('tr-TR')} iş günü</div>{v.ilk && v.ilk !== v.tahmini && <div>İlk Bildirilen Tarih: {tr(v.ilk)}</div>}
      {v.gecmis.map((x) => <div key={x.hedef_tarih}>{tr(x.hedef_tarih)} · {x.sonuc}{x.yeni_tarih ? ` · Yeni: ${tr(x.yeni_tarih)} · +${x.ek_is_gunu} iş günü · ${x.gerekce}` : ''}{x.gec_bildirim ? ' · Geç Bildirim' : ''}</div>)}</div>
    {v.karar && <>
      <label htmlFor="ts-s">Değerlendirme</label><select id="ts-s" value={f.sonuc} onChange={(e) => setF({ ...f, sonuc: e.target.value })}><option>Uzama Yok</option><option>Uzama Var</option></select>
      {uz && <><label htmlFor="ts-e">Ek İş Günü</label><input id="ts-e" inputMode="numeric" value={f.ekGun} onChange={(e) => setF({ ...f, ekGun: e.target.value })} />
        <label htmlFor="ts-g">Gerekçe (taraflara aynen iletilir; firma adı yazmayınız)</label><input id="ts-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} /></>}
      <button className="btn2 kucuk" disabled={uz && (!f.ekGun || !f.gerekce.trim())} onClick={kaydet}>Değerlendirmeyi Kaydet</button></>}</>;
}
