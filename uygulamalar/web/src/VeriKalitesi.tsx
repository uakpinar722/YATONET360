import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kod: string; ad: string; sahip_rol: string; yetkili_kaynak: string; kalite_boyutlari: string[]; esik_yuzde: string; olcum_donemi: string; duzeltme_sorumlusu: string };
type Ku = { kod: string; surum: number; ad: string; amac: string; kume_ref: string; kaynak: string; kontrol_zamani: string; boyut: string; etki: string; esik: number; istisna: string | null; sahip_rol: string; yururluk: string; acik: number };
type H = { kimlik: string; kural_kod: string; ad: string; aciklama: string; boyut: string; etki: string; oncelik: string; ilk_gorulme: string };
/** YG-1249, 1252, 1254, 1255: veri kümeleri, veri yaşı, kalite kuralları ve öncelikli veri hataları. */
export function VeriKalitesi() {
  const [v, setV] = useState<{ kumeler: K[]; yasKurallari: { kod: string; alan: string; azami_gun: number; yeniden_dogrulama_gun: number; aciklama: string }[]; kurallar: Ku[]; hatalar: H[]; yonetir: boolean; sahipOldugu: string[] } | null>(null);
  const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/veri-kalitesi').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, s: string) => void p.then(() => { setM(s); setG({}); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Veri Kalitesi · {v.hatalar.length} açık hata</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="bolum">Veri Kümeleri</div>{v.kumeler.map((k) => <div className="soru" key={k.kod}><span><b>{k.ad}</b> · Sahip: {k.sahip_rol} · Kaynak: {k.yetkili_kaynak} · Boyutlar: {k.kalite_boyutlari.join(', ')} · Eşik %{Number(k.esik_yuzde).toLocaleString('tr-TR')} · {k.olcum_donemi} · Düzeltme: {k.duzeltme_sorumlusu}</span></div>)}
    <div className="bolum">Veri Yaşı</div>{v.yasKurallari.map((k) => <div className="soru" key={k.kod}><span>{k.kod} · {k.aciklama} · En çok {k.azami_gun} gün · Yeniden doğrulama {k.yeniden_dogrulama_gun} gün</span></div>)}
    <div className="bolum">Kalite Kuralları</div>{v.kurallar.map((k) => <div className={k.acik > k.esik ? 'soru hata' : 'soru'} key={k.kod}><span><b>{k.kod}</b> · {k.ad} · Sürüm {k.surum} ({k.yururluk.split('-').reverse().join('.')}) · {k.boyut} · Etki: {k.etki} · Kaynak: {k.kaynak} · {k.kontrol_zamani} · Eşik {k.esik} · Açık {k.acik} · Sahip: {k.sahip_rol}{k.istisna ? ` · İstisna: ${k.istisna}` : ''}<br />{k.amac}</span>
      {v.yonetir && <div className="tam"><label htmlFor={`vk-e-${k.kod}`}>Eşik</label><input id={`vk-e-${k.kod}`} type="number" value={g[`e${k.kod}`] ?? ''} onChange={(e) => setG({ ...g, [`e${k.kod}`]: e.target.value })} /><label htmlFor={`vk-i-${k.kod}`}>İstisna</label><input id={`vk-i-${k.kod}`} value={g[`i${k.kod}`] ?? ''} onChange={(e) => setG({ ...g, [`i${k.kod}`]: e.target.value })} />
        <button className="btn2 kucuk" onClick={() => is(istek(`/kalite-kurali/${k.kod}`, { esik: g[`e${k.kod}`] ? Number(g[`e${k.kod}`]) : undefined, istisna: g[`i${k.kod}`] }), 'Kuralın yeni sürümü kaydedildi.')}>Yeni Sürüm</button></div>}</div>)}
    <div className="bolum">Açık Veri Hataları</div>{v.hatalar.length ? v.hatalar.map((h) => <div className={h.oncelik === 'Yüksek' ? 'soru hata' : 'soru'} key={h.kimlik}><span>{h.oncelik} · {h.kural_kod} {h.ad} · {h.aciklama} · {h.boyut} · Etki: {h.etki} · {new Date(h.ilk_gorulme).toLocaleDateString('tr-TR')}</span>
      {v.sahipOldugu.length > 0 && <div className="tam"><label htmlFor={`vh-${h.kimlik}`}>İstisna Gerekçesi</label><input id={`vh-${h.kimlik}`} value={g[h.kimlik] ?? ''} onChange={(e) => setG({ ...g, [h.kimlik]: e.target.value })} /><button className="btn2 kucuk" onClick={() => is(istek(`/veri-hatasi/${h.kimlik}/istisna`, { gerekce: g[h.kimlik] }), 'İstisna kaydedildi.')}>İstisna</button></div>}</div>) : <div className="ozet bos">Açık veri hatası bulunmamaktadır.</div>}</details>;
}
