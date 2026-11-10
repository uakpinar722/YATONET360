import { useEffect, useState } from 'react';
import { istek } from './api';

type E = { kimlik: string; ad: string; gonderen_sistem: string; alan_sistem: string; bilgi_sinifi: string; siklik: string; durum: string };
const ALAN: [string, string][] = [['ad', 'Bağlantı Adı'], ['gonderen', 'Gönderen Sistem'], ['alan', 'Alan Sistem'], ['kayitSahibi', 'Kayıt Sahibi'], ['tetikleyici', 'Tetikleyici'], ['siklik', 'Sıklık'], ['hataSorumlusu', 'Hata Sorumlusu'], ['hizmetBeklentisi', 'Hizmet Beklentisi'], ['amac', 'Veri Paylaşım Amacı']];
const ASKI: [string, string][] = [['aciklama', 'Açıklama'], ['etkilenen', 'Etkilenen İşler'], ['geciciYontem', 'Geçici Yöntem'], ['kullaniciBildirimi', 'Kullanıcı Bildirimi'], ['olcut', 'Yeniden Açma Ölçütü']];
/** YG-1296, YG-1306: entegrasyon tanımı, üretime açma onayı, askıya alma ve yeniden açma. */
export function Entegrasyonlar() {
  const [v, setV] = useState<{ hazirlar: boolean; siniflar: string[]; kayitlar: E[] } | null>(null); const [f, setF] = useState<Record<string, string>>({ bilgiSinifi: 'Kurumsal' }); const [a, setA] = useState<Record<string, string>>({ neden: 'Güvenlik Olayı' }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/entegrasyon').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Entegrasyonlar</summary>{m && <div className="not" role="status">{m}</div>}
    {v.kayitlar.map((x) => <div className={x.durum === 'Askıda' ? 'soru hata' : 'soru'} key={x.kimlik}><span>{x.ad} · {x.gonderen_sistem} → {x.alan_sistem} · {x.bilgi_sinifi} · {x.siklik} · {x.durum}</span>
      {x.durum === 'Üretimde' && v.hazirlar && <div className="tam"><select aria-label="Askı Nedeni" value={a.neden} onChange={(e) => setA({ ...a, neden: e.target.value })}><option>Güvenlik Olayı</option><option>Ciddi Veri Uyuşmazlığı</option></select>{ASKI.map(([k, et]) => <span key={k}><label htmlFor={`ea-${k}-${x.kimlik}`}>{et}</label><input id={`ea-${k}-${x.kimlik}`} value={a[k] ?? ''} onChange={(e) => setA({ ...a, [k]: e.target.value })} /></span>)}<button className="btn2 kucuk" onClick={() => is(istek(`/entegrasyon/${x.kimlik}/askiya-al`, a), 'Bağlantı askıya alındı.')}>Askıya Al</button></div>}
      {x.durum === 'Askıda' && <div className="tam"><label htmlFor={`eo-${x.kimlik}`}>Ölçüt Karşılandı Gerekçesi</label><input id={`eo-${x.kimlik}`} value={a[`o${x.kimlik}`] ?? ''} onChange={(e) => setA({ ...a, [`o${x.kimlik}`]: e.target.value })} /><button className="btn2 kucuk" onClick={() => is(istek(`/entegrasyon/${x.kimlik}/yeniden-ac`, { olcutKarsilandi: true, gerekce: a[`o${x.kimlik}`] }), 'Bağlantı yeniden açıldı.')}>Yeniden Aç</button></div>}</div>)}
    {v.hazirlar && <>{ALAN.map(([k, et]) => <span key={k}><label htmlFor={`en-${k}`}>{et}</label><input id={`en-${k}`} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></span>)}<label htmlFor="en-bs">Bilgi Sınıfı</label><select id="en-bs" value={f.bilgiSinifi} onChange={(e) => setF({ ...f, bilgiSinifi: e.target.value })}>{v.siniflar.map((x) => <option key={x}>{x}</option>)}</select>
      <button className="btn2 kucuk" onClick={() => is(istek('/entegrasyon', f), 'Tanım onaya gönderildi.')}>Onaya Gönder</button></>}</details>;
}
