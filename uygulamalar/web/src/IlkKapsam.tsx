import { useEffect, useState } from 'react';
import { istek } from './api';

type S = { surum: number; varlik_sistem: string; faaliyet: string; teknik_brans: string[]; koordinator: string | null; destek_isleri: string | null; beklenen_cikti: string; kabul_olcutu: string; hariclar: string; varsayimlar: string | null; durum: string; iade_gerekcesi: string | null };
type V = { doldurur: boolean; kontrolEder: boolean; faaliyetler: string[]; ciktilar: string[]; branslar: { deger: string; aciklama: string }[]; uzmanlar: { kimlik: string; ad_soyad: string }[]; surumler: S[] };
const BOS = { varlikSistem: '', faaliyet: '', teknikBrans: [] as string[], koordinator: '', destekIsleri: '', beklenenCikti: '', kabulOlcutu: '', hariclar: '', varsayimlar: '' };
/** YG-1069: FR-OPS-003; Dosya Sorumlusu doldurur, Teknik Uzman tamamlar ve kontrol eder. */
export function IlkKapsam({ dosya }: { dosya: string }) {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState(BOS); const [g, setG] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<V>(`/dosya/${dosya}/ilk-kapsam`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!v) return null;
  const son = v.surumler[0];
  const metin = (k: 'varlikSistem' | 'destekIsleri' | 'kabulOlcutu' | 'hariclar' | 'varsayimlar', et: string) => <span key={k}><label htmlFor={`ik-${k}`}>{et}</label><textarea id={`ik-${k}`} rows={2} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></span>;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>FR-OPS-003 İlk Kapsam{son ? ` · Rev.${son.surum} · ${son.durum}` : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    {son && <div className="ozet"><div>Varlık / Sistem: {son.varlik_sistem}</div><div>Faaliyet: {son.faaliyet} · Teknik Branş: {son.teknik_brans.join(', ')}{son.koordinator ? ` · Koordinatör: ${son.koordinator}` : ''}</div><div>Beklenen Çıktı: {son.beklenen_cikti}</div><div>Kabul Ölçütü: {son.kabul_olcutu}</div><div>Hariçler / Kısıtlar: {son.hariclar}</div>{son.destek_isleri && <div>Destek İşleri: {son.destek_isleri}</div>}{son.varsayimlar && <div>Varsayımlar: {son.varsayimlar}</div>}{son.iade_gerekcesi && <div className="hata">İade: {son.iade_gerekcesi}</div>}</div>}
    {son?.durum === 'Kontrolde' && v.kontrolEder && <div className="tam"><label htmlFor="ik-g">İade Gerekçesi</label><input id="ik-g" value={g} onChange={(e) => setG(e.target.value)} /><button className="btn2 kucuk" onClick={() => is(istek(`/dosya/${dosya}/ilk-kapsam/${son.surum}/kontrol`, { karar: 'Onayla' }), 'Kapsam onaylandı.')}>Kontrol Edildi, Onayla</button><button className="btn2 kucuk" disabled={!g.trim()} onClick={() => is(istek(`/dosya/${dosya}/ilk-kapsam/${son.surum}/kontrol`, { karar: 'İade', gerekce: g }), 'Kapsam iade edildi.')}>İade Et</button></div>}
    {v.doldurur && <>{metin('varlikSistem', 'Varlık / Sistem')}
      <label htmlFor="ik-fa">Faaliyet</label><select id="ik-fa" value={f.faaliyet} onChange={(e) => setF({ ...f, faaliyet: e.target.value })}><option value="">Seçiniz</option>{v.faaliyetler.map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="ik-br">Teknik Branş</label><select id="ik-br" multiple value={f.teknikBrans} onChange={(e) => setF({ ...f, teknikBrans: [...e.target.selectedOptions].map((o) => o.value) })}>{v.branslar.map((x) => <option key={x.deger} value={x.deger}>{x.aciklama}</option>)}</select>
      {f.teknikBrans.length > 1 && <><label htmlFor="ik-ko">Koordinatör Teknik Uzman</label><select id="ik-ko" value={f.koordinator} onChange={(e) => setF({ ...f, koordinator: e.target.value })}><option value="">Seçiniz</option>{v.uzmanlar.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select></>}
      <label htmlFor="ik-bc">Beklenen Çıktı</label><select id="ik-bc" value={f.beklenenCikti} onChange={(e) => setF({ ...f, beklenenCikti: e.target.value })}><option value="">Seçiniz</option>{v.ciktilar.map((x) => <option key={x}>{x}</option>)}</select>
      {metin('kabulOlcutu', 'Kabul Ölçütü')}{metin('hariclar', 'Hariçler / Kısıtlar')}{metin('destekIsleri', 'Destek İşleri Sorumluluğu')}{metin('varsayimlar', 'Varsayımlar')}
      <button className="btn2 kucuk" onClick={() => is(istek(`/dosya/${dosya}/ilk-kapsam`, { ...f, koordinator: f.koordinator || undefined }), 'Kapsam Teknik Uzman kontrolüne gönderildi.')}>{son ? 'Yeni Sürüm Kaydet' : 'Kaydet'}</button></>}</details>;
}
