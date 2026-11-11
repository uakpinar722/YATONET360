import { useEffect, useState } from 'react';
import { istek } from './api';

type V = {
  donem: string;
  yogunlasma: { donem: string; toplamEur: number; ilk1: number; ilk3: number; ilkMusteriler: { muhatap: string; pay: number }[]; uyari: string[] };
  kayip: { yat_adi: string; son_kapanis: string; dosya: number }[];
  kademe: { baslik: string; yapan: string; gerekce: string | null; zaman: string }[];
  teklif: { gonderilen: number; onaylanan: number; oran: number | null; ucAylik: number | null; hedef: number; uyari: boolean };
  mali: { ortalamaIsGunu: number | null; hedef: number; asan: { dosyaNo: string; isGunu: number; acik: boolean }[] };
  markaModel: { onayli: M[]; onayBekleyen: M[] };
};
type M = { marka: string; model: string; dosya: number; hizmetTurleri: Record<string, number>; branslar: Record<string, number> };
const t = (x: number) => x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dag = (r: Record<string, number>) => Object.entries(r).map(([k, n]) => `${k}: ${n}`).join(', ');
/** YG-764, 769, 770, 779, 781, 1462, 1536: yönetim raporu ekleri. */
export function YonetimEkleri() {
  const n = new Date(); const [d, setD] = useState(new Date(Date.UTC(n.getFullYear(), n.getMonth() - 1, 1)).toISOString().slice(0, 7)); const [v, setV] = useState<V | null>(null);
  useEffect(() => { void istek<V>(`/yonetim-ekleri?donem=${d}`).then(setV).catch(() => setV(null)); }, [d]);
  if (!v) return null;
  const mm = (x: M) => <div className="soru" key={`${x.marka}${x.model}`}><span>{x.marka} {x.model} · {x.dosya} dosya · {dag(x.hizmetTurleri)} · Branş: {dag(x.branslar)}</span></div>;
  return <details><summary>Yönetim Raporu Ekleri · {v.donem}</summary><label htmlFor="ye-d">Dönem</label><input id="ye-d" type="month" value={d} onChange={(e) => setD(e.target.value)} />
    <div className="bolum">Müşteri Yoğunlaşması ({v.yogunlasma.donem})</div><div className={v.yogunlasma.uyari.length ? 'soru hata' : 'soru'}><span>Ciro {t(v.yogunlasma.toplamEur)} EUR · İlk müşteri %{v.yogunlasma.ilk1} · İlk üç müşteri %{v.yogunlasma.ilk3}{v.yogunlasma.uyari.length ? ` · ${v.yogunlasma.uyari.join('; ')}` : ''}</span></div>
    {v.yogunlasma.ilkMusteriler.map((x) => <div className="soru" key={x.muhatap}><span>{x.muhatap} · %{x.pay}</span></div>)}
    <div className="bolum">Teklif Dönüşümü</div><div className={v.teklif.uyari ? 'soru hata' : 'soru'}><span>Dönem: {v.teklif.onaylanan}/{v.teklif.gonderilen}{v.teklif.oran !== null ? ` · %${v.teklif.oran}` : ''} · Üç aylık ortalama: {v.teklif.ucAylik !== null ? `%${v.teklif.ucAylik}` : '—'} · Hedef en az %{v.teklif.hedef}</span></div>
    <div className="bolum">Teknik Bitişten Mali Kapanışa</div><div className="soru"><span>Ortalama {v.mali.ortalamaIsGunu ?? '—'} iş günü · Hedef en çok {v.mali.hedef} iş günü</span></div>
    {v.mali.asan.map((x) => <div className="soru hata" key={x.dosyaNo}><span>{x.dosyaNo} · {x.isGunu} iş günü{x.acik ? ' · Mali kapanış bekliyor' : ''}</span></div>)}
    <div className="bolum">Kademe Atlamaları</div>{v.kademe.length ? v.kademe.map((x, i) => <div className="soru" key={i}><span>{new Date(x.zaman).toLocaleDateString('tr-TR')} · {x.baslik} · {x.yapan}{x.gerekce ? ` · ${x.gerekce}` : ''}</span></div>) : <div className="ozet bos">Dönemde kademe atlaması bulunmamaktadır.</div>}
    <div className="bolum">Sisteme Dönmeyen Yatlar</div>{v.kayip.length ? v.kayip.map((x) => <div className="soru" key={x.yat_adi}><span>{x.yat_adi} · Son kapanış {x.son_kapanis.split('-').reverse().join('.')} · {x.dosya} dosya</span></div>) : <div className="ozet bos">Kayıt bulunmamaktadır.</div>}
    <div className="bolum">Marka/Model Bazında Hasar</div>{v.markaModel.onayli.map(mm)}
    {v.markaModel.onayBekleyen.length > 0 && <><div className="not">"Diğer" ile girilip onay bekleyen kayıtlar</div>{v.markaModel.onayBekleyen.map(mm)}</>}</details>;
}

/** YG-808: iç denetim örneklemi. */
export function IcDenetimOrneklem() {
  const [l, setL] = useState<{ donem: string; kimlik: string; dosya_no: string; havuz: number }[] | null>(null);
  useEffect(() => { void istek<NonNullable<typeof l>>('/ic-denetim/orneklem').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  return <details><summary>İç Denetim Örneklemi</summary>{l.length ? l.map((x) => <div className="soru" key={x.kimlik}><span>{x.donem} · {x.dosya_no} · Havuz {x.havuz} dosya</span></div>) : <div className="ozet bos">Örneklem bulunmamaktadır.</div>}</details>;
}
