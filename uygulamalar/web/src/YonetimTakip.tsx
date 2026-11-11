import { useEffect, useState } from 'react';
import { istek } from './api';

const e = (x: number) => x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ay = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth() - 1, 1)).toISOString().slice(0, 7); };

/** YG-763: KDV/tevkifat özeti ve bütçe-gerçekleşme. */
export function OnMuhasebeRaporlari() {
  const [d, setD] = useState(ay()); const [y, setY] = useState(new Date().getFullYear());
  const [k, setK] = useState<{ kesim: string; satir: { durum: string; oran: number; fatura: number; matrah: number; kdv: number; tevkifat: number; beyan: number }[]; toplam: { matrah: number; kdv: number; tevkifat: number; beyan: number; kdvTl: number } } | null>(null);
  const [b, setB] = useState<{ butceDurumu: string | null; satir: { birim: string; butce: number; gerceklesen: number; fark: number; oran: number | null }[]; gelir: number; toplam: { butce: number; gerceklesen: number } } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof k>>(`/on-muhasebe/kdv-ozeti?donem=${d}`).then(setK).catch(() => setK(null)); }, [d]);
  useEffect(() => { void istek<NonNullable<typeof b>>(`/on-muhasebe/butce-gerceklesme?yil=${y}`).then(setB).catch(() => setB(null)); }, [y]);
  if (!k && !b) return null;
  return <details><summary>Ön Muhasebe Raporları</summary>
    {k && <><div className="bolum">KDV ve Tevkifat Özeti</div><label htmlFor="om-d">Dönem</label><input id="om-d" type="month" value={d} onChange={(x) => setD(x.target.value)} /><div className="not">Kesim: {k.kesim}</div>
      {k.satir.map((x, i) => <div className="soru" key={i}><span>{x.durum} · %{x.oran} · {x.fatura} fatura · Matrah {e(x.matrah)} · KDV {e(x.kdv)} · Tevkifat {e(x.tevkifat)} · Beyan {e(x.beyan)} EUR</span></div>)}
      <div className="soru"><span><b>Toplam</b> · Matrah {e(k.toplam.matrah)} · KDV {e(k.toplam.kdv)} · Tevkifat {e(k.toplam.tevkifat)} · Beyan {e(k.toplam.beyan)} EUR · KDV {e(k.toplam.kdvTl)} TL</span></div></>}
    {b && <><div className="bolum">Bütçe – Gerçekleşme</div><label htmlFor="om-y">Yıl</label><input id="om-y" type="number" value={y} onChange={(x) => setY(Number(x.target.value))} />{b.butceDurumu !== 'Onaylandı' && <div className="not">Bütçe dönemi: {b.butceDurumu ?? 'Açılmadı'}</div>}
      {b.satir.map((x) => <div className={x.oran !== null && x.oran > 100 ? 'soru hata' : 'soru'} key={x.birim}><span>{x.birim} · Bütçe {e(x.butce)} · Gerçekleşen {e(x.gerceklesen)} · Fark {e(x.fark)} EUR{x.oran !== null ? ` · %${x.oran}` : ''}</span></div>)}
      <div className="soru"><span><b>Toplam</b> · Bütçe {e(b.toplam.butce)} · Gider {e(b.toplam.gerceklesen)} · Gelir {e(b.gelir)} EUR</span></div></>}</details>;
}

/** YG-805: yaklaşan ve geciken gözden geçirmeler. */
export function GozdenGecirmeler() {
  const [l, setL] = useState<{ tur: string; konu: string; tarih: string; gecikti: boolean }[] | null>(null);
  useEffect(() => { void istek<NonNullable<typeof l>>('/gozden-gecirmeler').then(setL).catch(() => setL(null)); }, []);
  if (!l?.length) return null;
  return <><div className="bolum">Gözden Geçirmeler</div>{l.map((x, i) => <div className={x.gecikti ? 'soru hata' : 'soru'} key={i}><span>{x.tarih.split('-').reverse().join('.')} · {x.tur} · {x.konu}{x.gecikti ? ' · Gecikti' : ''}</span></div>)}</>;
}

