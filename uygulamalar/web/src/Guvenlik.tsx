import { useEffect, useState } from 'react';
import { istek } from './api';

type A = { kimlik: string; alarm_no: string; ad: string; onem: string; etkilenen: string; olay_sayisi: number; beklenen_eylem: string; durum: string };
type K = { kod: string; ad: string; esik: string; pencere_dk: number; onem: string; istisna_bitis: string | null; istisna_gerekce: string | null };
type C = { kimlik: string; kapsam: string; gerekce: string; durum: string; kisisel_veri: boolean; ad_soyad: string };
type V = { karar: boolean; alarmlar: A[]; kurallar: K[]; kirCam: C[] };

/** YG-1190–1194: güvenlik alarmları, tedbir, kural istisnası ve acil erişim. */
export function Guvenlik() {
  const [v, setV] = useState<V | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [t, setT] = useState({ tur: 'Oturum Sonlandırma', hedef: '' }); const [kc, setKc] = useState({ kapsam: '', gerekce: '', kisiselVeri: false }); const [m, setM] = useState('');
  const yk = () => istek<V>('/guvenlik').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, x: string) => void p.then(() => { setM(x); return yk(); }).catch((e) => setM(e.message));
  const G = (k: string, et: string) => <><label htmlFor={`gv-${k}`}>{et}</label><input id={`gv-${k}`} value={g[k] ?? ''} onChange={(e) => setG({ ...g, [k]: e.target.value })} /></>;
  return <><div className="bolum">Güvenlik Alarmları</div>{m && <div className="not" role="status">{m}</div>}
    {v.alarmlar.map((a) => <div className="soru" key={a.kimlik}><span>{a.alarm_no} · {a.ad} · {a.onem} · {a.etkilenen} · {a.olay_sayisi} olay · {a.durum} · {a.beklenen_eylem}</span>
      {a.durum !== 'Kapalı' && <div className="tam">{['Kabul', 'İnceleme'].map((d) => <button key={d} className="btn2 kucuk" onClick={() => is(istek(`/guvenlik/alarm/${a.kimlik}/adim`, { adim: d }), `${d} kaydedildi.`)}>{d}</button>)}{G(`n-${a.kimlik}`, 'Not / Gerekçe')}<button className="btn2 kucuk" disabled={!g[`n-${a.kimlik}`]?.trim()} onClick={() => is(istek(`/guvenlik/alarm/${a.kimlik}/adim`, { adim: 'Kapanış', not: g[`n-${a.kimlik}`] }), 'Alarm kapatıldı.')}>Kapat</button>
        {v.karar && <><label htmlFor={`gv-t-${a.kimlik}`}>Tedbir</label><select id={`gv-t-${a.kimlik}`} value={t.tur} onChange={(e) => setT({ ...t, tur: e.target.value })}>{['Oturum Sonlandırma', 'Erişim Askıya Alma', 'Anahtar İptali', 'Bağlantı Sınırlama', 'Kayıt Dondurma'].map((x) => <option key={x}>{x}</option>)}</select><label htmlFor={`gv-h-${a.kimlik}`}>Hedef Kullanıcı Kimliği</label><input id={`gv-h-${a.kimlik}`} value={t.hedef} onChange={(e) => setT({ ...t, hedef: e.target.value })} /><button className="btn2 kucuk" disabled={!g[`n-${a.kimlik}`]?.trim()} onClick={() => is(istek(`/guvenlik/alarm/${a.kimlik}/tedbir`, { tur: t.tur, hedef: t.hedef || undefined, gerekce: g[`n-${a.kimlik}`] }), 'Tedbir kaydedildi.')}>Tedbir Uygula</button></>}</div>}</div>)}
    <div className="bolum">Alarm Kuralları</div><div className="ozet">{v.kurallar.map((k) => <div key={k.kod}>{k.ad} · Eşik {k.esik} / {k.pencere_dk} dk · {k.onem}{k.istisna_bitis && new Date(k.istisna_bitis) > new Date() ? ` · İstisna: ${new Date(k.istisna_bitis).toLocaleDateString('tr-TR')} · ${k.istisna_gerekce}` : ''}</div>)}</div>
    <div className="bolum">Acil Erişim</div>{v.kirCam.map((c) => <div className="soru" key={c.kimlik}><span>{c.ad_soyad} · {c.kapsam} · {c.durum}</span>{c.durum === 'Talep' && <button className="btn2 kucuk" onClick={() => is(istek(`/guvenlik/kir-cam/${c.kimlik}/onay`, { veriSahibiOnayi: c.kisisel_veri ? g[`vs-${c.kimlik}`] : undefined }), 'Acil erişim onaylandı.')}>Onayla</button>}{c.durum === 'Talep' && c.kisisel_veri && G(`vs-${c.kimlik}`, 'Veri Sahibi Onayı')}{c.durum === 'Aktif' && <>{G(`in-${c.kimlik}`, 'Bağımsız İnceleme Notu')}<button className="btn2 kucuk" disabled={!g[`in-${c.kimlik}`]?.trim()} onClick={() => is(istek(`/guvenlik/kir-cam/${c.kimlik}/kapat`, { sirYenilendi: true, inceleme: g[`in-${c.kimlik}`] }), 'Acil erişim kapatıldı.')}>Sır Yenilendi, Kapat</button></>}</div>)}
    <label htmlFor="kc-k">Acil Erişim Kapsamı</label><input id="kc-k" value={kc.kapsam} onChange={(e) => setKc({ ...kc, kapsam: e.target.value })} /><label htmlFor="kc-g">Gerekçe</label><input id="kc-g" value={kc.gerekce} onChange={(e) => setKc({ ...kc, gerekce: e.target.value })} /><label><input type="checkbox" checked={kc.kisiselVeri} onChange={(e) => setKc({ ...kc, kisiselVeri: e.target.checked })} /> Kişisel Veriye Dokunuyor</label><button className="btn2 kucuk" disabled={!kc.kapsam.trim() || !kc.gerekce.trim()} onClick={() => is(istek('/guvenlik/kir-cam', kc).then(() => setKc({ kapsam: '', gerekce: '', kisiselVeri: false })), 'Acil erişim talep edildi.')}>Acil Erişim Talep Et</button></>;
}
