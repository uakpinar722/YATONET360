import { useEffect, useState } from 'react';
import { istek } from './api';

type Ek = { planlar: { kimlik: string; yil: number; surecler: string[]; aciklama: string | null; durum: string }[]; planHazirlar: boolean; raporlar: boolean; bulgular: { kimlik: string; denetim_no: string; sinif: string; tanim: string; durum: string; takip_sonucu: string | null; takip_notu: string | null }[]; ozet: { sinif: string; acik: number; kapandi: number }[] };
/** YG-1676, YG-1680: yıllık plan ve bulgu takibi. */
export function DenetimPlani() {
  const [v, setV] = useState<Ek | null>(null); const [f, setF] = useState({ yil: String(new Date().getFullYear() + 1), surecler: '', aciklama: '' }); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<Ek>('/ic-denetim/ek').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>İç Denetim Planı ve Bulgu Takibi</summary>{m && <div className="not" role="status">{m}</div>}
    {v.planlar.map((p) => <div className="soru" key={p.kimlik}><span>{p.yil} · {p.durum} · {p.surecler.join(', ')}</span></div>)}
    {v.planHazirlar && <><label htmlFor="dp-y">Yıl</label><input id="dp-y" inputMode="numeric" value={f.yil} onChange={(e) => setF({ ...f, yil: e.target.value })} /><label htmlFor="dp-s">Denetlenecek Süreçler (virgülle)</label><input id="dp-s" value={f.surecler} onChange={(e) => setF({ ...f, surecler: e.target.value })} /><label htmlFor="dp-a">Açıklama</label><input id="dp-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
      <button className="btn2 kucuk" onClick={() => is(istek('/ic-denetim/plan', { yil: Number(f.yil), surecler: f.surecler.split(','), aciklama: f.aciklama }), 'Plan CEO onayına gönderildi.')}>Planı CEO Onayına Sun</button></>}
    {v.ozet.length > 0 && <div className="not">{v.ozet.map((x) => `${x.sinif}: ${x.acik} açık / ${x.kapandi} kapalı`).join(' · ')}</div>}
    {v.raporlar && <button className="btn2 kucuk" onClick={() => is(istek('/ic-denetim/bulgu-raporu', {}), 'Kapanış durumu CEO\'ya raporlandı.')}>Kapanış Durumunu CEO'ya Raporla</button>}
    {v.bulgular.map((x) => <div className="soru" key={x.kimlik}><span>{x.denetim_no} · {x.sinif} · {x.tanim} · {x.durum}{x.takip_sonucu ? ` · Takip: ${x.takip_sonucu}` : ''}</span>{x.durum === 'Açık' && <div className="tam"><label htmlFor={`bt-${x.kimlik}`}>Takip Notu</label><input id={`bt-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} /><button className="btn2 kucuk" onClick={() => is(istek(`/ic-denetim/bulgu/${x.kimlik}/takip`, { sonuc: 'Etkin', not: g[x.kimlik] }), 'Bulgu kapandı.')}>Etkin</button><button className="btn2 kucuk" onClick={() => is(istek(`/ic-denetim/bulgu/${x.kimlik}/takip`, { sonuc: 'Etkin Değil', not: g[x.kimlik] }), 'Takip kaydedildi.')}>Etkin Değil</button></div>}</div>)}</details>;
}

type Rg = { taramalar: { kimlik: string; donem: string; sonuc: string | null; aciklama: string | null; mum_listesi: string[] }[]; kurallar: { mum_no: string; mevzuat: string | null; yukumluluk: string }[] };
/** YG-807: haftalık Resmî Gazete taraması; değişiklik uyum kuralına işlenir. */
export function ResmiGazete() {
  const [v, setV] = useState<Rg | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [sec, setSec] = useState<string[]>([]); const [m, setM] = useState('');
  const yk = () => istek<Rg>('/resmi-gazete').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const kaydet = (id: string, sonuc: string) => void istek(`/resmi-gazete/${id}`, { sonuc, aciklama: g[id], mumlar: sonuc === 'Değişiklik Var' ? sec : [] }).then(() => { setM('Tarama kaydedildi.'); setSec([]); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Resmî Gazete Taraması</summary>{m && <div className="not" role="status">{m}</div>}
    {v.taramalar.map((t) => <div className="soru" key={t.kimlik}><span>{t.donem} · {t.sonuc ?? 'Bekliyor'}{t.mum_listesi.length ? ` · ${t.mum_listesi.join(', ')}` : ''}{t.aciklama ? ` · ${t.aciklama}` : ''}</span>{!t.sonuc && <div className="tam"><label htmlFor={`rg-a-${t.kimlik}`}>Değişiklik</label><input id={`rg-a-${t.kimlik}`} value={g[t.kimlik] ?? ''} onChange={(e) => setG({ ...g, [t.kimlik]: e.target.value })} />
      <label htmlFor={`rg-m-${t.kimlik}`}>İlgili Uyum Kuralları</label><select id={`rg-m-${t.kimlik}`} multiple value={sec} onChange={(e) => setSec([...e.target.selectedOptions].map((o) => o.value))}>{v.kurallar.map((k) => <option key={k.mum_no} value={k.mum_no}>{k.mum_no} · {k.yukumluluk.slice(0, 60)}</option>)}</select>
      <button className="btn2 kucuk" onClick={() => kaydet(t.kimlik, 'Değişiklik Yok')}>Değişiklik Yok</button><button className="btn2 kucuk" onClick={() => kaydet(t.kimlik, 'Değişiklik Var')}>Değişikliği İşle</button></div>}</div>)}</details>;
}

type Sm = { kimlik: string; kayit_no: string; kaynak: string; platform: string; ozet: string; olumsuz: boolean; sonuc: string | null; gecikti: boolean };
/** YG-586: personel bildirir; Müşteri ve Paydaş İlişkileri Müdürü 2 saat içinde değerlendirir. Personel paylaşıma yanıt vermez. */
export function SosyalMedya() {
  const [l, setL] = useState<Sm[] | null>(null); const [f, setF] = useState({ platform: '', baglanti: '', ozet: '' }); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<Sm[]>('/sosyal-medya').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Sosyal Medya Bildirimi</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="not">Paylaşıma yanıt vermeyiniz; yalnız bildiriniz.</div>
    <label htmlFor="sm-p">Platform</label><input id="sm-p" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} /><label htmlFor="sm-b">Bağlantı</label><input id="sm-b" value={f.baglanti} onChange={(e) => setF({ ...f, baglanti: e.target.value })} /><label htmlFor="sm-o">Özet</label><input id="sm-o" value={f.ozet} onChange={(e) => setF({ ...f, ozet: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.platform.trim() || !f.ozet.trim()} onClick={() => is(istek('/sosyal-medya', { ...f, tarama: l !== null }), 'Bildiriminiz iletildi.')}>Bildir</button>
    {l?.map((x) => <div className={x.gecikti ? 'soru hata' : 'soru'} key={x.kimlik}><span>{x.kayit_no} · {x.kaynak} · {x.platform} · {x.ozet}{x.sonuc ? ` · ${x.sonuc}` : x.gecikti ? ' · 2 Saat Aşıldı' : ''}</span>{!x.sonuc && <div className="tam"><label htmlFor={`sm-d-${x.kimlik}`}>Değerlendirme</label><input id={`sm-d-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />{['İşlem Gerekmez', 'Sözcüye İletildi', 'Hukuka İletildi', 'Kapatıldı'].map((s) => <button key={s} className="btn2 kucuk" onClick={() => is(istek(`/sosyal-medya/${x.kimlik}/degerlendir`, { degerlendirme: g[x.kimlik], sonuc: s }), 'Değerlendirme kaydedildi.')}>{s}</button>)}</div>}</div>)}</details>;
}
