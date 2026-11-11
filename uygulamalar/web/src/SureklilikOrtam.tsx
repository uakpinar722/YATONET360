import { useEffect, useState } from 'react';
import { istek } from './api';

type O = { kod: string; ad: string; tur: 'dakika' | 'saat' | 'evet' };
type T = { kimlik: string; ad: string; senaryo: string; plan_tarihi: string; olcutler: Record<string, number | boolean>; sonuclar: Record<string, number | boolean> | null; durum: string; sapmalar: { kimlik: string; olcut: string; hedef: string; gerceklesen: string; durum: string; hedefTarih: string | null }[] | null };
type K = { kimlik: string; ortam: string; amac: string; veri_kapsami: string; veri_sahibi_rol: string; maskeleme_yontemi: string; erisim_bitis: string; durum: string; sahip_onayi: boolean; guvenlik_onayi: boolean };
const tr = (s: string) => s.split('-').reverse().join('.');
/** YG-1287 süreklilik testleri; YG-1119, YG-1280 alt ortam veri kopyaları. */
export function SureklilikOrtam() {
  const [v, setV] = useState<{ olcutler: O[]; testler: T[]; kopyalar: K[]; roller: string[] } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/sureklilik-ortam').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, s: string) => void p.then(() => { setM(s); setG({}); return yk(); }).catch((e) => setM(e.message));
  const al = (k: string, et: string, tip = 'text') => <span key={k}><label htmlFor={`so-${k}`}>{et}</label><input id={`so-${k}`} type={tip} value={g[k] ?? ''} onChange={(e) => setG({ ...g, [k]: e.target.value })} /></span>;
  const ad = (k: string) => v.olcutler.find((x) => x.kod === k)?.ad ?? k;
  const sonucGovde = (t: T) => Object.fromEntries(v.olcutler.map((o) => [o.kod, o.tur === 'evet' ? g[`s${t.kimlik}${o.kod}`] !== 'Hayır' : Number(g[`s${t.kimlik}${o.kod}`])]));
  return <details><summary>Süreklilik Testleri ve Alt Ortam Verisi</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="bolum">Süreklilik Testleri</div>{v.testler.map((t) => <div className="soru" key={t.kimlik}><span><b>{t.ad}</b> · {t.senaryo} · {tr(t.plan_tarihi)} · {t.durum}<br />Ölçütler: {v.olcutler.filter((o) => o.tur !== 'evet').map((o) => `${o.ad} ≤ ${t.olcutler[o.kod]}`).join(' · ')}
      {t.sapmalar?.map((s) => <span key={s.kimlik}><br />Sapma · {ad(s.olcut)}: hedef {s.hedef}, gerçekleşen {s.gerceklesen} · {s.durum}{s.hedefTarih ? ` · ${tr(s.hedefTarih)}` : ''}</span>)}</span>
      {t.durum === 'Planlandı' && <div className="tam">{v.olcutler.map((o) => o.tur === 'evet' ? <span key={o.kod}><label htmlFor={`so-s${t.kimlik}${o.kod}`}>{o.ad}</label><select id={`so-s${t.kimlik}${o.kod}`} value={g[`s${t.kimlik}${o.kod}`] ?? 'Evet'} onChange={(e) => setG({ ...g, [`s${t.kimlik}${o.kod}`]: e.target.value })}><option>Evet</option><option>Hayır</option></select></span> : al(`s${t.kimlik}${o.kod}`, o.ad, 'number'))}
        {al(`hd${t.kimlik}`, 'Sapma Hedef Tarihi', 'date')}<button className="btn2 kucuk" onClick={() => is(istek(`/sureklilik-testi/${t.kimlik}/sonuc`, { sonuclar: sonucGovde(t), sorumlu: undefined, hedefTarih: g[`hd${t.kimlik}`] || undefined }), 'Sonuçlar kaydedildi.')}>Sonuçları Kaydet</button></div>}</div>)}
    <div className="tam"><div className="not">Yeni test (ölçütler testten önce tanımlanır)</div>{al('tAd', 'Test Adı')}{al('tSen', 'Senaryo')}{al('tTar', 'Plan Tarihi', 'date')}{v.olcutler.filter((o) => o.tur !== 'evet').map((o) => al(`o${o.kod}`, `Hedef · ${o.ad}`, 'number'))}
      <button className="btn2 kucuk" onClick={() => is(istek('/sureklilik-testi', { ad: g.tAd, senaryo: g.tSen, planTarihi: g.tTar, olcutler: Object.fromEntries(v.olcutler.filter((o) => o.tur !== 'evet').map((o) => [o.kod, Number(g[`o${o.kod}`])])) }), 'Test planlandı.')}>Planla</button></div>
    <div className="bolum">Alt Ortam Veri Kopyaları</div>{v.kopyalar.map((k) => <div className={k.durum === 'Aktif' ? 'soru hata' : 'soru'} key={k.kimlik}><span>{k.ortam} · {k.amac} · {k.veri_kapsami} · {k.maskeleme_yontemi} · Bitiş {tr(k.erisim_bitis)} · {k.durum} · Veri sahibi ({k.veri_sahibi_rol}): {k.sahip_onayi ? 'Onayladı' : 'Bekliyor'} · Güvenlik: {k.guvenlik_onayi ? 'Onayladı' : 'Bekliyor'}</span>
      <div className="tam">{k.durum === 'Onayda' && <><button className="btn2 kucuk" onClick={() => is(istek(`/alt-ortam-kopyasi/${k.kimlik}/karar`, { onay: true }), 'Onay kaydedildi.')}>Onayla</button>{al(`r${k.kimlik}`, 'Ret Gerekçesi')}<button className="btn2 kucuk" onClick={() => is(istek(`/alt-ortam-kopyasi/${k.kimlik}/karar`, { onay: false, gerekce: g[`r${k.kimlik}`] }), 'Reddedildi.')}>Reddet</button></>}
        {k.durum === 'Aktif' && <>{al(`i${k.kimlik}`, 'İmha Kanıtı')}<button className="btn2 kucuk" onClick={() => is(istek(`/alt-ortam-kopyasi/${k.kimlik}/imha`, { kanit: g[`i${k.kimlik}`] }), 'İmha kaydedildi.')}>İmha Edildi</button></>}</div></div>)}
    <div className="tam"><div className="not">Yeni talep (geri döndürülemez maskeleme, kapalı dış bağlantı, en çok 30 gün)</div><span><label htmlFor="so-kO">Ortam</label><select id="so-kO" value={g.kO ?? ''} onChange={(e) => setG({ ...g, kO: e.target.value })}><option value="">Seçiniz</option><option>Test</option><option>Eğitim</option><option>Geliştirme</option></select></span>
      {al('kA', 'Amaç')}{al('kK', 'Veri Kapsamı')}{al('kS', 'Veri Sahibi Rol')}{al('kM', 'Maskeleme Yöntemi')}{al('kB', 'Erişim Bitişi', 'date')}
      <label className="kutu"><input type="checkbox" checked={g.kG === '1'} onChange={(e) => setG({ ...g, kG: e.target.checked ? '1' : '' })} /><span>Maskeleme geri döndürülemez</span></label>
      <label className="kutu"><input type="checkbox" checked={g.kD === '1'} onChange={(e) => setG({ ...g, kD: e.target.checked ? '1' : '' })} /><span>Dış bağlantılar kapalı</span></label>
      <button className="btn2 kucuk" onClick={() => is(istek('/alt-ortam-kopyasi', { ortam: g.kO, amac: g.kA, veriKapsami: g.kK, veriSahibiRol: g.kS, maskelemeYontemi: g.kM, erisimBitis: g.kB, geriDondurulemez: g.kG === '1', disBaglantiKapali: g.kD === '1' }), 'Talep onaya gönderildi.')}>Talep Et</button></div></details>;
}