type D = { adet: number; kayitlar: string[] };
/** YG-774: yönetim değerlendirmesi girdi seti. */
export function YonetimDegerlendirmesi() {
  const [v, setV] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { void istek<Record<string, unknown>>('/yonetim-degerlendirmesi').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const AD: Record<string, string> = { guvenlikOlaylari: 'Güvenlik Olayları', hizmetOlaylari: 'Hizmet Olayları', surekliliktestleri: 'Süreklilik Testleri', destekTalepleri: 'Destek Talepleri', denetimBulgulari: 'Denetim Bulguları', istisnalar: 'İstisnalar', acikDuzelticiEylemler: 'Açık Düzeltici Eylemler', veriKalitesi: 'Veri Kalitesi (eksik alanlı dosyalar)', gostergeHedefDegisiklikleri: 'Gösterge Hedef Değişiklikleri' };
  const sat = (ad: string, x: D) => <div className="soru" key={ad}><span><b>{ad}</b> · {x.adet}{x.kayitlar.length ? ` · ${x.kayitlar.join(', ')}` : ''}</span></div>;
  const dg = v.degisiklikler as { uretimeAlinan: D; geriAlinan: D };
  return <details><summary>Yönetim Değerlendirmesi Girdi Seti</summary>{Object.entries(AD).map(([k, a]) => sat(a, v[k] as D))}{sat('Üretime Alınan Değişiklikler', dg.uretimeAlinan)}{sat('Geri Alınan Değişiklikler', dg.geriAlinan)}</details>;
}

/** YG-771: aylık görüşme hedefleri ve gerçekleşen görüşmeler. */
export function SatisGorusmeleri() {
  const [d, setD] = useState(new Date().toISOString().slice(0, 7)); const [v, setV] = useState<{ hedefGirer: boolean; ozet: { kimlik: string; ad: string; hedef: number; gerceklesen: number; oran: number | null }[]; gorusmeler: { kimlik: string; tarih: string; kurum: string; kurum_turu: string; tur: string; sonuc: string; sonraki_adim: string | null; ad_soyad: string }[]; kisiler: { kimlik: string; ad_soyad: string }[] } | null>(null);
  const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>(`/satis-gorusmeleri?donem=${d}`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return null;
  const is = (p: Promise<unknown>, s: string) => void p.then(() => { setM(s); setG({}); return yk(); }).catch((x) => setM(x.message));
  const al = (k: string, et: string, tip = 'text') => <span key={k}><label htmlFor={`sg-${k}`}>{et}</label><input id={`sg-${k}`} type={tip} value={g[k] ?? ''} onChange={(x) => setG({ ...g, [k]: x.target.value })} /></span>;
  const sec = (k: string, et: string, l: string[]) => <span key={k}><label htmlFor={`sg-${k}`}>{et}</label><select id={`sg-${k}`} value={g[k] ?? ''} onChange={(x) => setG({ ...g, [k]: x.target.value })}><option value="">Seçiniz</option>{l.map((x) => <option key={x}>{x}</option>)}</select></span>;
  return <details><summary>Satış Görüşmeleri · {d}</summary>{m && <div className="not" role="status">{m}</div>}<label htmlFor="sg-d">Dönem</label><input id="sg-d" type="month" value={d} onChange={(x) => setD(x.target.value)} />
    {v.ozet.map((x) => <div className={x.oran !== null && x.oran < 100 ? 'soru hata' : 'soru'} key={x.kimlik}><span>{x.ad} · Hedef {x.hedef} · Gerçekleşen {x.gerceklesen}{x.oran !== null ? ` · %${x.oran}` : ''}</span></div>)}
    {v.hedefGirer && <div className="tam"><span><label htmlFor="sg-k">Kişi</label><select id="sg-k" value={g.k ?? ''} onChange={(x) => setG({ ...g, k: x.target.value })}><option value="">Seçiniz</option>{v.kisiler.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select></span>{al('h', 'Aylık Hedef Görüşme')}<button className="btn2 kucuk" onClick={() => is(istek('/satis-hedefi', { donem: d, kullanici: g.k, hedef: Number(g.h) }), 'Hedef kaydedildi.')}>Hedefi Kaydet</button></div>}
    {v.gorusmeler.map((x) => <div className="soru" key={x.kimlik}><span>{x.tarih.split('-').reverse().join('.')} · {x.kurum} ({x.kurum_turu}) · {x.tur} · {x.ad_soyad} · {x.sonuc}{x.sonraki_adim ? ` · Sonraki: ${x.sonraki_adim}` : ''}</span></div>)}
    <div className="tam">{al('t', 'Tarih', 'date')}{al('kr', 'Kurum')}{sec('kt', 'Kurum Türü', ['Sigorta Şirketi', 'Broker / Acente', 'Kurumsal Müşteri', 'Marina / Tesis', 'Diğer'])}{sec('tr', 'Görüşme Türü', ['Yüz Yüze', 'Telefon', 'Video', 'E-posta'])}{al('s', 'Sonuç')}{al('sa', 'Sonraki Adım')}
      <button className="btn2 kucuk" onClick={() => is(istek('/satis-gorusmesi', { tarih: g.t, kurum: g.kr, kurumTuru: g.kt, tur: g.tr, sonuc: g.s, sonrakiAdim: g.sa }), 'Görüşme kaydedildi.')}>Görüşmeyi Kaydet</button></div></details>;
}
