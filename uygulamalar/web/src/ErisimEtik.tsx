import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kimlik: string; ad_soyad: string; son_giris_zamani: string | null; rol_adi: string; kademe: string; ayricalikli_rol: boolean; karar: string | null; onceki: string | null };
type I = { kimlik: string; donem: string; kapsam: string; kalemler: K[] };
/** YG-1045, YG-1047: erişim incelemesi; rol, görev, son giriş ve önceki karar görünür. */
export function ErisimInceleme() {
  const [l, setL] = useState<I[]>([]); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<I[]>('/erisim-inceleme').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length) return null;
  const is = (id: string, karar: string) => void istek(`/erisim-inceleme/kalem/${id}`, { karar, gerekce: g[id] || undefined, yeniBitis: g[`b${id}`] || undefined }).then(() => { setM('Karar kaydedildi.'); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Erişim İncelemesi</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <details key={x.kimlik}><summary>{x.donem} · {x.kapsam} · {x.kalemler.filter((k) => !k.karar).length} bekleyen</summary>{x.kalemler.map((k) => <div className="soru" key={k.kimlik}><span>{k.ad_soyad} · {k.rol_adi} ({k.kademe}){k.ayricalikli_rol ? ' · Ayrıcalıklı' : ''} · Son Giriş: {k.son_giris_zamani ? new Date(k.son_giris_zamani).toLocaleDateString('tr-TR') : 'Yok'}{k.onceki ? ` · Önceki: ${k.onceki}` : ''}{k.karar ? ` · ${k.karar}` : ''}</span>{!k.karar && <div className="tam"><label htmlFor={`ei-${k.kimlik}`}>Gerekçe</label><input id={`ei-${k.kimlik}`} value={g[k.kimlik] ?? ''} onChange={(e) => setG({ ...g, [k.kimlik]: e.target.value })} /><label htmlFor={`eb-${k.kimlik}`}>Yeni Bitiş</label><input id={`eb-${k.kimlik}`} type="date" value={g[`b${k.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`b${k.kimlik}`]: e.target.value })} />{['Koru', 'Daralt', 'Süre Uzat', 'Askıya Al', 'Kapat'].map((d) => <button key={d} className="btn2 kucuk" onClick={() => is(k.kimlik, d)}>{d}</button>)}</div>}</div>)}</details>)}</>;
}

const KAT = ['Etik Bildirim', 'Yönlendirme Komisyonu', 'Suistimal Şüphesi', 'Sosyal Medya', 'Doğrudan Müşteri Talebi'];
type E = { kimlik: string; bildirim_no: string; kategori: string; aciklama: string; durum: string };
/** YG-585, YG-587, YG-1068. */
export function EtikBildirim() {
  const [f, setF] = useState({ kategori: KAT[0]!, aciklama: '' }); const [l, setL] = useState<E[] | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<E[]>('/etik-bildirim').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  const karar = (x: E, yatSahibi?: string) => void istek(`/etik-bildirim/${x.kimlik}/karar`, { sonuc: g[x.kimlik], yatSahibi }).then(() => { setM('Karar kaydedildi.'); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Bildirimler</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="eb-k">Kategori</label><select id="eb-k" value={f.kategori} onChange={(e) => setF({ ...f, kategori: e.target.value })}>{KAT.map((x) => <option key={x}>{x}</option>)}</select><label htmlFor="eb-a">Açıklama</label><input id="eb-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} /><button className="btn2 kucuk" disabled={!f.aciklama.trim()} onClick={() => void istek('/etik-bildirim', f).then(() => { setM('Bildiriminiz iletildi.'); setF({ ...f, aciklama: '' }); return yk(); }).catch((e) => setM(e.message))}>Bildir</button>
    {l?.filter((x) => x.durum === 'Açık').map((x) => <div className="soru" key={x.kimlik}><span>{x.bildirim_no} · {x.kategori} · {x.aciklama}</span><div className="tam"><label htmlFor={`es-${x.kimlik}`}>Sonuç</label><input id={`es-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />{['Etik Bildirim', 'Yönlendirme Komisyonu'].includes(x.kategori) ? <><button className="btn2 kucuk" onClick={() => karar(x, 'Bildirilsin')}>Yat Sahibine Bildirilsin</button><button className="btn2 kucuk" onClick={() => karar(x, 'Bildirilmesin')}>Bildirilmesin</button></> : <button className="btn2 kucuk" onClick={() => karar(x)}>Kapat</button>}</div></div>)}</details>;
}

type D = { kimlik: string; denetim_no: string; surec: string; durum: string; vekaleten: boolean; bulgular: { sinif: string; tanim: string }[] | null };
/** YG-1673–1675, YG-1681: iç denetim; rapor yalnız Müdür ve CEO'ya gider. */
export function IcDenetim() {
  const [v, setV] = useState<{ acabilir: boolean; denetimler: D[] } | null>(null); const [f, setF] = useState({ surec: '', kapsam: '', cikarYok: false, sonOnIkiAyGorevYok: false }); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/ic-denetim').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>İç Denetim</summary>{m && <div className="not" role="status">{m}</div>}
    {v.denetimler.map((d) => <div className="soru" key={d.kimlik}><span>{d.denetim_no} · {d.surec} · {d.durum}{d.vekaleten ? ' · Vekâleten Yürütüldü' : ''}{(d.bulgular ?? []).map((b) => ` · ${b.sinif}: ${b.tanim}`).join('')}</span>{d.durum === 'Açık' && <div className="tam"><label htmlFor={`id-s-${d.kimlik}`}>Bulgu Sınıfı</label><select id={`id-s-${d.kimlik}`} value={g[`s${d.kimlik}`] ?? 'Gözlem'} onChange={(e) => setG({ ...g, [`s${d.kimlik}`]: e.target.value })}><option>Gözlem</option><option>Minör</option><option>Majör</option><option>Kritik</option></select><label htmlFor={`id-t-${d.kimlik}`}>Bulgu</label><input id={`id-t-${d.kimlik}`} value={g[`t${d.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`t${d.kimlik}`]: e.target.value })} /><button className="btn2 kucuk" onClick={() => is(istek(`/ic-denetim/${d.kimlik}/bulgu`, { sinif: g[`s${d.kimlik}`] ?? 'Gözlem', tanim: g[`t${d.kimlik}`] }), 'Bulgu eklendi.')}>Bulgu Ekle</button><label htmlFor={`id-o-${d.kimlik}`}>Rapor Özeti</label><input id={`id-o-${d.kimlik}`} value={g[`o${d.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`o${d.kimlik}`]: e.target.value })} /><button className="btn2 kucuk" onClick={() => is(istek(`/ic-denetim/${d.kimlik}/rapor`, { ozet: g[`o${d.kimlik}`] }), 'Rapor gönderildi.')}>Raporu Gönder</button></div>}</div>)}
    {v.acabilir && <><label htmlFor="id-su">Süreç</label><input id="id-su" value={f.surec} onChange={(e) => setF({ ...f, surec: e.target.value })} /><label htmlFor="id-ka">Kapsam</label><input id="id-ka" value={f.kapsam} onChange={(e) => setF({ ...f, kapsam: e.target.value })} /><label><input type="checkbox" checked={f.cikarYok} onChange={(e) => setF({ ...f, cikarYok: e.target.checked })} /> Çıkar çatışmam yoktur</label><label><input type="checkbox" checked={f.sonOnIkiAyGorevYok} onChange={(e) => setF({ ...f, sonOnIkiAyGorevYok: e.target.checked })} /> Son 12 ayda bu süreçte görev almadım</label><button className="btn2 kucuk" onClick={() => is(istek('/ic-denetim', f), 'Denetim açıldı.')}>Denetim Aç</button></>}</details>;
}
